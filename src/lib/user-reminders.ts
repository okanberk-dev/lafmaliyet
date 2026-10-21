/**
 * Kişisel hatırlatıcıların saf hesapları (tests/hatirlaticilarim.test.ts): tekrar, tamamlama, erteleme, saatli
 * hatırlatmanın anı ve listedeki grubu. Tarihler "YYYY-MM-DD", saatler "HH:MM", hepsi Türkiye saatiyle (UTC+3, yaz
 * saati yok). İşletmenin ödeme hatırlatıcılarının yardımcılarını kullanır (src/lib/reminders.ts).
 */

import { addDays, addMonthsAnchored, dayLocative, todayTR } from "./reminders";

export type UserRepeat = "none" | "daily" | "weekly" | "monthly";

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
 * (gecikmişse yarın). Tekrarın çapası değişmez; sıradaki dönem çapaya göre hesaplanır.
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
