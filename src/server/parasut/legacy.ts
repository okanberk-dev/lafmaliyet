import "server-only";

import type { LegacyCredentials } from "@/lib/parasut/legacy";

/**
 * GEÇİCİ (10 Aralık 2026'ya kadar): Paraşüt'ün eski kullanıcı adı/parola ayarlarını ortamdan okur. Kurallar ve son
 * tarih src/lib/parasut/legacy.ts'te; eski yöntem yalnız kayıtlı yeni oturum yokken kullanılır (client.ts).
 *
 * İstemci bilgileri yeni yöntemle aynı değişkenlerden gelir (PARASUT_CLIENT_ID / PARASUT_CLIENT_SECRET): Vercel'de
 * bugün eski istemcinin değerleri duruyor. Sahip DevHub'dan aldığı yenileri girdiğinde eski yöntem kendiliğinden
 * reddedilir ve ekran "Paraşüt hesabını bağla" der; o yüzden yenilerini girer girmez hesabı bağlamak gerekir.
 */

export const LEGACY_ENV = ["PARASUT_USERNAME", "PARASUT_PASSWORD"] as const;

/** Eski kullanıcı adı ya da parola ortamda duruyor mu (hesap bağlandıktan sonra silinebilir) */
export function legacyEnvPresent(): boolean {
  return LEGACY_ENV.some((name) => Boolean(process.env[name]?.trim()));
}

/** Eski yöntemin bilgileri; kullanıcı adı ya da parola eksikse null (eski yöntem hiç denenmez) */
export function readLegacyCredentials(cfg: { clientId: string; clientSecret: string; baseUrl: string }): LegacyCredentials | null {
  const username = process.env.PARASUT_USERNAME?.trim();
  const password = process.env.PARASUT_PASSWORD;
  if (!username || !password?.trim()) return null;
  return { clientId: cfg.clientId, clientSecret: cfg.clientSecret.trim(), username, password, baseUrl: cfg.baseUrl };
}
