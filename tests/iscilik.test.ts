// İşçilik / ciro (src/lib/iscilik.ts): tam zamanlı günlere eşit, part-time çalıştığı güne; ücret uydurulmaz; cirosu
// bilinmeyen gün orana girmez; haftalar pazartesiden; Tümü bir şubenin günü bilinmiyorsa bilinmiyor.
// Çalıştırma: npx tsx --test tests/iscilik.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dailyRows,
  dayLabel,
  dayRange,
  laborDays,
  laborOfDay,
  laborRow,
  missingWages,
  sumDays,
  weekLabel,
  weekStart,
  weeklyRows,
  withoutDayWages,
  type LaborBranchInput,
  type LaborDaySales,
  type LaborPerson,
} from "../src/lib/iscilik";

const full = (name: string, monthly: number): LaborPerson => ({ name, kind: "full_time", monthly, perDay: 0, workDays: null });
const part = (name: string, perDay: number, workDays: string[] | null, monthly = 0): LaborPerson => ({ name, kind: "part_time", monthly, perDay, workDays });

test("tam zamanlı ayın günlerine eşit, part-time yalnız çalıştığı gün; ayın günleri toplamı aylık maliyet", () => {
  const people = [full("Ayşe", 30000), part("Can", 1500, ["2026-11-07", "2026-11-08"], 300)];
  assert.equal(laborOfDay(people, "2026-11-02"), 1000 + 10, "30 günlük ay: 30.000 ÷ 30 + ek ödeme 300 ÷ 30");
  assert.equal(laborOfDay(people, "2026-11-07"), 1000 + 10 + 1500);
  const month = dayRange("2026-11-01", "2026-11-30").reduce((a, d) => a + laborOfDay(people, d), 0);
  assert.ok(Math.abs(month - (30000 + 300 + 2 * 1500)) < 1e-6, `ayın toplamı Gelir-gider'in personeli: ${month}`);
  // 31 günlük ay
  assert.ok(Math.abs(laborOfDay([full("Ayşe", 31000)], "2026-12-05") - 1000) < 1e-9);
});

test("ücret uydurulmaz: ücreti yazılmamış ve vardiya bağlantısı olmayan kişi adıyla", () => {
  const people = [full("Ayşe", 30000), full("Boş", 0), part("Can", 0, ["2026-11-07"]), part("Dilek", 1200, null), part("Ece", 0, [])];
  assert.deepEqual(missingWages("2026-11", people), [
    { month: "2026-11", name: "Boş", reason: "ucret-yok" },
    { month: "2026-11", name: "Can", reason: "ucret-yok" },
    { month: "2026-11", name: "Dilek", reason: "vardiya-yok" },
  ]);
  // Bağlantısız part-time'ın günü bilinmez: hiçbir güne yazılmaz (tahmin yok)
  assert.equal(laborOfDay([part("Dilek", 1200, null)], "2026-11-07"), 0);
});

test("kişisel ücretsiz görünüm (müdür): part-time'ın günlük ücreti hiçbir güne yazılmaz, aylık kalemler günlere eşit", () => {
  const people = withoutDayWages([full("Ayşe", 30000), part("Can", 1500, ["2026-11-07"], 300), part("Dilek", 1200, null)]);
  assert.equal(laborOfDay(people, "2026-11-07"), laborOfDay(people, "2026-11-08"), "Can'ın çalıştığı gün öteki günle aynı");
  assert.equal(laborOfDay(people, "2026-11-07"), 1000 + 10, "tam zamanlı ve Can'ın ek ödemesi");
  assert.deepEqual(missingWages("2026-11", people), [], "gün ücreti sayılmadığı için vardiya bağlantısı sorulmaz");
});

const branch = (sales: Record<string, LaborDaySales>, people: LaborPerson[], netFactor = 0.9): LaborBranchInput => ({
  id: "tuzla",
  name: "Tuzla",
  people: { "2026-11": people },
  netFactor: { "2026-11": netFactor },
  kdv: 0.1,
  sales: (d) => sales[d] ?? { kind: "yok" },
});

test("günün cirosu KDV hariç ayın oranıyla; veri yok sıfır sayılmaz, satış yok sıfır; oran yalnız bilinen günlerden", () => {
  const b = branch(
    {
      "2026-11-02": { kind: "satis", gross: 10000 },
      "2026-11-03": { kind: "bos" },
      "2026-11-05": { kind: "satis", gross: 5000 },
    },
    [full("Ayşe", 30000)],
  );
  const days = laborDays(b, dayRange("2026-11-02", "2026-11-05"));
  assert.deepEqual(
    days.map((d) => [d.date, d.revenue, d.sales]),
    [
      ["2026-11-02", 9000, "satis"],
      ["2026-11-03", 0, "bos"],
      ["2026-11-04", null, "yok"],
      ["2026-11-05", 4500, "satis"],
    ],
  );
  const row = laborRow("w", days);
  assert.equal(row.labor, 4000, "dört günün işçiliği");
  assert.equal(row.revenue, 13500);
  assert.equal(row.ratio, 3000 / 13500, "veri olmayan günün işçiliği orana girmez");
  assert.equal(row.unknownDays, 1);
  assert.equal(row.closedDays, 1);
  const [d2, d3, d4] = dailyRows(days);
  assert.equal(d2.ratio, 1000 / 9000);
  assert.equal(d3.ratio, null, "satış yok: oran yok");
  assert.equal(d4.revenue, null);
  // Ayın oranı bilinmiyorsa satış KDV'siyle çevrilir
  const noFactor = { ...b, netFactor: {} };
  assert.ok(Math.abs((laborDays(noFactor, ["2026-11-02"])[0].revenue ?? 0) - 10000 / 1.1) < 1e-6);
});

test("şube açılmadan önceki gün sayılmaz; Tümü bir şubenin günü bilinmiyorsa bilinmiyor", () => {
  const a = laborDays(branch({ "2026-11-02": { kind: "satis", gross: 1000 }, "2026-11-03": { kind: "satis", gross: 1000 } }, [full("A", 30000)], 1), ["2026-11-02", "2026-11-03"]);
  const b = laborDays(branch({ "2026-11-02": { kind: "kapsam-disi" }, "2026-11-03": { kind: "yok" } }, [full("B", 30000)], 1), ["2026-11-02", "2026-11-03"]);
  assert.equal(b[0].labor, 0, "açılmamış şubenin işçiliği o gün yok");
  const t = sumDays([a, b]);
  assert.equal(t[0].revenue, 1000, "açılmamış şube Tümü'nün gününü bilinmez yapmaz");
  assert.equal(t[0].labor, 1000);
  assert.equal(t[1].revenue, null, "B'nin günü bilinmiyor");
  assert.equal(t[1].sales, "yok");
  assert.equal(t[1].labor, 2000);
});

test("haftalar pazartesiden pazara; etiketler", () => {
  assert.equal(weekStart("2026-11-26"), "2026-11-23", "perşembe → pazartesi");
  assert.equal(weekStart("2026-11-23"), "2026-11-23");
  assert.equal(weekStart("2026-11-01"), "2026-10-26", "pazar bir önceki pazartesiye");
  const days = laborDays(branch({}, [full("A", 30000)]), dayRange("2026-10-26", "2026-11-08"));
  const weeks = weeklyRows(days);
  assert.deepEqual(
    weeks.map((w) => [w.key, w.from, w.to]),
    [
      ["2026-10-26", "2026-10-26", "2026-11-01"],
      ["2026-11-02", "2026-11-02", "2026-11-08"],
    ],
  );
  assert.equal(weekLabel("2026-11-02", "2026-11-08"), "2–8 Kas");
  assert.equal(weekLabel("2026-10-26", "2026-11-01"), "26 Eki – 1 Kas");
  assert.equal(dayLabel("2026-11-26"), "26 Kas Per");
});
