import { DCR_PENDING_PER_DAY, loopbackAllowed, mcpEnabled, validateRegistration } from "@/lib/mcp/oauth";
import { clientIp } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db";
import { notFound, oauthJson, preflight, readCapped, registerLimiter } from "@/server/mcp/http";
import { pendingDcrCount, registerDcrClient } from "@/server/mcp/store";

/*
 * RFC 7591 otomatik kayıt (Claude'da "Register automatically"): yalnız izinli dönüş adresleri (claude.ai /
 * claude.com; yerelde localhost), gizli anahtar ve kayıt erişim anahtarı verilmez. IP başına saatte 10; hiç
 * bağlanmamış istemci günde en çok 50 (veritabanında sayılır). Bağlanmayanları sabah işi siler.
 */

export async function POST(request: Request) {
  if (!mcpEnabled(process.env)) return notFound();
  if (!registerLimiter.hit(clientIp(request.headers))) {
    return oauthJson(429, { error: "invalid_client_metadata", error_description: "Çok fazla kayıt; bir saat sonra yeniden deneyin" }, { "Retry-After": "3600" });
  }
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return oauthJson(400, { error: "invalid_client_metadata", error_description: "application/json gerekli" });
  const text = await readCapped(request, 8 * 1024);
  let body: unknown = null;
  try {
    body = text === null ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  if (body === null) return oauthJson(400, { error: "invalid_client_metadata", error_description: "Kayıt bilgisi okunamadı" });

  const v = validateRegistration(body, { loopback: loopbackAllowed(process.env) });
  if (!v.ok) return oauthJson(400, { error: v.error, error_description: v.description });
  const db = getDb();
  if ((await pendingDcrCount(db, new Date(Date.now() - 86_400_000))) >= DCR_PENDING_PER_DAY) {
    return oauthJson(429, { error: "invalid_client_metadata", error_description: "Şu an yeni kayıt alınmıyor" }, { "Retry-After": "3600" });
  }
  const client = await registerDcrClient(db, { name: v.name, redirectUris: v.redirectUris });
  return oauthJson(201, {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

export async function OPTIONS() {
  if (!mcpEnabled(process.env)) return notFound();
  return preflight();
}
