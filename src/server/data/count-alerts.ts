import "server-only";

import { and, asc, count, desc, eq, gt, gte, inArray, like, max } from "drizzle-orm";

import { loggedItems, type StaffLateEdit, type UnpricedExtras } from "@/app/panel/sayim/logic";
import { shiftMonth } from "@/lib/calc/engine";
import { monthLabel } from "@/lib/format";
import { getDb, schema as s } from "@/server/db";

/*
 * Yöneticiye sayım uyarılarının olguları (denetim B02): fiyatı girilmemiş ek kalemler (E-22) ve personelin ay bittikten
 * sonra geçen ayın sayımına yaptığı kayıtlar (E-19'un bildirimi). Zil (src/server/bell/ops.ts) ve Bugün
 * (src/server/data/today.ts) okur; metin src/app/panel/sayim/logic.ts'te. Yalnız yöneticide çağrılır.
 */

/** Ayların fiyatı girilmemiş ek kalemleri (miktarı > 0, birim fiyatı 0); kalemi olmayan ay dönmez */
export async function loadUnpricedExtras(months: string[]): Promise<UnpricedExtras[]> {
  if (!months.length) return [];
  const db = getDb();
  const where = and(inArray(s.stockExtras.month, months), gt(s.stockExtras.qty, 0), eq(s.stockExtras.unitPrice, 0));
  const [totals, rows] = await Promise.all([
    db.select({ month: s.stockExtras.month, n: count(), newest: max(s.stockExtras.id) }).from(s.stockExtras).where(where).groupBy(s.stockExtras.month),
    db.select({ month: s.stockExtras.month, name: s.stockExtras.name }).from(s.stockExtras).where(where).orderBy(asc(s.stockExtras.id)),
  ]);
  return totals
    .map((t) => ({ month: t.month, count: t.n, newestId: t.newest ?? 0, names: rows.filter((r) => r.month === t.month).map((r) => r.name).slice(0, 3) }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** Sayımı değiştiren işlem geçmişi kayıtları (stock.ts saveStockCounts, ek kalemler; ayrıntı "<Ay>: …") */
const COUNT_ACTIONS = ["Stok sayımı", "Sayım ek kalemleri"];

/**
 * Personelin `month` sayımına, o ay bittikten sonra (sonraki ayın 1'i 05:00, kasanın iş günü) yaptığı kayıtlar, kişi
 * başına. Kişi rolü hesabından (işlem geçmişindeki ad serbest metin); yöneticinin kayıtları sayılmaz.
 */
export async function loadStaffLateEdits(month: string): Promise<StaffLateEdit[]> {
  const since = new Date(`${shiftMonth(month, 1)}-01T05:00:00+03:00`);
  const rows = await getDb()
    .select({ id: s.activityLog.id, at: s.activityLog.at, name: s.activityLog.userName, userId: s.activityLog.userId, detail: s.activityLog.detail })
    .from(s.activityLog)
    .innerJoin(s.users, eq(s.users.id, s.activityLog.userId))
    .where(
      and(
        eq(s.users.role, "staff"),
        inArray(s.activityLog.action, COUNT_ACTIONS),
        like(s.activityLog.detail, `${monthLabel(month)}:%`),
        gte(s.activityLog.at, since),
      ),
    )
    .orderBy(desc(s.activityLog.id))
    .limit(200);
  const byUser = new Map<number, StaffLateEdit>();
  for (const r of rows) {
    const key = r.userId!;
    const e = byUser.get(key) ?? { name: r.name ?? "Personel", saves: 0, items: 0, lastAt: r.at.toISOString(), lastId: r.id };
    e.saves += 1;
    e.items += loggedItems(r.detail);
    byUser.set(key, e);
  }
  return [...byUser.values()];
}
