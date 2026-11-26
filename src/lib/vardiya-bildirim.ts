/**
 * Vardiya bildirimlerinin saf kuralları (docs/VARDIYA.md › Bildirimler; Dalga 2, 25 Kasım 2026). Sahibin isteği:
 * "Vardiyası değişen personele bildirim gitsin. Gelecek haftanın planı yazılmadıysa hatırlatılsın."
 *
 * - Değişiklik: kaydedilmiş bir kutu değişince ya da silinince, ya da kişinin o haftada zaten kayıtlı vardiyası varken
 *   yeni bir gün eklenince, yalnız o kişiye "Vardiyanız değişti: 2 Aralık Salı: 10:00–18:00 → 12:00–20:00". Haftanın
 *   ilk yazımı (kişinin o haftada hiç kaydı yokken) bildirim değildir: plan parça parça yazılırken herkese ileti gitmesin.
 *   Geçmiş günler (bugünden önce) ve hesabı olmayan çalışan bildirilmez; kaydı yapan kendine bildirim almaz.
 * - Hatırlatma: Perşembe 18:00'den Pazar sonuna kadar gelecek haftanın planı bir şubede hiç yazılmadıysa yöneticiye.
 *
 * Gönderim src/server/vardiya/notify.ts (push, yoksa e-posta); testler tests/vardiya-bildirim.test.ts.
 */

import { addDays } from "./reminders";
import { cellKey, dayLong, formatShiftCell, refUserId, sameCell, weekLabel, weekStart, type ShiftCell, type ShiftEntry } from "./vardiya";

/** Bir kişinin bir günündeki değişiklik */
export interface ShiftChange {
  userId: number;
  date: string;
  /** Kayıttan önceki hücre (yeni eklenen günde null) */
  before: ShiftCell | null;
  /** Kayıttan sonraki hücre (silinen günde null) */
  after: ShiftCell | null;
}

/**
 * Kaydın kişilere bildirilecek değişiklikleri (kişi, sonra gün sırasıyla). `before`: kayıttan önce haftanın kayıtlı
 * hücreleri (aynı şube); `upserts` ve `deletes`: kaydın yazdıkları ve sildikleri (weekSaveDiff). Ad değişikliği (aynı
 * hücre) bildirim değildir.
 */
export function shiftChanges(o: {
  before: readonly ShiftEntry[];
  upserts: readonly ShiftEntry[];
  deletes: readonly { date: string; ref: string }[];
  today: string;
  /** Kaydı yapan (kendi değişikliğini bildirmez) */
  by?: number | null;
}): ShiftChange[] {
  const prev = new Map(o.before.map((e) => [cellKey(e.date, e.ref), e]));
  const planned = new Set(o.before.map((e) => e.ref));
  const out: ShiftChange[] = [];
  const add = (ref: string, date: string, before: ShiftCell | null, after: ShiftCell | null) => {
    const userId = refUserId(ref);
    if (userId === null || userId === o.by || date < o.today) return;
    out.push({ userId, date, before, after });
  };
  for (const u of o.upserts) {
    const was = prev.get(cellKey(u.date, u.ref));
    if (was && sameCell(was.cell, u.cell)) continue;
    // Haftanın ilk yazımı değişiklik sayılmaz: kişinin bu haftada kaydı yokken eklenen gün
    if (!was && !planned.has(u.ref)) continue;
    add(u.ref, u.date, was?.cell ?? null, u.cell);
  }
  for (const d of o.deletes) {
    const was = prev.get(cellKey(d.date, d.ref));
    if (was) add(d.ref, d.date, was.cell, null);
  }
  return out.sort((a, b) => a.userId - b.userId || a.date.localeCompare(b.date));
}

/** Haftanın günü (0 = Pazartesi) */
const dayIndex = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** "2 Aralık Salı: 10:00–18:00 → 12:00–20:00", "… : 10:00–18:00 (yeni)", "… : 10:00–18:00 kaldırıldı" */
export function shiftChangeLine(c: Pick<ShiftChange, "date" | "before" | "after">): string {
  const day = dayLong(c.date, dayIndex(c.date));
  if (!c.before) return `${day}: ${formatShiftCell(c.after)} (yeni)`;
  if (!c.after) return `${day}: ${formatShiftCell(c.before)} kaldırıldı`;
  return `${day}: ${formatShiftCell(c.before)} → ${formatShiftCell(c.after)}`;
}

/** Bildirimde en çok bu kadar gün yazılır (kalanı "ve 2 gün daha") */
export const SHIFT_NOTICE_LINES = 3;

/** Kişiye giden bildirimin metni ve adresi (planın haftası ve şubesi açılır) */
export function shiftChangeNotice(changes: readonly Pick<ShiftChange, "date" | "before" | "after">[], branch: { id: string; name: string }, opts: { manyBranches: boolean }) {
  const lines = changes.map(shiftChangeLine);
  const shown = lines.slice(0, SHIFT_NOTICE_LINES);
  const more = lines.length - shown.length;
  const monday = weekStart(changes[0]?.date ?? "");
  return {
    title: opts.manyBranches ? `Vardiyanız değişti · ${branch.name}` : "Vardiyanız değişti",
    body: [...shown, ...(more > 0 ? [`ve ${more} gün daha`] : [])].join(" · "),
    lines,
    url: `/panel/vardiya?hafta=${monday}&sube=${encodeURIComponent(branch.id)}`,
    tag: `vardiya-${branch.id}-${monday}`,
    week: weekLabel(monday),
  };
}

// ---------------------------------------------------------------- Gelecek haftanın planı

/** Hatırlatma Perşembe bu saatten (Türkiye) sonra başlar: "Perşembe akşamına kadar" */
export const PLAN_REMINDER_HOUR = 18;

/**
 * Gelecek haftanın planı için hatırlatma zamanı geldiyse o haftanın Pazartesi'si: Perşembe 18:00'den (Türkiye) Pazar
 * sonuna kadar; öteki günler null. Türkiye UTC+3 (yaz saati yok).
 */
export function planReminderWeek(now: Date): string | null {
  const tr = new Date(now.getTime() + 3 * 3_600_000);
  const date = tr.toISOString().slice(0, 10);
  const dow = dayIndex(date);
  const due = dow > 3 || (dow === 3 && tr.getUTCHours() >= PLAN_REMINDER_HOUR);
  return due ? addDays(weekStart(date), 7) : null;
}

/** Planı hiç yazılmamış şubeler (`counts`: şube → gelecek haftanın kayıtlı kutu sayısı) */
export function missingPlans<T extends { id: string }>(branches: readonly T[], counts: ReadonlyMap<string, number>): T[] {
  return branches.filter((b) => !(counts.get(b.id) ?? 0));
}

/** Yöneticinin zil satırı ve günlük işin bildirimi: "Gelecek haftanın vardiyası yazılmadı" (birden çok şubede adıyla) */
export function planReminderText(branch: { id: string; name: string }, monday: string, opts: { manyBranches: boolean }) {
  return {
    title: opts.manyBranches ? `${branch.name}: gelecek haftanın vardiyası yazılmadı` : "Gelecek haftanın vardiyası yazılmadı",
    body: `${weekLabel(monday)} planı boş. Personel haftasını görsün diye Perşembe akşamına kadar yazılması iyi olur.`,
    href: `/panel/vardiya?hafta=${monday}&sube=${encodeURIComponent(branch.id)}`,
    id: `vardiya-plan-${branch.id}-${monday}`,
  };
}
