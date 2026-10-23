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
  /**
   * ModPOS adetlerinin ölçeği: standardDays ÷ listenin açık günü (liste kasa raporlarından kısa bir dönemi kapsıyorsa o
   * dönemin açık günü, yoksa ayın); açık gün yoksa 1 (adetler olduğu gibi)
   */
  scale: number;
  /** Online adetlerin ölçeği: standardDays ÷ ayın açık günü (online satış ayın bugüne kadarını kapsar) */
  onlineScale: number;
  /** Süren ayda yapıştırılan liste kasa raporlarından kısaysa listenin dönemi ve açık günü (engine listPeriod) */
  listPeriod: { from: string; through: string; openDays: number } | null;
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
  // Online: eşlenen kafe satırları ve Extra Shot gibi seçenek ürünleri
  const online = model.onlineSold(month);
  if (!sales.lines.length && !online.size) return null;
  const info = model.monthInfo.get(month);
  const openDays = info?.openDays && info.openDays > 0 ? info.openDays : null;
  const standardDays = model.settings.acikGun;
  const onlineScale = openDays && standardDays > 0 ? standardDays / openDays : 1;
  // Süren ayda yapıştırılan liste kasa raporlarından kısa bir dönemi kapsıyorsa ModPOS adetleri o dönemin açık günüyle
  const lp = sales.lines.length ? model.listPeriod(month) : null;
  const listDays = lp ? lp.openDays : openDays;
  const scale = listDays && standardDays > 0 ? standardDays / listDays : 1;
  const perMonth = new Map<number, number>();
  let posQty = 0;
  for (const [id, qty] of model.soldByProduct(month)) {
    perMonth.set(id, (perMonth.get(id) ?? 0) + qty * scale);
    posQty += qty;
  }
  let onlineQty = 0;
  for (const [id, qty] of online) {
    perMonth.set(id, (perMonth.get(id) ?? 0) + qty * onlineScale);
    onlineQty += qty;
  }
  return {
    basis: {
      month,
      openDays,
      standardDays,
      scale,
      onlineScale,
      listPeriod: lp ? { from: lp.from, through: lp.through, openDays: lp.openDays } : null,
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
  if (b.listPeriod) {
    const lp = b.listPeriod;
    return `${m} satışlarına göre: satış listesi ${Number(lp.from.slice(8, 10))}–${Number(lp.through.slice(8, 10))} ${monthLabel(b.month).split(" ")[0]} (${num(lp.openDays)} açık gün; ayın açık günü ${num(b.openDays)}${from ? `, ${from}` : ""}), ayda ${num(b.standardDays)} açık güne çevrildi.`;
  }
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
  /** Referans ayın teorik brüt kârı (ModPOS + online) × ölçek ("brüt kârın %X'i" için); dayanak yoksa null */
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
    // ModPOS ve online brüt kârı, adetlerle aynı ölçekle (online: laffogato.net, reçeteye göre)
    grossProfit: sb && month ? model.monthSales(month).grossProfit * sb.basis.scale + (model.onlineMonth(month)?.grossProfit ?? 0) * sb.basis.onlineScale : null,
  };
}
