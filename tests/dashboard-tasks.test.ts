// Genel bakış · "Bu ayın işleri" listesinin testleri (src/app/panel/dashboard-tasks.tsx).
// Excel verisi (Temmuz–Ekim 2026) üzerinde, bugün = Ekim 2026; senaryolar küçük değişikliklerle.
// Çalıştırma: npx tsx --test tests/dashboard-tasks.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import { dashboard } from "../src/lib/calc/insights";
import type { Dataset, PnlEntry } from "../src/lib/calc/types";
import type { UpcomingItem } from "../src/lib/reminders";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";
import {
  monthTaskFacts,
  monthTasks,
  paymentFacts,
  taskSummary,
  type MonthTask,
  type MonthTaskFacts,
  type ParasutFacts,
  type PaymentFacts,
} from "../src/app/panel/dashboard-tasks";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const model = createModel(ds);

const NO_PAYMENTS: PaymentFacts = { overdue: 0, overdueTotal: 0, soon: 0, soonTotal: 0, unpaidInvoices: 0, unpaidTotal: 0 };

function tasksFor(m: ReturnType<typeof createModel>, month: string, extra: { payments?: PaymentFacts | null; parasut?: ParasutFacts | null } = {}) {
  const d = dashboard(m, month);
  return monthTasks(monthTaskFacts(m, month, d.monthState, d.refMonth, { payments: extra.payments === undefined ? NO_PAYMENTS : extra.payments, parasut: extra.parasut ?? null }));
}
const byKey = (tasks: MonthTask[]) => Object.fromEntries(tasks.map((t) => [t.key, t]));
const withPnl = (entries: PnlEntry[]) => createModel({ ...ds, pnlEntries: [...ds.pnlEntries, ...entries] });

test("Sıra ve adresler: satış → ay bilgileri → faturalar → su → sayım → ödemeler, her biri seçili aya gider", () => {
  const tasks = tasksFor(model, "2026-09");
  assert.deepEqual(
    tasks.map((t) => t.key),
    ["satis", "gun", "fatura", "su", "sayim", "odeme"],
  );
  const t = byKey(tasks);
  assert.match(t.satis.href, /^\/panel\/satislar\?ay=2026-09/);
  assert.equal(t.gun.href, "/panel/satislar?ay=2026-09#m-days");
  assert.equal(t.fatura.href, "/panel/faturalar?ay=2026-09");
  assert.equal(t.su.href, "/panel/gelir-gider?yil=2026&ara=su+gideri");
  assert.equal(t.sayim.href, "/panel/sayim?ay=2026-09");
  assert.equal(t.odeme.href, "/panel/hatirlaticilar");
});

test("Eylül (bitmiş, satış listesi var): eşleşmeyen satır, açık gün, fatura sayısı modelle aynı", () => {
  const t = byKey(tasksFor(model, "2026-09"));
  const sales = model.monthSales("2026-09");
  if (sales.unmatched.length) {
    assert.equal(t.satis.status, "todo");
    assert.match(t.satis.detail, new RegExp(`${sales.unmatched.length} POS ürünü`));
    assert.match(t.satis.href, /durum=eslesmeyen/);
  } else {
    assert.equal(t.satis.status, "done");
  }
  assert.equal(t.gun.status, "done");
  assert.match(t.gun.detail, /30 \/ 30 gün açık/);
  const count = ds.invoices.filter((i) => i.date.startsWith("2026-09")).length;
  assert.equal(t.fatura.status, count ? "done" : "todo");
  assert.match(t.fatura.detail, new RegExp(`^${count} fatura`));
  // Excel verisinde SU GİDERİ ve sayım yok: bitmiş ayda ikisi de yapılacak
  assert.equal(t.su.status, "todo");
  assert.equal(t.sayim.status, "todo");
  assert.match(t.sayim.detail, /devreden mal 0/);
  assert.equal(t.odeme.status, "done");
});

test("Temmuz (bitmiş, satış listesi yok): yüklenmeli, kâr oranının Eylül'den geldiği söylenir", () => {
  const t = byKey(tasksFor(model, "2026-07"));
  assert.equal(t.satis.status, "todo");
  assert.match(t.satis.detail, /Eylül 2026 satışlarından/);
  assert.equal(t.satis.action, "Satış raporu yükle");
  assert.match(t.gun.detail, /23 \/ 31 gün açık/);
});

test("Ekim (süren ay): satış raporu, su ve sayım ay sonunda; açık gün bugüne kadar sayılır", () => {
  const t = byKey(tasksFor(model, "2026-10"));
  assert.equal(t.satis.status, "later");
  assert.equal(t.su.status, "later");
  assert.equal(t.sayim.status, "later");
  assert.equal(t.gun.status, "done");
  assert.match(t.gun.detail, /Bugüne kadar 16 gün açık/);
  const s = taskSummary(Object.values(t));
  assert.equal(s.allDone, true, "süren ayda bekleyen iş yoksa kart kapanır");
  assert.equal(s.next, null);
});

test("Başlamamış ay: ödemeler dışında her şey sonra", () => {
  const t = tasksFor(model, "2026-11");
  for (const x of t.filter((x) => x.key !== "odeme")) assert.equal(x.status, "later", x.key);
});

test("Su faturası: Eylül'e girilince reçetelere dağıtıldığı ve ikinci kez sayılmadığı yazılır", () => {
  const m = withPnl([{ month: "2026-09", rowKey: "manual:su", amount: 3000 }]);
  const t = byKey(tasksFor(m, "2026-09"));
  assert.equal(t.su.status, "done");
  assert.match(t.su.detail, /reçetelere dağıtıldı; sabit giderde ikinci kez sayılmaz/);
  // Ekim faturası da girilirse: Ekim'in satış listesi yok, litre maliyeti Eylül faturasından
  const m2 = withPnl([
    { month: "2026-09", rowKey: "manual:su", amount: 3000 },
    { month: "2026-10", rowKey: "manual:su", amount: 2500 },
  ]);
  assert.match(byKey(tasksFor(m2, "2026-10")).su.detail, /litre maliyeti Eylül 2026 faturasından/);
  // Yalnızca Ekim faturası: litre hesaplanamaz (water.reason = "no-usage")
  const m3 = withPnl([{ month: "2026-10", rowKey: "manual:su", amount: 2500 }]);
  assert.equal(m3.water.reason, "no-usage");
  assert.match(byKey(tasksFor(m3, "2026-10")).su.detail, /Ekim 2026 satış listesi yok; litre hesaplanamadı/);
});

test("Ay bilgileri: açık gün ayın gün sayısından fazlaysa sorun, POS cirosu yoksa yapılacak", () => {
  const over = createModel({ ...ds, months: ds.months.map((x) => (x.month === "2026-09" ? { ...x, openDays: 31 } : x)) });
  const t = byKey(tasksFor(over, "2026-09"));
  assert.equal(t.gun.status, "warn");
  assert.match(t.gun.detail, /\(31\) ayın gün sayısından \(30\)/);
  const noPos = createModel({ ...ds, months: ds.months.map((x) => (x.month === "2026-08" ? { ...x, posRevenue: null } : x)) });
  const g = byKey(tasksFor(noPos, "2026-08")).gun;
  assert.equal(g.status, "todo");
  assert.equal(g.href, "/panel/satislar?ay=2026-08#m-pos");
});

test("Satış listesinde toplam satırı varsa sorun olarak öne çıkar", () => {
  const first = ds.salesLines.find((l) => l.month === "2026-09")!;
  const m = createModel({ ...ds, salesLines: [...ds.salesLines, { ...first, id: 999999, posName: "TOPLAM", qty: 1, revenue: 441955, productId: null }] });
  const tasks = tasksFor(m, "2026-09");
  const t = byKey(tasks);
  assert.equal(t.satis.status, "warn");
  assert.match(t.satis.detail, /toplam satırı/);
  assert.equal(taskSummary(tasks).next?.key, "satis");
});

test("Ödemeler: geciken sorun, yaklaşan yapılacak, yoksa ödenmemiş faturalar bilgi olarak", () => {
  const item = (status: UpcomingItem["status"], amount: number): UpcomingItem => ({
    ref: `x:${status}:${amount}`,
    source: "invoice",
    sourceId: 1,
    kind: "fatura",
    title: "Kaldi",
    detail: null,
    amount,
    dueDate: "2026-10-01",
    daysLeft: status === "overdue" ? -5 : 2,
    status,
    remindDaysBefore: 3,
    repeat: "none",
  });
  const p = paymentFacts([item("overdue", 11517), item("soon", 2000), item("today", 500), item("later", 9999)], { count: 3, total: 14017 });
  assert.deepEqual(p, { overdue: 1, overdueTotal: 11517, soon: 2, soonTotal: 2500, unpaidInvoices: 3, unpaidTotal: 14017 });

  const overdue = tasksFor(model, "2026-09", { payments: p });
  assert.equal(byKey(overdue).odeme.status, "warn");
  assert.equal(taskSummary(overdue).next?.key, "odeme", "önce sorunlar");

  const soon = byKey(tasksFor(model, "2026-09", { payments: { ...p, overdue: 0, overdueTotal: 0 } })).odeme;
  assert.equal(soon.status, "todo");

  const calm = byKey(tasksFor(model, "2026-09", { payments: { ...NO_PAYMENTS, unpaidInvoices: 1, unpaidTotal: 11517 } })).odeme;
  assert.equal(calm.status, "done");
  assert.equal(calm.href, "/panel/faturalar?durum=odenmedi");
  assert.match(calm.detail, /1 fatura ödenmemiş/);

  assert.equal(byKey(tasksFor(model, "2026-09", { payments: null })).odeme.status, "later", "liste okunamadıysa yanlış 'tamam' denmez");
});

test("Ödemeler: kuruşlu toplamlar kartlardaki gibi kuruşlu yazılır (11.516,77 ₺, 11.517 ₺ değil)", () => {
  const p: PaymentFacts = { ...NO_PAYMENTS, overdue: 1, overdueTotal: 11516.77, soon: 1, soonTotal: 2500 };
  assert.match(byKey(tasksFor(model, "2026-09", { payments: p })).odeme.detail, /11\.516,77\u00a0₺/);
  const soon = byKey(tasksFor(model, "2026-09", { payments: { ...p, overdue: 0, overdueTotal: 0, soonTotal: 1250.5 } })).odeme;
  assert.match(soon.detail, /1\.250,50\u00a0₺/);
  const calm = byKey(tasksFor(model, "2026-09", { payments: { ...NO_PAYMENTS, unpaidInvoices: 1, unpaidTotal: 14017 } })).odeme;
  assert.match(calm.detail, /kalan 14\.017\u00a0₺/, "tam tutar ondalıksız kalır");
});

test("Paraşüt: son eşitleme yazılır, hata verdiyse faturalar sorun olur", () => {
  const ok = byKey(tasksFor(model, "2026-09", { parasut: { lastStatus: "ok", lastRunAt: "2026-10-20T08:00:00Z", lastOkAt: "2026-10-20T08:01:00Z", message: null } })).fatura;
  assert.equal(ok.status, "done");
  assert.match(ok.detail, /Paraşüt son eşitleme 20\.10\.2026/);
  const err = byKey(tasksFor(model, "2026-09", { parasut: { lastStatus: "error", lastRunAt: "2026-10-20T08:00:00Z", lastOkAt: null, message: "401" } })).fatura;
  assert.equal(err.status, "warn");
  assert.equal(err.href, "/panel/parasut");
});

test("Özet: hepsi tamamsa kart kapanır, sıradaki iş yok", () => {
  const facts: MonthTaskFacts = {
    month: "2026-09",
    state: "closed",
    dim: 30,
    sales: { lines: 120, unmatched: 0, summaryRows: 0, refMonth: "2026-09" },
    info: { openDays: 30, posRevenue: 429698 },
    invoices: { count: 30, goods: 173983 },
    water: { bill: 3000, usedInRecipes: true, perLiter: 2.5, costMonth: "2026-09", reason: "ok" },
    stock: { lines: 80, total: 52000 },
    payments: NO_PAYMENTS,
    parasut: null,
  };
  const tasks = monthTasks(facts);
  assert.ok(tasks.every((t) => t.status === "done"));
  const s = taskSummary(tasks);
  assert.deepEqual({ done: s.done, open: s.open, allDone: s.allDone, next: s.next }, { done: 6, open: 0, allDone: true, next: null });
  // Bir eksik: sıradaki iş o olur
  const s2 = taskSummary(monthTasks({ ...facts, stock: { lines: 0, total: 0 } }));
  assert.equal(s2.next?.key, "sayim");
  assert.equal(s2.allDone, false);
});

// ---------------------------------------------------------------- "Bu ay düşülen sabit gider" kutusu (dashboard-fixed.tsx)

test("Sabit gider kutusu: standart, açık gün etkisi, bu aya özel gider ayrı satırlarda; su ikinci kez düşülmez", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { FixedReconcile, fixedBreakdownText } = await import("../src/app/panel/dashboard-fixed");
  const m = createModel({
    ...ds,
    months: ds.months.map((x) => (x.month === "2026-09" ? { ...x, openDays: 28 } : x)),
    pnlEntries: [
      ...ds.pnlEntries,
      { month: "2026-09", rowKey: "manual:su", amount: 3000 },
      { month: "2026-09", rowKey: "manual:dogalgaz", amount: 5000 },
    ],
  });
  const d = dashboard(m, "2026-09");
  const f = d.fixedMonth;
  assert.ok(f.waterInRecipes && f.waterExcluded === 3000);
  const html = renderToStaticMarkup(createElement(FixedReconcile, { f })).replace(/ /g, " ");
  assert.match(html, /Standart aylık sabit gider \(Excel\)/);
  assert.match(html, /Açık gün etkisi \(28 \/ 30 gün\)/);
  assert.match(html, /Bu aya özel giderler \(Gelir-gider\)/);
  assert.match(html, /DOĞALGAZ/);
  assert.match(html, /\+5\.000 ₺/);
  assert.match(html, /SU GİDERİ \(3\.000 ₺\) reçetelerde/);
  // Satırların toplamı düşülen tutara eşit; Net kâr ipucu aynı ayrımı söyler
  assert.ok(Math.abs(f.standard + f.proration + f.overrides + f.manual - f.total) < 1e-6);
  const tip = fixedBreakdownText(f).replace(/ /g, " ");
  assert.match(tip, /açık gün etkisi \(28 \/ 30 gün\) −/);
  assert.match(tip, /bu aya özel giderler \(Gelir-gider\) \+5\.000 ₺/);
  // Fark yoksa (Excel'in Eylül'ü) tek satırlık not
  const plain = renderToStaticMarkup(createElement(FixedReconcile, { f: dashboard(model, "2026-09").fixedMonth })).replace(/ /g, " ");
  assert.match(plain, /standart aylık tutarlarla düşüldü \(377\.813 ₺, Excel Panel ile aynı temel\)/);
});

test("Yalnızca ödeme işi açıksa ay eksiksiz sayılır (ödemeler bugüne bağlı)", () => {
  const task = (key: MonthTask["key"], status: MonthTask["status"]): MonthTask => ({ key, title: key, status, detail: "", href: "/", action: "" });
  const s = taskSummary([task("satis", "done"), task("gun", "done"), task("odeme", "warn")]);
  assert.equal(s.open, 1);
  assert.equal(s.monthOpen, 0, "ödeme ayın işi değil");
  assert.equal(s.paymentsOpen, 1);
  assert.equal(s.next?.key, "odeme");
  const t = taskSummary([task("satis", "todo"), task("odeme", "warn")]);
  assert.equal(t.monthOpen, 1);
});

test("Su faturası: seçili ayın satış listesi varsa 'satış listesi olmadığı için' denmez", () => {
  const f = {
    month: "2026-09",
    state: "closed",
    dim: 30,
    sales: { lines: 120, unmatched: 0, summaryRows: 0, refMonth: "2026-09" },
    info: { openDays: 30, posRevenue: 1000 },
    invoices: { count: 1, goods: 1 },
    water: { bill: 3000, usedInRecipes: true, perLiter: 2.5, costMonth: "2026-10", reason: "ok" },
    stock: { lines: 1, total: 1 },
    payments: null,
    parasut: null,
  } satisfies MonthTaskFacts;
  const su = monthTasks(f).find((t) => t.key === "su")!;
  assert.ok(!su.detail.includes("olmadığı için"), su.detail);
  assert.match(su.detail, /Ekim 2026 faturasından/);
  const noSales = monthTasks({ ...f, sales: { ...f.sales, lines: 0 } }).find((t) => t.key === "su")!;
  assert.match(noSales.detail, /Eylül 2026 satış listesi olmadığı için/);
});

test("Net kâr ipucu: düzeltilen hücreler ve bu aya özel satırlar kutudaki adlarla ayrı yazılır", async () => {
  const { fixedBreakdownText } = await import("../src/app/panel/dashboard-fixed");
  type F = Parameters<typeof fixedBreakdownText>[0];
  const f = { standard: 377813, proration: 0, openDays: 30, dim: 30, overrides: 6800, manual: 5000, extras: 11800, total: 389613 } as unknown as F;
  const tip = fixedBreakdownText(f).replace(/\u00a0/g, " ");
  assert.match(tip, /Gelir-gider'de düzeltilen tutarlar \+6\.800 ₺/);
  assert.match(tip, /bu aya özel giderler \(Gelir-gider\) \+5\.000 ₺/);
  assert.ok(!tip.includes("+11.800"), tip);
});
