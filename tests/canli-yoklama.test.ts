// Veritabanını boşuna uyandırmamak (Neon ücretsiz plan, ayda 100 CU-saat): açık sekmenin yedek kontrolü öndeyken
// (boştaysa seyrek); arka planda yalnız bildirimi gelmeyen zil cihazında 10 dakikada bir (src/lib/live-poll.ts); sağlık
// ucu veritabanını ve işlerin durumunu önbellekten verir;
// hata ekranının "Tekrar dene"si sayfayı sunucudan yeniden ister, bar ekranında kendiliğinden de dener.
// Çalıştırma: npx tsx --test tests/canli-yoklama.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { defaultPrefs } from "../src/components/panel/live/prefs";
import { AUTO_RETRY, autoRetryPath, takeAutoRetry } from "../src/lib/error-retry";
import { CATCH_UP } from "../src/lib/karaoke/freshness";
import { hiddenTabNote, LIVE_POLL, listensForAlerts, livePollDue, livePollMs, pushCovers, type LivePollInput } from "../src/lib/live-poll";
import { createTtlCache } from "../src/lib/ttl-cache";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const base: LivePollInput = { visible: true, ringing: false, pushOn: false, sinceActiveMs: 0, soon: false, failing: false, listening: false };

test("yedek kontrol: arka planda bildirim gelen ya da zili olmayan cihazda hiç (alarm çalarken hariç); bildirim açıkken 30 dk", () => {
  assert.equal(livePollMs({ ...base, visible: false }), null, "zili olmayan cihaz (yöneticinin dizüstü): veritabanı uyusun");
  assert.equal(livePollMs({ ...base, visible: false, pushOn: true }), null);
  assert.equal(livePollMs({ ...base, visible: false, pushOn: true, listening: true }), null, "bildirim yeniliği getirir");
  assert.equal(livePollMs({ ...base, visible: false, ringing: true }), 15_000, "başka cihazda susturulursa burada da sussun");
  assert.equal(livePollMs({ ...base, ringing: true, pushOn: true }), 15_000);
  assert.equal(livePollMs({ ...base, pushOn: true }), 30 * 60_000);
  assert.ok(
    LIVE_POLL.pushMs > 5 * 60_000 && LIVE_POLL.idleMs > 5 * 60_000 && LIVE_POLL.hiddenMs > 5 * 60_000,
    "Neon 5 dk boşta kalınca uyur: seyrek kontrol bundan uzun",
  );
});

test("yedek kontrol: bildirim gelmeyen, zili açık cihazda arka plandaki sekme 10 dakikada bir sorar (bar ekranı; PR #18 hiç sormuyordu)", () => {
  const bar: LivePollInput = { ...base, visible: false, listening: true };
  assert.equal(livePollMs(bar), 600_000, "yeni sipariş / rezervasyon en geç 10 dakikada çalar");
  assert.equal(livePollMs({ ...bar, soon: true }), 600_000, "arka planda sıklaşmaz");
  assert.equal(livePollMs({ ...bar, failing: true }), 600_000, "arka planda sıklaşmaz");
  assert.equal(livePollMs({ ...bar, pushOn: true }), null, "bildirim yeniliği getirir");
  assert.equal(livePollMs({ ...bar, listening: false }), null, "zili olmayan cihaz");
  assert.equal(livePollMs({ ...bar, ringing: true }), 15_000);
  const now = 1_000_000_000;
  assert.equal(livePollDue(bar, now - 9 * 60_000, now), false);
  assert.equal(livePollDue(bar, now - 10 * 60_000, now), true);
  // Uyarı motoru zil cihazını tercihlerden ve sesin açılmasından bilir, zamanlayıcıya verir
  const src = read("src/components/panel/live/alert-center.tsx");
  assert.match(src, /const listening = listensForAlerts\(prefs, audio === "ready"\);/);
  assert.match(src, /failing: p\.failing, listening: p\.listening \}/);
});

test("zil cihazı: personelin varsayılanı dinler, yöneticininki dinlemez; ses kapalı ya da açılmamışsa dinlemez", () => {
  assert.equal(listensForAlerts(defaultPrefs("staff"), true), true);
  assert.equal(listensForAlerts(defaultPrefs("staff"), false), false, "ses açılmamış sekme zaten çalamaz");
  assert.equal(listensForAlerts(defaultPrefs("admin"), true), false);
  assert.equal(listensForAlerts({ ...defaultPrefs("staff"), sound: false }, true), false);
  assert.equal(listensForAlerts({ ...defaultPrefs("admin"), karaokeAlarms: true }, true), true);
});

test("bildirim yokken kartın arka plan notu: 10 dakika sözü yalnız arka planda soracak cihaza, ötekine öne gelince", () => {
  assert.match(hiddenTabNote(defaultPrefs("staff")), /zili 10 dakikaya kadar gecikebilir; telefonda arka plandaki sekme çalmaz\.$/);
  // Yöneticinin varsayılanında arka plandaki sekme sormaz: rezervasyon zili sekme öne gelince çalar
  assert.equal(hiddenTabNote(defaultPrefs("admin")), "Bildirim yokken arka plandaki sekme yeni rezervasyonu ve siparişi ancak öne gelince duyurur.");
  const cases = [
    defaultPrefs("staff"),
    defaultPrefs("admin"),
    { ...defaultPrefs("staff"), sound: false },
    { ...defaultPrefs("staff"), orderAlerts: false, karaokeAlarms: false },
    { ...defaultPrefs("admin"), orderAlerts: true },
    { ...defaultPrefs("admin"), karaokeAlarms: true },
  ];
  // Söz, arka planda sormanın kuralıyla aynı (ses açıldıktan sonra; ses satırı açılmayı ayrıca anlatır)
  for (const p of cases) assert.equal(/10 dakika/.test(hiddenTabNote(p)), listensForAlerts(p, true), JSON.stringify(p));
  const device = read("src/components/panel/live/device-alerts.tsx");
  assert.match(device, /const note = karaoke \? hiddenTabNote\(prefs\) : null;/);
  assert.doesNotMatch(device, /LATE_BELL/);
});

test("bildirim açık sayılır: izin, kayıtlı abonelik ve zilin çaldığı konular bu cihazın aboneliğinde açık", () => {
  const dev = { granted: true, topics: { karaoke: true, orders: true }, orderAlerts: true, karaokeAlarms: true };
  assert.equal(pushCovers(dev), true);
  assert.equal(pushCovers({ ...dev, granted: false }), false, "izin yok");
  assert.equal(pushCovers({ ...dev, topics: null }), false, "abonelik kaydedilemedi (gizli pencere, ağ engeli)");
  assert.equal(pushCovers({ ...dev, topics: { karaoke: true, orders: false } }), false, "Sipariş bildirimleri kapalı");
  assert.equal(pushCovers({ ...dev, topics: { karaoke: false, orders: true } }), false, "Karaoke bildirimleri kapalı");
  assert.equal(pushCovers({ ...dev, orderAlerts: false, topics: { karaoke: true, orders: false } }), true, "sipariş zili kapalı cihaz o konuyu beklemez");
});

test("bildirim açık: uyarı motoru ve bar ekranı yalnız izne değil kayıtlı aboneliğe ve konulara bakar", () => {
  const alerts = read("src/components/panel/live/alert-center.tsx");
  assert.match(alerts, /const topics = useDeviceTopics\(\);/);
  assert.match(alerts, /const pushOn = pushCovers\(\{\s*granted: Boolean\(publicKey\) && pushSupport\(\) === "granted",\s*topics,/);
  const board = read("src/app/panel/karaoke/orders-board.tsx");
  assert.match(board, /pushCovers\(\{\s*granted:/);
  // Bar ekranının 20 sn'lik döngüsü yalnız siparişe bakar: karaoke konusu kapalı, sipariş bildirimi gelen cihaz sormaz
  assert.match(board, /pushCovers\(\{ granted: Boolean\(publicKey\) && pushSupport\(\) === "granted", topics, orderAlerts: prefs\.orderAlerts, karaokeAlarms: false \}\)/);
  assert.equal(pushCovers({ granted: true, topics: { karaoke: false, orders: true }, orderAlerts: true, karaokeAlarms: false }), true);
  assert.match(board, /\}, \[hasOrders, pushOn\]\);/);
  assert.doesNotMatch(board, /const pushOn = Boolean\(publicKey\) && pushSupport\(\) === "granted";/, "izin yetmez");
  const client = read("src/components/panel/live/push-client.ts");
  assert.match(client, /noteDeviceTopics\(res\.ok \? \{ karaoke: res\.karaoke, reminders: res\.reminders, orders: res\.orders \} : null\)/);
  assert.match(client, /noteDeviceTopics\(null\);/);
  const device = read("src/components/panel/live/device-alerts.tsx");
  assert.match(device, /if \(res\.ok\) noteDeviceTopics\(next\);/);
});

test("yedek kontrol: bildirim kapalıyken ekran kullanılıyorsa ya da yakında bir şey varsa dakikada bir, boşta 10 dk", () => {
  assert.equal(livePollMs(base), 60_000);
  assert.equal(livePollMs({ ...base, sinceActiveMs: 9 * 60_000 }), 60_000);
  assert.equal(livePollMs({ ...base, sinceActiveMs: 10 * 60_000 }), 10 * 60_000);
  assert.equal(livePollMs({ ...base, sinceActiveMs: 60 * 60_000, soon: true }), 60_000, "bir saat içinde oturum ya da hatırlatıcı");
  const now = 1_000_000_000;
  assert.equal(livePollDue({ ...base, sinceActiveMs: 11 * 60_000 }, now - 9 * 60_000, now), false);
  assert.equal(livePollDue({ ...base, sinceActiveMs: 11 * 60_000 }, now - 10 * 60_000, now), true);
  assert.equal(livePollDue({ ...base, visible: false }, 0, now), false);
});

test("yedek kontrol: son karaoke çekmesi başarısızken bildirim açık ya da ekran boşta olsa da dakikada bir", () => {
  // Çekme düşünce yeni rezervasyonun bildirimi gitmez; site yalnız canlı uç sorulunca yeniden denenir (iki dakikada bir)
  const failing = { ...base, failing: true };
  assert.equal(livePollMs({ ...failing, pushOn: true }), 60_000, "bildirim açık: 30 dakika beklenmez");
  assert.equal(livePollMs({ ...failing, sinceActiveMs: 60 * 60_000 }), 60_000, "ekran boşta: 10 dakika beklenmez");
  assert.equal(livePollMs({ ...failing, pushOn: true, sinceActiveMs: 60 * 60_000 }), 60_000);
  assert.ok(LIVE_POLL.activeMs < CATCH_UP.errorRetryMs, "sitenin yeniden denenme aralığından sık sorulur: deneme kaçmaz");
  assert.equal(livePollMs({ ...failing, visible: false, pushOn: true }), null, "kimse bakmıyorsa yine sorulmaz");
  assert.equal(livePollMs({ ...failing, ringing: true }), 15_000);
  const now = 1_000_000_000;
  assert.equal(livePollDue({ ...failing, pushOn: true }, now - 60_000, now), true);
  assert.equal(livePollDue({ ...base, pushOn: true }, now - 60_000, now), false);
  // Uyarı motoru durumu canlı yanıttan alır (bar ekranındaki sarı satırla aynı alan)
  const src = read("src/components/panel/live/alert-center.tsx");
  assert.match(src, /const failing = Boolean\(data\?\.karaoke\.error\);/);
  assert.match(src, /soon: p\.soon, failing: p\.failing, listening: p\.listening \}/);
});

test("uyarı motoru: zamanlayıcı yalnız vaktin gelip gelmediğine bakar; görünürlük ve son soruluş kurala verilir", () => {
  const src = read("src/components/panel/live/alert-center.tsx");
  assert.match(src, /livePollDue\(input, Math\.max\(lastAsked, getLive\(\)\.checkedAt\), nowMs\)/);
  assert.match(src, /visible: document\.visibilityState === "visible"/);
  assert.match(src, /\}, LIVE_POLL\.tickMs\);/);
  assert.doesNotMatch(src, /setInterval\(\(\) => void refreshLive\(\), ms\)/, "eski sabit aralıklı kontrol kalmadı");
  assert.doesNotMatch(src, /10 \* 60_000 : 60_000/);
});

test("süreli önbellek: süresi içinde aynı değer, sonra yok; temizlenebilir", () => {
  const c = createTtlCache<number>(5 * 60_000);
  assert.equal(c.get(0), null);
  c.set(42, 1000);
  assert.equal(c.get(1000 + 5 * 60_000 - 1), 42);
  assert.equal(c.get(1000 + 5 * 60_000), null);
  c.set(7, 2000);
  c.clear();
  assert.equal(c.get(2001), null);
});

test("sağlık ucu: yanıt veren veritabanı 5, işlerin durumu 10 dakika önbellekte; düşük veritabanı her seferinde denenir", () => {
  const src = read("src/app/api/health/route.ts");
  assert.match(src, /const DB_CHECK_TTL_MS = 5 \* 60_000;/);
  assert.match(src, /const JOBS_CHECK_TTL_MS = 10 \* 60_000;/);
  assert.ok(src.indexOf("dbCheck.get()") < src.indexOf("getDb().execute(sql`select 1`)"), "önbellek veritabanından önce");
  assert.ok(src.indexOf("jobsCheck.get()") < src.indexOf("getDb().execute(sql`select 1`)"));
  assert.match(src, /catch \{\s*dbCheck\.clear\(\);\s*return Response\.json\(\{ ok: false, db: "down" \}, \{ status: 503 \}\);/);
  assert.match(src, /cached: true/);
  // Belgeler sık yoklamayı önermez
  const doc = read("docs/BILDIRIMLER.md");
  assert.match(doc, /\*\*6 saatte bir\*\*/);
  assert.doesNotMatch(doc, /1 saatte bir, e-posta uyarısı/);
});

test("hata ekranı: Tekrar dene sayfayı yeniden ister (retry); bar ekranında 10 sn sonra kendiliğinden, 5 dk'da en çok 3", () => {
  assert.equal(autoRetryPath("/panel/karaoke"), true);
  assert.equal(autoRetryPath("/panel/karaoke/doluluk"), false, "biri bakıyordur");
  assert.equal(autoRetryPath("/panel/kasa"), false);
  const h: number[] = [];
  assert.equal(takeAutoRetry(h, 0), true);
  assert.equal(takeAutoRetry(h, 10_000), true);
  assert.equal(takeAutoRetry(h, 20_000), true);
  assert.equal(takeAutoRetry(h, 30_000), false, "döngüye girmez");
  assert.equal(takeAutoRetry(h, AUTO_RETRY.windowMs + 1), true, "pencere geçince yeniden");
  assert.equal(AUTO_RETRY.delayMs, 10_000);

  const view = read("src/components/panel/error-view.tsx");
  assert.match(view, /onClick=\{\(\) => retry\(\)\}/);
  assert.doesNotMatch(view, /onClick=\{reset\}|\breset\(\)|reset: \(\) => void/, "reset aynı hatalı çıktıyı yeniden çizer");
  for (const f of ["src/app/panel/error.tsx", "src/app/error.tsx", "src/app/global-error.tsx"]) {
    assert.ok(existsSync(join(process.cwd(), f)), f);
    const src = read(f);
    assert.match(src, /^"use client";/, f);
    assert.match(src, /retry: \(\) => void/, f);
    assert.match(src, /<ErrorView error=\{error\} retry=\{retry\}/, f);
    assert.doesNotMatch(src, /\breset\b/, f);
  }
  // Kök düzenin yerine geçen sınır kendi belgesini ve stillerini taşır
  const global = read("src/app/global-error.tsx");
  assert.match(global, /import "\.\/globals\.css";/);
  assert.match(global, /<html lang="tr"/);
});
