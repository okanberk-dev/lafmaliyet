import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";

import type { DayFacts } from "@/app/panel/bugun/logic";
import { addDays } from "@/lib/reminders";
import type { CurrentUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

/*
 * Kapalı gün (plan docs/planlar/personel-yetki.md §2.9): Dalga 9'un özel günlerindeki `kapali` satırı ve personelin
 * "Dün kafe kapalıydı" bildirimi (staff_requests, tür `kapali-gun`). Kasa grubunun modülü; operasyon grubu
 * closedDayRefusal'ı çağırır (zayi). Kapalı günlerin okuyucusu geç kasa raporunda kullanılır (girilmemiş günler
 * listesinden düşer, personel o güne geç rapor açamaz); bildirim ve onay kuralı maddesiyle (§2.9) gelir, o zamana kadar
 * closedDayRefusal hiçbir yazımı reddetmez ve Bugün'e olgu vermez.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Kapalı işaretli günler (özel günlerin `kapali` satırları), [from, to] içinde, artan sırayla, tekrarsız */
export async function closedDaysBetween(from: string, to: string, db: Db | Tx = getDb()): Promise<string[]> {
  if (from > to) return [];
  const rows = await db
    .select({ from: s.specialDays.dateFrom, to: s.specialDays.dateTo })
    .from(s.specialDays)
    .where(and(eq(s.specialDays.kind, "kapali"), lte(s.specialDays.dateFrom, to), gte(s.specialDays.dateTo, from)));
  const days = new Set<string>();
  for (const r of rows) {
    for (let d = r.from < from ? from : r.from; d <= r.to && d <= to; d = addDays(d, 1)) days.add(d);
  }
  return [...days].sort();
}

/** Bu gün kapalı işaretli mi (tek gün) */
export async function isClosedDay(day: string, db: Db | Tx = getDb()): Promise<boolean> {
  return (await closedDaysBetween(day, day, db)).length > 0;
}

/**
 * Personelin yazımı (kasadan çıkan, zayi / ikram) onaylı kapalı güne düşüyorsa nedeni; yönetici ve açık gün null
 */
export async function closedDayRefusal(date: string, role: "admin" | "staff", db: Db | Tx = getDb()): Promise<string | null> {
  void date;
  void role;
  void db;
  return null;
}

/** Bugün'ün olgusu: dün kafe kapalı mıydı (onaylı ya da personelin bildirdiği, onay bekleyen); yoksa null */
export async function closedYesterday(user: CurrentUser, now: Date): Promise<DayFacts["closed"]> {
  void user;
  void now;
  return null;
}
