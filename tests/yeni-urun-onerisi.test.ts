// Personelin yeni ürün önerisi (Reçete defteri → Reçete onayları): öneri denetimi (src/lib/recipe-change.ts
// newProductIssue), personelin yazdığı satış fiyatı (readProposedPrice, saklanması, onayda önceden dolu gelmesi), zil
// satırları, Türkçe tamlayan eki ve sunucu kuralları (yetki, ortak ürün açma yardımcısı, boş productId'yi her okuyanın
// karşılaması, personelin maliyet görmemesi, fiyatı yalnız yazması).
// Çalıştırma: npx tsx --test tests/yeni-urun-onerisi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  genitive,
  groupNewProposals,
  newProductIssue,
  pendingSummary,
  productSizeLabel,
  PROPOSED_PRICE_MAX,
  readProposedPrice,
  takenIssue,
} from "../src/lib/recipe-change";

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

test("satış fiyatı: boş bırakılabilir; 0'dan büyük ve en çok 10.000 ₺; Türkçe yazılır, kuruşa yuvarlanır", () => {
  assert.deepEqual(readProposedPrice(""), { value: null, error: null });
  assert.deepEqual(readProposedPrice("185"), { value: 185, error: null });
  assert.deepEqual(readProposedPrice("162,50"), { value: 162.5, error: null });
  assert.deepEqual(readProposedPrice("1.250"), { value: 1250, error: null });
  assert.deepEqual(readProposedPrice(" 99,999 "), { value: 100, error: null });
  assert.equal(readProposedPrice("0").error, "Satış fiyatı 0'dan büyük olmalı");
  assert.equal(readProposedPrice("-10").error, "Satış fiyatı 0'dan büyük olmalı");
  assert.equal(readProposedPrice("yüz").error, "Satış fiyatını sayıyla yazın");
  assert.equal(PROPOSED_PRICE_MAX, 10_000);
  assert.deepEqual(readProposedPrice("10.000"), { value: 10_000, error: null });
  assert.equal(readProposedPrice("10.000,01").error, "Satış fiyatı çok büyük");
  // Öneri denetimi fiyattan bağımsız: değişmedi
  assert.equal(newProductIssue(draft(), products, pending), null);
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
  // Fiyat yoksa gövde not ya da ne yapılacağı (eskisi gibi)
  assert.equal(g[0].body, "Not: müşteriler soruyor");
  assert.equal(g[1].body, "Satış fiyatını yazıp onaylayın");
});

test("zil: personelin önerdiği satış fiyatı boy boy gövdede", () => {
  const [g] = groupNewProposals([
    { id: 1, name: "Çilekli Matcha", size: "L" as const, by: "Ayşe", message: null, price: 205 },
    { id: 2, name: "Çilekli Matcha", size: "M" as const, by: "Ayşe", message: "müşteriler soruyor", price: 185.5 },
  ]);
  assert.equal(g.body, "Önerilen fiyat: Medium 185,50\u00a0₺, Large 205\u00a0₺ · Not: müşteriler soruyor");
  // Yalnız bir boyun fiyatı yazıldıysa o
  const [h] = groupNewProposals([
    { id: 3, name: "Mango Soda", size: "M" as const, by: "Can", message: null, price: null },
    { id: 4, name: "Mango Soda", size: "L" as const, by: "Can", message: null, price: 120 },
  ]);
  assert.equal(h.body, "Önerilen fiyat: Large 120\u00a0₺");
  const bell = read("src/server/actions/notifications.ts");
  assert.match(bell, /price: r\.proposedPrice \}\)\),/);
  assert.match(bell, /body: g\.body,/);
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
  assert.match(products, /getDb\(\)\.transaction\(\(tx\) => insertProduct\(tx, data, \{ copyFromId, changedBy: me\.name \}\)\)/);
  // Ürün tablosuna yazan başka ekleme yok (kopya kod kalmadı)
  assert.doesNotMatch(products, /\.insert\(s\.products\)/);
  assert.doesNotMatch(actions, /\.insert\(s\.products\)/);
  assert.match(body("approveNewProduct"), /insertProduct\(tx, \{ name: data\.name, size, categoryId: data\.categoryId, price: data\.price \}, \{ items, note: req\.after\.note, changedBy: me\.name \}\)/);
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

test("satış fiyatı öneride saklanır (eski önerilerde yok), onayda alan onunla dolu gelir; tahmini malzeme işaretli", () => {
  const propose = body("proposeNewProduct");
  // Sunucu aynı sınırlar: kuruşa yuvarlanır, 0'dan büyük, en çok PROPOSED_PRICE_MAX; yazılmadıysa null
  assert.match(actions, /\.pipe\(z\.number\(\)\.positive\("Satış fiyatı 0'dan büyük olmalı"\)\.max\(PROPOSED_PRICE_MAX, "Satış fiyatı çok büyük"\)\)/);
  assert.match(actions, /items: z\.array\(lineSchema\)\.max\(40, "En fazla 40 malzeme"\), price: zProposedPrice \}/);
  assert.match(propose, /proposed: \{ name: data\.name, size: sz\.size, categoryId: data\.categoryId, price: sz\.price \},/);
  // Şemada yalnız tip (migration yok): eski satırların fiyatı yok, okuyan null'a çevirir
  assert.match(read("src/server/db/schema.ts"), /export type ProposedProduct = \{ name: string; size: "M" \| "L" \| "Tek"; categoryId: number; price\?: number \| null \};/);
  const data = read("src/server/data/recipe-requests.ts");
  assert.match(data, /proposedPrice: typeof proposedPrice === "number" && proposedPrice > 0 \? proposedPrice : null,/);
  // Onay sayfası: fiyat alanı personelin önerisiyle dolu, altında "Personelin önerisi"; onay yine fiyat ister
  const approvals = read("src/app/panel/onaylar/page.tsx");
  assert.match(approvals, /proposedPrice: r\.proposedPrice,/);
  assert.match(approvals, /estimate: !!ing && ing\.isEstimate && !unpriced,/);
  const list = read("src/app/panel/onaylar/review-list.tsx");
  assert.match(list, /const \[price, setPrice\] = useState\(proposed !== null \? priceText\(proposed\) : ""\);/);
  assert.match(list, /Personelin önerisi:\{" "\}/);
  assert.match(list, /\) : l\.estimate \? \(\s+<Badge tone="amber" dot className="ml-1\.5" title="Paket fiyatı tahmini \(faturadan gelmedi\); maliyet kesin değil">\s+Tahmini/);
  assert.match(body("approveNewProduct"), /price: data\.price \}/);
  assert.match(actions, /price: zMoney\.positive\("Satış fiyatını yazın"\)/);
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

test("personel yeni ürün önerisinde maliyet görmez; satış ve paket fiyatını yalnız yazar (geri gösterilmez)", () => {
  const word = (w: string) => new RegExp(`\\b${w.replace("(", "\\(")}`);
  /** Açıklamalar çıkarılmış kod */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const sheetFile = "src/app/panel/receteler/new-product-sheet.tsx";
  const linesFile = "src/app/panel/receteler/recipe-lines.tsx";
  const pickerFile = "src/app/panel/receteler/ingredient-picker.tsx";
  const mineFile = "src/app/panel/receteler/my-requests.tsx";
  const changeFile = "src/app/panel/receteler/change-editor.tsx";
  // Maliyet, hedef oran ve tutar biçimi hiçbirinde yok
  for (const f of [sheetFile, linesFile, pickerFile, mineFile, changeFile]) {
    const src = read(f);
    for (const w of ["unitCost", "cost", "hedefMaliyet", "tl("]) assert.ok(!word(w).test(src), `${f}: ${w}`);
  }
  // Satır düzenleyicisi ve değişiklik penceresi fiyattan hiç söz etmez (eskisi gibi)
  for (const f of [linesFile, changeFile]) for (const w of ["price", "packagePrice"]) assert.ok(!word(w).test(read(f)), `${f}: ${w}`);
  // Sunucudan gelen veride fiyat yok: öneri penceresinin malzeme ve ürün listeleri
  const lines = read(linesFile);
  assert.doesNotMatch(code(lines.slice(lines.indexOf("export interface ProposeKit"), lines.indexOf("export interface LineRow"))), /price|cost/i);
  const sheet = read(sheetFile);
  assert.doesNotMatch(code(sheet.slice(sheet.indexOf("export interface NewProductKit"), sheet.indexOf("const COPY_FROM"))), /price|cost/i);
  // Yeni ürün penceresinde satış fiyatı yalnız girdi: boy başına yazılır, okunup gönderilir, gösterilen tutar yok
  assert.match(sheet, /label="Satış fiyatı \(₺, KDV dahil\)"/);
  assert.match(sheet, /hint="Biliyorsanız yazın; yönetici onaylarken değiştirebilir\."/);
  assert.match(sheet, /price: readProposedPrice\(prices\[b\.size\]\)\.value,/);
  assert.doesNotMatch(sheet, /packagePrice|money\(/);
  // "Yeni malzeme": paket fiyatı yalnız sunucuya gider, pencere tutar göstermez
  assert.doesNotMatch(read(pickerFile), /money\(|unitPrice/);
  // Önerilerim: yalnız bekleyen yeni ürün önerisinde kişinin kendi yazdığı satış fiyatı (menü fiyatı, maliyet değil)
  const mine = read(mineFile);
  assert.match(mine, /\{isNew && r\.status === "pending" && r\.proposedPrice !== null \? <span className="tabular">· Önerdiğiniz fiyat \{money\(r\.proposedPrice\)\}<\/span> : null\}/);
  assert.equal([...mine.matchAll(/money\(/g)].length, 1, "tek tutar: kişinin önerdiği fiyat");
  assert.doesNotMatch(mine, /packagePrice/);
  assert.match(read("src/app/panel/receteler/page.tsx"), /proposedPrice: r\.status === "pending" \? r\.proposedPrice : null,/);
  // Yeni ürünün maliyet ve marjı yalnız yöneticinin onay sayfasında
  assert.match(read("src/app/panel/onaylar/page.tsx"), /await requireAdmin\(\);/);
  // Personelin "Önerilerim"deki reçete listesi maliyetsiz
  const diff = read("src/components/panel/recipe-diff.tsx");
  const list = diff.slice(diff.indexOf("export function RecipeList"));
  assert.doesNotMatch(list, /cost|tl\(/);
});
