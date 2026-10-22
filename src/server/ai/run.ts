/**
 * Claude ile tek görselden yapılandırılmış okuma: istek, yanıtın denetimi ve hataların Türkçe karşılığı. Veritabanı
 * ve "server-only" yok: istemci dışarıdan verilir (tests/ai-istemci.test.ts sahte istemciyle sınar; geliştirmede
 * kayıtlı yanıtlar, src/server/ai/replay.ts). Günlük sınır, açma / kapama ve maliyet günlüğü src/server/ai/claude.ts'te.
 *
 * İstek (canlıda denendi, docs/planlar/fotograf.md §10): claude-opus-5-5, efor "low", JSON şemalı çıktı, base64 görsel,
 * reddedilirse sunucu tarafında yedek model (fallbacks "default"). Gönderilmeyenler: `thinking` (bu modelde düşünme
 * hep açık; kapatmak 400), temperature / top_p / top_k (400) ve asistan ön doldurması (400).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

import { claudeSchema } from "@/lib/photo-read/claude-schema";

import type { UsageLike } from "./pricing";

export const AI_MODEL = "claude-opus-5-5";
/** Reddedilen okuma Anthropic'in önerdiği modelle yeniden denenir; reddedilmezse bedeli yok */
export const AI_FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Düşünme + JSON için pay; ölçülen çıktı 184–577 token */
export const AI_MAX_TOKENS = 6000;
/** Deneme başına 20 sn, bir yeniden deneme; ikisi birlikte en çok 45 sn (fotoğraf yolu 60 sn'de kesilir) */
export const AI_TIMEOUTS = { timeout: 20_000, maxRetries: 1, totalMs: 45_000 } as const;

export type AiFeature = "kasa-z" | "kasa-pos" | "fis";
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

/** Personelin göreceği metinler (ayrıntı günlüğe gider, ekrana değil) */
export function aiErrorText(code: AiErrorCode, cap?: number): string {
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

export interface ExtractRequest<T> {
  image: { bytes: Uint8Array; mediaType: AiImageType };
  system: string;
  task: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

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

/** İsteğin kendisi (testte biçimi sınanır) */
export function buildRequest<T>(req: ExtractRequest<T>): { params: CreateParams; options: CreateOptions } {
  const params: CreateParams = {
    model: AI_MODEL,
    max_tokens: req.maxTokens ?? AI_MAX_TOKENS,
    betas: [AI_FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: claudeSchema(req.schema) } },
    system: req.system,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: req.image.mediaType, data: Buffer.from(req.image.bytes).toString("base64") } },
          { type: "text", text: req.task },
        ],
      },
    ],
  };
  return { params, options: { timeout: AI_TIMEOUTS.timeout, maxRetries: AI_TIMEOUTS.maxRetries, signal: AbortSignal.timeout(AI_TIMEOUTS.totalMs) } };
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
 * Görseli okur. Ret (refusal) içerik okunmadan döner; yarım kalan yanıt "incomplete"; JSON ya da şema tutmazsa
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
