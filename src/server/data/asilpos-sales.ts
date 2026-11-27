import "server-only";

import { and, asc, countDistinct, eq, gte, lte, or, sql, sum } from "drizzle-orm";

import type { AsilposSalesMonth, SalesLine } from "@/lib/calc/types";
import {
  commonListCuts,
  asilposMonthStatus,
  mergeSalesSources,
  posCountFroms,
  modposThroughOf,
  type AsilposDaysOfMonth,
  type AsilposMonthLine,
  type OtherBranchList,
  type SalesSources,
} from "@/lib/asilpos/sales";
import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { earliestSwitchDay, tillDayKey, type PosFroms, type SwitchDays } from "@/lib/pos/tills";
import { addDays, shiftMonth } from "@/lib/reminders";
import { currentBranchWhere } from "@/server/branch-scope";
import { schema as s, type DB } from "@/server/db";

/**
 * Süren ayın kasa raporu gelmemiş AsilPOS günleri: `month` ayında `after` gününden sonraki günler sayılmaz, kasa raporu
 * girilince sayılır (kasa raporlarının son günü; docs/ASILPOS.md › Kapsam)
 */
export interface AsilposHold {
  month: string;
  after: string;
}

/**
 * Kasa başına bekleme (çok şube, inceleme 27 Kasım): şube → o kasanın kendi kasa raporlarının son günüyle bekleme. Bir
 * kasanın raporu öbür kasanın gününü bekletmez ya da saydırmaz: "Tümü" şube görünümlerinin toplamıdır
 */
export type AsilposHolds = Readonly<Record<string, AsilposHold>>;

/** Kasanın süren ayda kasa raporunu bekleyen günleri (gelen ilk bekleyen günden son gelen güne) */
export interface AsilposHeldDays {
  branchId: string;
  month: string;
  from: string;
  to: string;
}

/**
 * AsilPOS satışlarının aylık modele okunması (docs/ASILPOS.md › Günlük satış; kural src/lib/asilpos/sales.ts). Yalnız
 * geçiş günü seçiliyken çağrılır: her kasanın kendi sayılma gününden (`froms`, posCountFroms; çok şube, R1) itibaren
 * pos_daily_sales (ay, POS adı, ürün, hizmet) başına toplanır, pos_day_reports ay ay sayılır; kasası AsilPOS olmayan
 * şubenin (deneme) günü okunmaz. Günler ve satır ↔ Z denetimi (şube, gün) anahtarlı (R2). Geçiş günü yoksa hiçbir okuma
 * yapılmaz. `to` verilirse o güne kadar. `holds` (kasa başına) verilirse kasanın süren
 * aydaki kendi kasa raporundan sonraki günleri satırlara ve `days`'e girmez, yalnız `received`'da (gelen bütün günler),
 * `dates`'te ve `held`'de görünür. `cuts` ("Tümü"nün ortak dönemi, commonListCuts; bulgu 62): o ayın kesilen günden
 * sonraki günleri de satırlara, `days`'e ve satır ↔ Z denetimine girmez (`received`'da ve `dates`'te görünür).
 */
export async function loadAsilposMonthSales(
  db: DB,
  froms: PosFroms,
  to?: string,
  holds: AsilposHolds = {},
  cuts: readonly AsilposHold[] = [],
): Promise<{
  lines: AsilposMonthLine[];
  days: AsilposDaysOfMonth[];
  received: AsilposDaysOfMonth[];
  dates: string[];
  /** Sayılan günlerin ürün satırları toplamı ve Z'si (Satışlar'ın denetimi: Σ ciro = zTotal), (şube, gün) başına */
  linesVsZ: { date: string; branchId: string; lines: number; z: number }[];
  /** Kasa başına kasa raporunu bekleyen günler (yalnız bekleyen günü gelmiş kasa) */
  held: AsilposHeldDays[];
}> {
  const d = s.posDailySales;
  const r = s.posDayReports;
  const lineMonth = sql<string>`substr(${d.date}, 1, 7)`;
  // Kasa başına: şube = X ve gün ≥ X'in sayılma günü (çok şube: bir kasanın günü öbürünün sınırıyla okunmaz)
  const tills = Object.entries(froms);
  const range = (bcol: typeof d.branchId | typeof r.branchId, col: typeof d.date | typeof r.date) =>
    and(or(...tills.map(([id, from]) => and(eq(bcol, id), gte(col, from)))), to ? lte(col, to) : undefined);
  // Bekleyen gün: süren ayda kasanın kendi kasa raporlarının son gününden sonra (kasa başına); "Tümü"nün ortak döneminden
  // sonraki gün de sayılmaz
  const outside = (h: AsilposHold, day: string) => day > h.after && day.slice(0, 7) === h.month;
  const waits = (branchId: string, day: string) => {
    const h = holds[branchId];
    return !!h && outside(h, day);
  };
  const isHeld = (branchId: string, day: string) => waits(branchId, day) || cuts.some((c) => outside(c, day));
  // Seçili şubenin gün sonları ("Tümü"de koşul yok; docs/SUBE.md › Seçici)
  const [subeSatir, subeGun] = await Promise.all([currentBranchWhere(d.branchId), currentBranchWhere(r.branchId)]);
  const notHeld = and(
    ...Object.entries(holds).map(([id, h]) => sql`not (${d.branchId} = ${id} and ${d.date} > ${h.after} and substr(${d.date}, 1, 7) = ${h.month})`),
    ...cuts.map((h) => sql`not (${d.date} > ${h.after} and substr(${d.date}, 1, 7) = ${h.month})`),
  );
  const [lines, reports, perDay] = await Promise.all([
    db
      .select({
        month: lineMonth,
        posName: d.posName,
        productId: d.productId,
        isService: d.isService,
        qty: sum(d.qty).mapWith(Number),
        revenue: sum(d.revenue).mapWith(Number),
        // Faz 2: indirimden önceki liste değeri; günlerden biri brütsüz (eski AsilPOS) geldiyse bilinmez (null)
        gross: sql<string | null>`case when count(${d.gross}) = count(*) then sum(${d.gross}) else null end`,
        isAddon: sql<boolean>`coalesce(bool_or(${d.isAddon}), false)`,
        days: countDistinct(d.date),
      })
      .from(d)
      .where(and(range(d.branchId, d.date), subeSatir, notHeld))
      .groupBy(lineMonth, d.posName, d.productId, d.isService),
    // (Şube, gün) başına bir özet; Z toplamı satırlar ↔ Z denetimi için
    db.select({ date: r.date, branchId: r.branchId, z: r.z }).from(r).where(and(range(r.branchId, r.date), subeGun)).orderBy(asc(r.date), asc(r.branchId)),
    db
      .select({ date: d.date, branchId: d.branchId, revenue: sum(d.revenue).mapWith(Number) })
      .from(d)
      .where(and(range(d.branchId, d.date), subeSatir, notHeld))
      .groupBy(d.date, d.branchId),
  ]);
  // Günler tekil (iki kasanın aynı günü ayın tek günüdür): sayılan gün, en az bir kasanın sayılan günü; satırlar ↔ Z
  // (şube, gün) başına
  const dates = [...new Set(reports.map((x) => x.date))];
  const countedDates = [...new Set(reports.filter((x) => !isHeld(x.branchId, x.date)).map((x) => x.date))];
  const byDay = new Map(perDay.map((x) => [tillDayKey(x.branchId, x.date), x.revenue ?? 0]));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // Kasa başına bekleyen günler: kasanın bekleme gününden sonraki ilk günden, o kasanın gelen son gününe
  const held: AsilposHeldDays[] = [];
  for (const [branchId, h] of Object.entries(holds)) {
    const last = reports.filter((x) => x.branchId === branchId && outside(h, x.date)).at(-1)?.date;
    if (last) held.push({ branchId, month: h.month, from: addDays(h.after, 1), to: last });
  }
  return {
    lines: lines.map((l) => ({ ...l, qty: l.qty ?? 0, revenue: l.revenue ?? 0, gross: l.gross === null || l.gross === undefined ? null : r2(Number(l.gross)), isAddon: Boolean(l.isAddon) })),
    days: daysByMonth(countedDates),
    received: daysByMonth(dates),
    dates,
    linesVsZ: reports
      .filter((x) => !isHeld(x.branchId, x.date))
      .flatMap((x) => {
        const z = (x.z as { zTotal?: unknown } | null)?.zTotal;
        return typeof z === "number" ? [{ date: x.date, branchId: x.branchId, lines: r2(byDay.get(tillDayKey(x.branchId, x.date)) ?? 0), z }] : [];
      }),
    held,
  };
}

/**
 * Ayın bekleyen günleri (AsilposSalesMonth.held): tek kasada o kasanınki; birden çok kasa bekliyorsa ilk bekleyen günden
 * son gelen güne ve kasa kasa (`tills`, metin şube adıyla söyler)
 */
function heldOf(rows: readonly AsilposHeldDays[]): AsilposSalesMonth["held"] {
  if (!rows.length) return null;
  const from = rows.reduce((a, h) => (h.from < a ? h.from : a), rows[0].from);
  const to = rows.reduce((a, h) => (h.to > a ? h.to : a), rows[0].to);
  if (rows.length === 1) return { from, to };
  const tills = [...rows].sort((a, b) => a.from.localeCompare(b.from) || a.branchId.localeCompare(b.branchId));
  return { from, to, tills: tills.map(({ branchId, from: f, to: t }) => ({ branchId, from: f, to: t })) };
}

/** Sıralı günlerden ay ay gün sayısı ve son gün */
function daysByMonth(dates: readonly string[]): AsilposDaysOfMonth[] {
  const out = new Map<string, AsilposDaysOfMonth>();
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
  /** Geçiş günü seçiliyse kaynakların özeti (Dataset.asilposSales; `froms` kasa başına sayılma günü); yoksa null */
  asilposSales: { switchDay: string; countFrom: string; froms: PosFroms; months: AsilposSalesMonth[] } | null;
}

/**
 * Satış satırlarını geçiş gününe göre birleştirir (veri kümesi ve tatlı payı). Geçiş günü yoksa girdi olduğu gibi
 * döner, AsilPOS tablosu okunmaz. `zOf(from, through)`: kasa raporlarının o günlerdeki Z ve indirim toplamı (rapor yoksa
 * null; geçiş ayında liste − indirim ↔ Z karşılaştırması). `today`: iş günü; `currentMonth`: özetin son ayı en az bu.
 *
 * İki kapsam: `coverage` görünümün listelerinin son günü (modelin `coverage`'ı, engine listPeriod); `coverageOf(kasa)`
 * kasanın şubesinin kendi kaydı (src/lib/sales-coverage.ts readCoverage). Kasanın sayıldığı ilk gün ve ayların ModPOS
 * listesi (son günü, çakışma, liste ↔ Z) yalnız o şubenin listesine bakar: ortak kayıt ayın tek kaydıdır, öteki şubenin
 * aynı aya yüklediği liste onu ezer ve kasanın AsilPOS günlerini düşürürdü.
 *
 * Çok şube (27 Kasım 2026): `switchDays` görünümün kasaları ("Tümü"de hepsi, tek şube seçiliyken yalnız onunki); her kasa
 * kendi geçiş günü, listesi ve sayılma günüyle (posCountFroms), aynı ürünün iki kasadaki satırları ay toplamında birleşir.
 * Özet (`months`) kasaların listeleriyle ve en erken geçiş günüyle.
 */
export async function mergeWithAsilpos(
  db: DB,
  input: {
    switchDays: SwitchDays;
    salesLines: SalesLine[];
    coverage: Record<string, string>;
    /** Kasanın şubesinin listelerinin son günü: şubenin kendi kaydı, yoksa ortak kayıt (readCoverage) */
    coverageOf: (branchId: string) => Record<string, string>;
    today: string;
    zOf?: (from: string, through: string) => { z: number; discounts: number } | null;
    /** Yalnız bu aya kadar (dahil) okunur (tatlı payı); verilmezse hepsi */
    toMonth?: string;
    /**
     * Kasa başına kasa raporlarının son günü (veri kümesi; şube → gün): süren ayın bundan sonraki AsilPOS günleri o
     * kasanın kasa raporu girilince sayılır. AsilPOS gün sonunu kapanışta yollar, kasa raporu ondan sonra (çoğu kez ertesi
     * sabah) girilir; o arada satırlar kasa döneminden bir gün ileride olur, liste ↔ POS cirosu karşılaştırması ve günlük
     * ortalama yanlış dönemle yapılırdı (denetim B08 incelemesi). Süren ayda kasanın kasa raporu yoksa bekletilmez: ayın
     * kasa dönemi yok, karşılaştırma da yok. Çok şube: bir kasanın raporu öbür kasanın gününü bekletmez (inceleme 27 Kasım)
     */
    lastTillDays?: Readonly<Record<string, string>>;
    /** Kasa raporu olan günler (veri kümesi): AsilPOS gün sonu gelmemiş raporlu gün Satışlar'da ve Genel bakış'ta uyarılır */
    reportDays?: readonly string[];
    /**
     * Yalnız "Tümü": ModPOS'ta kalan şubelerin listeleri (otherBranchLists; bulgu 62). AsilPOS'un günleri en kısa listenin
     * son gününden sonra sayılmaz (commonListCuts), ayın dönemi o gün
     */
    others?: readonly OtherBranchList[];
  },
): Promise<MergedSales> {
  const S = earliestSwitchDay(input.switchDays);
  const froms = posCountFroms(input.switchDays, input.salesLines, input.coverageOf);
  const countFrom = Object.values(froms).reduce<string | null>((a, f) => (a === null || f < a ? f : a), null);
  if (S === null || countFrom === null) return { salesLines: input.salesLines, coverage: { ...input.coverage }, short: {}, asilposSales: null };
  const running = input.today.slice(0, 7);
  const holds: Record<string, AsilposHold> = {};
  for (const [id, last] of Object.entries(input.lastTillDays ?? {})) if (id in froms && last.slice(0, 7) === running) holds[id] = { month: running, after: last };
  const others = input.others ?? [];
  const asilpos = await loadAsilposMonthSales(db, froms, input.toMonth ? `${input.toMonth}-31` : undefined, holds, commonListCuts(others));
  const merged = mergeSalesSources({ switchDays: input.switchDays, salesLines: input.salesLines, coverage: input.coverage, asilposLines: asilpos.lines, asilposDays: asilpos.days, others });
  // Özet: ilk geçiş ayından, verisi olan son aya (en az bu ay ve geçiş ayı) kadar her ay. Yalnız kasaların şubelerinin
  // listesiyle: ModPOS'ta kalan şubenin listesi ("Tümü") AsilPOS'la çakışmaz, ondan uyarı çıkmaz
  const tillIds = new Set(Object.keys(froms));
  const own = input.salesLines.filter((l) => tillIds.has(l.branchId ?? DEFAULT_BRANCH_ID));
  // Listenin son günü: ilk kasanın şubesinin kaydı (tek kasada o kasanınki)
  const firstTill = Object.entries(froms).sort(([, a], [, b]) => a.localeCompare(b))[0][0];
  const ownCoverage = input.coverageOf(firstTill);
  const switchMonth = S.slice(0, 7);
  const dataMonths = [...own.map((l) => l.month), ...asilpos.days.map((x) => x.month)].filter((m) => m >= switchMonth);
  const last = [switchMonth, input.today.slice(0, 7), ...dataMonths].reduce((a, b) => (b > a ? b : a));
  const months: AsilposSalesMonth[] = [];
  for (let m = switchMonth; m <= last; m = shiftMonth(m, 1)) {
    const list = own.filter((l) => l.month === m);
    const through = modposThroughOf(m, ownCoverage);
    const days = asilpos.received.find((x) => x.month === m) ?? null;
    const modposZ = list.length && input.zOf ? input.zOf(`${m}-01`, through) : null;
    const st = asilposMonthStatus({
      month: m,
      switchDay: S,
      today: input.today,
      modpos: list.length ? { lines: list.length, revenue: list.reduce((a, l) => a + l.revenue, 0), through } : null,
      asilpos: days ? { days: days.days, last: days.last } : null,
      modposZ: modposZ?.z ?? null,
      modposDiscounts: modposZ?.discounts ?? null,
      kasaDays: input.reportDays?.filter((x) => x.slice(0, 7) === m),
      asilposDates: asilpos.dates.filter((x) => x.slice(0, 7) === m),
      linesVsZ: asilpos.linesVsZ.filter((x) => x.date.slice(0, 7) === m),
      // Kasa raporunu bekleyen günler: kasanın gelen son günü kendi kasa raporlarının son gününden sonraysa ("Tümü"nün
      // ortak dönemi de günleri keser, sayılan son gün ölçü olamaz; bulgu 62). Birden çok kasa bekliyorsa kasa kasa
      held: heldOf(asilpos.held.filter((h) => h.month === m)),
    });
    if (st) months.push(st);
  }
  return { ...merged, asilposSales: { switchDay: S, countFrom, froms, months } };
}
