import { and, eq, notInArray, sql } from "drizzle-orm";

import { buildLots, type PurchaseLot } from "@/lib/calc/fifo";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

/**
 * Stok değerlemenin (FIFO) partileri: Paraşüt faturalarının hammaddeye bağlı kalemleri, fatura + hammadde başına
 * toplanmış (miktar × bağlantı çarpanı, KDV hariç net tutar). "Fiyatı güncelle" kapalı bağlantının faturası da
 * gerçek alıştır, girer. Girmeyen: kafe dışı fatura ve çarpanı şüpheli kalem. Çarpan şüphesi bağlantıyı izler, tek
 * faturayı değil (eşitleme yalnız en yeni faturayı değerlendirir, yenisi gelince eskinin önerisi geçersiz kalır):
 * bağlantının bugünkü çarpanıyla onay bekleyen bir fiyat varsa o ürünün bütün faturaları; bugünkü çarpanla
 * reddedilmiş fiyatın yalnız kendi faturası. Çarpan düzeltilince eski çarpanla açılmış öneriler bir şey dışlamaz,
 * faturalar yeni çarpanla girer. Kalemler her eşitlemede yeniden yazıldığı için partiler her okumada türetilir.
 * Faturası olmayan alım (elle / Excel girilen fatura, nakit alım, bağlanmamış ürün) havuzda görünmez: havuz yettiği
 * sürece sayılan miktar eski faturalara dağılır, yalnız havuzun karşılamadığı kalan ay sonu fiyatıyla.
 * docs/STOK-DEGERLEME.md §2
 */
export async function queryPurchaseLots(db: DB): Promise<PurchaseLot[]> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const h = s.ingredientPriceHolds;
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
    .where(
      and(
        notInArray(inv.category, SEPARATE_CATEGORIES),
        sql`not exists (select 1 from ${h} where ${h.ingredientId} = ${ln.ingredientId} and ${h.productKey} = ${bl.productKey} and ${h.factor} = ${ln.factor} and (${h.status} = 'pending' or (${h.status} = 'rejected' and ${h.invoiceId} = ${bl.invoiceId})))`,
      ),
    )
    .groupBy(ln.ingredientId, inv.id, inv.date);
  return buildLots(rows.map((r) => ({ ...r, factor: 1 })));
}
