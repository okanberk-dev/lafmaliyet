import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { and, count, eq, gte, ne, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { ASSISTANT_DAILY_CAP } from "@/lib/assistant/protocol";
import { OCR_MODEL, photoModelsOf, type PhotoModels } from "@/lib/photo-read/models";
import { MAX_READS_PER_PHOTO, type ReadingState } from "@/lib/photo-rules";
import { SCAN_HINT_DAILY_CAP } from "@/lib/photo-scan";
import { MATCH_DAILY_CAP } from "@/lib/product-match-ai";
import { todayTR } from "@/lib/reminders";
import { SHIFT_DRAFT_DAILY_CAP } from "@/lib/vardiya-taslak";
import { getDb, schema as s, type DB } from "@/server/db";

import { ASSISTANT_DEEP, ASSISTANT_EFFORT, ASSISTANT_MODEL, type AssistantClient, type AssistantOutcome } from "./assistant/loop";
import { costUsd } from "./pricing";
import { replayAssistantClient, replayClient, replayEnabled } from "./replay";
import {
  AI_INVOICE_MODEL,
  AI_MODEL,
  aiAlertLog,
  aiErrorText,
  MATCH_REQUEST,
  MATCH_RUNNING_MS,
  runExtraction,
  type AiClient,
  type AiDocumentType,
  type AiEffort,
  type AiErrorCode,
  type AiFeature,
  type AiImageType,
  type AiInput,
  type AiModel,
  type AiSubject,
  type AiTimeouts,
} from "./run";

/*
 * Fotoğraftan ve faturadan okumanın kapısı (Claude): anahtar var mı, ayar açık mı, bugünkü sınır doldu mu, fotoğraf kaç
 * kez okundu. Her çağrı ai_calls'a yazılır (önce "running", kapılarla aynı işlemde ve sınırın kilidiyle: aynı anda gelen
 * iki istek sınırı aşamaz; çökme de kalır); görüntü, PDF ve istem hiçbir yere yazılmaz. Anahtar (ANTHROPIC_API_KEY)
 * yalnız sunucuda: sayfalar yalnız aiStatus().state alır. Anahtar yoksa (yerelde, önizlemelerde) fotoğraf yine eklenir,
 * rakamlar elle yazılır (docs/FOTOGRAF.md); fatura okunmaz, kart bugünkü gibi kalır (docs/FATURA-OKUMA.md).
 */

export { AI_INVOICE_MODEL, AI_MATCH_MODEL, AI_MODEL, type AiErrorCode, type AiFeature } from "./run";

export interface AiSettings {
  enabled: boolean;
  /** Günde en çok okuma (0: hiç) */
  dailyCap: number;
  /**
   * AsilPOS gününün gün sonu fotoğrafını okuyan modeller (src/lib/photo-read/models.ts): önce ucuz, gerekirse bir kez güçlü.
   * Kayıtta yoksa ya da bilinmeyen modelse sabitler (Claude Haiku 5.5 / Claude Opus 5.5)
   */
  photoModels: PhotoModels;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: true, dailyCap: 40, photoModels: photoModelsOf(undefined) };
const SETTINGS_KEY = "ai.settings";

async function storedAiSettings(): Promise<Record<string, unknown>> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, SETTINGS_KEY)).limit(1);
  const v = row?.value;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function loadAiSettings(): Promise<AiSettings> {
  const v = (await storedAiSettings()) as Partial<AiSettings>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_AI_SETTINGS.enabled,
    dailyCap: typeof v.dailyCap === "number" && Number.isInteger(v.dailyCap) && v.dailyCap >= 0 ? v.dailyCap : DEFAULT_AI_SETTINGS.dailyCap,
    photoModels: photoModelsOf(v),
  };
}

/** Verilen alanları kayda yazar; verilmeyenler (ör. okuma modelleri) kalır */
export async function saveAiSettings(patch: Partial<AiSettings>): Promise<void> {
  const value = { ...(await storedAiSettings()), ...patch };
  await getDb()
    .insert(s.integrationState)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/** Anahtar var mı (geliştirmede kayıtlı yanıtlar açıksa da var sayılır) */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim()) || replayEnabled();
}

let live: AiClient | null = null;

/** Gerçek istemci: ANTHROPIC_API_KEY'i ortamdan okur (ilk okumada kurulur) */
function liveClient(): AiClient {
  if (!live) {
    const anthropic = new Anthropic();
    live = { beta: { messages: { create: (params, options) => anthropic.beta.messages.create(params, options) } } };
  }
  return live;
}

/** İstanbul'da bugünün başı */
const dayStart = (now: Date) => new Date(`${todayTR(now)}T00:00:00+03:00`);
const monthStart = (now: Date) => new Date(`${todayTR(now).slice(0, 7)}-01T00:00:00+03:00`);

/** Vardiyayı yazarak doldurma günlükte bu türle durur; okuma sınırına sayılmaz, kendi sınırı vardır */
const SHIFT_FEATURE = "vardiya" satisfies AiFeature;
/** Paraşüt'te ürün → hammadde önerisi (parti başına bir satır); okuma sınırına sayılmaz, kendi sınırı vardır */
const MATCH_FEATURE = "eslestirme" satisfies AiFeature;
/**
 * Belge taramada köşe ipucu (POST /api/foto/kenar; yalnız telefondaki kod emin değilken): okuma sınırına sayılmaz,
 * kendi sınırı vardır (SCAN_HINT_DAILY_CAP). Taramaya sorulan ucuz çağrılar akşamki Z okumasının hakkını yemesin
 */
const SCAN_FEATURE = "tarama" satisfies AiFeature;
/** Kendi günlük sınırı olan türler: fotoğraf ve fatura okumasının sınırına sayılmaz (kasadaki okumayı kesmesin) */
const OWN_CAP: Partial<Record<AiFeature, number>> = { [SHIFT_FEATURE]: SHIFT_DRAFT_DAILY_CAP, [MATCH_FEATURE]: MATCH_DAILY_CAP, [SCAN_FEATURE]: SCAN_HINT_DAILY_CAP };
const OWN_CAP_FEATURES = Object.keys(OWN_CAP);
/** Panel asistanı (docs/ASISTAN.md): okuma sınırına sayılmaz, yönetici başına kendi sınırı vardır (ASSISTANT_DAILY_CAP) */
const ASSISTANT_FEATURE = "asistan" satisfies AiFeature;
/**
 * Fatura okuması (Hammaddeler, Paraşüt): Ayarlar'daki günlük sınır kadar KENDİ havuzu vardır (25 Kasım 2026). Eskiden
 * fotoğraflarla ortaktı: gündüz okunan faturalar sınırı doldurunca akşam çekilen Z ve gün sonu fotoğrafı yapay zekâyla
 * okunamıyor, koda (OCR) düşüyordu (sahibin şikâyeti: "z raporları okunmuyor"). Kasanın fotoğrafları faturadan etkilenmez
 */
const INVOICE_FEATURE = "fatura" satisfies AiFeature;

/** Sorgu yapan: bağlantı havuzu ya da kapıların işlemi (extract) */
type Q = Pick<DB, "select">;

/**
 * Fotoğraf okumaları (kasa Z'si, yazarkasa, fiş): günlük sınır bunları sayar. Kendi sınırı olan türler (vardiya
 * taslakları, ürün önerileri, belge taramanın köşe ipucu, fatura okuması) ve asistanın soruları sayılmaz; kodla okuma (OCR_MODEL, yapay zekâ değil,
 * ücretsiz) da sayılmaz
 */
async function readingsSince(since: Date, q: Q = getDb()): Promise<number> {
  const [row] = await q
    .select({ n: count() })
    .from(s.aiCalls)
    .where(and(gte(s.aiCalls.at, since), notInArray(s.aiCalls.feature, [...OWN_CAP_FEATURES, ASSISTANT_FEATURE, INVOICE_FEATURE]), ne(s.aiCalls.model, OCR_MODEL)));
  return row?.n ?? 0;
}

/** Kendi sınırı olan türün çağrıları */
async function featureCallsSince(feature: AiFeature, since: Date, q: Q = getDb()): Promise<number> {
  const [row] = await q
    .select({ n: count() })
    .from(s.aiCalls)
    .where(and(gte(s.aiCalls.at, since), eq(s.aiCalls.feature, feature)));
  return row?.n ?? 0;
}

export type AiState = ReadingState;

/** Ekranlar için: fotoğraftan okuma yapılabilir mi ve bugün kaç fotoğraf okuması yapıldı */
export async function aiStatus(now = new Date()): Promise<{ state: AiState; usedToday: number; cap: number }> {
  const [settings, usedToday] = await Promise.all([loadAiSettings(), readingsSince(dayStart(now))]);
  const state: AiState = !aiConfigured() ? "nokey" : !settings.enabled ? "off" : usedToday >= settings.dailyCap ? "cap" : "on";
  return { state, usedToday, cap: settings.dailyCap };
}

/** Fatura okuması için: yapılabilir mi ve bugün kaç fatura okundu (kendi havuzu, sınır Ayarlar'dakiyle aynı sayı) */
export async function invoiceAiStatus(now = new Date()): Promise<{ state: AiState; usedToday: number; cap: number }> {
  const [settings, usedToday] = await Promise.all([loadAiSettings(), featureCallsSince(INVOICE_FEATURE, dayStart(now))]);
  const state: AiState = !aiConfigured() ? "nokey" : !settings.enabled ? "off" : usedToday >= settings.dailyCap ? "cap" : "on";
  return { state, usedToday, cap: settings.dailyCap };
}

/**
 * Vardiya ekranı için: yazarak doldurma kullanılabilir mi. Anahtar ve Ayarlar › Fotoğraftan okuma anahtarı okumayla
 * ortaktır (kapalıyken hiçbir istek gitmez); günlük sınır ayrıdır (SHIFT_DRAFT_DAILY_CAP)
 */
export async function shiftDraftStatus(now = new Date()): Promise<{ state: AiState; usedToday: number; cap: number }> {
  if (!aiConfigured()) return { state: "nokey", usedToday: 0, cap: SHIFT_DRAFT_DAILY_CAP };
  const [settings, usedToday] = await Promise.all([loadAiSettings(), featureCallsSince(SHIFT_FEATURE, dayStart(now))]);
  const state: AiState = !settings.enabled ? "off" : usedToday >= SHIFT_DRAFT_DAILY_CAP ? "cap" : "on";
  return { state, usedToday, cap: SHIFT_DRAFT_DAILY_CAP };
}

/**
 * Asistan satırının günlük sınırdaki ağırlığı: derin analiz (satırın eforu ASSISTANT_DEEP.effort, "high") 2 soru, öteki
 * her satır 1 (loop.ts ASSISTANT_DEEP; olağan efor "medium", eski satırlar ve eforu boş satırlar 1)
 */
const assistantWeight = () => sql<number>`coalesce(sum(case when ${s.aiCalls.effort} = ${ASSISTANT_DEEP.effort} then ${ASSISTANT_DEEP.weight} else 1 end), 0)::int`;

/** Yöneticinin bugünkü asistan soruları (hata ve ret dahil: her soru bir satır; derin analiz 2 sayılır) */
async function assistantCallsSince(userId: number, since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: assistantWeight() })
    .from(s.aiCalls)
    .where(and(gte(s.aiCalls.at, since), eq(s.aiCalls.feature, ASSISTANT_FEATURE), eq(s.aiCalls.userId, userId)));
  return Number(row?.n ?? 0);
}

/**
 * Panel asistanı (docs/ASISTAN.md): soru sorulabilir mi. Anahtar ve Ayarlar › Fotoğraftan okuma anahtarı okumayla
 * ortaktır (kapalıyken Claude'a hiçbir istek gitmez); günlük sınır yönetici başınadır (ASSISTANT_DAILY_CAP)
 */
export async function assistantStatus(userId: number, now = new Date()): Promise<{ state: AiState; usedToday: number; cap: number }> {
  if (!aiConfigured()) return { state: "nokey", usedToday: 0, cap: ASSISTANT_DAILY_CAP };
  const [settings, usedToday] = await Promise.all([loadAiSettings(), assistantCallsSince(userId, dayStart(now))]);
  const state: AiState = !settings.enabled ? "off" : usedToday >= ASSISTANT_DAILY_CAP ? "cap" : "on";
  return { state, usedToday, cap: ASSISTANT_DAILY_CAP };
}

let liveAssistant: AssistantClient | null = null;

/** Asistanın istemcisi: geliştirmede kayıtlı yanıtlar (AI_REPLAY=1), yoksa gerçek SDK (akışlı) */
export function assistantClient(): AssistantClient {
  if (replayEnabled()) return replayAssistantClient();
  if (!liveAssistant) {
    const anthropic = new Anthropic();
    liveAssistant = { beta: { messages: { stream: (params, options) => anthropic.beta.messages.stream(params, options) } } };
  }
  return liveAssistant;
}

/**
 * Sorunun satırı ("running"; çökme de kalır): sayım ve ekleme tek işlemde, yönetici başına danışma kilidiyle
 * (pg_advisory_xact_lock): aynı anda gelen sorular günlük sınırı aşamaz. Sınır dolduysa satır açılmaz, null döner.
 * Derin analiz (`deep`) satırı eforu "high" ile açılır ve sınıra 2 sayılır: 2 hak kalmadıysa açılmaz.
 */
export async function startAssistantCall(userId: number, cap: number = ASSISTANT_DAILY_CAP, now: Date = new Date(), opts: { deep?: boolean } = {}): Promise<number | null> {
  const weight = opts.deep ? ASSISTANT_DEEP.weight : 1;
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ai_calls.asistan'), ${userId})`);
    const [row] = await tx
      .select({ n: assistantWeight() })
      .from(s.aiCalls)
      .where(and(gte(s.aiCalls.at, dayStart(now)), eq(s.aiCalls.feature, ASSISTANT_FEATURE), eq(s.aiCalls.userId, userId)));
    if (Number(row?.n ?? 0) + weight > cap) return null;
    const [call] = await tx
      .insert(s.aiCalls)
      .values({ feature: ASSISTANT_FEATURE, model: ASSISTANT_MODEL, effort: opts.deep ? ASSISTANT_DEEP.effort : ASSISTANT_EFFORT, status: "running", userId, photoId: null })
      .returning({ id: s.aiCalls.id });
    return call.id;
  });
}

/**
 * Satırı kapatır: maliyet, token, süre, bitiş nedeni, çağrı ve araç sayısı. Sorunun, yanıtın ve araç sonuçlarının
 * METNİ yazılmaz. Anahtar, kredi ve reddedilen istek hataları sunucu günlüğüne de düşer (API'nin hata metniyle)
 */
export async function finishAssistantCall(callId: number, outcome: AssistantOutcome, ms: number): Promise<void> {
  const c = outcome.cost;
  const status = outcome.error
    ? outcome.error.code === "refusal"
      ? "refusal"
      : "error"
    : outcome.done === "end" || outcome.done === "limit"
      ? "ok"
      : "incomplete";
  if (!c.priceKnown) console.warn("[asistan] fiyatı bilinmeyen model", outcome.servedModel);
  if (outcome.error) {
    const alert = aiAlertLog(ASSISTANT_FEATURE, { ...outcome.error, requestId: outcome.requestId });
    if (alert) console.error("[asistan]", alert);
  }
  await getDb()
    .update(s.aiCalls)
    .set({
      status,
      errorCode: outcome.error?.code ?? null,
      error: outcome.error?.detail.slice(0, 300) ?? null,
      servedModel: outcome.servedModel,
      stopReason: outcome.done === "aborted" || outcome.done === "deadline" ? outcome.done : outcome.stopReason,
      requestId: outcome.requestId,
      ms,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      cacheReadTokens: c.cacheReadTokens,
      cacheWriteTokens: c.cacheWriteTokens,
      costUsd: c.costUsd,
      fallback: c.fallback,
      result: { apiCalls: outcome.apiCalls, toolCalls: outcome.toolCalls },
    })
    .where(eq(s.aiCalls.id, callId));
}

/**
 * Paraşüt'te "AI ile öner" düğmesi için: kullanılabilir mi, bugün kaç parti soruldu, bu ayın ürün önerisi çağrıları ve
 * tutarı. Anahtar ve Ayarlar › Fotoğraftan okuma anahtarı okumayla ortaktır; günlük sınır ayrıdır (MATCH_DAILY_CAP)
 */
export async function matchSuggestStatus(now = new Date()): Promise<{ state: AiState; usedToday: number; cap: number; monthCalls: number; monthUsd: number }> {
  if (!aiConfigured()) return { state: "nokey", usedToday: 0, cap: MATCH_DAILY_CAP, monthCalls: 0, monthUsd: 0 };
  const [settings, usedToday, [month]] = await Promise.all([
    loadAiSettings(),
    featureCallsSince(MATCH_FEATURE, dayStart(now)),
    getDb()
      .select({ n: count(), usd: sql<number>`coalesce(sum(${s.aiCalls.costUsd}), 0)`.mapWith(Number) })
      .from(s.aiCalls)
      .where(and(gte(s.aiCalls.at, monthStart(now)), eq(s.aiCalls.feature, MATCH_FEATURE))),
  ]);
  const state: AiState = !settings.enabled ? "off" : usedToday >= MATCH_DAILY_CAP ? "cap" : "on";
  return { state, usedToday, cap: MATCH_DAILY_CAP, monthCalls: month?.n ?? 0, monthUsd: month?.usd ?? 0 };
}

/** Ayarlar kartı: bu ayın çağrıları ve tutarı (dolar; vardiya taslakları, ürün önerileri ve asistan dahil), bugünün okumaları */
export async function aiUsageSummary(now = new Date()): Promise<{ monthCalls: number; monthUsd: number; today: number }> {
  const [[month], today] = await Promise.all([
    getDb()
      .select({ n: count(), usd: sql<number>`coalesce(sum(${s.aiCalls.costUsd}), 0)`.mapWith(Number) })
      .from(s.aiCalls)
      .where(and(gte(s.aiCalls.at, monthStart(now)), ne(s.aiCalls.model, OCR_MODEL))),
    readingsSince(dayStart(now)),
  ]);
  return { monthCalls: month?.n ?? 0, monthUsd: month?.usd ?? 0, today };
}

export type AiResult<T> =
  | { ok: true; data: T; callId: number; ms: number; costUsd: number; servedModel: string; fallback: boolean }
  | { ok: false; code: AiErrorCode; message: string; callId: number | null };

const STATUS: Partial<Record<AiErrorCode, "refusal" | "incomplete" | "invalid">> = { refusal: "refusal", incomplete: "incomplete", invalid: "invalid" };

interface ExtractCall<T> {
  /** Okuma ya da vardiya taslağı (asistanın kendi yolu var: startAssistantCall) */
  feature: Exclude<AiFeature, "asistan">;
  userId: number;
  photoId: number | null;
  system: string;
  task: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Yalnız yazarkasa Z'si (run.ts OKC_EFFORT, OKC_TIMEOUTS); ötekilerde modelin varsayılanı */
  effort?: AiEffort;
  timeouts?: AiTimeouts;
  stored?: (data: T) => T;
  /** Sistem istemi önbelleğe yazılır (run.ts; yalnız ürün önerisi) */
  cacheSystem?: boolean;
  /**
   * Aynı anda tek istek (yalnız ürün önerisi): bu türün bu kadar ms'den yeni "running" satırı varsa istek gitmez
   * ("busy"). Pencere en uzun çağrıdan geniş tutulur; çöküp "running" kalan satır pencere geçince engellemez
   */
  exclusiveMs?: number;
  /** Yalnız testte: sahte istemci (canlı yapay zekâ yok); verilmezse gerçek istemci ya da geliştirmede kayıtlı yanıtlar */
  client?: AiClient;
}

/**
 * Görseli okur ve sonucu günlüğe yazar. Kapılar sırayla: anahtar, ayar, bugünkü sınır, fotoğraf başına 3 okuma.
 * Doğrulanmış okuma ai_calls.result'ta saklanır (karşılaştırmalar istemcinin gönderdiğine değil buna bakar);
 * `stored` saklanacak hâlini verir (ör. fişte vergi no düşer). Sonuç fotoğrafla birlikte silinir.
 */
export async function extractImage<T>(req: ExtractCall<T> & { image: { bytes: Uint8Array; mediaType: AiImageType }; model?: AiModel }): Promise<AiResult<T>> {
  return extract({ ...req, model: req.model ?? AI_MODEL, keepResult: true });
}

/**
 * Faturayı okur (Claude Haiku 5.5; PDF ya da faturanın görseli): fotoğrafla aynı kapılar (anahtar, Ayarlar › Fotoğraftan
 * okuma, günlük sınır) ve günlük; fotoğraf başına sınır yok ("Yeniden oku" da sınıra sayılır). Okuma ai_calls'a yazılmaz,
 * yalnız maliyet satırı: sonuç invoice_readings'te faturayla birlikte durur ve onunla silinir. Hata metinleri faturaya göre.
 */
export async function extractDocument<T>(
  req: Omit<ExtractCall<T>, "feature" | "photoId"> & {
    input: { document: { bytes: Uint8Array; mediaType: AiDocumentType } } | { image: { bytes: Uint8Array; mediaType: AiImageType } };
    totalMs?: number;
  },
): Promise<AiResult<T>> {
  const { input, ...rest } = req;
  return extract({ ...rest, ...(input as AiInput), feature: "fatura", photoId: null, model: AI_INVOICE_MODEL, keepResult: false });
}

/**
 * Yöneticinin yazdığı metni vardiya atamalarına çevirir (Claude Opus 5.5, yalnız metin; src/lib/vardiya-taslak.ts).
 * Kapılar okumayla aynı (anahtar, Ayarlar › Fotoğraftan okuma), günlük sınır ayrı (SHIFT_DRAFT_DAILY_CAP). Günlüğe
 * yalnız maliyet satırı düşer: yazılan metin, kişi adları ve yanıt hiçbir yere yazılmaz.
 */
export async function extractText<T>(req: Omit<ExtractCall<T>, "feature" | "photoId">): Promise<AiResult<T>> {
  return extract({ ...req, feature: SHIFT_FEATURE, photoId: null, model: AI_MODEL, keepResult: false });
}

/**
 * Paraşüt'te bekleyen ürünlerin bir partisi için hammadde önerisi (Claude Sonnet 5.5, yalnız metin; src/lib/product-match-ai.ts,
 * src/server/parasut/ai-match.ts). Kapılar okumayla aynı (anahtar, Ayarlar › Fotoğraftan okuma), günlük sınır ayrı
 * (MATCH_DAILY_CAP, parti başına bir çağrı). Sistem istemi (hammadde listesi, örnekler) önbelleğe yazılır. Günlüğe yalnız
 * maliyet satırı düşer (efor, süre, token, tutar): istem ve yanıt ai_calls'a yazılmaz (doğrulanmış öneriler
 * integration_state'te). Zaman aşımı sunucu günlüğüne eforla yazılır
 */
export async function extractMatch<T>(
  req: Omit<ExtractCall<T>, "feature" | "photoId" | "effort" | "timeouts" | "maxTokens" | "cacheSystem" | "exclusiveMs"> & {
    /** Toplam süre (varsayılan MATCH_TIMEOUTS.totalMs): eylemin başından geçen süre düşülür (parasut/ai-match.ts) */
    totalMs?: number;
  },
): Promise<AiResult<T>> {
  return extract({ ...req, ...MATCH_REQUEST, feature: MATCH_FEATURE, photoId: null, keepResult: false, exclusiveMs: MATCH_RUNNING_MS });
}

const SUBJECT: Partial<Record<AiFeature, AiSubject>> = { fatura: "fatura", [SHIFT_FEATURE]: "vardiya", [MATCH_FEATURE]: "eslestirme", [SCAN_FEATURE]: "tarama" };
const TAG: Record<AiSubject, string> = {
  foto: "[foto] okuma",
  fatura: "[fatura] okuma",
  vardiya: "[vardiya] taslak",
  eslestirme: "[eslestirme] öneri",
  asistan: "[asistan] soru",
  tarama: "[tarama] köşe",
};

async function extract<T>(req: ExtractCall<T> & AiInput & { model: AiModel; totalMs?: number; keepResult: boolean }): Promise<AiResult<T>> {
  const subject: AiSubject = SUBJECT[req.feature] ?? "foto";
  const tag = TAG[subject];
  const gate = (code: AiErrorCode, cap?: number): AiResult<T> => ({ ok: false, code, message: aiErrorText(code, cap, subject), callId: null });
  if (!aiConfigured()) return gate("nokey");
  const settings = await loadAiSettings();
  if (!settings.enabled) return gate("off");
  const db = getDb();
  // Fatura okumasının kendi havuzu (sınır Ayarlar'daki sayı): fotoğrafların sınırını yemez
  const ownCap = OWN_CAP[req.feature] ?? (req.feature === INVOICE_FEATURE ? settings.dailyCap : undefined);
  // Kapılar ve "running" satırı tek işlemde, sınırın danışma kilidiyle (kendi sınırı olan tür ya da okumalar): aynı anda
  // gelen iki istek sıraya girer, ikincisi ilkinin satırını görür; günlük sınır aşılmaz, "aynı anda tek istek"
  // (exclusiveMs) iki sekmeyi birden geçirmez. Kilit yalnız bu kısa işlemde tutulur, servis çağrısı işlemin dışında
  const opened = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-sinir:${ownCap !== undefined ? req.feature : "okuma"}`}))`);
    const since = dayStart(new Date());
    if (ownCap !== undefined) {
      if ((await featureCallsSince(req.feature, since, tx)) >= ownCap) return gate("cap", ownCap);
    } else if ((await readingsSince(since, tx)) >= settings.dailyCap) return gate("cap", settings.dailyCap);
    if (req.photoId !== null) {
      // Kodla okuma (OCR_MODEL) fotoğraf başına okuma sınırına sayılmaz
      const [row] = await tx
        .select({ n: count() })
        .from(s.aiCalls)
        .where(and(eq(s.aiCalls.photoId, req.photoId), ne(s.aiCalls.model, OCR_MODEL)));
      if ((row?.n ?? 0) >= MAX_READS_PER_PHOTO) return gate("photo-limit");
    }
    if (req.exclusiveMs) {
      const [row] = await tx
        .select({ n: count() })
        .from(s.aiCalls)
        .where(and(eq(s.aiCalls.feature, req.feature), eq(s.aiCalls.status, "running"), gte(s.aiCalls.at, new Date(Date.now() - req.exclusiveMs))));
      if ((row?.n ?? 0) > 0) return gate("busy");
    }
    // Efor yalnız açıkça seçilen istekte yazılır (yazarkasa Z'si, docs/planlar/okc-z.md §6.2; ürün önerisi, run.ts
    // MATCH_EFFORT): canlıda hangi isteğin hangi eforla yapıldığı, ne kadar sürdüğü ve tutarı görülsün. Ötekilerde boş
    // (modelin varsayılanı)
    const [row] = await tx
      .insert(s.aiCalls)
      .values({ feature: req.feature, model: req.model, effort: req.effort ?? null, status: "running", userId: req.userId, photoId: req.photoId })
      .returning({ id: s.aiCalls.id });
    return row;
  });
  if ("ok" in opened) return opened;
  const call = opened;
  const t0 = Date.now();
  const client = req.client ?? (replayEnabled() ? replayClient(req.feature) : liveClient());
  const res = await runExtraction(client, req);
  const ms = Date.now() - t0;
  const cost = res.usage ? costUsd(res.usage, req.model) : null;
  const common = {
    servedModel: res.servedModel,
    stopReason: res.stopReason,
    requestId: res.requestId,
    ms,
    inputTokens: cost?.inputTokens ?? 0,
    outputTokens: cost?.outputTokens ?? 0,
    cacheReadTokens: cost?.cacheReadTokens ?? 0,
    cacheWriteTokens: cost?.cacheWriteTokens ?? 0,
    costUsd: cost?.usd ?? 0,
    fallback: cost?.fallback ?? false,
  };
  if (cost && !cost.priceKnown) console.warn(`${tag}: fiyatı bilinmeyen model`, res.servedModel);
  if (!res.ok) {
    await db
      .update(s.aiCalls)
      .set({ ...common, status: STATUS[res.code] ?? "error", errorCode: res.code, error: res.detail.slice(0, 300) })
      .where(eq(s.aiCalls.id, call.id));
    // Yöneticinin bakması gerekenler günlüğe, API'nin hata metniyle (anahtar, görsel, belge, istem asla; aiAlertLog)
    const alert = aiAlertLog(req.feature, res);
    if (alert) console.error(tag, alert);
    else if (req.effort && res.code === "timeout") console.warn(tag, req.feature, `efor ${req.effort}`, res.code, ms);
    return { ok: false, code: res.code, message: subject === "foto" ? res.message : aiErrorText(res.code, undefined, subject), callId: call.id };
  }
  await db
    .update(s.aiCalls)
    .set({ ...common, status: "ok", result: req.keepResult ? ((req.stored ? req.stored(res.data) : res.data) as object) : null })
    .where(eq(s.aiCalls.id, call.id));
  return { ok: true, data: res.data, callId: call.id, ms, costUsd: common.costUsd, servedModel: res.servedModel ?? req.model, fallback: common.fallback };
}
