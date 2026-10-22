/**
 * Zam etkisi: son zamların ayda kaç lira kâr götürdüğü (docs/planlar/insight.md §1). Ürünün birim maliyet artışı
 * (reçetedeki miktar × birim fiyat farkı × (1 + fire), KDV hariç) × ayda satılan adet; hammaddenin etkisi onu kullanan
 * ürünlerdeki aynı tutarların toplamı. Saf modül, sunucu bağımlılığı yok; tests/zam-etkisi.test.ts.
 *
 * "Ayda satılan adet" tek yerden gelir (salesBasis): referans satış ayının ürüne eşlenen ModPOS adedi + online kafe
 * adedi, standart aya ölçekli (Ayarlar › ayda açık gün ÷ o ayın açık günü). Menü, haftalık özet ve sipariş önerisi de
 * "ayda …" için bunu kullanır; başka bir ölçek yazılmaz.
 */

import { monthLabel, num } from "../format";
import type { Model } from "./engine";
import type { IngredientChange } from "./price-impact";

export interface SalesBasis {
  /** Referans satış ayı (YYYY-MM) */
  month: string;
  /** Ay bilgisindeki açık gün; girilmemişse null */
  openDays: number | null;
  /** Ayarlar › ayda açık gün (standart ay) */
  standardDays: number;
  /** standardDays ÷ openDays; açık gün yoksa 1 (adetler olduğu gibi) */
  scale: number;
  /** Ürüne eşlenen ModPOS adedi (ölçeksiz) */
  posQty: number;
  /** Ürüne eşlenen online kafe adedi, laffogato.net (ölçeksiz) */
  onlineQty: number;
  /** Ürüne eşleşmeyen POS satırlarının adedi (hesaba girmez) */
  unmatchedQty: number;
  /**
   * Açık gün kasa raporlarından türediyse (kasa grubu: Month.sources, Month.kasa.till.missing) eksik rapor günüyle;
   * ay bilgisi bu alanları taşımıyorsa ya da gün elle girildiyse null
   */
  openDaysFrom: { source: "kasa"; missing: number } | null;
}

/**
 * Ay bilgisinin isteğe bağlı kaynak alanları (kasa grubu ekler; yoksa null). Alanlar tip olarak bilinmeden okunur:
 * bu dosya kasa birleşmeden de derlenir ve aynı davranır.
 */
function openDaysSource(info: unknown): SalesBasis["openDaysFrom"] {
  const x = info as { sources?: { openDays?: unknown } | null; kasa?: { till?: { missing?: unknown } | null } | null } | undefined;
  if (x?.sources?.openDays !== "kasa") return null;
  const missing = x.kasa?.till?.missing;
  return { source: "kasa", missing: Array.isArray(missing) ? missing.length : 0 };
}

/**
 * Ayın satış dayanağı ve ürün başına ayda satılan adet (standart aya ölçekli, POS + online). Ayda ne POS satırı ne de
 * ürüne eşlenmiş online satır varsa null.
 */
export function salesBasis(model: Model, month: string): { basis: SalesBasis; perMonth: Map<number, number> } | null {
  const sales = model.monthSales(month);
  const online = model.siteLines(month).mapped;
  if (!sales.lines.length && !online.length) return null;
  const info = model.monthInfo.get(month);
  const openDays = info?.openDays && info.openDays > 0 ? info.openDays : null;
  const standardDays = model.settings.acikGun;
  const scale = openDays && standardDays > 0 ? standardDays / openDays : 1;
  const raw = new Map<number, number>();
  let posQty = 0;
  for (const [id, qty] of model.soldByProduct(month)) {
    raw.set(id, (raw.get(id) ?? 0) + qty);
    posQty += qty;
  }
  let onlineQty = 0;
  for (const { line, product } of online) {
    raw.set(product.id, (raw.get(product.id) ?? 0) + line.qty);
    onlineQty += line.qty;
  }
  const perMonth = new Map([...raw].map(([id, qty]) => [id, qty * scale]));
  return {
    basis: {
      month,
      openDays,
      standardDays,
      scale,
      posQty,
      onlineQty,
      unmatchedQty: sales.unmatched.reduce((a, l) => a + l.line.qty, 0),
      openDaysFrom: openDaysSource(info),
    },
    perMonth,
  };
}

/**
 * Dayanak cümlesi: "Eylül 2026 satışlarına göre (ayda 30 açık gün)." Süren ayda: "Ekim 2026 satışlarına göre: 16 açık
 * gün, ayda 30 açık güne çevrildi." Açık gün kasa raporlarından geliyorsa kaynağı ve eksik günü yazar.
 */
export function basisText(b: SalesBasis): string {
  const m = monthLabel(b.month);
  const from = b.openDaysFrom ? `kasa raporlarından${b.openDaysFrom.missing ? `, ${num(b.openDaysFrom.missing)} gün eksik` : ""}` : null;
  if (!b.openDays) return `${m} satışlarına göre (ayın açık günü girilmedi; adetler olduğu gibi).`;
  if (b.scale === 1) return `${m} satışlarına göre (ayda ${num(b.standardDays)} açık gün${from ? `; açık gün ${from}` : ""}).`;
  return `${m} satışlarına göre: ${num(b.openDays)} açık gün${from ? ` (${from})` : ""}, ayda ${num(b.standardDays)} açık güne çevrildi.`;
}

export interface IngredientLoss {
  ingredientId: number;
  name: string;
  unit: string;
  /** Birim maliyet (₺/gr, ₺/ml, ₺/adet) */
  before: number;
  after: number;
  pct: number;
  changedAt: string;
  /** Ayda kullanım, hammaddenin kendi biriminde (fire dahil, ölçekli) */
  monthlyUsage: number;
  /** TL/ay; artışta > 0 (kayıp), indirimde < 0 (kazanç) */
  monthly: number;
  /** Bu hammaddeyi kullanan, referans ayda satılmış ürün sayısı */
  productCount: number;
}

export interface ProductLoss {
  productId: number;
  name: string;
  size: string;
  key: string;
  category: string | null;
  price: number;
  /** Ayda satılan adet (ölçekli) */
  monthlyQty: number;
  /** Yalnız artan hammaddelerden birim maliyet artışı, fire dahil (= productImpacts'in costAfter − costBefore) */
  unitDelta: number;
  /** unitDelta × monthlyQty */
  monthly: number;
  profitBefore: number;
  profitAfter: number;
  /** Bugünkü maliyet oranı hedefin üstünde ve fiyat önerilenin altında */
  overTarget: boolean;
  drivers: { ingredientId: number; name: string; pct: number; monthly: number }[];
}

export interface PriceLoss {
  basis: SalesBasis | null;
  /** Artanlar aylık kayba göre (büyükten küçüğe), sonra ucuzlayanlar (kazancı büyük önce) */
  ingredients: IngredientLoss[];
  /** Birim maliyeti artan ürünler, aylık kayba göre büyükten küçüğe */
  products: ProductLoss[];
  /** Σ products.monthly (= artan hammaddelerin aylık toplamı) */
  totalLoss: number;
  /** Ucuzlayan hammaddelerin aylık kazancı (artı) */
  totalGain: number;
  /** Referans ayın teorik brüt kârı × ölçek ("brüt kârın %X'i" için); dayanak yoksa null */
  grossProfit: number | null;
}

/**
 * Zamların ayda TL etkisi. `month` referans satış ayıdır (Ürünler, ürün kartı, Genel bakış, zil ve e-postada
 * latestSalesMonth); null ya da satışsızsa dayanak yoktur: bütün aylık tutarlar 0, birim maliyet artışı yine hesaplanır.
 * Pasif ve reçetesiz ürün, zayi / ikram tüketimi ve ürüne eşleşmeyen POS satırı dahil değildir.
 */
export function priceLoss(model: Model, changes: IngredientChange[], month: string | null): PriceLoss {
  const sb = month ? salesBasis(model, month) : null;
  const perMonth = sb?.perMonth ?? new Map<number, number>();
  const st = model.settings;
  const byIng = new Map(changes.map((c) => [c.ingredientId, c]));
  const acc = new Map<number, { monthly: number; usage: number; products: Set<number> }>();
  const products: ProductLoss[] = [];
  for (const p of model.activeProducts) {
    if (!p.cost) continue;
    const qty = perMonth.get(p.product.id) ?? 0;
    let unitDelta = 0;
    const drivers = new Map<number, number>();
    for (const l of p.lines) {
      const c = byIng.get(l.item.ingredientId);
      if (!c) continue;
      // Ürün maliyetindeki fire payı (priceProduct): ambalaj hariç tutuluyorsa ambalaj satırında çarpan 1
      const mult = 1 + (st.fireExcludesPackaging && l.isPackaging ? 0 : p.fireRate);
      const d = l.qty * (c.after - c.before) * mult;
      const a = acc.get(c.ingredientId) ?? { monthly: 0, usage: 0, products: new Set<number>() };
      a.monthly += d * qty;
      a.usage += l.qty * mult * qty;
      if (qty > 0) a.products.add(p.product.id);
      acc.set(c.ingredientId, a);
      // Kayıp yalnız artanlardan; ucuzlayan hammadde ayrı bir kazanç olarak toplanır
      if (c.pct > 0) {
        unitDelta += d;
        drivers.set(c.ingredientId, (drivers.get(c.ingredientId) ?? 0) + d);
      }
    }
    if (!(unitDelta > 0)) continue;
    products.push({
      productId: p.product.id,
      name: p.product.name,
      size: p.product.size,
      key: p.key,
      category: p.category?.name ?? null,
      price: p.price,
      monthlyQty: qty,
      unitDelta,
      monthly: unitDelta * qty,
      profitBefore: p.unitProfit + unitDelta,
      profitAfter: p.unitProfit,
      overTarget: p.costRatio > st.hedefMaliyet && p.price < p.suggestedPrice,
      drivers: [...drivers]
        .map(([id, d]) => ({ ingredientId: id, name: byIng.get(id)!.name, pct: byIng.get(id)!.pct, monthly: d * qty }))
        .sort((a, b) => b.monthly - a.monthly || b.pct - a.pct),
    });
  }
  // Eşitlikte bugünkü sıra (ürün sırası) korunur: sort kararlıdır
  products.sort((a, b) => b.monthly - a.monthly || b.unitDelta - a.unitDelta);
  const ingredients: IngredientLoss[] = changes.map((c) => {
    const a = acc.get(c.ingredientId);
    return {
      ingredientId: c.ingredientId,
      name: c.name,
      unit: c.unit,
      before: c.before,
      after: c.after,
      pct: c.pct,
      changedAt: c.changedAt,
      monthlyUsage: a?.usage ?? 0,
      monthly: a?.monthly ?? 0,
      productCount: a?.products.size ?? 0,
    };
  });
  const ups = ingredients.filter((i) => i.pct > 0).sort((a, b) => b.monthly - a.monthly || b.pct - a.pct);
  const downs = ingredients.filter((i) => i.pct <= 0).sort((a, b) => a.monthly - b.monthly || a.pct - b.pct);
  return {
    basis: sb?.basis ?? null,
    ingredients: [...ups, ...downs],
    products,
    totalLoss: products.reduce((s, p) => s + p.monthly, 0),
    totalGain: downs.reduce((s, i) => s - i.monthly, 0),
    grossProfit: sb && month ? model.monthSales(month).grossProfit * sb.basis.scale : null,
  };
}
