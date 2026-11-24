// Satışlar ve Gelir-gider'in ay yazımları formun şubesine (24 Kasım 2026 şube kapsamı, plan › A1.1 ve A1.2;
// docs/SUBE.md › Yazarken hangi şube), gerçek Postgres'te:
//
// - ay bilgisi, satış listesi ve elle satır formun gönderdiği şubeye iner; gönderim anındaki seçim (çerez; testte
//   withBranchScope) yazımın şubesini seçmez;
// - "Tümü"de birden çok kasa açıkken şubeyi göndermeyen yazım reddedilir (sessizce Tuzla'ya inmez);
// - online kanal seçiliyken kasa satışı yazılmaz (ay "online" şubesine inmez);
// - "Ayı temizle" pencerenin gösterdiği kapsamla siler: seçim başka sekmede değiştiyse ya da liste bu arada değiştiyse red;
// - Gelir-gider'in ciro, açık gün ve ay notu hücreleri de aynı kapıdan (formun şubesi; Tümü'de not da kilitli).
//
// SATIS_SUBE_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SATIS_SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/satis-sube-form-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES, BRANCH_REQUIRED, MONTH_TOTALS_LOCKED_TEXT, SCOPE_CHANGED } from "../src/lib/branches";
import * as s from "../src/server/db/schema";
import { seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.SATIS_SUBE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_satis_sube_${process.pid}`;
const MONTH = "2025-10";
const ONLINE_SALES = "laffogato.net kanalının kasa satışı yok; soldan şubeyi seçin";

describe("Satışlar ve Gelir-gider: formun şubesi (veritabanında)", { skip: !SERVER_URL && "SATIS_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let sales: typeof import("../src/server/actions/sales");
  let pnl: typeof import("../src/server/actions/pnl");
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "satis-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => a;
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    sales = await import("../src/server/actions/sales");
    pnl = await import("../src/server/actions/pnl");
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE sales_lines, months, integration_state, activity_log RESTART IDENTITY CASCADE`);
  });

  const monthRows = async () =>
    (await db.select({ b: s.months.branchId, pos: s.months.posRevenue, days: s.months.openDays, note: s.months.note }).from(s.months).where(eq(s.months.month, MONTH))).sort((x, y) =>
      x.b.localeCompare(y.b),
    );
  const linesOf = async (branch: string) =>
    (await db.select({ name: s.salesLines.posName }).from(s.salesLines).where(and(eq(s.salesLines.month, MONTH), eq(s.salesLines.branchId, branch)))).map((r) => r.name).sort();
  const info = { month: MONTH, openDays: 30, posRevenue: 100_000, discounts: null, offRevenue: null, cardShare: null, note: null };
  const list = (name: string) => [{ posName: name, qty: 10, revenue: 1_000 }];

  test("ay bilgisi, liste ve elle satır formun şubesine; seçim başka şubedeyken de", async () => {
    // Çerez Marina'da (başka sekmede değişti), form Tuzla'nın: hepsi Tuzla'ya
    const saved = await withBranchScope("marina", () => sales.saveMonthInfo({ ...info, branchId: "tuzla" }));
    assert.ok(saved.ok, JSON.stringify(saved));
    const imported = await withBranchScope("marina", () => sales.importSales({ month: MONTH, lines: list("TUZLA LATTE"), mode: "replace", branchId: "tuzla" }));
    assert.ok(imported.ok, JSON.stringify(imported));
    const line = await withBranchScope("marina", () => sales.saveLine({ id: null, month: MONTH, posName: "TUZLA MOCHA", qty: 1, revenue: 100, branchId: "tuzla" }));
    assert.ok(line.ok, JSON.stringify(line));
    assert.deepEqual(await monthRows(), [{ b: "tuzla", pos: 100_000, days: 30, note: null }]);
    assert.deepEqual(await linesOf("tuzla"), ["TUZLA LATTE", "TUZLA MOCHA"]);
    assert.deepEqual(await linesOf("marina"), [], "Marina'ya liste inmedi");
    // "Yenisiyle değiştir" yalnız formun şubesinin listesini değiştirir
    assert.ok((await withBranchScope(ALL_BRANCHES, () => sales.importSales({ month: MONTH, lines: list("MARINA LATTE"), mode: "replace", branchId: "marina" }))).ok);
    assert.ok((await withBranchScope("marina", () => sales.importSales({ month: MONTH, lines: list("TUZLA FLAT WHITE"), mode: "replace", branchId: "tuzla" }))).ok);
    assert.deepEqual(await linesOf("tuzla"), ["TUZLA FLAT WHITE"]);
    assert.deepEqual(await linesOf("marina"), ["MARINA LATTE"]);
    // Şubeyi göndermeyen eski sekme tek şube seçiliyken o şubeye yazar
    assert.ok((await withBranchScope("marina", () => sales.saveLine({ id: null, month: MONTH, posName: "MARINA MOCHA", qty: 1, revenue: 100 }))).ok);
    assert.deepEqual(await linesOf("marina"), ["MARINA LATTE", "MARINA MOCHA"]);
  });

  test("'Tümü'de şubesiz yazım reddedilir; kanal ve bilinmeyen şube de", async () => {
    for (const run of <(() => Promise<unknown>)[]>[
      () => sales.importSales({ month: MONTH, lines: list("X"), mode: "replace" }),
      () => sales.saveMonthInfo(info),
      () => sales.saveLine({ id: null, month: MONTH, posName: "X", qty: 1, revenue: 1 }),
    ]) {
      assert.deepEqual(await withBranchScope(ALL_BRANCHES, run), { ok: false, error: BRANCH_REQUIRED });
    }
    // Online kanal seçiliyken dört yazım (liste, ay bilgisi, elle satır, Gelir-gider cirosu) reddedilir
    for (const run of <(() => Promise<unknown>)[]>[
      () => sales.importSales({ month: MONTH, lines: list("X"), mode: "replace" }),
      () => sales.saveMonthInfo(info),
      () => sales.saveLine({ id: null, month: MONTH, posName: "X", qty: 1, revenue: 1 }),
    ]) {
      assert.deepEqual(await withBranchScope("online", run), { ok: false, error: ONLINE_SALES });
    }
    const pnlOnline = await withBranchScope("online", () => pnl.setMonthField(MONTH, "posRevenue", 5_000));
    assert.equal(pnlOnline.ok, false);
    // Form kanalı gönderse de
    assert.deepEqual(await sales.saveMonthInfo({ ...info, branchId: "online" }), { ok: false, error: ONLINE_SALES });
    assert.deepEqual(await sales.importSales({ month: MONTH, lines: list("X"), mode: "replace", branchId: "yok" }), {
      ok: false,
      error: "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin",
    });
    assert.deepEqual(await monthRows(), [], "hiçbir ay satırı açılmadı");
    assert.equal((await db.select().from(s.salesLines)).length, 0);
  });

  test("Ayı temizle pencerenin kapsamıyla: seçim değiştiyse ya da satır sayısı tutmazsa red", async () => {
    await sales.importSales({ month: MONTH, lines: list("TUZLA LATTE"), mode: "replace", branchId: "tuzla" });
    await sales.importSales({ month: MONTH, lines: [...list("MARINA LATTE"), ...list("MARINA MOCHA")], mode: "replace", branchId: "marina" });
    // Marina'nın penceresi açık, başka sekmede Tümü seçildi: hiçbir şey silinmez
    assert.deepEqual(await withBranchScope(ALL_BRANCHES, () => sales.clearMonthSales(MONTH, { scope: "marina", count: 2 })), { ok: false, error: SCOPE_CHANGED });
    // Pencerenin saydığı satır sayısı tutmuyor (liste bu arada değişti)
    assert.deepEqual(await withBranchScope("marina", () => sales.clearMonthSales(MONTH, { scope: "marina", count: 1 })), {
      ok: false,
      error: "Ayın satırları bu arada değişti; sayfayı yenileyin.",
    });
    assert.deepEqual(await linesOf("marina"), ["MARINA LATTE", "MARINA MOCHA"]);
    // Tutunca yalnız Marina'nınki gider; boşalan ay satırı kalkar, Tuzla'nınki kalır
    const ok = await withBranchScope("marina", () => sales.clearMonthSales(MONTH, { scope: "marina", count: 2 }));
    assert.deepEqual(ok, { ok: true, data: { deleted: 2, monthRemoved: true } });
    assert.deepEqual(await linesOf("marina"), []);
    assert.deepEqual(await linesOf("tuzla"), ["TUZLA LATTE"]);
    assert.deepEqual((await monthRows()).map((r) => r.b), ["tuzla"]);
    // "Tümü"de bütün şubeler (ekran da hepsini gösterir)
    assert.ok((await withBranchScope(ALL_BRANCHES, () => sales.clearMonthSales(MONTH, { scope: ALL_BRANCHES, count: 1 }))).ok);
    assert.equal((await db.select().from(s.salesLines)).length, 0);
  });

  test("Gelir-gider: hücre formun şubesine; Tümü'de şubesiz ciro ve ay notu reddedilir", async () => {
    // Çerez Tümü'de, Marina'nın sayfası açık kalmış: ciro ve not Marina'ya
    assert.ok((await withBranchScope(ALL_BRANCHES, () => pnl.setMonthField(MONTH, "posRevenue", 42_000, "marina"))).ok);
    assert.ok((await withBranchScope("tuzla", () => pnl.setMonthNote(MONTH, "Marina'nın notu", "marina"))).ok);
    assert.deepEqual(await monthRows(), [{ b: "marina", pos: 42_000, days: null, note: "Marina'nın notu" }]);
    // Şubeyi göndermeyen eski sekme Tümü'de: ciro da not da yazılmaz (Tuzla'ya inmez)
    assert.deepEqual(await withBranchScope(ALL_BRANCHES, () => pnl.setMonthField(MONTH, "openDays", 20)), { ok: false, error: MONTH_TOTALS_LOCKED_TEXT });
    assert.deepEqual(await withBranchScope(ALL_BRANCHES, () => pnl.setMonthNote(MONTH, "Tuzla'ya inerdi")), { ok: false, error: MONTH_TOTALS_LOCKED_TEXT });
    // Tek şube seçiliyken eski sekme o şubeye yazar
    assert.ok((await withBranchScope("tuzla", () => pnl.setMonthField(MONTH, "openDays", 20))).ok);
    assert.deepEqual(await monthRows(), [
      { b: "marina", pos: 42_000, days: null, note: "Marina'nın notu" },
      { b: "tuzla", pos: null, days: 20, note: null },
    ]);
  });

  test("kaynak: Satışlar'ın yazımları çerezin şubesini okumaz", () => {
    const src = readFileSync(join(__dirname, "..", "src/server/actions/sales.ts"), "utf8");
    assert.doesNotMatch(src, /currentWriteBranch\(/);
    assert.doesNotMatch(src, /currentBranchWhere\(/);
    assert.match(src, /const salesBranch = \(raw: unknown\) => formBranch\(zFormBranch\.parse\(raw\), "sales", \{ requireExplicit: true \}\);/);
  });
});
