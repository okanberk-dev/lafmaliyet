import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { after as afterResponse } from "next/server";

import { freshStamps, planMenuSync, targetValues, type SaleValues } from "@/lib/site-menu/plan";
import { planPush, pushFailureMessage, staleMessage, withoutExpect, type PushBody, type PushFailure } from "@/lib/site-menu/push";
import { errorCode, errorField, parseSiteMenuAnswer, type SiteMenuItem } from "@/lib/site-menu/schema";
import { fromMinor, slotPriceMinor, visibilityFromSite, type SiteMenuSlot } from "@/lib/site-menu/slot";
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
  syncSiteMenu,
} from "./sync";
import { carrySoldOutMarker } from "./sold-out-store";

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

/** Yanıttan sonraki çekmeler bu kadar sürede bire iner (toplu değişiklikte art arda zaman aşımı) */
const PULL_SOON_DEDUPE_MS = 30_000;
let pullQueuedAt = 0;

/**
 * Sitenin menüsünü yanıttan sonra yeniden okur (zaman aşımı: site yazmış olabilir; işlem içindeki 409 `stale`). İstek
 * dışında (test, betik: `after` yok) hemen ve beklenerek; çağıran bir işlemin (ve kalemin kilidinin) içindeyse
 * (`inTx`) havuzdan ikinci bir bağlantı açılmaz, çekme atlanır (sonraki çekme düzeltir). Çekmenin hatası yalnız
 * günlüğe: kullanıcının hatası zaten gösteriliyor.
 */
async function pullSoon(inTx: boolean): Promise<void> {
  const run = async () => {
    try {
      await syncSiteMenu("manual");
    } catch (e) {
      console.error("[menu] yazımdan sonra çekme", e);
    }
  };
  try {
    if (Date.now() - pullQueuedAt < PULL_SOON_DEDUPE_MS) return;
    afterResponse(run);
    pullQueuedAt = Date.now();
  } catch {
    if (!inTx) await run();
  }
}

/**
 * Sitenin 400'ü `expect`'i tanımadığı için mi: bugünkü site katı şemasıyla bilinmeyen alanı yolsuz bir hatayla bildirir
 * ve alan adı "body" olur (`issues[0].path[0]` yok); `expect`'i adıyla anan bir site de olabilir. Panelin gövdesi her
 * zaman geçerli bir JSON nesnesidir, gerçek bir "body" hatası başka bir nedenden gelmez: yeniden deneme zararsızdır.
 */
function rejectsExpect(field: string | null): boolean {
  return field === "expect" || field === "body";
}

/** Site `expect`'i tanımadı: bayrak sonraki çekmeye kadar kapanır (işlemin içinde ikinci bağlantı açılmaz) */
async function forgetExpect(inTx: boolean): Promise<void> {
  const run = async () => {
    try {
      await patchMenuState({ writesExpect: false });
    } catch (e) {
      console.error("[menu] expect bayrağını kapatma", e);
    }
  };
  if (!inTx) return run();
  try {
    afterResponse(run);
  } catch {
    // İstek dışında (betik, test): bayrak sonraki çekmede düzelir
  }
}

/** 409 `stale`'den sonra sitenin güncel menüsü: işlem dışındaysa hemen (true: yüklendi), işlem içindeyse yanıttan sonra */
async function reloadAfterStale(inTx: boolean): Promise<boolean> {
  if (inTx) {
    // Çağıran bir işlemin (ve kalemin kilidinin) içinde: havuzdan ikinci bir bağlantı beklenmez (sold-out-core.ts)
    await pullSoon(true);
    return false;
  }
  try {
    const r = await syncSiteMenu("manual");
    return r.status === "ok" || r.status === "fresh";
  } catch (e) {
    console.error("[menu] 409 stale sonrası çekme", e);
    return false;
  }
}

/**
 * Değişiklik siteyi ilgilendiriyorsa siteye yazar. `consequence`: hata metninde panelde ne olmadığı ("fiyat
 * değişmedi", "değişiklikler kaydedilmedi"). Kopuk bağlantı, 0 fiyat, kapalı bağlantı ve sitenin her hatası
 * UserError'dur. `db`: kopyanın okunduğu bağlantı (çağıran bir işlemin içindeyse onun bağlantısı). `live`: çağıranın
 * az önce sitenin canlı listesinden okuduğu kalem (Tükendi / Satışa aç); verilirse kopyanın yerine o kullanılır.
 *
 * Çakışma (docs/planlar/senkron.md P1): site son çekmede `writes.expect` duyurduysa gövde yazılan alanların kopyadaki
 * değerini `expect` olarak taşır. Site 409 `stale` derse (alan sitede bu arada değişmiş) hiçbir şey yazılmaz, panel
 * sitenin güncel menüsünü okur ve kullanıcı "bu arada değişti" görür. Site `expect`'i tanımazsa (400 `field:"body"`
 * ya da `"expect"`; geri alınmış site) bir kez `expect`'siz denenir ve bayrak sonraki çekmeye kadar kapanır. Zaman aşımında site yazmış olabilir: panel yanıttan sonra okur.
 */
export async function pushSaleChange(
  user: { name: string },
  row: SaleRow,
  after: SaleValues,
  consequence: string,
  db?: Pick<ReturnType<typeof getDb>, "select">,
  opts: { live?: SiteMenuItem | null } = {},
): Promise<PushOutcome> {
  const link = row.siteMenuId && row.siteMenuSlot ? { siteMenuId: row.siteMenuId, slot: row.siteMenuSlot } : null;
  if (!link) return { kind: "local" };
  const snapshot = await readSiteSnapshot(db);
  const state = await readMenuSyncState(db);
  const plan = planPush({
    link,
    before: row,
    after,
    actor: user.name,
    siteItem: opts.live ?? snapshot.items.find((i) => i.id === link.siteMenuId) ?? null,
    expect: state.writesExpect === true,
  });
  if (plan.kind === "none") return { kind: "local" };
  if (plan.kind === "refuse") throw new UserError(plan.error);
  const secret = siteLinkSecret();
  // Sitenin hatalarında nedeni (`cause`, PushFailure) de taşınır: toplu fiyat değişikliği site kapalıyken sıradaki
  // ürünleri göndermez (src/server/prices/batch.ts); metin ve öteki çağıranlar için hata aynı UserError
  if (!secret) throw new UserError(pushFailureMessage({ kind: "off" }, consequence), { cause: { kind: "off" } });
  const post = async (body: PushBody) => {
    try {
      return await callSite(secret, "/api/panel/menu", { method: "POST", body: JSON.stringify(body) });
    } catch (e) {
      if (!(e instanceof SiteRequestError)) throw e;
      // Zaman aşımı: istek siteye varmış, site yazmış olabilir; panel yanıttan sonra siteyi yeniden okur
      if (e.failure.kind === "timeout") await pullSoon(db !== undefined);
      throw new UserError(pushFailureMessage(e.failure, consequence), { cause: e.failure });
    }
  };
  let body = plan.body;
  let res = await post(body);
  if (res.status === 400 && body.expect && rejectsExpect(errorField(res.json))) {
    // Site `expect`'i tanımıyor (bayrağı duyuran sürüm geri alınmış): reddedilen istek hiçbir şey yazmadı. Sonraki
    // yazımlar da onu göndermez; bir sonraki çekme bayrağı yeniden okur
    body = withoutExpect(body);
    await forgetExpect(db !== undefined);
    res = await post(body);
  }
  if (!res.ok) {
    const failure: PushFailure = { kind: "http", status: res.status, field: errorField(res.json), error: errorCode(res.json) };
    if (res.status === 409 && failure.error === "stale") {
      // Alan sitede bu arada değişti: yazılmadı. Kalem yanıtta güncel hâliyle gelir; panel bütün menüyü yeniden okur
      const current = parseSiteMenuAnswer(res.json);
      const reloaded = await reloadAfterStale(db !== undefined);
      throw new UserError(staleMessage(consequence, { reloaded, sitePrice: plan.price && current ? slotPriceMinor(current, link.slot) : null }), { cause: failure });
    }
    throw new UserError(pushFailureMessage(failure, consequence), { cause: failure });
  }
  return { kind: "pushed", item: parseSiteMenuAnswer(res.json), body, price: plan.price, visibility: plan.visibility, ...link };
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
  // Yalnız fiyat yazımı Tükenenler kartının kaydını yeni damgaya taşır (kopyadaki eski damga yenilenmeden önce
  // okunur; src/server/site-menu/sold-out-store.ts): panelin kendi fiyat değişikliği personelin kaydını düşürmez
  if (!outcome.visibility) {
    const prev = (await readSiteSnapshot(tx)).items.find((i) => i.id === item.id)?.updatedAt ?? null;
    await carrySoldOutMarker(tx, prev, item);
  }
  await replaceSnapshotItem(tx, item);
  // Site saati ilerler: bu yazımdan önce alınmış liste artık uygulanmaz. Panelin saatinden bir dakikadan ileri bir
  // zaman (sitede bozuk bir updatedAt) sayılmaz, sonraki bütün çekmeleri durdurmasın. Kalemin kendi zamanı da saklanır:
  // listenin zamanı okumadan sonra alındığı için yalnız site saati yetmez (src/lib/site-menu/plan.ts › staleItemIds)
  const cur = await readMenuSyncState(tx);
  const stamp = Math.min(Date.parse(item.updatedAt), Date.now() + 60_000);
  if (Number.isFinite(stamp)) {
    await patchMenuState(
      {
        ...(!cur.lastSiteNow || stamp > Date.parse(cur.lastSiteNow) ? { lastSiteNow: new Date(stamp).toISOString() } : {}),
        pushed: { ...freshStamps(cur.pushed, Date.now()), [item.id]: { updatedAt: item.updatedAt, at: new Date().toISOString() } },
      },
      tx,
    );
  }
  return final;
}
