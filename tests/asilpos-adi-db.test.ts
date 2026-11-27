// Ad değişikliğinin uyumu gerçek Postgres'te (26 Kasım 2026; plan A1, migration 0098): saklanan değerler eski adla
// yazılır, okunurken yenisi döner; eski adlı tablo görünümleri canlıdaki eski sürümün yazdığı biçimlerle çalışır;
// tetikleyiciler eski ve yeni sütunu eşit tutar; okuyanlar yeni adlı kaydı (temizlik PR'ından sonra) önce okur.
//
// Kendi geçici şubesini açar, sonunda siler. ASILPOS_ADI_TEST_DATABASE_URL verilmezse atlanır (migration'ları
// uygulanmış yerel veritabanı).
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/laffogato_test npm run test:db -- tests/asilpos-adi-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

import { DURUM_ANAHTARI, ESKI_KASA_KAYNAGI, ESKI_SUTUNLAR, ESKI_TABLOLAR, KASA_YAZARI, OTOMATIK_YAZAR, SUBE_AYAR_GRUBU } from "../src/lib/asilpos/eski-adlar";
import { ASILPOS_AUTO_BY } from "../src/lib/asilpos/gun-sonu";
import { ASILPOS_CASH_OUT_BY } from "../src/lib/asilpos/cash-moves";
import { ASILPOS_GROUP } from "../src/lib/branch-settings/groups";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL = process.env.ASILPOS_ADI_TEST_DATABASE_URL;

describe("AsilPOS ad değişikliği: veritabanında", { skip: !URL && "ASILPOS_ADI_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  const branchId = `adi-${tag}`.slice(0, 24);
  const raw = <T>(q: ReturnType<typeof sql>) => db.execute(q) as unknown as Promise<T[]>;

  before(async () => {
    process.env.DATABASE_URL = URL;
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 2);
    await db.insert(s.branches).values({ id: branchId, name: `Ad ${tag}`, kind: "fiziksel", posSource: "asilpos", active: false, sortOrder: 999 });
  });

  after(async () => {
    if (!db) return;
    await db.delete(s.cashOuts).where(eq(s.cashOuts.branchId, branchId));
    await db.delete(s.posDailySales).where(eq(s.posDailySales.branchId, branchId));
    await db.delete(s.asilposDayEnds).where(eq(s.asilposDayEnds.branchId, branchId));
    await db.delete(s.branchSettings).where(eq(s.branchSettings.branchId, branchId));
    await db.delete(s.branches).where(eq(s.branches.id, branchId));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("kasa kaynağı: eski değer yazılır, yeni değer okunur; karşılaştırma da çevrilir; CHECK iki değeri kabul eder", async () => {
    const [{ pos_source }] = await raw<{ pos_source: string }>(sql`select pos_source from branches where id = ${branchId}`);
    assert.equal(pos_source, ESKI_KASA_KAYNAGI, "veritabanında eski değer");
    const [row] = await db.select({ posSource: s.branches.posSource }).from(s.branches).where(eq(s.branches.id, branchId));
    assert.equal(row.posSource, "asilpos");
    const found = await db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.posSource, "asilpos"));
    assert.ok(found.some((b) => b.id === branchId), "eq yeni değerle bulur");
    // Temizlik PR'ından (ya da yeni bir yazandan) gelen yeni değer de okunur
    await db.execute(sql`update branches set pos_source = 'asilpos' where id = ${branchId}`);
    assert.equal((await db.select({ posSource: s.branches.posSource }).from(s.branches).where(eq(s.branches.id, branchId)))[0].posSource, "asilpos");
    await assert.rejects(db.execute(sql`update branches set pos_source = 'baska' where id = ${branchId}`), (e: unknown) =>
      /branches_pos_source_ck/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)),
    );
  });

  test("yazar adları: kasanın satırı eski adla yazılır, ekranda yeni ad", async () => {
    await db.insert(s.cashOuts).values({ date: "2026-11-27", branchId, amount: 10, createdByName: ASILPOS_CASH_OUT_BY, asilposId: `01AD${tag}` });
    const [{ created_by_name }] = await raw<{ created_by_name: string }>(sql`select created_by_name from cash_outs where branch_id = ${branchId}`);
    assert.equal(created_by_name, KASA_YAZARI);
    const [o] = await db.select({ by: s.cashOuts.createdByName }).from(s.cashOuts).where(eq(s.cashOuts.branchId, branchId));
    assert.equal(o.by, "AsilPOS");
    const found = await db.select({ id: s.cashOuts.id }).from(s.cashOuts).where(eq(s.cashOuts.createdByName, ASILPOS_CASH_OUT_BY));
    assert.ok(found.length >= 1, "eq yeni adla bulur");
    // Otomatik raporun yazarı da (işlem geçmişi)
    const [log] = await db.insert(s.activityLog).values({ userName: ASILPOS_AUTO_BY, action: `ad testi ${tag}` }).returning({ id: s.activityLog.id, userName: s.activityLog.userName });
    assert.equal(log.userName, ASILPOS_AUTO_BY);
    const [{ user_name }] = await raw<{ user_name: string }>(sql`select user_name from activity_log where id = ${log.id}`);
    assert.equal(user_name, OTOMATIK_YAZAR);
    await db.delete(s.activityLog).where(eq(s.activityLog.id, log.id));
  });

  test("kasa hareketi ve hizmet işareti: eski ve yeni sütun eşit (eski sürüm eskisini yazar)", async () => {
    const id = `01OLD${tag}`;
    const eskiId = sql.raw(`"${ESKI_SUTUNLAR.kasaHareketi}"`);
    const eskiHizmet = sql.raw(`"${ESKI_SUTUNLAR.hizmet}"`);
    await db.execute(sql`insert into cash_outs (date, branch_id, amount, created_by_name, ${eskiId}) values ('2026-11-27', ${branchId}, 5, ${KASA_YAZARI}, ${id})`);
    const [byNew] = await db.select({ amount: s.cashOuts.amount }).from(s.cashOuts).where(eq(s.cashOuts.asilposId, id));
    assert.equal(byNew?.amount, 5, "eski sütunla yazılan yeni sütundan bulunur");
    await db.update(s.cashOuts).set({ asilposId: null }).where(eq(s.cashOuts.asilposId, id));
    const pairs = await raw<{ eski: string | null; yeni: string | null }>(sql`select ${eskiId} as eski, asilpos_id as yeni from cash_outs where branch_id = ${branchId} order by id`);
    assert.deepEqual(pairs.map((r) => r.eski === r.yeni), [true, true], "iki sütun her satırda eşit");
    await db.insert(s.posDailySales).values({ date: "2026-11-27", branchId, posName: `ODA ${tag}`, qty: 1, revenue: 10, asilposService: true });
    await db.execute(sql`insert into pos_daily_sales (date, branch_id, pos_name, qty, revenue, ${eskiHizmet}) values ('2026-11-27', ${branchId}, ${`ESKI ${tag}`}, 1, 10, true)`);
    const flags = await raw<{ eski: boolean; yeni: boolean }>(sql`select ${eskiHizmet} as eski, asilpos_service as yeni from pos_daily_sales where branch_id = ${branchId}`);
    assert.deepEqual(flags.map((r) => [r.eski, r.yeni]), [[true, true], [true, true]]);
  });

  test("eski adlı görünüm: eski sürümün drizzle yazımı (DEFAULT, ON CONFLICT, RETURNING) tabloya gider", async () => {
    const t = sql.raw(`"${ESKI_TABLOLAR.gunSonu}"`);
    await db.execute(sql`insert into ${t} ("date", "branch_id", "report_id", "missing", "email_count", "updated_at") values ('2026-11-27', ${branchId}, default, default, default, default) on conflict do nothing`);
    const up = await raw<{ email_count: number }>(
      sql`insert into ${t} ("date", "branch_id", "day_hash") values ('2026-11-27', ${branchId}, 'x') on conflict ("date", "branch_id") do update set "email_count" = ${t}."email_count" + 1 returning "email_count"`,
    );
    assert.equal(up[0].email_count, 1);
    const [row] = await db.select().from(s.asilposDayEnds).where(eq(s.asilposDayEnds.branchId, branchId));
    assert.deepEqual([row.missing, row.emailCount], [[], 1], "varsayılanlar tablodan");
    const kurulum = await raw<{ id: number; downloads: number }>(
      sql`insert into ${sql.raw(`"${ESKI_TABLOLAR.kurulum}"`)} ("id", "branch_id", "email", "token_hash", "token_sealed", "expires_at", "downloads", "created_at") values (default, ${branchId}, 'a@b.c', ${`h-${tag}`}, 's', now(), default, default) returning "id", "downloads"`,
    );
    assert.ok(kurulum[0].id > 0, "sayaç tablonunki");
    assert.equal((await db.select().from(s.asilposInstalls).where(eq(s.asilposInstalls.branchId, branchId))).length, 1);
    await db.delete(s.asilposInstalls).where(eq(s.asilposInstalls.branchId, branchId));
  });

  test("okuyanlar yeni adlı kaydı önce okur: durum satırı ve şube ayarı (yazılan eski ad)", async () => {
    assert.equal(ASILPOS_GROUP.id, SUBE_AYAR_GRUBU);
    const { resolveBranchSetting } = await import("../src/server/branch-settings");
    await db.insert(s.branchSettings).values({ branchId, grp: SUBE_AYAR_GRUBU, value: { switchDay: "2026-11-20" }, updatedBy: "test" });
    assert.equal((await resolveBranchSetting(ASILPOS_GROUP, branchId, db)).value.switchDay, "2026-11-20");
    await db.insert(s.branchSettings).values({ branchId, grp: "pos.asilpos", value: { switchDay: "2026-11-22" }, updatedBy: "test" });
    assert.equal((await resolveBranchSetting(ASILPOS_GROUP, branchId, db)).value.switchDay, "2026-11-22", "yeni adlı satır önce");
    await db.delete(s.branchSettings).where(eq(s.branchSettings.branchId, branchId));

    const status = await import("../src/server/asilpos/status");
    const keep = await db.select().from(s.integrationState).where(inArray(s.integrationState.key, [DURUM_ANAHTARI, "asilpos"]));
    try {
      await db.delete(s.integrationState).where(inArray(s.integrationState.key, [DURUM_ANAHTARI, "asilpos"]));
      await db.insert(s.integrationState).values({ key: DURUM_ANAHTARI, value: { lastOk: { at: "2026-11-27T00:00:00.000Z", date: "2026-11-26", zNo: 1, lines: 0, counted: true } } });
      assert.equal((await status.readAsilposState(db)).lastOk?.date, "2026-11-26", "eski adlı satır");
      await db.insert(s.integrationState).values({ key: "asilpos", value: { lastOk: { at: "2026-11-27T00:00:00.000Z", date: "2026-11-27", zNo: 2, lines: 0, counted: true } } });
      assert.equal((await status.readAsilposState(db)).lastOk?.date, "2026-11-27", "yeni adlı satır önce");
    } finally {
      await db.delete(s.integrationState).where(inArray(s.integrationState.key, [DURUM_ANAHTARI, "asilpos"]));
      if (keep.length) await db.insert(s.integrationState).values(keep);
    }
  });
});
