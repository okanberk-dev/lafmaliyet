// Gün sonu tam (sahibin isteği, 24 Kasım 2026; docs/LAFPOS.md › Gün sonu otomasyonu): LafPOS gününde kasa raporunun
// Banka POS'u Pavo'nun kendi gün sonlarından (Σ batch), yazarkasa alanları LafPOS'un cihaz belgelerinden kendiliğinden
// yazılır; cihaz rakamı yoksa alan boş kalır ve not tam olarak neyin eksik olduğunu söyler (uydurulmaz, "panelden
// ekleyin" yok). Personel yalnız fotoğraf ekler; fotoğrafın okunuşu LafPOS'un rakamlarıyla karşılaştırılır, fark
// yöneticinin uyarısıdır. Saf kurallar burada; veritabanıyla uçtan uca tests/lafpos-gun-sonu-tam-db.test.ts.
//
// Rakamlar denetimin uçtan uca gününden (24 Kasım 2026): Z kartı 1.088, yazarkasadan geçmeyen kart 288 (+20 bahşiş),
// kartla cari tahsilatı 195; Pavo gün ortasında 000278 = 240, kapanıştan sonra 000279 = 755: günün bankası 995.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayTasks, type CashLite, type DayFacts } from "../src/app/panel/bugun/logic";
import { computeCash, withCardExtra } from "../src/lib/cash-report";
import { pavoView } from "../src/lib/lafpos/bank-pos";
import { parsePosDay, type BankPos, type PosDayZ, type PosOkc } from "../src/lib/lafpos/day";
import {
  LAFPOS_PHOTO_TEXT,
  LAFPOS_STAFF_DESCRIPTION,
  LAFPOS_STAFF_WAITING_DESCRIPTION,
  lafposPhotoCheck,
  lafposPhotoDone,
  lafposPhotoLabel,
  lafposPhotoNeed,
  photoCheckText,
  staffAutoNote,
  staffPhotoDiffs,
  staffLafposAutoOf,
  staffLafposDescriptionOf,
  staffPhotoLine,
} from "../src/lib/lafpos/foto";
import { lafposDayDetail } from "../src/lib/lafpos/gun-ayrinti";
import { autoMissing, autoValuesOf, bankPosAuto, dayHash, mergeAuto, renderDayEnd, type AutoValues, type DayEndMail } from "../src/lib/lafpos/gun-sonu";
import { lafposDayOf } from "../src/lib/lafpos/prefill";
import { okcReconcile } from "../src/lib/okc-z";
import type { KasaOkc } from "../src/lib/photo-read/schemas";

const plain = (v: string) => v.replace(/[  ]/g, " ");
const DAY = "2026-11-24";
const NOW = new Date("2026-11-25T00:30:00+03:00");

const Z: PosDayZ = {
  zNo: 3,
  receipts: 11,
  zTotal: 3_098,
  cash: 1_315,
  card: 1_088,
  mealCard: 195,
  online: 0,
  other: 500,
  offRevenue: 530,
  discounts: 32,
  openingCash: 1_120,
  cashOut: 800,
  countedCash: 1_535,
  handedOver: 500,
  cashDiff: -5,
  cashIn: 405,
  expectedCash: 1_540,
  cardTips: 20,
  cardCollections: 195,
  okcZNo: null,
};
const OFF = { card: 288, cash: 925, cardTips: 20 };
const NO_OUTS = { count: 0, total: 0, note: null };

const batch = (batchNo: string, total: number | null, trigger: "otomatik" | "elle", dayClosed: boolean) => ({ batchNo, at: "2026-11-24T22:00:00.000Z", total, trigger, dayClosed });

/** Pavo'nun son sonucu: P2 elle yeniden denendi, 000279 = 755; gün ortasındaki 000278 = 240 da günün */
const OK: BankPos = {
  status: "ok",
  batchNo: "000279",
  at: "2026-11-24T22:10:00.000Z",
  pavoCard: 755,
  lafposCard: 755,
  diff: 0,
  acquirers: [{ name: "Garanti BBVA", count: 3, total: 755 }],
  message: null,
  errorCode: null,
  batches: [batch("000278", 240, "elle", false), batch("000279", 755, "elle", true)],
  dayCard: 995,
};
/** P1: kapanıştaki otomatik gün sonu alınamadı (5085); gün ortasındaki batch başarılı */
const FAILED: BankPos = {
  ...OK,
  status: "failed",
  batchNo: null,
  pavoCard: null,
  lafposCard: 755,
  diff: null,
  acquirers: [],
  message: "Günsonu alınamadı (kod 5085)",
  errorCode: "5085",
  batches: [batch("000278", 240, "elle", false)],
};
const OKC: PosOkc = {
  provider: "pavo",
  zReport: false,
  docs: 4,
  cash: 390,
  card: 800,
  mealCard: 0,
  other: 0,
  total: 1_190,
  voided: { count: 0, cash: 0, card: 0 },
  vat: [{ rate: 10, total: 1_190, vat: 108.18 }],
};

const body = (o: Record<string, unknown> = {}) => ({
  version: 1,
  source: "lafpos",
  sube: "marina",
  date: DAY,
  z: { ...Z, cashTips: 10, closeNote: "  Kasa föyü sayıldı  ", methodCounts: [{ name: "Kredi kartı", zField: "card", channel: null, counted: 995 }] },
  lines: [{ posName: "LATTE M", siteMenuId: null, slot: null, qty: 2, revenue: 390, isService: false }],
  ikram: [],
  payments: [
    { name: "Nakit", zField: "cash", channel: null, count: 6, amount: 1_315, kind: "nakit" },
    { name: "Kredi kartı", zField: "card", channel: null, count: 5, amount: 1_088, kind: "kart" },
  ],
  bankPos: OK,
  offDevice: OFF,
  okc: OKC,
  collections: [
    { name: "Kredi kartı", zField: "card", channel: null, kind: "kart", count: 1, amount: 195 },
    { name: "Nakit", zField: "cash", channel: null, kind: "nakit", count: 1, amount: 195 },
  ],
  shiftCounts: [{ at: "2026-11-24T15:00:00.000Z", counted: 1_530, expected: 1_540, diff: -10, confirmed: true }],
  discountLines: [{ scope: "order", posName: null, type: "percent", value: 10, amount: 32, reason: "Sadık müşteri" }],
  ...o,
});

test("Gövde: gün sonu tam alanları okunur (batch'ler, günün kartı, yazarkasa, tahsilat, vardiya, indirim, ödeme cinsi)", () => {
  const r = parsePosDay(JSON.stringify(body()), NOW);
  assert.ok(r.ok, "gövde geçerli");
  const d = r.data;
  assert.deepEqual(d.bankPos?.batches?.map((b) => [b.batchNo, b.total]), [
    ["000278", 240],
    ["000279", 755],
  ]);
  assert.equal(d.bankPos?.dayCard, 995);
  assert.deepEqual(d.okc, OKC);
  assert.equal(d.offDevice?.cardTips, 20);
  assert.equal(d.z.cashTips, 10);
  assert.equal(d.z.closeNote, "Kasa föyü sayıldı");
  assert.equal(d.z.methodCounts?.[0].counted, 995);
  assert.deepEqual(d.payments.map((p) => p.kind), ["nakit", "kart"]);
  assert.equal(d.collections?.length, 2);
  assert.equal(d.shiftCounts?.[0].diff, -10);
  assert.equal(d.discountLines?.[0].amount, 32);
});

test("Gövde: bozuk yeni alan günü reddetmez, yalnız o alan düşer; eski gövde aynen okunur", () => {
  const bad = parsePosDay(JSON.stringify(body({ okc: { provider: "pavo" }, collections: "x", bankPos: { ...OK, batches: [{ batchNo: 1 }] } })), NOW);
  assert.ok(bad.ok, "gün yine yazılır");
  assert.equal(bad.data.okc, undefined);
  assert.equal(bad.data.collections, undefined);
  assert.equal(bad.data.bankPos?.batches, undefined);
  assert.equal(bad.data.bankPos?.pavoCard, 755, "karşılaştırmanın geri kalanı kalır");
  const old = parsePosDay(JSON.stringify(body({ okc: undefined, collections: undefined, shiftCounts: undefined, discountLines: undefined, bankPos: undefined })), NOW);
  assert.ok(old.ok, "eski gövde");
  assert.equal(old.data.okc, undefined);
});

test("Günün özeti: yeni alanlar 'Düzeltildi' e-postası yollamaz (ödeme cinsi, nakit bahşiş, föy sayımı, kapanış notu)", () => {
  const before = { z: Z, payments: [{ name: "Nakit", zField: "cash", channel: null, count: 6, amount: 1_315 }], ikram: [] };
  const after = { z: { ...Z, cashTips: 10, closeNote: "not", methodCounts: [] }, payments: [{ ...before.payments[0], kind: "nakit" }], ikram: [] };
  assert.equal(dayHash(after), dayHash(before));
});

test("Banka POS: Pavo'nun bütün gün sonlarının toplamı (995), son batch'in tutarı (755) değil", () => {
  assert.deepEqual(bankPosAuto(OK), { value: 995, gap: null });
  const v = autoValuesOf(DAY, Z, NO_OUTS, null, { bankPos: OK, okc: OKC, offDevice: OFF });
  assert.equal(v.bankPos, 995);
  assert.equal(v.note, "LafPOS gün sonundan otomatik yazıldı.");
});

test("Banka POS: cihaz rakamı yoksa boş kalır ve not tam olarak nedenini söyler (uydurulmaz)", () => {
  assert.deepEqual(bankPosAuto(FAILED), {
    value: null,
    gap: "Banka POS: Pavo gün sonu alınamadı (hata 5085: Günsonu alınamadı (kod 5085)); LafPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al",
  });
  assert.deepEqual(bankPosAuto({ ...OK, status: "unknown" }), { value: null, gap: "Banka POS: Pavo gün sonunun sonucu belirsiz; LafPOS'ta Yönetim › Yazarkasa POS › Doğrula" });
  assert.deepEqual(bankPosAuto(null), { value: null, gap: "Banka POS: LafPOS'tan Pavo gün sonu gelmedi" });
  assert.deepEqual(bankPosAuto({ ...OK, batches: [batch("000278", 240, "elle", false), batch("000279", null, "elle", true)] }), { value: null, gap: "Banka POS: Pavo gün sonunda tutar okunamadı" });
  // Uçtan uca günde görüldü (24.11): kapanışta son başarılı sonuç gün ortasında elle alınan 000278 (240); kapanıştan sonraki
  // kart henüz hiçbir batch'te değil: 240 yazılmaz (sonra gelen alınamayan sonuç da onu tutardı)
  assert.deepEqual(bankPosAuto({ ...OK, batchNo: "000278", pavoCard: 240, batches: [batch("000278", 240, "elle", false)] }), {
    value: null,
    gap: "Banka POS: Pavo'nun kapanış gün sonu gelmedi (yalnız gün içinde alınan var); LafPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al",
  });
  // Eski LafPOS (batch listesi yok): son sonucun Pavo kartı
  assert.deepEqual(bankPosAuto({ ...OK, batches: undefined, dayCard: undefined }), { value: 755, gap: null });
  const v = autoValuesOf(DAY, Z, NO_OUTS, null, { bankPos: FAILED, okc: OKC, offDevice: OFF });
  assert.equal(v.bankPos, null);
  assert.equal(
    v.note,
    "LafPOS gün sonundan otomatik yazıldı. Eksik: Banka POS: Pavo gün sonu alınamadı (hata 5085: Günsonu alınamadı (kod 5085)); LafPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al.",
  );
  assert.doesNotMatch(String(v.note), /panelden/);
});

test("Yazarkasa: LafPOS'un cihaz belgelerinden; Pavo'da (Z basmaz) Z no'suz eksik sayılmaz, belge yoksa söylenir", () => {
  const v = autoValuesOf(DAY, Z, NO_OUTS, null, { bankPos: OK, okc: OKC, offDevice: OFF });
  assert.deepEqual([v.okcReceipts, v.okcTotal, v.okcCash, v.okcCard, v.okcMealCard, v.okcOther, v.okcVatTotal, v.okcZNo], [4, 1_190, 390, 800, 0, 0, 108.18, null]);
  assert.deepEqual(v.okcVat, [{ rate: 10, total: 1_190, vat: 108.18 }]);
  assert.deepEqual(autoMissing(Z, { bankPos: OK, okc: OKC }), []);
  const none = autoValuesOf(DAY, Z, NO_OUTS, null, { bankPos: OK, okc: null, offDevice: OFF });
  assert.deepEqual([none.okcTotal, none.okcCash, none.okcCard, none.okcVat, none.okcVatTotal], [null, null, null, null, null]);
  assert.equal(none.note, "LafPOS gün sonundan otomatik yazıldı. Eksik: Yazarkasa: LafPOS'ta cihaz belgesi yok.");
  assert.deepEqual(autoMissing(Z, { bankPos: OK, okc: null }), ["okc"]);
  // KDV dökümü hesaplanamadıysa toplamı da boş
  assert.equal(autoValuesOf(DAY, Z, NO_OUTS, null, { bankPos: OK, okc: { ...OKC, vat: null }, offDevice: OFF }).okcVatTotal, null);
  // Z basan cihaz (TokenX) Z no'suz gelirse söylenir
  assert.deepEqual(autoMissing(Z, { bankPos: OK, okc: { ...OKC, provider: "tokenx", zReport: true } }), ["okcZNo"]);
});

test("Eksikler: cihaz boşlukları ve fotoğraf (Pavo fişi; Z basan cihazda Z de) eklenene kadar", () => {
  assert.deepEqual(lafposPhotoNeed({ bankPos: OK, okc: OKC }), { slip: true, z: false, count: 1 });
  // Pavo istenince detaylı Z basar (sahibin yanıtı, 24 Kasım): tek fotoğraf; LafPOS'un `zReport`'u (Pavo için false) ölçü değil
  assert.deepEqual(lafposPhotoNeed({ bankPos: OK, okc: { ...OKC, zReport: true } }), { slip: true, z: false, count: 1 });
  assert.deepEqual(lafposPhotoNeed({ bankPos: OK, okc: { ...OKC, provider: "tokenx", zReport: true } }), { slip: true, z: true, count: 2 });
  assert.deepEqual(lafposPhotoNeed({ bankPos: null, okc: null }), { slip: false, z: false, count: 0 });
  assert.deepEqual(autoMissing(Z, { bankPos: FAILED, okc: OKC }, { attached: 0 }), ["bankPos", "photo"]);
  assert.deepEqual(autoMissing(Z, { bankPos: OK, okc: OKC }, { attached: 1 }), []);
  assert.deepEqual(autoMissing({ ...Z, countedCash: null }, { bankPos: null, okc: null }), ["bankPos", "okc", "countedCash"]);
  // Personelin gördüğü tek iş: fotoğraf
  assert.equal(staffPhotoLine({ slip: true, z: false, count: 1 }, 0, null), LAFPOS_PHOTO_TEXT.slip);
  assert.equal(staffPhotoLine({ slip: true, z: true, count: 2 }, 0, null), `${LAFPOS_PHOTO_TEXT.slip}. ${LAFPOS_PHOTO_TEXT.z}`);
  assert.equal(staffPhotoLine({ slip: true, z: false, count: 1 }, 1, null), LAFPOS_PHOTO_TEXT.done);
});

test("Birleştirme: sonradan gelen Pavo boş alanı doldurur; alınamayan gün sonu kayıtlı Banka POS'u silmez; elle yazılan kalır", () => {
  const first = autoValuesOf(DAY, Z, NO_OUTS, null, { bankPos: null, okc: OKC, offDevice: OFF });
  assert.equal(first.bankPos, null);
  const withPavo = autoValuesOf(DAY, Z, NO_OUTS, null, { bankPos: OK, okc: OKC, offDevice: OFF });
  const m1 = mergeAuto(first, first, withPavo);
  assert.equal(m1.values.bankPos, 995);
  assert.ok(m1.changed.includes("bankPos"), "Banka POS doldu");
  assert.ok(!m1.changed.includes("okcVat"), "aynı KDV dökümü değişmiş sayılmaz");
  // Sonra alınamayan gün sonu (null) kayıtlıyı silmez
  const failed = autoValuesOf(DAY, Z, NO_OUTS, null, { bankPos: FAILED, okc: OKC, offDevice: OFF });
  const m2 = mergeAuto(m1.values, m1.auto, failed);
  assert.equal(m2.values.bankPos, 995);
  // Yönetici Banka POS'u 1.000 yazdı: sonraki otomatik değer ezmez
  const edited: AutoValues = { ...m1.values, bankPos: 1_000 };
  const m3 = mergeAuto(edited, m1.auto, { ...withPavo, bankPos: 990 });
  assert.equal(m3.values.bankPos, 1_000);
  assert.deepEqual(m3.kept, ["bankPos"]);
});

test("Pavo kartı: günün toplamı (Σ batch) LafPOS'un bütün gün kartıyla karşılaştırılır, her batch listelenir", () => {
  const v = pavoView(OK);
  assert.equal(v.state, "uyumlu");
  assert.match(plain(v.headline), /^Uyumlu: Pavo'nun günü \(2 gün sonu, 995 ₺\) LafPOS'un bütün gün kartıyla aynı\.$/);
  assert.deepEqual(v.batches.map(([l, x]) => [l, plain(x)]), [
    ["Batch 000278 · elle", "240 ₺"],
    ["Batch 000279 · elle · kapanış", "755 ₺"],
  ]);
  assert.deepEqual(plain(v.rows.find(([l]) => l === "Pavo günün toplamı")?.[1] ?? ""), "995 ₺");
  assert.deepEqual(plain(v.rows.find(([l]) => l === "LafPOS bütün gün kartı")?.[1] ?? ""), "995 ₺");
  // Son batch satırı ayrıntı olarak kalır
  assert.ok(v.rows.some(([l]) => l === "Pavo kart toplamı"), "son batch");
  // Gün ortasında alınan 240 eksik kalsaydı (eski davranış "Uyumlu 755 = 755" derdi): fark
  const missed = pavoView({ ...OK, batches: [batch("000279", 755, "elle", true)] });
  assert.equal(missed.state, "fark");
  assert.match(plain(missed.headline), /^FARK VAR: 240 ₺ \(Pavo eksik\)/);
  // Eski LafPOS: son batch'le eskisi gibi
  assert.equal(pavoView({ ...OK, batches: undefined, dayCard: undefined }).state, "uyumlu");
});

test("Kart karşılaştırması: yazarkasadan geçmeyen kartın bahşişi düşer (995 = 995, yanlış 20 ₺ fark yok)", () => {
  const laf = lafposDayOf(Z, "2026-11-24T22:15:00.000Z", OFF, OKC);
  assert.equal(laf.cardExtra, 195);
  const report = { ...Z, cashIn: 405, countedCash: 1_535, handedOver: 0, bankPos: 995, okcCard: 800 };
  // LafPOS gününde kart farkı Pavo'nun banka gün sonuyla (yazarkasa kartı LafPOS'un kendi belgelerinden)
  const c = computeCash(withCardExtra(report, laf.cardExtra, laf.offDevice, "LafPOS"));
  assert.deepEqual([c.cardDiff, c.cardSource], [0, "bank"]);
  // Banka yoksa yazarkasa (belge) kartı bahşiş / tahsilat düşülmeden
  assert.equal(computeCash(withCardExtra({ ...report, bankPos: null }, laf.cardExtra, laf.offDevice, "LafPOS")).cardDiff, 0);
  // Cihazda iptal edilen belge de yazarkasanın ve bankanın dışında
  const voided = lafposDayOf(Z, "2026-11-24T22:15:00.000Z", OFF, { voided: { count: 1, cash: 0, card: 100 } });
  assert.deepEqual(voided.offDevice, { card: 388, cash: 925 });
});

test("Yazarkasa ↔ LafPOS (LafPOS günü): Z − yazarkasadan geçmeyen − cihazda iptal; banka gün sonu yazarkasa kartı + bahşiş + tahsilat", () => {
  const laf = lafposDayOf(Z, "2026-11-24T22:15:00.000Z", OFF, OKC);
  const f = withCardExtra({ ...Z, bankPos: 995, okcTotal: 1_190, okcCash: 390, okcCard: 800, okcMealCard: 0, okcOther: 0, okcVatTotal: 108.18, okcVat: [{ rate: 10, total: 1_190, vat: 108.18 }] }, laf.cardExtra, laf.offDevice);
  const lines = okcReconcile(f, "admin", "LafPOS");
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
  assert.equal(byKey["okc-card"].tone, "good", byKey["okc-card"].text);
  assert.equal(byKey["okc-cash"].tone, "good", byKey["okc-cash"].text);
  assert.equal(byKey["okc-bank"].tone, "good", byKey["okc-bank"].text);
  // ModPOS (Tuzla) eskisi gibi: yazarkasa kartı Z kartı + bahşiş / tahsilatla
  const modpos = okcReconcile({ ...Z, bankPos: 995, okcTotal: 1_283, okcCash: 1_315, okcCard: 1_283, cardExtra: 195 }, "admin", "ModPOS");
  assert.equal(modpos.find((l) => l.key === "okc-card")?.tone, "good");
});

test("Kart karşılaştırması: elle yazılan yazarkasa kartı (bahşiş ve tahsilat dahil) LafPOS gününde de eskisi gibi düşülür", () => {
  const laf = lafposDayOf(Z, "2026-11-24T22:15:00.000Z", OFF, OKC);
  // LafPOS'un cihaz belgelerinin kartı (okc.card) gün özetinde: otomatik raporun yazarkasa kartı bununla aynı
  assert.equal(laf.offDevice?.okcCard, OKC.card);
  // Personel raporu LafPOS'tan önce elle girdi, yazarkasa kartına banka fişindeki 995'i yazdı (bahşiş 20 + tahsilat 195 dahil)
  const human = { ...Z, cashIn: 405, countedCash: 1_535, handedOver: 0, bankPos: null, okcCard: 995 };
  const c = computeCash(withCardExtra(human, laf.cardExtra, laf.offDevice, "LafPOS"));
  assert.deepEqual([c.cardDiff, c.cardSource], [0, "okc"], "yanlış 'FARK VAR 195' yok");
  const lines = okcReconcile(withCardExtra({ ...human, okcTotal: 1_190 }, laf.cardExtra, laf.offDevice, "LafPOS"), "admin", "LafPOS");
  assert.equal(lines.find((l) => l.key === "okc-card")?.tone, "good", lines.find((l) => l.key === "okc-card")?.text);
  // Banka gün sonu da yazılıysa (elle): yazarkasa kartı banka fişinden, banka satırı bahşişi düşmez
  const both = okcReconcile(withCardExtra({ ...human, bankPos: 995, okcTotal: 1_190 }, laf.cardExtra, laf.offDevice, "LafPOS"), "admin", "LafPOS");
  assert.equal(both.find((l) => l.key === "okc-bank")?.tone, "good", both.find((l) => l.key === "okc-bank")?.text);
  // Otomatik rapor (yazarkasa kartı cihaz belgesinden, 800) eskisi gibi: düşülmez
  assert.equal(computeCash(withCardExtra({ ...human, okcCard: 800 }, laf.cardExtra, laf.offDevice, "LafPOS")).cardDiff, 0);
});

/** Pavo gün sonu fişinin okunuşu (ai_calls.result: KasaOkcRaw) */
const amt = (v: number | null) => ({ text: v === null ? null : String(v), value: v, confidence: "high" as const });
const slipRaw = (batches: { no: string | null; bank?: string; net: number | null; date?: string }[], o: Partial<KasaOkc> = {}): KasaOkc => ({
  documentType: "batch_slip",
  fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: false },
  readable: true,
  title: null,
  date: DAY,
  time: "23:10",
  dateConfidence: "high",
  zNo: { text: null, value: null, confidence: "high" },
  receiptCount: { text: null, value: null, confidence: "high" },
  dailyTotal: amt(null),
  dailyTotalLabel: null,
  kdvGroups: [],
  totalVat: amt(null),
  payments: [],
  outside: [],
  voids: amt(null),
  discounts: amt(null),
  cumulativeTotal: amt(null),
  cumulativeVat: amt(null),
  batches: batches.map((b) => ({ bank: b.bank ?? "Garanti BBVA", batchNo: b.no, date: b.date ?? DAY, salesTotal: amt(b.net), refundTotal: amt(null), netTotal: amt(b.net), transactionCount: null })),
  issues: [],
  ...o,
});
const REPORT = { bankPos: 995, okcZNo: null, okcTotal: 1_190, okcCash: 390, okcCard: 800, okcMealCard: 0, okcVat: [{ rate: 10, total: 1_190, vat: 108.18 }] };

test("Fotoğraf ↔ LafPOS: Pavo fişinin batch'leri, toplamı, tarihi ve banka dökümü tutuyorsa uyumlu", () => {
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([{ no: "000278", net: 240 }, { no: "279", net: 755 }]), error: null }], bankPos: OK, okc: OKC, report: REPORT }, NOW);
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  assert.deepEqual(c.issues, []);
  assert.equal(c.readBankPos, null);
  assert.equal(c.photos, 1);
});

test("Fotoğraf ↔ LafPOS: fark yöneticinin uyarısıdır (toplam, bilinmeyen batch, sayı, tarih)", () => {
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([{ no: "000279", net: 755 }, { no: "000300", net: 250 }], { date: "2026-11-27", time: "10:00" }), error: null }], bankPos: OK, okc: OKC, report: REPORT }, NOW);
  assert.equal(c.state, "fark");
  const text = plain(c.issues.join(" | "));
  assert.match(text, /Batch no: fotoğrafta 000279, 000300; LafPOS'ta 000278, 000279/);
  assert.match(text, /Banka POS toplamı: fotoğrafta 1\.005 ₺; LafPOS'ta 995 ₺/);
  assert.match(text, /Fişin günü: fotoğrafta 27\.11\.2026/);
});

test("Fotoğraf ↔ LafPOS: Banka POS boşsa (Pavo alınamadı) okunan tutar yöneticiye 'Banka POS'a yaz' için gösterilir", () => {
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([{ no: "000278", net: 240 }, { no: "000279", net: 755 }]), error: null }], bankPos: FAILED, okc: OKC, report: { ...REPORT, bankPos: null } }, NOW);
  assert.equal(c.readBankPos, 995);
  assert.match(plain(c.rows.find((r) => r.label === "Banka POS toplamı")!.photo), /^995 ₺$/);
});

test("Fotoğraf ↔ LafPOS: okunamayan / yanlış belge personelden yeniden çekilmesini ister; okuma kapalıysa yalnız 'alındı'", () => {
  const wrong = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([], { documentType: "other" }), error: null }], bankPos: OK, okc: OKC, report: REPORT }, NOW);
  assert.equal(wrong.state, "okunamadi");
  assert.equal(staffPhotoLine({ slip: true, z: false, count: 1 }, 1, wrong), LAFPOS_PHOTO_TEXT.retry);
  const off = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: null, error: null }], bankPos: OK, okc: OKC, report: REPORT }, NOW);
  assert.equal(off.state, "okunmadi");
  assert.equal(staffPhotoLine({ slip: true, z: false, count: 1 }, 1, off), LAFPOS_PHOTO_TEXT.done);
  // Okunan da uyumsuz da olsa personel yalnız "alındı" görür (fark yöneticinin)
  const fark = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([{ no: "000279", net: 700 }]), error: null }], bankPos: OK, okc: OKC, report: REPORT }, NOW);
  assert.equal(fark.state, "fark");
  assert.equal(staffPhotoLine({ slip: true, z: false, count: 1 }, 1, fark), LAFPOS_PHOTO_TEXT.done);
});

test("Fotoğraf ↔ LafPOS: Z basan cihazda yazarkasa Z'si de LafPOS'un yazarkasa rakamlarıyla karşılaştırılır", () => {
  const okc = { ...OKC, provider: "tokenx" as const, zReport: true };
  const z = slipRaw([], {
    documentType: "z_report",
    zNo: { text: "0042", value: 42, confidence: "high" },
    dailyTotal: amt(1_190),
    payments: [
      { label: "NAKİT", count: null, amount: amt(390), kind: "cash" },
      { label: "KREDİ", count: null, amount: amt(850), kind: "card" },
    ],
    kdvGroups: [{ rate: 10, total: amt(1_190), vat: amt(108.18), base: null }],
  });
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 2, raw: z, error: null }, { photoId: 3, raw: slipRaw([{ no: "000278", net: 240 }, { no: "000279", net: 755 }]), error: null }], bankPos: OK, okc, report: { ...REPORT, okcZNo: "42" } }, NOW);
  assert.equal(c.state, "fark");
  assert.match(plain(c.issues.join(" | ")), /Yazarkasa kartı: fotoğrafta 850 ₺; LafPOS'ta 800 ₺/);
  assert.ok(!c.issues.some((i) => i.startsWith("Yazarkasa Z no")), "Z no tutuyor (baştaki sıfır)");
});

test("Fotoğraf ↔ LafPOS: iki Pavo gün sonlu günde yalnız kapanış fişi çekildiyse çekilen batch karşılaştırılır (yanlış fark yok)", () => {
  // Gün içinde elle 000278 = 240, kapanış 000279 = 755; personel yalnız kapanış fişini çekti
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([{ no: "000279", net: 755 }]), error: null }], bankPos: OK, okc: OKC, report: REPORT }, NOW);
  assert.equal(c.state, "uyumlu", JSON.stringify(c.issues));
  assert.deepEqual(c.issues, []);
  const rows = Object.fromEntries(c.rows.map((r) => [r.label, r]));
  assert.equal(rows["Fotoğrafı olmayan batch"]?.lafpos, "000278");
  assert.ok(rows["Batch 000279"]?.ok);
  assert.equal(c.readBankPos, null);
  // Çekilen batch'in tutarı LafPOS'takinden farklıysa fark yine yöneticiye
  const wrong = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([{ no: "000279", net: 700 }]), error: null }], bankPos: OK, okc: OKC, report: REPORT }, NOW);
  assert.equal(wrong.state, "fark");
  assert.match(plain(wrong.issues.join(" | ")), /Batch 000279: fotoğrafta 700 ₺; LafPOS'ta 755 ₺/);
});

test("Fotoğraf ↔ LafPOS: batch satırı okunmayan Pavo fişi 'uyumlu' değil, yeniden çekilir", () => {
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([]), error: null }], bankPos: OK, okc: OKC, report: REPORT }, NOW);
  assert.equal(c.state, "okunamadi");
  assert.equal(staffPhotoLine({ slip: true, z: false, count: 1 }, 1, c), LAFPOS_PHOTO_TEXT.retry);
  // Pavo'nun sonucu henüz yokken okunan fiş: karşılaştırılacak bir şey yok, okunmadı (personel yeniden çekmez)
  const early = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: slipRaw([{ no: "000279", net: 755 }]), error: null }], bankPos: null, okc: OKC, report: { ...REPORT, bankPos: null } }, NOW);
  assert.equal(early.state, "okunmadi");
});

test("Fotoğraf: Pavo'nun sonucu gelmediyse (istenen 0) fotoğrafsız gün 'alındı' / tamam değil", () => {
  const need = lafposPhotoNeed({ bankPos: null, okc: OKC });
  assert.equal(need.count, 0);
  assert.equal(staffPhotoLine(need, 0, null), LAFPOS_PHOTO_TEXT.waiting);
  assert.equal(lafposPhotoDone(need, 0, null), false);
  assert.match(photoCheckText(null, need, 0), /^bekleniyor/);
  assert.ok(autoMissing({ countedCash: 1_535 }, { bankPos: null, okc: OKC }, { attached: 0, check: null }).includes("photo"));
  // Fiş çekildiyse tamam
  assert.equal(staffPhotoLine(need, 1, { state: "okunmadi" }), LAFPOS_PHOTO_TEXT.done);
  assert.equal(lafposPhotoDone(need, 1, { state: "okunmadi" }), true);
});

test("Bugün: LafPOS gününün raporu fotoğraf bekliyorsa personelin işi 'Gün sonu fotoğrafı'; eklenince tamam", () => {
  const tr = (local: string) => new Date(`${local}:00+03:00`);
  const r = (o: Partial<CashLite> = {}): CashLite => ({ date: "2026-11-24", cashDiff: -5, zTotal: 3_098, cash: 1_315, card: 1_088, submittedByName: "LafPOS (otomatik)", revision: 1, note: null, ...o });
  const facts = (today: CashLite | null, yesterday: CashLite | null = null, now = tr("2026-11-24T23:30")): DayFacts => ({
    role: "staff",
    now,
    cash: { today, yesterday, firstDate: "2026-11-01" },
    waste: { count: 0, zayi: null, ikram: null },
    lafposSwitch: "2026-11-23",
    stock: { month: "2026-11", counted: 40, total: 40, prevMonth: "2026-10", prevHasData: true, prevCounted: 40, prevTotal: 40 },
  });
  const pending = dayTasks(facts(r({ lafposPhoto: "pending" }))).find((t) => t.key === "kasa")!;
  assert.deepEqual([pending.title, pending.status, pending.detail, pending.action], ["Gün sonu fotoğrafı", "todo", "Pavo'dan gün sonu fişini (detaylı Z) alın ve fotoğrafını ekleyin", "Fotoğraf ekle"]);
  const done = dayTasks(facts(r({ lafposPhoto: "done" }))).find((t) => t.key === "kasa")!;
  assert.equal(done.status, "done");
  assert.match(done.detail, /Fotoğraf alındı/);
  // Dünün fotoğrafı ertesi gün de istenir
  const y = dayTasks(facts(null, r({ lafposPhoto: "pending" }), tr("2026-11-25T11:00"))).find((t) => t.key === "kasa-dun");
  assert.equal(y?.title, "Dünkü gün sonu fotoğrafı");
  assert.equal(y?.status, "todo");
});

test("Yöneticinin LafPOS ayrıntısı: kasaya giren nakdin parçaları (giriş, nakit bahşiş, nakit tahsilat) ve yazarkasa belgeleri", () => {
  const r = parsePosDay(
    JSON.stringify(
      body({
        cashMoves: [{ id: "01JABCDEFGHJKMNPQRSTVWXYZ0", kind: "giris", amount: 200, description: "", at: "2026-11-24T12:00:00.000Z", categoryId: null }],
      }),
    ),
    NOW,
  );
  assert.ok(r.ok, "gövde");
  const d = lafposDayDetail(r.data);
  const rows = Object.fromEntries(d.sections.flatMap((s) => s.rows).map(([l, v]) => [l, plain(v)]));
  assert.equal(rows["Kasaya giren (giriş)"], "1 · 200 ₺");
  assert.equal(rows["Nakit bahşiş"], "10 ₺");
  assert.equal(rows["Nakit tahsilat (cari)"], "1 · 195 ₺");
  assert.equal(rows["Kartla tahsilat (cari)"], "1 · 195 ₺");
  assert.equal(rows["Cihaz belgesi"], "4 belge · 1.190 ₺");
  assert.equal(rows["Kapanış notu"], "Kasa föyü sayıldı");
  assert.equal(rows["Föyde sayılan · Kredi kartı"], "995 ₺");
  assert.equal(rows["Vardiya devri 1"], "sayılan 1.530 ₺ · fark −10 ₺");
});

test("Gün sonu e-postası: Banka POS (batch'leriyle ya da tam hata metniyle), yazarkasanın kaynağı ve fotoğraf durumu", () => {
  const m: DayEndMail = {
    branchName: "Marina",
    date: DAY,
    z: Z,
    payments: [],
    ikram: [],
    values: null,
    missing: ["photo"],
    report: "auto",
    corrected: false,
    yesterday: { date: "2026-11-23", zTotal: null },
    lastWeek: { date: "2026-11-17", zTotal: null },
    online: null,
    link: "https://ladmin.test/panel/kasa?gun=2026-11-24",
    bankPos: OK,
    okc: OKC,
    photo: { need: { slip: true, z: false, count: 1 }, attached: 0, check: null },
  };
  const t = plain(renderDayEnd(m).text);
  assert.match(t, /Banka POS: 995 ₺ \(000278 240 ₺ \+ 000279 755 ₺\)/);
  assert.match(t, /Yazarkasa: LafPOS cihaz belgeleri · 4 belge · 1\.190 ₺/);
  assert.match(t, /Fotoğraf: bekleniyor \(Pavo gün sonu fişi\)/);
  assert.doesNotMatch(t, /panelde tamamlanacak/i);
  const failed = plain(renderDayEnd({ ...m, bankPos: FAILED }).text);
  assert.match(failed, /Banka POS: boş · Banka POS: Pavo gün sonu alınamadı \(hata 5085/);
});

/**
 * Pavo'nun detaylı Z'si (sahibin yanıtı, 24 Kasım 2026: "Pavo cihazdan fiş isteyince veriyor, Z olarak detaylı"): tek
 * fişte banka gün sonu (batch'ler) ve Z'nin rakamları (Z no, toplam, nakit, kart, yemek kartı / diğer, KDV)
 */
const detailedZ = (o: { card?: number; zNo?: string | null } = {}) =>
  slipRaw([{ no: "000278", net: 240 }, { no: "000279", net: 755 }], {
    documentType: "z_report",
    title: "Z RAPORU",
    zNo: o.zNo === null ? { text: null, value: null, confidence: "high" } : { text: o.zNo ?? "0007", value: Number(o.zNo ?? 7), confidence: "high" },
    dailyTotal: amt(1_190),
    payments: [
      { label: "NAKİT", count: null, amount: amt(390), kind: "cash" },
      { label: "KREDİ KARTI", count: null, amount: amt(o.card ?? 800), kind: "card" },
    ],
    kdvGroups: [{ rate: 10, total: amt(1_190), vat: amt(108.18), base: null }],
  });

test("Pavo detaylı Z: batch'ler ve Z rakamları LafPOS'u tutuyorsa uyumlu; LafPOS Z no göndermediyse fotoğraftaki yazılır (yöneticiye 'fotoğraftan')", () => {
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: detailedZ(), error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, okcOther: 0, lafposZNo: null } }, NOW);
  assert.equal(c.state, "uyumlu", JSON.stringify(c.rows));
  const labels = c.rows.map((r) => r.label);
  for (const l of ["Batch no", "Banka POS toplamı", "Yazarkasa Z no", "Yazarkasa toplamı", "Yazarkasa nakdi", "Yazarkasa kartı", "Yazarkasa KDV"]) assert.ok(labels.includes(l), `${l}: ${labels.join(", ")}`);
  assert.equal(c.zNoFromPhoto, "0007");
  // Aynı fişin iki fotoğrafı: batch'ler iki kez sayılmaz, Z'ler birlikte tutar
  const twice = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: detailedZ(), error: null }, { photoId: 2, raw: detailedZ(), error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, lafposZNo: null } }, NOW);
  assert.equal(twice.state, "uyumlu", JSON.stringify(twice.issues));
  assert.equal(twice.zNoFromPhoto, "0007");
  // LafPOS'un Z no'su varsa fotoğraftaki yazılmaz, yalnız karşılaştırılır
  const sent = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: detailedZ(), error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, okcZNo: "7", lafposZNo: "7" } }, NOW);
  assert.equal(sent.state, "uyumlu", JSON.stringify(sent.issues));
  assert.equal(sent.zNoFromPhoto ?? null, null);
  const other = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: detailedZ(), error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, okcZNo: "8", lafposZNo: "8" } }, NOW);
  assert.match(plain(other.issues.join(" | ")), /Yazarkasa Z no: fotoğrafta 0007; LafPOS'ta 8/);
  // Z no'suz okunan detaylı Z: Z no satırı yok, yazılmaz
  const noNo = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: detailedZ({ zNo: null }), error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, lafposZNo: null } }, NOW);
  assert.equal(noNo.state, "uyumlu", JSON.stringify(noNo.issues));
  assert.equal(noNo.zNoFromPhoto ?? null, null);
});

test("Pavo detaylı Z: kart farkı yöneticinin uyarısıdır; personel yalnız 'Fotoğraf alındı' görür", () => {
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: detailedZ({ card: 850 }), error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, lafposZNo: null } }, NOW);
  assert.equal(c.state, "fark");
  assert.match(plain(c.issues.join(" | ")), /Yazarkasa kartı: fotoğrafta 850 ₺; LafPOS'ta 800 ₺/);
  assert.match(plain(photoCheckText(c, lafposPhotoNeed({ bankPos: OK, okc: OKC }), 1)), /LafPOS'tan farklı: .*Yazarkasa kartı/);
  // Personelin satırı farkı söylemez
  assert.equal(staffPhotoLine(lafposPhotoNeed({ bankPos: OK, okc: OKC }), 1, c), LAFPOS_PHOTO_TEXT.done);
  // Kart satırı basmayan cihaz (yalnız banka adları): banka satırlarının toplamı kart sayılır
  const sub = detailedZ();
  sub.payments = [
    { label: "NAKİT", count: null, amount: amt(390), kind: "cash" },
    { label: "GARANTI", count: null, amount: amt(800), kind: "bank_subline" },
  ];
  const bySub = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: sub, error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, lafposZNo: null } }, NOW);
  assert.equal(bySub.state, "uyumlu", JSON.stringify(bySub.issues));
});

test("Personel LafPOS'un otomatik gününde fotoğraf ↔ rapor farkını görmez (eski 'Fotoğraftan farklı yazılan' yolu); yönetici ve ModPOS günü eskisi gibi", () => {
  const diffs = [{ field: "bankPos" }];
  assert.deepEqual(staffPhotoDiffs(diffs, { admin: false, lafposAuto: true }), []);
  assert.equal(staffPhotoDiffs(null, { admin: false, lafposAuto: true }), null);
  assert.deepEqual(staffPhotoDiffs(diffs, { admin: true, lafposAuto: true }), diffs);
  assert.deepEqual(staffPhotoDiffs(diffs, { admin: false, lafposAuto: false }), diffs);
});

test("Personelin LafPOS günü metinleri: yalnız fotoğraf; notun yönetici yönergesi yerine kısa nötr satır; fotoğrafın adı 'Pavo gün sonu fişi'", () => {
  assert.equal(LAFPOS_STAFF_DESCRIPTION, "Rakamlar LafPOS'tan geldi; Pavo'dan gün sonu fişini (detaylı Z) alıp fotoğrafını ekleyin.");
  assert.equal(LAFPOS_PHOTO_TEXT.slip, "Pavo'dan gün sonu fişini (detaylı Z) alın ve fotoğrafını ekleyin");
  const note =
    "LafPOS gün sonundan otomatik yazıldı. Kapanış notu (LafPOS): Kasa föyü sayıldı. Eksik: Banka POS: Pavo gün sonu alınamadı (hata 5085: Günsonu alınamadı (kod 5085)); LafPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al.";
  const staff = staffAutoNote(note, { bankPos: null, okcTotal: 1_190 })!;
  assert.equal(staff, "LafPOS gün sonundan otomatik yazıldı. Kapanış notu (LafPOS): Kasa föyü sayıldı. Banka POS henüz gelmedi; yönetici ilgileniyor.");
  assert.doesNotMatch(staff, /Yönetim ›|Cihazda gün sonu|hata 5085/);
  // Yönetici Banka POS'u yazdıysa satır yok; eksik yoksa not aynen
  assert.equal(staffAutoNote(note, { bankPos: 995, okcTotal: 1_190 }), "LafPOS gün sonundan otomatik yazıldı. Kapanış notu (LafPOS): Kasa föyü sayıldı.");
  assert.equal(staffAutoNote("LafPOS gün sonundan otomatik yazıldı.", { bankPos: 995, okcTotal: 1_190 }), "LafPOS gün sonundan otomatik yazıldı.");
  assert.equal(staffAutoNote(null, { bankPos: null, okcTotal: null }), null);
  assert.match(staffAutoNote("LafPOS gün sonundan otomatik yazıldı. Eksik: Yazarkasa: LafPOS'ta cihaz belgesi yok.", { bankPos: 995, okcTotal: null })!, /Yazarkasa belgeleri henüz gelmedi; yönetici ilgileniyor\.$/);
  // Fotoğrafın adı: Pavo gününde "Pavo gün sonu fişi"; "Yazarkasa Z" yalnız mali Z basan cihazda
  assert.equal(lafposPhotoLabel(lafposPhotoNeed({ bankPos: OK, okc: OKC })), "Pavo gün sonu fişi");
  assert.equal(lafposPhotoLabel(lafposPhotoNeed({ bankPos: OK, okc: { ...OKC, provider: "tokenx", zReport: true } })), "Yazarkasa Z");
});

test("Kasa sayfası: personelin LafPOS gününde alt başlık LafPOS metni, fotoğraf farkı ve not personelden süzülür (kaynak denetimi)", () => {
  const page = readFileSync(join(process.cwd(), "src/app/panel/kasa/page.tsx"), "utf8");
  const form = readFileSync(join(process.cwd(), "src/app/panel/kasa/cash-form.tsx"), "utf8");
  assert.ok(page.includes("staffLafposDescriptionOf("), "alt başlık");
  assert.ok(page.includes("staffPhotoDiffs("), "WhatsApp metninin fotoğraf farkı");
  assert.ok(page.includes("staffAutoNote("), "eski LafPOS gününün notu");
  assert.ok(form.includes("staffPhotoDiffs("), "Fotoğraflar bloğunun farkı");
  assert.ok(form.includes("staffAutoNote("), "kayıtlı raporun notu");
});

/*
 * İnceleme düzeltmeleri (üçüncü tur): fotoğraftan Z no yalnız günü doğrulanmış ve LafPOS'u tutan fotoğraftan; aynı batch
 * metni farklı okunsa da bir kez sayılır; personelin LafPOS notu kesilmez; ödeme bölümü okunmayan Z sahte fark vermez;
 * personelden gizleme kuralı hata olursa kapalı kalır; sayım bekleyen günün alt başlığı gövdeyle çelişmez
 */

test("Fotoğraftan Z no: yalnız günü doğrulanmış ve LafPOS'u tutan fotoğraftan (başka günün Z'si rapora yazılmaz)", () => {
  const base = { bankPos: OK, okc: OKC, report: { ...REPORT, okcOther: 0, lafposZNo: null } };
  // Dünün Z'si (batch bölümü yok, 23.11, toplam 2.000): fark, Z'nin günü satırı, Z no yazılmaz
  const yesterday = slipRaw([], { documentType: "z_report", title: "Z RAPORU", date: "2026-11-23", time: "23:40", zNo: { text: "0006", value: 6, confidence: "high" }, dailyTotal: amt(2_000) });
  const y = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: yesterday, error: null }], ...base }, NOW);
  assert.equal(y.state, "fark");
  assert.equal(y.zNoFromPhoto ?? null, null);
  const zDay = y.rows.find((r) => r.label === "Z'nin günü");
  assert.ok(zDay && !zDay.ok, JSON.stringify(y.rows));
  // Rakamları tutan ama dünün detaylı Z'si (fişin günü 23.11): fark, Z no yazılmaz
  const old = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: { ...detailedZ(), date: "2026-11-23", time: "23:10" }, error: null }], ...base }, NOW);
  assert.equal(old.state, "fark");
  assert.equal(old.zNoFromPhoto ?? null, null);
  // Rakamı farklı detaylı Z (kart): fark, Z no yazılmaz (yönetici bakar)
  const card = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: detailedZ({ card: 850 }), error: null }], ...base }, NOW);
  assert.equal(card.state, "fark");
  assert.equal(card.zNoFromPhoto ?? null, null);
  // Batch bölümü olmayan Z, günü tutuyor ve rakamlar aynı: Z'nin günü satırı tamam, Z no yazılır
  const sameDayZ = slipRaw([], { documentType: "z_report", title: "Z RAPORU", zNo: { text: "0007", value: 7, confidence: "high" }, dailyTotal: amt(1_190), payments: detailedZ().payments, kdvGroups: detailedZ().kdvGroups });
  const ok = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: sameDayZ, error: null }], ...base }, NOW);
  assert.equal(ok.state, "uyumlu", JSON.stringify(ok.rows));
  assert.ok(ok.rows.some((r) => r.label === "Z'nin günü" && r.ok));
  assert.equal(ok.zNoFromPhoto, "0007");
  // Tarihi okunmayan Z: günü bilinmiyor, Z no yazılmaz (uydurulmaz)
  const noDate = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: { ...sameDayZ, date: null, time: null }, error: null }], ...base }, NOW);
  assert.equal(noDate.zNoFromPhoto ?? null, null);
  // Detaylı Z'de fişin günü satırı Z'nin de günüdür: ayrı "Z'nin günü" satırı yok
  const detailed = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: detailedZ(), error: null }], ...base }, NOW);
  assert.ok(!detailed.rows.some((r) => r.label === "Z'nin günü"), JSON.stringify(detailed.rows));
  assert.equal(detailed.zNoFromPhoto, "0007");
});

test("Aynı batch farklı metinle okunsa da bir kez sayılır; aynı batch farklı tutarla okunursa fark ve öneri yok", () => {
  const one: BankPos = { ...OK, batches: [batch("000279", 755, "elle", true)], dayCard: 755 };
  const report = { ...REPORT, bankPos: null };
  const read = (net: { text: string | null; value: number | null }, sales: { text: string | null; value: number | null } = net) => {
    const r = slipRaw([{ no: "000279", net: 755 }]);
    r.batches[0] = { ...r.batches[0], netTotal: { ...net, confidence: "high" }, salesTotal: { ...sales, confidence: "high" } };
    return r;
  };
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: read({ text: "755,00", value: 755 }), error: null }, { photoId: 2, raw: read({ text: "755.00", value: 755 }), error: null }], bankPos: one, okc: OKC, report }, NOW);
  assert.equal(c.readBankPos, 755, JSON.stringify(c.rows));
  assert.equal(c.state, "uyumlu", JSON.stringify(c.issues));
  // Bir fotoğrafta NET satırı kesik (yalnız satış okundu)
  const cut = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: read({ text: "755", value: 755 }), error: null }, { photoId: 2, raw: read({ text: null, value: null }, { text: "755", value: 755 }), error: null }], bankPos: one, okc: OKC, report }, NOW);
  assert.equal(cut.readBankPos, 755, JSON.stringify(cut.rows));
  // Bir fotoğrafta tutar hiç okunmadı: öteki fotoğrafın tutarı geçer
  const blank = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: read({ text: "755", value: 755 }), error: null }, { photoId: 2, raw: read({ text: null, value: null }), error: null }], bankPos: one, okc: OKC, report }, NOW);
  assert.equal(blank.readBankPos, 755, JSON.stringify(blank.rows));
  // Aynı batch iki farklı tutarla: fark, "Banka POS'a yaz" önerisi yok
  const clash = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: read({ text: "755", value: 755 }), error: null }, { photoId: 2, raw: read({ text: "760", value: 760 }), error: null }], bankPos: one, okc: OKC, report }, NOW);
  assert.equal(clash.state, "fark");
  assert.equal(clash.readBankPos, null);
  assert.match(plain(clash.issues.join(" | ")), /Batch 000279: fotoğrafta 755 ₺ \/ 760 ₺/);
});

test("Ödeme bölümü okunmayan Z sahte nakit / kart farkı vermez; yazdırılmayan sıfır satır sıfır sayılır", () => {
  const z = { ...detailedZ(), payments: [] };
  const c = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: z, error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, okcOther: 0, lafposZNo: null } }, NOW);
  assert.equal(c.state, "uyumlu", JSON.stringify(c.issues));
  assert.ok(!c.rows.some((r) => r.label === "Yazarkasa nakdi" || r.label === "Yazarkasa kartı"), JSON.stringify(c.rows));
  // Ödeme bölümü okundu, yemek kartı satırı yok (LafPOS'ta 0): tamam; kart satırı yokken LafPOS'ta kart varsa fark
  const noCard = { ...detailedZ(), payments: [detailedZ().payments[0]] };
  const d = lafposPhotoCheck({ day: DAY, reads: [{ photoId: 1, raw: noCard, error: null }], bankPos: OK, okc: OKC, report: { ...REPORT, okcOther: 0, lafposZNo: null } }, NOW);
  assert.ok(d.rows.find((r) => r.label === "Yazarkasa yemek kartı")?.ok);
  assert.match(plain(d.issues.join(" | ")), /Yazarkasa kartı: fotoğrafta 0 ₺; LafPOS'ta 800 ₺/);
});

test("Personelin notu: LafPOS kapanış notundaki 'Eksik:' kesilmez (otomatik eksik bölümü notun sonundadır)", () => {
  const note = "LafPOS gün sonundan otomatik yazıldı. Kapanış notu (LafPOS): Eksik: 2 bardak kırıldı. Eksik: Banka POS: Pavo gün sonu alınamadı; LafPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al.";
  assert.equal(staffAutoNote(note, { bankPos: null, okcTotal: 1_190 }), "LafPOS gün sonundan otomatik yazıldı. Kapanış notu (LafPOS): Eksik: 2 bardak kırıldı. Banka POS henüz gelmedi; yönetici ilgileniyor.");
});

test("Personelden gizleme kapalı kalır: fotoğraf durumu okunamazsa otomatik rapor kendi kaydından tanınır, okuma hatasında gizli", () => {
  assert.equal(staffLafposAutoOf({ admin: true, hasReport: true, photoAuto: true, reportAuto: true }), false);
  assert.equal(staffLafposAutoOf({ admin: false, hasReport: false, photoAuto: null, reportAuto: "error" }), false);
  assert.equal(staffLafposAutoOf({ admin: false, hasReport: true, photoAuto: true, reportAuto: false }), true);
  assert.equal(staffLafposAutoOf({ admin: false, hasReport: true, photoAuto: null, reportAuto: true }), true, "fotoğraf durumu düştü, rapor otomatik");
  assert.equal(staffLafposAutoOf({ admin: false, hasReport: true, photoAuto: null, reportAuto: "error" }), true, "okunamadı: gizli");
  assert.equal(staffLafposAutoOf({ admin: false, hasReport: true, photoAuto: null, reportAuto: false }), false, "elle girilen / ModPOS günü");
  const page = readFileSync(join(process.cwd(), "src/app/panel/kasa/page.tsx"), "utf8");
  assert.ok(page.includes("staffLafposAutoOf("), "sayfa kuralı kullanır");
  assert.ok(page.includes("lafposAutoReport("), "raporun kendi kaydı");
});

test("Personelin alt başlığı: otomatik raporlu günde 'Rakamlar LafPOS'tan geldi', sayım bekleyen günde rapor bekleniyor", () => {
  assert.equal(staffLafposDescriptionOf(null), null);
  assert.equal(staffLafposDescriptionOf({ auto: true }), LAFPOS_STAFF_DESCRIPTION);
  assert.equal(staffLafposDescriptionOf({ auto: false }), LAFPOS_STAFF_WAITING_DESCRIPTION);
  assert.doesNotMatch(LAFPOS_STAFF_WAITING_DESCRIPTION, /geldi/);
  assert.match(LAFPOS_STAFF_WAITING_DESCRIPTION, /LafPOS'tan gelecek/);
});
