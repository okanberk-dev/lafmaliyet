// "Excel'e aktar" dosyası: Excel çalışma kitabının sekmeleri, düzeni ve Eylül 2026 rakamlarıyla aynı mı?
// Beklenen değerler Excel'in kendi hücrelerinden (golden.json ve "L'Affogato – Maliyet & Kârlılık.xlsx").
// Çalıştırma: npm test (ya da npx tsx --test tests/export-workbook.test.ts)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import ExcelJS from "exceljs";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, investmentSeed, type ExcelData } from "../src/server/db/seed/excel";

import { buildWorkbook, excelDate, fixedRangeInYear, GUIDE_SHEET, investmentDate, invoiceCategories, pnlYearTotal, waterExplanation } from "../src/app/api/export/workbook";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(root, "tests/golden.json"), "utf8"));
const NOW = new Date("2026-10-20T10:00:00Z");

function dataset(): Dataset {
  const ds = excelToDataset(data);
  ds.currentMonth = "2026-10";
  return ds;
}
const extras = { investments: data.investments.map(investmentSeed), findings: data.findings, now: NOW };
const model = createModel(dataset());
const wb = buildWorkbook(model, "2026-09", extras);

function close(actual: unknown, expected: number, label: string, tol = 1e-6) {
  assert.equal(typeof actual, "number", `${label}: sayı yok (${String(actual)})`);
  const diff = Math.abs((actual as number) - expected);
  assert.ok(diff <= tol * Math.max(1, Math.abs(expected)), `${label}: beklenen ${expected}, bulunan ${actual}`);
}
/** Hücre değeri; formülse önbellekteki sonuç */
function val(cell: ExcelJS.Cell): unknown {
  // cell.value formülün 0 sonucunu düşürür (ExcelJS); sonuç cell.result'ta
  if (cell.type === ExcelJS.ValueType.Formula) return cell.result;
  return cell.value;
}
/** Bir sütunda metni tam `text` olan, yoksa `text` ile başlayan ilk satır */
function rowOf(ws: ExcelJS.Worksheet, text: string, col = 1): ExcelJS.Row {
  let prefix: ExcelJS.Row | undefined;
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(col).value;
    if (v === text) return ws.getRow(r);
    if (!prefix && typeof v === "string" && v.startsWith(text)) prefix = ws.getRow(r);
  }
  if (prefix) return prefix;
  assert.fail(`${ws.name}: "${text}" satırı yok`);
}
const sheet = (name: string) => {
  const ws = wb.getWorksheet(name);
  assert.ok(ws, `sekme yok: ${name}`);
  return ws!;
};

test("Sekmeler Excel çalışma kitabının sırasında; seçili ay adlarda", () => {
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    [
      "Nasıl Okunur",
      "Özet",
      "Gelir-Gider 2026",
      "Sayım Eylül 2026",
      "Tutarlılık Eylül 2026",
      "Ürün Kârlılık",
      "Reçete Kartları",
      "Satış Eylül 2026",
      "Hammaddeler",
      "Faturalar",
      "Aylık Alımlar",
      "Personel",
      "Sabit Giderler",
      "Ayarlar",
      "Satış Kayıtları",
      "Ay Bilgileri",
      "Gelir-Gider Kayıtları",
      "Sayım Kayıtları",
      "Alım Miktarları",
    ],
  );
  for (const w of wb.worksheets) assert.ok(w.name.length <= 31, `Excel sekme adı 31 karakteri geçemez: ${w.name}`);
  // Dosya Özet'te açılır; yedek sekmeleri gri
  assert.equal(wb.views[0].activeTab, 1);
  assert.equal((sheet("Özet").views[0] as { tabSelected?: boolean }).tabSelected, true);
  for (const n of ["Satış Kayıtları", "Ay Bilgileri", "Gelir-Gider Kayıtları", "Sayım Kayıtları", "Alım Miktarları"]) {
    assert.equal(sheet(n).properties.tabColor?.argb, "FFA1A1AA", `${n} gri sekme`);
  }
  assert.equal(sheet("Özet").properties.tabColor, undefined);
});

test("Nasıl Okunur (Excel 'Nasıl Kullanılır'): her sekmeye bağlantı ve bir satırlık açıklama", () => {
  const ws = sheet(GUIDE_SHEET);
  const links = new Map<string, string>();
  ws.eachRow((r) => {
    const v = r.getCell(1).value as ExcelJS.CellFormulaValue | null;
    if (v && typeof v === "object" && "formula" in v) links.set(String(v.result), String(r.getCell(2).value ?? ""));
  });
  const others = wb.worksheets.map((w) => w.name).filter((n) => n !== GUIDE_SHEET);
  assert.deepEqual([...links.keys()], others);
  for (const [name, purpose] of links) assert.ok(purpose.length > 20, `${name}: açıklama yok`);
  let ozet: ExcelJS.CellFormulaValue | undefined;
  ws.eachRow((r) => {
    const v = r.getCell(1).value as ExcelJS.CellFormulaValue;
    if (v && typeof v === "object" && v.result === "Özet") ozet = v;
  });
  assert.equal(ozet?.formula, `HYPERLINK("#'Özet'!A1","Özet")`);
  assert.match(links.get("Özet")!, /Eylül 2026/);
  rowOf(ws, "Panelin kopyası");
  assert.match(String(rowOf(ws, "KDV").getCell(2).value), /%10/);
});

test("Özet = Excel Panel: para nereye gitti, Kira/Personel/Reklam/Diğer, net kâr, en kârlı ürün, kategoriler", () => {
  const ws = sheet("Özet");
  const g = golden.panel;
  close(val(rowOf(ws, "Satışlar (net ciro)").getCell(2)), g.netSales, "net satış");
  close(val(rowOf(ws, "– İndirimler").getCell(2)), g.discounts, "indirim");
  close(val(rowOf(ws, "– Malzeme + ambalaj").getCell(2)), g.material, "malzeme");
  close(val(rowOf(ws, "– Kart / POS komisyonu").getCell(2)), g.commission, "komisyon");
  close(val(rowOf(ws, "– Kira").getCell(2)), g.rent, "kira (B9)");
  close(val(rowOf(ws, "– Personel").getCell(2)), g.personnel, "personel (B10)");
  close(val(rowOf(ws, "– Reklam").getCell(2)), g.advertising, "reklam (B11)");
  close(val(rowOf(ws, "– Diğer sabit giderler").getCell(2)), g.otherFixed, "diğer (B12)");
  close(val(rowOf(ws, "EYLÜL NET KÂR / ZARAR").getCell(2)), g.netProfit, "net kâr (B13)");
  close(val(rowOf(ws, "Zarar etmemek için GÜNLÜK ciro").getCell(2)), g.breakEvenDaily, "başabaş (B16)");
  close(val(rowOf(ws, "Eylül günlük ortalama ciro").getCell(2)), g.dailyAvg, "günlük ortalama (B17)");
  close(val(rowOf(ws, "Reçeteye göre maliyet oranı").getCell(2)), g.recipeCostRatio, "reçete oranı (B22)");
  close(val(rowOf(ws, "Faturaya göre maliyet oranı").getCell(2)), g.invoiceCostRatio, "fatura oranı (B23)");
  assert.equal(val(rowOf(ws, "Eylül ayında en çok kâr getiren ürün").getCell(2)), "L'Affogato (L)");
  assert.equal(val(rowOf(ws, "Fiyatı gözden geçirilmesi").getCell(2)), g.lowProfitCount);
  // Excel B18 / B19: süren ayın (Ekim, 16 gün) tahmini, Eylül dosyasında da
  const sep = model.monthSales("2026-09");
  close(val(rowOf(ws, "Ekim günlük ortalama ciro (1–16 Ekim").getCell(2)), 293909 / 16, "Ekim günlük ortalama");
  close(val(rowOf(ws, "Ekim tahmini net kâr / zarar").getCell(2)), (293909 / 16) * 31 * (sep.grossProfit / sep.revenue) - golden.fixedTotal, "Ekim tahmini");
  // Excel D4:H17 kategori tablosu sağda
  const cats = Object.entries(golden.categories as Record<string, { count: number; avgMargin: number; avgUnitProfit: number; avgCostRatio: number }>);
  assert.equal(ws.getCell("D1").value, "Kategori");
  for (const [name, gc] of cats) {
    const r = rowOf(ws, name, 4);
    assert.equal(val(r.getCell(5)), gc.count, `${name} ürün sayısı`);
    close(val(r.getCell(6)), gc.avgMargin, `${name} ort. marj`);
    close(val(r.getCell(7)), gc.avgUnitProfit, `${name} ort. birim kâr`);
    close(val(r.getCell(8)), gc.avgCostRatio, `${name} ort. maliyet oranı`);
  }
  assert.match(String(ws.getCell("I1").value), /Satış \(adet\) · Eylül 2026/);
});

test("Gelir-Gider: Excel bölüm başlıkları, C2'de dondurma ve '2026 YILI' sütunu (Excel P sütunu)", () => {
  const ws = sheet("Gelir-Gider 2026");
  const view = ws.views[0] as { state: string; xSplit: number; ySplit: number };
  assert.deepEqual([view.state, view.xSplit, view.ySplit], ["frozen", 2, 1], "Excel gibi C2'de dondurulur");
  assert.equal(ws.getCell("O1").value, "2026 YILI");
  const sections: string[] = [];
  ws.eachRow((r) => {
    const v = r.getCell(1).value;
    if (typeof v === "string" && v) sections.push(v);
  });
  assert.deepEqual(sections, ["MAL ALIŞLARI", "DEVİRLER", "PERSONEL GİDERLERİ", "FATURALAR", "KİRA", "İŞLETME GENEL GİDERLERİ", "KOMİSYON GİDERLERİ", "TOPLAMLAR", "MALİYET", "ORANLAR"]);
  const yearOf = (label: string) => val(rowOf(ws, label, 2).getCell(15));
  // Excel Genel Maliyet P sütunu (=SUM(D:O) ve yıllık oranlar)
  close(yearOf("AYLIK MAL ALIMI TOPLAMI"), 492983.18, "P17");
  close(yearOf("PERSONEL MAAŞ (net)"), 195483.871, "P24");
  close(yearOf("PERSONEL GİDERLERİ TOPLAMI"), 378738.1404, "P30");
  close(yearOf("FATURA GİDERLERİ TOPLAMI"), 57016.12903, "P38");
  close(yearOf("KİRA GİDERLERİ TOPLAMI"), 522378.5161, "P43");
  close(yearOf("İŞLETME GENEL GİDERLERİ TOPLAMI"), 273550.8978, "P52");
  close(yearOf("KOMİSYON GİDERLERİ TOPLAMI"), 31877.6916, "P58");
  close(yearOf("GİDERLER GENEL TOPLAMI"), 1756544.555, "P66");
  close(yearOf("AYLIK CİRO (KDV dahil"), 1397194, "P68");
  close(yearOf("AYLIK CİRO (KDV hariç)"), 1270176.364, "P69");
  close(yearOf("KÂR / ZARAR"), -486368.1914, "P71");
  close(yearOf("MALİYET ORANI (tüm giderler"), 1.382913905, "P72");
  close(yearOf("MAL MALİYETİ"), 0.3881218342, "P74");
  close(yearOf("KÂR"), -0.382913905, "P81");
  // Stok devirleri bir andaki değerdir: yıl toplamı boş (Excel P19 / P21)
  assert.equal(yearOf("ÖNCEKİ AYDAN DEVİR"), null);
  assert.equal(yearOf("SONRAKİ AYA DEVREDEN MAL"), null);
  // Eylül sütunu (K) Excel L sütunu
  close(val(rowOf(ws, "KÂR / ZARAR", 2).getCell(11)), golden.pnl["2026-09"].profit, "Eylül kâr/zarar");
  // Tedarikçi satırı ne sattığını taşır: "KALDİ (kahve, …)"
  assert.match(String(rowOf(ws, "KALDİ", 2).getCell(2).value), /^KALDİ \(.+\)$/);
});

test("pnlYearTotal: tutarlar toplanır, devirler toplanmaz, oran = yıllık pay ÷ yıllık ciro", () => {
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const calcs = months.map((m) => model.pnlMonth(m));
  const rn = calcs.reduce((a, c) => a + (c.revenueNet ?? 0), 0);
  const cogs = calcs.reduce((a, c) => a + c.cogs, 0);
  close(pnlYearTotal(model, calcs, "total:cogs"), cogs, "SMM toplamı");
  close(pnlYearTotal(model, calcs, "ratio:cogs"), cogs / rn, "yıllık mal maliyeti oranı");
  assert.equal(pnlYearTotal(model, calcs, "stock:closing"), null);
  // Hiçbir ayda değeri olmayan elle satır boş kalır (0 değil)
  assert.equal(pnlYearTotal(model, calcs, "manual:dogalgaz"), null);
  // Cirosuz yıl: oran yok
  const empty = ["2025-01", "2025-02"].map((m) => model.pnlMonth(m));
  assert.equal(pnlYearTotal(model, empty, "ratio:profit"), null);
});

test("Satış: Excel C4:C8 özet bloğu, Durum ve Not sütunları, TOPLAM", () => {
  const ws = sheet("Satış Eylül 2026");
  close(val(rowOf(ws, "POS toplam ciro").getCell(3)), 429698, "POS ciro (C4)");
  close(val(rowOf(ws, "Ciro dışı").getCell(3)), 18815, "ödenmez (C5)");
  close(val(rowOf(ws, "Yönetici indirimleri").getCell(3)), 11997, "indirim (C8)");
  close(val(rowOf(ws, "Açık gün").getCell(3)), 30, "açık gün");
  close(val(rowOf(ws, "Eşleşen ürünlerin ortalama maliyet oranı").getCell(3)), golden.salesTotals.avgCostRatio, "ortalama maliyet oranı (C7)");
  close(val(rowOf(ws, "Liste – indirim – POS").getCell(3)), golden.consistency.salesDiff, "liste − indirim − POS");
  const head = rowOf(ws, "POS ürün adı");
  assert.equal(head.getCell(11).value, "Durum");
  assert.equal(head.getCell(12).value, "Not");
  assert.equal((ws.views[0] as { ySplit?: number }).ySplit, head.number, "başlık satırı dondurulur");
  const karaoke = rowOf(ws, "Karaoke Kişi başı");
  assert.equal(karaoke.getCell(12).value, "Hizmet satışı, malzeme maliyeti yok.");
  assert.match(String(karaoke.getCell(11).value), /^Hizmet/);
  assert.match(String(rowOf(ws, "SİMİT").getCell(11).value), /^Eşleşmedi – ortalama maliyet oranı \(%25,5\)/);
  const tot = rowOf(ws, "TOPLAM");
  close(val(tot.getCell(2)), golden.salesTotals.qty, "adet");
  close(val(tot.getCell(3)), golden.salesTotals.revenue, "ciro");
  close(val(tot.getCell(7)), golden.salesTotals.cost, "maliyet");
  close(val(tot.getCell(9)), golden.salesTotals.grossProfit, "brüt kâr");
});

test("Faturalar: Tarih gerçek tarih (UTC gece yarısı), Ay sütunu, Net/KDV formülleri; Aylık Alımlar = Excel L:Q bloğu", () => {
  const ws = sheet("Faturalar");
  const head = ws.getRow(1);
  const colOf = (name: string) => {
    for (let c = 1; c <= ws.columnCount; c++) if (head.getCell(c).value === name) return c;
    assert.fail(`sütun yok: ${name}`);
  };
  const first = ws.getRow(2);
  const inv = model.ds.invoices[0];
  assert.ok(first.getCell(colOf("Tarih")).value instanceof Date);
  assert.equal((first.getCell(colOf("Tarih")).value as Date).getTime(), Date.UTC(2026, 6, 6), "06.07.2026, saat farkıyla bir gün kaymaz");
  assert.equal(first.getCell(colOf("Tarih")).numFmt, "dd.mm.yyyy");
  const ay = first.getCell(colOf("Ay")).value as ExcelJS.CellFormulaValue;
  assert.equal(ay.formula, "DATE(YEAR(A2),MONTH(A2),1)");
  assert.equal((ay.result as Date).getTime(), Date.UTC(2026, 6, 1));
  assert.equal((first.getCell(colOf("Net (KDV hariç)")).value as ExcelJS.CellFormulaValue).formula, "F2-G2");
  assert.equal(colOf("Mal/hizmet tutarı"), 6);
  assert.equal(colOf("İskonto"), 7);
  assert.equal(colOf("Ödenecek (KDV dahil)"), 10);
  close(val(first.getCell(colOf("KDV"))), inv.payable - (inv.amount - inv.discount), "KDV");
  assert.ok(ws.autoFilter, "süzgeç açık");

  // Aylara göre net alımlar: SUMIFS formülü Net (H) / Kategori (E) / Ay (K) sütunlarına bakar
  assert.equal(colOf("Net (KDV hariç)"), 8);
  assert.equal(colOf("Kategori"), 5);
  assert.equal(colOf("Ay"), 11);
  const al = sheet("Aylık Alımlar");
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
  months.forEach((m, j) => assert.equal((al.getRow(1).getCell(2 + j).value as Date).getTime(), excelDate(`${m}-01`).getTime()));
  const f = al.getRow(2).getCell(2).value as ExcelJS.CellFormulaValue;
  assert.match(f.formula, /^SUMIFS\(Faturalar!\$H\$2:\$H\$\d+,Faturalar!\$E\$2:\$E\$\d+,\$A2,Faturalar!\$K\$2:\$K\$\d+,B\$1\)$/);
  for (const [label, byMonth] of Object.entries(golden.invoiceSummary as Record<string, Record<string, number>>)) {
    if (label === "Diğer") continue; // Panel Komisyon kategorisini Diğer'den ayırır (aşağıda toplamları)
    const r = rowOf(al, label === "Mal maliyeti (ilk 3 satır)" ? "Mal maliyeti" : label);
    months.forEach((m, j) => close(val(r.getCell(2 + j)), byMonth[m], `${label} ${m}`));
  }
  months.forEach((m, j) =>
    close(Number(val(rowOf(al, "Diğer").getCell(2 + j))) + Number(val(rowOf(al, "Komisyon").getCell(2 + j))), golden.invoiceSummary["Diğer"][m], `Diğer + Komisyon ${m}`),
  );
  // Excel gibi boş kategoriler de listelenir; listede olmayan eski kategori sona eklenir
  assert.deepEqual(invoiceCategories([{ category: "Eski kategori" }]).slice(-2), ["Diğer", "Eski kategori"]);
});

test("excelDate: Türkiye saatinde de seri sayı tam gün (kesirsiz)", () => {
  const serial = (d: Date) => 25569 + d.getTime() / 86_400_000;
  assert.equal(serial(excelDate("2026-07-06")), 46209);
  assert.ok(Number.isInteger(serial(excelDate("2026-10-31"))));
  assert.equal(excelDate("2026-09").getTime(), Date.UTC(2026, 8, 1));
});

test("Personel: TOPLAM satırı ve Oranlar bloğu (Excel Personel B4:B7, satır 12)", () => {
  const ws = sheet("Personel");
  const t = rowOf(ws, "TOPLAM");
  close(val(t.getCell(2)), 60000, "net");
  close(val(t.getCell(3)), 70588.23529, "brüt");
  close(val(t.getCell(4)), 10588.23529, "işçi kesintileri");
  close(val(t.getCell(5)), 11117.64706, "işveren SGK");
  close(val(t.getCell(6)), 1411.764706, "işveren işsizlik");
  close(val(t.getCell(7)), 0, "yemek / yol");
  close(val(t.getCell(8)), 83117.64706, "toplam işveren maliyeti");
  close(val(rowOf(ws, "İşçi SGK primi payı").getCell(2)), 0.14, "B4");
  close(val(rowOf(ws, "İşçi işsizlik sigortası payı").getCell(2)), 0.01, "B5");
  close(val(rowOf(ws, "İşveren SGK primi").getCell(2)), 0.1575, "B6");
  close(val(rowOf(ws, "İşveren işsizlik sigortası payı").getCell(2)), 0.02, "B7");
  const ay = sheet("Ayarlar");
  for (const k of ["İşçi SGK primi payı", "İşçi işsizlik sigortası payı", "İşveren SGK primi", "İşveren işsizlik sigortası payı"]) {
    assert.equal(rowOf(ay, k).getCell(2).numFmt, "0.00%", `Ayarlar: ${k}`);
  }
});

test("Sabit Giderler: TOPLAM = SabitGiderToplam, tek seferlik yatırımlar ayrı blokta", () => {
  const ws = sheet("Sabit Giderler");
  close(val(rowOf(ws, "TOPLAM").getCell(5)), golden.fixedTotal, "SabitGiderToplam (B22)");
  rowOf(ws, "Tek seferlik yatırımlar (bilgi amaçlı, aylık gidere dahil değil)");
  close(val(rowOf(ws, "Dekorasyon & ekipman").getCell(3)), 948680, "XND yatırımı");
  close(val(rowOf(ws, "YATIRIM TOPLAMI").getCell(3)), 1036607, "yatırım toplamı");
});

test("Tutarlılık: satış kaynakları (B5:B11), reçete ↔ fatura toplam farkı (F45) ve bulgular", () => {
  const ws = sheet("Tutarlılık Eylül 2026");
  close(val(rowOf(ws, "Ürün listesi toplamı").getCell(2)), 441955, "B5");
  close(val(rowOf(ws, "– Yönetici indirimleri").getCell(2)), -11997, "B6");
  close(val(rowOf(ws, "Hesaplanan ciro").getCell(2)), 429958, "B7");
  close(val(rowOf(ws, "POS ciro raporu").getCell(2)), 429698, "B8");
  const fark = rowOf(ws, "Fark");
  close(val(fark.getCell(2)), 260, "B9");
  assert.equal(fark.getCell(3).value, "✓ TUTARLI (fark %0,1)");
  close(val(rowOf(ws, "Ödenmezlerin tahmini malzeme maliyeti").getCell(2)), golden.consistency.offRevenueCost, "B11");
  close(val(rowOf(ws, "TOPLAM fark").getCell(6)), golden.consistency.totalDiff, "F45");
  for (const [name, usage] of Object.entries(golden.consistency.usage as Record<string, number>)) close(val(rowOf(ws, name).getCell(2)), usage, `${name} kullanım`);
  rowOf(ws, "3) BULGULAR");
  for (const f of data.findings) rowOf(ws, f.title);
});

test("Sayım ve stok karşılaştırması: sayılan ay, ham kayıtlar ve gerçek tüketim", () => {
  const ds = dataset();
  const esp = ds.ingredients.find((i) => i.name === "Espresso çekirdeği")!;
  ds.stockCounts.push({ month: "2026-08", ingredientId: esp.id, qty: 10, factor: 1000 }, { month: "2026-09", ingredientId: esp.id, qty: 4, factor: 1000 });
  ds.stockExtras.push({ id: 1, month: "2026-09", name: "TEST kalem", unit: "ADET", qty: 2, unitPrice: 50 });
  const m = createModel(ds);
  const w = buildWorkbook(m, "2026-09", extras);
  const stock = m.stockSheet("2026-09");
  const line = stock.groups.flatMap((g) => g.lines).find((l) => l.ingredient.id === esp.id)!;

  const sy = w.getWorksheet("Sayım Eylül 2026")!;
  const r = rowOf(sy, "Espresso çekirdeği", 2);
  assert.equal(r.getCell(3).value, "KG");
  assert.equal(r.getCell(4).value, 4);
  close(val(r.getCell(6)), line.amount, "tutar");
  close(val(r.getCell(8)), line.amountVatIncl, "KDV dahil");
  close(val(rowOf(sy, "TEST kalem", 2).getCell(6)), 100, "listede olmayan");
  close(val(rowOf(sy, "AY TOPLAMI").getCell(6)), stock.total, "ay toplamı (KDV hariç)");
  close(val(rowOf(sy, "AY TOPLAMI").getCell(8)), stock.totalVatIncl, "ay toplamı (KDV dahil)");
  // Gelir-gider devreden mal ile aynı
  close(val(rowOf(w.getWorksheet("Gelir-Gider 2026")!, "SONRAKİ AYA DEVREDEN MAL", 2).getCell(11)), stock.total, "devreden mal");

  const raw = w.getWorksheet("Sayım Kayıtları")!;
  let rawRows = 0;
  raw.eachRow((row, n) => {
    if (n > 1 && row.getCell(3).value === "Espresso çekirdeği") {
      rawRows++;
      assert.equal(row.getCell(7).value, (row.getCell(5).value as number) * 1000, "malzemenin biriminde (gr)");
    }
  });
  assert.equal(rawRows, 2, "iki ayın sayımı");

  const tu = w.getWorksheet("Tutarlılık Eylül 2026")!;
  const tr = rowOf(tu, "Espresso çekirdeği");
  close(val(tr.getCell(7)), 10000, "önceki ay sayımı (gr)");
  close(val(tr.getCell(8)), 4000, "bu ay sayımı (gr)");
  close(val(tr.getCell(9)), 10000 + 36000 - 4000, "gerçek tüketim = devir + alınan − devreden");
  assert.equal(tr.getCell(12).value, "Sayım + alım tamam");
});

test("Personel ve sabit giderler seçili ayın kayıtlarıyla; değişiklik geçmişi ayrı blokta", () => {
  const ds = dataset();
  const p1 = ds.staff[0];
  const kira = ds.fixedExpenses.find((f) => f.name === "Kira")!;
  ds.staffVersions = [{ id: 1, staffId: p1.id, fromMonth: "2026-10", netSalary: 35000, extras: 0 }];
  ds.fixedExpenseVersions = [{ id: 1, fixedExpenseId: kira.id, fromMonth: "2026-10", period: "aylik", amount: 175000 }];
  const m = createModel(ds);
  const sepWb = buildWorkbook(m, "2026-09", extras);
  const octWb = buildWorkbook(m, "2026-10", extras);
  close(val(rowOf(sepWb.getWorksheet("Personel")!, p1.name).getCell(2)), 30000, "Eylül maaşı");
  close(val(rowOf(octWb.getWorksheet("Personel")!, p1.name).getCell(2)), 35000, "Ekim maaşı");
  close(val(rowOf(sepWb.getWorksheet("Sabit Giderler")!, "Kira").getCell(3)), 160000, "Eylül kirası");
  close(val(rowOf(octWb.getWorksheet("Sabit Giderler")!, "Kira").getCell(3)), 175000, "Ekim kirası");
  const hist = rowOf(sepWb.getWorksheet("Sabit Giderler")!, "Aralık ve tutar geçmişi");
  const kiraHist = sepWb.getWorksheet("Sabit Giderler")!.getRow(hist.number + 2);
  assert.equal(kiraHist.getCell(1).value, "Kira");
  assert.match(String(kiraHist.getCell(6).value), /160\.000.₺ aylık → Ekim 2026 itibarıyla 175\.000.₺ aylık/);
  assert.match(String(rowOf(sepWb.getWorksheet("Personel")!, "Başlangıç, bitiş ve maaş geçmişi").getCell(1).value), /maaş geçmişi/);
  // Değişiklik yoksa geçmiş bloğu yok (gürültü olmasın)
  assert.throws(() => rowOf(sheet("Sabit Giderler"), "Aralık ve tutar geçmişi"));
});

test("Su + buz açıklaması nedenini söyler", () => {
  assert.match(waterExplanation({ perLiter: 0, month: null, bill: 0, liters: 0, reason: "no-usage", latestBillMonth: "2026-10" }), /^Ekim su faturası girildi ama Ekim satış listesi yok; litre hesaplanamadı/);
  assert.match(waterExplanation({ perLiter: 2, month: null, bill: 0, liters: 0, reason: "override", latestBillMonth: null }), /elle girildi/);
  assert.match(waterExplanation({ perLiter: 0.5, month: "2026-09", bill: 1000, liters: 2000, reason: "ok", latestBillMonth: "2026-09" }), /^Eylül 2026 SU GİDERİ/);
  assert.match(waterExplanation(model.water), /SU GİDERİ girilmemiş/);
});

test("Dosya yazılıp geri okunabiliyor; notlar ve tarihler korunuyor", async () => {
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf as ArrayBuffer);
  assert.deepEqual(
    back.worksheets.map((w) => w.name),
    wb.worksheets.map((w) => w.name),
  );
  const fa = back.getWorksheet("Faturalar")!;
  assert.equal((fa.getCell("A2").value as Date).getTime(), Date.UTC(2026, 6, 6));
  assert.ok(back.getWorksheet("Gelir-Gider 2026")!.getCell("K1").note, "Eylül ay notu başlıkta");
});

test("Yedek: bütün ayların satış satırları, ay bilgileri ve Gelir-gider'de elle girilen hücreler", () => {
  const ds = dataset();
  ds.salesLines.push({ id: 999001, month: "2026-10", posName: "TEST EKİM SATIRI", qty: 2, revenue: 300, productId: null, isService: false, note: "TEST not" });
  const kira = ds.fixedExpenses.find((f) => f.name === "Kira")!;
  ds.pnlEntries.push({ month: "2026-08", rowKey: `fixed:${kira.id}`, amount: 150000, note: "TEST indirimli ay" }, { month: "2026-09", rowKey: "manual:dogalgaz", amount: 1234 });
  const m = createModel(ds);
  const w = buildWorkbook(m, "2026-09", extras);

  // Satış: seçili ay (Eylül) dışındaki satırlar da yedekte
  const sl = w.getWorksheet("Satış Kayıtları")!;
  assert.equal(sl.rowCount - 1, ds.salesLines.length, "her satış satırı bir satır");
  const ek = rowOf(sl, "TEST EKİM SATIRI", 2);
  assert.equal((ek.getCell(1).value as Date).getTime(), Date.UTC(2026, 9, 1));
  assert.equal(ek.getCell(6).value, "TEST not");
  assert.equal(rowOf(sl, "L'AFFOGATO LARGE", 2).getCell(5).value, "L'Affogato|L");
  assert.equal(rowOf(sl, "Karaoke Kişi başı", 2).getCell(5).value, "HİZMET");
  assert.equal(w.getWorksheet("Satış Eylül 2026")!.getColumn(1).values.includes("TEST EKİM SATIRI"), false, "seçili ayın sekmesinde yok");

  // Ay bilgileri (Excel Satış Raporu C4:C8'in her ay için karşılığı)
  const ai = w.getWorksheet("Ay Bilgileri")!;
  let sep: ExcelJS.Row | undefined;
  ai.eachRow((r, n) => {
    if (n > 1 && (r.getCell(1).value as Date).getTime() === Date.UTC(2026, 8, 1)) sep = r;
  });
  assert.ok(sep, "Eylül satırı");
  assert.deepEqual([2, 3, 4, 5].map((c) => sep!.getCell(c).value), [30, 429698, 11997, 18815]);
  assert.equal(ai.rowCount - 1, ds.months.length);

  // Gelir-gider düzeltmeleri: satır adı, girilen tutar, panelin hesapladığı ve not
  const gk = w.getWorksheet("Gelir-Gider Kayıtları")!;
  const kr = rowOf(gk, "KİRA", 3);
  assert.equal(kr.getCell(2).value, "KİRA");
  assert.equal(kr.getCell(4).value, 150000);
  close(kr.getCell(5).value, 160000, "hesaplanan (Ağustos 31 gün açık)");
  assert.equal(kr.getCell(6).value, "TEST indirimli ay");
  assert.equal(kr.getCell(7).value, `fixed:${kira.id}`);
  const dg = rowOf(gk, "DOĞALGAZ", 3);
  assert.equal(dg.getCell(4).value, 1234);
  assert.equal(dg.getCell(5).value, null, "elle satırın hesaplanan değeri yok");
  // Gelir-Gider sekmesi de aynı düzeltmeyi gösterir ve not düşer
  const gg = rowOf(w.getWorksheet("Gelir-Gider 2026")!, "KİRA", 2);
  assert.equal(gg.getCell(10).value, 150000, "Ağustos (J)");
  assert.match(String(gg.getCell(10).note), /Elle düzeltildi \(hesaplanan 160\.000.₺\)\. TEST indirimli ay/);
});

test("Gelir-Gider: yıl içinde başlayan / biten sabit gider satırında hangi aylar sayıldığı notu", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
  assert.equal(fixedRangeInYear({ startMonth: "2026-10", endMonth: "2026-11" }, months, "2026-07"), "Ekim 2026 itibarıyla · son ay Kasım 2026");
  // Verinin başladığı ayda başlayan kalem "baştan beri" sayılır; yıl sonunda biten kalem not almaz
  assert.equal(fixedRangeInYear({ startMonth: "2026-07", endMonth: "2026-12" }, months, "2026-07"), null);
  assert.equal(fixedRangeInYear({ startMonth: "2025-05", endMonth: null }, months, "2026-07"), null);
  assert.equal(fixedRangeInYear(undefined, months, null), null);

  const ds = dataset();
  ds.fixedExpenses.push({ id: 999002, name: "TEST Ekim aboneliği", section: "genel", period: "aylik", amount: 500, note: "TEST açıklama", active: true, sortOrder: 99, startMonth: "2026-10", endMonth: null });
  const w = buildWorkbook(createModel(ds), "2026-10", extras);
  const r = rowOf(w.getWorksheet("Gelir-Gider 2026")!, "TEST EKİM ABONELİĞİ", 2);
  assert.equal(r.getCell(2).note, "Ekim 2026 itibarıyla\nTEST açıklama");
  assert.equal(r.getCell(10).value, null, "Ağustos'ta sayılmaz");
});

test("Yatırım tarihi okunur biçimde (Sabit Giderler)", () => {
  assert.equal(investmentDate("2026-07"), "Temmuz 2026");
  assert.equal(investmentDate("2026-07-06"), "06.07.2026");
  assert.equal(investmentDate(" Temmuz–Eylül "), "Temmuz–Eylül");
  assert.equal(investmentDate(null), null);
  assert.equal(rowOf(sheet("Sabit Giderler"), "Dekorasyon & ekipman").getCell(2).value, "Temmuz 2026");
});

test("Verisi olmayan ay da dosya üretir; sekmeler boş olduğunu söyler", async () => {
  const w = buildWorkbook(model, "2027-03", extras);
  assert.ok(w.getWorksheet("Gelir-Gider 2027"));
  rowOf(w.getWorksheet("Satış Mart 2027")!, "Bu ay satış listesi yüklenmemiş.");
  rowOf(w.getWorksheet("Özet")!, "Bu ayın satış listesi yüklenmemiş");
  rowOf(w.getWorksheet("Sayım Mart 2027")!, "Bu ay sayım girilmemiş.");
  // Yedek sekmeleri seçili aydan bağımsız: yine bütün kayıtlar
  assert.equal(w.getWorksheet("Satış Kayıtları")!.rowCount - 1, model.ds.salesLines.length);
  const buf = await w.xlsx.writeBuffer();
  assert.ok(buf.byteLength > 10_000);
});

test("Özet: seçili ay süren aysa günlük ortalama bir kez yazılır, tahmin satırları kalır", () => {
  const ws = buildWorkbook(model, "2026-10", extras).getWorksheet("Özet")!;
  const daily: string[] = [];
  ws.eachRow((r) => {
    const v = r.getCell(1).value;
    if (typeof v === "string" && v.startsWith("Ekim günlük ortalama")) daily.push(v);
  });
  assert.equal(daily.length, 1, daily.join(" | "));
  close(val(rowOf(ws, "Ekim günlük ortalama").getCell(2)), 293909 / 16, "Ekim günlük ortalama");
  rowOf(ws, "Ekim ay sonu ciro tahmini");
  rowOf(ws, "Ekim tahmini net kâr / zarar");
});

test("Satış listesi olmayan ayda TOPLAM satırı boş; hiç verisi olmayan ayda faturaya göre kâr 0 yazılmaz", () => {
  const oct = buildWorkbook(model, "2026-10", extras);
  const ws = oct.getWorksheet("Satış Ekim 2026")!;
  const tot = rowOf(ws, "TOPLAM");
  assert.equal(val(tot.getCell(2)), null, "adet boş");
  assert.equal(val(tot.getCell(3)), null, "ciro boş");
  const empty = buildWorkbook(model, "2025-01", extras);
  const ozet = empty.getWorksheet("Özet")!;
  const row = rowOf(ozet, "Kâr / zarar (faturaya göre, Gelir-gider)");
  assert.match(String(row.getCell(1).value), /veri yok/);
  assert.equal(val(row.getCell(2)), null);
  // Verisi olan ayda değer yerinde
  assert.equal(typeof val(rowOf(sheet("Özet"), "Kâr / zarar (faturaya göre, Gelir-gider)").getCell(2)), "number");
});
