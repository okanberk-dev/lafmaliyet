import "server-only";

import { and, asc, count, desc, eq, gt, lte, max } from "drizzle-orm";

import { addDays, todayTR } from "@/lib/reminders";
import type { UserRepeat } from "@/lib/user-reminders";
import { getDb, schema as s } from "@/server/db";

export interface UserReminderDTO {
  id: number;
  title: string;
  note: string | null;
  dueDate: string;
  dueTime: string | null;
  anchorDate: string;
  repeat: UserRepeat;
  active: boolean;
  doneAt: string | null;
}

const toDTO = (r: typeof s.userReminders.$inferSelect): UserReminderDTO => ({
  id: r.id,
  title: r.title,
  note: r.note,
  dueDate: r.dueDate,
  dueTime: r.dueTime,
  anchorDate: r.anchorDate,
  repeat: r.repeat as UserRepeat,
  active: r.active,
  doneAt: r.doneAt?.toISOString() ?? null,
});

/** Kişinin açık hatırlatıcıları (tarih, saat sırasıyla) ve son iki haftada tamamladığı tek seferlikler */
export async function loadMyReminders(userId: number): Promise<{ open: UserReminderDTO[]; done: UserReminderDTO[] }> {
  const db = getDb();
  const [open, done] = await Promise.all([
    db
      .select()
      .from(s.userReminders)
      .where(and(eq(s.userReminders.userId, userId), eq(s.userReminders.active, true)))
      .orderBy(asc(s.userReminders.dueDate), asc(s.userReminders.dueTime), asc(s.userReminders.id)),
    db
      .select()
      .from(s.userReminders)
      .where(and(eq(s.userReminders.userId, userId), eq(s.userReminders.active, false), gt(s.userReminders.doneAt, new Date(Date.now() - 14 * 86_400_000))))
      .orderBy(desc(s.userReminders.doneAt))
      .limit(30),
  ]);
  return { open: open.map(toDTO), done: done.map(toDTO) };
}

/** Zil ve canlı uyarılar için: yarına kadar (gecikenler dahil) açık hatırlatıcılar */
export async function loadDueReminders(userId: number, today = todayTR()): Promise<UserReminderDTO[]> {
  const rows = await getDb()
    .select()
    .from(s.userReminders)
    .where(and(eq(s.userReminders.userId, userId), eq(s.userReminders.active, true), lte(s.userReminders.dueDate, addDays(today, 1))))
    .orderBy(asc(s.userReminders.dueDate), asc(s.userReminders.dueTime))
    .limit(50);
  return rows.map(toDTO);
}

/**
 * Kişinin hatırlatıcılarının değişim işareti (canlı uç ETag'i: değişmediyse veri okunmaz). Sayı silmeyi, son
 * güncelleme anı eklemeyi, düzenlemeyi ve tamamlamayı yakalar.
 */
export async function remindersMarker(userId: number): Promise<string> {
  const [row] = await getDb()
    .select({ n: count(), at: max(s.userReminders.updatedAt) })
    .from(s.userReminders)
    .where(eq(s.userReminders.userId, userId));
  return `${row?.n ?? 0}.${row?.at ? new Date(row.at).getTime().toString(36) : "0"}`;
}
