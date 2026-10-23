// Teslim kontrolü (docs/MAL-SIPARISI.md › Teslim kontrolü): faturanın seçimi, kalem kalem karşılaştırma, siparişin
// durumu, zil satırları ve Bugün'ün olguları (src/lib/reorder/delivery.ts).
// Çalıştırma: npx tsx --test tests/teslim-kontrolu.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkSummary,
  deliveryCheck,
  deliveryDayFacts,
  deliveryNotifications,
  isCandidate,
  isLate,
  looksConsolidated,
  needsAutoExpire,
  orderState,
  pickInvoice,
  priceNote,
  ratioHint,
  rowText,
  sameCheck,
  shouldAutoClose,
  type InvoiceCandidate,
  type InvoiceLineLite,
  type LinkLite,
} from "../src/lib/reorder/delivery";
import type { CheckRow, DeliveryCheck, OrderLite, ReorderLine } from "../src/lib/reorder/types";

const NOW = new Date("2026-10-28T09:00:00Z");

/** 2 koli süt (1 koli = 12 L = 12000 ml), beklenen 0,04 ₺/ml (40 ₺/L) */
const line = (over: Partial<ReorderLine> = {}): ReorderLine => ({
  ingredientId: 1,
  name: "Süt",
  orderName: "SÜT %3 YAĞLI 1 L",
  qty: 2,
  unit: "koli",
  unitSize: 12000,
  baseUnit: "ml",
  countUnit: "LT",
  leadDays: 2,
  suggested: 2,
  onHand: 5000,
  par: 30000,
  expectedUnitPrice: 0.04,
  priceEstimated: false,
  ...over,
});

const krema = (over: Partial<ReorderLine> = {}) =>
  line({ ingredientId: 2, name: "Krema", orderName: "KREMA 1 L", qty: 6, unit: "adet", unitSize: 1000, expectedUnitPrice: 0.15, ...over });

const LINKS = new Map<string, LinkLite>([
  ["p-sut", { ingredientId: 1, factor: 12000, name: "Süt", baseUnit: "ml" }],
  ["p-sut-adet", { ingredientId: 1, factor: 1000, name: "Süt", baseUnit: "ml" }],
  ["p-krema", { ingredientId: 2, factor: 1000, name: "Krema", baseUnit: "ml" }],
  ["p-kakao", { ingredientId: 3, factor: 1000, name: "Kakao", baseUnit: "gr" }],
]);

const inv = (lines: InvoiceLineLite[], over: Partial<{ id: number; invoiceNo: string | null; date: string; payable: number }> = {}) => ({
  id: 77,
  invoiceNo: "SUT2026000123",
  date: "2026-10-28",
  payable: 1200,
  lines,
  ...over,
});

/** Süt faturası kalemi: koli adedi ve KDV hariç net tutar */
const sut = (quantity: number, netTotal = quantity * 480): InvoiceLineLite => ({ productKey: "p-sut", productName: "SÜT %3 YAĞLI 1 L", quantity, unit: "Koli", netTotal });
const kremaLine = (quantity: number, netTotal = quantity * 150): InvoiceLineLite => ({ productKey: "p-krema", productName: "KREMA 1 L", quantity, unit: "Adet", netTotal });
const nakliye: InvoiceLineLite = { productKey: "p-nakliye", productName: "NAKLİYE", quantity: 1, unit: "Adet", netTotal: 150 };

const check = (lines: ReorderLine[], invoiceLines: InvoiceLineLite[]) => deliveryCheck({ lines }, inv(invoiceLines), LINKS, NOW);

// ---------------------------------------------------------------- Karşılaştırma

test("tam teslim: hepsi tamam, kendiliğinden kapanır; %1,5 eksik tamam, %3 eksik eksik, hiç gelmeyen gelmedi, %3 fazla fazla", () => {
  const exact = check([line()], [sut(2)]);
  assert.equal(exact.rows.length, 1);
  assert.equal(exact.rows[0].status, "tamam");
  assert.equal(exact.rows[0].ordered, 24000);
  assert.equal(exact.rows[0].delivered, 24000);
  assert.equal(exact.rows[0].unitPrice, 0.04);
  assert.equal(exact.rows[0].priceDiff, 0);
  assert.equal(exact.rows[0].priceFlag, false);
  assert.deepEqual(exact.rows[0].productNames, ["SÜT %3 YAĞLI 1 L"]);
  assert.equal(exact.ok, true);
  assert.equal(exact.linesRead, true);
  assert.equal(exact.consolidated, false);
  assert.equal(shouldAutoClose(exact), true);
  assert.deepEqual(exact.counts, { eksik: 0, gelmedi: 0, fazla: 0, fiyat: 0, disi: 0, bagliDegil: 0 });
  assert.equal(exact.invoiceId, 77);
  assert.equal(exact.invoiceNo, "SUT2026000123");
  assert.equal(exact.at, NOW.toISOString());

  // Fiyatı aynı tutmak için net tutar miktarla oranlı
  assert.equal(check([line()], [sut(1.97)]).rows[0].status, "tamam", "%1,5 eksik");
  const short = check([line()], [sut(1.94)]);
  assert.equal(short.rows[0].status, "eksik", "%3 eksik");
  assert.equal(short.ok, false);
  assert.equal(shouldAutoClose(short), false);
  const over = check([line()], [sut(2.06)]);
  assert.equal(over.rows[0].status, "fazla", "%3 fazla");
  assert.equal(over.ok, false);

  // Krema hiç gelmedi (fatura okundu: süt satırı var)
  const missing = check([line(), krema()], [sut(2)]);
  assert.equal(missing.rows.find((r) => r.ingredientId === 2)!.status, "gelmedi");
  assert.equal(missing.rows.find((r) => r.ingredientId === 2)!.delivered, 0);
  assert.equal(missing.counts.gelmedi, 1);
  assert.equal(missing.ok, false);
});

test("çarpanlar: adetle kesilen fatura (×1000) koli siparişiyle tutar; yanlış çarpan (×12) fazla ve ipucu 12", () => {
  // 24 adet 1 L = 2 koli × 12 L
  const adet: InvoiceLineLite = { productKey: "p-sut-adet", productName: "SÜT 1 L", quantity: 24, unit: "Adet", netTotal: 960 };
  const ok = check([line()], [adet]);
  assert.equal(ok.rows[0].status, "tamam");
  assert.equal(ok.rows[0].delivered, 24000);
  assert.equal(ok.ok, true);

  // Bağlantı adet kalemine koli çarpanı vermiş: 24 × 12000 = 12 kat
  const wrong = new Map(LINKS);
  wrong.set("p-sut-adet", { ingredientId: 1, factor: 12000, name: "Süt", baseUnit: "ml" });
  const bad = deliveryCheck({ lines: [line()] }, inv([adet]), wrong, NOW);
  assert.equal(bad.rows[0].status, "fazla");
  assert.equal(bad.rows[0].ratioHint, 12);
  // Tersine (koli kalemine adet çarpanı): 1/12
  const inverse = new Map(LINKS);
  inverse.set("p-sut", { ingredientId: 1, factor: 1000, name: "Süt", baseUnit: "ml" });
  const small = deliveryCheck({ lines: [line()] }, inv([sut(2)]), inverse, NOW);
  assert.equal(small.rows[0].status, "eksik");
  // Ekran "yaklaşık 12 kat az" yazar (1 ÷ ipucu)
  assert.ok(small.rows[0].ratioHint! < 1);
  assert.equal(Math.round(1 / small.rows[0].ratioHint!), 12);
});

test("ratioHint: yalnız yaklaşık tam kat ya da tam bölüm (±%5), 2–1000", () => {
  assert.equal(ratioHint(2, 24), 12);
  assert.equal(ratioHint(2, 23.5), 12);
  assert.equal(ratioHint(10, 5), 0.5);
  assert.equal(ratioHint(2, 3), null, "1,5 kat");
  assert.equal(ratioHint(2, 2.04), null, "1 kat");
  assert.equal(ratioHint(0, 24), null);
  assert.equal(ratioHint(2, 0), null);
  assert.equal(ratioHint(1, 5000), null, "1000'den büyük");
  // Tamam ve gelmedi satırında ipucu yok
  assert.equal(check([line()], [sut(2)]).rows[0].ratioHint, null);
});

test("fiyat: %6 pahalı işaretli, %2 değil; bedava kalem miktara girer fiyata girmez; iade miktarı düşürür", () => {
  const up6 = check([line()], [sut(2, 960 * 1.06)]);
  assert.equal(up6.rows[0].status, "tamam");
  assert.equal(up6.rows[0].priceFlag, true);
  assert.ok(Math.abs(up6.rows[0].priceDiff! - 0.06) < 1e-9);
  assert.equal(up6.counts.fiyat, 1);
  assert.equal(up6.ok, false);
  assert.equal(priceNote(up6.rows[0]), "Fiyat +%6");

  const up2 = check([line()], [sut(2, 960 * 1.02)]);
  assert.equal(up2.rows[0].priceFlag, false);
  assert.equal(up2.ok, true);
  assert.equal(priceNote(up2.rows[0]), null);

  const cheaper = check([line()], [sut(2, 960 * 0.95)]);
  assert.equal(cheaper.rows[0].priceFlag, true);
  assert.equal(priceNote(cheaper.rows[0]), "Fiyat −%5");

  // 3 koli: 2'si faturalı, 1'i bedava (net 0): miktar tamam, birim fiyat yalnız faturalı ikisinden
  const free = check([line({ qty: 3 })], [sut(2), sut(1, 0)]);
  assert.equal(free.rows[0].delivered, 36000);
  assert.equal(free.rows[0].status, "tamam");
  assert.equal(free.rows[0].unitPrice, 0.04);
  assert.equal(free.rows[0].priceFlag, false);

  // 3 koli geldi, 1'i iade (eksi kalem): 2 koli sayılır; fiyat artı kalemden
  const ret = check([line()], [sut(3), sut(-1, -480)]);
  assert.equal(ret.rows[0].delivered, 24000);
  assert.equal(ret.rows[0].status, "tamam");
  assert.equal(ret.rows[0].unitPrice, 0.04);
  assert.equal(ret.ok, true);
});

test("beklenen fiyat yok ya da 0 (fiyatı girilmemiş kalem): fiyat karşılaştırılmaz, sipariş yine kapanır", () => {
  const none = check([line({ expectedUnitPrice: null })], [sut(2, 2000)]);
  assert.equal(none.rows[0].expectedUnitPrice, null);
  assert.equal(none.rows[0].priceDiff, null);
  assert.equal(none.rows[0].priceFlag, false);
  assert.equal(none.rows[0].unitPrice, 2000 / 24000);
  assert.equal(none.ok, true);
  assert.equal(shouldAutoClose(none), true);
  // Eski kayıtta 0 kalmış olsa da bölme yok: her teslim "fiyat farkı" olmaz
  const zero = check([line({ expectedUnitPrice: 0 })], [sut(2)]);
  assert.equal(zero.rows[0].expectedUnitPrice, null);
  assert.equal(zero.rows[0].priceDiff, null);
  assert.equal(zero.rows[0].priceFlag, false);
  assert.equal(zero.ok, true);
});

test("tahmini fiyat: fark hesaplanır ama uyarı yok, sipariş kapanır", () => {
  const est = check([line({ priceEstimated: true })], [sut(2, 960 * 1.2)]);
  assert.ok(Math.abs(est.rows[0].priceDiff! - 0.2) < 1e-9);
  assert.equal(est.rows[0].priceFlag, false);
  assert.equal(est.counts.fiyat, 0);
  assert.equal(est.ok, true);
  assert.equal(priceNote(est.rows[0]), null);
});

test("fazladan kalemler: bağlı ama sipariş edilmemiş hammadde siparişte yoktu (kapanmaz); bağlı olmayan nakliye kapanmayı engellemez", () => {
  const kakao: InvoiceLineLite = { productKey: "p-kakao", productName: "KAKAO 1 KG", quantity: 1, unit: "Adet", netTotal: 400 };
  const extra = check([line()], [sut(2), kakao]);
  const row = extra.rows.find((r) => r.ingredientId === 3)!;
  assert.equal(row.status, "siparis-disi");
  assert.equal(row.ordered, null);
  assert.equal(row.delivered, 1000);
  assert.equal(row.name, "Kakao");
  assert.equal(row.unitPrice, 0.4);
  assert.equal(extra.counts.disi, 1);
  assert.equal(extra.ok, false);
  assert.equal(rowText(row), "Siparişte yoktu");

  const ship = check([line()], [sut(2), nakliye]);
  const n = ship.rows.find((r) => r.status === "bagli-degil")!;
  assert.equal(n.name, "NAKLİYE");
  assert.equal(n.ingredientId, null);
  assert.equal(ship.counts.bagliDegil, 1);
  assert.equal(ship.ok, true);
  assert.equal(shouldAutoClose(ship), true);
  assert.equal(rowText(n), "Hammaddeye bağlı değil");
  // Bağlı olmayan iade satırı listelenmez
  assert.equal(check([line()], [sut(2), { ...nakliye, quantity: -1, netTotal: -150 }]).rows.length, 1);
});

test("kalemleri okunmamış fatura: tamam sayılmaz, kendiliğinden kapanmaz, durum 'kalemler okunmadı'", () => {
  const lineless = check([line()], []);
  assert.equal(lineless.linesRead, false);
  assert.equal(lineless.ok, false);
  assert.equal(shouldAutoClose(lineless), false);
  assert.equal(checkSummary(lineless), "kalemler okunmadı");
  assert.deepEqual(orderState({ ...base(), check: lineless, invoiceId: 77 }, "2026-10-28"), {
    key: "kalem-bekleniyor",
    label: "Fatura geldi · kalemler okunmadı",
    tone: "gray",
  });
});

test("checkSummary ve rowText: sayılar sırayla, koli koli fark", () => {
  // Süt %3 eksik, krema tamam ama %6 pahalı
  const mixed = check([line({ qty: 3 }), krema()], [sut(2), kremaLine(6, 900 * 1.06)]);
  assert.equal(checkSummary(mixed), "1 eksik, 1 fiyat farkı");
  assert.equal(rowText(mixed.rows[0]), "1 koli eksik");
  assert.equal(checkSummary(check([line()], [sut(2)])), "Faturayla tuttu");
  const all = check([line(), krema(), line({ ingredientId: 9, name: "Şeker", qty: 1 })], [sut(4), { productKey: "p-kakao", productName: "KAKAO", quantity: 1, unit: "Adet", netTotal: 400 }]);
  assert.equal(checkSummary(all), "2 gelmedi, 1 fazla, 1 kalem siparişte yoktu");
  assert.equal(rowText(all.rows[0]), "2 koli fazla");
  assert.equal(rowText(all.rows[1]), "Gelmedi");
  assert.equal(rowText(check([line()], [sut(1.5)]).rows[0]), "0,5 koli eksik");
  assert.equal(rowText(check([line()], [sut(2)]).rows[0]), "Tamam");
});

test("toplu fatura: dört sipariş satırının üçü 1,8 katı ya da fazlası", () => {
  const r = (ordered: number, delivered: number): CheckRow => ({
    ingredientId: 1,
    name: "x",
    productNames: [],
    ordered,
    delivered,
    unit: "koli",
    unitSize: 1,
    baseUnit: "ml",
    countUnit: null,
    status: "fazla",
    unitPrice: null,
    expectedUnitPrice: null,
    priceDiff: null,
    priceFlag: false,
    ratioHint: null,
  });
  assert.equal(looksConsolidated([r(10, 20), r(10, 18), r(10, 25), r(10, 10)]), true);
  assert.equal(looksConsolidated([r(10, 20), r(10, 18), r(10, 10), r(10, 10)]), false, "2 / 4");
  assert.equal(looksConsolidated([r(10, 30)]), false, "tek satır");
  // Siparişte olmayan satır sayılmaz
  assert.equal(looksConsolidated([r(10, 20), { ...r(10, 99), ordered: null }]), false);
  // deliveryCheck de işaretler
  assert.equal(check([line(), krema()], [sut(4), kremaLine(12)]).consolidated, true);
});

test("sameCheck: anı ve anahtar sırası fark etmez; sayı değişince farklı", () => {
  const a = check([line()], [sut(2)]);
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse()))) as DeliveryCheck;
  assert.equal(sameCheck(a, { ...reordered, at: "2026-11-01T00:00:00.000Z" }), true);
  assert.equal(sameCheck(a, check([line()], [sut(1.9)])), false);
  assert.equal(sameCheck(null, null), true);
  assert.equal(sameCheck(a, null), false);
  assert.equal(sameCheck(null, a), false);
});

// ---------------------------------------------------------------- Faturanın seçimi

const ORDER = { sentDay: "2026-10-26", expectedOn: "2026-10-28", supplierId: "kart:1", ingredientIds: new Set([1, 2, 3]) };
const cand = (over: Partial<InvoiceCandidate>): InvoiceCandidate => ({
  id: 1,
  date: "2026-10-28",
  supplierId: "kart:1",
  invoiceNo: null,
  payable: 1000,
  hasLines: true,
  ingredientIds: new Set([1]),
  ...over,
});

test("pickInvoice: tedarikçi, tarih aralığı, örtüşme, eşitlikte beklenen güne yakın, kalemsiz 3 gün, alınmış fatura", () => {
  const today = "2026-10-29";
  const none = new Set<number>();
  assert.equal(pickInvoice(ORDER, [cand({ supplierId: "kart:2" })], none, today), null, "başka tedarikçi");
  assert.equal(pickInvoice(ORDER, [cand({ date: "2026-10-25" })], none, today), null, "siparişten önce");
  assert.equal(pickInvoice(ORDER, [cand({ date: "2026-11-06" })], none, "2026-11-07"), null, "10 günden sonra");
  assert.equal(pickInvoice(ORDER, [cand({ date: "2026-11-05" })], none, "2026-11-07")?.id, 1, "10. gün");
  assert.equal(pickInvoice(ORDER, [cand({ date: "2026-10-26" })], none, today)?.id, 1, "gönderim günü");
  assert.equal(pickInvoice(ORDER, [cand({ ingredientIds: new Set([9]) })], none, today), null, "örtüşme yok");

  const most = pickInvoice(ORDER, [cand({ id: 1, ingredientIds: new Set([1]) }), cand({ id: 2, date: "2026-10-30", ingredientIds: new Set([1, 2]) })], none, "2026-10-31");
  assert.equal(most?.id, 2, "en çok örtüşen");
  const near = pickInvoice(ORDER, [cand({ id: 1, date: "2026-10-31", ingredientIds: new Set([1, 2]) }), cand({ id: 2, date: "2026-10-27", ingredientIds: new Set([2, 3]) })], none, "2026-11-01");
  assert.equal(near?.id, 2, "eşitlikte beklenen güne yakın");
  const byId = pickInvoice(ORDER, [cand({ id: 5, date: "2026-10-27" }), cand({ id: 4, date: "2026-10-29" })], none, "2026-11-01");
  assert.equal(byId?.id, 4, "aynı uzaklıkta küçük kimlik");

  const lineless = cand({ hasLines: false, ingredientIds: new Set() });
  assert.equal(pickInvoice(ORDER, [lineless], none, "2026-10-30"), null, "kalemsiz, 2 günlük");
  assert.equal(pickInvoice(ORDER, [lineless], none, "2026-10-31")?.id, 1, "kalemsiz, 3 günlük");
  assert.equal(isCandidate(ORDER, lineless, "2026-10-31"), true);

  assert.equal(pickInvoice(ORDER, [cand({ id: 3 })], new Set([3]), today), null, "başka siparişe bağlı");
  assert.equal(pickInvoice(ORDER, [cand({ id: 3 }), cand({ id: 6, date: "2026-10-29" })], new Set([3]), today)?.id, 6);
});

// ---------------------------------------------------------------- Siparişin durumu

function base(over: Partial<OrderLite> = {}): OrderLite {
  return {
    id: 1,
    supplier: "Sütaş",
    supplierKey: "kart:1",
    sentAt: "2026-10-26T07:00:00.000Z",
    sentDay: "2026-10-26",
    expectedOn: "2026-10-28",
    status: "open",
    receivedAt: null,
    receivedByName: null,
    invoiceId: null,
    manualMatch: false,
    lines: [line()],
    check: null,
    closedAt: null,
    closedByName: null,
    closeNote: null,
    phone: "905321234567",
    channel: "whatsapp",
    message: "Merhaba",
    note: null,
    sentByName: "Yönetici",
    ...over,
  };
}

test("orderState: yolda, gecikti, geldi, fatura farkı (renk), bağlı ama karşılaştırılmamış, kapandı, iptal", () => {
  assert.deepEqual(orderState(base(), "2026-10-27"), { key: "yolda", label: "Yolda · Çarşamba bekleniyor", tone: "blue" });
  assert.deepEqual(orderState(base(), "2026-10-28"), { key: "yolda", label: "Yolda · bugün bekleniyor", tone: "blue" });
  assert.deepEqual(orderState(base(), "2026-10-29"), { key: "gecikti", label: "Gecikti · 28.10.2026 bekleniyordu", tone: "amber" });
  assert.deepEqual(orderState(base({ receivedAt: "2026-10-28T08:00:00.000Z" }), "2026-10-30"), { key: "geldi", label: "Geldi · fatura bekleniyor", tone: "blue" });
  assert.deepEqual(orderState(base({ invoiceId: 77 }), "2026-10-30"), { key: "kalem-bekleniyor", label: "Fatura bağlandı · karşılaştırılmadı", tone: "gray" });

  const short = check([line()], [sut(1.5)]);
  assert.deepEqual(orderState(base({ invoiceId: 77, check: short }), "2026-10-30"), { key: "fark", label: "Fatura geldi · 1 eksik", tone: "red" });
  assert.equal(orderState(base({ invoiceId: 77, check: check([line()], [sut(2.5)]) }), "2026-10-30").tone, "amber", "fazla");
  assert.equal(orderState(base({ invoiceId: 77, check: check([line()], [sut(2, 960 * 1.1)]) }), "2026-10-30").tone, "red", "pahalı");
  assert.equal(orderState(base({ invoiceId: 77, check: check([line()], [sut(2, 960 * 0.9)]) }), "2026-10-30").tone, "amber", "ucuz");
  assert.deepEqual(orderState(base({ invoiceId: 77, check: check([line()], [sut(2)]) }), "2026-10-30"), { key: "fark", label: "Fatura geldi · Faturayla tuttu", tone: "green" });

  assert.deepEqual(orderState(base({ status: "closed", closeNote: "Faturayla tuttu" }), "2026-10-30"), { key: "kapandi", label: "Kapandı · Faturayla tuttu", tone: "green" });
  assert.deepEqual(orderState(base({ status: "closed" }), "2026-10-30"), { key: "kapandi", label: "Kapandı", tone: "green" });
  assert.deepEqual(orderState(base({ status: "cancelled", check: short }), "2026-10-30"), { key: "iptal", label: "İptal", tone: "gray" });
});

test("needsAutoExpire: faturasız açık sipariş 46. günde kapanır; 45. gün, faturalı ya da kapanmış değil", () => {
  assert.equal(needsAutoExpire(base({ sentDay: "2026-09-10" }), "2026-10-26"), true, "46 gün");
  assert.equal(needsAutoExpire(base({ sentDay: "2026-09-11" }), "2026-10-26"), false, "45 gün");
  assert.equal(needsAutoExpire(base({ sentDay: "2026-09-10", invoiceId: 3 }), "2026-10-26"), false);
  assert.equal(needsAutoExpire(base({ sentDay: "2026-09-10", status: "closed" }), "2026-10-26"), false);
});

test("isLate: beklenen günden 1 günden fazla geçti, gelmedi işaretlenmedi, faturası yok", () => {
  assert.equal(isLate(base(), "2026-10-29"), false, "1 gün");
  assert.equal(isLate(base(), "2026-10-30"), true, "2 gün");
  assert.equal(isLate(base({ receivedAt: "2026-10-29T08:00:00.000Z" }), "2026-10-30"), false);
  assert.equal(isLate(base({ invoiceId: 4 }), "2026-10-30"), false);
  assert.equal(isLate(base({ status: "closed" }), "2026-10-30"), false);
});

// ---------------------------------------------------------------- Zil ve Bugün

test("zil: teslim farkı önce (karşılaştırma değişince yeni kimlik), sonra gelmeyenler; en çok 5, Faturalar grubu", () => {
  const today = "2026-10-30";
  const diff = base({ id: 11, invoiceId: 77, check: check([line()], [sut(1.5)]) });
  const items = deliveryNotifications([diff], today);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: "teslim-11-e1-g0-f0-p0-d0",
    kind: "warning",
    title: "Teslim kontrolü: Sütaş",
    body: "26.10.2026 siparişi · 1 eksik · fatura 28.10.2026",
    timeLabel: "28.10.2026",
    unread: true,
    href: "/panel/mal-siparisi/gonderilen#siparis-11",
    group: "fatura",
  });
  // Yeni kalem okundu: fark değişti, zil yeniden okunmamış
  const changed = deliveryNotifications([{ ...diff, check: check([line(), krema()], [sut(1.5)]) }], today);
  assert.notEqual(changed[0].id, items[0].id);
  // Tutan, kalemleri okunmamış ve kapanmış sipariş zile gelmez
  assert.deepEqual(deliveryNotifications([base({ invoiceId: 77, check: check([line()], [sut(2)]) })], "2026-10-28"), []);
  assert.deepEqual(deliveryNotifications([base({ invoiceId: 77, check: check([line()], []) })], "2026-10-28"), []);
  assert.deepEqual(deliveryNotifications([{ ...diff, status: "closed" }], today), []);

  // Gelmedi: beklenen günden 1 gün sonra değil, 2 gün sonra
  assert.deepEqual(deliveryNotifications([base()], "2026-10-29"), []);
  const late = deliveryNotifications([base({ id: 12 })], "2026-10-30");
  assert.equal(late.length, 1);
  assert.equal(late[0].id, "mal-siparisi-gelmedi-12");
  assert.equal(late[0].kind, "info");
  assert.equal(late[0].title, "Mal siparişi gelmedi mi: Sütaş");
  assert.equal(late[0].body, "26.10.2026 gönderildi, 28.10.2026 bekleniyordu. Geldiyse işaretleyin.");
  assert.equal(late[0].group, "fatura");

  const many = [diff, ...Array.from({ length: 6 }, (_, i) => base({ id: 20 + i }))];
  const capped = deliveryNotifications(many, today);
  assert.equal(capped.length, 5);
  assert.equal(capped[0].id.startsWith("teslim-11-"), true, "fark önce");
  assert.ok(capped.every((n) => n.group === "fatura" && n.href.startsWith("/panel/mal-siparisi/gonderilen#siparis-")));
});

test("Bugün olguları: farklar en yeni fatura önce, gelmeyenlerin sayısı", () => {
  const older = base({ id: 1, supplier: "Kaldi", invoiceId: 70, check: deliveryCheck({ lines: [line()] }, inv([sut(1.5)], { id: 70, date: "2026-10-27" }), LINKS, NOW) });
  const newer = base({ id: 2, supplier: "Sütaş", invoiceId: 71, check: deliveryCheck({ lines: [line()] }, inv([sut(2.5)], { id: 71, date: "2026-10-29" }), LINKS, NOW) });
  const facts = deliveryDayFacts([older, newer, base({ id: 3 }), base({ id: 4, receivedAt: "2026-10-29T08:00:00.000Z" })], "2026-10-30");
  assert.deepEqual(facts, {
    issues: [
      { supplier: "Sütaş", summary: "1 fazla" },
      { supplier: "Kaldi", summary: "1 eksik" },
    ],
    late: 1,
  });
});
