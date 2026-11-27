// AsilPOS'un ModPOS dönemi ucu, saf taraf (docs/ASILPOS.md › ModPOS dönemi: `GET /api/panel/pos/modpos-gunler`): isteğin
// denetimi (503 / 401 / 400 / 409), günün biçimi (ciro = ödemelerin toplamı, ödenmez ayrı, KDV dökümü ya da %10),
// günün kaynağı (`kaynak`: kasa raporu ya da yalnız föy; föy gününde indirim bilinmez, null), kapanmış föyün günü,
// pencere (geçiş gününden önceki en çok 400 gün) ve ModPOS ürün listesinin dönem bloğu. Sözleşmenin rakamları (Marina
// 13–21 Kasım 2026, CONTRACT §6) burada da çıkar; veritabanından okuma tests/asilpos-modpos-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/asilpos-modpos.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { signedHeaders } from "../src/lib/karaoke/signature";
import {
  checkModposDaysRequest,
  MODPOS_DAYS_MAX,
  MODPOS_PRODUCTS_MAX,
  modposDay,
  modposDays,
  modposFoyInput,
  modposKdv,
  modposProducts,
  modposSube,
  modposWindow,
  type ModposDayInput,
  type ModposListLine,
} from "../src/lib/asilpos/modpos-gunler";
import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import { foyZ } from "../src/lib/modpos/z";
import { addDays } from "../src/lib/reminders";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const NOW = new Date("2026-11-23T10:00:00+03:00").getTime();
const url = (q: string) => new URL(`https://ladmin.laffogato.net/api/panel/pos/modpos-gunler${q}`);

/** CONTRACT §6: gün, ciro, kart, nakit, indirim, ödenmez, fiş, ModPOS Z (TL) */
export const MARINA: [string, number, number, number, number, number, number, string][] = [
  ["2026-11-13", 390, 195, 195, 0, 0, 2, "Z-2026-002"],
  ["2026-11-14", 3311, 2687.25, 623.75, 249, 0, 14, "Z-2026-003"],
  ["2026-11-15", 5753, 4146.5, 1606.5, 517, 190, 27, "Z-2026-004"],
  ["2026-11-16", 2670, 2140, 530, 0, 0, 9, "Z-2026-005"],
  ["2026-11-17", 1641.25, 1171.25, 470, 153.75, 455, 12, "Z-2026-006"],
  ["2026-11-18", 2419.25, 1814.5, 604.75, 315.75, 400, 16, "Z-2026-007"],
  ["2026-11-19", 2535.75, 1472.5, 1063.25, 204.25, 200, 19, "Z-2026-008"],
  ["2026-11-20", 4008, 2914.25, 1093.75, 397, 255, 19, "Z-2026-009"],
  ["2026-11-21", 4620.5, 3203, 1417.5, 229.5, 0, 17, "Z-2026-010"],
];

const input = ([date, , kart, nakit, indirim, odenmez, fis, zNo]: (typeof MARINA)[number]): ModposDayInput => ({
  kaynak: "kasa_raporu",
  date,
  zNo,
  receipts: fis,
  cash: nakit,
  card: kart,
  mealCard: 0,
  online: 0,
  other: 0,
  discounts: indirim,
  offRevenue: odenmez,
});

/** Kuruş toplamı (kayan nokta artığı olmadan) */
const sumK = (xs: number[]) => xs.reduce((a, v) => a + Math.round(v * 100), 0);

const KEYS = ["date", "ciro", "kart", "nakit", "yemek", "online", "diger", "indirim", "odenmez", "ikram", "fis", "zNo", "kdv", "kaynak"];

test("istek: anahtar yoksa 503, imza yok / yanlış / başka uç / başka sorgu 401, şube yok ya da bozuksa 400, başka şube 409", () => {
  const check = (u: URL, o: { sign?: URL; secret?: string | null; now?: number } = {}) => {
    const h = signedHeaders(SECRET, "GET", o.sign ?? u, "", NOW);
    return checkModposDaysRequest({ expected: "marina", secret: o.secret === undefined ? SECRET : o.secret, url: u, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now: o.now ?? NOW });
  };
  assert.deepEqual(check(url("?sube=marina")), { ok: true, sube: "marina" });
  assert.deepEqual(check(url("?sube=marina"), { secret: null }), { ok: false, status: 503, body: { error: "not_configured" } });
  const unauthorized = { ok: false, status: 401, body: { error: "unauthorized" } };
  assert.deepEqual(check(url("?sube=marina"), { sign: new URL("https://ladmin.laffogato.net/api/panel/pos/urunler") }), unauthorized, "maliyet ucunun imzası geçmez");
  assert.deepEqual(check(url("?sube=marina"), { sign: url("?sube=tuzla") }), unauthorized, "şube imzanın içinde");
  assert.deepEqual(check(url("?sube=marina"), { now: NOW + 301_000 }), unauthorized, "5 dakikadan eski");
  const h = signedHeaders(SECRET, "GET", url("?sube=marina"), "", NOW);
  assert.deepEqual(checkModposDaysRequest({ expected: "marina", secret: SECRET, url: url("?sube=marina"), timestamp: h["x-laf-timestamp"], signature: null, now: NOW }), unauthorized);
  // İmza şubeden önce: imzasız istek şubenin geçerli olup olmadığını öğrenmez
  assert.deepEqual(checkModposDaysRequest({ expected: "marina", secret: SECRET, url: url("?sube=tuzla"), timestamp: null, signature: null, now: NOW }), unauthorized);
  const invalid = { ok: false, status: 400, body: { error: "invalid", field: "sube" } };
  for (const q of ["", "?sube=", "?sube=Marina", "?sube=m", "?sube=marina%20", "?sube=marina&sube=tuzla", `?sube=${"a".repeat(25)}`]) assert.deepEqual(check(url(q)), invalid, q);
  assert.deepEqual(check(url("?sube=tuzla")), { ok: false, status: 409, body: { error: "wrong_branch", sube: "tuzla", expected: "marina" } });
  assert.deepEqual(check(url("?sube=kadikoy-2")), { ok: false, status: 409, body: { error: "wrong_branch", sube: "kadikoy-2", expected: "marina" } });
  // Başka sorgu parametresi imzalıysa yok sayılır
  assert.deepEqual(check(url("?sube=marina&v=1")), { ok: true, sube: "marina" });
});

test("şube parametresi: tek, küçük harf, 2-24 karakter (gün sonu gövdesinin `sube` kuralı)", () => {
  assert.equal(modposSube(url("?sube=marina")), "marina");
  assert.equal(modposSube(url("?sube=tuzla-2")), "tuzla-2");
  assert.equal(modposSube(url("")), null);
  assert.equal(modposSube(url("?sube=2marina")), null);
  assert.equal(modposSube(url("?sube=marina&sube=marina")), null);
});

test("pencere: geçiş gününden önceki en çok 400 gün (geçiş günü dahil değil)", () => {
  assert.equal(MODPOS_DAYS_MAX, 400);
  const w = modposWindow("2026-11-22");
  assert.deepEqual(w, { from: "2025-10-18", to: "2026-11-21" });
  assert.equal(addDays(w.from, MODPOS_DAYS_MAX - 1), w.to, "iki uç dahil 400 gün");
});

test("gün: ciro ödemelerin toplamı (indirimden sonra, ödenmez hariç); alanlar sözleşmenin sırasıyla, TL iki ondalık", () => {
  const d = modposDay(input(MARINA[1]));
  assert.deepEqual(d, {
    date: "2026-11-14",
    ciro: 3311,
    kart: 2687.25,
    nakit: 623.75,
    yemek: 0,
    online: 0,
    diger: 0,
    indirim: 249,
    odenmez: 0,
    ikram: 0,
    fis: 14,
    zNo: "Z-2026-003",
    kdv: [{ rate: 10, base: 3010, vat: 301 }],
    kaynak: "kasa_raporu",
  });
  assert.deepEqual(Object.keys(d!), KEYS);
  // Yemek kartı, online ve diğer de ciroya girer; Z toplamı (ödenmezi içerse de) girdi değil: ciro hep ödemelerin toplamı
  const all = modposDay({ kaynak: "kasa_raporu", date: "2026-11-15", zNo: " 0042 ", receipts: 3, cash: 100.1, card: 200.2, mealCard: 50.05, online: 30, other: 9.99, discounts: 0, offRevenue: 25.5 })!;
  assert.equal(all.ciro, 390.34);
  assert.deepEqual([all.yemek, all.online, all.diger, all.indirim, all.odenmez, all.ikram], [50.05, 30, 9.99, 0, 25.5, 0]);
  assert.equal(all.zNo, "0042", "baştaki sıfırlar korunur, boşluk kırpılır");
  assert.deepEqual(all.kdv, [{ rate: 10, base: 354.85, vat: 35.49 }]);
  // Boş Z no ve fiş sayısı
  const bare = modposDay({ kaynak: "kasa_raporu", date: "2026-11-16", zNo: "  ", receipts: null, cash: 10, card: 0, mealCard: 0, online: 0, other: 0, discounts: 0, offRevenue: null })!;
  assert.equal(bare.zNo, null);
  assert.equal(bare.fis, 0);
  // Satışı, indirimi, ödenmezi ve fişi olmayan gün gitmez (kapalı gün, satışsız föy)
  assert.equal(modposDay({ kaynak: "kasa_raporu", date: "2026-11-17", zNo: "Z-1", receipts: 0, cash: 0, card: 0, mealCard: 0, online: 0, other: 0, discounts: null, offRevenue: 0 }), null);
  assert.equal(modposDay({ kaynak: "foy", date: "2026-11-17", zNo: "Z-1", receipts: 0, cash: 0, card: 0, mealCard: 0, online: 0, other: 0, discounts: null, offRevenue: 0 }), null, "satışsız föy");
  // Yalnız ödenmezli gün gider (ciro 0, KDV satırı yok)
  const comp = modposDay({ kaynak: "kasa_raporu", date: "2026-11-18", zNo: null, receipts: 1, cash: 0, card: 0, mealCard: 0, online: 0, other: 0, discounts: 0, offRevenue: 120 })!;
  assert.deepEqual([comp.ciro, comp.odenmez, comp.kdv], [0, 120, []]);
  // Eksi tutar gitmez (sözleşme: tutarlar ≥ 0)
  const neg = modposDay({ kaynak: "kasa_raporu", date: "2026-11-19", zNo: null, receipts: 1, cash: 50, card: -0.001, mealCard: 0, online: 0, other: -5, discounts: -1, offRevenue: -2 })!;
  assert.deepEqual([neg.ciro, neg.kart, neg.diger, neg.indirim, neg.odenmez], [50, 0, 0, 0, 0]);
});

/** Kitapçığın örnek föyleri (tests/fixtures/modpos): kafenin verisi değil */
const fixture = (name: string): KasaFoyu => {
  const p = parseKasaFoyu(readFileSync(join(__dirname, `fixtures/modpos/${name}.xml`), "utf8"));
  assert.ok(p.ok, name);
  return p.foy;
};

test("kaynak ve indirim: kasa raporu günü `kasa_raporu` (girilen indirim, 0 dahil); föy günü `foy`, indirimi null (bilinmiyor, 0 değil)", () => {
  const base = { date: "2026-11-16", zNo: "Z-2026-005", receipts: 9, cash: 530, card: 2140, mealCard: 0, online: 0, other: 0, offRevenue: 0 };
  const rapor = modposDay({ ...base, kaynak: "kasa_raporu", discounts: 0 })!;
  assert.equal(rapor.kaynak, "kasa_raporu");
  assert.equal(rapor.indirim, 0, "raporda yazılan 0 indirim 0'dır");
  const foy = modposDay({ ...base, kaynak: "foy", discounts: null })!;
  assert.equal(foy.kaynak, "foy");
  assert.equal(foy.indirim, null, "föyde indirim yok: bilinmiyor");
  // Föyde indirim alanı yok: föy gününe bir tutar verilse de yazılmaz
  assert.equal(modposDay({ ...base, kaynak: "foy", discounts: 120 })!.indirim, null);
  // Kasa raporunda indirim yazılmamışsa (isteğe bağlı alan) o da bilinmez: null, 0 değil
  assert.equal(modposDay({ ...base, kaynak: "kasa_raporu", discounts: null })!.indirim, null);
  // Rakamların gerisi kaynaktan bağımsız
  const figures = (d: NonNullable<ReturnType<typeof modposDay>>) => [d.date, d.ciro, d.kart, d.nakit, d.yemek, d.online, d.diger, d.odenmez, d.ikram, d.fis, d.zNo, d.kdv];
  assert.deepEqual(figures(foy), figures(rapor));
  // İndirimi bilinmeyen günün boşluğu da ciro, ödenmez ve fişle ölçülür
  assert.equal(modposDay({ ...base, kaynak: "foy", discounts: null, cash: 0, card: 0, receipts: 0 }), null);
});

test("föy günü: yalnız kapanmış föy (bütün kasalar kapalı ya da kesinleşmiş föysüz satış); açık kasa, kesinleşmemiş föysüz gün ve satışsız gün gitmez", () => {
  // Kapalı kasalı föy: Z'nin rakamları, kaynak foy, indirim ve KDV dökümü yok (ModPOS föyü ikisini de vermez)
  const closed = fixture("belge-ornegi");
  const z = foyZ(closed)!;
  const day = { day: "2026-11-01", state: "KAPALI" as const, final: true, foy: closed };
  assert.deepEqual(modposFoyInput(day), {
    kaynak: "foy",
    date: "2026-11-01",
    zNo: z.zNo,
    receipts: z.receipts,
    cash: z.cash,
    card: z.card,
    mealCard: z.mealCard,
    online: z.online,
    other: z.other,
    discounts: null,
    offRevenue: z.offRevenue,
    vat: null,
  });
  assert.equal(modposFoyInput({ ...day, final: false })?.kaynak, "foy", "kasalar kapandıysa sabahın kesin föyü beklenmez");
  // Açık kasa: tutarlar daha değişir
  assert.equal(modposFoyInput({ day: "2026-11-02", state: "ACIK", final: false, foy: fixture("acik-gun") }), null);
  // Kasası açılmamış (föysüz) satış: kesinleşince gider, gün içinde alınmışsa gitmez
  const foysuz = fixture("foysuz-gun");
  assert.equal(modposFoyInput({ day: "2026-10-25", state: "BOS", final: false, foy: foysuz }), null);
  const fz = modposFoyInput({ day: "2026-10-25", state: "BOS", final: true, foy: foysuz })!;
  assert.deepEqual([fz.kaynak, fz.zNo, fz.discounts, fz.vat], ["foy", null, null, null]);
  // Satışsız gün (kasa açılmamış, föysüz satış yok): gün yok
  assert.equal(modposFoyInput({ day: "2026-10-26", state: "BOS", final: true, foy: { ...closed, kasaGunu: "2026-10-26", kasalar: [], foysuzGunler: [] } }), null);
  // Günü föyün saklandığı gün verir; gün biçimi modposDay'inki
  const out = modposDay(modposFoyInput(day)!)!;
  assert.deepEqual([out.date, out.kaynak, out.indirim, out.ciro], ["2026-11-01", "foy", null, Math.round((z.cash + z.card + z.mealCard + z.online + z.other) * 100) / 100]);
});

test("KDV kaynağa göre: kasa raporunun yazarkasa dökümü ciroyu tutuyorsa o (karaoke %20 ayrı); tutmuyorsa ya da föy gününde tek satır %10; %20 hiç varsayılmaz", () => {
  const base = { date: "2026-11-21", zNo: "Z-2026-010", receipts: 17, cash: 1417.5, card: 3203, mealCard: 0, online: 0, other: 0, discounts: 229.5, offRevenue: 0 };
  // Marina'da %20 yalnız karaoke: yazarkasa dökümü ciroyu kuruşu kuruşuna tutuyorsa oran oran o
  const okc = [
    { rate: 10, total: 3870.5, vat: 351.86 },
    { rate: 20, total: 750, vat: 125 },
  ];
  assert.deepEqual(modposDay({ ...base, kaynak: "kasa_raporu", vat: okc })!.kdv, [
    { rate: 10, base: 3518.64, vat: 351.86 },
    { rate: 20, base: 625, vat: 125 },
  ]);
  // Döküm ciroyu tutmuyor (yazarkasa dışı satış): oranlar bilinmez, tek satır %10 (dökümdeki %20 ölçeklenmez)
  const tenOnly = [{ rate: 10, base: 4200.45, vat: 420.05 }];
  assert.deepEqual(modposDay({ ...base, kaynak: "kasa_raporu", vat: [{ rate: 20, total: 750, vat: 125 }] })!.kdv, tenOnly);
  assert.deepEqual(modposDay({ ...base, kaynak: "kasa_raporu", vat: null })!.kdv, tenOnly);
  // Föy gününde döküm yok (ModPOS föyü KDV dökümü vermez, panel saklamaz): tek satır %10
  const foyDay = modposDay(modposFoyInput({ day: "2026-11-01", state: "KAPALI", final: true, foy: fixture("belge-ornegi") })!)!;
  assert.equal(foyDay.kdv.length, 1);
  assert.equal(foyDay.kdv[0].rate, 10);
  assert.equal(sumK(foyDay.kdv.map((k) => k.base + k.vat)), Math.round(foyDay.ciro * 100), "KDV dahil = ciro");
  // Hiçbir günde %20 kendiliğinden çıkmaz
  for (const d of [modposDay({ ...base, kaynak: "kasa_raporu" })!, foyDay]) assert.ok(d.kdv.every((k) => k.rate === 10), d.date);
});

test("KDV: kasa raporunun yazarkasa dökümü ciroyu kuruşu kuruşuna tutuyorsa o; yoksa tek satır %10, matrah = round(ciro × 100 / 110)", () => {
  assert.deepEqual(modposKdv(390), [{ rate: 10, base: 354.55, vat: 35.45 }]);
  assert.deepEqual(modposKdv(0), []);
  // Döküm ciroyu tutuyor: oran oran, matrah = toplam − KDV
  const vat = [
    { rate: 20, total: 220, vat: 36.67 },
    { rate: 10, total: 880, vat: 80 },
  ];
  assert.deepEqual(modposKdv(1100, vat), [
    { rate: 10, base: 800, vat: 80 },
    { rate: 20, base: 183.33, vat: 36.67 },
  ]);
  // Tutmuyor (yazarkasa ModPOS'un cirosundan farklı), bozuk ya da boş: %10
  assert.deepEqual(modposKdv(1100, [{ rate: 10, total: 1000, vat: 90.91 }]), [{ rate: 10, base: 1000, vat: 100 }]);
  assert.deepEqual(modposKdv(1100, [{ rate: 10, total: 1100, vat: 1200 }]), [{ rate: 10, base: 1000, vat: 100 }], "KDV toplamdan büyük");
  assert.deepEqual(modposKdv(1100, [{ rate: 10.5, total: 1100, vat: 100 }]), [{ rate: 10, base: 1000, vat: 100 }], "oran tam sayı değil");
  assert.deepEqual(modposKdv(1100, []), [{ rate: 10, base: 1000, vat: 100 }]);
  assert.deepEqual(modposKdv(1100, null), [{ rate: 10, base: 1000, vat: 100 }]);
  // Sıfır grup atlanır
  assert.deepEqual(modposKdv(1100, [{ rate: 1, total: 0, vat: 0 }, ...vat]), modposKdv(1100, vat));
});

test("günler: Marina 13–21 Kasım (CONTRACT §6) toplamları, KDV hariç 24.862,51; pencere dışı ve geçiş günü gitmez; sıralı", () => {
  const window = modposWindow("2026-11-22");
  const extra: ModposDayInput[] = [
    { ...input(MARINA[0]), date: "2026-11-22" },
    { ...input(MARINA[0]), date: addDays(window.from, -1) },
  ];
  const days = modposDays([...MARINA.map(input).reverse(), ...extra], window);
  assert.deepEqual(
    days.map((d) => d.date),
    MARINA.map((r) => r[0]),
  );
  for (const [i, [date, ciro, kart, nakit, indirim, odenmez, fis, zNo]] of MARINA.entries()) {
    const d = days[i];
    assert.deepEqual([d.date, d.ciro, d.kart, d.nakit, d.indirim, d.odenmez, d.fis, d.zNo], [date, ciro, kart, nakit, indirim, odenmez, fis, zNo], date);
    assert.equal(Math.round(d.ciro * 100), Math.round((d.kart + d.nakit + d.yemek + d.online + d.diger) * 100), `${date}: ciro ödemelerin toplamı`);
    assert.equal(sumK(d.kdv.map((k) => k.base + k.vat)), Math.round(d.ciro * 100), `${date}: KDV dahil = ciro`);
  }
  assert.equal(sumK(days.map((d) => d.ciro)), 2_734_875);
  assert.equal(sumK(days.map((d) => d.kart)), 1_974_425);
  assert.equal(sumK(days.map((d) => d.nakit)), 760_450);
  assert.equal(sumK(days.map((d) => d.yemek)), 0);
  assert.equal(sumK(days.map((d) => d.indirim ?? 0)), 206_625);
  assert.equal(sumK(days.map((d) => d.odenmez + d.ikram)), 150_000);
  assert.equal(days.reduce((a, d) => a + d.fis, 0), 135);
  assert.equal(sumK(days.flatMap((d) => d.kdv.map((k) => k.base))), 2_486_251, "KDV hariç (gün gün) 24.862,51");
  assert.equal(sumK(days.flatMap((d) => d.kdv.map((k) => k.vat))), 248_624);
  assert.deepEqual(
    days.map((d) => Math.round(d.kdv[0].base * 100)),
    [35455, 301000, 523000, 242727, 149205, 219932, 230523, 364364, 420045],
  );
  // Aynı gün iki kez verilirse ilki (yükleyici raporu föyden önce verir)
  const twice = modposDays([input(MARINA[0]), { ...input(MARINA[0]), card: 999 }], window);
  assert.deepEqual(
    twice.map((d) => d.kart),
    [195],
  );
});

/** §6 ürün listesi: 31 satır, 240 adet, 29.415,00 (indirim öncesi) */
const LIST: ModposListLine[] = Array.from({ length: 31 }, (_, i) => ({
  month: "2026-11",
  posName: `ÜRÜN ${String(i + 1).padStart(2, "0")}`,
  qty: i < 23 ? 8 : 7,
  revenue: i < 30 ? 950 : 915,
  productName: null,
  productSize: null,
}));

test("ürünler: Marina'nın Kasım listesi 13–21 Kasım bloğu (31 satır, 240 adet, 29.415,00); kapsam ve geçiş gününe göre uçlar", () => {
  const window = modposWindow("2026-11-22");
  const days = modposDays(MARINA.map(input), window);
  const p = modposProducts({ lines: LIST, coverage: { "2026-11": "2026-11-21" }, window, days });
  assert.ok(p, "blok var");
  assert.equal(p.from, "2026-11-13", "ayın ilk ModPOS günü (şube 13'ünde açıldı)");
  assert.equal(p.to, "2026-11-21");
  assert.equal(p.rows.length, 31);
  assert.equal(p.rows.reduce((a, r) => a + r.adet, 0), 240);
  assert.equal(sumK(p.rows.map((r) => r.tutar)), 2_941_500);
  assert.equal(sumK(p.rows.map((r) => r.tutar)), sumK(days.map((d) => d.ciro + (d.indirim ?? 0))), "indirim öncesi = ciro + indirim");
  for (const r of p.rows) assert.deepEqual(Object.keys(r), ["ad", "boy", "adet", "tutar"]);
  // Kapsam kaydı yoksa (ayın tamamı) son gün geçiş gününden önceki gün
  assert.equal(modposProducts({ lines: LIST, coverage: {}, window, days })!.to, "2026-11-21");
  // Gün yoksa ayın 1'i
  assert.equal(modposProducts({ lines: LIST, coverage: { "2026-11": "2026-11-21" }, window, days: [] })!.from, "2026-11-01");
  // Liste yoksa null
  assert.equal(modposProducts({ lines: [], coverage: {}, window, days }), null);
  assert.equal(modposProducts({ lines: [{ ...LIST[0], qty: 0, revenue: 0 }], coverage: {}, window, days }), null, "boş satır");
});

test("ürünler: ad ve boy panelin ürününden (M/L; tek boy null), bağlanmamışsa ModPOS adı; aynı ürün birleşir; tutara göre sıralı", () => {
  const window = modposWindow("2026-11-22");
  const line = (posName: string, qty: number, revenue: number, productName: string | null = null, productSize: string | null = null): ModposListLine => ({
    month: "2026-11",
    posName,
    qty,
    revenue,
    productName,
    productSize,
  });
  const p = modposProducts({
    lines: [
      line("LATTE MEDIUM", 10, 1500, "Latte", "M"),
      line("LATTE LARGE", 4, 720, "Latte", "L"),
      line("LATTE ORTA", 2, 300, "Latte", "M"),
      line("TIRAMISU", 3, 750, "Tiramisu", "Tek"),
      line("PUMPKIN LATTE", 1, 200),
      line("KARAOKE ODASI", 1, 750),
    ],
    coverage: { "2026-11": "2026-11-21" },
    window,
    days: [],
  })!;
  assert.deepEqual(p.rows, [
    { ad: "Latte", boy: "M", adet: 12, tutar: 1800 },
    { ad: "KARAOKE ODASI", boy: null, adet: 1, tutar: 750 },
    { ad: "Tiramisu", boy: null, adet: 3, tutar: 750 },
    { ad: "Latte", boy: "L", adet: 4, tutar: 720 },
    { ad: "PUMPKIN LATTE", boy: null, adet: 1, tutar: 200 },
  ]);
});

test("ürünler: dönem pencere içinde, en son listeli aya kesintisiz uzanan aylar; en çok 500 satır (fazlası tek satırda)", () => {
  const window = modposWindow("2026-11-22");
  const of = (month: string, posName: string, revenue = 100): ModposListLine => ({ month, posName, qty: 1, revenue, productName: null, productSize: null });
  // Ekim ve Kasım kesintisiz; Ağustos'la arada Eylül yok: Ağustos girmez
  const p = modposProducts({ lines: [of("2026-08", "ESKİ"), of("2026-10", "EKİM"), of("2026-11", "KASIM")], coverage: {}, window, days: [] })!;
  assert.deepEqual([p.from, p.to], ["2026-10-01", "2026-11-21"]);
  assert.deepEqual(
    p.rows.map((r) => r.ad),
    ["EKİM", "KASIM"],
  );
  // Ayı pencerenin başından önce başlayan liste girmez (pencere dışındaki günleri de kapsar)
  const old = modposProducts({ lines: [of("2025-10", "PENCERE DIŞI"), of("2025-11", "İLK")], coverage: {}, window, days: [] })!;
  assert.deepEqual(
    old.rows.map((r) => r.ad),
    ["İLK"],
  );
  assert.equal(old.from, "2025-11-01");
  // Çok satır: ilk 499 satır kendisi, kalanı "Diğer ürünler" (toplam değişmez)
  const many = Array.from({ length: MODPOS_PRODUCTS_MAX + 20 }, (_, i) => of("2026-11", `ÜRÜN ${i}`, 1000 - i));
  const big = modposProducts({ lines: many, coverage: {}, window, days: [] })!;
  assert.equal(big.rows.length, MODPOS_PRODUCTS_MAX);
  assert.deepEqual(big.rows.at(-1), { ad: "Diğer ürünler", boy: null, adet: 21, tutar: many.slice(MODPOS_PRODUCTS_MAX - 1).reduce((a, l) => a + l.revenue, 0) });
  assert.equal(sumK(big.rows.map((r) => r.tutar)), sumK(many.map((l) => l.revenue)));
});

test("ürünler: eksi satır (iade, düzeltme) eksi gitmez, toplam değişmez: ürüne bağlıysa ürünün satırında düşülür, değilse en küçük satırlarla 'Diğer ürünler ve iadeler'de; liste eksiye inerse blok yok", () => {
  const window = modposWindow("2026-11-22");
  const coverage = { "2026-11": "2026-11-21" };
  const line = (posName: string, qty: number, revenue: number, productName: string | null = null, productSize: string | null = null): ModposListLine => ({
    month: "2026-11",
    posName,
    qty,
    revenue,
    productName,
    productSize,
  });
  // İnceleme bulgusu: LATTE 5 / 500 yanında bağlanmamış LATTE IADE −1 / −100. AsilPOS eksi satırı düşürür (adet ve tutar
  // sıfırdan küçük olamaz), blok 500 yerine 600 derdi: liste ≠ ciro + indirim
  const lines = [line("LATTE", 5, 500), line("LATTE IADE", -1, -100), line("CHEESECAKE", 1, 80), line("COOKIE", 2, 50)];
  const p = modposProducts({ lines, coverage, window, days: [] })!;
  assert.deepEqual(p.rows, [
    { ad: "LATTE", boy: null, adet: 5, tutar: 500 },
    // −100 + 50 (COOKIE, en küçük) hâlâ eksi: CHEESECAKE de girer; 2 adet, 30 TL
    { ad: "Diğer ürünler ve iadeler", boy: null, adet: 2, tutar: 30 },
  ]);
  for (const r of p.rows) assert.ok(r.adet >= 0 && r.tutar >= 0, `${r.ad}: eksi değil`);
  assert.equal(sumK(p.rows.map((r) => r.tutar)), sumK(lines.map((l) => l.revenue)), "tutar toplamı listeninki (530)");
  assert.equal(
    p.rows.reduce((a, r) => a + r.adet, 0),
    7,
    "adet toplamı listeninki",
  );
  // Satışlar'da ürüne bağlanan iade satırı ürünün kendi satırında düşülür
  const linked = modposProducts({ lines: [line("LATTE MEDIUM", 5, 500, "Latte", "M"), line("LATTE IADE", -1, -100, "Latte", "M"), line("COOKIE", 2, 50)], coverage, window, days: [] })!;
  assert.deepEqual(linked.rows, [
    { ad: "Latte", boy: "M", adet: 4, tutar: 400 },
    { ad: "COOKIE", boy: null, adet: 2, tutar: 50 },
  ]);
  // İade küçük satırı tam karşılıyorsa (net 0) toplanan satır kalmaz
  const net = modposProducts({ lines: [line("LATTE", 5, 500), line("COOKIE", 2, 50), line("COOKIE IADE", -2, -50)], coverage, window, days: [] })!;
  assert.deepEqual(net.rows, [{ ad: "LATTE", boy: null, adet: 5, tutar: 500 }]);
  // Liste toplamı eksi: blok yok (anlamlı liste yok)
  assert.equal(modposProducts({ lines: [line("LATTE", 1, 100), line("LATTE IADE", -2, -200)], coverage, window, days: [] }), null);
});
