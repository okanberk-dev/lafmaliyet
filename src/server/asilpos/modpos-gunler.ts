import "server-only";

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { ASILPOS_VERSION } from "@/lib/asilpos/day";
import {
  checkModposDaysRequest,
  modposDays,
  modposFoyInput,
  modposProducts,
  modposWindow,
  type ModposDayInput,
  type ModposDaysData,
} from "@/lib/asilpos/modpos-gunler";
import { readCoverage, SALES_COVERAGE_BRANCH_KEY, SALES_COVERAGE_KEY } from "@/lib/sales-coverage";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadBranchSwitchDay } from "./branch";
import { loadModposSheets } from "@/server/modpos/store";

import type { EndpointResult } from "./ingest";

/**
 * `GET /api/panel/pos/modpos-gunler`'in çekirdeği (docs/ASILPOS.md › ModPOS dönemi): AsilPOS'un şubesinin geçiş gününden
 * önceki ModPOS günleri ve dönemin ModPOS ürün listesi. Yalnız AsilPOS'un imzasıyla (makine ucu; oturumla açılmaz).
 * Biçim ve kurallar saf dosyada (src/lib/asilpos/modpos-gunler.ts); burada yalnız okuma. Hiçbir şey yazılmaz.
 */

/**
 * Şubenin ModPOS dönemi, hep şubenin kendi satırlarından (seçili şube okunmaz). Günün kaynağı önce kasa raporu
 * (`kasa_raporu`); raporsuz günde kapanmış föy (`foy`). Föy günü Ayarlar › ModPOS › Ay rakamına yedek'ten ve ay
 * rakamının kesintisiz kısım kuralından bağımsız gider (CONTRACT §9: Uzaktan boş gün göstermesin); panelin ay rakamı
 * (tillRows) bundan etkilenmez. Ayrıntılar (Z no, ödeme türleri, yazarkasa KDV dökümü) raporun ve föyün kendisinden.
 * Geçiş günü boşsa gün ve liste yok; geçiş günü ve sonrası hiç okunmaz (Marina ModPOS'a dönmez). Ürün listesinin son
 * günü şubenin kendi kapsam kaydından (`sales.coverage.sube`), yoksa ortak kayıttan (src/lib/sales-coverage.ts).
 */
export async function loadModposDays(db: DB, sube: string): Promise<ModposDaysData> {
  const switchDay = await loadBranchSwitchDay(sube, db);
  if (switchDay === null) return { switchDay: null, days: [], urunler: null };
  const window = modposWindow(switchDay);
  const [reports, sheets, lines, coverage] = await Promise.all([
    db
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
      .orderBy(asc(s.cashReports.date)),
    loadModposSheets(window.from, window.to, db, { branchId: sube }),
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
    db
      .select({ key: s.integrationState.key, value: s.integrationState.value })
      .from(s.integrationState)
      .where(inArray(s.integrationState.key, [SALES_COVERAGE_KEY, SALES_COVERAGE_BRANCH_KEY])),
  ]);
  // Rapor föyden önce: modposDays aynı günün ilkini alır (rapor kazanır, boş rapor da)
  const inputs: ModposDayInput[] = [
    ...reports.map((r): ModposDayInput => ({ kaynak: "kasa_raporu", ...r })),
    ...sheets.flatMap((sh) => (sh.branchId === sube ? (modposFoyInput(sh) ?? []) : [])),
  ];
  const days = modposDays(inputs, window);
  // Listenin son günü şubenin kendi kaydından (öteki şubenin aynı aya yüklediği liste ortak kaydı ezer); kaydı olmayan
  // ayda (şube kaydından önce yüklenen liste) ortak kayıt
  const stored = (key: string) => coverage.find((c) => c.key === key)?.value;
  const listCoverage = readCoverage(stored(SALES_COVERAGE_KEY), stored(SALES_COVERAGE_BRANCH_KEY), sube);
  return { switchDay, days, urunler: modposProducts({ lines, coverage: listCoverage, window, days }) };
}

/**
 * İmza ve şube denetimi, sonra okuma: 200 `{ version: 1, now, sube, switchDay, days, urunler }` (`now` okumadan
 * sonra), 400 `{ error: "invalid", field: "sube" }`, 401, 409 `{ error: "wrong_branch", sube, expected }`, 503.
 */
export async function serveModposDays(
  input: { secret: string | null; branchId: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date },
  load: (sube: string) => Promise<ModposDaysData> = (sube) => loadModposDays(getDb(), sube),
): Promise<EndpointResult> {
  // Beklenen şube anahtarın şubesi (çok şube; imzanın tuttuğu anahtar)
  const check = checkModposDaysRequest({ ...input, now: (input.now ?? new Date()).getTime(), expected: input.branchId });
  if (!check.ok) return { status: check.status, body: check.body };
  const data = await load(check.sube);
  return { status: 200, body: { version: ASILPOS_VERSION, now: (input.now ?? new Date()).toISOString(), sube: check.sube, ...data } };
}
