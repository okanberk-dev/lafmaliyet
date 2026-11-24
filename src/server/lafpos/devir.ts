import "server-only";

import { and, eq } from "drizzle-orm";

import { readLafposSwitchDay } from "@/lib/constants";
import { LAFPOS_VERSION, posZSchema } from "@/lib/lafpos/day";
import { nextOpeningOf, type NextOpening } from "@/lib/lafpos/devir";
import type { AutoValues } from "@/lib/lafpos/gun-sonu";
import { checkLafposRequest } from "@/lib/lafpos/request";
import { branchSwitchDay, isLafposDay, LAFPOS_BRANCH_ID, LAFPOS_SWITCH_KEY } from "@/lib/lafpos/switch";
import { isCalendarDate } from "@/lib/reminders";
import { schema as s, type DB } from "@/server/db";

import type { EndpointResult } from "./ingest";

/**
 * Kasa zinciri (Faz 3, 23 Kasım 2026; docs/LAFPOS.md › Kasa zinciri): LafPOS'un şubesinin (Marina) bir gününün devri,
 * yani ertesi günün beklenen açılışı. `POST /api/pos/gun`'un 200 yanıtı (status.ts handlePosDay, gün yazıldıktan sonra)
 * ve imzalı `GET /api/panel/pos/devir?date=` aynı nesneyi verir. Kural saf: src/lib/lafpos/devir.ts nextOpeningOf.
 */

/**
 * Günün devri: kayıtlı Kasa raporu (varsa; LafPOS'un elle değişmemiş otomatik raporunda sayım saklı gövdeden), yoksa
 * saklı gövdenin sayımı; gün sayılmıyorsa (geçiş gününden önce) ya da hiçbiri yoksa null. 200 yanıtında saklı gövde
 * gelen gövdedir (aynı işlemde az önce yazıldı): otomatik rapor yanıttan sonra yazıldığı için yeniden sayımın yanıtı
 * önceki gönderimin raporunu yankılamaz
 */
export async function lafposNextOpening(db: DB, date: string): Promise<NextOpening | null> {
  const branchId = LAFPOS_BRANCH_ID;
  const [[setting], [day], [report], [auto]] = await Promise.all([
    db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1),
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
      .select({ reportId: s.lafposDayEnds.reportId, autoValues: s.lafposDayEnds.autoValues })
      .from(s.lafposDayEnds)
      .where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, branchId)))
      .limit(1),
  ]);
  const counted = isLafposDay(date, branchSwitchDay(readLafposSwitchDay(setting?.value), branchId));
  const z = day ? posZSchema.safeParse(day.z) : null;
  return nextOpeningOf({
    counted,
    z: z?.success ? z.data : null,
    report: report ?? null,
    auto: auto ? { reportId: auto.reportId, autoValues: (auto.autoValues as AutoValues | null) ?? null } : null,
  });
}

/**
 * `GET /api/panel/pos/devir?date=YYYY-MM-DD`'nin çekirdeği: yalnız LafPOS'un imzasıyla (sorgu imzaya girer). 200
 * `{ version: 1, date, nextOpening }`, gün okunamazsa 400 `{ error: "invalid", field: "date" }`, 401, 503
 */
export async function servePosDevir(db: DB, input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date }): Promise<EndpointResult> {
  const check = checkLafposRequest({ ...input, method: "GET", body: "", maxBytes: 0, now: (input.now ?? new Date()).getTime() });
  if (!check.ok) return { status: check.status, body: { error: check.error } };
  const date = input.url.searchParams.get("date") ?? "";
  if (!isCalendarDate(date)) return { status: 400, body: { error: "invalid", field: "date" } };
  return { status: 200, body: { version: LAFPOS_VERSION, date, nextOpening: await lafposNextOpening(db, date) } };
}
