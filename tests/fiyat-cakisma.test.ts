// Açık kalmış kartın fiyatı başkasının değişikliğini ezmesin (denetim E-11, docs/planlar/senkron.md › P1.4): kart ve
// fiyat hücresi gördükleri fiyatı da gönderir; dokunulmayan fiyat veritabanındaki güncel değerde kalır, dokunulan fiyat
// bu arada başka yerde de değiştiyse yazılmaz. Saf kural ve istemcinin kaynak kuralları; veritabanı ve sahte siteyle
// uçtan uca: tests/tukendi-db.test.ts › "Reçete kartı ve fiyat hücresi".
// Çalıştırma: npx tsx --test tests/fiyat-cakisma.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { priceChangedText, priceMovedText, seenPriceDecision } from "../src/lib/prices/seen";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("görülen fiyat: dokunulmayan fiyat güncel değerde kalır; dokunulan yazılır; ikisi de değiştiyse çakışma", () => {
  // Eski istemci görüleni göndermez: gönderilen yazılır (bugünkü davranış)
  assert.deepEqual(seenPriceDecision(180, undefined, 190), { kind: "write", price: 180 });
  assert.deepEqual(seenPriceDecision(180, null, 190), { kind: "write", price: 180 });
  // Dokunulmadı, kimse değiştirmedi
  assert.deepEqual(seenPriceDecision(180, 180, 180), { kind: "keep", price: 180, moved: false });
  // Dokunulmadı, sitede 190 oldu (ping panele çekti): 190 kalır, eski 180 geri yazılmaz
  assert.deepEqual(seenPriceDecision(180, 180, 190), { kind: "keep", price: 190, moved: true });
  // Kuruşla: 180,004 ile 180 aynı fiyat
  assert.deepEqual(seenPriceDecision(180.004, 180, 180), { kind: "keep", price: 180, moved: false });
  // Dokunuldu, veritabanı aynı: yeni fiyat
  assert.deepEqual(seenPriceDecision(200, 180, 180), { kind: "write", price: 200 });
  // Dokunuldu, veritabanı da aynı yeni fiyata değişti: yazılacak bir şey yok
  assert.deepEqual(seenPriceDecision(190, 180, 190), { kind: "keep", price: 190, moved: false });
  // Dokunuldu ve veritabanı başka bir fiyata değişti: hangisinin kalacağını kullanıcı seçer
  assert.deepEqual(seenPriceDecision(200, 180, 190), { kind: "conflict", current: 190, seen: 180 });
});

test("çakışma metinleri: güncel ve görülen fiyat, ne yapılacağı", () => {
  assert.equal(
    priceMovedText(190, 180),
    "Fiyat bu arada başka bir yerde değişti: şimdi 190 ₺ (kart açıldığında 180 ₺); değişiklikler kaydedilmedi. Fiyat alanının altından hangisinin kalacağını seçip yeniden kaydet.",
  );
  // Liste ve toplu Fiyatlar aynı kalıbı kullanır
  assert.equal(priceChangedText(210), "Fiyat bu sırada değişti (şimdi 210 ₺); listeyi yenileyip tekrar dene");
  assert.equal(priceChangedText(185.5), "Fiyat bu sırada değişti (şimdi 185,50 ₺); listeyi yenileyip tekrar dene");
});

test("eylemler: saveRecipe görüleni kullanır, dokunulmayan satış alanını yazmaz; tek fiyat writeSalePrice'ta koşullu", () => {
  const products = read("src/server/actions/products.ts");
  const save = products.slice(products.indexOf("export async function saveRecipe"), products.indexOf("export async function deleteProduct"));
  assert.match(products, /seenPrice: zMoney\.min\(0\)\.optional\(\),/);
  assert.match(save, /const price = seenPriceDecision\(data\.price, data\.seenPrice, before\.price\);/);
  // Çakışma siteye gitmeden: hiçbir şey yazılmaz, sayfa yenilenir
  assert.ok(save.indexOf('price.kind === "conflict"') < save.indexOf("pushSaleChange("), "çakışma siteden önce");
  assert.match(save, /refresh\(\);\s+throw new UserError\(priceMovedText\(price\.current, price\.seen\)\);/);
  // Yerelde yalnız dokunulan satış alanları; dokunulan fiyat koşullu
  assert.match(save, /\.\.\.\(touched\.price \? \{ price: desired\.price \} : \{\}\)/);
  assert.match(save, /\.\.\.\(touched\.active \? \{ active: desired\.active \} : \{\}\)/);
  assert.match(save, /\.\.\.\(touched\.showOnMenu \? \{ showOnMenu: desired\.showOnMenu \} : \{\}\)/);
  assert.match(save, /!pushed && touched\.price \? sql`abs\(\$\{s\.products\.price\} - \$\{before\.price\}\) < 0\.005` : undefined/);
  // Dokunulmayan fiyat yerelde yazılmadı: geçmişe kayıt düşmez
  assert.match(save, /pushed \|\| touched\.price\s+\? await recordPriceChange\(/);
  // Tek fiyat: görülen fiyat writeSalePrice'ın expectFrom'u
  const price = products.slice(products.indexOf("export async function updateProductPrice"), products.indexOf("async function updatePriceAck"));
  assert.match(price, /seenPrice\?: number \| null\) \{/);
  assert.match(price, /expectFrom: seen \}/);
  assert.match(price, /if \(e instanceof PriceChangedError \|\| isStaleFailure\(e\)\) refresh\(\);/);
});

test("reçete kartı: gördüğü satış alanlarını gönderir, sayfa yenilenince dokunulmayanlar güncellenir, çakışmada seçim", () => {
  const editor = read("src/app/panel/urunler/[id]/recipe-editor.tsx");
  assert.match(editor, /seenPrice: seen\.price,\s+seenActive: seen\.active,\s+seenShowOnMenu: seen\.showOnMenu,/);
  // Sayfa yenilenince (kayıt, ay, site bağlantısı): dokunulmamış alan yenisini alır, dokunulmuş alan görüleni korur
  assert.match(editor, /if \(!sameSale\(server, lastServer\)\) \{/);
  assert.match(editor, /if \(keep\.price\) setPrice\(priceText\(server\.price\)\);/);
  assert.match(editor, /price: keep\.price \? server\.price : seen\.price,/);
  // "Kaydedilmemiş" görülen değerlere göre
  assert.match(editor, /Math\.abs\(priceNum - seen\.price\) > 0\.001/);
  assert.match(editor, /active !== seen\.active \|\|/);
  // Kayıttan sonra görülen sitenin / sunucunun yazdığı
  assert.match(editor, /setSeen\(\{ price: saved\.price, active: saved\.active, showOnMenu: saved\.showOnMenu \}\);/);
  // Çakışma: fiyat alanının altında iki seçenek
  assert.match(editor, /const priceMoved = toMinor\(product\.price\) !== toMinor\(seen\.price\) && toMinor\(priceNum\) !== toMinor\(product\.price\);/);
  assert.match(editor, /\{money\(product\.price\)\} kalsın/);
  assert.match(editor, /\{money\(priceNum\)\} yazılsın/);
  // Eylem atarsa düğme kilitli kalmaz (denetim E-51'in bu dosyadaki kısmı)
  assert.match(editor, /\} catch \(e\) \{\s+\/\/ [^\n]*\n\s+toastUnreachable\(e, "recete-kaydet"\);\s+return;\s+\} finally \{\s+setSaving\(false\);/);
  assert.match(editor, /\} catch \(e\) \{\s+toastUnreachable\(e, "recete-sil"\);\s+return;\s+\} finally \{\s+setDeleting\(false\);/);
});

test("fiyat hücresi ve zam önerisi gördükleri fiyatı gönderir; hücre yeni fiyatı alır, eylem atarsa kilitli kalmaz", () => {
  const table = read("src/app/panel/urunler/products-table.tsx");
  assert.match(table, /res = await updateProductPrice\(row\.id, v, false, "manual", last\);/);
  assert.match(table, /if \(!saving && typed !== null && toMinor\(typed\) === toMinor\(last\)\) \{\s+setLast\(row\.price\);/);
  assert.match(table, /toastUnreachable\(e, `fiyat-\$\{row\.id\}`\);/);
  const impact = read("src/app/panel/urunler/price-impact-panel.tsx");
  assert.match(impact, /"suggestion", i\.price\)/);
  assert.match(impact, /\.catch\(\(e: unknown\) => toastUnreachable\(e\)\)/);
});
