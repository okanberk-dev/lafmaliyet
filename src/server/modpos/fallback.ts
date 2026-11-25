import "server-only";

import { MODPOS_GROUP } from "@/lib/branch-settings/groups";
import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { resolveBranchSetting, resolveForTills } from "@/server/branch-settings";
import { getDb, type DB } from "@/server/db";

/*
 * ModPOS ay rakamına yedeğin okunması, şube başına (docs/MODPOS-API.md › Ay rakamına yedek; şube ayarı `modpos`,
 * docs/SUBE.md › Şube başına ayarlar). Satırı yokken Tuzla eski genel kaydı (settings › modposAyYedegi) okur, öbür
 * şubeler örtük olarak Tuzla'yla "aynı" başlar: bugünkü tek anahtar hiçbir şey yapmadan bütün föylere uygulanır.
 */

type Reader = Pick<DB, "select">;

/** Şubenin ay rakamına yedeği açık mı (varsayılan şube Tuzla; satırı ya da kaydı yoksa kapalı) */
export async function loadModposFallback(db: Reader = getDb(), branchId: string = DEFAULT_BRANCH_ID): Promise<boolean> {
  return (await resolveBranchSetting(MODPOS_GROUP, branchId, db)).value.monthFallback;
}

/** Ay yedeği açık fiziksel şubeler (kapalı şubeler de: eski föyleri ayın hesabına girer); boşsa föy tablosu okunmaz */
export async function modposFallbackBranches(db: Reader = getDb()): Promise<Set<string>> {
  const all = await resolveForTills(MODPOS_GROUP, db, { closed: true });
  return new Set([...all].filter(([, r]) => r.value.monthFallback).map(([id]) => id));
}
