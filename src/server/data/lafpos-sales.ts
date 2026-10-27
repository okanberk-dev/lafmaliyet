import "server-only";

import { and, asc, countDistinct, gte, lte, sql, sum, type SQL } from "drizzle-orm";

import type { LafposSalesMonth, SalesLine } from "@/lib/calc/types";
import { lafposMonthStatus, lafposSalesCountFrom, mergeSalesSources, modposThroughOf, type LafposDaysOfMonth, type LafposMonthLine, type SalesSources } from "@/lib/lafpos/sales";
import { addDays, shiftMonth } from "@/lib/reminders";
import { schema as s, type DB } from "@/server/db";

/**
 * Süren ayın kasa raporu gelmemiş LafPOS günleri: `month` ayında `after` gününden sonraki günler sayılmaz, kasa raporu
 * girilince sayılır (kasa raporlarının son günü; docs/LAFPOS.md › Kapsam)
 */
export interface LafposHold {
  month: string;
  after: string;
}

/**
 * LafPOS satışlarının aylık modele okunması (docs/LAFPOS.md › Günlük satış; kural src/lib/lafpos/sales.ts). Yalnız
 * geçiş günü seçiliyken çağrılır: `from` (lafposSalesCountFrom) gününden itibaren pos_daily_sales (ay, POS adı, ürün,
 * hizmet) başına toplanır, pos_day_reports ay ay sayılır. Geçiş günü yoksa hiçbir okuma yapılmaz. `hold` verilirse süren
 * ayın kasa raporundan sonraki günleri satırlara ve `days`'e girmez, yalnız `received`'da (gelen bütün günler) ve
 * `dates`'te görünür.
 */
export async function loadLafposMonthSales(
  db: DB,
  from: string,
  to?: string,
  hold?: LafposHold | null,
): Promise<{ lines: LafposMonthLine[]; days: LafposDaysOfMonth[]; received: LafposDaysOfMonth[]; dates: string[] }> {
  const d = s.posDailySales;
  const r = s.posDayReports;
  const lineMonth = sql<string>`substr(${d.date}, 1, 7)`;
  const range = (col: typeof d.date | typeof r.date): SQL | undefined => (to ? and(gte(col, from), lte(col, to)) : gte(col, from));
  // Bekleyen gün: süren ayda kasa raporlarının son gününden sonra
  const isHeld = (day: string) => !!hold && day > hold.after && day.slice(0, 7) === hold.month;
  const [lines, reports] = await Promise.all([
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
      .where(and(range(d.date), hold ? sql`not (${d.date} > ${hold.after} and substr(${d.date}, 1, 7) = ${hold.month})` : undefined))
      .groupBy(lineMonth, d.posName, d.productId, d.isService),
    // Gün başına bir özet (tarih benzersiz)
    db.select({ date: r.date }).from(r).where(range(r.date)).orderBy(asc(r.date)),
  ]);
  const dates = reports.map((x) => x.date);
  return {
    lines: lines.map((l) => ({ ...l, qty: l.qty ?? 0, revenue: l.revenue ?? 0 })),
    days: daysByMonth(dates.filter((x) => !isHeld(x))),
    received: daysByMonth(dates),
    dates,
  };
}

/** Sıralı günlerden ay ay gün sayısı ve son gün */
function daysByMonth(dates: readonly string[]): LafposDaysOfMonth[] {
  const out = new Map<string, LafposDaysOfMonth>();
  for (const date of dates) {
    const month = date.slice(0, 7);
    const m = out.get(month);
    if (m) {
      m.days++;
      if (date > m.last) m.last = date;
    } else out.set(month, { month, days: 1, last: date });
  }
  return [...out.values()];
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
    /**
     * Kasa raporlarının son günü (veri kümesi): süren ayın bundan sonraki LafPOS günleri kasa raporu girilince sayılır.
     * LafPOS gün sonunu kapanışta yollar, kasa raporu ondan sonra (çoğu kez ertesi sabah) girilir; o arada satırlar kasa
     * döneminden bir gün ileride olur, liste ↔ POS cirosu karşılaştırması ve günlük ortalama yanlış dönemle yapılırdı
     * (denetim B08 incelemesi). Süren ayda kasa raporu yoksa bekletilmez: ayın kasa dönemi yok, karşılaştırma da yok
     */
    lastTillDay?: string | null;
    /** Kasa raporu olan günler (veri kümesi): LafPOS gün sonu gelmemiş raporlu gün Satışlar'da ve Genel bakış'ta uyarılır */
    reportDays?: readonly string[];
  },
): Promise<MergedSales> {
  const S = input.switchDay;
  const countFrom = lafposSalesCountFrom(S, input.salesLines, input.coverage);
  if (S === null || countFrom === null) return { salesLines: input.salesLines, coverage: { ...input.coverage }, lafposSales: null };
  const running = input.today.slice(0, 7);
  const hold = input.lastTillDay?.slice(0, 7) === running ? { month: running, after: input.lastTillDay } : null;
  const lafpos = await loadLafposMonthSales(db, countFrom, input.toMonth ? `${input.toMonth}-31` : undefined, hold);
  const merged = mergeSalesSources({ switchDay: S, salesLines: input.salesLines, coverage: input.coverage, lafposLines: lafpos.lines, lafposDays: lafpos.days });
  // Özet: geçiş ayından, verisi olan son aya (en az bu ay ve geçiş ayı) kadar her ay
  const switchMonth = S.slice(0, 7);
  const dataMonths = [...input.salesLines.map((l) => l.month), ...lafpos.days.map((x) => x.month)].filter((m) => m >= switchMonth);
  const last = [switchMonth, input.today.slice(0, 7), ...dataMonths].reduce((a, b) => (b > a ? b : a));
  const months: LafposSalesMonth[] = [];
  for (let m = switchMonth; m <= last; m = shiftMonth(m, 1)) {
    const list = input.salesLines.filter((l) => l.month === m);
    const through = modposThroughOf(m, input.coverage);
    const days = lafpos.received.find((x) => x.month === m) ?? null;
    const counted = lafpos.days.find((x) => x.month === m) ?? null;
    const st = lafposMonthStatus({
      month: m,
      switchDay: S,
      today: input.today,
      modpos: list.length ? { lines: list.length, revenue: list.reduce((a, l) => a + l.revenue, 0), through } : null,
      lafpos: days ? { days: days.days, last: days.last } : null,
      modposZ: list.length && input.zOf ? input.zOf(`${m}-01`, through) : null,
      kasaDays: input.reportDays?.filter((x) => x.slice(0, 7) === m),
      lafposDates: lafpos.dates.filter((x) => x.slice(0, 7) === m),
      // Kasa raporunu bekleyen günler: gelen son gün sayılan son günden sonraysa
      held: hold && m === hold.month && days && (!counted || days.last > counted.last) ? { from: addDays(hold.after, 1), to: days.last } : null,
    });
    if (st) months.push(st);
  }
  return { ...merged, lafposSales: { switchDay: S, countFrom, months } };
}
