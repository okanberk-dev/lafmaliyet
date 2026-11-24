// Personel Faz 5, gerçek Postgres'te (src/server/actions/costs.ts saveStaff, src/server/data/dataset.ts): yemek kartı ve
// günlük ücret maaşla sürümlenir; part-time'ın çağrıldığı gün Vardiya'nın çalışma günlerinden (şube + kişi anahtarı) okunur;
// maaş satırının Vardiya / hesap bağlantısı yalnız açık seçimle, doğrulanarak (hesap var mı, şubeye kilitli mi, aynı kişi
// aynı ayda iki satırda mı) kurulur; maaş hesabına girmiş satırın türü değişmez.
//
// PERSONEL_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: PERSONEL_TEST_DATABASE_URL=postgres://ci:ci@localhost:5432/test npx tsx --test tests/personel-baglanti-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.PERSONEL_TEST_DATABASE_URL;
const DB_NAME = `laffogato_personel_${process.pid}`;

describe("personel Faz 5: veritabanında", { skip: !SERVER_URL && "PERSONEL_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let costs: typeof import("../src/server/actions/costs");
  let dataset: typeof import("../src/server/data/dataset");
  let users: { admin: number; ayse: number; tuzlaKilitli: number };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "personel-testi-icin-en-az-otuz-iki-karakterlik-anahtar-x" });
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
    const [ayse] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe Kaya", passwordHash: "x", role: "staff", branchId: "marina" }).returning();
    const [t] = await db.insert(s.users).values({ email: "tuzla@laffogato.net", name: "Tuzla Personeli", passwordHash: "x", role: "staff", branchId: "tuzla" }).returning();
    users = { admin: a.id, ayse: ayse.id, tuzlaKilitli: t.id };
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    costs = await import("../src/server/actions/costs");
    dataset = await import("../src/server/data/dataset");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE staff, staff_versions, shifts, months, pnl_entries, activity_log RESTART IDENTITY CASCADE`);
  });

  const part = (p: Record<string, unknown> = {}) => ({
    id: null,
    name: "Ayşe",
    netSalary: 0,
    extras: 2_000,
    mealCard: true,
    kind: "part_time" as const,
    dailyWage: 1_500,
    userId: users.ayse,
    effectiveFrom: "2026-12",
    branchId: "marina",
    ...p,
  });

  test("part-time satırı kaydedilir; çağrıldığı gün Vardiya'dan (yalnız o şube, çalışma günü), maliyet brütleştirilmeden", async () => {
    const res = await costs.saveStaff([part()]);
    assert.ok(res.ok, res.ok ? "" : res.error);
    const [row] = await db.select().from(s.staff);
    assert.deepEqual([row.kind, row.dailyWage, row.mealCard, row.userId, row.personRef, row.branchId], ["part_time", 1_500, true, users.ayse, null, "marina"]);
    const ref = `u:${users.ayse}`;
    await db.insert(s.shifts).values([
      { branchId: "marina", date: "2026-12-01", personRef: ref, userId: users.ayse, personName: "Ayşe Kaya", kind: "work", startMin: 600, endMin: 1080 },
      { branchId: "marina", date: "2026-12-02", personRef: ref, userId: users.ayse, personName: "Ayşe Kaya", kind: "work", startMin: 600, endMin: 1080 },
      { branchId: "marina", date: "2026-12-03", personRef: ref, userId: users.ayse, personName: "Ayşe Kaya", kind: "off" },
      { branchId: "tuzla", date: "2026-12-04", personRef: ref, userId: users.ayse, personName: "Ayşe Kaya", kind: "work", startMin: 600, endMin: 1080 },
      { branchId: "marina", date: "2026-12-05", personRef: ref, userId: users.ayse, personName: "Ayşe Kaya", kind: "work", startMin: 600, endMin: 1080 },
    ]);
    const model = await dataset.loadModel({ scope: "marina" });
    const r = model.personnelFor("2026-12").rows.find((x) => x.staff.name === "Ayşe")!;
    assert.equal(r.calledDays, 3, "Marina'daki üç çalışma günü (izin ve Tuzla'daki gün sayılmaz)");
    assert.equal(r.total, 3 * 1_500 + 3 * 330 + 2_000);
    assert.equal(r.gross, 0);
  });

  test("bağlantı doğrulanır: olmayan hesap, başka şubeye kilitli hesap, aynı ayda iki satır reddedilir; aralığı ayrık satırlar bağlanabilir", async () => {
    const missing = await costs.saveStaff([part({ userId: 99_999 })]);
    assert.equal(missing.ok, false);
    assert.match(missing.ok ? "" : missing.error, /hesabı bulunamadı/);
    const locked = await costs.saveStaff([part({ userId: users.tuzlaKilitli })]);
    assert.equal(locked.ok, false);
    assert.match(locked.ok ? "" : locked.error, /başka bir şubeye kilitli/);
    const both = await costs.saveStaff([part({ personRef: "n:ayse" })]);
    assert.equal(both.ok, false, "hem hesap hem ad seçilemez");
    assert.equal(await db.$count(s.staff), 0, "hiçbiri yazılmadı");

    assert.ok((await costs.saveStaff([part()])).ok);
    const twice = await costs.saveStaff([...(await current()), part({ name: "Ayşe (ikinci)" })]);
    assert.equal(twice.ok, false);
    assert.match(twice.ok ? "" : twice.error, /aynı aylarda "Ayşe" maaş satırına bağlı/);
    // Eski satır Kasım'da bitti; yeni satır Aralık'tan aynı hesaba bağlanabilir (aralıklar ayrık)
    await db.update(s.staff).set({ startMonth: "2026-10", endMonth: "2026-11" });
    const later = await costs.saveStaff([...(await current()), part({ name: "Ayşe (yeni)", effectiveFrom: "2026-12" })]);
    assert.ok(later.ok, later.ok ? "" : later.error);
    // Eski satırı yeniden açmak (bitiş ayını kaldırmak) çakışma yaratır: reddedilir
    const [old] = await db.select().from(s.staff).where(eq(s.staff.name, "Ayşe"));
    const reopen = await costs.endStaff(old.id, null);
    assert.equal(reopen.ok, false);
    // Hesabı olmayan Vardiya adı: aynı şubede tek satır, başka şubede serbest
    await db.execute(sql`TRUNCATE staff, staff_versions RESTART IDENTITY CASCADE`);
    assert.ok((await costs.saveStaff([part({ userId: null, personRef: "n:mert", name: "Mert" })])).ok);
    const sameName = await costs.saveStaff([...(await current()), part({ userId: null, personRef: "n:mert", name: "Mert 2" })]);
    assert.equal(sameName.ok, false);
    const otherBranch = await costs.saveStaff([...(await current()), part({ userId: null, personRef: "n:mert", name: "Mert Tuzla", branchId: "tuzla" })]);
    assert.ok(otherBranch.ok, otherBranch.ok ? "" : otherBranch.error);
    // Bağlantıyı kaldırmak serbest (null)
    const [mert] = await db.select().from(s.staff).where(eq(s.staff.name, "Mert"));
    const unlink = await costs.saveStaff((await current()).map((x) => (x.id === mert.id ? { ...x, userId: null, personRef: null } : x)));
    assert.ok(unlink.ok);
    const [after_] = await db.select().from(s.staff).where(eq(s.staff.id, mert.id));
    assert.deepEqual([after_.userId, after_.personRef], [null, null]);
  });

  test("yemek kartı ve günlük ücret maaşla sürümlenir; maaş hesabına girmiş satırın türü değişmez", async () => {
    await db.insert(s.months).values({ month: "2026-10", branchId: "marina", openDays: 30 });
    assert.ok((await costs.saveStaff([{ id: null, name: "Alper", netSalary: 35_000, extras: 0, mealCard: false, effectiveFrom: "2026-10", branchId: "marina" }])).ok);
    const [alper] = await db.select().from(s.staff);
    const on = await costs.saveStaff([{ id: alper.id, name: "Alper", netSalary: 35_000, extras: 0, mealCard: true, effectiveFrom: "2026-12" }]);
    assert.ok(on.ok, on.ok ? "" : on.error);
    const versions = await db.select().from(s.staffVersions);
    assert.deepEqual(
      versions.map((v) => [v.fromMonth, v.mealCard]),
      [["2026-12", true]],
      "Aralık'tan itibaren yemek kartı; önceki aylar eski hâliyle",
    );
    const model = await dataset.loadModel({ scope: "marina" });
    assert.equal(model.personnelFor("2026-11").mealCard, 0);
    assert.equal(model.personnelFor("2026-12").mealCard, 330 * 26);
    const kind = await costs.saveStaff([{ id: alper.id, name: "Alper", netSalary: 35_000, extras: 0, kind: "part_time", effectiveFrom: "2026-12" }]);
    assert.equal(kind.ok, false);
    assert.match(kind.ok ? "" : kind.error, /çalışma türü değişmez/);
  });

  /** Kayıtlı satırlar, eylemin "değişmeden kalanlar" biçiminde */
  async function current() {
    return (await db.select().from(s.staff)).map((x) => ({
      id: x.id,
      name: x.name,
      netSalary: x.netSalary,
      extras: x.extras,
      mealCard: x.mealCard,
      dailyWage: x.dailyWage,
      effectiveFrom: "2026-12" as const,
    }));
  }
});
