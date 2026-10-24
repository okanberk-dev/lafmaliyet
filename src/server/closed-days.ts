import "server-only";

import type { DayFacts } from "@/app/panel/bugun/logic";
import type { CurrentUser } from "@/server/auth/dal";

/*
 * Kapalı gün (plan docs/planlar/personel-yetki.md §2.9): Dalga 9'un özel günlerindeki `kapali` satırı ve personelin
 * "Dün kafe kapalıydı" bildirimi (staff_requests, tür `kapali-gun`). Kasa grubunun modülü; operasyon grubu
 * closedDayRefusal'ı çağırır (zayi). Şimdilik taslak: kapalı gün kuralı maddesiyle gelir, o zamana kadar hiçbir yazımı
 * reddetmez ve Bugün'e olgu vermez.
 */

/**
 * Personelin yazımı (kasadan çıkan, zayi / ikram) onaylı kapalı güne düşüyorsa nedeni; yönetici ve açık gün null
 */
export async function closedDayRefusal(date: string, role: "admin" | "staff"): Promise<string | null> {
  void date;
  void role;
  return null;
}

/** Bugün'ün olgusu: dün kafe kapalı mıydı (onaylı ya da personelin bildirdiği, onay bekleyen); yoksa null */
export async function closedYesterday(user: CurrentUser, now: Date): Promise<DayFacts["closed"]> {
  void user;
  void now;
  return null;
}
