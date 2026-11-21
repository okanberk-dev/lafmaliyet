// Ekim 2026 ay sonu sayımı (drizzle/*_ekim_sayimi.sql): 31 Ekim 2026 kapanışındaki kâğıt sayımının panele işlenmesi;
// ardından ek kalemlerinin sayım listesine alınması (drizzle/*_ekim_kalemleri_listeye.sql: 22 kalem hammadde olur, Ekim
// miktarı ek kalemden kalemin sayımına taşınır) ve sahibinin 2 Kasım ekleri (drizzle/*_urun_ekleri.sql: çay demlik poşete
// geçer, meyveli granola bar ve Beypazarı Soda ürünleri)
// (kayıt ve sahibine sorulanlar: docs/sayimlar/2026-10.md). Saf denetimler her zaman çalışır: kâğıttaki her satır
// bilinen bir kaleme o kalemin sayım birimiyle gider, ek kalem listedeki bir adla çakışmaz, korumalar ve ad anahtarı
// yerinde, belge migration'la aynı rakamları söyler. Veritabanı denemesi SAYIM_TEST_DATABASE_URL (yoksa
// EKLE_TEST_DATABASE_URL) verilince çalışır: kendi geçici veritabanını açar, Excel verisini yükler, migration'ı geri
// alınan işlemlerde dener (59 kalem + 23 ek kalem, "Cooler base"in adı "Smoothie powder" olur; ikinci çalıştırma bir şey
// eklemez; panelden girilmiş sayımın ve ek kalemin üzerine yazmaz; adı değişmiş kalem ek kaleme, sayım listesinden
// çıkmış kalem "elle girilecek"e düşer). 0047–0049 şube kırılımından (0056) önce çalıştı: denemeler bugünkü şemada,
// o günkü sayım dizinini (ay, kalem) geri alınan işlemin içinde kurarak koşar (asBefore0056).
// Çalıştırma: SAYIM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/ekim-sayimi.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { countUnitsFor } from "../src/lib/calc/engine";
import type { CountUnit, Unit } from "../src/lib/calc/types";
import { BASE_UNIT, COUNT_ITEM_PRICE_NOTE, groupDefaults, looseKey } from "../src/lib/count-item";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const migrationFile = readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_ekim_sayimi.sql"));
const listFile = readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_ekim_kalemleri_listeye.sql"));
const extrasFile = readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_urun_ekleri.sql"));
/** 0048 ve 0049'un ad anahtarı: src/lib/count-item.ts looseKey'in SQL karşılığı (translate + yalnız ASCII küçültme) */
const LOOSE_FROM = "ÇĞİIÖŞÜıÂÎÛâîûçğöşü";
const LOOSE_TO = "cgiiosuiaiuaiucgosu";
/** 0048'in listeye almadığı tek ek kalem: adı okunamadı */
const UNNAMED = "Callei sos (adı okunamadı)";
const DOC = "docs/sayimlar/2026-10.md";

/** Sekiz kalem migration'ının (0023) adları ve sayım birimleri: Excel'de yok, canlıda var */
const EIGHT: Record<string, string> = {
  "Çilek şurubu": "LT",
  "Cookie şurubu": "LT",
  "Lemon tea şurubu": "LT",
  "Hazelnut şurubu": "LT",
  "Vanilya sos": "LT",
  "Yaban mersini püre": "LT",
  "Böğürtlen püre": "LT",
  "Klips kapak": "ADET",
};

interface Line {
  no: number;
  foto: number;
  raw: string;
  name: string;
  qty: number;
  unit: string;
  kind: "liste" | "koli" | "ek";
}

/** Migration'ın VALUES satırları: (no, foto, 'yazılan', 'kalem', miktar, 'birim', 'tür') */
function lines(sql: string): Line[] {
  const re = /^\s*\((\d+), (\d), '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+(?:\.\d+)?), '([^']+)', '(liste|koli|ek)'\),?$/gm;
  const unq = (s: string) => s.replace(/''/g, "'");
  return [...sql.matchAll(re)].map((m) => ({
    no: Number(m[1]),
    foto: Number(m[2]),
    raw: unq(m[3]),
    name: unq(m[4]),
    qty: Number(m[5]),
    unit: m[6],
    kind: m[7] as Line["kind"],
  }));
}

/** Kalem başına toplam (kuruş hatasız: binde bire yuvarlanır) */
function totals(rows: Line[]): Map<string, { qty: number; unit: string; kind: Line["kind"] }> {
  const out = new Map<string, { qty: number; unit: string; kind: Line["kind"] }>();
  for (const r of rows) {
    const t = out.get(r.name) ?? { qty: 0, unit: r.unit, kind: r.kind };
    t.qty = Math.round((t.qty + r.qty) * 1000) / 1000;
    out.set(r.name, t);
  }
  return out;
}

/** Belgedeki "2.100 ADET", "6,518 LT" yazımı */
function docNumber(text: string): number {
  return Number(text.replace(/\./g, "").replace(",", "."));
}

/** Migration'ın önce yeniden adlandırdığı kalem (sahibinin isteği): sayım yeni adla eşlenir */
const RENAMED: Record<string, string> = { "Smoothie powder": "Cooler base" };

const excel = excelToDataset(JSON.parse(read("src/server/db/seed/excel-data.json")) as ExcelData).ingredients;
const known = new Map<string, string | null>([...excel.map((i) => [i.name, i.countUnit] as const), ...Object.entries(EIGHT)]);
for (const [now, before] of Object.entries(RENAMED)) known.set(now, known.get(before) ?? null);

/** İki ifade: önce yeniden adlandırma, sonra sayım (drizzle'ın kırılma noktasıyla) */
const statements = (sql: string) => sql.split("--> statement-breakpoint").map((x) => x.trim());

test("migration: satırlar sırayla, dört fotoğraftan, miktar pozitif; iki ifade, yalnız Ekim 2026", () => {
  assert.ok(migrationFile, "ekim_sayimi migration'ı yok");
  const sql = read(`drizzle/${migrationFile}`);
  const rows = lines(sql);
  assert.equal(rows.length, 128, "kâğıttaki 128 satır");
  rows.forEach((r, i) => {
    assert.equal(r.no, i + 1, `${r.raw}: sıra`);
    assert.ok([1, 2, 3, 4].includes(r.foto), `${r.raw}: fotoğraf`);
    assert.ok(r.qty > 0, `${r.raw}: miktar`);
    assert.ok(["KG", "LT", "ADET", "DİLİM"].includes(r.unit), `${r.raw}: birim`);
  });
  // Bütün tarihler Ekim 2026; iki ifade: önce ad (yalnız Cooler base → Smoothie powder), sonra sayım
  assert.deepEqual([...new Set(sql.match(/'\d{4}-\d{2}'/g))], ["'2026-10'"]);
  const [rename, count] = statements(sql);
  assert.equal(statements(sql).length, 2);
  assert.match(rename, /UPDATE "ingredients" SET "name" = 'Smoothie powder'/);
  assert.match(rename, /= 'cooler base'/);
  assert.match(rename, /WHERE "id" = \(\s*SELECT c\."id" FROM "ingredients" c[\s\S]*?ORDER BY c\."active" DESC, c\."id"\s*LIMIT 1\s*\)/, "aynı anahtarla iki kalem olsa yalnız biri, sayımın eşlemesi gibi önce aktif");
  assert.match(rename, /= 'smoothie powder'\s*\)/, "bu adla kalem varsa dokunmaz");
  assert.match(rename, /'Hammadde güncellendi', 'Cooler base → Smoothie powder/);
  assert.doesNotMatch(rename.replace(/^--.*$/gm, ""), /stock_counts|stock_extras/, "ad parçası sayıma dokunmaz");
  assert.match(count, /^-- 2\) Sayım\nWITH "satir"/);
  for (const st of [rename, count]) assert.equal(st.match(/;\s*$/gm)?.length, 1, "her parça tek ifade");
});

test("migration: sayım satırı bilinen kaleme o kalemin sayım birimiyle gider; ek kalem listedeki bir adla çakışmaz", () => {
  const rows = lines(read(`drizzle/${migrationFile}`));
  for (const r of rows) {
    if (r.kind === "ek") {
      const twin = [...known.keys()].find((n) => looseKey(n) === looseKey(r.name));
      assert.equal(twin, undefined, `${r.name}: listede "${twin}" var, ek kalem olmaz`);
    } else {
      assert.ok(known.has(r.name), `${r.name}: Excel'de ve sekiz kalemde yok`);
      assert.equal(known.get(r.name), r.unit, `${r.name}: sayım birimi`);
    }
  }
  // Peçete kolisi paket içeriğiyle çarpılır (panelde 1 koli); başka koli satırı yok
  assert.deepEqual(
    rows.filter((r) => r.kind === "koli").map((r) => [r.name, r.qty]),
    [["Peçete", 18]],
  );
  assert.match(excel.find((i) => i.name === "Peçete")!.packageDesc ?? "", /koli/);
  const t = totals(rows);
  assert.equal([...t.values()].filter((x) => x.kind !== "ek").length, 59);
  assert.equal([...t.values()].filter((x) => x.kind === "ek").length, 23);
});

test("migration: korumalar ve ad anahtarı (drizzle/0023 ile aynı)", () => {
  const sql = read(`drizzle/${migrationFile}`);
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM "ingredients"\)/, "boş veritabanına yazmaz (db:seed Excel'i yükler)");
  assert.match(sql, /ON CONFLICT \("month", "ingredient_id"\) DO NOTHING/, "panelden girilen sayımın üzerine yazmaz");
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM "stock_extras" x\s*WHERE x\."month" = '2026-10'/, "aynı adlı ek kalemi yinelemez");
  assert.match(sql, /coalesce\(e\."package_desc", ''\) ILIKE '%koli%'/, "koli satırı yalnız koliyle satılan pakette çarpılır (paket boşsa yazılmaz, raporlanır)");
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM "yazilan"\) OR EXISTS \(SELECT 1 FROM "eklenen"\);\s*$/, "işlem geçmişine yalnız bir şey yazıldıysa");
  // Uygulamanın sayım kaydıyla aynı çarpan ve sayım listesi kuralı (isCountable)
  assert.match(sql, /CASE WHEN "count_unit" IN \('KG', 'LT'\) THEN 1000 ELSE 1 END/);
  assert.match(sql, /i\."count_unit" IS NOT NULL AND \(i\."active" OR EXISTS \(/);
  assert.match(sql, /'Sistem', 'Stok sayımı'/);
  // Ad anahtarı sekiz kalem migration'ınınkiyle aynı harfleri çevirir
  const eight = read(`drizzle/${readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_sayim_yeni_kalemler.sql"))}`);
  const [, from, to] = eight.match(/translate\(y\."name", '([^']+)', '([^']+)'\)/)!;
  assert.ok(sql.includes(`translate(regexp_replace(btrim(x."name"), '\\s+', ' ', 'g'), '${from}', '${to}')`));
  assert.ok(sql.includes(`translate(s."kalem", '${from}', '${to}')`));
});

test("sayımın ON CONFLICT hedefi 0056'dan önceki dizin: 0056 dizini şubeyle yeniden kurar (veritabanı denemesi o günkü dizinle)", () => {
  const drizzle = readdirSync(join(process.cwd(), "drizzle"));
  const branchFile = drizzle.find((f) => f.endsWith("_sube_kirilimi.sql"));
  assert.ok(branchFile, "sube_kirilimi migration'ı yok");
  const branch = read(`drizzle/${branchFile}`);
  assert.match(branch, /DROP INDEX "stock_counts_month_ingredient_uq";/);
  assert.match(branch, /CREATE UNIQUE INDEX "stock_counts_month_ingredient_uq" ON "stock_counts" USING btree \("month","branch_id","ingredient_id"\);/);
  for (const f of [migrationFile!, listFile!, extrasFile!]) {
    assert.ok(f < branchFile, `${f} 0056'dan önce çalışır`);
    assert.match(read(`drizzle/${f}`), /ON CONFLICT \("month", "ingredient_id"\) DO NOTHING/, f);
  }
});

test("belge migration'la aynı rakamları söyler (59 kalem, 23 ek kalem)", () => {
  const doc = read(DOC);
  const t = totals(lines(read(`drizzle/${migrationFile}`)));
  // Sayım listesi tablosu: | Grup | Kalem | Sayım | Kâğıtta |
  const listed = [...doc.matchAll(/^\| [A-ZÇĞİÖŞÜ&/ ()a-zşı]+ \| ([^|]+) \| ([^|]+) \| [^|]+ \|$/gm)]
    .map((m) => [m[1].trim(), m[2].trim()] as const)
    .filter(([name]) => t.has(name) && t.get(name)!.kind !== "ek");
  // Her kalem tam bir kez: eksik ya da yinelenen satır olmaz
  assert.deepEqual(
    listed.map(([name]) => name).sort(),
    [...t].filter(([, x]) => x.kind !== "ek").map(([name]) => name).sort(),
  );
  for (const [name, text] of listed) {
    const x = t.get(name)!;
    if (x.kind === "koli") {
      assert.match(text, new RegExp(`^${x.qty} koli × koli içeriği`), name);
      continue;
    }
    const m = text.match(/^([\d.,]+) (KG|LT|ADET|DİLİM)$/);
    assert.ok(m, `${name}: "${text}"`);
    assert.equal(docNumber(m![1]), x.qty, `${name}: miktar`);
    assert.equal(m![2], x.unit, `${name}: birim`);
  }
  // Ek kalem tablosu: | Ek kalem | Sayım | Kâğıtta |
  const extras = [...doc.matchAll(/^\| ([^|]+) \| ([\d.,]+) (KG|LT|ADET|DİLİM) \| [^|]+ \|$/gm)]
    .map((m) => ({ name: m[1].trim(), qty: docNumber(m[2]), unit: m[3] }))
    .filter((e) => t.get(e.name)?.kind === "ek");
  assert.deepEqual(
    extras,
    [...t.entries()].filter(([, x]) => x.kind === "ek").map(([name, x]) => ({ name, qty: x.qty, unit: x.unit })),
  );
});

// ---------------------------------------------------------------- Ek kalemler sayım listesine (0048)

interface NewItem {
  ord: number;
  name: string;
  /** 0047'deki ek kalem adı (Beypazarı'da farklı: "Beypazarı maden suyu" → "Beypazarı soda") */
  extraName: string;
  group: string;
  category: string;
  unit: string;
  countUnit: string;
  packageDesc: string | null;
  packageSize: number;
  vat: number;
}

/** 0048'in VALUES satırları: (sıra, 'ad', 'ek adı', 'grup', 'kategori', 'birim', 'sayım birimi', 'paket' | NULL, içerik, kdv) */
function newItems(sql: string): NewItem[] {
  const re = /^\s*\((\d+), '((?:[^']|'')*)', '((?:[^']|'')*)', '([^']+)', '([^']+)', '(gr|ml|adet|dilim)', '(KG|LT|ADET|DİLİM)', (NULL|'(?:[^']|'')*'), (\d+), ([\d.]+)\),?$/gm;
  const unq = (x: string) => x.replace(/''/g, "'");
  return [...sql.matchAll(re)].map((m) => ({
    ord: Number(m[1]),
    name: unq(m[2]),
    extraName: unq(m[3]),
    group: m[4],
    category: m[5],
    unit: m[6],
    countUnit: m[7],
    packageDesc: m[8] === "NULL" ? null : unq(m[8].slice(1, -1)),
    packageSize: Number(m[9]),
    vat: Number(m[10]),
  }));
}

test("ek kalemler listeye: 0047'nin 22 ek kalemi aynı sırayla ve birimle; adı okunamayan Callei hariç", () => {
  assert.ok(listFile, "ekim_kalemleri_listeye migration'ı yok");
  const items = newItems(read(`drizzle/${listFile}`));
  const extras = [...totals(lines(read(`drizzle/${migrationFile}`)))].filter(([, x]) => x.kind === "ek");
  assert.equal(items.length, 22);
  assert.deepEqual(
    items.map((i) => [i.extraName, i.countUnit]),
    extras.filter(([name]) => name !== UNNAMED).map(([name, x]) => [name, x.unit]),
  );
  items.forEach((i, k) => assert.equal(i.ord, k + 1, `${i.name}: sıra`));
  // Yalnız Beypazarı sahibinin dediği adla açılır
  assert.deepEqual(
    items.filter((i) => i.name !== i.extraName).map((i) => [i.extraName, i.name]),
    [["Beypazarı maden suyu", "Beypazarı soda"]],
  );
});

test("ek kalemler listeye: Listeye ekle kuralı (birim, grubun kategorisi ve KDV'si), listedeki bir adla çakışmaz", () => {
  for (const i of newItems(read(`drizzle/${listFile}`))) {
    assert.equal(BASE_UNIT[i.countUnit as CountUnit], i.unit, `${i.name}: birim`);
    assert.ok(countUnitsFor(i.unit as Unit).includes(i.countUnit as CountUnit), `${i.name}: sayım birimi`);
    assert.ok(excel.some((x) => x.countGroup === i.group), `${i.name}: ${i.group} grubu yok`);
    assert.deepEqual({ category: i.category, vatRate: i.vat }, groupDefaults(excel, i.group), `${i.name}: grubun kategorisi ve KDV'si`);
    assert.ok(i.packageSize > 0, `${i.name}: paket içeriği`);
    if (i.countUnit === "ADET" || i.countUnit === "DİLİM") assert.equal(i.packageSize, 1, `${i.name}: tek adet / dilim`);
    for (const n of [i.name, i.extraName]) {
      const twin = [...known.keys()].find((k) => looseKey(k) === looseKey(n));
      assert.equal(twin, undefined, `${n}: listede "${twin}" var`);
    }
  }
});

test("ek kalemler listeye: korumalar, Listeye ekle'nin fiyat satırı, tek ifade", () => {
  const sql = read(`drizzle/${listFile}`);
  assert.doesNotMatch(sql, /statement-breakpoint/);
  assert.equal(sql.replace(/^--.*$/gm, "").match(/;\s*$/gm)?.length, 1, "tek ifade");
  assert.deepEqual([...new Set(sql.match(/'\d{4}-\d{2}'/g))], ["'2026-10'"]);
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM "ingredients"\)/, "boş veritabanına eklemez");
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM "var" v WHERE v\."sira" = k\."sira"\)/, "bu adla kalem varsa yenisini açmaz");
  assert.match(sql, /ON CONFLICT \("month", "ingredient_id"\) DO NOTHING/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM "stock_counts" c WHERE c\."month" = '2026-10' AND c\."ingredient_id" = h\."ingredient_id"\)/, "panelden girilmiş sayıma dokunmaz");
  assert.ok(sql.includes(`'${COUNT_ITEM_PRICE_NOTE}', 'Sistem'`), "fiyat satırı Listeye ekle'ninki gibi (düzeltme yerine geçer)");
  assert.match(sql, /true, 'manual', k\."sayim_birimi", k\."grup", '2026-10', "son"\."m" \+ k\."sira", true/, "Tahmini, Ekim'den listede, grubun sonunda");
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM "yeni"\) OR EXISTS \(SELECT 1 FROM "tasinan"\);\s*$/, "işlem geçmişine yalnız bir şey yapıldıysa");
  // Adlar "Listeye ekle"nin aynı ad kuralıyla (looseKey: Türkçe harf farkı da gözetilmez) karşılaştırılır
  const [from, to] = [LOOSE_FROM, LOOSE_TO];
  assert.ok(sql.includes(`translate(k."ad", '${from}', '${to}')`));
  assert.ok(sql.includes(`translate(k."ek_ad", '${from}', '${to}')`));
  assert.match(sql, /IN \(k\."ek_anahtar", k\."anahtar"\)/, "ek kalem 0047'deki ya da yeni adıyla bulunur");
  assert.match(sql, /IN \(k\."anahtar", k\."ek_anahtar"\)/, "yeni ya da eski adla var olan kalem yinelenmez");
  assert.ok(sql.includes(`translate(regexp_replace(btrim(i."name"), '\\s+', ' ', 'g'), '${from}', '${to}')`));
  assert.ok(sql.includes(`translate(regexp_replace(btrim(e."name"), '\\s+', ' ', 'g'), '${from}', '${to}')`));
  assert.doesNotMatch(sql, /'çğiiöşüiaiuaiu'/, "katı anahtar kalmadı");
});

test("0048 / 0049'un ad anahtarı uygulamanın looseKey'iyle aynı (C yerel ayarında da)", () => {
  const map = new Map([...LOOSE_FROM].map((c, i) => [c, [...LOOSE_TO][i]]));
  const sqlKey = (name: string) => [...name.trim().replace(/\s+/g, " ")].map((c) => map.get(c) ?? c).join("").replace(/[A-Z]/g, (c) => c.toLowerCase());
  for (const name of ["Kraft çanta", "KRAFT CANTA", "Kraft canta", "Beypazarı soda", "BEYPAZARI SODA", "Beypazari  Soda ", "Çay", "ÇAY", "cay",
    "Demlik poşet çay", "DEMLİK POŞET ÇAY", "Meyveli granola bar", "MEYVELİ GRANOLA BAR", "Peçete", "4'lü bardak taşıyıcı", "Şeffaf kapak 12oz", "Liçi şurubu", "Kâse 12oz", "KÛRU ÜZÜM"]) {
    assert.equal(sqlKey(name), looseKey(name), name);
  }
  for (const f of [listFile, extrasFile]) {
    const sql = read(`drizzle/${f}`);
    assert.doesNotMatch(sql, /'çğiiöşüiaiuaiu'/, `${f}: katı anahtar kalmadı`);
    assert.ok(sql.includes(`'${LOOSE_FROM}', '${LOOSE_TO}'`), `${f}: looseKey anahtarı`);
  }
});

// ---------------------------------------------------------------- Sahibinin ekleri (0049)

test("ekler: üç ifade (çay, granola bar, Beypazarı Soda), korumalar ve dönüşümler", () => {
  assert.ok(extrasFile, "urun_ekleri migration'ı yok");
  const parts = statements(read(`drizzle/${extrasFile}`));
  assert.equal(parts.length, 3);
  const [tea, bar, soda] = parts;
  for (const st of parts) assert.equal(st.replace(/^--.*$/gm, "").match(/;\s*$/gm)?.length, 1, "her parça tek ifade");
  // Çay: yeni kalem, gram → poşet (5 gr), eski kalem pasif; tarihçe eski kalemde kalır
  assert.match(tea, /SELECT 'Demlik poşet çay', e\."category", e\."supplier", 'Demlik poşet çay 200 gr \(40 poşet\)', 90, 40, 'adet'/);
  assert.match(tea, /false, 'manual', 'ADET', COALESCE\(e\."count_group", 'KAHVE & ÇAY'\), '2026-10', e\."sort_order", true/);
  assert.match(tea, /UPDATE "recipe_items" r SET "ingredient_id" = y\."id", "qty" = r\."qty" \/ 5, "qty_expr" = NULL/);
  assert.match(tea, /UPDATE "parasut_product_links" l SET "ingredient_id" = y\."id", "factor" = l\."factor" \/ 5/);
  assert.match(tea, /c\."qty" \* COALESCE\(c\."factor", 1000\) \/ 5, 1/);
  assert.match(tea, /SET "active" = false, "note" = 'Demlik poşete geçildi|SET "active" = false, "note" = 'Demlik poşet çaya geçildi/);
  assert.doesNotMatch(tea.replace(/^--.*$/gm, ""), /ingredient_prices"? *SET|DELETE FROM "ingredient_prices"|waste|purchase_quantities/, "fiyat, zayi ve alış geçmişine dokunmaz");
  assert.match(tea, /WHERE NOT EXISTS \(SELECT 1 FROM "ingredients" x WHERE .+ = lower\(translate\('Demlik poşet çay'/);
  // Granola bar: Listeye ekle'nin fiyat satırı, Ekim sayımı, ürün 110 ₺, bar + peçete
  assert.ok(bar.includes(`SELECT "id", 50, 1, '${COUNT_ITEM_PRICE_NOTE}', 'Sistem' FROM "yeni"`));
  assert.match(bar, /SELECT '2026-10', "id", 3, 1, 'Sahibi \(2 Kasım\)' FROM "yeni"/);
  assert.match(bar, /'Meyveli Granola Bar', 'Tek', 110, CASE WHEN EXISTS \(SELECT 1 FROM "products" b WHERE b\."name" = 'Hindistan Cevizli Bar'/);
  assert.match(bar, /lower\(translate\('Peçete'/);
  // Beypazarı Soda: 60 ₺, zayi Damla Soda'dan, yalnız şişe
  assert.match(soda, /'Beypazarı Soda', 'Tek', 60, CASE WHEN EXISTS \(SELECT 1 FROM "products" b WHERE b\."name" = 'Damla Soda'/);
  for (const st of [bar, soda]) {
    assert.match(st, /ON CONFLICT \("name", "size"\) DO NOTHING/);
    assert.match(st, /'create', false, 'Sistem' FROM "urun"/, "fiyat geçmişine yeni ürün satırı");
    assert.match(st, /WHERE c\."name" = '(Atıştırmalıklar|Şişe İçecekler)'/);
  }
  assert.match(bar, /WHERE EXISTS \(SELECT 1 FROM "ingredients"\)/, "boş veritabanına eklemez");
});

// ---------------------------------------------------------------- Veritabanında

const SERVER_URL = process.env.SAYIM_TEST_DATABASE_URL ?? process.env.EKLE_TEST_DATABASE_URL;

describe("Ekim sayımı migration'ı veritabanında", { skip: !SERVER_URL && "SAYIM_TEST_DATABASE_URL yok" }, () => {
  const NAME = `laffogato_ekim_sayimi_${process.pid}`;
  let admin: postgres.Sql;
  let db: postgres.Sql;
  const ROLLBACK = new Error("geri al");
  const sql = () => read(`drizzle/${migrationFile}`);

  /**
   * 0047–0049 canlıda 0056'dan (şube kırılımı) önce çalıştı: o gün sayımın tekil dizini (ay, kalem) idi ve
   * `ON CONFLICT ("month", "ingredient_id")` ona dayanır. 0056 dizini (ay, şube, kalem) yaptı; bugünkü şemada
   * migration'lar olduğu gibi çalışsın diye o günkü dizin işlemin içinde kurulur (işlemle birlikte geri alınır).
   * Migration'lar uygulanmış dosyalardır, değiştirilmez; yazdıkları satırlar 0056'nın yaptığı gibi Tuzla'ya düşer
   * (sütunun varsayılanı).
   */
  const asBefore0056 = (tx: postgres.TransactionSql) =>
    tx.unsafe(`CREATE UNIQUE INDEX "stock_counts_month_ingredient_0047" ON "stock_counts" USING btree ("month", "ingredient_id")`);

  type Count = { name: string; qty: number; factor: number; counted_by: string };
  type Extra = { name: string; unit: string; qty: number; unit_price: number };
  type Trial = { counts: Map<string, Count>; extras: Extra[]; logs: string[]; renames: string[]; names: string[]; branches: string[] };

  /** Hazırlığı ve migration'ı (istenirse iki kez) işlemde çalıştırır, sonucu okur, hepsini geri alır */
  async function trial(prepare: (tx: postgres.TransactionSql) => Promise<unknown> = async () => {}, runs = 1): Promise<Trial> {
    let out: Trial | null = null;
    await db
      .begin(async (tx) => {
        await asBefore0056(tx);
        await prepare(tx);
        const [{ id: logBefore }] = await tx<{ id: number }[]>`select coalesce(max(id), 0)::int as id from activity_log`;
        for (let i = 0; i < runs; i++) for (const st of statements(sql())) await tx.unsafe(st);
        const counts = await tx<Count[]>`
          select i.name, c.qty, c.factor, c.counted_by from stock_counts c join ingredients i on i.id = c.ingredient_id
          where c.month = '2026-10'`;
        const extras = await tx<Extra[]>`select name, unit, qty, unit_price from stock_extras where month = '2026-10' order by id`;
        const logs = await tx<{ detail: string }[]>`select detail from activity_log where id > ${logBefore} and action = 'Stok sayımı' order by id`;
        const renames = await tx<{ detail: string }[]>`select detail from activity_log where id > ${logBefore} and action = 'Hammadde güncellendi' order by id`;
        const names = await tx<{ name: string }[]>`select name from ingredients order by id`;
        const branches = await tx<{ branch_id: string }[]>`
          select branch_id from stock_counts where month = '2026-10' union select branch_id from stock_extras where month = '2026-10' order by 1`;
        out = {
          counts: new Map(counts.map((c) => [c.name, c])),
          extras: [...extras],
          logs: logs.map((l) => l.detail),
          renames: renames.map((l) => l.detail),
          names: names.map((n) => n.name),
          branches: branches.map((b) => b.branch_id),
        };
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    return out!;
  }

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${NAME}`;
    // Boş veritabanında migration bir şey yazmaz (önce migration'lar, sonra Excel: taze kurulumun sırası)
    const { createDb } = await import("../src/server/db");
    const mdb = createDb(url.href, 1);
    await migrate(mdb, { migrationsFolder: "drizzle" });
    await mdb.$client.end();
    db = postgres(url.href, { max: 1, onnotice: () => {} });
    const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from stock_counts`;
    assert.equal(n, 0, "boş veritabanında sayım yazılmadı");
    const [{ m }] = await db<{ m: number }[]>`select count(*)::int as m from ingredients`;
    assert.equal(m, 0, "boş veritabanında kalem açılmadı");
    const { runSeed } = await import("../scripts/seed");
    const env = { url: process.env.DATABASE_URL_UNPOOLED, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
    process.env.DATABASE_URL_UNPOOLED = url.href;
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    const log = console.log;
    console.log = () => {};
    try {
      await runSeed();
    } finally {
      console.log = log;
      if (env.url === undefined) delete process.env.DATABASE_URL_UNPOOLED;
      else process.env.DATABASE_URL_UNPOOLED = env.url;
      if (env.email !== undefined) process.env.ADMIN_EMAIL = env.email;
      if (env.password !== undefined) process.env.ADMIN_PASSWORD = env.password;
    }
  });

  after(async () => {
    await db?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("Excel verisinde: Cooler base → Smoothie powder; 59 kalem kendi çarpanıyla, 23 ek kalem fiyatsız ve kâğıt sırasıyla", async () => {
    const t = totals(lines(sql()));
    const r = await trial();
    assert.ok(r.names.includes("Smoothie powder") && !r.names.includes("Cooler base"), "ad değişti");
    assert.deepEqual(r.renames, ["Cooler base → Smoothie powder (adı değişti; sahibinin isteği, Ekim 2026 sayımı)"]);
    assert.equal(r.counts.size, 59);
    for (const [name, x] of t) {
      if (x.kind === "ek") continue;
      const c = r.counts.get(name);
      assert.ok(c, `${name} yazılmadı`);
      assert.equal(c.qty, x.kind === "koli" ? x.qty * 2500 : x.qty, `${name}: miktar`);
      assert.equal(c.factor, x.unit === "KG" || x.unit === "LT" ? 1000 : 1, `${name}: çarpan`);
      assert.equal(c.counted_by, "Sayım kâğıdı (31 Ekim)");
    }
    assert.equal(r.counts.get("Espresso çekirdeği")?.qty, 38);
    assert.equal(r.counts.get("Peçete")?.qty, 45000, "18 koli × 2.500");
    assert.equal(r.counts.get("Smoothie powder")?.qty, 1.38, "yeni adla, eski kalemin kaydına");
    assert.equal(r.counts.get("Matcha")?.qty, 0.35);
    assert.ok(!r.counts.has("Tasarım Kahve Çekirdeği"), "Mono Latte ayrı tatlı");
    assert.deepEqual(
      r.extras,
      [...t.entries()].filter(([, x]) => x.kind === "ek").map(([name, x]) => ({ name, unit: x.unit, qty: x.qty, unit_price: 0 })),
    );
    assert.deepEqual(r.logs, ["Ekim 2026: 31 Ekim sayım kâğıdından 59 kalem; 23 ek kalem (Listede olmayanlar; birim fiyatını yönetici girer)"]);
    assert.deepEqual(r.branches, ["tuzla"], "sayım ve ek kalemler Tuzla'nın (0056 ve 0059 eski satırları oraya yazar)");
  });

  test("ikinci çalıştırma bir şey eklemez, işlem geçmişine yeniden yazmaz", async () => {
    const r = await trial(undefined, 2);
    assert.equal(r.counts.size, 59);
    assert.equal(r.extras.length, 23);
    assert.equal(r.logs.length, 1);
    assert.equal(r.renames.length, 1);
  });

  test("panelden girilmiş Ekim sayımı ve aynı adlı ek kalem olduğu gibi kalır", async () => {
    const r = await trial(async (tx) => {
      await tx`insert into stock_counts (month, ingredient_id, qty, factor, counted_by)
        select '2026-10', id, 30, 1000, 'Ayşe' from ingredients where name = 'Espresso çekirdeği'`;
      await tx`insert into stock_extras (month, name, unit, qty, unit_price) values ('2026-10', 'KRAFT ÇANTA', 'PAKET', 2, 150)`;
    });
    assert.deepEqual({ qty: r.counts.get("Espresso çekirdeği")?.qty, by: r.counts.get("Espresso çekirdeği")?.counted_by }, { qty: 30, by: "Ayşe" });
    assert.equal(r.counts.size, 59);
    assert.deepEqual(
      r.extras.filter((e) => looseKey(e.name) === looseKey("Kraft çanta")),
      [{ name: "KRAFT ÇANTA", unit: "PAKET", qty: 2, unit_price: 150 }],
    );
    assert.equal(r.extras.length, 23, "22 yeni + panelden girilen");
    assert.equal(r.logs.length, 1);
    assert.match(r.logs[0], /^Ekim 2026: 31 Ekim sayım kâğıdından 58 kalem; 22 ek kalem .+; 1 kalem panelde zaten sayılmıştı, dokunulmadı$/);
  });

  test("adı değişmiş kalem ek kaleme; sayım listesinden çıkmış ya da birimi değişmiş kalem yazılmaz, işlem geçmişinde", async () => {
    const r = await trial(async (tx) => {
      // Adı panelde değişmiş: kâğıttaki ad bulunamaz
      await tx`update ingredients set name = 'Colombia (cold brew)' where name = 'Cold brew kahve (Colombia)'`;
      // "Sayılmaz" yapılmış, pasif (hiçbir aktif reçetede değil) ve sayım birimi değişmiş kalemler
      await tx`update ingredients set count_unit = null where name = 'Frappe tozu'`;
      await tx`update ingredients set active = false where name = 'Su (PET)'`;
      await tx`update products set active = false
        where id in (select r.product_id from recipe_items r join ingredients i on i.id = r.ingredient_id where i.name = 'Su (PET)')`;
      await tx`update ingredients set count_unit = 'ADET' where name = 'Marlenka dilim'`;
      // Peçetenin paketi artık koli değil: koli × paket yanlış olurdu (boş paket bilgisi de)
      await tx`update ingredients set package_desc = 'Peçete paketi 100 adet', package_size = 100 where name = 'Peçete'`;
      await tx`update ingredients set package_desc = null where name = 'Yenilebilir bardak'`;
      // Büyük harfle yazılmış ad yine eşleşir
      await tx`update ingredients set name = 'MATCHA' where name = 'Matcha'`;
    });
    assert.equal(r.counts.get("MATCHA")?.qty, 0.35, "büyük / küçük harf farkı eşleşir");
    for (const name of ["Frappe tozu", "Su (PET)", "Marlenka dilim", "Peçete", "Colombia (cold brew)"]) assert.ok(!r.counts.has(name), name);
    assert.equal(r.counts.size, 54);
    assert.deepEqual(
      r.extras.find((e) => e.name === "Cold brew kahve (Colombia)"),
      { name: "Cold brew kahve (Colombia)", unit: "KG", qty: 0.5, unit_price: 0 },
    );
    assert.equal(r.extras.length, 24);
    assert.match(r.logs[0] ?? "", /; elle girilecek: Frappe tozu, Marlenka dilim, Peçete, Su \(PET\)$/);
  });

  test("Smoothie powder adı panelde zaten varsa ad değişmez; sayım o kaleme yazılır", async () => {
    // Elle değiştirilmiş (büyük harfle): Cooler base kalmaz, ad olduğu gibi kalır
    const byHand = await trial(async (tx) => {
      await tx`update ingredients set name = 'SMOOTHIE POWDER' where name = 'Cooler base'`;
    });
    assert.deepEqual(byHand.renames, []);
    assert.equal(byHand.counts.get("SMOOTHIE POWDER")?.qty, 1.38);
    // Bu adla ayrı bir kalem açılmış: Cooler base adını korur, sayım Smoothie powder'a gider
    const twin = await trial(async (tx) => {
      await tx`insert into ingredients (name, category, unit, count_unit, count_group, package_price, package_size)
        values ('Smoothie powder', 'Toz', 'gr', 'KG', 'TOZ ÜRÜNLER', 900, 1000)`;
    });
    assert.deepEqual(twin.renames, []);
    assert.ok(twin.names.includes("Cooler base"));
    assert.equal(twin.counts.get("Smoothie powder")?.qty, 1.38);
    assert.ok(!twin.counts.has("Cooler base"));
  });

  test("Peçetenin paket bilgisi boşsa sayılmaz ama işlem geçmişinde elle girilecek", async () => {
    const r = await trial(async (tx) => {
      await tx`update ingredients set package_desc = null where name = 'Peçete'`;
    });
    assert.ok(!r.counts.has("Peçete"));
    assert.ok(!r.extras.some((e) => e.name === "Peçete"));
    assert.match(r.logs[0] ?? "", /; elle girilecek: Peçete$/);
  });

  test("eski Cooler base pasif, kullanılan aynı adlı kalem aktifse ad ve sayım aktif olana", async () => {
    const r = await trial(async (tx) => {
      await tx`update ingredients set active = false where name = 'Cooler base'`;
      await tx`update products set active = false
        where id in (select r.product_id from recipe_items r join ingredients i on i.id = r.ingredient_id where i.name = 'Cooler base')`;
      await tx`insert into ingredients (name, category, unit, count_unit, count_group, package_price, package_size)
        values ('Cooler Base', 'Toz', 'gr', 'KG', 'TOZ ÜRÜNLER', 836, 1000)`;
    });
    assert.ok(r.names.includes("Cooler base"), "pasif eski kalemin adı kalır");
    assert.ok(!r.names.includes("Cooler Base") && r.names.includes("Smoothie powder"), "aktif kalem yeniden adlandırıldı");
    assert.equal(r.counts.get("Smoothie powder")?.qty, 1.38);
    assert.ok(!r.counts.has("Cooler base"));
  });

  test("pasif ama aktif bir reçetede geçen kalem sayılır (sayım listesinde)", async () => {
    const r = await trial(async (tx) => {
      await tx`update ingredients set active = false where name = 'Espresso çekirdeği'`;
    });
    assert.equal(r.counts.get("Espresso çekirdeği")?.qty, 38);
  });

  // ---- 0048: ek kalemler sayım listesine
  type Item = {
    name: string; category: string; unit: string; count_unit: string; count_group: string; count_from: string;
    package_price: number; package_size: number; vat_rate: number; is_estimate: boolean; active: boolean; supplier: string | null; note: string;
  };
  type ListTrial = Trial & { items: Item[]; added: string[]; prices: { name: string; package_price: number; note: string }[] };

  /** 0047'yi, aradaki hazırlığı ve 0048'i (istenirse iki kez) işlemde çalıştırır, sonucu okur, hepsini geri alır */
  async function listTrial(between: (tx: postgres.TransactionSql) => Promise<unknown> = async () => {}, runs = 1): Promise<ListTrial> {
    let out: ListTrial | null = null;
    await db
      .begin(async (tx) => {
        await asBefore0056(tx);
        for (const st of statements(sql())) await tx.unsafe(st);
        await between(tx);
        const [{ id: logBefore }] = await tx<{ id: number }[]>`select coalesce(max(id), 0)::int as id from activity_log`;
        const [{ id: ingBefore }] = await tx<{ id: number }[]>`select coalesce(max(id), 0)::int as id from ingredients`;
        for (let i = 0; i < runs; i++) await tx.unsafe(read(`drizzle/${listFile}`));
        const counts = await tx<Count[]>`
          select i.name, c.qty, c.factor, c.counted_by from stock_counts c join ingredients i on i.id = c.ingredient_id where c.month = '2026-10'`;
        const extras = await tx<Extra[]>`select name, unit, qty, unit_price from stock_extras where month = '2026-10' order by id`;
        const logs = await tx<{ detail: string }[]>`select detail from activity_log where id > ${logBefore} and action = 'Stok sayımı' order by id`;
        const added = await tx<{ detail: string }[]>`select detail from activity_log where id > ${logBefore} and action = 'Sayım listesine eklendi' order by id`;
        const items = await tx<Item[]>`
          select name, category, unit, count_unit, count_group, count_from, package_price, package_size, vat_rate, is_estimate, active, supplier, note
          from ingredients where id > ${ingBefore} order by sort_order`;
        const prices = await tx<{ name: string; package_price: number; note: string }[]>`
          select i.name, p.package_price, p.note from ingredient_prices p join ingredients i on i.id = p.ingredient_id where i.id > ${ingBefore} order by i.sort_order`;
        const names = await tx<{ name: string }[]>`select name from ingredients order by id`;
        out = {
          counts: new Map(counts.map((c) => [c.name, c])),
          extras: [...extras],
          logs: logs.map((l) => l.detail),
          renames: [],
          names: names.map((n) => n.name),
          branches: [],
          items: [...items],
          added: added.map((a) => a.detail),
          prices: [...prices],
        };
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    return out!;
  }

  test("0048: 22 ek kalem Listeye ekle kuralıyla hammadde, Ekim miktarı kaleme taşınır, ek kalemde yalnız adı okunamayan kalır", async () => {
    const plan = newItems(read(`drizzle/${listFile}`));
    const ek = totals(lines(sql()));
    const r = await listTrial();
    assert.deepEqual(
      r.items.map((i) => ({ ...i, note: undefined })),
      plan.map((p) => ({
        name: p.name, category: p.category, unit: p.unit, count_unit: p.countUnit, count_group: p.group, count_from: "2026-10",
        package_price: 0, package_size: p.packageSize, vat_rate: p.vat, is_estimate: true, active: true, supplier: null, note: undefined,
      })),
    );
    assert.ok(r.items.every((i) => i.note === "Ekim 2026 sayım kâğıdından sayım listesine eklendi (02.11.2026). Paket fiyatını ve içeriğini yazın."));
    assert.deepEqual(r.prices, [], "fiyatsız kalem fiyat satırı yazmaz");
    assert.equal(r.counts.size, 81);
    for (const p of plan) {
      const c = r.counts.get(p.name);
      assert.ok(c, `${p.name} sayılmadı`);
      assert.equal(c.qty, ek.get(p.extraName)!.qty, `${p.name}: miktar ek kalemdeki`);
      assert.equal(c.factor, p.countUnit === "KG" || p.countUnit === "LT" ? 1000 : 1, `${p.name}: çarpan`);
      assert.equal(c.counted_by, "Sayım kâğıdı (31 Ekim)");
    }
    assert.deepEqual(r.extras, [{ name: UNNAMED, unit: "LT", qty: 0.863, unit_price: 0 }]);
    assert.deepEqual(r.added, [plan.map((p) => p.name).join(", ")]);
    assert.deepEqual(r.logs, ["Ekim 2026: 22 ek kalem sayım listesindeki kalemine taşındı"]);
  });

  test("0048: ikinci çalıştırma bir şey yapmaz", async () => {
    const r = await listTrial(undefined, 2);
    assert.equal(r.items.length, 22);
    assert.equal(r.counts.size, 81);
    assert.equal(r.extras.length, 1);
    assert.equal(r.added.length, 1);
    assert.equal(r.logs.length, 1);
  });

  test("0048: ek kaleme yazılmış birim fiyat paket fiyatı olur, fiyat geçmişine Listeye ekle'nin başlangıç satırı", async () => {
    const r = await listTrial(async (tx) => {
      await tx`update stock_extras set unit_price = 5 where month = '2026-10' and name = 'Kraft çanta'`;
      await tx`update stock_extras set unit_price = 1013.33 where month = '2026-10' and name = 'Badem şurubu'`;
    });
    const kraft = r.items.find((i) => i.name === "Kraft çanta")!;
    const badem = r.items.find((i) => i.name === "Badem şurubu")!;
    assert.deepEqual([kraft.package_price, kraft.package_size], [5, 1]);
    assert.deepEqual([badem.package_price, badem.package_size], [760, 750], "1.013,33 ₺/LT × 0,75 LT");
    assert.match(kraft.note, /; paket fiyatı sayımdaki ek kalemin birim fiyatından\.$/);
    assert.deepEqual(r.prices, [
      { name: "Badem şurubu", package_price: 760, note: COUNT_ITEM_PRICE_NOTE },
      { name: "Kraft çanta", package_price: 5, note: COUNT_ITEM_PRICE_NOTE },
    ]);
  });

  test("0048: bu adla kalem varsa yenisi açılmaz; panelden sayılmış, sayılmaz ve ek kalemi silinmiş olan raporlanır", async () => {
    const r = await listTrial(async (tx) => {
      // Listeye ekle ile açılmış (büyük harfle): miktar ona taşınır
      await tx`insert into ingredients (name, category, unit, count_unit, count_group, count_from) values ('KRAFT ÇANTA', 'Ambalaj', 'adet', 'ADET', 'AMBALAJ MALZEMELERİ', '2026-10')`;
      // "Sayılmaz" hammadde: açılmaz, ek kalem kalır
      await tx`insert into ingredients (name, category, unit, count_unit) values ('Sleeve 8oz', 'Ambalaj', 'adet', null)`;
      // Panelden Ekim'de sayılmış: sayım ve ek kalem olduğu gibi kalır
      const [{ id }] = await tx<{ id: number }[]>`insert into ingredients (name, category, unit, count_unit, count_group) values ('Stick şeker', 'Diğer', 'adet', 'ADET', 'DİĞER GIDA ÜRÜNLERİ') returning id`;
      await tx`insert into stock_counts (month, ingredient_id, qty, factor, counted_by) values ('2026-10', ${id}, 300, 1, 'Ayşe')`;
      // Ek kalemi silinmiş: kalem açılır, miktar taşınmaz
      await tx`delete from stock_extras where month = '2026-10' and name = 'Plastik bıçak'`;
    });
    assert.equal(r.items.length, 19, "Kraft çanta, Sleeve 8oz ve Stick şeker açılmadı");
    assert.ok(r.items.some((i) => i.name === "Plastik bıçak"));
    assert.ok(!r.counts.has("Plastik bıçak"));
    assert.equal(r.counts.get("KRAFT ÇANTA")?.qty, 204);
    assert.deepEqual({ qty: r.counts.get("Stick şeker")?.qty, by: r.counts.get("Stick şeker")?.counted_by }, { qty: 300, by: "Ayşe" });
    assert.deepEqual(r.extras.map((e) => e.name), [UNNAMED, "Stick şeker", "Sleeve 8oz"], "0047'nin sırasıyla");
    assert.deepEqual(r.logs, [
      "Ekim 2026: 19 ek kalem sayım listesindeki kalemine taşındı; taşınmadı: Stick şeker (Ekim sayımı zaten var, ek kalem duruyor), " +
        "Sleeve 8oz (listede başka birimle ya da sayılmaz), Plastik bıçak (Ekim ek kalemi bulunamadı, miktar taşınmadı)",
    ]);
  });

  test("0048: panelde Türkçe harfsiz açılmış kalem (Listeye ekle'nin aynı ad kuralı) yinelenmez; adı panelde değişmiş ek kalem bulunur", async () => {
    const r = await listTrial(async (tx) => {
      await tx`insert into ingredients (name, category, unit, count_unit, count_group, count_from) values ('Kraft canta', 'Ambalaj', 'adet', 'ADET', 'AMBALAJ MALZEMELERİ', '2026-10')`;
      await tx`update stock_extras set name = 'Beypazarı soda' where month = '2026-10' and name = 'Beypazarı maden suyu'`;
    });
    assert.ok(!r.items.some((i) => i.name === "Kraft çanta"));
    assert.equal(r.counts.get("Kraft canta")?.qty, 204);
    assert.equal(r.counts.get("Beypazarı soda")?.qty, 8);
    assert.deepEqual(r.extras.map((e) => e.name), [UNNAMED]);
  });

  test("0048: Beypazarı 0047'deki adıyla zaten açılmışsa yenisi açılmaz, miktar ona taşınır", async () => {
    const r = await listTrial(async (tx) => {
      await tx`insert into ingredients (name, category, unit, count_unit, count_group, count_from) values ('Beypazarı maden suyu', 'Şişe İçecek', 'adet', 'ADET', 'İÇECEKLER (şişe)', '2026-10')`;
    });
    assert.ok(!r.items.some((i) => i.name === "Beypazarı soda"));
    assert.equal(r.counts.get("Beypazarı maden suyu")?.qty, 8);
  });

  // ---- 0049: sahibinin ekleri
  type Product = { name: string; size: string; price: number; fire_override: number | null; active: boolean; show_on_menu: boolean; category: string; recipe: string };
  type ExtrasTrial = {
    tea: Item | undefined; oldTea: { active: boolean; note: string | null } | undefined; bar: Item | undefined; soda: Item | undefined;
    products: Product[]; teaNotes: string[]; counts: Map<string, Count>; prices: { name: string; package_price: number; note: string }[];
    sales: { name: string; price: number; source: string }[]; logs: { action: string; detail: string }[]; fires: Record<string, number | null>; links: number[];
  };

  /** 0047 + 0048'i, aradaki hazırlığı ve 0049'u (istenirse iki kez) işlemde çalıştırır, sonucu okur, hepsini geri alır */
  async function extrasTrial(between: (tx: postgres.TransactionSql) => Promise<unknown> = async () => {}, runs = 1): Promise<ExtrasTrial> {
    let out: ExtrasTrial | null = null;
    await db
      .begin(async (tx) => {
        await asBefore0056(tx);
        for (const st of statements(sql())) await tx.unsafe(st);
        await tx.unsafe(read(`drizzle/${listFile}`));
        await between(tx);
        const [{ id: logBefore }] = await tx<{ id: number }[]>`select coalesce(max(id), 0)::int as id from activity_log`;
        for (let i = 0; i < runs; i++) for (const st of statements(read(`drizzle/${extrasFile}`))) await tx.unsafe(st);
        const item = async (name: string) =>
          (await tx<Item[]>`select name, category, unit, count_unit, count_group, count_from, package_price, package_size, vat_rate, is_estimate, active, supplier, note
            from ingredients where name = ${name}`)[0];
        const products = await tx<Product[]>`
          select p.name, p.size, p.price, p.fire_override, p.active, p.show_on_menu, c.name as category,
            string_agg(i.name || ' × ' || r.qty, ', ' order by r.sort_order) as recipe
          from products p join categories c on c.id = p.category_id left join recipe_items r on r.product_id = p.id left join ingredients i on i.id = r.ingredient_id
          where p.name in ('Meyveli Granola Bar', 'Beypazarı Soda', 'Çay') group by 1, 2, 3, 4, 5, 6, 7 order by 1, 2`;
        const teaNotes = await tx<{ note: string }[]>`select note from products where name = 'Çay' order by size`;
        const counts = await tx<Count[]>`
          select i.name, c.qty, c.factor, c.counted_by from stock_counts c join ingredients i on i.id = c.ingredient_id where c.month = '2026-10'`;
        const prices = await tx<{ name: string; package_price: number; note: string }[]>`
          select i.name, p.package_price, p.note from ingredient_prices p join ingredients i on i.id = p.ingredient_id
          where i.name in ('Demlik poşet çay', 'Meyveli granola bar') order by p.id`;
        const sales = await tx<{ name: string; price: number; source: string }[]>`
          select p.name, pp.price, pp.source from product_prices pp join products p on p.id = pp.product_id
          where p.name in ('Meyveli Granola Bar', 'Beypazarı Soda') order by pp.id`;
        const logs = await tx<{ action: string; detail: string }[]>`select action, detail from activity_log where id > ${logBefore} order by id`;
        const fires = Object.fromEntries(
          (await tx<{ name: string; fire_override: number | null }[]>`select name, fire_override from products where name in ('Hindistan Cevizli Bar', 'Damla Soda') and size = 'Tek'`).map((f) => [f.name, f.fire_override]),
        );
        const links = (await tx<{ factor: number }[]>`select l.factor from parasut_product_links l join ingredients i on i.id = l.ingredient_id where i.name = 'Demlik poşet çay'`).map((l) => l.factor);
        const old = (await tx<{ active: boolean; note: string | null }[]>`select active, note from ingredients where name = 'Çay'`)[0];
        out = {
          tea: await item("Demlik poşet çay"), oldTea: old, bar: await item("Meyveli granola bar"), soda: await item("Beypazarı soda"),
          products: [...products], teaNotes: teaNotes.map((n) => n.note), counts: new Map(counts.map((c) => [c.name, c])),
          prices: [...prices], sales: [...sales], logs: [...logs], fires, links,
        };
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    return out!;
  }

  test("0049: çay demlik poşete geçer (reçete gram / 5, eski kalem pasif), granola bar ve Beypazarı Soda açılır", async () => {
    const r = await extrasTrial();
    assert.deepEqual(
      { ...r.tea!, note: undefined },
      {
        name: "Demlik poşet çay", category: "Diğer", unit: "adet", count_unit: "ADET", count_group: "KAHVE & ÇAY", count_from: "2026-10",
        package_price: 90, package_size: 40, vat_rate: 0.01, is_estimate: false, active: true, supplier: "(faturada yok)", note: undefined,
      },
    );
    assert.deepEqual(r.oldTea, { active: false, note: 'Demlik poşet çaya geçildi (02.11.2026): yerine "Demlik poşet çay".' });
    const tea = r.products.filter((p) => p.name === "Çay");
    assert.deepEqual(
      tea.map((p) => [p.size, p.recipe]),
      [
        ["L", "Demlik poşet çay × 1, Su × 300, Karton bardak 14oz × 1, Kapak 14-16oz × 1, Peçete × 1"],
        ["M", "Demlik poşet çay × 0.6, Su × 200, Karton bardak 8oz × 1, Kapak 8-12oz × 1, Peçete × 1"],
      ],
    );
    assert.ok(r.teaNotes.every((n) => n.endsWith("Reçete: M = 0,6 demlik poşet (3 gr) + 8oz bardak, L = 1 poşet (5 gr) + 14oz bardak; demliğe 6–8 poşet.")));
    assert.deepEqual({ ...r.bar!, note: undefined }, {
      name: "Meyveli granola bar", category: "Atıştırmalık", unit: "adet", count_unit: "ADET", count_group: "SANDVİÇ & ATIŞTIRMALIK", count_from: "2026-10",
      package_price: 50, package_size: 1, vat_rate: 0.01, is_estimate: true, active: true, supplier: null, note: undefined,
    });
    assert.deepEqual(
      { qty: r.counts.get("Meyveli granola bar")?.qty, factor: r.counts.get("Meyveli granola bar")?.factor, by: r.counts.get("Meyveli granola bar")?.counted_by },
      { qty: 3, factor: 1, by: "Sahibi (2 Kasım)" },
    );
    assert.deepEqual(r.prices, [
      { name: "Demlik poşet çay", package_price: 90, note: "Demlik poşete geçildi: 450 ₺/kg (sahibinin verdiği fiyat)" },
      { name: "Meyveli granola bar", package_price: 50, note: COUNT_ITEM_PRICE_NOTE },
    ]);
    const bar = r.products.find((p) => p.name === "Meyveli Granola Bar")!;
    const soda = r.products.find((p) => p.name === "Beypazarı Soda")!;
    assert.deepEqual(bar, {
      name: "Meyveli Granola Bar", size: "Tek", price: 110, fire_override: r.fires["Hindistan Cevizli Bar"], active: true, show_on_menu: true,
      category: "Atıştırmalıklar", recipe: "Meyveli granola bar × 1, Peçete × 1",
    });
    assert.deepEqual(soda, {
      name: "Beypazarı Soda", size: "Tek", price: 60, fire_override: r.fires["Damla Soda"], active: true, show_on_menu: true,
      category: "Şişe İçecekler", recipe: "Beypazarı soda × 1",
    });
    assert.deepEqual(r.sales, [
      { name: "Meyveli Granola Bar", price: 110, source: "create" },
      { name: "Beypazarı Soda", price: 60, source: "create" },
    ]);
    assert.deepEqual(
      r.logs.map((l) => l.action),
      ["Sayım listesine eklendi", "Hammadde pasif", "Sayım listesine eklendi", "Stok sayımı", "Yeni ürün", "Yeni ürün"],
    );
    assert.equal(r.logs[1].detail, 'Çay: demlik poşet çaya geçildi; 2 reçete satırı, 0 Paraşüt bağlantısı ve 0 sayım "Demlik poşet çay"a taşındı');
  });

  test("0049: Beypazarı kalemi eski adıyla duruyorsa ürün ona bağlanır; eski çay gramla değilse dönüşmez", async () => {
    const r = await extrasTrial(async (tx) => {
      await tx`update ingredients set name = 'Beypazarı maden suyu' where name = 'Beypazarı soda'`;
      await tx`update ingredients set unit = 'adet', count_unit = 'ADET' where name = 'Çay'`;
    });
    assert.equal(r.products.find((p) => p.name === "Beypazarı Soda")?.recipe, "Beypazarı maden suyu × 1");
    assert.equal(r.tea, undefined, "gramla olmayan çay dönüşmez");
    assert.ok(r.products.filter((p) => p.name === "Çay").every((p) => p.recipe.startsWith("Çay × ")));
  });

  test("0049: ikinci çalıştırma bir şey yapmaz", async () => {
    const r = await extrasTrial(undefined, 2);
    assert.equal(r.products.filter((p) => p.name !== "Çay").length, 2);
    assert.equal(r.sales.length, 2);
    assert.equal(r.prices.length, 2);
    assert.equal(r.logs.length, 6);
  });

  test("0049: eski çayın sayımı ve Paraşüt bağlantısı poşete çevrilir; var olan ürün ve kalem yinelenmez", async () => {
    const r = await extrasTrial(async (tx) => {
      await tx`insert into stock_counts (month, ingredient_id, qty, factor, counted_by) select '2026-10', id, 0.4, 1000, 'Ayşe' from ingredients where name = 'Çay'`;
      await tx`insert into parasut_product_links (product_key, product_name, ingredient_id, factor) select 'cay-1kg', 'Çay 1 kg', id, 1000 from ingredients where name = 'Çay'`;
      await tx`insert into products (category_id, name, size, price) select id, 'Meyveli Granola Bar', 'Tek', 95 from categories where name = 'Atıştırmalıklar'`;
    });
    assert.deepEqual(
      { qty: r.counts.get("Demlik poşet çay")?.qty, factor: r.counts.get("Demlik poşet çay")?.factor, by: r.counts.get("Demlik poşet çay")?.counted_by },
      { qty: 80, factor: 1, by: "Ayşe" },
      "0,4 KG = 400 gr = 80 poşet",
    );
    assert.ok(!r.counts.has("Çay"));
    assert.deepEqual(r.links, [200], "1 Paraşüt birimi 1.000 gr → 200 poşet");
    assert.deepEqual(r.products.filter((p) => p.name === "Meyveli Granola Bar").map((p) => p.price), [95], "panelde açılmış ürün olduğu gibi");
    assert.deepEqual(r.sales.map((x) => x.name), ["Beypazarı Soda"]);
  });
});
