import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { PriceSource } from "@/lib/prices/history";
import { priceChangedText } from "@/lib/prices/seen";
import { toMinor } from "@/lib/site-menu/slot";
import { UserError } from "@/server/actions/util";
import { withPassiveRelist } from "@/server/data/ingredient-usage";
import { getDb, schema as s } from "@/server/db";
import { applyPushed, pushSaleChange } from "@/server/site-menu/push";

import { recordPriceChange } from "./record";

type ProductRow = typeof s.products.$inferSelect;

/**
 * Fiyat okunduktan (ya da ekranda görüldükten) sonra başka yerde değişti; hiçbir şey yazılmadı. Eylem sayfayı yeniler
 * (refresh): liste ve kart güncel fiyatı görür.
 */
export class PriceChangedError extends UserError {}

/**
 * Tek ürünün satış fiyatını yazar: listedeki fiyat hücresi ve zam önerisi (updateProductPrice), toplu değişiklik ve geri
 * alması siteye bağlı ürünler için (src/server/prices/batch.ts). Önce site (pushSaleChange, sitenin yazma ucu, en çok
 * 8 sn), site kabul edince tek işlemde sitenin döndürdüğü değerler (applyPushed: önce menü kilidi, aynı kalemin öteki
 * boyu, site saati), fiyat geçmişi ve kasanın (ModPOS) durumu. Bağlı değilse yalnız panelde.
 * `expectFrom`: önizlemedeki (ya da hücrenin son gördüğü) fiyat; bu arada değiştiyse (başka bir yönetici, sitenin
 * çekmesi) hiçbir şey yazılmaz. Panelde yazımı da koşulludur: fiyat okumadan sonra değiştiyse ya da ürün bu arada
 * siteye bağlandıysa yazılmaz (denetim E-11). Sitenin hatası UserError'dır (nedeni `cause`'ta; devre kesici bunu okur).
 */
export async function writeSalePrice(
  user: { name: string },
  before: ProductRow,
  price: number,
  opts: { source: PriceSource; batchId?: string | null; note?: string | null; consequence: string; expectFrom?: number },
): Promise<{ price: number; site: boolean; posPending: boolean }> {
  if (opts.expectFrom !== undefined && toMinor(opts.expectFrom) !== toMinor(before.price)) throw new PriceChangedError(priceChangedText(before.price));
  const desired = { price, active: before.active, showOnMenu: before.showOnMenu };
  const push = await pushSaleChange(user, before, desired, opts.consequence);
  const now = new Date();
  const site = push.kind === "pushed" && push.price;
  return getDb().transaction(async (tx) => {
    let final = desired;
    if (push.kind === "pushed") {
      final = await applyPushed(tx, push, before, desired, now);
      // Site "Satışta" derse pasif ürün aktif olur: reçetesindeki pasif malzeme sayım listesine bu aydan girer
      const written = final;
      await withPassiveRelist(tx, [before.id], [], () => tx.update(s.products).set({ ...written, updatedAt: now }).where(eq(s.products.id, before.id)));
    } else {
      // Okumadan sonra fiyat değiştiyse (eşitleme, toplu değişiklik, başka sekme) ya da ürün siteye bağlandıysa yazılmaz
      const [hit] = await tx
        .update(s.products)
        .set({ price, updatedAt: now })
        .where(
          and(
            eq(s.products.id, before.id),
            sql`abs(${s.products.price} - ${before.price}) < 0.005`,
            before.siteMenuId ? eq(s.products.siteMenuId, before.siteMenuId) : isNull(s.products.siteMenuId),
          ),
        )
        .returning({ id: s.products.id });
      if (!hit) {
        const [cur] = await tx.select({ price: s.products.price }).from(s.products).where(eq(s.products.id, before.id));
        if (!cur) throw new UserError("Ürün bulunamadı");
        throw new PriceChangedError(priceChangedText(cur.price));
      }
    }
    const pos = await recordPriceChange(
      tx,
      { productId: before.id, before: before.price, after: final.price, source: opts.source, onSite: site, changedBy: user.name, batchId: opts.batchId, note: opts.note },
      now,
    );
    return { price: final.price, site, posPending: pos.posPending };
  });
}
