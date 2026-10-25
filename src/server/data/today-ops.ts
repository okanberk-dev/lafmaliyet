import "server-only";

import type { DayFacts } from "@/app/panel/bugun/logic";
import type { CurrentUser } from "@/server/auth/dal";
import { soldOutFacts } from "@/server/data/menu-status";
import { staffPosSummary } from "@/server/data/pos-staff";
import { posPendingSummary, staffPosMarksRecent } from "@/server/data/prices";

import { safe } from "./today-safe";

/**
 * Bugün'ün operasyon olguları (satırları src/app/panel/bugun/rows-ops.ts; plan docs/planlar/personel-yetki.md §4.3):
 * kasada (ModPOS) değişecek fiyatlar ve sonra Tükendi, mal siparişi taslağı, kasaya işle işaretleri. İki rolde çağrılır
 * (loadToday); personelin dalı yalnız personelin sabit sütunlu yükleyicilerini okur (src/server/data/pos-staff.ts),
 * tutar ve maliyet yüklenmez. Her yükleyici safe() ile: biri düşerse sayfa açılır.
 */
export async function opsFacts(user: CurrentUser, now: Date): Promise<Pick<DayFacts, "pos" | "ops">> {
  const lite = (p: { count: number; oldest: Date | null }) => ({ count: p.count, oldest: p.oldest?.toISOString() ?? null });
  // Personel: kendi sabit sütunlu yükleyicileri (kasadaki fiyatlar yalnız etkin ürünlerden; §2.2)
  // Tükenenler (§2.1; iki rolde, "Bugün kafede"nin satırı): kartla kapatılıp kaydı geçerli ürünler, fiyatsız
  const soldOutP = safe(soldOutFacts());
  if (user.role !== "admin") {
    const [pos, soldOut] = await Promise.all([safe(staffPosSummary().then(lite)), soldOutP]);
    return { pos, ops: { soldOut } };
  }
  // Yönetici: kasada bekleyen bütün fiyatlar ve personelin son 48 saatteki işaretleri (Tamamlananlar satırı)
  const [pos, posMarks, soldOut] = await Promise.all([safe(posPendingSummary().then(lite)), safe(staffPosMarksRecent(now)), soldOutP]);
  return { pos, ops: { posMarks, soldOut } };
}
