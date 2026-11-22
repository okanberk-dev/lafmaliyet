import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Paraşüt'ün yeni kimlik altyapısının (id.parasut.com) saf kuralları: PKCE üretimi, keşif belgesinin okunması ve
 * yetki adresinin kurulması. Ağa çıkmaz, veritabanına dokunmaz; indirme ve önbellek src/server/parasut/oidc.ts'te.
 *
 * Paraşüt 10 Aralık 2026'da `grant_type=password`'ü ve eski api.parasut.com/oauth istemcilerini kapattı; erişim
 * yalnızca Authorization Code + PKCE ile alınıyor (OAuth 2.0 / OpenID Connect).
 */

export interface ParasutEndpoints {
  issuer: string;
  authorizeUrl: string;
  tokenUrl: string;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** PKCE doğrulayıcısı (RFC 7636 §4.1): 43–128 karakter; 32 rastgele bayt base64url'de 43 karakter eder */
export function createVerifier(): string {
  return b64url(randomBytes(32));
}

/** S256 sınaması (RFC 7636 §4.2): BASE64URL(SHA256(ASCII(verifier))) */
export function challengeOf(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

/** CSRF için `state`; dönüşte kayıtlı değerle karşılaştırılır */
export function createState(): string {
  return b64url(randomBytes(32));
}

/** `state` karşılaştırması: eşit uzunlukta sabit süreli, farklı uzunlukta kısa devre */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "id.parasut.com" ile "api.parasut.com" aynı yer sayılır; keşif belgesi başka bir alan adına götürmesin */
export function sameSite(a: string, b: string): boolean {
  const tail = (h: string) => h.toLowerCase().split(".").slice(-2).join(".");
  return a.toLowerCase() === b.toLowerCase() || tail(a) === tail(b);
}

/** https, kimlik bilgisi içermeyen ve yayıncıyla aynı alan adında bir adres mi; değilse Türkçe hata atar */
export function endpointUrl(label: string, raw: unknown, issuerHost: string): string {
  if (typeof raw !== "string" || !raw) throw new Error(`Paraşüt keşif belgesinde ${label} yok`);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Paraşüt keşif belgesindeki ${label} adresi okunamadı`);
  }
  if (u.protocol !== "https:") throw new Error(`Paraşüt ${label} adresi https değil`);
  if (u.username || u.password) throw new Error(`Paraşüt ${label} adresi kullanıcı bilgisi içeriyor`);
  if (!sameSite(u.hostname, issuerHost)) throw new Error(`Paraşüt ${label} adresi başka bir alan adına (${u.hostname}) işaret ediyor`);
  return u.toString();
}

/** Keşif belgesinden yetki ve belirteç adresleri; eksik ya da güvenilmez adreste hata atar */
export function readDiscovery(doc: unknown, issuer: string): ParasutEndpoints {
  const d = (doc ?? {}) as { issuer?: unknown; authorization_endpoint?: unknown; token_endpoint?: unknown };
  const issuerHost = new URL(issuer).hostname;
  return {
    issuer: typeof d.issuer === "string" && d.issuer ? d.issuer : issuer,
    authorizeUrl: endpointUrl("authorization_endpoint", d.authorization_endpoint, issuerHost),
    tokenUrl: endpointUrl("token_endpoint", d.token_endpoint, issuerHost),
  };
}

/** Paraşüt'ün onay ekranının adresi: Authorization Code + PKCE (S256), `state` ve `scope` ile */
export function authorizeRequestUrl(x: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(x.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", x.clientId);
  url.searchParams.set("redirect_uri", x.redirectUri);
  url.searchParams.set("scope", x.scope);
  url.searchParams.set("state", x.state);
  url.searchParams.set("code_challenge", x.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
