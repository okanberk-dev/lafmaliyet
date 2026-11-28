// Yönetim konsolunun oturumu ve girişi, gerçek Postgres'te (docs/planlar/yonetim-konsolu.md › K-A;
// src/server/actions/yonetim-giris.ts, src/server/auth/dal.ts › requireYonetim, requireAnaAdmin). Çerezler ve istek
// başlıkları taklit edilir.
// - Asıl yönetici dışındaki e-posta (başka bir yöneticinin DOĞRU parolasıyla bile): yanıt kayıtsız e-postanınkiyle aynı,
//   oturum yok, o hesabın kilit sayacı ve son girişi değişmez.
// - Asıl yönetici: kilit kuralı panelinkiyle aynı (5 hatada 15 dakika), doğru parolada yalnız konsol çerezi ve /yonetim;
//   iki adımlı açıksa kod adımı.
// - LADMIN_ANA_ADMIN değişince requireYonetim çerezi silen yola, oradan girişe gönderir.
// - requireAnaAdmin konsol oturumuyla geçer; öteki yönetici panelde eskisi gibi reddedilir. Konsol çıkışı panel oturumuna
//   dokunmaz.
//
// YONETIM_KONSOLU_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen
// kullanıcı): test kendi geçici veritabanını açar, göçleri uygular, sonunda siler.
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/<boş db> npm run test:db -- tests/yonetim-konsolu-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import postgres from "postgres";

import { yalnizAsilYonetici } from "../src/lib/asil-yonetici";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.YONETIM_KONSOLU_TEST_DATABASE_URL;
const DB_NAME = `laffogato_yonetim_konsolu_${process.pid}`;
const SECRET = "yonetim-konsolu-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const ASIL = "asil@ornek.com";
const PASSWORD = "Yonetim-Konsolu-Testi-4821";

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

const form = (email: string, password: string) => {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
};

describe("Yönetim konsolu: veritabanında", { skip: !SERVER_URL && "YONETIM_KONSOLU_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let ss: typeof import("../src/server/auth/session");
  let giris: typeof import("../src/server/actions/yonetim-giris");
  let korumalar: typeof import("../src/server/auth/giris-korumalari");
  let totp: typeof import("../src/server/auth/totp");
  let box: typeof import("../src/server/secret-box");
  let bitti: typeof import("../src/app/yonetim/oturum-bitti/route");
  let jar = new Jar();
  let reqHeaders = new Headers();
  const ids = { ana: 0, ali: 0 };
  /** Her test ayrı IP'den: giriş IP'si sınırı (bellekte) testler arasında taşmasın */
  let ip = 1;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1", LADMIN_ANA_ADMIN: ASIL });
    delete process.env.RESEND_API_KEY;
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
    const nextServer = require("next/server") as typeof import("next/server");
    stub("next/server", { ...nextServer, connection: async () => {}, after: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const { hashPassword } = await import("../src/server/auth/password");
    const hash = await hashPassword(PASSWORD);
    const [a] = await db.insert(s.users).values({ name: "Asıl", email: ASIL, role: "admin", passwordHash: hash }).returning({ id: s.users.id });
    const [b] = await db.insert(s.users).values({ name: "Ali", email: "ali@ornek.com", role: "admin", passwordHash: hash }).returning({ id: s.users.id });
    ids.ana = a.id;
    ids.ali = b.id;
    dal = await import("../src/server/auth/dal");
    ss = await import("../src/server/auth/session");
    giris = await import("../src/server/actions/yonetim-giris");
    korumalar = await import("../src/server/auth/giris-korumalari");
    totp = await import("../src/server/auth/totp");
    box = await import("../src/server/secret-box");
    bitti = await import("../src/app/yonetim/oturum-bitti/route");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    jar = new Jar();
    reqHeaders = new Headers({ "x-forwarded-for": `10.0.0.${ip++}`, "next-action": "test" });
    process.env.LADMIN_ANA_ADMIN = ASIL;
    await db.update(s.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: null, totpEnabled: false, totpSecret: null, totpLastStep: null });
  });

  const user = async (id: number) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0];
  /** Giriş eylemi: yönlendirme (başarı) `{ to }` olarak döner */
  const dene = async (email: string, password: string) => {
    try {
      return await giris.yonetimGirisAction({}, form(email, password));
    } catch (e) {
      if ((e as Error).message === "NEXT_REDIRECT") return { to: (e as { to: string }).to };
      throw e;
    }
  };

  test("asıl yönetici dışındaki e-posta: öteki yöneticinin DOĞRU parolasıyla bile kayıtsız adresle aynı yanıt; hesaba dokunulmaz", async () => {
    const once = await user(ids.ali);
    const t0 = Date.now();
    const ali = await dene("ali@ornek.com", PASSWORD);
    const sureAli = Date.now() - t0;
    const t1 = Date.now();
    const yok = await dene("kimse@ornek.com", PASSWORD);
    const sureYok = Date.now() - t1;
    assert.deepEqual(ali, { error: korumalar.WRONG, email: "ali@ornek.com" });
    assert.deepEqual(yok, { error: korumalar.WRONG, email: "kimse@ornek.com" });
    // Aynı süre (en az doldurma süresi)
    assert.ok(sureAli >= 850 && sureYok >= 850, `${sureAli} ${sureYok}`);
    assert.equal(jar.values.size, 0, "hiçbir çerez yazılmadı (konsol, panel, cihaz)");
    const sonra = await user(ids.ali);
    assert.equal(sonra.failedLogins, once.failedLogins);
    assert.equal(sonra.lockedUntil, once.lockedUntil);
    assert.equal(sonra.lastLoginAt, once.lastLoginAt);
    // Öteki yöneticinin hatalı parolası da hesabın sayacına yazılmaz
    for (let i = 0; i < 3; i++) await dene("ali@ornek.com", "yanlis");
    assert.equal((await user(ids.ali)).failedLogins, 0);
  });

  test("asıl yönetici: kilit kuralı panelinkiyle aynı (5 hatada kilit, kilitliyken doğru parola da girmez)", async () => {
    for (let i = 1; i < korumalar.MAX_FAILED; i++) {
      assert.deepEqual(await dene(ASIL, "yanlis"), { error: korumalar.WRONG, email: ASIL });
      assert.equal((await user(ids.ana)).failedLogins, i);
    }
    const son = (await dene(ASIL, "yanlis")) as { error: string };
    const u = await user(ids.ana);
    assert.ok(u.lockedUntil && u.lockedUntil > new Date(), "kilitlendi");
    assert.equal(son.error, korumalar.lockedMessage(u.lockedUntil!));
    const kilitli = (await dene(ASIL, PASSWORD)) as { error?: string; to?: string };
    assert.equal(kilitli.to, undefined, "kilitliyken giriş yok");
    assert.equal(kilitli.error, korumalar.lockedMessage(u.lockedUntil!));
    assert.equal(jar.get(ss.YONETIM_COOKIE), undefined);
  });

  test("asıl yönetici, doğru parola: yalnız konsol çerezi, /yonetim; requireYonetim ve requireAnaAdmin geçer", async () => {
    assert.deepEqual(await dene(ASIL, PASSWORD), { to: "/yonetim" });
    assert.ok(jar.get(ss.YONETIM_COOKIE), "konsol çerezi");
    assert.equal(jar.get(ss.SESSION_COOKIE), undefined, "panel oturumu açılmadı");
    const u = await user(ids.ana);
    assert.ok(u.lastLoginAt);
    assert.equal(u.failedLogins, 0);
    assert.equal((await dal.requireYonetim()).id, ids.ana);
    assert.equal((await dal.requireAnaAdmin("kasaKurma")).id, ids.ana, "konsol oturumuyla şube eylemleri");
    // Konsol oturumu paneli açmaz
    assert.equal(await dal.getCurrentUser(), null);
  });

  test("iki adımlı açıkken: parola doğru olunca kod adımı, oturum ancak kodla; yanlış kod oturum açmaz", async () => {
    const secret = totp.generateTotpSecret();
    await db.update(s.users).set({ totpEnabled: true, totpSecret: box.seal(secret, "totp") }).where(eq(s.users.id, ids.ana));
    assert.deepEqual(await dene(ASIL, PASSWORD), { step: "totp", email: ASIL });
    assert.equal(jar.get(ss.YONETIM_COOKIE), undefined);
    assert.ok(jar.get(ss.YONETIM_PENDING_COOKIE), "kod adımının belirteci");
    assert.equal(await ss.verifyPending(jar.get(ss.YONETIM_PENDING_COOKIE)!.value), null, "panelin kod adımı bunu kabul etmez");
    const fd = new FormData();
    fd.set("code", "000000");
    const yanlis = await giris.yonetimKodAction({}, fd);
    assert.ok(yanlis.error && !yanlis.expired, JSON.stringify(yanlis));
    assert.equal(jar.get(ss.YONETIM_COOKIE), undefined);
    fd.set("code", totp.totpCode(secret, totp.totpStep()));
    await assert.rejects(giris.yonetimKodAction({}, fd), (e: { to?: string }) => e.to === "/yonetim");
    assert.ok(jar.get(ss.YONETIM_COOKIE));
    assert.equal(jar.get(ss.YONETIM_PENDING_COOKIE), undefined);
    assert.equal(jar.get(ss.SESSION_COOKIE), undefined);
  });

  test("LADMIN_ANA_ADMIN değişince: requireYonetim çerezi silen yola, oradan girişe; requireAnaAdmin konsol oturumunu kabul etmez", async () => {
    assert.deepEqual(await dene(ASIL, PASSWORD), { to: "/yonetim" });
    const token = jar.get(ss.YONETIM_COOKIE)!.value;
    process.env.LADMIN_ANA_ADMIN = "ali@ornek.com";
    let hedef = "";
    await assert.rejects(dal.requireYonetim(), (e: { to?: string }) => ((hedef = e.to ?? ""), hedef.startsWith("/yonetim/oturum-bitti?oturum=bitti&s=")));
    // Panel oturumu yok: requireAnaAdmin panelin yoluna düşer, girişe gönderir
    await assert.rejects(dal.requireAnaAdmin(), (e: { to?: string }) => e.to === "/giris");
    // Çerezi silen yol: özet tutarsa siler, girişe gönderir (döngü yok)
    const res = await bitti.GET(new NextRequest(`https://yonetim.laffogato.net${hedef}`, { headers: { cookie: `${ss.YONETIM_COOKIE}=${token}` } }));
    assert.equal(res.headers.get("location"), "https://yonetim.laffogato.net/yonetim/giris?oturum=bitti");
    assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`${ss.YONETIM_COOKIE}=;`));
    // Özet tutmazsa (başka bağlantı) silmez
    const res2 = await bitti.GET(new NextRequest("https://yonetim.laffogato.net/yonetim/oturum-bitti?oturum=bitti&s=baska", { headers: { cookie: `${ss.YONETIM_COOKIE}=${token}` } }));
    assert.equal(res2.headers.get("set-cookie"), null);
    // Giriş sayfasının denetimi (getYonetimUser) eski asıl yöneticiyi geçirmez
    assert.equal(await dal.getYonetimUser(), null);
  });

  test("öteki yönetici: panelde eskisi gibi reddedilir; kendi adına üretilmiş konsol belirteci de geçmez", async () => {
    const ali = await user(ids.ali);
    await dal.startSession(ali);
    await assert.rejects(dal.requireAnaAdmin("subeAcma"), (e: Error) => e.message === yalnizAsilYonetici("subeAcma"));
    jar.set(ss.YONETIM_COOKIE, await ss.signYonetim({ sub: String(ali.id), name: ali.name, role: "admin", sv: ali.sessionVersion }));
    assert.equal(await dal.getYonetimUser(), null);
    await assert.rejects(dal.requireAnaAdmin("subeAcma"), (e: Error) => e.message === yalnizAsilYonetici("subeAcma"));
    // Panel belirteci konsol çerezine konsa da konsol açılmaz
    jar.set(ss.YONETIM_COOKIE, jar.get(ss.SESSION_COOKIE)!.value);
    assert.equal(await dal.getYonetimUser(), null);
  });

  test("konsoldan çıkış yalnız konsol çerezini siler; panel oturumu açık kalır, kapatılan konsol belirteci bir daha geçmez", async () => {
    const ana = await user(ids.ana);
    await dal.startSession(ana);
    assert.deepEqual(await dene(ASIL, PASSWORD), { to: "/yonetim" });
    const token = jar.get(ss.YONETIM_COOKIE)!.value;
    await assert.rejects(giris.yonetimCikisAction(), (e: { to?: string }) => e.to === "/yonetim/giris");
    assert.equal(jar.get(ss.YONETIM_COOKIE), undefined);
    assert.ok(jar.get(ss.SESSION_COOKIE), "panel oturumu duruyor");
    assert.equal((await dal.getCurrentUser())?.id, ids.ana);
    jar.set(ss.YONETIM_COOKIE, token);
    assert.equal(await dal.getYonetimUser(), null, "kapatılan oturumun kopyası geçmez");
  });
});
