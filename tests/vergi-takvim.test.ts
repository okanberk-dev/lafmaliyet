// Vergi takviminin günleri ve dönemleri (plan docs/planlar/vergi.md §3.1, §11-G): VUK 18 kaydırması (hafta sonu,
// resmî tatil ve bayram; arife kaydırmaz; tablo 2028'de biter), nominal günler, hesap dönemi ve çeyrekler, hatırlatıcı
// gününden dönem, varsayılan yıl ve çeyrek. Takvimin satırları (Excel, 24.10.2026) tests/vergi-gorunum.test.ts'te.
// Çalıştırma: npx tsx --test tests/vergi-takvim.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultQuarter,
  defaultYear,
  legalDayText,
  legalDueDate,
  mphbPeriodOf,
  nominalDue,
  periodOf,
  periodQuarters,
  quarterLabel,
  quarterOfDue,
  quarterRange,
  shiftText,
  yearOptions,
} from "../src/lib/tax/calendar";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";

const S = DEFAULT_TAX_SETTINGS;
const plain = (s: string | null) => s?.replace(/ /g, " ") ?? null;

test("G: legalDueDate (VUK 18)", () => {
  const cases: [string, string][] = [
    ["2026-10-25", "2026-10-26"], // Pazar
    ["2026-11-28", "2026-11-30"], // Cumartesi
    ["2026-10-31", "2026-11-02"], // Cumartesi
    ["2026-10-29", "2026-10-30"], // Cumhuriyet Bayramı, Perşembe
    ["2026-10-28", "2026-10-28"], // arife kaydırmaz
    ["2026-05-17", "2026-05-18"], // Pazar
    ["2027-03-10", "2027-03-12"], // Ramazan Bayramı
    ["2026-12-26", "2026-12-28"], // Cumartesi
    ["2027-01-31", "2027-02-01"], // Pazar
    ["2029-01-06", "2029-01-08"], // tablo dışı Cumartesi
    ["2026-11-17", "2026-11-17"], // Salı
    ["2026-05-26", "2026-05-26"], // Kurban arifesi
    ["2026-05-27", "2026-06-01"], // Kurban Bayramı 27–30 Mayıs, 31 Mayıs Pazar
  ];
  for (const [input, out] of cases) assert.equal(legalDueDate(input).date, out, input);
  assert.deepEqual(legalDueDate("2026-10-25"), { date: "2026-10-26", nominal: "2026-10-25", shifted: true, reason: "25 Ekim Pazar" });
  assert.equal(legalDueDate("2026-10-29").reason, "29 Ekim Cumhuriyet Bayramı");
  assert.equal(legalDueDate("2026-10-28").shifted, false);
  assert.equal(legalDueDate("2026-10-28").reason, null);
  assert.equal(legalDueDate("2029-01-06").reason, "tatil listesi 2028'de bitiyor");
  assert.equal(legalDueDate("2029-01-03").reason, "tatil listesi 2028'de bitiyor");
  assert.equal(plain(shiftText(legalDueDate("2026-10-25"))), "Son gün 25 Ekim Pazar → 26 Ekim");
  assert.equal(shiftText(legalDueDate("2026-11-17")), null);
  assert.equal(legalDayText(legalDueDate("2026-10-31")), "son gün 2 Kasım Pazartesi (31 Ekim Cumartesi)");
  assert.equal(legalDayText(legalDueDate("2026-11-26")), "son gün 26 Kasım Perşembe");
});

test("G: nominal günler", () => {
  assert.equal(nominalDue("kdv1", "2026-09"), "2026-10-28");
  assert.equal(nominalDue("kdv2", "2026-09"), "2026-10-25");
  assert.equal(nominalDue("mphb", "2026-09"), "2026-10-26");
  assert.equal(nominalDue("sgk", "2026-09"), "2026-10-31");
  assert.equal(nominalDue("sgk", "2026-12"), "2027-01-31");
  assert.equal(nominalDue("sgk", "2027-01"), "2027-02-28");
  assert.equal(nominalDue("gecici", "2026-Q1"), "2026-05-17");
  assert.equal(nominalDue("gecici", "2026-Q2"), "2026-08-17");
  assert.equal(nominalDue("gecici", "2026-Q3"), "2026-11-17");
  assert.equal(nominalDue("gecici", "2026-Q4"), "2027-02-17");
  assert.equal(nominalDue("kv", "2026"), "2027-04-30");
  assert.equal(nominalDue("ctv", "2026-1"), "2026-05-31");
  assert.equal(nominalDue("ctv", "2026-2"), "2026-11-30");
  assert.equal(legalDueDate(nominalDue("kv", "2026")).date, "2027-04-30");
});

test("G: hatırlatıcı gününden dönem", () => {
  assert.equal(quarterOfDue("2027-02-17"), "2026-Q4");
  assert.equal(quarterOfDue("2026-11-17"), "2026-Q3");
  assert.equal(quarterOfDue("2026-08-17"), "2026-Q2");
  assert.equal(quarterOfDue("2026-05-17"), "2026-Q1");
  // Ertelenmiş kopya (asıl günü ayrıca okunur) ve tatil kayması
  assert.equal(quarterOfDue("2026-11-24"), "2026-Q3");
  assert.equal(quarterOfDue("2026-12-01"), "2026-Q3");
  assert.equal(quarterOfDue("2027-03-01"), "2026-Q4");
  assert.equal(quarterLabel("2026-Q3"), "2026/3");
  assert.equal(mphbPeriodOf("2026-10-26"), "2026-09");
  assert.equal(mphbPeriodOf("2026-11-02"), "2026-09");
  assert.equal(mphbPeriodOf("2026-11-26"), "2026-10");
});

test("G: hesap dönemi 25.06–31.12.2026; Q1 dönem dışı, Q2 25.06–30.06", () => {
  assert.deepEqual(periodOf(2026, S), { from: "2026-06-25", to: "2026-12-31" });
  assert.deepEqual(periodOf(2027, S), { from: "2027-01-01", to: "2027-12-31" });
  assert.equal(periodOf(2025, S), null);
  assert.equal(quarterRange("2026-Q1", S), null);
  assert.deepEqual(quarterRange("2026-Q2", S), { from: "2026-06-25", to: "2026-06-30" });
  assert.deepEqual(quarterRange("2026-Q3", S), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(
    periodQuarters(2026, S).map((q) => q.key),
    ["2026-Q2", "2026-Q3", "2026-Q4"],
  );
  assert.equal(periodQuarters(2027, S).length, 4);
});

test("G: varsayılan yıl ve çeyrek; yıl seçicisi 2026 boyunca yok", () => {
  assert.equal(defaultYear("2027-03-01", [], S), 2026);
  assert.equal(defaultYear("2027-03-01", [{ period: "2026" }], S), 2027);
  assert.equal(defaultYear("2027-04-30", [], S), 2026);
  assert.equal(defaultYear("2027-05-01", [], S), 2027);
  assert.equal(defaultYear("2026-10-24", [], S), 2026);
  assert.deepEqual(yearOptions("2026-10-24", S), [2026]);
  assert.deepEqual(yearOptions("2027-03-01", S), [2026, 2027]);
  assert.equal(defaultQuarter("2026-10-24", 2026, S), "2026-Q3");
  assert.equal(defaultQuarter("2026-11-17", 2026, S), "2026-Q3");
  assert.equal(defaultQuarter("2026-11-18", 2026, S), "2026-Q4");
  assert.equal(defaultQuarter("2026-07-01", 2026, S), "2026-Q2");
  // Önceki yıl seçildi: o yılın son çeyreği
  assert.equal(defaultQuarter("2027-03-01", 2026, S), "2026-Q4");
  assert.equal(defaultQuarter("2027-03-01", 2027, S), "2027-Q1");
  assert.equal(defaultQuarter("2026-10-24", 2025, S), null);
});
