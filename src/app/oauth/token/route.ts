import { mcpEnabled } from "@/lib/mcp/oauth";
import { logActivity } from "@/server/actions/log";
import { clientIp } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db";
import { clientIdOf, notFound, oauthJson, preflight, readForm, tokenClientLimiter, tokenIpLimiter } from "@/server/mcp/http";
import { exchangeCode, findClient, refreshGrant, type TokenResult } from "@/server/mcp/store";

/*
 * OAuth anahtar ucu (RFC 6749 §4.1.3 ve §6): kod → erişim (1 saat) + yenileme (30 gün) anahtarı; yenileme anahtarı
 * her kullanımda değişir. Açık istemci (gizli anahtar yok), PKCE S256. Bilinmeyen istemci 401 invalid_client: Claude
 * kendini yeniden kaydeder. Kod tekrarında ya da kullanılmış yenileme anahtarında bağlantı kapanır ve işlem
 * geçmişine yazılır. docs/CLAUDE-BAGLANTISI.md.
 */

const tooMany = () => oauthJson(429, { error: "invalid_request", error_description: "Çok fazla istek" }, { "Retry-After": "60" });

export async function POST(request: Request) {
  if (!mcpEnabled(process.env)) return notFound();
  if (!tokenIpLimiter.hit(clientIp(request.headers))) return tooMany();
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return oauthJson(415, { error: "invalid_request", error_description: "application/x-www-form-urlencoded gerekli" });
  const form = await readForm(request);
  if (!form) return oauthJson(400, { error: "invalid_request", error_description: "İstek okunamadı" });

  const clientId = clientIdOf(form, request);
  if (!clientId || clientId.length > 500) return oauthJson(401, { error: "invalid_client", error_description: "client_id gerekli" });
  if (!tokenClientLimiter.hit(clientId)) return tooMany();
  const db = getDb();
  const client = await findClient(db, clientId);
  if (!client) return oauthJson(401, { error: "invalid_client", error_description: "Uygulama tanınmadı" });

  const now = new Date();
  let result: TokenResult;
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    result = await exchangeCode(db, { code: form.get("code"), clientId, redirectUri: form.get("redirect_uri"), codeVerifier: form.get("code_verifier"), resource: form.get("resource") }, now);
  } else if (grantType === "refresh_token") {
    result = await refreshGrant(db, { refreshToken: form.get("refresh_token"), clientId, resource: form.get("resource"), scope: form.get("scope") }, now);
  } else {
    return oauthJson(400, { error: "unsupported_grant_type", error_description: "Yalnız authorization_code ve refresh_token" });
  }
  // Yeni bağlantı onay ekranında yazıldı; burada yalnız güvenlik için kapatılan bağlantı
  if (result.event?.kind === "security-revoked") {
    const e = result.event;
    await logActivity(null, "Claude bağlantısı güvenlik için kapatıldı", `${e.userName} · ${e.host} · ${e.why ?? "güvenlik"}`);
  }
  if (!result.ok) return oauthJson(result.status, { error: result.error, error_description: result.description });
  return oauthJson(200, result.body);
}

export async function OPTIONS() {
  if (!mcpEnabled(process.env)) return notFound();
  return preflight();
}
