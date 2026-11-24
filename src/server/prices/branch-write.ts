import "server-only";

import { inArray } from "drizzle-orm";

import { pushFailureOf, runSiteGroups, type SiteWriteOutcome } from "@/lib/prices/bulk";
import {
  branchFailureMessage,
  branchPriceAt,
  cancelBranchBody,
  planBranchPrice,
  rowsOf,
  type BranchPriceBody,
  type BranchPriceSet,
  type SlotPrices,
} from "@/lib/prices/branch";
import type { PushFailure } from "@/lib/site-menu/push";
import { errorCode, errorField, parseBranchPriceAnswer, type SiteBranchPrice } from "@/lib/site-menu/schema";
import { fromMinor, toMinor, type SiteMenuSlot } from "@/lib/site-menu/slot";
import { UserError } from "@/server/actions/util";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";
import { callSite, lockMenu, readBranchPrices, readMenuSyncState, readSiteSnapshot, replaceBranchRows, SiteRequestError } from "@/server/site-menu/sync";

import { CHANGED_ERROR } from "./batch";

/**
 * Şube fiyatı yazımı (Ürünler › Fiyatlar; docs/FIYATLAR.md › Şube fiyatı; sitenin docs/PANEL-MENU.md "Şube fiyatı").
 * Taban fiyat yazımından (src/server/prices/write.ts) ayrı yol: ürünün panel fiyatına (products.price) ve satış fiyatı
 * geçmişine dokunmaz; şubenin fiyatı sitenin satırıdır, geçmişi de sitenin satırlarıdır (Eski fiyattan satılanlar
 * oradan okur). Panel önce siteye yazar (imzalı POST /api/panel/menu `branchPrice`), site kabul edince kopyadaki
 * satırları yanıtın `branchPrices`'ıyla yeniler.
 *
 * - Yalnız site son çekmede `writes.branchPrice` duyurduysa (eski site bilinmeyen alanı 400 ile reddederdi).
 * - Bir kalemin M ve L'si tek gövdede (src/lib/prices/branch.ts planBranchPrice).
 * - `expect` gönderilmez (site şube fiyatıyla kabul etmez); çakışmayı site anahtarla yakalar: aynı anda başka fiyatlı
 *   satır 409 `stale` ve kalemin satırları döner, panel kopyasını onlarla yeniler.
 * - Yeniden gönderim güvenlidir: aynı satır zaten varsa site 200 ve aynı gövdeyle döner (zaman aşımından sonra
 *   "Tekrar dene" ikinci satır yazmaz).
 */

export interface BranchWriteInput {
  siteMenuId: string;
  branch: string;
  /** ISO an, saat dilimiyle (+03:00 ya da Z) */
  effectiveFrom: string;
  set: BranchPriceSet;
  /** Önizlemede görülen şube fiyatları (TL, boy boy): şubenin fiyatı bu arada değiştiyse yazılmaz */
  expectFrom?: Partial<SlotPrices>;
}

export type BranchWriteResult = { kind: "none" } | { kind: "written"; before: SlotPrices; after: SlotPrices; name: string };

/** Site şube fiyatını kabul ediyor mu ve bağlantı kurulu mu; değilse UserError */
async function requireBranchWrites(consequence: string): Promise<string> {
  const secret = siteLinkSecret();
  if (!secret) throw new UserError(branchFailureMessage({ kind: "off" }, consequence), { cause: { kind: "off" } });
  const state = await readMenuSyncState();
  if (!state.writesBranchPrice) throw new UserError(`Site şube fiyatını henüz kabul etmiyor (laffogato.net güncel değil ya da menü çekilmedi); ${consequence}.`);
  return secret;
}

/** İmzalı POST; ağ hatası ve zaman aşımı UserError (nedeniyle: toplu yazımın devre kesicisi okur) */
async function post(secret: string, body: BranchPriceBody, consequence: string, cancel: boolean) {
  try {
    return await callSite(secret, "/api/panel/menu", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    if (!(e instanceof SiteRequestError)) throw e;
    const text =
      e.failure.kind === "timeout"
        ? `Site 8 saniyede yanıt vermedi; ${cancel ? "iptal" : "fiyat"} sitede yapılmış olabilir. Tekrar deneyin: aynı yazım ikinci kez yazılmaz.`
        : branchFailureMessage(e.failure, consequence, cancel);
    throw new UserError(text, { cause: e.failure });
  }
}

/** Yanıtın satırlarını kopyaya yazar (kalemin o şubedeki satırları); yanıt okunamadıysa `fallback` */
async function storeRows(id: string, branch: string, rows: SiteBranchPrice[] | null, fallback: () => SiteBranchPrice[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    await lockMenu(tx);
    await replaceBranchRows(tx, id, branch, rows ?? fallback());
  });
}

/** Sitenin hata yanıtı: 409 `stale`'de kalemin satırları kopyaya yazılır; her durumda UserError */
async function refuse(res: { status: number; json: unknown }, id: string, branch: string, consequence: string, cancel: boolean): Promise<never> {
  const failure: PushFailure = { kind: "http", status: res.status, field: errorField(res.json), error: errorCode(res.json) };
  if (res.status === 409 && failure.error === "stale") {
    const rows = parseBranchPriceAnswer(res.json).branchPrices;
    if (rows) await storeRows(id, branch, rows, () => []);
  }
  throw new UserError(branchFailureMessage(failure, consequence, cancel), { cause: failure });
}

/**
 * Bir kalemin şubedeki fiyatını bir andan itibaren yazar (tek ürün ya da toplu değişikliğin bir kalemi). Kalem son
 * listede yoksa, şubenin o andaki fiyatı önizlemedekinden farklıysa ya da kural reddederse UserError; değişmiyorsa
 * `none`.
 */
export async function writeBranchPrice(user: { name: string }, input: BranchWriteInput, consequence = "şube fiyatı yazılmadı"): Promise<BranchWriteResult> {
  const secret = await requireBranchWrites(consequence);
  const [snapshot, prices] = await Promise.all([readSiteSnapshot(), readBranchPrices()]);
  const item = snapshot.items.find((i) => i.id === input.siteMenuId);
  if (!item) throw new UserError(`Kalem sitenin son listesinde yok; ${consequence}. Siteyle eşitleyip tekrar deneyin.`);
  const rows = rowsOf(prices.rows, item.id, input.branch);
  const now = branchPriceAt(item, rows, Date.parse(input.effectiveFrom));
  const seen = { M: fromMinor(now.priceMinor), L: fromMinor(now.priceMinorL) };
  for (const slot of ["M", "L"] as const) {
    const want = input.expectFrom?.[slot];
    if (want !== undefined && toMinor(want) !== toMinor(seen[slot])) throw new UserError(CHANGED_ERROR);
  }
  const plan = planBranchPrice({ item, rows, branch: input.branch, effectiveFrom: input.effectiveFrom, set: input.set, actor: user.name });
  if (plan.kind === "none") return { kind: "none" };
  if (plan.kind === "refuse") throw new UserError(plan.error);
  const res = await post(secret, plan.body, consequence, false);
  if (!res.ok) await refuse(res, item.id, input.branch, consequence, false);
  const sent = plan.body.branchPrice as { priceMinor: number | null; priceMinorL: number; effectiveFrom: string };
  await storeRows(item.id, input.branch, parseBranchPriceAnswer(res.json).branchPrices, () => [
    ...rows.filter((r) => Date.parse(r.effectiveFrom) !== Date.parse(sent.effectiveFrom)),
    { id: item.id, branch: input.branch, ...sent, effectiveFrom: new Date(sent.effectiveFrom).toISOString(), createdAt: new Date().toISOString() },
  ]);
  return { kind: "written", before: plan.before, after: plan.after, name: item.name };
}

/** Anı gelmemiş bir şube fiyatı satırını geri alır (iptal); yürürlükteki satır geri alınmaz, yerine yeni satır yazılır */
export async function cancelBranchPrice(user: { name: string }, input: { siteMenuId: string; branch: string; effectiveFrom: string }): Promise<{ name: string }> {
  const consequence = "iptal edilmedi";
  if (!(Date.parse(input.effectiveFrom) > Date.now())) throw new UserError("Yürürlüğe girmiş şube fiyatı geri alınmaz; yeni bir fiyat yazın.");
  const secret = await requireBranchWrites(consequence);
  const [snapshot, prices] = await Promise.all([readSiteSnapshot(), readBranchPrices()]);
  const rows = rowsOf(prices.rows, input.siteMenuId, input.branch);
  const held = rows.find((r) => Date.parse(r.effectiveFrom) === Date.parse(input.effectiveFrom));
  if (!held) throw new UserError("Bu satır panelin kopyasında yok; sayfayı yenileyin.");
  const res = await post(secret, cancelBranchBody({ id: input.siteMenuId, branch: input.branch, effectiveFrom: held.effectiveFrom, actor: user.name }), consequence, true);
  if (!res.ok) await refuse(res, input.siteMenuId, input.branch, consequence, true);
  await storeRows(input.siteMenuId, input.branch, parseBranchPriceAnswer(res.json).branchPrices, () => rows.filter((r) => r !== held));
  return { name: snapshot.items.find((i) => i.id === input.siteMenuId)?.name ?? input.siteMenuId };
}

// ---------------------------------------------------------------- Toplu

export interface BranchBatchItem {
  productId: number;
  /** Önizlemedeki şube fiyatı */
  from: number;
  to: number;
}

export interface BranchBatchResult {
  applied: { productId: number; label: string; from: number; to: number }[];
  failed: { productId: number; label: string; from: number; to: number; reason: string }[];
  siteDown: boolean;
}

const DEADLINE_MS = 40_000;
const SITE_CONCURRENCY = 4;
const labelOf = (p: { name: string; size: string }) => `${p.name} · ${p.size}`;

/**
 * Toplu değişikliğin şube hâli: ürünler site kalemine göre gruplanır, her kalem tek gövde (M ve L birlikte). Siteye
 * bağlı olmayan ürün yazılmaz. Sıra, devre kesici ve süre taban yazımıyla aynı (runSiteGroups). Geri alma yok:
 * anı gelmemiş satır Şube fiyatı sekmesinde iptal edilir.
 */
export async function applyBranchPriceBatch(
  user: { name: string },
  input: { branch: string; effectiveFrom: string; items: readonly BranchBatchItem[] },
): Promise<BranchBatchResult> {
  const started = Date.now();
  const result: BranchBatchResult = { applied: [], failed: [], siteDown: false };
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const products = ids.length
    ? await getDb()
        .select({ id: s.products.id, name: s.products.name, size: s.products.size, siteMenuId: s.products.siteMenuId, slot: s.products.siteMenuSlot })
        .from(s.products)
        .where(inArray(s.products.id, ids))
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, { item: BranchBatchItem; label: string; slot: SiteMenuSlot }[]>();
  for (const item of input.items) {
    const p = byId.get(item.productId);
    if (!p) result.failed.push({ ...item, label: "Silinmiş ürün", reason: "Ürün bulunamadı" });
    else if (!p.siteMenuId || (p.slot !== "M" && p.slot !== "L")) result.failed.push({ ...item, label: labelOf(p), reason: "Şube fiyatı yalnız siteye bağlı üründe değişir" });
    else groups.set(p.siteMenuId, [...(groups.get(p.siteMenuId) ?? []), { item, label: labelOf(p), slot: p.slot }]);
  }
  // Bir grup (kalem) tek yazım: runSiteGroups'a her grup tek eleman olarak verilir
  const write = async ([siteMenuId, members]: [string, { item: BranchBatchItem; label: string; slot: SiteMenuSlot }[]]): Promise<SiteWriteOutcome> => {
    const set: { M?: number; L?: number } = {};
    const expectFrom: Partial<SlotPrices> = {};
    for (const m of members) {
      set[m.slot] = m.item.to;
      expectFrom[m.slot] = m.item.from;
    }
    try {
      const w = await writeBranchPrice(user, { siteMenuId, branch: input.branch, effectiveFrom: input.effectiveFrom, set, expectFrom }, "şube fiyatı yazılmadı");
      for (const m of members) result.applied.push({ ...m.item, label: m.label, to: w.kind === "written" ? w.after[m.slot] : m.item.to });
      return { ok: true };
    } catch (e) {
      const reason = e instanceof UserError ? e.message : "İşlem tamamlanamadı; tekrar dene";
      if (!(e instanceof UserError)) console.error("[fiyatlar] şube fiyatı toplu yazım", e);
      for (const m of members) result.failed.push({ ...m.item, label: m.label, reason });
      return { ok: false, reason, failure: pushFailureOf(e) };
    }
  };
  const run = await runSiteGroups([...groups.entries()].map((g) => [g]), write, { concurrency: SITE_CONCURRENCY, deadline: started + DEADLINE_MS });
  // Denenmeyen kalemler (devre kesici ya da süre): kalemin bütün ürünleri
  for (const f of run.failed) {
    const members = f.item[1];
    if (result.failed.some((x) => members.some((m) => m.item.productId === x.productId))) continue;
    for (const m of members) result.failed.push({ ...m.item, label: m.label, reason: f.reason });
  }
  result.siteDown = run.siteDown;
  return result;
}
