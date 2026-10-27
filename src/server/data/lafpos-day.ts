import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";

import type { KasaEvidence } from "@/lib/cash-out-requests";
import { readLafposSwitchDay } from "@/lib/constants";
import { posZSchema } from "@/lib/lafpos/day";
import { lafposDayOf, type LafposDay } from "@/lib/lafpos/prefill";
import { isLafposDay, LAFPOS_SWITCH_KEY } from "@/lib/lafpos/switch";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";

/**
 * Kasa raporunun okuduğu (docs/LAFPOS.md › Kasa raporu): yalnız LafPOS günlerinde, yani geçiş günü seçili ve gün ondan
 * önce değilse (src/lib/lafpos/switch.ts). Geçiş günü boşken ya da önceki bir günde LafPOS'un gönderdiği gün (deneme)
 * hiçbir role görünmez, bant çıkmaz, form bugünkü gibi ModPOS'a göre elle doldurulur (sahibin 26 Ekim kararı).
 */
export async function loadKasaLafposDay(date: string, db: DB = getDb()): Promise<LafposDay | null> {
  return (await loadKasaLafpos(date, db)).day;
}

/**
 * Günün kasası ve LafPOS özeti birlikte: `lafpos` gün LafPOS günü mü (geçiş günü seçili ve gün ondan önce değil; o
 * günün gönderimi gelmemiş olsa da), `day` gelen özet (yoksa ya da LafPOS günü değilse null). Kasa formu ve geç rapor
 * ikisine de bakar: LafPOS gününde ModPOS Z fotoğrafı istenmez; LafPOS'un gönderimi yoksa yazarkasa Z'si kanıttır.
 */
export async function loadKasaLafpos(date: string, db: DB = getDb()): Promise<{ lafpos: boolean; day: LafposDay | null }> {
  if (!isLafposDay(date, await loadLafposSwitchDay(db))) return { lafpos: false, day: null };
  return { lafpos: true, day: await loadLafposDay(date, db) };
}

/** Okuyucu: veritabanı ya da işlem (yalnız select) */
type Reader = Pick<DB, "select">;

/**
 * Günün kasa kanıtı (G8, docs/LAFPOS.md › Kasa raporu): ModPOS gününde (geçiş günü boş ya da gün ondan önce) ModPOS Z
 * fotoğrafı ("modpos-z"); LafPOS gününde o günün LafPOS gün sonu geldiyse o ("lafpos": fotoğraf gerekmez), gelmediyse
 * yazarkasa (Banka POS) Z fotoğrafı ("okc-z"). Geç rapor ve fotoğraf kaldırma aynı kurala bakar; işlem içinden de
 */
export async function kasaEvidence(db: Reader, date: string): Promise<KasaEvidence> {
  const [setting] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1);
  if (!isLafposDay(date, readLafposSwitchDay(setting?.value))) return "modpos-z";
  const [day] = await db.select({ date: s.posDayReports.date }).from(s.posDayReports).where(eq(s.posDayReports.date, date)).limit(1);
  return day ? "lafpos" : "okc-z";
}

/**
 * [from, to] içindeki günlerin kasası ve LafPOS özetleri (yöneticinin ay görünümü): `of(gün)` loadKasaLafpos'un aynısını
 * verir (geçiş gününden önceki günde ya da geçiş günü boşken `{ lafpos: false, day: null }`)
 */
export async function loadKasaLafposDays(from: string, to: string, db: DB = getDb()): Promise<(date: string) => { lafpos: boolean; day: LafposDay | null }> {
  const out = new Map<string, LafposDay>();
  const switchDay = await loadLafposSwitchDay(db);
  const of = (date: string) => (isLafposDay(date, switchDay) ? { lafpos: true, day: out.get(date) ?? null } : { lafpos: false, day: null });
  if (switchDay === null || to < switchDay) return of;
  const start = from > switchDay ? from : switchDay;
  const rows = await db
    .select({ date: s.posDayReports.date, z: s.posDayReports.z, receivedAt: s.posDayReports.receivedAt })
    .from(s.posDayReports)
    .where(and(gte(s.posDayReports.date, start), lte(s.posDayReports.date, to)));
  for (const r of rows) {
    const z = posZSchema.safeParse(r.z);
    if (z.success) out.set(r.date, lafposDayOf(z.data, r.receivedAt));
  }
  return of;
}

/**
 * Günün LafPOS özeti, geçiş gününe bakmadan (Kasa raporu loadKasaLafposDay'den geçer): "LafPOS'tan doldur"un verisi.
 * Yalnız Z özeti ve geliş anı okunur (sabit sütunlar); ödeme kanalları ve ikramlar okunmaz, personele gitmez. Gün
 * gelmediyse ya da özet okunamıyorsa null: düğme görünmez, form her zamanki gibi elle doldurulur.
 */
export async function loadLafposDay(date: string, db: DB = getDb()): Promise<LafposDay | null> {
  const [row] = await db
    .select({ z: s.posDayReports.z, receivedAt: s.posDayReports.receivedAt })
    .from(s.posDayReports)
    .where(eq(s.posDayReports.date, date))
    .limit(1);
  if (!row) return null;
  const z = posZSchema.safeParse(row.z);
  return z.success ? lafposDayOf(z.data, row.receivedAt) : null;
}
