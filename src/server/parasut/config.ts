import "server-only";

import { appUrl } from "@/server/auth/tokens";

/**
 * Paraşüt API v4 bağlantı ayarları ortam değişkenlerinden okunur (docs/PARASUT.md).
 * Değerler hiçbir zaman istemciye gönderilmez; ekranda yalnızca "tanımlı mı" bilgisi gösterilir.
 *
 * Kimlik: OAuth 2.0 Authorization Code + PKCE (id.parasut.com). Kullanıcı adı/parola **yok**: Paraşüt
 * `grant_type=password` yöntemini 10 Aralık 2026'da kaldırdı. İstemci DevHub'dan alınır ve gizli (confidential)
 * olduğu için client_secret ile birlikte kullanılır.
 */
export const PARASUT_ENV = ["PARASUT_CLIENT_ID", "PARASUT_CLIENT_SECRET", "PARASUT_COMPANY_ID"] as const;

/** Paraşüt'ün yeni kimlik sunucusu; keşif belgesi {issuer}/.well-known/openid-configuration */
const DEFAULT_ISSUER = "https://id.parasut.com";
/** DevHub'a kaydedilecek dönüş adresi bu yola kurulur */
export const PARASUT_CALLBACK_PATH = "/panel/parasut/baglan/geri";

export interface ParasutConfig {
  clientId: string;
  clientSecret: string;
  companyId: string;
  /** Veri API'si; varsayılan https://api.parasut.com */
  baseUrl: string;
  /** Kimlik sunucusu; varsayılan https://id.parasut.com */
  issuer: string;
  /** Keşif belgesine ulaşılamazsa elle verilebilir (normalde null) */
  authorizeUrl: string | null;
  tokenUrl: string | null;
  /** DevHub'daki kayıtla **harfi harfine** aynı olmalı */
  redirectUri: string;
  /** Varsayılan "openid" */
  scope: string;
  /** İlk eşitlemede bu tarihten (YYYY-MM-DD) itibaren faturalar alınır */
  syncFrom: string | null;
}

export function parasutEnvStatus(): { name: (typeof PARASUT_ENV)[number]; set: boolean }[] {
  return PARASUT_ENV.map((name) => ({ name, set: Boolean(process.env[name]?.trim()) }));
}

export function isParasutConfigured(): boolean {
  return parasutEnvStatus().every((v) => v.set);
}

/** Yalnız https adresi kabul edilir (ortam değişkeni yanlış yazıldıysa sessizce kullanılmaz) */
function httpsEnv(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") throw new Error("https değil");
    return u.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`${name} geçerli bir https adresi değil`);
  }
}

/** DevHub'a kaydedilmesi gereken dönüş adresi (ayarlar eksikken de ekranda gösterilir) */
export function parasutRedirectUri(): string {
  return httpsEnv("PARASUT_REDIRECT_URI") ?? `${appUrl()}${PARASUT_CALLBACK_PATH}`;
}

export function readParasutConfig(): ParasutConfig {
  const missing = parasutEnvStatus().filter((v) => !v.set).map((v) => v.name);
  if (missing.length) throw new Error(`Paraşüt ayarları eksik: ${missing.join(", ")}`);
  const from = process.env.PARASUT_SYNC_FROM?.trim();
  return {
    clientId: process.env.PARASUT_CLIENT_ID!.trim(),
    clientSecret: process.env.PARASUT_CLIENT_SECRET!,
    companyId: process.env.PARASUT_COMPANY_ID!.trim(),
    baseUrl: (process.env.PARASUT_BASE_URL?.trim() || "https://api.parasut.com").replace(/\/+$/, ""),
    issuer: httpsEnv("PARASUT_ISSUER") ?? DEFAULT_ISSUER,
    authorizeUrl: httpsEnv("PARASUT_AUTHORIZE_URL"),
    tokenUrl: httpsEnv("PARASUT_TOKEN_URL"),
    redirectUri: parasutRedirectUri(),
    scope: process.env.PARASUT_SCOPE?.trim() || "openid",
    syncFrom: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
  };
}
