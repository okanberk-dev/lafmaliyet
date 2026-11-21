import "server-only";

import { and, eq, exists, gte, isNull, type SQL } from "drizzle-orm";

import { businessDate, DAY_TURN_HOUR } from "@/lib/cash-report";
import { tillScope, type TillScope } from "@/lib/lafpos/kasa";
import { branchSwitchDay } from "@/lib/lafpos/switch";
import { currentTillBranch } from "@/server/branch-scope";
import { lafposSwitchDayOf } from "@/server/data/lafpos-ikram";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Bugünün kasası (denetim E-39; kural src/lib/lafpos/kasa.ts tillScope): geçiş günü seçili ve bugün (iş günü, 05:00
 * kuralı) ondan önce değilse LafPOS, değilse ModPOS. Kasadaki fiyatların okuyucuları (Kasaya işle, Kasadaki fiyatlar,
 * zil, Bugün, haftalık özet, ürün kartı) ve metinleri buna bakar. İşlem içinden de okunur (fiyat yazımı). Kasa,
 * kasanın şubesinindir (seçili fiziksel şube, "Tümü"de ve istek dışında Tuzla): geçiş günü yalnız LafPOS'un şubesinin
 * kasasına uygulanır, ModPOS'ta kalan şubede (Marina) liste ModPOS'a göredir (branchSwitchDay; denetim 21 Kasım #5)
 */
export async function loadTillScope(db: Pick<DB, "select"> = getDb(), now: Date = new Date()): Promise<TillScope> {
  const [switchDay, sube] = await Promise.all([lafposSwitchDayOf(db), currentTillBranch()]);
  return tillScope(businessDate(now), branchSwitchDay(switchDay, sube));
}

/** LafPOS'un başladığı an: geçiş gününün 05:00'i (Türkiye, UTC+3); ModPOS gününde null */
export function tillStart(scope: TillScope): Date | null {
  return scope.switchDay ? new Date(`${scope.switchDay}T${String(DAY_TURN_HOUR).padStart(2, "0")}:00:00+03:00`) : null;
}

/**
 * Kasa listesinin ürün süzgeci. ModPOS gününde süzgeç yok. LafPOS gününde yalnız siteye bağlı olmayan ve satış fiyatı
 * LafPOS başladıktan sonra yalnız panelde değişmiş ürünler (geçmişte o andan sonra `on_site` olmayan bir satır):
 * siteye bağlınınkini LafPOS siteden alır; ModPOS'tan kalan işaretin (fiyat geçiş gününden önce değişti) LafPOS'la ilgisi
 * yok, LafPOS'un yerel ürünü kurulurken fiyat panelden alınır. Satırlar silinmez: geçiş günü kaldırılınca hepsi geri
 * gelir (switch.ts: ayar değişince yalnız okuyanlar değişir).
 */
export function tillProductFilter(scope: TillScope, db: Pick<DB, "select"> = getDb()): SQL | undefined {
  const start = tillStart(scope);
  if (!scope.lafpos || !start) return undefined;
  const pp = s.productPrices;
  const changedSinceStart = exists(
    db
      .select({ id: pp.id })
      .from(pp)
      .where(and(eq(pp.productId, s.products.id), gte(pp.changedAt, start), eq(pp.onSite, false))),
  );
  return and(isNull(s.products.siteMenuId), changedSinceStart);
}

/**
 * Kasanın ne zamandan beri geride olduğu, günün kasasına göre: LafPOS gününde en erken LafPOS'un başladığı an (ModPOS'tan
 * kalan işaretin tarihi LafPOS için "40 gündür" demesin)
 */
export function tillSince<T extends Date | null>(scope: TillScope, since: T): T {
  const start = tillStart(scope);
  if (!start || since === null) return since;
  return (since.getTime() < start.getTime() ? start : since) as T;
}
