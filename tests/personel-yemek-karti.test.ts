// Personel yemek kartı (Faz 5, sahibin kararı 11, 23 Kasım 2026): kişi başına işaret (varsayılan kapalı), günlük tutar ve
// gün Ayarlar'da (330 ₺ × 26 gün). İşaretli kişinin işveren maliyetine günlük × gün eklenir, brütleştirilmez; Gelir-gider'de
// kendi alt satırı ("PERSONEL YEMEK KARTI"), Maaşlar'da kendi sütunu. İşletme geneli "Personel yemeği" sabit gideriyle ve
// ekte yazılmış yemek kartıyla çift sayım uyarısı. Vergi bordrosu ve nakit planı: ek ödeme gibi (brütleştirilmeden).
// Çalıştırma: npx tsx --test tests/personel-yemek-karti.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { planInputFromModel } from "../src/lib/cash-plan";
import { alerts } from "../src/lib/calc/insights";
import { createModel, mealCardCarry, staffCost } from "../src/lib/calc/engine";
import { MEAL_CARD_LABEL, staffWarnings } from "../src/lib/calc/personnel";
import type { Dataset, Settings, Staff } from "../src/lib/calc/types";
import { DEFAULT_SETTINGS, settingsFromRows } from "../src/lib/constants";
import { taxPayrollFromModel } from "../src/lib/tax/payroll";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel: Dataset = datasetFromSeed(data);
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const person = (p: Partial<Staff> & Pick<Staff, "id" | "name" | "netSalary">): Staff => ({ extras: 0, active: true, startMonth: null, endMonth: null, branchId: "marina", ...p });
const ALPER = person({ id: 101, name: "Alper", netSalary: 35_000, mealCard: true });
const CEM = person({ id: 102, name: "Cem", netSalary: 32_000, mealCard: true });
const DAMLA = person({ id: 103, name: "Damla", netSalary: 30_000, extras: 7_500 });
const BERKAN = person({ id: 104, name: "Berkan", netSalary: 32_000, startMonth: "2026-11" });

/** Kasım 2026 biten ay: 30 açık gün (elle), kira ve personel tam ay */
const nov = { month: "2026-11", openDays: 30, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null };
const ds = (staff: Staff[], patch: Partial<Dataset> = {}): Dataset => ({ ...excel, currentMonth: "2026-12", months: [...excel.months, nov], staff, ...patch });

test("§6: işveren maliyeti varsayılan ayarlarla: Alper 57.065, Cem 52.909, Damla 49.059, Berkan 44.329 (Kasım'dan)", () => {
  const st = DEFAULT_SETTINGS;
  assert.equal(st.mealCardDaily, 330);
  assert.equal(st.mealCardDays, 26);
  const alper = staffCost(ALPER, st);
  close(alper.mealCard, 8_580, "Alper yemek kartı 330 × 26");
  assert.equal(Math.round(alper.total), 57_065);
  assert.equal(Math.round(staffCost(CEM, st).total), 52_909);
  // Yemek kartı brütleştirilmez: brüt ve SGK yalnız net maaştan
  close(alper.gross, 35_000 / 0.85, "brüt yalnız net maaştan");
  close(alper.total - staffCost({ ...ALPER, mealCard: false }, st).total, 8_580, "fark tam yemek kartı");
  // Ek ödeme brütleştirilmez; işaretsiz kişide yemek kartı yok
  const damla = staffCost(DAMLA, st);
  assert.equal(damla.mealCard, 0);
  assert.equal(Math.round(damla.total), 49_059);
  assert.equal(Math.round(staffCost(BERKAN, st).total), 44_329);
  // Berkan Kasım'dan: Ekim'de maaş hesabında yok
  const m = createModel(ds([ALPER, CEM, DAMLA, BERKAN]));
  assert.deepEqual(m.personnelFor("2026-10").rows.map((r) => r.staff.name).sort(), ["Alper", "Cem", "Damla"]);
  assert.deepEqual(m.personnelFor("2026-11").rows.map((r) => r.staff.name).sort(), ["Alper", "Berkan", "Cem", "Damla"]);
  close(m.personnelFor("2026-11").total, 57_065.29 + 52_909.41 + 49_058.82 + 44_329.41, "Kasım toplamı", 0.05);
});

test("Ayarlar: günlük tutar ve gün değişince yemek kartı değişir; çalışılan gün kancası (LM-4b) günü geçersiz kılar", () => {
  const st: Settings = { ...DEFAULT_SETTINGS, mealCardDaily: 300, mealCardDays: 20 };
  close(staffCost(ALPER, st).mealCard, 6_000, "300 × 20");
  close(staffCost(ALPER, DEFAULT_SETTINGS, { mealDays: 22 }).mealCard, 330 * 22, "kanca: LafPOS'un çalışılan günü");
  // Kayıtta yoksa varsayılan; kayıt varsa o
  const rows = settingsFromRows([{ key: "mealCardDaily", value: 350 }]);
  assert.deepEqual([rows.mealCardDaily, rows.mealCardDays], [350, 26]);
});

test("Gelir-gider: yemek kartı kendi alt satırında (PERSONEL YEMEK KARTI); maliyet − net satırına girmez, bölüm toplamı tutar", () => {
  const m = createModel(ds([ALPER, CEM, DAMLA]));
  const pm = m.pnlMonth("2026-11");
  close(pm.cells.get("personnel:meal")!.value!, 2 * 8_580, "iki kişinin yemek kartı, tam ay");
  const alper = staffCost(ALPER, DEFAULT_SETTINGS);
  const cem = staffCost(CEM, DEFAULT_SETTINGS);
  const damla = staffCost(DAMLA, DEFAULT_SETTINGS);
  close(pm.cells.get("personnel:net")!.value!, 35_000 + 32_000 + 30_000, "net");
  close(pm.cells.get("personnel:employer")!.value!, alper.total + cem.total + damla.total - 97_000 - 17_160, "maliyet − net − yemek kartı");
  assert.match(pm.cells.get("personnel:meal")!.info!, /2 kişi × 330\s₺ × 26 gün/);
  const personnelRows = pm.cells.get("personnel:net")!.value! + pm.cells.get("personnel:employer")!.value! + pm.cells.get("personnel:meal")!.value!;
  const fixedPersonel = [...pm.cells].filter(([k]) => k.startsWith("fixed:") && m.ds.fixedExpenses.find((f) => `fixed:${f.id}` === k)?.section === "personel");
  close(pm.sections.personel, personnelRows + fixedPersonel.reduce((a, [, c]) => a + (c.value ?? 0), 0) + (pm.cells.get("manual:personel_extra")?.value ?? 0), "bölüm toplamı");
  const row = m.pnlRowDefs(["2026-11"]).find((r) => r.key === "personnel:meal")!;
  assert.deepEqual([row.label, row.section, row.kind], [MEAL_CARD_LABEL, "personel", "auto"]);
  assert.match(row.hint!, /brütleştirilmez/);
  // Kimsede yemek kartı yoksa satır yok (eski tablo değişmez)
  assert.equal(createModel(ds([DAMLA])).pnlRowDefs(["2026-11"]).some((r) => r.key === "personnel:meal"), false);
  // Süren ayda maaş gibi gün oranıyla
  const run = createModel(ds([ALPER], { currentMonth: "2026-11", months: [...excel.months, { ...nov, openDays: 10 }] })).pnlMonth("2026-11");
  close(run.cells.get("personnel:meal")!.value!, (8_580 * 10) / 30, "süren ay 10/30");
});

test("çift sayım uyarısı: işaretli kişi + aynı ayda etkin işletme geneli 'Personel yemeği'; ekte yemek kartı gibi duran tutar", () => {
  const yemek = excel.fixedExpenses.find((f) => f.name === "Personel yemeği")!;
  assert.equal(yemek.branchId ?? null, null, "seed: işletme geneli");
  const m = createModel(ds([ALPER, DAMLA]));
  const w = staffWarnings(m, "2026-11");
  const dbl = w.find((x) => x.kind === "meal-double")!;
  assert.ok(dbl, "işaretli kişi + Personel yemeği: uyarı");
  assert.match(dbl.title, /yemek kartı/i);
  assert.match(dbl.detail, /Personel yemeği/);
  assert.match(dbl.detail, /Alper/);
  assert.ok(alerts(m, "2026-11").some((a) => a.title === dbl.title), "Genel bakış uyarısı");
  // Personel yemeği bitince (Ekim'de son) uyarı yok; işaretli kişi yoksa da yok
  const ended = createModel(ds([ALPER], { fixedExpenses: excel.fixedExpenses.map((f) => (f.id === yemek.id ? { ...f, endMonth: "2026-10" } : f)) }));
  assert.equal(staffWarnings(ended, "2026-11").some((x) => x.kind === "meal-double"), false);
  assert.equal(staffWarnings(createModel(ds([DAMLA])), "2026-11").some((x) => x.kind === "meal-double"), false);
  // Başka şubenin Personel yemeği kalemi Marina'daki kişiyle çift sayılmaz
  const tuzlaOnly = createModel(ds([ALPER], { fixedExpenses: excel.fixedExpenses.map((f) => (f.id === yemek.id ? { ...f, branchId: "tuzla" } : f)) }));
  assert.equal(staffWarnings(tuzlaOnly, "2026-11").some((x) => x.kind === "meal-double"), false);
  // Ekte 8.580 (330 × 26) yazılmış işaretli kişi: yalnız ipucu, veri değişmez
  const extra = createModel(ds([{ ...ALPER, extras: 8_580 }], { fixedExpenses: excel.fixedExpenses.filter((f) => f.id !== yemek.id) }));
  const hint = staffWarnings(extra, "2026-11").find((x) => x.kind === "meal-extras")!;
  assert.ok(hint, "ek yemek kartı gibi: ipucu");
  assert.deepEqual(hint.staffIds, [ALPER.id]);
  close(extra.pnlMonth("2026-11").cells.get("personnel:meal")!.value!, 8_580, "tutar kendiliğinden değişmez");
  assert.equal(staffWarnings(createModel(ds([{ ...ALPER, extras: 1_250 }], { fixedExpenses: excel.fixedExpenses.filter((f) => f.id !== yemek.id) })), "2026-11").length, 0);
});

test("vergi bordrosu ve nakit planı: yemek kartı ek ödeme gibi, brütleştirilmeden (yasal bordronun brütü değişmez)", () => {
  const with_ = createModel(ds([ALPER]));
  const without = createModel(ds([{ ...ALPER, mealCard: false }]));
  const p = taxPayrollFromModel(with_, 2026, DEFAULT_TAX_SETTINGS).get("2026-11")!;
  const q = taxPayrollFromModel(without, 2026, DEFAULT_TAX_SETTINGS).get("2026-11")!;
  close(p.totals.extras, 8_580, "ek ödeme olarak");
  assert.equal(p.totals.gross, q.totals.gross, "brüt değişmez");
  assert.equal(p.totals.sgkTotal, q.totals.sgkTotal, "SGK değişmez");
  close(p.totals.cost - q.totals.cost, 8_580, "maliyete brütleştirilmeden");
  const plan = planInputFromModel(with_, "2026-11-20");
  const base = planInputFromModel(without, "2026-11-20");
  close(plan.months["2026-11"].payroll.net - base.months["2026-11"].payroll.net, 8_580, "nakit planı personele giden");
});

test("Ayarlar ve Maaşlar: alanlar, eylem şeması, düzenleyicinin ipucu", () => {
  const fields = read("src/app/panel/ayarlar/fields.ts");
  assert.match(fields, /key: "mealCardDaily"/);
  assert.match(fields, /key: "mealCardDays"/);
  const action = read("src/server/actions/settings.ts");
  assert.match(action, /mealCardDaily: numKey/);
  assert.match(action, /mealCardDays: numKey\.int\(\)/);
  const editor = read("src/app/panel/personel/staff-editor.tsx");
  // "Yemek / yol / prim" ipucu: yemek kartı artık kendi alanında
  assert.match(editor, /Yemek kartı artık kendi alanında/);
  assert.match(editor, /id="st-meal"/);
  const costs = read("src/server/actions/costs.ts");
  assert.match(costs, /mealCard: z\.boolean\(\)/);
});

test("yemek kartı işareti sonraki sürümlere taşınır: eski işareti taşıyanlar çevrilir, sahibin ayrıca değiştirdiği ilk sürümde durulur", () => {
  // İnceleme bulgusu 8 (eylem: saveStaff; veritabanı testi tests/personel-baglanti-db.test.ts)
  const v = (fromMonth: string, mealCard: boolean) => ({ fromMonth, mealCard });
  const versions = [v("2027-06", true), v("2027-01", false), v("2027-03", false), v("2026-12", false)];
  assert.deepEqual(
    mealCardCarry(versions, "2026-12", false, true).map((x) => x.fromMonth),
    ["2027-01", "2027-03"],
    "Aralık'tan açıldı: Ocak ve Mart zamları kartı taşır; Haziran'da sahip zaten açmış, orada durulur",
  );
  assert.deepEqual(mealCardCarry(versions, "2027-06", true, false).map((x) => x.fromMonth), [], "sonrası yok");
  assert.deepEqual(mealCardCarry(versions, "2026-12", false, false), [], "işaret değişmedi: hiçbir şey");
  assert.deepEqual(
    mealCardCarry([v("2027-01", true), v("2027-02", false)], "2026-12", true, false).map((x) => x.fromMonth),
    ["2027-01"],
    "kapatma da taşınır; Şubat'ta sahip zaten kapatmış",
  );
});
