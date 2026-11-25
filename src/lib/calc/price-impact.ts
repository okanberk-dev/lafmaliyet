/**
 * Zam uyarısı: son günlerde fiyatı artan hammaddeler ve bu yüzden maliyeti artan, kâr marjı düşen ürünler.
 * Zamdan sonra maliyet oranı hedefin üstündeki ürün için önerilen fiyat, şu ikisinin küçüğüdür (5 ₺'ye yukarı):
 * - hedef fiyat: hedef maliyet oranını tutturan fiyat (Reçete Kartı'ndaki önerilen fiyat: ⌈maliyet ÷ hedef × (1 + KDV); 5⌉);
 * - zammı yansıtan fiyat: zamdan önceki maliyet oranını koruyan fiyat (fiyat × yeni maliyet ÷ eski maliyet).
 * Zamdan önce hedefte olan ürüne hedef fiyat (daha küçük artış yeter), zaten hedefin üstünde olana (hazır alınan
 * tatlı gibi) yalnız zammın payı önerilir. Saf modül; tests/price-impact.test.ts.
 *
 * Hammadde fiyatı her değiştiğinde ingredient_prices'a bir satır yazılır (elle, ilk aktarım, Paraşüt
 * faturası). Pencereden (ör. son 30 gün) önceki son satır "eski fiyat"tır; pencere içinde değişiklik yoksa
 * hammadde zamlanmış sayılmaz. Bütün geçmiş pencerenin içindeyse ilk satır (ör. ilk aktarım) başlangıçtır. Sayım
 * listesine fiyatıyla eklenen kalemin başlangıç satırı (COUNT_ITEM_PRICE_NOTE; yazılan tahmin) hiç sayılmaz: ilk gerçek
 * fiyat zam görünmesin. Yöneticinin düzelttiği başlangıç (COUNT_ITEM_PRICE_FIXED_NOTE) doğrulanmış fiyattır, taban olur.
 */

import { COUNT_ITEM_PRICE_NOTE } from "../count-item";
import { tl } from "../format";
import { ceilTo, priceProduct, type Model, type ProductStatus } from "./engine";

export interface PriceHistoryRow {
  ingredientId: number;
  packagePrice: number;
  packageSize: number;
  /** ISO */
  changedAt: string;
  changedBy: string | null;
  note: string | null;
}

export interface IngredientChange {
  ingredientId: number;
  name: string;
  unit: string;
  /** Birim maliyet (₺/gr, ₺/ml, ₺/adet) */
  before: number;
  after: number;
  /** 0,07 = %7 artış; eksi = indirim */
  pct: number;
  /** Penceredeki son değişiklik */
  changedAt: string;
  changedBy: string | null;
  note: string | null;
}

export interface ProductImpact {
  productId: number;
  name: string;
  size: string;
  key: string;
  category: string | null;
  price: number;
  costBefore: number;
  costAfter: number;
  ratioBefore: number;
  ratioAfter: number;
  marginBefore: number;
  marginAfter: number;
  profitBefore: number;
  profitAfter: number;
  statusBefore: ProductStatus;
  statusAfter: ProductStatus;
  /** Önerilen KDV dahil fiyat: hedef fiyat ile zammı yansıtan fiyatın küçüğü (5 ₺'ye yukarı yuvarlı) */
  suggestedPrice: number;
  /** Hedef maliyet oranını tutturan fiyat (Reçete Kartı'ndaki önerilen fiyat) */
  targetPrice: number;
  /** Zamdan önceki maliyet oranını koruyan fiyat */
  keepPrice: number;
  /** Önerinin dayanağı: hedef oran ya da zammın fiyata yansıması */
  basis: "target" | "keep";
  /** Zamdan sonra maliyet oranı hedefin üstünde ve fiyat önerilenin altında */
  needsPrice: boolean;
  /** Maliyet artışının kaynağı (payı büyükten küçüğe) */
  drivers: { ingredientId: number; name: string; pct: number; share: number }[];
}

export const PRICE_ALERT_DAYS = 30;
/** Hammaddede bu orandan küçük değişiklik zam sayılmaz */
export const MIN_INGREDIENT_PCT = 0.05;
/** Üründe maliyet artışı bundan küçükse listelenmez (küçük payı olan hammaddenin zammı) */
export const MIN_PRODUCT_PCT = 0.01;

const unitOf = (r: { packagePrice: number; packageSize: number }) => (r.packageSize > 0 ? r.packagePrice / r.packageSize : 0);

/**
 * Pencerede (since'den bugüne) fiyatı değişen hammaddeler; `minPct`ten küçük değişiklik yok sayılır. Su ve buz
 * (fiyatı su faturasından hesaplanır) ve pasif hammaddeler dahil değildir. Artış önce, büyükten küçüğe.
 */
export function ingredientChanges(
  ingredients: { id: number; name: string; unit: string; packagePrice: number; packageSize: number; priceSource: string; active: boolean }[],
  history: PriceHistoryRow[],
  since: string,
  minPct = MIN_INGREDIENT_PCT,
): IngredientChange[] {
  const byIng = new Map<number, PriceHistoryRow[]>();
  for (const h of [...history].sort((a, b) => a.changedAt.localeCompare(b.changedAt))) {
    if (h.note === COUNT_ITEM_PRICE_NOTE) continue; // Sayıma fiyatıyla eklenen kalemin başlangıç satırı zam tabanı değildir
    const list = byIng.get(h.ingredientId) ?? [];
    list.push(h);
    byIng.set(h.ingredientId, list);
  }
  const out: IngredientChange[] = [];
  for (const ing of ingredients) {
    if (!ing.active || ing.priceSource === "water") continue;
    const rows = byIng.get(ing.id) ?? [];
    const inWindow = rows.filter((r) => r.changedAt >= since);
    if (!inWindow.length) continue;
    const prior = rows.filter((r) => r.changedAt < since).at(-1);
    // Bütün geçmiş pencerede: ilk satır başlangıç, sonrakiler değişiklik
    const ref = prior ?? (inWindow.length > 1 ? inWindow[0] : null);
    if (!ref) continue;
    const before = unitOf(ref);
    const after = unitOf(ing);
    if (!(before > 0) || !(after > 0)) continue;
    const pct = after / before - 1;
    if (Math.abs(pct) < minPct) continue;
    const last = inWindow.at(-1)!;
    out.push({ ingredientId: ing.id, name: ing.name, unit: ing.unit, before, after, pct, changedAt: last.changedAt, changedBy: last.changedBy, note: last.note });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/**
 * Zamlanan hammaddeleri kullanan etkin ürünlerin eski/yeni ekonomisi. Eski maliyet, zamlanan hammaddelerin eski
 * birim fiyatıyla aynı reçeteden hesaplanır (diğer her şey bugünkü gibi). Maliyeti `minPct`ten az artan ürün
 * listelenmez. Fiyatı önerilenin altında kalanlar önce, maliyet oranı en çok artan önce.
 */
export function productImpacts(model: Model, changes: IngredientChange[], minPct = MIN_PRODUCT_PCT): ProductImpact[] {
  const up = new Map(changes.filter((c) => c.pct > 0).map((c) => [c.ingredientId, c]));
  if (!up.size) return [];
  const out: ProductImpact[] = [];
  for (const p of model.activeProducts) {
    if (!p.cost || !p.lines.some((l) => up.has(l.item.ingredientId))) continue;
    const beforeLines = p.lines.map((l) => ({
      qty: l.qty,
      unitCost: up.get(l.item.ingredientId)?.before ?? l.unitCost,
      vatRate: l.vatRate,
      isPackaging: l.isPackaging,
    }));
    const before = priceProduct(p.product, beforeLines, model.settings);
    if (!(before.cost > 0) || p.cost < before.cost * (1 + minPct)) continue;
    // Payı: hammaddenin satırındaki maliyet artışı (fire dahil değil; oranlar için yeterli)
    const deltas = new Map<number, number>();
    for (const l of p.lines) {
      const c = up.get(l.item.ingredientId);
      if (c) deltas.set(c.ingredientId, (deltas.get(c.ingredientId) ?? 0) + l.qty * (c.after - c.before));
    }
    const totalDelta = [...deltas.values()].reduce((a, b) => a + b, 0) || 1;
    const targetPrice = p.suggestedPrice;
    const keepPrice = ceilTo((p.price * p.cost) / before.cost, 5);
    const basis = keepPrice > 0 && keepPrice < targetPrice ? "keep" : "target";
    const suggestedPrice = basis === "keep" ? keepPrice : targetPrice;
    const overTarget = p.costRatio > model.settings.hedefMaliyet;
    out.push({
      productId: p.product.id,
      name: p.product.name,
      size: p.product.size,
      key: p.key,
      category: p.category?.name ?? null,
      price: p.price,
      costBefore: before.cost,
      costAfter: p.cost,
      ratioBefore: before.costRatio,
      ratioAfter: p.costRatio,
      marginBefore: before.margin,
      marginAfter: p.margin,
      profitBefore: before.unitProfit,
      profitAfter: p.unitProfit,
      statusBefore: before.status,
      statusAfter: p.status,
      suggestedPrice,
      targetPrice,
      keepPrice,
      basis,
      needsPrice: overTarget && p.price > 0 && p.price < suggestedPrice,
      drivers: [...deltas.entries()]
        .map(([id, d]) => ({ ingredientId: id, name: up.get(id)!.name, pct: up.get(id)!.pct, share: d / totalDelta }))
        .sort((a, b) => b.share - a.share),
    });
  }
  return out.sort((a, b) => Number(b.needsPrice) - Number(a.needsPrice) || b.ratioAfter - b.ratioBefore - (a.ratioAfter - a.ratioBefore));
}

/**
 * Uyarısı kapanan ürün: o anki maliyet; maliyet bundan da artarsa yeniden uyarılır. "Şimdilik böyle kalsın"da
 * yalnız maliyet; "zammın payı" önerisi uygulanınca `price` da (öneri o fiyattan yeniden artardı: 85 → 90 → …).
 */
export type PriceAck = Record<string, { cost: number; at: string; price?: number }>;

export function isAcknowledged(impact: Pick<ProductImpact, "productId" | "costAfter" | "price">, ack: PriceAck | null | undefined): boolean {
  const a = ack?.[String(impact.productId)];
  if (!a || impact.costAfter > a.cost * 1.005) return false;
  // Önerilen fiyatla kapandıysa fiyat onun altına inince (Geri al, elle düşürme) uyarı geri gelir
  return a.price == null || impact.price >= a.price - 0.005;
}

/** Uyarı metni için kısa özet: "Süt +%8, Espresso +%6" (en çok 3, kalanı "+N") */
export function changesSummary(changes: Pick<IngredientChange, "name" | "pct">[], max = 3): string {
  const ups = changes.filter((c) => c.pct > 0);
  const pct = (n: number) => `%${Math.round(n * 100)}`;
  const head = ups.slice(0, max).map((c) => `${c.name} +${pct(c.pct)}`);
  return ups.length > max ? `${head.join(", ")} ve ${ups.length - max} hammadde daha` : head.join(", ");
}

/**
 * Genel bakış ve zil için uyarı: fiyatı önerilenin altına düşen (ve "böyle kalsın" denmemiş) ürün varsa. Uyarı
 * metni insights.alerts ile aynı biçimde; Ürünler sayfasındaki zam bölümüne götürür. `monthlyLoss`: zamların ayda TL
 * kâr kaybı (price-loss.ts, PriceLoss.totalLoss); 1 ₺'den azsa ya da verilmezse metin eskisi gibi kalır.
 */
export function priceAlert(
  changes: IngredientChange[],
  actionable: Pick<ProductImpact, "key">[],
  monthlyLoss?: number | null,
): { level: "warning"; title: string; detail: string; href: string } | null {
  if (!actionable.length) return null;
  const names = actionable.slice(0, 3).map((p) => p.key.replace("|", " "));
  const loss = monthlyLoss != null && monthlyLoss >= 1 ? ` Bu zamlar ayda ≈ ${tl(monthlyLoss)} kâr götürüyor.` : "";
  return {
    level: "warning",
    title: `Hammadde zammı: ${actionable.length} ürünün fiyatına bakın`,
    detail: `${changesSummary(changes)}. ${names.join(", ")}${actionable.length > 3 ? "…" : ""}: maliyet oranı hedefin üstünde, önerilen fiyat hazır.${loss}`,
    href: "/panel/urunler#zamlar",
  };
}
