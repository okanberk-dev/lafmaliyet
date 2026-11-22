import "server-only";

import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { alertPollDue, alertReaches, alertSendInstant, checklistAlerts, remindableLists, type ChecklistAlert } from "@/lib/checklist-alerts";
import { checklistDay } from "@/lib/checklists";
import { loadAlertLists } from "@/server/checklists/store";
import { closedMarksOn, isClosedDay } from "@/server/closed-days";
import { getDb, schema as s } from "@/server/db";
import { photoStorage } from "@/server/storage/photos";

import { renderChecklistAlert } from "./checklist-alert-template";
import { isEmailConfigured, resolveFrom, sendEmail } from "./resend";
import { loadNotifySettings } from "./settings";

export interface ChecklistAlertRun {
  /** Gönderilecek uyarı yoksa ya da e-posta kapalıysa nedeni */
  skipped?: string;
  /** Bu çalışmada gönderilen uyarılar (anahtarları) */
  alerts: string[];
  /** Giden ve gidemeyen e-posta */
  sent: number;
  failed: number;
}

/**
 * Personele kontrol listesi hatırlatmaları (/api/cron/kontrol ve canlı yoklama; kurallar src/lib/checklist-alerts.ts).
 * Yalnız günde 4 bildirim saatinde (10:00, 14:00, 18:00, 22:00) ve saatin ilk saatinde çalışır, başka zaman hiçbir şey
 * göndermez (alertSendInstant); uyarılar o saatin anına göre bulunur. Bugünün listelerinden o anda gerekenler bulunur; her uyarının anahtarı gönderimden önce notification_log'a yazılarak
 * sahiplenilir (aynı anda iki çalışma aynı uyarıyı iki kez göndermesin). Her personele kendi adresine tek e-posta
 * gider (adresler birbirine görünmez); ona giden bütün uyarılar bir arada. Bir uyarı hiç kimseye kesin olarak
 * gidemediyse sahiplenme geri alınır, sonraki çalışma yeniden dener. E-posta Ayarlar'dan kapalıysa ya da Resend kurulu
 * değilse hiçbir şey yazılmaz. Gün kapalı işaretliyse (Özel günler › Kafe kapalı) yalnız o gün açılmış listeler
 * hatırlatılır (remindableLists).
 */
export async function runChecklistAlerts(clock: Date = new Date(), deadlineAt: number = Date.now() + 45_000): Promise<ChecklistAlertRun> {
  // Bildirim saati dışında (10:00 öncesi, 01:00 sonrası ve saatler arası) e-posta gitmez; saatin anına göre hesaplanır
  const now = alertSendInstant(clock);
  if (!now) return { skipped: "bildirim saati değil (10:00, 14:00, 18:00, 22:00)", alerts: [], sent: 0, failed: 0 };
  if (!isEmailConfigured()) return { skipped: "RESEND_API_KEY tanımlı değil", alerts: [], sent: 0, failed: 0 };
  const settings = await loadNotifySettings();
  if (!settings.emailEnabled) return { skipped: "e-posta hatırlatmaları kapalı", alerts: [], sent: 0, failed: 0 };
  const db = getDb();
  const day = checklistDay(now);
  const [loaded, closed, marks] = await Promise.all([loadAlertLists(db, day, { today: businessDate(now), photos: photoStorage().available }), isClosedDay(day, db), closedMarksOn(day, db)]);
  // Kapalı gün şubenin olabilir (docs/SUBE.md › Kapalı gün): işaretin kapsadığı listeler (işletme kapalıysa hepsi, şube
  // kapalıysa o şubenin listeleri) açılmadıysa susar; öteki şubenin ve bütün şubelerin listeleri hatırlatılır
  const shut = (l: (typeof loaded)[number]) => marks.all || (l.branchId !== null && marks.branches.has(l.branchId));
  const all = closed ? loaded.filter(shut) : loaded;
  const due = [...checklistAlerts(day, now, remindableLists(all, closed)), ...(closed ? checklistAlerts(day, now, loaded.filter((l) => !shut(l))) : [])];
  if (!due.length) return { skipped: closed ? "gönderilecek hatırlatma yok (kafe kapalı işaretli)" : "gönderilecek hatırlatma yok", alerts: [], sent: 0, failed: 0 };

  const log = s.notificationLog;
  const claimed = new Set(
    (
      await db
        .insert(log)
        .values(due.map((a) => ({ key: a.key, subject: a.listName, recipients: "", ok: true })))
        .onConflictDoNothing()
        .returning({ key: log.key })
    ).map((r) => r.key),
  );
  const alerts = due.filter((a) => claimed.has(a.key));
  if (!alerts.length) return { skipped: "hatırlatmalar daha önce gönderildi", alerts: [], sent: 0, failed: 0 };

  const staff = await db
    .select({ id: s.users.id, email: s.users.email, branchId: s.users.branchId })
    .from(s.users)
    .where(and(eq(s.users.active, true), eq(s.users.role, "staff")));
  const from = resolveFrom(settings.from);
  const delivered = new Map<string, string[]>(alerts.map((a) => [a.key, []]));
  const attempted = new Map<string, string[]>(alerts.map((a) => [a.key, []]));
  const unsure = new Set<string>();
  const errors = new Map<string, string>();
  let sent = 0;
  let failed = 0;
  for (const u of staff) {
    const mine: ChecklistAlert[] = alerts.filter((a) => alertReaches(a.branchId, u));
    if (!mine.length || !u.email) continue;
    for (const a of mine) attempted.get(a.key)!.push(u.email);
    const msg = renderChecklistAlert(mine, day);
    const idem = createHash("sha256").update(`${mine.map((a) => a.key).join("|")}:${u.id}`).digest("hex");
    const res = await sendEmail({ from, to: [u.email], ...msg, idempotencyKey: `kontrol-${idem}` }, { deadlineAt, attempts: 2 });
    if (res.ok) {
      sent++;
      for (const a of mine) delivered.get(a.key)!.push(u.email);
    } else {
      failed++;
      console.error("Kontrol listesi hatırlatması gönderilemedi:", res.error);
      for (const a of mine) {
        errors.set(a.key, res.error);
        if (res.uncertain) unsure.add(a.key);
      }
    }
  }
  // Kimseye gidemeyen (ve belki de gitmemiş) uyarının sahiplenmesi bırakılır: sonraki çalışma yeniden dener
  const retry = alerts.filter((a) => !delivered.get(a.key)!.length && errors.has(a.key) && !unsure.has(a.key)).map((a) => a.key);
  if (retry.length) await db.delete(log).where(inArray(log.key, retry));
  for (const a of alerts) {
    if (retry.includes(a.key)) continue;
    // Gidenler; hiçbiri gitmediyse denenenler (hata satırında kime gidemediği görünsün)
    const to = delivered.get(a.key)!.length ? delivered.get(a.key)! : attempted.get(a.key)!;
    await db
      .update(log)
      .set({ subject: renderChecklistAlert([a], day).subject, recipients: to.join(", ") || "(personel yok)", ok: !errors.has(a.key), error: errors.get(a.key) ?? null })
      .where(eq(log.key, a.key));
  }
  return { alerts: alerts.map((a) => a.key), sent, failed };
}

/** Bu sunucu örneğinde canlı yoklamanın hatırlatma işini son tetiklediği an (ms) */
let lastPollRun = 0;

/**
 * Canlı yoklama (/api/canli) hatırlatma işini şimdi tetiklesin mi: bildirim saatinin ilk saatinde, e-posta kurulu ve bu örnekte son tetiklemeden
 * 5 dakika geçti (ALERT_POLL_GAP_MS). Evetse anı hemen yazar: aynı anda gelen yoklamalar ikinci kez tetiklemez. Birden
 * çok sunucu örneği aynı anda çalışırsa da her uyarı bir kez gider (notification_log'da sahiplenme).
 */
export function claimChecklistAlertPoll(nowMs: number = Date.now()): boolean {
  // Bildirim saati dışında yoklama işi hiç başlatmaz (veritabanına da gidilmez)
  if (!alertSendInstant(new Date(nowMs)) || !isEmailConfigured() || !alertPollDue(nowMs, lastPollRun)) return false;
  lastPollRun = nowMs;
  return true;
}
