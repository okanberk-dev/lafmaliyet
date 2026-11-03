import "server-only";

import { eq } from "drizzle-orm";

import { modposFallbackChangeText } from "@/lib/modpos/ayarlar";
import { readModposFallback, MODPOS_FALLBACK_KEY } from "@/lib/modpos/status";
import { schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

/**
 * Ayarlar › ModPOS (kasa föyü) kartının yazımı (docs/MODPOS-API.md › Ay rakamına yedek), eylemden ayrı ve veritabanını
 * parametre alarak (tests/modpos-ayarlar-db.test.ts doğrudan çalıştırır). Yalnız yöneticinin: eylem
 * (src/server/actions/modpos.ts) oturumu denetler, burada rol yeniden denetlenir (LafPOS'un geçiş günüyle aynı kural).
 */

type Actor = { id: number; name: string; role: "admin" | "staff" };

export const MODPOS_ADMIN_ONLY = "Bu işlemi yalnız yönetici yapabilir";

/**
 * Ay rakamına yedeği açar ya da kapatır (settings › modposAyYedegi). Hiçbir föy ya da rapor yazılmaz ya da silinmez,
 * yalnız ayın hesabını okuyanlar değişir. Kapalı da `false` olarak yazılır (okuyan ikisini de aynı sayar; işlem
 * geçmişi kimin kapattığını söyler). Değişiklik yoksa null; varsa işlem geçmişinin metni
 * ("ModPOS ay rakamına yedek: kapalı → açık").
 */
export async function writeModposFallback(db: DB, me: Actor, on: boolean): Promise<string | null> {
  if (me.role !== "admin") throw new UserError(MODPOS_ADMIN_ONLY);
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, MODPOS_FALLBACK_KEY)).for("update").limit(1);
    const prev = readModposFallback(row?.value);
    if (row && prev === on && row.value === on) return null;
    await tx.insert(s.settings).values({ key: MODPOS_FALLBACK_KEY, value: on }).onConflictDoUpdate({ target: s.settings.key, set: { value: on, updatedAt: new Date() } });
    return prev === on ? null : modposFallbackChangeText(prev, on);
  });
}
