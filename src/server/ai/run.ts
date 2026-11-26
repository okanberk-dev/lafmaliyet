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
 * Yapılandırılmış çıktının karmaşıklık sınırını aşan şema (yazarkasa Z'si) `format` olmadan, metinde gider (JSON_REPLY).
 * Ürün → hammadde önerisi (Paraşüt, docs/PARASUT.md § 5e): claude-sonnet-5-5, efor "medium", yedek model ("default"),
 * yalnız metin; uzun ve sabit sistem istemi (talimat, hammadde listesi, örnek bağlantılar) önbelleğe yazılır
 * (`cacheSystem`), aynı oturumdaki ikinci parti onu okur.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

import { claudeSchema, fitsStructuredOutputs } from "@/lib/photo-read/claude-schema";

import type { UsageLike } from "./pricing";

export const AI_MODEL = "claude-opus-5-5";
/** Fatura okuma: sahibin istediği hızlı ve ucuz model (temiz e-fatura PDF'i için yeter) */
export const AI_INVOICE_MODEL = "claude-haiku-5-5";
/**
 * Ürün → hammadde önerisi: sahibin seçtiği model ("çok API yemeden Sonnet"). Opus 5.5'in yarı fiyatı, önbellek okuması
 * 0,10 $; 150 küsur hammadde arasında seçmek ve paket çarpanını hesaplamak için Haiku'dan güvenilir
 */
export const AI_MATCH_MODEL = "claude-sonnet-5-5";
export type AiModel = typeof AI_MODEL | typeof AI_INVOICE_MODEL | typeof AI_MATCH_MODEL;
/** Reddedilen okuma Anthropic'in önerdiği modelle yeniden denenir; reddedilmezse bedeli yok */
export const AI_FALLBACK_BETA = "server-side-fallback-2026-07-01";
/**
 * Modele göre istek: Opus 5.5 yedek modelli ve efor "low" (varsayılanı medium); Haiku 5.5'te sunucu tarafı yedek model
 * yok ("default" reddedileni reddedilmiş bırakır, model listesi 400), efor "medium" (varsayılanı, açıkça). Sonnet 5.5
 * yedek modelli ("default": cyber ve frontier_llm retlerini Claude Sonnet 5'te yeniden dener; dizi biçimi burada yalnız
 * claude-sonnet-5'i alırdı) ve efor "medium": modelin varsayılanı "high", sınıflandırma için önerilen başlangıç "low";
 * ama yanlış çarpan birim fiyatı ve bütün reçete maliyetlerini bozar, düşünme payı (paket × boyut hesabı, 150 küsur
 * hammadde arasında seçim) API tasarrufundan değerli. "high" daha uzun düşünür; 60 sn'lik sayfa süresine sığması
 * ölçülmedi, denenmez
 */
const MODEL_REQUEST: Record<AiModel, { fallback: boolean; effort: "low" | "medium" }> = {
  "claude-opus-5-5": { fallback: true, effort: "low" },
  "claude-haiku-5-5": { fallback: false, effort: "medium" },
  "claude-sonnet-5-5": { fallback: true, effort: "medium" },
};
/** Düşünme + JSON için pay; ölçülen çıktı 184–577 token */
export const AI_MAX_TOKENS = 6000;
/** Deneme başına 20 sn, bir yeniden deneme; ikisi birlikte en çok 45 sn (fotoğraf yolu 60 sn'de kesilir) */
export const AI_TIMEOUTS = { timeout: 20_000, maxRetries: 1, totalMs: 45_000 } as const;

export type AiEffort = "low" | "medium";
export interface AiTimeouts {
  /** Deneme başına (ms) */
  timeout: number;
  maxRetries: number;
  /** Bütün denemeler birlikte (ms): bu sinyal kesince yeniden deneme kalmaz */
  totalMs: number;
}

/**
 * Yazarkasanın mali Z'si (dalga 13 PR-b, docs/planlar/okc-z.md §4.4): efor "low" (öteki okumalarla aynı; "medium" yalnız
 * değerlendirme yanlış dolumu ve "doğrulandı ama yanlış"ı düşürür ve ilk okuma p90 ≤ 20 sn tutarsa), JSON daha uzun
 * olduğu için 8000 token ve tek 50 sn'lik deneme: SDK zaman aşımını da yeniden dener ama toplam sinyal 50 sn'de kestiği
 * için ona yer kalmaz; hızlı dönen hata (529, bağlantı) kalan süre içinde bir kez yeniden denenir. Yol 60 sn'de kesilir
 */
export const OKC_EFFORT: AiEffort = "low";
export const OKC_MAX_TOKENS = 8000;
export const OKC_TIMEOUTS: AiTimeouts = { timeout: 50_000, maxRetries: 1, totalMs: 50_000 };

/**
 * Ürün → hammadde önerisinin bir partisi (src/lib/product-match-ai.ts, 10 ürün): yanıt ürün başına ~50–60 token JSON +
 * düşünme; tahmin parti başına 1,5–4 bin token (canlıda ölçülmedi; ilk partilerde ai_calls'taki ms ve çıktı tokenına
 * bakılır). 16 000 token sığmazsa yarım kalır ("incomplete"). Tek 45 sn'lik deneme (yazarkasa Z'si gibi): hızlı dönen
 * hata kalan sürede bir kez yeniden denenir; en geç 45 sn'de kesilir. Kesilen çağrının kullanım bilgisi gelmez:
 * ai_calls'ta 0 $ görünür ama günlük sınırdan bir parti yer (servis yine ücretlendirebilir). Eylem ayrıca kendi
 * başından geçen süreyi düşer (ai-match.ts MATCH_BUDGET_MS): öncesindeki okumalar ve sonrasındaki saklama, günlük ve
 * yanıt sayfanın 60 sn'sine sığar
 */
export const MATCH_MAX_TOKENS = 16_000;
/**
 * Efor açıkça yazılır (MODEL_REQUEST'teki Sonnet 5.5 eforuyla aynı): ai_calls.effort'a düşer, zaman aşımı sunucu
 * günlüğüne eforla yazılır (claude.ts); canlıda partinin hangi eforla ne kadar sürdüğü görülür
 */
export const MATCH_EFFORT: AiEffort = "medium";
export const MATCH_TIMEOUTS: AiTimeouts = { timeout: 45_000, maxRetries: 1, totalMs: 45_000 };
/**
 * Ürün önerisinde "aynı anda tek istek" penceresi (claude.ts exclusiveMs): bundan yeni "running" satırı varsa başka
 * sekmede öneri sürüyor. En uzun çağrıdan (45 sn) ve sayfanın süresinden (60 sn) geniş: o süreyi aşan satır çökmüş
 * isteğin
 */
export const MATCH_RUNNING_MS = 70_000;
/** Ürün önerisi isteğinin sabit kısmı (claude.ts extractMatch; testte buildRequest'le biçimi sınanır) */
export const MATCH_REQUEST = { model: AI_MATCH_MODEL, effort: MATCH_EFFORT, maxTokens: MATCH_MAX_TOKENS, timeouts: MATCH_TIMEOUTS, cacheSystem: true } as const;

/**
 * ai_calls.feature: okumalar, vardiya taslağı, "eslestirme" (Paraşüt'te ürün → hammadde önerisi), "asistan" (panel
 * asistanı, src/server/ai/assistant) ve "tarama" (belge taramada köşe ipucu, src/lib/photo-read/scan-hint.ts); son üçü
 * okuma sınırına sayılmaz, kendi günlük sınırları var
 */
export type AiFeature = "kasa-z" | "kasa-pos" | "kasa-okc" | "fis" | "fatura" | "vardiya" | "eslestirme" | "asistan" | "tarama";
export type AiErrorCode =
  | "nokey"
  | "off"
  | "cap"
  | "photo-limit"
  | "busy"
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

/** Vardiyayı yazarak doldurmada yöneticinin göreceği metinler (docs/VARDIYA.md): her biri kutuları elle doldurmaya yollar */
const SHIFT_TEXT: Partial<Record<AiErrorCode, string>> = {
  nokey: "Yazarak doldurma bu ortamda kurulu değil; kutuları seçerek doldurun.",
  off: "Yazarak doldurma kapalı (Ayarlar › Fotoğraftan okuma); kutuları seçerek doldurun.",
  timeout: "Yanıt çok uzun sürdü. Yeniden deneyin ya da kutuları seçerek doldurun.",
  connection: "Servise ulaşılamadı. İnterneti kontrol edip yeniden deneyin.",
  rate: "Servis şu an yoğun. Biraz sonra yeniden deneyin.",
  overloaded: "Servis şu an yanıt vermiyor. Biraz sonra yeniden deneyin.",
  auth: "Servisin anahtarı geçersiz (ANTHROPIC_API_KEY); kutuları seçerek doldurun.",
  billing: "Servisin kredisi bitmiş; kutuları seçerek doldurun.",
  toolarge: "Metin çok uzun; kısaltıp yeniden deneyin.",
  badrequest: "Servis isteği kabul etmedi; kutuları seçerek doldurun.",
  refusal: "Bu metin işlenemedi; başka sözcüklerle yazın ya da kutuları seçerek doldurun.",
  incomplete: "Yanıt yarım kaldı. Daha kısa yazıp yeniden deneyin.",
  invalid: "Yanıt anlaşılamadı. Yeniden deneyin ya da kutuları seçerek doldurun.",
};

/** Panel asistanında yöneticinin göreceği metinler (docs/ASISTAN.md): yanıtın yerine ya da yarım yanıtın altında */
const ASSISTANT_TEXT: Partial<Record<AiErrorCode, string>> = {
  nokey: "Asistan bu ortamda kurulu değil (ANTHROPIC_API_KEY yok).",
  off: "Asistan kapalı: Ayarlar › Fotoğraftan okuma kapalıyken Claude'a hiçbir istek gitmez.",
  timeout: "Yanıt çok uzun sürdü. Soruyu daraltıp yeniden deneyin.",
  connection: "Servise ulaşılamadı. İnterneti kontrol edip yeniden deneyin.",
  rate: "Servis şu an yoğun. Biraz sonra yeniden deneyin.",
  overloaded: "Servis şu an yanıt vermiyor. Biraz sonra yeniden deneyin.",
  auth: "Servisin anahtarı geçersiz (ANTHROPIC_API_KEY); Vercel'deki anahtarı kontrol edin.",
  billing: "Servisin kredisi bitmiş; Anthropic hesabını kontrol edin.",
  toolarge: "Konuşma çok uzadı; Yeni sohbet başlatıp yeniden sorun.",
  badrequest: "Servis isteği kabul etmedi; Yeni sohbet başlatıp yeniden deneyin.",
  refusal: "Bu soruyu yanıtlayamıyorum; başka sözcüklerle sorabilirsiniz.",
  incomplete: "Yanıt yarım kaldı. Yeniden deneyin.",
  invalid: "Yanıt anlaşılamadı. Yeniden deneyin.",
};

/** Ürün → hammadde önerisinde yöneticinin göreceği metinler: her biri bugünkü sezgisel öneriye ve elle seçime yollar */
const MATCH_TEXT: Partial<Record<AiErrorCode, string>> = {
  nokey: "AI önerisi bu ortamda kurulu değil; hammaddeyi elle seçin.",
  off: "AI önerisi kapalı (Ayarlar › Fotoğraftan okuma); hammaddeyi elle seçin.",
  timeout: "AI yanıtı çok uzun sürdü. Yeniden deneyin ya da hammaddeyi elle seçin.",
  connection: "Servise ulaşılamadı. İnterneti kontrol edip yeniden deneyin.",
  rate: "Servis şu an yoğun. Biraz sonra yeniden deneyin.",
  overloaded: "Servis şu an yanıt vermiyor. Biraz sonra yeniden deneyin.",
  auth: "Servisin anahtarı geçersiz (ANTHROPIC_API_KEY); hammaddeyi elle seçin.",
  billing: "Servisin kredisi bitmiş; hammaddeyi elle seçin.",
  toolarge: "İstek çok büyük; yöneticiye haber verin.",
  badrequest: "Servis isteği kabul etmedi; hammaddeyi elle seçin.",
  refusal: "Bu ürünler için öneri alınamadı; hammaddeyi elle seçin.",
  incomplete: "AI yanıtı yarım kaldı. Yeniden deneyin.",
  invalid: "AI yanıtı anlaşılamadı. Yeniden deneyin ya da hammaddeyi elle seçin.",
  busy: "AI önerisi başka bir sekmede sürüyor; bitince sayfayı yenileyin.",
};

/** "tarama": köşe ipucu; metni ekrana çıkmaz (yapay zekâ yoksa tarama sessizce kodun sonucuyla sürer) */
export type AiSubject = "foto" | "fatura" | "vardiya" | "eslestirme" | "asistan" | "tarama";

/**
 * Personelin göreceği metinler (ayrıntı günlüğe gider, ekrana değil); fatura okumasında, vardiyada ve ürün önerisinde
 * yöneticinin göreceği; panel asistanında da yöneticinin
 */
export function aiErrorText(code: AiErrorCode, cap?: number, subject: AiSubject = "foto"): string {
  if (subject === "asistan") {
    if (code === "cap") return `Bugünkü soru sınırı doldu (${cap ?? "?"}); yarın yeniden açılır.`;
    const t = ASSISTANT_TEXT[code];
    if (t) return t;
  }
  if (subject === "fatura") {
    if (code === "cap") return `Bugünkü okuma sınırı doldu (${cap ?? "?"}); faturayı açıp bakın.`;
    const t = INVOICE_TEXT[code];
    if (t) return t;
  }
  if (subject === "vardiya") {
    if (code === "cap") return `Yazarak doldurmanın bugünkü sınırı doldu (${cap ?? "?"}); kutuları seçerek doldurun.`;
    const t = SHIFT_TEXT[code];
    if (t) return t;
  }
  if (subject === "eslestirme") {
    if (code === "cap") return `AI önerisinin bugünkü sınırı doldu (${cap ?? "?"} parti); hammaddeyi elle seçin.`;
    const t = MATCH_TEXT[code];
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
    case "busy":
      return "Başka bir okuma sürüyor; biraz sonra yeniden deneyin.";
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

/**
 * Okunacak tek girdi: görsel (fotoğraf, faturanın Paraşüt fotoğrafı) ya da PDF belge (e-fatura). Vardiyayı yazarak
 * doldurmada girdi yoktur: istek yalnız metindir (görev metni; src/lib/vardiya-taslak.ts)
 */
export type AiInput =
  | { image: { bytes: Uint8Array; mediaType: AiImageType }; document?: undefined }
  | { document: { bytes: Uint8Array; mediaType: AiDocumentType }; image?: undefined }
  | { image?: undefined; document?: undefined };

export type ExtractRequest<T> = AiInput & {
  /** Varsayılan AI_MODEL (fotoğraf) */
  model?: AiModel;
  system: string;
  task: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Varsayılan modelinki (MODEL_REQUEST); yalnız yazarkasa Z'si değiştirir (OKC_EFFORT) */
  effort?: AiEffort;
  /** Deneme süresi ve yeniden deneme (varsayılan AI_TIMEOUTS; yazarkasa Z'si OKC_TIMEOUTS) */
  timeouts?: AiTimeouts;
  /** Toplam süre (varsayılan `timeouts.totalMs`): faturada belge indirmesi de aynı sayfa süresine sığmalı */
  totalMs?: number;
  /**
   * Sistem istemi önbelleğe yazılsın (5 dakika; ürün önerisi): uzun ve partiden partiye aynı olan önek (talimat,
   * hammadde listesi, örnek bağlantılar) ikinci partide önbellekten okunur. Değişen kısım (ürünler) görev metninde
   */
  cacheSystem?: boolean;
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
 * Şema yapılandırılmış çıktının karmaşıklık sınırını aşınca (fitsStructuredOutputs: en çok 16 birleşim türlü
 * parametre; yazarkasa Z'sinin KasaOkcRaw'ı 42) `output_config.format` gönderilmez, gönderilirse API isteği 400 ile
 * reddeder. Şema görev metninin sonuna yazılır; yanıt yine zod'dan geçer, uymayan "invalid" olur.
 */
export const JSON_REPLY = (schema: Record<string, unknown>) =>
  `Reply with one JSON object and nothing else: no prose, no code fences. It must match this JSON Schema; include every property, and use null only where the schema allows it.\n${JSON.stringify(schema)}`;

/**
 * İsteğin kendisi (testte biçimi sınanır). Fotoğraf isteği alan alan ve sırasıyla canlıda denenen hâlidir; fatura
 * isteğinde yedek model alanları yok, belge görselin yerinde (PDF, metinden önce). Girdisiz istekte (vardiyayı yazarak
 * doldurma, ürün önerisi) içerik yalnız görev metnidir. Şema sınırı aşarsa `format` yok, şema görev metninde
 * (JSON_REPLY). `cacheSystem`: sistem istemi tek metin bloğu, sonunda önbellek işareti (sabit önek önde, değişen ürünler
 * sonda, işaretten sonra)
 */
export function buildRequest<T>(req: ExtractRequest<T>): { params: CreateParams; options: CreateOptions } {
  const model = req.model ?? AI_MODEL;
  const m = MODEL_REQUEST[model];
  const input = req.document
    ? ({ type: "document", source: { type: "base64", media_type: req.document.mediaType, data: base64(req.document.bytes) } } as const)
    : req.image
      ? ({ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: base64(req.image.bytes) } } as const)
      : null;
  const schema = claudeSchema(req.schema);
  const structured = fitsStructuredOutputs(schema);
  const effort = req.effort ?? m.effort;
  const params: CreateParams = {
    model,
    max_tokens: req.maxTokens ?? AI_MAX_TOKENS,
    ...(m.fallback ? { betas: [AI_FALLBACK_BETA], fallbacks: "default" as const } : {}),
    output_config: structured ? { effort, format: { type: "json_schema", schema } } : { effort },
    system: req.cacheSystem ? [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }] : req.system,
    messages: [{ role: "user", content: [...(input ? [input] : []), { type: "text" as const, text: structured ? req.task : `${req.task}\n\n${JSON_REPLY(schema)}` }] }],
  };
  const t = req.timeouts ?? AI_TIMEOUTS;
  return { params, options: { timeout: t.timeout, maxRetries: t.maxRetries, signal: AbortSignal.timeout(req.totalMs ?? t.totalMs) } };
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
 * API hatasının kendi türü ve metni. SDK'nın `message`'ı yanıt gövdesinin JSON'udur (`400 {"type":"error","error":
 * {"type":…,"message":…},"request_id":…}`; gövde JSON değilse yanıtın metni): isteğin hiçbir parçasını (görsel, istem,
 * şema, anahtar) taşımaz. Yine de yalnız ayrıştırılmış `error.type` ve `error.message` alınır: 300 karaktere neden sığar.
 */
function apiErrorText(e: InstanceType<typeof Anthropic.APIError>): string {
  const message = (e.error as { error?: { message?: unknown } } | undefined)?.error?.message;
  if (typeof message !== "string") return e.message;
  return typeof e.type === "string" && e.type ? `${e.type}: ${message}` : message;
}

/**
 * SDK hatası → kod, en özelden genele. Bizim toplam süre sinyalimiz (45 sn; yazarkasa Z'sinde 50 sn) kesince SDK APIUserAbortError atar (zaman aşımı);
 * bağlantı zaman aşımı bağlantı hatasının alt türüdür, önce bakılır. Ayrıntı: sınıf, durum ve API'nin hata metni.
 */
export function mapAiError(e: unknown): { code: AiErrorCode; status: number | null; requestId: string | null; detail: string } {
  const status = e instanceof Anthropic.APIError && typeof e.status === "number" ? e.status : null;
  const requestId = e instanceof Anthropic.APIError ? (e.requestID ?? null) : null;
  const text = e instanceof Anthropic.APIError ? apiErrorText(e) : e instanceof Error ? e.message : String(e);
  const detail = `${e instanceof Error ? e.constructor.name : "Hata"}${status ? ` ${status}` : ""}: ${text}`.slice(0, 300);
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

/** Sunucu günlüğüne düşen, yöneticinin bakması gereken hatalar: anahtar, kredi, reddedilen istek */
const ALERT_CODES: readonly AiErrorCode[] = ["auth", "billing", "badrequest"];

/**
 * Bu hatalar için günlük satırı (src/server/ai/claude.ts): okuma türü, kod, durum, Anthropic'in istek kimliği ve
 * API'nin hata metni (mapAiError'ın ayrıntısı, en çok 300 karakter). Görsel, belge, istem ve anahtar asla; öteki
 * kodlarda null
 */
export function aiAlertLog(feature: AiFeature, res: { code: AiErrorCode; status: number | null; requestId: string | null; detail: string }): string | null {
  if (!ALERT_CODES.includes(res.code)) return null;
  return `${feature} ${res.code} ${res.status ?? "-"} ${res.requestId ?? "-"} · ${res.detail}`;
}

/** Metindeki JSON nesnesi: önce olduğu gibi, olmazsa ilk `{` ile son `}` arası (kod çiti, baştaki ya da sondaki cümle) */
function looseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw e;
    return JSON.parse(text.slice(start, end + 1));
  }
}

/**
 * Görseli ya da belgeyi okur. Ret (refusal) içerik okunmadan döner; yarım kalan yanıt "incomplete"; JSON ya da şema tutmazsa
 * "invalid" (ilk zod sorununun yolu ayrıntıya). Yedek model çalıştıysa içeriğin başında bir `fallback` bloğu olur:
 * bloklar sırasına göre değil türüne göre okunur. `format`suz istekte (JSON_REPLY) yanıt kod çiti ya da çevresinde
 * metinle gelebilir: ilk `{` ile son `}` arası okunur.
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
    json = params.output_config?.format ? JSON.parse(text) : looseJson(text);
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
