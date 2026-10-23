import { bearerAuthChallengeResponse, createMcpHandler, OAuthError, OAuthErrorCode, requireBearerAuth, type AuthInfo } from "@modelcontextprotocol/server";
import { after } from "next/server";

import { isAllowedOrigin, loopbackAllowed, MCP_SCOPE, mcpEnabled, mcpUrls } from "@/lib/mcp/oauth";
import { clientIp } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db";
import { mcpBase } from "@/server/mcp/base";
import { mcpFailLimiter, mcpGrantLimiter, notFound } from "@/server/mcp/http";
import { buildMcpServer } from "@/server/mcp/server";
import { touchGrant, verifyAccess, type Principal } from "@/server/mcp/store";

/*
 * Claude'un panele bağlandığı MCP ucu (Streamable HTTP, durumsuz; yalnız POST, GET/DELETE'e Next 405 der). Kimlik
 * yalnız Bearer erişim anahtarıyla (çerez okunmaz); anahtar bu sunucu için verilmiş olmalı (resource). Araçlar yalnız
 * okur (src/server/mcp/tools.ts). CORS yok; Origin varsa panelin kendisi, claude.ai, claude.com ya da
 * *.anthropic.com olmalı (MCP: geçersiz Origin → 403). docs/CLAUDE-BAGLANTISI.md.
 */

export const maxDuration = 30;

/** Doğrulanmış anahtarın sahibi (verifyAccessToken'ın AuthInfo.extra'sına koyduğu) */
function principalOf(info: AuthInfo | undefined): Principal {
  const p = info?.extra?.principal as Principal | undefined;
  if (!p) throw new Error("Kimlik doğrulanmadan MCP isteği");
  return p;
}

const handler = createMcpHandler((ctx) => buildMcpServer(principalOf(ctx.authInfo), mcpBase(ctx.requestInfo)), {
  legacy: "stateless",
  onerror: (e) => console.error("[mcp]", e.message),
});

const verifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const p = await verifyAccess(getDb(), token, new Date());
    // Başlığa (WWW-Authenticate) yazılır: ASCII
    if (!p) throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or expired access token");
    return { token, clientId: p.clientId, scopes: p.scopes, expiresAt: p.expiresAt, resource: new URL(p.resource), extra: { principal: p } };
  },
};

export async function POST(request: Request) {
  if (!mcpEnabled(process.env)) return notFound();
  const base = mcpBase(request);
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin, base, { loopback: loopbackAllowed(process.env) })) {
    console.warn("[mcp] Origin reddedildi:", origin);
    return Response.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const urls = mcpUrls(base);
  const options = { verifier, requiredScopes: [MCP_SCOPE], resourceMetadataUrl: urls.prm, expectedResource: new URL(urls.resource) };
  // Anahtarsız ilk istek (Claude'un keşfi): RFC 6750'ye göre hata kodu yok, yalnız belgenin adresi ve kapsam
  if (!request.headers.get("authorization")) {
    return Response.json(
      { error: "unauthorized", error_description: "Bearer token required" },
      { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${urls.prm}", scope="${MCP_SCOPE}"`, "Cache-Control": "no-store" } },
    );
  }
  const auth = await requireBearerAuth(options)(request);
  if (auth instanceof Response) {
    // IP sınırı anahtar doğrulandıktan sonra ve yalnız hatalı anahtara: Claude'un bütün istekleri Anthropic'in ortak
    // çıkış adreslerinden gelir, geçerli anahtar başkasının hatalı istekleri yüzünden reddedilmez. Yalnız hatalı
    // anahtarlar sayılır (veritabanı hatası, 500, sayılmaz); sınırı aşan IP'nin hatalı istekleri 429 alır
    if ((auth.status === 401 || auth.status === 403) && !mcpFailLimiter.hit(clientIp(request.headers))) {
      return Response.json({ error: "too_many_requests" }, { status: 429, headers: { "Retry-After": "600", "Cache-Control": "no-store" } });
    }
    return auth;
  }
  let p: Principal;
  try {
    p = principalOf(auth);
  } catch (e) {
    return bearerAuthChallengeResponse(e, options);
  }
  if (!mcpGrantLimiter.hit(String(p.grantId))) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Çok fazla istek; bir dakika sonra yeniden deneyin." } },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  after(() => touchGrant(getDb(), p.grantId, new Date()).catch((e: Error) => console.error("[mcp] son kullanım", e.message)));
  return handler.fetch(request, { authInfo: auth });
}
