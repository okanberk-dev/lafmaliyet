// Reçete değişiklik önerisi: yöneticinin gördüğü "önce / sonra" farkı, işlem geçmişi özeti ve reçetenin öneriden
// sonra değişip değişmediği (src/lib/recipe-change.ts).
// Çalıştırma: npx tsx --test tests/recete-onay.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { diffRecipe, estimateNames, qtyLabel, sameQty, sameRecipe, summarizeDiff, type RecipeSnapshot } from "../src/lib/recipe-change";

const line = (ingredientId: number, name: string, qty: number, unit = "ml", qtyExpr: string | null = null, note: string | null = null) => ({
  ingredientId,
  name,
  unit,
  qty,
  qtyExpr,
  note,
});

const latte: RecipeSnapshot = {
  note: "M = solo",
  items: [line(1, "Espresso", 18, "gr", "ShotCift"), line(2, "Süt", 200), line(3, "Bardak 8oz", 1, "adet")],
};

test("değişiklik yoksa fark boş", () => {
  const d = diffRecipe(latte, structuredClone(latte));
  assert.equal(d.empty, true);
  assert.equal(d.rows.every((r) => r.kind === "same"), true);
  assert.equal(sameRecipe(latte, structuredClone(latte)), true);
  assert.equal(summarizeDiff(d), "değişiklik yok");
});

test("miktar değişti, satır eklendi, satır çıkarıldı, not değişti", () => {
  const after: RecipeSnapshot = {
    note: "M = solo, sıcak süt",
    items: [line(1, "Espresso", 18, "gr", "ShotCift"), line(2, "Süt", 220), line(4, "Karamel şurubu", 10)],
  };
  const d = diffRecipe(latte, after);
  assert.equal(d.empty, false);
  assert.deepEqual(
    d.rows.map((r) => [r.kind, r.name]),
    [
      ["same", "Espresso"],
      ["changed", "Süt"],
      ["added", "Karamel şurubu"],
      ["removed", "Bardak 8oz"],
    ],
  );
  assert.equal(d.changed, 1);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.equal(d.note.changed, true);
  assert.equal(summarizeDiff(d), "Süt 200 ml → 220 ml; Karamel şurubu eklendi (10 ml); Bardak 8oz çıkarıldı; hazırlama notu değişti");
});

test("formül: boşluk ve büyük/küçük harf fark sayılmaz, formülden sayıya geçiş fark sayılır", () => {
  assert.equal(sameQty({ qty: 18, qtyExpr: "ShotCift" }, { qty: 18, qtyExpr: " shotcift " }), true);
  assert.equal(sameQty({ qty: 36, qtyExpr: "2*ShotCift" }, { qty: 36, qtyExpr: "2 * ShotCift" }), true);
  assert.equal(sameQty({ qty: 18, qtyExpr: "=ShotCift" }, { qty: 18, qtyExpr: "ShotCift" }), true);
  // Bugün aynı miktar ama ayar değişince farklılaşır: değişiklik sayılır
  assert.equal(sameQty({ qty: 18, qtyExpr: "ShotCift" }, { qty: 18, qtyExpr: null }), false);
  assert.equal(sameQty({ qty: 0.1 + 0.2, qtyExpr: null }, { qty: 0.3, qtyExpr: null }), true);
  assert.equal(qtyLabel(line(1, "Espresso", 36, "gr", "2*ShotCift")), "2*ShotCift (36 gr)");
  assert.equal(qtyLabel(line(2, "Süt", 0.125, "lt")), "0,125 lt");
});

test("aynı malzeme iki kez geçerse sırayla eşleşir; yalnız sıra değişse de değişiklik sayılır", () => {
  const before: RecipeSnapshot = { note: null, items: [line(5, "Buz", 100, "gr"), line(2, "Süt", 150), line(5, "Buz", 50, "gr")] };
  const after: RecipeSnapshot = { note: null, items: [line(5, "Buz", 100, "gr"), line(2, "Süt", 150), line(5, "Buz", 60, "gr")] };
  const d = diffRecipe(before, after);
  assert.deepEqual(
    d.rows.map((r) => r.kind),
    ["same", "same", "changed"],
  );
  const reordered: RecipeSnapshot = { note: null, items: [line(2, "Süt", 150), line(5, "Buz", 100, "gr"), line(5, "Buz", 50, "gr")] };
  const r = diffRecipe(before, reordered);
  assert.equal(r.empty, false, "sıra değişikliği önemli (barista o sırayla koyar)");
  assert.equal(summarizeDiff(r), "malzeme sırası değişti");
});

test("satır notu değişikliği ayrı yazılır; boş not ile null aynıdır", () => {
  const before: RecipeSnapshot = { note: null, items: [line(2, "Süt", 200, "ml", null, null)] };
  assert.equal(diffRecipe(before, { note: "  ", items: [line(2, "Süt", 200, "ml", null, "")] }).empty, true);
  const d = diffRecipe(before, { note: null, items: [line(2, "Süt", 200, "ml", null, "köpüklü")] });
  assert.equal(d.rows[0].kind, "changed");
  assert.equal(summarizeDiff(d), "Süt satır notu değişti");
});

test("özet uzunsa kısaltılır", () => {
  const many: RecipeSnapshot = { note: null, items: Array.from({ length: 30 }, (_, i) => line(100 + i, `Malzeme ${i}`, i + 1)) };
  const s = summarizeDiff(diffRecipe({ note: null, items: [] }, many), 120);
  assert.ok(s.length <= 120);
  assert.ok(s.endsWith("…"));
});

test("onay eylemi: reçete öneriden sonra değiştiyse önce bugünkü hâl döner, onaylayan yönetici", () => {
  const src = readFileSync(join(process.cwd(), "src/server/actions/recipe-requests.ts"), "utf8");
  assert.match(src, /export async function reviewRecipeChange[\s\S]*requireAdmin\(\)/);
  assert.match(src, /if \(!data\.force && !sameRecipe\(current, req\.before\)\) return \{ kind: "conflict"/);
  // Personel önerir (requireUser), kendi önerisini geri çeker
  assert.match(src, /export async function proposeRecipeChanges[\s\S]*?requireUser\(\)/);
  assert.match(src, /eq\(s\.recipeChangeRequests\.requestedBy, me\.id\), eq\(s\.recipeChangeRequests\.status, "pending"\)/);
  // Onay fiyat, ad, fire gibi alanlara dokunmaz: products'ta yalnız not yazılır
  assert.match(src, /tx\.update\(s\.products\)\.set\(\{ note: req\.after\.note, updatedAt: new Date\(\) \}\)/);
});

test("personelin reçete defteri verisinde fiyat ve maliyet yok", () => {
  const page = readFileSync(join(process.cwd(), "src/app/panel/receteler/page.tsx"), "utf8");
  for (const word of ["unitCost", "price", "cost", "packagePrice", "hedefMaliyet", "kdv"]) {
    assert.doesNotMatch(page, new RegExp(`\\b${word}\\b`), `${word} reçete defterine geçmemeli`);
  }
});

test("değişiklik önerisi: eklenen ya da miktarı değişen satırın tahmini fiyatlı malzemesi onay kartında söylenir", () => {
  const ing = (name: string, isEstimate: boolean, packagePrice = 100) => ({ name, active: true, priceSource: "manual", packagePrice, isEstimate });
  const byId = new Map([
    [1, ing("Espresso", false)],
    [2, ing("Süt", true)],
    [3, ing("Bardak 8oz", true)],
    [4, ing("Lavanta şurubu", true, 9000)],
    [6, ing("Fiyatsız şurup", true, 0)],
  ]);
  const before: RecipeSnapshot = { note: null, items: [line(1, "Espresso", 18, "gr"), line(2, "Süt", 200), line(3, "Bardak 8oz", 1, "adet")] };
  // Lavanta eklendi (personelin yazdığı fiyat), süt arttı (tahmini), bardak aynı (tahmini ama farkı taşımaz), fiyatsız olan ayrı uyarıda
  const after: RecipeSnapshot = {
    note: null,
    items: [line(1, "Espresso", 18, "gr"), line(2, "Süt", 220), line(3, "Bardak 8oz", 1, "adet"), line(4, "Lavanta şurubu", 20), line(6, "Fiyatsız şurup", 10)],
  };
  assert.deepEqual(estimateNames(before, after, byId), ["Süt", "Lavanta şurubu"]);
  assert.deepEqual(estimateNames(before, before, byId), []);
  const page = readFileSync(join(process.cwd(), "src/app/panel/onaylar/page.tsx"), "utf8");
  assert.match(page, /estimates: estimateNames\(r\.before, r\.after, model\.ingById\)/);
  const list = readFileSync(join(process.cwd(), "src/app/panel/onaylar/review-list.tsx"), "utf8");
  assert.match(list, /<EstimateNote names=\{item\.estimates\} \/>/);
  assert.match(list, /Tahmini fiyatlı: \{names\.join\(", "\)\}\. Paket fiyatı faturadan gelmedi; maliyet kesin değil\./);
});
