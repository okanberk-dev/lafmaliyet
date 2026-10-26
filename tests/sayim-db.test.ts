// Stok sayımının eylemleri gerçek Postgres'te, oturum ve next/cache taklit edilerek (src/server/actions/stock.ts,
// src/app/panel/sayim/actions.ts): denetim 26 Eki 2026 B01. Personel geçen ayın sayımını yalnız ayın ilk 10 gününde
// değiştirir (E-19); sonrasında sayım da ek kalemler de reddedilir, yönetici her zaman yazar.
//
// SAYIM_TEST_DATABASE_URL (yoksa EKLE_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SAYIM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sayim-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { extrasBase, STAFF_LATE_FIX_MESSAGE } from "../src/app/panel/sayim/logic";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SAYIM_TEST_DATABASE_URL ?? process.env.EKLE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sayim_${process.pid}`;

describe("stok sayımı eylemleri: veritabanında", { skip: !SERVER_URL && "SAYIM_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let stock: typeof import("../src/server/actions/stock");
  let extras: typeof import("../src/app/panel/sayim/actions");
  let EXTRAS_CHANGED_MESSAGE = "";
  const who: { role: "admin" | "staff" } = { role: "admin" };
  let users: { admin: typeof s.users.$inferSelect; staff: typeof s.users.$inferSelect };
  let milk = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sayim-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum ve sayfa yenileme taklit edilir
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
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const [p] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe", passwordHash: "x", role: "staff" }).returning();
    users = { admin: a, staff: p };
    const me = async () => ({ ...users[who.role], role: who.role });
    stub(require.resolve("../src/server/auth/dal"), {
      requireUser: me,
      requireAdmin: async () => {
        if (who.role !== "admin") throw new Error("yalnız yönetici");
        return me();
      },
    });
    stock = await import("../src/server/actions/stock");
    extras = await import("../src/app/panel/sayim/actions");
    EXTRAS_CHANGED_MESSAGE = (await import("../src/server/data/stock-extras")).EXTRAS_CHANGED_MESSAGE;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE stock_counts, stock_extras, activity_log RESTART IDENTITY CASCADE`);
    await db.execute(sql`DELETE FROM ingredients`);
    const [ing] = await db
      .insert(s.ingredients)
      .values({ name: "Süt", category: "Süt", unit: "ml", packagePrice: 40, packageSize: 1000, priceSource: "manual", countUnit: "LT", countGroup: "SÜT" })
      .returning({ id: s.ingredients.id });
    milk = ing.id;
    await db.insert(s.months).values({ month: "2026-10" }).onConflictDoNothing();
    await db.insert(s.stockCounts).values({ month: "2026-10", ingredientId: milk, qty: 40, factor: 1000, countedBy: "Ayşe" });
    await db.insert(s.stockExtras).values({ month: "2026-10", name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 12.5 });
  });

  afterEach(() => {
    mock.timers.reset();
    who.role = "admin";
  });

  const milkQty = async () =>
    (await db.select({ qty: s.stockCounts.qty }).from(s.stockCounts).where(and(eq(s.stockCounts.month, "2026-10"), eq(s.stockCounts.ingredientId, milk))))[0]?.qty ?? null;
  const at = (iso: string) => mock.timers.enable({ apis: ["Date"], now: new Date(iso) });

  test("25 Kasım: personel Ekim sayımını değiştiremez, boşaltamaz; ek kalemleri de; yönetici yazar", async () => {
    at("2026-11-25T09:00:00Z");
    who.role = "staff";
    const changed = await stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 4, base: 40 }]);
    assert.deepEqual(changed, { ok: false, error: STAFF_LATE_FIX_MESSAGE });
    const cleared = await stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: null, base: 40 }]);
    assert.equal(cleared.ok, false);
    assert.equal(await milkQty(), 40, "sayım yerinde");
    const ex = await extras.saveStaffStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 0 }]);
    assert.deepEqual(ex, { ok: false, error: STAFF_LATE_FIX_MESSAGE });
    assert.equal((await db.select().from(s.stockExtras).where(eq(s.stockExtras.month, "2026-10")))[0]?.qty, 3);
    // "Listeye ekle" de aynı kapıdan
    const added = await extras.addCountItem({ month: "2026-10", name: "Yulaf sütü", group: "SÜT", countUnit: "LT", packageSize: 1 });
    assert.deepEqual(added, { ok: false, error: STAFF_LATE_FIX_MESSAGE });
    // Bu ay serbest
    assert.equal((await stock.saveStockCounts("2026-11", [{ ingredientId: milk, qty: 12, base: null }])).ok, true);
    // Yönetici geçen ayı her zaman düzeltir
    who.role = "admin";
    assert.deepEqual(await stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 38, base: 40 }]), { ok: true, data: { saved: 1, removed: 0 } });
    assert.equal(await milkQty(), 38);
  });

  test("ek kalemler: eski listeyle kaydeden başkasınınkini silmez; yönetici kaydı kimlikleri korur", async () => {
    at("2026-10-31T19:00:00Z");
    const rows = async () => (await db.select().from(s.stockExtras).where(eq(s.stockExtras.month, "2026-10"))).sort((a, b) => a.id - b.id);
    // Yönetici formu açar (Peçete), personel arada yulaf sütü ekler
    const adminSaw = extrasBase(await rows());
    who.role = "staff";
    const staffSaw = extrasBase(await rows());
    assert.equal((await extras.saveStaffStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 3 }, { name: "DENETIM yulaf sütü", unit: "LT", qty: 2 }], staffSaw)).ok, true);
    // Yönetici eski listeyle Peçete'ye fiyat yazar: yazılmaz, personelin kalemi durur
    who.role = "admin";
    const stale = await stock.saveStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 14 }], adminSaw);
    assert.deepEqual(stale, { ok: false, error: EXTRAS_CHANGED_MESSAGE });
    assert.deepEqual((await rows()).map((r) => [r.name, r.qty, r.unitPrice]), [
      ["Peçete", 3, 12.5],
      ["DENETIM yulaf sütü", 2, 0],
    ]);
    // Yenilenen listeyle: Peçete güncellenir (kimliği kalır), yulaf sütü fiyatlanır, hiçbir satır silinip yeniden yazılmaz
    const before = await rows();
    const fresh = await stock.saveStockExtras(
      "2026-10",
      [
        { name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 14 },
        { name: "DENETIM yulaf sütü", unit: "LT", qty: 2, unitPrice: 55 },
      ],
      extrasBase(before),
    );
    assert.equal(fresh.ok, true);
    const after = await rows();
    assert.deepEqual(after.map((r) => r.id), before.map((r) => r.id));
    assert.deepEqual(after.map((r) => r.unitPrice), [14, 55]);
    // Personel de eski listeyle kaydedemez (yönetici arada değiştirdi)
    who.role = "staff";
    const old = await extras.saveStaffStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 1 }], staffSaw);
    assert.deepEqual(old, { ok: false, error: EXTRAS_CHANGED_MESSAGE });
    // Yalnız yöneticinin kaldırdığı satır silinir
    who.role = "admin";
    assert.equal((await stock.saveStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 14 }], extrasBase(after))).ok, true);
    assert.deepEqual((await rows()).map((r) => r.id), [after[0].id]);
  });

  test("Listeye ekle: aynı adlı ek kalem varsa söylenir (stok iki kez sayılmasın)", async () => {
    at("2026-10-31T19:00:00Z");
    await db.insert(s.stockExtras).values({ month: "2026-10", name: "Klips kapak", unit: "KOLİ", qty: 2, unitPrice: 0 });
    const res = await extras.addCountItem({ month: "2026-10", name: "klips  KAPAK", group: "SÜT", countUnit: "ADET", packageSize: 1 });
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.deepEqual(res.data.extraTwin, { name: "Klips kapak", qty: 2, unit: "KOLİ" });
    const other = await extras.addCountItem({ month: "2026-10", name: "Pipet", group: "SÜT", countUnit: "ADET", packageSize: 1 });
    assert.ok(other.ok && other.data.extraTwin === null);
  });

  test("3 Kasım: personel Ekim sayımını düzeltebilir (ilk 10 gün)", async () => {
    at("2026-11-03T09:00:00Z");
    who.role = "staff";
    assert.deepEqual(await stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 36, base: 40 }]), { ok: true, data: { saved: 1, removed: 0 } });
    assert.equal(await milkQty(), 36);
    const ex = await extras.saveStaffStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 2 }]);
    assert.equal(ex.ok, true);
  });
});
