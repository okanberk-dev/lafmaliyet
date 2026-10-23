import "server-only";

import { createLimiter } from "@/server/auth/rate-limit";

/*
 * Claude bağlantısının uçlarının ortak yanıtları ve bellekteki sınırlayıcıları. OAuth uçları ve metaveri belgeleri
 * herkese açık (CORS *); /api/mcp'de CORS yok. Sınırlayıcılar sunucusuz örnek başına sayar: ilk savunma. Asıl sınırlar
 * veritabanında: kod tek kullanım, bağlantı tavanı (10), günlük kayıt tavanı (50).
 */

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

/** OPTIONS (tarayıcı ön isteği) */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** Kapalı (önizleme ya da MCP_DISABLED): uç yokmuş gibi */
export function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** OAuth yanıtı: önbelleğe alınmaz (RFC 6749 §5.1), CORS açık */
export function oauthJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache", ...headers } });
}

/** Metaveri belgesi: 5 dakika önbellek (Claude da ~5 dakika tutar) */
export function metadataJson(body: unknown): Response {
  return Response.json(body, { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * İstek güvenilir bir dönüş adresine bağlanamadığında (istemci tanınmadı, dönüş adresi izinsiz, çok fazla deneme)
 * kimseye yönlendirilmez: panelin kendi küçük hata sayfası (giriş ekranının renkleri).
 */
export function oauthErrorPage(title: string, text: string, status = 400): Response {
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;min-height:100vh;background:#006241;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;box-sizing:border-box">
<main style="width:100%;max-width:460px;background:#fff;border-radius:16px;padding:28px 24px;box-sizing:border-box;color:rgba(0,0,0,.9)">
<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:rgba(0,0,0,.55)">L'Affogato · Yönetim paneli</p>
<h1 style="margin:0 0 10px;font-size:24px;line-height:1.25">${escapeHtml(title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:rgba(0,0,0,.65)">${escapeHtml(text)}</p>
<a href="/panel" style="display:inline-flex;min-height:44px;align-items:center;font-weight:600;color:#00754A">Panele git</a>
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

/** /oauth/authorize: IP başına 10 dakikada 30 */
export const authorizeLimiter = createLimiter({ limit: 30, windowMs: 10 * 60_000 });
/** /oauth/token: IP başına dakikada 60, istemci başına dakikada 30 */
export const tokenIpLimiter = createLimiter({ limit: 60, windowMs: 60_000 });
export const tokenClientLimiter = createLimiter({ limit: 30, windowMs: 60_000 });
/** /oauth/register: IP başına saatte 10 */
export const registerLimiter = createLimiter({ limit: 10, windowMs: 60 * 60_000 });
/** /oauth/revoke: IP başına dakikada 30 */
export const revokeLimiter = createLimiter({ limit: 30, windowMs: 60_000 });
/**
 * /api/mcp: hatalı anahtarla 10 dakikada 30 istek (IP; anahtar doğrulandıktan sonra, yalnız hatalıya: geçerli anahtar
 * IP yüzünden reddedilmez), bağlantı başına dakikada 60 istek
 */
export const mcpFailLimiter = createLimiter({ limit: 30, windowMs: 10 * 60_000 });
export const mcpGrantLimiter = createLimiter({ limit: 60, windowMs: 60_000 });

/** Gövdeyi en çok `max` bayt okur; fazlaysa null (büyük gövde belleğe alınmaz) */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** application/x-www-form-urlencoded gövdesi (OAuth uçları); gövde büyükse ya da tür yanlışsa null */
export async function readForm(request: Request, max = 8 * 1024): Promise<URLSearchParams | null> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return null;
  const text = await readCapped(request, max);
  return text === null ? null : new URLSearchParams(text);
}

/** İstemci kimliği: gövdeden ya da HTTP Basic başlığından (açık istemci; gizli anahtar yok sayılır) */
export function clientIdOf(form: URLSearchParams, request: Request): string | null {
  const fromBody = form.get("client_id");
  if (fromBody) return fromBody;
  const auth = request.headers.get("authorization") ?? "";
  if (!/^basic /i.test(auth)) return null;
  try {
    const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
    const id = decodeURIComponent(decoded.split(":")[0] ?? "");
    return id || null;
  } catch {
    return null;
  }
}
