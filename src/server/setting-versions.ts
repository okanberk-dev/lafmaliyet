import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { DEFAULT_POS_RATE } from "@/lib/branches";
import type { Settings } from "@/lib/calc/types";
import { DEFAULT_SETTINGS, settingsFromRows } from "@/lib/constants";
import {
  BASE_MONTH,
  changeLogText,
  closedMonthIn,
  fromMonthText,
  isMonth,
  isMonthSettingKey,
  planChange,
  POS_RATE_KEY,
  redundantMonths,
  removalEffect,
  versionsOf,
  versionValueText,
  versionValueValid,
  VERSION_KEY_INFO,
  type ChangeMode,
  type SettingVersion,
  type VersionKey,
} from "@/lib/month-settings";
import { loadClosedPeriods } from "@/server/closed-period";
import { getDb, schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

/*
 * Ay bazlı ayarların veritabanı tarafı (kurallar src/lib/month-settings.ts, docs/AYARLAR.md): sürümleri okur, bir
 * değişikliği "şu aydan itibaren" ya da "yalnız bu ay" olarak yazar, sürüm kaldırır. Kapalı aya dokunan değişiklik
 * reddedilir (docs/DONEM-KAPANISI.md): ayarın değişmesi kapalı ayın rakamını sessizce değiştirmesin.
 */

/** Okuma yapan her şey: veritabanı ya da açık bir işlem */
type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

const toVersion = (r: typeof s.settingVersions.$inferSelect): SettingVersion => ({
  id: r.id,
  key: r.key,
  branchId: r.branchId,
  fromMonth: r.fromMonth,
  value: r.value,
  note: r.note,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
});

/** Bütün sürümler (ayarlar ve şubelerin POS oranı), anahtar ve aya göre sıralı */
export async function loadSettingVersions(db: Reader = getDb()): Promise<SettingVersion[]> {
  const rows = await db.select().from(s.settingVersions).orderBy(asc(s.settingVersions.key), asc(s.settingVersions.branchId), asc(s.settingVersions.fromMonth));
  return rows.map(toVersion);
}

/** Anahtarın taban değeri: genel ayarda settings satırı (yoksa varsayılan), POS oranında şubenin sütunu */
async function baseValue(db: Reader, key: VersionKey, branchId: string): Promise<number> {
  if (key === POS_RATE_KEY) {
    const [b] = await db.select({ posRate: s.branches.posRate }).from(s.branches).where(eq(s.branches.id, branchId)).limit(1);
    if (!b) throw new UserError("Şube bulunamadı");
    return b.posRate ?? DEFAULT_POS_RATE;
  }
  const rows = await db.select().from(s.settings).where(eq(s.settings.key, key));
  return (settingsFromRows(rows) as Settings)[key] ?? DEFAULT_SETTINGS[key];
}

export interface SettingChange {
  key: VersionKey;
  /** Şubenin POS oranında şubenin kimliği; genel ayarda boş */
  branchId?: string;
  value: number;
  month: string;
  mode: ChangeMode;
  by: string;
  note?: string | null;
}

export interface AppliedChange {
  key: VersionKey;
  branchId: string;
  before: number;
  after: number;
  affected: { from: string; through: string | null };
  /** İşlem geçmişinin satırı */
  text: string;
}

/**
 * Bir ayarı ayından itibaren (ya da yalnız o ay) değiştirir. Değer o ayda zaten aynıysa null (yazılmaz). Değiştirdiği
 * aylardan biri kapalıysa UserError. İşlemin (tx) içinde çağrılır; anahtarın sürümleri satır kilidiyle okunur
 */
export async function applySettingChange(tx: Reader, c: SettingChange, branchName?: string | null): Promise<AppliedChange | null> {
  const branchId = c.key === POS_RATE_KEY ? (c.branchId ?? "") : "";
  if (c.key === POS_RATE_KEY && !branchId) throw new UserError("Şube seçilmedi");
  if (!isMonth(c.month)) throw new UserError("Geçerli bir ay seçin");
  if (!versionValueValid(c.key, c.value)) throw new UserError(`${VERSION_KEY_INFO[c.key].label}: geçersiz değer`);
  const rows = await tx
    .select()
    .from(s.settingVersions)
    .where(and(eq(s.settingVersions.key, c.key), eq(s.settingVersions.branchId, branchId)))
    .for("update");
  const sorted = versionsOf(rows.map(toVersion), c.key, branchId);
  const base = await baseValue(tx, c.key, branchId);
  const plan = planChange(sorted, base, c.value, c.month, c.mode);
  if (!plan) return null;
  const closed = closedMonthIn(plan.affected, Object.keys((await loadClosedPeriods(tx)).months));
  if (closed) {
    throw new UserError(
      `${fromMonthText(closed)} kapalı: bu değişiklik kapalı ayın rakamını değiştirirdi. Kapalı aydan sonraki bir ay seçin ya da önce dönemi açın (Ayarlar › Dönem kapanışı).`,
    );
  }
  for (const u of plan.upserts) {
    await tx
      .insert(s.settingVersions)
      .values({ key: c.key, branchId, fromMonth: u.fromMonth, value: u.value, note: c.note ?? null, createdBy: c.by })
      .onConflictDoUpdate({
        target: [s.settingVersions.key, s.settingVersions.branchId, s.settingVersions.fromMonth],
        set: { value: u.value, note: c.note ?? null, createdBy: c.by, createdAt: new Date() },
      });
  }
  if (plan.deletes.length) {
    await tx
      .delete(s.settingVersions)
      .where(and(eq(s.settingVersions.key, c.key), eq(s.settingVersions.branchId, branchId), inArray(s.settingVersions.fromMonth, plan.deletes)));
  }
  return { key: c.key, branchId, before: plan.before, after: c.value, affected: plan.affected, text: changeLogText(c.key, plan.before, c.value, plan.affected, branchName) };
}

/**
 * Sürümü kaldırır ("Geri al"): o aydan sonraki sürüme kadar önceki değer geçer. Başlangıç sürümü (ilk sürüm, göçün
 * yazdığı) kaldırılmaz; değiştirdiği aylardan biri kapalıysa UserError. Dönüş işlem geçmişinin satırı
 */
export async function removeSettingVersion(tx: Reader, id: number): Promise<{ key: VersionKey; branchId: string; text: string }> {
  const [row] = await tx.select().from(s.settingVersions).where(eq(s.settingVersions.id, id)).for("update");
  if (!row || !(row.key === POS_RATE_KEY || isMonthSettingKey(row.key))) throw new UserError("Değişiklik bulunamadı (sayfayı yenileyin)");
  const key = row.key as VersionKey;
  const rows = await tx
    .select()
    .from(s.settingVersions)
    .where(and(eq(s.settingVersions.key, key), eq(s.settingVersions.branchId, row.branchId)));
  const sorted = versionsOf(rows.map(toVersion), key, row.branchId);
  if (row.fromMonth <= BASE_MONTH) throw new UserError("Başlangıç değeri kaldırılamaz; değiştirmek için yeni bir değer girin.");
  const base = await baseValue(tx, key, row.branchId);
  const eff = removalEffect(sorted, base, row.fromMonth);
  const closed = closedMonthIn(eff, Object.keys((await loadClosedPeriods(tx)).months));
  if (closed) throw new UserError(`${fromMonthText(closed)} kapalı: kaldırmak kapalı ayın rakamını değiştirirdi. Önce dönemi açın (Ayarlar › Dönem kapanışı).`);
  await tx.delete(s.settingVersions).where(eq(s.settingVersions.id, row.id));
  // Kaldırınca önceki sürümle aynı kalan sonraki sürüm gereksizdir (değer değişmez): silinir
  const rest = new Map(sorted.filter((v) => v.id !== row.id).map((v) => [v.fromMonth, v.value]));
  const extra = redundantMonths(rest);
  if (extra.length) {
    await tx
      .delete(s.settingVersions)
      .where(and(eq(s.settingVersions.key, key), eq(s.settingVersions.branchId, row.branchId), inArray(s.settingVersions.fromMonth, extra)));
  }
  return {
    key,
    branchId: row.branchId,
    text: `${VERSION_KEY_INFO[key].label}: ${fromMonthText(row.fromMonth)} değişikliği (${versionValueText(key, row.value)}) kaldırıldı, ${versionValueText(key, eff.back)} geçerli`,
  };
}
