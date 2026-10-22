import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  addMonthsAnchored,
  advancePast,
  dayLocativeTR,
  daysBetween,
  digestSummary,
  dueNotifications,
  isVatReminder,
  monthGenitiveTR,
  monthLocativeTR,
  nextOccurrence,
  presetAnchor,
  presetFirstDate,
  REMINDER_PRESETS,
  todayTR,
  upcomingItems,
  vatAmountTravels,
  type ReminderRow,
} from "../src/lib/reminders";

const base: ReminderRow = {
  id: 1,
  title: "Kira",
  kind: "kira",
  amount: 50000,
  dueDate: "2026-10-31",
  anchorDate: "2026-01-31",
  repeat: "monthly",
  remindDaysBefore: 3,
  note: null,
  active: true,
};

test("Türkiye saatine göre bugün", () => {
  // 21:30 UTC = ertesi gün 00:30 İstanbul
  assert.equal(todayTR(new Date("2026-10-19T21:30:00Z")), "2026-10-20");
  assert.equal(todayTR(new Date("2026-10-19T20:30:00Z")), "2026-10-19");
});

test("ay ekleme çapa gününü korur", () => {
  assert.equal(addMonthsAnchored("2026-01-31", 1, 31), "2026-02-28");
  assert.equal(addMonthsAnchored("2026-02-28", 1, 31), "2026-03-31");
  assert.equal(addMonthsAnchored("2026-11-15", 3, 15), "2027-02-15");
  assert.equal(nextOccurrence("2026-10-31", "monthly", "2026-01-31"), "2026-11-30");
  assert.equal(nextOccurrence("2026-11-30", "monthly", "2026-01-31"), "2026-12-31");
  assert.equal(nextOccurrence("2026-10-19", "weekly", "2026-10-19"), "2026-10-26");
  assert.equal(nextOccurrence("2024-02-29", "yearly", "2024-02-29"), "2025-02-28");
  assert.equal(nextOccurrence("2026-10-19", "none", "2026-10-19"), null);
});

test("gün farkı yaz saati değişiminden etkilenmez", () => {
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(daysBetween("2026-10-31", "2026-10-19"), -12);
});

test("yaklaşan ödemeler: hatırlatıcılar ve ödenmemiş faturalar", () => {
  const items = upcomingItems(
    [base, { ...base, id: 2, title: "Pasif", active: false }, { ...base, id: 3, title: "Uzak", dueDate: "2027-06-01" }],
    [
      { id: 9, supplier: "Metro", invoiceNo: "A1", date: "2026-10-01", dueDate: "2026-10-18", payable: 1200 },
      { id: 10, supplier: "Vadesiz", invoiceNo: null, date: "2026-10-01", dueDate: null, payable: 300 },
    ],
    "2026-10-19",
  );
  assert.deepEqual(
    items.map((i) => [i.ref, i.dueDate, i.daysLeft, i.status]),
    [
      ["invoice:9", "2026-10-18", -1, "overdue"],
      ["reminder:1", "2026-10-31", 12, "later"],
      ["invoice:10", "2026-10-31", 12, "later"],
    ],
  );
});

test("bildirim aşamaları ve tekil anahtarlar", () => {
  const items = upcomingItems(
    [
      { ...base, id: 1, dueDate: "2026-10-22" },
      { ...base, id: 2, dueDate: "2026-10-19" },
      { ...base, id: 3, dueDate: "2026-10-10" },
      { ...base, id: 4, dueDate: "2026-09-01" },
      { ...base, id: 5, dueDate: "2026-10-25" },
    ],
    [],
    "2026-10-19",
  );
  assert.deepEqual(
    dueNotifications(items).map((n) => n.key),
    ["reminder:3:2026-10-10:overdue", "reminder:2:2026-10-19:due", "reminder:1:2026-10-22:before"],
  );
});

test("hazır şablon tarihleri", () => {
  const kdv = REMINDER_PRESETS.find((p) => p.key === "kdv")!;
  const sgk = REMINDER_PRESETS.find((p) => p.key === "sgk")!;
  const gecici = REMINDER_PRESETS.find((p) => p.key === "gecici")!;
  assert.equal(presetFirstDate(kdv, "2026-10-19"), "2026-10-28");
  assert.equal(presetFirstDate(kdv, "2026-10-29"), "2026-11-28");
  assert.equal(presetFirstDate(sgk, "2026-02-10"), "2026-02-28");
  assert.equal(presetFirstDate(gecici, "2026-10-19"), "2026-11-17");
  assert.equal(presetFirstDate(gecici, "2026-11-18"), "2027-02-17");
});

test("geciken tekrarlı hatırlatıcının sonraki dönemi de görünür", () => {
  const items = upcomingItems([{ ...base, id: 3, dueDate: "2026-10-28", anchorDate: "2026-10-28", remindDaysBefore: 5 }], [], "2026-11-24");
  assert.deepEqual(
    items.map((i) => [i.ref, i.dueDate, i.daysLeft, i.status]),
    [
      ["reminder:3", "2026-10-28", -27, "overdue"],
      ["reminder:3@2026-11-28", "2026-11-28", 4, "soon"],
    ],
  );
  // Sonraki dönem için "yaklaşıyor" e-postası; anahtar ref'ten değil kaynak + kimlik + vadeden, geciken dönemden ayrı
  assert.deepEqual(dueNotifications(items).map((n) => n.key), ["reminder:3:2026-11-28:before"]);
});

test("geciken dönem ödenince öngörülen dönemin e-postası ikinci kez gitmez", () => {
  // 29.10: Ekim kirası ödenmedi, Kasım dönemi öngörülen satır olarak "yaklaşıyor" e-postasını alır
  const before = upcomingItems([{ ...base, id: 4, dueDate: "2026-10-01", anchorDate: "2026-10-01" }], [], "2026-10-29");
  const sentKeys = dueNotifications(before).map((n) => n.key);
  assert.deepEqual(sentKeys, ["reminder:4:2026-11-01:before"]);
  assert.equal(before.find((i) => i.projected)?.ref, "reminder:4@2026-11-01");
  // 30.10 Ekim "Ödendi" → hatırlatıcı 01.11'e ilerler; 31.10'daki gerçek satır aynı anahtarı üretir (günlükte var)
  const after = upcomingItems([{ ...base, id: 4, dueDate: "2026-11-01", anchorDate: "2026-10-01" }], [], "2026-10-31");
  assert.deepEqual(dueNotifications(after).map((n) => n.key), sentKeys);
  // Fatura anahtarı eski biçimle aynı kalır (günlükteki kayıtlar eşleşmeye devam eder)
  const inv = upcomingItems([], [{ id: 23, supplier: "Kaldi", invoiceNo: null, date: "2026-09-20", dueDate: "2026-10-31", payable: 100, outstanding: null }], "2026-10-31");
  assert.deepEqual(dueNotifications(inv).map((n) => n.key), ["invoice:23:2026-10-31:due"]);
});

test("sabah e-postası özeti: yalnız gidenler yazılır", () => {
  assert.equal(digestSummary({ count: 2, invoices: 4, prices: 1 }), "2 hatırlatma · 4 yeni fatura · 1 zam");
  assert.equal(digestSummary({ count: 0, invoices: 4 }), "4 yeni fatura");
  assert.equal(digestSummary({ count: 0, invoices: 0, prices: 3 }), "3 zam");
  assert.equal(digestSummary({ count: 1, syncError: true }), "1 hatırlatma · Paraşüt eşitleme hatası");
  assert.equal(digestSummary({ count: 0, invoices: 0, prices: 0, syncError: false }), "");
  assert.equal(digestSummary({ count: 1, system: 2 }), "1 hatırlatma · 2 sistem uyarısı");
});

test("uzun hatırlatma süresi 45 günlük pencereye takılmaz; ödendi ilerletmesi", () => {
  const far = upcomingItems([{ ...base, id: 4, dueDate: "2026-12-18", remindDaysBefore: 60, repeat: "none" }], [], "2026-10-19");
  assert.equal(far.length, 1);
  assert.deepEqual(dueNotifications(far).map((n) => n.stage), ["before"]);
  assert.equal(advancePast("2026-08-28", "monthly", "2026-08-28", "2026-10-19"), "2026-10-28");
  assert.equal(advancePast("2026-10-28", "monthly", "2026-10-28", "2026-10-19"), "2026-11-28");
});

test("son gün şablonu her ayın son gününe kayar", () => {
  const sgk = REMINDER_PRESETS.find((p) => p.key === "sgk")!;
  const first = presetFirstDate(sgk, "2026-02-10");
  const anchor = presetAnchor(sgk, first);
  assert.equal(anchor, "2026-02-31");
  assert.equal(nextOccurrence(first, "monthly", anchor), "2026-03-31");
  assert.equal(nextOccurrence("2026-03-31", "monthly", anchor), "2026-04-30");
});

test("KDV hatırlatıcısı: başlıkta KDV ya da katma değer; kira, maaş ve SGK değil", () => {
  for (const [title, kind] of [
    ["KDV beyannamesi ve ödemesi", "vergi"],
    ["Kdv ödemesi", "odeme"],
    ["Eylül KDV'si", "diger"],
    ["Katma değer vergisi", "vergi"],
  ] as const) {
    assert.equal(isVatReminder({ title, kind }), true, title);
  }
  for (const [title, kind] of [
    ["Muhtasar ve prim hizmet beyannamesi", "vergi"],
    ["SGK prim ödemesi", "vergi"],
    ["Kira KDV'si", "kira"],
    ["Kadıköy kira", "kira"],
    ["Maaş KDV", "maas"],
  ] as const) {
    assert.equal(isVatReminder({ title, kind }), false, title);
  }
  // Şablondaki KDV hatırlatıcısı KDV'dir
  const preset = REMINDER_PRESETS.find((p) => p.key === "kdv")!;
  assert.equal(isVatReminder(preset), true);
  // Tutarı yalnız tekrarlı ve tutarlı KDV hatırlatıcısında döneme aittir
  const vat = { title: "KDV beyannamesi ve ödemesi", kind: "vergi" as const, amount: 27_200, repeat: "monthly" as const };
  assert.equal(vatAmountTravels(vat), true);
  assert.equal(vatAmountTravels({ ...vat, repeat: "none" }), false);
  assert.equal(vatAmountTravels({ ...vat, amount: null }), false);
  assert.equal(vatAmountTravels({ ...vat, title: "Kira", kind: "kira" }), false);
});

test("KDV tutarı Ödendi ve ertelemede seriden silinir, geri al geri yazar (sunucu eylemleri)", () => {
  const src = readFileSync(join(process.cwd(), "src/server/actions/reminders.ts"), "utf8");
  const done = src.slice(src.indexOf("export async function markReminderDone"), src.indexOf("type ReminderDbRow"));
  assert.match(done, /const clear = next !== null && vatAmountTravels\(r\);/);
  assert.match(done, /amountCleared: clear/);
  const postpone = src.slice(src.indexOf("export async function postponeReminder"), src.indexOf("export async function postponeInvoice"));
  assert.match(postpone, /vatAmountTravels\(r\)/);
  // Ertelenen dönemin kopyası tutarı taşır
  assert.match(postpone, /amount: r\.amount,/);
  assert.match(src, /function snapshot\(r: ReminderDbRow\) \{\n {2}return \{[^}]*amount: r\.amount/);
  const restore = src.slice(src.indexOf("export async function restoreReminder"), src.indexOf("export async function undoRecentPaid"));
  assert.match(restore, /snap\.amount !== undefined/);
  const undo = src.slice(src.indexOf("export async function undoRecentPaid"), src.indexOf("const zPostpone"));
  // Ödendikten sonra yazılmış tutar ezilmez
  assert.match(undo, /cur\.amount === null/);
  assert.match(readFileSync(join(process.cwd(), "src/app/panel/hatirlaticilar/payment-ui.tsx"), "utf8"), /KDV tutarı her ay değiştiği için silindi\./);
});

test("ay adının ekleri: bulunma ve tamlayan hâli", () => {
  assert.deepEqual(
    ["2026-01", "2026-04", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].map(monthLocativeTR),
    ["Ocak'ta", "Nisan'da", "Ağustos'ta", "Eylül'de", "Ekim'de", "Kasım'da", "Aralık'ta"],
  );
  assert.equal(monthGenitiveTR("2026-09"), "Eylül'ün");
  assert.equal(monthGenitiveTR("2026-07-03"), "Temmuz'un");
  assert.equal(dayLocativeTR("2026-11-01"), "1\u00a0Kasım'da");
});
