import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, ne, notInArray } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { holdInScope, livePct, newerInvoice } from "@/lib/price-hold";
import { getDb, schema as s, type DB } from "@/server/db";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const h = s.ingredientPriceHolds;

/** "Son kararlar"ın penceresi (karttaki geri alma listesi); "Geri al" sunucuda 30 gün geçerli */
export const RECENT_DAYS = 3;
const RECENT_MAX = 10;

export type HoldRow = Omit<typeof h.$inferSelect, "createdAt" | "decidedAt"> & {
  /** ISO */
  createdAt: string;
  decidedAt: string | null;
  ingredient: { name: string; unit: "gr" | "ml" | "adet" | "dilim"; packagePrice: number; packageSize: number; priceSource: "manual" | "water"; isEstimate: boolean };
};

/**
 * Bekleyen fiyat önerilerini geçersiz sayar ("Son kararlar"da nedeniyle görünür). Yalnız hâlâ bekleyenlere dokunur:
 * aynı anda onaylanan ya da reddedilen öneri ezilmez. `ids` null: bekleyenlerin hepsi (hiç bağlantı kalmadı).
 */
export async function supersedeHolds(ids: number[] | null, note: string, tx: Tx | DB = getDb()) {
  if (ids && !ids.length) return;
  await tx
    .update(h)
    .set({ status: "superseded", note, decidedAt: new Date() })
    .where(and(eq(h.status, "pending"), ids ? inArray(h.id, ids) : undefined));
}

/**
 * Önerinin faturasından sonra hammaddenin fiyatını belirleyen fatura geldiyse o (src/lib/price-hold.ts newerInvoice):
 * hammaddeye bağlı ürünlerin, öneri faturasından sonraki kafe kalemleri (eşitlemenin fiyat kapsamı).
 */
export async function newerPriceInvoice(hold: { ingredientId: number; invoiceId: number; invoiceDate: string; productKey: string }, tx: Tx | DB = getDb()) {
  const lines = await tx
    .select({
      invoiceId: s.invoices.id,
      productKey: s.parasutBillLines.productKey,
      date: s.invoices.date,
      supplier: s.invoices.supplier,
      quantity: s.parasutBillLines.quantity,
      netTotal: s.parasutBillLines.netTotal,
      ingredientId: s.parasutProductLinks.ingredientId,
      updatePrice: s.parasutProductLinks.updatePrice,
    })
    .from(s.parasutBillLines)
    .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
    .innerJoin(s.parasutProductLinks, eq(s.parasutProductLinks.productKey, s.parasutBillLines.productKey))
    .where(and(eq(s.parasutProductLinks.ingredientId, hold.ingredientId), gt(s.invoices.date, hold.invoiceDate), notInArray(s.invoices.category, SEPARATE_CATEGORIES)));
  return newerInvoice(lines, new Map(lines.map((l) => [l.productKey, l])), hold);
}

/**
 * Bekleyen önerilerin ürünlerinin fiyat kapsamındaki (kafe) kalemleri: kartın kanıtı (kalemin açıklaması) ve aynı ürünün
 * geçmişi (sameProductHistory: çarpan oranı ancak bununla önerilir)
 */
export async function loadHoldLines(productKeys: string[]) {
  if (!productKeys.length) return [];
  return getDb()
    .select({
      invoiceId: s.invoices.id,
      productKey: s.parasutBillLines.productKey,
      date: s.invoices.date,
      supplier: s.invoices.supplier,
      quantity: s.parasutBillLines.quantity,
      netTotal: s.parasutBillLines.netTotal,
      description: s.parasutBillLines.description,
    })
    .from(s.parasutBillLines)
    .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
    .where(and(inArray(s.parasutBillLines.productKey, productKeys), notInArray(s.invoices.category, SEPARATE_CATEGORIES)));
}

const columns = {
  hold: h,
  invoiceBranch: s.invoices.branchId,
  ingredient: {
    name: s.ingredients.name,
    unit: s.ingredients.unit,
    packagePrice: s.ingredients.packagePrice,
    packageSize: s.ingredients.packageSize,
    priceSource: s.ingredients.priceSource,
    isEstimate: s.ingredients.isEstimate,
  },
};

const toRow = (r: { hold: typeof h.$inferSelect; ingredient: HoldRow["ingredient"]; invoiceBranch?: string | null }): HoldRow => ({
  ...r.hold,
  createdAt: r.hold.createdAt.toISOString(),
  decidedAt: r.hold.decidedAt?.toISOString() ?? null,
  ingredient: r.ingredient,
});

/**
 * Hammaddeler › "Onay bekleyen fiyatlar": bekleyen öneriler (en eski önce) ve son 3 günde karara bağlanan ya da
 * geçersiz kalanlar (en yeni önce, en çok 10; yanlış dokunuş bildirim kaybolduktan sonra da geri alınabilsin). Seçimle
 * (şube ayrımı parça 5, `holdInScope`): şube seçiliyken öbür şubenin faturasından gelen öneri listede değil, sayısı
 * `elsewhere`'de
 */
export async function loadPriceHolds(scope: BranchScope = ALL_BRANCHES): Promise<{ pending: HoldRow[]; recent: HoldRow[]; elsewhere: number }> {
  const db = getDb();
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const [pending, recent] = await Promise.all([
    db
      .select(columns)
      .from(h)
      .innerJoin(s.ingredients, eq(s.ingredients.id, h.ingredientId))
      .leftJoin(s.invoices, eq(s.invoices.id, h.invoiceId))
      .where(eq(h.status, "pending"))
      .orderBy(asc(h.createdAt), asc(h.id)),
    db
      .select(columns)
      .from(h)
      .innerJoin(s.ingredients, eq(s.ingredients.id, h.ingredientId))
      .leftJoin(s.invoices, eq(s.invoices.id, h.invoiceId))
      .where(and(ne(h.status, "pending"), gte(h.decidedAt, since)))
      .orderBy(desc(h.decidedAt), desc(h.id))
      .limit(RECENT_MAX),
  ]);
  const shown = pending.filter((r) => holdInScope(r.invoiceBranch, scope));
  return { pending: shown.map(toRow), recent: recent.filter((r) => holdInScope(r.invoiceBranch, scope)).map(toRow), elsewhere: pending.length - shown.length };
}

/**
 * Bekleyen öneriler kısaca (zil, Genel bakış, sabah e-postası; "Bugün" ekranı da kullanabilir): sayı, en yeni
 * önerinin kimliği (zil bildiriminin kimliği buna göre değişir) ve hammadde başına canlı fark (önerilen ÷ şimdiki
 * birim fiyat − 1; şimdiki fiyat sonradan değiştiyse yeni farkı söyler). Tek sorgu.
 */
export async function pendingHoldSummary(
  scope: BranchScope = ALL_BRANCHES,
): Promise<{ count: number; latestId: number | null; items: { name: string; pct: number | null; createdAt: string; branch: string | null }[]; elsewhere: number }> {
  const all = await getDb()
    .select({
      id: h.id,
      packagePrice: h.packagePrice,
      packageSize: h.packageSize,
      createdAt: h.createdAt,
      name: s.ingredients.name,
      currentPrice: s.ingredients.packagePrice,
      currentSize: s.ingredients.packageSize,
      invoiceBranch: s.invoices.branchId,
    })
    .from(h)
    .innerJoin(s.ingredients, eq(s.ingredients.id, h.ingredientId))
    .leftJoin(s.invoices, eq(s.invoices.id, h.invoiceId))
    .where(eq(h.status, "pending"))
    .orderBy(asc(h.createdAt), asc(h.id));
  // Şube seçiliyken öbür şubenin faturasından gelen öneri sayı olarak (holdInScope; zil, Bugün, Genel bakış)
  const rows = all.filter((r) => holdInScope(r.invoiceBranch, scope));
  return {
    elsewhere: all.length - rows.length,
    count: rows.length,
    latestId: rows.length ? Math.max(...rows.map((r) => r.id)) : null,
    items: rows.map((r) => ({
      name: r.name,
      pct: livePct(r.packagePrice / r.packageSize, r.currentSize > 0 ? r.currentPrice / r.currentSize : 0),
      createdAt: r.createdAt.toISOString(),
      // Önerinin faturasının şubesi (sabah e-postasının şube grubu süzer: groupDigestInvoices)
      branch: r.invoiceBranch ?? null,
    })),
  };
}
