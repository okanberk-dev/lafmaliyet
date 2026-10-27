import "server-only";

import { and, count, countDistinct, gte, lte, max, sql, sum, type SQL } from "drizzle-orm";

import type { LafposSalesMonth, SalesLine } from "@/lib/calc/types";
import { lafposMonthStatus, lafposSalesCountFrom, mergeSalesSources, modposThroughOf, type LafposDaysOfMonth, type LafposMonthLine, type SalesSources } from "@/lib/lafpos/sales";
import { shiftMonth } from "@/lib/reminders";
import { schema as s, type DB } from "@/server/db";

/**
 * LafPOS satışlarının aylık modele okunması (docs/LAFPOS.md › Günlük satış; kural src/lib/lafpos/sales.ts). Yalnız
 * geçiş günü seçiliyken çağrılır: `from` (lafposSalesCountFrom) gününden itibaren pos_daily_sales (ay, POS adı, ürün,
 * hizmet) başına toplanır, pos_day_reports ay ay sayılır. Geçiş günü yoksa hiçbir okuma yapılmaz.
 */
export async function loadLafposMonthSales(db: DB, from: string, to?: string): Promise<{ lines: LafposMonthLine[]; days: LafposDaysOfMonth[] }> {
  const d = s.posDailySales;
  const r = s.posDayReports;
  const lineMonth = sql<string>`substr(${d.date}, 1, 7)`;
  const dayMonth = sql<string>`substr(${r.date}, 1, 7)`;
  const range = (col: typeof d.date | typeof r.date): SQL | undefined => (to ? and(gte(col, from), lte(col, to)) : gte(col, from));
  const [lines, days] = await Promise.all([
    db
      .select({
        month: lineMonth,
        posName: d.posName,
        productId: d.productId,
        isService: d.isService,
        qty: sum(d.qty).mapWith(Number),
        revenue: sum(d.revenue).mapWith(Number),
        days: countDistinct(d.date),
      })
      .from(d)
      .where(range(d.date))
      .groupBy(lineMonth, d.posName, d.productId, d.isService),
    db
      .select({ month: dayMonth, days: count(), last: max(r.date) })
      .from(r)
      .where(range(r.date))
      .groupBy(dayMonth),
  ]);
  return {
    lines: lines.map((l) => ({ ...l, qty: l.qty ?? 0, revenue: l.revenue ?? 0 })),
    days: days.flatMap((x) => (x.last ? [{ month: x.month, days: x.days, last: x.last }] : [])),
  };
}

export interface MergedSales extends SalesSources {
  /** Geçiş günü seçiliyse kaynakların özeti (Dataset.lafposSales); yoksa null */
  lafposSales: { switchDay: string; countFrom: string; months: LafposSalesMonth[] } | null;
}

/**
 * Satış satırlarını geçiş gününe göre birleştirir (veri kümesi ve tatlı payı). Geçiş günü yoksa girdi olduğu gibi
 * döner, LafPOS tablosu okunmaz. `zOf(from, through)`: kasa raporlarının o günlerdeki Z toplamı (rapor yoksa null;
 * geçiş ayında liste ↔ Z karşılaştırması). `today`: iş günü; `currentMonth`: özetin son ayı en az bu.
 */
export async function mergeWithLafpos(
  db: DB,
  input: {
    switchDay: string | null;
    salesLines: SalesLine[];
    coverage: Record<string, string>;
    today: string;
    zOf?: (from: string, through: string) => number | null;
    /** Yalnız bu aya kadar (dahil) okunur (tatlı payı); verilmezse hepsi */
    toMonth?: string;
  },
): Promise<MergedSales> {
  const S = input.switchDay;
  const countFrom = lafposSalesCountFrom(S, input.salesLines, input.coverage);
  if (S === null || countFrom === null) return { salesLines: input.salesLines, coverage: { ...input.coverage }, lafposSales: null };
  const lafpos = await loadLafposMonthSales(db, countFrom, input.toMonth ? `${input.toMonth}-31` : undefined);
  const merged = mergeSalesSources({ switchDay: S, salesLines: input.salesLines, coverage: input.coverage, lafposLines: lafpos.lines, lafposDays: lafpos.days });
  // Özet: geçiş ayından, verisi olan son aya (en az bu ay ve geçiş ayı) kadar her ay
  const switchMonth = S.slice(0, 7);
  const dataMonths = [...input.salesLines.map((l) => l.month), ...lafpos.days.map((x) => x.month)].filter((m) => m >= switchMonth);
  const last = [switchMonth, input.today.slice(0, 7), ...dataMonths].reduce((a, b) => (b > a ? b : a));
  const months: LafposSalesMonth[] = [];
  for (let m = switchMonth; m <= last; m = shiftMonth(m, 1)) {
    const list = input.salesLines.filter((l) => l.month === m);
    const through = modposThroughOf(m, input.coverage);
    const days = lafpos.days.find((x) => x.month === m) ?? null;
    const st = lafposMonthStatus({
      month: m,
      switchDay: S,
      today: input.today,
      modpos: list.length ? { lines: list.length, revenue: list.reduce((a, l) => a + l.revenue, 0), through } : null,
      lafpos: days ? { days: days.days, last: days.last } : null,
      modposZ: list.length && input.zOf ? input.zOf(`${m}-01`, through) : null,
    });
    if (st) months.push(st);
  }
  return { ...merged, lafposSales: { switchDay: S, countFrom, months } };
}
