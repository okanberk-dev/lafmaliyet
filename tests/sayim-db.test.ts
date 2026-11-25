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
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SAYIM_TEST_DATABASE_URL ?? process.env.EKLE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sayim_${process.pid}`;

describe("stok sayımı eylemleri: veritabanında", { skip: !SERVER_URL && "SAYIM_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let stock: typeof import("../src/server/actions/stock");
  let extras: typeof import("../src/app/panel/sayim/actions");
  let ingredients: typeof import("../src/server/actions/ingredients");
  let countProgress: typeof import("../src/server/data/count-progress").countProgress;
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
    // Şube kütüğü tohumla gelir (scripts/seed.ts); ay ve sayım satırlarının şubesi ona bağlı
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const [p] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe", passwordHash: "x", role: "staff" }).returning();
    users = { admin: a, staff: p };
    const me = async () => ({ ...users[who.role], role: who.role });
    stub(require.resolve("../src/server/auth/dal"), {
      // Şube kilidi oturumdan okunur (src/server/branch-scope.ts lockedBranch)
      getCurrentUser: me,
      requireUser: me,
      requireAdmin: async () => {
        if (who.role !== "admin") throw new Error("yalnız yönetici");
        return me();
      },
    });
    stock = await import("../src/server/actions/stock");
    extras = await import("../src/app/panel/sayim/actions");
    ingredients = await import("../src/server/actions/ingredients");
    countProgress = (await import("../src/server/data/count-progress")).countProgress;
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

  test("ek kalemler şube başına: Marina'nın kaydı Tuzla'nın listesini görmez, ezmez, silmez (21 Kasım denetimi #19/#24)", async () => {
    at("2026-10-31T19:00:00Z");
    const { withBranchScope } = await import("../src/server/branch-scope");
    const { loadModel } = await import("../src/server/data/dataset");
    const { loadUnpricedExtras } = await import("../src/server/data/count-alerts");
    // beforeEach: Tuzla'nın Ekim listesinde Peçete 3 PAKET (12,5 ₺); şubesiz yazılan satır Tuzla'nın (migration 0059)
    const list = async (branch: string) =>
      (await db.select().from(s.stockExtras).where(and(eq(s.stockExtras.month, "2026-10"), eq(s.stockExtras.branchId, branch))))
        .sort((a, b) => a.id - b.id)
        .map((r) => [r.name, r.qty, r.unitPrice]);
    const tuzla = [["Peçete", 3, 12.5]];
    assert.deepEqual(await list("tuzla"), tuzla);
    // Marina'nın formu boş listeyi görür (Tuzla'nın Peçete'si önerilmez)
    const marinaSheet = (await loadModel({ scope: "marina" })).stockSheet("2026-10");
    assert.deepEqual(marinaSheet.extras, []);
    // Marina'ya kilitli personel kendi peçetesini yazar: Tuzla'nın satırı eşlenmez ("iki kez" de denmez), ezilmez
    who.role = "staff";
    const saved = await withBranchScope("marina", () =>
      extras.saveStaffStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 2 }, { name: "Çöp torbası", unit: "KOLİ", qty: 1 }], extrasBase([])),
    );
    assert.ok(saved.ok, saved.ok ? "" : saved.error);
    assert.deepEqual(saved.data.map((e) => [e.name, e.qty]), [["Peçete", 2], ["Çöp torbası", 1]], "dönen liste yalnız Marina'nınki");
    assert.deepEqual(await list("tuzla"), tuzla, "Tuzla'nın 3 paketi yerinde");
    assert.deepEqual(await list("marina"), [["Peçete", 2, 0], ["Çöp torbası", 1, 0]]);
    // Ay satırı Marina'nın (şubesiz yazılsaydı Tuzla'ya ay açardı)
    assert.equal((await db.select().from(s.months).where(and(eq(s.months.month, "2026-10"), eq(s.months.branchId, "marina")))).length, 1);
    // Marina tanımadığı satırı silemez çünkü görmez; kendi fiyatsız satırını kaldırınca Tuzla'nınki kalır
    const marinaNow = await withBranchScope("marina", async () => extrasBase((await loadModel({ scope: "marina" })).stockSheet("2026-10").extras));
    assert.equal((await withBranchScope("marina", () => extras.saveStaffStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 2 }], marinaNow))).ok, true);
    assert.deepEqual(await list("marina"), [["Peçete", 2, 0]]);
    assert.deepEqual(await list("tuzla"), tuzla);
    // Tuzla'nın imzası Marina'nın kaydıyla değişmez: Tuzla'nın eski formu yine kaydeder
    who.role = "admin";
    const tuzlaBase = extrasBase(await db.select().from(s.stockExtras).where(and(eq(s.stockExtras.month, "2026-10"), eq(s.stockExtras.branchId, "tuzla"))));
    assert.equal((await stock.saveStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 4, unitPrice: 12.5 }], tuzlaBase)).ok, true);
    assert.deepEqual(await list("tuzla"), [["Peçete", 4, 12.5]]);
    assert.deepEqual(await list("marina"), [["Peçete", 2, 0]], "yöneticinin Tuzla kaydı Marina'nın aynı adlı kalemine dokunmaz");
    // Fiyatsız ek kalem uyarısı işletme geneli ama şube başına satır: Marina'nın satırı adıyla, o şubenin sayımına
    const unpriced = await loadUnpricedExtras(["2026-10"]);
    assert.deepEqual(unpriced.map((u) => [u.month, u.branch, u.count, u.names]), [["2026-10", { id: "marina", name: "Marina" }, 1, ["Peçete"]]]);
    // Yönetici Marina'nın listesine fiyat yazar (Marina seçili): yalnız Marina'nın satırı
    const marinaBase = extrasBase(await db.select().from(s.stockExtras).where(and(eq(s.stockExtras.month, "2026-10"), eq(s.stockExtras.branchId, "marina"))));
    assert.equal((await withBranchScope("marina", () => stock.saveStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 2, unitPrice: 12.5 }], marinaBase))).ok, true);
    assert.deepEqual(await list("marina"), [["Peçete", 2, 12.5]]);
    assert.deepEqual(await loadUnpricedExtras(["2026-10"]), []);
    // "Tümü" iki şubenin kalemini toplar
    const all = (await loadModel({ scope: "hepsi" })).stockSheet("2026-10");
    assert.equal(all.extrasTotal, (4 + 2) * 12.5);
    // Listeye ekle: aynı adlı ek kalem uyarısı sayılan şubenin listesine bakar
    await db.insert(s.stockExtras).values({ month: "2026-10", branchId: "tuzla", name: "Klips kapak", unit: "KOLİ", qty: 2, unitPrice: 0 });
    const added = await withBranchScope("marina", () => extras.addCountItem({ month: "2026-10", name: "Klips kapak", group: "SÜT", countUnit: "ADET", packageSize: 1 }));
    assert.ok(added.ok && added.data.extraTwin === null, "Tuzla'nın ek kalemi Marina'nın sayımında ikiz değil");
  });

  // Sonraki işler (21 Kasım denetimi, #12'nin sayım karşılığı): form gösterdiği şubeyi gönderir; başka sekmede seçici
  // değişse de (çerez sekmeler arasında ortak) kayıt o şubeye iner. withBranchScope burada gönderim anındaki seçimdir
  test("sayım formun gösterdiği şubeye yazılır, gönderim anındaki seçime değil; şube doğrulanır", async () => {
    at("2026-10-31T19:00:00Z");
    const { withBranchScope } = await import("../src/server/branch-scope");
    const qty = async (branch: string) =>
      (
        await db
          .select({ qty: s.stockCounts.qty })
          .from(s.stockCounts)
          .where(and(eq(s.stockCounts.month, "2026-10"), eq(s.stockCounts.branchId, branch), eq(s.stockCounts.ingredientId, milk)))
      )[0]?.qty ?? null;
    const rowsOf = (branch: string) => db.select().from(s.stockExtras).where(and(eq(s.stockExtras.month, "2026-10"), eq(s.stockExtras.branchId, branch)));
    const list = async (branch: string) => (await rowsOf(branch)).sort((a, b) => a.id - b.id).map((r) => [r.name, r.qty, r.unitPrice]);
    // Önceki testler Marina'ya Ekim ayı açmış olabilir (ay satırları testler arasında silinmez)
    await db.delete(s.months).where(and(eq(s.months.month, "2026-10"), eq(s.months.branchId, "marina")));
    // Tuzla'nın formu açık, öbür sekmede Marina seçildi: sayım Tuzla'ya (base Tuzla'nın 40'ı; Marina'ya inseydi çakışırdı)
    assert.deepEqual(await withBranchScope("marina", () => stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 7, base: 40 }], "tuzla")), {
      ok: true,
      data: { saved: 1, removed: 0 },
    });
    assert.equal(await qty("tuzla"), 7);
    assert.equal(await qty("marina"), null, "Marina'ya sayım inmedi");
    assert.equal((await db.select().from(s.months).where(and(eq(s.months.month, "2026-10"), eq(s.months.branchId, "marina")))).length, 0, "Marina'ya ay açılmadı");
    // Yöneticinin ek kalemleri de formun şubesine: Tuzla'nın Peçete'si fiyatlanır, Marina'nın listesi boş kalır
    const tuzlaBase = extrasBase(await rowsOf("tuzla"));
    const adminSaved = await withBranchScope("marina", () => stock.saveStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 14 }], tuzlaBase, "tuzla"));
    assert.ok(adminSaved.ok, adminSaved.ok ? "" : adminSaved.error);
    assert.deepEqual(await list("tuzla"), [["Peçete", 3, 14]]);
    assert.deepEqual(await list("marina"), []);
    // Personel Marina'nın formundan kaydeder, çerez Tuzla'da: Marina'nın listesi
    who.role = "staff";
    const staffSaved = await withBranchScope("tuzla", () => extras.saveStaffStockExtras("2026-10", [{ name: "Çöp torbası", unit: "KOLİ", qty: 1 }], extrasBase([]), "marina"));
    assert.ok(staffSaved.ok, staffSaved.ok ? "" : staffSaved.error);
    assert.deepEqual(await list("marina"), [["Çöp torbası", 1, 0]]);
    assert.deepEqual(await list("tuzla"), [["Peçete", 3, 14]]);
    // Şubeyi göndermeyen eski sekme bugünkü gibi seçili fiziksel şubeye yazar
    assert.equal((await withBranchScope("marina", () => stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 3, base: null }]))).ok, true);
    assert.equal(await qty("marina"), 3);
    assert.equal(await qty("tuzla"), 7);
    // Kanal ya da bilinmeyen şube reddedilir, hiçbir şey yazılmaz
    assert.deepEqual(await stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 1, base: 7 }], "online"), {
      ok: false,
      error: "laffogato.net kanalının stoğu olmaz; sayfayı yenileyin",
    });
    assert.deepEqual(await extras.saveStaffStockExtras("2026-10", [], undefined, "yok"), { ok: false, error: "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin" });
    assert.equal(await qty("tuzla"), 7);
    assert.deepEqual(await list("marina"), [["Çöp torbası", 1, 0]]);
    // Tuzla'ya kilitli personel Marina'nın sayımına yazamaz (eski sekme; kilit sonradan konmuş), kendi şubesine yazar
    const free = users.staff;
    users.staff = { ...free, branchId: "tuzla" };
    try {
      assert.deepEqual(await stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 1, base: 3 }], "marina"), {
        ok: false,
        error: "Hesabınız Tuzla şubesinde; Marina sayımına yazamazsınız",
      });
      assert.equal(await qty("marina"), 3);
      assert.equal((await stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 8, base: 7 }], "tuzla")).ok, true);
      assert.equal(await qty("tuzla"), 8);
    } finally {
      users.staff = free;
    }
    // Listeye ekle: aynı adlı ek kalem uyarısı formun şubesinin listesine bakar, çereze değil
    who.role = "admin";
    const added = await withBranchScope("marina", () =>
      extras.addCountItem({ month: "2026-10", name: "peçete", group: "SÜT", countUnit: "ADET", packageSize: 1, branchId: "tuzla" }),
    );
    assert.ok(added.ok, added.ok ? "" : added.error);
    assert.deepEqual(added.data.extraTwin, { name: "Peçete", qty: 3, unit: "PAKET" });
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

  test("Hammaddeler'den sayım listesine giren kalem bitmiş geçmiş ayı yarım yapmaz (B01-D2)", async () => {
    // 4 Kasım: Ekim sayımı tamam (Süt sayıldı); yönetici Hammaddeler'de sayım birimli yeni hammadde açar
    at("2026-11-04T09:00:00Z");
    assert.deepEqual(await countProgress("2026-10"), { counted: 1, total: 1 });
    const base = { category: "Toz", supplier: null, packageDesc: null, packagePrice: 500, packageSize: 1000, unit: "gr" as const, vatRate: 0.01, note: null, isEstimate: false, priceSource: "manual" as const, countGroup: "SÜT" };
    const created = await ingredients.saveIngredient({ ...base, id: null, name: "Matcha tozu", countUnit: "KG", active: true });
    assert.ok(created.ok, created.ok ? "" : created.error);
    assert.deepEqual(await countProgress("2026-10"), { counted: 1, total: 1 }, "Ekim tamam kalır");
    assert.deepEqual(await countProgress("2026-11"), { counted: 0, total: 2 }, "Kasım listesinde");
    const row = async (id: number) => (await db.select().from(s.ingredients).where(eq(s.ingredients.id, id)))[0];
    assert.equal((await row(created.data.id)).countFrom, "2026-11");
    // "Sayılmaz" hammaddeye sayım birimi verilir
    const plain = await ingredients.saveIngredient({ ...base, id: null, name: "Kakao", countUnit: null, active: true });
    assert.ok(plain.ok);
    assert.equal((await row(plain.data.id)).countFrom, null);
    assert.ok((await ingredients.saveIngredient({ ...base, id: plain.data.id, name: "Kakao", countUnit: "KG", active: true })).ok);
    assert.equal((await row(plain.data.id)).countFrom, "2026-11");
    assert.deepEqual(await countProgress("2026-10"), { counted: 1, total: 1 });
    // Sayım birimi zaten olan kalemin düzenlenmesi count_from'a dokunmaz
    await db.update(s.ingredients).set({ countFrom: "2026-09" }).where(eq(s.ingredients.id, plain.data.id));
    assert.ok((await ingredients.saveIngredient({ ...base, id: plain.data.id, name: "Kakao", countUnit: "KG", active: true, note: "not" })).ok);
    assert.equal((await row(plain.data.id)).countFrom, "2026-09");
    await db.update(s.ingredients).set({ countFrom: "2026-11" }).where(eq(s.ingredients.id, plain.data.id));
    // Pasif kalem yeniden aktif olunca bu aydan; o ay sayılmış eski ayda yine çıkar
    await db.update(s.ingredients).set({ active: false, countFrom: null }).where(eq(s.ingredients.id, milk));
    assert.deepEqual(await countProgress("2026-10"), { counted: 0, total: 0 });
    assert.ok((await ingredients.setIngredientActive(milk, true)).ok);
    assert.equal((await row(milk)).countFrom, "2026-11");
    assert.deepEqual(await countProgress("2026-10"), { counted: 1, total: 1 }, "Ekim'de sayılan Süt yine listede ve sayılmış");
    // Düzenleme penceresinden yeniden aktif etmek de aynı
    assert.ok((await ingredients.setIngredientActive(plain.data.id, false)).ok);
    assert.ok((await ingredients.saveIngredient({ ...base, id: plain.data.id, name: "Kakao", countUnit: "KG", active: true })).ok);
    assert.equal((await row(plain.data.id)).countFrom, "2026-11");
  });

  test("3 Kasım: personel Ekim sayımını düzeltebilir (ilk 10 gün)", async () => {
    at("2026-11-03T09:00:00Z");
    who.role = "staff";
    assert.deepEqual(await stock.saveStockCounts("2026-10", [{ ingredientId: milk, qty: 36, base: 40 }]), { ok: true, data: { saved: 1, removed: 0 } });
    assert.equal(await milkQty(), 36);
    const ex = await extras.saveStaffStockExtras("2026-10", [{ name: "Peçete", unit: "PAKET", qty: 2 }]);
    assert.equal(ex.ok, true);
  });

  // Denetim 21 Kasım #16: günlük işte şube seçimi yok; sabah e-postası ve ay sonu bildirimi her şubenin sayımına bakar
  test("sayım şube şube: Tuzla tamam, Marina sayılmadı; e-posta satırı ve ay sonu bildirimi Marina'yı görür", async () => {
    const { countProgressByBranch } = await import("../src/server/data/count-progress");
    const { pastCountDigestLines } = await import("../src/server/bell/ops");
    const { pushMonthEndCount } = await import("../src/server/notify/count-push");
    // İstek dışında (günlük iş) tek okuma Tuzla'yı görür: Ekim tamam
    assert.deepEqual(await countProgress("2026-10"), { counted: 1, total: 1 });
    assert.deepEqual(await countProgressByBranch("2026-10"), {
      named: true,
      open: ["tuzla", "marina"],
      counts: [
        { id: "tuzla", name: "Tuzla", progress: { counted: 1, total: 1 } },
        { id: "marina", name: "Marina", progress: { counted: 0, total: 1 } },
      ],
    });
    assert.deepEqual(await pastCountDigestLines(new Date("2026-11-03T09:00:00Z")), {
      lines: [{ text: "Marina: Ekim 2026 sayımı girilmedi. Kalanların stoğu 0 sayılır; Ekim 2026 mal maliyeti yüksek çıkar. Ayın 10'una kadar personel de girebilir.", tone: "warn" }],
      href: "/panel/sayim?ay=2026-10&sube=marina",
    });
    // Şubeye bağlı alıcının e-postası (şube kapsamı C P1-11): Tuzla'nın adresi Marina'nın yarım sayımını almaz
    assert.deepEqual(await pastCountDigestLines(new Date("2026-11-03T09:00:00Z"), "tuzla"), { lines: [], href: null });
    assert.equal((await pastCountDigestLines(new Date("2026-11-03T09:00:00Z"), "marina")).lines.length, 1);
    // Ayın son günü: Marina yarım, bildirim gider (abonelik yok, sayı 0); ikisi de tamamsa gitmez
    assert.deepEqual(await pushMonthEndCount(new Date("2026-10-31T09:00:00Z")), { status: "sent", sent: 0, failed: 0 });
    await db.insert(s.stockCounts).values({ month: "2026-10", branchId: "marina", ingredientId: milk, qty: 12, factor: 1000, countedBy: "Selin" });
    assert.deepEqual(await pastCountDigestLines(new Date("2026-11-03T09:00:00Z")), { lines: [], href: null });
    assert.deepEqual(await pushMonthEndCount(new Date("2026-10-31T09:00:00Z")), { status: "skip", sent: 0, failed: 0 });
    // Ekim'den sonra açılan şube Ekim'i saymaz (satırı yok); ad yine yazılır (iki şube açık)
    await db.delete(s.stockCounts).where(eq(s.stockCounts.branchId, "marina"));
    await db.update(s.branches).set({ openedOn: "2026-11-04" }).where(eq(s.branches.id, "marina"));
    try {
      const october = await countProgressByBranch("2026-10");
      assert.deepEqual(october.counts.map((c) => c.id), ["tuzla"]);
      assert.equal(october.named, true);
      assert.deepEqual((await countProgressByBranch("2026-11")).counts.map((c) => c.id), ["tuzla", "marina"]);
    } finally {
      await db.update(s.branches).set({ openedOn: null }).where(eq(s.branches.id, "marina"));
    }
  });
});
