// Başlangıç verisi (veri.json) -> hesaplama motorunun Dataset'i.
//
// veri.json panelin ilk kurulumunda eski hesap tablosundan bir kez aktarıldı (Ekim 2026); kaynağı depoda yok, yeniden
// üretilmez. Uygulama bu dosyayı kullanmaz: yerel ve test veritabanını dolduran tohum betiği (scripts/seed.ts,
// `npm run db:seed`) ile hesap motorunun altın testleri (tests/golden.json'a karşı) kullanır. Değerleri DEĞİŞTİRMEYİN:
// testlerin beklenen rakamları bu değerlerden gelir. Dosya kişisel veri taşır (maaşlar, kira, faturalar, satışlar):
// depo bu yüzden gizli kalır (docs/DEPLOY.md § 1). Canlıda boş veritabanına kendiliğinden yüklenmez (§ 5).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_SETTINGS } from "../../../src/lib/constants";
import { productKey } from "../../../src/lib/calc/engine";
import type {
  CountUnit,
  Dataset,
  FixedPeriod,
  FixedSection,
  PriceSource,
  Size,
  Unit,
} from "../../../src/lib/calc/types";

/** Verinin dosyası, depo kökünden */
export const SEED_DATA_FILE = "tests/fixtures/baslangic/veri.json";

/** Başlangıç verisini okur (`root`: depo kökü) */
export function readSeedData(root = process.cwd()): SeedData {
  return JSON.parse(readFileSync(join(root, SEED_DATA_FILE), "utf8")) as SeedData;
}

export interface SeedData {
  meta: { source: string; extractedAt: string; preparedNote: string };
  settings: Record<string, number>;
  productCategories: string[];
  ingredients: {
    name: string;
    category: string;
    supplier: string | null;
    packageDesc: string | null;
    packagePrice: number;
    packageSize: number;
    unit: string;
    vatRate: number;
    note: string | null;
    isEstimate: boolean;
    priceSource: string;
    countUnit: string | null;
    countGroup: string | null;
    countOrder: number | null;
    sortOrder: number;
  }[];
  products: {
    category: string;
    name: string;
    size: string;
    key: string;
    note: string | null;
    sortOrder: number;
    price: number;
    fireOverride: number | null;
    items: { ingredient: string; qty: number; qtyExpr: string | null; note: string | null }[];
  }[];
  months: {
    month: string;
    openDays: number;
    posRevenue: number;
    discounts: number;
    offRevenue: number;
    note: string | null;
  }[];
  salesLines: {
    month: string;
    posName: string;
    qty: number;
    revenue: number;
    productKey: string | null;
    isService: boolean;
    note: string | null;
  }[];
  invoices: {
    date: string;
    supplier: string;
    description: string | null;
    invoiceNo: string | null;
    category: string;
    amount: number;
    discount: number;
    payable: number;
    unpaid: boolean;
    note: string | null;
  }[];
  staff: { name: string; netSalary: number; extras: number }[];
  fixedExpenses: {
    name: string;
    section: string;
    period: string;
    amount: number;
    note: string | null;
    sortOrder: number;
  }[];
  investments: { name: string; amount: number; note: string | null }[];
  purchaseQuantities: { month: string; ingredient: string; qty: number; note: string | null }[];
  findings: { section: string; title: string; detail: string; resolved: boolean }[];
}

/**
 * Eski tabloda ödeme durumu açıklamaya yazılmıştı ("Kaldi (Gider listesi, ödenmedi)"). Durum ayrı alanda (unpaid)
 * tutulduğu için açıklamadan atılır; yoksa fatura ödenince "ödenmedi" yazısı yeşil "Ödendi" rozetiyle çelişir.
 */
export function cleanInvoiceDescription(d: string | null): string | null {
  if (!d) return d;
  const out = d.replace(/,\s*öden(?:me)?di\s*$/iu, "").trim();
  return out || null;
}

/**
 * Tek seferlik yatırımların dönemi. Eski tablo yalnızca XND için tarih veriyordu (Temmuz 2026); diğerleri fatura tarihlerinden:
 * Aria 07.07.2026, reklam (Beyza Karaman) 17.09.2026. Tabela/baskı Temmuz–Eylül arasındaki üç faturanın toplamı,
 * klişe bedelinin faturası yok: dönem boş bırakılır.
 */
export function investmentSeed(x: { name: string; amount: number; note: string | null }): { name: string; amount: number; date: string | null; note: string | null } {
  if (x.name.startsWith("Dekorasyon & ekipman") || x.name.includes("(Aria)")) return { ...x, date: "2026-07" };
  if (x.name.startsWith("Reklam (Beyza Karaman)")) return { ...x, date: "2026-09" };
  if (x.name.startsWith("Tabela, baskı")) {
    return { ...x, date: null, note: x.note === "~15.300 ₺ + KDV" ? "~15.300 ₺ + KDV · Temmuz–Eylül 2026 faturaları (Murat Şeimen, Tuzla Baskı)" : x.note };
  }
  return { ...x, date: null };
}

/** Başlangıç verisinden hesap motorunun Dataset'i (kimlikler sırayla 1'den; tohum betiği de aynı kimliklerle yazar) */
export function datasetFromSeed(data: SeedData): Dataset {
  const ingredients = data.ingredients.map((i, idx) => ({
    id: idx + 1,
    name: i.name,
    category: i.category,
    supplier: i.supplier,
    packageDesc: i.packageDesc,
    packagePrice: i.packagePrice,
    packageSize: i.packageSize,
    unit: i.unit as Unit,
    vatRate: i.vatRate,
    note: i.note,
    isEstimate: i.isEstimate,
    priceSource: i.priceSource as PriceSource,
    countUnit: i.countUnit as CountUnit | null,
    countGroup: i.countGroup,
    // Sayım listesi sırası Hammaddeler sırasından farklı; sayım sırasını öne al
    sortOrder: i.countOrder ?? 1000 + i.sortOrder,
    active: true,
  }));
  const ingId = new Map(ingredients.map((i) => [i.name, i.id]));
  const need = (name: string) => {
    const id = ingId.get(name);
    if (!id) throw new Error(`Hammadde bulunamadı: ${name}`);
    return id;
  };

  const categories = data.productCategories.map((name, idx) => ({ id: idx + 1, name, sortOrder: idx + 1 }));
  const catId = new Map(categories.map((c) => [c.name, c.id]));

  const products = data.products.map((p, idx) => ({
    id: idx + 1,
    categoryId: catId.get(p.category)!,
    name: p.name,
    size: p.size as Size,
    price: p.price,
    fireOverride: p.fireOverride,
    note: p.note,
    active: true,
    showOnMenu: true,
    sortOrder: p.sortOrder,
  }));
  const productId = new Map(products.map((p) => [productKey(p), p.id]));

  let itemId = 0;
  const recipeItems = data.products.flatMap((p, pIdx) =>
    p.items.map((it, i) => ({
      id: ++itemId,
      productId: pIdx + 1,
      ingredientId: need(it.ingredient),
      qty: it.qty,
      qtyExpr: it.qtyExpr,
      note: it.note,
      sortOrder: i + 1,
    })),
  );

  const salesLines = data.salesLines.map((l, idx) => {
    const pid = l.productKey ? productId.get(l.productKey) : undefined;
    if (l.productKey && !pid) throw new Error(`Ürün anahtarı bulunamadı: ${l.productKey}`);
    return {
      id: idx + 1,
      month: l.month,
      posName: l.posName,
      qty: l.qty,
      revenue: l.revenue,
      productId: pid ?? null,
      isService: l.isService,
      note: l.note,
    };
  });

  return {
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    ingredients,
    categories,
    products,
    recipeItems,
    months: data.months.map((m) => ({ ...m })),
    salesLines,
    invoices: data.invoices.map((inv, idx) => ({ id: idx + 1, ...inv, description: cleanInvoiceDescription(inv.description) })),
    // Eski tablodaki personel ve sabit giderler bütün aylarda geçerli (başlangıç / bitiş ayı yok, tutar değişikliği yok)
    staff: data.staff.map((s, idx) => ({ id: idx + 1, ...s, active: true, startMonth: null, endMonth: null })),
    staffVersions: [],
    fixedExpenses: data.fixedExpenses.map((f, idx) => ({
      id: idx + 1,
      name: f.name,
      section: f.section as FixedSection,
      period: f.period as FixedPeriod,
      amount: f.amount,
      note: f.note,
      active: true,
      startMonth: null,
      endMonth: null,
      sortOrder: f.sortOrder,
    })),
    fixedExpenseVersions: [],
    pnlEntries: [],
    stockCounts: [],
    stockExtras: [],
    purchaseQuantities: data.purchaseQuantities.map((p) => ({
      month: p.month,
      ingredientId: need(p.ingredient),
      qty: p.qty,
      note: p.note,
    })),
  };
}
