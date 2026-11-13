import "server-only";

import { monthEndCountPush } from "@/app/panel/sayim/logic";
import { businessDate } from "@/lib/cash-report";
import { isLastDayOfMonth } from "@/lib/reminders";
import { countProgressByBranch } from "@/server/data/count-progress";
import { sendPush } from "@/server/push/send";

/**
 * Ay sonu stok sayımının sabah bildirimi (günlük iş, /api/cron/gunluk; docs/BILDIRIMLER.md): ayın son iş günü, sayım
 * listesi doluysa ve ayın sayımı tamamlanmadıysa "Sabah özeti" açık bütün cihazlara bildirim (hatırlatıcı konusu;
 * metin ve adres sayim/logic.ts monthEndCountPush). Günlük işte çerez yok: açık her fiziksel şubenin sayımına bakılır,
 * sayımı eksik şube başına bir bildirim (birden çok şubede "Marina · …" ve ayrı etiket; denetim ST-04). Tutar yok.
 * Öteki günler bildirim yok (haftalık hızlı sayım bildirimi 26 Eki 2026'da hızlı sayımla birlikte kaldırıldı).
 */
export async function pushMonthEndCount(now = new Date()): Promise<{ status: "sent" | "skip"; sent: number; failed: number }> {
  const day = businessDate(now);
  if (!isLastDayOfMonth(day)) return { status: "skip", sent: 0, failed: 0 };
  const pushes = (await countProgressByBranch(day.slice(0, 7))).flatMap((b) => monthEndCountPush(day, b, b) ?? []);
  if (!pushes.length) return { status: "skip", sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (const push of pushes) {
    const r = await sendPush("reminders", { kind: "reminders", ...push }, { ttl: 16 * 3600, urgency: "normal" });
    sent += r.sent;
    failed += r.failed;
  }
  return { status: "sent", sent, failed };
}
