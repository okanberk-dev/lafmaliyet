/**
 * Claude ile tek görselden ya da PDF'ten yapılandırılmış okuma: istek, yanıtın denetimi ve hataların Türkçe karşılığı.
 * Veritabanı ve "server-only" yok: istemci dışarıdan verilir (tests/ai-istemci.test.ts sahte istemciyle sınar;
 * geliştirmede kayıtlı yanıtlar, src/server/ai/replay.ts). Günlük sınır, açma / kapama ve maliyet günlüğü
 * src/server/ai/claude.ts'te.
 *
 * Fotoğraf isteği (canlıda denendi, docs/planlar/fotograf.md §10): claude-opus-5-5, efor "low", JSON şemalı çıktı, base64
 * görsel, reddedilirse sunucu tarafında yedek model (fallbacks "default"). Fatura isteği (docs/FATURA-OKUMA.md):
 * claude-haiku-5-5, efor "medium" (modelin varsayılanı, açıkça yazılır), PDF belge ya da görsel; Haiku 5.5'te sunucu
 * tarafı yedek model yok, `fallbacks` gönderilmez. İkisinde de gönderilmeyenler: `thinking` (iki modelde de düşünme
 * uyarlamalı ve varsayılan; Opus 5.5'te kapatmak 400), temperature / top_p / top_k (400) ve asistan ön doldurması (400).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

import { claudeSchema } from "@/lib/photo-read/claude-schema";

import type { UsageLike } from "./pricing";

export const AI_MODEL = "claude-opus-5-5";
/** Fatura okuma: sahibin istediği hızlı ve ucuz model (temiz e-fatura PDF'i için yeter) */
export const AI_INVOICE_MODEL = "claude-haiku-5-5";
export type AiModel = typeof AI_MODEL | typeof AI_INVOICE_MODEL;
/** Reddedilen okuma Anthropic'in önerdiği modelle yeniden denenir; reddedilmezse bedeli yok */
export const AI_FALLBACK_BETA = "server-side-fallback-2026-07-01";
/**
 * Modele göre istek: Opus 5.5 yedek modelli ve efor "low" (varsayılanı medium); Haiku 5.5'te sunucu tarafı yedek model
 * yok ("default" reddedileni reddedilmiş bırakır, model listesi 400), efor "medium" (varsayılanı, açıkça)
 */
const MODEL_REQUEST: Record<AiModel, { fallback: boolean; effort: "low" | "medium" }> = {
  "claude-opus-5-5": { fallback: true, effort: "low" },
  "claude-haiku-5-5": { fallback: false, effort: "medium" },
};
/** Düşünme + JSON için pay; ölçülen çıktı 184–577 token */
export const AI_MAX_TOKENS = 6000;
/** Deneme başına 20 sn, bir yeniden deneme; ikisi birlikte en çok 45 sn (fotoğraf yolu 60 sn'de kesilir) */
export const AI_TIMEOUTS = { timeout: 20_000, maxRetries: 1, totalMs: 45_000 } as const;

export type AiFeature = "kasa-z" | "kasa-pos" | "fis" | "fatura";
export type AiErrorCode =
  | "nokey"
  | "off"
  | "cap"
  | "photo-limit"
  | "timeout"
  | "connection"
  | "rate"
  | "overloaded"
  | "auth"
  | "billing"
  | "toolarge"
  | "badrequest"
  | "refusal"
  | "incomplete"
  | "invalid";

/** Fatura okumasında fotoğrafa özgü metinlerin yerine geçenler (yöneticinin göreceği; ortak olanlar aynı) */
const INVOICE_TEXT: Partial<Record<AiErrorCode, string>> = {
  nokey: "Faturadan okuma bu ortamda kurulu değil; faturayı açıp bakın.",
  off: "Okuma kapalı (Ayarlar › Fotoğraftan okuma); faturayı açıp bakın.",
  timeout: "Okuma çok uzun sürdü. Yeniden deneyin ya da faturayı açıp bakın.",
  toolarge: "Fatura belgesi okunamayacak kadar büyük; faturayı açıp bakın.",
  badrequest: "Fatura okunamadı (servis isteği kabul etmedi); faturayı açıp bakın.",
  refusal: "Bu fatura okunamadı; faturayı açıp bakın.",
  invalid: "Faturadaki bilgi güvenilir okunamadı; faturayı açıp bakın.",
};

/** Personelin göreceği metinler (ayrıntı günlüğe gider, ekrana değil); fatura okumasında yöneticinin göreceği */
export function aiErrorText(code: AiErrorCode, cap?: number, subject: "foto" | "fatura" = "foto"): string {
  if (subject === "fatura") {
    if (code === "cap") return `Bugünkü okuma sınırı doldu (${cap ?? "?"}); faturayı açıp bakın.`;
    const t = INVOICE_TEXT[code];
    if (t) return t;
  }
  switch (code) {
    case "nokey":
      return "Fotoğraftan okuma bu ortamda kurulu değil; rakamları elle yazın.";
    case "off":
      return "Fotoğraftan okuma kapalı; rakamları elle yazın.";
    case "cap":
      return `Bugünkü okuma sınırı doldu (${cap ?? "?"}). Fotoğraf eklendi; rakamları elle yazın.`;
    case "photo-limit":
      return "Bu fotoğraf 3 kez okundu; yeni bir fotoğraf çekin ya da elle yazın.";
    case "timeout":
      return "Okuma çok uzun sürdü. Yeniden deneyin ya da elle yazın.";
    case "connection":
      return "Okuma servisine ulaşılamadı. İnterneti kontrol edip yeniden deneyin.";
    case "rate":
      return "Okuma servisi şu an yoğun. Biraz sonra yeniden deneyin.";
    case "overloaded":
      return "Okuma servisi şu an yanıt vermiyor. Biraz sonra yeniden deneyin.";
    case "auth":
      return "Okuma servisinin anahtarı geçersiz; yöneticiye haber verin.";
    case "billing":
      return "Okuma servisinin kredisi bitmiş; yöneticiye haber verin.";
    case "toolarge":
      return "Fotoğraf çok büyük; yeniden çekin.";
    case "badrequest":
      return "Fotoğraf okunamadı (servis isteği kabul etmedi). Rakamları elle yazın.";
    case "refusal":
      return "Bu fotoğraf okunamadı. Rakamları elle yazın.";
    case "incomplete":
      return "Okuma yarım kaldı. Yeniden deneyin.";
    case "invalid":
      return "Fotoğraftaki rakamlar güvenilir okunamadı. Elle yazın.";
  }
}

/** Yeniden denemenin anlamlı olduğu hatalar ("Yeniden dene" düğmesi) */
export const RETRYABLE: readonly AiErrorCode[] = ["timeout", "connection", "rate", "overloaded", "incomplete"];

export type AiImageType = "image/jpeg" | "image/png" | "image/webp";
export type AiDocumentType = "application/pdf";

/** Okunacak tek girdi: görsel (fotoğraf, faturanın Paraşüt fotoğrafı) ya da PDF belge (e-fatura) */
export type AiInput = { image: { bytes: Uint8Array; mediaType: AiImageType }; document?: undefined } | { document: { bytes: Uint8Array; mediaType: AiDocumentType }; image?: undefined };

export type ExtractRequest<T> = AiInput & {
  /** Varsayılan AI_MODEL (fotoğraf) */
  model?: AiModel;
  system: string;
  task: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Toplam süre (varsayılan 45 sn): faturada belge indirmesi de aynı sayfa süresine sığmalı */
  totalMs?: number;
};

/** Yanıtın kullandığımız kısmı (SDK'nın BetaMessage'ı buna uyar) */
export interface AiMessage {
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string }[];
  usage: UsageLike;
  _request_id?: string | null;
}

export type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export interface CreateOptions {
  timeout: number;
  maxRetries: number;
  signal: AbortSignal;
}

/** Okumada kullanılan istemci: gerçek SDK, testte sahte, geliştirmede kayıtlı yanıtlar */
export interface AiClient {
  beta: { messages: { create(params: CreateParams, options: CreateOptions): PromiseLike<AiMessage> } };
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * İsteğin kendisi (testte biçimi sınanır). Fotoğraf isteği alan alan ve sırasıyla canlıda denenen hâlidir; fatura
 * isteğinde yedek model alanları yok, belge görselin yerinde (PDF, metinden önce).
 */
export function buildRequest<T>(req: ExtractRequest<T>): { params: CreateParams; options: CreateOptions } {
  const model = req.model ?? AI_MODEL;
  const m = MODEL_REQUEST[model];
  const input = req.document
    ? ({ type: "document", source: { type: "base64", media_type: req.document.mediaType, data: base64(req.document.bytes) } } as const)
    : ({ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: base64(req.image.bytes) } } as const);
  const params: CreateParams = {
    model,
    max_tokens: req.maxTokens ?? AI_MAX_TOKENS,
    ...(m.fallback ? { betas: [AI_FALLBACK_BETA], fallbacks: "default" as const } : {}),
    output_config: { effort: m.effort, format: { type: "json_schema", schema: claudeSchema(req.schema) } },
    system: req.system,
    messages: [{ role: "user", content: [input, { type: "text", text: req.task }] }],
  };
  return { params, options: { timeout: AI_TIMEOUTS.timeout, maxRetries: AI_TIMEOUTS.maxRetries, signal: AbortSignal.timeout(req.totalMs ?? AI_TIMEOUTS.totalMs) } };
}

export interface RunMeta {
  usage: UsageLike | null;
  servedModel: string | null;
  stopReason: string | null;
  requestId: string | null;
}

export type RunResult<T> =
  | ({ ok: true; data: T } & RunMeta)
  | ({ ok: false; code: AiErrorCode; message: string; status: number | null; detail: string } & RunMeta);

const NO_META: RunMeta = { usage: null, servedModel: null, stopReason: null, requestId: null };

/**
 * SDK hatası → kod, en özelden genele. Bizim 45 sn sinyalimiz kesince SDK APIUserAbortError atar (zaman aşımı);
 * bağlantı zaman aşımı bağlantı hatasının alt türüdür, önce bakılır.
 */
export function mapAiError(e: unknown): { code: AiErrorCode; status: number | null; requestId: string | null; detail: string } {
  const status = e instanceof Anthropic.APIError && typeof e.status === "number" ? e.status : null;
  const requestId = e instanceof Anthropic.APIError ? (e.requestID ?? null) : null;
  const detail = `${e instanceof Error ? e.constructor.name : "Hata"}${status ? ` ${status}` : ""}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
  const out = (code: AiErrorCode) => ({ code, status, requestId, detail });
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) return out("timeout");
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return out("timeout");
  if (e instanceof Anthropic.APIConnectionError) return out("connection");
  if (e instanceof Anthropic.RateLimitError) return out("rate");
  if (e instanceof Anthropic.InternalServerError) return out("overloaded");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return out("auth");
  if (e instanceof Anthropic.APIError && e.status === 402) return out("billing");
  if (e instanceof Anthropic.APIError && e.status === 413) return out("toolarge");
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) return out("badrequest");
  if (e instanceof Anthropic.APIError) return out(status !== null && status >= 500 ? "overloaded" : "badrequest");
  return out("connection");
}

/**
 * Görseli ya da belgeyi okur. Ret (refusal) içerik okunmadan döner; yarım kalan yanıt "incomplete"; JSON ya da şema tutmazsa
 * "invalid" (ilk zod sorununun yolu ayrıntıya). Yedek model çalıştıysa içeriğin başında bir `fallback` bloğu olur:
 * bloklar sırasına göre değil türüne göre okunur.
 */
export async function runExtraction<T>(client: AiClient, req: ExtractRequest<T>): Promise<RunResult<T>> {
  const { params, options } = buildRequest(req);
  let res: AiMessage;
  try {
    res = await client.beta.messages.create(params, options);
  } catch (e) {
    const m = mapAiError(e);
    return { ok: false, code: m.code, message: aiErrorText(m.code), status: m.status, detail: m.detail, ...NO_META, requestId: m.requestId };
  }
  const meta: RunMeta = { usage: res.usage ?? null, servedModel: res.model ?? null, stopReason: res.stop_reason ?? null, requestId: res._request_id ?? null };
  const fail = (code: AiErrorCode, detail: string): RunResult<T> => ({ ok: false, code, message: aiErrorText(code), status: null, detail: detail.slice(0, 300), ...meta });
  if (res.stop_reason === "refusal") return fail("refusal", `refusal${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}`);
  if (res.stop_reason === "max_tokens") return fail("incomplete", "max_tokens");
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("invalid", `JSON okunamadı (${text.length} karakter)`);
  }
  const parsed = req.schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("invalid", `Şema tutmadı: ${issue?.path.join(".") || "(kök)"} ${issue?.message ?? ""}`);
  }
  return { ok: true, data: parsed.data, ...meta };
}
