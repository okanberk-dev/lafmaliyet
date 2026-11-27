import "server-only";

import { and, asc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import {
  branchChangeReports,
  branchPriceAt,
  branchPriceTargets,
  defaultEffectiveFrom,
  OPTION_MENU_ITEM_IDS,
  oldPriceSales,
  rowsOf,
  type BaseTimeline,
  type BranchChangeReport,
  type BranchSaleRow,
  type OldPriceSale,
  type PriceSources,
} from "@/lib/prices/branch";
import { addDays } from "@/lib/reminders";
import type { SiteBranchPrice, SiteMenuItem } from "@/lib/site-menu/schema";
import { fromMinor } from "@/lib/site-menu/slot";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";
import { readBranchPrices, readMenuSyncState, readSiteSnapshot } from "@/server/site-menu/sync";

/**
 * Fiyatlar › Şube fiyatı ve Eski fiyattan satılanlar (docs/FIYATLAR.md › Şube fiyatı). Satırlar sitenin son okumasının
 * kopyasından (`menu_site_branch_prices`), taban sitenin kaleminden ve panelin fiyat geçmişinden (siteye bağlı ürünün
 * product_prices'ı), satışlar AsilPOS gün sonundan (pos_daily_sales, `list_prices`). Siteye gidilmez.
 */

export interface BranchTarget {
  id: string;
  name: string;
}

export interface BranchPriceItem {
  id: string;
  name: string;
  category: string;
  /** Taban (sitenin kalemi), TL; L yoksa 0 */
  base: { M: number; L: number };
  /** Şubede şu an geçerli, TL; `from` şubenin kendi satırının anı (taban geçerliyse null) */
  current: { M: number; L: number; from: string | null };
  /** Kalemin bu şubedeki satırları, eskiden yeniye */
  rows: SiteBranchPrice[];
}

export interface BranchPriceContext {
  /** KARAOKE_SYNC_SECRET kurulu */
  configured: boolean;
  /** Site son çekmede `writes.branchPrice` duyurdu: yazım önerilir */
  writes: boolean;
  /** Satırlar hiç alındı mı (eski site ya da henüz çekilmedi: null) */
  rowsAt: string | null;
  branches: BranchTarget[];
  /** Varsayılan Geçerlilik: sonraki iş günü 05:00 İstanbul */
  defaultEffective: string;
}

async function context(now: Date) {
  const [state, snapshot, prices, branches] = await Promise.all([readMenuSyncState(), readSiteSnapshot(), readBranchPrices(), listBranches()]);
  const ctx: BranchPriceContext = {
    configured: Boolean(siteLinkSecret()),
    writes: state.writesBranchPrice === true,
    rowsAt: prices.at,
    branches: branchPriceTargets(branches).map((b) => ({ id: b.id, name: b.name })),
    defaultEffective: defaultEffectiveFrom(now),
  };
  return { ctx, items: snapshot.items, rows: prices.rows };
}

/** Seçilen şube: panelin seçimi (şube kapsamı C P2-5) yazılabilen şubeyse o, değilse ilki ("Tümü", Tuzla) */
export function pickBranch(branches: readonly BranchTarget[], wanted: string | string[] | undefined): BranchTarget | null {
  return branches.find((b) => b.id === wanted) ?? branches[0] ?? null;
}

/**
 * Toplu değiştir'in Şube seçimi: site şube fiyatını duyurduysa ve yazılabilen şube varsa şubeler, kalemlerin tabanı ve
 * satırlar (önizleme şubenin Geçerlilik anındaki fiyatını gösterir); değilse null (Şube seçimi görünmez).
 */
export async function loadBranchBulk(now: Date = new Date()): Promise<{
  branches: BranchTarget[];
  defaultEffective: string;
  items: Record<string, { priceMinor: number; priceMinorL: number }>;
  rows: SiteBranchPrice[];
} | null> {
  const { ctx, items, rows } = await context(now);
  if (!ctx.configured || !ctx.writes || !ctx.branches.length) return null;
  return {
    branches: ctx.branches,
    defaultEffective: ctx.defaultEffective,
    items: Object.fromEntries(items.map((i) => [i.id, { priceMinor: i.priceMinor, priceMinorL: i.priceMinorL }])),
    rows,
  };
}

/** Şube fiyatı sekmesi: şubenin kalemleri (seçenekler hariç), tabanı, şu anki fiyatı ve satırları */
export async function loadBranchPrices(wanted: string | string[] | undefined, now: Date = new Date()): Promise<{ ctx: BranchPriceContext; branch: BranchTarget | null; items: BranchPriceItem[] }> {
  const { ctx, items, rows } = await context(now);
  const branch = pickBranch(ctx.branches, wanted);
  if (!branch) return { ctx, branch, items: [] };
  const t = now.getTime();
  const list = items
    .filter((i) => !OPTION_MENU_ITEM_IDS.includes(i.id))
    .map((i): BranchPriceItem => {
      const own = rowsOf(rows, i.id, branch.id);
      const p = branchPriceAt(i, own, t);
      return {
        id: i.id,
        name: i.name,
        category: i.categoryLabel || i.categoryKey,
        base: { M: fromMinor(i.priceMinor), L: fromMinor(i.priceMinorL) },
        current: { M: fromMinor(p.priceMinor), L: fromMinor(p.priceMinorL), from: p.from },
        rows: own,
      };
    });
  return { ctx, branch, items: list };
}

/** Eski fiyattan satılanlar en çok bu kadar gün geriye bakar */
export const OLD_PRICE_DAYS = 90;

export interface OldPriceReport {
  ctx: BranchPriceContext;
  branch: BranchTarget | null;
  /** Kalem adları (id → ad) */
  names: Record<string, string>;
  changes: BranchChangeReport[];
  sales: OldPriceSale[];
  /** Raporun ilk günü ve AsilPOS'un liste fiyatı gönderdiği gün var mı (yoksa her durum Bilinmiyor) */
  from: string;
  hasListPrices: boolean;
}

/** Taban fiyatın zaman çizgisi: siteye bağlı ürünün fiyat geçmişi (panelin yazdığı ya da siteden gelen) */
async function baseTimelines(items: readonly SiteMenuItem[]): Promise<Map<string, PriceSources["base"]>> {
  const db = getDb();
  const linked = await db
    .select({ id: s.products.id, siteMenuId: s.products.siteMenuId, slot: s.products.siteMenuSlot })
    .from(s.products)
    .where(isNotNull(s.products.siteMenuId));
  const ids = linked.map((p) => p.id);
  const history = ids.length
    ? await db
        .select({ productId: s.productPrices.productId, before: s.productPrices.priceBefore, after: s.productPrices.price, at: s.productPrices.changedAt })
        .from(s.productPrices)
        .where(inArray(s.productPrices.productId, ids))
        .orderBy(asc(s.productPrices.changedAt))
    : [];
  const byProduct = new Map<number, BaseTimeline["changes"]>();
  for (const h of history) byProduct.set(h.productId, [...(byProduct.get(h.productId) ?? []), { at: h.at.getTime(), before: h.before, after: h.after }]);
  const out = new Map<string, PriceSources["base"]>();
  for (const i of items) {
    const changesOf = (slot: "M" | "L") => {
      const p = linked.find((x) => x.siteMenuId === i.id && x.slot === slot);
      return p ? (byProduct.get(p.id) ?? []) : [];
    };
    out.set(i.id, { M: { current: fromMinor(i.priceMinor), changes: changesOf("M") }, L: { current: fromMinor(i.priceMinorL), changes: i.priceMinorL > 0 ? changesOf("L") : [] } });
  }
  return out;
}

/** Eski fiyattan satılanlar sekmesi: şubenin fiyat değişiklikleri (durumuyla) ve eski fiyattan satışlar */
export async function loadOldPriceReport(wanted: string | string[] | undefined, now: Date = new Date()): Promise<OldPriceReport> {
  const { ctx, items, rows } = await context(now);
  const branch = pickBranch(ctx.branches, wanted);
  const from = addDays(businessDate(now), -OLD_PRICE_DAYS);
  const names = Object.fromEntries(items.map((i) => [i.id, i.name]));
  if (!branch) return { ctx, branch, names, changes: [], sales: [], from, hasListPrices: false };
  const bases = await baseTimelines(items);
  const branchRows = rows.filter((r) => r.branch === branch.id);
  const sources = new Map<string, PriceSources>();
  for (const i of items) {
    if (OPTION_MENU_ITEM_IDS.includes(i.id)) continue;
    sources.set(i.id, { base: bases.get(i.id)!, rows: rowsOf(branchRows, i.id, branch.id) });
  }
  const raw = await getDb()
    .select({ date: s.posDailySales.date, siteMenuId: s.posDailySales.siteMenuId, slot: s.posDailySales.slot, qty: s.posDailySales.qty, listPrices: s.posDailySales.listPrices })
    .from(s.posDailySales)
    .where(
      and(
        eq(s.posDailySales.branchId, branch.id),
        gte(s.posDailySales.date, from),
        isNotNull(s.posDailySales.siteMenuId),
        isNotNull(s.posDailySales.slot),
        eq(s.posDailySales.isAddon, false),
        eq(s.posDailySales.isService, false),
      ),
    );
  const sales: BranchSaleRow[] = raw.flatMap((r) =>
    r.siteMenuId && r.slot ? [{ date: r.date, siteMenuId: r.siteMenuId, slot: r.slot, qty: r.qty, listPrices: Array.isArray(r.listPrices) ? r.listPrices : null }] : [],
  );
  return {
    ctx,
    branch,
    names,
    changes: branchChangeReports({ rows: branchRows, sources, sales, now: now.getTime() }),
    sales: oldPriceSales({ sales, sources }),
    from,
    hasListPrices: sales.some((x) => x.listPrices),
  };
}

/** Fiyatlar › Geçmiş'in şube fiyatı satırı (şube kapsamı C P2-8): sitedeki şube fiyatı kaydı, kalemin adıyla */
export interface BranchPriceHistoryRow {
  key: string;
  branch: string;
  name: string;
  /** TL, KDV dahil (M ya da tek fiyat; null: şube bu boyu tabandan alır) */
  price: number | null;
  /** TL; 0 = tek boy ya da tabandan */
  priceL: number;
  effectiveFrom: string;
  createdAt: string;
}

/**
 * Şube fiyatlarının geçmişi (Fiyatlar › Geçmiş; şube kapsamı C P2-8): panelin ürün fiyatı geçmişi (product_prices) şube
 * fiyatını taşımaz; sitenin şube fiyatı satırları burada, yeni önce, en çok `limit`. Seçili şube yazılabilen bir şubeyse
 * yalnız onunkiler, değilse ("Tümü", Tuzla) bütün şubelerin. Bağlantı kurulmamışsa ya da satır yoksa boş
 */
export async function loadBranchPriceHistory(wanted: string, limit = 100, now: Date = new Date()): Promise<BranchPriceHistoryRow[]> {
  const { ctx, items, rows } = await context(now);
  if (!ctx.configured || !rows.length) return [];
  const only = ctx.branches.some((b) => b.id === wanted) ? wanted : null;
  const nameOf = new Map(items.map((i) => [i.id, i.name]));
  const branchName = new Map((await listBranches()).map((b) => [b.id, b.name]));
  return rows
    .filter((r) => only === null || r.branch === only)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.effectiveFrom.localeCompare(a.effectiveFrom))
    .slice(0, limit)
    .map((r) => ({
      key: `${r.branch}|${r.id}|${r.effectiveFrom}|${r.createdAt}`,
      branch: branchName.get(r.branch) ?? r.branch,
      name: nameOf.get(r.id) ?? r.id,
      price: r.priceMinor === null ? null : fromMinor(r.priceMinor),
      priceL: fromMinor(r.priceMinorL),
      effectiveFrom: r.effectiveFrom,
      createdAt: r.createdAt,
    }));
}
