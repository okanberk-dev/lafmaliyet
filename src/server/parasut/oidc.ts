import "server-only";

import { keycloakEndpoints, readDiscovery, type ParasutEndpoints } from "@/lib/parasut/oidc";

/**
 * Paraşüt'ün keşif belgesini (`{issuer}/.well-known/openid-configuration`) indirir ve bellekte tutar.
 *
 * Yetki ve belirteç adresleri koda **yazılmaz**: Paraşüt yeni altyapıyı standartlara uygun OpenID Connect olarak
 * duyurdu, adresleri belgeden okumak hem doğrusu hem de adres değişirse kendiliğinden uyar. Belgeye ulaşılamayan
 * kurulumlarda PARASUT_AUTHORIZE_URL / PARASUT_TOKEN_URL ile elle verilebilir (docs/PARASUT.md).
 *
 * Belge okunamazsa (Cloudflare id.parasut.com'da `.well-known` isteğini sunuculardan 403 ile engelliyor) ve yayıncı
 * bir Keycloak alanıysa Keycloak'ın standart uçlarına dönülür; böylece elle verilen adresler silinse de bağlantı
 * çalışır. Yayıncı başka biçimdeyse keşif hatası olduğu gibi gösterilir.
 *
 * Belgenin okunması ve güvenlik denetimleri saf tarafta: src/lib/parasut/oidc.ts.
 */

/** Keşif belgesi bellekte bu süre tutulur (her istekte yeniden indirilmez) */
const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** Beklenmedik büyüklükte yanıt okunmaz */
const MAX_BYTES = 64 * 1024;

export type { ParasutEndpoints };

let cache: { at: number; key: string; value: ParasutEndpoints } | null = null;

async function discover(issuer: string): Promise<ParasutEndpoints> {
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new Error(
      name === "TimeoutError" || name === "AbortError"
        ? `Paraşüt kimlik sunucusu ${FETCH_TIMEOUT_MS / 1000} saniyede yanıt vermedi (${url}).`
        : `Paraşüt kimlik sunucusuna ulaşılamadı (${url}): ${(e as Error)?.message ?? e}`,
    );
  }
  if (!res.ok) throw new Error(`Paraşüt keşif belgesi okunamadı (HTTP ${res.status}, ${url}).`);
  const text = (await res.text()).slice(0, MAX_BYTES);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`Paraşüt keşif belgesi JSON değil (${url}).`);
  }
  return readDiscovery(doc, issuer);
}

/**
 * Yetki ve belirteç adresleri. İkisi de elle verilmişse keşif atlanır; yoksa belge okunur ve 6 saat saklanır.
 */
export async function parasutEndpoints(cfg: { issuer: string; authorizeUrl: string | null; tokenUrl: string | null }): Promise<ParasutEndpoints> {
  if (cfg.authorizeUrl && cfg.tokenUrl) return { issuer: cfg.issuer, authorizeUrl: cfg.authorizeUrl, tokenUrl: cfg.tokenUrl };
  const key = `${cfg.issuer}|${cfg.authorizeUrl ?? ""}|${cfg.tokenUrl ?? ""}`;
  if (cache && cache.key === key && Date.now() - cache.at < DISCOVERY_TTL_MS) return cache.value;
  let found: ParasutEndpoints;
  try {
    found = await discover(cfg.issuer);
  } catch (e) {
    const standard = keycloakEndpoints(cfg.issuer);
    if (!standard) throw e;
    console.warn(`[parasut] ${(e as Error)?.message ?? e} Keycloak'ın standart uçları kullanılıyor.`);
    found = standard;
  }
  // Elle verilen tek adres belgeden geleni ezer (Paraşüt bir adresi belgede eksik bırakırsa)
  const value: ParasutEndpoints = { ...found, authorizeUrl: cfg.authorizeUrl ?? found.authorizeUrl, tokenUrl: cfg.tokenUrl ?? found.tokenUrl };
  cache = { at: Date.now(), key, value };
  return value;
}

/** Testlerde ve ayarlar değişince keşif belgesini yeniden okutur */
export function forgetDiscovery() {
  cache = null;
}
