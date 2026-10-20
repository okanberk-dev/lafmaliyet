// Gelir-gider'deki "<yıl> ciro (KDV hariç)" kartının dökümü: ay ay ciro (KDV hariç), takvim sırasıyla, ayın
// Satışlar sayfasına bağlantıyla. Döküm kartın rakamını tutmalı; cirosu girilmemiş aktif aylar ayrı bölümde.
// Çalıştırma: npx tsx --test tests/gelir-gider-dokum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { revenueBreakdown, type RevenueMonthCalc } from "../src/app/panel/gelir-gider/breakdowns";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";
import { createModel, yearMonths } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const groupsSum = (gs: BreakdownGroup[]) => sum(gs.filter((g) => !g.apart).flatMap((g) => g.rows.map((r) => r.amount)));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("Gelir-gider ciro dökümü: ay ay, kartın rakamını tutar, ay Satışlar'da açılır (Excel verisi)", () => {
  const model = createModel(base);
  for (const year of [2025, 2026]) {
    const months = yearMonths(year);
    const calcs = months.map((m) => model.pnlMonth(m));
    // page.tsx ile aynı: kartın rakamı ve aktif aylar
    const revenueNet = sum(calcs.map((c) => c.revenueNet ?? 0));
    const active = months.filter((_, i) => calcs[i].revenue !== null || calcs[i].expenses !== 0 || calcs[i].info?.openDays != null);
    const b = revenueBreakdown(calcs, active);
    close(groupsSum(b), revenueNet);
    const p = prepareBreakdown(b, { total: revenueNet, order: "given" });
    close(p.total, revenueNet);

    const ciro = b.find((g) => g.key === "ciro")!;
    const entered = calcs.filter((c) => c.revenueNet !== null);
    assert.deepEqual(ciro.rows.map((r) => r.key), entered.map((c) => c.month), "takvim sırasıyla, cirosu girilen aylar");
    for (const r of ciro.rows) {
      assert.equal(r.href, `/panel/satislar?ay=${r.key}`);
      assert.match(r.sub ?? "", /^POS cirosu .+ \(KDV dahil\)/);
    }
    // Ciro satırları + cirosu girilmemiş aylar = kartın "N aktif ay"ı
    const missing = b.find((g) => g.key === "girilmedi")!;
    assert.equal(missing.apart, true);
    assert.equal(ciro.rows.length + missing.rows.length, active.length);
  }
});

test("Gelir-gider ciro dökümü: cirosu girilmemiş aktif ay ayrı ve toplama girmez; sıfır girilen ay görünür", () => {
  const calcs: RevenueMonthCalc[] = [
    { month: "2026-01", revenue: 110_000, revenueNet: 100_000, info: { openDays: 30 } },
    { month: "2026-02", revenue: 0, revenueNet: 0, info: { openDays: null } },
    { month: "2026-03", revenue: null, revenueNet: null, info: { openDays: 12 } },
    { month: "2026-04", revenue: null, revenueNet: null, info: undefined },
  ];
  const b = revenueBreakdown(calcs, ["2026-01", "2026-02", "2026-03"]);
  close(groupsSum(b), 100_000);
  const ciro = b.find((g) => g.key === "ciro")!;
  assert.deepEqual(
    ciro.rows.map((r) => [r.label, r.sub, r.display]),
    [
      ["Ocak 2026", "POS cirosu 110.000 ₺ (KDV dahil) · 30 açık gün", undefined],
      ["Şubat 2026", "POS cirosu 0 ₺ (KDV dahil)", "0 ₺"],
    ],
  );
  const missing = b.find((g) => g.key === "girilmedi")!;
  assert.deepEqual(
    missing.rows.map((r) => [r.label, r.display, r.tone, r.href, r.sub]),
    [["Mart 2026", "Girilmedi", "warn", "/panel/satislar?ay=2026-03#m-pos", "12 açık gün"]],
    "aktif olmayan Nisan yok",
  );
  // Pencerede: sıfır ay ve girilmemiş ay satır olarak kalır, toplam yalnızca girilen ciro
  const p = prepareBreakdown(b, { order: "given" });
  assert.equal(p.total, 100_000);
  assert.deepEqual(p.groups.map((g) => g.rows.length), [2, 1]);
  assert.equal(p.groups[1].share, null);
});
