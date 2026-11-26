/**
 * Resend'e tek iletinin gönderimi: deneme sayısı, deneme başına süre, işin son anı ve yeniden denemeler. Ortam değişkeni
 * okumaz, "server-only" yok: anahtar dışarıdan gelir, ağ ve saat değiştirilebilir (tests/eposta-gonderimi.test.ts
 * sahte fetch ve saatle sınar). Anahtarı ve gönderen sırasını resend.ts verir (sendEmail).
 */

/** E-posta eki (ör. gün sonu fotoğrafı); Resend'e base64 gider */
export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

export interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
  attachments?: EmailAttachment[];
}

/** İsteğin gövdesi (ekler base64); saf, testli */
export function emailPayload(msg: EmailMessage): Record<string, unknown> {
  const attachments = msg.attachments?.length
    ? msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64"), ...(a.contentType ? { content_type: a.contentType } : {}) }))
    : undefined;
  return { from: msg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, ...(attachments ? { attachments } : {}) };
}

/**
 * Gönderim seçenekleri; verilmeyen bugünkü davranıştır (SEND_DEFAULTS): 3 deneme, deneme başına 15 sn, denemeler
 * arasında 2 ve 4 sn. `deadlineAt` (Date.now() cinsinden an) verilirse hiçbir deneme o andan sonraya taşmaz ve kalan
 * süre MIN_ATTEMPT_MS'den azsa yeni deneme başlamaz (sabah işi: jobStart + 48 sn, src/server/jobs/capped.ts).
 */
export interface SendOptions {
  timeoutMs?: number;
  attempts?: number;
  deadlineAt?: number;
}

/**
 * `uncertain`: ileti Resend'e ulaşmış olabilir (deneme zaman aşımına uğradı, ağ hatası verdi ya da 409 aldı: aynı
 * anahtarlı istek işleniyor) ve sonraki bir yanıt bunu çürütmedi (429 ve 5xx çürütmez; öteki 4xx çürütür: o ileti ilk
 * seferde de reddedilirdi). Çağıran "gitmedi" sayıp başka bir anahtarla yeniden göndermemeli.
 */
export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; uncertain?: true };

/** Belirsiz gönderimin ekrandaki metni: ham hata ("…aborted due to timeout") "gitmedi" diye okunur, oysa gitmiş olabilir */
export const UNCERTAIN_SEND_TEXT = "Resend yanıt vermedi; e-posta yine de gitmiş olabilir.";

/**
 * Başarısız gönderimin günlüğe, bildirime ve iş kaydına yazılan metni: belirsizse UNCERTAIN_SEND_TEXT, değilse hatanın
 * kendisi (resendErrorText'in Türkçesi). Ham hatayı gerekirse çağıran sunucu günlüğüne yazar.
 */
export function sendFailureText(r: { error: string; uncertain?: true }): string {
  return r.uncertain ? UNCERTAIN_SEND_TEXT : r.error;
}

export const SEND_DEFAULTS = { timeoutMs: 15_000, attempts: 3 } as const;
/** Kalan süre bundan azsa yeni deneme başlamaz: yarıda kesilecek deneme iletiyi "belirsiz" bırakırdı */
export const MIN_ATTEMPT_MS = 1_000;
/** Denemeden önce beklenen: 2 sn, 4 sn… */
const backoffMs = (attemptNo: number) => 2000 * attemptNo;

/** Ağ ve saat (testte sahtesi verilir) */
export interface SendIo {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Denemenin süresi: AbortSignal.timeout */
  timeout: (ms: number) => AbortSignal;
}

const realIo: SendIo = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  timeout: (ms) => AbortSignal.timeout(ms),
};

/** Sağlayıcının yanıtını Türkçe, eyleme dönük bir cümleye çevirir (sitedeki resendErrorText ile aynı dil) */
export function resendErrorText(status: number, body: string): string {
  let message = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "message" in parsed && typeof (parsed as { message?: unknown }).message === "string") {
      message = ((parsed as { message: string }).message ?? "").trim();
    }
  } catch {
    // JSON değil
  }
  if (!message) message = body.trim().slice(0, 200);
  const m = message.toLowerCase();
  const domain = /the (\S+) domain is not verified/i.exec(message)?.[1];
  if (domain) return `${domain} alan adı Resend'de doğrulanmamış; bu adresten e-posta çıkmaz. Doğrulanmış bir gönderen adresi yazın.`;
  if (m.includes("only send testing emails")) return "Resend hesabı deneme modunda: yalnız hesabın kendi adresine gönderebiliyor.";
  if (m.includes("api key")) return "Resend API anahtarı geçersiz ya da yetkisiz (RESEND_API_KEY).";
  if (m.includes("`from`") || m.includes("from field")) return "Gönderen adresi geçerli biçimde değil (Ad <ad@alanadi.com>).";
  if (m.includes("`to`") || m.includes("to field")) return "Alıcı adresi geçerli biçimde değil.";
  if (m.includes("quota")) return "Resend gönderim kotası doldu; kota yenilenince yeniden deneyin.";
  if (status === 429) return "Resend şu an çok fazla istek alıyor; biraz sonra yeniden deneyin.";
  if (status >= 500) return "Resend şu an yanıt vermiyor; biraz sonra yeniden deneyin.";
  return message ? `Resend iletiyi kabul etmedi (HTTP ${status}): ${message}` : `Resend iletiyi kabul etmedi (HTTP ${status}).`;
}

/** Yeniden denenen yanıtlar: çok istek, aynı anahtarlı istek hâlâ işleniyor (409), sağlayıcı hatası */
const retryable = (status: number) => status === 429 || status === 409 || status >= 500;

export async function postEmail(apiKey: string, msg: EmailMessage, opts: SendOptions = {}, io: SendIo = realIo): Promise<SendResult> {
  if (!msg.to.length) return { ok: false, error: "Bildirim adresi yok." };
  // Geçersiz sayı (NaN, sonsuz) verilmemiş sayılır
  const attempts = Number.isFinite(opts.attempts) ? Math.max(1, Math.floor(opts.attempts!)) : SEND_DEFAULTS.attempts;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs! : SEND_DEFAULTS.timeoutMs;
  const deadlineAt = Number.isFinite(opts.deadlineAt) ? opts.deadlineAt : undefined;
  let failure: { ok: false; error: string } | null = null;
  // Bir deneme iletiyi göndermiş olabilir mi (yukarıdaki `uncertain`)
  let maybeSent = false;
  // Yeniden denemeler aynı Idempotency-Key ile gider; Resend aynı iletiyi ikinci kez göndermez
  for (let attemptNo = 0; attemptNo < attempts; attemptNo++) {
    const wait = attemptNo > 0 ? backoffMs(attemptNo) : 0;
    if (deadlineAt !== undefined && deadlineAt - io.now() - wait < MIN_ATTEMPT_MS) break;
    if (wait) await io.sleep(wait);
    const ms = Math.floor(deadlineAt === undefined ? timeoutMs : Math.min(timeoutMs, deadlineAt - io.now()));
    // Süresi olmayan deneme başlamaz (yarıda kesilip iletiyi belirsiz bırakırdı)
    if (ms < 1) break;
    const signal = io.timeout(ms);
    const last = attemptNo === attempts - 1;
    try {
      const res = await io.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
        },
        body: JSON.stringify(emailPayload(msg)),
        signal,
      });
      const body = await res.text();
      if (res.ok) {
        let id: string | null = null;
        try {
          id = (JSON.parse(body) as { id?: string }).id ?? null;
        } catch {
          // kimlik olmadan da başarılı
        }
        return { ok: true, id };
      }
      if (res.status === 409) maybeSent = true;
      else if (!retryable(res.status)) maybeSent = false;
      failure = { ok: false, error: resendErrorText(res.status, body) };
      // 409: aynı anahtarla önceki istek hâlâ işleniyor (zaman aşımından sonraki deneme) → biraz bekleyip yeniden sor
      if (!last && retryable(res.status)) continue;
      break;
    } catch (e) {
      maybeSent = true;
      failure = { ok: false, error: `Resend'e ulaşılamadı: ${(e as Error).message}` };
      if (!last) continue;
      break;
    }
  }
  if (!failure) return { ok: false, error: "Süre yetmedi; e-posta gönderilmedi." };
  return maybeSent ? { ...failure, uncertain: true } : failure;
}
