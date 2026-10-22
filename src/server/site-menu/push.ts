import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { planMenuSync, targetValues, type SaleValues } from "@/lib/site-menu/plan";
import { planPush, pushFailureMessage, type PushBody } from "@/lib/site-menu/push";
import { errorField, parseSiteMenuAnswer, type SiteMenuItem } from "@/lib/site-menu/schema";
import { fromMinor, visibilityFromSite, type SiteMenuSlot } from "@/lib/site-menu/slot";
import { UserError } from "@/server/actions/util";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";

import {
  applyPlan,
  asLinkedRow,
  callSite,
  linkColumns,
  lockMenu,
  patchMenuState,
  readMenuSyncState,
  readSiteSnapshot,
  replaceSnapshotItem,
  SiteRequestError,
} from "./sync";

/**
 * Panel → site: bağlı bir ürünün fiyatı ya da menü durumu panelde değişince önce sitenin yazma ucuna gidilir
 * (POST /api/panel/menu, imzalı). Site 2xx verirse panel sitenin döndürdüğü değerleri yazar; site ulaşılamazsa ya
 * da reddederse UserError fırlatılır ve çağıran hiçbir şey yazmaz. Kullanan eylemler: updateProductPrice,
 * saveRecipe (src/server/actions/products.ts). Ayrıntı: docs/SITE-MENU.md.
 */

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export interface SaleRow extends SaleValues {
  id: number;
  name: string;
  size: string;
  siteMenuId: string | null;
  siteMenuSlot: SiteMenuSlot | null;
}

export type PushOutcome =
  /** Ürün bağlı değil ya da sitedeki değerler değişmiyor: her zamanki gibi yazılır */
  | { kind: "local" }
  /** Site kabul etti; `item` sitenin döndürdüğü kalem (okunamadıysa null: gönderilen değerler yazılır) */
  | { kind: "pushed"; item: SiteMenuItem | null; body: PushBody; price: boolean; visibility: boolean; siteMenuId: string; slot: SiteMenuSlot };

/**
 * Değişiklik siteyi ilgilendiriyorsa siteye yazar. `consequence`: hata metninde panelde ne olmadığı ("fiyat
 * değişmedi", "değişiklikler kaydedilmedi"). Kopuk bağlantı, 0 fiyat, kapalı bağlantı ve sitenin her hatası
 * UserError'dur.
 */
export async function pushSaleChange(user: { name: string }, row: SaleRow, after: SaleValues, consequence: string): Promise<PushOutcome> {
  const link = row.siteMenuId && row.siteMenuSlot ? { siteMenuId: row.siteMenuId, slot: row.siteMenuSlot } : null;
  if (!link) return { kind: "local" };
  const snapshot = await readSiteSnapshot();
  const plan = planPush({
    link,
    before: row,
    after,
    actor: user.name,
    siteItem: snapshot.items.find((i) => i.id === link.siteMenuId) ?? null,
  });
  if (plan.kind === "none") return { kind: "local" };
  if (plan.kind === "refuse") throw new UserError(plan.error);
  const secret = siteLinkSecret();
  // Sitenin hatalarında nedeni (`cause`, PushFailure) de taşınır: toplu fiyat değişikliği site kapalıyken sıradaki
  // ürünleri göndermez (src/server/prices/batch.ts); metin ve öteki çağıranlar için hata aynı UserError
  if (!secret) throw new UserError(pushFailureMessage({ kind: "off" }, consequence), { cause: { kind: "off" } });
  let res: Awaited<ReturnType<typeof callSite>>;
  try {
    res = await callSite(secret, "/api/panel/menu", { method: "POST", body: JSON.stringify(plan.body) });
  } catch (e) {
    if (e instanceof SiteRequestError) throw new UserError(pushFailureMessage(e.failure, consequence), { cause: e.failure });
    throw e;
  }
  if (!res.ok) throw new UserError(pushFailureMessage({ kind: "http", status: res.status, field: errorField(res.json) }, consequence), { cause: { kind: "http", status: res.status } });
  return { kind: "pushed", item: parseSiteMenuAnswer(res.json), body: plan.body, price: plan.price, visibility: plan.visibility, ...link };
}

/**
 * Site kabul ettikten sonra (çağıranın işleminde): düzenlenen satırın son değerleri sitenin yanıtından (fiyat
 * yuvadan; "Tükendi" QR menüden kaldırır, "Satışta" ikisini de açar), aynı kaleme bağlı öteki satırlar da aynı
 * kurala göre güncellenir (M ile L aynı menü durumunu paylaşır), son listenin kopyası ve site saati ilerler (bu
 * yazımdan önce alınmış bir liste artık uygulanmaz). Düzenlenen satırın yazılacak satış değerlerini döndürür.
 */
export async function applyPushed(tx: Tx, outcome: Extract<PushOutcome, { kind: "pushed" }>, row: SaleRow, desired: SaleValues, at: Date): Promise<SaleValues> {
  await lockMenu(tx);
  const { item, body } = outcome;
  if (!item) {
    // Site yazdı ama yanıtı okunamadı: gönderilen değerler (sitenin pingi sonraki çekmeyi zaten getirir)
    const sent = body.priceMinor ?? body.priceMinorL;
    return {
      price: sent !== undefined ? fromMinor(sent) : desired.price,
      ...(body.isActive !== undefined ? visibilityFromSite(body.isActive, desired) : { active: desired.active, showOnMenu: desired.showOnMenu }),
    };
  }
  const final = targetValues(item, { ...desired, siteMenuSlot: outcome.slot }) ?? desired;
  const siblings = (
    await tx
      .select(linkColumns)
      .from(s.products)
      .where(and(eq(s.products.siteMenuId, item.id), ne(s.products.id, row.id)))
  ).flatMap((r) => asLinkedRow(r) ?? []);
  if (siblings.length) await applyPlan(tx, planMenuSync([item], siblings, { partial: true }), at);
  await replaceSnapshotItem(tx, item);
  // Site saati ilerler: bu yazımdan önce alınmış liste artık uygulanmaz. Panelin saatinden bir dakikadan ileri bir
  // zaman (sitede bozuk bir updatedAt) sayılmaz, sonraki bütün çekmeleri durdurmasın
  const cur = await readMenuSyncState(tx);
  const stamp = Math.min(Date.parse(item.updatedAt), Date.now() + 60_000);
  if (Number.isFinite(stamp) && (!cur.lastSiteNow || stamp > Date.parse(cur.lastSiteNow))) {
    await patchMenuState({ lastSiteNow: new Date(stamp).toISOString() }, tx);
  }
  return final;
}
