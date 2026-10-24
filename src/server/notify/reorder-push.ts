import "server-only";

import { businessDate } from "@/lib/cash-report";
import { num } from "@/lib/format";
import { countPushDue } from "@/lib/reorder/levels";
import { loadReorderDay } from "@/server/data/reorder";
import { sendPush } from "@/server/push/send";

/**
 * Sayım günü sabah bildirimi (günlük iş, /api/cron/gunluk; docs/MAL-SIPARISI.md › Sayım günleri): sayım günüyse,
 * takipte kalem varsa ve hepsi bugün sayılmadıysa "Sabah özeti" açık bütün cihazlara tek bildirim (hatırlatıcı
 * konusu). Tutar yok. Ayın son günü sayım günü değildir (ay sonu Stok sayımı yerine geçer).
 */
export async function pushCountDay(now = new Date()): Promise<{ status: "sent" | "skip"; sent: number; failed: number }> {
  const day = businessDate(now);
  // Personelin olguları: sayım günleri, takipteki ve bugün sayılan kalem (fiyat ve model yok)
  const facts = await loadReorderDay("staff", now);
  if (!facts || !countPushDue(day, facts, facts.total, facts.countedToday)) return { status: "skip", sent: 0, failed: 0 };
  const r = await sendPush(
    "reminders",
    {
      kind: "reminders",
      title: "Bugün hızlı sayım günü",
      body: `${num(facts.total)} kritik kalem · telefondan birkaç dakika; sipariş listesi sayımdan hazırlanır`,
      url: "/panel/hizli-sayim",
      tag: `hizli-sayim-${day}`,
    },
    { ttl: 8 * 3600, urgency: "normal" },
  );
  return { status: "sent", sent: r.sent, failed: r.failed };
}
