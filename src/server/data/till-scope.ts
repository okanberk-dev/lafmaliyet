import "server-only";

import { isNull, type SQL } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { tillScope, type TillScope } from "@/lib/lafpos/kasa";
import { lafposSwitchDayOf } from "@/server/data/lafpos-ikram";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Bugünün kasası (denetim E-39; kural src/lib/lafpos/kasa.ts tillScope): geçiş günü seçili ve bugün (iş günü, 05:00
 * kuralı) ondan önce değilse LafPOS, değilse ModPOS. Kasadaki fiyatların okuyucuları (Kasaya işle, Kasadaki fiyatlar,
 * zil, Bugün, haftalık özet, ürün kartı) ve metinleri buna bakar. İşlem içinden de okunur (fiyat yazımı).
 */
export async function loadTillScope(db: Pick<DB, "select"> = getDb(), now: Date = new Date()): Promise<TillScope> {
  return tillScope(businessDate(now), await lafposSwitchDayOf(db));
}

/**
 * Kasa listesinin ürün süzgeci: LafPOS gününde yalnız siteye bağlı olmayan ürünler (siteye bağlınınkini LafPOS siteden
 * alır; eski işareti silinmez, gösterilmez). ModPOS gününde süzgeç yok
 */
export function tillProductFilter(scope: TillScope): SQL | undefined {
  return scope.lafpos ? isNull(s.products.siteMenuId) : undefined;
}
