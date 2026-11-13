import { branchCarryChecks, carryCheck, CASH_TOLERANCE, carryKey, type CarryCheck, type CashReportFields } from "./cash-report";
import { addDays, shiftMonth } from "./reminders";

/**
 * Kasa › Günden güne listesinin satırları ve ay kartı (saf; tests/sube-kasa-ekrani.test.ts). "Tümü"de günün bütün şube
 * raporları ayrı satırdır ve toplamlar hepsinden gelir (denetim HM-X2, KP-01): gün anahtarlı tek raporluk liste öteki
 * şubenin raporunu düşürüyor, ayın Z toplamı ve kasa farkı tek şubenin rakamı kalıyordu. Açılış ↔ devir zinciri şube
 * şube kurulur (HM-X1): Marina'nın açılışı Tuzla'nın devriyle karşılaştırılmaz.
 */

/** Listenin raporu: günü, şubesi ve ay kartına giden alanları */
export type CashDayReport = Pick<CashReportFields, "date" | "zTotal" | "cash" | "card" | "openingCash" | "countedCash" | "handedOver"> & {
  id: number;
  branchId: string;
  cashDiff: number;
};

/** Listenin bir satırı: günün bir şube raporu ya da raporsuz gün (`report` null). `branch`: birden çok şube açıkken adı */
export interface CashDayRow<R extends CashDayReport> {
  date: string;
  report: R | null;
  branch: string | null;
}

export interface CashMonthTotals {
  zTotal: number;
  cash: number;
  card: number;
  /** Eksiklerin toplamı (pozitif) ve fazlaların toplamı */
  short: number;
  over: number;
  /** Raporlu gün ve listedeki gün: günde bir kez (iki şubenin aynı günkü raporu bir gün) */
  reported: number;
  days: number;
}

/** Satırın anahtarı: raporlu satırda gün ve şube, raporsuz günde yalnız gün (föy ve kasadan çıkanlar bununla eşleşir) */
export function cashDayKey(date: string, report: { branchId: string } | null): string {
  return report ? `${date}|${report.branchId}` : date;
}

/**
 * Ayın günleri (en yeni önce): raporlu günde her şube raporu bir satır (şube sırasıyla), raporsuz gün tek satır. Bugünün
 * raporu yoksa bugün listede yok (akşam girilecek). `order`: şubelerin ekrandaki sırası; `labelOf`: satırda yazılacak
 * şube adı (tek şubede null)
 */
export function cashDayRows<R extends CashDayReport>(
  month: string,
  today: string,
  reports: readonly R[],
  order: readonly string[] = [],
  labelOf: (branchId: string) => string | null = () => null,
): CashDayRow<R>[] {
  const byDate = new Map<string, R[]>();
  for (const r of reports) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const rank = (b: string) => (order.includes(b) ? order.indexOf(b) : order.length);
  const start = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const end = last < today ? last : byDate.has(today) ? today : addDays(today, -1);
  const rows: CashDayRow<R>[] = [];
  for (let d = end; d >= start; d = addDays(d, -1)) {
    const day = [...(byDate.get(d) ?? [])].sort((a, b) => rank(a.branchId) - rank(b.branchId) || a.branchId.localeCompare(b.branchId));
    if (!day.length) rows.push({ date: d, report: null, branch: null });
    for (const r of day) rows.push({ date: d, report: r, branch: labelOf(r.branchId) });
  }
  return rows;
}

/** Ay kartı: Z, nakit, kart ve kasa farkı bütün raporlardan; raporlu gün ve gün sayısı günde bir kez */
export function cashDayTotals(rows: readonly CashDayRow<CashDayReport>[]): CashMonthTotals {
  const reports = rows.flatMap((d) => (d.report ? [d.report] : []));
  const sum = (f: (r: CashDayReport) => number) => Math.round(reports.reduce((a, r) => a + f(r), 0) * 100) / 100;
  return {
    zTotal: sum((r) => r.zTotal),
    cash: sum((r) => r.cash),
    card: sum((r) => r.card),
    short: sum((r) => (r.cashDiff <= -CASH_TOLERANCE ? -r.cashDiff : 0)),
    over: sum((r) => (r.cashDiff >= CASH_TOLERANCE ? r.cashDiff : 0)),
    reported: new Set(reports.map((r) => r.date)).size,
    days: new Set(rows.map((d) => d.date)).size,
  };
}

/**
 * Raporların devir denetimleri, rapor kimliğine göre: `carry` raporun açılışı aynı şubenin önceki raporunun devriyle
 * tutmuyor, `next` aynı şubenin sonraki raporunun açılışı bu raporun devriyle tutmuyor (ayın son raporu sonraki ayın ilk
 * raporuyla: `after`). `before` ve `after` şube şube (carryOversBefore, nextReportsAfter)
 */
export function carryByReport(
  reports: readonly CashDayReport[],
  before: ReadonlyMap<string, { date: string; amount: number }>,
  after: ReadonlyMap<string, { date: string; openingCash: number }>,
): { carry: Record<number, CarryCheck>; next: Record<number, CarryCheck> } {
  const checks = branchCarryChecks(reports, before);
  const carry: Record<number, CarryCheck> = {};
  const next: Record<number, CarryCheck> = {};
  const byKey = new Map(reports.map((r) => [carryKey(r), r]));
  for (const r of reports) {
    const c = checks.get(carryKey(r));
    if (!c) continue;
    carry[r.id] = c;
    const prev = byKey.get(carryKey({ date: c.prevDate, branchId: r.branchId }));
    if (prev) next[prev.id] = c;
  }
  // Ayın son raporu ↔ sonraki ayın ilk raporu (şube şube)
  const lastOf = new Map<string, CashDayReport>();
  for (const r of reports) if ((lastOf.get(r.branchId)?.date ?? "") < r.date) lastOf.set(r.branchId, r);
  for (const [b, last] of lastOf) {
    const a = after.get(b);
    const c = a ? carryCheck(a.date, a.openingCash, { date: last.date, amount: Math.round((last.countedCash - last.handedOver) * 100) / 100 }) : null;
    if (c) next[last.id] = c;
  }
  return { carry, next };
}
