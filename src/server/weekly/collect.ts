import "server-only";

import { and, eq, gte, inArray } from "drizzle-orm";

import type { Model } from "@/lib/calc/engine";
import { consistency, latestSalesMonth } from "@/lib/calc/insights";
import { priceAlert } from "@/lib/calc/price-impact";
import { salesBasis } from "@/lib/calc/price-loss";
import { lineLabel } from "@/lib/cash-plan";
import { businessDate, carryChecks, historyOf } from "@/lib/cash-report";
import { isChannelKey } from "@/lib/commission/channels";
import { buildCommissionReport, commissionAlerts, groupOf, MEAL_LIMIT, rowOf, type CommissionAlert, type CommissionReport } from "@/lib/commission/report";
import { computeOccupancy, emptiestBlock, KARAOKE_ROOMS, periodBounds, resolvePeriod } from "@/lib/karaoke/occupancy";
import { hourRangeLabel, insightLines, weekdayRange } from "@/lib/karaoke/occupancy-text";
import { savedFields, suspiciousDiffs } from "@/lib/photo-read/kasa";
import { addDays, shiftMonth, todayTR } from "@/lib/reminders";
import { productLabel } from "@/lib/waste";
import { parseWeeklyHistory, selectItems, weekInfo, WEEKLY_HISTORY_KEY, type WeekInfo, type WeeklyItem, type WeeklySource, type WeeklySummary } from "@/lib/weekly/core";
import { cashItem, checklistDayOf, checklistItem, commissionItems, forecastLine, karaokeItem, kasaItem, posPriceItem, salesLine, stockItem, wasteCost, wasteItem, zamItem, type KomisyonCand } from "@/lib/weekly/items";
import { loadCashPlan } from "@/server/data/cash-plan";
import { cashReportPhotoInfo } from "@/server/data/cash-photos";
import { cashReportsBetween, cashRevisionsFor, firstCashReportDate, type CashReportDTO } from "@/server/data/cash-reports";
import { loadChecklistHistory } from "@/server/data/checklists";
import { loadCommissionInput } from "@/server/data/commission";
import { loadModel } from "@/server/data/dataset";
import { loadPriceAlerts } from "@/server/data/price-alerts";
import { loadPosChecklist } from "@/server/data/prices";
import { getDb, schema as s } from "@/server/db";
import { loadForecastCore } from "@/server/forecast/load";
import { capped } from "@/server/jobs/capped";
import { loadOccupancySessions, readKaraokeHours } from "@/server/karaoke/occupancy";
import { loadUpcoming } from "@/server/notify/digest";

/*
 * Haftalık özetin kaynakları (docs/HAFTALIK-OZET.md). Her kaynak başka bir ekranın dışa açık yükleyicisini okur ve
 * sonucunu src/lib/weekly/items.ts'in dar girdisine çevirir; maddeyi yapıcı kurar. Kaynaklar aynı anda çalışır, her
 * biri kendi sınırında (en çok 4 sn); süresi dolan ya da hata veren kaynak yalnız kendi maddesini düşürür ve dipnota
 * "okunamadı" diye girer. Modeli okuyan beş kaynak tek loadModel()'i paylaşır. Hiçbir kaynak yazmaz; kişi adı (raporu
 * giren, sayan, listeyi dolduran) ve serbest not maddelere taşınmaz.
 */

interface WeeklyCtx {
  now: Date;
  /** İş günü (businessDate; sabah 08:00'de bugün) */
  today: string;
  week: WeekInfo;
  /** Tek loadModel(), paylaşılan söz */
  model(): Promise<Model>;
  /** Son beş haftanın kasa raporları (geçen hafta ve önceki dört), paylaşılan */
  cashWeeks(): Promise<CashReportDTO[]>;
}

type CollectResult = { items?: WeeklyItem[]; lines?: string[] };

interface Collector {
  /** "satir": yalnız bağlam satırı (okunamazsa dipnota girmez, satır düşer) */
  source: WeeklySource | "satir";
  timeoutMs: number;
  run(ctx: WeeklyCtx): Promise<CollectResult>;
}

const one = (item: WeeklyItem | null): CollectResult => ({ items: item ? [item] : [] });
const inLastWeek = (week: WeekInfo, day: string) => day >= week.lastFrom && day <= week.lastTo;

// ---------------------------------------------------------------- Kaynaklar

/** Zam etkisi (insight): fiyatına bakılacak ürünlerin ayda kâr kaybı, en büyük (ürün, hammadde) çifti */
const zam: Collector = {
  source: "zam",
  timeoutMs: 4_000,
  async run(ctx) {
    const pa = await loadPriceAlerts(await ctx.model());
    const actionable = new Set(pa.actionable.map((p) => p.productId));
    return one(
      zamItem({
        basisMonth: pa.loss.basis?.month ?? null,
        actionable: pa.actionable.length,
        title: priceAlert(pa.changes, pa.actionable)?.title ?? "",
        products: pa.loss.products
          .filter((p) => actionable.has(p.productId) && p.monthly > 0)
          .map((p) => ({ productId: p.productId, name: p.name, monthly: p.monthly, drivers: p.drivers.map((d) => ({ ingredientId: d.ingredientId, name: d.name, monthly: d.monthly })) })),
      }),
    );
  },
};

/** Nakit planı (insight; KDV satırları planın içinde): ilk eksi gün */
const nakit: Collector = {
  source: "nakit",
  timeoutMs: 4_000,
  async run(ctx) {
    // Planın bugünü özetin iş günü (sabah işinde aynı gün; ayrıca verilir: tek saat okunsun)
    const [model, upcoming] = await Promise.all([ctx.model(), loadUpcoming(ctx.today)]);
    const { plan } = await loadCashPlan(model, upcoming);
    const n = plan.firstNegative;
    return one(
      cashItem({
        today: plan.today,
        opening: plan.opening ? { staleDays: plan.opening.staleDays } : null,
        firstNegative: n ? { date: n.date, balance: n.balance, top: n.top.map((l) => ({ title: lineLabel(l), amount: l.amount })) } : null,
      }),
    );
  },
};

/**
 * Kasa raporları (kasa, fotograf) ve kasa cirosu satırı: geçen haftanın eksikleri; açılışı devirle tutmayan gün, ertesi
 * gün düzeltilen rapor ve fotoğraftan farklı yazılan rapor ayrı ayrı okunur, okunamayan işaret gösterilmez
 */
const kasa: Collector = {
  source: "kasa",
  timeoutMs: 3_000,
  async run(ctx) {
    const reports = await ctx.cashWeeks();
    const last = reports.filter((r) => inLastWeek(ctx.week, r.date));
    const quiet = <T>(p: Promise<T>, what: string) =>
      p.catch((e) => {
        console.error("[haftalik] kasa", what, e);
        return null;
      });
    const [carry, late, photo] = await Promise.all([
      // Açılış ↔ devir zinciri pencerenin raporlarıyla (geçen haftanın ilk günü önceki haftanın son raporuna bakar)
      quiet(Promise.resolve().then(() => [...carryChecks(reports, null).keys()].filter((d) => inLastWeek(ctx.week, d)).length), "devir"),
      quiet(
        cashRevisionsFor(last.filter((r) => r.revision > 1).map((r) => r.id)).then(
          (revs) => last.filter((r) => r.revision > 1 && historyOf(r, revs.filter((x) => x.reportId === r.id)).entries.some((e) => e.late)).length,
        ),
        "düzeltme",
      ),
      quiet(
        cashReportPhotoInfo(last.map((r) => ({ id: r.id, date: r.date }))).then((info) => last.filter((r) => suspiciousDiffs(info.get(r.id)?.readings ?? [], savedFields(r)).length > 0).length),
        "fotoğraf",
      ),
    ]);
    const rows = reports.map((r) => ({ date: r.date, zTotal: r.zTotal, cashDiff: r.cashDiff }));
    const line = salesLine({ week: ctx.week, reports: rows });
    return { ...one(kasaItem({ week: ctx.week, reports: rows, carryMismatch: carry, lateEdits: late, photoDiffs: photo })), lines: line ? [line] : [] };
  },
};

/** Komisyonun uyarısından lira değeri (beklenen − gelen, %6'nın üstü, komisyon dışı kalemler) */
function commissionCand(report: CommissionReport, a: CommissionAlert): KomisyonCand | null {
  const [, channel, month] = a.key.split(":");
  if (!month) return null;
  const base = { alertKey: a.key, kind: a.kind, month, href: a.href, due: null, rate: null, lineText: null };
  if (channel === "yemek-kartlari") {
    const g = groupOf(report, "meal", month);
    if (!g || g.rate === null || g.zTotal === null) return null;
    return { ...base, label: "Yemek kartları", group: true, tl: g.feesTotal - MEAL_LIMIT * g.zTotal, rate: g.rate };
  }
  if (!isChannelKey(channel)) return null;
  const r = rowOf(report, channel, month);
  if (!r) return null;
  if (a.kind === "gecikti") {
    const p = r.payout;
    return { ...base, label: r.label, tl: p.expected !== null ? p.expected - (p.received ?? 0) : null, due: p.due };
  }
  if (a.kind === "oran") return r.sales && r.rate !== null ? { ...base, label: r.label, tl: r.feesTotal - MEAL_LIMIT * r.sales.amount, rate: r.rate } : null;
  return { ...base, label: r.label, tl: r.fees.yasak, lineText: a.body };
}

/** Komisyon ve hakediş (komisyon): hafif rapor (4 ay; yalnız okur, takibin başlangıcını yazmaz) */
const komisyon: Collector = {
  source: "komisyon",
  timeoutMs: 3_000,
  async run(ctx) {
    const report = buildCommissionReport(await loadCommissionInput({ months: 4, resolveNames: false, today: ctx.today }));
    const cands = commissionAlerts(report, ctx.today, Infinity)
      .map((a) => commissionCand(report, a))
      .filter((c): c is KomisyonCand => c !== null);
    return { items: commissionItems(cands) };
  },
};

/**
 * Kasada eski fiyat (menu, insight dayanağı): ayda ModPOS'ta satılan adet salesBasis'in ölçeğiyle; online kafe
 * siparişi sitenin fiyatını öder, sayılmaz
 */
const kasaFiyat: Collector = {
  source: "kasa-fiyat",
  timeoutMs: 4_000,
  async run(ctx) {
    const [model, pending] = await Promise.all([ctx.model(), loadPosChecklist()]);
    if (!pending.length) return {};
    const month = latestSalesMonth(model);
    const basis = month ? salesBasis(model, month) : null;
    const sold = month ? model.soldByProduct(month) : new Map<number, number>();
    return one(
      posPriceItem({
        today: ctx.today,
        kdv: model.settings.kdv,
        rows: pending.map((p) => ({
          label: productLabel(p),
          price: p.price,
          posPrice: p.stalePrice,
          since: todayTR(new Date(p.since)),
          perMonth: basis ? (sold.get(p.productId) ?? 0) * basis.basis.scale : null,
        })),
      }),
    );
  },
};

/** Zayi ve ikram (kayıtlar): son beş haftanın malzeme maliyeti */
const zayi: Collector = {
  source: "zayi",
  timeoutMs: 4_000,
  async run(ctx) {
    const model = await ctx.model();
    const from = addDays(ctx.week.lastFrom, -28);
    const nameOf = (e: { productId: number | null; ingredientId: number | null }) => {
      const p = e.productId !== null ? model.productById.get(e.productId) : undefined;
      if (p) return productLabel(p);
      return (e.ingredientId !== null ? model.ingById.get(e.ingredientId)?.name : undefined) ?? "Kayıt";
    };
    const entries = (model.ds.wasteEntries ?? []).filter((e) => e.date >= from && e.date <= ctx.week.lastTo).map((e) => ({ date: e.date, name: nameOf(e), cost: wasteCost(model, e) }));
    return one(wasteItem({ week: ctx.week, entries }));
  },
};

/** Stok sayımı (tutarlılık): geçen ayın açıklanamayan farkı, ay başına bir kez */
const stok: Collector = {
  source: "stok",
  timeoutMs: 4_000,
  async run(ctx) {
    const model = await ctx.model();
    const month = shiftMonth(ctx.today.slice(0, 7), -1);
    const c = consistency(model, month);
    const top = c.rows.filter((r) => r.stock === "complete" && (r.unexplainedAmount ?? 0) > 0).sort((a, b) => b.unexplainedAmount! - a.unexplainedAmount!)[0];
    return one(stockItem({ month, comparable: c.hasStockComparison, unexplained: c.totalUnexplained, top: top ? { name: top.ingredient.name, amount: top.unexplainedAmount! } : null }));
  },
};

/** Karaoke doluluğu (doluluk): son 4 haftanın en boş bloğu (yükleyici ad ve not okumaz) */
const karaoke: Collector = {
  source: "karaoke",
  timeoutMs: 3_000,
  async run(ctx) {
    const { hours } = await readKaraokeHours();
    const period = resolvePeriod("4h", undefined, ctx.now.getTime());
    const { start, end } = periodBounds(period);
    const sessions = await loadOccupancySessions(new Date(start), new Date(end));
    const { grid, summary } = computeOccupancy(sessions, period, { hours, rooms: KARAOKE_ROOMS });
    const b = emptiestBlock(grid);
    return one(
      karaokeItem({
        ready: insightLines(grid, summary, period).reason === null,
        overall: summary.ratio,
        block: b ? { key: `${b.d0}-${b.d1}:${b.h0}-${b.h1}`, where: `${weekdayRange(b.d0, b.d1)} ${hourRangeLabel(b.h0, b.h1)}`, ratio: b.ratio } : null,
      }),
    );
  },
};

/**
 * Kontrol listeleri (kontrol): geçen haftanın günlük listeleri (Kontrol geçmişi'nin yükleyicisi). Yalnız liste adı ve
 * sorunun maddesi ile değeri gider; yanıt veren, not ve "Sorun var" notu okunmaz. Kasa raporu olmayan gün kapalı
 * sayılır (kasa raporu henüz kullanılmıyorsa her gün açık; sabah e-postasının kuralı)
 */
const kontrol: Collector = {
  source: "kontrol",
  timeoutMs: 3_000,
  async run(ctx) {
    const [history, first, reports] = await Promise.all([loadChecklistHistory(ctx.week.lastFrom, ctx.week.lastTo, ctx.now), firstCashReportDate(), ctx.cashWeeks()]);
    const reported = new Set(reports.map((r) => r.date));
    return one(
      checklistItem({
        week: ctx.week,
        days: history.map(({ day, lists }) => checklistDayOf(day, reported.has(day) || first === null || first > day, lists.map((l) => l.lite))),
      }),
    );
  },
};

/**
 * Satış tahmininin yükleyicisinden bağlam satırının girdisi (tahmin grubu, src/server/forecast/load.ts
 * loadForecastCore). Tür yapısal: modül yokken de derlenir
 */
export function forecastLineInput(core: { forecast: { quality: string; days: readonly { date: string; amount: number; closed: unknown }[] } }) {
  return { quality: core.forecast.quality, days: core.forecast.days.map((d) => ({ date: d.date, amount: d.amount, closed: Boolean(d.closed) })) };
}

/** Satış tahmini satırının yükleyicisi (src/server/forecast/load.ts loadForecastCore; hava ve kayıt sabah işinde yazılır) */
function forecastLoader(): ((now: Date) => Promise<ReturnType<typeof forecastLineInput>>) | null {
  return (now) => loadForecastCore(now).then(forecastLineInput);
}

/** Satış tahmini satırı (tahmin): kalite tam, karma ya da ortalama ise */
const tahmin: Collector = {
  source: "satir",
  timeoutMs: 3_000,
  async run(ctx) {
    const load = forecastLoader();
    if (!load) return {};
    const line = forecastLine(await load(ctx.now));
    return { lines: line ? [line] : [] };
  },
};

/** Sıra: bağlam satırları bu sırayla (kasa cirosu, sonra tahmin) */
export const COLLECTORS: Collector[] = [zam, nakit, kasa, komisyon, kasaFiyat, zayi, stok, karaoke, kontrol, tahmin];

// ---------------------------------------------------------------- Toplama ve seçim

const TIMEOUT = Symbol("süre doldu");

/**
 * Bütün kaynaklar aynı anda, her biri en çok min(kendi sınırı, `budgetMs`). Süresi dolan ya da hata veren madde
 * kaynağı `failed`'a girer (günlüğe yazılır); satır kaynağı yalnız satırını düşürür. Geç kalan sorgu arka planda biter,
 * beklenmez. `ran`: madde kaynağı sayısı.
 */
export async function collectWeekly(now: Date, o: { budgetMs: number }): Promise<{ week: WeekInfo; items: WeeklyItem[]; lines: string[]; failed: WeeklySource[]; ran: number }> {
  const today = businessDate(now);
  const week = weekInfo(today);
  let modelP: Promise<Model> | null = null;
  let cashP: Promise<CashReportDTO[]> | null = null;
  const ctx: WeeklyCtx = {
    now,
    today,
    week,
    model: () => (modelP ??= loadModel()),
    cashWeeks: () => (cashP ??= cashReportsBetween(addDays(week.lastFrom, -28), week.lastTo)),
  };
  const budget = Math.max(0, o.budgetMs);
  const results = await Promise.all(
    COLLECTORS.map(async (c) => {
      try {
        const r = await capped<CollectResult | typeof TIMEOUT>(Promise.resolve().then(() => c.run(ctx)), Math.min(c.timeoutMs, budget), TIMEOUT);
        if (r === TIMEOUT) console.error("[haftalik]", c.source, `${Math.min(c.timeoutMs, budget) / 1000} sn içinde okunamadı`);
        return r === TIMEOUT ? null : r;
      } catch (e) {
        console.error("[haftalik]", c.source, e);
        return null;
      }
    }),
  );
  const items: WeeklyItem[] = [];
  const lines: string[] = [];
  const failed: WeeklySource[] = [];
  COLLECTORS.forEach((c, i) => {
    const r = results[i];
    if (!r) {
      if (c.source !== "satir") failed.push(c.source);
      return;
    }
    items.push(...(r.items ?? []));
    lines.push(...(r.lines ?? []));
  });
  return { week, items, lines, failed, ran: COLLECTORS.filter((c) => c.source !== "satir").length };
}

/**
 * Haftanın özeti: kaynaklar, sonra seçim (selectItems). Geçmiş (haftalik.gecmis): bir kez gösterilenler bu hafta
 * dışındaki bütün haftalardan, değersiz maddeler geçen haftadan. Sabah e-postasının bugün (İstanbul gece yarısından
 * beri) başarıyla gönderdiği anahtarlar notification_log'dan. `allFailed`: hiçbir madde kaynağı okunamadı (özet
 * "her şey yolunda" demesin; gönderilmez).
 */
export async function buildWeekly(now: Date, o: { budgetMs: number }): Promise<{ summary: WeeklySummary; allFailed: boolean }> {
  const c = await collectWeekly(now, o);
  const newsKeys = [...new Set(c.items.flatMap((i) => i.newsKeys ?? []))];
  const db = getDb();
  const [[historyRow], sent] = await Promise.all([
    db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, WEEKLY_HISTORY_KEY)).limit(1),
    newsKeys.length
      ? db
          .select({ key: s.notificationLog.key })
          .from(s.notificationLog)
          .where(and(inArray(s.notificationLog.key, newsKeys), eq(s.notificationLog.ok, true), gte(s.notificationLog.sentAt, new Date(`${todayTR(now)}T00:00:00+03:00`))))
      : Promise.resolve([]),
  ]);
  const history = parseWeeklyHistory(historyRow?.value);
  const seenBefore = new Set(Object.entries(history.weeks).flatMap(([id, w]) => (id === c.week.id ? [] : w.keys)));
  const lastWeek = new Set(history.weeks[c.week.prevId]?.keys ?? []);
  const items = selectItems(c.items, { sentToday: new Set(sent.map((r) => r.key)), seenBefore, lastWeek });
  return { summary: { week: c.week, items, lines: c.lines, failed: c.failed }, allFailed: c.failed.length === c.ran };
}
