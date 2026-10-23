import "server-only";

import { and, count, eq, exists, isNotNull, isNull, lte, or } from "drizzle-orm";

import { businessDayRange, cashFlags, dayContext, karaokeToday, systemIssues, type CashLite, type DayContext, type DayFacts, type KaraokeToday, type OrdersLite } from "@/app/panel/bugun/logic";
import { priceAlert } from "@/lib/calc/price-impact";
import { groupNewProposals } from "@/lib/recipe-change";
import type { UpcomingItem } from "@/lib/reminders";
import { dueGroup } from "@/lib/user-reminders";
import type { CurrentUser } from "@/server/auth/dal";
import { cashReportsBetween, cashRevisionsFor, firstCashReportDate, previousCarryOver, type CashReportDTO } from "@/server/data/cash-reports";
import { loadChecklistDay } from "@/server/data/checklists";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { pendingHoldSummary } from "@/server/data/price-holds";
import { posPendingSummary } from "@/server/data/prices";
import { countPendingRequests, loadReviewQueue } from "@/server/data/recipe-requests";
import { loadReorderDay } from "@/server/data/reorder";
import { loadUnpricedIngredients } from "@/server/data/unpriced";
import { loadDueReminders, type UserReminderDTO } from "@/server/data/user-reminders";
import { dayWaste } from "@/server/data/waste";
import { getDb, schema as s } from "@/server/db";
import { isProductionRuntime, loadJobsOverview } from "@/server/jobs/alerts";
import { lastParasutSyncOkAt } from "@/server/jobs/runs";
import { loadSessions } from "@/server/karaoke/board";
import { karaokeSecret } from "@/server/karaoke/sync";
import { loadUpcoming } from "@/server/notify/digest";
import { countUnlinkedProducts } from "@/server/parasut/sync";
import { readOrdersSnapshot, readOrdersState, type OrdersSnapshot, type OrdersSyncState } from "@/server/site-orders/sync";

/**
 * Bugün ekranının verisi (src/app/panel/bugun; satırların kuralları bugun/logic.ts, docs/BUGUN.md). İki rol için ortak
 * olgular (kasa, sayım, hatırlatıcılar, karaoke, uygulama siparişleri) ve rolün kendi olguları ayrı fonksiyonlarda:
 * personel için yalnız staffFacts çalışır, yöneticinin olguları (ödemeler, faturalar, maliyet modeli, fiyatlar, kasanın
 * bütünlüğü, günlük işler) ona hiç yüklenmez (tests/bugun.test.ts kaynaktan denetler).
 */
export interface TodayData {
  facts: DayFacts;
  /** Geciken ve bugünkü hatırlatıcılar (en çok 50); null: okunamadı */
  reminders: UserReminderDTO[] | null;
  /** Yalnız yönetici: Yaklaşan ödemeler kartının listesi (DashboardPayments) */
  payments: UpcomingItem[] | null;
  cafe: { karaoke: KaraokeToday | null; orders: OrdersLite | null; configured: boolean };
  renderedAt: string;
}

/**
 * Bir kaynak düşerse sayfa yine açılır: ilgili satır "okunamadı" der ya da hiç çıkmaz, hata sunucu günlüğüne yazılır.
 * Her yükleyici bundan geçer (ikinci paketin satırları da).
 */
export function safe<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((e: unknown) => {
    console.error("[bugun]", e);
    return null;
  });
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
 * Bir ayın sayım ilerlemesi: o ay sayılan kalem ve sayılacak kalem (Stok sayımı ekranının listesi: etkin, sayım birimi
 * olan, listeye girdiği ay gelmiş ya da o ay sayılmış; engine.ts stockSheet). Arşivlenen (pasif ya da "Sayılmaz") kalem
 * sayılmaz.
 */
async function countProgress(month: string): Promise<{ counted: number; total: number }> {
  const db = getDb();
  const i = s.ingredients;
  const sc = s.stockCounts;
  const listed = and(eq(i.active, true), isNotNull(i.countUnit));
  const countedThatMonth = exists(
    db
      .select({ id: sc.id })
      .from(sc)
      .where(and(eq(sc.month, month), eq(sc.ingredientId, i.id))),
  );
  const [[counted], [total]] = await Promise.all([
    db
      .select({ n: count() })
      .from(sc)
      .innerJoin(i, eq(i.id, sc.ingredientId))
      .where(and(eq(sc.month, month), listed)),
    db
      .select({ n: count() })
      .from(i)
      .where(and(listed, or(isNull(i.countFrom), lte(i.countFrom, month), countedThatMonth))),
  ]);
  return { counted: counted?.n ?? 0, total: total?.n ?? 0 };
}

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
}

/**
 * Yalnız personel: iş gününün zayi / ikram özeti (ikramın menü fiyatıyla değeri gösterilmez) ve hızlı sayımın olguları
 * (maliyet modeli verilmez: fiyat, sipariş ve teslim kontrolü yüklenmez)
 */
async function staffFacts(c: DayContext): Promise<RoleFacts> {
  const [waste, reorder] = await Promise.all([safe(dayWaste(c.day)), safe(loadReorderDay("staff", new Date()))]);
  return { facts: { waste: waste ? { count: waste.count, zayi: waste.zayi, ikram: waste.ikram } : null, reorder }, cashFlags: null };
}

/**
 * Yalnız yönetici; hepsi aynı anda. `cash`: ortak olguların kasa raporu okuması (bütünlük uyarıları onun üstüne).
 * `viewer`: bakan yönetici (kendi ertesi gün düzeltmesi uyarı sayılmaz; zil ile aynı kural).
 */
async function adminFacts(now: Date, viewer: number, cash: Promise<CashReportDTO[] | null>): Promise<RoleFacts> {
  const db = getDb();
  const yesterday = dayContext(now).yesterday;
  // Maliyet modeli bir kez kurulur: zam uyarısı ve mal siparişinin hazır listesi aynı modelle (personelde hiç kurulmaz)
  const modelP = loadModel();
  const [system, upcoming, review, unlinked, unpriced, approvals, holds, prices, pos, flags, checklistsYesterday, reorder] = await Promise.all([
    // Günlük işlerin ciddi sorunları (yalnız canlıda; Genel bakış şeridinin "danger" kümesi). Paraşüt işinin hatası,
    // sonradan başarılı bir eşitleme olana kadar (bugun/logic.ts systemIssues; fatura satırı eşitlemeyi sormaz,
    // docs/planlar/CRITIQUE.md §3 today)
    isProductionRuntime()
      ? safe(Promise.all([loadJobsOverview(now), lastParasutSyncOkAt()]).then(([o, okAt]) => systemIssues(o, now, okAt)))
      : Promise.resolve([]),
    safe(loadUpcoming()),
    safe(
      db
        .select({ n: count() })
        .from(s.invoices)
        .where(eq(s.invoices.needsReview, true))
        .then(([r]) => ({ review: r?.n ?? 0 })),
    ),
    safe(countUnlinkedProducts()),
    safe(loadUnpricedIngredients()),
    // Onay bekleyen öneriler: değişiklikler ve yeni ürünler (boyları tek öneri), ilk ürün adları
    safe(
      (async () => {
        if (!(await countPendingRequests())) return { changes: 0, newProducts: 0, names: [] };
        const { pending } = await loadReviewQueue(0);
        const changes = pending.filter((r) => r.kind === "change");
        const proposals = groupNewProposals(pending.filter((r) => r.kind === "new").map((r) => ({ id: r.id, name: r.productName, size: r.size, by: r.requestedByName, message: r.message })));
        return { changes: changes.length, newProducts: proposals.length, names: [...new Set([...changes.map((r) => r.productName), ...proposals.map((p) => p.name)])] };
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
    safe(posPendingSummary().then((p) => ({ count: p.count, oldest: p.oldest?.toISOString() ?? null }))),
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
    // Dünün kontrol listeleri: tamamlanmayan ve sorunlu olanlar (bugünkü listeler iki rolde loadToday'de)
    safe(loadChecklistDay(yesterday, "admin", now)).then((lists) => (lists ? { day: yesterday, lists } : null)),
    // Mal siparişi: hızlı sayım, sipariş hazır tedarikçiler, teslim kontrolü (docs/MAL-SIPARISI.md)
    safe(modelP.then((model) => loadReorderDay("admin", now, model))),
  ]);
  return {
    facts: { system, payments: upcoming?.items ?? null, invoices: review, unlinked, unpriced, approvals, holds, prices, pos, checklistsYesterday, reorder },
    cashFlags: flags,
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
  const [reports, firstDate, stock, due, sessions, orders, checklists, own] = await Promise.all([
    cashP,
    safe(firstCashReportDate()),
    safe(stockProgress(c.month, c.prevMonth)),
    safe(loadDueReminders(user.id, c.today)),
    safe(loadSessions(range.from, range.to, { admin })),
    configured ? safe(Promise.all([readOrdersSnapshot(), readOrdersState()]).then(([snapshot, state]) => ordersLite(snapshot, state))) : Promise.resolve(null),
    // Kontrol listeleri (iki rol; personel yalnız kendi doldurabildiklerini alır)
    safe(loadChecklistDay(c.day, user.role, now)),
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
    role: user.role,
    now,
    cash: reports ? { today: lite(c.day), yesterday: lite(c.yesterday), firstDate } : null,
    stock,
    checklists: checklists ? { day: c.day, lists: checklists } : null,
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
    renderedAt: now.toISOString(),
  };
}
