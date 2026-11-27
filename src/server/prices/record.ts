import "server-only";

import { and, eq } from "drizzle-orm";

import { tillPriceManual } from "@/lib/asilpos/kasa";
import type { PriceChange } from "@/lib/prices/history";
import { posAfterPriceChange } from "@/lib/prices/pos";
import { toMinor } from "@/lib/site-menu/slot";
import { asilposSwitchDaysOf } from "@/server/data/asilpos-ikram";
import { branchTill } from "@/server/data/till-scope";
import { getDb, schema as s } from "@/server/db";

/**
 * Satış fiyatı geçmişi ve kasanın (ModPOS) durumu (docs/FIYATLAR.md). Satış fiyatını yazan her yol bunu fiyatla aynı
 * işlemde çağırır: updateProductPrice, saveRecipe, yeni ürün (insertProduct), toplu değişiklik ve geri alması
 * (src/server/prices/*) ve sitenin yazdıkları (applyPlan: çekme, bağlama, aynı kalemin öteki boyu). Kaynağı unutulan
 * bir yol olmasın diye tests/fiyatlar.test.ts dosyaları tek tek arar.
 */

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Geçmişe satır düşer, kasanın durumu güncellenir. Kuruşu aynı fiyat yazılmaz. Ürün satırı kilitlenir (aynı ürüne iki
 * yazım ya da yazımla işaret kasa durumunu birbirinin üstüne yazmasın); ürün bu arada silindiyse hiçbir şey yazılmaz.
 * `pos: false`: kasa listesine dokunulmaz (yeni ürün kasaya zaten elle girilir, sahibin kararı D3).
 *
 * Kasanın durumu şube başınadır (pos_stale; şube kapsamı A3): her etkin fiziksel şubenin satırı aynı kuralla
 * (posAfterPriceChange) açılır, güncellenir ya da fiyat o kasadaki fiyata döndüyse silinir. Şubeler birbirinden
 * bağımsız ilerler: Tuzla'da işaretlenen fiyat Marina'nın satırını değiştirmez. Durum geçiş gününden bağımsız yazılır
 * (src/lib/asilpos/switch.ts: ayar değişince yalnız okuyanlar değişir): AsilPOS gününde siteye bağlı ürünün satırı da
 * güncellenir ama okuyucular onu göstermez (till-scope.ts tillProductFilter; AsilPOS fiyatı siteden alır, denetim E-39).
 * Dönen `posPending`: bu değişiklikten sonra bir şubenin bugünkü kasasında elle değiştirilecek fiyat kaldı mı (bildirim
 * "Kasaya işle" der); AsilPOS gününde siteye bağlı üründe ve fiyat değişmediyse o şube sayılmaz.
 */
export async function recordPriceChange(tx: Tx, c: PriceChange, at: Date, opts: { pos?: boolean } = {}): Promise<{ posPending: boolean }> {
  if (c.before !== null && toMinor(c.before) === toMinor(c.after)) return { posPending: false };
  const [row] = await tx.select({ siteMenuId: s.products.siteMenuId }).from(s.products).where(eq(s.products.id, c.productId)).for("update");
  if (!row) return { posPending: false };
  let posPending = false;
  if (opts.pos !== false && c.before !== null) {
    // Sırayla (aynı işlemin bağlantısı)
    const tills = await tx
      .select({ id: s.branches.id })
      .from(s.branches)
      .where(and(eq(s.branches.kind, "fiziksel"), eq(s.branches.active, true)));
    const current = await tx
      .select({ branchId: s.posStale.branchId, stalePrice: s.posStale.stalePrice, since: s.posStale.staleSince })
      .from(s.posStale)
      .where(eq(s.posStale.productId, c.productId));
    const switchDays = await asilposSwitchDaysOf(tx);
    for (const till of tills) {
      const cur = current.find((x) => x.branchId === till.id) ?? null;
      const next = posAfterPriceChange({ stalePrice: cur?.stalePrice ?? null, since: cur?.since ?? null }, c.before, c.after, at);
      const where = and(eq(s.posStale.branchId, till.id), eq(s.posStale.productId, c.productId));
      if (next.stalePrice === null) {
        if (cur) await tx.delete(s.posStale).where(where);
      } else if (!cur) {
        await tx.insert(s.posStale).values({ branchId: till.id, productId: c.productId, stalePrice: next.stalePrice, staleSince: next.since ?? at });
      } else if (next.stalePrice !== cur.stalePrice || next.since?.getTime() !== cur.since.getTime()) {
        await tx
          .update(s.posStale)
          .set({ stalePrice: next.stalePrice, staleSince: next.since ?? at })
          .where(where);
      }
      // Geçiş günü yalnız siteye bağlı üründe okunur (bağlı olmayanın fiyatı kasada her zaman elle değişir)
      if (next.stalePrice !== null && (row.siteMenuId === null || tillPriceManual(branchTill(switchDays, till.id, at, []), true))) posPending = true;
    }
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
