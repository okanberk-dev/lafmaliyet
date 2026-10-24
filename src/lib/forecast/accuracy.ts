/**
 * Tahminin tutturması (saf; tests/satis-tahmini.test.ts). Her sabah o günün tahmini kaydedilir (forecast_snapshots);
 * gerçekleşen kasa raporunun Z toplamıyla karşılaştırılır. Yalnız aynı sabahın, 12:00'den (Türkiye) önce kaydedilmiş
 * tahmini sayılır: günün hikâyesini öğrendikten sonra öğleden sonra basılan "Güncelle" ölçüye girmez.
 */

import { trHour } from "@/lib/cash-report";
import { addDays, todayTR } from "@/lib/reminders";

export const MIN_ACCURACY_DAYS = 7;
export const ACCURACY_WINDOW_DAYS = 28;
/** Aralığın geçmiş oranları bu kadar günden */
export const RATIO_WINDOW_DAYS = 56;
/** Aynı günün tahmini bu saatten (Türkiye) önce kaydedildiyse sayılır */
export const MORNING_CUTOFF_HOUR = 12;
/** Listede gösterilen son gün sayısı */
export const ACCURACY_LIST_DAYS = 14;

export interface SnapshotLite {
  /** Tahmin edilen iş günü */
  date: string;
  /** Tahminin yapıldığı iş günü */
  madeOn: string;
  amount: number;
  low: number;
  high: number;
  closed: boolean;
  /** Kaydın anı (ISO) */
  createdAt: string;
}

export type AccuracyStatus = "ok" | "rapor-yok" | "kapali" | "kayit-yok";

export interface Accuracy {
  /** Eşleşen gün: aynı sabahın tahmini var, kafe açık, rapor girilmiş */
  days: number;
  /** Ağırlıklı sapma: Σ|gerçek − tahmin| ÷ Σ gerçek (en az 7 gün) */
  miss: number | null;
  /** Σ(gerçek − tahmin) ÷ Σ tahmin: artı ise tahmin düşük kalıyor (en az 7 gün) */
  bias: number | null;
  /** Gerçekleşenin aralıkta kaldığı gün */
  inRange: number;
  /** Son 14 gün (bugünün raporu girildiyse bugün de), yeni önce; tahmini de raporu da olmayan gün yok */
  list: { date: string; forecast: number | null; actual: number | null; deviation: number | null; status: AccuracyStatus }[];
}

/**
 * Aynı sabahın tahmini: o günün kendisinde, aynı takvim gününde 12:00'den önce yazılmış. (Gece 05:00'e kadar iş günü
 * dündür; gece yarısından sonra yazılan "aynı gün" tahmini takvim günü tutmadığı için sayılmaz.)
 */
export function isSameMorning(s: Pick<SnapshotLite, "date" | "madeOn" | "createdAt">): boolean {
  if (s.madeOn !== s.date) return false;
  const at = new Date(s.createdAt);
  if (!Number.isFinite(at.getTime())) return false;
  return todayTR(at) === s.date && trHour(at) < MORNING_CUTOFF_HOUR;
}

function morningBy(snaps: readonly SnapshotLite[]): Map<string, SnapshotLite> {
  const out = new Map<string, SnapshotLite>();
  for (const s of snaps) if (isSameMorning(s) && !out.has(s.date)) out.set(s.date, s);
  return out;
}

/** Aralık için geçmiş oranlar: son 56 günün gerçekleşen ÷ aynı sabahın tahmini (açık günler) */
export function pastRatios(snaps: readonly SnapshotLite[], actuals: ReadonlyMap<string, number>, today: string): number[] {
  const from = addDays(today, -RATIO_WINDOW_DAYS);
  const out: number[] = [];
  for (const [date, s] of morningBy(snaps)) {
    if (date < from || date >= today || s.closed || !(s.amount > 0)) continue;
    const a = actuals.get(date);
    if (a !== undefined && a > 0) out.push(a / s.amount);
  }
  return out;
}

/** Son 4 haftanın tutturması ve son 14 günün listesi */
export function accuracy(snaps: readonly SnapshotLite[], actuals: ReadonlyMap<string, number>, today: string): Accuracy {
  const morning = morningBy(snaps);
  const statusOf = (date: string): { forecast: number | null; actual: number | null; status: AccuracyStatus } => {
    const s = morning.get(date) ?? null;
    const a = actuals.get(date);
    const actual = a === undefined ? null : a;
    if (s?.closed || actual === 0) return { forecast: s && !s.closed ? s.amount : null, actual, status: "kapali" };
    if (actual === null) return { forecast: s?.amount ?? null, actual, status: "rapor-yok" };
    if (!s) return { forecast: null, actual, status: "kayit-yok" };
    return { forecast: s.amount, actual, status: "ok" };
  };
  let days = 0;
  let absSum = 0;
  let actSum = 0;
  let diffSum = 0;
  let fcSum = 0;
  let inRange = 0;
  for (let i = 1; i <= ACCURACY_WINDOW_DAYS; i++) {
    const date = addDays(today, -i);
    const r = statusOf(date);
    if (r.status !== "ok") continue;
    const s = morning.get(date)!;
    days++;
    absSum += Math.abs(r.actual! - s.amount);
    actSum += r.actual!;
    diffSum += r.actual! - s.amount;
    fcSum += s.amount;
    if (r.actual! >= s.low && r.actual! <= s.high) inRange++;
  }
  const enough = days >= MIN_ACCURACY_DAYS;
  const list: Accuracy["list"] = [];
  // Bugün yalnız raporu girildiyse listeye girer (ölçüye girmez)
  const dates = [...(actuals.has(today) ? [today] : []), ...Array.from({ length: ACCURACY_LIST_DAYS }, (_, i) => addDays(today, -(i + 1)))];
  for (const date of dates) {
    const r = statusOf(date);
    if (r.forecast === null && r.actual === null && !morning.has(date)) continue;
    const deviation = r.status === "ok" && r.forecast! > 0 ? (r.actual! - r.forecast!) / r.forecast! : null;
    list.push({ date, ...r, deviation });
  }
  return {
    days,
    miss: enough && actSum > 0 ? absSum / actSum : null,
    bias: enough && fcSum > 0 ? diffSum / fcSum : null,
    inRange,
    list,
  };
}

/** Dünün çifti (sabah e-postası, Bugün kartı): aynı sabahın tahmini ve gerçekleşen; ikisi yoksa ya da kapalıysa null */
export function pairFor(snaps: readonly SnapshotLite[], actuals: ReadonlyMap<string, number>, date: string): { forecast: number; actual: number; deviation: number } | null {
  const s = morningBy(snaps).get(date);
  const a = actuals.get(date);
  if (!s || s.closed || !(s.amount > 0) || a === undefined || !(a > 0)) return null;
  return { forecast: s.amount, actual: a, deviation: (a - s.amount) / s.amount };
}
