import "server-only";

import { eq } from "drizzle-orm";

import { tillPriceManual } from "@/lib/lafpos/kasa";
import type { PriceChange } from "@/lib/prices/history";
import { posAfterPriceChange } from "@/lib/prices/pos";
import { toMinor } from "@/lib/site-menu/slot";
import { loadTillScope } from "@/server/data/till-scope";
import { getDb, schema as s } from "@/server/db";

/**
 * Satış fiyatı geçmişi ve kasanın (ModPOS) durumu (docs/FIYATLAR.md). Satış fiyatını yazan her yol bunu fiyatla aynı
 * işlemde çağırır: updateProductPrice, saveRecipe, yeni ürün (insertProduct), toplu değişiklik ve geri alması
 * (src/server/prices/*) ve sitenin yazdıkları (applyPlan: çekme, bağlama, aynı kalemin öteki boyu). Kaynağı unutulan
 * bir yol olmasın diye tests/fiyatlar.test.ts dosyaları tek tek arar.
 */

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Geçmişe satır düşer, kasanın durumu güncellenir. Kuruşu aynı fiyat yazılmaz. Satır kilitlenir (aynı ürüne iki yazım
 * kasa durumunu birbirinin üstüne yazmasın); ürün bu arada silindiyse hiçbir şey yazılmaz. `pos: false`: kasa listesine
 * dokunulmaz (yeni ürün kasaya zaten elle girilir, sahibin kararı D3). Kasanın durumu geçiş gününden bağımsız yazılır
 * (src/lib/lafpos/switch.ts: ayar değişince yalnız okuyanlar değişir): LafPOS gününde siteye bağlı ürünün işareti de
 * güncellenir ama okuyucular onu göstermez (till-scope.ts tillProductFilter; LafPOS fiyatı siteden alır, denetim E-39),
 * geçiş günü kaldırılır ya da ileri alınırsa ModPOS'ta değişecek fiyat olarak eksiksiz geri gelir. Dönen `posPending`:
 * bu değişiklikten sonra bugünün kasasında elle değiştirilecek fiyat kaldı mı (bildirim "Kasaya işle" der); LafPOS
 * gününde siteye bağlı üründe ve fiyat değişmediyse false (söylenecek bir şey yok).
 */
export async function recordPriceChange(tx: Tx, c: PriceChange, at: Date, opts: { pos?: boolean } = {}): Promise<{ posPending: boolean }> {
  if (c.before !== null && toMinor(c.before) === toMinor(c.after)) return { posPending: false };
  const [row] = await tx
    .select({ stalePrice: s.products.posStalePrice, since: s.products.posStaleSince, siteMenuId: s.products.siteMenuId })
    .from(s.products)
    .where(eq(s.products.id, c.productId))
    .for("update");
  if (!row) return { posPending: false };
  let posPending = false;
  if (opts.pos !== false && c.before !== null) {
    const next = posAfterPriceChange({ stalePrice: row.stalePrice, since: row.since }, c.before, c.after, at);
    if (next.stalePrice !== row.stalePrice || next.since?.getTime() !== row.since?.getTime()) {
      await tx.update(s.products).set({ posStalePrice: next.stalePrice, posStaleSince: next.since }).where(eq(s.products.id, c.productId));
    }
    // Geçiş günü yalnız siteye bağlı üründe okunur (bağlı olmayanın fiyatı kasada her zaman elle değişir)
    posPending = next.stalePrice !== null && (row.siteMenuId === null || tillPriceManual(await loadTillScope(tx, at), true));
  }
  await tx.insert(s.productPrices).values({
    productId: c.productId,
    priceBefore: c.before,
    price: c.after,
    source: c.source,
    onSite: c.onSite ?? false,
    batchId: c.batchId ?? null,
    note: c.note ?? null,
    changedBy: c.changedBy,
    changedAt: at,
  });
  return { posPending };
}
