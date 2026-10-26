// Hızlı sayım ve mal siparişi kaldırıldı (26 Eki 2026, B21), gerçek Postgres'te: üç tablo (quick_counts,
// reorder_items, supplier_orders) veritabanında ve Drizzle şemasında sütun sütun aynı kalır (migration yok, eski veri
// okunur), eski satırlar yerinde durur; hammadde silinince eski hızlı sayım ve sipariş kalemi satırları eskisi gibi
// birlikte gider. Kendi hammaddesini, kullanıcısını ve satırlarını açar, sonunda siler.
//
// KALDIRILAN_TEST_DATABASE_URL (yoksa eski taslak testinin TASLAK_TEST_DATABASE_URL'i: tam test betikleri onu verir)
// verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: KALDIRILAN_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_b21 npx tsx --test tests/hizli-siparis-kaldirildi-db.test.ts

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL = process.env.KALDIRILAN_TEST_DATABASE_URL ?? process.env.TASLAK_TEST_DATABASE_URL;

describe("Kaldırılan hızlı sayım ve mal siparişi: tablolar geçmiş için", { skip: !URL && "KALDIRILAN_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  let userId = 0;
  let ingredientId = 0;
  const orderIds: number[] = [];

  before(async () => {
    db = createDb(URL!, 2);
    const [u] = await db
      .insert(s.users)
      .values({ email: `kaldirilan-${tag}@ornek.com`, name: "Ayşe", passwordHash: "x", role: "staff" })
      .returning({ id: s.users.id });
    userId = u.id;
    const [ing] = await db
      .insert(s.ingredients)
      .values({ name: `Eski sipariş kalemi ${tag}`, category: "Süt ürünleri", unit: "ml", packageSize: 1000, packagePrice: 50 })
      .returning({ id: s.ingredients.id });
    ingredientId = ing.id;
  });

  after(async () => {
    if (!db) return;
    for (const id of orderIds) await db.delete(s.supplierOrders).where(eq(s.supplierOrders.id, id));
    if (ingredientId) await db.delete(s.ingredients).where(eq(s.ingredients.id, ingredientId));
    if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
    await db.$client.end();
  });

  test("üç tablo veritabanında, sütunları Drizzle şemasıyla aynı (migration yok)", async () => {
    for (const table of [s.quickCounts, s.reorderItems, s.supplierOrders] as PgTable[]) {
      const cfg = getTableConfig(table);
      const rows = await db.execute<{ column_name: string }>(
        sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${cfg.name} order by column_name`,
      );
      const inDb = [...rows].map((r) => r.column_name).sort();
      assert.ok(inDb.length > 0, `${cfg.name} veritabanında yok`);
      assert.deepEqual(inDb, cfg.columns.map((c) => c.name).sort(), cfg.name);
    }
    // Eski taslak isteklerinin canlı taslak indeksi de yerinde (silinmedi)
    const idx = await db.execute<{ indexname: string }>(sql`select indexname from pg_indexes where tablename = 'staff_requests' and indexname = 'staff_requests_live_draft_uq'`);
    assert.equal([...idx].length, 1);
  });

  test("eski satırlar okunur ve yazılır (geçmiş için); hammadde silinince eski hızlı sayım ve kalem ayarı birlikte gider", async () => {
    await db.insert(s.reorderItems).values({ ingredientId, parBase: 2000, leadDays: 1, supplier: "Sütaş", updatedBy: "Ali" });
    await db.insert(s.quickCounts).values({ ingredientId, day: "2026-10-19", qty: 1.5, factor: 1000, countedBy: userId, countedByName: "Ayşe" });
    const [order] = await db
      .insert(s.supplierOrders)
      .values({
        requestId: randomUUID(),
        supplier: "Sütaş",
        channel: "kopya",
        message: "Merhaba, siparişimiz: 2 koli süt",
        lines: [{ ingredientId, name: "Süt", qty: 2, unit: "koli" }],
        sentByName: "Ali",
        expectedOn: "2026-10-21",
      })
      .returning({ id: s.supplierOrders.id, lines: s.supplierOrders.lines, status: s.supplierOrders.status });
    orderIds.push(order.id);
    assert.equal(order.status, "open");
    assert.deepEqual(order.lines, [{ ingredientId, name: "Süt", qty: 2, unit: "koli" }]);
    const [qc] = await db.select().from(s.quickCounts).where(eq(s.quickCounts.ingredientId, ingredientId));
    assert.equal(qc.qty, 1.5);
    const [ri] = await db.select().from(s.reorderItems).where(eq(s.reorderItems.ingredientId, ingredientId));
    assert.equal(ri.supplier, "Sütaş");
    // Hammadde silinince (yönetici Hammaddeler'den) eski hızlı sayım ve kalem ayarı birlikte gider (cascade, eskisi
    // gibi); gönderilen siparişin kopyası (jsonb) kalır
    await db.delete(s.ingredients).where(eq(s.ingredients.id, ingredientId));
    ingredientId = 0;
    assert.equal((await db.select().from(s.quickCounts).where(eq(s.quickCounts.ingredientId, qc.ingredientId))).length, 0);
    assert.equal((await db.select().from(s.reorderItems).where(eq(s.reorderItems.ingredientId, ri.ingredientId))).length, 0);
    const [kept] = await db.select({ lines: s.supplierOrders.lines }).from(s.supplierOrders).where(eq(s.supplierOrders.id, order.id));
    assert.equal((kept.lines[0] as { name: string }).name, "Süt");
  });
});
