// Kör kasa (Marina; denetim 25 Kasım 2026, bulgu 0; docs/LAFPOS.md › Kör kasa): LafPOS'ta kasiyer çekmeceyi kör sayar.
// Panel de personele LafPOS gününde açılışı, sayılan nakdi, teslimi, olması gerekeni ve kasa farkını göstermez: kayıtlı
// rapor kartı, döküm, Bugün, Son 7 gün ve RSC yükü. Yönetici her şeyi görür. Sunucu yolları (yükleyici, ret)
// tests/lafpos-gun-sonu-tam-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/kor-kasa.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { dayTasks, type CashLite, type DayFacts } from "../src/app/panel/bugun/logic";
import { type CashReportFields } from "../src/lib/cash-report";
import { autoValuesOf } from "../src/lib/lafpos/gun-sonu";
import { BLIND_TEXT, blindLafposDay, blindNote, blindReport, staffBlindDay } from "../src/lib/lafpos/kor-kasa";
import { lafposDayOf } from "../src/lib/lafpos/prefill";
import type { PosDayZ } from "../src/lib/lafpos/day";

const plain = (t: string) => t.replace(/ /g, " ");

const Z: PosDayZ = {
  zNo: 7,
  receipts: 40,
  zTotal: 9_000,
  cash: 3_000,
  card: 6_000,
  mealCard: 0,
  online: 0,
  other: 0,
  offRevenue: 0,
  discounts: 0,
  openingCash: 1_234.5,
  cashOut: 150,
  countedCash: 3_333.25,
  handedOver: 0,
  cashDiff: -751.25,
  cashIn: 0,
  expectedCash: 4_084.5,
  expectedOpening: 1_200,
  openingDiff: 34.5,
  openingReason: "bozuk para kondu",
  closeNote: "Kapanış sakin geçti",
};

/** Otomatik raporun kendisi (notu gerçek üreticiden: açılış cümleleri ve kapanış notu) */
const auto = autoValuesOf("2026-11-24", Z, { count: 0, total: 0, note: null }, { date: "2026-11-23", amount: 1_100 });
const report: CashReportFields & { cashDiff: number } = {
  date: "2026-11-24",
  zNo: "7",
  receipts: 40,
  zTotal: 9_000,
  cash: 3_000,
  card: 6_000,
  mealCard: 0,
  online: 0,
  other: 0,
  openingCash: Z.openingCash,
  cashIn: 0,
  cashOut: 150,
  cashOutNote: null,
  countedCash: Z.countedCash!,
  handedOver: 0,
  bankPos: null,
  offRevenue: 0,
  note: typeof auto.note === "string" ? auto.note : null,
  cashDiff: -751.25,
};
/** Sayımı ele veren rakamlar (metinde biçimiyle de aranır) */
const SECRETS = ["1234.5", "1.234,50", "3333.25", "3.333,25", "751.25", "751,25", "4.084,50", "1.200", "1.100"];

test("kural: yalnız personel, yalnız LafPOS'un şubesinin LafPOS günü", () => {
  assert.equal(staffBlindDay({ admin: false, branchId: "marina", lafposDay: true, lafposBranch: "marina" }), true);
  assert.equal(staffBlindDay({ admin: true, branchId: "marina", lafposDay: true, lafposBranch: "marina" }), false, "yönetici görür");
  assert.equal(staffBlindDay({ admin: false, branchId: "tuzla", lafposDay: true, lafposBranch: "marina" }), false, "ModPOS'taki şube eskisi gibi");
  assert.equal(staffBlindDay({ admin: false, branchId: "marina", lafposDay: false, lafposBranch: "marina" }), false, "geçiş gününden önce eskisi gibi");
});

test("rapor: açılış, sayılan, teslim ve fark personelin yükünde yok; notun açılış cümleleri çıkar, kapanış notu kalır", () => {
  assert.match(report.note ?? "", /Açılış önceki raporun devrinden/, "gerçek not açılışı söylüyor");
  const b = blindReport(report);
  assert.deepEqual([b.openingCash, b.countedCash, b.handedOver, b.cashDiff, b.blind], [0, 0, 0, 0, true]);
  assert.deepEqual([b.zTotal, b.cash, b.card, b.cashOut], [9_000, 3_000, 6_000, 150], "Z ve gün içinde çıkan kalır");
  const json = plain(JSON.stringify(b));
  for (const v of SECRETS) assert.ok(!json.includes(v), `yükte ${v} var: ${json}`);
  assert.equal(
    b.note,
    "LafPOS gün sonundan otomatik yazıldı. Kapanış notu (LafPOS): Kapanış sakin geçti. Eksik: Banka POS: LafPOS'tan Pavo gün sonu gelmedi · Yazarkasa: LafPOS'ta cihaz belgesi yok.",
  );
  // Panelin devir denetimi tutmadıysa ve LafPOS'un beklediği yazıldıysa ikisi de çıkar; eksik bölümü kalır (staffAutoNote işler)
  assert.equal(
    blindNote("LafPOS gün sonundan otomatik yazıldı. Açılış LafPOS'ta beklenenden 20,50 ₺ fazla (beklenen 1.279,50 ₺); neden: bozuk. para. Eksik: Banka POS: LafPOS'tan Pavo gün sonu gelmedi."),
    "LafPOS gün sonundan otomatik yazıldı. Eksik: Banka POS: LafPOS'tan Pavo gün sonu gelmedi.",
  );
  assert.equal(blindNote("Açılış notu (LafPOS): bozuk para."), null);
  assert.equal(blindNote(null), null);
});

test("LafPOS'un gün sonu: personele açılış, sayım ve LafPOS'un olması gereken satırı gitmez", () => {
  const day = lafposDayOf({ ...Z, expectedCash: 9_999 }, "2026-11-24T21:00:00.000Z");
  assert.ok(day.prefill.values.countedCash && day.prefill.checks.length, "yöneticinin hâlinde var");
  const b = blindLafposDay(day);
  assert.deepEqual(Object.keys(b.prefill.values).filter((k) => ["openingCash", "countedCash", "handedOver"].includes(k)), []);
  assert.deepEqual([b.prefill.checks, b.prefill.missing], [[], []]);
  assert.equal(b.prefill.values.zTotal?.value, 9_000, "Z kalır");
  const json = plain(JSON.stringify(b));
  for (const v of ["1234.5", "3333.25", "9.999", "9999"]) assert.ok(!json.includes(v), `yükte ${v} var`);
});

test("döküm: kör raporda kasa bölümü yalnız nakit satış ve çıkan; yönetici bütün satırları görür", async () => {
  // Bileşenin dosyası bir sunucu eylemini içe aktarır ("server-only" Next dışında hata fırlatır)
  const require = createRequire(import.meta.url);
  const marker = require.resolve("server-only");
  require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
  const { CashBreakdown } = await import("../src/app/panel/kasa/cash-summary");
  const b = blindReport(report);
  const staffHtml = plain(renderToStaticMarkup(createElement(CashBreakdown, { report: b, audience: "staff", kasa: "LafPOS", blind: true })));
  for (const w of ["Açılış", "Olması gereken", "Sayılan", "Fark", "Ertesi güne devir", "Kasa tutuyor"]) assert.ok(!staffHtml.includes(w), `personelde ${w} var`);
  assert.ok(staffHtml.includes(BLIND_TEXT.breakdown));
  assert.match(staffHtml, /Nakit satış[\s\S]*3\.000 ₺/);
  const adminHtml = plain(renderToStaticMarkup(createElement(CashBreakdown, { report, audience: "admin", kasa: "LafPOS" })));
  for (const w of ["Açılış", "Olması gereken", "Sayılan", "751,25 ₺ eksik"]) assert.ok(adminHtml.includes(w), `yöneticide ${w} yok`);
});

test("Bugün: personelin LafPOS günü satırı farkı yazmaz; ModPOS günü ve yönetici eskisi gibi", () => {
  const now = new Date("2026-11-24T22:00:00+03:00");
  const lite = (o: Partial<CashLite>): CashLite => ({ date: "2026-11-24", cashDiff: 0, zTotal: 9_000, cash: 3_000, card: 6_000, submittedByName: "LafPOS (otomatik)", revision: 1, note: null, ...o });
  const facts = (r: CashLite, role: "staff" | "admin" = "staff"): DayFacts =>
    ({ role, now, cash: { today: r, yesterday: null, firstDate: "2026-11-01" }, waste: { count: 0, zayi: null, ikram: null }, stock: null, ...(role === "admin" ? { system: [], payments: [], invoices: { review: 0 } } : {}) }) as DayFacts;
  const kasa = (f: DayFacts) => dayTasks(f).find((t) => t.key === "kasa");
  const done = kasa(facts(lite({ blind: true, lafposPhoto: "done" })));
  assert.equal(plain(done?.detail ?? ""), "LafPOS gün sonu · Fotoğraf alındı");
  const manual = kasa(facts(lite({ blind: true, submittedByName: "Ali" })));
  assert.equal(plain(manual?.detail ?? ""), "Ali gönderdi");
  // ModPOS günü (kör değil): fark yazar (sıfırlanmış değil, gerçek fark)
  assert.match(plain(kasa(facts(lite({ cashDiff: -120, submittedByName: "Ayşe" })))?.detail ?? ""), /Ayşe gönderdi · 120 ₺ eksik/);
  // Yönetici kör değildir: satır gerçek farkla
  assert.match(plain(kasa(facts(lite({ cashDiff: -751.25 }), "admin"))?.badge ?? ""), /751,25 ₺ eksik/);
});
