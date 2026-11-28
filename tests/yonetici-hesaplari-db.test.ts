// Yönetici hesaplarını yalnız asıl yönetici yönetir (docs/ROLLER.md › Yönetici hesapları; src/lib/asil-yonetici.ts,
// src/server/actions/settings.ts, invites.ts), gerçek Postgres'te. Oturum gerçek src/server/auth/dal.ts'le, çerezler ve
// istek başlıkları taklit edilerek (panel oturumu ve Yönetim konsolunun oturumu ayrı çerezde).
// - Öteki yönetici: yönetici hesabına dokunan her işte (yönetici açmak, yöneticilik vermek ve almak, yöneticinin
//   e-postası, parolası, erişimi, silme, iki adımlı, kilit, oturumlar, bağlantı) okunur ret; ret parola sorusundan önce
//   (parolasız, yanlış ve doğru parolayla aynı ret; parola denenmez, işlem geçmişine "Hatalı parola" düşmez); hiçbir
//   satır yazılmaz. Başka bir yöneticinin yalnız adını değiştirebilir.
// - Asıl yönetici: panel oturumuyla ve konsol oturumuyla (panel çerezi yok) aynı işler parolayla geçer; konsoldan gelen
//   kendi ad değişikliği panel oturumu açmaz; öteki yöneticinin konsol çerezi geçmez.
// - Öteki yönetici müdür, muhasebeci ve personel hesaplarında bugünkü her şeyi yapar (parolasız), kendi hesabında
//   Hesabım işleri çalışır.
// - Kendini pasif yapma, yöneticiliğini alma ve silme kuralları aynen.
// - Konsol › Yöneticiler'in verisi: yalnız yönetici satırları (asıl yönetici başta), adaylar, kalan kurtarma kodu; sır yok.
//
// YONETICI_HESAPLARI_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen
// kullanıcı): test kendi geçici veritabanını açar, göçleri uygular, sonunda siler.
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/<boş db> npm run test:db -- tests/yonetici-hesaplari-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { yalnizAsilYonetici, type AsilYoneticiIsi } from "../src/lib/asil-yonetici";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { STEP_UP_REQUIRED, WRONG_PASSWORD } from "../src/lib/step-up";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.YONETICI_HESAPLARI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_yonetici_hesaplari_${process.pid}`;
const SECRET = "yonetici-hesaplari-testi-icin-en-az-otuz-iki-karakter";
const ASIL = "asil@ornek.com";
const PASSWORD = "Yonetici-Hesaplari-4821";
const PW = { password: PASSWORD };

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

type Key = "ana" | "ali" | "veli" | "mehmet" | "zeynep" | "ayse" | "kemal";
type Base = { name: string; email: string; role: "admin" | "manager" | "accountant" | "staff"; branchId: string | null };
const BASE: Record<Key, Base> = {
  ana: { name: "Asıl", email: ASIL, role: "admin", branchId: null },
  ali: { name: "Ali", email: "ali@ornek.com", role: "admin", branchId: null },
  veli: { name: "Veli", email: "veli@ornek.com", role: "admin", branchId: null },
  mehmet: { name: "Mehmet", email: "mehmet@ornek.com", role: "manager", branchId: "tuzla" },
  zeynep: { name: "Zeynep", email: "zeynep@ornek.com", role: "accountant", branchId: null },
  ayse: { name: "Ayşe", email: "ayse@ornek.com", role: "staff", branchId: "marina" },
  kemal: { name: "Kemal", email: "kemal@ornek.com", role: "staff", branchId: null },
};

describe("Yönetici hesapları: veritabanında", { skip: !SERVER_URL && "YONETICI_HESAPLARI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let ss: typeof import("../src/server/auth/session");
  let settings: typeof import("../src/server/actions/settings");
  let invites: typeof import("../src/server/actions/invites");
  let auth: typeof import("../src/server/actions/auth");
  let veri: typeof import("../src/server/yonetici-hesaplari");
  let jar = new Jar();
  let reqHeaders = new Headers();
  let hash = "";
  const ids = {} as Record<Key, number>;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1", LADMIN_ANA_ADMIN: ASIL });
    delete process.env.RESEND_API_KEY;
    delete process.env.ADMIN_2FA_REQUIRED;
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
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const { hashPassword } = await import("../src/server/auth/password");
    hash = await hashPassword(PASSWORD);
    for (const k of Object.keys(BASE) as Key[]) {
      const [row] = await db.insert(s.users).values({ ...BASE[k], passwordHash: hash }).returning({ id: s.users.id });
      ids[k] = row.id;
    }
    dal = await import("../src/server/auth/dal");
    ss = await import("../src/server/auth/session");
    settings = await import("../src/server/actions/settings");
    invites = await import("../src/server/actions/invites");
    auth = await import("../src/server/actions/auth");
    veri = await import("../src/server/yonetici-hesaplari");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  // Her test aynı başlangıçtan: hesaplar baştaki hâlinde, testin açtığı hesaplar silinir
  beforeEach(async () => {
    reqHeaders = new Headers({ "next-action": "test" });
    await db.execute(sql`TRUNCATE activity_log, login_device_locks, user_tokens, revoked_sessions RESTART IDENTITY CASCADE`);
    await db.delete(s.users).where(notInArray(s.users.id, Object.values(ids)));
    for (const k of Object.keys(BASE) as Key[]) {
      await db
        .update(s.users)
        .set({ ...BASE[k], active: true, passwordHash: hash, failedLogins: 0, lockedUntil: null, totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: null })
        .where(eq(s.users.id, ids[k]));
    }
  });

  const row = async (k: Key) => (await db.select().from(s.users).where(eq(s.users.id, ids[k])))[0];
  const byEmail = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];
  const seenOf = (u: typeof s.users.$inferSelect) => ({ name: u.name, email: u.email, role: u.role, active: u.active, branchId: u.branchId ?? null });
  const logActions = async () => (await db.select({ action: s.activityLog.action }).from(s.activityLog).orderBy(asc(s.activityLog.id))).map((r) => r.action);
  /** Hesapların, bağlantıların, kilitlerin ve işlem geçmişinin izi: reddedilen işlem bunu değiştirmemeli */
  const fingerprint = async () =>
    JSON.stringify([
      await db.select().from(s.users).orderBy(asc(s.users.id)),
      await db.select().from(s.userTokens).orderBy(asc(s.userTokens.id)),
      await db.select().from(s.loginDeviceLocks),
      await logActions(),
    ]);
  /** Panel oturumu (ladmin; bu tarayıcıda yeni çerez kutusu) */
  const signIn = async (k: Key) => {
    jar = new Jar();
    await dal.startSession(await row(k));
  };
  /** Yönetim konsolunun oturumu (yalnız konsol çerezi; panel oturumu yok) */
  const konsol = async (k: Key = "ana") => {
    jar = new Jar();
    await dal.startYonetimSession(await row(k));
    assert.ok(jar.get(ss.YONETIM_COOKIE), "konsol çerezi");
    assert.equal(jar.get(ss.SESSION_COOKIE), undefined, "panel oturumu yok");
  };
  const refused = (is: AsilYoneticiIsi) => ({ ok: false, error: yalnizAsilYonetici(is) });
  /** Veli iki adımlı ve kilitli: bütün güvenlik işleri uygulanabilir */
  const veliHazir = () => db.update(s.users).set({ totpEnabled: true, totpSecret: "x", recoveryCodes: ["a"], failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000) }).where(eq(s.users.id, ids.veli));
  const save = async (k: Key, o: Partial<{ name: string; email: string; role: Base["role"]; active: boolean; branchId: string | null; password: string }>, confirm?: { password: string }) => {
    const u = await row(k);
    return settings.saveUser({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, branchId: u.branchId ?? null, seen: seenOf(u), ...o }, confirm);
  };

  test("öteki yönetici: yönetici hesabına dokunan her işte okunur ret, parola sorusundan önce; hiçbir satır yazılmaz", async () => {
    await veliHazir();
    await signIn("ali");
    const before = await fingerprint();
    const cases: [string, AsilYoneticiIsi, (confirm?: { password: string }) => Promise<unknown>][] = [
      ["yönetici açmak (davet)", "yoneticiAcma", (c) => settings.createUser({ mode: "invite", name: "Yeni", email: "yeni@ornek.com", role: "admin", active: true, branchId: null }, c)],
      ["yönetici açmak (parola)", "yoneticiAcma", (c) => settings.createUser({ mode: "password", name: "Yeni", email: "yeni@ornek.com", role: "admin", active: false, branchId: null, password: "Zor-Bir-Parola-48213!" }, c)],
      ["yöneticinin e-postası", "yoneticiDuzenleme", (c) => save("veli", { email: "veli.yeni@ornek.com" }, c)],
      ["yöneticinin parolası", "yoneticiDuzenleme", (c) => save("veli", { password: "Zor-Bir-Parola-48213!" }, c)],
      ["yöneticinin erişimi (düzenleme)", "yoneticiDuzenleme", (c) => save("veli", { active: false }, c)],
      ["yöneticiliği almak (müdür)", "yoneticilikAlma", (c) => save("veli", { role: "manager", branchId: "tuzla" }, c)],
      ["yöneticiliği almak (personel)", "yoneticilikAlma", (c) => save("veli", { role: "staff", branchId: null }, c)],
      ["personele yöneticilik vermek", "yoneticilikVerme", (c) => save("ayse", { role: "admin", branchId: null }, c)],
      ["müdüre yöneticilik vermek", "yoneticilikVerme", (c) => save("mehmet", { role: "admin", branchId: null }, c)],
      ["muhasebeciye yöneticilik vermek", "yoneticilikVerme", (c) => save("zeynep", { role: "admin" }, c)],
      ["pasif yapmak (anahtar)", "yoneticiErisimi", (c) => settings.setUserActive(ids.veli, false, c)],
      ["silmek", "yoneticiSilme", (c) => settings.deleteUser(ids.veli, c)],
      ["iki adımlıyı sıfırlamak", "yoneticiIkiAdim", (c) => settings.resetUserTwoFactor(ids.veli, c)],
      ["kilidi açmak", "yoneticiKilidi", () => settings.unlockUser(ids.veli)],
      ["oturumları kapatmak", "yoneticiOturumlari", () => settings.signOutUserEverywhere(ids.veli)],
      ["giriş bağlantısı", "yoneticiBaglantisi", (c) => invites.createAccessLink(ids.veli, c)],
    ];
    for (const [what, is, call] of cases) {
      // Parolasız (STEP_UP_REQUIRED değil), yanlış parolayla (WRONG_PASSWORD değil) ve doğru parolayla: aynı ret
      for (const confirm of [undefined, { password: "yanlis-parola" }, PW]) {
        assert.deepEqual(await call(confirm), refused(is), `${what} (${confirm ? (confirm === PW ? "doğru parola" : "yanlış parola") : "parolasız"})`);
      }
    }
    // Pasif bir yönetici de yönetici hesabıdır: yeniden aktif yapmak da yasak
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, ids.veli));
    assert.deepEqual(await settings.setUserActive(ids.veli, true, PW), refused("yoneticiErisimi"));
    await db.update(s.users).set({ active: true }).where(eq(s.users.id, ids.veli));
    assert.equal(await fingerprint(), before, "hiçbir satır yazılmadı, parola denenmedi (işlem geçmişi boş)");
  });

  test("öteki yönetici başka bir yöneticinin yalnız adını değiştirebilir; oturumu kapanmaz", async () => {
    await signIn("ali");
    const before = await row("veli");
    const r = await save("veli", { name: "Veli K." });
    assert.equal(r.ok, true, JSON.stringify(r));
    const after = await row("veli");
    assert.deepEqual([after.name, after.email, after.role, after.active, after.sessionVersion, after.passwordHash], ["Veli K.", before.email, "admin", true, before.sessionVersion, before.passwordHash]);
    assert.deepEqual(await logActions(), ["Kullanıcı güncellendi"]);
    // Ad ile birlikte başka bir şey değişirse yine ret
    assert.deepEqual(await save("veli", { name: "Veli Kaya", email: "veli.kaya@ornek.com" }), refused("yoneticiDuzenleme"));
    assert.equal((await row("veli")).name, "Veli K.");
  });

  test("asıl yönetici, panel oturumuyla: yönetici hesabına dokunan her iş parolayla geçer", async () => {
    await veliHazir();
    await signIn("ana");
    // Kapı geçer, parola sorulur (parolasız: STEP_UP_REQUIRED)
    const invite = { mode: "invite", name: "Yeni Yönetici", email: "yeni@ornek.com", role: "admin", active: true, branchId: null } as const;
    assert.deepEqual(await settings.createUser(invite), { ok: false, error: STEP_UP_REQUIRED });
    const created = await settings.createUser(invite, PW);
    assert.ok(created.ok && created.data.kind === "invite" && created.data.link, JSON.stringify(created));
    assert.equal((await byEmail("yeni@ornek.com")).role, "admin");
    // Yöneticilik vermek ve almak (personelin şubesi geri verilir)
    assert.equal((await save("ayse", { role: "admin", branchId: null }, PW)).ok, true);
    assert.deepEqual([(await row("ayse")).role, (await row("ayse")).branchId], ["admin", null]);
    assert.equal((await save("ayse", { role: "staff", branchId: "marina" }, PW)).ok, true);
    assert.deepEqual([(await row("ayse")).role, (await row("ayse")).branchId], ["staff", "marina"]);
    // Müdüre indirmek: şube zorunlu (mevcut kural)
    const noBranch = await save("veli", { role: "manager", branchId: null }, PW);
    assert.equal(noBranch.ok ? "" : noBranch.error, "Müdürün şubesini seçin: müdür yalnız kendi şubesini yönetir");
    // Yöneticinin e-postası, erişimi, iki adımlısı, kilidi, oturumları, bağlantısı
    assert.equal((await save("veli", { email: "veli.yeni@ornek.com" }, PW)).ok, true);
    assert.equal((await settings.setUserActive(ids.veli, false, PW)).ok, true);
    assert.equal((await settings.setUserActive(ids.veli, true, PW)).ok, true);
    assert.equal((await settings.resetUserTwoFactor(ids.veli, PW)).ok, true);
    assert.equal((await settings.unlockUser(ids.veli)).ok, true);
    const sv = (await row("veli")).sessionVersion;
    assert.equal((await settings.signOutUserEverywhere(ids.veli)).ok, true);
    const v = await row("veli");
    assert.deepEqual([v.email, v.active, v.totpEnabled, v.lockedUntil, v.failedLogins, v.sessionVersion], ["veli.yeni@ornek.com", true, false, null, 0, sv + 1]);
    const link = await invites.createAccessLink(ids.veli, PW);
    assert.ok(link.ok && link.data.kind === "reset", JSON.stringify(link));
    // Silmek
    assert.equal((await settings.deleteUser(created.ok ? created.data.userId : 0, PW)).ok, true);
    assert.equal(await byEmail("yeni@ornek.com"), undefined);
  });

  test("asıl yönetici, konsol oturumuyla (panel çerezi yok): aynı işler geçer; panel oturumu açılmaz", async () => {
    await veliHazir();
    await konsol();
    const created = await settings.createUser({ mode: "password", name: "Konsol Yönetici", email: "konsol@ornek.com", role: "admin", active: true, branchId: null, password: "Sabah-Simidi-Mavi-7319" }, PW);
    assert.ok(created.ok && created.data.kind === "password", JSON.stringify(created));
    assert.equal((await save("kemal", { role: "admin", branchId: null }, PW)).ok, true);
    assert.equal((await save("kemal", { role: "manager", branchId: "tuzla" }, PW)).ok, true);
    assert.deepEqual([(await row("kemal")).role, (await row("kemal")).branchId], ["manager", "tuzla"]);
    assert.equal((await settings.setUserActive(ids.veli, false, PW)).ok, true);
    assert.equal((await settings.setUserActive(ids.veli, true, PW)).ok, true);
    assert.equal((await settings.resetUserTwoFactor(ids.veli, PW)).ok, true);
    assert.equal((await settings.unlockUser(ids.veli)).ok, true);
    assert.equal((await settings.signOutUserEverywhere(ids.veli)).ok, true);
    const link = await invites.createAccessLink(ids.veli, PW);
    assert.ok(link.ok, JSON.stringify(link));
    // "Giriş bilgileri"ni e-postayla gönderme de konsoldan çağrılır (e-posta kapalı: okunur hata, yönlendirme değil)
    const mail = await invites.emailAccess({ userId: ids.veli, kind: "reset", secret: link.ok ? link.data.token! : "x" });
    assert.deepEqual(mail, { ok: false, error: "E-posta gönderimi kapalı (RESEND_API_KEY tanımlı değil); bilgileri kopyalayıp iletin" });
    // Yanlış parola: onay asıl yöneticinin parolasıyla, hatası onun hesabına yazılır
    assert.deepEqual(await settings.deleteUser(created.ok ? created.data.userId : 0, { password: "yanlis-parola" }), { ok: false, error: WRONG_PASSWORD });
    assert.ok((await logActions()).includes("Hatalı parola onayı (Kullanıcılar)"));
    assert.equal((await settings.deleteUser(created.ok ? created.data.userId : 0, PW)).ok, true);
    // Kendi adı konsoldan: panel çerezi yazılmaz
    assert.equal((await save("ana", { name: "Asıl Yönetici" })).ok, true);
    assert.equal(jar.get(ss.SESSION_COOKIE), undefined, "konsoldan gelen istekte panel oturumu açılmadı");
    // İşlem geçmişinde yapan asıl yönetici
    const [last] = await db.select({ userId: s.activityLog.userId }).from(s.activityLog).orderBy(sql`${s.activityLog.id} desc`).limit(1);
    assert.equal(last.userId, ids.ana);

    // Öteki yöneticinin konsol çerezi geçmez (getYonetimUser asıl yönetici ister): panel oturumu da yok, girişe yönlenir
    jar = new Jar();
    await dal.startYonetimSession(await row("ali"));
    await assert.rejects(settings.unlockUser(ids.veli), (e: { to?: string }) => typeof e.to === "string" && e.to.startsWith("/giris"));
  });

  test("öteki yönetici müdür, muhasebeci ve personel hesaplarında bugünkü her şeyi yapar (parolasız)", async () => {
    await signIn("ali");
    const before = (await logActions()).length;
    const staff = await settings.createUser({ mode: "password", name: "Yeni Personel", email: "personel@ornek.com", role: "staff", active: true, branchId: "marina", password: "Tuz-Biber-Deneme-4821" });
    assert.ok(staff.ok, JSON.stringify(staff));
    assert.ok((await settings.createUser({ mode: "invite", name: "Yeni Müdür", email: "mudur@ornek.com", role: "manager", active: true, branchId: "tuzla" })).ok);
    assert.ok((await settings.createUser({ mode: "invite", name: "Yeni Muhasebeci", email: "muhasebe@ornek.com", role: "accountant", active: true, branchId: null })).ok);
    // Düzenleme: e-posta, parola, rol, şube, erişim
    assert.equal((await save("mehmet", { email: "mehmet.yeni@ornek.com", password: "Kasa-Defteri-Tuzla-91" })).ok, true);
    assert.equal((await save("ayse", { role: "manager", branchId: "tuzla" })).ok, true);
    assert.equal((await save("ayse", { role: "accountant", branchId: null })).ok, true);
    assert.equal((await save("kemal", { active: false })).ok, true);
    assert.equal((await settings.setUserActive(ids.kemal, true)).ok, true);
    assert.equal((await settings.setUserActive(ids.zeynep, false)).ok, true);
    assert.equal((await settings.setUserActive(ids.zeynep, true)).ok, true);
    // Güvenlik: iki adımlı, kilit, oturumlar, bağlantı
    await db.update(s.users).set({ totpEnabled: true, totpSecret: "x" }).where(eq(s.users.id, ids.zeynep));
    assert.equal((await settings.resetUserTwoFactor(ids.zeynep)).ok, true);
    assert.equal((await row("zeynep")).totpEnabled, false);
    await db.update(s.users).set({ failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000) }).where(eq(s.users.id, ids.mehmet));
    assert.equal((await settings.unlockUser(ids.mehmet)).ok, true);
    assert.equal((await settings.signOutUserEverywhere(ids.ayse)).ok, true);
    const link = await invites.createAccessLink(ids.kemal);
    assert.ok(link.ok && link.data.kind === "reset", JSON.stringify(link));
    assert.equal((await settings.deleteUser(staff.ok ? staff.data.userId : 0)).ok, true);
    const actions = (await logActions()).slice(before);
    assert.ok(!actions.some((a) => a.startsWith("Hatalı parola")), "parola sorulmadı");
    assert.ok(actions.includes("Kullanıcı silindi") && actions.includes("Hesap kilidi açıldı") && actions.includes("İki adımlı doğrulama sıfırlandı"));
  });

  test("kendi hesabı: öteki yönetici Hesabım'da adını, e-postasını, parolasını, iki adımlısını ve oturumlarını yönetir", async () => {
    await signIn("ali");
    assert.equal((await auth.updateProfile({ name: "Ali K.", email: "ali.yeni@ornek.com", password: PASSWORD })).ok, true);
    assert.deepEqual([(await row("ali")).name, (await row("ali")).email], ["Ali K.", "ali.yeni@ornek.com"]);
    const fd = new FormData();
    fd.set("current", PASSWORD);
    fd.set("next", "Mavi-Fincan-Sabah-55");
    fd.set("repeat", "Mavi-Fincan-Sabah-55");
    assert.deepEqual(await auth.changePasswordAction({}, fd), { ok: true });
    const begin = await auth.beginTotpSetup("Mavi-Fincan-Sabah-55");
    assert.equal(begin.ok, true, JSON.stringify(begin));
    assert.deepEqual(await auth.cancelTotpSetup(), { ok: true, data: null });
    assert.deepEqual(await auth.signOutOtherSessions("Mavi-Fincan-Sabah-55"), { ok: true, data: null });
    // Kendi hesabında Kullanıcılar'ın eylemleri bugünkü gibi reddeder (Hesabım'a gönderir)
    assert.deepEqual(await invites.createAccessLink(ids.ali), { ok: false, error: "Kendi parolanızı Hesabım'dan değiştirin" });
  });

  test("kendi hesabı ve son yönetici: asıl yönetici kendini pasif yapamaz, yöneticiliğini alamaz, silemez", async () => {
    // Öteki yöneticiler pasif: asıl yönetici tek etkin yönetici
    await db.update(s.users).set({ active: false }).where(inArray(s.users.id, [ids.ali, ids.veli]));
    for (const oturum of [() => signIn("ana"), () => konsol()]) {
      await oturum();
      assert.deepEqual(await settings.setUserActive(ids.ana, false, PW), { ok: false, error: "Kendi hesabınızı pasif yapamazsınız" });
      assert.deepEqual(await save("ana", { role: "staff", branchId: null }, PW), { ok: false, error: "Kendi yönetici yetkinizi kaldıramazsınız" });
      assert.deepEqual(await save("ana", { active: false }, PW), { ok: false, error: "Kendi yönetici yetkinizi kaldıramazsınız" });
      assert.deepEqual(await settings.deleteUser(ids.ana, PW), { ok: false, error: "Kendi hesabınızı silemezsiniz" });
      assert.deepEqual(await settings.signOutUserEverywhere(ids.ana), { ok: false, error: "Kendi oturumlarınız için Hesabım'daki parola değişikliğini kullanın" });
    }
    const a = await row("ana");
    assert.deepEqual([a.role, a.active], ["admin", true]);
  });

  test("Yöneticiler sayfasının verisi: yalnız yönetici satırları (asıl yönetici başta), adaylar, kalan kurtarma kodu; sır yok", async () => {
    await db.update(s.users).set({ totpEnabled: true, totpSecret: "gizli-anahtar", recoveryCodes: ["ozet-1", "ozet-2", "ozet-3"] }).where(eq(s.users.id, ids.ana));
    await veliHazir();
    const v = await veri.yoneticiHesaplariVerisi(ids.ana);
    assert.deepEqual(
      v.yoneticiler.map((u) => [u.email, u.anaAdmin]),
      [
        [ASIL, true],
        ["ali@ornek.com", false],
        ["veli@ornek.com", false],
      ],
    );
    const veliRow = v.yoneticiler.find((u) => u.id === ids.veli)!;
    assert.deepEqual([veliRow.locked, veliRow.twoFactor, veliRow.invite, veliRow.branchId], ["account", true, "none", null]);
    assert.deepEqual(v.adaylar.map((a) => [a.email, a.role]).sort(), [
      ["ayse@ornek.com", "staff"],
      ["kemal@ornek.com", "staff"],
      ["mehmet@ornek.com", "manager"],
      ["zeynep@ornek.com", "accountant"],
    ]);
    assert.deepEqual(v.benim, { ikiAdim: true, kalanKod: 3 });
    assert.ok(v.subeler.some((b) => b.id === "marina"), "etkin fiziksel şubeler");
    const json = JSON.stringify(v);
    for (const secret of [hash, "gizli-anahtar", "ozet-1"]) assert.ok(!json.includes(secret), "sır istemciye gitmez");
    // İki adımlı kapalıysa kalan kod sayılmaz
    await db.update(s.users).set({ totpEnabled: false }).where(eq(s.users.id, ids.ana));
    assert.deepEqual((await veri.yoneticiHesaplariVerisi(ids.ana)).benim, { ikiAdim: false, kalanKod: 0 });
  });
});
