import "server-only";

import { eq } from "drizzle-orm";

import { correctedCountItemStart, correctsCountItemStart } from "@/lib/count-item";
import { getDb, schema as s } from "@/server/db";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Hammaddeler'de değişen fiyatı (kayıt penceresi ya da satırdaki fiyat kutusu) fiyat geçmişine yazar. Sayım listesinden
 * fiyatıyla eklenip hâlâ "Tahmini" olan ve geçmişinde yalnız başlangıç satırı bulunan kalemde yeni satır açılmaz,
 * başlangıç satırı yerinde düzelir (correctsCountItemStart; anı kalır, kapanmış ay da düzelir). Öteki durumlarda yeni
 * satır (zam). Sunucu eylemi değil; çağıranın işleminde çalışır. Dönüş: "start" (başlangıç düzeltildi) ya da "added".
 */
export async function recordIngredientPrice(
  tx: Tx,
  ing: { id: number; isEstimate: boolean },
  row: { packagePrice: number; packageSize: number; changedBy: string },
): Promise<"start" | "added"> {
  const p = s.ingredientPrices;
  const history = await tx.select({ id: p.id, note: p.note }).from(p).where(eq(p.ingredientId, ing.id)).limit(2);
  if (correctsCountItemStart(ing.isEstimate, history)) {
    await tx.update(p).set(correctedCountItemStart(row, row.changedBy)).where(eq(p.id, history[0].id));
    return "start";
  }
  await tx.insert(p).values({ ingredientId: ing.id, ...row });
  return "added";
}
