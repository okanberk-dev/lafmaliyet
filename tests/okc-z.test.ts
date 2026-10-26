// Yazarkasanın (banka POS) mali Z raporu: kimlikler K1–K9, kopya kimlikler (D7), kart satırı olmayan cihaz, okuma
// tuzakları, alan durumları ve forma doldurma, Z no sürekliliği, kümülatifin saklanması, tarih, belge türleri, canlı
// form denetimi, mutabakat satırları, sameVat ve okcMonth (src/lib/okc-z.ts, src/lib/photo-read/okc.ts; dalga 13
// PR-b, docs/planlar/okc-z.md §5, §6, §8, §9, §11). Okumalar sentetiktir (ağ yok); gerçek fotoğraflar adım b2'de.
// Çalıştırma: npx tsx --test tests/okc-z.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  okcChecks,
  okcCumulativeToStore,
  okcFormChecks,
  okcFormError,
  okcHasFigures,
  okcLateChain,
  okcMonth,
  okcReconcile,
  sameVat,
  vatTol,
  type OkcFigures,
  type OkcFormValues,
  type OkcPrev,
  type OkcReportFields,
  type OkcRow,
} from "../src/lib/okc-z";
import { claudeSchema } from "../src/lib/photo-read/claude-schema";
import { photoDiffs, prefillPlan, prefillSummary, savedFields, UNSURE_TEXT, type CashReading, type ReadField } from "../src/lib/photo-read/kasa";
import { normalizeOkc, OKC_CUT_OFF_TEXT, okcNeedsHalves, okcReadFigures, toStaffReading } from "../src/lib/photo-read/okc";
import { OKC_TASK } from "../src/lib/photo-read/prompts";
import { KasaOkcRaw, type AmountRaw, type KasaOkc } from "../src/lib/photo-read/schemas";

// ---------------------------------------------------------------- sentetik okumalar

/** Türk biçimiyle basılı tutar: 9350 → "*9.350,00" */
function tr(v: number): string {
  const [i, d] = Math.abs(v).toFixed(2).split(".");
  return `*${v < 0 ? "-" : ""}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
}
const A = (v: number | null, confidence: "high" | "medium" | "low" = "high"): AmountRaw => ({ text: v === null ? null : tr(v), value: v, confidence });
const NONE: AmountRaw = { text: null, value: null, confidence: "low" };

const DAY = "2026-10-24";
const PREV: OkcPrev = { z: { date: "2026-10-23", zNo: "0100" }, cum: { date: "2026-10-23", zNo: "0100", cumTotal: 1_250_000, cumVat: 118_000 } };

/**
 * Araştırma notlarının (§2) örnek Z'si: %10 8.110 / 737,27 · %20 1.240 / 206,67 · toplam 9.350 · KDV 943,94 · nakit
 * 2.450 · kart 6.900 (altında ÖRNEKBANK) · KASA NAKİT · 40 fiş · Z 0101 · KÜM. 1.259.350 / 118.943,94 (önceki 0100:
 * 1.250.000 / 118.000, zincir tutuyor)
 */
function z(over: Partial<KasaOkc> = {}): KasaOkc {
  return KasaOkcRaw.parse({
    documentType: "z_report",
    fiscalMarks: { mfLogo: true, ekuNo: true, cumulativeLines: true, vatBlock: true },
    readable: true,
    title: "Z RAPORU",
    date: DAY,
    time: "23:50",
    dateConfidence: "high",
    zNo: { text: "0101", value: 101, confidence: "high" },
    receiptCount: { text: "40", value: 40, confidence: "high" },
    dailyTotal: A(9350),
    dailyTotalLabel: "NET SATIŞ",
    kdvGroups: [
      { rate: 10, total: A(8110), vat: A(737.27), base: null },
      { rate: 20, total: A(1240), vat: A(206.67), base: null },
    ],
    totalVat: A(943.94),
    payments: [
      { label: "NAKİT", count: 9, amount: A(2450), kind: "cash" },
      { label: "KASA NAKİT", count: null, amount: A(2450), kind: "drawer" },
      { label: "K.KARTI", count: 31, amount: A(6900), kind: "card" },
      { label: "ÖRNEKBANK", count: null, amount: A(6900), kind: "bank_subline" },
    ],
    outside: [],
    voids: NONE,
    discounts: NONE,
    cumulativeTotal: A(1_259_350),
    cumulativeVat: A(118_943.94),
    batches: [],
    issues: [],
    ...over,
  });
}

/** Tek oranlı, tek ödemeli gün (L'Affogato'nun çoğu günü): aynı rakam NET SATIŞ, %10 TOPLAM ve K.KARTI */
function single(total: number, confidence: "high" | "medium" = "high"): KasaOkc {
  const vat = Math.round(((total * 10) / 110) * 100) / 100;
  return z({
    dailyTotal: A(total, confidence),
    kdvGroups: [{ rate: 10, total: A(total, confidence), vat: A(vat, confidence), base: null }],
    totalVat: A(vat, confidence),
    payments: [{ label: "K.KARTI", count: 31, amount: A(total, confidence), kind: "card" }],
    cumulativeTotal: NONE,
    cumulativeVat: NONE,
  });
}

/** Kimliklerin doğrudan girdisi (örnek Z'nin rakamları) */
const fig = (o: Partial<OkcFigures> = {}): OkcFigures => ({
  zNo: "0101",
  receipts: 40,
  total: 9350,
  vatTotal: 943.94,
  groups: [
    { rate: 10, total: 8110, vat: 737.27 },
    { rate: 20, total: 1240, vat: 206.67 },
  ],
  cash: 2450,
  card: 6900,
  mealCard: 0,
  other: 0,
  ...o,
});
const NO_PREV = { prev: { z: null } } as const;

const ALL_FIELDS: ReadField[] = ["okcZNo", "okcReceipts", "okcTotal", "okcVatTotal", "okcCash", "okcCard", "okcMealCard", "okcOther", "okcT1", "okcV1", "okcT10", "okcV10", "okcT20", "okcV20", "bankPos"];
const emptyForm = () => Object.fromEntries(ALL_FIELDS.map((f) => [f, ""])) as Partial<Record<ReadField, string>>;
/** Doldurmanın açık hâli (OKC_PREFILL_ENABLED canlı değerlendirmeye kadar kapalı; kapalı hâli ayrı testte) */
const ON = { okcPrefill: true } as const;
const JARGON = /kümülatif|zincir|KÜM\.|MATRAH/i;

// ---------------------------------------------------------------- şema ve istem

test("şema: örnek Z ayrışır, API biçimi kapalı nesne; istem günü taşır", () => {
  const schema = claudeSchema(KasaOkcRaw) as { type: string; additionalProperties: boolean; properties: Record<string, unknown> };
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.ok("kdvGroups" in schema.properties && "cumulativeTotal" in schema.properties && "batches" in schema.properties);
  assert.equal(z().zNo.text, "0101");
  const task = OKC_TASK(DAY);
  assert.ok(task.includes(DAY));
  assert.ok(task.includes("software_z") && task.includes("bank_subline") && task.includes("KÜM."));
});

// ---------------------------------------------------------------- örnek Z: doğrulanan alanlar

test("örnek Z: iki oran ve nakit + kart kimlikleri alanları doğrular; KASA NAKİT ve banka alt satırı toplanmaz", () => {
  const r = normalizeOkc(z(), { day: DAY, prev: PREV });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "kasa-okc");
  assert.equal(r.values.okcTotal?.value, 9350);
  assert.equal(r.values.okcCash?.value, 2450, "KASA NAKİT nakde eklenmez");
  assert.equal(r.values.okcCard?.value, 6900, "ÖRNEKBANK karta eklenmez");
  for (const f of ["okcTotal", "okcVatTotal", "okcT10", "okcV10", "okcT20", "okcV20", "okcCash", "okcCard", "okcZNo"] as const) {
    assert.equal(r.values[f]?.status, "confirmed", f);
  }
  assert.equal(r.values.okcReceipts?.status, undefined, "fiş sayısı denetlenemedi");
  assert.deepEqual(r.okcVat, [
    { rate: 10, total: 8110, vat: 737.27 },
    { rate: 20, total: 1240, vat: 206.67 },
  ]);
  assert.deepEqual(r.okcAdmin, { documentZNo: "0101", cumTotal: 1_259_350, cumVat: 118_943.94, outside: null, voids: null });
  assert.ok(r.checks.some((c) => c.admin && c.text === "Önceki Z'yle (0100, 23 Ekim) kümülatif zinciri tutuyor."));
  // Kümülatif günün rakamı olarak hiçbir alana gitmez
  assert.ok(!Object.values(r.values).some((v) => v?.value === 1_259_350));
});

test("personelin yanıtı: kümülatif, toplam dışı tahsilat ve yöneticinin satırları yok (D17)", () => {
  const raw = z({ outside: [{ label: "FATURALI SATIŞ", amount: A(1250) }], voids: A(85) });
  const admin = normalizeOkc(raw, { day: DAY, prev: PREV });
  assert.ok(admin.checks.some((c) => c.admin && c.text.includes("toplam dışında 1.250\u00a0₺")));
  assert.ok(admin.checks.some((c) => c.admin && c.text.includes("85\u00a0₺ fiş iptali")));
  const staff = toStaffReading(admin);
  const json = JSON.stringify(staff);
  for (const key of ["okcAdmin", "cumTotal", "cumVat", "cumulativeTotal", "cumulativeVat", "outside", "okcOutside"]) assert.ok(!json.includes(`"${key}"`), key);
  assert.ok(!json.includes("1.259.350") && !json.includes("1259350"));
  assert.ok(staff.checks.every((c) => !c.admin));
  for (const c of staff.checks) assert.doesNotMatch(c.text, JARGON);
  for (const v of Object.values(staff.values)) if (v?.reason) assert.doesNotMatch(v.reason, JARGON);
});

// ---------------------------------------------------------------- toleranslar

test("K1 toleransı: 0,04\u00a0₺ tutar, 0,06\u00a0₺ tutmaz (toplam K4 ile doğrulanmış kalır)", () => {
  const held = okcChecks(fig({ groups: [{ rate: 10, total: 8110.04, vat: 737.27 }, { rate: 20, total: 1240, vat: 206.67 }] }), NO_PREV);
  assert.equal(held.status.okcT10, "confirmed");
  const broke = okcChecks(fig({ groups: [{ rate: 10, total: 8110.06, vat: 737.27 }, { rate: 20, total: 1240, vat: 206.67 }] }), NO_PREV);
  assert.equal(broke.status.okcT10, "failed");
  assert.equal(broke.status.okcT20, "failed");
  assert.equal(broke.status.okcTotal, "confirmed", "K4 (nakit + kart) doğruladı; K1 yalnız oranları düşürür");
  assert.ok(broke.checks.some((c) => c.key === "k1" && c.text.startsWith("Oranların toplamı (9.350,06\u00a0₺) günlük toplamı (9.350\u00a0₺) tutmuyor")));
});

test("K3 payı fiş sayısıyla büyür: 300 fişte 1,50\u00a0₺", () => {
  assert.equal(vatTol(300), 1.5);
  assert.equal(vatTol(null), 1);
  assert.equal(vatTol(2), 0.05);
  const ok = okcChecks(fig({ receipts: 300, vatTotal: 945.34, groups: [{ rate: 10, total: 8110, vat: 738.67 }, { rate: 20, total: 1240, vat: 206.67 }] }), NO_PREV);
  assert.ok(!ok.checks.some((c) => c.key === "k3-10"));
  const bad = okcChecks(fig({ receipts: 300, groups: [{ rate: 10, total: 8110, vat: 738.87 }, { rate: 20, total: 1240, vat: 206.67 }] }), NO_PREV);
  assert.ok(bad.checks.some((c) => c.key === "k3-10" && c.text === "%10 KDV'si 738,87\u00a0₺; bu toplamdan beklenen 737,27\u00a0₺. Rakamlardan biri yanlış okunmuş olabilir."));
  // K1 %10 toplamını doğruladı: K3 suçu doğrulanmamış KDV'de bulur
  assert.equal(bad.status.okcT10, "confirmed");
  assert.equal(bad.status.okcV10, "failed");
  // İki ucu da başka kimliklerle doğrulanmışsa K3 ikisini de düşürür (çelişki)
  const both = okcChecks(fig({ receipts: 300, vatTotal: 945.54, groups: [{ rate: 10, total: 8110, vat: 738.87 }, { rate: 20, total: 1240, vat: 206.67 }] }), NO_PREV);
  assert.equal(both.status.okcT10, "failed");
  assert.equal(both.status.okcV10, "failed");
});

test("K3 hiçbir alanı doğrulamaz ve 143 fişte toplamdaki 5\u00a0₺'lik hatayı göremez (yalnız çürütür)", () => {
  const r = okcChecks(fig({ receipts: 143, total: 8115, vatTotal: 737.27, groups: [{ rate: 10, total: 8115, vat: 737.27 }], cash: 0, card: 8115 }), NO_PREV);
  assert.ok(!r.checks.some((c) => c.key.startsWith("k3")));
  assert.equal(r.status.okcT10, undefined);
  assert.equal(r.status.okcV10, undefined);
  assert.equal(r.status.okcTotal, undefined);
});

test("K4: yazarkasa dışı tahsilat ödemelerin fazlasını açıklar", () => {
  const r = okcChecks(fig({ other: 1250, outside: 1250 }), NO_PREV);
  assert.equal(r.status.okcCash, "confirmed");
  assert.equal(r.status.okcOther, "confirmed");
  const bad = okcChecks(fig({ other: 1250 }), NO_PREV);
  assert.equal(bad.status.okcOther, "failed");
  assert.equal(bad.reasons.okcOther, "Nakit, kart ve öteki ödemeler toplanınca günlük toplam çıkmıyor (1.250\u00a0₺ fazla).");
});

// ---------------------------------------------------------------- kopya kimlikler (D7)

test("kopya kimlikler: tek oranlı ve tek ödemeli günde aynı yanlış üç yerde tutar ama alan doğrulanmaz", () => {
  // 9.350 soluk basılmış, üç yerde 9.530 okunmuş: K1, K2, K4 tutar (aynı rakamın kopyaları)
  const r = normalizeOkc(single(9530, "medium"), { day: DAY, prev: { z: null } });
  for (const f of ["okcTotal", "okcT10", "okcV10", "okcVatTotal", "okcCard"] as const) assert.equal(r.values[f]?.status, undefined, f);
  const plan = prefillPlan(r, emptyForm(), ON);
  const total = plan.fill.find((f) => f.field === "okcTotal");
  assert.equal(total?.warn, UNSURE_TEXT, "orta güvende turuncu dolar");
  // İki oranlı, nakit + kartlı gün: orta güvende de mavi dolar
  const two = normalizeOkc(z({ dailyTotal: A(9350, "medium") }), { day: DAY, prev: { z: null } });
  assert.equal(two.values.okcTotal?.status, "confirmed");
  assert.equal(prefillPlan(two, emptyForm(), ON).fill.find((f) => f.field === "okcTotal")?.warn, null);
});

test("tek ödemeli gün (hepsi kart) K4 ile doğrulanmaz; iki ödeme türüyle doğrular", () => {
  const one = okcChecks(fig({ cash: 0, card: 9350 }), NO_PREV);
  assert.equal(one.status.okcCard, undefined);
  assert.equal(one.status.okcTotal, "confirmed", "iki oran (K1) hâlâ doğrular");
  const oneRate = okcChecks(fig({ cash: 0, card: 9350, groups: [{ rate: 10, total: 9350, vat: 850 }], vatTotal: 850 }), NO_PREV);
  assert.equal(oneRate.status.okcTotal, undefined);
  assert.equal(oneRate.status.okcT10, undefined);
});

// ---------------------------------------------------------------- kart satırı olmayan cihaz

test("kart satırı olmayan cihaz: kart = Σ banka satırları ve yöneticiye bilgi; kart satırı varsa alt satırlar eklenmez", () => {
  const r = normalizeOkc(
    z({
      payments: [
        { label: "NAKİT", count: 9, amount: A(2450), kind: "cash" },
        { label: "GARANTİ", count: 20, amount: A(4000), kind: "bank_subline" },
        { label: "YAPI KREDİ", count: 11, amount: A(2900), kind: "bank_subline" },
      ],
    }),
    { day: DAY, prev: PREV },
  );
  assert.equal(r.values.okcCard?.value, 6900);
  assert.equal(r.values.okcCard?.status, "confirmed");
  assert.ok(r.checks.some((c) => c.admin && c.text === "Z'de kart satırı yok; banka satırları toplanıp kart yazıldı."));
  assert.ok(!toStaffReading(r).checks.some((c) => c.text.includes("kart satırı yok")));

  const mismatch = normalizeOkc(
    z({
      payments: [
        { label: "NAKİT", count: 9, amount: A(2450), kind: "cash" },
        { label: "K.KARTI", count: 31, amount: A(6900), kind: "card" },
        { label: "ÖRNEKBANK", count: null, amount: A(6000), kind: "bank_subline" },
      ],
    }),
    { day: DAY, prev: PREV },
  );
  assert.equal(mismatch.values.okcCard?.value, 6900);
  assert.ok(mismatch.checks.some((c) => c.text === "Banka satırlarının toplamı kart satırını tutmuyor; kartı fişle karşılaştırın."));
});

// ---------------------------------------------------------------- tuzaklar

test("tuzak: kümülatif günlük diye okunmuş (eşitlik, K1, büyüklük, K6)", () => {
  const raw = z({ dailyTotal: A(1_259_350), totalVat: A(118_943.94) });
  const r = normalizeOkc(raw, { day: DAY, prev: PREV, recentTotals: [9000, 9500, 10000, 8800] });
  assert.equal(r.values.okcTotal?.status, "failed");
  assert.equal(r.values.okcVatTotal?.status, "failed");
  const admin = r.checks.filter((c) => c.admin).map((c) => c.text);
  assert.ok(admin.includes("Günlük toplam kümülatif satırla aynı; KÜM. satırı okunmuş olabilir."));
  assert.ok(admin.includes("Günlük toplam için çok büyük (1.259.350\u00a0₺); KÜM. (kümülatif) satırı okunmuş olabilir."));
  assert.ok(admin.some((t) => t.startsWith("Önceki Z'den (0100) bu yana kümülatif artış")));
  assert.equal(r.values.okcTotal?.reason, "Günlük toplam bir gün için çok büyük; fişin altındaki cihaz toplamı okunmuş olabilir.");
  // Forma yazılmaz, öneri olur
  const plan = prefillPlan(r, emptyForm(), ON);
  assert.ok(!plan.fill.some((f) => f.field === "okcTotal"));
  assert.ok(plan.unsure.some((u) => u.field === "okcTotal" && u.reason === r.values.okcTotal?.reason));
});

test("tuzak: GENEL TOPLAM yalnız iki ayrı rakamla doğrulanırsa kabul", () => {
  const lone = okcChecks(fig({ totalLabel: "GENEL TOPLAM", cash: 0, card: 9350, groups: [{ rate: 10, total: 9350, vat: 850 }], vatTotal: 850 }), NO_PREV);
  assert.equal(lone.status.okcTotal, "failed");
  assert.ok(lone.checks.some((c) => c.key === "general-total"));
  const backed = okcChecks(fig({ totalLabel: "GENEL TOPLAM" }), NO_PREV);
  assert.equal(backed.status.okcTotal, "confirmed");
});

test("tuzak: MATRAH grup toplamı diye, TOPKDV grup toplamı diye", () => {
  const base = okcChecks(fig({ groups: [{ rate: 10, total: 7372.73, vat: 737.27 }, { rate: 20, total: 1240, vat: 206.67 }] }), NO_PREV);
  assert.equal(base.status.okcT10, "failed");
  assert.equal(base.status.okcV10, "confirmed", "K2 doğruladı: K3 suçu toplamda bulur");
  assert.equal(base.status.okcTotal, "confirmed");
  assert.ok(base.checks.some((c) => c.key === "k3-10"));
  const vat = okcChecks(fig({ groups: [{ rate: 10, total: 737.27, vat: 737.27 }, { rate: 20, total: 1240, vat: 206.67 }] }), NO_PREV);
  assert.equal(vat.status.okcT10, "failed");
  // MATRAH basılı ve grup toplamı yerine MATRAH okunmuş: MATRAH + KDV = toplam tutmaz
  const printed = okcChecks(fig({ groups: [{ rate: 10, total: 8110, vat: 737.27, base: 8110 }, { rate: 20, total: 1240, vat: 206.67, base: 1033.33 }] }), NO_PREV);
  assert.ok(printed.checks.some((c) => c.key === "k3b-10"));
});

test("tuzak: kart satırı toplam diye, banka alt satırı iki kez, adet tutar diye", () => {
  const cardAsTotal = okcChecks(fig({ total: 6900 }), NO_PREV);
  assert.equal(cardAsTotal.status.okcTotal, "failed");
  const twice = normalizeOkc(
    z({
      payments: [
        { label: "NAKİT", count: 9, amount: A(2450), kind: "cash" },
        { label: "K.KARTI", count: 31, amount: A(6900), kind: "card" },
        { label: "ÖRNEKBANK", count: null, amount: A(6900), kind: "card" },
      ],
    }),
    { day: DAY, prev: { z: null } },
  );
  assert.equal(twice.values.okcCard?.value, 13800);
  assert.equal(twice.values.okcCard?.status, "failed");
  assert.equal(twice.values.okcTotal?.status, "confirmed", "oranlar doğruladı");
  const count = okcChecks(fig({ card: 31 }), NO_PREV);
  assert.equal(count.status.okcCard, "failed");
  assert.equal(count.status.okcCash, "failed");
});

test("tuzak: virgül kaybı (×100), iptal ikinci kez düşülmüş, soluk 3/8", () => {
  for (const total of [935_000, 9265, 9850]) {
    const r = okcChecks(fig({ total }), { prev: { z: null }, recentTotals: [9000, 9500, 10000] });
    assert.equal(r.status.okcTotal, "failed", String(total));
  }
  const comma = okcChecks(fig({ total: 935_000 }), NO_PREV);
  assert.equal(comma.status.okcVatTotal, "failed", "K5: KDV oranı aralık dışında");
  assert.ok(comma.checks.some((c) => c.key === "k5" && c.text.includes("%9–%17 olmalı")));
});

test("tuzak: FİŞ NO / EKÜ NO Z no diye (önceki Z'den küçük), TOPLAM FİŞ ADEDİ yalnız sınırda", () => {
  const r = okcChecks(fig({ zNo: "0001" }), { prev: PREV });
  assert.equal(r.status.okcZNo, "failed");
  assert.ok(r.checks.some((c) => c.text === "Z no (0001) önceki yazarkasa Z'sinden (0100) küçük; eski bir Z raporu ya da FİŞ NO / EKÜ NO okunmuş olabilir."));
  assert.equal(r.reasons.okcZNo, "Z no (0001) önceki Z'den (0100) büyük olmalı.");
  assert.equal(okcChecks(fig({ receipts: 71 }), NO_PREV).status.okcReceipts, undefined);
  const k9 = okcChecks(fig({ receipts: 71_000 }), NO_PREV);
  assert.equal(k9.status.okcReceipts, "failed");
  assert.ok(k9.checks.some((c) => c.text === "Fiş sayısı alışılmadık (71.000); fişe bakın."));
});

test("tuzak: eski oran (%18) satırında tutar, alışılmadık oran", () => {
  const r = okcChecks(fig({ total: 9450, cash: 2550, groups: [{ rate: 10, total: 8110, vat: 737.27 }, { rate: 20, total: 1240, vat: 206.67 }, { rate: 18, total: 100, vat: 15.25 }], vatTotal: 959.19 }), NO_PREV);
  assert.ok(r.checks.some((c) => c.text === "Eski KDV oranı (%18) satırında tutar var; fişe bakın."));
  const odd = okcChecks(fig({ groups: [{ rate: 10, total: 8110, vat: 737.27 }, { rate: 7, total: 1240, vat: 81.12 }], vatTotal: 818.39 }), NO_PREV);
  assert.ok(odd.checks.some((c) => c.key === "k8-7"));
});

// ---------------------------------------------------------------- alan durumu ve doldurma

test("alan durumu: tutmadı > doğrulandı > denetlenemedi; tutmayan dolmaz, nedeniyle öneri olur", () => {
  // %10 toplam yanlış: K1 tutmaz (oranlar düşer), K4 toplamı doğrular
  const r = normalizeOkc(z({ kdvGroups: [{ rate: 10, total: A(8150), vat: A(737.27), base: null }, { rate: 20, total: A(1240), vat: A(206.67), base: null }] }), { day: DAY, prev: PREV });
  assert.equal(r.values.okcT10?.status, "failed");
  assert.equal(r.values.okcTotal?.status, "confirmed");
  const plan = prefillPlan(r, emptyForm(), ON);
  assert.ok(!plan.fill.some((f) => f.field === "okcT10"));
  const u = plan.unsure.find((x) => x.field === "okcT10");
  assert.equal(u?.text, "8150");
  assert.ok(u?.reason?.startsWith("Oranların toplamı günlük toplamı tutmuyor (40\u00a0₺ fark)") || u?.reason?.startsWith("Bu oranın KDV'si"), u?.reason);
  assert.ok(plan.fill.some((f) => f.field === "okcTotal" && f.warn === null));
  assert.equal(okcNeedsHalves(r), false);
  assert.equal(prefillSummary("kasa-okc", plan), `Banka POS Z raporundan dolduruldu: ${plan.fill.length} alan. Turuncu olanları fişle karşılaştırıp gönderin.`);
  // Düşük güvenli temel alan: üst / alt yarı önerisi
  assert.equal(okcNeedsHalves(normalizeOkc(z({ dailyTotal: A(9350, "low") }), { day: DAY, prev: PREV })), true);
});

test("kaydedilen rapor: yazarkasa alanları kendi anahtarlarıyla karşılaştırılır, ModPOS'unkilerle değil; tutmayan alan özürlü", () => {
  const r = normalizeOkc(z(), { day: DAY, prev: PREV });
  const base = { zTotal: 10_785.5, cash: 2450, card: 6900, mealCard: 0, online: 1000, other: 435.5, offRevenue: null, zNo: "0412", receipts: 52, bankPos: null };
  const same = savedFields({ ...base, okcZNo: "101", okcReceipts: 40, okcTotal: 9350, okcVatTotal: 943.94, okcCash: 2450, okcCard: 6900, okcVat: [{ rate: 10, total: 8110, vat: 737.27 }, { rate: 20, total: 1240, vat: 206.67 }] });
  assert.deepEqual(photoDiffs([r], same), []);
  const diff = photoDiffs([r], { ...same, okcTotal: 9300 });
  assert.deepEqual(diff.map((d) => [d.field, d.label]), [["okcTotal", "Günlük toplam"]]);
  // Yazarkasa bölümü boş eski rapor: yazarkasa anahtarı karşılaştırılmaz
  assert.ok(!("okcTotal" in savedFields(base)));
  const failedRead = normalizeOkc(z({ dailyTotal: A(1_259_350) }), { day: DAY, prev: PREV });
  const d = photoDiffs([failedRead], same).find((x) => x.field === "okcTotal");
  assert.equal(d?.excused, true);
});

test("kaydedilen rapor: Ayrıntılar boş bırakıldıysa (doldurma kapısı kapalı) fiş sayısı, KDV ve döküm farklı sayılmaz", () => {
  const r = normalizeOkc(z(), { day: DAY, prev: PREV });
  const base = { zTotal: 10_785.5, cash: 2450, card: 6900, mealCard: 0, online: 1000, other: 435.5, offRevenue: null, zNo: "0412", receipts: 52, bankPos: null };
  // Yalnız dört ana alan: alarm yok, fotoğraf kaldırılabilir kalır
  const four = savedFields({ ...base, okcZNo: "0101", okcTotal: 9350, okcCash: 2450, okcCard: 6900 });
  assert.deepEqual(Object.keys(four).filter((k) => k.startsWith("okc")), ["okcZNo", "okcTotal", "okcCash", "okcCard"]);
  assert.deepEqual(photoDiffs([r], four), []);
  // Yazılan ayrıntı hâlâ karşılaştırılır; yalnız yazılan oran
  const typed = savedFields({ ...base, okcZNo: "0101", okcTotal: 9350, okcCash: 2450, okcCard: 6900, okcReceipts: 41, okcVat: [{ rate: 10, total: 8110, vat: 737.27 }] });
  assert.deepEqual(photoDiffs([r], typed).map((x) => x.field), ["okcReceipts"]);
  assert.ok(!("okcT20" in typed) && "okcT10" in typed);
  // Zorunlu alan ve Z no boşsa yine farklı
  const noZ = savedFields({ ...base, okcZNo: null, okcTotal: 9350, okcCash: 2450, okcCard: 6900 });
  assert.deepEqual(photoDiffs([r], noZ).map((x) => [x.field, x.saved]), [["okcZNo", null]]);
});

// ---------------------------------------------------------------- Z no sürekliliği

test("Z no: +1 doğrular, +2 bilgi (önceki gün ise uyarı), aynı okumayı durdurur, küçük tutmadı, önceki yok", () => {
  assert.equal(okcChecks(fig(), { prev: { z: { date: "2026-10-23", zNo: "0100" } }, day: DAY }).status.okcZNo, "confirmed");
  const gap = okcChecks(fig({ zNo: "0102" }), { prev: { z: { date: "2026-10-20", zNo: "0100" } }, day: DAY });
  assert.equal(gap.status.okcZNo, undefined);
  const g = gap.checks.find((c) => c.key === "zno-gap");
  assert.equal(g?.level, "info");
  assert.equal(g?.text, "Önceki yazarkasa Z'si 0100 (20 Ekim); bu 0102. Arada 1 Z raporu girilmemiş.");
  assert.equal(g?.staff, "Önceki Z 0100; bu 0102. Arada bir Z raporu girilmemiş olabilir.");
  const twice = okcChecks(fig({ zNo: "0102" }), { prev: { z: { date: "2026-10-23", zNo: "0100" } }, day: DAY });
  const t = twice.checks.find((c) => c.key === "zno-gap");
  assert.equal(t?.level, "warn");
  assert.ok(t?.text.endsWith("Bir günde iki Z alınmış ya da Z no yanlış okunmuş olabilir."));

  const same = normalizeOkc(z({ zNo: { text: "0100", value: 100, confidence: "high" } }), { day: DAY, prev: PREV });
  const stop = "Bu Z no (0100) 23 Ekim raporunda da var; dünkü Z raporu olabilir.";
  assert.ok(same.checks.some((c) => c.whole && c.text === stop && !c.admin));
  assert.ok(Object.values(same.values).every((v) => v?.status === "failed"));
  assert.equal(prefillPlan(same, emptyForm(), ON).fill.length, 0);

  assert.equal(okcChecks(fig({ zNo: "0099" }), { prev: PREV }).status.okcZNo, "failed");
  assert.equal(okcChecks(fig(), NO_PREV).status.okcZNo, undefined);
});

// ---------------------------------------------------------------- kümülatifin saklanması

test("kümülatif: zincir tutuyor → saklanır; önceki yok → saklanır; tutmuyor → boş, ertesi gün son saklanana bağlanır", () => {
  const input = { savedZNo: "0101", savedTotal: 9350, readZNo: "0101", readTotal: 9350, readVatTotal: 943.94, cumTotal: 1_259_350, cumVat: 118_943.94, outside: null, prevCum: PREV.cum };
  assert.deepEqual(okcCumulativeToStore(input), { cumTotal: 1_259_350, cumVat: 118_943.94, outside: null, basis: "chain", rejected: null });
  assert.equal(okcCumulativeToStore({ ...input, prevCum: null }).basis, "first");
  assert.equal(okcCumulativeToStore({ ...input, prevCum: null, cumTotal: 9000 }).cumTotal, null, "günlük toplamdan küçük kümülatif yok sayılır");

  // Yanlış okunmuş kümülatif (3/5): saklanmaz
  const wrong = okcCumulativeToStore({ ...input, cumTotal: 1_259_530 });
  assert.equal(wrong.cumTotal, null);
  assert.equal(wrong.rejected, 1_259_530);
  // Ertesi gün doğru okunmuş: zincir hâlâ 0100'e bağlı (aralık 2), kümülatif büyümüş → saklanır, toplam "tutmadı" olmaz
  const next = { savedZNo: "0102", savedTotal: 9000, readZNo: "0102", readTotal: 9000, readVatTotal: 818.18, cumTotal: 1_268_350, cumVat: 119_762.12, outside: null, prevCum: PREV.cum };
  assert.equal(okcCumulativeToStore(next).basis, "gap");
  const day2 = okcChecks(fig({ zNo: "0102", total: 9000, vatTotal: 818.18, groups: [{ rate: 10, total: 9000, vat: 818.18 }], cash: 0, card: 9000, cumTotal: 1_268_350 }), { prev: { z: { date: DAY, zNo: "0101" }, cum: PREV.cum }, day: "2026-10-25" });
  assert.notEqual(day2.status.okcTotal, "failed");
  assert.ok(!day2.checks.some((c) => c.key === "k6"));
  // Aralıkta kümülatif günlük toplamdan az büyümüş: çürütür
  const shrink = okcChecks(fig({ zNo: "0102", cumTotal: 1_255_000 }), { prev: { z: null, cum: PREV.cum } });
  assert.ok(shrink.checks.some((c) => c.key === "k6"));

  // Elle düzeltilmiş rapor (okuma kaydedilenle aynı değil): üçü de boş
  assert.deepEqual(okcCumulativeToStore({ ...input, savedTotal: 9400, outside: 1250 }), { cumTotal: null, cumVat: null, outside: null, basis: null, rejected: null });
  assert.equal(okcCumulativeToStore({ ...input, outside: 1250 }).outside, 1250);
  assert.equal(okcCumulativeToStore({ ...input, outside: 0.5 }).outside, null);
});

// ---------------------------------------------------------------- tarih

test("tarih: gece 00:30 Z'si önceki güne; ertesi sabah yalnız istisna açıkken; başka gün bütünü şüpheli yapar", () => {
  const night = normalizeOkc(z({ date: "2026-10-25", time: "00:30" }), { day: DAY, prev: PREV });
  assert.equal(night.printedDay, DAY);
  assert.ok(!night.checks.some((c) => c.whole));

  const morning = z({ date: "2026-10-25", time: "09:12" });
  const on = normalizeOkc(morning, { day: DAY, prev: PREV, nextMorningZ: true });
  assert.ok(on.checks.some((c) => c.admin && c.text === "Z ertesi sabah alınmış (25 Ekim 09:12); bu güne yazıldı."));
  assert.ok(!on.checks.some((c) => c.whole));
  const off = normalizeOkc(morning, { day: DAY, prev: PREV });
  assert.ok(off.checks.some((c) => c.whole && c.text.startsWith("Fişteki tarih")));

  const other = normalizeOkc(z({ date: "2026-10-20" }), { day: DAY, prev: PREV });
  assert.ok(other.checks.some((c) => c.whole));
  const unsure = normalizeOkc(z({ date: "2026-10-20", dateConfidence: "low" }), { day: DAY, prev: PREV });
  assert.ok(!unsure.checks.some((c) => c.whole));
});

// ---------------------------------------------------------------- belge türleri

test("belge türü: X raporu, dönem raporu, ModPOS Z'si (BİLGİ FİŞİ dahil) ve başka belge alan doldurmaz", () => {
  const x = normalizeOkc(z({ documentType: "x_report" }), { day: DAY, prev: PREV });
  assert.equal(x.ok, false);
  assert.equal(x.error, "Bu bir X raporu (gün içi) gibi görünüyor; yazarkasadan Z raporunu alıp çekin.");
  assert.deepEqual(x.values, {});
  assert.equal(normalizeOkc(z({ documentType: "period_report" }), { day: DAY, prev: PREV }).error, "Bu bir mali hafıza / dönem raporu gibi görünüyor; günün Z raporunu çekin.");
  const sw = normalizeOkc(z({ documentType: "software_z", title: "BİLGİ FİŞİ" }), { day: DAY, prev: PREV });
  assert.equal(sw.error, "Bu ModPOS'un Z raporu gibi görünüyor.");
  assert.equal(sw.switchTo, "kasa-z");
  assert.equal(normalizeOkc(z({ documentType: "other" }), { day: DAY, prev: PREV }).error, "Bu başka bir belge gibi görünüyor. Yazarkasanın Z raporunun fotoğrafını çekin.");
  assert.equal(normalizeOkc(z({ readable: false }), { day: DAY, prev: PREV }).ok, false);
});

test("banka gün sonu: yalnız fişse yalnız Banka gün sonu; Z ile aynı şeritte iki fiş toplanır", () => {
  const slip = (net: number, bank: string) => ({ bank, batchNo: "112", date: DAY, salesTotal: A(net), refundTotal: NONE, netTotal: A(net), transactionCount: 10 });
  const only = normalizeOkc(z({ documentType: "batch_slip", batches: [slip(6900, "ÖRNEKBANK")] }), { day: DAY, prev: PREV });
  assert.equal(only.ok, true);
  assert.deepEqual(Object.keys(only.values), ["bankPos"]);
  assert.equal(only.values.bankPos?.value, 6900);
  assert.ok(only.checks.some((c) => c.text === "Bu banka gün sonu fişi; yalnız Banka gün sonu okundu. Yazarkasanın Z raporunu da çekin."));
  assert.equal(prefillSummary("kasa-okc", prefillPlan(only, emptyForm(), ON)), "Banka gün sonu fişinden dolduruldu: Banka gün sonu.");
  // Doldurma kapısı kapalı (bugün): alan dolmaz, metin "dolduruldu" ya da "Z raporu" demez
  const offPlan = prefillPlan(only, emptyForm());
  assert.deepEqual([offPlan.fill, offPlan.unsure.map((u) => u.field)], [[], ["bankPos"]]);
  assert.equal(prefillSummary("kasa-okc", offPlan), "Banka gün sonu fişi okundu; turuncu alanı fişle karşılaştırıp yazın.");
  assert.equal(prefillSummary("kasa-okc", prefillPlan(only, { ...emptyForm(), bankPos: "6800" })), "Banka gün sonu fişi okundu; Banka gün sonu yazdığınızdan farklı.");

  const both = normalizeOkc(z({ batches: [slip(4000, "GARANTİ"), slip(2900, "YAPI KREDİ")] }), { day: DAY, prev: PREV });
  assert.equal(both.values.bankPos?.value, 6900);
  assert.equal(both.values.okcTotal?.status, "confirmed");
  assert.ok(both.checks.some((c) => c.text === "2 banka gün sonu toplandı: 6.900\u00a0₺."));
  const one = normalizeOkc(z({ batches: [slip(6900, "ÖRNEKBANK")] }), { day: DAY, prev: PREV });
  assert.ok(toStaffReading(one).checks.some((c) => c.text === "Aynı fişte banka gün sonu da var: Banka gün sonu 6.900\u00a0₺."));
});

test("kesik fişin metni bu türde: kalan kısmını ayrıca çekin", () => {
  const r = normalizeOkc(z({ issues: ["cut_off"] }), { day: DAY, prev: PREV });
  assert.ok(r.checks.some((c) => c.text === OKC_CUT_OFF_TEXT));
});

// ---------------------------------------------------------------- formun canlı denetimi

const form = (o: Partial<OkcFormValues> = {}): OkcFormValues => ({
  okcZNo: "0101",
  okcReceipts: 40,
  okcTotal: 9350,
  okcVatTotal: 943.94,
  okcCash: 2450,
  okcCard: 6900,
  okcMealCard: null,
  okcOther: null,
  okcVat: [
    { rate: 10, total: 8110, vat: 737.27 },
    { rate: 20, total: 1240, vat: 206.67 },
  ],
  ...o,
});

test("okcFormChecks: elle yazılanda aynı denetimler, alan başına tek sade neden ve tek özet; jargon yok", () => {
  assert.deepEqual(okcFormChecks(form(), { prevZ: { date: "2026-10-23", zNo: "0100" } }), { fields: {}, summary: null, admin: [] });
  const r = okcFormChecks(form({ okcCard: 6780 }), { prevZ: null });
  assert.deepEqual(Object.keys(r.fields).sort(), ["okcCard", "okcCash"]);
  assert.equal(r.fields.okcCash, "Nakit, kart ve öteki ödemeler toplanınca günlük toplam çıkmıyor (120\u00a0₺ az).");
  assert.equal(r.summary, "2 rakam birbirini tutmuyor; turuncu olanları fişle karşılaştırın.");
  assert.ok(r.admin[0].startsWith("Ödemelerin toplamı (9.230\u00a0₺) günlük toplamı (9.350\u00a0₺) tutmuyor"));

  const cases: OkcFormValues[] = [
    form({ okcCard: 6780 }),
    form({ okcVat: [{ rate: 10, total: 8110, vat: 773.27 }, { rate: 20, total: 1240, vat: 206.67 }], okcVatTotal: 979.94 }),
    form({ okcVat: [{ rate: 10, total: 8050, vat: 731.82 }, { rate: 20, total: 1240, vat: 206.67 }] }),
    form({ okcVatTotal: 1963.94, okcVat: null }),
    form({ okcZNo: "0099" }),
    form({ okcTotal: 1_259_350, okcVat: null, okcVatTotal: null }),
  ];
  for (const v of cases) {
    const c = okcFormChecks(v, { prevZ: { date: "2026-10-23", zNo: "0100" }, recentTotals: [9000, 9500, 10000] });
    assert.ok(Object.keys(c.fields).length > 0, JSON.stringify(v));
    for (const t of [...Object.values(c.fields), c.summary ?? ""]) assert.doesNotMatch(t!, JARGON);
  }
  const z0 = okcFormChecks(form({ okcZNo: "0099" }), { prevZ: { date: "2026-10-23", zNo: "0100" } });
  assert.equal(z0.fields.okcZNo, "Z no (0099) önceki Z'den (0100) büyük olmalı.");
  assert.equal(z0.summary, "1 rakam fişteki ötekileri tutmuyor; turuncu olanı fişle karşılaştırın.");
  const vat = okcFormChecks(cases[1], { prevZ: null });
  assert.equal(vat.fields.okcV10, "Bu oranın KDV'si toplamına göre 773,27\u00a0₺ değil, 737,27\u00a0₺ civarında olmalı.");
});

test("okcFormChecks: parçalı okuma (üst parça KDV dökümü, alt parça ödemeler) formda birlikte tutar", () => {
  const top = { okcTotal: 9350, okcVatTotal: 943.94, okcVat: form().okcVat, okcZNo: "0101", okcReceipts: 40 };
  const bottom = { okcCash: 2450, okcCard: 6900 };
  assert.equal(okcFormChecks({ ...form(), ...top, ...bottom, okcMealCard: null, okcOther: null }, { prevZ: null }).summary, null);
  // Yalnız üst parça: ödemeler yok, kimlik çalışmaz, tutmayan yok
  assert.equal(okcFormChecks(form({ okcCash: null, okcCard: null }), { prevZ: null }).summary, null);
});

// ---------------------------------------------------------------- mutabakat

const report = (o: Partial<OkcReportFields> = {}): OkcReportFields => ({
  zTotal: 10_785.5,
  cash: 2450,
  card: 6900,
  mealCard: 0,
  online: 1000,
  other: 435.5,
  bankPos: null,
  okcZNo: "0101",
  okcTotal: 9350,
  okcVatTotal: 943.94,
  okcVat: form().okcVat,
  okcCash: 2450,
  okcCard: 6900,
  okcMealCard: null,
  okcOther: null,
  ...o,
});

test("okcReconcile: tolerans sınırı, online + diğer açıklaması, banka satırı, eski rapor, personelin satırları", () => {
  assert.equal(okcReconcile(report({ okcCard: 6900.99 }), "admin").find((l) => l.key === "okc-card")?.tone, "good");
  const over = okcReconcile(report({ okcCard: 6901 }), "admin").find((l) => l.key === "okc-card");
  assert.equal(over?.tone, "warn");
  assert.equal(over?.text, "Yazarkasa kartı, ModPOS'taki karttan 1\u00a0₺ fazla. Kartla alınan bir ödeme ModPOS'ta başka ödeme türüyle girilmiş olabilir.");
  const admin = okcReconcile(report({ bankPos: 6940 }), "admin");
  assert.equal(admin.find((l) => l.key === "okc-total")?.text, "ModPOS toplamı 1.435,50\u00a0₺ fazla; online ve diğer satışlar kadar (yazarkasadan geçmez).");
  assert.equal(admin.find((l) => l.key === "okc-cash")?.text, "Nakit: yazarkasa ile ModPOS aynı.");
  assert.equal(admin.find((l) => l.key === "okc-bank")?.text, "Banka gün sonu, yazarkasa kartından 40\u00a0₺ fazla (bir gün gün sonu alınmadıysa iki günü kapsar).");
  assert.equal(okcReconcile(report({ zTotal: 11_450 }), "admin").find((l) => l.key === "okc-total")?.text, "ModPOS toplamı yazarkasadan 2.100\u00a0₺ fazla.");
  assert.equal(okcReconcile(report({ okcMealCard: 450, mealCard: 500 }), "admin").find((l) => l.key === "okc-meal")?.text, "Yazarkasa yemek kartı, ModPOS'takinden 50\u00a0₺ az.");

  // Personel yalnız Kart ve Kendi içinde
  const staff = okcReconcile(report({ bankPos: 6940, okcCard: 6780, zTotal: 11_450 }), "staff");
  assert.ok(staff.length > 0);
  assert.ok(staff.every((l) => l.key === "okc-card" || l.key === "okc-self"), JSON.stringify(staff));
  const self = staff.find((l) => l.key === "okc-self");
  assert.equal(self?.text, "2 rakam birbirini tutmuyor; turuncu olanları fişle karşılaştırın.");
  assert.ok(okcReconcile(report({ okcCard: 6780 }), "admin").find((l) => l.key === "okc-self")?.text.startsWith("Yazarkasa Z'si kendi içinde tutmuyor: Ödemelerin toplamı (9.230\u00a0₺)"));

  // Eski rapor (yazarkasa yok, Banka POS dolu): bugünkü metin
  const old = okcReconcile({ zTotal: 10_000, cash: 3000, card: 6900, mealCard: 0, online: 0, other: 100, bankPos: 7020 }, "staff");
  assert.deepEqual(old, [{ key: "okc-card", tone: "warn", text: "Banka POS, ModPOS'taki karttan 120\u00a0₺ fazla.", diff: 120 }]);
  // Yazarkasa kartı yok ama yazarkasa toplamı var: banka gün sonu
  assert.equal(okcReconcile(report({ okcCard: null, bankPos: 6900 }), "staff")[0].text, "Kart: banka gün sonu ile ModPOS aynı.");
});

// ---------------------------------------------------------------- sameVat

test("sameVat: aynı döküm farklı sırada eşit, bir oranın KDV'si farklı farklı, boş ile [] eşit, sıfır grup atılır", () => {
  const a = [
    { rate: 10, total: 8110, vat: 737.27 },
    { rate: 20, total: 1240, vat: 206.67 },
  ];
  assert.equal(sameVat(a, [...a].reverse()), true);
  assert.equal(sameVat(a, [{ rate: 10, total: 8110, vat: 737.72 }, a[1]]), false);
  assert.equal(sameVat(null, []), true);
  assert.equal(sameVat(undefined, [{ rate: 18, total: 0, vat: 0 }]), true);
  assert.equal(sameVat(a, [...a, { rate: 8, total: 0, vat: 0 }]), true);
  assert.equal(sameVat([{ rate: 10, total: 8110.001, vat: 737.27 }], [{ rate: 10, total: 8110, vat: 737.27 }]), true);
});

// ---------------------------------------------------------------- okcMonth

const v10 = (t: number) => [{ rate: 10, total: t, vat: Math.round(((t * 10) / 110) * 100) / 100 }];

test("okcMonth: kapsam, eksik günler, oran toplamları; tam ay complete", () => {
  const rows: OkcRow[] = [
    { date: "2026-10-01", zTotal: 10_000, okcTotal: 9000, okcVatTotal: 818.18, okcVat: v10(9000) },
    { date: "2026-10-02", zTotal: 11_000, okcTotal: 10_000, okcVatTotal: 909.09, okcVat: v10(10_000) },
    { date: "2026-10-03", zTotal: 6000, okcTotal: 5000, okcVatTotal: 454.55, okcVat: v10(5000) },
    { date: "2026-11-01", zTotal: 6000, okcTotal: 5000, okcVatTotal: 454.55, okcVat: v10(5000) },
  ];
  const m = okcMonth(rows, "2026-10");
  assert.equal(m.reportDays, 3);
  assert.equal(m.days, 3);
  assert.deepEqual(m.missing, []);
  assert.equal(m.total, 24_000);
  assert.deepEqual(m.byRate, [{ rate: 10, total: 24_000, vat: 2181.82, base: 21_818.18 }]);
  assert.equal(m.byRateEstimated, null);
  assert.equal(m.complete, true);

  const gap = okcMonth([...rows.slice(0, 2), { date: "2026-10-03", zTotal: 6000 }], "2026-10");
  assert.deepEqual(gap.missing, ["2026-10-03"]);
  assert.equal(gap.complete, false);
});

test("okcMonth: KDV dökümü olmayan günü olan ay complete değil; tahmin ayrı durur", () => {
  const rows: OkcRow[] = [
    { date: "2026-10-01", zTotal: 10_000, okcTotal: 9000, okcVatTotal: 818.18, okcVat: v10(9000) },
    { date: "2026-10-02", zTotal: 11_000, okcTotal: 10_000, okcVatTotal: 909.09, okcVat: v10(10_000) },
    { date: "2026-10-03", zTotal: 6000, okcTotal: 5000, okcVatTotal: 454.55, okcVat: null },
  ];
  const m = okcMonth(rows, "2026-10");
  assert.equal(m.total, 24_000);
  assert.equal(m.vatDays, 2);
  assert.deepEqual(m.vatMissing, ["2026-10-03"]);
  assert.equal(m.complete, false);
  assert.deepEqual(m.byRate, [{ rate: 10, total: 19_000, vat: 1727.27, base: 17_272.73 }], "tahmin byRate'e karışmaz");
  assert.deepEqual(m.byRateEstimated, [{ rate: 10, total: 5000, vat: 454.54, base: 4545.46 }]);
});

test("okcMonth: zincir; ModPOS'ta satışı olan ama yazarkasası girilmemiş gün zincirle kapsanırsa ay tam", () => {
  const rows: OkcRow[] = [
    { date: "2026-09-30", zTotal: 8000, okcZNo: "0089", okcTotal: 7000, okcVatTotal: 636.36, okcVat: v10(7000), okcCumTotal: 1_000_000, okcCumVat: 90_000 },
    { date: "2026-10-01", zTotal: 10_000, okcZNo: "0090", okcTotal: 9000, okcVatTotal: 818.18, okcVat: v10(9000) },
    { date: "2026-10-02", zTotal: 300 },
    { date: "2026-10-03", zTotal: 16_000, okcZNo: "0091", okcTotal: 15_000, okcVatTotal: 1363.64, okcVat: v10(15_000), okcCumTotal: 1_024_000, okcCumVat: 92_181.82 },
  ];
  const m = okcMonth(rows, "2026-10");
  assert.deepEqual(m.chain, { total: 24_000, vat: 2181.82, fromZ: "0089", toZ: "0091" });
  assert.deepEqual(m.missing, ["2026-10-02"]);
  assert.equal(m.complete, true);
  // Zincir toplamı tutmuyorsa (eksik gün satış içeriyor) tam değil
  const short = okcMonth(rows.map((r) => (r.date === "2026-10-03" ? { ...r, okcCumTotal: 1_024_300 } : r)), "2026-10");
  assert.equal(short.complete, false);
});

// ---------------------------------------------------------------- doldurma (eski okumalar aynen)

test("prefillPlan: durumu olmayan eski okumalar bugünkü kuralla dolar", () => {
  const legacy: CashReading = {
    kind: "kasa-z",
    ok: true,
    error: null,
    switchTo: null,
    printedDay: DAY,
    values: { zTotal: { value: 100, confidence: "medium" }, cash: { value: 40, confidence: "low" } },
    missing: [],
    checks: [],
  };
  const plan = prefillPlan(legacy, { zTotal: "", cash: "" });
  assert.deepEqual(plan.fill, [{ field: "zTotal", text: "100", warn: UNSURE_TEXT }]);
  assert.deepEqual(plan.unsure, [{ field: "cash", photo: 40, text: "40" }]);
});

// ---------------------------------------------------------------- b4: zorunluluk, okumanın birleşik rakamları, geç raporun iki yanı

test("okcFormError (§3.2, form ve sunucu aynı metin): boş bölüm serbest; tutar yazılınca toplam, nakit, kart; oran satırı birlikte", () => {
  assert.equal(okcFormError({}), null);
  assert.equal(okcFormError({ okcTotal: null, okcCash: null, okcVat: [] }), null);
  assert.equal(okcFormError({ okcCard: 6900 }), "Yazarkasa günlük toplamı gerekli (bölümü boş da bırakabilirsiniz)");
  assert.equal(okcFormError({ okcTotal: 9350, okcCard: 6900 }), "Nakit gerekli (yoksa 0 yazın)");
  assert.equal(okcFormError({ okcTotal: 9350, okcCash: 0 }), "Kredi kartı gerekli (yoksa 0 yazın)");
  assert.equal(okcFormError({ okcTotal: 9350, okcCash: 2450, okcCard: 6900 }), null);
  // Yalnız döküm yazılmış: tutar sayılır, temel alanlar istenir
  assert.equal(okcFormError({ okcVat: [{ rate: 10, total: 8110, vat: 737.27 }] }), "Yazarkasa günlük toplamı gerekli (bölümü boş da bırakabilirsiniz)");
  assert.equal(okcFormError({ okcTotal: 9350, okcCash: 2450, okcCard: 6900, okcVat: [{ rate: 10, total: 8110, vat: null }] }), "%10 için toplam ve KDV birlikte yazılır");
  assert.equal(okcFormError({ okcTotal: 9350, okcCash: 2450, okcCard: 6900, okcVat: [{ rate: 10, total: 700, vat: 737.27 }] }), "%10 KDV'si toplamından büyük olamaz");
  assert.equal(okcHasFigures({}), false);
  assert.equal(okcHasFigures({ okcTotal: null, okcCard: 0 }), true);
});

test("okcReadFigures: parçalı okumada her rakam onu okuyan son okumadan; kümülatif çifti aynı okumadan; Z değilse null", () => {
  const top = normalizeOkc(z({ cumulativeTotal: NONE, cumulativeVat: NONE, payments: [] }), { day: DAY, prev: { z: null } });
  const bottom = normalizeOkc(z({ zNo: { text: null, value: null, confidence: "low" }, dailyTotal: NONE, kdvGroups: [], totalVat: NONE }), { day: DAY, prev: { z: null } });
  const f = okcReadFigures([top, bottom]);
  assert.deepEqual(f, { zNo: "0101", total: 9350, vatTotal: 943.94, cumTotal: 1_259_350, cumVat: 118_943.94, outside: null });
  // Yazarkasa dışı tahsilat okunduysa
  const withOutside = normalizeOkc(z({ outside: [{ label: "FATURALI SATIŞ", amount: A(1250) }] }), { day: DAY, prev: { z: null } });
  assert.equal(okcReadFigures([withOutside])?.outside, 1250);
  // Yanlış belge, yalnız banka fişi ya da personelin okuması (kümülatifsiz): rakam yok
  assert.equal(okcReadFigures([normalizeOkc(z({ documentType: "x_report" }), { day: DAY, prev: { z: null } })]), null);
  assert.equal(okcReadFigures([toStaffReading(top)]), null);
  assert.equal(okcReadFigures([]), null);
});

test("okcLateChain: Z no iki yanda, kümülatif iki yanda tutuyor ya da tutmayan halka; kendi kümülatifi yoksa iki komşu arası", () => {
  /** Tarih ve tutar biçimindeki bölünmez boşluklar düz boşluğa */
  const sp = (t: string) => t.replace(/\u00a0/g, " ");
  const prev = { z: { date: "2026-10-21", zNo: "0187" }, cum: { date: "2026-10-21", zNo: "0187", cumTotal: 1_000_000 } };
  const next = { date: "2026-10-23", zNo: "0189", total: 9_180, cumTotal: 1_021_480 };
  // Geç gün 22 Ekim: Z 0188, toplam 12.300, kümülatif 1.012.300
  const held = okcLateChain({ zNo: "0188", total: 12_300, cumTotal: 1_012_300 }, prev, next)!;
  assert.equal(held.ok, true);
  assert.equal(sp(held.text), "Banka POS Z no 0188: önceki 0187 (21 Ekim) ✓ · sonraki 0189 (23 Ekim) ✓ · kümülatif iki yanda da tutuyor");
  // Sonraki halka tutmuyor: o günün kümülatif artışı ile toplamı yazılır
  const broken = okcLateChain({ zNo: "0188", total: 12_300, cumTotal: 1_012_360 }, prev, next)!;
  assert.equal(broken.ok, false);
  assert.match(sp(broken.text), /önceki Z'den bu yana kümülatif artışı 12\.360 ₺, bu günün toplamı 12\.300 ₺/);
  assert.match(sp(broken.text), /sonraki günün kümülatif artışı 9\.120 ₺, o günün toplamı 9\.180 ₺/);
  // Kendi kümülatifi okunmamış: önceki ve sonraki saklanan kümülatifin farkı iki günün toplamı
  assert.equal(sp(okcLateChain({ zNo: "0188", total: 12_300 }, prev, next)!.text).endsWith("kümülatif iki yanda da tutuyor"), true);
  assert.equal(okcLateChain({ zNo: "0188", total: 12_000 }, prev, next)!.ok, false);
  // Z no sırası bozuk: önceki büyük ya da eşit, sonraki küçük ya da eşit
  const bad = okcLateChain({ zNo: "0187", total: 12_300 }, { z: prev.z, cum: null }, { date: "2026-10-23", zNo: "0186" })!;
  assert.equal(bad.ok, false);
  assert.match(sp(bad.text), /önceki 0187 \(21 Ekim\) bu Z no'dan büyük ya da eşit · sonraki 0186 \(23 Ekim\) bu Z no'dan küçük ya da eşit/);
  // Aralık (girilmemiş Z'ler): bilgi, yargı yok; komşu yoksa yalnız Z no; yazarkasa Z no'su yoksa satır yok
  const gap = okcLateChain({ zNo: "0190", total: 12_300 }, { z: prev.z, cum: null }, null)!;
  assert.equal(gap.ok, null);
  assert.equal(sp(gap.text), "Banka POS Z no 0190: önceki 0187 (21 Ekim); arada 2 Z girilmemiş");
  assert.deepEqual(okcLateChain({ zNo: "0188", total: 1 }, { z: null }, null), { ok: null, text: "Banka POS Z no 0188" });
  assert.equal(okcLateChain({ zNo: null, total: null }, prev, next), null);
});

// ---------------------------------------------------------------- Form (yazarkasa kartı, src/app/panel/kasa/okc-form.ts)

test("form: boş bölüm gönderimde boş; kayıtlı değerler metne ve geri aynı", async () => {
  const { okcFieldsOf, okcValuesOf } = await import("../src/app/panel/kasa/okc-form");
  const empty = okcFieldsOf(okcValuesOf(null));
  assert.deepEqual(empty.errors, {});
  assert.deepEqual(empty.fields, { okcZNo: null, okcReceipts: null, okcTotal: null, okcVatTotal: null, okcVat: null, okcCash: null, okcCard: null, okcMealCard: null, okcOther: null });
  const saved = { okcZNo: "0188", okcReceipts: 134, okcTotal: 12300, okcVatTotal: 1212.12, okcVat: [{ rate: 10, total: 11060, vat: 1005.45 }, { rate: 20, total: 1240, vat: 206.67 }], okcCash: 3180, okcCard: 8480, okcMealCard: 640, okcOther: null };
  const v = okcValuesOf(saved);
  assert.equal(v.okcT10, "11060");
  assert.equal(v.okcV10, "1005,45");
  assert.equal(v.okcT1, "");
  assert.deepEqual(okcFieldsOf(v).fields, saved);
});

test("form: zorunluluk kuralı sunucuyla aynı metinle ve doğru alanda", async () => {
  const { okcFieldsOf, okcValuesOf } = await import("../src/app/panel/kasa/okc-form");
  const base = okcValuesOf(null);
  assert.deepEqual(okcFieldsOf({ ...base, okcCash: "100" }).errors, { okcTotal: "Yazarkasa günlük toplamı gerekli (bölümü boş da bırakabilirsiniz)" });
  assert.deepEqual(okcFieldsOf({ ...base, okcTotal: "100" }).errors, { okcCash: "Nakit gerekli (yoksa 0 yazın)" });
  assert.deepEqual(okcFieldsOf({ ...base, okcTotal: "100", okcCash: "0" }).errors, { okcCard: "Kredi kartı gerekli (yoksa 0 yazın)" });
  assert.deepEqual(okcFieldsOf({ ...base, okcTotal: "100", okcCash: "0", okcCard: "100", okcT10: "100" }).errors, { okcV10: "%10 için toplam ve KDV birlikte yazılır" });
  assert.deepEqual(okcFieldsOf({ ...base, okcTotal: "100", okcCash: "0", okcCard: "100", okcV20: "5" }).errors, { okcT20: "%20 için toplam ve KDV birlikte yazılır" });
  assert.deepEqual(okcFieldsOf({ ...base, okcTotal: "100", okcCash: "0", okcCard: "100", okcT10: "10", okcV10: "20" }).errors, { okcV10: "%10 KDV'si toplamından büyük olamaz" });
  assert.deepEqual(okcFieldsOf({ ...base, okcCard: "1,2,3" }).errors, { okcCard: "Geçerli bir tutar yazın (ör. 1.250,50)" });
  // Döküm yalnız toplamı ve KDV'si yazılan oranlarla, sıfır gruplar atılır
  const ok = okcFieldsOf({ ...base, okcTotal: "1.100", okcCash: "0", okcCard: "1100", okcT10: "1.100", okcV10: "100", okcT20: "0", okcV20: "0" });
  assert.deepEqual(ok.fields?.okcVat, [{ rate: 10, total: 1100, vat: 100 }]);
});
