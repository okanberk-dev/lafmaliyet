import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import { groupSuppliers, supplierResolver, type SupplierCard } from "@/app/panel/tedarikciler/logic";
import { countFactor, shiftMonth, type Model } from "@/lib/calc/engine";
import { latestSalesMonth } from "@/lib/calc/insights";
import type { CountUnit, Ingredient, Unit } from "@/lib/calc/types";
import { businessDate } from "@/lib/cash-report";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { LINKABLE_CATEGORIES } from "@/lib/invoice-linking";
import { deliveryDayFacts, deliveryNotifications, OPEN_ORDER_DAYS, orderState, type OrderStateKey, type OrderTone } from "@/lib/reorder/delivery";
import {
  coverDays,
  defaultOrderUnit,
  inheritLeadDays,
  isCountDay,
  latestOnHand,
  nextCountDay,
  onOrderFor,
  planGroups,
  planLine,
  readySuppliers,
  referencePrice,
  shownCount,
  suggestedLevels,
  suggestTracked,
  type OnHand,
  type PlanGroup,
  type PlanLine,
} from "@/lib/reorder/levels";
import { DEFAULT_REORDER, parseReorderSettings, REORDER_SETTINGS_KEY, type OrderLite, type ReorderDayFacts, type ReorderLine, type ReorderSettings } from "@/lib/reorder/types";
import { monthlyUsage, type IngredientUsage, type UsageEstimate } from "@/lib/reorder/usage";
import { addDays, daysBetween, isLastDayOfMonth, todayTR } from "@/lib/reminders";
import { supplierPriceRows, type PriceLine, type SupplierPriceRow } from "@/lib/supplier-prices";
import { getDb, schema as s } from "@/server/db";
import { sameSupplier } from "@/server/parasut/mapping";

import { loadDailyProductSales } from "./daily-sales";
import { loadModel } from "./dataset";
import { loadSupplierCards, loadSupplierRefs } from "./suppliers";

/**
 * Mal siparişinin verisi (docs/MAL-SIPARISI.md): takip edilen kalemler, eldeki stok (hızlı sayım ya da ay sonu
 * sayımı), gönderilen siparişler, tedarikçinin son fatura kalemleri ve günlük kullanım; sipariş listesi, kalemler,
 * hızlı sayım, gönderilenler, Bugün ve zil bunlardan kurulur. Hesaplar saf modüllerde (src/lib/reorder/*).
 *
 * Personelin gördüğü hızlı sayım (loadQuickCountSheet) maliyet modeli kurmaz, fiyat, tutar ve fatura okumaz; yönetici
 * ekranlarının yükleyicileri fiyatlıdır (tests/mal-siparisi.test.ts kaynaktan denetler).
 */

// ---------------------------------------------------------------- Ayarlar

export async function loadReorderSettings(): Promise<ReorderSettings> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, REORDER_SETTINGS_KEY)).limit(1);
  return row ? parseReorderSettings(row.value) : { ...DEFAULT_REORDER, countWeekdays: [...DEFAULT_REORDER.countWeekdays] };
}

// ---------------------------------------------------------------- Tedarikçiler (Tedarikçiler ekranındaki gruplar)

export interface SupplierLite {
  key: string;
  slug: string;
  name: string;
  card: SupplierCard | null;
  /** Grubun bütün ad anahtarları ve faturalardaki adlar */
  keys: string[];
  names: string[];
}

export interface SupplierIndex {
  groups: SupplierLite[];
  byKey: Map<string, SupplierLite>;
  /** Adın (ve varsa vergi nosunun) tedarikçisi; Tedarikçiler'de böyle bir tedarikçi yoksa null */
  resolve(name: string, taxNumber?: string | null): SupplierLite | null;
  /**
   * Hammaddeler'deki serbest metin ("Sütaş", "Mipak / AEM"): adı ya da diğer adı tutan tedarikçi, yoksa adı benzeyen
   * tek tedarikçi (Paraşüt eşleştirmesindeki sameSupplier); birden çok benzeyen varsa null
   */
  fuzzy(text: string | null): SupplierLite | null;
}

/**
 * Tedarikçiler ekranındaki gruplar ve çözücü (supplierResolver): adlar, diğer adlar ve vergi no. Faturalar okunmaz,
 * yalnız (ad, vergi no) çiftleri; adres parçaları listedekiyle aynı (groupSuppliers → assignSlugs).
 */
export async function loadSupplierIndex(): Promise<SupplierIndex> {
  const [cards, refs] = await Promise.all([loadSupplierCards(), loadSupplierRefs()]);
  const grouped = groupSuppliers(
    refs.map((r) => ({ supplier: r.supplier, supplierTaxNumber: r.supplierTaxNumber ?? null, date: r.date ?? "", payable: 0, unpaid: false })),
    cards,
    { today: todayTR(), termDays: 0 },
  );
  const groups: SupplierLite[] = grouped.map((g) => ({ key: g.key, slug: g.slug, name: g.name, card: g.card, keys: g.keys, names: g.names }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  // Çözücünün kimliği (kart:<id> / ad:<anahtar>) → grup
  const byId = new Map(groups.map((g) => [g.card ? `kart:${g.card.id}` : `ad:${g.key}`, g]));
  const { resolve } = supplierResolver(cards, refs);
  return {
    groups,
    byKey,
    resolve: (name, taxNumber) => (name.trim() ? (byId.get(resolve(name, taxNumber).id) ?? null) : null),
    fuzzy: (text) => {
      const k = text ? supplierMatchKey(text) : "";
      if (!k) return null;
      const exact = groups.find((g) => g.keys.includes(k));
      if (exact) return exact;
      const similar = groups.filter((g) => [g.name, ...g.names].some((n) => sameSupplier(n, text!)));
      return similar.length === 1 ? similar[0] : null;
    },
  };
}

// ---------------------------------------------------------------- Takip edilen kalemler

export interface TrackedRow {
  ingredientId: number;
  parBase: number | null;
  leadDays: number | null;
  supplier: string | null;
  orderName: string | null;
  orderUnit: string | null;
  orderUnitSize: number | null;
  updatedAt: Date;
}

/** Takip edilen kalemlerin kendi alanları (hammadde bilgisi modelden ya da ayrı sorgudan) */
export async function loadTracked(): Promise<TrackedRow[]> {
  const r = s.reorderItems;
  return getDb()
    .select({
      ingredientId: r.ingredientId,
      parBase: r.parBase,
      leadDays: r.leadDays,
      supplier: r.supplier,
      orderName: r.orderName,
      orderUnit: r.orderUnit,
      orderUnitSize: r.orderUnitSize,
      updatedAt: r.updatedAt,
    })
    .from(r);
}

/** Hammadde sayılabilir ve takip edilebilir: etkin, sayım birimi var, su / buz değil */
export const isTrackable = (i: Pick<Ingredient, "active" | "countUnit" | "priceSource">) => i.active && i.countUnit !== null && i.priceSource !== "water";

// ---------------------------------------------------------------- Eldeki stok

/**
 * Kalem başına eldeki: en yeni hızlı sayım ya da bu ayın / geçen ayın ay sonu sayımı (hangisi yeniyse; latestOnHand).
 * İki sorgu. `today` sayımın ayları için (takvim günü, Türkiye).
 */
export async function loadOnHand(ids: number[], today: string, countUnits: Map<number, string | null>): Promise<Map<number, OnHand>> {
  if (!ids.length) return new Map();
  const db = getDb();
  const q = s.quickCounts;
  const month = today.slice(0, 7);
  const [quick, monthEnd] = await Promise.all([
    db
      .selectDistinctOn([q.ingredientId], { ingredientId: q.ingredientId, qty: q.qty, factor: q.factor, countedAt: q.countedAt, day: q.day, by: q.countedByName })
      .from(q)
      .where(inArray(q.ingredientId, ids))
      .orderBy(q.ingredientId, desc(q.countedAt)),
    db
      .select({ ingredientId: s.stockCounts.ingredientId, qty: s.stockCounts.qty, factor: s.stockCounts.factor, updatedAt: s.stockCounts.updatedAt, by: s.stockCounts.countedBy })
      .from(s.stockCounts)
      .where(and(inArray(s.stockCounts.ingredientId, ids), inArray(s.stockCounts.month, [month, shiftMonth(month, -1)]))),
  ]);
  const quickBy = new Map(quick.map((r) => [r.ingredientId, r]));
  const monthBy = new Map<number, (typeof monthEnd)[number]>();
  for (const r of monthEnd) {
    const cur = monthBy.get(r.ingredientId);
    if (!cur || r.updatedAt > cur.updatedAt) monthBy.set(r.ingredientId, r);
  }
  const out = new Map<number, OnHand>();
  for (const id of ids) {
    const qr = quickBy.get(id);
    const mr = monthBy.get(id);
    const oh = latestOnHand(
      qr ? { qty: qr.qty, factor: qr.factor, countedAt: qr.countedAt.toISOString(), day: qr.day, by: qr.by } : null,
      mr
        ? { qty: mr.qty, factor: mr.factor ?? countFactor(countUnits.get(id) ?? null), updatedAt: mr.updatedAt.toISOString(), day: businessDate(mr.updatedAt), by: mr.by }
        : null,
    );
    if (oh) out.set(id, oh);
  }
  return out;
}

/**
 * Kalemlerin en yeni sayımı (eldeki stokla aynı kaynaklar: hızlı sayım ya da bu / geçen ayın ay sonu sayımı), anı ve iş
 * günü; "Geldi"nin anı buna göre yazılır (receivedAtFor). Hiç sayılmadıysa null. İki küçük sorgu; fiyat okumaz.
 */
export async function latestCountOf(ids: number[], today: string): Promise<{ at: string; day: string } | null> {
  if (!ids.length) return null;
  const db = getDb();
  const q = s.quickCounts;
  const month = today.slice(0, 7);
  const [[quick], [stock]] = await Promise.all([
    db.select({ at: q.countedAt, day: q.day }).from(q).where(inArray(q.ingredientId, ids)).orderBy(desc(q.countedAt)).limit(1),
    db
      .select({ at: s.stockCounts.updatedAt })
      .from(s.stockCounts)
      .where(and(inArray(s.stockCounts.ingredientId, ids), inArray(s.stockCounts.month, [month, shiftMonth(month, -1)])))
      .orderBy(desc(s.stockCounts.updatedAt))
      .limit(1),
  ]);
  if (stock && (!quick || stock.at > quick.at)) return { at: stock.at.toISOString(), day: businessDate(stock.at) };
  return quick ? { at: quick.at.toISOString(), day: quick.day } : null;
}

// ---------------------------------------------------------------- Gönderilen siparişler

type OrderRow = typeof s.supplierOrders.$inferSelect;

export function toOrderLite(r: OrderRow): OrderLite {
  return {
    id: r.id,
    supplier: r.supplier,
    sentAt: r.sentAt.toISOString(),
    sentDay: todayTR(r.sentAt),
    expectedOn: r.expectedOn,
    status: r.status,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    receivedByName: r.receivedByName,
    invoiceId: r.invoiceId,
    manualMatch: r.manualMatch,
    lines: Array.isArray(r.lines) ? r.lines : [],
    check: r.deliveryCheck ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    closedByName: r.closedByName,
    closeNote: r.closeNote,
    phone: r.phone,
    channel: r.channel,
    message: r.message,
    note: r.note,
    sentByName: r.sentByName,
  };
}

/** Son `sinceDays` günde gönderilen siparişler (en yeni önce); `status` verilirse yalnız onlar */
export async function loadOrders(opts: { sinceDays: number; status?: OrderLite["status"][] }): Promise<OrderLite[]> {
  const o = s.supplierOrders;
  const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
  const rows = await getDb()
    .select()
    .from(o)
    .where(and(gte(o.sentAt, since), opts.status?.length ? inArray(o.status, opts.status) : undefined))
    .orderBy(desc(o.sentAt), desc(o.id));
  return rows.map(toOrderLite);
}

// ---------------------------------------------------------------- Tedarikçinin fatura kalemleri

/** Fiyat geçmişi en çok bu kadar geriye okunur (en ucuz ve son alınan bunun içinde) */
const PURCHASE_LOOKBACK_DAYS = 400;

export interface LastLine {
  productName: string;
  unit: string | null;
  factor: number;
  quantity: number;
  date: string;
}

export interface PurchaseInfo {
  /** Tedarikçi tedarikçi fiyat (Hammaddeler › Tedarikçilere göre fiyat ile aynı hesap) */
  rows: SupplierPriceRow[];
  /** Tedarikçi anahtarı → en yeni (bedava ve iade olmayan) kalemi */
  lastLine: Map<string, LastLine>;
}

/**
 * Kalemlerin bağlı Paraşüt ürünlerinin fatura kalemleri (kafe dışı faturalar hariç, son 400 gün), tek sorgu. Faturanın
 * tedarikçisi Tedarikçiler'deki gruptan (ad ve vergi no); burada ad eşleştirmesi yapılmaz.
 */
export async function loadPurchases(ingredientIds: number[], index: SupplierIndex, today: string): Promise<Map<number, PurchaseInfo>> {
  const out = new Map<number, PurchaseInfo>();
  if (!ingredientIds.length) return out;
  const l = s.parasutBillLines;
  const k = s.parasutProductLinks;
  const i = s.invoices;
  const rows = await getDb()
    .select({
      ingredientId: k.ingredientId,
      factor: k.factor,
      invoiceId: i.id,
      date: i.date,
      invoiceNo: i.invoiceNo,
      supplier: i.supplier,
      supplierTaxNumber: i.supplierTaxNumber,
      productName: l.productName,
      quantity: l.quantity,
      unit: l.unit,
      netTotal: l.netTotal,
    })
    .from(l)
    .innerJoin(k, eq(k.productKey, l.productKey))
    .innerJoin(i, eq(i.id, l.invoiceId))
    .where(and(inArray(k.ingredientId, ingredientIds), notInArray(i.category, SEPARATE_CATEGORIES), gte(i.date, addDays(today, -PURCHASE_LOOKBACK_DAYS))));
  const lines = new Map<number, PriceLine[]>();
  for (const r of rows) {
    const g = index.resolve(r.supplier, r.supplierTaxNumber);
    if (!g) continue;
    const list = lines.get(r.ingredientId) ?? [];
    list.push({ ...r, supplierKey: g.key, supplierName: g.name, supplierSlug: g.slug });
    lines.set(r.ingredientId, list);
  }
  for (const [id, list] of lines) {
    const lastLine = new Map<string, LastLine>();
    const newest = [...list].filter((x) => x.quantity > 0 && x.netTotal > 0 && x.factor > 0).sort((a, b) => b.date.localeCompare(a.date) || b.invoiceId - a.invoiceId);
    for (const x of newest) {
      if (!lastLine.has(x.supplierKey)) lastLine.set(x.supplierKey, { productName: x.productName, unit: x.unit, factor: x.factor, quantity: x.quantity, date: x.date });
    }
    out.set(id, { rows: supplierPriceRows(list, { today }).rows, lastLine });
  }
  return out;
}

// ---------------------------------------------------------------- Günlük kullanım

/** Günlük döküm geldiğinde bakılacak pencere (gün) */
const DAILY_WINDOW_DAYS = 28;

/**
 * Günlük kullanım. ModPOS'un günlük ürün dökümü (R18 ağzı) bugün yok, null döner: referans satış ayının kullanımı
 * (monthlyUsage). Döküm gelince günlük kullanım burada hesaplanır (docs/MAL-SIPARISI.md › Kullanım ağzı); okuyanların
 * hiçbiri değişmez.
 */
export async function loadUsage(model: Model, today: string): Promise<UsageEstimate | null> {
  const daily = await loadDailyProductSales(addDays(today, -DAILY_WINDOW_DAYS), addDays(today, -1));
  if (daily?.length) console.warn(`[mal-siparisi] ${daily.length} günlük satış satırı var ama günlük kullanım henüz yazılmadı; aylık veri kullanılıyor`);
  return monthlyUsage(model, latestSalesMonth(model));
}

// ---------------------------------------------------------------- Öneri listesinin kurulması

export type SupplierSource = "elle" | "son-alinan" | "hammadde";

/** Bir takip satırının bütün hesabı (sipariş listesi, kalemler ve gönderme aynı yerden) */
export interface ItemInfo {
  row: TrackedRow;
  ing: Ingredient;
  /** Etkin ve sayım birimli (listede, sayımda) */
  live: boolean;
  supplier: SupplierLite | null;
  supplierSource: SupplierSource | null;
  /** Kayıtlı ad artık hiçbir tedarikçiye çözülmüyor */
  missingSupplier: string | null;
  purchases: PurchaseInfo | null;
  /** Seçili tedarikçinin son kalemi (sipariş biriminin ve adının varsayılanı) */
  lastLine: LastLine | null;
  defaultUnit: { unit: string; size: number };
  defaultName: string;
  leadDays: number;
  leadSource: "kalem" | "tedarikci" | "genel";
  usage: IngredientUsage | null;
  /** Etkin kalemin öneri satırı; pasifte null */
  plan: PlanLine | null;
}

export interface ReorderData {
  settings: ReorderSettings;
  today: string;
  now: Date;
  usage: UsageEstimate | null;
  index: SupplierIndex;
  items: ItemInfo[];
  groups: PlanGroup[];
  orders: OrderLite[];
  /** En yeni sayım (hızlı ya da ay sonu) */
  lastCountAt: string | null;
  lastCountDay: string | null;
  model: Model;
}

/**
 * Takip edilen kalemlerin öneri listesi: tedarikçi (D5), sipariş birimi ve adı (D6), teslim süresi, eldeki, siparişte,
 * beklenen fiyat ve hedef. `model` verilmezse kurulur (Bugün kendi modelini verir).
 */
export async function loadReorderData(model?: Model): Promise<ReorderData> {
  const [m, settings, tracked, index, orders] = await Promise.all([
    model ? Promise.resolve(model) : loadModel(),
    loadReorderSettings(),
    loadTracked(),
    loadSupplierIndex(),
    loadOrders({ sinceDays: OPEN_ORDER_DAYS }),
  ]);
  const now = new Date();
  const today = todayTR(now);
  for (const o of orders) o.supplierKey = index.resolve(o.supplier)?.key ?? null;
  const known = tracked.filter((t) => m.ingById.has(t.ingredientId));
  const ids = known.map((t) => t.ingredientId);
  const [onHand, purchases, usage] = await Promise.all([
    loadOnHand(ids, today, new Map(ids.map((id) => [id, m.ingById.get(id)!.countUnit]))),
    loadPurchases(ids, index, today),
    loadUsage(m, today),
  ]);

  // Tedarikçi: kayıtlı ad, yoksa son alınan, yoksa Hammaddeler'deki metin
  const pre = known.map((row) => {
    const ing = m.ingById.get(row.ingredientId)!;
    const p = purchases.get(row.ingredientId) ?? null;
    let supplier: SupplierLite | null = null;
    let supplierSource: SupplierSource | null = null;
    let missingSupplier: string | null = null;
    if (row.supplier) {
      supplier = index.resolve(row.supplier);
      if (supplier) supplierSource = "elle";
      else missingSupplier = row.supplier;
    } else {
      const newest = [...(p?.rows ?? [])].sort((a, b) => b.last.date.localeCompare(a.last.date))[0];
      supplier = newest ? (index.byKey.get(newest.key) ?? null) : null;
      if (supplier) supplierSource = "son-alinan";
      else {
        supplier = index.fuzzy(ing.supplier);
        if (supplier) supplierSource = "hammadde";
      }
    }
    return { row, ing, p, supplier, supplierSource, missingSupplier };
  });
  const leadPool = pre.map((x) => ({ supplierKey: x.supplier?.key ?? null, leadDays: x.row.leadDays }));
  /** Aynı tedarikçinin teslim süresi yazılmış öteki kalemleri */
  const sameSupplierLeads = (key: string | null) => (key === null ? [] : leadPool.filter((t) => t.supplierKey === key && t.leadDays !== null));

  const items: ItemInfo[] = pre.map(({ row, ing, p, supplier, supplierSource, missingSupplier }) => {
    const lastLine = supplier ? (p?.lastLine.get(supplier.key) ?? null) : null;
    const defaultUnit = defaultOrderUnit(lastLine, ing);
    const defaultName = lastLine?.productName ?? ing.packageDesc ?? ing.name;
    const leadDays = row.leadDays ?? inheritLeadDays(supplier?.key ?? null, leadPool, settings.defaultLeadDays);
    const leadSource = row.leadDays !== null ? "kalem" : sameSupplierLeads(supplier?.key ?? null).length ? "tedarikci" : "genel";
    const u = usage ? (usage.byIngredient.get(ing.id) ?? { perDay: 0, sales: 0, online: 0, waste: 0 }) : null;
    const live = isTrackable(ing);
    const oh = onHand.get(ing.id) ?? null;
    const price = referencePrice({
      supplierLast: supplier ? (p?.rows.find((r) => r.key === supplier.key)?.last.unitPrice ?? null) : null,
      unitCost: m.unitCost.get(ing.id) ?? null,
      isEstimate: ing.isEstimate,
    });
    const plan = live
      ? planLine(
          {
            ingredientId: ing.id,
            name: ing.name,
            baseUnit: ing.unit,
            countUnit: ing.countUnit!,
            countFactor: countFactor(ing.countUnit),
            supplierKey: supplier?.key ?? null,
            supplierName: supplier?.name ?? null,
            leadDays,
            orderName: row.orderName ?? defaultName,
            orderUnit: row.orderUnit ?? defaultUnit.unit,
            orderUnitSize: row.orderUnitSize ?? defaultUnit.size,
            parBase: row.parBase,
            perDay: u ? u.perDay : null,
            onHand: oh,
            onOrder: onOrderFor(orders, ing.id, oh?.at ?? null, today).base,
            expectedUnitPrice: price?.unitPrice ?? null,
            priceEstimated: price?.estimated ?? false,
          },
          settings,
          now,
        )
      : null;
    return { row, ing, live, supplier, supplierSource, missingSupplier, purchases: p, lastLine, defaultUnit, defaultName, leadDays, leadSource, usage: u, plan };
  });

  const lastCount = items
    .map((x) => x.plan?.onHand ?? null)
    .filter((x): x is OnHand => x !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return {
    settings,
    today,
    now,
    usage,
    index,
    items,
    groups: planGroups(items.flatMap((x) => (x.plan ? [x.plan] : []))),
    orders,
    lastCountAt: lastCount?.at ?? null,
    lastCountDay: lastCount?.day ?? null,
    model: m,
  };
}

// ---------------------------------------------------------------- Sipariş listesi (/panel/mal-siparisi)

export interface PlanLineView {
  ingredientId: number;
  name: string;
  orderName: string;
  unit: string;
  unitSize: number;
  baseUnit: Unit;
  countUnit: string;
  countFactor: number;
  /** Önerilen birim (0: yeterli, sayılmadı, hedef yok) */
  packs: number;
  status: PlanLine["status"];
  critical: boolean;
  stale: boolean;
  onHand: number | null;
  par: number | null;
  min: number | null;
  onOrder: number;
  /** 1 birimin tahmini tutarı (KDV hariç); fiyat bilinmiyorsa null */
  packPrice: number | null;
  priceEstimated: boolean;
}

export interface PlanGroupView {
  key: string | null;
  name: string | null;
  slug: string | null;
  phone: string | null;
  contactName: string | null;
  /** Teslim süresi (önerilen kalemlerin en uzunu) */
  lead: number;
  /** Son sayımdan sonra gönderilen siparişin anı (rozet) */
  sentAt: string | null;
  lines: PlanLineView[];
}

export interface OpenOrderView {
  id: number;
  supplier: string;
  sentDay: string;
  state: { key: OrderStateKey; label: string; tone: OrderTone };
  received: boolean;
  hasInvoice: boolean;
}

export interface OrderPlanView {
  signature: string;
  today: string;
  /** Takipte (etkin) kalem */
  total: number;
  /** Son hızlı sayım: gün, an, kim, o gün sayılan kalem */
  lastQuick: { day: string; at: string; by: string; counted: number } | null;
  /** Son sayımdan (hızlı ya da ay sonu) bu yana gün; sayım yoksa null */
  staleDays: number | null;
  /** Günlük kullanımın ayı ve eski mi (bu aydan iki aydan fazla önce) */
  basis: { month: string; label: string; old: boolean } | null;
  groups: PlanGroupView[];
  openOrders: OpenOrderView[];
}

const toLineView = (l: PlanLine): PlanLineView => ({
  ingredientId: l.ingredientId,
  name: l.name,
  orderName: l.orderName,
  unit: l.orderUnit,
  unitSize: l.orderUnitSize,
  baseUnit: l.baseUnit,
  countUnit: l.countUnit,
  countFactor: l.countFactor,
  packs: l.packs,
  status: l.status,
  critical: l.critical,
  stale: l.stale,
  onHand: l.onHand?.base ?? null,
  par: l.par,
  min: l.min,
  onOrder: l.onOrder,
  packPrice: l.expectedUnitPrice !== null ? l.expectedUnitPrice * l.orderUnitSize : null,
  priceEstimated: l.priceEstimated,
});

/** Son hızlı sayım (takipteki kalemler): günü, en son kaydın anı ve kişisi, o gün sayılan kalem */
async function lastQuickCount(ids: number[]): Promise<OrderPlanView["lastQuick"]> {
  if (!ids.length) return null;
  const q = s.quickCounts;
  const db = getDb();
  const [last] = await db
    .select({ day: q.day, at: q.countedAt, by: q.countedByName })
    .from(q)
    .where(inArray(q.ingredientId, ids))
    .orderBy(desc(q.countedAt))
    .limit(1);
  if (!last) return null;
  const [{ n }] = await db
    .select({ n: sql<number>`count(distinct ${q.ingredientId})::int` })
    .from(q)
    .where(and(eq(q.day, last.day), inArray(q.ingredientId, ids)));
  return { day: last.day, at: last.at.toISOString(), by: last.by, counted: n };
}

/** Sipariş listesi ekranı (yönetici; fiyatlı) */
export async function loadOrderPlan(): Promise<OrderPlanView> {
  const d = await loadReorderData();
  const liveIds = d.items.filter((x) => x.live).map((x) => x.ing.id);
  const lastQuick = await lastQuickCount(liveIds);
  const groups: PlanGroupView[] = d.groups.map((g) => {
    const sup = g.supplierKey ? (d.index.byKey.get(g.supplierKey) ?? null) : null;
    const sent = d.lastCountAt
      ? d.orders
          .filter((o) => o.status !== "cancelled" && o.supplierKey === g.supplierKey && g.supplierKey !== null && Date.parse(o.sentAt) > Date.parse(d.lastCountAt!))
          .map((o) => o.sentAt)
          .sort()
          .at(-1)
      : undefined;
    return {
      key: g.supplierKey,
      name: g.supplierName,
      slug: sup?.slug ?? null,
      phone: sup?.card?.phone ?? null,
      contactName: sup?.card?.contactName ?? null,
      lead: g.lead,
      sentAt: sent ?? null,
      lines: g.lines.map(toLineView),
    };
  });
  const basisMonth = d.usage?.basis.month ?? null;
  return {
    signature: d.settings.signature,
    today: d.today,
    total: liveIds.length,
    lastQuick,
    staleDays: d.lastCountAt ? daysBetween(todayTR(new Date(d.lastCountAt)), d.today) : null,
    basis: basisMonth ? { month: basisMonth, label: d.usage!.basis.label, old: basisMonth < shiftMonth(d.today.slice(0, 7), -2) } : null,
    groups,
    openOrders: d.orders
      .filter((o) => o.status === "open")
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
      .map((o) => ({ id: o.id, supplier: o.supplier, sentDay: o.sentDay, state: orderState(o, d.today), received: o.receivedAt !== null, hasInvoice: o.invoiceId !== null })),
  };
}

// ---------------------------------------------------------------- Gönderilecek siparişin kopyası (recordOrderSent)

/**
 * Gönderilen siparişin satırları sunucudaki güncel veriden kurulur; istemciden yalnız miktar alınır. Kalem takipte
 * olmalı ve o tedarikçinin listesinde durmalı; değilse hangisi olduğu döner (eylem hata verir).
 */
export async function orderSnapshot(
  supplierKey: string,
  wanted: { ingredientId: number; qty: number }[],
): Promise<{ supplier: SupplierLite; lines: ReorderLine[]; maxLead: number } | { error: string }> {
  const d = await loadReorderData();
  const supplier = d.index.byKey.get(supplierKey);
  if (!supplier) return { error: "Tedarikçi bulunamadı; sayfayı yenileyin." };
  const lines: ReorderLine[] = [];
  for (const w of wanted) {
    const it = d.items.find((x) => x.ing.id === w.ingredientId);
    if (!it?.plan) return { error: `${it?.ing.name ?? "Bir kalem"} sipariş listesinde değil; sayfayı yenileyin.` };
    if (it.plan.supplierKey !== supplierKey) return { error: `${it.ing.name} bu tedarikçinin listesinde değil; sayfayı yenileyin.` };
    const p = it.plan;
    lines.push({
      ingredientId: p.ingredientId,
      name: p.name,
      orderName: p.orderName,
      qty: w.qty,
      unit: p.orderUnit,
      unitSize: p.orderUnitSize,
      baseUnit: p.baseUnit,
      countUnit: p.countUnit,
      leadDays: p.leadDays,
      suggested: p.status === "sayilmadi" || p.status === "hedef-yok" ? null : p.packs,
      onHand: p.onHand?.base ?? null,
      par: p.par,
      expectedUnitPrice: p.expectedUnitPrice,
      priceEstimated: p.priceEstimated,
    });
  }
  return { supplier, lines, maxLead: Math.max(0, ...lines.map((l) => l.leadDays)) };
}

// ---------------------------------------------------------------- Kalemler (/panel/mal-siparisi/kalemler)

export interface SupplierOption {
  key: string;
  name: string;
}

export interface ItemView {
  ingredientId: number;
  name: string;
  packageDesc: string | null;
  baseUnit: Unit;
  countUnit: string | null;
  countFactor: number;
  live: boolean;
  inactiveReason: "pasif" | "sayilmaz" | null;
  supplier: { key: string; name: string; source: SupplierSource } | null;
  missingSupplier: string | null;
  /** Kayıtlı alanlar (sayım biriminde: hedef ve birimin içeriği) */
  saved: { supplier: string | null; parCount: number | null; leadDays: number | null; orderName: string | null; orderUnit: string | null; orderUnitCount: number | null };
  /** Varsayılanlar (placeholder) */
  defaults: {
    supplier: { name: string; source: SupplierSource; date: string | null } | null;
    orderName: string;
    orderUnit: string;
    orderUnitCount: number;
    leadDays: number;
    leadFrom: "tedarikci" | "genel";
  };
  /** Son fatura kalemi ("Son faturada: 120 Adet, 1 Adet = 1 LT") */
  lastLine: { quantity: number; unit: string | null; factorCount: number } | null;
  leadDays: number;
  perDay: number | null;
  /** Öneri (sayım biriminde) ve kullanılan hedef, en az */
  suggestedCount: number | null;
  parCount: number | null;
  minCount: number | null;
  /** Tedarikçilere göre son fiyatlar (bu kalemi satanlar) */
  sellers: { key: string; name: string; date: string; unitPrice: number; cheapest: boolean }[];
}

export interface ItemGroupView {
  key: string | null;
  name: string | null;
  lead: number;
  items: ItemView[];
}

export interface ReorderItemsView {
  settings: ReorderSettings;
  coverDays: number;
  basis: { label: string; standardDays: number } | null;
  groups: ItemGroupView[];
  count: number;
  /** Seçilebilecek öteki tedarikçiler: kartı ya da mal faturası olanlar */
  suppliers: SupplierOption[];
  /** Takibe önerilenler (aylık tutara göre) ve aranabilecek bütün kalemler */
  suggestions: { id: number; name: string; monthly: number | null }[];
  addable: { id: number; name: string; packageDesc: string | null; countUnit: string }[];
}

const inCount = (base: number | null, f: number) => (base === null ? null : base / (f > 0 ? f : 1));

/** Kalemler ekranı (yönetici; fiyatlı) */
export async function loadReorderItemsView(): Promise<ReorderItemsView> {
  const d = await loadReorderData();
  const goods = await getDb()
    .selectDistinct({ supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber })
    .from(s.invoices)
    .where(inArray(s.invoices.category, LINKABLE_CATEGORIES));
  const goodsKeys = new Set(goods.map((g) => d.index.resolve(g.supplier, g.supplierTaxNumber)?.key).filter((k): k is string => Boolean(k)));
  const cover = coverDays(d.settings.countWeekdays);

  const views: ItemView[] = d.items.map((x) => {
    const f = countFactor(x.ing.countUnit);
    // Kalemin kendi süresi silinirse: aynı tedarikçinin öteki kalemlerinden, yoksa genel ayardan
    const key = x.supplier?.key ?? null;
    const others = key === null ? [] : d.items.filter((y) => y !== x && y.supplier?.key === key && y.row.leadDays !== null);
    const inherited = inheritLeadDays(key, others.map((y) => ({ supplierKey: key, leadDays: y.row.leadDays })), d.settings.defaultLeadDays);
    const newest = [...(x.purchases?.rows ?? [])].sort((a, b) => b.last.date.localeCompare(a.last.date))[0];
    const defaultSupplier = (() => {
      if (newest) {
        const g = d.index.byKey.get(newest.key);
        if (g) return { name: g.name, source: "son-alinan" as const, date: newest.last.date };
      }
      const g = d.index.fuzzy(x.ing.supplier);
      return g ? { name: g.name, source: "hammadde" as const, date: null } : null;
    })();
    const levels = suggestedLevels({
      perDay: x.usage ? x.usage.perDay : null,
      leadDays: x.leadDays,
      coverDays: cover,
      marginPct: d.settings.marginPct,
      countUnit: x.ing.countUnit ?? "ADET",
      countFactor: f,
    });
    const par = x.row.parBase ?? levels?.par ?? null;
    return {
      ingredientId: x.ing.id,
      name: x.ing.name,
      packageDesc: x.ing.packageDesc,
      baseUnit: x.ing.unit,
      countUnit: x.ing.countUnit,
      countFactor: f,
      live: x.live,
      inactiveReason: x.live ? null : x.ing.active ? "sayilmaz" : "pasif",
      supplier: x.supplier && x.supplierSource ? { key: x.supplier.key, name: x.supplier.name, source: x.supplierSource } : null,
      missingSupplier: x.missingSupplier,
      saved: {
        supplier: x.row.supplier,
        parCount: inCount(x.row.parBase, f),
        leadDays: x.row.leadDays,
        orderName: x.row.orderName,
        orderUnit: x.row.orderUnit,
        orderUnitCount: inCount(x.row.orderUnitSize, f),
      },
      defaults: {
        supplier: defaultSupplier,
        orderName: x.defaultName,
        orderUnit: x.defaultUnit.unit,
        orderUnitCount: x.defaultUnit.size / f,
        leadDays: inherited,
        leadFrom: others.length ? "tedarikci" : "genel",
      },
      lastLine: x.lastLine ? { quantity: x.lastLine.quantity, unit: x.lastLine.unit, factorCount: x.lastLine.factor / f } : null,
      leadDays: x.leadDays,
      perDay: x.usage ? x.usage.perDay : null,
      suggestedCount: levels ? levels.par / f : null,
      parCount: par === null ? null : par / f,
      minCount: levels ? levels.min / f : null,
      sellers: (x.purchases?.rows ?? []).map((r) => ({ key: r.key, name: r.name, date: r.last.date, unitPrice: r.last.unitPrice, cheapest: r.cheapest })),
    };
  });

  // Tedarikçi tedarikçi gruplar: seçilmiş tedarikçiler ada göre, sonra tedarikçisi seçilmemişler
  const byGroup = new Map<string | null, ItemView[]>();
  for (const v of views) byGroup.set(v.supplier?.key ?? null, [...(byGroup.get(v.supplier?.key ?? null) ?? []), v]);
  const groups: ItemGroupView[] = [...byGroup]
    .map(([key, items]) => ({
      key,
      name: key ? (d.index.byKey.get(key)?.name ?? null) : null,
      // Grubun teslim süresi: kalemlerinde en çok geçen
      lead: inheritLeadDays(key ?? "", items.map((i) => ({ supplierKey: key ?? "", leadDays: i.leadDays })), d.settings.defaultLeadDays),
      items: items.sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name, "tr")),
    }))
    .sort((a, b) => (a.key === null) !== (b.key === null) ? (a.key === null ? 1 : -1) : (a.name ?? "").localeCompare(b.name ?? "", "tr"));

  const trackedIds = new Set(d.items.map((x) => x.ing.id));
  const ingredients = d.model.ds.ingredients;
  const suggestionIds = suggestTracked(
    ingredients.map((i) => ({
      id: i.id,
      countable: isTrackable(i),
      tracked: trackedIds.has(i.id),
      perDay: d.usage ? (d.usage.byIngredient.get(i.id)?.perDay ?? 0) : null,
      unitCost: d.model.unitCost.get(i.id) ?? 0,
    })),
  );
  const ingById = d.model.ingById;
  return {
    settings: d.settings,
    coverDays: cover,
    basis: d.usage ? { label: d.usage.basis.label, standardDays: d.usage.basis.standardDays } : null,
    groups,
    count: views.length,
    suppliers: d.index.groups
      .filter((g) => g.card || goodsKeys.has(g.key))
      .map((g) => ({ key: g.key, name: g.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr")),
    suggestions: suggestionIds.map((id) => {
      const perDay = d.usage?.byIngredient.get(id)?.perDay ?? 0;
      const cost = d.model.unitCost.get(id) ?? 0;
      return { id, name: ingById.get(id)?.name ?? "", monthly: cost > 0 ? perDay * 30 * cost : null };
    }),
    addable: ingredients
      .filter((i) => isTrackable(i) && !trackedIds.has(i.id))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"))
      .map((i) => ({ id: i.id, name: i.name, packageDesc: i.packageDesc, countUnit: i.countUnit! })),
  };
}

// ---------------------------------------------------------------- Hızlı sayım (/panel/hizli-sayim; iki rol, fiyatsız)

export interface QuickCountItem {
  id: number;
  name: string;
  packageDesc: string | null;
  countUnit: CountUnit;
  /** Bugünden önceki son sayım (hızlı ya da ay sonu), bugünkü sayım biriminde */
  last: { qty: number; day: string } | null;
  /** Bugün (iş günü) kaydedilen hızlı sayım */
  today: { qty: number; by: string; at: string } | null;
}

export interface QuickCountSheet {
  day: string;
  countDay: boolean;
  nextCountDay: string;
  /** Ayın son günü: ay sonu Stok sayımı bunun yerine geçer */
  monthEnd: boolean;
  groups: { name: string; items: QuickCountItem[] }[];
  total: number;
  last: { day: string; by: string } | null;
  /** Gelmesi beklenen, gelmedi işaretlenmemiş, faturası olmayan siparişler (yalnız kalem adı ve miktar) */
  due: { id: number; supplier: string; sentDay: string; lines: { orderName: string; qty: number; unit: string }[] }[];
}

/**
 * Hızlı sayım ekranının verisi. Personel de açar: maliyet modeli kurulmaz; fiyat, tutar, fatura ve karşılaştırma
 * okunmaz (siparişlerden yalnız tedarikçi, gün, kalem adı ve miktar). Dört küçük sorgu.
 */
export async function loadQuickCountSheet(): Promise<QuickCountSheet> {
  const db = getDb();
  const now = new Date();
  const day = businessDate(now);
  const today = todayTR(now);
  const i = s.ingredients;
  const q = s.quickCounts;
  const o = s.supplierOrders;
  const [settings, rows, due] = await Promise.all([
    loadReorderSettings(),
    db
      .select({ id: i.id, name: i.name, packageDesc: i.packageDesc, countUnit: i.countUnit, countGroup: i.countGroup, sortOrder: i.sortOrder })
      .from(s.reorderItems)
      .innerJoin(i, eq(i.id, s.reorderItems.ingredientId))
      .where(and(eq(i.active, true), isNotNull(i.countUnit), sql`${i.priceSource} <> 'water'`))
      .orderBy(asc(i.sortOrder), asc(i.id)),
    db
      .select({ id: o.id, supplier: o.supplier, sentAt: o.sentAt, lines: o.lines })
      .from(o)
      .where(and(eq(o.status, "open"), sql`${o.receivedAt} is null`, sql`${o.invoiceId} is null`, sql`${o.expectedOn} <= ${today}`))
      .orderBy(asc(o.sentAt)),
  ]);
  const ids = rows.map((r) => r.id);
  const [todays, before, monthEnd, lastAny] = ids.length
    ? await Promise.all([
        db
          .select({ id: q.ingredientId, qty: q.qty, factor: q.factor, by: q.countedByName, at: q.countedAt })
          .from(q)
          .where(and(eq(q.day, day), inArray(q.ingredientId, ids))),
        db
          .selectDistinctOn([q.ingredientId], { id: q.ingredientId, qty: q.qty, factor: q.factor, day: q.day, at: q.countedAt })
          .from(q)
          .where(and(lt(q.day, day), inArray(q.ingredientId, ids)))
          .orderBy(q.ingredientId, desc(q.countedAt)),
        db
          .select({ id: s.stockCounts.ingredientId, qty: s.stockCounts.qty, factor: s.stockCounts.factor, at: s.stockCounts.updatedAt })
          .from(s.stockCounts)
          .where(and(inArray(s.stockCounts.ingredientId, ids), inArray(s.stockCounts.month, [today.slice(0, 7), shiftMonth(today.slice(0, 7), -1)]))),
        db.select({ day: q.day, by: q.countedByName }).from(q).where(inArray(q.ingredientId, ids)).orderBy(desc(q.countedAt)).limit(1),
      ])
    : [[], [], [], []];
  const todayBy = new Map(todays.map((r) => [r.id, r]));
  const beforeBy = new Map(before.map((r) => [r.id, r]));
  const items: { group: string; item: QuickCountItem }[] = rows.map((r) => {
    const f = countFactor(r.countUnit);
    const t = todayBy.get(r.id);
    // "Geçen": bugünden önceki son hızlı sayım ya da (daha yeniyse) ay sonu sayımı, bugünkü sayım biriminde
    const b = beforeBy.get(r.id);
    const m = monthEnd
      .filter((x) => x.id === r.id && businessDate(x.at) < day)
      .sort((a, z) => z.at.getTime() - a.at.getTime())[0];
    const prev =
      b && (!m || b.at >= m.at)
        ? { qty: (b.qty * b.factor) / f, day: b.day }
        : m
          ? { qty: (m.qty * (m.factor ?? f)) / f, day: businessDate(m.at) }
          : null;
    return {
      group: r.countGroup ?? "Diğer",
      item: {
        id: r.id,
        name: r.name,
        packageDesc: r.packageDesc,
        countUnit: r.countUnit!,
        last: prev ? { qty: Math.round(prev.qty * 1000) / 1000, day: prev.day } : null,
        // Kaydederken çakışma denetimi bu biçimle karşılaştırır (quickCountConflicts)
        today: t ? { qty: shownCount(t, f)!, by: t.by, at: t.at.toISOString() } : null,
      },
    };
  });
  // Sayım grupları Stok sayımı'nın raf sırasıyla (kalemlerin sırası)
  const groups: QuickCountSheet["groups"] = [];
  for (const { group, item } of items) {
    let g = groups.find((x) => x.name === group);
    if (!g) groups.push((g = { name: group, items: [] }));
    g.items.push(item);
  }
  return {
    day,
    countDay: isCountDay(day, settings),
    nextCountDay: nextCountDay(day, settings),
    monthEnd: isLastDayOfMonth(day),
    groups,
    total: items.length,
    last: lastAny[0] ? { day: lastAny[0].day, by: lastAny[0].by } : null,
    due: due.map((x) => ({
      id: x.id,
      supplier: x.supplier,
      sentDay: todayTR(x.sentAt),
      lines: (Array.isArray(x.lines) ? x.lines : []).map((l) => ({ orderName: l.orderName, qty: l.qty, unit: l.unit })),
    })),
  };
}

// ---------------------------------------------------------------- Gönderilenler (/panel/mal-siparisi/gonderilen)

export type HistoryFilter = "acik" | "fark" | "kapanan" | "tumu";
export const HISTORY_FILTERS: readonly HistoryFilter[] = ["acik", "fark", "kapanan", "tumu"];
/** Gönderilenler son bu kadar günü gösterir */
export const HISTORY_DAYS = 90;

export interface InvoiceOption {
  id: number;
  date: string;
  invoiceNo: string | null;
  payable: number;
}

export interface OrderView {
  order: OrderLite;
  slug: string | null;
  state: { key: OrderStateKey; label: string; tone: OrderTone };
  /** "Faturayı değiştir": tedarikçinin gönderim günü − 3 … + 30 günlük faturaları (başka siparişe bağlı olanlar hariç) */
  invoices: InvoiceOption[];
  /** Kapalı sipariş 30 gün içinde yeniden açılabilir */
  reopenable: boolean;
}

export interface OrderHistoryView {
  today: string;
  filter: HistoryFilter;
  supplier: { slug: string; name: string } | null;
  counts: Record<HistoryFilter, number>;
  orders: OrderView[];
}

/** Fark var: açık, faturası okundu ve tutmadı (ya da kalemsiz) */
const hasDiff = (o: OrderLite) => o.status === "open" && o.check !== null && (!o.check.ok || !o.check.linesRead);

/** Gönderilenler ekranı (yönetici; fiyatlı) */
export async function loadOrderHistory(f: { durum: string | undefined; tedarikci: string | undefined }): Promise<OrderHistoryView> {
  const [index, all] = await Promise.all([loadSupplierIndex(), loadOrders({ sinceDays: HISTORY_DAYS })]);
  const today = todayTR();
  for (const o of all) o.supplierKey = index.resolve(o.supplier)?.key ?? null;
  const bySlug = f.tedarikci ? (index.groups.find((g) => g.slug === f.tedarikci) ?? null) : null;
  const scoped = bySlug ? all.filter((o) => o.supplierKey === bySlug.key) : all;
  const match: Record<HistoryFilter, (o: OrderLite) => boolean> = {
    acik: (o) => o.status === "open",
    fark: hasDiff,
    kapanan: (o) => o.status === "closed" || o.status === "cancelled",
    tumu: () => true,
  };
  const filter: HistoryFilter = HISTORY_FILTERS.includes(f.durum as HistoryFilter) ? (f.durum as HistoryFilter) : "acik";
  const shown = scoped.filter(match[filter]);

  // Faturayı değiştir: seçilebilecek faturalar (kafe dışı hariç), başka bir açık / kapalı siparişe bağlı olanlar hariç
  const days = shown.filter((o) => o.status === "open").map((o) => o.sentDay);
  let invoiceRows: { id: number; date: string; invoiceNo: string | null; payable: number; supplier: string; supplierTaxNumber: string | null }[] = [];
  if (days.length) {
    const from = addDays(days.reduce((a, b) => (a < b ? a : b)), -3);
    const to = addDays(days.reduce((a, b) => (a > b ? a : b)), 30);
    invoiceRows = await getDb()
      .select({ id: s.invoices.id, date: s.invoices.date, invoiceNo: s.invoices.invoiceNo, payable: s.invoices.payable, supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber })
      .from(s.invoices)
      .where(and(gte(s.invoices.date, from), sql`${s.invoices.date} <= ${to}`, notInArray(s.invoices.category, SEPARATE_CATEGORIES)))
      .orderBy(asc(s.invoices.date), asc(s.invoices.id));
  }
  const taken = await getDb()
    .select({ id: s.supplierOrders.id, invoiceId: s.supplierOrders.invoiceId })
    .from(s.supplierOrders)
    .where(isNotNull(s.supplierOrders.invoiceId));
  const takenBy = new Map(taken.map((t) => [t.invoiceId!, t.id]));
  const invoiceKeys = invoiceRows.map((r) => ({ ...r, key: index.resolve(r.supplier, r.supplierTaxNumber)?.key ?? null }));

  return {
    today,
    filter,
    supplier: bySlug ? { slug: bySlug.slug, name: bySlug.name } : null,
    counts: { acik: scoped.filter(match.acik).length, fark: scoped.filter(match.fark).length, kapanan: scoped.filter(match.kapanan).length, tumu: scoped.length },
    orders: shown.map((o) => ({
      order: o,
      slug: o.supplierKey ? (index.byKey.get(o.supplierKey)?.slug ?? null) : null,
      state: orderState(o, today),
      invoices:
        o.status === "open" && o.supplierKey
          ? invoiceKeys
              .filter((r) => r.key === o.supplierKey && r.date >= addDays(o.sentDay, -3) && r.date <= addDays(o.sentDay, 30) && (takenBy.get(r.id) ?? o.id) === o.id)
              .map(({ id, date, invoiceNo, payable }) => ({ id, date, invoiceNo, payable }))
          : [],
      reopenable: o.status === "closed" && o.closedAt !== null && Date.now() - Date.parse(o.closedAt) <= 30 * 86_400_000,
    })),
  };
}

// ---------------------------------------------------------------- Zil ve Bugün

/** Zil (yönetici, Faturalar grubu): teslim farkları ve gelmeyenler. Tek sorgu, maliyet modeli yok */
export async function reorderNotifications() {
  const orders = await loadOrders({ sinceDays: OPEN_ORDER_DAYS, status: ["open"] });
  return deliveryNotifications(orders, todayTR());
}

/** Takipteki kalemler, bugün sayılanlar ve son sayım günü (iki rol; fiyat ve model yok) */
async function countFacts(day: string): Promise<Pick<ReorderDayFacts, "total" | "countedToday" | "lastCountDay">> {
  const db = getDb();
  const i = s.ingredients;
  const tracked = await db
    .select({ id: i.id })
    .from(s.reorderItems)
    .innerJoin(i, eq(i.id, s.reorderItems.ingredientId))
    .where(and(eq(i.active, true), isNotNull(i.countUnit), sql`${i.priceSource} <> 'water'`));
  const ids = tracked.map((r) => r.id);
  if (!ids.length) return { total: 0, countedToday: 0, lastCountDay: null };
  const { from, to } = businessDayBounds(day);
  // Ay sonu sayımından yalnız bu ayın ve geçen ayınki eldeki sayılır (loadOnHand gibi): eski bir ayın düzeltilmesi
  // "bugün sayıldı" demesin
  const months = inArray(s.stockCounts.month, [day.slice(0, 7), shiftMonth(day.slice(0, 7), -1)]);
  const [quickToday, stockToday, lastQuick, lastStock] = await Promise.all([
    db.selectDistinct({ id: s.quickCounts.ingredientId }).from(s.quickCounts).where(and(eq(s.quickCounts.day, day), inArray(s.quickCounts.ingredientId, ids))),
    db
      .selectDistinct({ id: s.stockCounts.ingredientId })
      .from(s.stockCounts)
      .where(and(inArray(s.stockCounts.ingredientId, ids), months, gte(s.stockCounts.updatedAt, from), lt(s.stockCounts.updatedAt, to))),
    db.select({ day: s.quickCounts.day }).from(s.quickCounts).where(inArray(s.quickCounts.ingredientId, ids)).orderBy(desc(s.quickCounts.day)).limit(1),
    db.select({ at: s.stockCounts.updatedAt }).from(s.stockCounts).where(and(inArray(s.stockCounts.ingredientId, ids), months)).orderBy(desc(s.stockCounts.updatedAt)).limit(1),
  ]);
  const counted = new Set([...quickToday.map((r) => r.id), ...stockToday.map((r) => r.id)]);
  const days = [lastQuick[0]?.day ?? null, lastStock[0] ? businessDate(lastStock[0].at) : null].filter((d): d is string => d !== null).sort();
  return { total: ids.length, countedToday: counted.size, lastCountDay: days.at(-1) ?? null };
}

/** İş gününün aralığı: [gün 05:00, ertesi gün 05:00) Türkiye saatiyle (sabit UTC+3) */
function businessDayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(Date.parse(`${day}T05:00:00+03:00`));
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/**
 * Bugün ekranının olguları. Personel (model verilmez): takipteki kalem, bugün sayılan, son sayım günü; fiyat, model ve
 * sipariş okunmaz. Yönetici (`model` ile): ayrıca siparişi hazır tedarikçiler (son sayım bugün ya da dünse) ve teslim
 * kontrolünün farkları.
 */
export async function loadReorderDay(role: "admin" | "staff", now: Date, model?: Model): Promise<ReorderDayFacts | null> {
  const day = businessDate(now);
  const [settings, counts] = await Promise.all([loadReorderSettings(), countFacts(day)]);
  const base: ReorderDayFacts = { ...counts, countWeekdays: settings.countWeekdays };
  if (role !== "admin" || !model) return base;
  const today = todayTR(now);
  const orders = await loadOrders({ sinceDays: OPEN_ORDER_DAYS, status: ["open"] });
  const delivery = deliveryDayFacts(orders, today);
  let ready: ReorderDayFacts["ready"] = null;
  if (counts.total && counts.lastCountDay && daysBetween(counts.lastCountDay, day) <= 1) {
    const d = await loadReorderData(model);
    const list = readySuppliers(d.groups, d.orders, d.lastCountAt);
    if (list.length) ready = { suppliers: list.map((g) => g.supplierName ?? ""), lines: list.reduce((a, g) => a + g.lines.filter((l) => l.packs > 0).length, 0) };
  }
  return { ...base, ready, delivery };
}
