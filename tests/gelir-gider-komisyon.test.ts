// Gelir-gider'in komisyon ve personel satırları (denetim B16): banka POS komisyonu yalnız banka kartı payıyla (E-43;
// yemek kartının komisyonu kendi faturalarıyla, iki kez sayılmaz), kanalı bulunamayan komisyon faturasında hücre uyarısı
// ve personel satırının bileşimi (E-44).
// Çalıştırma: npx tsx --test tests/gelir-gider-komisyon.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bankShareText, createModel } from "../src/lib/calc/engine";
import type { Dataset, Invoice } from "../src/lib/calc/types";
import { resolveMonth, tillMonths, type MonthEntry, type TillRow } from "../src/lib/cash-month";
import { addDays } from "../src/lib/reminders";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-12" };

function close(actual: number | null | undefined, expected: number, label: string) {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-6, `${label}: beklenen ${expected}, bulunan ${actual}`);
}

/** Kasım'ın 30 günü: Z 10.000 (kart 200.000 ÷ 30, yemek kartı 1.000), ayın toplamı Z 300.000 · kart 200.000 · yemek kartı 30.000 */
function novemberRows(): TillRow[] {
  const out: TillRow[] = [];
  for (let d = "2026-11-01"; d <= "2026-11-30"; d = addDays(d, 1)) {
    out.push({ date: d, zTotal: 10_000, card: 200_000 / 30, mealCard: 1_000, discounts: null, offRevenue: null });
  }
  return out;
}

const entry = (o: Partial<MonthEntry> = {}): MonthEntry => ({ month: "2026-11", openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: null, note: null, ...o });

let nextId = 9000;
const invoice = (supplier: string, amount: number, date = "2026-11-30"): Invoice => ({
  id: nextId++,
  date,
  supplier,
  description: null,
  invoiceNo: null,
  category: "Komisyon",
  amount,
  discount: 0,
  payable: amount * 1.2,
  unpaid: false,
  note: null,
});

/** Seed + Kasım (kasa raporlarıyla) + verilen faturalar ve Gelir-gider girişleri */
function november(o: { entry?: Partial<MonthEntry>; invoices?: Invoice[]; pnl?: Dataset["pnlEntries"] } = {}) {
  const [till] = tillMonths(novemberRows(), "2026-12-01");
  return createModel({
    ...base,
    months: [...base.months, resolveMonth("2026-11", entry(o.entry), till)],
    invoices: [...base.invoices, ...(o.invoices ?? [])],
    pnlEntries: [...base.pnlEntries, ...(o.pnl ?? [])],
  });
}

// ---------------------------------------------------------------- E-43 POS komisyonu

test("E-43: kart 200 bin, yemek kartı 30 bin, Z 300 bin: banka POS komisyonu yalnız kart ÷ Z ile", () => {
  const model = november();
  const st = model.settings;
  const bank = model.bankShareOf("2026-11");
  assert.equal(bank.source, "kasa");
  assert.equal(bank.split, true);
  close(bank.rate, 0.6667, "banka kartı payı (4 ondalık)");
  close(bank.meal, 0.1, "yemek kartı payı");
  // Kartlı satış oranı yemek kartını içerir (satış raporunun tahmini komisyonu onunla kalır)
  close(model.cardShareOf("2026-11").rate, 0.7667, "kartlı satış oranı");
  const pm = model.pnlMonth("2026-11");
  close(pm.cells.get("commission:pos")!.value, 300_000 * st.komisyon * 0.6667, "commission:pos");
  assert.equal(pm.cells.get("commission:pos")!.info, "Kart payı %66,7: kasa raporlarından kart ÷ Z toplamı (yemek kartı %10,0 hariç).");
  assert.equal(pm.cells.get("commission:pos")!.warn, undefined, "kanalı belli olmayan fatura yok: uyarı yok");
});

test("E-43: Pluxee faturası commission:pos'u değiştirmez, kendi satırında bir kez sayılır", () => {
  const without = november().pnlMonth("2026-11");
  const pm = november({ invoices: [invoice("Pluxee Türkiye", 1_800)] }).pnlMonth("2026-11");
  close(pm.cells.get("commission:pos")!.value, without.cells.get("commission:pos")!.value!, "commission:pos aynı");
  close(pm.cells.get("commission:Pluxee Türkiye")!.value, 1_800, "Pluxee satırı");
  close(pm.sections.komisyon, without.sections.komisyon + 1_800, "komisyon toplamı yalnız fatura kadar artar");
  assert.equal(pm.cells.get("commission:pos")!.warn, undefined, "yemek kartı kanalı: uyarı yok");
});

test("E-43: kanalı bulunamayan komisyon faturası (banka) tahmin hücresinde uyarı; 0 yazılınca uyarı ve çift sayım yok", () => {
  const bankInv = invoice("Garanti BBVA (POS)", 5_000);
  const pm = november({ invoices: [bankInv, invoice("Yemek Sepeti", 300)] }).pnlMonth("2026-11");
  const cell = pm.cells.get("commission:pos")!;
  assert.ok(cell.warn, "uyarı var");
  assert.match(cell.warn!, /Garanti BBVA/);
  assert.doesNotMatch(cell.warn!, /Yemek Sepeti/, "platform kanalı uyarıya girmez");
  assert.match(cell.warn!, /0 yazın/);
  // Sahip hücreye 0 yazdı: banka faturası gerçek tutardır, tahmin sayılmaz, uyarı kalkar
  const fixed = november({ invoices: [bankInv], pnl: [{ month: "2026-11", rowKey: "commission:pos", amount: 0, note: null }] }).pnlMonth("2026-11");
  const c2 = fixed.cells.get("commission:pos")!;
  assert.equal(c2.value, 0);
  assert.equal(c2.overridden, true);
  assert.equal(c2.warn, undefined);
  close(fixed.sections.komisyon, 5_000, "komisyon yalnız bankanın faturası");
});

test("E-43: elle yazılan kartlı orandan kasa raporlarındaki yemek kartı payı düşülür", () => {
  const model = november({ entry: { cardShare: 0.8 } });
  const bank = model.bankShareOf("2026-11");
  assert.deepEqual(bank, { rate: 0.7, source: "manual", split: true, meal: 0.1 });
  close(model.pnlMonth("2026-11").cells.get("commission:pos")!.value, 300_000 * model.settings.komisyon * 0.7, "commission:pos");
  assert.equal(bankShareText(bank), "Kart payı %70,0: elle yazılan kartlı orandan kasa raporlarındaki yemek kartı payı (%10,0) düşüldü.");
});

test("E-43: kasa raporu olmayan ay kartlı satış oranıyla kalır (yemek kartı payı ayrılamadı)", () => {
  const model = createModel(base);
  const st = model.settings;
  const bank = model.bankShareOf("2026-09");
  assert.deepEqual(bank, { rate: st.kartOrani, source: "ayar", split: false, meal: null });
  const pm = model.pnlMonth("2026-09");
  close(pm.cells.get("commission:pos")!.value, pm.revenue! * st.komisyon * st.kartOrani, "commission:pos bugünkü gibi");
  assert.match(pm.cells.get("commission:pos")!.info!, /Ayarlar; bu ay kasa raporu yok, yemek kartı payı ayrılamadı/);
  // Elle yazılan kartlı oran, kasa raporu yokken olduğu gibi
  const manual = createModel({ ...base, months: base.months.map((m) => (m.month === "2026-09" ? { ...m, cardShare: 0.9 } : m)) });
  assert.deepEqual(manual.bankShareOf("2026-09"), { rate: 0.9, source: "manual", split: false, meal: null });
  assert.equal(bankShareText(manual.bankShareOf("2026-09")), "Kartlı satış oranı %90,0 (elle yazılan; kasa raporu yok, yemek kartı payı ayrılamadı).");
});

test("E-43: satır ipucu yemek kartının hariç olduğunu ve banka faturasında 0 yazmayı söyler", () => {
  const model = november();
  const def = model.pnlRowDefs(["2026-11"]).find((d) => d.key === "commission:pos")!;
  assert.match(def.hint!, /banka kartı payı/);
  assert.match(def.hint!, /yemek kartı hariç/);
  assert.match(def.hint!, /0 yazın/);
});
