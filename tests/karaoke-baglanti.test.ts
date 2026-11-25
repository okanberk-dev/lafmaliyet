// Karaoke bağlantısının sağlamlığı: çekme hatalarının Türkçe ve doğru metni (sitenin 503'ü anahtar mı veritabanı mı),
// kaçan pingin yakalanması (canlı uç bakarken kopya tazelenir; sayaç ve uzatma çakışmadan önce tazeler), bar ekranının
// uyarı satırı (personel kurulum ayrıntısı yerine kısa söz görür), uzatmanın tek yazımı.
// Çalıştırma: npx tsx --test tests/karaoke-baglanti.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { CATCH_UP, karaokeStaleLine, needsCatchUp, type KaraokeSyncMarks } from "../src/lib/karaoke/freshness";
import { fetchFailure, karaokePullError, siteErrorCode } from "../src/lib/karaoke/sync-text";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

// ---------------------------------------------------------------- Hata metinleri

test("çekme hataları: zaman aşımı, ulaşılamayan site, okunamayan yanıt Türkçe ve tek cümle", () => {
  assert.equal(karaokePullError({ kind: "timeout" }), "Site 8 saniyede yanıt vermedi");
  assert.equal(karaokePullError({ kind: "network" }), "Siteye ulaşılamadı");
  assert.equal(karaokePullError({ kind: "format" }), "Sitenin yanıtı okunamadı (site ile panel uyumsuz olabilir)");
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  assert.deepEqual(fetchFailure(timeout), { kind: "timeout" });
  assert.deepEqual(fetchFailure(Object.assign(new Error("aborted"), { name: "AbortError" })), { kind: "timeout" });
  // fetch'in ağ hatası "fetch failed" (TypeError) artık ham yazılmaz
  assert.deepEqual(fetchFailure(new TypeError("fetch failed")), { kind: "network" });
  assert.deepEqual(fetchFailure("bilinmeyen"), { kind: "network" });
});

test("sitenin 503'ü: anahtar yok mu veritabanı mı gövdedeki koddan; diğer durumlar", () => {
  assert.equal(karaokePullError({ kind: "http", status: 503, code: "not_configured" }), "Sitede KARAOKE_SYNC_SECRET tanımlı değil");
  // Sitenin veritabanı kısa süre okunamayınca yönetici anahtarı değiştirmeye yönlendirilmiyor
  assert.equal(karaokePullError({ kind: "http", status: 503, code: "unavailable" }), "Sitenin veritabanı şu an okunamıyor; birazdan yeniden denenecek");
  assert.equal(karaokePullError({ kind: "http", status: 503 }), "Sitede bağlantı kapalı ya da sitenin veritabanı okunamadı");
  assert.match(karaokePullError({ kind: "http", status: 401 }), /^Site isteği reddetti \(imza\)/);
  assert.equal(karaokePullError({ kind: "http", status: 404 }), "Sitede panel ucu yok (laffogato.net güncel değil)");
  assert.equal(karaokePullError({ kind: "http", status: 400 }), "Site tarih aralığını kabul etmedi");
  assert.equal(karaokePullError({ kind: "http", status: 502 }), "Site yanıt vermedi (HTTP 502)");
  assert.equal(siteErrorCode({ error: "unavailable" }), "unavailable");
  assert.equal(siteErrorCode({ error: "" }), null);
  assert.equal(siteErrorCode({ error: 5 }), null);
  assert.equal(siteErrorCode(null), null);
  assert.equal(siteErrorCode("<!DOCTYPE html>"), null);
  assert.equal(siteErrorCode({ error: "x".repeat(100) })?.length, 40);
});

test("sunucu: her hata yolu metne çevrilir (ham mesaj ya da JSON yazılmaz); geçmişi alma da aynı sözlerle", () => {
  const sync = read("src/server/karaoke/sync.ts");
  assert.match(sync, /return failed\(karaokePullError\(fetchFailure\(e\)\)\)/);
  assert.match(sync, /if \(!res\.ok\) return failed\(explain\(res\.status, await errorCodeOf\(res\)\)\)/);
  assert.match(sync, /\{ kind: "timeout" \} : \{ kind: "format" \}/);
  assert.doesNotMatch(sync, /e\.message\b/, "ham hata metni durum satırına yazılmaz");
  assert.match(sync, /export function explain\(status: number, code\?: string \| null\): string \{\s*return karaokePullError\(\{ kind: "http", status, code \}\);/);
  const history = read("src/server/karaoke/history.ts");
  assert.match(history, /siteErrorText\(res\.status, await errorCodeOf\(res\)\)/);
  assert.match(history, /return explain\(status, code\);/);
  // Geçmişi siteden al: ağ hatası "Siteye ulaşılamadı (fetch failed)" diye değil, eşitlemenin sözüyle
  assert.match(history, /error = karaokePullError\(fetchFailure\(e\)\);/);
  assert.doesNotMatch(history, /Siteye ulaşılamadı \(\$\{/, "ham hata metni ekrana yazılmaz");
});

// ---------------------------------------------------------------- Kaçan pingin yakalanması

const T0 = Date.parse("2026-10-23T12:00:00Z");
const iso = (msAgo: number) => new Date(T0 - msAgo).toISOString();
const marks = (m: Partial<KaraokeSyncMarks>): KaraokeSyncMarks => ({ lastOkAt: null, lastTryAt: null, lastError: null, lastPingAt: null, ...m });

test("tazeleme kuralı: taze kopya sorulmaz; 30 dakikadan eskisi, hiç çekilmemişi ve çekmesi kaybolan ping sorulur", () => {
  assert.equal(needsCatchUp(marks({ lastOkAt: iso(60_000), lastTryAt: iso(60_000) }), T0), false);
  assert.equal(needsCatchUp(marks({ lastOkAt: iso(CATCH_UP.staleMs - 1000), lastTryAt: iso(CATCH_UP.staleMs - 1000) }), T0), false);
  assert.equal(needsCatchUp(marks({ lastOkAt: iso(CATCH_UP.staleMs), lastTryAt: iso(CATCH_UP.staleMs) }), T0), true);
  assert.equal(needsCatchUp(marks({}), T0), true, "hiç başarılı çekme yok");
  // Ping son çekmeden yeni: çekmesi kaybolmuş (30 sn pingin kendi çekmesine tanınır)
  const ok = { lastOkAt: iso(10 * 60_000), lastTryAt: iso(10 * 60_000) };
  assert.equal(needsCatchUp(marks({ ...ok, lastPingAt: iso(10_000) }), T0), false, "pingin çekmesi sürüyor olabilir");
  assert.equal(needsCatchUp(marks({ ...ok, lastPingAt: iso(CATCH_UP.pingGraceMs) }), T0), true);
  assert.equal(needsCatchUp(marks({ ...ok, lastPingAt: iso(11 * 60_000) }), T0), false, "çekmesi yapılmış eski ping");
});

test("tazeleme kuralı: hatalıyken iki dakikada bir; aynı anda soran sekmeler siteyi üst üste sormaz", () => {
  const failing = { lastOkAt: iso(60 * 60_000), lastError: "Siteye ulaşılamadı" };
  assert.equal(needsCatchUp(marks({ ...failing, lastTryAt: iso(60_000) }), T0), false);
  assert.equal(needsCatchUp(marks({ ...failing, lastTryAt: iso(CATCH_UP.errorRetryMs) }), T0), true);
  // Hiç başarılı çekme olmasa da hatalıysa her soruluşta denenmez (site düşükken her istek 8 sn beklemesin)
  assert.equal(needsCatchUp(marks({ lastError: "Siteye ulaşılamadı", lastTryAt: iso(30_000) }), T0), false);
  assert.equal(needsCatchUp(marks({ lastOkAt: iso(60 * 60_000), lastTryAt: iso(5_000) }), T0), false, "az önce denendi");
  // Sayaç ve uzatma daha kısa bir sınırla sorar (3 dakika)
  const rules = { ...CATCH_UP, staleMs: 3 * 60_000 };
  assert.equal(needsCatchUp(marks({ lastOkAt: iso(4 * 60_000), lastTryAt: iso(4 * 60_000) }), T0, rules), true);
  assert.equal(needsCatchUp(marks({ lastOkAt: iso(2 * 60_000), lastTryAt: iso(2 * 60_000) }), T0, rules), false);
});

test("bar ekranının uyarı satırı: hata varken, son başarılı kontrolün saatiyle (başka gündeyse tarihle)", () => {
  assert.equal(karaokeStaleLine(null, iso(0), T0, "admin"), null);
  assert.equal(karaokeStaleLine(undefined, undefined, T0, "admin"), null);
  assert.equal(
    karaokeStaleLine("Siteye ulaşılamadı", "2026-10-23T11:05:00Z", T0, "admin"),
    "Son kontrol başarısız: Siteye ulaşılamadı (son başarılı kontrol 14:05). Rezervasyonları sitenin panelinde de kontrol edin.",
  );
  assert.equal(
    karaokeStaleLine("Site 8 saniyede yanıt vermedi", "2026-10-22T19:30:00Z", T0, "admin"),
    "Son kontrol başarısız: Site 8 saniyede yanıt vermedi (son başarılı kontrol 22.10 22:30). Rezervasyonları sitenin panelinde de kontrol edin.",
  );
  assert.equal(karaokeStaleLine("Siteye ulaşılamadı", null, T0, "admin"), "Son kontrol başarısız: Siteye ulaşılamadı. Rezervasyonları sitenin panelinde de kontrol edin.");
});

test("personel bar ekranında kurulum ayrıntısı görmez: yöneticiye haber vermesini söyleyen kısa söz", () => {
  const failures = [
    { kind: "http", status: 401 },
    { kind: "http", status: 503, code: "not_configured" },
    { kind: "http", status: 503 },
    { kind: "http", status: 404 },
    { kind: "format" },
    { kind: "network" },
    { kind: "timeout" },
  ] as const;
  for (const f of failures) {
    const err = karaokePullError(f);
    const staff = karaokeStaleLine(err, "2026-10-23T11:05:00Z", T0, "staff");
    assert.equal(
      staff,
      "Rezervasyonlar şu an siteden alınamıyor (son başarılı kontrol 14:05). Yeni rezervasyon burada görünmeyebilir; sorun sürerse yöneticiye haber verin.",
      JSON.stringify(f),
    );
    assert.doesNotMatch(staff ?? "", /KARAOKE_SYNC_SECRET|imza|sitenin panel|güncel değil/, JSON.stringify(f));
    assert.ok(karaokeStaleLine(err, "2026-10-23T11:05:00Z", T0, "admin")?.includes(err), "yönetici ayrıntıyı görür");
  }
  assert.equal(karaokeStaleLine(null, iso(0), T0, "staff"), null);
});

test("canlı uç: bayat kopyayı yanıttan sonra tazeler (304'ten önce kurulur), hata ve son başarıyı ekrana verir", () => {
  const live = read("src/app/api/canli/route.ts");
  const after = live.indexOf("if (linked && needsCatchUp(karaoke.sync, Date.now()))");
  assert.ok(after > 0 && after < live.indexOf("status: 304"), "tazeleme 304'ten önce kurulur");
  assert.match(live, /after\(async \(\) => \{\s*try \{\s*const r = await ensureKaraokeFresh\(\{ state: karaoke\.sync \}\);/);
  assert.match(live, /okAt: linked \? karaoke\.sync\.lastOkAt : null,/);
  // Hatanın ayrıntısı yalnız yöneticiye; personele sabit metin (E-64, src/lib/staff-errors.ts)
  assert.match(live, /error: linked && karaokeHere \? siteErrorFor\(me\.role, karaoke\.sync\.lastError\) : null,/);
  assert.match(live, /error: ordersHere \|\| callsHere \? siteErrorFor\(me\.role, ordersState\.lastError\) : null,/);
  // Karaoke işaretleri tek sorguda (sürüm ve eşitleme durumu): canlı ucun sorgu sayısı artmaz
  assert.match(live, /readKaraokeLive\(\), remindersMarker\(me\.id\), ordersVersion\(\)/);
  const sync = read("src/server/karaoke/sync.ts");
  assert.match(sync, /inArray\(s\.integrationState\.key, \[KARAOKE_VERSION_KEY, STATE_KEY\]\)/);
  // Hata durumu değişince sürüm artar (304 eski satırı göstermesin); başarılı çekme hatayı kaldırınca da
  assert.match(sync, /if \(state\.lastError !== error\) await bumpKaraokeVersion\(\);/);
  assert.match(sync, /if \(created \|\| updated \|\| removed \|\| curState\.lastError\) await bumpKaraokeVersion\(tx\);/);
  assert.match(read("src/app/panel/karaoke/karaoke-board.tsx"), /karaokeStaleLine\(live\.data\?\.karaoke\.error, live\.data\?\.karaoke\.okAt, now, role\)/);
});

test("sayaç ve uzatma: çakışmayı sormadan önce kopya tazelenir (onaylı 'yine de' hariç); uzatma tek yazımda", () => {
  const actions = read("src/server/actions/karaoke.ts");
  assert.match(actions, /const CONFLICT_FRESH_MS = 3 \* 60_000;/);
  for (const fn of ["startKaraokeTimer", "extendKaraokeSession"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    const fresh = body.indexOf("await freshBeforeConflict();");
    assert.ok(fresh > 0 && fresh < body.indexOf("await siteConflict("), `${fn}: önce tazele`);
    assert.ok(body.indexOf("force") < fresh, `${fn}: yine de denince sorulmaz`);
  }
  const extend = actions.slice(actions.indexOf("export async function extendKaraokeSession"), actions.indexOf("export async function endKaraokeSession"));
  assert.match(extend, /const done = await addExtraMinutes\(db, sid, add\);/);
  assert.doesNotMatch(extend, /extraMinutes: row\.extraMinutes \+ add/, "okunan değerin üstüne yazılmaz");
  const sql = read("src/server/karaoke/extend.ts");
  assert.match(sql, /extraMinutes: sql`\$\{k\.extraMinutes\} \+ \$\{add\}`/);
  assert.match(sql, /sql`\$\{k\.extraMinutes\} \+ \$\{add\} <= \$\{MAX_EXTRA_MINUTES\}`/);
  assert.match(sql, /ne\(k\.status, "cancelled"\)/);
});
