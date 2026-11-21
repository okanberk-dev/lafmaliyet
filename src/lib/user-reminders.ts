/**
 * Kişisel hatırlatıcıların saf hesapları (tests/hatirlaticilarim.test.ts): tekrar, tamamlama, erteleme, saatli
 * hatırlatmanın anı ve listedeki grubu. Tarihler "YYYY-MM-DD", saatler "HH:MM", hepsi Türkiye saatiyle (UTC+3, yaz
 * saati yok). İşletmenin ödeme hatırlatıcılarının yardımcılarını kullanır (src/lib/reminders.ts).
 */

import { addDays, addMonthsAnchored, dayLocative, todayTR } from "./reminders";

export type UserRepeat = "none" | "daily" | "weekly" | "monthly";

/**
 * Hatırlatma sesi (sahibin isteği, 4 Kasım 2026): bilgisayarda çalan uyarı.
 * "tek" bugünkü davranıştır (tek bir zil), "surekli" durdurulana kadar çalar
 * (karaoke alarmı gibi), "yok" sessizdir — bildirim yine çıkar.
 */
export type UserSound = "tek" | "surekli" | "yok";

export const USER_SOUNDS: { value: UserSound; label: string; hint: string }[] = [
  { value: "tek", label: "Tek ses", hint: "Bir kez çalar" },
  { value: "surekli", label: "Sürekli", hint: "Durdurana kadar çalar" },
  { value: "yok", label: "Sessiz", hint: "Yalnız bildirim" },
];

export const USER_REPEATS: { value: UserRepeat; label: string }[] = [
  { value: "none", label: "Bir kez" },
  { value: "daily", label: "Her gün" },
  { value: "weekly", label: "Her hafta" },
  { value: "monthly", label: "Her ay" },
];

export interface UserReminderLike {
  dueDate: string;
  dueTime: string | null;
  anchorDate: string;
  repeat: UserRepeat;
}

const TR_OFFSET_MS = 3 * 3_600_000;
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export const isTime = (v: string | null | undefined): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Tekrarın `from` gününden sonraki ilk tarihi: haftalıkta çapanın haftanın günü, aylıkta çapanın ayın günü korunur */
export function nextUserOccurrence(from: string, repeat: UserRepeat, anchorDate: string): string | null {
  switch (repeat) {
    case "none":
      return null;
    case "daily":
      return addDays(from, 1);
    case "weekly": {
      const shift = (weekday(anchorDate) - weekday(from) + 7) % 7 || 7;
      return addDays(from, shift);
    }
    case "monthly":
      return addMonthsAnchored(from, 1, Number(anchorDate.slice(8, 10)) || Number(from.slice(8, 10)));
  }
}

/**
 * "Tamamlandı" sonrası sıradaki tarih: tekrar eden hatırlatıcı bugünü geçene kadar ilerler (üç gün gecikmiş günlük iş
 * bugün yapıldıysa sıradaki yarındır); tek seferlikte null (kapanır).
 */
export function afterComplete(r: UserReminderLike, today: string): string | null {
  let next = nextUserOccurrence(r.dueDate, r.repeat, r.anchorDate);
  for (let guard = 0; next && next <= today && guard < 800; guard++) next = nextUserOccurrence(next, r.repeat, r.anchorDate);
  return next;
}

/**
 * "Tamamlandı"nın yazacağı: tekrar eden sıradaki döneme (afterComplete) serinin saatiyle geçer, tek seferlikte null
 * (kapanır). "1 saat sonra hatırlat" yalnız o dönemin saatini kaydırır; seri kendi saatine (`anchorTime`) döner.
 * Önceden erteleme saati serinin saati oluyordu: 09:00'daki günlük hatırlatma 09:02'de bir kez ertelenip yapılınca her
 * gün 10:05'te çalıyordu (denetim 21 Kasım #15). Saat çapası boş satırda (migration 0059 eskileri doldurdu; panel
 * dışından yazılmış kayıt) bugünkü saat kalır.
 */
export function completeTarget(r: UserReminderLike & { anchorTime: string | null }, today: string): { dueDate: string; dueTime: string | null } | null {
  const next = afterComplete(r, today);
  return next ? { dueDate: next, dueTime: r.anchorTime ?? r.dueTime } : null;
}

/**
 * Düzenlemede serinin saati: saat elle değiştiyse yeni saat; değişmediyse eskisi kalır. Ertelenmiş dönemin formu
 * (saat alanında erteleme saati) yalnız başlığı düzeltilip kaydedilince erteleme saati serinin saati olmasın.
 */
export function anchorTimeOnEdit(prev: { dueTime: string | null; anchorTime: string | null }, dueTime: string | null): string | null {
  return prev.dueTime !== dueTime ? dueTime : (prev.anchorTime ?? dueTime);
}

/** Saatli hatırlatmanın anı (epoch ms); saatsizse null */
export function dueInstant(r: Pick<UserReminderLike, "dueDate" | "dueTime">): number | null {
  if (!isTime(r.dueTime)) return null;
  const [y, m, d] = r.dueDate.split("-").map(Number);
  const [hh, mm] = r.dueTime.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - TR_OFFSET_MS;
}

/** Epoch ms → Türkiye saatiyle { date, time } */
export function trParts(ms: number): { date: string; time: string } {
  const iso = new Date(ms + TR_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export type PostponeBy = "hour" | "day";

/**
 * Ertele: "hour" bir saat sonrası (saat geçmişse şimdiden, 5 dakikaya yuvarlanır); "day" ertesi gün aynı saatte
 * (gecikmişse yarın). Yalnız bu dönem kayar: tekrarın çapası (gün ve saat) değişmez; sıradaki dönem çapaya göre
 * hesaplanır ve serinin saatiyle gelir (`completeTarget`).
 */
export function postponeTarget(r: Pick<UserReminderLike, "dueDate" | "dueTime">, by: PostponeBy, now: Date): { dueDate: string; dueTime: string | null } {
  const today = todayTR(now);
  if (by === "day") return { dueDate: addDays(r.dueDate > today ? r.dueDate : today, 1), dueTime: r.dueTime };
  const base = Math.max(now.getTime(), dueInstant(r) ?? now.getTime());
  const at = trParts(Math.ceil((base + 3_600_000) / 300_000) * 300_000);
  return { dueDate: at.date, dueTime: at.time };
}

export type DueGroup = "overdue" | "today" | "tomorrow" | "week" | "later";

export const DUE_GROUPS: { key: DueGroup; label: string }[] = [
  { key: "overdue", label: "Gecikti" },
  { key: "today", label: "Bugün" },
  { key: "tomorrow", label: "Yarın" },
  { key: "week", label: "Bu hafta" },
  { key: "later", label: "Daha sonra" },
];

/** Listedeki grubu: saati geçmiş bugünkü hatırlatma da "Gecikti" sayılır */
export function dueGroup(r: Pick<UserReminderLike, "dueDate" | "dueTime">, now: Date): DueGroup {
  const today = todayTR(now);
  if (r.dueDate < today) return "overdue";
  if (r.dueDate === today) {
    const at = dueInstant(r);
    return at !== null && at <= now.getTime() ? "overdue" : "today";
  }
  if (r.dueDate === addDays(today, 1)) return "tomorrow";
  if (r.dueDate <= addDays(today, 7)) return "week";
  return "later";
}

/** "Bugün 15:00", "Yarın", "Dün", "24 Eki Cuma 09:30" */
export function whenLabel(r: Pick<UserReminderLike, "dueDate" | "dueTime">, now: Date): string {
  const today = todayTR(now);
  const time = isTime(r.dueTime) ? ` ${r.dueTime}` : "";
  if (r.dueDate === today) return `Bugün${time}`;
  if (r.dueDate === addDays(today, 1)) return `Yarın${time}`;
  if (r.dueDate === addDays(today, -1)) return `Dün${time}`;
  const [, m, d] = r.dueDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${WEEKDAYS[weekday(r.dueDate)]}${time}`;
}

/** Tekrar rozeti: "Her gün", "Her hafta Salı", "Her ay 15'inde" */
export function userRepeatLabel(r: Pick<UserReminderLike, "repeat" | "anchorDate">): string | null {
  switch (r.repeat) {
    case "none":
      return null;
    case "daily":
      return "Her gün";
    case "weekly":
      return `Her hafta ${WEEKDAYS[weekday(r.anchorDate)]}`;
    case "monthly":
      return `Her ay ${dayLocative(Number(r.anchorDate.slice(8, 10)))}`;
  }
}

// ─── Saatinde açılır pencere ve köşe kartı (16 Kasım 2026, sahibin isteği) ──────────────────────────────────
// Saati gelen hatırlatma panel açık her cihazda (kasa bilgisayarı, telefon) ekranın ortasında açılır; kapatılınca
// "Yaptım" denene kadar köşede kart olarak durur (src/components/panel/live/reminder-alerts.tsx).

/** Canlı veride gelen hatırlatmanın uyarı için gereken alanları */
export interface AlertableReminder {
  id: number;
  dueDate: string;
  dueTime: string | null;
  active: boolean;
}

export const REMINDER_ALERT = {
  /** Vaktinden bu kadar sonrasına kadar ses de çalar (sekme arka plandaydı, bilgisayar uykudan yeni uyandı) */
  ringLateMs: 5 * 60_000,
  /** Bu cihazda hiç açılmamış, bu kadar yeni kaçan hatırlatma sessiz açılır pencereyle gelir; daha eskisi yalnız köşede */
  popupLateMs: 12 * 3_600_000,
  /** Bu kadar ilerideki hatırlatmanın zamanlayıcısı kurulur (sonrakiler canlı veri yenilenince) */
  aheadMs: 24 * 3_600_000,
} as const;

/** Bu cihazda çalan / açılan uyarının anahtarı: aynı dönem (tarih + saat) bir kez; ertelenen ya da ilerleyen yeniden çalar */
export const reminderAlertKey = (r: Pick<AlertableReminder, "id" | "dueDate" | "dueTime">) => `hatirlatici:${r.id}:${r.dueDate}:${r.dueTime}`;

/**
 * Uyarı motorunun planı (alert-center.tsx): `timers` vaktinde (ya da en çok `ringLateMs` geç) sesle açılacaklar,
 * `late` bu cihazda hiç açılmamış, yarım günden yeni kaçanlar (sessiz açılır pencere). Bu cihazda açılmış (`fired`),
 * saatsiz, kapanmış ve bir günden ilerideki hatırlatmalar plana girmez.
 */
export function planReminderAlerts<T extends AlertableReminder>(
  list: readonly T[],
  fired: ReadonlySet<string>,
  nowMs: number,
): { timers: { r: T; key: string; at: number }[]; late: { r: T; key: string }[] } {
  const timers: { r: T; key: string; at: number }[] = [];
  const late: { r: T; key: string }[] = [];
  for (const r of list) {
    const at = dueInstant(r);
    const key = reminderAlertKey(r);
    if (at === null || !r.active || fired.has(key) || at > nowMs + REMINDER_ALERT.aheadMs) continue;
    if (at >= nowMs - REMINDER_ALERT.ringLateMs) timers.push({ r, key, at });
    else if (at >= nowMs - REMINDER_ALERT.popupLateMs) late.push({ r, key });
  }
  return { timers, late };
}

/**
 * Köşe kartının listesi: saati gelmiş, yapılmamış (açık) saatli hatırlatmalar, en son geleni önce. Sunucunun verisinden
 * türer: sayfa yenilense de, başka ekrana geçilse de aynı kart; "Yaptım" (tekrar eden ilerler, tek seferlik kapanır) ya da
 * ertelemeyle kalkar.
 */
export function pendingReminders<T extends AlertableReminder>(list: readonly T[], nowMs: number): T[] {
  return list
    .map((r) => ({ r, at: dueInstant(r) }))
    .filter((x): x is { r: T; at: number } => x.r.active && x.at !== null && x.at <= nowMs)
    .sort((a, b) => b.at - a.at || b.r.id - a.r.id)
    .map((x) => x.r);
}

const ALARM_PREFIX = "hatirlatici:";

/**
 * Sürekli sesli hatırlatmanın alarm sahibi (src/components/panel/live/sounds.ts): alarm tektir, her sahip yalnız kendini
 * susturur; hatırlatmada "Yaptım" ya da "Sesi kes" karaoke alarmını kesmez
 */
export const reminderAlarm = (id: number) => `${ALARM_PREFIX}${id}`;

/** Alarmı çalan hatırlatmaların kimlikleri (sounds.ts › useAlarmOwners metninden: "hatirlatici:12,karaoke") */
export function ringingReminders(owners: string): number[] {
  return owners
    .split(",")
    .filter((o) => o.startsWith(ALARM_PREFIX))
    .map((o) => Number(o.slice(ALARM_PREFIX.length)))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** Saatinden bu yana geçen süre: "az önce", "12 dk önce", "2 saat önce", "3 gün önce" */
export function sinceLabel(atMs: number, nowMs: number): string {
  const min = Math.floor((nowMs - atMs) / 60_000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} saat önce`;
  return `${Math.floor(h / 24)} gün önce`;
}
