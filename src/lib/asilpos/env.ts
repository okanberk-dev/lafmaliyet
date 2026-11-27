import { ESKI_ENV_ONEKI } from "./eski-adlar";

/**
 * AsilPOS'un ortam değişkenleri (Vercel): yeni ad `ASILPOS_X`, eski ad `LAFPOS_X` (26 Kasım 2026'dan önce). Sahip
 * Vercel'de yeni adları ekleyip eskileri silene kadar ikisi de okunur: önce yeni ad, boşsa eski ad. Durum metinleri
 * hangi adın tanımlı olduğunu `posEnvName` ile söyler (ikisi de yoksa eklenmesi gereken yeni ad). Saf; sunucu ve testler
 * paylaşır.
 */

/** Yeni önek */
export const ENV_ONEKI = "ASILPOS_";

/** Panelin okuduğu AsilPOS değişkenleri (öneksiz) */
export type PosEnvKey = "SYNC_SECRET" | "CLOUD_URL" | "CLOUD_SECRET" | "SITE_URL" | "SITE_SECRET" | "KURUCU_URL";

type Env = Record<string, string | undefined>;

const filled = (v: string | undefined) => (v?.trim() ? v : undefined);

/** Değişkenin değeri: `ASILPOS_<ad>`, boşsa `LAFPOS_<ad>`; ikisi de boşsa undefined */
export function posEnv(key: PosEnvKey, env: Env = process.env): string | undefined {
  return filled(env[`${ENV_ONEKI}${key}`]) ?? filled(env[`${ESKI_ENV_ONEKI}${key}`]);
}

/** Değerin okunduğu değişkenin adı; ikisi de boşsa yeni ad (eklenecek olan) */
export function posEnvName(key: PosEnvKey, env: Env = process.env): string {
  if (!filled(env[`${ENV_ONEKI}${key}`]) && filled(env[`${ESKI_ENV_ONEKI}${key}`])) return `${ESKI_ENV_ONEKI}${key}`;
  return `${ENV_ONEKI}${key}`;
}
