import "server-only";

import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { leakReport, type LeakReport } from "@/lib/kacak";
import { addDays, shiftMonth } from "@/lib/reminders";
import { countedQty, STOCK_ESTIMATE_BRANCH } from "@/lib/stock-estimate";
import { requireAdmin } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { closedDaysBetween } from "@/server/closed-days";
import { loadModel } from "@/server/data/dataset";
import { loadStockEstimate } from "@/server/data/stock-estimate";
import { getDb, schema as s } from "@/server/db";

export type LeakState =
  /** Rapor var */
  | "ok"
  /** Marina LafPOS'a geçmedi (geçiş günü yok): satış gün gün bilinmiyor, tahmin yok */
  | "lafpos-yok"
  /** Seçilen ay Marina'da sayılmadı */
  | "sayim-yok"
  /** Ay bitmedi: ay sonu sayımı ay bitince */
  | "ay-bitmedi";

export interface LeakData {
  month: string;
  state: LeakState;
  /** Şubenin adı (Marina) */
  branchName: string;
  /** Marina'nın sayıldığı bitmiş aylar (seçici) */
  months: string[];
  /** LafPOS satışlarının sayıldığı ilk gün: tahmin bu günden sonra başlayan dönemde var */
  lafposFrom: string | null;
  report: LeakReport | null;
}

/**
 * Marina ay sonu kaçak raporu (docs/RAPORLAR.md › Kaçak raporu; hesap src/lib/kacak.ts). Yalnız yönetici; hep Marina'nın
 * (tahmini stoğun şubesi, LafPOS'un şubesi; soldaki seçimden bağımsız). Tahmin ayın son günüyle okunur
 * (loadStockEstimate, o ayın sayımı başlangıç sayılmaz), ayın sayımıyla karşılaştırılır, fark Stok sayımı'nın ay sonu
 * birim maliyetiyle (unitCostAtMonthEnd) TL'ye çevrilir. Yalnız okur.
 */
export async function loadLeakReport(month: string | null, now: Date = new Date()): Promise<LeakData> {
  await requireAdmin();
  const db = getDb();
  const current = businessDate(now).slice(0, 7);
  const [branches, countMonths] = await Promise.all([
    listBranches(db),
    db
      .selectDistinct({ month: s.stockCounts.month })
      .from(s.stockCounts)
      .where(and(eq(s.stockCounts.branchId, STOCK_ESTIMATE_BRANCH), lt(s.stockCounts.month, current)))
      .orderBy(asc(s.stockCounts.month)),
  ]);
  const months = countMonths.map((r) => r.month);
  const branchName = branches.find((b) => b.id === STOCK_ESTIMATE_BRANCH)?.name ?? "Marina";
  // Varsayılan: Marina'nın sayıldığı son bitmiş ay; hiç yoksa geçen ay
  const chosen = month ?? months[months.length - 1] ?? shiftMonth(current, -1);
  const base = { month: chosen, branchName, months, lafposFrom: null, report: null };
  if (chosen >= current) return { ...base, state: "ay-bitmedi" };

  const monthEnd = addDays(`${shiftMonth(chosen, 1)}-01`, -1);
  const data = await loadStockEstimate(db, now, { asOf: monthEnd });
  if (!data) return { ...base, state: "lafpos-yok" };

  const [countRows, model, monthEndReceived, monthEndClosed] = await Promise.all([
    db
      .select({ ingredientId: s.stockCounts.ingredientId, qty: s.stockCounts.qty, factor: s.stockCounts.factor })
      .from(s.stockCounts)
      .where(and(eq(s.stockCounts.branchId, STOCK_ESTIMATE_BRANCH), eq(s.stockCounts.month, chosen))),
    loadModel({ scope: STOCK_ESTIMATE_BRANCH }),
    db
      .select({ date: s.posDayReports.date })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.branchId, STOCK_ESTIMATE_BRANCH), eq(s.posDayReports.date, monthEnd)))
      .limit(1),
    closedDaysBetween(monthEnd, monthEnd, db, STOCK_ESTIMATE_BRANCH),
  ]);
  if (!countRows.length) return { ...base, lafposFrom: data.lafposFrom, state: "sayim-yok" };

  const ids = [...new Set(countRows.map((r) => r.ingredientId))];
  const ings = await db.select({ id: s.ingredients.id, countUnit: s.ingredients.countUnit }).from(s.ingredients).where(inArray(s.ingredients.id, ids));
  const unitOf = new Map(ings.map((i) => [i.id, i.countUnit]));
  const counts = countRows.map((r) => ({ ingredientId: r.ingredientId, qty: countedQty(r, unitOf.get(r.ingredientId) ?? null) }));
  // Tahmin "bugün hariç" gün sonu arar: ayın son günü gelmediyse (kapalı da değilse) o da eksik
  const extraMissing = data.estimate.from !== null && monthEnd >= data.estimate.from && !monthEndReceived.length && !monthEndClosed.length ? [monthEnd] : [];
  const report = leakReport(
    chosen,
    data.estimate,
    counts,
    (id) => {
      const v = model.unitCostAtMonthEnd(id, chosen);
      return v > 0 ? v : null;
    },
    { extraMissing },
  );
  return { ...base, lafposFrom: data.lafposFrom, state: "ok", report };
}
