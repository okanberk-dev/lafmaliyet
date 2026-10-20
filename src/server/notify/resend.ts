import "server-only";

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

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

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

export async function sendEmail(msg: { from: string; to: string[]; subject: string; html: string; text: string; idempotencyKey?: string }): Promise<SendResult> {
  const key = resendApiKey();
  if (!key) return { ok: false, error: "RESEND_API_KEY tanımlı değil; e-posta gönderilemiyor." };
  if (!msg.to.length) return { ok: false, error: "Bildirim adresi yok." };
  // Yeniden denemeler aynı Idempotency-Key ile gider; Resend aynı iletiyi ikinci kez göndermez
  for (let attemptNo = 0; attemptNo < 3; attemptNo++) {
    if (attemptNo > 0) await new Promise((r) => setTimeout(r, 2000 * attemptNo));
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
        },
        body: JSON.stringify({ from: msg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
        signal: AbortSignal.timeout(15_000),
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
      // 409: aynı anahtarla önceki istek hâlâ işleniyor (zaman aşımından sonraki deneme) → biraz bekleyip yeniden sor
      if (attemptNo < 2 && (res.status === 429 || res.status === 409 || res.status >= 500)) continue;
      return { ok: false, error: resendErrorText(res.status, body) };
    } catch (e) {
      if (attemptNo < 2) continue;
      return { ok: false, error: `Resend'e ulaşılamadı: ${(e as Error).message}` };
    }
  }
  return { ok: false, error: "E-posta gönderilemedi." };
}
