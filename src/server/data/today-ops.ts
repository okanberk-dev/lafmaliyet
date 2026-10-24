import "server-only";

import type { DayFacts } from "@/app/panel/bugun/logic";
import type { CurrentUser } from "@/server/auth/dal";
import { posPendingSummary } from "@/server/data/prices";

import { safe } from "./today-safe";

/**
 * Bugün'ün operasyon olguları (satırları src/app/panel/bugun/rows-ops.ts; plan docs/planlar/personel-yetki.md §4.3):
 * kasada (ModPOS) değişecek fiyatlar ve sonra Tükendi, mal siparişi taslağı, kasaya işle işaretleri. İki rolde çağrılır
 * (loadToday); personelin dalı yalnız personelin sabit sütunlu yükleyicilerini okur, tutar ve maliyet yüklenmez. Her
 * yükleyici safe() ile: biri düşerse sayfa açılır.
 */
export async function opsFacts(user: CurrentUser, now: Date): Promise<Pick<DayFacts, "pos" | "ops">> {
  // Saat, operasyonun maddelerinin olgularında (Tükendi'nin süresi, taslağın günü) kullanılır
  void now;
  // Personel: olguları maddeleriyle gelir (kasadaki fiyatlar, Tükendi, onaylanmış taslak); bugün yönetici olgusu yok
  if (user.role !== "admin") return { ops: {} };
  const pos = await safe(posPendingSummary().then((p) => ({ count: p.count, oldest: p.oldest?.toISOString() ?? null })));
  return { pos, ops: {} };
}
