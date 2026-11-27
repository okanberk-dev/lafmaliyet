import "server-only";

import { and, asc, count, desc, eq, gt, gte, inArray, like, max } from "drizzle-orm";

import { countLogBranch, loggedItems, type StaffLateEdit, type UnpricedExtras } from "@/app/panel/sayim/logic";
import { ALL_BRANCHES, type BranchScope, namedTill } from "@/lib/branches";
import { shiftMonth } from "@/lib/calc/engine";
import { monthLabel } from "@/lib/format";
import { branchWhereWithShared, currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

/*
 * Yöneticiye sayım uyarılarının olguları (denetim B02): fiyatı girilmemiş ek kalemler (E-22) ve personelin ay bittikten
 * sonra geçen ayın sayımına yaptığı kayıtlar (E-19'un bildirimi). Zil (src/server/bell/ops.ts) ve Bugün
 * (src/server/data/today.ts) okur; metin src/app/panel/sayim/logic.ts'te. Yalnız yöneticide çağrılır.
 */

/**
 * Ayların fiyatı girilmemiş ek kalemleri (miktarı > 0, birim fiyatı 0); kalemi olmayan ay dönmez. İşletme geneli (bütün
 * şubeler: fiyatı yönetici girer), ama "Listede olmayanlar" şube başına olduğu için ay ve şube başına ayrı satır; birden
 * çok şube açıkken satır şubeyi adıyla söyler ve o şubenin sayımını açar (21 Kasım denetimi #19/#24). Sıra: yeni ay
 * önce, ayın içinde şube sırası. `scope` (varsayılan isteğin seçimi): tek şube seçiliyken yalnız o şubenin sayımının
 * kalemleri (şube kapsamı C P1-2)
 */
export async function loadUnpricedExtras(months: string[], scope?: BranchScope): Promise<UnpricedExtras[]> {
  if (!months.length) return [];
  const db = getDb();
  const sc = scope ?? (await currentBranchScope());
  const where = and(
    inArray(s.stockExtras.month, months),
    gt(s.stockExtras.qty, 0),
    eq(s.stockExtras.unitPrice, 0),
    sc === ALL_BRANCHES ? undefined : eq(s.stockExtras.branchId, sc),
  );
  const [totals, rows, branches] = await Promise.all([
    db
      .select({ month: s.stockExtras.month, branchId: s.stockExtras.branchId, n: count(), newest: max(s.stockExtras.id) })
      .from(s.stockExtras)
      .where(where)
      .groupBy(s.stockExtras.month, s.stockExtras.branchId),
    db.select({ month: s.stockExtras.month, branchId: s.stockExtras.branchId, name: s.stockExtras.name }).from(s.stockExtras).where(where).orderBy(asc(s.stockExtras.id)),
    listBranches(db),
  ]);
  const order = (id: string) => {
    const i = branches.findIndex((b) => b.id === id);
    return i < 0 ? branches.length : i;
  };
  return totals
    .sort((a, b) => (a.month === b.month ? order(a.branchId) - order(b.branchId) : a.month < b.month ? 1 : -1))
    .map((t) => ({
      month: t.month,
      // Sayımın şubeleri kasası olan şubelerdir (etkin fiziksel): birden çok açıkken ad ve `&sube=`, tekse null
      branch: namedTill(branches, t.branchId),
      count: t.n,
      newestId: t.newest ?? 0,
      names: rows.filter((r) => r.month === t.month && r.branchId === t.branchId).map((r) => r.name).slice(0, 3),
    }));
}

/** Sayımı değiştiren işlem geçmişi kayıtları (stock.ts saveStockCounts, ek kalemler; ayrıntı "<Ay>: …") */
const COUNT_ACTIONS = ["Stok sayımı", "Sayım ek kalemleri"];

/**
 * Personelin `month` sayımına, o ay bittikten sonra (sonraki ayın 1'i 05:00, kasanın iş günü) yaptığı kayıtlar, kişi
 * başına. Kişi rolü hesabından (işlem geçmişindeki ad serbest metin); yöneticinin kayıtları sayılmaz. `scope` (varsayılan
 * isteğin seçimi): tek şube seçiliyken yalnız o şubenin sayımına yapılanlar (şube kapsamı C P1-2; şube kaydın
 * ayrıntısının sonunda, `countLogBranch`). Şubesi yazılmamış eski kayıt her şubede sayılır
 */
export async function loadStaffLateEdits(month: string, scope?: BranchScope): Promise<StaffLateEdit[]> {
  const since = new Date(`${shiftMonth(month, 1)}-01T05:00:00+03:00`);
  const sc = scope ?? (await currentBranchScope());
  const branches = sc === ALL_BRANCHES ? [] : await listBranches();
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
        // Kaydın şubesi (şube ayrımı, migration 0101): şubesiz eski kayıt ayrıntısındaki şubeyle aşağıda süzülür
        branchWhereWithShared(s.activityLog.branchId, sc),
      ),
    )
    .orderBy(desc(s.activityLog.id))
    .limit(200);
  const byUser = new Map<number, StaffLateEdit>();
  for (const r of rows) {
    if (sc !== ALL_BRANCHES) {
      const b = countLogBranch(r.detail, branches);
      if (b !== null && b !== sc) continue;
    }
    const key = r.userId!;
    const e = byUser.get(key) ?? { name: r.name ?? "Personel", saves: 0, items: 0, lastAt: r.at.toISOString(), lastId: r.id };
    e.saves += 1;
    e.items += loggedItems(r.detail);
    byUser.set(key, e);
  }
  return [...byUser.values()];
}
