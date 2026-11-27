// AsilPOS gün sonunun Faz 2 alanları, gerçek Postgres'te (23 Kasım 2026; docs/ASILPOS.md › Faz 2 alanları; saf kısım
// tests/asilpos-gun-alanlari.test.ts). Altın gövde (tests/fixtures/asilpos-gun.golden.json) imzalı uçtan yazılır:
// - satırın listesi (brüt) ve eki pos_daily_sales'e, yazarkasadan geçmeyen, iadeler, iptaller, düzeltme ve gönderim sırası
//   pos_day_reports'a yazılır; kabul edilen her gövde sürüm geçmişine (pos_day_revisions) bir satır
// - reddedilen gövde (409 z_conflict, 409 wrong_branch, 400) geçmişe yazılmaz; eski AsilPOS'un gövdesi de geçmişe girer
// - günü silmek (z_conflict'in çözümü) geçmişi silmez
//
// Test kendi geçici veritabanını açar (ASILPOS_GUN_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda
// siler. ASILPOS_GUN_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: ASILPOS_GUN_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/asilpos-gun-alanlari-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { signedHeaders } from "../src/lib/karaoke/signature";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { ASILPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.ASILPOS_GUN_TEST_DATABASE_URL;
const DB_NAME = `laffogato_asilpos_gun_${process.pid}`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const GUN = new URL("https://ladmin.laffogato.net/api/pos/gun");
/** Altın gövdenin günü 26 Ekim 2026; "şimdi" ondan sonra */
const NOW = new Date("2026-10-28T12:00:00+03:00");
const DATE = "2026-10-26";

const golden = () => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/asilpos-gun.golden.json"), "utf8")) as Record<string, unknown> & { z: Record<string, unknown>; lines: Record<string, unknown>[] };

describe("AsilPOS Faz 2 alanları: veritabanında", { skip: !SERVER_URL && "ASILPOS_GUN_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let ingest: typeof import("../src/server/asilpos/ingest");
  let asilposAdmin: typeof import("../src/server/asilpos/admin");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    process.env.DATABASE_URL = url.href;
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    ingest = await import("../src/server/asilpos/ingest");
    asilposAdmin = await import("../src/server/asilpos/admin");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const send = (body: unknown) => {
    const raw = JSON.stringify(body);
    const h = signedHeaders(SECRET, "POST", GUN, raw, NOW.getTime());
    return ingest.receivePosDay(db, { branchId: "marina", secret: SECRET, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, NOW);
  };
  const report = async (date = DATE) => {
    const [r] = await db.select().from(s.posDayReports).where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, ASILPOS_SUBE)));
    return r;
  };
  const revisions = (date = DATE) => db.select().from(s.posDayRevisions).where(eq(s.posDayRevisions.date, date)).orderBy(asc(s.posDayRevisions.id));

  test("altın gövde: brüt ve ek satıra, yazarkasadan geçmeyen, iadeler, iptaller, düzeltme ve sıra güne yazılır; geçmişe bir satır", async () => {
    const res = await send(golden());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const lines = await db
      .select({ posName: s.posDailySales.posName, revenue: s.posDailySales.revenue, gross: s.posDailySales.gross, isAddon: s.posDailySales.isAddon })
      .from(s.posDailySales)
      .where(eq(s.posDailySales.date, DATE))
      .orderBy(asc(s.posDailySales.posName));
    assert.equal(lines.length, 16);
    assert.deepEqual(
      lines.find((l) => l.posName === "CAPPUCCİNO MEDIUM"),
      { posName: "CAPPUCCİNO MEDIUM", revenue: 175.5, gross: 195, isAddon: false },
    );
    assert.deepEqual(
      lines.filter((l) => l.isAddon).map((l) => l.posName),
      ["ALTERNATIF SÜT", "EXTRA SHOT", "SYRUP"],
    );
    const r = await report();
    assert.ok(r, "günün özeti");
    assert.equal(r.revision, 1);
    assert.deepEqual(r.correction, { kind: "reopen", reason: "Geç gelen masa" });
    assert.deepEqual(r.offDevice, { card: 1509, cash: 465, cardTips: 25 });
    assert.equal(r.refunds?.length, 2);
    assert.equal(r.iptal?.length, 4);
    assert.equal(r.z.okcZNo, "1");
    assert.deepEqual(r.z.vat?.map((v) => v.rate), [10, 20]);
    assert.equal(r.bankPos?.errorCode, "5085");
    const hist = await revisions();
    assert.equal(hist.length, 1);
    assert.deepEqual([hist[0].branchId, hist[0].revision, hist[0].zNo], [ASILPOS_SUBE, 1, 1]);
    assert.deepEqual(hist[0].correction, { kind: "reopen", reason: "Geç gelen masa" });
    assert.equal((hist[0].body as { iptal?: unknown[] }).iptal?.length, 4, "gövdenin okunmuş hâli");
  });

  test("ikinci gönderim (Pavo sonucu, düzeltmesiz): gün yenilenir, düzeltme kalır, geçmişe ikinci satır", async () => {
    const b = golden();
    delete b.correction;
    b.revision = 2;
    (b.z as Record<string, unknown>).countedCash = 1840;
    const res = await send(b);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = await report();
    assert.equal(r?.revision, 2);
    assert.deepEqual(r?.correction, { kind: "reopen", reason: "Geç gelen masa" }, "düzeltme yalnız ilk gövdeyle gelir: sonraki gönderim silmez");
    assert.equal(r?.z.countedCash, 1840);
    const hist = await revisions();
    assert.deepEqual(
      hist.map((h) => [h.revision, h.correction === null]),
      [
        [1, false],
        [2, true],
      ],
    );
  });

  test("eski AsilPOS'un gövdesi (Faz 2 alanları yok): yazılır, alanlar boş, geçmişe girer", async () => {
    const b = golden();
    for (const k of ["revision", "correction", "offDevice", "refunds", "iptal"]) delete b[k];
    for (const l of b.lines) for (const k of ["gross", "isAddon"]) delete l[k];
    b.date = "2026-10-27";
    const res = await send(b);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = await report("2026-10-27");
    assert.deepEqual([r?.revision, r?.correction, r?.offDevice, r?.refunds, r?.iptal], [null, null, null, null, null]);
    const [l] = await db.select({ gross: s.posDailySales.gross, isAddon: s.posDailySales.isAddon }).from(s.posDailySales).where(eq(s.posDailySales.date, "2026-10-27")).limit(1);
    assert.deepEqual(l, { gross: null, isAddon: false });
    const hist = await revisions("2026-10-27");
    assert.deepEqual(hist.map((h) => h.revision), [null]);
  });

  test("reddedilen gövde geçmişe yazılmaz: başka Z (409), başka şube (409), bozuk (400)", async () => {
    const before = (await revisions()).length;
    const other = golden();
    (other.z as Record<string, unknown>).zNo = 2;
    assert.equal((await send(other)).status, 409);
    const branch = golden();
    branch.sube = "tuzla";
    assert.equal((await send(branch)).status, 409);
    const bad = golden();
    (bad.z as Record<string, unknown>).zTotal = -1;
    assert.equal((await send(bad)).status, 400);
    assert.equal((await revisions()).length, before);
  });

  test("günü silmek (409'un çözümü) geçmişi silmez: yeni Z'nin gövdesi de aynı güne eklenir", async () => {
    const me = { id: 1, name: "Yönetici", role: "admin" as const };
    await asilposAdmin.removeAsilposDay(db, me, "marina", DATE, 1, NOW);
    assert.equal(await report(), undefined);
    assert.equal((await revisions()).length, 2, "geçmiş kalır");
    const other = golden();
    (other.z as Record<string, unknown>).zNo = 2;
    assert.equal((await send(other)).status, 200);
    assert.deepEqual(
      (await revisions()).map((h) => h.zNo),
      [1, 1, 2],
    );
  });
});
