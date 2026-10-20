// Zam uyarısı: fiyatı artan hammaddeler ve kârı düşen ürünler. Excel verisinin üzerine küçük fiyat değişiklikleri.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import { changesSummary, ingredientChanges, isAcknowledged, productImpacts, type PriceHistoryRow } from "../src/lib/calc/price-impact";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const ds = excelToDataset(data);
const ing = (name: string) => {
  const i = ds.ingredients.find((x) => x.name === name);
  assert.ok(i, `hammadde yok: ${name}`);
  return i;
};
const milk = ing("Süt %2,5");
const coffee = ing("Espresso çekirdeği");
const ice = ing("Buz");

const row = (ingredientId: number, packagePrice: number, packageSize: number, changedAt: string, changedBy = "Excel"): PriceHistoryRow => ({
  ingredientId,
  packagePrice,
  packageSize,
  changedAt,
  changedBy,
  note: null,
});
const withPrices = (prices: Record<number, number>, products?: (p: Dataset["products"][number]) => Dataset["products"][number]): Dataset => ({
  ...ds,
  ingredients: ds.ingredients.map((i) => (prices[i.id] !== undefined ? { ...i, packagePrice: prices[i.id] } : i)),
  products: products ? ds.products.map(products) : ds.products,
});

const SINCE = "2026-09-20T00:00:00.000Z";
const history = [
  row(milk.id, milk.packagePrice, milk.packageSize, "2026-09-01T09:00:00.000Z"),
  row(coffee.id, coffee.packagePrice, coffee.packageSize, "2026-09-01T09:00:00.000Z"),
  row(milk.id, 60, 1000, "2026-10-15T09:00:00.000Z", "Paraşüt"),
];

test("zam: penceredeki değişiklik eski fiyatla karşılaştırılır; değişmeyen ve su/buz sayılmaz", () => {
  const now = withPrices({ [milk.id]: 60 });
  const changes = ingredientChanges(now.ingredients, history, SINCE);
  assert.equal(changes.length, 1);
  const [c] = changes;
  assert.equal(c.ingredientId, milk.id);
  assert.equal(c.changedBy, "Paraşüt");
  assert.ok(Math.abs(c.before - milk.packagePrice / milk.packageSize) < 1e-9);
  assert.ok(Math.abs(c.pct - (60 / milk.packagePrice - 1)) < 1e-9);
  // %5'in altındaki değişiklik zam sayılmaz
  const small = withPrices({ [milk.id]: milk.packagePrice * 1.03 });
  assert.equal(ingredientChanges(small.ingredients, [...history.slice(0, 2), row(milk.id, milk.packagePrice * 1.03, 1000, "2026-10-15T09:00:00.000Z")], SINCE).length, 0);
  // Bütün geçmiş pencerede: tek satır (ör. yalnız Excel aktarımı) değişiklik değildir, iki satırda ilki başlangıçtır
  assert.equal(ingredientChanges(now.ingredients, [row(milk.id, 60, 1000, "2026-10-01T09:00:00.000Z")], SINCE).length, 0);
  assert.equal(ingredientChanges(now.ingredients, [row(milk.id, 50, 1000, "2026-10-01T09:00:00.000Z"), row(milk.id, 60, 1000, "2026-10-15T09:00:00.000Z")], SINCE)[0].pct.toFixed(2), "0.20");
  // Su ve buz su faturasından hesaplanır, geçmişi zam sayılmaz
  assert.equal(ingredientChanges(now.ingredients, [row(ice.id, 0, 1000, "2026-09-01T09:00:00.000Z"), row(ice.id, 5, 1000, "2026-10-15T09:00:00.000Z")], SINCE).length, 0);
});

test("zam: sütü kullanan ürünlerin maliyeti eski fiyatla yeniden hesaplanır, önerilen fiyat hedef orandan", () => {
  const model = createModel(withPrices({ [milk.id]: 60 }));
  const changes = ingredientChanges(model.ds.ingredients, history, SINCE);
  const impacts = productImpacts(model, changes);
  assert.ok(impacts.length > 10, `süt kullanan çok ürün etkilenmeli (${impacts.length})`);
  const latte = impacts.find((i) => i.key === "Latte|M");
  assert.ok(latte, "Latte M etkilenmeli");
  assert.ok(latte.costAfter > latte.costBefore);
  assert.ok(latte.ratioAfter > latte.ratioBefore && latte.marginAfter < latte.marginBefore);
  assert.equal(latte.drivers[0].ingredientId, milk.id);
  assert.equal(latte.drivers[0].share, 1);
  // Hedef fiyat modelin (Reçete Kartı'nın) önerisiyle aynı; Latte hâlâ hedefte: uyarı yok
  const now = model.activeProducts.find((p) => p.key === "Latte|M")!;
  assert.equal(latte.targetPrice, now.suggestedPrice);
  assert.ok(now.costRatio < model.settings.hedefMaliyet);
  assert.equal(latte.needsPrice, false);
  // Sütü olmayan ürün listede yok
  const noMilk = model.activeProducts.find((p) => p.cost > 0 && !p.lines.some((l) => l.item.ingredientId === milk.id));
  assert.ok(noMilk && !impacts.some((i) => i.productId === noMilk.product.id));
});

test("zam: zamdan önce hedefteyse hedef fiyat, zaten hedefin üstündeyse zammın payı önerilir", () => {
  const latteId = ds.products.find((p) => p.name === "Latte" && p.size === "M")!.id;
  // Fiyatı düşük Latte: maliyet oranı zamdan önce hedefin üstünde → zammı yansıtan fiyat (hedef fiyattan küçük)
  const cheap = createModel(withPrices({ [milk.id]: 60 }, (p) => (p.id === latteId ? { ...p, price: 80 } : p)));
  const low = productImpacts(cheap, ingredientChanges(cheap.ds.ingredients, history, SINCE)).find((i) => i.productId === latteId)!;
  assert.ok(low.ratioBefore > cheap.settings.hedefMaliyet);
  assert.equal(low.needsPrice, true);
  assert.equal(low.basis, "keep");
  assert.ok(low.keepPrice < low.targetPrice);
  assert.equal(low.suggestedPrice, low.keepPrice);
  assert.equal(low.suggestedPrice % 5, 0);
  // Zam payı kadar: 80 × yeni maliyet ÷ eski maliyet, 5'e yukarı
  assert.equal(low.keepPrice, Math.ceil((80 * low.costAfter) / low.costBefore / 5) * 5);

  // Zamdan önce hedefte, zamdan sonra hedefin üstünde: hedef fiyat (zammı yansıtandan küçük) önerilir
  const before = createModel(withPrices({}, (p) => (p.id === latteId ? { ...p, price: 1 } : p))).activeProducts.find((p) => p.product.id === latteId)!;
  const edge = Math.ceil((before.cost / 0.29) * 1.1); // eski maliyetle oran ~%29: hedefin hemen altı
  const pushed = createModel(withPrices({ [milk.id]: 60 }, (p) => (p.id === latteId ? { ...p, price: edge } : p)));
  const mid = productImpacts(pushed, ingredientChanges(pushed.ds.ingredients, history, SINCE)).find((i) => i.productId === latteId)!;
  assert.ok(mid.ratioBefore <= pushed.settings.hedefMaliyet && mid.ratioAfter > pushed.settings.hedefMaliyet);
  assert.equal(mid.basis, "target");
  assert.equal(mid.suggestedPrice, mid.targetPrice);
  assert.ok(mid.targetPrice <= mid.keepPrice);
  assert.equal(mid.needsPrice, true);
});

test("zam: uyarılacak ürün önce gelir; 'şimdilik böyle kalsın' maliyet artarsa düşer", () => {
  const latteId = ds.products.find((p) => p.name === "Latte" && p.size === "M")!.id;
  const model = createModel(withPrices({ [milk.id]: 60 }, (p) => (p.id === latteId ? { ...p, price: 80 } : p)));
  const impacts = productImpacts(model, ingredientChanges(model.ds.ingredients, history, SINCE));
  const latte = impacts.find((i) => i.productId === latteId)!;
  assert.equal(latte.needsPrice, true);
  assert.equal(impacts[0].needsPrice, true);
  assert.equal(isAcknowledged(latte, { [latteId]: { cost: latte.costAfter, at: "2026-10-16" } }), true);
  assert.equal(isAcknowledged(latte, { [latteId]: { cost: latte.costAfter * 0.95, at: "2026-10-16" } }), false);
  assert.equal(isAcknowledged(latte, null), false);
});

test("zam: 'zammın payı' uygulanınca öneri yeni fiyattan yeniden artmaz; geri alınca ya da maliyet artınca uyarı döner", () => {
  const latteId = ds.products.find((p) => p.name === "Latte" && p.size === "M")!.id;
  const impactAt = (price: number, prices: Record<number, number> = { [milk.id]: 60 }) => {
    const m = createModel(withPrices(prices, (p) => (p.id === latteId ? { ...p, price } : p)));
    return productImpacts(m, ingredientChanges(m.ds.ingredients, history, SINCE)).find((i) => i.productId === latteId)!;
  };
  const first = impactAt(80);
  assert.equal(first.basis, "keep");
  // Fiyat zam penceresinde: öneri yeni fiyattan yine artar (85 → 90 → …); uygulanan öneri kaydı bunu kapatır
  const applied = impactAt(first.suggestedPrice);
  assert.equal(applied.needsPrice, true);
  assert.ok(applied.suggestedPrice > first.suggestedPrice);
  const ack = { [latteId]: { cost: first.costAfter, at: "2026-10-16", price: first.suggestedPrice } };
  assert.equal(isAcknowledged(applied, ack), true);
  // Fiyatı elle daha da artırmak uyarıyı açmaz; Geri al (eski fiyat) açar
  assert.equal(isAcknowledged(impactAt(first.suggestedPrice + 5), ack), true);
  assert.equal(isAcknowledged(impactAt(80), ack), false);
  // Yeni zam: maliyet kayıttakinden artınca yeniden uyarılır
  const again = impactAt(first.suggestedPrice, { [milk.id]: 70 });
  assert.ok(again.costAfter > first.costAfter * 1.005);
  assert.equal(isAcknowledged(again, ack), false);
  // "Böyle kalsın" (fiyatsız kayıt) fiyattan bağımsız
  assert.equal(isAcknowledged(impactAt(80), { [latteId]: { cost: first.costAfter, at: "2026-10-16" } }), true);
});

test("zam özeti: en çok üç hammadde, kalanı sayıyla", () => {
  const c = (name: string, pct: number) => ({ name, pct });
  assert.equal(changesSummary([c("Süt", 0.157), c("Espresso", 0.06)]), "Süt +%16, Espresso +%6");
  assert.equal(changesSummary([c("A", 0.3), c("B", 0.2), c("C", 0.1), c("D", 0.08), c("E", -0.1)]), "A +%30, B +%20, C +%10 ve 1 hammadde daha");
});
