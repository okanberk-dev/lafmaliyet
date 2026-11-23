import "server-only";

import { and, asc, eq, gte, lte } from "drizzle-orm";

import { isReportRow } from "@/lib/cash-month";
import { LAFPOS_VERSION } from "@/lib/lafpos/day";
import {
  checkModposDaysRequest,
  modposDays,
  modposProducts,
  modposWindow,
  type ModposDayInput,
  type ModposDaysData,
} from "@/lib/lafpos/modpos-gunler";
import { branchSwitchDay } from "@/lib/lafpos/switch";
import { foyZ } from "@/lib/modpos/z";
import { parseCoverage, SALES_COVERAGE_KEY } from "@/lib/sales-coverage";
import { withBranchScope } from "@/server/branch-scope";
import { modposFallbackSheets, tillRows } from "@/server/data/cash-reports";
import { getDb, schema as s, type DB } from "@/server/db";

import type { EndpointResult } from "./ingest";
import { loadLafposSwitchDay } from "./status";

/**
 * `GET /api/panel/pos/modpos-gunler`'in çekirdeği (docs/LAFPOS.md › ModPOS dönemi): LafPOS'un şubesinin geçiş gününden
 * önceki ModPOS günleri ve dönemin ModPOS ürün listesi. Yalnız LafPOS'un imzasıyla (makine ucu; oturumla açılmaz).
 * Biçim ve kurallar saf dosyada (src/lib/lafpos/modpos-gunler.ts); burada yalnız okuma. Hiçbir şey yazılmaz.
 */

/**
 * Şubenin ModPOS dönemi. Günlerin kaynağı ay rakamınınkiyle aynı (tillRows, şubenin seçiminde): günün kasa raporu;
 * raporsuz günde, Ayarlar › ModPOS › Ay rakamına yedek açıkken kapanmış föy (raporların başına kesintisiz uzanan kısım).
 * Ayrıntılar (Z no, ödeme türleri, yazarkasa KDV dökümü) raporun ve föyün kendisinden. Geçiş günü boşsa gün ve liste yok.
 */
export async function loadModposDays(db: DB, sube: string): Promise<ModposDaysData> {
  const switchDay = branchSwitchDay(await loadLafposSwitchDay(db), sube);
  if (switchDay === null) return { switchDay: null, days: [], urunler: null };
  const window = modposWindow(switchDay);
  return withBranchScope(sube, async () => {
    const till = (await tillRows(db)).filter((r) => r.date >= window.from && r.date <= window.to && (r.branchId ?? sube) === sube);
    const reportDays = new Set(till.filter(isReportRow).map((r) => r.date));
    const foyDays = [...new Set(till.filter((r) => r.source === "modpos").map((r) => r.date))].sort();
    const [reports, sheets, lines, coverage] = await Promise.all([
      reportDays.size
        ? db
            .select({
              date: s.cashReports.date,
              zNo: s.cashReports.zNo,
              receipts: s.cashReports.receipts,
              cash: s.cashReports.cash,
              card: s.cashReports.card,
              mealCard: s.cashReports.mealCard,
              online: s.cashReports.online,
              other: s.cashReports.other,
              discounts: s.cashReports.discounts,
              offRevenue: s.cashReports.offRevenue,
              vat: s.cashReports.okcVat,
            })
            .from(s.cashReports)
            .where(and(eq(s.cashReports.branchId, sube), gte(s.cashReports.date, window.from), lte(s.cashReports.date, window.to)))
        : Promise.resolve([]),
      foyDays.length ? modposFallbackSheets(db, foyDays[0], foyDays.at(-1)) : Promise.resolve([]),
      db
        .select({
          month: s.salesLines.month,
          posName: s.salesLines.posName,
          qty: s.salesLines.qty,
          revenue: s.salesLines.revenue,
          productName: s.products.name,
          productSize: s.products.size,
        })
        .from(s.salesLines)
        .leftJoin(s.products, eq(s.salesLines.productId, s.products.id))
        .where(and(eq(s.salesLines.branchId, sube), gte(s.salesLines.month, window.from.slice(0, 7)), lte(s.salesLines.month, window.to.slice(0, 7))))
        .orderBy(asc(s.salesLines.month), asc(s.salesLines.sortOrder), asc(s.salesLines.id)),
      db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, SALES_COVERAGE_KEY)).limit(1),
    ]);
    const foyOnly = new Set(foyDays);
    const inputs: ModposDayInput[] = [
      ...reports.filter((r) => reportDays.has(r.date)),
      ...sheets.flatMap((sh): ModposDayInput[] => {
        if (sh.branchId !== sube || !foyOnly.has(sh.day)) return [];
        const z = foyZ(sh.foy);
        if (!z) return [];
        // Föyde indirim yok: o günün indirimi bilinmez (0)
        return [{ date: sh.day, zNo: z.zNo, receipts: z.receipts, cash: z.cash, card: z.card, mealCard: z.mealCard, online: z.online, other: z.other, discounts: null, offRevenue: z.offRevenue }];
      }),
    ];
    const days = modposDays(inputs, window);
    return { switchDay, days, urunler: modposProducts({ lines, coverage: parseCoverage(coverage[0]?.value), window, days }) };
  });
}

/**
 * İmza ve şube denetimi, sonra okuma: 200 `{ version: 1, now, sube, switchDay, days, urunler }` (`now` okumadan
 * sonra), 400 `{ error: "invalid", field: "sube" }`, 401, 409 `{ error: "wrong_branch", sube, expected }`, 503.
 */
export async function serveModposDays(
  input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date },
  load: (sube: string) => Promise<ModposDaysData> = (sube) => loadModposDays(getDb(), sube),
): Promise<EndpointResult> {
  const check = checkModposDaysRequest({ ...input, now: (input.now ?? new Date()).getTime() });
  if (!check.ok) return { status: check.status, body: check.body };
  const data = await load(check.sube);
  return { status: 200, body: { version: LAFPOS_VERSION, now: (input.now ?? new Date()).toISOString(), sube: check.sube, ...data } };
}
