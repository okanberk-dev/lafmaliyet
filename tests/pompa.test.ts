// Püre pompası (30 ml) şurup pompasının (10 ml) yanında: PurePompa formülü, kaydı olmayan veritabanında varsayılan,
// Ayarlar alanı ve eylemin kabul ettiği anahtar, reçete defterindeki pompa karşılığı (src/lib/recipe-pump.ts).
// Çalıştırma: npx tsx --test tests/pompa.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_FIELDS, MEASURE_FIELDS } from "../src/app/panel/ayarlar/fields";
import { createModel } from "../src/lib/calc/engine";
import { evaluateExpression, formulaParams, validateExpression } from "../src/lib/calc/expr";
import type { Dataset } from "../src/lib/calc/types";
import { DEFAULT_SETTINGS, RECIPE_PARAMS, settingsFromRows } from "../src/lib/constants";
import { pumpCount, pumpHint, pumpOf, type PumpLine } from "../src/lib/recipe-pump";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const st = DEFAULT_SETTINGS;

// ---------------------------------------------------------------- Ayar ve formül

test("varsayılan 30 ml; formül adı PurePompa, Pompa'nın hemen ardında", () => {
  assert.equal(DEFAULT_SETTINGS.pompaPure, 30);
  assert.equal(DEFAULT_SETTINGS.pompa, 10);
  const i = RECIPE_PARAMS.findIndex((p) => p.name === "PurePompa");
  assert.ok(i > 0);
  assert.deepEqual(RECIPE_PARAMS[i], { name: "PurePompa", key: "pompaPure", label: "1 pompa püre", unit: "ml" });
  assert.equal(RECIPE_PARAMS[i - 1].name, "Pompa");
});

test("PurePompa formülü: iki sırada da, virgüllü ondalıkla, eşittirle; Pompa ile karışmaz", () => {
  assert.equal(evaluateExpression("PurePompa", st), 30);
  assert.equal(evaluateExpression("1,5*PurePompa", st), 45);
  assert.equal(evaluateExpression("PurePompa*1,5", st), 45);
  assert.equal(evaluateExpression("PurePompa*2", st), 60);
  assert.equal(evaluateExpression("=1.5 * PurePompa", st), 45);
  assert.equal(evaluateExpression("1,5 × purepompa", st), 45);
  // Ad tam eşleşir: PurePompa şurup pompası (10) okunmaz, Pompa da püre pompası okunmaz
  assert.equal(evaluateExpression("2*Pompa", st), 20);
  assert.equal(evaluateExpression("Pompa+PurePompa", st), 40);
  // Ayar değişince formül yeni ölçüyü okur
  assert.equal(evaluateExpression("1,5*PurePompa", { ...st, pompaPure: 25 }), 37.5);
  assert.equal(validateExpression("2*PurePompaa", st), "Bilinmeyen değişken: PurePompaa");
});

test("formül adında Türkçe harf ve büyük harf farkı gözetilmez (PürePompa, SHOTÇİFT); eski yazımlar aynı", () => {
  assert.equal(evaluateExpression("1,5*PürePompa", st), 45);
  assert.equal(evaluateExpression("PÜREPOMPA", st), 30);
  assert.equal(evaluateExpression("2*SHOTÇİFT", st), 36);
  assert.equal(evaluateExpression("2*ShotCift", st), 36);
  assert.equal(evaluateExpression("TKGR+tkgr", st), 14);
  assert.equal(evaluateExpression("=200*PotGr/PotMl", st), (200 * 105) / 1800);
  assert.throws(() => evaluateExpression("2*Bilinmeyen", st), /Bilinmeyen değişken: Bilinmeyen/);
});

test("formülde geçen ölçüler: tam adla, okunamayan formülde boş", () => {
  assert.deepEqual([...formulaParams("1,5*PurePompa")], ["pompaPure"]);
  assert.deepEqual([...formulaParams("=2*Pompa")], ["pompa"]);
  assert.deepEqual([...formulaParams("Pompa + PurePompa")].sort(), ["pompa", "pompaPure"]);
  assert.deepEqual([...formulaParams("2*ShotCift")], ["shotCift"]);
  assert.deepEqual([...formulaParams("1,5*PürePompa")], ["pompaPure"]);
  assert.equal(formulaParams("45").size, 0);
  assert.equal(formulaParams("2*Bilinmeyen").size, 0);
  assert.equal(formulaParams("2 $ Pompa").size, 0);
});

test("kaydı olmayan veritabanı varsayılanı okur; kayıtlı değer ve bilinmeyen anahtar", () => {
  // Bugünkü canlı veritabanında pompaPure satırı yok: 30 ml
  const before = settingsFromRows([
    { key: "pompa", value: 12 },
    { key: "shotTek", value: 9 },
    { key: "eskiAyar", value: 5 },
    { key: "constructor", value: 1 },
  ]);
  assert.equal(before.pompaPure, 30);
  assert.equal(before.pompa, 12);
  assert.equal(before.shotTek, 9);
  assert.equal("eskiAyar" in before, false);
  assert.equal(Object.hasOwn(before, "constructor"), false);
  assert.equal(settingsFromRows([]).pompaPure, 30);
  assert.equal(settingsFromRows([{ key: "pompaPure", value: 25 }]).pompaPure, 25);
  // Excel verisinde de yok: seed varsayılanı yazar
  assert.equal(excelToDataset(data).settings.pompaPure, 30);
  // loadSettings bu kuralı kullanır
  assert.match(read("src/server/data/dataset.ts"), /return settingsFromRows\(await getDb\(\)\.select\(\)\.from\(s\.settings\)\);/);
});

test("Ayarlar: alan şurup pompasının ardında, formül adıyla; eylem anahtarı kabul eder ve geçmişe adıyla yazar", () => {
  const i = MEASURE_FIELDS.findIndex((f) => f.key === "pompaPure");
  assert.ok(i > 0);
  assert.equal(MEASURE_FIELDS[i - 1].key, "pompa");
  assert.equal(MEASURE_FIELDS[i - 1].label, "1 pompa şurup (ml)");
  assert.deepEqual(MEASURE_FIELDS[i], { key: "pompaPure", label: "1 pompa püre (ml)", hint: "Püre pompasının bir basışı", formula: "PurePompa", kind: "num" });
  // Ölçü alanlarının formül adları gerçekten formülde geçer
  for (const f of MEASURE_FIELDS) if (f.formula) assert.ok(RECIPE_PARAMS.some((p) => p.name === f.formula && p.key === f.key), f.key);

  const src = read("src/server/actions/settings.ts");
  const schema = src.slice(src.indexOf("const settingsSchema = z.object({"), src.indexOf("});", src.indexOf("const settingsSchema")));
  const keys = new Set([...schema.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]));
  // Formdaki her sayı alanı eylemde de var (yeni ayar unutulursa kayıt sessizce düşmez)
  for (const f of ALL_FIELDS) assert.ok(keys.has(f.key), `saveSettings ${f.key} anahtarını tanımıyor`);
  assert.match(schema, /\n {2}pompaPure: numKey\.min\(0\),\n/);
  assert.match(src, /\n {2}pompaPure: \["Püre pompası \(ml\)", "num"\],\n/);
  assert.match(src, /\n {2}pompa: \["Şurup pompası \(ml\)", "num"\],\n/);
});

test("formülle bağlı püre satırı: 1,5*PurePompa varsayılanla 45 ml, ölçü değişince birlikte değişir", () => {
  const ds: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
  const product = ds.products.find((p) => p.name === "Strawberry" && p.size === "M")!;
  const puree = ds.ingredients.find((i) => i.name === "Çilek püre")!;
  const item = ds.recipeItems.find((r) => r.productId === product.id && r.ingredientId === puree.id)!;
  assert.equal(item.qty, 45);
  assert.equal(item.qtyExpr, null);
  const withFormula = (settings = ds.settings): Dataset => ({
    ...ds,
    settings,
    recipeItems: ds.recipeItems.map((r) => (r.id === item.id ? { ...r, qtyExpr: "1,5*PurePompa" } : r)),
  });
  const line = (d: Dataset) => createModel(d).products.find((p) => p.key === "Strawberry|M")!.lines.find((l) => l.item.id === item.id)!;
  const base = createModel(ds).products.find((p) => p.key === "Strawberry|M")!;
  const linked = createModel(withFormula()).products.find((p) => p.key === "Strawberry|M")!;
  assert.equal(line(withFormula()).qty, 45);
  // Aynı ml: maliyet değişmez
  assert.ok(Math.abs(linked.cost - base.cost) < 1e-9);
  assert.equal(line(withFormula({ ...ds.settings, pompaPure: 25 })).qty, 37.5);
  // Ml yazılı satır pompa değişince aynı kalır (veri yeniden yazılmaz)
  const plain = createModel({ ...ds, settings: { ...ds.settings, pompaPure: 25 } }).products.find((p) => p.key === "Strawberry|M")!;
  assert.equal(plain.lines.find((l) => l.item.id === item.id)!.qty, 45);
});

// ---------------------------------------------------------------- Reçete defterindeki pompa karşılığı

const L = (over: Partial<PumpLine>): PumpLine => ({ qty: 45, unit: "ml", qtyExpr: null, category: "Püre", ...over });

test("pompa karşılığı: formülden (Pompa / PurePompa), yoksa kategoriden", () => {
  assert.equal(pumpHint(L({ qtyExpr: "1,5*PurePompa" }), st), "1,5 pompa");
  assert.equal(pumpHint(L({ qty: 20, qtyExpr: "2*Pompa", category: "Sos & Şurup" }), st), "2 pompa");
  // Kategori: Püre → püre pompası, Sos & Şurup → şurup pompası
  assert.equal(pumpHint(L({ qty: 60 }), st), "2 pompa");
  assert.equal(pumpHint(L({ qty: 30 }), st), "1 pompa");
  assert.equal(pumpHint(L({ qty: 25, category: "Sos & Şurup" }), st), "2,5 pompa");
  assert.equal(pumpHint(L({ qty: 10, category: "Sos & Şurup" }), st), "1 pompa");
  // Yazılan formül kategoriden önce gelir (püreye şurup pompasıyla yazılmış formül)
  assert.equal(pumpOf({ qtyExpr: "3*Pompa", category: "Püre" }), "pompa");
  assert.equal(pumpHint(L({ qty: 30, qtyExpr: "3*Pompa" }), st), "3 pompa");
  // İki pompa birden ya da pompasız formül: kategoriye düşer
  assert.equal(pumpOf({ qtyExpr: "Pompa+PurePompa", category: "Püre" }), "pompaPure");
  assert.equal(pumpOf({ qtyExpr: "Pompa+PurePompa", category: "Süt" }), null);
  assert.equal(pumpOf({ qtyExpr: "15+30", category: "Püre" }), "pompaPure");
  // Ne formülde pompa ne pompalı kategori
  assert.equal(pumpHint(L({ qty: 200, category: "Süt" }), st), null);
  assert.equal(pumpHint(L({ category: null }), st), null);
});

test("pompa karşılığı: yarım pompa tam yazılır, gerisi bir ondalıkla yaklaşık", () => {
  assert.equal(pumpHint(L({ qty: 15 }), st), "0,5 pompa");
  assert.equal(pumpHint(L({ qty: 40 }), st), "≈ 1,3 pompa");
  assert.equal(pumpHint(L({ qty: 12, category: "Sos & Şurup" }), st), "≈ 1,2 pompa");
  assert.equal(pumpHint(L({ qty: 59 }), st), "≈ 2 pompa");
  // Ölçü değişince ml aynı, pompa sayısı yeni ölçüyle
  assert.equal(pumpHint(L({ qty: 45 }), { ...st, pompaPure: 25 }), "≈ 1,8 pompa");
  assert.equal(pumpCount(L({ qty: 45 }), { ...st, pompaPure: 25 }), 1.8);
});

test("pompa karşılığı yok: 0 miktar, ml dışı birim, ambalaj, yazılmamış pompa ölçüsü, pompanın yirmide birinden az", () => {
  assert.equal(pumpHint(L({ qty: 0 }), st), null);
  assert.equal(pumpHint(L({ qty: -5 }), st), null);
  assert.equal(pumpHint(L({ unit: "gr" }), st), null);
  assert.equal(pumpHint(L({ unit: "adet", category: "Sos & Şurup", qty: 1 }), st), null);
  assert.equal(pumpHint(L({ packaging: true }), st), null);
  assert.equal(pumpHint(L({}), { ...st, pompaPure: 0 }), null);
  assert.equal(pumpHint(L({ qty: 1 }), st), null);
  assert.equal(pumpHint(L({ qty: 2 }), st), "≈ 0,1 pompa");
});

test("Excel reçeteleri: püre satırları püre pompasıyla, formüllü şurup satırları şurup pompasıyla", () => {
  const model = createModel({ ...excelToDataset(data), currentMonth: "2026-10" });
  const hint = (key: string, ingredient: string) => {
    const p = model.products.find((x) => x.key === key)!;
    const l = p.lines.find((x) => x.ingredient?.name === ingredient)!;
    return pumpHint({ qty: l.qty, unit: l.ingredient!.unit, qtyExpr: l.item.qtyExpr, category: l.ingredient!.category, packaging: l.isPackaging }, model.settings);
  };
  assert.equal(hint("Mango|M", "Mango püre"), "1 pompa");
  assert.equal(hint("Mango|L", "Mango püre"), "≈ 1,3 pompa");
  assert.equal(hint("Strawberry|M", "Çilek püre"), "1,5 pompa");
  assert.equal(hint("Strawberry|L", "Çilek püre"), "2 pompa");
  assert.equal(hint("Peach Tea|L", "Şeftali çay şurubu"), "5 pompa");
  assert.equal(hint("Caramel Latte|M", "Karamel sos"), "1,5 pompa");
});

test("reçete defteri: pompa metni sunucuda hesaplanır, personelin sayfasına yalnız metin gider", () => {
  const page = read("src/app/panel/receteler/page.tsx");
  assert.match(page, /pump: pumpHint\(/);
  const book = read("src/app/panel/receteler/recipe-book.tsx");
  assert.match(book, /pump: string \| null;/);
  assert.match(book, /\{c\.pump \? <span className="block [^"]*text-ink-mute[^"]*">\{c\.pump\}<\/span> : null\}/);
  // Formül yardımında örnek bir kez
  const help = read("src/app/panel/receteler/recipe-lines.tsx");
  assert.equal(help.split("“1,5*PurePompa” (püre)").length - 1, 1);
});
