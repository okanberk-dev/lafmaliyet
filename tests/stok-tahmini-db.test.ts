// Tahmini stoğun LafPOS başlangıcı gerçek Postgres'te (docs/STOK-TAHMINI.md): geçiş ayında Marina'nın ModPOS listesi
// ayın bir gününde bitiyorsa (sales.coverage, integration_state'te) LafPOS satışları ertesi günden sayılır. Kayıt
// settings'te aranırsa hep boş kalıyordu ve başlangıç sonraki ayın 1'ine kayıyordu.
//
// Kendi geçici veritabanını açar (STOK_TAHMINI_TEST_DATABASE_URL'in sunucusunda), sonunda siler. Değişken yoksa atlanır.
// Çalıştırma: STOK_TAHMINI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/stok-tahmini-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { SALES_COVERAGE_KEY } from "../src/lib/sales-coverage";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.STOK_TAHMINI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_stok_tahmini_${process.pid}`;
const NOW = new Date("2026-11-25T12:00:00+03:00");

describe("Tahmini stok: LafPOS'un sayıldığı ilk gün", { skip: !SERVER_URL && "STOK_TAHMINI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let estimate: typeof import("../src/server/data/stock-estimate");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "stok-tahmini-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    estimate = await import("../src/server/data/stock-estimate");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("geçiş ayında ModPOS listesi 20 Kasım'da bitiyorsa LafPOS 21 Kasım'dan sayılır", async () => {
    await db.insert(s.settings).values({ key: "lafposGecisGunu", value: "2026-11-21" });
    await db.insert(s.months).values({ month: "2026-11", branchId: LAFPOS_SUBE }).onConflictDoNothing();
    await db.insert(s.salesLines).values({ month: "2026-11", branchId: LAFPOS_SUBE, posName: "LATTE", qty: 10, revenue: 1_000 });
    await db.insert(s.integrationState).values({ key: SALES_COVERAGE_KEY, value: { "2026-11": "2026-11-20" } });
    const r = await estimate.loadStockEstimate(db, NOW);
    assert.ok(r, "geçiş günü var: tahmin döner");
    assert.equal(r.switchDay, "2026-11-21");
    assert.equal(r.lafposFrom, "2026-11-21");
  });
});
