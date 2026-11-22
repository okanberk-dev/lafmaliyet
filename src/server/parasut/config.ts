import "server-only";

import { appUrl } from "@/server/auth/tokens";

/**
 * Paraşüt API v4 bağlantı ayarları ortam değişkenlerinden okunur (docs/PARASUT.md).
 * Değerler hiçbir zaman istemciye gönderilmez; ekranda yalnızca "tanımlı mı" bilgisi gösterilir.
 *
 * Kimlik: OAuth 2.0 Authorization Code + PKCE (id.parasut.com). İstemci DevHub'dan alınır ve gizli (confidential)
 * olduğu için client_secret ile birlikte kullanılır. Paraşüt `grant_type=password` yöntemini 10 Aralık 2026'da
 * kapatıyor; o güne kadar hesap bağlanmadıysa eski kullanıcı adı/parola geçici yedek olarak çalışır (legacy.ts).
 *
 * İsteğe bağlı adres değişkenleri (PARASUT_ISSUER, PARASUT_REDIRECT_URI, …) yanlış yazılmışsa ayarlar yine okunur:
 * değer yok sayılır ve `invalid`'e yazılır. Böylece eski yöntemle süren eşitleme bozulmaz; hesabı bağlama ise
 * düzeltilene kadar başlamaz (connect.ts).
 */
export const PARASUT_ENV = ["PARASUT_CLIENT_ID", "PARASUT_CLIENT_SECRET", "PARASUT_COMPANY_ID"] as const;

/**
 * Paraşüt'ün yeni kimlik sunucusu (Keycloak, "parasut" alanı). Keşif belgesi {issuer}/.well-known/openid-configuration;
 * alan adının kökünde keşif belgesi yok (404), bu yüzden yol /realms/parasut ile biter.
 */
export const DEFAULT_ISSUER = "https://id.parasut.com/realms/parasut";
/**
 * Varsayılan izinler. offline_access olmadan Keycloak'ın verdiği refresh_token tarayıcı oturumuna bağlıdır ve
 * oturum boşta kalınca (dakikalar, en çok saatler) düşer; sabah eşitlemesi ertesi gün bağlantıyı kaybederdi.
 * offline_access keşif belgesinin scopes_supported listesinde var ve oturumdan bağımsız, her kullanımda uzayan
 * çevrimdışı belirteç verir.
 */
export const DEFAULT_SCOPE = "openid offline_access";
/** DevHub'a kaydedilecek dönüş adresi bu yola kurulur */
export const PARASUT_CALLBACK_PATH = "/panel/parasut/baglan/geri";

export interface ParasutConfig {
  clientId: string;
  clientSecret: string;
  companyId: string;
  /** Veri API'si; varsayılan https://api.parasut.com */
  baseUrl: string;
  /** Kimlik sunucusu; varsayılan https://id.parasut.com/realms/parasut */
  issuer: string;
  /** Keşif belgesine ulaşılamazsa elle verilebilir (normalde null) */
  authorizeUrl: string | null;
  tokenUrl: string | null;
  /** DevHub'daki kayıtla **harfi harfine** aynı olmalı */
  redirectUri: string;
  /** Varsayılan "openid offline_access" */
  scope: string;
  /** Geçerli bir https adresi olmadığı için yok sayılan isteğe bağlı değişkenler (boşsa her şey yolunda) */
  invalid: string[];
  /** İlk eşitlemede bu tarihten (YYYY-MM-DD) itibaren faturalar alınır */
  syncFrom: string | null;
}

export function parasutEnvStatus(): { name: (typeof PARASUT_ENV)[number]; set: boolean }[] {
  return PARASUT_ENV.map((name) => ({ name, set: Boolean(process.env[name]?.trim()) }));
}

export function isParasutConfigured(): boolean {
  return parasutEnvStatus().every((v) => v.set);
}

/** Yalnız https adresi kabul edilir; yanlış yazılmışsa değer yok sayılır ve `invalid: true` döner */
function readHttps(name: string): { value: string | null; invalid: boolean } {
  const raw = process.env[name]?.trim();
  if (!raw) return { value: null, invalid: false };
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return { value: null, invalid: true };
    return { value: u.toString().replace(/\/+$/, ""), invalid: false };
  } catch {
    return { value: null, invalid: true };
  }
}

/** DevHub'a kaydedilmesi gereken dönüş adresi (ayarlar eksikken de ekranda gösterilir); yanlış yazılmışsa hata */
export function parasutRedirectUri(): string {
  const r = readHttps("PARASUT_REDIRECT_URI");
  if (r.invalid) throw new Error("PARASUT_REDIRECT_URI geçerli bir https adresi değil");
  return r.value ?? `${appUrl()}${PARASUT_CALLBACK_PATH}`;
}

/**
 * Hesabı bağlamadan ve yeni yöntemle belirteç istemeden önce: yanlış yazılmış adres değişkeni varsa açık hata.
 * `only` verilirse yalnız o değişkenlere bakılır (yenileme için dönüş adresi gerekmez).
 */
export function assertOidcSettings(cfg: Pick<ParasutConfig, "invalid">, only?: readonly string[]) {
  const bad = only ? cfg.invalid.filter((name) => only.includes(name)) : cfg.invalid;
  if (bad.length) {
    throw new Error(`${bad.join(", ")} geçerli bir https adresi değil. Vercel'de düzeltip yeniden deploy edin ya da boş bırakın.`);
  }
}

/**
 * Ayarlar. Yalnız zorunlu üç değişken eksikse hata atar (o zaman ne yeni ne eski yöntem çalışabilir); isteğe bağlı
 * değişkenlerin yanlışı uygulamayı durdurmaz.
 */
export function readParasutConfig(): ParasutConfig {
  const missing = parasutEnvStatus().filter((v) => !v.set).map((v) => v.name);
  if (missing.length) throw new Error(`Paraşüt ayarları eksik: ${missing.join(", ")}`);
  const from = process.env.PARASUT_SYNC_FROM?.trim();
  const invalid: string[] = [];
  const https = (name: string) => {
    const r = readHttps(name);
    if (r.invalid) invalid.push(name);
    return r.value;
  };
  return {
    clientId: process.env.PARASUT_CLIENT_ID!.trim(),
    clientSecret: process.env.PARASUT_CLIENT_SECRET!.trim(),
    companyId: process.env.PARASUT_COMPANY_ID!.trim(),
    baseUrl: (process.env.PARASUT_BASE_URL?.trim() || "https://api.parasut.com").replace(/\/+$/, ""),
    issuer: https("PARASUT_ISSUER") ?? DEFAULT_ISSUER,
    authorizeUrl: https("PARASUT_AUTHORIZE_URL"),
    tokenUrl: https("PARASUT_TOKEN_URL"),
    redirectUri: https("PARASUT_REDIRECT_URI") ?? `${appUrl()}${PARASUT_CALLBACK_PATH}`,
    scope: process.env.PARASUT_SCOPE?.trim() || DEFAULT_SCOPE,
    syncFrom: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
    invalid,
  };
}
