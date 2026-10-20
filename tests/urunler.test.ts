// Ürün listesi ve reçete kartının saf hesapları: miktar ve fire alanının okunması, kaydedilmemiş değişiklik
// imzası, Excel'in ORTALAMA satırı, sıralama ve kopyalama metinleri.
// Çalıştırma: npx tsx --test tests/urunler.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  compareBy,
  copiedSummary,
  copyDescription,
  fireText,
  listHref,
  menuAverages,
  parseFireInput,
  productHref,
  qtyText,
  recipeSignature,
  resolveQty,
  sameRate,
  STATUS_CHIPS,
  statusChips,
  type SortableRow,
} from "../src/app/panel/urunler/logic";
import { createModel, priceProduct } from "../src/lib/calc/engine";
import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const root = join(__dirname, "..");
const data: ExcelData = JSON.parse(readFileSync(join(root, "src/server/db/seed/excel-data.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(root, "tests/golden.json"), "utf8"));
const model = createModel(excelToDataset(data));
const st = DEFAULT_SETTINGS;

const near = (a: number | null | undefined, b: number, tol = 1e-9, label = "") =>
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${label} beklenen ${b}, bulunan ${a}`);

// ---------------------------------------------------------------- Miktar alanı

test("Miktar: 0 ile başlayan noktalı sayı ondalıktır ('0.125' → 0,125, 125 değil)", () => {
  const r = resolveQty("0.125", st);
  near(r.qty, 0.125);
  assert.equal(r.expr, null);
  assert.equal(r.error, null);
  assert.equal(r.echo, "0,125", "noktalı sayının okunuşu alanın altında görünür");
  near(resolveQty("0.5", st).qty, 0.5);
  near(resolveQty("-0.5", st).qty, -0.5);
  assert.equal(resolveQty("-0.5", st).error, "Miktar negatif olamaz");
});

test("Miktar: virgüllü ondalık ve Türkçe bin ayıracı; belirsiz noktada okunuş gösterilir", () => {
  const comma = resolveQty("0,125", st);
  near(comma.qty, 0.125);
  assert.equal(comma.echo, null, "virgülde belirsizlik yok, yankı gerekmez");
  near(resolveQty("18,5", st).qty, 18.5);
  near(resolveQty("230", st).qty, 230);
  assert.equal(resolveQty("230", st).echo, null);
  // "1.250" Türkçede bin iki yüz elli: okunuşu gruplamasız yazılır ki yanlışsa görülsün
  const thousands = resolveQty("1.250", st);
  near(thousands.qty, 1250);
  assert.equal(thousands.echo, "1250");
  near(resolveQty("1.5", st).qty, 1.5);
  assert.equal(resolveQty("1.5", st).echo, "1,5");
});

test("Miktar: formül '=' ile ya da '=' olmadan; hatalar sessizce 0 olmaz", () => {
  const withEq = resolveQty("=ShotCift", st);
  near(withEq.qty, st.shotCift);
  assert.equal(withEq.expr, "ShotCift", "kayıtta '=' atılır");
  assert.equal(withEq.error, null);
  near(resolveQty("2*ShotTek", st).qty, 2 * st.shotTek);
  assert.equal(resolveQty("= 2 * ShotCift", st).expr, "2 * ShotCift");
  // "=5" formül değil sayıdır
  assert.equal(resolveQty("=5", st).expr, null);
  near(resolveQty("=5", st).qty, 5);
  assert.ok(resolveQty("ShotUcuz", st).error?.includes("Bilinmeyen"));
  assert.ok(resolveQty("%5", st).error, "miktarda yüzde kabul edilmez");
  assert.ok(resolveQty("=", st).error);
  const empty = resolveQty("  ", st);
  assert.deepEqual([empty.qty, empty.expr, empty.error], [0, null, null]);
});

test("Miktar metni kayıttan sonra aynı değere döner (qtyText ↔ resolveQty)", () => {
  for (const q of [0.125, 0.5, 18.5, 230, 1250, 7]) near(resolveQty(qtyText(q, null), st).qty, q, 1e-9, `${q}`);
  assert.equal(qtyText(0.125, null), "0,125");
  assert.equal(qtyText(36, "2*ShotCift"), "2*ShotCift");
});

// ---------------------------------------------------------------- Zayi / fire alanı

test("Fire alanı: 8, %8, 8% ve '% 8' hepsi %8 (Excel G16 'örn. %8')", () => {
  for (const t of ["8", "%8", "8%", "% 8", " 8 "]) {
    const r = parseFireInput(t);
    near(r.rate, 0.08, 1e-12, t);
    assert.equal(r.error, null, t);
    assert.equal(r.warning, null, t);
  }
  near(parseFireInput("7,5").rate, 0.075, 1e-12);
  near(parseFireInput("0").rate, 0, 1e-12);
  assert.equal(parseFireInput("0").warning, null, "%0 bilinçli bir seçim (fire yok)");
});

test("Fire alanı: boş = genel oran, okunamayan metin hata (artık sessizce %0 değil)", () => {
  assert.deepEqual(parseFireInput(""), { rate: null, error: null, warning: null, suggestion: null });
  assert.deepEqual(parseFireInput("   ").rate, null);
  const bad = parseFireInput("abc");
  assert.equal(bad.rate, null);
  assert.ok(bad.error);
  assert.ok(parseFireInput("150").error, "en fazla %100");
  assert.ok(parseFireInput("-5").error, "negatif olmaz");
});

test("Fire alanı: %1'in altı uyarır ve 'mi demek istediniz' önerisi verir; %50 üstü uyarır", () => {
  // Excel alışkanlığı: 0,08 yazıp %8 kastetmek. Panel puan okur (%0,08) ama uyarır ve tek tıkla düzeltir.
  const r = parseFireInput("0,08");
  near(r.rate, 0.0008, 1e-12);
  assert.equal(r.error, null);
  assert.ok(r.warning?.includes("%0,08"), r.warning ?? "");
  assert.equal(r.suggestion, "8");
  near(parseFireInput(r.suggestion!).rate, 0.08, 1e-12);
  assert.equal(parseFireInput("0.075").suggestion, "7,5");
  assert.ok(parseFireInput("60").warning);
  assert.equal(parseFireInput("60").suggestion, null);
});

test("Fire metni ve karşılaştırma: kayıtlı oran alana aynı yazılır, kayan nokta farkı değişiklik sayılmaz", () => {
  assert.equal(fireText(null), "");
  assert.equal(fireText(0.08), "8");
  assert.equal(fireText(0.075), "7,5");
  near(parseFireInput(fireText(0.075)).rate, 0.075, 1e-12);
  assert.ok(sameRate(0.07 + 0.01, 0.08));
  assert.ok(sameRate(null, null));
  assert.ok(!sameRate(null, 0.05));
  assert.ok(!sameRate(0.05, 0.08));
});

test("Fire %8 maliyeti Excel H16 = H15 × G16 gibi değiştirir (Kruvasanlı Hindi Füme Sandviç)", () => {
  const p = model.products.find((x) => x.key === "Kruvasanlı Hindi Füme Sandviç|Tek");
  assert.ok(p);
  // Excel'in kendi değeri (genel fire %5) motorla aynı
  near(p.cost, golden.products[p.key].cost, 1e-6, "genel fire");
  const lines = p.lines.map((l) => ({ qty: l.qty, unitCost: l.unitCost, vatRate: l.vatRate, isPackaging: l.isPackaging }));
  const typed = priceProduct({ price: p.price, fireOverride: parseFireInput("%8").rate }, lines, model.settings);
  const exact = priceProduct({ price: p.price, fireOverride: 0.08 }, lines, model.settings);
  near(typed.cost, exact.cost, 1e-9, "%8 yazımı");
  near(typed.fire, typed.fireBase * 0.08, 1e-9);
  near(Math.round(typed.cost * 100) / 100, 153.06, 1e-9, "denetimdeki değer");
  assert.equal(typed.suggestedPrice, 565);
  // Eski hata: "%8" iki kez 100'e bölünüp %0,08 olurdu (maliyet 141,83 ₺)
  assert.ok(typed.cost - priceProduct({ price: p.price, fireOverride: 0.0008 }, lines, model.settings).cost > 11);
});

// ---------------------------------------------------------------- Kaydedilmemiş değişiklik

test("Kayıttan sonra 'kaydedilmemiş' kalmaz: '=ShotCift', '0.5', sondaki boşluklu not", () => {
  const stored = [
    { ingredientId: 1, qty: 18, expr: "ShotCift", note: null },
    { ingredientId: 2, qty: 0.5, expr: null, note: "sıcak" },
  ];
  const typed = [
    { ingredientId: 1, ...pick(resolveQty("=ShotCift", st)), note: "" },
    { ingredientId: 2, ...pick(resolveQty("0.5", st)), note: "sıcak  " },
  ];
  assert.equal(recipeSignature(typed), recipeSignature(stored));
  // Gerçek değişiklikler yakalanır
  assert.notEqual(recipeSignature([{ ...typed[0] }, { ...typed[1], qty: 0.6 }]), recipeSignature(stored));
  assert.notEqual(recipeSignature([typed[1], typed[0]]), recipeSignature(stored), "sıra değişikliği");
  assert.notEqual(recipeSignature([{ ...typed[0], expr: "2*ShotTek" }, typed[1]]), recipeSignature(stored));
  // Formülde değer değil metin karşılaştırılır: ayar değişince kayıtlı qty eskise de değişiklik sayılmaz
  assert.equal(recipeSignature([{ ...typed[0], qty: 20 }, typed[1]]), recipeSignature(stored));
});

function pick(r: { qty: number; expr: string | null }) {
  return { qty: r.qty, expr: r.expr };
}

// ---------------------------------------------------------------- Liste: ortalamalar ve sıralama

test("Liste alt satırı: ORTALAMA kâr marjı ve maliyet oranı Excel K134 / L134 ile aynı", () => {
  const avg = menuAverages(model.products);
  assert.equal(avg.count, 129);
  near(avg.margin, 0.68755, 1e-5, "K134");
  near(avg.costRatio, 0.28891, 1e-5, "L134");
  // Excel'in kendi hücre değerlerinin ortalamasıyla da aynı
  const g = Object.values(golden.products) as { margin: number; costRatio: number }[];
  near(avg.margin, g.reduce((a, x) => a + x.margin, 0) / g.length, 1e-9, "golden marj");
  near(avg.costRatio, g.reduce((a, x) => a + x.costRatio, 0) / g.length, 1e-9, "golden maliyet oranı");
});

test("Ortalama: reçetesi olmayan ürün katılmaz; liste boşsa değer yok", () => {
  const rows = [
    { status: "İyi" as const, costRatio: 0.2, margin: 0.75 },
    { status: "Düşük kâr" as const, costRatio: 0.5, margin: 0.45 },
    { status: "Reçete yok" as const, costRatio: 0, margin: 0.97 },
  ];
  const avg = menuAverages(rows);
  assert.equal(avg.count, 2);
  near(avg.costRatio, 0.35, 1e-12);
  near(avg.margin, 0.6, 1e-12);
  assert.deepEqual(menuAverages([]), { count: 0, costRatio: null, margin: null });
});

const row = (o: Partial<SortableRow>): SortableRow => ({ name: "A", size: "M", category: "Kahve", status: "İyi", costRatio: 0.2, fireRate: 0.05, ...o });

test("Sıralama: durum (en kötüsü büyük), kategori A → Z (Türkçe), fire", () => {
  const list = [
    row({ name: "a", status: "Dikkat", costRatio: 0.35 }),
    row({ name: "b", status: "Reçete yok", costRatio: 0 }),
    row({ name: "c", status: "İyi", costRatio: 0.1 }),
    row({ name: "d", status: "Düşük kâr", costRatio: 0.6 }),
    row({ name: "e", status: "Dikkat", costRatio: 0.38 }),
  ];
  const desc = [...list].sort((x, y) => -compareBy("status", x, y)).map((r) => r.name);
  assert.deepEqual(desc, ["b", "d", "e", "a", "c"], "en kötüsü önce; aynı durumda maliyet oranı yüksek olan önce");

  const cats = [row({ category: "Soğuk Kahve" }), row({ category: "Çay" }), row({ category: "Atıştırmalık" }), row({ category: "İçecek" })];
  assert.deepEqual(
    [...cats].sort((x, y) => compareBy("category", x, y)).map((r) => r.category),
    ["Atıştırmalık", "Çay", "İçecek", "Soğuk Kahve"],
    "Türkçe alfabe: Ç, C'den sonra; İ, I'dan sonra",
  );

  const fires = [row({ name: "x", fireRate: 0.05 }), row({ name: "y", fireRate: 0.08 }), row({ name: "z", fireRate: 0.05 })];
  assert.deepEqual(
    [...fires].sort((x, y) => -compareBy("fireRate", x, y)).map((r) => r.name),
    ["y", "x", "z"],
    "eşitlikte menü sırası korunur (kararlı)",
  );
  assert.ok(compareBy("name", row({ name: "Latte", size: "L" }), row({ name: "Latte", size: "M" })) < 0);
});

// ---------------------------------------------------------------- Durum çipleri

test("Durum çipleri süzgeçle kaybolmaz: 'Reçete yok' menüde reçetesiz ürün varken (sayısı 0 olsa da) durur", () => {
  const menu = [{ status: "İyi" as const }, { status: "Dikkat" as const }, { status: "Reçete yok" as const }];
  assert.deepEqual(statusChips(menu, []), STATUS_CHIPS);
  // "Large" seçilince reçetesiz ürün süzülse de çip yerinde kalır (pencerede satırlar kaymasın)
  assert.deepEqual(statusChips(menu, ["İyi"]), ["İyi", "Dikkat", "Düşük kâr", "Reçete yok"]);
  const allRecipes = [{ status: "İyi" as const }, { status: "Düşük kâr" as const }];
  assert.deepEqual(statusChips(allRecipes, []), ["İyi", "Dikkat", "Düşük kâr"], "reçetesiz ürün yoksa çip hiç yok");
  assert.deepEqual(statusChips(allRecipes, ["Reçete yok"]), STATUS_CHIPS, "adresten seçiliyse kaldırılabilsin diye görünür");
  assert.deepEqual(statusChips([], []), ["İyi", "Dikkat", "Düşük kâr"]);
});

// ---------------------------------------------------------------- Bağlantılar ve kopyalama metinleri

test("Kart bağlantısı seçili ayı taşır; listeye dönüş süzgeçleri korur", () => {
  assert.equal(productHref(12, "2026-08"), "/panel/urunler/12?ay=2026-08");
  assert.equal(productHref(12, null), "/panel/urunler/12");
  assert.equal(listHref("durum=D%C3%BC%C5%9F%C3%BCk+k%C3%A2r&ay=2026-09", "2026-08"), "/panel/urunler?durum=D%C3%BC%C5%9F%C3%BCk+k%C3%A2r&ay=2026-08");
  assert.equal(listHref(null, "2026-09"), "/panel/urunler?ay=2026-09");
  assert.equal(listHref("", null), "/panel/urunler");
});

test("Kopyalama: fire ve not taşındığı önceden ve sonradan söylenir", () => {
  assert.equal(copyDescription({ fireOverride: null, note: null }), "Reçetesiyle birlikte yeni bir ürün ya da boy oluşturur.");
  assert.equal(
    copyDescription({ fireOverride: 0.08, note: "8oz bardak" }),
    "Reçetesiyle birlikte yeni bir ürün ya da boy oluşturur. Özel fire oranı (%8) ve ürün notu da kopyalanır.",
  );
  assert.equal(copiedSummary({ lines: 4, fireOverride: 0.08, noteCopied: true }), "4 malzeme, özel fire %8 ve not kopyalandı.");
  assert.equal(copiedSummary({ lines: 2, fireOverride: null, noteCopied: false }), "2 malzeme kopyalandı.");
  assert.equal(copiedSummary({ lines: 0, fireOverride: null, noteCopied: true }), "Boş reçete ve not kopyalandı.");
});
