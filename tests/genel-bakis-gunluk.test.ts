// Genel bakış › "günlük ciro" kartı (src/app/panel/dashboard-daily.ts): ayın açık günleri, ay bilgisiyle aynı ciro kuralı
// (günlerin toplamı = ayın POS cirosu, gün sayısı = açık gün) ve kartın yalnız kasadan gelen ayda çizilmesi.
// Çalıştırma: npx tsx --test tests/genel-bakis-gunluk.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { monthDays } from "../src/app/panel/dashboard-daily";
import { tillMonths, type TillRow } from "../src/lib/cash-month";

const row = (date: string, over: Partial<TillRow> = {}): TillRow => ({ date, zTotal: 1000, card: 600, mealCard: 0, discounts: null, offRevenue: null, payments: 1000, ...over });

test("günler: yalnız seçili ay ve açık gün, sıralı; ödenmez Z'nin içindeyse düşer", () => {
  const rows = [
    row("2026-10-31"),
    row("2026-11-03", { zTotal: 1200, offRevenue: 200, payments: 1000 }),
    row("2026-11-01"),
    row("2026-11-02", { zTotal: 0, payments: 0 }),
  ];
  assert.deepEqual(monthDays(rows, "2026-11"), [
    { date: "2026-11-01", revenue: 1000 },
    { date: "2026-11-03", revenue: 1000 },
  ]);
});

test("toplam ve gün sayısı ay bilgisiyle aynı (tillMonths posRevenue, openDays)", () => {
  const rows = [row("2026-11-01"), row("2026-11-02", { zTotal: 1500, offRevenue: 100, payments: 1400 }), row("2026-11-04", { source: "asilpos", zTotal: 800, payments: 800 })];
  const [m] = tillMonths(rows, "2026-11-04");
  const days = monthDays(rows, "2026-11");
  assert.equal(days.length, m.openDays);
  assert.equal(Math.round(days.reduce((a, x) => a + x.revenue, 0) * 100) / 100, m.posRevenue);
});

test("sayfa: kasa satırları okunamazsa ya da ay kasadan gelmiyorsa kart çizilmez", () => {
  const page = readFileSync(join(process.cwd(), "src/app/panel/page.tsx"), "utf8");
  assert.match(page, /tillRows\(\)\.catch\(\(\) => null\)/);
  assert.match(page, /till && d\.info\?\.sources\?\.posRevenue === "kasa" \? monthDays\(till, month\) : \[\]/);
  assert.match(page, /\{days\.length > 1 \? <DailyRevenueCard month=\{month\} days=\{days\} \/> : null\}/);
});

test("Tümü: iki şubenin aynı günü tek çubuk (ciro toplamı), açık gün tekil; tillMonths aynı sayıyı verir", () => {
  const rows = [
    row("2026-11-01", { branchId: "tuzla", zTotal: 1111, payments: 1111 }),
    row("2026-11-01", { branchId: "marina", zTotal: 2222, payments: 2222 }),
    row("2026-11-02", { branchId: "tuzla" }),
    row("2026-11-02", { branchId: "marina", zTotal: 0, payments: 0 }),
  ];
  assert.deepEqual(monthDays(rows, "2026-11"), [
    { date: "2026-11-01", revenue: 3333 },
    { date: "2026-11-02", revenue: 1000 },
  ]);
  const [m] = tillMonths(rows, "2026-11-02");
  assert.equal(m.openDays, 2, "29 gün 58 değil: gün tekil");
  assert.equal(m.reported, 2);
  assert.equal(m.posRevenue, 4333);
  // Tek şubede satırlar bugünkü gibi sayılır
  assert.equal(tillMonths([row("2026-11-01"), row("2026-11-02")], "2026-11-02")[0].openDays, 2);
});
