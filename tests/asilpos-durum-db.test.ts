// AsilPOS bağlantısının durumu, onarımı ve geçiş günü, gerçek Postgres'te (docs/ASILPOS.md › Durum ve onarım, Geçiş
// günü; denetim B07, E-31 ve E-32): uç her sonucu integration_state › asilpos'a yazar (200 son gün; 409 gün ve iki Z; 400
// alan; 500 veritabanı; 401 / 413 yalnız sayaç, örnek başına dakikada bir yazım; 503'te hiçbir şey), 200 yanıtı geçiş
// gününe göre `counted` ve `switchDay` taşır; "Bu günün AsilPOS kaydını sil" iki tabloyu tek işlemde temizler, sonra
// yeni Z'li gün yazılır; personel silemez, ayarı değiştiremez; Kasa raporu AsilPOS gününü yalnız geçiş gününden sonra
// okur; eylemler parolayla (yanlışı işlem geçmişine "Hatalı parola onayı (AsilPOS)") ve işlem geçmişiyle çalışır.
//
// Ayarlar ve durum satırı veritabanında tektir: test kendi geçici veritabanını açar (ASILPOS_TEST_DATABASE_URL'in
// sunucusunda), migration'ları uygular, sonunda siler; öteki testlerin verisine dokunmaz.
//
// ASILPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: ASILPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/laffogato_asilpos npx tsx --test tests/asilpos-durum-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { signedHeaders } from "../src/lib/karaoke/signature";
import { DURUM_ANAHTARI, SUBE_AYAR_GRUBU, TEL_KAYNAK, ZIL_ONEKI } from "../src/lib/asilpos/eski-adlar";
import { asilposCardSummary } from "../src/lib/asilpos/status";
import { STEP_UP_REQUIRED, WRONG_PASSWORD } from "../src/lib/step-up";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { ASILPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.ASILPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_asilpos_durum_${process.pid}`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const GUN = new URL("https://ladmin.laffogato.net/api/pos/gun");
/** Testin "şimdi"si: 12 Kasım 2026 öğlen (iş günü 12 Kasım) */
const NOW = new Date("2026-11-12T12:00:00+03:00");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
const PASSWORD = "Yonetici-Parola-2026";

describe("AsilPOS durumu ve onarımı: veritabanında", { skip: !SERVER_URL && "ASILPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let status: typeof import("../src/server/asilpos/status");
  let core: typeof import("../src/server/asilpos/admin");
  let kasa: typeof import("../src/server/data/asilpos-day");
  let actions: typeof import("../src/server/actions/asilpos");
  let bell: typeof import("../src/server/bell/asilpos");
  const users = { admin: { id: 0, name: "Yönetici", email: "asilpos-yonetici@ornek.com", role: "admin" as const }, staff: { id: 0, name: "Ayşe", email: "asilpos-ayse@ornek.com", role: "staff" as const } };
  const warnings: unknown[][] = [];
  const realWarn = console.warn;

  const push = (date: string, zNo: number, lines: Record<string, unknown>[] = [line(`LATTE ${date}`)]) => ({
    version: 1,
    source: "asilpos",
    date,
    z: { zNo, receipts: 10, zTotal: 1000, cash: 400, card: 600, mealCard: 0, online: 0, other: 0, offRevenue: 0, discounts: 0, openingCash: 500, cashOut: 0, countedCash: 900, handedOver: 0, cashDiff: 0 },
    lines,
    ikram: [],
    payments: [],
  });
  function line(posName: string, o: Record<string, unknown> = {}) {
    return { posName, siteMenuId: null, slot: null, qty: 2, revenue: 400, isService: false, ...o };
  }
  /** Ucun çekirdeği (route.ts handlePosDay'i çağırır); `windowMs` imzasız sayaçın yazım aralığı */
  const send = (body: unknown, o: { secret?: string | null; signWith?: string; now?: Date; windowMs?: number; db?: DB } = {}) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const now = o.now ?? NOW;
    const h = signedHeaders(o.signWith ?? SECRET, "POST", GUN, raw, now.getTime());
    return status.handlePosDay(
      o.db ?? db,
      { secret: o.secret === undefined ? SECRET : o.secret, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] },
      now,
      { unverifiedWindowMs: o.windowMs ?? 0 },
    );
  };
  const stateRow = async () => (await db.select().from(s.integrationState).where(eq(s.integrationState.key, DURUM_ANAHTARI)))[0]?.value as Record<string, unknown> | undefined;
  const reportOf = async (date: string) => (await db.select().from(s.posDayReports).where(eq(s.posDayReports.date, date)))[0];
  const linesOf = (date: string) => db.select().from(s.posDailySales).where(eq(s.posDailySales.date, date));
  const refused = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: unknown) => e instanceof UserError && re.test(e.message));

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    // Kartın bağlantı durumu ortamdan okunur: bağlı (retler kırmızı sayılır)
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "asilpos-testi-icin-en-az-otuz-iki-karakterlik-anahtar", ASILPOS_SYNC_SECRET: SECRET });
    delete process.env.KARAOKE_SYNC_SECRET;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    const { hashPassword } = await import("../src/server/auth/password");
    for (const k of ["admin", "staff"] as const) {
      const [u] = await db.insert(s.users).values({ email: users[k].email, name: users[k].name, passwordHash: await hashPassword(PASSWORD), role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    // Eylemlerin oturumu: yönetici (personel çekirdekte reddedilir; requireAdmin personeli zaten yönlendirir)
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => users.admin, requireUser: async () => users.admin });
    status = await import("../src/server/asilpos/status");
    core = await import("../src/server/asilpos/admin");
    kasa = await import("../src/server/data/asilpos-day");
    actions = await import("../src/server/actions/asilpos");
    bell = await import("../src/server/bell/asilpos");
    console.warn = (...args: unknown[]) => void warnings.push(args);
  });

  after(async () => {
    console.warn = realWarn;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    // Geçiş günü şube ayarında (grup SUBE_AYAR_GRUBU; docs/SUBE.md › Şube başına ayarlar): her test kendi gününü yazar
    await db.execute(sql`TRUNCATE pos_daily_sales, pos_day_reports, integration_state, special_days, activity_log, branch_settings RESTART IDENTITY CASCADE`);
    await db.delete(s.settings).where(eq(s.settings.key, "asilposGecisGunu"));
    status.resetUnverifiedBuffer();
    warnings.length = 0;
  });

  test("200: gün yazılır, son gün durum satırına; yanıtta counted ve switchDay geçiş gününe göre", async () => {
    assert.deepEqual(await send(push("2026-11-05", 31)), { status: 200, body: { ok: true, date: "2026-11-05", lines: 1, matched: 0, unmatched: ["LATTE 2026-11-05"], counted: false, switchDay: null, nextOpening: null } });
    assert.deepEqual((await stateRow())?.lastOk, { at: NOW.toISOString(), date: "2026-11-05", zNo: 31, lines: 1, counted: false });
    assert.equal(await core.writeAsilposSwitchDay(db, users.admin, "2026-11-06", "2026-11-12"), "AsilPOS'a geçiş günü: yok (kasa ModPOS) → 6 Kasım 2026");
    assert.deepEqual((await send(push("2026-11-05", 31), { now: later(1) })).body, { ok: true, date: "2026-11-05", lines: 1, matched: 0, unmatched: ["LATTE 2026-11-05"], counted: false, switchDay: "2026-11-06", nextOpening: null });
    assert.deepEqual((await send(push("2026-11-06", 32), { now: later(2) })).body, { ok: true, date: "2026-11-06", lines: 1, matched: 0, unmatched: ["LATTE 2026-11-06"], counted: true, switchDay: "2026-11-06", nextOpening: { amount: 900, source: TEL_KAYNAK } });
    const st = (await stateRow()) as { lastOk: { date: string; counted: boolean }; lastError?: unknown };
    assert.deepEqual([st.lastOk.date, st.lastOk.counted], ["2026-11-06", true]);
    assert.equal(st.lastError, undefined, "başarılı gönderim ret yazmaz");
    assert.deepEqual(warnings, []);
  });

  test("409: hiçbir şey yazılmaz; son ret gün, paneldeki ve gönderilen Z ile; gövdesiz günlük satırı", async () => {
    await send(push("2026-11-07", 127));
    const before = await reportOf("2026-11-07");
    const r = await send(push("2026-11-07", 128, [line("BAŞKA")]), { now: later(5) });
    assert.deepEqual(r, { status: 409, body: { error: "z_conflict", date: "2026-11-07", zNo: 127 } });
    assert.deepEqual(await reportOf("2026-11-07"), before);
    assert.deepEqual((await linesOf("2026-11-07")).map((l) => l.posName), ["LATTE 2026-11-07"]);
    const st = await status.readAsilposState(db);
    assert.deepEqual(st.lastError, { at: later(5).toISOString(), status: 409, error: "z_conflict", field: null, date: "2026-11-07", zNo: 127, sentZNo: 128, clearedAt: null });
    assert.deepEqual(st.rejections, { "2026-11-07": st.lastError }, "günlü ret güne göre de saklanır");
    assert.equal(st.lastOk?.date, "2026-11-07", "son başarılı gün kalır");
    assert.deepEqual(warnings, [["[asilpos] reddedildi", 409, "z_conflict", "2026-11-07", 127]]);
    assert.doesNotMatch(JSON.stringify(warnings), /LATTE|BAŞKA|zTotal/, "günlüğe gövde yazılmaz");
  });

  test("400: son ret alan ve gün ile; bozuk gövdede gün yok", async () => {
    const bad = { ...push("2026-11-08", 40), lines: [line("X", { qty: -1 })] };
    assert.deepEqual(await send(bad), { status: 400, body: { error: "invalid", field: "lines.0.qty" } });
    let st = await status.readAsilposState(db);
    assert.deepEqual([st.lastError?.status, st.lastError?.field, st.lastError?.date, st.lastError?.sentZNo], [400, "lines.0.qty", "2026-11-08", null]);
    assert.equal(st.rejections["2026-11-08"]?.field, "lines.0.qty");
    assert.equal(await send("{bozuk").then((x) => x.status), 400);
    st = await status.readAsilposState(db);
    assert.deepEqual([st.lastError?.field, st.lastError?.date], ["body", null]);
    assert.deepEqual(Object.keys(st.rejections), ["2026-11-08"], "günsüz ret güne göre yazılmaz, günlüyü silmez");
    assert.equal(await reportOf("2026-11-08"), undefined);
  });

  test("401 / 413 yalnız sayaç (gövde okunmaz), örnek başına aralıkta bir yazım; 503'te hiçbir şey yazılmaz", async () => {
    assert.deepEqual(await send(push("2026-11-09", 50), { secret: null }), { status: 503, body: { error: "not_configured" } });
    assert.equal(await stateRow(), undefined, "anahtar yokken durum satırı açılmaz");
    // Aralık 60 sn: ilki yazılır, sonraki ikisi bellekte birikir, 61 sn sonraki dördüncü üçünü ekler
    const wrong = { signWith: `${SECRET}x`, windowMs: 60_000 };
    assert.equal((await send(push("2026-11-09", 50), { ...wrong, now: NOW })).status, 401);
    assert.deepEqual((await stateRow())?.unverified, { count: 1, lastAt: NOW.toISOString(), lastStatus: 401 });
    await send(push("2026-11-09", 50), { ...wrong, now: later(0.2) });
    await send(push("2026-11-09", 50), { ...wrong, now: later(0.5) });
    assert.deepEqual((await stateRow())?.unverified, { count: 1, lastAt: NOW.toISOString(), lastStatus: 401 }, "aralıkta yazım yok");
    await status.noteUnverified(db, 413, later(1.1), 60_000);
    assert.deepEqual((await stateRow())?.unverified, { count: 4, lastAt: later(1.1).toISOString(), lastStatus: 413 });
    assert.equal((await stateRow())?.lastError, undefined, "imzasız istek son ret değildir");
    assert.equal(await reportOf("2026-11-09"), undefined);
    assert.ok(warnings.every((w) => w.length === 3 && w[0] === "[asilpos] reddedildi"), JSON.stringify(warnings));
  });

  test("500: veritabanı yazamazsa son ret yazılmaya çalışılır ve hata yeniden fırlar (uç 500, AsilPOS yeniden dener)", async () => {
    const broken = Object.create(db) as DB;
    broken.transaction = (() => Promise.reject(new Error("bağlantı koptu"))) as DB["transaction"];
    await assert.rejects(send(push("2026-11-10", 60), { db: broken }), /bağlantı koptu/);
    const st = await status.readAsilposState(db);
    assert.deepEqual([st.lastError?.status, st.lastError?.error, st.lastError?.date, st.lastError?.sentZNo], [500, "server_error", "2026-11-10", 60]);
  });

  test("Bu günün AsilPOS kaydını sil: iki tablo tek işlemde temizlenir, ret kapanır, sonra yeni Z'li gün yazılır; personel silemez", async () => {
    await send(push("2026-11-07", 127, [line("A"), line("B")]));
    await send(push("2026-11-08", 128));
    await send(push("2026-11-07", 3), { now: later(1) });
    assert.equal((await status.readAsilposState(db)).lastError?.error, "z_conflict");
    await refused(core.removeAsilposDay(db, users.staff, "2026-11-07", 127), /yalnız yönetici/);
    await refused(core.removeAsilposDay(db, users.admin, "2026-11-07", 3), /bu arada Z 127 ile yeniden gönderildi/);
    await refused(core.removeAsilposDay(db, users.admin, "2026-11-01", 1), /kaydı yok/);
    assert.equal((await linesOf("2026-11-07")).length, 2, "reddedilen silme bir şey silmez");
    assert.deepEqual(await core.removeAsilposDay(db, users.admin, "2026-11-07", 127, later(2)), { zNo: 127, lines: 2 });
    assert.equal(await reportOf("2026-11-07"), undefined);
    assert.deepEqual(await linesOf("2026-11-07"), []);
    assert.ok(await reportOf("2026-11-08"), "öteki gün kalır");
    assert.equal((await linesOf("2026-11-08")).length, 1);
    assert.equal((await status.readAsilposState(db)).rejections["2026-11-07"]?.clearedAt, later(2).toISOString());
    // AsilPOS'ta Gönder'e basılır: yeni Z ile yazılır, o günün reddi kapanır
    assert.deepEqual((await send(push("2026-11-07", 3), { now: later(3) })).body, { ok: true, date: "2026-11-07", lines: 1, matched: 0, unmatched: ["LATTE 2026-11-07"], counted: false, switchDay: null, nextOpening: null });
    assert.equal((await reportOf("2026-11-07")).z.zNo, 3);
    assert.deepEqual((await status.readAsilposState(db)).rejections, {});
    // Aynı anda gelen gün sonu ile silme aynı kilitte sırayla: sonuç ya silinmiş ya da yeni gün (yarım değil)
    await Promise.allSettled([core.removeAsilposDay(db, users.admin, "2026-11-07", 3), send(push("2026-11-07", 3, [line("C")]), { now: later(4) })]);
    const rep = await reportOf("2026-11-07");
    const names = (await linesOf("2026-11-07")).map((l) => l.posName);
    assert.ok((rep === undefined && names.length === 0) || (rep?.z.zNo === 3 && names.length === 1), `${rep?.z.zNo} ${names}`);
  });

  test("açık 409 güne göre kalır: sonraki günün 200'ü ve başka günün 400'ü / 500'ü onu örtmez; silme düğmesi gününde", async () => {
    const summary = async (now: Date) => asilposCardSummary(await status.loadAsilposCard(db, now));
    await send(push("2026-11-07", 127));
    assert.equal((await send(push("2026-11-07", 128), { now: later(1) })).status, 409);
    assert.equal((await send(push("2026-11-08", 129), { now: later(2) })).status, 200);
    assert.equal((await send({ ...push("2026-11-09", 130), lines: [line("X", { qty: -1 })] }, { now: later(3) })).status, 400);
    const broken = Object.create(db) as DB;
    broken.transaction = (() => Promise.reject(new Error("bağlantı koptu"))) as DB["transaction"];
    await assert.rejects(send(push("2026-11-10", 131), { db: broken, now: later(4) }), /bağlantı koptu/);
    let sum = await summary(later(5));
    assert.deepEqual(
      sum.dayRejections.map((x) => [x.rejection.date, x.rejection.status, x.status, x.day?.zNo ?? null]),
      [
        ["2026-11-09", 400, "open", null],
        ["2026-11-07", 409, "open", 127],
      ],
      "7 Kasım'ın çakışması ve silinecek Z 127 duruyor",
    );
    assert.deepEqual([sum.undated?.rejection.status, sum.undated?.fresh, sum.alerts], [500, true, 3]);
    assert.match(sum.short, /^3 gönderim reddedildi · /);
    // AsilPOS 500'ü kendisi yeniden dener: başarılı olunca 500 sakinleşir, 409 ve 400 açık kalır
    assert.equal((await send(push("2026-11-10", 131), { now: later(6) })).status, 200);
    sum = await summary(later(7));
    assert.deepEqual([sum.undated?.fresh, sum.alerts, sum.dayRejections.length], [false, 2, 2]);
    assert.equal(await reportOf("2026-11-09"), undefined, "400'ün günü yazılmadı");
    assert.equal((await reportOf("2026-11-07")).z.zNo, 127);
  });

  test("zil: sayılan AsilPOS gününün reddi yöneticinin zilinde bir kez (gün ve neden başına); deneme günü düşmez, gün yeniden yazılınca kalkar", async () => {
    const rows = async (now: Date) => (await bell.asilposRejectionBell(db, now)).map((n) => [n.id, n.title, n.group, n.kind, n.href, n.timeLabel]);
    assert.deepEqual(await bell.asilposRejectionBell(db, later(1)), [], "ret yokken satır yok");
    assert.match((await core.writeAsilposSwitchDay(db, users.admin, "2026-11-06", "2026-11-12")) ?? "", /→ 6\sKasım 2026$/);
    // Deneme günü (geçişten önce) reddedilse de zile düşmez (kart gösterir)
    await send(push("2026-11-05", 31));
    assert.equal((await send(push("2026-11-05", 32), { now: later(1) })).status, 409);
    assert.deepEqual(await rows(later(2)), []);
    // Sayılan gün: Z çakışması
    await send(push("2026-11-07", 127), { now: later(2) });
    assert.equal((await send(push("2026-11-07", 128), { now: later(3) })).status, 409);
    const conflict = [`${ZIL_ONEKI}-ret-2026-11-07-z_conflict`, "Marina gün sonu alınamadı: Z numarası çakıştı", "sistem", "danger", "/panel/ayarlar?sube=marina#asilpos", "Bugün"];
    assert.deepEqual(await rows(later(4)), [conflict]);
    const [first] = await bell.asilposRejectionBell(db, later(4));
    assert.match(first.body, /^7\sKasım: panelde Z 127 kayıtlı, AsilPOS Z 128 gönderdi\. .*Gönder'e basın\.$/);
    // AsilPOS aynı günü aynı nedenle yeniden gönderip yine reddedilince satır yinelenmez (kimlik aynı)
    assert.equal((await send(push("2026-11-07", 129), { now: later(5) })).status, 409);
    assert.deepEqual(await rows(later(6)), [conflict]);
    // Başka gün, başka neden: sözleşmeye uymayan gövde ve başka şubeye ayarlı kasa (en yeni gün önce)
    assert.equal((await send({ ...push("2026-11-08", 40), lines: [line("X", { qty: -1 })] }, { now: later(7) })).status, 400);
    assert.equal((await send({ ...push("2026-11-09", 41), sube: MODPOS_SUBE }, { now: later(8) })).status, 409);
    assert.deepEqual(
      (await rows(later(9))).map((r) => r[0]),
      [`${ZIL_ONEKI}-ret-2026-11-09-wrong_branch`, `${ZIL_ONEKI}-ret-2026-11-08-invalid`, `${ZIL_ONEKI}-ret-2026-11-07-z_conflict`],
    );
    // AsilPOS panelin Z'sini yeniden gönderdi (200): 7 Kasım'ın reddi kapanır, satırı kalkar; ötekiler durur
    assert.equal((await send(push("2026-11-07", 127), { now: later(10) })).status, 200);
    assert.deepEqual((await rows(later(11))).map((r) => r[0]), [`${ZIL_ONEKI}-ret-2026-11-09-wrong_branch`, `${ZIL_ONEKI}-ret-2026-11-08-invalid`]);
    // Bir hafta sonra zilden düşer (kart göstermeye devam eder)
    assert.deepEqual(await rows(new Date(NOW.getTime() + 8 * 86_400_000)), []);
    assert.equal(asilposCardSummary(await status.loadAsilposCard(db, new Date(NOW.getTime() + 8 * 86_400_000))).dayRejections.length, 3);
  });

  test("AsilPOS panelin Z'sini yeniden gönderince (200) o günün 409'u kapanır: kart doğru kaydı silmeyi önermez", async () => {
    await send(push("2026-11-07", 12));
    assert.equal((await send(push("2026-11-07", 13), { now: later(1) })).status, 409);
    let sum = asilposCardSummary(await status.loadAsilposCard(db, later(2)));
    assert.deepEqual(
      sum.dayRejections.map((x) => [x.rejection.date, x.status, x.day?.zNo]),
      [["2026-11-07", "open", 12]],
    );
    assert.equal((await send(push("2026-11-07", 12), { now: later(3) })).status, 200);
    assert.deepEqual((await status.readAsilposState(db)).rejections, {});
    sum = asilposCardSummary(await status.loadAsilposCard(db, later(4)));
    assert.deepEqual([sum.dayRejections, sum.undated, sum.alerts, sum.short], [[], null, 0, sum.headline]);
    // Durum yazımı kaybolsa bile (eski satır) gün retten sonra yazıldığı için ret çözülmüş sayılır
    await db.execute(sql`update integration_state set value = jsonb_set(value, '{rejections}', jsonb_build_object('2026-11-07', value->'lastError')) where key = 'asilpos'`);
    sum = asilposCardSummary(await status.loadAsilposCard(db, later(5)));
    assert.deepEqual(sum.dayRejections, []);
  });

  test("günü silmek yalnız çözdüğü 409'u 'silindi' yapar: aynı günün 400'ü ve başka Z'nin çakışması olduğu gibi kalır", async () => {
    await send(push("2026-11-07", 127, [line("A"), line("B")]));
    assert.equal((await send({ ...push("2026-11-07", 127), lines: [line("A"), line("A")] }, { now: later(1) })).status, 400);
    assert.equal((await status.readAsilposState(db)).rejections["2026-11-07"]?.field, "lines.1.posName");
    assert.deepEqual(await core.removeAsilposDay(db, users.admin, "2026-11-07", 127, later(2)), { zNo: 127, lines: 2 });
    let st = await status.readAsilposState(db);
    assert.equal(st.rejections["2026-11-07"]?.clearedAt, null, "400 silmeyle çözülmez: alanı ve nedeni görünmeye devam eder");
    let sum = asilposCardSummary(await status.loadAsilposCard(db, later(3)));
    assert.deepEqual(
      sum.dayRejections.map((x) => [x.rejection.date, x.rejection.status, x.status]),
      [["2026-11-07", 400, "open"]],
    );
    // Başka Z'nin çakışması: paneldeki Z 5 silinir ama ret Z 4 içindi (eski), "silindi" olmaz
    await send(push("2026-11-08", 4));
    assert.equal((await send(push("2026-11-08", 9), { now: later(4) })).status, 409);
    await db.execute(sql`update pos_day_reports set z = jsonb_set(z, '{zNo}', '5') where date = '2026-11-08'`);
    await core.removeAsilposDay(db, users.admin, "2026-11-08", 5, later(5));
    st = await status.readAsilposState(db);
    assert.equal(st.rejections["2026-11-08"]?.clearedAt, null);
    // Doğru çakışma: silinince "Gönder bekleniyor" (kırmızı değil)
    await send(push("2026-11-09", 21));
    assert.equal((await send(push("2026-11-09", 22), { now: later(6) })).status, 409);
    await core.removeAsilposDay(db, users.admin, "2026-11-09", 21, later(7));
    st = await status.readAsilposState(db);
    assert.equal(st.rejections["2026-11-09"]?.clearedAt, later(7).toISOString());
    sum = asilposCardSummary(await status.loadAsilposCard(db, later(8)));
    assert.deepEqual(
      sum.dayRejections.map((x) => [x.rejection.date, x.status, x.rejection.clearedAt]),
      [
        ["2026-11-09", "cleared", later(7).toISOString()],
        ["2026-11-08", "cleared", null],
        ["2026-11-07", "open", null],
      ],
      "8 Kasım'ın kaydı panelde yok: AsilPOS gönderince yazılır (silindi denmez)",
    );
    assert.match(sum.short, /^7\u00a0Kasım gönderimi reddedildi · 2 gün için AsilPOS'tan Gönder bekleniyor · /);
  });

  test("geçiş günü: yalnız yönetici, geçerli gün; aynı değer kayıt değildir; şube ayarına yazılır, eski kayıt yazılmaz", async () => {
    await refused(core.writeAsilposSwitchDay(db, users.staff, "2026-11-10", "2026-11-12"), /yalnız yönetici/);
    await refused(core.writeAsilposSwitchDay(db, users.admin, "2026-09-01", "2026-11-12"), /en erken/);
    await refused(core.writeAsilposSwitchDay(db, users.admin, "2027-03-01", "2026-11-12"), /90 gün/);
    assert.equal(await core.writeAsilposSwitchDay(db, users.admin, null, "2026-11-12"), null, "zaten boş");
    assert.match((await core.writeAsilposSwitchDay(db, users.admin, "2026-11-10", "2026-11-12")) ?? "", /yok \(kasa ModPOS\) → 10 Kasım 2026/);
    assert.equal(await core.writeAsilposSwitchDay(db, users.admin, "2026-11-10", "2026-11-12"), null);
    assert.equal(await status.loadAsilposSwitchDay(db), "2026-11-10");
    assert.equal(await core.writeAsilposSwitchDay(db, users.admin, null, "2026-11-12"), "AsilPOS'a geçiş günü: 10 Kasım 2026 → yok (kasa ModPOS)");
    // Yazım AsilPOS'un şubesinin şube ayarına (Marina'nın satırı); eski genel kayıt (settings) yazılmaz
    assert.equal((await db.select().from(s.settings).where(eq(s.settings.key, "asilposGecisGunu"))).length, 0);
    assert.deepEqual((await db.select({ value: s.branchSettings.value }).from(s.branchSettings).where(eq(s.branchSettings.grp, SUBE_AYAR_GRUBU)))[0]?.value, { switchDay: null });
    // Satırı olmayan Marina eski kaydı okur: bozuk değer okunurken ModPOS; boşaltmak değişiklik değildir
    await db.execute(sql`DELETE FROM branch_settings`);
    await db.insert(s.settings).values({ key: "asilposGecisGunu", value: "bozuk" });
    assert.equal(await status.loadAsilposSwitchDay(db), null);
    assert.equal(await core.writeAsilposSwitchDay(db, users.admin, null, "2026-11-12"), null);
    const { loadSettings } = await import("../src/server/data/dataset");
    assert.equal((await loadSettings()).asilposGecisGunu, null);
  });

  test("Kasa raporu: AsilPOS günü yalnız geçiş gününden sonra okunur; geçiş günü boşken ya da önceki günde hiç okunmaz", async () => {
    await send(push("2026-11-05", 31));
    await send(push("2026-11-09", 35));
    // Kasa AsilPOS'un şubesinin (Marina) kasasıdır
    assert.equal(await kasa.loadKasaAsilposDay("2026-11-05", db, ASILPOS_SUBE), null, "geçiş günü yok: deneme günü Kasa'ya girmez");
    assert.equal(await kasa.loadKasaAsilposDay("2026-11-09", db, ASILPOS_SUBE), null);
    assert.ok(await kasa.loadAsilposDay("2026-11-09", db, ASILPOS_SUBE), "veri saklı");
    await core.writeAsilposSwitchDay(db, users.admin, "2026-11-08", "2026-11-12");
    assert.equal(await kasa.loadKasaAsilposDay("2026-11-05", db, ASILPOS_SUBE), null, "geçiş gününden önce");
    const day = await kasa.loadKasaAsilposDay("2026-11-09", db, ASILPOS_SUBE);
    assert.equal(day?.prefill.values.zNo?.value, "35");
    assert.equal(await kasa.loadKasaAsilposDay("2026-11-10", db, ASILPOS_SUBE), null, "gün gelmedi");
    assert.deepEqual(await kasa.loadKasaAsilpos("2026-11-10", db, ASILPOS_SUBE), { asilpos: true, day: null }, "gün AsilPOS günü, gönderimi yok");
    // Geçiş günü yalnız AsilPOS'un şubesinin kasasınındır: Tuzla'nın kasası (şube verilmeyince de o) ModPOS'ta kalır,
    // Marina'nın gün sonunu görmez
    assert.deepEqual(await kasa.loadKasaAsilpos("2026-11-09", db, MODPOS_SUBE), { asilpos: false, day: null });
    assert.deepEqual(await kasa.loadKasaAsilpos("2026-11-09", db), { asilpos: false, day: null });
    assert.equal(await kasa.loadAsilposDay("2026-11-09", db, MODPOS_SUBE), null);
  });

  test("Ayarlar kartının verisi: deneme ve sayılan günler, gelmeyen günler (kapalı gün hariç), eşleşmeyen adlar, ret günü", async () => {
    let card = await status.loadAsilposCard(db, NOW);
    assert.deepEqual([card.switchDay, card.totalDays, card.trialDays, card.days, card.missing, card.unmatchedCount, card.rejectionDays], [null, 0, 0, [], [], 0, {}]);
    await send(push("2026-11-05", 31, [line("YENİ ÜRÜN", { qty: 3 }), line("ODA", { isService: true })]));
    await send(push("2026-11-09", 35, [line("YENİ ÜRÜN", { qty: 2 })]));
    await send(push("2026-11-10", 36));
    await send(push("2026-11-10", 99), { now: later(1) });
    await core.writeAsilposSwitchDay(db, users.admin, "2026-11-08", "2026-11-12");
    await db.insert(s.specialDays).values({ kind: "kapali", dateFrom: "2026-11-08", dateTo: "2026-11-08", title: "Kapalı", createdByName: "Yönetici" });
    card = await status.loadAsilposCard(db, NOW);
    assert.equal(card.switchDay, "2026-11-08");
    assert.equal(card.today, "2026-11-12");
    assert.deepEqual([card.totalDays, card.trialDays], [3, 1]);
    assert.deepEqual(
      card.days.map((d) => [d.date, d.zNo, d.lines, d.counted]),
      [
        ["2026-11-10", 36, 1, true],
        ["2026-11-09", 35, 1, true],
        ["2026-11-05", 31, 2, false],
      ],
    );
    assert.deepEqual(card.lastDay, { date: "2026-11-10", zNo: 36, receivedAt: NOW.toISOString() });
    assert.deepEqual(card.missing, ["2026-11-11"], "8 Kasım kapalı, 9 ve 10 geldi, 12 bugün");
    assert.deepEqual(card.unmatched, [
      { posName: "YENİ ÜRÜN", qty: 5, days: 2 },
      { posName: "LATTE 2026-11-10", qty: 2, days: 1 },
    ]);
    assert.equal(card.unmatchedCount, 2, "hizmet satırı sayılmaz");
    assert.deepEqual(card.rejectionDays, { "2026-11-10": { zNo: 36, lines: 1, receivedAt: NOW.toISOString() } }, "409'un günü: silinecek kayıt");
    assert.equal(card.secretProblem, null);
  });

  test("eylemler: geçiş günü işlem geçmişine; günü silme parolasız STEP_UP_REQUIRED, yanlışı 'Hatalı parola onayı (AsilPOS)', doğrusu siler", async () => {
    const saved = await actions.saveAsilposSwitchDay("2026-11-10");
    assert.ok(saved.ok);
    assert.match(saved.data.change ?? "", /10 Kasım 2026/);
    assert.deepEqual(await actions.saveAsilposSwitchDay("10.11.2026"), { ok: false, error: "Geçersiz tarih" });
    await send(push("2026-11-07", 127));
    assert.deepEqual(await actions.deleteAsilposDay({ date: "2026-11-07", zNo: 127 }), { ok: false, error: STEP_UP_REQUIRED });
    assert.deepEqual(await actions.deleteAsilposDay({ date: "2026-11-07", zNo: 127 }, { password: "yanlis" }), { ok: false, error: WRONG_PASSWORD });
    assert.ok(await reportOf("2026-11-07"), "yanlış parola silmez");
    assert.deepEqual(await actions.deleteAsilposDay({ date: "2026-11-01", zNo: 1 }, { password: PASSWORD }), { ok: false, error: "Bu günün AsilPOS kaydı yok (silinmiş olabilir); sayfayı yenileyin" });
    // Ön denetim şube şube: ModPOS'taki şubenin (Tuzla) aynı günkü eski deneme satırı "gün kayıtlı" sayılmaz, parola
    // sorulmaz; AsilPOS'un şubesinin satırı silinince Tuzla'nınki yerinde kalır
    const [asilposZ] = await db.select({ z: s.posDayReports.z }).from(s.posDayReports).where(eq(s.posDayReports.date, "2026-11-07"));
    await db.insert(s.posDayReports).values([
      { date: "2026-11-03", branchId: MODPOS_SUBE, z: { ...asilposZ.z, zNo: 90 }, payments: [], ikram: [], source: "asilpos" },
      { date: "2026-11-07", branchId: MODPOS_SUBE, z: { ...asilposZ.z, zNo: 91 }, payments: [], ikram: [], source: "asilpos" },
    ]);
    assert.deepEqual(await actions.deleteAsilposDay({ date: "2026-11-03", zNo: 90 }), { ok: false, error: "Bu günün AsilPOS kaydı yok (silinmiş olabilir); sayfayı yenileyin" });
    assert.deepEqual(await actions.deleteAsilposDay({ date: "2026-11-07", zNo: 127 }, { password: PASSWORD }), { ok: true, data: { zNo: 127, lines: 1 } });
    assert.deepEqual(
      (await db.select({ date: s.posDayReports.date, branchId: s.posDayReports.branchId }).from(s.posDayReports).orderBy(s.posDayReports.date)).map((r) => [r.date, r.branchId]),
      [
        ["2026-11-03", MODPOS_SUBE],
        ["2026-11-07", MODPOS_SUBE],
      ],
      "Tuzla'nın satırlarına dokunulmadı",
    );
    await db.delete(s.posDayReports).where(eq(s.posDayReports.branchId, MODPOS_SUBE));
    assert.equal(await reportOf("2026-11-07"), undefined);
    const log = await db.select({ action: s.activityLog.action, detail: s.activityLog.detail, userId: s.activityLog.userId }).from(s.activityLog).orderBy(s.activityLog.id);
    assert.deepEqual(
      log.map((l) => [l.action, l.detail, l.userId]),
      [
        ["Ayarlar", "AsilPOS'a geçiş günü: yok (kasa ModPOS) → 10 Kasım 2026", users.admin.id],
        ["Hatalı parola onayı (AsilPOS)", `${users.admin.email} · AsilPOS günü silme: 2026-11-07`, users.admin.id],
        ["AsilPOS günü silindi", "7 Kasım 2026 · Z 127 · 1 satır", users.admin.id],
      ],
    );
  });
});
