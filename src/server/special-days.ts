import "server-only";

import { and, gte, lte } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";

import { businessDate } from "@/lib/cash-report";
import { addDays } from "@/lib/reminders";
import { SPECIAL_AHEAD_DAYS, SPECIAL_PAST_DAYS, type SpecialDay } from "@/lib/ozel-gun";

import { branchWhereWithShared } from "./branch-scope";
import { getDb, schema as s } from "./db";

/**
 * Özel günler (special_days): yöneticinin ve personelin girdiği takvim notları — derbi, AVM etkinliği, kampanya,
 * kafe kapalı. Satış tahmini 4 Kasım 2026'da kaldırıldı; özel günler kaldı, çünkü kapalı gün akışı, Bugün ekranı,
 * zil ve komisyon ekranı bunları okuyor. Eskiden tahminin penceresi olan sınırlar burada sürüyor.
 */

/* Sınırlar saf dosyada (src/lib/ozel-gun.ts): istemci bileşeni de okuyor, "server-only" oradan geçmez */
export { SPECIAL_AHEAD_DAYS, SPECIAL_MAX_AHEAD_DAYS, SPECIAL_MAX_SPAN_DAYS, SPECIAL_PAST_DAYS } from "@/lib/ozel-gun";

/** Listenin penceresi: bugünden SPECIAL_PAST_DAYS geriye, SPECIAL_AHEAD_DAYS ileriye */
export function specialWindow(today = businessDate()): { from: string; to: string } {
  return { from: addDays(today, -SPECIAL_PAST_DAYS), to: addDays(today, SPECIAL_AHEAD_DAYS) };
}

/**
 * Penceredeki özel günler (en yakın başta). `scope`: tek şube seçiliyken o şubenin ve işletme genelinin (şubesi boş)
 * günleri (şube kapsamı C P1-10; docs/SUBE.md › Özel günlerin şubesi)
 */
export async function loadSpecialDays(today = businessDate(), scope: BranchScope = ALL_BRANCHES): Promise<SpecialDay[]> {
  const { from, to } = specialWindow(today);
  const rows = await getDb()
    .select()
    .from(s.specialDays)
    .where(and(gte(s.specialDays.dateTo, from), lte(s.specialDays.dateFrom, to), branchWhereWithShared(s.specialDays.branchId, scope)))
    .orderBy(s.specialDays.dateFrom);
  return rows.map((r) => ({
    id: r.id,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    kind: r.kind,
    title: r.title,
    effect: r.effect,
    note: r.note,
    byStaff: r.byStaff,
    addedBy: r.byStaff ? r.createdByName : null,
    branchId: r.branchId,
  }));
}
