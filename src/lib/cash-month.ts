/**
 * Kasa raporlarından ay bilgisi (saf; sunucu ve tarayıcı birlikte kullanır; tests/kasa-ay-bilgisi.test.ts). Personelin
 * her akşam girdiği Z raporlarından ayın açık günü, POS cirosu, indirimi, ödenmezi ve kartlı satış oranı çıkar.
 *
 * Hiçbir şey months tablosuna yazılmaz: değerler model yüklenirken hesaplanır (src/server/data/dataset.ts), yeni rapor,
 * düzeltme ya da silme sayıyı kendiliğinden değiştirir. Elle yazılan her zaman geçerlidir; boşaltılan alan kasaya döner.
 * Kasa raporları ay ortasında başladıysa (partialFrom) toplamlar ayın yalnız bir kısmını kapsar ve uygulanmaz; oran
 * yine geçerlidir. Ayrıntı: docs/KASA-RAPORU.md › Ay bilgisine aktarım.
 */

import type { FieldSource, Month, MonthField, TillMonth } from "./calc/types";
import { MONTH_NAMES } from "./constants";
import { money } from "./format";
import { addDays, dayLocativeTR, monthEnd } from "./reminders";

/** Ay bilgisine giden alanlar (kasa raporundan bunlar okunur) */
export interface TillRow {
  date: string;
  zTotal: number;
  card: number;
  mealCard: number;
  discounts: number | null;
  offRevenue: number | null;
}

/** months tablosunun satırı: elle yazılanlar, boş = yazılmamış */
export interface MonthEntry {
  month: string;
  openDays: number | null;
  posRevenue: number | null;
  discounts: number | null;
  offRevenue: number | null;
  cardShare: number | null;
  note: string | null;
}

export const MONTH_FIELDS: readonly MonthField[] = ["openDays", "posRevenue", "discounts", "offRevenue", "cardShare"];

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Raporları aylara toplar. `through`: eksik günler bu güne kadar aranır (süren ayda dün: bugünün raporu akşam girilir;
 * girildiyse o da sayılır). `firstEver`: ilk raporun günü (verilmezse satırların en eskisi); yalnız bir ayın satırları
 * verilince ay ortasında başlayan ilk ay buna göre tanınır.
 */
export function tillMonths(rows: TillRow[], through: string, firstEver?: string | null, pendingLate?: Iterable<string>): TillMonth[] {
  const waiting = pendingLate ? new Set(pendingLate) : null;
  if (!rows.length) return [];
  const first = firstEver ?? rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date);
  const byMonth = new Map<string, TillRow[]>();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(r);
    byMonth.set(key, list);
  }
  return [...byMonth.keys()].sort().map((month) => {
    const list = byMonth.get(month)!.sort((a, b) => a.date.localeCompare(b.date));
    const start = `${month}-01`;
    const end = monthEnd(start);
    const lastDate = list[list.length - 1].date;
    const from = first > start ? first : start;
    const upto = through > lastDate ? through : lastDate;
    const to = upto < end ? upto : end;
    const have = new Set(list.map((r) => r.date));
    const missing: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (!have.has(d)) missing.push(d);
    const sum = (xs: TillRow[], f: (r: TillRow) => number) => r2(xs.reduce((a, r) => a + f(r), 0));
    const posRevenue = sum(list, (r) => r.zTotal);
    const disc = list.filter((r) => r.discounts != null);
    const off = list.filter((r) => r.offRevenue != null);
    // Kart + yemek kartı (bankanın POS komisyonu alınan ödemeler); online ve diğer komisyonsuz. Yanlış yazılmış bir
    // ödeme türü oranı %100'ün üstüne taşımasın
    const card = sum(list, (r) => r.card + r.mealCard);
    return {
      month,
      from,
      to,
      reported: list.length,
      openDays: list.filter((r) => r.zTotal > 0).length,
      posRevenue,
      discounts: disc.length ? sum(disc, (r) => r.discounts!) : null,
      discountDays: disc.length,
      offRevenue: off.length ? sum(off, (r) => r.offRevenue!) : null,
      offDays: off.length,
      cardShare: posRevenue > 0 ? Math.min(1, Math.round((card / posRevenue) * 10_000) / 10_000) : null,
      missing,
      ...(waiting ? { pending: missing.filter((d) => waiting.has(d)) } : {}),
      partialFrom: first > start && first.slice(0, 7) === month ? first : null,
      lastDate,
    };
  });
}

/**
 * Kasadan uygulanacak değerler (uygulanmayan null). Toplamlar (açık gün, ciro, indirim, ödenmez) ay ortasında başlayan
 * ayda ya da hiç satış yokken uygulanmaz; indirim ve ödenmez hiçbir günde girilmediyse uygulanmaz. Oran her zaman.
 */
export function kasaValues(t: TillMonth): Record<MonthField, number | null> {
  const sums = t.partialFrom === null && t.openDays > 0;
  return {
    openDays: sums ? t.openDays : null,
    posRevenue: sums ? t.posRevenue : null,
    discounts: sums ? t.discounts : null,
    offRevenue: sums ? t.offRevenue : null,
    cardShare: t.cardShare,
  };
}

/**
 * Ayın etkin bilgisi. Alan alan: elle yazılan (boş değil) → o; yoksa kasa raporlarından (uygulanıyorsa); yoksa
 * varsayılan (açık gün, ciro ve oran boş; indirim ve ödenmez 0). Kaynaklar ve kasanın değerleri ekranlar için taşınır.
 */
export function resolveMonth(month: string, entry: MonthEntry | undefined, till: TillMonth | undefined): Month {
  const values = till ? kasaValues(till) : null;
  const sources = {} as Record<MonthField, FieldSource>;
  const pick = (f: MonthField): number | null => {
    const typed = entry?.[f] ?? null;
    if (typed !== null) {
      sources[f] = "manual";
      return typed;
    }
    const fromTill = values?.[f] ?? null;
    sources[f] = fromTill !== null ? "kasa" : "none";
    return fromTill;
  };
  return {
    month,
    openDays: pick("openDays"),
    posRevenue: pick("posRevenue"),
    discounts: pick("discounts") ?? 0,
    offRevenue: pick("offRevenue") ?? 0,
    cardShare: pick("cardShare"),
    note: entry?.note ?? null,
    sources,
    kasa: till && values ? { values, till } : null,
  };
}

/** Ay satırları ve kasa ayları birleşir: yalnız kasa raporu olan ay da (satırı yoksa) ay seçicilerde görünür */
export function resolveMonths(entries: MonthEntry[], tills: TillMonth[]): Month[] {
  const byEntry = new Map(entries.map((e) => [e.month, e]));
  const byTill = new Map(tills.map((t) => [t.month, t]));
  return [...new Set([...byEntry.keys(), ...byTill.keys()])].sort().map((m) => resolveMonth(m, byEntry.get(m), byTill.get(m)));
}

/**
 * Elle yazılan değer (kasadan gelen ya da boş alan null). Kaynak bilinmiyorsa (testler, Excel verisi): açık gün, ciro ve
 * oran boş değilse, indirim ve ödenmez 0 değilse elle yazılmış sayılır.
 */
export function manualOf(info: Month | undefined, f: MonthField): number | null {
  if (!info) return null;
  const v = f === "cardShare" ? (info.cardShare ?? null) : info[f];
  if (info.sources) return info.sources[f] === "manual" ? v : null;
  if (f === "discounts" || f === "offRevenue") return v ? v : null;
  return v;
}

/**
 * Ay satırında elle yazılmış bir şey kalmadı mı (boş satır silinir; ay seçicide deneme ayı kalmasın). İndirim ve
 * ödenmezin 0'ı, ayın kasa raporu yoksa boş sayılır (eski satırların varsayılan sıfırı; etkin değer zaten 0); kasa
 * raporu varsa elle yazılmış 0 kasanın toplamının yerine geçer ve satırla birlikte kaybolmamalıdır.
 */
export function monthRowEmpty(row: Omit<MonthEntry, "month">, hasTill: boolean): boolean {
  const zeroIsEmpty = (v: number | null) => v === null || (v === 0 && !hasTill);
  return row.openDays === null && row.posRevenue === null && row.cardShare === null && !row.note && zeroIsEmpty(row.discounts) && zeroIsEmpty(row.offRevenue);
}

/**
 * Eksik günler: "5, 12, 20 Kasım"; fazlası "… ve 2 gün daha" (ay değişirse her gün kendi ayıyla). `pending`: geç raporu
 * onay bekleyen günler, "12 (onay bekliyor)"
 */
export function missingText(days: string[], max = 5, pending: readonly string[] = []): string {
  if (!days.length) return "";
  const shown = days.slice(0, max);
  const sameMonth = shown.every((d) => d.slice(0, 7) === shown[0].slice(0, 7));
  const name = (d: string) => MONTH_NAMES[Number(d.slice(5, 7)) - 1];
  const mark = (d: string) => (pending.includes(d) ? " (onay bekliyor)" : "");
  const list = sameMonth
    ? `${shown.map((d) => `${Number(d.slice(8, 10))}${mark(d)}`).join(", ")} ${name(shown[0])}`
    : shown.map((d) => `${Number(d.slice(8, 10))} ${name(d)}${mark(d)}`).join(", ");
  return days.length > max ? `${list} ve ${days.length - max} gün daha` : list;
}

/** "3 gün rapor yok: 5, 12, 20 Kasım. O günler açıksanız ciro ve açık gün eksik kalır." */
export function missingSentence(t: Pick<TillMonth, "missing" | "pending">): string {
  return `${t.missing.length} gün rapor yok: ${missingText(t.missing, 5, t.pending)}. O günler açıksanız ciro ve açık gün eksik kalır.`;
}

/** "Kasa raporları 20 Ekim'de başladı; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan." */
export function partialSentence(t: Pick<TillMonth, "partialFrom">): string {
  return `Kasa raporları ${dayLocativeTR(t.partialFrom!)} başladı; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan.`;
}

/**
 * Kasa sayfasındaki tek satır: ayın açık günü ve cirosu nereden geliyor (Satışlar'a bağlantının metni). Ayın kasa
 * raporu yoksa null.
 */
export function kasaMonthLine(info: Month | undefined): string | null {
  const t = info?.kasa?.till;
  if (!info || !t) return null;
  if (t.partialFrom) return `Kasa raporları ${dayLocativeTR(t.partialFrom)} başladı; bu ayın açık gün ve cirosu elle girilir`;
  const days = info.sources?.openDays;
  const pos = info.sources?.posRevenue;
  if (days === "kasa" && pos === "kasa") return "Bu ayın açık gün ve cirosu kasa raporlarından";
  const k = info.kasa!.values;
  if (days === "manual" && pos === "manual") {
    return k.openDays !== null && k.posRevenue !== null
      ? `Bu ayın açık gün ve cirosu elle girildi (kasa raporlarında ${k.openDays} gün, ${money(k.posRevenue)})`
      : "Bu ayın açık gün ve cirosu elle girildi";
  }
  if (days === "kasa") return "Bu ayın açık günü kasa raporlarından, cirosu elle girildi";
  if (pos === "kasa") return "Bu ayın cirosu kasa raporlarından, açık günü elle girildi";
  return "Bu ay kasa raporlarında satış yok; açık gün ve ciro elle girilir";
}
