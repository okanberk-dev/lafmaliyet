import { MONTH_NAMES } from "./constants";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("tr-TR", { minimumFractionDigits: min, maximumFractionDigits: max });
const cache = new Map<string, Intl.NumberFormat>();
function fmt(min: number, max: number) {
  const k = `${min}-${max}`;
  let f = cache.get(k);
  if (!f) {
    f = nf(min, max);
    cache.set(k, f);
  }
  return f;
}

export function num(v: number | null | undefined, digits = 0, minDigits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  // En az ondalık en çoktan büyük verilirse Intl hata fırlatır (sayfa çöker); "en çok" olan büyüğü sayılır
  const max = Math.max(digits, minDigits);
  const min = Math.min(digits, minDigits);
  const r = Object.is(Math.round(v * 10 ** max) / 10 ** max, -0) ? 0 : v;
  return fmt(min, max).format(r);
}

// Tutarla ₺ arasında bölünmez boşluk: satır sarılınca "₺" tek başına alt satıra düşmez
const NBSP = "\u00a0";

/** 1.234 ₺ */
export function tl(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return `${num(v, digits, digits)}${NBSP}₺`;
}

/**
 * Ödeme tutarı ve toplamları: küsuratlıysa iki ondalık (12.500,50 ₺), değilse tam (12.500 ₺). Kartta kuruşlu
 * gösterilen tutarların toplamı da kuruşlu yazılır (özet 12.501 ₺ yerine 12.500,50 ₺).
 */
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return tl(v, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2);
}

/** Küçük tutarlar için 2 ondalık (birim maliyet vb.) */
export function tl2(v: number | null | undefined): string {
  return tl(v, 2);
}

/** Çok küçük birim maliyetler (₺/gr) için 4 ondalığa kadar */
export function tlUnit(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const abs = Math.abs(v);
  const digits = abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
  return `${num(v, digits, 2)}${NBSP}₺`;
}

/** %25,4 */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (v < 0 && Math.round(v * 100 * 10 ** digits) !== 0) return `-%${num(-v * 100, digits, digits)}`;
  return `%${num(Math.abs(v) * 100, digits, digits)}`;
}

/** "2026-09" -> "Eylül 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-09" -> "Eyl" */
export function monthShort(month: string): string {
  const m = Number(month.split("-")[1]);
  return MONTH_NAMES[m - 1].slice(0, 3);
}

/** "2026-09-14" -> "14.09.2026" */
export function dateTR(date: string | null | undefined): string {
  if (!date) return "–";
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Zaman damgasının İstanbul günü ("YYYY-MM-DD"). ISO metnin ilk on harfi UTC günüdür: 00:00-03:00 arasındaki değişiklik
 * bir gün önceye yazılırdı (denetim E-70). Yalnız gün olan metin ("2026-11-01") aynen döner; çözülemeyen metin ilk on
 * harfiyle.
 */
export function dayTR(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return typeof at === "string" ? at.slice(0, 10) : "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function dateTimeTR(d: Date | string | null | undefined): string {
  if (!d) return "–";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}

/** Miktar + birim: "18 gr", "1,5 kg" */
export function qty(v: number | null | undefined, unit?: string | null, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return unit ? `${num(v, digits)} ${unit}` : num(v, digits);
}

/** Excel benzeri: işaretli tutar için CSS tonu */
export function signTone(v: number | null | undefined): "pos" | "neg" | "zero" {
  if (!v) return "zero";
  return v > 0 ? "pos" : "neg";
}
