import "server-only";

import { eq } from "drizzle-orm";

import { countPushReaches, monthEndCountPushes } from "@/app/panel/sayim/logic";
import { businessDate } from "@/lib/cash-report";
import { isLastDayOfMonth } from "@/lib/reminders";
import { countProgressByBranch } from "@/server/data/count-progress";
import { getDb, schema as s } from "@/server/db";
import { sendPush } from "@/server/push/send";

/**
 * Ay sonu stok sayımının sabah bildirimi (günlük iş, /api/cron/gunluk; docs/BILDIRIMLER.md): ayın son iş günü, sayım
 * listesi doluysa ve ayın sayımı tamamlanmadıysa "Sabah özeti" açık cihazlara bildirim (hatırlatıcı konusu; metin ve
 * adres sayim/logic.ts monthEndCountPush). Tutar yok. Öteki günler bildirim yok (haftalık hızlı sayım bildirimi 26 Eki
 * 2026'da hızlı sayımla birlikte kaldırıldı).
 *
 * Sayım şube başınadır (docs/SUBE.md): her açık şubenin sayımına ayrı bakılır. Birden çok şube açıkken sayımı bitmeyen
 * şubenin bildirimi başlığında şubenin adıyla o şubenin personeline, yöneticilere ve şubesiz personele gider
 * (`countPushReaches`); tek şubede herkese tek bildirim, bugünkü gibi. Önceden günlük işte şube seçimi olmadığı için
 * yalnız Tuzla'nın sayımına bakılıyor, Marina'nın personeline Tuzla'nın sayısı gidiyordu (denetim 21 Kasım #16).
 */
export async function pushMonthEndCount(now = new Date()): Promise<{ status: "sent" | "skip"; sent: number; failed: number }> {
  const day = businessDate(now);
  if (!isLastDayOfMonth(day)) return { status: "skip", sent: 0, failed: 0 };
  const { named, open, counts } = await countProgressByBranch(day.slice(0, 7));
  const pushes = monthEndCountPushes(day, counts, named);
  if (!pushes.length) return { status: "skip", sent: 0, failed: 0 };
  const users = named ? await getDb().select({ id: s.users.id, branchId: s.users.branchId }).from(s.users).where(eq(s.users.active, true)) : [];
  let sent = 0;
  let failed = 0;
  for (const { branchId, push } of pushes) {
    const userIds = branchId ? users.filter((u) => countPushReaches(u.branchId, branchId, open)).map((u) => u.id) : undefined;
    const r = await sendPush("reminders", { kind: "reminders", ...push }, { ttl: 16 * 3600, urgency: "normal", userIds });
    sent += r.sent;
    failed += r.failed;
  }
  return { status: "sent", sent, failed };
}
