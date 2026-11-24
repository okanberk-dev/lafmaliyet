// Geçiş gününden sonra kasadaki fiyatlar (denetim B11: E-39), gerçek Postgres'te: geçiş günü boşken her şey bugünkü
// gibi (siteye bağlı ürün de kasa listesine girer); geçiş gününden itibaren siteye bağlı ürünün fiyat değişikliği kasa
// listesinde görünmez (LafPOS fiyatı siteden alır) ama kasanın (ModPOS) durumu yazılmaya devam eder; bağlı olmayan ürün
// yalnız fiyatı LafPOS başladıktan sonra panelde değiştiyse görünür. Gizlenen işaret hiçbir okuyucuda (yönetici özeti ve
// listesi, personelin özeti ve listesi, ürün kartı, zil) görünmez ama silinmez, geçiş günü kaldırılınca ya da ileri
// alınınca LafPOS günlerindeki değişikliklerle birlikte geri gelir; LafPOS gününde personele fiyat görevi yok; iş günü
// 05:00'te döner (geçiş gününün gecesi hâlâ ModPOS); kapalı gün kartı o günün kasasını söyler.
//
// Kasa LafPOS'un şubesinin (Marina, LAFPOS_BRANCH_ID) kasasıdır: testler o şubenin seçiminde çalışır (withBranchScope;
// panelde seçiciden Marina seçilmiş gibi). ModPOS'ta kalan şubenin (Tuzla) kasa listesi geçiş gününden sonra da
// ModPOS'a göredir.
//
// Ayarlar (geçiş günü) veritabanında tektir: test kendi geçici veritabanını açar (LAFPOS_TEST_DATABASE_URL'in
// sunucusunda), migration'ları uygular, sonunda siler; öteki testlerin verisine dokunmaz.
//
// LAFPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-metin-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import { addDays } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

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
  let branchScope: typeof import("../src/server/branch-scope");
  /** LafPOS'un şubesinin (Marina) kasasında: okuyucular o kasaya bakar */
  const lafposTest = (name: string, fn: () => Promise<void>) => test(name, () => branchScope.withBranchScope(LAFPOS_SUBE, fn));
  /** Aynı okuma ModPOS'ta kalan şubenin (Tuzla) kasasında */
  const inTuzla = <T>(fn: () => Promise<T>) => branchScope.withBranchScope(MODPOS_SUBE, fn);
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
  /** Ürünün bir kasadaki durumu (pos_stale; şube kapsamı A3): yazım her kasaya aynı kuralla iner, varsayılan Marina */
  const stale = async (id: number, branchId: string = LAFPOS_SUBE) => {
    const [r] = await db
      .select()
      .from(s.posStale)
      .where(and(eq(s.posStale.productId, id), eq(s.posStale.branchId, branchId)));
    return { posStalePrice: r?.stalePrice ?? null, posStaleSince: r?.staleSince ?? null };
  };
  /** Kasanın durumu iki kasada birden (testin kurgusu: ModPOS döneminden kalan işaret gibi) */
  const setStale = async (id: number, stalePrice: number, staleSince: Date) => {
    for (const branchId of [MODPOS_SUBE, LAFPOS_SUBE])
      await db
        .insert(s.posStale)
        .values({ branchId, productId: id, stalePrice, staleSince })
        .onConflictDoUpdate({ target: [s.posStale.branchId, s.posStale.productId], set: { stalePrice, staleSince } });
  };
  /** Kasanın türü (şube ve ad hariç) */
  const kind = (t: { kasa: string; lafpos: boolean; switchDay: string | null }) => ({ kasa: t.kasa, lafpos: t.lafpos, switchDay: t.switchDay });
  /** Sitenin çekmesi gibi (applyPlan): fiyat yazılır, geçmişe ve kasanın durumuna recordPriceChange */
  const sitePrice = async (id: number, after: number, at: Date) =>
    db.transaction(async (tx) => {
      const [p] = await tx.select({ price: s.products.price }).from(s.products).where(eq(s.products.id, id));
      await tx.update(s.products).set({ price: after }).where(eq(s.products.id, id));
      return record.recordPriceChange(tx, { productId: id, before: p.price, after, source: "site", onSite: true, changedBy: "laffogato.net" }, at);
    });
  /** Panelin yazımı gibi (siteye yazılmayan değişiklik): fiyat yazılır, geçmişe ve kasanın durumuna recordPriceChange */
  const panelPrice = async (id: number, after: number, at: Date) =>
    db.transaction(async (tx) => {
      const [p] = await tx.select({ price: s.products.price }).from(s.products).where(eq(s.products.id, id));
      await tx.update(s.products).set({ price: after }).where(eq(s.products.id, id));
      return record.recordPriceChange(tx, { productId: id, before: p.price, after, source: "manual", changedBy: "Ali" }, at);
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
    await seedBranches(db);
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
    branchScope = await import("../src/server/branch-scope");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE products, categories, product_prices, pos_marks, pos_stale, staff_requests RESTART IDENTITY CASCADE`);
    await setSwitch(null);
    const [c] = await db.insert(s.categories).values({ name: "Espresso Bazlı", sortOrder: 1 }).returning({ id: s.categories.id });
    categoryId = c.id;
    const rows = await db
      .insert(s.products)
      .values([
        { categoryId, name: "Latte", size: "M", price: 195, siteMenuId: "mnu-0001", siteMenuSlot: "M", sortOrder: 1 },
        { categoryId, name: "Su (PET)", size: "Tek", price: 20, sortOrder: 2 },
        { categoryId, name: "Mocha", size: "M", price: 215, siteMenuId: "mnu-0002", siteMenuSlot: "M", sortOrder: 3 },
      ])
      .returning({ id: s.products.id });
    [ids.linked, ids.local, ids.oldLinked] = rows.map((r) => r.id);
    await setStale(ids.oldLinked, 205, OLD_SINCE);
  });

  lafposTest("geçiş günü boşken bugünkü gibi: siteye bağlı ürünün değişikliği de kasa listesine girer, metinler ModPOS", async () => {
    assert.deepEqual(kind(await scope.loadTillScope(db, NOW)), { kasa: "ModPOS", lafpos: false, switchDay: null });
    assert.deepEqual(await sitePrice(ids.linked, 205, NOW), { posPending: true });
    const p = await stale(ids.linked);
    assert.equal(p.posStalePrice, 195);
    assert.equal((await stale(ids.linked, MODPOS_SUBE)).posStalePrice, 195, "her kasaya yazılır");
    const sc = await scope.loadTillScope(db, NOW);
    const sum = await prices.posPendingSummary(sc);
    assert.equal(sum.count, 2, "Latte ve Mocha");
    assert.equal(sum.kasa, "ModPOS");
    assert.equal(sum.oldest?.toISOString(), OLD_SINCE.toISOString(), "ModPOS gününde tarih olduğu gibi");
    assert.deepEqual((await prices.loadPosChecklist(sc)).map((i) => i.name).sort(), ["Latte", "Mocha"]);
    assert.equal((await staff.staffPosSummary(sc)).count, 2);
    assert.deepEqual((await staff.loadStaffPosList(sc)).map((i) => i.name).sort(), ["Latte", "Mocha"]);
    const history = await prices.loadProductPriceHistory(ids.oldLinked);
    assert.deepEqual(
      history.pos.map((t) => [t.branchId, t.stalePrice]),
      [[LAFPOS_SUBE, 205]],
    );
    assert.equal(history.kasa, "ModPOS");
  });

  lafposTest("geçiş gününden sonra: siteye bağlı ürünün işareti yazılır ama gösterilmez, bağlı olmayan (fiyatı LafPOS günü değişen) görünür", async () => {
    await setSwitch(S);
    const sc = await scope.loadTillScope(db, NOW);
    assert.deepEqual(sc, { kasa: "LafPOS", lafpos: true, switchDay: S, branchId: LAFPOS_SUBE, name: null });
    // Sitenin çektiği fiyat (bağlı ürün): Marina'nın kasasında (LafPOS) iş yok, kasanın durumu yine yazılır (B11 incelemesi
    // D1). Kasa şube başına (A3): Tuzla'nın kasası ModPOS, orada elle değişecek; bildirim bunu söyler
    assert.deepEqual(await sitePrice(ids.linked, 205, NOW), { posPending: true });
    const latte = await stale(ids.linked);
    assert.equal(latte.posStalePrice, 195, "ModPOS'un eski fiyatı kayıtlı: geçiş günü kaldırılırsa listeye döner");
    assert.equal(latte.posStaleSince?.toISOString(), NOW.toISOString());
    const history = await db.select().from(s.productPrices).where(eq(s.productPrices.productId, ids.linked));
    assert.equal(history.length, 1, "fiyat geçmişi yine yazılır");
    assert.equal(history[0].price, 205);
    // Bağlı olmayan ürün (LafPOS'ta yerel ürünse elle): panelin LafPOS günündeki değişikliği kasa listesine koyar
    assert.deepEqual(await panelPrice(ids.local, 25, NOW), { posPending: true });
    assert.equal((await stale(ids.local)).posStalePrice, 20);
    // Okuyucular: yalnız bağlı olmayan; Latte'nin ve Mocha'nın ModPOS işaretleri gizli, veritabanında duruyor
    const sum = await prices.posPendingSummary(sc);
    assert.equal(sum.count, 1);
    assert.equal(sum.kasa, "LafPOS");
    assert.deepEqual((await prices.loadPosChecklist(sc)).map((i) => i.name), ["Su (PET)"]);
    const st = await staff.staffPosSummary(sc);
    assert.equal(st.count, 1);
    assert.equal(st.kasa, "LafPOS");
    assert.deepEqual((await staff.loadStaffPosList(sc)).map((i) => i.name), ["Su (PET)"]);
    // Geçiş günü yalnız LafPOS'un şubesinin kasasınındır: Tuzla'nın kasası (şube seçilmeyince de o) ModPOS'ta kalır,
    // listesi bugünkü gibi (siteye bağlı ürünler de, personele de)
    const tuzla = await inTuzla(() => scope.loadTillScope(db, NOW));
    assert.deepEqual(tuzla, { kasa: "ModPOS", lafpos: false, switchDay: null, branchId: MODPOS_SUBE, name: null });
    assert.deepEqual(await branchScope.withBranchScope(ALL_BRANCHES, () => scope.loadTillScope(db, NOW)), tuzla, "Tümü'de kasa Tuzla'nın");
    assert.deepEqual((await prices.loadPosChecklist(tuzla)).map((i) => i.name).sort(), ["Latte", "Mocha", "Su (PET)"]);
    assert.deepEqual((await staff.loadStaffPosList(tuzla)).map((i) => i.name).sort(), ["Latte", "Mocha", "Su (PET)"]);
    assert.equal((await prices.posPendingSummary(tuzla)).kasa, "ModPOS");
    const mocha = await stale(ids.oldLinked);
    assert.equal(mocha.posStalePrice, 205, "eski işaret silinmez");
    assert.equal(mocha.posStaleSince?.toISOString(), OLD_SINCE.toISOString());
    // Mocha'nın fiyatı sitede değişse de ModPOS'taki eski fiyatı (205) kayıtlı kalır
    assert.deepEqual(await sitePrice(ids.oldLinked, 225, NOW), { posPending: true }, "Tuzla'nın kasası ModPOS: orada bekler");
    assert.equal((await stale(ids.oldLinked)).posStalePrice, 205);
    // Ürün kartı bugünün saatiyle okur: geçiş günü bugünden önce
    await setSwitch(pastSwitch());
    const card = await prices.loadProductPriceHistory(ids.oldLinked);
    assert.deepEqual(card.pos, [], "ürün kartı uyarısı yok");
    assert.equal(card.kasa, "LafPOS");
  });

  lafposTest("LafPOS günlerinde değişen fiyat kaybolmaz: geçiş günü kaldırılınca ModPOS'ta değişecek fiyat olarak döner (B11 incelemesi D1, K2)", async () => {
    await setSwitch(S);
    // Geçiş günü seçiliyken site Latte'yi 195 → 205 yapar (Tuzla'nın ModPOS kasasında bekler); Mocha'nın fiyatı ModPOS'taki
    // 205'e döner (toplu geri alma gibi)
    assert.deepEqual(await sitePrice(ids.linked, 205, NOW), { posPending: true });
    assert.deepEqual(await sitePrice(ids.oldLinked, 205, NOW), { posPending: false });
    assert.equal((await stale(ids.oldLinked)).posStalePrice, null, "fiyat ModPOS'takine döndü: işaret kalkar");
    assert.equal((await prices.posPendingSummary(await scope.loadTillScope(db, NOW))).count, 0);
    // LafPOS ertelendi: geçiş günü kaldırılır ya da ileri alınır
    for (const day of [null, "2026-11-20"]) {
      await setSwitch(day);
      const sc = await scope.loadTillScope(db, NOW);
      assert.equal(sc.kasa, "ModPOS");
      assert.deepEqual(
        (await prices.loadPosChecklist(sc)).map((i) => [i.name, i.stalePrice, i.price]),
        [["Latte", 195, 205]],
        `geçiş günü ${day ?? "boş"}: Latte ModPOS'ta 195, "205 → 205" Mocha yok`,
      );
      assert.equal((await staff.staffPosSummary(sc)).count, 1);
    }
  });

  lafposTest("ModPOS'tan kalan işaret LafPOS'un işi değil: bağlı olmayanın eski işareti gizli, LafPOS günü değişince görünür (B11 incelemesi D2)", async () => {
    // Su (PET): panelde 25, ModPOS'ta 20 kaldı (1 Ekim'den beri); LafPOS'un yerel ürünü 25'le kuruldu
    const oct1 = new Date("2026-10-01T10:00:00+03:00");
    await db.update(s.products).set({ price: 25 }).where(eq(s.products.id, ids.local));
    await setStale(ids.local, 20, oct1);
    await db.insert(s.productPrices).values({ productId: ids.local, priceBefore: 20, price: 25, source: "manual", changedBy: "Ali", changedAt: oct1 });
    await setSwitch(S);
    const sc = await scope.loadTillScope(db, NOW);
    assert.equal((await prices.posPendingSummary(sc)).count, 0, "LafPOS 20'yle hiç satmadı");
    assert.deepEqual(await prices.loadPosChecklist(sc), [], "haftalık özetin kâr kaybı da bu listeden");
    assert.equal((await staff.staffPosSummary(sc)).count, 0);
    // Geçiş gününden sonra siteden ayrılan bağlı ürün (Mocha'nın ModPOS işareti): LafPOS işi olmaz
    await db.update(s.products).set({ siteMenuId: null, siteMenuSlot: null }).where(eq(s.products.id, ids.oldLinked));
    assert.equal((await prices.posPendingSummary(sc)).count, 0, "ayrılan ürünün eski işareti gizli");
    // Geçiş günü kaldırılınca ikisi de ModPOS'ta değişecek fiyat olarak döner
    await setSwitch(null);
    const modpos = await scope.loadTillScope(db, NOW);
    assert.deepEqual((await prices.loadPosChecklist(modpos)).map((i) => [i.name, i.stalePrice]).sort(), [["Mocha", 205], ["Su (PET)", 20]]);
    // LafPOS günü panelde değişirse (25 → 30) Su LafPOS'un listesine girer; tarihi LafPOS'un başladığı andan
    await setSwitch(S);
    assert.deepEqual(await panelPrice(ids.local, 30, NOW), { posPending: true });
    const list = await prices.loadPosChecklist(sc);
    assert.deepEqual(list.map((i) => i.name), ["Su (PET)"]);
    assert.equal(list[0].since, new Date(`${S}T05:00:00+03:00`).toISOString(), "40 gündür demez");
    const sum = await prices.posPendingSummary(sc);
    assert.equal(sum.count, 1);
    assert.equal(sum.oldest?.toISOString(), new Date(`${S}T05:00:00+03:00`).toISOString());
    // Sitede de değişen (on_site) fiyat LafPOS'a siteden gider: bağlı olmayan ürüne sayılmaz
    await setStale(ids.oldLinked, 225, NOW);
    await db.insert(s.productPrices).values({ productId: ids.oldLinked, priceBefore: 225, price: 235, source: "manual", onSite: true, changedBy: "Ali", changedAt: NOW });
    assert.deepEqual((await prices.loadPosChecklist(sc)).map((i) => i.name), ["Su (PET)"]);
  });

  lafposTest("geçiş günü kaldırılınca gizlenen işaret geri gelir; ileri tarihli geçiş günü bugünü değiştirmez", async () => {
    await setSwitch(S);
    assert.equal((await prices.posPendingSummary(await scope.loadTillScope(db, NOW))).count, 0);
    await setSwitch(null);
    const sc = await scope.loadTillScope(db, NOW);
    assert.deepEqual(kind(sc), { kasa: "ModPOS", lafpos: false, switchDay: null });
    assert.deepEqual((await prices.loadPosChecklist(sc)).map((i) => [i.name, i.stalePrice]), [["Mocha", 205]]);
    // Geçiş günü yarın: bugün hâlâ ModPOS, bağlı ürün listeye girer
    await setSwitch(addDays(businessDate(NOW), 1));
    assert.deepEqual(kind(await scope.loadTillScope(db, NOW)), { kasa: "ModPOS", lafpos: false, switchDay: null });
    assert.deepEqual(await sitePrice(ids.linked, 205, NOW), { posPending: true });
  });

  lafposTest("iş günü 05:00'te döner: geçiş gününün gecesi 03:00'te kasa hâlâ ModPOS, 05:00'ten sonra LafPOS", async () => {
    await setSwitch(S);
    const night = new Date(`${S}T03:00:00+03:00`);
    assert.deepEqual(kind(await scope.loadTillScope(db, night)), { kasa: "ModPOS", lafpos: false, switchDay: null });
    assert.deepEqual(await sitePrice(ids.linked, 205, night), { posPending: true }, "ModPOS'un son gecesi");
    const morning = new Date(`${S}T06:00:00+03:00`);
    assert.deepEqual(kind(await scope.loadTillScope(db, morning)), { kasa: "LafPOS", lafpos: true, switchDay: S });
    // Kasada (ModPOS) bekleyen işaret geçiş gününden sonra gizlenir; sonraki değişiklik ModPOS'un eski fiyatını korur
    assert.deepEqual(await sitePrice(ids.linked, 215, morning), { posPending: true }, "Tuzla'nın kasası ModPOS: orada bekler");
    assert.equal((await stale(ids.linked)).posStalePrice, 195);
    // Bağlı olmayan ürün: gecenin (03:00) değişikliği ModPOS'un, sabahınki (06:00) LafPOS'un
    await panelPrice(ids.local, 22, night);
    assert.equal((await prices.posPendingSummary(await scope.loadTillScope(db, morning))).count, 0, "gecenin değişikliği LafPOS'un değil");
    await panelPrice(ids.local, 25, morning);
    assert.equal((await prices.posPendingSummary(await scope.loadTillScope(db, morning))).count, 1);
  });

  lafposTest("zil: geçiş gününden sonra yalnız yöneticide ve yalnız bağlı olmayan ürün; personele görev yok (B11 incelemesi K1)", async () => {
    // Zil bugünün saatiyle okur: geçiş günü bugünden önce
    await setSwitch(pastSwitch());
    const kasaRows = (rows: { id: string; body: string }[]) => rows.filter((r) => r.id.startsWith("kasa-fiyat-"));
    assert.deepEqual(kasaRows(await bell.opsBell(adminUser())), [], "yalnız Mocha (bağlı) bekliyor: zil yok");
    assert.deepEqual(kasaRows(await bell.opsBell(staffUser())), []);
    // Panelin bugünkü yazımı (gerçek saat, LafPOS günü): bağlı olmayan ürün kasa listesine girer
    const su = await product(ids.local);
    const w = await write.writeSalePrice({ name: "Ali" }, su, 25, { source: "manual", consequence: "fiyat değişmedi" });
    assert.equal(w.site, false);
    assert.equal(w.posPending, true);
    const [a] = kasaRows(await bell.opsBell(adminUser()));
    assert.match(a.body, /^Siteye bağlı olmayan ürün: LafPOS'ta yerelse orada elle değiştirip/);
    assert.match(a.body, /Site menüsü'nde bağlayın$/);
    assert.deepEqual(kasaRows(await bell.opsBell(staffUser())), [], "LafPOS'ta ürün fiyatını kasiyer değiştiremez");
    const local = await prices.loadProductPriceHistory(ids.local);
    assert.equal(local.pos[0]?.stalePrice, 20, "bağlı olmayan ürünün kartı uyarır");
    assert.equal(local.kasa, "LafPOS");
    // Geçiş günü kaldırılınca bugünkü gibi: iki ürün, ModPOS, personelde de
    await setSwitch(null);
    const [m] = kasaRows(await bell.opsBell(adminUser()));
    assert.match(m.body, /^ModPOS'ta elle değiştirip/);
    const [p] = kasaRows(await bell.opsBell(staffUser()));
    assert.equal(p.body, "ModPOS'ta değiştirip Kasadaki fiyatlar'da işaretleyin");
  });

  lafposTest("kapalı gün kartı o günün kasasını söyler (geçiş günü boşken ModPOS)", async () => {
    // Bildirim LafPOS'un şubesinin (Marina; kapalı gün şubenindir, denetim 13 Kasım KP-05): kasası onun geçiş gününe göre
    const card = async (day: string, branch: string = LAFPOS_SUBE) => {
      await db.execute(sql`TRUNCATE staff_requests RESTART IDENTITY CASCADE`);
      await db.insert(s.staffRequests).values({
        kind: "kapali-gun",
        subject: branch === MODPOS_SUBE ? `gun:${day}` : `gun:${day}:${branch}`,
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
    assert.equal(await card("2026-11-11", MODPOS_SUBE), "ModPOS", "ModPOS'ta kalan şubenin bildirimi");
  });
});
