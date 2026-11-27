// İşçilik / ciro (Raporlar › İşçilik / ciro; docs/RAPORLAR.md): günlük ve haftalık, şube şube. Saf; yükleyici
// src/server/data/iscilik.ts, testi tests/iscilik.test.ts.
//
// Yöntem (ekranda tek satır, LABOR_METHOD): Gelir-gider'in personel kuralı güne bölünür. Tam zamanlının aylık işveren
// maliyeti (net maaştan brüt, SGK ve işsizlik payları, ekler, yemek kartı; Maaşlar'daki "Size maliyeti") ayın takvim
// günlerine eşit dağılır: kapalı günde de maaş işler. Part-time'ın günlük ücreti (ve yemek kartı) Vardiya'da kendi
// şubesinde çalıştığı güne yazılır, aylık ek ödemesi günlere eşit dağılır. Ücreti yazılmamış kişi uydurulmaz: "ücret yok"
// diye adıyla yazılır; Vardiya bağlantısı olmayan part-time'ın günü bilinmez, "vardiya bağlantısı yok". Giderlerdeki
// maaş kalemleri (harcama) kullanılmaz: tarihleri ödeme günüdür, çalışılan güne düşmez.
//
// Ciro KDV hariç (Gelir-gider'in oranlarıyla aynı): günün cirosu kasa satırından (KDV dahil, ödenmez hariç; Kıyas ve Genel
// bakış'ın günlük cirosu) ayın KDV hariç / KDV dahil oranıyla çevrilir; ayın günlerinin toplamı Gelir-gider'in cirosudur.
// Verisi olmayan gün (kasa raporu, LafPOS gün sonu ya da föy yok) sıfır sayılmaz: oran yalnız cirosu bilinen günlerden.

import { addDays, monthShortTR } from "./reminders";

const WEEKDAY_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"] as const;

/** Günün satırı: "3 Kas Pzt" */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${monthShortTR(date)} ${WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}

/** Haftanın satırı: "3–9 Kas", ay değişirse "27 Eki – 2 Kas" */
export function weekLabel(from: string, to: string): string {
  const d = (x: string) => Number(x.slice(8, 10));
  if (from === to) return `${d(from)} ${monthShortTR(from)}`;
  return from.slice(0, 7) === to.slice(0, 7) ? `${d(from)}–${d(to)} ${monthShortTR(to)}` : `${d(from)} ${monthShortTR(from)} – ${d(to)} ${monthShortTR(to)}`;
}

export const LABOR_METHOD =
  "Tam zamanlının aylık işveren maliyeti ayın günlerine eşit bölünür, part-time'ın günlük ücreti Vardiya'da çalıştığı güne yazılır (Gelir-gider'in personel kuralı); ciro KDV hariç.";

/** Kişisel ücreti görmeyen rolün (müdür; docs/ROLLER.md) yöntemi: `withoutDayWages` */
export const LABOR_METHOD_NO_WAGES =
  "Yalnız aylık ücretler: tam zamanlının aylık işveren maliyeti ve part-time'ın aylık ek ödemesi ayın günlerine eşit bölünür. Part-time'ın günlük ücreti kişisel ücrettir, sayılmaz; tutar yazılmaz, yalnız oran. Ciro KDV hariç.";

/** Ayın bir kişisi (o ayın maaşıyla; Gelir-gider'in personnelFor satırı) */
export interface LaborPerson {
  name: string;
  kind: "full_time" | "part_time";
  /** Tam zamanlı: ayın işveren maliyeti. Part-time: aylık ek ödemesi (günlere eşit dağılır) */
  monthly: number;
  /** Part-time: çalıştığı gün başına maliyet (günlük ücret + yemek kartı); tam zamanlıda 0 */
  perDay: number;
  /** Part-time: Vardiya'da kendi şubesinde çalıştığı günler; bağlantısızsa null. Tam zamanlıda yok sayılır */
  workDays: readonly string[] | null;
}

/** Bir günün cirosu: satış (KDV dahil), satış yok (kapalı ya da sıfır Z), veri yok ya da şube henüz açılmamış */
export type LaborDaySales = { kind: "satis"; gross: number } | { kind: "bos" } | { kind: "yok" } | { kind: "kapsam-disi" };

export interface LaborBranchInput {
  id: string;
  name: string;
  /** Ay (YYYY-MM) → o ayın kişileri */
  people: Readonly<Record<string, readonly LaborPerson[]>>;
  /** Ay → KDV hariç ciro ÷ KDV dahil ciro (Gelir-gider'in ayı); bilinmiyorsa verilmez (satış KDV oranıyla çevrilir) */
  netFactor: Readonly<Record<string, number>>;
  /** Satış KDV oranı (ayın oranı bilinmeyende): 0,10 */
  kdv: number;
  sales: (date: string) => LaborDaySales;
}

export interface LaborDay {
  date: string;
  labor: number;
  /** Cirosu (KDV hariç); veri yoksa null, satış yoksa 0 */
  revenue: number | null;
  sales: LaborDaySales["kind"];
}

/** Bir satır (gün ya da hafta) */
export interface LaborRow {
  key: string;
  from: string;
  to: string;
  /** Bütün günlerin işçiliği */
  labor: number;
  /** Cirosu bilinen günlerin cirosu (KDV hariç); hiçbir günün cirosu bilinmiyorsa null */
  revenue: number | null;
  /** Cirosu bilinen günlerin işçiliği ÷ cirosu; ciro sıfır ya da bilinmiyorsa null */
  ratio: number | null;
  /** Verisi olmayan gün sayısı (oran onlarsız) */
  unknownDays: number;
  /** Satışı olmayan (kapalı ya da sıfır Z) gün sayısı */
  closedDays: number;
}

/** Ücreti hesaba girmeyen kişi ve nedeni */
export interface MissingWage {
  month: string;
  name: string;
  reason: "ucret-yok" | "vardiya-yok";
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function daysInMonthOf(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Günün işçiliği: tam zamanlının aylık maliyeti ÷ ayın günü; part-time'ın ek ödemesi ÷ ayın günü + çalıştığı günse gün ücreti */
export function laborOfDay(people: readonly LaborPerson[], date: string): number {
  const dim = daysInMonthOf(date.slice(0, 7));
  let total = 0;
  for (const p of people) {
    total += p.monthly / dim;
    if (p.kind === "part_time" && p.perDay > 0 && p.workDays?.includes(date)) total += p.perDay;
  }
  return total;
}

/**
 * Kişisel ücreti görmeyen rolün (müdür; docs/ROLLER.md › Kararlar) kişileri: part-time'ın günlük ücreti hiçbir güne
 * yazılmaz. Haftanın işçiliği (tutarı ya da cirosuyla oranı) Vardiya'nın günlerine bağlı olsaydı müdür kendi yazdığı tek
 * hücrenin öncesini ve sonrasını (ya da tek part-time'ın çalıştığı gün sayısı farklı iki haftayı) karşılaştırıp o
 * kişinin günlük ücretini bulurdu. Aylık kalemler (tam zamanlının maliyeti, part-time'ın ek ödemesi) Vardiya'dan
 * bağımsızdır, günlere eşit kalır.
 */
export function withoutDayWages(people: readonly LaborPerson[]): LaborPerson[] {
  return people.map((p) => (p.kind === "part_time" ? { ...p, perDay: 0, workDays: [] } : p));
}

/** Ayın ücreti girilmemiş ya da günü bilinmeyen kişileri (uydurulmaz, adıyla yazılır) */
export function missingWages(month: string, people: readonly LaborPerson[]): MissingWage[] {
  const out: MissingWage[] = [];
  for (const p of people) {
    if (p.kind === "full_time" && !(p.monthly > 0)) out.push({ month, name: p.name, reason: "ucret-yok" });
    else if (p.kind === "part_time" && p.workDays === null) out.push({ month, name: p.name, reason: "vardiya-yok" });
    else if (p.kind === "part_time" && !(p.perDay > 0) && (p.workDays?.length ?? 0) > 0) out.push({ month, name: p.name, reason: "ucret-yok" });
  }
  return out;
}

/** [from, to] günleri (dahil) */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Şubenin günleri */
export function laborDays(b: LaborBranchInput, dates: readonly string[]): LaborDay[] {
  return dates.map((date) => {
    const month = date.slice(0, 7);
    const s = b.sales(date);
    const labor = s.kind === "kapsam-disi" ? 0 : laborOfDay(b.people[month] ?? [], date);
    const factor = b.netFactor[month] ?? 1 / (1 + b.kdv);
    const revenue = s.kind === "satis" ? s.gross * factor : s.kind === "bos" ? 0 : null;
    return { date, labor, revenue, sales: s.kind };
  });
}

/** Şubelerin günlerinin toplamı (Tümü): gün ancak her şubenin o günü biliniyorsa (ya da şube açılmamışsa) bilinir */
export function sumDays(perBranch: readonly (readonly LaborDay[])[]): LaborDay[] {
  if (!perBranch.length) return [];
  return perBranch[0].map((d, i) => {
    const all = perBranch.map((b) => b[i]);
    const open = all.filter((x) => x.sales !== "kapsam-disi");
    const unknown = open.some((x) => x.revenue === null);
    const sold = open.some((x) => x.sales === "satis");
    return {
      date: d.date,
      labor: all.reduce((a, x) => a + x.labor, 0),
      revenue: unknown || !open.length ? null : open.reduce((a, x) => a + (x.revenue ?? 0), 0),
      sales: !open.length ? "kapsam-disi" : unknown ? "yok" : sold ? "satis" : "bos",
    };
  });
}

/** Günlerin satırı: oran yalnız cirosu bilinen günlerden */
export function laborRow(key: string, days: readonly LaborDay[]): LaborRow {
  const counted = days.filter((d) => d.sales !== "kapsam-disi");
  const known = counted.filter((d) => d.revenue !== null);
  const revenue = known.length ? r2(known.reduce((a, d) => a + (d.revenue ?? 0), 0)) : null;
  const knownLabor = known.reduce((a, d) => a + d.labor, 0);
  return {
    key,
    from: days[0]?.date ?? key,
    to: days[days.length - 1]?.date ?? key,
    labor: r2(counted.reduce((a, d) => a + d.labor, 0)),
    revenue,
    ratio: revenue !== null && revenue > 0 ? knownLabor / revenue : null,
    unknownDays: counted.length - known.length,
    closedDays: counted.filter((d) => d.sales === "bos").length,
  };
}

/** Pazartesi (haftanın başı) */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/** Günlük satırlar */
export function dailyRows(days: readonly LaborDay[]): LaborRow[] {
  return days.map((d) => laborRow(d.date, [d]));
}

/** Haftalık satırlar (pazartesiden pazara; ilk ve son hafta verilen günlerle sınırlı) */
export function weeklyRows(days: readonly LaborDay[]): LaborRow[] {
  const weeks = new Map<string, LaborDay[]>();
  for (const d of days) {
    const k = weekStart(d.date);
    const list = weeks.get(k);
    if (list) list.push(d);
    else weeks.set(k, [d]);
  }
  return [...weeks.entries()].map(([k, list]) => laborRow(k, list));
}
