// Ay bazlı ayarlar (docs/AYARLAR.md, src/lib/month-settings.ts): bir oran "şu aydan itibaren" değişince yalnız o ay ve
// sonrası değişir; sürümsüz ya da başlangıç sürümüyle her ay bugünkü (Excel'le aynı) rakam kalır.
// Çalıştırma: npx tsx --test tests/ay-ayarlari.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import {
  affectedText,
  BASE_MONTH,
  branchPosRateAt,
  changeLogText,
  changeMonthOptions,
  closedMonthIn,
  fromMonthAblative,
  historyOf,
  numberAblative,
  planChange,
  redundantMonths,
  removalEffect,
  settingsAt,
  upcomingChange,
  valueAt,
  versionsOf,
  versionValueValid,
  type SettingVersion,
} from "../src/lib/month-settings";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const data: SeedData = JSON.parse(readFileSync(join(root, "tests/fixtures/baslangic/veri.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(root, "tests/golden.json"), "utf8"));
const seed = datasetFromSeed(data);
// calc.test.ts gibi: Excel karaoke dahil bütün satışa tek KDV uyguluyordu
const base: Dataset = { ...seed, settings: { ...seed.settings, kdvHizmet: seed.settings.kdv }, currentMonth: "2026-11" };
const MONTHS = ["2026-07", "2026-08", "2026-09", "2026-10"];

const v = (key: string, fromMonth: string, value: number, branchId = ""): SettingVersion => ({ key, branchId, fromMonth, value });

function close(actual: number | null | undefined, expected: number, label: string, tol = 1e-6) {
  assert.ok(actual !== null && actual !== undefined, `${label}: değer yok`);
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${label}: beklenen ${expected}, bulunan ${actual}`);
}

/** Excel'le karşılaştırılan ay rakamları */
function monthFigures(ds: Dataset, month: string) {
  const m = createModel(ds);
  const pm = m.pnlMonth(month);
  return {
    personel: pm.sections.personel,
    pos: pm.cells.get("commission:pos")!.value as number,
    revenueNet: pm.revenueNet as number,
    cogs: pm.cogs,
    profit: pm.profit,
    salesNet: m.monthSales(month).net,
  };
}

// ---------------------------------------------------------------- çözücü

test("settingsAt: sürüm yoksa tabanın kendisi; sürüm ayından itibaren yeni değer, öncesinde taban", () => {
  const st = base.settings;
  assert.equal(settingsAt(st, [], "2026-09"), st);
  assert.equal(settingsAt(st, undefined, "2026-09"), st);
  const versions = [v("isverenSgk", "2026-09", 0.1975)];
  assert.equal(settingsAt(st, versions, "2026-08"), st, "değişmeyen ayda aynı nesne");
  assert.equal(settingsAt(st, versions, "2026-09").isverenSgk, 0.1975);
  assert.equal(settingsAt(st, versions, "2027-03").isverenSgk, 0.1975);
  assert.equal(settingsAt(st, versions, "2026-09").isciSgk, st.isciSgk, "öteki anahtarlar tabandan");
});

test("başlangıç sürümü (göç, 2000-01) tabanla aynıysa hiçbir ay değişmez", () => {
  const versions = [v("isverenSgk", BASE_MONTH, base.settings.isverenSgk), v("kdv", BASE_MONTH, base.settings.kdv), v("komisyon", BASE_MONTH, base.settings.komisyon)];
  for (const m of ["2026-01", "2026-09", "2030-12"]) assert.deepEqual(settingsAt(base.settings, versions, m), base.settings);
});

test("bozuk sürüm yok sayılır (aralık dışı, tam sayı olmayan gün, bozuk ay)", () => {
  assert.equal(versionValueValid("isverenSgk", 1.5), false);
  assert.equal(versionValueValid("mealCardDays", 26.5), false);
  assert.equal(versionValueValid("mealCardDays", 0), false);
  assert.equal(versionValueValid("posRate", 0.02), true);
  assert.equal(versionValueValid("posRate", 0.5), false);
  const versions = [v("isverenSgk", "2026-09", Number.NaN), v("isverenSgk", "2026-13", 0.2), v("mealCardDays", "2026-09", 26.5)];
  assert.equal(settingsAt(base.settings, versions, "2026-12"), base.settings);
});

test("şubenin POS oranı: şubenin kendi sürümü; başka şubeninki ve genel ayar karışmaz", () => {
  const versions = [v("posRate", "2026-10", 0.025, "marina"), v("posRate", "2026-12", 0.03, "tuzla"), v("komisyon", "2026-10", 0.03)];
  assert.equal(branchPosRateAt(versions, "marina", 0.02, "2026-09"), 0.02);
  assert.equal(branchPosRateAt(versions, "marina", 0.02, "2026-10"), 0.025);
  assert.equal(branchPosRateAt(versions, "tuzla", 0.02, "2026-11"), 0.02);
  assert.equal(branchPosRateAt(versions, "tuzla", 0.02, "2026-12"), 0.03);
  assert.equal(branchPosRateAt(versions, "yeni", 0.018, "2027-01"), 0.018, "sürümü olmayan şube sütunundan");
});

// ---------------------------------------------------------------- değişikliğin planı

test("planChange 'şu aydan itibaren': ayına yazılır, sonraki kayıtlı değişikliğe kadar geçer", () => {
  const sorted = versionsOf([v("isverenSgk", BASE_MONTH, 0.1575), v("isverenSgk", "2027-01", 0.1975)], "isverenSgk");
  const p = planChange(sorted, 0.1575, 0.18, "2026-10", "from")!;
  assert.deepEqual(p.upserts, [{ fromMonth: "2026-10", value: 0.18 }]);
  assert.deepEqual(p.affected, { from: "2026-10", through: "2026-12" });
  assert.equal(p.before, 0.1575);
  assert.deepEqual(p.deletes, []);
  // Sonrası yok: sonu açık
  assert.deepEqual(planChange(sorted, 0.1575, 0.2, "2027-03", "from")!.affected, { from: "2027-03", through: null });
  // Aynı değer: değişiklik yok
  assert.equal(planChange(sorted, 0.1575, 0.1575, "2026-10", "from"), null);
});

test("planChange 'yalnız bu ay': ertesi aya eski değer yazılır (orada sürüm yoksa); ertesi ay zaten aynıysa yazılmaz", () => {
  const sorted = versionsOf([v("mealCardDaily", BASE_MONTH, 330)], "mealCardDaily");
  const p = planChange(sorted, 330, 400, "2026-12", "only")!;
  assert.deepEqual(p.upserts, [
    { fromMonth: "2026-12", value: 400 },
    { fromMonth: "2027-01", value: 330 },
  ]);
  assert.deepEqual(p.affected, { from: "2026-12", through: "2026-12" });
  // Ertesi ayda zaten sürüm var: dokunulmaz
  const withNext = versionsOf([v("mealCardDaily", BASE_MONTH, 330), v("mealCardDaily", "2027-01", 400)], "mealCardDaily");
  const q = planChange(withNext, 330, 400, "2026-12", "only")!;
  assert.deepEqual(q.upserts, [{ fromMonth: "2026-12", value: 400 }]);
  assert.deepEqual(q.deletes, ["2027-01"], "Ocak'taki sürüm artık gereksiz (Aralık'la aynı değer)");
});

test("geri almak (aynı ay, eski değer) gereksiz sürümleri siler: liste değişiklikten önceki hâline döner", () => {
  const start = [v("isverenSgk", BASE_MONTH, 0.1575)];
  const p = planChange(versionsOf(start, "isverenSgk"), 0.1575, 0.1975, "2026-11", "only")!;
  const after = new Map(start.map((x) => [x.fromMonth, x.value]));
  for (const u of p.upserts) after.set(u.fromMonth, u.value);
  const sortedAfter = [...after].map(([m, val]) => v("isverenSgk", m, val));
  const back = planChange(versionsOf(sortedAfter, "isverenSgk"), 0.1575, 0.1575, "2026-11", "only")!;
  assert.deepEqual(back.upserts, [{ fromMonth: "2026-11", value: 0.1575 }]);
  assert.deepEqual(back.deletes.sort(), ["2026-11", "2026-12"]);
  assert.deepEqual(redundantMonths(new Map([[BASE_MONTH, 1], ["2026-10", 1], ["2026-11", 2], ["2026-12", 2], ["2027-01", 1]])), ["2026-10", "2026-12"]);
});

test("kaldırmanın etkisi ve kapalı ay kilidi", () => {
  const sorted = versionsOf([v("kdv", BASE_MONTH, 0.1), v("kdv", "2026-09", 0.2), v("kdv", "2026-12", 0.1)], "kdv");
  assert.deepEqual(removalEffect(sorted, 0.1, "2026-09"), { from: "2026-09", through: "2026-11", back: 0.1 });
  assert.equal(closedMonthIn({ from: "2026-09", through: "2026-11" }, ["2026-08", "2026-10"]), "2026-10");
  assert.equal(closedMonthIn({ from: "2026-11", through: null }, ["2026-08", "2026-10"]), null);
  assert.equal(closedMonthIn({ from: "2026-11", through: null }, ["2027-02"]), "2027-02", "ileri kapalı ay da (sonu açık değişiklik)");
});

test("metinler: ayrılma eki yılın okunuşuna göre; geçmiş satırı; ileri değişiklik; seçilebilir aylar", () => {
  assert.deepEqual([2025, 2026, 2027, 2028, 2029, 2030, 2033, 2040, 2050, 2100].map((y) => `${y}'${numberAblative(y)}`), [
    "2025'ten",
    "2026'dan",
    "2027'den",
    "2028'den",
    "2029'dan",
    "2030'dan",
    "2033'ten",
    "2040'tan",
    "2050'den",
    "2100'den",
  ]);
  assert.equal(fromMonthAblative("2027-01"), "Ocak 2027'den");
  assert.equal(fromMonthAblative(BASE_MONTH), "ilk aydan");
  assert.equal(affectedText({ from: "2026-10", through: null }), "Ekim 2026'dan itibaren");
  assert.equal(affectedText({ from: "2026-10", through: "2026-10" }), "Ekim 2026");
  assert.equal(affectedText({ from: "2026-10", through: "2026-12" }), "Ekim 2026 – Aralık 2026");
  assert.equal(changeLogText("isverenSgk", 0.1575, 0.1975, { from: "2027-01", through: null }), "İşveren SGK %15,75 → %19,75 (Ocak 2027'den itibaren)");
  assert.equal(changeLogText("posRate", 0.02, 0.025, { from: "2026-12", through: null }, "Marina"), "Marina POS oranı %2 → %2,5 (Aralık 2026'dan itibaren)");
  const versions = [v("isverenSgk", "2026-09", 0.1975), v("isverenSgk", "2027-01", 0.2)];
  assert.deepEqual(
    historyOf(versions, "isverenSgk", 0.1575).map((r) => [r.fromMonth, r.value]),
    [
      [null, 0.1575],
      ["2026-09", 0.1975],
      ["2027-01", 0.2],
    ],
  );
  assert.equal(historyOf([v("isverenSgk", BASE_MONTH, 0.1575)], "isverenSgk", 0.1575).length, 1, "başlangıç sürümü varsa taban satırı yok");
  assert.equal(upcomingChange(versions, "isverenSgk", "2026-11")?.fromMonth, "2027-01");
  assert.equal(upcomingChange(versions, "isverenSgk", "2027-01"), null);
  assert.equal(valueAt(versionsOf(versions, "isverenSgk"), 0.1575, "2026-08"), 0.1575);
  const opts = changeMonthOptions("2026-06", "2026-11");
  assert.equal(opts[0], "2026-06");
  assert.equal(opts.at(-1), "2027-11");
  assert.deepEqual(changeMonthOptions(null, "2026-11").slice(0, 2), ["2026-11", "2026-12"]);
});

// ---------------------------------------------------------------- motor: değişiklik yalnız ayından itibaren

test("sürümsüz ve başlangıç sürümlü veri kümesi Excel'in Temmuz–Ekim rakamlarını verir", () => {
  const seeded: Dataset = {
    ...base,
    settingsBase: base.settings,
    settingVersions: (["kdv", "kdvHizmet", "komisyon", "kartOrani", "fire", "isciSgk", "isciIssizlik", "isverenSgk", "isverenIssizlik", "mealCardDaily", "mealCardDays"] as const).map((k) =>
      v(k, BASE_MONTH, base.settings[k]),
    ),
  };
  for (const ds of [base, seeded]) {
    for (const month of MONTHS) {
      const g = golden.pnl[month];
      const f = monthFigures(ds, month);
      close(f.personel, g.personnel, `${month} personel`);
      close(f.pos, g.posCommission, `${month} POS komisyonu`);
      close(f.revenueNet, g.revenueNet, `${month} ciro`);
      close(f.cogs, g.cogs, `${month} SMM`);
      close(f.profit, g.profit, `${month} kâr`);
    }
  }
});

for (const [key, value, field] of [
  ["isverenSgk", 0.1975, "personel"],
  ["isciSgk", 0.15, "personel"],
  ["mealCardDaily", 400, "personel"],
  ["komisyon", 0.03, "pos"],
  ["kartOrani", 0.9, "pos"],
  ["kdv", 0.2, "revenueNet"],
] as const) {
  test(`${key} Eylül 2026'dan itibaren değişince Temmuz ve Ağustos aynı, Eylül ve Ekim yeni değerle`, () => {
    // Yemek kartı: başlangıç verisinde işaretli kimse yok; herkes işaretli kopya (önce ve sonra aynı veri)
    const b: Dataset = key === "mealCardDaily" ? { ...base, staff: base.staff.map((x) => ({ ...x, mealCard: true })) } : base;
    const ds: Dataset = { ...b, settingsBase: b.settings, settingVersions: [v(key, "2026-09", value)] };
    const before = Object.fromEntries(MONTHS.map((m) => [m, monthFigures(b, m)]));
    for (const m of MONTHS) {
      const f = monthFigures(ds, m);
      if (m < "2026-09") {
        assert.deepEqual(f, before[m], `${m} değişmemeli`);
        if (b === base) close(f.profit, golden.pnl[m].profit, `${m} kâr Excel'le aynı`);
      } else {
        assert.notEqual(f[field], before[m][field], `${m} ${field} değişmeli`);
      }
    }
  });
}

test("yalnız bu ay: Eylül'e özel oran Ağustos'u ve Ekim'i değiştirmez", () => {
  const ds: Dataset = { ...base, settingsBase: base.settings, settingVersions: [v("isverenSgk", "2026-09", 0.1975), v("isverenSgk", "2026-10", base.settings.isverenSgk)] };
  close(monthFigures(ds, "2026-08").personel, golden.pnl["2026-08"].personnel, "Ağustos");
  close(monthFigures(ds, "2026-10").personel, golden.pnl["2026-10"].personnel, "Ekim");
  assert.ok(monthFigures(ds, "2026-09").personel > golden.pnl["2026-09"].personnel, "Eylül yüksek oranla");
});

test("bu ayın ayarı (model.settings) ürün kartını ve listeyi belirler; ileri tarihli değişiklik bugünü değiştirmez", () => {
  const ds: Dataset = { ...base, settingsBase: base.settings, settingVersions: [v("isverenSgk", "2027-01", 0.1975), v("kdv", "2027-01", 0.2)] };
  const m = createModel(ds);
  assert.equal(m.settings.isverenSgk, base.settings.isverenSgk);
  assert.equal(m.settingsAt("2027-01").isverenSgk, 0.1975);
  assert.equal(m.settingsAt("2026-11"), m.settings);
  close(m.personnel.total, golden.personnel.total, "bugünün personel maliyeti");
  const p0 = createModel(base).products[0];
  close(m.products[0].net, p0.net, "ürün kartının net fiyatı bugünün KDV'siyle");
});

test("şubenin POS oranı motorda ayına göre (kütükteki şube); kütükte olmayan şube Ayarlar'daki komisyonla", () => {
  const ds: Dataset = {
    ...base,
    settingsBase: base.settings,
    branchRates: [{ id: "tuzla", name: "Tuzla", posRate: 0.02 }],
    settingVersions: [v("posRate", "2026-10", 0.025, "tuzla"), v("komisyon", "2026-10", 0.03)],
  };
  const m = createModel(ds);
  assert.equal(m.posRateAt("tuzla", "2026-09"), 0.02);
  assert.equal(m.posRateAt("tuzla", "2026-10"), 0.025);
  assert.equal(m.posRateAt("baska", "2026-09"), base.settings.komisyon);
  assert.equal(m.posRateAt("baska", "2026-10"), 0.03);
});
