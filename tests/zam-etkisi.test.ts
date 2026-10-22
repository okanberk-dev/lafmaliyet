// Zam etkisi (ayda TL kâr kaybı): satış dayanağı (referans ay, standart aya ölçek, online ve eşleşmeyen adet), ürün ve
// hammadde başına aylık kayıp, uyarı metninin eki, sabah e-postasının zam bölümü ve yükleyicinin tek hesap yolu.
// Excel verisinin üzerine küçük fiyat değişiklikleri (kalıp tests/price-impact.test.ts).
// Çalıştırma: npx tsx --test tests/zam-etkisi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import { latestSalesMonth } from "../src/lib/calc/insights";
import { basisText, priceLoss, salesBasis } from "../src/lib/calc/price-loss";
import { ingredientChanges, priceAlert, productImpacts, type PriceHistoryRow } from "../src/lib/calc/price-impact";
import type { Dataset } from "../src/lib/calc/types";
import type { SiteSalesMonth } from "../src/lib/site-sales/schema";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";
import { renderDigest, type DigestPrices } from "../src/server/notify/digest-template";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const ing = (name: string) => {
  const i = ds.ingredients.find((x) => x.name === name);
  assert.ok(i, `hammadde yok: ${name}`);
  return i;
};
const milk = ing("Süt %2,5");
const coffee = ing("Espresso çekirdeği");
const SINCE = "2026-09-20T00:00:00.000Z";
const row = (ingredientId: number, packagePrice: number, packageSize: number, changedAt: string): PriceHistoryRow => ({
  ingredientId,
  packagePrice,
  packageSize,
  changedAt,
  changedBy: "Excel",
  note: null,
});
const start = [row(milk.id, milk.packagePrice, milk.packageSize, "2026-09-01T09:00:00.000Z"), row(coffee.id, coffee.packagePrice, coffee.packageSize, "2026-09-01T09:00:00.000Z")];
/** Süt 51,85 → 60 ₺/L (+%16), 15 Ekim */
const milkUp = [...start, row(milk.id, 60, 1000, "2026-10-15T09:00:00.000Z")];

const withPrices = (prices: Record<number, number>, over: Partial<Dataset> = {}): Dataset => ({
  ...ds,
  ...over,
  ingredients: (over.ingredients ?? ds.ingredients).map((i) => (prices[i.id] !== undefined ? { ...i, packagePrice: prices[i.id] } : i)),
});
const close = (a: number, b: number, msg: string, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const latte = ds.products.find((p) => p.name === "Latte" && p.size === "M")!;
/** Latte M laffogato.net menüsüne bağlı; Eylül'de online 20 Latte M ve bağlı olmayan 5 satır */
function siteRecord(month: string): SiteSalesMonth {
  const t = { orders: 0, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 };
  return {
    month,
    pulledAt: "2026-10-01T06:00:00.000Z",
    now: "2026-10-01T06:00:00.000Z",
    from: `${month}-01`,
    to: `${month}-30`,
    closed: true,
    cafe: {
      ...t,
      lines: [
        { menuItemId: "mnu-0003", size: "M", name: "Latte", qty: 20, listMinor: 0 },
        { menuItemId: "mnu-9999", size: "M", name: "Bağlı değil", qty: 5, listMinor: 0 },
      ],
    },
    shop: t,
    karaoke: { bookings: 0, collectedMinor: 0, refundedMinor: 0, netMinor: 0, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 },
    manual: { orders: 0, grossMinor: 0, netMinor: 0 },
  };
}

// ---------------------------------------------------------------- Satış dayanağı

test("satış dayanağı: Eylül'de ölçek 1, açık gün yarıya inince 2; online eşlenmiş adet eklenir; eşleşmeyen ayrı; satışsız ay null", () => {
  const model = createModel(ds);
  assert.equal(latestSalesMonth(model), "2026-09");
  const sep = salesBasis(model, "2026-09");
  assert.ok(sep);
  assert.equal(sep.basis.openDays, 30);
  assert.equal(sep.basis.standardDays, 30);
  assert.equal(sep.basis.scale, 1);
  assert.equal(sep.basis.posQty, sum([...model.soldByProduct("2026-09").values()]));
  assert.equal(sep.basis.onlineQty, 0);
  // Ürüne eşleşmeyen POS satırları adede girmez, sayısı dayanakta
  const unmatched = model.monthSales("2026-09").unmatched;
  assert.ok(unmatched.length > 0);
  assert.equal(sep.basis.unmatchedQty, sum(unmatched.map((l) => l.line.qty)));
  assert.equal(sep.perMonth.get(latte.id), model.soldByProduct("2026-09").get(latte.id));
  assert.equal(sep.basis.openDaysFrom, null);
  assert.equal(basisText(sep.basis), "Eylül 2026 satışlarına göre (ayda 30 açık gün).");

  // Açık gün 15: adetler standart aya (30 gün) iki katına çıkar
  const half = createModel({ ...ds, months: ds.months.map((m) => (m.month === "2026-09" ? { ...m, openDays: 15 } : m)) });
  const h = salesBasis(half, "2026-09")!;
  assert.equal(h.basis.scale, 2);
  assert.equal(h.perMonth.get(latte.id), 2 * model.soldByProduct("2026-09").get(latte.id)!);
  assert.equal(basisText(h.basis), "Eylül 2026 satışlarına göre: 15 açık gün, ayda 30 açık güne çevrildi.");
  // Açık gün girilmemiş: ölçek 1, adetler olduğu gibi
  const none = createModel({ ...ds, months: ds.months.map((m) => (m.month === "2026-09" ? { ...m, openDays: null } : m)) });
  assert.equal(salesBasis(none, "2026-09")!.basis.scale, 1);
  assert.match(basisText(salesBasis(none, "2026-09")!.basis), /açık günü girilmedi/);

  // Online: menüye bağlı ürünün online adedi eklenir; bağlı olmayan online satır sayılmaz
  const online = createModel({
    ...ds,
    products: ds.products.map((p) => (p.id === latte.id ? { ...p, siteMenuId: "mnu-0003", siteMenuSlot: "M" as const } : p)),
    siteSales: [siteRecord("2026-09")],
  });
  const o = salesBasis(online, "2026-09")!;
  assert.equal(o.basis.onlineQty, 20);
  assert.equal(o.perMonth.get(latte.id), model.soldByProduct("2026-09").get(latte.id)! + 20);

  // Satışsız ay (ne POS satırı ne eşlenmiş online satır)
  assert.equal(salesBasis(model, "2026-10"), null);
  assert.equal(salesBasis(model, "2026-08"), null);
});

test("satış dayanağı: açık gün kasa raporlarından geliyorsa (kasa grubunun isteğe bağlı alanları) kaynak ve eksik gün yazılır", () => {
  // Month.sources / Month.kasa.till.missing henüz tipte yok: alanlar varsa okunur, yoksa davranış aynı
  const months = ds.months.map((m) =>
    m.month === "2026-09" ? { ...m, openDays: 27, sources: { openDays: "kasa" }, kasa: { till: { missing: ["2026-09-03", "2026-09-10", "2026-09-17"] } } } : m,
  );
  const model = createModel({ ...ds, months } as Dataset);
  const b = salesBasis(model, "2026-09")!.basis;
  assert.deepEqual(b.openDaysFrom, { source: "kasa", missing: 3 });
  assert.equal(basisText(b), "Eylül 2026 satışlarına göre: 27 açık gün (kasa raporlarından, 3 gün eksik), ayda 30 açık güne çevrildi.");
  // Elle girilmiş açık gün: kaynak yazılmaz
  const manual = createModel({ ...ds, months: ds.months.map((m) => (m.month === "2026-09" ? { ...m, sources: { openDays: "manual" } } : m)) } as Dataset);
  assert.equal(salesBasis(manual, "2026-09")!.basis.openDaysFrom, null);
});

// ---------------------------------------------------------------- Aylık kayıp

test("süt zammı: ürünün birim maliyet artışı productImpacts'in farkıyla aynı; toplam kayıp ürünlerin ve artan hammaddelerin toplamı", () => {
  const model = createModel(withPrices({ [milk.id]: 60 }));
  const changes = ingredientChanges(model.ds.ingredients, milkUp, SINCE);
  const loss = priceLoss(model, changes, "2026-09");
  const impacts = productImpacts(model, changes);
  assert.ok(impacts.length > 10);
  for (const i of impacts) {
    const p = loss.products.find((x) => x.productId === i.productId);
    assert.ok(p, `${i.key} kayıpta yok`);
    close(p.unitDelta, i.costAfter - i.costBefore, i.key);
    close(p.profitBefore, i.profitBefore, `${i.key} birim kâr`);
    close(p.profitAfter, i.profitAfter, `${i.key} birim kâr (sonra)`);
  }
  close(loss.totalLoss, sum(loss.products.map((p) => p.monthly)), "ürünlerin toplamı", 1e-6);
  close(loss.totalLoss, sum(loss.ingredients.filter((i) => i.pct > 0).map((i) => i.monthly)), "artan hammaddelerin toplamı", 1e-6);
  assert.equal(loss.totalGain, 0);
  // Ürünler aylık kayba göre büyükten küçüğe; Latte'nin kaybı birim artış × Eylül adedi
  for (let k = 1; k < loss.products.length; k++) assert.ok(loss.products[k - 1].monthly >= loss.products[k].monthly);
  const l = loss.products.find((p) => p.productId === latte.id)!;
  assert.equal(l.monthlyQty, model.soldByProduct("2026-09").get(latte.id));
  close(l.monthly, l.unitDelta * l.monthlyQty, "Latte");
  assert.equal(l.drivers[0].ingredientId, milk.id);
  assert.ok(loss.grossProfit && loss.grossProfit > 0);
});

test("süt +%16, Eylül: sütün aylık kaybı ≈ 690 ₺ (kullanım × fark × (1 + fire))", () => {
  const model = createModel(withPrices({ [milk.id]: 60 }));
  const loss = priceLoss(model, ingredientChanges(model.ds.ingredients, milkUp, SINCE), "2026-09");
  const m = loss.ingredients.find((i) => i.ingredientId === milk.id)!;
  const usage = model.ingredientUsage("2026-09").get(milk.id)!;
  const delta = 60 / 1000 - milk.packagePrice / milk.packageSize;
  assert.ok(m.monthly >= usage * delta && m.monthly <= usage * delta * 1.2, `${m.monthly}`);
  assert.ok(Math.abs(m.monthly - 690) < 20, `≈ 690 ₺ beklenirdi: ${m.monthly}`);
  close(m.monthlyUsage, usage * (1 + model.settings.fire), "fire dahil kullanım", 1e-6);
  assert.ok(m.productCount > 5);
});

test("fire: ambalaj hariç tutulunca ambalajın zammında çarpan 1; fire oranı girilmiş ürün kendi oranıyla", () => {
  const cup = ds.ingredients.find((i) => i.category === "Ambalaj" && ds.recipeItems.some((r) => r.ingredientId === i.id && r.productId === latte.id))!;
  assert.ok(cup, "Latte'de ambalaj yok");
  const history = [row(cup.id, cup.packagePrice, cup.packageSize, "2026-09-01T09:00:00.000Z"), row(cup.id, cup.packagePrice * 1.5, cup.packageSize, "2026-10-15T09:00:00.000Z")];
  const lineQty = ds.recipeItems.filter((r) => r.productId === latte.id && r.ingredientId === cup.id).reduce((a, r) => a + (r.qty ?? 0), 0);
  const diff = (cup.packagePrice * 0.5) / cup.packageSize;
  for (const excl of [false, true]) {
    const model = createModel(withPrices({ [cup.id]: cup.packagePrice * 1.5 }, { settings: { ...ds.settings, fireExcludesPackaging: excl } }));
    const p = priceLoss(model, ingredientChanges(model.ds.ingredients, history, SINCE), "2026-09").products.find((x) => x.productId === latte.id)!;
    close(p.unitDelta, lineQty * diff * (excl ? 1 : 1 + ds.settings.fire), `ambalaj hariç: ${excl}`);
    const impact = productImpacts(model, ingredientChanges(model.ds.ingredients, history, SINCE)).find((i) => i.productId === latte.id);
    if (impact) close(p.unitDelta, impact.costAfter - impact.costBefore, `productImpacts ile aynı (${excl})`);
  }
  // Ürüne özel fire oranı
  const own = createModel({ ...withPrices({ [milk.id]: 60 }), products: ds.products.map((p) => (p.id === latte.id ? { ...p, fireOverride: 0.2 } : p)) });
  const p = priceLoss(own, ingredientChanges(own.ds.ingredients, milkUp, SINCE), "2026-09").products.find((x) => x.productId === latte.id)!;
  const milkQty = own.activeProducts.find((x) => x.product.id === latte.id)!.lines.filter((l) => l.item.ingredientId === milk.id).reduce((a, l) => a + l.qty, 0);
  close(p.unitDelta, milkQty * (60 / 1000 - milk.packagePrice / milk.packageSize) * 1.2, "fire %20");
});

test("yalnız indirim: kayıp yok, kazanç var; ay yoksa dayanak yok ve aylık tutarlar 0, birim artış yine hesaplanır", () => {
  const cheaper = createModel(withPrices({ [milk.id]: 45 }));
  const down = priceLoss(cheaper, ingredientChanges(cheaper.ds.ingredients, [...start, row(milk.id, 45, 1000, "2026-10-15T09:00:00.000Z")], SINCE), "2026-09");
  assert.equal(down.products.length, 0);
  assert.equal(down.totalLoss, 0);
  assert.ok(down.totalGain > 0);
  assert.ok(down.ingredients[0].monthly < 0);
  close(down.totalGain, -down.ingredients[0].monthly, "kazanç");

  const model = createModel(withPrices({ [milk.id]: 60 }));
  const changes = ingredientChanges(model.ds.ingredients, milkUp, SINCE);
  for (const month of [null, "2026-10"]) {
    const loss = priceLoss(model, changes, month);
    assert.equal(loss.basis, null);
    assert.equal(loss.grossProfit, null);
    assert.ok(loss.products.length > 10);
    assert.ok(loss.products.every((p) => p.monthly === 0 && p.monthlyQty === 0 && p.unitDelta > 0));
    assert.ok(loss.ingredients.every((i) => i.monthly === 0));
    assert.equal(loss.totalLoss, 0);
  }
});

// ---------------------------------------------------------------- Uyarı metni ve sabah e-postası

test("uyarı metni: aylık kayıp verilmezse eskisiyle aynı; verilirse sonuna eklenir; 1 ₺'den azsa eklenmez", () => {
  const changes = [{ name: "Süt %2,5", pct: 0.157 }, { name: "Espresso çekirdeği", pct: 0.06 }] as Parameters<typeof priceAlert>[0];
  const actionable = [{ key: "Latte|M" }, { key: "Mocha|L" }];
  const plain = priceAlert(changes, actionable);
  assert.deepEqual(plain, {
    level: "warning",
    title: "Hammadde zammı: 2 ürünün fiyatına bakın",
    detail: "Süt %2,5 +%16, Espresso çekirdeği +%6. Latte M, Mocha L: maliyet oranı hedefin üstünde, önerilen fiyat hazır.",
    href: "/panel/urunler#zamlar",
  });
  assert.deepEqual(priceAlert(changes, actionable, null), plain);
  assert.deepEqual(priceAlert(changes, actionable, 0.4), plain);
  const withLoss = priceAlert(changes, actionable, 7850.4)!;
  assert.equal(withLoss.title, plain!.title);
  assert.equal(withLoss.detail, `${plain!.detail} Bu zamlar ayda ≈ 7.850 ₺ kâr götürüyor.`);
  assert.equal(priceAlert(changes, [], 7850), null);
});

test("sabah e-postası: zam bölümüne aylık kayıp ve hammadde satırına ayda tutar; alan yoksa eskisi gibi", () => {
  const base: DigestPrices = { changes: [{ name: "Süt", unit: "ml", before: 0.05185, after: 0.06, pct: 0.157 }], products: [], productCount: 0 };
  const old = renderDigest([], "2026-10-22", null, base);
  assert.doesNotMatch(old.html, /kâr götürüyor/);
  assert.doesNotMatch(old.text, /ayda/);
  const withLoss = renderDigest([], "2026-10-22", null, { ...base, changes: [{ ...base.changes[0], monthly: 690.2 }], monthlyTotal: 7850, basisMonth: "2026-09" });
  // Konu değişmez
  assert.equal(withLoss.subject, old.subject);
  assert.match(withLoss.html, /Bu zamlar ayda ≈ 7\.850 ₺ kâr götürüyor \(Eylül 2026 satışlarıyla\)\./);
  assert.match(withLoss.html, /· ayda ≈ 690 ₺/);
  assert.match(withLoss.text, /Bu zamlar ayda ≈ 7\.850 ₺ kâr götürüyor \(Eylül 2026 satışlarıyla\)\./);
  assert.match(withLoss.text, /- Süt: .*\(\+%16\) · ayda ≈ 690 ₺/);
  // Satış ayı yok ya da tutar 1 ₺'den az: ek yazılmaz
  const noBasis = renderDigest([], "2026-10-22", null, { ...base, changes: [{ ...base.changes[0], monthly: null }], monthlyTotal: null, basisMonth: null });
  assert.equal(noBasis.html, old.html);
  assert.equal(noBasis.text, old.text);
});

// ---------------------------------------------------------------- Tek hesap yolu

test("bütün okuyucular aynı yükleyiciden: Ürünler, ürün kartı, Genel bakış, zil ve e-posta aylık kaybı loadPriceAlerts'ten alır", () => {
  const loader = read("src/server/data/price-alerts.ts");
  assert.match(loader, /priceLoss\(model, changes, month\)/);
  assert.match(loader, /month: string \| null = latestSalesMonth\(model\)/);
  assert.match(read("src/app/panel/page.tsx"), /priceAlert\(priceAlerts\.changes, priceAlerts\.actionable, priceAlerts\.loss\.totalLoss\)/);
  assert.match(read("src/server/actions/notifications.ts"), /priceAlert\(prices\.changes, prices\.actionable, prices\.loss\.totalLoss\)/);
  assert.match(read("src/app/panel/urunler/page.tsx"), /loss=\{prices\.loss\}/);
  const digest = read("src/server/notify/digest.ts");
  assert.match(digest, /priceLoss\(model, fresh, latestSalesMonth\(model\)\)/);
  // "Ayda" için ölçek tek yerde: başka bir dosya acikGun ÷ openDays yazmaz
  assert.match(read("src/lib/calc/price-loss.ts"), /export function salesBasis\(/);
});
