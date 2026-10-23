import { connection, type NextRequest } from "next/server";

import { checkAuthorize, isUrlClientId, loopbackAllowed, mcpEnabled } from "@/lib/mcp/oauth";
import { clientIp } from "@/server/auth/rate-limit";
import { LEGACY_COOKIES, readCookie, SESSION_COOKIE, verifySession } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { mcpBase, sealRequest } from "@/server/mcp/base";
import { resolveCimdClient } from "@/server/mcp/cimd";
import { authorizeLimiter, notFound, oauthErrorPage } from "@/server/mcp/http";
import { findClient } from "@/server/mcp/store";

/*
 * OAuth yetki isteği (Claude'un açtığı tarayıcı penceresi): istemci ve dönüş adresi doğrulanır, istek mühürlenip onay
 * ekranına (/baglan; oturum yoksa önce giriş, dönüşte onay ekranı) gidilir. İstemci ya da dönüş adresi güvenilmezse
 * hiçbir yere yönlendirilmez, panelin kendi hata sayfası açılır; öteki hatalar istemciye hata koduyla döner (state ve
 * iss ile). docs/CLAUDE-BAGLANTISI.md.
 */

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, ...NO_STORE } });

export async function GET(request: NextRequest) {
  await connection();
  if (!mcpEnabled(process.env)) return notFound();
  if (!authorizeLimiter.hit(clientIp(request.headers))) return oauthErrorPage("Çok fazla deneme", "Çok fazla deneme. Birkaç dakika sonra yeniden deneyin.", 429);

  const params = request.nextUrl.searchParams;
  const base = mcpBase(request);
  const loopback = loopbackAllowed(process.env);
  const now = new Date();
  const clientId = params.get("client_id") ?? "";
  const db = getDb();
  // URL biçiminde kimlik: Claude'un yayımlanmış kimliği (yalnız claude.ai / claude.com); değilse otomatik kayıt
  const client = !clientId || clientId.length > 500 ? null : isUrlClientId(clientId) ? await resolveCimdClient(db, clientId, now, { loopback }) : await findClient(db, clientId);

  const check = checkAuthorize(params, client, { base, loopback, now: now.getTime() });
  if (!check.ok) return check.redirect ? redirect(check.to) : oauthErrorPage(check.title, check.text, check.status);
  const consent = `/baglan?istek=${encodeURIComponent(sealRequest(check.req))}`;
  // Oturum çerezi yoksa doğrudan girişe (dönüşte onay ekranı); varsa onay ekranı oturumu kendisi denetler
  const session = await verifySession(readCookie(request.cookies, SESSION_COOKIE, LEGACY_COOKIES.session.name));
  return redirect(session ? `${base}${consent}` : `${base}/giris?next=${encodeURIComponent(consent)}`);
}
