// Asıl yönetici, gerçek Postgres'te (docs/ROLLER.md › Asıl yönetici; src/lib/asil-yonetici.ts): oturum gerçek
// src/server/auth/dal.ts'le, çerezler ve istek başlıkları taklit edilerek.
// - Korunan her şube eylemi (şube açma, kapatma, kasa programı, silme, kasa kurma, kasa anahtarı, geçiş günü): asıl
//   yönetici Yönetim konsolunun oturumuyla geçer, ladmin'in oturumuyla "Bu iş Yönetim konsolunda yapılır" alır (K-C);
//   öteki yönetici okunur hata alır, müdür ve personel kendi ana ekranına yönlenir, muhasebeci "salt okunur" alır;
//   reddedilen işlem hiçbir satır yazmaz. Şubenin öteki alanları (ad, POS oranı, e-posta) her yöneticide, ladmin'den.
// - Hesap koruması: başka yönetici asıl yöneticinin e-postasını, parolasını, rolünü, erişimini değiştiremez, silemez, iki
//   adımlısını sıfırlayamaz, kilidini açamaz, oturumlarını kapatamaz, ona bağlantı üretemez; hiçbir hesap adresini asıl
//   yöneticinin adresine çeviremez; asıl yönetici kendi e-postasını değiştiremez. O adresle hesap, hesap yokken de
//   açılamaz (istisna kapandı, 28 Kasım 2026). Yönetici hesaplarının kuralı: tests/yonetici-hesaplari-db.test.ts.
// - Kapanan şubenin bekleyen kurulum kodları iptal olur, kapalı şubenin kodu 410 alır (yanıtın biçimi aynı); kurulu
//   kasada yeni kurulum önce onay ister.
// - Marina'nın anahtarı bütün senaryolardan sonra baştakiyle aynı.
//
// ASIL_YONETICI_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, göçleri uygular, sonunda siler.
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/<boş db> npm run test:db -- tests/asil-yonetici-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ASIL_ADRES_ALINAMAZ, ASIL_EPOSTA_SABIT, KONSOLDA_YAPILIR, yalnizAsilYonetici, type AsilYoneticiIsi } from "../src/lib/asil-yonetici";
import { YENI_KURULUM_ONEKI } from "../src/lib/asilpos/kasa-durumu";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { READ_ONLY_TEXT } from "../src/lib/roles";
import { STEP_UP_REQUIRED } from "../src/lib/step-up";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.ASIL_YONETICI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_asil_yonetici_${process.pid}`;
const SECRET = "asil-yonetici-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const ASIL = "asil@ornek.com";
/** Marina'nın kasasının anahtarı: canlıdaki gibi ortamda (eski tek kasalı kurulum) */
const MARINA_KEY = "marina-ortam-anahtari-0123456789-abcdefghijkl";
const PASSWORD = "Asil-Yonetici-Testi-4821";

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

type Key = "ana" | "ali" | "mehmet" | "zeynep" | "ayse";
const BASE: Record<Key, { name: string; email: string; role: "admin" | "manager" | "accountant" | "staff"; branchId: string | null }> = {
  ana: { name: "Asıl", email: ASIL, role: "admin", branchId: null },
  ali: { name: "Ali", email: "ali@ornek.com", role: "admin", branchId: null },
  mehmet: { name: "Mehmet", email: "mehmet@ornek.com", role: "manager", branchId: "tuzla" },
  zeynep: { name: "Zeynep", email: "zeynep@ornek.com", role: "accountant", branchId: null },
  ayse: { name: "Ayşe", email: "ayse@ornek.com", role: "staff", branchId: "marina" },
};

describe("Asıl yönetici: veritabanında", { skip: !SERVER_URL && "ASIL_YONETICI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let branches: typeof import("../src/server/actions/branches");
  let branchSettings: typeof import("../src/server/actions/branch-settings");
  let asilpos: typeof import("../src/server/actions/asilpos");
  let settings: typeof import("../src/server/actions/settings");
  let invites: typeof import("../src/server/actions/invites");
  let auth: typeof import("../src/server/actions/auth");
  let kurulum: typeof import("../src/server/asilpos/kurulum");
  let kasa: typeof import("../src/server/asilpos/kasa-durumu");
  let keys: typeof import("../src/server/asilpos/branch");
  let jar = new Jar();
  let reqHeaders = new Headers();
  const ids = {} as Record<Key, number>;
  let marinaKeyAtStart: string | null = null;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1", LADMIN_ANA_ADMIN: ASIL, ASILPOS_SYNC_SECRET: MARINA_KEY });
    delete process.env.RESEND_API_KEY;
    delete process.env.KARAOKE_SYNC_SECRET;
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
    const hash = await hashPassword(PASSWORD);
    for (const k of Object.keys(BASE) as Key[]) {
      const [row] = await db.insert(s.users).values({ ...BASE[k], passwordHash: hash }).returning({ id: s.users.id });
      ids[k] = row.id;
    }
    dal = await import("../src/server/auth/dal");
    branches = await import("../src/server/actions/branches");
    branchSettings = await import("../src/server/actions/branch-settings");
    asilpos = await import("../src/server/actions/asilpos");
    settings = await import("../src/server/actions/settings");
    invites = await import("../src/server/actions/invites");
    auth = await import("../src/server/actions/auth");
    kurulum = await import("../src/server/asilpos/kurulum");
    kasa = await import("../src/server/asilpos/kasa-durumu");
    keys = await import("../src/server/asilpos/branch");
    marinaKeyAtStart = await keys.posKeyOf("marina", db);
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    reqHeaders = new Headers();
  });

  /** Bu tarayıcıda (yeni çerez kutusu) oturum; sunucu eylemi isteği (muhasebeci yönlenmez, "salt okunur" döner) */
  const signIn = async (k: Key) => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids[k]));
    await dal.startSession(u);
    reqHeaders = new Headers({ "next-action": "test" });
  };
  /** Asıl yöneticinin Yönetim konsolu oturumu (panel çerezi yok): asıl yönetici işleri yalnız bununla geçer (K-C) */
  const konsol = async () => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids.ana));
    await dal.startYonetimSession(u);
    reqHeaders = new Headers({ "next-action": "test" });
  };
  const refused = (is: AsilYoneticiIsi) => ({ ok: false, error: yalnizAsilYonetici(is) });
  /**
   * Korunan eylemin kapısı: asıl yönetici ladmin'in oturumuyla "Bu iş Yönetim konsolunda yapılır" alır, öteki yönetici
   * okunur hata alır, müdür ve personel kendi ana ekranına yönlenir, muhasebeci "salt okunur" alır. `call` her rolde
   * yeniden çağrılır
   */
  async function onlyAna(call: () => Promise<unknown>, is: AsilYoneticiIsi, what: string) {
    await signIn("ana");
    assert.deepEqual(await call(), { ok: false, error: KONSOLDA_YAPILIR }, `${what}: asıl yönetici ladmin'den`);
    await signIn("ali");
    assert.deepEqual(await call(), refused(is), `${what}: öteki yönetici`);
    for (const k of ["mehmet", "ayse"] as const) {
      await signIn(k);
      await assert.rejects(call(), (e: { to?: string }) => e.to === "/panel/bugun", `${what}: ${BASE[k].role}`);
    }
    await signIn("zeynep");
    assert.deepEqual(await call(), { ok: false, error: READ_ONLY_TEXT }, `${what}: muhasebeci`);
  }
  const branchRow = async (id: string) => (await db.select().from(s.branches).where(eq(s.branches.id, id)))[0];
  const installsOf = (id: string) => db.select().from(s.asilposInstalls).where(eq(s.asilposInstalls.branchId, id));
  const rawOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);
  const bodrum = { id: "bodrum", name: "Bodrum", kind: "fiziksel" as const, posSource: "modpos" as const, openedOn: null };

  test("şube açmak, kapatmak, kasa programı ve silmek yalnız asıl yöneticide; ad, oran ve e-posta her yöneticide", async () => {
    await onlyAna(() => branches.createBranch(bodrum), "subeAcma", "şube açma");
    assert.equal(await branchRow("bodrum"), undefined, "reddedilen eylem şube yazmadı");
    await konsol();
    const created = await branches.createBranch(bodrum);
    assert.equal(created.ok, true, JSON.stringify(created));

    const update = (o: Partial<{ name: string; posSource: "modpos" | "asilpos"; active: boolean; posRate: number; email: string }>) => () =>
      branches.updateBranch({ ...bodrum, active: true, ...o });
    await onlyAna(update({ active: false }), "subeKapatma", "kapatma");
    await onlyAna(update({ posSource: "asilpos" }), "kasaProgrami", "kasa programı");
    const row = await branchRow("bodrum");
    assert.deepEqual([row.active, row.posSource], [true, "modpos"], "reddedilen değişiklikler yazılmadı");

    // Öteki yönetici şubenin öteki alanlarını değiştirir
    await signIn("ali");
    const ok = await branches.updateBranch({ ...bodrum, name: "Bodrum Yalı", active: true, posRate: 0.015, email: "bodrum@ornek.com" });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const after = await branchRow("bodrum");
    assert.deepEqual([after.name, after.posRate, after.email], ["Bodrum Yalı", 0.015, "bodrum@ornek.com"]);
    // E-posta verilmezse eskisi kalır; şube hesabı açılmaz, kurulum bağlantısı gitmez
    assert.equal((await branches.updateBranch({ ...bodrum, name: "Bodrum", active: true })).ok, true);
    assert.equal((await branchRow("bodrum")).email, "bodrum@ornek.com");
    assert.deepEqual(await installsOf("bodrum"), []);
    assert.deepEqual(await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "bodrum@ornek.com")), []);

    // Asıl yönetici kasa programını konsoldan değiştirir ve geri alır
    await konsol();
    assert.equal((await update({ posSource: "asilpos" })()).ok, true);
    assert.equal((await update({ posSource: "modpos" })()).ok, true);

    // Silme: boş şube
    const kas = { id: "kas", name: "Kaş", kind: "fiziksel" as const, posSource: "modpos" as const, openedOn: null };
    assert.equal((await branches.createBranch(kas)).ok, true);
    await onlyAna(() => branches.deleteBranch({ id: "kas" }), "subeSilme", "silme");
    assert.ok(await branchRow("kas"), "reddedilen silme şubeyi silmedi");
    await konsol();
    assert.equal((await branches.deleteBranch({ id: "kas" })).ok, true);
    assert.equal(await branchRow("kas"), undefined);
  });

  test("kasa kurma: yalnız asıl yönetici; sonuçta giriş hesabı ve son geçerlilik; kapanan şubenin kodları iptal ve kodu 410", async () => {
    const send = (o: { confirmReplace?: boolean } = {}) => () => branches.sendBranchInstall({ id: "bodrum", email: "bodrum@ornek.com", ...o });
    await onlyAna(send(), "kasaKurma", "kasa kurma");
    assert.deepEqual(await installsOf("bodrum"), [], "reddedilen eylem bağlantı üretmedi");

    await konsol();
    const r = await send()();
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual([r.data.branch, r.data.email, r.data.girisHesabi], [{ id: "bodrum", name: "Bodrum" }, "bodrum@ornek.com", ASIL]);
    assert.ok(Date.parse(r.data.expiresAt) > Date.now(), "son geçerlilik ileride");
    assert.ok(r.data.mailError, "e-posta kurulu değil: bağlantı ekranda");
    const raw = rawOf(r.data.link);
    assert.equal((await kasa.loadKasaDurumu("bodrum", db)).durum, "bekliyor");

    // Şube kapanınca bekleyen kod iptal; kasaya 410 ve okunur cümle (bugünkü biçim)
    assert.equal((await branches.updateBranch({ ...bodrum, active: false })).ok, true);
    assert.ok((await installsOf("bodrum")).every((x) => x.revokedAt !== null && x.usedAt === null), "bekleyen kodlar iptal");
    assert.deepEqual(await kurulum.redeemInstallCode(raw, db), { status: 410, body: { ok: false, error: kurulum.KURULUM_SUBE_KAPALI } });
    assert.equal((await kasa.loadKasaDurumu("bodrum", db)).durum, "yok");

    // Kapalı şubeye kurulum gönderilmez; yeniden açılınca yeni kod
    assert.equal((await send()()).ok, false);
    assert.equal((await branches.updateBranch({ ...bodrum, active: true })).ok, true);
    const again = await send()();
    assert.ok(again.ok, JSON.stringify(again));
    const raw2 = rawOf(again.data.link);
    // İptal edilmemiş kod da şube kapalıyken geçmez ve harcanmaz
    await db.update(s.branches).set({ active: false }).where(eq(s.branches.id, "bodrum"));
    assert.deepEqual(await kurulum.redeemInstallCode(raw2, db), { status: 410, body: { ok: false, error: kurulum.KURULUM_SUBE_KAPALI } });
    assert.equal((await installsOf("bodrum")).find((x) => x.revokedAt === null)?.usedAt, null, "kod harcanmadı");
    await db.update(s.branches).set({ active: true }).where(eq(s.branches.id, "bodrum"));
    const redeemed = await kurulum.redeemInstallCode(raw2, db);
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
    assert.ok(redeemed.body.ok && redeemed.body.sube.id === "bodrum");
    assert.ok(redeemed.body.ok && redeemed.body.baglanti.LAFMALIYET_SYNC_SECRET !== MARINA_KEY, "Bodrum kendi anahtarını alır");
    // Eski, kapalıyken iptal olan kod yeniden açılınca da geçmez
    assert.equal((await kurulum.redeemInstallCode(raw, db)).status, 410);

    // Kurulu kasa: yeni kurulum önce onay ister, bağlantı üretmez; onaylanınca gider
    assert.deepEqual(await kasa.loadKasaDurumu("bodrum", db), { durum: "kurulu", sonGun: null, bekleyen: null });
    const count = (await installsOf("bodrum")).length;
    const ask = await send()();
    assert.ok(!ask.ok && ask.error.startsWith(YENI_KURULUM_ONEKI) && ask.error.includes("Yeni kurulum eski kasanın yerine geçer."), JSON.stringify(ask));
    assert.equal((await installsOf("bodrum")).length, count, "onaysız bağlantı üretilmedi");
    assert.equal((await send({ confirmReplace: true })()).ok, true);
    assert.equal((await installsOf("bodrum")).length, count + 1);
  });

  test("Marina: kurulu sayılır, yeni kurulum onay ister; anahtar dönmez", async () => {
    // Marina'nın kasası canlıda kod kullanmış (ortamdaki anahtarla): kullanılmış bir kod satırı
    await db.insert(s.asilposInstalls).values({
      branchId: "marina",
      email: "marina@ornek.com",
      tokenHash: randomBytes(16).toString("hex"),
      tokenSealed: "x",
      expiresAt: new Date(Date.now() - 86_400_000),
      usedAt: new Date(Date.now() - 2 * 86_400_000),
    });
    assert.equal((await kasa.loadKasaDurumu("marina", db)).durum, "kurulu");
    assert.equal((await kasa.loadKasaDurumu("tuzla", db)).durum, "yok");
    await konsol();
    const ask = await branches.sendBranchInstall({ id: "marina", email: "marina@ornek.com" });
    assert.ok(!ask.ok && ask.error.startsWith(YENI_KURULUM_ONEKI), JSON.stringify(ask));
    const ok = await branches.sendBranchInstall({ id: "marina", email: "marina@ornek.com", confirmReplace: true });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(await keys.posKeyOf("marina", db), MARINA_KEY, "kurulum Marina'nın anahtarını döndürmedi");
  });

  test("kasa anahtarı ve geçiş günü yalnız asıl yöneticide", async () => {
    const secret = () => branchSettings.saveAsilposSecret({ branchId: "marina", secret: "y".repeat(40) });
    await onlyAna(secret, "kasaAnahtari", "kasa anahtarı");
    await onlyAna(() => branchSettings.saveAsilposSecret({ branchId: "marina", secret: null }), "kasaAnahtari", "anahtarı silme");
    // Asıl yönetici konsoldan kapıdan geçer, parola sorulur (anahtar değişmez)
    await konsol();
    assert.deepEqual(await secret(), { ok: false, error: STEP_UP_REQUIRED });
    assert.equal(await keys.posKeyOf("marina", db), MARINA_KEY);

    const day = () => asilpos.saveAsilposSwitchDay({ branchId: "marina", day: null });
    await onlyAna(day, "gecisGunu", "geçiş günü");
    await konsol();
    assert.deepEqual(await day(), { ok: true, data: { change: null } }, "geçiş günü zaten boş: değişiklik yok");
  });

  test("asıl yöneticinin hesabı korunur: başka yönetici e-posta, parola, rol, erişim, silme, iki adımlı, kilit, oturum, bağlantı", async () => {
    const before = (await db.select().from(s.users).where(eq(s.users.id, ids.ana)))[0];
    const seen = { name: before.name, email: before.email, role: before.role, active: before.active, branchId: null };
    const save = (o: Record<string, unknown>) => settings.saveUser({ id: ids.ana, name: before.name, email: before.email, role: "admin", active: true, branchId: null, seen, ...o } as Parameters<typeof settings.saveUser>[0]);
    await signIn("ali");
    assert.deepEqual(await save({ email: "yeni@ornek.com" }), refused("hesapDuzenleme"), "e-posta");
    assert.deepEqual(await save({ password: "Zor-Bir-Parola-48213!" }), refused("hesapDuzenleme"), "parola");
    assert.deepEqual(await save({ role: "manager", branchId: "tuzla" }), refused("hesapDuzenleme"), "rol");
    assert.deepEqual(await save({ active: false }), refused("hesapDuzenleme"), "erişim");
    assert.deepEqual(await settings.setUserActive(ids.ana, false), refused("hesapErisimi"));
    assert.deepEqual(await settings.deleteUser(ids.ana), refused("hesapSilme"));
    assert.deepEqual(await settings.resetUserTwoFactor(ids.ana), refused("hesapIkiAdim"));
    assert.deepEqual(await settings.unlockUser(ids.ana), refused("hesapKilidi"));
    assert.deepEqual(await settings.signOutUserEverywhere(ids.ana), refused("hesapOturumlari"));
    assert.deepEqual(await invites.createAccessLink(ids.ana), refused("hesapBaglantisi"));
    // Adı değiştirmek serbest
    assert.equal((await save({ name: "Asıl Yönetici" })).ok, true);
    const now = (await db.select().from(s.users).where(eq(s.users.id, ids.ana)))[0];
    assert.deepEqual(
      [now.email, now.role, now.active, now.passwordHash, now.sessionVersion],
      [before.email, before.role, before.active, before.passwordHash, before.sessionVersion],
      "hesabın korunan alanları değişmedi",
    );
    assert.deepEqual(await db.select({ id: s.userTokens.id }).from(s.userTokens).where(eq(s.userTokens.userId, ids.ana)), [], "bağlantı üretilmedi");

    // Hiçbir hesap adresini asıl yöneticinin adresine çeviremez; o adresle yeni hesap açılamaz (hesap var)
    const ayse = (await db.select().from(s.users).where(eq(s.users.id, ids.ayse)))[0];
    const ayseSeen = { name: ayse.name, email: ayse.email, role: ayse.role, active: ayse.active, branchId: ayse.branchId };
    assert.deepEqual(
      await settings.saveUser({ id: ids.ayse, name: ayse.name, email: ASIL, role: "staff", active: true, branchId: "marina", seen: ayseSeen }),
      { ok: false, error: ASIL_ADRES_ALINAMAZ },
    );
    assert.deepEqual(
      await settings.createUser({ mode: "invite", name: "Taklit", email: ASIL.toUpperCase(), role: "staff", active: true, branchId: null }),
      { ok: false, error: ASIL_ADRES_ALINAMAZ },
    );
    assert.deepEqual(await auth.updateProfile({ name: "Ali", email: ASIL, password: PASSWORD }), { ok: false, error: ASIL_ADRES_ALINAMAZ }, "Hesabım");
    assert.equal((await db.select().from(s.users).where(eq(s.users.id, ids.ali)))[0].email, BASE.ali.email);

    // Asıl yönetici kendi e-postasını değiştiremez (Hesabım, ladmin); başka bir yöneticinin hesabında iş konsolda (K-C)
    await signIn("ana");
    assert.deepEqual(await auth.updateProfile({ name: "Asıl", email: "baska@ornek.com", password: PASSWORD }), { ok: false, error: ASIL_EPOSTA_SABIT });
    assert.equal((await db.select().from(s.users).where(eq(s.users.id, ids.ana)))[0].email, ASIL);
    assert.deepEqual(await settings.unlockUser(ids.ali), { ok: false, error: KONSOLDA_YAPILIR });
    assert.deepEqual(await settings.signOutUserEverywhere(ids.ali), { ok: false, error: KONSOLDA_YAPILIR });
    await konsol();
    assert.equal((await settings.unlockUser(ids.ali)).ok, true);
    assert.equal((await settings.signOutUserEverywhere(ids.ali)).ok, true);
  });

  test("asıl yöneticinin adresi, o adresle hesap yokken de alınamaz (istisna kapandı); yönetici rolüyle de", async () => {
    const BOS = "bos-asil@ornek.com";
    process.env.LADMIN_ANA_ADMIN = BOS;
    try {
      await signIn("ali");
      for (const role of ["staff", "accountant"] as const) {
        assert.deepEqual(await settings.createUser({ mode: "invite", name: "Yeni Asıl", email: BOS, role, active: true, branchId: null }), { ok: false, error: ASIL_ADRES_ALINAMAZ }, role);
      }
      // Yönetici rolüyle: o adreste asıl yönetici yok, kimse asıl yönetici değil; yönetici açmak reddedilir
      assert.deepEqual(
        await settings.createUser({ mode: "invite", name: "Yeni Asıl", email: BOS, role: "admin", active: true, branchId: null }),
        { ok: false, error: yalnizAsilYonetici("yoneticiAcma") },
      );
      // Var olan bir hesabın adresi de o adrese çevrilemez
      const ayse = (await db.select().from(s.users).where(eq(s.users.id, ids.ayse)))[0];
      const ayseSeen = { name: ayse.name, email: ayse.email, role: ayse.role, active: ayse.active, branchId: ayse.branchId };
      assert.deepEqual(await settings.saveUser({ id: ids.ayse, name: ayse.name, email: BOS, role: "staff", active: true, branchId: ayse.branchId, seen: ayseSeen }), { ok: false, error: ASIL_ADRES_ALINAMAZ });
      assert.deepEqual(await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, BOS)), [], "hesap açılmadı");
    } finally {
      process.env.LADMIN_ANA_ADMIN = ASIL;
      const made = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, BOS));
      if (made.length) {
        await db.delete(s.userTokens).where(inArray(s.userTokens.userId, made.map((u) => u.id)));
        await db.delete(s.users).where(inArray(s.users.id, made.map((u) => u.id)));
      }
    }
  });

  test("Marina'nın anahtarı bütün senaryolardan sonra baştakiyle aynı", async () => {
    assert.equal(marinaKeyAtStart, MARINA_KEY);
    assert.equal(await keys.posKeyOf("marina", db), marinaKeyAtStart);
  });
});
