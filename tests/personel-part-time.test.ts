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

import { planInputFromModel } from "../src/lib/cash-plan";
import { createModel, staffCost, staffShiftRef } from "../src/lib/calc/engine";
import { alerts } from "../src/lib/calc/insights";
import { staffWarnings } from "../src/lib/calc/personnel";
import type { Dataset, Staff } from "../src/lib/calc/types";
import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { taxPayrollFromModel } from "../src/lib/tax/payroll";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const excel: Dataset = excelToDataset(data);
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
  assert.deepEqual(staffWarnings(ok, "2026-12").map((w) => w.kind).filter((k) => k.startsWith("parttime")), []);
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
