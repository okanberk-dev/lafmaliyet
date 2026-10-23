import "server-only";

import { postEmail, type EmailMessage, type SendOptions, type SendResult } from "./resend-http";

export { resendErrorText, type EmailMessage, type SendOptions, type SendResult } from "./resend-http";

/**
 * Resend HTTP API ile e-posta (laffogato.net sitesiyle aynı hesap ve doğrulanmış alan adı;
 * bkz. laffogato deposu docs/EMAIL-RESEND.md). Ortam: RESEND_API_KEY (zorunlu), EMAIL_FROM (isteğe bağlı).
 * Gönderen sırası: paneldeki ayar → EMAIL_FROM → varsayılan.
 */
export const DEFAULT_FROM = "L'Affogato Panel <bildirim@laffogato.net>";

/** Anahtar Vercel'e küçük harfle de girilmiş olabilir (resend_api_key); ikisi de kabul edilir */
function resendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY?.trim() || process.env.resend_api_key?.trim() || undefined;
}

export function isEmailConfigured(): boolean {
  return Boolean(resendApiKey());
}

export function resolveFrom(panelFrom?: string | null): string {
  return panelFrom?.trim() || process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

/**
 * İletiyi Resend'e gönderir. `opts` verilmezse bugünkü gibi: 3 deneme, deneme başına 15 sn (resend-http.ts
 * SEND_DEFAULTS). Sabah işi `deadlineAt` verir (jobStart + 48 sn): takılan Resend işlevin 60 sn'sini yemesin.
 * Başarısız sonuçta `uncertain`: ileti gitmiş olabilir (zaman aşımı, ağ hatası ya da 409).
 */
export async function sendEmail(msg: EmailMessage, opts?: SendOptions): Promise<SendResult> {
  const key = resendApiKey();
  if (!key) return { ok: false, error: "RESEND_API_KEY tanımlı değil; e-posta gönderilemiyor." };
  return postEmail(key, msg, opts);
}
