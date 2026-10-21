import "server-only";

import { and, asc, eq, lte } from "drizzle-orm";

import { todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";
import { sendPush } from "@/server/push/send";

/**
 * Sabah özeti (günlük iş, /api/cron/gunluk): bugün ya da önceden kalmış açık kişisel hatırlatıcısı olan her kişinin
 * "sabah özeti" açık cihazlarına tek bildirim. Kimsenin hatırlatıcısı başkasına gitmez.
 */
export async function pushReminderSummaries(today = todayTR()): Promise<{ users: number; sent: number }> {
  const rows = await getDb()
    .select({ userId: s.userReminders.userId, title: s.userReminders.title, dueTime: s.userReminders.dueTime, dueDate: s.userReminders.dueDate })
    .from(s.userReminders)
    .innerJoin(s.users, eq(s.users.id, s.userReminders.userId))
    .where(and(eq(s.userReminders.active, true), lte(s.userReminders.dueDate, today), eq(s.users.active, true)))
    .orderBy(asc(s.userReminders.dueDate), asc(s.userReminders.dueTime));
  const byUser = new Map<number, typeof rows>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  let sent = 0;
  for (const [userId, list] of byUser) {
    const late = list.filter((r) => r.dueDate < today).length;
    const titles = list.slice(0, 3).map((r) => (r.dueTime && r.dueDate === today ? `${r.dueTime} ${r.title}` : r.title));
    const res = await sendPush(
      "reminders",
      {
        kind: "reminders",
        title: `Bugün ${list.length} hatırlatıcınız var`,
        body: `${titles.join(" · ")}${list.length > 3 ? " …" : ""}${late ? ` (${late} tanesi gecikmiş)` : ""}`,
        url: "/panel/hatirlaticilarim",
        tag: `hatirlatici-ozet-${today}`,
      },
      { userIds: [userId], ttl: 6 * 3600, urgency: "normal" },
    );
    sent += res.sent;
  }
  return { users: byUser.size, sent };
}
