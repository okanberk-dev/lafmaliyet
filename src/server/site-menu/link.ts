import "server-only";

import { eq, inArray } from "drizzle-orm";

import { changeText, rowLabel, type MenuSyncPlan, type SaleValues } from "@/lib/site-menu/plan";
import { isSingleSize, slotLabel, type SiteMenuSlot } from "@/lib/site-menu/slot";
import { logActivity } from "@/server/actions/log";
import { UserError } from "@/server/actions/util";
import { getDb, schema as s } from "@/server/db";
import { rematchPosSalesBySite } from "@/server/lafpos/rematch";
import { siteLinkSecret } from "@/server/site-link";

import { applySiteList, fetchSiteMenu, linkColumns, loadLinkedRows, lockMenu, logApplied, readSiteSnapshot, SiteRequestError } from "./sync";

/**
 * Ürünü sitedeki bir kalemin bir fiyatına bağlama ve bağlantıyı kaldırma. Bağlama anında sitedeki değer geçerli
 * olur: liste imzalı yeniden çekilir, bağlantı yazılır ve liste (çekmedeki gibi) bütün bağlı satırlara uygulanır;
 * böylece yeni bağlanan ürün sitenin fiyatını ve menü durumunu alır. Bağlantı ürün oluşturmaz, adı ya da kategoriyi
 * değiştirmez.
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

export async function linkProducts(user: { name: string }, requests: readonly LinkRequest[]): Promise<LinkResult> {
  const secret = siteLinkSecret();
  if (!secret) throw new UserError(LINK_OFF_ERROR);
  let list: Awaited<ReturnType<typeof fetchSiteMenu>>;
  try {
    list = await fetchSiteMenu(secret);
  } catch (e) {
    if (e instanceof SiteRequestError) throw new UserError(`${e.message}; bağlantı kurulmadı. Tekrar dene.`);
    throw e;
  }
  const items = new Map(list.items.map((i) => [i.id, i]));
  const at = new Date();
  const result = await getDb().transaction(async (tx) => {
    await lockMenu(tx);
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
  });
  if (result.applied) {
    const fresh = new Set(result.linked.map((l) => l.productId));
    const plan = result.applied.plan;
    // Yeni bağlananların sitenin değerini alması bağlama kaydında; öteki satırlarda olan değişiklik çekme kaydında
    await logApplied({
      plan: { ...plan, changes: plan.changes.filter((c) => !fresh.has(c.productId)) },
      newlyBroken: result.applied.newlyBroken,
    });
    await logActivity(
      user,
      result.linked.length === 1 ? "Site menüsüne bağlandı" : `${result.linked.length} ürün site menüsüne bağlandı`,
      result.linked
        .map((l) => {
          const change = plan.changes.find((c) => c.productId === l.productId);
          return `${l.label} → ${l.siteName} (${l.siteMenuId}, ${l.slot})${change ? `: ${changeText(change)}` : ""}`;
        })
        .join("; "),
    );
  }
  return { linked: result.linked, skipped: result.skipped };
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
