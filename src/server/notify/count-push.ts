import "server-only";

import { monthEndCountPush } from "@/app/panel/sayim/logic";
import { businessDate } from "@/lib/cash-report";
import { isLastDayOfMonth } from "@/lib/reminders";
import { countProgress } from "@/server/data/count-progress";
import { sendPush } from "@/server/push/send";

/**
 * Ay sonu stok sayımının sabah bildirimi (günlük iş, /api/cron/gunluk; docs/BILDIRIMLER.md): ayın son iş günü, sayım
 * listesi doluysa ve ayın sayımı tamamlanmadıysa "Sabah özeti" açık bütün cihazlara tek bildirim (hatırlatıcı konusu;
 * metin ve adres sayim/logic.ts monthEndCountPush). Tutar yok. Öteki günler bildirim yok (haftalık hızlı sayım
 * bildirimi 26 Eki 2026'da hızlı sayımla birlikte kaldırıldı).
 */
export async function pushMonthEndCount(now = new Date()): Promise<{ status: "sent" | "skip"; sent: number; failed: number }> {
  const day = businessDate(now);
  if (!isLastDayOfMonth(day)) return { status: "skip", sent: 0, failed: 0 };
  const push = monthEndCountPush(day, await countProgress(day.slice(0, 7)));
  if (!push) return { status: "skip", sent: 0, failed: 0 };
  const r = await sendPush("reminders", { kind: "reminders", ...push }, { ttl: 16 * 3600, urgency: "normal" });
  return { status: "sent", sent: r.sent, failed: r.failed };
}
