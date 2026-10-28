import "server-only";

import { eq, inArray } from "drizzle-orm";

import { cleanName } from "@/lib/count-item";
import { money } from "@/lib/format";
import { pendingProposalIssue } from "@/lib/recipe-change";
import { NEW_FROM_SITE_PENDING_THEN, newFromSiteTaken } from "@/lib/site-menu/new-product";
import { changeText, rowLabel, type MenuSyncPlan, type SaleValues } from "@/lib/site-menu/plan";
import { fromMinor, isSingleSize, slotLabel, slotPriceMinor, type SiteMenuSlot } from "@/lib/site-menu/slot";
import { logActivity } from "@/server/actions/log";
import { UserError } from "@/server/actions/util";
import { insertProduct } from "@/server/data/product-create";
import { lockNewProducts, pendingNewProposalRows } from "@/server/data/recipe-requests";
import { getDb, schema as s } from "@/server/db";
import { rematchPosSalesBySite } from "@/server/lafpos/rematch";
import { siteLinkSecret } from "@/server/site-link";

import { applySiteList, fetchSiteMenu, linkColumns, loadLinkedRows, lockMenu, logApplied, readSiteSnapshot, SiteRequestError, type AppliedList } from "./sync";

/**
 * Ürünü sitedeki bir kalemin bir fiyatına bağlama ve bağlantıyı kaldırma. Bağlama anında sitedeki değer geçerli
 * olur: liste imzalı yeniden çekilir, bağlantı yazılır ve liste (çekmedeki gibi) bütün bağlı satırlara uygulanır;
 * böylece yeni bağlanan ürün sitenin fiyatını ve menü durumunu alır. Bağlantı ürün oluşturmaz, adı ya da kategoriyi
 * değiştirmez; "Yalnız sitede" kalemden ürün açmak ayrı bir eylemdir (createLinkedProducts: aynı çekirdekle bağlar).
 */

export interface LinkRequest {
  productId: number;
  siteMenuId: string;
  slot: SiteMenuSlot;
}

export interface LinkedProduct {
  productId: number;
  label: string;
  siteMenuId: string;
  slot: SiteMenuSlot;
  siteName: string;
  before: SaleValues;
  after: SaleValues;
}

export interface LinkResult {
  linked: LinkedProduct[];
  skipped: { productId: number; label: string | null; reason: string }[];
}

export const LINK_OFF_ERROR = "Site bağlantısı kurulmamış: iki projede de aynı KARAOKE_SYNC_SECRET tanımlanmalı (docs/SITE-MENU.md).";

/** Bağlantıdan sonra satırın değerleri: planda değiştiyse yenisi, değilse aynısı */
function valuesAfter(plan: MenuSyncPlan, productId: number, before: SaleValues): SaleValues {
  const change = plan.changes.find((c) => c.productId === productId);
  return change ? { ...before, ...change.set } : before;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type SiteList = Awaited<ReturnType<typeof fetchSiteMenu>>;

/** Sitenin listesi imzalı çekilir; ulaşılamazsa Türkçe hata (`what`: "bağlantı kurulmadı" ya da "ürün açılmadı") */
async function fetchListOrFail(what: string): Promise<SiteList> {
  const secret = siteLinkSecret();
  if (!secret) throw new UserError(LINK_OFF_ERROR);
  try {
    return await fetchSiteMenu(secret);
  } catch (e) {
    if (e instanceof SiteRequestError) throw new UserError(`${e.message}; ${what}. Tekrar dene.`);
    throw e;
  }
}

/**
 * Bağlantıları menü kilidi altında yazar (çağıran `lockMenu`'yu almıştır): yuvası boş ve kalemi sitede olan her
 * istek bağlanır, liste bütün bağlı satırlara uygulanır (yeni bağlanan sitenin fiyatını ve menü durumunu alır) ve bu
 * kalemle gelmiş ürünsüz LafPOS satırları ürüne bağlanır. Bağlama ve "Panelde aç ve bağla" ortak çekirdeği.
 */
async function linkUnderLock(tx: Tx, list: SiteList, requests: readonly LinkRequest[], at: Date) {
  const items = new Map(list.items.map((i) => [i.id, i]));
  const ids = [...new Set(requests.map((r) => r.productId))];
  const products = new Map(
    (
      await tx
        .select(linkColumns)
        .from(s.products)
        .where(inArray(s.products.id, ids.length ? ids : [-1]))
    ).map((p) => [p.id, p]),
  );
  const taken = new Map((await loadLinkedRows(tx)).map((r) => [`${r.siteMenuId}:${r.siteMenuSlot}`, r]));
  const linked: Omit<LinkedProduct, "after">[] = [];
  const skipped: LinkResult["skipped"] = [];
  const done = new Set<number>();
  for (const req of requests) {
    const p = products.get(req.productId);
    const label = p ? rowLabel(p) : null;
    if (!p) {
      skipped.push({ productId: req.productId, label, reason: "Ürün bulunamadı" });
      continue;
    }
    if (done.has(p.id)) continue;
    const item = items.get(req.siteMenuId);
    if (!item) {
      skipped.push({ productId: p.id, label, reason: `${req.siteMenuId} sitede yok (silinmiş olabilir); listeyi yenile` });
      continue;
    }
    if (req.slot === "L" && isSingleSize(item)) {
      skipped.push({ productId: p.id, label, reason: `${item.name} sitede tek boy; ürünü tek fiyatına (M) bağla` });
      continue;
    }
    const key = `${req.siteMenuId}:${req.slot}`;
    const holder = taken.get(key);
    if (holder && holder.id === p.id) {
      skipped.push({ productId: p.id, label, reason: "Zaten bu kaleme bağlı" });
      continue;
    }
    if (holder) {
      skipped.push({ productId: p.id, label, reason: `${item.name} (${slotLabel(req.slot, item)}) zaten ${rowLabel(holder)} ürününe bağlı` });
      continue;
    }
    if (p.siteMenuId && p.siteMenuSlot) taken.delete(`${p.siteMenuId}:${p.siteMenuSlot}`);
    await tx.update(s.products).set({ siteMenuId: req.siteMenuId, siteMenuSlot: req.slot, updatedAt: at }).where(eq(s.products.id, p.id));
    taken.set(key, { id: p.id, name: p.name, size: p.size, price: p.price, active: p.active, showOnMenu: p.showOnMenu, siteMenuId: req.siteMenuId, siteMenuSlot: req.slot });
    done.add(p.id);
    linked.push({
      productId: p.id,
      label: rowLabel(p),
      siteMenuId: req.siteMenuId,
      slot: req.slot,
      siteName: item.name,
      before: { price: p.price, active: p.active, showOnMenu: p.showOnMenu },
    });
  }
  if (!linked.length) return { linked: [], skipped, applied: null };
  // Sitenin değeri geçerli: liste bütün bağlı satırlara (yeni bağlananlar dahil) uygulanır
  const applied = await applySiteList(tx, list, at);
  if (!applied) throw new UserError("Sitenin menüsü bu sırada değişti; bağlantı kurulmadı. Tekrar dene.");
  // Bu kalemle gelmiş ürünsüz LafPOS satırları yeniden gönderim olmadan ürüne bağlanır (denetim E-33)
  await rematchPosSalesBySite(
    tx,
    linked.map((l) => ({ productId: l.productId, siteMenuId: l.siteMenuId, slot: l.slot })),
  );
  return { linked: linked.map((l) => ({ ...l, after: valuesAfter(applied.plan, l.productId, l.before) })), skipped, applied };
}

/** Bağlanma kaydı: yeni bağlananların sitenin değerini alması bağlama kaydında, öteki satırlarınki çekme kaydında */
async function logLinked(user: { name: string }, linked: LinkedProduct[], applied: AppliedList, action: string, detail?: string) {
  const fresh = new Set(linked.map((l) => l.productId));
  const plan = applied.plan;
  await logApplied({
    plan: { ...plan, changes: plan.changes.filter((c) => !fresh.has(c.productId)) },
    newlyBroken: applied.newlyBroken,
  });
  const lines = linked
    .map((l) => {
      const change = plan.changes.find((c) => c.productId === l.productId);
      return `${l.label} → ${l.siteName} (${l.siteMenuId}, ${l.slot})${change ? `: ${changeText(change)}` : ""}`;
    })
    .join("; ");
  await logActivity(user, action, detail ?? lines);
}

export async function linkProducts(user: { name: string }, requests: readonly LinkRequest[]): Promise<LinkResult> {
  const list = await fetchListOrFail("bağlantı kurulmadı");
  const at = new Date();
  const result = await getDb().transaction(async (tx) => {
    await lockMenu(tx);
    return linkUnderLock(tx, list, requests, at);
  });
  if (result.applied) {
    await logLinked(user, result.linked, result.applied, result.linked.length === 1 ? "Site menüsüne bağlandı" : `${result.linked.length} ürün site menüsüne bağlandı`);
  }
  return { linked: result.linked, skipped: result.skipped };
}

export interface NewFromSiteInput {
  siteMenuId: string;
  name: string;
  categoryId: number;
  rows: { slot: SiteMenuSlot; size: "M" | "L" | "Tek" }[];
}

export interface NewFromSiteResult {
  siteName: string;
  /** Açılan ürünler, isteğin sırasıyla; fiyat ve menü durumu bağlandıktan sonraki (sitenin) */
  created: { productId: number; size: "M" | "L" | "Tek"; slot: SiteMenuSlot; price: number; showOnMenu: boolean }[];
}

/**
 * "Yalnız sitede" kalemden panel ürünü açar ve bağlar (denetim E-48): site listesi imzalı çekilir; menü kilidi altında
 * tek işlemde her boy Ürünler › Yeni ürün'ün kuralıyla (insertProduct: zayi oranı kategoriden, sıra en sonda, fiyat
 * geçmişinin ilk satırı) sitenin fiyatıyla açılır ve bağlama çekirdeğiyle kalemin yuvasına bağlanır. Yuva bu arada
 * dolduysa, kalem sitede yoksa ya da liste bu sırada değiştiyse hiçbir ürün açılmaz. Aynı ad + boyda panel ürünü varsa
 * açılmaz (o ürün bağlanmalı); aynı ad + boyda bekleyen yeni ürün önerisi varsa da (önce öneri onaylanır, ürün
 * reçetesiyle açılır, sonra Öneriler'den bağlanır).
 */
export async function createLinkedProducts(user: { name: string }, input: NewFromSiteInput): Promise<NewFromSiteResult> {
  const name = cleanName(input.name);
  const list = await fetchListOrFail("ürün açılmadı");
  const item = list.items.find((i) => i.id === input.siteMenuId);
  if (!item) throw new UserError(`${input.siteMenuId} sitede yok (silinmiş olabilir); sayfayı yenileyin`);
  const rows = input.rows.map((r) => {
    const minor = slotPriceMinor(item, r.slot);
    if (minor === null) throw new UserError(`${item.name} sitede tek boy; yalnız tek fiyatı açılır. Sayfayı yenileyin`);
    return { ...r, price: fromMinor(minor) };
  });
  const at = new Date();
  const result = await getDb().transaction(async (tx) => {
    await lockMenu(tx);
    // Yeni ürün önerisinin kilidi menü kilidinden sonra (öneri ve onay menü kilidini almaz): aynı ad + boyda bekleyen
    // öneri varsa ürün açılmaz, yoksa öneri onayda "zaten var"a takılır ve reçetesi bu ürüne ulaşmaz (denetim B14)
    await lockNewProducts(tx);
    const [category] = await tx.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.id, input.categoryId)).limit(1);
    if (!category) throw new UserError("Kategori bulunamadı; sayfayı yenileyin");
    const sizes = rows.map((r) => r.size);
    const taken =
      newFromSiteTaken(name, sizes, await tx.select({ name: s.products.name, size: s.products.size }).from(s.products)) ??
      pendingProposalIssue(name, sizes, await pendingNewProposalRows(tx), NEW_FROM_SITE_PENDING_THEN);
    if (taken) throw new UserError(taken);
    const created: { productId: number; size: "M" | "L" | "Tek"; slot: SiteMenuSlot }[] = [];
    for (const r of rows) {
      const p = await insertProduct(tx, { name, size: r.size, categoryId: input.categoryId, price: r.price }, { changedBy: user.name });
      created.push({ productId: p.id, size: r.size, slot: r.slot });
    }
    const linked = await linkUnderLock(
      tx,
      list,
      created.map((c) => ({ productId: c.productId, siteMenuId: item.id, slot: c.slot })),
      at,
    );
    // Yuva bu arada başka ürüne bağlandıysa ürün de açılmaz (işlem geri alınır)
    if (linked.skipped.length || !linked.applied) throw new UserError(`${linked.skipped[0]?.reason ?? "Bağlantı kurulamadı"}; ürün açılmadı. Sayfayı yenileyin`);
    return { created, linked: linked.linked, applied: linked.applied };
  });
  const created = result.created.map((c) => {
    const after = result.linked.find((l) => l.productId === c.productId)?.after;
    return { ...c, price: after?.price ?? rows.find((r) => r.slot === c.slot)!.price, showOnMenu: after?.showOnMenu ?? true };
  });
  // "Matcha Latte M, L → Matcha Latte (mnu-0100): M 185 ₺, L 205 ₺"; Tükendi kalemde QR menüde gizli açıldığı da
  const hidden = created.some((c) => !c.showOnMenu) ? " · QR menüde gizli (sitede Tükendi)" : "";
  const detail = `${name} ${created.map((c) => c.size).join(", ")} → ${item.name} (${item.id}): ${created.map((c) => `${c.size} ${money(c.price)}`).join(", ")}${hidden}`;
  await logLinked(user, result.linked, result.applied, "Yeni ürün (siteden)", detail);
  return { siteName: item.name, created };
}

/** Bağlantıyı kaldırır: ürünün fiyatı ve menü durumu olduğu gibi kalır, bundan sonra yalnız panelde değişir */
export async function unlinkProduct(user: { name: string }, productId: number): Promise<void> {
  const removed = await getDb().transaction(async (tx) => {
    await lockMenu(tx);
    const [p] = await tx
      .select({ id: s.products.id, name: s.products.name, size: s.products.size, siteMenuId: s.products.siteMenuId, siteMenuSlot: s.products.siteMenuSlot })
      .from(s.products)
      .where(eq(s.products.id, productId))
      .limit(1);
    if (!p) throw new UserError("Ürün bulunamadı");
    if (!p.siteMenuId) throw new UserError("Bu ürün sitede bir kaleme bağlı değil");
    await tx.update(s.products).set({ siteMenuId: null, siteMenuSlot: null, updatedAt: new Date() }).where(eq(s.products.id, p.id));
    return p;
  });
  const item = (await readSiteSnapshot()).items.find((i) => i.id === removed.siteMenuId);
  await logActivity(user, "Site bağlantısı kaldırıldı", `${rowLabel(removed)}: ${item?.name ?? removed.siteMenuId} (${removed.siteMenuId}, ${removed.siteMenuSlot})`);
}
