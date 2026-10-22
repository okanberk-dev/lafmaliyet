import "server-only";

import { eq } from "drizzle-orm";

import { money } from "@/lib/format";
import type { PriceSource } from "@/lib/prices/history";
import { toMinor } from "@/lib/site-menu/slot";
import { UserError } from "@/server/actions/util";
import { getDb, schema as s } from "@/server/db";
import { applyPushed, pushSaleChange } from "@/server/site-menu/push";

import { recordPriceChange } from "./record";

type ProductRow = typeof s.products.$inferSelect;

/**
 * Tek ürünün satış fiyatını yazar; toplu değişiklik ve geri alması siteye bağlı ürünler için bunu kullanır
 * (src/server/prices/batch.ts). Tek fiyat yazımıyla (updateProductPrice) aynı yol: önce site (pushSaleChange, sitenin
 * yazma ucu, en çok 8 sn), site kabul edince tek işlemde sitenin döndürdüğü değerler (applyPushed: önce menü kilidi,
 * aynı kalemin öteki boyu, site saati), fiyat geçmişi ve kasanın (ModPOS) durumu. Bağlı değilse yalnız panelde.
 * `expectFrom`: önizlemedeki fiyat; bu arada değiştiyse (başka bir yönetici, sitenin çekmesi) hiçbir şey yazılmaz.
 * Sitenin hatası UserError'dır (nedeni `cause`'ta; devre kesici bunu okur).
 */
export async function writeSalePrice(
  user: { name: string },
  before: ProductRow,
  price: number,
  opts: { source: PriceSource; batchId?: string | null; note?: string | null; consequence: string; expectFrom?: number },
): Promise<{ price: number; site: boolean; posPending: boolean }> {
  if (opts.expectFrom !== undefined && toMinor(opts.expectFrom) !== toMinor(before.price)) {
    throw new UserError(`Fiyat bu sırada değişti (şimdi ${money(before.price)}); listeyi yenileyip tekrar dene`);
  }
  const desired = { price, active: before.active, showOnMenu: before.showOnMenu };
  const push = await pushSaleChange(user, before, desired, opts.consequence);
  const now = new Date();
  const site = push.kind === "pushed" && push.price;
  return getDb().transaction(async (tx) => {
    let final = desired;
    if (push.kind === "pushed") {
      final = await applyPushed(tx, push, before, desired, now);
      await tx.update(s.products).set({ ...final, updatedAt: now }).where(eq(s.products.id, before.id));
    } else {
      await tx.update(s.products).set({ price, updatedAt: now }).where(eq(s.products.id, before.id));
    }
    const pos = await recordPriceChange(
      tx,
      { productId: before.id, before: before.price, after: final.price, source: opts.source, onSite: site, changedBy: user.name, batchId: opts.batchId, note: opts.note },
      now,
    );
    return { price: final.price, site, posPending: pos.posPending };
  });
}
