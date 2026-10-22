// Nakit planı (docs/NAKIT-PLANI.md): 6 haftalık dilimler, satış ve online tahmini, faturalar ve hatırlatıcılar,
// maaş / SGK / sabit gider / mal alımı tahminleri ve hatırlatıcı eşleşmesi, bakiye ve "gereken en az para", KDV
// yerleşimi (src/lib/kdv.ts), Excel verisinden girdiler, metinler ve ekranın kuralları.
// Çalıştırma: npx tsx --test tests/nakit-plani.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { mobileTitleFor, NAV_GROUPS } from "../src/components/panel/nav";
import {
  buildCashPlan,
  goodsRows,
  lineLabel,
  parseCashPlanState,
  PLAN_DAYS,
  planInputFromModel,
  planNotes,
  rangeText,
  reminderOccurrences,
  weekTitle,
  type CashPlan,
  type CashPlanInput,
  type PlanLine,
} from "../src/lib/cash-plan";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { vatMonthInputs } from "../src/lib/kdv";
import { addDays, daysBetween, FIXED_REMINDER_NOTE, UPCOMING_HORIZON_DAYS, type ReminderRow, type UpcomingItem } from "../src/lib/reminders";
import { canOpen } from "../src/lib/roles";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const model = createModel(ds);
const TODAY = "2026-10-22";
const END = "2026-12-02";
const close = (a: number | null | undefined, b: number, msg: string, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

const PAYROLL = { net: 60_000, sgk: 23_118, people: 2 };
const monthsWith = (fixed: CashPlanInput["months"][string]["fixed"] = [], payroll = PAYROLL): CashPlanInput["months"] =>
  Object.fromEntries(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].map((m) => [m, { payroll, fixed }]));

function input(over: Partial<CashPlanInput> = {}): CashPlanInput {
  return {
    today: TODAY,
    opening: null,
    excluded: [],
    settings: { komisyon: 0.025, kartOrani: 0.8, acikGun: 30, kdv: 0.1, kdvHizmet: 0.2 },
    invoiceTermDays: 30,
    cashReports: [],
    posMonth: null,
    online: null,
    invoices: [],
    reminders: [],
    goods: [],
    goodsSpanDays: 0,
    months: monthsWith([], { net: 0, sgk: 0, people: 0 }),
    fixedNames: [],
    vat: { months: [], firstSalesMonth: null, hasSite: false },
    vatAnchor: null,
    ...over,
  };
}
const lines = (p: CashPlan): PlanLine[] => p.weeks.flatMap((w) => w.lines);
const byKey = (p: CashPlan, key: string) => lines(p).filter((l) => l.key === key);
const lineAt = (p: CashPlan, prefix: string) => lines(p).filter((l) => l.key.startsWith(prefix));

let nextId = 1;
const rem = (over: Partial<ReminderRow>): ReminderRow => ({
  id: nextId++,
  title: "Kira",
  kind: "kira",
  amount: 5_000,
  dueDate: "2026-11-01",
  anchorDate: over.dueDate ?? "2026-11-01",
  repeat: "monthly",
  remindDaysBefore: 3,
  note: null,
  active: true,
  ...over,
});
const invoice = (id: number, dueDate: string, amount = 1_000, title = "Sütaş"): UpcomingItem => ({
  ref: `invoice:${id}`,
  source: "invoice",
  sourceId: id,
  kind: "fatura",
  title,
  detail: `Fatura ${id}`,
  amount,
  dueDate,
  daysLeft: daysBetween(TODAY, dueDate),
  status: "later",
  remindDaysBefore: 3,
  repeat: "none",
});

// ---------------------------------------------------------------- Dilimler

test("dilimler: 6 × 7 gün, ilki bugün; başlık ve aralık metni; ufuk Ödemeler'inkinden kısa", () => {
  const p = buildCashPlan(input());
  assert.equal(p.weeks.length, 6);
  assert.equal(p.weeks[0].from, TODAY);
  assert.equal(p.weeks[0].to, "2026-10-28");
  assert.equal(p.weeks[1].from, "2026-10-29");
  assert.equal(p.weeks[5].to, END);
  assert.equal(p.end, END);
  for (const w of p.weeks) assert.equal(daysBetween(w.from, w.to), 6);
  assert.deepEqual([0, 1, 2, 5].map(weekTitle), ["Bu hafta", "Gelecek hafta", "3. hafta", "6. hafta"]);
  // Gün ile ay arasında bölünmez boşluk
  assert.equal(rangeText("2026-10-22", "2026-10-28"), "22–28\u00a0Eki");
  assert.equal(rangeText("2026-10-29", "2026-11-04"), "29\u00a0Eki – 4\u00a0Kas");
  assert.ok(PLAN_DAYS <= UPCOMING_HORIZON_DAYS);
  assert.equal(p.hasData, false);
  assert.equal(lineLabel({ title: "Maaşlar (Ekim)", estimated: true }), "Maaşlar (Ekim, tahmini)");
  assert.equal(lineLabel({ title: "Satışlar", estimated: true }), "Satışlar (tahmini)");
  assert.equal(lineLabel({ title: "Sütaş", estimated: false }), "Sütaş");
});

// ---------------------------------------------------------------- Satışlar

test("satışlar: kasa raporlarının ortalaması, kart payıyla komisyon, açık gün oranı; yarından; yetmezse POS ayı; ikisi de yoksa yok", () => {
  const reports = Array.from({ length: 10 }, (_, i) => ({ date: addDays(TODAY, -1 - i), zTotal: 10_000, card: 6_000, mealCard: 2_000 }));
  // Sayılmayanlar: Z toplamı 0, bugünün raporu, 28 günden eski rapor
  const noise = [
    { date: addDays(TODAY, -12), zTotal: 0, card: 0, mealCard: 0 },
    { date: TODAY, zTotal: 50_000, card: 0, mealCard: 0 },
    { date: addDays(TODAY, -29), zTotal: 50_000, card: 0, mealCard: 0 },
  ];
  const settings = { komisyon: 0.025, kartOrani: 0.5, acikGun: 26, kdv: 0.1, kdvHizmet: 0.2 };
  const p = buildCashPlan(input({ cashReports: [...reports, ...noise], settings }));
  assert.deepEqual(p.basis.sales, { kind: "kasa", reports: 10, daily: 10_000, cardShare: 0.8, platformShare: 0 });
  const perDay = 10_000 * (1 - 0.025 * 0.8) * (26 / 30);
  // Gün 0 boş (bugünkü satış bakiyeye dahil), gün 1'den itibaren her gün
  close(byKey(p, "sales")[0].amount, 6 * perDay, "bu hafta 6 gün");
  close(p.weeks[1].lines.find((l) => l.key === "sales")!.amount, 7 * perDay, "gelecek hafta 7 gün");
  close(p.totals.in, 41 * perDay, "toplam");
  // 6 rapor: POS ayına düşer (kart payı Ayarlar'dan)
  const pos = buildCashPlan(input({ cashReports: reports.slice(0, 6), settings, posMonth: { month: "2026-10", posRevenue: 293_909, openDays: 16 } }));
  assert.equal(pos.basis.sales.kind, "pos");
  close(pos.basis.sales.kind === "pos" ? pos.basis.sales.daily : 0, 293_909 / 16, "POS günlük");
  close(byKey(pos, "sales")[0].amount, 6 * (293_909 / 16) * (1 - 0.025 * 0.5) * (26 / 30), "POS bu hafta");
  // İkisi de yok: satış yok
  const none = buildCashPlan(input({ cashReports: reports.slice(0, 6) }));
  assert.deepEqual(none.basis.sales, { kind: "none" });
  assert.equal(none.totals.in, 0);
  assert.equal(byKey(none, "sales").length, 0);
  // Tahmine katılmıyor
  assert.equal(buildCashPlan(input({ cashReports: reports, excluded: ["sales"] })).totals.in, 0);
});

test("laffogato.net online: günlük ortalama yarından", () => {
  const p = buildCashPlan(input({ online: { month: "2026-09", perDay: 420 } }));
  close(byKey(p, "online")[0].amount, 6 * 420, "bu hafta");
  close(p.totals.in, 41 * 420, "toplam");
  assert.equal(buildCashPlan(input({ online: { month: "2026-09", perDay: 420 }, excluded: ["online"] })).totals.in, 0);
});

// ---------------------------------------------------------------- Faturalar ve hatırlatıcılar

test("faturalar: gecikmiş olan bugüne (asıl vadesiyle), 41. gün dahil, 42. gün hariç; tutar kalan borç", () => {
  const p = buildCashPlan(input({ invoices: [invoice(1, "2026-10-10", 11_516.77), invoice(2, addDays(TODAY, 41), 2_000), invoice(3, addDays(TODAY, 42), 3_000), invoice(4, "2026-11-03", 4_000)] }));
  const late = byKey(p, "invoice:1")[0];
  assert.equal(late.date, TODAY);
  assert.equal(late.due, "2026-10-10");
  assert.equal(late.overdue, true);
  assert.equal(late.amount, 11_516.77);
  assert.equal(late.estimated, false);
  assert.equal(byKey(p, "invoice:2")[0].date, END);
  assert.equal(byKey(p, "invoice:3").length, 0);
  assert.equal(p.weeks[1].lines[0].key, "invoice:4");
  assert.equal(p.basis.overdueInvoices, 1);
  close(p.totals.outKnown, 11_516.77 + 2_000 + 4_000, "kesin");
  // Bakiye yok: bugün gereken en az para gecikmiş fatura kadar
  close(p.requiredCash, 11_516.77 + 4_000 + 2_000, "gereken");
});

test("hatırlatıcı dönemleri: aylık, gecikmiş aylık (bugün + sonrakiler), haftalık, tek seferlik", () => {
  assert.deepEqual(
    reminderOccurrences({ dueDate: "2026-11-01", anchorDate: "2026-11-01", repeat: "monthly" }, TODAY, END).map((o) => o.date),
    ["2026-11-01", "2026-12-01"],
  );
  assert.deepEqual(reminderOccurrences({ dueDate: "2026-10-01", anchorDate: "2026-10-01", repeat: "monthly" }, TODAY, END), [
    { date: TODAY, due: "2026-10-01", overdue: true },
    { date: "2026-11-01", due: "2026-11-01", overdue: false },
    { date: "2026-12-01", due: "2026-12-01", overdue: false },
  ]);
  assert.equal(reminderOccurrences({ dueDate: "2026-10-23", anchorDate: "2026-10-23", repeat: "weekly" }, TODAY, END).length, 6);
  assert.deepEqual(reminderOccurrences({ dueDate: "2026-10-01", anchorDate: "2026-10-01", repeat: "none" }, TODAY, END), [{ date: TODAY, due: "2026-10-01", overdue: true }]);
  assert.deepEqual(reminderOccurrences({ dueDate: "2026-12-05", anchorDate: "2026-12-05", repeat: "none" }, TODAY, END), []);
});

test("hatırlatıcılar: tutarlı olan her dönemiyle kesin; tutarsız diğer hatırlatıcı plana girmez, listede", () => {
  const kira = rem({ title: "Dükkân kirası", amount: 5_000 });
  const late = rem({ title: "Aidat", kind: "odeme", amount: 1_500, dueDate: "2026-10-01" });
  const weekly = rem({ title: "Temizlik", kind: "odeme", amount: 700, dueDate: "2026-10-23", repeat: "weekly" });
  const muhtasar = rem({ title: "Muhtasar ve prim hizmet beyannamesi", kind: "vergi", amount: null, dueDate: "2026-10-26" });
  const closed = rem({ title: "Eski", kind: "odeme", amount: 9_999, dueDate: "2026-11-02", active: false });
  const p = buildCashPlan(input({ reminders: [kira, late, weekly, muhtasar, closed] }));
  assert.deepEqual(
    lineAt(p, `reminder:${kira.id}@`).map((l) => [l.date, l.amount, l.estimated]),
    [
      ["2026-11-01", 5_000, false],
      ["2026-12-01", 5_000, false],
    ],
  );
  const aidat = lineAt(p, `reminder:${late.id}@`);
  assert.deepEqual(
    aidat.map((l) => [l.date, l.overdue]),
    [
      [TODAY, true],
      ["2026-11-01", false],
      ["2026-12-01", false],
    ],
  );
  assert.equal(aidat[0].due, "2026-10-01");
  assert.equal(lineAt(p, `reminder:${weekly.id}@`).length, 6);
  assert.equal(lineAt(p, `reminder:${closed.id}@`).length, 0);
  assert.deepEqual(p.unknownAmounts, [{ reminderId: muhtasar.id, title: muhtasar.title, date: "2026-10-26" }]);
});

test("hatırlatıcılar: bir hafta geciken haftalık ödemenin iki dönemi bugünde, satır anahtarları ayrı", () => {
  const weekly = rem({ title: "Temizlik", kind: "odeme", amount: 700, dueDate: "2026-10-15", repeat: "weekly" });
  const p = buildCashPlan(input({ reminders: [weekly] }));
  const today = lineAt(p, `reminder:${weekly.id}@`).filter((l) => l.date === TODAY);
  assert.deepEqual(
    today.map((l) => [l.key, l.overdue]),
    [
      [`reminder:${weekly.id}@2026-10-15`, true],
      [`reminder:${weekly.id}@${TODAY}`, false],
    ],
  );
  // Haftanın listesi (React anahtarı) ve bütün plan: aynı anahtar iki kez yok
  for (const w of p.weeks) assert.equal(new Set(w.lines.map((l) => l.key)).size, w.lines.length, `${w.from} haftasında aynı anahtar`);
});

// ---------------------------------------------------------------- Maaş ve SGK

test("maaş ve SGK: hatırlatıcı yoksa 1'inde önceki ayın bordrosu, ay sonunda önceki ayın SGK'sı", () => {
  const p = buildCashPlan(input({ months: monthsWith() }));
  assert.deepEqual(
    lineAt(p, "salary@").map((l) => [l.date, l.title, l.amount, l.estimated]),
    [
      ["2026-11-01", "Maaşlar (Ekim)", 60_000, true],
      ["2026-12-01", "Maaşlar (Kasım)", 60_000, true],
    ],
  );
  assert.deepEqual(
    lineAt(p, "sgk@").map((l) => [l.date, l.title, l.amount]),
    [
      ["2026-10-31", "SGK primi (Eylül)", 23_118],
      ["2026-11-30", "SGK primi (Ekim)", 23_118],
    ],
  );
  assert.equal(p.basis.salaryMode, "default");
  assert.deepEqual(p.basis.payroll, PAYROLL);
  // Tahmine katılmayan maaş hiç yazılmaz
  const off = buildCashPlan(input({ months: monthsWith(), excluded: ["salary"] }));
  assert.equal(lineAt(off, "salary@").length, 0);
  assert.equal(off.estimates.find((e) => e.key === "salary")!.status, "off");
});

test("maaş hatırlatıcısı: tutarlıysa tahmin yok; tutarsızsa günü onun, tutarı bordro; 'Muhasebeci' sabit gider adıdır, maaşı kapatmaz", () => {
  const paid = rem({ title: "Maaş ödemesi", kind: "maas", amount: 65_000, dueDate: "2026-11-01" });
  const withAmount = buildCashPlan(input({ months: monthsWith(), reminders: [paid] }));
  assert.equal(lineAt(withAmount, "salary@").length, 0);
  assert.deepEqual(
    lineAt(withAmount, `reminder:${paid.id}@`).map((l) => [l.date, l.amount, l.estimated]),
    [
      ["2026-11-01", 65_000, false],
      ["2026-12-01", 65_000, false],
    ],
  );
  assert.equal(withAmount.basis.salaryMode, "reminder");
  assert.equal(withAmount.estimates.find((e) => e.key === "salary")!.status, "covered");

  const carrier = rem({ title: "Maaş ödemesi", kind: "maas", amount: null, dueDate: "2026-11-05" });
  const second = rem({ title: "Avans", kind: "maas", amount: null, dueDate: "2026-11-20" });
  const est = buildCashPlan(input({ months: monthsWith(), reminders: [carrier, second] }));
  assert.equal(lineAt(est, "salary@").length, 0);
  assert.deepEqual(
    lineAt(est, `reminder:${carrier.id}@`).map((l) => [l.date, l.title, l.amount, l.estimated]),
    [["2026-11-05", "Maaş ödemesi (Ekim)", 60_000, true]],
  );
  assert.equal(est.basis.salaryMode, "carrier");
  // Taşıyıcı olmayan tutarsız maaş hatırlatıcısı listede
  assert.deepEqual(
    est.unknownAmounts.map((u) => u.reminderId),
    [second.id],
  );
  // Maaşa çıkarılan tahmin, taşıyıcınınki dahil, hiç yazılmaz
  const off = buildCashPlan(input({ months: monthsWith(), reminders: [carrier], excluded: ["salary"] }));
  assert.equal(lineAt(off, `reminder:${carrier.id}@`).length, 0);

  // Muhasebeci (sabit gider, Ödemeler'e "maas" türüyle eklenir): maaşı kapatmaz, kendi yayılan tahminini kapatır
  const fixed = [
    { id: 10, name: "Muhasebeci", period: "aylik" as const, amount: 10_000 },
    { id: 1, name: "Kira", period: "aylik" as const, amount: 31_000 },
  ];
  const acc = rem({ title: "Muhasebeci", kind: "maas", amount: null, dueDate: "2026-11-03" });
  const p = buildCashPlan(input({ months: monthsWith(fixed), fixedNames: fixed, reminders: [acc] }));
  assert.equal(lineAt(p, "salary@").length, 2);
  assert.deepEqual(
    lineAt(p, `reminder:${acc.id}@`).map((l) => [l.date, l.amount, l.estimated, l.kind]),
    [["2026-11-03", 10_000, true, "fixed"]],
  );
  assert.doesNotMatch(lines(p).find((l) => l.key === "fixed")!.detail!, /Muhasebeci/);
  assert.equal(p.estimates.find((e) => e.key === "fixed:10")!.status, "covered");
});

test("sabit giderden açılan maaş türü hatırlatıcı: gideri silinir ya da adı değişirse bordroyu kapatmaz, taşımaz", () => {
  // "Sabit giderlerden ekle" personel kalemini maaş türüyle açar, notu bu sabit
  assert.equal(FIXED_REMINDER_NOTE, "Sabit giderlerden");
  assert.match(read("src/server/actions/reminders.ts"), /note: FIXED_REMINDER_NOTE,/);
  const partTime = rem({ title: "Part-time çalışan", kind: "maas", amount: 3_000, dueDate: "2026-10-23", repeat: "weekly", note: FIXED_REMINDER_NOTE });
  const renamed = [{ id: 3, name: "Part-time eleman", period: "haftalik" as const }];
  for (const fixedNames of [renamed, []]) {
    const p = buildCashPlan(input({ months: monthsWith(), fixedNames, reminders: [partTime] }));
    // Bordro tahmini yerinde
    assert.equal(p.basis.salaryMode, "default");
    assert.deepEqual(
      lineAt(p, "salary@").map((l) => [l.date, l.amount]),
      [
        ["2026-11-01", 60_000],
        ["2026-12-01", 60_000],
      ],
    );
    assert.equal(p.estimates.find((e) => e.key === "salary")!.status, "on");
    // Hatırlatıcı diğerleri gibi: tutarı her dönemiyle kesin
    const own = lineAt(p, `reminder:${partTime.id}@`);
    assert.equal(own.length, 6);
    assert.ok(own.every((l) => l.kind === "reminder" && l.amount === 3_000 && !l.estimated));
  }
  // Tutarsızsa bordroyu taşımaz: "Tutarı girilmemiş ödemeler"de
  const acc = rem({ title: "Muhasebeci", kind: "maas", amount: null, dueDate: "2026-11-03", note: FIXED_REMINDER_NOTE });
  const q = buildCashPlan(input({ months: monthsWith(), reminders: [acc] }));
  assert.equal(q.basis.salaryMode, "default");
  assert.equal(lineAt(q, "salary@").length, 2);
  assert.equal(lineAt(q, `reminder:${acc.id}@`).length, 0);
  assert.deepEqual(
    q.unknownAmounts.map((u) => u.reminderId),
    [acc.id],
  );
  // Elle açılan maaş türü hatırlatıcı maaştır
  const manual = rem({ title: "Part-time çalışan", kind: "maas", amount: 3_000, dueDate: "2026-10-23", repeat: "weekly", note: "Cuma günleri" });
  assert.equal(buildCashPlan(input({ months: monthsWith(), reminders: [manual] })).basis.salaryMode, "reminder");
});

test("SGK hatırlatıcısı da aynı kuralla; 'SGK prim ödemesi' SGK'dır", () => {
  const sgk = rem({ title: "SGK prim ödemesi", kind: "vergi", amount: null, dueDate: "2026-10-31", anchorDate: "2026-10-31" });
  const p = buildCashPlan(input({ months: monthsWith(), reminders: [sgk] }));
  assert.equal(lineAt(p, "sgk@").length, 0);
  assert.deepEqual(
    lineAt(p, `reminder:${sgk.id}@`).map((l) => [l.date, l.amount, l.title]),
    [
      ["2026-10-31", 23_118, "SGK prim ödemesi (Eylül)"],
      ["2026-11-30", 23_118, "SGK prim ödemesi (Ekim)"],
    ],
  );
  assert.equal(p.basis.sgkMode, "carrier");
});

// ---------------------------------------------------------------- Sabit giderler

test("sabit giderler: aylık ayın gününe, haftalık 7'ye bölünür, günlük açık gün oranıyla; yıllık plana girmez; kapatılan sayılmaz", () => {
  const oct = [
    { id: 1, name: "Kira", period: "aylik" as const, amount: 31_000 },
    { id: 2, name: "Personel yemeği", period: "gunluk" as const, amount: 300 },
    { id: 3, name: "Part-time", period: "haftalik" as const, amount: 700 },
    { id: 14, name: "ModPOS / Patron aboneliği", period: "yillik" as const, amount: 5_000 },
  ];
  // Kasım'dan itibaren kira 30.000 (sürüm)
  const nov = oct.map((f) => (f.id === 1 ? { ...f, amount: 30_000 } : f));
  const months = { ...monthsWith(oct), "2026-11": { payroll: PAYROLL, fixed: nov }, "2026-12": { payroll: PAYROLL, fixed: nov } };
  const settings = { komisyon: 0.025, kartOrani: 0.8, acikGun: 26, kdv: 0.1, kdvHizmet: 0.2 };
  const p = buildCashPlan(input({ months, fixedNames: oct, settings }));
  const perDayOct = 1_000 + 300 * (26 / 30) + 100;
  const perDayNov = 1_000 + 300 * (26 / 30) + 100;
  close(p.weeks[0].lines.find((l) => l.key === "fixed")!.amount, 6 * perDayOct, "bu hafta (gün 1–6)");
  close(p.weeks[1].lines.find((l) => l.key === "fixed")!.amount, 3 * perDayOct + 4 * perDayNov, "29 Eki – 4 Kas");
  assert.deepEqual(p.notIncluded, [{ title: "ModPOS / Patron aboneliği", amount: 5_000, period: "yillik" }]);
  assert.equal(p.estimates.find((e) => e.key === "fixed:14")!.status, "yearly");
  assert.equal(p.basis.fixedSpread.count, 3);
  // Kapatılan kalem sayılmaz, satırı "off"
  const off = buildCashPlan(input({ months, fixedNames: oct, settings, excluded: ["fixed:1"] }));
  close(off.weeks[0].lines.find((l) => l.key === "fixed")!.amount, 6 * (300 * (26 / 30) + 100), "kirasız");
  assert.equal(off.estimates.find((e) => e.key === "fixed:1")!.status, "off");
  // Tutarlı "Kira" hatırlatıcısı yayılan tahmini kapatır; tutarsızı giderin tutarını taşır
  const kira = rem({ title: "Kira", amount: null, dueDate: "2026-11-01" });
  const carried = buildCashPlan(input({ months, fixedNames: oct, settings, reminders: [kira] }));
  assert.deepEqual(
    lineAt(carried, `reminder:${kira.id}@`).map((l) => [l.date, l.amount, l.estimated]),
    [
      ["2026-11-01", 30_000, true],
      ["2026-12-01", 30_000, true],
    ],
  );
  assert.doesNotMatch(carried.weeks[1].lines.find((l) => l.key === "fixed")!.detail!, /Kira/);
});

// ---------------------------------------------------------------- Mal alımı

test("mal alımı: son 8 haftanın mal faturaları; peşin tedarikçi gün 1'den, 30 gün vadeli gün 31'den; 14 günden kısa geçmişte yok", () => {
  const goods = [
    { supplier: "Pazar", date: "2026-08-01", payable: 5_600, category: "Hammadde & İçecek" },
    { supplier: "Pazar", date: "2026-10-01", payable: 5_600, category: "Hammadde & İçecek" },
    { supplier: "Sütaş", date: "2026-10-10", payable: 11_200, category: "Hammadde & İçecek" },
    // Sayılmayanlar: kafe dışı, demirbaş, komisyon, bugünkü
    { supplier: "MaviBahçe", date: "2026-10-05", payable: 99_999, category: "Karaoke box" },
    { supplier: "Mobilya", date: "2026-10-05", payable: 99_999, category: "Kuruluş & Demirbaş" },
    { supplier: "Yemeksepeti", date: "2026-10-05", payable: 99_999, category: "Komisyon" },
    { supplier: "Pazar", date: TODAY, payable: 99_999, category: "Hammadde & İçecek" },
  ];
  const g = goodsRows(goods, TODAY, (s) => (s === "Pazar" ? 0 : 30));
  assert.equal(g.spanDays, 56);
  // Pencere [bugün − 56, dün]: 1 Ağustos'taki fatura dışarıda
  assert.deepEqual(
    g.rows.map((r) => [r.supplier, r.payable, r.lagDays]),
    [
      ["Pazar", 5_600, 0],
      ["Sütaş", 11_200, 30],
    ],
  );
  const p = buildCashPlan(input({ goods: g.rows, goodsSpanDays: g.spanDays }));
  const goodsLine = (w: number) => p.weeks[w].lines.find((l) => l.key === "goods")?.amount ?? 0;
  close(goodsLine(0), 6 * 100, "peşin: gün 1–6");
  close(goodsLine(4), 7 * 100 + 4 * 200, "vadeli gün 31'den (25 Kas)");
  assert.equal(p.basis.goods!.weekly, 2_100);
  assert.deepEqual(
    p.basis.goods!.top.map((t) => [t.supplier, t.weekly, t.lagDays]),
    [
      ["Sütaş", 1_400, 30],
      ["Pazar", 700, 0],
    ],
  );
  // Yetersiz geçmiş
  assert.deepEqual(goodsRows([{ supplier: "Pazar", date: addDays(TODAY, -10), payable: 1_000, category: "Ambalaj" }], TODAY, () => 0), { rows: [], spanDays: 0 });
  assert.equal(buildCashPlan(input({ goods: [], goodsSpanDays: 0 })).basis.goods, null);
});

// ---------------------------------------------------------------- Bakiye

test("bakiye: hafta sonu bakiyeleri, ilk eksi gün ve en büyük iki gideri, en düşük gün, eski bakiye; bakiye yoksa gereken en az para", () => {
  const reminders = [rem({ title: "Kira", amount: 160_000, dueDate: "2026-11-01" }), rem({ title: "Elektrik", kind: "odeme", amount: 12_000, dueDate: "2026-11-01" })];
  const base = input({ months: monthsWith(), reminders, online: { month: "2026-09", perDay: 1_000 } });
  const p = buildCashPlan({ ...base, opening: { amount: 100_000, date: "2026-10-17" } });
  assert.equal(p.opening!.staleDays, 5);
  // Hafta 0: 6 gün online, SGK (31 Eki) gelecek hafta
  close(p.weeks[0].endBalance, 106_000, "bu hafta sonu");
  close(p.weeks[1].endBalance, 106_000 + 7_000 - 23_118 - 160_000 - 12_000 - 60_000, "gelecek hafta sonu");
  assert.equal(p.firstNegative!.date, "2026-11-01");
  close(p.firstNegative!.balance, 100_000 + 10 * 1_000 - 23_118 - 160_000 - 12_000 - 60_000, "1 Kasım");
  assert.deepEqual(
    p.firstNegative!.top.map((l) => [l.title, l.amount]),
    [
      ["Kira", 160_000],
      ["Maaşlar (Ekim)", 60_000],
    ],
  );
  assert.equal(p.lowest!.basis, "balance");
  assert.equal(p.requiredCash, 0);
  // Bakiye yok: birikimli net, gereken en az para en düşük birikimli günün eksiği
  const n = buildCashPlan(base);
  assert.equal(n.firstNegative, null);
  assert.equal(n.lowest!.basis, "cumulative");
  assert.equal(n.lowest!.date, "2026-12-01");
  close(n.requiredCash, -n.lowest!.value, "gereken");
  assert.equal(n.weeks[0].endBalance, null);
  close(n.weeks[0].cumulative, 6_000, "birikimli");
  // Eksi bakiye (kredili hesap) aynen yürür
  const neg = buildCashPlan({ ...base, opening: { amount: -5_000, date: TODAY } });
  assert.equal(neg.firstNegative!.date, TODAY);
  assert.equal(neg.opening!.staleDays, 0);
});

test("kayıtlı durum: bozuk alanlar varsayılana düşer, bilinmeyen anahtar atılır", () => {
  assert.deepEqual(parseCashPlanState(null), { balance: null, balanceDate: null, balanceBy: null, excluded: [], vatCarry: null });
  assert.deepEqual(parseCashPlanState({ balance: 85_000, balanceDate: "2026-10-22", balanceBy: "Yönetici", excluded: ["sales", "fixed:3", "fixed:x", "kdv", 4, "sales"], vatCarry: { month: "2026-09", amount: 140_000, date: "2026-10-20", by: "Yönetici" } }), {
    balance: 85_000,
    balanceDate: "2026-10-22",
    balanceBy: "Yönetici",
    excluded: ["sales", "fixed:3", "kdv"],
    vatCarry: { month: "2026-09", amount: 140_000, date: "2026-10-20", by: "Yönetici" },
  });
  // Tarihsiz bakiye ve bozuk devreden yok sayılır
  assert.equal(parseCashPlanState({ balance: 5 }).balance, null);
  assert.equal(parseCashPlanState({ vatCarry: { month: "2026-13", amount: 5 } }).vatCarry, null);
  assert.equal(parseCashPlanState({ vatCarry: { month: "2026-09", amount: -5 } }).vatCarry, null);
});

// ---------------------------------------------------------------- KDV yerleşimi

const vat = vatMonthInputs(model, TODAY);
const withVat = (over: Partial<CashPlanInput> = {}) => buildCashPlan(input({ vat, ...over }));

test("KDV: hatırlatıcı yokken ayın 28'inde, yarından; otomatik zincirde ödeme beklenmez", () => {
  const anchored = withVat({ vatAnchor: { month: "2026-08", amount: 0 } });
  assert.equal(anchored.vat!.mode, "default");
  assert.deepEqual(
    lineAt(anchored, "kdv@").map((l) => [l.key, l.title, l.amount, l.estimated]),
    [
      ["kdv@2026-10-28", "KDV (Eylül)", 27_300, true],
      ["kdv@2026-11-28", "KDV (Ekim)", 42_100, true],
    ],
  );
  assert.ok(anchored.weeks[0].lines.some((l) => l.key === "kdv@2026-10-28"));
  assert.ok(anchored.weeks[5].lines.some((l) => l.key === "kdv@2026-11-28"));
  assert.equal(byKey(anchored, "kdv@2026-11-28")[0].href, "#kdv");
  assert.equal(anchored.vat!.rows.length, 2);
  // 28 Ekim bugünse yazılmaz (bugünkü ödeme elinizdeki paradan)
  const on28 = buildCashPlan(input({ today: "2026-10-28", vat: vatMonthInputs(model, "2026-10-28"), vatAnchor: { month: "2026-08", amount: 0 } }));
  assert.deepEqual(
    lineAt(on28, "kdv@").map((l) => l.date),
    ["2026-11-28"],
  );
  // Otomatik zincir (Excel): iki dönem de 0, plana satır girmez
  const auto = withVat();
  assert.equal(lineAt(auto, "kdv@").length, 0);
  assert.deepEqual(
    auto.vat!.rows.map((r) => [r.key, r.amount]),
    [
      ["kdv@2026-10-28", 0],
      ["kdv@2026-11-28", 0],
    ],
  );
  assert.equal(auto.vat!.chainFrom, "2026-07");
  assert.equal(auto.estimates.find((e) => e.key === "kdv")!.note, "Ayın 28'inde · Ekim için ödeme beklenmez");
  assert.equal(anchored.estimates.find((e) => e.key === "kdv")!.note, "Ayın 28'inde · Ekim için ≈ 42.100 ₺");
  // Hiç veri ve KDV hatırlatıcısı yoksa kart yok
  assert.equal(buildCashPlan(input()).vat, null);
});

const kdvRem = (over: Partial<ReminderRow> = {}) => rem({ title: "KDV beyannamesi ve ödemesi", kind: "vergi", amount: null, dueDate: "2026-10-28", ...over });

test("KDV hatırlatıcısı: tahmin onun günlerinde; tutarı o dönemin kesin tutarı, sonraki dönem yine tahmin", () => {
  const r = kdvRem();
  const p = withVat({ reminders: [r], vatAnchor: { month: "2026-08", amount: 0 } });
  assert.equal(p.vat!.mode, "reminder");
  assert.deepEqual(
    lineAt(p, "kdv@").map((l) => [l.date, l.amount]),
    [
      ["2026-10-28", 27_300],
      ["2026-11-28", 42_100],
    ],
  );
  assert.equal(p.unknownAmounts.length, 0);
  // Tutar 27.200: 28 Eki kesin hatırlatıcı satırı, 28 Kas tahmin (Eylül'ün devredeni sıfırlandı)
  const known = withVat({ reminders: [kdvRem({ id: r.id, amount: 27_200 })] });
  assert.deepEqual(
    lineAt(known, `reminder:${r.id}@`).map((l) => [l.date, l.amount, l.estimated]),
    [["2026-10-28", 27_200, false]],
  );
  assert.deepEqual(
    lineAt(known, "kdv@").map((l) => [l.date, l.amount]),
    [["2026-11-28", 42_100]],
  );
  assert.equal(known.vat!.rows[0].source, "reminder");
  assert.equal(known.vat!.rows[0].estimate!.known, 27_200);
  // Tutar 0: o dönem ödeme yok, satır yok
  const zero = withVat({ reminders: [kdvRem({ id: r.id, amount: 0 })] });
  assert.equal(lineAt(zero, `reminder:${r.id}@`).length, 0);
  assert.equal(zero.vat!.rows[0].amount, 0);
  assert.equal(zero.vat!.rows[0].source, "reminder");
});

test("KDV: gecikmiş hatırlatıcı bugüne önceki dönemle; ertelenmiş kopya ve seri kendi dönemini alır; aynı aya ikinci hatırlatıcı listede", () => {
  const late = kdvRem({ dueDate: "2026-09-28" });
  const p = withVat({ reminders: [late], vatAnchor: { month: "2026-06", amount: 0 } });
  const rows = p.vat!.rows;
  assert.deepEqual(
    rows.map((r) => [r.date, r.period, r.overdue]),
    [
      [TODAY, "2026-08", true],
      ["2026-10-28", "2026-09", false],
      ["2026-11-28", "2026-10", false],
    ],
  );
  assert.equal(rows[0].due, "2026-09-28");
  // 1 hafta ertelenmiş tek seferlik kopya (4 Kas) Eylül'ü, seri (28 Kas) Ekim'i taşır
  const copy = kdvRem({ dueDate: "2026-11-04", repeat: "none" });
  const series = kdvRem({ dueDate: "2026-11-28", anchorDate: "2026-10-28" });
  const q = withVat({ reminders: [series, copy], vatAnchor: { month: "2026-08", amount: 0 } });
  assert.deepEqual(
    q.vat!.rows.map((r) => [r.date, r.period, r.amount]),
    [
      ["2026-11-04", "2026-09", 27_300],
      ["2026-11-28", "2026-10", 42_100],
    ],
  );
  // Aynı aya düşen ikinci tutarsız KDV hatırlatıcısı
  const dup = kdvRem({ title: "Kdv ödemesi", kind: "odeme", dueDate: "2026-11-26" });
  const d = withVat({ reminders: [series, dup] });
  assert.deepEqual(
    d.unknownAmounts.map((u) => u.reminderId),
    [series.id],
  );
});

test("KDV tevkifatı (KDV2, 2 No.lu) asıl KDV değildir: tutarı her dönemiyle kesin; asıl KDV'nin dönemini almaz, devredeni sıfırlamaz", () => {
  const main = kdvRem();
  const kdv2 = rem({ title: "KDV2 tevkifat", kind: "vergi", amount: 3_000, dueDate: "2026-10-26" });
  const p = withVat({ reminders: [main, kdv2] });
  assert.deepEqual(
    lineAt(p, `reminder:${kdv2.id}@`).map((l) => [l.date, l.amount, l.estimated]),
    [
      ["2026-10-26", 3_000, false],
      ["2026-11-26", 3_000, false],
    ],
  );
  // Asıl KDV hatırlatıcısı iki dönemi de tahminle taşır; otomatik zincirde (Excel) ikisinde de ödeme beklenmez
  assert.deepEqual(
    p.vat!.rows.map((r) => [r.date, r.period, r.source, r.amount, r.reminderId]),
    [
      ["2026-10-28", "2026-09", "estimate", 0, main.id],
      ["2026-11-28", "2026-10", "estimate", 0, main.id],
    ],
  );
  assert.equal(lineAt(p, "kdv@").length, 0);
  assert.equal(p.unknownAmounts.length, 0);
});

test("KDV tahmine katılmıyorsa: tahmin satırı yok, tutarsız dönem listede, kart 'katılmıyor'", () => {
  const r = kdvRem();
  const p = withVat({ reminders: [r], excluded: ["kdv"], vatAnchor: { month: "2026-08", amount: 0 } });
  assert.equal(lineAt(p, "kdv@").length, 0);
  assert.equal(p.vat!.mode, "excluded");
  assert.deepEqual(
    p.unknownAmounts.map((u) => [u.reminderId, u.date]),
    [[r.id, "2026-10-28"]],
  );
  assert.equal(p.estimates.find((e) => e.key === "kdv")!.status, "off");
  // Hatırlatıcısız: satır yok, liste boş
  const d = withVat({ excluded: ["kdv"], vatAnchor: { month: "2026-08", amount: 0 } });
  assert.equal(lineAt(d, "kdv@").length, 0);
  assert.equal(d.unknownAmounts.length, 0);
  assert.match(planNotes(d, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 }).find((n) => n.key === "kdv")!.text, /katılmıyor/);
});

test("KDV hatırlatıcısının günü 6 haftanın dışındaysa: satır yok, tahmin de yok; Tahmine katılanlar bunu söyler", () => {
  const far = kdvRem({ dueDate: "2027-01-28", repeat: "none" });
  const p = withVat({ reminders: [far], vatAnchor: { month: "2026-08", amount: 0 } });
  assert.equal(p.vat!.mode, "reminder");
  assert.equal(p.vat!.rows.length, 0);
  assert.equal(lineAt(p, "kdv@").length, 0);
  assert.equal(p.unknownAmounts.length, 0);
  const row = p.estimates.find((e) => e.key === "kdv")!;
  assert.deepEqual([row.status, row.note], ["covered", "KDV hatırlatıcısının gününde · 6 hafta içinde ödeme günü yok"]);
});

test("hatırlatıcı sınıfı: sabit gider adı önce; SGK prim ödemesi SGK, muhtasar diğer; adı sabit gidere eşit KDV hatırlatıcısı sabit gider", () => {
  const fixed = [{ id: 7, name: "KDV danışmanlığı", period: "aylik" as const, amount: 1_000 }];
  const kdvFixed = rem({ title: "KDV danışmanlığı", kind: "odeme", amount: null, dueDate: "2026-11-10" });
  const muhtasar = rem({ title: "Muhtasar ve prim hizmet beyannamesi", kind: "vergi", amount: null, dueDate: "2026-10-26" });
  const p = withVat({ months: monthsWith(fixed), fixedNames: fixed, reminders: [kdvFixed, muhtasar], vatAnchor: { month: "2026-08", amount: 0 } });
  assert.deepEqual(
    lineAt(p, `reminder:${kdvFixed.id}@`).map((l) => [l.amount, l.kind]),
    [[1_000, "fixed"]],
  );
  assert.equal(p.vat!.mode, "default");
  assert.deepEqual(
    p.unknownAmounts.map((u) => u.reminderId),
    [muhtasar.id],
  );
});

// ---------------------------------------------------------------- Excel verisinden girdiler ve metinler

test("girdiler (Excel, bugün 2026-10-22): POS yedeği Ekim, 2 kişi, sabit giderler, KDV oranları", () => {
  const base = planInputFromModel(model, TODAY);
  assert.deepEqual(base.posMonth, { month: "2026-10", posRevenue: 293_909, openDays: 16 });
  const oct = base.months["2026-10"];
  assert.equal(oct.payroll.people, 2);
  assert.equal(oct.payroll.net, 60_000);
  close(oct.payroll.sgk, 23_117.647, "SGK", 0.01);
  assert.equal(oct.fixed.length, 16);
  assert.equal(oct.fixed.find((f) => f.name === "ModPOS / Patron aboneliği")!.period, "yillik");
  assert.ok(base.months["2026-12"] && base.months["2026-08"]);
  assert.equal(base.online, null);
  assert.equal(base.vat.firstSalesMonth, "2026-07");
  assert.equal(base.settings.kdv, 0.1);
  assert.equal(base.settings.kdvHizmet, 0.2);
  assert.equal(base.fixedNames.length, 16);
});

test("laffogato.net online dayanağı: süren ayda çekildiği günden bir eksiğe (Türkiye saatiyle), 7 günden azsa önceki aya, kapanmış ayda ayın gününe bölünür", () => {
  // Kafe, mağaza ve karaoke neti (TL)
  const site = (month: string, net: [number, number, number], pulledAt: string, closed: boolean): SiteSalesMonth => {
    const t = (v: number) => ({ orders: 1, grossMinor: v * 100, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: v * 100, kdvMinor: 0, unknownKdvNetMinor: v * 100 });
    return {
      month,
      pulledAt,
      now: pulledAt,
      from: `${month}-01`,
      to: `${month}-28`,
      closed,
      cafe: { ...t(net[0]), lines: [] },
      shop: t(net[1]),
      karaoke: { bookings: 1, collectedMinor: net[2] * 100, refundedMinor: 0, netMinor: net[2] * 100, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: net[2] * 100 },
      manual: { orders: 0, grossMinor: 0, netMinor: 0 },
    };
  };
  const onlineOf = (today: string, ...records: SiteSalesMonth[]) => planInputFromModel(createModel({ ...ds, siteSales: records }), today).online;
  const sep = site("2026-09", [30_000, 9_000, 6_000], "2026-10-02T05:00:00.000Z", true);
  // Süren ay 22 Ekim sabahı çekildi: kayıt 1–21 Ekim'i kapsar; bugün 25 Ekim olsa da 21 güne bölünür
  const oct = site("2026-10", [15_000, 4_000, 2_000], "2026-10-22T05:00:00.000Z", false);
  assert.deepEqual(onlineOf("2026-10-25", sep, oct), { month: "2026-10", perDay: 1_000 });
  // UTC'de 21 Ekim akşamı, Türkiye'de 22 Ekim: yine 21 gün
  assert.deepEqual(onlineOf("2026-10-25", sep, { ...oct, pulledAt: "2026-10-21T21:30:00.000Z" }), { month: "2026-10", perDay: 1_000 });
  // Kapanmış ay: ayın gün sayısıyla (45.000 ₺ ÷ 30)
  assert.deepEqual(onlineOf("2026-10-25", sep), { month: "2026-09", perDay: 1_500 });
  // 3 Kasım: süren ayın 2 günü yetmez, kapanmış Ekim 31 güne bölünür (31.000 ₺)
  const octClosed = site("2026-10", [20_000, 8_000, 3_000], "2026-11-02T05:00:00.000Z", true);
  const nov = site("2026-11", [3_000, 0, 0], "2026-11-03T05:00:00.000Z", false);
  assert.deepEqual(onlineOf("2026-11-03", sep, octClosed, nov), { month: "2026-10", perDay: 1_000 });
  assert.equal(onlineOf("2026-10-25"), null);
});

test("Nasıl hesaplandı: rakamlarıyla; yedek ve 'satış verisi yok' metinleri; KDV 'Dahil değil'de geçmez", () => {
  const base = planInputFromModel(model, TODAY);
  const g = goodsRows(ds.invoices, TODAY, () => 30);
  const p = buildCashPlan(input({ ...base, goods: g.rows, goodsSpanDays: g.spanDays, invoices: [invoice(1, "2026-09-13", 11_516.77, "Kaldi")] }));
  const notes = planNotes(p, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  const text = (k: string) => notes.find((n) => n.key === k)!.text;
  assert.equal(
    text("sales"),
    "Son 28 günde yeterli kasa raporu yok; Ekim 2026 POS cirosuna göre günde 18.369 ₺ (16 açık gün). Kartla ödenen %86 için %2,5 komisyon düşüldü; ayda 30 açık gün (Ayarlar). Tahmin yarından başlar: bugünkü satış elinizdeki paraya dahil sayılır.",
  );
  assert.equal(
    text("salary"),
    "2 kişinin net maaşı ve ek ödemeleri (ayda 60.000 ₺), her ayın 1'inde. Ödemeler'e tutarlı bir Maaş hatırlatıcısı eklerseniz onun günü ve tutarı geçerli olur.",
  );
  assert.match(text("goods"), /^Son 56 günün mal faturalarına göre haftada [\d.]+ ₺\./);
  assert.match(text("invoices"), /Gecikmiş 1 fatura bugüne yazıldı\./);
  assert.match(text("fixed"), /^Hatırlatıcısı olmayan 14 sabit gider/);
  assert.equal(text("excluded"), "Tutarı girilmemiş vergiler (muhtasar, geçici vergi vb.), Aylık harcamalar'daki fatura dışı ödemeler, yıllık giderler (ModPOS / Patron aboneliği), yatırım ve kredi.");
  assert.doesNotMatch(text("excluded"), /KDV/);
  assert.match(text("kdv"), /ayın 28'inde/);
  const reports = Array.from({ length: 8 }, (_, i) => ({ date: addDays(TODAY, -1 - i), zTotal: 9_850, card: 7_683, mealCard: 0 }));
  const kasa = planNotes(buildCashPlan(input({ cashReports: reports })), { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.match(kasa.find((n) => n.key === "sales")!.text, /^Son 28 günün 8 kasa raporuna göre günde ortalama 9\.850 ₺ \(Z toplamı\)\. Kartla ödenen %78 için %2,5 komisyon düşüldü/);
  // İki "online" ayrı adla: Z raporundaki platformlar (Yemeksepeti, Getir…) ile kasadan geçmeyen laffogato.net
  const platform = buildCashPlan(input({ cashReports: reports.map((r) => ({ ...r, online: 985 })), online: { month: "2026-09", perDay: 420 } }));
  assert.equal(platform.basis.sales.kind === "kasa" ? platform.basis.sales.platformShare : null, 0.1);
  const pn = planNotes(platform, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.match(pn.find((n) => n.key === "sales")!.text, /\(Z toplamı; Z'deki online platform ödemeleri \(Yemeksepeti, Getir…\) %10, aynı gün ve kesintisiz sayıldı\)\./);
  assert.match(pn.find((n) => n.key === "online")!.text, /^laffogato\.net Eylül 2026 online satışına göre günde 420\s₺ \(iadeler düşülmüş\)\. Kasadan geçmez, Z raporundaki online platformlardan ayrıdır\./);
  const none = planNotes(buildCashPlan(input()), { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.equal(none.find((n) => n.key === "sales")!.text, "Satış verisi yok: gelen para sayılmadı. Kasa raporu girildikçe tahmin oluşur.");
  assert.equal(none.find((n) => n.key === "goods")!.text, "Mal alımı tahmini için en az 2 haftalık fatura gerekir.");
  // KDV hatırlatıcısı varken
  const rn = planNotes(withVat({ reminders: [kdvRem()] }), { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.match(rn.find((n) => n.key === "kdv")!.text, /KDV hatırlatıcısının gününde/);
});

// ---------------------------------------------------------------- Ekran kuralları

test("ekran: yalnız yönetici; menüde (⌘K) Para grubunda, telefonda başlığı 'Nakit planı'; Genel bakış kartı hata atmaz", () => {
  assert.equal(canOpen("staff", "/panel/hatirlaticilar/nakit"), false);
  assert.equal(canOpen("admin", "/panel/hatirlaticilar/nakit"), true);
  assert.equal(mobileTitleFor("/panel/hatirlaticilar/nakit"), "Nakit planı");
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/panel/hatirlaticilar/nakit");
  assert.ok(item);
  assert.deepEqual(item.roles, ["admin"]);
  const page = read("src/app/panel/hatirlaticilar/nakit/page.tsx");
  assert.match(page, /await requireAdmin\(\)/);
  const actions = read("src/server/actions/cash-plan.ts");
  for (const fn of ["saveCashBalance", "saveCashPlanExcluded", "saveVatCarry"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /const me = await requireAdmin\(\);/, fn);
  }
  const dash = read("src/app/panel/page.tsx");
  assert.match(dash, /loadCashPlan\(model, upcoming\)\.catch\(\(\) => null\)/);
  // db:reset nakit planının durumunu siler (sabit gider kimlikleri baştan sayar)
  assert.match(read("scripts/seed.ts"), /'cashflow\.plan'/);
});
