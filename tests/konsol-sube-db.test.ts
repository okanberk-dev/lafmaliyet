// Yönetim konsolunda şube işlemleri, gerçek Postgres'te (docs/SUBE.md › Şube işlemleri; docs/planlar/yonetim-konsolu.md ›
// K-A): konsolun sayfası var olan sunucu eylemlerini konsol oturumuyla çağırır (panel çerezi yok). Çerezler ve istek
// başlıkları taklit edilir; oturum gerçek src/server/auth/dal.ts'le.
// - Kapatma ve yeniden açma (updateBranch yalnız açık / kapalıyla), tür ve kasa programı (AsilPOS'tan ModPOS'a dönüşte
//   mevcut onay), geçiş günü (kapalı dönem kuralı), silme (yalnız kaydı olmayan şube), kasa anahtarını döndürme ve silme,
//   eski anahtarı silme: hepsi konsol oturumuyla geçer; parola onayı (requireStepUp) konsol oturumuyla çalışır.
// - updateBranch'te verilmeyen alanın eskisi kalır: ladmin'in ad düzenlemesi konsolda kapatılan şubeyi açmaz, kasa
//   programını değiştirmez; öteki yönetici panelde eskisi gibi reddedilir.
// - Konsolun veri okuyucusu (src/server/sube-islemleri.ts): Marina canlı, anahtar ortamda, anahtar değeri dönmez.
// - Marina'nın anahtarı, kasa programı ve geçiş günü öteki senaryolardan sonra aynı; anahtar yalnız açık "döndür"
//   işlemiyle değişir.
//
// KONSOL_SUBE_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, göçleri uygular, sonunda siler.
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/<boş db> npm run test:db -- tests/konsol-sube-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { yalnizAsilYonetici, type AsilYoneticiIsi } from "../src/lib/asil-yonetici";
import { ASILPOS_GROUP } from "../src/lib/branch-settings/groups";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import { CLOSED_PERIODS_KEY } from "../src/lib/closed-period";
import { POS_OFF_CONFIRM_PREFIX } from "../src/lib/pos/tills";
import { STEP_UP_REQUIRED, WRONG_PASSWORD } from "../src/lib/step-up";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.KONSOL_SUBE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_konsol_sube_${process.pid}`;
const SECRET = "konsol-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const ASIL = "asil@ornek.com";
const PASSWORD = "Konsol-Sube-Testi-4821";
/** Marina'nın kasasının anahtarı: canlıdaki gibi ortamda (eski tek kasalı kurulum) */
const MARINA_KEY = "marina-ortam-anahtari-0123456789-abcdefghijkl";
const BODRUM_KEY = "bodrum-panel-anahtari-0123456789-abcdefghijkl";
const MARINA_NEW_KEY = "marina-yeni-anahtar-0123456789-abcdefghijklmn";

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

describe("Yönetim konsolu: şube işlemleri veritabanında", { skip: !SERVER_URL && "KONSOL_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let ss: typeof import("../src/server/auth/session");
  let branches: typeof import("../src/server/actions/branches");
  let branchSettings: typeof import("../src/server/actions/branch-settings");
  let asilpos: typeof import("../src/server/actions/asilpos");
  let settingsDb: typeof import("../src/server/branch-settings");
  let keys: typeof import("../src/server/asilpos/branch");
  let islem: typeof import("../src/server/sube-islemleri");
  let jar = new Jar();
  let reqHeaders = new Headers();
  const ids = { ana: 0, ali: 0 };
  const marinaAtStart = { key: null as string | null, switchDay: null as string | null };

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
    const [a] = await db.insert(s.users).values({ name: "Asıl", email: ASIL, role: "admin", passwordHash: hash }).returning({ id: s.users.id });
    const [b] = await db.insert(s.users).values({ name: "Ali", email: "ali@ornek.com", role: "admin", passwordHash: hash }).returning({ id: s.users.id });
    ids.ana = a.id;
    ids.ali = b.id;
    dal = await import("../src/server/auth/dal");
    ss = await import("../src/server/auth/session");
    branches = await import("../src/server/actions/branches");
    branchSettings = await import("../src/server/actions/branch-settings");
    asilpos = await import("../src/server/actions/asilpos");
    settingsDb = await import("../src/server/branch-settings");
    keys = await import("../src/server/asilpos/branch");
    islem = await import("../src/server/sube-islemleri");
    // Marina canlıda: dün gün sonu geldi (anahtar ortamda)
    const z = { zNo: 1, receipts: 1, zTotal: 100, cash: 100, card: 0, mealCard: 0, online: 0, other: 0, offRevenue: 0, discounts: 0, openingCash: 0, cashOut: 0, countedCash: null, handedOver: 0, cashDiff: null };
    await db.insert(s.posDayReports).values({ date: "2026-11-27", branchId: "marina", z, payments: [], ikram: [], source: "asilpos", receivedAt: new Date(Date.now() - 86_400_000) });
    keys.forgetPosKeys();
    marinaAtStart.key = await keys.posKeyOf("marina", db);
    marinaAtStart.switchDay = await switchDayOf("marina");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    reqHeaders = new Headers({ "next-action": "test" });
  });

  const userRow = async (id: number) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0];
  const branchRow = async (id: string) => (await db.select().from(s.branches).where(eq(s.branches.id, id)))[0];
  const switchDayOf = async (id: string) => (await settingsDb.resolveBranchSetting(ASILPOS_GROUP, id, db)).value.switchDay;
  const lastLog = async () => (await db.select().from(s.activityLog).orderBy(desc(s.activityLog.id)).limit(1))[0];

  /** Konsol oturumu (yalnız konsol çerezi; panel oturumu yok): konsoldan çağrılan eylemler */
  const konsol = async () => {
    jar = new Jar();
    await dal.startYonetimSession(await userRow(ids.ana));
    assert.ok(jar.get(ss.YONETIM_COOKIE), "konsol çerezi");
    assert.equal(jar.get(ss.SESSION_COOKIE), undefined, "panel oturumu yok");
  };
  /** Panel oturumu (ladmin) */
  const panel = async (k: "ana" | "ali") => {
    jar = new Jar();
    await dal.startSession(await userRow(ids[k]));
  };
  const refused = (is: AsilYoneticiIsi) => ({ ok: false, error: yalnizAsilYonetici(is) });
  const bodrum = { id: "bodrum", name: "Bodrum", kind: "fiziksel" as const, posSource: "modpos" as const, openedOn: "2026-11-01" };

  test("kapatma ve yeniden açma konsol oturumuyla: yalnız açık / kapalı gider, öteki alanlar aynı kalır; kurallar aynen", async () => {
    await konsol();
    const created = await branches.createBranch(bodrum);
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal((await lastLog()).userId, ids.ana, "işlem geçmişinde asıl yöneticinin hesabı");

    const kapat = await branches.updateBranch({ id: "bodrum", active: false });
    assert.equal(kapat.ok, true, JSON.stringify(kapat));
    let row = await branchRow("bodrum");
    assert.deepEqual([row.active, row.name, row.kind, row.posSource, row.openedOn], [false, "Bodrum", "fiziksel", "modpos", "2026-11-01"], "ad, tür, kasa programı ve açılış günü değişmedi");
    const log = await lastLog();
    assert.deepEqual([log.userId, log.action, log.detail], [ids.ana, "Şube güncellendi", "Bodrum · kapatıldı"]);

    assert.equal((await branches.updateBranch({ id: "bodrum", active: true })).ok, true);
    row = await branchRow("bodrum");
    assert.deepEqual([row.active, row.openedOn], [true, "2026-11-01"]);

    // Kurallar aynen (branchChangeError): sabit kayıt kapatılmaz, türü değişmez
    assert.deepEqual(await branches.updateBranch({ id: "tuzla", active: false }), { ok: false, error: "Tuzla kapatılamaz: panelin ciroyu bölmesi buna bağlı" });
    assert.deepEqual(await branches.updateBranch({ id: "online", kind: "fiziksel", posSource: "modpos" }), { ok: false, error: "laffogato.net kaydının türü değiştirilemez" });
    assert.equal((await branchRow("tuzla")).active, true);
  });

  test("tür ve kasa programı konsoldan: AsilPOS'tan ModPOS'a dönüşte mevcut onay; geçiş günü kapalı dönem kuralıyla", async () => {
    await konsol();
    assert.equal((await branches.updateBranch({ id: "bodrum", posSource: "asilpos" })).ok, true);
    assert.deepEqual([(await branchRow("bodrum")).kind, (await branchRow("bodrum")).posSource], ["fiziksel", "asilpos"]);

    // Geçiş günü: kaynağı değişen ayın dönemi kapalıysa yazılmaz
    const today = businessDate();
    await db.insert(s.integrationState).values({ key: CLOSED_PERIODS_KEY, value: { months: { [today.slice(0, 7)]: { at: new Date().toISOString(), by: "Test" } } } });
    const kapali = await asilpos.saveAsilposSwitchDay({ branchId: "bodrum", day: today });
    assert.ok(!kapali.ok && kapali.error.includes("dönemi kapalı"), JSON.stringify(kapali));
    assert.equal(await switchDayOf("bodrum"), null, "kapalı dönemde yazılmadı");
    await db.delete(s.integrationState).where(eq(s.integrationState.key, CLOSED_PERIODS_KEY));
    const gun = await asilpos.saveAsilposSwitchDay({ branchId: "bodrum", day: today });
    assert.ok(gun.ok && gun.data.change, JSON.stringify(gun));
    assert.equal(await switchDayOf("bodrum"), today);

    // ModPOS'a dönüş: şube AsilPOS'u kullanıyor (geçiş günü var) → önce onay, onaysız hiçbir şey yazılmaz
    const sor = await branches.updateBranch({ id: "bodrum", kind: "fiziksel", posSource: "modpos" });
    assert.ok(!sor.ok && sor.error.startsWith(POS_OFF_CONFIRM_PREFIX), JSON.stringify(sor));
    assert.equal((await branchRow("bodrum")).posSource, "asilpos");
    assert.equal(await switchDayOf("bodrum"), today);
    assert.equal((await branches.updateBranch({ id: "bodrum", kind: "fiziksel", posSource: "modpos", confirmPosOff: true })).ok, true);
    assert.equal((await branchRow("bodrum")).posSource, "modpos");
    assert.equal(await switchDayOf("bodrum"), null, "onaylanınca geçiş günü silindi");

    // Tür: online kanala ve geri (kasa programı birlikte); online kanalın kasası olmaz
    assert.deepEqual(await branches.updateBranch({ id: "bodrum", kind: "online", posSource: "modpos" }), { ok: false, error: "Online kanalın kasası olmaz; kasa kaynağını “Kasa yok” seçin" });
    assert.equal((await branches.updateBranch({ id: "bodrum", kind: "online", posSource: "yok" })).ok, true);
    assert.deepEqual([(await branchRow("bodrum")).kind, (await branchRow("bodrum")).posSource], ["online", "yok"]);
    assert.equal((await branches.updateBranch({ id: "bodrum", kind: "fiziksel", posSource: "modpos" })).ok, true);
    assert.deepEqual([(await branchRow("bodrum")).kind, (await branchRow("bodrum")).posSource, (await branchRow("bodrum")).active], ["fiziksel", "modpos", true]);
  });

  test("silme konsoldan: yalnız hiç kaydı olmayan şube; Marina ve sabit kayıt silinmez; ekran aynı nedeni önceden söyler", async () => {
    await konsol();
    assert.equal((await branches.createBranch({ id: "kas", name: "Kaş", kind: "fiziksel", posSource: "modpos", openedOn: null })).ok, true);
    assert.equal((await islem.subeIslemVerisi("kas", db))?.silinemez, null);
    assert.equal((await branches.deleteBranch({ id: "kas" })).ok, true);
    assert.equal(await branchRow("kas"), undefined);

    const marina = await branches.deleteBranch({ id: "marina" });
    assert.ok(!marina.ok && /^Marina silinemez: bu şubeye yazılmış \d+ kayıt var\. Önce kapatın$/.test(marina.error), JSON.stringify(marina));
    assert.ok(await branchRow("marina"), "Marina duruyor");
    assert.equal((await islem.subeIslemVerisi("marina", db))?.silinemez, marina.ok ? null : marina.error, "ekran sunucuyla aynı nedeni söyler");
    assert.deepEqual(await branches.deleteBranch({ id: "tuzla" }), { ok: false, error: "Tuzla silinemez" });
  });

  test("kasa anahtarı konsoldan: parola onayı konsol oturumuyla (requireStepUp); döndür, sil, eski anahtarı sil", async () => {
    await konsol();
    assert.equal((await branches.updateBranch({ id: "bodrum", posSource: "asilpos" })).ok, true);
    const kaydet = (confirm?: { password: string }) => branchSettings.saveAsilposSecret({ branchId: "bodrum", secret: BODRUM_KEY }, confirm);
    assert.deepEqual(await kaydet(), { ok: false, error: STEP_UP_REQUIRED }, "parola sorulur");
    assert.deepEqual(await kaydet({ password: "yanlis-parola" }), { ok: false, error: WRONG_PASSWORD });
    const hatali = await lastLog();
    assert.deepEqual([hatali.userId, hatali.action], [ids.ana, "Hatalı parola onayı (AsilPOS)"], "yanlış parola asıl yöneticinin hesabına yazılır");
    assert.ok(!hatali.detail?.includes("yanlis-parola"), "parola günlüğe yazılmaz");
    assert.equal(await keys.posKeyOf("bodrum", db), null, "onaysız anahtar yazılmadı");
    assert.equal(jar.get(ss.SESSION_COOKIE), undefined, "onay panel oturumu olmadan, konsol oturumuyla");
    assert.deepEqual(await kaydet({ password: PASSWORD }), { ok: true, data: { saved: true } });
    assert.equal(await keys.posKeyOf("bodrum", db), BODRUM_KEY);
    assert.ok(!(await lastLog()).detail?.includes(BODRUM_KEY), "anahtar günlüğe yazılmaz");

    // Kasa ModPOS'a döner (AsilPOS kullanılmadı: onay sorulmaz); panelde eski anahtar kalır, yalnız silinir
    assert.equal((await branches.updateBranch({ id: "bodrum", posSource: "modpos" })).ok, true);
    const eski = await islem.subeIslemVerisi("bodrum", db);
    assert.deepEqual([eski?.asilpos, eski?.eskiAnahtar, eski?.gecis], [null, true, null]);
    assert.deepEqual(await branchSettings.saveAsilposSecret({ branchId: "bodrum", secret: null }, { password: PASSWORD }), { ok: true, data: { saved: false } });
    assert.equal((await islem.subeIslemVerisi("bodrum", db))?.eskiAnahtar, false);
  });

  test("öteki yönetici panelde eskisi gibi reddedilir; ladmin'in ad düzenlemesi kapalı şubeyi açmaz, kasa programını değiştirmez", async () => {
    await konsol();
    assert.equal((await branches.updateBranch({ id: "bodrum", active: false })).ok, true);

    // ladmin'in penceresi (changedGuardedFields): yalnız ad, açılış günü, oran ve e-posta
    await panel("ali");
    const ad = await branches.updateBranch({ id: "bodrum", name: "Bodrum Yalı", openedOn: "2026-11-01", posRate: 0.015, email: "" });
    assert.equal(ad.ok, true, JSON.stringify(ad));
    let row = await branchRow("bodrum");
    assert.deepEqual([row.name, row.active, row.posSource, row.kind, row.posRate], ["Bodrum Yalı", false, "modpos", "fiziksel", 0.015], "kapalı kaldı");
    // Asıl yöneticinin işleri öteki yöneticiye kapalı (panelde bugünkü gibi)
    assert.deepEqual(await branches.updateBranch({ id: "bodrum", active: true }), refused("subeKapatma"));
    assert.deepEqual(await branches.updateBranch({ id: "bodrum", posSource: "asilpos" }), refused("kasaProgrami"));
    assert.deepEqual(await branches.updateBranch({ id: "bodrum", kind: "online", posSource: "yok" }), refused("kasaProgrami"));
    assert.deepEqual(await branches.deleteBranch({ id: "bodrum" }), refused("subeSilme"));
    assert.deepEqual(await asilpos.saveAsilposSwitchDay({ branchId: "marina", day: null }), refused("gecisGunu"));
    assert.deepEqual(await branchSettings.saveAsilposSecret({ branchId: "marina", secret: "x".repeat(40) }, { password: PASSWORD }), refused("kasaAnahtari"));
    assert.equal(await dal.getYonetimUser(), null, "öteki yöneticinin konsol oturumu yok");
    row = await branchRow("bodrum");
    assert.deepEqual([row.active, row.posSource, row.kind], [false, "modpos", "fiziksel"], "reddedilenler yazılmadı");

    // Asıl yönetici ladmin'de adı değiştirir: konsolda kapatılan şube kapalı kalır
    await panel("ana");
    assert.equal((await branches.updateBranch({ id: "bodrum", name: "Bodrum", openedOn: "2026-11-01", posRate: 0.02, email: "" })).ok, true);
    row = await branchRow("bodrum");
    assert.deepEqual([row.name, row.active], ["Bodrum", false]);

    // Marina'nın adını öteki yönetici ladmin'de düzenler: kasa programı, durum, geçiş günü ve anahtar aynı
    await panel("ali");
    assert.equal((await branches.updateBranch({ id: "marina", name: "Marina", openedOn: null, posRate: 0.02, email: "" })).ok, true);
    const marina = await branchRow("marina");
    assert.deepEqual([marina.posSource, marina.active, marina.kind], ["asilpos", true, "fiziksel"]);
    assert.equal(await switchDayOf("marina"), marinaAtStart.switchDay);
    assert.equal(await keys.posKeyOf("marina", db), MARINA_KEY);
  });

  test("konsolun okuyucusu: Marina canlı, anahtar ortamda ve değeri dönmez; online kanalda kasa ve geçiş günü yok", async () => {
    const v = await islem.subeIslemVerisi("marina", db);
    assert.ok(v, "Marina okundu");
    assert.equal(v.canli, true, "son 7 günde gün sonu geldi");
    assert.equal(v.kasa?.durum, "kurulu");
    assert.deepEqual([v.asilpos?.legacy, v.asilpos?.source, v.asilpos?.problem, v.asilpos?.till], [true, "ortam", null, true]);
    assert.ok(v.gecis && v.gecis.linked && v.gecis.value === marinaAtStart.switchDay, JSON.stringify(v.gecis));
    assert.ok(!JSON.stringify(v).includes(MARINA_KEY), "anahtarın değeri ekrana gitmez");
    const kanal = await islem.subeIslemVerisi("online", db);
    assert.deepEqual([kanal?.kasa, kanal?.canli, kanal?.asilpos, kanal?.gecis, kanal?.silinemez], [null, false, null, null, "laffogato.net silinemez"]);
    assert.equal((await islem.subeIslemVerisi("bodrum", db))?.canli, false);
    assert.equal(await islem.subeIslemVerisi("yok-boyle", db), null);
  });

  test("Marina'nın anahtarı öteki senaryolardan sonra aynı; yalnız açık \"döndür\" işlemiyle değişir, silinince ortamdaki kalır", async () => {
    assert.equal(marinaAtStart.key, MARINA_KEY);
    assert.equal(await keys.posKeyOf("marina", db), marinaAtStart.key);
    const marina = await branchRow("marina");
    assert.deepEqual([marina.posSource, marina.active], ["asilpos", true]);
    assert.equal(await switchDayOf("marina"), marinaAtStart.switchDay);

    await konsol();
    assert.deepEqual(await branchSettings.saveAsilposSecret({ branchId: "marina", secret: MARINA_NEW_KEY }), { ok: false, error: STEP_UP_REQUIRED });
    assert.equal(await keys.posKeyOf("marina", db), MARINA_KEY, "onaysız değişmez");
    assert.deepEqual(await branchSettings.saveAsilposSecret({ branchId: "marina", secret: MARINA_NEW_KEY }, { password: PASSWORD }), { ok: true, data: { saved: true } });
    assert.equal(await keys.posKeyOf("marina", db), MARINA_NEW_KEY, "açık döndürme işlemiyle değişti");
    assert.deepEqual(await branchSettings.saveAsilposSecret({ branchId: "marina", secret: null }, { password: PASSWORD }), { ok: true, data: { saved: false } });
    assert.equal(await keys.posKeyOf("marina", db), MARINA_KEY, "paneldeki silinince ortamdaki kullanılır");
  });
});
