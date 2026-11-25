import "server-only";

import { eq } from "drizzle-orm";

import { readLafposSwitchDay } from "@/lib/constants";
import { branchSwitchDay, LAFPOS_SWITCH_KEY, lafposBranchOf } from "@/lib/lafpos/switch";

import { getDb, schema as s, type DB } from "../db";

/**
 * LafPOS'un şubesinin sunucu okuyucusu (şube kapsamı B6; docs/LAFPOS.md › Şubeler): kütükte kasa kaynağı LafPOS olan
 * etkin fiziksel şube, yoksa geri düşüş `LAFPOS_BRANCH_ID` (saf kural `lafposBranchOf`, src/lib/lafpos/switch.ts).
 * Gün sonunun yazıldığı şube, geçiş gününün kasası, LafPOS'un fotoğraf, kasadan çıkan ve devir uçları bunu okur.
 *
 * Önbellekli: değer kurulumun tamamı için tektir ve yalnız Şubeler'de kasa kaynağı değişince değişir; kasanın her
 * gönderimi, zil ve gün sonu otomasyonu ayrı sorgu atmasın diye bağlantı (ya da işlem) başına `LAFPOS_BRANCH_CACHE_MS` boyunca
 * saklanır. Şube eylemleri (src/server/actions/branches.ts) yazınca `forgetLafposBranch` ile hemen düşer; başka bir
 * sunucu örneğinde en geç `CACHE_MS` sonra yenilenir. İşlemin (`tx`) içinden okunan değer o işlemin kendi okumasıdır.
 */

type Reader = Pick<DB, "select">;

/** Önbelleğin süresi: kasa kaynağı değiştikten sonra başka sunucu örneklerinin en geç bu kadar eski değeri görür */
export const LAFPOS_BRANCH_CACHE_MS = 60_000;

let cache = new WeakMap<object, { at: number; id: string }>();

/** LafPOS'un şubesi (türetilmiş; önbellekli). `now` testler için */
export async function lafposBranchId(db: Reader = getDb(), now: number = Date.now()): Promise<string> {
  const hit = cache.get(db);
  if (hit && now - hit.at < LAFPOS_BRANCH_CACHE_MS) return hit.id;
  const rows = await db.select({ id: s.branches.id, kind: s.branches.kind, posSource: s.branches.posSource, active: s.branches.active, sortOrder: s.branches.sortOrder, name: s.branches.name }).from(s.branches);
  // Kütüğün sırası (sortBranches ile aynı: sıra, sonra ad): birden çok LafPOS şubesinde seçim sabit kalsın
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
  const id = lafposBranchOf(rows);
  cache.set(db, { at: now, id });
  return id;
}

/** Önbelleği düşürür (şube eklendi, kasa kaynağı ya da durumu değişti, şube silindi) */
export function forgetLafposBranch(): void {
  cache = new WeakMap();
}

/**
 * Bir şubenin kasasının geçiş günü (branchSwitchDay, türetilmiş LafPOS şubesiyle): geçiş günü ayarı ve LafPOS'un şubesi
 * birlikte okunur. Tek kasanın gününe bakan sunucu okumaları bunu çağırır
 */
export async function loadBranchSwitchDay(branchId: string | null | undefined, db: Reader = getDb()): Promise<string | null> {
  // Ayar status.ts loadLafposSwitchDay ile aynı okunur (o dosya bunu içe aktarır; döngü olmasın diye burada yeniden)
  const [[setting], lafposBranch] = await Promise.all([
    db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1),
    lafposBranchId(db),
  ]);
  return branchSwitchDay(readLafposSwitchDay(setting?.value), branchId, lafposBranch);
}
