import "server-only";

import { count, eq } from "drizzle-orm";

import { businessDayRange, cashFlags, dayContext, karaokeToday, systemIssues, type CashLite, type DayContext, type DayFacts, type KaraokeToday, type OrdersLite } from "@/app/panel/bugun/logic";
import { shiftMonth } from "@/lib/calc/engine";
import { priceAlert } from "@/lib/calc/price-impact";
import { businessDate } from "@/lib/cash-report";
import type { StaffForecastView } from "@/lib/forecast/text";
import { groupNewProposals } from "@/lib/recipe-change";
import type { UpcomingItem } from "@/lib/reminders";
import { dueGroup } from "@/lib/user-reminders";
import type { CurrentUser } from "@/server/auth/dal";
import { cashReportsBetween, cashRevisionsFor, firstCashReportDate, previousCarryOver, type CashReportDTO } from "@/server/data/cash-reports";
import { closedYesterday } from "@/server/closed-days";
import { loadStaffLateEdits, loadUnpricedExtras } from "@/server/data/count-alerts";
import { loadChecklistDays } from "@/server/data/checklists";
import { loadOverduePayouts } from "@/server/data/commission";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { pendingHoldSummary } from "@/server/data/price-holds";
import { countStockOnlyReview } from "@/server/data/stock-only-invoices";
import { countPendingRequests, loadReviewQueue } from "@/server/data/recipe-requests";
import { loadUnpricedIngredients } from "@/server/data/unpriced";
import { loadDueReminders, type UserReminderDTO } from "@/server/data/user-reminders";
import { dayWaste } from "@/server/data/waste";
import { countProgress } from "@/server/data/count-progress";
import { getDb, schema as s } from "@/server/db";
import { loadForecastCard, loadStaffForecast, type ForecastCardData } from "@/server/forecast/load";
import { isProductionRuntime, loadJobsOverview } from "@/server/jobs/alerts";
import { lastParasutSyncOkAt } from "@/server/jobs/runs";
import { loadSessions } from "@/server/karaoke/board";
import { karaokeSecret } from "@/server/karaoke/sync";
import { loadUpcoming } from "@/server/notify/digest";
import { countUnlinkedProducts } from "@/server/parasut/sync";
import { readOrdersSnapshot, readOrdersState, type OrdersSnapshot, type OrdersSyncState } from "@/server/site-orders/sync";
import { countPendingByKind } from "@/server/staff-requests/core";

import { opsFacts } from "./today-ops";
import { safe } from "./today-safe";

/**
 * Bugün ekranının verisi (src/app/panel/bugun; satırların kuralları bugun/logic.ts, docs/BUGUN.md). İki rol için ortak
 * olgular (kasa, sayım, hatırlatıcılar, karaoke, uygulama siparişleri, bugünün ve dünün kontrol listeleri, kapalı gün)
 * ve rolün kendi olguları ayrı fonksiyonlarda: personel için yalnız staffFacts çalışır, yöneticinin olguları (ödemeler,
 * faturalar, maliyet modeli, fiyatlar, kasanın bütünlüğü, onaylar, günlük işler) ona hiç yüklenmez (tests/bugun.test.ts
 * kaynaktan denetler). Operasyonun olguları (kasadaki fiyatlar, Tükendi) src/server/data/today-ops.ts'te, iki
 * rolde; o dosyanın personel dalı yalnız personelin yükleyicilerini okur.
 */
export interface TodayData {
  facts: DayFacts;
  /** Geciken ve bugünkü hatırlatıcılar (en çok 50); null: okunamadı */
  reminders: UserReminderDTO[] | null;
  /** Yalnız yönetici: Yaklaşan ödemeler kartının listesi (DashboardPayments) */
  payments: UpcomingItem[] | null;
  cafe: { karaoke: KaraokeToday | null; orders: OrdersLite | null; configured: boolean };
  /**
   * Satış tahmini (docs/SATIS-TAHMINI.md): yöneticinin kartı (tutar, aralık, kişi, 7 gün) ve personelin satırı
   * (yalnız yoğunluk ve tatlı sayısı); her rol yalnız kendininkini yükler
   */
  forecast: { admin: ForecastCardData | null; staff: StaffForecastView | null };
  renderedAt: string;
}

/**
 * Uygulama siparişlerinden yalnız sayılar: müşteri adları (KVKK) ve tutarlar ekrana taşınmaz. "Teslime hazır" gel-al
 * tezgâhta bekleyendir (#9'dan beri listede kalır), ayrı sayılır. Listenin tazeliği son başarılı çekmeden: kopya yalnız
 * liste değişince yeniden yazılır (`at`), bar ekranının ya da sitenin pinginin her çekmesi onu doğrular; değişmeden
 * duran liste eski sayılmasın.
 */
function ordersLite(snapshot: OrdersSnapshot, state: OrdersSyncState): OrdersLite {
  return {
    at: state.lastOkAt ?? snapshot.at,
    open: snapshot.orders.filter((o) => o.stage !== "ready").length,
    ready: snapshot.orders.filter((o) => o.stage === "ready").length,
  };
}

const toLite = (r: CashReportDTO): CashLite => ({
  date: r.date,
  cashDiff: r.cashDiff,
  zTotal: r.zTotal,
  cash: r.cash,
  card: r.card,
  submittedByName: r.submittedByName,
  revision: r.revision,
  note: r.note,
});

/**
 * Ay sonu sayımının ilerlemesi: bu ayın ve geçen ayın sayılan / sayılacak kalemi (countProgress) ve geçen ayın sayımı
 * var mı (sayım ya da ek kalem; stockSheet().hasData ile aynı kural). Geçen ayınki, sayımı ertesi güne kalan ayın
 * satırı için (bugun/logic.ts countPrevious).
 */
async function stockProgress(month: string, prevMonth: string): Promise<NonNullable<DayFacts["stock"]>> {
  const db = getDb();
  const [current, prev, [prevCount], [prevExtra]] = await Promise.all([
    countProgress(month),
    countProgress(prevMonth),
    db.select({ id: s.stockCounts.id }).from(s.stockCounts).where(eq(s.stockCounts.month, prevMonth)).limit(1),
    db.select({ id: s.stockExtras.id }).from(s.stockExtras).where(eq(s.stockExtras.month, prevMonth)).limit(1),
  ]);
  return { month, ...current, prevMonth, prevHasData: Boolean(prevCount || prevExtra), prevCounted: prev.counted, prevTotal: prev.total };
}

/** Rolün kendi olguları ve (yalnız yönetici) rapor gününe göre kasanın bütünlük uyarıları */
interface RoleFacts {
  facts: Partial<DayFacts>;
  cashFlags: Map<string, string[]> | null;
  forecast: TodayData["forecast"];
}

/**
 * Yalnız personel: iş gününün zayi / ikram özeti (ikramın menü fiyatıyla değeri gösterilmez) ve satış tahmininin
 * satırı (maliyet modeli verilmez)
 */
async function staffFacts(c: DayContext): Promise<RoleFacts> {
  // Satış tahmini: yalnız yoğunluk ve tatlı sayısı (tutar, aralık, kişi önerisi yok; ayar kapalıysa null)
  const [waste, busy] = await Promise.all([safe(dayWaste(c.day)), safe(loadStaffForecast())]);
  return {
    // LafPOS günü (geçiş günü seçili ve iş günü ondan önce değil): ürün ikramı kasada işaretlenir, satırın metni söyler
    facts: { waste: waste ? { count: waste.count, zayi: waste.zayi, ikram: waste.ikram, lafpos: waste.lafpos !== null } : null },
    cashFlags: null,
    forecast: { admin: null, staff: busy },
  };
}

/**
 * Yalnız yönetici; hepsi aynı anda. `cash`: ortak olguların kasa raporu okuması (bütünlük uyarıları onun üstüne).
 * `viewer`: bakan yönetici (kendi ertesi gün düzeltmesi uyarı sayılmaz; zil ile aynı kural).
 */
async function adminFacts(now: Date, viewer: number, cash: Promise<CashReportDTO[] | null>): Promise<RoleFacts> {
  const db = getDb();
  // Maliyet modeli yalnız zam uyarısı için (personelde hiç kurulmaz)
  const modelP = loadModel();
  const month = businessDate(now).slice(0, 7);
  const prevMonth = shiftMonth(month, -1);
  const [system, upcoming, review, unlinked, unpriced, approvals, holds, prices, flags, overdue, forecast, countAlerts] = await Promise.all([
    // Günlük işlerin ciddi sorunları (yalnız canlıda; Genel bakış şeridinin "danger" kümesi). Paraşüt işinin hatası,
    // sonradan başarılı bir eşitleme olana kadar (bugun/logic.ts systemIssues; fatura satırı eşitlemeyi sormaz,
    // docs/planlar/CRITIQUE.md §3 today)
    isProductionRuntime()
      ? safe(Promise.all([loadJobsOverview(now), lastParasutSyncOkAt()]).then(([o, okAt]) => systemIssues(o, now, okAt)))
      : Promise.resolve([]),
    safe(loadUpcoming()),
    safe(
      Promise.all([db.select({ n: count() }).from(s.invoices).where(eq(s.invoices.needsReview, true)), countStockOnlyReview(db)]).then(([[r], stockOnly]) => ({
        review: r?.n ?? 0,
        stockOnly,
      })),
    ),
    safe(countUnlinkedProducts()),
    safe(loadUnpricedIngredients()),
    // Onay bekleyenler: reçete değişiklikleri ve yeni ürünler (boyları tek öneri), ilk ürün adları; personel istekleri
    // türüne göre (docs/ONAYLAR.md) ve hepsinin en eskisi
    safe(
      (async () => {
        const [recipe, requests] = await Promise.all([
          (async () => {
            if (!(await countPendingRequests())) return { changes: 0, newProducts: 0, names: [] as string[], oldest: null };
            const { pending } = await loadReviewQueue(0);
            const changes = pending.filter((r) => r.kind === "change");
            const proposals = groupNewProposals(pending.filter((r) => r.kind === "new").map((r) => ({ id: r.id, name: r.productName, size: r.size, by: r.requestedByName, message: r.message })));
            const names = [...new Set([...changes.map((r) => r.productName), ...proposals.map((p) => p.name)])];
            return { changes: changes.length, newProducts: proposals.length, names, oldest: pending[0]?.createdAt ?? null };
          })(),
          countPendingByKind(db, now),
        ]);
        const oldest = [recipe.oldest, ...requests.map((r) => r.oldestAt)].filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
        return {
          changes: recipe.changes,
          newProducts: recipe.newProducts,
          names: recipe.names,
          requests: requests.map(({ kind, count }) => ({ kind, count })),
          oldestAt: oldest?.toISOString() ?? null,
        };
      })(),
    ),
    safe(pendingHoldSummary().then((h) => ({ count: h.count, items: h.items.map(({ name, pct }) => ({ name, pct })) }))),
    // Hammadde zammı: Genel bakış ve zil ile aynı metin (ayda TL etkisiyle); personelde model hiç kurulmaz
    safe(
      (async () => {
        const pa = await loadPriceAlerts(await modelP);
        const alert = priceAlert(pa.changes, pa.actionable, pa.loss.totalLoss);
        return alert ? { detail: alert.detail, href: alert.href, count: pa.actionable.length } : null;
      })(),
    ),
    // Kasanın bütünlüğü (kasa'nın kuralları, zil ile aynı; bugun/logic.ts cashFlags): açılış önceki devirle tutmuyor;
    // rapor iş günü kapandıktan sonra kasa alanı değiştirilerek düzeltildi. Zincir listenin en eski gününden önceki son
    // rapordan başlar (en eski gün sıraya güvenmeden bulunur)
    safe(
      cash.then(async (reports) => {
        if (!reports?.length) return new Map<string, string[]>();
        const oldest = reports.map((r) => r.date).sort()[0];
        const [before, revisions] = await Promise.all([previousCarryOver(oldest), cashRevisionsFor(reports.filter((r) => r.revision > 1).map((r) => r.id))]);
        return cashFlags(reports, before, revisions, viewer);
      }),
    ),
    // Geciken hakedişler (hafif okuma: ekranın 13 ayının Komisyon faturaları ve işaretler; docs/KOMISYON.md)
    safe(loadOverduePayouts()),
    // Satış tahmini kartı: bugünün tahmini, aralık, kişi, tatlı ve 7 günün şeridi (docs/SATIS-TAHMINI.md)
    safe(loadForecastCard(now)),
    // Sayımın uyarıları (zil ile aynı; src/server/data/count-alerts.ts): fiyatsız ek kalemler, personelin geç kaydı
    safe(
      Promise.all([loadUnpricedExtras([month, prevMonth]), loadStaffLateEdits(prevMonth)]).then(([extras, edits]) => ({ extras, late: { month: prevMonth, edits } })),
    ),
  ]);
  return {
    facts: { system, payments: upcoming?.items ?? null, commission: overdue ? { overdue } : null, invoices: review, unlinked, unpriced, approvals, holds, prices, countAlerts },
    cashFlags: flags,
    forecast: { admin: forecast, staff: null },
  };
}

/**
 * Bugün ekranının bütün verisi. Şimdiki zaman oturum okumasından (requireUser, çerez) sonra okunur: Cache Components
 * önceden render ederken saat okumaz; sayfa zaten isteğe göre çizilir.
 */
export async function loadToday(user: CurrentUser): Promise<TodayData> {
  const now = new Date();
  const c = dayContext(now);
  const admin = user.role === "admin";
  const range = businessDayRange(c.day);
  const configured = Boolean(karaokeSecret());
  const cashP = safe(cashReportsBetween(c.yesterday, c.day));
  const [reports, firstDate, stock, due, sessions, orders, checklists, closed, ops, own] = await Promise.all([
    cashP,
    safe(firstCashReportDate()),
    safe(stockProgress(c.month, c.prevMonth)),
    safe(loadDueReminders(user.id, c.today)),
    safe(loadSessions(range.from, range.to, { admin })),
    configured ? safe(Promise.all([readOrdersSnapshot(), readOrdersState()]).then(([snapshot, state]) => ordersLite(snapshot, state))) : Promise.resolve(null),
    // Bugünün ve dünün kontrol listeleri tek okumada (iki rol; personel yalnız kendi doldurabildiklerini alır)
    safe(loadChecklistDays([c.day, c.yesterday], user.role, now)),
    // Dün kafe kapalı mıydı (onaylı ya da onay bekleyen bildirim; kasa ve liste satırları buna bakar)
    safe(closedYesterday(user, now)),
    // Operasyonun olguları (kasadaki fiyatlar, Tükendi, taslak): iki rolde, rolün kendi yükleyicileriyle
    opsFacts(user, now),
    admin ? adminFacts(now, user.id, cashP) : staffFacts(c),
  ]);

  const lite = (date: string): CashLite | null => {
    const r = reports?.find((x) => x.date === date);
    if (!r) return null;
    const flags = own.cashFlags?.get(date);
    return flags?.length ? { ...toLite(r), flags } : toLite(r);
  };
  const facts: DayFacts = {
    ...own.facts,
    ...ops,
    role: user.role,
    now,
    cash: reports ? { today: lite(c.day), yesterday: lite(c.yesterday), firstDate } : null,
    stock,
    checklists: checklists ? { day: c.day, lists: checklists.get(c.day) ?? [] } : null,
    checklistsYesterday: checklists ? { day: c.yesterday, lists: checklists.get(c.yesterday) ?? [] } : null,
    closed,
  };
  return {
    facts,
    reminders: due
      ? due
          .filter((r) => {
            const g = dueGroup(r, now);
            return g === "overdue" || g === "today";
          })
          .slice(0, 50)
      : null,
    payments: admin ? (facts.payments ?? null) : null,
    cafe: {
      karaoke: sessions ? karaokeToday(sessions, c.day, now.getTime()) : null,
      orders,
      configured,
    },
    forecast: own.forecast,
    renderedAt: now.toISOString(),
  };
}
