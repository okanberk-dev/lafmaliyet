import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { count, eq, gte, sql } from "drizzle-orm";
import type { z } from "zod";

import { MAX_READS_PER_PHOTO, type ReadingState } from "@/lib/photo-rules";
import { todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";

import { costUsd } from "./pricing";
import { replayClient, replayEnabled } from "./replay";
import {
  AI_INVOICE_MODEL,
  AI_MODEL,
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
}

export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: true, dailyCap: 40 };
const SETTINGS_KEY = "ai.settings";

export async function loadAiSettings(): Promise<AiSettings> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, SETTINGS_KEY)).limit(1);
  const v = (row?.value as Partial<AiSettings> | undefined) ?? {};
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_AI_SETTINGS.enabled,
    dailyCap: typeof v.dailyCap === "number" && Number.isInteger(v.dailyCap) && v.dailyCap >= 0 ? v.dailyCap : DEFAULT_AI_SETTINGS.dailyCap,
  };
}

export async function saveAiSettings(value: AiSettings): Promise<void> {
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

async function readingsSince(since: Date): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(s.aiCalls).where(gte(s.aiCalls.at, since));
  return row?.n ?? 0;
}

export type AiState = ReadingState;

/** Ekranlar için: okuma yapılabilir mi ve bugün kaç okuma yapıldı */
export async function aiStatus(now = new Date()): Promise<{ state: AiState; usedToday: number; cap: number }> {
  const [settings, usedToday] = await Promise.all([loadAiSettings(), readingsSince(dayStart(now))]);
  const state: AiState = !aiConfigured() ? "nokey" : !settings.enabled ? "off" : usedToday >= settings.dailyCap ? "cap" : "on";
  return { state, usedToday, cap: settings.dailyCap };
}

/** Ayarlar kartı: bu ayın ve bugünün okumaları, bu ayın tutarı (dolar) */
export async function aiUsageSummary(now = new Date()): Promise<{ monthCalls: number; monthUsd: number; today: number }> {
  const [[month], today] = await Promise.all([
    getDb()
      .select({ n: count(), usd: sql<number>`coalesce(sum(${s.aiCalls.costUsd}), 0)`.mapWith(Number) })
      .from(s.aiCalls)
      .where(gte(s.aiCalls.at, monthStart(now))),
    readingsSince(dayStart(now)),
  ]);
  return { monthCalls: month?.n ?? 0, monthUsd: month?.usd ?? 0, today };
}

export type AiResult<T> =
  | { ok: true; data: T; callId: number; ms: number; costUsd: number; servedModel: string; fallback: boolean }
  | { ok: false; code: AiErrorCode; message: string; callId: number | null };

const STATUS: Partial<Record<AiErrorCode, "refusal" | "incomplete" | "invalid">> = { refusal: "refusal", incomplete: "incomplete", invalid: "invalid" };

interface ExtractCall<T> {
  feature: AiFeature;
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
}

/**
 * Görseli okur ve sonucu günlüğe yazar. Kapılar sırayla: anahtar, ayar, bugünkü sınır, fotoğraf başına 3 okuma.
 * Doğrulanmış okuma ai_calls.result'ta saklanır (karşılaştırmalar istemcinin gönderdiğine değil buna bakar);
 * `stored` saklanacak hâlini verir (ör. fişte vergi no düşer). Sonuç fotoğrafla birlikte silinir.
 */
export async function extractImage<T>(req: ExtractCall<T> & { image: { bytes: Uint8Array; mediaType: AiImageType } }): Promise<AiResult<T>> {
  return extract({ ...req, model: AI_MODEL, keepResult: true });
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

async function extract<T>(req: ExtractCall<T> & AiInput & { model: AiModel; totalMs?: number; keepResult: boolean }): Promise<AiResult<T>> {
  const subject = req.feature === "fatura" ? "fatura" : "foto";
  const tag = `[${subject}] okuma`;
  const gate = (code: AiErrorCode, cap?: number): AiResult<T> => ({ ok: false, code, message: aiErrorText(code, cap, subject), callId: null });
  if (!aiConfigured()) return gate("nokey");
  const settings = await loadAiSettings();
  if (!settings.enabled) return gate("off");
  const db = getDb();
  if ((await readingsSince(dayStart(new Date()))) >= settings.dailyCap) return gate("cap", settings.dailyCap);
  if (req.photoId !== null) {
    const [row] = await db.select({ n: count() }).from(s.aiCalls).where(eq(s.aiCalls.photoId, req.photoId));
    if ((row?.n ?? 0) >= MAX_READS_PER_PHOTO) return gate("photo-limit");
  }
  // TODO(dalga 13 b4): ai_calls.effort sütunu migration'la gelince `effort: req.effort ?? null` burada yazılır
  // (docs/planlar/okc-z.md §6.2); o zamana kadar efor yalnız koddadır ve hata günlüğüne düşer
  const [call] = await db.insert(s.aiCalls).values({ feature: req.feature, model: req.model, status: "running", userId: req.userId, photoId: req.photoId }).returning({ id: s.aiCalls.id });
  const t0 = Date.now();
  const client = replayEnabled() ? replayClient(req.feature) : liveClient();
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
    // Yöneticinin bakması gerekenler günlüğe (anahtar, görsel, belge, istem asla)
    if (res.code === "auth" || res.code === "billing" || res.code === "badrequest") console.error(tag, res.code, res.status, res.requestId);
    else if (req.effort && res.code === "timeout") console.warn(tag, req.feature, `efor ${req.effort}`, res.code, ms);
    return { ok: false, code: res.code, message: subject === "fatura" ? aiErrorText(res.code, undefined, subject) : res.message, callId: call.id };
  }
  await db
    .update(s.aiCalls)
    .set({ ...common, status: "ok", result: req.keepResult ? ((req.stored ? req.stored(res.data) : res.data) as object) : null })
    .where(eq(s.aiCalls.id, call.id));
  return { ok: true, data: res.data, callId: call.id, ms, costUsd: common.costUsd, servedModel: res.servedModel ?? req.model, fallback: common.fallback };
}
