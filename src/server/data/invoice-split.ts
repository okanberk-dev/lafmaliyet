import "server-only";

import { eq } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import { lineTarget, splitLinesFor, type SplitLine } from "@/lib/invoice-split";
import { notIngredientOf, parseIgnored, parseIgnoredSuppliers } from "@/lib/product-ignore";
import { schema as s, type DB } from "@/server/db";
import { PRODUCT_IGNORE_KEY, SUPPLIER_IGNORE_KEY } from "@/server/parasut/keys";

/**
 * Kalem kalem sınıflandırmanın veri tarafı (src/lib/invoice-split.ts; docs/PARASUT.md › 5f): Paraşüt kalemlerinin
 * hedefleri (hammaddeye bağlı → mal alışı; nedenli "hammadde değil" ürün ya da tedarikçi kuralı → nedeninin yeri;
 * gerisi faturanın kategorisi). Yalnız payı faturanın kendi payından ayrılan faturalar döner: fatura → kalemler.
 */
export async function loadSplitLines(db: DB, invoices: readonly { id: number; category: string; supplier: string }[]): Promise<Map<number, SplitLine[]>> {
  const [lines, links, state] = await Promise.all([
    db
      .select({ invoiceId: s.parasutBillLines.invoiceId, productKey: s.parasutBillLines.productKey, net: s.parasutBillLines.netTotal })
      .from(s.parasutBillLines),
    db.select({ productKey: s.parasutProductLinks.productKey }).from(s.parasutProductLinks),
    db.select({ key: s.integrationState.key, value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, PRODUCT_IGNORE_KEY)),
  ]);
  const [ruleRow] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, SUPPLIER_IGNORE_KEY));
  const linked = new Set(links.map((l) => l.productKey));
  const products = new Map(parseIgnored(state[0]?.value).map((p) => [p.productKey, p]));
  const suppliers = new Map(parseIgnoredSuppliers(ruleRow?.value).map((r) => [r.supplierKey, r]));
  const byInvoice = new Map<number, { productKey: string; net: number }[]>();
  for (const l of lines) byInvoice.set(l.invoiceId, [...(byInvoice.get(l.invoiceId) ?? []), l]);
  const out = new Map<number, SplitLine[]>();
  for (const inv of invoices) {
    const own = byInvoice.get(inv.id);
    if (!own?.length) continue;
    const supplierKey = supplierMatchKey(inv.supplier);
    const targets = own.map((l) => {
      const isLinked = linked.has(l.productKey);
      const not = isLinked ? null : notIngredientOf({ productKey: l.productKey, supplierKey }, products, suppliers);
      return { net: l.net, to: lineTarget({ linked: isLinked, reason: not?.reason ?? null }) };
    });
    const split = splitLinesFor(inv.category, targets);
    if (split) out.set(inv.id, split);
  }
  return out;
}
