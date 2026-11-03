// ModPOS (Gafdigi) kasa föyü çekirdeği, veritabanısız (docs/MODPOS-API.md; kitapçık docs/modpos-kasa-foyu-api.md):
// XML'in okunması ve doğrulanması (src/lib/modpos/foy.ts; kişisel adlar okunmaz, yarıda kesilmiş gövde reddedilir),
// ödeme kodlarının formun alanlarına eşlenmesi ve Z özeti (z.ts), anahtar / kota / hata metinleri (request.ts), hangi
// günün çekileceği (plan.ts), bağlantı durumu ve Ayarlar kartının özeti (status.ts), rapor ↔ föy karşılaştırması
// (compare.ts), sahte fetch'le istemci (src/server/modpos/client.ts) ve komut satırı betiği (scripts/modpos-foy.ts).
// Fikstürler tests/fixtures/modpos/: kitapçığın örneği ve kitapçığın öğe yapısına göre elle yazılmış uç durumlar
// (kafenin verisi değil). Anahtar sahtedir; ağa çıkılmaz.
// Çalıştırma: npx tsx --test tests/modpos-foy.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { before, describe, test } from "node:test";

import { FOY_MAX_BYTES, isFoyDay, MODPOS_DAYANAK, MODPOS_UYARI, parseKasaFoyu, type FoyOdeme, type KasaFoyu } from "../src/lib/modpos/foy";
import { modposCompare, modposDiffs, modposDiffsLine, modposDiffText, type ModposSavedFields } from "../src/lib/modpos/compare";
import { missingFoyDays, planFoyDays, type StoredDay } from "../src/lib/modpos/plan";
import {
  foyUrl,
  isKeyError,
  modposErrorText,
  modposKeyFrom,
  modposKeyProblem,
  modposSyncFrom,
  modposUrlFrom,
  MODPOS_DAILY_QUOTA,
  MODPOS_DEFAULT_FROM,
  MODPOS_DEFAULT_URL,
  quotaFromHeaders,
  quotaLeft,
  quotaRenewsAt,
  renewText,
  requestableDay,
  type ModposQuota,
} from "../src/lib/modpos/request";
import {
  modposCardSummary,
  modposDayText,
  MODPOS_RUNS_KEEP,
  parseModposState,
  readModposFallback,
  runDaysText,
  timeText,
  withRun,
  type ModposCardInput,
  type ModposRun,
  type ModposState,
} from "../src/lib/modpos/status";
import {
  finalAfter,
  foyWarnings,
  foyZ,
  isFinalFoy,
  KNOWN_CODES,
  modposBucket,
  modposChannels,
  sheetCanonical,
  sheetPrevious,
  sheetState,
  type ModposBucket,
} from "../src/lib/modpos/z";
import { todayTR } from "../src/lib/reminders";
import { foySummaryLines, parseFoyArgs, runModposFoy } from "../scripts/modpos-foy";

const FIX = join(__dirname, "fixtures", "modpos");
const xml = (name: string) => readFileSync(join(FIX, `${name}.xml`), "utf8");
function foyOf(name: string): KasaFoyu {
  const r = parseKasaFoyu(xml(name));
  assert.ok(r.ok, `${name}: ${JSON.stringify(r)}`);
  return r.foy;
}
/** Bozuk gövdenin alan yolu (föy ya da hata dönerse test düşer) */
function bozuk(body: string, istenen?: string): string {
  const r = parseKasaFoyu(body, istenen);
  assert.ok(!r.ok && "bozuk" in r, JSON.stringify(r).slice(0, 300));
  return r.bozuk;
}
/** dayMonthTR ve money() bölünmez boşluk kullanır */
const plain = (v: string) => v.replace(/[\u00a0\u202f]/g, " ");
const BOOKLET = readFileSync(join(process.cwd(), "docs/modpos-kasa-foyu-api.md"), "utf8");
const between = (from: string, to: string) => BOOKLET.slice(BOOKLET.indexOf(from), BOOKLET.indexOf(to));
const codesIn = (text: string) => [...new Set([...text.matchAll(/`([A-Z][A-Z_]+)`/g)].map((m) => m[1]))].sort();
/** Sahte anahtar (gerçeği hiçbir dosyaya yazılmaz) */
const KEY = "sk_test_0123456789abcdef0123456789abcdef";
const ENV = { MODPOS_API_KEY: KEY };

// ---------------------------------------------------------------- foy.ts: XML → föy

describe("parseKasaFoyu: kitapçığın örneği", () => {
  test("örnek yanıtın her alanı panelin biçimine çevrilir (tutarlar sayı, boş öğe null, tekrar eden öğe dizi)", () => {
    const r = parseKasaFoyu(xml("belge-ornegi"), "2026-11-01");
    assert.deepEqual(r, {
      ok: true,
      foy: {
        kasaGunu: "2026-11-01",
        olusturulma: "2026-11-02T11:15:42+03:00",
        kasalar: [
          {
            sube: "Kadıköy Şube",
            kasaAdi: "KASA-1",
            gunNo: 312,
            zNo: "0312",
            durum: "KAPALI",
            otomatikKapandi: false,
            acilis: { zaman: "2026-11-01T09:42:10+03:00", nakit: 500 },
            kapanis: { zaman: "2026-11-02T00:58:03+03:00", nakit: 7820 },
            satis: { ciro: 28450.5, ciroDisi: 145, adisyonSayisi: 214, kisiSayisi: 301, bahsis: 120 },
            odemeler: [
              { yontem: "Nakit", kod: "NAKIT", ciroyaDahil: true, satis: 8210, cariTahsilat: 0, sistem: 8210, defter: 8190, fark: -20, kirilim: [] },
              {
                yontem: "Kredi Kartı",
                kod: "KREDI_KARTI",
                ciroyaDahil: true,
                satis: 16120.5,
                cariTahsilat: 1500,
                sistem: 17620.5,
                defter: 17620.5,
                fark: 0,
                kirilim: [
                  { ad: "Garanti BBVA", tutar: 9800 },
                  { ad: "Akbank", tutar: 6320.5 },
                ],
              },
              { yontem: "İkram", kod: "IKRAM", ciroyaDahil: false, satis: 145, cariTahsilat: 0, sistem: 145, defter: null, fark: null, kirilim: [] },
            ],
            defterGirildi: true,
            giderler: {
              toplam: 870,
              kalemler: [
                { kategori: "Market", aciklama: "Temizlik malzemesi", tutar: 320 },
                { kategori: "Personel", aciklama: "Yemek", tutar: 550 },
              ],
            },
            cariTahsilatlar: { toplam: 1500, nakit: 0, kalemler: [{ tutar: 1500, yontem: "Kredi Kartı", zaman: "2026-11-01T17:12:00+03:00" }] },
            nakitKasa: { dayanak: "Z_RAPORU", acilis: 500, nakitSatis: 8210, nakitCariTahsilat: 0, gider: 870, beklenen: 7840, sayilan: 7820, fark: -20 },
            araKasalar: [{ no: 1, zaman: "2026-11-01T15:00:00+03:00", ciro: 11200, nakit: 3400, adisyonSayisi: 88, gider: 320, beklenen: 3580, sayilan: 3580, fark: 0 }],
            notlar: { kapanis: null, fark: "Bozuk para eksiği" },
            uyarilar: [{ kod: "KASA_FARKI", mesaj: "Kasa farkı var", tutar: -20 }],
          },
        ],
        foysuzGunler: [],
        ozet: {
          kasaSayisi: 1,
          acikKasa: 0,
          kapaliKasa: 1,
          otomatikKapanan: 0,
          ciro: 28450.5,
          ciroDisi: 145,
          adisyonSayisi: 214,
          kisiSayisi: 301,
          bahsis: 120,
          gider: 870,
          cariTahsilat: 1500,
          kasaFarki: -20,
          odemeler: [
            { yontem: "Nakit", kod: "NAKIT", tutar: 8210 },
            { yontem: "Kredi Kartı", kod: "KREDI_KARTI", tutar: 16120.5 },
          ],
          foysuzGunSayisi: 0,
          foysuzCiro: 0,
        },
        kota: { gunlukHak: 2, kullanilan: 1, kalan: 1, yenilenme: "2026-11-03T00:00:00+03:00" },
      },
    });
  });

  test("kişisel adlar okunmaz: personel (açılış, kapanış, ara kasa) ve cari tahsilatın müşterisi (KVKK)", () => {
    for (const name of ["belge-ornegi", "acik-gun", "iki-kasa", "otomatik-kapanis", "bilinmeyen-kod"]) {
      const out = JSON.stringify(parseKasaFoyu(xml(name)));
      for (const who of ["Ayşe Yılmaz", "Mehmet Kaya", "Yıldız Lojistik", "Örnek Kasiyer", "Deneme Sorumlu", "Deneme Müşteri"]) {
        assert.ok(!out.includes(who), `${name}: ${who}`);
      }
      assert.doesNotMatch(out, /"personel"|"musteri"/, name);
    }
    // Kitapçığın örneğinde adlar gerçekten var (test boşa geçmesin)
    assert.match(xml("belge-ornegi"), /Ayşe Yılmaz[\s\S]*Mehmet Kaya[\s\S]*Yıldız Lojistik/);
  });

  test("istenen gün: aynıysa föy, başka günün föyü saklanmaz (kasaGunu)", () => {
    assert.equal(parseKasaFoyu(xml("belge-ornegi"), "2026-11-01").ok, true);
    assert.equal(bozuk(xml("belge-ornegi"), "2026-11-02"), "kasaGunu");
    assert.equal(bozuk(xml("belge-ornegi").replace("<kasaGunu>2026-11-01<", "<kasaGunu>2026-02-30<")), "kasaGunu", "takvimde olmayan gün");
    assert.equal(bozuk(xml("belge-ornegi").replace("<kasaGunu>2026-11-01<", "<kasaGunu>01.11.2026<")), "kasaGunu");
    assert.equal(bozuk(xml("belge-ornegi").replace("<kasaGunu>2026-11-01</kasaGunu>", "<kasaGunu/>")), "kasaGunu");
  });

  test("isFoyDay: takvimde olan, 2020'den sonraki YYYY-MM-DD", () => {
    for (const d of ["2026-11-01", "2028-02-29", "2020-01-01"]) assert.equal(isFoyDay(d), true, d);
    for (const d of ["2026-02-29", "2026-13-01", "2026-11-31", "2019-12-31", "2026-1-01", "20261101", " 2026-11-01"]) assert.equal(isFoyDay(d), false, d);
  });
});

describe("parseKasaFoyu: hata yanıtı", () => {
  test("hata-kota.xml: kod, mesaj, yenilenme ve günlük hak (istenen gün hatayı etkilemez)", () => {
    const expected = { ok: false, hata: { kod: "KOTA_DOLDU", mesaj: "Günlük kasa föyü çekim hakkı (2) doldu", yenilenme: "2026-11-03T00:00:00+03:00", gunlukHak: 2 } };
    assert.deepEqual(parseKasaFoyu(xml("hata-kota")), expected);
    assert.deepEqual(parseKasaFoyu(xml("hata-kota"), "2026-11-02"), expected);
  });

  test("ayrıntısız hata: yenilenme ve hak null; kodsuz hata BILINMIYOR; boş <hata/> bozuk", () => {
    assert.deepEqual(parseKasaFoyu("<hata><kod>anahtar_gecersiz</kod><mesaj>API anahtarı geçersiz</mesaj></hata>"), {
      ok: false,
      hata: { kod: "ANAHTAR_GECERSIZ", mesaj: "API anahtarı geçersiz", yenilenme: null, gunlukHak: null },
    });
    assert.deepEqual(parseKasaFoyu("<hata><mesaj>Bir şey oldu</mesaj></hata>"), { ok: false, hata: { kod: "BILINMIYOR", mesaj: "Bir şey oldu", yenilenme: null, gunlukHak: null } });
    assert.equal(bozuk("<hata/>"), "hata");
    assert.equal(bozuk("<hata><kod>KOTA_DOLDU</kod><ayrinti><gunlukHak>iki</gunlukHak></ayrinti></hata>"), "hata.ayrinti.gunlukHak");
  });
});

describe("parseKasaFoyu: güvenli ve katı okuma", () => {
  test("DOCTYPE / ENTITY taşıyan gövde hiç ayrıştırılmaz (genişleme saldırısı)", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><kasaFoyu><kasaGunu>2026-11-01</kasaGunu><x>&lol2;</x></kasaFoyu>`;
    assert.equal(bozuk(bomb), "govde");
    assert.equal(bozuk(xml("belge-ornegi").replace("<kasaFoyu>", '<!doctype kasaFoyu SYSTEM "file:///etc/passwd"><kasaFoyu>')), "govde");
    assert.equal(bozuk(xml("belge-ornegi").replace("<kasaFoyu>", '<kasaFoyu><!ENTITY x "y">')), "govde");
  });

  test("XML olmayan gövde: düz metin, JSON, boş gövde, HTML", () => {
    for (const b of ["hello", '{"kasaGunu":"2026-11-01"}', "", "   ", "<<<", "<kasaFoyu><kasa></kasaFoyu>", "<a>1</a><b>2</b>"]) assert.equal(bozuk(b), "govde", JSON.stringify(b));
    // İyi biçimli ama başka bir belge: kök yok
    assert.equal(bozuk("<html><body>Bakımdayız</body></html>"), "kasaFoyu");
    assert.equal(bozuk("<kasaFoyu/>"), "kasaFoyu");
    assert.equal(bozuk("<kasaFoyu>metin</kasaFoyu>"), "kasaFoyu");
  });

  test("yarıda kesilmiş gövde eksik föy diye okunmaz (ikinci ödemenin ortasında, özetten önce, kökün kapanışından önce)", () => {
    const full = xml("belge-ornegi");
    for (const cut of ["<yontem>Kredi Kartı</yontem>", "<defterGirildi>", "<ozet>", "</kasaFoyu>"]) {
      assert.equal(bozuk(full.slice(0, full.indexOf(cut)), "2026-11-01"), "govde", cut);
    }
  });

  test("baştaki BOM ve boşluk, sondaki satırlar ve CRLF hoş görülür", () => {
    const full = xml("belge-ornegi");
    for (const b of [`\uFEFF${full}`, `\n  ${full}`, `${full}\n\n`, full.replace(/\n/g, "\r\n"), full.replace(/^<\?xml[^>]*\?>\s*/, "")]) {
      const r = parseKasaFoyu(b, "2026-11-01");
      assert.ok(r.ok && r.foy.kasalar[0].odemeler.length === 3);
    }
  });

  test("büyük gövde (2 MB'tan uzun) okunmaz", () => {
    const pad = `<!-- ${"x".repeat(FOY_MAX_BYTES)} -->`;
    assert.equal(bozuk(xml("belge-ornegi").replace("<kasaFoyu>", `${pad}<kasaFoyu>`)), "govde");
  });

  test("ofsetsiz zaman reddedilir (güne yanlış düşer); Z ve ofsetli zaman geçer", () => {
    const full = xml("belge-ornegi");
    assert.equal(bozuk(full.replace("<zaman>2026-11-01T09:42:10+03:00</zaman>", "<zaman>2026-11-01T09:42:10</zaman>")), "kasa.0.acilis.zaman");
    assert.equal(bozuk(full.replace("<olusturulma>2026-11-02T11:15:42+03:00<", "<olusturulma>2 Kasım 11:15<")), "olusturulma");
    assert.equal(bozuk(full.replace("<zaman>2026-11-01T17:12:00+03:00</zaman>", "<zaman>2026-11-01 17:12</zaman>")), "kasa.0.cariTahsilatlar.tahsilat.0.zaman");
    assert.equal(bozuk(full.replace("<yenilenme>2026-11-03T00:00:00+03:00</yenilenme>", "<yenilenme>2026-11-03T00:00:00</yenilenme>")), "kota.yenilenme");
    assert.equal(bozuk(full.replace("<zaman>2026-11-01T15:00:00+03:00</zaman>", "<zaman>2026-11-01T25:00:00+03:00</zaman>")), "kasa.0.araKasa.0.zaman");
    const z = parseKasaFoyu(full.replace("<zaman>2026-11-01T09:42:10+03:00</zaman>", "<zaman>2026-11-01T06:42:10.5Z</zaman>"));
    assert.ok(z.ok);
    assert.equal(z.foy.kasalar[0].acilis.zaman, "2026-11-01T06:42:10.5Z");
  });

  test("biçimi bozuk tutar alanın yoluyla reddedilir: binlik ayırıcı, virgül, birim, 6'dan çok ondalık, 100 milyonun üstü", () => {
    const full = xml("belge-ornegi");
    assert.equal(bozuk(full.replace("<satis>8210</satis>", "<satis>1.234,50</satis>")), "kasa.0.odeme.0.satis");
    assert.equal(bozuk(full.replace("<satis>8210</satis>", "<satis>8210,5</satis>")), "kasa.0.odeme.0.satis");
    assert.equal(bozuk(full.replace("<satis>8210</satis>", "<satis>8210 TL</satis>")), "kasa.0.odeme.0.satis");
    assert.equal(bozuk(full.replace("<tutar>6320.5</tutar>", "<tutar>6320.1234567</tutar>")), "kasa.0.odeme.1.kirilim.1.tutar");
    assert.equal(bozuk(full.replace("<ciro>28450.5</ciro>", "<ciro>100000001</ciro>")), "kasa.0.satis.ciro");
    assert.equal(bozuk(full.replace("<ciroDisi>145</ciroDisi>", "<ciroDisi>-145</ciroDisi>")), "kasa.0.satis.ciroDisi", "ciro dışı eksi olamaz");
    assert.equal(bozuk(full.replace("<beklenen>7840</beklenen>", "<beklenen>1e4</beklenen>")), "kasa.0.nakitKasa.beklenen");
    assert.equal(bozuk(full.replace("<kasaFarki>-20</kasaFarki>", "<kasaFarki>−20</kasaFarki>")), "ozet.kasaFarki", "eksi işareti ASCII olmalı");
    assert.equal(bozuk(full.replace("<adisyonSayisi>214</adisyonSayisi>", "<adisyonSayisi>214.5</adisyonSayisi>")), "kasa.0.satis.adisyonSayisi");
    assert.equal(bozuk(full.replace("<defterGirildi>true</defterGirildi>", "<defterGirildi>evet</defterGirildi>")), "kasa.0.defterGirildi");
    assert.equal(bozuk(full.replace("<durum>KAPALI</durum>", "<durum>BEKLIYOR</durum>")), "kasa.0.durum");
    assert.equal(bozuk(full.replace(/<satis>\s*<ciro>[\s\S]*?<\/satis>/, "")), "kasa.0.satis", "satış zorunlu");
    // Eksi tutar (iade, fark) ve fazla ondalık yuvarlanır
    const r = parseKasaFoyu(full.replace("<fark>0</fark>", "<fark>-0.004</fark>").replace("<tutar>9800</tutar>", "<tutar>9800.006</tutar>"));
    assert.ok(r.ok);
    assert.equal(r.foy.kasalar[0].odemeler[1].fark, 0);
    assert.equal(r.foy.kasalar[0].odemeler[1].kirilim[0].tutar, 9800.01);
  });

  test("boş öğe null (ya da 0 / false / boş dizi): açık gün", () => {
    const f = foyOf("acik-gun");
    const k = f.kasalar[0];
    assert.equal(k.zNo, null);
    assert.equal(k.durum, "ACIK");
    assert.deepEqual(k.kapanis, { zaman: null, nakit: null }, "<kapanis/>");
    assert.equal(k.satis.kisiSayisi, null);
    assert.deepEqual(
      k.odemeler.map((o) => [o.kod, o.defter, o.fark]),
      [
        ["NAKIT", null, null],
        ["KREDI_KARTI", null, null],
        ["MULTINET", null, null],
      ],
    );
    assert.deepEqual(k.nakitKasa, { dayanak: "CANLI", acilis: 1000, nakitSatis: 2100, nakitCariTahsilat: 0, gider: 150, beklenen: 2950, sayilan: null, fark: null });
    assert.deepEqual(k.cariTahsilatlar, { toplam: 0, nakit: 0, kalemler: [] });
    assert.deepEqual(k.araKasalar, []);
    assert.deepEqual(k.notlar, { kapanis: null, fark: null });
    assert.equal(k.defterGirildi, false);
    assert.deepEqual(k.uyarilar, [
      { kod: "GUN_ACIK", mesaj: "Gün henüz kapanmadı", tutar: null },
      { kod: "DEFTER_GIRILMEMIS", mesaj: "Kasa defteri girilmemiş", tutar: null },
    ]);
    assert.equal(f.ozet?.kisiSayisi, null);
    assert.equal(f.ozet?.kasaFarki, null);
    assert.deepEqual(f.kota, { gunlukHak: 2, kullanilan: 2, kalan: 0, yenilenme: "2026-11-03T00:00:00+03:00" });
    // İç öğeleri boş kapanış da aynı
    const r = parseKasaFoyu(xml("acik-gun").replace("<kapanis/>", "<kapanis><zaman/><personel/><nakit/></kapanis>"));
    assert.ok(r.ok);
    assert.deepEqual(r.foy.kasalar[0].kapanis, { zaman: null, nakit: null });
    // Hiç gelmeyen öğe de: kasasız gün (satış yok)
    assert.deepEqual(parseKasaFoyu("<kasaFoyu><kasaGunu>2026-10-26</kasaGunu></kasaFoyu>"), {
      ok: true,
      foy: { kasaGunu: "2026-10-26", olusturulma: null, kasalar: [], foysuzGunler: [], ozet: null, kota: null },
    });
  });

  test("tanınmayan ödeme ve uyarı kodu olduğu gibi saklanır; kod büyük harfe, metnin boşlukları teke", () => {
    const f = foyOf("bilinmeyen-kod");
    assert.deepEqual(
      f.kasalar[0].odemeler.map((o) => [o.kod, o.yontem, o.ciroyaDahil, o.satis]),
      [
        ["NAKIT", "Nakit", true, 1000],
        ["KRIPTO_PARA", "Kripto Para", true, 250],
        ["PERSONEL_YEMEGI", "Personel Yemeği", false, 120],
        ["DIGER", "Diğer", true, 80],
      ],
    );
    const r = parseKasaFoyu(
      xml("belge-ornegi")
        .replace("<kod>NAKIT</kod>", "<kod>nakit</kod>")
        .replace("<yontem>Nakit</yontem>", "<yontem/>")
        .replace("<kod>KASA_FARKI</kod>", "<kod>yeni_uyari</kod>")
        .replace("<fark>Bozuk para eksiği</fark>", "<fark>  Bozuk   para\n   eksiği &amp; fazlası </fark>")
        .replace("<ad>Akbank</ad>", "<ad/>"),
    );
    assert.ok(r.ok);
    const k = r.foy.kasalar[0];
    assert.equal(k.odemeler[0].kod, "NAKIT");
    assert.equal(k.odemeler[0].yontem, "nakit", "yöntem adı yoksa kod");
    assert.equal(k.uyarilar[0].kod, "YENI_UYARI");
    assert.equal(k.notlar.fark, "Bozuk para eksiği & fazlası");
    assert.equal(k.odemeler[1].kirilim[1].ad, "Adsız");
  });

  test("kitapçığın uyarı ve dayanak kodları panelin listesinde (§5.4, §5.5)", () => {
    assert.deepEqual(codesIn(between("### 5.5", "### 5.6")), Object.keys(MODPOS_UYARI).sort());
    assert.deepEqual(codesIn(between("### 5.4", "### 5.5")), [...MODPOS_DAYANAK].sort());
  });
});

// ---------------------------------------------------------------- z.ts: eşleme ve Z özeti

/** Kitapçığın §6 tablosu → formun alanı (docs/MODPOS-API.md › Eşleme); DIGER ciroyaDahil'e bakar */
const EXPECTED_BUCKET: Record<string, ModposBucket | "ciroyaDahil"> = {
  NAKIT: "cash",
  KREDI_KARTI: "card",
  MOBIL_ODEME: "other",
  HAVALE: "other",
  YEMEK_KARTI: "mealCard",
  MULTINET: "mealCard",
  PLUXEE: "mealCard",
  SODEXO: "mealCard",
  SETCARD: "mealCard",
  EDENRED: "mealCard",
  TOKENFLEX: "mealCard",
  PAYE: "mealCard",
  METROPOL: "mealCard",
  ONLINE_WEB: "online",
  TRENDYOL_ONLINE: "online",
  YEMEK_SEPETI_ONLINE: "online",
  MIGROS_YEMEK_ONLINE: "online",
  GETIR_ONLINE: "online",
  CARI_HESAP: "other",
  FIYUU: "other",
  SADAKAT_PUANI: "other",
  IKRAM: "off",
  ODENMEZ: "off",
  HEDIYE_KARTI: "off",
  SADAKAT_IKRAMI: "off",
  DEGISIM_MAHSUBU: "off",
  ZAYI: "off",
  DIGER: "ciroyaDahil",
};

describe("z.ts: ödeme kodları ve Z özeti", () => {
  test("kitapçığın §6 tablosundaki her kod tanınır ve beklenen alana düşer (kod, ciroyaDahil'den önce gelir)", () => {
    assert.deepEqual(codesIn(between("## 6. ", "## 7. ")), Object.keys(EXPECTED_BUCKET).sort(), "kitapçığın tablosu ile beklenen eşleme aynı kodlar");
    assert.deepEqual([...KNOWN_CODES].sort(), Object.keys(EXPECTED_BUCKET).sort());
    for (const [kod, want] of Object.entries(EXPECTED_BUCKET)) {
      for (const ciroyaDahil of [true, false]) {
        const expected = want === "ciroyaDahil" ? (ciroyaDahil ? "other" : "off") : want;
        assert.equal(modposBucket({ kod, ciroyaDahil }), expected, `${kod} ciroyaDahil=${ciroyaDahil}`);
      }
    }
  });

  test("tanınmayan kod belgenin dediği gibi 'diğer': ciroya dahilse Diğer, değilse hiçbir alan", () => {
    assert.equal(modposBucket({ kod: "KRIPTO_PARA", ciroyaDahil: true }), "other");
    assert.equal(modposBucket({ kod: "PERSONEL_YEMEGI", ciroyaDahil: false }), "off");
    assert.equal(modposBucket({ kod: "", ciroyaDahil: true }), "other");
  });

  test("foyZ, kitapçığın örneği: tek kasa, Z no, sayım Z raporundan; örnek kendi içinde tutmuyor (ödemeler 24.330,50, ciro 28.450,50 → −4.120)", () => {
    assert.deepEqual(foyZ(foyOf("belge-ornegi")), {
      kasaGunu: "2026-11-01",
      kasaSayisi: 1,
      durum: "KAPALI",
      otomatikKapandi: false,
      zNo: "0312",
      receipts: 214,
      zTotal: 28450.5,
      cash: 8210,
      card: 16120.5,
      mealCard: 0,
      online: 0,
      other: 0,
      offRevenue: 145,
      openingCash: 500,
      cashOut: 870,
      cashIn: 0,
      countedCash: 7820,
      expectedCash: 7840,
      cashDiff: -20,
      cardCollections: 1500,
      tips: 120,
      covers: 301,
      noCount: null,
      paymentsGap: -4120,
      unknownCodes: [],
      foysuz: false,
      foysuzCiro: 0,
    });
  });

  test("foyZ, açık gün: sayım yok (CANLI), nedeni 'acik'; olması gereken bilinir, fark bilinmez; Z no yok", () => {
    const z = foyZ(foyOf("acik-gun"));
    assert.ok(z);
    assert.equal(z.durum, "ACIK");
    assert.equal(z.zNo, null);
    assert.equal(z.countedCash, null);
    assert.equal(z.noCount, "acik");
    assert.equal(z.expectedCash, 2950);
    assert.equal(z.cashDiff, null);
    assert.equal(z.covers, null, "kişi sayısı boş");
    assert.deepEqual([z.zTotal, z.cash, z.card, z.mealCard, z.online, z.other, z.paymentsGap], [6420.75, 2100, 3870.75, 450, 0, 0, 0]);
    assert.deepEqual([z.openingCash, z.cashOut, z.cashIn], [1000, 150, 0]);
  });

  test("foyZ, iki kasa: tutarlar toplanır, Z no yok (iki ayrı Z), sayım ikisi de Z raporundansa toplanır", () => {
    assert.deepEqual(foyZ(foyOf("iki-kasa")), {
      kasaGunu: "2026-10-31",
      kasaSayisi: 2,
      durum: "KAPALI",
      otomatikKapandi: false,
      zNo: null,
      receipts: 120,
      zTotal: 15500.5,
      cash: 5200.5,
      card: 7000,
      mealCard: 800,
      online: 2500,
      other: 0,
      offRevenue: 60,
      openingCash: 750,
      cashOut: 300,
      cashIn: 200,
      countedCash: 5840.5,
      expectedCash: 5850.5,
      cashDiff: -10,
      cardCollections: 0,
      tips: 50,
      covers: 160,
      noCount: null,
      paymentsGap: 0,
      unknownCodes: [],
      foysuz: false,
      foysuzCiro: 0,
    });
    // Kasalardan biri açıksa toplam sayım da yok, gün ACIK
    const f = foyOf("iki-kasa");
    const mixed: KasaFoyu = { ...f, kasalar: [f.kasalar[0], { ...f.kasalar[1], durum: "ACIK", nakitKasa: { ...f.kasalar[1].nakitKasa!, dayanak: "CANLI" } }] };
    const z = foyZ(mixed)!;
    assert.deepEqual([z.durum, z.countedCash, z.cashDiff, z.noCount, z.expectedCash], ["ACIK", null, null, "acik", 5850.5]);
  });

  test("foyZ, kendiliğinden kapanan gün: kapalı ama sayım yok ('otomatik'; sayılan defterdeki nakit, Z_RAPORU değil)", () => {
    const z = foyZ(foyOf("otomatik-kapanis"))!;
    assert.deepEqual(
      [z.durum, z.otomatikKapandi, z.zNo, z.countedCash, z.noCount, z.expectedCash, z.cashDiff, z.other, z.offRevenue, z.paymentsGap],
      ["KAPALI", true, "0098", null, "otomatik", 3030, null, 500, 30, 0],
    );
    // Yalnız dayanak OTOMATIK_KAPANIS da yeter (bayrak gelmese de)
    const f = foyOf("otomatik-kapanis");
    assert.equal(foyZ({ ...f, kasalar: [{ ...f.kasalar[0], otomatikKapandi: false }] })!.noCount, "otomatik");
    // Kapalı, Z'li ama nakit mutabakatı gelmemiş kasa: sayım yok, neden de yok; açılış kasanın açılış nakdinden
    const b = foyOf("belge-ornegi");
    const z2 = foyZ({ ...b, kasalar: [{ ...b.kasalar[0], nakitKasa: null }] })!;
    assert.deepEqual([z2.countedCash, z2.noCount, z2.expectedCash, z2.openingCash, z2.cashOut, z2.cashIn], [null, null, null, 500, 870, 0]);
  });

  test("foyZ, föysüz gün: kasasız Z, tutarlar föysüz satıştan (ikram ödeme değil), kasa alanları boş", () => {
    assert.deepEqual(foyZ(foyOf("foysuz-gun")), {
      kasaGunu: "2026-10-25",
      kasaSayisi: 0,
      durum: "KAPALI",
      otomatikKapandi: false,
      zNo: null,
      receipts: 6,
      zTotal: 840,
      cash: 340,
      card: 500,
      mealCard: 0,
      online: 0,
      other: 0,
      offRevenue: 40,
      openingCash: 0,
      cashOut: 0,
      cashIn: 0,
      countedCash: null,
      expectedCash: null,
      cashDiff: null,
      cardCollections: 0,
      tips: 0,
      covers: null,
      noCount: "foysuz",
      paymentsGap: 0,
      unknownCodes: [],
      foysuz: true,
      foysuzCiro: 840,
    });
    // Föysüz satışta tanınmayan kod Diğer'e (ciroyaDahil bilgisi yok) ve listeye
    const f = foyOf("foysuz-gun");
    const odd: KasaFoyu = { ...f, foysuzGunler: [{ ...f.foysuzGunler[0], ciro: 900, odemeler: [...f.foysuzGunler[0].odemeler, { yontem: "Kripto", kod: "KRIPTO_PARA", tutar: 60 }] }] };
    const z = foyZ(odd)!;
    assert.deepEqual([z.other, z.unknownCodes, z.paymentsGap], [60, ["KRIPTO_PARA"], 0]);
  });

  test("foyZ: kasa açıkken gelen föysüz satış (başka şube) toplamlara girmez, foysuzCiro'da görünür; satışsız gün null", () => {
    const withFoysuz: KasaFoyu = { ...foyOf("otomatik-kapanis"), foysuzGunler: foyOf("foysuz-gun").foysuzGunler };
    const z = foyZ(withFoysuz)!;
    assert.deepEqual([z.foysuz, z.foysuzCiro, z.zTotal, z.cash, z.receipts], [false, 840, 5230, 2230, 41]);
    assert.equal(foyZ({ kasaGunu: "2026-10-26", olusturulma: null, kasalar: [], foysuzGunler: [], ozet: null, kota: null }), null);
    assert.equal(foyZ({ kasaGunu: "2026-10-26", olusturulma: null, kasalar: [], foysuzGunler: [{ sube: "Ş", ciro: 0, adisyonSayisi: 0, odemeler: [] }], ozet: null, kota: null }), null);
    // Cirosu sıfır ama adisyonu olan föysüz gün (hepsi ikram) yine Z'dir
    assert.equal(foyZ({ kasaGunu: "2026-10-26", olusturulma: null, kasalar: [], foysuzGunler: [{ sube: "Ş", ciro: 0, adisyonSayisi: 2, odemeler: [] }], ozet: null, kota: null })?.receipts, 2);
  });

  test("foyZ, tanınmayan kodlar: ciroya dahil olan Diğer'e, olmayan hiçbir alana; ikisi de listede", () => {
    const z = foyZ(foyOf("bilinmeyen-kod"))!;
    assert.deepEqual([z.cash, z.other, z.offRevenue, z.zTotal, z.paymentsGap, z.zNo, z.countedCash], [1000, 330, 120, 1330, 0, "90", 1300]);
    assert.deepEqual(z.unknownCodes, ["KRIPTO_PARA", "PERSONEL_YEMEGI"]);
  });

  test("foyWarnings: kasaların uyarıları koduna göre tekilleşir, tutarları toplanır", () => {
    assert.deepEqual(foyWarnings(foyOf("iki-kasa")), [{ kod: "KASA_FARKI", mesaj: "Kasa farkı var", tutar: -10 }]);
    const f = foyOf("iki-kasa");
    const two: KasaFoyu = {
      ...f,
      kasalar: [
        { ...f.kasalar[0], uyarilar: [{ kod: "KASA_FARKI", mesaj: "Kasa farkı var", tutar: -5 }, { kod: "GUN_ACIK", mesaj: "Gün henüz kapanmadı", tutar: null }] },
        { ...f.kasalar[1], uyarilar: [{ kod: "KASA_FARKI", mesaj: "Kasa farkı var", tutar: -10.25 }, { kod: "GUN_ACIK", mesaj: "Gün henüz kapanmadı", tutar: null }] },
      ],
    };
    assert.deepEqual(foyWarnings(two), [
      { kod: "KASA_FARKI", mesaj: "Kasa farkı var", tutar: -15.25 },
      { kod: "GUN_ACIK", mesaj: "Gün henüz kapanmadı", tutar: null },
    ]);
  });

  test("modposChannels: kodu kanal olan yöntem; genel Yemek Kartı kırılımın adından, kalan kanalsız", () => {
    const pay = (kod: string, satis: number, o: Partial<FoyOdeme> = {}): FoyOdeme => ({ yontem: kod, kod, ciroyaDahil: true, satis, cariTahsilat: 0, sistem: satis, defter: null, fark: null, kirilim: [], ...o });
    const direct: [string, string | null][] = [
      ["MULTINET", "multinet"],
      ["PLUXEE", "pluxee"],
      ["SODEXO", "pluxee"],
      ["SETCARD", "setcard"],
      ["EDENRED", "edenred"],
      ["METROPOL", "metropol"],
      ["TRENDYOL_ONLINE", "trendyol"],
      ["YEMEK_SEPETI_ONLINE", "yemeksepeti"],
      ["MIGROS_YEMEK_ONLINE", "migros"],
      ["GETIR_ONLINE", "getir"],
    ];
    for (const [kod, channel] of direct) assert.deepEqual(modposChannels(pay(kod, 100)), [{ channel, amount: 100 }], kod);
    // Kanalı olmayanlar: nakit, kart, Tokenflex, Paye, sitenin online ödemesi
    for (const [kod, yontem] of [
      ["NAKIT", "Nakit"],
      ["KREDI_KARTI", "Kredi Kartı"],
      ["TOKENFLEX", "Tokenflex"],
      ["PAYE", "Paye"],
      ["ONLINE_WEB", "laffogato.net"],
    ]) {
      assert.deepEqual(modposChannels(pay(kod, 50, { yontem })), [{ channel: null, amount: 50 }], kod);
    }
    // Genel Yemek Kartı: kırılım kırılım; tutmayan kalan kanalsız satır
    const yk = pay("YEMEK_KARTI", 600, {
      yontem: "Yemek Kartı",
      kirilim: [
        { ad: "Pluxee", tutar: 300 },
        { ad: "Multinet", tutar: 200 },
      ],
    });
    assert.deepEqual(modposChannels(yk), [
      { channel: "pluxee", amount: 300 },
      { channel: "multinet", amount: 200 },
      { channel: null, amount: 100 },
    ]);
    assert.deepEqual(modposChannels({ ...yk, satis: 500 }), [
      { channel: "pluxee", amount: 300 },
      { channel: "multinet", amount: 200 },
    ]);
    // Kırılımsız Yemek Kartı ve tanınmayan kod: yöntemin adından
    assert.deepEqual(modposChannels(pay("YEMEK_KARTI", 80, { yontem: "Edenred" })), [{ channel: "edenred", amount: 80 }]);
    assert.deepEqual(modposChannels(pay("YENI_KART", 70, { yontem: "Sodexo" })), [{ channel: "pluxee", amount: 70 }]);
  });

  test("isFinalFoy / finalAfter: kasaları kapalı föy ertesi gün 07:00'den (TR) itibaren kesin; açık gün hiçbir zaman", () => {
    assert.equal(finalAfter("2026-11-01"), Date.parse("2026-11-02T07:00:00+03:00"));
    assert.equal(finalAfter("2026-12-31"), Date.parse("2027-01-01T07:00:00+03:00"), "yıl sonu");
    assert.equal(finalAfter("2028-02-28"), Date.parse("2028-02-29T07:00:00+03:00"), "artık yıl");
    const b = foyOf("belge-ornegi");
    assert.equal(isFinalFoy(b, new Date("2026-11-02T06:59:59.999+03:00")), false);
    assert.equal(isFinalFoy(b, new Date("2026-11-02T07:00:00+03:00")), true);
    assert.equal(isFinalFoy(b, new Date("2026-11-20T12:00:00+03:00")), true);
    assert.equal(isFinalFoy(foyOf("acik-gun"), new Date("2026-12-01T12:00:00+03:00")), false, "açık föy sonradan da kesin değil");
    assert.equal(isFinalFoy(foyOf("foysuz-gun"), new Date("2026-10-26T07:00:00+03:00")), true, "kasasız gün");
    assert.equal(isFinalFoy(foyOf("otomatik-kapanis"), new Date("2026-10-29T08:01:00+03:00")), true);
  });

  test("sheetState ve sheetPrevious: önceki sürümün kısa özeti", () => {
    assert.equal(sheetState(foyOf("belge-ornegi")), "KAPALI");
    assert.equal(sheetState(foyOf("acik-gun")), "ACIK");
    assert.equal(sheetState(foyOf("foysuz-gun")), "BOS");
    assert.equal(sheetState(foyOf("iki-kasa")), "KAPALI");
    const f = foyOf("iki-kasa");
    assert.equal(sheetState({ ...f, kasalar: [f.kasalar[0], { ...f.kasalar[1], durum: "ACIK" }] }), "ACIK");
    const at = { fetchedAt: "2026-11-02T05:10:00.000Z", generatedAt: "2026-11-02T08:15:42.000Z", revision: 1 };
    assert.deepEqual(sheetPrevious(foyOf("belge-ornegi"), at), {
      ...at,
      state: "KAPALI",
      zTotal: 28450.5,
      cash: 8210,
      card: 16120.5,
      mealCard: 0,
      online: 0,
      other: 0,
      offRevenue: 145,
      receipts: 214,
      countedCash: 7820,
    });
    assert.deepEqual(sheetPrevious({ kasaGunu: "2026-10-26", olusturulma: null, kasalar: [], foysuzGunler: [], ozet: null, kota: null }, { ...at, generatedAt: null }), {
      ...at,
      generatedAt: null,
      state: "BOS",
      zTotal: 0,
      cash: 0,
      card: 0,
      mealCard: 0,
      online: 0,
      other: 0,
      offRevenue: 0,
      receipts: 0,
      countedCash: null,
    });
  });

  test("sheetCanonical: hazırlanma anı, kota ve anahtar sırası parmak izini değiştirmez; içerik değiştirir", () => {
    const a = foyOf("belge-ornegi");
    const base = sheetCanonical(a);
    assert.equal(sheetCanonical({ ...a, olusturulma: "2026-11-03T09:00:00+03:00", kota: { gunlukHak: 2, kullanilan: 2, kalan: 0, yenilenme: null } }), base);
    assert.equal(sheetCanonical({ ...a, olusturulma: null, kota: null }), base);
    // Anahtarları ters sırada kurulmuş aynı föy
    const reversed = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reversed) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v;
    const r = reversed(a) as KasaFoyu;
    assert.notEqual(Object.keys(r)[0], Object.keys(a)[0]);
    assert.equal(sheetCanonical(r), base);
    // Tanımsız alan yok sayılır
    assert.equal(sheetCanonical({ ...a, ...({ fazla: undefined } as object) }), base);
    // İçerik: tek kuruş, dizi sırası, uyarı
    const k = a.kasalar[0];
    assert.notEqual(sheetCanonical({ ...a, kasalar: [{ ...k, satis: { ...k.satis, ciro: 28450.51 } }] }), base);
    assert.notEqual(sheetCanonical({ ...a, kasalar: [{ ...k, odemeler: [...k.odemeler].reverse() }] }), base);
    assert.notEqual(sheetCanonical({ ...a, kasalar: [{ ...k, uyarilar: [] }] }), base);
    assert.doesNotMatch(base, /olusturulma|kota|2026-11-02T11:15:42/);
  });
});

// ---------------------------------------------------------------- request.ts: anahtar, adres, kota, hata metinleri

describe("request.ts: anahtar ve adres", () => {
  test("modposKeyProblem / modposKeyFrom: yok, yalnız boşluk, kısa, içinde boşluk, çok uzun, doğru (kenar boşlukları kırpılır)", () => {
    assert.equal(modposKeyProblem({}), "missing");
    assert.equal(modposKeyProblem({ MODPOS_API_KEY: "" }), "missing");
    assert.equal(modposKeyProblem({ MODPOS_API_KEY: "   \n" }), "missing");
    assert.equal(modposKeyProblem({ MODPOS_API_KEY: "sk_kisa" }), "format");
    assert.equal(modposKeyProblem({ MODPOS_API_KEY: "sk_test_0123 456789abcdef" }), "format");
    assert.equal(modposKeyProblem({ MODPOS_API_KEY: "sk_test_0123456789\nabcdef" }), "format", "yapıştırırken araya giren satır sonu");
    assert.equal(modposKeyProblem({ MODPOS_API_KEY: `sk_${"a".repeat(510)}` }), "format");
    assert.equal(modposKeyProblem({ MODPOS_API_KEY: "0123456789abcdef" }), null, "16 karakter yeter");
    assert.equal(modposKeyProblem({ MODPOS_API_KEY: ` ${KEY}\n` }), null);
    assert.equal(modposKeyFrom({ MODPOS_API_KEY: ` ${KEY}\n` }), KEY);
    assert.equal(modposKeyFrom({ MODPOS_API_KEY: "sk_kisa" }), null);
    assert.equal(modposKeyFrom({}), null);
  });

  test("modposUrlFrom: yalnız https ve sorgusuz adres, sondaki / atılır; yoksa kitapçığın adresi", () => {
    assert.equal(MODPOS_DEFAULT_URL, "https://api.gafdigi.com/api/v2/external/raporlar/kasa-foyu");
    assert.ok(BOOKLET.includes(`GET ${MODPOS_DEFAULT_URL}?tarih=`), "kitapçıktaki adres");
    assert.equal(modposUrlFrom({}), MODPOS_DEFAULT_URL);
    assert.equal(modposUrlFrom({ MODPOS_API_URL: "   " }), MODPOS_DEFAULT_URL);
    assert.equal(modposUrlFrom({ MODPOS_API_URL: "http://api.gafdigi.com/kasa-foyu" }), MODPOS_DEFAULT_URL, "http değil");
    assert.equal(modposUrlFrom({ MODPOS_API_URL: "https://ornek.test/kasa-foyu?tarih=2026-11-01" }), MODPOS_DEFAULT_URL, "sorgu taşıyamaz");
    assert.equal(modposUrlFrom({ MODPOS_API_URL: "https://ornek.test/kasa foyu" }), MODPOS_DEFAULT_URL);
    assert.equal(modposUrlFrom({ MODPOS_API_URL: " https://ornek.test/api/v3/kasa-foyu// " }), "https://ornek.test/api/v3/kasa-foyu");
    assert.equal(foyUrl("https://ornek.test/kasa-foyu", "2026-11-02"), "https://ornek.test/kasa-foyu?tarih=2026-11-02");
  });

  test("modposSyncFrom: takvimde olan gün ya da kafenin ilk ayı", () => {
    assert.equal(MODPOS_DEFAULT_FROM, "2026-07-01");
    assert.equal(modposSyncFrom({}), "2026-07-01");
    assert.equal(modposSyncFrom({ MODPOS_SYNC_FROM: " 2026-08-15 " }), "2026-08-15");
    assert.equal(modposSyncFrom({ MODPOS_SYNC_FROM: "2026-02-30" }), "2026-07-01");
    assert.equal(modposSyncFrom({ MODPOS_SYNC_FROM: "15.08.2026" }), "2026-07-01");
  });

  test("requestableDay: bugün ve önceki günler (TR); ileri tarih ve takvimde olmayan gün değil", () => {
    const now = new Date("2026-11-03T10:00:00+03:00");
    assert.equal(requestableDay("2026-11-03", now), true);
    assert.equal(requestableDay("2026-11-02", now), true);
    assert.equal(requestableDay("2026-07-01", now), true);
    assert.equal(requestableDay("2026-11-04", now), false, "ileri tarih kabul edilmez");
    assert.equal(requestableDay("2026-02-30", now), false);
    assert.equal(requestableDay("bugün", now), false);
    // Gece yarısından sonra (UTC'de hâlâ dün): TR günü sayılır
    assert.equal(requestableDay("2026-11-04", new Date("2026-11-03T22:30:00Z")), true);
  });
});

describe("request.ts: kota", () => {
  const now = new Date("2026-11-03T08:00:00+03:00");
  const headers = (h: Record<string, string>) => {
    const H = new Headers(h);
    return (n: string) => H.get(n);
  };

  test("quotaFromHeaders: üç başlık; yenilenme bozuksa null; gözlendiği TR günü ve anı", () => {
    assert.deepEqual(quotaFromHeaders(headers({ "X-Kota-Hak": "2", "X-Kota-Kalan": "1", "X-Kota-Yenilenme": "2026-11-04T00:00:00+03:00" }), now), {
      day: "2026-11-03",
      hak: 2,
      kalan: 1,
      yenilenme: "2026-11-04T00:00:00+03:00",
      at: now.toISOString(),
    });
    assert.deepEqual(quotaFromHeaders(headers({ "x-kota-hak": " 5 ", "x-kota-kalan": "0", "x-kota-yenilenme": "yarin" }), now), { day: "2026-11-03", hak: 5, kalan: 0, yenilenme: null, at: now.toISOString() });
    assert.equal(quotaFromHeaders(headers({ "x-kota-hak": "2", "x-kota-kalan": "1" }), new Date("2026-11-03T21:30:00Z"))?.day, "2026-11-04", "TR günü");
  });

  test("quotaFromHeaders: başlıklardan biri yoksa, boşsa ya da sayı değilse null (eksik hak 0 sayılmaz)", () => {
    assert.equal(quotaFromHeaders(headers({}), now), null);
    assert.equal(quotaFromHeaders(headers({ "x-kota-hak": "2" }), now), null, "kalan yok");
    // Eskiden Number(null) = 0: hak 0 sanılır, ertesi günlerde quotaLeft 0 döner, hiç istek gitmezdi
    assert.equal(quotaFromHeaders(headers({ "x-kota-kalan": "1" }), now), null, "hak yok");
    assert.equal(quotaFromHeaders(headers({ "x-kota-hak": "", "x-kota-kalan": "1" }), now), null, "boş hak");
    assert.equal(quotaFromHeaders(headers({ "x-kota-hak": "2", "x-kota-kalan": " " }), now), null, "boş kalan");
    assert.equal(quotaFromHeaders(headers({ "x-kota-hak": "iki", "x-kota-kalan": "1" }), now), null);
    assert.equal(quotaFromHeaders(headers({ "x-kota-hak": "2", "x-kota-kalan": "-1" }), now), null);
    assert.equal(quotaFromHeaders(headers({ "x-kota-hak": "2", "x-kota-kalan": "1.5" }), now), null);
  });

  test("quotaLeft: bilinmiyorsa günlük hak; aynı TR gününde kalan; önceki günün kotası ve yenilenme anı geçtiyse yeniden hak", () => {
    const q = (o: Partial<ModposQuota> = {}): ModposQuota => ({ day: "2026-11-03", hak: 2, kalan: 0, yenilenme: "2026-11-04T00:00:00+03:00", at: now.toISOString(), ...o });
    assert.equal(quotaLeft(null, now), MODPOS_DAILY_QUOTA);
    assert.equal(quotaLeft(q(), now), 0);
    assert.equal(quotaLeft(q({ kalan: 1 }), now), 1);
    assert.equal(quotaLeft(q({ kalan: -3 }), now), 0);
    assert.equal(quotaLeft(q(), new Date("2026-11-03T23:59:59+03:00")), 0, "gece yarısından önce");
    assert.equal(quotaLeft(q({ yenilenme: null }), new Date("2026-11-04T00:00:01+03:00")), 2, "TR günü döndü");
    assert.equal(quotaLeft(q({ day: "2026-11-02" }), now), 2, "önceki günün kotası");
    assert.equal(quotaLeft(q({ day: "2026-11-02", hak: 5 }), now), 5, "başlığın hakkı geçerli");
    assert.equal(quotaLeft(q({ yenilenme: "2026-11-03T07:00:00+03:00" }), now), 2, "yenilenme anı geçti");
    // Saklanan hak 0 (bozuk başlık ya da eski sürüm): yeni günde yine en az günlük hak; aksi hâlde kilitlenirdi
    assert.equal(quotaLeft(q({ day: "2026-11-02", hak: 0, kalan: 0 }), now), MODPOS_DAILY_QUOTA);
    assert.equal(quotaLeft(q({ day: "2026-11-03", hak: 0, kalan: 0, yenilenme: "2026-11-03T07:00:00+03:00" }), now), MODPOS_DAILY_QUOTA);
    assert.equal(quotaLeft(q({ day: "2026-11-03", hak: 0, kalan: 0 }), now), 0, "aynı gün kalan geçerli");
  });

  test("quotaRenewsAt ve renewText: bilinen yenilenme ya da yarının 00:00'ı; 'bu gece 00:00'da' / '5 Kasım 00:00'da'", () => {
    const q: ModposQuota = { day: "2026-11-03", hak: 2, kalan: 0, yenilenme: "2026-11-04T00:00:00+03:00", at: now.toISOString() };
    assert.equal(quotaRenewsAt(q, now), "2026-11-04T00:00:00+03:00");
    assert.equal(quotaRenewsAt({ ...q, yenilenme: "2026-11-04T03:00:00+03:00" }, now), "2026-11-04T03:00:00+03:00");
    assert.equal(quotaRenewsAt(null, now), "2026-11-04T00:00:00+03:00");
    assert.equal(quotaRenewsAt({ ...q, day: "2026-11-02", yenilenme: "2026-11-03T00:00:00+03:00" }, now), "2026-11-04T00:00:00+03:00", "eski günün yenilenmesi değil");
    assert.equal(renewText("2026-11-04T00:00:00+03:00", now), "bu gece 00:00'da");
    assert.equal(renewText("2026-11-03T21:00:00Z", now), "bu gece 00:00'da", "UTC yazılmış");
    assert.equal(plain(renewText("2026-11-05T00:00:00+03:00", now)), "5 Kasım 00:00'da");
    assert.equal(renewText(null, now), "gece yarısı");
    assert.equal(renewText("bozuk", now), "gece yarısı");
  });
});

describe("request.ts: hata metinleri", () => {
  const now = new Date("2026-11-03T10:00:00+03:00");
  const err = (kod: string, o: { mesaj?: string; yenilenme?: string | null; gunlukHak?: number | null } = {}) => ({ kod, mesaj: o.mesaj ?? "servisin mesajı", yenilenme: o.yenilenme ?? null, gunlukHak: o.gunlukHak ?? null });
  /** Kitapçığın §7 tablosu: HTTP durumu ve kod → panelin metni */
  const TEXTS: [number, string, string][] = [
    [400, "TARIH_GEREKLI", "ModPOS tarihi kabul etmedi (geçersiz gün)"],
    [400, "TARIH_GECERSIZ", "ModPOS tarihi kabul etmedi (geçersiz gün)"],
    [400, "ILERI_TARIH", "ModPOS ileri tarihi kabul etmedi: yalnız bugün ve önceki günler çekilir"],
    [401, "ANAHTAR_GEREKLI", "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin"],
    [401, "ANAHTAR_GECERSIZ", "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin"],
    [403, "ANAHTAR_PASIF", "ModPOS API anahtarı kullanıma kapalı: Gafdigi'den anahtarı açtırın"],
    [403, "ANAHTAR_SURESI_DOLDU", "ModPOS API anahtarının süresi dolmuş: Gafdigi'den yeni anahtar alıp Vercel'e yazın"],
    [403, "IP_IZINSIZ", "ModPOS isteği panelin sunucusundan kabul etmiyor (IP kısıtı): Gafdigi'den anahtarın IP kısıtını kaldırtın, Vercel'in sabit IP'si yok"],
    [403, "YETKI_YOK", "ModPOS API anahtarının rapor yetkisi yok: Gafdigi'den kasa föyü yetkisi isteyin"],
    [403, "KAPSAM_GECERSIZ", "ModPOS API anahtarı bir markaya ya da şubeye bağlı değil: Gafdigi'den anahtarı işletmeye bağlatın"],
    [429, "KOTA_DOLDU", "ModPOS'un günlük 2 çekim hakkı doldu: hak bu gece 00:00'da yenilenir"],
    [429, "COK_FAZLA_ISTEK", "ModPOS kısa sürede çok istek aldı: birkaç dakika sonra yeniden deneyin"],
    [500, "RAPOR_URETILEMEDI", "ModPOS föyü hazırlayamadı (hak geri verildi): sonra yeniden denenecek"],
    [503, "SERVIS_KULLANILAMIYOR", "ModPOS servisi şu an kullanılamıyor: sonra yeniden denenecek"],
  ];

  test("kitapçığın her hata kodunun kendi metni var (sonda nokta yok, ne yapılacağı söylenir)", () => {
    assert.deepEqual(TEXTS.map((t) => t[1]).sort(), codesIn(between("## 7. ", "## 8. ")), "kitapçığın §7 tablosu");
    for (const [status, kod, text] of TEXTS) {
      const got = modposErrorText(status, err(kod, kod === "KOTA_DOLDU" ? { yenilenme: "2026-11-04T00:00:00+03:00", gunlukHak: 2 } : {}), now);
      assert.equal(got, text, kod);
      assert.doesNotMatch(got, /\.$|kabul etmedi \(HTTP/, kod);
    }
  });

  test("KOTA_DOLDU: hak sayısı ve yenilenme hatanın ayrıntısından; yoksa günlük hak ve gece yarısı", () => {
    assert.equal(plain(modposErrorText(429, err("KOTA_DOLDU", { gunlukHak: 5, yenilenme: "2026-11-05T00:00:00+03:00" }), now)), "ModPOS'un günlük 5 çekim hakkı doldu: hak 5 Kasım 00:00'da yenilenir");
    assert.equal(modposErrorText(429, err("KOTA_DOLDU"), now), "ModPOS'un günlük 2 çekim hakkı doldu: hak gece yarısı yenilenir");
  });

  test("tanınmayan kod, hatasız 429 ve 5xx: HTTP durumu ve servisin mesajı (160 karakterle)", () => {
    assert.equal(modposErrorText(400, err("YENI_KOD", { mesaj: "Bir şey oldu" }), now), "ModPOS isteği kabul etmedi (HTTP 400, YENI_KOD): Bir şey oldu");
    assert.equal(modposErrorText(418, null, now), "ModPOS isteği kabul etmedi (HTTP 418)");
    assert.equal(modposErrorText(404, err("", { mesaj: "" }), now), "ModPOS isteği kabul etmedi (HTTP 404)");
    assert.equal(modposErrorText(429, null, now), "ModPOS istek sınırına takıldı: sonra yeniden denenecek");
    assert.equal(modposErrorText(502, null, now), "ModPOS şu an yanıt vermiyor (HTTP 502): sonra yeniden denenecek");
    assert.equal(modposErrorText(500, err("BILINMIYOR"), now), "ModPOS şu an yanıt vermiyor (HTTP 500): sonra yeniden denenecek");
    const long = modposErrorText(400, err("YENI_KOD", { mesaj: "x".repeat(400) }), now);
    assert.equal(long, `ModPOS isteği kabul etmedi (HTTP 400, YENI_KOD): ${"x".repeat(160)}`);
  });

  test("isKeyError: yalnız anahtarın kendisiyle ilgili kodlar (düzeltilmeden hiçbir gün çekilmez)", () => {
    for (const k of ["ANAHTAR_GEREKLI", "ANAHTAR_GECERSIZ", "ANAHTAR_PASIF", "ANAHTAR_SURESI_DOLDU", "IP_IZINSIZ", "YETKI_YOK", "KAPSAM_GECERSIZ"]) assert.equal(isKeyError(k), true, k);
    for (const k of ["KOTA_DOLDU", "COK_FAZLA_ISTEK", "RAPOR_URETILEMEDI", "SERVIS_KULLANILAMIYOR", "TARIH_GECERSIZ", "ILERI_TARIH", "BOZUK", "HTTP_500", ""]) assert.equal(isKeyError(k), false, k);
  });
});

// ---------------------------------------------------------------- plan.ts: hangi gün

describe("plan.ts: çekilecek günler", () => {
  /** Sabah işi: 12 Kasım 08:00 (bugün 12 Kasım, dün 11 Kasım) */
  const CRON = new Date("2026-11-12T08:00:00+03:00");
  const S = (final: boolean, fetchedAt: string): StoredDay => ({ final, fetchedAt: new Date(fetchedAt).toISOString() });
  const have = (o: Record<string, StoredDay>) => new Map(Object.entries(o));
  /** from'dan düne bütün günler kesin, belli anlarda çekilmiş */
  const allFinal = (from: string, to: string, at: (d: string) => string = (d) => `${d}T23:59:00+03:00`) => {
    const m = new Map<string, StoredDay>();
    for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) m.set(d, S(true, at(d)));
    return m;
  };

  test("ilk kurulum, sabah 08:00: dün ve bir geçmiş gün, yeniden eskiye", () => {
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-07-01", have: new Map(), left: 2 }), ["2026-11-11", "2026-11-10"]);
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-07-01", have: new Map(), left: 3 }), ["2026-11-11", "2026-11-10", "2026-11-09"], "kota artırılırsa");
  });

  test("hak 1 ise yalnız dün; hak 0 (ya da eksi) ise hiçbir şey", () => {
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-07-01", have: new Map(), left: 1 }), ["2026-11-11"]);
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-07-01", have: new Map(), left: 0 }), []);
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-07-01", have: new Map(), left: -1 }), []);
  });

  test("dün zaten kesinse sıradaki eksik günler (yeniden eskiye, aradaki boşluklar dahil)", () => {
    const h = have({ "2026-11-11": S(true, "2026-11-12T07:10:00+03:00"), "2026-11-10": S(true, "2026-11-11T08:00:00+03:00") });
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-07-01", have: h, left: 2 }), ["2026-11-09", "2026-11-08"]);
  });

  test("kesin olmayan föy kesinleşme anından sonra yeniden çekilir (önce dün, sonra son 14 gün, yeniden eskiye)", () => {
    // 5–11 Kasım saklı; 8 Kasım gün açıkken, 11 Kasım gece alınmış
    const h = allFinal("2026-11-05", "2026-11-11");
    h.set("2026-11-08", S(false, "2026-11-08T22:00:00+03:00"));
    h.set("2026-11-11", S(false, "2026-11-11T23:30:00+03:00"));
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-11-05", have: h, left: 2 }), ["2026-11-11", "2026-11-08"]);
    // 15 günden eski kesin olmayan föy yeniden çekilmez
    const old = allFinal("2026-10-20", "2026-11-11");
    old.set("2026-10-27", S(false, "2026-10-27T22:00:00+03:00"));
    old.set("2026-10-29", S(false, "2026-10-29T22:00:00+03:00"));
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-10-20", have: old, left: 1 }), ["2026-10-29"], "12 − 14 = 29 Ekim sınırda");
    assert.ok(!planFoyDays({ now: CRON, from: "2026-10-20", have: old, left: 5 }).includes("2026-10-27"));
  });

  test("07:00'den önce dün planlanmaz (kesinleşmedi); gece alınmış kesin olmayan dün de beklenir", () => {
    const early = new Date("2026-11-12T06:59:00+03:00");
    assert.deepEqual(planFoyDays({ now: early, from: "2026-07-01", have: new Map(), left: 2 }), ["2026-11-10", "2026-11-09"]);
    const h = allFinal("2026-11-05", "2026-11-10", () => "2026-11-11T08:00:00+03:00");
    h.set("2026-11-11", S(false, "2026-11-11T23:30:00+03:00"));
    assert.ok(!planFoyDays({ now: early, from: "2026-11-05", have: h, left: 2 }).includes("2026-11-11"));
    assert.deepEqual(planFoyDays({ now: new Date("2026-11-12T07:00:00+03:00"), from: "2026-11-05", have: h, left: 1 }), ["2026-11-11"], "07:00'de");
  });

  test("bugün hiçbir zaman kendiliğinden çekilmez; from'dan önceki gün de", () => {
    const h = have({ "2026-11-12": S(false, "2026-11-12T07:55:00+03:00") });
    assert.ok(!planFoyDays({ now: CRON, from: "2026-07-01", have: h, left: 5 }).includes("2026-11-12"));
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-11-11", have: new Map(), left: 2 }), ["2026-11-11"], "from = dün");
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-11-12", have: new Map(), left: 2 }), [], "from = bugün");
    const before = have({ "2026-11-01": S(false, "2026-11-01T21:00:00+03:00") });
    assert.ok(!planFoyDays({ now: CRON, from: "2026-11-05", have: before, left: 10 }).includes("2026-11-01"));
  });

  test("hepsi saklı ve kesinse son 7 günün en eski kontrol edilen föyü; bugün kontrol edilen atlanır", () => {
    const at: Record<string, string> = {
      "2026-11-04": "2026-11-05T08:00:00+03:00", // 8 günden eski: kontrol edilmez
      "2026-11-05": "2026-11-09T08:00:00+03:00",
      "2026-11-06": "2026-11-07T08:00:00+03:00",
      "2026-11-07": "2026-11-08T08:00:00+03:00",
      "2026-11-08": "2026-11-09T08:00:00+03:00",
      "2026-11-09": "2026-11-12T07:58:00+03:00", // bugün kontrol edildi
      "2026-11-10": "2026-11-11T08:00:00+03:00",
      "2026-11-11": "2026-11-12T07:59:00+03:00", // bugün
    };
    const h = allFinal("2026-11-04", "2026-11-11", (d) => at[d]);
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-11-04", have: h, left: 2 }), ["2026-11-06", "2026-11-07"]);
    // Aynı anda çekilmiş günler: eskisi önce
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-11-04", have: h, left: 4 }), ["2026-11-06", "2026-11-07", "2026-11-05", "2026-11-08"]);
    assert.deepEqual(planFoyDays({ now: CRON, from: "2026-11-04", have: h, left: 9 }), ["2026-11-06", "2026-11-07", "2026-11-05", "2026-11-08", "2026-11-10"]);
  });

  test("missingFoyDays: from'dan düne hiç alınmamış ve kesinleşmiş günler", () => {
    const h = have({ "2026-11-07": S(true, "2026-11-08T08:00:00+03:00"), "2026-11-09": S(false, "2026-11-09T21:00:00+03:00") });
    assert.deepEqual(missingFoyDays("2026-11-05", h, CRON), ["2026-11-05", "2026-11-06", "2026-11-08", "2026-11-10", "2026-11-11"]);
    assert.deepEqual(missingFoyDays("2026-11-05", h, new Date("2026-11-12T06:00:00+03:00")), ["2026-11-05", "2026-11-06", "2026-11-08", "2026-11-10"], "dün henüz kesinleşmedi");
    assert.deepEqual(missingFoyDays("2026-11-12", h, CRON), []);
    assert.equal(missingFoyDays("2026-07-01", new Map(), CRON).length, 134, "1 Temmuz – 11 Kasım");
  });
});

// ---------------------------------------------------------------- status.ts: durum ve Ayarlar kartı

describe("status.ts: saklanan durum ve kartın özeti", () => {
  const NOW = new Date("2026-11-03T14:00:00+03:00");
  const run = (at: string, o: Partial<ModposRun> = {}): ModposRun => ({ at, trigger: "cron", days: [{ day: "2026-11-02", result: "yeni" }], status: "ok", text: null, ...o });

  test("parseModposState: boş ya da bozuk değer boş durum; bozuk parça atılır, kalanı okunur", () => {
    const empty: ModposState = { quota: null, lastOk: null, lastError: null, runs: [] };
    for (const v of [undefined, null, "bozuk", 42, [], {}]) assert.deepEqual(parseModposState(v), empty, JSON.stringify(v));
    const ok = { at: "2026-11-03T05:01:00.000Z", day: "2026-11-02" };
    const good = run("2026-11-03T05:01:00.000Z");
    assert.deepEqual(
      parseModposState({
        quota: { day: "2026-11-03", hak: "2", kalan: 1, yenilenme: null, at: "x" },
        lastOk: ok,
        lastError: { at: "2026-11-02T05:00:00.000Z", day: null, kod: "BAGLANTI", text: "ModPOS'a bağlanılamadı" },
        runs: [good, { at: 1 }, { ...good, trigger: "elle" }, { ...good, status: "belki" }, "metin"],
        fazla: true,
      }),
      { quota: null, lastOk: ok, lastError: null, runs: [good, { ...good, trigger: "elle" }] },
    );
    const many = Array.from({ length: 13 }, (_, i) => run(`2026-11-03T05:${String(i).padStart(2, "0")}:00.000Z`));
    assert.equal(parseModposState({ runs: many }).runs.length, MODPOS_RUNS_KEEP);
    assert.deepEqual(parseModposState({ quota: { day: "2026-11-03", hak: 2, kalan: 0, yenilenme: "2026-11-04T00:00:00+03:00", at: "2026-11-03T05:00:00.000Z" } }).quota?.kalan, 0);
  });

  test("withRun: yeni çalışma başa, en çok 10", () => {
    const runs = Array.from({ length: 10 }, (_, i) => run(`2026-11-0${(i % 9) + 1}T05:00:00.000Z`, { text: `r${i}` }));
    const next = withRun(runs, run("2026-11-03T06:00:00.000Z", { text: "yeni" }));
    assert.equal(next.length, MODPOS_RUNS_KEEP);
    assert.equal(next[0].text, "yeni");
    assert.equal(next.at(-1)?.text, "r8", "en eskisi düştü");
    assert.equal(runs.length, 10, "girdi değişmez");
    assert.deepEqual(withRun([], run("x")), [run("x")]);
  });

  test("runDaysText, modposDayText, timeText", () => {
    assert.equal(plain(runDaysText([{ day: "2026-11-02", result: "yeni" }, { day: "2026-10-14", result: "ayni" }, { day: "2026-10-13", result: "degisti" }, { day: "2025-12-31", result: "hata" }], NOW)), "2 Kasım alındı · 14 Ekim değişmedi · 13 Ekim değişti · 31 Aralık 2025 alınamadı");
    assert.equal(plain(modposDayText("2026-11-02", NOW)), "2 Kasım");
    assert.equal(plain(modposDayText("2025-11-02", NOW)), "2 Kasım 2025");
    assert.equal(timeText("2026-11-03T05:01:00.000Z", NOW), "bugün 08:01");
    assert.equal(timeText("2026-11-02T20:10:00.000Z", NOW), "dün 23:10");
    assert.equal(timeText("2026-11-02T21:10:00.000Z", NOW), "bugün 00:10", "TR gece yarısı");
    assert.equal(plain(timeText("2026-10-20T05:00:00.000Z", NOW)), "20 Ekim 08:00");
  });

  const base: ModposCardInput = {
    now: NOW,
    keyProblem: null,
    preview: false,
    state: { quota: null, lastOk: null, lastError: null, runs: [] },
    from: "2026-07-01",
    stored: { count: 0, first: null, last: null },
    missing: 0,
  };
  const card = (o: Partial<ModposCardInput>) => {
    const c = modposCardSummary({ ...base, ...o });
    return { ...c, headline: plain(c.headline), lines: c.lines.map(plain), short: plain(c.short), fetchBlocked: c.fetchBlocked && plain(c.fetchBlocked) };
  };
  const okState = (o: Partial<ModposState> = {}): ModposState => ({
    quota: { day: "2026-11-03", hak: 2, kalan: 0, yenilenme: "2026-11-04T00:00:00+03:00", at: "2026-11-03T05:01:00.000Z" },
    lastOk: { at: "2026-11-03T05:01:00.000Z", day: "2026-11-02" },
    lastError: null,
    runs: [],
    ...o,
  });

  test("anahtar yok: gri 'Kurulmadı' (hata değil), düğme kapalı", () => {
    const c = card({ keyProblem: "missing" });
    assert.deepEqual([c.tone, c.badge, c.short, c.canFetch, c.fetchBlocked, c.left], ["gray", "Kurulmadı", "Kurulmadı", false, "Anahtar tanımlı değil", 2]);
    assert.match(c.lines[0], /Vercel › lafmaliyet › Settings › Environment Variables'a \(yalnız Production\) MODPOS_API_KEY/);
  });

  test("anahtarın biçimi bozuk: kırmızı 'Anahtar bozuk', düğme kapalı", () => {
    const c = card({ keyProblem: "format", state: okState() });
    assert.deepEqual([c.tone, c.badge, c.canFetch, c.fetchBlocked], ["red", "Anahtar bozuk", false, "Anahtar bozuk"]);
    assert.match(c.headline, /boşluk ya da satır sonu/);
  });

  test("önizleme: gri, çekmez (satırlar yine yazılır)", () => {
    const c = card({ preview: true, state: okState(), stored: { count: 3, first: "2026-10-31", last: "2026-11-02" } });
    assert.deepEqual([c.tone, c.badge, c.canFetch, c.fetchBlocked], ["gray", "Önizleme", false, "Önizlemede çekilmez"]);
    assert.equal(c.lines[0], "31 Ekim – 2 Kasım arası 3 günün föyü var.");
  });

  test("hiç çekilmedi: turuncu 'Henüz çekilmedi', ilk föyün ne zaman geleceği; eksik günlerin ne kadar süreceği", () => {
    const c = card({ missing: 111 });
    assert.deepEqual([c.tone, c.badge, c.canFetch, c.fetchBlocked, c.left], ["amber", "Henüz çekilmedi", true, null, 2]);
    assert.equal(c.headline, "Anahtar tanımlı; ilk föy yarın sabah 08:00'de gelir ya da aşağıdan şimdi çekilebilir");
    assert.deepEqual(c.lines, [
      "1 Temmuz'dan bu yana 111 günün föyü henüz yok: her sabah dünün föyünden sonra kalan hakla bir gün daha geriye gidilir (yaklaşık 111 gün sürer).",
      "Bugün kalan çekim hakkı: 2 / 2.",
    ]);
    // Çekim kaydı yok ama föy saklı (komut satırının --dosya --kaydet'i): "Henüz çekilmedi" denmez
    const filed = card({ missing: 111, stored: { count: 2, first: "2026-11-01", last: "2026-11-02" } });
    assert.deepEqual([filed.tone, filed.badge, filed.short], ["green", "Bağlı", "Bağlı · 2 gün"]);
    // Ay adının eki ayına göre (eskiden hep "'den"); başka yıl "tarihinden"
    assert.match(card({ missing: 3, from: "2026-09-01" }).lines[0], /^1 Eylül'den bu yana 3 günün/);
    assert.match(card({ missing: 3, from: "2026-08-03" }).lines[0], /^3 Ağustos'tan bu yana/);
    assert.match(card({ missing: 3, from: "2025-12-01" }).lines[0], /^1 Aralık 2025 tarihinden bu yana/);
    // Kota artırılırsa daha hızlı: hak 5 → günde 4 geçmiş gün
    const fast = card({ missing: 111, state: { ...okState(), quota: { day: "2026-11-02", hak: 5, kalan: 0, yenilenme: null, at: "2026-11-02T05:00:00.000Z" } } });
    assert.match(fast.lines.find((l) => l.includes("henüz yok"))!, /yaklaşık 28 gün sürer/);
  });

  test("bağlı: yeşil, kapsam, kalan hak ve yenilenme, son başarılı çekim; hak bitince düğme kapalı", () => {
    const c = card({ state: okState(), stored: { count: 14, first: "2026-07-01", last: "2026-11-02" }, missing: 111 });
    assert.deepEqual([c.tone, c.badge, c.short, c.left, c.canFetch, c.fetchBlocked], ["green", "Bağlı", "Bağlı · 14 gün", 0, false, "Bugünkü hak doldu; bu gece 00:00'da yenilenir"]);
    assert.equal(c.headline, "Her sabah 08:00'de dünün kasa föyü geliyor");
    assert.deepEqual(c.lines, [
      "1 Temmuz – 2 Kasım arası 14 günün föyü var.",
      "1 Temmuz'dan bu yana 111 günün föyü henüz yok: her sabah dünün föyünden sonra kalan hakla bir gün daha geriye gidilir (yaklaşık 111 gün sürer).",
      "Bugün kalan çekim hakkı: 0 / 2 (hak bu gece 00:00'da yenilenir).",
      "Son başarılı çekim: 2 Kasım föyü, bugün 08:01.",
    ]);
    const next = card({ now: new Date("2026-11-04T07:30:00+03:00"), state: okState(), stored: { count: 14, first: "2026-07-01", last: "2026-11-02" } });
    assert.deepEqual([next.left, next.canFetch, next.fetchBlocked], [2, true, null]);
    assert.ok(next.lines.includes("Bugün kalan çekim hakkı: 2 / 2."));
    assert.ok(next.lines.includes("Son başarılı çekim: 2 Kasım föyü, dün 08:01."));
  });

  test("taze anahtar hatası: kırmızı 'Hata' (hak varsa düğme açık: anahtar düzeltilince denensin); eskisi turuncu değil yeşil", () => {
    const keyErr = { at: "2026-11-03T08:00:00.000Z", day: "2026-11-02", kod: "ANAHTAR_GECERSIZ", text: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin", keyError: true };
    const c = card({ state: okState({ lastError: keyErr, quota: null }) });
    assert.deepEqual([c.tone, c.badge, c.short, c.canFetch, c.headline], ["red", "Hata", "Hata", true, keyErr.text]);
    // Hiç başarılı çekim yokken de
    assert.equal(card({ state: okState({ lastOk: null, lastError: keyErr, quota: null }) }).tone, "red");
    // Hatadan sonra başarılı çekim: hata eskidi
    const later = card({ state: okState({ lastError: keyErr, lastOk: { at: "2026-11-03T09:00:00.000Z", day: "2026-11-02" }, quota: null }) });
    assert.deepEqual([later.tone, later.badge], ["green", "Bağlı"]);
    // Anahtarla ilgisi olmayan taze hata: turuncu "Uyarı"
    const net = card({ state: okState({ lastError: { ...keyErr, kod: "BAGLANTI", text: "ModPOS'a bağlanılamadı: sonra yeniden denenecek", keyError: false } }) });
    assert.deepEqual([net.tone, net.badge, net.short, net.headline], ["amber", "Uyarı", "Son deneme hata verdi", "Son deneme: ModPOS'a bağlanılamadı: sonra yeniden denenecek"]);
  });

  test("hak doldu (KOTA_DOLDU): turuncu değil mavi, düğme kapalı; hak yenilenince hiç anılmaz", () => {
    const quotaErr = { at: "2026-11-03T10:00:00.000Z", day: "2026-11-01", kod: "KOTA_DOLDU", text: "ModPOS'un günlük 2 çekim hakkı doldu: hak bu gece 00:00'da yenilenir", keyError: false };
    const st = okState({ lastError: quotaErr });
    const c = card({ state: st, stored: { count: 3, first: "2026-10-31", last: "2026-11-02" } });
    assert.deepEqual([c.tone, c.badge, c.short, c.left, c.canFetch, c.fetchBlocked], ["blue", "Hak doldu", "Bugünkü hak doldu", 0, false, "Bugünkü hak doldu; bu gece 00:00'da yenilenir"]);
    assert.equal(c.headline, "Bugünkü çekim hakkı doldu; hak bu gece 00:00'da yenilenir");
    // Ertesi sabah (hak yenilendi): eski KOTA_DOLDU güncel değil, kart yeşil; "bu gece" demez
    const next = card({ now: new Date("2026-11-04T07:30:00+03:00"), state: st, stored: { count: 3, first: "2026-10-31", last: "2026-11-02" } });
    assert.deepEqual([next.tone, next.badge, next.left, next.canFetch], ["green", "Bağlı", 2, true]);
    assert.doesNotMatch(next.headline, /doldu/);
    // Hiç başarılı çekim yokken hak dolduysa da mavi; yenilenince "Henüz çekilmedi"
    const first = okState({ lastOk: null, lastError: quotaErr });
    assert.equal(card({ state: first }).tone, "blue");
    assert.deepEqual(
      ((c2) => [c2.tone, c2.badge])(card({ now: new Date("2026-11-04T07:30:00+03:00"), state: first })),
      ["amber", "Henüz çekilmedi"],
    );
  });

  test("readModposFallback: yalnız true açık", () => {
    assert.equal(readModposFallback(true), true);
    for (const v of [false, "true", 1, null, undefined, {}]) assert.equal(readModposFallback(v), false, String(v));
  });
});

// ---------------------------------------------------------------- compare.ts: rapor ↔ föy

describe("compare.ts: kasa raporu ile föy", () => {
  const z = foyZ(foyOf("belge-ornegi"))!;
  const same: ModposSavedFields = {
    zNo: "312",
    receipts: 214,
    zTotal: 28450.5,
    cash: 8210,
    card: 16120.5,
    mealCard: 0,
    online: 0,
    other: 0,
    offRevenue: 145,
    openingCash: 500,
    cashIn: 0,
    cashOut: 870,
    countedCash: 7820,
  };

  test("aynı yazılmış rapor: fark yok (Z no baştaki sıfırlar olmadan)", () => {
    assert.deepEqual(modposDiffs(same, z), []);
    assert.deepEqual(modposDiffs({ ...same, zNo: " 0312 " }, z), []);
    assert.deepEqual(modposDiffs({ ...same, zNo: "000" }, { ...z, zNo: "0" }), []);
  });

  test("1 kuruş hassasiyet: 1 kuruş aynı, 2 kuruş farklı", () => {
    assert.deepEqual(modposDiffs({ ...same, cash: 8210.01, zTotal: 28450.49 }, z), []);
    assert.deepEqual(
      modposDiffs({ ...same, cash: 8210.02 }, z).map((d) => [d.field, d.saved, d.modpos]),
      [["cash", 8210.02, 8210]],
    );
  });

  test("farklı yazılan her alan, sırayla ve etiketiyle", () => {
    const diffs = modposDiffs({ zNo: "313", receipts: 213, zTotal: 1, cash: 2, card: 3, mealCard: 4, online: 5, other: 6, offRevenue: 7, openingCash: 8, cashOut: 0, countedCash: 9 }, z);
    assert.deepEqual(
      diffs.map((d) => [d.field, d.label]),
      [
        ["zNo", "Z no"],
        ["receipts", "Fiş sayısı"],
        ["zTotal", "Toplam satış"],
        ["cash", "Nakit"],
        ["card", "Kart"],
        ["mealCard", "Yemek kartı"],
        ["online", "Online"],
        ["other", "Diğer"],
        ["offRevenue", "Ödenmez / ikram"],
        ["openingCash", "Açılış"],
        ["countedCash", "Sayılan nakit"],
      ],
    );
    // Gün içinde çıkan / giren yalnız bilgi: fark sayılmaz
    assert.deepEqual(modposDiffs({ ...same, cashOut: 5000, cashIn: 900 }, z), []);
  });

  test("raporda boş bırakılan isteğe bağlı alan (Z no, fiş sayısı, ödenmez) farklı sayılmaz; föyde Z no yoksa da", () => {
    assert.deepEqual(modposDiffs({ ...same, zNo: null, receipts: null, offRevenue: null }, z), []);
    assert.deepEqual(modposDiffs({ ...same, zNo: "" }, z), []);
    assert.deepEqual(modposDiffs({ ...same, zNo: "999" }, { ...z, zNo: null }), [], "iki kasalı gün");
  });

  test("sayım yalnız föyde Z raporuna dayanan sayım varsa karşılaştırılır (açık gün)", () => {
    const acik = foyZ(foyOf("acik-gun"))!;
    const saved: ModposSavedFields = { zNo: null, receipts: 58, zTotal: 6420.75, cash: 2100, card: 3870.75, mealCard: 450, online: 0, other: 0, offRevenue: 0, openingCash: 1000, cashOut: 150, countedCash: 1234 };
    assert.deepEqual(modposDiffs(saved, acik), []);
  });

  test("föysüz gün: fiş sayısı, açılış ve sayım karşılaştırılmaz; tutarlar karşılaştırılır", () => {
    const fz = foyZ(foyOf("foysuz-gun"))!;
    const saved: ModposSavedFields = { zNo: "77", receipts: 99, zTotal: 840, cash: 340, card: 500, mealCard: 0, online: 0, other: 0, offRevenue: 40, openingCash: 1500, cashOut: 0, countedCash: 1840 };
    assert.deepEqual(modposDiffs(saved, fz), []);
    assert.deepEqual(
      modposDiffs({ ...saved, zTotal: 800, card: 460 }, fz).map((d) => d.field),
      ["zTotal", "card"],
    );
  });

  test("modposDiffText / modposDiffsLine: tutar para biçiminde, Z no ve fiş sayısı olduğu gibi", () => {
    const [cash] = modposDiffs({ ...same, cash: 8190 }, z);
    assert.equal(plain(modposDiffText(cash)), "Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)");
    const [zNo] = modposDiffs({ ...same, zNo: "313" }, z);
    assert.equal(modposDiffText(zNo), "Z no 313 (ModPOS föyünde 0312)");
    const [rec] = modposDiffs({ ...same, receipts: 1200 }, z);
    assert.equal(modposDiffText(rec), "Fiş sayısı 1200 (ModPOS föyünde 214)");
    const [card2] = modposDiffs({ ...same, card: 16120 }, z);
    assert.equal(plain(modposDiffText(card2)), "Kart 16.120 ₺ (ModPOS föyünde 16.120,50 ₺)");
    assert.equal(modposDiffsLine([]), null);
    assert.equal(plain(modposDiffsLine([cash, zNo])!), "ModPOS föyünden farklı: Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺); Z no 313 (ModPOS föyünde 0312)");
  });

  test("modposCompare raporsuz: yalnız föyün sütunu dolu, hepsi 'none'", () => {
    const rows = modposCompare(null, z);
    assert.deepEqual(
      rows.map((r) => r.key),
      ["zNo", "receipts", "zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "openingCash", "cashOut", "cashIn", "expectedCash", "countedCash", "cashDiff"],
    );
    assert.ok(rows.every((r) => r.tone === "none" && r.report === null && r.diff === null));
    assert.deepEqual(
      rows.map((r) => r.modpos),
      ["0312", 214, 28450.5, 8210, 16120.5, 0, 0, 0, 145, 500, 870, 0, 7840, 7820, -20],
    );
    assert.deepEqual(
      rows.filter((r) => !r.money).map((r) => r.key),
      ["zNo", "receipts"],
    );
    // Föysüz gün: kasa satırları yok, fiş sayısı föyde yok
    const fz = modposCompare(null, foyZ(foyOf("foysuz-gun"))!);
    assert.deepEqual(
      fz.map((r) => r.key),
      ["zNo", "receipts", "zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue"],
    );
    assert.equal(fz.find((r) => r.key === "receipts")?.modpos, null);
  });

  test("modposCompare raporlu: aynı, farklı ve bilgi satırları; fark föy − rapor", () => {
    const rows = modposCompare({ ...same, cash: 8190, zNo: null, cashOut: 900, cashIn: undefined, expectedCash: 7840, cashDiff: -20.5 }, z);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.deepEqual([by.cash.tone, by.cash.diff, by.cash.report, by.cash.modpos], ["diff", 20, 8190, 8210]);
    assert.deepEqual([by.zTotal.tone, by.zTotal.diff], ["same", 0]);
    assert.deepEqual([by.zNo.tone, by.zNo.report], ["none", null], "raporda Z no boş");
    assert.deepEqual([by.receipts.tone, by.receipts.diff], ["same", null], "sayı satırında fark yok");
    assert.deepEqual([by.cashOut.tone, by.cashOut.diff], ["info", -30], "bilgi: uyarı değil");
    assert.deepEqual([by.cashIn.tone, by.cashIn.report, by.cashIn.diff], ["same", 0, 0], "girilmeyen giren 0");
    assert.deepEqual([by.expectedCash.tone, by.expectedCash.diff], ["same", 0]);
    assert.deepEqual([by.cashDiff.tone, by.cashDiff.diff], ["info", 0.5]);
    assert.deepEqual([by.countedCash.tone, by.openingCash.tone], ["same", "same"]);
    // Raporun olması gereken nakdi verilmediyse satır "none"
    assert.equal(modposCompare(same, z).find((r) => r.key === "expectedCash")?.tone, "none");
    // Açık günde föyün sayımı yok: satır "none"
    const acik = modposCompare({ ...same, countedCash: 1 }, foyZ(foyOf("acik-gun"))!);
    assert.equal(acik.find((r) => r.key === "countedCash")?.tone, "none");
  });
});

// ---------------------------------------------------------------- client.ts: sahte fetch'le istek

describe("client.ts: istek ve yanıtın sonucu (sahte fetch)", () => {
  let client: typeof import("../src/server/modpos/client");
  const NOW = new Date("2026-11-02T08:00:00+03:00");
  const DAY = "2026-11-01";
  const results: unknown[] = [];
  type Call = { url: string; init: RequestInit };

  before(async () => {
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test modülü doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    client = await import("../src/server/modpos/client");
  });

  /** Verilen yanıtı döndüren sahte fetch; istekleri saklar */
  function fake(respond: (call: Call) => Response | Promise<Response>) {
    const calls: Call[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const call = { url: String(input), init: init ?? {} };
      calls.push(call);
      return respond(call);
    }) as typeof fetch;
    return { impl, calls };
  }
  const res = (body: BodyInit | null, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "application/xml; charset=utf-8", ...headers } });
  const KOTA = { "X-Kota-Hak": "2", "X-Kota-Kalan": "0", "X-Kota-Yenilenme": "2026-11-03T00:00:00+03:00" };
  const hataXml = (kod: string, mesaj = "servisin mesajı") => `<?xml version="1.0" encoding="UTF-8"?><hata><kod>${kod}</kod><mesaj>${mesaj}</mesaj></hata>`;
  async function get(respond: (call: Call) => Response | Promise<Response>, o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}) {
    const f = fake(respond);
    const r = await client.fetchKasaFoyu(DAY, { now: NOW, fetchImpl: f.impl, env: o.env ?? ENV, timeoutMs: o.timeoutMs });
    results.push(r);
    return { r, calls: f.calls };
  }

  test("200: föy ve başlıklardan kota; istek x-api-key başlığıyla, ?tarih=YYYY-MM-DD, yönlendirmesiz, önbelleksiz", async () => {
    const { r, calls } = await get(() => res(xml("belge-ornegi"), 200, KOTA));
    assert.equal(r.status, "ok");
    assert.ok(r.status === "ok");
    assert.equal(r.foy.kasaGunu, DAY);
    assert.deepEqual(r.quota, { day: "2026-11-02", hak: 2, kalan: 0, yenilenme: "2026-11-03T00:00:00+03:00", at: NOW.toISOString() });
    assert.equal(calls.length, 1, "yeniden deneme yok");
    assert.equal(calls[0].url, `${MODPOS_DEFAULT_URL}?tarih=2026-11-01`);
    const h = new Headers(calls[0].init.headers);
    assert.equal(h.get("x-api-key"), KEY);
    assert.equal(h.get("accept"), "application/xml");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(calls[0].init.cache, "no-store");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.ok(!calls[0].url.includes(KEY), "anahtar adreste değil");
    // MODPOS_API_URL
    const other = await get(() => res(xml("belge-ornegi")), { env: { ...ENV, MODPOS_API_URL: "https://ornek.test/v3/kasa-foyu/" } });
    assert.equal(other.calls[0].url, "https://ornek.test/v3/kasa-foyu?tarih=2026-11-01");
  });

  test("200, başlıksız: kota föyün <kota>'sından; o da yoksa null", async () => {
    const { r } = await get(() => res(xml("belge-ornegi")));
    assert.ok(r.status === "ok");
    assert.deepEqual(r.quota, { day: "2026-11-02", hak: 2, kalan: 1, yenilenme: "2026-11-03T00:00:00+03:00", at: NOW.toISOString() });
    const bare = await get(() => res(xml("belge-ornegi").replace(/<kota>[\s\S]*<\/kota>/, "")));
    assert.ok(bare.r.status === "ok");
    assert.equal(bare.r.quota, null);
    // Yalnız X-Kota-Kalan: başlık kotası geçersiz, gövdeninki kullanılır (hak 0 sanılmaz)
    const half = await get(() => res(xml("belge-ornegi"), 200, { "X-Kota-Kalan": "1" }));
    assert.ok(half.r.status === "ok");
    assert.equal(half.r.quota?.hak, 2);
  });

  test("429 KOTA_DOLDU: kota sonucu, kalan 0, hak ve yenilenme hatanın ayrıntısından", async () => {
    const { r, calls } = await get(() => res(xml("hata-kota"), 429, { "X-Kota-Hak": "2", "X-Kota-Kalan": "0" }));
    assert.deepEqual(r, {
      status: "kota",
      quota: { day: "2026-11-02", hak: 2, kalan: 0, yenilenme: "2026-11-03T00:00:00+03:00", at: NOW.toISOString() },
      text: "ModPOS'un günlük 2 çekim hakkı doldu: hak bu gece 00:00'da yenilenir",
    });
    assert.equal(calls.length, 1);
    // Gövdesiz 429 da kota sayılır (hak bilinmiyorsa günlük hak)
    const bare = await get(() => res("", 429));
    assert.ok(bare.r.status === "kota");
    assert.deepEqual([bare.r.quota.kalan, bare.r.quota.hak, bare.r.text], [0, 2, "ModPOS istek sınırına takıldı: sonra yeniden denenecek"]);
    // Kısa sürede çok istek: kota değil, hata (hak düşmedi)
    const burst = await get(() => res(hataXml("COK_FAZLA_ISTEK"), 429, { "X-Kota-Hak": "2", "X-Kota-Kalan": "1" }));
    assert.ok(burst.r.status === "error");
    assert.deepEqual([burst.r.kod, burst.r.http, burst.r.keyError, burst.r.quota?.kalan], ["COK_FAZLA_ISTEK", 429, false, 1]);
  });

  test("401 / 403: anahtar hatası (keyError), metin ne yapılacağını söyler", async () => {
    const a = await get(() => res(hataXml("ANAHTAR_GECERSIZ", "API anahtarı geçersiz"), 401));
    assert.deepEqual(a.r, { status: "error", kod: "ANAHTAR_GECERSIZ", http: 401, text: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin", keyError: true, quota: null });
    const ip = await get(() => res(hataXml("IP_IZINSIZ", "İzin verilmeyen IP adresi"), 403));
    assert.ok(ip.r.status === "error");
    assert.deepEqual([ip.r.kod, ip.r.http, ip.r.keyError], ["IP_IZINSIZ", 403, true]);
    assert.match(ip.r.text, /IP kısıtı/);
    // Gövdesiz 401: kod HTTP_401, anahtar hatası değil (neden bilinmiyor)
    const bare = await get(() => res("", 401));
    assert.ok(bare.r.status === "error");
    assert.deepEqual([bare.r.kod, bare.r.keyError, bare.r.text], ["HTTP_401", false, "ModPOS isteği kabul etmedi (HTTP 401)"]);
  });

  test("500 RAPOR_URETILEMEDI ve 503: günlük hata, anahtar hatası değil; Cloudflare'in HTML sayfası da", async () => {
    const a = await get(() => res(hataXml("RAPOR_URETILEMEDI", "Rapor hazırlanamadı"), 500));
    assert.deepEqual(a.r, { status: "error", kod: "RAPOR_URETILEMEDI", http: 500, text: "ModPOS föyü hazırlayamadı (hak geri verildi): sonra yeniden denenecek", keyError: false, quota: null });
    const b = await get(() => res(hataXml("SERVIS_KULLANILAMIYOR"), 503));
    assert.ok(b.r.status === "error");
    assert.deepEqual([b.r.kod, b.r.http], ["SERVIS_KULLANILAMIYOR", 503]);
    const cf = await get(() => res("<!DOCTYPE html><html><body>502 Bad gateway</body></html>", 503, { "content-type": "text/html" }));
    assert.ok(cf.r.status === "error");
    assert.deepEqual([cf.r.kod, cf.r.http, cf.r.keyError, cf.r.text], ["HTTP_503", 503, false, "ModPOS şu an yanıt vermiyor (HTTP 503): sonra yeniden denenecek"]);
  });

  test("ağ hatası ve zaman aşımı: http 0, yeniden deneme yok", async () => {
    const net = await get(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(net.r, { status: "error", kod: "BAGLANTI", http: 0, text: "ModPOS'a bağlanılamadı: sonra yeniden denenecek", keyError: false, quota: null });
    assert.equal(net.calls.length, 1);
    // Zaman aşımı: istek sinyali (AbortSignal.timeout) gerçekten keser. Onun zamanlayıcısı süreci ayakta tutmaz (canlıda
    // açık soket tutar): test beklerken süreç kapanmasın
    const keepAlive = setTimeout(() => {}, 10_000);
    const slow = await get(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      { timeoutMs: 1500 },
    );
    clearTimeout(keepAlive);
    assert.deepEqual(slow.r, { status: "error", kod: "ZAMAN_ASIMI", http: 0, text: "ModPOS 2 saniyede yanıt vermedi: sonra yeniden denenecek", keyError: false, quota: null });
    const aborted = await get(() => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    assert.ok(aborted.r.status === "error");
    assert.equal(aborted.r.kod, "ZAMAN_ASIMI");
    // Gövde yarıda kesildi
    const cut = await get(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("<kasaFoyu><kasaGunu>2026-11-01"));
              c.error(new Error("socket hang up"));
            },
          }),
          { status: 200 },
        ),
    );
    assert.ok(cut.r.status === "error");
    assert.deepEqual([cut.r.kod, cut.r.http, cut.r.text], ["BAGLANTI", 200, "ModPOS'un yanıtı yarıda kesildi: sonra yeniden denenecek"]);
  });

  test("200 ama okunamayan gövde: BOZUK ve ilk sorunlu alanın yolu; başka günün föyü ve yarım gövde de", async () => {
    const amount = await get(() => res(xml("belge-ornegi").replace("<satis>8210</satis>", "<satis>1.234,50</satis>"), 200, KOTA));
    assert.ok(amount.r.status === "error");
    assert.deepEqual([amount.r.kod, amount.r.http, amount.r.keyError, amount.r.text], ["BOZUK", 200, false, "ModPOS'un yanıtı okunamadı (kasa.0.odeme.0.satis): sonra yeniden denenecek"]);
    assert.equal(amount.r.quota?.kalan, 0, "hak harcandı: başlıktan bilinir");
    const otherDay = await get(() => res(xml("iki-kasa")));
    assert.ok(otherDay.r.status === "error");
    assert.equal(otherDay.r.text, "ModPOS'un yanıtı okunamadı (kasaGunu): sonra yeniden denenecek");
    const full = xml("belge-ornegi");
    const half = await get(() => res(full.slice(0, full.indexOf("<ozet>"))));
    assert.ok(half.r.status === "error");
    assert.equal(half.r.text, "ModPOS'un yanıtı okunamadı (govde): sonra yeniden denenecek");
    const json = await get(() => res('{"ok":true}', 200, { "content-type": "application/json" }));
    assert.ok(json.r.status === "error");
    assert.equal(json.r.kod, "BOZUK");
  });

  test("bildirilen boyut 2 MB'tan büyükse gövde okunmaz", async () => {
    let cancelled = false;
    const big = new ReadableStream({
      pull(c) {
        c.enqueue(new TextEncoder().encode("<a>"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { r } = await get(() => new Response(big, { status: 200, headers: { "content-length": String(FOY_MAX_BYTES + 1), ...KOTA } }));
    assert.ok(r.status === "error");
    assert.deepEqual([r.kod, r.text, r.quota?.kalan], ["BUYUK", "ModPOS'un yanıtı beklenenden büyük; okunmadı", 0]);
    assert.equal(cancelled, true, "akış kapatıldı");
  });

  test("anahtar yoksa ya da bozuksa istek gitmez (off)", async () => {
    const a = await get(() => assert.fail("istek gitmemeli"), { env: {} });
    assert.deepEqual(a.r, { status: "off", problem: "missing" });
    const b = await get(() => assert.fail("istek gitmemeli"), { env: { MODPOS_API_KEY: "sk_kisa" } });
    assert.deepEqual(b.r, { status: "off", problem: "format" });
    assert.equal(a.calls.length + b.calls.length, 0);
    assert.equal(client.isModposConfigured({}), false);
    assert.equal(client.isModposConfigured(ENV), true);
  });

  test("servis anahtarı geri yazsa da (tanınmayan kod, mesaj) anahtar sonuca geçmez", async () => {
    const echo = await get(() => res(hataXml("ANAHTAR_KISITLI", `Anahtar ${KEY} bu uç için kısıtlı`), 403));
    assert.ok(echo.r.status === "error");
    assert.equal(echo.r.text, "ModPOS isteği kabul etmedi (HTTP 403, ANAHTAR_KISITLI): Anahtar [anahtar] bu uç için kısıtlı");
    const code = await get(() => res(hataXml(KEY, "x"), 400));
    assert.ok(code.r.status === "error");
    assert.equal(code.r.kod, "[anahtar]", "kod büyük harfe çevrilse de");
    // Uzun mesajın 160. karakterinde kesilecek anahtar: kesilmeden önce temizlenir
    const long = await get(() => res(hataXml("YENI", `${"x".repeat(140)} ${KEY}`), 400));
    assert.ok(long.r.status === "error");
    assert.ok(!long.r.text.includes(KEY.slice(0, 12)), long.r.text);
  });

  test("hiçbir sonuçta anahtar yok (bu bölümün bütün sonuçları)", () => {
    assert.ok(results.length >= 20, String(results.length));
    for (const r of results) {
      const s = JSON.stringify(r).toLowerCase();
      assert.ok(!s.includes(KEY.toLowerCase()), s.slice(0, 200));
    }
  });
});

// ---------------------------------------------------------------- scripts/modpos-foy.ts: komut satırı

describe("scripts/modpos-foy.ts: komut satırı", () => {
  test("seçenekler: gün, --dosya, --kaydet; anlaşılmayan seçenek ve ileri tarih reddedilir", () => {
    const now = new Date("2026-11-03T10:00:00+03:00");
    assert.deepEqual(parseFoyArgs(["2026-11-02"], now), { day: "2026-11-02", file: null, save: false });
    assert.deepEqual(parseFoyArgs(["2026-11-02", "--kaydet"], now), { day: "2026-11-02", file: null, save: true });
    assert.deepEqual(parseFoyArgs(["--dosya", "yanit.xml"], now), { day: null, file: "yanit.xml", save: false });
    assert.deepEqual(parseFoyArgs(["--dosya", "yanit.xml", "2026-11-01", "--kaydet"], now), { day: "2026-11-01", file: "yanit.xml", save: true });
    assert.throws(() => parseFoyArgs([], now), /Kullanım: npm run modpos:foy/);
    assert.throws(() => parseFoyArgs(["--kaydet"], now), /Kullanım/);
    assert.throws(() => parseFoyArgs(["2026-11-04"], now), /ileri tarih/);
    assert.throws(() => parseFoyArgs(["2026-02-30"], now), /Takvimde olmayan gün: 2026-02-30/);
    assert.throws(() => parseFoyArgs(["2026-11-01", "2026-11-02"], now), /Tek gün verilir/);
    assert.throws(() => parseFoyArgs(["2026-11-02", "--sil"], now), /Anlaşılmayan seçenek: --sil/);
    assert.throws(() => parseFoyArgs(["--dosya"], now), /--dosya/);
  });

  test("özet: durum, Z no, ciro, panelin alanları, kod kod ödemeler ve kırılım, nakit mutabakatı, uyarılar, kota", () => {
    const now = new Date("2026-11-02T12:00:00+03:00");
    const out = foySummaryLines(foyOf("belge-ornegi"), { now, fetchedAt: now, quota: null }).map(plain).join("\n");
    for (const part of [
      "ModPOS kasa föyü: 1 Kasım Pazar (2026-11-01)",
      "Durum: kapalı · kesin",
      "Z no: 0312",
      "Ciro: 28.450,50 ₺",
      "Nakit: 8.210 ₺",
      "Kredi / banka kartı: 16.120,50 ₺",
      "Ödenmez / ikram (ciro dışı): 145 ₺",
      "NAKIT (Nakit): satış 8.210 ₺",
      "KREDI_KARTI (Kredi Kartı): satış 16.120,50 ₺ · cari tahsilat 1.500 ₺",
      "Garanti BBVA 9.800 ₺",
      "Akbank 6.320,50 ₺",
      "IKRAM (İkram): ciroya dahil değil · 145 ₺",
      "Nakit mutabakatı (Z raporu): açılış 500 ₺ + nakit satış 8.210 ₺ + nakit cari tahsilat 0 ₺ − gider 870 ₺ = beklenen 7.840 ₺ · sayılan 7.820 ₺ · fark -20 ₺",
      "Kasa farkı var (-20 ₺)",
      "Ödemelerin ciroya dahil toplamı ciroyu tutmuyor: -4.120 ₺",
      "Kalan hak (föyde): 1 / 2",
    ]) {
      assert.ok(out.includes(part), `${part}\n---\n${out}`);
    }
    assert.doesNotMatch(out, /Ayşe|Mehmet|Yıldız Lojistik/);
    const acik = foySummaryLines(foyOf("acik-gun"), { now, fetchedAt: now, quota: null }).map(plain).join("\n");
    assert.match(acik, /Durum: açık \(gün sürüyor, tutarlar değişebilir\) · kesin değil/);
    assert.match(acik, /Sayılan nakit yok: gün açık/);
    const foysuz = foySummaryLines(foyOf("foysuz-gun"), { now, fetchedAt: now, quota: null }).map(plain).join("\n");
    assert.match(foysuz, /Durum: kasa açılmamış \(föysüz gün\) · kesin/);
    const bos = foySummaryLines({ kasaGunu: "2026-10-26", olusturulma: null, kasalar: [], foysuzGunler: [], ozet: null, kota: null }, { now, fetchedAt: now, quota: null });
    assert.match(plain(bos.join("\n")), /Durum: satış yok/);
  });

  test("çekme (sahte ModPOS, veritabanısız): özet ve bugünkü kalan hak; hata ve hak doldu çıkış 1; anahtar hiçbir satırda yok", async () => {
    const realFetch = globalThis.fetch;
    const realLog = console.log;
    const realError = console.error;
    const out: string[] = [];
    const calls: string[] = [];
    let answer: () => Response = () => new Response(xml("belge-ornegi"), { status: 200, headers: { "X-Kota-Hak": "2", "X-Kota-Kalan": "0", "X-Kota-Yenilenme": "2026-11-03T00:00:00+03:00" } });
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void out.push(a.join(" "));
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(String(input));
      assert.equal(new Headers(init?.headers).get("x-api-key"), KEY);
      return answer();
    }) as typeof fetch;
    const now = new Date("2026-11-02T08:00:00+03:00");
    const codes: number[] = [];
    try {
      // DATABASE_URL yok: --kaydet olmadan veritabanına hiç bağlanılmaz
      codes.push(await runModposFoy(["2026-11-01"], { MODPOS_API_KEY: KEY }, now));
      answer = () => new Response("<hata><kod>ANAHTAR_GECERSIZ</kod><mesaj>API anahtarı geçersiz</mesaj></hata>", { status: 401 });
      codes.push(await runModposFoy(["2026-11-01"], { MODPOS_API_KEY: KEY }, now));
      answer = () => new Response(xml("hata-kota"), { status: 429 });
      codes.push(await runModposFoy(["2026-11-01"], { MODPOS_API_KEY: KEY }, now));
      answer = () => new Response(`<hata><kod>YENI</kod><mesaj>Anahtar ${KEY} kısıtlı</mesaj></hata>`, { status: 403 });
      codes.push(await runModposFoy(["2026-11-01"], { MODPOS_API_KEY: KEY }, now));
      codes.push(await runModposFoy(["2026-11-01"], {}, now), await runModposFoy(["2026-11-01", "--kaydet"], { MODPOS_API_KEY: KEY }, now));
    } finally {
      globalThis.fetch = realFetch;
      console.log = realLog;
      console.error = realError;
    }
    const text = plain(out.join("\n"));
    assert.deepEqual(codes, [0, 1, 1, 1, 1, 1]);
    assert.deepEqual(calls, Array(4).fill(`${MODPOS_DEFAULT_URL}?tarih=2026-11-01`), "anahtarsız ve veritabanısız --kaydet istek göndermez");
    for (const part of [
      "İstek: 2026-11-01 (günün çekim haklarından birini kullanır",
      "Durum: kapalı · kesin",
      "Kalan hak (bugün): 0 / 2 · hak bu gece 00:00'da yenilenir",
      "Veritabanına yazılmadı (--kaydet ile yazılır).",
      "✗ ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin (ANAHTAR_GECERSIZ, HTTP 401)",
      "✗ ModPOS'un günlük 2 çekim hakkı doldu: hak bu gece 00:00'da yenilenir",
      "✗ ModPOS isteği kabul etmedi (HTTP 403, YENI): Anahtar [anahtar] kısıtlı (YENI, HTTP 403)",
      "✗ MODPOS_API_KEY tanımlı değil",
      "✗ DATABASE_URL tanımlı değil (--kaydet veritabanına yazar)",
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
    assert.ok(!text.toLowerCase().includes(KEY.toLowerCase()), "anahtar yazılmadı");
  });

  test("--dosya bütün fikstürlerde çalışır, istek göndermez ve anahtarı yazmaz", () => {
    for (const name of ["belge-ornegi", "acik-gun", "iki-kasa", "foysuz-gun", "otomatik-kapanis", "bilinmeyen-kod", "hata-kota"]) {
      const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/modpos-foy.ts", "--dosya", join(FIX, `${name}.xml`)], {
        cwd: process.cwd(),
        encoding: "utf8",
        // Anahtar ortamda olsa da: dosya okunur, istek gitmez (MODPOS_API_URL'e bağlanılsa bağlantı reddedilirdi)
        env: { ...process.env, MODPOS_API_KEY: KEY, MODPOS_API_URL: "https://127.0.0.1:9/yok", DATABASE_URL: "" },
        timeout: 60_000,
      });
      const all = `${r.stdout}\n${r.stderr}`;
      assert.ok(!all.toLowerCase().includes(KEY.toLowerCase()), name);
      if (name === "hata-kota") {
        assert.equal(r.status, 1, all);
        assert.match(plain(r.stderr), /ModPOS hata döndü: KOTA_DOLDU · Günlük kasa föyü çekim hakkı \(2\) doldu/);
        continue;
      }
      assert.equal(r.status, 0, all);
      assert.match(r.stdout, /ModPOS kasa föyü: /, name);
      assert.match(r.stdout, /Veritabanına yazılmadı/, name);
    }
    // Dosyanın günü istenen günden farklıysa söyler
    const other = spawnSync(process.execPath, ["--import", "tsx", "scripts/modpos-foy.ts", "--dosya", join(FIX, "otomatik-kapanis.xml"), "2026-10-29"], { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 });
    assert.equal(other.status, 1);
    assert.match(other.stderr, /Dosyanın kasa günü 2026-10-28, istenen gün 2026-10-29: başka günün föyü/);
    const half = spawnSync(process.execPath, ["--import", "tsx", "scripts/modpos-foy.ts", "--dosya", join(FIX, "yok.xml")], { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 });
    assert.equal(half.status, 1);
    assert.match(half.stderr, /Dosya okunamadı: ENOENT/);
  });
});

// Yerel doğrulama yardımcısı: `todayTR` testte kullanılan saat diliminin TR olduğunu gösterir
test("TR günü: Europe/Istanbul (yaz saati yok, +03:00)", () => {
  assert.equal(todayTR(new Date("2026-11-02T21:00:00Z")), "2026-11-03");
  assert.equal(todayTR(new Date("2026-07-01T20:59:59Z")), "2026-07-01");
});
