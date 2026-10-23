import "server-only";

import { and, count, eq, notInArray } from "drizzle-orm";

import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { bulkUnit, supplierPriceRows, type PriceLine, type SupplierPricesResponse } from "@/lib/supplier-prices";
import { getDb, schema as s } from "@/server/db";

import { loadSupplierLedger } from "./suppliers";

/**
 * Hammaddenin tedarikçilere göre fiyatı (hammadde penceresi açılınca, GET /api/hammaddeler/{id}/fiyatlar): bağlı
 * bütün Paraşüt ürünlerinin kalemleri ("Fiyatı güncelle" kapalı olanlar da; onay bekleyen fiyatın faturası da gerçek
 * bir alımdır), kafe dışı faturalar hariç (applyProductLinks'in kapsamı). Tedarikçi Tedarikçiler ekranındaki gruptan
 * gelir (loadSupplierLedger: ad, diğer adlar ve vergi no); burada ad eşleştirmesi yapılmaz. Hammadde yoksa null.
 */
export async function loadSupplierPrices(ingredientId: number, today: string): Promise<SupplierPricesResponse | null> {
  const db = getDb();
  const [[ing], [{ n: links }], lines, ledger] = await Promise.all([
    db
      .select({
        id: s.ingredients.id,
        name: s.ingredients.name,
        unit: s.ingredients.unit,
        packagePrice: s.ingredients.packagePrice,
        packageSize: s.ingredients.packageSize,
        priceSource: s.ingredients.priceSource,
      })
      .from(s.ingredients)
      .where(eq(s.ingredients.id, ingredientId))
      .limit(1),
    db.select({ n: count() }).from(s.parasutProductLinks).where(eq(s.parasutProductLinks.ingredientId, ingredientId)),
    db
      .select({
        invoiceId: s.invoices.id,
        date: s.invoices.date,
        invoiceNo: s.invoices.invoiceNo,
        productName: s.parasutBillLines.productName,
        quantity: s.parasutBillLines.quantity,
        unit: s.parasutBillLines.unit,
        netTotal: s.parasutBillLines.netTotal,
        factor: s.parasutProductLinks.factor,
      })
      .from(s.parasutBillLines)
      .innerJoin(s.parasutProductLinks, eq(s.parasutProductLinks.productKey, s.parasutBillLines.productKey))
      .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
      .where(and(eq(s.parasutProductLinks.ingredientId, ingredientId), notInArray(s.invoices.category, SEPARATE_CATEGORIES))),
    loadSupplierLedger(),
  ]);
  if (!ing) return null;
  // Faturanın tedarikçisi: Tedarikçiler ekranındaki grubu (kartın adı, adres parçası)
  const supplierOf = new Map<number, { key: string; name: string; slug: string }>();
  for (const g of ledger.groups) for (const inv of g.invoices) supplierOf.set(inv.id, { key: g.key, name: g.name, slug: g.slug });
  const priced: PriceLine[] = lines.flatMap((l) => {
    const sup = supplierOf.get(l.invoiceId);
    return sup ? [{ ...l, supplierKey: sup.key, supplierName: sup.name, supplierSlug: sup.slug }] : [];
  });
  const b = bulkUnit(ing.unit);
  return {
    ingredient: {
      id: ing.id,
      name: ing.name,
      unit: ing.unit,
      per: b.per,
      scale: b.scale,
      current: ing.priceSource === "water" || !(ing.packageSize > 0) ? null : ing.packagePrice / ing.packageSize,
    },
    links,
    ...supplierPriceRows(priced, { today }),
  };
}
