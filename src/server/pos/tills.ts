import "server-only";

import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { ASILPOS_GROUP } from "@/lib/branch-settings/groups";
import { activePosTillIds, posTillIds, switchDayFor, type PosTills, type SwitchDays } from "@/lib/pos/tills";
import { resolveBranchSetting, resolveForTills } from "@/server/branch-settings";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * AsilPOS kasalarının sunucu okuyucusu (çok şube; docs/ASILPOS.md › Şubeler; kural src/lib/pos/tills.ts). Kasalar
 * kütükten (kasa kaynağı AsilPOS olan fiziksel şubeler), geçiş günleri şubelerin kendi ayarından okunur.
 *
 * Kasaların listesi önbellekli: yalnız Şubeler'de kasa kaynağı değişince değişir; kasanın her gönderimi, zil ve gün sonu
 * otomasyonu ayrı sorgu atmasın diye bağlantı (ya da işlem) başına `POS_TILLS_CACHE_MS` boyunca saklanır. Şube eylemleri
 * yazınca `forgetPosTills` ile hemen düşer; başka bir sunucu örneğinde en geç `POS_TILLS_CACHE_MS` sonra yenilenir.
 * Geçiş günleri önbelleğe alınmaz (bugünkü gibi her okumada şube ayarından): Ayarlar'da değişen gün her sunucu örneğinde
 * hemen geçer, kapanmış ayların rakamı başka örnekte eski günle hesaplanmaz.
 */

type Reader = Pick<DB, "select">;

/** Kasa listesinin önbellek süresi */
export const POS_TILLS_CACHE_MS = 60_000;

let cache = new WeakMap<object, { at: number; ids: string[]; active: string[] }>();

/** Kasaların kimlikleri (önbellekli). `fresh`: önbelleğe bakmadan kütükten */
export async function loadPosTillIds(db: Reader = getDb(), now: number = Date.now(), fresh = false): Promise<{ ids: string[]; active: string[] }> {
  const hit = fresh ? undefined : cache.get(db);
  if (hit && now - hit.at < POS_TILLS_CACHE_MS) return hit;
  const rows = await db
    .select({ id: s.branches.id, kind: s.branches.kind, posSource: s.branches.posSource, active: s.branches.active, sortOrder: s.branches.sortOrder, name: s.branches.name })
    .from(s.branches);
  // Kütüğün sırası (sortBranches ile aynı: sıra, sonra ad)
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
  const entry = { at: now, ids: posTillIds(rows), active: activePosTillIds(rows) };
  cache.set(db, entry);
  return entry;
}

/** Önbelleği düşürür (şube eklendi, kasa kaynağı ya da durumu değişti, şube silindi; anahtar kaydedildi) */
export function forgetPosTills(): void {
  cache = new WeakMap();
}

/** Kasalar ve geçiş günleri (kasa listesi önbellekli, geçiş günleri taze) */
export async function loadPosTills(db: Reader = getDb()): Promise<PosTills> {
  const [{ ids, active }, settings] = await Promise.all([loadPosTillIds(db), resolveForTills(ASILPOS_GROUP, db, { closed: true })]);
  const switchDays: Record<string, string | null> = {};
  for (const id of ids) switchDays[id] = settings.get(id)?.value.switchDay ?? (settings.has(id) ? null : await legacySwitchDay(id, db));
  return { ids, active, switchDays };
}

/** Kütükte olmayan geri düşüş şubesinin (eski test verisi) günü: şube ayarının çözümü (eski genel kayıt dahil) */
async function legacySwitchDay(branchId: string, db: Reader): Promise<string | null> {
  return (await resolveBranchSetting(ASILPOS_GROUP, branchId, db)).value.switchDay;
}

/** Kasa başına geçiş günleri (loadPosTills'in haritası) */
export async function loadSwitchDays(db: Reader = getDb()): Promise<SwitchDays> {
  return (await loadPosTills(db)).switchDays;
}

/**
 * Verilen şubenin kasasının geçiş günü: kasası AsilPOS değilse null (o şubenin AsilPOS'tan gelen günü denemedir). Gün
 * sonunu yazan ve silen işlem bunu yazdığı şubeyle çağırır (işlemin içinden de okunur)
 */
export async function switchDayOf(branchId: string, db: Reader = getDb()): Promise<string | null> {
  const { ids } = await loadPosTillIds(db);
  if (!ids.includes(branchId)) return null;
  return (await resolveBranchSetting(ASILPOS_GROUP, branchId, db)).value.switchDay;
}

/**
 * Bir kaydın şubesinin kasasının geçiş günü (switchDayOf; şubesi verilmeyen kayıt Tuzla'nındır). Tek kasanın gününe bakan
 * sunucu okumaları (Kasa raporu, föy, zil, geç rapor, zayi) bunu çağırır
 */
export async function loadBranchSwitchDay(branchId: string | null | undefined, db: Reader = getDb()): Promise<string | null> {
  return switchDayOf(branchId ?? DEFAULT_BRANCH_ID, db);
}

/** Şubenin bu günü sayılan AsilPOS günü mü (switchDayOf) */
export async function isCountedTillDay(branchId: string, date: string, db: Reader = getDb()): Promise<boolean> {
  const day = await switchDayOf(branchId, db);
  return day !== null && date >= day;
}

export { switchDayFor };
