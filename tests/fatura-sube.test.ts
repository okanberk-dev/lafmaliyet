// Faturanın şubesi (sahibin isteği, 25 Kasım 2026; docs/SUBE.md › Faturanın şubesi): her faturanın şubesi, bilinçli
// "İşletme geneli" ya da "Şubesi seçilmemiş". Tek şube seçiliyken o şubenin ve işletme genelinin faturaları görünür;
// şubesi seçilmemiş fatura görünmez, "Tümü"de kutuda bekler. Öneri kanıta dayanır, tahminle şube yazılmaz.
// Gelir-gider: şubenin faturası şubenin giderinde, işletme geneli fatura bilgi satırında; Tümü'nün şube kırılımında
// şube sütununa yazılır, toplam değişmez.
// Çalıştırma: npx tsx --test tests/fatura-sube.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { matchesStatus, parseStatus, statusCounts } from "../src/app/panel/faturalar/rules";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset, ExpenseCategory, Invoice, Month } from "../src/lib/calc/types";
import {
  INVOICE_SHARED,
  invoiceBranchCols,
  invoiceBranchError,
  invoiceBranchLabel,
  invoiceBranchOptions,
  invoiceBranchValue,
  invoiceInScope,
  isUnassigned,
  newInvoiceBranch,
  suggestInvoiceBranch,
  supplierDefaultValue,
  unassignedGroups,
} from "../src/lib/invoice-branch";
import { invoiceBranchOf } from "../src/lib/parasut/accounts";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const BRANCHES = [
  { id: "tuzla", name: "Tuzla", kind: "fiziksel" as const, active: true, openedOn: null, sortOrder: 1 },
  { id: "marina", name: "Marina", kind: "fiziksel" as const, active: true, openedOn: "2026-11-13", sortOrder: 2 },
  { id: "online", name: "laffogato.net", kind: "online" as const, active: true, openedOn: null, sortOrder: 3 },
];

test("üç hâl: şube, işletme geneli, şubesi seçilmemiş; sütunlar ↔ seçici değeri", () => {
  assert.deepEqual(invoiceBranchCols("marina"), { branchId: "marina", companyWide: false });
  assert.deepEqual(invoiceBranchCols(INVOICE_SHARED), { branchId: null, companyWide: true });
  assert.deepEqual(invoiceBranchCols(null), { branchId: null, companyWide: false });
  assert.equal(invoiceBranchValue({ branchId: "tuzla", companyWide: false }), "tuzla");
  assert.equal(invoiceBranchValue({ branchId: null, companyWide: true }), INVOICE_SHARED);
  assert.equal(invoiceBranchValue({ branchId: null, companyWide: false }), null);
  assert.equal(isUnassigned({ branchId: null, companyWide: false }), true);
  assert.equal(isUnassigned({ branchId: null, companyWide: true }), false);
  assert.equal(invoiceBranchLabel(null, BRANCHES), "Şubesi seçilmemiş");
  assert.equal(invoiceBranchLabel(INVOICE_SHARED, BRANCHES), "İşletme geneli");
  assert.equal(invoiceBranchLabel("marina", BRANCHES), "Marina");
  // Seçenekler: etkin şubeler sırasıyla (online kanal da: sitenin kargo faturası), sonra İşletme geneli
  assert.deepEqual(
    invoiceBranchOptions(BRANCHES).map((o) => o.label),
    ["Tuzla", "Marina", "laffogato.net", "İşletme geneli"],
  );
  assert.equal(invoiceBranchError("marina", BRANCHES), null);
  assert.equal(invoiceBranchError(INVOICE_SHARED, BRANCHES), null);
  assert.equal(invoiceBranchError(null, BRANCHES), null);
  assert.match(invoiceBranchError("bodrum", BRANCHES)!, /Şube bulunamadı/);
  assert.match(invoiceBranchError("eski", [...BRANCHES, { id: "eski", active: false }])!, /Şube bulunamadı/);
});

test("kapsam: Tümü'de hepsi; tek şubede o şubenin ve işletme genelinin faturaları, seçilmemiş ve öbür şube yok", () => {
  const tuzla = { branchId: "tuzla", companyWide: false };
  const marina = { branchId: "marina", companyWide: false };
  const shared = { branchId: null, companyWide: true };
  const none = { branchId: null, companyWide: false };
  for (const r of [tuzla, marina, shared, none]) assert.equal(invoiceInScope(r, "hepsi"), true);
  assert.deepEqual([tuzla, marina, shared, none].map((r) => invoiceInScope(r, "tuzla")), [true, false, true, false]);
  assert.deepEqual([tuzla, marina, shared, none].map((r) => invoiceInScope(r, "marina")), [false, true, true, false]);
  // Sunucunun koşulu aynı kuralı söyler (src/server/invoice-scope.ts)
  const src = read("src/server/invoice-scope.ts");
  assert.match(src, /scope === ALL_BRANCHES \? undefined : or\(eq\(s\.invoices\.branchId, scope\), eq\(s\.invoices\.companyWide, true\)\)/);
  // Okuyanlar o koşulu kullanır: Faturalar / Gelir-gider / Maliyet (loadModel), Paraşüt'ün bekleyen ürünleri ve sayıları
  assert.match(read("src/server/data/dataset.ts"), /from\(s\.invoices\)\.where\(invoiceScopeWhere\(scope\)\)/);
  assert.match(read("src/server/parasut/sync.ts"), /invoiceScopeWhere\(scope\)/);
  assert.match(read("src/app/panel/parasut/page.tsx"), /unlinkedProducts\(40, scope\)/);
  assert.match(read("src/app/panel/parasut/page.tsx"), /mine, invoiceScopeWhere\(scope\)/);
  // Eski kural (şubesi boş = her şubede) faturada kalmadı
  assert.doesNotMatch(read("src/server/data/dataset.ts"), /branchWhereWithShared\(s\.invoices\.branchId/);
});

test("eşitlemenin yeni faturası: ayrı hesap → hesabın şubesi; değilse tedarikçinin varsayılanı; yoksa seçilmemiş (tahmin yok)", () => {
  assert.deepEqual(newInvoiceBranch({ accountBranch: "marina", supplierDefault: "tuzla" }), { branchId: "marina", companyWide: false }, "ayrı hesap önce");
  assert.deepEqual(newInvoiceBranch({ accountBranch: null, supplierDefault: "tuzla" }), { branchId: "tuzla", companyWide: false });
  assert.deepEqual(newInvoiceBranch({ accountBranch: null, supplierDefault: INVOICE_SHARED }), { branchId: null, companyWide: true });
  assert.deepEqual(newInvoiceBranch({ accountBranch: null, supplierDefault: null }), { branchId: null, companyWide: false });
  // Ortak hesap null verir (eskiden "işletme geneli" demekti, artık tedarikçinin varsayılanına bırakır)
  assert.equal(invoiceBranchOf({ id: "tuzla", users: ["tuzla", "marina"] }, "branch"), null);
  assert.equal(supplierDefaultValue({ defaultBranchId: "marina", defaultCompanyWide: false }), "marina");
  assert.equal(supplierDefaultValue({ defaultBranchId: null, defaultCompanyWide: true }), INVOICE_SHARED);
  assert.equal(supplierDefaultValue(null), null);
  // Eşitleme iki yazımda da kuralı çağırır (gider faturası ve e-fatura)
  const sync = read("src/server/parasut/sync.ts");
  assert.equal(sync.match(/\.\.\.newInvoiceBranch\(\{ accountBranch: ctx\.invoiceBranch, supplierDefault: ctx\.supplierBranch\(/g)?.length, 2);
  assert.doesNotMatch(sync, /branchId: ctx\.invoiceBranch/);
});

test("öneri: tedarikçinin varsayılanı > o gün açık tek şube > tedarikçinin öteki kayıtları; karışık ya da yoksa öneri yok", () => {
  const base = { date: "2026-11-20", supplierDefault: null, evidence: [], branches: BRANCHES };
  assert.deepEqual(suggestInvoiceBranch({ ...base, supplierDefault: "marina" }), { value: "marina", reason: "Tedarikçinin varsayılanı", kind: "varsayilan" });
  // Marina 13 Kasım'da açıldı: öncesindeki fatura yalnız Tuzla olabilir
  assert.deepEqual(suggestInvoiceBranch({ ...base, date: "2026-11-01" }), { value: "tuzla", reason: "O tarihte açık tek şube Tuzla", kind: "tarih" });
  // Açıldıktan sonra tarih kanıt değil; kanıt yoksa öneri yok (tahminle şube yazılmaz)
  assert.equal(suggestInvoiceBranch(base), null);
  // Tek şubeyi gösteren kanıt
  const marina = suggestInvoiceBranch({ ...base, evidence: [{ value: "marina", source: "fatura" }, { value: "marina", source: "kasa" }, { value: "marina", source: "fatura" }] });
  assert.deepEqual(marina, { value: "marina", reason: "Tedarikçinin 2 faturası, 1 kasadan ödemesi Marina", kind: "gecmis" });
  assert.equal(suggestInvoiceBranch({ ...base, evidence: [{ value: INVOICE_SHARED, source: "fatura" }] })?.value, INVOICE_SHARED);
  // Karışık kanıt: öneri yok
  assert.equal(suggestInvoiceBranch({ ...base, evidence: [{ value: "marina", source: "fatura" }, { value: "tuzla", source: "kasa" }] }), null);
  // Açılış günü boş şubeler (eski kurulum) tarih kanıtı vermez
  assert.equal(suggestInvoiceBranch({ ...base, date: "2026-01-01", branches: BRANCHES.map((b) => ({ ...b, openedOn: null })) }), null);
});

test("kutu: şubesi seçilmemiş faturalar tedarikçi ve öneri başına gruplanır, en kalabalık önce", () => {
  const inv = (id: number, supplier: string, date: string, amount: number) => ({ id, supplier, date, amount, discount: 0 });
  const rows = [inv(1, "Sütaş", "2026-11-01", 100), inv(2, "Sütaş", "2026-11-20", 200), inv(3, "Sütaş", "2026-11-21", 50), inv(4, "Muhasebe", "2026-11-05", 1000)];
  const groups = unassignedGroups(
    rows,
    (r) => suggestInvoiceBranch({ date: r.date, supplierDefault: r.supplier === "Muhasebe" ? INVOICE_SHARED : null, evidence: [], branches: BRANCHES }),
    (r) => r.supplier,
  );
  assert.deepEqual(
    groups.map((g) => [g.supplier, g.suggestion?.value ?? null, g.ids, g.total]),
    [
      ["Sütaş", null, [2, 3], 250],
      // Eşit sayıda en yeni faturası olan önce
      ["Muhasebe", INVOICE_SHARED, [4], 1000],
      ["Sütaş", "tuzla", [1], 100],
    ],
  );
});

test("Faturalar süzgeci: 'Şubesi seçilmemiş' durumu ve sayacı", () => {
  assert.equal(parseStatus("subesiz"), "subesiz");
  const list = [
    { unpaid: false, branchId: "tuzla", companyWide: false },
    { unpaid: true, branchId: null, companyWide: true },
    { unpaid: true, branchId: null, companyWide: false },
  ];
  assert.deepEqual(list.map((i) => matchesStatus(i, "subesiz")), [false, false, true]);
  assert.equal(statusCounts(list).unassigned, 1);
});

// ---------------------------------------------------------------- Gelir-gider: şubenin faturası şubenin giderinde
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const excel: Dataset = excelToDataset(data);
const sarf: ExpenseCategory = { id: 1, name: "Sarf malzemesi", section: "genel", panelGroup: "diger", invoiceCategory: "Hizmet", monthly: false, active: true, sortOrder: 1 };
const invoice = (id: number, amount: number, branch: string | null, companyWide = false): Invoice =>
  ({ id, date: "2026-11-15", supplier: `T${id}`, description: null, invoiceNo: null, category: "Hizmet", amount, discount: 0, payable: amount * 1.2, vat: amount * 0.2, unpaid: false, note: null, branchId: branch, companyWide }) as Invoice;
const invoices = [invoice(1, 1_000, "tuzla"), invoice(2, 3_000, "marina"), invoice(3, 500, null, true)];
const m = (month: string, posRevenue: number): Month => ({ month, openDays: 30, posRevenue, discounts: 0, offRevenue: 0, note: null });
const common: Dataset = { ...excel, currentMonth: "2027-01", salesLines: [], stockCounts: [], expenseCategories: [sarf], expenseEntries: [], pnlEntries: [], staff: [], fixedExpenses: [], months: [] };

test("Gelir-gider: şubenin faturası şubenin giderinde, işletme geneli bilgi satırında; Tümü kırılımı şube sütununa yazar, toplam aynı", () => {
  const allMonths = [{ ...m("2026-11", 300_000), byBranch: { tuzla: m("2026-11", 200_000), marina: m("2026-11", 100_000) } }];
  const all = createModel({ ...common, invoices, months: allMonths }).pnlMonth("2026-11");
  // dataset.ts'in süzmesi: Marina'da Marina'nın ve işletme genelinin faturası
  const marina = createModel({
    ...common,
    invoices: invoices.filter((i) => invoiceInScope(i, "marina")),
    months: [m("2026-11", 100_000)],
    branchView: { id: "marina", name: "Marina", kind: "fiziksel" },
    companyMonths: allMonths,
  }).pnlMonth("2026-11");
  // Tümü: hücre bütün faturalar (toplam değişmedi), şube kırılımı faturanın şubesine
  assert.equal(all.cells.get("expense:1")!.value, 4_500);
  assert.equal(all.byBranch.tuzla, 1_000);
  assert.equal(all.byBranch.marina, 3_000);
  close(all.shared.parts.find((p) => p.key === "expense:1")!.amount, 500, "Tümü'nün işletme geneli: yalnız bilinçli işletme geneli fatura");
  // Marina: kendi faturası kârında, işletme geneli bilgi satırında
  assert.equal(marina.cells.get("expense:1")!.value, 3_000);
  close(marina.shared.parts.find((p) => p.key === "expense:1")!.amount, 500, "Marina'nın bilgi satırı");
  // Şube kayıtları olmayan veri (Excel, eski testler): fatura işletme geneli kalır (önceki kural)
  const legacy = createModel({ ...common, invoices: invoices.map((i) => ({ ...i, branchId: undefined, companyWide: undefined })), months: allMonths }).pnlMonth("2026-11");
  assert.equal(legacy.cells.get("expense:1")!.value, 4_500);
  assert.equal(legacy.byBranch.tuzla ?? 0, 0);
});

test("tahmini stok: 'Marina'ya gelen faturalar' faturanın kendi şubesi (stock_receipts kalktı, geçiş seçimi taşıdı)", () => {
  assert.doesNotMatch(read("src/server/db/schema.ts"), /stockReceipts|stock_receipts/);
  const veri = read("drizzle/0088_fatura_sube_veri.sql");
  assert.match(veri, /UPDATE "invoices" AS i\s+SET "branch_id" = r\."branch_id"\s+FROM "stock_receipts" AS r/);
  assert.match(veri, /i\."branch_id" IS NULL\s+AND i\."company_wide" = false/, "şubesi seçilmiş faturaya dokunmaz");
  assert.match(read("drizzle/0089_stok_fatura_subesi_kaldir.sql"), /DROP TABLE "stock_receipts"/);
  // Ekranın seçimi faturanın şubesini yazar
  assert.match(read("src/app/panel/sayim/tahmini/receipt-choice.tsx"), /setInvoiceBranch\(\{ ids: \[invoiceId\]/);
});
