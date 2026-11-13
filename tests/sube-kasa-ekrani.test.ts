// İki şubeli Kasa ekranı, devir zinciri ve istekler (denetim 13 Kasım 2026, P03; src/lib/cash-days.ts,
// src/lib/cash-report.ts, src/lib/cash-requests.ts, src/lib/mcp/answers/cash.ts, src/lib/weekly/items.ts,
// src/app/panel/bugun/logic.ts): "Tümü"de günün her şube raporu ayrı satır, toplamlar hepsinden (HM-X2); açılış ↔ devir
// zinciri şube şube kurulur, kendi içinde tutarlı iki şube sahte "açılış devirle tutmuyor" vermez (HM-X1, HM-07);
// raporlu gün günde bir kez (HM-07); isteğin konusu gün ve şube (KP-X2); e-posta konusu, WhatsApp başlığı ve işlem kaydı
// birden çok şube açıkken şubeyi yazar (KP-07). Veritabanıyla: tests/sube-kasa-ekrani-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-kasa-ekrani.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { cashFlags, CASH_FLAGS } from "../src/app/panel/bugun/logic";
import { branchKeySuffix, cashBranchLabel, DEFAULT_BRANCHES } from "../src/lib/branches";
import { carryByReport, cashDayKey, cashDayRows, cashDayTotals, type CashDayReport } from "../src/lib/cash-days";
import { branchCarryChecks, carryChecks, carryKey, cashLogKey, reportSubject, whatsappText, type CashReportFields } from "../src/lib/cash-report";
import { cashDaySubject, requestBranch, subjectBranch } from "../src/lib/cash-requests";
import { cashReportSummary, type CashReportLike } from "../src/lib/mcp/answers/cash";
import { salesLine } from "../src/lib/weekly/items";

const plain = (t: string) => t.replace(/ /g, " ");

/** Her şube kendi içinde tutarlı: Tuzla her akşam 1.000 ₺ bırakır (açılış 1.000), Marina 500 ₺ */
const day = (date: string, branchId: "tuzla" | "marina", id: number, o: Partial<CashDayReport> = {}): CashDayReport & CashReportLike & { revision: number } => ({
  id,
  branchId,
  date,
  zTotal: branchId === "tuzla" ? 10_000 : 6_000,
  cash: branchId === "tuzla" ? 4_000 : 2_400,
  card: branchId === "tuzla" ? 6_000 : 3_600,
  mealCard: 0,
  online: 0,
  other: 0,
  cashIn: 0,
  cashOut: 0,
  openingCash: branchId === "tuzla" ? 1_000 : 500,
  countedCash: branchId === "tuzla" ? 5_000 : 2_900,
  handedOver: branchId === "tuzla" ? 4_000 : 2_400,
  cashDiff: 0,
  revision: 1,
  ...o,
});
const twoBranches = ["2026-11-02", "2026-11-03", "2026-11-04"].flatMap((d, i) => [day(d, "tuzla", 10 + i * 2), day(d, "marina", 11 + i * 2)]);

test("Günden güne: Tümü'de günün her şube raporu ayrı satır, raporsuz gün tek satır; toplamlar bütün raporlardan, raporlu gün günde bir (HM-X2)", () => {
  const label = (b: string) => (b === "tuzla" ? "Tuzla" : "Marina");
  const rows = cashDayRows("2026-11", "2026-11-05", twoBranches, ["tuzla", "marina"], label);
  // 4 Kasım'dan 1 Kasım'a: 4, 3, 2 iki satır (Tuzla önce), 1 Kasım raporsuz tek satır
  assert.deepEqual(
    rows.map((r) => `${r.date}:${r.report?.branchId ?? "-"}:${r.branch ?? "-"}`),
    ["2026-11-04:tuzla:Tuzla", "2026-11-04:marina:Marina", "2026-11-03:tuzla:Tuzla", "2026-11-03:marina:Marina", "2026-11-02:tuzla:Tuzla", "2026-11-02:marina:Marina", "2026-11-01:-:-"],
  );
  const totals = cashDayTotals(rows);
  // Eski liste gün anahtarlı tek raporluk Map'ti: Marina'nın raporları düşüyor, Z 30.000 kalıyordu
  assert.equal(totals.zTotal, 48_000);
  assert.equal(totals.card, 28_800);
  assert.equal(totals.reported, 3, "raporlu gün günde bir kez");
  assert.equal(totals.days, 4);
  // Satır anahtarı gün ve şube: föy ve kasadan çıkanlar satırın şubesiyle eşleşir
  assert.equal(cashDayKey("2026-11-04", { branchId: "marina" }), "2026-11-04|marina");
  assert.equal(cashDayKey("2026-11-01", null), "2026-11-01");
  // Tek şubede satır şube yazmaz
  assert.equal(cashDayRows("2026-11", "2026-11-05", [day("2026-11-04", "tuzla", 1)])[0].branch, null);
});

test("devir zinciri şube şube: kendi içinde tutarlı iki şube tutmazlık vermez; tutmayan yalnız kendi şubesinde, sonraki ayın ilk raporu şubesinden (HM-X1)", () => {
  // Eski davranış: tek zincir Marina'nın açılışını Tuzla'nın devriyle karşılaştırıp her gün "tutmuyor" diyordu
  assert.equal(carryChecks(twoBranches, null).size, 3);
  assert.equal(branchCarryChecks(twoBranches, null).size, 0);
  // Şube şube zincir başı: Tuzla'nın önceki devri 1.000, Marina'nınki 500
  const before = new Map([
    ["tuzla", { date: "2026-11-01", amount: 1_000 }],
    ["marina", { date: "2026-11-01", amount: 500 }],
  ]);
  assert.equal(branchCarryChecks(twoBranches, before).size, 0);
  // Marina 3 Kasım'da 450 ile açtı: yalnız Marina'nın 3 Kasım'ı (ve 2 Kasım'ın "sonraki" uyarısı)
  const broken = twoBranches.map((r) => (r.branchId === "marina" && r.date === "2026-11-03" ? { ...r, openingCash: 450 } : r));
  const checks = branchCarryChecks(broken, before);
  assert.deepEqual([...checks.keys()], [carryKey({ date: "2026-11-03", branchId: "marina" })]);
  const after = new Map([
    ["tuzla", { date: "2026-12-01", openingCash: 1_000 }],
    ["marina", { date: "2026-12-01", openingCash: 700 }],
  ]);
  const { carry, next } = carryByReport(broken, before, after);
  assert.deepEqual(Object.keys(carry).map(Number), [13], "Marina'nın 3 Kasım raporu");
  assert.equal(carry[13].carry, 500);
  // Sonraki uyarısı aynı şubenin önceki raporunda (Marina 2 Kasım) ve ayın son raporunda (Marina 4 Kasım ↔ 1 Aralık)
  assert.deepEqual(
    Object.keys(next)
      .map(Number)
      .sort((a, b) => a - b),
    [11, 15],
  );
  assert.equal(next[15].opening, 700);
  // Tek devir (tek şubeli liste) her zincirin başıdır
  assert.equal(branchCarryChecks([day("2026-11-02", "tuzla", 1)], { date: "2026-11-01", amount: 900 }).size, 1);
});

test("Bugün ve Claude: iki şubenin raporları sahte açılış uyarısı vermez; Claude'un satırı şubeyi yazar (HM-X1, HM-07)", () => {
  const reports = twoBranches.map((r) => ({ ...r, submittedBy: 7, submittedByName: "Ayşe", updatedAt: "2026-11-04T20:00:00.000Z", createdAt: "2026-11-04T20:00:00.000Z" }));
  const flags = cashFlags(reports as never, null, [], 1);
  for (const [, f] of flags) assert.ok(!f.includes(CASH_FLAGS.carry), "açılış uyarısı yok");
  // Şubenin kendi zincirinde tutmayan gün yine işaretlenir
  const broken = cashFlags(reports.map((r) => (r.branchId === "marina" && r.date === "2026-11-03" ? { ...r, openingCash: 450 } : r)) as never, null, [], 1);
  assert.deepEqual(broken.get("2026-11-03"), [CASH_FLAGS.carry]);
  const summary = cashReportSummary(twoBranches, { from: "2026-11-02", to: "2026-11-04", through: "2026-11-04", firstReport: "2026-11-02", before: null, base: "https://ladmin.laffogato.net" });
  assert.equal(summary.raporSayisi, 6);
  assert.equal(summary.eksikGunSayisi, 0);
  assert.ok(!summary.uyarilar.some((u) => u.includes("devriyle tutmuyor")), summary.uyarilar.join(" | "));
  assert.ok(summary.gunluk.every((g) => !g.acilisDevirleTutmuyor));
  assert.deepEqual([...new Set(summary.gunluk.map((g) => g.sube))].sort(), ["marina", "tuzla"]);
});

test("haftalık özet: raporlu gün günde bir kez; iki şubenin 3 günü '3 gün raporlu' (HM-07)", () => {
  const line = salesLine({ week: { id: "2026-W45", lastFrom: "2026-11-02", lastTo: "2026-11-08" } as never, reports: twoBranches });
  assert.equal(plain(line!), "Geçen hafta kasa cirosu 48.000 ₺ (3 gün raporlu)");
});

test("istek konusu gün ve şube: Tuzla'nınki eskisi gibi, öteki şubeninki şubeli; eski yükün şubesi konudan (KP-X2, KP-02)", () => {
  assert.equal(cashDaySubject("2026-11-12", "tuzla"), "gun:2026-11-12");
  assert.equal(cashDaySubject("2026-11-12", "marina"), "gun:2026-11-12:marina");
  assert.equal(subjectBranch("gun:2026-11-12"), "tuzla");
  assert.equal(subjectBranch("gun:2026-11-12:marina"), "marina");
  assert.equal(requestBranch({ subject: "gun:2026-11-12", payload: { branchId: "marina" } }), "marina", "yükteki şube önce");
  assert.equal(requestBranch({ subject: "gun:2026-11-12:marina", payload: {} }), "marina");
  assert.equal(requestBranch({ subject: "gun:2026-11-12", payload: { date: "2026-11-12" } }), "tuzla", "şubeden önceki istek Tuzla'nın");
  // Zil kimlikleri ve e-posta kaydı: Tuzla'nınki değişmez (okunmuş satırlar okunmuş kalır)
  assert.equal(branchKeySuffix("tuzla", "-"), "");
  assert.equal(branchKeySuffix("marina", "-"), "-marina");
});

test("e-posta ve WhatsApp: birden çok şube açıkken şubenin adı konuda ve başlıkta; işlem kaydı şubeli; tek şubede bugünkü gibi (KP-07)", () => {
  const branches = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));
  assert.equal(cashBranchLabel("marina", branches), "Marina");
  assert.equal(cashBranchLabel("tuzla", branches), "Tuzla");
  // Marina kapalıyken tek fiziksel şube: ad yazılmaz
  assert.equal(cashBranchLabel("tuzla", branches.map((b) => (b.id === "marina" ? { ...b, active: false } : b))), null);
  const f: CashReportFields = {
    date: "2026-11-12",
    zNo: "50",
    receipts: 10,
    zTotal: 6_000,
    cash: 1_000,
    card: 5_000,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 500,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 1_500,
    handedOver: 1_000,
    bankPos: null,
    offRevenue: null,
    note: null,
  };
  assert.equal(plain(reportSubject(f, 1, "Marina")), "Kasa raporu KR-20261112 · Marina · 12 Kasım Perşembe · kasa tutuyor");
  assert.equal(plain(reportSubject(f)), "Kasa raporu KR-20261112 · 12 Kasım Perşembe · kasa tutuyor");
  assert.equal(whatsappText(f, { by: "Deniz", branch: "Marina" }).split("\n")[0], "*L'Affogato · Marina · Gün sonu kasa raporu KR-20261112*");
  assert.equal(whatsappText(f, { by: "Deniz" }).split("\n")[0], "*L'Affogato · Gün sonu kasa raporu KR-20261112*");
  // İki şubenin aynı günkü e-postası işlem kaydında birbirinin üzerine yazılmaz
  assert.equal(cashLogKey({ date: "2026-11-12", branchId: "tuzla", revision: 1 }), "cash:2026-11-12:r1");
  assert.equal(cashLogKey({ date: "2026-11-12", branchId: "marina", revision: 1 }), "cash:2026-11-12:marina:r1");
});
