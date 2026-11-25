// Vardiya: eski ekrandan kaydetme, gerçek Postgres'te (denetim bulgusu 46; src/server/vardiya/store.ts saveShiftWeek,
// src/server/actions/vardiya.ts). İki yönetici aynı haftayı açar; B'nin kaydı A'nın eski ekranından yapılan kayıtla
// silinmez. A'nın değiştirdiği kutuyu arada B de değiştirdiyse kayıt hiçbir şey yazmadan reddedilir.
//
// VARDIYA_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: VARDIYA_TEST_DATABASE_URL=postgres://ci:ci@localhost:5432/test npx tsx --test tests/vardiya-kayit-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { formatShiftCell, SHIFT_STALE } from "../src/lib/vardiya";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.VARDIYA_TEST_DATABASE_URL;
const DB_NAME = `laffogato_vardiya_${process.pid}`;
const MONDAY = "2026-11-23";
const E = ["", "", "", "", "", "", ""];

describe("vardiya kaydı: veritabanında", { skip: !SERVER_URL && "VARDIYA_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let action: typeof import("../src/server/actions/vardiya");
  let store: typeof import("../src/server/vardiya/store");
  let ayse: { id: number; name: string };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "vardiya-testi-icin-en-az-otuz-iki-karakterlik-anahtar-x" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const [u] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe Kaya", passwordHash: "x", role: "staff", branchId: "tuzla" }).returning();
    ayse = { id: u.id, name: u.name };
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    action = await import("../src/server/actions/vardiya");
    store = await import("../src/server/vardiya/store");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE shifts, activity_log RESTART IDENTITY CASCADE`);
  });

  const ref = () => `u:${ayse.id}`;
  /** Ekranın gördüğü: sayfanın yaptığı gibi kayıtlı plandan (loadShiftWeek → formatShiftCell) */
  const screen = async () => {
    const week = await store.loadShiftWeek(db, { id: "tuzla", name: "Tuzla" }, MONDAY, { roster: true });
    const row = week.rows.find((r) => r.ref === ref());
    assert.ok(row, "Ayşe ızgarada");
    return row.cells.map(formatShiftCell);
  };
  const save = (cells: string[], seen: string[] | undefined) =>
    action.saveShiftWeekAction({ branchId: "tuzla", week: MONDAY, rows: [{ ref: ref(), name: ayse.name, cells, ...(seen ? { seen } : {}) } as never] });
  const plan = async () =>
    (await db.select().from(s.shifts).where(and(eq(s.shifts.branchId, "tuzla"), eq(s.shifts.personRef, ref()))).orderBy(asc(s.shifts.date))).map(
      (r) => `${r.date} ${r.kind}${r.startMin === null ? "" : ` ${r.startMin}-${r.endMin}`} ${r.updatedByName}`,
    );

  test("A'nın eski ekranından kayıt B'nin değiştirdiği ve eklediği kutuları silmez; özet veritabanındaki plandan", async () => {
    const first = await save(["10-18", "10-18", "", "", "", "", ""], E);
    assert.ok(first.ok, first.ok ? "" : first.error);
    // A ve B haftayı açar
    const seenA = await screen();
    const seenB = await screen();
    assert.deepEqual(seenA, ["10:00–18:00", "10:00–18:00", "", "", "", "", ""]);
    // B: Salı izin, Çarşamba 12-20
    const b = await save(["10:00–18:00", "izin", "12-20", "", "", "", ""], seenB);
    assert.ok(b.ok, b.ok ? "" : b.error);
    assert.deepEqual([b.data.written, b.data.removed], [2, 0]);
    // A yalnız Perşembe'yi yazar; ekranında Salı hâlâ 10-18, Çarşamba boş
    const a = await save(["10:00–18:00", "10:00–18:00", "", "16-01", "", "", ""], seenA);
    assert.ok(a.ok, a.ok ? "" : a.error);
    assert.deepEqual([a.data.written, a.data.removed], [1, 0]);
    assert.equal(a.data.summary, "1 kişi · 3 vardiya · 1 izin", "özet kayıttan sonraki plandan (A'nın ekranından değil)");
    assert.deepEqual(await plan(), [
      "2026-11-23 work 600-1080 Yönetici",
      "2026-11-24 off Yönetici",
      "2026-11-25 work 720-1200 Yönetici",
      "2026-11-26 work 960-1500 Yönetici",
    ]);
  });

  test("A'nın değiştirdiği kutuyu arada B de değiştirdiyse hiçbir şey yazılmaz: 'Plan siz bakarken değişti'", async () => {
    assert.ok((await save(["10-18", "10-18", "", "", "", "", ""], E)).ok);
    const seenA = await screen();
    assert.ok((await save(["10:00–18:00", "izin", "", "", "", "", ""], await screen())).ok, "B Salı'yı izin yaptı");
    const before = await plan();
    // A hem Pazartesi'yi hem Salı'yı değiştirir: Salı çakışır, Pazartesi de yazılmaz (tek işlem)
    const a = await save(["09-17", "12-20", "", "", "", "", ""], seenA);
    assert.equal(a.ok, false);
    assert.equal(a.ok ? "" : a.error, "Plan siz bakarken değişti (Ayşe Kaya, Salı), sayfayı yenileyin.");
    assert.deepEqual(await plan(), before);
    // Boşaltmak da B'nin iznini silmez
    const clear = await save(["10:00–18:00", "", "", "", "", "", ""], seenA);
    assert.equal(clear.ok, false);
    assert.deepEqual(await plan(), before);
    // Yenileyince (güncel ekranla) yazılır
    const again = await save(["09-17", "12-20", "", "", "", "", ""], await screen());
    assert.ok(again.ok, again.ok ? "" : again.error);
    assert.deepEqual(await plan(), ["2026-11-23 work 540-1020 Yönetici", "2026-11-24 work 720-1200 Yönetici"]);
  });

  test("`seen` göndermeyen eski sekmenin kaydı yenileme metniyle reddedilir, plan değişmez", async () => {
    assert.ok((await save(["10-18", "", "", "", "", "", ""], E)).ok);
    const old = await save(["", "", "", "", "", "", ""], undefined);
    assert.equal(old.ok, false);
    assert.equal(old.ok ? "" : old.error, SHIFT_STALE);
    assert.deepEqual(await plan(), ["2026-11-23 work 600-1080 Yönetici"]);
  });
});
