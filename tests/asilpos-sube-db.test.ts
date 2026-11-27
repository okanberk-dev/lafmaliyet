// Çok şubeli AsilPOS kasaları (sahibin kararı, 27 Kasım 2026; docs/ASILPOS.md › Şubeler), gerçek Postgres'te:
// - göç 0099 idempotent: eski genel geçiş günü Marina'nın satırına, Marina'nın kasa kaynağı AsilPOS'a; iki kez
//   çalışınca aynı sonuç, var olan satır kazanır, geçiş günü olmayan Marina ModPOS'ta kalır;
// - her anahtar kendi şubesini bulur; şube göndermeyen eski kasanın günü anahtarın şubesine yazılır; başka şube bildiren
//   kasa 409 eski gövdeyle ({ error: "wrong_branch", sube, expected });
// - kasası ModPOS olan şubenin deneme günü hiçbir hesaba girmez;
// - iki kasa farklı geçiş günleriyle: "Tümü"de satışlar, kasa satırları, komisyon ve ikram her kasanın kendi gününden,
//   çift sayım yok;
// - kurulum kodu şubenin kendi anahtarını verir, başka şubeninkini hiçbir zaman.
//
// ASILPOS_SUBE_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/postgres). Test o
// sunucuda kendi geçici veritabanını (lm_asilpos_sube_<pid>) açar, sonunda siler.
// Çalıştırma: ASILPOS_SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/asilpos-sube-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ASILPOS_GROUP } from "../src/lib/branch-settings/groups";
import { ALL_BRANCHES, DEFAULT_BRANCHES } from "../src/lib/branches";
import { signedHeaders, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../src/lib/karaoke/signature";
import { DURUM_ANAHTARI, ESKI_KASA_KAYNAGI, GECIS_GUNU_AYARI, SUBE_AYAR_GRUBU } from "../src/lib/asilpos/eski-adlar";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.ASILPOS_SUBE_TEST_DATABASE_URL;
const DB_NAME = `lm_asilpos_sube_${process.pid}`;
const SECRET = "asilpos-sube-testi-0123456789-abcdefghij";
const KEY_M = "marina-kasasi-anahtari-0123456789-abcdefghij";
const KEY_T = "tuzla-kasasi-anahtari-0123456789-abcdefghijkl";
const GUN = new URL("https://ladmin.laffogato.net/api/pos/gun");
const NOW = new Date("2029-06-20T12:00:00+03:00");
const SWITCH = "2029-06-01";
const T_SWITCH = "2029-06-15";
const D = "2029-06-10";
const D2 = "2029-06-16";

describe("Çok şubeli AsilPOS: veritabanında", { skip: !SERVER_URL && "ASILPOS_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let me = { id: 0, name: "Ali", role: "admin" as "admin" | "staff", branchId: null as string | null };
  let branch: typeof import("../src/server/asilpos/branch");
  let tills: typeof import("../src/server/pos/tills");

  const body = (date: string, o: { sube?: string; total?: number; zNo?: number } = {}) => ({
    version: 1,
    source: "asilpos",
    date,
    ...(o.sube ? { sube: o.sube } : {}),
    z: {
      zNo: o.zNo ?? 41,
      receipts: 12,
      zTotal: o.total ?? 2400,
      cash: (o.total ?? 2400) - 1500,
      card: 1000,
      mealCard: 500,
      online: 0,
      other: 0,
      offRevenue: 0,
      discounts: 0,
      openingCash: 500,
      cashOut: 0,
      countedCash: 1400,
      handedOver: 0,
      cashDiff: 0,
    },
    lines: [{ posName: "LATTE", siteMenuId: null, slot: null, qty: 2, revenue: o.total ?? 2400, isService: false }],
    ikram: [{ posName: "LATTE", siteMenuId: null, slot: null, qty: 1, menuValue: 200, reason: "Müşteri" }],
    payments: [{ name: "Multinet", zField: "meal_card", channel: "multinet", count: 2, amount: 500 }],
  });
  /** Gün sonu ucunun yolu: anahtar şubeyi bulur (resolvePosCaller), sonra handlePosDay */
  const push = async (key: string, b: unknown) => {
    const raw = JSON.stringify(b);
    const h = signedHeaders(key, "POST", GUN, raw, NOW.getTime());
    const req = { method: "POST", url: GUN, body: raw, timestamp: h[TIMESTAMP_HEADER], signature: h[SIGNATURE_HEADER] };
    const caller = await branch.resolvePosCaller(req, db, process.env, NOW.getTime());
    const { handlePosDay } = await import("../src/server/asilpos/status");
    return handlePosDay(db, { ...caller, url: GUN, body: raw, timestamp: req.timestamp, signature: req.signature }, NOW);
  };
  const setSource = (id: string, posSource: "modpos" | "asilpos") => db.update(s.branches).set({ posSource }).where(eq(s.branches.id, id));
  const storeKey = (id: string, secret: string | null) => db.transaction(async (tx) => (await import("../src/server/branch-settings")).putBranchSetting(tx, ASILPOS_GROUP, id, { secret }, "test"));
  const storeSwitch = (id: string, switchDay: string | null) => db.transaction(async (tx) => (await import("../src/server/branch-settings")).putBranchSetting(tx, ASILPOS_GROUP, id, { switchDay }, "test"));
  const all = <T>(fn: () => Promise<T>) => import("../src/server/branch-scope").then((m) => m.withBranchScope(ALL_BRANCHES, fn));

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "asilpos-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    stub(require.resolve("../src/server/auth/dal"), {
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("NEXT_REDIRECT yönetici değil");
        return { ...me, email: `${me.name}@test.local`, active: true };
      },
      // Şube ekleme ana yöneticinin (requireAnaAdmin, docs/ASILPOS.md › Şube kurulumu); testin yöneticisi ana yönetici sayılır
      requireAnaAdmin: async () => {
        if (me.role !== "admin") throw new Error("NEXT_REDIRECT yönetici değil");
        return { ...me, email: `${me.name}@test.local`, active: true };
      },
      requireUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
      getCurrentUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    // Tohum: Marina AsilPOS'ta (DEFAULT_BRANCHES), Tuzla ModPOS'ta; Marina'nın geçiş günü eski genel kayıtta
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    await db.insert(s.settings).values({ key: GECIS_GUNU_AYARI, value: SWITCH }).onConflictDoNothing();
    const [u] = await db.insert(s.users).values({ email: "ali@test.local", name: "Ali", passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    me = { ...me, id: u.id };
    branch = await import("../src/server/asilpos/branch");
    tills = await import("../src/server/pos/tills");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM pos_daily_sales`);
    await db.execute(sql`DELETE FROM pos_day_revisions`);
    await db.execute(sql`DELETE FROM pos_day_reports`);
    await db.execute(sql`DELETE FROM integration_state`);
    await setSource("marina", "asilpos");
    await setSource("tuzla", "modpos");
    await storeKey("marina", KEY_M);
    await storeKey("tuzla", null);
    await storeSwitch("tuzla", null);
    branch.forgetPosBranches();
  });

  test("göç 0099 idempotent: geçiş günü Marina'nın satırına, kasa kaynağı AsilPOS'a; durum genel satırda kalır", async () => {
    const sqlText = readFileSync(join(process.cwd(), "drizzle/0099_pos_cok_sube.sql"), "utf8");
    const run = async () => {
      for (const st of sqlText.split("--> statement-breakpoint")) if (st.trim()) await db.execute(sql.raw(st));
    };
    // Göç öncesi: Marina'nın kaynağı ModPOS, satırı yok, eski genel kayıt ve genel durum satırı var
    await db.execute(sql`DELETE FROM branch_settings WHERE branch_id = 'marina' AND grp = ${SUBE_AYAR_GRUBU}`);
    await db.execute(sql`UPDATE branches SET pos_source = 'modpos' WHERE id = 'marina'`);
    await db.insert(s.integrationState).values({ key: DURUM_ANAHTARI, value: { lastOk: { at: NOW.toISOString(), date: D, zNo: 1, lines: 1, counted: true } } });
    const snapshot = async () => ({
      setting: (await db.select({ value: s.branchSettings.value }).from(s.branchSettings).where(and(eq(s.branchSettings.branchId, "marina"), eq(s.branchSettings.grp, SUBE_AYAR_GRUBU))))[0]?.value ?? null,
      source: (await db.execute<{ pos_source: string }>(sql`SELECT pos_source FROM branches WHERE id = 'marina'`))[0]?.pos_source,
      tuzla: (await db.execute<{ pos_source: string }>(sql`SELECT pos_source FROM branches WHERE id = 'tuzla'`))[0]?.pos_source,
      states: (await db.select({ key: s.integrationState.key }).from(s.integrationState)).map((r) => r.key).sort(),
    });
    await run();
    const once = await snapshot();
    assert.deepEqual(once.setting, { switchDay: SWITCH });
    assert.equal(once.source, ESKI_KASA_KAYNAGI, "eski adla yazılır");
    assert.equal(once.tuzla, "modpos", "Tuzla değişmez");
    assert.deepEqual(once.states, [DURUM_ANAHTARI], "Marina'nın durumu genel satırda (eski sürüm ve geri dönüş okur)");
    const status = await import("../src/server/asilpos/status");
    assert.equal((await status.readAsilposState(db, "marina")).lastOk?.date, D);
    await run();
    assert.deepEqual(await snapshot(), once, "ikinci çalışma hiçbir şeyi değiştirmez");
    branch.forgetPosBranches();
    assert.equal(await tills.switchDayOf("marina", db), SWITCH);
    // Var olan satır kazanır: açıkça boşaltılmış gün eski kayıtla dolmaz; geçiş günü olmayan Marina ModPOS'ta kalır
    await storeSwitch("marina", null);
    await db.execute(sql`UPDATE branches SET pos_source = 'modpos' WHERE id = 'marina'`);
    await run();
    assert.deepEqual((await snapshot()).setting, { switchDay: null });
    assert.equal((await snapshot()).source, "modpos", "geçiş günü yokken föyün çekimi kesilmez");
    await storeSwitch("marina", SWITCH);
  });

  test("her anahtar kendi şubesini bulur; şubesiz eski kasa anahtarın şubesine yazar; başka şube 409 eski gövdeyle", async () => {
    await setSource("tuzla", "asilpos");
    await storeKey("tuzla", KEY_T);
    await storeSwitch("tuzla", T_SWITCH);
    branch.forgetPosBranches();
    const req = (key: string) => {
      const h = signedHeaders(key, "GET", new URL("https://ladmin.laffogato.net/api/panel/pos/urunler"), "", NOW.getTime());
      return { method: "GET", url: new URL("https://ladmin.laffogato.net/api/panel/pos/urunler"), body: "", timestamp: h[TIMESTAMP_HEADER], signature: h[SIGNATURE_HEADER] };
    };
    assert.equal((await branch.resolvePosCaller(req(KEY_M), db, process.env, NOW.getTime())).branchId, "marina");
    assert.equal((await branch.resolvePosCaller(req(KEY_T), db, process.env, NOW.getTime())).branchId, "tuzla");
    const stranger = await branch.resolvePosCaller(req(SECRET), db, process.env, NOW.getTime());
    assert.equal(stranger.branchId, null, "tanınmayan anahtar şubeye bağlanmaz (uç 401)");
    // Şube göndermeyen eski kasa: gün anahtarın şubesine
    const old = await push(KEY_T, body(D2, { total: 3000 }));
    assert.equal(old.status, 200, JSON.stringify(old.body));
    const [row] = await db.select({ branchId: s.posDayReports.branchId }).from(s.posDayReports).where(eq(s.posDayReports.date, D2));
    assert.equal(row.branchId, "tuzla");
    assert.equal(old.body.counted, true);
    // Başka şube bildiren kasa: 409, gövde eski biçimde
    const wrong = await push(KEY_T, body(D2, { sube: "marina" }));
    assert.deepEqual([wrong.status, wrong.body], [409, { error: "wrong_branch", sube: "marina", expected: "tuzla" }]);
    // Devir de anahtarın şubesiyle; ?sube farklıysa 409
    const devir = await import("../src/server/asilpos/devir");
    const at = new URL(`https://ladmin.laffogato.net/api/panel/pos/devir?date=${D2}&sube=marina`);
    const h = signedHeaders(KEY_T, "GET", at, "", NOW.getTime());
    assert.deepEqual(await devir.servePosDevir(db, { branchId: "tuzla", secret: KEY_T, url: at, timestamp: h[TIMESTAMP_HEADER], signature: h[SIGNATURE_HEADER], now: NOW }), {
      status: 409,
      body: { error: "wrong_branch", sube: "marina", expected: "tuzla" },
    });
    // Durum şube şube: Tuzla'nın reddi Marina'nın satırına yazılmaz
    const status = await import("../src/server/asilpos/status");
    assert.equal((await status.readAsilposState(db, "tuzla")).lastError?.error, "wrong_branch");
    assert.equal((await status.readAsilposState(db, "marina")).lastError, null);
    // İki şubenin anahtarı aynıysa ikisi de kullanılmaz (bir şubenin günü öbürüne yazılmasın)
    await storeKey("tuzla", KEY_M);
    branch.forgetPosKeys();
    assert.equal((await branch.resolvePosCaller(req(KEY_M), db, process.env, NOW.getTime())).branchId, null);
    assert.equal((await branch.posKeyState("tuzla", db)).problem, "same_as_other_branch");
  });

  test("kasası ModPOS olan şubenin deneme günü hiçbir hesaba girmez", async () => {
    // Tuzla ModPOS'ta ama anahtarı var (kurulum yapıldı, geçiş henüz yok): günü saklanır, sayılmaz
    await storeKey("tuzla", KEY_T);
    await storeSwitch("tuzla", T_SWITCH);
    branch.forgetPosBranches();
    const r = await push(KEY_T, body(D2, { total: 5000 }));
    assert.equal(r.status, 200);
    assert.equal(r.body.counted, false, "kasası ModPOS: deneme");
    assert.equal(r.body.switchDay, null);
    assert.equal((await push(KEY_M, body(D2, { total: 2000 }))).body.counted, true);
    const reports = await import("../src/server/data/cash-reports");
    const rows = await all(() => reports.asilposTillRows(db));
    assert.deepEqual(rows.map((x) => [x.branchId, x.date, x.zTotal]), [["marina", D2, 2000]], "yalnız Marina'nın sayılan günü");
    const ikram = await import("../src/server/data/asilpos-ikram");
    const data = await all(async () => ikram.loadAsilposIkram(db, await tills.loadSwitchDays(db)));
    assert.deepEqual(data.tillDays, [`marina|${D2}`]);
    const { loadCommissionInput } = await import("../src/server/data/commission");
    const input = await all(() => loadCommissionInput({ resolveNames: false, today: "2029-06-20" }));
    assert.deepEqual(input.asilpos?.days.map((d) => [d.branchId, d.date]), [["marina", D2]]);
  });

  test("iki kasa farklı geçiş günleriyle: \"Tümü\"de satış, kasa satırı, komisyon ve ikram her kasanın kendi gününden; çift sayım yok", async () => {
    await setSource("tuzla", "asilpos");
    await storeKey("tuzla", KEY_T);
    await storeSwitch("tuzla", T_SWITCH);
    branch.forgetPosBranches();
    // Marina 10 ve 16 Haziran, Tuzla 10 (geçiş gününden önce: deneme) ve 16 Haziran; tutarlar ayrı
    for (const [key, date, total] of [[KEY_M, D, 2000], [KEY_M, D2, 3000], [KEY_T, D, 4000], [KEY_T, D2, 8000]] as const) {
      assert.equal((await push(key, body(date, { total }))).status, 200);
    }
    const days = await tills.loadSwitchDays(db);
    assert.deepEqual(days, { tuzla: T_SWITCH, marina: SWITCH });
    // Kasa satırları (ay rakamı, Bugün): Tuzla'nın denemesi yok
    const reports = await import("../src/server/data/cash-reports");
    const rows = await all(() => reports.asilposTillRows(db));
    assert.deepEqual(rows.map((x) => x.zTotal).sort((a, b) => a - b), [2000, 3000, 8000]);
    // Satışlar: her kasa kendi sayılma gününden; satır ↔ Z denetimi (şube, gün) başına
    const sales = await import("../src/server/data/asilpos-sales");
    const month = await all(() => sales.loadAsilposMonthSales(db, { marina: SWITCH, tuzla: T_SWITCH }));
    assert.equal(month.lines.reduce((a, l) => a + l.revenue, 0), 13_000, "2000 + 3000 + 8000; Tuzla'nın 4000'i yok");
    assert.deepEqual(month.linesVsZ.map((x) => [x.branchId, x.date, x.lines, x.z]).sort(), [["marina", D, 2000, 2000], ["marina", D2, 3000, 3000], ["tuzla", D2, 8000, 8000]]);
    assert.deepEqual(month.days, [{ month: "2029-06", days: 2, last: D2 }], "ayın günleri tekil");
    // Komisyon: gün sonları kasa başına, Tuzla 16'dan
    const { loadCommissionInput } = await import("../src/server/data/commission");
    const input = await all(() => loadCommissionInput({ resolveNames: false, today: "2029-06-20" }));
    assert.deepEqual(input.asilpos?.switchDays, { tuzla: T_SWITCH, marina: SWITCH });
    assert.deepEqual(input.asilpos?.days.map((d) => `${d.branchId}|${d.date}`).sort(), [`marina|${D}`, `marina|${D2}`, `tuzla|${D2}`]);
    // İkram: (şube, gün) anahtarlı
    const ikram = await import("../src/server/data/asilpos-ikram");
    const data = await all(() => ikram.loadAsilposIkram(db, days));
    assert.deepEqual([...(data.tillDays ?? [])].sort(), [`marina|${D}`, `marina|${D2}`, `tuzla|${D2}`]);
    assert.equal(data.lines.length, 3);
    // Tek şube seçiliyken yalnız onunki
    const { withBranchScope } = await import("../src/server/branch-scope");
    const tuzlaOnly = await withBranchScope("tuzla", () => reports.asilposTillRows(db));
    assert.deepEqual(tuzlaOnly.map((x) => x.zTotal), [8000]);
  });

  test("iki kasa: süren ayın kasa raporu beklemesi kasa başına; \"Tümü\" şube görünümlerinin toplamı (inceleme 27 Kasım)", async () => {
    await setSource("tuzla", "asilpos");
    await storeKey("tuzla", KEY_T);
    await storeSwitch("tuzla", T_SWITCH);
    branch.forgetPosBranches();
    await db.execute(sql`DELETE FROM cash_reports`);
    const D3 = "2029-06-17";
    const D4 = "2029-06-18";
    // Marina 10, 16, 17 Haziran; Tuzla 16 ve 18 Haziran (geçiş günü 15)
    for (const [key, date, total] of [[KEY_M, D, 2000], [KEY_M, D2, 3000], [KEY_M, D3, 1700], [KEY_T, D2, 8000], [KEY_T, D4, 1600]] as const) {
      const r = await push(key, body(date, { total }));
      assert.equal(r.status, 200, `${date} ${JSON.stringify(r.body)}`);
    }
    // Kasa raporları: Marina'nınki 16 Haziran'a, Tuzla'nınki 15 Haziran'a kadar
    const report = (branchId: string, date: string, zTotal: number) => db.insert(s.cashReports).values({ date, branchId, zTotal, cash: zTotal, submittedByName: "Ayşe" });
    await report("marina", D, 2000);
    await report("marina", D2, 3000);
    await report("tuzla", T_SWITCH, 100);
    mock.timers.enable({ apis: ["Date"], now: NOW });
    try {
      const dataset = await import("../src/server/data/dataset");
      const { withBranchScope } = await import("../src/server/branch-scope");
      const { asilposMonthNotes } = await import("../src/lib/asilpos/sales");
      const load = (scope: string) => withBranchScope(scope, () => dataset.loadDataset());
      const june = (ds: Awaited<ReturnType<typeof load>>) => ds.salesLines.filter((l) => l.month === "2029-06").reduce((a, l) => a + l.revenue, 0);
      const heldOf = (ds: Awaited<ReturnType<typeof load>>) => ds.asilposSales?.months.find((m) => m.month === "2029-06")?.held;
      const marina = await load("marina");
      const tuzla = await load("tuzla");
      const both = await load(ALL_BRANCHES);
      assert.equal(june(marina), 5000, "Marina'nın 17'si kendi raporunu bekler");
      assert.equal(june(tuzla), 0, "Tuzla'nın 16 ve 18'i kendi raporunu (15 Haziran) bekler");
      assert.equal(june(both), june(marina) + june(tuzla), "eskiden Marina'nın raporu Tuzla'nın 16'sını saydırırdı (13.000)");
      assert.deepEqual(heldOf(marina), { from: D3, to: D3 });
      assert.deepEqual(heldOf(tuzla), { from: D2, to: D4 });
      assert.deepEqual(heldOf(both), { from: D2, to: D4, tills: [{ branchId: "tuzla", from: D2, to: D4 }, { branchId: "marina", from: D3, to: D3 }] });
      const names: Record<string, string> = { marina: "Marina", tuzla: "Tuzla" };
      const st = both.asilposSales!.months.find((m) => m.month === "2029-06")!;
      assert.match(asilposMonthNotes(st, SWITCH, (id) => names[id]).info.replace(/[\u00a0\u2060]/g, (c) => (c === "\u00a0" ? " " : "")), /Tuzla 16–18 Haziran, Marina 17 Haziran kasa raporu girilince sayılır/);
      // Tuzla'nın raporu girilince onun günleri sayılır; Marina'nın 17'si yine bekler
      await report("tuzla", D4, 1600);
      const entered = await load(ALL_BRANCHES);
      assert.equal(june(entered), 5000 + 8000 + 1600);
      assert.deepEqual(heldOf(entered), { from: D3, to: D3 });
    } finally {
      mock.timers.reset();
      await db.execute(sql`DELETE FROM cash_reports`);
    }
  });

  test("kurulum kodu: aynı anda kod üretilip verilirse kasaya giden anahtar panelde saklanan anahtardır (kilit, inceleme 27 Kasım)", async () => {
    const kurulum = await import("../src/server/asilpos/kurulum");
    for (let i = 0; i < 5; i++) {
      await storeKey("tuzla", null);
      branch.forgetPosKeys();
      const { raw } = await kurulum.issueInstallCode(db, { branchId: "tuzla", email: "tuzla@test.local", by: me.id }, NOW);
      await storeKey("tuzla", null);
      branch.forgetPosKeys();
      const [redeemed] = await Promise.all([kurulum.redeemInstallCode(raw, db, NOW), kurulum.issueInstallCode(db, { branchId: "tuzla", email: "tuzla@test.local", by: me.id }, NOW)]);
      const stored = await branch.posKeyOf("tuzla", db);
      assert.ok(stored);
      if (redeemed.status === 200) assert.ok(Object.values(redeemed.body.baglanti).includes(stored), "kasanın anahtarı panelinkiyle aynı");
    }
  });

  test("kurulum kodu şubenin kendi anahtarını verir, başka şubeninkini hiçbir zaman", async () => {
    const kurulum = await import("../src/server/asilpos/kurulum");
    const { raw } = await kurulum.issueInstallCode(db, { branchId: "tuzla", email: "tuzla@test.local", by: me.id }, NOW);
    const tuzlaKey = await branch.posKeyOf("tuzla", db);
    assert.ok(tuzlaKey && tuzlaKey.length >= 32, "kod üretilirken Tuzla'nın anahtarı saklandı");
    assert.notEqual(tuzlaKey, KEY_M);
    const r = await kurulum.redeemInstallCode(raw, db, NOW);
    assert.equal(r.status, 200);
    const values = r.status === 200 ? Object.values(r.body.baglanti) : [];
    assert.ok(values.includes(tuzlaKey!), "Tuzla'nın kendi anahtarı");
    assert.ok(!values.includes(KEY_M), "Marina'nın anahtarı verilmez");
    // Marina'nın kodu Marina'nın anahtarını verir (var olan anahtar değişmez)
    const m = await kurulum.issueInstallCode(db, { branchId: "marina", email: "marina@test.local", by: me.id }, NOW);
    const rm = await kurulum.redeemInstallCode(m.raw, db, NOW);
    assert.ok(rm.status === 200 && Object.values(rm.body.baglanti).includes(KEY_M));
  });
});
