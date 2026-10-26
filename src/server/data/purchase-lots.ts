import "server-only";

import { and, eq, notInArray, sql } from "drizzle-orm";

import { buildLots, type PurchaseLot } from "@/lib/calc/fifo";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { getDb, schema as s } from "@/server/db";

/**
 * Stok değerlemenin (FIFO) partileri: Paraşüt faturalarının hammaddeye bağlı kalemleri, fatura + hammadde başına
 * toplanmış (miktar × bağlantı çarpanı, KDV hariç net tutar). Fiyat kaynağıyla aynı süzgeç (sync.ts): "Fiyatı güncelle"
 * kapalı bağlantı, onay bekleyen ya da reddedilen fiyat (yanlış çarpan olabilir) ve kafe dışı fatura girmez. Kalemler
 * her eşitlemede yeniden yazıldığı için partiler her okumada türetilir; elle / Excel fatura, nakit alım ve
 * bağlanmamış ürünün partisi yoktur (o kısım ay sonu fiyatıyla). docs/STOK-DEGERLEME.md
 */
export async function loadPurchaseLots(): Promise<PurchaseLot[]> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const h = s.ingredientPriceHolds;
  const rows = await getDb()
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
    .where(
      and(
        eq(ln.updatePrice, true),
        notInArray(inv.category, SEPARATE_CATEGORIES),
        sql`not exists (select 1 from ${h} where ${h.invoiceId} = ${bl.invoiceId} and ${h.ingredientId} = ${ln.ingredientId} and ${h.productKey} = ${bl.productKey} and ${h.status} in ('pending', 'rejected'))`,
      ),
    )
    .groupBy(ln.ingredientId, inv.id, inv.date);
  return buildLots(rows.map((r) => ({ ...r, factor: 1 })));
}
