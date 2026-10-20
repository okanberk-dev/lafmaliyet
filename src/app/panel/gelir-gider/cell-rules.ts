// Gelir-gider tablosundaki giriş kuralları (saf; istemci kaydetmeden önce denetler, sunucu da aynısını uygular).
// Testleri: tests/gelir-gider-cells.test.ts

import { daysInMonth } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { monthLabel, tl } from "@/lib/format";

/** Hücre notunun en fazla uzunluğu (server/actions/pnl.ts setPnlCell ile aynı) */
export const CELL_NOTE_MAX = 500;
/** Ay notunun en fazla uzunluğu (setMonthNote ile aynı) */
export const MONTH_NOTE_MAX = 1000;

/**
 * Açık gün: tam sayı, 0 ile ayın gün sayısı arası. Excel'de açık gün ÷ ayın gün sayısı oranı kullanılır;
 * gün sayısından büyük bir değer kira, personel gibi giderleri %100'ün üzerine çıkarırdı.
 */
export function openDaysError(month: string, v: number | null): string | null {
  if (v === null) return null;
  const dim = daysInMonth(month);
  if (!Number.isFinite(v) || v < 0) return "Açık gün negatif olamaz";
  if (!Number.isInteger(v)) return "Açık gün tam sayı olmalı";
  if (v > dim) return `En fazla ${dim} gün (${monthLabel(month)} ${dim} gün çeker)`;
  return null;
}

export type NoteSaveKind = "auto" | "manual";

/**
 * Not penceresinde "Kaydet"in ne yapacağı (ekranda açıkça yazılır):
 * - "clear": tutar boş → hücre hesaplanana döner / boşalır, not da silinir
 * - "freeze": hesaplanan bir hücreye yalnızca not eklendi → bu tutar elle girilmiş sayılır
 * - "save": tutar ve not birlikte kaydedilir
 */
export function noteSaveEffect(o: {
  kind: NoteSaveKind;
  overridden: boolean;
  amount: number | null;
  computed: number | null;
}): "clear" | "freeze" | "save" {
  if (o.amount === null) return "clear";
  if (o.kind === "auto" && !o.overridden && o.computed !== null && Math.abs(o.amount - o.computed) < 0.005) return "freeze";
  return "save";
}

/** Not metni: boşluklar kırpılır, boş metin null (notu sil) */
export function cleanNote(text: string): string | null {
  const t = text.trim();
  return t ? t : null;
}

/**
 * Hücrede Enter'a basılınca kaydı engelleyen sorun (yoksa null). Sorun varsa hücre açık kalır ve yazılan
 * metin korunur (Excel de geçersiz girişte hücreden çıkarmaz).
 */
export function enterProblem(text: string, validate?: (v: number | null) => string | null): string | null {
  const t = text.trim();
  const v = t === "" ? null : parseNumberTR(t);
  if (t !== "" && v === null) return "Geçerli bir sayı girin, ör. 1.250,50";
  return validate?.(v) ?? null;
}

/**
 * Not penceresinde kaydedince gösterilecek ileti: tutar da değiştiyse o da söylenir
 * ("Tutar 700 ₺ oldu, not eklendi"), yalnızca not eklendiyse "Not eklendi".
 */
export function noteSaveMessage(o: {
  prevValue: number | null;
  amount: number;
  prevNote: string | null;
  note: string | null;
  /** Hesaplanan hücreye yalnızca not eklendi: tutar elle girilmiş sayılır */
  freeze?: boolean;
}): string {
  const parts: string[] = [];
  if (o.prevValue === null || Math.abs(o.amount - o.prevValue) >= 0.005) parts.push(`tutar ${tl(o.amount, Number.isInteger(o.amount) ? 0 : 2)} oldu`);
  if ((o.note ?? null) !== (o.prevNote ?? null)) parts.push(o.note ? (o.prevNote ? "not güncellendi" : "not eklendi") : "not silindi");
  if (o.freeze) parts.push("hesaplanan tutar artık elle girilmiş sayılır");
  if (!parts.length) return "Kaydedildi";
  const text = parts.join(", ");
  return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
}
