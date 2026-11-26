// Gelir-gider'in komisyon ve personel satırları (denetim B16): banka POS komisyonu yalnız banka kartı payıyla (E-43;
// yemek kartının komisyonu kendi faturalarıyla, iki kez sayılmaz), kanalı bulunamayan komisyon faturasında hücre uyarısı
// ve personel satırının bileşimi (E-44).
// Çalıştırma: npx tsx --test tests/gelir-gider-komisyon.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { channelNameResolver } from "../src/app/panel/tedarikciler/logic";
import { bankShareText, createModel, PERSONNEL_EXTRA_LABEL, staffCost } from "../src/lib/calc/engine";
import { fixedCostsForMonth } from "../src/lib/calc/insights";
import type { Dataset, Invoice } from "../src/lib/calc/types";
import { resolveMonth, tillMonths, type MonthEntry, type TillRow } from "../src/lib/cash-month";
import { channelOf } from "../src/lib/commission/channels";
import { addDays } from "../src/lib/reminders";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const base: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-12" };

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
  // Kasa kartı olan ay (23 Kasım 2026, hesap sözleşmesi §10): kart × oran, payın 4 ondalığa yuvarlanması yok (eskiden
  // 300.000 × oran × 0,6667 = 5.000,25). Şube kütüğü verilmediği için oran Ayarlar'daki
  close(pm.cells.get("commission:pos")!.value, 200_000 * st.komisyon, "commission:pos");
  assert.equal(pm.cells.get("commission:pos")!.info?.replace(/\u00a0/g, " "), "Banka POS komisyonu, yemek kartı hariç: kart 200.000 ₺ × %2,5 = 5.000 ₺.");
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

test("B16: kanal tedarikçi kartının diğer adıyla bulununca (Komisyon & hakediş'teki gibi) uyarı yok", () => {
  // Paraşüt'te unvanla gelen Pluxee faturası; sahip unvanı Pluxee kartının "Diğer adlar"ına ekledi (dataset.ts channelNames)
  const aliased = { ...invoice("Avantaj Kart Hizmetleri A.Ş.", 300), channelNames: ["Avantaj Kart Hizmetleri A.Ş.", "Pluxee", "Avantaj Kart Hizmetleri A.Ş."] };
  const pm = november({ invoices: [aliased] }).pnlMonth("2026-11");
  assert.equal(pm.cells.get("commission:pos")!.warn, undefined, "kanalı kartın adından bulunan fatura uyarı vermez");
  close(pm.cells.get("commission:Avantaj Kart Hizmetleri A.Ş.")!.value, 300, "fatura kendi satırında");
  // Kartı olmayan (ya da kartı kanal adı taşımayan) aynı fatura uyarır
  const lone = november({ invoices: [{ ...aliased, channelNames: ["Avantaj Kart Hizmetleri A.Ş."] }] }).pnlMonth("2026-11");
  assert.match(lone.cells.get("commission:pos")!.warn ?? "", /Avantaj Kart Hizmetleri A\.Ş\..*0 yazın/);
});

test("B16: channelNameResolver Komisyon & hakediş'in kuralı: diğer ad, kartta yazılı vergi no, öteki faturalar", () => {
  const cards = [{ id: 1, name: "Pluxee", aliases: ["Avantaj Kart Hizmetleri A.Ş."], taxNumber: "7810030532" }];
  const refs = [
    { supplier: "Pluxee", supplierTaxNumber: "1234567808" },
    { supplier: "PLX Ödeme Hizmetleri A.Ş.", supplierTaxNumber: "1234567808" },
  ];
  const names = channelNameResolver(cards, refs);
  assert.equal(channelOf(names("Avantaj Kart Hizmetleri A.Ş.")), "pluxee", "diğer ad");
  assert.equal(channelOf(names("Başka Unvan A.Ş.", "7810030532")), "pluxee", "kartta yazılı vergi no");
  assert.equal(channelOf(names("PLX Ödeme Hizmetleri A.Ş.")), "pluxee", "öteki faturalardaki vergi no üzerinden");
  assert.equal(channelOf(names("Akbank T.A.Ş.")), null, "kartı yok: kanal yok");
  assert.deepEqual(names("Akbank T.A.Ş."), ["Akbank T.A.Ş."]);
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
  assert.match(def.hint!, /banka kartı \(KDV dahil, yemek kartı hariç\) × şubenin POS oranı/);
  assert.match(def.hint!, /Satışlar'daki komisyon aynı tutardır/);
  assert.match(def.hint!, /0 yazın/);
});

test("B16: Genel bakış'ın 'Kart / POS komisyonu' satış raporunun tahmini olduğunu ve Gelir-gider'den farkını söyler", () => {
  const dash = readFileSync(join(root, "src/app/panel/dashboard-breakdowns.ts"), "utf8");
  const page = readFileSync(join(root, "src/app/panel/page.tsx"), "utf8");
  assert.match(dash, /kartlı oran \$\{rate\(model\.cardShareOf\(d\.month\)\.rate\)\} \(yemek kartı dahil\)/);
  assert.match(dash, /POS_COMMISSION_SALES_NOTE =\s*"Satış raporunun tahmini: kartlı oran yemek kartı satışını da içerir\. Gelir-gider'deki banka POS komisyonu yalnız banka kartı payıyla/);
  // Kasa kartı olan ayda (23 Kasım 2026, hesap sözleşmesi §10) iki rakam aynıdır: not bunu söyler; süren ayda liste kasa
  // raporlarından kısaysa Satışlar listenin günleriyle sayar, not farkı ve Gelir-gider'in tutarını söyler (posCommissionNote)
  assert.match(page, /label: "Kart \/ POS komisyonu",[\s\S]{0,700}info: salesPos \? posCommissionNote\(salesPos\) : POS_COMMISSION_SALES_NOTE/);
});

// ---------------------------------------------------------------- E-44 personel satırı

test("E-44: personel satırı maliyet − net: çalışan kesintisi, işveren payı ve ekler; etiket ve hücre bileşimi bunu söyler", () => {
  // Yemek / yol / prim eki olan bir personel: hücre ekleri ve çalışanın kendi kesintisini de taşır
  const staff = base.staff.map((x, i) => (i === 0 ? { ...x, extras: 4_000 } : x));
  const model = createModel({ ...base, staff });
  const st = model.settings;
  const pm = model.pnlMonth("2026-09");
  const pers = model.personnelFor("2026-09");
  const parts = pers.rows.map((r) => staffCost(r.staff, st));
  const deductions = parts.reduce((a, r) => a + r.deductions, 0);
  const employer = parts.reduce((a, r) => a + r.employerSgk + r.employerUnemployment, 0);
  const extras = parts.reduce((a, r) => a + r.staff.extras, 0);
  assert.ok(extras >= 4_000, "ek ödeme var");
  const cell = pm.cells.get("personnel:employer")!;
  close(cell.value, (deductions + employer + extras) * pm.ratio, "hücre = kesinti + işveren payı + ekler");
  close(cell.value, (pers.total - pers.net) * pm.ratio, "hücre = maliyet − net");
  // Yalnız işveren payı olsaydı kesinti ve ekler düşerdi: hücre ondan büyük
  assert.ok(cell.value! > employer * pm.ratio + 1);
  // Bileşim metni üç parçayı yazar
  assert.match(cell.info!, /çalışanların SGK \+ işsizlik kesintisi/);
  assert.match(cell.info!, /işveren SGK \+ işsizlik/);
  assert.match(cell.info!, /yemek \/ yol \/ prim/);
  // Etiket ve ipucu: bileşimle uyuşur, bordronun yalnız işveren payını yazdırmaz
  const def = model.pnlRowDefs(["2026-09"]).find((d) => d.key === "personnel:employer")!;
  assert.equal(def.label, PERSONNEL_EXTRA_LABEL);
  assert.match(def.label, /KESİNTİLER \+ EK ÖDEMELER/);
  assert.doesNotMatch(def.label, /\(işveren\)/);
  assert.match(def.hint!, /yalnız işveren payını yazmayın/);
  assert.match(def.hint!, /yemek \/ yol \/ prim/);
  // Genel bakış aynı satırı aynı adla gösterir
  const line = fixedCostsForMonth(model, "2026-09").lines.find((l) => l.key === "personnel:employer")!;
  assert.equal(line.label, "Personel SGK, kesintiler + ek ödemeler (maliyet − net)");
});

test("E-44: bileşim metni gün oranıyla ve parçalarının toplamı hücreyi tutar", () => {
  const model = createModel(base);
  // Ekim: ayın bir kısmı açık (Excel verisi, 16 gün): parçalar gün oranıyla
  const pm = model.pnlMonth("2026-10");
  const cell = pm.cells.get("personnel:employer")!;
  assert.ok(pm.ratio < 1);
  assert.match(cell.info!, new RegExp(`^Bu ay \\(${pm.prorationDays} / ${pm.dim} gün\\): `));
  const amounts = [...cell.info!.matchAll(/([\d.]+)\s₺/g)].map((m) => Number(m[1].replace(/\./g, "")));
  assert.equal(amounts.length, 3);
  assert.ok(Math.abs(amounts.reduce((a, b) => a + b, 0) - cell.value!) <= 2, `parçalar ${amounts.join(" + ")} ≈ ${cell.value}`);
});
