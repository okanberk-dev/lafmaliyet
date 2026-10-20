/**
 * Takvimin ödemeleri (saf; tests/hatirlaticilar-takvim.test.ts). Ekran (calendar-view.tsx) yalnız çizer.
 */

import { daysBetween, monthGrid, projectedOccurrences, statusFor, type ReminderRow, type UpcomingItem } from "@/lib/reminders";

/** Yaklaşan bir ödemenin tekil anahtarı (tekrarlı hatırlatıcı ödenince aynı ref yeni tarihle döner) */
export const itemKey = (i: UpcomingItem) => `${i.ref}|${i.dueDate}`;

/** Takvimdeki bir ödeme: gerçek öğe (ödenebilir) ya da tekrar eden hatırlatıcının ileriki (öngörülen) dönemi */
export interface CalendarEntry {
  key: string;
  date: string;
  item: UpcomingItem;
  /** Takvim öngörüsü: henüz sırası gelmedi, ödendi işaretlenemez */
  forecast: boolean;
  anchorDate?: string | null;
}

/**
 * Ay ızgarasındaki (baştaki ve sondaki komşu günler dahil) ödemeler:
 * - `actual`: listedeki ödemeler (45 gün) ve ufuktan sonraki şimdiki dönemler (laterReminderItems /
 *   laterInvoiceItems; yıllık, erken ödenmiş, ileri ertelenmiş hatırlatıcılar ve uzak vadeli faturalar),
 * - `forecast` açıksa tekrar edenlerin sıradaki dönemleri (gerçek öğesi olan gün tekrar yazılmaz).
 * Ay toplamı ve gün sayfası bu listeden hesaplanır.
 */
export function calendarEntries(month: string, today: string, actual: UpcomingItem[], reminders: ReminderRow[], forecast: boolean): CalendarEntry[] {
  const grid = monthGrid(month);
  const from = grid[0][0];
  const to = grid[grid.length - 1][6];
  const byId = new Map(reminders.map((r) => [r.id, r]));
  const inGrid = actual.filter((i) => i.dueDate >= from && i.dueDate <= to);
  const real: CalendarEntry[] = inGrid.map((i) => ({
    key: itemKey(i),
    date: i.dueDate,
    item: i,
    forecast: false,
    anchorDate: i.source === "reminder" ? byId.get(i.sourceId)?.anchorDate : null,
  }));
  const byDate = (a: CalendarEntry, b: CalendarEntry) => a.date.localeCompare(b.date) || a.item.title.localeCompare(b.item.title, "tr");
  if (!forecast) return real.sort(byDate);
  // Listede zaten olan dönemler (şimdiki ve gecikmişten sonraki "Sıradaki dönem") öngörü olarak tekrar yazılmaz
  const have = new Set(actual.filter((i) => i.source === "reminder").map((i) => `${i.sourceId}|${i.dueDate}`));
  const projected: CalendarEntry[] = projectedOccurrences(reminders, from, to, today)
    .filter((o) => !have.has(`${o.reminder.id}|${o.date}`))
    .map(({ reminder: r, date }) => {
      const daysLeft = daysBetween(today, date);
      return {
        key: `f:${r.id}|${date}`,
        date,
        forecast: true,
        anchorDate: r.anchorDate,
        item: {
          ref: `reminder:${r.id}@${date}`,
          projected: true,
          source: "reminder" as const,
          sourceId: r.id,
          kind: r.kind,
          title: r.title,
          detail: r.note,
          amount: r.amount,
          dueDate: date,
          daysLeft,
          status: statusFor(daysLeft, r.remindDaysBefore),
          remindDaysBefore: r.remindDaysBefore,
          repeat: r.repeat,
        },
      };
    });
  return [...real, ...projected].sort(byDate);
}

/** Ayın (ızgaradaki komşu günler hariç) ödeme sayısı ve toplamı: takvim başlığı */
export function monthTotals(entries: CalendarEntry[], month: string): { count: number; total: number } {
  const inMonth = entries.filter((e) => e.date.startsWith(month));
  return { count: inMonth.length, total: inMonth.reduce((a, e) => a + (e.item.amount ?? 0), 0) };
}
