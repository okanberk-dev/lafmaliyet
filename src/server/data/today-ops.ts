import "server-only";

import type { DayFacts } from "@/app/panel/bugun/logic";
import { combineTillPos, type TillPosSummary } from "@/lib/prices/pos";
import type { CurrentUser } from "@/server/auth/dal";
import { soldOutFacts } from "@/server/data/menu-status";
import { staffPosSummary } from "@/server/data/pos-staff";
import { posPendingSummary, staffPosMarksRecent } from "@/server/data/prices";
import { type BranchTill, loadTillScopes } from "@/server/data/till-scope";

import { safe } from "./today-safe";

/**
 * Bugün'ün operasyon olguları (satırları src/app/panel/bugun/rows-ops.ts; plan docs/planlar/personel-yetki.md §4.3):
 * kasada (ModPOS) değişecek fiyatlar ve sonra Tükendi, kasaya işle işaretleri. İki rolde çağrılır
 * (loadToday); personelin dalı yalnız personelin sabit sütunlu yükleyicilerini okur (src/server/data/pos-staff.ts),
 * tutar ve maliyet yüklenmez. Her yükleyici safe() ile: biri düşerse sayfa açılır. Kasa şube başınadır (şube kapsamı A3):
 * seçimin kasaları (tek şubede onunki, "Tümü"de birden çok kasa açıkken her biri) ayrı okunur, satır toplamı ve kasa
 * başına sayıyı gösterir (combineTillPos).
 */
export async function opsFacts(user: CurrentUser, now: Date): Promise<Pick<DayFacts, "pos" | "ops">> {
  // Bugünün kasaları (AsilPOS gününde siteye bağlı ürünler kasa listesinde sayılmaz; till-scope.ts, denetim E-39)
  const lite = (p: ReturnType<typeof combineTillPos>) => ({ count: p.count, oldest: p.oldest?.toISOString() ?? null, kasa: p.kasa, byBranch: p.byBranch });
  const scope = loadTillScopes(undefined, now);
  const each = (tills: BranchTill[], read: (t: BranchTill) => Promise<TillPosSummary>) => Promise.all(tills.map(read)).then(combineTillPos).then(lite);
  // Personel: kendi sabit sütunlu yükleyicileri (kasadaki fiyatlar yalnız etkin ürünlerden; §2.2). AsilPOS gününün kasası
  // personele görev vermez (posRow): yalnız ModPOS kasaları okunur
  // Tükenenler (§2.1; iki rolde, "Bugün kafede"nin satırı): kartla kapatılıp kaydı geçerli ürünler, fiyatsız
  const soldOutP = safe(soldOutFacts());
  if (user.role !== "admin") {
    const [pos, soldOut] = await Promise.all([safe(scope.then((t) => each(t.filter((x) => !x.asilpos), staffPosSummary))), soldOutP]);
    return { pos, ops: { soldOut } };
  }
  // Yönetici: kasada bekleyen bütün fiyatlar ve personelin son 48 saatteki işaretleri (Tamamlananlar satırı)
  const [pos, posMarks, soldOut] = await Promise.all([
    safe(scope.then((t) => each(t, posPendingSummary))),
    safe(scope.then((t) => staffPosMarksRecent(now, t.map((x) => x.branchId)))),
    soldOutP,
  ]);
  return { pos, ops: { posMarks, soldOut } };
}
