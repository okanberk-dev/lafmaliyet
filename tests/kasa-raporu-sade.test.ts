// Kasa raporu, sade (sahibin kararı, 4 Kasım 2026): rapor numarası ve yöneticinin penceresindeki tek "Kontrol" listesi
// (src/lib/cash-report.ts reportNo, src/lib/cash-report-checks.ts reportChecks, src/app/panel/kasa/report-sheet.tsx)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { reportNo, reportSubject, whatsappText, type CashReportFields } from "../src/lib/cash-report";
import { reportChecks } from "../src/lib/cash-report-checks";
import { STAFF_EMAIL_ERROR } from "../src/lib/staff-errors";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const plain = (s: string) => s.replace(/ /g, " ");

const day: CashReportFields = {
  date: "2026-11-03",
  zNo: "0312",
  receipts: 214,
  zTotal: 28_450.5,
  cash: 8_210,
  card: 16_120.5,
  mealCard: 2_400,
  online: 1_100,
  other: 620,
  openingCash: 400,
  cashIn: 0,
  cashOut: 870,
  cashOutNote: null,
  countedCash: 7_746.25,
  handedOver: 0,
  bankPos: 16_120.5,
  offRevenue: 145,
  note: null,
};

test("rapor numarası: iş gününden KR-YYYYAAGG; e-posta konusu ve WhatsApp başlığında", () => {
  assert.equal(reportNo("2026-11-03"), "KR-20261103");
  assert.equal(reportNo("2027-01-09"), "KR-20270109");
  assert.match(plain(reportSubject(day)), /^Kasa raporu KR-20261103 · 3 Kasım Salı · 6,25 ₺ fazla$/);
  assert.match(whatsappText(day, { by: "Başak" }), /^\*L'Affogato · Gün sonu kasa raporu KR-20261103\*\n3 Kasım Salı · Başak/);
  // Panel: pencere başlığı, liste satırı, gün görünümünün kayıtlı rapor kartı ve ladmin bölümü
  assert.ok(read("src/app/panel/kasa/cash-history.tsx").includes("title={open ? `Kasa raporu · ${reportNo(open.date)}` : \"\"}"));
  assert.ok(read("src/app/panel/kasa/cash-history.tsx").includes('<span className="tabular">{reportNo(report.date)}</span> · {whoOf(report)}'));
  assert.ok(read("src/app/panel/kasa/cash-form.tsx").includes("title={`Kasa raporu · ${reportNo(date)}`}"));
  assert.ok(read("src/app/panel/kasa/ladmin-report.tsx").includes("Panelde yazılan kasa raporu ${reportNo(report.date)}"));
  assert.ok(read("src/server/notify/cash-report-template.ts").includes("Gün sonu kasa raporu · ${esc(`${reportNo(f.date)}${branchPart(branchName)}`)}"));
});

test("kontrol listesi: sorunsuz raporda boş; her uyarı tek satır, e-posta hatası önce ve kırmızı", () => {
  assert.deepEqual(reportChecks({ report: day }), []);
  const checks = reportChecks({
    report: { ...day, card: 16_000, bankPos: 16_150.5 },
    carry: { date: "2026-11-03", prevDate: "2026-11-02", carry: 6_950, opening: 400, diff: -6_550, gapDays: 0 },
    modposDiffs: [{ field: "zTotal", label: "Toplam satış", saved: 28_450.5, modpos: 28_500 }],
    emailError: "adres geçersiz",
  });
  assert.deepEqual(
    checks.map((c) => [c.key, c.tone, plain(c.text)]),
    [
      ["email", "bad", "E-posta gitmedi: adres geçersiz"],
      ["payments", "warn", "Ödeme türleri toplamı 28.330 ₺: Z toplamından 120,50 ₺ az"],
      ["carry", "warn", "Açılış 400 ₺, 2 Kasım devri 6.950 ₺: 6.550 ₺ az"],
      ["card", "warn", "Banka POS ModPOS kartından 150,50 ₺ fazla"],
      ["modpos:zTotal", "warn", "ModPOS API'den farklı: Toplam satış 28.450,50 ₺ (ModPOS API'de 28.500 ₺)"],
    ],
  );
  // Müdürün ve muhasebecinin penceresi: sabit metin zaten tam cümle, "E-posta gitmedi:" iki kez yazılmaz (bulgu 9)
  assert.deepEqual(
    reportChecks({ report: day, emailError: STAFF_EMAIL_ERROR }).map((c) => [c.key, c.tone, c.text]),
    [["email", "bad", STAFF_EMAIL_ERROR]],
  );
});

test("pencere sade: üç rakam, tek Kontrol, döküm, kapalı Ayrıntılar; satır içi uyarı ve ayrı uyarı kutuları yok", () => {
  const sheet = read("src/app/panel/kasa/report-sheet.tsx");
  for (const t of ['label="Toplam satış"', 'label="Sayılan nakit"', 'label="Kasa"', "Kontrol edilecek ${checks.length} konu", "Kontroller tamam", "Ayrıntılar"]) assert.ok(sheet.includes(t), t);
  const history = read("src/app/panel/kasa/cash-history.tsx");
  for (const t of ["<ReportSheet", "modposDiffs={modposDays[open.date]?.diffs}"]) assert.ok(history.includes(t), t);
  for (const t of ["<ModposDiffList", "<LafposDiffList", "<CashBreakdown", "<DiffHeadline"]) assert.ok(!history.includes(t), `pencerede yok: ${t}`);
});
