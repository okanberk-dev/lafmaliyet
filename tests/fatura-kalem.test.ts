// Fatura sınıflandırma (sahibin istekleri, 25 Kasım 2026; docs/PARASUT.md › 5f):
// 1. karışık fatura kalem kalem: hammaddeye bağlı kalem mal alışı, kalanı faturanın kategorisi; nedenli "hammadde değil"
//    kalem nedeninin yeri. Fatura tutarı kalemlere net tutarlarıyla orantılı bölünür (fatura altı iskonto da), kuruş
//    toplamı tutar. Gelir-gider, mal maliyeti, vergi ve dışa aktarım aynı payları kullanır. Kalemsiz ya da hiçbir kalemi
//    ayrılmayan faturada rakamlar değişmez (geçmiş aylar sessizce değişmesin).
// 2. tedarikçi bazlı "hep hammadde değil" kuralı; 3. "Temizlik & Sarf" kategorisi ve temizlik firması ↔ malzemesi;
// 6. "hammadde değil"in nedeni (Sarf, Demirbaş, Hizmet, Deneme) ve Vergi › Demirbaş önerisi.
// Çalıştırma: npx tsx --test tests/fatura-kalem.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset, ExpenseCategory, Invoice } from "../src/lib/calc/types";
import { INVOICE_CATEGORIES } from "../src/lib/constants";
import { LINKABLE_CATEGORIES } from "../src/lib/invoice-linking";
import { GOODS_PART, invoiceParts, lineTarget, parseReason, REASON_TARGET, splitLinesFor, SUPPLIES_CATEGORY } from "../src/lib/invoice-split";
import { addIgnoredSupplier, notIngredientOf, parseIgnored, parseIgnoredSuppliers, removeIgnoredSupplier } from "../src/lib/product-ignore";
import { lineAssetCandidates } from "../src/lib/tax/assets";
import { taxMonths, taxPnlInputFromModel } from "../src/lib/tax/pnl";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";
import { pickCategory } from "../src/server/parasut/mapping";

const root = join(__dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const close = (a: number, b: number, msg: string, eps = 0.001) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const sumOf = (m: Map<string, number>) => Math.round([...m.values()].reduce((a, b) => a + b, 0) * 100) / 100;

test("paylar: tutar − iskonto kalemlere net tutarla orantılı (fatura altı iskonto dağılır), kuruş toplamı tutar", () => {
  // Avansas: süt (hammaddeye bağlı) 300 + deterjan 700, faturada 500 ₺ iskonto → net 500; mal 150, sarf 350
  const avansas = { category: SUPPLIES_CATEGORY, amount: 1000, discount: 500, lines: [{ net: 300, to: GOODS_PART }, { net: 700, to: null }] };
  const p = invoiceParts(avansas);
  assert.deepEqual([...p], [
    [GOODS_PART, 150],
    [SUPPLIES_CATEGORY, 350],
  ]);
  // Kuruş: 100 ₺ üçe bölünür → 33,34 + 33,33 + 33,33 (toplam 100,00)
  const thirds = invoiceParts({ category: "Diğer", amount: 100, discount: 0, lines: [{ net: 1, to: GOODS_PART }, { net: 1, to: "Hizmet" }, { net: 1, to: null }] });
  assert.equal(sumOf(thirds), 100);
  assert.deepEqual([...thirds.values()].sort(), [33.33, 33.33, 33.34]);
  // İade (eksi) fatura: paylar da eksi, toplamı tutar
  const iade = invoiceParts({ category: SUPPLIES_CATEGORY, amount: -99.99, discount: 0, lines: [{ net: 10, to: GOODS_PART }, { net: 20, to: null }] });
  assert.equal(sumOf(iade), -99.99);
  assert.ok([...iade.values()].every((v) => v <= 0));
  // Kalemsiz fatura bütün: mal kategorisi mal alışı, öbürü kendi kategorisi
  assert.deepEqual([...invoiceParts({ category: "Hammadde & İçecek", amount: 10, discount: 1 })], [[GOODS_PART, 9]]);
  assert.deepEqual([...invoiceParts({ category: "Hizmet", amount: 10, discount: 0 })], [["Hizmet", 10]]);
  // Kafe dışı ve komisyon faturası bölünmez
  assert.deepEqual([...invoiceParts({ category: "Karaoke box", amount: 10, discount: 0, lines: [{ net: 5, to: GOODS_PART }] })], [["Karaoke box", 10]]);
  assert.deepEqual([...invoiceParts({ category: "Komisyon", amount: 10, discount: 0, lines: [{ net: 5, to: GOODS_PART }] })], [["Komisyon", 10]]);
  // Bütün kalemleri bağlı "Diğer" faturası tamamen mal alışı; kalem tutarları sıfırsa faturanın kategorisi
  assert.deepEqual([...invoiceParts({ category: "Diğer", amount: 80, discount: 0, lines: [{ net: 40, to: GOODS_PART }] })], [[GOODS_PART, 80]]);
  assert.deepEqual([...invoiceParts({ category: "Diğer", amount: 80, discount: 0, lines: [{ net: 0, to: GOODS_PART }] })], [["Diğer", 80]]);
});

test("kalemin hedefi: bağlı → mal; nedenli hammadde değil → nedeninin yeri; gerisi faturanın kategorisi; ayrılmayan fatura kalem taşımaz", () => {
  assert.equal(lineTarget({ linked: true, reason: "sarf" }), GOODS_PART, "bağlı kalem nedenden önce");
  assert.equal(lineTarget({ linked: false, reason: "sarf" }), SUPPLIES_CATEGORY);
  assert.equal(lineTarget({ linked: false, reason: "demirbas" }), "Kuruluş & Demirbaş");
  assert.equal(lineTarget({ linked: false, reason: "hizmet" }), "Hizmet");
  assert.equal(lineTarget({ linked: false, reason: "deneme" }), GOODS_PART);
  assert.equal(lineTarget({ linked: false, reason: null }), null);
  assert.deepEqual(Object.keys(REASON_TARGET), ["sarf", "demirbas", "hizmet", "deneme"]);
  // Mal faturasının bağlı kalemi faturanın kendi payı: kalem eklenmez (veri küçük, rakam değişmez)
  assert.equal(splitLinesFor("Hammadde & İçecek", [{ net: 5, to: GOODS_PART }, { net: 5, to: null }]), null);
  assert.equal(splitLinesFor("Diğer", [{ net: 5, to: null }]), null);
  assert.deepEqual(splitLinesFor("Diğer", [{ net: 5, to: GOODS_PART }]), [{ net: 5, to: GOODS_PART }]);
  assert.equal(splitLinesFor("Komisyon", [{ net: 5, to: GOODS_PART }]), null);
  assert.equal(parseReason("sarf"), "sarf");
  assert.equal(parseReason("x"), null);
});

// ---------------------------------------------------------------- Gelir-gider ve mal maliyeti
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel: Dataset = datasetFromSeed(data);
const sarf: ExpenseCategory = { id: 90, name: "Temizlik & sarf malzemesi", section: "genel", panelGroup: "diger", invoiceCategory: SUPPLIES_CATEGORY, monthly: false, active: true, sortOrder: 90 };
const MONTH = "2026-11";
const inv = (id: number, supplier: string, category: string, amount: number, discount: number, lines?: Invoice["lines"]): Invoice =>
  ({ id: 900_000 + id, date: `${MONTH}-15`, supplier, description: null, invoiceNo: null, category, amount, discount, payable: (amount - discount) * 1.2, vat: (amount - discount) * 0.2, unpaid: false, note: null, ...(lines ? { lines } : {}) }) as Invoice;
const ds = (invoices: Invoice[]): Dataset => ({ ...excel, currentMonth: "2027-01", invoices: [...excel.invoices.filter((i) => !i.date.startsWith(MONTH)), ...invoices], expenseCategories: [sarf] });

test("Gelir-gider: karışık faturanın bağlı kalemi mal alışında, kalanı sarf giderinde; toplam gider değişmez", () => {
  const plain = [inv(1, "Sütaş", "Hammadde & İçecek", 2000, 0)];
  const mixed = inv(2, "Avansas", SUPPLIES_CATEGORY, 1000, 500, [{ net: 300, to: GOODS_PART }, { net: 700, to: null }]);
  const before = createModel(ds([...plain, { ...mixed, lines: undefined }]));
  const after = createModel(ds([...plain, mixed]));
  // Eski kural: Avansas'ın 500'ü tamamen sarf
  close(before.goodsPurchases(MONTH), 2000, "önce mal");
  close(before.pnlMonth(MONTH).cells.get("expense:90")!.value!, 500, "önce sarf");
  // Yeni: 150 mal (süt), 350 sarf
  close(after.goodsPurchases(MONTH), 2150, "mal alışı");
  const pm = after.pnlMonth(MONTH);
  close(pm.cells.get("expense:90")!.value!, 350, "sarf gideri");
  close(pm.cells.get("purchase:Avansas")!.value!, 150, "Avansas mal alışı satırında");
  close(pm.cells.get("purchase:Sütaş")!.value!, 2000, "Sütaş değişmedi");
  // Faturaların gelir-gidere giren toplamı aynı (yalnız yer değiştirdi)
  close(pm.purchases + pm.cells.get("expense:90")!.value!, before.pnlMonth(MONTH).purchases + 500, "toplam");
  // Kalemsiz / ayrılmayan faturalarda rakamlar birebir aynı (geçmiş aylar)
  const old = createModel(ds(plain));
  close(old.goodsPurchases(MONTH), 2000, "kalemsiz mal");
  for (const m of ["2026-07", "2026-08", "2026-09"]) close(createModel(excel).goodsPurchases(m), createModel({ ...excel, expenseCategories: [sarf] }).goodsPurchases(m), `${m} değişmedi`);
});

test("Gelir-gider: mal faturasında 'Sarf' denmiş kalem sarfa, 'Demirbaş' denmiş kalem mal alışından çıkar", () => {
  const m = createModel(ds([inv(3, "Metro", "Hammadde & İçecek", 12_000, 0, [{ net: 1_500, to: null }, { net: 500, to: SUPPLIES_CATEGORY }, { net: 10_000, to: "Kuruluş & Demirbaş" }])]));
  close(m.goodsPurchases(MONTH), 1_500, "yalnız gıda");
  close(m.pnlMonth(MONTH).cells.get("expense:90")!.value!, 500, "sarf");
  // Demirbaş payı Vergi › Demirbaş'ta öneri olur (sahip onaylar)
  const c = lineAssetCandidates(m.ds.invoices, []);
  assert.equal(c.length, 1);
  close(c[0].net, 10_000, "demirbaş payı");
  assert.equal(lineAssetCandidates(m.ds.invoices, [{ invoiceId: 900_003, cost: 10_000 }]).length, 0, "listeye eklenince öneri kalkar");
});

test("Vergi: kalem kalem SMM'ye mal payı, kalanı payının kategorisinde gider; toplam gider aynı", () => {
  const mixed = inv(2, "Avansas", SUPPLIES_CATEGORY, 1000, 500, [{ net: 300, to: GOODS_PART }, { net: 700, to: null }]);
  const run = (i: Invoice) => {
    const model = createModel({ ...ds([i]), currentMonth: "2026-12" });
    const input = taxPnlInputFromModel(model, { settings: DEFAULT_TAX_SETTINGS, today: "2026-12-10", adjustments: [], assets: [], filings: [] });
    return taxMonths(input, 2026).find((x) => x.month === MONTH)!;
  };
  const a = run(mixed);
  const b = run({ ...mixed, lines: undefined });
  close(a.expense.purchases - b.expense.purchases, 150, "SMM alışı +150 (süt)");
  close(a.expense.invoices - b.expense.invoices, -150, "fatura giderleri −150");
});

test("dışa aktarım ve stoğa giren fatura kontrolü aynı payları okur", () => {
  const wb = read("src/app/api/export/workbook.ts");
  assert.match(wb, /model\.goodsPurchases\(m\) - sum\(GOODS_CATEGORIES/);
  assert.match(wb, /Kalem kalem: mal alışına geçen/);
  // Bağlı kalemi olan Diğer / Hizmet / Temizlik & Sarf faturası artık "mal alışı sayılmıyor" diye kontrole düşmez
  const so = read("src/server/data/stock-only-invoices.ts");
  assert.match(so, /eq\(s\.invoices\.category, COMMISSION_CATEGORY\)/);
  assert.doesNotMatch(so, /notInArray\(s\.invoices\.category/);
  // Yükleyici kalemleri bağlar (dataset.ts → invoice-split.ts)
  assert.match(read("src/server/data/dataset.ts"), /loadSplitLines\(db, invoices\)/);
});

// ---------------------------------------------------------------- Kategori: Temizlik & Sarf
test("Temizlik & Sarf kategorisi: listede Diğer'den önce, bağlanabilir; geçiş harcama satırını açar", () => {
  assert.ok(INVOICE_CATEGORIES.indexOf(SUPPLIES_CATEGORY) >= 0 && INVOICE_CATEGORIES.indexOf(SUPPLIES_CATEGORY) < INVOICE_CATEGORIES.indexOf("Diğer"));
  assert.ok(LINKABLE_CATEGORIES.includes(SUPPLIES_CATEGORY));
  const sql = read("drizzle/0090_temizlik_sarf.sql");
  assert.match(sql, /'Temizlik & sarf malzemesi', 'genel', 'diger', 'Temizlik & Sarf'/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM "expense_categories" WHERE "invoice_category" = 'Temizlik & Sarf'\)/);
});

test("kategori ipuçları: temizlik FİRMASI Hizmet, temizlik MALZEMESİ Temizlik & Sarf; kuralsız Diğer", () => {
  const pick = (names: string[], description: string | null = null) =>
    pickCategory({ supplier: "Yeni Firma", description, parasutCategory: null, lines: names.map((productName) => ({ productName })) }, [], new Map(), INVOICE_CATEGORIES).category;
  assert.equal(pick(["Temizlik hizmet bedeli Kasım"]), "Hizmet");
  assert.equal(pick(["Temizlik"]), "Hizmet", "tek başına 'temizlik': firmanın faturası");
  assert.equal(pick(["Çöp torbası 80x110"]), SUPPLIES_CATEGORY);
  assert.equal(pick(["Deterjan 5 L", "Eldiven nitril"]), SUPPLIES_CATEGORY);
  assert.equal(pick(["Kağıt havlu 6'lı"]), SUPPLIES_CATEGORY);
  assert.equal(pick(["Temizlik malzemesi"]), SUPPLIES_CATEGORY);
  assert.equal(pick(["Kargo bedeli"]), "Hizmet");
  assert.equal(pick(["Pipet"]), "Ambalaj");
  assert.equal(pick(["XYZ 123"]), "Diğer");
});

// ---------------------------------------------------------------- Hammadde değil: neden ve tedarikçi kuralı
test("hammadde değil: neden saklanır, eski kayıt nedensiz okunur; tedarikçi kuralı ürünün işaretinden sonra gelir", () => {
  const list = parseIgnored([
    { productKey: "p:1", productName: "Çöp torbası", at: "2026-11-25T10:00:00Z", reason: "sarf" },
    { productKey: "p:2", productName: "Kargo", at: "2026-10-01T10:00:00Z" },
    { productKey: "p:3", productName: "Bozuk", at: "x", reason: "yok" },
  ]);
  assert.deepEqual(list.map((e) => [e.productKey, e.reason ?? null]), [
    ["p:1", "sarf"],
    ["p:2", null],
    ["p:3", null],
  ]);
  let rules = parseIgnoredSuppliers([{ supplierKey: "avansas", supplierName: "Avansas", reason: "sarf", at: "t" }, { supplierKey: "", supplierName: "x", reason: "sarf", at: "t" }, { supplierKey: "a", supplierName: "a", at: "t" }]);
  assert.equal(rules.length, 1, "bozuk ve nedensiz kural atılır");
  rules = addIgnoredSupplier(rules, { supplierKey: "temizci", supplierName: "Temizci", reason: "hizmet", at: "t" });
  assert.deepEqual(rules.map((r) => r.supplierKey), ["temizci", "avansas"]);
  assert.deepEqual(removeIgnoredSupplier(rules, "temizci").map((r) => r.supplierKey), ["avansas"]);
  const products = new Map(list.map((p) => [p.productKey, p]));
  const suppliers = new Map(rules.map((r) => [r.supplierKey, r]));
  assert.deepEqual(notIngredientOf({ productKey: "p:2", supplierKey: "avansas" }, products, suppliers), { ignored: true, reason: null, via: "urun" }, "ürünün işareti önce");
  assert.deepEqual(notIngredientOf({ productKey: "p:9", supplierKey: "avansas" }, products, suppliers), { ignored: true, reason: "sarf", via: "tedarikci" });
  assert.deepEqual(notIngredientOf({ productKey: "p:9", supplierKey: "baska" }, products, suppliers), { ignored: false, reason: null, via: null });
  // Bekleyenler ve zil kuralı uygular; bağlı kalem (çay) yükleyicide önce bağlantıya bakar
  const sync = read("src/server/parasut/sync.ts");
  assert.match(sync, /ruled\.has\(supplierMatchKey\(l\.supplier\)\)/);
  assert.match(sync, /!ruled\.has\(supplierMatchKey\(r\.supplier\)\)/);
  assert.match(read("src/server/data/invoice-split.ts"), /const not = isLinked \? null : notIngredientOf/);
});

// ---------------------------------------------------------------- Paraşüt sayfası hafif (B5)
test("Paraşüt sayfası: bekleyen kartlarda tam hammadde listesi yok; aranabilir tek seçici, liste bir kez kurulur", () => {
  const client = read("src/app/panel/parasut/parasut-client.tsx");
  assert.doesNotMatch(client, /<optgroup|IngredientOptions/, "her kartta seçenek listesi çizilmez");
  assert.match(client, /<IngredientCombobox value=\{d\.ingredientId\} onChange=\{choose\} groups=\{grouped\}/);
  assert.match(client, /const grouped = useMemo\(\(\) => groupIngredients\(ingredients\), \[ingredients\]\)/);
  const combo = read("src/app/panel/parasut/ingredient-combobox.tsx");
  // Kapalıyken yalnız düğme; liste pencere açılınca; satırlar en az 44 px
  assert.match(combo, /\{open \? \(\s*<ComboDialog/);
  assert.match(combo, /min-h-11 w-full/);
  assert.match(combo, /searchIngredients\(groups, q, value\)/);
});
