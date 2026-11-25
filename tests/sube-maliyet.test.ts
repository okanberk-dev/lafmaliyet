// Şube görünümünde maliyet (docs/SUBE.md › Şube görünümünde maliyet; sahibin kararı 4 Kasım 2026): soldan tek şube
// seçilince ciro, kasa, satış, personel, sayım ve zayi o şubenin; gider ve sabit gider şubenin + işletme genelinin;
// faturalar ortak. Mal maliyeti şubenin satışından reçeteye göre (faturalar ve stok devri şubeye bölünmez).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { branchPnlEntry, companyPnlKey } from "../src/lib/branches";
import { COGS_METHOD_LABELS, createModel, uncountedCogsText } from "../src/lib/calc/engine";
import { dashboard, profitBasisOf } from "../src/lib/calc/insights";
import { actualProfitBreakdown, netProfitBreakdown } from "../src/app/panel/dashboard-breakdowns";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const oku = (p: string) => readFileSync(join(root, p), "utf8");
const data: ExcelData = JSON.parse(oku("src/server/db/seed/excel-data.json"));
const excel: Dataset = excelToDataset(data);
const esp = excel.ingredients.find((i) => i.name === "Espresso çekirdeği")!;
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const ds: Dataset = {
  ...excel,
  currentMonth: "2026-11",
  stockCounts: [{ month: "2026-10", ingredientId: esp.id, qty: 100, factor: 1000 }],
  pnlEntries: [
    ...excel.pnlEntries,
    { month: "2026-09", rowKey: "stock:closing", amount: 12_345, note: null },
    { month: "2026-09", rowKey: "personnel:net", amount: 99_000, note: null },
  ],
};
const sube: Dataset = { ...ds, branchView: { id: "tuzla", name: "Tuzla", kind: "fiziksel" } };

test("elle girilmiş hücreler: manual her şubede, sabit gider kalemi kendi şubesinde, işletmenin toplamları şubede yok", () => {
  const inScope = new Set([1, 2]);
  const all = new Set([1, 2, 3]);
  assert.equal(branchPnlEntry("manual:su", inScope, all), true, "su, doğalgaz: işletme geneli");
  assert.equal(branchPnlEntry("fixed:1", inScope, all), true, "şubenin ya da işletme genelinin kalemi");
  assert.equal(branchPnlEntry("stopaj:2", inScope, all), true);
  assert.equal(branchPnlEntry("fixed:3", inScope, all), false, "başka şubenin kalemi");
  assert.equal(branchPnlEntry("stopaj:3", inScope, all), false);
  assert.equal(branchPnlEntry("fixed:9", inScope, all), true, "silinmiş kalemin girişi işletme geneli");
  for (const k of ["personnel:net", "personnel:employer", "commission:pos", "stock:opening", "stock:closing"]) {
    assert.equal(branchPnlEntry(k, inScope, all), false, k);
    assert.equal(companyPnlKey(k), true, k);
  }
  assert.equal(companyPnlKey("manual:su"), false);
  assert.equal(companyPnlKey("fixed:1"), false);
});

test("şube görünümü: mal maliyeti şubenin satışından reçeteye göre; devir boş, alınan mal bilgi", () => {
  const m = createModel(sube);
  for (const month of ["2026-09", "2026-10", "2026-11"]) {
    const pm = m.pnlMonth(month);
    const c = m.cogsConsumption(month);
    assert.equal(pm.cogsMethod, "sube", month);
    close(pm.cogs, c.total, `${month} mal maliyeti = reçeteye göre tüketim`);
    assert.equal(pm.cells.get("stock:opening")?.value, null, `${month} devir yok`);
    assert.equal(pm.cells.get("stock:closing")?.value, null, `${month} devreden yok`);
    assert.match(pm.cells.get("stock:purchased")!.info!, /İşletme geneli/);
    // Kâr şubenin maliyetiyle: giderler mal maliyeti + bölümler
    close(pm.expenses, pm.cogs + pm.sections.personel + pm.sections.faturalar + pm.sections.kira + pm.sections.genel + pm.sections.komisyon, `${month} gider toplamı`);
  }
  const cell = m.pnlValue(m.pnlMonth("2026-09"), "total:cogs");
  assert.equal(cell.tag, COGS_METHOD_LABELS.sube);
  assert.match(cell.info!, /^Tuzla: şubenin satışından reçeteye göre: reçeteye göre tüketim \(fire hariç\)/);
  assert.match(uncountedCogsText("sube"), /şubenin satışından reçeteye göre/);
  // "Tümü" eskisi gibi: Eylül sayım aralığında, elle yazılan devreden geçerli
  const tum = createModel(ds).pnlMonth("2026-09");
  assert.notEqual(tum.cogsMethod, "sube");
  assert.equal(tum.closing, 12_345);
});

test("şube görünümünde işletmenin toplamı olan hücreler yazılamaz (devir, personel, POS komisyonu)", () => {
  const editable = (d: Dataset) => new Map(createModel(d).pnlRowDefs(["2026-09"]).map((r) => [r.key, r.editable]));
  const tum = editable(ds);
  const tek = editable(sube);
  for (const k of ["stock:opening", "stock:closing", "personnel:net", "personnel:employer", "commission:pos"]) {
    assert.equal(tum.get(k), true, `Tümü: ${k}`);
    assert.equal(tek.get(k), false, `şube: ${k}`);
  }
  // Şubenin sabit gider kalemi şubede yazılır. İşletme geneli kalemler (şubesi boş) ve elle hücreler (pnl_entries şubesiz)
  // Faz 5'ten beri (sahibin kararı 4) şubede satır değildir: "İşletme geneli payı (bilgi)" satırında, Tümü'de yazılır
  const kira = ds.fixedExpenses.find((f) => f.name === "Kira")!;
  const tekKira = editable({ ...sube, fixedExpenses: sube.fixedExpenses.map((f) => (f.id === kira.id ? { ...f, branchId: "tuzla" } : f)) });
  assert.equal(tekKira.get(`fixed:${kira.id}`), true, "sabit gider kalemi");
  assert.equal(tek.has(`fixed:${kira.id}`), false, "işletme geneli kalem şubede satır değil");
  assert.equal(tek.has("manual:harici"), false);
  assert.equal(tum.get("manual:harici"), true, "elle hücre Tümü'de yazılır");
  assert.equal(tek.get("shared:total"), false, "bilgi satırı yazılmaz");
  // Sunucu da reddeder: şube seçiliyken işletmenin hücresi yazılmaz
  const eylem = oku("src/server/actions/pnl.ts");
  assert.match(eylem, /companyPnlKey\(key\) && \(await currentBranchScope\(\)\) !== ALL_BRANCHES\) throw new UserError/);
});

test("Tümü: aynı ayın aynı malzemesi her şubeden bir satır; işletmenin stoğu toplamdır (birim farkı çevrilir)", () => {
  const tek = createModel({ ...ds, stockCounts: [{ month: "2026-10", ingredientId: esp.id, qty: 3, factor: 1000 }] });
  const iki = createModel({
    ...ds,
    stockCounts: [
      { month: "2026-10", ingredientId: esp.id, qty: 2, factor: 1000 },
      { month: "2026-10", ingredientId: esp.id, qty: 1000, factor: 1 },
    ],
  });
  const line = (m: ReturnType<typeof createModel>) => m.stockSheet("2026-10").groups.flatMap((g) => g.lines).find((l) => l.ingredient.id === esp.id)!;
  close(line(iki).qty!, 3, "2 KG + 1000 gr = 3 KG");
  close(line(iki).amount, line(tek).amount, "değer de aynı");
  close(iki.stockSheet("2026-10").total, tek.stockSheet("2026-10").total, "ay toplamı");
});

test("veri yükleyici: şube süzgeci her tabloda, giderde işletme geneli de; online satış yalnız Tümü ve online kanalda", () => {
  const d = oku("src/server/data/dataset.ts");
  for (const col of ["months", "salesLines", "staff", "stockCounts", "wasteEntries"]) {
    assert.match(d, new RegExp(`branchWhere\\(s\\.${col}\\.branchId, scope\\)`), col);
  }
  assert.match(d, /branchWhereWithShared\(s\.expenseEntries\.branchId, scope\)/);
  // Sabit gider: şubenin ve işletme genelinin kalemleri (şubesi boş)
  assert.match(d, /f\.branchId === null \|\| f\.branchId === branch\.id/);
  assert.match(d, /scope === ALL_BRANCHES \|\| branch\?\.kind === "online" \? loadSiteSales\(\) : Promise\.resolve\(\[\]\)/);
  assert.match(d, /branchView: branch \? \{ id: branch\.id, name: branch\.name, kind: branch\.kind \} : null/);
  assert.match(d, /opts\.scope === undefined \? readDataset\(\) : withBranchScope\(opts\.scope, readDataset\)/);
  // LafPOS gün sonları da şubeye göre (kasa raporu, satış, ikram)
  assert.match(oku("src/server/data/lafpos-sales.ts"), /currentBranchWhere\(d\.branchId\)/);
  assert.match(oku("src/server/data/lafpos-ikram.ts"), /currentBranchWhere\(s\.posDayReports\.branchId\)/);
  assert.match(oku("src/server/data/cash-reports.ts"), /lte\(s\.posDayReports\.date, to\) : undefined, await currentBranchWhere\(s\.posDayReports\.branchId\)/);
});

test("işletme geneli ekranlar şube seçiminden bağımsız: vergi, nakit planı, tutarlılık, dışa aktarım", () => {
  for (const p of ["src/app/panel/vergi/page.tsx", "src/app/panel/vergi/gelir-gider/page.tsx", "src/app/panel/vergi/demirbas/page.tsx", "src/app/panel/hatirlaticilar/nakit/page.tsx", "src/app/api/export/route.ts"]) {
    const s = oku(p);
    assert.match(s, /withBranchScope\(ALL_BRANCHES,/, p);
  }
  assert.match(oku("src/app/panel/tutarlilik/page.tsx"), /loadModel\(\{ scope: ALL_BRANCHES \}\)/);
  // Seçimi geçersiz kılan kapsam isteğin seçiminden önce gelir
  const kapsam = oku("src/server/branch-scope.ts");
  assert.match(kapsam, /return scopeOverride\.getStore\(\) \?\? requestBranchScope\(\);/);
});

test("stok sayımı şube başına: ekran ve kayıt aynı fiziksel şube (Tümü ya da online kanalda Tuzla)", () => {
  const sayfa = oku("src/app/panel/sayim/page.tsx");
  assert.match(sayfa, /loadModel\(\{ scope: branch\.id \}\)/);
  const eylem = oku("src/server/actions/stock.ts");
  assert.match(eylem, /target: \[s\.stockCounts\.month, s\.stockCounts\.branchId, s\.stockCounts\.ingredientId\]/);
  assert.match(eylem, /values\(\{ month: m, branchId: sube, ingredientId/);
  // Okuma ve silme de şubeye göre: başka şubenin sayımına dokunulmaz
  assert.ok((eylem.match(/buSube/g) ?? []).length >= 4, "kontrol, silme, mevcut okuma şubeye göre");
  assert.match(oku("src/server/data/count-progress.ts"), /eq\(sc\.branchId, \(await currentPhysicalBranch\(\)\)\.id\)/);
});

/** src altındaki bütün .ts / .tsx dosyaları */
function sources(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (statSync(join(root, p)).isDirectory()) return sources(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

test("çakışma hedefi: anahtarı şubeyi içeren tabloya yazan her ON CONFLICT şubeyi içerir (bütün kaynaklarda)", () => {
  // Postgres: "there is no unique or exclusion constraint matching the ON CONFLICT specification". Dalga 2'de
  // sayım kaydı bu yüzden düştü (stock.ts); bekçi artık bütün kaynak dosyalarını tarar
  const keyed = /\b(months|stockCounts|cashReports|posDailySales|posDayReports|modposCashSheets)\b/;
  let seen = 0;
  for (const p of sources("src")) {
    const s = oku(p);
    for (const m of s.matchAll(/onConflictDo(?:Update|Nothing)\(\{\s*target: (\[[^\]]*\]|[^,\n}]+)/g)) {
      const hedef = m[1]!.trim();
      if (!keyed.test(hedef)) continue;
      seen++;
      assert.match(hedef, /^\[/, `${p}: ${hedef} dizi olmalı`);
      assert.match(hedef, /branchId/, `${p}: ${hedef} şubeyi içermeli`);
    }
  }
  assert.ok(seen >= 4, "bekçi gerçekten hedef buldu");
});

test("şube görünümü: faturaya göre oran ve alınan − harcanan yok, kârın adı Gelir-gider'e göre (bulgu 64)", () => {
  const month = "2026-09";
  // Tümü: işletmenin mal alımı ÷ işletmenin net satışı
  const tumModel = createModel(ds);
  const tum = dashboard(tumModel, month);
  assert.ok(tum.theoretical, "Eylül'ün satış listesi var");
  close(tum.invoiceCostRatio!, tumModel.goodsPurchases(month) / tum.theoretical.netSales, "Tümü faturaya göre oran", 1e-9);
  assert.deepEqual(tum.profitBasis, profitBasisOf(null));
  assert.equal(tum.profitBasis.invoices, true);
  assert.equal(tum.profitBasis.label, "faturaya göre");

  // Tuzla seçili: faturalar (şubesiz) okunsa da şubenin satışına bölünmez
  const tekModel = createModel(sube);
  assert.ok(tekModel.goodsPurchases(month) > 0, "işletme geneli faturalar şube görünümünde de okunur");
  const tek = dashboard(tekModel, month);
  assert.equal(tek.invoiceCostRatio, null, "faturaya göre oran yok");
  assert.equal(tek.profitBasis.invoices, false);
  assert.equal(tek.profitBasis.label, "Gelir-gider'e göre");
  assert.match(tek.profitBasis.sharedNote!, /^Tuzla seçili: faturalar işletme genelinde, şubeye bölünmez/);
  // Reçeteye göre oran şubede de var
  assert.ok(tek.recipeCostRatio !== null && tek.recipeCostRatio > 0);

  // Bitmiş ayın kâr dökümü: şubede mal maliyeti tek satır, işletmenin faturaları satır satır yazılmaz, "Diğer" kalanı yok
  const cogs = (d: typeof tek, m: typeof tekModel) => actualProfitBreakdown(m, d).groups!.find((g) => g.key === "cogs")!.rows;
  const tekRows = cogs(tek, tekModel);
  assert.equal(tekRows.length, 1);
  assert.equal(tekRows[0].label, "Mal maliyeti (reçeteye göre)");
  close(tekRows[0].amount, -tekModel.pnlMonth(month).cogs, "şubenin mal maliyeti");
  assert.match(tekRows[0].sub!, /^Tuzla: şubenin satışından reçeteye göre/);
  assert.equal(actualProfitBreakdown(tekModel, tek).title, "Eylül 2026 kâr / zarar (Gelir-gider'e göre)");
  const tumRows = cogs(tum, tumModel);
  assert.ok(tumRows.length > 1, "Tümü'de tedarikçi satırları");
  assert.equal(actualProfitBreakdown(tumModel, tum).title, "Eylül 2026 kâr / zarar (faturaya göre)");
  // Net kâr dökümünün karşılaştırma satırı da aynı adla
  const compare = (d: typeof tek, m: typeof tekModel) =>
    netProfitBreakdown(m, d)
      .groups?.find((g) => g.key === "karsilastirma")
      ?.rows.find((r) => r.key === "fatura")?.label;
  assert.equal(compare(tek, tekModel), "Gelir-gider'e göre");
  assert.equal(compare(tum, tumModel), "Faturaya göre (Gelir-gider)");
});
