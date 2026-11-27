// Marina ay sonu kaçak raporu (Raporlar › Kaçak raporu; docs/RAPORLAR.md): ayın son günündeki tahmini stok
// (src/lib/stock-estimate.ts; önceki sayım + Marina'ya gelen faturalı alış − AsilPOS satışının reçeteye göre tüketimi ×
// (1 + genel fire) − zayi ve ikram) ile ayın sayımı arasındaki fark, malzemenin ay sonu birim maliyetiyle TL. Saf;
// yükleyici src/server/data/kacak.ts, testi tests/kacak.test.ts.
//
// Fark = sayılan − tahmini: eksi kaçaktır (rafta olması gerekenden az), artı fazla (çoğu kez Marina'ya işaretlenmemiş
// fatura ya da sayılmayan devir). Genel fire tahminin içinde: kaçak, olağan firenin üstündeki kayıptır. Tahmini olmayan
// (sayım yok, AsilPOS öncesi) ve bu ay sayılmayan malzeme rapora girmez, sayısı yazılır; fiyatı olmayan malzemenin farkı
// miktarla yazılır, TL toplamına girmez.

import type { StockEstimate, StockEstimateLine } from "./stock-estimate";

/** Ayın sayımı (malzemenin kendi biriminde) */
export interface LeakCount {
  ingredientId: number;
  /** Kendi biriminde (sayılan × sayıldığı birimin çarpanı) */
  qty: number;
}

export interface LeakLine {
  ingredientId: number;
  name: string;
  /** Ekrandaki birim (sayım birimi) ve çarpanı */
  unit: string;
  factor: number;
  /** Tahminin başladığı sayımın ayı (önceki ay değilse dönem daha uzun) */
  countMonth: string;
  from: string;
  /** Kendi biriminde: başlangıç sayımı, alış, satış tüketimi (fire dahil), zayi ve ikram, tahmini, sayılan, fark */
  counted: number;
  purchased: number;
  sold: number;
  wasted: number;
  expected: number;
  actual: number;
  diff: number;
  /** Ay sonu birim maliyeti (TL / kendi birimi, KDV hariç); bilinmiyorsa null */
  unitCost: number | null;
  /** Fark × birim maliyet (eksi kaçak); fiyat yoksa null */
  value: number | null;
  /** Farkın tahmine oranı (|fark| ÷ tahmini); tahmini 0 ise null */
  share: number | null;
}

export interface LeakReport {
  month: string;
  lines: LeakLine[];
  /** En çok kaçan (TL'si en eksi) kalemler, en çok `top` */
  leaks: LeakLine[];
  /** En çok fazla çıkan kalemler (TL'si en artı) */
  surplus: LeakLine[];
  /** Eksi farkların TL toplamı (kaçak, eksi) ve artı farklarınki (fazla) ve net */
  leakTotal: number;
  surplusTotal: number;
  net: number;
  /** Rapora girmeyenler: bu ay sayılmayan (tahmini var), tahmini olmayan (sayım yok / AsilPOS öncesi) ve fiyatı olmayan */
  notCounted: number;
  noEstimate: number;
  unpriced: string[];
  /** Tahminin dönemi boyunca gün sonu gelmeyen günler (o günlerin satışı düşülmedi: kaçak olduğundan büyük görünür) */
  missingDays: string[];
  /** Ürüne bağlanmamış ya da reçetesi boş satış / zayi satırları (tüketimi düşülmedi) */
  skippedLines: number;
  skippedNames: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Miktar farkı yuvarlamadan doğan gürültüyü saymaz (0,000001 gr) */
const EPS = 1e-6;

/**
 * Ayın kaçak raporu. `estimate` ayın son günüyle (o ayın sayımı başlangıç sayılmadan) hesaplanmış tahmin; `counts` ayın
 * sayımı; `unitCost` malzemenin ay sonu birim maliyeti (kendi biriminde; 0 ya da bilinmiyorsa null). `extraMissing`:
 * tahminin "bugün hariç" saydığı ayın son günü de gelmediyse
 */
export function leakReport(
  month: string,
  estimate: StockEstimate,
  counts: readonly LeakCount[],
  unitCost: (ingredientId: number) => number | null,
  opts: { top?: number; extraMissing?: readonly string[] } = {},
): LeakReport {
  const top = opts.top ?? 10;
  const actualOf = new Map<number, number>();
  for (const c of counts) actualOf.set(c.ingredientId, (actualOf.get(c.ingredientId) ?? 0) + c.qty);

  const lines: LeakLine[] = [];
  let notCounted = 0;
  let noEstimate = 0;
  const unpriced: string[] = [];
  for (const l of estimate.lines as readonly StockEstimateLine[]) {
    if (l.status !== "tahmin" || l.estimate === null) {
      noEstimate++;
      continue;
    }
    const actual = actualOf.get(l.ingredientId);
    if (actual === undefined) {
      notCounted++;
      continue;
    }
    const diff = actual - l.estimate;
    const price = unitCost(l.ingredientId);
    const unit = price !== null && price > 0 ? price : null;
    if (unit === null && Math.abs(diff) > EPS) unpriced.push(l.name);
    lines.push({
      ingredientId: l.ingredientId,
      name: l.name,
      unit: l.unit,
      factor: l.factor,
      countMonth: l.countMonth as string,
      from: l.from as string,
      counted: l.counted ?? 0,
      purchased: l.purchased ?? 0,
      sold: l.sold ?? 0,
      wasted: l.wasted ?? 0,
      expected: l.estimate,
      actual,
      diff: Math.abs(diff) > EPS ? diff : 0,
      unitCost: unit,
      value: unit === null ? null : r2((Math.abs(diff) > EPS ? diff : 0) * unit),
      share: Math.abs(l.estimate) > EPS ? Math.abs(diff) / Math.abs(l.estimate) : null,
    });
  }
  const priced = lines.filter((l) => l.value !== null) as (LeakLine & { value: number })[];
  const leakTotal = r2(priced.filter((l) => l.value < 0).reduce((a, l) => a + l.value, 0));
  const surplusTotal = r2(priced.filter((l) => l.value > 0).reduce((a, l) => a + l.value, 0));
  const byName = (a: LeakLine, b: LeakLine) => a.name.localeCompare(b.name, "tr");
  return {
    month,
    lines: [...lines].sort((a, b) => (a.value ?? 0) - (b.value ?? 0) || byName(a, b)),
    leaks: priced.filter((l) => l.value < 0).sort((a, b) => a.value - b.value || byName(a, b)).slice(0, top),
    surplus: priced.filter((l) => l.value > 0).sort((a, b) => b.value - a.value || byName(a, b)).slice(0, top),
    leakTotal,
    surplusTotal,
    net: r2(leakTotal + surplusTotal),
    notCounted,
    noEstimate,
    unpriced: unpriced.sort((a, b) => a.localeCompare(b, "tr")),
    missingDays: [...new Set([...estimate.missingDays, ...(opts.extraMissing ?? [])])].sort(),
    skippedLines: estimate.unmatched.lines + estimate.noRecipe.lines,
    skippedNames: [...estimate.unmatched.top, ...estimate.noRecipe.top].slice(0, 5),
  };
}
