// Şube seçiliyken SİLME ENGELLERİ: gerçek Postgres'te (src/server/actions/costs.ts dataMonths).
//
// Engeller işletme genelidir: Marina seçiliyken Tuzla'da maaş hesabına girmiş personel ya da kâr/zarar hesabına
// girmiş sabit gider SİLİNEMEMELİ. dataMonths şube seçimine göre süzülürse `past` boşalır, staffUsedMonths hiçbir
// ay bulmaz ve engel sessizce kalkar (docs/SUBE.md › Neyi süzer, neyi süzmez).
//
// Arayüzün listeyi süzmesi yeterli değil: kural sunucuda denetlenir, istemcideki gizleme yalnız kolaylıktır.
// Bu test de zaten eylemi doğrudan çağırıyor, ekrandan geçmiyor.
//
// SUBE_TEST_DATABASE_URL (yoksa SAYIM_TEST_DATABASE_URL ya da EKLE_TEST_DATABASE_URL) verilmezse atlanır.
// Çalıştırma: SUBE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres npx tsx --test tests/sube-silme-engeli-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { ALL_BRANCHES, DEFAULT_BRANCHES } from "../src/lib/branches";
import * as s from "../src/server/db/schema";

const SERVER_URL =
  process.env.SUBE_TEST_DATABASE_URL ?? process.env.SAYIM_TEST_DATABASE_URL ?? process.env.EKLE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_engel_${process.pid}`;

describe("şube seçiliyken silme engelleri: veritabanında", { skip: !SERVER_URL && "SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let costs: typeof import("../src/server/actions/costs");
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      AUTH_SECRET: "sube-engel-testi-icin-en-az-otuz-iki-karakterlik-anahtar",
    });
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
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    const [a] = await db
      .insert(s.users)
      .values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" })
      .returning();
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { requireUser: me, requireAdmin: me });
    costs = await import("../src/server/actions/costs");
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE staff, staff_versions, months, fixed_expenses, pnl_entries, activity_log RESTART IDENTITY CASCADE`);
    // Tuzla'nın kapanmış, açık günü olan ayı: maaş hesabı bu aya girdi
    await db.insert(s.months).values({ month: "2026-09", branchId: "tuzla", openDays: 30 });
  });

  /** Ay aralığı boş personel = bütün aylarda hesaba girer */
  const tuzlaPersoneli = async () => {
    const [row] = await db
      .insert(s.staff)
      .values({ name: "Personel 1", branchId: "tuzla", netSalary: 40_000, sortOrder: 1 })
      .returning({ id: s.staff.id });
    return row.id;
  };

  test("Marina seçiliyken Tuzla'da maaş hesabına girmiş personel silinemez", async () => {
    const id = await tuzlaPersoneli();
    const res = await withBranchScope("marina", () => costs.saveStaff([], [id]));
    assert.equal(res.ok, false, "Marina seçiliyken Tuzla personeli silinebildi: silme engeli şubeye göre süzülmüş");
    assert.match(res.ok ? "" : res.error, /maaş hesabına girdi/);
    const kalan = await db.select({ id: s.staff.id }).from(s.staff);
    assert.equal(kalan.length, 1, "kayıt gerçekten silinmiş");
  });

  test("aynı engel Tuzla ve Tümü seçiliyken de geçerli (kural şubeye bağlı değil)", async () => {
    for (const scope of ["tuzla", ALL_BRANCHES]) {
      const id = await tuzlaPersoneli();
      const res = await withBranchScope(scope, () => costs.saveStaff([], [id]));
      assert.equal(res.ok, false, `${scope} seçiliyken engel çalışmadı`);
      await db.execute(sql`TRUNCATE staff, staff_versions RESTART IDENTITY CASCADE`);
    }
  });

  test("hesaba girmemiş personel her şubede silinebilir: engel fazla geniş değil", async () => {
    // Ayı olmayan bir dönemde başlayıp biten personel hiçbir ayın hesabına girmez
    const [row] = await db
      .insert(s.staff)
      .values({ name: "Kısa süreli", branchId: "tuzla", netSalary: 1, sortOrder: 2, startMonth: "2026-01", endMonth: "2026-01" })
      .returning({ id: s.staff.id });
    const res = await withBranchScope("marina", () => costs.saveStaff([], [row.id]));
    assert.equal(res.ok, true, res.ok ? "" : res.error);
    const kalan = await db.select({ id: s.staff.id }).from(s.staff);
    assert.equal(kalan.length, 0);
  });
});
