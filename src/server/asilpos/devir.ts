import "server-only";

import { and, eq } from "drizzle-orm";

import { ASILPOS_VERSION, posZSchema } from "@/lib/asilpos/day";
import { nextOpeningOf, type NextOpening } from "@/lib/asilpos/devir";
import type { AutoValues } from "@/lib/asilpos/gun-sonu";
import { checkAsilposRequest } from "@/lib/asilpos/request";
import { isAsilposDay } from "@/lib/asilpos/switch";
import { isCalendarDate } from "@/lib/reminders";
import { schema as s, type DB } from "@/server/db";

import { asilposBranchId, asilposSwitchDay } from "./branch";
import type { EndpointResult } from "./ingest";

/**
 * Kasa zinciri (Faz 3, 23 Kasım 2026; docs/ASILPOS.md › Kasa zinciri): AsilPOS'un şubesinin (Marina) bir gününün devri,
 * yani ertesi günün beklenen açılışı. `POST /api/pos/gun`'un 200 yanıtı (status.ts handlePosDay, gün yazıldıktan sonra)
 * ve imzalı `GET /api/panel/pos/devir?date=` aynı nesneyi verir. Kural saf: src/lib/asilpos/devir.ts nextOpeningOf.
 */

/**
 * Günün devri: kayıtlı Kasa raporu (varsa; AsilPOS'un elle değişmemiş otomatik raporunda sayım saklı gövdeden), yoksa
 * saklı gövdenin sayımı; gün sayılmıyorsa (geçiş gününden önce) ya da hiçbiri yoksa null. 200 yanıtında saklı gövde
 * gelen gövdedir (aynı işlemde az önce yazıldı): otomatik rapor yanıttan sonra yazıldığı için yeniden sayımın yanıtı
 * önceki gönderimin raporunu yankılamaz
 */
export async function asilposNextOpening(db: DB, date: string): Promise<NextOpening | null> {
  // AsilPOS'un şubesi kütükten (asilposBranchId); onun geçiş günü ayarın kendisidir (branchSwitchDay)
  const branchId = await asilposBranchId(db);
  const [switchDay, [day], [report], [auto]] = await Promise.all([
    asilposSwitchDay(db),
    db
      .select({ z: s.posDayReports.z })
      .from(s.posDayReports)
      .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)))
      .limit(1),
    db
      .select({ id: s.cashReports.id, countedCash: s.cashReports.countedCash, handedOver: s.cashReports.handedOver })
      .from(s.cashReports)
      .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
      .limit(1),
    db
      .select({ reportId: s.asilposDayEnds.reportId, autoValues: s.asilposDayEnds.autoValues })
      .from(s.asilposDayEnds)
      .where(and(eq(s.asilposDayEnds.date, date), eq(s.asilposDayEnds.branchId, branchId)))
      .limit(1),
  ]);
  const counted = isAsilposDay(date, switchDay);
  const z = day ? posZSchema.safeParse(day.z) : null;
  return nextOpeningOf({
    counted,
    z: z?.success ? z.data : null,
    report: report ?? null,
    auto: auto ? { reportId: auto.reportId, autoValues: (auto.autoValues as AutoValues | null) ?? null } : null,
  });
}

/**
 * `GET /api/panel/pos/devir?date=YYYY-MM-DD`'nin çekirdeği: yalnız AsilPOS'un imzasıyla (sorgu imzaya girer). 200
 * `{ version: 1, date, nextOpening }`, gün okunamazsa 400 `{ error: "invalid", field: "date" }`, 401, 503
 */
export async function servePosDevir(db: DB, input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date }): Promise<EndpointResult> {
  const check = checkAsilposRequest({ ...input, method: "GET", body: "", maxBytes: 0, now: (input.now ?? new Date()).getTime() });
  if (!check.ok) return { status: check.status, body: { error: check.error } };
  const date = input.url.searchParams.get("date") ?? "";
  if (!isCalendarDate(date)) return { status: 400, body: { error: "invalid", field: "date" } };
  return { status: 200, body: { version: ASILPOS_VERSION, date, nextOpening: await asilposNextOpening(db, date) } };
}
