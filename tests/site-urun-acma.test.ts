// "Yalnız sitede" kalemden panel ürünü açma ve Yeni ürün penceresinin adresle açılması (denetim 26 Eki 2026 B14,
// E-48): pencerenin ön dolumu (ad, kategori tahmini, boylar ve sitenin fiyatları), aynı ad + boy denetimi; sunucu
// eyleminin, bağlama çekirdeğinin ve ekranların kuralları kaynaktan. Veritabanı ve sahte siteyle: site-urun-acma-db.test.ts.
// Çalıştırma: npx tsx --test tests/site-urun-acma.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { siteGaps } from "../src/lib/site-menu/names";
import { CATEGORY_SOURCE_TEXT, newFromSiteDraft, newFromSiteTaken, rowSize, type DraftProduct } from "../src/lib/site-menu/new-product";
import type { SiteMenuItem } from "../src/lib/site-menu/schema";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const item = (id: string, name: string, over: Partial<SiteMenuItem> = {}): SiteMenuItem => ({
  id,
  name,
  categoryKey: "sicak",
  categoryLabel: "Sıcak kahveler",
  priceMinor: 18_500,
  priceMinorL: 20_500,
  isActive: true,
  sortOrder: 1,
  updatedAt: "2026-10-20T08:00:00.000Z",
  ...over,
});
const categories = [
  { id: 1, name: "Espresso bazlı" },
  { id: 2, name: "Soğuk kahveler" },
  { id: 3, name: "Tatlılar" },
];
const product = (name: string, size: string, categoryId: number, link: DraftProduct["link"] = null): DraftProduct => ({ name, size, categoryId, link });

test("ön dolum: iki boylu kalem iki boy (M → Medium, L → Large) ve sitenin fiyatları; ad sitedeki ad", () => {
  const items = [item("mnu-0100", " Matcha  Latte "), item("mnu-0007", "Latte")];
  const products = [product("Latte", "M", 1, { siteMenuId: "mnu-0007", slot: "M" }), product("Latte", "L", 1, { siteMenuId: "mnu-0007", slot: "L" })];
  const [gap] = siteGaps(items, [
    { siteMenuId: "mnu-0007", slot: "M" },
    { siteMenuId: "mnu-0007", slot: "L" },
  ]);
  assert.equal(gap.item.id, "mnu-0100");
  const d = newFromSiteDraft(gap, items, products, categories);
  assert.equal(d.name, "Matcha Latte");
  assert.deepEqual(d.rows, [
    { slot: "M", size: "M", priceMinor: 18_500 },
    { slot: "L", size: "L", priceMinor: 20_500 },
  ]);
  assert.equal(d.pair, null);
  // Sitede aynı kategorideki Latte panelde "Espresso bazlı"da
  assert.equal(d.categoryId, 1);
  assert.equal(d.categorySource, "site-category");
  assert.equal(CATEGORY_SOURCE_TEXT[d.categorySource!], "sitede aynı kategorideki ürünlerin çoğu burada");
});

test("ön dolum: tek boylu kalem tek satır, M yuvası ve panelde Tek boy", () => {
  const cake = item("mnu-0200", "San Sebastian", { categoryKey: "tatli", categoryLabel: "Tatlılar", priceMinor: 22_000, priceMinorL: 0 });
  assert.equal(rowSize(cake, "M"), "Tek");
  assert.equal(rowSize(item("x", "y"), "L"), "L");
  const d = newFromSiteDraft({ item: cake, slots: ["M"] }, [cake], [], categories);
  assert.deepEqual(d.rows, [{ slot: "M", size: "Tek", priceMinor: 22_000 }]);
  // Bağlı ürün yok: kategori adı sitedekiyle aynı
  assert.equal(d.categoryId, 3);
  assert.equal(d.categorySource, "name");
});

test("ön dolum: öteki boy panelde bağlıysa ad ve kategori ondan, yalnız boş fiyat açılır", () => {
  const items = [item("mnu-0100", "Matcha Latte")];
  const products = [product("Matcha Latte (Excel)", "M", 2, { siteMenuId: "mnu-0100", slot: "M" })];
  const [gap] = siteGaps(items, [{ siteMenuId: "mnu-0100", slot: "M" }]);
  const d = newFromSiteDraft(gap, items, products, categories);
  assert.equal(d.name, "Matcha Latte (Excel)");
  assert.deepEqual(d.pair, { name: "Matcha Latte (Excel)", size: "M" });
  assert.equal(d.categoryId, 2);
  assert.equal(d.categorySource, "pair");
  assert.deepEqual(d.rows, [{ slot: "L", size: "L", priceMinor: 20_500 }]);
});

test("kategori tahmini: oy çokluğu, eşitlikte panelin sırası; tahmin yoksa boş (yönetici seçer)", () => {
  const items = [item("mnu-0100", "Yeni"), item("mnu-0001", "A"), item("mnu-0002", "B"), item("mnu-0003", "C")];
  const votes = [
    product("A", "M", 2, { siteMenuId: "mnu-0001", slot: "M" }),
    product("B", "M", 1, { siteMenuId: "mnu-0002", slot: "M" }),
    product("C", "M", 2, { siteMenuId: "mnu-0003", slot: "M" }),
    // Bağlı olmayan ürün oy vermez
    product("D", "M", 3),
  ];
  const gap = { item: items[0], slots: ["M", "L"] as ("M" | "L")[] };
  assert.equal(newFromSiteDraft(gap, items, votes, categories).categoryId, 2);
  // Eşitlikte panelin kategori sırası (1 önce)
  assert.equal(newFromSiteDraft(gap, items, votes.slice(0, 2), categories).categoryId, 1);
  // Başka site kategorisindeki kalemlerin ürünleri sayılmaz; ad da tutmuyor
  const other = items.map((i) => (i.id === "mnu-0100" ? { ...i, categoryKey: "yeni", categoryLabel: "Mevsim" } : i));
  const none = newFromSiteDraft({ item: other[0], slots: ["M"] }, other, votes, categories);
  assert.equal(none.categoryId, null);
  assert.equal(none.categorySource, null);
  // Silinmiş kategoriye bağlı oy sayılmaz
  assert.equal(newFromSiteDraft(gap, items, [product("A", "M", 99, { siteMenuId: "mnu-0001", slot: "M" })], categories).categoryId, null);
});

test("aynı ad + boy: panelde varsa açılmaz (büyük/küçük harf ve boşluk farkı gözetmeden), yalnız seçilen boylarda", () => {
  const products = [
    { name: "Matcha Latte", size: "M" },
    { name: "Mango Soda", size: "Tek" },
  ];
  assert.equal(
    newFromSiteTaken("MATCHA  latte", ["M", "L"], products),
    "“Matcha Latte · M” panelde zaten var: yenisini açmak yerine onu bağlayın (Öneriler ya da Panelde bağlı değil sekmesi)",
  );
  assert.equal(newFromSiteTaken("Matcha Latte", ["L"], products), null);
  assert.equal(newFromSiteTaken("  ", ["M"], products), null);
});

// ---------------------------------------------------------------- Sunucu ve ekran kuralları (kaynaktan)

test("eylem: yalnız yönetici; ad, kategori ve boylar doğrulanır; çekirdek link.ts'te", () => {
  const actions = read("src/server/actions/site-menu.ts");
  const fn = actions.slice(actions.indexOf("export async function createProductsFromSite"), actions.indexOf("/** Bağlantıyı kaldırır"));
  assert.match(fn, /const me = await requireAdmin\(\);\s+const data = zNewFromSite\.parse\(input\);\s+const r = await createLinkedProducts\(me, data\);\s+refresh\(\);/);
  assert.match(actions, /\.refine\(\(rows\) => new Set\(rows\.map\(\(r\) => r\.slot\)\)\.size === rows\.length, "Aynı fiyat iki kez seçildi"\)/);
  assert.match(actions, /\.refine\(\(rows\) => new Set\(rows\.map\(\(r\) => r\.size\)\)\.size === rows\.length, "İki fiyata aynı boy seçildi"\)/);
  // "use server" dosyasının şeması dışa açılmaz (her dışa açık şey bir uç olur)
  assert.doesNotMatch(actions, /export const zNewFromSite/);
});

test("çekirdek: ürünler menü kilidi altında, sitenin fiyatıyla açılır ve aynı işlemde bağlanır; bağlanamazsa hiçbiri açılmaz", () => {
  const link = read("src/server/site-menu/link.ts");
  const create = link.slice(link.indexOf("export async function createLinkedProducts"));
  // Site önce okunur (fiyat ve yuva sitenin), sonra tek işlem: kilit, kategori, aynı ad, ürünler, bağlama
  assert.ok(create.indexOf('fetchListOrFail("ürün açılmadı")') < create.indexOf("getDb().transaction("));
  const tx = create.slice(create.indexOf("getDb().transaction("));
  const order = ["await lockMenu(tx);", "newFromSiteTaken(", "insertProduct(tx, { name, size: r.size, categoryId: input.categoryId, price: r.price }", "linkUnderLock(", "if (linked.skipped.length || !linked.applied) throw new UserError("];
  for (let i = 1; i < order.length; i++) assert.ok(tx.indexOf(order[i - 1]) >= 0 && tx.indexOf(order[i - 1]) < tx.indexOf(order[i]), `${order[i - 1]} → ${order[i]}`);
  assert.match(create, /return \{ \.\.\.r, price: fromMinor\(minor\) \};/);
  // Bağlama da aynı çekirdek: liste uygulanır, ürünsüz LafPOS satırları bağlanır
  const linkProducts = link.slice(link.indexOf("export async function linkProducts"), link.indexOf("export interface NewFromSiteInput"));
  assert.match(linkProducts, /await lockMenu\(tx\);\s+return linkUnderLock\(tx, list, requests, at\);/);
  const core = link.slice(link.indexOf("async function linkUnderLock"), link.indexOf("async function logLinked"));
  assert.match(core, /const applied = await applySiteList\(tx, list, at\);/);
  assert.match(core, /await rematchPosSalesBySite\(/);
  // İşlem geçmişi
  assert.match(create, /"Yeni ürün \(siteden\)"/);
});

test("ekranlar: Yalnız sitede satırında Panelde aç ve bağla; ?yeni=1 Yeni ürün penceresini açar; Reçete defteri oraya", () => {
  const matching = read("src/app/panel/urunler/site/site-menu-matching.tsx");
  assert.match(matching, /<Plus size=\{13\} aria-hidden="true" \/> Panelde aç ve bağla/);
  assert.match(matching, /disabled=\{!configured\}/);
  assert.doesNotMatch(matching, /Bağlantı ürün açmaz: panelde yoksa Ürünler › Yeni ürün ile açıp bağlayın/);
  const page = read("src/app/panel/urunler/site/page.tsx");
  assert.match(page, /const drafts = gaps\.map\(\(g\) => newFromSiteDraft\(g, items, products, categories\)\);/);
  const dialog = read("src/app/panel/urunler/site/site-new-product.tsx");
  assert.match(dialog, /createProductsFromSite\(\{ siteMenuId: item\.id, name: clean, categoryId, rows: chosen\.map\(\(r\) => \(\{ slot: r\.slot, size: r\.size \}\)\) \}\)/);
  assert.match(dialog, /router\.push\(productHref\(created\[0\]\.productId\)\);/);
  // Fiyat pencerede yazılmaz (sitenindir): fiyat alanı yok
  assert.doesNotMatch(dialog, /NumberInput|price:/);
  // İstek sürerken pencere kapanmaz (inceleme B14-D2): Vazgeç, Esc ve arka plan aynı korumadan geçer
  assert.match(dialog, /const close = \(\) => \{\s+if \(!busy\) onClose\(\);\s+\};/);
  assert.match(dialog, /<Dialog\s+open\s+onClose=\{close\}/);
  assert.match(dialog, /<Button variant="ghost" onClick=\{close\} disabled=\{busy\}>/);
  assert.equal(dialog.split("onClose()").length - 1, 2, "onClose yalnız korumada ve başarıdan sonra");
  // Dolu ad telefonda klavyeyi açmaz (inceleme B14-U3): yalnız masaüstünde odak
  assert.doesNotMatch(dialog, /data-autofocus="always"/);
  assert.match(dialog, /id="snp-name"[\s\S]*?data-autofocus\n/);
  const button = read("src/app/panel/urunler/new-product.tsx");
  assert.match(button, /const \[yeni, setYeni\] = useQueryState<string>\("yeni", ""\);/);
  assert.match(button, /const shown = open \|\| yeni === "1";/);
  assert.match(button, /if \(yeni\) setYeni\(""\);/);
  // Reçete defterinin "Yeni ürün"ü seçili kategori çipini taşır (inceleme B14-U4)
  assert.match(read("src/app/panel/receteler/page.tsx"), /const action = isAdmin \? \(\s+<NewProductLink \/>/);
  const bookLink = read("src/app/panel/receteler/new-product-link.tsx");
  assert.match(bookLink, /const \[cat\] = useQueryState<string>\("kategori", ""\);/);
  assert.match(bookLink, /const href = `\/panel\/urunler\?yeni=1\$\{\/\^\\d\+\$\/\.test\(cat\) \? `&kategori=\$\{cat\}` : ""\}`;/);
  assert.match(read("src/app/panel/satislar/product-picker.tsx"), /href="\/panel\/urunler\?yeni=1"/);
});
