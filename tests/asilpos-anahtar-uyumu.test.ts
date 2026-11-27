// Anahtar değişiminin uyumu (docs/ASILPOS.md › Şube kurulumu › Anahtar değişimi; src/lib/asilpos/anahtar-uyumu.ts,
// src/server/asilpos/anahtar-uyumu.ts): 26 Kasım 2026'da panel yeni anahtarları kasalara dağıttı, kasa gece uyguladı,
// Uzaktan ve site eskisini tutuyordu ve her istek reddedildi. Panel kendi değerini iki uçta, kasanın imzasıyla sınar;
// reddeden uç uyarı olur (kasa uyguladıysa kırmızı, bekliyorsa turuncu), adımlar değişkenlerin adını verir, değeri asla.
// İnceleme (27 Kasım): uç önceki anahtarı tanıdığını söylemediyse turuncu uyarı uçtaki değeri değiştirtmez (paneli
// eskiye döndürtür); uç panelin değerini yalnız önceki değer olarak kabul ediyorsa uyarı; kasa sorunca saatte bir sınanır.
// Veritabanıyla: tests/asilpos-anahtar-uyumu-db.test.ts.
// Çalıştırma: npx tsx --test tests/asilpos-anahtar-uyumu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  ANAHTAR_BASLIGI,
  anahtarEslesmesi,
  anahtarUyarilari,
  dagitilanHedefler,
  DESTEK_METNI,
  destekGuncelle,
  durumMetni,
  gecerliSinama,
  hedefNotlari,
  hedefUyumlu,
  kasalarinDurumu,
  kasaRaporuYazilsin,
  oncekiBayragi,
  otomatikSinamaGerekli,
  parseAnahtarUyumu,
  sinamaAdresi,
  sonucBirlestir,
  uyariGovdesi,
  yanitDurumu,
  type AnahtarUyumu,
  type Sinama,
} from "../src/lib/asilpos/anahtar-uyumu";
import { dagitilanBaglantilar } from "../src/lib/asilpos/baglanti-dagitim";
import { ESKI_ENV_ONEKI, KANAL_ALANI, SITE_KASA_ANAHTAR_ENV, SITE_KASA_ONCEKI_ENV, TEL_UZAK_ANAHTAR_ENV, UZAK_ONCEKI_ENV, UZAKTAN_PROJESI } from "../src/lib/asilpos/eski-adlar";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../src/lib/karaoke/signature";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const CLOUD = "c".repeat(44);
const SITE = "s".repeat(44);
const ENV = { ASILPOS_CLOUD_URL: `https://${KANAL_ALANI}/`, ASILPOS_CLOUD_SECRET: CLOUD, ASILPOS_SITE_URL: "https://laffogato.net", ASILPOS_SITE_SECRET: SITE };
const SURUM = dagitilanBaglantilar(ENV).surum;
const NOW = new Date("2026-11-27T09:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const sinama = (sonuc: Sinama["sonuc"], o: Partial<Sinama> = {}): Sinama => ({ at: ago(60_000), surum: SURUM, tetik: "cron", sonuc, ...o });
const state = (o: Partial<AnahtarUyumu> = {}): AnahtarUyumu => ({ kasalar: {}, sinama: null, destek: {}, ...o });

test("dağıtılan uçlar: adres ve en az 32 karakterlik anahtar; eski adlı değişkenler de; sınama adresi kasanınki gibi", () => {
  assert.deepEqual(dagitilanHedefler({}), []);
  assert.deepEqual(
    dagitilanHedefler(ENV).map((h) => h.hedef),
    ["uzaktan", "site"],
  );
  const E = ESKI_ENV_ONEKI;
  assert.deepEqual(dagitilanHedefler({ [`${E}CLOUD_URL`]: ENV.ASILPOS_CLOUD_URL, [`${E}CLOUD_SECRET`]: CLOUD }), [{ hedef: "uzaktan", url: ENV.ASILPOS_CLOUD_URL, secret: CLOUD }]);
  // Kısa anahtar dağıtılmaz (kurulumBaglantilari'nın koşulu): sınanmaz da
  assert.deepEqual(dagitilanHedefler({ ...ENV, ASILPOS_SITE_SECRET: "kisa" }).map((h) => h.hedef), ["uzaktan"]);
  assert.equal(sinamaAdresi("uzaktan", ENV.ASILPOS_CLOUD_URL).href, `https://${KANAL_ALANI}/api/uzaktan/anahtarlar`);
  assert.equal(sinamaAdresi("site", "https://laffogato.net").href, "https://laffogato.net/api/pos/orders/version");
});

test("yanıtın anlamı: 2xx kabul, 401 anahtar eski, 503 uçta anahtar yok, başkası sınanamadı", () => {
  assert.deepEqual([200, 204, 401, 503, 404, 500, 403].map(yanitDurumu), ["ok", "ok", "red", "kapali", "hata", "hata", "hata"]);
  assert.equal(durumMetni(null), "henüz sınanmadı");
  assert.equal(durumMetni({ durum: "hata", http: null }), "sınanamadı (ulaşılamadı)");
  assert.equal(durumMetni({ durum: "hata", http: 500 }), "sınanamadı (HTTP 500)");
});

test("kayıtlı değer: bozuk parça yok sayılır", () => {
  assert.deepEqual(parseAnahtarUyumu(null), state());
  const v = parseAnahtarUyumu({
    kasalar: { marina: { uygulanan: "a", guncel: "b", at: ago(0) }, bozuk: { uygulanan: 1 } },
    sinama: { at: ago(0), surum: SURUM, tetik: "kasa", sonuc: { uzaktan: { durum: "red", http: 401 }, site: { durum: "?" } } },
  });
  assert.deepEqual(Object.keys(v.kasalar), ["marina"]);
  assert.deepEqual(v.sinama?.sonuc, { uzaktan: { durum: "red", http: 401 }, site: undefined });
  assert.equal(parseAnahtarUyumu({ sinama: { at: 1 } }).sinama, null);
  // Başlığın ve açık durum ucunun alanları; bozuk alan yazılmamış gibi (eski kayıtta hiç yok)
  const yeni = parseAnahtarUyumu({
    sinama: {
      at: ago(0),
      surum: SURUM,
      tetik: "cron",
      sonuc: { uzaktan: { durum: "ok", http: 200, anahtar: "onceki", oncekiTanimli: true }, site: { durum: "ok", http: 200, anahtar: "?", oncekiTanimli: "evet" } },
    },
    destek: { uzaktan: true, site: "?", baska: true },
  });
  assert.deepEqual(yeni.sinama?.sonuc, { uzaktan: { durum: "ok", http: 200, anahtar: "onceki", oncekiTanimli: true }, site: { durum: "ok", http: 200 } });
  assert.deepEqual(yeni.destek, { uzaktan: true });
});

test("başlık ve bayrak: şimdiki / önceki eşleşme; önceki değer olarak kabul uyumlu sayılmaz; destek her 2xx ile yenilenir", () => {
  assert.equal(ANAHTAR_BASLIGI, "x-laf-anahtar");
  assert.deepEqual(["simdiki", " ONCEKI ", "", null, "evet"].map(anahtarEslesmesi), ["simdiki", "onceki", null, null, null]);
  assert.deepEqual([{ onceki: true }, { onceki: false }, { ok: true }, { onceki: "true" }, null, "x"].map(oncekiBayragi), [true, false, null, null, null, null]);
  assert.equal(hedefUyumlu({ durum: "ok", http: 200 }), true, "başlıksız (eski sürüm) 2xx kabul");
  assert.equal(hedefUyumlu({ durum: "ok", http: 200, anahtar: "simdiki" }), true);
  assert.equal(hedefUyumlu({ durum: "ok", http: 200, anahtar: "onceki" }), false, "yalnız önceki değer olarak kabul");
  assert.equal(hedefUyumlu({ durum: "red", http: 401 }), false);
  assert.equal(hedefUyumlu(null), false);
  assert.equal(durumMetni({ durum: "ok", http: 200, anahtar: "onceki" }), "panelin anahtarını yalnız önceki değer olarak kabul ediyor");
  // 2xx veren uçta başlık varsa destek var, yoksa (eski sürüm; geri dönülen sürüm de) yok; ret ve ağ hatası eski bilgiyi bırakır
  assert.deepEqual(destekGuncelle({}, { uzaktan: { durum: "ok", http: 200, anahtar: "simdiki" }, site: { durum: "ok", http: 200 } }), { uzaktan: true, site: false });
  assert.deepEqual(destekGuncelle({ uzaktan: true, site: true }, { uzaktan: { durum: "red", http: 401 }, site: { durum: "hata", http: null } }), { uzaktan: true, site: true });
  assert.deepEqual(destekGuncelle({ uzaktan: true }, { uzaktan: { durum: "ok", http: 200 } }), { uzaktan: false });
  // Kartın notları
  assert.deepEqual(hedefNotlari(null, undefined), []);
  assert.deepEqual(hedefNotlari({ durum: "ok", http: 200, oncekiTanimli: true }, true), [DESTEK_METNI, "önceki anahtar tanımlı"]);
  assert.deepEqual(hedefNotlari(null, false), ["önceki anahtarı tanımıyor (eski sürüm)"]);
});

test("kasaların durumu: güncel değeri uygulayan, bekleyen; üç günden eski rapor sayılmaz", () => {
  const s = state({
    kasalar: {
      tuzla: { uygulanan: "eski", guncel: SURUM, at: ago(600_000) },
      marina: { uygulanan: SURUM, guncel: SURUM, at: ago(600_000) },
      kadikoy: { uygulanan: SURUM, guncel: SURUM, at: ago(4 * 86_400_000) },
    },
  });
  assert.deepEqual(kasalarinDurumu(s, SURUM, NOW), { uygulayan: ["marina"], bekleyen: ["tuzla"] });
});

test("kasanın raporu: değişince ya da saatte bir yazılır; kasa sorunca, bu değerler bir saatte sınanmadıysa sınanır", () => {
  const r = { uygulanan: "a", guncel: "b" };
  assert.deepEqual(kasaRaporuYazilsin(undefined, r, NOW), { yaz: true, degisti: true });
  assert.deepEqual(kasaRaporuYazilsin({ ...r, at: ago(600_000) }, r, NOW), { yaz: false, degisti: false });
  assert.deepEqual(kasaRaporuYazilsin({ ...r, at: ago(3_600_000) }, r, NOW), { yaz: true, degisti: false });
  assert.deepEqual(kasaRaporuYazilsin({ ...r, at: ago(600_000) }, { ...r, uygulanan: "b" }, NOW), { yaz: true, degisti: true });
  assert.deepEqual(kasaRaporuYazilsin({ ...r, at: ago(600_000) }, { ...r, guncel: "c" }, NOW), { yaz: true, degisti: true });

  assert.equal(otomatikSinamaGerekli(state(), "", NOW), false, "değer dağıtılmıyor");
  assert.equal(otomatikSinamaGerekli(state(), SURUM, NOW), true, "hiç sınanmadı");
  assert.equal(otomatikSinamaGerekli(state({ sinama: sinama({}, { at: ago(10 * 60_000) }) }), SURUM, NOW), false, "bu değerler az önce sınandı");
  assert.equal(otomatikSinamaGerekli(state({ sinama: sinama({}, { at: ago(61 * 60_000) }) }), SURUM, NOW), true, "bir saatten eski");
  assert.equal(otomatikSinamaGerekli(state({ sinama: sinama({}, { surum: "eski" }) }), SURUM, NOW), true, "değerler değişti");
  assert.equal(gecerliSinama(state({ sinama: sinama({}, { surum: "eski" }) }), SURUM), null);
});

test("uyarı: kasa yeni değeri uyguladıysa kırmızı 'Uzaktan'daki anahtar eski', adımlar değişken adlarıyla, değer yok", () => {
  const s = state({
    kasalar: { marina: { uygulanan: SURUM, guncel: SURUM, at: ago(600_000) } },
    sinama: sinama({ uzaktan: { durum: "red", http: 401 }, site: { durum: "ok", http: 200 } }),
  });
  const u = anahtarUyarilari({ state: s, surum: SURUM, now: NOW, env: ENV });
  assert.equal(u.length, 1);
  assert.deepEqual([u[0].hedef, u[0].kind, u[0].title], ["uzaktan", "danger", "Uzaktan'daki anahtar eski"]);
  assert.match(u[0].text, /reddediyor/);
  const steps = u[0].steps.join("\n");
  for (const ad of [UZAKTAN_PROJESI, TEL_UZAK_ANAHTAR_ENV, UZAK_ONCEKI_ENV, "ASILPOS_CLOUD_SECRET", "Redeploy", "Anahtarları sına"]) assert.ok(steps.includes(ad), ad);
  // Panelde değerin okunduğu ad: eski adla duruyorsa eski ad
  const E = ESKI_ENV_ONEKI;
  const eskiEnv = { [`${E}CLOUD_URL`]: ENV.ASILPOS_CLOUD_URL, [`${E}CLOUD_SECRET`]: CLOUD, [`${E}SITE_URL`]: ENV.ASILPOS_SITE_URL, [`${E}SITE_SECRET`]: SITE };
  assert.ok(anahtarUyarilari({ state: s, surum: SURUM, now: NOW, env: eskiEnv })[0].steps[0].includes(`${E}CLOUD_SECRET`));
  // Anahtarın değeri hiçbir metinde yok
  const all = JSON.stringify(u) + uyariGovdesi(u[0]);
  assert.ok(!all.includes(CLOUD) && !all.includes(SITE), "anahtar metne girmez");
  assert.match(uyariGovdesi(u[0]), /^Kasa panelin anahtarını kullanıyor.* 1\) Panelin değeri: .* 2\) /);
});

test("uyarı: kasa yalnız bekliyorsa turuncu, gün kapanmadan; site anahtarsızsa (503) 'tanımlı değil'", () => {
  const s = state({
    kasalar: { marina: { uygulanan: "eski", guncel: SURUM, at: ago(600_000) } },
    sinama: sinama({ uzaktan: { durum: "red", http: 401 }, site: { durum: "kapali", http: 503 } }),
  });
  const u = anahtarUyarilari({ state: s, surum: SURUM, now: NOW, env: ENV });
  assert.deepEqual(
    u.map((x) => [x.hedef, x.kind, x.title]),
    [
      ["uzaktan", "warning", "Uzaktan yeni anahtarı kabul etmiyor"],
      ["site", "warning", "Sitede kasa anahtarı tanımlı değil"],
    ],
  );
  assert.match(u[0].text, /gün kapanınca.*Gün kapanmadan düzeltin/);
  const site = u[1].steps.join("\n");
  assert.ok(site.includes(SITE_KASA_ANAHTAR_ENV) && site.includes("laffogato projesi") && site.includes("KARAOKE_SYNC_SECRET"), site);
  // Site reddederse (site önceki anahtarı tanıyorsa) önceki değer sitenin _ONCEKI değişkenine
  const red = anahtarUyarilari({ state: { ...s, destek: { site: true }, sinama: sinama({ site: { durum: "red", http: 401 } }) }, surum: SURUM, now: NOW, env: ENV });
  assert.ok(red[0].steps.join("\n").includes(`${SITE_KASA_ONCEKI_ENV} adıyla`), red[0].steps.join("\n"));
  // Hiç kasa raporu yoksa (bilinmiyor) kırmızı
  assert.equal(anahtarUyarilari({ state: { ...s, kasalar: {} }, surum: SURUM, now: NOW, env: ENV })[0].kind, "danger");
});

test("turuncu uyarı: uç önceki anahtarı tanıdığını söylemediyse uçtaki değer değişmez, panel eskiye döner (bekleyen kasa kesilmez)", () => {
  // Panel önce yayına çıktı ya da uç eski sürümde: perşembenin aynısı olmasın (inceleme 27 Kasım, 1. sorun)
  const bekliyor = state({
    kasalar: { marina: { uygulanan: "eski", guncel: SURUM, at: ago(600_000) } },
    sinama: sinama({ uzaktan: { durum: "red", http: 401 }, site: { durum: "red", http: 401 } }),
  });
  for (const destek of [{}, { uzaktan: false, site: false }]) {
    const u = anahtarUyarilari({ state: { ...bekliyor, destek }, surum: SURUM, now: NOW, env: ENV });
    assert.deepEqual(
      u.map((x) => [x.hedef, x.kind, x.title]),
      [
        ["uzaktan", "warning", "Uzaktan yeni anahtarı kabul etmiyor"],
        ["site", "warning", "Site yeni anahtarı kabul etmiyor"],
      ],
    );
    for (const x of u) {
      const steps = x.steps.join("\n");
      assert.match(x.steps[0], /değeri şimdi değiştirmeyin/);
      assert.match(steps, /Paneldeki değeri eskisine/);
      assert.match(steps, /gün kapanmadan/);
      assert.ok(steps.includes(DESTEK_METNI), "yeni anahtara ne zaman geçileceği");
      assert.ok(!steps.includes("değişkenine panelin değerini yazın"), `uçtaki değer değişmez: ${steps}`);
    }
    assert.ok(u[0].steps[1].includes("ASILPOS_CLOUD_SECRET") && u[1].steps[1].includes("ASILPOS_SITE_SECRET"), "panelde değerin okunduğu ad");
  }
  // Uç önceki anahtarı tanıyorsa (başlığı görüldü) iki anahtarlı geçiş: önceki değer _ONCEKI'ye, panelinki asıl değişkene
  const u = anahtarUyarilari({ state: { ...bekliyor, destek: { uzaktan: true, site: true } }, surum: SURUM, now: NOW, env: ENV });
  const uzak = u[0].steps.join("\n");
  assert.ok(uzak.includes(`${UZAK_ONCEKI_ENV} adıyla`) && uzak.includes("değişkenine panelin değerini yazın"), uzak);
  assert.match(uzak, /henüz yeni değere geçmemiş kasa çalışmaya devam eder/);
  // Önceki bir değişimden kalan yeni adlı _ONCEKI eski adlıyı gölgelemesin (Uzaktan yeni adı önce okur)
  assert.ok(uzak.includes("ASILPOS_CLOUD_SECRET_ONCEKI varsa silin"), uzak);
  assert.match(uzak, /Bütün kasalar güncel değerleri uygulayınca .*_ONCEKI'yi silin/);
  // Kırmızıda kasa zaten yeni değerde: uçtaki değer panelinkine geçer (destek bilinmese de), önceki değer koşullu
  const kirmizi = anahtarUyarilari({ state: { ...bekliyor, kasalar: { marina: { uygulanan: SURUM, guncel: SURUM, at: ago(600_000) } } }, surum: SURUM, now: NOW, env: ENV });
  const k = kirmizi[0].steps.join("\n");
  assert.equal(kirmizi[0].kind, "danger");
  assert.ok(k.includes("değişkenine panelin değerini yazın") && k.includes("Uzaktan önceki anahtarı tanıyorsa"), k);
});

test("uç panelin anahtarını yalnız önceki değer olarak kabul ediyor: turuncu 'panelin anahtarı eski', _ONCEKI silinmesin", () => {
  // Sahip Uzaktan'ı değiştirdi, paneli unuttu: kasalar 'güncel değerleri uyguladı' der (panel değişmedi), sınama 2xx.
  // Başlık 'onceki' derse uyarı (inceleme 27 Kasım, 3. sorun)
  const s = state({
    kasalar: { marina: { uygulanan: SURUM, guncel: SURUM, at: ago(600_000) } },
    destek: { uzaktan: true, site: true },
    sinama: sinama({ uzaktan: { durum: "ok", http: 200, anahtar: "onceki" }, site: { durum: "ok", http: 200, anahtar: "simdiki" } }),
  });
  const u = anahtarUyarilari({ state: s, surum: SURUM, now: NOW, env: ENV });
  assert.deepEqual(
    u.map((x) => [x.hedef, x.durum, x.kind, x.title]),
    [["uzaktan", "onceki", "warning", "Panelin Uzaktan anahtarı eski"]],
  );
  assert.match(u[0].text, /yalnız önceki değer .*Önce paneli güncelleyin/);
  const steps = u[0].steps.join("\n");
  assert.ok(steps.includes("ASILPOS_CLOUD_SECRET") && steps.includes(`${UZAK_ONCEKI_ENV}'yi silmeyin`), steps);
  assert.ok(!JSON.stringify(u).includes(CLOUD), "anahtar metne girmez");
});

test("bütün kasalar uyguladığı hâlde Uzaktan'da önceki anahtar tanımlı: silmeyi hatırlatır (bilgi); bekleyen kasa varken değil", () => {
  const s = state({
    kasalar: { marina: { uygulanan: SURUM, guncel: SURUM, at: ago(600_000) } },
    sinama: sinama({ uzaktan: { durum: "ok", http: 200, anahtar: "simdiki", oncekiTanimli: true }, site: { durum: "ok", http: 200 } }),
  });
  const u = anahtarUyarilari({ state: s, surum: SURUM, now: NOW, env: ENV });
  assert.deepEqual(
    u.map((x) => [x.hedef, x.durum, x.kind, x.title]),
    [["uzaktan", "oncekiKaldi", "info", "Uzaktan'da önceki anahtar hâlâ tanımlı"]],
  );
  assert.ok(u[0].steps[0].includes(`${UZAK_ONCEKI_ENV}'yi`) && u[0].steps[0].includes("ASILPOS_CLOUD_SECRET_ONCEKI"), u[0].steps[0]);
  // Bekleyen kasa önceki anahtarla bağlanıyor: hatırlatma yok
  const bekleyen = { ...s, kasalar: { ...s.kasalar, tuzla: { uygulanan: "eski", guncel: SURUM, at: ago(600_000) } } };
  assert.deepEqual(anahtarUyarilari({ state: bekleyen, surum: SURUM, now: NOW, env: ENV }), []);
  // Kasa raporu yoksa (bilinmiyor) da yok; bayrak false ya da bilinmiyorsa yok
  assert.deepEqual(anahtarUyarilari({ state: { ...s, kasalar: {} }, surum: SURUM, now: NOW, env: ENV }), []);
  const yok = { ...s, sinama: sinama({ uzaktan: { durum: "ok", http: 200, anahtar: "simdiki", oncekiTanimli: false } }) };
  assert.deepEqual(anahtarUyarilari({ state: yok, surum: SURUM, now: NOW, env: ENV }), []);
});

test("geçici ağ hatası uyarıyı kaldırmaz: aynı değerlerin önceki red / kapalı sonucu kalır; kabul ya da yeni değerler kalmaz", () => {
  const onceki = sinama({ uzaktan: { durum: "red", http: 401 }, site: { durum: "ok", http: 200 } }, { at: ago(3_600_000) });
  const yeni = sinama({ uzaktan: { durum: "hata", http: null }, site: { durum: "hata", http: 502 } }, { at: ago(0), tetik: "elle" });
  assert.deepEqual(sonucBirlestir(onceki, yeni), { ...yeni, sonuc: { uzaktan: { durum: "red", http: 401 }, site: { durum: "hata", http: 502 } } });
  assert.deepEqual(sonucBirlestir(onceki, { ...yeni, surum: "baska" }), { ...yeni, surum: "baska" });
  const gecti = sinama({ uzaktan: { durum: "ok", http: 200 } });
  assert.deepEqual(sonucBirlestir(onceki, gecti), gecti);
  // "Yalnız önceki değer olarak kabul" de gerçek uyarı: ağ hatası kaldırmaz; şimdiki değerle kabul kalmaz
  const oncekiDeger = sinama({ uzaktan: { durum: "ok", http: 200, anahtar: "onceki" } }, { at: ago(3_600_000) });
  assert.deepEqual(sonucBirlestir(oncekiDeger, yeni).sonuc.uzaktan, { durum: "ok", http: 200, anahtar: "onceki" });
  assert.deepEqual(sonucBirlestir(sinama({ uzaktan: { durum: "ok", http: 200, anahtar: "simdiki" } }), yeni).sonuc.uzaktan, { durum: "hata", http: null });
  assert.deepEqual(sonucBirlestir(null, yeni), yeni);
});

test("uyarı yok: uçlar kabul ediyor, sınanamadı (ağ), sınanmadı ya da değerler sınamadan sonra değişti", () => {
  const ok = state({ sinama: sinama({ uzaktan: { durum: "ok", http: 200 }, site: { durum: "hata", http: null } }) });
  assert.deepEqual(anahtarUyarilari({ state: ok, surum: SURUM, now: NOW, env: ENV }), []);
  assert.deepEqual(anahtarUyarilari({ state: state(), surum: SURUM, now: NOW, env: ENV }), []);
  const eski = state({ sinama: sinama({ uzaktan: { durum: "red", http: 401 } }, { surum: "eski" }) });
  assert.deepEqual(anahtarUyarilari({ state: eski, surum: SURUM, now: NOW, env: ENV }), []);
});

test("sınama: kasanın imzasıyla (karşı taraf doğrular), gövde okunmaz; 401 red, ağ hatası 'hata'", async () => {
  // "server-only" Next'in sunucu derlemesi dışında hata fırlatır
  const require = createRequire(import.meta.url);
  const p = require.resolve("server-only");
  require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
  const { sinaHedef } = await import("../src/server/asilpos/anahtar-uyumu");
  const seen: { url: string; headers: Record<string, string> | undefined }[] = [];
  /** İmzalı uç `status` ve başlık; Uzaktan'ın açık durum ucu `health` gövdesi (null: 404) */
  const fake = (status: number, o: { baslik?: string; health?: unknown } = {}) =>
    (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, headers: init?.headers as Record<string, string> | undefined });
      if (url.endsWith("/api/health")) return o.health === undefined || o.health === null ? new Response("yok", { status: 404 }) : Response.json(o.health);
      return new Response(JSON.stringify({ anahtarlar: {} }), { status, headers: o.baslik ? { [ANAHTAR_BASLIGI]: o.baslik } : {} });
    }) as typeof fetch;
  const now = new Date();
  const h = { hedef: "uzaktan" as const, url: ENV.ASILPOS_CLOUD_URL, secret: CLOUD };
  assert.deepEqual(await sinaHedef(h, fake(200), now), { durum: "ok", http: 200 });
  assert.deepEqual(await sinaHedef(h, fake(401), now), { durum: "red", http: 401 });
  const site = { ...h, hedef: "site" as const, url: "https://laffogato.net", secret: SITE };
  assert.deepEqual(await sinaHedef(site, fake(503), now), { durum: "kapali", http: 503 });
  assert.deepEqual(
    await sinaHedef(h, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch),
    { durum: "hata", http: null },
  );
  // Uç (Uzaktan api/uzaktan.ts verifyPush, sitenin signedCaller'ı) imzayı aynı kuralla doğrular
  const first = seen[0];
  assert.equal(first.url, `https://${KANAL_ALANI}/api/uzaktan/anahtarlar`);
  assert.ok(
    verifySignature(CLOUD, { method: "GET", url: new URL(first.url), body: "", timestamp: first.headers?.[TIMESTAMP_HEADER] ?? null, signature: first.headers?.[SIGNATURE_HEADER] ?? null, now: now.getTime() }),
    "imza Uzaktan'ın anahtarıyla doğrulanır",
  );
  // Uzaktan'da açık durum ucu da (imzasız), sitede yalnız imzalı uç
  assert.equal(seen[1].url, `https://${KANAL_ALANI}/api/health`);
  assert.equal(seen[1].headers?.[SIGNATURE_HEADER], undefined, "açık durum ucuna imza gitmez");
  const siteUrls = seen.filter((x) => new URL(x.url).origin === "https://laffogato.net").map((x) => x.url);
  assert.deepEqual(siteUrls, ["https://laffogato.net/api/pos/orders/version"]);
  // İstek anahtarı taşımaz (yalnız imzası)
  assert.ok(!JSON.stringify(seen).includes(CLOUD) && !JSON.stringify(seen).includes(SITE), "anahtar istekte değil");

  // Yeni sürüm: 2xx yanıtta panelin anahtarı hangi değerle tuttu; açık durum ucu _ONCEKI tanımlı mı
  assert.deepEqual(await sinaHedef(h, fake(200, { baslik: "simdiki", health: { ok: true, onceki: true } }), now), { durum: "ok", http: 200, anahtar: "simdiki", oncekiTanimli: true });
  assert.deepEqual(await sinaHedef(h, fake(200, { baslik: "onceki", health: { ok: true, onceki: false } }), now), { durum: "ok", http: 200, anahtar: "onceki", oncekiTanimli: false });
  assert.deepEqual(await sinaHedef(site, fake(200, { baslik: "simdiki" }), now), { durum: "ok", http: 200, anahtar: "simdiki" });
  // Ret yanıtındaki başlık sayılmaz; açık durum ucu eski sürümde alansız ya da yok: bilinmiyor
  assert.deepEqual(await sinaHedef(h, fake(401, { baslik: "simdiki", health: { ok: true } }), now), { durum: "red", http: 401 });
  assert.deepEqual(await sinaHedef(h, fake(200, { baslik: "baska", health: null }), now), { durum: "ok", http: 200 });
});

test("bağlantılar: kasanın sorgusu yanıttan sonra yazılır (raporu değişmese de saatte bir sınanır); sabah işi sınar; zil ve Ayarlar uyarıyı gösterir", () => {
  const server = read("src/server/asilpos/anahtar-uyumu.ts");
  assert.doesNotMatch(server, /!degisti/, "yalnız kasanın raporu değişince sınanmaz (inceleme 27 Kasım, 2. sorun)");
  const route = read("src/app/api/panel/pos/baglanti/route.ts");
  assert.match(route, /after\(\(\) => noteBaglantiRaporu\(getDb\(\), branchId, \{ uygulanan, guncel: out\.surum \}\)\)/);
  assert.match(read("src/app/api/cron/gunluk/route.ts"), /sinaAnahtarlar\(getDb\(\), \{ tetik: "cron" \}\)/);
  assert.match(read("src/server/actions/notifications.ts"), /safe\("asilpos", asilposAnahtarBell\(\)\)/);
  const card = read("src/app/panel/ayarlar/asilpos-card.tsx");
  assert.match(card, /<KeySection data=\{keys\}/);
  assert.match(read("src/server/actions/asilpos.ts"), /export async function testAsilposKeys\(\)[\s\S]*requireAdmin\(\)/);
});
