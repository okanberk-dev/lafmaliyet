// Bar ekranının ödeme takibi ve kaçan ping (senkron planı P2; src/lib/site-orders/follow.ts,
// src/server/site-orders/sync.ts), gerçek Postgres'te ve sitenin sahte ucuyla: laffogato.net'e hiç gidilmez, imzalı
// GET /api/panel/orders bellekteki bir siteye yönlenir (imza sahte anahtarla doğrulanır), bildirim gönderilmez.
//
// Sitenin `awaitingPayment`'ı yokken takip yok; 0 → > 0 geçişinde, sayı artınca ve sayı sıfırdan büyükken gelen pingte
// takip (yeniden) başlar ve sürüm artar; ekranın kendi çekmesi takibi uzatmaz, sürüm de artmaz; sayı 0 olunca takip
// biter. Sakin saatin kontrolü pingle yapılan çekmeyi saymaz, sık kontroller sayar. Pingle olmayan çekme pingi hiç
// gelmemiş ödenmiş siparişi getirirse `missedPingAt` yazılır; ping gelip çekmesi düştüyse, sipariş az önce ödendiyse ya
// da çekme pingle yapıldıysa yazılmaz. Site hata verirse takip olduğu gibi kalır.
//
// integration_state'teki sipariş satırlarını (kopya, durum, sürüm) başta saklar ve sonda geri yazar.
//
// BAGLANTI_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: BAGLANTI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_baglanti npx tsx --test tests/siparis-takip-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../src/lib/karaoke/signature";
import { AWAITING_FOLLOW_MS, awaitingUntil as followUntil, boardBusy } from "../src/lib/site-orders/follow";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL_ = process.env.BAGLANTI_TEST_DATABASE_URL;
const SECRET = "siparis-takip-test-anahtari-gercek-degil-0123";
const SITE = "http://site.test";
const KEYS = ["site_orders", "site_orders_sync", "site_orders_version"];

describe("Bar ekranı: ödeme takibi ve kaçan ping (sitenin sahte ucuyla)", { skip: !URL_ && "BAGLANTI_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let sync: typeof import("../src/server/site-orders/sync");
  let closeDb: () => Promise<void>;
  const saved: { key: string; value: unknown }[] = [];
  const realFetch = globalThis.fetch;
  const pushes: unknown[] = [];

  // ------------------------------------------------ Sahte site
  type Order = Record<string, unknown>;
  /** Sitenin şimdiki hâli: açık siparişler, ödeme bekleyen sayısı (undefined: S2 öncesi site alanı göndermez), hata */
  const site: { orders: Order[]; awaiting: number | undefined; fail: boolean } = { orders: [], awaiting: undefined, fail: false };
  let gets = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function fakeSite(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== SITE) return realFetch(input, init);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const ok = verifySignature(SECRET, { method: init?.method ?? "GET", url, body: "", timestamp: headers[TIMESTAMP_HEADER] ?? null, signature: headers[SIGNATURE_HEADER] ?? null });
    if (!ok) return json(401, { error: "unauthorized" });
    if (url.pathname !== "/api/panel/orders") return json(404, { error: "not_found" });
    gets++;
    if (site.fail) return json(503, { error: "unavailable" });
    return json(200, {
      version: 1,
      now: new Date().toISOString(),
      complete: true,
      orders: site.orders,
      ...(site.awaiting === undefined ? {} : { awaitingPayment: site.awaiting }),
    });
  }
  const paid = (id: string, agoMs: number): Order => ({
    id,
    orderNo: 10000 + Number(id.replace(/\D/g, "")),
    stage: "new",
    fulfillment: "pickup",
    label: "Gel-al",
    firstName: "Can",
    scheduledFor: "",
    paidAt: new Date(Date.now() - agoMs).toISOString(),
    lines: [{ menuItemId: "mnu-0003", name: "Latte", size: "M", detail: "M", qty: 1 }],
    path: `/admin/siparisler/${id}`,
  });

  // ------------------------------------------------ Panel tarafı
  const state = () => sync.readOrdersState(db);
  const version = () => sync.ordersVersion();
  /** Sitenin pingi: ping ucunun yaptığı gibi önce kayıt, sonra çekme */
  async function ping() {
    await sync.noteOrdersPing();
    return sync.syncSiteOrders("ping");
  }
  /** Durum satırına doğrudan yazar (geçmişte kalmış bir ping ya da çekme) */
  const patch = (value: Record<string, unknown>) =>
    db.execute(sql`update integration_state set value = value || ${JSON.stringify(value)}::jsonb where key = 'site_orders_sync'`);
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  before(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.KARAOKE_SYNC_SECRET = SECRET;
    process.env.LAFFOGATO_URL = SITE;
    globalThis.fetch = fakeSite as typeof fetch;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    // Yeni siparişin bildirimi gönderilmez, yalnız sayılır (paylaşılan veritabanında gerçek abonelik olabilir)
    stub(require.resolve("../src/server/push/send"), {
      sendPush: async (topic: string, msg: unknown) => {
        pushes.push({ topic, msg });
        return { sent: 0, failed: 0, removed: 0 };
      },
      vapidPublicKey: async () => null,
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL_!, 4);
    closeDb = () => dbModule.getDb().$client.end();
    sync = await import("../src/server/site-orders/sync");
    for (const row of await db.select().from(s.integrationState).where(inArray(s.integrationState.key, KEYS))) saved.push({ key: row.key, value: row.value });
  });

  beforeEach(async () => {
    await db.delete(s.integrationState).where(inArray(s.integrationState.key, KEYS));
    Object.assign(site, { orders: [], awaiting: undefined, fail: false });
    gets = 0;
    pushes.length = 0;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    if (!db) return;
    await db.delete(s.integrationState).where(inArray(s.integrationState.key, KEYS));
    for (const r of saved) await db.insert(s.integrationState).values({ key: r.key, value: r.value });
    await db.$client.end();
    await closeDb();
  });

  test("S2 öncesi site (alan yok): takip yok, sürüm yalnız liste değişince artar", async () => {
    assert.equal((await sync.syncSiteOrders("screen")).status, "ok");
    const st = await state();
    assert.deepEqual([st.awaitingPayment, st.awaitingSince, st.missedPingAt], [0, null, null]);
    assert.equal(await version(), "1", "ilk liste");
    await ping();
    assert.equal(await version(), "1", "değişmeyen liste ve ping sürümü artırmaz");
    assert.equal((await state()).lastTrigger, "ping");
  });

  test("ödeme bekleniyor: 0 → > 0 sürümü artırır; ekranın çekmesi takibi uzatmaz; pingte ve sayı artınca yeniden başlar; 0 olunca biter", async () => {
    await sync.syncSiteOrders("screen");
    assert.equal(await version(), "1");

    // Kartlı sipariş açıldı: site önce "ödeme bekleniyor" pingi atar; liste değişmedi ama takip başlar
    site.awaiting = 1;
    await ping();
    let st = await state();
    assert.equal(st.awaitingPayment, 1);
    assert.ok(st.awaitingSince && Date.now() - Date.parse(st.awaitingSince) < 5_000);
    assert.equal(await version(), "2", "takip başladı: açık sekme yeni awaitingUntil'i almalı");
    const since = st.awaitingSince;

    // Ekranın kendi çekmesi: sayı aynı, takip uzamaz, sürüm artmaz
    await sync.syncSiteOrders("screen");
    st = await state();
    assert.equal(st.awaitingSince, since);
    assert.equal(await version(), "2");

    // Sayı sıfırdan büyükken gelen ping (yeniden açılan ödeme sayfası sayıyı artırmaz): takip yeniden başlar
    await patch({ awaitingSince: ago(20 * 60_000) });
    await ping();
    st = await state();
    assert.ok(Date.now() - Date.parse(st.awaitingSince!) < 5_000, "ping takibi yeniden başlatır");
    assert.equal(await version(), "3");

    // Ping gelmeden sayı arttı (yeni bir ödeme sayfası): takip yeniden başlar
    await patch({ awaitingSince: ago(20 * 60_000) });
    site.awaiting = 2;
    await sync.syncSiteOrders("screen");
    st = await state();
    assert.equal(st.awaitingPayment, 2);
    assert.ok(Date.now() - Date.parse(st.awaitingSince!) < 5_000);
    assert.equal(await version(), "4");

    // Sayı düştü ama sıfır değil (biri ödendi, pingiyle): takip sürer, yeniden başlamaz (çekme ekranın)
    const kept = st.awaitingSince;
    site.awaiting = 1;
    await sync.syncSiteOrders("screen");
    assert.equal((await state()).awaitingSince, kept);

    // Bekleyen kalmadı: takip biter, sürüm artar (ekran sakin kurala döner)
    site.awaiting = 0;
    await sync.syncSiteOrders("screen");
    st = await state();
    assert.deepEqual([st.awaitingPayment, st.awaitingSince], [0, null]);
    assert.equal(await version(), "5");
  });

  test("canlı ucun awaitingUntil'i: takip başlangıcı + 30 dakika; bozuk sayı 0 sayılır, liste yine okunur", async () => {
    const { awaitingUntil } = await import("../src/lib/site-orders/follow");
    site.awaiting = 3;
    await ping();
    const st = await state();
    assert.equal(awaitingUntil(st), new Date(Date.parse(st.awaitingSince!) + AWAITING_FOLLOW_MS).toISOString());
    // Bozuk alan bütün yanıtı reddetmez: takip biter, liste gelir
    site.awaiting = -4 as number;
    site.orders = [paid("ord-0001", 5_000)];
    assert.equal((await sync.syncSiteOrders("screen")).status, "ok");
    const after_ = await state();
    assert.deepEqual([after_.awaitingPayment, after_.awaitingSince, awaitingUntil(after_)], [0, null, null]);
    assert.equal((await sync.readOrdersSnapshot(db)).orders.length, 1);
  });

  test("vazgeçilen kartlı ödeme: takip bitince ekran sakinleşir, ödeme sayfasının pingi iki saat yoğunluk sayılmaz", async () => {
    await sync.syncSiteOrders("screen");
    await patch({ lastChangeAt: ago(3 * 3_600_000) });
    // Canlı ucun ekrana verdiği alanlarla (src/app/api/canli/route.ts) bar ekranının kararı
    const busyAt = async (nowMs: number) => {
      const st = await state();
      return boardBusy({ open: (await sync.readOrdersSnapshot(db)).orders.length, changeAt: st.lastChangeAt, awaitingUntil: followUntil(st) }, nowMs);
    };
    site.awaiting = 1;
    await ping();
    const pingAt = (await state()).lastPingAt!;
    assert.equal(await busyAt(Date.now()), true, "ödeme bekleniyor");
    assert.equal(await version(), "2", "takip başladı: pingAt de ekrana ulaşır");
    // Müşteri vazgeçti: site sayıdan düşürdü, ekranın çekmesi takibi bitirir
    site.awaiting = 0;
    await sync.syncSiteOrders("screen");
    assert.equal(await version(), "3");
    for (const min of [1, 31, 60, 119]) {
      assert.equal(await busyAt(Date.parse(pingAt) + min * 60_000), false, `takip bitti, ping tek başına yoğunluk değil (+${min} dk)`);
    }
  });

  test("site hata verirse takip olduğu gibi kalır; ekranın denemesi kontrol anını yazar", async () => {
    site.awaiting = 1;
    await ping();
    const before_ = await state();
    site.fail = true;
    assert.equal((await sync.syncSiteOrders("screen")).status, "error");
    const st = await state();
    assert.deepEqual([st.awaitingPayment, st.awaitingSince], [1, before_.awaitingSince]);
    assert.ok(st.lastError);
    assert.ok(st.lastCheckAt && st.lastCheckAt === st.lastPullAt, "ekranın denemesi");
  });

  test("sakin saatin kontrolü pingle yapılan çekmeyi saymaz; sık kontroller sayar", async () => {
    // Hiç kontrol yokken ping çekti
    await ping();
    assert.equal((await state()).lastCheckAt, null, "pingin çekmesi kontrol sayılmaz");
    assert.equal(gets, 1);
    // Ekranın saatlik kontrolü (59,5 dk): pingin çekmesi az önce olsa da siteyi sorar
    assert.equal((await sync.ensureOrdersFresh(59.5 * 60_000)).status, "ok");
    assert.equal(gets, 2);
    // Yoğun saatin 2,5 dakikalık kontrolü az önceki çekmeyi sayar
    assert.equal((await sync.ensureOrdersFresh(2.5 * 60_000)).status, "fresh");
    assert.equal(gets, 2);
    // Saatlik kontrol de az önceki ekran çekmesini sayar
    assert.equal((await sync.ensureOrdersFresh(59.5 * 60_000)).status, "fresh");
    // Ping yeni geldi, ama son ekran kontrolü bir saatten eski: saatlik kontrol yine sorar
    await patch({ lastCheckAt: ago(61 * 60_000) });
    await ping();
    assert.equal(gets, 3);
    assert.equal((await sync.ensureOrdersFresh(59.5 * 60_000)).status, "ok");
    assert.equal(gets, 4);
  });

  test("ping kaçtı: pingle olmayan çekme pingi gelmemiş ödenmiş siparişi getirirse yazılır; öteki durumlarda yazılmaz", async () => {
    // Bekleyen sipariş açıldı (pingle); ping kaydı on dakika önceymiş gibi
    site.awaiting = 1;
    await ping();
    await patch({ lastPingAt: ago(10 * 60_000) });
    assert.equal((await state()).missedPingAt, null);

    // Az önce ödenen sipariş (pingi yolda olabilir): yazılmaz
    site.awaiting = 0;
    site.orders = [paid("ord-0001", 10_000)];
    await sync.syncSiteOrders("screen");
    assert.equal((await state()).missedPingAt, null, "bir dakikadan yeni ödeme");

    // İki dakika önce ödenmiş, ödemeden sonra ping hiç gelmemiş, ekranın çekmesi getirdi: ping kaçtı
    site.orders = [paid("ord-0001", 10_000), paid("ord-0002", 2 * 60_000)];
    await sync.syncSiteOrders("screen");
    const missed = (await state()).missedPingAt;
    assert.ok(missed && Date.now() - Date.parse(missed) < 5_000, "ping kaçtı");
    assert.equal(pushes.length, 2, "yeni siparişin zili yine çalar");

    // Ödemeden sonra ping geldi ama çekmesi düştü; sonraki ekran çekmesi getirdi: kaçan ping değil (çekme hatası)
    await patch({ missedPingAt: null });
    site.fail = true;
    await ping();
    site.fail = false;
    site.orders.push(paid("ord-0003", 2 * 60_000));
    await patch({ lastPingAt: new Date().toISOString() });
    await sync.syncSiteOrders("screen");
    assert.equal((await state()).missedPingAt, null, "ping geldi");

    // Pingin kendi çekmesi kaçan ping yazmaz
    await patch({ lastPingAt: ago(10 * 60_000) });
    site.orders.push(paid("ord-0004", 2 * 60_000));
    await sync.syncSiteOrders("ping");
    assert.equal((await state()).missedPingAt, null, "ping çekmesi");

    // İlk çekme (önceki liste yok) hiçbir siparişi yeni saymaz
    await db.delete(s.integrationState).where(eq(s.integrationState.key, "site_orders"));
    await patch({ lastPingAt: ago(10 * 60_000) });
    await sync.syncSiteOrders("screen");
    assert.equal((await state()).missedPingAt, null, "ilk liste");
  });
});
