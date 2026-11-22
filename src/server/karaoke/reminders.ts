import "server-only";

import { createHash } from "node:crypto";

import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";

import {
  guestFrom,
  REMINDER_CLAIM_MS,
  REMINDER_KEEP_MS,
  REMINDER_LOG_RECIPIENT,
  REMINDER_MAX_ATTEMPTS,
  REMINDER_SKIP,
  reminderLogKey,
  reminderStep,
  type ReminderStep,
} from "@/lib/karaoke/reminder";
import { DESK_CHANNEL, deskKindOfChannel, type KaraokeStatus } from "@/lib/karaoke/session";
import { getDb, schema as s } from "@/server/db";
import { renderKaraokeReminder } from "@/server/notify/karaoke-reminder-template";
import { isEmailConfigured, resolveFrom, sendEmail, sendFailureText } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { open, seal } from "@/server/secret-box";
import { siteUrl } from "@/server/site-link";

import { bumpKaraokeVersion } from "./board";
import { ensureKaraokeFresh } from "./sync";

/**
 * Misafire "bir gün kaldı" hatırlatma e-postası (kurallar src/lib/karaoke/reminder.ts, görünüm src/server/notify/
 * karaoke-reminder-template.ts; docs/KARAOKE.md › Hatırlatma e-postası). Elle ekle penceresinde e-posta yazılmış ve
 * rezervasyona bir günden fazla varsa adres `karaoke_reminders`'a şifreli yazılır; rezervasyondan 24 saat önce tek bir
 * e-posta gider ve adres silinir. Rezervasyon kaldırılınca satır hemen silinir; sitede iptal edilirse ya da zamanında
 * gönderilemezse (rezervasyona 2 saatten az kaldı) gönderilmeden adres silinir.
 *
 * Tetikleyiciler (hepsi aynı işi çağırır, e-posta bir kez gider): açık panel sekmesinin canlı yoklaması (/api/canli, en
 * çok 5 dakikada bir), saatlik iş (/api/cron/kontrol) ve sabah işi (/api/cron/gunluk). Gönderim satırı sahiplenerek
 * yapılır (iki tetikleyici aynı anda çalışsa da tek ileti) ve Resend'e rezervasyonun kimliği ve saatinden türeyen aynı
 * anahtarla gider (yarıda kalan deneme yinelenirse ikinci ileti çıkmaz).
 */

type Db = ReturnType<typeof getDb>;

/** Hatırlatmayı kurar (aynı rezervasyon yeniden yazılırsa baştan). Adres yalnız şifreli sütuna girer */
export async function scheduleKaraokeReminder(o: { externalId: string; email: string; createdBy: string }, db: Db = getDb()): Promise<void> {
  const emailSealed = seal(o.email, "karaoke-reminder");
  await db
    .insert(s.karaokeReminders)
    .values({ externalId: o.externalId, emailSealed, createdBy: o.createdBy })
    .onConflictDoUpdate({
      target: s.karaokeReminders.externalId,
      set: { emailSealed, status: "pending", detail: null, attempts: 0, claimedAt: null, doneAt: null, createdBy: o.createdBy, createdAt: new Date() },
    });
}

/** Rezervasyon panelden kaldırıldı: hatırlatma ve adres hemen silinir */
export async function cancelKaraokeReminder(externalId: string, db: Db = getDb()): Promise<void> {
  await db.delete(s.karaokeReminders).where(eq(s.karaokeReminders.externalId, externalId));
}

/**
 * Sitenin yanıtı okunamadıysa ya da zaman aşımına uğradıysa (satır yazılmış olabilir) rezervasyonun sitedeki kimliği:
 * eşitlemenin getirdiği, aynı saatlerdeki, `sinceMs`'ten sonra yazılmış, kaldırılmamış elle rezervasyon. Oda tek olduğu
 * için aynı saatlerde ikinci bir geçerli satır olamaz; yine de tek satır değilse null.
 */
export async function findDeskExternalId(start: Date, end: Date, sinceMs: number, db: Db = getDb()): Promise<string | null> {
  const rows = await db
    .select({ externalId: s.karaokeSessions.externalId, bookedAt: s.karaokeSessions.bookedAt })
    .from(s.karaokeSessions)
    .where(
      and(
        eq(s.karaokeSessions.source, "site"),
        eq(s.karaokeSessions.channel, DESK_CHANNEL),
        eq(s.karaokeSessions.startsAt, start),
        eq(s.karaokeSessions.endsAt, end),
        ne(s.karaokeSessions.status, "cancelled"),
      ),
    )
    .limit(2);
  const fresh = rows.filter((r) => r.externalId && r.bookedAt && r.bookedAt.getTime() >= sinceMs);
  return fresh.length === 1 ? fresh[0].externalId : null;
}

export interface ReminderRun {
  /** Hiçbir şey denenmediyse nedeni */
  skipped?: string;
  sent: number;
  failed: number;
  /** Gönderilmeden kapananlar (iptal, geç kalındı, bulunamadı) */
  dropped: number;
}

type Pending = {
  r: typeof s.karaokeReminders.$inferSelect;
  k: typeof s.karaokeSessions.$inferSelect | null;
  step: ReminderStep;
};

async function loadPending(db: Db, nowMs: number): Promise<Pending[]> {
  const rows = await db
    .select({ r: s.karaokeReminders, k: s.karaokeSessions })
    .from(s.karaokeReminders)
    .leftJoin(s.karaokeSessions, and(eq(s.karaokeSessions.source, "site"), eq(s.karaokeSessions.externalId, s.karaokeReminders.externalId)))
    .where(eq(s.karaokeReminders.status, "pending"));
  return rows.map(({ r, k }) => ({
    r,
    k,
    step: reminderStep(
      { createdAt: r.createdAt.getTime() },
      k ? { status: k.status as KaraokeStatus, startsAt: k.startsAt.getTime(), desk: deskKindOfChannel(k.channel) } : null,
      nowMs,
    ),
  }));
}

/** Hatırlatmayı kapatır (gönderildi, vazgeçildi, gönderilemedi): adres silinir, satır yalnız sonucuyla kalır */
async function finish(db: Db, externalId: string, status: "sent" | "skipped" | "failed", detail: string | null): Promise<void> {
  await db
    .update(s.karaokeReminders)
    .set({ status, detail: detail?.slice(0, 300) ?? null, emailSealed: null, claimedAt: null, doneAt: new Date() })
    .where(and(eq(s.karaokeReminders.externalId, externalId), eq(s.karaokeReminders.status, "pending")));
}

async function writeLog(db: Db, externalId: string, subject: string, ok: boolean, error: string | null): Promise<void> {
  try {
    await db
      .insert(s.notificationLog)
      .values({ key: reminderLogKey(externalId), subject, recipients: REMINDER_LOG_RECIPIENT, ok, error })
      .onConflictDoUpdate({ target: s.notificationLog.key, set: { subject, recipients: REMINDER_LOG_RECIPIENT, ok, error, sentAt: new Date() } });
  } catch (e) {
    console.error("[karaoke] hatırlatma günlüğü", e instanceof Error ? e.message : e);
  }
}

/**
 * Zamanı gelen hatırlatmaları gönderir. `deadlineAt` (Date.now() cinsinden) geçilmez: süre yetmeyen hatırlatma sonraki
 * çalışmaya kalır. Hata fırlatmaz sayılır ama çağıran yine de yakalamalı (veritabanı düşebilir).
 */
export async function runGuestReminders(now: Date = new Date(), deadlineAt: number = Date.now() + 20_000): Promise<ReminderRun> {
  const db = getDb();
  const nowMs = now.getTime();
  // Biten hatırlatmaların adressiz satırları birkaç gün sonra silinir
  await db.delete(s.karaokeReminders).where(and(ne(s.karaokeReminders.status, "pending"), lt(s.karaokeReminders.doneAt, new Date(nowMs - REMINDER_KEEP_MS))));
  let pending = await loadPending(db, nowMs);
  const run: ReminderRun = { sent: 0, failed: 0, dropped: 0 };
  if (!pending.length) return run;
  // Gönderilecek varsa kopya önce tazelenir: az önce sitede iptal edilen ya da saati değişen rezervasyona eski bilgiyle
  // e-posta gitmesin. Site yanıt vermiyorsa kopyayla devam edilir (iptali normalde ping saniyeler içinde getirir)
  if (pending.some((p) => p.step.action === "send")) {
    try {
      const r = await ensureKaraokeFresh({ maxAgeMs: 10 * 60_000 });
      if (r.status === "ok") pending = await loadPending(db, nowMs);
    } catch (e) {
      console.error("[karaoke] hatırlatma öncesi tazeleme", e instanceof Error ? e.message : e);
    }
  }
  let changed = false;
  let from: string | null = null;
  // Önce vazgeçilenler (iptal, geç kaldı, bulunamadı): adresleri e-posta kurulu olmasa da, süre yetmese de silinsin
  for (const p of pending) {
    if (p.step.action !== "skip") continue;
    await finish(db, p.r.externalId, "skipped", p.step.detail);
    run.dropped++;
    changed = true;
  }
  for (const p of pending) {
    const k = p.k;
    if (p.step.action !== "send" || !k) continue;
    if (!isEmailConfigured()) {
      run.skipped = "RESEND_API_KEY tanımlı değil";
      break;
    }
    // Süre yetmeyecekse başlanmaz (yarıda kesilen deneme iletiyi belirsiz bırakırdı)
    if (deadlineAt - Date.now() < 3_000) break;
    // Sahiplenme: aynı anda çalışan ikinci tetikleyici bu satırı almaz; yarıda kalan çalışmanınki 10 dakikada bayatlar
    const [claimed] = await db
      .update(s.karaokeReminders)
      .set({ claimedAt: new Date(), attempts: sql`${s.karaokeReminders.attempts} + 1` })
      .where(
        and(
          eq(s.karaokeReminders.externalId, p.r.externalId),
          eq(s.karaokeReminders.status, "pending"),
          or(isNull(s.karaokeReminders.claimedAt), lt(s.karaokeReminders.claimedAt, new Date(Date.now() - REMINDER_CLAIM_MS))),
        ),
      )
      .returning({ attempts: s.karaokeReminders.attempts, emailSealed: s.karaokeReminders.emailSealed });
    if (!claimed) continue;
    const email = claimed.emailSealed ? open(claimed.emailSealed, "karaoke-reminder") : null;
    if (!email) {
      await finish(db, p.r.externalId, "skipped", REMINDER_SKIP.unreadable);
      run.dropped++;
      changed = true;
      continue;
    }
    from ??= guestFrom(resolveFrom((await loadNotifySettings()).from));
    const msg = renderKaraokeReminder({
      firstName: k.customerName,
      date: k.date,
      startsAt: k.startsAt.getTime(),
      endsAt: k.endsAt.getTime(),
      guests: k.guests,
      paid: k.paymentStatus === "paid",
      nowMs,
      siteUrl: siteUrl(),
    });
    // Aynı rezervasyon ve saat için hep aynı anahtar: yinelenen deneme Resend'de ikinci iletiye dönüşmez
    const idem = createHash("sha256").update(`${p.r.externalId}:${k.startsAt.toISOString()}`).digest("hex");
    const res = await sendEmail({ from, to: [email], ...msg, idempotencyKey: `karaoke-hatirlatma-${idem}` }, { deadlineAt, attempts: 2 });
    if (res.ok) {
      await finish(db, p.r.externalId, "sent", null);
      await writeLog(db, p.r.externalId, msg.subject, true, null);
      run.sent++;
      changed = true;
      continue;
    }
    run.failed++;
    // Adres günlüğe yazılmaz: yalnız sağlayıcının hata metni
    console.error("[karaoke] hatırlatma e-postası gönderilemedi:", res.error);
    // Gitmiş olabilir (zaman aşımı): sahiplenme durur, 10 dakika sonra aynı anahtarla yeniden sorulur
    if (res.uncertain) continue;
    if (claimed.attempts >= REMINDER_MAX_ATTEMPTS) {
      await finish(db, p.r.externalId, "failed", `${REMINDER_SKIP.attempts} ${sendFailureText(res)}`);
      await writeLog(db, p.r.externalId, msg.subject, false, sendFailureText(res));
      changed = true;
    } else {
      // Kesin gitmedi: sonraki çalışma yeniden dener
      await db.update(s.karaokeReminders).set({ claimedAt: null }).where(and(eq(s.karaokeReminders.externalId, p.r.externalId), eq(s.karaokeReminders.status, "pending")));
    }
  }
  // Satırın rozeti değişti ("gönderildi" ya da kalktı): açık ekranlar bir sonraki kontrolde görsün
  if (changed) await bumpKaraokeVersion();
  return run;
}
