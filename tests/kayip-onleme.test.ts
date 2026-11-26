// Kişi bazında kayıp önleme (src/lib/kayip-onleme.ts): kasa farkı sayana göre, zayi / ikram kaydedene göre (doğrudan);
// iptal, ikram, indirim ve kasa farkı çalıştığı günlere göre (dolaylı, kişiye yazılmaz). LafPOS'un göndermediği alanın
// ekranda ve raporda yazılı olduğu, sayfanın yalnız yöneticinin olduğu.
// Çalıştırma: npx tsx --test tests/kayip-onleme.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { cashByPerson, dayAssociation, MIN_DAYS, staffPersonKey, wasteByPerson, type LossCashReport, type LossDay } from "../src/lib/kayip-onleme";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ali = { key: "u:1", name: "Ali" };
const ece = { key: "u:2", name: "Ece" };
const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;

test("kasa farkı sayana göre: ortalama, eksik gün, en büyük eksik; sapma başkalarının raporlarına göre", () => {
  const reports: LossCashReport[] = [
    ...[-200, -150, -100, 0].map((d, i) => ({ branchId: "tuzla", date: day(i + 1), cashDiff: d, person: ali })),
    ...[0, 5, -0.5, 0].map((d, i) => ({ branchId: "tuzla", date: day(i + 10), cashDiff: d, person: ece })),
    // LafPOS'un otomatik raporu: kişi yok
    { branchId: "marina", date: day(3), cashDiff: -40, person: null },
  ];
  const { rows, branches } = cashByPerson(reports);
  const a = rows.find((r) => r.person.key === "u:1")!;
  assert.equal(a.reports, 4);
  assert.equal(a.total, -450);
  assert.equal(a.mean, -112.5);
  assert.equal(a.shortDays, 3, "1 ₺'den çok eksik");
  assert.equal(a.worst, -200);
  assert.equal(a.deviation, -113.62, "Ece'nin raporlarının ortalamasına (+1,125) göre, kuruşa yuvarlı");
  assert.equal(a.flag, true);
  const e = rows.find((r) => r.person.key === "u:2")!;
  assert.equal(e.shortDays, 0, "50 kuruş eksik tutuyor sayılır");
  assert.equal(e.flag, false, "fazla çıkan kişi kaçak işareti almaz");
  assert.equal(rows[0].person.name, "Ali", "en çok eksik çıkan önce");
  const marina = branches.find((b) => b.branchId === "marina")!;
  assert.deepEqual([marina.unknown, marina.unknownTotal], [1, -40], "kasayı sayanı LafPOS göndermiyor");
  assert.ok(!rows.some((r) => r.branchId === "marina"));
  // Az raporla sapma yazılmaz
  const few = cashByPerson(reports.slice(0, 2).concat(reports.slice(4, 6)));
  assert.equal(few.rows[0].deviation, null, `en az ${MIN_DAYS} rapor`);
});

test("zayi ve ikram kaydedene göre; kaydedeni bilinmeyen ayrı", () => {
  const { rows, unknown } = wasteByPerson([
    { branchId: "tuzla", date: day(1), kind: "zayi", cost: 30, person: ali },
    { branchId: "tuzla", date: day(2), kind: "ikram", cost: 50, person: ali },
    { branchId: "tuzla", date: day(2), kind: "zayi", cost: 20, person: ece },
    { branchId: "tuzla", date: day(3), kind: "zayi", cost: 7, person: null },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.person.name, r.entries, r.zayiCost, r.ikramCost, Math.round((r.share ?? 0) * 1000) / 1000]),
    [
      ["Ali", 2, 30, 50, 0.748],
      ["Ece", 1, 20, 0, 0.187],
    ],
  );
  assert.deepEqual(unknown, { entries: 1, cost: 7 });
});

test("çalıştığı günlere göre: çalıştığı ve çalışmadığı günlerin ortalaması, kötü yönde büyük sapma işaretli; gelmeyen değer şubede eksik", () => {
  const days: LossDay[] = [];
  // Ali 1-4 Kasım çalıştı (iptal yüksek), Ece 5-8 Kasım; Vardiya'sı olmayan gün bilinmiyor
  for (let i = 1; i <= 8; i++) {
    days.push({
      branchId: "marina",
      date: day(i),
      workers: i <= 4 ? ["u:1"] : ["u:2"],
      workersFrom: "lafpos",
      values: { cashDiff: 0, iptal: i <= 4 ? 300 : 20, ikram: 50, discount: 10 },
    });
  }
  days.push({ branchId: "marina", date: day(9), workers: null, values: { cashDiff: -5, iptal: 0, ikram: 0, discount: 0 } });
  // Tuzla (ModPOS): iptal gelmez
  for (let i = 1; i <= 6; i++) days.push({ branchId: "tuzla", date: day(i), workers: ["u:2", ...(i % 2 ? ["n:veli"] : [])], workersFrom: "vardiya", values: { cashDiff: -10, iptal: null, ikram: 0, discount: 0 } });
  const names = new Map([
    ["u:1", "Ali"],
    ["u:2", "Ece"],
    ["n:veli", "Veli"],
  ]);
  const { rows, branches } = dayAssociation(days, names);
  const ali = rows.find((r) => r.branchId === "marina" && r.person.key === "u:1")!;
  assert.equal(ali.workedDays, 4);
  assert.deepEqual([ali.metrics.iptal.worked, ali.metrics.iptal.other, ali.metrics.iptal.deviation], [300, 20, 280]);
  assert.equal(ali.metrics.iptal.flag, true);
  assert.equal(ali.metrics.ikram.deviation, 0);
  assert.equal(ali.metrics.ikram.flag, false);
  const ece = rows.find((r) => r.branchId === "marina" && r.person.key === "u:2")!;
  assert.equal(ece.metrics.iptal.deviation, -280);
  assert.equal(ece.metrics.iptal.flag, false, "az iptal kötü yön değil");
  const m = branches.find((b) => b.branchId === "marina")!;
  assert.deepEqual([m.days, m.lafposDays, m.vardiyaDays, m.unknownDays], [8, 8, 0, 1]);
  assert.deepEqual(m.missingMetrics, []);
  const t = branches.find((b) => b.branchId === "tuzla")!;
  assert.deepEqual(t.missingMetrics, ["iptal"], "ModPOS iptal göndermez");
  // Tuzla'da Ece her gün çalıştı: karşılaştıracak gün yok
  const eceT = rows.find((r) => r.branchId === "tuzla" && r.person.key === "u:2")!;
  assert.equal(eceT.metrics.cashDiff.deviation, null);
  assert.equal(rows.find((r) => r.person.key === "n:veli")?.person.name, "Veli");
});

test("LafPOS'un çalışan kimliği kişinin anahtarına: hesap, Vardiya adı, yoksa kendisi", () => {
  assert.equal(staffPersonKey({ id: 7, userId: 3, personRef: null }), "u:3");
  assert.equal(staffPersonKey({ id: 7, userId: null, personRef: "n:ayşe" }), "n:ayşe");
  assert.equal(staffPersonKey({ id: 7, userId: null, personRef: null }), "s:7");
});

test("ekran ve yükleyici: yalnız yönetici; LafPOS'un göndermediği alanlar yazılı; otomatik rapor kişiye yazılmaz", () => {
  const page = read("src/app/panel/raporlar/kayip/page.tsx");
  assert.match(page, /await requireAdmin\(\)/);
  for (const what of ["iptali yapan", "indirimi yapan", "ikramı ve ödenmezi veren", "LafPOS'ta kasayı sayan"]) assert.ok(page.includes(what), what);
  assert.match(page, /ModPOS \(föy ve kasa raporu\) iptal göndermez/);
  const loader = read("src/server/data/kayip-onleme.ts");
  assert.match(loader, /await requireAdmin\(\);/);
  assert.match(loader, /r\.submittedByName === LAFPOS_AUTO_BY \? null/);
  // Geçiş gününden önceki LafPOS günü (deneme) sayılmaz
  assert.match(loader, /isLafposDay\(date, switchOf\)/);
});
