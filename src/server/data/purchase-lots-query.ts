import { and, eq, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { buildLots, type PurchaseLot } from "@/lib/calc/fifo";
import type { HeldPurchase, PurchaseQty } from "@/lib/calc/types";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { MANAGED_QTY_NOTE, NO_PURCHASE_NOTE } from "@/lib/purchase-notes";
import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";
import { invoiceScopeWhere } from "@/server/invoice-scope";

/** Alt sorgunun takma adları: dış sorgu da parasut_product_links'i birleştirir (queryPurchaseLots), adlar karışmasın */
const HOLD_ALIAS = "suspect_hold";
const LINK_ALIAS = "suspect_link";
const hh = alias(s.ingredientPriceHolds, HOLD_ALIAS);
const hl = alias(s.parasutProductLinks, LINK_ALIAS);

/** Kalemin ürününün bağlantısında bugünkü çarpanla verilmiş öneri (`extra`: önerinin durumu ve faturası) */
function holdOnLine(line: { productKey: AnyPgColumn }, extra: SQL): SQL<boolean> {
  const from = sql`${s.ingredientPriceHolds} ${sql.identifier(HOLD_ALIAS)} join ${s.parasutProductLinks} ${sql.identifier(LINK_ALIAS)}`;
  return sql<boolean>`exists (select 1 from ${from} on ${hl.productKey} = ${hh.productKey} where ${hh.productKey} = ${line.productKey} and ${hh.ingredientId} = ${hl.ingredientId} and ${hh.factor} = ${hl.factor} and ${extra})`;
}

/** Ürünün bağlantısı bugünkü çarpanıyla onay bekleyen bir fiyat taşıyor: ürünün bütün kalemleri şüpheli */
export function pendingFactorLine(line: { productKey: AnyPgColumn }): SQL<boolean> {
  return holdOnLine(line, sql`${hh.status} = 'pending'`);
}

/** Bugünkü çarpanla reddedilmiş fiyatın kendi faturasının kalemi */
export function rejectedFactorLine(line: { productKey: AnyPgColumn; invoiceId: AnyPgColumn }): SQL<boolean> {
  return holdOnLine(line, sql`${hh.status} = 'rejected' and ${hh.invoiceId} = ${line.invoiceId}`);
}

/**
 * Çarpanı şüpheli fatura kalemi (ortak yüklem): kalemin ürününün bağlantısı bugünkü çarpanıyla onay bekleyen bir fiyat
 * taşıyorsa ürünün bütün kalemleri (pendingFactorLine), bugünkü çarpanla reddedilmiş fiyatın yalnız kendi faturasının
 * kalemi (rejectedFactorLine). Çarpan şüphesi bağlantıyı izler, tek faturayı değil (eşitleme yalnız en yeni faturayı
 * değerlendirir, yenisi gelince eskinin önerisi geçersiz kalır). Çarpan düzeltilince eski çarpanla açılmış öneriler bir
 * şey dışlamaz. Stok değerlemenin partileri (queryPurchaseLots), eşitlemenin yazdığı alınan miktar
 * (recomputePurchaseQuantities) ve Tutarlılık'ın işaretleri (queryHeldPurchases) aynı yüklemi kullanır: biri sayıp öteki
 * saymazsa stok değeri ile Tutarlılık'ın "alınan"ı ayrışır (denetim 26 Eki, E-27).
 */
export function suspectFactorLine(line: { productKey: AnyPgColumn; invoiceId: AnyPgColumn }): SQL<boolean> {
  return sql<boolean>`(${pendingFactorLine(line)} or ${rejectedFactorLine(line)})`;
}

/**
 * Stok değerlemenin (FIFO) partileri: Paraşüt faturalarının hammaddeye bağlı kalemleri, fatura + hammadde başına
 * toplanmış (miktar × bağlantı çarpanı, KDV hariç net tutar). "Fiyatı güncelle" kapalı bağlantının faturası da
 * gerçek alıştır, girer. Girmeyen: kafe dışı fatura ve çarpanı şüpheli kalem (suspectFactorLine). Kalemler her
 * eşitlemede yeniden yazıldığı için partiler her okumada türetilir. Faturası olmayan alım (elle girilen ya da içe aktarılmış fatura,
 * nakit alım, bağlanmamış ürün) havuzda görünmez: havuz yettiği sürece sayılan miktar eski faturalara dağılır, yalnız
 * havuzun karşılamadığı kalan ay sonu fiyatıyla. docs/STOK-DEGERLEME.md §2
 */
export async function queryPurchaseLots(db: DB, scope: BranchScope = ALL_BRANCHES): Promise<PurchaseLot[]> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const rows = await db
    .select({
      ingredientId: ln.ingredientId,
      invoiceId: inv.id,
      date: inv.date,
      quantity: sql<number>`sum(${bl.quantity} * ${ln.factor})`.mapWith(Number),
      netTotal: sql<number>`sum(${bl.netTotal})`.mapWith(Number),
    })
    .from(bl)
    .innerJoin(inv, eq(inv.id, bl.invoiceId))
    .innerJoin(ln, eq(ln.productKey, bl.productKey))
    // Stok değeri alanının şube kipi (şube ayrımı parça 5; `scope` bir şube): şubenin ve işletme genelinin faturaları
    // (invoiceScopeWhere). Öbür şubenin ve şubesi seçilmemiş faturanın partisi bu şubenin havuzunda değil: havuzun
    // karşılamadığı miktar ay sonu fiyatıyla (sayım ekranı kapsamı yazar)
    .where(and(notInArray(inv.category, SEPARATE_CATEGORIES), sql`not ${suspectFactorLine(bl)}`, invoiceScopeWhere(scope)))
    .groupBy(ln.ingredientId, inv.id, inv.date);
  return buildLots(rows.map((r) => ({ ...r, factor: 1 })));
}

/** Tutarlılık alanının şube kipinde alınan miktar (şube ayrımı parça 5) */
export interface BranchPurchases {
  /** Şubeye seçilmiş faturaların hammaddeye düşen miktarı, ay ve hammadde başına (eşitlemenin notuyla: elle değil) */
  quantities: PurchaseQty[];
  /** Çarpanı şüpheli olduğu için alınana girmeyen şube faturaları (Tutarlılık'ın işaretleri) */
  held: HeldPurchase[];
  /** Ay başına dahil olmayanlar: şubesi boş (işletme geneli ya da seçilmemiş) faturalar ve elle yazılan alımlar */
  outside: Record<string, { invoices: number; manual: number }>;
}

/**
 * Tutarlılık'ın şube kipinde "alınan": yalnız o şubeye seçilmiş faturalardan (eşitlemenin kuralıyla: kafe dışı fatura ve
 * çarpanı şüpheli kalem girmez, eksi ay toplamı yazılmaz; src/server/parasut/sync.ts recomputePurchaseQuantities). İşletme
 * geneli ve şubesi seçilmemiş fatura hiçbir şubenin alımına girmez; elle yazılan alım (purchase_quantities) firmanındır.
 * İkisi de ay ay sayılır ("N şubesiz fatura, M elle alım dahil değil")
 */
export async function queryBranchPurchases(db: DB, branch: string): Promise<BranchPurchases> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const pq = s.purchaseQuantities;
  const month = sql<string>`substr(${inv.date}, 1, 7)`;
  const pending = pendingFactorLine(bl);
  const [lines, held, unowned, manual] = await Promise.all([
    db
      .select({ month, ingredientId: ln.ingredientId, qty: sql<number>`sum(${bl.quantity} * ${ln.factor})`.mapWith(Number) })
      .from(bl)
      .innerJoin(inv, eq(inv.id, bl.invoiceId))
      .innerJoin(ln, eq(ln.productKey, bl.productKey))
      .where(and(eq(inv.branchId, branch), notInArray(inv.category, SEPARATE_CATEGORIES), sql`not ${suspectFactorLine(bl)}`))
      .groupBy(month, ln.ingredientId),
    db
      .select({
        month,
        ingredientId: ln.ingredientId,
        invoices: sql<number>`count(distinct ${inv.id}) filter (where ${pending})`.mapWith(Number),
        rejected: sql<number>`count(distinct ${inv.id}) filter (where not ${pending})`.mapWith(Number),
      })
      .from(bl)
      .innerJoin(inv, eq(inv.id, bl.invoiceId))
      .innerJoin(ln, eq(ln.productKey, bl.productKey))
      .where(and(eq(inv.branchId, branch), notInArray(inv.category, SEPARATE_CATEGORIES), suspectFactorLine(bl)))
      .groupBy(month, ln.ingredientId),
    db
      .select({ month, n: sql<number>`count(distinct ${inv.id})`.mapWith(Number) })
      .from(bl)
      .innerJoin(inv, eq(inv.id, bl.invoiceId))
      .innerJoin(ln, eq(ln.productKey, bl.productKey))
      .where(and(isNull(inv.branchId), notInArray(inv.category, SEPARATE_CATEGORIES)))
      .groupBy(month),
    db
      .select({ month: pq.month, n: sql<number>`count(*)`.mapWith(Number) })
      .from(pq)
      .where(sql`coalesce(${pq.note}, '') not in (${MANAGED_QTY_NOTE}, ${NO_PURCHASE_NOTE})`)
      .groupBy(pq.month),
  ]);
  const outside: BranchPurchases["outside"] = {};
  const at = (m: string) => (outside[m] ??= { invoices: 0, manual: 0 });
  for (const r of unowned) at(r.month).invoices = r.n;
  for (const r of manual) at(r.month).manual = r.n;
  return {
    quantities: lines
      .map((r) => ({ month: r.month, ingredientId: r.ingredientId, qty: Math.round(r.qty * 1000) / 1000, note: MANAGED_QTY_NOTE }))
      .filter((r) => Number.isFinite(r.qty) && r.qty >= 0),
    held: held.map((r) => ({ month: r.month, ingredientId: r.ingredientId, invoices: r.invoices, rejected: r.rejected })),
    outside,
  };
}

/**
 * Çarpanı şüpheli olduğu için alınan miktara ve partilere girmeyen alışlar, ay ve hammadde başına fatura sayısı.
 * `invoices`: fiyatı onay bekleyen bağlantının faturaları (Tutarlılık: "Fiyat onayı bekliyor", onaya götürür);
 * `rejected`: yalnız fiyatı reddedildiği için dışarıda kalan faturalar (bekleyen öneri yok; Tutarlılık: miktarı elle
 * yazın). Kafe dışı faturalar sayılmaz.
 */
export async function queryHeldPurchases(db: DB): Promise<HeldPurchase[]> {
  const bl = s.parasutBillLines;
  const inv = s.invoices;
  const ln = s.parasutProductLinks;
  const month = sql<string>`substr(${inv.date}, 1, 7)`;
  const pending = pendingFactorLine(bl);
  const rows = await db
    .select({
      month,
      ingredientId: ln.ingredientId,
      invoices: sql<number>`count(distinct ${inv.id}) filter (where ${pending})`.mapWith(Number),
      rejected: sql<number>`count(distinct ${inv.id}) filter (where not ${pending})`.mapWith(Number),
    })
    .from(bl)
    .innerJoin(inv, eq(inv.id, bl.invoiceId))
    .innerJoin(ln, eq(ln.productKey, bl.productKey))
    .where(and(notInArray(inv.category, SEPARATE_CATEGORIES), suspectFactorLine(bl)))
    .groupBy(month, ln.ingredientId);
  return rows.map((r) => ({ month: r.month, ingredientId: r.ingredientId, invoices: r.invoices, rejected: r.rejected }));
}
