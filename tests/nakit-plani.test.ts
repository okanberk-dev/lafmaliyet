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
  EXCLUDABLE_KEY,
  fixedReminderDrifts,
  goodsRows,
  lineLabel,
  parseCashPlanState,
  PLAN_DAYS,
  planInputFromModel,
  planNotes,
  rangeText,
  reminderOccurrences,
  STAMP_INCLUDED,
  weekTitle,
  type CashPlan,
  type CashPlanInput,
  type PlanLine,
} from "../src/lib/cash-plan";
import { createModel, shiftMonth, type Model } from "../src/lib/calc/engine";
import type { TaxFiling } from "../src/lib/tax/corporate";
import { muhtasarItemsFromModel, type MuhtasarItem } from "../src/lib/tax/muhtasar";
import { taxPnlInputFromModel } from "../src/lib/tax/pnl";
import { paidFixedRates, r2 } from "../src/lib/tax/rules";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { buildTaxView, type TaxPlanFeed } from "../src/lib/tax/view";
import { addVatPaid, forgetVatPeriod, paidPeriodsOf, parseVatPaid, removeVatPaid, type VatPaidEntry } from "../src/lib/vat-paid";
import type { Dataset } from "../src/lib/calc/types";
import { vatForgetText, vatMonthInputs } from "../src/lib/kdv";
import {
  addDays,
  daysBetween,
  FIXED_REMINDER_NOTE,
  fixedReminderAt,
  nextOccurrence,
  postponeNote,
  postponePlan,
  UPCOMING_HORIZON_DAYS,
  vatAmountTravels,
  type ReminderRow,
  type UpcomingItem,
} from "../src/lib/reminders";
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

test("satışlar: iki şubenin aynı günkü raporu tek gün, günlük satış ikisinin toplamı (HM-05); ödenmez Z'nin içindeyse girmez (HM-08)", () => {
  const days = Array.from({ length: 10 }, (_, i) => addDays(TODAY, -1 - i));
  // Tuzla 10.000, Marina 6.000: 20 rapor, 10 gün
  const reports = days.flatMap((date) => [
    { date, zTotal: 10_000, card: 6_000, mealCard: 0 },
    { date, zTotal: 6_000, card: 3_600, mealCard: 0 },
  ]);
  const p = buildCashPlan(input({ cashReports: reports }));
  assert.deepEqual(p.basis.sales, { kind: "kasa", reports: 10, daily: 16_000, cardShare: 0.6, platformShare: 0 });
  // En az 7 raporlu gün gerekir: iki şubenin 6 günü (12 rapor) yetmez
  assert.deepEqual(buildCashPlan(input({ cashReports: reports.slice(0, 12) })).basis.sales, { kind: "none" });
  // Z 10.000, ödemeler 9.500, ödenmez 500: ödenmez Z'nin içinde, günün cirosu 9.500 (Genel bakış ve Kasa'daki gibi)
  const off = buildCashPlan(input({ cashReports: days.map((date) => ({ date, zTotal: 10_000, card: 6_000, mealCard: 0, offRevenue: 500, payments: 9_500 })) }));
  assert.equal(off.basis.sales.kind === "kasa" ? off.basis.sales.daily : null, 9_500);
  // Ödemeler Z'yi tutuyorsa ödenmez zaten dışarıda: Z olduğu gibi
  const out = buildCashPlan(input({ cashReports: days.map((date) => ({ date, zTotal: 10_000, card: 6_000, mealCard: 0, offRevenue: 500, payments: 10_000 })) }));
  assert.equal(out.basis.sales.kind === "kasa" ? out.basis.sales.daily : null, 10_000);
  // Yükleyici ödenmezi ve ödeme dökümünü de verir
  const loader = read("src/server/data/cash-plan.ts");
  assert.match(loader, /offRevenue: r\.offRevenue,\n\s+payments: Math\.round\(\(r\.cash \+ r\.card \+ r\.mealCard \+ r\.online \+ r\.other\) \* 100\) \/ 100,/);
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
  assert.deepEqual(p.unknownAmounts, [{ key: `reminder:${muhtasar.id}`, reminderId: muhtasar.id, title: muhtasar.title, date: "2026-10-26" }]);
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

test("sabit giderler KDV dahil ödenir: kiranın %20'si de çıkar, personel KDV'siz; hatırlatıcının taşıdığı tutar da", () => {
  const fixed = [
    { id: 1, name: "Kira", period: "aylik" as const, amount: 31_000, vatRate: 0.2 },
    { id: 2, name: "Personel yemeği", period: "gunluk" as const, amount: 300, vatRate: 0 },
    { id: 3, name: "Spotify", period: "aylik" as const, amount: 3_100, vatRate: 0.2 },
  ];
  const settings = { komisyon: 0.025, kartOrani: 0.8, acikGun: 30, kdv: 0.1, kdvHizmet: 0.2 };
  const p = buildCashPlan(input({ months: monthsWith(fixed), fixedNames: fixed, settings }));
  // Ekim 31 gün: kira 31.000 × 1,2 ÷ 31 = 1.200, Spotify 120, yemek 300 (KDV'siz)
  close(p.weeks[0].lines.find((l) => l.key === "fixed")!.amount, 6 * (1_200 + 120 + 300), "bu hafta (gün 1–6)");
  assert.match(p.weeks[0].lines.find((l) => l.key === "fixed")!.detail!, /^Ay içine yayıldı \(faturadaki KDV dahil\): Kira 7\.200\s₺/);
  close(p.basis.fixedSpread.monthly, 37_200 + 3_720 + 9_000, "ayda KDV dahil");
  assert.equal(p.basis.fixedSpread.vat, true);
  assert.equal(p.estimates.find((e) => e.key === "fixed:1")!.monthly, 37_200);
  assert.match(p.estimates.find((e) => e.key === "fixed:1")!.note!, /%20 KDV dahil$/);
  assert.doesNotMatch(p.estimates.find((e) => e.key === "fixed:2")!.note!, /KDV/);
  const notes = planNotes(p, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.match(notes.find((n) => n.key === "fixed")!.text, /ayda 49\.920\s₺, faturadaki KDV dahil\) ay içine eşit yayıldı/);
  // Tutarsız "Kira" hatırlatıcısı giderin KDV dahil tutarını taşır
  const kira = rem({ title: "Kira", amount: null, dueDate: "2026-11-01" });
  const carried = buildCashPlan(input({ months: monthsWith(fixed), fixedNames: fixed, settings, reminders: [kira] }));
  const line = lineAt(carried, `reminder:${kira.id}@`)[0];
  assert.deepEqual([line.date, line.amount, line.estimated], ["2026-11-01", 37_200, true]);
  assert.equal(line.detail, "Sabit giderdeki tutar + %20 KDV");
  // "Sabit giderlerden ekle" aynı tutarı yazar (fixedReminderAt): tutarlı hatırlatıcı planın ödediğini kesin taşır
  const added = rem({ title: "Kira", amount: fixedReminderAt({ amount: 31_000, period: "aylik", section: "kira" }, [], "2026-11").amount, dueDate: "2026-11-01" });
  const certain = lineAt(buildCashPlan(input({ months: monthsWith(fixed), fixedNames: fixed, settings, reminders: [added] })), `reminder:${added.id}@`)[0];
  assert.deepEqual([certain.date, certain.amount, certain.estimated], ["2026-11-01", line.amount, false]);
  // Tutarsız hatırlatıcıya o ayın sürümü hatırlatıcının dönemine çevrilerek gelir: Aralık'tan yıllığa geçen
  // "Yazılım"ın (aylık 10.000 → yıllık 120.000) aylık hatırlatıcısı Aralık'ta da 12.000 (yıllığın on ikide biri, KDV
  // dahil), 144.000 değil
  const sw = (period: "aylik" | "yillik", amount: number) => [{ id: 7, name: "Yazılım", period, amount, vatRate: 0.2 }];
  const swMonths = { ...monthsWith(sw("aylik", 10_000)), "2026-12": { payroll: PAYROLL, fixed: sw("yillik", 120_000) } };
  const swRem = rem({ title: "Yazılım", amount: null, dueDate: "2026-11-01" });
  const swPlan = buildCashPlan(input({ months: swMonths, fixedNames: sw("aylik", 10_000), settings, reminders: [swRem] }));
  assert.deepEqual(
    lineAt(swPlan, `reminder:${swRem.id}@`).map((l) => [l.date, l.amount, l.detail]),
    [
      ["2026-11-01", 12_000, "Sabit giderdeki tutar + %20 KDV"],
      ["2026-12-01", 12_000, "Sabit giderdeki tutar, hatırlatıcının dönemine çevrildi + %20 KDV"],
    ],
  );
  // Haftalık hatırlatıcıya aylık gider: haftalık karşılığı (aylık × 12 / 52)
  const weekly = rem({ title: "Yazılım", amount: null, dueDate: "2026-10-26", repeat: "weekly", anchorDate: "2026-10-26" });
  close(lineAt(buildCashPlan(input({ months: monthsWith(sw("aylik", 10_000)), fixedNames: sw("aylik", 10_000), settings, reminders: [weekly] })), `reminder:${weekly.id}@`)[0].amount, (12_000 * 12) / 52, "haftalık karşılığı");
  // KDV'siz kalemler eskisi gibi: açıklama "KDV dahil" demez
  const plain = buildCashPlan(input({ months: monthsWith([fixed[1]]), fixedNames: [fixed[1]], settings }));
  assert.match(plain.weeks[0].lines.find((l) => l.key === "fixed")!.detail!, /^Ay içine yayıldı: /);
});

test("girdiler: sabit giderin KDV'si kalemden, boşsa bölümden (kira, faturalar, genel %20; personel KDV'siz)", () => {
  const base = planInputFromModel(model, TODAY);
  const rate = (name: string) => base.months["2026-10"].fixed.find((f) => f.name === name)!.vatRate;
  assert.equal(rate("Kira"), 0.2);
  assert.equal(rate("Elektrik (ana fatura)"), 0.2);
  assert.equal(rate("Instagram reklamı"), 0.2);
  assert.equal(rate("Personel yemeği"), 0);
  assert.equal(rate("Muhasebeci"), 0);
  // Kalemde girilen oran bölümün varsayılanının önüne geçer
  const withRate = createModel({ ...ds, fixedExpenses: ds.fixedExpenses.map((f) => (f.name === "Influencer" ? { ...f, vatRate: 0 } : f.name === "Muhasebeci" ? { ...f, vatRate: 0.2 } : f)) });
  const fixed = planInputFromModel(withRate, TODAY).months["2026-10"].fixed;
  assert.equal(fixed.find((f) => f.name === "Influencer")!.vatRate, 0);
  assert.equal(fixed.find((f) => f.name === "Muhasebeci")!.vatRate, 0.2);
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

test("KDV-2 (tevkifat): Eylül'ün tevkifatı 25 Ekim'de, devreden olsa da; KDV-2 hatırlatıcısı varsa ya da KDV kapalıysa plana girmez", () => {
  // Eylül 2026: reklam faturası 30.000 + 6.000 KDV, 3/10 tevkifat 1.800 (KDV2 tahakkuku); Paraşüt'ten vat 6.000
  const tevkifat = createModel({ ...ds, invoices: ds.invoices.map((i) => (i.date === "2026-09-17" && i.amount === 30_000 ? { ...i, vat: 6_000 } : i)) });
  const v = vatMonthInputs(tevkifat, TODAY);
  // Eylül beyannamesinde devreden 121.204,69: 1 No.lu ödeme yok, 2 No.lu 1.800 yine ödenir
  const p = buildCashPlan(input({ vat: v, vatAnchor: { month: "2026-09", amount: 121_204.69 } }));
  assert.deepEqual(
    lineAt(p, "kdv2@").map((l) => [l.date, l.title, l.amount, l.estimated, l.href]),
    [["2026-10-25", "KDV-2 (Eylül)", 1_800, true, "#kdv"]],
  );
  assert.equal(lineAt(p, "kdv@").length, 0);
  assert.deepEqual(p.vat!.vat2, [{ key: "kdv2@2026-10-25", period: "2026-09", date: "2026-10-25", amount: 1_800, covered: false }]);
  // 25 Ekim bugünse yazılmaz (bugünkü ödeme elinizdeki paradan)
  assert.equal(lineAt(buildCashPlan(input({ today: "2026-10-25", vat: vatMonthInputs(tevkifat, "2026-10-25") })), "kdv2@").length, 0);
  // KDV tahmini kapalı: kartta görünür, plana girmez
  const off = buildCashPlan(input({ vat: v, excluded: ["kdv"] }));
  assert.equal(lineAt(off, "kdv2@").length, 0);
  assert.equal(off.vat!.vat2.length, 1);
  // Ödemeler'de KDV-2 hatırlatıcısı: plana o girer, tahmin yazılmaz; 1 No.lu KDV hatırlatıcısı sayılmaz
  const r = rem({ title: "KDV2 tevkifat", kind: "vergi", amount: 1_800, dueDate: "2026-10-25", repeat: "none" });
  const covered = buildCashPlan(input({ vat: v, reminders: [r] }));
  assert.equal(lineAt(covered, "kdv2@").length, 0);
  assert.equal(covered.vat!.vat2[0].covered, true);
  assert.deepEqual(
    lineAt(covered, `reminder:${r.id}@`).map((l) => [l.date, l.amount]),
    [["2026-10-25", 1_800]],
  );
  assert.equal(covered.vat!.baseMode, "default");
  // Tevkifatsız veride (Excel) KDV-2 satırı yok
  assert.equal(buildCashPlan(input({ vat })).vat!.vat2.length, 0);
});

test("KDV-2 hatırlatıcısı yalnız kendi dönemini karşılar; tutarsızsa tahmin onun gününde girer, muhtasar karşılamaz", () => {
  // Eylül (25 Ekim) ve Ekim (25 Kasım) faturalarında 1.800'er ₺ tevkifat
  const sepBill = ds.invoices.find((i) => i.date === "2026-09-17" && i.amount === 30_000)!;
  const twoMonths = createModel({
    ...ds,
    invoices: [...ds.invoices.map((i) => (i === sepBill ? { ...i, vat: 6_000 } : i)), { ...sepBill, id: 990_001, date: "2026-10-10", vat: 6_000 }],
  });
  const v = vatMonthInputs(twoMonths, TODAY);
  const base = { vat: v, vatAnchor: { month: "2026-09", amount: 121_204.69 } };
  // Tutarsız aylık hatırlatıcı: plana iki dönemin tahmini hatırlatıcının günlerinde girer, tutarı bilinmeyen sayılmaz
  const amountless = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-10-25" });
  const a = buildCashPlan(input({ ...base, reminders: [amountless] }));
  assert.deepEqual(
    lineAt(a, `reminder:${amountless.id}@`).map((l) => [l.date, l.title, l.amount, l.estimated, l.kind]),
    [
      ["2026-10-25", "KDV2 beyannamesi (Eylül)", 1_800, true, "kdv"],
      ["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800, true, "kdv"],
    ],
  );
  assert.equal(lineAt(a, "kdv2@").length, 0);
  assert.deepEqual(
    a.vat!.vat2.map((r) => [r.date, r.covered]),
    [
      ["2026-10-25", true],
      ["2026-11-25", true],
    ],
  );
  assert.equal(a.unknownAmounts.length, 0);
  // KDV tahmini kapalıyken tutarsız hatırlatıcı tutarı girilmemiş ödemedir (ilk günüyle)
  assert.deepEqual(
    buildCashPlan(input({ ...base, reminders: [amountless], excluded: ["kdv"] })).unknownAmounts.map((u) => [u.reminderId, u.date]),
    [[amountless.id, "2026-10-25"]],
  );
  // Tek seferlik Eylül hatırlatıcısı Ekim'in KDV-2'sini kapatmaz
  const once = rem({ title: "KDV2 Eylül", kind: "vergi", amount: 1_800, dueDate: "2026-10-25", repeat: "none" });
  const o = buildCashPlan(input({ ...base, reminders: [once] }));
  assert.deepEqual(
    lineAt(o, `reminder:${once.id}@`).map((l) => [l.date, l.amount]),
    [["2026-10-25", 1_800]],
  );
  assert.deepEqual(
    lineAt(o, "kdv2@").map((l) => [l.date, l.title, l.amount]),
    [["2026-11-25", "KDV-2 (Ekim)", 1_800]],
  );
  assert.deepEqual(
    o.vat!.vat2.map((r) => [r.date, r.covered]),
    [
      ["2026-10-25", true],
      ["2026-11-25", false],
    ],
  );
  // Gelir vergisi tevkifatı (muhtasar) KDV-2 değildir: tahminler yerinde, hatırlatıcı kendi satırıyla
  const muhtasar = rem({ title: "Muhtasar (gelir vergisi tevkifatı)", kind: "vergi", amount: 4_000, dueDate: "2026-10-26" });
  const m = buildCashPlan(input({ ...base, reminders: [muhtasar] }));
  assert.deepEqual(
    lineAt(m, "kdv2@").map((l) => l.date),
    ["2026-10-25", "2026-11-25"],
  );
  assert.equal(lineAt(m, `reminder:${muhtasar.id}@`)[0].amount, 4_000);
});

test("KDV-2: Ödendi denen dönemin tahmini geri gelmez; aynı döneme ikinci hatırlatıcı tutarı girilmemiş ödemedir", () => {
  const sepBill = ds.invoices.find((i) => i.date === "2026-09-17" && i.amount === 30_000)!;
  const v = vatMonthInputs(
    createModel({
      ...ds,
      invoices: [...ds.invoices.map((i) => (i === sepBill ? { ...i, vat: 6_000 } : i)), { ...sepBill, id: 990_002, date: "2026-10-10", vat: 6_000 }],
    }),
    TODAY,
  );
  const base = { vat: v, vatAnchor: { month: "2026-09", amount: 121_204.69 } };
  const kdv2Lines = (p: CashPlan) =>
    lines(p)
      .filter((l) => l.kind === "kdv" || l.key.startsWith("reminder:"))
      .map((l) => [l.date, l.title, l.amount]);
  const plan = (reminders: ReminderRow[], paidReminders: CashPlanInput["paidReminders"] = []) => buildCashPlan(input({ ...base, reminders, paidReminders }));
  // 22 Ekim'de Eylül'ün KDV-2'si ödendi: aylık seri 25 Kasım'a geçti, Ödemeler'in son ödenenlerinde 25 Ekim → 25 Kasım
  const paid = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-11-25", anchorDate: "2026-10-25" });
  const p = plan([paid], [{ id: paid.id, dueDate: "2026-10-25", next: "2026-11-25" }]);
  assert.deepEqual(kdv2Lines(p), [["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800]]);
  assert.deepEqual(
    p.vat!.vat2.map((r) => [r.date, r.covered]),
    [["2026-11-25", true]],
  );
  // "Geri al" kaydı siler: Eylül yeniden beklenir
  assert.deepEqual(kdv2Lines(plan([{ ...paid, dueDate: "2026-10-25" }])), [
    ["2026-10-25", "KDV2 beyannamesi (Eylül)", 1_800],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800],
  ]);
  // Ödendi'den sonra Ekim'in tutarı yazılan seri de: ödenen Eylül geri gelmez, Ekim'e yazılı tutar
  const paidAmount = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: 2_591, dueDate: "2026-11-25" });
  assert.deepEqual(kdv2Lines(plan([paidAmount], [{ id: paidAmount.id, dueDate: "2026-10-25", next: "2026-11-25" }])), [["2026-11-25", "KDV2 beyannamesi", 2_591]]);
  // Tek seferlik hatırlatıcı Ödendi ile kapanır (pasif): dönemi yine ödenmiştir
  const once = rem({ title: "KDV2 Eylül", kind: "vergi", amount: 2_591, dueDate: "2026-10-25", repeat: "none", active: false });
  const o = plan([once], [{ id: once.id, dueDate: "2026-10-25", next: null }]);
  assert.deepEqual(kdv2Lines(o), [["2026-11-25", "KDV-2 (Ekim)", 1_800]]);
  assert.deepEqual(
    o.vat!.vat2.map((r) => r.period),
    ["2026-10"],
  );
  // Ödendikten sonra kapatılan seri: ödeme yine sayılır
  const closed = { ...paid, active: false };
  assert.deepEqual(kdv2Lines(plan([closed], [{ id: closed.id, dueDate: "2026-10-25", next: "2026-11-25" }])), [["2026-11-25", "KDV-2 (Ekim)", 1_800]]);
  // Üç aylık seri yalnız ödediği dönemi kapatır, aradaki ayları değil
  const quarterly = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2027-01-25", repeat: "quarterly", anchorDate: "2026-10-25" });
  assert.deepEqual(kdv2Lines(plan([quarterly], [{ id: quarterly.id, dueDate: "2026-10-25", next: "2027-01-25" }])), [["2026-11-25", "KDV-2 (Ekim)", 1_800]]);
  // "Tarihe kadar ödendi": Eylül ve Ekim birden kapanır
  const through = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-12-25", anchorDate: "2026-10-25" });
  const t = plan([through], [{ id: through.id, dueDate: "2026-10-25", next: "2026-12-25" }]);
  assert.deepEqual(kdv2Lines(t), []);
  assert.deepEqual(t.vat!.vat2, []);
  // Tarihi elle ileri alınmış seri ödenmiş sayılmaz (son ödenenlerde değil): Eylül'ün tahmini yerinde
  const moved = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-11-25" });
  assert.deepEqual(kdv2Lines(plan([moved])), [
    ["2026-10-25", "KDV-2 (Eylül)", 1_800],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800],
  ]);
  // Kartın "kaydını kaldır"ı da buraya döndürür (onay metni: "KDV kartı 'kaydını kaldır'" testi)
  // Geç Ödendi'den (Ağustos, 3 Ekim) sonra Eylül ertelendi: kopya 1 Kasım'da Eylül'ü taşır, seri 25 Kasım'da Ekim'i;
  // erteleme ödeme değildir
  const copy = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-11-01", repeat: "none", note: "Ertelendi · asıl tarih 25.10.2026" });
  const series = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-11-25" });
  const c = plan([copy, series], [{ id: series.id, dueDate: "2026-09-25", next: "2026-10-25" }]);
  assert.deepEqual(kdv2Lines(c), [
    ["2026-11-01", "KDV2 beyannamesi (Eylül)", 1_800],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800],
  ]);
  assert.equal(c.unknownAmounts.length, 0);
  // İki kez ertelenen Eylül kopyası 8 Kasım'da: yine Eylül'ündür (asıl gününden), serinin Ekim'i yerinde
  const copy8 = { ...copy, dueDate: "2026-11-08", anchorDate: "2026-11-08" };
  assert.deepEqual(kdv2Lines(plan([copy8, series])), [
    ["2026-11-08", "KDV2 beyannamesi (Eylül)", 1_800],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800],
  ]);
  // Kopya 8 Kasım'da ödendi: Eylül kapanır, Ekim'in KDV-2'si düşmez
  const paidCopy = { ...copy8, active: false };
  assert.deepEqual(kdv2Lines(plan([paidCopy, series], [{ id: paidCopy.id, dueDate: "2026-11-08", next: null }])), [["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800]]);
  // Tutarsız seri ve aynı güne tutarlı tek seferlik (tahakkuk 1.800 + damga 791): Eylül 2.591, serinin o günü
  // tutarı girilmemiş ödeme (iki kez sayılmaz, sessizce de düşmez)
  const daily = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-10-25" });
  const oneOff = rem({ title: "KDV2 Eylül", kind: "vergi", amount: 2_591, dueDate: "2026-10-25", repeat: "none" });
  const two = plan([daily, oneOff]);
  assert.deepEqual(kdv2Lines(two), [
    ["2026-10-25", "KDV2 Eylül", 2_591],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800],
  ]);
  assert.deepEqual(
    two.unknownAmounts.map((u) => [u.reminderId, u.date]),
    [[daily.id, "2026-10-25"]],
  );
  // İki tutarsız seri: dönemin tahmini bir kez, ikincisi tutarı girilmemiş ödeme
  const twin = rem({ title: "2 No.lu KDV", kind: "vergi", amount: null, dueDate: "2026-10-25" });
  const twins = plan([daily, twin]);
  assert.deepEqual(
    lines(twins)
      .filter((l) => l.kind === "kdv")
      .map((l) => [l.date, l.amount]),
    [
      ["2026-10-25", 1_800],
      ["2026-11-25", 1_800],
    ],
  );
  assert.deepEqual(
    twins.unknownAmounts.map((u) => [u.reminderId, u.date]),
    [[twin.id, "2026-10-25"]],
  );
  // "2 No.lu beyanname" (panelin kendi sözü) KDV-2'dir; damga vergisi ayrı ödemedir, KDV-2 tahminini kapatmaz
  const words = rem({ title: "2 No.lu beyanname", kind: "vergi", amount: 2_591, dueDate: "2026-10-25", repeat: "none" });
  assert.equal(lineAt(plan([words]), "kdv2@2026-10-25").length, 0);
  // Ertelenen tek seferlik (kopya değil) de asıl gününün dönemindedir: 9 Kasım'daki Eylül KDV-2'si Ekim'i almaz
  const moved1 = rem({ title: "KDV2 Eylül", kind: "vergi", amount: 2_591, dueDate: "2026-11-09", repeat: "none", note: postponeNote(null, "2026-10-25") });
  const m1 = plan([moved1]);
  assert.deepEqual(kdv2Lines(m1), [
    ["2026-11-09", "KDV2 Eylül", 2_591],
    ["2026-11-25", "KDV-2 (Ekim)", 1_800],
  ]);
  // ödenince Eylül kapanır, Ekim değil
  assert.deepEqual(kdv2Lines(plan([{ ...moved1, active: false }], [{ id: moved1.id, dueDate: "2026-11-09", next: null }])), [["2026-11-25", "KDV-2 (Ekim)", 1_800]]);
  // Yanlışlıkla Ödendi denip tarihi geri alınan seri ve yeniden açılan tek seferlik: dönem yine beklenir
  const reopened = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-10-25" });
  assert.deepEqual(kdv2Lines(plan([reopened], [{ id: reopened.id, dueDate: "2026-10-25", next: "2026-11-25" }])), [
    ["2026-10-25", "KDV2 beyannamesi (Eylül)", 1_800],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 1_800],
  ]);
  assert.deepEqual(kdv2Lines(plan([{ ...once, active: true }], [{ id: once.id, dueDate: "2026-10-25", next: null }])), [
    ["2026-10-25", "KDV2 Eylül", 2_591],
    ["2026-11-25", "KDV-2 (Ekim)", 1_800],
  ]);
  // Tahakkukla birlikte yazılan damga ("KDV2 + damga vergisi" 2.591) KDV-2'dir: tahmin ikinci kez yazılmaz
  const bundled = rem({ title: "KDV2 + damga vergisi", kind: "vergi", amount: 2_591, dueDate: "2026-10-25", repeat: "none" });
  assert.deepEqual(kdv2Lines(plan([bundled])), [
    ["2026-10-25", "KDV2 + damga vergisi", 2_591],
    ["2026-11-25", "KDV-2 (Ekim)", 1_800],
  ]);
  const stamp = rem({ title: "KDV2 damga vergisi", kind: "vergi", amount: 791, dueDate: "2026-10-25", repeat: "none" });
  assert.deepEqual(
    lines(plan([daily, stamp]))
      .filter((l) => l.date === "2026-10-25" && (l.kind === "kdv" || l.key.startsWith("reminder:")))
      .map((l) => [l.title, l.amount])
      .sort(),
    [
      ["KDV2 beyannamesi (Eylül)", 1_800],
      ["KDV2 damga vergisi", 791],
    ],
  );
});

test("KDV-2 serisinin yazılı tutarı yalnız kayıtlı dönemine aittir: sonraki dönem tahminle; Ödendi ve erteleme tutarı seriden siler", () => {
  // Eylül'ün tevkifatı 1.800 (tahakkuk fişi 2.591: 1.800 + 791 damga), Ekim'inki 3.000 (50.000 + 10.000 KDV, 3/10)
  const sepBill = ds.invoices.find((i) => i.date === "2026-09-17" && i.amount === 30_000)!;
  const octBill = { ...sepBill, id: 990_003, date: "2026-10-10", amount: 50_000, discount: 0, payable: 57_000, vat: 10_000 };
  const data = createModel({ ...ds, invoices: [...ds.invoices.map((i) => (i === sepBill ? { ...i, vat: 6_000 } : i)), octBill] });
  const base = { vat: vatMonthInputs(data, TODAY), vatAnchor: { month: "2026-09", amount: 121_204.69 } };
  const kdv2Lines = (p: CashPlan) =>
    lines(p)
      .filter((l) => l.kind === "kdv" || l.key.startsWith("reminder:"))
      .map((l) => [l.date, l.title, l.amount, l.estimated]);
  const plan = (reminders: ReminderRow[], over: Partial<CashPlanInput> = {}) => buildCashPlan(input({ ...base, reminders, ...over }));
  // Eylül'ün tutarı yazılı aylık seri: 25 Ekim'de kesin 2.591; 25 Kasım'a Eylül'ün tutarı değil Ekim'in tahmini
  const series = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: 2_591, dueDate: "2026-10-25" });
  const p = plan([series]);
  assert.deepEqual(kdv2Lines(p), [
    ["2026-10-25", "KDV2 beyannamesi", 2_591, false],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 3_000, true],
  ]);
  assert.deepEqual(
    p.vat!.vat2.map((r) => [r.period, r.amount, r.covered]),
    [
      ["2026-09", 1_800, true],
      ["2026-10", 3_000, true],
    ],
  );
  // Geciken dönem (26 Ekim, Ödendi denmedi): tutar bugüne, Ekim yine tahminle
  assert.deepEqual(kdv2Lines(plan([series], { today: "2026-10-26", vat: vatMonthInputs(data, "2026-10-26") })), [
    ["2026-10-26", "KDV2 beyannamesi", 2_591, false],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 3_000, true],
  ]);
  // KDV tahmine katılmıyorsa Eylül'ün tutarı yine kesin, Ekim tutarı girilmemiş ödemedir
  const off = plan([series], { excluded: ["kdv"] });
  assert.deepEqual(kdv2Lines(off), [["2026-10-25", "KDV2 beyannamesi", 2_591, false]]);
  assert.deepEqual(
    off.unknownAmounts.map((u) => [u.reminderId, u.date]),
    [[series.id, "2026-11-25"]],
  );
  // Ödendi (markReminderDone): seri 25 Kasım'a tutarsız geçer; Ekim tahminle, tevkifatsız Ekim'de satır yok
  const next = nextOccurrence(series.dueDate, series.repeat, series.anchorDate)!;
  const paid = { ...series, dueDate: next, ...(vatAmountTravels(series) ? { amount: null } : {}) };
  const record = [{ id: series.id, dueDate: series.dueDate, next }];
  assert.deepEqual(kdv2Lines(plan([paid], { paidReminders: record })), [["2026-11-25", "KDV2 beyannamesi (Ekim)", 3_000, true]]);
  const noOct = vatMonthInputs(createModel({ ...ds, invoices: ds.invoices.map((i) => (i === sepBill ? { ...i, vat: 6_000 } : i)) }), TODAY);
  const quiet = plan([paid], { paidReminders: record, vat: noOct });
  assert.deepEqual(kdv2Lines(quiet), []);
  assert.equal(quiet.unknownAmounts.length, 0);
  // 1 hafta ertelendi (postponeReminder): tutar Eylül'ü taşıyan kopyada (1 Kasım), seriden silinir; iki kez 2.591 değil
  const pp = postponePlan({ dueDate: series.dueDate, repeat: series.repeat, anchorDate: series.anchorDate }, "week", TODAY);
  const copy = rem({ title: series.title, kind: series.kind, amount: series.amount, dueDate: pp.target, repeat: "none", note: postponeNote(null, series.dueDate) });
  const rest = { ...series, dueDate: pp.next!, ...(vatAmountTravels(series) ? { amount: null } : {}) };
  assert.deepEqual(kdv2Lines(plan([copy, rest])), [
    ["2026-11-01", "KDV2 beyannamesi", 2_591, false],
    ["2026-11-25", "KDV2 beyannamesi (Ekim)", 3_000, true],
  ]);
});

test("KDV: 8'inden sonraya ertelenen dönem asıl gününün dönemindedir (kopya ve tek seferlik)", () => {
  // 3 Kasım: Eylül'ün 28 Ekim KDV'si gecikmiş, bugünden 1 hafta ertelendi: kopya 10 Kasım, seri 28 Kasım'da sürer
  const today = "2026-11-03";
  const v = vatMonthInputs(model, today);
  const base = { today, vat: v, vatAnchor: { month: "2026-08", amount: 0 } };
  const copy = rem({ title: "KDV beyannamesi ve ödemesi", kind: "vergi", amount: null, dueDate: "2026-11-10", repeat: "none", note: postponeNote(null, "2026-10-28") });
  const series = rem({ title: "KDV beyannamesi ve ödemesi", kind: "vergi", amount: null, dueDate: "2026-11-28" });
  const p = buildCashPlan(input({ ...base, reminders: [copy, series] }));
  assert.deepEqual(
    p.vat!.rows.map((r) => [r.date, r.period, r.reminderId]),
    [
      ["2026-11-10", "2026-09", copy.id],
      ["2026-11-28", "2026-10", series.id],
    ],
  );
  assert.equal(p.unknownAmounts.length, 0);
  // Tek seferlik "KDV Eylül" 1 ay ertelendi (28 Kasım): yine Eylül'ün
  const once = rem({ title: "KDV Eylül", kind: "vergi", amount: null, dueDate: "2026-11-28", repeat: "none", note: postponeNote(null, "2026-10-28") });
  assert.deepEqual(
    buildCashPlan(input({ ...base, today: "2026-10-22", vat: vatMonthInputs(model, "2026-10-22"), reminders: [once] })).vat!.rows.map((r) => [r.date, r.period]),
    [["2026-11-28", "2026-09"]],
  );
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

test("KDV: Ödendi denen dönem tahmin olarak geri gelmez; ödenen tutar sonraki ayın devredenini sıfırlamaya devam eder", () => {
  const anchor = { month: "2026-08", amount: 0 };
  const kdvLines = (p: CashPlan) =>
    lines(p)
      .filter((l) => l.kind === "kdv" || l.key.startsWith("reminder:"))
      .map((l) => [l.date, l.title, l.amount]);
  // Tek seferlik "KDV Eylül" 28 Ekim'den önce ödendi (Ödendi onu kapatır): Eylül 28 Ekim'de yeniden düşülmez
  const once = rem({ title: "KDV Eylül", kind: "vergi", amount: 27_300, dueDate: "2026-10-28", repeat: "none", active: false });
  const o = withVat({ reminders: [once], vatAnchor: anchor, paidReminders: [{ id: once.id, dueDate: "2026-10-28", next: null, amount: 27_300 }] });
  assert.equal(o.vat!.mode, "default");
  assert.deepEqual(kdvLines(o), [["2026-11-28", "KDV (Ekim)", 42_100]]);
  assert.deepEqual(
    o.vat!.rows.map((r) => r.period),
    ["2026-10"],
  );
  // "Geri al" kaydı siler: Eylül yine beklenir
  assert.deepEqual(kdvLines(withVat({ reminders: [once], vatAnchor: anchor })), [
    ["2026-10-28", "KDV (Eylül)", 27_300],
    ["2026-11-28", "KDV (Ekim)", 42_100],
  ]);
  // Yeniden açılan tek seferlik dönemini yine bekler (yalnız onun günü: KDV hatırlatıcısı varken tahmin onun günlerinde)
  assert.deepEqual(
    kdvLines(withVat({ reminders: [{ ...once, active: true }], vatAnchor: anchor, paidReminders: [{ id: once.id, dueDate: "2026-10-28", next: null, amount: 27_300 }] })),
    [["2026-10-28", "KDV Eylül", 27_300]],
  );
  // Ödendikten sonra kapatılan seri: ödenen dönem yine bitmiştir
  const closed = kdvRem({ dueDate: "2026-11-28", anchorDate: "2026-10-28", active: false });
  assert.deepEqual(kdvLines(withVat({ reminders: [closed], vatAnchor: anchor, paidReminders: [{ id: closed.id, dueDate: "2026-10-28", next: "2026-11-28", amount: null }] })), [
    ["2026-11-28", "KDV (Ekim)", 42_100],
  ]);
  // Seride Eylül 27.200 yazılıydı; Ödendi tutarı sildi, seri 28 Kasım'da. Otomatik zincirde Eylül'den 140.200 ₺
  // devrederdi (Ekim'de ödeme yok); ödenen tutar Eylül'ün kesin tutarı olarak kalır, Ekim 42.100
  const series = kdvRem({ dueDate: "2026-11-28", anchorDate: "2026-10-28" });
  const paid = withVat({ reminders: [series], paidReminders: [{ id: series.id, dueDate: "2026-10-28", next: "2026-11-28", amount: 27_200 }] });
  assert.deepEqual(kdvLines(paid), [["2026-11-28", "KDV (Ekim)", 42_100]]);
  assert.deepEqual(
    paid.vat!.rows.map((r) => [r.period, r.estimate!.carryIn]),
    [["2026-10", 0]],
  );
  // Tutarsız Ödendi zinciri değiştirmez (beyanname devreden göstermiş olabilir)
  assert.deepEqual(kdvLines(withVat({ reminders: [series], paidReminders: [{ id: series.id, dueDate: "2026-10-28", next: "2026-11-28", amount: null }] })), []);
  // "Tarihe kadar ödendi" Eylül ve Ekim'i birden kapatır
  const through = kdvRem({ dueDate: "2026-12-28", anchorDate: "2026-10-28" });
  const t = withVat({ reminders: [through], vatAnchor: anchor, paidReminders: [{ id: through.id, dueDate: "2026-10-28", next: "2026-12-28", amount: 27_300 }] });
  assert.deepEqual(kdvLines(t), []);
  assert.deepEqual(t.vat!.rows, []);
  // KDV-2'nin Ödendi'si asıl KDV'nin dönemini kapatmaz
  const v2 = rem({ title: "KDV2 Eylül", kind: "vergi", amount: 1_800, dueDate: "2026-10-25", repeat: "none", active: false });
  assert.deepEqual(
    kdvLines(withVat({ reminders: [v2], vatAnchor: anchor, paidReminders: [{ id: v2.id, dueDate: "2026-10-25", next: null, amount: 1_800 }] })).filter((l) => String(l[1]).startsWith("KDV (")),
    [
      ["2026-10-28", "KDV (Eylül)", 27_300],
      ["2026-11-28", "KDV (Ekim)", 42_100],
    ],
  );
});

test("KDV: Ödendi'nin kalıcı kaydı son ödenenler düştükten sonra da geçerli; silinen hatırlatıcının ödemesi durur", () => {
  const anchor = { month: "2026-08", amount: 0 };
  const kdvLines = (p: CashPlan) =>
    lines(p)
      .filter((l) => l.kind === "kdv" || l.key.startsWith("reminder:"))
      .map((l) => [l.date, l.title, l.amount]);
  const entry = (over: Partial<VatPaidEntry>): VatPaidEntry => ({ id: 1, kind: "kdv", dueDate: "2026-10-28", next: null, periods: ["2026-09"], amount: null, at: "2026-10-20T09:00:00.000Z", ...over });
  // Seride Eylül 27.200 ödendi; son ödenenlerdeki kayıt 30 günde (ya da 30 kayıtta) düştü, kalıcı kayıt duruyor:
  // Eylül'ün devredeni sıfırlanmış kalır, Ekim 42.100 (kayıt olmasa otomatik zincirde Ekim'de ödeme yok)
  const series = kdvRem({ dueDate: "2026-11-28", anchorDate: "2026-10-28" });
  const durable = entry({ id: series.id, next: "2026-11-28", amount: 27_200 });
  assert.deepEqual(kdvLines(withVat({ reminders: [series], vatPaid: [durable] })), [["2026-11-28", "KDV (Ekim)", 42_100]]);
  assert.deepEqual(kdvLines(withVat({ reminders: [series] })), []);
  // Tek seferlik "KDV Eylül" ödendi ve sonra silindi: ödeme yapılmıştır, Eylül 28 Ekim'de geri gelmez
  assert.deepEqual(kdvLines(withVat({ reminders: [], vatAnchor: anchor, vatPaid: [entry({ id: 999, amount: 27_300 })] })), [["2026-11-28", "KDV (Ekim)", 42_100]]);
  // Silinmiş KDV-2 hatırlatıcısının kaydı asıl KDV'nin dönemini kapatmaz
  assert.deepEqual(kdvLines(withVat({ reminders: [], vatAnchor: anchor, vatPaid: [entry({ id: 999, kind: "kdv2", amount: 1_800 })] })), [
    ["2026-10-28", "KDV (Eylül)", 27_300],
    ["2026-11-28", "KDV (Ekim)", 42_100],
  ]);
  // Hatırlatıcı duruyor ama artık KDV hatırlatıcısı değil (adı değişti): kalıcı kayıt onun türüyle sayılmaz
  const renamed = rem({ title: "Muhasebe ödemesi", kind: "odeme", amount: null, dueDate: "2026-11-28", active: false });
  assert.deepEqual(kdvLines(withVat({ reminders: [renamed], vatAnchor: anchor, vatPaid: [entry({ id: renamed.id, amount: 27_300 })] })), [
    ["2026-10-28", "KDV (Eylül)", 27_300],
    ["2026-11-28", "KDV (Ekim)", 42_100],
  ]);
  // Yeniden açılan tek seferlik dönemini yine bekler (kalıcı kayıt da)
  const once = rem({ title: "KDV Eylül", kind: "vergi", amount: 27_300, dueDate: "2026-10-28", repeat: "none" });
  assert.deepEqual(kdvLines(withVat({ reminders: [once], vatAnchor: anchor, vatPaid: [entry({ id: once.id, amount: 27_300 })] })), [["2026-10-28", "KDV Eylül", 27_300]]);
  // Tarihi başka döneme taşınan hatırlatıcı ödemeyi geri açmaz: 28 Kasım Cumartesi diye seri 27'ye alındı (dönemi
  // hâlâ Ekim); Eylül ödenmiş, tutarı devredeni sıfırlamaya devam eder (Ekim 42.100, 140.200 devretmez)
  const moved = kdvRem({ dueDate: "2026-11-27", anchorDate: "2026-11-27" });
  assert.deepEqual(kdvLines(withVat({ reminders: [moved], vatPaid: [entry({ id: moved.id, next: "2026-11-28", amount: 27_200 })] })), [["2026-11-27", "KDV (Ekim)", 42_100]]);
  // Kapalı tek seferlik ertesi aya yeniden kullanıldı ("KDV Ekim", 28 Kasım): Eylül'ün ödemesi durur
  const reused = rem({ title: "KDV Ekim", kind: "vergi", amount: null, dueDate: "2026-11-28", repeat: "none" });
  assert.deepEqual(kdvLines(withVat({ reminders: [reused], vatAnchor: anchor, vatPaid: [entry({ id: reused.id, amount: 27_300 })] })), [["2026-11-28", "KDV (Ekim)", 42_100]]);
  // Tarihi Eylül'e geri alınan seri (şimdiki dönemi ödenenlerden) Eylül'ü yine bekler
  const back = kdvRem({ dueDate: "2026-10-28", anchorDate: "2026-10-28" });
  assert.deepEqual(
    kdvLines(withVat({ reminders: [back], vatAnchor: anchor, vatPaid: [entry({ id: back.id, next: "2026-11-28", amount: 27_300 })] })).map((l) => l[0]),
    ["2026-10-28", "2026-11-28"],
  );
});

test("KDV: ufuktaki tek ödeme günü ödenmiş dönemse kart, not ve Tahmine katılanlar bunu söyler", () => {
  // 5 Kasım: ufuk 16 Aralık'a kadar, tek 28'i 28 Kasım (Ekim). Tek seferlik "KDV Ekim" erken ödendi
  const today = "2026-11-05";
  const v = vatMonthInputs(model, today);
  const once = rem({ title: "KDV Ekim", kind: "vergi", amount: 40_000, dueDate: "2026-11-28", repeat: "none", active: false });
  const p = buildCashPlan(
    input({ today, vat: v, vatAnchor: { month: "2026-08", amount: 0 }, reminders: [once], paidReminders: [{ id: once.id, dueDate: "2026-11-28", next: null, amount: 40_000 }] }),
  );
  assert.equal(p.vat!.mode, "default");
  assert.deepEqual(p.vat!.rows, []);
  assert.deepEqual(p.vat!.paid, [{ period: "2026-10", amount: 40_000 }]);
  assert.deepEqual(p.vat!.paid2, []);
  // Tahmin edilebilir: "satış verisi yok" denmez
  assert.equal(p.vat!.ok, true);
  assert.doesNotMatch(planNotes(p, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 }).find((n) => n.key === "kdv")!.text, /tahmin edilemedi/);
  const row = p.estimates.find((e) => e.key === "kdv")!;
  assert.equal(row.status, "on");
  assert.equal(row.note, "Ayın 28'inde · Ekim ödendi; 6 hafta içinde başka 1 No.lu KDV günü yok");
  // Ödenmemişken dönem satırdadır, "ödendi" bilgisi yoktur
  const open = buildCashPlan(input({ today, vat: v, vatAnchor: { month: "2026-08", amount: 0 } }));
  assert.deepEqual(open.vat!.paid, []);
  assert.deepEqual(
    open.vat!.rows.map((r) => r.period),
    ["2026-10"],
  );
  // Ufkun dışındaki eski ödenmiş dönemler listelenmez
  assert.deepEqual(withVat({ vatAnchor: { month: "2026-08", amount: 0 }, vatPaid: [{ id: 5, kind: "kdv", dueDate: "2026-09-28", next: null, periods: ["2026-08"], amount: 9_000, at: "2026-09-20T09:00:00.000Z" }] }).vat!.paid, []);
});

test("KDV kartı 'kaydını kaldır': onay metni dönemin plana nereden döndüğünü kipe ve ödeme gününe göre söyler", () => {
  const anchor = { month: "2026-08", amount: 0 };
  const rowsOf = (p: CashPlan) => p.vat!.rows.map((r) => [r.period, r.date]);
  const sep = { kind: "kdv" as const, period: "2026-09" };
  // Varsayılan kip: tek seferlik "KDV Eylül"e yanlışlıkla Ödendi denmiş, sonra silinmiş; başka KDV hatırlatıcısı yok
  const entry: VatPaidEntry = { id: 999, kind: "kdv", dueDate: "2026-10-28", next: null, periods: ["2026-09"], amount: null, at: "2026-10-20T09:00:00.000Z" };
  const recorded = withVat({ vatAnchor: anchor, vatPaid: [entry] });
  assert.equal(recorded.vat!.baseMode, "default");
  assert.deepEqual(recorded.vat!.paid, [{ period: "2026-09", amount: null }]);
  // Kayıt kalkınca Eylül 28 Ekim'de kendiliğinden döner; pencere bunu söyler, hatırlatıcı eklemeyi söylemez
  assert.deepEqual(rowsOf(withVat({ vatAnchor: anchor })), [
    ["2026-09", "2026-10-28"],
    ["2026-10", "2026-11-28"],
  ]);
  assert.equal(vatForgetText(sep, "default", TODAY), "Dönem yeniden ödenecek sayılır; tahmini ayın 28'inde plana girer. Hatırlatıcılara dokunulmaz.");
  // (eklenen tek seferlik "KDV Eylül" planı hatırlatıcı kipine geçirirdi: Ekim'in 28 Kasım'ı sessizce düşerdi)
  const oneOff = rem({ title: "KDV Eylül", kind: "vergi", amount: null, dueDate: "2026-10-28", repeat: "none" });
  assert.deepEqual(rowsOf(withVat({ vatAnchor: anchor, reminders: [oneOff] })), [["2026-09", "2026-10-28"]]);
  // Ödeme günü bugünse (28 Ekim) kart kaldırmayı yine sunar, ama tahmin yarından başlar: Eylül plana girmez
  const due = "2026-10-28";
  const vDue = vatMonthInputs(model, due);
  assert.deepEqual(buildCashPlan(input({ today: due, vat: vDue, vatAnchor: anchor, vatPaid: [entry] })).vat!.paid, [{ period: "2026-09", amount: null }]);
  assert.deepEqual(
    buildCashPlan(input({ today: due, vat: vDue, vatAnchor: anchor })).vat!.rows.map((r) => r.period),
    ["2026-10"],
  );
  assert.equal(vatForgetText(sep, "default", due), "Dönem yeniden ödenecek sayılır. Ödeme günü bugün: tahmin yarından başladığı için plana girmez. Hatırlatıcılara dokunulmaz.");

  // Hatırlatıcı kipi: Eylül'ün tek seferliği silinmiş, seri Ekim'de (28 Kasım). Eylül yalnız bir hatırlatıcının gününde
  // girer: kaldırınca girmez, tek seferlik eklenince onun gününde (ödeme günü bugün olsa da)
  const series = kdvRem({ dueDate: "2026-11-28", anchorDate: "2026-10-28" });
  const reminderText =
    "Dönem yeniden ödenecek sayılır. Ödemeler'de KDV hatırlatıcısı varsa dönem yalnız bir hatırlatıcının gününde plana girer; o dönem için hatırlatıcı yoksa ekleyin. Hatırlatıcılara dokunulmaz.";
  assert.equal(withVat({ vatAnchor: anchor, reminders: [series], vatPaid: [entry] }).vat!.baseMode, "reminder");
  assert.deepEqual(rowsOf(withVat({ vatAnchor: anchor, reminders: [series] })), [["2026-10", "2026-11-28"]]);
  assert.deepEqual(rowsOf(withVat({ vatAnchor: anchor, reminders: [series, oneOff] })), [
    ["2026-09", "2026-10-28"],
    ["2026-10", "2026-11-28"],
  ]);
  assert.equal(vatForgetText(sep, "reminder", TODAY), reminderText);
  assert.deepEqual(
    buildCashPlan(input({ today: due, vat: vDue, vatAnchor: anchor, reminders: [series, oneOff] })).vat!.rows.map((r) => [r.period, r.date]),
    [
      ["2026-09", "2026-10-28"],
      ["2026-10", "2026-11-28"],
    ],
  );
  assert.equal(vatForgetText(sep, "reminder", due), reminderText);

  // KDV-2: Eylül faturasında 1.800 ₺ tevkifat; KDV-2 hatırlatıcısı silinmiş, Ödendi kaydı duruyor
  const sepBill = ds.invoices.find((i) => i.date === "2026-09-17" && i.amount === 30_000)!;
  const withheldModel = createModel({ ...ds, invoices: ds.invoices.map((i) => (i === sepBill ? { ...i, vat: 6_000 } : i)) });
  const kdv2 = { kind: "kdv2" as const, period: "2026-09" };
  const entry2: VatPaidEntry = { id: 998, kind: "kdv2", dueDate: "2026-10-25", next: null, periods: ["2026-09"], amount: 1_800, at: "2026-10-20T09:00:00.000Z" };
  const plan2 = (today: string, over: Partial<CashPlanInput> = {}) =>
    buildCashPlan(input({ today, vat: vatMonthInputs(withheldModel, today), vatAnchor: { month: "2026-09", amount: 121_204.69 }, ...over }));
  const vat2Of = (p: CashPlan) => p.vat!.vat2.map((r) => [r.period, r.date]);
  // 24 Ekim: kaldırınca Eylül 25 Ekim'de tahminiyle girer
  assert.deepEqual(plan2("2026-10-24", { vatPaid: [entry2] }).vat!.paid2, [{ period: "2026-09", amount: 1_800 }]);
  assert.deepEqual(vat2Of(plan2("2026-10-24")), [["2026-09", "2026-10-25"]]);
  assert.equal(
    vatForgetText(kdv2, "default", "2026-10-24"),
    "Dönem yeniden ödenecek sayılır. Ödemeler'de o dönem için KDV-2 hatırlatıcısı varsa onun gününde, yoksa ayın 25'inde tahminiyle plana girer; dönemin faturalarında tevkifat yoksa ödeme beklenmez. Hatırlatıcılara dokunulmaz.",
  );
  // KDV tahmine katılmıyorsa ("Tahmine katılanlar"dan kapalı) tahmin plana girmez; metin de bunu söyler
  const off = plan2("2026-10-24", { excluded: ["kdv"] });
  assert.equal(off.vat!.mode, "excluded");
  assert.deepEqual(lines(off).filter((l) => l.key.startsWith("kdv2@")), []);
  assert.equal(
    vatForgetText(kdv2, "excluded", "2026-10-24"),
    "Dönem yeniden ödenecek sayılır. KDV tahmine katılmadığı için dönemin tahmini plana girmez; KDV-2 hatırlatıcısına tutar yazılıysa o gününde girer. Hatırlatıcılara dokunulmaz.",
  );
  assert.match(vatForgetText(sep, "excluded", TODAY), /KDV tahmine katılmadığı için dönemin tahmini plana girmez; KDV hatırlatıcısına/);
  // 25 Ekim (ödeme günü): kart kaldırmayı sunar, ama tahmin girmez; o dönemin hatırlatıcısı ise bugüne girer
  assert.deepEqual(plan2("2026-10-25", { vatPaid: [entry2] }).vat!.paid2, [{ period: "2026-09", amount: 1_800 }]);
  assert.deepEqual(vat2Of(plan2("2026-10-25")), []);
  const kdv2Once = rem({ title: "KDV2 Eylül", kind: "vergi", amount: null, dueDate: "2026-10-25", repeat: "none" });
  assert.deepEqual(
    lines(plan2("2026-10-25", { reminders: [kdv2Once] }))
      .filter((l) => l.key.startsWith("reminder:"))
      .map((l) => [l.date, l.title, l.amount]),
    [["2026-10-25", "KDV2 Eylül (Eylül)", 1_800]],
  );
  const dueText =
    "Dönem yeniden ödenecek sayılır. Ödemeler'de o dönem için KDV-2 hatırlatıcısı varsa onun gününde plana girer; yoksa girmez: ödeme günü bugün, tahmin yarından başlar. Hatırlatıcılara dokunulmaz.";
  assert.equal(vatForgetText(kdv2, "default", "2026-10-25"), dueText);
  assert.equal(vatForgetText(kdv2, "reminder", "2026-10-25"), dueText);

  // Kart metni tek yerden alır; eski "tahmini ya da hatırlatıcısı plana döner" yok
  const card = read("src/app/panel/hatirlaticilar/nakit/vat-card.tsx");
  assert.match(card, /<PaidRecords vat=\{vat\} today=\{today\} \/>/);
  assert.match(card, /description=\{ask \? vatForgetText\(ask, vat\.mode, today\) : ""\}/);
  assert.doesNotMatch(card, /tahmini ya da hatırlatıcısı plana döner|Dönem yeniden ödenecek sayılır/);
});

test("KDV'nin kalıcı Ödendi kaydı: dönemler, ekleme, 24 ay, geri alma, bozuk kayıt", () => {
  const series = { note: null, repeat: "monthly" as const, anchorDate: "2026-10-28" };
  // Tarihe kadar ödendi: Eylül ve Ekim; tek seferliğin ertelenmiş kopyası asıl gününün dönemi
  assert.deepEqual(paidPeriodsOf(series, "2026-10-28", "2026-12-28"), ["2026-09", "2026-10"]);
  assert.deepEqual(paidPeriodsOf(series, "2026-10-28", "2026-11-28"), ["2026-09"]);
  assert.deepEqual(paidPeriodsOf({ note: postponeNote(null, "2026-10-28"), repeat: "none", anchorDate: "2026-11-10" }, "2026-11-10", null), ["2026-09"]);
  const e = (over: Partial<VatPaidEntry>): VatPaidEntry => ({ id: 1, kind: "kdv", dueDate: "2026-10-28", next: "2026-11-28", periods: ["2026-09"], amount: 27_200, at: "2026-10-28T09:00:00.000Z", ...over });
  // Aynı hatırlatıcının aynı günü yenilenir; başka gün eklenir; 24 aydan eski düşer
  let list = addVatPaid([], e({}), "2026-10-28T09:00:00.000Z");
  list = addVatPaid(list, e({ amount: 27_300 }), "2026-10-28T10:00:00.000Z");
  assert.deepEqual(
    list.map((x) => x.amount),
    [27_300],
  );
  list = addVatPaid(list, e({ dueDate: "2026-11-28", next: "2026-12-28", periods: ["2026-10"], amount: null, at: "2026-11-27T09:00:00.000Z" }), "2026-11-27T09:00:00.000Z");
  assert.deepEqual(
    list.map((x) => x.dueDate),
    ["2026-11-28", "2026-10-28"],
  );
  assert.equal(addVatPaid([e({ at: "2024-10-01T00:00:00.000Z" })], e({ id: 2 }), "2026-10-28T09:00:00.000Z").length, 1);
  // Geri al: hatırlatıcı 28 Kasım'a döndü, o günden ödenenler gider; Eylül'ün ödemesi kalır; başka hatırlatıcıya dokunulmaz
  assert.deepEqual(
    removeVatPaid([...list, e({ id: 2 })], 1, "2026-11-28").map((x) => [x.id, x.dueDate]),
    [
      [1, "2026-10-28"],
      [2, "2026-10-28"],
    ],
  );
  // Kartın "kaydını kaldır"ı: dönem çıkar; ilk dönemse tutar da; dönemi kalmayan kayıt düşer; öbür tür ve dönem kalır
  const through = e({ dueDate: "2026-10-28", next: "2026-12-28", periods: ["2026-09", "2026-10"], amount: 27_200 });
  assert.deepEqual(
    forgetVatPeriod([through], "kdv", "2026-10").map((x) => [x.periods, x.amount]),
    [[["2026-09"], 27_200]],
  );
  assert.deepEqual(
    forgetVatPeriod([through], "kdv", "2026-09").map((x) => [x.periods, x.amount]),
    [[["2026-10"], null]],
  );
  assert.deepEqual(forgetVatPeriod([e({})], "kdv", "2026-09"), []);
  assert.equal(forgetVatPeriod([e({ kind: "kdv2" })], "kdv", "2026-09").length, 1);
  assert.equal(forgetVatPeriod([e({})], "kdv", "2026-08").length, 1);
  // Bozuk ya da eksik kayıt atılır
  assert.deepEqual(parseVatPaid([e({}), { ...e({}), kind: "x" }, { ...e({}), periods: [] }, { ...e({}), periods: ["2026-9"] }, { ...e({}), amount: -1 }, { ...e({}), at: "dün" }, null, 5]).length, 1);
  assert.deepEqual(parseVatPaid({ a: 1 }), []);
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

test("KDV tevkifatı (KDV2, 2 No.lu) asıl KDV değildir: tutarı kayıtlı döneminde kesin; asıl KDV'nin dönemini almaz, devredeni sıfırlamaz", () => {
  const main = kdvRem();
  const kdv2 = rem({ title: "KDV2 tevkifat", kind: "vergi", amount: 3_000, dueDate: "2026-10-26" });
  const p = withVat({ reminders: [main, kdv2] });
  // 26 Kasım Ekim'indir: tevkifatsız Ekim'de (Excel verisi) ödeme yok, Eylül'ün 3.000'i oraya yazılmaz
  assert.deepEqual(
    lineAt(p, `reminder:${kdv2.id}@`).map((l) => [l.date, l.amount, l.estimated]),
    [["2026-10-26", 3_000, false]],
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
  // Bordro Vergi'ninkidir (K18, src/lib/tax/payroll.ts): netten brüt, 2026 yasal oranları (işveren %19,75 + %2),
  // asgari ücret istisnası; Ayarlar'ın %15,75'iyle 23.117,65'ti
  close(oct.payroll.sgk, 25_956.18, "SGK", 0.005);
  assert.deepEqual(base.sgkRates, { year: 2026, isveren: 0.1975, issizlik: 0.02 });
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
  assert.equal(text("excluded"), "Tutarı girilmemiş vergiler (muhtasar, geçici vergi vb.), Aylık harcamalar'da her ay girilmeyen (tek seferlik) ödemeler (cari borçların gider kayıtları dahil), yıllık giderler (ModPOS / Patron aboneliği), yatırım ve kredi.");
  assert.doesNotMatch(text("excluded"), /KDV/);
  assert.match(text("kdv"), /ayın 28'inde/);
  const reports = Array.from({ length: 8 }, (_, i) => ({ date: addDays(TODAY, -1 - i), zTotal: 9_850, card: 7_683, mealCard: 0 }));
  const kasa = planNotes(buildCashPlan(input({ cashReports: reports })), { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.match(kasa.find((n) => n.key === "sales")!.text, /^Son 28 günün 8 raporlu gününe göre günde ortalama 9\.850 ₺ \(Z toplamı, ödenmez \/ ikram hariç\)\. Kartla ödenen %78 için %2,5 komisyon düşüldü/);
  // İki "online" ayrı adla: Z raporundaki platformlar (Yemeksepeti, Getir…) ile kasadan geçmeyen laffogato.net
  const platform = buildCashPlan(input({ cashReports: reports.map((r) => ({ ...r, online: 985 })), online: { month: "2026-09", perDay: 420 } }));
  assert.equal(platform.basis.sales.kind === "kasa" ? platform.basis.sales.platformShare : null, 0.1);
  const pn = planNotes(platform, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.match(pn.find((n) => n.key === "sales")!.text, /\(Z toplamı, ödenmez \/ ikram hariç; Z'deki online platform ödemeleri \(Yemeksepeti, Getir…\) %10, aynı gün ve kesintisiz sayıldı\)\./);
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
  // Şube seçiliyken de işletmenin planı: model "Tümü" ile yeniden okunur, planın kasa raporları da "Tümü"yle (HM-05;
  // docs/SUBE.md › Neyi süzer)
  assert.match(
    dash,
    /model\.ds\.branchView \? loadModel\(\{ scope: ALL_BRANCHES \}\) : Promise\.resolve\(model\)\)\s*\.then\(\(m\) => withBranchScope\(ALL_BRANCHES, \(\) => loadCashPlan\(m, upcoming\)\)\)\s*\.catch\(\(\) => null\)/,
  );
  assert.match(page, /withBranchScope\(ALL_BRANCHES,/);
  // db:reset nakit planının durumunu siler (sabit gider kimlikleri baştan sayar)
  assert.match(read("scripts/seed.ts"), /'cashflow\.plan'/);
});

// ---------------------------------------------------------------- Vergi (docs/VERGI.md, plan docs/planlar/vergi.md §8, §11-I)

/** Vergi sayfasının nakit planı beslemesi (buildTaxView › planFeed), Excel verisinden; varsayılan vergi ayarları */
function taxFeed(m: Model = model, filings: TaxFiling[] = [], today = TODAY): TaxPlanFeed {
  const settings = DEFAULT_TAX_SETTINGS;
  const pnl = taxPnlInputFromModel(m, { settings, today, adjustments: [], assets: [], filings });
  const items = new Map<string, MuhtasarItem[]>();
  for (let p = shiftMonth(today.slice(0, 7), -4); p <= shiftMonth(today.slice(0, 7), 4); p = shiftMonth(p, 1)) items.set(p, muhtasarItemsFromModel(m, p));
  return buildTaxView({ today, settings, pnl, muhtasarItems: items, filings, reminders: [], vat: null }).planFeed;
}
const FEED = taxFeed();
const muhtasarRem = (over: Partial<ReminderRow> = {}) => rem({ title: "Muhtasar ve prim hizmet beyannamesi", kind: "vergi", amount: null, dueDate: "2026-10-26", ...over });
const geciciRem = (over: Partial<ReminderRow> = {}) => rem({ title: "Geçici vergi beyanı ve ödemesi", kind: "vergi", amount: null, dueDate: "2026-11-17", repeat: "quarterly", ...over });
const taxLines = (p: CashPlan) => lines(p).filter((l) => l.kind === "vergi");

test("vergi (I-1): muhtasar tahmini ayın 26'sında, 'en az'; tutarsız hatırlatıcı onun gününde taşır; yazılı tutar kesin", () => {
  const sep = FEED.items.find((i) => i.kind === "muhtasar" && i.period === "2026-09")!;
  assert.equal(sep.amount, 974.38);
  assert.equal(sep.atLeast, true);
  // Hatırlatıcı yok: nominal günde tahmin, başlık ve "en az"
  const p = buildCashPlan(input({ tax: FEED }));
  const [line] = byKey(p, "vergi:muhtasar@2026-10-26");
  assert.deepEqual([line.title, line.amount, line.estimated, line.href, lineLabel(line)], ["Muhtasar (Eylül)", 974.38, true, "/panel/vergi", "Muhtasar (Eylül, tahmini)"]);
  assert.match(line.detail!, /^Ücret GV 0 \+ DV 34,68 \+ damga 939,70; en az \(4 kalemin stopajı bilinmiyor\)\. Tahmin; kesin tutar tahakkuk fişindedir\. Son gün 26 Ekim Pazartesi\.$/);
  assert.deepEqual(byKey(p, "vergi:muhtasar@2026-11-26").map((l) => l.title), ["Muhtasar (Ekim)"]);
  assert.equal(p.unknownAmounts.length, 1, "yalnız taslak çeyreğin geçici vergisi");
  // Tutarsız aylık hatırlatıcı (26'sı): satır onun gününde, "Tutarı girilmemiş ödemeler"de değil
  const r = muhtasarRem();
  const withRem = buildCashPlan(input({ tax: FEED, reminders: [r] }));
  assert.deepEqual(
    taxLines(withRem).filter((l) => l.key.startsWith("vergi:muhtasar")).map((l) => [l.key, l.date, l.amount]),
    [
      ["vergi:muhtasar@2026-10-26", "2026-10-26", 974.38],
      ["vergi:muhtasar@2026-11-26", "2026-11-26", 974.38],
    ],
  );
  assert.ok(!withRem.unknownAmounts.some((u) => u.reminderId === r.id));
  // Tutar 1.200 yazılı: o dönem kesin 1.200, tahmin yok; tutar o döneme ait, sonraki dönem tahmin
  const known = buildCashPlan(input({ tax: FEED, reminders: [muhtasarRem({ id: r.id, amount: 1_200 })] }));
  assert.deepEqual(
    lineAt(known, `reminder:${r.id}@`).map((l) => [l.date, l.amount, l.estimated]),
    [["2026-10-26", 1_200, false]],
  );
  assert.equal(byKey(known, "vergi:muhtasar@2026-10-26").length, 0);
  assert.equal(byKey(known, "vergi:muhtasar@2026-11-26").length, 1);
  // Gecikmiş tutarsız dönem bugüne, asıl günüyle
  const late = buildCashPlan(input({ today: "2026-10-27", tax: FEED, reminders: [muhtasarRem({ id: r.id })] }));
  const [overdue] = byKey(late, "vergi:muhtasar@2026-10-27");
  assert.deepEqual([overdue.title, overdue.due, overdue.overdue], ["Muhtasar (Eylül)", "2026-10-26", true]);
  // Sabit tutarlı "Kira stopajı" (tutarı Ödendi'den sonra kalır): her dönemde kesin, ama muhtasarın yalnız kira stopajı
  // kısmıdır (VG-02): dönemi sahiplenmez, muhtasarın kalanı (tahminde kira stopajı yok: 974,38) aynı gün ayrıca girer
  const stopaj = rem({ title: "Kira stopajı", kind: "vergi", amount: 8_000, dueDate: "2026-10-26" });
  const sp = buildCashPlan(input({ tax: FEED, reminders: [stopaj] }));
  assert.deepEqual(
    lineAt(sp, `reminder:${stopaj.id}@`).map((l) => [l.date, l.amount]),
    [
      ["2026-10-26", 8_000],
      ["2026-11-26", 8_000],
    ],
  );
  assert.deepEqual(
    taxLines(sp)
      .filter((l) => l.key.startsWith("vergi:muhtasar"))
      .map((l) => [l.key, l.amount]),
    [
      ["vergi:muhtasar@2026-10-26", 974.38],
      ["vergi:muhtasar@2026-11-26", 974.38],
    ],
  );
  // Besleme yoksa bugünkü gibi: tahmin satırı yok, tutarsız hatırlatıcı listede
  const none = buildCashPlan(input({ reminders: [muhtasarRem({ id: r.id })] }));
  assert.equal(taxLines(none).length, 0);
  assert.deepEqual(none.unknownAmounts.map((u) => u.reminderId), [r.id]);
  // Besleme yoksa tutarlı muhtasar ve geçici vergi hatırlatıcısı da bugünkü gibi her dönemini tutarıyla çizer (§8.1)
  const fixedM = muhtasarRem({ id: r.id, amount: 5_000 });
  const fixedG = geciciRem({ amount: 40_000, dueDate: "2026-08-17", anchorDate: "2026-08-17" });
  const zero = muhtasarRem({ title: "Muhtasar (stopaj)", amount: 0, dueDate: "2026-10-26" });
  const noFeed = buildCashPlan(input({ reminders: [fixedM, fixedG, zero] }));
  assert.deepEqual(
    lineAt(noFeed, `reminder:${fixedM.id}@`).map((l) => [l.date, l.amount]),
    [
      ["2026-10-26", 5_000],
      ["2026-11-26", 5_000],
    ],
  );
  assert.deepEqual(
    lineAt(noFeed, `reminder:${fixedG.id}@`).map((l) => [l.date, l.due, l.amount]),
    [
      [TODAY, "2026-08-17", 40_000],
      ["2026-11-17", undefined, 40_000],
    ],
  );
  assert.equal(lineAt(noFeed, `reminder:${zero.id}@`).length, 0);
  assert.deepEqual(noFeed.unknownAmounts, [], "tutarı 0 olan da listede değil");
});

test("vergi (I-2): taslak çeyreğin geçici vergisi plana girmez, 'Tutarı girilmemiş ödemeler'de; muhasebeci kaydı kesin, rozetle", () => {
  const p = buildCashPlan(input({ tax: FEED }));
  assert.equal(lineAt(p, "vergi:gecici").length, 0);
  assert.deepEqual(p.unknownAmounts, [
    {
      key: "vergi:gecici:2026-Q3",
      reminderId: null,
      title: "Geçici vergi 2026/3 · tutarı muhasebecinizden isteyin",
      date: "2026-11-17",
      note: "Geçici vergi 2026/3: şirketin beyannamesi; tutarı muhasebecinizden isteyin (son gün 17.11)",
    },
  ]);
  // Hatırlatıcı tutarsızken: hatırlatıcının satırı notuyla
  const g = geciciRem();
  const withRem = buildCashPlan(input({ tax: FEED, reminders: [g] }));
  assert.deepEqual(
    withRem.unknownAmounts.map((u) => [u.key, u.reminderId, u.date, u.note]),
    [[`reminder:${g.id}`, g.id, "2026-11-17", "Geçici vergi 2026/3: şirketin beyannamesi; tutarı muhasebecinizden isteyin (son gün 17.11)"]],
  );
  // Muhasebeci kaydı { ödenecek 41.200, damga 791 }: 17 Kasım'da kesin 41.991, rozet "Muhasebeci"
  const filed = taxFeed(model, [{ id: 1, kind: "gecici", period: "2026-Q3", payable: 41_200, stamp: 791, values: {} }]);
  const fp = buildCashPlan(input({ tax: filed }));
  const [line] = byKey(fp, "vergi:gecici@2026-11-17");
  assert.deepEqual([line.title, line.amount, line.estimated, line.badge], ["Geçici vergi (2026/3)", 41_991, false, "Muhasebeci"]);
  assert.equal(fp.unknownAmounts.length, 0);
  // Tutarsız hatırlatıcı varken muhasebecinin rakamı onun gününde; yazılı tutar önce gelir (nakit planında 2 › 1 › 3)
  assert.deepEqual(byKey(buildCashPlan(input({ tax: filed, reminders: [geciciRem({ id: g.id, dueDate: "2026-11-16" })] })), "vergi:gecici@2026-11-16").map((l) => l.amount), [41_991]);
  const written = buildCashPlan(input({ tax: filed, reminders: [geciciRem({ id: g.id, amount: 40_000 })] }));
  assert.deepEqual(lineAt(written, `reminder:${g.id}@`).map((l) => l.amount), [40_000]);
  assert.equal(lineAt(written, "vergi:gecici").length, 0);
  // K4 (P3): muhasebecinin rakamı 1 ₺'den fazla farklıysa satır söyler; aynıysa not yok
  assert.deepEqual(
    lineAt(written, `reminder:${g.id}@`).map((l) => l.detail?.replace(/\u00a0/g, " ")),
    ["Muhasebecinin rakamı 41.991 ₺, Ödemeler'deki tutar 40.000 ₺: nakit planı Ödemeler'dekini kullanıyor. Hangisi doğruysa öbürünü düzeltin."],
  );
  assert.equal(lineAt(buildCashPlan(input({ tax: filed, reminders: [geciciRem({ id: g.id, amount: 41_991 })] })), `reminder:${g.id}@`)[0].detail, undefined);
  // Hazır çeyrek (tahmin): tahmin satırı
  const ready: TaxPlanFeed = { ...FEED, pending: [], items: [...FEED.items, { kind: "gecici", period: "2026-Q3", nominal: "2026-11-17", legalDue: "2026-11-17", amount: 12_791, atLeast: false, source: "estimate", detail: "Geçici vergi 2026/3: kafenin katkısı" }] };
  const rp = buildCashPlan(input({ tax: ready }));
  assert.deepEqual(byKey(rp, "vergi:gecici@2026-11-17").map((l) => [l.amount, l.estimated, l.badge]), [[12_791, true, undefined]]);
  // "Ödendi" (kalıcı kayıt, tür gecici; silinmiş hatırlatıcınınki): etkin hatırlatıcının o dönemi çizilmez
  const at = "2026-11-10T10:00:00.000Z";
  const deleted: VatPaidEntry[] = [{ id: 999, kind: "gecici", dueDate: "2026-11-17", next: null, periods: ["2026-Q3"], amount: 12_791, at }];
  const active = geciciRem({ id: g.id });
  assert.deepEqual(lineAt(buildCashPlan(input({ tax: ready, reminders: [active] })), "vergi:gecici").map((l) => [l.date, l.amount]), [["2026-11-17", 12_791]], "kayıt yokken çizilir");
  const paid = buildCashPlan(input({ tax: ready, reminders: [active], vatPaid: deleted }));
  assert.equal(lineAt(paid, "vergi:gecici").length, 0);
  assert.ok(!paid.unknownAmounts.some((u) => u.reminderId === g.id), "ödenmiş dönem 'Tutarı girilmemiş'te de değil");
  // Hatırlatıcısız kipte de
  assert.equal(lineAt(buildCashPlan(input({ tax: ready, vatPaid: deleted })), "vergi:gecici").length, 0, "silinmiş hatırlatıcının kalıcı kaydı");
  // Başka türün (KDV) kaydı geçici vergiyi kapatmaz
  assert.equal(lineAt(buildCashPlan(input({ tax: ready, reminders: [active], vatPaid: [{ ...deleted[0], kind: "kdv", periods: ["2026-09"] }] })), "vergi:gecici").length, 1);
});

test("vergi: ödenince kapanan (etkin olmayan) muhtasar ve geçici vergi hatırlatıcısının dönemi ödenmiş sayılır", () => {
  const today = "2026-11-10";
  const filed = taxFeed(model, [{ id: 1, kind: "gecici", period: "2026-Q3", payable: 41_200, stamp: 791, values: {} }]);
  // Tek seferlikler 5 ve 8 Kasım'da "Ödendi": pasif; geçici verginin kalıcı kaydı çeyrekle
  const g = geciciRem({ title: "Geçici vergi 2026/3", amount: 41_991, repeat: "none", active: false });
  const m = muhtasarRem({ title: "Muhtasar (Ekim)", amount: 980, dueDate: "2026-11-26", repeat: "none", active: false });
  const paidReminders = [
    { id: g.id, dueDate: "2026-11-17", next: null, amount: 41_991 },
    { id: m.id, dueDate: "2026-11-26", next: null, amount: 980 },
  ];
  const vatPaid: VatPaidEntry[] = [{ id: g.id, kind: "gecici", dueDate: "2026-11-17", next: null, periods: ["2026-Q3"], amount: 41_991, at: "2026-11-05T10:00:00.000Z" }];
  const keys = (p: CashPlan) => taxLines(p).filter((l) => /^vergi:(gecici|muhtasar)@2026-11-(17|26)$/.test(l.key)).map((l) => l.key);
  // Hatırlatıcısız kip: beslemenin satırı yok
  assert.deepEqual(keys(buildCashPlan(input({ today, tax: filed, reminders: [g, m] }))), ["vergi:gecici@2026-11-17", "vergi:muhtasar@2026-11-26"], "ödenmemişken çizilir");
  assert.deepEqual(keys(buildCashPlan(input({ today, tax: filed, reminders: [g, m], paidReminders, vatPaid }))), []);
  // Yalnız son ödenenlerde (30 gün) olsa da
  assert.deepEqual(keys(buildCashPlan(input({ today, tax: filed, reminders: [g, m], paidReminders }))), []);
  // Hatırlatıcı kipi: sınıfın etkin, tutarsız hatırlatıcısı o dönemi çizmez, listeye de koymaz
  const ga = geciciRem();
  const ma = muhtasarRem({ dueDate: "2026-11-26" });
  const open = buildCashPlan(input({ today, tax: filed, reminders: [g, m, ga, ma] }));
  assert.deepEqual(
    taxLines(open).map((l) => [l.key, l.amount]),
    [
      ["vergi:gecici@2026-11-17", 41_991],
      ["vergi:muhtasar@2026-11-26", 974.38],
    ],
  );
  const paid = buildCashPlan(input({ today, tax: filed, reminders: [g, m, ga, ma], paidReminders, vatPaid }));
  assert.deepEqual(taxLines(paid).filter((l) => l.key.startsWith("vergi:gecici") || l.key.startsWith("vergi:muhtasar")), []);
  assert.ok(!paid.unknownAmounts.some((u) => u.reminderId === ga.id || u.reminderId === ma.id));
});

test("vergi (I-3): 'vergi' kapalı: tahmin ve damga yok, kesinler kalır, tutarsız muhtasar listede; Tahmine katılanlar ve not", () => {
  const r = muhtasarRem();
  const known = rem({ title: "Geçici vergi beyanı ve ödemesi", kind: "vergi", amount: 40_000, dueDate: "2026-11-17", repeat: "quarterly" });
  const p = buildCashPlan(input({ vat, vatAnchor: { month: "2026-09", amount: 121_204.69 }, tax: FEED, excluded: ["vergi"], reminders: [r, known] }));
  assert.equal(taxLines(p).length, 0);
  assert.equal(lineAt(p, "damga:").length, 0);
  assert.deepEqual(lineAt(p, `reminder:${known.id}@`).map((l) => l.amount), [40_000]);
  assert.ok(p.unknownAmounts.some((u) => u.reminderId === r.id));
  const row = p.estimates.find((e) => e.key === "vergi")!;
  assert.equal(row.status, "off");
  assert.equal(row.title, "Muhtasar, geçici vergi ve damga");
  assert.equal(planNotes(p, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 }).find((n) => n.key === "vergi")!.text, "Muhtasar, geçici vergi ve beyanname damgaları plana katılmıyor (Tahmine katılanlar'dan açın).");
  // Açıkken: sıradaki muhtasar ve geçici vergi notta; kayıtlı durumda "vergi" anahtarı kalır
  const on = buildCashPlan(input({ tax: FEED }));
  const est = on.estimates.find((e) => e.key === "vergi")!;
  assert.equal(est.status, "on");
  assert.equal(est.monthly, 974.38);
  assert.match(est.note!, /^Ayın 26'sında muhtasar \(en az 974\s₺\) · 17\sKasım geçici vergi: tutarı muhasebecinizden$/);
  assert.equal(
    planNotes(on, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 }).find((n) => n.key === "vergi")!.text,
    "Muhtasar (ücret gelir ve damga vergisi, işaretli stopajlar, beyanname damgası) ayın 26'sında, Vergi sayfasının tahminiyle; stopajı bilinmeyen kalem varsa 'en az'. Geçici vergi yalnız tutarı Ödemeler'e ya da Vergi'ye yazıldıysa (ya da çeyreğin hesabı hazırsa) Şubat, Mayıs, Ağustos ve Kasım'ın 17'sinde; yoksa 'Tutarı girilmemiş ödemeler'de. KDV beyannamelerinin damgası (791 ₺) ayrı satır; tutarı yazılmış KDV hatırlatıcısı damga dahil sayılır.",
  );
  assert.ok(EXCLUDABLE_KEY.test("vergi"));
  assert.deepEqual(parseCashPlanState({ excluded: ["vergi", "kdv", "vergi:x"] }).excluded, ["vergi", "kdv"]);
  // Bütün dönemler hatırlatıcıdaki tutarla kesin: "Ödemeler'de karşılığı var"
  const covered = buildCashPlan(input({ tax: { ...FEED, items: [], pending: [] }, reminders: [rem({ title: "Muhtasar ve prim hizmet beyannamesi", kind: "vergi", amount: 1_200, dueDate: "2026-10-26", repeat: "none" })] }));
  assert.equal(covered.estimates.find((e) => e.key === "vergi")!.status, "covered");
  // Besleme yoksa satır da yok
  assert.equal(buildCashPlan(input()).estimates.some((e) => e.key === "vergi"), false);
});

test("vergi (I-4): KDV beyannamesinin damgası tahmin satırının gününde (ödenecek 0 olsa da); yalnız damga ya da tutarı yazılı hatırlatıcı varken yok", () => {
  const base = { vat, vatAnchor: { month: "2026-09", amount: 121_204.69 }, tax: FEED };
  const p = buildCashPlan(input(base));
  // Eylül'ün KDV'si devredenle 0: satır yok, damgası var
  assert.equal(byKey(p, "kdv@2026-10-28").length, 0);
  const [stamp] = byKey(p, "damga:kdv@2026-10-28");
  assert.deepEqual([stamp.title, stamp.amount, stamp.estimated, stamp.kind], ["Damga vergisi (Eylül KDV beyannamesi)", 791, false, "vergi"]);
  assert.deepEqual(byKey(p, "damga:kdv@2026-11-28").map((l) => l.title), ["Damga vergisi (Ekim KDV beyannamesi)"]);
  // "Eylül KDV damga vergisi" başlıklı, tutarlı hatırlatıcı: o ayın damga satırını o çizer
  const only = rem({ title: "Eylül KDV damga vergisi", kind: "vergi", amount: 791, dueDate: "2026-10-28", repeat: "none" });
  const withStamp = buildCashPlan(input({ ...base, reminders: [only] }));
  assert.equal(byKey(withStamp, "damga:kdv@2026-10-28").length, 0);
  assert.deepEqual(lineAt(withStamp, `reminder:${only.id}@`).map((l) => l.amount), [791]);
  assert.equal(byKey(withStamp, "damga:kdv@2026-11-28").length, 1, "öteki ay");
  // Tutarı yazılmış "KDV Eylül" (başlıkta damga yok): tahakkuk fişinin toplamı, damga dahil
  const k = kdvRem({ title: "KDV Eylül", amount: 5_000, repeat: "none" });
  const written = buildCashPlan(input({ ...base, reminders: [k] }));
  assert.equal(byKey(written, "damga:kdv@2026-10-28").length, 0);
  assert.deepEqual(lineAt(written, `reminder:${k.id}@`).map((l) => [l.amount, l.detail]), [[5_000, "Tutar tahakkuk fişinin toplamı sayıldı (damga dahil)."]]);
  // KDV tahmine katılmıyorsa ya da besleme yoksa damga da yok
  assert.equal(lineAt(buildCashPlan(input({ ...base, excluded: ["kdv"] })), "damga:kdv@").length, 0);
  assert.equal(lineAt(buildCashPlan(input({ ...base, tax: null })), "damga:").length, 0);
  assert.equal(lineAt(buildCashPlan(input({ ...base, excluded: ["vergi"] })), "damga:").length, 0);
});

test("vergi (I-5): SGK yasal oranlarla (Eylül 25.956,18); not ve satırın yasal son günü", () => {
  const base = planInputFromModel(model, TODAY);
  close(base.months["2026-09"].payroll.sgk, 25_956.18, "Eylül SGK", 0.005);
  const p = buildCashPlan(input({ ...base, tax: FEED }));
  const [sgk] = byKey(p, "sgk@2026-10-31");
  close(sgk.amount, 25_956.18, "satır", 0.005);
  assert.equal(sgk.detail, "Son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)");
  assert.equal(byKey(p, "sgk@2026-11-30")[0].detail, "Son gün 30 Kasım Pazartesi");
  const notes = planNotes(p, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.equal(
    notes.find((n) => n.key === "sgk")!.text,
    "İşçi ve işveren SGK + işsizlik payları (ayda 25.956\u00a0₺), takip eden ayın son günü. Brüt, gelir ve damga vergisiyle; 2026 yasal oranlarıyla (işveren %19,75 + %2) hesaplanır; vergiler muhtasar satırındadır.",
  );
  assert.equal(
    notes.find((n) => n.key === "excluded")!.text,
    "Tutarı girilmemiş yerel vergiler (ÇTV, ilan reklam), kurumlar vergisi, Aylık harcamalar'da her ay girilmeyen (tek seferlik) ödemeler (cari borçların gider kayıtları dahil), yıllık giderler (ModPOS / Patron aboneliği), yatırım ve kredi.",
  );
  // Besleme yoksa satırda yasal gün yazmaz (bugünkü gibi)
  assert.equal(byKey(buildCashPlan(input({ ...base })), "sgk@2026-10-31")[0].detail, undefined);
  // Elle işveren oranı (teşvik): bordro ve not onu kullanır
  const manual = planInputFromModel(model, TODAY, { ...DEFAULT_TAX_SETTINGS, overrides: { "sgk.isverenOran": { value: 0.1575, note: "5 puan teşvik", by: "Yönetici", date: "2026-10-22" } } });
  assert.deepEqual(manual.sgkRates, { year: 2026, isveren: 0.1575, issizlik: 0.02 });
  assert.ok(manual.months["2026-09"].payroll.sgk < base.months["2026-09"].payroll.sgk);
});

test("kira resmi kirayla (sahibin kararı, 4 Kasım 2026): ev sahibine 160.000 kesintisiz; stopaj resmi brütten 20.000, 'Muhtasar – kira stopajı' satırı 26'sında", () => {
  const official = createModel({
    ...ds,
    fixedExpenses: ds.fixedExpenses.map((f) => (f.name === "Kira" ? { ...f, taxWithholding: "kira" as const, vatRate: 0, officialAmount: 100_000, officialBasis: "brut" as const, prorate: false } : f)),
  });
  const base = planInputFromModel(official, TODAY);
  const kiraFixed = base.months["2026-11"].fixed.find((f) => f.name === "Kira")!;
  assert.equal(kiraFixed.withholding, undefined, "stopaj ödemeden kesilmez");
  const p = buildCashPlan(input({ ...base, tax: taxFeed(official) }));
  assert.equal(p.estimates.find((e) => e.title === "Kira")!.monthly, 160_000);
  const line = p.weeks.flatMap((w) => w.lines).find((l) => l.key === "vergi:muhtasar_kira@2026-11-26")!;
  assert.equal(line.title, "Muhtasar – kira stopajı (Ekim)");
  close(line.amount, 20_000, "resmi brüt 100.000 × %20");
  assert.match(line.detail!, /^Kira: resmi brüt 100\.000 × %20\./);
});

test("vergi (I-6): stopajlı sabit gider net ödenir (kira 160.000 → 128.000; SMM 10.000 + KDV − stopaj); stopaj muhtasarda, toplam brütü aşmaz", () => {
  const withheld = createModel({
    ...ds,
    fixedExpenses: ds.fixedExpenses.map((f) =>
      f.name === "Kira" ? { ...f, taxWithholding: "kira" as const, vatRate: 0 } : f.name === "Muhasebeci" ? { ...f, taxWithholding: "serbest_meslek" as const, vatRate: 0.2 } : f,
    ),
  });
  const base = planInputFromModel(withheld, TODAY);
  const fixed = base.months["2026-11"].fixed;
  assert.deepEqual(
    fixed.filter((f) => f.withholding).map((f) => [f.name, f.withholding, f.withholdingRate, f.vatRate]),
    [
      ["Kira", "kira", 0.2, 0],
      ["Muhasebeci", "serbest_meslek", 0.2, 0.2],
    ],
  );
  const feed = taxFeed(withheld);
  const p = buildCashPlan(input({ ...base, tax: feed }));
  const est = (title: string) => p.estimates.find((e) => e.title === title)!;
  assert.equal(est("Kira").monthly, 128_000);
  assert.equal(est("Kira").note, "ay içine yayılır · 160.000\u00a0₺ brüt, stopaj %20 muhtasarda");
  close(est("Muhasebeci").monthly, 10_000, "SMM: 10.000 + %20 KDV − %20 stopaj");
  // Kasım'ın bütün günleri ufukta: yayılan kira 128.000; stopaj (32.000) Ekim muhtasarıyla 26 Kasım'da, ayrı satır
  // ("Muhtasar – kira stopajı"; sahibin kararı, 4 Kasım 2026): genel muhtasar satırında yok, iki kez sayılmaz
  const nov = (key: string) => p.weeks.flatMap((w) => w.lines).filter((l) => l.key === key);
  const muhtasarNov = nov("vergi:muhtasar@2026-11-26")[0];
  assert.match(muhtasarNov.detail!, /Ücret GV [\d.,]+ \+ DV [\d.,]+ \+ Muhasebeci stopajı 2\.000/);
  assert.doesNotMatch(muhtasarNov.detail!, /Kira stopajı 32/);
  close(muhtasarNov.amount, 974.38 + 2_000, "muhtasar: ücret vergileri + damga + muhasebeci stopajı");
  const kiraStopajNov = nov("vergi:muhtasar_kira@2026-11-26")[0];
  assert.equal(kiraStopajNov.title, "Muhtasar – kira stopajı (Ekim)");
  close(kiraStopajNov.amount, 32_000, "kira stopajı ayrı satır");
  const kiraNov = p.weeks.flatMap((w) => w.lines.filter((l) => l.key === "fixed")).map((l) => l.detail!);
  assert.ok(kiraNov.every((d) => d.includes("Kira 160.000\u00a0₺ brüt · stopaj %20 muhtasarda · ödenen 128.000\u00a0₺")));
  assert.match(planNotes(p, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 }).find((n) => n.key === "fixed")!.text, /Stopajlı kalemde \(Vergi'de seçilen; şahsa kira, serbest meslek\) ödemeden kesilen stopaj düşüldü, muhtasar satırındadır\./);
  // Tutarsız "Kira" hatırlatıcısı giderin net tutarını taşır
  const kira = rem({ title: "Kira", kind: "kira", amount: null, dueDate: "2026-11-01" });
  const carried = buildCashPlan(input({ ...base, reminders: [kira] }));
  assert.deepEqual(
    lineAt(carried, `reminder:${kira.id}@2026-11-01`).map((l) => [l.amount, l.detail]),
    [[128_000, "Sabit giderdeki tutar; Kira 160.000\u00a0₺ brüt · stopaj %20 muhtasarda · ödenen 128.000\u00a0₺"]],
  );
  // "Sabit giderlerden ekle" net tutarı yazar; 128.000 tutarlı hatırlatıcı "farklı tutar" uyarısı vermez (E-46)
  const f = withheld.ds.fixedExpenses.find((x) => x.name === "Kira")!;
  const rated = { ...f, withholdingRate: 0.2 };
  assert.equal(fixedReminderAt(rated, [], "2026-11").amount, 128_000);
  const r128 = { ...kira, amount: 128_000 };
  assert.deepEqual(fixedReminderDrifts([r128], [{ ...rated, startMonth: null, endMonth: null }], [], TODAY), []);
  assert.equal(fixedReminderDrifts([r128], [{ ...f, startMonth: null, endMonth: null }], [], TODAY).length, 1, "stopajsız kalemde 160.000 beklenir");
  assert.equal(lineAt(buildCashPlan(input({ ...base, reminders: [r128] })), `reminder:${kira.id}@2026-11-01`)[0].detail, undefined);
  // P4: vergi beslemesi alınamadıysa (loadCashPlan, feed: false) stopaj ve KDV-2 satırı yok: kalem brüt, faturasının KDV'siyle
  const gross = planInputFromModel(withheld, TODAY, DEFAULT_TAX_SETTINGS, { feed: false }).months["2026-11"].fixed;
  assert.deepEqual(
    gross.filter((f) => f.name === "Kira" || f.name === "Muhasebeci").map((f) => [f.name, f.withholding, f.withholdingRate, f.vatRate]),
    [
      ["Kira", undefined, undefined, 0],
      ["Muhasebeci", undefined, undefined, 0.2],
    ],
  );
  const noFeed = buildCashPlan(input({ ...base, months: planInputFromModel(withheld, TODAY, DEFAULT_TAX_SETTINGS, { feed: false }).months, tax: null }));
  assert.equal(noFeed.estimates.find((e) => e.title === "Kira")!.monthly, 160_000);
});

test("vergi (I-7): yurt dışı hizmetin KDV-2'si ayın 25'inde, damgasıyla; dönemi karşılayan tutarlı KDV-2 hatırlatıcısı varken yok", () => {
  const ig = createModel({ ...ds, fixedExpenses: ds.fixedExpenses.map((f) => (f.name === "Instagram reklamı" ? { ...f, taxWithholding: "internet_reklam_yurtdisi" as const } : f)) });
  const feed = taxFeed(ig);
  const base = planInputFromModel(ig, TODAY);
  // Yabancı firmaya ödenen tutar olduğu gibi: stopaj kesilmez (muhtasarda), Türk KDV'si yok (KDV-2 ayrı satırda)
  const igItem = base.months["2026-11"].fixed.find((f) => f.name === "Instagram reklamı")!;
  assert.deepEqual([igItem.withholding, igItem.withholdingRate, igItem.vatRate], ["internet_reklam_yurtdisi", 0, 0]);
  const p = buildCashPlan(input({ ...base, tax: feed }));
  // Ayda bir 30.000 satırı ve bir 6.000 KDV-2 satırı: %20 iki kez sayılmaz
  const igRow = p.estimates.find((e) => e.title === "Instagram reklamı")!;
  assert.deepEqual([igRow.monthly, igRow.note], [30_000, "ay içine yayılır"]);
  assert.deepEqual(byKey(p, "vergi:kdv2_hizmet@2026-11-25").map((l) => [l.title, l.amount]), [["KDV-2: yurt dışı hizmet (Ekim)", 6_000]]);
  // "Sabit giderlerden ekle" ve E-46 karşılaştırması da KDV'siz tutarı bekler (yurt dışı hizmet de)
  const igFixed = ig.ds.fixedExpenses.find((f) => f.name === "Instagram reklamı")!;
  assert.equal(fixedReminderAt(paidFixedRates(igFixed, 2026), [], "2026-11").amount, 30_000);
  assert.equal(fixedReminderAt(paidFixedRates({ ...igFixed, taxWithholding: "yurt_disi_hizmet" as const }, 2026), [], "2026-11").amount, 30_000);
  assert.equal(fixedReminderAt(paidFixedRates({ ...igFixed, taxWithholding: "yok" as const }, 2026), [], "2026-11").amount, 36_000, "Türkiye'deki firmaya KDV'siyle");
  assert.deepEqual(fixedReminderDrifts([rem({ title: "Instagram reklamı", kind: "odeme", amount: 30_000, dueDate: "2026-11-05" })], [{ ...paidFixedRates(igFixed, 2026), startMonth: null, endMonth: null }], [], TODAY), []);
  const [line] = byKey(p, "vergi:kdv2_hizmet@2026-10-25");
  assert.deepEqual([line.title, line.amount, line.estimated], ["KDV-2: yurt dışı hizmet (Eylül)", 6_000, true]);
  assert.match(line.detail!, /Instagram reklamı 30\.000 × %20/);
  assert.deepEqual(byKey(p, "damga:kdv2@2026-10-25").map((l) => [l.title, l.amount]), [["Damga vergisi (Eylül KDV-2 beyannamesi)", 791]]);
  assert.match(byKey(p, "vergi:muhtasar@2026-10-26")[0].detail!, /Instagram reklamı stopajı 4\.500/);
  // Tutarlı KDV-2 hatırlatıcısı Eylül'ü karşılıyor: tahakkuk fişi hizmetin KDV'sini de içerir
  const k2 = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: 6_000, dueDate: "2026-10-25" });
  const covered = buildCashPlan(input({ ...base, tax: feed, reminders: [k2] }));
  assert.equal(byKey(covered, "vergi:kdv2_hizmet@2026-10-25").length, 0);
  assert.equal(byKey(covered, "damga:kdv2@2026-10-25").length, 0);
  assert.deepEqual(lineAt(covered, `reminder:${k2.id}@2026-10-25`).map((l) => [l.amount, l.detail]), [[6_000, "Tutar tahakkuk fişinin toplamı sayıldı (damga dahil)."]]);
  // Tutarsız KDV-2 hatırlatıcısı: o dönemin tahmini (faturalardaki tevkifat + hizmet) onun gününde
  const open = buildCashPlan(input({ ...base, tax: feed, reminders: [{ ...k2, amount: null }] }));
  const [carried] = lineAt(open, `reminder:${k2.id}@2026-10-25`);
  assert.deepEqual([carried.amount, carried.estimated, carried.title], [6_000, true, "KDV2 beyannamesi (Eylül)"]);
  assert.equal(byKey(open, "vergi:kdv2_hizmet@2026-10-25").length, 0);
  assert.equal(byKey(open, "damga:kdv2@2026-10-25").length, 1);
});

test("vergi (I-8): hatırlatıcı sınıfı: muhtasar, SGK, geçici vergi; stopaj muhtasardır, yalnız damga diğerdir", () => {
  const m = muhtasarRem();
  const sgk = rem({ title: "SGK prim ödemesi", kind: "vergi", amount: null, dueDate: "2026-10-31" });
  const g = geciciRem();
  const stopaj = rem({ title: "Kira stopajı", kind: "vergi", amount: null, dueDate: "2026-10-26" });
  const damga = rem({ title: "KDV damga vergisi", kind: "vergi", amount: null, dueDate: "2026-10-28" });
  const p = buildCashPlan(input({ months: monthsWith(), tax: FEED, reminders: [m, sgk, g, stopaj, damga] }));
  // Muhtasar: beslemenin tutarı onun gününde; ikinci muhtasar sınıfı hatırlatıcı ("Kira stopajı") dönemi alamaz
  assert.deepEqual(taxLines(p).filter((l) => l.key.startsWith("vergi:muhtasar")).map((l) => l.date), ["2026-10-26", "2026-11-26"]);
  // SGK: bordronun tutarını taşır
  assert.deepEqual(lineAt(p, `reminder:${sgk.id}@`).map((l) => [l.kind, l.amount]), [
    ["sgk", 23_118],
    ["sgk", 23_118],
  ]);
  const unknownOf = (id: number) => p.unknownAmounts.find((u) => u.reminderId === id);
  // Geçici vergi: taslak çeyrekte notuyla listede; stopaj (muhtasarın dönemi alınmış) ve yalnız damga listede, notsuz
  assert.equal(unknownOf(g.id)!.note, "Geçici vergi 2026/3: şirketin beyannamesi; tutarı muhasebecinizden isteyin (son gün 17.11)");
  assert.equal(unknownOf(stopaj.id)!.note, undefined);
  assert.equal(unknownOf(damga.id)!.note, undefined);
  assert.equal(p.basis.sgkMode, "carrier");
  // Yalnız damga KDV değildir: KDV tahmini hatırlatıcısız kipte kalır
  assert.equal(p.vat, null);
});

test("vergi: geçici verginin 'Ödendi' kaydı çeyrekle (payments.vat-paid, tür gecici); KDV'ninki ayla kalır", () => {
  const g = geciciRem({ dueDate: "2026-11-17", anchorDate: "2026-11-17" });
  assert.deepEqual(paidPeriodsOf(g, "2026-11-17", "2027-02-17", "gecici"), ["2026-Q3"]);
  // "Tarihe kadar ödendi" iki dönemi kapatır; ertelenmiş kopyanın dönemi asıl gününden
  assert.deepEqual(paidPeriodsOf(g, "2026-11-17", "2027-05-17", "gecici"), ["2026-Q3", "2026-Q4"]);
  assert.deepEqual(paidPeriodsOf({ ...g, repeat: "none", note: postponeNote(null, "2026-11-17") }, "2026-11-30", null, "gecici"), ["2026-Q3"]);
  assert.deepEqual(paidPeriodsOf(kdvRem(), "2026-10-28", "2026-11-28"), ["2026-09"]);
  const at = "2026-11-10T10:00:00.000Z";
  const ok = { id: 3, kind: "gecici", dueDate: "2026-11-17", next: "2027-02-17", periods: ["2026-Q3"], amount: 41_991, at };
  assert.deepEqual(parseVatPaid([ok, { ...ok, periods: ["2026-09"] }, { ...ok, kind: "kdv", periods: ["2026-Q3"] }, { ...ok, kind: "kv" }]), [ok]);
});


// ---------------------------------------------------------------- Denetim 13 Kasım (P09)

test("VG-01: vergi beslemesiyle KDV hatırlatıcısına (ya da Ödendi'ye) yalnız damga (791) yazılınca devreden silinmez", () => {
  // Eylül devredeni 140.200 (39.200 − 11.900 − 167.500); Ekim 51.800 − 9.700 − 140.200 < 0: ödeme yok
  const r = kdvRem({ amount: 791 });
  const p = withVat({ reminders: [r], tax: FEED });
  assert.deepEqual(
    lineAt(p, `reminder:${r.id}@`).map((l) => [l.date, l.amount, l.detail]),
    [["2026-10-28", 791, STAMP_INCLUDED]],
  );
  const [sep, oct] = p.vat!.rows;
  assert.deepEqual([sep.period, sep.source, sep.amount, sep.estimate!.carryOut], ["2026-09", "reminder", 791, 140_200]);
  assert.deepEqual([oct.period, oct.estimate!.carryIn, oct.amount], ["2026-10", 140_200, 0]);
  assert.equal(lineAt(p, "kdv@").length, 0, "Ekim'de olmayan KDV ödemesi çıkmaz");
  // "Ödendi" 791 ile: aynı
  const paid = withVat({ reminders: [kdvRem({ id: r.id, dueDate: "2026-11-28" })], tax: FEED, paidReminders: [{ id: r.id, dueDate: "2026-10-28", next: "2026-11-28", amount: 791 }] });
  const row = paid.vat!.rows.find((x) => x.period === "2026-10")!;
  assert.deepEqual([row.estimate!.carryIn, row.amount], [140_200, 0]);
  // Damgayı aşan tutar KDV ödemesidir: Ekim 51.800 − 9.700 = 42.100 ödenir
  const real = withVat({ reminders: [kdvRem({ id: r.id, amount: 27_300 })], tax: FEED });
  assert.deepEqual(lineAt(real, "kdv@").map((l) => [l.date, l.amount]), [["2026-11-28", 42_100]]);
});

/** Kira kaleminin resmi brütü 100.000 (0052 sonrası): tahminde kira stopajı 20.000 ayrı satır */
const officialRent = createModel({ ...ds, fixedExpenses: ds.fixedExpenses.map((f) => (f.name === "Kira" ? { ...f, officialAmount: 100_000, officialBasis: "brut" as const } : f)) });

test("VG-02: sabit tutarlı 'Kira stopajı' muhtasarın yalnız kira stopajının yerine geçer; kalanı aynı gün girer", () => {
  const feed = taxFeed(officialRent);
  const muhtasarLines = (p: CashPlan) => taxLines(p).filter((l) => l.key.startsWith("vergi:muhtasar")).map((l) => [l.title, l.date, l.amount]);
  // Hatırlatıcı yok: kira stopajı 20.000 ayrı satır + kalan 974,38 (DV 34,68 + damga 939,70)
  assert.deepEqual(muhtasarLines(buildCashPlan(input({ tax: feed }))), [
    ["Muhtasar – kira stopajı (Eylül)", "2026-10-26", 20_000],
    ["Muhtasar (Eylül)", "2026-10-26", 974.38],
    ["Muhtasar – kira stopajı (Ekim)", "2026-11-26", 20_000],
    ["Muhtasar (Ekim)", "2026-11-26", 974.38],
  ]);
  // Eski "Sabit giderlerden ekle" hatırlatıcısı 20.000: kira stopajı satırının yerine, kalan yine girer (toplam aynı)
  const kira = rem({ title: "Kira stopajı (resmi 100.000 TL x %20)", kind: "vergi", amount: 20_000, dueDate: "2026-10-26" });
  const p = buildCashPlan(input({ tax: feed, reminders: [kira] }));
  assert.deepEqual(lineAt(p, `reminder:${kira.id}@`).map((l) => [l.date, l.amount]), [
    ["2026-10-26", 20_000],
    ["2026-11-26", 20_000],
  ]);
  assert.deepEqual(muhtasarLines(p), [
    ["Muhtasar (Eylül)", "2026-10-26", 974.38],
    ["Muhtasar (Ekim)", "2026-11-26", 974.38],
  ]);
  assert.match(byKey(p, "vergi:muhtasar@2026-10-26")[0].detail!, /^Ücret GV 0 \+ DV 34,68 \+ damga 939,70; en az \(3 kalemin stopajı bilinmiyor\)\..* Kira stopajı Ödemeler'deki hatırlatıcıda\.$/);
  // Tutarsız muhtasar hatırlatıcısı da varsa kalan onun gününde, bir kez
  const m = muhtasarRem({ dueDate: "2026-10-27" });
  assert.deepEqual(muhtasarLines(buildCashPlan(input({ tax: feed, reminders: [kira, m] }))), [
    ["Muhtasar (Eylül)", "2026-10-27", 974.38],
    ["Muhtasar (Ekim)", "2026-11-27", 974.38],
  ]);
  // Muhasebecinin rakamı (Eylül 25.000 + damga 939,70): hatırlatıcının tutarı düşülür, kalan 5.939,70; Ekim tahmin
  const filing: TaxFiling = { id: 1, kind: "mphb", period: "2026-09", payable: 25_000, stamp: 939.7, values: {} };
  const f = buildCashPlan(input({ tax: taxFeed(officialRent, [filing]), reminders: [kira] }));
  const [sep] = byKey(f, "vergi:muhtasar@2026-10-26");
  assert.deepEqual([sep.amount, sep.badge], [5_939.7, "Muhasebeci"]);
  assert.match(sep.detail!, /Kira stopajı \(20\.000\s₺\) Ödemeler'de ayrı satırda; burada düşüldü\.$/);
  assert.equal(byKey(f, "vergi:muhtasar@2026-11-26")[0].amount, 974.38);
  // Tutarı muhtasarın tamamı olan hatırlatıcı (başlıkta "muhtasar") dönemi yine sahiplenir
  const whole = muhtasarRem({ amount: 21_000 });
  assert.deepEqual(muhtasarLines(buildCashPlan(input({ tax: feed, reminders: [whole] }))), [
    ["Muhtasar – kira stopajı (Ekim)", "2026-11-26", 20_000],
    ["Muhtasar (Ekim)", "2026-11-26", 974.38],
  ]);
});

test("VG-02: 'Muhtasar' hatırlatıcısında muhtasarın tamamı varken 'Kira stopajı' iki kez sayılmaz; 26 Kasım toplamı takvimdeki gibi", () => {
  // Muhasebecinin Ekim muhtasarı 21.000 + damga 939,70 (kira stopajı dahil) "Muhtasar" hatırlatıcısına da yazıldı
  const today = "2026-11-13";
  const filing: TaxFiling = { id: 1, kind: "mphb", period: "2026-10", payable: 21_000, stamp: 939.7, values: {} };
  const kira = rem({ title: "Kira stopajı", kind: "vergi", amount: 20_000, dueDate: "2026-11-26" });
  const whole = rem({ title: "Muhtasar", kind: "vergi", amount: 21_939.7, dueDate: "2026-11-26" });
  const onDay = (p: CashPlan) => lines(p).filter((l) => l.date === "2026-11-26" && /muhtasar|stopaj/i.test(l.title));
  for (const filings of [[filing], []]) {
    const p = buildCashPlan(input({ today, tax: taxFeed(officialRent, filings, today), reminders: [kira, whole] }));
    // Kira stopajı kendi satırında, tamamdan düşülür: 20.000 + 1.939,70 = 21.939,70
    assert.deepEqual(onDay(p).map((l) => [l.key, l.amount]), [
      [`reminder:${kira.id}@2026-11-26`, 20_000],
      [`reminder:${whole.id}@2026-11-26`, 1_939.7],
    ]);
    assert.equal(r2(onDay(p).reduce((a, l) => a + l.amount, 0)), 21_939.7);
    assert.match(byKey(p, `reminder:${whole.id}@2026-11-26`)[0].detail!, /^Kira stopajı \(20\.000\s₺\) Ödemeler'de ayrı satırda; burada düşüldü \(hatırlatıcıdaki tutar 21\.939,70\s₺\)\.$/);
    assert.equal(taxLines(p).filter((l) => l.key.startsWith("vergi:muhtasar")).length, 0, "dönem Ödemeler'deki tutarındır");
  }
  // Muhasebecinin rakamı farklıysa (K4) satır ikisini de söyler
  const off = buildCashPlan(input({ today, tax: taxFeed(officialRent, [filing], today), reminders: [kira, { ...whole, amount: 22_500 }] }));
  const [line] = byKey(off, `reminder:${whole.id}@2026-11-26`);
  assert.equal(line.amount, 2_500);
  assert.match(line.detail!, /^Muhasebecinin rakamı 21\.939,70\s₺, Ödemeler'deki tutar 22\.500\s₺.* Kira stopajı \(20\.000\s₺\) Ödemeler'de ayrı satırda; burada düşüldü/);
});

test("VG-01: KDV damgası dönemin beyannamesinin yılınınki (Vergi takvimi gibi), bugünün yılınınki değil", () => {
  // Elle girilen 2027 damgası (1.000) yalnız 2027'de verilen beyannamelerin (Aralık 2026 ve sonrası) damgasıdır
  const settings = { ...DEFAULT_TAX_SETTINGS, overrides: { "damga.beyanname.kdv": { value: 1_000, note: "2027 tarifesi", by: "Yönetici", date: "2026-12-20" } } };
  const today = "2026-12-20";
  const pnl = taxPnlInputFromModel(model, { settings, today, adjustments: [], assets: [], filings: [] });
  const feed = buildTaxView({ today, settings, pnl, muhtasarItems: new Map(), filings: [], reminders: [], vat: null }).planFeed;
  assert.deepEqual(feed.stamps, { kdv: 791, kdv2: 791, kdvByYear: { 2026: 791, 2027: 1_000 } });
  // 2027'de bakılıyor gibi (bugünün damgası 1.000): Eylül'e yazılan 900 Eylül'ün damgasını (791) aşar, KDV ödemesidir
  const late: TaxPlanFeed = { ...FEED, stamps: { kdv: 1_000, kdv2: 1_000, kdvByYear: { 2026: 791, 2027: 1_000 } } };
  const p = withVat({ reminders: [kdvRem({ amount: 900 })], tax: late });
  assert.equal(p.vat!.rows.find((x) => x.period === "2026-09")!.estimate!.carryOut, 0);
  assert.deepEqual(lineAt(p, "kdv@").map((l) => [l.date, l.amount]), [["2026-11-28", 42_100]]);
  // Ekim beyannamesinin damga satırı da 2026'nınki
  assert.deepEqual(lineAt(p, "damga:kdv@").map((l) => [l.date, l.amount]), [["2026-11-28", 791]]);
});
