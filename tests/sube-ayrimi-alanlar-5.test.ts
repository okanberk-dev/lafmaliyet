// Şube ayrımı parça 5 (27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Alanlar: Vergi, Tutarlılık, Mutabakat, Stok değeri):
// dört alan kişinin şube görünümüyle okur, beyan, ekstre ve gelen POS parası her kipte firmanın. Saf kurallar (şubenin
// payı, eksik belgeler ve demirbaş, mutabakatın şube ayrımı, POS'un şube kipi, FIFO havuzu ve ek kalem fiyatı, tahmini
// stoğun faturaları, fiyat önerileri, tedarikçi fiyatları, su dökümü, ürünün şube fiyatı) ve kaynağın biçimi.
// Veritabanındaki sınama: tests/sube-ayrimi-alanlar-5-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-ayrimi-alanlar-5.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { waterBreakdown } from "../src/app/panel/hammaddeler/breakdowns";
import { branchPurchaseNote } from "../src/app/panel/tutarlilik/branch-note";
import type { ClassifyData } from "../src/app/panel/vergi/gelir-gider/classify-list";
import { scopeClassify } from "../src/app/panel/vergi/gelir-gider/data";
import { COMPANY_WIDE_READS } from "../src/lib/branch-view";
import { ALL_BRANCHES } from "../src/lib/branches";
import { createModel, priceProduct, type WaterCost } from "../src/lib/calc/engine";
import type { Dataset, ExpenseEntry, FixedExpense, Invoice, Month, Staff } from "../src/lib/calc/types";
import { branchPos, branchRecon, candidatePlace, OTHER_BRANCH_RECORD, redactCandidate } from "../src/lib/mutabakat/branch";
import type { Candidate } from "../src/lib/mutabakat/match";
import { holdInScope, holdsElsewhereText } from "../src/lib/price-hold";
import { economicsAtPrice, productBranchPrice, type BranchPriceRef } from "../src/lib/prices/branch-view";
import { receiptsElsewhereText, receiptsInScope } from "../src/lib/stock-estimate";
import type { TaxAsset } from "../src/lib/tax/assets";
import { branchAssets, branchTaxInput, branchTaxShare, scopeAssets } from "../src/lib/tax/branch-share";
import type { TaxPnlInput } from "../src/lib/tax/pnl";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

// ---------------------------------------------------------------- Vergi: şubenin payı (bilgi)

const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel: Dataset = datasetFromSeed(data);
const inv = (id: number, branchId: string | null, amount: number, opts: Partial<Invoice> = {}): Invoice =>
  ({
    id,
    date: "2026-11-15",
    supplier: `Tedarikçi ${id}`,
    description: null,
    invoiceNo: null,
    category: "Hammadde & İçecek",
    amount,
    discount: 0,
    payable: amount * 1.2,
    vat: amount * 0.2,
    unpaid: false,
    note: null,
    branchId,
    companyWide: branchId === null,
    ...opts,
  }) as Invoice;
// Faturalar: 1 Marina'nın, 2 Tuzla'nın (işaretli tutar), 3 işletme geneli, 4 şubesi seçilmemiş
const INVOICES = [inv(1, "marina", 1_000), inv(2, "tuzla", 77_777.77), inv(3, null, 500), inv(4, null, 300, { companyWide: false })];
const staff: Staff[] = [{ id: 1, name: "Arda", netSalary: 35_000, extras: 0, active: true, startMonth: "2026-01", endMonth: null, branchId: "marina" }];
const m = (month: string, posRevenue: number): Month => ({ month, openDays: 30, posRevenue, discounts: 0, offRevenue: 0, note: null });
/** Marina'nın görünümü (dataset.ts gibi: ay ve personel şubenin; fatura şubenin ve işletme genelinin) */
const marinaView: Dataset = {
  ...excel,
  currentMonth: "2026-12",
  branchView: { id: "marina", name: "Marina", kind: "fiziksel" },
  months: [m("2026-10", 100_000), m("2026-11", 120_000)],
  salesLines: [],
  stockCounts: [],
  staff,
  invoices: INVOICES.filter((i) => i.branchId === "marina" || i.companyWide),
  pnlEntries: [],
};
const asset = (id: number, invoiceId: number | null): TaxAsset => ({ id, name: `Demirbaş ${id}`, invoiceId, invoiceLabel: null, acquiredOn: "2026-03-01", cost: 12_000, kind: "demirbas", method: "amortisman", lifeYears: 4 });
const ASSETS = [asset(1, 1), asset(2, 2), asset(3, 3), asset(4, null)];
const settings = { ...DEFAULT_TAX_SETTINGS, periodStart: "2026-01-01" };

test("Vergi şube kipi: şubenin payı yalnız şubenin satışı, şubeye seçilmiş faturaları, personeli ve demirbaşı", () => {
  const model = createModel(marinaView);
  const share = branchTaxShare(model, { branch: "marina", year: 2026, today: "2026-12-10", settings, assets: ASSETS });
  assert.equal(share.invoices, 1, "yalnız Marina'ya seçilmiş fatura (işletme geneli değil)");
  close(share.purchaseVat, 200, "Marina'nın faturasının KDV'si");
  assert.ok(share.salesVat > 0, "Marina'nın kasasının satış KDV'si");
  close(share.vatDiff, share.salesVat - share.purchaseVat, "KDV farkı");
  assert.ok(share.sgk > 0, "Arda'nın SGK'sı");
  assert.ok(share.stopaj >= 0);
  assert.equal(share.people, 1);
  assert.equal(share.assets, 1, "yalnız Marina'nın faturasına bağlı demirbaş");
  close(share.depreciation, 3_000, "12.000 ÷ 4 yıl");
  assert.equal(JSON.stringify(share).includes("77777"), false, "Tuzla'nın faturası payda yok");
  // Personeli olmayan şube: SGK ve stopaj 0
  const empty = branchTaxShare(createModel({ ...marinaView, staff: [] }), { branch: "marina", year: 2026, today: "2026-12-10", settings, assets: [] });
  assert.equal(empty.sgk, 0);
  assert.equal(empty.depreciation, 0);
});

test("Vergi kârı şube kipi: girdi şubenin kalemleriyle; muhasebecinin kayıtları, düzeltmeler ve işletme geneli yok", () => {
  const fixed = (id: number, branchId: string | null) => ({ id, branchId }) as FixedExpense;
  const entry = (id: number, branchId: string | null) => ({ id, branchId }) as ExpenseEntry;
  const month = {
    month: "2026-11",
    fixedCells: [
      { id: 10, value: 1, overridden: false, outOfRange: false },
      { id: 11, value: 2, overridden: false, outOfRange: false },
    ],
    stopajCells: [{ id: 10, value: 1 }],
    officialRent: [{ id: 11, gross: 5 }],
    manualCells: { "manual:su": 900 },
  };
  const input = {
    months: new Map([["2026-11", month]]),
    invoices: INVOICES,
    fixed: [fixed(10, "marina"), fixed(11, null)],
    expenseEntries: [entry(1, "marina"), entry(2, null), entry(3, "tuzla")],
    assets: ASSETS,
    adjustments: [{ id: 1 }],
    filings: [{ id: 1 }],
  } as unknown as TaxPnlInput;
  const own = branchTaxInput(input, "marina");
  assert.deepEqual(own.invoices.map((i) => i.id), [1], "işletme geneli ve öbür şubenin faturası yok");
  assert.deepEqual(own.fixed.map((f) => f.id), [10]);
  assert.deepEqual(own.expenseEntries.map((e) => e.id), [1]);
  assert.deepEqual(own.assets.map((a) => a.id), [1]);
  assert.deepEqual(own.adjustments, []);
  assert.deepEqual(own.filings, [], "beyanname matrahı firmanın: gelir şubenin Z'sinden");
  const m11 = own.months.get("2026-11")!;
  assert.deepEqual(m11.fixedCells.map((c) => c.id), [10]);
  assert.deepEqual(m11.stopajCells, [{ id: 10, value: 1 }]);
  assert.deepEqual(m11.officialRent, []);
  assert.deepEqual(m11.manualCells, {}, "Gelir-gider'e elle yazılan işletme geneli");
});

test("Demirbaş şube kipi: şubenin ve işletme genelinin faturasına bağlı olanlar; faturasız, öbür şubenin ve seçilmemişin sayısı", () => {
  const { shown, hidden } = scopeAssets(ASSETS, INVOICES, "marina");
  assert.deepEqual(shown.map((a) => a.id), [1, 3]);
  assert.equal(hidden, 2, "Tuzla'nın faturası ve faturasız");
  assert.deepEqual(branchAssets(ASSETS, [INVOICES[0]]).map((a) => a.id), [1], "şubenin payında yalnız şubenin faturası");
});

test("Eksik belgeler şube kipi: öbür şubenin faturası, sabit gideri ve harcaması listede değil, sayısı notta", () => {
  const item = (source: ClassifyData["items"][number]["source"], id: number) => ({ key: `${source}:${id}`, source, id, name: `${source} ${id}` }) as ClassifyData["items"][number];
  const data = {
    items: [item("fixed", 10), item("fixed", 11), item("fixed", 12), item("category", 3), item("manual", 0), item("invoice", 1), item("invoice", 2), item("invoice", 4)],
    noDocText: null,
    entries: [
      { key: "entry:1", name: "e1", amount: 1, note: null },
      { key: "entry:3", name: "e3", amount: 1, note: null },
    ],
    unlisted: [
      { id: 1, supplier: "a", date: "2026-11-01", dateText: "", remaining: 1 },
      { id: 2, supplier: "IZ-TUZLA", date: "2026-11-01", dateText: "", remaining: 1 },
    ],
    separate: [{ id: 3, label: "ortak", net: 1, note: null }],
    invoices: [{ id: 1 }, { id: 2 }, { id: 3 }],
  } as unknown as ClassifyData;
  const scoped = scopeClassify(data, "marina", {
    invoices: INVOICES,
    fixed: [{ id: 10, branchId: "marina" }, { id: 11, branchId: null }, { id: 12, branchId: "tuzla" }] as FixedExpense[],
    entries: [{ id: 1, branchId: "marina" }, { id: 3, branchId: "tuzla" }] as ExpenseEntry[],
  });
  assert.deepEqual(scoped.items.map((i) => i.key), ["fixed:10", "fixed:11", "category:3", "manual:0", "invoice:1"]);
  assert.deepEqual(scoped.entries.map((e) => e.key), ["entry:1"]);
  assert.deepEqual(scoped.unlisted.map((u) => u.id), [1]);
  assert.deepEqual(scoped.separate.map((x) => x.id), [3], "işletme geneli fatura kalır");
  assert.deepEqual(scoped.invoices.map((c) => c.id), [1, 3]);
  assert.match(scoped.scopeNote ?? "", /^5 kalem öbür şubelerde ya da şubesi seçilmemiş/);
});

// ---------------------------------------------------------------- Mutabakat

const cand = (kind: Candidate["kind"], id: number, branchId: string | null | undefined, label = `${kind} ${id}`): Candidate => ({ kind, id, date: "2026-11-10", amount: -100, label, href: `/x/${id}`, ref: "F-1", names: [label], branchId });

test("Mutabakat şube kipi: kaydın yeri; öbür şubenin kaydı adsız", () => {
  assert.equal(candidatePlace(cand("harcama", 1, "marina"), "marina"), "sube");
  assert.equal(candidatePlace(cand("harcama", 2, null), "marina"), "isletme");
  assert.equal(candidatePlace(cand("odeme", 3, undefined), "marina"), "isletme", "şubesi bilinmeyen kayıt işletme geneli");
  assert.equal(candidatePlace(cand("teslim", 4, "tuzla"), "marina"), "baska");
  const r = redactCandidate(cand("harcama", 5, "tuzla", "IZ-TUZLA Kira"));
  assert.equal(r.label, OTHER_BRANCH_RECORD);
  assert.deepEqual([r.href, r.ref, r.names], [null, null, []]);
  assert.equal(r.amount, -100);
});

test("Mutabakat şube kipi: şubenin kaydıyla eşleşenler üstte, gerisi İşletme geneli; eksikler yalnız şubenin", () => {
  const row = (id: number, candidate: Candidate | null) => ({ line: { id }, candidate, status: candidate ? "eslesti" : "yok", pos: false });
  const rows = [row(1, cand("harcama", 1, "marina")), row(2, cand("fatura-odeme", 2, "tuzla", "IZ-TUZLA Gıda")), row(3, null), row(4, cand("odeme", 4, null))];
  const missing = [cand("harcama", 10, "marina"), cand("teslim", 11, "tuzla"), cand("odeme", 12, null)];
  const b = branchRecon(rows, missing, "marina");
  assert.deepEqual(b.own.map((r) => r.line.id), [1]);
  assert.deepEqual(b.shared.map((r) => r.line.id), [2, 3, 4]);
  assert.equal(JSON.stringify(b).includes("IZ-TUZLA"), false, "öbür şubenin kaydının adı yok");
  assert.equal(b.shared[0].candidate?.label, OTHER_BRANCH_RECORD);
  assert.deepEqual(b.missing.map((c) => c.id), [10]);
  assert.equal(b.otherMissing, 2);
});

test("POS hakediş şube kipi: şubenin kart satışı ve beklenen neti; günün durumu firmanın", () => {
  const days = [
    { date: "2026-11-02", branchId: "marina", card: 1_000, source: "z" as const },
    { date: "2026-11-02", branchId: "tuzla", card: 77_777.77, source: "z" as const },
    { date: "2026-11-03", branchId: "marina", card: 500, source: "banka-fisi" as const },
  ];
  const settings = { blockDays: 1, rates: { marina: 0.02, tuzla: 0.03 }, defaultRate: 0.02 };
  const b = branchPos({ branch: "marina", days, settings, coverage: { from: "2026-11-01", to: "2026-11-30" }, today: "2026-11-27", firmRows: [{ due: "2026-11-03", status: "tamam" }] });
  assert.equal(JSON.stringify(b).includes("77777"), false, "Tuzla'nın satışı yok");
  assert.deepEqual(b.rows.map((r) => r.due), ["2026-11-03", "2026-11-04"]);
  close(b.totals.gross, 1_500, "kart satışı");
  close(b.totals.expected, 1_470, "kart × (1 − %2)");
  assert.deepEqual(b.rows.map((r) => r.firmStatus), ["tamam", "bekleniyor"], "firmanın satırı yoksa bekleniyor");
});

// ---------------------------------------------------------------- Tutarlılık

test("Tutarlılık şube kipi: alınanın dayanağı ve dahil olmayanların sayısı", () => {
  assert.equal(branchPurchaseNote({ invoices: 3, manual: 2 }), "3 şubesiz fatura, 2 elle alım dahil değil: Faturalar'da şubesini seçin ya da firma geneli görünüme geçin.");
  assert.equal(branchPurchaseNote({ invoices: 0, manual: 1 }), "1 elle alım dahil değil: Faturalar'da şubesini seçin ya da firma geneli görünüme geçin.");
  assert.equal(branchPurchaseNote({ invoices: 0, manual: 0 }), "İşletme geneli faturalar ve elle yazılan alım dahil değil.");
});

// ---------------------------------------------------------------- Stok: tahmini stoğun faturaları, öneriler, su, fiyat

test("Tahmini stoğun faturaları: Marina seçiliyken Marina'nın ve şubesi seçilmemiş; öbür şube ve işletme geneli sayı", () => {
  const list = [
    { id: 1, branchId: "marina", companyWide: false },
    { id: 2, branchId: "tuzla", companyWide: false },
    { id: 3, branchId: null, companyWide: true },
    { id: 4, branchId: null, companyWide: false },
  ];
  const m = receiptsInScope(list, "marina");
  assert.deepEqual(m.shown.map((i) => i.id), [1, 4]);
  assert.deepEqual(m.elsewhere, { branches: 1, shared: 1 });
  assert.equal(receiptsElsewhereText(m.elsewhere), "1 fatura başka şubede, 1 fatura işletme geneli: Tümü'de görünür.");
  assert.equal(receiptsInScope(list, ALL_BRANCHES).shown.length, 4);
  assert.equal(receiptsElsewhereText({ branches: 0, shared: 0 }), null);
});

test("Fiyat önerisi: öbür şubenin faturasından gelen şube seçiliyken sayı olarak; şubesi boş ve okunamayan her şubede", () => {
  assert.equal(holdInScope("marina", "marina"), true);
  assert.equal(holdInScope(null, "marina"), true);
  assert.equal(holdInScope(undefined, "marina"), true);
  assert.equal(holdInScope("tuzla", "marina"), false);
  assert.equal(holdInScope("tuzla", ALL_BRANCHES), true);
  assert.equal(holdsElsewhereText(2), "Öbür şubelerde 2 öneri daha: Tümü'de görünür.");
  assert.equal(holdsElsewhereText(0), null);
});

test("Su + buz dökümü şube seçiliyken: litre fiyatı firmanın, şubenin litresi malzeme malzeme, öbürü tek satır", () => {
  const water: WaterCost = { perLiter: 0.5, month: "2026-11", bill: 500, liters: 1_000, onlineLiters: 0, reason: "ok", latestBillMonth: "2026-11" };
  const items = [
    { id: 1, name: "Su", priceSource: "water" as const },
    { id: 2, name: "Buz", priceSource: "water" as const },
  ];
  const all = new Map([
    [1, 700_000],
    [2, 300_000],
  ]);
  const own = new Map([
    [1, 300_000],
    [2, 100_000],
  ]);
  const d = waterBreakdown(water, items, all, new Map(), { name: "Marina", usage: own, online: new Map() });
  const liters = d.groups.find((g) => g.key === "litre")!;
  assert.deepEqual(
    liters.rows.map((r) => [r.label, r.amount]),
    [
      ["Su · Marina", 300],
      ["Buz · Marina", 100],
      ["Öbür şubeler ve online", 600],
    ],
  );
  assert.equal(d.totalDisplay, waterBreakdown(water, items, all).totalDisplay, "litre fiyatı aynı (firmanın faturası)");
});

test("Ürünün şube fiyatı: şubenin kendi satırı varsa o fiyat, kâr ve oran onunla; yoksa taban", () => {
  const items: BranchPriceRef[] = [
    { id: "mnu-1", base: { M: 100, L: 120 }, current: { M: 110, L: 120, from: "2026-11-20T02:00:00Z" } },
    { id: "mnu-2", base: { M: 90, L: 0 }, current: { M: 90, L: 0, from: null } },
  ];
  assert.equal(productBranchPrice({ siteMenuId: "mnu-1", slot: "M" }, items, 100), 110);
  assert.equal(productBranchPrice({ siteMenuId: "mnu-1", slot: "L" }, items, 120), null, "tabanla aynı");
  assert.equal(productBranchPrice({ siteMenuId: "mnu-2", slot: "M" }, items, 90), null, "şubenin satırı yok");
  assert.equal(productBranchPrice(null, items, 100), null, "siteye bağlı değil");
  const st = excel.settings;
  const lines = [{ qty: 1, unitCost: 20, vatRate: 0.1, isPackaging: false }];
  const at110 = priceProduct({ price: 110, fireOverride: null }, lines, st);
  const re = economicsAtPrice(priceProduct({ price: 100, fireOverride: null }, lines, st), 110, st);
  for (const k of ["price", "net", "commission", "totalCost", "unitProfit", "margin", "costRatio", "status", "cost", "suggestedPrice"] as const) assert.equal(re[k], at110[k], k);
});

// ---------------------------------------------------------------- Kaynak

test("kaynak: dört alan areaScope ile okur, ekranlar çipini çizer, firma geneli notu kalktı; beyan ve ekstre firmanın", () => {
  const vergi = read("src/app/panel/vergi/page.tsx");
  assert.match(vergi, /\/\/ şube-ayrımı: vergi\.beyan\n {2}const \{ model, view, inputs, reminders \} = await withBranchScope\(ALL_BRANCHES/);
  assert.match(vergi, /\/\/ şube-ayrımı: alan\.vergi\n {2}const area = await areaScope\("vergi"\);/);
  assert.match(vergi, /<BranchShareCard name=\{branchShare\.name\} share=\{branchShare\.share\} \/>/);
  assert.match(read("src/app/panel/vergi/gelir-gider/page.tsx"), /<BranchContributionCard name=\{branch\.name\} c=\{branch\.contribution\} \/>/);
  assert.match(read("src/app/panel/vergi/gelir-gider/page.tsx"), /scopeClassify\(allClassify, area,/);
  assert.match(read("src/app/panel/vergi/demirbas/page.tsx"), /scopeAssets\(inputs\.assets, model\.ds\.invoices, area\)/);
  const tut = read("src/app/panel/tutarlilik/page.tsx");
  assert.match(tut, /const scope = await areaScope\("tutarlilik"\);/);
  assert.match(tut, /loadDataset\(\{ scope \}\)/);
  assert.match(tut, /pendingWasteSummary\(\{ month, scope \}\)/);
  assert.match(tut, /scopeBadge=\{branchMode \? "Firma geneli" : null\}/);
  const mut = read("src/app/panel/mutabakat/page.tsx");
  assert.match(mut, /const scope = await areaScope\("mutabakat"\);/);
  assert.match(mut, /loadRecon\(scope\)/);
  assert.match(mut, /<PosSection scope=\{scope\} \/>/);
  // Elle eşleştirmenin havuzu firmanın: eylem loadRecon'u kapsamsız çağırır (loadLinePool)
  assert.match(read("src/server/mutabakat/load.ts"), /const \{ pools, poolOfStatement \} = await loadRecon\(\);/);
  assert.match(read("src/server/data/dataset.ts"), /\/\/ şube-ayrımı: alan\.stok_degeri\n {4}areaScope\("stok_degeri"\)\.then\(loadPurchaseLots\),/);
  assert.match(read("src/server/data/purchase-lots-query.ts"), /invoiceScopeWhere\(scope\)\)\)/);
  for (const [file, area] of [
    ["src/app/panel/vergi/page.tsx", "vergi"],
    ["src/app/panel/vergi/gelir-gider/page.tsx", "vergi"],
    ["src/app/panel/vergi/demirbas/page.tsx", "vergi"],
    ["src/app/panel/tutarlilik/page.tsx", "tutarlilik"],
    ["src/app/panel/mutabakat/page.tsx", "mutabakat"],
    ["src/app/panel/sayim/page.tsx", "stok_degeri"],
  ] as const) {
    assert.match(read(file), new RegExp(`<BranchViewChip area="${area}"`), file);
    assert.doesNotMatch(read(file), /<CompanyWideNotice/, file);
  }
});

test("kaynak: kayıt parça 5'in alanlarını taşır, parça 5'in bekleyenleri kapandı; tek şube açıkken alan firmanın", () => {
  const ids = new Map(COMPANY_WIDE_READS.map((r) => [r.id, r]));
  for (const area of ["vergi", "tutarlilik", "mutabakat", "stok_degeri"] as const) {
    const r = ids.get(`alan.${area}`);
    assert.ok(r, `alan.${area}`);
    assert.equal(r.kind, "alan");
    assert.equal(r.area, area);
  }
  assert.equal(ids.get("vergi.beyan")?.kind, "yalniz-firma");
  // Bekleyen kayıt kalmadı (parça 6 sonuncuyu kapattı; tests/sube-ayrimi.test.ts kaydın türlerini denetler)
  assert.equal(
    COMPANY_WIDE_READS.some((r) => (r.kind as string) === "bekliyor"),
    false,
  );
  assert.match(read("src/server/branch-scope.ts"), /if \(\(await listBranches\(\)\)\.filter\(\(b\) => b\.active\)\.length < 2\) return ALL_BRANCHES;/);
});

test("kaynak: seçimle okunanlar (tahmini stoğun faturaları, öneriler, tedarikçi fiyatları, şube fiyatı)", () => {
  assert.match(read("src/app/panel/sayim/tahmini/page.tsx"), /loadReceiptInvoices\(estimate\.from, today, undefined, undefined, selected\)/);
  assert.match(read("src/app/panel/hammaddeler/page.tsx"), /loadPriceHolds\(scope\)/);
  assert.match(read("src/server/actions/notifications.ts"), /pendingHoldSummary\(await currentBranchScope\(\)\)/);
  assert.match(read("src/server/data/today.ts"), /pendingHoldSummary\(scope\)/);
  assert.match(read("src/app/panel/page.tsx"), /pendingHoldSummary\(scope\)/);
  // Sabah e-postası firmanın: öneriler kapsamsız
  assert.match(read("src/server/notify/digest.ts"), /pendingHoldSummary\(\)/);
  assert.match(read("src/app/api/hammaddeler/[id]/fiyatlar/route.ts"), /loadSupplierPrices\(id, todayTR\(\), await currentBranchScope\(\)\)/);
  assert.match(read("src/app/panel/urunler/page.tsx"), /economicsAtPrice\(pc, branchPrice, st\)/);
  assert.match(read("src/app/panel/urunler/[id]/recipe-editor.tsx"), /label=\{branchPrice \? `\$\{BASE_PRICE_LABEL\} \(KDV dahil\)` : "Satış fiyatı \(KDV dahil\)"\}/);
});
