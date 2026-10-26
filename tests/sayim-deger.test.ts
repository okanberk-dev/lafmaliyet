// Stok sayımının değeri ve listesi (denetim 26 Eki 2026, parti B02): aktif reçetedeki pasif malzeme sayım listesinde
// kalır (E-04), pasif yapma engelinin metni, "reçetede yok" yalnız aktif ürünlere bakar (E-58). Saf: motor ve yardımcılar.
// Veritabanındaki eylemler: tests/sayim-deger-db.test.ts. FIFO başlangıç ayı (E-05): tests/stok-fifo.test.ts.
// Çalıştırma: npx tsx --test tests/sayim-deger.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import { activeUses, isCountable, passiveRefusal, productListText } from "../src/lib/ingredient-usage";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
const linesOf = (ds: Dataset, month: string) =>
  createModel(ds)
    .stockSheet(month)
    .groups.flatMap((g) => g.lines);

// Reçetede kullanılan, sayım birimi olan bir malzeme ve onu kullanan ürünler
const used = base.ingredients.find((i) => i.active && i.countUnit && base.recipeItems.some((r) => r.ingredientId === i.id))!;
const users = new Set(base.recipeItems.filter((r) => r.ingredientId === used.id).map((r) => r.productId));

test("E-04: aktif ürünün reçetesindeki pasif malzeme sayım listesinde kalır, 'Pasif · reçetede' işaretiyle", () => {
  assert.ok(used, "reçetede kullanılan sayım kalemi var");
  const passive: Dataset = { ...base, ingredients: base.ingredients.map((i) => (i.id === used.id ? { ...i, active: false } : i)) };
  const line = linesOf(passive, "2026-11").find((l) => l.ingredient.id === used.id);
  assert.ok(line, "sonraki ayın sayım listesinde");
  assert.equal(line!.archived, false, "salt okunur değil: sayılır");
  assert.equal(line!.passiveInUse, true);
  assert.equal(linesOf(base, "2026-11").find((l) => l.ingredient.id === used.id)!.passiveInUse, false, "aktifken işaret yok");
  // Onu kullanan bütün ürünler de pasifse listeden düşer (geçmiş ayın kayıtlı sayımı arşivde kalır)
  const retired: Dataset = { ...passive, products: passive.products.map((p) => (users.has(p.id) ? { ...p, active: false } : p)) };
  assert.equal(linesOf(retired, "2026-11").find((l) => l.ingredient.id === used.id), undefined, "emekli üründe sayılmaz");
  const counted: Dataset = { ...retired, stockCounts: [{ month: "2026-11", ingredientId: used.id, qty: 2, factor: 1000 }] };
  assert.equal(linesOf(counted, "2026-11").find((l) => l.ingredient.id === used.id)!.archived, true, "kayıtlı sayım arşivde");
  // "Sayılmaz" (sayım birimi yok) her durumda listede değil
  const notCounted: Dataset = { ...passive, ingredients: passive.ingredients.map((i) => (i.id === used.id ? { ...i, countUnit: null } : i)) };
  assert.equal(linesOf(notCounted, "2026-11").find((l) => l.ingredient.id === used.id), undefined);
});

test("E-04: isCountable tek kural; pasif yapma engelinin metni ürünleri sayar", () => {
  assert.equal(isCountable({ active: true, countUnit: "KG" }, false), true);
  assert.equal(isCountable({ active: false, countUnit: "KG" }, true), true);
  assert.equal(isCountable({ active: false, countUnit: "KG" }, false), false);
  assert.equal(isCountable({ active: true, countUnit: null }, true), false);
  assert.equal(passiveRefusal("Lime şurubu", []), null);
  const six = ["M", "L"].flatMap((size) => ["Lemon Tea", "Ice Tea", "Limonata"].map((name, k) => ({ id: k, name, size })));
  assert.equal(productListText(six), "Lemon Tea · M, Ice Tea · M, Limonata · M ve 3 ürün daha");
  assert.equal(productListText([{ id: 1, name: "Lemon Tea" }]), "Lemon Tea");
  assert.equal(
    passiveRefusal("Lime şurubu", six),
    "“Lime şurubu” 6 aktif ürünün reçetesinde kullanılıyor (Lemon Tea · M, Ice Tea · M, Limonata · M ve 3 ürün daha). Pasif yapmadan önce bu reçetelerden çıkarın ya da yerine başka malzeme yazın; yoksa ürünler onu tüketmeye devam eder.",
  );
});

test("E-58: usedInActive yalnız aktif ürünlerin reçeteleri; usedIn (silme engeli) hepsi", () => {
  const retired: Dataset = { ...base, products: base.products.map((p) => (users.has(p.id) ? { ...p, active: false } : p)) };
  const m = createModel(retired);
  assert.deepEqual(new Set(m.usedIn.get(used.id)), users, "silme engeli pasif ürünleri de sayar");
  assert.equal(m.usedInActive.has(used.id), false);
  assert.equal(createModel(base).usedInActive.get(used.id)!.length, createModel(base).usedIn.get(used.id)!.length);
  assert.equal(activeUses({ usedIn: [] }), 0);
  assert.equal(activeUses({ usedIn: [{ active: true }, { active: false }, { active: true }] }), 2);
});

test("E-04 ekran: Hammaddeler'in sil penceresi ve 'Aktif' kutusu aktif ürünü olan malzemeyi pasif yaptırmaz", () => {
  const src = readFileSync(join(root, "src/app/panel/hammaddeler/ingredients-client.tsx"), "utf8");
  assert.ok(src.includes("const canPassivate = row.active && !inActive;"), "Pasif yap yalnız aktif ürünü yoksa");
  assert.ok(src.includes('confirmLabel={canPassivate ? "Pasif yap" : "Tamam"}'));
  assert.ok(!src.includes("Reçeteler ve ürün maliyetleri aynı kalır"), "eski yanıltıcı metin kalktı");
  assert.ok(src.includes('id="i-active"'), "Aktif kutusunun hatası");
  // Sunucu iki yoldan da reddeder (eylem kaynağı)
  const actions = readFileSync(join(root, "src/server/actions/ingredients.ts"), "utf8");
  assert.equal(actions.match(/passiveRefusal\(/g)?.length, 2, "setIngredientActive ve saveIngredient");
});
