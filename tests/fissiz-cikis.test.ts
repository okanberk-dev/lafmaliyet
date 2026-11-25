// Fişsiz "Gün içinde kasadan çıkan" (denetim 25 Kasım 2026, bulgu 2; docs/KASA-RAPORU.md › Gün içinde kasadan
// çıkanlar): personel satır girmeden alana tutar yazınca olması gereken nakit düşer ve açık "tutuyor" görünür. Yöneticinin
// her yeri (onay kartı, Kontrol listesi, ay listesi, gün görünümünün özeti, e-posta, zil) aynı hesabı okur
// (unreceiptedCashOut); personelin formunda ve sunucuda "Neye çıktı" zorunlu (cashOutNoteMissing).
// Çalıştırma: npx tsx --test tests/fissiz-cikis.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { reportAttention, reportFlags } from "../src/lib/cash-attention";
import { cashOutNoteMissing, cashOutNoteOf } from "../src/lib/cash-outs";
import { reportChecks } from "../src/lib/cash-report-checks";
import { cashReportText, whatsappText, type CashReportFields } from "../src/lib/cash-report";
import { unreceiptedCashOut } from "../src/lib/lafpos/prefill";
import { renderCashReport } from "../src/server/notify/cash-report-template";

const plain = (t: string) => t.replace(/ /g, " ");

const day: CashReportFields = {
  date: "2026-11-24",
  zNo: "41",
  receipts: 80,
  zTotal: 9_000,
  cash: 3_000,
  card: 6_000,
  mealCard: 0,
  online: 0,
  other: 0,
  openingCash: 500,
  cashIn: 0,
  cashOut: 650,
  cashOutNote: "süt, buz",
  countedCash: 2_850,
  handedOver: 0,
  bankPos: null,
  offRevenue: null,
  note: null,
};
const lines = [
  { kind: "harcama" as const, amount: 100, store: "Migros", description: "süt" },
  { kind: "harcama" as const, amount: 50, store: null, description: "buz" },
];

test("hesap: satırların toplamından fazlası fişsiz; 1 ₺ altı yok; satırlar fazlaysa fişsiz yok", () => {
  assert.deepEqual(unreceiptedCashOut(650, lines, null), { total: 150, gap: 500, lafposHanded: null, unreceipted: 500 });
  assert.equal(unreceiptedCashOut(150.5, lines, null).unreceipted, 0, "kuruş farkı fişsiz değil");
  assert.equal(unreceiptedCashOut(100, lines, null).unreceipted, 0, "satırlar fazla (fiş kasadan ödenmemiş): fişsiz değil");
  assert.equal(unreceiptedCashOut(500, [], null).unreceipted, 500, "satır yokken bütün tutar fişsiz");
});

test("hesap: LafPOS gününde Kasadan çıkanlar'a girilmemiş teslim fişsiz sayılmaz (E-35), kalanı sayılır", () => {
  const till = { spent: 150, handed: 5_000 };
  assert.deepEqual(unreceiptedCashOut(5_150, lines, till), { total: 150, gap: 5_000, lafposHanded: 5_000, unreceipted: 0 });
  assert.deepEqual(unreceiptedCashOut(5_450, lines, till), { total: 150, gap: 5_300, lafposHanded: 5_000, unreceipted: 300 });
  // Teslim panele "Teslim" satırı olarak girildiyse beklenmez: fark yine fişsiz
  const withTeslim = [...lines, { kind: "teslim" as const, amount: 5_000, store: "patron", description: null }];
  assert.equal(unreceiptedCashOut(5_450, withTeslim, till).unreceipted, 300);
});

test("Neye çıktı: fişsiz tutar varken zorunlu; satırların kendiliğinden yazılan adları yetmez", () => {
  const outsNote = cashOutNoteOf(lines);
  assert.equal(outsNote, "Migros, buz");
  assert.equal(cashOutNoteMissing({ unreceipted: 500, note: null, outsNote }), true);
  assert.equal(cashOutNoteMissing({ unreceipted: 500, note: "  ", outsNote }), true);
  assert.equal(cashOutNoteMissing({ unreceipted: 500, note: "Migros, buz", outsNote }), true, "fişlerin adları fişsiz kısmı açıklamaz");
  assert.equal(cashOutNoteMissing({ unreceipted: 500, note: "Migros, buz, patrona teslim", outsNote }), false);
  assert.equal(cashOutNoteMissing({ unreceipted: 500, note: "bozuk para", outsNote: null }), false);
  assert.equal(cashOutNoteMissing({ unreceipted: 0, note: null, outsNote }), false, "fişsiz yoksa serbest");
});

test("yönetici: Kontrol listesinde ve dikkat özetinde 'Fişsiz çıkış: X ₺', neye çıktığıyla", () => {
  const checks = reportChecks({ report: day, unreceipted: 500 });
  const row = checks.find((c) => c.key === "unreceipted");
  assert.ok(row, "Kontrol listesinde fişsiz çıkış var");
  assert.equal(plain(row.text), "Fişsiz çıkış: 500 ₺ (kasadan çıkan satırlarından fazla); neye çıktı: süt, buz");
  assert.match(plain(reportChecks({ report: { ...day, cashOutNote: null }, unreceipted: 500 }).find((c) => c.key === "unreceipted")?.text ?? ""), /neye çıktığı yazılmadı$/);
  assert.equal(reportChecks({ report: day, unreceipted: null }).some((c) => c.key === "unreceipted"), false);
  assert.deepEqual(reportAttention(reportFlags(day), { unreceipted: 500 }).map(plain), ["Fişsiz çıkış: 500 ₺"]);
  assert.deepEqual(reportAttention(reportFlags(day), { unreceipted: 0.5 }), [], "1 ₺ altı yok");
});

test("e-posta: yöneticinin metninde ve HTML'inde fişsiz çıkış; personelin WhatsApp'ında yok", () => {
  const meta = { by: "Ayşe", unreceipted: 500 };
  assert.match(plain(cashReportText(day, meta, "admin")), /− Gün içinde çıkan: 650 ₺ \(süt, buz\)\n⚠️ Fişsiz çıkış: 500 ₺ \(kasadan çıkan satırlarından fazla\)\n= Olması gereken/);
  assert.doesNotMatch(plain(whatsappText(day, meta)), /Fişsiz/);
  const m = renderCashReport(day, { ...meta, revision: 1, submittedAt: new Date("2026-11-24T20:00:00Z") });
  assert.match(plain(m.html), /Fişsiz çıkış: 500 ₺ \(kasadan çıkan satırlarından fazla\); neye çıktı: süt, buz\./);
  assert.match(plain(m.text), /⚠️ Fişsiz çıkış: 500 ₺/);
  assert.doesNotMatch(renderCashReport(day, { by: "Ayşe", revision: 1, submittedAt: new Date() }).html, /Fişsiz/);
});
