// Vergiye göre gelir-gider (plan docs/planlar/vergi.md §3.2, §11-D): Excel verisinde Temmuz–Eylül (Örnek C), gelirin
// mali belgeye dayanması, sınıflandırma, harcama kayıtlarının belgesi, varlık bağlama, POS komisyonu, çeyrek sonu
// sayımı, site geliri, kafe dışı faturalar, elle bordro, hesap döneminin başı, köprü ve çeyrek düzeltmesi.
// Excel modeline dayanan tutarlar ±0,01 (planın tablosu yuvarlanmamış ara değerlerle hesaplandı).
// Çalıştırma: npx tsx --test tests/vergi-gelir-gider.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset, ExpenseCategory, ExpenseEntry, FixedExpense, Invoice } from "../src/lib/calc/types";
import { FIXED_ESTIMATE_DESCRIPTION } from "../src/lib/constants";
import type { TaxAsset } from "../src/lib/tax/assets";
import type { TaxFiling } from "../src/lib/tax/corporate";
import {
  adjustmentPeriodLabel,
  ALP_KOC_NOTE,
  bridge,
  classificationTargets,
  SCOPE_TEXT,
  type TaxAdjustment,
  type TaxMonth,
  taxMonths,
  type TaxPnlExtras,
  taxPnlInputFromModel,
  taxQuarters,
  taxScope,
  unclassified,
} from "../src/lib/tax/pnl";
import { r2 } from "../src/lib/tax/rules";
import { DEFAULT_TAX_SETTINGS, type TaxSettings } from "../src/lib/tax/settings";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const TODAY = "2026-10-24";
const close = (a: number, b: number, msg: string, eps = 0.0101) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

function run(over: { ds?: Partial<Dataset>; settings?: Partial<TaxSettings>; extras?: Partial<TaxPnlExtras> } = {}) {
  const model = createModel({ ...base, ...over.ds });
  const settings = { ...DEFAULT_TAX_SETTINGS, ...over.settings };
  const input = taxPnlInputFromModel(model, { settings, today: TODAY, adjustments: [], assets: [], filings: [], ...over.extras });
  const months = taxMonths(input, 2026);
  const quarters = taxQuarters(input, months, 2026);
  const m = (k: string) => months.find((x) => x.month === k)!;
  const q = (k: string) => quarters.find((x) => x.key === k)!;
  return { model, input, months, quarters, m, q };
}
const reasonSum = (mm: TaxMonth, reason: string | null) => r2(mm.excluded.filter((x) => x.reason === reason).reduce((s, x) => s + x.amount, 0));
const row = (mm: TaxMonth, side: "income" | "expense", key: string) => mm[side].rows.find((r) => r.key === key);
const invoice = (supplier: string, amount: number) => base.invoices.find((i) => i.supplier === supplier && r2(i.amount - i.discount) === amount)!;
const fixedNamed = (name: string) => base.fixedExpenses.find((f) => f.name === name)!;
const withFixed = (name: string, patch: Partial<FixedExpense>) => base.fixedExpenses.map((f) => (f.name === name ? { ...f, ...patch } : f));

const C = run();

test("D, Örnek C: Temmuz–Eylül vergiye göre gelir-gider (sınıflandırma yok, varlık yok, yönetim verisi)", () => {
  const expect: Record<string, [number, number, number, number, number, number, number, number, number]> = {
    //            gelir        SMM         faturalar  POS        personel   sonuç        sınıflandırılmamış  aday     demirbaş
    "2026-07": [157806.36, 154284.53, 28286.17, 3714.76, 85990.86, -114469.96, 218889.64, 39780, 948680.41],
    "2026-08": [454545.45, 60709.03, 9036.22, 10700, 85990.86, 288109.34, 295025.17, 0, 2750],
    "2026-09": [390479.24, 173982.74, 19401.51, 9195.54, 85990.86, 101908.6, 294695.17, 30000, 0],
  };
  for (const [k, e] of Object.entries(expect)) {
    const mm = C.m(k);
    const got = [mm.income.total, mm.expense.smm, mm.expense.invoices, mm.expense.pos, mm.expense.personnel, mm.result, reasonSum(mm, null), reasonSum(mm, "aday"), reasonSum(mm, "varlik")];
    got.forEach((v, i) => close(v, e[i], `${k} sütun ${i}`));
    assert.equal(mm.revenueSource, "yonetim");
    assert.equal(row(mm, "income", "pos")!.badge, "Yönetim verisi (ModPOS), mali belge değil");
    assert.equal(row(mm, "income", "pos")!.label, "Kasa satışları (ModPOS)");
    // Faturalar dışında hiçbir gider kalemi sayılmadı: belgeli giderler 0
    assert.equal(mm.expense.belgeli, 0);
  }
  const q3 = C.q("2026-Q3");
  close(q3.income, 1002831.06, "Q3 gelir");
  close(q3.result, 275547.98, "Q3 sonuç");
  close(q3.unclassified.total, 808609.97, "Q3 sınıflandırılmamış");
  close(q3.candidates.total, 69780, "Q3 demirbaş olabilir");
  assert.equal(q3.candidates.count, 2);
  close(q3.unlisted.total, 951430.41, "Q3 demirbaş faturaları");
  assert.equal(q3.state, "taslak");
  assert.deepEqual(q3.warnings, ["30 Eylül sayımı yok: stok 0 sayıldı, alışın tamamı gider; vergi için çeyrek sonu sayımı gerekir"]);
  // Alt sınır: sonuç − 808.609,97 − 69.780 − 951.430,41 < 0
  close(q3.floorResult, 275547.98 - 808609.97 - 69780 - 951430.41, "Q3 alt sınır", 0.05);
  // 2026/2 yalnız 25–30 Haziran: veri yok
  assert.deepEqual(C.q("2026-Q2").months, ["2026-06"]);
  assert.equal(C.q("2026-Q2").result, 0);
  // Ekim süren ay: tamamlanmaz
  assert.ok(C.m("2026-10").warnings.includes("Ekim bitmedi: bugüne kadar"));
  assert.ok(C.m("2026-10").warnings.includes("Ekim cirosu 16 günlük"));
  assert.equal(row(C.m("2026-10"), "income", "pos")!.note, "16 gün");
  assert.ok(C.m("2026-09").warnings.includes("Personel: işe giriş günü bilinmediği için ay tam sayıldı"));
});

test("D: sınıflandırılacak kalemler: 16 sabit gider + 8 elle satır; 'Part-time' bordro notu", () => {
  const t = classificationTargets(C.input, C.months);
  assert.equal(t.length, 24);
  assert.equal(t.filter((x) => x.doc === null).length, 24);
  assert.equal(t.filter((x) => x.source === "fixed").length, 16);
  assert.equal(t.filter((x) => x.source === "manual").length, 8);
  assert.deepEqual(
    t.filter((x) => x.partTime).map((x) => x.name),
    ["Part-time çalışan"],
  );
  // Ekran listesi kaynağa göre: Kira yılın toplamıyla
  const kira = unclassified(C.months).find((x) => x.key === `fixed:${fixedNamed("Kira").id}`)!;
  close(kira.amount, 160000 * (23 / 31) + 160000 * 2 + 160000 * (16 / 31), "Kira (Temmuz 23 gün, Ekim 16 gün)");
});

test("D, Örnek C beyanname matrahıyla: gelir mali belgeden, kapsam şirketin tamamı; fark hiçbir yerde yazmaz", () => {
  const filings = (sepKafeDisi?: number): TaxFiling[] => [
    { id: 1, kind: "kdv_matrah", period: "2026-07", payable: 0, stamp: 0, values: { m10: 128700.46, m20: 12569.37 } },
    { id: 2, kind: "kdv_matrah", period: "2026-08", payable: 0, stamp: 0, values: { m10: 369994.62, m20: 0 } },
    { id: 3, kind: "kdv_matrah", period: "2026-09", payable: 0, stamp: 0, values: { m10: 347099.03, m20: 335000, ...(sepKafeDisi ? { kafeDisi: sepKafeDisi } : {}) } },
  ];
  const r = run({ extras: { filings: filings() } });
  const q3 = r.q("2026-Q3");
  close(q3.income, 1193363.48, "Q3 gelir");
  close(q3.result, 466080.4, "Q3 sonuç");
  for (const k of ["2026-07", "2026-08", "2026-09"]) {
    assert.equal(r.m(k).revenueSource, "beyanname");
    assert.equal(row(r.m(k), "income", "kdv_matrah")!.badge, "mali belge · beyanname");
    assert.equal(row(r.m(k), "income", "kdv_matrah")!.label, "KDV beyannamesindeki satışlar (şirketin tamamı)");
  }
  const q3months = r.months.filter((x) => r.q("2026-Q3").months.includes(x.month));
  assert.equal(taxScope(q3months, r.input), "beyanname");
  assert.equal(SCOPE_TEXT[taxScope(q3months, r.input)], "Gelir: şirketin tamamı (beyanname) · gider: kafe");
  // Beyanname ile ModPOS arasındaki fark (190.532,42) ve "fark" sözcüğü gelir tarafında yok
  const texts = JSON.stringify([...r.months.map((x) => [x.income, x.warnings, bridge(x)]), r.quarters]);
  assert.ok(!/190\.?532/.test(texts), "fark tutarı yazılmaz");
  assert.ok(!texts.includes("ModPOS cirosu"), "ModPOS cirosu beyanname aylarında yazılmaz");
  // Ekim yine yönetim verisi: çeyrek 4 taslak
  assert.equal(r.m("2026-10").revenueSource, "yonetim");

  const k = run({ extras: { filings: filings(335000) } });
  close(k.q("2026-Q3").income, 858363.48, "kafe dışı kısmı düşülmüş gelir");
  close(k.q("2026-Q3").result, 131080.4, "kafe dışı kısmı düşülmüş sonuç");
  assert.equal(row(k.m("2026-09"), "income", "kafe_disi_payi")!.amount, -335000);
  const k3 = k.months.filter((x) => k.q("2026-Q3").months.includes(x.month));
  assert.equal(SCOPE_TEXT[taxScope(k3, k.input)], "Kapsam: yalnız kafe");
});

test("D: sınıflandırmanın etkileri", () => {
  const kiraId = fixedNamed("Kira").id;
  const belgeli = run({ ds: { fixedExpenses: withFixed("Kira", { taxDoc: "belgeli" }) } });
  for (const k of ["2026-07", "2026-08", "2026-09"]) {
    const kira = C.m(k).excluded.find((x) => x.key === `fixed:${kiraId}`)!.amount;
    close(belgeli.m(k).expense.belgeli, kira, `${k} kira gidere girer`);
    close(belgeli.m(k).result, C.m(k).result - kira, `${k} sonuç kira kadar düşer`);
    close(reasonSum(belgeli.m(k), null), reasonSum(C.m(k), null) - kira, `${k} sayılmayan kira kadar azalır`);
  }
  // fatura, yok ve bordro sayılmaz; "yok" yalnız toplamda ve sayıda (listede nedenle)
  for (const doc of ["fatura", "yok"] as const) {
    const r = run({ ds: { fixedExpenses: withFixed("Kira", { taxDoc: doc }) } });
    close(r.m("2026-09").result, C.m("2026-09").result, `${doc} sayılmaz`);
    assert.equal(r.m("2026-09").excluded.find((x) => x.key === `fixed:${kiraId}`)!.reason, doc);
  }
  const bordro = run({ ds: { fixedExpenses: withFixed("Part-time çalışan", { taxDoc: "bordro" }) } });
  assert.equal(bordro.m("2026-09").excluded.find((x) => x.key === `fixed:${fixedNamed("Part-time çalışan").id}`)!.reason, "bordro");
  close(bordro.m("2026-09").result, C.m("2026-09").result, "bordro sayılmaz");
  // Aria Yazılım "Gider (demirbaş değil)": Temmuz'un giderine 39.780 eklenir, aday listesinden çıkar
  const aria = invoice("Aria Yazılım", 39780);
  const na = run({ ds: { invoices: base.invoices.map((i) => (i.id === aria.id ? { ...i, taxNotAsset: true } : i)) } });
  assert.equal(na.m("2026-07").expense.notAsset, 39780);
  close(na.m("2026-07").expense.total, C.m("2026-07").expense.total + 39780, "Temmuz gideri");
  assert.equal(reasonSum(na.m("2026-07"), "aday"), 0);
  assert.equal(na.q("2026-Q3").candidates.count, 1);
  // Elle satır belgeli: market alımı ÷ 1,10 mal maliyetine
  const diger = run({ ds: { pnlEntries: [{ month: "2026-09", rowKey: "manual:diger_mal", amount: 1100 }] }, settings: { manualRows: { "manual:diger_mal": "belgeli" } } });
  close(diger.m("2026-09").expense.smm, C.m("2026-09").expense.smm + 1000, "market alımı KDV hariç");
  const digerOff = run({ ds: { pnlEntries: [{ month: "2026-09", rowKey: "manual:diger_mal", amount: 1100 }] } });
  close(digerOff.m("2026-09").expense.smm, C.m("2026-09").expense.smm, "seçilmedi: sayılmaz");
  assert.equal(digerOff.m("2026-09").excluded.find((x) => x.key === "manual:diger_mal")!.amount, 1000);
});

test("D: harcama kaydının belgesi: kasadan çıkan, cari borç, kategori, tahmini kayıt", () => {
  const cats: ExpenseCategory[] = [
    { id: 1, name: "Market", section: "mal", panelGroup: "diger", invoiceCategory: null, monthly: false, active: true, sortOrder: 1, taxDoc: null },
    { id: 2, name: "Temizlik", section: "genel", panelGroup: "diger", invoiceCategory: null, monthly: false, active: true, sortOrder: 2, taxDoc: "belgeli" },
    { id: 3, name: "Reklam (aylık)", section: "genel", panelGroup: "reklam", invoiceCategory: null, monthly: true, active: true, sortOrder: 3, taxDoc: null },
  ];
  const e = (id: number, categoryId: number, amount: number, extra: Partial<ExpenseEntry> = {}): ExpenseEntry => ({
    id,
    date: "2026-09-10",
    categoryId,
    description: null,
    amount,
    paymentMethod: "nakit",
    note: null,
    ...extra,
  });
  const entries: ExpenseEntry[] = [
    e(1, 1, 1100, { cashOutId: 7, docType: "fis" }), // kasadan, fişli: mal ÷ 1,10 → 1.000
    e(2, 1, 550, { cashOutId: 8, docType: "yok" }), // kasadan, belgesiz
    e(3, 2, 1200), // bağsız: kategori belgeli, ÷ 1,20 → 1.000
    e(4, 3, 6000), // bağsız: kategori seçilmedi
    e(5, 2, 2400, { supplierEntryId: 3 }), // cari borç, kasadan değil: belgesi yok
    e(6, 2, 1200, { cashOutId: 9, docType: "e_arsiv", supplierEntryId: 4 }), // ikisi de dolu: kasanın belgesi
    e(7, 2, 3600, { cashOutId: 10, docType: "fatura" }), // faturası Faturalar'a geldi: iki kez sayılmaz
    e(8, 2, 5000, { description: FIXED_ESTIMATE_DESCRIPTION }), // sabit giderden tahmini: zaten KDV hariç
  ];
  const r = run({ ds: { expenseCategories: cats, expenseEntries: entries }, extras: { invoicedCashOuts: new Set([10]) } });
  const sep = r.m("2026-09");
  close(sep.expense.smm, C.m("2026-09").expense.smm + 1000, "fişli mal");
  close(sep.expense.belgeli, 1000 + 1000 + 5000, "belgeli giderler");
  const by = (k: string) => sep.excluded.find((x) => x.key === k)!;
  assert.equal(by("entry:2").reason, "yok");
  assert.equal(by("entry:5").reason, "yok");
  assert.equal(by("entry:7").reason, "fatura");
  assert.equal(by("category:3").reason, null);
  assert.equal(by("category:3").amount, 5000);
  assert.ok(!sep.excluded.some((x) => x.key === "entry:6"), "kasanın e-Arşiv'i sayılır");
  // Köprü yine tutar (Gelir-gider kayıtları KDV dahil sayıyor)
  const b = bridge(sep).rows;
  close(b[0].amount + b.slice(1, -1).reduce((s, x) => s + x.amount, 0), b.at(-1)!.amount, "köprü", 0.02);
  assert.ok(b.some((x) => x.key === "receiptVat"));
});

test("D: varlık bağlama: eşlenmemiş tutar azalır; aday faturaya bağlanan varlık gider olmaz", () => {
  const xnd = invoice("XND Teknoloji", 338169.58);
  const aria = invoice("Aria Yazılım", 39780);
  const asset = (id: number, invoiceId: number, cost: number): TaxAsset => ({
    id,
    name: `V${id}`,
    invoiceId,
    invoiceLabel: null,
    acquiredOn: "2026-07-13",
    cost,
    kind: "demirbas",
    method: "amortisman",
    lifeYears: 5,
  });
  const r = run({ extras: { assets: [asset(1, xnd.id, 300000), asset(2, aria.id, 39780)] } });
  close(reasonSum(r.m("2026-07"), "varlik"), 948680.41 - 300000, "eşlenmemiş tutar");
  assert.equal(reasonSum(r.m("2026-07"), "aday"), 0);
  close(r.m("2026-07").expense.invoices, 28286.17, "Aria gider olmaz");
});

test("D: POS komisyonu Gelir-gider'in hücresinden; elle girildiyse o", () => {
  for (const k of ["2026-07", "2026-08", "2026-09"]) close(C.m(k).expense.pos, (C.model.pnlMonth(k).cells.get("commission:pos")!.value as number) ?? 0, k);
  assert.equal(row(C.m("2026-09"), "expense", "pos")!.badge, "tahmini");
  assert.match(row(C.m("2026-09"), "expense", "pos")!.note!, /yemek kartı payı ayrılamadı/);
  const r = run({ ds: { pnlEntries: [{ month: "2026-09", rowKey: "commission:pos", amount: 8000 }] } });
  assert.equal(r.m("2026-09").expense.pos, 8000);
  assert.equal(row(r.m("2026-09"), "expense", "pos")!.badge, "elle");
});

test("D: çeyrek sonu sayımı yoksa en son ay sonu sayımı (K15)", () => {
  const ing = base.ingredients.find((i) => i.active && i.packagePrice > 0 && i.countUnit)!;
  const r = run({ ds: { stockCounts: [{ month: "2026-08", ingredientId: ing.id, qty: 10 }] } });
  const aug = r.model.closingStock("2026-08").value;
  assert.ok(aug > 0);
  const q3 = r.q("2026-Q3");
  assert.equal(q3.stock.usedFrom, "2026-08");
  close(q3.stock.closingUsed, aug, "Ağustos sayımı");
  assert.deepEqual(q3.warnings, ["30 Eylül sayımı yok: 31 Ağustos sayımı kullanıldı; vergi için çeyrek sonu sayımı gerekir"]);
  // Ayların toplamı Eylül'de stoku 0 sayar; çeyrek Ağustos sayımını devreden sayar
  const months = r.months.filter((x) => q3.months.includes(x.month));
  close(q3.result, months.reduce((s, x) => s + x.result, 0) + aug, "çeyrek sonucu sayım kadar yüksek");
  // Sayılan çeyrek sonunda uyarı yok
  const counted = run({ ds: { stockCounts: [{ month: "2026-09", ingredientId: ing.id, qty: 10 }] } });
  assert.deepEqual(counted.q("2026-Q3").warnings, []);
  assert.equal(counted.q("2026-Q3").stock.adjust, 0);
});

test("D: site geliri iadesi bekleyen karaokeyi KDV hariç düşer (50.000 kuruş → 416,67 ₺)", () => {
  // Plan "500 ₺ düşük" diyordu: refundPendingMinor KDV dahildir, site.total KDV hariç; karaoke %20 → 500 ÷ 1,20
  const none = { orders: 0, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };
  const site = (pending: number): SiteSalesMonth => ({
    month: "2026-09",
    pulledAt: "2026-10-02T06:00:00.000Z",
    now: "2026-10-02T06:00:00.000Z",
    from: "2026-09-01",
    to: "2026-09-30",
    closed: true,
    cafe: { ...none, orders: 10, grossMinor: 1_100_000, netMinor: 1_100_000, kdvMinor: 100_000, lines: [] },
    shop: { ...none },
    karaoke: { bookings: 2, collectedMinor: 600_000, refundedMinor: 0, netMinor: 600_000, refundPendingMinor: pending, kdvMinor: 100_000, unknownKdvNetMinor: 0 },
    manual: { orders: 0, grossMinor: 0, netMinor: 0 },
  });
  const a = run({ ds: { siteSales: [site(0)] } });
  const b = run({ ds: { siteSales: [site(50_000)] } });
  const sa = row(a.m("2026-09"), "income", "site")!;
  const sb = row(b.m("2026-09"), "income", "site")!;
  assert.equal(sa.amount, 15000);
  assert.equal(r2(sa.amount - sb.amount), 416.67);
  assert.equal(sb.badge, "yaklaşık; e-Arşiv tarihinden farklı olabilir");
});

test("D: kafe dışı faturalar ayar kapalıyken sayılmaz (Alp Koç notuyla); açıkken kafe dışı gider, kapsam değişir", () => {
  const alp: Invoice = { ...base.invoices[0], id: 9001, date: "2026-09-12", supplier: "Pruva", category: "Alp Koç", amount: 5000, discount: 0, payable: 6000 };
  const off = run({ ds: { invoices: [...base.invoices, alp] } });
  const x = off.m("2026-09").excluded.find((e) => e.key === "invoice:9001")!;
  assert.equal(x.reason, "kafe_disi");
  assert.equal(x.note, ALP_KOC_NOTE);
  close(off.m("2026-09").result, C.m("2026-09").result, "sayılmaz");
  const on = run({ ds: { invoices: [...base.invoices, alp] }, settings: { includeSeparate: true } });
  assert.equal(row(on.m("2026-09"), "expense", "kafe_disi")!.amount, 5000);
  close(on.m("2026-09").result, C.m("2026-09").result - 5000, "sayılır");
  assert.equal(SCOPE_TEXT[taxScope(on.months, on.input)], "Kapsam: kafe + elle girilen kafe dışı");
  assert.equal(SCOPE_TEXT[taxScope(C.months, C.input)], "Kapsam: yalnız kafe");
});

test("D: Gelir-gider'de elle girilen bordro o ay kullanılır", () => {
  const r = run({ ds: { pnlEntries: [{ month: "2026-09", rowKey: "personnel:net", amount: 70000 }] } });
  const p = r.m("2026-09");
  const employer = r.model.pnlMonth("2026-09").cells.get("personnel:employer")!.value as number;
  close(p.expense.personnel, 70000 + employer, "elle toplam");
  assert.equal(p.expense.personnelManual, true);
  assert.equal(row(p, "expense", "personnel")!.badge, "elle");
  assert.ok(!p.warnings.includes("Personel: işe giriş günü bilinmediği için ay tam sayıldı"));
});

test("D: hesap döneminin başı: 24.06 faturası sayılmaz, 25.06 sayılır", () => {
  const inv = (id: number, date: string): Invoice => ({ ...base.invoices[0], id, date, supplier: `Hizmet ${id}`, category: "Hizmet", amount: 1000, discount: 0, payable: 1200 });
  const r = run({ ds: { invoices: [...base.invoices, inv(9101, "2026-06-24"), inv(9102, "2026-06-25")] } });
  const jun = r.m("2026-06");
  assert.equal(jun.from, "2026-06-25");
  assert.equal(jun.expense.invoices, 1000);
  assert.deepEqual(row(jun, "expense", "invoices")!.items, [{ label: "Hizmet", amount: 1000 }]);
});

test("D: köprü (Eylül): Gelir-gider'deki gider − sayılmayanlar ± farklar = vergiye göre gider; personel cümlesi", () => {
  const b = bridge(C.m("2026-09"));
  const start = b.rows[0];
  const end = b.rows.at(-1)!;
  assert.equal(start.label, "Gelir-gider'deki gider");
  close(start.amount, C.model.pnlMonth("2026-09").expenses, "başlangıç");
  assert.equal(end.label, "Vergiye göre gider");
  close(end.amount, C.m("2026-09").expense.total, "son");
  close(start.amount + b.rows.slice(1, -1).reduce((s, x) => s + x.amount, 0), end.amount, "iki uç", 0.02);
  close(b.rows.find((x) => x.key === "excluded")!.amount, -294695.17, "sayılmayan");
  close(b.rows.find((x) => x.key === "payroll")!.amount, 85990.86 - 83117.65, "bordro farkı");
  assert.equal(b.income, "Gelir: Gelir-gider'deki kasa cirosu, yönetim verisi");
  // Plan "maaşlar ≈ 83.200" diyordu; Eylül 60.000 + 23.117,65 = 83.117,65 → ≈ 83.100
  assert.equal(
    b.personnel?.replace(/ /g, " "),
    "Gelir-gider'deki personel 116.018 ₺: maaşlar ≈ 83.100 ₺ ve personel bölümündeki sabit giderler ≈ 32.900 ₺; vergide maaşlar bordroyla, diğerleri belgesine göre sayılır.",
  );
  for (const k of ["2026-07", "2026-08", "2026-10"]) {
    const r = bridge(C.m(k)).rows;
    close(r[0].amount + r.slice(1, -1).reduce((s, x) => s + x.amount, 0), r.at(-1)!.amount, `${k} köprü`, 0.02);
  }
});

test("D: çeyrek düzeltmesi bir kez girer, listede '2026/3'", () => {
  const adj: TaxAdjustment = { id: 1, month: "2026-09", span: "ceyrek", kind: "gelir_kafe_disi", amount: 90000, label: "Yazılım işi" };
  const r = run({ extras: { adjustments: [adj] } });
  close(r.q("2026-Q3").income, C.q("2026-Q3").income + 90000, "Q3 gelir");
  close(r.m("2026-07").income.total, C.m("2026-07").income.total, "Temmuz değişmez");
  assert.equal(adjustmentPeriodLabel(adj), "2026/3");
  assert.equal(adjustmentPeriodLabel({ month: "2026-09", span: "ay" }), "Eylül 2026");
  assert.equal(SCOPE_TEXT[taxScope(r.months, r.input)], "Kapsam: kafe + elle girilen kafe dışı");
  // İndirilemeyen gider ve indirim ay sonucuna girmez, çeyrekte ayrı
  const k = run({ extras: { adjustments: [{ id: 2, month: "2026-08", span: "ay", kind: "kkeg", amount: 5000, label: "Gecikme zammı" }] } });
  assert.equal(k.m("2026-08").result, C.m("2026-08").result);
  assert.equal(k.q("2026-Q3").kkeg, 5000);
});
