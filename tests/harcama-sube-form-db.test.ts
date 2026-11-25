// Giderin şubesi formun seçtiği (24 Kasım 2026 şube kapsamı, plan › A1.3; docs/SUBE.md › Yazarken hangi şube), gerçek
// Postgres'te:
//
// - Aylık harcamalar: yeni kayıt formda seçilen şubeye ya da "İşletme geneli"ne; gönderim anındaki seçim (çerez; testte
//   withBranchScope) yazımın şubesini seçmez. Şubeyi göndermeyen eski sekme ve asistan bugünkü gibi (seçili şube,
//   "Tümü"de işletme geneli). Düzeltme şubeyi değiştirebilir; kasadan çıkan fişin ve cari borcun gideri değiştiremez.
// - Cari "Faturası yok · gider yaz": gider kaydı pencerede seçilen şubeye; düzeltmede seçilmezse şubesi kalır.
//
// HARCAMA_SUBE_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: HARCAMA_SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/harcama-sube-form-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES, EXPENSE_SHARED } from "../src/lib/branches";
import { todayTR } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";
import { seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.HARCAMA_SUBE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_harcama_sube_${process.pid}`;

describe("giderin şubesi: formun seçtiği (veritabanında)", { skip: !SERVER_URL && "HARCAMA_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let expenses: typeof import("../src/server/actions/expenses");
  let cari: typeof import("../src/server/actions/cari");
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let catId = 0;
  const today = todayTR();

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "harcama-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    const [u] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => u;
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    expenses = await import("../src/server/actions/expenses");
    cari = await import("../src/server/actions/cari");
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE supplier_allocations, supplier_entries, expense_entries, expense_categories, suppliers, cash_outs, activity_log RESTART IDENTITY CASCADE`);
    const [c] = await db.insert(s.expenseCategories).values({ name: "Reklam", section: "genel" }).returning();
    catId = c.id;
  });

  const entry = (p: { id?: number | null; amount?: number; branchId?: string | null }) => ({
    id: p.id ?? null,
    date: today,
    categoryId: catId,
    description: "Instagram",
    amount: p.amount ?? 1_000,
    paymentMethod: null,
    note: null,
    ...(p.branchId !== undefined ? { branchId: p.branchId } : {}),
  });
  const branchOf = async (id: number) => (await db.select({ b: s.expenseEntries.branchId }).from(s.expenseEntries).where(eq(s.expenseEntries.id, id)))[0]?.b;
  const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }): T => {
    if (!r.ok) assert.fail(r.error);
    return r.data;
  };

  test("harcama formun şubesine; 'İşletme geneli' açık seçim; eski sekme bugünkü kuralla", async () => {
    // Çerez Tuzla'da (başka sekmede değişti), form Marina'nın
    const marina = ok(await withBranchScope("tuzla", () => expenses.saveExpenseEntry(entry({ branchId: "marina" }))));
    assert.equal(await branchOf(marina.id), "marina");
    // Şube seçiliyken açıkça işletme geneli
    const shared = ok(await withBranchScope("marina", () => expenses.saveExpenseEntry(entry({ branchId: EXPENSE_SHARED }))));
    assert.equal(await branchOf(shared.id), null);
    // Şube göndermeyen eski sekme / asistan: seçili şube, "Tümü"de işletme geneli
    assert.equal(await branchOf(ok(await withBranchScope("marina", () => expenses.saveExpenseEntry(entry({})))).id), "marina");
    assert.equal(await branchOf(ok(await withBranchScope(ALL_BRANCHES, () => expenses.saveExpenseEntry(entry({})))).id), null);
    // Bilinmeyen şube reddedilir, hiçbir şey yazılmaz
    const before = (await db.select().from(s.expenseEntries)).length;
    assert.deepEqual(await expenses.saveExpenseEntry(entry({ branchId: "yok" })), { ok: false, error: "Formun şubesi bulunamadı ya da kapalı; sayfayı yenileyin" });
    assert.equal((await db.select().from(s.expenseEntries)).length, before);
  });

  test("düzeltme şubeyi değiştirir; göndermeyen düzeltmede ve aynı şubede dokunulmaz; kaynağa bağlı kayıtta red", async () => {
    const { id } = ok(await expenses.saveExpenseEntry(entry({ branchId: "tuzla" })));
    ok(await withBranchScope("marina", () => expenses.saveExpenseEntry(entry({ id, amount: 1_200 }))));
    assert.equal(await branchOf(id), "tuzla", "şube göndermeyen düzeltme şubeyi değiştirmez (çerez Marina)");
    ok(await expenses.saveExpenseEntry(entry({ id, branchId: "marina" })));
    assert.equal(await branchOf(id), "marina");
    ok(await expenses.saveExpenseEntry(entry({ id, branchId: EXPENSE_SHARED })));
    assert.equal(await branchOf(id), null);
    // Kasadan çıkan fişin gideri: şubesi kasanın
    const [out] = await db.insert(s.cashOuts).values({ date: today, kind: "harcama", amount: 300, branchId: "tuzla", createdByName: "Ayşe" }).returning();
    const [linked] = await db
      .insert(s.expenseEntries)
      .values({ date: today, categoryId: catId, amount: 300, branchId: "tuzla", cashOutId: out.id, createdBy: "Kasa" })
      .returning();
    assert.deepEqual(await expenses.saveExpenseEntry({ ...entry({ id: linked.id, amount: 300, branchId: "marina" }) }), {
      ok: false,
      error: "Bu harcama kasadan çıkan bir fişten; şubesi o kasanın şubesidir, değiştirilemez",
    });
    // Aynı şubeyle (formun varsayılanı) açıklama düzeltilir
    ok(await expenses.saveExpenseEntry({ ...entry({ id: linked.id, amount: 300, branchId: "tuzla" }), description: "Fiş" }));
    assert.equal(await branchOf(linked.id), "tuzla");
  });

  test("cari 'Faturası yok · gider yaz': gider kaydı pencerenin şubesine; düzeltmede seçilmezse kalır", async () => {
    const [card] = await db.insert(s.suppliers).values({ name: "Bakkal", key: "bakkal" }).returning();
    const debt = (p: { id?: number | null; amount?: number; expenseBranch?: string | null }) =>
      cari.saveSupplierDebt({
        target: { cardId: card.id },
        id: p.id ?? null,
        date: today,
        amount: p.amount ?? 500,
        description: "süt",
        costMode: "gider",
        categoryId: catId,
        adoptExpenseId: null,
        dueDate: null,
        note: null,
        photoId: null,
        applyCredit: false,
        paid: null,
        confirmPast: [],
        ...(p.expenseBranch !== undefined ? { expenseBranch: p.expenseBranch } : {}),
      });
    const expenseOf = async (debtId: number) => (await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.supplierEntryId, debtId)))[0];
    // Çerez Tümü'de, pencere Marina'yı seçti
    const created = ok(await withBranchScope(ALL_BRANCHES, () => debt({ expenseBranch: "marina" }))) as { id: number };
    assert.equal((await expenseOf(created.id)).branchId, "marina");
    // Şube göndermeyen düzeltme (eski sekme, Geri al) şubeye dokunmaz
    ok(await withBranchScope("tuzla", () => debt({ id: created.id, amount: 600 })));
    assert.equal((await expenseOf(created.id)).branchId, "marina");
    assert.equal((await expenseOf(created.id)).amount, 600);
    // Pencerede değiştirilince değişir
    ok(await debt({ id: created.id, amount: 600, expenseBranch: EXPENSE_SHARED }));
    assert.equal((await expenseOf(created.id)).branchId, null);
    // Aylık harcamalar'dan cari giderinin şubesi değiştirilemez
    const own = await expenseOf(created.id);
    assert.deepEqual(await expenses.saveExpenseEntry({ ...entry({ id: own.id, amount: 600, branchId: "tuzla" }), description: own.description }), {
      ok: false,
      error: "Bu harcama Bakkal tedarikçisinin faturasız alımından; şubesini Tedarikçiler'de düzeltin",
    });
  });
});
