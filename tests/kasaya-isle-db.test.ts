// Kasaya işle işaretleri (dalga 10 §2.2; src/server/prices/pos-marks.ts), gerçek Postgres'te: personelin işareti tek
// satır yazar, eşzamanlı iki işaretten biri "zaten" olur, bu arada fiyatı değişen işaretlenmez, başkasının işaretini
// personel geri alamaz, yöneticinin geri alması saklanan bayat fiyatı ve anı yazar (istemciden fiyat alınmaz), sonra
// yeniden işaretlenen ürünün eski işareti geri alınmaz, pasif ürün personelde reddedilir. Kendi kullanıcılarını,
// kategorisini ve ürünlerini açar, sonunda siler.
//
// POS_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: POS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/kasaya-isle-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { POS_UNDO_TEXT } from "../src/lib/prices/pos";
import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { markPos, undoPos } from "../src/server/prices/pos-marks";
import { UserError } from "../src/server/user-error";

const URL = process.env.POS_TEST_DATABASE_URL;
const NOW = new Date("2026-10-22T11:00:00Z");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);

describe("Kasaya işle: işaret ve geri alma", { skip: !URL && "POS_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  const users = { admin: { id: 0, name: "Yönetici", role: "admin" as const }, ayse: { id: 0, name: "Ayşe", role: "staff" as const }, mehmet: { id: 0, name: "Mehmet", role: "staff" as const } };
  let categoryId = 0;
  const ids: number[] = [];
  const since = new Date("2026-10-20T07:00:00Z");

  async function product(name: string, o: { price?: number; stale?: number | null; active?: boolean } = {}): Promise<number> {
    const [row] = await db
      .insert(s.products)
      .values({ categoryId, name: `${name} ${tag}`, size: "M", price: o.price ?? 205, active: o.active ?? true, posStalePrice: o.stale === undefined ? 195 : o.stale, posStaleSince: o.stale === null ? null : since })
      .returning({ id: s.products.id });
    ids.push(row.id);
    return row.id;
  }
  const productRow = async (id: number) => (await db.select().from(s.products).where(eq(s.products.id, id)))[0];
  const marksOf = (id: number) => db.select().from(s.posMarks).where(eq(s.posMarks.productId, id));
  const refused = async (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: unknown) => e instanceof UserError && re.test(e.message));

  before(async () => {
    db = createDb(URL!, 6);
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db.insert(s.users).values({ email: `pos-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    const [c] = await db.insert(s.categories).values({ name: `Kasaya işle ${tag}`, sortOrder: 99 }).returning({ id: s.categories.id });
    categoryId = c.id;
  });

  after(async () => {
    if (!db) return;
    if (ids.length) await db.delete(s.products).where(inArray(s.products.id, ids));
    if (categoryId) await db.delete(s.categories).where(eq(s.categories.id, categoryId));
    const uids = Object.values(users).map((u) => u.id).filter(Boolean);
    if (uids.length) await db.delete(s.users).where(inArray(s.users.id, uids));
    await db.$client.end();
  });

  test("personelin işareti tek satır yazar, ürünü listeden düşürür; bayat fiyat işaretlenmez", async () => {
    const latte = await product("Latte");
    const r = await markPos(db, users.ayse, [{ productId: latte, price: 205 }], NOW);
    assert.equal(r.done.length, 1);
    assert.deepEqual(r.already, []);
    assert.deepEqual(r.changed, []);
    const p = await productRow(latte);
    assert.equal(p.posStalePrice, null);
    assert.equal(p.posStaleSince, null);
    const marks = await marksOf(latte);
    assert.equal(marks.length, 1);
    assert.equal(marks[0].id, r.done[0].markId);
    assert.equal(marks[0].price, 205);
    assert.equal(marks[0].stalePrice, 195);
    assert.equal(marks[0].staleSince.toISOString(), since.toISOString());
    assert.equal(marks[0].markedBy, users.ayse.id);
    assert.equal(marks[0].markedByName, "Ayşe");
    // Liste açıldıktan sonra fiyatı değişen işaretlenmez, bugünkü fiyatıyla döner
    const mocha = await product("Mocha", { price: 230 });
    const changed = await markPos(db, users.ayse, [{ productId: mocha, price: 220 }], NOW);
    assert.deepEqual(changed.done, []);
    assert.equal(changed.changed[0].price, 230);
    assert.equal((await productRow(mocha)).posStalePrice, 195);
    assert.equal((await marksOf(mocha)).length, 0);
    // Personel tek tek işaretler
    await refused(markPos(db, users.ayse, [{ productId: latte, price: 205 }, { productId: mocha, price: 230 }], NOW), /tek tek/);
  });

  test("eşzamanlı iki işaretten biri 'zaten' olur; zaten yalnız kimlik taşır", async () => {
    const cortado = await product("Cortado");
    const [a, b] = await Promise.all([markPos(db, users.ayse, [{ productId: cortado, price: 205 }], NOW), markPos(db, users.mehmet, [{ productId: cortado, price: 205 }], NOW)]);
    assert.equal(a.done.length + b.done.length, 1);
    assert.deepEqual([...a.already, ...b.already], [cortado]);
    assert.equal((await marksOf(cortado)).length, 1);
  });

  test("geri alma: personel başkasınınkini ve 30 dakikadan sonrakini alamaz; yönetici saklanan değerleri yazar", async () => {
    const tea = await product("Lemon Tea");
    const [m] = (await markPos(db, users.ayse, [{ productId: tea, price: 205 }], NOW)).done;
    const other = await undoPos(db, users.mehmet, [m.markId], later(1));
    assert.deepEqual(other.undone, []);
    assert.equal(other.refused[0].reason, POS_UNDO_TEXT.notMine);
    const late = await undoPos(db, users.ayse, [m.markId], later(31));
    assert.equal(late.refused[0].reason, POS_UNDO_TEXT.late);
    assert.equal((await productRow(tea)).posStalePrice, null);
    // Yönetici: saklanan bayat fiyat ve an geri yazılır
    const r = await undoPos(db, users.admin, [m.markId], later(60 * 24));
    assert.equal(r.undone.length, 1);
    assert.equal(r.undone[0].by, "Ayşe");
    const p = await productRow(tea);
    assert.equal(p.posStalePrice, 195);
    assert.equal(p.posStaleSince?.toISOString(), since.toISOString());
    const [mark] = await marksOf(tea);
    assert.ok(mark.undoneAt);
    assert.equal(mark.undoneByName, "Yönetici");
    // İkinci geri alma: zaten
    assert.equal((await undoPos(db, users.admin, [m.markId], later(60 * 24))).refused[0].reason, POS_UNDO_TEXT.undone);
    // Personel kendi işaretini 30 dakika içinde geri alır
    const [m2] = (await markPos(db, users.ayse, [{ productId: tea, price: 205 }], later(60 * 25))).done;
    const own = await undoPos(db, users.ayse, [m2.markId], later(60 * 25 + 5));
    assert.equal(own.undone.length, 1);
    assert.equal((await productRow(tea)).posStalePrice, 195);
  });

  test("M1 → fiyat değişti → M2: M1 geri alınmaz (son işareti geri alın); listeye yeniden giren ürün geri alınmaz", async () => {
    const flat = await product("Flat White");
    const [m1] = (await markPos(db, users.admin, [{ productId: flat, price: 205 }], NOW)).done;
    // Fiyat değişti (panel): kasa 205'te kaldı, ürün listeye yeniden girdi
    await db.update(s.products).set({ price: 215, posStalePrice: 205, posStaleSince: later(10) }).where(eq(s.products.id, flat));
    assert.equal((await undoPos(db, users.admin, [m1.markId], later(11))).refused[0].reason, POS_UNDO_TEXT.relisted);
    const [m2] = (await markPos(db, users.admin, [{ productId: flat, price: 215 }], later(12))).done;
    const r = await undoPos(db, users.admin, [m1.markId], later(13));
    assert.equal(r.refused[0].reason, POS_UNDO_TEXT.notLatest);
    // Son işaret geri alınır: kasada 205 duruyordu
    assert.equal((await undoPos(db, users.admin, [m2.markId], later(14))).undone.length, 1);
    const p = await productRow(flat);
    assert.equal(p.posStalePrice, 205);
    assert.equal(p.posStaleSince?.toISOString(), later(10).toISOString());
  });

  test("pasif ürün ve bilinmeyen kimlik personelde reddedilir; yönetici pasif ürünü işaretleyebilir", async () => {
    const old = await product("Eski Ürün", { active: false });
    await refused(markPos(db, users.ayse, [{ productId: old, price: 205 }], NOW), /listesinde değil/);
    assert.equal((await productRow(old)).posStalePrice, 195);
    await refused(markPos(db, users.ayse, [{ productId: 999_999_999, price: 205 }], NOW), /bulunamadı/);
    const r = await markPos(db, users.admin, [{ productId: old, price: 205 }], NOW);
    assert.equal(r.done.length, 1);
    // Listede olmayan (zaten işlenmiş) ürün "zaten"
    const fresh = await product("Güncel", { stale: null });
    assert.deepEqual((await markPos(db, users.ayse, [{ productId: fresh, price: 205 }], NOW)).already, [fresh]);
  });
});
