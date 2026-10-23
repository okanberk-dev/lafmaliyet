// Seed ve db:reset: ürünler zayi oranlarını kategorilerinden alır (0012_zayi_oranlari'nın kuralları, boş veritabanında
// ve sıfırlamada da), sıfırlama zayi / ikram kayıtlarını silmez (aynı kimlik ve adla geri gelene bağlı kalır), bu
// bilgisayarda olmayan veritabanını sunucu adıyla onaysız silmez ve silmeden önce yedek alır.
// Çalıştırma: npx tsx --test tests/zayi-oranlari.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { resetCheck } from "../scripts/seed";
import { databaseTarget } from "../src/lib/backup/format";
import { defaultFireRate, FIRE_DEFAULTS, withFireDefaults } from "../src/lib/fire-defaults";
import { relinkWaste } from "../src/lib/waste";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));

test("kurallar 0012_zayi_oranlari.sql ile aynı: oranlar, kategoriler, sıra", () => {
  const sql = read("drizzle/0012_zayi_oranlari.sql")
    .split("--> statement-breakpoint")
    .map((x) => x.replace(/^--.*$/gm, "").trim())
    .filter(Boolean);
  assert.equal(sql.length, FIRE_DEFAULTS.length);
  sql.forEach((stmt, i) => {
    const rule = FIRE_DEFAULTS[i];
    const rate = Number(stmt.match(/SET "fire_override" = ([\d.]+)/)?.[1]);
    assert.equal(rate, rule.rate, stmt);
    const cats = [...(stmt.match(/"name" (?:IN \(([^)]*)\)|= '([^']*)'\))/)?.slice(1) ?? [])].filter(Boolean)[0];
    if (rule.categories) assert.deepEqual(cats?.split(",").map((c) => c.trim().replace(/^'|'$/g, "")), [...rule.categories], stmt);
    if (rule.product) assert.match(stmt, new RegExp(`WHERE "name" = '${rule.product}'`));
    if (rule.exceptNameLike) assert.match(stmt, new RegExp(`NOT ILIKE '%${rule.exceptNameLike}%'`));
  });
});

test("Excel'in 129 ürününün hepsi oran alır; tatlı %20, çay %40, sandviç %15, öteki atıştırmalık %3", () => {
  const ds = excelToDataset(data);
  const seeded = withFireDefaults(ds.products, ds.categories);
  assert.equal(seeded.length, 129);
  assert.equal(seeded.filter((p) => p.fireOverride === null).length, 0);
  const cat = new Map(ds.categories.map((c) => [c.id, c.name]));
  const rate = (name: string, size?: string) => seeded.find((p) => p.name === name && (!size || p.size === size))?.fireOverride;
  assert.equal(rate("Brownie"), 0.2);
  assert.equal(rate("Çay", "M"), 0.4, "Sıcak İçecekler'de ama ürün kuralı sonra gelir");
  assert.equal(rate("Rosbeef Sandviç"), 0.15);
  assert.equal(rate("Koska Fındık"), 0.03);
  for (const p of seeded) assert.equal(p.fireOverride, defaultFireRate(p, cat.get(p.categoryId)), p.name);
  // Excel'de yazılı oran kalır; kural yoksa genel ayar (null)
  assert.equal(withFireDefaults([{ name: "X", categoryId: 1, fireOverride: 0.07 }], [{ id: 1, name: "Tatlılar" }])[0].fireOverride, 0.07);
  assert.equal(defaultFireRate({ name: "Yeni" }, "Bilinmeyen kategori"), null);
});

test("sıfırlama zayi / ikram kayıtlarını tutar: aynı kimlik ve adla geri gelene bağlı kalır, gerisi yalnız adıyla", () => {
  const products = [
    { id: 1, name: "Espresso", size: "M" },
    { id: 2, name: "Brownie", size: "Tek" },
  ];
  const ingredients = [{ id: 7, name: "Süt" }];
  const rows = [
    { id: 1, productId: 1, ingredientId: null, name: "Espresso M" },
    { id: 2, productId: 2, ingredientId: null, name: "Brownie" },
    { id: 3, productId: 130, ingredientId: null, name: "Panelde eklenen ürün" },
    { id: 4, productId: 1, ingredientId: null, name: "Eski ad L" },
    { id: 5, productId: null, ingredientId: 7, name: "Süt" },
    { id: 6, productId: null, ingredientId: 7, name: "Laktozsuz süt" },
  ];
  assert.deepEqual(
    relinkWaste(rows, products, ingredients).map((r) => [r.id, r.productId, r.ingredientId]),
    [
      [1, 1, null],
      [2, 2, null],
      [3, null, null],
      [4, null, null],
      [5, null, 7],
      [6, null, null],
    ],
  );
});

test("db:reset onayı: bu bilgisayardaki onaysız; Neon yalnız sunucu adıyla, yanlış ad hiçbir şey silmez", () => {
  const local = databaseTarget("postgres://postgres:postgres@localhost:5432/laffogato");
  const neon = databaseTarget("postgres://u:p@ep-ornek-123-pooler.c-7.eu-central-1.aws.neon.tech/neondb?sslmode=require");
  assert.deepEqual(resetCheck(local, null), { ok: true });
  assert.deepEqual(resetCheck(neon, neon.host), { ok: true });
  const wrong = resetCheck(neon, "localhost");
  assert.ok(!wrong.ok && "error" in wrong && /Onay tutmuyor: --onay=ep-ornek-123-pooler\.c-7\.eu-central-1\.aws\.neon\.tech/.test(wrong.error));
  const ask = resetCheck(neon, null);
  assert.ok(!ask.ok && "warning" in ask && ask.warning.includes("ep-ornek-123-pooler.c-7.eu-central-1.aws.neon.tech/neondb"));
});

test("seed betiği: onay bağlanmadan önce, yedek silmeden önce, zayi TRUNCATE'ten önce okunur; oranlar ürünlerle yazılır", () => {
  const seed = read("scripts/seed.ts");
  const run = seed.slice(seed.indexOf("export async function runSeed"));
  assert.ok(run.indexOf("resetCheck(target, confirm)") < run.indexOf("createDb(url, 1)"), "onay veritabanına bağlanmadan önce");
  const truncate = run.indexOf("`TRUNCATE ");
  assert.ok(truncate > 0);
  assert.ok(run.indexOf("writeBackupFile(db.$client") < truncate, "yedek silmeden önce");
  assert.match(run, /documents: true, createdBy: "db:reset öncesi"/);
  assert.ok(run.indexOf("tx.select().from(s.wasteEntries)") < truncate, "zayi kayıtları silinmeden önce okunur");
  assert.match(run, /tx\.insert\(s\.wasteEntries\)\.values\(relinkWaste\(keptWaste, ds\.products, ds\.ingredients\)\)/);
  assert.match(run, /tx\.insert\(s\.products\)\.values\(withFireDefaults\(ds\.products, ds\.categories\)\)/);
  // Kimlikleri korunarak geri yazılan zayi kayıtlarının sayacı ileri alınır
  assert.match(run, /\[\.\.\.SERIAL_TABLES, \.\.\.\(keptWaste\.length \? \["waste_entries"\] : \[\]\)\]/);
  assert.match(seed, /args\.find\(\(a\) => a\.startsWith\("--onay="\)\)/);
});
