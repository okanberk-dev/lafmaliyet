import "server-only";

import { and, asc, countDistinct, gte, lte, sql, sum, type SQL } from "drizzle-orm";

import type { LafposSalesMonth, SalesLine } from "@/lib/calc/types";
import {
  commonListCuts,
  lafposMonthStatus,
  lafposSalesCountFrom,
  mergeSalesSources,
  modposThroughOf,
  type LafposDaysOfMonth,
  type LafposMonthLine,
  type OtherBranchList,
  type SalesSources,
} from "@/lib/lafpos/sales";
import { isLafposBranch } from "@/lib/lafpos/switch";
import { addDays, shiftMonth } from "@/lib/reminders";
import { currentBranchWhere } from "@/server/branch-scope";
import { schema as s, type DB } from "@/server/db";
import { lafposBranchId } from "@/server/lafpos/branch";

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
 * `dates`'te görünür. `cuts` ("Tümü"nün ortak dönemi, commonListCuts; bulgu 62): o ayın kesilen günden sonraki günleri
 * de satırlara, `days`'e ve satır ↔ Z denetimine girmez (`received`'da ve `dates`'te görünür).
 */
export async function loadLafposMonthSales(
  db: DB,
  from: string,
  to?: string,
  hold?: LafposHold | null,
  cuts: readonly LafposHold[] = [],
): Promise<{
  lines: LafposMonthLine[];
  days: LafposDaysOfMonth[];
  received: LafposDaysOfMonth[];
  dates: string[];
  /** Sayılan günlerin ürün satırları toplamı ve Z'si (Satışlar'ın denetimi: Σ ciro = zTotal) */
  linesVsZ: { date: string; lines: number; z: number }[];
}> {
  const d = s.posDailySales;
  const r = s.posDayReports;
  const lineMonth = sql<string>`substr(${d.date}, 1, 7)`;
  const range = (col: typeof d.date | typeof r.date): SQL | undefined => (to ? and(gte(col, from), lte(col, to)) : gte(col, from));
  // Bekleyen gün: süren ayda kasa raporlarının son gününden sonra; "Tümü"nün ortak döneminden sonraki gün de sayılmaz
  const outside = (h: LafposHold, day: string) => day > h.after && day.slice(0, 7) === h.month;
  const isHeld = (day: string) => (!!hold && outside(hold, day)) || cuts.some((c) => outside(c, day));
  // Seçili şubenin gün sonları ("Tümü"de koşul yok; docs/SUBE.md › Seçici)
  const [subeSatir, subeGun] = await Promise.all([currentBranchWhere(d.branchId), currentBranchWhere(r.branchId)]);
  const notHeld = and(...[...(hold ? [hold] : []), ...cuts].map((h) => sql`not (${d.date} > ${h.after} and substr(${d.date}, 1, 7) = ${h.month})`));
  const [lines, reports, perDay] = await Promise.all([
    db
      .select({
        month: lineMonth,
        posName: d.posName,
        productId: d.productId,
        isService: d.isService,
        qty: sum(d.qty).mapWith(Number),
        revenue: sum(d.revenue).mapWith(Number),
        // Faz 2: indirimden önceki liste değeri; günlerden biri brütsüz (eski LafPOS) geldiyse bilinmez (null)
        gross: sql<string | null>`case when count(${d.gross}) = count(*) then sum(${d.gross}) else null end`,
        isAddon: sql<boolean>`coalesce(bool_or(${d.isAddon}), false)`,
        days: countDistinct(d.date),
      })
      .from(d)
      .where(and(range(d.date), subeSatir, notHeld))
      .groupBy(lineMonth, d.posName, d.productId, d.isService),
    // Gün başına bir özet (tarih benzersiz); Z toplamı satırlar ↔ Z denetimi için
    db.select({ date: r.date, z: r.z }).from(r).where(and(range(r.date), subeGun)).orderBy(asc(r.date)),
    db
      .select({ date: d.date, revenue: sum(d.revenue).mapWith(Number) })
      .from(d)
      .where(and(range(d.date), subeSatir, notHeld))
      .groupBy(d.date),
  ]);
  const dates = reports.map((x) => x.date);
  const byDay = new Map(perDay.map((x) => [x.date, x.revenue ?? 0]));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    lines: lines.map((l) => ({ ...l, qty: l.qty ?? 0, revenue: l.revenue ?? 0, gross: l.gross === null || l.gross === undefined ? null : r2(Number(l.gross)), isAddon: Boolean(l.isAddon) })),
    days: daysByMonth(dates.filter((x) => !isHeld(x))),
    received: daysByMonth(dates),
    dates,
    linesVsZ: reports
      .filter((x) => !isHeld(x.date))
      .flatMap((x) => {
        const z = (x.z as { zTotal?: unknown } | null)?.zTotal;
        return typeof z === "number" ? [{ date: x.date, lines: r2(byDay.get(x.date) ?? 0), z }] : [];
      }),
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
 * döner, LafPOS tablosu okunmaz. `zOf(from, through)`: kasa raporlarının o günlerdeki Z ve indirim toplamı (rapor yoksa
 * null; geçiş ayında liste − indirim ↔ Z karşılaştırması). `today`: iş günü; `currentMonth`: özetin son ayı en az bu.
 *
 * İki kapsam: `coverage` görünümün listelerinin son günü (modelin `coverage`'ı, engine listPeriod); `lafposCoverage`
 * LafPOS'un şubesinin (Marina) kendi kaydı (src/lib/sales-coverage.ts readCoverage). LafPOS'un sayıldığı ilk gün ve
 * ayların ModPOS listesi (son günü, çakışma, liste ↔ Z) yalnız Marina'nın listesine bakar: ortak kayıt ayın tek
 * kaydıdır, Tuzla'nın aynı aya yüklediği liste onu ezer ve Marina'nın LafPOS günlerini düşürürdü.
 */
export async function mergeWithLafpos(
  db: DB,
  input: {
    switchDay: string | null;
    salesLines: SalesLine[];
    coverage: Record<string, string>;
    /** LafPOS'un şubesinin (Marina) listelerinin son günü: şubenin kendi kaydı, yoksa ortak kayıt (readCoverage) */
    lafposCoverage: Record<string, string>;
    today: string;
    zOf?: (from: string, through: string) => { z: number; discounts: number } | null;
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
    /** LafPOS'un şubesi (veri kümesi kütükten türetir); verilmezse lafposBranchId */
    lafposBranch?: string;
    /**
     * Yalnız "Tümü": ModPOS'ta kalan şubelerin listeleri (otherBranchLists; bulgu 62). LafPOS'un günleri en kısa listenin
     * son gününden sonra sayılmaz (commonListCuts), ayın dönemi o gün
     */
    others?: readonly OtherBranchList[];
  },
): Promise<MergedSales> {
  const S = input.switchDay;
  const lafposBranch = input.lafposBranch ?? (await lafposBranchId(db));
  const countFrom = lafposSalesCountFrom(S, input.salesLines, input.lafposCoverage, lafposBranch);
  if (S === null || countFrom === null) return { salesLines: input.salesLines, coverage: { ...input.coverage }, short: {}, lafposSales: null };
  const running = input.today.slice(0, 7);
  const hold = input.lastTillDay?.slice(0, 7) === running ? { month: running, after: input.lastTillDay } : null;
  const others = input.others ?? [];
  const lafpos = await loadLafposMonthSales(db, countFrom, input.toMonth ? `${input.toMonth}-31` : undefined, hold, commonListCuts(others));
  const merged = mergeSalesSources({ switchDay: S, salesLines: input.salesLines, coverage: input.coverage, lafposLines: lafpos.lines, lafposDays: lafpos.days, lafposBranch, others });
  // Özet: geçiş ayından, verisi olan son aya (en az bu ay ve geçiş ayı) kadar her ay. Yalnız LafPOS'un şubesinin
  // listesiyle: ModPOS'ta kalan şubenin listesi ("Tümü") LafPOS'la çakışmaz, ondan uyarı çıkmaz
  const own = input.salesLines.filter((l) => isLafposBranch(l.branchId, lafposBranch));
  const switchMonth = S.slice(0, 7);
  const dataMonths = [...own.map((l) => l.month), ...lafpos.days.map((x) => x.month)].filter((m) => m >= switchMonth);
  const last = [switchMonth, input.today.slice(0, 7), ...dataMonths].reduce((a, b) => (b > a ? b : a));
  const months: LafposSalesMonth[] = [];
  for (let m = switchMonth; m <= last; m = shiftMonth(m, 1)) {
    const list = own.filter((l) => l.month === m);
    const through = modposThroughOf(m, input.lafposCoverage);
    const days = lafpos.received.find((x) => x.month === m) ?? null;
    const modposZ = list.length && input.zOf ? input.zOf(`${m}-01`, through) : null;
    const st = lafposMonthStatus({
      month: m,
      switchDay: S,
      today: input.today,
      modpos: list.length ? { lines: list.length, revenue: list.reduce((a, l) => a + l.revenue, 0), through } : null,
      lafpos: days ? { days: days.days, last: days.last } : null,
      modposZ: modposZ?.z ?? null,
      modposDiscounts: modposZ?.discounts ?? null,
      kasaDays: input.reportDays?.filter((x) => x.slice(0, 7) === m),
      lafposDates: lafpos.dates.filter((x) => x.slice(0, 7) === m),
      linesVsZ: lafpos.linesVsZ.filter((x) => x.date.slice(0, 7) === m),
      // Kasa raporunu bekleyen günler: gelen son gün kasa raporlarının son gününden sonraysa ("Tümü"nün ortak dönemi de
      // günleri keser, sayılan son gün ölçü olamaz; bulgu 62)
      held: hold && m === hold.month && days && days.last > hold.after ? { from: addDays(hold.after, 1), to: days.last } : null,
    });
    if (st) months.push(st);
  }
  return { ...merged, lafposSales: { switchDay: S, countFrom, months } };
}
