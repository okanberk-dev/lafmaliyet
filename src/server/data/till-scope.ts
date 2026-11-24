import "server-only";

import { and, eq, exists, gte, isNull, type SQL } from "drizzle-orm";

import { ALL_BRANCHES, namedTill, tillBranches, type BranchRow } from "@/lib/branches";
import { businessDate, DAY_TURN_HOUR } from "@/lib/cash-report";
import { tillScope, type TillScope } from "@/lib/lafpos/kasa";
import { branchSwitchDay } from "@/lib/lafpos/switch";
import { currentBranchScope, currentTillBranch } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { lafposSwitchDayOf } from "@/server/data/lafpos-ikram";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Bir şubenin bugünkü kasası (şube kapsamı A3, 24 Kasım 2026): kasada bekleyen fiyat şube başına tutulur (pos_stale),
 * okuyucular hangi şubenin satırlarını okuyacaklarını buradan alır. `name` yalnız "Tümü"de birden çok kasa yan yana
 * gösterilirken şubenin adı (loadTillScopes, namedTill); tek şube seçiliyken ve tek kasada null, metinler bugünkü gibi
 */
export interface BranchTill extends TillScope {
  branchId: string;
  name: string | null;
}

/** Şubenin kasası, geçiş günü verilmiş (saf; işlem içinden ve döngüde tek okuma için) */
export function branchTill(switchDay: string | null, branchId: string, now: Date, branches: readonly BranchRow[] = []): BranchTill {
  return { ...tillScope(businessDate(now), branchSwitchDay(switchDay, branchId)), branchId, name: namedTill(branches, branchId)?.name ?? null };
}

/**
 * Bugünün kasası (denetim E-39; kural src/lib/lafpos/kasa.ts tillScope): geçiş günü seçili ve bugün (iş günü, 05:00
 * kuralı) ondan önce değilse LafPOS, değilse ModPOS. Kasadaki fiyatların okuyucuları (Kasaya işle, Kasadaki fiyatlar,
 * zil, Bugün, haftalık özet, ürün kartı) ve metinleri buna bakar. Kasa, kasanın şubesinindir (`branchId` verilmezse
 * seçili fiziksel şube, "Tümü"de ve istek dışında Tuzla): geçiş günü yalnız LafPOS'un şubesinin kasasına uygulanır,
 * ModPOS'ta kalan şubede (Tuzla) liste ModPOS'a göredir (branchSwitchDay; denetim 21 Kasım #5)
 */
export async function loadTillScope(db: Pick<DB, "select"> = getDb(), now: Date = new Date(), branchId?: string): Promise<BranchTill> {
  const [switchDay, sube] = await Promise.all([lafposSwitchDayOf(db), branchId ?? currentTillBranch()]);
  return branchTill(switchDay, sube, now);
}

/**
 * Seçimin kasaları (docs/FIYATLAR.md › Kasaya işle): tek şube seçiliyken onunki (online kanalda Tuzla), "Tümü"de birden
 * çok kasa açıkken her kasa ayrı (ekranlar şube şube satır gösterir), tek kasada o. Şubesine kilitli personelde kendi
 * şubesi (seçim kilitli).
 */
export async function loadTillScopes(db: Pick<DB, "select"> = getDb(), now: Date = new Date()): Promise<BranchTill[]> {
  const [scope, branches] = await Promise.all([currentBranchScope(), listBranches()]);
  const tills = tillBranches(branches);
  if (scope !== ALL_BRANCHES || tills.length < 2) return [await loadTillScope(db, now)];
  const switchDay = await lafposSwitchDayOf(db);
  return tills.map((b) => branchTill(switchDay, b.id, now, branches));
}

/** Ürünün bu şubenin kasasında bekleyen fiyatı var (pos_stale); kasa listesinin okuyucuları ve sayıları */
export function posStaleJoin(till: Pick<BranchTill, "branchId">): SQL {
  return and(eq(s.posStale.productId, s.products.id), eq(s.posStale.branchId, till.branchId))!;
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
