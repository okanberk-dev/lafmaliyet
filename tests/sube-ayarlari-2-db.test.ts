// Şube başına ayarların ikinci turu (docs/SUBE.md › Şube başına ayarlar), gerçek Postgres'te:
// - geçiş: satır yokken eski genel kayıtlar (settings › asilposGecisGunu, modposAyYedegi, acikGun; integration_state ›
//   komisyon.ayar) sahibi şubenin değeri, "aynı" sunulan grupta öbür şubeler Tuzla'yla aynı; okuma satır yazmaz;
// - AsilPOS geçiş günü AsilPOS'un şubesinin satırına yazılır; kasa kaynağı başka şubeye geçerse Marina'nın günü ona geçmez;
// - AsilPOS anahtarı şifreli saklanır, ortamdakinin önüne geçer, istemciye gitmez; kısa, sitenin anahtarı ya da başka şube
//   reddedilir; silinince ortamdaki;
// - komisyon ödeme süreleri, ModPOS ay yedeği ve çalışma takvimi "aynı"yla; ayırınca kopyalanır, sonra ayrı;
// - banka POS / yazarkasa şubenin kendisinin ("aynı" yok); AsilPOS cihaz göndermediyse fotoğraf okuması ondan;
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

import { GECIS_GUNU_AYARI } from "../src/lib/asilpos/eski-adlar";
import { CALENDAR_GROUP, COMMISSION_GROUP, ASILPOS_GROUP, MODPOS_GROUP, TILL_DEVICE_GROUP } from "../src/lib/branch-settings/groups";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { STEP_UP_REQUIRED, WRONG_PASSWORD } from "../src/lib/step-up";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_AYAR2_TEST_DATABASE_URL;
const DB_NAME = `lm_sube_a2_${process.pid}`;
const ENV_SECRET = "ortamdaki-asilpos-anahtari-en-az-otuz-iki-karakter";
const SITE_SECRET = "sitenin-anahtari-en-az-otuz-iki-karakterlik-metin";
const PANEL_SECRET = "panelde-saklanan-asilpos-anahtari-otuz-iki-karakter";
const PASSWORD = "yonetici-parolasi-1";

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
      ASILPOS_SYNC_SECRET: ENV_SECRET,
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
      // Şube kapatma, silme ve kasa anahtarı asıl yöneticinin (requireAnaAdmin); testin yöneticisi asıl yönetici sayılır
      requireAnaAdmin: async () => {
        if (me.role !== "admin") throw new Error("NEXT_REDIRECT yönetici değil");
        return { ...me, email: `${me.name}@test.local`, active: true };
      },
      requireUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
      getCurrentUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
    });
    const { hashPassword } = await import("../src/server/auth/password");
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    await db.insert(s.branches).values({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", active: true, sortOrder: 4 });
    await db.update(s.branches).set({ posSource: "asilpos" }).where(eq(s.branches.id, "marina"));
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `${k}@test.local`, name: users[k].name, passwordHash: await hashPassword(PASSWORD), role: users[k].role, branchId: users[k].branchId })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    // Bugünkü kurulumun eski genel kayıtları
    await db.insert(s.settings).values([
      // Geçiş gününün eski anahtarı (canlıdaki kayıt; ad değişikliğinden sonra da okunur)
      { key: GECIS_GUNU_AYARI, value: "2026-11-21" },
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
    const { posKeyOf } = await import("../src/server/asilpos/branch");
    const { switchDayOf } = await import("../src/server/pos/tills");
    const { loadModposFallback, modposFallbackBranches } = await import("../src/server/modpos/fallback");
    const { loadSettings } = await import("../src/server/data/dataset");
    assert.equal(await switchDayOf("marina", db), "2026-11-21", "geçiş günü Marina'nın (eski kayıt)");
    assert.equal(await posKeyOf("marina", db), ENV_SECRET, "anahtar ortamdan (yalnız Marina'nın)");
    assert.equal(await posKeyOf("tuzla", db), null, "ortamdaki anahtar öbür şubenin değil");
    assert.equal(await loadModposFallback(db, "tuzla"), true);
    assert.equal(await loadModposFallback(db, "bodrum"), true, "Bodrum Tuzla'yla aynı başlar");
    assert.deepEqual([...(await modposFallbackBranches(db))].sort(), ["bodrum", "marina", "tuzla"]);
    const marina = await resolveBranchSetting(COMMISSION_GROUP, "marina", db);
    assert.deepEqual(marina.mode, { kind: "linked", to: "tuzla", implicit: true });
    assert.equal(marina.value.channels.pluxee?.payDays, 45);
    assert.deepEqual((await resolveBranchSetting(CALENDAR_GROUP, "marina", db)).value, { openDays: 26, eveningHour: 20 });
    const st = await loadSettings();
    assert.equal(st.acikGun, 26);
    assert.equal(st.asilposGecisGunu, "2026-11-21");
    assert.deepEqual((await resolveBranchSetting(TILL_DEVICE_GROUP, "tuzla", db)).value, { device: null, registerNo: null, bank: null });
    assert.equal((await db.select().from(s.branchSettings)).length, 0, "okuma satır yazmaz");
  });

  test("AsilPOS geçiş günü kasanın kendi şubesine yazılır; kaynak başka şubeye geçerse Marina'nın günü ona geçmez", async () => {
    const { writeAsilposSwitchDay } = await import("../src/server/asilpos/admin");
    const { forgetPosBranches } = await import("../src/server/asilpos/branch");
    const { switchDayOf } = await import("../src/server/pos/tills");
    const change = await writeAsilposSwitchDay(db, users.ali, "marina", "2026-11-22", "2026-11-25");
    assert.match(change ?? "", /^AsilPOS.a geçiş günü: 21\sKasım\s2026 → 22\sKasım\s2026/, "tek kasada şube adı yazılmaz");
    assert.deepEqual((await rowOf(ASILPOS_GROUP.id, "marina"))?.value, { switchDay: "2026-11-22" });
    assert.equal((await db.select().from(s.settings).where(eq(s.settings.key, GECIS_GUNU_AYARI)))[0]?.value, "2026-11-21", "eski kayıt bırakılır");
    assert.equal(await switchDayOf("marina", db), "2026-11-22");
    assert.equal(await writeAsilposSwitchDay(db, users.ali, "marina", "2026-11-22", "2026-11-25"), null, "değişiklik yok");
    await assert.rejects(writeAsilposSwitchDay(db, users.ayse, "marina", null, "2026-11-25"), /yalnız yönetici/);
    // Kasa kaynağı Tuzla'ya geçer: Tuzla'nın kendi günü yok
    await db.update(s.branches).set({ posSource: "modpos" }).where(eq(s.branches.id, "marina"));
    await db.update(s.branches).set({ posSource: "asilpos" }).where(eq(s.branches.id, "tuzla"));
    forgetPosBranches();
    try {
      assert.equal(await switchDayOf("tuzla", db), null, "Marina'nın günü Tuzla'ya geçmez");
      assert.equal(await switchDayOf("marina", db), null, "kasası ModPOS olan şubenin günü sayılmaz");
      await assert.rejects(writeAsilposSwitchDay(db, users.ali, "marina", "2026-11-23", "2026-11-25"), /kasası AsilPOS değil/);
    } finally {
      await db.update(s.branches).set({ posSource: "modpos" }).where(eq(s.branches.id, "tuzla"));
      await db.update(s.branches).set({ posSource: "asilpos" }).where(eq(s.branches.id, "marina"));
      forgetPosBranches();
    }
    assert.equal(await switchDayOf("marina", db), "2026-11-22");
  });

  test("AsilPOS anahtarı şifreli, ortamdakinin önüne geçer, istemciye gitmez; ret kuralları; silinince ortamdaki", async () => {
    const actions = await import("../src/server/actions/branch-settings");
    const { posKeyOf, posKeyState } = await import("../src/server/asilpos/branch");
    const stateOf = async (id: string) => {
      const st = await posKeyState(id, db);
      return { problem: st.problem, source: st.source, envName: st.envName };
    };
    const { branchSettingView } = await import("../src/server/branch-settings-view");
    const no = async (input: Parameters<typeof actions.saveAsilposSecret>[0], re: RegExp) => {
      const r = await actions.saveAsilposSecret(input);
      assert.ok(!r.ok && re.test(r.error), r.ok ? "kabul edildi" : r.error);
    };
    await no({ branchId: "marina", secret: "kisa" }, /en az 32/);
    await no({ branchId: "marina", secret: SITE_SECRET }, /sitenin anahtarı/);
    await no({ branchId: "tuzla", secret: PANEL_SECRET }, /yalnız kasası AsilPOS olan/);
    await no({ branchId: "tuzla", secret: null }, /panelde saklanan AsilPOS anahtarı yok/);
    // Parolayla: onaysız ve yanlış parolayla yazılmaz
    assert.deepEqual(await actions.saveAsilposSecret({ branchId: "marina", secret: PANEL_SECRET }), { ok: false, error: STEP_UP_REQUIRED });
    assert.deepEqual(await actions.saveAsilposSecret({ branchId: "marina", secret: PANEL_SECRET }, { password: "yanlis" }), { ok: false, error: WRONG_PASSWORD });
    assert.equal(await rowOf(ASILPOS_GROUP.id, "marina").then((r) => r?.secrets ?? null), null, "parolasız yazılmadı");
    const r = await actions.saveAsilposSecret({ branchId: "marina", secret: PANEL_SECRET }, { password: PASSWORD });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(await posKeyOf("marina", db), PANEL_SECRET);
    assert.deepEqual(await stateOf("marina"), { problem: null, source: "panel", envName: "ASILPOS_SYNC_SECRET" });
    const row = await rowOf(ASILPOS_GROUP.id, "marina");
    assert.ok(row?.secrets && typeof (row.secrets as Record<string, unknown>).secret === "string", "şifreli alan");
    assert.ok(!JSON.stringify(row).includes(PANEL_SECRET), "anahtar açık metin olarak durmaz");
    assert.deepEqual(row?.value, { switchDay: "2026-11-22" }, "geçiş günü korunur");
    const view = await branchSettingView(ASILPOS_GROUP, "marina");
    assert.ok(!JSON.stringify(view).includes(PANEL_SECRET), "istemciye giden veride anahtar yok");
    assert.equal(view.secrets.secret, "saved");
    const log = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Şube ayarı"));
    assert.ok(log.some((l) => /AsilPOS anahtarı değiştirildi/.test(l.detail ?? "")) && !log.some((l) => (l.detail ?? "").includes(PANEL_SECRET)), "işlem geçmişinde anahtar yok");
    me = users.ayse;
    try {
      assert.equal((await actions.saveAsilposSecret({ branchId: "marina", secret: null }, { password: PASSWORD })).ok, false, "personel anahtarı değiştiremez");
    } finally {
      me = users.ali;
    }
    // Kasa kaynağı başka şubeye geçerse (çok şube): her şubenin anahtarı kendisinin; Marina'nınki Tuzla'ya geçmez, Tuzla
    // aynı anahtarı alamaz (anahtar şubeyi tanıtır); eski şubedeki anahtar silinebilir
    const { forgetPosBranches } = await import("../src/server/asilpos/branch");
    await db.update(s.branches).set({ posSource: "modpos" }).where(eq(s.branches.id, "marina"));
    await db.update(s.branches).set({ posSource: "asilpos" }).where(eq(s.branches.id, "tuzla"));
    forgetPosBranches();
    try {
      assert.equal(await posKeyOf("tuzla", db), null, "Tuzla'nın anahtarı yok; Marina'nınki ona geçmez");
      assert.equal(await posKeyOf("marina", db), PANEL_SECRET, "Marina'nın anahtarı kendisinin");
      await no({ branchId: "tuzla", secret: PANEL_SECRET }, /Marina şubesinin AsilPOS anahtarı/);
      await no({ branchId: "tuzla", secret: ENV_SECRET }, /Marina şubesinin AsilPOS anahtarı/);
      assert.ok((await actions.saveAsilposSecret({ branchId: "marina", secret: null }, { password: PASSWORD })).ok, "eski şubedeki anahtar silinir");
      assert.equal((await branchSettingView(ASILPOS_GROUP, "marina")).secrets.secret, "none");
    } finally {
      await db.update(s.branches).set({ posSource: "modpos" }).where(eq(s.branches.id, "tuzla"));
      await db.update(s.branches).set({ posSource: "asilpos" }).where(eq(s.branches.id, "marina"));
      forgetPosBranches();
    }
    assert.equal(await posKeyOf("marina", db), ENV_SECRET, "silinince ortamdaki");
    assert.deepEqual(await stateOf("marina"), { problem: null, source: "ortam", envName: "ASILPOS_SYNC_SECRET" });
  });

  test("döndürülen AsilPOS anahtarı başka sunucu örneğinin önbelleğinde de hemen geçmez; yenisi en geç 10 sn'de geçer", async () => {
    const branch = await import("../src/server/asilpos/branch");
    const { putBranchSetting } = await import("../src/server/branch-settings");
    const { signedHeaders, SIGNATURE_HEADER, TIMESTAMP_HEADER } = await import("../src/lib/karaoke/signature");
    const OLD = "eski-asilpos-anahtari-en-az-otuz-iki-karakterlik-metin";
    const NEW = "yeni-asilpos-anahtari-en-az-otuz-iki-karakterlik-metin";
    // Başka bir sunucu örneğinin yazması: bu örneğin önbelleği düşmez (forgetPosKeys çağrılmaz)
    const store = (secret: string | null) => db.transaction((tx) => putBranchSetting(tx, ASILPOS_GROUP, "marina", { secret }, "Başka örnek"));
    const url = new URL("https://ladmin.laffogato.net/api/panel/pos/urunler");
    const t0 = Date.now();
    const req = (secret: string, now: number) => {
      const h = signedHeaders(secret, "GET", url, "", now);
      return { method: "GET", url, body: "", timestamp: h[TIMESTAMP_HEADER], signature: h[SIGNATURE_HEADER] };
    };
    const reads: string[] = [];
    const counted = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "select") reads.push("select");
        return Reflect.get(target, prop, receiver);
      },
    });
    try {
      await store(OLD);
      branch.forgetPosKeys();
      assert.deepEqual(await branch.resolvePosCaller(req(OLD, t0), counted, process.env, t0), { branchId: "marina", secret: OLD }, "önbellek eski anahtarla doldu");

      // İmzasız ya da yanlış imzalı istek veritabanını okutmaz (önbellek ön süzgeç)
      reads.length = 0;
      assert.deepEqual(await branch.resolvePosCaller({ method: "GET", url, body: "", timestamp: null, signature: null }, counted, process.env, t0 + 1_000), { branchId: null, secret: OLD });
      assert.deepEqual(await branch.resolvePosCaller(req("baska-bir-anahtar-en-az-otuz-iki-karakterlik", t0 + 1_000), counted, process.env, t0 + 1_000), { branchId: null, secret: OLD });
      assert.deepEqual(reads, [], "imzası tutmayan istekte okuma yok");

      // Anahtar başka örnekte döndürüldü: eski anahtarla imzalı istek artık şubeye bağlanmaz (uç 401 verir)
      await store(NEW);
      const old = req(OLD, t0 + 2_000);
      const got = await branch.resolvePosCaller(old, counted, process.env, t0 + 2_000);
      assert.deepEqual(got, { branchId: null, secret: NEW }, "imza tutunca anahtarlar veritabanından yeniden okundu");
      const { checkAsilposRequest } = await import("../src/lib/asilpos/request");
      assert.deepEqual(checkAsilposRequest({ ...old, secret: got.secret, method: "GET", maxBytes: 0, now: t0 + 2_000 }), { ok: false, status: 401, error: "unauthorized" });

      // Yeni anahtarla imzalı istek: imza tutar, şube Marina
      assert.deepEqual(await branch.resolvePosCaller(req(NEW, t0 + 3_000), counted, process.env, t0 + 3_000), { branchId: "marina", secret: NEW });

      // Ters yön: yeni anahtar başka örnekte kaydedildi, bu örneğin önbelleği eski. Yeni anahtarla gelen istek ilk
      // POS_KEYS_RELOAD_MS içinde şubeye bağlanmaz (401), sonra bir kez yeniden okunur ve geçer
      await store(OLD);
      branch.forgetPosKeys();
      await branch.resolvePosCaller(req(OLD, t0), counted, process.env, t0);
      await store(NEW);
      assert.deepEqual(await branch.resolvePosCaller(req(NEW, t0 + 1_000), counted, process.env, t0 + 1_000), { branchId: null, secret: OLD });
      const later = t0 + branch.POS_KEYS_RELOAD_MS;
      assert.deepEqual(await branch.resolvePosCaller(req(NEW, later), counted, process.env, later), { branchId: "marina", secret: NEW }, "en geç 10 sn sonra yeni anahtar");

      // Panelden silinince ortamdaki (Marina'nın): eski panel anahtarıyla imzalı istek geçmez
      await store(null);
      assert.deepEqual(await branch.resolvePosCaller(req(NEW, later + 1), counted, process.env, later + 1), { branchId: null, secret: ENV_SECRET });
    } finally {
      await store(null);
      branch.forgetPosKeys();
    }
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
    // Hakediş işletmenin: ekran (seçici ne olursa olsun) ile zil, Bugün ve e-posta (hep "Tümü") aynı süreyle, şubelerin en kısasıyla
    const { loadCommissionInput } = await import("../src/server/data/commission");
    const { withBranchScope } = await import("../src/server/branch-scope");
    const termsIn = async (scope: string) => (await withBranchScope(scope, () => loadCommissionInput({ resolveNames: false, today: "2026-11-25" }))).settings.pluxee?.payDays;
    assert.deepEqual([await termsIn("hepsi"), await termsIn("marina"), await termsIn("tuzla")], [20, 20, 20], "Tuzla 20, Marina 25: en kısası");
    assert.ok((await commission.saveCommissionSettings({ branchId: "marina", channels: { pluxee: { payDays: 15 } } })).ok);
    assert.deepEqual([await termsIn("hepsi"), await termsIn("marina"), await termsIn("tuzla")], [15, 15, 15], "Marina'nın kısa süresi zili de öne alır");
    assert.ok((await commission.saveCommissionSettings({ branchId: "marina", channels: { pluxee: { payDays: 25 } } })).ok);
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

  test("kapalı şubenin sayfası: tek kasa açıkken de örtük 'aynı' anahtarı çizilir (form reddedilen kayda düşmez)", async () => {
    const { branchSettingView } = await import("../src/server/branch-settings-view");
    await db.update(s.branches).set({ active: false }).where(eq(s.branches.id, "bodrum"));
    await db.update(s.branches).set({ active: false }).where(eq(s.branches.id, "marina"));
    try {
      const view = await branchSettingView(CALENDAR_GROUP, "marina");
      assert.equal(view.branchName, null, "tek kasa: başlıkta şube adı yok");
      assert.ok(view.link && view.link.mode.kind === "linked", "bağlı: anahtar çizilir, ayrılabilir");
      assert.equal((await branchSettingView(CALENDAR_GROUP, "tuzla")).link, null, "tek kasa ve kendi ayarı: anahtar yok");
    } finally {
      await db.update(s.branches).set({ active: true }).where(eq(s.branches.id, "marina"));
      await db.update(s.branches).set({ active: true }).where(eq(s.branches.id, "bodrum"));
    }
  });

  test("banka POS ve yazarkasa şubenin kendisinin; AsilPOS cihaz göndermediyse fotoğraf okuması ondan", async () => {
    const actions = await import("../src/server/actions/branch-settings");
    const { asilposOkcDeviceOf } = await import("../src/server/asilpos/foto");
    const r = await actions.saveTillDevice({ branchId: "marina", device: "tokenx", registerNo: " AB 123 ", bank: "" });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.deepEqual(r.data, { device: "tokenx", registerNo: "AB 123", bank: null });
    assert.deepEqual(await asilposOkcDeviceOf(db, "marina"), { provider: "tokenx", zReport: true });
    assert.equal(await asilposOkcDeviceOf(db, "tuzla"), null, "Tuzla'da cihaz belirtilmedi");
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
