// Kasada bekleyen fiyat şube başına (şube kapsamı A3, 24 Kasım 2026; docs/FIYATLAR.md › Kasaya işle), gerçek Postgres'te:
// - göç (0078 + 0079): ürünün eski pos_stale_* değerleri Tuzla'ya olduğu gibi, Marina'ya (AsilPOS'un şubesi) yalnız
//   okuyucunun süzgecine uyanlar kopyalanır; eski işaretler Tuzla'nın olur, ürün sütunlarına dokunulmaz;
// - fiyat yazımı her etkin fiziksel şubenin satırını açar (online kanal ve pasif şube yok), fiyat geri dönünce siler;
// - Marina'da işaretlenince Tuzla'nın listesi kalır; geri alma yalnız o şubede ve "son işaret" şube başına;
// - okuyucular seçimin kasasına bakar ("Tümü"de birden çok kasa ayrı ve adıyla); işaret eylemi formun kasasını alır,
//   "Tümü"de kasasız istek ve kilitli personelin başka şubesi reddedilir.
//
// KASA_FIYAT_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/postgres). Test o
// sunucuda kendi geçici veritabanını (lm_kasa_fiyat_<pid>) açar, sonunda siler.
// Çalıştırma: KASA_FIYAT_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/kasa-fiyat-sube-db.test.ts

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES, BRANCH_REQUIRED, DEFAULT_BRANCHES } from "../src/lib/branches";
import { POS_UNDO_TEXT } from "../src/lib/prices/pos";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { dalCapabilities } from "./helpers/dal-stub";

const SERVER_URL = process.env.KASA_FIYAT_TEST_DATABASE_URL;
const DB_NAME = `lm_kasa_fiyat_${process.pid}`;
const TUZLA = "tuzla";
const MARINA = "marina";
const NOW = new Date("2026-11-24T09:00:00Z");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);

type Who = { id: number; name: string; role: "admin" | "staff"; branchId: string | null };

describe("kasada bekleyen fiyat şube başına: veritabanında", { skip: !SERVER_URL && "KASA_FIYAT_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let record: typeof import("../src/server/prices/record");
  let marks: typeof import("../src/server/prices/pos-marks");
  let prices: typeof import("../src/server/data/prices");
  let staffReads: typeof import("../src/server/data/pos-staff");
  let till: typeof import("../src/server/data/till-scope");
  let scope: typeof import("../src/server/branch-scope");
  let action: typeof import("../src/server/actions/pos-marks");
  const users: Record<"ali" | "ayse" | "deniz", Who> = {
    ali: { id: 0, name: "Ali", role: "admin", branchId: null },
    ayse: { id: 0, name: "Ayşe", role: "staff", branchId: TUZLA },
    deniz: { id: 0, name: "Deniz", role: "staff", branchId: null },
  };
  /** Oturumdaki kişi (eylemin requireUser'ı ve şube kilidi bunu okur) */
  let me: Who = users.ali;
  let categoryId = 0;
  let tmp = "";

  const staleRows = async (productId: number) =>
    (await db.select().from(s.posStale).where(eq(s.posStale.productId, productId))).map((r) => [r.branchId, r.stalePrice]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const product = async (name: string, price: number, siteMenuId: string | null = null) => {
    const [p] = await db
      .insert(s.products)
      .values({ categoryId, name, size: "M", price, siteMenuId, siteMenuSlot: siteMenuId ? "M" : null })
      .returning({ id: s.products.id });
    return p.id;
  };
  /** Panelin yazımı gibi: fiyat yazılır, geçmişe ve kasaların durumuna recordPriceChange */
  const setPrice = (id: number, after: number, at: Date) =>
    db.transaction(async (tx) => {
      const [p] = await tx.select({ price: s.products.price }).from(s.products).where(eq(s.products.id, id));
      await tx.update(s.products).set({ price: after }).where(eq(s.products.id, id));
      return record.recordPriceChange(tx, { productId: id, before: p.price, after, source: "manual", changedBy: "Ali" }, at);
    });

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "kasa-fiyat-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
      ...dalCapabilities(async () => ({ ...me, email: `${me.name}@test.local`, active: true })),
      getCurrentUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    // Göçün öncesi: 0077'ye kadar uygulanır, eski kurulumun verisi yazılır, sonra bütün göçler
    tmp = mkdtempSync(join(tmpdir(), "kasa-fiyat-goc-"));
    cpSync("drizzle", join(tmp, "drizzle"), { recursive: true });
    const journalPath = join(tmp, "drizzle", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
    const cut = journal.entries.findIndex((e) => e.tag === "0078_kasa_fiyat_sube");
    assert.ok(cut > 0, "0078_kasa_fiyat_sube günlükte yok");
    journal.entries = journal.entries.slice(0, cut);
    writeFileSync(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: join(tmp, "drizzle") });
    // Şube satırları düz SQL ile: 0077'de `branches.features` yok (0084), Drizzle'ın insert'ü şemanın her sütununu adlandırır
    for (const b of DEFAULT_BRANCHES) {
      await db.execute(sql`INSERT INTO branches (id, name, kind, pos_source, sort_order) VALUES (${b.id}, ${b.name}, ${b.kind}, ${b.posSource}, ${b.sortOrder}) ON CONFLICT DO NOTHING`);
    }
    await db.execute(sql`INSERT INTO branches (id, name, kind, pos_source, active, sort_order) VALUES ('eski', 'Eski', 'fiziksel', 'modpos', false, 9)`);
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `${k}@test.local`, name: users[k].name, passwordHash: "x", role: users[k].role, branchId: users[k].branchId })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
  });

  after(async () => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("göç: Tuzla'ya her işaret, Marina'ya yalnız AsilPOS'un işi; eski işaretler Tuzla'nın, ürün sütunları yerinde", async () => {
    // Eski kurulum (0077): tek kasanın durumu ürün satırında; geçiş günü 22 Kasım, bugün 24 Kasım
    await db.execute(sql`INSERT INTO settings (key, value) VALUES ('asilposGecisGunu', '"2026-11-22"')`);
    await db.execute(sql`INSERT INTO categories (id, name) VALUES (900, 'Göç')`);
    await db.execute(sql`INSERT INTO products (id, category_id, name, size, price, site_menu_id, site_menu_slot, pos_stale_price, pos_stale_since) VALUES
      (901, 900, 'Latte', 'M', 205, null, null, 195, '2026-11-01T10:00:00Z'),
      (902, 900, 'Mocha', 'M', 215, 'mnu-1', 'M', 205, '2026-11-01T10:00:00Z'),
      (903, 900, 'Çay', 'M', 50, null, null, 45, '2026-11-01T10:00:00Z'),
      (904, 900, 'Kola', 'M', 80, null, null, 70, '2026-11-23T10:00:00Z'),
      (905, 900, 'Su', 'M', 20, null, null, null, null),
      (906, 900, 'Ayran', 'M', 40, null, null, 35, null)`);
    await db.execute(sql`INSERT INTO product_prices (product_id, price_before, price, source, on_site, changed_by, changed_at) VALUES
      (901, 195, 205, 'manual', false, 'Ali', '2026-11-23T10:00:00Z'),
      (902, 205, 215, 'manual', false, 'Ali', '2026-11-23T10:00:00Z'),
      (903, 45, 50, 'manual', false, 'Ali', '2026-11-01T10:00:00Z'),
      (904, 70, 80, 'site', true, 'site', '2026-11-23T10:00:00Z')`);
    await db.execute(sql`INSERT INTO pos_marks (product_id, price, stale_price, stale_since, marked_by_name) VALUES (905, 20, 18, '2026-11-01T10:00:00Z', 'Ayşe')`);
    await migrate(db, { migrationsFolder: "drizzle" });
    const rows = await db.execute<{ branch_id: string; product_id: number; stale_price: number }>(
      sql`SELECT branch_id, product_id, stale_price FROM pos_stale WHERE product_id BETWEEN 901 AND 906 ORDER BY branch_id, product_id`,
    );
    assert.deepEqual(
      rows.map((r) => [r.branch_id, r.product_id, r.stale_price]),
      [
        // Marina: yalnız siteye bağlı olmayan ve fiyatı AsilPOS başladıktan sonra panelde değişen (Latte)
        [MARINA, 901, 195],
        [TUZLA, 901, 195],
        [TUZLA, 902, 205],
        [TUZLA, 903, 45],
        [TUZLA, 904, 70],
        [TUZLA, 906, 35],
      ],
      "online kanal ve pasif şube yok",
    );
    const [ayran] = await db.execute<{ stale_since: Date }>(sql`SELECT stale_since FROM pos_stale WHERE product_id = 906`);
    assert.ok(ayran.stale_since, "anı boş eski satıra göç anı yazılır");
    const [mark] = await db.execute<{ branch_id: string }>(sql`SELECT branch_id FROM pos_marks WHERE product_id = 905`);
    assert.equal(mark.branch_id, TUZLA);
    const [kept] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM products WHERE pos_stale_price IS NOT NULL`);
    assert.equal(kept.n, 5, "ürün sütunları bir sürüm yerinde (geri dönüş)");
    // Göçün veri adımı ikinci kez koşsa da aynı sonuç
    await db.execute(sql.raw(readFileSync("drizzle/0079_kasa_fiyat_sube_veri.sql", "utf8")));
    const [again] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pos_stale WHERE product_id BETWEEN 901 AND 906`);
    assert.equal(again.n, 6);
    // Sonraki testler: göçün kurgusu silinir, modüller yüklenir
    await db.execute(sql`TRUNCATE products, categories, product_prices, pos_marks, pos_stale, settings RESTART IDENTITY CASCADE`);
    record = await import("../src/server/prices/record");
    marks = await import("../src/server/prices/pos-marks");
    prices = await import("../src/server/data/prices");
    staffReads = await import("../src/server/data/pos-staff");
    till = await import("../src/server/data/till-scope");
    scope = await import("../src/server/branch-scope");
    action = await import("../src/server/actions/pos-marks");
  });

  describe("göçten sonra", () => {
    beforeEach(async () => {
      me = users.ali;
      await db.execute(sql`TRUNCATE products, categories, product_prices, pos_marks, pos_stale, activity_log RESTART IDENTITY CASCADE`);
      await db.delete(s.settings).where(eq(s.settings.key, "asilposGecisGunu"));
      const [c] = await db.insert(s.categories).values({ name: "Kahve", sortOrder: 1 }).returning({ id: s.categories.id });
      categoryId = c.id;
    });

    test("fiyat yazımı her etkin fiziksel şubenin kasasına iner; fiyat geri dönünce satırlar silinir", async () => {
      const latte = await product("Latte", 200);
      assert.deepEqual(await setPrice(latte, 210, NOW), { posPending: true });
      assert.deepEqual(await staleRows(latte), [
        [MARINA, 200],
        [TUZLA, 200],
      ]);
      // İkinci değişiklik kasadaki eski fiyatı ve anı korur
      await setPrice(latte, 220, later(5));
      const [t] = await db
        .select()
        .from(s.posStale)
        .where(and(eq(s.posStale.branchId, TUZLA), eq(s.posStale.productId, latte)));
      assert.equal(t.stalePrice, 200);
      assert.equal(t.staleSince.toISOString(), NOW.toISOString());
      // Fiyat kasadakine döndü: iki kasada da iş kalmadı
      assert.deepEqual(await setPrice(latte, 200, later(10)), { posPending: false });
      assert.deepEqual(await staleRows(latte), []);
    });

    test("Marina'da işaretlenince Tuzla'nın listesi kalır; geri alma yalnız o şubede, son işaret şube başına", async () => {
      const latte = await product("Latte", 200);
      await setPrice(latte, 210, NOW);
      const m = await marks.markPos(db, users.ali, [{ productId: latte, price: 210 }], later(1), MARINA);
      assert.equal(m.done.length, 1);
      assert.deepEqual(await staleRows(latte), [[TUZLA, 200]], "Tuzla'nın kasası hâlâ 200");
      const [row] = await db.select().from(s.posMarks).where(eq(s.posMarks.id, m.done[0].markId));
      assert.equal(row.branchId, MARINA);
      // Aynı ürün Marina'da yeniden işaretlenemez (listede değil), Tuzla'da işaretlenir
      assert.deepEqual((await marks.markPos(db, users.ali, [{ productId: latte, price: 210 }], later(2), MARINA)).already, [latte]);
      const t = await marks.markPos(db, users.ali, [{ productId: latte, price: 210 }], later(3), TUZLA);
      assert.equal(t.done.length, 1);
      assert.deepEqual(await staleRows(latte), []);
      // Marina'nın işareti geri alınır (Tuzla'nın sonraki işareti onu "son" olmaktan çıkarmaz); yalnız Marina döner
      const u = await marks.undoPos(db, users.ali, [m.done[0].markId], later(4));
      assert.equal(u.undone.length, 1, u.refused[0]?.reason);
      assert.equal(u.undone[0].branchId, MARINA);
      assert.deepEqual(await staleRows(latte), [[MARINA, 200]]);
      const [back] = await db
        .select()
        .from(s.posStale)
        .where(and(eq(s.posStale.branchId, MARINA), eq(s.posStale.productId, latte)));
      assert.equal(back.staleSince.toISOString(), NOW.toISOString(), "saklanan an geri yazılır");
      // Marina listeye yeniden girdi: Tuzla'nın işareti yine geri alınabilir (öbür şubenin satırı sayılmaz)
      assert.equal((await marks.undoPos(db, users.ali, [t.done[0].markId], later(5))).undone.length, 1);
      assert.deepEqual(await staleRows(latte), [
        [MARINA, 200],
        [TUZLA, 200],
      ]);
      // Aynı şubede sıra: M1 → fiyat değişti → M2 ise M1 geri alınmaz
      const m1 = await marks.markPos(db, users.ali, [{ productId: latte, price: 210 }], later(6), MARINA);
      await setPrice(latte, 230, later(7));
      const m2 = await marks.markPos(db, users.ali, [{ productId: latte, price: 230 }], later(8), MARINA);
      assert.equal((await marks.undoPos(db, users.ali, [m1.done[0].markId], later(9))).refused[0].reason, POS_UNDO_TEXT.notLatest);
      assert.equal((await marks.undoPos(db, users.ali, [m2.done[0].markId], later(9))).undone.length, 1);
    });

    test("okuyucular seçimin kasasına bakar; Tümü'de birden çok kasa ayrı ve adıyla; son işaretler kasaya göre", async () => {
      const latte = await product("Latte", 200);
      const mocha = await product("Mocha", 300);
      await setPrice(latte, 210, NOW);
      await setPrice(mocha, 310, NOW);
      await marks.markPos(db, users.ali, [{ productId: latte, price: 210 }], later(1), MARINA);
      const marina = await scope.withBranchScope(MARINA, () => till.loadTillScopes(db, later(2)));
      assert.deepEqual(
        marina.map((t) => [t.branchId, t.name]),
        [[MARINA, null]],
      );
      const all = await scope.withBranchScope(ALL_BRANCHES, () => till.loadTillScopes(db, later(2)));
      assert.deepEqual(
        all.map((t) => [t.branchId, t.name]),
        [
          [TUZLA, "Tuzla"],
          [MARINA, "Marina"],
        ],
      );
      assert.deepEqual((await prices.loadPosChecklist(marina[0])).map((i) => i.name), ["Mocha"]);
      assert.deepEqual((await prices.loadPosChecklist(all[0])).map((i) => i.name).sort(), ["Latte", "Mocha"]);
      assert.equal((await prices.posPendingSummary(all[0])).count, 2);
      assert.equal((await prices.posPendingSummary(marina[0])).count, 1);
      assert.equal((await staffReads.staffPosSummary(marina[0])).count, 1);
      assert.deepEqual((await staffReads.loadStaffPosList(all[0])).map((i) => i.name).sort(), ["Latte", "Mocha"]);
      const sums = await scope.withBranchScope(ALL_BRANCHES, () => prices.posPendingSummaries(later(2)));
      assert.deepEqual(
        sums.map((x) => [x.branchId, x.count, x.name]),
        [
          [TUZLA, 2, "Tuzla"],
          [MARINA, 1, "Marina"],
        ],
      );
      // Son işaretlenenler: Tuzla seçiliyken Marina'nın işareti yok; Tümü'de var ve adıyla
      assert.deepEqual(await prices.loadRecentPosMarks({ now: later(2), tills: [await till.loadTillScope(db, later(2), TUZLA)] }), []);
      const recent = await prices.loadRecentPosMarks({ now: later(2), tills: all });
      assert.deepEqual(
        recent.map((r) => [r.name, r.tillName, r.refusal]),
        [["Latte", "Marina", null]],
      );
      // Ürün kartı: Tümü'de bekleyen her kasa; Marina seçiliyken Latte uyarısı yok
      const card = await scope.withBranchScope(ALL_BRANCHES, () => prices.loadProductPriceHistory(latte));
      assert.deepEqual(
        card.pos.map((p) => [p.branchId, p.name, p.stalePrice]),
        [[TUZLA, "Tuzla", 200]],
      );
      assert.deepEqual((await scope.withBranchScope(MARINA, () => prices.loadProductPriceHistory(latte))).pos, []);
      // Kişinin son işaretleri: yalnız o kasanınkiler
      assert.equal((await staffReads.loadMyPosMarks(users.ali.id, later(2), MARINA)).length, 1);
      assert.equal((await staffReads.loadMyPosMarks(users.ali.id, later(2), TUZLA)).length, 0);
    });

    test("işaret eylemi: Tümü'de kasasız istek reddedilir; formun kasası yazılır; kilitli personel başka şubeyi işaretleyemez", async () => {
      const latte = await product("Latte", 200);
      await setPrice(latte, 210, new Date());
      const none = await scope.withBranchScope(ALL_BRANCHES, () => action.markPosDone([{ productId: latte, price: 210 }]));
      assert.equal(none.ok, false);
      assert.equal(!none.ok && none.error, BRANCH_REQUIRED);
      const ok = await scope.withBranchScope(ALL_BRANCHES, () => action.markPosDone([{ productId: latte, price: 210 }], MARINA));
      assert.ok(ok.ok, !ok.ok ? ok.error : "");
      assert.deepEqual(await staleRows(latte), [[TUZLA, 200]]);
      const [log] = await db.select().from(s.activityLog).orderBy(s.activityLog.id);
      assert.match(log.detail ?? "", /^Marina: Latte M 210/);
      // Tuzla'ya kilitli personel Marina'nın kasasını işaretleyemez; kendi şubesininkini işaretler
      me = users.ayse;
      const other = await action.markPosDone([{ productId: latte, price: 210 }], MARINA);
      assert.equal(other.ok, false);
      const own = await action.markPosDone([{ productId: latte, price: 210 }], TUZLA);
      assert.ok(own.ok, !own.ok ? own.error : "");
      assert.deepEqual(await staleRows(latte), []);
      // Hesabı sonradan Marina'ya kilitlenen personel Tuzla'daki kendi işaretini (30 dakika içinde de) geri alamaz
      me = { ...users.ayse, branchId: MARINA };
      const undoOther = await action.undoPosMarks([own.ok ? own.data.done[0].markId : 0]);
      assert.equal(undoOther.ok, false);
      assert.match(!undoOther.ok ? undoOther.error : "", /Tuzla şubesinin; hesabınız Marina şubesinde/);
      assert.deepEqual(await staleRows(latte), [], "Tuzla'nın listesine yazılmadı");
      me = users.ayse;
      // Şubesiz personel tek şube seçiliyken kasa göndermese de seçili şubeye yazar (eski sekme)
      me = users.deniz;
      await setPrice(latte, 220, new Date());
      const legacy = await scope.withBranchScope(TUZLA, () => action.markPosDone([{ productId: latte, price: 220 }]));
      assert.ok(legacy.ok, !legacy.ok ? legacy.error : "");
      assert.deepEqual(await staleRows(latte), [[MARINA, 210]], "Marina'nın kasası 210'da kaldı, yalnız Tuzla işaretlendi");
    });
  });
});
