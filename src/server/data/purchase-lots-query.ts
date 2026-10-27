import { and, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

import { buildLots, type PurchaseLot } from "@/lib/calc/fifo";
import type { HeldPurchase } from "@/lib/calc/types";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

/** Alt sorgunun takma adları: dış sorgu da parasut_product_links'i birleştirir (queryPurchaseLots), adlar karışmasın */
const HOLD_ALIAS = "suspect_hold";
const LINK_ALIAS = "suspect_link";
const hh = alias(s.ingredientPriceHolds, HOLD_ALIAS);
const hl = alias(s.parasutProductLinks, LINK_ALIAS);

/**
 * Çarpanı şüpheli fatura kalemi (ortak yüklem): kalemin ürününün bağlantısı bugünkü çarpanıyla onay bekleyen bir fiyat
 * taşıyorsa ürünün bütün kalemleri, bugünkü çarpanla reddedilmiş fiyatın yalnız kendi faturasının kalemi. Çarpan şüphesi
 * bağlantıyı izler, tek faturayı değil (eşitleme yalnız en yeni faturayı değerlendirir, yenisi gelince eskinin önerisi
 * geçersiz kalır). Çarpan düzeltilince eski çarpanla açılmış öneriler bir şey dışlamaz. Stok değerlemenin partileri
 * (queryPurchaseLots), eşitlemenin yazdığı alınan miktar (applyProductLinks) ve Tutarlılık'ın "onay bekliyor" işareti
 * (queryHeldPurchases) aynı yüklemi kullanır: biri sayıp öteki saymazsa stok değeri ile Tutarlılık'ın "alınan"ı ayrışır
 * (denetim 26 Eki, E-27).
 */
export function suspectFactorLine(line: { productKey: AnyPgColumn; invoiceId: AnyPgColumn }): SQL<boolean> {
  const from = sql`${s.ingredientPriceHolds} ${sql.identifier(HOLD_ALIAS)} join ${s.parasutProductLinks} ${sql.identifier(LINK_ALIAS)}`;
  return sql<boolean>`exists (select 1 from ${from} on ${hl.productKey} = ${hh.productKey} where ${hh.productKey} = ${line.productKey} and ${hh.ingredientId} = ${hl.ingredientId} and ${hh.factor} = ${hl.factor} and (${hh.status} = 'pending' or (${hh.status} = 'rejected' and ${hh.invoiceId} = ${line.invoiceId})))`;
}

/**
 * Stok değerlemenin (FIFO) partileri: Paraşüt faturalarının hammaddeye bağlı kalemleri, fatura + hammadde başına
 * toplanmış (miktar × bağlantı çarpanı, KDV hariç net tutar). "Fiyatı güncelle" kapalı bağlantının faturası da
 * gerçek alıştır, girer. Girmeyen: kafe dışı fatura ve çarpanı şüpheli kalem (suspectFactorLine). Kalemler her
 * eşitlemede yeniden yazıldığı için partiler her okumada türetilir. Faturası olmayan alım (elle / Excel girilen fatura,
 * nakit alım, bağlanmamış ürün) havuzda görünmez: havuz yettiği sürece sayılan miktar eski faturalara dağılır, yalnız
 * havuzun karşılamadığı kalan ay sonu fiyatıyla. docs/STOK-DEGERLEME.md §2
 */
export async function queryPurchaseLots(db: DB): Promise<PurchaseLot[]> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const rows = await db
    .select({
      ingredientId: ln.ingredientId,
      invoiceId: inv.id,
      date: inv.date,
      quantity: sql<number>`sum(${bl.quantity} * ${ln.factor})`.mapWith(Number),
      netTotal: sql<number>`sum(${bl.netTotal})`.mapWith(Number),
    })
    .from(bl)
    .innerJoin(inv, eq(inv.id, bl.invoiceId))
    .innerJoin(ln, eq(ln.productKey, bl.productKey))
    .where(and(notInArray(inv.category, SEPARATE_CATEGORIES), sql`not ${suspectFactorLine(bl)}`))
    .groupBy(ln.ingredientId, inv.id, inv.date);
  return buildLots(rows.map((r) => ({ ...r, factor: 1 })));
}

/**
 * Çarpanı şüpheli olduğu için alınan miktara ve partilere girmeyen alışlar, ay ve hammadde başına fatura sayısı
 * (Tutarlılık: "Fiyat onayı bekliyor"; sapma onaylanana kadar hesaplanmaz). Kafe dışı faturalar sayılmaz.
 */
export async function queryHeldPurchases(db: DB): Promise<HeldPurchase[]> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const month = sql<string>`substr(${inv.date}, 1, 7)`;
  const rows = await db
    .select({ month, ingredientId: ln.ingredientId, invoices: sql<number>`count(distinct ${inv.id})`.mapWith(Number) })
    .from(bl)
    .innerJoin(inv, eq(inv.id, bl.invoiceId))
    .innerJoin(ln, eq(ln.productKey, bl.productKey))
    .where(and(notInArray(inv.category, SEPARATE_CATEGORIES), suspectFactorLine(bl)))
    .groupBy(month, ln.ingredientId);
  return rows.map((r) => ({ month: r.month, ingredientId: r.ingredientId, invoices: r.invoices }));
}
