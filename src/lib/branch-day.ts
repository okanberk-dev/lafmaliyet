/**
 * Bugün › "Şubelerde gün" kartı (docs/BUGUN.md; Design Lab'in "Şube günlük ciro özeti", B + C varyantlarının birleşimi):
 * her fiziksel şubenin günlük cirosu, fiş sayısı, geçen haftanın aynı gününe göre değişimi, gün sonunun nereden geldiği
 * ve kasa farkı; altta bütün şubelerin ödeme dağılımı. Saf (tests/branch-day.test.ts); veriyi
 * src/server/data/branch-day.ts yükler.
 *
 * Kaynak önceliği ay rakamınınkiyle aynı (src/server/data/cash-reports.ts tillRows): kasa raporu > AsilPOS gün sonu
 * (yalnız geçiş gününden itibaren) > kapanmış ModPOS föyü (yalnız Ayarlar › ModPOS › Ay rakamına yedek açıkken ve geçiş
 * gününden önce). Föyden gelen gün Genel bakış'ın günlük grafiğinde de sayılır (denetim 13 Kasım HM-09). Ciro ödenmez /
 * ikram hariçtir (src/lib/cash-revenue.ts dayRevenue).
 */

import { dayRevenue } from "@/lib/cash-revenue";
import { addDays } from "@/lib/reminders";

/** Bir şubenin bir günü, kaynağı ne olursa olsun */
export interface BranchDaySource {
  branchId: string;
  date: string;
  source: "rapor" | "asilpos" | "modpos";
  zTotal: number;
  /** Ödenmez / ikram; girilmediyse null */
  offRevenue: number | null;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  receipts: number | null;
  /** Sayılan − olması gereken nakit (eksi: eksik); sayım yoksa null */
  cashDiff: number | null;
}

export interface BranchDayBranch {
  id: string;
  name: string;
  /** Açılış günü; o günden önce şube listede yer almaz */
  openedOn: string | null;
}

export interface Payments {
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
}

export interface BranchDayRow {
  id: string;
  name: string;
  /** Gün sonu nereden geldi; "yok": henüz girilmedi */
  source: BranchDaySource["source"] | "yok";
  revenue: number | null;
  receipts: number | null;
  /** Fiş başına ciro; fiş sayısı yoksa null */
  avgReceipt: number | null;
  /** Geçen haftanın aynı günündeki ciro */
  lastWeek: number | null;
  /** Geçen haftanın aynı gününe göre oran (0,12 = +%12); karşılaştırılamıyorsa null */
  change: number | null;
  cashDiff: number | null;
}

export interface BranchDaySummary {
  /** Gösterilen iş günü */
  day: string;
  /** Gösterilen gün bugünün iş günü mü (bütün şubeler bugünü kapattıysa) */
  isToday: boolean;
  rows: BranchDayRow[];
  /** Gün sonu gelen şubelerin toplamı */
  revenue: number;
  receipts: number;
  /** Toplamın geçen haftaya göre değişimi: yalnız iki günde de verisi olan şubelerle */
  change: number | null;
  payments: Payments;
  /** Gün sonu girilmemiş şube sayısı */
  missing: number;
  /** Gösterilen gün dahil son sekiz günün toplam cirosu, eskiden yeniye (kartın çizgisi; dailyTrend) */
  trend: BranchDayPoint[];
}

/** Bir günün bütün şubelerdeki cirosu; o gün açık olup gün sonu gelmeyen şube sayısı `missing` */
export interface BranchDayPoint {
  day: string;
  /** Gün sonu gelen şubelerin toplamı; hiçbirinden gelmediyse null */
  revenue: number | null;
  missing: number;
}

/** Kasa farkı bu tutardan küçükse "tutuyor" sayılır (src/lib/cash-report.ts CASH_TOLERANCE ile aynı) */
export const DIFF_TOLERANCE = 1;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Aynı şube ve gün için kasa raporu AsilPOS'un gün sonunu, o da ModPOS föyünü ezer */
export function pickSource(sources: readonly BranchDaySource[], branchId: string, date: string): BranchDaySource | null {
  const own = sources.filter((s) => s.branchId === branchId && s.date === date);
  return own.find((s) => s.source === "rapor") ?? own.find((s) => s.source === "asilpos") ?? own.find((s) => s.source === "modpos") ?? null;
}

/** Günün cirosu: ödenmez / ikram hariç */
export function revenueOf(s: BranchDaySource): number {
  return dayRevenue({ zTotal: s.zTotal, offRevenue: s.offRevenue, payments: r2(s.cash + s.card + s.mealCard + s.online + s.other) }).revenue;
}

function changeOf(cur: number | null, before: number | null): number | null {
  if (cur === null || before === null || before <= 0) return null;
  return cur / before - 1;
}

/**
 * Kartın günü: bütün şubeler bugünün gün sonunu gönderdiyse bugün, yoksa dün (akşam bir şube kapattı diye yarım günün
 * toplamı gösterilmez). Hiç şube yoksa dün.
 */
export function pickDay(branches: readonly BranchDayBranch[], sources: readonly BranchDaySource[], today: string): string {
  const open = branches.filter((b) => b.openedOn === null || b.openedOn <= today);
  if (open.length && open.every((b) => pickSource(sources, b.id, today))) return today;
  return addDays(today, -1);
}

/**
 * Son sekiz gün (gösterilen gün ve ondan önceki yedi; yükleyici bu aralığı zaten okur): her günün, o gün açık şubelerinden
 * gün sonu gelenlerin cirosu. Kaynak önceliği ve ciro kuralı satırlarla aynı (pickSource, revenueOf).
 */
export function dailyTrend(branches: readonly BranchDayBranch[], sources: readonly BranchDaySource[], day: string): BranchDayPoint[] {
  return Array.from({ length: 8 }, (_, i) => {
    const d = addDays(day, i - 7);
    let revenue: number | null = null;
    let missing = 0;
    for (const b of branches) {
      if (b.openedOn !== null && b.openedOn > d) continue;
      const s = pickSource(sources, b.id, d);
      if (!s) missing += 1;
      else revenue = r2((revenue ?? 0) + revenueOf(s));
    }
    return { day: d, revenue, missing };
  });
}

export function branchDaySummary(branches: readonly BranchDayBranch[], sources: readonly BranchDaySource[], today: string): BranchDaySummary {
  const day = pickDay(branches, sources, today);
  const weekAgo = addDays(day, -7);
  const payments: Payments = { cash: 0, card: 0, mealCard: 0, online: 0, other: 0 };
  let revenue = 0;
  let receipts = 0;
  let curBoth = 0;
  let prevBoth = 0;
  const rows = branches
    .filter((b) => b.openedOn === null || b.openedOn <= day)
    .map((b): BranchDayRow => {
      const s = pickSource(sources, b.id, day);
      const p = pickSource(sources, b.id, weekAgo);
      const lastWeek = p ? revenueOf(p) : null;
      if (!s) return { id: b.id, name: b.name, source: "yok", revenue: null, receipts: null, avgReceipt: null, lastWeek, change: null, cashDiff: null };
      const rev = revenueOf(s);
      revenue += rev;
      receipts += s.receipts ?? 0;
      payments.cash += s.cash;
      payments.card += s.card;
      payments.mealCard += s.mealCard;
      payments.online += s.online;
      payments.other += s.other;
      if (lastWeek !== null && lastWeek > 0) {
        curBoth += rev;
        prevBoth += lastWeek;
      }
      return {
        id: b.id,
        name: b.name,
        source: s.source,
        revenue: rev,
        receipts: s.receipts,
        avgReceipt: s.receipts ? r2(rev / s.receipts) : null,
        lastWeek,
        change: changeOf(rev, lastWeek),
        cashDiff: s.cashDiff,
      };
    });
  return {
    day,
    isToday: day === today,
    rows,
    revenue: r2(revenue),
    receipts,
    change: changeOf(curBoth || null, prevBoth || null),
    payments: { cash: r2(payments.cash), card: r2(payments.card), mealCard: r2(payments.mealCard), online: r2(payments.online), other: r2(payments.other) },
    missing: rows.filter((r) => r.source === "yok").length,
    trend: dailyTrend(branches, sources, day),
  };
}

/** Kasa farkı söylenecek kadar mı */
export function diffMatters(diff: number | null): diff is number {
  return diff !== null && Math.abs(diff) >= DIFF_TOLERANCE;
}

export const PAYMENT_LABELS: Record<keyof Payments, string> = {
  card: "Kart",
  cash: "Nakit",
  mealCard: "Yemek kartı",
  online: "Online",
  other: "Diğer",
};

/** Ödeme dağılımının dilimleri: sıfır olanlar düşer, büyükten küçüğe; pay ödemelerin kendi toplamına göre */
export function paymentShares(p: Payments): { key: keyof Payments; label: string; value: number; share: number }[] {
  const total = p.cash + p.card + p.mealCard + p.online + p.other;
  if (total <= 0) return [];
  return (Object.keys(PAYMENT_LABELS) as (keyof Payments)[])
    .map((key) => ({ key, label: PAYMENT_LABELS[key], value: p[key], share: p[key] / total }))
    .filter((x) => x.value >= 0.5)
    .sort((a, b) => b.value - a.value);
}
