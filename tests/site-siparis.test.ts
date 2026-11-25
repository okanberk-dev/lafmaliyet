// laffogato.net bar ekranı (docs/SITE-SIPARIS.md): sitenin açık sipariş listesinin doğrulanması, ilk kez görülen yeni
// sipariş, listenin değişmesi, kartın metinleri ve sırası, "Sitede aç" adresi, zil kuralı, sipariş pinginin denetimi,
// bar ekranının aşama düğmeleri (izinli çiftler, adlar, isteğin gövdesi, sitenin yanıtı ve hata metinleri), ödeme
// takibi ve kaçan ping (senkron planı P2; veritabanıyla tests/siparis-takip-db.test.ts), imza vektörleri ve sunucu
// kodunun kuralları (kaynaktan).
// Çalıştırma: npx tsx --test tests/site-siparis.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sign, signedHeaders } from "../src/lib/karaoke/signature";
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
import {
  AWAITING_FOLLOW_MS,
  AWAITING_MAX,
  awaitingUntil,
  boardBusy,
  MISSED_PING_GRACE_MS,
  MISSED_PING_SHOW_MS,
  missedPing,
  missedPingShown,
  nextAwaiting,
  pullDue,
  QUIET_CHECK_MIN_MS,
} from "../src/lib/site-orders/follow";
import { parseSiteOrder, parseSiteOrders, safeOrderPath, SiteOrdersFormatError, type OrderFulfillment, type OrderStage, type SiteOrder } from "../src/lib/site-orders/schema";
import {
  canAdvance,
  orderRef,
  READY_LABEL,
  STAGE_ACTIONS,
  STAGE_FROM,
  STAGE_OFF_ERROR,
  STAGE_PATH,
  stageButtons,
  stageDoneMessage,
  stageFailureMessage,
  staleMessage,
  type StageAction,
} from "../src/lib/site-orders/stage";
import { buildStageBody, readStageAnswer, STAGE_BODY_MAX_BYTES } from "../src/lib/site-orders/stage-request";
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

test("müşterinin notu: masa ve gel-al siparişinin notu ve her siparişte içeceğin notu kartta; kurye siparişinin notu asla; zile girmez, değişince liste değişir", () => {
  const withNotes = (over: Record<string, unknown> = {}) =>
    contractOrder({
      note: "  Fındık alerjim var,   şurupsuz lütfen ",
      lines: [{ menuItemId: "mnu-0003", name: "Latte", size: "M", detail: "M · yulaf", qty: 1, note: "çok sıcak olmasın" }],
      ...over,
    });
  const [table] = parseSiteOrders(list([withNotes()])).orders;
  assert.equal(table.note, "Fındık alerjim var, şurupsuz lütfen", "boşluklar sadeleşir");
  assert.equal(table.lines[0].note, "çok sıcak olmasın");
  const [pickup] = parseSiteOrders(list([withNotes({ fulfillment: "pickup", label: "Gel-al" })])).orders;
  assert.equal(pickup.note, "Fındık alerjim var, şurupsuz lütfen");
  // Kurye: site göndermez; gönderse de panel atar (kapı kodu, adres tarifi)
  const [delivery] = parseSiteOrders(list([withNotes({ fulfillment: "delivery", label: "Kurye", note: "Kapı kodu 1234" })])).orders;
  assert.ok(!("note" in delivery));
  // İçeceğin notu kurye siparişinde de gelir (adres değil; site her siparişte gönderir, laffogato #248)
  assert.equal(delivery.lines[0].note, "çok sıcak olmasın");
  // Not yoksa ya da bozuksa alan yok, sipariş atlanmaz; uzun not kısaltılır
  const [plain] = parseSiteOrders(list([contractOrder()])).orders;
  assert.ok(!("note" in plain) && !("note" in plain.lines[0]));
  const r = parseSiteOrders(list([withNotes({ note: 42, lines: [{ menuItemId: "", name: "Su", size: "single", detail: "", qty: 1, note: { x: 1 } }] })]));
  assert.equal(r.skipped, 0);
  assert.ok(!("note" in r.orders[0]) && !("note" in r.orders[0].lines[0]));
  assert.equal(Array.from(parseSiteOrder(withNotes({ note: "Ç".repeat(400) }))!.note!).length, 300);
  assert.equal(Array.from(parseSiteOrder(withNotes({ lines: [{ menuItemId: "", name: "Su", size: "single", detail: "", qty: 1, note: "Ç".repeat(400) }] }))!.lines[0].note!).length, 200);
  // Zil ve bildirim metnine not girmez
  assert.doesNotMatch(JSON.stringify(ringMessage([table])), /alerji|sıcak/);
  // Not değişince ekran yenilenir
  assert.notEqual(ordersFingerprint([table]), ordersFingerprint([{ ...table, note: "başka" }]));
  assert.notEqual(ordersFingerprint([table]), ordersFingerprint([{ ...table, lines: [{ ...table.lines[0], note: undefined }] }]));
  assert.equal(ordersFingerprint([plain]), ordersFingerprint([{ ...plain, note: undefined }]), "notsuz eski kayıt aynı");
  // Kart notları gösterir
  const board = read("src/app/panel/siparisler/orders-board.tsx");
  assert.match(board, /\{o\.note \? \(/);
  assert.match(board, /\{l\.note \? <span[^>]*>Not: \{l\.note\}<\/span> : null\}/);
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
  assert.match(sync, /if \(changed \|\| state\.lastError \|\| followChanged\) await bumpOrdersVersion\(tx\)/);
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
  // Kural saf yardımcıda (pullDue; aşağıda "ekranın isteği: sakin saatin kontrolü")
  assert.match(sync, /if \(!pullDue\(state, maxAgeMs, \{ manual: opts\.manual, nowMs: Date\.now\(\) \}\)\) return \{ status: "fresh" \}/);
  assert.match(route, /ensureOrdersFresh\(Math\.max\(maxAgeMs, MANUAL_MIN_MS\), \{ manual: maxAgeMs === 0 \}\)/, "Yenile art arda basılsa da siteyi 10 sn'de bir sorar");
  const board = read("src/app/panel/siparisler/orders-board.tsx");
  assert.match(board, /const OPEN_STALE_MS = 60_000/);
  assert.match(board, /const BUSY_REPULL_MS = 3 \* 60_000/);
  assert.match(board, /const QUIET_REPULL_MS = 60 \* 60_000/);
  assert.match(board, /document\.visibilityState === "visible"/);
  // "Sitede aç" kalır (iade ve iptal orada); aşama düğmeleri ayrı testte
  assert.match(board, /Sitede aç/);
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
  assert.match(sync, /sendPush\(\s*"orders"/);
  assert.match(sync, /ringMessage\(sortForScreen\(orders\)\)/);
});

// ---------------------------------------------------------------- Aşama: bar ekranından tek dokunuş

const FULFILLMENTS: OrderFulfillment[] = ["pickup", "table", "delivery"];
const STAGES: OrderStage[] = ["new", "preparing", "ready"];

test("aşama: izin verilen işlem ve başlangıç aşaması sitenin kuralıyla aynı; Teslim edildi yalnız gel-al", () => {
  assert.equal(STAGE_PATH, "/api/panel/orders/stage");
  assert.deepEqual(STAGE_ACTIONS, ["preparing", "ready", "delivered"]);
  assert.deepEqual(STAGE_FROM, { preparing: ["new"], ready: ["new", "preparing"], delivered: ["ready"] });
  const allowed = new Set([
    "preparing|new|pickup",
    "preparing|new|table",
    "preparing|new|delivery",
    "ready|new|pickup",
    "ready|new|table",
    "ready|new|delivery",
    "ready|preparing|pickup",
    "ready|preparing|table",
    "ready|preparing|delivery",
    "delivered|ready|pickup",
  ]);
  for (const action of STAGE_ACTIONS) {
    for (const from of STAGES) {
      for (const f of FULFILLMENTS) {
        const key = `${action}|${from}|${f}`;
        assert.equal(canAdvance(action, from, f), allowed.has(key), key);
      }
    }
  }
  // Teslim biçimi bilinmiyorsa (sipariş son listede yok) yalnız aşama denetlenir; gerisine site karar verir
  assert.equal(canAdvance("delivered", "ready"), true);
  assert.equal(canAdvance("delivered", "new"), false);
  assert.equal(canAdvance("bogus" as StageAction, "new"), false);
});

test("aşama düğmeleri: yeni → Hazırlanıyor + hazır, hazırlanıyor → hazır, tezgâhtaki gel-al → Teslim edildi; ad teslim biçimine göre", () => {
  assert.deepEqual(READY_LABEL, { pickup: "Hazır", table: "Masaya götürüldü", delivery: "Kuryeye verildi" });
  const view = (stage: OrderStage, fulfillment: OrderFulfillment) => stageButtons({ stage, fulfillment }).map((b) => `${b.label}${b.primary ? "*" : ""}`);
  assert.deepEqual(view("new", "pickup"), ["Hazırlanıyor", "Hazır*"]);
  assert.deepEqual(view("new", "table"), ["Hazırlanıyor", "Masaya götürüldü*"]);
  assert.deepEqual(view("new", "delivery"), ["Hazırlanıyor", "Kuryeye verildi*"]);
  assert.deepEqual(view("preparing", "pickup"), ["Hazır*"]);
  assert.deepEqual(view("preparing", "table"), ["Masaya götürüldü*"]);
  assert.deepEqual(view("preparing", "delivery"), ["Kuryeye verildi*"]);
  assert.deepEqual(view("ready", "pickup"), ["Teslim edildi*"]);
  // Masa ve kurye siparişi hazır olunca ekrandan kalkar; yine de gelirse düğmesi yok
  assert.deepEqual(view("ready", "table"), []);
  assert.deepEqual(view("ready", "delivery"), []);
  for (const stage of STAGES) {
    for (const f of FULFILLMENTS) {
      const buttons = stageButtons({ stage, fulfillment: f });
      for (const b of buttons) assert.ok(canAdvance(b.action, stage, f), `${stage} ${f} ${b.action}: düğme yalnız izinli işlemde`);
      if (buttons.length) assert.equal(buttons.filter((b) => b.primary).length, 1, "kartta tek birincil düğme");
    }
  }
});

test("aşama bildirimi: '#10234 hazır', masaya götürüldü, kuryeye verildi, teslim edildi, hazırlanıyor", () => {
  assert.equal(stageDoneMessage(10234, "ready", "pickup"), "#10234 hazır");
  assert.equal(stageDoneMessage(10234, "ready", "table"), "#10234 masaya götürüldü");
  assert.equal(stageDoneMessage(10234, "ready", "delivery"), "#10234 kuryeye verildi");
  assert.equal(stageDoneMessage(10234, "delivered", "pickup"), "#10234 teslim edildi");
  assert.equal(stageDoneMessage(10234, "preparing", "table"), "#10234 hazırlanıyor");
  assert.equal(stageDoneMessage(null, "ready", null), "Sipariş hazır", "numara ve teslim biçimi bilinmiyorsa");
  assert.equal(orderRef(0), "Sipariş");
});

test("aşama isteği: gövde yalnız id, action, from, actor; ad sadeleşir, 80 karakterle kısalır; 1 KB'ı aşmaz", () => {
  const body = buildStageBody({ id: "ord-0042", action: "ready", from: "new", actor: "  Selin \n  Kaya  " });
  assert.equal(JSON.stringify(body), '{"id":"ord-0042","action":"ready","from":"new","actor":"Selin Kaya"}');
  // Çağıran siparişin bütününü verse de müşteriye ve satırlara dair hiçbir şey gitmez
  const leaky = { ...order({ id: "ord-0042", firstName: "Ayşe" }), action: "preparing", from: "new", actor: "Selin", totalMinor: 24000 } as unknown as Parameters<
    typeof buildStageBody
  >[0];
  const sent = JSON.stringify(buildStageBody(leaky));
  assert.deepEqual(Object.keys(JSON.parse(sent)), ["id", "action", "from", "actor"]);
  assert.doesNotMatch(sent, /Ayşe|firstName|lines|Latte|totalMinor|Gel-al/);
  assert.equal(buildStageBody({ id: "a", action: "ready", from: "new", actor: "" }).actor, "Panel");
  assert.equal(buildStageBody({ id: "a", action: "ready", from: "new", actor: null }).actor, "Panel");
  assert.equal(buildStageBody({ id: "a", action: "ready", from: "new", actor: "x".repeat(200) }).actor.length, 80);
  // En kötü durum: 64 karakterlik kimlik, en uzun işlem ve aşama, kaçışlı (6 bayt) ya da çok baytlı 80 karakter
  for (const ch of ["\u0001", "ğ", "😀", '"']) {
    const worst = buildStageBody({ id: `o${"x".repeat(63)}`, action: "delivered", from: "preparing", actor: ch.repeat(80) });
    assert.ok(Buffer.byteLength(JSON.stringify(worst)) <= STAGE_BODY_MAX_BYTES, JSON.stringify(ch));
  }
});

test("aşama yanıtı: 200 yeni hâl ya da ekrandan çıktı, 409 eskimiş, okunamayan 2xx, öteki kodlar hata", () => {
  const moved = readStageAnswer({ status: 200, json: { order: contractOrder({ stage: "preparing" }) } }, "ord-0042");
  assert.equal(moved.kind, "moved");
  assert.equal(moved.kind === "moved" && moved.order?.stage, "preparing");
  assert.ok(moved.kind === "moved" && moved.order && !("totalMinor" in moved.order), "sipariş listedeki biçimde doğrulanır");
  assert.deepEqual(readStageAnswer({ status: 200, json: { order: null } }, "ord-0042"), { kind: "moved", order: null });
  // Sözleşmedeki gibi değil: ilerlemiş olabilir, liste yeniden çekilir
  for (const json of [null, {}, [], { order: { id: "ord-0042", stage: "served" } }, { order: contractOrder({ id: "ord-0099" }) }]) {
    assert.deepEqual(readStageAnswer({ status: 200, json }, "ord-0042"), { kind: "unreadable" }, JSON.stringify(json));
  }
  assert.deepEqual(readStageAnswer({ status: 409, json: { error: "stale", order: contractOrder({ stage: "ready", fulfillment: "pickup" }) } }, "ord-0042"), {
    kind: "stale",
    now: "ready",
  });
  assert.deepEqual(readStageAnswer({ status: 409, json: { error: "stale", order: null } }, "ord-0042"), { kind: "stale", now: "gone" });
  assert.deepEqual(readStageAnswer({ status: 409, json: { error: "stale" } }, "ord-0042"), { kind: "stale", now: null });
  assert.deepEqual(readStageAnswer({ status: 409, json: { error: "stale", order: { id: "x" } } }, "ord-0042"), { kind: "stale", now: null });
  const failed = (status: number, json: unknown) => readStageAnswer({ status, json }, "ord-0042");
  assert.deepEqual(failed(404, { error: "not_found" }), { kind: "failed", failure: { kind: "http", status: 404, error: "not_found", field: null } });
  assert.deepEqual(failed(404, null), { kind: "failed", failure: { kind: "http", status: 404, error: null, field: null } }, "Next'in 404 sayfası (JSON değil)");
  assert.deepEqual(failed(400, { error: "invalid", field: "actor" }), { kind: "failed", failure: { kind: "http", status: 400, error: "invalid", field: "actor" } });
  assert.deepEqual(failed(503, { error: "unavailable" }), { kind: "failed", failure: { kind: "http", status: 503, error: "unavailable", field: null } });
  assert.equal(parseSiteOrder({ ...contractOrder(), stage: "served" }), null);
  assert.deepEqual(parseSiteOrder(contractOrder({ label: "" })), parseSiteOrders(list([contractOrder({ label: "" })])).orders[0], "liste ve tek sipariş aynı kural");
});

test("aşama hata metinleri: bağlantı, imza, bulunamadı / uç yok, eskimiş, site kapalı, ağ", () => {
  assert.equal(STAGE_OFF_ERROR, "laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)");
  assert.equal(stageFailureMessage({ kind: "off" }), STAGE_OFF_ERROR);
  const http = (status: number, error: string | null = null, field: string | null = null) => stageFailureMessage({ kind: "http", status, error, field });
  assert.equal(http(404, "not_found"), "Sipariş sitede bulunamadı ya da artık bar ekranında değil");
  assert.equal(http(404), "Sitede sipariş ilerletme ucu yok (laffogato.net güncel değil)", "uç yoksa gövde JSON değil");
  assert.match(http(401, "unauthorized"), /^İmza reddedildi: iki projedeki KARAOKE_SYNC_SECRET aynı mı/);
  assert.match(http(503, "not_configured"), /Sitede KARAOKE_SYNC_SECRET tanımlı değil/);
  assert.match(http(503, "unavailable"), /veritabanı şu an okunamıyor; tekrar deneyin/);
  assert.match(http(400, "invalid", "actor"), /kabul etmedi \(kullanıcı adı\)/);
  assert.match(http(413, "too_large"), /çok büyük/);
  assert.match(http(500), /HTTP 500/);
  assert.equal(http(409, "stale"), "Sipariş bu arada değişti; ekran yenilendi.");
  assert.match(stageFailureMessage({ kind: "network" }), /^Siteye ulaşılamadı; tekrar deneyin \(sipariş iki kez ilerlemez\)/);
  assert.match(stageFailureMessage({ kind: "timeout" }), /^Site 8 saniyede yanıt vermedi; tekrar deneyin/);
  assert.equal(staleMessage("ready"), "Sipariş bu arada değişti (şimdi: Teslime hazır); ekran yenilendi.");
  assert.equal(staleMessage("gone"), "Sipariş bu arada değişti (artık bar ekranında değil); ekran yenilendi.");
  assert.equal(staleMessage(null), "Sipariş bu arada değişti; ekran yenilendi.");
});

test("aşama eylemi: oturum gerekir (personel de); önce doğrulama, ortak imzalı istek, sonra yalnız çekme yazar; ad yazılmaz", () => {
  const action = read("src/server/actions/site-orders.ts");
  assert.match(action, /^"use server";/);
  // "use server" dosyasının her dışa verilen işlevi herkese açık bir uçtur: yalnız eylemin kendisi
  const exported = [...action.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ["advanceSiteOrder"]);
  const body = action.slice(action.indexOf("export async function advanceSiteOrder"));
  assert.match(body.slice(0, 300), /const me = await requireUser\(\)/, "personel ve yönetici: barista bu ekranı kullanır");
  assert.doesNotMatch(action, /requireAdmin/);
  const order = ["requireUser()", "zStage.parse(input)", "siteLinkSecret()", "callSite("].map((s) => body.indexOf(s));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `sıra: oturum → doğrulama → anahtar → site (${order})`);
  assert.match(action, /\.refine\(\(d\) => canAdvance\(d\.action, d\.from\)/, "olmayan işlem / aşama çifti siteye gitmeden reddedilir");
  assert.match(action, /id: z\.string\(\)\.regex\(SITE_ORDER_ID/);
  // Kurulum ayrıntısı yalnız yöneticiye (E-64): bütün hata metinleri oturumun rolüyle
  assert.match(action, /if \(!secret\) throw new UserError\(stageFailureMessage\(\{ kind: "off" \}, me\.role\)\)/);
  const calls = [...action.matchAll(/stageFailureMessage\(([^;]*)\)\)/g)].map((m) => m[1]);
  assert.equal(calls.length, 3);
  for (const c of calls) assert.match(c, /, me\.role$/, "her çağrı rolü verir");
  // İmza ortak yardımcıdan (menü yazımıyla aynı); HMAC burada yeniden yazılmaz
  assert.match(action, /callSite\(secret, STAGE_PATH, \{ method: "POST", body: JSON\.stringify\(buildStageBody\(\{ \.\.\.data, actor: me\.name \}\)\) \}\)/);
  assert.doesNotMatch(action, /createHmac|signedRequest|signedHeaders/);
  // Son listenin kopyasını yalnız çekme yazar; 200 ve 409'dan sonra liste siteden yeniden çekilir
  assert.match(action, /syncSiteOrders\("manual"\)/);
  const resync = body.indexOf("const synced = await resync();");
  assert.ok(resync > body.indexOf('if (answer.kind === "failed")') && resync < body.indexOf('if (answer.kind === "stale")'), "200'de de 409'da da önce çekme, sonra yanıt");
  assert.doesNotMatch(action, /integration_state|\.insert\(|\.update\(|site_orders"/);
  // KVKK: müşterinin adı ve satırlar ne günlüğe ne işlem geçmişine (kaydı sitenin olay kaydı tutar: panel:<ad>)
  assert.doesNotMatch(action, /firstName|\.lines|logActivity/);
  // Sayfanın sunucu eylemleri siteye iki kez gidebilir (aşama + çekme): süre sınırı
  assert.match(read("src/app/panel/siparisler/page.tsx"), /export const maxDuration = 30;/);
});

test("bar ekranı: tek dokunuş, onaysız; istekte kartın düğmeleri kapalı, çift dokunuş gönderilmez; sonra canlı veri", () => {
  const board = read("src/app/panel/siparisler/orders-board.tsx");
  assert.match(board, /advanceSiteOrder\(\{ id: o\.id, action, from: o\.stage \}\)/);
  assert.match(board, /const buttons = stageButtons\(o\)/);
  // Geçiş, atılan eylemi yakalayan sarmalayıcıdan (src/components/ui/action-error.ts)
  assert.match(board, /useActionTransition\(\)/);
  assert.match(board, /if \(busy\.current\) return;/);
  assert.match(board, /disabled=\{pending\}/);
  assert.doesNotMatch(board, /ConfirmDialog|confirm\(/, "operatör: tek dokunuş, onay sorulmaz");
  assert.match(board, /toast\.success\(res\.data\.message/);
  assert.match(board, /toast\.error\(res\.error\)/);
  assert.match(board, /await refreshAfterAction\(\)/);
  // Ekranın paketine zod girmez: kurallar ve metinler zod'suz modülde
  assert.doesNotMatch(board, /stage-request/);
  assert.doesNotMatch(read("src/lib/site-orders/stage.ts"), /from "zod"|^import (?!type )[^;]*from "\.\/schema"|site-menu/m);
});

test("Ayarlar › laffogato.net: 'Bağlantıları sına' dördünü hemen çeker, eski hata kendiliğinden yeniden denenir, müşteri verisi yok", () => {
  const action = read("src/server/actions/site-links.ts");
  assert.match(action, /^"use server";/);
  // Yalnız yönetici; anahtar yoksa hiçbir şey çekilmez
  assert.match(action, /const me = await requireAdmin\(\);/);
  assert.match(action, /if \(!siteLinkSecret\(\)\) throw new UserError\(/);
  // Dört bağlantı birbirini beklemeden, biri düşse de öbürleri sonuç verir
  assert.match(action, /Promise\.allSettled\(\[/);
  for (const sync of [/syncKaraoke\("manual"\)/, /syncSiteMenu\("manual"\)/, /syncSiteOrders\("manual"\)/, /syncSiteSales\(\[currentMonthTR\(\)\]\)/]) {
    assert.match(action, sync);
  }
  // İşlem geçmişine yalnız sayı; tek dışa açık eylem (her export bir POST ucudur)
  assert.match(action, /logActivity\(me, "laffogato\.net bağlantıları sınandı", `\$\{ok\}\/\$\{checks\.length\} bağlı`\)/);
  assert.doesNotMatch(action, /firstName|email|phone|lines/);
  assert.deepEqual(action.match(/^export (async )?function \w+/gm), ["export async function testSiteLinks"]);

  const page = read("src/app/panel/ayarlar/page.tsx");
  // Düğme yalnız bağlantı kuruluyken; kırmızı satır hatanın zamanını gösterir
  assert.match(page, /\{configured \? <SiteLinksTest \/> : null\}/);
  // ux-sade Ek A 20: hata satırı ortak Notice'te, zamanı başlığın başında
  assert.match(page, /<Notice tone="bad" size="sm" className="mt-1" title=\{`\$\{r\.tryAt \? `\$\{dateTimeTR\(r\.tryAt\)\}: ` : ""\}\$\{r\.error\}`\} \/>/);
  // Yarım saatten eski kırmızı satır sayfadan sonra (after) yeniden denenir; sayfa beklemez
  assert.match(page, /r\.health\.tone === "red" && \(!r\.tryAt \|\| nowMs - Date\.parse\(r\.tryAt\) > 30 \* 60_000\)/);
  assert.match(page, /after\(async \(\) => \{/);
});

// ---------------------------------------------------------------- Ödeme takibi ve kaçan ping (senkron planı P2)

test("liste: ödeme bekleyen sayısı isteğe bağlı; yoksa ya da bozuksa 0, liste yine okunur", () => {
  assert.equal(parseSiteOrders(list([contractOrder()])).awaitingPayment, 0, "S2 öncesi site alanı göndermez");
  assert.equal(parseSiteOrders(list([], { awaitingPayment: 0 })).awaitingPayment, 0, "sözleşmedeki örnek");
  assert.equal(parseSiteOrders(list([], { awaitingPayment: 2 })).awaitingPayment, 2);
  for (const bad of [-1, 1.5, "2", null, true, {}, []]) {
    const r = parseSiteOrders(list([contractOrder()], { awaitingPayment: bad }));
    assert.equal(r.awaitingPayment, 0, JSON.stringify(bad));
    assert.equal(r.orders.length, 1, "isteğe bağlı alan bütün yanıtı reddetmez");
  }
  assert.equal(parseSiteOrders(list([], { awaitingPayment: 1e9 })).awaitingPayment, AWAITING_MAX);
});

test("ödeme takibi: 0 → > 0, sayı artınca ve sayı sıfırdan büyükken her pingte (yeniden) başlar; ekranın çekmesi uzatmaz; 0'da biter", () => {
  const T0 = "2026-10-28T12:00:00.000Z";
  const T1 = "2026-10-28T12:10:00.000Z";
  const none = { awaitingPayment: 0, awaitingSince: null };
  assert.deepEqual(nextAwaiting(none, 0, "ping", T0), none);
  const started = nextAwaiting(none, 1, "ping", T0);
  assert.deepEqual(started, { awaitingPayment: 1, awaitingSince: T0 });
  assert.deepEqual(nextAwaiting(none, 1, "screen", T0), started, "pingi kaçan ödeme sayfası: ekranın çekmesi de başlatır");
  assert.deepEqual(nextAwaiting(started, 1, "screen", T1), started, "ekran uzatmaz");
  assert.deepEqual(nextAwaiting(started, 1, "manual", T1), started);
  assert.deepEqual(nextAwaiting(started, 1, "ping", T1), { awaitingPayment: 1, awaitingSince: T1 }, "yeniden açılan ödeme sayfası ping atar, sayıyı artırmaz");
  assert.deepEqual(nextAwaiting(started, 2, "screen", T1), { awaitingPayment: 2, awaitingSince: T1 }, "yeni ödeme sayfası");
  assert.deepEqual(nextAwaiting({ awaitingPayment: 2, awaitingSince: T0 }, 1, "screen", T1), { awaitingPayment: 1, awaitingSince: T0 }, "biri ödendi");
  assert.deepEqual(nextAwaiting(started, 0, "screen", T1), none);
  assert.deepEqual(nextAwaiting({ awaitingPayment: 1, awaitingSince: null }, 1, "screen", T1), { awaitingPayment: 1, awaitingSince: T1 }, "bozuk satır");

  assert.equal(AWAITING_FOLLOW_MS, 30 * 60_000);
  assert.equal(awaitingUntil(started), "2026-10-28T12:30:00.000Z");
  assert.equal(awaitingUntil(none), null);
  assert.equal(awaitingUntil({}), null, "P2 öncesi durum satırı");
  assert.equal(awaitingUntil({ awaitingPayment: 1, awaitingSince: "bozuk" }), null);

  // Sunucu: başarılı çekmede durum satırına; bitiş değişince sürüm artar (açık sekme yeni bitişi alsın). Pingin kaydı
  // sürüme dokunmaz; ekranın çekmesi süren takibi değiştirmediği için sürüm de artmaz
  const sync = read("src/server/site-orders/sync.ts");
  assert.match(sync, /const awaiting = nextAwaiting\(state, list\.awaitingPayment, trigger, iso\);/);
  assert.match(sync, /const followChanged = awaitingUntil\(state\) !== awaitingUntil\(awaiting\);/);
  assert.match(sync, /\.\.\.awaiting,/);
  const note = sync.slice(sync.indexOf("export async function noteOrdersPing"), sync.indexOf("export type OrdersSyncResult"));
  assert.match(note, /await patchState\(\{ lastPingAt: new Date\(\)\.toISOString\(\) \}\);/);
  assert.doesNotMatch(note, /bumpOrdersVersion/);
  // Hatada takip olduğu gibi kalır (yalnız başarılı çekme yazar)
  const failed = sync.slice(sync.indexOf("} catch (e) {", sync.indexOf("export async function syncSiteOrders")), sync.indexOf("const at = new Date();"));
  assert.doesNotMatch(failed, /awaiting/);
  // Canlı uç bitişi verir; 304 kararı veri okunmadan önce
  const live = read("src/app/api/canli/route.ts");
  assert.match(live, /awaitingUntil: linked \? awaitingUntil\(ordersState\) : null/);
  assert.ok(live.indexOf("status: 304") < live.indexOf("awaitingUntil(ordersState)"));
});

test("bar ekranı yoğun mu: açık sipariş, son iki saatte liste değişti ya da ödeme bekleniyor; ping tek başına saymaz", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const quiet = { open: 0, changeAt: null, awaitingUntil: null };
  assert.equal(boardBusy(quiet, now), false);
  assert.equal(boardBusy({ open: 0 }, now), false, "eski sunucunun yanıtı");
  assert.equal(boardBusy({ ...quiet, open: 1 }, now), true);
  assert.equal(boardBusy({ ...quiet, changeAt: iso(119 * 60_000) }, now), true, "liste değişti: iki saat kalır");
  assert.equal(boardBusy({ ...quiet, changeAt: iso(121 * 60_000) }, now), false);
  const until = awaitingUntil({ awaitingPayment: 1, awaitingSince: iso(0) });
  assert.equal(boardBusy({ ...quiet, awaitingUntil: until }, now), true, "ödeme bekleniyor");
  assert.equal(boardBusy({ ...quiet, awaitingUntil: until }, now + 29 * 60_000), true);
  assert.equal(boardBusy({ ...quiet, awaitingUntil: until }, now + 30 * 60_000), false, "30 dakika doldu");
  // Vazgeçilen kartlı ödeme: ödeme sayfasının pingi listeyi değiştirmez, takibi başlatır; takip bitince ekran sakinleşir.
  // Takibin sürüm artışı pingAt'i ekrana taşır; ping iki saat yoğun sayılsaydı ekran iki saat üç dakikada bir çekerdi
  // (senkron planı §3.1 bütçe kuralı 4: pingte iki saatlik yoğun mod yok)
  const pingAt = iso(0);
  const ended = { ...quiet, pingAt, awaitingUntil: null } as Parameters<typeof boardBusy>[0];
  for (const min of [31, 60, 90, 119]) assert.equal(boardBusy(ended, now + min * 60_000), false, `ping tek başına yoğunluk değil (+${min} dk)`);

  const board = read("src/app/panel/siparisler/orders-board.tsx");
  // Açık masa çağrısı da ekranı yoğun yapar (çağrı 15 dakikada sitede pingsiz düşer; üç dakikalık çekme onu kaldırır)
  assert.match(board, /const busy = boardBusy\(\{ open: list\.length \+ calls\.length, changeAt: data\?\.changeAt, awaitingUntil: data\?\.awaitingUntil \}, now\);/);
  assert.doesNotMatch(read("src/lib/site-orders/follow.ts"), /recent\(o\.pingAt/);
  assert.match(board, /const ms = failing \? ERROR_REPULL_MS : busy \? BUSY_REPULL_MS : QUIET_REPULL_MS;/);
  assert.match(board, /const clock = useClock\(30_000\);/, "takip bitince ekran en geç yarım dakikada sakinleşir");
  // Kurallar ekranın paketine girer: zod ve sunucu modülü yok (şemadan yalnız tip)
  assert.doesNotMatch(read("src/lib/site-orders/follow.ts"), /from "zod"|^import (?!type )/m);
});

test("ekranın isteği: sakin saatin saatlik kontrolü pingle yapılan çekmeyi saymaz, sık kontroller sayar; hatada çabuk yeniden", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  // Ekranın gönderdiği değerler (orders-board.tsx: aralık − 30 sn)
  const HOURLY = 60 * 60_000 - 30_000;
  const BUSY = 3 * 60_000 - 30_000;
  const OPEN = 60_000;
  assert.ok(HOURLY >= QUIET_CHECK_MIN_MS && BUSY < QUIET_CHECK_MIN_MS && OPEN < QUIET_CHECK_MIN_MS);
  const due = (state: Parameters<typeof pullDue>[0], maxAgeMs: number, manual = false) => pullDue(state, maxAgeMs, { manual, nowMs: now });
  // Ping bir dakika önce çekti, ekranın son kontrolü 61 dakika önce: saatlik kontrol yine sorar
  const pinged = { lastPullAt: at(1), lastCheckAt: at(61), lastError: null };
  assert.equal(due(pinged, HOURLY), true, "ping çekmesi saatlik kararı sıfırlamaz");
  assert.equal(due({ ...pinged, lastCheckAt: at(50) }, HOURLY), false, "ekranın son kontrolü 50 dakika önce");
  assert.equal(due({ ...pinged, lastCheckAt: null }, HOURLY), true, "P2 öncesi durum satırı");
  assert.equal(due({ lastPullAt: at(1), lastError: null }, HOURLY), true);
  assert.equal(due(pinged, BUSY), false, "yoğun saatin kontrolü pingin çekmesini sayar");
  assert.equal(due({ ...pinged, lastPullAt: at(0.5) }, OPEN), false);
  assert.equal(due({ ...pinged, lastPullAt: at(3) }, BUSY), true);
  assert.equal(due({ lastPullAt: null, lastCheckAt: null, lastError: null }, OPEN), true, "hiç çekilmedi");
  // Son çekme hatalı: beş saniyeden eski her istek yeniden dener, Yenile hemen
  const failed = { lastPullAt: new Date(now - 3_000).toISOString(), lastCheckAt: new Date(now - 3_000).toISOString(), lastError: "Siteye ulaşılamadı" };
  assert.equal(due(failed, HOURLY), false);
  assert.equal(due(failed, BUSY), false);
  assert.equal(due(failed, HOURLY, true), true);
  const older = { ...failed, lastPullAt: new Date(now - 6_000).toISOString(), lastCheckAt: new Date(now - 6_000).toISOString() };
  assert.equal(due(older, HOURLY), true);
  assert.equal(due(older, OPEN), true);
  // Pingle olmayan her deneme (hata, eski yanıt, başarı) kontrol anını yazar
  const sync = read("src/server/site-orders/sync.ts");
  assert.equal(sync.match(/\.\.\.checked\(trigger, tryAt\)/g)?.length, 3);
  assert.match(sync, /const checked = \(trigger: OrdersTrigger, tryAt: string\): Partial<OrdersSyncState> => \(trigger === "ping" \? \{\} : \{ lastCheckAt: tryAt \}\);/);
});

test("ping kaçtı: pingle olmayan çekmenin getirdiği, bir dakikadan önce ödenmiş ve ödemeden sonra pingi gelmemiş yeni sipariş", () => {
  const siteNow = "2026-10-28T12:00:00.000Z";
  const paidAgo = (sec: number) => ({ paidAt: new Date(Date.parse(siteNow) - sec * 1000).toISOString() });
  const base = { trigger: "screen" as const, siteNow, lastPingAt: "2026-10-28T11:50:00.000Z", prevComplete: true };
  assert.equal(MISSED_PING_GRACE_MS, 60_000);
  assert.equal(missedPing([paidAgo(120)], base), true);
  assert.equal(missedPing([paidAgo(60)], base), true, "tam bir dakika");
  assert.equal(missedPing([paidAgo(59)], base), false, "pingi yolda olabilir (aynı anda gelen ekran çekmesi)");
  assert.equal(missedPing([paidAgo(30), paidAgo(120)], base), true);
  assert.equal(missedPing([paidAgo(120)], { ...base, lastPingAt: null }), true, "hiç ping gelmedi");
  assert.equal(missedPing([paidAgo(120)], { ...base, lastPingAt: "2026-10-28T11:59:00.000Z" }), false, "ödemeden sonra ping geldi, çekmesi düştü");
  assert.equal(missedPing([paidAgo(120)], { ...base, trigger: "ping" }), false, "pingin kendi çekmesi");
  assert.equal(missedPing([paidAgo(120)], { ...base, trigger: "manual" }), true, "Yenile, aşama sonrası çekme, Bağlantıları sına");
  assert.equal(missedPing([paidAgo(120)], { ...base, prevComplete: false }), false, "önceki liste eksikti");
  assert.equal(missedPing([], base), false);
  assert.equal(missedPing([{ paidAt: "bozuk" }], base), false);

  // Sunucu: yalnız ilk kez görülen yeni siparişlerle; an durum satırına (KVKK: sipariş ya da ad yazılmaz)
  const sync = read("src/server/site-orders/sync.ts");
  assert.match(sync, /const missed = missedPing\(\s*orders\.filter\(\(o\) => fresh\.includes\(o\.id\)\),\s*\{ trigger, siteNow: list\.now, lastPingAt: state\.lastPingAt, prevComplete: prev\.complete \},?\s*\);/);
  assert.match(sync, /\.\.\.\(missed \? \{ missedPingAt: iso \} : \{\}\)/);
  // Ayarlar › laffogato.net (yalnız yönetici) gösterir
  const page = read("src/app/panel/ayarlar/page.tsx");
  assert.match(page, /missedPingAt: orders\.missedPingAt/);
  assert.match(page, /\{configured && r\.missedPingAt && missedPingShown\(r\.missedPingAt, nowMs\) \? \(/);
  assert.match(page, /Ping kaçtı \{dateTimeTR\(r\.missedPingAt\)\}: ödenmiş bir sipariş sitenin pingiyle değil ekranın kontrolüyle geldi\./);
  assert.match(page, /await requireAdmin\(\);/);
  // Öneri doğru yere bakar: ping ve çekme aynı anahtarla imzalanır, çekme başarılıyken anahtar sorun olamaz
  const missedLine = page.slice(page.indexOf("Ping kaçtı {"), page.indexOf("</p>", page.indexOf("Ping kaçtı {")));
  assert.doesNotMatch(missedLine, /anahtar/);
  assert.match(missedLine, /PANEL_URL/);
  assert.match(missedLine, /\[panel-orders\] ping not delivered/);
  assert.doesNotMatch(read("docs/SITE-SIPARIS.md").split("\n").find((l) => l.startsWith("| Ping kaçtı")) ?? "", /anahtar/);

  // Satır yedi gün görünür, sonra kendiliğinden düşer (tek tük kaçan ping haftalarca uyarı olarak kalmasın)
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  assert.equal(MISSED_PING_SHOW_MS, 7 * 86_400_000);
  assert.equal(missedPingShown(new Date(now - 60_000).toISOString(), now), true);
  assert.equal(missedPingShown(new Date(now - MISSED_PING_SHOW_MS + 1).toISOString(), now), true);
  assert.equal(missedPingShown(new Date(now - MISSED_PING_SHOW_MS).toISOString(), now), false, "yedi gün doldu");
  assert.equal(missedPingShown(null, now), false);
  assert.equal(missedPingShown("bozuk", now), false);
});

test("imza: sipariş okuması, sipariş pingi ve aşama dokunuşunun sabit vektörleri (sitedeki testler aynı değerleri sabitler)", () => {
  // laffogato tests/panel-karaoke-sync-core.test.ts (#270) aynı anahtar ve anla aynı değerleri sabitler; kural bir
  // tarafta değişirse bu istekler 401 olur. Yollar ve gövdeler panelin kurduğu gibi
  const orders = new URL("/api/panel/orders", "https://laffogato.net");
  assert.equal(sign(SECRET, { timestamp: T, method: "GET", url: orders, body: "" }), "a2664bca1515711b3d757f1a9359c4866c7b864a51e6c547f779c8f8d1676401");
  const ping = new URL("https://ladmin.laffogato.net/api/orders/ping");
  const pingBody = JSON.stringify({ event: "orders.changed", at: "2026-10-21T10:00:00.000Z" });
  assert.equal(sign(SECRET, { timestamp: T, method: "POST", url: ping, body: pingBody }), "1f746949b11c4a3adbe74ac4e26ade3d82e05057f9ed61c864647e1e39b758b5");
  const stage = new URL(STAGE_PATH, "https://laffogato.net");
  const tap = JSON.stringify(buildStageBody({ id: "ord-0042", action: "ready", from: "new", actor: "Selin" }));
  assert.equal(tap, '{"id":"ord-0042","action":"ready","from":"new","actor":"Selin"}');
  assert.equal(sign(SECRET, { timestamp: T, method: "POST", url: stage, body: tap }), "61bdc771bae90abcf187561a6657da487035c209f14553ecb7e66cb53c963ba3");
});
