import "server-only";

import { readAuthRequest, type AuthRequest } from "@/lib/mcp/oauth";
import { appUrl } from "@/server/auth/tokens";
import { open, seal } from "@/server/secret-box";

/**
 * Bağlantının kökü (issuer ve MCP adresinin başı). Canlıda her zaman panelin adresi (APP_URL; Vercel'in
 * lafmaliyet.vercel.app adresi değil): Claude, belgelerdeki adresin bağlayıcıya yazılan adresle aynı olmasını ister.
 * Yerelde isteğin kendi kökü: http://localhost:3111 gibi bir portta APP_URL'e dokunmadan denenir.
 */
export function mcpBase(request?: Request): string {
  if (process.env.NODE_ENV === "production" || !request) return appUrl();
  return new URL(request.url).origin;
}

/** Onay ekranına giden istek (AUTH_SECRET'tan türeyen anahtarla mühürlü; 10 dakika) */
export function sealRequest(req: AuthRequest): string {
  return seal(JSON.stringify(req), "mcp-request");
}

/** /baglan?istek=…: mühür bozuk, biçim yanlış ya da süresi dolmuşsa null (içerik kuralı readAuthRequest'te) */
export function openRequest(istek: string | null | undefined, now = Date.now()): AuthRequest | null {
  if (!istek || istek.length > 4000) return null;
  return readAuthRequest(open(istek, "mcp-request"), now);
}
