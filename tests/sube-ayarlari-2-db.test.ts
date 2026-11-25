// Şube başına ayarların ikinci turu (docs/SUBE.md › Şube başına ayarlar), gerçek Postgres'te:
// - geçiş: satır yokken eski genel kayıtlar (settings › lafposGecisGunu, modposAyYedegi, acikGun; integration_state ›
//   komisyon.ayar) sahibi şubenin değeri, "aynı" sunulan grupta öbür şubeler Tuzla'yla aynı; okuma satır yazmaz;
// - LafPOS geçiş günü LafPOS'un şubesinin satırına yazılır; kasa kaynağı başka şubeye geçerse Marina'nın günü ona geçmez;
// - LafPOS anahtarı şifreli saklanır, ortamdakinin önüne geçer, istemciye gitmez; kısa, sitenin anahtarı ya da başka şube
//   reddedilir; silinince ortamdaki;
// - komisyon ödeme süreleri, ModPOS ay yedeği ve çalışma takvimi "aynı"yla; ayırınca kopyalanır, sonra ayrı;
// - banka POS / yazarkasa şubenin kendisinin ("aynı" yok); LafPOS cihaz göndermediyse fotoğraf okuması ondan;
// - yalnız yönetici.
//
// SUBE_AYAR2_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/postgres). Test o sunucuda
// kendi geçici veritabanını (lm_sube_a2_<pid>) açar, sonunda siler.
// Çalıştırma: SUBE_AYAR2_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sube-ayarlari-2-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { CALENDAR_GROUP, COMMISSION_GROUP, LAFPOS_GROUP, MODPOS_GROUP, TILL_DEVICE_GROUP } from "../src/lib/branch-settings/groups";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_AYAR2_TEST_DATABASE_URL;
const DB_NAME = `lm_sube_a2_${process.pid}`;
const ENV_SECRET = "ortamdaki-lafpos-anahtari-en-az-otuz-iki-karakter";
const SITE_SECRET = "sitenin-anahtari-en-az-otuz-iki-karakterlik-metin";
const PANEL_SECRET = "panelde-saklanan-lafpos-anahtari-otuz-iki-karakter";

type Who = { id: number; name: string; role: "admin" | "staff"; branchId: string | null };

describe("şube ayarları 2. tur: veritabanında", { skip: !SERVER_URL && "SUBE_AYAR2_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  const users: Record<"ali" | "ayse", Who> = {
    ali: { id: 0, name: "Ali", role: "admin", branchId: null },
    ayse: { id: 0, name: "Ayşe", role: "staff", branchId: "marina" },
  };
  let me: Who = users.ali;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      AUTH_SECRET: "sube-ayarlari-2-testi-icin-en-az-otuz-iki-karakterlik-anahtar",
      LAFPOS_SYNC_SECRET: ENV_SECRET,
      KARAOKE_SYNC_SECRET: SITE_SECRET,
    });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    stub(require.resolve("../src/server/auth/dal"), {
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("NEXT_REDIRECT yönetici değil");
        return { ...me, email: `${me.name}@test.local`, active: true };
      },
      requireUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
      getCurrentUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    await db.insert(s.branches).values({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", active: true, sortOrder: 4 });
    await db.update(s.branches).set({ posSource: "lafpos" }).where(eq(s.branches.id, "marina"));
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `${k}@test.local`, name: users[k].name, passwordHash: "x", role: users[k].role, branchId: users[k].branchId })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    // Bugünkü kurulumun eski genel kayıtları
    await db.insert(s.settings).values([
      { key: "lafposGecisGunu", value: "2026-11-21" },
      { key: "modposAyYedegi", value: true },
      { key: "acikGun", value: 26 },
    ]);
    await db.insert(s.integrationState).values({ key: "komisyon.ayar", value: { channels: { pluxee: { payDays: 45 } } } });
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const rowOf = async (grp: string, branchId: string) =>
    (await db.select().from(s.branchSettings).where(and(eq(s.branchSettings.grp, grp), eq(s.branchSettings.branchId, branchId))))[0] ?? null;

  test("geçiş: hiçbir şey yapmadan bugünkü değerler; öbür şubeler Tuzla'yla aynı; okuma satır yazmaz", async () => {
    const { resolveBranchSetting } = await import("../src/server/branch-settings");
    const { lafposSwitchDay, lafposSecret } = await import("../src/server/lafpos/branch");
    const { loadModposFallback, modposFallbackBranches } = await import("../src/server/modpos/fallback");
    const { loadSettings } = await import("../src/server/data/dataset");
    assert.equal(await lafposSwitchDay(db), "2026-11-21", "geçiş günü Marina'nın (eski kayıt)");
    assert.equal(await lafposSecret(db), ENV_SECRET, "anahtar ortamdan");
    assert.equal(await loadModposFallback(db, "tuzla"), true);
    assert.equal(await loadModposFallback(db, "bodrum"), true, "Bodrum Tuzla'yla aynı başlar");
    assert.deepEqual([...(await modposFallbackBranches(db))].sort(), ["bodrum", "marina", "tuzla"]);
    const marina = await resolveBranchSetting(COMMISSION_GROUP, "marina", db);
    assert.deepEqual(marina.mode, { kind: "linked", to: "tuzla", implicit: true });
    assert.equal(marina.value.channels.pluxee?.payDays, 45);
    assert.deepEqual((await resolveBranchSetting(CALENDAR_GROUP, "marina", db)).value, { openDays: 26, eveningHour: 20 });
    const st = await loadSettings();
    assert.equal(st.acikGun, 26);
    assert.equal(st.lafposGecisGunu, "2026-11-21");
    assert.deepEqual((await resolveBranchSetting(TILL_DEVICE_GROUP, "tuzla", db)).value, { device: null, registerNo: null, bank: null });
    assert.equal((await db.select().from(s.branchSettings)).length, 0, "okuma satır yazmaz");
  });

  test("LafPOS geçiş günü LafPOS'un şubesine yazılır; kaynak başka şubeye geçerse Marina'nın günü ona geçmez", async () => {
    const { writeLafposSwitchDay } = await import("../src/server/lafpos/admin");
    const { forgetLafposBranch, lafposSwitchDay } = await import("../src/server/lafpos/branch");
    const change = await writeLafposSwitchDay(db, users.ali, "2026-11-22", "2026-11-25");
    assert.match(change ?? "", /21\sKasım\s2026 → 22\sKasım\s2026/);
    assert.deepEqual((await rowOf(LAFPOS_GROUP.id, "marina"))?.value, { switchDay: "2026-11-22" });
    assert.equal((await db.select().from(s.settings).where(eq(s.settings.key, "lafposGecisGunu")))[0]?.value, "2026-11-21", "eski kayıt bırakılır");
    assert.equal(await lafposSwitchDay(db), "2026-11-22");
    assert.equal(await writeLafposSwitchDay(db, users.ali, "2026-11-22", "2026-11-25"), null, "değişiklik yok");
    await assert.rejects(writeLafposSwitchDay(db, users.ayse, null, "2026-11-25"), /yalnız yönetici/);
    // Kasa kaynağı Tuzla'ya geçer: Tuzla'nın kendi günü yok
    await db.update(s.branches).set({ posSource: "modpos" }).where(eq(s.branches.id, "marina"));
    await db.update(s.branches).set({ posSource: "lafpos" }).where(eq(s.branches.id, "tuzla"));
    forgetLafposBranch();
    try {
      assert.equal(await lafposSwitchDay(db), null, "Marina'nın günü Tuzla'ya geçmez");
    } finally {
      await db.update(s.branches).set({ posSource: "modpos" }).where(eq(s.branches.id, "tuzla"));
      await db.update(s.branches).set({ posSource: "lafpos" }).where(eq(s.branches.id, "marina"));
      forgetLafposBranch();
    }
    assert.equal(await lafposSwitchDay(db), "2026-11-22");
  });

  test("LafPOS anahtarı şifreli, ortamdakinin önüne geçer, istemciye gitmez; ret kuralları; silinince ortamdaki", async () => {
    const actions = await import("../src/server/actions/branch-settings");
    const { lafposSecret, lafposSecretState } = await import("../src/server/lafpos/branch");
    const { branchSettingView } = await import("../src/server/branch-settings-view");
    const no = async (input: Parameters<typeof actions.saveLafposSecret>[0], re: RegExp) => {
      const r = await actions.saveLafposSecret(input);
      assert.ok(!r.ok && re.test(r.error), r.ok ? "kabul edildi" : r.error);
    };
    await no({ branchId: "marina", secret: "kisa" }, /en az 32/);
    await no({ branchId: "marina", secret: SITE_SECRET }, /sitenin anahtarı/);
    await no({ branchId: "tuzla", secret: PANEL_SECRET }, /yalnız kasası LafPOS olan şubede/);
    const r = await actions.saveLafposSecret({ branchId: "marina", secret: PANEL_SECRET });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(await lafposSecret(db), PANEL_SECRET);
    assert.deepEqual(await lafposSecretState(db), { problem: null, source: "panel" });
    const row = await rowOf(LAFPOS_GROUP.id, "marina");
    assert.ok(row?.secrets && typeof (row.secrets as Record<string, unknown>).secret === "string", "şifreli alan");
    assert.ok(!JSON.stringify(row).includes(PANEL_SECRET), "anahtar açık metin olarak durmaz");
    assert.deepEqual(row?.value, { switchDay: "2026-11-22" }, "geçiş günü korunur");
    const view = await branchSettingView(LAFPOS_GROUP, "marina");
    assert.ok(!JSON.stringify(view).includes(PANEL_SECRET), "istemciye giden veride anahtar yok");
    assert.equal(view.secrets.secret, "saved");
    const log = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Şube ayarı"));
    assert.ok(log.some((l) => /LafPOS anahtarı değiştirildi/.test(l.detail ?? "")) && !log.some((l) => (l.detail ?? "").includes(PANEL_SECRET)), "işlem geçmişinde anahtar yok");
    me = users.ayse;
    try {
      assert.equal((await actions.saveLafposSecret({ branchId: "marina", secret: null })).ok, false, "personel anahtarı değiştiremez");
    } finally {
      me = users.ali;
    }
    assert.ok((await actions.saveLafposSecret({ branchId: "marina", secret: null })).ok);
    assert.equal(await lafposSecret(db), ENV_SECRET, "silinince ortamdaki");
    assert.deepEqual(await lafposSecretState(db), { problem: null, source: "ortam" });
  });

  test("komisyon: Tuzla'nın süresi 'aynı' Marina'da; bağlı şubeye yazılmaz; ayırınca kopyalanır, sonra ayrı", async () => {
    const commission = await import("../src/server/actions/commission");
    const link = await import("../src/server/actions/branch-settings");
    const { resolveBranchSetting } = await import("../src/server/branch-settings");
    const r = await commission.saveCommissionSettings({ branchId: "tuzla", channels: { pluxee: { payDays: 20 } } });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal((await resolveBranchSetting(COMMISSION_GROUP, "marina", db)).value.channels.pluxee?.payDays, 20);
    const linked = await commission.saveCommissionSettings({ branchId: "marina", channels: { pluxee: { payDays: 25 } } });
    assert.ok(!linked.ok && /önce “Tuzla ile aynı”yı kapatın/.test(linked.error), linked.ok ? "" : linked.error);
    assert.ok((await link.setBranchSettingLink({ branchId: "marina", group: "komisyon", sameAs: null })).ok);
    assert.equal((await resolveBranchSetting(COMMISSION_GROUP, "marina", db)).value.channels.pluxee?.payDays, 20, "kopyalandı");
    assert.ok((await commission.saveCommissionSettings({ branchId: "marina", channels: { pluxee: { payDays: 25 } } })).ok);
    assert.equal((await resolveBranchSetting(COMMISSION_GROUP, "marina", db)).value.channels.pluxee?.payDays, 25);
    assert.equal((await resolveBranchSetting(COMMISSION_GROUP, "tuzla", db)).value.channels.pluxee?.payDays, 20, "Tuzla değişmez");
    const meal = await commission.saveCommissionSettings({ branchId: "marina", channels: { pluxee: { payDays: 40 } } });
    assert.ok(!meal.ok && /yönetmelik/.test(meal.error), "yemek kartında en çok 30 gün");
    me = users.ayse;
    try {
      assert.equal((await commission.saveCommissionSettings({ branchId: "marina", channels: { pluxee: { payDays: 10 } } })).ok, false, "personel değiştiremez");
    } finally {
      me = users.ali;
    }
  });

  test("ModPOS ay yedeği şube başına: Tuzla kapatınca 'aynı' Bodrum da kapanır; ayrılan Marina kendi değeriyle", async () => {
    const { writeModposFallback } = await import("../src/server/modpos/admin");
    const { loadModposFallback, modposFallbackBranches } = await import("../src/server/modpos/fallback");
    const link = await import("../src/server/actions/branch-settings");
    assert.ok((await link.setBranchSettingLink({ branchId: "marina", group: "modpos", sameAs: null })).ok, "Marina ayrılır (açık kopyalanır)");
    assert.match((await writeModposFallback(db, users.ali, false, "tuzla")) ?? "", /açık → kapalı/);
    assert.equal(await loadModposFallback(db, "bodrum"), false);
    assert.equal(await loadModposFallback(db, "marina"), true);
    assert.deepEqual([...(await modposFallbackBranches(db))], ["marina"]);
    await assert.rejects(writeModposFallback(db, users.ali, true, "bodrum"), /Tuzla ile aynı/);
    await assert.rejects(writeModposFallback(db, users.ayse, true, "tuzla"), /yalnız yönetici/);
    assert.equal(await writeModposFallback(db, users.ali, false, "tuzla"), null, "değişiklik yok");
  });

  test("çalışma takvimi: açık gün ve kasa raporu saati; 'aynı' Marina'da ve veri kümesinin varsayılanında", async () => {
    const actions = await import("../src/server/actions/branch-settings");
    const { resolveBranchSetting } = await import("../src/server/branch-settings");
    const { loadSettings } = await import("../src/server/data/dataset");
    const r = await actions.saveBranchCalendar({ branchId: "tuzla", openDays: 28, eveningHour: 21 });
    assert.ok(r.ok && r.data.changed === 2, r.ok ? "" : r.error);
    assert.deepEqual((await resolveBranchSetting(CALENDAR_GROUP, "marina", db)).value, { openDays: 28, eveningHour: 21 });
    assert.equal((await loadSettings()).acikGun, 28);
    const bad = await actions.saveBranchCalendar({ branchId: "tuzla", openDays: 28, eveningHour: 5 });
    assert.ok(!bad.ok && /En erken 12:00/.test(bad.error), bad.ok ? "" : bad.error);
    const linked = await actions.saveBranchCalendar({ branchId: "marina", openDays: 30, eveningHour: 22 });
    assert.ok(!linked.ok, "bağlı şubeye yazılmaz");
    const same = await actions.saveBranchCalendar({ branchId: "tuzla", openDays: 28, eveningHour: 21 });
    assert.ok(same.ok && same.data.changed === 0, "değişiklik yoksa yazılmaz");
    const log = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Şube ayarı"));
    assert.ok(log.some((l) => /Tuzla · Çalışma takvimi: ayda açık gün 26 → 28, kasa raporu saati 20:00 → 21:00/.test(l.detail ?? "")));
  });

  test("banka POS ve yazarkasa şubenin kendisinin; LafPOS cihaz göndermediyse fotoğraf okuması ondan", async () => {
    const actions = await import("../src/server/actions/branch-settings");
    const { lafposOkcDeviceOf } = await import("../src/server/lafpos/foto");
    const r = await actions.saveTillDevice({ branchId: "marina", device: "tokenx", registerNo: " AB 123 ", bank: "" });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.deepEqual(r.data, { device: "tokenx", registerNo: "AB 123", bank: null });
    assert.deepEqual(await lafposOkcDeviceOf(db, "marina"), { provider: "tokenx", zReport: true });
    assert.equal(await lafposOkcDeviceOf(db, "tuzla"), null, "Tuzla'da cihaz belirtilmedi");
    const sameAs = await actions.setBranchSettingLink({ branchId: "marina", group: "kasa.cihaz", sameAs: "tuzla" });
    assert.ok(!sameAs.ok && /şube başına tutulur/.test(sameAs.error), "cihazda 'aynı' yok");
    me = users.ayse;
    try {
      assert.equal((await actions.saveTillDevice({ branchId: "marina", device: "pavo", registerNo: null, bank: null })).ok, false, "personel değiştiremez");
      assert.equal((await actions.saveBranchCalendar({ branchId: "tuzla", openDays: 20, eveningHour: 20 })).ok, false, "personel değiştiremez");
    } finally {
      me = users.ali;
    }
    assert.deepEqual((await rowOf(TILL_DEVICE_GROUP.id, "marina"))?.value, { device: "tokenx", registerNo: "AB 123", bank: null });
    assert.equal(await rowOf(MODPOS_GROUP.id, "bodrum"), null, "Bodrum'un ModPOS satırı yok (örtük aynı)");
  });
});
