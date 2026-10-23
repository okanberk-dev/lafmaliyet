import { mcpEnabled } from "@/lib/mcp/oauth";
import { clientIp } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db";
import { clientIdOf, CORS, notFound, oauthJson, preflight, readForm, revokeLimiter } from "@/server/mcp/http";
import { revokeByToken } from "@/server/mcp/store";

/*
 * RFC 7009 anahtar iadesi: erişim anahtarı yalnız kendisi, yenileme anahtarı bütün bağlantıyla kapanır. Bilinmeyen
 * anahtar için de 200 (anahtarın var olup olmadığı anlaşılmasın).
 */

export async function POST(request: Request) {
  if (!mcpEnabled(process.env)) return notFound();
  if (!revokeLimiter.hit(clientIp(request.headers))) return oauthJson(429, { error: "invalid_request", error_description: "Çok fazla istek" }, { "Retry-After": "60" });
  const form = await readForm(request);
  const token = form?.get("token");
  if (!form || !token) return oauthJson(400, { error: "invalid_request", error_description: "token gerekli" });
  await revokeByToken(getDb(), { token, clientId: clientIdOf(form, request) }, new Date());
  return new Response(null, { status: 200, headers: { ...CORS, "Cache-Control": "no-store" } });
}

export async function OPTIONS() {
  if (!mcpEnabled(process.env)) return notFound();
  return preflight();
}
