import { addDays } from "@/lib/reminders";

import { dayLabel, isBlock, trClock, type DeskKind, type KaraokeStatus } from "./session";

/**
 * Elle eklenen karaoke rezervasyonunun "bir gün kaldı" hatırlatma e-postası: saf kurallar ve metinler (sunucu, ekran ve
 * testler paylaşır; tests/karaoke-hatirlatma.test.ts). Operatör, 22 Kasım 2026: "elle karaoke eklediğimizde kişinin
 * mailine 1 gün kalan mail hatırlatması girsin". Elle ekle penceresinde e-posta yazılmışsa ve rezervasyona bir günden
 * fazla varsa panel adresi şifreli saklar, rezervasyondan 24 saat önce misafire tek bir hatırlatma gönderir ve adresi
 * siler. Gönderen iş src/server/karaoke/reminders.ts, e-postanın görünümü src/server/notify/karaoke-reminder-template.ts;
 * ayrıntı docs/KARAOKE.md › Hatırlatma e-postası.
 */

/** Hatırlatma rezervasyonun başlangıcından bu kadar önce gider */
export const REMINDER_LEAD_MS = 24 * 3_600_000;
/** Başlangıca bundan az kaldıysa artık gönderilmez (tetikleyiciler saatlerce çalışmadıysa: geç hatırlatma işe yaramaz) */
export const REMINDER_MIN_LEAD_MS = 2 * 3_600_000;
/** Rezervasyonu panelin kopyasında hiç görünmeyen hatırlatma bu kadar bekler, sonra vazgeçilir */
export const REMINDER_ORPHAN_MS = 24 * 3_600_000;
/** Kesin olarak gönderilemeyen e-posta en çok bu kadar denenir */
export const REMINDER_MAX_ATTEMPTS = 5;
/** Gönderimi sahiplenen çalışma yarıda kesildiyse sahiplenme bu kadar sonra bayatlar (başka çalışma alır) */
export const REMINDER_CLAIM_MS = 10 * 60_000;
/** Biten hatırlatmanın (adressiz) satırı bu kadar sonra silinir */
export const REMINDER_KEEP_MS = 3 * 86_400_000;
/** Açık panel sekmesinin canlı yoklaması hatırlatma işini sunucu örneği başına en çok bu sıklıkla tetikler */
export const REMINDER_POLL_GAP_MS = 5 * 60_000;

/** Ekrana giden durum: `at` bekleyende gönderileceği, gönderilmişte gönderildiği an (ISO) */
export interface SessionReminder {
  state: "pending" | "sent";
  at: string;
}

/**
 * Elle eklenirken hatırlatma kurulur mu: rezervasyona bir günden fazla varsa. Daha yakın rezervasyonda sitenin onay
 * e-postası zaten son 24 saatte gitmiştir; ikinci bir e-posta gönderilmez.
 */
export function reminderPlanned(startMs: number, nowMs: number): boolean {
  return startMs - nowMs > REMINDER_LEAD_MS;
}

/** Hatırlatmanın gideceği an */
export const reminderDueAt = (startMs: number) => startMs - REMINDER_LEAD_MS;

/** Ekrandaki rozetin verisi (hatırlatma satırından): bekleyende gönderileceği, gönderilmişte gönderildiği an; yoksa null */
export function sessionReminder(status: string | null | undefined, doneAt: Date | null | undefined, startsAtMs: number, sessionStatus: KaraokeStatus): SessionReminder | null {
  if (sessionStatus === "cancelled") return null;
  if (status === "pending") return { state: "pending", at: new Date(reminderDueAt(startsAtMs)).toISOString() };
  if (status === "sent" && doneAt) return { state: "sent", at: doneAt.toISOString() };
  return null;
}

export type ReminderStep = { action: "wait" } | { action: "send" } | { action: "skip"; detail: string };

export const REMINDER_SKIP = {
  cancelled: "Rezervasyon iptal edildi; hatırlatma gönderilmedi.",
  block: "Saatler kapatılmış; hatırlatma gönderilmedi.",
  gone: "Rezervasyon sitede bulunamadı; hatırlatma gönderilmedi.",
  late: "Hatırlatma zamanında gönderilemedi; rezervasyona 2 saatten az kaldığı için gönderilmedi.",
  attempts: "E-posta gönderilemedi; hatırlatmadan vazgeçildi.",
  unreadable: "Adres okunamadı (AUTH_SECRET değişmiş olabilir); hatırlatma gönderilmedi.",
} as const;

/**
 * Bekleyen hatırlatma için şimdi ne yapılır. Saat ve durum her çalışmada panelin kopyasından okunur: sitede saati
 * değişen rezervasyonun hatırlatması yeni saate göre gider, iptal edilenin hiç gitmez. Rezervasyon kopyada yoksa (henüz
 * eşitlenmedi ya da sitede silindi) bir gün beklenir, sonra vazgeçilir.
 */
export function reminderStep(
  r: { createdAt: number },
  session: { status: KaraokeStatus; startsAt: number; desk: DeskKind | null } | null,
  nowMs: number,
): ReminderStep {
  if (!session) return nowMs - r.createdAt > REMINDER_ORPHAN_MS ? { action: "skip", detail: REMINDER_SKIP.gone } : { action: "wait" };
  if (session.status === "cancelled") return { action: "skip", detail: REMINDER_SKIP.cancelled };
  if (isBlock(session)) return { action: "skip", detail: REMINDER_SKIP.block };
  if (nowMs >= session.startsAt - REMINDER_MIN_LEAD_MS) return { action: "skip", detail: REMINDER_SKIP.late };
  return nowMs >= reminderDueAt(session.startsAt) ? { action: "send" } : { action: "wait" };
}

/** E-postanın sözü gönderildiği güne göre: rezervasyon yarınsa "Yarın", bugünse (geç gönderim) "Bugün", değilse tarih */
export function reminderDay(date: string, nowMs: number): "tomorrow" | "today" | "later" {
  const today = trClock(nowMs).date;
  if (date === today) return "today";
  return date === addDays(today, 1) ? "tomorrow" : "later";
}

/** Canlı yoklama hatırlatma işini şimdi tetiklesin mi (son tetiklemeden beri yeterince geçti mi) */
export function reminderPollDue(nowMs: number, lastRunMs: number): boolean {
  // Saat geri alındıysa da (nowMs < lastRunMs) tetiklenir: iş bir daha hiç çalışmaz kalmasın
  return nowMs - lastRunMs >= REMINDER_POLL_GAP_MS || nowMs < lastRunMs;
}

/**
 * Misafire giden e-postanın göndereni: adres panelin gönderen ayarındaki (Resend'de doğrulanmış) adres, görünen ad
 * "L'Affogato" (panelin "L'Affogato Panel"i misafire anlamsız). Adres okunamazsa ayar olduğu gibi kullanılır.
 */
export function guestFrom(from: string): string {
  const address = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from)?.[1] ?? (/^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(from)?.[1] || null);
  return address ? `L'Affogato <${address}>` : from;
}

/** Bildirim günlüğüne (notification_log) alıcı olarak yazılan söz: misafirin adresi günlüğe girmez */
export const REMINDER_LOG_RECIPIENT = "misafir (adres saklanmaz)";
/** Bildirim günlüğündeki anahtar */
export const reminderLogKey = (externalId: string) => `karaoke-hatirlatma:${externalId}`;

// ---------------------------------------------------------------- Ekran metinleri

/** Elle ekle penceresinde e-posta alanının ipucu: hatırlatma gidecek mi (rezervasyona bir günden fazla var mı) */
export function reminderHint(startMs: number, nowMs: number): string {
  return reminderPlanned(startMs, nowMs)
    ? "İsteğe bağlı. Yazılırsa misafire onay e-postası, rezervasyondan bir gün önce de hatırlatma e-postası gider."
    : "İsteğe bağlı. Yazılırsa misafire onay e-postası gider (rezervasyona bir günden az kaldığı için ayrıca hatırlatma gitmez).";
}

/** Listedeki satırın rozeti: "Hatırlatma e-postası · Yarın 20:00" ya da "Hatırlatma e-postası gönderildi" */
export function reminderBadge(r: SessionReminder, nowMs: number): string {
  if (r.state === "sent") return "Hatırlatma e-postası gönderildi";
  const at = Date.parse(r.at);
  // Zamanı geldi ama henüz gönderilmedi (tetikleyici birkaç dakika içinde çalışır)
  if (!Number.isFinite(at) || at <= nowMs) return "Hatırlatma e-postası sırada";
  const c = trClock(at);
  return `Hatırlatma e-postası · ${dayLabel(c.date, nowMs)} ${c.time}`;
}

/** Eklemenin bildirimine eklenen cümle (e-posta yazıldıysa) */
export function reminderToast(planned: boolean): string {
  return planned ? " Misafire onay e-postası gider; rezervasyondan bir gün önce hatırlatma e-postası da gönderilir." : " Misafire onay e-postası gider.";
}
