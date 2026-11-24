// Süren ayda yapıştırılan satış listesinin dönemi (src/lib/sales-coverage.ts, engine.ts listPeriod): kasa raporları her
// akşam ilerler, liste ise yapıştırıldığı güne kadardır. Listeye dayanan hesaplar (günlük ortalama, liste ↔ POS cirosu,
// "ayda …" adetleri, reçeteye göre kârın indirimi ve sabit gideri) listenin günleriyle yapılır; yanlış "POS cirosu
// tutmuyor" uyarısı çıkmaz.
// Çalıştırma: npx tsx --test tests/satis-donemi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import { alerts, consistency, dashboard, fixedCostsForMonth, listDaysText, listShareOf } from "../src/lib/calc/insights";
import { basisText, salesBasis } from "../src/lib/calc/price-loss";
import type { Dataset, SalesLine } from "../src/lib/calc/types";
import { resolveMonth, tillMonths, type TillRow } from "../src/lib/cash-month";
import { addDays } from "../src/lib/reminders";
import { branchCoverage, coverageFor, legacyCoveragePins, parseBranchCoverage, parseCoverage, readCoverage } from "../src/lib/sales-coverage";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-11" };

function close(actual: number | null | undefined, expected: number, label: string, eps = 1e-6) {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < eps, `${label}: beklenen ${expected}, bulunan ${actual}`);
}

/** 1–22 Kasım her gün 15.000 ₺ Z, 100 ₺ indirim (bugün 23 Kasım: kasa dünün sonuna kadar) */
function kasa(upto = "2026-11-22"): TillRow[] {
  const out: TillRow[] = [];
  for (let d = "2026-11-01"; d <= upto; d = addDays(d, 1)) out.push({ date: d, zTotal: 15_000, card: 10_000, mealCard: 1_000, discounts: 100, offRevenue: null });
  return out;
}

/** Eylül listesi, 1–15 Kasım'ın cirosuna ölçekli: 15 × 15.000 + 15 × 100 indirim = 226.500 ₺ (indirim öncesi) */
function novemberList(): SalesLine[] {
  const sep = base.salesLines.filter((l) => l.month === "2026-09");
  const total = sep.reduce((a, l) => a + l.revenue, 0);
  const k = 226_500 / total;
  return sep.map((l, i) => ({ ...l, id: 900_000 + i, month: "2026-11", qty: l.qty * k, revenue: l.revenue * k }));
}

/** Kasım: ay bilgisi kasa raporlarından (1–22), liste 1–15 Kasım'a kadar (coverage yoksa listenin dönemi bilinmez) */
function november(opts: { through?: string | null; typedOpenDays?: number } = {}): Dataset {
  const [till] = tillMonths(kasa(), "2026-11-22");
  const through = opts.through === undefined ? "2026-11-15" : opts.through;
  const entry = opts.typedOpenDays
    ? { month: "2026-11", openDays: opts.typedOpenDays, posRevenue: null, discounts: null, offRevenue: null, cardShare: null, note: null }
    : undefined;
  return {
    ...base,
    months: [...base.months, resolveMonth("2026-11", entry, till)],
    salesLines: [...base.salesLines, ...novemberList()],
    salesCoverage: through ? [{ month: "2026-11", through, till: tillMonths(kasa(through), through)[0] ?? null }] : [],
  };
}

// ---------------------------------------------------------------- Kayıt

test("kapsam kaydı: süren ayda verilen gün (ayın içinde, bugünden ileri değil), yoksa dün; ayın 1'inde bugün; biten ayda yok", () => {
  assert.equal(coverageFor("2026-11", "2026-11-23"), "2026-11-22", "varsayılan dün");
  assert.equal(coverageFor("2026-11", "2026-11-23", "2026-11-15"), "2026-11-15");
  assert.equal(coverageFor("2026-11", "2026-11-23", "2026-11-23"), "2026-11-23", "bugün de olur");
  assert.equal(coverageFor("2026-11", "2026-11-23", "2026-11-24"), "2026-11-22", "ileri gün verilemez");
  assert.equal(coverageFor("2026-11", "2026-11-23", "2026-10-31"), "2026-11-22", "başka ayın günü verilemez");
  assert.equal(coverageFor("2026-11", "2026-11-23", "bozuk"), "2026-11-22");
  assert.equal(coverageFor("2026-11", "2026-11-01"), "2026-11-01", "ayın 1'inde dün önceki ay: bugün");
  assert.equal(coverageFor("2026-10", "2026-11-23", "2026-10-15"), null, "biten aya yüklenen liste ayın tamamı");
  assert.equal(coverageFor("2026-12", "2026-11-23"), null, "gelecek ay");
  assert.deepEqual(parseCoverage({ "2026-11": "2026-11-15", "2026-10": "2026-11-01", bozuk: "2026-11-01", "2026-13": "2026-13-01", "2026-09": 5 }), { "2026-11": "2026-11-15" });
  assert.deepEqual(parseCoverage(null), {});
});

test("şubenin kendi kapsam kaydı: şubenin ayı varsa o (null: ayın tamamı), yoksa ortak kayıt; öteki şubenin yüklemesi kaydırmaz", () => {
  const stored = {
    marina: { "2026-11": "2026-11-21", "2026-10": null, "2026-09": "2026-10-01", bozuk: "2026-11-01", "2026-08": 5 },
    tuzla: { "2026-11": "2026-11-10" },
  };
  assert.deepEqual(parseBranchCoverage(stored, "marina"), { "2026-11": "2026-11-21", "2026-10": null });
  assert.deepEqual(parseBranchCoverage(stored, "online"), {});
  assert.deepEqual(parseBranchCoverage(null, "marina"), {});
  assert.deepEqual(parseBranchCoverage({ marina: ["2026-11"] }, "marina"), {});
  // Ortak kayıt Tuzla'nın son yüklemesi (10 Kasım) ve Ekim'in süren ayda kalmış kaydı; Marina'nın kendi kaydı geçer
  const shared = { "2026-11": "2026-11-10", "2026-10": "2026-10-15", "2026-07": "2026-07-20" };
  assert.deepEqual(branchCoverage(shared, parseBranchCoverage(stored, "marina")), { "2026-11": "2026-11-21", "2026-07": "2026-07-20" });
  assert.deepEqual(branchCoverage(shared, {}), shared, "şube kaydından önce yüklenen liste: ortak kayıt");
});

test("şubenin kapsamı (readCoverage): şube seçiliyken şubenin kendi kaydı, kaydı olmayan ayda ortak kayıt; 'Tümü'de ortak kayıt", () => {
  // Ortak kayıt son yükleyenin (Tuzla, 27 Kasım); Marina'nın kendi kaydı 21 Kasım; Tuzla'nın Ekim'i ayın tamamı
  const shared = { "2026-11": "2026-11-27", "2026-10": "2026-10-15" };
  const perBranch = { marina: { "2026-11": "2026-11-21" }, tuzla: { "2026-11": "2026-11-27", "2026-10": null } };
  assert.deepEqual(readCoverage(shared, perBranch, "marina"), { "2026-11": "2026-11-21", "2026-10": "2026-10-15" });
  assert.deepEqual(readCoverage(shared, perBranch, "tuzla"), { "2026-11": "2026-11-27" });
  assert.deepEqual(readCoverage(shared, perBranch, null), shared, "Tümü: işletme geneli, ortak kayıt");
  assert.deepEqual(readCoverage(shared, null, "marina"), shared, "şube kaydından önce yüklenen listeler: ortak kayıt");
  assert.deepEqual(readCoverage(null, perBranch, "marina"), { "2026-11": "2026-11-21" });
  assert.deepEqual(readCoverage({ bozuk: 1 }, "bozuk", "marina"), {});
});

test("eski listenin son günü korunur (legacyCoveragePins): ortak kayıt ezilmeden önce o ayda listesi olup kendi kaydı olmayan öteki şubeye yazılır", () => {
  // Marina'nın listesi bu değişiklikten önce 21 Kasım'a kadar yüklendi (yalnız ortak kayıt); Tuzla şimdi yüklüyor
  assert.deepEqual(legacyCoveragePins({ "2026-11": "2026-11-21" }, {}, "2026-11", "tuzla", ["marina", "tuzla"]), { marina: "2026-11-21" });
  // Ortak kayıtta ayın kaydı yok: liste ayın tamamıydı
  assert.deepEqual(legacyCoveragePins({}, null, "2026-11", "tuzla", ["marina"]), { marina: null });
  // Kendi kaydı olan şubeye dokunulmaz (null da kayıttır), yazan şubenin kendisi ve listesi olmayan şube yazılmaz
  assert.deepEqual(legacyCoveragePins({ "2026-11": "2026-11-27" }, { marina: { "2026-11": "2026-11-21" } }, "2026-11", "tuzla", ["marina"]), {});
  assert.deepEqual(legacyCoveragePins({ "2026-11": "2026-11-27" }, { marina: { "2026-11": null } }, "2026-11", "tuzla", ["marina"]), {});
  assert.deepEqual(legacyCoveragePins({ "2026-11": "2026-11-21" }, {}, "2026-11", "marina", ["marina"]), {});
  assert.deepEqual(legacyCoveragePins({ "2026-11": "2026-11-21" }, { marina: { "2026-10": null } }, "2026-11", "tuzla", ["marina", "online"]), { marina: "2026-11-21", online: "2026-11-21" });
});

test("kapsam kaydı: yükleme süren ayda günü yazar, biten aya yükleme ve 'Ayı temizle' siler; tek ifadeyle (iki ay birbirini ezmez)", () => {
  const sales = read("src/server/actions/sales.ts");
  // Kural src/lib/lafpos/sales.ts › modposImportRule'da: geçiş günü yokken ya da ondan önceki ayda coverageFor'un kendisi
  // (geçiş ayında en çok geçiş gününden önceki güne kadar, LafPOS ayında red; tests/lafpos-satis.test.ts)
  assert.match(sales, /const rule = modposImportRule\(month, switchDay, todayTR\(\), z\.string\(\)\.max\(10\)\.nullish\(\)\.parse\(input\.through\)\);/);
  assert.match(read("src/lib/lafpos/sales.ts"), /if \(src === "modpos" \|\| switchDay === null\) return \{ ok: true, through: coverageFor\(month, today, given\) \};/);
  assert.match(sales, /await writeCoverage\(tx, sube, month, through\);/, "satırlarla aynı işlemde, şubenin kendi kaydıyla");
  // Önce eski listelerin son günü şubelerine (ortak kayıt ezilmeden), sonra ortak kayıt ve yazanın kendi kaydı
  assert.match(sales, /await pinLegacyCoverage\(db, branchId, month\);\n\s*await setCoverage\(db, month, through\);\n\s*await setBranchCoverage\(db, branchId, month, through\);/);
  // Eski günün yazımı kendi kaydı olan şubeyi ezmez (null da kayıttır)
  assert.match(sales, /where key = \$\{SALES_COVERAGE_BRANCH_KEY\} and \(\$\{own\} -> \$\{month\}::text\) is null/);
  // Ayı temizle kaydı siler; kayıt ayın tek kaydıdır, yalnız ayda hiçbir şubenin listesi kalmadıysa (denetim 21 Kasım #7)
  assert.match(sales, /if \(!left\?\.n\) await setCoverage\(tx, m, null\);/, "Ayı temizle kaydı siler");
  assert.match(sales, /\$\{current\} \|\| jsonb_build_object\(\$\{month\}::text, \$\{through\}::text\)/);
  assert.match(sales, /\$\{current\} - \$\{month\}::text/);
  assert.match(sales, /case when jsonb_typeof\(value\) = 'object' then value else '\{\}'::jsonb end/);
  // Yükleyici: listenin son gününe kadarki kasa raporları
  const dataset = read("src/server/data/dataset.ts");
  assert.match(dataset, /r\.date\.slice\(0, 7\) === month && r\.date <= upto/);
  // İçe aktarma kartı süren ayda günü sorar
  const client = read("src/app/panel/satislar/sales-client.tsx");
  assert.match(client, /importSales\(\{ month, lines: rows, mode, through: running \? through : null, branchId \}\)/);
  assert.match(client, /Liste hangi güne kadar\?/);
});

// ---------------------------------------------------------------- Motor

test("listenin dönemi: kasa raporlarından kısaysa o dönemin açık günü, Z toplamı ve indirimi; değilse yok", () => {
  const model = createModel(november());
  const lp = model.listPeriod("2026-11")!;
  assert.deepEqual(lp, { from: "2026-11-01", through: "2026-11-15", openDays: 15, posRevenue: 225_000, discounts: 1_500, days: 15 });
  assert.equal(listDaysText(lp), "1–15 Kasım");
  // Liste kasayla aynı dönemi kapsıyor (dün yüklendi) ya da kapsam yok: dönem yok
  assert.equal(createModel(november({ through: "2026-11-22" })).listPeriod("2026-11"), null);
  assert.equal(createModel(november({ through: null })).listPeriod("2026-11"), null);
  // Açık gün elle yazıldı (Excel'deki gibi listeye göre yazılmış sayılır): dönem yok
  assert.equal(createModel(november({ typedOpenDays: 15 })).listPeriod("2026-11"), null);
  // Excel ayları değişmez
  assert.equal(model.listPeriod("2026-09"), null);
});

test("uyarı ve tutarlılık: liste listenin günlerinin Z toplamıyla karşılaştırılır; yanlış 'POS cirosu tutmuyor' çıkmaz", () => {
  const title = "Satış listesi ile POS cirosu tutmuyor";
  // Eski davranış (kapsam yok): 226.500 − 2.200 − 330.000 = −105.700 ₺ fark
  const old = alerts(createModel(november({ through: null })), "2026-11").find((a) => a.title === title);
  assert.ok(old, "kapsam bilinmiyorsa uyarı yine çıkar");
  assert.match(old.detail.replace(/\s/g, " "), /-105\.700/);
  assert.equal(alerts(createModel(november()), "2026-11").find((a) => a.title === title), undefined);
  const c = consistency(createModel(november()), "2026-11");
  assert.equal(c.sales.pos, 225_000);
  assert.equal(c.sales.discounts, 1_500);
  close(c.sales.diff, 0, "fark");
  assert.equal(c.sales.ok, true);
  assert.equal(c.sales.listPeriod?.through, "2026-11-15");
  // Liste gerçekten tutmuyorsa yine uyarır, dönemi yazar
  const off = november();
  off.salesLines = off.salesLines.map((l) => (l.month === "2026-11" ? { ...l, revenue: l.revenue * 1.1 } : l));
  const warn = alerts(createModel(off), "2026-11").find((a) => a.title === title);
  assert.ok(warn);
  assert.match(warn.detail, /listenin günleri: 1–15 Kasım/);
});

test("Genel bakış: günlük ortalama listenin açık günüyle; indirim o günlerin; sabit gider listenin günlerine düşen payla", () => {
  const model = createModel(november());
  const d = dashboard(model, "2026-11", { currentMonth: "2026-11" });
  close(d.dailyAvg, 226_500 / 15, "günlük ortalama (eskiden ÷ 22)");
  assert.equal(d.dailyAvgDays, 15);
  const t = d.theoretical!;
  close(t.discountsNet, 1_500 / (1 + model.settings.kdv), "indirim: 1–15 Kasım");
  const month = fixedCostsForMonth(model, "2026-11");
  assert.equal(month.prorationDays, 22, "ayın bugüne kadarki günü (kasa 1–22)");
  close(t.fixedTotal, (month.total * 15) / 22, "sabit gider × 15 / 22", 1e-6);
  assert.deepEqual({ ...t.fixedBreakdown.listShare!, amount: 0 }, { from: "2026-11-01", through: "2026-11-15", days: 15, of: 22, amount: 0 });
  close(t.fixedBreakdown.listShare!.amount, t.fixedTotal - month.total, "fark satırı");
  close(
    t.fixedFlow.reduce((a, l) => a + l.amount, 0),
    t.fixedTotal,
    "para nereye gitti toplamı",
    1e-6,
  );
  close(t.netProfit, t.grossProfit - t.discountsNet - t.fixedTotal, "net kâr");
  assert.equal(t.listPeriod?.days, 15);
  assert.equal(listShareOf(model, "2026-11")?.share, 15 / 22);
  // Kapsam yok: eskisi gibi ayın bugüne kadarki tutarı
  const plain = dashboard(createModel(november({ through: null })), "2026-11", { currentMonth: "2026-11" });
  close(plain.dailyAvg, 226_500 / 22, "eski günlük ortalama");
  assert.equal(plain.theoretical!.fixedBreakdown.listShare, null);
  close(plain.theoretical!.fixedTotal, month.total, "eski sabit gider");
});

test("zam etkisi ve 'ayda …' adetleri: ModPOS adetleri listenin açık günüyle standart aya çevrilir", () => {
  const model = createModel(november());
  const sb = salesBasis(model, "2026-11")!;
  assert.equal(sb.basis.openDays, 22);
  close(sb.basis.scale, model.settings.acikGun / 15, "liste ölçeği");
  close(sb.basis.onlineScale, model.settings.acikGun / 22, "online ölçeği (ayın açık günü)");
  assert.deepEqual(sb.basis.listPeriod, { from: "2026-11-01", through: "2026-11-15", openDays: 15 });
  assert.match(basisText(sb.basis).replace(/\s/g, " "), /^Kasım 2026 satışlarına göre: satış listesi 1–15 Kasım \(15 açık gün; ayın açık günü 22, kasa raporlarından\), ayda \d+ açık güne çevrildi\.$/);
  const [id, qty] = [...model.soldByProduct("2026-11")][0];
  close(sb.perMonth.get(id), qty * sb.basis.scale, "ürünün aylık adedi");
});
