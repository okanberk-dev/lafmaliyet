// Anahtar değişiminin uyumu gerçek Postgres'te (docs/ASILPOS.md › Şube kurulumu › Anahtar değişimi;
// src/server/asilpos/anahtar-uyumu.ts, src/server/bell/asilpos.ts asilposAnahtarBell): kasanın bağlantı sorgusu
// şubenin satırına yazılır (değişmediyse saatte bir); kasa sorunca, bu değerler son bir saatte sınanmadıysa Uzaktan ve
// site sınanır (raporu değişmese de: inceleme 27 Kasım); reddeden uç yöneticinin zilinde ve Ayarlar kartında uyarı
// olur, sınama geçince kalkar. Uçların önceki anahtar desteği (yanıt başlığı) ve Uzaktan'ın önceki anahtar bayrağı
// saklanır. Kasaların raporu, sınama ve destek birbirini ezmez. Uçlar sahte fetch'le (ağ yok); anahtar hiçbir satıra
// yazılmaz.
//
// `asilpos-anahtar-uyumu` satırı testin başında saklanır, sonunda geri konur.
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/lm_test npm run test:db -- tests/asilpos-anahtar-uyumu-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { ANAHTAR_BASLIGI, ANAHTAR_UYUMU_KEY } from "../src/lib/asilpos/anahtar-uyumu";
import { dagitilanBaglantilar } from "../src/lib/asilpos/baglanti-dagitim";
import { UZAK_ONCEKI_ENV } from "../src/lib/asilpos/eski-adlar";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL_ = process.env.ANAHTAR_UYUMU_TEST_DATABASE_URL;

const CLOUD = "u".repeat(44);
const SITE = "w".repeat(44);
const ENV = { ASILPOS_CLOUD_URL: "https://uzaktan.ornek.test", ASILPOS_CLOUD_SECRET: CLOUD, ASILPOS_SITE_URL: "https://site.ornek.test", ASILPOS_SITE_SECRET: SITE };
const SURUM = dagitilanBaglantilar(ENV).surum;

describe("Anahtar uyumu: veritabanında", { skip: !URL_ && "ANAHTAR_UYUMU_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let mod: typeof import("../src/server/asilpos/anahtar-uyumu");
  let bell: typeof import("../src/server/bell/asilpos");
  let saved: unknown;
  /** İmzalı sınama istekleri (uçların sunucusu); Uzaktan'ın açık durum ucuna gidenler ayrı */
  const calls: string[] = [];
  const healthCalls: string[] = [];
  /** Uçların yanıtı: adresin sunucusuna göre; yanıt başlığı (yeni sürüm) ve Uzaktan'ın önceki anahtar bayrağı */
  let answers: Record<string, number> = {};
  let headers: Record<string, string> = {};
  let health: unknown = { ok: true, remote: true };
  const fakeFetch = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/health") {
      healthCalls.push(url.host);
      return Response.json(health);
    }
    calls.push(url.host);
    const status = answers[url.host] ?? 200;
    return new Response("{}", { status, headers: headers[url.host] ? { [ANAHTAR_BASLIGI]: headers[url.host] } : {} });
  }) as typeof fetch;
  /** İlk sorgunun anı (sonraki testler buna göre ilerler) */
  let t0 = new Date();

  before(async () => {
    process.env.DATABASE_URL = URL_;
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL_!, 2);
    mod = await import("../src/server/asilpos/anahtar-uyumu");
    bell = await import("../src/server/bell/asilpos");
    const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, ANAHTAR_UYUMU_KEY));
    saved = row?.value;
    await db.delete(s.integrationState).where(eq(s.integrationState.key, ANAHTAR_UYUMU_KEY));
  });

  after(async () => {
    if (!db) return;
    await db.delete(s.integrationState).where(eq(s.integrationState.key, ANAHTAR_UYUMU_KEY));
    if (saved !== undefined) await db.insert(s.integrationState).values({ key: ANAHTAR_UYUMU_KEY, value: saved });
  });

  test("kasa yeni değeri görür: rapor yazılır, iki uç sınanır; Uzaktan reddederse turuncu uyarı (kasa bekliyor)", async () => {
    answers = { "uzaktan.ornek.test": 401, "site.ornek.test": 200 };
    t0 = new Date();
    const r = await mod.noteBaglantiRaporu(db, "marina", { uygulanan: "eskisurum", guncel: SURUM }, { now: t0, env: ENV, fetchImpl: fakeFetch });
    assert.equal(r.yazildi, true);
    assert.deepEqual(r.sinama?.sonuc, { uzaktan: { durum: "red", http: 401 }, site: { durum: "ok", http: 200 } });
    assert.deepEqual(calls.sort(), ["site.ornek.test", "uzaktan.ornek.test"]);
    assert.deepEqual(healthCalls, ["uzaktan.ornek.test"], "açık durum ucu yalnız Uzaktan'da");
    const state = await mod.readAnahtarUyumu(db);
    assert.deepEqual(state.kasalar.marina, { uygulanan: "eskisurum", guncel: SURUM, at: t0.toISOString() });
    assert.equal(state.sinama?.tetik, "kasa");
    // Satırda anahtar yok
    const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, ANAHTAR_UYUMU_KEY));
    assert.ok(!JSON.stringify(row.value).includes(CLOUD) && !JSON.stringify(row.value).includes(SITE), "anahtar satırda değil");

    const rows = await bell.asilposAnahtarBell(db, t0, ENV);
    assert.deepEqual(
      rows.map((x) => [x.kind, x.title, x.group]),
      [["warning", "Uzaktan yeni anahtarı kabul etmiyor", "sistem"]],
    );
    assert.match(rows[0].href, /^\/panel\/ayarlar\?sube=[a-z0-9-]+#asilpos$/);
    assert.ok(rows[0].id.startsWith("asilpos-anahtar-uzaktan-red-warning-"), rows[0].id);
    // Uzaktan önceki anahtarı tanıdığını hiç söylemedi (eski sürüm ya da bilinmiyor): adım uçtaki değeri değiştirtmez
    assert.match(rows[0].body, /1\) Uzaktan'daki değeri şimdi değiştirmeyin/);
    // Site 2xx verdi ama başlıksız (eski sürüm): önceki anahtarı tanımıyor
    assert.deepEqual((await mod.readAnahtarUyumu(db)).destek, { site: false });
  });

  test("aynı sorgu bir saat içinde yazılmaz, sınanmaz; kasa uygulayınca yeniden sınanmaz (saatte bir) ama uyarı kırmızıya döner", async () => {
    calls.length = 0;
    const t1 = new Date(t0.getTime() + 10 * 60_000);
    const same = await mod.noteBaglantiRaporu(db, "marina", { uygulanan: "eskisurum", guncel: SURUM }, { now: t1, env: ENV, fetchImpl: fakeFetch });
    assert.deepEqual(same, { yazildi: false, sinama: null });
    const applied = await mod.noteBaglantiRaporu(db, "marina", { uygulanan: SURUM, guncel: SURUM }, { now: t1, env: ENV, fetchImpl: fakeFetch });
    assert.deepEqual(applied, { yazildi: true, sinama: null }, "bu değerler bir saat içinde sınandı");
    assert.equal(calls.length, 0);
    const rows = await bell.asilposAnahtarBell(db, t1, ENV);
    assert.deepEqual(
      rows.map((x) => [x.kind, x.title]),
      [["danger", "Uzaktan'daki anahtar eski"]],
    );
    const kart = await mod.loadAnahtarUyumuKarti(db, t1, ENV);
    assert.deepEqual(kart?.kasalar, { uygulayan: ["marina"], bekleyen: [] });
    assert.deepEqual(
      kart?.hedefler.map((h) => [h.hedef, h.sonuc?.durum]),
      [
        ["uzaktan", "red"],
        ["site", "ok"],
      ],
    );
  });

  test("kasanın raporu değişmese de saatte bir sınanır: yalnız uç değiştiyse uyarı ertesi sabahı beklemez", async () => {
    // t0 + 61 dk: rapor 51 dk önce yazıldı (yeniden yazılmaz), son sınama 61 dk önce: Uzaktan düzeldi, uyarı kalkar
    // (önceden yalnız kasanın raporu değişince sınanıyordu: _ONCEKI erken silinse uyarı ertesi sabaha kalıyordu)
    calls.length = 0;
    answers = {};
    headers = { "uzaktan.ornek.test": "simdiki", "site.ornek.test": "simdiki" };
    const t2 = new Date(t0.getTime() + 61 * 60_000);
    const r = await mod.noteBaglantiRaporu(db, "marina", { uygulanan: SURUM, guncel: SURUM }, { now: t2, env: ENV, fetchImpl: fakeFetch });
    assert.equal(r.yazildi, false, "rapor değişmedi, bir saat dolmadı");
    assert.deepEqual(r.sinama?.sonuc, { uzaktan: { durum: "ok", http: 200, anahtar: "simdiki" }, site: { durum: "ok", http: 200, anahtar: "simdiki" } });
    assert.equal(calls.length, 2);
    assert.deepEqual(await bell.asilposAnahtarBell(db, t2, ENV), []);
    // Başlık görüldü: iki uç önceki anahtarı tanıyor (kart da söyler)
    assert.deepEqual((await mod.readAnahtarUyumu(db)).destek, { uzaktan: true, site: true });
    const kart = await mod.loadAnahtarUyumuKarti(db, t2, ENV);
    assert.deepEqual(kart?.hedefler.map((h) => h.notlar), [["önceki anahtarı da tanır"], ["önceki anahtarı da tanır"]]);

    // Sonraki sorgu (5 dk; rapor 56 dk önce yazıldı) ne yazılır ne yeniden sınanır
    calls.length = 0;
    const same = await mod.noteBaglantiRaporu(db, "marina", { uygulanan: SURUM, guncel: SURUM }, { now: new Date(t2.getTime() + 5 * 60_000), env: ENV, fetchImpl: fakeFetch });
    assert.deepEqual(same, { yazildi: false, sinama: null });
    assert.equal(calls.length, 0);
  });

  test("uç panelin anahtarını yalnız önceki değer olarak kabul ediyor: turuncu; bütün kasalar uyguladı, _ONCEKI duruyor: bilgi", async () => {
    headers = { "uzaktan.ornek.test": "onceki", "site.ornek.test": "simdiki" };
    const sinama = await mod.sinaAnahtarlar(db, { tetik: "elle", env: ENV, fetchImpl: fakeFetch });
    assert.deepEqual(sinama?.sonuc.uzaktan, { durum: "ok", http: 200, anahtar: "onceki" });
    const rows = await bell.asilposAnahtarBell(db, new Date(), ENV);
    assert.deepEqual(
      rows.map((x) => [x.kind, x.title]),
      [["warning", "Panelin Uzaktan anahtarı eski"]],
    );
    assert.ok(rows[0].body.includes(`${UZAK_ONCEKI_ENV}'yi silmeyin`), rows[0].body);
    // Panel güncellendi (Uzaktan şimdiki değeriyle kabul ediyor), kasalar uyguladı, Uzaktan'da _ONCEKI hâlâ tanımlı
    headers = { "uzaktan.ornek.test": "simdiki", "site.ornek.test": "simdiki" };
    health = { ok: true, remote: true, onceki: true };
    await mod.sinaAnahtarlar(db, { tetik: "elle", env: ENV, fetchImpl: fakeFetch });
    const bilgi = await bell.asilposAnahtarBell(db, new Date(), ENV);
    assert.deepEqual(
      bilgi.map((x) => [x.kind, x.title, x.group]),
      [["info", "Uzaktan'da önceki anahtar hâlâ tanımlı", "sistem"]],
    );
    health = { ok: true, remote: true, onceki: false };
    await mod.sinaAnahtarlar(db, { tetik: "elle", env: ENV, fetchImpl: fakeFetch });
    assert.deepEqual(await bell.asilposAnahtarBell(db, new Date(), ENV), []);
    headers = {};
    health = { ok: true, remote: true };
  });

  test("Uzaktan düzelince sınama geçer, uyarı kalkar; kasaların raporu korunur; değerler değişince eski sonuç sayılmaz", async () => {
    answers = {};
    const sinama = await mod.sinaAnahtarlar(db, { tetik: "elle", env: ENV, fetchImpl: fakeFetch });
    assert.deepEqual(sinama?.sonuc, { uzaktan: { durum: "ok", http: 200 }, site: { durum: "ok", http: 200 } });
    assert.deepEqual(await bell.asilposAnahtarBell(db, new Date(), ENV), []);
    assert.ok((await mod.readAnahtarUyumu(db)).kasalar.marina, "kasanın raporu sınamayla silinmez");
    // Başlıksız 2xx: uçlar eski sürüme döndü, destek bilgisi de döner (geri dönülen sürüm görülür)
    assert.deepEqual((await mod.readAnahtarUyumu(db)).destek, { uzaktan: false, site: false });
    // Panelde yeni değer: eski sınama geçersiz (uyarı da yok), kart "değerler değişti" der
    const yeni = { ...ENV, ASILPOS_CLOUD_SECRET: "y".repeat(44) };
    const kart = await mod.loadAnahtarUyumuKarti(db, new Date(), yeni);
    assert.deepEqual([kart?.sinama, kart?.eskiDegerlerle, kart?.kasalar.bekleyen], [null, true, ["marina"]]);
    // Dağıtılan uç yoksa sınama yok, kart yok
    assert.equal(await mod.sinaAnahtarlar(db, { tetik: "cron", env: {}, fetchImpl: fakeFetch }), null);
    assert.equal(await mod.loadAnahtarUyumuKarti(db, new Date(), {}), null);
    assert.deepEqual(await bell.asilposAnahtarBell(db, new Date(), {}), []);
  });
});
