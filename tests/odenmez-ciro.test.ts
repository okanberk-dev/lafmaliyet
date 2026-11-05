// Ödenmez / ikram ciroya girmez (src/lib/cash-revenue.ts, src/lib/cash-month.ts, src/lib/cash-report.ts):
// kasanın Z toplamı ödenmezi satış olarak içerir, panelin cirosu (Patron › Raporlar › Ciro ile aynı anlam) içermez.
// Günün ödeme dökümü hangisi olduğunu söyler; döküm tutmayan günde tahmin yürütülmez.
// Çalıştırma: npx tsx --test tests/odenmez-ciro.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { kasaHint } from "../src/app/panel/satislar/sales-logic";
import { kasaMonthLine, kasaValues, resolveMonth, tillMonths, type TillRow } from "../src/lib/cash-month";
import { dayRevenue, REVENUE_TOLERANCE } from "../src/lib/cash-revenue";
import { computeCash, type CashReportFields } from "../src/lib/cash-report";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
/** Bölünmez boşluğu (₺ öncesi) düz boşluğa */
const plain = (t: string) => t.replace(/\u00a0/g, " ");

// ---------------------------------------------------------------- Günün cirosu

test("Z toplamı ödenmezi içeriyorsa (ödemeler ciroyu tutuyor) cirodan düşülür", () => {
  // Z toplamı 10.500, ödenmez 500, ödemeler 10.000: ödenmez Z toplamının içinde
  const d = dayRevenue({ zTotal: 10_500, offRevenue: 500, payments: 10_000 });
  assert.deepEqual(d, { revenue: 10_000, offInZTotal: 500, included: true });
});

test("Z toplamı ödenmezi içermiyorsa (ödemeler Z toplamını tutuyor) düşülmez", () => {
  const d = dayRevenue({ zTotal: 10_000, offRevenue: 500, payments: 10_000 });
  assert.deepEqual(d, { revenue: 10_000, offInZTotal: 0, included: false });
});

test("ödeme dökümü iki okumadan hiçbirini tutmuyorsa düşülmez: eksik yazılmış tutar tahmine çevrilmez", () => {
  // Ödemelerin 4.000'i eksik yazılmış (gün kendi içinde tutmuyor): Z toplamı olduğu gibi kalır
  const d = dayRevenue({ zTotal: 28_450.5, offRevenue: 145, payments: 24_330.5 });
  assert.deepEqual(d, { revenue: 28_450.5, offInZTotal: 0, included: false });
});

test("ödenmez yok, sıfır, eksi ya da 1 ₺'tan küçükse ve döküm bilinmiyorsa Z toplamı ciro olur", () => {
  for (const off of [null, 0, -200, 0.4]) {
    assert.equal(dayRevenue({ zTotal: 10_000, offRevenue: off, payments: 10_000 }).revenue, 10_000);
    assert.equal(dayRevenue({ zTotal: 10_000, offRevenue: off, payments: 10_000 }).included, false);
  }
  // Döküm bilinmiyorsa (eski kayıt) kanıt yok: Z toplamı olduğu gibi
  assert.deepEqual(dayRevenue({ zTotal: 10_500, offRevenue: 500, payments: null }), { revenue: 10_500, offInZTotal: 0, included: false });
});

test("bozuk para farkı (1 ₺'tan küçük) tutuyor sayılır, iki yönde de", () => {
  const nearly = REVENUE_TOLERANCE - 0.01;
  // Ödemeler ciroyu 0,99 ₺ farkla tutuyor: ödenmez içeride
  assert.equal(dayRevenue({ zTotal: 10_500, offRevenue: 500, payments: 10_000 + nearly }).included, true);
  assert.equal(dayRevenue({ zTotal: 10_500, offRevenue: 500, payments: 10_000 - nearly }).included, true);
  // Ödemeler Z toplamını 0,99 ₺ farkla tutuyor: ödenmez dışarıda
  assert.equal(dayRevenue({ zTotal: 10_000, offRevenue: 500, payments: 10_000 + nearly }).included, false);
  // 1 ₺ ve üstü fark hiçbirini tutmaz
  assert.equal(dayRevenue({ zTotal: 10_500, offRevenue: 500, payments: 10_000 - REVENUE_TOLERANCE }).included, false);
});

test("kuruşlar iki ondalığa yuvarlanır (kayan nokta artığı ciroyu bozmaz)", () => {
  // 1.000,15 − 1,05 kayan noktada 999.0999999999999 eder
  const d = dayRevenue({ zTotal: 1_000.15, offRevenue: 1.05, payments: 999.1 });
  assert.equal(d.revenue, 999.1);
  assert.equal(d.offInZTotal, 1.05);
});

// ---------------------------------------------------------------- Ayın cirosu

const row = (date: string, o: Partial<TillRow> = {}): TillRow => ({ date, zTotal: 10_500, card: 7_000, mealCard: 1_000, discounts: null, offRevenue: 500, payments: 10_000, ...o });

test("ay cirosu: ödenmez Z toplamlarının içinden düşülür, Z toplamı ayrıca durur", () => {
  const [m] = tillMonths([row("2026-10-01"), row("2026-10-02"), row("2026-10-03")], "2026-10-03");
  assert.equal(m.zTotalSum, 31_500);
  assert.equal(m.offInPos, 1_500);
  assert.equal(m.posRevenue, 30_000);
  // Ödenmez kendi alanında olduğu gibi kalır (zayi / ikram tutarlılığı onu okur)
  assert.equal(m.offRevenue, 1_500);
  assert.equal(m.offDays, 3);
  // Açık gün Z toplamına göre: yalnız ödenmez satılan gün de açıktır
  assert.equal(m.openDays, 3);
});

test("ay cirosu: ödenmez Z toplamının dışındaysa ciro düşmez (bugünkü davranış)", () => {
  const rows = [row("2026-10-01", { zTotal: 10_000 }), row("2026-10-02", { zTotal: 10_000 })];
  const [m] = tillMonths(rows, "2026-10-02");
  assert.equal(m.posRevenue, 20_000);
  assert.equal(m.offInPos, 0);
  assert.equal(m.zTotalSum, 20_000);
  assert.equal(m.offRevenue, 1_000);
});

test("ay cirosu: günler karışık olabilir (bir gün içeride, bir gün dışarıda)", () => {
  const [m] = tillMonths([row("2026-10-01"), row("2026-10-02", { zTotal: 10_000 })], "2026-10-02");
  assert.equal(m.posRevenue, 20_000);
  assert.equal(m.offInPos, 500);
  assert.equal(m.zTotalSum, 20_500);
});

test("kartlı oran ciroya göre: POS komisyonu tahmini (ciro × oran × pay) kart tutarını verir", () => {
  const [m] = tillMonths([row("2026-10-01")], "2026-10-01");
  // (7.000 + 1.000) ÷ 10.000 = %80; ciro × %80 = 8.000 = kart + yemek kartı
  assert.equal(m.cardShare, 0.8);
  assert.equal(m.posRevenue! * m.cardShare!, 8_000);
  assert.equal(m.bankShare, 0.7);
});

test("ödenmez düşülen ay Patron › Ciro raporuyla aynı rakamı verir (Ekim 2026 örneği)", () => {
  // ModPOS: ciro 588.000, ödenmez 12.000; Z toplamları ödenmezi içeriyor
  const rows: TillRow[] = [];
  for (let i = 1; i <= 30; i++) {
    const day = `2026-10-${String(i).padStart(2, "0")}`;
    rows.push(row(day, { zTotal: 20_000, offRevenue: 400, payments: 19_600, card: 13_720, mealCard: 0 }));
  }
  const [m] = tillMonths(rows, "2026-10-30");
  assert.equal(m.zTotalSum, 600_000);
  assert.equal(m.offInPos, 12_000);
  assert.equal(m.posRevenue, 588_000);
});

// ---------------------------------------------------------------- Günün raporu

const report = (o: Partial<CashReportFields> = {}): CashReportFields =>
  ({
    date: "2026-10-01",
    zNo: null,
    receipts: null,
    zTotal: 10_500,
    cash: 3_000,
    card: 7_000,
    mealCard: 0,
    online: 0,
    other: 0,
    discounts: null,
    offRevenue: 500,
    openingCash: 1_000,
    cashIn: 0,
    cashOut: 0,
    countedCash: 4_000,
    handedOver: 0,
    note: null,
    ...o,
  }) as CashReportFields;

test("günün raporu: ödenmez Z toplamının içindeyse ciro düşer ve ödemeler ciroyla tutar (yanlış uyarı yok)", () => {
  const c = computeCash(report());
  assert.equal(c.revenue, 10_000);
  assert.equal(c.offInZTotal, 500);
  assert.equal(c.paymentsTotal, 10_000);
  assert.equal(c.paymentsDiff, 0);
});

test("günün raporu: ödenmez Z toplamının dışındaysa bugünkü hesap birebir aynı", () => {
  const c = computeCash(report({ zTotal: 10_000 }));
  assert.equal(c.revenue, 10_000);
  assert.equal(c.offInZTotal, 0);
  assert.equal(c.paymentsDiff, 0);
});

test("günün raporu: gerçek bir yazım hatası yine uyarı verir", () => {
  // Nakit 1.000 eksik yazılmış: ne Z toplamını ne ciroyu tutuyor
  const c = computeCash(report({ cash: 2_000 }));
  assert.equal(c.offInZTotal, 0);
  assert.equal(c.paymentsDiff, -1_500);
});

test("günün raporu: olması gereken nakit ve kasa farkı ödenmezden etkilenmez", () => {
  const c = computeCash(report());
  assert.equal(c.expectedCash, 4_000);
  assert.equal(c.cashDiff, 0);
});

// ---------------------------------------------------------------- Ekranlarda görünen

test("Kasa'nın ay satırı düşülen ödenmezi söyler", () => {
  const [t] = tillMonths([row("2026-10-01"), row("2026-10-02")], "2026-10-02", "2026-10-01");
  const info = resolveMonth("2026-10", undefined, t);
  assert.equal(plain(kasaMonthLine(info)!), "Bu ayın açık gün ve cirosu kasa raporlarından (ödenmez / ikram 1.000 ₺ düşüldü)");
  // Düşülen yoksa cümle bugünküyle aynı
  const [plainT] = tillMonths([row("2026-10-01", { zTotal: 10_000 }), row("2026-10-02", { zTotal: 10_000 })], "2026-10-02", "2026-10-01");
  assert.equal(kasaMonthLine(resolveMonth("2026-10", undefined, plainT))!, "Bu ayın açık gün ve cirosu kasa raporlarından");
});

test("Satışlar'da cironun açıklaması düşülen ödenmezi söyler, öteki alanlar değişmez", () => {
  const [t] = tillMonths([row("2026-10-01"), row("2026-10-02")], "2026-10-02", "2026-10-01");
  const kasa = { values: kasaValues(t), till: t };
  assert.equal(plain(kasaHint("posRevenue", kasa, "kasa", "")!), "Kasa raporlarından (2 gün). Ödenmez / ikram 1.000 ₺ Z toplamından düşüldü. Değiştirmek için dokunun.");
  assert.equal(kasaHint("openDays", kasa, "kasa", "")!, "Kasa raporlarından (2 gün). Değiştirmek için dokunun.");
  assert.equal(kasaHint("offRevenue", kasa, "kasa", "")!, "Kasa raporlarından (2 / 2 günde girildi). Değiştirmek için dokunun.");
});

// ---------------------------------------------------------------- Kaynak bekçileri

test("ay cirosu tek yerden: tillMonths cirosunu dayRevenue ile kurar", () => {
  const src = read("src/lib/cash-month.ts");
  assert.match(src, /import \{ dayRevenue \} from "\.\/cash-revenue";/);
  assert.match(src, /const posRevenue = r2\(zTotalSum - offInPos\);/);
  // Çıplak Z toplamı artık doğrudan ciro değil
  assert.doesNotMatch(src, /const posRevenue = sum\(list, \(r\) => r\.zTotal\);/);
});

test("günün hesabı tek yerden: computeCash ödemeleri ciroyla karşılaştırır", () => {
  const src = read("src/lib/cash-report.ts");
  assert.match(src, /paymentsDiff: r2\(paymentsTotal - revenue\),/);
  assert.match(src, /const \{ revenue, offInZTotal \} = dayRevenue\(\{ zTotal: f\.zTotal, offRevenue: f\.offRevenue \?\? null, payments: paymentsTotal \}\);/);
});

test("üç kaynağın hepsi ödeme dökümünü taşır: kasa raporu, LafPOS gün sonu, ModPOS föyü", () => {
  const loader = read("src/server/data/cash-reports.ts");
  assert.equal(loader.match(/payments: Math\.round\(/g)?.length, 3);
});
