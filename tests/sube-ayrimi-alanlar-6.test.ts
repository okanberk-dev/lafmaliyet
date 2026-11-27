// Şube ayrımı parça 6 (docs/SUBE.md › Şube ayrımı › Şubeleri yan yana, İşletme geneli giderler, dışa aktarım): saf
// kurallar, motorun "Yalnız not" kipi, dışa aktarımın sekmeleri ve kaynağın biçimi. Veritabanındaki sınama:
// tests/sube-ayrimi-alanlar-6-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-ayrimi-alanlar-6.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type ExcelJS from "exceljs";

import { buildWorkbook, exportScopeText, GUIDE_SHEET, TAX_SHEET, type CariExportRow, type ExportExtras } from "../src/app/api/export/workbook";
import { packageHref } from "../src/app/panel/muhasebe/package-download";
import {
  ALWAYS_COMPANY_WIDE,
  compareBranchesIn,
  compareEmptyText,
  COMPANY_WIDE_READS,
  effectiveView,
  SHARED_COSTS_NOTE,
  sharedCostsHidden,
  siteWideBadge,
  VIEW_AREAS,
  viewChipText,
} from "../src/lib/branch-view";
import { ALL_BRANCHES, branchPnlEntry, branchViewNote } from "../src/lib/branches";
import { createModel, SHARED_KEY } from "../src/lib/calc/engine";
import { breakEvenOf, dashboard } from "../src/lib/calc/insights";
import type { Dataset, ExpenseCategory, ExpenseEntry, FixedExpense } from "../src/lib/calc/types";
import { packageFileName } from "../src/lib/muhasebe/paket";
import { digestPreviewGroup, previewGroupText, weeklyPreviewNote } from "../src/lib/notify-recipients";
import { taxViewInputFromModel, type TaxInputs } from "../src/lib/tax/inputs";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { buildTaxView } from "../src/lib/tax/view";
import { datasetFromSeed, investmentSeed, type SeedData } from "./fixtures/baslangic";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const TILLS = [
  { id: "tuzla", name: "Tuzla", kind: "fiziksel" },
  { id: "marina", name: "Marina", kind: "fiziksel" },
];
const KNOWN = [...TILLS, { id: "online", name: "laffogato.net", kind: "online" }];

// ---------------------------------------------------------------- Saf kurallar

test("Şubeleri yan yana: Yan yana kipinde ve Tümü'de bütün şubeler, Yalnız seçili şube kipinde seçim; kanal seçiliyse boş", () => {
  assert.deepEqual(
    compareBranchesIn(TILLS, ALL_BRANCHES).map((b) => b.id),
    ["tuzla", "marina"],
  );
  assert.deepEqual(
    compareBranchesIn(TILLS, "marina").map((b) => b.id),
    ["marina"],
  );
  assert.deepEqual(compareBranchesIn(TILLS, "online"), [], "online kanalın kasası yok");
  // Boş hâl: kanal seçiliyken kanalın metni, öteki hâlde "Açık şube yok"
  assert.match(compareEmptyText("online", KNOWN).title, /^laffogato\.net seçili: kanalın kasası yok$/);
  assert.equal(compareEmptyText(ALL_BRANCHES, KNOWN).title, "Açık şube yok");
  assert.equal(compareEmptyText("marina", KNOWN).title, "Açık şube yok");
  // Yöneticinin varsayılanı "Yalnız seçili şube", seçenek adları alanın kendi adları
  assert.equal(effectiveView("karsilastirma", "admin", false, {}), "sube");
  assert.deepEqual(viewChipText("karsilastirma", "sube", "Marina"), { title: "Marina görünümü", switchLabel: "Şubeleri yan yana göster", switchTo: "firma", firmOnly: null });
});

test("İşletme geneli giderler: Yalnız not yöneticinin varsayılanı, muhasebecinin Tutarla göster; Tümü'de gizlenecek bir şey yok", () => {
  assert.equal(effectiveView("ortak_gider", "admin", false, {}), "sube");
  assert.equal(effectiveView("ortak_gider", "accountant", false, {}), "firma");
  assert.equal(sharedCostsHidden(true, "sube"), true);
  assert.equal(sharedCostsHidden(true, "firma"), false);
  assert.equal(sharedCostsHidden(false, "sube"), false, "Tümü");
  assert.equal(SHARED_COSTS_NOTE, "İşletme geneli giderler bu şubenin kârına girmez (Tümü'de sayılır)");
  assert.deepEqual(VIEW_AREAS.ortak_gider.screens, ["/panel/gelir-gider", "/panel/harcamalar", "/panel/giderler"]);
  // Şube görünümünün notu kipe göre: "Yalnız not"ta tutar yok, "Tutarla göster"de bilgi satırı
  const noted = branchViewNote({ name: "Marina", kind: "fiziksel" }, { sharedHidden: true });
  assert.match(noted.title, /işletme geneli giderler yalnız not$/);
  assert.match(noted.text, /tutarı burada yazılmaz; Tümü'de bir kez sayılır/);
  assert.doesNotMatch(noted.text, /İşletme geneli payı \(bilgi\)" satırında/);
  assert.match(branchViewNote({ name: "Marina", kind: "fiziksel" }).text, /"İşletme geneli payı \(bilgi\)" satırında toplamı görünür/);
});

test("site şubesiz: tek şube seçili ve birden çok şube açıkken Bütün şubeler; e-posta önizlemesinin grubu", () => {
  assert.equal(siteWideBadge("marina", 2), "Bütün şubeler");
  assert.equal(siteWideBadge(ALL_BRANCHES, 2), null);
  assert.equal(siteWideBadge("marina", 1), null, "tek şube açıkken rozet yok");
  assert.ok(ALWAYS_COMPANY_WIDE.some((x) => /Tükendi/.test(x.title)));
  // Sabah e-postasının önizlemesi: birden çok kasa açıkken seçili kasanın grubu, değilse firmaya giden
  assert.equal(digestPreviewGroup("marina", TILLS)?.id, "marina");
  assert.equal(digestPreviewGroup(ALL_BRANCHES, TILLS), null);
  assert.equal(digestPreviewGroup("online", TILLS), null, "kanalın alıcı grubu yok");
  assert.equal(digestPreviewGroup("marina", [TILLS[1]]), null, "tek kasa: firmaya giden e-posta");
  assert.match(previewGroupText("Marina"), /^Marina şubesine bağlı alıcıların e-postası/);
  assert.match(previewGroupText(null), /^Firmaya giden e-posta \(bütün şubeler\)/);
  assert.match(weeklyPreviewNote("Marina")!, /Haftalık özet şube şube gitmez: firmaya giden e-posta/);
  assert.equal(weeklyPreviewNote(null), null);
});

test("muhasebeci paketi: şubenin paketinin adı ve indirme adresi; e-posta bütün şubeler", () => {
  assert.equal(packageFileName("2026-10"), "laffogato-muhasebe-2026-10.xlsx");
  assert.equal(packageFileName("2026-10", "marina"), "laffogato-muhasebe-2026-10-marina.xlsx");
  assert.equal(packageHref("2026-10", null), "/api/muhasebe/paket?ay=2026-10");
  assert.equal(packageHref("2026-10", "marina"), "/api/muhasebe/paket?ay=2026-10&sube=marina");
  const paket = read("src/server/muhasebe/paket.ts");
  // Aylık e-posta "Tümü"yle, kayıtlı işaretiyle
  assert.match(paket, /\/\/ şube-ayrımı: muhasebe\.paket-eposta\n\s+const \[file, notify\] = await Promise\.all\(\[withBranchScope\(ALL_BRANCHES, \(\) => packageFile\(month, now\)\)/);
  // Şubenin paketi: kasa raporları şubenin, faturalar ve harcamalar İşletme geneli giderler alanının kipiyle
  assert.match(paket, /branchWhere\(s\.cashReports\.branchId, scope\)/);
  assert.match(paket, /sharedShown \? invoiceScopeWhere\(scope\) : branchWhere\(s\.invoices\.branchId, scope\)/);
  assert.match(paket, /sharedShown \? branchWhereWithShared\(s\.expenseEntries\.branchId, scope\) : branchWhere\(s\.expenseEntries\.branchId, scope\)/);
  assert.match(read("src/app/api/muhasebe/paket/route.ts"), /const scope = rawBranch \? parseBranchScope\(rawBranch, await listBranches\(\)\) : ALL_BRANCHES;/);
});

// ---------------------------------------------------------------- Motor: "Yalnız not"

const seed = datasetFromSeed(data);
const fixed: FixedExpense[] = [
  ...seed.fixedExpenses.map((f) => ({ ...f, branchId: null })),
  { ...seed.fixedExpenses[0], id: 900, name: "Marina güvenlik", section: "faturalar" as const, amount: 2_500, branchId: "marina", officialAmount: null, prorate: true, sortOrder: 90 },
];
const reklam: ExpenseCategory = { id: 1, name: "Reklam", section: "genel", panelGroup: "reklam", invoiceCategory: null, monthly: false, active: true, sortOrder: 1 };
const entries: ExpenseEntry[] = [
  { id: 1, date: "2026-10-10", categoryId: 1, description: "Marina afiş", amount: 3_000, paymentMethod: null, note: null, branchId: "marina" },
  { id: 2, date: "2026-10-11", categoryId: 1, description: "Ortak reklam", amount: 4_000, paymentMethod: null, note: null, branchId: null },
];
/** Marina'nın görünümü (dataset.ts'in süzmesi): "Yalnız not"ta işletme geneli sabit gider kalemi gelmez, bayrak var */
function marina(hidden: boolean): Dataset {
  const inScope = fixed.filter((f) => (f.branchId === null ? !hidden : f.branchId === "marina"));
  const ids = new Set(inScope.map((f) => f.id));
  const allIds = new Set(fixed.map((f) => f.id));
  const pnl = [
    { month: "2026-10", rowKey: "manual:harici", amount: 1_500, note: null },
    { month: "2026-10", rowKey: `fixed:${fixed[0].id}`, amount: 777, note: null },
  ];
  return {
    ...seed,
    currentMonth: "2026-11",
    branchView: { id: "marina", name: "Marina", kind: "fiziksel" },
    months: [{ month: "2026-10", openDays: 31, posRevenue: 150_000, discounts: 0, offRevenue: 0, note: null }],
    salesLines: [],
    stockCounts: [],
    staff: [],
    invoices: [],
    fixedExpenses: inScope,
    expenseCategories: [reklam],
    expenseEntries: entries,
    pnlEntries: pnl.filter((e) => branchPnlEntry(e.rowKey, ids, allIds)),
    ...(hidden ? { sharedCostsHidden: true } : {}),
  };
}

test("motor: Yalnız not kipinde işletme geneli tutarı, bileşimi, bilgi satırı ve standart sabit giderin işletme geneli kısmı yok; kâr aynı", () => {
  const shown = createModel(marina(false));
  const noted = createModel(marina(true));
  const a = shown.pnlMonth("2026-10");
  const b = noted.pnlMonth("2026-10");
  assert.ok(a.shared.total > 4_000, "Tutarla göster: işletme geneli sabit giderler, elle hücre ve şubesiz harcama");
  assert.deepEqual([b.shared.total, b.shared.parts, b.shared.hidden], [0, [], true]);
  close(b.profit, a.profit, "şubenin kârı");
  close(b.expenses, a.expenses, "şubenin giderleri");
  assert.equal(b.cells.get("expense:1")?.value, 3_000, "harcama hücresi şubenin kendi kaydı");
  assert.ok(shown.pnlRowDefs(["2026-10"]).some((r) => r.key === SHARED_KEY));
  assert.equal(noted.pnlRowDefs(["2026-10"]).some((r) => r.key === SHARED_KEY), false, "bilgi satırı yok");
  assert.ok(shown.fixedStandardSharedFor("2026-10") > 0);
  assert.equal(noted.fixedStandardSharedFor("2026-10"), 0);
  assert.equal(noted.fixedList.some((f) => (f.branchId ?? null) === null), false, "işletme geneli kalem listede yok");
  // Genel bakış: sabit gider dökümü ve başabaş tutar yerine not
  const d = dashboard(noted, "2026-10");
  assert.equal(d.fixedMonth.sharedHidden, true);
  assert.equal(d.fixedMonth.shared, 0);
  assert.equal(dashboard(shown, "2026-10").fixedMonth.sharedHidden, false);
  assert.ok(dashboard(shown, "2026-10").fixedMonth.shared > 0);
  assert.equal(breakEvenOf(noted, "2026-10").sharedHidden, true);
  assert.equal(breakEvenOf(noted, "2026-10").shared, 0);
  // "Tümü"de bayrak olsa da anlamsız: şube görünümü yoksa işletme geneli bölümlerinde
  const all = createModel({ ...marina(true), branchView: null, fixedExpenses: fixed });
  assert.equal(all.pnlMonth("2026-10").shared.hidden, undefined);
});

// ---------------------------------------------------------------- Dışa aktarım

const model = createModel({ ...datasetFromSeed(data), currentMonth: "2026-10" });
const cari: CariExportRow[] = [
  { date: "2026-09-20", supplier: "Sütaş", movement: "Faturasız alım (faturası gelecek) · İşletme geneli", description: "süt", debt: 1250, payment: null, method: null, counted: null, invoice: null, note: null },
];
const extras = (over: Partial<ExportExtras> = {}): ExportExtras => ({
  investments: data.investments.map(investmentSeed),
  findings: [{ section: "Fiyat", title: "Bulgu 1", detail: null, resolved: false }],
  now: new Date("2026-10-20T10:00:00Z"),
  cari,
  ...over,
});
const cellsOf = (ws: ExcelJS.Worksheet) => {
  const out: string[] = [];
  ws.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? ""))));
  return out.join("\n");
};

test("dışa aktarım: kapsam satırı alanların kipini yazar; Tümü dosyası bugünkü gibi", () => {
  assert.match(exportScopeText(undefined), /^Tümü: bütün şubeler/);
  const sube = exportScopeText({ label: "Marina", branch: true, areas: { tutarlilik: "sube", tedarikciler: "sube", sharedHidden: true } });
  assert.match(sube, /^Marina şubesi: satış, kasa, personel/);
  assert.match(sube, /tutarları bu dosyada yok/);
  assert.match(sube, /Tutarlılık Marina şubesinin/);
  assert.match(sube, /Cari hareketleri: Marina şubesinin ödemeleri; faturasız borç İşletme geneli/);
  // Vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026): her kipte firmanın, şubenin payı yok
  assert.match(sube, /Vergi firma geneli: vergi beyanı firmanın tek vergi numarasıyla, şubeye bölünmez\./);
  assert.doesNotMatch(sube, /şubenin payı/);
  assert.match(sube, /Tutarlılık bulguları ve Alım Miktarları firma geneli/);
  const firma = exportScopeText({ label: "Marina", branch: true, areas: { tutarlilik: "firma", tedarikciler: "firma", sharedHidden: false } });
  assert.match(firma, /"İşletme geneli payı" olarak bilgi/);
  assert.match(firma, /Tutarlılık firma geneli\. Cari hareketleri firma geneli\. Vergi firma geneli: vergi beyanı firmanın tek vergi numarasıyla, şubeye bölünmez\./);
});

test("dışa aktarım: şube dosyasında Tutarlılık alanın etiketiyle, Bulgular ve Alım Miktarları Firma geneli", () => {
  const wb = buildWorkbook(
    model,
    "2026-09",
    extras({
      scope: { label: "Marina", branch: true, areas: { tutarlilik: "sube", tedarikciler: "sube", sharedHidden: true } },
      consistency: { model, label: "Marina", note: "Alınan yalnız Marina şubesine seçilmiş faturalardan; 2 şubesiz fatura dahil değil." },
      tax: null,
    }),
  );
  const t = wb.worksheets.find((w) => w.name.startsWith("Tutarlılık "))!;
  assert.equal(t.getCell("A1").value, "Tutarlılık kontrolü – Eylül 2026 · Marina");
  assert.equal(t.getCell("A2").value, "Alınan yalnız Marina şubesine seçilmiş faturalardan; 2 şubesiz fatura dahil değil.");
  assert.match(cellsOf(t), /3\) BULGULAR VE NOTLAR · Firma geneli \(bulgunun şubesi yok\)/);
  assert.match(String(wb.getWorksheet("Alım Miktarları")!.getRow(1).getCell(3).note ?? ""), /Firma geneli/);
  // Kapak: Alım Miktarları'nın satırı firma geneli der
  assert.match(cellsOf(wb.getWorksheet(GUIDE_SHEET)!), /alınan miktarlar\. Firma geneli \(şubesi yok\)\./);
  // Cari: hareket sütununun notu şubenin kuralını yazar
  const c = wb.getWorksheet("Cari hareketleri")!;
  assert.match(String(c.getRow(1).getCell(3).note ?? ""), /^Marina şubesi: şubenin kasasından yapılan ödemeler/);
  // "Tümü" dosyasında etiket yok
  const all = buildWorkbook(model, "2026-09", extras());
  const ta = all.worksheets.find((w) => w.name.startsWith("Tutarlılık "))!;
  assert.equal(ta.getCell("A1").value, "Tutarlılık kontrolü – Eylül 2026");
  assert.match(cellsOf(ta), /3\) BULGULAR VE NOTLAR\n/);
  assert.equal(all.getWorksheet("Alım Miktarları")!.getRow(1).getCell(3).note, undefined);
  assert.equal(all.getWorksheet("Cari hareketleri")!.getRow(1).getCell(3).note, undefined);
});

test("dışa aktarım: Vergi sekmesi şube dosyasında da firmanın (Firma geneli · beyan), şubenin payı yok; rakamlar Tümü dosyasıyla aynı", () => {
  // Vergi sekmesinin girdisi (tests/vergi-kaynak.test.ts'teki gibi Vergi sayfasının görünümü)
  const inputs: TaxInputs = { settings: DEFAULT_TAX_SETTINGS, filings: [], adjustments: [], assets: [], zMonths: new Map(), invoicedCashOuts: new Set(), vatPaid: [] };
  const view = buildTaxView(taxViewInputFromModel(model, inputs, { today: "2026-10-20", year: 2026, quarter: "2026-Q3" }));
  const tax = { view, settings: DEFAULT_TAX_SETTINGS };
  const wb = buildWorkbook(model, "2026-09", extras({ tax, scope: { label: "Marina", branch: true } }));
  const text = cellsOf(wb.getWorksheet(TAX_SHEET)!);
  assert.match(text, /Firma geneli · beyan: bütün şubelerin satışı, faturaları ve giderleri \(tek vergi numarası; vergi şubeye bölünmez\)\./);
  assert.doesNotMatch(text, /ŞUBENİN PAYI|Şubeye seçilmiş faturaların KDV'si|^6\. /m);
  const all = cellsOf(buildWorkbook(model, "2026-09", extras({ tax })).getWorksheet(TAX_SHEET)!);
  assert.doesNotMatch(all, /Firma geneli · beyan/);
  assert.doesNotMatch(all, /ŞUBENİN PAYI/);
  // Şube dosyasının Vergi sekmesi Tümü dosyasınınkinden yalnız "Firma geneli · beyan" satırıyla ayrılır
  assert.equal(text.replace(/\nFirma geneli · beyan:[^\n]*/, ""), all);
});

// ---------------------------------------------------------------- Kaynak

test("kaynak: üç yükleyici Şubeleri yan yana alanının kapsamıyla; raporlar çipi çizer, firma geneli notu kalktı", () => {
  for (const f of ["src/server/data/sube-karsilastirma.ts", "src/server/data/iscilik.ts"]) {
    const src = read(f);
    assert.match(src, /\/\/ şube-ayrımı: alan\.karsilastirma\n\s+const compareScope = await areaScope\("karsilastirma"\);/, f);
    assert.match(src, /compareBranchesIn\(tillBranches\(all\), compareScope\)/, f);
    assert.match(src, /withBranchScope\(compareScope, \(\) => tillRows\(db\)\)/, f);
    assert.match(src, /branchWhere\(s\.cashReports\.branchId, compareScope\)/, f);
    assert.doesNotMatch(src, /withBranchScope\(ALL_BRANCHES/, f);
  }
  const day = read("src/server/data/branch-day.ts");
  assert.match(day, /areaScope\("karsilastirma"\)/);
  assert.match(day, /branchWhere\(s\.posDayReports\.branchId, compareScope\)/);
  for (const f of ["src/app/panel/raporlar/page.tsx", "src/app/panel/raporlar/iscilik/page.tsx"]) {
    assert.match(read(f), /<BranchViewChip area="karsilastirma"/, f);
    assert.doesNotMatch(read(f), /CompanyWideNotice/, f);
  }
  // Kayıt: alanın tek kaydı üç yükleyiciyi taşır, bekleyenler kapandı
  const r = COMPANY_WIDE_READS.find((x) => x.id === "alan.karsilastirma");
  assert.ok(r && r.kind === "alan" && r.area === "karsilastirma");
  assert.equal(COMPANY_WIDE_READS.filter((x) => x.id.startsWith("karsilastirma.")).length, 0);
});

test("kaynak: İşletme geneli giderler veri kümesinin bayrağı; ekranları çipi çizer ve Yalnız not'ta tutar yazmaz", () => {
  const ds = read("src/server/data/dataset.ts");
  assert.match(ds, /currentBranchView\("ortak_gider"\)/);
  assert.match(ds, /const sharedHidden = sharedCostsHidden\(branch !== null, sharedMode\);/);
  assert.match(ds, /\.\.\.\(sharedHidden \? \{ sharedCostsHidden: true \} : \{\}\)/);
  for (const f of ["src/app/panel/gelir-gider/page.tsx", "src/app/panel/harcamalar/page.tsx", "src/app/panel/giderler/page.tsx"]) assert.match(read(f), /<BranchViewChip area="ortak_gider"/, f);
  const harcama = read("src/app/panel/harcamalar/page.tsx");
  assert.match(harcama, /!\(sharedHidden && \(e\.branchId \?\? null\) === null\)/, "işletme geneli kayıt listede yok");
  assert.match(harcama, /sharedTotal: branchView && !sharedHidden \?/);
  const gider = read("src/app/panel/giderler/page.tsx");
  assert.match(gider, /const shownInvestments = sharedHidden \? investments\.filter\(\(i\) => i\.branchId !== null\) : investments;/);
  assert.match(read("src/app/panel/dashboard-fixed.tsx"), /f\.sharedHidden \? ` \$\{SHARED_COSTS_NOTE\}\.`/);
  // Dışa aktarım işletme geneli yatırımı da aynı kuralla düşürür
  assert.match(read("src/app/api/export/route.ts"), /investments: sharedHidden \? investments\.filter\(\(i\) => i\.branchId !== null\) : investments,/);
});

test("kaynak: dışa aktarımın sekmeleri alanlarının kipiyle; Ayarlar'ın düğmesi şubenin dosyası; Siparişler'in rozeti", () => {
  const route = read("src/app/api/export/route.ts");
  for (const [area, id] of [
    ["tedarikciler", "alan.tedarikciler"],
    ["tutarlilik", "alan.tutarlilik"],
  ] as const) {
    assert.match(route, new RegExp(`// şube-ayrımı: ${id.replace(".", "\\.")}\\n\\s+const \\w+ = await areaScope\\("${area}"\\);`), area);
  }
  assert.match(route, /loadCariExport\(cariScope\)/);
  // Vergi şubeye bölünmez: Vergi sekmesi her dosyada "Tümü"yle, şubenin payı yok
  assert.match(route, /\/\/ şube-ayrımı: vergi\.beyan\n\s+const tax = await withBranchScope\(ALL_BRANCHES, async \(\) => loadTaxView\(/);
  assert.doesNotMatch(route, /areaScope\("vergi"\)|loadBranchTaxView|taxShare|alan\.vergi/);
  assert.match(route, /const consistency = whole \? undefined : await consistencyOf\(consistencyScope, model, month, branches\);/);
  assert.match(read("src/app/panel/ayarlar/page.tsx"), /Dışa aktar · \{exportBranch\.name\} \(\.xlsx\)/);
  const page = read("src/app/panel/siparisler/page.tsx");
  assert.match(page, /const siteWide = siteWideBadge\(view\.scope, view\.branches\.filter\(\(b\) => b\.active\)\.length\);/);
  assert.match(page, /siteWide=\{siteWide\} \/>/);
  assert.match(read("src/app/panel/siparisler/orders-board.tsx"), /<TableCalls calls=\{calls\} now=\{now\} siteWide=\{siteWide\} \/>/);
});
