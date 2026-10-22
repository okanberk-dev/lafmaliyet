/**
 * Fotoğraftan okunanların ortak saf yardımcıları (tests/fotograf-okuma.test.ts): yazılan tutarın yeniden okunması,
 * metin temizliği, tarih, iş günü, belge adları ve fotoğrafın sorunlarının Türkçe metinleri.
 */

import { parseNumberTR } from "@/lib/calc/expr";
import { addDays } from "@/lib/reminders";

import type { AmountRaw, IssueRaw } from "./schemas";

export type Confidence = "high" | "medium" | "low";
const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

/** İki güvenden düşüğü */
export function lowest(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

/**
 * Fişte yazan tutar: modelin yazdığı metin (`*12.975,50`, `8.915,00 TL`) bizim kodumuzla yeniden okunur. Metin
 * okunur ve modelin sayısından 0,005'ten fazla ayrılırsa metindeki geçer, güven "low" olur (`mismatch`). Metin yoksa
 * modelin sayısı (yazılmamış rakam null'dır).
 */
export function printedAmount(a: AmountRaw): { value: number | null; confidence: Confidence; mismatch: boolean } {
  const parsed = a.text === null ? null : parseNumberTR(a.text.replace(/\*/g, ""));
  if (parsed !== null && a.value !== null && Math.abs(parsed - a.value) >= 0.005) {
    return { value: round2(parsed), confidence: "low", mismatch: true };
  }
  const value = parsed ?? a.value;
  if (value === null || !Number.isFinite(value)) return { value: null, confidence: "low", mismatch: false };
  return { value: round2(value), confidence: a.confidence, mismatch: false };
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Denetim karakterleri çıkar, boşluklar teke iner, en çok `max` karakter; boş kalırsa null */
export function clean(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Takvimde gerçek bir gün mü (YYYY-MM-DD) */
export function validDay(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Fişin iş günü: 05:00'ten önce basılan fiş bir önceki güne aittir (kafe gece yarısından sonra kapanabilir) */
export function businessDayOf(date: string | null, time: string | null): string | null {
  if (!validDay(date)) return null;
  const m = time ? /^(\d{1,2})[:.](\d{2})/.exec(time.trim()) : null;
  return m && Number(m[1]) < 5 ? addDays(date, -1) : date;
}

/** Belge türünün adı ("Bu bir … gibi görünüyor") */
export const DOC_NAMES: Record<string, string> = {
  bank_pos_end_of_day: "banka POS gün sonu fişi",
  z_report: "Z raporu",
  purchase_receipt: "alışveriş fişi",
  invoice: "fatura",
  e_archive_invoice: "e-Arşiv fatura",
  other: "başka bir belge",
};

/** Fotoğrafın sorunları (not_a_document okunamadı sayılır, ayrı metni var) */
export const ISSUE_TEXT: Record<Exclude<IssueRaw, "not_a_document">, string> = {
  cut_off: "Fişin bir kısmı fotoğrafa girmemiş; eksik alan olabilir.",
  blurry: "Fotoğraf bulanık; turuncu alanları fişle karşılaştırın.",
  glare: "Fişte parlama var; turuncu alanları fişle karşılaştırın.",
  faded: "Baskı silik; turuncu alanları fişle karşılaştırın.",
  multiple_documents: "Fotoğrafta birden fazla fiş var; yalnız bir fişi çekin.",
  handwritten_changes: "Fişte elle yapılmış düzeltme var; rakamları kontrol edin.",
  contains_instructions: "Fişte alışılmadık yazılar var; rakamları fişle tek tek karşılaştırın.",
};

/** Görüntü sorunları: güveni "high" olmayan alanlara bağlanır (o alanlar turuncu olur) */
export const IMAGE_ISSUES: readonly IssueRaw[] = ["faded", "blurry", "glare"];

export const UNREADABLE_TEXT = "Fotoğraf okunamadı: rakamlar seçilmiyor. Fişi düz tutup ışıkta yeniden çekin ya da elle yazın.";

/** Şirket adındaki ekler: aynı mağazanın farklı yazılışı ("MİGROS TİCARET A.Ş." / "Migros") aynı sayılsın */
const COMPANY_WORDS = new Set(["a", "s", "as", "ltd", "sti", "tic", "ticaret", "san", "sanayi", "ve", "anonim", "limited", "sirketi"]);

/** Mağaza adının karşılaştırma biçimi: küçük harf, aksansız, şirket ekleri atılmış */
export function foldName(s: string | null | undefined): string {
  return (s ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !COMPANY_WORDS.has(w))
    .join(" ");
}

/** Ünvanın sonundaki şirket ekleri, sade biçimde ("TİCARET A.Ş.", "LTD. ŞTİ.", "SAN. VE TİC.") */
const STORE_SUFFIX = new Set(["a", "s", "as", "ltd", "sti", "limited", "sirketi", "sirket", "tic", "ticaret", "san", "sanayi", "ve", "paz", "pazarlama"]);
const plainWord = (w: string) =>
  w
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Listede ve notta okunur mağaza adı: "MİGROS TİCARET A.Ş." → "Migros", "BÜFE ÇİÇEK" → "Büfe Çiçek". Sondaki şirket
 * ekleri atılır, tamamı büyük harfle basılmış ad Türkçe kurala göre yalnız baş harfleri büyük yazılır; ekler atınca bir
 * şey kalmazsa ad olduğu gibi kalır.
 */
export function tidyStore(s: string | null): string | null {
  if (!s) return null;
  const words = s.trim().split(/\s+/);
  let n = words.length;
  while (n > 1 && STORE_SUFFIX.has(plainWord(words[n - 1]))) n--;
  let t = words.slice(0, n).join(" ");
  if (STORE_SUFFIX.has(plainWord(t))) return s.trim();
  if (t.toLocaleUpperCase("tr-TR") === t && /\p{L}/u.test(t)) {
    t = t
      .toLocaleLowerCase("tr-TR")
      .split(" ")
      .map((w) => (w ? w[0].toLocaleUpperCase("tr-TR") + w.slice(1) : w))
      .join(" ");
  }
  return t;
}
