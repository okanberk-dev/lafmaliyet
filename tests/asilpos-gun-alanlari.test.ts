// AsilPOS gün sonunun Faz 2 alanları (23 Kasım 2026; docs/ASILPOS.md › Faz 2 alanları, docs/hesap-sozlesmesi.md): gövdenin
// yeni alanları okunur ve saklanır; hiçbiri bozuk gelse de günü reddetmez (400 AsilPOS'ta kalıcıdır). Ortak dosyalar:
// tests/fixtures/asilpos-gun.golden.json (AsilPOS tests/fixtures/lafmaliyet-gun.golden.json'ın bayt bayt kopyası) ve
// tests/fixtures/kabul-gunu-2026-11-22.json (AsilPOS'taki aynı adlı dosyanın kopyası; Marina 22.11.2026). Veritabanı tarafı
// tests/asilpos-gun-alanlari-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/asilpos-gun-alanlari.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { posRevenueBreakdown } from "../src/app/panel/dashboard-breakdowns";
import { discountColumns, discountTotals } from "../src/app/panel/satislar/sales-logic";
import { createModel } from "../src/lib/calc/engine";
import { dashboard } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { resolveMonth, tillMonths, type TillRow } from "../src/lib/cash-month";
import { computeCash, whatsappText, withCardExtra, type CashReportFields } from "../src/lib/cash-report";
import { reportChecks } from "../src/lib/cash-report-checks";
import { pavoView } from "../src/lib/asilpos/bank-pos";
import { parsePosDay, posZSchema, type PosDayZ } from "../src/lib/asilpos/day";
import { asilposDayDetail } from "../src/lib/asilpos/gun-ayrinti";
import { autoValuesOf, dayEndNotes, dayEndSections, dayHash, mergeAuto, type DayEndMail } from "../src/lib/asilpos/gun-sonu";
import { asilposDayOf } from "../src/lib/asilpos/prefill";
import { monthSummary } from "../src/lib/mcp/answers/month";
import { asilposMonthNotes, asilposMonthStatus, mergeSalesSources } from "../src/lib/asilpos/sales";
import { IPTAL_ZAYI_REASON, iptalWasteLines, asilposCompKind, asilposIkramCheck, asilposLineKind, asilposListByKind, asilposReasonText, asilposZKinds, recordedOffRevenue } from "../src/lib/asilpos/ikram";
import { okcReconcile } from "../src/lib/okc-z";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";
import { renderCashReport } from "../src/server/notify/cash-report-template";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: readonly number[]) => r2(xs.reduce((a, v) => a + v, 0));

/** Gövdelerin denetlendiği an: 23 Kasım 2026 öğlen */
const NOW = new Date("2026-11-23T12:00:00+03:00");

const golden = () => read("tests/fixtures/asilpos-gun.golden.json");
const kabul = () => read("tests/fixtures/kabul-gunu-2026-11-22.json");

test("altın gövde: Faz 2 alanlarının hepsi okunur (sıra, düzeltme, yazarkasadan geçmeyen, iadeler, iptaller, z'nin toplamları ve KDV'si, satırın listesi ve eki, ikramın türü, Pavo hata kodu)", () => {
  const r = parsePosDay(golden(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const d = r.data;
  assert.equal(d.revision, 1);
  assert.deepEqual(d.correction, { kind: "reopen", reason: "Geç gelen masa" });
  // Gün sonu tam (24 Kasım 2026): yazarkasadan geçmeyen kart ödemelerinin bahşişi de
  assert.deepEqual(d.offDevice, { card: 1509, cash: 465, cardTips: 25 });
  assert.deepEqual(d.refunds, [
    { amount: 195, zField: "card", name: "Kredi kartı", channel: null, reason: "İade: Soğuk geldi" },
    { amount: 60, zField: "cash", name: "Nakit", channel: null, reason: "Kartla ödeyecek" },
  ]);
  assert.equal(d.iptal?.length, 4);
  assert.deepEqual(d.iptal?.[1], { posName: "COOL LİME MEDIUM", siteMenuId: "mnu-0033", slot: "M", qty: 1, listValue: 200, prepared: true, reason: "Yanlış ürün", refund: false });
  assert.equal(d.bankPos?.errorCode, "5085");
  const z = d.z;
  assert.deepEqual([z.listValue, z.ikramTotal, z.odenmezTotal, z.zayiTotal], [4150, 160, 410, 60]);
  assert.deepEqual(z.vat, [
    { rate: 10, base: 2312.74, vat: 231.26 },
    { rate: 20, base: 833.33, vat: 166.67 },
  ]);
  assert.deepEqual([z.openedAt, z.closedAt, z.okcZNo], ["2026-10-26T04:58:00.000Z", "2026-10-26T21:12:00.000Z", "1"]);
  const capp = d.lines.find((l) => l.posName === "CAPPUCCİNO MEDIUM");
  assert.deepEqual([capp?.revenue, capp?.gross, capp?.isAddon], [175.5, 195, false]);
  assert.deepEqual(
    d.lines.filter((l) => l.isAddon).map((l) => l.posName),
    ["SYRUP", "ALTERNATIF SÜT", "EXTRA SHOT"],
  );
  assert.deepEqual(
    d.ikram.map((i) => [i.posName, i.kind, i.personKind]),
    [
      ["ESPRESSO MEDIUM", "ikram", null],
      ["EXTRA SHOT", "ikram", null],
      ["TÜRK KAHVESİ MEDIUM", "odenmez", "personel"],
      ["BROWNİE", "odenmez", "patron"],
      ["SU", "zayi", null],
    ],
  );
});

test("altın gövde: hesap sözleşmesinin eşitlikleri (ikram + ödenmez + zayi = offRevenue; zTotal = liste − indirim − ikram − ödenmez; Σ(brüt − ciro) = indirim; Σ(matrah + KDV) = zTotal)", () => {
  for (const [name, raw] of [
    ["altın", golden()],
    ["kabul", kabul()],
  ] as const) {
    const r = parsePosDay(raw, NOW);
    assert.ok(r.ok, `${name}: ${r.ok ? "" : r.field}`);
    const { z, lines } = r.data;
    assert.equal(r2(z.ikramTotal! + z.odenmezTotal! + z.zayiTotal!), z.offRevenue, `${name}: offRevenue`);
    assert.equal(r2(z.listValue! - z.discounts - z.ikramTotal! - z.odenmezTotal!), z.zTotal, `${name}: zTotal`);
    assert.equal(sum(lines.map((l) => l.gross! - l.revenue)), z.discounts, `${name}: indirim`);
    assert.equal(sum(z.vat!.map((v) => v.base + v.vat)), z.zTotal, `${name}: KDV dökümü`);
  }
});

test("kabul günü (Marina 22.11.2026): sözleşmenin rakamları dosyadan okunur", () => {
  const r = parsePosDay(kabul(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const d = r.data;
  assert.equal(d.sube, "marina");
  assert.equal(d.date, "2026-11-22");
  const z = d.z;
  assert.deepEqual(
    [z.listValue, z.discounts, z.ikramTotal, z.odenmezTotal, z.zTotal, z.card, z.cash, z.mealCard, z.receipts],
    [7440, 90, 130, 935, 6285, 5030, 1255, 0, 26],
  );
  assert.deepEqual(z.vat, [{ rate: 10, base: 5713.64, vat: 571.36 }]);
  assert.deepEqual([z.openingCash, z.cashOut, z.expectedCash, z.countedCash, z.cashDiff], [1120, 800, 1575, 1279.5, -295.5]);
  assert.deepEqual(d.offDevice, { card: 870, cash: 200, cardTips: 0 });
  assert.deepEqual(
    d.refunds?.map((x) => [x.amount, x.zField]),
    [
      [50, "card"],
      [45, "card"],
    ],
  );
  assert.equal(d.iptal?.length, 12);
  assert.equal(sum(d.iptal!.map((i) => i.listValue)), 2395);
  // Satılan ürünler 58 adet, ekler 2 adet; SYRUP 92,50, LATTE… 570,00
  assert.equal(sum(d.lines.filter((l) => !l.isAddon).map((l) => l.qty)), 58);
  assert.equal(sum(d.lines.filter((l) => l.isAddon).map((l) => l.qty)), 2);
  assert.equal(d.lines.find((l) => l.posName === "SYRUP")?.revenue, 92.5);
  assert.equal(d.lines.find((l) => l.posName === "LATTE MEDIUM")?.revenue, 570);
});

test("Faz 2 alanı bozuk gelirse yok sayılır, gün reddedilmez (400 AsilPOS'ta kalıcıdır)", () => {
  type Raw = Record<string, unknown> & { z: Record<string, unknown>; lines: Record<string, unknown>[]; ikram: Record<string, unknown>[]; bankPos: Record<string, unknown> };
  const parsed = (mutate: (b: Raw) => void) => {
    const b = JSON.parse(golden()) as Raw;
    mutate(b);
    const r = parsePosDay(JSON.stringify(b), NOW);
    assert.ok(r.ok, r.ok ? "" : `400: ${r.field}`);
    return r.data;
  };
  assert.equal(parsed((b) => (b.revision = 0)).revision, undefined);
  assert.equal(parsed((b) => (b.revision = "2")).revision, undefined);
  assert.equal(parsed((b) => (b.correction = { kind: "sil", reason: "x" })).correction, undefined);
  assert.equal(parsed((b) => (b.correction = "reopen")).correction, undefined);
  assert.equal(parsed((b) => (b.offDevice = { card: -1, cash: 0 })).offDevice, undefined);
  assert.equal(parsed((b) => (b.refunds = [{ amount: "50" }])).refunds, undefined);
  assert.equal(parsed((b) => (b.refunds = "yok")).refunds, undefined);
  assert.equal(parsed((b) => (b.iptal = [{ posName: "X", prepared: "evet" }])).iptal, undefined);
  assert.equal(parsed((b) => (b.iptal = Array.from({ length: 2001 }, () => ({ posName: "X", siteMenuId: null, slot: null, qty: 1, listValue: 1, prepared: false, reason: null, refund: false })))).iptal, undefined);
  const z = parsed((b) => Object.assign(b.z, { listValue: -1, ikramTotal: "160", odenmezTotal: null, zayiTotal: Infinity, vat: [{ rate: "10" }], openedAt: 5, closedAt: {}, okcZNo: 1203 })).z;
  assert.deepEqual([z.listValue, z.ikramTotal, z.odenmezTotal, z.zayiTotal, z.vat, z.openedAt, z.closedAt, z.okcZNo], Array(8).fill(undefined));
  const line = parsed((b) => Object.assign(b.lines[0], { gross: -5, isAddon: "hayır" })).lines[0];
  assert.deepEqual([line.gross, line.isAddon, line.revenue], [undefined, undefined, 1000]);
  const ik = parsed((b) => Object.assign(b.ikram[2], { kind: "hediye", personKind: "Ayşe" })).ikram[2];
  assert.deepEqual([ik.kind, ik.personKind, ik.reason], [undefined, undefined, "Ödenmez: Personel yemeği"]);
  const bank = parsed((b) => (b.bankPos.errorCode = 5085)).bankPos;
  assert.equal(bank?.status, "failed", "bozuk hata kodu karşılaştırmayı düşürmez");
  assert.equal(bank?.errorCode, undefined);
  // Boş metin null: okcZNo "" ve errorCode "" yok demek
  assert.equal(parsed((b) => (b.z.okcZNo = "  ")).z.okcZNo, null);
  assert.equal(parsed((b) => (b.bankPos.errorCode = "")).bankPos?.errorCode, null);
  // Baştaki sıfır korunur (yazarkasa Z no metindir)
  assert.equal(parsed((b) => (b.z.okcZNo = "0011")).z.okcZNo, "0011");
});

test("eski gövde ve saklanmış eski Z: Faz 2 alanları olmadan geçer, alan eklenmez", () => {
  const b = JSON.parse(golden()) as Record<string, unknown> & { z: Record<string, unknown>; lines: Record<string, unknown>[]; ikram: Record<string, unknown>[]; bankPos: Record<string, unknown> };
  // 23 Kasım 2026'dan altın gövde Faz 3 alanlarını da taşır (kasa zinciri): eski gövde onları da taşımaz
  // 24 Kasım 2026'dan gün sonu tam alanlarını da (yazarkasa, tahsilat, vardiya, indirim satırları, batch'ler, ödemenin cinsi)
  for (const k of ["revision", "correction", "offDevice", "refunds", "iptal", "cashMoves", "okc", "collections", "shiftCounts", "discountLines"]) delete b[k];
  for (const k of ["listValue", "ikramTotal", "odenmezTotal", "zayiTotal", "vat", "openedAt", "closedAt", "okcZNo", "expectedOpening", "openingDiff", "openingReason", "cashTips", "closeNote", "methodCounts"]) delete b.z[k];
  for (const l of b.lines) for (const k of ["gross", "isAddon"]) delete l[k];
  for (const i of b.ikram) for (const k of ["kind", "personKind"]) delete i[k];
  for (const p of b.payments as Record<string, unknown>[]) delete p.kind;
  for (const k of ["errorCode", "batches", "dayCard"]) delete b.bankPos[k];
  const r = parsePosDay(JSON.stringify(b), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  assert.deepEqual(Object.keys(r.data).sort(), ["bankPos", "date", "ikram", "lines", "payments", "source", "sube", "version", "z"]);
  assert.deepEqual(Object.keys(r.data.lines[0]).sort(), ["isService", "posName", "qty", "revenue", "siteMenuId", "slot"]);
  assert.deepEqual(Object.keys(r.data.ikram[0]).sort(), ["menuValue", "posName", "qty", "reason", "siteMenuId", "slot"]);
  assert.equal("errorCode" in (r.data.bankPos ?? {}), false);
  assert.equal("batches" in (r.data.bankPos ?? {}), false);
  assert.deepEqual(Object.keys(r.data.payments[0]).sort(), ["amount", "channel", "count", "name", "zField"]);
  // Saklanmış Z (jsonb) aynı şemayla yeniden okunur: eski gün düşmez
  const stored = posZSchema.safeParse(b.z);
  assert.ok(stored.success);
  assert.equal("listValue" in stored.data, false);
});

// ---------------------------------------------------------------- İptaller, ikramın türü, Pavo, yazarkasa Z no, toplamlar

const plain = (v: string | null | undefined) => (v ?? "").replace(/[\u00a0\u202f]/g, " ");
/** Nesnenin verilen anahtarları olmadan kopyası (eski gövde, eski otomatik değerler) */
const omit = <T extends object>(o: T, keys: readonly string[]): T => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as T;

test("ikramın türü: AsilPOS'un `kind`'ı nedenin ön ekinden önce gelir; yoksa ön ek (eski AsilPOS)", () => {
  assert.deepEqual(asilposLineKind("Zayi: Döküldü", "zayi"), { kind: "zayi", reason: "Döküldü" });
  assert.deepEqual(asilposLineKind("Döküldü", "zayi"), { kind: "zayi", reason: "Döküldü" }, "ön eksiz zayi");
  assert.deepEqual(asilposLineKind("Zayi: yanlış etiket", "ikram"), { kind: "ikram", reason: "Zayi: yanlış etiket" }, "tür ikram diyorsa ikram");
  assert.deepEqual(asilposLineKind("Ödenmez: Personel yemeği", "odenmez"), { kind: "ikram", reason: "Ödenmez: Personel yemeği" });
  assert.deepEqual(asilposLineKind("Zayi: Döküldü"), { kind: "zayi", reason: "Döküldü" }, "tür yoksa ön ek");
  assert.equal(asilposCompKind("Ödenmez: Deneme", undefined), "odenmez");
  assert.equal(asilposCompKind("Zayi: Döküldü", undefined), "zayi");
  assert.equal(asilposCompKind("Müdavim", undefined), "ikram");
  assert.equal(asilposCompKind("Müdavim", "odenmez"), "odenmez");
  assert.equal(asilposCompKind(null, "zayi"), "zayi");
});

test("iptal: hazırlanmış kalem zayi tüketimidir (\"İptal (hazırlanmıştı)\"), hazırlanmamış yalnız bilgi", () => {
  const r = parsePosDay(golden(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const lines = iptalWasteLines(r.data.date, r.data.iptal ?? [], () => ({ productId: 7, isService: false }));
  assert.equal(IPTAL_ZAYI_REASON, "İptal (hazırlanmıştı)");
  assert.deepEqual(lines, [
    { date: "2026-10-26", kind: "zayi", compKind: "zayi", iptal: true, posName: "COOL LİME MEDIUM", productId: 7, isService: false, qty: 1, menuValue: 200, reason: IPTAL_ZAYI_REASON, detail: "Yanlış ürün" },
  ]);
  // Kabul günü: 12 parçanın hazırlanmışları (2.395,00'ın 1.275,00'i) zayi
  const k = parsePosDay(kabul(), NOW);
  assert.ok(k.ok, k.ok ? "" : k.field);
  const kl = iptalWasteLines(k.data.date, k.data.iptal ?? [], () => ({ productId: null, isService: false }));
  assert.deepEqual(
    kl.map((l) => [l.posName, l.menuValue]),
    [
      ["ESPRESSO MEDIUM", 110],
      ["BROWNİE", 280],
      ["MOCHA MEDIUM", 245],
      ["LATTE MEDIUM", 195],
      ["EXTRA SHOT", 50],
      ["ROSBEEF SANDVİÇ", 390],
    ],
  );
  assert.equal(sum(kl.map((l) => l.menuValue)), 1270);
  // Zayi & ikram'da yöneticiye: iptal nedeni ve ödenmezin kişi türü (kişinin kendisi değil)
  assert.equal(asilposReasonText(lines[0]), "İptal (hazırlanmıştı): Yanlış ürün");
  assert.equal(asilposReasonText({ reason: "Ödenmez: Deneme", personKind: "patron" }), "Ödenmez: Deneme (patron)");
  assert.equal(asilposReasonText({ reason: "Müdavim", personKind: null }), "Müdavim");
});

test("motor: hazırlanmış iptal kayıtlı zayi tüketimine girer (AsilPOS'un zayi satırı gibi)", () => {
  const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
  const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-11" };
  const product = ds.products.find((p) => p.active && ds.recipeItems.some((x) => x.productId === p.id))!;
  const [line] = iptalWasteLines("2026-11-22", [{ posName: "LATTE MEDIUM", siteMenuId: null, slot: null, qty: 2, listValue: 390, prepared: true, reason: "Müşteri gitti", refund: false }], () => ({ productId: product.id, isService: false }));
  const model = createModel({ ...ds, wasteEntries: [], asilposIkram: { switchDay: "2026-11-22", days: ["2026-11-22"], lines: [line] } });
  const perUnit = new Map((model.itemsByProduct.get(product.id) ?? []).map((it) => [it.ingredientId, model.evalQty(it).qty]));
  assert.ok(perUnit.size > 0, "reçeteli ürün");
  for (const [id, q] of perUnit) {
    assert.ok(Math.abs((model.recordedUsage("2026-11").get(id)?.zayi ?? 0) - 2 * q) < 1e-9, `${id}: zayi`);
    assert.equal(model.recordedUsage("2026-11").get(id)?.ikram ?? 0, 0, `${id}: ikram değil`);
  }
  assert.deepEqual(
    model.countedWaste.filter((w) => w.source === "asilpos").map((w) => [w.kind, w.name, w.qty, w.menuValue, w.iptal]),
    [["zayi", "LATTE MEDIUM", 2, 390, true]],
  );
});

test("Z'nin ödenmez tutarıyla karşılaştırılan kayıtlı değer: AsilPOS'un listesi (zayi dahil) ve panelin ürün ikramı; hazırlanmış iptal girmez", () => {
  const entries = [
    { kind: "ikram" as const, productId: 1, qty: 1, source: "asilpos" as const, menuValue: 130 },
    { kind: "zayi" as const, productId: 2, qty: 1, source: "asilpos" as const, menuValue: 60 },
    { kind: "zayi" as const, productId: 3, qty: 1, source: "asilpos" as const, menuValue: 280, iptal: true },
    { kind: "ikram" as const, productId: 4, qty: 2 },
    { kind: "zayi" as const, productId: 4, qty: 5 },
  ];
  assert.equal(recordedOffRevenue(entries, (id) => (id === 4 ? 100 : null)), 390);
});

test("kasa e-postasının denetimi: AsilPOS'un Z'sindeki türe göre toplamlar listeyle karşılaştırılır (Faz 2); yoksa eski kural", () => {
  const r = parsePosDay(golden(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const z = r.data.z;
  const byKind = asilposListByKind(r.data.ikram);
  assert.deepEqual(byKind, { ikram: 160, odenmez: 410, zayi: 60 });
  const totals = { ikram: z.ikramTotal!, odenmez: z.odenmezTotal!, zayi: z.zayiTotal! };
  assert.equal(asilposIkramCheck(z.offRevenue, 630, { z: totals, list: byKind }), null, "altın gövde tutar");
  // Listede bir ödenmez satırı eksik: tür türe söylenir (ödenmez 130 az)
  const short = asilposIkramCheck(z.offRevenue, 500, { z: totals, list: { ...byKind, odenmez: 280 } });
  assert.equal(plain(short), "AsilPOS'un ödenmez toplamı (Z) ikram listesindeki ödenmezden 130 ₺ fazla: AsilPOS'ta ödenmez işaretlenen ama listeye girmeyen satır olabilir.");
  // AsilPOS'un kendi toplamları offRevenue'yu tutmuyor (sürüm hatası): ayrıca söylenir
  const own = asilposIkramCheck(700, 630, { z: totals, list: byKind });
  assert.match(plain(own), /AsilPOS'un ödenmez tutarı \(Z\) türlerin toplamından \(630 ₺\) 70 ₺ fazla/);
  // Türe göre toplam yoksa (eski AsilPOS) bugünkü kural
  assert.equal(plain(asilposIkramCheck(520, 340)), "AsilPOS'un ödenmez tutarı (Z) ikram ve zayi listesinden 180 ₺ fazla: AsilPOS'ta ödenmez işaretlenen ama listeye girmeyen satır olabilir.");
});

test("kasa e-postasının denetimi: AsilPOS'un Z'si kendi içinde tutmuyorsa (liste − indirim − ikram − ödenmez ≠ toplam satış) söylenir; z.listValue okunur", () => {
  const r = parsePosDay(kabul(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const z = r.data.z;
  const kinds = asilposZKinds(z);
  assert.deepEqual(kinds, { ikram: 130, odenmez: 935, zayi: 0, sale: { listValue: 7440, discounts: 90, zTotal: 6285 } });
  const list = asilposListByKind(r.data.ikram);
  assert.equal(asilposIkramCheck(z.offRevenue, 1065, { z: kinds, list }), null, "kabul günü tutar: 7.440 − 90 − 130 − 935 = 6.285");
  // Listenin değerinden bir satır düşmüş (15 ₺): Z kendi içinde tutmuyor
  const broken = asilposIkramCheck(z.offRevenue, 1065, { z: asilposZKinds({ ...z, listValue: 7425 }), list });
  assert.equal(plain(broken), "AsilPOS'un Z'si kendi içinde tutmuyor: liste 7.425 ₺ − indirim 90 ₺ − ikram 130 ₺ − ödenmez 935 ₺ = 6.270 ₺, toplam satış 6.285 ₺ (15 ₺ fazla).");
  // listValue'yu göndermeyen AsilPOS: eşitlik denetlenmez, türler yine karşılaştırılır
  assert.equal(asilposZKinds({ ...z, listValue: undefined })?.sale, undefined);
  assert.equal(asilposIkramCheck(z.offRevenue, 1065, { z: asilposZKinds({ ...z, listValue: undefined }), list }), null);
  // Türe göre toplamı olmayan eski AsilPOS: null (eski kural)
  assert.equal(asilposZKinds({ ...z, ikramTotal: undefined }), null);
  // Kasa e-postasının okuyucusu aynı yardımcıyla kurar
  assert.match(read("src/server/data/asilpos-ikram.ts"), /zByKind: zd \? asilposZKinds\(zd\) : null/);
});

test("Pavo: cihazın hata kodu karşılaştırmada görünür", () => {
  const r = parsePosDay(golden(), NOW);
  assert.ok(r.ok && r.data.bankPos, "altın gövdenin Pavo sonucu");
  const v = pavoView(r.data.bankPos);
  assert.equal(v.state, "yok");
  assert.equal(plain(v.headline), "Pavo sonucu alınamadı (Gün sonu alınamadı; hata kodu 5085).");
  assert.deepEqual(v.rows.at(-1), ["Hata kodu", "5085"]);
  const ok = pavoView({ ...r.data.bankPos, errorCode: null });
  assert.equal(ok.rows.some(([l]) => l === "Hata kodu"), false);
});

test("kasa raporunun kart karşılaştırması yazarkasadan geçmeyen kartı yazarkasada ve banka gün sonunda beklemez (kabul günü: 5.030 − 870 = 4.160)", () => {
  const r = parsePosDay(kabul(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const z = r.data.z;
  const day = asilposDayOf(z, "2026-11-22T21:30:00.000Z", r.data.offDevice);
  assert.deepEqual(day.offDevice, { card: 870, cash: 200 });
  assert.equal(asilposDayOf(z, "2026-11-22T21:30:00.000Z").offDevice, null, "eski gövde: alan yok");
  const f: CashReportFields = {
    date: "2026-11-22",
    zNo: "11",
    receipts: z.receipts,
    zTotal: z.zTotal,
    cash: z.cash,
    card: z.card,
    mealCard: z.mealCard,
    online: z.online,
    other: z.other,
    openingCash: z.openingCash,
    cashIn: 0,
    cashOut: z.cashOut,
    cashOutNote: null,
    countedCash: 1279.5,
    handedOver: 0,
    bankPos: null,
    offRevenue: z.offRevenue,
    discounts: z.discounts,
    note: null,
  };
  // Banka gün sonu: Pavo'nun batch'i 4.160 (AsilPOS'un kendi kıyası da uyumlu)
  const bank = { ...f, bankPos: 4160 };
  assert.equal(computeCash(bank).cardDiff, -870, "AsilPOS'un özeti verilmezse eski kural");
  assert.equal(computeCash(withCardExtra(bank, day.cardExtra, day.offDevice)).cardDiff, 0);
  // Yazarkasa Z'si: kart 4.160, nakit 1.055 (200 yazarkasadan geçmedi), toplam 5.215
  const okc = { ...f, okcZNo: "11", okcReceipts: 26, okcTotal: 5215, okcCash: 1055, okcCard: 4160 };
  const withDay = withCardExtra(okc, day.cardExtra, day.offDevice);
  assert.equal(computeCash(withDay).cardDiff, 0);
  assert.equal(computeCash(withDay).cardSource, "okc");
  const staff = okcReconcile(withDay, "staff", "AsilPOS");
  assert.equal(staff[0].key, "okc-card");
  assert.equal(staff[0].tone, "good", staff[0].text);
  assert.equal(plain(staff[0].text), "Kart: yazarkasa ile AsilPOS aynı. AsilPOS'ta yazarkasadan geçmeyen kart düşüldü.");
  const admin = okcReconcile(withDay, "admin", "AsilPOS");
  const line = (key: string) => admin.find((l) => l.key === key);
  assert.equal(plain(line("okc-card")?.text), "Kart: yazarkasa ile AsilPOS aynı. AsilPOS'ta yazarkasadan geçmeyen kart (870 ₺) düşüldü.");
  assert.equal(line("okc-cash")?.tone, "good", line("okc-cash")?.text);
  assert.equal(plain(line("okc-cash")?.text), "Nakit: yazarkasa ile AsilPOS aynı. AsilPOS'ta yazarkasadan geçmeyen nakit (200 ₺) düşüldü.");
  assert.equal(plain(line("okc-total")?.text), "AsilPOS toplamı 1.070 ₺ fazla; yazarkasadan geçmeyen satışlar kadar.");
  assert.deepEqual(
    reportChecks({ report: okc, cardExtra: day.cardExtra, offDevice: day.offDevice, kasa: "AsilPOS" }).map((c) => c.key),
    [],
    "kayıtlı raporun kontrol listesinde kart uyarısı yok",
  );
  assert.deepEqual(
    reportChecks({ report: okc, cardExtra: day.cardExtra, kasa: "AsilPOS" }).map((c) => c.key),
    ["okc-card"],
    "yazarkasadan geçmeyen kart verilmezse eski kural (870 eksik)",
  );
  // WhatsApp (personel): kart aynı, tutar yok
  const wa = plain(whatsappText(okc, { by: "Ayşe", kasa: "AsilPOS", cardExtra: day.cardExtra, offDevice: day.offDevice }));
  assert.match(wa, /✅ Kart AsilPOS ile aynı \(yazarkasadan geçmeyen kart düşüldü\)/);
  assert.doesNotMatch(wa, /870/);
  // Yöneticinin e-postası (yalnız banka gün sonu yazılmış): satır tutarıyla, fark yok
  const mail = renderCashReport(bank, { by: "Ayşe", revision: 1, submittedAt: new Date("2026-11-22T21:40:00Z"), kasa: "AsilPOS", cardExtra: day.cardExtra, offDevice: day.offDevice });
  const html = plain(mail.html);
  assert.match(html, /− Yazarkasadan geçmeyen kart[\s\S]{0,400}870 ₺/);
  assert.match(html, /Fark[\s\S]{0,400}Yok/);
  assert.doesNotMatch(html, /Banka POS AsilPOS&#39;taki karttan/);
  assert.match(plain(mail.text), /Banka POS: 4\.160 ₺ ✅ AsilPOS ile aynı \(AsilPOS'ta yazarkasadan geçmeyen kart 870 ₺ düşüldü\)/);
  // Bahşiş ve yazarkasadan geçmeyen kart birlikte: ikisi de düşer, ikisi de yazılır
  const both = withCardExtra(bank, 150, day.offDevice);
  assert.equal(computeCash({ ...both, bankPos: 4310 }).cardDiff, 0);
  assert.match(
    plain(whatsappText({ ...bank, bankPos: 4310 }, { by: "Ayşe", kasa: "AsilPOS", cardExtra: 150, offDevice: day.offDevice })),
    /Banka POS: 4\.310 ₺ ✅ AsilPOS ile aynı \(bahşiş \/ cari tahsilatı ve yazarkasadan geçmeyen kart düşüldü\)/,
  );
  // Her okur aynı özeti alır: formun kartı, kayıtlı görünüm, yöneticinin penceresi, Onaylar, günden güne, metinler
  assert.match(read("src/server/data/cash-photos.ts"), /offDevice: asilpos\.day\?\.offDevice \?\? null/);
  // Gün sonu tam: cihazda iptal edilen belge de (okc.voided) yazarkasadan geçmeyene eklenir
  assert.equal(read("src/server/data/asilpos-day.ts").match(/asilposDayOf\(z\.data, r(ow)?\.receivedAt, offDeviceOf\(r(ow)?\.offDevice\), okcOf\(r(ow)?\.okc\)\)/g)?.length, 2);
  const form = read("src/app/panel/kasa/cash-form.tsx");
  assert.match(form, /offDevice=\{asilpos\?\.offDevice \?\? null\}/);
  assert.match(form, /cardExtra: asilpos\?\.cardExtra \?\? null, offDevice: asilpos\?\.offDevice \?\? null/);
  assert.match(read("src/app/panel/onaylar/kasa-cards.tsx"), /offDevice=\{card\.asilpos\.day\?\.offDevice \?\? null\}/);
  const history = read("src/app/panel/kasa/cash-history.tsx");
  // Ay listesinin rozetleri (ve gün görünümünün döküm özeti) cash-attention.ts'ten: kart farkı yazarkasadan geçmeyeni düşer
  assert.match(history, /reportFlags\(report, photos\[report\.id\]\?\.extras \?\? \{\}\)/);
  assert.match(read("src/lib/cash-attention.ts"), /computeCash\(withCardExtra\(report, extras\.cardExtra, extras\.offDevice, extras\.kasa\)\)/);
  assert.match(history, /offDevice=\{openPhotos\?\.extras\.offDevice\}/);
  assert.match(read("src/app/panel/kasa/report-sheet.tsx"), /reportChecks\(\{ report, cardExtra, offDevice,/);
});

test("Kasa raporu: yazarkasanın Z no'su (okcZNo) otomatik alan; elle ya da fotoğrafla girilen korunur, AsilPOS'un Z no'sundan ayrı", () => {
  const r = parsePosDay(kabul(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const z: PosDayZ = r.data.z;
  const v = autoValuesOf("2026-11-22", z, { count: 0, total: 0, note: null }, null);
  assert.equal(v.okcZNo, "11");
  assert.equal(v.zNo, "11", "AsilPOS'un Z'si ayrı alan (zNo)");
  // Yazarkasa Z no'su olmayan gün (Pavo satış sonucunda Z yok): boş, kayıtlı değer kalır
  const none = autoValuesOf("2026-11-22", { ...z, okcZNo: null }, { count: 0, total: 0, note: null }, null);
  assert.equal(none.okcZNo, null);
  assert.equal(mergeAuto({ ...none, okcZNo: "0011" }, none, none).values.okcZNo, "0011");
  // Bu alan yokken yazılmış otomatik rapor: fotoğraftan okunan Z no ezilmez (son otomatik değer bilinmiyor)
  const before = omit(none, ["okcZNo"]);
  const m = mergeAuto({ ...v, okcZNo: "0011" }, before, v);
  assert.equal(m.values.okcZNo, "0011");
  assert.ok(m.kept.includes("okcZNo"));
  // Elle değişmemişse AsilPOS'unki yazılır
  assert.equal(mergeAuto(none, none, v).values.okcZNo, "11");
});

// ---------------------------------------------------------------- KDV: AsilPOS gününün kendi dökümü, ay = günlerin toplamı

/** Marina'nın ModPOS günleri (sözleşme §6): gün, ciro, kart, nakit, indirim, ödenmez */
const MODPOS_DAYS: [string, number, number, number, number, number][] = [
  ["2026-11-13", 390, 195, 195, 0, 0],
  ["2026-11-14", 3311, 2687.25, 623.75, 249, 0],
  ["2026-11-15", 5753, 4146.5, 1606.5, 517, 190],
  ["2026-11-16", 2670, 2140, 530, 0, 0],
  ["2026-11-17", 1641.25, 1171.25, 470, 153.75, 455],
  ["2026-11-18", 2419.25, 1814.5, 604.75, 315.75, 400],
  ["2026-11-19", 2535.75, 1472.5, 1063.25, 204.25, 200],
  ["2026-11-20", 4008, 2914.25, 1093.75, 397, 255],
  ["2026-11-21", 4620.5, 3203, 1417.5, 229.5, 0],
];
const KABUL_VAT = [{ rate: 10, base: 5713.64, vat: 571.36 }];

function novemberModel(rows: TillRow[], switchDay: string | null = "2026-11-22") {
  const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
  const base: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-12" };
  const [till] = tillMonths(rows, "2026-11-30", undefined, undefined, undefined, undefined, undefined, true, { froms: switchDay ? { marina: switchDay } : null, tills: ["marina"] });
  const nov = resolveMonth("2026-11", undefined, till);
  const ds: Dataset = { ...base, settings: { ...base.settings, asilposGecisGunu: switchDay }, salesLines: base.salesLines.filter((l) => l.month !== "2026-11"), months: [...base.months.filter((m) => m.month !== "2026-11"), nov] };
  return { model: createModel(ds), till };
}

const marinaRows = (vat: TillRow["vat"] = KABUL_VAT, branchId = "marina"): TillRow[] => [
  ...MODPOS_DAYS.map(([date, z, card, cash, discounts, off]): TillRow => ({ date, zTotal: z, card, mealCard: 0, discounts, offRevenue: off, payments: r2(card + cash), branchId })),
  { date: "2026-11-22", zTotal: 6285, card: 5030, mealCard: 0, discounts: 90, offRevenue: 1065, payments: 6285, branchId, vat },
];

test("KDV hariç ciro: AsilPOS gününün KDV'si AsilPOS'un dökümünden, ModPOS günleri günün oranıyla (%10) ayrı ayrı; ay = günlerin toplamı (30.576,15)", () => {
  const { model, till } = novemberModel(marinaRows());
  assert.equal(till.posRevenue, 33633.75);
  assert.deepEqual(till.dayVat?.known, { days: 1, revenue: 6285, base: 5713.64, vat: 571.36 });
  assert.equal(till.dayVat?.days.length, 9);
  const pm = model.pnlMonth("2026-11");
  assert.equal(pm.revenueNet, 30576.15, "gün gün (ay toplamından 30.576,14 olurdu)");
  assert.deepEqual(model.posNet("2026-11"), { net: 30576.15, vat: 3057.6, byDay: true });
});

test("KDV hariç ciro: AsilPOS'un dökümü günün cirosunu tutmuyorsa (rapor elle düzeltildi) o gün de oranla ayrılır; dökümsüz AsilPOS günü de", () => {
  const off = marinaRows([{ rate: 10, base: 5000, vat: 500 }]);
  const { till } = novemberModel(off);
  assert.equal(till.dayVat?.known.days, 0, "5.500 ≠ 6.285");
  assert.equal(till.dayVat?.days.length, 10);
  const { model } = novemberModel(marinaRows(undefined));
  // Hepsi %10'la gün gün: 24.862,51 + 5.713,64 (6.285 ÷ 1,1 = 5.713,636… → 5.713,64)
  assert.equal(model.pnlMonth("2026-11").revenueNet, 30576.15);
});

test("KDV hariç cironun açıklaması gün gün hesabı söyler (Genel bakış dökümü, Gelir-gider satırının ipucu); ay toplamından hesaplanan ayda eski metin", () => {
  const { model } = novemberModel(marinaRows());
  const sub = (m: typeof model, month: string) => plain(posRevenueBreakdown(m, dashboard(m, month)).groups[0]?.rows.find((r) => r.key === "net")?.sub);
  assert.equal(sub(model, "2026-11"), "POS cirosu 33.634 ₺ gün gün: AsilPOS günü kendi KDV dökümüyle, öteki günler ÷ (1 + KDV %10); ay günlerin toplamı");
  const hint = model.pnlRowDefs(["2026-11"]).find((r) => r.key === "revenueNet")?.hint ?? "";
  assert.match(plain(hint), /AsilPOS'un şubesinin günleri gün gün: AsilPOS gününün KDV'si kendi dökümünden, öteki günler günün oranıyla; ay günlerin toplamı/);
  const tuzla = novemberModel(marinaRows(undefined, "tuzla"), null).model;
  assert.equal(sub(tuzla, "2026-11"), "POS cirosu 33.634 ₺ ÷ (1 + KDV %10)");
});

test("KDV hariç cironun açıklaması: MCP'nin ay cevabı gün gün hesabı yazar (ay toplamından 33.633,75 ÷ 1,10 = 30.576,14 olurdu, günlerin toplamı 30.576,15)", () => {
  const { model } = novemberModel(marinaRows());
  const summary = (m: typeof model) => monthSummary(m, "2026-11", { base: "https://ladmin.laffogato.net" });
  const line = (m: typeof model) => plain(summary(m).hesap.find((l) => l.startsWith("KDV hariç ciro =")));
  assert.equal(summary(model).gerceklesen?.ciroKdvHaric, 30576.15);
  const marina = line(model);
  assert.match(marina, /^KDV hariç ciro = 33\.634 ₺ gün gün \(AsilPOS günü kendi KDV dökümüyle, öteki günler ÷ 1,10; ay günlerin toplamı\) = 30\.576 ₺ /);
  assert.doesNotMatch(marina, /33\.634 ₺ ÷ 1,10 =/, "ay toplamının formülü bu rakamı vermez");
  // AsilPOS'un şubesi olmayan ay: ay toplamından, eski metin
  const tuzla = novemberModel(marinaRows(undefined, "tuzla"), null).model;
  assert.equal(summary(tuzla).gerceklesen?.ciroKdvHaric, 30576.14);
  assert.match(line(tuzla), /^KDV hariç ciro = 33\.634 ₺ ÷ 1,10 = 30\.576 ₺ /);
});

test("KDV hariç ciro: AsilPOS'un şubesi olmayan ay (Tuzla, eski satırlar) bugünkü gibi ay toplamından", () => {
  const { model, till } = novemberModel(marinaRows(undefined, "tuzla"), null);
  assert.equal(till.dayVat, undefined);
  const pm = model.pnlMonth("2026-11");
  assert.ok(Math.abs(pm.revenueNet! - 33633.75 / 1.1) < 1e-6, String(pm.revenueNet));
  assert.equal(model.posNet("2026-11")?.byDay, false);
});

// ---------------------------------------------------------------- Satışlar: indirimden önce ve sonra, satırlar ↔ Z

test("Satışlar: indirimden önceki (brüt) ve sonraki tutar ayrı sütun; ModPOS listesinin satırı indirimden önce, AsilPOS'unki ikisi de", () => {
  // ModPOS listesi indirimden öncedir: satır başına indirim bilinmez
  assert.deepEqual(discountColumns({ asilposDays: null, revenue: 20_000, gross: null }), { before: 20_000, after: null });
  // AsilPOS: brüt ve ciro (indirimden sonra)
  assert.deepEqual(discountColumns({ asilposDays: 1, revenue: 570, gross: 585 }), { before: 585, after: 570 });
  // Eski AsilPOS (brüt gelmedi): önce bilinmez
  assert.deepEqual(discountColumns({ asilposDays: 1, revenue: 570, gross: null }), { before: null, after: 570 });
  // Toplam: yalnız AsilPOS satırları varken ikisi de; ModPOS satırı varken indirimden sonraki toplam satırlardan bilinmez
  assert.deepEqual(
    discountTotals([
      { asilposDays: 1, revenue: 570, gross: 585 },
      { asilposDays: 1, revenue: 92.5, gross: 100 },
    ]),
    { before: 685, after: 662.5 },
  );
  assert.deepEqual(
    discountTotals([
      { asilposDays: null, revenue: 20_000, gross: null },
      { asilposDays: 1, revenue: 570, gross: 585 },
    ]),
    { before: 20_585, after: null },
  );
  // AsilPOS ay satırı brütü toplar
  const merged = mergeSalesSources({
    switchDays: { marina: "2026-11-22" },
    salesLines: [],
    coverage: {},
    asilposLines: [{ month: "2026-11", posName: "LATTE MEDIUM", productId: null, isService: false, qty: 3, revenue: 570, gross: 585, isAddon: false, days: 1 }],
    asilposDays: [{ month: "2026-11", days: 1, last: "2026-11-22" }],
  });
  assert.deepEqual([merged.salesLines[0].gross, merged.salesLines[0].isAddon], [585, false]);
});

test("Satışlar: AsilPOS gününün ürün satırları Z'yi tutmuyorsa uyarı; ModPOS listesinde liste − indirim = Z denetimi", () => {
  const kasaDays = [...MODPOS_DAYS.map(([d]) => d), "2026-11-22"];
  const base = { month: "2026-11", switchDay: "2026-11-22", today: "2026-12-10", asilpos: { days: 1, last: "2026-11-22" }, kasaDays, asilposDates: ["2026-11-22"] };
  const modpos = { lines: 31, revenue: 29_415, through: "2026-11-21" };
  const ok = asilposMonthStatus({ ...base, modpos, modposZ: 27_348.75, modposDiscounts: 2_066.25, linesVsZ: [{ date: "2026-11-22", lines: 6_285, z: 6_285 }] });
  const notes = asilposMonthNotes(ok!, "2026-11-22");
  assert.deepEqual(notes.warnings, []);
  assert.deepEqual(
    notes.checks.map((c) => [c.ok, plain(c.text)]),
    [
      [true, "ModPOS listesi 13–21 Kasım: liste 29.415,00 ₺ − indirim 2.066,25 ₺ = 27.348,75 ₺, Z 27.348,75 ₺ · tutuyor"],
      [true, "AsilPOS: her günün ürün satırları Z'yi tutuyor (1 gün)"],
    ].map(([o, t]) => [o, String(t).replace("13–21", "13–\u206021")]),
  );
  // AsilPOS'un bir gününde satırlar Z'den farklı: uyarı (gün ve iki tutar)
  const bad = asilposMonthStatus({ ...base, modpos, modposZ: 27_348.75, modposDiscounts: 2_066.25, linesVsZ: [{ date: "2026-11-22", lines: 6_195, z: 6_285 }] });
  const badNotes = asilposMonthNotes(bad!, "2026-11-22");
  assert.deepEqual(badNotes.warnings.map(plain), [
    "22 Kasım: AsilPOS'un ürün satırlarının toplamı (6.195,00 ₺) Z'den (6.285,00 ₺) 90,00 ₺ az. Satır eksik gelmiş olabilir: AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın.",
  ]);
  // ModPOS listesi indirimden sonra Z'yi tutmuyor ama %5'i aşmıyor: bilgi satırı (uyarı değil)
  const near = asilposMonthStatus({ ...base, modpos: { ...modpos, revenue: 29_500 }, modposZ: 27_348.75, modposDiscounts: 2_066.25, linesVsZ: [{ date: "2026-11-22", lines: 6_285, z: 6_285 }] });
  const nearNotes = asilposMonthNotes(near!, "2026-11-22");
  assert.deepEqual(nearNotes.warnings, []);
  assert.deepEqual(nearNotes.checks.map((c) => c.ok), [false, true]);
  assert.match(plain(nearNotes.checks[0].text), /liste − indirim Z'den 85,00 ₺ fazla/);
});

test("Satışlar bandı: tutmayan ModPOS denetimi bilgi kutusu (uyarı tonu yalnız %5'i aşan farkın kendi uyarısında), tutanlar tek satır", () => {
  const page = read("src/app/panel/satislar/page.tsx");
  const band = page.slice(page.indexOf("function AsilposBand"));
  assert.match(band, /\{off\.map\(\(c\) => \(\s*<Notice key=\{c\.text\} tone="neutral" title=\{c\.text\} \/>/, "tutmayan denetim bilgi tonunda");
  assert.doesNotMatch(band.slice(0, band.indexOf("</div>")), /off\.map\(\(c\) => \(\s*<Notice key=\{c\.text\} tone="warn"/);
});

test("gün sonu e-postasının özeti: Faz 2 alanları özeti değiştirmez (yükseltmeden önce saklanıp sonra yeniden gönderilen gün \"Düzeltildi\" e-postası yollamaz); rakam değişince değişir", () => {
  const r = parsePosDay(golden(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const { z, payments, ikram } = r.data;
  // Eski panelin sakladığı gün: Faz 2 anahtarları atılmış (z.object)
  const oldZ = omit(z, ["listValue", "ikramTotal", "odenmezTotal", "zayiTotal", "vat", "openedAt", "closedAt", "okcZNo"]);
  const oldIkram = ikram.map((l) => omit(l, ["kind", "personKind"]));
  const before = dayHash({ z: oldZ, payments, ikram: oldIkram });
  assert.equal(dayHash({ z, payments, ikram }), before, "aynı rakamlar, yalnız Faz 2 alanları eklendi");
  assert.notEqual(dayHash({ z: { ...z, zTotal: z.zTotal + 1 }, payments, ikram }), before, "Z değişti");
  assert.notEqual(dayHash({ z, payments, ikram: ikram.slice(1) }), before, "ikram listesi değişti");
});

// ---------------------------------------------------------------- Kasa gün görünümü ve gün sonu e-postası

test("gün ayrıntısı (kabul günü): yazarkasadan geçmeyen, ödeme iptalleri, iptal edilen kalemler, yazarkasa Z no, KDV, sıra", () => {
  const r = parsePosDay(kabul(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const d = asilposDayDetail(r.data);
  const rows = Object.fromEntries(d.sections.flatMap((x) => x.rows).map(([l, v]) => [l, plain(v)]));
  assert.equal(rows["Yazarkasadan geçmeyen kart"], "870 ₺");
  assert.equal(rows["Yazarkasadan geçmeyen nakit"], "200 ₺");
  assert.equal(rows["Ödeme iptalleri"], "2 · 95 ₺");
  assert.equal(rows["İptal, hazırlanmıştı (zayi)"], "6 kalem · 1.270 ₺");
  assert.equal(rows["İptal, hazırlanmamıştı"], "6 kalem · 1.125 ₺ · tüketim değil");
  assert.equal(rows["Yazarkasa Z no"], "11");
  assert.equal(rows["KDV %10"], "matrah 5.713,64 ₺ · KDV 571,36 ₺");
  assert.equal(rows["Gönderim"], "1. gönderim");
  assert.deepEqual(
    d.refunds.map((x) => [x.name, plain(x.amount), x.reason]),
    [
      ["Kredi kartı", "50 ₺", "Yanlış tutar girildi"],
      ["Kredi kartı", "45 ₺", "Kart reddedildi"],
    ],
  );
  // Altın gövde: düzeltme ve Pavo'nun hata kodu
  const g = parsePosDay(golden(), NOW);
  assert.ok(g.ok, g.ok ? "" : g.field);
  const gd = asilposDayDetail(g.data);
  assert.equal(plain(gd.correction), "Düzeltme: gün yeniden açıldı (Geç gelen masa)");
  // Eski AsilPOS'un günü: Faz 2 (ve Faz 3) satırları yok
  const old = asilposDayDetail({
    ...g.data,
    offDevice: undefined,
    refunds: undefined,
    iptal: undefined,
    revision: undefined,
    correction: undefined,
    cashMoves: undefined,
    okc: undefined,
    collections: undefined,
    shiftCounts: undefined,
    discountLines: undefined,
    z: { ...g.data.z, okcZNo: undefined, vat: undefined, expectedOpening: undefined, openingDiff: undefined, openingReason: undefined, cashTips: undefined, closeNote: undefined, methodCounts: undefined },
  });
  assert.deepEqual(old.sections, []);
  assert.equal(old.correction, null);
});

test("gün sonu e-postası: Faz 2 satırları (yazarkasadan geçmeyen, iptaller, yazarkasa Z no) ve düzeltmenin nedeni", () => {
  const r = parsePosDay(golden(), NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  const mail: DayEndMail = {
    branchName: "Marina",
    date: r.data.date,
    z: r.data.z,
    payments: r.data.payments,
    ikram: r.data.ikram,
    values: null,
    missing: [],
    report: "auto",
    corrected: true,
    yesterday: { date: "2026-10-25", zTotal: null },
    lastWeek: { date: "2026-10-19", zTotal: null },
    online: null,
    link: "https://ladmin.laffogato.net/panel/kasa",
    detail: asilposDayDetail(r.data),
  };
  const rows = dayEndSections(mail).flatMap((x) => x.rows.map(([l, v]) => `${l}: ${plain(v)}`));
  assert.ok(rows.includes("Yazarkasadan geçmeyen kart: 1.509 ₺"), rows.join("\n"));
  assert.ok(rows.includes("Ödeme iptalleri: 2 · 255 ₺"));
  assert.ok(rows.includes("İptal, hazırlanmıştı (zayi): 1 kalem · 200 ₺"));
  assert.ok(rows.includes("Yazarkasa Z no: 1"));
  assert.match(plain(dayEndNotes(mail).join(" ")), /Düzeltildi: gün yeniden açıldı \(Geç gelen masa\)/);
});
