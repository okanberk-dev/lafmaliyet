// Derleme öncesi hazırlığın (scripts/predeploy.ts) boş veritabanındaki davranışı, betiğin kendisiyle ve gerçek Postgres'te
// (26 Kasım 2026): canlı derleme boş veritabanına başlangıç verisini (maaşlar, kira, faturalar, satışlar) kendiliğinden
// YAZMAZ. Migration'lar, ilk yönetici, şube kütüğü ve hazır kontrol listeleri yazılır, derleme uyarıyla 0 koduyla biter.
// `SEED_ON_EMPTY=1` ile bilerek yüklenir; yerel derleme (bu bilgisayardaki Postgres, canlı değil) bugünkü gibi yükler.
// Her test kendi geçici veritabanını açar, sonunda siler.
//
// TOHUM_TEST_DATABASE_URL verilmezse atlanır (veritabanı oluşturabilen bir kullanıcıyla herhangi bir veritabanı).
// Çalıştırma: TOHUM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/predeploy-db.test.ts
// (npm run test:db bunu da koşar.)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";

import postgres from "postgres";

import { readJournal } from "../scripts/migration-check";
import { emptySeedWarning } from "../scripts/predeploy-guard";
import { DEFAULT_BRANCHES } from "../src/lib/branches";

import { readSeedData } from "./fixtures/baslangic";

const SERVER_URL = process.env.TOHUM_TEST_DATABASE_URL;
const PREFIX = `laffogato_tohum_test_${process.pid}`;

/** Betiği ayrı süreçte koşar: yalnız verilen değişkenlerle (canlının adresi ve .env.local'ın hedefi karışmasın) */
function predeploy(url: string, extra: Record<string, string>) {
  const env: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: url, ADMIN_EMAIL: "tohum@ornek.test", ADMIN_PASSWORD: "tohum-testi-parolasi", ...extra };
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/predeploy.ts"], { cwd: process.cwd(), encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 180_000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("predeploy: boş veritabanı", { skip: !SERVER_URL && "TOHUM_TEST_DATABASE_URL tanımlı değil" }, () => {
  let admin: postgres.Sql;
  const databases: string[] = [];
  const clients: postgres.Sql[] = [];
  const seed = readSeedData();

  /** Boş geçici veritabanı: adresi ve tek bağlantılı istemcisi */
  async function freshDb(name: string): Promise<{ url: string; sql: postgres.Sql }> {
    const db = `${PREFIX}_${name}`;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${db}`);
    databases.push(db);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${db}`;
    const sql = postgres(url.href, { max: 1, onnotice: () => {} });
    clients.push(sql);
    return { url: url.href, sql };
  }

  async function counts(sql: postgres.Sql) {
    const [r] = await sql<{ ingredients: number; products: number; invoices: number; staff: number; fixed: number; settings: number; sales: number; branches: number; lists: number; users: number; migrations: number }[]>`
      select (select count(*) from ingredients)::int as ingredients, (select count(*) from products)::int as products,
        (select count(*) from invoices)::int as invoices, (select count(*) from staff)::int as staff,
        (select count(*) from fixed_expenses)::int as fixed, (select count(*) from settings)::int as settings,
        (select count(*) from sales_lines)::int as sales, (select count(*) from branches)::int as branches,
        (select count(*) from checklist_templates)::int as lists, (select count(*) from users)::int as users,
        (select count(*) from drizzle.__drizzle_migrations)::int as migrations`;
    return r;
  }

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
  });

  after(async () => {
    for (const c of clients) await c.end();
    for (const db of databases) await admin.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin?.end();
  });

  test("canlı derleme: migration'lar, yönetici, şubeler ve kontrol listeleri yazılır; kişisel veri yazılmaz, uyarıyla biter", async () => {
    const { url, sql } = await freshDb("canli");
    const live = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" };
    const r = predeploy(url, live);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes(`! ${emptySeedWarning("canlı derleme (VERCEL_ENV=production)")}`), r.out);
    assert.doesNotMatch(r.out, /Başlangıç verisi yüklendi/);
    const c = await counts(sql);
    assert.equal(c.migrations, readJournal().length, "bütün migration'lar");
    assert.deepEqual(
      { ingredients: c.ingredients, products: c.products, invoices: c.invoices, staff: c.staff, fixed: c.fixed, settings: c.settings, sales: c.sales },
      { ingredients: 0, products: 0, invoices: 0, staff: 0, fixed: 0, settings: 0, sales: 0 },
      "maaş, kira, fatura, satış yok",
    );
    assert.equal(c.branches, DEFAULT_BRANCHES.length, "şube kütüğü");
    assert.ok(c.lists > 0, "hazır kontrol listeleri");
    assert.equal(c.users, 1, "ilk yönetici");
    // İkinci derleme de bir şey yüklemez (veritabanı hâlâ boş sayılır), yönetici ve listeler çoğalmaz
    const again = predeploy(url, live);
    assert.equal(again.status, 0, again.out);
    assert.deepEqual(await counts(sql), c);
    // NODE_ENV=production da canlı sayılır (Vercel dışı bir sunucu)
    const node = predeploy(url, { NODE_ENV: "production" });
    assert.equal(node.status, 0, node.out);
    assert.ok(node.out.includes("canlı ortam (NODE_ENV=production)"), node.out);
    assert.equal((await counts(sql)).ingredients, 0);
  });

  test("SEED_ON_EMPTY=1: canlı derleme boş veritabanına başlangıç verisini bilerek yükler, uyarı yazar", async () => {
    const { url, sql } = await freshDb("bilerek");
    const r = predeploy(url, { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", SEED_ON_EMPTY: "1" });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /! SEED_ON_EMPTY=1: veritabanı boşsa başlangıç verisi \(maaşlar, kira, faturalar, satışlar\) yüklenir/);
    assert.match(r.out, /✓ Başlangıç verisi yüklendi: /);
    const c = await counts(sql);
    assert.equal(c.products, seed.products.length);
    assert.equal(c.staff, seed.staff.length);
    assert.equal(c.invoices, seed.invoices.length);
    assert.equal(c.branches, DEFAULT_BRANCHES.length);
  });

  test("yerel derleme (bu bilgisayardaki Postgres, canlı değil): bugünkü gibi yükler; SEED_ON_EMPTY=0 ile yüklemez", async () => {
    const { url, sql } = await freshDb("yerel");
    const off = predeploy(url, { SEED_ON_EMPTY: "0" });
    assert.equal(off.status, 0, off.out);
    assert.ok(off.out.includes(emptySeedWarning("SEED_ON_EMPTY=0")), off.out);
    assert.equal((await counts(sql)).ingredients, 0);
    const r = predeploy(url, {});
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /SEED_ON_EMPTY=1:/, "yerelde uyarı yok");
    assert.match(r.out, /✓ Başlangıç verisi yüklendi: /);
    const c = await counts(sql);
    assert.equal(c.products, seed.products.length);
    assert.equal(c.staff, seed.staff.length);
  });
});
