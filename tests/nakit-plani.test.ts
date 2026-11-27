// Nakit planı (docs/NAKIT-PLANI.md): 6 haftalık dilimler, satış ve online tahmini, faturalar ve hatırlatıcılar,
// maaş / SGK / sabit gider / mal alımı tahminleri ve hatırlatıcı eşleşmesi, bakiye ve "gereken en az para", Excel
// verisinden girdiler, metinler ve ekranın kuralları. Vergi ve KDV tahmini yok (Vergi bölümü 27 Kasım 2026'da kaldırıldı):
// vergi hatırlatıcıları düz hatırlatıcıdır; bordro (SGK) ve stopaj src/lib/bordro'dan.
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
  planCashReports,
  planInputFromModel,
  planNotes,
  rangeText,
  reminderOccurrences,
  salesDaily,
  weekTitle,
  type CashPlan,
  type CashPlanInput,
  type PlanLine,
} from "../src/lib/cash-plan";
import { DEFAULT_PAYROLL_SETTINGS } from "../src/lib/bordro/settings";
import { paidFixedRates } from "../src/lib/bordro/stopaj";
import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import {
  addDays,
  daysBetween,
  FIXED_REMINDER_NOTE,
  fixedReminderAt,
  UPCOMING_HORIZON_DAYS,
  type ReminderRow,
  type UpcomingItem,
} from "../src/lib/reminders";
import { canOpen } from "../src/lib/roles";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const ds: Dataset = { ...datasetFromSeed(data), currentMonth: "2026-10" };
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
    settings: { komisyon: 0.025, kartOrani: 0.8, acikGun: 30 },
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
  const settings = { komisyon: 0.025, kartOrani: 0.5, acikGun: 26 };
  const p = buildCashPlan(input({ cashReports: [...reports, ...noise], settings }));
  assert.deepEqual(p.basis.sales, { kind: "kasa", reports: 10, days: 10, daily: 10_000, cardShare: 0.8, platformShare: 0 });
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
  const settings = { komisyon: 0.025, kartOrani: 0.8, acikGun: 26 };
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
  const settings = { komisyon: 0.025, kartOrani: 0.8, acikGun: 30 };
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

// ---------------------------------------------------------------- Vergi hatırlatıcıları (vergi tahmini yok)

test("hatırlatıcı sınıfı: sabit gider adı önce; SGK prim ödemesi SGK; KDV, KDV-2, muhtasar, geçici vergi ve damga düz hatırlatıcı", () => {
  const fixed = [{ id: 7, name: "KDV danışmanlığı", period: "aylik" as const, amount: 1_000 }];
  const kdvFixed = rem({ title: "KDV danışmanlığı", kind: "odeme", amount: null, dueDate: "2026-11-10" });
  const sgk = rem({ title: "SGK prim ödemesi", kind: "vergi", amount: null, dueDate: "2026-10-31" });
  // Vergi tahmini yok (27 Kasım 2026): tutarsız vergi hatırlatıcısı tahminle dolmaz, "Tutarı girilmemiş ödemeler"de
  const open = [
    rem({ title: "Muhtasar ve prim hizmet beyannamesi", kind: "vergi", amount: null, dueDate: "2026-10-26" }),
    rem({ title: "KDV beyannamesi ve ödemesi", kind: "vergi", amount: null, dueDate: "2026-10-28" }),
    rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: null, dueDate: "2026-10-25" }),
    rem({ title: "Geçici vergi beyanı ve ödemesi", kind: "vergi", amount: null, dueDate: "2026-11-17", repeat: "quarterly" }),
    rem({ title: "KDV damga vergisi", kind: "vergi", amount: null, dueDate: "2026-10-28" }),
  ];
  // Tutarlı vergi hatırlatıcısı her dönemi yazılı tutarıyla, düz hatırlatıcı olarak (sahibin elle yazdığı ödeme)
  const typed = rem({ title: "Muhtasar", kind: "vergi", amount: 3_000, dueDate: "2026-10-26" });
  const p = buildCashPlan(input({ months: monthsWith(fixed), fixedNames: fixed, reminders: [kdvFixed, sgk, ...open, typed] }));
  assert.deepEqual(
    lineAt(p, `reminder:${kdvFixed.id}@`).map((l) => [l.amount, l.kind]),
    [[1_000, "fixed"]],
  );
  assert.deepEqual(
    lineAt(p, `reminder:${sgk.id}@`).map((l) => [l.kind, l.amount]),
    [
      ["sgk", 23_118],
      ["sgk", 23_118],
    ],
  );
  assert.equal(p.basis.sgkMode, "carrier");
  assert.deepEqual(
    p.unknownAmounts.map((u) => u.reminderId).sort((x, y) => (x ?? 0) - (y ?? 0)),
    open.map((r) => r.id),
  );
  assert.deepEqual(
    lineAt(p, `reminder:${typed.id}@`).map((l) => [l.kind, l.date, l.amount, l.estimated]),
    [
      ["reminder", "2026-10-26", 3_000, false],
      ["reminder", "2026-11-26", 3_000, false],
    ],
  );
  // Vergi satırı ve tahmini hiç yok
  assert.ok(lines(p).every((l) => !l.key.startsWith("kdv") && !l.key.startsWith("vergi") && !l.key.startsWith("damga")));
  assert.ok(p.estimates.every((e) => e.key !== "kdv" && e.key !== "vergi"));
  assert.equal("vat" in p, false);
});

// ---------------------------------------------------------------- Excel verisinden girdiler ve metinler

test("girdiler (Excel, bugün 2026-10-22): POS yedeği Ekim, 2 kişi, sabit giderler", () => {
  const base = planInputFromModel(model, TODAY);
  assert.deepEqual(base.posMonth, { month: "2026-10", posRevenue: 293_909, openDays: 16 });
  const oct = base.months["2026-10"];
  assert.equal(oct.payroll.people, 2);
  assert.equal(oct.payroll.net, 60_000);
  // Yasal bordro (src/lib/bordro/payroll.ts; eski Vergi bölümünden, rakam aynı): netten brüt, 2026 yasal oranları
  // (işveren %19,75 + %2), asgari ücret istisnası; Ayarlar'ın %15,75'iyle 23.117,65 olurdu
  close(oct.payroll.sgk, 25_956.18, "SGK", 0.005);
  assert.deepEqual(base.sgkRates, { year: 2026, isveren: 0.1975, issizlik: 0.02 });
  assert.equal(oct.fixed.length, 16);
  assert.equal(oct.fixed.find((f) => f.name === "ModPOS / Patron aboneliği")!.period, "yillik");
  assert.ok(base.months["2026-12"] && base.months["2026-08"]);
  assert.equal(base.online, null);
  assert.deepEqual(base.settings, { komisyon: ds.settings.komisyon, kartOrani: ds.settings.kartOrani, acikGun: ds.settings.acikGun });
  assert.equal("vat" in base, false, "KDV girdisi yok");
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

test("Nasıl hesaplandı: rakamlarıyla; yedek ve 'satış verisi yok' metinleri; vergiler 'Dahil değil'de, KDV notu yok", () => {
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
  assert.equal(
    text("excluded"),
    "Vergiler (KDV, muhtasar, geçici ve kurumlar vergisi, damga; muhasebeciniz yürütür, tutarını Ödemeler'e yazarsanız planda görünür), Aylık harcamalar'da her ay girilmeyen (tek seferlik) ödemeler (cari borçların gider kayıtları dahil), yıllık giderler (ModPOS / Patron aboneliği), yatırım ve kredi.",
  );
  assert.equal(
    text("sgk"),
    "İşçi ve işveren SGK + işsizlik payları (ayda 25.956\u00a0₺), takip eden ayın son günü. Brüt, gelir ve damga vergisiyle; 2026 yasal oranlarıyla (işveren %19,75 + %2) hesaplanır; gelir ve damga vergisi (muhtasar) bu planda yok.",
  );
  assert.deepEqual(
    notes.filter((n) => n.key === "kdv" || n.key === "vergi"),
    [],
    "KDV ve vergi notu yok",
  );
  const reports = Array.from({ length: 8 }, (_, i) => ({ date: addDays(TODAY, -1 - i), zTotal: 9_850, card: 7_683, mealCard: 0 }));
  const kasa = planNotes(buildCashPlan(input({ cashReports: reports })), { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.match(kasa.find((n) => n.key === "sales")!.text, /^Son 28 günün 8 kasa raporuna göre günde ortalama 9\.850 ₺ \(Z toplamı, ödenmez \/ ikram hariç\)\. Kartla ödenen %78 için %2,5 komisyon düşüldü/);
  // İki "online" ayrı adla: Z raporundaki platformlar (Yemeksepeti, Getir…) ile kasadan geçmeyen laffogato.net
  const platform = buildCashPlan(input({ cashReports: reports.map((r) => ({ ...r, online: 985 })), online: { month: "2026-09", perDay: 420 } }));
  assert.equal(platform.basis.sales.kind === "kasa" ? platform.basis.sales.platformShare : null, 0.1);
  const pn = planNotes(platform, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.match(pn.find((n) => n.key === "sales")!.text, /\(Z toplamı, ödenmez \/ ikram hariç; Z'deki online platform ödemeleri \(Yemeksepeti, Getir…\) %10, aynı gün ve kesintisiz sayıldı\)\./);
  assert.match(pn.find((n) => n.key === "online")!.text, /^laffogato\.net Eylül 2026 online satışına göre günde 420\s₺ \(iadeler düşülmüş\)\. Kasadan geçmez, Z raporundaki online platformlardan ayrıdır\./);
  const none = planNotes(buildCashPlan(input()), { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 });
  assert.equal(none.find((n) => n.key === "sales")!.text, "Satış verisi yok: gelen para sayılmadı. Kasa raporu girildikçe tahmin oluşur.");
  assert.equal(none.find((n) => n.key === "goods")!.text, "Mal alımı tahmini için en az 2 haftalık fatura gerekir.");
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
  for (const fn of ["saveCashBalance", "saveCashPlanExcluded"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /const me = await requireAdmin\(\);/, fn);
  }
  const dash = read("src/app/panel/page.tsx");
  // Nakit planı alanı (şube ayrımı parça 4, docs/SUBE.md › Şube ayrımı): Genel bakış'ın kartı ve ekran aynı yükleyiciyle;
  // firma kipinde ve "Tümü"de firmanın planı (şube seçiliyken model "Tümü" ile yeniden okunur), şube kipinde şubenin akışı
  assert.match(dash, /areaScope\("nakit"\),\s*model\.ds\.branchView \? null : model,\s*\]\)\s*\.then\(\(\[area, firmModel\]\) => loadAreaCashPlan\(area, \{ model: firmModel \?\? undefined, upcoming \}\)\)\s*\.catch\(\(\) => null\)/);
  assert.match(page, /const area = await areaScope\("nakit"\);\s*const \{ model, view, flow \} = await loadAreaCashPlan\(area\);/);
  // Firmanın planı (bakiye ve İşletme geneli satırları) "Tümü" kapsamında okunur
  assert.match(read("src/server/data/cash-plan.ts"), /const firm = await withBranchScope\(ALL_BRANCHES, async \(\) => \{/);
  // db:reset nakit planının durumunu siler (sabit gider kimlikleri baştan sayar)
  assert.match(read("scripts/seed.ts"), /'cashflow\.plan'/);
});

// ---------------------------------------------------------------- Bordro ve stopaj (vergi tahmini yok, 27 Kasım 2026)

test("bordro (SGK) yasal oranlarla: Eylül 25.956,18 (Vergi bölümündekiyle aynı); satırda yasal gün notu yok; saklı ayar", () => {
  const base = planInputFromModel(model, TODAY);
  close(base.months["2026-09"].payroll.sgk, 25_956.18, "Eylül SGK", 0.005);
  const p = buildCashPlan(input({ ...base }));
  const [sgk] = byKey(p, "sgk@2026-10-31");
  close(sgk.amount, 25_956.18, "satır", 0.005);
  assert.equal(sgk.detail, undefined);
  // Saklı ayar (eski Vergi ayarları, tax.settings): elle işveren oranı (teşvik) bordroya ve nota geçer
  const manual = planInputFromModel(model, TODAY, { ...DEFAULT_PAYROLL_SETTINGS, overrides: { "sgk.isverenOran": { value: 0.1575 } } });
  assert.deepEqual(manual.sgkRates, { year: 2026, isveren: 0.1575, issizlik: 0.02 });
  assert.ok(manual.months["2026-09"].payroll.sgk < base.months["2026-09"].payroll.sgk);
  // Asgari ücret desteği iki kişide 2.539,80 düşer
  close(planInputFromModel(model, TODAY, { ...DEFAULT_PAYROLL_SETTINGS, minWageSupport: true }).months["2026-09"].payroll.sgk, 25_956.18 - 2_539.8, "destekli", 0.005);
  // Hesap döneminin başından önce bordro yok
  const late = planInputFromModel(model, TODAY, { ...DEFAULT_PAYROLL_SETTINGS, periodStart: "2026-09-01" });
  assert.deepEqual(late.months["2026-08"].payroll, { net: 0, sgk: 0, people: 0 });
  close(late.months["2026-09"].payroll.sgk, 25_956.18, "Eylül", 0.005);
});

test("kira resmi kirayla (sahibin kararı, 4 Kasım 2026): ev sahibine 160.000 kesintisiz; kira stopajı satırı yok (vergi tahmini yok)", () => {
  const official = createModel({
    ...ds,
    fixedExpenses: ds.fixedExpenses.map((f) => (f.name === "Kira" ? { ...f, taxWithholding: "kira" as const, vatRate: 0, officialAmount: 100_000, officialBasis: "brut" as const, prorate: false } : f)),
  });
  const base = planInputFromModel(official, TODAY);
  const kiraFixed = base.months["2026-11"].fixed.find((f) => f.name === "Kira")!;
  assert.equal(kiraFixed.withholding, undefined, "stopaj ödemeden kesilmez");
  const p = buildCashPlan(input({ ...base }));
  assert.equal(p.estimates.find((e) => e.title === "Kira")!.monthly, 160_000);
  assert.ok(lines(p).every((l) => !/^(vergi|damga|kdv)/.test(l.key)), "muhtasar ve kira stopajı satırı yok");
});

test("stopajlı sabit gider net ödenir (kira 160.000 → 128.000; SMM 10.000 + KDV − stopaj); stopajı muhasebeci öder, planda satırı yok", () => {
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
  const p = buildCashPlan(input({ ...base }));
  const est = (title: string) => p.estimates.find((e) => e.title === title)!;
  assert.equal(est("Kira").monthly, 128_000);
  assert.equal(est("Kira").note, "ay içine yayılır · 160.000 ₺ brüt, stopaj %20 ödemeden kesildi");
  close(est("Muhasebeci").monthly, 10_000, "SMM: 10.000 + %20 KDV − %20 stopaj");
  assert.ok(lines(p).every((l) => !/^(vergi|damga|kdv)/.test(l.key)), "muhtasar satırı yok");
  const kiraNov = p.weeks.flatMap((w) => w.lines.filter((l) => l.key === "fixed")).map((l) => l.detail!);
  assert.ok(kiraNov.every((d) => d.includes("Kira 160.000 ₺ brüt · stopaj %20 ödemeden kesildi · ödenen 128.000 ₺")));
  assert.match(
    planNotes(p, { komisyon: 0.025, acikGun: 30, invoiceTermDays: 30 }).find((n) => n.key === "fixed")!.text,
    /Stopajlı kalemde \(şahsa kira, serbest meslek\) ödemeden kesilen stopaj düşüldü: stopajı muhasebeciniz muhtasarla öder, plan vergi tahmini yapmaz/,
  );
  // Tutarsız "Kira" hatırlatıcısı giderin net tutarını taşır
  const kira = rem({ title: "Kira", kind: "kira", amount: null, dueDate: "2026-11-01" });
  const carried = buildCashPlan(input({ ...base, reminders: [kira] }));
  assert.deepEqual(
    lineAt(carried, `reminder:${kira.id}@2026-11-01`).map((l) => [l.amount, l.detail]),
    [[128_000, "Sabit giderdeki tutar; Kira 160.000 ₺ brüt · stopaj %20 ödemeden kesildi · ödenen 128.000 ₺"]],
  );
  // "Sabit giderlerden ekle" net tutarı yazar; 128.000 tutarlı hatırlatıcı "farklı tutar" uyarısı vermez (E-46)
  const f = withheld.ds.fixedExpenses.find((x) => x.name === "Kira")!;
  const rated = { ...f, withholdingRate: 0.2 };
  assert.equal(fixedReminderAt(rated, [], "2026-11").amount, 128_000);
  const r128 = { ...kira, amount: 128_000 };
  assert.deepEqual(fixedReminderDrifts([r128], [{ ...rated, startMonth: null, endMonth: null }], [], TODAY), []);
  assert.equal(fixedReminderDrifts([r128], [{ ...f, startMonth: null, endMonth: null }], [], TODAY).length, 1, "stopajsız kalemde 160.000 beklenir");
  assert.equal(lineAt(buildCashPlan(input({ ...base, reminders: [r128] })), `reminder:${kira.id}@2026-11-01`)[0].detail, undefined);
});

test("yurt dışı hizmet: ödenen tutar olduğu gibi (stopaj ve Türk KDV'si yok); KDV-2 satırı yok, KDV-2 hatırlatıcısı düz hatırlatıcı", () => {
  const ig = createModel({ ...ds, fixedExpenses: ds.fixedExpenses.map((f) => (f.name === "Instagram reklamı" ? { ...f, taxWithholding: "internet_reklam_yurtdisi" as const } : f)) });
  const base = planInputFromModel(ig, TODAY);
  const igItem = base.months["2026-11"].fixed.find((f) => f.name === "Instagram reklamı")!;
  assert.deepEqual([igItem.withholding, igItem.withholdingRate, igItem.vatRate], ["internet_reklam_yurtdisi", 0, 0]);
  const p = buildCashPlan(input({ ...base }));
  const igRow = p.estimates.find((e) => e.title === "Instagram reklamı")!;
  assert.deepEqual([igRow.monthly, igRow.note], [30_000, "ay içine yayılır"]);
  assert.ok(lines(p).every((l) => !/^(vergi|damga|kdv)/.test(l.key)), "KDV-2 satırı yok");
  // "Sabit giderlerden ekle" ve E-46 karşılaştırması da KDV'siz tutarı bekler (yurt dışı hizmet de)
  const igFixed = ig.ds.fixedExpenses.find((f) => f.name === "Instagram reklamı")!;
  assert.equal(fixedReminderAt(paidFixedRates(igFixed, 2026), [], "2026-11").amount, 30_000);
  assert.equal(fixedReminderAt(paidFixedRates({ ...igFixed, taxWithholding: "yurt_disi_hizmet" as const }, 2026), [], "2026-11").amount, 30_000);
  assert.equal(fixedReminderAt(paidFixedRates({ ...igFixed, taxWithholding: "yok" as const }, 2026), [], "2026-11").amount, 36_000, "Türkiye'deki firmaya KDV'siyle");
  assert.deepEqual(fixedReminderDrifts([rem({ title: "Instagram reklamı", kind: "odeme", amount: 30_000, dueDate: "2026-11-05" })], [{ ...paidFixedRates(igFixed, 2026), startMonth: null, endMonth: null }], [], TODAY), []);
  // Tutarlı KDV-2 hatırlatıcısı yazılı tutarıyla; tutarsızı "Tutarı girilmemiş ödemeler"de
  const k2 = rem({ title: "KDV2 beyannamesi", kind: "vergi", amount: 6_000, dueDate: "2026-10-25" });
  const covered = buildCashPlan(input({ ...base, reminders: [k2] }));
  assert.deepEqual(
    lineAt(covered, `reminder:${k2.id}@2026-10-25`).map((l) => [l.amount, l.detail, l.kind]),
    [[6_000, undefined, "reminder"]],
  );
  const open = buildCashPlan(input({ ...base, reminders: [{ ...k2, amount: null }] }));
  assert.equal(lineAt(open, `reminder:${k2.id}@`).length, 0);
  assert.deepEqual(
    open.unknownAmounts.map((u) => u.reminderId),
    [k2.id],
  );
});

test("Faz 5: şahsa kira (ev sahibi türü) KDV'siz ödenir, stopaj resmi kiradan (ödemeden kesilmez); 'Kira stopajı' hatırlatıcısı düz ödeme", () => {
  // Kalemin KDV'si boş (bölümün varsayılanı %20): ev sahibi şahıs olunca nakit planı KDV eklemez (192.000 değil 160.000)
  const sahis = createModel({
    ...ds,
    fixedExpenses: ds.fixedExpenses.map((f) => (f.name === "Kira" ? { ...f, vatRate: null, landlordType: "sahis" as const, officialAmount: 100_000, officialBasis: "brut" as const } : f)),
  });
  const kiraId = ds.fixedExpenses.find((f) => f.name === "Kira")!.id;
  const base = planInputFromModel(sahis, TODAY);
  const kiraFixed = base.months["2026-11"].fixed.find((f) => f.id === kiraId)!;
  assert.deepEqual([kiraFixed.vatRate, kiraFixed.withholding ?? null], [0, null]);
  const plan = buildCashPlan(input({ months: base.months, fixedNames: base.fixedNames }));
  close(plan.estimates.find((e) => e.key === `fixed:${kiraId}`)!.monthly, 160_000, "aylık ödenen (KDV yok)");
  // Stopaj (resmi brütten 20.000) planda kendiliğinden yok; sahibin yazdığı "Kira stopajı" her ay tutarıyla
  const kira = rem({ title: "Kira stopajı", kind: "vergi", amount: 20_000, dueDate: "2026-10-26" });
  const p = buildCashPlan(input({ reminders: [kira] }));
  assert.deepEqual(lineAt(p, `reminder:${kira.id}@`).map((l) => [l.date, l.amount]), [
    ["2026-10-26", 20_000],
    ["2026-11-26", 20_000],
  ]);
  assert.ok(lines(p).every((l) => !/^(vergi|damga|kdv)/.test(l.key)));
});

test("kayıtlı durum: eski devreden KDV ve kaldırılan tahminlerin anahtarları (kdv, vergi) okunur, kayıtta kalır", () => {
  const stored = { balance: 85_000, balanceDate: "2026-10-22", balanceBy: "Yönetici", excluded: ["kdv", "vergi", "sales"], vatCarry: { month: "2026-09", amount: 140_000, date: "2026-10-20", by: "Yönetici" } };
  const st = parseCashPlanState(stored);
  assert.deepEqual(st.excluded, ["kdv", "vergi", "sales"]);
  assert.deepEqual(st.vatCarry, stored.vatCarry);
  assert.ok(EXCLUDABLE_KEY.test("kdv") && EXCLUDABLE_KEY.test("vergi"), "kaydetmede doğrulamadan geçer (silinmez)");
  // Tahmine katılanlar kaydı görünmeyen anahtarları korur (estimates-sheet: excluded.filter(!shown))
  assert.match(read("src/app/panel/hatirlaticilar/nakit/estimates-sheet.tsx"), /const keys = \[\.\.\.excluded\.filter\(\(k\) => !shown\.has\(k\)\), \.\.\.off\];/);
  // Bakiye ve tahmin ayarı kaydı durumun tamamını değiştirmeden yazar (vatCarry yerinde kalır)
  const actions = read("src/server/actions/cash-plan.ts");
  assert.match(actions, /await updateState\(\(st\) => \(\{ \.\.\.st, balance: rounded,/);
  assert.match(actions, /await updateState\(\(st\) => \(\{ \.\.\.st, excluded \}\)\);/);
  assert.doesNotMatch(actions, /saveVatCarry|forgetVatPayment|vat-paid/);
  // Kayıttaki "kdv" ve "vergi" plana bir şey yapmaz
  const p = buildCashPlan(input({ excluded: st.excluded, months: monthsWith() }));
  assert.deepEqual(p.excluded.sort(), ["kdv", "sales", "vergi"]);
  assert.ok(p.estimates.every((e) => e.key !== "kdv" && e.key !== "vergi"));
});

test("satışlar: iki şubenin aynı günkü raporları bir gün; ortalama günlük toplam (rapor sayısına bölünmez), not iki sayıyı da söyler", () => {
  const reports = Array.from({ length: 10 }, (_, i) => [
    { date: addDays(TODAY, -1 - i), zTotal: 1_111, card: 0, mealCard: 0 },
    { date: addDays(TODAY, -1 - i), zTotal: 2_222, card: 0, mealCard: 0 },
  ]).flat();
  const p = buildCashPlan(input({ cashReports: reports }));
  assert.equal(p.basis.sales.kind, "kasa");
  if (p.basis.sales.kind !== "kasa") return;
  assert.deepEqual([p.basis.sales.reports, p.basis.sales.days], [20, 10]);
  close(p.basis.sales.daily, 3_333, "günlük şubelerin toplamı");
  const note = planNotes(p, { komisyon: 0.025, acikGun: 26, invoiceTermDays: 30 }).find((n) => n.key === "sales")!.text;
  assert.match(note, /^Son 28 günün 20 kasa raporuna \(10 gün, şubelerin toplamı\) göre günde ortalama 3\.333/);
  // Yedi günden az raporlu gün: iki şubeyle 8 rapor olsa da kasa ortalaması yok
  const few = reports.slice(0, 8);
  assert.notEqual(buildCashPlan(input({ cashReports: few })).basis.sales.kind, "kasa");
});

test("satışlar: yeni açılan şube 28 güne yayılmaz; günlük şube ortalamalarının toplamı, not şube şube gün sayısını söyler (denetim 21 Kasım #11)", () => {
  // Tuzla son 28 günün hepsinde 10.000, Marina yalnız son 7 günde 6.000: işletmenin günlük satışı 16.000
  const tuzla = Array.from({ length: 28 }, (_, i) => ({ date: addDays(TODAY, -1 - i), zTotal: 10_000, card: 6_000, mealCard: 0, branchId: "tuzla", branchName: "Tuzla" }));
  const marina = Array.from({ length: 7 }, (_, i) => ({ date: addDays(TODAY, -1 - i), zTotal: 6_000, card: 3_000, mealCard: 0, branchId: "marina", branchName: "Marina" }));
  const p = buildCashPlan(input({ cashReports: [...tuzla, ...marina] }));
  assert.equal(p.basis.sales.kind, "kasa");
  if (p.basis.sales.kind !== "kasa") return;
  close(p.basis.sales.daily, 16_000, "günlük = Tuzla 10.000 + Marina 6.000 (eskiden (280.000 + 42.000) / 28 = 11.500)");
  assert.deepEqual([p.basis.sales.reports, p.basis.sales.days], [35, 28]);
  assert.deepEqual(
    p.basis.sales.branches?.map((b) => [b.name, b.days, b.daily]),
    [
      ["Tuzla", 28, 10_000],
      ["Marina", 7, 6_000],
    ],
  );
  // Kart payı bütün şubelerin toplamından: (168.000 + 21.000) / 322.000
  close(p.basis.sales.cardShare, 189_000 / 322_000, "kart payı");
  const note = planNotes(p, { komisyon: 0.025, acikGun: 26, invoiceTermDays: 30 }).find((n) => n.key === "sales")!.text;
  assert.match(note, /^Son 28 günün 35 kasa raporuna \(Tuzla 28 gün, Marina 7 gün; şube ortalamalarının toplamı\) göre günde ortalama 16\.000/);
  // Bir şubenin bir günü eksik (rapor yok): o gün işletmenin gününü sulandırmaz
  const missed = buildCashPlan(input({ cashReports: [...tuzla.filter((_, i) => i !== 3), ...tuzla.map((r) => ({ ...r, branchId: "marina", branchName: "Marina", zTotal: 5_000 }))] }));
  assert.ok(missed.basis.sales.kind === "kasa");
  if (missed.basis.sales.kind === "kasa") close(missed.basis.sales.daily, 15_000, "Tuzla 27 gün 10.000 + Marina 28 gün 5.000");
  // Tek şube: sonuç bugünkü gibi (Z ÷ rapor), notta parantez yok
  const tek = buildCashPlan(input({ cashReports: tuzla }));
  assert.ok(tek.basis.sales.kind === "kasa" && tek.basis.sales.daily === 10_000 && !tek.basis.sales.branches);
  assert.match(planNotes(tek, { komisyon: 0.025, acikGun: 26, invoiceTermDays: 30 }).find((n) => n.key === "sales")!.text, /^Son 28 günün 28 kasa raporuna göre günde ortalama 10\.000/);
  // Yeterlilik işletmenin raporlu gün sayısıyla: Marina'nın 7 günü yalnız başına da yeter
  assert.equal(buildCashPlan(input({ cashReports: marina })).basis.sales.kind, "kasa");
  assert.notEqual(buildCashPlan(input({ cashReports: marina.slice(0, 6) })).basis.sales.kind, "kasa");
});

test("salesDaily ve planCashReports: şube şube ortalama; pasif şubenin raporu sayılmaz, sıra kütüğün sırası", () => {
  assert.deepEqual(
    salesDaily([
      { date: "2026-11-01", zTotal: 100, branchId: "a" },
      { date: "2026-11-01", zTotal: 50, branchId: "b" },
      { date: "2026-11-02", zTotal: 300, branchId: "a" },
    ]).map((g) => [g.id, g.days, g.daily]),
    [
      ["a", 2, 200],
      ["b", 1, 50],
    ],
  );
  // Şubesiz raporlar tek kasa: aynı günün iki raporu bir gün
  assert.deepEqual(salesDaily([{ date: "2026-11-01", zTotal: 100 }, { date: "2026-11-01", zTotal: 200 }]).map((g) => [g.days, g.daily]), [[1, 300]]);
  const branches = [
    { id: "tuzla", name: "Tuzla", active: true },
    { id: "marina", name: "Marina", active: true },
    { id: "eski", name: "Eski şube", active: false },
  ];
  const r = (branchId: string, date: string) => ({ branchId, date, zTotal: 1_000, card: 0, mealCard: 0, online: 0 });
  const rows = planCashReports([r("marina", "2026-11-02"), r("eski", "2026-11-02"), r("tuzla", "2026-11-02"), r("yok", "2026-11-01"), r("tuzla", "2026-11-01")], branches);
  assert.deepEqual(
    rows.map((x) => [x.branchId, x.branchName, x.date]),
    [
      ["tuzla", "Tuzla", "2026-11-02"],
      ["tuzla", "Tuzla", "2026-11-01"],
      ["marina", "Marina", "2026-11-02"],
      ["yok", "yok", "2026-11-01"],
    ],
  );
  // Yükleyici raporları şubesiyle verir (şubesiz eşleme kalmadı)
  const loader = read("src/server/data/cash-plan.ts");
  assert.match(loader, /cashReports: planCashReports\(reports, branches\),/);
  assert.doesNotMatch(loader, /cashReports: reports\.map\(/);
});

test("satışlar: ödenmez Z'nin içindeyse günlük satışa girmez; kart payı cirodan (denetim 13 Kasım HM-08)", () => {
  const days = Array.from({ length: 10 }, (_, i) => addDays(TODAY, -1 - i));
  // Z 10.000, ödemeler 9.500, ödenmez 500: ödenmez Z'nin içinde, günün cirosu 9.500 (Genel bakış ve Kasa'daki gibi)
  const off = buildCashPlan(input({ cashReports: days.map((date) => ({ date, zTotal: 10_000, card: 5_700, mealCard: 0, offRevenue: 500, payments: 9_500 })) }));
  assert.ok(off.basis.sales.kind === "kasa");
  if (off.basis.sales.kind === "kasa") {
    close(off.basis.sales.daily, 9_500, "ciro ödenmez hariç");
    close(off.basis.sales.cardShare, 0.6, "kart ÷ ciro");
  }
  // Ödemeler Z'yi tutuyorsa ödenmez zaten dışarıda: Z olduğu gibi
  const out = buildCashPlan(input({ cashReports: days.map((date) => ({ date, zTotal: 10_000, card: 6_000, mealCard: 0, offRevenue: 500, payments: 10_000 })) }));
  assert.ok(out.basis.sales.kind === "kasa" && out.basis.sales.daily === 10_000);
  // Şube şube ortalama da cirodan
  assert.deepEqual(
    salesDaily([
      { date: "2026-11-01", zTotal: 1_000, offRevenue: 100, payments: 900, branchId: "a" },
      { date: "2026-11-01", zTotal: 500, branchId: "b" },
    ]).map((g) => [g.id, g.daily]),
    [
      ["a", 900],
      ["b", 500],
    ],
  );
  // Plan girdisi ödeme dökümünü taşır (yükleyicinin raporlarında nakit, diğer ve ödenmez var)
  const [row] = planCashReports(
    [{ branchId: "tuzla", date: "2026-11-01", zTotal: 1_000, cash: 300, card: 600, mealCard: 0, online: 0, other: 0, offRevenue: 100 }],
    [{ id: "tuzla", name: "Tuzla", active: true }],
  );
  assert.deepEqual([row.offRevenue, row.payments], [100, 900]);
});
