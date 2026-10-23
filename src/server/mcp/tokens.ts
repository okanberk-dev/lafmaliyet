import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * Claude bağlantısının anahtarları (docs/CLAUDE-BAGLANTISI.md). Saf yardımcılar: "server-only" yok, veritabanına
 * dokunmaz; testler doğrudan çağırır (src/server/auth/tokens.ts gibi). Ham anahtar 32 rastgele bayt (base64url, 43
 * karakter) ve türünü söyleyen bir önekle yalnız istemciye bir kez gider; veritabanında sha256 özeti durur. Önek, bir
 * erişim anahtarının yenileme anahtarı yerine (ya da tersi) denenmesini sorgudan önce keser.
 */

/** at: erişim (1 saat), rt: yenileme (30 gün), ac: yetki kodu (2 dakika) */
export type McpTokenKind = "at" | "rt" | "ac";

export function newToken(kind: McpTokenKind): string {
  return `laf${kind}_${randomBytes(32).toString("base64url")}`;
}

/** Biçimi tutmayan anahtar veritabanına sorulmadan reddedilir */
export function isMcpTokenShaped(raw: unknown, kind: McpTokenKind): raw is string {
  return typeof raw === "string" && raw.length === 49 && raw.startsWith(`laf${kind}_`) && /^[A-Za-z0-9_-]{43}$/.test(raw.slice(6));
}

/** 256 bit rastgele anahtarın özeti: hızlı özet yeter (tahmin edilemez), parola gibi yavaş özet gerekmez */
export function hashMcpToken(raw: string): string {
  return createHash("sha256").update(`laf-mcp:${raw}`).digest("hex");
}

/** Ham anahtar kayıtlı özetle eşleşiyor mu (sabit süreli karşılaştırma) */
export function mcpTokenMatches(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashMcpToken(raw), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Otomatik kayıtla (DCR) gelen istemcinin kimliği */
export function newClientId(): string {
  return `mcp_${randomBytes(16).toString("base64url")}`;
}

/** RFC 7636: code_verifier 43–128 karakter, yalnız A-Z a-z 0-9 - . _ ~ */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** PKCE S256: base64url(sha256(verifier)) */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Doğrulayıcı biçimde mi ve kodun sınamasıyla eşleşiyor mu (sabit süreli) */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !VERIFIER.test(verifier)) return false;
  const a = Buffer.from(pkceS256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
