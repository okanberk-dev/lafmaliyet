// Kasa raporlarından ay bilgisi (src/lib/cash-month.ts): ayın açık günü, POS cirosu, indirimi, ödenmezi ve kartlı
// satış oranı Z raporlarından türer; elle yazılan her zaman geçerlidir. Motor (POS komisyonu ayın oranıyla, Gelir-gider
// ciro hücresi), kapanmış veri ayları ve Kasa sayfasındaki tek satır.
// Çalıştırma: npx tsx --test tests/kasa-ay-bilgisi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { closedDataMonths } from "../src/app/panel/giderler/history-text";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import {
  kasaMonthLine,
  kasaValues,
  manualOf,
  missingSentence,
  missingText,
  monthRowEmpty,
  partialSentence,
  partialStart,
  resolveMonth,
  resolveMonths,
  tillMonths,
  tillOpenedOn,
  type MonthEntry,
  type TillRow,
} from "../src/lib/cash-month";
import { prorationDays } from "../src/lib/calc/engine";
import { addDays } from "../src/lib/reminders";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

/** Boşlukları (₺ ve gün-ay arasındaki bölünmez boşluk dahil) düz boşluğa çevirir */
const plain = (s: string) => s.replace(/ /g, " ");

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: beklenen ${expected}, bulunan ${actual}`);
}

const row = (date: string, o: Partial<TillRow> = {}): TillRow => ({ date, zTotal: 10_000, card: 7_000, mealCard: 1_000, discounts: null, offRevenue: null, ...o });

/** 1–30 Kasım her gün rapor; bazı günler indirim ve ödenmez girilmiş */
function november(skip: string[] = []): TillRow[] {
  const out: TillRow[] = [];
  for (let d = "2026-11-01"; d <= "2026-11-30"; d = addDays(d, 1)) {
    if (skip.includes(d)) continue;
    out.push(row(d, { discounts: d <= "2026-11-12" ? 100 : null, offRevenue: d <= "2026-11-15" ? 50 : null }));
  }
  return out;
}

const entry = (month: string, o: Partial<MonthEntry> = {}): MonthEntry => ({
  month,
  openDays: null,
  posRevenue: null,
  discounts: null,
  offRevenue: null,
  cardShare: null,
  note: null,
  ...o,
});

// ---------------------------------------------------------------- tillMonths

test("tillMonths: açık gün yalnız satış olan gün; ciro Z toplamı; oran (kart + yemek kartı) ÷ ciro, banka kartı payı ayrı", () => {
  const rows = [...november(), row("2026-10-31", { zTotal: 0, card: 0, mealCard: 0 })];
  // 31 Ekim (ilk rapor) ayın son günü: Ekim ay ortasında başlamış sayılır
  const [oct, nov] = tillMonths(rows, "2026-12-05");
  assert.equal(oct.month, "2026-10");
  assert.equal(oct.reported, 1);
  assert.equal(oct.openDays, 0, "Z toplamı 0 olan gün raporlu ama açık değil");
  assert.equal(oct.cardShare, null, "ciro yoksa oran yok");
  assert.equal(oct.partialFrom, "2026-10-31");
  assert.equal(nov.month, "2026-11");
  assert.equal(nov.reported, 30);
  assert.equal(nov.openDays, 30);
  assert.equal(nov.posRevenue, 300_000);
  assert.equal(nov.cardShare, 0.8);
  assert.equal(nov.bankShare, 0.7, "yalnız kart ÷ Z (yemek kartı hariç; E-43)");
  assert.equal(oct.bankShare, null, "ciro yoksa banka payı da yok");
  assert.equal(nov.partialFrom, null, "ilk rapor önceki ayda");
  assert.deepEqual(nov.missing, []);
  assert.equal(nov.lastDate, "2026-11-30");
  // Oran 4 ondalık; yanlış yazılmış ödeme türü %100'ü geçirmez
  const odd = tillMonths([row("2026-11-01", { zTotal: 3, card: 2, mealCard: 0 }), row("2026-11-02", { zTotal: 100, card: 150, mealCard: 0 })], "2026-11-02");
  assert.equal(odd[0].cardShare, 1);
  assert.equal(tillMonths([row("2026-11-01", { zTotal: 3, card: 2, mealCard: 0 })], "2026-11-01")[0].cardShare, 0.6667);
  assert.deepEqual(tillMonths([], "2026-11-30"), []);
});

test("tillMonths: indirim ve ödenmez yalnız girilen günlerden; hiç girilmediyse boş", () => {
  const [nov] = tillMonths(november(), "2026-12-01");
  assert.equal(nov.discounts, 1_200);
  assert.equal(nov.discountDays, 12);
  assert.equal(nov.offRevenue, 750);
  assert.equal(nov.offDays, 15);
  const [none] = tillMonths([row("2026-11-01"), row("2026-11-02")], "2026-11-02");
  assert.equal(none.discounts, null);
  assert.equal(none.discountDays, 0);
  assert.equal(none.offRevenue, null);
  // 0 girilen gün girilmiş sayılır
  const [zero] = tillMonths([row("2026-11-01", { discounts: 0 })], "2026-11-01");
  assert.equal(zero.discounts, 0);
  assert.equal(zero.discountDays, 1);
});

test("tillMonths: eksik günler; süren ayda düne kadar, bugünün raporu girildiyse o da", () => {
  const rows = november(["2026-11-05", "2026-11-12", "2026-11-20"]);
  const [closed] = tillMonths(rows, "2026-12-10");
  assert.deepEqual(closed.missing, ["2026-11-05", "2026-11-12", "2026-11-20"]);
  assert.equal(closed.from, "2026-11-01");
  assert.equal(closed.to, "2026-11-30");
  // Süren ay: bugün 18 Kasım, dün 17'si; 18'inin raporu henüz yok
  const running = rows.filter((r) => r.date <= "2026-11-17");
  const [r] = tillMonths(running, "2026-11-17");
  assert.equal(r.to, "2026-11-17");
  assert.deepEqual(r.missing, ["2026-11-05", "2026-11-12"]);
  // Bugünün raporu girildiyse aralık ona kadar uzar (bugün eksik sayılmaz)
  const [withToday] = tillMonths([...running, row("2026-11-18")], "2026-11-17");
  assert.equal(withToday.to, "2026-11-18");
  assert.equal(withToday.reported, 16);
});

test("tillMonths: ilk rapor ayın 1'inden sonraysa toplamlar ayın bir kısmını kapsar (partialFrom)", () => {
  const rows = [row("2026-10-20"), row("2026-10-21"), row("2026-10-23"), ...november()];
  const [oct, nov] = tillMonths(rows, "2026-12-01");
  assert.equal(oct.partialFrom, "2026-10-20");
  assert.equal(oct.from, "2026-10-20", "eksik günler ilk rapordan sayılır");
  assert.deepEqual(oct.missing.slice(0, 2), ["2026-10-22", "2026-10-24"]);
  assert.equal(nov.partialFrom, null);
  // Yalnız bir ayın satırları verilince ilk rapor ayrıca söylenir (Kasa sayfası)
  assert.equal(tillMonths(november(), "2026-12-01", "2026-10-20")[0].partialFrom, null);
  assert.equal(tillMonths(november(["2026-11-01"]), "2026-12-01")[0].partialFrom, "2026-11-02");
  assert.equal(tillMonths(november(["2026-11-01"]), "2026-12-01", "2026-10-20")[0].partialFrom, null);
});

// ---------------------------------------------------------------- Elle yazılan her zaman geçerli

test("kasaValues: ay ortasında başlayan ayda ve satışsız ayda toplamlar uygulanmaz; oran uygulanır", () => {
  const [oct, nov] = tillMonths([row("2026-10-20"), ...november()], "2026-12-01");
  assert.deepEqual(kasaValues(nov), { openDays: 30, posRevenue: 300_000, discounts: 1_200, offRevenue: 750, cardShare: 0.8 });
  assert.deepEqual(kasaValues(oct), { openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: 0.8 });
  const [closedAll] = tillMonths([row("2026-11-01", { zTotal: 0, card: 0, mealCard: 0 })], "2026-11-01");
  assert.deepEqual(kasaValues(closedAll), { openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: null });
});

test("resolveMonth: elle yazılan kazanır (0 dahil); boş alan kasadan; kasa yoksa bugünkü varsayılanlar", () => {
  const [nov] = tillMonths(november(), "2026-12-01");
  const kasa = resolveMonth("2026-11", undefined, nov);
  assert.equal(kasa.openDays, 30);
  assert.equal(kasa.posRevenue, 300_000);
  assert.equal(kasa.discounts, 1_200);
  assert.equal(kasa.offRevenue, 750);
  assert.equal(kasa.cardShare, 0.8);
  assert.deepEqual(kasa.sources, { openDays: "kasa", posRevenue: "kasa", discounts: "kasa", offRevenue: "kasa", cardShare: "kasa" });
  assert.equal(kasa.kasa?.till, nov);

  const typed = resolveMonth("2026-11", entry("2026-11", { openDays: 29, discounts: 0, cardShare: 0.85, note: "not" }), nov);
  assert.equal(typed.openDays, 29);
  assert.equal(typed.discounts, 0, "elle yazılan 0 kasanın önüne geçer");
  assert.equal(typed.posRevenue, 300_000);
  assert.equal(typed.cardShare, 0.85);
  assert.equal(typed.note, "not");
  assert.deepEqual(typed.sources, { openDays: "manual", posRevenue: "kasa", discounts: "manual", offRevenue: "kasa", cardShare: "manual" });
  assert.deepEqual(typed.kasa?.values, kasaValues(nov), "kasanın değeri ekran için yine taşınır");

  const none = resolveMonth("2026-09", entry("2026-09", { openDays: 30, posRevenue: 429_698 }), undefined);
  assert.deepEqual(
    { openDays: none.openDays, posRevenue: none.posRevenue, discounts: none.discounts, offRevenue: none.offRevenue, cardShare: none.cardShare, kasa: none.kasa },
    { openDays: 30, posRevenue: 429_698, discounts: 0, offRevenue: 0, cardShare: null, kasa: null },
  );
  assert.deepEqual(none.sources, { openDays: "manual", posRevenue: "manual", discounts: "none", offRevenue: "none", cardShare: "none" });
});

test("resolveMonth: ay ortasında başlayan ay (Ekim 2026) elle yazılanla kalır, yalnız oran kasadan", () => {
  const [oct] = tillMonths([row("2026-10-20"), row("2026-10-21")], "2026-10-21");
  const m = resolveMonth("2026-10", entry("2026-10", { openDays: 16, posRevenue: 293_909, discounts: 0, offRevenue: 0 }), oct);
  assert.equal(m.openDays, 16);
  assert.equal(m.posRevenue, 293_909);
  assert.equal(m.cardShare, 0.8);
  assert.equal(m.sources?.cardShare, "kasa");
  // Elle hiçbir şey yazılmamış olsa da toplamlar uygulanmaz
  const empty = resolveMonth("2026-10", undefined, oct);
  assert.equal(empty.openDays, null);
  assert.equal(empty.posRevenue, null);
  assert.equal(empty.sources?.openDays, "none");
});

test("resolveMonths: yalnız kasa raporu olan ay da gelir, sıralı", () => {
  const tills = tillMonths(november(), "2026-12-01");
  const months = resolveMonths([entry("2026-09", { openDays: 30 }), entry("2026-10", { openDays: 16 })], tills);
  assert.deepEqual(
    months.map((m) => m.month),
    ["2026-09", "2026-10", "2026-11"],
  );
  assert.equal(months[2].openDays, 30);
  assert.equal(months[2].note, null);
});

test("manualOf: kaynak varsa yalnız elle yazılan; yoksa (Excel verisi) boş olmayan, indirim ve ödenmezde 0 olmayan", () => {
  const [nov] = tillMonths(november(), "2026-12-01");
  const m = resolveMonth("2026-11", entry("2026-11", { posRevenue: 310_000 }), nov);
  assert.equal(manualOf(m, "posRevenue"), 310_000);
  assert.equal(manualOf(m, "openDays"), null, "kasadan gelen elle yazılmış sayılmaz");
  assert.equal(manualOf(m, "discounts"), null);
  assert.equal(manualOf(m, "cardShare"), null);
  assert.equal(manualOf(undefined, "openDays"), null);
  const legacy = { month: "2026-09", openDays: 30, posRevenue: 429_698, discounts: 0, offRevenue: 18_815, note: null };
  assert.equal(manualOf(legacy, "openDays"), 30);
  assert.equal(manualOf(legacy, "discounts"), null);
  assert.equal(manualOf(legacy, "offRevenue"), 18_815);
  assert.equal(manualOf(legacy, "cardShare"), null);
  // Elle yazılmış 0 kaynak bilindiğinde 0'dır
  assert.equal(manualOf(resolveMonth("2026-11", entry("2026-11", { discounts: 0 }), nov), "discounts"), 0);
});

test("boş ay satırı: elle yazılmış bir şey yoksa silinir; kasa raporu olan ayda elle yazılmış 0 değerdir", () => {
  const blank = { openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: null, note: null };
  assert.equal(monthRowEmpty(blank, true), true);
  assert.equal(monthRowEmpty(blank, false), true);
  // Eski satırların varsayılan sıfırı: kasa raporu yoksa etkin değer zaten 0, satır kalkar
  assert.equal(monthRowEmpty({ ...blank, discounts: 0, offRevenue: 0 }, false), true);
  // Kasa raporu varsa 0, kasadaki indirim toplamının yerine yazılmıştır: satırla birlikte kaybolmasın
  assert.equal(monthRowEmpty({ ...blank, discounts: 0 }, true), false);
  assert.equal(monthRowEmpty({ ...blank, offRevenue: 0 }, true), false);
  assert.equal(monthRowEmpty({ ...blank, cardShare: 0 }, false), false);
  assert.equal(monthRowEmpty({ ...blank, openDays: 0 }, false), false);
  assert.equal(monthRowEmpty({ ...blank, note: "deneme" }, false), false);
  // Satışlar ve sayım aynı kuralı kullanır; kasa raporu yalnız sıfır varken sorulur
  for (const file of ["src/server/actions/sales.ts", "src/server/actions/stock.ts"]) {
    const src = readFileSync(join(root, file), "utf8");
    assert.match(src, /const zeros = row\.discounts === 0 \|\| row\.offRevenue === 0;\s*if \(!monthRowEmpty\(row, zeros && \(await hasTillRowsIn\(month, (db|tx)\)\)\)\) return/, file);
  }
});

// ---------------------------------------------------------------- Metinler

test("eksik günler, ay ortası ve Kasa sayfasındaki tek satır", () => {
  assert.equal(missingText(["2026-11-05", "2026-11-12", "2026-11-20"]), "5, 12, 20 Kasım");
  assert.equal(missingText(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]), "1, 2, 3, 4, 5 Kasım ve 2 gün daha");
  assert.equal(missingText(["2026-10-31", "2026-11-01"]), "31 Ekim, 1 Kasım");
  assert.equal(missingText([]), "");
  assert.equal(missingSentence({ missing: ["2026-11-05", "2026-11-12", "2026-11-20"] }), "3 gün rapor yok: 5, 12, 20 Kasım. O günler açıksanız ciro ve açık gün eksik kalır.");
  assert.equal(plain(partialSentence({ partialFrom: "2026-10-20" })), "Kasa raporları 20 Ekim'de başladı; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan.");

  const [oct, nov] = tillMonths([row("2026-10-20"), ...november()], "2026-12-01");
  assert.equal(kasaMonthLine(resolveMonth("2026-11", undefined, nov)), "Bu ayın açık gün ve cirosu kasa raporlarından");
  assert.equal(
    plain(kasaMonthLine(resolveMonth("2026-11", entry("2026-11", { openDays: 30, posRevenue: 310_000 }), nov))!),
    "Bu ayın açık gün ve cirosu elle girildi (kasa raporlarında 30 gün, 300.000 ₺)",
  );
  assert.equal(kasaMonthLine(resolveMonth("2026-11", entry("2026-11", { posRevenue: 310_000 }), nov)), "Bu ayın açık günü kasa raporlarından, cirosu elle girildi");
  assert.equal(plain(kasaMonthLine(resolveMonth("2026-10", entry("2026-10", { openDays: 16 }), oct))!), "Kasa raporları 20 Ekim'de başladı; bu ayın açık gün ve cirosu elle girilir");
  assert.equal(kasaMonthLine(resolveMonth("2026-09", entry("2026-09", { openDays: 30 }), undefined)), null, "raporu olmayan ayda satır yok");
});

// ---------------------------------------------------------------- Motor

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };

test("motor: POS komisyonu ayın banka kartı payıyla (kasa raporu yoksa Ayarlar'daki kartlı oran); oranın kaynağı", () => {
  const base = createModel(ds);
  const st = base.settings;
  assert.deepEqual(base.cardShareOf("2026-09"), { rate: st.kartOrani, source: "ayar" });
  const sep = base.monthSales("2026-09");
  const posRevenue = base.monthInfo.get("2026-09")!.posRevenue!;
  assert.ok(Math.abs(base.pnlMonth("2026-09").cells.get("commission:pos")!.value! - posRevenue * st.komisyon * st.kartOrani) < 1e-6);

  // Eylül'ün kasa raporlarından oranı %80: komisyon onunla (satış satırları da), ürün fiyat hesabı Ayarlar'la kalır
  const [till] = tillMonths(
    Array.from({ length: 30 }, (_, i) => row(`2026-09-${String(i + 1).padStart(2, "0")}`)),
    "2026-10-01",
  );
  const months = ds.months.map((m) =>
    m.month === "2026-09"
      ? resolveMonth("2026-09", entry("2026-09", { openDays: m.openDays, posRevenue: m.posRevenue, discounts: m.discounts, offRevenue: m.offRevenue }), till)
      : m,
  );
  const model = createModel({ ...ds, months });
  assert.deepEqual(model.cardShareOf("2026-09"), { rate: 0.8, source: "kasa" });
  // Banka POS komisyonu yalnız banka kartıyla (7.000 ÷ 10.000): yemek kartının komisyonu kendi faturasıyla (E-43)
  assert.deepEqual(model.bankShareOf("2026-09"), { rate: 0.7, source: "kasa", split: true, meal: 0.1 });
  assert.ok(Math.abs(model.pnlMonth("2026-09").cells.get("commission:pos")!.value! - posRevenue * st.komisyon * 0.7) < 1e-6);
  // Satış raporunun ürün başına tahmini komisyonu kartlı oranla (kart + yemek kartı) kalır
  const ms = model.monthSales("2026-09");
  assert.ok(Math.abs(ms.commission - sep.commission * (0.8 / st.kartOrani)) < 1e-6);
  assert.ok(Math.abs(ms.lines[0].commission - ms.lines[0].line.revenue * st.komisyon * 0.8) < 1e-6);
  assert.equal(model.computeProduct(model.products[0].product).commission, base.computeProduct(base.products[0].product).commission);
  // Ekim: oran yok, Ayarlar'daki
  assert.equal(model.cardShareOf("2026-10").source, "ayar");
  // Elle yazılan oran
  const manual = createModel({ ...ds, months: ds.months.map((m) => (m.month === "2026-09" ? { ...m, cardShare: 0.9 } : m)) });
  assert.deepEqual(manual.cardShareOf("2026-09"), { rate: 0.9, source: "manual" });
});

test("motor: Gelir-gider ciro hücresi kasadan gelen ciroyu hesaplanan gibi taşır; elle yazılan üzerine yazılmıştır", () => {
  const [till] = tillMonths(november(), "2026-12-01");
  const following = createModel({ ...ds, months: [...ds.months, resolveMonth("2026-11", undefined, till)] });
  assert.deepEqual(following.pnlValue(following.pnlMonth("2026-11"), "revenue"), { value: 300_000, computed: 300_000, overridden: false });
  const typed = createModel({ ...ds, months: [...ds.months, resolveMonth("2026-11", entry("2026-11", { posRevenue: 310_000 }), till)] });
  assert.deepEqual(typed.pnlValue(typed.pnlMonth("2026-11"), "revenue"), { value: 310_000, computed: 300_000, overridden: true });
  // Kasa raporu olmayan ay (Excel verisi) bugünkü gibi
  const plainModel = createModel(ds);
  assert.deepEqual(plainModel.pnlValue(plainModel.pnlMonth("2026-09"), "revenue"), { value: 429_698, computed: null, overridden: true });
  // Ciro satırının açıklaması kasayı söyler
  const def = plainModel.pnlRowDefs(["2026-09"]).find((d) => d.key === "revenue")!;
  assert.match(def.hint!, /Boşsa kasa raporlarının Z toplamı kullanılır\./);
  // Yalnız kasadan gelen ay: açık gün oranı ve giderler o ayın günleriyle
  assert.equal(following.pnlMonth("2026-11").openDays, 30);
});

test("motor: kasadan gelen ayda kapalı gün kira ve maaşı düşürmez (takvim günü); elle girilen açık gün Excel'deki gibi", () => {
  // Kasım'da her gün rapor ama 15 Kasım kapalı (bayram) ve 20 Kasım'ın raporu hiç girilmedi
  const rows = november(["2026-11-20"]).map((r) => (r.date === "2026-11-15" ? { ...r, zTotal: 0, card: 0, mealCard: 0 } : r));
  const [till] = tillMonths(rows, "2026-12-01");
  assert.equal(till.openDays, 28);
  const full = createModel({ ...ds, months: [...ds.months, resolveMonth("2026-11", undefined, till)] });
  const pm = full.pnlMonth("2026-11");
  assert.equal(pm.openDays, 28, "açık gün bilgisi yine satış olan gün");
  assert.equal(pm.prorationDays, 30, "aylık kalemler ayın tamamı");
  const personnel = full.personnelFor("2026-11");
  close(pm.cells.get("personnel:net")!.value!, personnel.net, "maaş tam");
  const rent = ds.fixedExpenses.find((f) => f.name === "Kira")!;
  close(pm.cells.get(`fixed:${rent.id}`)!.value!, rent.amount, "kira tam");
  // Günlük kalem (personel yemeği) açık günle
  const meal = ds.fixedExpenses.find((f) => f.period === "gunluk")!;
  close(pm.cells.get(`fixed:${meal.id}`)!.value!, meal.amount * 28, "günlük kalem açık günle");
  // Süren ay: 1–16 Kasım raporları (dün 16 Kasım), 10 Kasım kapalı: aylık kalemler 16 / 30
  const [running] = tillMonths(november().filter((r) => r.date <= "2026-11-16").map((r) => (r.date === "2026-11-10" ? { ...r, zTotal: 0 } : r)), "2026-11-16");
  const mid = createModel({ ...ds, months: [...ds.months, resolveMonth("2026-11", undefined, running)] }).pnlMonth("2026-11");
  assert.equal(mid.openDays, 15);
  assert.equal(mid.prorationDays, 16);
  close(mid.cells.get(`fixed:${rent.id}`)!.value!, (rent.amount * 16) / 30, "kira bugüne kadar");
  // Açık gün elle yazıldıysa Excel'deki gibi açık gün ÷ ayın günü
  const typed = createModel({ ...ds, months: [...ds.months, resolveMonth("2026-11", entry("2026-11", { openDays: 25 }), till)] }).pnlMonth("2026-11");
  assert.equal(typed.prorationDays, 25);
  close(typed.cells.get(`fixed:${rent.id}`)!.value!, (rent.amount * 25) / 30, "elle açık gün");
  // Excel ayları (kasa yok) değişmez
  assert.equal(createModel(ds).pnlMonth("2026-07").prorationDays, createModel(ds).pnlMonth("2026-07").openDays);
});

test("kapanmış veri ayları: açık günü kasa raporlarından gelen ay da sayılır (sabit gider sürümü onu değiştirmez)", () => {
  const [till] = tillMonths(november(), "2026-12-01");
  const months = [...ds.months, resolveMonth("2026-11", undefined, till)];
  assert.deepEqual(closedDataMonths({ months, pnlEntries: [] }, "2026-12"), ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  // Sunucu kuralı (costs.ts dataMonths) aynı etkin değeri kullanır
  const src = readFileSync(join(root, "src/server/actions/costs.ts"), "utf8");
  assert.match(src, /async function dataMonths[\s\S]*?resolveMonths\(rows, tillMonths\(till, addDays\(businessDate\(\), -1\)\)\)[\s\S]*?m\.openDays \?\? 0\) > 0/);
});

test("yükleyici: etkin ay bilgisi kasa raporlarıyla birleşir; saat okumalardan sonra", () => {
  const src = readFileSync(join(root, "src/server/data/dataset.ts"), "utf8");
  // Kasa raporları ve onay bekleyen geç raporların günleri okumaların sonunda (dalga 10: eksik gün "onay bekliyor")
  // (ardından yalnız kapalı dönemler: docs/DONEM-KAPANISI.md)
  assert.match(src, /tillRows\(\),[\s\S]{0,400}?eq\(s\.staffRequests\.kind, "kasa-gec"\), eq\(s\.staffRequests\.status, "pending"\)\)\),\s*\/\/ Kapalı işaretli günler[\s\S]{0,400}?branchId: s\.specialDays\.branchId \}\)[\s\S]{0,80}?eq\(s\.specialDays\.kind, "kapali"\)\),\s*(\/\/[^\n]*\n\s*)?resolveBranchSetting\(CALENDAR_GROUP, scope, db\),\s*(\/\/[^\n]*\n\s*)*loadClosedPeriods\(db\)[^\n]*\n\s*\]\);/);
  // cacheComponents: saat (businessDate) veritabanı okumalarından sonra okunur
  assert.ok(src.indexOf("const today = businessDate()") > src.indexOf("tillRows(),"));
  assert.match(src, /const through = addDays\(today, -1\)/);
  // Tek şube seçiliyken o şubenin satırları (açılış günüyle); "Tümü"de şube şube çözülüp toplanır (denetim 13 Kasım HM-02)
  assert.match(src, /const lateDays = lateWaiting\.flatMap\(\(r\) => \(r\.day \? \[r\.day\] : \[\]\)\);/);
  // LafPOS satışlarının ilk günüyle: LafPOS günlerinin indirimi ayrı (TillMonth.lafposDiscounts; −90 ₺, 23 Kasım 2026)
  assert.match(src, /tillMonths\(rows, through, undefined, lateDays, closed, undefined, undefined, openedOn, lafposFrom, lafposBranch\)/);
  assert.match(src, /const lafposFrom = sales\.lafposSales\?\.countFrom \?\? null;/);
  // "Tümü"nün çözümü allBranchMonths'ta (Faz 5: şube seçiliyken işletme geneli giderin günü için de, companyMonths)
  assert.match(src, /branch !== null \? resolveMonths\(entriesOf\(months\), monthsOf\(till, opened\)\) : allBranchMonths\(months, till, closedPast\)/);
  assert.match(src, /const allBranchMonths = \([\s\S]{0,400}?return resolveBranchMonths\(/);
  assert.match(src, /months: monthInfo,/);
});

test("geç rapor: onay bekleyen gün eksik sayılmaya devam eder, yanına 'onay bekliyor' yazılır", () => {
  const rows = [row("2026-11-01"), row("2026-11-02"), row("2026-11-05")];
  const [nov] = tillMonths(rows, "2026-11-06", null, ["2026-11-04", "2026-10-30"]);
  assert.deepEqual(nov.missing, ["2026-11-03", "2026-11-04", "2026-11-06"]);
  assert.deepEqual(nov.pending, ["2026-11-04"]);
  assert.equal(missingSentence(nov), "3 gün rapor yok: 3, 4 (onay bekliyor), 6 Kasım. O günler açıksanız ciro ve açık gün eksik kalır.");
  // Yükleyici vermezse alan yok (eski davranış)
  assert.equal("pending" in tillMonths(rows, "2026-11-06")[0], false);
  assert.equal(missingText(["2026-10-31", "2026-11-04"], 5, ["2026-11-04"]), "31 Ekim, 4 Kasım (onay bekliyor)");
});

test("resolveMonths: aynı ayın iki şube satırı birleşir, boş satır elle yazılanı ezmez", () => {
  // Ay satırının anahtarı (ay, şube): "Tümü" seçiliyken ve silme engellerinin şubesiz okumasında aynı ay için
  // birden çok satır gelir. Eskiden `new Map(e.month)` sonuncuyu tutuyordu, yani şube başına açılan BOŞ bir ay
  // satırı (stock.ts / sales.ts ensureMonth) ötekinin elle girilmiş cirosunu ve açık gününü sessizce düşürüyordu.
  // Hangisinin kalacağı sıralamaya bağlıydı, yani sonuç belirsizdi (inceleme bulgusu, 4 Kasım 2026).
  const tuzla = entry("2026-11", { openDays: 30, posRevenue: 500_000, note: "Tuzla notu" });
  const marinaBos = entry("2026-11", {});
  for (const sira of [[tuzla, marinaBos], [marinaBos, tuzla]]) {
    const [m] = resolveMonths(sira, []);
    assert.equal(m.openDays, 30, "boş satır açık günü ezdi");
    assert.equal(m.posRevenue, 500_000, "boş satır ciroyu ezdi");
    assert.equal(m.note, "Tuzla notu", "boş satır notu ezdi");
  }
});

test("resolveMonths: iki şubenin ayrı alanları birleşir, tek satır olur", () => {
  const a = entry("2026-11", { openDays: 30 });
  const b = entry("2026-11", { posRevenue: 120_000 });
  const months = resolveMonths([a, b], []);
  assert.equal(months.length, 1, "aynı ay tek satır olmalı");
  assert.equal(months[0].openDays, 30);
  assert.equal(months[0].posRevenue, 120_000);
});

// ---------------------------------------------------------------- Sonradan açılan şube (denetim 21 Kasım #21)

test("tillOpenedOn: kütükteki açılış günü; boşsa Tuzla null (bugünkü kural), sonradan açılan şube ilk satırıyla; Tümü null", () => {
  assert.equal(tillOpenedOn(null), null, "Tümü");
  assert.equal(tillOpenedOn(undefined), null, "kütükte yok");
  assert.equal(tillOpenedOn({ id: "tuzla", openedOn: null }), null, "Tuzla: başından beri");
  assert.equal(tillOpenedOn({ id: "tuzla", openedOn: "2019-06-01" }), "2019-06-01");
  assert.equal(tillOpenedOn({ id: "marina", openedOn: null }), true, "açılış günü yazılmamış sonradan açılan şube");
  assert.equal(tillOpenedOn({ id: "marina", openedOn: "2026-11-05" }), "2026-11-05");
});

test("partialStart: ay ortasında başlayan ilk ay; açılış gününde ya da öncesinde başlayan rapor ayı yarım yapmaz", () => {
  assert.equal(partialStart("2026-10", "2026-10-20"), "2026-10-20", "Tuzla Ekim 2026: bugünkü kural");
  assert.equal(partialStart("2026-11", "2026-10-20"), null, "sonraki ay tam");
  assert.equal(partialStart("2026-11", "2026-11-01"), null, "ayın 1'i");
  assert.equal(partialStart("2026-11", null), null);
  assert.equal(partialStart("2026-11", "2026-11-05", "2026-11-05"), null, "açılış günü");
  assert.equal(partialStart("2026-11", "2026-11-05", "2026-11-10"), null, "açılıştan önce başlayan raporlar");
  assert.equal(partialStart("2026-11", "2026-11-08", "2026-11-05"), "2026-11-08", "açıldı, raporlar sonra başladı: ay yine yarım");
  assert.equal(partialStart("2026-11", "2026-11-05", true), null, "açılış günü yazılmamış: ilk satır açılıştır");
  assert.equal(partialStart("2026-11", "2026-11-05", null), "2026-11-05");
});

test("şube görünümü: Marina'nın açılış ayı yarım sayılmaz; ciro, açık gün ve sabit giderin günü kasadan (Tuzla ve Tümü bugünkü gibi)", () => {
  // Marina 5 Kasım'da açıldı, o günden beri her gün rapor (5–20 Kasım, 10.000 ₺)
  const marina = Array.from({ length: 16 }, (_, i) => row(addDays("2026-11-05", i), { branchId: "marina" }));
  // Eski davranış: açılış verilmezse ay ortasında başlamış sayılır, ciro ve açık gün düşer
  const [eski] = tillMonths(marina, "2026-11-20");
  assert.equal(eski.partialFrom, "2026-11-05");
  const [eskiAy] = resolveMonths([], [eski]);
  assert.deepEqual([eskiAy.openDays, eskiAy.posRevenue, eskiAy.sources?.posRevenue], [null, null, "none"]);
  for (const opened of [tillOpenedOn({ id: "marina", openedOn: null }), tillOpenedOn({ id: "marina", openedOn: "2026-11-05" })]) {
    const [t] = tillMonths(marina, "2026-11-20", undefined, undefined, undefined, undefined, undefined, opened);
    assert.equal(t.partialFrom, null, `açılış ${String(opened)}`);
    assert.deepEqual([t.openDays, t.posRevenue], [16, 160_000]);
    const [m] = resolveMonths([], [t]);
    assert.deepEqual([m.openDays, m.posRevenue, m.sources?.openDays, m.sources?.posRevenue], [16, 160_000, "kasa", "kasa"]);
    // Sabit gider ve personel açılıştan bu yana geçen günle (raporların kapsadığı takvim günü), 0 değil
    assert.equal(prorationDays(m), 16);
    assert.equal(kasaMonthLine(m), "Bu ayın açık gün ve cirosu kasa raporlarından");
  }
  // Açılış günü yazılmış ama raporlar sonra başlamış: o ay yine elle girilir
  const [late] = tillMonths(marina, "2026-11-20", undefined, undefined, undefined, undefined, undefined, "2026-11-01");
  assert.equal(late.partialFrom, "2026-11-05");
  // Tuzla (açılışı boş) ve Tümü: kasa raporları ay ortasında başladıysa bugünkü gibi
  const tuzla = Array.from({ length: 12 }, (_, i) => row(addDays("2026-10-20", i), { branchId: "tuzla" }));
  assert.equal(tillMonths(tuzla, "2026-10-31", undefined, undefined, undefined, undefined, undefined, tillOpenedOn({ id: "tuzla", openedOn: null }))[0].partialFrom, "2026-10-20");
  assert.equal(tillMonths([...tuzla, ...marina], "2026-11-20", undefined, undefined, undefined, undefined, undefined, tillOpenedOn(null))[0].partialFrom, "2026-10-20");
});

test("şube görünümü: yükleyici, Kasa'nın ay satırı ve geç rapor kartı şubenin açılışıyla aynı kuralı kullanır", () => {
  const dataset = readFileSync(join(root, "src/server/data/dataset.ts"), "utf8");
  assert.match(dataset, /const opened = tillOpenedOn\(branch\);/);
  assert.match(dataset, /firstEver, undefined, undefined, firstReport, undefined, opened, lafposFrom, lafposBranch\)\[0\]/, "satış listesinin dönemi");
  // Kapalı gün şubenin (denetim 13 Kasım KP-05): görünümün şubesinin ve işletme genelinin satırları
  assert.match(dataset, /const scopeClosedRows = closedRows\.filter\(\(r\) => closedRowApplies\(r, branch\?\.id\)\);/, "ay bilgisi: şubenin kapalı günleri");
  assert.match(dataset, /const closedPast = closedFor\(scopeClosedRows, reportRows\);/, "ay bilgisi");
  assert.match(dataset, /resolveMonths\(entriesOf\(months\), monthsOf\(till, opened\)\)/, "ay bilgisi: şubenin açılışıyla");
  // "Tümü"de her şube kendi açılış günüyle (Tümü'nün toplamında da açılış ayı yarım sayılmaz)
  assert.match(dataset, /tills: monthsOf\(\s*rowsOf\(\[id\]\),\s*tillOpenedOn\(branches\.find\(\(b\) => b\.id === id\)\),\s*closedFor\(closedRows\.filter\(\(r\) => closedRowApplies\(r, id\)\), rowsOf\(\[id\]\)\),\s*\)/);
  const kasa = readFileSync(join(root, "src/app/panel/kasa/page.tsx"), "utf8");
  assert.match(kasa, /const opened = tillOpenedOn\(branchList\.find\(\(b\) => b\.id === tillScope\)\);/);
  assert.match(kasa, /firstEver \?\? undefined, firstModpos, opened, undefined, lafposBranchOf\(branchList\)\)\[0\]/);
  const late = readFileSync(join(root, "src/server/data/cash-late.ts"), "utf8");
  assert.match(late, /if \(partialStart\(month, first, opened\)\) return "Kasa raporları ay ortasında başladı/);
  assert.match(late, /monthLineOf\(date, today, firstOf\.get\(branchId\) \?\? null, entry, openedOf\(branchId\)\)/);
  // Kuralın tek kopyası: elle yazılmış "first > ayın 1'i" karşılaştırması kalmadı
  assert.doesNotMatch(late, /first\.slice\(0, 7\) === month && first > /);
  assert.match(readFileSync(join(root, "src/lib/cash-month.ts"), "utf8"), /partialFrom: partialStart\(month, first, openedOn\),/);
});
