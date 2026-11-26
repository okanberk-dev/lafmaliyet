// Dönem kapanışı (docs/DONEM-KAPANISI.md): hangi ay kapanır, kapalı aya sonradan düşen kayıt hesapta nerede sayılır,
// elle düzeltme kilidi ve kapanış sağlaması. Saatler sabit, veritabanı yok.
// Çalıştırma: npx tsx --test tests/donem-kapanisi.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountDate,
  checkDrift,
  closableMonths,
  closedMonths,
  closeRefusal,
  heldSummary,
  lockRefusal,
  monthLastDay,
  monthTitle,
  parseClosedPeriods,
  periodStateOf,
  prevMonth,
  type ClosedPeriods,
} from "../src/lib/closed-period";

const CLOSED: ClosedPeriods = { months: { "2026-10": { at: "2026-11-05T09:00:00.000Z", by: "Okan" } } };

test("kayıtlı değer: bozuk ay ve bozuk an atlanır, hiç yoksa boş", () => {
  assert.deepEqual(parseClosedPeriods(null), { months: {} }, "boş değer boş liste olmalı");
  assert.deepEqual(parseClosedPeriods({ months: "x" }), { months: {} }, "bozuk alan boş liste olmalı");
  const p = parseClosedPeriods({
    months: {
      "2026-10": { at: "2026-11-05T09:00:00.000Z", by: "Okan", check: { invoices: 3, invoiceTotal: 100.5, expenses: 1, expenseTotal: "x" } },
      "2026-13": { at: "2026-11-05T09:00:00.000Z", by: "Okan" },
      "2026-09": { at: "dün", by: "Okan" },
      "2026-08": { at: "2026-09-02T00:00:00.000Z" },
    },
  });
  assert.deepEqual(closedMonths(p), ["2026-10", "2026-08"], "geçersiz ay ve an atlanmalı, sıra yeniden eskiye");
  assert.deepEqual(p.months["2026-10"].check, { invoices: 3, invoiceTotal: 100.5, expenses: 1, expenseTotal: 0 }, "sağlamada bozuk sayı 0 olmalı");
  assert.equal(p.months["2026-08"].by, "Yönetici", "adı olmayan kapanış 'Yönetici' yazmalı");
});

test("ay adları ve komşu aylar", () => {
  assert.equal(monthTitle("2026-10"), "Ekim 2026", "ay adı Türkçe olmalı");
  assert.equal(prevMonth("2026-01"), "2025-12", "ocaktan önce geçen yılın aralığı gelmeli");
  assert.equal(prevMonth("2026-11"), "2026-10", "önceki ay");
  assert.equal(monthLastDay("2024-02"), "2024-02-29", "artık yılda şubat 29 çeker");
  assert.equal(monthLastDay("2026-11"), "2026-11-30", "kasım 30 çeker");
});

test("yalnız bitmiş ve açık ay kapanır", () => {
  assert.equal(closeRefusal("2026-10", "2026-11-26", { months: {} }), null, "bitmiş ay kapanabilmeli");
  assert.match(closeRefusal("2026-11", "2026-11-26", { months: {} }) ?? "", /daha bitmedi/, "içinde bulunulan ay kapanmamalı");
  assert.match(closeRefusal("2026-12", "2026-11-26", { months: {} }) ?? "", /daha bitmedi/, "gelecek ay kapanmamalı");
  assert.match(closeRefusal("2026-10", "2026-11-26", CLOSED) ?? "", /zaten kapalı/, "kapalı ay ikinci kez kapanmamalı");
  assert.equal(closeRefusal("ekim", "2026-11-26", CLOSED), "Ay seçin", "geçersiz ay reddedilmeli");
  assert.deepEqual(closableMonths("2026-11-26", CLOSED, 3), ["2026-09", "2026-08"], "kapalı ay listede olmamalı, bugünün ayı da");
});

test("kapanıştan sonra kapalı aya düşen kayıt bekler; öncesinde açılan ayın rakamındadır", () => {
  const before = { date: "2026-10-28", createdAt: "2026-10-29T10:00:00.000Z", periodDate: null };
  const after = { date: "2026-10-28", createdAt: new Date("2026-11-12T10:00:00.000Z"), periodDate: null };
  const open = { date: "2026-11-03", createdAt: "2026-11-12T10:00:00.000Z", periodDate: null };
  assert.deepEqual(periodStateOf(before, CLOSED), { kind: "normal" }, "kapanıştan önce açılan kayıt normal olmalı");
  assert.deepEqual(periodStateOf(after, CLOSED), { kind: "held", month: "2026-10" }, "kapanıştan sonra açılan kayıt beklemeli");
  assert.deepEqual(periodStateOf(open, CLOSED), { kind: "normal" }, "açık ayın kaydı normal olmalı");
  assert.equal(accountDate(before, CLOSED), "2026-10-28", "normal kayıt kendi tarihinde sayılır");
  assert.equal(accountDate(after, CLOSED), null, "bekleyen kayıt hiçbir hesaba girmemeli");
  assert.deepEqual(periodStateOf({ ...after, createdAt: "2026-11-05T09:00:00.000Z" }, CLOSED), { kind: "normal" }, "tam kapanış anında açılan kayıt ayın rakamındadır");
  assert.deepEqual(periodStateOf({ ...after, createdAt: "bozuk" }, CLOSED), { kind: "held", month: "2026-10" }, "anı okunamayan kayıt tutucu davranıp beklemeli");
});

test("yöneticinin kararı: açık aya alınan karar gününde, kapalı aya işlenen kendi tarihinde sayılır", () => {
  const moved = { date: "2026-10-28", createdAt: "2026-11-12T10:00:00.000Z", periodDate: "2026-11-12" };
  const accepted = { date: "2026-10-28", createdAt: "2026-11-12T10:00:00.000Z", periodDate: "2026-10-28" };
  assert.deepEqual(periodStateOf(moved, CLOSED), { kind: "moved", month: "2026-10", on: "2026-11-12" }, "başka güne alınan kayıt 'moved' olmalı");
  assert.equal(accountDate(moved, CLOSED), "2026-11-12", "açık aya alınan kayıt karar gününde sayılır");
  assert.deepEqual(periodStateOf(accepted, CLOSED), { kind: "accepted", month: "2026-10" }, "kendi tarihine işlenen kayıt 'accepted' olmalı");
  assert.equal(accountDate(accepted, CLOSED), "2026-10-28", "kapalı aya işlenen kayıt kendi tarihinde sayılır");
  // Ay yeniden açılırsa karar yerinde kalır; kararsız bekleyen kendiliğinden aya girer
  assert.equal(accountDate(moved, { months: {} }), "2026-11-12", "dönem açılsa da verilen karar değişmemeli");
  assert.equal(accountDate({ ...moved, periodDate: null }, { months: {} }), "2026-10-28", "dönem açılınca bekleyen kayıt kendi ayına girmeli");
  assert.equal(accountDate({ ...moved, periodDate: "bozuk" }, CLOSED), null, "bozuk karar yok sayılır, kayıt bekler");
});

test("elle düzeltme kilidi: kapalı ayın kaydı da, kapalı aya taşıma da reddedilir", () => {
  assert.equal(lockRefusal(["2026-11-03"], CLOSED), null, "açık ayın kaydı düzeltilebilmeli");
  assert.match(lockRefusal(["2026-10-28"], CLOSED) ?? "", /Ekim 2026 dönemi kapalı/, "kapalı ayın kaydı düzeltilememeli");
  assert.match(lockRefusal(["2026-11-03", "2026-10-30"], CLOSED) ?? "", /Ekim 2026 dönemi kapalı/, "kapalı aya taşıma reddedilmeli");
  assert.equal(lockRefusal([null, undefined], CLOSED), null, "bekleyen kayıt (hesap günü yok) kilitli olmamalı");
});

test("kapanış sağlaması: sayı ya da toplam değişince söyler, kuruş altı farkı saymaz", () => {
  const saved = { invoices: 10, invoiceTotal: 1500, expenses: 4, expenseTotal: 300 };
  assert.equal(checkDrift(saved, { ...saved }), null, "aynı rakamlar uyarı vermemeli");
  assert.equal(checkDrift(saved, { ...saved, invoiceTotal: 1500.004 }), null, "kuruş altı fark uyarı vermemeli");
  assert.equal(checkDrift(undefined, saved), null, "sağlaması olmayan eski kapanış uyarı vermemeli");
  const drift = checkDrift(saved, { ...saved, invoices: 9, invoiceTotal: 1400 }) ?? "";
  assert.match(drift, /faturalar 10 adet 1\.500,00 ₺ idi, şimdi 9 adet 1\.400,00 ₺/, "fatura farkı okunur yazılmalı");
  assert.ok(!drift.includes("harcamalar"), "değişmeyen harcama cümlede geçmemeli");
});

test("bekleyenlerin tek satırı", () => {
  assert.equal(heldSummary({ invoices: 0, expenses: 0 }), null, "bekleyen yoksa satır yok");
  assert.match(heldSummary({ invoices: 2, expenses: 1 }) ?? "", /^2 fatura ve 1 harcama kapalı döneme düştü/, "iki tür birlikte yazılmalı");
  assert.match(heldSummary({ invoices: 0, expenses: 3 }) ?? "", /^3 harcama kapalı döneme düştü/, "yalnız harcama");
});
