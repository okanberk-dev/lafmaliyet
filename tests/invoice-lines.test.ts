import assert from "node:assert/strict";
import { test } from "node:test";

import { ingredientPriceOf, linesTotal, netUnitPrice, type InvoiceLineView } from "../src/lib/invoice-lines";

const line = (p: Partial<InvoiceLineView>): InvoiceLineView => ({
  id: 1,
  productKey: "e:1:#1",
  productName: "ESPRESSO BLEND 1 KG",
  description: null,
  quantity: 24,
  unit: "Adet",
  unitPrice: 1035,
  discount: 0,
  vatRate: 1,
  netTotal: 24840,
  ingredient: null,
  ...p,
});

test("kalem: net birim fiyat ve bağlı hammaddenin okunur fiyatı", () => {
  assert.equal(netUnitPrice(line({})), 1035);
  assert.equal(netUnitPrice(line({ quantity: 2, netTotal: 0 })), 0);
  assert.equal(ingredientPriceOf(line({})), null);
  // 1 adet = 1000 gr → 1.035 ₺/kg
  assert.deepEqual(ingredientPriceOf(line({ ingredient: { id: 3, name: "Espresso", unit: "gr", factor: 1000 } })), { value: 1035, per: "kg" });
  // 1 koli = 24 adet (Erbak: 10 koli 1317,68 ₺ → 5,49 ₺/adet)
  const water = ingredientPriceOf(line({ quantity: 10, netTotal: 1317.68, ingredient: { id: 9, name: "Su 400 ml", unit: "adet", factor: 24 } }));
  assert.equal(water?.per, "adet");
  assert.equal(Math.round(water!.value * 100) / 100, 5.49);
  // Bedava koli fiyat vermez
  assert.equal(ingredientPriceOf(line({ quantity: 2, netTotal: 0, ingredient: { id: 9, name: "Su", unit: "adet", factor: 24 } })), null);
});

test("kalem toplamı faturayı tutuyor mu", () => {
  assert.deepEqual(linesTotal([{ netTotal: 1317.68 }, { netTotal: 2333.97 }, { netTotal: 0 }], 3651.65), { total: 3651.65, matches: true });
  assert.equal(linesTotal([{ netTotal: 6528.27 }], 3651.65).matches, false);
});
