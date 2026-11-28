// ladmin'den ayırma (docs/planlar/yonetim-konsolu.md › K-C; docs/ROLLER.md › Asıl yönetici), gerçek Postgres'te: asıl
// yöneticiye ayrılmış işler YALNIZ Yönetim konsolunun oturumuyla yapılır. Oturum gerçek src/server/auth/dal.ts'le,
// çerezler ve istek başlıkları taklit edilerek (panel oturumu ve konsol oturumu ayrı çerezde).
// - Asıl yöneticinin her işi (şube açma, kapatma, kasa programı, silme, kasa kurma, ilk personel, kasayı serbest bırakma,
//   kasa anahtarı, geçiş günü, yönetici hesaplarına dokunan sekiz iş): ladmin'in (panel) oturumuyla "Bu iş Yönetim
//   konsolunda yapılır"; ret parola sorusundan önce (parolasız, yanlış ve doğru parolayla aynı ret, parola denenmez) ve
//   hiçbir şey yazılmaz. Öteki yönetici bugünkü reddi ("Bu işlemi yalnız asıl yönetici yapar: …") alır.
// - Aynı işlerin hepsi konsol oturumuyla (panel çerezi yok) geçer; panel oturumu açılmaz, işlem geçmişinde asıl yönetici.
// - Sıradan işler ladmin'den aynen: öteki yönetici de asıl yönetici de panel oturumuyla şubenin adını, açılış gününü,
//   POS oranını ve e-postasını değiştirir; müdür, muhasebeci ve personel hesaplarını yönetir; başka yöneticinin adını
//   değiştirir. Korunan alanlar (açık / kapalı, kasa programı) bu arada değişmez.
// - Kasa açılışının uçları (/api/asilpos/acilis/*) asıl yöneticinin e-postası ve parolasıyla, oturumsuz çalışır.
// - /panel/sube-ekleme: asıl yönetici konsolun Şubeler ve kasalar sayfasına yönlenir (YONETIM_URL varsa konsolun adresi,
//   yoksa aynı adresteki /yonetim), öteki yönetici tek cümle görür, başka rol kendi ana ekranına gider.
// - Marina'nın kasa anahtarı, kasa programı ve geçiş günü bütün senaryolardan sonra baştakiyle aynı.
//
// LADMIN_AYIRMA_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen
// kullanıcı): test kendi geçici veritabanını açar, göçleri uygular, sonunda siler.
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/<boş db> npm run test:db -- tests/ladmin-ayirma-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { NextRequest } from "next/server";
import postgres from "postgres";
import type { ReactElement } from "react";

import { KONSOLDA_YAPILIR, yalnizAsilYonetici, type AsilYoneticiIsi } from "../src/lib/asil-yonetici";
import { ASILPOS_GROUP } from "../src/lib/branch-settings/groups";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import { STEP_UP_REQUIRED } from "../src/lib/step-up";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.LADMIN_AYIRMA_TEST_DATABASE_URL;
const DB_NAME = `laffogato_ladmin_ayirma_${process.pid}`;
const SECRET = "ladmin-ayirma-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const ASIL = "asil@ornek.com";
const PASSWORD = "Ladmin-Ayirma-Testi-4821";
const PW = { password: PASSWORD };
const YANLIS = { password: "yanlis-parola" };
const BASE_URL = "https://ladmin.laffogato.net";
/** Marina'nın kasasının anahtarı: canlıdaki gibi ortamda (eski tek kasalı kurulum) */
const MARINA_KEY = "marina-ortam-anahtari-0123456789-abcdefghijkl";
const BODRUM_KEY = "bodrum-panel-anahtari-0123456789-abcdefghijkl";
const STAFF = [
  { rol: "patron" as const, ad: "Ayşe Patron", pin: "482915" },
  { rol: "mudur" as const, ad: "Mehmet Müdür", pin: "731864" },
  { rol: "kasiyer" as const, ad: "Zeynep Barista", pin: "5927" },
];
const Z = { zNo: 1, receipts: 1, zTotal: 100, cash: 100, card: 0, mealCard: 0, online: 0, other: 0, offRevenue: 0, discounts: 0, openingCash: 0, cashOut: 0, countedCash: null, handedOver: 0, cashDiff: null };

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
type Role = "admin" | "manager" | "accountant" | "staff";
const BASE: Record<Key, { name: string; email: string; role: Role; branchId: string | null }> = {
  ana: { name: "Asıl", email: ASIL, role: "admin", branchId: null },
  ali: { name: "Ali", email: "ali@ornek.com", role: "admin", branchId: null },
  veli: { name: "Veli", email: "veli@ornek.com", role: "admin", branchId: null },
  mehmet: { name: "Mehmet", email: "mehmet@ornek.com", role: "manager", branchId: "tuzla" },
  zeynep: { name: "Zeynep", email: "zeynep@ornek.com", role: "accountant", branchId: null },
  ayse: { name: "Ayşe", email: "ayse@ornek.com", role: "staff", branchId: "marina" },
  kemal: { name: "Kemal", email: "kemal@ornek.com", role: "staff", branchId: null },
};

describe("ladmin'den ayırma: veritabanında", { skip: !SERVER_URL && "LADMIN_AYIRMA_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let ss: typeof import("../src/server/auth/session");
  let branches: typeof import("../src/server/actions/branches");
  let branchSettings: typeof import("../src/server/actions/branch-settings");
  let asilpos: typeof import("../src/server/actions/asilpos");
  let settings: typeof import("../src/server/actions/settings");
  let invites: typeof import("../src/server/actions/invites");
  let settingsDb: typeof import("../src/server/branch-settings");
  let keys: typeof import("../src/server/asilpos/branch");
  let routes: typeof import("../src/server/asilpos/acilis-route");
  let subeEkleme: typeof import("../src/app/panel/sube-ekleme/icerik");
  let jar = new Jar();
  let reqHeaders = new Headers();
  const ids = {} as Record<Key, number>;
  const marinaAtStart = { key: null as string | null, switchDay: null as string | null, posSource: "" };
  let ipSeq = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1", LADMIN_ANA_ADMIN: ASIL, ASILPOS_SYNC_SECRET: MARINA_KEY, APP_URL: BASE_URL });
    delete process.env.RESEND_API_KEY;
    delete process.env.KARAOKE_SYNC_SECRET;
    delete process.env.YONETIM_URL;
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
    // Bodrum: ModPOS, kayıtsız (asıl yönetici işlerinin hedefi); Kaş: kayıtsız (silinir)
    await db.insert(s.branches).values([
      { id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", active: true, sortOrder: 4 },
      { id: "kas", name: "Kaş", kind: "fiziksel", posSource: "modpos", active: true, sortOrder: 5 },
    ]);
    const { hashPassword } = await import("../src/server/auth/password");
    const hash = await hashPassword(PASSWORD);
    for (const k of Object.keys(BASE) as Key[]) {
      const [row] = await db.insert(s.users).values({ ...BASE[k], passwordHash: hash }).returning({ id: s.users.id });
      ids[k] = row.id;
    }
    // Veli iki adımlı ve kilitli: yönetici hesabının bütün güvenlik işleri uygulanabilir
    await db.update(s.users).set({ totpEnabled: true, totpSecret: "x", recoveryCodes: ["a"], failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000) }).where(eq(s.users.id, ids.veli));
    dal = await import("../src/server/auth/dal");
    ss = await import("../src/server/auth/session");
    branches = await import("../src/server/actions/branches");
    branchSettings = await import("../src/server/actions/branch-settings");
    asilpos = await import("../src/server/actions/asilpos");
    settings = await import("../src/server/actions/settings");
    invites = await import("../src/server/actions/invites");
    settingsDb = await import("../src/server/branch-settings");
    keys = await import("../src/server/asilpos/branch");
    routes = await import("../src/server/asilpos/acilis-route");
    subeEkleme = await import("../src/app/panel/sube-ekleme/icerik");
    // Marina canlıda: dün gün sonu geldi (anahtar ortamda; kasa kurulu)
    await db.insert(s.posDayReports).values({ date: "2026-11-27", branchId: "marina", z: Z, payments: [], ikram: [], source: "asilpos", receivedAt: new Date(Date.now() - 86_400_000) });
    keys.forgetPosKeys();
    marinaAtStart.key = await keys.posKeyOf("marina", db);
    marinaAtStart.switchDay = await switchDayOf("marina");
    marinaAtStart.posSource = (await branchRow("marina")).posSource;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const row = async (k: Key) => (await db.select().from(s.users).where(eq(s.users.id, ids[k])))[0];
  const seenOf = (u: typeof s.users.$inferSelect) => ({ name: u.name, email: u.email, role: u.role, active: u.active, branchId: u.branchId ?? null });
  const branchRow = async (id: string) => (await db.select().from(s.branches).where(eq(s.branches.id, id)))[0];
  const switchDayOf = async (id: string) => (await settingsDb.resolveBranchSetting(ASILPOS_GROUP, id, db)).value.switchDay;
  const logs = async () => db.select({ userId: s.activityLog.userId, action: s.activityLog.action }).from(s.activityLog).orderBy(asc(s.activityLog.id));
  const save = async (k: Key, o: Partial<{ name: string; email: string; role: Role; active: boolean; branchId: string | null; password: string }>, confirm?: { password: string }) => {
    const u = await row(k);
    return settings.saveUser({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, branchId: u.branchId ?? null, seen: seenOf(u), ...o }, confirm);
  };
  /** Şubelerin, hesapların, bağlantıların, kurulumların, şube ayarlarının ve işlem geçmişinin izi: ret bunu değiştirmemeli */
  const fingerprint = async () =>
    JSON.stringify([
      await db.select().from(s.branches).orderBy(asc(s.branches.id)),
      await db.select().from(s.users).orderBy(asc(s.users.id)),
      await db.select().from(s.userTokens).orderBy(asc(s.userTokens.id)),
      await db.select().from(s.asilposInstalls).orderBy(asc(s.asilposInstalls.id)),
      await db.select().from(s.branchSettings),
      await db.select().from(s.integrationState).orderBy(asc(s.integrationState.key)),
      await logs(),
    ]);
  /** ladmin'in oturumu (panel çerezi; bu tarayıcıda yeni çerez kutusu); sunucu eylemi isteği */
  const panel = async (k: Key) => {
    jar = new Jar();
    await dal.startSession(await row(k));
    reqHeaders = new Headers({ "next-action": "test" });
  };
  /** Yönetim konsolunun oturumu (yalnız konsol çerezi; panel oturumu yok) */
  const konsol = async () => {
    jar = new Jar();
    await dal.startYonetimSession(await row("ana"));
    reqHeaders = new Headers({ "next-action": "test" });
    assert.ok(jar.get(ss.YONETIM_COOKIE), "konsol çerezi");
    assert.equal(jar.get(ss.SESSION_COOKIE), undefined, "panel oturumu yok");
  };

  /** Asıl yöneticinin bütün işleri: ne, hangi iş (öteki yöneticinin ret cümlesi), çağrı (parola onayıyla ya da onaysız) */
  const ISLER: [string, AsilYoneticiIsi, (confirm?: { password: string }) => Promise<unknown>][] = [
    ["şube açmak", "subeAcma", () => branches.createBranch({ id: "kalkan", name: "Kalkan", kind: "fiziksel", posSource: "modpos", openedOn: null, email: "kalkan@ornek.com" })],
    ["kasa kurmak", "kasaKurma", () => branches.sendBranchInstall({ id: "bodrum", email: "bodrum@ornek.com" })],
    ["ilk personel", "ilkPersonel", () => branches.saveBranchStaff({ id: "bodrum", personel: STAFF })],
    ["kasayı serbest bırakmak", "kasaSerbest", (c) => branches.releaseBranchTill({ id: "marina", ad: "Marina" }, c)],
    ["şubeyi kapatmak", "subeKapatma", () => branches.updateBranch({ id: "bodrum", active: false })],
    ["kasa programı", "kasaProgrami", () => branches.updateBranch({ id: "bodrum", posSource: "asilpos" })],
    ["şubenin türü", "kasaProgrami", () => branches.updateBranch({ id: "bodrum", kind: "online", posSource: "yok" })],
    ["şubeyi silmek", "subeSilme", () => branches.deleteBranch({ id: "kas" })],
    ["kasa anahtarını döndürmek", "kasaAnahtari", (c) => branchSettings.saveAsilposSecret({ branchId: "marina", secret: "y".repeat(40) }, c)],
    ["kasa anahtarını silmek", "kasaAnahtari", (c) => branchSettings.saveAsilposSecret({ branchId: "marina", secret: null }, c)],
    ["geçiş günü", "gecisGunu", () => asilpos.saveAsilposSwitchDay({ branchId: "marina", day: null })],
    ["yönetici açmak", "yoneticiAcma", (c) => settings.createUser({ mode: "invite", name: "Yeni Yönetici", email: "yeni@ornek.com", role: "admin", active: true, branchId: null }, c)],
    ["yöneticilik vermek", "yoneticilikVerme", (c) => save("ayse", { role: "admin", branchId: null }, c)],
    ["yöneticiliği almak", "yoneticilikAlma", (c) => save("veli", { role: "staff", branchId: null }, c)],
    ["yöneticinin e-postası", "yoneticiDuzenleme", (c) => save("veli", { email: "veli.yeni@ornek.com" }, c)],
    ["yöneticinin parolası", "yoneticiDuzenleme", (c) => save("veli", { password: "Zor-Bir-Parola-48213!" }, c)],
    ["yöneticiyi pasif yapmak", "yoneticiErisimi", (c) => settings.setUserActive(ids.veli, false, c)],
    ["yöneticiyi silmek", "yoneticiSilme", (c) => settings.deleteUser(ids.veli, c)],
    ["yöneticinin iki adımlısı", "yoneticiIkiAdim", (c) => settings.resetUserTwoFactor(ids.veli, c)],
    ["yöneticinin kilidi", "yoneticiKilidi", () => settings.unlockUser(ids.veli)],
    ["yöneticinin oturumları", "yoneticiOturumlari", () => settings.signOutUserEverywhere(ids.veli)],
    ["yöneticiye giriş bağlantısı", "yoneticiBaglantisi", (c) => invites.createAccessLink(ids.veli, c)],
  ];

  test("ladmin'in oturumuyla asıl yöneticinin her işi: \"Bu iş Yönetim konsolunda yapılır\", parola sorusundan önce, hiçbir şey yazılmadan; öteki yönetici bugünkü reddi alır", async () => {
    assert.equal(ISLER.length, 22);
    const before = await fingerprint();
    await panel("ana");
    for (const [what, , call] of ISLER) {
      // Parolasız (STEP_UP_REQUIRED değil), yanlış parolayla (WRONG_PASSWORD değil) ve doğru parolayla: aynı ret
      for (const confirm of [undefined, YANLIS, PW]) {
        assert.deepEqual(await call(confirm), { ok: false, error: KONSOLDA_YAPILIR }, `asıl yönetici, ladmin: ${what} (${confirm === PW ? "doğru parola" : confirm ? "yanlış parola" : "parolasız"})`);
      }
    }
    assert.equal(jar.get(ss.YONETIM_COOKIE), undefined, "panel oturumu konsol oturumu açmadı");
    await panel("ali");
    for (const [what, is, call] of ISLER) {
      for (const confirm of [undefined, YANLIS, PW]) assert.deepEqual(await call(confirm), { ok: false, error: yalnizAsilYonetici(is) }, `öteki yönetici: ${what}`);
    }
    assert.equal(await dal.getYonetimUser(), null);
    assert.equal(await fingerprint(), before, "hiçbir satır yazılmadı, parola denenmedi (işlem geçmişi boş)");
    keys.forgetPosKeys();
    assert.equal(await keys.posKeyOf("marina", db), MARINA_KEY);
  });

  test("konsol oturumu olmadan geçmez: öteki yöneticinin konsol çerezi girişe, oturumsuz istek girişe, müdür ve personel ana ekranına", async () => {
    const before = await fingerprint();
    // Öteki yöneticinin (Ali) konsol çerezi: getYonetimUser asıl yönetici ister, panel oturumu da yok: girişe yönlenir
    jar = new Jar();
    await dal.startYonetimSession(await row("ali"));
    reqHeaders = new Headers({ "next-action": "test" });
    await assert.rejects(branches.createBranch({ id: "kalkan", name: "Kalkan", kind: "fiziksel", posSource: "modpos", openedOn: null }), (e: { to?: string }) => e.to === "/giris");
    // Oturumsuz istek girişe yönlenir
    jar = new Jar();
    await assert.rejects(branches.deleteBranch({ id: "kas" }), (e: { to?: string }) => e.to === "/giris");
    // Müdür ve personel kendi ana ekranına (bugünkü gibi)
    for (const k of ["mehmet", "ayse"] as const) {
      await panel(k);
      await assert.rejects(branches.updateBranch({ id: "bodrum", active: false }), (e: { to?: string }) => e.to === "/panel/bugun", k);
    }
    assert.equal(await fingerprint(), before);
  });

  test("konsol oturumuyla asıl yöneticinin bütün işleri geçer (ladmin oturumu gerekmeden); panel çerezi yazılmaz, işlem geçmişinde asıl yönetici", async () => {
    await konsol();
    const startLog = (await logs()).length;
    // Şube açmak (e-postayla: şube hesabı ve kurulum bağlantısı), kasa kurmak, ilk personel
    const kalkan = await branches.createBranch({ id: "kalkan", name: "Kalkan", kind: "fiziksel", posSource: "modpos", openedOn: null, email: "kalkan@ornek.com", personel: STAFF });
    assert.ok(kalkan.ok && kalkan.data.kurulum?.girisHesabi === ASIL, JSON.stringify(kalkan));
    assert.equal((await branches.sendBranchInstall({ id: "bodrum", email: "bodrum@ornek.com" })).ok, true);
    assert.deepEqual(await branches.saveBranchStaff({ id: "bodrum", personel: STAFF }), { ok: true, data: { saved: true } });
    // Kasa programı ve geçiş günü (kapalı dönem yok), kasa anahtarı (parolayla)
    assert.equal((await branches.updateBranch({ id: "bodrum", posSource: "asilpos" })).ok, true);
    const today = businessDate();
    const gun = await asilpos.saveAsilposSwitchDay({ branchId: "bodrum", day: today });
    assert.ok(gun.ok && gun.data.change, JSON.stringify(gun));
    assert.deepEqual(await branchSettings.saveAsilposSecret({ branchId: "bodrum", secret: BODRUM_KEY }), { ok: false, error: STEP_UP_REQUIRED }, "konsolda parola sorulur");
    assert.deepEqual(await branchSettings.saveAsilposSecret({ branchId: "bodrum", secret: BODRUM_KEY }, PW), { ok: true, data: { saved: true } });
    keys.forgetPosKeys();
    assert.equal(await keys.posKeyOf("bodrum", db), BODRUM_KEY);
    // Bodrum'un kasası kuruldu (anahtar ve dünkü gün sonu): kasayı serbest bırakmak (ad ve parolayla), anahtar yenilenir
    await db.insert(s.posDayReports).values({ date: "2026-11-27", branchId: "bodrum", z: Z, payments: [], ikram: [], source: "asilpos", receivedAt: new Date(Date.now() - 86_400_000) });
    assert.deepEqual(await branches.releaseBranchTill({ id: "bodrum", ad: "Bodrum" }, PW), { ok: true, data: { id: "bodrum" } });
    keys.forgetPosKeys();
    const yeni = await keys.posKeyOf("bodrum", db);
    assert.ok(yeni && yeni !== BODRUM_KEY && yeni !== MARINA_KEY, "anahtar yenilendi");
    // Anahtarı silmek, geçiş gününü kaldırmak, kapatmak ve yeniden açmak, silmek
    assert.deepEqual(await branchSettings.saveAsilposSecret({ branchId: "bodrum", secret: null }, PW), { ok: true, data: { saved: false } });
    assert.ok((await asilpos.saveAsilposSwitchDay({ branchId: "bodrum", day: null })).ok);
    assert.equal((await branches.updateBranch({ id: "bodrum", active: false })).ok, true);
    assert.equal((await branchRow("bodrum")).active, false);
    assert.equal((await branches.updateBranch({ id: "bodrum", active: true })).ok, true);
    assert.equal((await branches.deleteBranch({ id: "kas" })).ok, true);
    assert.equal(await branchRow("kas"), undefined);

    // Yönetici hesapları: açmak, yöneticilik vermek ve almak, e-posta, erişim, iki adımlı, kilit, oturumlar, bağlantı, silmek
    const yeniYonetici = await settings.createUser({ mode: "invite", name: "Yeni Yönetici", email: "yeni@ornek.com", role: "admin", active: true, branchId: null }, PW);
    assert.ok(yeniYonetici.ok && yeniYonetici.data.kind === "invite", JSON.stringify(yeniYonetici));
    assert.equal((await save("ayse", { role: "admin", branchId: null }, PW)).ok, true);
    assert.equal((await save("ayse", { role: "staff", branchId: "marina" }, PW)).ok, true);
    assert.deepEqual([(await row("ayse")).role, (await row("ayse")).branchId], ["staff", "marina"]);
    assert.equal((await save("veli", { name: "Veli K.", email: "veli.yeni@ornek.com" }, PW)).ok, true, "konsolda adı ve e-postası");
    assert.equal((await settings.setUserActive(ids.veli, false, PW)).ok, true);
    assert.equal((await settings.setUserActive(ids.veli, true, PW)).ok, true);
    assert.equal((await settings.resetUserTwoFactor(ids.veli, PW)).ok, true);
    assert.equal((await settings.unlockUser(ids.veli)).ok, true);
    assert.equal((await settings.signOutUserEverywhere(ids.veli)).ok, true);
    const link = await invites.createAccessLink(ids.veli, PW);
    assert.ok(link.ok && link.data.kind === "reset", JSON.stringify(link));
    assert.equal((await settings.deleteUser(yeniYonetici.ok ? yeniYonetici.data.userId : 0, PW)).ok, true);
    const v = await row("veli");
    assert.deepEqual([v.name, v.email, v.role, v.active, v.totpEnabled, v.lockedUntil], ["Veli K.", "veli.yeni@ornek.com", "admin", true, false, null]);

    assert.equal(jar.get(ss.SESSION_COOKIE), undefined, "konsoldan gelen isteklerde panel oturumu açılmadı");
    const yeniLog = (await logs()).slice(startLog);
    assert.ok(yeniLog.length >= 20, `${yeniLog.length} satır`);
    assert.ok(yeniLog.every((l) => l.userId === ids.ana), "işlem geçmişinde asıl yönetici");
    assert.ok(!yeniLog.some((l) => l.action.startsWith("Hatalı parola")), "doğru parola");
  });

  test("sıradan işler ladmin'den aynen: öteki yönetici ve asıl yönetici şubenin adını, oranını, e-postasını; müdür, muhasebeci, personel hesaplarını yönetir", async () => {
    for (const k of ["ali", "ana"] as const) {
      await panel(k);
      const startLog = (await logs()).length;
      const once = await branchRow("bodrum");
      // Şubenin adı, açılış günü, POS oranı ve e-postası (ladmin'in penceresi korunan alanları göndermez)
      const ad = await branches.updateBranch({ id: "bodrum", name: `Bodrum ${k}`, openedOn: "2026-11-01", posRate: 0.015, email: `bodrum.${k}@ornek.com` });
      assert.equal(ad.ok, true, `${k}: ${JSON.stringify(ad)}`);
      const b = await branchRow("bodrum");
      assert.deepEqual([b.name, b.openedOn, b.posRate, b.email], [`Bodrum ${k}`, "2026-11-01", 0.015, `bodrum.${k}@ornek.com`], k);
      assert.deepEqual([b.active, b.kind, b.posSource], [once.active, once.kind, once.posSource], `${k}: korunan alanlar aynı`);
      // Değişmeyen korunan alanı göndermek ret getirmez (eski sekme)
      assert.equal((await branches.updateBranch({ id: "bodrum", name: "Bodrum", active: once.active, posSource: once.posSource, kind: once.kind })).ok, true, k);
      // Müdür, muhasebeci, personel hesapları (parolasız)
      const personel = await settings.createUser({ mode: "password", name: "Yeni Personel", email: `personel.${k}@ornek.com`, role: "staff", active: true, branchId: "marina", password: "Tuz-Biber-Deneme-4821" });
      assert.ok(personel.ok, JSON.stringify(personel));
      assert.ok((await settings.createUser({ mode: "invite", name: "Yeni Müdür", email: `mudur.${k}@ornek.com`, role: "manager", active: true, branchId: "tuzla" })).ok, k);
      assert.equal((await save("mehmet", { email: `mehmet.${k}@ornek.com` })).ok, true, k);
      assert.equal((await save("kemal", { role: "manager", branchId: "tuzla" })).ok, true, k);
      assert.equal((await save("kemal", { role: "staff", branchId: null })).ok, true, k);
      assert.equal((await settings.setUserActive(ids.kemal, false)).ok, true, k);
      assert.equal((await settings.setUserActive(ids.kemal, true)).ok, true, k);
      await db.update(s.users).set({ totpEnabled: true, totpSecret: "x" }).where(eq(s.users.id, ids.zeynep));
      assert.equal((await settings.resetUserTwoFactor(ids.zeynep)).ok, true, k);
      await db.update(s.users).set({ failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000) }).where(eq(s.users.id, ids.mehmet));
      assert.equal((await settings.unlockUser(ids.mehmet)).ok, true, k);
      assert.equal((await settings.signOutUserEverywhere(ids.ayse)).ok, true, k);
      assert.ok((await invites.createAccessLink(ids.kemal)).ok, k);
      assert.equal((await settings.deleteUser(personel.ok ? personel.data.userId : 0)).ok, true, k);
      // Başka bir yöneticinin yalnız adı (oturumu kapanmaz)
      const sv = (await row("veli")).sessionVersion;
      assert.equal((await save("veli", { name: `Veli ${k}` })).ok, true, k);
      assert.deepEqual([(await row("veli")).name, (await row("veli")).sessionVersion], [`Veli ${k}`, sv]);
      const yeniLog = (await logs()).slice(startLog);
      assert.ok(!yeniLog.some((l) => l.action.startsWith("Hatalı parola")), `${k}: parola sorulmadı`);
      assert.ok(yeniLog.every((l) => l.userId === ids[k]), k);
    }
  });

  test("kasa açılışının uçları e-posta ve parolayla, oturumsuz, değişmeden: asıl yönetici girer ve boş şubeyi bağlar; öteki yönetici 403", async () => {
    jar = new Jar();
    reqHeaders = new Headers();
    const call = async (yol: "giris" | "bagla", body: unknown) => {
      const url = new URL(`${BASE_URL}/api/asilpos/acilis/${yol}`);
      const req = new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.7.0.${ipSeq++ % 200}` }, body: JSON.stringify(body) }) as unknown as NextRequest;
      const res = await (yol === "giris" ? routes.girisPOST : routes.baglaPOST)(req);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const kasa = { kimlik: "kasa-ayirma-0001", surum: "1.2.3" };
    const g = await call("giris", { eposta: ASIL, parola: PASSWORD, kasa });
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.equal(typeof g.body.belirtec, "string");
    const subeler = g.body.subeler as { id: string; secilebilir: boolean }[];
    assert.deepEqual(subeler.find((x) => x.id === "marina")?.secilebilir, false, "Marina kurulu");
    assert.equal(subeler.find((x) => x.id === "kalkan")?.secilebilir, true, "konsolda açılan, hazırlanmış şube");
    const bagla = await call("bagla", { belirtec: g.body.belirtec, sube: "kalkan", kasa });
    assert.equal(bagla.status, 200, JSON.stringify(bagla.body));
    assert.deepEqual(bagla.body.sube, { id: "kalkan", ad: "Kalkan" });
    const ali = await call("giris", { eposta: BASE.ali.email, parola: PASSWORD, kasa });
    assert.deepEqual([ali.status, ali.body.error], [403, "asil_yonetici_degil"]);
    // Uç ne panel ne konsol oturumu açar
    assert.equal(jar.get(ss.SESSION_COOKIE), undefined);
    assert.equal(jar.get(ss.YONETIM_COOKIE), undefined);
  });

  test("/panel/sube-ekleme: asıl yönetici konsolun Şubeler ve kasalar sayfasına yönlenir, öteki yönetici tek cümle görür, başka rol ana ekranına", async () => {
    await panel("ana");
    await assert.rejects(subeEkleme.SubeEklemeIcerik(), (e: { to?: string }) => e.to === "/yonetim", "YONETIM_URL yokken aynı adresteki /yonetim");
    process.env.YONETIM_URL = "https://yonetim.laffogato.net";
    try {
      await assert.rejects(subeEkleme.SubeEklemeIcerik(), (e: { to?: string }) => e.to === "https://yonetim.laffogato.net/yonetim", "konsolun adresi");
    } finally {
      delete process.env.YONETIM_URL;
    }
    await panel("ali");
    const el = (await subeEkleme.SubeEklemeIcerik()) as ReactElement<{ tone: string; title: string }>;
    assert.deepEqual([el.props.tone, el.props.title], ["neutral", KONSOLDA_YAPILIR]);
    await panel("ayse");
    await assert.rejects(subeEkleme.SubeEklemeIcerik(), (e: { to?: string }) => e.to === "/panel/bugun");
    // Yalnız konsol oturumu: ladmin'in sayfası panel oturumu ister (girişe)
    await konsol();
    await assert.rejects(subeEkleme.SubeEklemeIcerik(), (e: { to?: string }) => e.to === "/giris");
  });

  test("Marina'nın kasa anahtarı, kasa programı ve geçiş günü bütün senaryolardan sonra aynı", async () => {
    keys.forgetPosKeys();
    assert.equal(marinaAtStart.key, MARINA_KEY);
    assert.equal(await keys.posKeyOf("marina", db), marinaAtStart.key);
    assert.equal((await branchRow("marina")).posSource, marinaAtStart.posSource);
    assert.equal(await switchDayOf("marina"), marinaAtStart.switchDay);
    assert.equal((await branchRow("marina")).active, true);
  });
});
