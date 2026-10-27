// Stok sayımı › "Listeye ekle" (src/lib/count-item.ts, ortak çekirdek src/server/data/count-item.ts; eylemler
// src/app/panel/sayim/actions.ts addCountItem ve reçete önerisindeki "Yeni malzeme" addProposalIngredient) ve sekiz yeni
// kalemin migration'ı (drizzle/*_sayim_yeni_kalemler.sql): Türkçe ad anahtarı ve aynı ad kuralı, sayım biriminden malzeme
// birimi, grubun varsayılanları, kalemin listeye girdiği ay (count_from), isteğe bağlı paket fiyatı (Tahmini kalır; yazılan
// fiyat geçmişin başlangıcıdır: sonraki zam kapanmış ayı değiştirmez, zam uyarısı onu saymaz), fiyatı 0 kalemin ilk
// fiyatının zam sayılmaması, personelin ay kuralı, personelin fiyatı yalnız
// yazması (görmemesi), CSV'de formül gibi başlayan adın kabul edilmemesi.
// Fiyatıyla eklenmiş eski kalemlere başlangıç satırı yazan migration (drizzle/*_sayim_kalemi_fiyat_baslangici.sql) da.
// Migration'ların veritabanı denemesi EKLE_TEST_DATABASE_URL verilince çalışır (işlem geri alınır; migrate edilmiş bir
// yerel kopya verin, ör. postgres://postgres:postgres@localhost:5432/laffogato_ekle).
// Çalıştırma: npx tsx --test tests/sayim-ekle.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import postgres from "postgres";

import { STAFF_LATE_FIX_MESSAGE, STAFF_OLD_MONTH_MESSAGE, staffCountIssue } from "../src/app/panel/sayim/logic";
import { countUnitsFor, createModel } from "../src/lib/calc/engine";
import { alerts } from "../src/lib/calc/insights";
import { ingredientChanges, productImpacts, type PriceHistoryRow } from "../src/lib/calc/price-impact";
import type { CountUnit, Dataset, Unit } from "../src/lib/calc/types";
import { COUNT_UNITS } from "../src/lib/constants";
import {
  BASE_UNIT,
  cleanName,
  COUNT_ITEM_PRICE_FIXED_NOTE,
  COUNT_ITEM_PRICE_MAX,
  COUNT_ITEM_PRICE_NOTE,
  countFromMonth,
  countGroupOptions,
  countItemLogDetail,
  countItemNote,
  countItemPriceRow,
  correctedCountItemStart,
  correctsCountItemStart,
  defaultPackageSize,
  duplicateMessage,
  findDuplicate,
  formulaStartMessage,
  groupDefaults,
  isUnpriced,
  laterCountItem,
  looseKey,
  nameKey,
  netPackagePrice,
  newCountItemValues,
  nextSortOrder,
  readPackagePrice,
  startsLikeFormula,
  unpricedNotice,
} from "../src/lib/count-item";
import { newProductIssue } from "../src/lib/recipe-change";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Kaynaktaki bir işlevin gövdesi: adından sonraki ilk "export async function"a kadar */
const fnBody = (file: string, name: string) => {
  const src = read(file);
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${file}: ${name}`);
  const next = src.indexOf("export async function", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
};
/** Listeye ekle'nin ortak çekirdeği: iki eylem (sayım ve reçete önerisi) aynı işlevi çağırır */
const CORE = "src/server/data/count-item.ts";

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
  // Sunucu ve pencere aynı kuralı uygular; yeni ürün önerisi de (personelin adı Ürünler CSV'sine gider). Şema ortak
  // çekirdekte, iki eylem de onunla doğrular
  const actions = read(CORE);
  assert.match(actions, /\.refine\(\(v\) => !startsLikeFormula\(v\), formulaStartMessage\("Ad"\)\)/);
  assert.match(actions, /packageDesc: zOptText\(160\)\.refine\(\(v\) => !v \|\| !startsLikeFormula\(v\), formulaStartMessage\("Paket"\)\)/);
  assert.match(fnBody("src/app/panel/sayim/actions.ts", "addCountItem"), /const data = countItemSchema\.parse\(input\);/);
  assert.match(fnBody("src/server/actions/recipe-requests.ts", "addProposalIngredient"), /const data = countItemSchema\.parse\(input\);/);
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
  // Ortak çekirdek (Listeye ekle ve reçete önerisindeki "Yeni malzeme" aynı işlevi çağırır)
  const add = fnBody(CORE, "createCountItem");
  assert.match(add, /const from = countFromMonth\(m, currentMonthTR\(\)\);/);
  assert.match(read("src/lib/count-item.ts"), /countFrom: from,/);
  assert.match(add, /newCountItemValues\(data, rows, from, note(, \{[^}]*\})?\)/);
  assert.match(add, /\.set\(\{ countFrom: from \}\)\.where\(eq\(s\.ingredients\.id, later\.id\)\)/);
  assert.ok(add.indexOf("laterCountItem(") < add.indexOf("findDuplicate("), "önce geriye çekme, sonra aynı ad kuralı");
  for (const [file, fn] of [
    ["src/app/panel/sayim/actions.ts", "addCountItem"],
    ["src/server/actions/recipe-requests.ts", "addProposalIngredient"],
  ]) {
    assert.match(fnBody(file, fn), /await createCountItem\(me, data, "(sayim|recete)"\)/, `${fn} ortak çekirdeği çağırır`);
  }
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
  // İlk fiyatı faturadan gelip onay bekliyorsa "paket fiyatını girin" demez, onaya götürür (denetim B03 incelemesi)
  const held = alerts(createModel({ ...ds, pendingPriceHolds: [newId] }), month);
  assert.ok(!held.some((x) => x.title.endsWith("ürünün maliyeti eksik")), held.map((x) => x.title).join(" | "));
  const waiting = held.find((x) => x.title.endsWith("ürünün maliyeti fiyat onayında"));
  assert.ok(waiting);
  assert.deepEqual([waiting.title, waiting.href], ["2 ürünün maliyeti fiyat onayında", "/panel/hammaddeler#fiyat-onayi"]);
  assert.equal(waiting.detail, "Latte|M, Fındıklı Soda|Tek. Reçetesindeki hammaddenin faturadan gelen ilk fiyatı onay bekliyor; onaylanana kadar maliyette 0 ₺ sayılır.");
  // Başka bir hammaddenin onayı bu ürünleri onaya götürmez
  assert.ok(alerts(createModel({ ...ds, pendingPriceHolds: [newId + 1] }), month).some((x) => x.title === "2 ürünün maliyeti eksik"));
});

// ---------------------------------------------------------------- Paket fiyatı (isteğe bağlı) ve ortak çekirdeğin değerleri

test("paket fiyatı: boş bırakılabilir; Türkçe ya da noktalı yazılır, kuruşa yuvarlanır; 0, eksi, yazı ve yüzde kabul edilmez", () => {
  assert.deepEqual(readPackagePrice(""), { value: null, error: null });
  assert.deepEqual(readPackagePrice("   "), { value: null, error: null });
  assert.deepEqual(readPackagePrice("760"), { value: 760, error: null });
  assert.deepEqual(readPackagePrice("1.250,50"), { value: 1250.5, error: null });
  assert.deepEqual(readPackagePrice("1250.5"), { value: 1250.5, error: null });
  assert.deepEqual(readPackagePrice("12,024"), { value: 12.02, error: null });
  assert.deepEqual(readPackagePrice("760 ₺"), { value: 760, error: null });
  assert.equal(readPackagePrice("0").error, "Paket fiyatı 0'dan büyük olmalı");
  assert.equal(readPackagePrice("0,001").error, "Paket fiyatı 0'dan büyük olmalı", "kuruşa yuvarlanınca 0");
  assert.equal(readPackagePrice("-5").error, "Paket fiyatı 0'dan büyük olmalı");
  assert.equal(readPackagePrice("on beş").error, "Paket fiyatını sayıyla yazın");
  assert.equal(readPackagePrice("%5").error, "Paket fiyatını sayıyla yazın", "yüzde tutar değil");
  assert.deepEqual(readPackagePrice(String(COUNT_ITEM_PRICE_MAX)), { value: COUNT_ITEM_PRICE_MAX, error: null });
  assert.equal(readPackagePrice("1.000.001").error, "Paket fiyatı çok büyük");
  // Sunucu aynı sınırları uygular (kuruşa yuvarladıktan sonra 0'dan büyük, sınırın altında; yazılmadıysa null)
  const core = read(CORE);
  assert.match(core, /\.transform\(\(v\) => Math\.round\(v \* 100\) \/ 100\)\s+\.pipe\(z\.number\(\)\.positive\("Paket fiyatı 0'dan büyük olmalı"\)\.max\(COUNT_ITEM_PRICE_MAX, "Paket fiyatı çok büyük"\)\)/);
  assert.match(core, /packagePrice: zPackagePrice\.nullish\(\)\.transform\(\(v\) => v \?\? null\),/);
});

test("ay kuralı: personel bu ayın (ilk 10 günde geçen ayın da) sayımına (reçete önerisinden de) kalem ekler; yönetici her aya", () => {
  const early = new Date("2026-10-05T09:00:00Z");
  const late = new Date("2026-10-25T09:00:00Z");
  assert.equal(staffCountIssue("staff", "2026-10", early), null);
  assert.equal(staffCountIssue("staff", "2026-09", early), null);
  assert.equal(staffCountIssue("staff", "2026-09", late), STAFF_LATE_FIX_MESSAGE);
  assert.equal(staffCountIssue("staff", "2026-08", early), STAFF_OLD_MONTH_MESSAGE);
  assert.equal(staffCountIssue("staff", "2026-11", early), STAFF_OLD_MONTH_MESSAGE);
  assert.equal(staffCountIssue("admin", "2025-01", late), null);
  // Reçete önerisi kalemi sayım sayfasının açtığı aya yazar (bu ay ya da ay başında geçen ay): kural her zaman geçer
  const page = read("src/app/panel/receteler/page.tsx");
  assert.match(page, /const countMonth = defaultCountMonth\(new Date\(\), \(m\) => countComplete\(model\.stockSheet\(m\)\)\);/);
  assert.match(read("src/app/panel/receteler/ingredient-picker.tsx"), /addProposalIngredient\(\{ month: newIngredient\.month, \.\.\.values \}\)/);
});

test("kalemin notu: kim, ne zaman, nereden; paket fiyatını kimin yazdığı (plan metni)", () => {
  assert.equal(countItemNote("Ayşe", "23.10.2026"), "Sayım listesine Ayşe ekledi (23.10.2026).");
  assert.equal(
    countItemNote("Ayşe", "23.10.2026", { pricedBy: "staff" }),
    "Sayım listesine Ayşe ekledi (23.10.2026); paket fiyatını personel KDV dahil yazdı, KDV düşülüp kaydedildi.",
  );
  assert.equal(countItemNote("Yönetici", "23.10.2026", { pricedBy: "admin" }), "Sayım listesine Yönetici ekledi (23.10.2026); paket fiyatını yönetici yazdı.");
  assert.equal(
    countItemNote("Ayşe", "23.10.2026", { pricedBy: "staff", source: "recete" }),
    "Sayım listesine Ayşe ekledi (23.10.2026, reçete önerisinden); paket fiyatını personel KDV dahil yazdı, KDV düşülüp kaydedildi.",
  );
  assert.equal(countItemNote("Ayşe", "23.10.2026", { source: "recete" }), "Sayım listesine Ayşe ekledi (23.10.2026, reçete önerisinden).");
  // Çekirdek notu yazanın rolüyle kurar (paket fiyatı yazılmadıysa fiyat cümlesi yok)
  assert.match(fnBody(CORE, "createCountItem"), /countItemNote\(me\.name, dateTR\(todayTR\(\)\), \{ pricedBy: data\.packagePrice !== null \? me\.role : null, source \}\)/);
});

test("ortak çekirdeğin yazdığı kalem: grup varsayılanları, birim, sıra, ay; fiyat isteğe bağlı ve Tahmini", () => {
  const rows = [
    { countGroup: "SOS", category: "Sos & Şurup", vatRate: 0.01, active: true, sortOrder: 12 },
    { countGroup: "SOS", category: "Sos & Şurup", vatRate: 0.01, active: true, sortOrder: 40 },
    { countGroup: "AMBALAJ", category: "Ambalaj", vatRate: 0.2, active: true, sortOrder: 7 },
  ];
  const draft = { name: "Çilek şurubu", group: "SOS", countUnit: "LT" as const, packageDesc: "Şurup 750 ml", packageSize: 750, packagePrice: 760 };
  assert.deepEqual(newCountItemValues(draft, rows, "2026-10", "Sayım listesine Ayşe ekledi (23.10.2026); paket fiyatını personel yazdı."), {
    name: "Çilek şurubu",
    category: "Sos & Şurup",
    supplier: null,
    packageDesc: "Şurup 750 ml",
    packagePrice: 760,
    packageSize: 750,
    unit: "ml",
    vatRate: 0.01,
    note: "Sayım listesine Ayşe ekledi (23.10.2026); paket fiyatını personel yazdı.",
    isEstimate: true,
    priceSource: "manual",
    countUnit: "LT",
    countGroup: "SOS",
    countFrom: "2026-10",
    sortOrder: 41,
    active: true,
  });
  const unpriced = newCountItemValues({ ...draft, group: "AMBALAJ", countUnit: "ADET", packageSize: 1000, packagePrice: null }, rows, "2026-09", "not");
  assert.deepEqual(
    { price: unpriced.packagePrice, unit: unpriced.unit, category: unpriced.category, vat: unpriced.vatRate, from: unpriced.countFrom, estimate: unpriced.isEstimate },
    { price: 0, unit: "adet", category: "Ambalaj", vat: 0.2, from: "2026-09", estimate: true },
  );
  // Fiyatı 0 açılan kalem zilde "Fiyatı girilmemiş" sayılır; yazılan fiyatla açılan sayılmaz (Hammaddeler › Tahmini'de)
  assert.equal(isUnpriced(unpriced), true);
  assert.equal(isUnpriced(newCountItemValues(draft, rows, "2026-10", "not")), false);
});

test("personelin yazdığı paket fiyatı KDV dahildir: grubun oranıyla düşülür; yöneticininki KDV hariç kalır", () => {
  assert.equal(netPackagePrice(120, 0.2, true), 100);
  assert.equal(netPackagePrice(1080, 0.1, true), 981.82);
  assert.equal(netPackagePrice(120, 0.2, false), 120);
  assert.equal(netPackagePrice(null, 0.2, true), 0);
  // Oranı 0 ya da bilinmeyen grupta olduğu gibi
  assert.equal(netPackagePrice(50, 0, true), 50);
  const rows = [{ countGroup: "AMBALAJ", category: "Ambalaj", vatRate: 0.2, active: true, sortOrder: 7 }];
  const draft = { name: "Klips kapak", group: "AMBALAJ", countUnit: "ADET" as const, packageDesc: null, packageSize: 1000, packagePrice: 1200 };
  assert.equal(newCountItemValues(draft, rows, "2026-10", "not", { priceIncludesVat: true }).packagePrice, 1000);
  assert.equal(newCountItemValues(draft, rows, "2026-10", "not").packagePrice, 1200);
  // Çekirdek personelin fiyatını KDV dahil sayar, yöneticininkini saymaz
  assert.match(fnBody(CORE, "createCountItem"), /newCountItemValues\(data, rows, from, note, \{ priceIncludesVat: me\.role !== "admin" \}\)/);
  // İpuçları hangi fiyatın yazılacağını söyler
  assert.match(read("src/app/panel/sayim/add-item.tsx"), /Fişteki gibi KDV dahil yazın/);
  assert.match(read("src/app/panel/sayim/add-item.tsx"), /KDV hariç yazın/);
  assert.match(read("src/app/panel/receteler/ingredient-picker.tsx"), /Fişteki gibi KDV dahil yazın/);
});

test("aynı ad denetimi Türkçe harfleri de sadeleştirir: \"cilek surubu\" listedeki \"Çilek şurubu\"dur", () => {
  assert.equal(looseKey("cilek  surubu"), looseKey("Çilek Şurubu"));
  assert.equal(looseKey("KÖFTE ÇÖREĞİ"), "kofte coregi");
  const existing = [
    { name: "Çilek şurubu", active: true, countUnit: "LT", countFrom: null },
    { name: "Süt", active: true, countUnit: "LT", countFrom: "2026-11" },
  ];
  assert.deepEqual(findDuplicate("cilek surubu", existing), { kind: "counted", name: "Çilek şurubu" });
  assert.equal(laterCountItem("sut", existing, "2026-10")?.name, "Süt");
  // Farklı ad farklı kalemdir
  assert.equal(findDuplicate("cilek pure", existing), null);
});

test("işlem geçmişi satırı: grup, birim, yazılan paket fiyatı; reçete önerisinden; zaten vardıysa ay", () => {
  const base = { name: "Çilek şurubu", group: "SOS / ŞURUP / PÜRE", countUnit: "LT", existed: false, from: "2026-10", packagePrice: null };
  assert.equal(countItemLogDetail(base), "Çilek şurubu · SOS / ŞURUP / PÜRE · LT");
  // Tutarla ₺ arasında bölünmez boşluk (money)
  assert.equal(countItemLogDetail({ ...base, packagePrice: 760 }), "Çilek şurubu · SOS / ŞURUP / PÜRE · LT · paket fiyatı 760\u00a0₺ (tahmini)");
  assert.equal(
    countItemLogDetail({ ...base, packagePrice: 12.5, source: "recete" }),
    "Çilek şurubu · SOS / ŞURUP / PÜRE · LT · paket fiyatı 12,50\u00a0₺ (tahmini) · reçete önerisinden",
  );
  assert.equal(countItemLogDetail({ ...base, existed: true, from: "2026-09" }), "Çilek şurubu · Eylül 2026 sayımından itibaren");
});

test("aynı ad: çekirdek kaydı bulur; reçete önerisi aktif olanı seçtirir, pasifte metni gösterir", () => {
  const core = fnBody(CORE, "createCountItem");
  assert.match(core, /throw new CountItemExists\(duplicateMessage\(dup, me\.role\), \{/);
  const recipe = fnBody("src/server/actions/recipe-requests.ts", "addProposalIngredient");
  assert.match(recipe, /if \(e instanceof CountItemExists && e\.existing\.active && e\.existing\.id > 0\) return \{ ingredient: ref\(e\.existing\), existing: true as const \};/);
  assert.match(recipe, /throw e;/);
  // Dönen malzemede fiyat yok: personel yazdığı fiyatı bir daha görmez
  const ref = recipe.slice(recipe.indexOf("const ref = "), recipe.indexOf("try {"));
  assert.doesNotMatch(ref, /price|cost/i);
  // Sayımın eylemi metni olduğu gibi gösterir (CountItemExists bir UserError)
  assert.match(read(CORE), /export class CountItemExists extends UserError/);
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

test("Listeye fiyatıyla eklenen kalem: sonraki zam kapanmış ayın devreden malını ve kârını değiştirmez; ilk gerçek fiyat zam sayılmaz", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
  const id = Math.max(...base.ingredients.map((i) => i.id)) + 1;
  const item = {
    ...base.ingredients.find((i) => i.name === "Toffeenut şurubu")!,
    id,
    name: "Çilek şurubu",
    packagePrice: 100,
    packageSize: 750,
    isEstimate: true,
    priceSource: "manual" as const,
    countFrom: "2026-09",
    sortOrder: 2000,
  };
  const stockCounts = [...base.stockCounts, { month: "2026-09", ingredientId: id, qty: 3, factor: 1000 }];
  // Eylül'de 100 ₺'yle listeye eklendi (başlangıç satırı), 10 Ekim'de fatura 130 ₺ getirdi
  const start = { ...countItemPriceRow(id, item, "Personel")!, changedAt: "2026-09-20T09:00:00.000Z" };
  const raise: PriceHistoryRow = { ingredientId: id, packagePrice: 130, packageSize: 750, changedAt: "2026-10-10T09:00:00.000Z", changedBy: "Yönetici", note: null };
  const before = createModel({ ...base, ingredients: [...base.ingredients, item], stockCounts, ingredientPrices: [start] });
  const after = createModel({ ...base, ingredients: [...base.ingredients, { ...item, packagePrice: 130 }], stockCounts, ingredientPrices: [start, raise] });
  assert.equal(after.pnlMonth("2026-09").closing, before.pnlMonth("2026-09").closing, "Eylül'ün devreden malı aynı");
  assert.equal(after.pnlMonth("2026-09").profit, before.pnlMonth("2026-09").profit, "Eylül'ün kârı aynı");
  assert.equal(after.unitCostAtMonthEnd(id, "2026-09") * 750, 100, "Eylül eklenirken yazılan fiyatla");
  assert.equal(after.unitCostAtMonthEnd(id, "2026-10") * 750, 130, "Ekim yeni fiyatla");
  // Başlangıç satırı zam uyarısının tabanı değil: ilk gerçek fiyat (130) zam görünmez
  const ings = [{ ...item, packagePrice: 130, active: true }];
  assert.equal(ingredientChanges(ings, [start, raise], "2026-09-01T00:00:00.000Z").length, 0, "ikisi de pencerede");
  assert.equal(ingredientChanges(ings, [start, raise], "2026-09-25T00:00:00.000Z").length, 0, "başlangıç pencereden önce");
  // Sonraki gerçek değişiklik zamdır
  const later = ingredientChanges([{ ...ings[0], packagePrice: 150 }], [start, raise, { ...raise, packagePrice: 150, changedAt: "2026-10-20T09:00:00.000Z" }], "2026-10-01T00:00:00.000Z");
  assert.equal(later.length, 1);
  assert.ok(Math.abs(later[0].pct - (150 / 130 - 1)) < 1e-9);
  // Fiyatsız kalem satır yazmaz (ilk gerçek fiyatı önceki ayları da değerler)
  assert.equal(countItemPriceRow(id, { packagePrice: 0, packageSize: 750 }, "Personel"), null);
  assert.equal(start.note, COUNT_ITEM_PRICE_NOTE);
  assert.notEqual(COUNT_ITEM_PRICE_NOTE, "Sayım listesine eklendi (tahmini fiyat)", "sekiz kalemin migration satırları zam tabanı kalır");
});

test("eylem ve yazım yolları: Listeye ekle yalnız yazılan fiyatı başlangıç olarak yazar; ilk elle / Paraşüt fiyatı geçmişe tek satır yazar", () => {
  const actions = read("src/app/panel/sayim/actions.ts");
  const add = actions.slice(actions.indexOf("export async function addCountItem"));
  assert.doesNotMatch(add, /ingredientPrices/);
  // Ortak çekirdek kalemi açtığı işlemde yazılan fiyatı geçmişin başlangıcı yazar (fiyatsız kalem yazmaz); reçete
  // önerisinin eylemi kendisi yazmaz
  const core = fnBody(CORE, "createCountItem");
  const insert = core.indexOf(".insert(s.ingredients)");
  const start = core.search(/const start = countItemPriceRow\(row\.id, values, me\.name\);\s+if \(start\) await tx\.insert\(s\.ingredientPrices\)\.values\(start\);/);
  assert.ok(insert > 0 && start > insert, "başlangıç satırı kalemden sonra, aynı işlemde");
  assert.doesNotMatch(fnBody("src/server/actions/recipe-requests.ts", "addProposalIngredient"), /ingredientPrices|\.insert\(s\.ingredients\)/);
  assert.doesNotMatch(add, /\.insert\(s\.ingredients\)/, "kalemi yalnız çekirdek açar");
  const values = (packagePrice: number | null) =>
    newCountItemValues({ name: "Çilek şurubu", group: "SOS", countUnit: "LT", packageDesc: null, packageSize: 750, packagePrice }, [], "2026-10", "not");
  assert.equal(values(null).packagePrice, 0);
  assert.equal(values(null).isEstimate, true);
  assert.equal(values(null).priceSource, "manual");
  assert.equal(values(760).packagePrice, 760);
  assert.equal(values(760).isEstimate, true, "yazılan fiyat da tahmin");
  assert.equal(values(760).priceSource, "manual");
  // Zam hesabı 0'lık başlangıcı atlar: price-impact.ts'teki koruma
  assert.match(read("src/lib/calc/price-impact.ts"), /if \(!\(before > 0\) \|\| !\(after > 0\)\) continue;/);
  // Bütün zam okuyucuları aynı hesaptan (ingredientChanges): zil, Genel bakış, sabah e-postası, Ürünler, Hammaddeler
  for (const f of ["src/server/actions/notifications.ts", "src/app/panel/page.tsx", "src/server/notify/digest.ts", "src/app/panel/urunler/page.tsx"]) {
    assert.match(read(f), /loadPriceAlerts\(/, f);
  }
  assert.match(read("src/server/data/price-alerts.ts"), /ingredientChanges\(/);
  assert.match(read("src/app/panel/hammaddeler/page.tsx"), /ingredientChanges\(/);
});

test("tahmin düzeltilince: kalem hâlâ Tahmini ve geçmişinde yalnız başlangıç varken düzeltme başlangıcın yerine geçer, kapanmış ay da düzelir", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const base: Dataset = { ...excelToDataset(data), currentMonth: "2026-10" };
  const id = Math.max(...base.ingredients.map((i) => i.id)) + 1;
  const item = {
    ...base.ingredients.find((i) => i.name === "Toffeenut şurubu")!,
    id,
    name: "Çilek şurubu",
    packagePrice: 76,
    packageSize: 750,
    isEstimate: true,
    priceSource: "manual" as const,
    countFrom: "2026-09",
    sortOrder: 2000,
  };
  const stockCounts = [...base.stockCounts, { month: "2026-09", ingredientId: id, qty: 3, factor: 1000 }];
  // Personel 2 Ekim'de Eylül sayımına ekledi, 76 yazdı (760 olacaktı); yönetici 5 Ekim'de Hammaddeler'den 760'a düzeltti
  const start = { ...countItemPriceRow(id, item, "Personel")!, changedAt: "2026-10-02T09:00:00.000Z" };
  assert.equal(correctsCountItemStart(true, [start]), true);
  const fixed = { ...start, ...correctedCountItemStart({ packagePrice: 760, packageSize: 750 }, "Yönetici") };
  assert.deepEqual([fixed.changedAt, fixed.packagePrice, fixed.changedBy, fixed.note], ["2026-10-02T09:00:00.000Z", 760, "Yönetici", COUNT_ITEM_PRICE_FIXED_NOTE], "anı kalır");
  const ing = { ...item, packagePrice: 760, isEstimate: false };
  /** Ay sonundaki paket fiyatı, kuruşa yuvarlı */
  const pkg = (m: ReturnType<typeof createModel>, month: string) => Math.round(m.unitCostAtMonthEnd(id, month) * 750 * 100) / 100;
  const corrected = createModel({ ...base, ingredients: [...base.ingredients, ing], stockCounts, ingredientPrices: [fixed] });
  const noHistory = createModel({ ...base, ingredients: [...base.ingredients, ing], stockCounts, ingredientPrices: [] });
  assert.equal(pkg(corrected, "2026-09"), 760, "Eylül düzeltilmiş fiyatla");
  assert.equal(corrected.pnlMonth("2026-09").closing, noHistory.pnlMonth("2026-09").closing);
  assert.equal(corrected.pnlMonth("2026-09").profit, noHistory.pnlMonth("2026-09").profit);
  // Düzeltme yeni satır olsaydı Eylül tahminde donardı (devreden 3.040 yerine 304 ₺)
  const appended = createModel({ ...base, ingredients: [...base.ingredients, ing], stockCounts, ingredientPrices: [start, { ingredientId: id, packagePrice: 760, packageSize: 750, changedAt: "2026-10-05T09:00:00.000Z" }] });
  assert.equal(pkg(appended, "2026-09"), 76);
  // Doğrulanmış kalemde sonraki fiyat zamdır (B2): yeni satır, Eylül düzeltilmiş fiyatta kalır
  assert.equal(correctsCountItemStart(false, [fixed]), false);
  const raise: PriceHistoryRow = { ingredientId: id, packagePrice: 800, packageSize: 750, changedAt: "2026-10-20T09:00:00.000Z", changedBy: "Paraşüt", note: null };
  const raised = createModel({ ...base, ingredients: [...base.ingredients, { ...ing, packagePrice: 800 }], stockCounts, ingredientPrices: [fixed, raise] });
  assert.equal(pkg(raised, "2026-09"), 760);
  assert.equal(raised.pnlMonth("2026-09").profit, corrected.pnlMonth("2026-09").profit);
  // Düzeltilen başlangıç zam tabanıdır (doğrulanmış fiyat): sonraki zam görünür; düzeltilmemiş başlangıç taban değil
  const changes = ingredientChanges([{ ...ing, packagePrice: 800, active: true }], [fixed, raise], "2026-10-15T00:00:00.000Z");
  assert.equal(changes.length, 1);
  assert.ok(Math.abs(changes[0].pct - (800 / 760 - 1)) < 1e-9);
  assert.equal(ingredientChanges([{ ...ing, active: true }], [fixed], "2026-10-01T00:00:00.000Z").length, 0, "düzeltme zam değil");
  // Kalem hâlâ Tahmini (işaret kaldırılmadan düzeltildi): ikinci düzeltme de yerinde
  assert.equal(correctsCountItemStart(true, [fixed]), true);
  // Yalnız başlangıç satırı varken: başka satır, Hammaddeler'in "İlk kayıt"ı, sekiz kalemin migration satırı ya da boş geçmiş yeni satır alır
  assert.equal(correctsCountItemStart(true, [start, raise]), false);
  assert.equal(correctsCountItemStart(true, [{ note: "İlk kayıt" }]), false);
  assert.equal(correctsCountItemStart(true, [{ note: "Sayım listesine eklendi (tahmini fiyat)" }]), false);
  assert.equal(correctsCountItemStart(true, []), false);
  assert.notEqual(COUNT_ITEM_PRICE_FIXED_NOTE, COUNT_ITEM_PRICE_NOTE);
});

test("Hammaddeler'in fiyat yazımı tahmini düzeltir; Paraşüt faturası tarihli fiyattır (yeni satır, kapanmış aya dokunmaz)", () => {
  const ACTIONS = "src/server/actions/ingredients.ts";
  const save = fnBody(ACTIONS, "saveIngredient");
  assert.match(save, /await recordIngredientPrice\(tx, \{ id: data\.id, isEstimate: before\.isEstimate \}, \{ packagePrice: rest\.packagePrice, packageSize: rest\.packageSize, changedBy: me\.name \}\)/);
  assert.equal(save.match(/insert\(s\.ingredientPrices\)/g)?.length, 1, "yalnız yeni hammaddenin İlk kayıt satırı");
  const quick = fnBody(ACTIONS, "updateIngredientPrice");
  assert.match(quick, /recordIngredientPrice\(tx, \{ id, isEstimate: before\.isEstimate \}, \{ packagePrice: price, packageSize: before\.packageSize, changedBy: me\.name \}\)/);
  assert.doesNotMatch(quick, /insert\(s\.ingredientPrices\)/);
  for (const f of ["src/server/parasut/sync.ts", "src/server/actions/price-holds.ts"]) assert.doesNotMatch(read(f), /recordIngredientPrice/, f);
  const helper = read("src/server/data/ingredient-prices.ts");
  assert.match(helper, /^import "server-only";/);
  assert.match(helper, /correctsCountItemStart\(ing\.isEstimate, history\)/);
});

test("tahminin düzeltmesi veritabanında: başlangıç satırı yerinde düzelir (anı kalır); doğrulanmışta, ikinci satırdan sonra ve İlk kayıt'ta yeni satır", { skip: process.env.EKLE_TEST_DATABASE_URL ? false : "EKLE_TEST_DATABASE_URL yok" }, async () => {
  process.env.DATABASE_URL = process.env.EKLE_TEST_DATABASE_URL;
  // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test modülü doğrudan çalıştırır
  const require = createRequire(import.meta.url);
  const marker = require.resolve("server-only");
  require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
  const { recordIngredientPrice } = await import("../src/server/data/ingredient-prices");
  const { getDb, schema: s } = await import("../src/server/db");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const ROLLBACK = new Error("geri al");
  type Row = { packagePrice: number; packageSize: number; note: string | null; changedBy: string | null; changedAt: Date };
  let r: Record<string, { results: string[]; rows: Row[] }> | null = null;
  const at = new Date("2026-10-02T09:00:00.000Z");
  try {
    await db
      .transaction(async (tx) => {
        const add = async (name: string, isEstimate: boolean, notes: string[]) => {
          const [ing] = await tx
            .insert(s.ingredients)
            .values({ name, category: "Sos & Şurup", unit: "ml", packagePrice: 76, packageSize: 1000, priceSource: "manual", countUnit: "LT", countGroup: "SOS / ŞURUP / PÜRE", countFrom: "2026-09", isEstimate })
            .returning({ id: s.ingredients.id });
          for (const note of notes) await tx.insert(s.ingredientPrices).values({ ingredientId: ing.id, packagePrice: 76, packageSize: 1000, changedBy: "Personel", note, changedAt: at });
          return ing.id;
        };
        const cases = {
          tahmini: await add("Deneme tahmini", true, [COUNT_ITEM_PRICE_NOTE]),
          dogrulanmis: await add("Deneme doğrulanmış", false, [COUNT_ITEM_PRICE_NOTE]),
          ikiSatir: await add("Deneme iki satır", true, [COUNT_ITEM_PRICE_NOTE, "Paraşüt"]),
          ilkKayit: await add("Deneme ilk kayıt", true, ["İlk kayıt"]),
        };
        const out: Record<string, { results: string[]; rows: Row[] }> = {};
        for (const [key, id] of Object.entries(cases)) {
          const results = [
            await recordIngredientPrice(tx, { id, isEstimate: key !== "dogrulanmis" }, { packagePrice: 760, packageSize: 750, changedBy: "Yönetici" }),
            await recordIngredientPrice(tx, { id, isEstimate: key !== "dogrulanmis" }, { packagePrice: 770, packageSize: 750, changedBy: "Yönetici" }),
          ];
          const rows = await tx
            .select({ packagePrice: s.ingredientPrices.packagePrice, packageSize: s.ingredientPrices.packageSize, note: s.ingredientPrices.note, changedBy: s.ingredientPrices.changedBy, changedAt: s.ingredientPrices.changedAt })
            .from(s.ingredientPrices)
            .where(eq(s.ingredientPrices.ingredientId, id))
            .orderBy(s.ingredientPrices.id);
          out[key] = { results, rows };
        }
        r = out;
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
  } finally {
    await db.$client.end();
  }
  const res = r!;
  // Hâlâ Tahmini, yalnız başlangıç: iki düzeltme de yerinde; anı kalır, fiyat ve paket boyu düzelir
  assert.deepEqual(res.tahmini.results, ["start", "start"]);
  assert.deepEqual(
    res.tahmini.rows.map((x) => [x.packagePrice, x.packageSize, x.note, x.changedBy, x.changedAt.toISOString()]),
    [[770, 750, COUNT_ITEM_PRICE_FIXED_NOTE, "Yönetici", at.toISOString()]],
  );
  // Doğrulanmış kalem: zam, yeni satır; başlangıç olduğu gibi
  assert.deepEqual(res.dogrulanmis.results, ["added", "added"]);
  assert.deepEqual(res.dogrulanmis.rows.map((x) => [x.packagePrice, x.note]), [[76, COUNT_ITEM_PRICE_NOTE], [760, null], [770, null]]);
  assert.deepEqual(res.ikiSatir.results, ["added", "added"]);
  assert.equal(res.ikiSatir.rows[0].packagePrice, 76, "başlangıç değişmez");
  assert.deepEqual(res.ilkKayit.results, ["added", "added"]);
});

// ---------------------------------------------------------------- Yetki ve görünürlük

test("personel kalem ekler (bu ay ve geçen ay); paket fiyatını yalnız yazar, personel fiyat görmez", () => {
  const actions = read("src/app/panel/sayim/actions.ts");
  const add = actions.slice(actions.indexOf("export async function addCountItem"));
  assert.match(add, /const me = await requireUser\(\);/);
  assert.doesNotMatch(add, /requireAdmin/);
  // "Listede olmayanlar" da aynı ay kuralıyla (Listeye ekle'ninki aşağıda, ortak çekirdekte)
  assert.match(fnBody("src/app/panel/sayim/actions.ts", "saveStaffStockExtras"), /const monthIssue = staffCountIssue\(me\.role, m\);\s+if \(monthIssue\) throw new UserError\(monthIssue\);/);
  // Reçete önerisindeki "Yeni malzeme" de personelin; ay kuralı ve kilit ikisi için ortak çekirdekte
  const recipe = fnBody("src/server/actions/recipe-requests.ts", "addProposalIngredient");
  assert.match(recipe, /const me = await requireUser\(\);/);
  assert.doesNotMatch(recipe, /requireAdmin/);
  const core = fnBody(CORE, "createCountItem");
  assert.match(core, /const monthIssue = staffCountIssue\(me\.role, m\);\s+if \(monthIssue\) throw new UserError\(monthIssue\);/);
  assert.ok(core.indexOf("staffCountIssue(") < core.indexOf("getDb().transaction("), "ay kuralı yazmadan önce");
  assert.match(core, /pg_advisory_xact_lock\(hashtext\('sayim-listeye-ekle'\)\)/);
  assert.doesNotMatch(read(CORE), /"use server"/, "çekirdek dışarıdan çağrılan bir uç değil");
  assert.match(read(CORE), /^import "server-only";/);
  // Pencere paket fiyatını yalnız sorar (isteğe bağlı); kayıtlı fiyat ya da maliyet göstermez, sunucudan fiyat almaz
  const dialog = read("src/app/panel/sayim/add-item.tsx");
  for (const word of ["unitCost", "unitPrice", "Fiyat ", "tl(", "money("]) assert.ok(!dialog.includes(word), `${word} pencerede olmamalı`);
  assert.match(dialog, /label="Paket fiyatı \(₺, biliyorsanız\)"/);
  const groupType = dialog.slice(dialog.indexOf("export interface CountItemGroup"), dialog.indexOf("export interface CountItemValues"));
  assert.doesNotMatch(groupType, /price|cost/i, "grup seçeneklerinde fiyat yok");
  const dialogProps = dialog.slice(dialog.indexOf("export function AddCountItemDialog"), dialog.indexOf("const form = useCountItemForm({ groups, defaultGroup, initialName });"));
  // Açıklamalar dışında (kod): pencereye fiyat gelmez; dönüşte yalnız eklenen kalemin fiyatı yazıldı mı (priced)
  const code = dialogProps.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code.replace("priced: boolean", ""), /price|cost/i, "pencereye fiyat gelmez");
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
  const staffReturn = src.indexOf('if (user.role !== "admin") return [...cash, ...kontrol, ...mine, ...recipes, ...ops];');
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

// ---------------------------------------------------------------- Başlangıç satırı (migration)

const startMigration = readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_sayim_kalemi_fiyat_baslangici.sql"));

test("migration: fiyatıyla eklenmiş, geçmişi olmayan sayım kalemlerine başlangıç satırı; notu uygulamanınkiyle aynı", () => {
  assert.ok(startMigration, "sayim_kalemi_fiyat_baslangici migration'ı yok");
  const sql = read(`drizzle/${startMigration}`);
  assert.ok(sql.includes(`'${COUNT_ITEM_PRICE_NOTE}'`), "zam uyarısı satırı notundan tanır");
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM "ingredient_prices" p WHERE p\."ingredient_id" = i\."id"\)/, "geçmişi olan kaleme yazmaz (yeniden çalışırsa da)");
  assert.match(sql, /i\."package_price" > 0/, "fiyatsız kalem satır almaz");
  assert.match(sql, /i\."count_from" IS NOT NULL/, "yalnız sayım listesinden eklenen");
  assert.match(sql, /i\."price_source" = 'manual'/);
  assert.doesNotMatch(sql, /statement-breakpoint/);
});

test("migration veritabanında: fiyatı yazılmış ve geçmişi olmayan kaleme tek satır; fiyatsıza ve geçmişi olana yok; ikinci kez 0", { skip: process.env.EKLE_TEST_DATABASE_URL ? false : "EKLE_TEST_DATABASE_URL yok" }, async () => {
  const db = postgres(process.env.EKLE_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const migration = read(`drizzle/${startMigration}`);
  const ROLLBACK = new Error("geri al");
  let result: { first: { name: string; package_price: number; note: string; changed_by: string }[]; second: number; existing: number } | null = null;
  try {
    await db
      .begin(async (tx) => {
        // Bu veritabanı migrate edildiyse migration zaten çalıştı: eskiden eklenmiş kalemleri yeniden kurar
        const [{ id: before }] = await tx`select coalesce(max(id), 0) as id from ingredient_prices`;
        const add = (name: string, price: number) =>
          tx`insert into ingredients (name, category, unit, package_price, package_size, price_source, count_unit, count_group, count_from, is_estimate)
             values (${name}, 'Sos & Şurup', 'ml', ${price}, 750, 'manual', 'LT', 'SOS / ŞURUP / PÜRE', '2026-10', true) returning id`;
        const [a] = await add("Deneme fiyatlı (a)", 760);
        await add("Deneme fiyatsız (b)", 0);
        const [c] = await add("Deneme geçmişli (c)", 760);
        await tx`insert into ingredient_prices (ingredient_id, package_price, package_size, note, changed_by) values (${c.id}, 760, 750, 'İlk kayıt', 'Yönetici')`;
        await tx.unsafe(migration);
        const first = await tx<{ name: string; package_price: number; note: string; changed_by: string }[]>`
          select i.name, p.package_price, p.note, p.changed_by from ingredient_prices p join ingredients i on i.id = p.ingredient_id
          where p.id > ${before} and i.name like 'Deneme %' order by p.id`;
        const [{ n: existing }] = await tx`select count(*)::int as n from ingredient_prices where ingredient_id = ${c.id}`;
        const [{ id: mid }] = await tx`select coalesce(max(id), 0) as id from ingredient_prices`;
        await tx.unsafe(migration);
        const [{ n: second }] = await tx`select count(*)::int as n from ingredient_prices where id > ${mid}`;
        assert.ok(a.id);
        result = { first: [...first], second, existing };
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
  } finally {
    await db.end();
  }
  const r = result!;
  assert.deepEqual(
    r.first.map((x) => [x.name, x.note, x.changed_by]),
    [
      ["Deneme geçmişli (c)", "İlk kayıt", "Yönetici"],
      ["Deneme fiyatlı (a)", COUNT_ITEM_PRICE_NOTE, "Sistem"],
    ],
    "yalnız (a) satır aldı",
  );
  assert.equal(r.existing, 1, "geçmişi olan kaleme ikinci satır yazılmaz");
  assert.equal(r.second, 0, "ikinci kez çalışınca bir şey eklemez");
});
