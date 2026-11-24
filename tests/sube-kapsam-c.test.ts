// Şube kapsamı C (P1/P2; 24 Kasım 2026, docs/SUBE.md): Onaylar ve zil şubenin istekleriyle, sayım uyarıları şubenin
// sayımıyla, Aylık harcamalar'ın toplamı şubenin kendi kayıtlarıyla (Gelir-gider'in hücresiyle aynı), Tükendi'nin
// "bütün şubelerde" metni, kasa ve sayım "Tümü"de şubeyi sorar, Excel dosyası ekranın kapsamıyla. Saf kurallar ve kaynak
// denetimleri; veritabanı yolları tests/sube-kapsam-c-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/sube-kapsam-c.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { expenseSplit } from "../src/app/panel/harcamalar/summary";
import { countLogBranch, countLogDetail, loggedItems } from "../src/app/panel/sayim/logic";
import { ALL_BRANCHES, requestInScope } from "../src/lib/branches";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset, ExpenseCategory, ExpenseEntry, Invoice } from "../src/lib/calc/types";
import { soldOutAllBranchesText } from "../src/lib/site-menu/sold-out";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const BRANCHES = [
  { id: "tuzla", name: "Tuzla" },
  { id: "marina", name: "Marina" },
];

test("istek kapsamda mı: Tümü'de hepsi, tek şubede yalnız o şubenin; şubesi bilinmeyen her yerde", () => {
  assert.equal(requestInScope("tuzla", ALL_BRANCHES), true);
  assert.equal(requestInScope("tuzla", "marina"), false, "Marina'da Tuzla'nın isteği sayılmaz");
  assert.equal(requestInScope("marina", "marina"), true);
  assert.equal(requestInScope(null, "marina"), true, "mal taslağı ya da kaydı silinmiş eski istek gizlenmez");
});

test("sayım kaydının şubesi: ayrıntının sonunda adıyla; eski kayıt ve tanınmayan ad her şubede", () => {
  const d = countLogDetail("2026-10", "3 kalem, 1 sayım silindi", "Marina");
  assert.equal(d, "Ekim 2026: 3 kalem, 1 sayım silindi · Marina");
  assert.equal(loggedItems(d), 4, "kalem sayısı okunmaya devam eder");
  assert.ok(d.startsWith("Ekim 2026:"), "uyarı ayı önekle arar");
  assert.equal(countLogBranch(d, BRANCHES), "marina");
  assert.equal(countLogBranch("Ekim 2026: 3 kalem", BRANCHES), null, "şubesiz eski kayıt");
  assert.equal(countLogBranch("Ekim 2026: 3 kalem · Eski ad", BRANCHES), null, "yeniden adlandırılmış şube");
  assert.equal(countLogBranch(null, BRANCHES), null);
});

test("Aylık harcamalar: şubenin toplamı Gelir-gider'in harcama hücresiyle aynı; işletme geneli ve faturalar ayrı", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const excel = excelToDataset(data);
  const reklam: ExpenseCategory = { id: 1, name: "Reklam", section: "genel", panelGroup: "reklam", invoiceCategory: "Reklam & Tabela", monthly: false, active: true, sortOrder: 1 };
  const entry = (id: number, amount: number, branchId: string | null): ExpenseEntry => ({ id, date: "2026-11-10", categoryId: 1, description: null, amount, paymentMethod: null, note: null, branchId });
  const entries = [entry(1, 3_000, "marina"), entry(2, 4_000, null), entry(3, 5_000, "tuzla")];
  const invoices = [{ id: 2, date: "2026-11-15", supplier: "Tabelacı", description: null, invoiceNo: null, category: "Reklam & Tabela", amount: 6_000, discount: 0, payable: 7_200, vat: 1_200, unpaid: false, note: null } as Invoice];
  const base: Dataset = { ...excel, currentMonth: "2027-01", salesLines: [], stockCounts: [], invoices, expenseCategories: [reklam], pnlEntries: [], staff: [], fixedExpenses: [], months: [] };
  // Marina'nın görünümü: dataset.ts gibi şubenin ve işletme genelinin kayıtları
  const marinaEntries = entries.filter((e) => e.branchId === null || e.branchId === "marina");
  const marina = createModel({ ...base, branchView: { id: "marina", name: "Marina", kind: "fiziksel" }, expenseEntries: marinaEntries });
  const split = expenseSplit(marinaEntries, "marina");
  assert.deepEqual(split.get(1), { own: 3_000, shared: 4_000 });
  assert.equal(split.get(1)!.own, marina.pnlMonth("2026-11").cells.get("expense:1")!.value, "sayfanın toplamı = Gelir-gider hücresi");
  // İşletme geneli kısım: şubesi boş kayıt + bağlı fatura = Gelir-gider'in "İşletme geneli payı"na giren harcama
  const invoicesInView = marina.expenseAmounts("2026-11").find((x) => x.cat.id === 1)!.invoices;
  assert.equal(split.get(1)!.shared + invoicesInView, 4_000 + 6_000);
  // Tümü: ayrım yok, her şey toplamda (motorun hücresi faturayla birlikte)
  const all = expenseSplit(entries, null);
  assert.deepEqual(all.get(1), { own: 12_000, shared: 0 });
  const allModel = createModel({ ...base, expenseEntries: entries });
  assert.equal(all.get(1)!.own + invoicesInView, allModel.pnlMonth("2026-11").cells.get("expense:1")!.value);
});

test("Tükendi: birden çok şube açıkken bütün şubelerde kapandığı söylenir; tek şubede metin yok", () => {
  assert.equal(soldOutAllBranchesText(["Tuzla"]), null);
  assert.equal(soldOutAllBranchesText(["Tuzla", "Marina"]), "Bütün şubelerde kapanır (Tuzla ve Marina): sitede şube başına durum yok.");
  assert.equal(soldOutAllBranchesText(["Tuzla", "Marina", "Kadıköy"]), "Bütün şubelerde kapanır (Tuzla, Marina ve Kadıköy): sitede şube başına durum yok.");
  const card = read("src/app/panel/siparisler/sold-out-card.tsx");
  assert.match(card, /soldOut && lockedStaff && allText \? setConfirming\(e\) : toggle\(e, soldOut\)/, "kilitli personelde Tükendi önce onay");
});

test("kaynak: Onaylar ve zil tek şubede şubenin istekleri; karaoke yalnız kendi şubesinde", () => {
  assert.match(read("src/app/panel/onaylar/kasa-section.tsx"), /loadCashRequestQueue\(undefined, await currentBranchScope\(\)\)/);
  assert.match(read("src/app/panel/onaylar/karaoke-section.tsx"), /if \(!requestInScope\(KARAOKE_BRANCH_ID, await currentBranchScope\(\)\)\) return null;/);
  const kasa = read("src/server/bell/kasa.ts");
  assert.match(kasa, /pendingCashBellRows\(scope\),\s+cashOutBellRow\(now, scope\),\s+pendingClosedRows\(scope\),/);
  const ops = read("src/server/bell/ops.ts");
  assert.match(ops, /pendingWasteSummary\(\{ scope: await currentBranchScope\(\) \}\)/);
  assert.match(ops, /if \(!requestInScope\(KARAOKE_BRANCH_ID, await currentBranchScope\(\)\)\) return \[\];/);
});

test("kaynak: kasa ve sayım 'Tümü'de birden çok kasa açıkken formdan önce şubeyi sorar", () => {
  const kasa = read("src/app/panel/kasa/page.tsx");
  const at = kasa.indexOf("if (many && !tills.some((b) => b.id === scope)) {");
  assert.ok(at > 0 && at < kasa.indexOf("const till = await currentTillBranch();"), "kasa: soru formdan önce");
  assert.match(kasa, /title="Hangi şubenin kasası\?"/);
  const sayim = read("src/app/panel/sayim/page.tsx");
  assert.ok(sayim.indexOf("if (tills.length > 1 && !tills.some((b) => b.id === scope)) {") < sayim.indexOf("const model = await loadModel({ scope: branch.id });"), "sayım: soru modelden önce");
  assert.match(sayim, /title="Hangi şubeyi sayıyorsunuz\?"/);
});

test("kaynak: Excel düğmesi ekranın şubesini gönderir; dosya kapsamı yazar, Vergi ve Cari firma geneli", () => {
  assert.match(read("src/app/panel/page.tsx"), /href=\{`\/api\/export\?ay=\$\{month\}&\$\{BRANCH_PARAM\}=\$\{encodeURIComponent\(scope\)\}`\}/);
  const route = read("src/app/api/export/route.ts");
  assert.match(route, /const scope = raw \? parseBranchScope\(raw, await listBranches\(\)\) : ALL_BRANCHES;/);
  assert.match(route, /withBranchScope\(ALL_BRANCHES, \(\) => loadCariExport\(\)\)/);
  assert.match(read("src/app/api/export/workbook.ts"), /Kapsam: \$\{scope\?\.label \?\? "Tümü"\}/);
  // Ayarlar'daki tam yedek seçicisiz ("Tümü")
  assert.match(read("src/app/panel/ayarlar/page.tsx"), /<a href="\/api\/export" download/);
});
