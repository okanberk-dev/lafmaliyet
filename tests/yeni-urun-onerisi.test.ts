// Personelin yeni ürün önerisi (Reçete defteri → Reçete onayları): öneri denetimi (src/lib/recipe-change.ts
// newProductIssue), zil satırları, Türkçe tamlayan eki ve sunucu kuralları (yetki, ortak ürün açma yardımcısı, boş
// productId'yi her okuyanın karşılaması, personelin fiyat görmemesi).
// Çalıştırma: npx tsx --test tests/yeni-urun-onerisi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { genitive, groupNewProposals, newProductIssue, pendingSummary, productSizeLabel, takenIssue } from "../src/lib/recipe-change";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const products = [
  { name: "Çilekli Latte", size: "M" },
  { name: "Latte", size: "L" },
];
const pending = [{ name: "Mango Frozen", size: "Tek" }];
const draft = (over: Partial<Parameters<typeof newProductIssue>[0]> = {}) => ({
  name: "Böğürtlenli Soda",
  categoryId: 3,
  sizes: [{ size: "M" as const, lines: 2 }],
  ...over,
});

test("öneri denetimi: ad, kategori, boy, her boyda malzeme", () => {
  assert.equal(newProductIssue(draft(), products, pending), null);
  assert.equal(newProductIssue(draft({ name: "   " }), products, pending), "Ürün adını yazın");
  assert.equal(newProductIssue(draft({ name: " Ç " }), products, pending), "Ürün adı en az 2 harf olmalı");
  assert.equal(newProductIssue(draft({ name: "x".repeat(121) }), products, pending), "Ürün adı çok uzun");
  assert.equal(newProductIssue(draft({ categoryId: null }), products, pending), "Kategori seçin");
  assert.equal(newProductIssue(draft({ sizes: [] }), products, pending), "En az bir boy seçin");
  assert.equal(
    newProductIssue(draft({ sizes: [{ size: "M", lines: 1 }, { size: "L", lines: 0 }] }), products, pending),
    "Large için en az bir malzeme ekleyin",
  );
});

test("aynı ad + boy: ürün varsa ya da bekleyen öneri varsa (Türkçe büyük/küçük harf ve boşluk farkı gözetmeden)", () => {
  assert.equal(newProductIssue(draft({ name: "ÇİLEKLİ  LATTE" }), products, pending), "“ÇİLEKLİ LATTE · Medium” zaten var");
  // Aynı ad başka boyda serbest
  assert.equal(newProductIssue(draft({ name: "çilekli latte", sizes: [{ size: "L", lines: 1 }] }), products, pending), null);
  assert.equal(newProductIssue(draft({ name: "mango frozen", sizes: [{ size: "Tek", lines: 1 }] }), products, pending), "“mango frozen · Tek boy” için bekleyen bir öneri var");
  assert.equal(takenIssue("LATTE", "L", products, []), "“LATTE · Large” zaten var");
  assert.equal(takenIssue("", "L", products, []), null);
  assert.equal(productSizeLabel("Çilekli Latte", "M"), "Çilekli Latte · Medium");
});

test("zil: bekleyen yeni ürün önerileri ad ve öneren başına tek satır, boylar sırayla", () => {
  const rows = [
    { id: 7, name: "Çilekli Latte", size: "L" as const, by: "Ayşe", message: null },
    { id: 6, name: "Çilekli Latte", size: "M" as const, by: "Ayşe", message: "müşteriler soruyor" },
    { id: 9, name: "çilekli latte", size: "M" as const, by: "Mehmet", message: null },
  ];
  const g = groupNewProposals(rows);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].ids, [7, 6]);
  assert.deepEqual(g[0].sizes, ["M", "L"]);
  assert.equal(g[0].title, "Yeni ürün önerisi: Çilekli Latte · Medium, Large (Ayşe)");
  assert.equal(g[0].message, "müşteriler soruyor");
  assert.equal(g[1].title, "Yeni ürün önerisi: çilekli latte · Medium (Mehmet)");
});

test("reçete defteri şeridi ve işlem geçmişindeki tamlayan eki", () => {
  assert.equal(pendingSummary(2, 0), "2 reçete değişikliği onay bekliyor");
  assert.equal(pendingSummary(0, 1), "1 yeni ürün önerisi onay bekliyor");
  assert.equal(pendingSummary(2, 1), "2 reçete değişikliği ve 1 yeni ürün önerisi onay bekliyor");
  assert.equal(pendingSummary(0, 0), "");
  assert.equal(genitive("Ayşe"), "Ayşe'nin");
  assert.equal(genitive("Mehmet"), "Mehmet'in");
  assert.equal(genitive("Can"), "Can'ın");
  assert.equal(genitive("Oğuz"), "Oğuz'un");
  assert.equal(genitive("Gül"), "Gül'ün");
  assert.equal(genitive("Ali"), "Ali'nin");
  assert.equal(genitive("Burcu"), "Burcu'nun");
  assert.equal(genitive("Ayşe Yılmaz"), "Ayşe Yılmaz'ın");
  assert.equal(genitive("IRMAK"), "IRMAK'ın");
});

// ---------------------------------------------------------------- Sunucu kuralları (kaynaktan)

const actions = read("src/server/actions/recipe-requests.ts");
const body = (name: string) => {
  const start = actions.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, name);
  const next = actions.indexOf("export async function", start + 10);
  return actions.slice(start, next < 0 ? undefined : next);
};

test("yetki: personel önerir; yönetici fiyatıyla onaylar; Yeni ürün yalnız yöneticinin", () => {
  assert.match(body("proposeNewProduct"), /const me = await requireUser\(\);/);
  assert.match(body("approveNewProduct"), /const me = await requireAdmin\(\);/);
  assert.match(body("reviewRecipeChange"), /const me = await requireAdmin\(\);/);
  const products = read("src/server/actions/products.ts");
  const create = products.slice(products.indexOf("export async function createProduct"), products.indexOf("const recipeSchema"));
  assert.match(create, /const me = await requireAdmin\(\);/);
  // Personelin sayfası createProduct'ı hiç çağırmaz (yalnız öneri eylemi)
  for (const f of ["src/app/panel/receteler/new-product-sheet.tsx", "src/app/panel/receteler/recipe-book.tsx", "src/app/panel/receteler/page.tsx"]) {
    assert.doesNotMatch(read(f), /createProduct|approveNewProduct/, f);
  }
  assert.match(read("src/app/panel/receteler/new-product-sheet.tsx"), /proposeNewProduct\(/);
});

test("ürün açma kuralı tek yerde: Yeni ürün ve öneri onayı aynı yardımcıyı çağırır (server-only, sunucu eylemi değil)", () => {
  const helper = read("src/server/data/product-create.ts");
  assert.match(helper, /^import "server-only";/);
  assert.doesNotMatch(helper, /"use server"/);
  assert.match(helper, /categoryFireDefault\(peers\)/);
  assert.match(helper, /sortOrder: \(m \?\? 0\) \+ 1/);
  const products = read("src/server/actions/products.ts");
  assert.match(products, /getDb\(\)\.transaction\(\(tx\) => insertProduct\(tx, data, \{ copyFromId \}\)\)/);
  // Ürün tablosuna yazan başka ekleme yok (kopya kod kalmadı)
  assert.doesNotMatch(products, /\.insert\(s\.products\)/);
  assert.doesNotMatch(actions, /\.insert\(s\.products\)/);
  assert.match(body("approveNewProduct"), /insertProduct\(tx, \{ name: data\.name, size, categoryId: data\.categoryId, price: data\.price \}, \{ items, note: req\.after\.note \}\)/);
});

test("öneri ve onay: kilit, durum ve aynı ad + boy yeniden denetlenir; formüller sunucuda; red ürünü açmaz", () => {
  const propose = body("proposeNewProduct");
  assert.match(propose, /await lockNewProducts\(tx\);/);
  assert.match(propose, /newProductIssue\(/);
  assert.match(propose, /evaluateExpression\(line\.qtyExpr, settings\)/);
  assert.match(propose, /kind: "new",\s+productId: null,/);
  assert.match(propose, /before: EMPTY_SNAPSHOT,/);
  const approve = body("approveNewProduct");
  assert.match(approve, /await lockNewProducts\(tx\);/);
  assert.match(approve, /\.for\("update"\)/);
  assert.match(approve, /if \(req\.status !== "pending"\)/);
  assert.match(approve, /nameKey\(p\.name\) === nameKey\(data\.name\)/);
  assert.match(approve, /\.set\(\{ productId: created\.id, status: "approved",/);
  // Fiyatsız onay yok: fiyatı 0 bir ürün kârlılığı ve uyarıları bozardı
  assert.match(actions, /price: zMoney\.positive\("Satış fiyatını yazın"\)/);
  const review = body("reviewRecipeChange");
  // Yeni ürün önerisi burada yalnız reddedilir; değişiklik onayı eskisi gibi (testler: recete-onay.test.ts)
  assert.match(review, /if \(req\.kind === "new"\) \{/);
  assert.match(review, /if \(data\.decision !== "reject" \|\| !req\.proposed\) throw new UserError/);
  assert.ok(review.indexOf('req.kind === "new"') < review.indexOf("tx.select({ id: s.products.id"), "ürün okunmadan önce ayrılır");
});

test("productId boş olabilir: okuyan her yer yeni ürün önerisini karşılar", () => {
  const data = read("src/server/data/recipe-requests.ts");
  assert.match(data, /\.leftJoin\(s\.products, eq\(s\.products\.id, s\.recipeChangeRequests\.productId\)\)/);
  assert.doesNotMatch(data, /innerJoin/);
  assert.match(data, /productName: currentName \?\? r\.proposed\?\.name/);
  assert.match(data, /eq\(s\.recipeChangeRequests\.kind, "change"\), isNotNull\(s\.recipeChangeRequests\.productId\)/);
  const bell = read("src/server/actions/notifications.ts");
  assert.match(bell, /pending\.filter\(\(r\) => r\.kind === "change"\)/);
  assert.match(bell, /groupNewProposals\(/);
  assert.match(bell, /if \(r\.kind === "new"\)/);
  const book = read("src/app/panel/receteler/page.tsx");
  assert.match(book, /r\.kind === "change" && r\.productId !== null/);
  const review = read("src/app/panel/onaylar/page.tsx");
  assert.match(review, /if \(r\.kind === "new" \|\| r\.productId === null\)/);
  const mine = read("src/app/panel/receteler/my-requests.tsx");
  assert.match(mine, /productId: number \| null;/);
  assert.match(mine, /isNew \? <RecipeList/);
  // Şema: tür ve önerilen ürün; bekleyen benzersiz dizini boş productId'yi kapsamaz, kural eylemde
  const schema = read("src/server/db/schema.ts");
  assert.match(schema, /kind: text\("kind", \{ enum: \["change", "new"\] \}\)\.notNull\(\)\.default\("change"\)/);
  assert.match(schema, /recipe_change_requests_kind_ck/);
});

test("personel yeni ürün önerisinde de fiyat ve maliyet görmez", () => {
  for (const f of [
    "src/app/panel/receteler/new-product-sheet.tsx",
    "src/app/panel/receteler/recipe-lines.tsx",
    "src/app/panel/receteler/my-requests.tsx",
    "src/app/panel/receteler/change-editor.tsx",
  ]) {
    const src = read(f);
    for (const word of ["unitCost", "price", "cost", "packagePrice", "hedefMaliyet", "tl("]) {
      assert.ok(!new RegExp(`\\b${word.replace("(", "\\(")}`).test(src), `${f}: ${word}`);
    }
  }
  // Yeni ürünün maliyet ve marjı yalnız yöneticinin onay sayfasında
  assert.match(read("src/app/panel/onaylar/page.tsx"), /await requireAdmin\(\);/);
  // Personelin "Önerilerim"deki reçete listesi maliyetsiz
  const diff = read("src/components/panel/recipe-diff.tsx");
  const list = diff.slice(diff.indexOf("export function RecipeList"));
  assert.doesNotMatch(list, /cost|tl\(/);
});
