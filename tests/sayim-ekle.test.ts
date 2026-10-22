// Stok sayımı › "Listeye ekle" (src/lib/count-item.ts, src/app/panel/sayim/actions.ts addCountItem) ve yedi yeni kalemin
// migration'ı (drizzle/*_sayim_yeni_kalemler.sql): Türkçe ad anahtarı ve aynı ad kuralı, sayım biriminden malzeme
// birimi, grubun varsayılanları, fiyatı 0 kalemin ilk fiyatının zam sayılmaması, personelin fiyat görmemesi.
// Migration'ın veritabanı denemesi EKLE_TEST_DATABASE_URL verilince çalışır (işlem geri alınır; migrate edilmiş bir
// yerel kopya verin, ör. postgres://postgres:postgres@localhost:5432/laffogato_ekle).
// Çalıştırma: npx tsx --test tests/sayim-ekle.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import postgres from "postgres";

import { countUnitsFor, createModel } from "../src/lib/calc/engine";
import { ingredientChanges, productImpacts, type PriceHistoryRow } from "../src/lib/calc/price-impact";
import type { CountUnit, Dataset } from "../src/lib/calc/types";
import { COUNT_UNITS } from "../src/lib/constants";
import {
  BASE_UNIT,
  cleanName,
  countGroupOptions,
  defaultPackageSize,
  duplicateMessage,
  findDuplicate,
  groupDefaults,
  isUnpriced,
  nameKey,
  nextSortOrder,
  unpricedNotice,
} from "../src/lib/count-item";
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

// ---------------------------------------------------------------- Yedi kalem (migration)

const migrationFile = readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_sayim_yeni_kalemler.sql"));
const SEVEN = ["Çilek şurubu", "Cookie şurubu", "Lemon tea şurubu", "Hazelnut şurubu", "Vanilya sos", "Yaban mersini püre", "Böğürtlen püre"];

test("migration: yedi kalem, korumalar, Excel usulü tahmin ve fiyat geçmişi", () => {
  assert.ok(migrationFile, "sayim_yeni_kalemler migration'ı yok");
  const sql = read(`drizzle/${migrationFile}`);
  for (const name of SEVEN) assert.match(sql, new RegExp(`\\('${name}', '`), name);
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM "ingredients"\)/, "boş veritabanına eklemez (db:seed Excel'i yükler)");
  assert.match(sql, /AND NOT EXISTS \(/);
  assert.match(sql, /'\(faturada yok\)'/);
  assert.match(sql, /'LT', 'SOS \/ ŞURUP \/ PÜRE'/);
  assert.match(sql, /"son"\."m" \+ y\."ord"/, "sıra en büyük sıradan sonra");
  assert.match(sql, /'Sayım listesine eklendi \(tahmini fiyat\)', 'Sistem'/);
  assert.match(sql, /HAVING count\(\*\) > 0/, "eklenmediyse işlem geçmişine yazmaz");
  // Tek ifade (tek kırılma noktasız blok): birleştirmede --custom ile yeniden üretilip aynen yapıştırılır
  assert.doesNotMatch(sql, /statement-breakpoint/);
});

/** Migration'daki SQL anahtarının JS karşılığı: translate + yalnız ASCII küçültme (C yerel ayarı) */
function sqlKey(name: string, from: string, to: string): string {
  const map = new Map([...from].map((c, i) => [c, [...to][i]]));
  const translated = [...name.trim().replace(/\s+/g, " ")].map((c) => map.get(c) ?? c).join("");
  return translated.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

test("migration'ın ad anahtarı uygulamanınkiyle aynı (Türkçe harfler, C yerel ayarında da)", () => {
  const sql = read(`drizzle/${migrationFile}`);
  const m = sql.match(/translate\(y\."name", '([^']+)', '([^']+)'\)/);
  assert.ok(m, "translate bulunamadı");
  const [, from, to] = m;
  for (const name of [...SEVEN, "ÇİLEK ŞURUBU", "Çilek  Şurubu ", "COOKIE ŞURUBU", "HAZELNUT ŞURUBU", "VANILYA SOS", "YABAN MERSİNİ PÜRE", "BÖĞÜRTLEN PÜRE", "Lemon Tea Şurubu"]) {
    assert.equal(sqlKey(name, from, to), nameKey(name), name);
  }
});

test("migration veritabanında: boşta 0, doluda 7 (her biri bir fiyat satırıyla), 'Çilek Şurubu' varsa 6", { skip: process.env.EKLE_TEST_DATABASE_URL ? false : "EKLE_TEST_DATABASE_URL yok" }, async () => {
  const db = postgres(process.env.EKLE_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const migration = read(`drizzle/${migrationFile}`);
  const ROLLBACK = new Error("geri al");
  /** Migration'ı işlemde çalıştırır, sonucu okur, hepsini geri alır */
  async function trial(prepare: (tx: postgres.TransactionSql) => Promise<unknown>) {
    let result: { added: number; prices: number; log: number } | null = null;
    await db
      .begin(async (tx) => {
        await prepare(tx);
        const before = await tx`select coalesce(max(id), 0) as id from ingredients`;
        const logBefore = await tx`select coalesce(max(id), 0) as id from activity_log`;
        await tx.unsafe(migration);
        const [{ added }] = await tx`select count(*)::int as added from ingredients where id > ${before[0].id}`;
        const [{ prices }] = await tx`select count(*)::int as prices from ingredient_prices p join ingredients i on i.id = p.ingredient_id where i.id > ${before[0].id} and p.note = 'Sayım listesine eklendi (tahmini fiyat)'`;
        const [{ log }] = await tx`select count(*)::int as log from activity_log where id > ${logBefore[0].id} and action = 'Sayım listesine eklendi'`;
        result = { added, prices, log };
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    return result!;
  }
  // Yedisi zaten eklenmişse (bu veritabanı migrate edildi) adları geçici olarak değiştirilir: silmek reçete ve sayım
  // bağlarına takılırdı; işlem sonunda hepsi geri alınır
  const hideSeven = (tx: postgres.TransactionSql) => tx`update ingredients set name = name || ' (deneme)' where name in ${tx(SEVEN)}`;
  try {
    const filled = await trial(hideSeven);
    assert.deepEqual(filled, { added: 7, prices: 7, log: 1 });
    // Aynı ad (Türkçe büyük harf, fazladan boşluk) varsa atlanır
    const six = await trial(async (tx) => {
      await hideSeven(tx);
      await tx`insert into ingredients (name, category, unit) values ('ÇİLEK  ŞURUBU', 'Sos & Şurup', 'ml')`;
    });
    assert.deepEqual(six, { added: 6, prices: 6, log: 1 });
    // Boş veritabanında hiçbir şey eklenmez ve işlem geçmişine yazılmaz
    const empty = await trial((tx) => tx`truncate ingredients cascade`);
    assert.deepEqual(empty, { added: 0, prices: 0, log: 0 });
    // Hepsi zaten varsa yine sessiz
    const again = await trial(async () => {});
    assert.equal(again.log, again.added ? 1 : 0);
  } finally {
    await db.end();
  }
});
