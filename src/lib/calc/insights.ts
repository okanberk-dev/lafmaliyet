import { countFactor, daysInMonth, shiftMonth, type Model, type ProductCalc } from "./engine";
import type { Ingredient } from "./types";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const safeDiv = (a: number, b: number) => (b ? a / b : 0);

// ============================================================================
// Panel
// ============================================================================

export interface CategoryStat {
  categoryId: number;
  name: string;
  count: number;
  avgMargin: number;
  avgUnitProfit: number;
  avgCostRatio: number;
  soldQty: number;
  revenueNet: number;
  profit: number;
  weightedMargin: number;
}

export interface Alert {
  level: "danger" | "warning" | "info";
  title: string;
  detail: string;
  href?: string;
}

/** Ayın satış verisi yoksa kâr oranı için kullanılacak en yakın satış ayı */
export function referenceSalesMonth(model: Model, month: string): string | null {
  if (model.monthSales(month).lines.length) return month;
  const before = model.salesMonths.filter((m) => m <= month);
  if (before.length) return before[before.length - 1];
  return model.salesMonths[model.salesMonths.length - 1] ?? null;
}

export function categoryStats(model: Model, month: string | null): CategoryStat[] {
  const sold = month ? model.soldByProduct(month) : new Map<number, number>();
  return model.categories.map((c) => {
    const ps = model.products.filter((p) => p.product.categoryId === c.id && p.product.active);
    const soldQty = sum(ps.map((p) => sold.get(p.product.id) ?? 0));
    const revenueNet = sum(ps.map((p) => p.net * (sold.get(p.product.id) ?? 0)));
    const profit = sum(ps.map((p) => p.unitProfit * (sold.get(p.product.id) ?? 0)));
    return {
      categoryId: c.id,
      name: c.name,
      count: ps.length,
      avgMargin: safeDiv(sum(ps.map((p) => p.margin)), ps.length),
      avgUnitProfit: safeDiv(sum(ps.map((p) => p.unitProfit)), ps.length),
      avgCostRatio: safeDiv(sum(ps.map((p) => p.costRatio)), ps.length),
      soldQty,
      revenueNet,
      profit,
      weightedMargin: safeDiv(profit, revenueNet),
    };
  });
}

export function dashboard(model: Model, month: string) {
  const st = model.settings;
  const info = model.monthInfo.get(month);
  const sales = model.monthSales(month);
  const hasSales = sales.lines.length > 0;
  const pm = model.pnlMonth(month);
  const dim = daysInMonth(month);
  const openDays = info?.openDays ?? 0;

  const fixed = {
    personel: pm.sections.personel,
    faturalar: pm.sections.faturalar,
    kira: pm.sections.kira,
    genel: pm.sections.genel,
  };
  const fixedTotal = sum(Object.values(fixed));
  const discountsNet = (info?.discounts ?? 0) / (1 + st.kdv);

  // Excel Panel: Brüt kâr − indirim − sabit giderler (reçeteye göre teorik maliyet)
  const theoretical = hasSales
    ? {
        netSales: sales.net,
        discountsNet,
        material: sales.cost,
        commission: sales.commission,
        grossProfit: sales.grossProfit,
        fixed,
        fixedTotal,
        netProfit: sales.grossProfit - discountsNet - fixedTotal,
      }
    : null;

  // Genel Maliyet: faturaya göre gerçekleşen
  const actual = {
    revenue: pm.revenue,
    revenueNet: pm.revenueNet,
    cogs: pm.cogs,
    purchases: pm.purchases,
    personel: pm.sections.personel,
    faturalar: pm.sections.faturalar,
    kira: pm.sections.kira,
    genel: pm.sections.genel,
    komisyon: pm.sections.komisyon,
    expenses: pm.expenses,
    profit: pm.profit,
    hasRevenue: pm.revenue !== null,
  };

  const refMonth = referenceSalesMonth(model, month);
  const ref = refMonth ? model.monthSales(refMonth) : null;
  /** 1 ₺ (KDV dahil) cirodan kalan brüt kâr (Excel: EylulBrutKar / EylulCiro) */
  const grossRatio = ref ? safeDiv(ref.grossProfit, ref.revenue) : 0;
  const breakEvenDaily = grossRatio > 0 ? model.fixedStandardTotal / grossRatio / st.acikGun : null;
  const grossRevenue = hasSales ? sales.revenue : (info?.posRevenue ?? 0);
  const dailyAvg = openDays ? grossRevenue / openDays : null;
  const breakEvenProgress = breakEvenDaily && dailyAvg ? dailyAvg / breakEvenDaily : null;

  const partial = !!info && openDays > 0 && openDays < dim && (info.posRevenue ?? 0) > 0;
  const forecast = partial
    ? (() => {
        const projectedRevenue = ((info!.posRevenue as number) / openDays) * dim;
        return {
          daysElapsed: openDays,
          dim,
          projectedRevenue,
          projectedProfit: projectedRevenue * grossRatio - model.fixedStandardTotal,
          refMonth,
        };
      })()
    : null;

  const sold = sales.soldByProduct;
  const withProfit = model.activeProducts
    .map((p) => ({ p, qty: sold.get(p.product.id) ?? 0, profit: p.unitProfit * (sold.get(p.product.id) ?? 0) }))
    .filter((x) => x.qty > 0);
  const topProducts = [...withProfit].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const bestSellers = [...withProfit].sort((a, b) => b.qty - a.qty).slice(0, 5);
  const weakest = [...withProfit].sort((a, b) => a.p.margin - b.p.margin).slice(0, 5);

  const topExpenses = [
    { name: "Personel (maaş + SGK)", amount: model.personnel.total },
    ...model.activeFixed.map((f) => ({
      name: f.name,
      amount:
        f.period === "gunluk"
          ? f.amount * st.acikGun
          : f.period === "haftalik"
            ? (f.amount * 52) / 12
            : f.period === "yillik"
              ? f.amount / 12
              : f.amount,
    })),
  ]
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return {
    month,
    info,
    hasSales,
    sales,
    theoretical,
    actual,
    refMonth,
    grossRatio,
    breakEvenDaily,
    dailyAvg,
    breakEvenProgress,
    forecast,
    recipeCostRatio: hasSales ? safeDiv(sales.cost, sales.net) : null,
    invoiceCostRatio: hasSales ? safeDiv(model.goodsPurchases(month), sales.net) : null,
    bestProduct: topProducts[0] ?? null,
    topProducts,
    bestSellers,
    weakest,
    lowProfitCount: model.activeProducts.filter((p) => p.status === "Düşük kâr").length,
    attentionCount: model.activeProducts.filter((p) => p.status === "Dikkat").length,
    categories: categoryStats(model, hasSales ? month : refMonth),
    topExpenses,
    fixedStandardTotal: model.fixedStandardTotal,
  };
}

export type DashboardData = ReturnType<typeof dashboard>;

/** Yıl içindeki aylık ciro / gider / kâr (grafik) */
export function yearTrend(model: Model, year: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const pm = model.pnlMonth(month);
    return {
      month,
      revenueNet: pm.revenueNet ?? 0,
      expenses: pm.expenses,
      profit: pm.revenue === null && pm.expenses === 0 ? 0 : pm.profit,
      active: pm.revenue !== null || pm.expenses > 0,
    };
  });
}

// ============================================================================
// Uyarılar
// ============================================================================

export function alerts(model: Model, month: string): Alert[] {
  const out: Alert[] = [];
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);
  const ay = `?ay=${month}`;

  if (sales.unmatched.length) {
    out.push({
      level: "warning",
      title: `${sales.unmatched.length} POS ürününün reçetesi yok`,
      detail: `${sales.unmatched
        .slice(0, 5)
        .map((l) => l.line.posName)
        .join(", ")}${sales.unmatched.length > 5 ? "…" : ""}. Bunlara ortalama maliyet oranı uygulanıyor.`,
      href: `/panel/satislar${ay}&durum=eslesmeyen`,
    });
  }
  if (sales.lines.length && info?.posRevenue) {
    const diff = sales.revenue - (info.discounts ?? 0) - info.posRevenue;
    if (Math.abs(diff) >= 1000) {
      out.push({
        level: "warning",
        title: "Satış listesi ile POS cirosu tutmuyor",
        detail: `Fark ${Math.round(diff).toLocaleString("tr-TR")} ₺. Satış raporunu ve indirimleri kontrol edin.`,
        href: `/panel/tutarlilik${ay}`,
      });
    }
  }
  const low = model.activeProducts.filter((p) => p.status === "Düşük kâr");
  if (low.length) {
    out.push({
      level: "danger",
      title: `${low.length} ürünün kârı düşük`,
      detail: `Maliyet oranı hedefin (%${Math.round(model.settings.hedefMaliyet * 100)}) 10 puandan fazla üstünde. Önerilen fiyatlara bakın.`,
      href: "/panel/urunler?durum=Düşük kâr",
    });
  }
  const noRecipe = model.activeProducts.filter((p) => p.status === "Reçete yok");
  if (noRecipe.length) {
    out.push({
      level: "warning",
      title: `${noRecipe.length} ürünün reçetesi boş`,
      detail: noRecipe.map((p) => p.key).slice(0, 5).join(", "),
      href: "/panel/urunler?durum=Reçete yok",
    });
  }
  const zeroQty = model.activeProducts.flatMap((p) =>
    p.lines.filter((l) => l.qty === 0 || l.qtyError).map((l) => ({ p, l })),
  );
  if (zeroQty.length) {
    out.push({
      level: "info",
      title: `${zeroQty.length} reçete satırında miktar eksik`,
      detail: zeroQty
        .slice(0, 4)
        .map(({ p, l }) => `${p.key}: ${l.ingredient?.name}`)
        .join(", "),
      href: `/panel/urunler/${zeroQty[0].p.product.id}`,
    });
  }
  const estimates = model.ds.ingredients.filter((i) => i.active && i.isEstimate);
  if (estimates.length) {
    out.push({
      level: "info",
      title: `${estimates.length} hammaddenin fiyatı tahmini`,
      detail: "Faturada bulunamayan fiyatlar. Gerçek fiyatı girince bütün ürün maliyetleri güncellenir.",
      href: "/panel/hammaddeler?durum=tahmini",
    });
  }
  const unused = model.ds.ingredients.filter((i) => i.active && !model.usedIn.has(i.id));
  if (unused.length) {
    out.push({
      level: "info",
      title: `${unused.length} hammadde hiçbir reçetede yok`,
      detail: `${unused.map((i) => i.name).slice(0, 4).join(", ")}. Hangi üründe kullanılıyorsa reçeteye ekleyin.`,
      href: "/panel/hammaddeler?durum=kullanilmayan",
    });
  }
  const waterUsed = model.ds.ingredients.some((i) => i.priceSource === "water" && model.usedIn.has(i.id));
  if (waterUsed && model.water.perLiter === 0) {
    out.push({
      level: "info",
      title: "Su ve buz maliyeti 0 ₺",
      detail: "Gelir-Gider tablosunda SU GİDERİ girilmediği için su ve buz maliyetsiz sayılıyor.",
      href: "/panel/gelir-gider",
    });
  }
  const prev = shiftMonth(month, -1);
  if (model.monthInfo.has(prev) && !model.stockSheet(prev).hasData) {
    out.push({
      level: "info",
      title: "Geçen ayın stok sayımı yok",
      detail: "Sayım olmadan devreden mal 0 kabul edilir ve alınan malın tamamı maliyet sayılır.",
      href: `/panel/sayim?ay=${prev}`,
    });
  }
  const unpaid = model.ds.invoices.filter((i) => i.unpaid);
  if (unpaid.length) {
    out.push({
      level: "warning",
      title: `${unpaid.length} fatura ödenmemiş görünüyor`,
      detail: unpaid
        .slice(0, 3)
        .map((i) => `${i.supplier} ${Math.round(i.payable).toLocaleString("tr-TR")} ₺`)
        .join(", "),
      href: "/panel/faturalar?durum=odenmedi",
    });
  }
  return out;
}

// ============================================================================
// Tutarlılık Kontrolü
// ============================================================================

export interface ConsistencyRow {
  ingredient: Ingredient;
  unitCost: number;
  usage: number;
  purchased: number | null;
  ratio: number | null;
  diffAmount: number | null;
  opening: number | null;
  closing: number | null;
  actualUsage: number | null;
  variance: number | null;
  varianceAmount: number | null;
  note: string | null;
}

export function consistency(model: Model, month: string) {
  const st = model.settings;
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);
  const listTotal = sales.revenue;
  const discounts = info?.discounts ?? 0;
  const computed = listTotal - discounts;
  const pos = info?.posRevenue ?? null;
  const diff = pos === null || !sales.lines.length ? null : computed - pos;
  const offRevenue = info?.offRevenue ?? 0;

  const usage = model.ingredientUsage(month);
  const purchases = new Map(
    model.ds.purchaseQuantities.filter((p) => p.month === month).map((p) => [p.ingredientId, p]),
  );
  const prevCounts = new Map(
    model.ds.stockCounts.filter((c) => c.month === shiftMonth(month, -1)).map((c) => [c.ingredientId, c.qty]),
  );
  const counts = new Map(model.ds.stockCounts.filter((c) => c.month === month).map((c) => [c.ingredientId, c.qty]));

  const ids = new Set<number>([...usage.keys(), ...purchases.keys()]);
  const rows: ConsistencyRow[] = [];
  for (const id of ids) {
    const ingredient = model.ingById.get(id);
    if (!ingredient) continue;
    if (ingredient.priceSource === "water" && !purchases.has(id)) continue;
    const unitCost = model.unitCost.get(id) ?? 0;
    const u = usage.get(id) ?? 0;
    const p = purchases.get(id);
    const purchased = p ? p.qty : null;
    const f = countFactor(ingredient.countUnit);
    const opening = prevCounts.has(id) ? prevCounts.get(id)! * f : null;
    const closing = counts.has(id) ? counts.get(id)! * f : null;
    const actualUsage = opening !== null && closing !== null ? opening + (purchased ?? 0) - closing : null;
    const variance = actualUsage !== null ? actualUsage - u : null;
    rows.push({
      ingredient,
      unitCost,
      usage: u,
      purchased,
      ratio: purchased !== null && u ? purchased / u : null,
      diffAmount: purchased !== null ? (purchased - u) * unitCost : null,
      opening,
      closing,
      actualUsage,
      variance,
      varianceAmount: variance !== null ? variance * unitCost : null,
      note: p?.note ?? null,
    });
  }
  rows.sort((a, b) => {
    if ((a.purchased === null) !== (b.purchased === null)) return a.purchased === null ? 1 : -1;
    return Math.abs(b.diffAmount ?? b.usage * b.unitCost) - Math.abs(a.diffAmount ?? a.usage * a.unitCost);
  });

  return {
    month,
    sales: {
      listTotal,
      discounts,
      computed,
      pos,
      diff,
      ok: diff !== null && Math.abs(diff) < 1000,
      offRevenue,
      offRevenueCost: (offRevenue / (1 + st.kdv)) * sales.avgCostRatio,
      hasLines: sales.lines.length > 0,
    },
    rows,
    totalDiff: sum(rows.map((r) => r.diffAmount ?? 0)),
    totalVariance: sum(rows.map((r) => r.varianceAmount ?? 0)),
    hasStockComparison: rows.some((r) => r.actualUsage !== null),
  };
}

// ============================================================================
// Menü mühendisliği (Kasavana & Smith) ve senaryo simülatörü
// ============================================================================

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export const MENU_CLASS_INFO: Record<MenuClass, { label: string; advice: string; tone: string }> = {
  star: { label: "Yıldız", advice: "Çok satıyor, çok kazandırıyor. Kalitesini ve yerini koruyun.", tone: "green" },
  plowhorse: { label: "Beygir", advice: "Çok satıyor ama az kazandırıyor. Küçük zam ya da maliyet düşürme deneyin.", tone: "amber" },
  puzzle: { label: "Bilmece", advice: "Kazandırıyor ama az satıyor. Öne çıkarın, tanıtın, öneri olarak sunun.", tone: "blue" },
  dog: { label: "Zayıf", advice: "Az satıyor, az kazandırıyor. Menüden çıkarmayı ya da yenilemeyi düşünün.", tone: "red" },
};

export interface MenuEngItem {
  p: ProductCalc;
  qty: number;
  mix: number;
  cm: number;
  totalCm: number;
  cls: MenuClass;
}

export function menuEngineering(model: Model, month: string, categoryId?: number) {
  const sold = model.soldByProduct(month);
  const items = model.activeProducts.filter((p) => categoryId === undefined || p.product.categoryId === categoryId);
  const totalQty = sum(items.map((p) => sold.get(p.product.id) ?? 0));
  const n = items.length;
  const popThreshold = n ? (1 / n) * 0.7 : 0;
  const avgCm = safeDiv(sum(items.map((p) => p.unitProfit * (sold.get(p.product.id) ?? 0))), totalQty);
  const result: MenuEngItem[] = items.map((p) => {
    const qty = sold.get(p.product.id) ?? 0;
    const mix = safeDiv(qty, totalQty);
    const highPop = mix >= popThreshold;
    const highCm = p.unitProfit >= avgCm;
    const cls: MenuClass = highPop ? (highCm ? "star" : "plowhorse") : highCm ? "puzzle" : "dog";
    return { p, qty, mix, cm: p.unitProfit, totalCm: p.unitProfit * qty, cls };
  });
  return { items: result, totalQty, popThreshold, avgCm };
}

export interface ScenarioInput {
  priceChangePct: number;
  costChangePct: number;
  volumeChangePct: number;
  extraFixed: number;
}

export interface ScenarioBase {
  revenue: number;
  net: number;
  discountsNet: number;
  material: number;
  commission: number;
  fixed: number;
}

/** Senaryonun çıkış noktası: seçilen ayın satış karması + aylık sabit giderler */
export function scenarioBase(model: Model, month: string): ScenarioBase {
  const st = model.settings;
  const sales = model.monthSales(month);
  const info = model.monthInfo.get(month);
  return {
    revenue: sales.revenue,
    net: sales.net,
    discountsNet: (info?.discounts ?? 0) / (1 + st.kdv),
    material: sales.cost,
    commission: sales.commission,
    fixed: model.fixedStandardTotal,
  };
}

/** Saf hesap: tarayıcıda canlı çalışır */
export function applyScenario(base: ScenarioBase, input: ScenarioInput, acikGun: number) {
  const p = 1 + input.priceChangePct;
  const v = 1 + input.volumeChangePct;
  const c = 1 + input.costChangePct;
  const sc: ScenarioBase = {
    revenue: base.revenue * p * v,
    net: base.net * p * v,
    discountsNet: base.discountsNet * p * v,
    material: base.material * c * v,
    commission: base.commission * p * v,
    fixed: base.fixed + input.extraFixed,
  };
  const finish = (x: ScenarioBase) => {
    const gross = x.net - x.material - x.commission;
    const profit = gross - x.discountsNet - x.fixed;
    const grossRatio = safeDiv(gross, x.revenue);
    return {
      ...x,
      gross,
      profit,
      grossRatio,
      breakEvenDaily: grossRatio > 0 ? x.fixed / grossRatio / acikGun : null,
      materialRatio: safeDiv(x.material, x.net),
    };
  };
  return { base: finish(base), scenario: finish(sc) };
}

export function scenario(model: Model, month: string, input: ScenarioInput) {
  return applyScenario(scenarioBase(model, month), input, model.settings.acikGun);
}

/** Hedef aylık kâr için gereken günlük ciro (KDV dahil) */
export function requiredDailyRevenue(model: Model, month: string, targetProfit: number): number | null {
  const ref = referenceSalesMonth(model, month);
  if (!ref) return null;
  const s = model.monthSales(ref);
  const ratio = safeDiv(s.grossProfit, s.revenue);
  if (ratio <= 0) return null;
  return (model.fixedStandardTotal + targetProfit) / ratio / model.settings.acikGun;
}
