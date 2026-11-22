// Çıkışta oturum sunucuda kapanır (denetim 13 Kasım 2026, YO-02), gerçek Postgres'te ve çerezler taklit edilerek
// (src/server/auth/dal.ts): çıkıştan sonra çerezin kopyası geçmez, kişinin öteki cihazları açık kalır; aynı tarayıcıda
// yerine yeni oturum gelince eskisi de kapanır; bu sürümden önceki kimliksiz oturumlar kendi süresiyle düşer.
//
// OTURUM_TEST_DATABASE_URL (yoksa BAGLANTI_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: OTURUM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/oturum-kapatma-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { SignJWT } from "jose";
import postgres from "postgres";

import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.OTURUM_TEST_DATABASE_URL ?? process.env.BAGLANTI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_oturum_${process.pid}`;
const SECRET = "oturum-testi-icin-en-az-otuz-iki-karakterlik-anahtar";

/** Tarayıcının çerez kutusu: dal.ts cookies() ile bunu okur ve yazar */
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

describe("çıkışta oturum sunucuda kapanır: veritabanında", { skip: !SERVER_URL && "OTURUM_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let session: typeof import("../src/server/auth/session");
  let jar = new Jar();
  let user: typeof s.users.$inferSelect;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; çerezler ve yönlendirme taklit edilir
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => new Headers() });
    stub("next/navigation", {
      redirect: (to: string) => {
        throw Object.assign(new Error("NEXT_REDIRECT"), { to });
      },
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    [user] = await db.insert(s.users).values({ email: "kasa@laffogato.net", name: "Kasa", passwordHash: "x", role: "staff" }).returning();
    dal = await import("../src/server/auth/dal");
    session = await import("../src/server/auth/session");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    jar = new Jar();
  });

  /** Bu cihazda giriş: oturum çerezi */
  const signIn = async () => {
    await dal.startSession(user);
    const token = jar.get(session.SESSION_COOKIE)?.value;
    assert.ok(token, "oturum çerezi yazıldı");
    return token;
  };
  /** Kopyalanmış bir çerezle istek (başka tarayıcı, eklenti, kaydedilmiş HAR) */
  const as = async (token: string) => {
    jar = new Jar();
    jar.set(session.SESSION_COOKIE, token);
    return dal.getCurrentUser();
  };

  test("çıkıştan sonra çerezin kopyası geçmez; giriş sayfasına çerezin özetiyle gider", async () => {
    const token = await signIn();
    assert.equal((await dal.getCurrentUser())?.id, user.id);
    await dal.endSession();
    assert.equal(jar.get(session.SESSION_COOKIE), undefined, "tarayıcıdaki çerez silindi");
    assert.equal(await as(token), null, "kopya da reddedilir (YO-02)");
    // Kopyayla gelen istek giriş sayfasına çerezin özetiyle gider: proxy yalnız bu çerezi siler
    const expected = `/giris?${await session.expiredLoginQuery(token)}`;
    assert.match(expected, /^\/giris\?oturum=bitti&s=[0-9a-f]{16}$/);
    await assert.rejects(dal.requireUser(), (e: { to?: string }) => e.to === expected);
    // Çerezi hiç olmayan istek düz girişe
    jar = new Jar();
    await assert.rejects(dal.requireUser(), (e: { to?: string }) => e.to === "/giris");
  });

  test("çıkış yalnız o oturumu kapatır: kişinin öteki cihazı açık kalır", async () => {
    const tablet = await signIn();
    jar = new Jar();
    const phone = await signIn();
    assert.notEqual(tablet, phone);
    jar = new Jar();
    jar.set(session.SESSION_COOKIE, tablet);
    await dal.endSession();
    assert.equal(await as(tablet), null);
    assert.equal((await as(phone))?.id, user.id, "telefondaki oturum düşmez");
  });

  test("aynı tarayıcıda yerine yeni oturum gelince (ad değişikliği, sıradaki kişinin girişi) eskisi de kapanır", async () => {
    const before = await signIn();
    const renamed = await signIn();
    assert.notEqual(before, renamed);
    assert.equal(await as(before), null, "eski çerezin kopyası geçmez");
    assert.equal((await as(renamed))?.id, user.id);
  });

  test("bu sürümden önceki kimliksiz oturum kendi süresiyle düşer; silinmiş hesabın çerezi girişi bozmaz", async () => {
    const legacy = await new SignJWT({ name: user.name, role: user.role, sv: user.sessionVersion, typ: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(SECRET));
    assert.equal((await as(legacy))?.id, user.id, "yayından sonra kimse oturumdan düşmez");
    await dal.endSession();
    assert.equal(jar.get(session.SESSION_COOKIE), undefined);
    // Tarayıcıda silinmiş bir hesabın çerezi dururken başka biri girer: eski oturum kapatılır, giriş bozulmaz
    const [gone] = await db.insert(s.users).values({ email: "eski@laffogato.net", name: "Eski", passwordHash: "x", role: "staff" }).returning();
    jar = new Jar();
    await dal.startSession(gone);
    const goneToken = jar.get(session.SESSION_COOKIE)!.value;
    await db.delete(s.users).where(eq(s.users.id, gone.id));
    await dal.startSession(user);
    assert.equal((await dal.getCurrentUser())?.id, user.id);
    assert.equal(await as(goneToken), null);
  });

  test("süresi dolan kapatılmış oturum satırları silinir", async () => {
    await db.insert(s.revokedSessions).values({ id: "eski-oturum", userId: user.id, expiresAt: new Date(Date.now() - 60_000) });
    await signIn();
    await dal.endSession();
    const rows = await db.select().from(s.revokedSessions);
    assert.ok(!rows.some((r) => r.id === "eski-oturum"), "süresi dolan satır kalmaz");
    assert.ok(rows.every((r) => r.expiresAt.getTime() > Date.now()));
  });
});
