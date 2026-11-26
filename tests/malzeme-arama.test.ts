// Reçete önerisindeki malzeme araması (src/lib/ingredient-search.ts, pencere src/app/panel/receteler/ingredient-picker.tsx):
// Enter (telefonda "Ara") yalnız tam adı ya da tek adayı seçer, ilk benzer sonucu değil; adı tutan malzeme kategori adıyla
// tutandan önce gelir; Türkçe harf farkı gözetilmez, listedeki ad ("Çilek şurubu") yazılınca ("cilek surubu") "ekle"
// çıkmaz. Liste tohumdaki gerçek hammaddelerle, pencerenin sırasıyla (useRecipeKit) kurulur.
// Çalıştırma: npx tsx --test tests/malzeme-arama.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { catOrder } from "../src/app/panel/hammaddeler/categories";
import { searchIngredients, type SearchIngredient } from "../src/lib/ingredient-search";

const seed = JSON.parse(readFileSync(join(__dirname, "../tests/fixtures/baslangic/veri.json"), "utf8")) as { ingredients: { name: string; category: string }[] };

/** useRecipeKit'in gruplaması: kategoriler sabit sırayla, malzemeler adına göre */
function groupLikeKit(list: SearchIngredient[]) {
  const m = new Map<string, SearchIngredient[]>();
  for (const i of list) m.set(i.category, [...(m.get(i.category) ?? []), i]);
  return [...m.entries()]
    .sort(([a], [b]) => catOrder(a) - catOrder(b) || a.localeCompare(b, "tr"))
    .map(([cat, items]) => [cat, [...items].sort((a, b) => a.name.localeCompare(b.name, "tr"))] as const);
}

const seedList: SearchIngredient[] = seed.ingredients.map((i, at) => ({ id: at + 1, name: i.name, category: i.category, active: true }));
const grouped = groupLikeKit(seedList);
const names = (r: ReturnType<typeof searchIngredients>) => r.groups.flatMap(([, l]) => l.map((i) => i.name));

test("Enter tam adı seçer: Su, Çay, Karton bardak 4oz, Çikolata sos ilk benzer sonuca kaymaz", () => {
  for (const [q, want] of [
    ["Su", "Su"],
    ["Çay", "Çay"],
    ["çay", "Çay"],
    ["CAY", "Çay"],
    ["Karton bardak 4oz", "Karton bardak 4oz"],
    ["  karton   bardak 4OZ ", "Karton bardak 4oz"],
    ["Çikolata sos", "Çikolata sos"],
  ]) {
    const r = searchIngredients(grouped, q, null);
    assert.equal(r.enterPick?.name, want, q);
    assert.equal(r.exact?.name, want, q);
    // Tam ad listenin en üstünde
    assert.equal(names(r)[0], want, q);
  }
});

test("tohumdaki her malzemenin tam adı yazılıp Enter'a basılınca o malzeme seçilir", () => {
  for (const i of seedList) assert.equal(searchIngredients(grouped, i.name, null).enterPick?.id, i.id, i.name);
});

test("boş arama ve birden çok benzer sonuç Enter ile seçilmez", () => {
  const empty = searchIngredients(grouped, "", null);
  assert.equal(empty.enterPick, undefined);
  assert.equal(empty.exact, undefined);
  // Boş aramada bütün liste pencerenin sırasıyla
  assert.deepEqual(names(empty), grouped.flatMap(([, l]) => l.map((i) => i.name)));
  const milk = searchIngredients(grouped, "süt", null);
  assert.ok(names(milk).length > 1);
  assert.equal(milk.enterPick, undefined);
  assert.equal(milk.exact, undefined);
});

test("tek aday Enter ile seçilir", () => {
  const r = searchIngredients(grouped, "colombia", null);
  assert.deepEqual(names(r), ["Cold brew kahve (Colombia)"]);
  assert.equal(r.enterPick?.name, "Cold brew kahve (Colombia)");
});

test("adı tutan varken kategori adıyla tutan gelmez; ad tutmazsa kategori aranır", () => {
  // "Sos & Şurup" "su" içerir; eskiden o gruptaki her şey "Su" aramasında çıkıyordu
  for (const n of names(searchIngredients(grouped, "Su", null))) assert.match(n.toLocaleLowerCase("tr-TR"), /s[uü]|ş[uü]/, n);
  const byCategory = searchIngredients(grouped, "ambalaj", null);
  assert.ok(names(byCategory).length > 1);
  assert.ok(byCategory.groups.every(([cat]) => cat === "Ambalaj"));
  assert.equal(byCategory.enterPick, undefined);
});

test("Türkçe harf farkı: “cilek surubu” listedeki “Çilek şurubu”dur, ekle çıkmaz ve Enter onu seçer", () => {
  const list = [...seedList, { id: 900, name: "Çilek şurubu", category: "Sos & Şurup", active: true }];
  const r = searchIngredients(groupLikeKit(list), "cilek surubu", null);
  assert.equal(r.exact?.id, 900);
  assert.equal(r.enterPick?.id, 900);
});

test("pasif malzeme: tam adı ekle çıkarmaz ama Enter seçmez; satırda seçiliyse seçer", () => {
  const list = [...seedList, { id: 901, name: "Eski şurup", category: "Sos & Şurup", active: false }];
  const g = groupLikeKit(list);
  const r = searchIngredients(g, "eski şurup", null);
  assert.equal(r.exact?.id, 901);
  assert.equal(r.enterPick, undefined);
  assert.equal(searchIngredients(g, "eski şurup", 901).enterPick?.id, 901);
});
