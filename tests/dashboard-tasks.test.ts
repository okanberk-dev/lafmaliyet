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
import { money } from "../src/lib/format";
import { lafposMonthStatus } from "../src/lib/lafpos/sales";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";
import {
  defaultTaskMonth,
  monthCashOuts,
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
  assert.match(t.sayim.detail, /^Sayım yok: kapanış stoğu 0 sayıldı, alınan malın tamamı maliyet\.$/);
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
    stock: { lines: 80, total: 52000, counted: 72, listed: 72 },
    payments: NO_PAYMENTS,
    parasut: null,
  };
  const tasks = monthTasks(facts);
  assert.ok(tasks.every((t) => t.status === "done"));
  const s = taskSummary(tasks);
  assert.deepEqual({ done: s.done, open: s.open, allDone: s.allDone, next: s.next }, { done: 6, open: 0, allDone: true, next: null });
  // Bir eksik: sıradaki iş o olur
  const s2 = taskSummary(monthTasks({ ...facts, stock: { lines: 0, total: 0, counted: 0, listed: 72 } }));
  assert.equal(s2.next?.key, "sayim");
  assert.equal(s2.allDone, false);
});

test("Ay sonu stok sayımı: tek satır kaydedilmiş ay 'Tamam' değil, yarım 'N / M' (countStatus kuralı)", () => {
  const base: MonthTaskFacts = {
    month: "2026-10",
    state: "closed",
    dim: 31,
    sales: { lines: 120, unmatched: 0, summaryRows: 0, refMonth: "2026-10" },
    info: { openDays: 31, posRevenue: 429698 },
    invoices: { count: 30, goods: 173983 },
    water: { bill: 3000, usedInRecipes: true, perLiter: 2.5, costMonth: "2026-10", reason: "ok" },
    stock: { lines: 1, total: 900, counted: 1, listed: 72 },
    payments: NO_PAYMENTS,
    parasut: null,
  };
  const half = monthTasks(base).find((t) => t.key === "sayim")!;
  assert.equal(half.status, "todo");
  assert.match(half.detail, /^Yarım: 1 \/ 72 kalem sayıldı\. Kalanların stoğu 0 sayılır/);
  assert.equal(half.action, "Sayımı tamamla");
  const done = monthTasks({ ...base, stock: { lines: 74, total: 52000, counted: 72, listed: 72 } }).find((t) => t.key === "sayim")!;
  assert.equal(done.status, "done");
  assert.match(done.detail, /^74 kalem sayıldı/);
  // Yalnız ek kalem yazılmış ay da yarım
  assert.equal(monthTasks({ ...base, stock: { lines: 2, total: 50, counted: 0, listed: 72 } }).find((t) => t.key === "sayim")!.status, "todo");
});

test("LafPOS'a geçilen ay: Satışlar bandının uyarısı Genel bakış'ta da; eksik gün varken satış raporu 'Tamam' değil (denetim B08 incelemesi)", () => {
  // Geçiş günü 15 Ekim, Ekim'e ModPOS listesi yüklenmedi; LafPOS 15-26 Ekim, hepsi eşleşti
  const S = "2026-10-15";
  const st = lafposMonthStatus({ month: "2026-10", switchDay: S, today: "2026-10-27", modpos: null, lafpos: { days: 12, last: "2026-10-26" } })!;
  const latte = model.ds.products[0];
  const lines = ds.salesLines.filter((l) => l.month !== "2026-10").concat([{ id: -1, month: "2026-10", posName: "LATTE", qty: 120, revenue: 24_000, productId: latte.id, isService: false, note: null, lafpos: { days: 12 } }]);
  const m = createModel({ ...ds, salesLines: lines, lafposSales: { switchDay: S, countFrom: S, months: [st] } });
  const facts = monthTaskFacts(m, "2026-10", "closed", null, { payments: NO_PAYMENTS, parasut: null });
  assert.deepEqual(facts.sales.lafpos && [facts.sales.lafpos.source, facts.sales.lafpos.days], ["gecis", 12]);
  const satis = monthTasks(facts).find((t) => t.key === "satis")!;
  assert.equal(satis.status, "warn");
  assert.equal(satis.detail.replace(/\u00a0/g, " ").replace(/\u2060/g, ""), "1–14 Ekim ModPOS satışı yüklenmedi: LafPOS 15 Ekim'den itibaren sayılıyor. 1–14 Ekim listesini yükleyin.");
  assert.equal(satis.href, "/panel/satislar?ay=2026-10");
  assert.equal(taskSummary(monthTasks(facts)).allDone, false);
  // LafPOS'un gün sonu gelmemiş raporlu günü (ayın tamamı LafPOS): uyarı
  const full = lafposMonthStatus({
    month: "2026-10",
    switchDay: "2026-10-01",
    today: "2026-10-27",
    modpos: null,
    lafpos: { days: 17, last: "2026-10-26" },
    kasaDays: ["2026-10-01", "2026-10-02", "2026-10-10", "2026-10-27"],
    lafposDates: ["2026-10-10"],
  })!;
  assert.deepEqual(full.missing, ["2026-10-01", "2026-10-02"], "bugünün raporu gün sonundan önce girilmiş olabilir");
  const fm = createModel({ ...ds, salesLines: lines, lafposSales: { switchDay: "2026-10-01", countFrom: "2026-10-01", months: [full] } });
  const fullTask = monthTasks(monthTaskFacts(fm, "2026-10", "closed", null, { payments: NO_PAYMENTS, parasut: null })).find((t) => t.key === "satis")!;
  assert.equal(fullTask.status, "warn");
  assert.match(fullTask.detail, /^2 günün LafPOS gün sonu gelmedi, kasa raporu var: 1, 2 Ekim\. Bu günlerin satışı hesapta yok; LafPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın\.$/);
  // Sorunsuz LafPOS ayı: tamam, metin listeden değil LafPOS'tan söz eder; satırsız süren ay "Patron listesi" demez
  const clean = lafposMonthStatus({ month: "2026-10", switchDay: "2026-10-01", today: "2026-10-27", modpos: null, lafpos: { days: 26, last: "2026-10-26" } })!;
  const base: MonthTaskFacts = monthTaskFacts(createModel({ ...ds, salesLines: lines, lafposSales: { switchDay: "2026-10-01", countFrom: "2026-10-01", months: [clean] } }), "2026-10", "closed", null, { payments: NO_PAYMENTS, parasut: null });
  const ok = monthTasks(base).find((t) => t.key === "satis")!;
  assert.equal(ok.status, "done");
  assert.equal(ok.detail, "LafPOS'tan 26 gün geldi (1 satır), hepsi reçeteyle eşleşti.");
  const empty = monthTasks({ ...base, state: "running", sales: { ...base.sales, lines: 0 } }).find((t) => t.key === "satis")!;
  assert.deepEqual([empty.status, empty.detail], ["later", "Satışlar her gün sonunda LafPOS'tan gelir; bu ay henüz sayılan gün sonu yok."]);
  const closedEmpty = monthTasks({ ...base, sales: { ...base.sales, lines: 0 } }).find((t) => t.key === "satis")!;
  assert.deepEqual([closedEmpty.status, closedEmpty.href], ["todo", "/panel/ayarlar#lafpos"]);
  // Geçiş günü yokken alan yok, metinler bugünkü gibi
  assert.equal("lafpos" in monthTaskFacts(model, "2026-09", "closed", null, { payments: NO_PAYMENTS, parasut: null }).sales, false);
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
    stock: { lines: 1, total: 1, counted: 1, listed: 1 },
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

test("Faturalar: kontrol bekleyenler (kafe dışı dahil) kafe faturası sayısının alt kümesi gibi yazılmaz", () => {
  const f = {
    month: "2026-09",
    state: "closed",
    dim: 30,
    sales: { lines: 120, unmatched: 0, summaryRows: 0, refMonth: "2026-09" },
    info: { openDays: 30, posRevenue: 1000 },
    // 1 kafe faturası; kontrol bekleyen 3'ü karaoke box (sayıya girmez)
    invoices: { count: 1, goods: 1, review: 3 },
    water: { bill: null, usedInRecipes: false, perLiter: 0, costMonth: null, reason: "no-bill" },
    stock: { lines: 1, total: 1, counted: 1, listed: 1 },
    payments: null,
    parasut: null,
  } satisfies MonthTaskFacts;
  const t = monthTasks(f).find((x) => x.key === "fatura")!;
  assert.equal(t.status, "todo");
  assert.equal(t.href, "/panel/faturalar?ay=2026-09&durum=kontrol");
  assert.ok(!t.detail.includes("tanesinin"), t.detail);
  assert.match(t.detail, /^3 fatura kontrol bekliyor; doğruysa tek dokunuşla onaylayın\. Bu ay 1 kafe faturası var\.$/);
  // Kafe faturası yoksa "0 fatura" denmez
  const none = monthTasks({ ...f, invoices: { count: 0, goods: 0, review: 2 } }).find((x) => x.key === "fatura")!;
  assert.equal(none.detail, "2 fatura kontrol bekliyor; doğruysa tek dokunuşla onaylayın.");
});

test("Faturalar: ayın kasadan faturalı alımları bekliyorsa ya da iki kez sayılıyorsa ay kapanmış görünmez (inceleme U4)", () => {
  const f = {
    month: "2026-09",
    state: "closed",
    dim: 30,
    sales: { lines: 120, unmatched: 0, summaryRows: 0, refMonth: "2026-09" },
    info: { openDays: 30, posRevenue: 1000 },
    invoices: { count: 4, goods: 10, review: 0 },
    water: { bill: null, usedInRecipes: false, perLiter: 0, costMonth: null, reason: "no-bill" },
    stock: { lines: 1, total: 1, counted: 1, listed: 1 },
    payments: null,
    parasut: null,
  } satisfies MonthTaskFacts;
  assert.equal(monthTasks(f).find((x) => x.key === "fatura")!.status, "done");
  // Fişin günü ayda olanlar (yoksa kasanın günü); başka ayınkiler sayılmaz
  const state = {
    pending: [
      { store: "Migros", amount: 2400, date: "2026-10-01", receiptDate: "2026-09-29" },
      { store: "Metro", amount: 900, date: "2026-09-12", receiptDate: null },
      { store: "Bim", amount: 300, date: "2026-10-02", receiptDate: null },
    ],
    duplicates: [{ date: "2026-09-20", receiptDate: null }],
  };
  const cashOuts = monthCashOuts(state, "2026-09");
  assert.deepEqual(cashOuts, { count: 2, summary: `Migros ${money(2400)} ve 1 alım daha`, duplicates: 1 });
  assert.equal(monthCashOuts(state, "2026-08"), null);
  const t = monthTasks({ ...f, cashOuts }).find((x) => x.key === "fatura")!;
  assert.equal(t.status, "todo");
  assert.equal(t.href, "/panel/faturalar?durum=kontrol#kasa-faturali");
  assert.equal(
    t.detail,
    `2 kasa alımı Faturalar'da yok (Migros ${money(2400)} ve 1 alım daha): Faturalar'a ekleyin ya da Aylık harcamalar'a yazın, yoksa mal alımı eksik kalır. 1 kasa alımı iki kez sayılıyor (Aylık harcamalar'a yazılmıştı, faturası sonra geldi): gider kaydını silin. Bu ay 4 kafe faturası var.`,
  );
  // Kontrol bekleyen faturalarla birlikte: önce faturalar
  const both = monthTasks({ ...f, invoices: { ...f.invoices, review: 3 }, cashOuts: { count: 0, summary: "", duplicates: 2 } }).find((x) => x.key === "fatura")!;
  assert.match(both.detail, /^3 fatura kontrol bekliyor; doğruysa tek dokunuşla onaylayın\. 2 kasa alımı iki kez sayılıyor/);
  assert.equal(both.href, "/panel/faturalar?durum=kontrol#kasa-faturali");
});

test("Açık gün ve POS cirosu kasa raporlarından: tamamsa kaynağı yazar; kapanmış ayda eksik gün uyarıdır", () => {
  const base = {
    month: "2026-11",
    state: "closed",
    dim: 30,
    sales: { lines: 120, unmatched: 0, summaryRows: 0, refMonth: "2026-11" },
    info: {
      openDays: 30,
      posRevenue: 512_400,
      source: { openDays: "kasa", posRevenue: "kasa" },
      till: { missing: [], partialFrom: null },
    },
    invoices: { count: 1, goods: 1 },
    water: { bill: 3000, usedInRecipes: true, perLiter: 2.5, costMonth: "2026-11", reason: "ok" },
    stock: { lines: 1, total: 1, counted: 1, listed: 1 },
    payments: null,
    parasut: null,
  } satisfies MonthTaskFacts;
  const done = byKey(monthTasks(base)).gun;
  assert.equal(done.status, "done");
  assert.equal(done.detail.replace(/ /g, " "), "Kasa raporlarından: 30 / 30 gün açık · POS 512.400 ₺.");
  assert.equal(done.href, "/panel/satislar?ay=2026-11#m-days");
  // Süren ay: bugüne kadar, her raporla güncellenir
  const running = byKey(monthTasks({ ...base, state: "running", info: { ...base.info, openDays: 18, posRevenue: 245_300 } })).gun;
  assert.equal(running.detail.replace(/ /g, " "), "Kasa raporlarından: bugüne kadar 18 gün · POS 245.300 ₺. Her akşamki raporla güncellenir.");
  // Kapanmış ayda raporu girilmemiş gün: uyarı, Kasa'ya gider
  const gaps = byKey(monthTasks({ ...base, info: { ...base.info, openDays: 27, till: { missing: ["2026-11-05", "2026-11-12", "2026-11-20"], partialFrom: null } } })).gun;
  assert.equal(gaps.status, "warn");
  assert.equal(gaps.detail, "3 günün kasa raporu yok (5, 12, 20 Kasım); açık gün ve ciro eksik olabilir.");
  assert.equal(gaps.href, "/panel/kasa?ay=2026-11");
  assert.equal(gaps.action, "Kasaya bak");
  // Elle yazılmış ayda eksik gün uyarı değildir (ay bilgisi kasadan gelmiyor)
  const typed = byKey(monthTasks({ ...base, info: { ...base.info, source: { openDays: "manual", posRevenue: "manual" }, till: { missing: ["2026-11-05"], partialFrom: null } } })).gun;
  assert.equal(typed.status, "done");
  assert.doesNotMatch(typed.detail, /Kasa raporlarından/);
  // Modelden: yalnız kasa raporu olan ay da kaynağıyla gelir (sources ve till isteğe bağlı alanlar)
  const facts = monthTaskFacts(model, "2026-09", "closed", "2026-09", { payments: NO_PAYMENTS, parasut: null });
  assert.equal(facts.info.source, undefined, "Excel verisinde kaynak yok");
  assert.equal(facts.info.till, null);
});

test("defaultTaskMonth: ayın ilk 10 gününde işleri bitmemiş biten ay, değilse bu ay (sayım sayfasının kuralı)", () => {
  // 4 Kasım: Ekim'de 2 açık iş → Ekim; Ekim bittiyse Kasım
  const open = (n: number) => (m: string) => (m === "2026-10" ? n : 5);
  assert.equal(defaultTaskMonth(new Date("2026-11-04T12:00:00+03:00"), open(2)), "2026-10");
  assert.equal(defaultTaskMonth(new Date("2026-11-04T12:00:00+03:00"), open(0)), "2026-11");
  // 10'u son gün; 11'inde Ekim'in işleri bitmese de Kasım
  assert.equal(defaultTaskMonth(new Date("2026-11-10T22:00:00+03:00"), open(2)), "2026-10");
  assert.equal(defaultTaskMonth(new Date("2026-11-11T12:00:00+03:00"), open(2)), "2026-11");
  // İş günü 05:00'te döner: 1 Kasım 02:00 hâlâ 31 Ekim (bu ay Ekim, biten ay Eylül)
  assert.equal(defaultTaskMonth(new Date("2026-11-01T02:00:00+03:00"), (m) => (m === "2026-09" ? 1 : 0)), "2026-10");
  // Yıl başı
  assert.equal(defaultTaskMonth(new Date("2027-01-03T12:00:00+03:00"), (m) => (m === "2026-12" ? 1 : 0)), "2026-12");
});
