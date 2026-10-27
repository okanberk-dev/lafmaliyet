import "server-only";

import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";

import { sitePriceRecord } from "@/lib/prices/history";
import {
  changeText,
  freshStamps,
  planMenuSync,
  planSummary,
  staleItemIds,
  type BrokenLink,
  type LinkedRow,
  type MenuSyncPlan,
  type PushedStamps,
  type UnlinkedRow,
} from "@/lib/site-menu/plan";
import { pullFailureMessage, type PushFailure } from "@/lib/site-menu/push";
import { parseSiteMenuList, SiteMenuFormatError, type SiteMenuItem, type SiteMenuList } from "@/lib/site-menu/schema";
import type { SiteMenuSlot } from "@/lib/site-menu/slot";
import { logActivity } from "@/server/actions/log";
import { withPassiveRelist } from "@/server/data/ingredient-usage";
import { getDb, schema as s } from "@/server/db";
import { recordPriceChange } from "@/server/prices/record";
import { signedSiteFetch, siteLinkSecret, siteUrl } from "@/server/site-link";

/**
 * laffogato.net menüsü → panel: sitenin bütün kalemlerini imzalı çeker (GET /api/panel/menu) ve bağlı ürünlere
 * uygular (src/lib/site-menu/plan.ts). Ne zaman: sitenin pingi (/api/menu/ping), Ürünler sayfası açılınca (son
 * denemeden 5 dakika geçtiyse), günlük iş ve "Siteyle eşitle". Karaoke eşitlemesi gibi tek işlemde ve danışma
 * kilidiyle yazar; eski bir yanıt yenisinin (ya da sonraki bir panel yazımının) üstüne yazılmaz. Sonuç
 * integration_state'te: `menu_sync` (durum) ve `menu_site_items` (son listenin kopyası; ekranlar siteye gitmeden
 * kalemin adını, fiyatını ve durumunu gösterir). Ayrıntı: docs/SITE-MENU.md.
 */

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Exec = { execute: (query: SQL) => Promise<unknown> };

const STATE_KEY = "menu_sync";
const ITEMS_KEY = "menu_site_items";
/** Sayfa açılışında site en çok bu kadar sürede bir sorulur (ping kaçtıysa) */
const PAGE_SYNC_INTERVAL_MS = 5 * 60_000;
/** Sitede silindiği için bağlantısı kaldırılan satırların raporu en çok bu kadar tutulur */
const UNLINKED_KEEP = 20;
/** İşlem geçmişinde sitenin yaptığı değişikliklerin "kullanıcısı" */
export const SITE_ACTOR = { name: "laffogato.net" };

export interface MenuSyncState {
  /** Son çekme denemesi (başarılı ya da değil) */
  lastPullAt: string | null;
  /** Son başarılı çekme */
  lastOkAt: string | null;
  lastError: string | null;
  /** Sitenin son pingi */
  lastPingAt: string | null;
  /** Uygulanan son listenin ya da panel yazımının site saati (eski yanıt yenisinin üstüne yazılmasın) */
  lastSiteNow: string | null;
  /** Son başarılı çekmede değişen panel satırı (fiyat, menü durumu ya da kaldırılan bağlantı) */
  changedRows: number | null;
  /** Bir şey değiştiren son çekme ve değişiklikleri */
  lastChangedAt: string | null;
  lastChanges: { productId: number; label: string; text: string }[];
  /** Kopuk bağlantılar (L yuvası, kalem sitede tek boy) */
  broken: BrokenLink[];
  /** Kalem sitede silindiği için bağlantısı kaldırılan satırlar, yeniden eskiye */
  unlinked: (UnlinkedRow & { at: string })[];
  /** Son listedeki kalem sayısı */
  itemCount: number | null;
  /** Panelin son bir saatte siteye yazdığı kalemlerin sitedeki zamanı: bundan eski liste o kalemi geri almaz */
  pushed: PushedStamps;
  /**
   * Son başarılı çekmede site yazma ucunda `expect`'i duyurdu (`writes.expect`): panel → site yazımı beklenen değeri
   * gönderir (src/server/site-menu/push.ts). Eski sitede false: yazım bugünkü gibi `expect`'siz
   */
  writesExpect: boolean;
}

const EMPTY: MenuSyncState = {
  lastPullAt: null,
  lastOkAt: null,
  lastError: null,
  lastPingAt: null,
  lastSiteNow: null,
  changedRows: null,
  lastChangedAt: null,
  lastChanges: [],
  broken: [],
  unlinked: [],
  itemCount: null,
  pushed: {},
  writesExpect: false,
};

export interface SiteItemsSnapshot {
  /** Listenin site saati */
  now: string | null;
  /** Panelin listeyi aldığı an */
  at: string | null;
  items: SiteMenuItem[];
}

async function readKey<T>(key: string, db: Pick<ReturnType<typeof getDb>, "select"> = getDb()): Promise<Partial<T> | undefined> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, key)).limit(1);
  return row?.value as Partial<T> | undefined;
}

export async function readMenuSyncState(db?: Pick<ReturnType<typeof getDb>, "select">): Promise<MenuSyncState> {
  return { ...EMPTY, ...((await readKey<MenuSyncState>(STATE_KEY, db)) ?? {}) };
}

export async function readSiteSnapshot(db?: Pick<ReturnType<typeof getDb>, "select">): Promise<SiteItemsSnapshot> {
  const v = await readKey<SiteItemsSnapshot>(ITEMS_KEY, db);
  return { now: v?.now ?? null, at: v?.at ?? null, items: Array.isArray(v?.items) ? v.items : [] };
}

/** Durumu birleştirerek yazar (verilen alanlar değişir, ötekiler kalır) */
export async function patchMenuState(patch: Partial<MenuSyncState>, db: Exec = getDb()): Promise<void> {
  await db.execute(sql`
    insert into integration_state (key, value) values (${STATE_KEY}, ${JSON.stringify(patch)}::jsonb)
    on conflict (key) do update set value = integration_state.value || ${JSON.stringify(patch)}::jsonb, updated_at = now()`);
}

async function writeSnapshot(snapshot: SiteItemsSnapshot, db: Exec): Promise<void> {
  await db.execute(sql`
    insert into integration_state (key, value) values (${ITEMS_KEY}, ${JSON.stringify(snapshot)}::jsonb)
    on conflict (key) do update set value = ${JSON.stringify(snapshot)}::jsonb, updated_at = now()`);
}

/** Panelin yazımından sonra son listenin kopyasında tek kalemi yeniler (liste hiç alınmadıysa dokunmaz) */
export async function replaceSnapshotItem(tx: Tx, item: SiteMenuItem): Promise<void> {
  const snapshot = await readSiteSnapshot(tx);
  if (!snapshot.at) return;
  const items = snapshot.items.some((i) => i.id === item.id) ? snapshot.items.map((i) => (i.id === item.id ? item : i)) : [...snapshot.items, item];
  await writeSnapshot({ ...snapshot, items }, tx);
}

export async function notePing(): Promise<void> {
  await patchMenuState({ lastPingAt: new Date().toISOString() });
}

/** Menü yazımları sırayla: çekme, bağlama ve panel → site yazımının yerel kısmı aynı danışma kilidini alır */
export async function lockMenu(tx: Exec): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('menu-sync'))`);
}

/** Siteye istek başarısız: neden (ağ, zaman aşımı, HTTP durumu) ve gösterilecek metin */
export class SiteRequestError extends Error {
  constructor(
    readonly failure: PushFailure,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Siteye imzalı istek; ağ hatası ve zaman aşımı SiteRequestError olur, HTTP durumu çağırana kalır. Gövde JSON
 * değilse ya da okunamazsa json null.
 */
export async function callSite(secret: string, path: string, init: { method?: "GET" | "POST"; body?: string } = {}): Promise<{ status: number; ok: boolean; json: unknown }> {
  let res: Response;
  try {
    res = await signedSiteFetch(secret, new URL(path, siteUrl()), init);
  } catch (e) {
    const failure: PushFailure = e instanceof Error && e.name === "TimeoutError" ? { kind: "timeout" } : { kind: "network" };
    throw new SiteRequestError(failure, pullFailureMessage(failure));
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

/** Sitenin bütün menüsü (imzalı). Hata: SiteRequestError, Türkçe açıklamalı */
export async function fetchSiteMenu(secret: string): Promise<SiteMenuList> {
  const res = await callSite(secret, "/api/panel/menu");
  if (!res.ok) {
    const failure: PushFailure = { kind: "http", status: res.status };
    throw new SiteRequestError(failure, pullFailureMessage(failure));
  }
  try {
    return parseSiteMenuList(res.json);
  } catch (e) {
    throw new SiteRequestError({ kind: "http", status: res.status }, e instanceof SiteMenuFormatError ? e.message : "Sitenin menü yanıtı okunamadı");
  }
}

/** Satış alanları ve bağlantı: planın okuduğu sütunlar */
export const linkColumns = {
  id: s.products.id,
  name: s.products.name,
  size: s.products.size,
  price: s.products.price,
  active: s.products.active,
  showOnMenu: s.products.showOnMenu,
  siteMenuId: s.products.siteMenuId,
  siteMenuSlot: s.products.siteMenuSlot,
};

/** Veritabanı satırı bağlıysa planın satırı, değilse null */
export function asLinkedRow(r: Omit<LinkedRow, "siteMenuId" | "siteMenuSlot"> & { siteMenuId: string | null; siteMenuSlot: string | null }): LinkedRow | null {
  if (!r.siteMenuId || (r.siteMenuSlot !== "M" && r.siteMenuSlot !== "L")) return null;
  return { ...r, siteMenuId: r.siteMenuId, siteMenuSlot: r.siteMenuSlot };
}

/** Bağlı bütün satırlar (kilit altında okunmalı) */
export async function loadLinkedRows(tx: Pick<Tx, "select">): Promise<LinkedRow[]> {
  const rows = await tx.select(linkColumns).from(s.products).where(isNotNull(s.products.siteMenuId));
  return rows.flatMap((r) => asLinkedRow(r) ?? []);
}

/**
 * Planı yazar; yalnız hâlâ aynı kaleme ve yuvaya bağlı satırlara (arada bağlantı değiştiyse dokunulmaz). Sitenin
 * değiştirdiği fiyat, satıra yazıldıysa, satış fiyatı geçmişine ve kasanın (ModPOS) listesine de girer (docs/FIYATLAR.md).
 */
export async function applyPlan(tx: Tx, plan: MenuSyncPlan, now: Date): Promise<void> {
  const same = (productId: number, siteMenuId: string, slot: SiteMenuSlot) =>
    and(eq(s.products.id, productId), eq(s.products.siteMenuId, siteMenuId), eq(s.products.siteMenuSlot, slot));
  // Site "Satışta" deyince pasif ürün aktif olur: reçetesindeki pasif malzeme sayım listesine bu aydan girer
  const activated = plan.changes.filter((c) => c.set.active === true).map((c) => c.productId);
  await withPassiveRelist(tx, activated, [], async () => {
    for (const c of plan.changes) {
      const updated = await tx
        .update(s.products)
        .set({ ...c.set, updatedAt: now })
        .where(same(c.productId, c.siteMenuId, c.slot))
        .returning({ id: s.products.id });
      const record = sitePriceRecord(c, updated.length > 0, SITE_ACTOR.name);
      if (record) await recordPriceChange(tx, record, now);
    }
  });
  for (const u of plan.unlinked) {
    await tx.update(s.products).set({ siteMenuId: null, siteMenuSlot: null, updatedAt: now }).where(same(u.productId, u.siteMenuId, u.slot));
  }
}

export interface AppliedList {
  plan: MenuSyncPlan;
  /** Bu çekmede yeni kopan bağlantılar (her çekmede yeniden yazılmasın) */
  newlyBroken: BrokenLink[];
}

/**
 * Sitenin bütün listesini kilit altında uygular: bağlı satırlar, son listenin kopyası ve durum. Arada daha yeni bir
 * liste ya da panel yazımı uygulandıysa (site saatine göre) null döner, hiçbir şey yazılmaz.
 */
export async function applySiteList(tx: Tx, list: SiteMenuList, at: Date, tryAt: string = at.toISOString()): Promise<AppliedList | null> {
  await lockMenu(tx);
  const cur = await readMenuSyncState(tx);
  const last = cur.lastSiteNow ? Date.parse(cur.lastSiteNow) : NaN;
  // Panelin saatinden on dakika ileri bir kayıt bozuktur: çekmeleri sonsuza dek durdurmasın
  if (last > Date.parse(list.now) && last < Date.now() + 10 * 60_000) return null;
  // Panelin kendi yazımından önce okunmuş kalemler uygulanmaz; kopyada yazımın hâli kalır (src/lib/site-menu/plan.ts › staleItemIds)
  const pushed = freshStamps(cur.pushed, Date.now());
  const stale = staleItemIds(list.items, pushed);
  const plan = planMenuSync(list.items, (await loadLinkedRows(tx)).filter((r) => !stale.has(r.siteMenuId)));
  await applyPlan(tx, plan, at);
  const kept = stale.size ? new Map((await readSiteSnapshot(tx)).items.map((i) => [i.id, i])) : null;
  const items = kept ? list.items.map((i) => (stale.has(i.id) ? (kept.get(i.id) ?? i) : i)) : list.items;
  await writeSnapshot({ now: list.now, at: at.toISOString(), items }, tx);
  const iso = at.toISOString();
  const key = (b: BrokenLink) => `${b.productId}:${b.siteMenuId}:${b.slot}`;
  const known = new Set(cur.broken.map(key));
  const changed = plan.changes.length + plan.unlinked.length;
  await patchMenuState(
    {
      lastPullAt: tryAt,
      lastOkAt: iso,
      lastError: null,
      lastSiteNow: list.now,
      changedRows: changed,
      broken: plan.broken,
      unlinked: [...plan.unlinked.map((u) => ({ ...u, at: iso })), ...cur.unlinked].slice(0, UNLINKED_KEEP),
      itemCount: list.items.length,
      pushed,
      writesExpect: list.writesExpect,
      ...(changed
        ? {
            lastChangedAt: iso,
            lastChanges: [
              ...plan.changes.map((c) => ({ productId: c.productId, label: c.label, text: changeText(c) })),
              ...plan.unlinked.map((u) => ({ productId: u.productId, label: u.label, text: `bağlantı kaldırıldı (${u.siteMenuId} sitede yok)` })),
            ].slice(0, 50),
          }
        : {}),
    },
    tx,
  );
  return { plan, newlyBroken: plan.broken.filter((b) => !known.has(key(b))) };
}

/** Çekmenin sonucunu işlem geçmişine yazar (sitenin yaptığı değişiklikler, kaldırılan ve kopan bağlantılar) */
export async function logApplied(applied: AppliedList): Promise<void> {
  const { plan, newlyBroken } = applied;
  if (plan.changes.length) await logActivity(SITE_ACTOR, "Site menüsünden güncellendi", planSummary(plan.changes));
  if (plan.unlinked.length) {
    await logActivity(
      SITE_ACTOR,
      "Site bağlantısı kaldırıldı",
      `Kalem sitede silinmiş: ${plan.unlinked.map((u) => `${u.label} (${u.siteMenuId})`).join(", ")}`,
    );
  }
  if (newlyBroken.length) {
    await logActivity(
      SITE_ACTOR,
      "Site bağlantısı koptu",
      `Sitede L fiyatı silinmiş, fiyata dokunulmadı: ${newlyBroken.map((b) => `${b.label} → ${b.siteName}`).join(", ")}`,
    );
  }
}

export type MenuSyncResult =
  | { status: "off" }
  | { status: "fresh" }
  | { status: "ok"; changed: number; unlinked: number; broken: number; items: number }
  | { status: "error"; error: string };

/**
 * Sitenin menüsünü çeker ve uygular. `page`: son denemeden beş dakika geçmediyse sormaz. Ağ ya da site hatasında
 * yalnız durum yazılır (son hata), panelde hiçbir satır değişmez.
 */
export async function syncSiteMenu(trigger: "ping" | "page" | "manual" | "cron"): Promise<MenuSyncResult> {
  const secret = siteLinkSecret();
  if (!secret) return { status: "off" };
  if (trigger === "page") {
    const state = await readMenuSyncState();
    if (state.lastPullAt && Date.now() - Date.parse(state.lastPullAt) < PAGE_SYNC_INTERVAL_MS) return { status: "fresh" };
  }
  const tryAt = new Date().toISOString();
  let list: SiteMenuList;
  try {
    list = await fetchSiteMenu(secret);
  } catch (e) {
    const error = (e instanceof Error ? e.message : "Bilinmeyen hata").slice(0, 300);
    await patchMenuState({ lastPullAt: tryAt, lastError: error });
    return { status: "error", error };
  }
  if (!list.items.length) {
    // Boş liste "her kalem silindi" demek olurdu ve bütün bağlantıları kaldırırdı; sitenin veritabanı boş ya da
    // yanlış olabilir: hiçbir şey uygulanmaz, hata olarak gösterilir
    const [linked] = await getDb().select({ id: s.products.id }).from(s.products).where(isNotNull(s.products.siteMenuId)).limit(1);
    if (linked) {
      const error = "Sitenin menüsü boş geldi; bağlantılar korunuyor (sitede bir sorun olabilir)";
      await patchMenuState({ lastPullAt: tryAt, lastError: error });
      return { status: "error", error };
    }
  }
  const at = new Date();
  const applied = await getDb().transaction((tx) => applySiteList(tx, list, at, tryAt));
  if (!applied) {
    // Arada daha yeni bir liste ya da panel yazımı uygulandı: panel zaten güncel (sitenin yetenek bayrağı yine yazılır)
    await patchMenuState({ lastPullAt: tryAt, lastOkAt: at.toISOString(), lastError: null, writesExpect: list.writesExpect });
    return { status: "fresh" };
  }
  await logApplied(applied);
  return {
    status: "ok",
    changed: applied.plan.changes.length,
    unlinked: applied.plan.unlinked.length,
    broken: applied.plan.broken.length,
    items: list.items.length,
  };
}
