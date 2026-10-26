import "server-only";

import { monthEndCountPush } from "@/app/panel/sayim/logic";
import { businessDate } from "@/lib/cash-report";
import { num } from "@/lib/format";
import { countPushDue } from "@/lib/reorder/levels";
import { isLastDayOfMonth } from "@/lib/reminders";
import { loadReorderDay } from "@/server/data/reorder";
import { countProgress } from "@/server/data/count-progress";
import { sendPush } from "@/server/push/send";

/**
 * Sayım günü sabah bildirimi (günlük iş, /api/cron/gunluk; docs/MAL-SIPARISI.md › Sayım günleri): sayım günüyse,
 * takipte kalem varsa ve hepsi bugün sayılmadıysa "Sabah özeti" açık bütün cihazlara tek bildirim (hatırlatıcı
 * konusu). Tutar yok. Ayın son günü sayım günü değildir (ay sonu Stok sayımı yerine geçer): o gün ay sonu sayımı
 * tamamlanmadıysa onun bildirimi gider (sayim/logic.ts monthEndCountPush).
 */
export async function pushCountDay(now = new Date()): Promise<{ status: "sent" | "skip"; sent: number; failed: number; kind?: "ay-sonu" }> {
  const day = businessDate(now);
  // Ayın son günü: hızlı sayım yerine ay sonu Stok sayımı hatırlatılır (tamamlanmadıysa; sayım ekranına, o aya)
  if (isLastDayOfMonth(day)) {
    const push = monthEndCountPush(day, await countProgress(day.slice(0, 7)));
    if (!push) return { status: "skip", sent: 0, failed: 0, kind: "ay-sonu" };
    const r = await sendPush("reminders", { kind: "reminders", ...push }, { ttl: 16 * 3600, urgency: "normal" });
    return { status: "sent", sent: r.sent, failed: r.failed, kind: "ay-sonu" };
  }
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
