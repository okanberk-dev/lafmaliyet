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
import { ALL_BRANCHES, companyWideNote, mcpBranchScope, requestInScope } from "../src/lib/branches";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset, ExpenseCategory, ExpenseEntry, Invoice } from "../src/lib/calc/types";
import { branchesClosed, digestGroups, digestItemInGroup } from "../src/lib/notify-recipients";
import { soldOutAllBranchesText } from "../src/lib/site-menu/sold-out";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

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
  const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
  const excel = datasetFromSeed(data);
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
  assert.match(read("src/app/panel/onaylar/kasa-section.tsx"), /loadCashRequestQueue\(undefined, await currentBranchScope\(\), me\.role !== "admin"\)/);
  assert.match(read("src/app/panel/onaylar/karaoke-section.tsx"), /if \(!\(await featureHere\("karaoke", await currentBranchScope\(\)\)\)\) return null;/);
  const kasa = read("src/server/bell/kasa.ts");
  assert.match(kasa, /pendingCashBellRows\(scope\),\s+cashOutBellRow\(now, scope\),\s+pendingClosedRows\(scope\),/);
  const ops = read("src/server/bell/ops.ts");
  assert.match(ops, /pendingWasteSummary\(\{ scope: await currentBranchScope\(\) \}\)/);
  assert.match(ops, /if \(!featureInScope\("karaoke", await currentBranchScope\(\), await listBranches\(\)\)\) return \[\];/);
});

test("kaynak: kasa ve sayım 'Tümü'de birden çok kasa açıkken formdan önce şubeyi sorar", () => {
  const kasa = read("src/app/panel/kasa/page.tsx");
  const at = kasa.indexOf("if (many && !tills.some((b) => b.id === scope)) {");
  // CashContent içinde: soru, formun kasasını (currentTillBranch) okumadan önce
  const fn = kasa.indexOf("async function CashContent(");
  assert.ok(fn > 0 && at > fn && at < kasa.indexOf("const till = await currentTillBranch();", fn), "kasa: soru formdan önce");
  assert.match(kasa, /title="Hangi şubenin kasası\?"/);
  const sayim = read("src/app/panel/sayim/page.tsx");
  assert.ok(sayim.indexOf("if (tills.length > 1 && !tills.some((b) => b.id === scope)) {") < sayim.indexOf("const model = await loadModel({ scope: branch.id });"), "sayım: soru modelden önce");
  assert.match(sayim, /title="Hangi şubeyi sayıyorsunuz\?"/);
});

test("kaynak: Satışlar'ın ay bilgisi 'Tümü'de birden çok kasa açıkken şubeyi sorar (Gelir-gider gibi Tuzla'ya yazmaz)", () => {
  const page = read("src/app/panel/satislar/page.tsx");
  const ask = page.indexOf("{model.ds.monthTotalsLocked && tills.length > 1 ? (");
  assert.ok(ask > 0 && ask < page.indexOf("<MonthInfoForm"), "soru formdan önce");
  assert.match(page, /title="Hangi şubenin ay bilgisi\?"/);
  // Ayı temizle onayı sunucunun denetlediği sayıyı gösterir
  assert.match(read("src/app/panel/satislar/sales-client.tsx"), /\{num\(clearCount\)\} \{lafpos \? "ModPOS" : "satış"\} satırı silinecek\./);
});

test("kaynak: Dışa aktar düğmesi ekranın şubesini gönderir; dosya kapsamı yazar, Vergi ve Cari firma geneli", () => {
  assert.match(read("src/app/panel/page.tsx"), /href=\{`\/api\/export\?ay=\$\{month\}&\$\{BRANCH_PARAM\}=\$\{encodeURIComponent\(scope\)\}`\}/);
  const route = read("src/app/api/export/route.ts");
  assert.match(route, /const scope = raw \? parseBranchScope\(raw, await listBranches\(\)\) : ALL_BRANCHES;/);
  assert.match(route, /withBranchScope\(ALL_BRANCHES, \(\) => loadCariExport\(\)\)/);
  // Kapak "Kapsam" satırı ve sayfaların üst bilgisi (davranışı tests/export-bicim.test.ts sınar)
  const wbSrc = read("src/app/api/export/workbook.ts");
  assert.match(wbSrc, /scope\?\.branch\s*\? `\$\{scope\.label\} şubesi: /);
  assert.match(wbSrc, /const period = `\$\{label\} · \$\{extras\.scope\?\.label \?\? "Tümü"\}`;/);
  // Ayarlar'daki tam yedek seçicisiz ("Tümü")
  assert.match(read("src/app/panel/ayarlar/page.tsx"), /<a href="\/api\/export" download/);
});

test("sabah e-postası alıcı grupları: şubesiz ve bütün kasaları seçen adres tek e-posta; şubeye bağlı adres ayrı", () => {
  const tills = [{ id: "tuzla" }, { id: "marina" }];
  const groups = digestGroups(
    [
      { email: "patron@x", branchIds: [] },
      { email: "ikisi@x", branchIds: ["marina", "tuzla"] },
      { email: "marina@x", branchIds: ["marina"] },
      { email: "tuzla@x", branchIds: ["tuzla"] },
      { email: "kapali@x", branchIds: ["eski"] },
      { email: "marina2@x", branchIds: ["marina", "eski"] },
    ],
    tills,
  );
  assert.deepEqual(groups, [
    { branchIds: [], emails: ["patron@x", "ikisi@x"] },
    { branchIds: ["tuzla"], emails: ["tuzla@x"] },
    { branchIds: ["marina"], emails: ["marina@x", "marina2@x"] },
  ]);
  // Şubesi kapanan "Yalnız X" adresi bütün şubelerin e-postasına genişlemez, hiçbir gruba girmez
  assert.equal(branchesClosed(["eski"], tills), true);
  assert.equal(branchesClosed(["marina", "eski"], tills), false);
  assert.equal(branchesClosed([], tills), false);
  // Ödeme kalemi: şubenin ve işletme genelinin; bütün şubelerde hepsi
  assert.equal(digestItemInGroup("tuzla", ["marina"]), false, "Marina'nın e-postasına Tuzla'nın kirası girmez");
  assert.equal(digestItemInGroup(null, ["marina"]), true);
  assert.equal(digestItemInGroup("marina", ["marina"]), true);
  assert.equal(digestItemInGroup("tuzla", []), true);
});

test("sabah e-postası şubenin başlığıyla: konu şubenin adıyla başlar, gövde kapsamı söyler; şubesiz e-posta değişmez", async () => {
  const { renderDigest, branchDigestNote } = await import("../src/server/notify/digest-template");
  const plain = renderDigest([], "2026-11-24");
  const marina = renderDigest([], "2026-11-24", null, null, null, null, "Marina");
  assert.equal(marina.subject, `Marina: ${plain.subject}`);
  assert.ok(marina.html.includes("Günlük sabah özeti · Marina"));
  assert.ok(marina.html.includes(branchDigestNote("Marina")));
  assert.ok(marina.text.includes(branchDigestNote("Marina")));
  assert.deepEqual(renderDigest([], "2026-11-24", null, null, null, null, null), plain, "şube yoksa birebir aynı");
});

test("firma geneli ekranların notu: tek şube seçiliyken söylenir, Tümü'de yok", () => {
  const known = [
    { id: "tuzla", name: "Tuzla", kind: "fiziksel" as const, posSource: "modpos" as const, active: true, openedOn: null, sortOrder: 1 },
    { id: "marina", name: "Marina", kind: "fiziksel" as const, posSource: "lafpos" as const, active: true, openedOn: null, sortOrder: 2 },
  ];
  assert.equal(companyWideNote("vergi", ALL_BRANCHES, known), null);
  const note = companyWideNote("tedarikciler", "marina", known);
  assert.equal(note?.title, "Marina seçili: bu ekran firma geneli");
  assert.match(note!.text, /cari hesabı firmanındır/);
  // Faturalar firma geneli değil (25 Kasım 2026, docs/SUBE.md › Faturanın şubesi): seçili şubenin faturaları
  assert.doesNotMatch(read("src/app/panel/faturalar/page.tsx"), /<CompanyWideNotice/);
  // Ekranlar notu çizer (şube kapsamı C P1-12, P2-1)
  for (const [file, screen] of [
    ["src/app/panel/vergi/page.tsx", "vergi"],
    ["src/app/panel/tedarikciler/page.tsx", "tedarikciler"],
    ["src/app/panel/tutarlilik/page.tsx", "tutarlilik"],
  ] as const)
    assert.match(read(file), new RegExp(`<CompanyWideNotice screen="${screen}"`), file);
  assert.match(read("src/app/panel/hatirlaticilar/nakit/page.tsx"), /companyWideNote\("nakit", scope, branches\)/);
});

test("Claude araçlarının `sube` girdisi: ad ya da kimlik, 'hepsi'; kapalı ve bilinmeyen şube seçenekleriyle reddedilir", () => {
  const known = [
    { id: "tuzla", name: "Tuzla", kind: "fiziksel" as const, posSource: "modpos" as const, active: true, openedOn: null, sortOrder: 1 },
    { id: "marina", name: "Marina", kind: "fiziksel" as const, posSource: "lafpos" as const, active: true, openedOn: null, sortOrder: 2 },
    { id: "eski", name: "Eski", kind: "fiziksel" as const, posSource: "modpos" as const, active: false, openedOn: null, sortOrder: 9 },
  ];
  assert.deepEqual(mcpBranchScope("Marina", known), { scope: "marina" });
  assert.deepEqual(mcpBranchScope(" tuzla ", known), { scope: "tuzla" });
  assert.deepEqual(mcpBranchScope("TÜMÜ", known), { scope: ALL_BRANCHES });
  assert.deepEqual(mcpBranchScope("hepsi", known), { scope: ALL_BRANCHES });
  assert.deepEqual(mcpBranchScope("Eski", known), { error: 'Şube bulunamadı: "Eski". Seçenekler: Tuzla, Marina, hepsi' });
  const tools = read("src/server/mcp/tools.ts");
  // Satış, kasa ve ödemeler şubeyle; tedarikçi ve arama firma geneli
  assert.equal((tools.match(/scoped\((?:args\.)?sube, async \(\) => \{/g) ?? []).length, 5);
  assert.equal((tools.match(/kapsam: COMPANY_WIDE/g) ?? []).length, 2);
  assert.match(tools, /if \(lock !== null && scope !== lock\) throw new ToolInputError/);
});
