import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { posMatchKey } from "@/lib/calc/pos-paste";
import { schema as s, type DB } from "@/server/db";

/**
 * Ürünsüz AsilPOS satırlarının sonradan bağlanması (docs/ASILPOS.md › Günlük satış; denetim E-33). Ürün gün sonu
 * yazılırken bir kez bulunur (resolvePosLine); bulunamayan satır ürünsüz saklanır. Sonradan ürün sitenin kalemine
 * bağlanınca (Ürünler › Site menüsü) ya da POS adı bir ürüne eşleştirilince (Satışlar) o satırlar burada, AsilPOS günü
 * yeniden göndermeden bağlanır. Yalnız ürünsüz ve hizmet olmayan satırlara dokunulur: bağlı satırın ürünü değişmez.
 * Çağıran işlemin içinde çalışır (eşleştirmeyle aynı işlem).
 */

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Sitenin kalemine ve boyuna bağlanan ürünler: o kalem ve boyla gelmiş ürünsüz satırlar ürüne bağlanır. Dönen: satır sayısı */
export async function rematchPosSalesBySite(tx: DB | Tx, links: readonly { productId: number; siteMenuId: string; slot: "M" | "L" }[]): Promise<number> {
  const d = s.posDailySales;
  let n = 0;
  for (const l of links) {
    const done = await tx
      .update(d)
      .set({ productId: l.productId })
      .where(and(isNull(d.productId), eq(d.isService, false), eq(d.siteMenuId, l.siteMenuId), eq(d.slot, l.slot)))
      .returning({ id: d.id });
    n += done.length;
  }
  return n;
}

/**
 * POS adı eşleştirmesi (pos_mappings): adı aynı anahtara (posMatchKey: büyük / küçük harf, I / İ ve boşluk farkı yok)
 * düşen ürünsüz satırlar eşleştirmenin ürününe ya da hizmete bağlanır. Eşleştirme kaldırılınca (ürün yok, hizmet değil)
 * hiçbir şey yapılmaz. Dönen: satır sayısı
 */
export async function rematchPosSalesByName(tx: DB | Tx, posName: string, target: { productId: number | null; isService: boolean }): Promise<number> {
  if (target.productId === null && !target.isService) return 0;
  const d = s.posDailySales;
  const key = posMatchKey(posName);
  const open = await tx.select({ id: d.id, posName: d.posName }).from(d).where(and(isNull(d.productId), eq(d.isService, false)));
  const ids = open.filter((r) => posMatchKey(r.posName) === key).map((r) => r.id);
  if (!ids.length) return 0;
  const done = await tx
    .update(d)
    .set({ productId: target.isService ? null : target.productId, isService: target.isService })
    .where(and(inArray(d.id, ids), isNull(d.productId), eq(d.isService, false)))
    .returning({ id: d.id });
  return done.length;
}
