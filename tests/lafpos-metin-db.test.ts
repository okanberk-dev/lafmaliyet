// Geçiş gününden sonra kasadaki fiyatlar (denetim B11: E-39), gerçek Postgres'te: geçiş günü boşken her şey bugünkü
// gibi (siteye bağlı ürün de kasa listesine girer); geçiş gününden itibaren siteye bağlı ürünün fiyat değişikliği kasa
// listesine girmez (LafPOS fiyatı siteden alır), bağlı olmayanınki girer; listede bekleyen eski işaret hiçbir okuyucuda
// (yönetici özeti ve listesi, personelin özeti ve listesi, ürün kartı, zil) görünmez ama silinmez, geçiş günü kaldırılınca
// geri gelir; iş günü 05:00'te döner (geçiş gününün gecesi hâlâ ModPOS); kapalı gün kartı o günün kasasını söyler.
//
// Ayarlar (geçiş günü) veritabanında tektir: test kendi geçici veritabanını açar (LAFPOS_TEST_DATABASE_URL'in
// sunucusunda), migration'ları uygular, sonunda siler; öteki testlerin verisine dokunmaz.
//
// LAFPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-metin-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { businessDate } from "../src/lib/cash-report";
import { addDays } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_lafpos_metin_${process.pid}`;
/** Testin "şimdi"si: 12 Kasım 2026 öğlen; geçiş günü 10 Kasım */
const NOW = new Date("2026-11-12T12:00:00+03:00");
const S = "2026-11-10";

describe("Kasadaki fiyatlar geçiş gününden sonra: veritabanında", { skip: !SERVER_URL && "LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let record: typeof import("../src/server/prices/record");
  let write: typeof import("../src/server/prices/write");
  let prices: typeof import("../src/server/data/prices");
  let staff: typeof import("../src/server/data/pos-staff");
  let scope: typeof import("../src/server/data/till-scope");
  let bell: typeof import("../src/server/bell/ops");
  let closed: typeof import("../src/server/closed-days");
  let categoryId = 0;
  const users = {
    ali: { id: 0, name: "Ali", role: "admin" as const, email: "lafpos-metin-ali@ornek.com" },
    ayse: { id: 0, name: "Ayşe", role: "staff" as const, email: "lafpos-metin-ayse@ornek.com" },
  };
  /** Ürünler: siteye bağlı Latte M, bağlı olmayan Su (PET), bağlı ve kasada eskiden (ModPOS) bekleyen Mocha M */
  const ids = { linked: 0, local: 0, oldLinked: 0 };
  const OLD_SINCE = new Date("2026-11-05T10:00:00+03:00");

  const setSwitch = async (day: string | null) => {
    await db.delete(s.settings).where(eq(s.settings.key, "lafposGecisGunu"));
    if (day) await db.insert(s.settings).values({ key: "lafposGecisGunu", value: day });
  };
  const product = async (id: number) => (await db.select().from(s.products).where(eq(s.products.id, id)))[0];
  /** Sitenin çekmesi gibi (applyPlan): fiyat yazılır, geçmişe ve kasanın durumuna recordPriceChange */
  const sitePrice = async (id: number, after: number, at: Date) =>
    db.transaction(async (tx) => {
      const [p] = await tx.select({ price: s.products.price }).from(s.products).where(eq(s.products.id, id));
      await tx.update(s.products).set({ price: after }).where(eq(s.products.id, id));
      return record.recordPriceChange(tx, { productId: id, before: p.price, after, source: "site", onSite: true, changedBy: "laffogato.net" }, at);
    });
  /** Bugünden (gerçek saat) önceki bir geçiş günü: zil ve ürün kartı saati kendisi okur */
  const pastSwitch = () => {
    const d = addDays(businessDate(new Date()), -1);
    return d < "2026-10-01" ? "2026-10-01" : d;
  };
  const staffUser = () => ({ id: users.ayse.id, name: users.ayse.name, email: users.ayse.email, role: "staff" as const, active: true });
  const adminUser = () => ({ id: users.ali.id, name: users.ali.name, email: users.ali.email, role: "admin" as const, active: true });

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "lafpos-metin-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    for (const k of ["ali", "ayse"] as const) {
      const [u] = await db.insert(s.users).values({ email: users[k].email, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    record = await import("../src/server/prices/record");
    write = await import("../src/server/prices/write");
    prices = await import("../src/server/data/prices");
    staff = await import("../src/server/data/pos-staff");
    scope = await import("../src/server/data/till-scope");
    bell = await import("../src/server/bell/ops");
    closed = await import("../src/server/closed-days");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE products, categories, product_prices, pos_marks, staff_requests RESTART IDENTITY CASCADE`);
    await setSwitch(null);
    const [c] = await db.insert(s.categories).values({ name: "Espresso Bazlı", sortOrder: 1 }).returning({ id: s.categories.id });
    categoryId = c.id;
    const rows = await db
      .insert(s.products)
      .values([
        { categoryId, name: "Latte", size: "M", price: 195, siteMenuId: "mnu-0001", siteMenuSlot: "M", sortOrder: 1 },
        { categoryId, name: "Su (PET)", size: "Tek", price: 20, sortOrder: 2 },
        { categoryId, name: "Mocha", size: "M", price: 215, siteMenuId: "mnu-0002", siteMenuSlot: "M", posStalePrice: 205, posStaleSince: OLD_SINCE, sortOrder: 3 },
      ])
      .returning({ id: s.products.id });
    [ids.linked, ids.local, ids.oldLinked] = rows.map((r) => r.id);
  });

  test("geçiş günü boşken bugünkü gibi: siteye bağlı ürünün değişikliği de kasa listesine girer, metinler ModPOS", async () => {
    assert.deepEqual(await scope.loadTillScope(db, NOW), { kasa: "ModPOS", lafpos: false });
    assert.deepEqual(await sitePrice(ids.linked, 205, NOW), { posPending: true });
    const p = await product(ids.linked);
    assert.equal(p.posStalePrice, 195);
    const sc = await scope.loadTillScope(db, NOW);
    const sum = await prices.posPendingSummary(sc);
    assert.equal(sum.count, 2, "Latte ve Mocha");
    assert.equal(sum.kasa, "ModPOS");
    assert.deepEqual((await prices.loadPosChecklist(sc)).map((i) => i.name).sort(), ["Latte", "Mocha"]);
    assert.equal((await staff.staffPosSummary(sc)).count, 2);
    assert.deepEqual((await staff.loadStaffPosList(sc)).map((i) => i.name).sort(), ["Latte", "Mocha"]);
    const history = await prices.loadProductPriceHistory(ids.oldLinked);
    assert.equal(history.posStalePrice, 205);
    assert.equal(history.kasa, "ModPOS");
  });

  test("geçiş gününden sonra: siteye bağlı ürün kasa listesine girmez, bağlı olmayan girer; eski işaret gizli ama silinmez", async () => {
    await setSwitch(S);
    const sc = await scope.loadTillScope(db, NOW);
    assert.deepEqual(sc, { kasa: "LafPOS", lafpos: true });
    // Sitenin çektiği fiyat (bağlı ürün): geçmişe düşer, kasaya değil
    assert.deepEqual(await sitePrice(ids.linked, 205, NOW), { posPending: false });
    const latte = await product(ids.linked);
    assert.equal(latte.posStalePrice, null);
    assert.equal(latte.posStaleSince, null);
    const history = await db.select().from(s.productPrices).where(eq(s.productPrices.productId, ids.linked));
    assert.equal(history.length, 1, "fiyat geçmişi yine yazılır");
    assert.equal(history[0].price, 205);
    // Bağlı olmayan ürün (LafPOS'ta yerel ürünse elle): panelin yazımı kasa listesine koyar
    const su = await product(ids.local);
    const w = await write.writeSalePrice({ name: "Ali" }, su, 25, { source: "manual", consequence: "fiyat değişmedi" });
    assert.equal(w.site, false);
    assert.equal(w.posPending, true);
    assert.equal((await product(ids.local)).posStalePrice, 20);
    // Okuyucular: yalnız bağlı olmayan; Mocha'nın ModPOS'tan kalan işareti gizli, veritabanında duruyor
    const sum = await prices.posPendingSummary(sc);
    assert.equal(sum.count, 1);
    assert.equal(sum.kasa, "LafPOS");
    assert.deepEqual((await prices.loadPosChecklist(sc)).map((i) => i.name), ["Su (PET)"]);
    const st = await staff.staffPosSummary(sc);
    assert.equal(st.count, 1);
    assert.equal(st.kasa, "LafPOS");
    assert.deepEqual((await staff.loadStaffPosList(sc)).map((i) => i.name), ["Su (PET)"]);
    const mocha = await product(ids.oldLinked);
    assert.equal(mocha.posStalePrice, 205, "eski işaret silinmez");
    assert.equal(mocha.posStaleSince?.toISOString(), OLD_SINCE.toISOString());
    // Mocha'nın fiyatı sitede değişse de işareti olduğu gibi kalır (geçiş günü kaldırılırsa ModPOS'un eski fiyatı)
    assert.deepEqual(await sitePrice(ids.oldLinked, 225, NOW), { posPending: false });
    assert.equal((await product(ids.oldLinked)).posStalePrice, 205);
    // Ürün kartı bugünün saatiyle okur: geçiş günü bugünden önce
    await setSwitch(pastSwitch());
    const card = await prices.loadProductPriceHistory(ids.oldLinked);
    assert.equal(card.posStalePrice, null, "ürün kartı uyarısı yok");
    assert.equal(card.posStaleSince, null);
    assert.equal(card.kasa, "LafPOS");
    const local = await prices.loadProductPriceHistory(ids.local);
    assert.equal(local.posStalePrice, 20, "bağlı olmayan ürünün kartı uyarır");
    assert.equal(local.kasa, "LafPOS");
  });

  test("geçiş günü kaldırılınca gizlenen işaret geri gelir; ileri tarihli geçiş günü bugünü değiştirmez", async () => {
    await setSwitch(S);
    assert.equal((await prices.posPendingSummary(await scope.loadTillScope(db, NOW))).count, 0);
    await setSwitch(null);
    const sc = await scope.loadTillScope(db, NOW);
    assert.deepEqual(sc, { kasa: "ModPOS", lafpos: false });
    assert.deepEqual((await prices.loadPosChecklist(sc)).map((i) => [i.name, i.stalePrice]), [["Mocha", 205]]);
    // Geçiş günü yarın: bugün hâlâ ModPOS, bağlı ürün listeye girer
    await setSwitch(addDays(businessDate(NOW), 1));
    assert.deepEqual(await scope.loadTillScope(db, NOW), { kasa: "ModPOS", lafpos: false });
    assert.deepEqual(await sitePrice(ids.linked, 205, NOW), { posPending: true });
  });

  test("iş günü 05:00'te döner: geçiş gününün gecesi 03:00'te kasa hâlâ ModPOS, 05:00'ten sonra LafPOS", async () => {
    await setSwitch(S);
    const night = new Date(`${S}T03:00:00+03:00`);
    assert.deepEqual(await scope.loadTillScope(db, night), { kasa: "ModPOS", lafpos: false });
    assert.deepEqual(await sitePrice(ids.linked, 205, night), { posPending: true }, "ModPOS'un son gecesi");
    const morning = new Date(`${S}T06:00:00+03:00`);
    assert.deepEqual(await scope.loadTillScope(db, morning), { kasa: "LafPOS", lafpos: true });
    // Kasada (ModPOS) bekleyen işaret geçiş gününden sonra gizlenir; sonraki değişiklik ona dokunmaz
    assert.deepEqual(await sitePrice(ids.linked, 215, morning), { posPending: false });
    assert.equal((await product(ids.linked)).posStalePrice, 195);
  });

  test("zil: geçiş gününden sonra siteye bağlı ürünlerin bekleyen işareti zil çıkarmaz, bağlı olmayan 'LafPOS'ta elle' der", async () => {
    // Zil bugünün saatiyle okur: geçiş günü bugünden önce
    await setSwitch(pastSwitch());
    const kasaRows = (rows: { id: string; body: string }[]) => rows.filter((r) => r.id.startsWith("kasa-fiyat-"));
    assert.deepEqual(kasaRows(await bell.opsBell(adminUser())), [], "yalnız Mocha (bağlı) bekliyor: zil yok");
    assert.deepEqual(kasaRows(await bell.opsBell(staffUser())), []);
    await db.update(s.products).set({ posStalePrice: 20, posStaleSince: new Date() }).where(eq(s.products.id, ids.local));
    const [a] = kasaRows(await bell.opsBell(adminUser()));
    assert.equal(a.body, "LafPOS'ta (siteye bağlı olmayan ürün) elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin");
    const [p] = kasaRows(await bell.opsBell(staffUser()));
    assert.equal(p.body, "LafPOS'ta elle değiştirip Kasadaki fiyatlar'da işaretleyin");
    // Geçiş günü kaldırılınca bugünkü gibi: iki ürün, ModPOS
    await setSwitch(null);
    const [m] = kasaRows(await bell.opsBell(adminUser()));
    assert.match(m.body, /^ModPOS'ta elle değiştirip/);
  });

  test("kapalı gün kartı o günün kasasını söyler (geçiş günü boşken ModPOS)", async () => {
    const card = async (day: string) => {
      await db.execute(sql`TRUNCATE staff_requests RESTART IDENTITY CASCADE`);
      await db.insert(s.staffRequests).values({
        kind: "kapali-gun",
        subject: `gun:${day}`,
        day,
        title: "Kafe kapalıydı",
        payload: { reason: null },
        message: null,
        requestedBy: users.ayse.id,
        requestedByName: users.ayse.name,
      });
      const [c] = await closed.closedDayCards();
      return c.kasa;
    };
    assert.equal(await card("2026-11-11"), "ModPOS");
    await setSwitch(S);
    assert.equal(await card("2026-11-11"), "LafPOS");
    assert.equal(await card("2026-11-09"), "ModPOS", "geçiş gününden önceki gün");
  });
});
