import "server-only";

/**
 * Paraşüt API v4 bağlantı ayarları ortam değişkenlerinden okunur (docs/PARASUT.md).
 * Değerler hiçbir zaman istemciye gönderilmez; ekranda yalnızca "tanımlı mı" bilgisi gösterilir.
 */
export const PARASUT_ENV = [
  "PARASUT_CLIENT_ID",
  "PARASUT_CLIENT_SECRET",
  "PARASUT_USERNAME",
  "PARASUT_PASSWORD",
  "PARASUT_COMPANY_ID",
] as const;

export interface ParasutConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  companyId: string;
  /** Varsayılan https://api.parasut.com */
  baseUrl: string;
  /** İlk eşitlemede bu tarihten (YYYY-MM-DD) itibaren faturalar alınır */
  syncFrom: string | null;
}

export function parasutEnvStatus(): { name: (typeof PARASUT_ENV)[number]; set: boolean }[] {
  return PARASUT_ENV.map((name) => ({ name, set: Boolean(process.env[name]?.trim()) }));
}

export function isParasutConfigured(): boolean {
  return parasutEnvStatus().every((v) => v.set);
}

export function readParasutConfig(): ParasutConfig {
  const missing = parasutEnvStatus().filter((v) => !v.set).map((v) => v.name);
  if (missing.length) throw new Error(`Paraşüt ayarları eksik: ${missing.join(", ")}`);
  const from = process.env.PARASUT_SYNC_FROM?.trim();
  return {
    clientId: process.env.PARASUT_CLIENT_ID!.trim(),
    clientSecret: process.env.PARASUT_CLIENT_SECRET!.trim(),
    username: process.env.PARASUT_USERNAME!.trim(),
    password: process.env.PARASUT_PASSWORD!,
    companyId: process.env.PARASUT_COMPANY_ID!.trim(),
    baseUrl: (process.env.PARASUT_BASE_URL?.trim() || "https://api.parasut.com").replace(/\/+$/, ""),
    syncFrom: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
  };
}
