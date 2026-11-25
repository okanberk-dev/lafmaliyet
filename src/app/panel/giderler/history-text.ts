// Sabit gider ve personel ekranlarının "hangi aydan itibaren?" metinleri ve kuralları.
// Saf işlevler: hem sunucu sayfası hem istemci kullanır, testleri tests/giderler-history.test.ts.
//
// Kural: her ay kendi tutarını taşır. Bir tutar değişikliği, yeni kalem, durdurma ya da devam
// ettirme yalnızca seçilen aydan sonrasını değiştirir; kapanmış bir ay etkilenecekse ekran bunu açıkça yazar.

import { inRange, shiftMonth } from "@/lib/calc/engine";
import type { FixedPeriod, MonthRange } from "@/lib/calc/types";
import { MONTH_NAMES } from "@/lib/constants";
import { monthLabel, tl } from "@/lib/format";

/** "Hangi aydan itibaren?" seçimi: bu ay, seçilen bir ay ya da bütün aylar (düzeltme) */
export type MonthChoice = { mode: "current" | "month" | "all"; month: string };

/** Sunucu eylemine giden değer: "YYYY-MM" ya da "all" */
export function choiceValue(c: MonthChoice, currentMonth: string): string {
  if (c.mode === "all") return "all";
  return c.mode === "current" ? currentMonth : c.month;
}

/** "Temmuz–Eylül 2026", "Eylül 2026", "Aralık 2026 – Ocak 2027" (sunucudaki iletilerle aynı biçim) */
export function spanText(months: string[]): string {
  if (!months.length) return "";
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === last) return monthLabel(first);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${MONTH_NAMES[Number(first.slice(5)) - 1]}–${monthLabel(last)}`;
  return `${monthLabel(first)} – ${monthLabel(last)}`;
}

/** Kalemin geçerli olduğu aralık metni: "Temmuz–Eylül 2026", "Ekim 2026 ve sonrası", "Baştan beri" */
export function rangeText(r: MonthRange): string {
  const s = r.startMonth ?? null;
  const e = r.endMonth ?? null;
  if (s && e) return s === e ? monthLabel(s) : spanText([s, e]);
  if (s) return `${monthLabel(s)} ve sonrası`;
  if (e) return `${monthLabel(e)} sonuna kadar`;
  return "Baştan beri";
}

/** from…to (dahil) arası aylar; from > to ise boş */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 240; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/**
 * Hesabı olan kapanmış aylar (bu aydan önce, açık gün girilmiş ya da gelir-gider tablosunda elle giriş olan):
 * sunucudaki silme / değiştirme kuralının (costs.ts dataMonths) aynısı.
 */
export function closedDataMonths(
  ds: { months: { month: string; openDays: number | null }[]; pnlEntries: { month: string }[] },
  currentMonth: string,
): string[] {
  const set = new Set<string>();
  for (const m of ds.months) if ((m.openDays ?? 0) > 0 && m.month < currentMonth) set.add(m.month);
  for (const e of ds.pnlEntries) if (e.month < currentMonth) set.add(e.month);
  return [...set].sort();
}

/** Seçim listesinde gösterilecek aylar: verisi olan ilk aydan (en fazla 12 ay geriden) 12 ay sonrasına */
export function choiceMonths(currentMonth: string, firstDataMonth: string | null, min?: string | null): string[] {
  const floor = shiftMonth(currentMonth, -12);
  let from = firstDataMonth && firstDataMonth > floor ? firstDataMonth : floor;
  if (from > currentMonth) from = currentMonth;
  if (min && min > from) from = min;
  return monthsBetween(from, shiftMonth(currentMonth, 12));
}

const PERIOD_UNIT: Record<FixedPeriod, string> = { aylik: "ay", gunluk: "gün", haftalik: "hafta", yillik: "yıl" };
/** Küçük tutarlarda kuruş: 50,00 ₺ yıllık */
export const money = (v: number) => tl(v, Math.abs(v) < 100 && v !== 0 ? 2 : 0);
/** "160.000 ₺/ay", "330 ₺/gün" */
export function periodAmount(period: FixedPeriod, amount: number): string {
  return `${money(amount)}/${PERIOD_UNIT[period]}`;
}

/** Kapanmış ve kalemin geçerli olduğu aylardan `from` ve sonrası */
function closedFrom(closed: string[], range: MonthRange, from: string | null, until?: string | null): string[] {
  return closed.filter((m) => (!from || m >= from) && (!until || m <= until) && inRange(range, m));
}

export interface EffectText {
  /** Ne olacağı, düz cümle */
  text: string;
  /** Kapanmış bir ay değişecekse uyarı (ekranda turuncu) */
  warn: string | null;
}

/**
 * Tutar değişikliğinin etkisi. `choice` "YYYY-MM" ya da "all".
 * before / after biçimlenmiş tutar ("160.000 ₺/ay"); versions kalemin kayıtlı tutar değişiklikleri (eskiden yeniye).
 * Seçilen aydan sonraki ilk değişiklik yerinde kalır: yeni tutar o aya kadar geçerlidir.
 */
export function amountChangeText(o: {
  choice: string;
  currentMonth: string;
  closed: string[];
  range: MonthRange;
  before: string;
  after: string;
  versions: { fromMonth: string; label: string }[];
}): EffectText {
  if (o.choice === "all") {
    const hit = closedFrom(o.closed, o.range, null);
    const lost = o.versions.length ? ` Kayıtlı ${o.versions.length} tutar değişikliği silinir.` : "";
    return {
      text: `Bütün aylarda ${o.after} olur (yanlış girilmiş tutarı düzeltmek için).${lost}`,
      warn: hit.length ? `${spanText(hit)} kâr/zararı da değişir.` : null,
    };
  }
  const start = o.range.startMonth ?? null;
  const from = start && start > o.choice ? start : o.choice;
  const later = o.versions.find((v) => v.fromMonth > from) ?? null;
  const parts = [
    start && from <= start
      ? `Kalem ${monthLabel(start)} başladığı için yeni tutar (${o.after}) baştan geçerli.`
      : `${monthLabel(from)} ve sonrasında ${o.after}; öncesi eski tutarla (${o.before}) kalır.`,
  ];
  if (later) parts.push(`${monthLabel(later.fromMonth)} değişikliği (${later.label}) yerinde kalır.`);
  const hit = from < o.currentMonth ? closedFrom(o.closed, o.range, from, later ? shiftMonth(later.fromMonth, -1) : null) : [];
  return { text: parts.join(" "), warn: hit.length ? `Kapanmış ${spanText(hit)} kâr/zararı da değişir.` : null };
}

/** Yeni kalemin / personelin başlangıç ayı etkisi */
export function startText(o: { choice: string; currentMonth: string; closed: string[]; what: "gider" | "personel" }): EffectText {
  const label = o.what === "gider" ? "hesaba girer" : "maaş hesabına girer";
  if (o.choice === "all") {
    return {
      text: `Baştan beri ${label}.`,
      warn: o.closed.length ? `${spanText(o.closed)} kâr/zararına da eklenir.` : null,
    };
  }
  const hit = o.closed.filter((m) => m >= o.choice);
  return {
    text: `${monthLabel(o.choice)} ve sonrasında ${label}; önceki aylar değişmez.`,
    warn: hit.length ? `Kapanmış ${spanText(hit)} kâr/zararına da eklenir.` : null,
  };
}

export interface StopPlan extends EffectText {
  /** Hata varsa (son ay başlangıçtan önce) eylem yapılmaz */
  error: string | null;
}

/**
 * Durdurma: `lastMonth` kalemin hesaba girdiği son ay. `deleteBlocker` verilirse (kalem silinemiyor) hata metni
 * silmeyi önermez; verilmezse (null) "silebilirsiniz" der.
 */
export function stopText(o: {
  lastMonth: string;
  currentMonth: string;
  closed: string[];
  range: MonthRange;
  what: "gider" | "personel";
  deleteBlocker?: string | null;
}): StopPlan {
  const start = o.range.startMonth ?? null;
  if (start && o.lastMonth < start) {
    return {
      text: "",
      warn: null,
      error: o.deleteBlocker
        ? `Son ay, başlangıç ayından (${monthLabel(start)}) önce olamaz; en erken ${monthLabel(start)} seçilebilir.`
        : `Son ay, başlangıç ayından (${monthLabel(start)}) önce olamaz. Hiç hesaba girmeyecekse silebilirsiniz.`,
    };
  }
  const next = shiftMonth(o.lastMonth, 1);
  const label = o.what === "gider" ? "hesaba girmez" : "maaş hesabına girmez";
  const hit = closedFrom(o.closed, o.range, next, o.range.endMonth ?? null);
  return {
    text: `${monthLabel(next)} ve sonrasında ${label}. ${monthLabel(o.lastMonth)} ve öncesi değişmez.`,
    warn: hit.length ? `Kapanmış ${spanText(hit)} kâr/zararından da çıkar.` : null,
    error: null,
  };
}

/**
 * Devam ettirme: bitiş ayı hemen ardından devam ediyorsa (ya da bitiş henüz gelmediyse) bitiş ayı kaldırılır.
 * Arada boş kalan aylar varsa onları değiştirmemek için seçilen aydan itibaren yeni bir kayıt açılır.
 */
export function resumePlan(o: { fromMonth: string; endMonth: string | null; currentMonth: string }): { mode: "clear" | "copy"; gap: string[] } {
  const end = o.endMonth;
  if (!end || end >= o.currentMonth || o.fromMonth <= shiftMonth(end, 1)) return { mode: "clear", gap: [] };
  return { mode: "copy", gap: monthsBetween(shiftMonth(end, 1), shiftMonth(o.fromMonth, -1)) };
}

export function resumeText(o: { fromMonth: string; endMonth: string | null; currentMonth: string; what: "gider" | "personel" }): EffectText {
  const plan = resumePlan(o);
  const label = o.what === "gider" ? "hesaba girer" : "maaş hesabına girer";
  if (plan.mode === "clear") return { text: `${monthLabel(o.fromMonth)} ve sonrasında yeniden ${label}. Önceki aylar değişmez.`, warn: null };
  return {
    text: `Arada kalan ${spanText(plan.gap)} değişmesin diye ${monthLabel(o.fromMonth)} itibarıyla yeni bir kayıt açılır; eski kayıt Geçmiş bölümünde kalır.`,
    warn: null,
  };
}

/** Sunucudaki personel silme kuralı (saveStaff removedIds): kapanmış bir ayın maaş hesabına girdiyse silinemez */
export function staffDeleteBlocker(range: MonthRange & { active?: boolean }, closed: string[]): string | null {
  const used = closed.filter((m) => inRange(range, m));
  return used.length ? `${spanText(used)} maaş hesabına girdi` : null;
}

/**
 * Geçmişte listede gösterilen ayın girişi ve bir öncekisi ("Ekim 2026'dan beri, önce 160.000 ₺").
 * İlk giriş tabandır (ilk değişiklikten önceki aylar); sonrakiler fromMonth sırasıyla.
 */
export function entryAt<E extends { fromMonth: string | null; versionId: number | null }>(history: E[], month: string): { entry: E | null; prev: E | null } {
  if (!history.length) return { entry: null, prev: null };
  let idx = 0;
  for (let i = 1; i < history.length; i++) {
    const f = history[i].fromMonth;
    if (f !== null && f <= month) idx = i;
  }
  return { entry: history[idx], prev: idx > 0 ? history[idx - 1] : null };
}
