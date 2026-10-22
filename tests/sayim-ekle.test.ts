// Stok sayımı › "Listeye ekle" (src/lib/count-item.ts, src/app/panel/sayim/actions.ts addCountItem) ve sekiz yeni kalemin
// migration'ı (drizzle/*_sayim_yeni_kalemler.sql): Türkçe ad anahtarı ve aynı ad kuralı, sayım biriminden malzeme
// birimi, grubun varsayılanları, kalemin listeye girdiği ay (count_from), fiyatı 0 kalemin ilk fiyatının zam
// sayılmaması, personelin fiyat görmemesi, CSV'de formül gibi başlayan adın kabul edilmemesi.
// Migration'ın veritabanı denemesi EKLE_TEST_DATABASE_URL verilince çalışır (işlem geri alınır; migrate edilmiş bir
// yerel kopya verin, ör. postgres://postgres:postgres@localhost:5432/laffogato_ekle).
// Çalıştırma: npx tsx --test tests/sayim-ekle.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import postgres from "postgres";

import { countUnitsFor, createModel } from "../src/lib/calc/engine";
import { alerts } from "../src/lib/calc/insights";
import { ingredientChanges, productImpacts, type PriceHistoryRow } from "../src/lib/calc/price-impact";
import type { CountUnit, Dataset, Unit } from "../src/lib/calc/types";
import { COUNT_UNITS } from "../src/lib/constants";
import {
  BASE_UNIT,
  cleanName,
  countFromMonth,
  countGroupOptions,
  defaultPackageSize,
  duplicateMessage,
  findDuplicate,
  formulaStartMessage,
  groupDefaults,
  isUnpriced,
  laterCountItem,
  nameKey,
  nextSortOrder,
  startsLikeFormula,
  unpricedNotice,
} from "../src/lib/count-item";
import { newProductIssue } from "../src/lib/recipe-change";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("ad anahtarı: boşluklar sadeleşir, Türkçe büyük/küçük harf (İ/i, I/ı) ve ı/i aynı", () => {
  assert.equal(nameKey("  Çilek  Şurubu "), "çilek şurubu");
  assert.equal(nameKey("ÇİLEK ŞURUBU"), nameKey("çilek şurubu"));
  assert.equal(nameKey("İÇECEK"), nameKey("içecek"));
  assert.equal(nameKey("ILIK SÜT"), nameKey("ılık süt"));
  // Türkçe olmayan klavyede yazılan I da (VANILYA) Vanilya ile aynı
  assert.equal(nameKey("VANILYA SOS"), nameKey("Vanilya sos"));
  assert.equal(nameKey("Vanılya sos"), nameKey("Vanilya sos"));
  // Ünlü noktaları ayırt edicidir (Ç ≠ C)
  assert.notEqual(nameKey("Cilek surubu"), nameKey("Çilek şurubu"));
  assert.equal(cleanName("  Çilek\t  şurubu  "), "Çilek şurubu");
});

test("ad anahtarı: düzeltme işareti sayılmaz (telefon klavyesinde â yok): kase = Kâse, büyük harfle de", () => {
  assert.equal(nameKey("kase 12oz"), nameKey("Kâse 12oz"));
  assert.equal(nameKey("KÂSE 12OZ"), nameKey("kase 12oz"));
  assert.equal(nameKey("Hala"), nameKey("Hâlâ"));
  assert.equal(nameKey("Mİllî"), nameKey("milli"));
  assert.equal(nameKey("RÛHSAT"), nameKey("ruhsat"));
  assert.equal(nameKey("kÂse"), "kase");
  // Sayım listesinde "Kâse 12oz" varken personelin yazdığı "kase 12oz" aynı ad sayılır
  assert.deepEqual(findDuplicate("kase 12oz", [{ name: "Kâse 12oz", active: true, countUnit: "ADET" }]), { kind: "counted", name: "Kâse 12oz" });
  // Ç, Ş, Ğ, Ö, Ü ayrı harftir; yalnız düzeltme işareti düşer
  assert.notEqual(nameKey("Kose"), nameKey("Köse"));
});

test("formül gibi başlayan ad ve paket kabul edilmez (Hammaddeler / Ürünler CSV'si Excel'de çalıştırmasın)", () => {
  for (const bad of ["=HYPERLINK(\"http://x\";\"Fatura\")", "+90 şurup", "-1 kutu", "@SUM(A1)", "  =1+2"]) assert.equal(startsLikeFormula(bad), true, bad);
  for (const ok of ["Çilek şurubu", "1+1 kampanya bardağı", "Kapak 8-12oz", "e-posta", "Şurup 750 ml"]) assert.equal(startsLikeFormula(ok), false, ok);
  assert.equal(formulaStartMessage("Ad"), "Ad =, +, - ya da @ ile başlayamaz");
  // Sunucu ve pencere aynı kuralı uygular; yeni ürün önerisi de (personelin adı Ürünler CSV'sine gider)
  const actions = read("src/app/panel/sayim/actions.ts");
  assert.match(actions, /\.refine\(\(v\) => !startsLikeFormula\(v\), formulaStartMessage\("Ad"\)\)/);
  assert.match(actions, /packageDesc: zOptText\(160\)\.refine\(\(v\) => !v \|\| !startsLikeFormula\(v\), formulaStartMessage\("Paket"\)\)/);
  assert.match(read("src/app/panel/sayim/add-item.tsx"), /startsLikeFormula\(clean\)/);
  assert.equal(newProductIssue({ name: "=1+2", categoryId: 3, sizes: [{ size: "M", lines: 1 }] }, [], []), "Ürün adı =, +, - ya da @ ile başlayamaz");
  assert.equal(newProductIssue({ name: "Çilekli Latte", categoryId: 3, sizes: [{ size: "M", lines: 1 }] }, [], []), null);
});

const existing = [
  { name: "Çilek püre", active: true, countUnit: "LT" },
  { name: "Su", active: true, countUnit: null },
  { name: "Eski Şurup", active: false, countUnit: "LT" },
];

test("aynı ad: listede, sayılmıyor, pasif; metin role göre", () => {
  assert.deepEqual(findDuplicate("ÇİLEK PÜRE", existing), { kind: "counted", name: "Çilek püre" });
  assert.equal(duplicateMessage(findDuplicate("çilek püre", existing)!, "staff"), "“Çilek püre” zaten sayım listesinde.");
  assert.deepEqual(findDuplicate(" su ", existing), { kind: "uncounted", name: "Su" });
  assert.equal(duplicateMessage({ kind: "uncounted", name: "Su" }, "staff"), "“Su” hammaddelerde var ama sayılmıyor; yöneticiye yazın.");
  assert.equal(duplicateMessage({ kind: "uncounted", name: "Su" }, "admin"), "“Su” hammaddelerde var ama sayılmıyor; Hammaddeler'den sayım birimini seçin.");
  assert.deepEqual(findDuplicate("eski şurup", existing), { kind: "inactive", name: "Eski Şurup" });
  assert.equal(duplicateMessage({ kind: "inactive", name: "Eski Şurup" }, "staff"), "“Eski Şurup” pasif; yönetici Hammaddeler'den yeniden açabilir.");
  assert.match(duplicateMessage({ kind: "inactive", name: "Eski Şurup" }, "admin"), /pasif; Hammaddeler'den yeniden açabilirsiniz/);
  assert.equal(findDuplicate("Çilek şurubu", existing), null);
  // Aynı anahtarlı birden çok kayıt: sayım listesindeki önce söylenir
  assert.equal(findDuplicate("x", [{ name: "X", active: false, countUnit: null }, { name: "x", active: true, countUnit: "ADET" }])?.kind, "counted");
});

test("sayım biriminden malzeme birimi: Hammaddeler'in kuralına uyar; paket içeriği önerisi", () => {
  for (const u of COUNT_UNITS) assert.ok(countUnitsFor(BASE_UNIT[u]).includes(u), u);
  assert.deepEqual(BASE_UNIT, { KG: "gr", LT: "ml", ADET: "adet", DİLİM: "dilim" });
  assert.equal(defaultPackageSize("KG"), 1000);
  assert.equal(defaultPackageSize("LT"), 1000);
  assert.equal(defaultPackageSize("ADET"), 1);
  assert.equal(defaultPackageSize("DİLİM"), 1);
});

test("grubun varsayılanları: en sık kategori ve KDV (önce aktifler), eşitlikte önce gelen; boş grupta Diğer ve %1", () => {
  const rows = [
    { countGroup: "AMBALAJ", category: "Ambalaj", vatRate: 0.2, active: true },
    { countGroup: "AMBALAJ", category: "Diğer", vatRate: 0.1, active: true },
    { countGroup: "AMBALAJ", category: "Ambalaj", vatRate: 0.2, active: true },
    { countGroup: "AMBALAJ", category: "Diğer", vatRate: 0.1, active: false },
    { countGroup: "AMBALAJ", category: "Diğer", vatRate: 0.1, active: false },
    { countGroup: "SOS", category: "Sos & Şurup", vatRate: 0.01, active: true },
    { countGroup: "SOS", category: "Püre", vatRate: 0.01, active: true },
  ];
  assert.deepEqual(groupDefaults(rows, "AMBALAJ"), { category: "Ambalaj", vatRate: 0.2 });
  assert.deepEqual(groupDefaults(rows, "SOS"), { category: "Sos & Şurup", vatRate: 0.01 });
  assert.deepEqual(groupDefaults(rows, "YOK"), { category: "Diğer", vatRate: 0.01 });
  // Yalnız pasif kalemi olan grup: pasiflerden
  assert.deepEqual(groupDefaults([{ countGroup: "ESKİ", category: "Toz", vatRate: 0.01, active: false }], "ESKİ"), { category: "Toz", vatRate: 0.01 });
  // Yeni kalem bütün malzemelerin sonuna düşer (sayım listesinde grubunun sonu)
  assert.equal(nextSortOrder([{ sortOrder: 3 }, { sortOrder: 1033 }, { sortOrder: 7 }]), 1034);
  assert.equal(nextSortOrder([]), 1);
});

test("grup seçenekleri: listedeki sırayla, olağan birimle; hiçbir hammaddede yazılı olmayan grup yok", () => {
  const rows: { countGroup: string | null; countUnit: CountUnit | null; active: boolean }[] = [
    { countGroup: "SOS", countUnit: "LT", active: true },
    { countGroup: "SOS", countUnit: "KG", active: true },
    { countGroup: "SOS", countUnit: "LT", active: true },
    { countGroup: "TATLI", countUnit: "DİLİM", active: true },
    { countGroup: null, countUnit: "ADET", active: true },
  ];
  assert.deepEqual(countGroupOptions(["TATLI", "SOS", "DİĞER"], rows), [
    { name: "TATLI", unit: "DİLİM" },
    { name: "SOS", unit: "LT" },
  ]);
});

test("Excel verisinde grupların olağan birimi ve varsayılanları (sayım ekranının gördüğü)", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const ds = excelToDataset(data);
  const sorted = [...ds.ingredients].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const sheet = createModel(ds).stockSheet("2026-10");
  const options = countGroupOptions(
    sheet.groups.map((g) => g.name),
    sorted,
  );
  assert.equal(options.length, sheet.groups.length);
  assert.equal(options.find((o) => o.name === "SOS / ŞURUP / PÜRE")?.unit, "LT");
  assert.equal(options.find((o) => o.name === "AMBALAJ MALZEMELERİ")?.unit, "ADET");
  assert.deepEqual(groupDefaults(sorted, "SOS / ŞURUP / PÜRE"), { category: "Sos & Şurup", vatRate: 0.01 });
});

test("fiyatı girilmemiş: aktif, elle fiyatlı, paket fiyatı 0; zil metni", () => {
  assert.equal(isUnpriced({ active: true, priceSource: "manual", packagePrice: 0 }), true);
  assert.equal(isUnpriced({ active: true, priceSource: "water", packagePrice: 0 }), false, "su ve buz faturadan");
  assert.equal(isUnpriced({ active: false, priceSource: "manual", packagePrice: 0 }), false);
  assert.equal(isUnpriced({ active: true, priceSource: "manual", packagePrice: 12 }), false);
  assert.deepEqual(unpricedNotice(2, ["Çilek şurubu", "Böğürtlen püre"]), {
    title: "Fiyatı girilmemiş 2 hammadde",
    body: "Çilek şurubu, Böğürtlen püre · Hammaddeler'den paket fiyatını girin.",
  });
  assert.equal(unpricedNotice(5, ["A", "B", "C"]).body, "A, B, C ve 2 hammadde daha · Hammaddeler'den paket fiyatını girin.");
});

// ---------------------------------------------------------------- Listeye girdiği ay (count_from)

test("listeye girdiği ay: sonradan eklenen kalem önceki aylarda, o ay sayılmadıysa listede çıkmaz", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const base = excelToDataset(data);
  const newId = Math.max(...base.ingredients.map((i) => i.id)) + 1;
  const added = { ...base.ingredients.find((i) => i.name === "Toffeenut şurubu")!, id: newId, name: "Çilek şurubu", packagePrice: 0, isEstimate: true, sortOrder: 2000, countFrom: "2026-10" };
  const countable = base.ingredients.filter((i) => i.countUnit && i.active);
  // Eylül sayımı bitmiş: bugünkü listenin hepsi sayılmış
  const september = countable.map((i) => ({ month: "2026-09", ingredientId: i.id, qty: 1 }));
  const ds: Dataset = { ...base, ingredients: [...base.ingredients, added], stockCounts: [...base.stockCounts, ...september] };
  const m = createModel(ds);
  const lines = (model: typeof m, month: string) => model.stockSheet(month).groups.flatMap((g) => g.lines);
  // Ekim'de eklenen kalem Eylül'de yok: biten sayım "kalem kaldı" demez, yazdırılan listeye girmez
  assert.ok(!lines(m, "2026-09").some((l) => l.ingredient.id === newId));
  assert.equal(lines(m, "2026-09").filter((l) => l.qty === null).length, 0);
  // Eklendiği ay ve sonrası listede, grubunun sonunda
  for (const month of ["2026-10", "2026-11"]) {
    const sos = m.stockSheet(month).groups.find((g) => g.name === "SOS / ŞURUP / PÜRE")!;
    assert.equal(sos.lines.at(-1)?.ingredient.id, newId, month);
  }
  // Excel'den gelenler (count_from boş) her ayda
  assert.equal(lines(m, "2026-07").length, countable.length);
  // O ay sayılmışsa (ör. sonradan geriye alındı) değeriyle görünür
  const counted = createModel({ ...ds, stockCounts: [...ds.stockCounts, { month: "2026-09", ingredientId: newId, qty: 2 }] });
  assert.equal(lines(counted, "2026-09").find((l) => l.ingredient.id === newId)?.qty, 2);
  // Kalemin ayı: eklenirken gösterilen ay; ileri bir ayda eklense de bu ay
  assert.equal(countFromMonth("2026-09", "2026-10"), "2026-09");
  assert.equal(countFromMonth("2026-10", "2026-10"), "2026-10");
  assert.equal(countFromMonth("2026-12", "2026-10"), "2026-10");
  // Listede ama daha sonraki bir aydan itibaren çıkan kalem: "Listeye ekle" onu yeniden açmaz, bu aydan itibaren de alır
  const rows = [
    { id: 7, name: "Çilek şurubu", active: true, countUnit: "LT", countFrom: "2026-10" },
    { id: 8, name: "Peçetelik", active: true, countUnit: "ADET", countFrom: null },
    { id: 9, name: "Eski şurup", active: false, countUnit: "LT", countFrom: "2026-11" },
  ];
  assert.equal(laterCountItem("ÇİLEK  ŞURUBU", rows, "2026-09")?.id, 7);
  assert.equal(laterCountItem("Çilek şurubu", rows, "2026-10"), undefined);
  assert.equal(laterCountItem("Peçetelik", rows, "2026-09"), undefined);
  assert.equal(laterCountItem("Eski şurup", rows, "2026-09"), undefined, "pasif kalem geri açılmaz (aynı ad kuralı söyler)");
  const actions = read("src/app/panel/sayim/actions.ts");
  const add = actions.slice(actions.indexOf("export async function addCountItem"), actions.indexOf("export async function saveStaffStockExtras"));
  assert.match(add, /const from = countFromMonth\(m, currentMonthTR\(\)\);/);
  assert.match(add, /countFrom: from,/);
  assert.match(add, /\.set\(\{ countFrom: from \}\)\.where\(eq\(s\.ingredients\.id, later\.id\)\)/);
  assert.ok(add.indexOf("laterCountItem(") < add.indexOf("findDuplicate("), "önce geriye çekme, sonra aynı ad kuralı");
  // Sütun modele taşınır; motor yalnız sayım listesinde süzer
  assert.match(read("src/server/data/dataset.ts"), /countFrom: i\.countFrom,/);
  assert.match(read("src/lib/calc/engine.ts"), /countable\.filter\(\(i\) => !i\.countFrom \|\| i\.countFrom <= month \|\| counts\.has\(i\.id\)\)/);
});

test("fiyatı girilmemiş malzeme kullanan ürün: 'maliyeti eksik' uyarısı; yalnız ondan oluşan reçete 'reçetesi boş' sayılmaz", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const base = excelToDataset(data);
  const newId = Math.max(...base.ingredients.map((i) => i.id)) + 1;
  const syrup = { ...base.ingredients.find((i) => i.name === "Toffeenut şurubu")!, id: newId, name: "Fındık şurubu (yeni)", packagePrice: 0, isEstimate: true, priceSource: "manual" as const, sortOrder: 2000 };
  const latte = base.products.find((p) => p.name === "Latte" && p.size === "M")!;
  const sodaId = Math.max(...base.products.map((p) => p.id)) + 1;
  const soda = { ...latte, id: sodaId, name: "Fındıklı Soda", size: "Tek" as const };
  const line = (id: number, productId: number, qty: number) => ({ id, productId, ingredientId: newId, qty, qtyExpr: null, note: null, sortOrder: 99 });
  const ds: Dataset = {
    ...base,
    ingredients: [...base.ingredients, syrup],
    products: [...base.products, soda],
    // Latte'de bir satır fiyatsız (maliyeti eksik), Fındıklı Soda yalnız fiyatsız malzemeden (maliyet 0)
    recipeItems: [...base.recipeItems, line(900_001, latte.id, 20), line(900_002, sodaId, 30)],
  };
  const m = createModel(ds);
  const month = "2026-09";
  const a = alerts(m, month);
  const missing = a.find((x) => x.title.endsWith("ürünün maliyeti eksik"));
  assert.ok(missing, a.map((x) => x.title).join(" | "));
  assert.equal(missing.title, "2 ürünün maliyeti eksik");
  assert.equal(missing.level, "warning");
  assert.equal(missing.href, "/panel/hammaddeler?durum=fiyatsiz");
  assert.equal(missing.detail, "Latte|M, Fındıklı Soda|Tek. Reçetesinde fiyatı girilmemiş hammadde var; Hammaddeler'den paket fiyatını girin.");
  // Ürünler'deki durum Excel kuralıyla "Reçete yok" kalır ama reçetesi boş diye sayılmaz
  assert.equal(m.products.find((p) => p.product.id === sodaId)!.status, "Reçete yok");
  const before = alerts(createModel(base), month).find((x) => x.title.includes("reçetesi boş"))?.title ?? null;
  const empty = a.find((x) => x.title.includes("reçetesi boş"));
  assert.equal(empty?.title ?? null, before);
  assert.ok(!empty || !empty.detail.includes("Fındıklı Soda"));
  // Fiyat girilince uyarı kalkar, ürünün maliyeti ve durumu gelir
  const priced = createModel({ ...ds, ingredients: ds.ingredients.map((i) => (i.id === newId ? { ...i, packagePrice: 760 } : i)) });
  assert.ok(!alerts(priced, month).some((x) => x.title.endsWith("ürünün maliyeti eksik")));
  assert.notEqual(priced.products.find((p) => p.product.id === sodaId)!.status, "Reçete yok");
  // Fiyatsız malzeme yoksa uyarı da yok
  assert.ok(!alerts(createModel(base), month).some((x) => x.title.endsWith("ürünün maliyeti eksik")));
});

// ---------------------------------------------------------------- Sahte zam yok

test("fiyatı 0 eklenen kalemin ilk fiyatı zam sayılmaz (zil, Genel bakış, sabah e-postası, Hammaddeler aynı hesabı kullanır)", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const base = excelToDataset(data);
  const newId = Math.max(...base.ingredients.map((i) => i.id)) + 1;
  const latte = base.products.find((p) => p.name === "Latte" && p.size === "M")!;
  const counted = {
    ...base.ingredients.find((i) => i.name === "Toffeenut şurubu")!,
    id: newId,
    name: "Çilek şurubu",
    packagePrice: 0,
    isEstimate: true,
    sortOrder: 2000,
  };
  const withItem = (price: number): Dataset => ({
    ...base,
    ingredients: [...base.ingredients, { ...counted, packagePrice: price }],
    // Kalem bir reçeteye de girmiş olsun (ör. yeni ürün önerisinde): ürün etkisi de denenir
    recipeItems: [...base.recipeItems, { id: 999_999, productId: latte.id, ingredientId: newId, qty: 20, qtyExpr: null, note: null, sortOrder: 99 }],
  });
  const since = "2026-10-01T00:00:00.000Z";
  const row = (packagePrice: number, changedAt: string): PriceHistoryRow => ({ ingredientId: newId, packagePrice, packageSize: 750, changedAt, changedBy: "Yönetici", note: null });
  // addCountItem fiyat geçmişine 0 yazmaz; yönetici fiyatı girince ilk satır açılır: başlangıçtır, zam değildir
  const priced = createModel(withItem(760));
  const first = ingredientChanges(priced.ds.ingredients, [row(760, "2026-10-22T09:00:00.000Z")], since);
  assert.equal(first.length, 0);
  assert.equal(productImpacts(priced, first).length, 0);
  // Pencereden önce ya da içinde 0'lık bir satır olsa da (ör. önce paket içeriği düzeltildi) 0 → fiyat zam sayılmaz
  assert.equal(ingredientChanges(priced.ds.ingredients, [row(0, "2026-09-01T09:00:00.000Z"), row(760, "2026-10-22T09:00:00.000Z")], since).length, 0);
  assert.equal(ingredientChanges(priced.ds.ingredients, [row(0, "2026-10-05T09:00:00.000Z"), row(760, "2026-10-22T09:00:00.000Z")], since).length, 0);
  // Sonraki gerçek değişiklik zam olarak görünür (kural bozulmadı)
  const raised = createModel(withItem(900));
  const later = ingredientChanges(raised.ds.ingredients, [row(760, "2026-10-10T09:00:00.000Z"), row(900, "2026-10-22T09:00:00.000Z")], since);
  assert.equal(later.length, 1);
  assert.ok(later[0].pct > 0.18);
  // Fiyatsızken stok değeri 0, maliyete katkısı 0
  const unpriced = createModel(withItem(0));
  assert.equal(unpriced.unitCost.get(newId) ?? 0, 0);
});

test("eylem ve yazım yolları: Listeye ekle fiyat geçmişine yazmaz; ilk elle / Paraşüt fiyatı geçmişe tek satır yazar", () => {
  const actions = read("src/app/panel/sayim/actions.ts");
  const add = actions.slice(actions.indexOf("export async function addCountItem"));
  assert.doesNotMatch(add, /ingredientPrices/);
  assert.match(add, /packagePrice: 0,/);
  assert.match(add, /isEstimate: true,/);
  assert.match(add, /priceSource: "manual",/);
  // Zam hesabı 0'lık başlangıcı atlar: price-impact.ts'teki koruma
  assert.match(read("src/lib/calc/price-impact.ts"), /if \(!\(before > 0\) \|\| !\(after > 0\)\) continue;/);
  // Bütün zam okuyucuları aynı hesaptan (ingredientChanges): zil, Genel bakış, sabah e-postası, Ürünler, Hammaddeler
  for (const f of ["src/server/actions/notifications.ts", "src/app/panel/page.tsx", "src/server/notify/digest.ts", "src/app/panel/urunler/page.tsx"]) {
    assert.match(read(f), /loadPriceAlerts\(/, f);
  }
  assert.match(read("src/server/data/price-alerts.ts"), /ingredientChanges\(/);
  assert.match(read("src/app/panel/hammaddeler/page.tsx"), /ingredientChanges\(/);
});

// ---------------------------------------------------------------- Yetki ve görünürlük

test("personel kalem ekler (bu ay ve geçen ay); fiyat alanı yok, personel fiyat görmez", () => {
  const actions = read("src/app/panel/sayim/actions.ts");
  const add = actions.slice(actions.indexOf("export async function addCountItem"));
  assert.match(add, /const me = await requireUser\(\);/);
  assert.doesNotMatch(add, /requireAdmin/);
  assert.match(add, /if \(me\.role !== "admin" && !staffCountMonths\(\)\.includes\(m\)\)/);
  assert.match(add, /pg_advisory_xact_lock\(hashtext\('sayim-listeye-ekle'\)\)/);
  // Pencere fiyat sormaz, fiyat göstermez
  const dialog = read("src/app/panel/sayim/add-item.tsx");
  for (const word of ["price", "Price", "unitCost", "₺", "Fiyat ", "tl("]) assert.ok(!dialog.includes(word), `${word} pencerede olmamalı`);
  // Sayım sayfası personele fiyat geçirmez (0); "fiyat yok" ipucu yalnız yönetici satırında
  const page = read("src/app/panel/sayim/page.tsx");
  assert.match(page, /unitPrice: isAdmin \? l\.unitPrice : 0/);
  assert.match(page, /unitPriceNow: isAdmin \? /);
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /const money = isAdmin \? \(/);
  assert.match(form, /const moneyMobile = isAdmin \? \(/);
  // Personelin bildirimi: "Fiyatını gir" yalnız yönetici
  assert.match(form, /action: isAdmin \? \{ label: "Fiyatını gir"/);
});

test("zil: fiyatı girilmemiş hammaddeler yalnız yöneticide, hata zili düşürmez", () => {
  const src = read("src/server/actions/notifications.ts");
  const staffReturn = src.indexOf('if (user.role !== "admin") return [...cash, ...mine, ...recipes];');
  const call = src.indexOf("unpricedNotifications().catch(() => [])");
  assert.ok(staffReturn > 0 && call > staffReturn, "personel dalından sonra, yöneticinin Promise.all'ında");
  const fn = src.slice(src.indexOf("async function unpricedNotifications"), src.indexOf("export async function loadPanelNotifications"));
  assert.match(fn, /href: "\/panel\/hammaddeler\?durum=fiyatsiz"/);
  assert.match(fn, /group: "uyari"/);
  assert.match(src, /\.\.\.priceNote, \.\.\.unpriced, \.\.\.warnings\]/);
  // Hammaddeler süzgeci aynı kural
  const client = read("src/app/panel/hammaddeler/ingredients-client.tsx");
  assert.match(client, /fiyatsiz: "Fiyat yok"/);
  assert.match(client, /\(filter !== "fiyatsiz" \|\| isUnpriced\(r\)\)/);
  // Zilin SQL'i isUnpriced ile aynı koşul
  assert.match(read("src/server/data/unpriced.ts"), /eq\(s\.ingredients\.active, true\), eq\(s\.ingredients\.priceSource, "manual"\), eq\(s\.ingredients\.packagePrice, 0\)/);
  // Reçete onaylarında fiyatı girilmemiş malzeme hem değişiklikte hem yeni üründe söylenir (maliyet eksik görünür)
  const approvals = read("src/app/panel/onaylar/page.tsx");
  assert.equal([...approvals.matchAll(/isUnpriced\(ing\)/g)].length, 2);
  const list = read("src/app/panel/onaylar/review-list.tsx");
  assert.equal([...list.matchAll(/<UnpricedNote names=/g)].length, 2);
});

// ---------------------------------------------------------------- Sekiz kalem (migration)

const migrationFile = readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_sayim_yeni_kalemler.sql"));
const EIGHT = ["Çilek şurubu", "Cookie şurubu", "Lemon tea şurubu", "Hazelnut şurubu", "Vanilya sos", "Yaban mersini püre", "Böğürtlen püre", "Klips kapak"];

interface MigrationRow {
  name: string;
  category: string;
  packageDesc: string;
  size: number;
  price: number;
  unit: string;
  countUnit: string;
  group: string;
  vat: number;
  note: string;
  ord: number;
}

/** Migration'ın VALUES satırları: her kalemin birimi, sayım birimi, grubu ve KDV'si kendi satırında */
function migrationRows(sql: string): MigrationRow[] {
  const re = /^\s*\('([^']+)', '([^']+)', '([^']+)', (\d+), (\d+), '([^']+)', '([^']+)', '([^']+)', ([\d.]+), '([^']*)', (\d+)\),?$/gm;
  return [...sql.matchAll(re)].map((m) => ({
    name: m[1],
    category: m[2],
    packageDesc: m[3],
    size: Number(m[4]),
    price: Number(m[5]),
    unit: m[6],
    countUnit: m[7],
    group: m[8],
    vat: Number(m[9]),
    note: m[10],
    ord: Number(m[11]),
  }));
}

test("migration: sekiz kalem, korumalar, Excel usulü tahmin ve fiyat geçmişi", () => {
  assert.ok(migrationFile, "sayim_yeni_kalemler migration'ı yok");
  const sql = read(`drizzle/${migrationFile}`);
  const rows = migrationRows(sql);
  assert.deepEqual(
    rows.map((r) => r.name),
    EIGHT,
  );
  assert.deepEqual(
    rows.map((r) => r.ord),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM "ingredients"\)/, "boş veritabanına eklemez (db:seed Excel'i yükler)");
  assert.match(sql, /AND NOT EXISTS \(/);
  assert.match(sql, /'\(faturada yok\)'/);
  // Birim, sayım birimi, grup ve KDV satırdan gelir (sabit yazılsa kapak şurup grubuna, ml'ye ve %1'e düşerdi); kalemler
  // Ekim 2026 sayımından itibaren listede
  assert.match(sql, /y\."unit", y\."vat_rate", y\."note", true, 'manual', y\."count_unit", y\."count_group", '2026-10', "son"\."m" \+ y\."ord", true/);
  assert.match(sql, /'Sayım listesine eklendi \(tahmini fiyat\)', 'Sistem'/);
  assert.match(sql, /HAVING count\(\*\) > 0/, "eklenmediyse işlem geçmişine yazmaz");
  // Tek ifade (tek kırılma noktasız blok): birleştirmede --custom ile yeniden üretilip aynen yapıştırılır
  assert.doesNotMatch(sql, /statement-breakpoint/);
});

test("migration satırları Excel'in gruplarıyla tutarlı: birim sayım birimine uyar, grup ve kategori var, KDV grubunki", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const excel = excelToDataset(data).ingredients;
  const rows = migrationRows(read(`drizzle/${migrationFile}`));
  for (const r of rows) {
    assert.equal(BASE_UNIT[r.countUnit as CountUnit], r.unit, `${r.name}: birim`);
    assert.ok(countUnitsFor(r.unit as Unit).includes(r.countUnit as CountUnit), `${r.name}: sayım birimi`);
    assert.ok(excel.some((i) => i.countGroup === r.group && i.category === r.category), `${r.name}: ${r.group} grubunda ${r.category} yok`);
    assert.equal(groupDefaults(excel, r.group).vatRate, r.vat, `${r.name}: KDV`);
    assert.ok(r.size > 0 && r.price > 0, `${r.name}: paket`);
    assert.match(r.note, /^VARSAYIM: Faturada yok, .+ Gerçek fiyatı yazın\.$/, r.name);
  }
  // Klips kapak, Kapak 8-12oz gibi: ambalaj, adetle sayılır, 1.000'lik paket 1.165 ₺, KDV %20
  const lid = excel.find((i) => i.name === "Kapak 8-12oz")!;
  const klips = rows.find((r) => r.name === "Klips kapak")!;
  assert.deepEqual(
    { category: klips.category, unit: klips.unit, countUnit: klips.countUnit, group: klips.group, vat: klips.vat, size: klips.size, price: klips.price },
    { category: lid.category, unit: lid.unit, countUnit: lid.countUnit, group: lid.countGroup, vat: lid.vatRate, size: lid.packageSize, price: lid.packagePrice },
  );
});

/** Migration'daki SQL anahtarının JS karşılığı: translate + yalnız ASCII küçültme (C yerel ayarı) */
function sqlKey(name: string, from: string, to: string): string {
  const map = new Map([...from].map((c, i) => [c, [...to][i]]));
  const translated = [...name.trim().replace(/\s+/g, " ")].map((c) => map.get(c) ?? c).join("");
  return translated.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

test("migration'ın ad anahtarı uygulamanınkiyle aynı (Türkçe harfler ve düzeltme işareti, C yerel ayarında da)", () => {
  const sql = read(`drizzle/${migrationFile}`);
  const m = sql.match(/translate\(y\."name", '([^']+)', '([^']+)'\)/);
  assert.ok(m, "translate bulunamadı");
  const [, from, to] = m;
  // Var olan adın yanındaki translate da aynı harfleri çevirir
  assert.ok(sql.includes(`translate(regexp_replace(btrim(i."name"), '\\s+', ' ', 'g'), '${from}', '${to}')`));
  const names = [...EIGHT, "ÇİLEK ŞURUBU", "Çilek  Şurubu ", "COOKIE ŞURUBU", "HAZELNUT ŞURUBU", "VANILYA SOS", "YABAN MERSİNİ PÜRE", "BÖĞÜRTLEN PÜRE", "Lemon Tea Şurubu"];
  for (const name of [...names, "KLİPS KAPAK", "Klîps kâpak", "KLÎPS KÂPAK", "Kâse 12oz", "KÛRU ÜZÜM"]) {
    assert.equal(sqlKey(name, from, to), nameKey(name), name);
  }
});

test("migration veritabanında: boşta 0, doluda 8 (her biri fiyat satırı, kendi birimi ve grubuyla), aynı ad varsa 7", { skip: process.env.EKLE_TEST_DATABASE_URL ? false : "EKLE_TEST_DATABASE_URL yok" }, async () => {
  const db = postgres(process.env.EKLE_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const migration = read(`drizzle/${migrationFile}`);
  const ROLLBACK = new Error("geri al");
  type Added = { name: string; unit: string; count_unit: string; count_group: string; vat_rate: number; count_from: string; supplier: string; is_estimate: boolean };
  /** Migration'ı işlemde çalıştırır, sonucu okur, hepsini geri alır */
  async function trial(prepare: (tx: postgres.TransactionSql) => Promise<unknown>) {
    let result: { added: number; prices: number; log: number; rows: Added[] } | null = null;
    await db
      .begin(async (tx) => {
        await prepare(tx);
        const before = await tx`select coalesce(max(id), 0) as id from ingredients`;
        const logBefore = await tx`select coalesce(max(id), 0) as id from activity_log`;
        await tx.unsafe(migration);
        const rows = await tx<Added[]>`select name, unit, count_unit, count_group, vat_rate, count_from, supplier, is_estimate from ingredients where id > ${before[0].id} order by sort_order`;
        const [{ prices }] = await tx`select count(*)::int as prices from ingredient_prices p join ingredients i on i.id = p.ingredient_id where i.id > ${before[0].id} and p.note = 'Sayım listesine eklendi (tahmini fiyat)'`;
        const [{ log }] = await tx`select count(*)::int as log from activity_log where id > ${logBefore[0].id} and action = 'Sayım listesine eklendi'`;
        result = { added: rows.length, prices, log, rows: [...rows] };
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    return result!;
  }
  // Sekizi zaten eklenmişse (bu veritabanı migrate edildi) adları geçici olarak değiştirilir: silmek reçete ve sayım
  // bağlarına takılırdı; işlem sonunda hepsi geri alınır
  const hideEight = (tx: postgres.TransactionSql) => tx`update ingredients set name = name || ' (deneme)' where name in ${tx(EIGHT)}`;
  const counts = (r: { added: number; prices: number; log: number }) => ({ added: r.added, prices: r.prices, log: r.log });
  try {
    const filled = await trial(hideEight);
    assert.deepEqual(counts(filled), { added: 8, prices: 8, log: 1 });
    assert.deepEqual(
      filled.rows.map((r) => r.name),
      EIGHT,
    );
    const pick = (r: Added) => ({ unit: r.unit, countUnit: r.count_unit, group: r.count_group, vat: r.vat_rate, from: r.count_from, supplier: r.supplier, estimate: r.is_estimate });
    assert.deepEqual(pick(filled.rows.find((r) => r.name === "Çilek şurubu")!), { unit: "ml", countUnit: "LT", group: "SOS / ŞURUP / PÜRE", vat: 0.01, from: "2026-10", supplier: "(faturada yok)", estimate: true });
    assert.deepEqual(pick(filled.rows.find((r) => r.name === "Klips kapak")!), { unit: "adet", countUnit: "ADET", group: "AMBALAJ MALZEMELERİ", vat: 0.2, from: "2026-10", supplier: "(faturada yok)", estimate: true });
    // Aynı ad (Türkçe büyük harf, fazladan boşluk) varsa atlanır
    const noStrawberry = await trial(async (tx) => {
      await hideEight(tx);
      await tx`insert into ingredients (name, category, unit) values ('ÇİLEK  ŞURUBU', 'Sos & Şurup', 'ml')`;
    });
    assert.deepEqual(counts(noStrawberry), { added: 7, prices: 7, log: 1 });
    assert.ok(!noStrawberry.rows.some((r) => r.name === "Çilek şurubu"));
    // Düzeltme işaretli yazım da aynı ad sayılır
    const noLid = await trial(async (tx) => {
      await hideEight(tx);
      await tx`insert into ingredients (name, category, unit) values ('KLİPS  KÂPAK ', 'Ambalaj', 'adet')`;
    });
    assert.deepEqual(counts(noLid), { added: 7, prices: 7, log: 1 });
    assert.ok(!noLid.rows.some((r) => r.name === "Klips kapak"));
    // Boş veritabanında hiçbir şey eklenmez ve işlem geçmişine yazılmaz
    const empty = await trial((tx) => tx`truncate ingredients cascade`);
    assert.deepEqual(counts(empty), { added: 0, prices: 0, log: 0 });
    // Hepsi zaten varsa yine sessiz
    const again = await trial(async () => {});
    assert.equal(again.log, again.added ? 1 : 0);
  } finally {
    await db.end();
  }
});
