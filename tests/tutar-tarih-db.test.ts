// Tutar ve tarih denetimleri gerçek Postgres'te, oturum ve next/cache taklit edilerek (denetim 13 Kasım 2026, FC-06 ve
// KP-09; src/server/actions/util.ts zDate, zSignedAmount; src/server/actions/expenses.ts saveExpenseEntry;
// src/server/actions/invoices.ts saveInvoice): takvimde olmayan gün (30 Şubat, ay 00) hiçbir eylemden yazılmaz;
// Aylık harcamalar'da tutar en çok ±100.000.000 ₺ (eksi bilerek serbest: iade, düzeltme), tarih en çok bir ay ileri,
// pasif kategoriye yeni harcama yazılmaz; faturada da aynı tutar sınırı.
//
// TUTAR_TEST_DATABASE_URL (yoksa CARI_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: CARI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/tutar-tarih-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { addDays, todayTR } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.TUTAR_TEST_DATABASE_URL ?? process.env.CARI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_tutar_tarih_${process.pid}`;

describe("tutar ve tarih denetimleri: veritabanında", { skip: !SERVER_URL && "TUTAR_TEST_DATABASE_URL ya da CARI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let util: typeof import("../src/server/actions/util");
  let expenses: typeof import("../src/server/actions/expenses");
  let invoices: typeof import("../src/server/actions/invoices");
  const today = todayTR();

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "tutar-tarih-testi-icin-en-az-otuz-iki-karakter" });
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
    const [u] = await db.insert(s.users).values({ email: "tutar@laffogato.net", name: "Test", passwordHash: "x", role: "admin" }).returning();
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => ({ ...u, role: "admin" }), requireUser: async () => ({ ...u, role: "admin" }) });
    util = await import("../src/server/actions/util");
    expenses = await import("../src/server/actions/expenses");
    invoices = await import("../src/server/actions/invoices");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE expense_entries, expense_categories, invoices, activity_log RESTART IDENTITY CASCADE`);
  });

  const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }): T => {
    if (!r.ok) assert.fail(r.error);
    return r.data;
  };
  const refused = (r: { ok: true } | { ok: false; error: string }, pattern: RegExp, what: string) => {
    assert.equal(r.ok, false, `${what}: kabul edildi`);
    if (!r.ok) assert.match(r.error, pattern, what);
  };
  async function category(name = "Reklam", active = true) {
    const [c] = await db.insert(s.expenseCategories).values({ name, active }).returning();
    return c;
  }
  const entry = (categoryId: number, p: { amount?: number; date?: string; id?: number | null } = {}) => ({
    id: p.id ?? null,
    date: p.date ?? today,
    categoryId,
    description: "kampanya",
    amount: p.amount ?? 1500,
    paymentMethod: "kart" as const,
    note: null,
  });

  test("zDate (KP-09): takvimde olmayan gün reddedilir; bütün eylemler aynı denetimi kullanır", () => {
    for (const d of ["2026-11-13", "2024-02-29"]) assert.equal(util.zDate.safeParse(d).success, true, d);
    for (const d of ["2026-02-30", "2026-00-10", "2026-13-45", "2026-11-31", "13.11.2026"]) {
      const r = util.zDate.safeParse(d);
      assert.equal(r.success, false, d);
      assert.equal(r.error?.issues[0].message, "Geçersiz tarih", d);
    }
  });

  test("Aylık harcamalar (FC-06): tutar en çok ±100 milyon ₺, eksi serbest; takvimde olmayan ve bir aydan ileri gün yazılmaz", async () => {
    const c = await category();
    refused(await expenses.saveExpenseEntry(entry(c.id, { amount: 125_000_000_000 })), /Tutar çok büyük/, "125 milyar");
    refused(await expenses.saveExpenseEntry(entry(c.id, { amount: -125_000_000_000 })), /Tutar çok büyük/, "eksi 125 milyar");
    refused(await expenses.saveExpenseEntry(entry(c.id, { amount: 0 })), /Tutar girin/, "sıfır");
    refused(await expenses.saveExpenseEntry(entry(c.id, { date: "2026-13-45" })), /Geçersiz tarih/, "13. ay");
    refused(await expenses.saveExpenseEntry(entry(c.id, { date: "2026-02-30" })), /Geçersiz tarih/, "30 Şubat");
    refused(await expenses.saveExpenseEntry(entry(c.id, { date: "2030-01-01" })), /bir aydan daha ileri/, "2030");
    refused(await expenses.saveExpenseEntry(entry(c.id, { date: addDays(today, 32) })), /bir aydan daha ileri/, "32 gün ileri");
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
    // Eksi tutar (iade, düzeltme), sınırdaki tutar ve gelecek ayın önceden girilen ödemesi yazılır
    ok(await expenses.saveExpenseEntry(entry(c.id, { amount: -500 })));
    ok(await expenses.saveExpenseEntry(entry(c.id, { amount: 100_000_000 })));
    const ahead = ok(await expenses.saveExpenseEntry(entry(c.id, { date: addDays(today, 31) })));
    assert.equal((await db.select().from(s.expenseEntries)).length, 3);
    // Var olan kayıt da ileri bir güne taşınamaz
    refused(await expenses.saveExpenseEntry(entry(c.id, { id: ahead.id, date: "2030-01-01" })), /bir aydan daha ileri/, "düzeltmede 2030");
  });

  test("Aylık harcamalar (FC-06): pasif kategoriye yeni harcama yazılmaz; var olan kaydı düzeltmek serbest", async () => {
    const c = await category("Eski kategori");
    const saved = ok(await expenses.saveExpenseEntry(entry(c.id)));
    await db.update(s.expenseCategories).set({ active: false }).where(eq(s.expenseCategories.id, c.id));
    refused(await expenses.saveExpenseEntry(entry(c.id)), /Eski kategori pasif/, "pasif kategoriye yeni");
    ok(await expenses.saveExpenseEntry({ ...entry(c.id, { id: saved.id }), description: "düzeltildi" }));
    const rows = await db.select().from(s.expenseEntries);
    assert.deepEqual(rows.map((r) => r.description), ["düzeltildi"]);
  });

  test("Faturalar (FC-06): tutar ve ödenecek en çok ±100 milyon ₺; iade faturasının eksi tutarı yazılır", async () => {
    const form = { id: null, date: today, supplier: "Sütaş", description: "", invoiceNo: "", category: "Hammadde & İçecek", amount: 1000, discount: 0, payable: 1100, unpaid: true, note: "" };
    refused(await invoices.saveInvoice({ ...form, amount: 125_000_000_000, payable: 137_500_000_000 }), /Tutar çok büyük/, "125 milyar");
    refused(await invoices.saveInvoice({ ...form, date: "2026-02-30" }), /Geçersiz tarih/, "30 Şubat");
    assert.equal((await db.select().from(s.invoices)).length, 0);
    ok(await invoices.saveInvoice({ ...form, amount: -1000, payable: -1100 }));
    assert.equal((await db.select().from(s.invoices)).length, 1);
  });
});
