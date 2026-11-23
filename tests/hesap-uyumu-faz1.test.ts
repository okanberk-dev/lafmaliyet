// Hesap uyumu, Faz 1 (23 Kasım 2026; docs/hesap-sozlesmesi.md): ladmin'in LafPOS ile hesap farkları. Her madde
// Marina'nın Kasım 2026 rakamlarıyla (sözleşme §6) sınanır:
// 1. LafPOS günlerinde indirim satış listesinden ikinci kez düşülmez (−90 ₺)
// 2. Geçiş ayının ModPOS listesi Z ile indirimden sonra karşılaştırılır ("%8 fazla")
// 3. Banka POS komisyonu tek fonksiyon: Σ şube (kart × şubenin POS oranı), Satışlar ve Gelir-gider aynı (495,49)
// 4. Kasa formunun "Diğer" ipucu ikram demez
// 5. Komisyon & hakediş şube seçimine uyar, markası belirsiz tutar tek karta yığılmaz
// 6. Bitmiş sabit gidere yeni ay değeri girilmez; aynı gider iki yerde girilince uyarı
// Çalıştırma: npx tsx --test tests/hesap-uyumu-faz1.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// --- 4. Kasa formunun "Diğer" ipucu ---------------------------------------------------------------------------

test("kasa formu: Diğer'in ipucu ikram demez (ikram Ödenmez / ikram alanına yazılır, ciroya girmez)", () => {
  const form = read("src/app/panel/kasa/cash-form.tsx");
  const other = /field\("other", "Diğer", \{ hint: "([^"]*)" \}\)/.exec(form);
  assert.ok(other, "Diğer alanı bulunamadı");
  assert.doesNotMatch(other[1], /ikram/i, `Diğer'in ipucu: "${other[1]}"`);
  assert.equal(other[1], "havale, cari…");
  // Ödenmez / ikram ayrı alan olarak kalır
  assert.match(form, /field\("offRevenue", "Ödenmez \/ ikram"/);
});

// --- Marina, Kasım 2026 (sözleşme §6) ------------------------------------------------------------------------------

import { listVsPos } from "../src/app/panel/satislar/sales-logic";
import { createModel } from "../src/lib/calc/engine";
import { alerts, consistency, dashboard } from "../src/lib/calc/insights";
import type { Dataset, Month, SalesLine } from "../src/lib/calc/types";
import { listDiscountOf, resolveMonth, tillMonths, type TillRow } from "../src/lib/cash-month";
import { mergeSalesSources, type LafposMonthLine } from "../src/lib/lafpos/sales";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

/** Marina'nın LafPOS'a geçiş günü (22 Kasım 2026); ModPOS günleri 13–21 Kasım */
const S = "2026-11-22";

/** ModPOS günleri (sözleşme §6): gün, ciro (Z), kart, nakit, indirim, ödenmez, fiş */
const MODPOS_DAYS: [string, number, number, number, number, number, number][] = [
  ["2026-11-13", 390, 195, 195, 0, 0, 2],
  ["2026-11-14", 3311, 2687.25, 623.75, 249, 0, 14],
  ["2026-11-15", 5753, 4146.5, 1606.5, 517, 190, 27],
  ["2026-11-16", 2670, 2140, 530, 0, 0, 9],
  ["2026-11-17", 1641.25, 1171.25, 470, 153.75, 455, 12],
  ["2026-11-18", 2419.25, 1814.5, 604.75, 315.75, 400, 16],
  ["2026-11-19", 2535.75, 1472.5, 1063.25, 204.25, 200, 19],
  ["2026-11-20", 4008, 2914.25, 1093.75, 397, 255, 19],
  ["2026-11-21", 4620.5, 3203, 1417.5, 229.5, 0, 17],
];

/** Marina'nın kasa satırları: ModPOS günleri + 22 Kasım LafPOS günü (ciro 6.285, kart 5.030, nakit 1.255, indirim 90) */
function marinaTill(extra: TillRow[] = []): TillRow[] {
  return [
    ...MODPOS_DAYS.map(([date, z, card, cash, discounts, off]): TillRow => ({ date, zTotal: z, card, mealCard: 0, discounts, offRevenue: off, payments: card + cash, branchId: "marina" })),
    { date: S, zTotal: 6285, card: 5030, mealCard: 0, discounts: 90, offRevenue: 1065, payments: 6285, branchId: "marina" },
    ...extra,
  ];
}

const seed: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));

/** ModPOS listesinin satırı (Marina) */
const mline = (id: number, posName: string, revenue: number, productId: number | null, month = "2026-11"): SalesLine => ({
  id,
  month,
  posName,
  qty: 1,
  revenue,
  productId,
  isService: false,
  note: null,
  branchId: "marina",
});
const lafLine = (posName: string, revenue: number, productId: number | null, month = "2026-11"): LafposMonthLine => ({ month, posName, productId, isService: false, qty: 1, revenue, days: 1 });

/**
 * Marina Kasım: ModPOS listesi 13–21 Kasım (indirim öncesi 29.415,00), LafPOS 22 Kasım (indirimden sonra 6.285,00).
 * `till` verilirse ayın kasa satırları onlar; `month` verilirse ayın bilgisi o (elle yazılmış indirim sınaması)
 */
function marinaNovember(o: { till?: TillRow[]; month?: (till: ReturnType<typeof tillMonths>[number]) => Month; through?: string } = {}) {
  const base: Dataset = { ...excelToDataset(seed), currentMonth: "2026-12" };
  const sept = base.salesLines.filter((l) => l.month === "2026-09");
  const merged = mergeSalesSources({
    switchDay: S,
    salesLines: [...base.salesLines, mline(9001, "MODPOS LATTE", 20_000, sept[0].productId), mline(9002, "MODPOS TÜRK KAHVESİ", 9_415, sept[1].productId)],
    coverage: { "2026-11": "2026-11-21" },
    lafposLines: [lafLine("LATTE M", 570, sept[0].productId), lafLine("SYRUP", 92.5, null), lafLine("TÜRK KAHVESİ", 5_622.5, sept[1].productId)],
    lafposDays: [{ month: "2026-11", days: 1, last: S }],
  });
  const [till] = tillMonths(o.till ?? marinaTill(), o.through ?? "2026-11-22", undefined, undefined, undefined, undefined, undefined, true, S);
  const nov = o.month ? o.month(till) : resolveMonth("2026-11", undefined, till);
  const ds: Dataset = {
    ...base,
    settings: { ...base.settings, lafposGecisGunu: S },
    salesLines: merged.salesLines,
    months: [...base.months.filter((m) => m.month !== "2026-11"), nov],
    lafposSales: { switchDay: S, countFrom: S, months: [] },
  };
  return { ds, model: createModel(ds), till, nov };
}

// --- 1. −90 ₺: LafPOS günlerinde indirim satırlardan bir daha düşülmez ---------------------------------------------

test("−90 ₺: kasa ayının LafPOS günündeki indirim (90) listeden bir daha düşülmez; ModPOS günlerininki (2.066,25) düşülür", () => {
  const { model, till, nov } = marinaNovember();
  const c = consistency(model, "2026-11");
  assert.equal(c.sales.listTotal, 35_700);
  assert.equal(c.sales.pos, 33633.75);
  assert.equal(c.sales.diff, 0, `liste − indirim − POS: ${c.sales.diff}`);
  assert.equal(c.sales.discounts, 2066.25);
  // Genel bakış'ın reçeteye göre kârı da yalnız ModPOS günlerinin indirimini düşer
  const d = dashboard(model, "2026-11");
  assert.ok(d.theoretical, "satış listesi var");
  assert.equal(Math.round(d.theoretical.discountsNet * 100) / 100, Math.round((2066.25 / 1.1) * 100) / 100);
  // Ayın kasa bilgisi: indirim 2.156,25 (ModPOS 2.066,25 + LafPOS 90), Z 33.633,75
  assert.equal(till.discounts, 2156.25);
  assert.equal(till.posRevenue, 33633.75);
  assert.equal(till.lafposDiscounts, 90, "LafPOS satırlarında zaten düşülmüş indirim");
  assert.equal(nov.discounts, 2156.25, "ayın indirimi yine bütün günlerin toplamı");
  assert.equal(listDiscountOf(nov, S), 2066.25);
  assert.equal(model.listDiscounts("2026-11"), 2066.25);
});

test("−90 ₺: elle yazılmış ay indirimi geçiş ayında LafPOS günlerininki kadar azalır; ayın tamamı LafPOS'sa hiç düşülmez", () => {
  // Elle 2.156,25 yazıldı (ModPOS + LafPOS): kasanın bildiği LafPOS günü indirimi (90) satırlarda zaten var
  const typed = marinaNovember({ month: (till) => ({ ...resolveMonth("2026-11", { month: "2026-11", openDays: null, posRevenue: null, discounts: 2156.25, offRevenue: null, cardShare: null, note: null }, till) }) });
  assert.equal(typed.nov.sources?.discounts, "manual");
  assert.equal(consistency(typed.model, "2026-11").sales.diff, 0);
  assert.equal(listDiscountOf(typed.nov, S), 2066.25);
  // Aralık bütünüyle LafPOS: elle yazılan 1.500 indirim de satırlarda; liste − 0 − POS
  const dec: Month = { month: "2026-12", openDays: 31, posRevenue: 50_000, discounts: 1500, offRevenue: 0, cardShare: null, note: null };
  assert.equal(listDiscountOf(dec, S), 0);
  assert.equal(listDiscountOf(dec, null), 1500, "geçiş günü yok (ModPOS şubesi): indirim listeden düşülür");
  // "Tümü": şube şube; Tuzla'nın (ModPOS) indirimi düşülür, Marina'nınki satırlarda
  const all: Month = { ...dec, discounts: 1800, byBranch: { marina: dec, tuzla: { ...dec, discounts: 300, posRevenue: 10_000 } } };
  assert.equal(listDiscountOf(all, S), 300);
});

test("−90 ₺: LafPOS ayında indirim ≥ 1.000 iken 'Satış listesi ile POS cirosu tutmuyor' uyarısı çıkmaz", () => {
  // Aralık: LafPOS satırları indirimden sonra 50.000; kasa Z toplamı 50.000, indirim 1.500 (hepsi LafPOS günü)
  const { ds } = marinaNovember();
  const rows: TillRow[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-12-${String(i + 1).padStart(2, "0")}`,
    zTotal: 5000,
    card: 4000,
    mealCard: 0,
    discounts: 150,
    offRevenue: 0,
    payments: 5000,
    branchId: "marina",
  }));
  const [decTill] = tillMonths(rows, "2026-12-10", undefined, undefined, undefined, undefined, undefined, true, S);
  const sept = ds.salesLines.filter((l) => l.month === "2026-09");
  const decLines = mergeSalesSources({
    switchDay: S,
    salesLines: [],
    coverage: {},
    lafposLines: [lafLine("LATTE M", 30_000, sept[0].productId, "2026-12"), lafLine("TÜRK KAHVESİ", 20_000, sept[1].productId, "2026-12")],
    lafposDays: [{ month: "2026-12", days: 31, last: "2026-12-31" }],
  }).salesLines;
  const model = createModel({ ...ds, salesLines: [...ds.salesLines, ...decLines.map((l) => ({ ...l, id: l.id - 100 }))], months: [...ds.months, resolveMonth("2026-12", undefined, decTill)] });
  assert.deepEqual(alerts(model, "2026-12").filter((a) => a.title === "Satış listesi ile POS cirosu tutmuyor").map((a) => a.detail), []);
  assert.equal(consistency(model, "2026-12").sales.diff, 0);
});

test("−90 ₺: süren ayda listenin dönemi (listPeriod) de yalnız ModPOS günlerinin indirimini taşır", () => {
  // Kasım sürüyor (bugün 30 Kasım): satırlar 22 Kasım'a kadar, kasa raporları 30 Kasım'a kadar aranıyor
  const { ds } = marinaNovember({ through: "2026-11-30" });
  const [upto] = tillMonths(marinaTill(), S, undefined, undefined, undefined, undefined, undefined, true, S);
  const model = createModel({ ...ds, salesCoverage: [{ month: "2026-11", through: S, till: upto }] });
  const lp = model.listPeriod("2026-11");
  assert.ok(lp, "liste kasa raporlarından kısa");
  assert.equal(lp.discounts, 2066.25);
  assert.equal(lp.posRevenue, 33633.75);
});

test("−90 ₺: Satışlar'ın ay formu (liste ↔ POS kutusu) aynı kuralla: LafPOS günlerinin indirimi düşülmez", () => {
  const lafpos = { inLines: 90, whole: false };
  assert.deepEqual(listVsPos({ list: 35_700, discount: 2156.25, pos: 33633.75, lafpos }), { discount: 2066.25, diff: 0 });
  assert.deepEqual(listVsPos({ list: 35_700, discount: 2156.25, pos: 33633.75, lafpos: null }), { discount: 2156.25, diff: -90 });
  assert.deepEqual(listVsPos({ list: 50_000, discount: 1500, pos: 50_000, lafpos: { inLines: 1500, whole: true } }), { discount: 0, diff: 0 });
  assert.equal(listVsPos({ list: 0, discount: 0, pos: 100, lafpos: null }).diff, null, "liste yok");
  assert.equal(listVsPos({ list: 100, discount: 0, pos: null, lafpos: null }).diff, null, "POS yok");
});

// --- 2. "%8 fazla": geçiş ayının ModPOS listesi Z ile indirimden sonra karşılaştırılır --------------------------------

import { lafposMonthNotes, lafposMonthStatus, modposOverZText, modposZBetween } from "../src/lib/lafpos/sales";

/** Bölünmez boşluk ve sözcük birleştirici düz metne */
const plain = (t: string) => t.replace(/ /g, " ").replace(/⁠/g, "");

test("%8 fazla: ModPOS listesi (29.415,00) − indirim (2.066,25) = Z (27.348,75): uyarı yok", () => {
  // Eskiden liste indirimden önce Z ile karşılaştırılıyordu: 29.415 > 27.348,75 × 1,05 → "%8 fazla"
  const text = modposOverZText(29_415, 27_348.75, "2026-11-13", "2026-11-21", 2_066.25);
  assert.equal(text && plain(text), null);
  // Bandın notları da aynı kuralla (Satışlar): Z ve indirim listenin günlerinin kasa raporlarından
  const st = lafposMonthStatus({
    month: "2026-11",
    switchDay: S,
    today: "2026-11-23",
    modpos: { lines: 31, revenue: 29_415, through: "2026-11-21" },
    lafpos: { days: 1, last: S },
    modposZ: 27_348.75,
    modposDiscounts: 2_066.25,
  });
  assert.ok(st, "geçiş ayı");
  assert.equal(st.modposDiscounts, 2_066.25);
  assert.deepEqual(lafposMonthNotes(st, S).warnings.map(plain), []);
  // Liste indirimden sonra da Z'yi %5'ten fazla aşıyorsa uyarı yine çıkar, indirimi söyler
  const over = modposOverZText(31_000, 27_348.75, "2026-11-13", "2026-11-21", 2_066.25);
  assert.equal(
    over && plain(over),
    "ModPOS listesinin indirimden sonraki toplamı (28.933,75 ₺: liste 31.000 ₺ − indirim 2.066,25 ₺) 13–21 Kasım kasa raporlarının Z toplamından (27.348,75 ₺) %6 fazla: liste sonraki günlerin satışını da içeriyor olabilir, o günler LafPOS'tan da sayılır. Listeyi yalnız 13–21 Kasım için alıp yeniden yükleyin.",
  );
});

test("%8 fazla: listenin günlerinin Z toplamı ve indirimi yalnız verilen kasa satırlarından (şube süzülmüş), indirimi girilmemiş gün 0", () => {
  const rows = marinaTill();
  assert.deepEqual(modposZBetween(rows, "2026-11-13", "2026-11-21"), { z: 27_348.75, discounts: 2_066.25 });
  assert.deepEqual(modposZBetween(rows, "2026-11-01", "2026-11-12"), null, "rapor yok");
  assert.deepEqual(modposZBetween([{ date: "2026-11-13", zTotal: 100, discounts: null }], "2026-11-13", "2026-11-13"), { z: 100, discounts: 0 });
});

// --- 3. Banka POS komisyonu: tek fonksiyon, Satışlar ve Gelir-gider aynı ----------------------------------------------

/** Şubelerin banka POS oranı (Şubeler › POS oranı) */
const rates = (tuzla: number, marina: number): Dataset["branchRates"] => [
  { id: "tuzla", name: "Tuzla", posRate: tuzla },
  { id: "marina", name: "Marina", posRate: marina },
];

/** Marina görünümü (tek şube seçili), şubelerin POS oranı %2 (Şubeler; sahibin kararı) */
function marinaView(o: Parameters<typeof marinaNovember>[0] = {}) {
  const { ds } = marinaNovember(o);
  const view: Dataset = { ...ds, branchView: { id: "marina", name: "Marina", kind: "fiziksel" }, branchRates: rates(0.02, 0.02) };
  return { ds: view, model: createModel(view) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

test("POS komisyonu: Marina Kasım kart 24.774,25 × %2 = 495,49 hem Gelir-gider'de hem Satışlar'da (yemek kartı hariç)", () => {
  const { model } = marinaView();
  const pm = model.pnlMonth("2026-11");
  assert.equal(pm.cells.get("commission:pos")?.value, 495.49, "Gelir-gider: banka POS komisyonu");
  const sales = model.monthSales("2026-11");
  assert.equal(round2(sales.commission), 495.49, "Satışlar: satırların komisyonu toplamı");
  // Satırlara ciro payıyla dağıtılır
  const latte = sales.lines.find((l) => l.line.posName === "LATTE M");
  assert.ok(latte, "LATTE M satırı");
  assert.equal(round2(latte.commission), round2((495.49 * 570) / 35_700));
  // Tek fonksiyon: kart (yemek kartı hariç) × şubenin oranı
  const pc = model.posCommission("2026-11");
  assert.ok(pc, "kasa kartı olan ay");
  assert.equal(pc.amount, 495.49);
  assert.deepEqual(pc.parts, [{ branchId: "marina", card: 24_774.25, rate: 0.02, amount: 495.49 }]);
  assert.equal(plain(pm.cells.get("commission:pos")?.info ?? ""), "Banka POS komisyonu, yemek kartı hariç: Marina kart 24.774,25 ₺ × %2 = 495,49 ₺.");
});

test("POS komisyonu: yemek kartı komisyona girmez, şube oranı ayardan (Ayarlar'daki eski genel oran değil)", () => {
  // 22 Kasım'ın 1.000 ₺'si yemek kartıyla: banka kartı yine 24.774,25
  const rows = marinaTill().map((r) => (r.date === S ? { ...r, mealCard: 1000, payments: 7285, zTotal: 7285 } : r));
  const { model } = marinaView({ till: rows });
  assert.equal(model.pnlMonth("2026-11").cells.get("commission:pos")?.value, 495.49);
  assert.equal(round2(model.monthSales("2026-11").commission), 495.49);
  // Şubenin oranı %1,5 yazılırsa ikisi de ona göre
  const { ds } = marinaView();
  const lower = createModel({ ...ds, branchRates: rates(0.02, 0.015) });
  assert.equal(lower.pnlMonth("2026-11").cells.get("commission:pos")?.value, round2(24_774.25 * 0.015));
  assert.equal(round2(lower.monthSales("2026-11").commission), round2(24_774.25 * 0.015));
});

test("POS komisyonu: 'Tümü' şubelerin toplamı (her şube kendi kartı ve oranıyla), iki sayfada aynı", () => {
  const { ds } = marinaNovember();
  const tuzlaRows: TillRow[] = [{ date: "2026-11-20", zTotal: 15_000, card: 10_000, mealCard: 2_000, discounts: 0, offRevenue: 0, payments: 15_000, branchId: "tuzla" }];
  const [marinaT] = tillMonths(marinaTill(), S, undefined, undefined, undefined, undefined, undefined, true, S);
  const [tuzlaT] = tillMonths(tuzlaRows, S, undefined, undefined, undefined, undefined, undefined, null, S);
  const marina = resolveMonth("2026-11", undefined, marinaT);
  const tuzla = resolveMonth("2026-11", { month: "2026-11", openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: null, note: null }, tuzlaT);
  // Tuzla'nın ayı ay ortasında başladığı için kasadan uygulanmaz: o şube eski kuralla (ciro yok → 0)
  assert.equal(tuzla.sources?.posRevenue, "none");
  const all: Month = { ...marina, posRevenue: 33_633.75, byBranch: { marina, tuzla: { ...tuzla, posRevenue: 15_000, sources: { ...tuzla.sources!, posRevenue: "manual" } } } };
  const model = createModel({ ...ds, months: [...ds.months.filter((m) => m.month !== "2026-11"), all], branchRates: rates(0.03, 0.02) });
  const pc = model.posCommission("2026-11");
  assert.ok(pc, "Marina'nın kasa kartı var");
  // Marina: 24.774,25 × %2; Tuzla (elle yazılmış ciro): 15.000 × %3 × banka kartı payı
  assert.equal(pc.parts[0].amount, 495.49);
  assert.equal(pc.parts[1].branchId, "tuzla");
  assert.equal(pc.parts[1].card, null, "Tuzla'nın kasadan kartı uygulanmıyor");
  assert.equal(model.pnlMonth("2026-11").cells.get("commission:pos")?.value, pc.amount);
  assert.equal(round2(model.monthSales("2026-11").commission), pc.amount);
});

test("POS komisyonu: kasa kartı olmayan ay (Excel) eski formüllerle kalır", () => {
  const base: Dataset = { ...excelToDataset(seed), currentMonth: "2026-12", branchRates: rates(0.02, 0.02) };
  const model = createModel(base);
  assert.equal(model.posCommission("2026-09"), null);
  const st = model.settings;
  const pm = model.pnlMonth("2026-09");
  assert.ok(Math.abs((pm.cells.get("commission:pos")?.value ?? 0) - pm.revenue! * st.komisyon * st.kartOrani) < 1e-6);
});

// --- 5. Komisyon & hakediş: markası belirsiz tutar tek karta yığılmaz, şube görünümü ------------------------------------

import { sourceLabel } from "../src/app/panel/komisyonlar/texts";
import { lafposChannel } from "../src/lib/commission/channels";
import {
  branchCommissionShare,
  buildCommissionReport,
  groupOf,
  rowOf,
  type CommissionInput,
  type CommissionInvoiceIn,
  type LafposDayIn,
  type LafposPaymentIn,
  type TillDayIn,
} from "../src/lib/commission/report";

let invId = 1;
const cinv = (supplier: string, date: string, amount: number): CommissionInvoiceIn => ({
  id: invId++,
  date,
  supplier,
  names: [supplier],
  invoiceNo: null,
  amount,
  discount: 0,
  payable: round2(amount * 1.2),
  needsReview: false,
  lines: [{ name: "Komisyon", description: null, netTotal: amount }],
});
const cpay = (name: string, zField: LafposPaymentIn["zField"], channel: string | null, amount: number): LafposPaymentIn => ({ name, zField, channel: lafposChannel(channel), rawChannel: channel, amount });
const days = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const lafposDays = (from: string, to: string, payments: () => LafposPaymentIn[]): LafposDayIn[] =>
  days(from, to).map((date) => {
    const p = payments();
    const sum = (f: LafposPaymentIn["zField"]) => p.filter((x) => x.zField === f).reduce((a, x) => a + x.amount, 0);
    return { date, mealCard: sum("meal_card"), online: sum("online"), payments: p };
  });
const tillDays = (from: string, to: string, row: Omit<TillDayIn, "date">): TillDayIn[] => days(from, to).map((date) => ({ date, ...row }));

/**
 * Bugün 2 Aralık 2026; Marina 1 Kasım'dan LafPOS'ta (her gün Pluxee 50), Ekim'de Marina'nın kasa raporlarında yemek kartı
 * 500; Tuzla ModPOS'ta, Kasım'ın her günü Z'de yemek kartı 200. Pluxee'nin Kasım faturası 60
 */
function commissionInput(o: Partial<CommissionInput> = {}): CommissionInput {
  invId = 1;
  return {
    today: "2026-12-02",
    through: "2026-12-01",
    since: "2026-10-01",
    fromMonth: "2026-01",
    firstReport: "2026-10-01",
    till: [...tillDays("2026-10-01", "2026-10-31", { mealCard: 500, online: 0, branchId: "marina" }), ...tillDays("2026-11-01", "2026-11-30", { mealCard: 200, online: 0, branchId: "tuzla" })],
    invoices: [cinv("Pluxee", "2026-11-30", 60), cinv("Pluxee", "2026-10-31", 600)],
    marks: [],
    settings: {},
    lafpos: { switchDay: "2026-11-01", days: lafposDays("2026-11-01", "2026-11-30", () => [cpay("Pluxee", "meal_card", "pluxee", 50)]) },
    ...o,
  };
}

test("Marka belirsiz: Tuzla'nın Z'deki yemek kartı (6.000) tek karta (Pluxee) yığılmaz; grupta markası belirsiz satır", () => {
  const r = buildCommissionReport(commissionInput());
  const p = rowOf(r, "pluxee", "2026-11");
  assert.ok(p, "Pluxee Kasım");
  // Eskiden 1.500 + Tuzla'nın 6.000'i = 7.500 (oran %0,8)
  assert.deepEqual(p.sales, { amount: 1500, source: "lafpos" });
  assert.equal(p.rate, 0.04);
  assert.equal(sourceLabel(p.sales!, "meal"), "LafPOS ödemelerinden");
  const g = groupOf(r, "meal", "2026-11");
  assert.ok(g, "yemek kartları Kasım");
  assert.deepEqual(g.unbranded, { amount: 6000, modpos: 6000, pre: 0, loose: 0, fallback: 0 });
  assert.equal(g.zTotal, 7500, "grubun Z'si yine iki kasanın toplamı");
  // Satış eksik kalmış olabilir: bilgi
  assert.equal(p.flags.find((f) => f.key === "kasa-eksik")?.text.replace(/ /g, " "), "Z'de markası belirsiz 6.000 ₺ var; satış eksik kaldıysa oran yüksek görünür.");
  // Geçiş ayından önceki ay eski kuralla (tek kart: Z'deki yemek kartının tamamı Pluxee'nin)
  assert.deepEqual(rowOf(r, "pluxee", "2026-10")?.sales, { amount: 15_500, source: "tek" });
  assert.equal(groupOf(r, "meal", "2026-10")?.unbranded, null);
});

test("Marka belirsiz: Tuzla'nın markası ModPOS föyünden (modposChannels) bulunursa kanalına yazılır, kalan belirsiz", () => {
  // Tuzla'nın föyünde her gün Pluxee 120, Multinet 50 (Z'deki 200'ün 30'u föyde markasız)
  const brands = days("2026-11-01", "2026-11-30").map((date) => ({ date, branchId: "tuzla", byChannel: { pluxee: 120, multinet: 50 } }));
  const r = buildCommissionReport(commissionInput({ modposBrands: brands }));
  assert.deepEqual(rowOf(r, "pluxee", "2026-11")?.sales, { amount: 1500 + 3600, source: "lafpos", foy: 3600 });
  assert.deepEqual(rowOf(r, "multinet", "2026-11")?.sales, { amount: 1500, source: "lafpos", foy: 1500 });
  assert.equal(sourceLabel(rowOf(r, "multinet", "2026-11")!.sales!, "meal"), "ModPOS föyünden");
  assert.deepEqual(groupOf(r, "meal", "2026-11")?.unbranded, { amount: 900, modpos: 900, pre: 0, loose: 0, fallback: 0 });
  // Föy Z'den fazlasını söylüyorsa (föy ile kasa raporu tutmuyor) o gün föye güvenilmez: hepsi belirsiz
  const wrong = days("2026-11-01", "2026-11-30").map((date) => ({ date, branchId: "tuzla", byChannel: { pluxee: 250 } }));
  assert.deepEqual(groupOf(buildCommissionReport(commissionInput({ modposBrands: wrong })), "meal", "2026-11")?.unbranded?.modpos, 6000);
});

test("Marka belirsiz: LafPOS'ta kanalı seçilmemiş ödeme tek karta da yazılmaz", () => {
  const r = buildCommissionReport(
    commissionInput({
      till: tillDays("2026-10-01", "2026-10-31", { mealCard: 500, online: 0, branchId: "marina" }),
      lafpos: { switchDay: "2026-11-01", days: lafposDays("2026-11-01", "2026-11-30", () => [cpay("Pluxee", "meal_card", "pluxee", 50), cpay("Yemek kartı", "meal_card", null, 10)]) },
    }),
  );
  assert.deepEqual(rowOf(r, "pluxee", "2026-11")?.sales, { amount: 1500, source: "lafpos" });
  const g = groupOf(r, "meal", "2026-11");
  assert.deepEqual(g?.unbranded, { amount: 300, modpos: 0, pre: 0, loose: 300, fallback: 0 });
  assert.match((g?.flags[0]?.text ?? "").replace(/ /g, " "), /Bu tutar hiçbir karta yazılmaz, markası belirsiz satırda; LafPOS'ta ödeme türünün kanalını seçin\.$/);
});

test("şube görünümü: satış şubenin, oran işletmenin (faturalar ortak); şubenin komisyon payı = şube satışı × işletme oranı", () => {
  const brands = days("2026-11-01", "2026-11-30").map((date) => ({ date, branchId: "tuzla", byChannel: { pluxee: 200 } }));
  const all = buildCommissionReport(commissionInput({ modposBrands: brands }));
  // Marina'nın kapsamı: Tuzla'nın kasa raporları ve föyü okunmaz
  const marina = buildCommissionReport(commissionInput({ till: tillDays("2026-10-01", "2026-10-31", { mealCard: 500, online: 0, branchId: "marina" }) }));
  const share = branchCommissionShare(all, marina, "2026-11");
  const p = share.find((x) => x.channel === "pluxee");
  assert.ok(p, "Pluxee");
  // İşletme: 1.500 (Marina) + 6.000 (Tuzla) = 7.500, kesilen 60 → %0,8; Marina'nın payı 1.500 × %0,8 = 12
  assert.equal(rowOf(all, "pluxee", "2026-11")?.sales?.amount, 7500);
  assert.deepEqual(p, { channel: "pluxee", label: "Pluxee", kind: "meal", sales: 1500, rate: 0.008, commission: 12 });
});

import { commissionBranchNote, unbrandedLine } from "../src/app/panel/komisyonlar/texts";

test("Komisyon ekranı: markası belirsiz satırı ve şube görünümünün notu; zil, Bugün, e-posta ve haftalık özet işletme geneli", () => {
  assert.equal(unbrandedLine(null, "meal"), null);
  assert.equal(unbrandedLine({ amount: 0, pre: 0, modpos: 0, loose: 0, fallback: 0 }, "meal"), null);
  assert.equal(
    plain(unbrandedLine({ amount: 6300, pre: 0, modpos: 6000, loose: 300, fallback: 0 }, "meal") ?? ""),
    "Marka belirsiz: 6.300 ₺ (ModPOS'ta kalan şubenin Z'si 6.000 ₺, LafPOS'ta kanalı seçilmemiş ödeme 300 ₺). Hiçbir karta yazılmaz; kartın oranı yalnız markası bilinen satışla hesaplanır.",
  );
  assert.equal(
    plain(unbrandedLine({ amount: 900, pre: 900, modpos: 0, loose: 0, fallback: 0 }, "platform") ?? ""),
    "Marka belirsiz: 900 ₺ (LafPOS'tan önceki günlerin Z'si 900 ₺). Hiçbir platforma yazılmaz; platformun oranı yalnız markası bilinen satışla hesaplanır.",
  );
  const note = commissionBranchNote("Marina");
  assert.equal(note.title, "Marina seçili: satış yalnız bu şubenin, faturalar ve hakediş işletmenin");
  assert.match(note.text, /oran bütün şubelerin satışıyla hesaplanır/);
  assert.match(note.text, /payı = şubenin satışı × oran/);
  // Ekran iki raporu okur (işletme + şube); hafif yollar ve haftalık özet "Tümü" ile
  const page = read("src/app/panel/komisyonlar/page.tsx");
  assert.match(page, /const \{ all: report, branch, scope \} = await loadCommissionReports\(\);/);
  assert.match(page, /branchCommissionShare\(report, branch, month\)/);
  const data = read("src/server/data/commission.ts");
  assert.match(data, /return withBranchScope\(ALL_BRANCHES, async \(\) => buildCommissionReport\(await loadCommissionInput\(\{ resolveNames: false, today \}\)\)\);/);
  assert.match(data, /\.where\(andWhere\(gte\(s\.cashReports\.date, fromDay\), branchWhere\(s\.cashReports\.branchId, scope\)\)\)/);
  assert.match(data, /const switchDay = scopeSwitchDay\(readLafposSwitchDay\(switchRow\[0\]\?\.value\), scope\);/);
  assert.match(read("src/server/weekly/collect.ts"), /withBranchScope\(ALL_BRANCHES, \(\) => loadCommissionInput\(\{ resolveNames: false, today: ctx\.today \}\)\)/);
});

// --- 6. Bitmiş sabit gider ve aynı giderin iki kez girilmesi ------------------------------------------------------------

import { duplicateExpenses, sameExpenseName } from "../src/lib/calc/duplicate-expense";
import { fixedCellRefusal } from "../src/lib/fixed-expense-rules";

test("bitmiş sabit gider: bitişten sonraki aya yeni tutar yazılmaz; var olanı düzeltmek ve silmek serbest", () => {
  const item = { name: "Part-time çalışan", endMonth: "2026-11" };
  assert.match(fixedCellRefusal({ key: "fixed:7", month: "2026-12", item, hasEntry: false, amount: 1000 }) ?? "", /^Part-time çalışan Kasım 2026 sonunda bitti: Aralık 2026 için yeni tutar yazılmaz\./);
  assert.equal(fixedCellRefusal({ key: "stopaj:7", month: "2026-12", item, hasEntry: false, amount: 1000 })?.startsWith("Part-time çalışan Kasım 2026 sonunda bitti"), true);
  assert.equal(fixedCellRefusal({ key: "fixed:7", month: "2026-11", item, hasEntry: false, amount: 1000 }), null, "bitiş ayı dahil");
  assert.equal(fixedCellRefusal({ key: "fixed:7", month: "2026-12", item, hasEntry: true, amount: 900 }), null, "var olan değer düzeltilir");
  assert.equal(fixedCellRefusal({ key: "fixed:7", month: "2026-12", item, hasEntry: false, amount: null }), null, "silmek serbest");
  assert.equal(fixedCellRefusal({ key: "fixed:7", month: "2026-12", item: { name: "Kira", endMonth: null }, hasEntry: false, amount: 1 }), null);
  assert.match(fixedCellRefusal({ key: "fixed:7", month: "2026-12", item: null, hasEntry: false, amount: 1 }) ?? "", /^Bu sabit gider silinmiş: yeni tutar yazılmaz/);
  assert.equal(fixedCellRefusal({ key: "manual:su", month: "2026-12", item: null, hasEntry: false, amount: 1 }), null, "yalnız sabit gider ve stopaj satırları");
});

test("bitmiş sabit gider: Gelir-gider'de bitmiş kalemin boş hücresi salt okunur (yazılmış değer düzenlenir)", () => {
  const grid = read("src/app/panel/gelir-gider/pnl-grid.tsx");
  assert.match(grid, /const locked = c\.outOfRange && !c\.overridden;/);
  assert.match(grid, /\{def\.editable && !locked \? \(/);
  const month = read("src/app/panel/gelir-gider/month-view.tsx");
  assert.match(month, /def\.editable && !\(c\.outOfRange && !c\.overridden\) \?/);
});

test("aynı gider iki kez: ad eşleşmesi (Türkçe harfler sade, parantez içi de, kelime sınırı)", () => {
  assert.equal(sameExpenseName("Muhasebe", "Yıldız MUHASEBE Ltd. Şti."), true);
  assert.equal(sameExpenseName("İlaçlama (Kılavuz IPM)", "Kılavuz IPM"), true);
  assert.equal(sameExpenseName("Doğalgaz", "DOĞALGAZ"), true);
  assert.equal(sameExpenseName("Muhasebeci", "Yıldız Muhasebe"), false, "kelimenin parçası değil");
  assert.equal(sameExpenseName("Personel yemeği", "Personel"), false, "kısa ad uzun adın içinde sayılmaz");
  assert.equal(sameExpenseName("Su", "SU GİDERİ"), false, "4 harften kısa ad yalnız birebir");
  assert.equal(sameExpenseName("Su", "su"), true);
});

test("aynı gider iki kez: sabit gider ile aynı ayın harcaması, faturası ya da elle hücresi → uyarı ve hücrede işaret", () => {
  const base: Dataset = { ...excelToDataset(seed), currentMonth: "2026-12" };
  const fixedId = 9100;
  const ds: Dataset = {
    ...base,
    fixedExpenses: [
      ...base.fixedExpenses,
      { id: fixedId, name: "Muhasebe", section: "genel", period: "aylik", amount: 5000, note: null, active: true, startMonth: "2026-01", endMonth: null, sortOrder: 99, branchId: "tuzla" },
    ],
    expenseCategories: [{ id: 71, name: "Muhasebe", section: "genel", panelGroup: "diger", invoiceCategory: null, monthly: false, active: true, sortOrder: 1 }],
    expenseEntries: [{ id: 1, date: "2026-11-05", categoryId: 71, description: "Kasım muhasebe", amount: 5000, paymentMethod: null, note: null, branchId: "tuzla" }],
  };
  const model = createModel(ds);
  const alert = alerts(model, "2026-11").find((a) => a.title === "Aynı gider iki kez sayılıyor olabilir");
  assert.ok(alert, "uyarı var");
  assert.equal(plain(alert.detail), "Muhasebe: sabit gider ve Kasım ayında harcama (Muhasebe, 5.000 ₺). İkisi aynı ödemeyse birini silin ya da sabit gidere bu ay 0 yazın.");
  assert.equal(alert.href, "/panel/gelir-gider?ay=2026-11");
  assert.match(model.pnlMonth("2026-11").cells.get(`fixed:${fixedId}`)?.warn ?? "", /^Bu ay harcama olarak da girildi \(Muhasebe\): iki kez sayılıyor olabilir/);
  const found = model.duplicateExpenses("2026-11");
  assert.deepEqual(found.map((d) => [d.fixedId, d.matches.map((m) => [m.kind, m.label])]), [[fixedId, [["harcama", "Muhasebe"]]]]);
  // Başka şubenin harcaması eşleşmez; başka ayın da
  const other = createModel({ ...ds, expenseEntries: [{ ...ds.expenseEntries![0], branchId: "marina" }] });
  assert.deepEqual(other.duplicateExpenses("2026-11"), []);
  assert.deepEqual(model.duplicateExpenses("2026-10"), []);
  // Fatura (harcama kategorisine bağlı): tedarikçinin adı
  const inv = createModel({
    ...ds,
    expenseEntries: [],
    expenseCategories: [{ ...ds.expenseCategories![0], name: "Hizmetler", invoiceCategory: "Hizmet" }],
    invoices: [...base.invoices, { id: 9900, date: "2026-11-30", supplier: "Yıldız Muhasebe Ltd. Şti.", description: null, invoiceNo: null, category: "Hizmet", amount: 5000, discount: 0, payable: 6000, unpaid: false, note: null }],
  });
  assert.deepEqual(inv.duplicateExpenses("2026-11").flatMap((d) => d.matches.map((m) => [m.kind, m.label])), [["fatura", "Yıldız Muhasebe Ltd. Şti."]]);
  // Elle yazılmış Gelir-gider hücresi
  const manual = createModel({
    ...ds,
    expenseEntries: [],
    fixedExpenses: [...base.fixedExpenses, { ...ds.fixedExpenses.at(-1)!, name: "Doğalgaz", section: "faturalar" }],
    pnlEntries: [...base.pnlEntries, { month: "2026-11", rowKey: "manual:dogalgaz", amount: 1200, note: null }],
  });
  assert.deepEqual(manual.duplicateExpenses("2026-11").flatMap((d) => d.matches.map((m) => [m.kind, m.label])), [["elle", "DOĞALGAZ"]]);
  // Saf: bitmiş (tutarı olmayan) kalem uyarmaz
  assert.deepEqual(
    duplicateExpenses({ fixed: [{ id: 1, name: "Muhasebe", amount: 0, branchId: null }], invoices: [], expenses: [{ label: "Muhasebe", amount: 100, branchId: null }], manual: [] }),
    [],
  );
});
