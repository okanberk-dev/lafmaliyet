// Ekim 2026 ay sonu sayımı (drizzle/*_ekim_sayimi.sql): 31 Ekim 2026 kapanışındaki kâğıt sayımının panele işlenmesi
// (kayıt ve sahibine sorulanlar: docs/sayimlar/2026-10.md). Saf denetimler her zaman çalışır: kâğıttaki her satır
// bilinen bir kaleme o kalemin sayım birimiyle gider, ek kalem listedeki bir adla çakışmaz, korumalar ve ad anahtarı
// yerinde, belge migration'la aynı rakamları söyler. Veritabanı denemesi SAYIM_TEST_DATABASE_URL (yoksa
// EKLE_TEST_DATABASE_URL) verilince çalışır: kendi geçici veritabanını açar, Excel verisini yükler, migration'ı geri
// alınan işlemlerde dener (60 kalem + 21 ek kalem; ikinci çalıştırma bir şey eklemez; panelden girilmiş sayımın ve ek
// kalemin üzerine yazmaz; adı değişmiş kalem ek kaleme, sayım listesinden çıkmış kalem "elle girilecek"e düşer).
// Çalıştırma: SAYIM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/ekim-sayimi.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { looseKey } from "../src/lib/count-item";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const migrationFile = readdirSync(join(process.cwd(), "drizzle")).find((f) => f.endsWith("_ekim_sayimi.sql"));
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

const excel = excelToDataset(JSON.parse(read("src/server/db/seed/excel-data.json")) as ExcelData).ingredients;
const known = new Map<string, string | null>([...excel.map((i) => [i.name, i.countUnit] as const), ...Object.entries(EIGHT)]);

test("migration: satırlar sırayla, dört fotoğraftan, miktar pozitif; tek ifade, yalnız Ekim 2026", () => {
  assert.ok(migrationFile, "ekim_sayimi migration'ı yok");
  const sql = read(`drizzle/${migrationFile}`);
  const rows = lines(sql);
  assert.equal(rows.length, 127, "kâğıttaki 127 satır");
  rows.forEach((r, i) => {
    assert.equal(r.no, i + 1, `${r.raw}: sıra`);
    assert.ok([1, 2, 3, 4].includes(r.foto), `${r.raw}: fotoğraf`);
    assert.ok(r.qty > 0, `${r.raw}: miktar`);
    assert.ok(["KG", "LT", "ADET", "DİLİM"].includes(r.unit), `${r.raw}: birim`);
  });
  // Bütün tarihler Ekim 2026; tek ifade (kırılma noktası yok: birleştirmede --custom ile yeniden üretilip yapıştırılır)
  assert.deepEqual([...new Set(sql.match(/'\d{4}-\d{2}'/g))], ["'2026-10'"]);
  assert.doesNotMatch(sql, /statement-breakpoint/);
  assert.equal(sql.match(/;\s*$/gm)?.length, 1, "tek ifade");
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
  assert.equal([...t.values()].filter((x) => x.kind !== "ek").length, 60);
  assert.equal([...t.values()].filter((x) => x.kind === "ek").length, 21);
});

test("migration: korumalar ve ad anahtarı (drizzle/0023 ile aynı)", () => {
  const sql = read(`drizzle/${migrationFile}`);
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM "ingredients"\)/, "boş veritabanına yazmaz (db:seed Excel'i yükler)");
  assert.match(sql, /ON CONFLICT \("month", "ingredient_id"\) DO NOTHING/, "panelden girilen sayımın üzerine yazmaz");
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM "stock_extras" x\s*WHERE x\."month" = '2026-10'/, "aynı adlı ek kalemi yinelemez");
  assert.match(sql, /"package_desc" ILIKE '%koli%'/, "koli satırı yalnız koliyle satılan pakette çarpılır");
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

test("belge migration'la aynı rakamları söyler (60 kalem, 21 ek kalem)", () => {
  const doc = read(DOC);
  const t = totals(lines(read(`drizzle/${migrationFile}`)));
  // Sayım listesi tablosu: | Grup | Kalem | Sayım | Kâğıtta |
  const listed = [...doc.matchAll(/^\| [A-ZÇĞİÖŞÜ&/ ()a-zşı]+ \| ([^|]+) \| ([^|]+) \| [^|]+ \|$/gm)]
    .map((m) => [m[1].trim(), m[2].trim()] as const)
    .filter(([name]) => t.has(name) && t.get(name)!.kind !== "ek");
  assert.equal(listed.length, 60);
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

// ---------------------------------------------------------------- Veritabanında

const SERVER_URL = process.env.SAYIM_TEST_DATABASE_URL ?? process.env.EKLE_TEST_DATABASE_URL;

describe("Ekim sayımı migration'ı veritabanında", { skip: !SERVER_URL && "SAYIM_TEST_DATABASE_URL yok" }, () => {
  const NAME = `laffogato_ekim_sayimi_${process.pid}`;
  let admin: postgres.Sql;
  let db: postgres.Sql;
  const ROLLBACK = new Error("geri al");
  const sql = () => read(`drizzle/${migrationFile}`);

  type Count = { name: string; qty: number; factor: number; counted_by: string };
  type Extra = { name: string; unit: string; qty: number; unit_price: number };
  type Trial = { counts: Map<string, Count>; extras: Extra[]; logs: string[] };

  /** Hazırlığı ve migration'ı (istenirse iki kez) işlemde çalıştırır, sonucu okur, hepsini geri alır */
  async function trial(prepare: (tx: postgres.TransactionSql) => Promise<unknown> = async () => {}, runs = 1): Promise<Trial> {
    let out: Trial | null = null;
    await db
      .begin(async (tx) => {
        await prepare(tx);
        const [{ id: logBefore }] = await tx<{ id: number }[]>`select coalesce(max(id), 0)::int as id from activity_log`;
        for (let i = 0; i < runs; i++) await tx.unsafe(sql());
        const counts = await tx<Count[]>`
          select i.name, c.qty, c.factor, c.counted_by from stock_counts c join ingredients i on i.id = c.ingredient_id
          where c.month = '2026-10'`;
        const extras = await tx<Extra[]>`select name, unit, qty, unit_price from stock_extras where month = '2026-10' order by id`;
        const logs = await tx<{ detail: string }[]>`select detail from activity_log where id > ${logBefore} and action = 'Stok sayımı' order by id`;
        out = { counts: new Map(counts.map((c) => [c.name, c])), extras: [...extras], logs: logs.map((l) => l.detail) };
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

  test("Excel verisinde: 60 kalem kendi çarpanıyla, 21 ek kalem fiyatsız ve kâğıt sırasıyla, tek işlem geçmişi satırı", async () => {
    const t = totals(lines(sql()));
    const r = await trial();
    assert.equal(r.counts.size, 60);
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
    assert.deepEqual(
      r.extras,
      [...t.entries()].filter(([, x]) => x.kind === "ek").map(([name, x]) => ({ name, unit: x.unit, qty: x.qty, unit_price: 0 })),
    );
    assert.deepEqual(r.logs, ["Ekim 2026: 31 Ekim sayım kâğıdından 60 kalem; 21 ek kalem (Listede olmayanlar; birim fiyatını yönetici girer)"]);
  });

  test("ikinci çalıştırma bir şey eklemez, işlem geçmişine yeniden yazmaz", async () => {
    const r = await trial(undefined, 2);
    assert.equal(r.counts.size, 60);
    assert.equal(r.extras.length, 21);
    assert.equal(r.logs.length, 1);
  });

  test("panelden girilmiş Ekim sayımı ve aynı adlı ek kalem olduğu gibi kalır", async () => {
    const r = await trial(async (tx) => {
      await tx`insert into stock_counts (month, ingredient_id, qty, factor, counted_by)
        select '2026-10', id, 30, 1000, 'Ayşe' from ingredients where name = 'Espresso çekirdeği'`;
      await tx`insert into stock_extras (month, name, unit, qty, unit_price) values ('2026-10', 'KRAFT ÇANTA', 'PAKET', 2, 150)`;
    });
    assert.deepEqual({ qty: r.counts.get("Espresso çekirdeği")?.qty, by: r.counts.get("Espresso çekirdeği")?.counted_by }, { qty: 30, by: "Ayşe" });
    assert.equal(r.counts.size, 60);
    assert.deepEqual(
      r.extras.filter((e) => looseKey(e.name) === looseKey("Kraft çanta")),
      [{ name: "KRAFT ÇANTA", unit: "PAKET", qty: 2, unit_price: 150 }],
    );
    assert.equal(r.extras.length, 21, "20 yeni + panelden girilen");
    assert.equal(r.logs.length, 1);
    assert.match(r.logs[0], /^Ekim 2026: 31 Ekim sayım kâğıdından 59 kalem; 20 ek kalem .+; 1 kalem panelde zaten sayılmıştı, dokunulmadı$/);
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
      // Peçetenin paketi artık koli değil: koli × paket yanlış olurdu
      await tx`update ingredients set package_desc = 'Peçete paketi 100 adet', package_size = 100 where name = 'Peçete'`;
      // Büyük harfle yazılmış ad yine eşleşir
      await tx`update ingredients set name = 'MATCHA' where name = 'Matcha'`;
    });
    assert.equal(r.counts.get("MATCHA")?.qty, 0.41, "büyük / küçük harf farkı eşleşir");
    for (const name of ["Frappe tozu", "Su (PET)", "Marlenka dilim", "Peçete", "Colombia (cold brew)"]) assert.ok(!r.counts.has(name), name);
    assert.equal(r.counts.size, 55);
    assert.deepEqual(
      r.extras.find((e) => e.name === "Cold brew kahve (Colombia)"),
      { name: "Cold brew kahve (Colombia)", unit: "KG", qty: 0.5, unit_price: 0 },
    );
    assert.equal(r.extras.length, 22);
    assert.match(r.logs[0] ?? "", /; elle girilecek: Frappe tozu, Marlenka dilim, Peçete, Su \(PET\)$/);
  });

  test("pasif ama aktif bir reçetede geçen kalem sayılır (sayım listesinde)", async () => {
    const r = await trial(async (tx) => {
      await tx`update ingredients set active = false where name = 'Espresso çekirdeği'`;
    });
    assert.equal(r.counts.get("Espresso çekirdeği")?.qty, 38);
  });
});
