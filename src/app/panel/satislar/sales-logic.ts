// Satışlar ekranının saf yardımcıları (tarayıcıda ve testlerde çalışır; sunucu ya da React gerekmez).
// Açık gün sınırı, kâr marjı renk ölçeği (Excel Satış Raporu J sütunu), içe aktarma önizlemesi ve
// eşleştirme önerileri burada; sales-client.tsx yalnızca bunları gösterir.

import { daysInMonth } from "@/lib/calc/engine";
import { createPosMappingIndex, posMatchKey } from "@/lib/calc/pos-paste";
import { monthLabel, num, pct } from "@/lib/format";

// ---------------------------------------------------------------- Açık gün

/**
 * Açık gün alanının hatası: boşsa ya da ayın gün sayısını aşmıyorsa null.
 * Sunucu (saveMonthInfo, setMonthField) aynı sınırı uygular; burada kaydetmeden önce görünsün diye.
 */
export function openDaysProblem(text: string, month: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return "Tam sayı girin";
  const dim = daysInMonth(month);
  return Number(t) > dim ? `En fazla ${dim} gün (${monthLabel(month)} ${dim} gün çeker)` : null;
}

export type MonthPhase = "running" | "closed" | "future";

export function monthPhase(month: string, currentMonth: string): MonthPhase {
  return month === currentMonth ? "running" : month < currentMonth ? "closed" : "future";
}

/**
 * Açık gün alanının altındaki açıklama. Devam eden ayda bu sayı "bugüne kadar geçen gün" olarak
 * ay sonu tahmininde de kullanılır; kapanmış ayda yalnızca sabit giderleri böler.
 */
export function openDaysHint(text: string, month: string, currentMonth: string): string {
  const dim = daysInMonth(month);
  const t = text.trim();
  const n = /^\d+$/.test(t) ? Number(t) : null;
  const phase = monthPhase(month, currentMonth);
  if (n === null || n > dim) {
    return phase === "running" ? `Devam eden ay: bugüne kadar açık olunan gün (ay ${dim} gün)` : `${monthLabel(month)} ${dim} gün çeker`;
  }
  if (n === dim) return `Tüm ay açık (${dim}/${dim} gün)`;
  if (phase === "running") return `Ay sürüyor: ${n}/${dim} gün (tahmin bu sayıyla)`;
  return `${n}/${dim} gün · sabit gider oranı ${pct(n / dim)}`;
}

// ---------------------------------------------------------------- Kâr marjı renk ölçeği

/** Excel'deki PERCENTILE / YÜZDEBİRLİK (dahil, doğrusal ara değer); sıralı dizi bekler */
export function percentileInc(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export interface MarginScale {
  min: number;
  mid: number;
  max: number;
  count: number;
}

/** Ölçeğe giren satır: reçeteli bir ürüne bağlı ve cirosu olan satış (HİZMET ve tahmini maliyetliler dışarıda) */
export function inMarginScale(r: { matched: boolean; isService: boolean; net: number }): boolean {
  return r.matched && !r.isService && r.net > 0;
}

/**
 * Excel Satış Raporu J10:J134 üç renkli ölçeği: en düşük kırmızı, ortanca (50. yüzdebirlik) sarı,
 * en yüksek yeşil. Ölçek ayın satırlarından kurulur.
 */
export function marginScale(values: number[]): MarginScale | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  // Hepsi ekranda aynı oranı gösteriyorsa (%78,5 ile %78,5) ölçek yok: eşit marjlar zıt renk almasın
  if (atDisplay(sorted[sorted.length - 1]) === atDisplay(sorted[0])) return null;
  return { min: sorted[0], mid: percentileInc(sorted, 0.5), max: sorted[sorted.length - 1], count: sorted.length };
}

/**
 * Ekrandaki duyarlık (%78,5 = 0,785): renk ve etiket bu duyarlıkla karşılaştırılır. Aynı ürün ve fiyattaki
 * iki satırın marjı kayan nokta yüzünden 1e-16 farklı çıkabilir; ikisi de %78,5 görünüp biri kırmızı biri yeşil olmasın.
 */
const atDisplay = (v: number) => Math.round(v * 1000) / 1000;

/** Ölçekteki yer: en düşük 0, ortanca 0,5, en yüksek 1 (Excel'in renk geçişi gibi iki parçalı doğrusal) */
export function marginPosition(v: number, s: MarginScale): number {
  if (!Number.isFinite(v)) return 0.5;
  const x = atDisplay(v);
  const min = atDisplay(s.min);
  const mid = atDisplay(s.mid);
  const max = atDisplay(s.max);
  if (x <= min) return 0;
  if (x >= max) return 1;
  if (x <= mid) return mid > min ? ((x - min) / (mid - min)) * 0.5 : 0.5;
  return max > mid ? 0.5 + ((x - mid) / (max - mid)) * 0.5 : 0.5;
}

// Excel'in F8696B / FFEB84 / 63BE7B renklerinin panel için yumuşatılmış hâlleri (koyu yazı okunur kalsın)
const LOW = [253, 205, 205];
const MID = [254, 238, 166];
const HIGH = [196, 239, 206];

const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

/** Ölçekteki yere göre zemin rengi, ör. "rgb(253 205 205)" */
export function marginColor(v: number, s: MarginScale): string {
  const p = marginPosition(v, s);
  const c = p <= 0.5 ? mix(LOW, MID, p / 0.5) : mix(MID, HIGH, (p - 0.5) / 0.5);
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/** Renk tek başına anlam taşımasın: ölçeğin alt / üst dörtte biri sözle de söylenir */
export function marginLevelLabel(v: number, s: MarginScale): string | null {
  const p = marginPosition(v, s);
  if (atDisplay(v) === atDisplay(s.min)) return "Bu ayın en düşük marjı";
  if (atDisplay(v) === atDisplay(s.max)) return "Bu ayın en yüksek marjı";
  if (p < 0.25) return "Bu ayın düşük marjlıları arasında";
  if (p > 0.75) return "Bu ayın yüksek marjlıları arasında";
  return null;
}

// ---------------------------------------------------------------- İçe aktarma önizlemesi

export interface MappingLite {
  posName: string;
  productId: number | null;
  isService: boolean;
  updatedAt?: Date | string | number | null;
}

export interface ProductLite {
  id: number;
  name: string;
  size: string;
  active: boolean;
}

export type PreviewStatus = "matched" | "service" | "new";

/**
 * Yüklenecek satırların hafızadaki eşleşmesi. Anahtar posMatchKey: büyük/küçük harf ve I/İ farkı
 * yok sayılır ("Iced Americano Medium" = "ICED AMERICANO MEDİUM"). Sunucudaki importSales aynısını yapar.
 */
export function previewMatches<R extends { posName: string }>(rows: R[], mappings: MappingLite[], products: ProductLite[]) {
  const index = createPosMappingIndex(mappings);
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows.map((r) => {
    const m = index.get(r.posName);
    const p = m?.productId ? byId.get(m.productId) : undefined;
    const status: PreviewStatus = m?.isService ? "service" : p ? "matched" : "new";
    return { ...r, status, label: m?.isService ? "HİZMET" : p ? `${p.name} · ${p.size}` : null };
  });
}

/**
 * "Yenisiyle değiştir" kipinde yüklemeden önce sorulacak onay: ayın mevcut satırları silinir. Eklemede ya da boş
 * ayda soru yok (null). Tek dokunuşla 125 satırın gitmesin diye telefonda da masaüstünde de sorulur.
 */
export function replaceConfirm(o: { mode: "replace" | "append"; lineCount: number; newCount: number; label: string }) {
  if (o.mode !== "replace" || o.lineCount <= 0) return null;
  return {
    title: `${o.label}: ${num(o.lineCount)} satır değiştirilsin mi?`,
    description:
      `Bu aydaki ${num(o.lineCount)} satış satırı silinir, yerine okunan ${num(o.newCount)} satır yüklenir. Satırlarda elle yapılan ` +
      "düzeltmeler ve notlar da gider; eşleştirme hafızası ve ay bilgileri (POS ciro, açık gün) kalır. Eklemek için “Koru, üstüne ekle”yi seçin.",
    confirmLabel: `${num(o.lineCount)} satırı değiştir`,
  };
}

// ---------------------------------------------------------------- Eşleştirme önerisi

const SIZE_WORDS: Record<string, string> = { LARGE: "L", L: "L", MEDIUM: "M", M: "M", SMALL: "M" };

/** Karşılaştırma kelimeleri: büyük harf, I/İ ve aksan farkı yok, eş anlamlılar birleşik */
export function nameTokens(s: string): string[] {
  return posMatchKey(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t === "ICED" ? "ICE" : t === "CAFFE" || t === "CAFE" ? "" : t === "CH" ? "CHOC" : t))
    .filter(Boolean);
}

/** Yalnızca kelimeleri birebir aynı (boy hariç) ürünü önerir; benzer ama farklı ürünlerde yanlış eşleşmeyi önler. */
export function suggestProduct<P extends ProductLite>(posName: string, products: P[]): P | null {
  const toks = nameTokens(posName);
  let size: string | null = null;
  const last = toks[toks.length - 1];
  if (last && SIZE_WORDS[last]) {
    size = SIZE_WORDS[last];
    toks.pop();
  }
  if (!toks.length) return null;
  const key = [...new Set(toks)].sort().join(" ");
  const candidates = products.filter((p) => p.active && [...new Set(nameTokens(p.name))].sort().join(" ") === key);
  if (!candidates.length) return null;
  return candidates.find((p) => p.size === (size ?? "Tek")) ?? (candidates.length === 1 && !size ? candidates[0] : null);
}

/** Eşleşmemiş satırlar için tek tıkla uygulanabilecek öneriler (aynı ada tek öneri) */
export function collectSuggestions<R extends { id: number; posName: string; matched: boolean; isService: boolean }, P extends ProductLite>(
  rows: R[],
  products: P[],
): { row: R; product: P }[] {
  const seen = new Set<string>();
  const out: { row: R; product: P }[] = [];
  for (const row of rows) {
    if (row.matched || row.isService) continue;
    const key = posMatchKey(row.posName);
    if (seen.has(key)) continue;
    const product = suggestProduct(row.posName, products);
    if (!product) continue;
    seen.add(key);
    out.push({ row, product });
  }
  return out;
}
