// Şube ayrımı parça 5 (27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Alanlar: Tutarlılık, Mutabakat, Stok değeri): üç
// alan kişinin şube görünümüyle okur, ekstre ve gelen POS parası her kipte firmanın. Vergi şubeye bölünmez (sahibin
// kararı 27 Kasım 2026): parça 5'in Vergi alanı kalktı, Vergi'nin üç sekmesi her kipte firmanın. Saf kurallar
// (mutabakatın şube ayrımı, POS'un şube kipi, FIFO havuzu ve ek kalem fiyatı, tahmini stoğun faturaları, fiyat önerileri,
// tedarikçi fiyatları, su dökümü, ürünün şube fiyatı) ve kaynağın biçimi.
// Veritabanındaki sınama: tests/sube-ayrimi-alanlar-5-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-ayrimi-alanlar-5.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { waterBreakdown } from "../src/app/panel/hammaddeler/breakdowns";
import { branchPurchaseNote } from "../src/app/panel/tutarlilik/branch-note";
import { COMPANY_WIDE_READS } from "../src/lib/branch-view";
import { ALL_BRANCHES } from "../src/lib/branches";
import { priceProduct, type WaterCost } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { branchPos, branchRecon, candidatePlace, OTHER_BRANCH_RECORD, redactCandidate } from "../src/lib/mutabakat/branch";
import type { Candidate } from "../src/lib/mutabakat/match";
import { holdInScope, holdsElsewhereText } from "../src/lib/price-hold";
import { economicsAtPrice, productBranchPrice, type BranchPriceRef } from "../src/lib/prices/branch-view";
import { receiptsElsewhereText, receiptsInScope } from "../src/lib/stock-estimate";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel: Dataset = datasetFromSeed(data);

// ---------------------------------------------------------------- Vergi: şubeye bölünmez

test("Vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026): şubenin payı, matraha katkı ve şube kipinin süzgeçleri yok", () => {
  assert.equal(existsSync(join(root, "src/lib/tax/branch-share.ts")), false, "şubenin payı kuralları kalktı");
  assert.equal(existsSync(join(root, "src/app/panel/vergi/branch-share.tsx")), false, "şubenin payı ve matraha katkı kartları kalktı");
  assert.doesNotMatch(read("src/server/data/tax.ts"), /loadBranchTaxView|branchTaxShare|branchContribution/);
  assert.doesNotMatch(read("src/app/panel/vergi/gelir-gider/data.ts"), /scopeClassify/);
  assert.doesNotMatch(read("src/app/panel/vergi/gelir-gider/classify-list.tsx"), /scopeNote/);
  for (const file of ["src/app/panel/vergi/page.tsx", "src/app/panel/vergi/gelir-gider/page.tsx", "src/app/panel/vergi/demirbas/page.tsx"]) {
    const src = read(file);
    // Bütün şubelerle okur (tek vergi numarası), şube seçiliyken "bu ekran firma geneli" notu; çip ve alan yok
    assert.match(src, /\/\/ şube-ayrımı: vergi\.beyan\n {2}const \{ model, view, inputs(, reminders)? \} = await withBranchScope\(ALL_BRANCHES/, file);
    assert.match(src, /<CompanyWideNotice screen="vergi" \/>/, file);
    assert.doesNotMatch(src, /areaScope|BranchViewChip|alan\.vergi|BranchShareCard|BranchContributionCard|scopeAssets|scopeClassify|firma geneli"/, file);
  }
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

test("kaynak: üç alan areaScope ile okur, ekranlar çipini çizer, firma geneli notu kalktı; ekstre firmanın", () => {
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
  // Vergi şubeye bölünmez: alanın kaydı yok, okumaları hep firmanın (vergi.beyan)
  assert.equal(ids.has("alan.vergi"), false);
  for (const area of ["tutarlilik", "mutabakat", "stok_degeri"] as const) {
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
