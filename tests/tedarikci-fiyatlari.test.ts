// Hammaddenin tedarikçilere göre fiyatı (src/lib/supplier-prices.ts): okunur birim, aynı faturanın kalemleri,
// bedava ve iade kalemleri, son fiyat ve değişim, 12 aylık özet, 90 günlük "en ucuz" ve sıra.
// Çalıştırma: npx tsx --test tests/tedarikci-fiyatlari.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { bulkPrice, bulkUnit, supplierPriceRows, type PriceLine } from "../src/lib/supplier-prices";

const NBSP = "\u00a0";
const TODAY = "2026-10-22";

let nextId = 1;
const line = (over: Partial<PriceLine> & Pick<PriceLine, "supplierKey" | "date">): PriceLine => ({
  invoiceId: nextId++,
  invoiceNo: null,
  supplierName: over.supplierKey.toUpperCase(),
  supplierSlug: over.supplierKey,
  productName: "SÜT 1 LT",
  quantity: 10,
  unit: "Adet",
  factor: 1000,
  netTotal: 300,
  ...over,
});

test("bulkUnit ve bulkPrice: gr → kg, ml → L, adet ve dilim kendisi", () => {
  assert.deepEqual(bulkUnit("gr"), { per: "kg", scale: 1000 });
  assert.deepEqual(bulkUnit("ml"), { per: "L", scale: 1000 });
  assert.deepEqual(bulkUnit("adet"), { per: "adet", scale: 1 });
  assert.deepEqual(bulkUnit("dilim"), { per: "dilim", scale: 1 });
  assert.equal(bulkPrice(0.04864, "ml"), `48,64${NBSP}₺/L`);
  assert.equal(bulkPrice(1.022, "gr"), `1.022,00${NBSP}₺/kg`);
  assert.equal(bulkPrice(0.85, "adet"), `0,85${NBSP}₺/adet`);
  assert.equal(bulkPrice(0.0425, "adet"), `0,0425${NBSP}₺/adet`);
});

test("aynı faturanın iki kalemi tek nokta (ağırlıklı); bedava ve iade kalemleri sayılır, fiyata girmez", () => {
  const r = supplierPriceRows(
    [
      line({ invoiceId: 100, supplierKey: "sutas", date: "2026-10-01", quantity: 10, netTotal: 300, unit: "Adet" }),
      line({ invoiceId: 100, supplierKey: "sutas", date: "2026-10-01", quantity: 1, netTotal: 372, factor: 12000, unit: "Koli", productName: "SÜT KOLİ" }),
      line({ invoiceId: 101, supplierKey: "sutas", date: "2026-10-05", quantity: 4, netTotal: 0 }),
      line({ invoiceId: 102, supplierKey: "sutas", date: "2026-10-06", quantity: -2, netTotal: -60 }),
      line({ invoiceId: 103, supplierKey: "sutas", date: "2026-10-07", quantity: 3, netTotal: -5 }),
      // Çarpanı sıfır ya da miktarı 0 olan kalem atlanır, sayılmaz
      line({ invoiceId: 104, supplierKey: "sutas", date: "2026-10-08", factor: 0 }),
      line({ invoiceId: 105, supplierKey: "sutas", date: "2026-10-09", quantity: 0, netTotal: 0 }),
    ],
    { today: TODAY },
  );
  assert.equal(r.freeLines, 1);
  assert.equal(r.returnLines, 2);
  assert.equal(r.invoiceCount, 1);
  assert.equal(r.rows.length, 1);
  const [row] = r.rows;
  assert.equal(row.points.length, 1);
  assert.ok(Math.abs(row.last.unitPrice - 672 / 22000) < 1e-12);
  assert.equal(row.last.qtyText, "2 kalem");
  assert.equal(row.change, null);
  // Tek kalemde miktar ve faturadaki birim
  const single = supplierPriceRows([line({ supplierKey: "metro", date: "2026-10-01", quantity: 12, unit: "Koli" })], { today: TODAY });
  assert.equal(single.rows[0].last.qtyText, "12 Koli");
  assert.equal(supplierPriceRows([line({ supplierKey: "metro", date: "2026-10-01", unit: null })], { today: TODAY }).rows[0].last.qtyText, "10 birim");
});

test("son fiyat, değişim, 12 aylık en düşük–en yüksek ve miktarla ağırlıklı ortalama; eski fatura listede kalır", () => {
  const r = supplierPriceRows(
    [
      line({ supplierKey: "sutas", date: "2025-09-01", quantity: 10, netTotal: 200, invoiceNo: "S0" }),
      line({ supplierKey: "sutas", date: "2026-01-10", quantity: 10, netTotal: 280, invoiceNo: "S1" }),
      line({ supplierKey: "sutas", date: "2026-06-10", quantity: 30, netTotal: 900, invoiceNo: "S2" }),
      line({ supplierKey: "sutas", date: "2026-10-10", quantity: 10, netTotal: 312, invoiceNo: "S3" }),
    ],
    { today: TODAY },
  );
  const [row] = r.rows;
  assert.deepEqual(
    row.points.map((p) => p.invoiceNo),
    ["S3", "S2", "S1", "S0"],
  );
  assert.equal(row.last.invoiceNo, "S3");
  assert.ok(Math.abs(row.last.unitPrice - 0.0312) < 1e-12);
  assert.ok(Math.abs((row.change ?? 0) - (0.0312 / 0.03 - 1)) < 1e-12);
  // 2025-09-01 365 günlük pencerenin dışında: özetlere girmez
  assert.equal(row.windowCount, 3);
  assert.ok(Math.abs((row.min ?? 0) - 0.028) < 1e-12);
  assert.ok(Math.abs((row.max ?? 0) - 0.0312) < 1e-12);
  assert.ok(Math.abs((row.avg ?? 0) - (280 + 900 + 312) / 50000) < 1e-12);
  assert.equal(row.fresh, true);
  // Tek tedarikçi: en ucuz yok
  assert.equal(row.cheapest, false);
  assert.equal(row.vsCheapest, null);
  // Penceresinde faturası olmayan tedarikçi
  const old = supplierPriceRows([line({ supplierKey: "eski", date: "2025-01-01" })], { today: TODAY }).rows[0];
  assert.equal(old.windowCount, 0);
  assert.equal(old.min, null);
  assert.equal(old.avg, null);
  assert.equal(old.fresh, false);
});

test("90 gün: en ucuz yalnız en az iki yakın tedarikçide; fark; sıra (yakınlar ucuzdan, eskiler yeniden)", () => {
  const r = supplierPriceRows(
    [
      line({ supplierKey: "metro", date: "2026-10-01", netTotal: 336 }),
      line({ supplierKey: "sutas", date: "2026-09-15", netTotal: 300 }),
      line({ supplierKey: "pinar", date: "2026-08-01", netTotal: 320 }),
      // 90 günden eski: en ucuz olsa da sayılmaz
      line({ supplierKey: "eski", date: "2026-06-01", netTotal: 250 }),
      line({ supplierKey: "daha-eski", date: "2026-03-01", netTotal: 200 }),
    ],
    { today: TODAY },
  );
  assert.deepEqual(
    r.rows.map((x) => x.key),
    ["sutas", "pinar", "metro", "eski", "daha-eski"],
  );
  const by = new Map(r.rows.map((x) => [x.key, x]));
  assert.equal(by.get("sutas")!.cheapest, true);
  assert.equal(by.get("metro")!.cheapest, false);
  assert.ok(Math.abs(by.get("metro")!.vsCheapest! - 0.12) < 1e-12);
  assert.equal(by.get("sutas")!.vsCheapest, 0);
  assert.equal(by.get("eski")!.fresh, false);
  assert.equal(by.get("eski")!.cheapest, false);
  assert.equal(by.get("eski")!.vsCheapest, null);
  assert.equal(r.invoiceCount, 5);
  // Tam 90 gün önce alınan hâlâ yakın
  const edge = supplierPriceRows([line({ supplierKey: "a", date: "2026-07-24" }), line({ supplierKey: "b", date: "2026-07-23" })], { today: TODAY });
  assert.equal(edge.rows.find((x) => x.key === "a")!.fresh, true);
  assert.equal(edge.rows.find((x) => x.key === "b")!.fresh, false);
  // Yakın zamanda yalnız biri: en ucuz yok
  const one = supplierPriceRows([line({ supplierKey: "a", date: "2026-10-01" }), line({ supplierKey: "b", date: "2026-01-01", netTotal: 100 })], { today: TODAY });
  assert.ok(one.rows.every((x) => !x.cheapest && x.vsCheapest === null));
});
