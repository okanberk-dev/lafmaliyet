// Part-time günlük modeli (Faz 5, sahibin kararı 12, 23 Kasım 2026): Aralık 2026'dan itibaren part-time kişi kendi
// satırıdır: günlük ücret (işletmenin çağrılan gün başına maliyeti, SGK brütleştirmesi yok), yemek kartı (günlük tutar ×
// çağrıldığı gün) ve ek ödeme (brütleştirilmez). Çağrıldığı gün = Vardiya'daki o kişinin, o şubedeki, o aydaki çalışma
// vardiyası (shifts.kind = work). Satır Vardiya kişisine açıkça bağlanır: panel hesabı (staff.userId → "u:<id>") ya da
// hesabı olmayan ad ("n:<ad>"). Bağlantısız part-time tahmin edilmez, uyarılır. Haftalık "Part-time çalışan" sabit gideri
// Kasım 2026 için kalır; ikisi aynı ayda sayılırsa uyarı.
// Çalıştırma: npx tsx --test tests/personel-part-time.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import ExcelJS from "exceljs";

import { buildWorkbook } from "../src/app/api/export/workbook";
import { planInputFromModel } from "../src/lib/cash-plan";
import { createModel, staffCost, staffShiftRef } from "../src/lib/calc/engine";
import { alerts } from "../src/lib/calc/insights";
import { staffWarnings } from "../src/lib/calc/personnel";
import { linkConflict, linkedDeleteText, type LinkRow } from "../src/lib/staff-link";
import type { Dataset, Staff } from "../src/lib/calc/types";
import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { taxPayrollFromModel } from "../src/lib/tax/payroll";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel: Dataset = datasetFromSeed(data);
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

/** Aralık 2026 part-time: günlük 1.500 ₺, yemek kartı, aylık 2.000 ₺ ek; Vardiya'da hesabıyla (u:7) */
const AYSE: Staff = {
  id: 201,
  name: "Ayşe",
  netSalary: 0,
  extras: 2_000,
  active: true,
  startMonth: "2026-12",
  endMonth: null,
  branchId: "marina",
  kind: "part_time",
  dailyWage: 1_500,
  mealCard: true,
  userId: 7,
};
/** Hesabı olmayan part-time: Vardiya'da adıyla (n:mert) */
const MERT: Staff = { ...AYSE, id: 202, name: "Mert", userId: null, personRef: "n:mert", mealCard: false, extras: 0, dailyWage: 1_200 };
/** Bağlantısız part-time: günü bilinmiyor */
const ECE: Staff = { ...AYSE, id: 203, name: "Ece", userId: null, personRef: null, extras: 0 };

const day = (d: number, ref: string, branchId = "marina") => ({ branchId, personRef: ref, date: `2026-12-${String(d).padStart(2, "0")}` });
/** Ayşe Marina'da 10 gün; Tuzla'da 2 gün (o şubenin satırı değil); Mert 4 gün; Kasım'da Ayşe'nin 3 günü (satırı Aralık'tan) */
const SHIFTS = [
  ...[1, 2, 3, 5, 8, 9, 12, 15, 19, 22].map((d) => day(d, "u:7")),
  day(4, "u:7", "tuzla"),
  day(6, "u:7", "tuzla"),
  ...[2, 9, 16, 23].map((d) => day(d, "n:mert")),
  { branchId: "marina", personRef: "u:7", date: "2026-11-28" },
  { branchId: "marina", personRef: "u:7", date: "2026-11-29" },
  { branchId: "marina", personRef: "u:7", date: "2026-11-30" },
];
const dec = { month: "2026-12", openDays: 31, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null };
const nov = { month: "2026-11", openDays: 30, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null };
const ds = (staff: Staff[], patch: Partial<Dataset> = {}): Dataset => ({
  ...excel,
  currentMonth: "2027-01",
  months: [...excel.months, nov, dec],
  staff,
  shifts: SHIFTS,
  ...patch,
});

test("staffCost: part-time = günlük ücret × çağrıldığı gün + yemek kartı × gün + ek; brütleştirme yok, SGK yok", () => {
  const c = staffCost(AYSE, DEFAULT_SETTINGS, { calledDays: 10 });
  assert.deepEqual([c.gross, c.deductions, c.employerSgk, c.employerUnemployment], [0, 0, 0, 0]);
  close(c.dailyWages, 15_000, "1.500 × 10");
  close(c.mealCard, 3_300, "330 × 10 (çağrıldığı gün)");
  close(c.total, 15_000 + 3_300 + 2_000, "toplam");
  assert.equal(c.calledDays, 10);
  // Bağlantısız: gün bilinmiyor, tutar tahmin edilmez (yalnız ek ödeme)
  const u = staffCost(ECE, DEFAULT_SETTINGS);
  assert.equal(u.calledDays, null);
  assert.equal(u.dailyWages, 0);
  // Tam zamanlıda alanlar boş
  const f = staffCost({ id: 1, name: "Tam", netSalary: 30_000, extras: 0, active: true }, DEFAULT_SETTINGS);
  assert.deepEqual([f.dailyWages, f.calledDays], [0, null]);
});

test("Vardiya bağlantısı: hesap u:<id>, hesapsız ad n:<ad>; çağrıldığı gün yalnız o şubede ve o ayda, izin günü sayılmaz", () => {
  assert.equal(staffShiftRef(AYSE), "u:7");
  assert.equal(staffShiftRef(MERT), "n:mert");
  assert.equal(staffShiftRef(ECE), null);
  const m = createModel(ds([AYSE, MERT, ECE]));
  const rows = new Map(m.personnelFor("2026-12").rows.map((r) => [r.staff.name, r]));
  assert.equal(rows.get("Ayşe")!.calledDays, 10, "Marina'daki 10 gün (Tuzla'daki 2 gün değil)");
  assert.equal(rows.get("Mert")!.calledDays, 4);
  assert.equal(rows.get("Ece")!.calledDays, null);
  close(rows.get("Ayşe")!.total, 20_300, "Ayşe Aralık");
  close(rows.get("Mert")!.total, 4_800, "Mert Aralık 1.200 × 4");
  // Kasım'da satırı yok (Aralık'tan): Kasım'ın Vardiya günleri sayılmaz
  assert.equal(m.personnelFor("2026-11").rows.length, 0);
});

test("Gelir-gider: PART-TIME (GÜNLÜK) satırı ücret + ek (gün oranı yok), yemek kartı kendi satırında; bağlantısız uyarılı", () => {
  const m = createModel(ds([AYSE, MERT, ECE]));
  const pm = m.pnlMonth("2026-12");
  close(pm.cells.get("personnel:parttime")!.value!, 15_000 + 2_000 + 4_800, "Ayşe ücret + ek, Mert ücret");
  close(pm.cells.get("personnel:meal")!.value!, 3_300, "Ayşe'nin yemek kartı (10 gün)");
  assert.equal(pm.cells.get("personnel:net")!.value, 0, "tam zamanlı yok");
  assert.match(pm.cells.get("personnel:parttime")!.warn!, /Ece/);
  assert.match(pm.cells.get("personnel:parttime")!.info!, /Ayşe: 10 gün × 1\.500\s₺/);
  const row = m.pnlRowDefs(["2026-12"]).find((r) => r.key === "personnel:parttime")!;
  assert.equal(row.section, "personel");
  assert.match(row.hint!, /SGK brütleştirmesi yok/);
  // Kimsede part-time yoksa satır yok
  assert.equal(createModel(ds([])).pnlRowDefs(["2026-12"]).some((r) => r.key === "personnel:parttime"), false);
});

test("uyarılar: bağlantısız part-time; aynı ayda haftalık 'Part-time çalışan' kalemi ve günlük part-time satırı (çift sayım)", () => {
  const weekly = excel.fixedExpenses.find((f) => f.name === "Part-time çalışan")!;
  assert.equal(weekly.period, "haftalik");
  // Haftalık kalem Kasım'da biter (sahibin veri işi): Aralık'ta çift sayım yok
  const ended = excel.fixedExpenses.map((f) => (f.id === weekly.id ? { ...f, endMonth: "2026-11" } : f));
  const ok = createModel(ds([AYSE], { fixedExpenses: ended }));
  // (Ayşe'nin Tuzla'daki 2 günü ayrı uyarı: parttime-other-branch, aşağıdaki testte)
  assert.deepEqual(staffWarnings(ok, "2026-12").map((w) => w.kind).filter((k) => k.startsWith("parttime") && k !== "parttime-other-branch"), []);
  // Haftalık kalem Aralık'ta da etkin ve Ayşe'nin çağrıldığı günü var: uyarı
  const both = createModel(ds([AYSE]));
  const w = staffWarnings(both, "2026-12").find((x) => x.kind === "parttime-double")!;
  assert.ok(w, "çift sayım uyarısı");
  assert.match(w.detail, /Part-time çalışan/);
  assert.match(w.detail, /Ayşe/);
  assert.ok(alerts(both, "2026-12").some((a) => a.title === w.title), "Genel bakış");
  // Kasım: haftalık kalem var, günlük satır yok → uyarı yok
  assert.equal(staffWarnings(both, "2026-11").some((x) => x.kind === "parttime-double"), false);
  // Bağlantısız part-time: tutar tahmin edilmez, uyarı
  const un = staffWarnings(createModel(ds([ECE], { fixedExpenses: ended })), "2026-12").find((x) => x.kind === "parttime-unlinked")!;
  assert.ok(un, "bağlantısız uyarısı");
  assert.deepEqual(un.staffIds, [ECE.id]);
  assert.match(un.detail, /Vardiya/);
});

test("süren ay: Gelir-gider yalnız kasa raporlarının son gününe kadarki vardiyaları sayar (ileri günlerin planı değil)", () => {
  const till = { month: "2026-12", from: "2026-12-01", to: "2026-12-10", reported: 10, openDays: 10, posRevenue: 100_000, discounts: null, discountDays: 0, offRevenue: null, offDays: 0, cardShare: null, missing: [] };
  const running = { ...dec, openDays: 10, kasa: { values: { openDays: 10, posRevenue: 100_000, discounts: null, offRevenue: null, cardShare: null }, till } } as unknown as Dataset["months"][number];
  const m = createModel(ds([AYSE], { currentMonth: "2026-12", months: [...excel.months, nov, running] }));
  // 1, 2, 3, 5, 8, 9 Aralık: 6 gün (12, 15, 19, 22 ileri tarihli plan)
  assert.equal(m.personnelFor("2026-12").rows[0].calledDays, 6);
});

test("süren ay kasa raporu yokken: maaş satırının gün oranıyla aynı kaynak (ay bilgisi yok → 0, elle açık gün → o güne kadar); Tümü'de kişinin şubesinin raporları", () => {
  // İnceleme bulgusu (LM-4, 2. tur, 2): kesme yalnız kasa raporu olan ayda uygulanıyordu; ay bilgisi yokken ya da yalnız
  // elle açık gün varken ayın bütün planı (ileri günler dahil) sayılırken tam zamanlı maaş 0 ya da 3/31 oranlanıyordu
  const none = createModel(ds([AYSE], { currentMonth: "2026-12", months: [...excel.months, nov] }));
  assert.equal(none.personnelFor("2026-12").rows[0].calledDays, 0, "Aralık bilgisi yok: tam zamanlı maaş gibi 0");
  assert.equal(none.pnlMonth("2026-12").cells.get("personnel:parttime")!.value, 2_000, "yalnız ek ödeme");
  const manual = createModel(ds([AYSE], { currentMonth: "2026-12", months: [...excel.months, nov, { ...dec, openDays: 3 }] }));
  assert.equal(manual.personnelFor("2026-12").rows[0].calledDays, 3, "elle 3 açık gün: 1, 2, 3 Aralık");
  // Vergi bordrosu ve nakit planı ayın bütün planını sayar
  close(taxPayrollFromModel(none, 2026, DEFAULT_TAX_SETTINGS).get("2026-12")!.people[0].cost, 20_300, "bordro bütün plan");
  // Tümü: Marina'nın raporları 3 Aralık'ta, Tuzla'nınki 10 Aralık'ta; Ayşe'nin Marina satırı Marina'nın son gününe kadar
  const till = (to: string, n: number) => ({ month: "2026-12", from: "2026-12-01", to, reported: n, openDays: n, posRevenue: 10_000 * n, discounts: null, discountDays: 0, offRevenue: null, offDays: 0, cardShare: null, missing: [] });
  const kasa = (to: string, n: number) =>
    ({ ...dec, openDays: n, posRevenue: 10_000 * n, sources: { openDays: "kasa" }, kasa: { values: { openDays: n, posRevenue: 10_000 * n, discounts: null, offRevenue: null, cardShare: null }, till: till(to, n) } }) as unknown as Dataset["months"][number];
  const all = { ...kasa("2026-12-10", 10), byBranch: { marina: kasa("2026-12-03", 3), tuzla: kasa("2026-12-10", 10) } } as Dataset["months"][number];
  const tumu = createModel(ds([AYSE], { currentMonth: "2026-12", months: [...excel.months, nov, all] }));
  assert.equal(tumu.personnelFor("2026-12").rows[0].calledDays, 3, "Tümü: Marina'nın raporları 3 Aralık'a kadar");
});

test("aynı hesap iki şubede: her şubenin satırı kendi şubesindeki günleri sayar, hesap şube başına bir satıra bağlanabilir; satırsız şubedeki günler uyarılır", () => {
  // İnceleme bulgusu (LM-4, 2. tur, 1): başka şubedeki vardiya o şubenin satırına aitti ama bağlantı kuralı aynı hesabı
  // ikinci bir şubenin satırına bağlatmıyordu: Tuzla'daki 2 gün hiçbir yerde ödenmiyor, hiçbir şey uyarmıyordu
  const row = (p: Partial<LinkRow>): LinkRow => ({ id: null, name: "Ayşe", branchId: "marina", userId: 7, personRef: null, startMonth: "2026-12", endMonth: null, ...p });
  assert.equal(linkConflict(row({ id: 2, name: "Ayşe (Tuzla)", branchId: "tuzla" }), [row({ id: 1 })]), null, "başka şubede serbest");
  assert.match(linkConflict(row({ id: 2, name: "Ayşe 2" }), [row({ id: 1 })]) ?? "", /aynı şubede ve aynı aylarda "Ayşe" maaş satırına bağlı/);
  const AYSE_TUZLA: Staff = { ...AYSE, id: 204, name: "Ayşe (Tuzla)", branchId: "tuzla", mealCard: false, extras: 0 };
  const m = createModel(ds([AYSE, AYSE_TUZLA]));
  const rows = new Map(m.personnelFor("2026-12").rows.map((r) => [r.staff.name, r]));
  assert.equal(rows.get("Ayşe")!.calledDays, 10);
  assert.equal(rows.get("Ayşe (Tuzla)")!.calledDays, 2, "Tuzla'daki 2 gün Tuzla satırında");
  close(m.pnlMonth("2026-12").cells.get("personnel:parttime")!.value!, 15_000 + 2_000 + 3_000, "Tümü iki şubenin günlerini sayar");
  close(taxPayrollFromModel(m, 2026, DEFAULT_TAX_SETTINGS).get("2026-12")!.people.reduce((a, p) => a + p.cost, 0), 20_300 + 3_000, "bordro");
  assert.equal(staffWarnings(m, "2026-12").some((x) => x.kind === "parttime-other-branch"), false, "Tuzla satırı var: uyarı yok");
  // Tuzla satırı yok: Tuzla'daki 2 gün hiçbir satıra girmiyor, uyarılır (tutar değişmez)
  const w = staffWarnings(createModel(ds([AYSE])), "2026-12").find((x) => x.kind === "parttime-other-branch")!;
  assert.ok(w, "satırsız şube uyarısı");
  assert.deepEqual(w.staffIds, [AYSE.id]);
  assert.match(w.detail, /Ayşe: tuzla şubesinde 2 gün/);
  assert.ok(alerts(createModel(ds([AYSE])), "2026-12").some((a) => a.title === w.title), "Genel bakış");
});

test("vergi bordrosu ve nakit planı: part-time brütleştirilmez (net 0, ek = bütün maliyet), planlanan bütün vardiyalar", () => {
  const m = createModel(ds([AYSE]));
  const p = taxPayrollFromModel(m, 2026, DEFAULT_TAX_SETTINGS).get("2026-12")!;
  const ayse = p.people.find((x) => x.staffId === AYSE.id)!;
  assert.deepEqual([ayse.gross, ayse.isverenSgk], [0, 0]);
  close(ayse.cost, 20_300, "bütün maliyet");
  assert.equal(p.totals.support, 0, "asgari ücret desteği part-time'a yazılmaz");
  const plan = planInputFromModel(m, "2026-12-05");
  close(plan.months["2026-12"].payroll.net, 20_300, "nakit planı personele giden");
});

test("Maaşlar ve eylem: tür, günlük ücret, Vardiya bağlantısı (hesap ya da ad), önseçim yok", () => {
  const costs = read("src/server/actions/costs.ts");
  assert.match(costs, /kind: z\.enum\(\["full_time", "part_time"\]\)/);
  assert.match(costs, /dailyWage: z\.number\(\)/);
  assert.match(costs, /userId: z\.number\(\)\.int\(\)\.positive\(\)\.nullable\(\)/);
  assert.match(costs, /personRef: /);
  const editor = read("src/app/panel/personel/staff-editor.tsx");
  assert.match(editor, /id="st-kind"/);
  assert.match(editor, /id="st-daily"/);
  assert.match(editor, /id="st-link"/);
  assert.match(editor, /SGK brütleştirmesi yok/);
  // Önseçim yok: yeni kişide bağlantı boş başlar
  assert.match(editor, /useState<string>\(row \? linkValue\(row\) : ""\)/);
});

test("Excel 'Personel' sekmesi tutar: satırın sütunları (yemek kartı ve part-time ücreti dahil) toplam işveren maliyetini verir, TOPLAM herkesi kapsar", () => {
  // İnceleme bulgusu 4: Arda (35.000 net + yemek kartı) 57.065; Ayşe part-time 10 gün × 1.500 + yemek kartı + 2.000 ek
  const ARDA: Staff = { id: 301, name: "Arda", netSalary: 35_000, extras: 0, active: true, startMonth: null, endMonth: null, branchId: "marina", mealCard: true };
  const model = createModel(ds([ARDA, AYSE]));
  const ws = buildWorkbook(model, "2026-12", { investments: [], findings: data.findings, now: new Date("2027-01-05T10:00:00Z") }).getWorksheet("Personel")!;
  const val = (c: ExcelJS.Cell) => (c.type === ExcelJS.ValueType.Formula ? c.result : c.value);
  const rowOf = (text: string) => {
    for (let r = 1; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(1).value === text) return ws.getRow(r);
    assert.fail(`"${text}" satırı yok`);
  };
  const header = ws.getRow(1);
  const col = (re: RegExp) => {
    for (let c = 1; c <= ws.columnCount; c++) if (re.test(String(header.getCell(c).value ?? ""))) return c;
    assert.fail(`sütun yok: ${re}`);
  };
  const c = {
    net: col(/^Net maaş/),
    gross: col(/^Tahmini brüt/),
    ded: col(/^İşçi kesintileri/),
    sgk: col(/^İşveren SGK/),
    unemp: col(/^İşveren işsizlik/),
    extras: col(/^Yemek \/ yol \/ prim/),
    meal: col(/^Yemek kartı/),
    part: col(/^Part-time ücreti/),
    total: col(/^Toplam işveren maliyeti/),
  };
  const n = (row: ExcelJS.Row, k: keyof typeof c) => Number(val(row.getCell(c[k])) ?? 0);
  /** net + kesintiler + işveren payları + ek + yemek kartı + part-time ücreti = toplam; brüt = net + kesintiler */
  const reconciles = (row: ExcelJS.Row, label: string) => {
    close(n(row, "net") + n(row, "ded"), n(row, "gross"), `${label}: brüt = net + kesintiler`);
    close(n(row, "gross") + n(row, "sgk") + n(row, "unemp") + n(row, "extras") + n(row, "meal") + n(row, "part"), n(row, "total"), `${label}: sütunlar toplamı verir`);
  };
  const arda = rowOf("Arda");
  close(n(arda, "total"), 57_065.29, "Arda toplam (§6)");
  close(n(arda, "meal"), 330 * 26, "Arda yemek kartı");
  reconciles(arda, "Arda");
  const ayse = rowOf("Ayşe");
  close(n(ayse, "part"), 10 * 1_500, "Ayşe part-time ücreti");
  close(n(ayse, "meal"), 10 * 330, "Ayşe yemek kartı");
  close(n(ayse, "extras"), 2_000, "Ayşe ek");
  close(n(ayse, "total"), 15_000 + 3_300 + 2_000, "Ayşe toplam");
  reconciles(ayse, "Ayşe");
  const total = rowOf("TOPLAM");
  for (const k of Object.keys(c) as (keyof typeof c)[]) close(n(total, k), n(arda, k) + n(ayse, k), `TOPLAM ${k}: herkes`);
  reconciles(total, "TOPLAM");
});

test("maaş satırına bağlı hesabın silinmesinin reddi: satır adları ve pasif önerisi (denetim bulgusu 47)", () => {
  assert.equal(
    linkedDeleteText(["Ayşe"]),
    "Bu hesap Maaşlar'da “Ayşe” satırına bağlı; silinirse Vardiya günleri o satıra sayılmaz, part-time ücreti geçmiş aylarda da 0'a düşer. Silmek yerine hesabı pasif yapın.",
  );
  assert.match(linkedDeleteText(["Ayşe", "Ayşe (Tuzla)"]), /“Ayşe”, “Ayşe \(Tuzla\)” satırlarına bağlı;.*pasif yapın\.$/);
});
