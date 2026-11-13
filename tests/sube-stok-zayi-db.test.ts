// Şube 3: stok ve zayi, gerçek Postgres'te (denetim 13 Kasım 2026, P04). "Listede olmayanlar" şube başına (ST-01):
// Marina Tuzla'nın ek kalemini görmez, aynı adla yazınca kendi satırı açılır, kendi listesini kaydedince Tuzla'nınki
// silinmez. Zayi okumaları şubeye göre (ST-02): Marina'nın günü ve kasa özeti Tuzla'nın ikramını saymaz. Zayinin kasa
// kilidi şube içinde (ST-03). Ay sonu sayım bildirimi, sabah e-postası ve "Tümü"deki zil açık her fiziksel şubeye bakar
// (ST-04). LafPOS'un ürün ikramı reddi yalnız kasası LafPOS olan şubede (ST-X1).
//
// SUBE_TEST_DATABASE_URL (yoksa SAYIM_TEST_DATABASE_URL) verilmezse atlanır. Test kendi geçici veritabanını açar,
// migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sube-stok-zayi-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { and, asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { extrasBase } from "../src/app/panel/sayim/logic";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import type { CashReportFields } from "../src/lib/cash-report";
import { WASTE_REQUEST_TEXT } from "../src/lib/waste-requests";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const SERVER_URL = process.env.SUBE_TEST_DATABASE_URL ?? process.env.SAYIM_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_stok_zayi_${process.pid}`;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

describe("şube 3: ek kalem, zayi, kasa kilidi, sayım hatırlatması ve LafPOS ikramı şube başına", { skip: !SERVER_URL && "SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let stock: typeof import("../src/server/actions/stock");
  let sayim: typeof import("../src/app/panel/sayim/actions");
  let dataset: typeof import("../src/server/data/dataset");
  let alerts: typeof import("../src/server/data/count-alerts");
  let branches: typeof import("../src/server/branches");
  let waste: typeof import("../src/server/data/waste");
  let core: typeof import("../src/server/waste/core");
  let store: typeof import("../src/server/cash/report-store");
  let cashActions: typeof import("../src/server/actions/cash-report");
  let progress: typeof import("../src/server/data/count-progress");
  let ops: typeof import("../src/server/bell/ops");
  let countPush: typeof import("../src/server/notify/count-push");
  let lafposAdmin: typeof import("../src/server/lafpos/admin");
  let lafposIkram: typeof import("../src/server/data/lafpos-ikram");
  type Who = { id: number; name: string; email: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin" },
    ayse: { id: 0, name: "Ayşe", email: "ayse@laffogato.net", role: "staff" },
  };
  /** Oturumdaki kullanıcı (src/server/auth/dal taklidi) */
  let me: Who = users.ali;
  /** Gönderilen bildirimler (src/server/push/send taklidi) */
  const pushes: { title: string; url: string; tag: string }[] = [];
  const ids = { latte: 0, milk: 0, sugar: 0 };

  const at = (d: Date) => mock.timers.enable({ apis: ["Date"], now: d });
  const fields = (date: string): CashReportFields & { discounts: number | null } => ({
    date,
    zNo: "1200",
    receipts: 10,
    zTotal: 20_000,
    cash: 8_000,
    card: 12_000,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 1_000,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 9_000,
    handedOver: 8_000,
    bankPos: null,
    offRevenue: 0,
    note: "deneme",
    discounts: 0,
  });
  /** Şubenin raporu, yöneticinin elinden */
  async function report(date: string, branch: "tuzla" | "marina") {
    const out = await withBranchScope(branch, () => store.saveCashReport(db, users.ali, { ...fields(date), countedBy: null, revision: 0, photos: [] }, tr(`${date}T22:00`)));
    assert.equal(out.kind, "saved");
  }
  const input = (date: string, kind: "zayi" | "ikram", product: boolean, qty: number) => ({
    date,
    kind,
    productId: product ? ids.latte : null,
    ingredientId: product ? null : ids.milk,
    qty,
    reason: null,
    note: null,
  });
  const refused = async (p: Promise<unknown>, re: RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && re.test(e.message.replace(/[  ]/g, " ")));
  };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sube-stok-zayi-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    delete process.env.KARAOKE_SYNC_SECRET;
    delete process.env.RESEND_API_KEY;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum, sayfa yenileme ve bildirim taklit edilir
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const session = async () => ({ id: me.id, name: me.name, email: me.email, role: me.role });
    stub(require.resolve("../src/server/auth/dal"), {
      getCurrentUser: session,
      requireUser: session,
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("yönetici değil");
        return session();
      },
    });
    stub(require.resolve("../src/server/push/send"), {
      sendPush: async (_topic: string, payload: { title: string; url: string; tag: string }) => {
        pushes.push({ title: payload.title, url: payload.url, tag: payload.tag });
        return { sent: 1, failed: 0 };
      },
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b })))
      .onConflictDoNothing();
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: users[k].email, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
    stock = await import("../src/server/actions/stock");
    sayim = await import("../src/app/panel/sayim/actions");
    dataset = await import("../src/server/data/dataset");
    alerts = await import("../src/server/data/count-alerts");
    branches = await import("../src/server/branches");
    waste = await import("../src/server/data/waste");
    core = await import("../src/server/waste/core");
    store = await import("../src/server/cash/report-store");
    cashActions = await import("../src/server/actions/cash-report");
    progress = await import("../src/server/data/count-progress");
    ops = await import("../src/server/bell/ops");
    countPush = await import("../src/server/notify/count-push");
    lafposAdmin = await import("../src/server/lafpos/admin");
    lafposIkram = await import("../src/server/data/lafpos-ikram");
  });

  after(async () => {
    mock.timers.reset();
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    me = users.ali;
    pushes.length = 0;
    await db.execute(
      sql`TRUNCATE stock_counts, stock_extras, waste_entries, cash_reports, cash_outs, pos_day_reports, staff_requests, special_days, activity_log, photos RESTART IDENTITY CASCADE`,
    );
    await db.execute(sql`DELETE FROM months`);
    await db.execute(sql`DELETE FROM settings WHERE key = 'lafposGecisGunu'`);
    await db.execute(sql`DELETE FROM recipe_items`);
    await db.execute(sql`DELETE FROM products`);
    await db.execute(sql`DELETE FROM categories`);
    await db.execute(sql`DELETE FROM ingredients`);
    await db.update(s.branches).set({ active: true, openedOn: null });
    await db.update(s.branches).set({ posSource: "modpos" }).where(eq(s.branches.kind, "fiziksel"));
    const [c] = await db.insert(s.categories).values({ name: "Kahveler", sortOrder: 1 }).returning();
    ids.latte = (await db.insert(s.products).values({ categoryId: c.id, name: "Latte", size: "M", price: 170 }).returning())[0].id;
    const ing = await db
      .insert(s.ingredients)
      .values([
        { name: "Süt", category: "Süt", unit: "ml", countUnit: "LT", countGroup: "SÜT", packagePrice: 100, packageSize: 1000, vatRate: 0.01 },
        { name: "Şeker", category: "Kuru", unit: "gr", countUnit: "KG", countGroup: "KURU", packagePrice: 40, packageSize: 1000, vatRate: 0.01 },
      ])
      .returning({ id: s.ingredients.id });
    [ids.milk, ids.sugar] = ing.map((i) => i.id);
    await db.insert(s.recipeItems).values({ productId: ids.latte, ingredientId: ids.milk, qty: 200 });
  });
  afterEach(() => mock.timers.reset());

  const extrasOf = async (branch: string) =>
    (await db.select().from(s.stockExtras).where(and(eq(s.stockExtras.month, "2026-11"), eq(s.stockExtras.branchId, branch))).orderBy(asc(s.stockExtras.id))).map((e) => [
      e.name,
      e.qty,
      e.unitPrice,
    ]);

  test("ST-01: Marina'nın sayımı Tuzla'nın ek kalemini görmez; aynı adla yazınca kendi satırı açılır, Tuzla'nınki yerinde kalır", async () => {
    at(tr("2026-11-20T10:00"));
    const tuzla = await withBranchScope("tuzla", () => stock.saveStockExtras("2026-11", [{ name: "Kağıt havlu", unit: "ADET", qty: 10, unitPrice: 50 }], extrasBase([])));
    assert.equal(tuzla.ok, true);
    // Marina'nın stok ekranı boş; Tümü şubelerin toplamı
    const marinaSheet = (await dataset.loadModel({ scope: "marina" })).stockSheet("2026-11");
    assert.deepEqual(marinaSheet.extras, []);
    assert.equal(marinaSheet.hasData, false);
    assert.equal((await dataset.loadModel({ scope: "hepsi" })).stockSheet("2026-11").extras.length, 1);
    // Marina personeli aynı adla 3 yazar: Marina'ya ayrı satır, Tuzla'nın 10'u yerinde; ay satırı Marina'nın
    me = users.ayse;
    const staff = await withBranchScope("marina", () => sayim.saveStaffStockExtras("2026-11", [{ name: "Kağıt havlu", unit: "ADET", qty: 3 }], extrasBase([])));
    assert.deepEqual(staff, { ok: true, data: [{ name: "Kağıt havlu", unit: "ADET", qty: 3, priced: false }] });
    assert.deepEqual(await extrasOf("tuzla"), [["Kağıt havlu", 10, 50]]);
    assert.deepEqual(await extrasOf("marina"), [["Kağıt havlu", 3, 0]]);
    const monthRows = await db.select({ b: s.months.branchId }).from(s.months).where(eq(s.months.month, "2026-11"));
    assert.deepEqual(monthRows.map((r) => r.b).sort(), ["marina", "tuzla"]);
    // Kilit ve imza şube içinde: Tuzla'nın formu (gördüğü liste kendi listesi) Marina'nın kaydından sonra da yazar
    me = users.ali;
    const tuzlaAgain = await withBranchScope("tuzla", () =>
      stock.saveStockExtras("2026-11", [{ name: "Kağıt havlu", unit: "ADET", qty: 12, unitPrice: 50 }], extrasBase([{ name: "Kağıt havlu", unit: "ADET", qty: 10 }])),
    );
    assert.equal(tuzlaAgain.ok, true);
    // Fiyatsız ek kalem uyarısı: "Tümü"de Marina'nın satırı adıyla ve Marina'yı seçen adresle; Tuzla seçiliyken yok
    const all = await withBranchScope("hepsi", () => alerts.loadUnpricedExtras(["2026-11"]));
    assert.deepEqual(all.map((u) => [u.month, u.branch, u.count, u.names]), [["2026-11", { id: "marina", label: "Marina" }, 1, ["Kağıt havlu"]]]);
    assert.deepEqual(await withBranchScope("tuzla", () => alerts.loadUnpricedExtras(["2026-11"])), []);
    // Şube silme engeli ek kalemi de sayar
    assert.ok((await branches.branchUsageCount(db, "marina")) > 0);
    // Marina yöneticisi kendi listesini boşaltır: Tuzla'nın satırı silinmez
    const cleared = await withBranchScope("marina", () => stock.saveStockExtras("2026-11", [], extrasBase([{ name: "Kağıt havlu", unit: "ADET", qty: 3 }])));
    assert.equal(cleared.ok, true);
    assert.deepEqual(await extrasOf("marina"), []);
    assert.deepEqual(await extrasOf("tuzla"), [["Kağıt havlu", 12, 50]]);
  });

  test("ST-02: zayi şube başına okunur: Marina'nın günü, kasa özeti ve WhatsApp metni Tuzla'nın ikramını saymaz", async () => {
    at(tr("2026-11-12T23:00"));
    await withBranchScope("tuzla", () => core.addWaste(db, users.ali, input("2026-11-12", "ikram", true, 3)));
    assert.deepEqual(await withBranchScope("marina", () => waste.wasteEntriesBetween("2026-11-12", "2026-11-12")), []);
    assert.equal((await withBranchScope("hepsi", () => waste.wasteEntriesBetween("2026-11-12", "2026-11-12"))).length, 1);
    const marina = await withBranchScope("marina", () => waste.dayWaste("2026-11-12"));
    assert.deepEqual([marina.count, marina.ikram, marina.ikramValue], [0, null, 0]);
    const tuzla = await withBranchScope("tuzla", () => waste.dayWaste("2026-11-12"));
    assert.deepEqual([tuzla.count, tuzla.ikram, tuzla.ikramValue], [1, "3× Latte M", 510]);
    // Ay özetinin rakamı ve kalem listesi aynı kapsamdan
    const sum = (await dataset.loadModel({ scope: "marina" })).wasteSummary("2026-11");
    assert.equal(sum.ikram.count, 0);
    // Marina'nın kasa raporunun WhatsApp metni Tuzla'nın ikramını yazmaz
    await report("2026-11-12", "marina");
    const wa = await withBranchScope("marina", () => cashActions.cashReportWhatsapp("2026-11-12"));
    assert.ok(wa.ok);
    assert.doesNotMatch(wa.data.text, /Latte/);
  });

  test("ST-03: zayinin kasa kilidi şube içinde: Tuzla'nın raporları Marina personelinin dününü kilitlemez", async () => {
    await report("2026-11-11", "tuzla");
    await report("2026-11-12", "tuzla");
    assert.deepEqual(await core.wasteLock(db, "2026-11-11", "tuzla"), { hasReport: true, laterReport: true });
    assert.deepEqual(await core.wasteLock(db, "2026-11-11", "marina"), { hasReport: false, laterReport: false });
    const now = tr("2026-11-12T23:00");
    at(now);
    // Marina personeli dünün zayisini doğrudan girer ve kendi kaydını siler
    const added = await withBranchScope("marina", () => core.addWaste(db, users.ayse, input("2026-11-11", "zayi", false, 0.5), now));
    const [row] = await db.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, added.id));
    assert.equal(row.branchId, "marina");
    await core.removeWaste(db, users.ayse, added.id, now);
    // Tuzla personelinin dünü kapandı (kendi raporlarıyla)
    await refused(
      withBranchScope("tuzla", () => core.addWaste(db, users.ayse, input("2026-11-11", "zayi", false, 0.5), now)),
      new RegExp(WASTE_REQUEST_TEXT.directOnly.slice(0, 30).replace(/[()]/g, "\\$&")),
    );
  });

  test("ST-04: sayım hatırlatması açık her fiziksel şubeye bakar: Tuzla bitirdi diye Marina'nın eksiği susmaz", async () => {
    await db.insert(s.months).values({ month: "2026-10", branchId: "tuzla" });
    await db.insert(s.stockCounts).values([
      { month: "2026-10", branchId: "tuzla", ingredientId: ids.milk, qty: 4, factor: 1000 },
      { month: "2026-10", branchId: "tuzla", ingredientId: ids.sugar, qty: 2, factor: 1000 },
    ]);
    // İstek dışı (günlük iş, sabah e-postası): iki şube (Marina'nın açılış günü boş: açık sayılır); Marina'nın sayımı yok
    const rows = await progress.countProgressByBranch("2026-10");
    assert.deepEqual(rows, [
      { id: "tuzla", label: "Tuzla", counted: 2, total: 2 },
      { id: "marina", label: "Marina", counted: 0, total: 2 },
    ]);
    // Tek şube seçiliyken yalnız o şube
    assert.deepEqual(await withBranchScope("tuzla", () => progress.countProgressByBranch("2026-10")), [{ id: "tuzla", label: "Tuzla", counted: 2, total: 2 }]);
    // Sabah e-postası (3 Kasım): Marina'nın satırı, adres Marina'yı seçer
    const digest = await ops.pastCountDigestLines(tr("2026-11-03T08:00"));
    assert.deepEqual(digest, {
      lines: [{ text: "Marina · Ekim 2026 sayımı girilmedi. Kalanların stoğu 0 sayılır; Ekim 2026 mal maliyeti yüksek çıkar. Ayın 10'una kadar personel de girebilir.", tone: "warn" }],
      href: "/panel/sayim?ay=2026-10&sube=marina",
    });
    // "Tümü"deki zil Marina'nın satırını gösterir
    at(tr("2026-11-03T08:00"));
    const bell = await withBranchScope("hepsi", () => ops.opsBell({ id: users.ali.id, name: "Ali", email: users.ali.email, role: "admin" } as never));
    assert.deepEqual(
      bell.filter((n) => n.id.startsWith("sayim-gecen")).map((n) => [n.id, n.title]),
      [["sayim-gecen-2026-10-marina", "Marina · Ekim 2026 sayımı girilmedi"]],
    );
    // Ay sonu bildirimi (31 Ekim): Marina için bir bildirim, kendi etiketiyle
    await countPush.pushMonthEndCount(tr("2026-10-31T09:00"));
    assert.deepEqual(pushes, [{ title: "Marina · Bugün ay sonu stok sayımı", url: "/panel/sayim?ay=2026-10&sube=marina", tag: "sayim-son-2026-10-marina" }]);
    // Açılış günü sonraki bir aydaysa o aya hatırlatılmaz
    await db.update(s.branches).set({ openedOn: "2026-11-04" }).where(eq(s.branches.id, "marina"));
    assert.deepEqual(
      (await progress.countProgressByBranch("2026-10")).map((r) => r.id),
      ["tuzla"],
    );
  });

  test("ST-X1: LafPOS'un ürün ikramı reddi yalnız kasası LafPOS olan şubede; ModPOS'lu Marina panele girer ve sayılır", async () => {
    // Geçiş günü kaydı Tuzla'nın kasasını LafPOS yapar
    await lafposAdmin.writeLafposSwitchDay(db, users.ali, "2026-11-10", "2026-11-12");
    const [tz] = await db.select({ p: s.branches.posSource }).from(s.branches).where(eq(s.branches.id, "tuzla"));
    assert.equal(tz.p, "lafpos");
    const now = tr("2026-11-12T12:00");
    at(now);
    // Bugün: Marina'nın ürün ikramı girer, Tuzla'nınki LafPOS'ta işaretlenir
    await withBranchScope("marina", () => core.addWaste(db, users.ali, input("2026-11-12", "ikram", true, 1), now));
    await refused(withBranchScope("tuzla", () => core.addWaste(db, users.ali, input("2026-11-12", "ikram", true, 1), now)), /LafPOS'ta işaretlenir/);
    assert.equal(await withBranchScope("marina", () => lafposIkram.loadDayLafposIkram("2026-11-12")), null);
    assert.equal((await withBranchScope("tuzla", () => lafposIkram.loadDayLafposIkram("2026-11-12")))?.branchId, "tuzla");
    // Tuzla'nın 11 Kasım gün sonu geldi: Marina'nın o günkü ürün ikramı girer ve "Tümü"de sayılır; Tuzla'nın panel ikramı sayılmaz
    await db.insert(s.posDayReports).values({ date: "2026-11-11", branchId: "tuzla", z: { offRevenue: 0 } as never, payments: [], ikram: [], source: "lafpos" });
    await withBranchScope("marina", () => core.addWaste(db, users.ali, input("2026-11-11", "ikram", true, 2), now));
    await refused(withBranchScope("tuzla", () => core.addWaste(db, users.ali, input("2026-11-11", "ikram", true, 2), now)), /LafPOS'ta işaretlenir/);
    await db.insert(s.wasteEntries).values({ date: "2026-11-11", branchId: "tuzla", kind: "ikram", productId: ids.latte, name: "Latte M", unit: "adet", factor: 1, qty: 5, createdByName: "Eski" });
    const all = (await dataset.loadModel({ scope: "hepsi" })).wasteSummary("2026-11");
    assert.deepEqual([all.ikram.count, all.notCounted], [2, 1]);
    const marinaDay = await withBranchScope("marina", () => waste.dayWaste("2026-11-11"));
    assert.deepEqual([marinaDay.ikram, marinaDay.lafpos], ["2× Latte M", null]);
    // Geçiş günü silinince Tuzla'nın kasası yeniden ModPOS
    await lafposAdmin.writeLafposSwitchDay(db, users.ali, null, "2026-11-12");
    const [back] = await db.select({ p: s.branches.posSource }).from(s.branches).where(eq(s.branches.id, "tuzla"));
    assert.equal(back.p, "modpos");
  });
});
