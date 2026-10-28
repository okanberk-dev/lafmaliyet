// Hammaddeler özet kartlarının dökümü (karta dokununca açılan pencere): hammadde sayısı, tahmini değerler,
// hiçbir reçetede olmayanlar ve su + buz birim maliyeti. Döküm her zaman kartın rakamını tutmalı.
// Çalıştırma: npx tsx --test tests/hammaddeler-dokum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { activeUses, ingredientBreakdowns, listHref, perLiterText, waterBreakdown, type DokumIngredient } from "../src/app/panel/hammaddeler/breakdowns";
import { sortCategories } from "../src/app/panel/hammaddeler/categories";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";
import { createModel, type WaterCost } from "../src/lib/calc/engine";
import { alerts, latestSalesMonth } from "../src/lib/calc/insights";
import type { Dataset } from "../src/lib/calc/types";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const data: ExcelData = JSON.parse(readFileSync(join(__dirname, "..", "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const groupsSum = (gs: BreakdownGroup[]) => sum(gs.filter((g) => !g.apart).flatMap((g) => g.rows.map((r) => r.amount)));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/** Sayfadaki satırlar gibi: malzeme + reçetesinde geçtiği ürünler (pasif ürünler `active: false`) */
function itemsOf(ds: Dataset): DokumIngredient[] {
  const model = createModel(ds);
  return ds.ingredients.map((i) => ({ ...i, usedIn: (model.usedIn.get(i.id) ?? []).map((pid) => ({ active: model.productById.get(pid)?.active ?? false })) }));
}

test("Hammadde kartı: aktif malzemeler kategori kategori, toplam kartın sayısı; pasifler ayrı ve toplama girmez", () => {
  // Excel'de pasif malzeme yok: birini pasife alıp ayrı bölümde göründüğünü de dene
  const ds: Dataset = { ...base, ingredients: base.ingredients.map((i, n) => (n === 0 ? { ...i, active: false } : i)) };
  const items = itemsOf(ds);
  const active = items.filter((i) => i.active);
  const b = ingredientBreakdowns(items);
  assert.equal(groupsSum(b.all), active.length);
  const p = prepareBreakdown(b.all, { total: active.length });
  assert.equal(p.total, active.length);
  const live = p.groups.find((g) => !g.apart)!;
  assert.equal(live.rows.length, new Set(active.map((i) => i.category)).size, "kategori sayısı karttaki alt yazıyla aynı");
  for (const r of live.rows) {
    assert.equal(r.amount, active.filter((i) => i.category === r.label).length);
    assert.equal(r.href, listHref({ kategori: r.label }));
  }
  const pasif = p.groups.find((g) => g.apart)!;
  assert.equal(pasif.subtotal, 1);
  assert.equal(pasif.rows[0].label, ds.ingredients[0].category);
  assert.match(pasif.rows[0].href!, /durum=pasif/);
});

test("Tahmini değer kartı: aktif tahmini malzemeler tek tek, kategori altında; toplam kartın sayısı", () => {
  const items = itemsOf(base);
  const active = items.filter((i) => i.active);
  const estimates = active.filter((i) => i.isEstimate);
  assert.ok(estimates.length > 0, "Excel verisinde tahmini malzeme var");
  const b = ingredientBreakdowns(items);
  assert.equal(groupsSum(b.estimates), estimates.length);
  const rows = b.estimates.flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => Number(r.key)).sort((x, y) => x - y), estimates.map((i) => i.id).sort((x, y) => x - y));
  for (const g of b.estimates) {
    for (const r of g.rows) {
      const i = estimates.find((x) => String(x.id) === r.key)!;
      assert.equal(g.label, i.category);
      assert.ok(r.display, "her kalemde paket fiyatı yazılı");
      assert.equal(r.href, listHref({ durum: "tahmini", ara: i.name }));
    }
  }
  // Kategoriler hammadde sırasıyla verilir (pencere sayıya göre dizer, eşitte bu sıra kalır)
  assert.deepEqual(b.estimates.map((g) => g.label), sortCategories(estimates.map((i) => i.category)));
});

test("Hiçbir reçetede yok kartı: aktif ve reçetesiz malzemeler; Genel bakış uyarısıyla aynı kural", () => {
  const extra = { ...base.ingredients[0], id: 99_001, name: "Deneme malzeme", note: "x".repeat(400), active: true };
  const ds: Dataset = { ...base, ingredients: [...base.ingredients, extra] };
  const model = createModel(ds);
  const items = itemsOf(ds);
  const unused = ds.ingredients.filter((i) => i.active && !model.usedInActive.has(i.id));
  const b = ingredientBreakdowns(items);
  assert.equal(groupsSum(b.unused), unused.length);
  const row = b.unused.flatMap((g) => g.rows).find((r) => r.key === "99001")!;
  assert.ok(row, "reçetesiz malzeme dökümde");
  assert.match(row.href!, /durum=kullanilmayan/);
  assert.match(row.href!, /ara=Deneme\+malzeme/);
  assert.ok(row.sub!.length < 220, "uzun not kısaltılır");
  assert.ok(row.sub!.endsWith("…"));
});

test("Bağlantı: süzgeçler adreste, liste kartına kayar; boş süzgeç yazılmaz", () => {
  assert.equal(listHref({ kategori: "Sos & Şurup" }), "/panel/hammaddeler?kategori=Sos+%26+%C5%9Eurup#hammadde-listesi");
  assert.equal(listHref({ durum: "tahmini", ara: "" }), "/panel/hammaddeler?durum=tahmini#hammadde-listesi");
  assert.equal(new URLSearchParams(listHref({ ara: "Süt & krema" }).split("?")[1].split("#")[0]).get("ara"), "Süt & krema");
});

test("Su + buz kartı: fatura ÷ litre; litre kalemleri motorun litresini tutar, toplam kartın rakamı", () => {
  // Excel verisinde SU GİDERİ yok: Eylül'e (satış listesi olan ay) fatura girilmiş gibi
  const model = createModel({ ...base, pnlEntries: [...base.pnlEntries, { month: "2026-09", rowKey: "manual:su", amount: 3000 }] });
  const w = model.water;
  assert.equal(w.reason, "ok");
  assert.equal(w.month, "2026-09");
  const d = waterBreakdown(w, base.ingredients, model.ingredientUsage(w.month!));
  assert.equal(d.totalDisplay, perLiterText(w.perLiter));
  assert.equal(d.hideTotal, false);
  const bill = d.groups.find((g) => g.key === "fatura")!;
  assert.equal(bill.rows[0].amount, w.bill);
  const liters = d.groups.find((g) => g.key === "litre")!;
  close(sum(liters.rows.map((r) => r.amount)), w.liters);
  close(w.bill / sum(liters.rows.map((r) => r.amount)), w.perLiter);
  assert.ok(liters.rows.every((r) => r.display?.endsWith(" L")));
  // Pencere bölümleri verildiği sırayla gösterir; kalemler düşmez
  const p = prepareBreakdown(d.groups, { order: "given" });
  assert.deepEqual(p.groups.map((g) => g.key), ["fatura", "litre"]);
});

test("Su + buz kartı: elle değer, satış listesi olmayan fatura, hiç fatura yok", () => {
  const water = (x: Partial<WaterCost>): WaterCost => ({ perLiter: 0, month: null, bill: 0, liters: 0, onlineLiters: 0, reason: "no-bill", latestBillMonth: null, ...x });
  const none = new Map<number, number>();

  const ov = waterBreakdown(water({ reason: "override", perLiter: 0.5 }), base.ingredients, none);
  assert.equal(ov.hideTotal, true);
  assert.equal(ov.groups[0].rows[0].display, perLiterText(0.5));
  assert.equal(perLiterText(0.5), "0,5000 ₺/L");

  const nu = waterBreakdown(water({ reason: "no-usage", latestBillMonth: "2026-10" }), base.ingredients, none);
  assert.match(nu.description, /Ekim 2026/);
  assert.deepEqual(nu.groups[0].rows.map((r) => r.display), ["Girildi", "Yok", "Yazılmadı"]);
  assert.equal(nu.groups[0].rows[1].href, "/panel/satislar?ay=2026-10");
  assert.equal(nu.totalDisplay, perLiterText(0));

  const nb = waterBreakdown(water({}), base.ingredients, none);
  assert.equal(nb.groups[0].rows[0].display, "Girilmedi");
  assert.equal(nb.groups[0].rows[0].tone, "warn");
  // Bilgi satırları tutarı 0 olsa da pencerede kalır
  assert.equal(prepareBreakdown(nb.groups, { order: "given" }).groups[0].rows.length, 2);

  // Son faturanın ayında satış listesi yoksa önceki ayın faturası kullanılır; atlanan fatura ayrı, toplama girmez
  const skip = waterBreakdown(water({ reason: "ok", perLiter: 0.2, month: "2026-09", bill: 100, liters: 500, latestBillMonth: "2026-10" }), base.ingredients, none);
  const apart = skip.groups.find((g) => g.apart)!;
  assert.equal(apart.rows[0].display, "Kullanılmadı");
  assert.match(apart.rows[0].label, /Ekim 2026/);
});

test("E-58: yalnız pasif ürünlerin kullandığı malzeme \"reçetede yok\" sayılır (kart, döküm, Genel bakış uyarısı)", () => {
  // Bir malzemeyi kullanan bütün ürünleri pasife al: malzeme aktif kalır ama hiçbir aktif ürün onu tüketmez
  const pick = base.ingredients.find((i) => {
    const users = new Set(base.recipeItems.filter((r) => r.ingredientId === i.id).map((r) => r.productId));
    return i.active && users.size > 0 && users.size <= 3;
  })!;
  assert.ok(pick, "az üründe kullanılan malzeme var");
  const users = new Set(base.recipeItems.filter((r) => r.ingredientId === pick.id).map((r) => r.productId));
  const ds: Dataset = { ...base, products: base.products.map((p) => (users.has(p.id) ? { ...p, active: false } : p)) };
  const model = createModel(ds);
  assert.ok(model.usedIn.has(pick.id), "silme engeli: pasif ürünlerde hâlâ kullanılıyor");
  assert.ok(!model.usedInActive.has(pick.id), "aktif ürünlerde yok");
  const b = ingredientBreakdowns(itemsOf(ds));
  const row = b.unused.flatMap((g) => g.rows).find((r) => r.key === String(pick.id));
  assert.ok(row, "dökümde reçetede yok");
  assert.match(row!.sub ?? "", /yalnız \d+ pasif üründe/);
  assert.equal(activeUses({ usedIn: [{ active: false }, { active: true }] }), 1);
  // Genel bakış uyarısı aynı kuralı kullanır
  const alert = alerts(model, latestSalesMonth(model)!).find((a) => /hiçbir reçetede yok/.test(a.title));
  assert.ok(alert, "uyarı var");
  assert.ok(alert!.detail.includes(pick.name) || /hammadde/.test(alert!.detail), "malzeme uyarıda");
  const before = alerts(createModel(base), latestSalesMonth(createModel(base))!).find((a) => /hiçbir reçetede yok/.test(a.title));
  const n = (t?: string) => Number(t?.match(/^(\d+)/)?.[1] ?? 0);
  assert.equal(n(alert!.title), n(before?.title) + 1, "uyarının sayısı bir arttı");
});
