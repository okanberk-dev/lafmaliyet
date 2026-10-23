/*
 * Claude bağlantısının yanıtlarının ortak kuralları (saf; tests/claude-araclar.test.ts). Her yanıt paneldeki aynı
 * hesap fonksiyonlarından gelir ve şunları taşır: `hesap` (gerçek rakamlarla hesap satırları), `kaynak` (verinin
 * dayanağı), gerekirse `uyarilar` ve ilgili ekranın bağlantısı `panelAdresi`. Tutarlar TL, 2 ondalık; yüzdeler
 * "...Yuzde" alanlarında yüzde olarak (34,2 = %34,2). Dışarıdan gelen her ad cleanName'den geçer.
 */

import type { Model } from "../../calc/engine";
import { referenceSalesMonth } from "../../calc/insights";
import { isUnpriced } from "../../count-item";
import { money as moneyNb, monthLabel, num, pct as pctNb, tl as tlNb } from "../../format";
import { cleanName } from "../oauth";

export { cleanName };

/** Kullanıcıya olduğu gibi söylenecek girdi sorunu (ör. tarih aralığı çok uzun); araç isError ile döner */
export class ToolInputError extends Error {}

/** Tutar: 2 ondalık */
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const r2n = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : r2(v));
/** Oran (0,342) → yüzde sayısı (34,2), 1 ondalık */
export const pctNum = (ratio: number | null | undefined): number | null =>
  ratio === null || ratio === undefined || !Number.isFinite(ratio) ? null : Math.round(ratio * 1000) / 10;

// Panelin biçimleri (format.ts) bölünmez boşluk kullanır; JSON'da düz boşluk okunaklı
const sp = (s: string) => s.replace(/\u00a0/g, " ");
export const tl = (v: number | null | undefined, digits = 0) => sp(tlNb(v, digits));
export const money = (v: number | null | undefined) => sp(moneyNb(v));
export const pct = (v: number | null | undefined, digits = 1) => sp(pctNb(v, digits));
export { monthLabel, num };

/**
 * Ad araması için katlanmış yazı: Türkçe küçük harf, ı → i, aksanlar yok. Menüde İngilizce adlar da var ("Ice Latte"):
 * Türkçe küçük harfte "I" "ı" olur, Claude "ice latte" yazınca da bulunsun diye ı ile i aynı sayılır.
 */
export const foldName = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
/** `text` aranan metni içeriyor mu (foldName ile) */
export const nameMatches = (text: string, q: string) => !q.trim() || foldName(text).includes(foldName(q));

/** Panel ekranının mutlak adresi */
export const panelUrl = (base: string, path: string) => `${base}${path}`;

/** Ürün satış adetlerinin tek erişim yolu (ModPOS günlük döküm gelince tarih aralığı buraya eklenir; R18) */
export interface SalesBasisFor {
  month: string;
  /** Adetlerin alındığı ay; hiç satış listesi yoksa null */
  salesMonth: string | null;
  qtyByProduct: Map<number, number>;
  /** Ayın kendi listesi yoksa hangi ayın kullanıldığı */
  note: string | null;
}

export function salesFor(model: Model, month: string): SalesBasisFor {
  const salesMonth = referenceSalesMonth(model, month);
  const note =
    salesMonth === null
      ? "Hiçbir ay için ürün satış listesi yok: adetler 0 sayıldı."
      : salesMonth !== month
        ? `${monthLabel(month)} için ürün satış listesi yok; ${monthLabel(salesMonth)} adetleri kullanıldı.`
        : null;
  return { month, salesMonth, qtyByProduct: salesMonth ? model.soldByProduct(salesMonth) : new Map(), note };
}

/**
 * Etkin ürünlerin reçetelerinde geçen, fiyatı girilmemiş hammaddeler (ekle'nin kuralı: isUnpriced). Bunlar varken
 * maliyetler eksik: yanıt bunu `uyarilar`'da söyler.
 */
export function unpricedInRecipes(model: Model): string[] {
  const names = new Map<number, string>();
  for (const p of model.activeProducts) {
    for (const l of p.lines) if (l.ingredient && isUnpriced(l.ingredient)) names.set(l.ingredient.id, l.ingredient.name);
  }
  return [...names.values()].map((n) => cleanName(n));
}

/** "{n} hammaddenin fiyatı girilmemiş; maliyet eksik" ve adları (en çok 5) */
export function unpricedWarnings(names: string[]): string[] {
  if (!names.length) return [];
  const shown = names.slice(0, 5).join(", ");
  return [`${num(names.length)} hammaddenin fiyatı girilmemiş; maliyet eksik`, `Fiyatı girilmemiş: ${shown}${names.length > 5 ? ` ve ${num(names.length - 5)} hammadde daha` : ""}.`];
}

// ---------------------------------------------------------------- Tarih aralığı

const toUTC = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** İki gün arasındaki gün sayısı (dahil) */
export const spanDays = (from: string, to: string) => Math.round((toUTC(to) - toUTC(from)) / 86_400_000) + 1;

/** Aralık kuralı: bitiş başlangıçtan önce olamaz, en çok `maxDays` gün, bugünden sonrası olamaz (verilirse) */
export function checkRange(from: string, to: string, opts: { maxDays: number; today?: string }) {
  if (to < from) throw new ToolInputError("Bitiş tarihi başlangıçtan önce olamaz");
  if (spanDays(from, to) > opts.maxDays) throw new ToolInputError(`Tarih aralığı en çok ${opts.maxDays} gün olabilir`);
  if (opts.today && to > opts.today) throw new ToolInputError("Bitiş tarihi bugünden sonra olamaz");
}

// ---------------------------------------------------------------- Çıktının boyu

export const OUTPUT_MAX = 60_000;
export const CUT_NOTE = "Liste kısaltıldı; daha dar bir dönem ya da daha küçük limit isteyin.";

/** Nesnedeki en uzun dizi (iç içe dahil) */
function longestArray(v: unknown, best: unknown[] | null = null): unknown[] | null {
  if (Array.isArray(v)) {
    let b = !best || v.length > best.length ? v : best;
    for (const x of v) b = longestArray(x, b) ?? b;
    return b;
  }
  if (v && typeof v === "object") {
    let b = best;
    for (const x of Object.values(v)) b = longestArray(x, b) ?? b;
    return b;
  }
  return best;
}

/**
 * Yanıtın JSON metni, en çok `max` karakter: uzunsa en uzun liste tekrar tekrar yarıya iner ve `kesildi` yazılır
 * (Claude'un araç yanıtı sınırı ~150.000 karakter; yanıt hem metin hem yapılı içerik olarak iki kez gider).
 */
export function fitOutput(obj: Record<string, unknown>, max = OUTPUT_MAX): string {
  let text = JSON.stringify(obj);
  if (text.length <= max) return text;
  const copy = JSON.parse(text) as Record<string, unknown>;
  copy.kesildi = CUT_NOTE;
  for (let guard = 0; guard < 64; guard++) {
    text = JSON.stringify(copy);
    if (text.length <= max) return text;
    const arr = longestArray(copy);
    if (!arr || arr.length <= 1) break;
    arr.length = Math.floor(arr.length / 2);
  }
  // Son çare: listesiz özet (hiçbir zaman sınırı aşmaz)
  return JSON.stringify({ kesildi: CUT_NOTE, panelAdresi: obj.panelAdresi ?? null });
}
