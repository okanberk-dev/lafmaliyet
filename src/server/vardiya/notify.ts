import "server-only";

import { createHash } from "node:crypto";

import { and, count, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { after } from "next/server";

import { addDays, todayTR } from "@/lib/reminders";
import { missingPlans, planReminderText, planReminderWeek, shiftChangeNotice, type ShiftChange } from "@/lib/vardiya-bildirim";
import { listBranches } from "@/server/branches";
import { getDb, schema as s, type DB } from "@/server/db";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { renderShiftChange } from "@/server/notify/vardiya-template";
import { sendPush } from "@/server/push/send";

import { shiftBranches } from "./store";

/*
 * Vardiya bildirimlerinin gönderimi (kurallar src/lib/vardiya-bildirim.ts; docs/VARDIYA.md › Bildirimler):
 * - Vardiyası değişen kişiye: bildirimi açık cihazlarına push; hiçbir cihaza gidemediyse (cihaz yok) hesabının e-posta
 *   adresine e-posta ("Hatırlatma e-postaları" açıksa ve Resend kuruluysa). Hesabı olmayan çalışana gidemez.
 * - Gelecek haftanın planı yazılmadıysa yöneticilere: zil (src/server/bell/vardiya.ts) ve günlük işin push'u (Cuma–Pazar
 *   sabahı, şube ve gün başına bir kez).
 */

/** Kaydı yapan eylem çağırır: bildirimler yanıttan sonra gider (kayıt beklemez, bildirim servisi düşse de kayıt etkilenmez) */
export function notifyShiftChanges(changes: ShiftChange[], branch: { id: string; name: string }): void {
  if (!changes.length) return;
  try {
    after(() =>
      sendShiftChangeNotices(getDb(), changes, branch)
        .then((r) => {
          if (r.failed) console.warn("[vardiya] bildirim", r);
        })
        .catch((e: unknown) => console.error("[vardiya] bildirim", (e as Error).message)),
    );
  } catch {
    // İstek dışında (betik, test) bildirim gönderilmez
  }
}

export interface ShiftNoticeRun {
  pushed: number;
  emailed: number;
  /** Bildirim açık cihazı yok ve e-posta gönderilemedi (kapalı ya da kurulmadı) */
  skipped: number;
  failed: number;
}

/**
 * Değişiklikleri kişi kişi gönderir (kişi başına tek bildirim; etkin olmayan hesaba ve muhasebeciye gitmez: muhasebeci
 * vardiyada çalışmaz, docs/ROLLER.md › Saha kitleleri). Kişiler kaydın denetiminden geçmiştir (store.ts › shiftAccounts)
 */
export async function sendShiftChangeNotices(db: DB, changes: readonly ShiftChange[], branch: { id: string; name: string }): Promise<ShiftNoticeRun> {
  const run: ShiftNoticeRun = { pushed: 0, emailed: 0, skipped: 0, failed: 0 };
  const byUser = new Map<number, ShiftChange[]>();
  for (const c of changes) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  if (!byUser.size) return run;
  const [users, branches] = await Promise.all([
    db
      .select({ id: s.users.id, name: s.users.name, email: s.users.email })
      .from(s.users)
      .where(and(inArray(s.users.id, [...byUser.keys()]), eq(s.users.active, true), ne(s.users.role, "accountant"))),
    listBranches(db),
  ]);
  const manyBranches = branches.filter((b) => b.active).length > 1;
  let mail: { from: string } | null | undefined;
  for (const u of users) {
    const notice = shiftChangeNotice(byUser.get(u.id) ?? [], branch, { manyBranches });
    const push = await sendPush("shifts", { kind: "shifts", title: notice.title, body: notice.body, url: notice.url, tag: notice.tag }, { userIds: [u.id], ttl: 24 * 3600, urgency: "normal" });
    if (push.sent) {
      run.pushed++;
      continue;
    }
    // Bildirim açık cihaz yok: e-posta (ayar bir kez okunur)
    if (mail === undefined) {
      const settings = isEmailConfigured() ? await loadNotifySettings() : null;
      mail = settings?.emailEnabled ? { from: resolveFrom(settings.from) } : null;
    }
    if (!mail || !u.email) {
      run.skipped++;
      continue;
    }
    const msg = renderShiftChange({ name: u.name, title: notice.title, branchName: branch.name, week: notice.week, lines: notice.lines, url: notice.url }, todayTR());
    const idem = createHash("sha256").update(`vardiya:${u.id}:${branch.id}:${notice.lines.join("|")}`).digest("hex");
    const res = await sendEmail({ from: mail.from, to: [u.email], ...msg, idempotencyKey: `vardiya-${idem}` }, { attempts: 2 });
    if (res.ok) run.emailed++;
    else {
      run.failed++;
      console.error("[vardiya] e-posta gönderilemedi:", res.error);
    }
  }
  return run;
}

/** Gelecek haftanın planı yazılmamış şubeler (vardiyası planlanabilen şubeler; hatırlatma zamanı değilse boş) */
export async function missingNextWeekPlans(
  db: DB,
  now: Date = new Date(),
): Promise<{ monday: string; branches: { id: string; name: string }[]; manyBranches: boolean; physical: string[] }> {
  const monday = planReminderWeek(now);
  if (!monday) return { monday: "", branches: [], manyBranches: false, physical: [] };
  const physical = shiftBranches(await listBranches(db));
  const base = { monday, manyBranches: physical.length > 1, physical: physical.map((b) => b.id) };
  if (!physical.length) return { ...base, branches: [] };
  const rows = await db
    .select({ branchId: s.shifts.branchId, n: count() })
    .from(s.shifts)
    .where(and(gte(s.shifts.date, monday), lte(s.shifts.date, addDays(monday, 6))))
    .groupBy(s.shifts.branchId);
  const counts = new Map(rows.map((r) => [r.branchId, r.n]));
  return { ...base, branches: missingPlans(physical, counts).map((b) => ({ id: b.id, name: b.name })) };
}

/**
 * Günlük işin adımı (Cuma–Pazar sabahı; Perşembe akşamından sonra): gelecek haftanın planı yazılmamış her şube için
 * etkin yöneticilere push. Şube, hafta ve gün başına bir kez (notification_log anahtarı; iş iki kez çalışsa da). Hata
 * çağırana fırlar (günlük iş yakalar ve adıma yazar).
 */
export async function pushPlanReminders(db: DB = getDb(), now: Date = new Date()): Promise<{ status: "skip" | "sent"; tried: number; sent: number; failed: number }> {
  const { monday, branches, manyBranches } = await missingNextWeekPlans(db, now);
  if (!branches.length) return { status: "skip", tried: 0, sent: 0, failed: 0 };
  const admins = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.role, "admin"), eq(s.users.active, true)));
  if (!admins.length) return { status: "skip", tried: 0, sent: 0, failed: 0 };
  const today = todayTR(now);
  let tried = 0;
  let sent = 0;
  let failed = 0;
  for (const b of branches) {
    const text = planReminderText(b, monday, { manyBranches });
    const [claimed] = await db
      .insert(s.notificationLog)
      .values({ key: `vardiya-plan:${b.id}:${monday}:${today}`, channel: "push", subject: text.title, recipients: "(yöneticiler)", ok: true })
      .onConflictDoNothing()
      .returning({ key: s.notificationLog.key });
    if (!claimed) continue;
    tried++;
    const r = await sendPush("shifts", { kind: "shifts", title: text.title, body: text.body, url: text.href, tag: text.id }, { userIds: admins.map((a) => a.id), ttl: 12 * 3600, urgency: "normal" });
    sent += r.sent;
    failed += r.failed;
  }
  return { status: "sent", tried, sent, failed };
}
