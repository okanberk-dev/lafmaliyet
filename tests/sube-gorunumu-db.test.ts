// Şube görünümü, gerçek Postgres'te (şube ayrımı D; docs/SUBE.md › Şube ayrımı): kişinin tercihi `users.branch_view`'a
// yalnız kendi satırına anahtar anahtar yazılır, istekte okunur ve alanın okuma kapsamını (`areaScope`) belirler.
// Yönetici ve muhasebeci yazar; müdür, şubesine kilitli ve şubesiz personel reddedilir. Müdürün ve kilitli personelin
// her alanı veritabanında "firma" yazsa da yalnız şubesidir; müdürün kilidi okumada da durur. Oturum gerçek
// src/server/auth/dal.ts'le, çerezler ve istek başlıkları taklit edilerek (tests/roller-db.test.ts gibi). Vergi'nin alanı
// yok (sahibin kararı 27 Kasım 2026: vergi şubeye bölünmez): eski sürümün yazdığı `vergi` anahtarı okunmaz, yazılamaz.
//
// SUBE_GORUNUM_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Bir Postgres
// sunucusunun adresi: test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_GORUNUM_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/sube-gorunumu-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { BRANCH_VIEW_LOCKED, VIEW_AREA_KEYS } from "../src/lib/branch-view";
import { ALL_BRANCHES, BRANCH_COOKIE, DEFAULT_BRANCHES } from "../src/lib/branches";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_GORUNUM_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_gorunum_${process.pid}`;
const SECRET = "sube-gorunumu-testi-icin-en-az-otuz-iki-karakterlik-anahtar";

/** Tarayıcının çerez kutusu: dal.ts ve branch-scope.ts cookies() ile bunu okur */
class Jar {
  values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, opts: { maxAge?: number } = {}) {
    if (opts.maxAge === 0 || value === "") this.values.delete(name);
    else this.values.set(name, value);
  }
}

type Key = "ali" | "zeynep" | "mehmet" | "ayse" | "fatma";
const BASE: Record<Key, { name: string; email: string; role: "admin" | "manager" | "accountant" | "staff"; branchId: string | null }> = {
  ali: { name: "Ali", email: "ali@ornek.com", role: "admin", branchId: null },
  zeynep: { name: "Zeynep", email: "zeynep@ornek.com", role: "accountant", branchId: null },
  mehmet: { name: "Mehmet", email: "mehmet@ornek.com", role: "manager", branchId: "tuzla" },
  ayse: { name: "Ayşe", email: "ayse@ornek.com", role: "staff", branchId: "marina" },
  fatma: { name: "Fatma", email: "fatma@ornek.com", role: "staff", branchId: null },
};

describe("şube görünümü: veritabanında", { skip: !SERVER_URL && "SUBE_GORUNUM_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let scope: typeof import("../src/server/branch-scope");
  let action: typeof import("../src/server/actions/branch-view");
  let jar = new Jar();
  let reqHeaders = new Headers();
  const ids = {} as Record<Key, number>;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => reqHeaders });
    stub("next/navigation", {
      redirect: (to: string) => {
        throw Object.assign(new Error("NEXT_REDIRECT"), { to });
      },
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
      unstable_rethrow: (e: unknown) => {
        if ((e as Error)?.message === "NEXT_REDIRECT" || (e as Error)?.message === "NEXT_NOT_FOUND") throw e;
      },
    });
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    for (const k of Object.keys(BASE) as Key[]) {
      const [row] = await db.insert(s.users).values({ ...BASE[k], passwordHash: "x" }).returning({ id: s.users.id });
      ids[k] = row.id;
    }
    dal = await import("../src/server/auth/dal");
    scope = await import("../src/server/branch-scope");
    action = await import("../src/server/actions/branch-view");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    reqHeaders = new Headers();
    await db.update(s.users).set({ branchView: {} });
  });

  /** Bu tarayıcıda (yeni çerez kutusu) oturum; seçicide `secim` */
  const signIn = async (k: Key, secim: string = "marina") => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids[k]));
    await dal.startSession(u);
    jar.set(BRANCH_COOKIE, secim);
  };
  /** Sunucu eylemi isteği */
  const asAction = () => {
    reqHeaders = new Headers({ "next-action": "test" });
  };
  const stored = async (k: Key) => (await db.select({ v: s.users.branchView }).from(s.users).where(eq(s.users.id, ids[k])))[0].v;
  const violates = (name: string) => (e: unknown) => (e as { cause?: { constraint_name?: string } })?.cause?.constraint_name === name;

  test("sütun: varsayılan boş nesne; nesne olmayan değer yazılamaz", async () => {
    const [row] = await db.insert(s.users).values({ name: "Yeni", email: "yeni@ornek.com", passwordHash: "x" }).returning({ v: s.users.branchView });
    assert.deepEqual(row.v, {});
    await assert.rejects(db.execute(sql`UPDATE users SET branch_view = '[]'::jsonb WHERE id = ${ids.ali}`), violates("users_branch_view_ck"));
    await assert.rejects(db.execute(sql`UPDATE users SET branch_view = '"firma"'::jsonb WHERE id = ${ids.ali}`), violates("users_branch_view_ck"));
    await db.delete(s.users).where(eq(s.users.email, "yeni@ornek.com"));
  });

  test("yönetici: tek alan yazılır, öteki alanlar korunur; kapsam firma kipinde Tümü, şube kipinde seçim", async () => {
    await signIn("ali");
    asAction();
    assert.deepEqual(await action.saveBranchView({ area: "mutabakat", mode: "firma" }), { ok: true, data: { prefs: { mutabakat: "firma" } } });
    assert.deepEqual(await action.saveBranchView({ area: "nakit", mode: "firma" }), { ok: true, data: { prefs: { mutabakat: "firma", nakit: "firma" } } });
    assert.deepEqual(await action.saveBranchView({ area: "mutabakat", mode: "sube" }), { ok: true, data: { prefs: { mutabakat: "sube", nakit: "firma" } } });
    assert.deepEqual(await stored("ali"), { mutabakat: "sube", nakit: "firma" });
    // Başkasının satırı değişmedi
    assert.deepEqual(await stored("zeynep"), {});
    // İstekte okunur: Marina seçili
    assert.deepEqual(await scope.userBranchView(), { mutabakat: "sube", nakit: "firma" });
    assert.equal(await scope.currentBranchView("nakit"), "firma");
    assert.equal(await scope.currentBranchView("tutarlilik"), "sube", "yazılmamış alan yöneticinin varsayılanı");
    assert.equal(await scope.areaScope("nakit"), ALL_BRANCHES);
    assert.equal(await scope.areaScope("mutabakat"), "marina");
    assert.equal(await scope.areaScope("tutarlilik"), "marina");
    // Alanın kapsamıyla açılan okuma: firma kipinde Tümü'yü görür
    assert.equal(await scope.withBranchScope(await scope.areaScope("nakit"), () => scope.currentBranchScope()), ALL_BRANCHES);
    // Tümü seçiliyken kip anlamsız: hep Tümü
    await signIn("ali", ALL_BRANCHES);
    assert.equal(await scope.areaScope("mutabakat"), ALL_BRANCHES);
  });

  test("toplu: hepsi firma geneli, hepsi yalnız şube, varsayılanlara dön", async () => {
    await signIn("ali");
    asAction();
    const all = await action.saveBranchView({ all: "firma" });
    assert.ok(all.ok, JSON.stringify(all));
    assert.deepEqual(await stored("ali"), Object.fromEntries(VIEW_AREA_KEYS.map((a) => [a, "firma"])));
    for (const a of VIEW_AREA_KEYS) assert.equal(await scope.areaScope(a), ALL_BRANCHES, a);
    await action.saveBranchView({ all: "sube" });
    for (const a of VIEW_AREA_KEYS) assert.equal(await scope.areaScope(a), "marina", a);
    assert.deepEqual(await action.saveBranchView({ all: "varsayilan" }), { ok: true, data: { prefs: {} } });
    assert.deepEqual(await stored("ali"), {});
  });

  test("geçersiz girdi ve bozuk kayıt: eylem reddeder, okuma bilinmeyeni düşürür", async () => {
    await signIn("ali");
    asAction();
    // Vergi'nin alanı yok (sahibin kararı 27 Kasım 2026: vergi şubeye bölünmez): eski çip ya da sekmeden gelen yazım da reddedilir
    for (const bad of [{ area: "bilinmeyen", mode: "firma" }, { area: "vergi", mode: "firma" }, { area: "nakit", mode: "tumu" }, { area: "nakit", mode: "firma", extra: 1 }, { all: "hepsi" }, null, "nakit"]) {
      const r = await action.saveBranchView(bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
    }
    assert.deepEqual(await stored("ali"), {}, "hiçbir şey yazılmadı");
    // Eski sürümün yazdığı Vergi tercihi sessizce düşer; öbür alanlar okunur
    await db.execute(sql`UPDATE users SET branch_view = '{"vergi":"firma","mutabakat":"firma","nakit":"bilgi","x":"firma"}'::jsonb WHERE id = ${ids.ali}`);
    assert.deepEqual(await scope.userBranchView(), { mutabakat: "firma" });
    assert.equal(await scope.currentBranchView("nakit"), "sube");
    assert.equal(await scope.areaScope("mutabakat"), ALL_BRANCHES);
    // Toplu düğme eski anahtarı yazmaz; Varsayılanlara dön hepsini siler
    asAction();
    await action.saveBranchView({ all: "sube" });
    assert.equal((await stored("ali") as Record<string, string>).vergi, "firma", "eski anahtar yerinde kalır (okunmaz)");
    assert.deepEqual(await scope.userBranchView(), Object.fromEntries(VIEW_AREA_KEYS.map((a) => [a, "sube"])));
    await action.saveBranchView({ all: "varsayilan" });
    assert.deepEqual(await stored("ali"), {});
  });

  test("muhasebeci: kendi ekranlarının alanını yazar, varsayılanı tasarımdaki gibi; açamadığı ekranın alanı reddedilir", async () => {
    await signIn("zeynep");
    asAction();
    assert.equal(await scope.currentBranchView("odemeler"), "sube");
    assert.equal(await scope.currentBranchView("ortak_gider"), "firma", "Tutarla göster");
    assert.deepEqual(await action.saveBranchView({ area: "ortak_gider", mode: "sube" }), { ok: true, data: { prefs: { ortak_gider: "sube" } } });
    assert.equal(await scope.currentBranchView("ortak_gider"), "sube");
    assert.deepEqual(await action.saveBranchView({ area: "tutarlilik", mode: "sube" }), { ok: false, error: "Bu ekran hesabınızda yok" });
    // Vergi'nin alanı yok: muhasebeci de yazamaz (vergi her kipte firmanın)
    assert.equal((await action.saveBranchView({ area: "vergi", mode: "sube" })).ok, false);
    // Toplu düğme yalnız kartındaki alanları yazar
    await action.saveBranchView({ all: "firma" });
    assert.deepEqual(await stored("zeynep"), { ortak_gider: "firma" });
  });

  test("müdür: eylem reddeder; veritabanında firma yazsa da her alan şubesi, okuma da şubesine daralır", async () => {
    await db.update(s.users).set({ branchView: Object.fromEntries(VIEW_AREA_KEYS.map((a) => [a, "firma"])) }).where(eq(s.users.id, ids.mehmet));
    await signIn("mehmet", ALL_BRANCHES);
    asAction();
    assert.deepEqual(await action.saveBranchView({ area: "mutabakat", mode: "firma" }), { ok: false, error: BRANCH_VIEW_LOCKED });
    assert.deepEqual(await action.saveBranchView({ all: "varsayilan" }), { ok: false, error: BRANCH_VIEW_LOCKED });
    for (const a of VIEW_AREA_KEYS) {
      assert.equal(await scope.currentBranchView(a), "sube", a);
      assert.equal(await scope.areaScope(a), "tuzla", a);
    }
    // Tercih verilse de (bağlantı anahtarı yolu) kilit kalır; "Tümü" ile açılan okuma şubesine daralır
    assert.equal(await scope.withBranchView({ mutabakat: "firma" }, () => scope.currentBranchView("mutabakat")), "sube");
    assert.equal(await scope.withBranchScope(ALL_BRANCHES, () => scope.currentBranchScope()), "tuzla");
    assert.equal(await scope.withBranchScope("marina", () => scope.withBranchView({ mutabakat: "firma" }, () => scope.areaScope("mutabakat"))), "tuzla");
  });

  test("şubesine kilitli ve şubesiz personel: eylem reddeder, her alan şube", async () => {
    for (const k of ["ayse", "fatma"] as const) {
      await signIn(k);
      asAction();
      assert.deepEqual(await action.saveBranchView({ area: "mutabakat", mode: "firma" }), { ok: false, error: BRANCH_VIEW_LOCKED }, k);
      assert.equal(await scope.currentBranchView("mutabakat"), "sube", k);
    }
    assert.deepEqual(await stored("ayse"), {});
    assert.deepEqual(await stored("fatma"), {});
    // Kilitli personelin seçimi şubesinde: çerez Tuzla dese de kapsam Marina
    await signIn("ayse", "tuzla");
    assert.equal(await scope.areaScope("mutabakat"), "marina");
  });

  test("istek dışında (test, bağlantı anahtarı): withBranchView'ın tercihi geçer, yoksa yöneticinin varsayılanı", async () => {
    jar = new Jar();
    assert.deepEqual(await scope.userBranchView(), {}, "oturum yok");
    const run = (prefs: Parameters<typeof scope.withBranchView>[0]) => scope.withBranchScope("marina", () => scope.withBranchView(prefs, () => scope.areaScope("mutabakat")));
    assert.equal(await run({ mutabakat: "firma" }), ALL_BRANCHES);
    assert.equal(await run({ mutabakat: "sube" }), "marina");
    assert.equal(await run({}), "marina");
    assert.equal(await scope.withBranchScope("marina", () => scope.areaScope("mutabakat")), "marina");
  });
});
