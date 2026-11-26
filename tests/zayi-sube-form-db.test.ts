// Zayi ve ikram formun şubesine (24 Kasım 2026 şube kapsamı, plan › A1.4; docs/SUBE.md › Yazarken hangi şube), gerçek
// Postgres'te: kayıt ve geç kayıt isteği formun gönderdiği şubeye iner, gönderim anındaki seçim (çerez; testte
// withBranchScope) şubeyi seçmez. "Tümü"de birden çok kasa açıkken şubesiz kayıt reddedilir; kanal ve başka şubeye kilitli
// personel reddedilir. Şubeyi göndermeyen eski sekme tek şube seçiliyken o şubeye yazar.
//
// ZAYI_SUBE_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: ZAYI_SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/zayi-sube-form-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES, BRANCH_REQUIRED } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import { addDays } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";
import { seedBranches } from "./helpers/subeler";
import { dalCapabilities } from "./helpers/dal-stub";

const SERVER_URL = process.env.ZAYI_SUBE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_zayi_sube_${process.pid}`;

describe("zayi ve ikram: formun şubesi (veritabanında)", { skip: !SERVER_URL && "ZAYI_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let waste: typeof import("../src/server/actions/waste");
  let requests: typeof import("../src/server/actions/waste-requests");
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  const who: { role: "admin" | "staff"; branchId: string | null } = { role: "admin", branchId: null };
  let milk = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "zayi-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    const [p] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe", passwordHash: "x", role: "staff" }).returning();
    // Şube kilidi oturumdan okunur (src/server/branch-scope.ts lockedBranch)
    const me = async () => (who.role === "admin" ? a : { ...p, branchId: who.branchId });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me, ...dalCapabilities(me) });
    waste = await import("../src/server/actions/waste");
    requests = await import("../src/server/actions/waste-requests");
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
    const [ing] = await db
      .insert(s.ingredients)
      .values({ name: "Süt", category: "Süt", unit: "ml", packagePrice: 40, packageSize: 1000, priceSource: "manual", countUnit: "LT", countGroup: "SÜT" })
      .returning({ id: s.ingredients.id });
    milk = ing.id;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE waste_entries, staff_requests, activity_log RESTART IDENTITY CASCADE`);
    Object.assign(who, { role: "admin", branchId: null });
  });

  const today = businessDate();
  const entry = (branchId?: string) => ({
    date: today,
    kind: "zayi" as const,
    productId: null,
    ingredientId: milk,
    qty: 1,
    reason: null,
    note: null,
    clientKey: null,
    ...(branchId !== undefined ? { branchId } : {}),
  });
  const branches = async () => (await db.select({ b: s.wasteEntries.branchId }).from(s.wasteEntries)).map((r) => r.b).sort();

  test("kayıt formun şubesine; Tümü'de şubesiz, kanal ve bilinmeyen şube reddedilir", async () => {
    // Çerez Marina'da (başka sekmede değişti), form Tuzla'nın
    const r = await withBranchScope("marina", () => waste.addWasteEntry(entry("tuzla")));
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(await branches(), ["tuzla"]);
    // Şubeyi göndermeyen eski sekme: tek şube seçiliyken o şube; "Tümü"de red (sessizce Tuzla'ya inmez)
    assert.ok((await withBranchScope("marina", () => waste.addWasteEntry(entry()))).ok);
    assert.deepEqual(await withBranchScope(ALL_BRANCHES, () => waste.addWasteEntry(entry())), { ok: false, error: BRANCH_REQUIRED });
    assert.deepEqual(await withBranchScope("online", () => waste.addWasteEntry(entry())), { ok: false, error: BRANCH_REQUIRED });
    assert.deepEqual(await waste.addWasteEntry(entry("online")), { ok: false, error: "laffogato.net kanalının zayisi olmaz; sayfayı yenileyin" });
    assert.deepEqual(await waste.addWasteEntry(entry("yok")), { ok: false, error: "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin" });
    assert.deepEqual(await branches(), ["marina", "tuzla"]);
  });

  test("Tuzla'ya kilitli personel Marina'ya yazamaz; geç kayıt isteği formun şubesini taşır", async () => {
    Object.assign(who, { role: "staff", branchId: "tuzla" });
    assert.deepEqual(await waste.addWasteEntry(entry("marina")), { ok: false, error: "Hesabınız Tuzla şubesinde; Marina zayisine yazamazsınız" });
    assert.ok((await waste.addWasteEntry(entry("tuzla"))).ok);
    // Şubesiz personel, çerez Tuzla'da: Marina'nın formundan geç kayıt isteği
    Object.assign(who, { role: "staff", branchId: null });
    const late = await withBranchScope("tuzla", () =>
      requests.requestLateWaste({ ...entry("marina"), date: addDays(today, -3), message: "Akşam girmeyi unuttum", clientKey: "zayi-sube-gec-1" }),
    );
    assert.ok(late.ok, JSON.stringify(late));
    const [req] = await db.select({ payload: s.staffRequests.payload }).from(s.staffRequests);
    assert.equal((req.payload as { branchId: string }).branchId, "marina");
    assert.deepEqual(
      await withBranchScope(ALL_BRANCHES, () => requests.requestLateWaste({ ...entry(), date: addDays(today, -3), message: "Unuttum", clientKey: "zayi-sube-gec-2" })),
      { ok: false, error: BRANCH_REQUIRED },
    );
  });
});
