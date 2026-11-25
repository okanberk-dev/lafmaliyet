// LafPOS'un şubesi kütükten (şube kapsamı B6; docs/LAFPOS.md › Şubeler), gerçek Postgres'te:
// - bugünkü veri: kütükte Marina'nın kasa kaynağı ModPOS'ken de LafPOS'un şubesi Marina (geri düşüş); LafPOS'a
//   geçirilince yine Marina;
// - kasa kaynağı başka şubeye (Tuzla) geçince okuyucu önbellekten eskisini en çok süresi kadar verir, şube eylemi
//   önbelleği hemen düşürür;
// - Tuzla LafPOS'tayken gün sonu Tuzla'ya yazılır, Marina'ya ayarlı kasa 409 alır, geçiş günü yalnız Tuzla'nın kasasının;
// - ikinci şube LafPOS'a geçirilemez (geri düşüşle tutan Marina LafPOS'u kullanıyorsa da); zaten LafPOS olan şubenin
//   adı düzenlenebilir; yalnız yönetici.
//
// LAFPOS_SUBE_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/postgres). Test o
// sunucuda kendi geçici veritabanını (lm_lafpos_sube_<pid>) açar, sonunda siler.
// Çalıştırma: LAFPOS_SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-sube-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { signedHeaders } from "../src/lib/karaoke/signature";
import { LAFPOS_SWITCH_KEY } from "../src/lib/lafpos/switch";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.LAFPOS_SUBE_TEST_DATABASE_URL;
const DB_NAME = `lm_lafpos_sube_${process.pid}`;
const SECRET = "lafpos-sube-testi-0123456789-abcdefghij";
const GUN = new URL("https://ladmin.laffogato.net/api/pos/gun");
const NOW = new Date("2029-06-20T12:00:00+03:00");
const SWITCH = "2029-06-01";
const D = "2029-06-10";

describe("LafPOS'un şubesi kütükten: veritabanında", { skip: !SERVER_URL && "LAFPOS_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let me = { id: 0, name: "Ali", role: "admin" as "admin" | "staff", branchId: null as string | null };
  let branch: typeof import("../src/server/lafpos/branch");

  const body = (sube?: string) => ({
    version: 1,
    source: "lafpos",
    date: D,
    ...(sube ? { sube } : {}),
    z: {
      zNo: 41,
      receipts: 12,
      zTotal: 2400,
      cash: 900,
      card: 1500,
      mealCard: 0,
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
    lines: [{ posName: "LATTE", siteMenuId: null, slot: null, qty: 2, revenue: 400, isService: false }],
    ikram: [],
    payments: [],
  });
  const send = async (b: unknown) => {
    const raw = JSON.stringify(b);
    const h = signedHeaders(SECRET, "POST", GUN, raw, NOW.getTime());
    const { receivePosDay } = await import("../src/server/lafpos/ingest");
    return receivePosDay(db, { secret: SECRET, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, NOW);
  };
  const setSource = (id: string, posSource: "modpos" | "lafpos") => db.update(s.branches).set({ posSource }).where(eq(s.branches.id, id));

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "lafpos-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    // Tohum: Marina'nın kasa kaynağı ModPOS (bugünkü kurulumun olası hâli: föyün yedek çekimi için)
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    await db.insert(s.settings).values({ key: LAFPOS_SWITCH_KEY, value: SWITCH }).onConflictDoNothing();
    const [u] = await db.insert(s.users).values({ email: "ali@test.local", name: "Ali", passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    me = { ...me, id: u.id };
    branch = await import("../src/server/lafpos/branch");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("bugünkü veri: Marina'nın kaynağı ModPOS'ken de LafPOS'un şubesi Marina; LafPOS'a geçince yine Marina", async () => {
    branch.forgetLafposBranch();
    assert.equal(await branch.lafposBranchId(db), "marina", "kütükte LafPOS kasalı şube yok: geri düşüş");
    assert.equal(await branch.loadBranchSwitchDay("marina", db), SWITCH);
    assert.equal(await branch.loadBranchSwitchDay("tuzla", db), null, "Tuzla ModPOS'ta");
    assert.equal(await branch.loadBranchSwitchDay(null, db), null, "şubesiz eski kayıt Tuzla'nın");
    await setSource("marina", "lafpos");
    branch.forgetLafposBranch();
    assert.equal(await branch.lafposBranchId(db), "marina");
  });

  test("kasa kaynağı Tuzla'ya geçince: önbellek süresi kadar eskisi, sonra yenisi; forgetLafposBranch hemen düşürür", async () => {
    const t0 = Date.now();
    branch.forgetLafposBranch();
    assert.equal(await branch.lafposBranchId(db, t0), "marina");
    await setSource("marina", "modpos");
    await setSource("tuzla", "lafpos");
    assert.equal(await branch.lafposBranchId(db, t0 + 1_000), "marina", "önbellekten");
    assert.equal(await branch.lafposBranchId(db, t0 + branch.LAFPOS_BRANCH_CACHE_MS + 1), "tuzla", "süre dolunca kütükten");
    await setSource("tuzla", "modpos");
    assert.equal(await branch.lafposBranchId(db, t0 + branch.LAFPOS_BRANCH_CACHE_MS + 2), "tuzla", "yeni önbellek");
    branch.forgetLafposBranch();
    assert.equal(await branch.lafposBranchId(db), "marina", "kütükte LafPOS kasalı şube yok: geri düşüş");
  });

  test("Marina geri düşüşle LafPOS'un şubesi (kütükte ModPOS) ve geçiş günü var: Tuzla da yeni şube de LafPOS yapılamaz", async () => {
    const actions = await import("../src/server/actions/branches");
    branch.forgetLafposBranch();
    assert.equal(await branch.lafposBranchId(db), "marina");
    assert.equal(await branch.lafposInUse("marina", db), true, "eski kaydın geçiş günü Marina'nın");
    const base = { kind: "fiziksel" as const, openedOn: null, active: true };
    const tuzla = await actions.updateBranch({ ...base, id: "tuzla", name: "Tuzla", posSource: "lafpos" });
    assert.ok(!tuzla.ok && /LafPOS günleri Marina şubesine yazılıyor/.test(tuzla.error), tuzla.ok ? "kabul edildi" : tuzla.error);
    const created = await actions.createBranch({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "lafpos", openedOn: null });
    assert.ok(!created.ok && /Marina/.test(created.error), created.ok ? "kabul edildi" : created.error);
    branch.forgetLafposBranch();
    assert.equal(await branch.lafposBranchId(db), "marina", "LafPOS'un şubesi yerinde");
    assert.equal(await branch.loadBranchSwitchDay("marina", db), SWITCH, "Marina'nın geçiş günü yerinde");
    // Marina'nın kendisi LafPOS yapılabilir (açık sahip olur), sonra geri alınır
    const marina = await actions.updateBranch({ ...base, id: "marina", name: "Marina", posSource: "lafpos" });
    assert.ok(marina.ok, marina.ok ? "" : marina.error);
    assert.ok((await actions.updateBranch({ ...base, id: "marina", name: "Marina", posSource: "modpos" })).ok);
    // Panelde anahtar saklama Marina'nın sayfasında (kaynağı ModPOS olsa da LafPOS'un şubesi): sunucu da Marina'yı kabul eder
    assert.equal(await branch.lafposBranchId(db), "marina");
  });

  test("Tuzla LafPOS'tayken: gün sonu Tuzla'ya yazılır, Marina'ya ayarlı kasa 409 alır; geçiş günü yalnız Tuzla'nın", async () => {
    await setSource("tuzla", "lafpos");
    branch.forgetLafposBranch();
    const wrong = await send(body("marina"));
    assert.equal(wrong.status, 409);
    assert.deepEqual(wrong.body, { error: "wrong_branch", sube: "marina", expected: "tuzla" });
    assert.equal((await db.select().from(s.posDayReports)).length, 0, "reddedilen gün yazılmaz");
    const ok = await send(body("tuzla"));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const rows = await db.select({ branchId: s.posDayReports.branchId, date: s.posDayReports.date }).from(s.posDayReports);
    assert.deepEqual(rows, [{ branchId: "tuzla", date: D }]);
    const lines = await db.select({ branchId: s.posDailySales.branchId }).from(s.posDailySales);
    assert.deepEqual(lines, [{ branchId: "tuzla" }], "satırlar da Tuzla'nın");
    // Eski kasa şube göndermez: kütüğün şubesine yazılır
    const old = await send({ ...body(), z: { ...body().z } });
    assert.equal(old.status, 200);
    // Geçiş günü LafPOS'un şubesinin şube ayarı (grup pos.lafpos; eski kayıt Marina'nın): Marina'nın günü Tuzla'ya geçmez,
    // Tuzla kendi gününü Ayarlar › LafPOS'tan alır (docs/SUBE.md › Şube başına ayarlar)
    assert.equal(await branch.loadBranchSwitchDay("tuzla", db), null, "Marina'nın günü Tuzla'ya geçmez");
    const { writeLafposSwitchDay } = await import("../src/server/lafpos/admin");
    assert.ok(await writeLafposSwitchDay(db, { id: me.id, name: me.name, role: "admin" }, SWITCH, D), "Tuzla'nın günü yazılır");
    assert.equal(await branch.loadBranchSwitchDay("tuzla", db), SWITCH);
    assert.equal(await branch.loadBranchSwitchDay("marina", db), null, "Marina artık ModPOS günü");
    const { loadKasaLafpos } = await import("../src/server/data/lafpos-day");
    assert.equal((await loadKasaLafpos(D, db, "tuzla")).lafpos, true);
    assert.equal((await loadKasaLafpos(D, db, "marina")).lafpos, false);
    const { loadLafposCard } = await import("../src/server/lafpos/status");
    const card = await loadLafposCard(db, NOW);
    assert.equal(card.branchId, "tuzla");
    assert.deepEqual(
      card.days.map((d) => d.date),
      [D],
      "kart LafPOS'un şubesinin günlerini sayar",
    );
  });

  test("şube eylemi: ikinci şube LafPOS'a geçirilemez; LafPOS'taki şubenin adı düzenlenir; önbellek eylemle düşer", async () => {
    const actions = await import("../src/server/actions/branches");
    const base = { kind: "fiziksel" as const, openedOn: null, active: true };
    // Tuzla LafPOS'ta (önceki test); Marina'yı da LafPOS yapmak reddedilir
    const refused = await actions.updateBranch({ ...base, id: "marina", name: "Marina", posSource: "lafpos" });
    assert.ok(!refused.ok && /yalnız bir şubenin kasası/.test(refused.error), refused.ok ? "" : refused.error);
    const created = await actions.createBranch({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "lafpos", openedOn: null });
    assert.ok(!created.ok && /Tuzla şubesinin kasası zaten LafPOS/.test(created.error), created.ok ? "" : created.error);
    const renamed = await actions.updateBranch({ ...base, id: "tuzla", name: "Tuzla", posSource: "lafpos" });
    assert.ok(renamed.ok, renamed.ok ? "" : renamed.error);
    // Önbelleği dolu tut, sonra eylemle değiştir: elle düşürmeden yeni değer
    assert.equal(await branch.lafposBranchId(db), "tuzla");
    const back = await actions.updateBranch({ ...base, id: "tuzla", name: "Tuzla", posSource: "modpos" });
    assert.ok(back.ok, back.ok ? "" : back.error);
    const marina = await actions.updateBranch({ ...base, id: "marina", name: "Marina", posSource: "lafpos" });
    assert.ok(marina.ok, marina.ok ? "" : marina.error);
    assert.equal(await branch.lafposBranchId(db), "marina", "eylem önbelleği düşürdü");
    me = { ...me, role: "staff" };
    try {
      const staff = await actions.updateBranch({ ...base, id: "tuzla", name: "Tuzla", posSource: "lafpos" });
      assert.ok(!staff.ok, "personel şubeyi değiştiremez");
    } finally {
      me = { ...me, role: "admin" };
    }
  });
});
