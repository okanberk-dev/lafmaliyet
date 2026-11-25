// Dalga 1'in incelemesi (25 Kasım 2026): üç bağımsız incelemenin bulguları. Kör kasa okuma düşünce kapalı kalır, ortak
// telefonda taslak başkasının fotoğrafını getirmez, ayrılma penceresi hedefe göre konuşur, fişsiz çıkış eski günlerde ve
// LafPOS gün sonu gelmeden hesaplanmaz, "Tümü"nün ortak dönemi olmayan ayında Genel bakış çelişmez, standart sabit
// giderle net kâr dışa aktarımda kalır. Sunucu yolları (gönderen korunur) tests/lafpos-gun-sonu-tam-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/dalga1-inceleme.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildWorkbook } from "../src/app/api/export/workbook";
import { monthTaskFacts, monthTasks } from "../src/app/panel/dashboard-tasks";
import { droppedPhotosText, leaveDialogText, leaveDropsDraft, restorableDraftPhotos, type CashDraftPhoto } from "../src/lib/cash-draft";
import { createModel } from "../src/lib/calc/engine";
import { dashboard } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { BLIND_TEXT, staffBlindView } from "../src/lib/lafpos/kor-kasa";
import { lafposMovesPending, UNRECEIPTED_SINCE, unreceiptedCashOut } from "../src/lib/lafpos/prefill";
import { commonListSourceLine, commonListWaitText } from "../src/lib/lafpos/sales";
import { excelToDataset, investmentSeed, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));

// ---------------------------------------------------------------- Kör kasa

test("kör kasa: LafPOS okunamayınca (null) LafPOS'un şubesinde personele kör; Tuzla ve yönetici değişmez", () => {
  assert.equal(staffBlindView({ admin: false, branchId: "marina", lafposDay: null }), true, "okuma düştü: kapalı");
  assert.equal(staffBlindView({ admin: false, branchId: "tuzla", lafposDay: null }), false, "ModPOS şubesi kör değil");
  assert.equal(staffBlindView({ admin: true, branchId: "marina", lafposDay: null }), false, "yönetici görür");
  // Kütükten gelen LafPOS şubesi geri düşüşün yerine geçer
  assert.equal(staffBlindView({ admin: false, branchId: "tuzla", lafposDay: null, lafposBranch: "tuzla" }), true);
  // Okunduysa geçiş gününün kuralı
  assert.equal(staffBlindView({ admin: false, branchId: "marina", lafposDay: false }), false, "geçiş gününden önce");
  assert.equal(staffBlindView({ admin: false, branchId: "marina", lafposDay: true }), true);
});

test("kör kasa: elle girilmiş raporun satırı 'Rakamlar LafPOS'tan geldi' demez; alt başlık 'nakdi sayın' demez", () => {
  assert.doesNotMatch(BLIND_TEXT.manualLine, /LafPOS'tan geldi/);
  assert.match(BLIND_TEXT.manualLine, /yönetici kontrol eder/);
  assert.doesNotMatch(BLIND_TEXT.description, /sayın|girin/);
});

// ---------------------------------------------------------------- Kasa taslağı (ortak telefon)

const photos: CashDraftPhoto[] = [
  { id: 1, kind: "kasa-z", createdAt: "2026-11-24T19:55:00.000Z", byName: "Ayşe" },
  { id: 2, kind: "kasa-okc", createdAt: "2026-11-24T19:56:00.000Z", byName: "Ayşe" },
  { id: 3, kind: "kasa-pos", createdAt: "2026-11-24T19:57:00.000Z", byName: "Mehmet" },
];

test("taslak: personel yalnız kendi yüklediği fotoğrafı geri alır, gelmeyenin sayısı söylenir; yönetici hepsini", () => {
  const mehmet = restorableDraftPhotos(photos, { admin: false, me: "Mehmet" });
  assert.deepEqual(
    mehmet.kept.map((p) => p.id),
    [3],
  );
  assert.equal(mehmet.dropped, 2);
  assert.equal(droppedPhotosText(mehmet.dropped), "Başkasının yüklediği 2 fotoğraf geri yüklenmez; yeniden çekin.");
  const ayse = restorableDraftPhotos(photos, { admin: false, me: "Ayşe" });
  assert.deepEqual([ayse.kept.length, ayse.dropped], [2, 1]);
  const admin = restorableDraftPhotos(photos, { admin: true, me: "Ali" });
  assert.deepEqual([admin.kept.length, admin.dropped], [3, 0]);
});

test("ayrılma penceresi hedefe göre: başka sayfa nötr 'Sayfadan çık', başka gün ya da şube kırmızı 'Taslağı silip geç'", () => {
  const day = "2026-11-24";
  const today = "2026-11-24";
  const toToday = leaveDialogText(leaveDropsDraft("/panel/bugun", day, today));
  assert.equal(toToday.tone, "primary");
  assert.equal(toToday.confirmLabel, "Sayfadan çık");
  assert.doesNotMatch(toToday.description, /silinir/);
  assert.match(toToday.description, /bu cihazda kalır/i);
  const otherDay = leaveDialogText(leaveDropsDraft("/panel/kasa?gun=2026-11-23", day, today));
  assert.equal(otherDay.tone, "danger");
  assert.equal(otherDay.confirmLabel, "Taslağı silip geç");
  assert.match(otherDay.description, /silinir/);
  assert.equal(leaveDialogText(leaveDropsDraft("/panel/kasa?sube=marina", day, today)).tone, "danger", "şube değişimi");
});

// ---------------------------------------------------------------- Fişsiz çıkış

test("fişsiz çıkış: Kasadan çıkanlar'dan (23 Ekim 2026) önceki gün sayılmaz; sonrası aynı kural", () => {
  assert.equal(UNRECEIPTED_SINCE, "2026-10-23");
  const before = unreceiptedCashOut(200, [], null, "2026-10-01");
  assert.equal(before.unreceipted, 0);
  assert.equal(before.gap, 200, "fark yine hesaplanır (yalnız uyarı yok)");
  assert.equal(unreceiptedCashOut(200, [], null, "2026-10-23").unreceipted, 200);
  assert.equal(unreceiptedCashOut(200, [], null).unreceipted, 200, "gün verilmezse eskisi gibi");
});

test("fişsiz çıkış: LafPOS gününde gün sonu gelmeden hesaplanmaz (hareketler bekleniyor)", () => {
  assert.equal(lafposMovesPending({ lafpos: true, day: null }), true);
  assert.equal(lafposMovesPending({ lafpos: false, day: null }), false, "ModPOS günü");
  assert.equal(lafposMovesPending(null), false);
  assert.equal(lafposMovesPending(undefined), false);
});

// ---------------------------------------------------------------- "Tümü"nün ortak dönemi olmayan ay (bulgu 62)

test("Tümü: listesi olmayan ayda kaynak satırı ve iş 'LafPOS sayılıyor' demez", () => {
  assert.equal(commonListWaitText("2026-11", "Tuzla", true), "Tümü'de bu ayın satışları Tuzla'nın listesi gelince sayılır; şubeyi seçince gün gün görünür.");
  assert.match(commonListWaitText("2026-11", "Tuzla", false), /^Tuzla'nın Kasım 2026 satış listesi yüklenmedi/);
  assert.equal(commonListSourceLine("Tuzla"), "Satışlar: Tümü'de Tuzla'nın listesi gelince (şube seçiliyken gün gün)");
  assert.doesNotMatch(commonListSourceLine("Tuzla"), /LafPOS/);
});

function tasksFor(month: string, current: string, commonMissing: boolean) {
  const base: Dataset = { ...excelToDataset(data), currentMonth: current };
  const ds: Dataset = {
    ...base,
    // Ortak dönem yok: ayın satırları sayılmaz (mergeSalesSources), veri kümesi kısaltan şubeyi taşır
    salesLines: base.salesLines.filter((l) => l.month !== month),
    ...(commonMissing ? { commonLists: [{ month, branch: "Tuzla", through: null }] } : {}),
  };
  const model = createModel(ds);
  const d = dashboard(model, month);
  return { state: d.monthState, task: monthTasks(monthTaskFacts(model, month, d.monthState, d.refMonth, { payments: null, parasut: null })).find((t) => t.key === "satis")! };
}

test("Tümü: Genel bakış'ın Satış raporu işi ortak dönemi olmayan ayda listeyi bekler", () => {
  const running = tasksFor("2026-10", "2026-10", true);
  assert.equal(running.state, "running");
  assert.equal(running.task.status, "later");
  assert.match(running.task.detail, /Tuzla'nın listesi gelince sayılır/);
  assert.doesNotMatch(running.task.detail, /LafPOS/);
  const closed = tasksFor("2026-09", "2026-10", true);
  assert.equal(closed.state, "closed");
  assert.equal(closed.task.status, "todo");
  assert.match(closed.task.detail, /satış listesi yüklenmedi: Tümü'de/);
  // Ortak dönem eksik değilse eski iş
  assert.doesNotMatch(tasksFor("2026-09", "2026-10", false).task.detail, /Tümü'de/);
});

// ---------------------------------------------------------------- Standart sabit giderle net kâr (dışa aktarım)

test("dışa aktarım Özet: standart sabit giderle net kâr satırı farklıysa kalır (kaldırılan rakam geri geldi)", () => {
  const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
  // Açık günü eksik ay: gün etkisi standart sabit giderle farkı doğurur
  ds.months = ds.months.map((m) => (m.month === "2026-09" ? { ...m, openDays: 24 } : m));
  const model = createModel(ds);
  const t = dashboard(model, "2026-09").theoretical!;
  assert.ok(Math.abs(t.netProfit - t.netProfitStandard) >= 1, "senaryoda fark var");
  const wb = buildWorkbook(model, "2026-09", { investments: data.investments.map(investmentSeed), findings: data.findings, now: new Date("2026-10-20T10:00:00Z") });
  let found: number | null = null;
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1);
      const i = cells.findIndex((c) => c === "Net kâr / zarar (standart sabit giderle)");
      if (i >= 0) found = cells.slice(i + 1).find((c): c is number => typeof c === "number") ?? null;
    });
  });
  assert.ok(found !== null, "satır var");
  assert.ok(Math.abs((found as number) - t.netProfitStandard) < 0.01, `değer ${found} ≠ ${t.netProfitStandard}`);
});
