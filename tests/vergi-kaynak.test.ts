// Vergi ekranlarının bekçileri (plan docs/planlar/vergi.md §4, §11-I, K30; docs/VERGI.md): dört sayfa yöneticiyi
// kendisi denetler, yükleme dosyası yok, Kurallar modeli ve nakit planını okumaz, Vergiye göre ve Demirbaş nakit planını
// okumaz, her sayfada üst bant (TAX_DISCLAIMER), Segmented yok; Vergiye göre tablosunun sütunları ve toplamları
// görünümle aynı, sınıflandırma listesinin seçenekleri bölüme uygun.
// Çalıştırma: npx tsx --test tests/vergi-kaynak.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import ExcelJS from "exceljs";

import { buildWorkbook, TAX_NOT_FISCAL, TAX_SHEET, TAX_SHEET_FIRST_LINE } from "../src/app/api/export/workbook";

import { classifyData } from "../src/app/panel/vergi/gelir-gider/data";
import { quarterGrid } from "../src/app/panel/vergi/gelir-gider/grid";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import type { TaxFiling } from "../src/lib/tax/corporate";
import { taxViewInputFromModel, type TaxInputs } from "../src/lib/tax/inputs";
import { TAX_DOC_LABELS } from "../src/lib/tax/rules";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { buildTaxView } from "../src/lib/tax/view";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const DIR = "src/app/panel/vergi";

function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
  });
}

const PAGES = [`${DIR}/page.tsx`, `${DIR}/gelir-gider/page.tsx`, `${DIR}/demirbas/page.tsx`, `${DIR}/kurallar/page.tsx`];

test("dört vergi sayfası: yönetici denetimi sayfanın kendisinde, yükleme dosyası yok, Segmented yok", () => {
  const files = walk(DIR);
  assert.deepEqual(files.filter((f) => f.endsWith("/page.tsx")).sort(), [...PAGES].sort());
  for (const p of PAGES) {
    const src = read(p);
    assert.match(src, /await requireAdmin\(\);/, p);
    // Yükleme: başlık ve iskeletli Suspense (panelin kalıbı)
    assert.match(src, /<Suspense\s+fallback=\{/, p);
    assert.match(src, /<PageSkeleton/, p);
    assert.match(src, /<TaxBanner data=\{banner\} \/>/, `${p}: üst bant`);
  }
  assert.ok(!files.some((f) => /\/loading\.tsx$/.test(f)), "loading.tsx yok");
  for (const f of files) assert.doesNotMatch(read(f), /from "@\/components\/ui\/segmented"/, `${f}: Segmented kullanılmaz (§4.2)`);
  // Üst bandın metni TAX_DISCLAIMER; telefonda kısa metin ve tam metni açan ipucu
  const ui = read(`${DIR}/ui.tsx`);
  assert.match(ui, /\{TAX_DISCLAIMER\}/);
  assert.match(ui, /\{TAX_DISCLAIMER_SHORT\}/);
  assert.match(ui, /role="note"/);
});

test("sekme başına okuma (K30): Kurallar model ve nakit planı okumaz; Vergiye göre ve Demirbaş nakit planını okumaz", () => {
  const rules = read(`${DIR}/kurallar/page.tsx`);
  assert.doesNotMatch(rules, /loadModel|loadCashPlan|loadTaxView|loadTaxInputs/);
  assert.match(rules, /loadTaxSettings\(\)/);
  for (const p of [`${DIR}/gelir-gider/page.tsx`, `${DIR}/demirbas/page.tsx`]) {
    const src = read(p);
    assert.doesNotMatch(src, /loadCashPlan/, p);
    assert.match(src, /cashPlan: null/, p);
  }
  // Özet hepsini bir kez: loadTaxView nakit planını ve Ödemeler'i kendisi okur
  const ozet = read(`${DIR}/page.tsx`);
  assert.match(ozet, /loadTaxView\(model, \{ year:/);
  assert.doesNotMatch(ozet, /loadCashPlan|loadUpcoming/);
});

test("istemci dosyaları: yalnız vergi eylemlerini çağırır, sunucu yükleyicisi ve veritabanı yok", () => {
  for (const f of walk(DIR)) {
    const src = read(f);
    if (!src.startsWith('"use client"')) continue;
    for (const m of src.matchAll(/from "(@\/server\/[^"]+)"/g)) assert.equal(m[1], "@/server/actions/tax", `${f}: ${m[1]}`);
  }
  assert.ok(existsSync(join(root, `${DIR}/gelir-gider/classify-list.tsx`)));
  // Sınıflandırma: toplu kayıt yüzen çubukta, kaydedilmemiş değişiklikle çıkış uyarır
  const list = read(`${DIR}/gelir-gider/classify-list.tsx`);
  assert.match(list, /<FloatingBar open=\{dirty\.length > 0\}>/);
  assert.match(list, /useLeaveGuard\(dirty\.length > 0\)/);
  assert.match(list, /`\$\{dirty\.length\} değişikliği kaydet`/);
  assert.match(list, /Aynı gider iki kez sayılmasın diye soruyoruz: bu giderin belgesi nerede\?/);
});

// ---------------------------------------------------------------- Vergiye göre tablosu ve sınıflandırma

const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const model = createModel(ds);
const TODAY = "2026-10-28";
const inputs: TaxInputs = { settings: DEFAULT_TAX_SETTINGS, filings: [], adjustments: [], assets: [], zMonths: new Map(), invoicedCashOuts: new Set(), vatPaid: [] };
const view = buildTaxView(taxViewInputFromModel(model, inputs, { today: TODAY, year: 2026, quarter: "2026-Q3" }));

test("Vergiye göre tablosu (§4.2): çeyreğin üç ayı, çeyrek toplamı, kümülatif; toplamlar görünümle aynı", () => {
  const q = view.quarter!;
  const grid = quarterGrid(q, view.months);
  assert.deepEqual(
    grid.columns.map((c) => c.label),
    ["Temmuz", "Ağustos", "Eylül", "Çeyrek toplamı", "Kümülatif (yılbaşından)"],
  );
  assert.deepEqual(
    grid.groups.map((g) => g.label),
    ["Gelir", "Gider", "Sonuç"],
  );
  const row = (key: string) => grid.groups.flatMap((g) => g.rows).find((r) => r.key === key)!;
  assert.deepEqual(row("gelir:toplam").values, [...q.months.map((m) => m.income.total), q.totals.income, q.ytd.income]);
  assert.deepEqual(row("gider:toplam").values, [...q.months.map((m) => m.expense.total), q.totals.expense, q.ytd.expense]);
  assert.deepEqual(row("sonuc").values, [...q.months.map((m) => m.result), q.totals.result, q.ytd.result]);
  assert.equal(row("kazanc").values.at(-1), q.corp!.cumulative);
  assert.equal(row("donem").values[3], q.corp!.periodResult);
  // Satırların çeyrek sütunu ayların toplamı (çeyrek sonu stoğu ayrı satır)
  for (const g of grid.groups.filter((x) => x.key !== "sonuc")) {
    for (const r of g.rows.filter((x) => x.key !== "gider:stok" && !x.key.endsWith(":toplam"))) {
      const months = r.values.slice(0, 3).filter((v): v is number => v !== null);
      if (!months.length) continue;
      assert.ok(Math.abs((r.values[3] ?? 0) - months.reduce((a, b) => a + b, 0)) < 0.01, r.label);
    }
  }
  // Q3 2026 gelir yönetim verisinden: rozet mali belge demez (K11)
  const pos = grid.groups[0].rows.find((r) => r.key.startsWith("pos|"))!;
  assert.equal(pos.badge, "Yönetim verisi (ModPOS), mali belge değil");
  // Çeyrek sonu sayımı yok: stok satırı kırmızı ve gerekçeli
  assert.equal(q.totals.stock.counted, false);
});

test("sınıflandırma listesi (§4.2, K12): bölüme uygun belge seçenekleri, stopaj alanı, demirbaş adayları", () => {
  const c = classifyData(view, { invoices: model.ds.invoices, settings: DEFAULT_TAX_SETTINGS, choices: [], today: TODAY });
  assert.equal(c.header, view.classify.header);
  const labels = (key: string) => c.items.find((i) => i.key === key)!.options.map((o) => o.label);
  const personel = c.items.find((i) => i.source === "fixed" && i.sectionLabel === "Personel giderleri")!;
  assert.deepEqual(
    personel.options.map((o) => o.label),
    ["Seçilmedi", TAX_DOC_LABELS.bordro, "Paraşüt'te faturası var", "Dışarıdan hizmet: belgesi muhasebecide (fatura, SMM)"],
  );
  assert.equal(personel.withholdingFor, "belgeli");
  const kira = c.items.find((i) => i.name === "Kira")!;
  assert.deepEqual(labels(kira.key), ["Seçilmedi", TAX_DOC_LABELS.fatura, TAX_DOC_LABELS.belgeli, TAX_DOC_LABELS.yok]);
  assert.equal(kira.withholdingFor, "always");
  assert.equal(kira.vat, 0.2);
  for (const it of c.items.filter((i) => i.source === "category")) assert.ok(!it.options.some((o) => o.value === "bordro"), it.name);
  for (const it of c.items.filter((i) => i.source !== "fixed")) assert.equal(it.withholdingFor, null, it.name);
  // Demirbaş adayları: Aria Yazılım ve Beyza Karaman, "Gider (demirbaş değil)" seçeneğiyle
  const cand = c.items.filter((i) => i.source === "invoice");
  assert.deepEqual(
    cand.map((i) => i.name),
    ["Aria Yazılım", "Beyza Karaman"],
  );
  for (const it of cand) assert.deepEqual(it.options.map((o) => o.label), ["Seçilmedi", "Gider (demirbaş değil)"]);
  // Kuruluş & Demirbaş faturaları varlık listesinde değil
  assert.equal(c.unlisted.length, 4);
  assert.equal(c.directLimit, 12_000);
});

// ---------------------------------------------------------------- Excel "Vergi" sayfası (§9, K11, K31)

/** Sayfanın bütün hücreleri: metinler ve sayılar ayrı */
function cellsOf(ws: ExcelJS.Worksheet): { texts: string[]; numbers: number[] } {
  const texts: string[] = [];
  const numbers: number[] = [];
  ws.eachRow((r) =>
    r.eachCell((c) => {
      if (typeof c.value === "number") numbers.push(c.value);
      else if (c.value !== null && c.value !== undefined && !(c.value instanceof Date)) texts.push(String(c.value));
    }),
  );
  return { texts, numbers };
}

const EXTRAS = { investments: [], findings: [], now: new Date("2026-10-28T09:00:00Z") };

test("Excel 'Vergi' sayfası: ilk satır, yönetim verisiyle gelen ay ve çeyrek yazılmaz, sekme sırası ve rehber", () => {
  const wb = buildWorkbook(model, "2026-09", { ...EXTRAS, tax: { view, settings: DEFAULT_TAX_SETTINGS } });
  const names = wb.worksheets.map((w) => w.name);
  assert.deepEqual(names.slice(names.indexOf("Personel"), names.indexOf("Ayarlar") + 1), ["Personel", "Sabit Giderler", TAX_SHEET, "Ayarlar"]);
  const ws = wb.getWorksheet(TAX_SHEET)!;
  assert.equal(ws.getCell("A1").value, TAX_SHEET_FIRST_LINE);
  assert.equal(TAX_SHEET_FIRST_LINE, "Tahmin; beyanname değildir. Kafenin payı; şirketin beyannamesi muhasebecidedir.");
  const { texts, numbers } = cellsOf(ws);
  const all = texts.join("\n");
  // Excel verisinde her ayın geliri yönetim verisi (ModPOS): üç çeyrek, üç geçici vergi dönemi ve kurumlar vergisi yerine tek satır
  assert.equal(texts.filter((t) => t === TAX_NOT_FISCAL).length, view.quarters.length + view.corp.length + 1);
  assert.doesNotMatch(all, /Kasa satışları|Yönetim verisi|ModPOS/);
  for (const m of view.months) for (const r of m.income.rows) assert.ok(!numbers.some((n) => Math.abs(n - r.amount) < 0.005 && r.amount !== 0), `${m.month} ${r.label}`);
  // Kullanılan kurallar, derleme notu, takvim başlığı; "onay" kelimesi yok
  assert.match(all, /^Derlendi 24\.10\.2026; resmî metinlerle karşılaştırılmadı$/m);
  assert.ok(texts.includes("kv.oran") && texts.includes("sgk.isverenOran"));
  assert.ok(texts.includes("3. VERGİ TAKVİMİ") && texts.includes("5. SAHİBİN NOTLARI"));
  assert.doesNotMatch(all, /onay/i);
  // Rehberde bağlantısı ve açıklaması var
  let purpose = "";
  wb.getWorksheet("Nasıl Okunur")!.eachRow((r) => {
    const v = r.getCell(1).value as ExcelJS.CellFormulaValue | null;
    if (v && typeof v === "object" && "result" in v && v.result === TAX_SHEET) purpose = String(r.getCell(2).value);
  });
  assert.match(purpose, /^Tahmin, beyanname değil/);
  // Vergi görünümü verilmezse sekme yok (eski dosya düzeni)
  assert.ok(!buildWorkbook(model, "2026-09", EXTRAS).getWorksheet(TAX_SHEET));
});

test("Excel 'Vergi' sayfası: beyannameli aylar ve çeyrek yazılır; belgesi yok kalemi ve sınıflandırılmamış kalem adları yazılmaz; sahibin notu", () => {
  const filing = (period: string, m10: number): TaxFiling => ({ id: Number(period.slice(5)), kind: "kdv_matrah", period, payable: 0, stamp: 0, values: { m10, m20: 0 }, enteredByName: "Sahip" });
  const ds2: Dataset = { ...ds, fixedExpenses: ds.fixedExpenses.map((f) => (f.name === "Influencer" ? { ...f, taxDoc: "yok" as const } : f)) };
  const m2 = createModel(ds2);
  const settings = { ...DEFAULT_TAX_SETTINGS, checks: { stopaj: { by: "Sahip", date: "2026-10-27", note: "Instagram doğrudan Meta'ya" } } };
  const inputs2: TaxInputs = { ...inputs, settings, filings: [filing("2026-06", 0), filing("2026-07", 280_000), filing("2026-08", 300_000), filing("2026-09", 265_794)] };
  const v2 = buildTaxView(taxViewInputFromModel(m2, inputs2, { today: TODAY, year: 2026, quarter: "2026-Q3" }));
  const ws = buildWorkbook(m2, "2026-09", { ...EXTRAS, tax: { view: v2, settings } }).getWorksheet(TAX_SHEET)!;
  const { texts, numbers } = cellsOf(ws);
  const all = texts.join("\n");
  // Q2 ve Q3 yazıldı (beyanname), Q4 (Ekim, ModPOS) yazılmadı
  assert.ok(texts.includes("Çeyrek"));
  assert.ok(texts.includes("KDV beyannamesindeki satışlar (şirketin tamamı)"));
  assert.ok(texts.filter((t) => t === "beyanname").length >= 4);
  const q3 = v2.quarters.find((q) => q.key === "2026-Q3")!;
  for (const x of [q3.income, q3.expense, q3.result]) assert.ok(numbers.some((n) => Math.abs(n - x) < 0.005), String(x));
  assert.ok(texts.some((t) => t.startsWith("2026/4") || t.includes("2026/4")));
  assert.ok(texts.includes(TAX_NOT_FISCAL), "Ekim'in çeyreği yazılmaz");
  assert.doesNotMatch(all, /Kasa satışları|Yönetim verisi/);
  // Geçici vergi 2026/3: kafenin katkısı ve matrah yazıldı (hesap dönemi başından beri mali belge)
  const c3 = v2.corp.find((c) => c.key === "2026-Q3")!;
  assert.ok(numbers.some((n) => Math.abs(n - c3.matrah) < 0.005) && numbers.some((n) => Math.abs(n - c3.estimate) < 0.005));
  assert.ok(texts.includes("Kafenin katkısı (tahmini ödenecek)"));
  // Belgesi yok işaretli kalem adı ve tutarı yazılmaz; sınıflandırılmamışların yalnız toplamı
  assert.doesNotMatch(all, /Influencer|Instagram reklamı|Belgesi yok/);
  assert.ok(numbers.some((n) => Math.abs(n - q3.unclassified.total) < 0.005));
  assert.ok(texts.some((t) => t.startsWith(`${q3.unclassified.count} kalem; yalnız toplam`)));
  // Sahibin notu: işaretlenen madde, tarih ve not; "onay" yazmaz
  assert.ok(texts.includes("Sahibin notu: muhasebecimle konuştum · 27.10.2026 · Instagram doğrudan Meta'ya"));
  assert.doesNotMatch(all, /onay/i);
});

test("Excel 'Vergi' sayfasının kaynağı: route vergi görünümünü okur, hata dosyayı durdurmaz; sayfa yönetim verisini ve belgesiz kalemi yazmaz", () => {
  const route = read("src/app/api/export/route.ts");
  assert.match(route, /const tax = await loadTaxView\(model\)/);
  assert.match(route, /console\.error\("\[export\] Vergi sekmesi hazırlanamadı", e\);\n\s+return null;/);
  const wbSrc = read("src/app/api/export/workbook.ts");
  const body = wbSrc.slice(wbSrc.indexOf("function addTax("), wbSrc.indexOf("export function invoiceCategories("));
  assert.ok(body.length > 1000);
  // Ay satırları yalnız mali belgeli aylardan; hariç tutulan kalemler (excluded, belgesi yok) hiç okunmaz
  assert.match(body, /const fiscal = months\.filter\(isFiscal\);/);
  assert.doesNotMatch(body, /\.excluded|noDoc|EXCLUDE_REASON_TEXT/);
  assert.match(wbSrc, /if \(extras\.tax\) addTax\(wb, extras\.tax\);/);
});

test("personel sızıntı betiği: Vergi'nin dört adresi personel çereziyle (HTML ve RSC) Bugün'e döner", () => {
  const leak = read("scripts/personel-sizinti.ts");
  for (const p of PAGES.map((x) => x.replace(/^src\/app/, "").replace(/\/page\.tsx$/, ""))) assert.ok(leak.includes(`"${p}"`), p);
  assert.match(leak, /for \(const rsc of \[false, true\]\) \{\n\s+const res = await fetchPage\(path, rsc\);/);
});
