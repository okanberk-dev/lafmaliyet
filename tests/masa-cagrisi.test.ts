// Masa çağrıları ("Garson çağır", 6 Kas 2026; docs/SITE-SIPARIS.md › Masa çağrıları): sitenin sipariş listesindeki
// isteğe bağlı `calls` alanının doğrulanması (alanı olan ve olmayan yanıt), son listenin kopyasındaki değişim ve yeni
// çağrı, zil kuralı (bu cihazın görmediği çağrı bir kez; ilk yüklemede iki dakika; süresi dolan çalmaz), bildirim
// metni, "Gördüm" isteğinin gövdesi, imzası ve yanıtı, hata metinleri ve sunucu / ekran kodunun kuralları (kaynaktan).
// Çalıştırma: npx tsx --test tests/masa-cagrisi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sign, signedHeaders, verifySignature } from "../src/lib/karaoke/signature";
import { buildCallAckBody, CALL_ACK_BODY_MAX_BYTES, readCallAckAnswer } from "../src/lib/site-orders/call-request";
import {
  CALL_ACK_PATH,
  CALL_OPEN_MS,
  CALL_STAFF_ERROR,
  callAckDoneMessage,
  callAckFailureMessage,
  callAgeLabel,
  callGoneMessage,
  callReasonText,
  callRingMessage,
  callsFingerprint,
  callsToRing,
  newCallIds,
  openCalls,
} from "../src/lib/site-orders/calls";
import { parseSiteCalls, parseSiteOrders, SITE_CALLS_MAX, type SiteCall } from "../src/lib/site-orders/schema";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const T = 1760000000;
const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** Sözleşmedeki örnek çağrı (sitenin docs/PANEL-ORDERS.md'si) */
const contractCall = (over: Record<string, unknown> = {}) => ({
  id: "tcl-0042",
  tableCode: "K7Q2M9X4TB",
  label: "Masa 4",
  reason: "water",
  createdAt: "2026-11-06T12:00:00.000Z",
  ...over,
});
const feed = (over: Record<string, unknown> = {}) => ({ version: 1, now: "2026-11-06T12:00:30.000Z", complete: true, orders: [], ...over });

const call = (over: Partial<SiteCall> = {}): SiteCall => ({
  id: "tcl-0001",
  tableCode: "K7Q2M9X4TB",
  label: "Masa 4",
  reason: "waiter",
  createdAt: ago(60_000),
  ...over,
});

// ---------------------------------------------------------------- Sitenin yanıtı

test("liste: `calls` yoksa (eski site) boş ve okunur; varsa sözleşmedeki örnek okunur, bilinmeyen alan atılır", () => {
  const old = parseSiteOrders(feed());
  assert.deepEqual(old.calls, []);
  assert.equal(old.callsSkipped, 0);
  assert.deepEqual(old.orders, [], "siparişler aynen okunur");
  const r = parseSiteOrders(feed({ calls: [contractCall({ customerName: "Ayşe", phone: "0555" })] }));
  assert.deepEqual(r.calls, [{ id: "tcl-0042", tableCode: "K7Q2M9X4TB", label: "Masa 4", reason: "water", createdAt: "2026-11-06T12:00:00.000Z" }]);
  assert.equal(r.callsSkipped, 0);
  // KVKK: çağrıda müşteriye dair bir şey taşınmaz (site gönderse de)
  assert.ok(!("customerName" in r.calls[0]) && !("phone" in r.calls[0]));
  // Sürüm 1 kalır: alan eklenince bütün yanıt reddedilmez
  assert.equal(parseSiteOrders(feed({ calls: [] })).calls.length, 0);
});

test("liste: `calls` dizi değilse boş sayılır, bütün yanıt reddedilmez", () => {
  for (const calls of [null, "x", 3, { id: "tcl-1" }]) {
    const r = parseSiteOrders(feed({ calls }));
    assert.deepEqual(r.calls, [], JSON.stringify(calls));
    assert.equal(r.callsSkipped, 0);
  }
});

test("liste: bozuk ya da iki kez geçen çağrı atlanır ve sayılır; bilinmeyen sebep atılmaz, 'Çağırıyor' olur", () => {
  const r = parseSiteOrders(
    feed({
      calls: [
        contractCall({ id: "tcl-1", reason: "waiter" }),
        contractCall({ id: "tcl-2", reason: "bill" }),
        contractCall({ id: "tcl-3", reason: 7 }),
        contractCall({ id: "tcl-1" }),
        contractCall({ id: "../etc" }),
        contractCall({ id: "tcl-5", createdAt: "dün" }),
        contractCall({ id: "tcl-6", createdAt: undefined }),
        "çöp",
        null,
      ],
    }),
  );
  assert.deepEqual(
    r.calls.map((c) => [c.id, c.reason]),
    [
      ["tcl-1", "waiter"],
      ["tcl-2", "other"],
      ["tcl-3", "other"],
    ],
  );
  assert.equal(r.callsSkipped, 6);
  assert.equal(callReasonText(r.calls[1].reason), "Çağırıyor");
  // Bozuk çağrı siparişleri etkilemez
  assert.equal(r.skipped, 0);
});

test("liste: metinler kısaltılır, boş masa adı 'Masa' olur, okunamayan QR kodu boş; en çok 100 çağrı okunur", () => {
  const [c] = parseSiteOrders(feed({ calls: [contractCall({ label: `  Masa   ${"9".repeat(80)} `, tableCode: "<script>" })] })).calls;
  assert.equal(Array.from(c.label).length, 40);
  assert.match(c.label, /^Masa 9/);
  assert.equal(c.tableCode, "");
  assert.equal(parseSiteOrders(feed({ calls: [contractCall({ label: "" })] })).calls[0].label, "Masa");
  assert.equal(parseSiteOrders(feed({ calls: [contractCall({ label: 42 })] })).calls[0].label, "Masa");
  const many = Array.from({ length: SITE_CALLS_MAX + 5 }, (_, i) => contractCall({ id: `tcl-${i}` }));
  const r = parseSiteCalls(many);
  assert.equal(r.calls.length, SITE_CALLS_MAX);
  assert.equal(r.skipped, 5);
});

// ---------------------------------------------------------------- Ekran ve zil

test("kart metinleri: sebep, ne zaman; açık çağrı 15 dakikadan yeni ve en eski önde", () => {
  assert.equal(callReasonText("waiter"), "Garson çağırıyor");
  assert.equal(callReasonText("water"), "Su istiyor");
  assert.equal(callReasonText("napkin"), "Peçete istiyor");
  assert.equal(callReasonText("other"), "Çağırıyor");
  assert.equal(callReasonText("bill"), "Çağırıyor");
  assert.equal(callAgeLabel(ago(20_000), NOW), "az önce");
  assert.equal(callAgeLabel(ago(4 * 60_000 + 5_000), NOW), "4 dk önce");
  assert.equal(callAgeLabel(new Date(NOW + 30_000).toISOString(), NOW), "az önce", "saat farkıyla eksiye düşmez");
  assert.equal(CALL_OPEN_MS, 15 * 60_000);
  const calls = [call({ id: "new", createdAt: ago(60_000) }), call({ id: "old", createdAt: ago(10 * 60_000) }), call({ id: "gone", createdAt: ago(CALL_OPEN_MS) })];
  assert.deepEqual(
    openCalls(calls, NOW).map((c) => c.id),
    ["old", "new"],
  );
  assert.deepEqual(openCalls(null, NOW), []);
  assert.deepEqual(openCalls(undefined, NOW), [], "eski sunucunun yanıtı");
});

test("zil: bu cihazın görmediği her açık çağrı bir kez; ilk yüklemede yalnız son iki dakika; süresi dolan çalmaz", () => {
  const calls = [
    call({ id: "fresh", createdAt: ago(30_000) }),
    call({ id: "older", createdAt: ago(5 * 60_000) }),
    call({ id: "expired", createdAt: ago(16 * 60_000) }),
  ];
  const first = callsToRing(calls, new Set(), { first: true, nowMs: NOW });
  assert.deepEqual(
    first.ring.map((c) => c.id),
    ["fresh"],
  );
  assert.deepEqual(first.markSeen.sort(), ["expired", "fresh", "older"], "eskiler sessizce görülmüş sayılır");
  const later = callsToRing(calls, new Set(), { first: false, nowMs: NOW });
  assert.deepEqual(
    later.ring.map((c) => c.id),
    ["older", "fresh"],
    "sonraki veride iki dakikadan eski de çalar, süresi dolan çalmaz",
  );
  assert.deepEqual(callsToRing(calls, new Set(["fresh", "older", "expired"]), { first: false, nowMs: NOW }), { ring: [], markSeen: [] }, "görülen bir daha çalmaz");
  assert.deepEqual(callsToRing(undefined, new Set(), { first: true, nowMs: NOW }), { ring: [], markSeen: [] }, "eski sunucunun yanıtı");
});

test("zil ve bildirim metni: 'Masa 4 · Su istiyor'; birden çoksa sayı ve masalar; müşteri yok", () => {
  assert.deepEqual(callRingMessage([call({ label: "Masa 4", reason: "water" })]), { title: "Masa 4 · Su istiyor", body: "Masa çağrısı" });
  assert.deepEqual(callRingMessage([call({ label: "Masa 4", reason: "water" }), call({ label: "Masa 7", reason: "other" })]), {
    title: "2 masa çağrısı",
    body: "Masa 4 · Su istiyor, Masa 7 · Çağırıyor",
  });
  assert.deepEqual(callRingMessage([]), { title: "", body: "" });
});

test("son listenin kopyası: çağrı değişince liste değişir; ilk çekmede ve çağrısız eski kopyada hiçbiri yeni değil", () => {
  const a = call({ id: "tcl-1" });
  assert.equal(callsFingerprint([a]), callsFingerprint([{ ...a }]));
  assert.notEqual(callsFingerprint([a]), callsFingerprint([]));
  assert.notEqual(callsFingerprint([a]), callsFingerprint([{ ...a, reason: "napkin" }]));
  assert.deepEqual(newCallIds(null, [a]), []);
  assert.deepEqual(newCallIds([], [a]), ["tcl-1"]);
  assert.deepEqual(newCallIds([a], [a, call({ id: "tcl-2" })]), ["tcl-2"]);
  const sync = read("src/server/site-orders/sync.ts");
  assert.match(sync, /newCallIds\(prev\.at && prev\.callsKnown \? prev\.calls : null, calls\)/, "ilk çekme ve çağrısız eski kopya");
  assert.match(sync, /callsFingerprint\(prev\.calls\) !== callsFingerprint\(calls\)/, "çağrı değişince sürüm artar");
  assert.match(sync, /callsKnown: Array\.isArray\(v\?\.calls\)/);
  // Bildirim: "orders" konusu, Siparişler ekranına; müşteri yok
  assert.match(sync, /callRingMessage\(open\)/);
  assert.equal((sync.match(/url: "\/panel\/siparisler"/g) ?? []).length, 2, "sipariş ve çağrı bildirimi Siparişler'e");
  assert.doesNotMatch(sync, /\/panel\/karaoke/);
  // Canlı uç: çağrılar son listenin kopyasıyla aynı sürümde (ETag), bağlantı yoksa boş
  const live = read("src/app/api/canli/route.ts");
  assert.match(live, /calls: linked \? snapshot\.calls : \[\]/);
  assert.ok(live.indexOf("status: 304") < live.indexOf("snapshot.calls"));
});

// ---------------------------------------------------------------- "Gördüm"

test("Gördüm isteği: gövde yalnız id ve actor; ad sadeleşir, 80 karakterle kısalır; 1 KB'ı aşmaz", () => {
  const body = buildCallAckBody({ id: "tcl-0042", actor: "  Selin \n  Kaya  " });
  assert.equal(JSON.stringify(body), '{"id":"tcl-0042","actor":"Selin Kaya"}');
  const leaky = { ...call({ id: "tcl-0042" }), actor: "Selin", reason: "water" } as unknown as Parameters<typeof buildCallAckBody>[0];
  assert.deepEqual(Object.keys(buildCallAckBody(leaky)), ["id", "actor"], "çağıran fazlasını verse de gitmez");
  assert.equal(buildCallAckBody({ id: "a", actor: "" }).actor, "Panel");
  assert.equal(buildCallAckBody({ id: "a", actor: null }).actor, "Panel");
  assert.equal(buildCallAckBody({ id: "a", actor: "x".repeat(200) }).actor.length, 80);
  for (const ch of ["\u0001", "ğ", "😀", '"']) {
    const worst = buildCallAckBody({ id: `t${"x".repeat(63)}`, actor: ch.repeat(80) });
    assert.ok(Buffer.byteLength(JSON.stringify(worst)) <= CALL_ACK_BODY_MAX_BYTES, JSON.stringify(ch));
  }
});

test("Gördüm imzası: aşama ucuyla aynı kural (x-laf-timestamp, x-laf-signature: v1=<hex>); sabit vektör", () => {
  assert.equal(CALL_ACK_PATH, "/api/panel/calls/ack");
  const url = new URL(CALL_ACK_PATH, "https://laffogato.net");
  const body = JSON.stringify(buildCallAckBody({ id: "tcl-0042", actor: "Selin" }));
  assert.equal(body, '{"id":"tcl-0042","actor":"Selin"}');
  assert.equal(sign(SECRET, { timestamp: T, method: "POST", url, body }), "51845bac1f45471066632720badd7a2afc0ecdf9e2eeec9c264b8da3a9a8b972");
  const h = signedHeaders(SECRET, "POST", url, body, T * 1000);
  assert.deepEqual(h, { "x-laf-timestamp": String(T), "x-laf-signature": "v1=51845bac1f45471066632720badd7a2afc0ecdf9e2eeec9c264b8da3a9a8b972" });
  const verify = (over: Partial<Parameters<typeof verifySignature>[1]> = {}) =>
    verifySignature(SECRET, { method: "POST", url, body, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now: T * 1000, ...over });
  assert.equal(verify(), true);
  assert.equal(verify({ body: body.replace("Selin", "Ayşe") }), false, "gövde imzaya girer");
  assert.equal(verify({ url: new URL("/api/panel/orders/stage", "https://laffogato.net") }), false, "yol imzaya girer");
});

test("Gördüm yanıtı: 200 görüldü, 404 not_found zaten kapanmış, okunamayan 2xx, öteki kodlar hata", () => {
  assert.deepEqual(readCallAckAnswer({ status: 200, json: { ok: true, call: { id: "tcl-0042", status: "acked" } } }, "tcl-0042"), { kind: "acked" });
  for (const json of [null, {}, { ok: true }, { ok: false, call: { id: "tcl-0042", status: "acked" } }, { ok: true, call: { id: "tcl-9", status: "acked" } }, { ok: true, call: { id: "tcl-0042", status: "open" } }]) {
    assert.deepEqual(readCallAckAnswer({ status: 200, json }, "tcl-0042"), { kind: "unreadable" }, JSON.stringify(json));
  }
  assert.deepEqual(readCallAckAnswer({ status: 404, json: { error: "not_found" } }, "tcl-0042"), { kind: "gone" });
  assert.deepEqual(readCallAckAnswer({ status: 404, json: null }, "tcl-0042"), { kind: "failed", failure: { kind: "http", status: 404, error: null, field: null } }, "uç yok (Next'in 404 sayfası)");
  assert.deepEqual(readCallAckAnswer({ status: 401, json: { error: "unauthorized" } }, "tcl-0042"), { kind: "failed", failure: { kind: "http", status: 401, error: "unauthorized", field: null } });
  assert.deepEqual(readCallAckAnswer({ status: 503, json: { error: "not_configured" } }, "tcl-0042"), { kind: "failed", failure: { kind: "http", status: 503, error: "not_configured", field: null } });
});

test("Gördüm metinleri: 'Masa 4 · görüldü', zaten kapanmış; kurulum hatasının ayrıntısı yalnız yöneticiye", () => {
  assert.equal(callAckDoneMessage("Masa 4"), "Masa 4 · görüldü");
  assert.equal(callAckDoneMessage(null), "Masa · görüldü");
  assert.equal(callGoneMessage("Masa 4"), "Masa 4 · çağrı zaten kapanmış");
  const http = (status: number, error: string | null = null) => ({ kind: "http" as const, status, error, field: null });
  assert.match(callAckFailureMessage(http(401, "unauthorized")), /^İmza reddedildi/);
  assert.equal(callAckFailureMessage(http(404)), "Sitede masa çağrısı ucu yok (laffogato.net güncel değil)");
  assert.match(callAckFailureMessage(http(503, "not_configured")), /Sitede KARAOKE_SYNC_SECRET tanımlı değil/);
  assert.match(callAckFailureMessage(http(503, "unavailable")), /veritabanı şu an okunamıyor/);
  assert.match(callAckFailureMessage({ kind: "network" }), /^Siteye ulaşılamadı/);
  assert.match(callAckFailureMessage({ kind: "timeout" }), /^Site 8 saniyede yanıt vermedi/);
  // Personel: kurulum hatasında sabit metin (anahtar adı ve imza yok); geçici hatalar aynen
  for (const f of [{ kind: "off" as const }, http(401, "unauthorized"), http(404), http(503, "not_configured"), http(400, "invalid")]) {
    assert.equal(callAckFailureMessage(f, "staff"), CALL_STAFF_ERROR, JSON.stringify(f));
    assert.doesNotMatch(callAckFailureMessage(f, "staff"), /KARAOKE_SYNC_SECRET|İmza/);
  }
  assert.match(callAckFailureMessage({ kind: "network" }, "staff"), /^Siteye ulaşılamadı/);
  assert.match(callAckFailureMessage(http(503, "unavailable"), "staff"), /veritabanı/);
});

test("Gördüm eylemi: oturum gerekir (personel de); önce doğrulama, ortak imzalı istek, sonra yalnız çekme yazar", () => {
  const action = read("src/server/actions/table-calls.ts");
  assert.match(action, /^"use server";/);
  const exported = [...action.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ["ackTableCall"], "'use server' dosyasının her dışa verilen işlevi bir uçtur");
  const body = action.slice(action.indexOf("export async function ackTableCall"));
  assert.doesNotMatch(action, /requireAdmin/);
  const order = ["requireUser()", "zAck.parse(input)", "siteLinkSecret()", "callSite("].map((s) => body.indexOf(s));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `sıra: oturum → doğrulama → anahtar → site (${order})`);
  assert.match(action, /id: z\.string\(\)\.regex\(SITE_ORDER_ID/);
  assert.match(action, /callSite\(secret, CALL_ACK_PATH, \{ method: "POST", body: JSON\.stringify\(buildCallAckBody\(\{ id: data\.id, actor: me\.name \}\)\) \}\)/);
  assert.doesNotMatch(action, /createHmac|signedRequest|signedHeaders/);
  // Kurulum ayrıntısı yalnız yöneticiye: bütün hata metinleri oturumun rolüyle
  const calls = [...action.matchAll(/callAckFailureMessage\(([^;]*)\)\)/g)].map((m) => m[1]);
  assert.equal(calls.length, 3);
  for (const c of calls) assert.match(c, /, me\.role$/);
  // Son listenin kopyasını yalnız çekme yazar; 200'den ve 404'ten (zaten kapanmış) sonra liste yeniden çekilir
  assert.match(action, /syncSiteOrders\("manual"\)/);
  assert.ok(body.indexOf("const synced = await resync();") > body.indexOf('if (answer.kind === "failed")'));
  // Sözleşme dışı JSON'lu 404 "ekran yenilendi" der; listenin gerçekten yeniden çekildiği sahte siteyle
  // tests/siparis-takip-db.test.ts'te sınanır (SB-06)
  assert.equal(callAckFailureMessage({ kind: "http", status: 404, error: "expired" }), "Çağrı sitede bulunamadı; ekran yenilendi.");
  assert.doesNotMatch(action, /integration_state|\.insert\(|\.update\(|logActivity/);
  // Sayfanın süre sınırı: istek + çekme
  assert.match(read("src/app/panel/siparisler/page.tsx"), /export const maxDuration = 30;/);
});

test("ekran: Masa çağrıları kartı, tek dokunuş Gördüm (istekte kapalı, çift dokunuş gitmez); zil ayrı desenle ve ayrı anahtarla", () => {
  const ui = read("src/app/panel/siparisler/table-calls.tsx");
  assert.match(ui, /title="Masa çağrıları"/);
  assert.match(ui, /ackTableCall\(\{ id: c\.id \}\)/);
  assert.match(ui, /if \(busy\.current\) return;/);
  assert.match(ui, /disabled=\{inFlight\}/);
  assert.match(ui, /toast\.success\(res\.data\.message/);
  assert.doesNotMatch(ui, /ConfirmDialog|confirm\(/, "tek dokunuş, onay sorulmaz");
  assert.doesNotMatch(ui, /stage-request|call-request/, "ekranın paketine zod girmez");
  assert.doesNotMatch(read("src/lib/site-orders/calls.ts"), /from "zod"|^import (?!type )[^;]*from "\.\/schema"/m);
  const board = read("src/app/panel/siparisler/orders-board.tsx");
  assert.match(board, /const calls = data\?\.configured \? openCalls\(data\.calls, now\) : \[\];/);
  assert.match(board, /\{calls\.length \? <TableCalls calls=\{calls\} now=\{now\} \/> : null\}/);
  const alerts = read("src/components/panel/live/alert-center.tsx");
  assert.match(alerts, /const SEEN_CALLS_KEY = "laf:gorulen-cagrilar";/);
  assert.match(alerts, /const SEEN_ORDERS_KEY = "laf:gorulen-siparisler";/, "siparişlerin anahtarı ayrı kalır");
  assert.match(alerts, /callsToRing\(data\.orders\.calls, seenCalls\.current, \{ first, nowMs: liveNow\(\) \}\)/);
  assert.match(alerts, /if \(prefs\.sound\) play\("call"\);/);
  assert.match(read("src/components/panel/live/sounds.ts"), /\n {2}call: /);
  // "Gör" ve sistem bildirimi Siparişler'e: siparişte, planlı siparişte ve çağrıda
  assert.equal((alerts.match(/router\.push\(ORDERS_PATH\)/g) ?? []).length, 3);
  assert.match(alerts, /const ORDERS_PATH = "\/panel\/siparisler";/);
  assert.doesNotMatch(alerts, /`(?:siparis|planli|cagri)-\$\{ring\[0\]\.id\}`, "\/panel\/karaoke"/);
});
