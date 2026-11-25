/**
 * Satış tahmininin Türkiye takvimi (saf; tests/satis-tahmini.test.ts). Resmî tatiller, bayramlar ve arifeler, Ramazan
 * ayı ve MEB okul tatilleri; tarihler "YYYY-MM-DD", hafta günü Date.UTC ile (saat dilimi ve yaz saati yok). Tablo
 * elle tutulur: resmî tatiller ve bayramlar 2028 sonuna, okul tatilleri 2026–2027 öğretim yılına kadar. Yeni yıl ve MEB
 * takvimi nasıl eklenir: docs/OZEL-GUNLER.md › Kod. Kaynaklar CALENDAR_SOURCES'ta.
 */

import { addDays, daysBetween } from "@/lib/reminders";

export type EventKind = "resmi" | "arife" | "ramazan-bayrami" | "kurban-bayrami";
export type SeasonKind = "ramazan" | "okul-tatili";
/** Yöneticinin girdiği özel günün türü (special_days.kind) */
export type SpecialKind = "derbi" | "avm" | "kampanya" | "kapali" | "diger";

export interface CalendarEntry {
  from: string;
  to: string;
  kind: EventKind | SeasonKind;
  /** Uzun ad: "Cumhuriyet Bayramı arifesi", "1. dönem ara tatili" */
  name: string;
  /** Kısa ad (etiket ve personel satırı): "Cumhuriyet Bayramı", "Arife", "19 Mayıs", "Okul tatili" */
  short: string;
  /** Bitişi tahmini (MEB gelecek öğretim yılını açıklamadı) */
  estimated?: true;
}

export const WEEKDAY_NAMES = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"] as const;
export const WEEKDAY_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"] as const;
const MONTH_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// Resmî tatiller (2429 sayılı Kanun; her yıl aynı gün). 28 Ekim öğleden sonra yarım gün: arife sayılır
const RESMI: { md: string; name: string; short: string }[] = [
  { md: "01-01", name: "Yılbaşı", short: "Yılbaşı" },
  { md: "04-23", name: "Ulusal Egemenlik ve Çocuk Bayramı", short: "23 Nisan" },
  { md: "05-01", name: "Emek ve Dayanışma Günü", short: "1 Mayıs" },
  { md: "05-19", name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı", short: "19 Mayıs" },
  { md: "07-15", name: "Demokrasi ve Millî Birlik Günü", short: "15 Temmuz" },
  { md: "08-30", name: "Zafer Bayramı", short: "Zafer Bayramı" },
  { md: "10-29", name: "Cumhuriyet Bayramı", short: "Cumhuriyet Bayramı" },
];
const YEARS = [2026, 2027, 2028];

/**
 * Dinî günler (Diyanet). Ramazan ayı ilk oruçtan arifeye kadar; arife yarım gün; bayram 3 (Ramazan) ya da 4 (Kurban) gün.
 * - 2026: ilk oruç 19 Şubat Perşembe; Kurban arifesi 26 Mayıs Salı (CNN Türk, İş Bankası, Gazete Vatan; Diyanet).
 * - 2027: Ramazan 8 Şubat – 8 Mart, bayram 9–11 Mart; Kurban arifesi 15 Mayıs Cumartesi (Diyanet'in 2027 takvimi, Evrensel
 *   24.08.2026; CNN Türk; Milli Gazete).
 * - 2028: ilk oruç 28 Ocak Cuma, bayram 26–28 Şubat, Kurban 5–8 Mayıs. Diyanet'in 2028 dinî günler sayfası
 *   (vakithesaplama.diyanet.gov.tr) bu oturumdan açılamadı; 24 Ekim 2026'da ikincil kaynaklarla yeniden denetlendi
 *   (izintakvimi.com, onlinesaat.web.tr: bayram 26–28 Şubat, arife 25 Şubat Cuma; 29 günlük ay ilk orucu 28 Ocak yapar).
 *   Diyanet sayfası açılınca bir kez daha bakılmalı.
 */
const RELIGIOUS: { year: number; ramazan: [string, string]; ramazanBayrami: [string, string]; kurbanArife: string; kurbanBayrami: [string, string] }[] = [
  { year: 2026, ramazan: ["2026-02-19", "2026-03-19"], ramazanBayrami: ["2026-03-20", "2026-03-22"], kurbanArife: "2026-05-26", kurbanBayrami: ["2026-05-27", "2026-05-30"] },
  { year: 2027, ramazan: ["2027-02-08", "2027-03-08"], ramazanBayrami: ["2027-03-09", "2027-03-11"], kurbanArife: "2027-05-15", kurbanBayrami: ["2027-05-16", "2027-05-19"] },
  { year: 2028, ramazan: ["2028-01-28", "2028-02-25"], ramazanBayrami: ["2028-02-26", "2028-02-28"], kurbanArife: "2028-05-04", kurbanBayrami: ["2028-05-05", "2028-05-08"] },
];

/**
 * Okul tatilleri (MEB çalışma takvimi): 2025–2026 öğretim yılı 26 Haziran 2026 Cuma bitti; 2026–2027 14 Eylül 2026'da
 * başladı, 1. dönem 22 Ocak 2027'de biter, son ders günü 25 Haziran 2027 (MEB, AA). 2027 yaz tatilinin bitişi MEB
 * 2027–2028'i açıklayana kadar tahmini (Eylül'ün ikinci pazartesinden önceki pazar).
 */
const SCHOOL: CalendarEntry[] = [
  { from: "2026-06-27", to: "2026-09-13", kind: "okul-tatili", name: "Yaz tatili", short: "Okul tatili" },
  { from: "2026-11-16", to: "2026-11-20", kind: "okul-tatili", name: "1. dönem ara tatili", short: "Okul tatili" },
  { from: "2027-01-25", to: "2027-02-05", kind: "okul-tatili", name: "Yarıyıl tatili", short: "Okul tatili" },
  { from: "2027-03-08", to: "2027-03-12", kind: "okul-tatili", name: "2. dönem ara tatili", short: "Okul tatili" },
  { from: "2027-06-26", to: "2027-09-12", kind: "okul-tatili", name: "Yaz tatili", short: "Okul tatili", estimated: true },
];

function buildCalendar(): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const y of YEARS) {
    for (const r of RESMI) out.push({ from: `${y}-${r.md}`, to: `${y}-${r.md}`, kind: "resmi", name: r.name, short: r.short });
    out.push({ from: `${y}-10-28`, to: `${y}-10-28`, kind: "arife", name: "Cumhuriyet Bayramı arifesi", short: "Arife" });
  }
  for (const r of RELIGIOUS) {
    out.push({ from: r.ramazan[0], to: r.ramazan[1], kind: "ramazan", name: "Ramazan ayı", short: "Ramazan" });
    out.push({ from: r.ramazan[1], to: r.ramazan[1], kind: "arife", name: "Ramazan Bayramı arifesi", short: "Arife" });
    out.push({ from: r.ramazanBayrami[0], to: r.ramazanBayrami[1], kind: "ramazan-bayrami", name: "Ramazan Bayramı", short: "Ramazan Bayramı" });
    out.push({ from: r.kurbanArife, to: r.kurbanArife, kind: "arife", name: "Kurban Bayramı arifesi", short: "Arife" });
    out.push({ from: r.kurbanBayrami[0], to: r.kurbanBayrami[1], kind: "kurban-bayrami", name: "Kurban Bayramı", short: "Kurban Bayramı" });
  }
  out.push(...SCHOOL);
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind));
}

export const TR_CALENDAR: readonly CalendarEntry[] = buildCalendar();

/** Her yıl aynı gün olan resmî tatilin adı (tablonun kapsamı dışındaki yıllar için; bayramlar orada bilinmez) */
export function fixedHolidayName(date: string): string | null {
  return RESMI.find((r) => r.md === date.slice(5, 10))?.name ?? null;
}

/** Tablonun kapsadığı son günler; ekran bunlardan önce uyarır (coverageNote) */
export const CALENDAR_COVERAGE = { holidaysTo: "2028-12-31", schoolTo: "2027-06-25", schoolEstimatedTo: "2027-09-12" } as const;

export const CALENDAR_SOURCES: readonly { label: string; url: string }[] = [
  { label: "2026 resmî tatiller (CNN Türk)", url: "https://www.cnnturk.com/guncel/2026da-hangi-gunler-resmi-tatil-liste-liste-resmi-tatil-gunleri-2026-2362840" },
  { label: "2026 resmî tatiller (İş Bankası)", url: "https://www.isbank.com.tr/blog/2026-resmi-tatiller-takvimi" },
  { label: "2027 resmî tatiller ve bayramlar (CNN Türk)", url: "https://www.cnnturk.com/turkiye/2027-resmi-tatiller-takvimi-dini-bayramlar-resmi-tatil-gunler-ne-zaman-2027-ramazan-ve-kurban-bayrami-tarihleri-3447415" },
  { label: "Diyanet 2027 takvimi (Evrensel)", url: "https://www.evrensel.net/haber/5997565/diyanet-2027-takvimini-duyurdu-ramazan-ne-zaman-basliyor" },
  { label: "Diyanet 2028 dinî günler", url: "https://vakithesaplama.diyanet.gov.tr/icerik.php?icerik=185" },
  { label: "2028 Ramazan Bayramı (izintakvimi)", url: "https://www.izintakvimi.com/2028/02/ramazan-bayrami-1-gun-20280226" },
  { label: "2028 Kurban Bayramı (izintakvimi)", url: "https://www.izintakvimi.com/2028/05/kurban-bayrami-1-gun-20280505" },
  { label: "MEB 2026–2027 çalışma takvimi", url: "https://www.meb.gov.tr/2026-2027-egitim-ogretim-yili-takvimi-aciklandi/haber/41057/tr" },
  { label: "MEB 2026–2027 (AA)", url: "https://www.aa.com.tr/tr/gundem/meb-2026-2027-egitim-ogretim-yili-takvimini-belirledi/3966122" },
];

export interface CalendarDay {
  date: string;
  /** 0 = Pazar … 6 = Cumartesi */
  weekday: number;
  /** Günün tek olayı (öncelik: bayram > resmî tatil > arife); bayramda `day` kaçıncı gün */
  event: { kind: EventKind; name: string; short: string; day?: number } | null;
  seasons: { kind: SeasonKind; name: string; short: string }[];
}

/** 0 = Pazar … 6 = Cumartesi; Date.UTC ile, saat diliminden bağımsız */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const covers = (e: { from: string; to: string }, date: string) => e.from <= date && date <= e.to;
const isBayram = (k: string): k is "ramazan-bayrami" | "kurban-bayrami" => k === "ramazan-bayrami" || k === "kurban-bayrami";

/** Günün takvim bilgisi: tek olay (bayram resmî tatili, resmî tatil arifeyi geçer) ve mevsimler */
export function calendarDay(date: string): CalendarDay {
  const hits = TR_CALENDAR.filter((e) => covers(e, date));
  const bayram = hits.find((e) => isBayram(e.kind));
  const resmi = hits.find((e) => e.kind === "resmi");
  const arife = hits.find((e) => e.kind === "arife");
  let event: CalendarDay["event"] = null;
  if (bayram) {
    const day = daysBetween(bayram.from, date) + 1;
    // Bayram ile resmî tatil aynı güne düşerse (2027-05-19) bayram gösterilir, resmî tatil adına eklenir
    event = { kind: bayram.kind as EventKind, name: `${bayram.name} ${day}. gün${resmi ? ` · ${resmi.short}` : ""}`, short: bayram.short, day };
  } else if (resmi) {
    event = { kind: "resmi", name: resmi.name, short: resmi.short };
  } else if (arife) {
    event = { kind: "arife", name: arife.name, short: arife.short };
  }
  const seasons = hits.filter((e) => e.kind === "ramazan" || e.kind === "okul-tatili").map((e) => ({ kind: e.kind as SeasonKind, name: e.name, short: e.short }));
  return { date, weekday: weekdayOf(date), event, seasons };
}

/** `today`'den başlayan `days` gündeki takvim kayıtları (bayram ve tatil tek satır, başlangıcına göre sıralı) */
export function upcomingCalendar(today: string, days: number): { from: string; to: string; kind: EventKind | SeasonKind; name: string }[] {
  const last = addDays(today, days - 1);
  return TR_CALENDAR.filter((e) => e.to >= today && e.from <= last).map((e) => ({ from: e.from, to: e.to, kind: e.kind, name: e.name }));
}

/** Tablonun bitmesine yaklaşınca ekrandaki not; yoksa null */
export function coverageNote(today: string): string | null {
  const notes: string[] = [];
  if (today >= "2027-08-01") notes.push("Okul takvimi 2027–2028 için henüz eklenmedi.");
  if (today >= "2028-11-01") notes.push("Takvim tablosu 2028 sonunda bitiyor; 2029 eklenmeli.");
  return notes.length ? notes.join(" ") : null;
}

/** "22 Eki Per" */
export function shortDateTR(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTH_SHORT[Number(date.slice(5, 7)) - 1]} ${WEEKDAY_SHORT[weekdayOf(date)]}`;
}

/** Aralık: aynı gün "28 Ekim Çarşamba", aynı ay "16–20 Kasım", ayrı aylar "27 Haziran – 13 Eylül" */
export function rangeTR(from: string, to: string): string {
  const d = (x: string) => Number(x.slice(8, 10));
  const m = (x: string) => MONTH_NAMES[Number(x.slice(5, 7)) - 1];
  if (from === to) return `${d(from)} ${m(from)} ${WEEKDAY_NAMES[weekdayOf(from)]}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${d(from)}–${d(to)} ${m(to)}`;
  return `${d(from)} ${m(from)} – ${d(to)} ${m(to)}`;
}

/** Kısa aralık: aynı gün "25 Eki Cmt", aynı ay "16–20 Kas", ayrı aylar "30 Eki – 2 Kas" */
export function shortRangeTR(from: string, to: string): string {
  if (from === to) return shortDateTR(from);
  const d = (x: string) => Number(x.slice(8, 10));
  const m = (x: string) => MONTH_SHORT[Number(x.slice(5, 7)) - 1];
  if (from.slice(0, 7) === to.slice(0, 7)) return `${d(from)}–${d(to)} ${m(to)}`;
  return `${d(from)} ${m(from)} – ${d(to)} ${m(to)}`;
}
