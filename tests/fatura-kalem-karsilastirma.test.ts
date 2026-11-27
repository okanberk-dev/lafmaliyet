// Kalem kalem sayma ve faturanın şubesi geçmiş ayların rakamlarını nasıl değiştirir (docs/PARASUT.md › 5f): eski kural
// (fatura bütün, kategorisine göre; şube seçiliyken şubesi boş fatura işletme geneli) ile yeni kural aynı veride
// karşılaştırılır, değişen her rakam BİLİNÇLİ olarak burada kilitlidir. Eski kural src/lib/invoice-split-compare.ts
// (main'in motoruyla birebir aynı sonucu verdiği 25 Kasım 2026'da denendi; betik: scripts/fatura-kalem-karsilastir.ts).
//
// Veri: başlangıç verisi (Excel tohumu) + örnek Paraşüt faturaları (betiğin --ornek verisiyle aynı):
// 1. Avansas · Diğer · 1.000 − 100 iskonto · Marina: çay (bağlı) 400, çöp torbası (Sarf) 350, A4 kâğıt (nedensiz) 250
// 2. Metro · Hammadde & İçecek · 12.000 · Tuzla: süt (bağlı) 1.500, tüplü ısıtıcı (Demirbaş) 10.000, deterjan (Sarf) 500
// 3. Temizlik Dünyası (kural: hep Sarf) · Temizlik & Sarf · 800 · işletme geneli: çamaşır suyu 300, soda (bağlı) 500
// 4. Avansas · Hammadde & İçecek · 600 · seçilmemiş: çay (bağlı) 600 → değişmez
// 5. Migros · Hizmet · 300 · seçilmemiş, "kategorisi doğru, kalsın" denmiş: süt (bağlı) 200, kargo 100
// 6. Temizlik Dünyası · Temizlik & Sarf · 400 · Marina: çamaşır suyu 400
// Çalıştırma: npx tsx --test tests/fatura-kalem-karsilastirma.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { impactData, impactModel } from "../src/app/panel/ayarlar/impact";
import { invoiceBreakdowns } from "../src/app/panel/faturalar/breakdowns";
import type { InvoiceRow } from "../src/app/panel/faturalar/rules";
import { supplierMatchKey } from "../src/app/panel/faturalar/rules";
import { createModel, monthOfDate } from "../src/lib/calc/engine";
import type { Dataset, ExpenseCategory, Invoice } from "../src/lib/calc/types";
import { INVOICE_CATEGORIES } from "../src/lib/constants";
import { invoiceInScope } from "../src/lib/invoice-branch";
import { stockOnlyCategory } from "../src/lib/invoice-linking";
import { lineTarget, splitLinesFor, SUPPLIES_CATEGORY } from "../src/lib/invoice-split";
import { monthNumbers, numberChanges, oldRuleDataset } from "../src/lib/invoice-split-compare";
import { notIngredientOf, type IgnoredProduct, type IgnoredSupplier } from "../src/lib/product-ignore";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const excel = datasetFromSeed(data);
const sarf: ExpenseCategory = { id: 90, name: "Temizlik & sarf malzemesi", section: "genel", panelGroup: "diger", invoiceCategory: SUPPLIES_CATEGORY, monthly: false, active: true, sortOrder: 90 };

// ---------------------------------------------------------------- Örnek veri (yükleyicinin kuralıyla kalemler)
const linked = new Set(["cay", "sut", "soda"]);
const at = "2026-11-25T00:00:00Z";
const products = new Map<string, IgnoredProduct>([
  ["krp", { productKey: "krp", productName: "KRP END KONTY ÇÖP TORBASI", at, reason: "sarf" }],
  ["isitici", { productKey: "isitici", productName: "TÜPLÜ ISITICI", at, reason: "demirbas" }],
  ["deterjan", { productKey: "deterjan", productName: "BULAŞIK DETERJANI", at, reason: "sarf" }],
]);
const suppliers = new Map<string, IgnoredSupplier>([[supplierMatchKey("Temizlik Dünyası"), { supplierKey: supplierMatchKey("Temizlik Dünyası"), supplierName: "Temizlik Dünyası", reason: "sarf", at }]]);

/** src/server/data/invoice-split.ts loadSplitLines'ın kuralı: bağlı → mal; nedenli hammadde değil → nedeninin yeri */
function bill(id: number, date: string, supplier: string, category: string, amount: number, discount: number, branch: string | null, lines: [string, number][]): Invoice {
  const targets = lines.map(([key, net]) => {
    const isLinked = linked.has(key);
    const not = isLinked ? null : notIngredientOf({ productKey: key, supplierKey: supplierMatchKey(supplier) }, products, suppliers);
    return { net, to: lineTarget({ linked: isLinked, reason: not?.reason ?? null }) };
  });
  const split = splitLinesFor(category, targets);
  const net = amount - discount;
  return {
    id,
    date,
    supplier,
    description: null,
    invoiceNo: null,
    category,
    amount,
    discount,
    payable: net * 1.2,
    vat: net * 0.2,
    unpaid: false,
    note: null,
    branchId: branch && branch !== "isletme" ? branch : null,
    companyWide: branch === "isletme",
    ...(split ? { lines: split } : {}),
  } as Invoice;
}

const sample: Invoice[] = [
  bill(900_001, "2026-09-12", "Avansas", "Diğer", 1_000, 100, "marina", [["cay", 400], ["krp", 350], ["a4", 250]]),
  bill(900_002, "2026-09-20", "Metro", "Hammadde & İçecek", 12_000, 0, "tuzla", [["sut", 1_500], ["isitici", 10_000], ["deterjan", 500]]),
  bill(900_003, "2026-10-08", "Temizlik Dünyası", SUPPLIES_CATEGORY, 800, 0, "isletme", [["camasir", 300], ["soda", 500]]),
  bill(900_004, "2026-10-15", "Avansas", "Hammadde & İçecek", 600, 0, null, [["cay", 600]]),
  bill(900_005, "2026-08-22", "Migros", "Hizmet", 300, 0, null, [["sut", 200], ["kargo", 100]]),
  bill(900_006, "2026-10-20", "Temizlik Dünyası", SUPPLIES_CATEGORY, 400, 0, "marina", [["camasir", 400]]),
];
// Excel tohumunun faturaları şubesi seçilmemiş (geçişten sonraki hâl)
const all: Invoice[] = [...excel.invoices.map((i) => ({ ...i, branchId: null, companyWide: false })), ...sample];
const whole: Dataset = { ...excel, invoices: all, expenseCategories: [sarf] };
const MONTHS = ["2026-07", "2026-08", "2026-09", "2026-10"];

/** Ay → anahtar → fark (yalnız değişenler) */
function deltas(before: ReturnType<typeof createModel>, after: ReturnType<typeof createModel>, scope = "hepsi") {
  const labels = new Map<string, string>();
  const out: Record<string, Record<string, number>> = {};
  for (const m of MONTHS) {
    const ch = numberChanges(scope, m, monthNumbers(before, m, labels), monthNumbers(after, m, labels), labels);
    if (ch.length) out[m] = Object.fromEntries(ch.map((c) => [c.key, c.delta]));
  }
  return out;
}

test("yükleyicinin kuralı: hangi faturaya kalem listesi eklenir (yalnız payı ayrılanlar)", () => {
  const lines = Object.fromEntries(sample.map((i) => [i.id, i.lines ?? null]));
  assert.deepEqual(lines[900_001], [{ net: 400, to: "__mal" }, { net: 350, to: SUPPLIES_CATEGORY }, { net: 250, to: null }]);
  assert.deepEqual(lines[900_002], [{ net: 1_500, to: "__mal" }, { net: 10_000, to: "Kuruluş & Demirbaş" }, { net: 500, to: SUPPLIES_CATEGORY }]);
  // Kural açık tedarikçinin bağlı kalemi kuraldan etkilenmez: soda mal alışı
  assert.deepEqual(lines[900_003], [{ net: 300, to: SUPPLIES_CATEGORY }, { net: 500, to: "__mal" }]);
  assert.equal(lines[900_004], null, "bütün kalemleri bağlı mal faturası bölünmez");
  assert.deepEqual(lines[900_005], [{ net: 200, to: "__mal" }, { net: 100, to: null }]);
  assert.equal(lines[900_006], null, "bütün kalemi kendi kategorisinde: bölünmez");
});

test("Tümü · Gelir-gider: değişen her rakam (bilinçli); kalemsiz aylar aynı", () => {
  const before = createModel(oldRuleDataset(whole, { all, scope: "hepsi" }));
  const after = createModel(whole);
  assert.deepEqual(deltas(before, after), {
    // Migros (Hizmet; "kalsın" denmişti): stoğa giren süt artık mal alışı. Hizmet harcamaya bağlı değil: gider +200
    "2026-08": { alinan: 200, giderler: 200, kar: -200, "mal-alisi": 200, "mal-maliyeti": 200, "purchase:Migros": 200 },
    // Avansas (Diğer, Marina): çay 360 mal, çöp torbası 315 sarf (iskonto oranla); kâğıt 225 Diğer'de kalır (bağlı değil).
    // Metro (Tuzla): ısıtıcı 10.000 mal alışından çıkar (Kuruluş & Demirbaş harcamaya bağlı değil), deterjan 500 sarf.
    // Sarf payları şubelerine yazılır (Tümü'nün şube kırılımı)
    "2026-09": {
      alinan: -10_140,
      "bolum:genel": 815,
      "expense:90": 815,
      giderler: -9_325,
      kar: 9_325,
      "mal-alisi": -10_140,
      "mal-maliyeti": -10_140,
      "purchase:Avansas": 360,
      "purchase:Metro": -10_500,
      "sube:marina": 315,
      "sube:tuzla": 500,
    },
    // Temizlik Dünyası: soda 500 sarftan mal alışına (gider toplamı aynı). Marina'nın 400'ü işletme geneli payından
    // Marina'nın sütununa
    "2026-10": {
      alinan: 500,
      "bolum:genel": -500,
      "expense:90": -500,
      "isletme-geneli": -900,
      "mal-alisi": 500,
      "mal-maliyeti": 500,
      "purchase:Temizlik Dünyası": 500,
      "sube:marina": 400,
    },
  });
  // Örnek fatura olmayan veri (Excel tohumu): hiçbir rakam değişmez
  const plain = { ...excel, invoices: excel.invoices.map((i) => ({ ...i, branchId: null, companyWide: false })), expenseCategories: [sarf] };
  assert.deepEqual(deltas(createModel(oldRuleDataset(plain, { all: plain.invoices, scope: "hepsi" })), createModel(plain)), {});
});

test("Marina seçili: şubesi seçilmemiş faturalar görünmez, Marina'nın sarf payı Marina'nın kârında", () => {
  const view = (invoices: Invoice[]): Dataset => ({
    ...whole,
    invoices,
    branchView: { id: "marina", name: "Marina", kind: "fiziksel" },
    companyMonths: excel.months,
  });
  const after = createModel(view(all.filter((i) => invoiceInScope(i, "marina"))));
  const before = createModel(oldRuleDataset(view([]), { all, scope: "marina" }));
  const d = deltas(before, after, "marina");
  // Mal alışı (bilgi): yalnız Marina'nın ve işletme genelinin faturaları
  for (const m of MONTHS) {
    const n = monthNumbers(after, m);
    assert.equal(n.get("mal-alisi") ?? 0, { "2026-07": 0, "2026-08": 0, "2026-09": 360, "2026-10": 500 }[m], `${m} Marina'nın mal alışı`);
    const old = createModel(oldRuleDataset(whole, { all, scope: "hepsi" })).goodsPurchases(m);
    assert.ok(Math.abs((monthNumbers(before, m).get("mal-alisi") ?? 0) - old) < 0.01, `${m} eskiden bütün faturalar`);
  }
  // Kâr: Marina'ya seçilmiş harcamaya bağlı fatura payı şubenin gideri (eskiden bilgi satırındaydı)
  assert.equal(d["2026-09"].kar, -315);
  assert.equal(d["2026-09"]["expense:90"], 315);
  assert.equal(d["2026-10"].kar, -400);
  assert.equal(d["2026-10"]["expense:90"], 400);
  assert.equal(d["2026-07"]?.kar, undefined, "örnek faturası olmayan ayın kârı aynı");
  assert.equal(d["2026-08"]?.kar, undefined, "seçilmemiş Migros Marina'nın kârını değiştirmez");
  // İşletme geneli payı: seçilmemiş komisyon faturaları ve öbür şubenin payı artık yok
  const commission = (m: string) => excel.invoices.filter((i) => i.category === "Komisyon" && monthOfDate(i.date) === m).reduce((a, i) => a + i.amount - i.discount, 0);
  assert.ok(Math.abs((d["2026-09"]["isletme-geneli"] ?? 0) + commission("2026-09")) < 0.01, "Eylül: komisyon faturaları bilgi satırından çıkar");
  assert.ok(Math.abs((d["2026-10"]["isletme-geneli"] ?? 0) + commission("2026-10") + 1_200 - 300) < 0.01, "Ekim: komisyon ve Marina'nın olmayan sarfı çıkar, işletme geneli 300 kalır");
});

test("Faturalar: ayın mal alımı dökümü kalem kalem, kartın rakamını tutar", () => {
  const model = createModel(whole);
  const invoices: InvoiceRow[] = all.map((i) => ({ ...i, outstanding: null }));
  const href = (f: Record<string, string | undefined>) => JSON.stringify(f);
  const b = invoiceBreakdowns(invoices, MONTHS, href);
  const sumOf = (m: string) => b.goods[m].flatMap((g) => g.rows).reduce((a, r) => a + r.amount, 0);
  for (const m of MONTHS) assert.ok(Math.abs(sumOf(m) - model.goodsPurchases(m)) < 0.01, `${m}: döküm ${sumOf(m)} ≠ kart ${model.goodsPurchases(m)}`);
  const sep = b.goods["2026-09"].find((g) => g.key === "kalem");
  assert.deepEqual(sep?.rows.map((r) => [r.label, r.amount]), [["Avansas", 360]]);
  assert.equal(b.goods["2026-09"].find((g) => g.key === "Hammadde & İçecek")?.rows.find((r) => r.label === "Metro")?.amount, 1_500);
});

test("Ayarlar önizlemesi: başabaşın harcama payı tam modelle aynı (karışık faturanın payıyla)", () => {
  const cats = [{ ...sarf, monthly: true }];
  const full = createModel({ ...whole, expenseCategories: cats, currentMonth: "2026-10" });
  const slim = impactModel(impactData(full));
  for (const m of ["2026-10", "2026-11"]) assert.ok(Math.abs(slim.breakEvenFixedFor(m) - full.breakEvenFixedFor(m)) < 0.01, `${m}: önizleme ${slim.breakEvenFixedFor(m)} ≠ ${full.breakEvenFixedFor(m)}`);
});

test("'Mal alışı sayılmıyor' uyarısı ekranda da sunucudaki kuralla: yalnız bölünmeyen komisyon faturası", () => {
  for (const c of INVOICE_CATEGORIES) assert.equal(stockOnlyCategory(c), c === "Komisyon", `${c}: stoğa girip gelir-gidere girmeyen kategori mi`);
});
