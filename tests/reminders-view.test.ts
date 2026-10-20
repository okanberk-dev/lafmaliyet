import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dayLocative,
  dayPossessive,
  endOfMonthAnchor,
  inSummaryRange,
  isLastDayOfMonth,
  laterReminderItems,
  longDateTR,
  monthEnd,
  monthGrid,
  monthShortTR,
  nextOccurrence,
  parseSummaryRange,
  postponeDate,
  postponePlan,
  presetDraft,
  projectedOccurrences,
  REMINDER_PRESETS,
  reminderCategory,
  repeatLabel,
  shiftMonth,
  summarize,
  timelineGroup,
  upcomingItems,
  weekEnd,
  type ReminderRow,
} from "../src/lib/reminders";

const base: ReminderRow = {
  id: 1,
  title: "Kira",
  kind: "kira",
  amount: 50000,
  dueDate: "2026-11-01",
  anchorDate: "2026-11-01",
  repeat: "monthly",
  remindDaysBefore: 3,
  note: null,
  active: true,
};

test("hafta pazar, ay son günü biter", () => {
  // 20 Ekim 2026 salı
  assert.equal(weekEnd("2026-10-20"), "2026-10-25");
  assert.equal(weekEnd("2026-10-25"), "2026-10-25");
  assert.equal(weekEnd("2026-10-26"), "2026-11-01");
  assert.equal(monthEnd("2026-02-10"), "2026-02-28");
  assert.equal(monthEnd("2028-02-10"), "2028-02-29");
  assert.equal(isLastDayOfMonth("2026-11-30"), true);
  assert.equal(isLastDayOfMonth("2026-11-29"), false);
  assert.equal(endOfMonthAnchor("2026-11-30"), "2026-11-31");
});

test("zaman çizelgesi grupları", () => {
  const today = "2026-10-20";
  assert.equal(timelineGroup("2026-10-19", today), "overdue");
  assert.equal(timelineGroup("2026-10-20", today), "today");
  assert.equal(timelineGroup("2026-10-25", today), "week");
  assert.equal(timelineGroup("2026-10-26", today), "month");
  assert.equal(timelineGroup("2026-10-31", today), "month");
  assert.equal(timelineGroup("2026-11-01", today), "later");
  // Hafta ay sonunu aşarsa önce "bu hafta"
  assert.equal(timelineGroup("2026-11-01", "2026-10-28"), "week");
});

test("özet karoları: gecikmiş, bu hafta, bu ay, 45 gün (listenin ufku)", () => {
  const today = "2026-10-20";
  const items = [
    { dueDate: "2026-10-10", amount: 100 },
    { dueDate: "2026-10-20", amount: 200 },
    { dueDate: "2026-10-24", amount: null },
    { dueDate: "2026-10-30", amount: 300 },
    { dueDate: "2026-11-19", amount: 400 },
    { dueDate: "2026-11-20", amount: 500 },
    { dueDate: "2026-12-04", amount: 600 },
    { dueDate: "2026-12-05", amount: 700 },
  ];
  const s = summarize(items, today);
  assert.deepEqual(s.gecikmis, { count: 1, total: 100 });
  assert.deepEqual(s.hafta, { count: 2, total: 200 });
  assert.deepEqual(s.ay, { count: 3, total: 500 });
  assert.deepEqual(s["45gun"], { count: 6, total: 2000 });
  assert.equal(inSummaryRange("2026-12-04", "45gun", today), true);
  assert.equal(inSummaryRange("2026-12-05", "45gun", today), false);
  assert.equal(inSummaryRange("2026-10-19", "hafta", today), false);
  // Eski bağlantılar (?aralik=30gun) 45 günü açar
  assert.equal(parseSummaryRange("30gun"), "45gun");
  assert.equal(parseSummaryRange("hafta"), "hafta");
  assert.equal(parseSummaryRange("x"), null);
});

test("erteleme +1 hafta / +1 ay", () => {
  assert.equal(postponeDate("2026-10-28", "week"), "2026-11-04");
  assert.equal(postponeDate("2026-01-31", "month"), "2026-02-28");
  assert.equal(postponeDate("2026-12-15", "month"), "2027-01-15");
});

test("gecikmiş ödeme bugünden ertelenir (eski vadeden değil)", () => {
  const today = "2026-10-20";
  // 13.09 vadeli, 37 gün gecikmiş fatura
  assert.equal(postponeDate("2026-09-13", "week", today), "2026-10-27");
  assert.equal(postponeDate("2026-09-13", "month", today), "2026-11-20");
  // Vadesi gelmemiş ödeme kendi tarihinden
  assert.equal(postponeDate("2026-10-28", "week", today), "2026-11-04");
  assert.equal(postponeDate("2026-10-20", "month", today), "2026-11-20");
});

test("tekrar eden hatırlatıcıyı ertelemek sıradaki dönemle çakışmasın", () => {
  const today = "2026-10-20";
  const monthly = { dueDate: "2026-10-28", repeat: "monthly" as const, anchorDate: "2026-01-28" };
  assert.deepEqual(postponePlan(monthly, "week", today), { target: "2026-11-04", next: "2026-11-28", conflict: false });
  // 1 ay ertele = sıradaki dönemle aynı gün: sunulmaz
  assert.deepEqual(postponePlan(monthly, "month", today), { target: "2026-11-28", next: "2026-11-28", conflict: true });
  const weekly = { dueDate: "2026-10-22", repeat: "weekly" as const, anchorDate: "2026-10-01" };
  assert.equal(postponePlan(weekly, "week", today).conflict, true);
  assert.equal(postponePlan(weekly, "month", today).conflict, true);
  const yearly = { dueDate: "2026-11-17", repeat: "yearly" as const, anchorDate: "2026-11-17" };
  assert.equal(postponePlan(yearly, "month", today).conflict, false);
  const once = { dueDate: "2026-10-28", repeat: "none" as const, anchorDate: "2026-10-28" };
  assert.deepEqual(postponePlan(once, "month", today), { target: "2026-11-28", next: null, conflict: false });
  // İki dönem gecikmiş aylık (13.09; seri 13.10 da geçmiş): bugünden ertelenir, geçmiş dönemle çakışma sayılmaz
  const late = { dueDate: "2026-09-13", repeat: "monthly" as const, anchorDate: "2026-09-13" };
  assert.deepEqual(postponePlan(late, "week", today), { target: "2026-10-27", next: "2026-10-13", conflict: false });
});

test("takvim: 45 günden sonraki hatırlatıcılar kendi ayında", () => {
  const today = "2026-10-20";
  const base = { kind: "vergi" as const, amount: 1000, note: null, remindDaysBefore: 3, active: true };
  const rows = [
    { ...base, id: 1, title: "Tek seferlik", dueDate: "2026-12-05", anchorDate: "2026-12-05", repeat: "none" as const },
    { ...base, id: 2, title: "Aylık erken ödenmiş", dueDate: "2026-12-28", anchorDate: "2026-01-28", repeat: "monthly" as const },
    { ...base, id: 3, title: "Yakın", dueDate: "2026-11-01", anchorDate: "2026-11-01", repeat: "monthly" as const },
    { ...base, id: 4, title: "Kapalı", dueDate: "2027-01-05", anchorDate: "2027-01-05", repeat: "none" as const, active: false },
    { ...base, id: 5, title: "Uzun hatırlatma", dueDate: "2026-12-15", anchorDate: "2026-12-15", repeat: "yearly" as const, remindDaysBefore: 60 },
  ];
  const later = laterReminderItems(rows, today);
  assert.deepEqual(
    later.map((i) => [i.sourceId, i.dueDate, i.ref, i.projected ?? false]),
    [
      [1, "2026-12-05", "reminder:1", false],
      [2, "2026-12-28", "reminder:2", false],
    ],
  );
  // upcomingItems ile birlikte her etkin hatırlatıcının şimdiki dönemi tam bir kez yer alır
  const near = upcomingItems(rows, [], today).filter((i) => !i.projected);
  const all = [...near, ...later].map((i) => i.sourceId).sort();
  assert.deepEqual(all, [1, 2, 3, 5]);
});

test("Türkçe gün ekleri", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 26, 28, 30, 31].map(dayLocative),
    ["1'inde", "2'sinde", "3'ünde", "4'ünde", "5'inde", "6'sında", "7'sinde", "8'inde", "9'unda", "10'unda", "20'sinde", "26'sında", "28'inde", "30'unda", "31'inde"],
  );
  assert.equal(dayPossessive(28), "28'i");
  assert.equal(dayPossessive(26), "26'sı");
});

test("tekrar rozeti", () => {
  assert.equal(repeatLabel("none", "2026-10-28"), null);
  assert.equal(repeatLabel("monthly", "2026-10-28", "2026-10-28"), "Her ay 28'inde");
  assert.equal(repeatLabel("monthly", "2026-11-30", "2026-10-31"), "Her ayın son günü");
  assert.equal(repeatLabel("monthly", "2026-02-28", "2026-01-30"), "Her ay 30'unda");
  assert.equal(repeatLabel("weekly", "2026-10-20", "2026-10-20"), "Her hafta Salı");
  assert.equal(repeatLabel("quarterly", "2026-11-17", "2026-11-17"), "Üç ayda bir · 17'sinde");
  assert.equal(repeatLabel("yearly", "2027-02-17", "2027-02-17"), "Her yıl 17 Şubat");
});

test("takvim ızgarası pazartesiden başlar", () => {
  const oct = monthGrid("2026-10");
  assert.equal(oct.length, 5);
  assert.deepEqual([oct[0][0], oct[4][6]], ["2026-09-28", "2026-11-01"]);
  // Şubat 2027 pazartesi başlar, 4 hafta
  assert.deepEqual(
    monthGrid("2027-02").map((w) => w[0]),
    ["2027-02-01", "2027-02-08", "2027-02-15", "2027-02-22"],
  );
  assert.ok(monthGrid("2026-08").length <= 6);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(monthShortTR("2026-10-20"), "Eki");
  assert.equal(longDateTR("2026-10-20"), "20 Ekim Salı");
});

test("takvimde ileriki dönemler", () => {
  const sgk: ReminderRow = { ...base, id: 2, title: "SGK", kind: "vergi", dueDate: "2026-10-31", anchorDate: "2026-10-31" };
  const once: ReminderRow = { ...base, id: 3, repeat: "none" };
  const off: ReminderRow = { ...base, id: 4, active: false };
  const got = projectedOccurrences([base, sgk, once, off], "2026-11-01", "2026-12-31", "2026-10-20");
  assert.deepEqual(
    got.map((o) => [o.reminder.id, o.date]),
    [
      [2, "2026-11-30"],
      [1, "2026-12-01"],
      [2, "2026-12-31"],
    ],
  );
  // Bugünden öncekiler takvime öngörülen olarak düşmez
  const late = projectedOccurrences([{ ...base, dueDate: "2026-08-01", anchorDate: "2026-08-01" }], "2026-09-01", "2026-10-31", "2026-10-20");
  assert.deepEqual(late.map((o) => o.date), []);
});

test("başlıktan ikon türü", () => {
  assert.equal(reminderCategory("vergi", "SGK prim ödemesi"), "sgk");
  assert.equal(reminderCategory("vergi", "Muhtasar ve prim hizmet beyannamesi"), "vergi");
  assert.equal(reminderCategory("vergi", "KDV beyannamesi ve ödemesi"), "vergi");
  assert.equal(reminderCategory("kira", "Dükkân"), "kira");
  assert.equal(reminderCategory("maas", "Personel"), "maas");
  assert.equal(reminderCategory("fatura", "Abonelik"), "abonelik");
  assert.equal(reminderCategory("odeme", "İnternet"), "abonelik");
  assert.equal(reminderCategory("fatura", "Elektrik"), "fatura");
  assert.equal(reminderCategory("odeme", "Elektrik (ana fatura)"), "fatura");
  assert.equal(reminderCategory("odeme", "Su"), "fatura");
  assert.equal(reminderCategory("odeme", "Susam tedarik"), "odeme");
  assert.equal(reminderCategory("odeme", "Aidat"), "kira");
  assert.equal(reminderCategory("diger", "Bir şey"), "diger");
  assert.equal(reminderCategory("odeme", "Tedarikçi"), "odeme");
});

test("şablon taslakları; SGK ay sonuna bağlanır", () => {
  const sgk = REMINDER_PRESETS.find((p) => p.key === "sgk")!;
  const kira = REMINDER_PRESETS.find((p) => p.key === "kira")!;
  const d = presetDraft(sgk, "2026-11-05");
  assert.equal(d.dueDate, "2026-11-30");
  assert.equal(d.endOfMonth, true);
  assert.equal(nextOccurrence(d.dueDate, d.repeat, endOfMonthAnchor(d.dueDate)), "2026-12-31");
  const k = presetDraft(kira, "2026-10-20");
  assert.deepEqual([k.dueDate, k.repeat, k.kind, k.endOfMonth], ["2026-11-01", "monthly", "kira", false]);
  assert.ok(REMINDER_PRESETS.some((p) => p.key === "abonelik"));
});
