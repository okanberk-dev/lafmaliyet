/**
 * Vergi takviminin günleri ve dönemleri (plan docs/planlar/vergi.md §3.1, K24): beyanname ve ödemelerin nominal günü,
 * VUK 18'le kaydırılmış yasal son günü (hafta sonu, resmî tatil ve bayram izleyen ilk iş gününe geçer; arife
 * kaydırmaz; tatil listesi src/lib/forecast/calendar.ts, 2028 sonuna kadar), hesap dönemi ve geçici vergi çeyrekleri,
 * hatırlatıcı gününden dönem, varsayılan yıl ve çeyrek. Nakit planı nominal günü kullanır (erken taraf); iki ekran da
 * öbürünün gününü yazar. Saf modül; tests/vergi-takvim.test.ts. Takvimin satırları view.ts'te (taxCalendar).
 */

import { calendarDay, CALENDAR_COVERAGE, weekdayOf } from "../forecast/calendar";
import { addDays, dayMonthTR, longDateTR, monthEnd, shiftMonth } from "../reminders";
import { MONTH_NAMES } from "../constants";

import type { TaxSettings } from "./settings";

export type DueKind = "kdv1" | "kdv2" | "mphb" | "sgk" | "gecici" | "kv" | "ctv";

/** Beyanname ve ödeme günleri (kural tablosu `takvim`, `gecici.gun`); yeni yıl tablosu farklı gün verirse geçirilir */
export interface DueDays {
  kdv1: number;
  kdv2: number;
  mphb: number;
  gecici: number;
}
export const DUE_DAYS_2026: DueDays = { kdv1: 28, kdv2: 25, mphb: 26, gecici: 17 };

const COVERAGE_NOTE = "tatil listesi 2028'de bitiyor";

export interface LegalDue {
  /** Yasal son gün (iş günü) */
  date: string;
  /** Kanundaki (nominal) gün */
  nominal: string;
  shifted: boolean;
  /** Kaydırmanın nedeni: nominal günün adı ("25 Ekim Pazar", "29 Ekim Cumhuriyet Bayramı"); tablo dışı günde kapsam notu */
  reason: string | null;
}

/** Tatil listesinde iş günü olmayan gün: resmî tatil ve bayram (arife değil) */
function holidayOf(date: string): string | null {
  if (date > CALENDAR_COVERAGE.holidaysTo) return null;
  const ev = calendarDay(date).event;
  return ev && ev.kind !== "arife" ? ev.name : null;
}

function isWorkday(date: string): boolean {
  const wd = weekdayOf(date);
  return wd !== 0 && wd !== 6 && holidayOf(date) === null;
}

/** VUK 18: son gün hafta sonu, resmî tatil ya da bayramsa izleyen ilk iş günü; arife kaydırmaz */
export function legalDueDate(date: string): LegalDue {
  let d = date;
  for (let guard = 0; !isWorkday(d) && guard < 15; guard++) d = addDays(d, 1);
  const shifted = d !== date;
  const beyond = date > CALENDAR_COVERAGE.holidaysTo;
  let reason: string | null = null;
  if (beyond) reason = COVERAGE_NOTE;
  else if (shifted) {
    const h = holidayOf(date);
    reason = h ? `${Number(date.slice(8, 10))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${h}` : longDateTR(date);
  }
  return { date: d, nominal: date, shifted, reason };
}

/** Takvim satırının alt yazısı: "Son gün 25 Ekim Pazar → 26 Ekim"; kaydırılmadıysa null */
export function shiftText(l: LegalDue): string | null {
  if (!l.shifted) return null;
  const from = l.reason === COVERAGE_NOTE ? longDateTR(l.nominal) : (l.reason ?? longDateTR(l.nominal));
  return `Son gün ${from} → ${dayMonthTR(l.date)}${l.reason === COVERAGE_NOTE ? ` (${COVERAGE_NOTE})` : ""}`;
}

/** Nakit planı satırının yasal günü (K24): "son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)" */
export function legalDayText(l: LegalDue): string {
  if (!l.shifted) return `son gün ${longDateTR(l.date)}`;
  const from = l.reason === COVERAGE_NOTE ? longDateTR(l.nominal) : (l.reason ?? longDateTR(l.nominal));
  return `son gün ${longDateTR(l.date)} (${from})`;
}

// ---------------------------------------------------------------- Dönemler

/** "2026-Q3" */
export const quarterKey = (year: number, q: number) => `${year}-Q${q}`;

export function parseQuarter(key: string): { year: number; q: number } | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  return m ? { year: Number(m[1]), q: Number(m[2]) } : null;
}

/** "2026-Q3" → "2026/3" */
export function quarterLabel(key: string): string {
  const p = parseQuarter(key);
  return p ? `${p.year}/${p.q}` : key;
}

/** "2026-09" → "Eylül" */
export const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];

/** Çeyreğin ayları: 2026-Q3 → 2026-07, 2026-08, 2026-09 */
export function quarterMonths(key: string): string[] {
  const p = parseQuarter(key)!;
  return [0, 1, 2].map((i) => `${p.year}-${String(3 * p.q - 2 + i).padStart(2, "0")}`);
}

/** Ayın çeyreği: "2026-08" → "2026-Q3" */
export function quarterOfMonth(month: string): string {
  return quarterKey(Number(month.slice(0, 4)), Math.ceil(Number(month.slice(5, 7)) / 3));
}

/**
 * Nominal (kanundaki) gün. Dönem: aylık beyannamelerde "YYYY-MM", geçici vergide "YYYY-Qn", kurumlar vergisinde "YYYY",
 * ÇTV'de "YYYY-1" / "YYYY-2" (taksit; belediyenin tahakkukundaki gün öncelikli)
 */
export function nominalDue(kind: DueKind, period: string, days: DueDays = DUE_DAYS_2026): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (kind) {
    case "kdv1":
      return `${shiftMonth(period, 1)}-${pad(days.kdv1)}`;
    case "kdv2":
      return `${shiftMonth(period, 1)}-${pad(days.kdv2)}`;
    case "mphb":
      return `${shiftMonth(period, 1)}-${pad(days.mphb)}`;
    case "sgk":
      return monthEnd(`${shiftMonth(period, 1)}-01`);
    case "gecici": {
      const p = parseQuarter(period)!;
      return p.q === 4 ? `${p.year + 1}-02-${pad(days.gecici)}` : `${p.year}-${pad(3 * p.q + 2)}-${pad(days.gecici)}`;
    }
    case "kv":
      return `${Number(period) + 1}-04-30`;
    case "ctv": {
      const [y, t] = period.split("-");
      return t === "1" ? `${y}-05-31` : `${y}-11-30`;
    }
  }
}

/** Yılın hesap dönemi: yılbaşı ya da hesap döneminin başı (kıst dönem) → yıl sonu; dönem o yıl başlamadıysa null */
export function periodOf(year: number, settings: Pick<TaxSettings, "periodStart">): { from: string; to: string } | null {
  const from = `${year}-01-01` > settings.periodStart ? `${year}-01-01` : settings.periodStart;
  const to = `${year}-12-31`;
  return from > to ? null : { from, to };
}

/** Çeyreğin hesap dönemiyle kesişen aralığı; dönem dışındaysa null (2026: Q1 dışarıda, Q2 25.06–30.06) */
export function quarterRange(key: string, settings: Pick<TaxSettings, "periodStart">): { from: string; to: string } | null {
  const p = parseQuarter(key);
  if (!p) return null;
  const period = periodOf(p.year, settings);
  const qFrom = `${p.year}-${String(3 * p.q - 2).padStart(2, "0")}-01`;
  const qTo = monthEnd(`${p.year}-${String(3 * p.q).padStart(2, "0")}-01`);
  if (!period || qTo < period.from) return null;
  return { from: qFrom > period.from ? qFrom : period.from, to: qTo };
}

/** Yılın hesap dönemindeki çeyrekleri sırasıyla */
export function periodQuarters(year: number, settings: Pick<TaxSettings, "periodStart">): { key: string; q: number; from: string; to: string }[] {
  const out: { key: string; q: number; from: string; to: string }[] = [];
  for (let q = 1; q <= 4; q++) {
    const key = quarterKey(year, q);
    const r = quarterRange(key, settings);
    if (r) out.push({ key, q, ...r });
  }
  return out;
}

/**
 * Hatırlatıcı gününden geçici vergi dönemi: dönem sonunu izleyen ikinci ay (17 Şubat Y → Y−1/4, Mayıs → 1, Ağustos → 2,
 * Kasım → 3); ertelenmiş kopyanın dönemi asıl gününden (vat-paid.ts originalDue) bulunur
 */
export function quarterOfDue(date: string): string {
  let y = Number(date.slice(0, 4));
  let e = Number(date.slice(5, 7)) - 2;
  if (e <= 0) {
    e += 12;
    y -= 1;
  }
  const qEnd = Math.floor(e / 3) * 3;
  return qEnd === 0 ? quarterKey(y - 1, 4) : quarterKey(y, qEnd / 3);
}

/** Muhtasar hatırlatıcısının dönemi: önceki ay; ayın 1–7'si iki ay öncedir (KDV'deki erteleme kuralı) */
export function mphbPeriodOf(date: string): string {
  return shiftMonth(date.slice(0, 7), Number(date.slice(8, 10)) <= 7 ? -2 : -1);
}

/**
 * Vergi sayfasının varsayılan yılı: 30 Nisan Y'ye kadar, Y−1 hesap dönemindeyse ve Y−1'in kurumlar vergisi kaydı yoksa
 * Y−1 (beyannamesi hazırlanıyor); değilse Y. 2027-03-01 → 2026, 2027-05-01 → 2027.
 */
export function defaultYear(today: string, kvFilings: readonly { period: string }[], settings: Pick<TaxSettings, "periodStart">): number {
  const y = Number(today.slice(0, 4));
  if (today <= `${y}-04-30` && periodOf(y - 1, settings) && !kvFilings.some((f) => f.period === String(y - 1))) return y - 1;
  return y;
}

/** Seçilebilen yıllar: hesap döneminin ilk yılından bugünün yılına; seçici yalnız iki ya da daha fazla yıl varken görünür */
export function yearOptions(today: string, settings: Pick<TaxSettings, "periodStart">): number[] {
  const first = Number(settings.periodStart.slice(0, 4));
  const last = Number(today.slice(0, 4));
  const out: number[] = [];
  for (let y = first; y <= last; y++) out.push(y);
  return out.length ? out : [last];
}

/**
 * Varsayılan çeyrek: geçici vergi günü bugünden sonra gelen, hesap dönemindeki ilk çeyrek (24.10.2026 → 2026-Q3); başka
 * bir yıl seçildiyse o yılın son verili (geçmiş yılda dönemin son) çeyreği, sonraki yılda ilk çeyreği.
 */
export function defaultQuarter(today: string, year: number, settings: Pick<TaxSettings, "periodStart">): string | null {
  const candidates = [Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1].flatMap((y) => periodQuarters(y, settings));
  const next = candidates.find((c) => legalDueDate(nominalDue("gecici", c.key)).date >= today) ?? null;
  const own = periodQuarters(year, settings);
  if (!own.length) return null;
  if (next && next.key.startsWith(`${year}-`)) return next.key;
  if (next && year > Number(next.key.slice(0, 4))) return own[0].key;
  return own[own.length - 1].key;
}
