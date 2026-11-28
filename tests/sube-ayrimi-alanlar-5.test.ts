// Şube ayrımı parça 5 (27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Alanlar: Tutarlılık, Mutabakat, Stok değeri): alanlar
// kişinin şube görünümüyle okur. Vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026): parça 5'in Vergi alanı kalktı,
// Vergi'nin üç sekmesi her kipte firmanın. Mutabakat bölümü 28 Kasım 2026'da kaldırıldı (alanı da). Saf kurallar (FIFO
// havuzu ve ek kalem fiyatı, tahmini stoğun faturaları, fiyat önerileri, tedarikçi fiyatları, su dökümü, ürünün şube
// fiyatı) ve kaynağın biçimi.
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
import { holdInScope, holdsElsewhereText } from "../src/lib/price-hold";
import { economicsAtPrice, productBranchPrice, type BranchPriceRef } from "../src/lib/prices/branch-view";
import { receiptsElsewhereText, receiptsInScope } from "../src/lib/stock-estimate";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel: Dataset = datasetFromSeed(data);

// ---------------------------------------------------------------- Vergi: şubeye bölünmez

test("Vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026); aynı gün Vergi bölümü tümden kaldırıldı: şube payı da ekran da yok", () => {
  for (const p of ["src/lib/tax", "src/app/panel/vergi", "src/server/data/tax.ts"]) assert.equal(existsSync(join(root, p)), false, `${p} kalktı`);
});

// ---------------------------------------------------------------- Mutabakat: bölüm kaldırıldı

test("Mutabakat bölümü kaldırıldı (28 Kasım 2026, sahibin isteği): parça 5'in Mutabakat alanı, şube ayrımı ve POS'un şube kipi de yok", () => {
  for (const p of ["src/lib/mutabakat", "src/app/panel/mutabakat", "src/server/mutabakat/load.ts"]) assert.equal(existsSync(join(root, p)), false, `${p} kalktı`);
  assert.equal(COMPANY_WIDE_READS.some((r) => r.id === "alan.mutabakat"), false);
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

test("kaynak: iki alan areaScope ile okur, ekranlar çipini çizer, firma geneli notu kalktı", () => {
  const tut = read("src/app/panel/tutarlilik/page.tsx");
  assert.match(tut, /const scope = await areaScope\("tutarlilik"\);/);
  assert.match(tut, /loadDataset\(\{ scope \}\)/);
  assert.match(tut, /pendingWasteSummary\(\{ month, scope \}\)/);
  assert.match(tut, /scopeBadge=\{branchMode \? "Firma geneli" : null\}/);
  assert.match(read("src/server/data/dataset.ts"), /\/\/ şube-ayrımı: alan\.stok_degeri\n {4}areaScope\("stok_degeri"\)\.then\(loadPurchaseLots\),/);
  assert.match(read("src/server/data/purchase-lots-query.ts"), /invoiceScopeWhere\(scope\)\)\)/);
  for (const [file, area] of [
    ["src/app/panel/tutarlilik/page.tsx", "tutarlilik"],
    ["src/app/panel/sayim/page.tsx", "stok_degeri"],
  ] as const) {
    assert.match(read(file), new RegExp(`<BranchViewChip area="${area}"`), file);
    assert.doesNotMatch(read(file), /<CompanyWideNotice/, file);
  }
});

test("kaynak: kayıt parça 5'in alanlarını taşır, parça 5'in bekleyenleri kapandı; tek şube açıkken alan firmanın", () => {
  const ids = new Map(COMPANY_WIDE_READS.map((r) => [r.id, r]));
  // Vergi şubeye bölünmez: alanın kaydı yok; Vergi bölümü kaldırılınca okuma kaydı (vergi.beyan) da kalktı
  assert.equal(ids.has("alan.vergi"), false);
  assert.equal(ids.has("vergi.beyan"), false);
  for (const area of ["tutarlilik", "stok_degeri"] as const) {
    const r = ids.get(`alan.${area}`);
    assert.ok(r, `alan.${area}`);
    assert.equal(r.kind, "alan");
    assert.equal(r.area, area);
  }
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
