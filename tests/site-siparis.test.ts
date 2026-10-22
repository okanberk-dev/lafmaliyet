// laffogato.net bar ekranı (docs/SITE-SIPARIS.md): sitenin açık sipariş listesinin doğrulanması, ilk kez görülen yeni
// sipariş, listenin değişmesi, kartın metinleri ve sırası, "Sitede aç" adresi, zil kuralı, sipariş pinginin denetimi ve
// sunucu kodunun kuralları (kaynaktan).
// Çalıştırma: npx tsx --test tests/site-siparis.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { signedHeaders } from "../src/lib/karaoke/signature";
import {
  dueAt,
  lineLabel,
  lineText,
  minutesSince,
  newOrderIds,
  ordersFingerprint,
  ordersToRing,
  ringMessage,
  scheduleLabel,
  siteOrderUrl,
  sortForScreen,
  STAGE_LABEL,
  waitLabel,
} from "../src/lib/site-orders/feed";
import { parseSiteOrders, safeOrderPath, SiteOrdersFormatError, type SiteOrder } from "../src/lib/site-orders/schema";
import { checkSitePing } from "../src/lib/site-ping";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const T = 1760000000;
const at = (iso: string) => Date.parse(iso);

/** Sözleşmedeki örnek sipariş (sitenin docs/PANEL-ORDERS.md'si) */
const contractOrder = (over: Record<string, unknown> = {}) => ({
  id: "ord-0042",
  orderNo: 10042,
  stage: "new",
  fulfillment: "table",
  label: "Masa 4",
  firstName: "Ayşe",
  scheduledFor: "",
  paidAt: "2026-10-22T11:55:00.000Z",
  lines: [{ menuItemId: "mnu-0003", name: "Latte", size: "M", detail: "M · yulaf · +1 shot", qty: 2 }],
  totalMinor: 24000,
  path: "/admin/siparisler/ord-0042",
  ...over,
});
const list = (orders: unknown[], over: Record<string, unknown> = {}) => ({ version: 1, now: "2026-10-22T12:00:00.000Z", complete: true, orders, ...over });

const order = (over: Partial<SiteOrder> = {}): SiteOrder => ({
  id: "ord-0001",
  orderNo: 10001,
  stage: "new",
  fulfillment: "pickup",
  label: "Gel-al",
  firstName: "Can",
  scheduledFor: "",
  paidAt: "2026-10-22T11:00:00.000Z",
  lines: [{ menuItemId: "mnu-0003", name: "Latte", size: "M", detail: "M", qty: 1 }],
  path: "/admin/siparisler/ord-0001",
  ...over,
});

// ---------------------------------------------------------------- Sitenin yanıtı

test("liste: sözleşmedeki örnek okunur; tutar saklanmaz, bilinmeyen alan atılır", () => {
  const r = parseSiteOrders(list([contractOrder({ newField: "x" })], { extra: true }));
  assert.equal(r.now, "2026-10-22T12:00:00.000Z");
  assert.equal(r.complete, true);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.orders, [
    {
      id: "ord-0042",
      orderNo: 10042,
      stage: "new",
      fulfillment: "table",
      label: "Masa 4",
      firstName: "Ayşe",
      scheduledFor: "",
      paidAt: "2026-10-22T11:55:00.000Z",
      lines: [{ menuItemId: "mnu-0003", name: "Latte", size: "M", detail: "M · yulaf · +1 shot", qty: 2 }],
      path: "/admin/siparisler/ord-0042",
    },
  ]);
  // KVKK: panel yalnız adı tutar; tutar ve bilinmeyen alanlar saklanmaz
  assert.ok(!("totalMinor" in r.orders[0]));
  assert.ok(!("newField" in r.orders[0]));
  assert.equal(parseSiteOrders(list([], { complete: false })).complete, false);
});

test("liste: tanınmayan sürüm ya da bozuk iskelet bütün yanıtı reddeder", () => {
  assert.throws(() => parseSiteOrders({ ...list([]), version: 2 }), SiteOrdersFormatError);
  assert.throws(() => parseSiteOrders({ now: "2026-10-22T12:00:00.000Z", complete: true, orders: [] }), /sürüm yok/);
  assert.throws(() => parseSiteOrders({ ...list([]), version: 2 }), /tanınmayan sürümde \(2\); panel güncel değil/);
  assert.throws(() => parseSiteOrders(list([], { now: "dün" })), /okunamadı \(now\)/);
  assert.throws(() => parseSiteOrders(list([], { complete: "evet" })), /okunamadı \(complete\)/);
  assert.throws(() => parseSiteOrders({ version: 1, now: "2026-10-22T12:00:00.000Z", complete: true }), /okunamadı \(orders\)/);
  assert.throws(() => parseSiteOrders(null), SiteOrdersFormatError);
});

test("liste: kullanılan alanı bozuk sipariş atlanır ve sayılır; iki kez geçen kimlik bir kez", () => {
  const r = parseSiteOrders(
    list([
      contractOrder(),
      contractOrder({ id: "ord-0043", stage: "scheduled" }),
      contractOrder({ id: "ord-0044", paidAt: "" }),
      contractOrder({ id: "ord-0045", lines: [] }),
      contractOrder({ id: "ord-0046", fulfillment: "drone" }),
      contractOrder({ id: "ord 47" }),
      contractOrder({ id: "ord-0048", lines: [{ menuItemId: "mnu-0003", name: "Latte", size: "M", detail: "", qty: 0 }] }),
      contractOrder(),
    ]),
  );
  assert.deepEqual(
    r.orders.map((o) => o.id),
    ["ord-0042"],
  );
  assert.equal(r.skipped, 7);
});

test("liste: metinler kısaltılır, eksik ad ve etiket varsayılana düşer, bozuk planlı saat boş sayılır", () => {
  const long = "Ç".repeat(200);
  const [o] = parseSiteOrders(
    list([
      contractOrder({
        label: "",
        fulfillment: "delivery",
        firstName: long,
        scheduledFor: "yarın",
        lines: [{ menuItemId: "../x", name: "  ", size: "XL", detail: `${long}`, qty: 3 }],
      }),
    ]),
  ).orders;
  assert.equal(o.label, "Kurye");
  assert.equal(Array.from(o.firstName).length, 40);
  assert.equal(o.scheduledFor, "");
  assert.deepEqual(o.lines[0], { menuItemId: "", name: "Ürün", size: "single", detail: "Ç".repeat(160), qty: 3 });
});

test("bağlantı yolu: yalnız sitenin /admin altı; başka siteye çıkan yol boş", () => {
  assert.equal(safeOrderPath("/admin/siparisler/ord-0042"), "/admin/siparisler/ord-0042");
  for (const bad of ["//evil.example/admin/x", "https://evil.example/admin/x", "/admin/../../x", "/admin//x", "/admin/x y", "/hesap", "/admin/\\x", 42, null]) {
    assert.equal(safeOrderPath(bad), "", String(bad));
  }
  const [o] = parseSiteOrders(list([contractOrder({ path: "//evil.example/x" })])).orders;
  assert.equal(o.path, "", "bozuk yol siparişi düşürmez, bağlantısız gösterir");
  assert.equal(siteOrderUrl("https://laffogato.net", "/admin/siparisler/ord-0042"), "https://laffogato.net/admin/siparisler/ord-0042");
  assert.equal(siteOrderUrl("https://laffogato.net/", "/admin/siparisler/ord-0042"), "https://laffogato.net/admin/siparisler/ord-0042");
  assert.equal(siteOrderUrl("https://laffogato.net", ""), null);
  assert.equal(siteOrderUrl("https://laffogato.net", "//evil.example/admin"), null);
  assert.equal(siteOrderUrl("bozuk", "/admin/siparisler/x"), null);
});

// ---------------------------------------------------------------- Yeni sipariş, değişiklik

test("yeni sipariş: önceki listede olmayan ve `new` aşamasında olan; ilk çekmede hiçbiri", () => {
  const prev = [order({ id: "a" }), order({ id: "b", stage: "preparing" })];
  const next = [order({ id: "a", stage: "preparing" }), order({ id: "b", stage: "ready" }), order({ id: "c" }), order({ id: "d", stage: "preparing" })];
  assert.deepEqual(newOrderIds(prev, next), ["c"], "hazırlanmaya başlanmış yeni kimlik zil çalmaz");
  assert.deepEqual(newOrderIds(null, next), [], "ilk çekme: o an açık olanlar için bildirim gitmez");
  assert.deepEqual(newOrderIds([], [order({ id: "x" })]), ["x"], "boş listeden sonra gelen sipariş yenidir");
});

test("liste değişti mi: aşama, satır, ad, yol değişince evet; aynı liste hayır", () => {
  const a = [order(), order({ id: "ord-0002", orderNo: 10002 })];
  assert.equal(ordersFingerprint(a), ordersFingerprint(a.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) }))));
  assert.notEqual(ordersFingerprint(a), ordersFingerprint([{ ...a[0], stage: "preparing" }, a[1]]));
  assert.notEqual(ordersFingerprint(a), ordersFingerprint([{ ...a[0], lines: [{ ...a[0].lines[0], qty: 2 }] }, a[1]]));
  assert.notEqual(ordersFingerprint(a), ordersFingerprint([a[0]]), "sipariş listeden çıkınca");
});

// ---------------------------------------------------------------- Kart

test("kart metinleri: satır, planlı saat (İstanbul), geçen süre", () => {
  assert.equal(lineText({ qty: 2, name: "Latte", detail: "M · yulaf · +1 shot" }), "2× Latte · M · yulaf · +1 shot");
  assert.equal(lineText({ qty: 1, name: "Su", detail: "" }), "1× Su");
  assert.equal(lineLabel({ name: "Su", detail: "" }), "Su");
  const now = at("2026-10-22T09:00:00.000Z"); // 12:00 İstanbul
  assert.equal(scheduleLabel("2026-10-22T11:30:00.000Z", now), "14:30 için");
  assert.equal(scheduleLabel("2026-10-23T06:00:00.000Z", now), "Yarın 09:00 için");
  assert.equal(scheduleLabel("2026-10-22T21:30:00.000Z", now), "Yarın 00:30 için", "İstanbul'da gece yarısını geçen saat ertesi gündür");
  assert.equal(scheduleLabel("", now), null);
  assert.equal(minutesSince("2026-10-22T08:53:10.000Z", now), 6);
  assert.equal(minutesSince("2026-10-22T09:02:00.000Z", now), 0, "saat farkıyla eksiye düşmez");
  assert.equal(waitLabel(0), "az önce");
  assert.equal(waitLabel(7), "7 dk");
  assert.equal(waitLabel(65), "1 sa 5 dk");
  assert.equal(waitLabel(120), "2 sa");
  assert.deepEqual(STAGE_LABEL, { new: "Yeni", preparing: "Hazırlanıyor", ready: "Teslime hazır" });
});

test("sıra: hazırlanacaklar önce, masa en önde, sonra vakti yakın olan; teslime hazır gel-al'lar en sonda", () => {
  const list = [
    order({ id: "ready", stage: "ready", paidAt: "2026-10-22T10:00:00.000Z" }),
    order({ id: "later", scheduledFor: "2026-10-22T13:00:00.000Z", paidAt: "2026-10-22T09:00:00.000Z" }),
    order({ id: "pickup", paidAt: "2026-10-22T11:00:00.000Z" }),
    order({ id: "table", fulfillment: "table", label: "Masa 2", paidAt: "2026-10-22T11:20:00.000Z" }),
    order({ id: "prep", stage: "preparing", paidAt: "2026-10-22T10:50:00.000Z", orderNo: 9 }),
  ];
  assert.deepEqual(
    sortForScreen(list).map((o) => o.id),
    ["table", "prep", "pickup", "later", "ready"],
  );
  assert.equal(dueAt(order({ scheduledFor: "2026-10-22T13:00:00.000Z" })), at("2026-10-22T13:00:00.000Z"), "planlı sipariş saatine göre");
});

test("zil: bu ekranın görmediği yeni sipariş bir kez, masa önce; ilk yüklemede yalnız son iki dakika", () => {
  const now = at("2026-10-22T12:00:00.000Z");
  const orders = [
    order({ id: "old", paidAt: "2026-10-22T11:30:00.000Z" }),
    order({ id: "fresh", paidAt: "2026-10-22T11:59:30.000Z" }),
    order({ id: "table", fulfillment: "table", label: "Masa 4", paidAt: "2026-10-22T11:59:00.000Z" }),
    order({ id: "prep", stage: "preparing", paidAt: "2026-10-22T11:59:50.000Z" }),
  ];
  const first = ordersToRing(orders, new Set(), { first: true, nowMs: now });
  assert.deepEqual(
    first.ring.map((o) => o.id),
    ["table", "fresh"],
    "ilk yüklemede eski bekleyen yeni sessizce görülmüş sayılır",
  );
  assert.deepEqual(first.markSeen.sort(), ["fresh", "old", "table"]);
  // Sekme açıkken gelen her yeni sipariş, ne kadar eski ödenmiş olursa olsun, bir kez çalar
  const later = ordersToRing([...orders, order({ id: "late", paidAt: "2026-10-22T11:00:00.000Z" })], new Set(first.markSeen), { first: false, nowMs: now });
  assert.deepEqual(
    later.ring.map((o) => o.id),
    ["late"],
  );
  assert.deepEqual(ordersToRing(orders, new Set(["old", "fresh", "table"]), { first: false, nowMs: now }).ring, [], "görülen bir daha çalmaz");
});

test("zil metni: nereye ve ne; müşterinin adı bildirime yazılmaz (kilit ekranı)", () => {
  const one = ringMessage([order({ label: "Masa 4", firstName: "Ayşe", lines: [{ menuItemId: "", name: "Latte", size: "M", detail: "M · yulaf", qty: 2 }] })]);
  assert.deepEqual(one, { title: "Yeni sipariş · Masa 4", body: "2× Latte" });
  assert.doesNotMatch(JSON.stringify(one), /Ayşe/);
  const many = ringMessage([order({ label: "Masa 4" }), order({ label: "Gel-al" })]);
  assert.deepEqual(many, { title: "2 yeni sipariş", body: "Masa 4 · Gel-al" });
  const lines = Array.from({ length: 5 }, (_, i) => ({ menuItemId: "", name: `Ürün ${i}`, size: "single" as const, detail: "", qty: 1 }));
  assert.equal(ringMessage([order({ lines })]).body, "1× Ürün 0, 1× Ürün 1, 1× Ürün 2 +2");
});

// ---------------------------------------------------------------- Ping

test("sipariş pingi: anahtar yoksa 503, 4 KB üstü 413, imzasız / yanlış / eski 401; menü pingi bu uçta geçmez", () => {
  const url = new URL("https://ladmin.laffogato.net/api/orders/ping");
  const body = JSON.stringify({ event: "orders.changed", at: "2026-10-22T12:00:00.000Z" });
  const now = T * 1000;
  const h = signedHeaders(SECRET, "POST", url, body, now);
  const check = (over: Partial<Parameters<typeof checkSitePing>[0]> = {}) =>
    checkSitePing({ secret: SECRET, url, body, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now, ...over });
  assert.deepEqual(check(), { ok: true });
  assert.deepEqual(check({ secret: null }), { ok: false, status: 503, error: "not_configured" });
  assert.deepEqual(check({ body: "x".repeat(4097) }), { ok: false, status: 413, error: "too_large" });
  assert.deepEqual(check({ signature: null }), { ok: false, status: 401, error: "unauthorized" });
  assert.deepEqual(check({ secret: `${SECRET}x` }), { ok: false, status: 401, error: "unauthorized" });
  assert.deepEqual(check({ now: now + 301_000 }), { ok: false, status: 401, error: "unauthorized" }, "5 dakikadan eski");
  const menu = signedHeaders(SECRET, "POST", new URL("https://ladmin.laffogato.net/api/menu/ping"), body, now);
  assert.equal(check({ timestamp: menu["x-laf-timestamp"], signature: menu["x-laf-signature"] }).ok, false, "imza yolu kapsar");
  // Menü pinginin denetimi aynı kuraldır (src/lib/site-menu/ping.ts ortak işlevi dışa verir)
  assert.match(read("src/lib/site-menu/ping.ts"), /checkSitePing as checkMenuPing/);
});

test("ping ucu: önce anahtar, sonra boyut ve imza; 202 sonra çekme (bir kez yeniden dener); proxy engellemez", () => {
  const route = read("src/app/api/orders/ping/route.ts");
  assert.match(route, /if \(!secret\) return Response\.json\(\{ error: "not_configured" \}, \{ status: 503 \}\)/);
  assert.match(route, /if \(!check\.ok\) return Response\.json\(\{ error: check\.error \}, \{ status: check\.status \}\)/);
  assert.ok(route.indexOf("checkSitePing(") < route.indexOf("after("), "202'den önce imza");
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /syncSiteOrders\("ping"\)/);
  assert.match(route, /status: 202/);
  assert.doesNotMatch(read("src/proxy.ts"), /\/api\/orders/);
});

// ---------------------------------------------------------------- Sunucu

test("çekme: tek işlemde ve danışma kilidiyle; eski yanıt yazılmaz; liste ya da hata değişince sürüm artar", () => {
  const sync = read("src/server/site-orders/sync.ts");
  assert.match(sync, /pg_advisory_xact_lock\(hashtext\('site-orders'\)\)/);
  assert.match(sync, /if \(last > Date\.parse\(list\.now\) && last < Date\.now\(\) \+ 10 \* 60_000\)/);
  assert.match(sync, /const SNAPSHOT_KEY = "site_orders"/);
  assert.match(sync, /const VERSION_KEY = "site_orders_version"/);
  assert.match(sync, /if \(changed \|\| state\.lastError\) await bumpOrdersVersion\(tx\)/);
  assert.match(sync, /newOrderIds\(prev\.at \? prev\.orders : null, orders\)/, "ilk çekmede bildirim yok");
  assert.match(sync, /signedSiteFetch\(secret, new URL\("\/api\/panel\/orders", siteUrl\(\)\)\)/);
  // KVKK: ad işlem geçmişine ve günlüğe yazılmaz
  assert.doesNotMatch(sync, /logActivity/);
  assert.doesNotMatch(sync, /console\.\w+\([^)]*firstName/);
  // Canlı uç: sipariş sürümü ETag'te, 304 kararı veri okunmadan önce
  const live = read("src/app/api/canli/route.ts");
  assert.match(live, /ordersVersion\(\)/);
  assert.match(live, /const etag = `W\/"\$\{version\}\.o\$\{orders\}\./);
  assert.ok(live.indexOf("status: 304") < live.indexOf("readOrdersSnapshot()"));
});

test("ekranın isteği: oturum gerekir, güncel listede siteye gidilmez; tetikleyiciler ve sürekli sorgu yok", () => {
  const route = read("src/app/api/siparisler/route.ts");
  assert.match(route, /if \(!me\) return Response\.json\(\{ error: "Giriş gerekli" \}, \{ status: 401/);
  assert.match(route, /ensureOrdersFresh\(/);
  const sync = read("src/server/site-orders/sync.ts");
  assert.match(sync, /if \(Number\.isFinite\(last\) && Date\.now\(\) - last < stale\) return \{ status: "fresh" \}/);
  assert.match(sync, /const stale = state\.lastError \? \(opts\.manual \? 0 : Math\.min\(maxAgeMs, ERROR_RETRY_MS\)\) : maxAgeMs/, "hatadan sonra çabuk yeniden dener; Yenile hemen");
  assert.match(route, /ensureOrdersFresh\(Math\.max\(maxAgeMs, MANUAL_MIN_MS\), \{ manual: maxAgeMs === 0 \}\)/, "Yenile art arda basılsa da siteyi 10 sn'de bir sorar");
  const board = read("src/app/panel/karaoke/orders-board.tsx");
  assert.match(board, /const OPEN_STALE_MS = 60_000/);
  assert.match(board, /const BUSY_REPULL_MS = 3 \* 60_000/);
  assert.match(board, /const QUIET_REPULL_MS = 60 \* 60_000/);
  assert.match(board, /document\.visibilityState === "visible"/);
  // Panel siparişi ilerletmez: yalnız sitenin paneline bağlantı
  assert.match(board, /Sitede aç/);
  assert.doesNotMatch(board, /method: "POST", body: JSON\.stringify\(\{ stage/);
  // Günlük işte sipariş adımı yok (Vercel cron kotası dolu; ping + ekran yeter)
  assert.doesNotMatch(read("src/app/api/cron/gunluk/route.ts"), /syncSiteOrders/);
  assert.deepEqual(JSON.parse(read("vercel.json")).crons.length, 2);
});

test("bildirim: sipariş konusu, tercihi seçilmemiş cihazda personele açık, yöneticiye kapalı; ad yok", () => {
  const send = read("src/server/push/send.ts");
  assert.match(send, /if \(topic === "orders"\) conditions\.push\(sql`coalesce\(\$\{s\.pushSubscriptions\.orders\}, \$\{s\.users\.role\} = 'staff'\)`\)/);
  const migration = read("drizzle/0019_siparis_bildirimi.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "orders" boolean;/, "önizleme dağıtımları canlının veritabanında da çalışır: idempotent");
  assert.doesNotMatch(migration, /NOT NULL|DEFAULT/);
  const sync = read("src/server/site-orders/sync.ts");
  assert.match(sync, /sendPush\("orders"/);
  assert.match(sync, /ringMessage\(sortForScreen\(orders\)\)/);
});
