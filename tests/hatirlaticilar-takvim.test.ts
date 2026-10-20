import assert from "node:assert/strict";
import { test } from "node:test";

import { calendarEntries, monthTotals } from "../src/app/panel/hatirlaticilar/calendar-entries";
import { laterInvoiceItems, laterReminderItems, postponePlan, syncedDueDate, upcomingItems, type ReminderRow, type UnpaidInvoiceRow } from "../src/lib/reminders";

const today = "2026-10-20";
const base = { kind: "vergi" as const, note: null, remindDaysBefore: 5, active: true };
// QA'daki durum: tek seferlik 05.12 ve erken ödenmiş aylık 28.12 (ikisi de 45 günden uzak), yakın aylık kira,
// yıllık sigorta (Mart 2027)
const reminders: ReminderRow[] = [
  { ...base, id: 1, title: "TEST tek seferlik", amount: 1000, dueDate: "2026-12-05", anchorDate: "2026-12-05", repeat: "none" },
  { ...base, id: 2, title: "TEST KDV beyannamesi", amount: 12500.5, dueDate: "2026-12-28", anchorDate: "2026-10-28", repeat: "monthly" },
  { ...base, id: 3, title: "Kira", kind: "kira", amount: 25000, dueDate: "2026-10-28", anchorDate: "2026-10-28", repeat: "monthly" },
  { ...base, id: 4, title: "Sigorta", kind: "odeme", amount: 9000, dueDate: "2027-03-15", anchorDate: "2027-03-15", repeat: "yearly" },
  { ...base, id: 5, title: "Kapalı", amount: 1, dueDate: "2026-12-10", anchorDate: "2026-12-10", repeat: "none", active: false },
];
const invoices: UnpaidInvoiceRow[] = [
  { id: 7, supplier: "Yakın fatura", invoiceNo: "A1", date: "2026-10-01", dueDate: "2026-10-31", payable: 500 },
  { id: 8, supplier: "Uzak fatura", invoiceNo: "B2", date: "2026-10-01", dueDate: "2026-12-15", payable: 750.25 },
];

/** Ekrandaki gibi: liste (45 gün) + ufuk sonrası şimdiki dönemler */
function actual() {
  return [...upcomingItems(reminders, invoices, today), ...laterReminderItems(reminders, today), ...laterInvoiceItems(invoices, today)];
}

test("takvim: 45 günden uzak hatırlatıcı ve fatura kendi ayında; ay toplamı ve gün listesi dahil", () => {
  const dec = calendarEntries("2026-12", today, actual(), reminders, true);
  const decMonth = dec.filter((e) => e.date.startsWith("2026-12"));
  assert.deepEqual(
    decMonth.map((e) => [e.date, e.item.title, e.forecast]),
    [
      ["2026-12-05", "TEST tek seferlik", false],
      ["2026-12-15", "Uzak fatura", false],
      ["2026-12-28", "Kira", true],
      ["2026-12-28", "TEST KDV beyannamesi", false],
    ],
  );
  assert.deepEqual(monthTotals(dec, "2026-12"), { count: 4, total: 1000 + 750.25 + 25000 + 12500.5 });
  // Gün sayfası: 28 Aralık'ta KDV ödenebilir (gerçek öğe), kira öngörü
  const day = dec.filter((e) => e.date === "2026-12-28");
  assert.deepEqual(
    day.map((e) => [e.item.ref, e.forecast]),
    [
      ["reminder:3@2026-12-28", true],
      ["reminder:2", false],
    ],
  );
  // Kapalı hatırlatıcı yok
  assert.ok(!dec.some((e) => e.item.sourceId === 5 && e.item.source === "reminder"));
});

test("takvim: şimdiki dönemden sonraki tekrarlar öngörü; yıllık kendi ayında", () => {
  const jan = calendarEntries("2027-01", today, actual(), reminders, true);
  assert.deepEqual(
    jan.filter((e) => e.date.startsWith("2027-01")).map((e) => [e.date, e.item.sourceId, e.forecast]),
    [
      ["2027-01-28", 3, true],
      ["2027-01-28", 2, true],
    ],
  );
  const mar = calendarEntries("2027-03", today, actual(), reminders, true).filter((e) => e.date.startsWith("2027-03"));
  assert.ok(mar.some((e) => e.item.sourceId === 4 && e.date === "2027-03-15" && !e.forecast));
  // Ekim: yakın kira ve yakın fatura gerçek öğe; ızgaranın komşu günü (1 Kasım) de çizilir
  const oct = calendarEntries("2026-10", today, actual(), reminders, true);
  assert.deepEqual(
    oct.filter((e) => e.date.startsWith("2026-10")).map((e) => [e.date, e.item.title, e.forecast]),
    [
      ["2026-10-28", "Kira", false],
      ["2026-10-31", "Yakın fatura", false],
    ],
  );
});

test("takvim: her etkin hatırlatıcının şimdiki dönemi tam bir kez, öngörü yinelenmez", () => {
  for (const month of ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]) {
    const entries = calendarEntries(month, today, actual(), reminders, true);
    const keys = entries.map((e) => `${e.item.source}:${e.item.sourceId}|${e.date}`);
    assert.equal(new Set(keys).size, keys.length, month);
  }
  // Gecikmiş aylığın "Sıradaki dönem"i listede varsa takvimde öngörü olarak tekrar yazılmaz
  const late: ReminderRow = { ...base, id: 9, title: "Geç", amount: 10, dueDate: "2026-10-13", anchorDate: "2026-10-13", repeat: "monthly" };
  const items = upcomingItems([late], [], today);
  assert.deepEqual(items.map((i) => [i.ref, i.projected ?? false]), [
    ["reminder:9", false],
    ["reminder:9@2026-11-13", true],
  ]);
  const nov = calendarEntries("2026-11", today, items, [late], true).filter((e) => e.date === "2026-11-13");
  assert.equal(nov.length, 1);
  assert.equal(nov[0].forecast, false);
});

test("takvim: Fatura süzgecinde öngörü yok, yalnız faturalar", () => {
  const onlyInvoices = actual().filter((i) => i.source === "invoice");
  const dec = calendarEntries("2026-12", today, onlyInvoices, reminders, false);
  assert.deepEqual(dec.map((e) => e.item.title), ["Uzak fatura"]);
});

test("uzak vadeli faturalar listenin ufkunun dışında, takvim listesinde", () => {
  assert.deepEqual(laterInvoiceItems(invoices, today).map((i) => [i.ref, i.dueDate, i.amount]), [["invoice:8", "2026-12-15", 750.25]]);
  assert.deepEqual(upcomingItems([], invoices, today).map((i) => i.ref), ["invoice:7"]);
  // Vadesiz fatura tahmini vadeyle (fatura tarihi + gün)
  const est = laterInvoiceItems([{ id: 9, supplier: "X", invoiceNo: null, date: "2026-11-20", dueDate: null, payable: 1 }], today, { invoiceTermDays: 30 });
  assert.deepEqual(est.map((i) => [i.dueDate, i.detail]), [["2026-12-20", "Ödenmemiş fatura · vade tahmini (30 gün)"]]);
});

test("aylıkta 1 ay ertele sıradaki dönemle çakışır: sunulmaz; haftalıkta 1 hafta da", () => {
  const monthly = { dueDate: "2026-10-28", repeat: "monthly" as const, anchorDate: "2026-10-28" };
  assert.equal(postponePlan(monthly, "month", today).conflict, true);
  assert.equal(postponePlan(monthly, "week", today).conflict, false);
  // Üç aylıkta 1 ay sorun değil
  assert.equal(postponePlan({ ...monthly, repeat: "quarterly" }, "month", today).conflict, false);
  // Gecikmiş aylık: bugünden 1 ay (20.11) sıradaki dönemi (13.11) geçer → çakışır; 1 hafta (27.10) olur
  const late = { dueDate: "2026-10-13", repeat: "monthly" as const, anchorDate: "2026-10-13" };
  assert.deepEqual(postponePlan(late, "month", today), { target: "2026-11-20", next: "2026-11-13", conflict: true });
  assert.deepEqual(postponePlan(late, "week", today), { target: "2026-10-27", next: "2026-11-13", conflict: false });
});

test("Paraşüt eşitlemesi panelde ertelenen vadeyi Paraşüt'te vade değişmedikçe korur", () => {
  // Paraşüt vadesi 13.09; panelde 27.10'a ertelendi; Paraşüt hâlâ 13.09 gönderiyor → panelinki kalır
  assert.equal(syncedDueDate("2026-10-27", "2026-09-13", "2026-09-13"), "2026-10-27");
  // Paraşüt'te vade 30.09 yapıldı → Paraşüt'ünki gelir
  assert.equal(syncedDueDate("2026-10-27", "2026-09-30", "2026-09-13"), "2026-09-30");
  // Paraşüt vade göndermiyor → paneldeki kalır
  assert.equal(syncedDueDate("2026-10-27", null, "2026-09-13"), "2026-10-27");
  assert.equal(syncedDueDate(null, null, undefined), null);
  // Kayıt yok (ilk bağlanma): Paraşüt'ünki
  assert.equal(syncedDueDate("2026-10-27", "2026-09-13", undefined), "2026-09-13");
  // Panelde değişmemiş: aynı değer
  assert.equal(syncedDueDate("2026-09-13", "2026-09-13", "2026-09-13"), "2026-09-13");
  // Önceki eşitlemede Paraşüt'te vade yoktu, şimdi var → Paraşüt'ünki
  assert.equal(syncedDueDate("2026-10-27", "2026-10-01", null), "2026-10-01");
  // Panelde vade kaldırıldı (tahmini vade kullanılsın), Paraşüt aynı → kaldırılmış kalır
  assert.equal(syncedDueDate(null, "2026-09-13", "2026-09-13"), null);
});
