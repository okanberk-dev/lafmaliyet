// Karaoke: laffogato.net ile imza (sitedeki tests/panel-karaoke-sync-core.test.ts aynı vektörleri sabitler), sitenin
// yanıtının doğrulanması, olay tespiti (zil ne zaman çalar), oturum evreleri, uyarı planı ve metinler.
// Çalıştırma: npx tsx --test tests/karaoke.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  alarmPlan,
  countdown,
  dayLabel,
  detectEvent,
  durationLabel,
  eventMessage,
  isLive,
  isPlayable,
  phase,
  pushMessages,
  timeRange,
  type KaraokeSessionDTO,
  type SiteReservation,
} from "../src/lib/karaoke/session";
import { canonicalQuery, sign, signedHeaders, verifySignature } from "../src/lib/karaoke/signature";
import { cancelledAtFor, parseSiteResponse, siteTime } from "../src/lib/karaoke/site";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const T = 1760000000;

test("imza: iki depoda sabit vektörler", () => {
  const get = new URL("https://laffogato.net/api/panel/karaoke?to=2026-12-31&from=2026-10-20");
  assert.equal(sign(SECRET, { timestamp: T, method: "GET", url: get, body: "" }), "13a147fac8db7d7012e86b1a83c230ac4c2a5d15bef73877e3ebe1e6d668a1e4");
  const post = new URL("https://ladmin.laffogato.net/api/karaoke/ping");
  const body = JSON.stringify({ event: "karaoke.changed", at: "2026-10-21T10:00:00.000Z" });
  assert.equal(sign(SECRET, { timestamp: T, method: "POST", url: post, body }), "1d993513ad228ef2b3c43bc4c32c76d792a20aa4563d31001320cc95cfbd9c69");
});

test("imza: sorgu sırası fark etmez; gövde, yol, yöntem, anahtar ve eski zaman reddedilir", () => {
  assert.equal(canonicalQuery(new URLSearchParams("b=2&a=1&a=0")), "a=0&a=1&b=2");
  const url = new URL("https://ladmin.laffogato.net/api/karaoke/ping");
  const body = '{"event":"karaoke.changed"}';
  const now = T * 1000;
  const h = signedHeaders(SECRET, "POST", url, body, now);
  const ok = (over: Partial<Parameters<typeof verifySignature>[1]> = {}, secret = SECRET) =>
    verifySignature(secret, { method: "POST", url, body, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now, ...over });
  assert.equal(ok(), true);
  assert.equal(ok({ body: '{"event":"karaoke.changed "}' }), false);
  assert.equal(ok({ url: new URL("https://ladmin.laffogato.net/api/karaoke/pong") }), false);
  assert.equal(ok({ method: "GET" }), false);
  assert.equal(ok({}, `${SECRET}x`), false);
  assert.equal(ok({ now: now + 301_000 }), false, "5 dakikadan eski");
  assert.equal(ok({ now: now - 301_000 }), false, "5 dakikadan ileri");
  assert.equal(ok({ now: now + 299_000 }), true);
  assert.equal(ok({ signature: "v2=abc" }), false);
  assert.equal(ok({ signature: null }), false);
  assert.equal(ok({ timestamp: "abc" }), false);
  // Sorgu parametrelerinin sırası değişse de imza tutar
  const a = new URL("https://laffogato.net/api/panel/karaoke?from=2026-10-20&to=2026-12-31");
  const b = new URL("https://laffogato.net/api/panel/karaoke?to=2026-12-31&from=2026-10-20");
  assert.equal(sign(SECRET, { timestamp: T, method: "GET", url: a, body: "" }), sign(SECRET, { timestamp: T, method: "GET", url: b, body: "" }));
});

/** Sitenin gönderdiği satır (bozuk değer denemeleri için `over` serbest) */
const site = (over: Record<string, unknown> = {}): SiteReservation => ({
  id: "krk-0001",
  date: "2026-10-24",
  startHour: 20,
  hours: 2,
  startsAt: "2026-10-24T17:00:00.000Z",
  endsAt: "2026-10-24T19:00:00.000Z",
  guests: 4,
  status: "confirmed",
  paymentStatus: "paid",
  firstName: "Ayşe",
  note: "Doğum günü",
  totalMinor: 200000,
  channel: "web",
  createdAt: "2026-10-21T09:00:00.000Z",
  updatedAt: "2026-10-21T09:05:00.000Z",
  ...over,
}) as SiteReservation;

test("sitenin yanıtı: bozuk satır atlanır, bilinmeyen durum varsayılana düşer, metin kısaltılır", () => {
  const snap = parseSiteResponse({
    now: "2026-10-21T10:00:00.000Z",
    from: "2026-10-20",
    to: "2027-01-18",
    complete: true,
    reservations: [
      site(),
      site({ id: "krk-0002", status: "yeni-durum", paymentStatus: "bilinmiyor", note: "x".repeat(500), firstName: "  Mehmet  " }),
      site({ id: "", date: "bozuk" }),
      site({ id: "krk-0003", endsAt: "2026-10-24T16:00:00.000Z" }),
      "satır değil",
    ],
  });
  assert.equal(snap.reservations.length, 2);
  assert.equal(snap.skipped, 3);
  const second = snap.reservations[1];
  assert.equal(second.status, "requested");
  assert.equal(second.paymentStatus, "none");
  assert.equal(second.note.length, 300);
  assert.equal(second.firstName, "Mehmet");
  assert.throws(() => parseSiteResponse({ reservations: [] }));
});

test("sitenin yanıtı: isteğe bağlı iptal anı (site bugün göndermiyor); yoksa ya da bozuksa yok sayılır", () => {
  const snap = parseSiteResponse({
    now: "2026-10-21T10:00:00.000Z",
    from: "2026-10-20",
    to: "2027-01-18",
    complete: true,
    reservations: [site(), site({ id: "krk-0002", cancelledAt: "2026-10-21T08:00:00.000Z" }), site({ id: "krk-0003", cancelledAt: 12 }), site({ id: "krk-0004", cancelledAt: null })],
  });
  assert.equal(snap.reservations.length, 4);
  assert.deepEqual(
    snap.reservations.map((r) => r.cancelledAt),
    [undefined, "2026-10-21T08:00:00.000Z", undefined, undefined],
  );
  assert.equal(siteTime("2026-10-21T09:00:00.000Z")?.toISOString(), "2026-10-21T09:00:00.000Z");
  assert.equal(siteTime(""), null);
  assert.equal(siteTime("bozuk"), null);
  assert.equal(siteTime(undefined), null);
});

test("iptal anı (doluluk): geçişi görünce sitenin son değişikliği; bilinen korunur; yeniden açılınca boşalır", () => {
  const now = new Date("2026-10-21T10:00:00.000Z");
  const live = { cancelledAt: null, status: "confirmed" as const, paymentStatus: "paid" as const };
  const cancel = (over: Record<string, unknown> = {}) => site({ status: "cancelled", paymentStatus: "refunding", updatedAt: "2026-10-21T09:30:00.000Z", ...over });
  // Canlıdan iptale geçiş: updatedAt; o yoksa şimdi; gelecekteki an şimdiye kırpılır
  assert.equal(cancelledAtFor(live, cancel(), now)?.toISOString(), "2026-10-21T09:30:00.000Z");
  assert.equal(cancelledAtFor(live, cancel({ updatedAt: "" }), now)?.toISOString(), now.toISOString());
  assert.equal(cancelledAtFor(live, cancel({ updatedAt: "2026-10-21T11:00:00.000Z" }), now)?.toISOString(), now.toISOString());
  // Bilinen an korunur (iade adımları updatedAt'i oynatsa da)
  const known = new Date("2026-10-20T12:00:00.000Z");
  assert.equal(cancelledAtFor({ cancelledAt: known, status: "cancelled", paymentStatus: "refunding" }, cancel({ paymentStatus: "refunded" }), now), known);
  // Önceden iptal görülmüş ama anı yok (sütunlardan önce): bilinmez
  assert.equal(cancelledAtFor({ cancelledAt: null, status: "cancelled", paymentStatus: "refunding" }, cancel({ paymentStatus: "refunded" }), now), null);
  // Yeniden açılan iptal ve iptal olmayan
  assert.equal(cancelledAtFor({ cancelledAt: known, status: "cancelled", paymentStatus: "none" }, site({ status: "confirmed", paymentStatus: "none" }), now), null);
  assert.equal(cancelledAtFor(null, site(), now), null);
  // Ödeme sayfasında süresi dolan tutma iptal sayılmaz
  assert.equal(cancelledAtFor(live, site({ status: "cancelled", paymentStatus: "expired" }), now), null);
  // İlk kez iptal hâlinde görülen: ödeme akışı yoksa updatedAt, iadede bilinmez
  assert.equal(cancelledAtFor(null, cancel({ paymentStatus: "none" }), now)?.toISOString(), "2026-10-21T09:30:00.000Z");
  assert.equal(cancelledAtFor(null, cancel({ paymentStatus: "refunded" }), now), null);
  // Site anı gönderirse o öncelikli
  assert.equal(cancelledAtFor(live, cancel({ cancelledAt: "2026-10-21T07:00:00.000Z" }), now)?.toISOString(), "2026-10-21T07:00:00.000Z");
  assert.equal(cancelledAtFor(null, cancel({ cancelledAt: "2026-10-19T07:00:00.000Z" }), now)?.toISOString(), "2026-10-19T07:00:00.000Z");
});

const prev = (status: "requested" | "confirmed" | "cancelled", paymentStatus: "none" | "pending" | "paid" | "refunded" | "expired" | "refunding", startsAt = "2026-10-24T17:00:00.000Z") => ({
  status,
  paymentStatus,
  startsAt: Date.parse(startsAt),
  endsAt: Date.parse(startsAt) + 2 * 3_600_000,
});

test("olay tespiti: zil yalnız gerçek yeni rezervasyonda; ödenmeyen tutma sessiz", () => {
  // İlk kez görülen
  assert.equal(detectEvent(null, site()), "created");
  assert.equal(detectEvent(null, site({ status: "requested", paymentStatus: "none" })), "created", "kasada ödenecek talep de yeni");
  assert.equal(detectEvent(null, site({ status: "requested", paymentStatus: "pending" })), null, "ödeme bekleyen tutma henüz rezervasyon değil");
  assert.equal(detectEvent(null, site({ status: "cancelled", paymentStatus: "expired" })), null);
  // Tutma ödendi → yeni rezervasyon
  assert.equal(detectEvent(prev("requested", "pending"), site()), "created");
  // Tutma ödenmeden düştü → sessiz
  assert.equal(detectEvent(prev("requested", "pending"), site({ status: "cancelled", paymentStatus: "expired" })), null);
  // Talep onaylandı
  assert.equal(detectEvent(prev("requested", "none"), site({ status: "confirmed", paymentStatus: "none" })), "confirmed");
  // İptal ve iade adımları
  assert.equal(detectEvent(prev("confirmed", "paid"), site({ status: "cancelled", paymentStatus: "refunding" })), "cancelled");
  assert.equal(detectEvent(prev("cancelled", "refunding"), site({ status: "cancelled", paymentStatus: "refunded" })), null);
  // Saat değişti
  assert.equal(detectEvent(prev("confirmed", "paid", "2026-10-24T16:00:00.000Z"), site()), "changed");
  // Hiçbir şey değişmedi
  assert.equal(detectEvent(prev("confirmed", "paid"), site()), null);
  // İptal geri alındı
  assert.equal(detectEvent(prev("cancelled", "none"), site({ status: "confirmed", paymentStatus: "none" })), "created");
});

const session = (over: Partial<KaraokeSessionDTO> = {}): KaraokeSessionDTO => ({
  id: 1,
  source: "site",
  externalId: "krk-0001",
  date: "2026-10-24",
  startsAt: "2026-10-24T17:00:00.000Z",
  endsAt: "2026-10-24T19:00:00.000Z",
  extraMinutes: 0,
  endedAt: null,
  endedBy: null,
  guests: 4,
  customerName: "Ayşe",
  note: null,
  status: "confirmed",
  paymentStatus: "paid",
  totalMinor: null,
  lastEvent: null,
  lastEventAt: null,
  createdBy: null,
  ...over,
});
const at = (iso: string) => Date.parse(iso);

test("evreler: başlamadı, sürüyor, süre doldu (susturulana kadar), bitti; iptal ve tutma", () => {
  const s = session();
  assert.equal(phase(s, at("2026-10-24T16:59:00Z")), "upcoming");
  assert.equal(phase(s, at("2026-10-24T17:00:00Z")), "active");
  assert.equal(phase(s, at("2026-10-24T18:59:59Z")), "active");
  assert.equal(phase(s, at("2026-10-24T19:00:00Z")), "overtime");
  assert.equal(phase({ ...s, extraMinutes: 15 }, at("2026-10-24T19:10:00Z")), "active", "uzatma bitişi öteler");
  assert.equal(phase({ ...s, endedAt: "2026-10-24T19:02:00Z" }, at("2026-10-24T19:05:00Z")), "done");
  assert.equal(phase(s, at("2026-10-25T02:00:00Z")), "done", "6 saatten eski alarm kendiliğinden biter");
  assert.equal(phase(session({ status: "cancelled", paymentStatus: "refunded" }), at("2026-10-24T18:00:00Z")), "cancelled");
  assert.equal(phase(session({ status: "requested", paymentStatus: "pending" }), at("2026-10-24T18:00:00Z")), "held");
  assert.equal(isPlayable(session({ status: "requested", paymentStatus: "none" })), true, "kasada ödenecek talep çalar");
  assert.equal(isPlayable(session({ status: "requested", paymentStatus: "pending" })), false);
  assert.equal(isPlayable(session({ source: "panel", status: "confirmed", paymentStatus: "none", externalId: null })), true);
  assert.equal(isLive(session({ status: "cancelled" })), false);
});

test("uyarı planı: başlangıç, bitime kala ve bitiş; geçmiş ve susturulan planlanmaz", () => {
  const s = session();
  const plan = alarmPlan([s], at("2026-10-24T16:00:00Z"), 10);
  assert.deepEqual(
    plan.map((a) => [a.kind, new Date(a.at).toISOString()]),
    [
      ["start", "2026-10-24T17:00:00.000Z"],
      ["warn", "2026-10-24T18:50:00.000Z"],
      ["end", "2026-10-24T19:00:00.000Z"],
    ],
  );
  // Sayfa oturum ortasında açıldı: geçmiş başlangıç çalmaz
  assert.deepEqual(
    alarmPlan([s], at("2026-10-24T18:00:00Z"), 10).map((a) => a.kind),
    ["warn", "end"],
  );
  assert.deepEqual(alarmPlan([{ ...s, endedAt: "2026-10-24T18:00:00Z" }], at("2026-10-24T16:00:00Z"), 10), []);
  assert.deepEqual(alarmPlan([session({ status: "cancelled" })], at("2026-10-24T16:00:00Z"), 10), []);
  // Uyarı süresi oturumdan uzunsa uyarı yok
  assert.deepEqual(
    alarmPlan([session({ endsAt: "2026-10-24T17:05:00.000Z" })], at("2026-10-24T16:00:00Z"), 10).map((a) => a.kind),
    ["start", "end"],
  );
  // Uzatma bitişi öteler; anahtar yeni bitişle değişir (yeniden çalar)
  const extended = alarmPlan([{ ...s, extraMinutes: 15 }], at("2026-10-24T18:00:00Z"), 0);
  assert.equal(extended.at(-1)?.key, `1:end:${at("2026-10-24T19:15:00Z")}`);
});

test("metinler: kalan süre, süre, gün, saat aralığı ve bildirim", () => {
  assert.equal(countdown(3_725_000), "1:02:05");
  assert.equal(countdown(42 * 60_000 + 13_000), "42:13");
  assert.equal(countdown(-5), "0:00");
  assert.equal(durationLabel(90), "1 saat 30 dk");
  assert.equal(durationLabel(45), "45 dk");
  assert.equal(durationLabel(120), "2 saat");
  const now = at("2026-10-24T09:00:00Z");
  assert.equal(dayLabel("2026-10-24", now), "Bugün");
  assert.equal(dayLabel("2026-10-25", now), "Yarın");
  assert.equal(dayLabel("2026-10-28", now), "28 Eki Çarşamba");
  // Gece yarısını geçen oturum
  assert.equal(timeRange(at("2026-10-24T20:00:00Z"), at("2026-10-24T22:00:00Z")), "23:00–01:00");
  const msg = eventMessage("created", { startsAt: at("2026-10-24T17:00:00Z"), endsAt: at("2026-10-24T19:00:00Z"), guests: 4, name: "Ayşe", status: "requested", paymentStatus: "none" }, now);
  assert.deepEqual(msg, { title: "Yeni karaoke rezervasyonu", body: "Bugün 20:00–22:00 · 4 kişi · Ayşe · onay bekliyor" });
  assert.equal(eventMessage("cancelled", { startsAt: at("2026-10-25T17:00:00Z"), endsAt: at("2026-10-25T18:00:00Z"), guests: null, name: null, status: "cancelled", paymentStatus: "refunding" }, now).body, "Yarın 20:00–21:00");
});

test("Web Push gövdesinde misafirin adı yok (kilit ekranı); ekrandaki zil satırında var", () => {
  const now = at("2026-10-24T09:00:00Z");
  const r = (firstName: string, startsAt = "2026-10-24T17:00:00.000Z", endsAt = "2026-10-24T19:00:00.000Z"): SiteReservation => ({
    id: `kr-${firstName}`,
    date: startsAt.slice(0, 10),
    startHour: 20,
    hours: 2,
    startsAt,
    endsAt,
    guests: 4,
    status: "requested",
    paymentStatus: "none",
    firstName,
    note: "Doğum günü",
    totalMinor: 120_000,
    channel: "web",
    createdAt: "2026-10-24T08:00:00.000Z",
    updatedAt: "2026-10-24T08:00:00.000Z",
  });
  const push = pushMessages([{ event: "created", r: r("Ayşe") }], now);
  assert.deepEqual(push, [{ event: "created", title: "Yeni karaoke rezervasyonu", body: "Bugün 20:00–22:00 · 4 kişi · onay bekliyor" }]);
  // Aynı olayın ekrandaki zil metni adı gösterir (alert-center.tsx kopyanın adını verir)
  const ring = eventMessage("created", { startsAt: at("2026-10-24T17:00:00Z"), endsAt: at("2026-10-24T19:00:00Z"), guests: 4, name: "Ayşe", status: "requested", paymentStatus: "none" }, now);
  assert.equal(ring.body, "Bugün 20:00–22:00 · 4 kişi · Ayşe · onay bekliyor");
  // Üç olaya kadar her biri ayrı, adsız
  const three = pushMessages([{ event: "created", r: r("Ayşe") }, { event: "changed", r: r("Deniz") }, { event: "cancelled", r: r("Mert") }], now);
  assert.equal(three.length, 3);
  assert.deepEqual(three.map((m) => m.event), ["created", "changed", "cancelled"]);
  // Üçten fazlası tek özet; özette de ad ve not yok
  const names = ["Ayşe", "Deniz", "Mert", "Zeynep"];
  const many = pushMessages(names.map((n) => ({ event: "created" as const, r: r(n) })), now);
  assert.equal(many.length, 1);
  assert.equal(many[0].title, "4 karaoke güncellemesi");
  assert.equal(many[0].event, "created");
  for (const list of [push, three, many]) assert.doesNotMatch(JSON.stringify(list), /Ayşe|Deniz|Mert|Zeynep|Doğum günü/);
  // Eşitleme bildirimi yalnız bu yardımcıyla kurar; ekrandaki zil kopyanın adını vermeye devam eder
  const sync = readFileSync(join(process.cwd(), "src/server/karaoke/sync.ts"), "utf8");
  const announce = sync.slice(sync.indexOf("async function announce"));
  assert.match(announce, /for \(const m of pushMessages\(events, nowMs\)\)/);
  assert.doesNotMatch(announce, /firstName|eventMessage|\bnote\b/);
  const alerts = readFileSync(join(process.cwd(), "src/components/panel/live/alert-center.tsx"), "utf8");
  assert.match(alerts, /eventMessage\(s\.lastEvent, \{[^}]*name: s\.customerName/);
});

test("panelin kendi sistem bildirimleri (sekme arkadayken) misafirin adını taşımaz; ekrandaki toast'ta ad kalır", () => {
  const src = readFileSync(join(process.cwd(), "src/components/panel/live/alert-center.tsx"), "utf8");
  // Her `void notify(...)` çağrısının argümanları (parantez dengesiyle)
  const calls: string[] = [];
  for (let i = src.indexOf("void notify("); i !== -1; i = src.indexOf("void notify(", i + 1)) {
    let depth = 0;
    let j = i + "void notify".length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    calls.push(src.slice(i, j + 1));
  }
  // Sipariş, planlı sipariş, karaoke başladı / az kaldı / süre doldu, hatırlatıcı
  assert.equal(calls.length, 6);
  for (const c of calls) assert.doesNotMatch(c, /\bname\b|customerName|sessionName|firstName/, c);
  const fire = src.slice(src.indexOf("const fire = useCallback("), src.indexOf("// Karaoke uyarılarını ve saatli hatırlatmaları kur"));
  assert.match(fire, /void notify\("Karaoke başladı", detail,/);
  assert.match(fire, /void notify\(`Karaokede \$\{prefs\.warnMinutes\} dakika kaldı`, end,/);
  assert.match(fire, /void notify\("Karaokede süre doldu",/);
  // Açık ekrandaki toast adı göstermeye devam eder
  assert.match(fire, /toast\(`Karaoke başladı: \$\{name\}`/);
  assert.match(fire, /toast\.warning\(`\$\{prefs\.warnMinutes\} dakika kaldı: \$\{name\}`/);
});

test("ping ucu imzasız isteği reddeder, eşitleme yanıttan sonra; personel tutarı görmez", () => {
  const ping = readFileSync(join(process.cwd(), "src/app/api/karaoke/ping/route.ts"), "utf8");
  assert.match(ping, /if \(!secret\) return Response\.json\(\{ error: "not_configured" \}, \{ status: 503 \}\)/);
  // İmza ve boyut menü ve sipariş pingleriyle ortak denetimden (src/lib/site-ping.ts: imzasız ya da yanlış 401)
  assert.match(ping, /if \(!check\.ok\) return Response\.json\(\{ error: check\.error \}, \{ status: check\.status \}\)/);
  assert.ok(ping.indexOf("checkSitePing(") > 0 && ping.indexOf("checkSitePing(") < ping.indexOf("after("), "202'den önce imza");
  assert.match(ping, /after\(async \(\) =>/);
  const board = readFileSync(join(process.cwd(), "src/server/karaoke/board.ts"), "utf8");
  assert.match(board, /totalMinor: opts\.admin \? r\.totalMinor : null/);
  // postgres-js, sütun dışı ifadeyle karşılaştırılan Date'i çeviremez (sorgu 500 verir): ISO metni geçilmeli
  assert.match(board, /make_interval\(mins => \$\{s\.karaokeSessions\.extraMinutes\}\)`, from\.toISOString\(\)\)/);
  // Canlı uç değişiklik yoksa veri okumadan 304 döner
  const live = readFileSync(join(process.cwd(), "src/app/api/canli/route.ts"), "utf8");
  assert.match(live, /if \(request\.headers\.get\("if-none-match"\) === etag\) return new Response\(null, \{ status: 304/);
  assert.ok(live.indexOf("status: 304") < live.indexOf("loadSessions(from"), "304 kararı veri okunmadan önce");
});

test("service worker yalnız bildirim işi yapar: istek yakalamaz, önbelleklemez", () => {
  const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.doesNotMatch(sw, /addEventListener\("fetch"/);
  assert.doesNotMatch(sw, /caches\./);
  // Bildirimin açtığı adres yalnız panel içi
  assert.match(sw, /msg\.url\.startsWith\("\/panel"\)/);
});
