import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { and, count, eq, gte, ne, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { ASSISTANT_DAILY_CAP } from "@/lib/assistant/protocol";
import { OCR_MODEL, photoModelsOf, type PhotoModels } from "@/lib/photo-read/models";
import { MAX_READS_PER_PHOTO, type ReadingState } from "@/lib/photo-rules";
import { todayTR } from "@/lib/reminders";
import { SHIFT_DRAFT_DAILY_CAP } from "@/lib/vardiya-taslak";
import { getDb, schema as s } from "@/server/db";

import { ASSISTANT_EFFORT, ASSISTANT_MODEL, type AssistantClient, type AssistantOutcome } from "./assistant/loop";
import { costUsd } from "./pricing";
import { replayAssistantClient, replayClient, replayEnabled } from "./replay";
import {
  AI_INVOICE_MODEL,
  AI_MODEL,
  aiAlertLog,
  aiErrorText,
  runExtraction,
  type AiClient,
  type AiDocumentType,
  type AiEffort,
  type AiErrorCode,
  type AiFeature,
  type AiImageType,
  type AiInput,
  type AiModel,
  type AiTimeouts,
} from "./run";

/*
 * Fotoğraftan ve faturadan okumanın kapısı (Claude): anahtar var mı, ayar açık mı, bugünkü sınır doldu mu, fotoğraf kaç
 * kez okundu. Her çağrı ai_calls'a yazılır (önce "running": aynı anda gelen iki okuma sınırı bir kez aşabilir, çökme de
 * kalır); görüntü, PDF ve istem hiçbir yere yazılmaz. Anahtar (ANTHROPIC_API_KEY) yalnız sunucuda: sayfalar yalnız
 * aiStatus().state alır. Anahtar yoksa (yerelde, önizlemelerde) fotoğraf yine eklenir, rakamlar elle yazılır
 * (docs/FOTOGRAF.md); fatura okunmaz, kart bugünkü gibi kalır (docs/FATURA-OKUMA.md).
 */

export { AI_INVOICE_MODEL, AI_MODEL, type AiErrorCode, type AiFeature } from "./run";

export interface AiSettings {
  enabled: boolean;
  /** Günde en çok okuma (0: hiç) */
  dailyCap: number;
  /**
   * LafPOS gününün gün sonu fotoğrafını okuyan modeller (src/lib/photo-read/models.ts): önce ucuz, gerekirse bir kez güçlü.
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
/** Panel asistanı (docs/ASISTAN.md): okuma sınırına sayılmaz, yönetici başına kendi sınırı vardır (ASSISTANT_DAILY_CAP) */
const ASSISTANT_FEATURE = "asistan" satisfies AiFeature;

/**
 * Okumalar (fotoğraf ve fatura): günlük sınır bunları sayar. Vardiya taslakları ve asistanın soruları sayılmaz (kasadaki
 * okumayı kesmesin); kodla okuma (OCR_MODEL, yapay zekâ değil, ücretsiz) da sayılmaz
 */
async function readingsSince(since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(s.aiCalls)
    .where(and(gte(s.aiCalls.at, since), notInArray(s.aiCalls.feature, [SHIFT_FEATURE, ASSISTANT_FEATURE]), ne(s.aiCalls.model, OCR_MODEL)));
  return row?.n ?? 0;
}

async function shiftDraftsSince(since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(s.aiCalls)
    .where(and(gte(s.aiCalls.at, since), eq(s.aiCalls.feature, SHIFT_FEATURE)));
  return row?.n ?? 0;
}

export type AiState = ReadingState;

/** Ekranlar için: okuma yapılabilir mi ve bugün kaç okuma yapıldı */
export async function aiStatus(now = new Date()): Promise<{ state: AiState; usedToday: number; cap: number }> {
  const [settings, usedToday] = await Promise.all([loadAiSettings(), readingsSince(dayStart(now))]);
  const state: AiState = !aiConfigured() ? "nokey" : !settings.enabled ? "off" : usedToday >= settings.dailyCap ? "cap" : "on";
  return { state, usedToday, cap: settings.dailyCap };
}

/**
 * Vardiya ekranı için: yazarak doldurma kullanılabilir mi. Anahtar ve Ayarlar › Fotoğraftan okuma anahtarı okumayla
 * ortaktır (kapalıyken hiçbir istek gitmez); günlük sınır ayrıdır (SHIFT_DRAFT_DAILY_CAP)
 */
export async function shiftDraftStatus(now = new Date()): Promise<{ state: AiState; usedToday: number; cap: number }> {
  if (!aiConfigured()) return { state: "nokey", usedToday: 0, cap: SHIFT_DRAFT_DAILY_CAP };
  const [settings, usedToday] = await Promise.all([loadAiSettings(), shiftDraftsSince(dayStart(now))]);
  const state: AiState = !settings.enabled ? "off" : usedToday >= SHIFT_DRAFT_DAILY_CAP ? "cap" : "on";
  return { state, usedToday, cap: SHIFT_DRAFT_DAILY_CAP };
}

/** Yöneticinin bugünkü asistan soruları (hata ve ret dahil: her soru bir satır) */
async function assistantCallsSince(userId: number, since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(s.aiCalls)
    .where(and(gte(s.aiCalls.at, since), eq(s.aiCalls.feature, ASSISTANT_FEATURE), eq(s.aiCalls.userId, userId)));
  return row?.n ?? 0;
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
 */
export async function startAssistantCall(userId: number, cap: number = ASSISTANT_DAILY_CAP, now: Date = new Date()): Promise<number | null> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ai_calls.asistan'), ${userId})`);
    const [row] = await tx
      .select({ n: count() })
      .from(s.aiCalls)
      .where(and(gte(s.aiCalls.at, dayStart(now)), eq(s.aiCalls.feature, ASSISTANT_FEATURE), eq(s.aiCalls.userId, userId)));
    if ((row?.n ?? 0) >= cap) return null;
    const [call] = await tx
      .insert(s.aiCalls)
      .values({ feature: ASSISTANT_FEATURE, model: ASSISTANT_MODEL, effort: ASSISTANT_EFFORT, status: "running", userId, photoId: null })
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

/** Ayarlar kartı: bu ayın çağrıları ve tutarı (dolar; vardiya taslakları ve asistan dahil), bugünün okumaları */
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

async function extract<T>(req: ExtractCall<T> & AiInput & { model: AiModel; totalMs?: number; keepResult: boolean }): Promise<AiResult<T>> {
  const subject = req.feature === "fatura" ? "fatura" : req.feature === SHIFT_FEATURE ? "vardiya" : "foto";
  const tag = subject === "vardiya" ? "[vardiya] taslak" : `[${subject}] okuma`;
  const gate = (code: AiErrorCode, cap?: number): AiResult<T> => ({ ok: false, code, message: aiErrorText(code, cap, subject), callId: null });
  if (!aiConfigured()) return gate("nokey");
  const settings = await loadAiSettings();
  if (!settings.enabled) return gate("off");
  const db = getDb();
  if (subject === "vardiya") {
    if ((await shiftDraftsSince(dayStart(new Date()))) >= SHIFT_DRAFT_DAILY_CAP) return gate("cap", SHIFT_DRAFT_DAILY_CAP);
  } else if ((await readingsSince(dayStart(new Date()))) >= settings.dailyCap) return gate("cap", settings.dailyCap);
  if (req.photoId !== null) {
    // Kodla okuma (OCR_MODEL) fotoğraf başına okuma sınırına sayılmaz
    const [row] = await db
      .select({ n: count() })
      .from(s.aiCalls)
      .where(and(eq(s.aiCalls.photoId, req.photoId), ne(s.aiCalls.model, OCR_MODEL)));
    if ((row?.n ?? 0) >= MAX_READS_PER_PHOTO) return gate("photo-limit");
  }
  // Efor yalnız açıkça seçilen okumada yazılır (yazarkasa Z'si; docs/planlar/okc-z.md §6.2): canlıda hangi okumanın hangi
  // eforla yapıldığı ve tutarı görülsün. Ötekilerde boş (modelin varsayılanı)
  const [call] = await db
    .insert(s.aiCalls)
    .values({ feature: req.feature, model: req.model, effort: req.effort ?? null, status: "running", userId: req.userId, photoId: req.photoId })
    .returning({ id: s.aiCalls.id });
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
