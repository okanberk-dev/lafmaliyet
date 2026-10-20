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

// ---------------------------------------------------------------- Telefon: tek hücre düzenleme sayfası

/** Düzenlenen hücrenin türü: gelir-gider hücresi (not alabilir), ayın cirosu ya da açık gün sayısı (ay bilgisi) */
export type CellField = "pnl" | "revenue" | "openDays";

export interface CellEditInput {
  field: CellField;
  kind: NoteSaveKind;
  overridden: boolean;
  /** Hücrede gösterilen değer */
  value: number | null;
  computed: number | null;
  prevNote: string | null;
  amountText: string;
  /** Not alanı (yalnızca "pnl"; diğerlerinde yok sayılır) */
  noteText: string;
  validate?: (v: number | null) => string | null;
}

export type CellEditPlan =
  | { action: "error"; message: string }
  | { action: "none" }
  | { action: "clear"; message: string }
  | { action: "save"; amount: number; note: string | null | undefined; freeze: boolean; message: string };

const same = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 0.005;

/**
 * Telefondaki hücre sayfasında "Kaydet"in ne yapacağı (tablodaki hücre ve not penceresiyle aynı kurallar):
 * - "error": sayı okunamadı ya da sınır aşıldı (sayfa açık kalır, yazılan korunur)
 * - "none": değişiklik yok (2 ondalığa yuvarlanmış değer yeniden yazılmaz)
 * - "clear": tutar boş → hücre hesaplanana döner / boşalır; not da silinir
 * - "save": tutar (ve değiştiyse not) yazılır. `note: undefined` var olan notu korur. Hesaplanan bir hücreye yalnızca
 *   not eklenirse tutar elle girilmiş sayılır (`freeze`).
 */
export function planCellEdit(o: CellEditInput): CellEditPlan {
  const t = o.amountText.trim();
  const amount = t === "" ? null : parseNumberTR(t);
  if (t !== "" && amount === null) return { action: "error", message: "Geçerli bir sayı girin, ör. 1.250,50" };
  const problem = o.validate?.(amount) ?? null;
  if (problem) return { action: "error", message: problem };

  if (o.field !== "pnl") {
    const what = o.field === "revenue" ? "Aylık ciro" : "Açık gün";
    if (amount === null) return o.value === null ? { action: "none" } : { action: "clear", message: `${what} boşaltıldı` };
    if (same(amount, o.value)) return { action: "none" };
    const shown = o.field === "revenue" ? tl(amount, Number.isInteger(amount) ? 0 : 2) : `${amount} gün`;
    return { action: "save", amount, note: undefined, freeze: false, message: `${what} ${shown} oldu` };
  }

  const note = cleanNote(o.noteText);
  const noteChanged = note !== (o.prevNote ?? null);
  /** Hücrenin kayıtlı bir girişi var mı (elle tutar ya da not) */
  const stored = o.overridden || (o.kind === "manual" && o.value !== null) || o.prevNote !== null;

  if (amount === null) {
    if (!stored) return note ? { action: "error", message: "Not, bir tutarla birlikte saklanır. Tutar yazın." } : { action: "none" };
    const base = o.kind === "auto" ? "Hücre hesaplanan değere döndü" : "Hücre boşaltıldı";
    return { action: "clear", message: o.prevNote ? `${base}; not silindi` : base };
  }
  if (same(amount, o.value) && !noteChanged) return { action: "none" };
  const freeze = noteSaveEffect({ kind: o.kind, overridden: o.overridden, amount, computed: o.computed }) === "freeze" && noteChanged;
  return {
    action: "save",
    amount,
    note: noteChanged ? note : undefined,
    freeze,
    message: noteSaveMessage({ prevValue: o.value, amount, prevNote: o.prevNote, note: noteChanged ? note : (o.prevNote ?? null), freeze }),
  };
}

/**
 * "Temizle"nin bildirimindeki "Geri al": temizlemeden önce kayıtlı olan tutar (ve not) aynen geri yazılır. Hesaplanan
 * hücrede bu, önceki elle girilmiş tutarı yeniden üzerine yazmaktır. Kayıtlı bir giriş yoksa (temizlenecek bir şey
 * yoktu) null.
 */
export function planCellRestore(
  before: Pick<CellEditInput, "field" | "kind" | "overridden" | "value" | "prevNote">,
): Extract<CellEditPlan, { action: "save" }> | null {
  if (before.value === null) return null;
  if (before.field !== "pnl") {
    const what = before.field === "revenue" ? "Aylık ciro" : "Açık gün";
    return { action: "save", amount: before.value, note: undefined, freeze: false, message: `${what} geri alındı` };
  }
  const stored = before.overridden || before.kind === "manual" || before.prevNote !== null;
  if (!stored) return null;
  return { action: "save", amount: before.value, note: before.prevNote ?? undefined, freeze: false, message: "Hücre geri alındı" };
}

/** Telefondaki ay seçiminin varsayılanı: adresteki ay, yoksa bu ay, yoksa verisi olan son ay, yoksa yılın ilk ayı */
export function defaultMonth(months: string[], fromUrl: string, currentMonth: string, latestMonth?: string): string {
  if (months.includes(fromUrl)) return fromUrl;
  if (months.includes(currentMonth)) return currentMonth;
  if (latestMonth && months.includes(latestMonth)) return latestMonth;
  return months[0];
}

/** Bir önceki / sonraki ay (yıl sınırını geçer): "2026-01", -1 → "2025-12" */
export function shiftMonth(month: string, step: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = y * 12 + (m - 1) + step;
  return `${Math.floor(d / 12)}-${String((d % 12) + 1).padStart(2, "0")}`;
}

/**
 * Bölümün toplam satırı (telefonda bölüm başlığının sağında gösterilir, listede tekrarlanmaz): bölümü kapatan kalın
 * "total:" satırı. Kâr / zarar ve oran bölümlerinde yok (onların kalın satırı bir toplam değil, sonuç).
 */
export function sectionTotalKey(rows: { def: { key: string; strong?: boolean } }[]): string | null {
  const last = rows[rows.length - 1];
  return last && last.def.strong && last.def.key.startsWith("total:") ? last.def.key : null;
}
