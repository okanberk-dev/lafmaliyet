import "server-only";

import { createHash } from "node:crypto";

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { reminderPollDue } from "@/lib/karaoke/reminder";
import { trClock } from "@/lib/karaoke/session";
import {
  morningSessions,
  soonSessions,
  STAFF_SOON_LEAD_MS,
  staffMailRecipients,
  staffMorningKey,
  staffMorningWindow,
  staffSoonKey,
  type StaffMailSession,
} from "@/lib/karaoke/staff-mail";
import { karaokeBranchId } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { renderStaffMorning, renderStaffSoon } from "@/server/notify/karaoke-staff-template";
import { reachableUsers } from "@/server/notify/reachable";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";

import { loadSessions } from "./board";
import { runGuestReminders, type ReminderRun } from "./reminders";

/**
 * Karaoke rezervasyonunun personel e-postaları (kurallar src/lib/karaoke/staff-mail.ts, görünüm src/server/notify/
 * karaoke-staff-template.ts; docs/KARAOKE.md › Personel e-postaları): rezervasyon günü sabah o günün listesi, her
 * rezervasyondan 3 saat önce o rezervasyon. Ödemesi alınmamış rezervasyon kırmızıyla öne çıkar ("ücreti önden alın").
 *
 * Kontrol listesi hatırlatmalarının düzeni (src/server/notify/checklist-alerts.ts): her e-postanın anahtarı gönderimden
 * önce notification_log'a yazılarak sahiplenilir (iki tetikleyici aynı anda çalışsa da bir kez gider); her kişiye kendi
 * adresine ayrı e-posta (adresler birbirine görünmez); kimseye kesin olarak gidemeyen e-postanın sahiplenmesi bırakılır,
 * sonraki çalışma yeniden dener. E-posta Ayarlar'dan kapalıysa ya da Resend kurulu değilse hiçbir şey yazılmaz.
 */

export interface StaffMailRun {
  skipped?: string;
  /** Gönderilen e-postaların anahtarları */
  mails: string[];
  sent: number;
  failed: number;
}

const DAY_MS = 86_400_000;

/** O gün Vardiya planında çalışan olarak yazılmış hesaplar (karaoke odasının şubesi; şube özelliği) */
async function onShiftUserIds(date: string, branchId: string): Promise<number[]> {
  const rows = await getDb()
    .select({ userId: s.shifts.userId })
    .from(s.shifts)
    .where(and(eq(s.shifts.branchId, branchId), eq(s.shifts.date, date), eq(s.shifts.kind, "work"), isNotNull(s.shifts.userId)));
  return rows.flatMap((r) => (r.userId === null ? [] : [r.userId]));
}

export async function runStaffKaraokeMails(now: Date = new Date(), deadlineAt: number = Date.now() + 20_000): Promise<StaffMailRun> {
  const none = (skipped?: string): StaffMailRun => ({ ...(skipped ? { skipped } : {}), mails: [], sent: 0, failed: 0 });
  if (!isEmailConfigured()) return none("RESEND_API_KEY tanımlı değil");
  const nowMs = now.getTime();
  const today = trClock(nowMs).date;
  // Bugünün sonuna (Türkiye) ya da 3 saat sonrasına kadar başlayacak oturumlar (hangisi geçse)
  const dayEnd = Date.parse(`${today}T00:00:00Z`) - 3 * 3_600_000 + DAY_MS;
  const sessions: StaffMailSession[] = await loadSessions(now, new Date(Math.max(dayEnd, nowMs + STAFF_SOON_LEAD_MS) + 1), { admin: false });
  const morning = staffMorningWindow(nowMs) ? morningSessions(sessions, nowMs) : [];
  const soon = soonSessions(sessions, nowMs);
  if (!morning.length && !soon.length) return none();
  // Karaokenin şubesi şube özelliğinden (src/lib/branch-features.ts): hiçbir şubede açık değilse personele e-posta gitmez
  const karaokeAt = await karaokeBranchId();
  if (karaokeAt === null) return none("karaoke hiçbir şubede açık değil");
  const settings = await loadNotifySettings();
  if (!settings.emailEnabled) return none("e-posta hatırlatmaları kapalı");

  const db = getDb();
  const log = s.notificationLog;
  const morningKey = morning.length ? staffMorningKey(today) : null;
  const due = [...(morningKey ? [morningKey] : []), ...soon.map(staffSoonKey)];
  const claimed = new Set(
    (
      await db
        .insert(log)
        .values(due.map((key) => ({ key, subject: "Karaoke", recipients: "", ok: true })))
        .onConflictDoNothing()
        .returning({ key: log.key })
    ).map((r) => r.key),
  );
  if (!claimed.size) return none("e-postalar daha önce gönderildi");

  // Sabah listesi bu çalışmada gidiyorsa, listede olan rezervasyonun "3 saat kala"sı ayrıca gitmez (aynı anda iki e-posta
  // olmasın); anahtarı sahiplenilmiş kalır
  const inMorning = new Set(morningKey && claimed.has(morningKey) ? morning.map((m) => m.id) : []);
  const mails: { key: string; msg: { subject: string; html: string; text: string } }[] = [];
  if (morningKey && claimed.has(morningKey)) mails.push({ key: morningKey, msg: renderStaffMorning(morning, today) });
  const covered: string[] = [];
  for (const sn of soon) {
    const key = staffSoonKey(sn);
    if (!claimed.has(key)) continue;
    if (inMorning.has(sn.id)) covered.push(key);
    else mails.push({ key, msg: renderStaffSoon(sn, nowMs) });
  }
  if (covered.length) await db.update(log).set({ subject: "Karaoke · sabah listesinde bildirildi", recipients: "(sabah e-postası)" }).where(inArray(log.key, covered));
  if (!mails.length) return none();

  const [users, onShift] = await Promise.all([
    // Bildirim alabilen hesaplar: şubesi kapalı müdür (panele giremez) vardiyada yazılı olsa da e-posta almaz
    reachableUsers(db),
    onShiftUserIds(today, karaokeAt),
  ]);
  const recipients = staffMailRecipients(users, onShift, karaokeAt);
  const from = resolveFrom(settings.from);
  let sent = 0;
  let failed = 0;
  const done: string[] = [];
  for (const m of mails) {
    const delivered: string[] = [];
    let error: string | null = null;
    let unsure = false;
    for (const u of recipients) {
      const idem = createHash("sha256").update(`${m.key}:${u.id}`).digest("hex");
      const res = await sendEmail({ from, to: [u.email], ...m.msg, idempotencyKey: `karaoke-personel-${idem}` }, { deadlineAt, attempts: 2 });
      if (res.ok) {
        sent++;
        delivered.push(u.email);
      } else {
        failed++;
        error = res.error;
        if (res.uncertain) unsure = true;
        console.error("Karaoke personel e-postası gönderilemedi:", res.error);
      }
    }
    // Kimseye gidemedi ve kesin gitmedi: sahiplenme bırakılır, sonraki çalışma yeniden dener
    if (recipients.length && !delivered.length && error && !unsure) {
      await db.delete(log).where(eq(log.key, m.key));
      continue;
    }
    await db
      .update(log)
      .set({
        subject: m.msg.subject,
        recipients: delivered.length ? delivered.join(", ") : recipients.length ? recipients.map((u) => u.email).join(", ") : "(personel yok)",
        ok: !error,
        error,
      })
      .where(eq(log.key, m.key));
    done.push(m.key);
  }
  return { mails: done, sent, failed };
}

export interface KaraokeMailRun {
  guest: ReminderRun | { error: string };
  staff: StaffMailRun | { error: string };
}

/**
 * Karaoke e-postalarının tek girişi (canlı yoklama, saatlik iş, sabah işi): misafirin hatırlatması ve personelin
 * e-postaları. Biri bozulsa öteki çalışır; hata fırlatmaz.
 */
export async function runKaraokeMails(now: Date = new Date(), deadlineAt: number = Date.now() + 20_000): Promise<KaraokeMailRun> {
  const guest = await runGuestReminders(now, deadlineAt).catch((e: Error) => {
    console.error("[karaoke] misafir hatırlatması", e.message);
    return { error: e.message };
  });
  const staff = await runStaffKaraokeMails(now, deadlineAt).catch((e: Error) => {
    console.error("[karaoke] personel e-postası", e.message);
    return { error: e.message };
  });
  return { guest, staff };
}

/** Bu sunucu örneğinde canlı yoklamanın karaoke e-postalarını son tetiklediği an (ms) */
let lastPollRun = 0;

/**
 * Canlı yoklama (/api/canli) karaoke e-postalarını şimdi tetiklesin mi: e-posta kurulu ve bu örnekte son tetiklemeden 5
 * dakika geçti. Evetse anı hemen yazar (aynı anda gelen yoklamalar ikinci kez tetiklemez). Birden çok sunucu örneği aynı
 * anda çalışsa da her e-posta bir kez gider (sahiplenme veritabanında).
 */
export function claimKaraokeMailPoll(nowMs: number = Date.now()): boolean {
  if (!isEmailConfigured() || !reminderPollDue(nowMs, lastPollRun)) return false;
  lastPollRun = nowMs;
  return true;
}
