import "server-only";

import { eq, sql, type SQL } from "drizzle-orm";

import { callRingMessage, callsFingerprint, newCallIds, openCalls } from "@/lib/site-orders/calls";
import { newOrderIds, ordersFingerprint, ringMessage, sortForScreen } from "@/lib/site-orders/feed";
import { awaitingUntil, missedPing, nextAwaiting, pullDue, type OrdersTrigger } from "@/lib/site-orders/follow";
import { parseSiteOrders, SiteOrdersFormatError, type SiteCall, type SiteOrder, type SiteOrderList } from "@/lib/site-orders/schema";
import { getDb, schema as s } from "@/server/db";
import { sendPush } from "@/server/push/send";
import { salesFailureMessage } from "@/server/site-sales/sync";
import { signedSiteFetch, siteLinkSecret, siteUrl } from "@/server/site-link";

/**
 * laffogato.net'in açık kafe siparişleri → bar ekranı (docs/SITE-SIPARIS.md; sözleşme sitenin docs/PANEL-ORDERS.md'si).
 * Site her sipariş yazımında panele imzalı bir ping atar (/api/orders/ping); panel sitenin açık siparişlerini imzalı
 * tek bir okumayla çeker (`GET /api/panel/orders`) ve son listeyi anlık görüntü olarak saklar (integration_state
 * `site_orders`; her çekmede üzerine yazılır, sipariş geçmişi tutulmaz). Ekran bir şey değişince artan sürümle
 * (`site_orders_version`, canlı ucun ETag'i) yeni listeyi alır; ilk kez görülen yeni siparişte zil çalar ve cihazlara
 * bildirim gider.
 *
 * Aşamayı panel kendisi yazmaz: bar ekranının düğmeleri sitenin imzalı aşama ucuna gider
 * (src/server/actions/site-orders.ts), site kendi durum makinesini işletir ve panel listeyi bu dosyadaki çekmeyle
 * yeniden alır. Son listenin kopyasını yalnız `syncSiteOrders` yazar. İade ve iptal yalnız sitenin panelinde. KVKK:
 * panele yalnız müşterinin adı gelir; adlar günlüğe ve işlem geçmişine yazılmaz.
 *
 * Ödeme takibi (senkron planı P2; kurallar src/lib/site-orders/follow.ts): sitenin yanıtındaki `awaitingPayment`
 * (ödemesini bekleyen siparişlerin sayısı) sıfırdan büyükken ekran en çok 30 dakika yoğun sayılır ve siteyi üç
 * dakikada bir sorar; ödeme pingi kaçsa da sipariş birkaç dakikada gelir. Pingle olmayan bir çekme kaçan pingin
 * getirmediği ödenmiş siparişi bulursa `missedPingAt` yazılır (Ayarlar › laffogato.net).
 *
 * Masa çağrıları ("Garson çağır", 6 Kas 2026; kurallar src/lib/site-orders/calls.ts): aynı yanıtın isteğe bağlı
 * `calls` alanı son listenin kopyasında siparişlerle birlikte durur ve sürüme girer. Yeni çağrı ve "Gördüm" sitenin
 * aynı pingini atar; ilk kez görülen çağrı cihazlara "Masa 4 · Su istiyor" diye bildirilir (ilk çekme hariç).
 */

const STATE_KEY = "site_orders_sync";
const SNAPSHOT_KEY = "site_orders";
const VERSION_KEY = "site_orders_version";
/** Ekran açılınca ya da öne gelince son çekme bundan eskiyse site yeniden sorulur */
export const SCREEN_STALE_MS = 60_000;

export interface OrdersSyncState {
  /** Son çekme denemesi (başarılı ya da değil) */
  lastPullAt: string | null;
  /** Son başarılı çekme */
  lastOkAt: string | null;
  lastError: string | null;
  /** Sitenin son pingi */
  lastPingAt: string | null;
  /** Uygulanan son listenin site saati (eski yanıt yenisinin üstüne yazılmasın) */
  lastSiteNow: string | null;
  /** Listenin değiştiği son çekme */
  lastChangeAt: string | null;
  /** İlk kez görülen yeni siparişin geldiği son çekme */
  lastNewAt: string | null;
  /** Son çekmeyi ne başlattı: sitenin pingi, ekran ya da elle */
  lastTrigger: OrdersTrigger | null;
  /** Pingle olmayan son çekme denemesi (ekran ya da elle): sakin saatin saatlik kontrolü yalnız bunu sayar */
  lastCheckAt: string | null;
  /** Son başarılı çekmede sitenin ödeme bekleyen sayısı (alan yoksa 0) */
  awaitingPayment: number;
  /** Ödeme takibinin başladığı ya da yeniden başladığı an; takip yoksa null (bitişi `awaitingUntil`) */
  awaitingSince: string | null;
  /** Son kaçan ping: pingle olmayan bir çekme, pingi hiç gelmemiş ödenmiş bir sipariş buldu */
  missedPingAt: string | null;
}

export type { OrdersTrigger };

const EMPTY: OrdersSyncState = {
  lastPullAt: null,
  lastOkAt: null,
  lastError: null,
  lastPingAt: null,
  lastSiteNow: null,
  lastChangeAt: null,
  lastNewAt: null,
  lastTrigger: null,
  lastCheckAt: null,
  awaitingPayment: 0,
  awaitingSince: null,
  missedPingAt: null,
};

export interface OrdersSnapshot {
  /** Listenin site saati */
  now: string | null;
  /** Panelin listeyi aldığı an */
  at: string | null;
  complete: boolean;
  skipped: number;
  orders: SiteOrder[];
  /** Açık masa çağrıları (sitenin gönderdiği gibi; ekran 15 dakikadan eskisini göstermez) */
  calls: SiteCall[];
  /** Okunamayıp atlanan masa çağrısı sayısı */
  callsSkipped: number;
  /** Kopya çağrılarla birlikte yazılmış: değilse (çağrılardan önceki kopya) ilk çekme gibi hiçbir çağrı yeni sayılmaz */
  callsKnown: boolean;
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Exec = { execute: (query: SQL) => Promise<unknown> };

async function readKey<T>(key: string, db: Pick<Db, "select"> = getDb()): Promise<Partial<T> | undefined> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, key)).limit(1);
  return row?.value as Partial<T> | undefined;
}

export async function readOrdersState(db?: Pick<Db, "select">): Promise<OrdersSyncState> {
  return { ...EMPTY, ...((await readKey<OrdersSyncState>(STATE_KEY, db)) ?? {}) };
}

/** Son listenin kopyası (hiç alınmadıysa boş liste, `at` null) */
export async function readOrdersSnapshot(db?: Pick<Db, "select">): Promise<OrdersSnapshot> {
  const v = await readKey<OrdersSnapshot>(SNAPSHOT_KEY, db);
  return {
    now: v?.now ?? null,
    at: v?.at ?? null,
    complete: v?.complete !== false,
    skipped: typeof v?.skipped === "number" ? v.skipped : 0,
    orders: Array.isArray(v?.orders) ? v.orders : [],
    calls: Array.isArray(v?.calls) ? v.calls : [],
    callsSkipped: typeof v?.callsSkipped === "number" ? v.callsSkipped : 0,
    callsKnown: Array.isArray(v?.calls),
  };
}

async function patchState(patch: Partial<OrdersSyncState>, db: Exec = getDb()): Promise<void> {
  await db.execute(sql`
    insert into integration_state (key, value) values (${STATE_KEY}, ${JSON.stringify(patch)}::jsonb)
    on conflict (key) do update set value = integration_state.value || ${JSON.stringify(patch)}::jsonb, updated_at = now()`);
}

/**
 * Sipariş ekranının değişim sayacı: liste ya da bağlantının hata durumu değişince bir artar. Canlı uç (/api/canli) bunu
 * ETag'e koyar; açık sekmenin kontrolü değişiklik yoksa tek bir birincil anahtar okumasıyla 304 alır.
 */
async function bumpOrdersVersion(db: Exec): Promise<void> {
  await db.execute(sql`
    insert into integration_state (key, value) values (${VERSION_KEY}, '{"v":1}'::jsonb)
    on conflict (key) do update
      set value = jsonb_build_object('v', coalesce((integration_state.value->>'v')::bigint, 0) + 1), updated_at = now()`);
}

export async function ordersVersion(): Promise<string> {
  const v = await readKey<{ v: number }>(VERSION_KEY);
  return String(v?.v ?? 0);
}

export async function noteOrdersPing(): Promise<void> {
  await patchState({ lastPingAt: new Date().toISOString() });
}

export type OrdersSyncResult =
  | { status: "off" }
  | { status: "fresh" }
  | { status: "ok"; count: number; fresh: number; changed: boolean; skipped: number; calls: number }
  | { status: "error"; error: string };

/** Sitenin açık siparişleri (imzalı); hata Türkçe açıklamalı fırlar */
async function fetchSiteOrders(secret: string): Promise<SiteOrderList> {
  let res: Response;
  try {
    res = await signedSiteFetch(secret, new URL("/api/panel/orders", siteUrl()));
  } catch (e) {
    throw new Error(salesFailureMessage(e instanceof Error && e.name === "TimeoutError" ? { kind: "timeout" } : { kind: "network" }));
  }
  if (!res.ok) {
    throw new Error(res.status === 404 ? "Sitede panel sipariş ucu yok (laffogato.net güncel değil)" : salesFailureMessage({ kind: "http", status: res.status }));
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Sitenin sipariş yanıtı okunamadı");
  }
  try {
    return parseSiteOrders(json);
  } catch (e) {
    throw new Error(e instanceof SiteOrdersFormatError ? e.message : "Sitenin sipariş yanıtı okunamadı");
  }
}

/**
 * Sitenin açık siparişlerini çeker ve son listeyi yazar (tek işlem, danışma kilidi). Eski bir yanıt yenisinin üstüne
 * yazılmaz. Liste ya da hata durumu değişince sürüm artar; ilk kez görülen yeni sipariş varsa (ilk çekme hariç)
 * cihazlara bildirim gider. Ağ ya da site hatasında son doğru liste kalır, yalnız hata yazılır.
 */
export async function syncSiteOrders(trigger: OrdersTrigger): Promise<OrdersSyncResult> {
  const secret = siteLinkSecret();
  if (!secret) return { status: "off" };
  const tryAt = new Date().toISOString();
  let list: SiteOrderList;
  try {
    list = await fetchSiteOrders(secret);
  } catch (e) {
    const error = (e instanceof Error ? e.message : "Bilinmeyen hata").slice(0, 300);
    await getDb().transaction(async (tx) => {
      await lockOrders(tx);
      const prev = await readOrdersState(tx);
      await patchState({ lastPullAt: tryAt, lastError: error, lastTrigger: trigger, ...checked(trigger, tryAt) }, tx);
      // Hata ilk kez görünüyor ya da değişti: açık ekranlar "son çekme başarısız" satırını göstersin
      if (prev.lastError !== error) await bumpOrdersVersion(tx);
    });
    return { status: "error", error };
  }

  const at = new Date();
  const applied = await getDb().transaction(async (tx) => {
    await lockOrders(tx);
    const state = await readOrdersState(tx);
    const last = state.lastSiteNow ? Date.parse(state.lastSiteNow) : NaN;
    // Arada daha yeni bir yanıt uygulandıysa bu eski kalır (panelin saatinden on dakika ileri bir kayıt bozuktur)
    if (last > Date.parse(list.now) && last < Date.now() + 10 * 60_000) {
      await patchState({ lastPullAt: tryAt, lastTrigger: trigger, ...checked(trigger, tryAt) }, tx);
      return null;
    }
    const prev = await readOrdersSnapshot(tx);
    const orders = sortForScreen(list.orders);
    const fresh = newOrderIds(prev.at ? prev.orders : null, orders);
    // Masa çağrıları: ilk çekmede ve çağrılardan önce yazılmış kopyada hiçbiri yeni sayılmaz
    const calls = list.calls;
    const freshCalls = newCallIds(prev.at && prev.callsKnown ? prev.calls : null, calls);
    const changed =
      !prev.at ||
      ordersFingerprint(prev.orders) !== ordersFingerprint(orders) ||
      prev.complete !== list.complete ||
      prev.skipped !== list.skipped ||
      callsFingerprint(prev.calls) !== callsFingerprint(calls) ||
      prev.callsSkipped !== list.callsSkipped;
    if (changed) {
      const snapshot: Omit<OrdersSnapshot, "callsKnown"> = {
        now: list.now,
        at: at.toISOString(),
        complete: list.complete,
        skipped: list.skipped,
        orders,
        calls,
        callsSkipped: list.callsSkipped,
      };
      await tx.execute(sql`
        insert into integration_state (key, value) values (${SNAPSHOT_KEY}, ${JSON.stringify(snapshot)}::jsonb)
        on conflict (key) do update set value = ${JSON.stringify(snapshot)}::jsonb, updated_at = now()`);
    }
    const iso = at.toISOString();
    // Ödeme takibi: başlaması, yeniden başlaması ve bitmesi ekranın yoğunluğunu değiştirir, sürüm artar (açık sekme
    // yeni `awaitingUntil`'i alır). Pingin kendisi sürümü artırmaz
    const awaiting = nextAwaiting(state, list.awaitingPayment, trigger, iso);
    const followChanged = awaitingUntil(state) !== awaitingUntil(awaiting);
    // Kaçan ping: pingle olmayan bu çekme, pingi gelmemiş ödenmiş bir sipariş getirdi
    const missed = missedPing(
      orders.filter((o) => fresh.includes(o.id)),
      { trigger, siteNow: list.now, lastPingAt: state.lastPingAt, prevComplete: prev.complete },
    );
    await patchState(
      {
        lastPullAt: tryAt,
        lastOkAt: iso,
        lastError: null,
        lastSiteNow: list.now,
        lastTrigger: trigger,
        ...checked(trigger, tryAt),
        ...awaiting,
        ...(changed ? { lastChangeAt: iso } : {}),
        ...(fresh.length ? { lastNewAt: iso } : {}),
        ...(missed ? { missedPingAt: iso } : {}),
      },
      tx,
    );
    if (changed || state.lastError || followChanged) await bumpOrdersVersion(tx);
    return { orders, fresh, changed, calls, freshCalls };
  });
  if (!applied) return { status: "fresh" };

  if (applied.fresh.length) {
    try {
      await announce(applied.orders.filter((o) => applied.fresh.includes(o.id)), at.getTime());
    } catch (e) {
      console.error("[siparis] bildirim", (e as Error).message);
    }
  }
  if (applied.freshCalls.length) {
    try {
      await announceCalls(applied.calls.filter((c) => applied.freshCalls.includes(c.id)), at.getTime());
    } catch (e) {
      console.error("[siparis] çağrı bildirimi", (e as Error).message);
    }
  }
  return { status: "ok", count: applied.orders.length, fresh: applied.fresh.length, changed: applied.changed, skipped: list.skipped, calls: applied.calls.length };
}

async function lockOrders(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('site-orders'))`);
}

/** Pingle olmayan çekme denemesi `lastCheckAt`'i de yazar (sakin saatin kontrolü yalnız bunu sayar) */
const checked = (trigger: OrdersTrigger, tryAt: string): Partial<OrdersSyncState> => (trigger === "ping" ? {} : { lastCheckAt: tryAt });

/**
 * Bar ekranının isteği: son çekme `maxAgeMs`'ten eskiyse siteyi yeniden sorar (ekran açılınca ya da öne gelince bir
 * dakika, arka planda birkaç dakika; docs/SITE-SIPARIS.md). Güncelse siteye gidilmez. Sakin saatin saatlik kontrolü
 * pingle yapılan çekmeyi saymaz (araya giren başka bir siparişin pingi kaçan ödemeyi bir saat daha gizlemesin). Son
 * çekme hatalıysa beş saniyeden eski her istek, elle "Yenile" ise hemen yeniden dener (site geri gelince liste
 * beklemeden gelsin). Kural: src/lib/site-orders/follow.ts `pullDue`.
 */
export async function ensureOrdersFresh(maxAgeMs: number, opts: { manual?: boolean } = {}): Promise<OrdersSyncResult> {
  if (!siteLinkSecret()) return { status: "off" };
  const state = await readOrdersState();
  if (!pullDue(state, maxAgeMs, { manual: opts.manual, nowMs: Date.now() })) return { status: "fresh" };
  return syncSiteOrders(opts.manual ? "manual" : "screen");
}

/** Yeni siparişi cihazlara bildirir (masa siparişi önce); müşterinin adı bildirime yazılmaz (kilit ekranı) */
async function announce(orders: SiteOrder[], nowMs: number): Promise<void> {
  if (!orders.length) return;
  const { title, body } = ringMessage(sortForScreen(orders));
  await sendPush("orders", {
    kind: "orders",
    title,
    body,
    url: "/panel/siparisler",
    tag: orders.length === 1 ? `siparis-${orders[0].id}` : `siparis-${nowMs}`,
    ring: true,
  });
}

/** Yeni masa çağrısını cihazlara bildirir ("Masa 4 · Su istiyor"); müşteriye dair bir şey yok. Süresi dolmuş çağrı bildirilmez */
async function announceCalls(calls: SiteCall[], nowMs: number): Promise<void> {
  const open = openCalls(calls, nowMs);
  if (!open.length) return;
  const { title, body } = callRingMessage(open);
  await sendPush("orders", {
    kind: "orders",
    title,
    body,
    url: "/panel/siparisler",
    tag: open.length === 1 ? `cagri-${open[0].id}` : `cagri-${nowMs}`,
    ring: true,
  });
}
