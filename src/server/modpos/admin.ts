import "server-only";

import { MODPOS_GROUP } from "@/lib/branch-settings/groups";
import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { modposFallbackChangeText } from "@/lib/modpos/ayarlar";
import { lockGroup, putBranchSetting, resolveBranchSetting } from "@/server/branch-settings";
import type { DB } from "@/server/db";
import { UserError } from "@/server/user-error";

/**
 * Ayarlar › ModPOS (kasa föyü) kartının yazımı (docs/MODPOS-API.md › Ay rakamına yedek), eylemden ayrı ve veritabanını
 * parametre alarak (tests/modpos-ayarlar-db.test.ts doğrudan çalıştırır). Yalnız yöneticinin: eylem
 * (src/server/actions/modpos.ts) oturumu denetler, burada rol yeniden denetlenir (AsilPOS'un geçiş günüyle aynı kural).
 */

type Actor = { id: number; name: string; role: "admin" | "staff" };

export const MODPOS_ADMIN_ONLY = "Bu işlemi yalnız yönetici yapabilir";

/**
 * Şubenin ay rakamına yedeğini açar ya da kapatır (şube ayarı `modpos`; docs/SUBE.md › Şube başına ayarlar; eski kayıt
 * settings › modposAyYedegi Tuzla'nındı). Hiçbir föy ya da rapor yazılmaz ya da silinmez, yalnız ayın hesabını okuyanlar
 * değişir. Şube başka şubenin ayarını kullanıyorsa ("Tuzla ile aynı") yazılmaz: önce Şube ayarları'ndan ayrılır. Bu
 * şubeye bağlı şubeler de değişir. Değişiklik yoksa null; varsa işlem geçmişinin metni
 * ("ModPOS ay rakamına yedek: kapalı → açık").
 */
export async function writeModposFallback(db: DB, me: Actor, on: boolean, branchId: string = DEFAULT_BRANCH_ID): Promise<string | null> {
  if (me.role !== "admin") throw new UserError(MODPOS_ADMIN_ONLY);
  return db.transaction(async (tx) => {
    await lockGroup(tx, MODPOS_GROUP.id);
    const prev = (await resolveBranchSetting(MODPOS_GROUP, branchId, tx)).value.monthFallback;
    if (prev === on) return null;
    await putBranchSetting(tx, MODPOS_GROUP, branchId, { monthFallback: on }, me.name);
    return modposFallbackChangeText(prev, on);
  });
}
