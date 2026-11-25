// Faturanın şubesi gerçek Postgres'te (docs/SUBE.md › Faturanın şubesi): göçün "Marina'ya gelen faturalar" seçimini
// faturanın şubesine taşıması (tahminle şube yazmaz), şube seçimi eylemi (toplu, geri al, tedarikçinin varsayılanı),
// tedarikçi kartının varsayılanı (yeni elle fatura ve şubesi seçilmemiş faturalara), kapsamlı okuma (Tuzla seçiliyken
// Tuzla'nın ve işletme genelinin faturaları; seçilmemiş yok) ve kutunun kanıta dayalı önerisi (kasadan ödeme).
//
// FATURA_SUBE_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: FATURA_SUBE_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/fatura-sube-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.FATURA_SUBE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_fatura_sube_${process.pid}`;

describe("faturanın şubesi: veritabanında", { skip: !SERVER_URL && "FATURA_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let invoices: typeof import("../src/server/actions/invoices");
  let suppliers: typeof import("../src/server/actions/suppliers");
  let dataset: typeof import("../src/server/data/dataset");
  let box: typeof import("../src/server/data/invoice-branch");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "fatura-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true, ...(b.id === "marina" ? { openedOn: "2026-11-13" } : {}) })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true, openedOn: sql`excluded.opened_on` } });
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    invoices = await import("../src/server/actions/invoices");
    suppliers = await import("../src/server/actions/suppliers");
    dataset = await import("../src/server/data/dataset");
    box = await import("../src/server/data/invoice-branch");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE invoices, suppliers, cash_outs, activity_log RESTART IDENTITY CASCADE`);
  });

  const inv = (date: string, supplier: string, amount: number, extra: Partial<typeof s.invoices.$inferInsert> = {}) => ({
    date,
    supplier,
    category: "Hammadde & İçecek",
    amount,
    discount: 0,
    payable: amount * 1.1,
    vat: amount * 0.1,
    unpaid: true,
    ...extra,
  });
  const branchOf = async () =>
    (await db.select({ id: s.invoices.id, branchId: s.invoices.branchId, companyWide: s.invoices.companyWide }).from(s.invoices).orderBy(asc(s.invoices.id))).map((r) => [
      r.id,
      r.branchId,
      r.companyWide,
    ]);

  test("göç: 'Marina'ya gelen faturalar' seçimi faturanın şubesi olur; seçilmiş ve işletme geneli faturaya dokunmaz; gerisi seçilmemiş", async () => {
    await db.insert(s.invoices).values([
      inv("2026-11-20", "Sütaş", 100),
      inv("2026-11-20", "Pınar", 100, { branchId: "tuzla" }),
      inv("2026-11-20", "Ayrı hesap", 100, { parasutAccount: "marina" }),
      inv("2026-11-20", "Kaldi", 100),
    ]);
    // 0089 stock_receipts'i kaldırdı: göçün veri adımı eski tabloyla yeniden koşturulur (iki kez de aynı sonuç)
    await db.execute(sql`CREATE TABLE "stock_receipts" ("invoice_id" integer PRIMARY KEY, "branch_id" text NOT NULL)`);
    await db.execute(sql`INSERT INTO stock_receipts VALUES (1, 'marina'), (2, 'marina')`);
    const veri = readFileSync(join(__dirname, "..", "drizzle", "0088_fatura_sube_veri.sql"), "utf8");
    for (let i = 0; i < 2; i++) for (const part of veri.split("--> statement-breakpoint")) await db.execute(sql.raw(part));
    await db.execute(sql`DROP TABLE stock_receipts`);
    assert.deepEqual(await branchOf(), [
      [1, "marina", false],
      [2, "tuzla", false],
      [3, null, true],
      [4, null, false],
    ]);
  });

  test("şube seçimi: toplu yazar, tedarikçi kartına varsayılan olur, 'Geri al' önceki şubeleri yazar; bilinmeyen şube reddedilir", async () => {
    await db.insert(s.suppliers).values({ name: "Sütaş", key: "sütaş" });
    await db.insert(s.invoices).values([inv("2026-11-20", "Sütaş", 100), inv("2026-11-21", "Sütaş", 200, { branchId: "tuzla" }), inv("2026-11-22", "Avansas", 50)]);
    const r = await invoices.setInvoiceBranch({ ids: [1, 2, 3], value: "marina", supplierDefault: true });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.ok && r.data.changed, 3);
    assert.equal(r.ok && r.data.cards, 1, "yalnız kartı olan tedarikçi");
    assert.deepEqual(await branchOf(), [
      [1, "marina", false],
      [2, "marina", false],
      [3, "marina", false],
    ]);
    const [card] = await db.select().from(s.suppliers);
    assert.equal(card.defaultBranchId, "marina");
    // Geri al
    const back = await invoices.setInvoiceBranch({ ids: [1, 2, 3], value: null, previous: r.ok ? r.data.previous : [] });
    assert.ok(back.ok);
    assert.deepEqual(await branchOf(), [
      [1, null, false],
      [2, "tuzla", false],
      [3, null, false],
    ]);
    // İşletme geneli
    assert.ok((await invoices.setInvoiceBranch({ ids: [3], value: "isletme" })).ok);
    assert.deepEqual((await branchOf())[2], [3, null, true]);
    const bad = await invoices.setInvoiceBranch({ ids: [1], value: "bodrum" });
    assert.equal(bad.ok, false);
    const log = await db.select({ action: s.activityLog.action, detail: s.activityLog.detail }).from(s.activityLog).orderBy(asc(s.activityLog.id));
    assert.equal(log[0].action, "Faturanın şubesi");
    assert.match(log[0].detail!, /3 fatura → Marina · 1 tedarikçinin varsayılanı/);
  });

  test("tedarikçi kartı: varsayılan şube yeni elle faturaya yazılır; 'şubesi seçilmemiş faturalarına da yaz' yalnız seçilmemişlere", async () => {
    const saved = await suppliers.saveSupplier({
      id: null,
      name: "Avansas",
      aliases: [],
      legalName: null,
      taxNumber: null,
      taxOffice: null,
      iban: null,
      bankName: null,
      accountHolder: null,
      contactName: null,
      phone: null,
      email: null,
      address: null,
      paymentTermDays: null,
      paymentMethod: null,
      paidOnDelivery: false,
      note: null,
    });
    assert.ok(saved.ok, JSON.stringify(saved));
    await db.insert(s.invoices).values([inv("2026-11-20", "Avansas", 100), inv("2026-11-21", "Avansas", 200, { branchId: "marina" })]);
    const id = saved.ok ? saved.data.id : 0;
    const edit = await suppliers.saveSupplier({
      id,
      name: "Avansas",
      aliases: [],
      legalName: null,
      taxNumber: null,
      taxOffice: null,
      iban: null,
      bankName: null,
      accountHolder: null,
      contactName: null,
      phone: null,
      email: null,
      address: null,
      paymentTermDays: null,
      paymentMethod: null,
      paidOnDelivery: false,
      note: null,
      invoiceBranch: "tuzla",
      applyToUnassigned: true,
    });
    assert.ok(edit.ok, JSON.stringify(edit));
    assert.equal(edit.ok && edit.data.applied, 1);
    assert.deepEqual(await branchOf(), [
      [1, "tuzla", false],
      [2, "marina", false],
    ]);
    // Yeni elle fatura (pencere şube göndermedi): kartın varsayılanı
    const added = await invoices.saveInvoice({
      id: null,
      date: "2026-11-24",
      supplier: "Avansas",
      description: null,
      invoiceNo: null,
      category: "Diğer",
      amount: 80,
      discount: 0,
      payable: 96,
      unpaid: true,
      note: null,
      clientKey: "8c2b2f3a-6a6e-4b39-9a7a-0f1f0c2d9a11",
    });
    assert.ok(added.ok, JSON.stringify(added));
    assert.deepEqual((await branchOf())[2], [3, "tuzla", false]);
    // Pencere seçtiyse o
    const other = await invoices.saveInvoice({
      id: null,
      date: "2026-11-24",
      supplier: "Avansas",
      description: null,
      invoiceNo: null,
      category: "Diğer",
      amount: 10,
      discount: 0,
      payable: 12,
      unpaid: true,
      note: null,
      clientKey: "8c2b2f3a-6a6e-4b39-9a7a-0f1f0c2d9a12",
      branch: "isletme",
    });
    assert.ok(other.ok);
    assert.deepEqual((await branchOf())[3], [4, null, true]);
  });

  test("okuma: Tuzla seçiliyken Tuzla'nın ve işletme genelinin faturaları; Marina'nınki ve seçilmemiş yok; Tümü'de hepsi", async () => {
    await db.insert(s.invoices).values([
      inv("2026-11-20", "Tuzla faturası", 100, { branchId: "tuzla" }),
      inv("2026-11-20", "Marina faturası", 100, { branchId: "marina" }),
      inv("2026-11-20", "Muhasebe", 100, { companyWide: true }),
      inv("2026-11-20", "Seçilmemiş", 100),
    ]);
    const names = async (scope: string) => (await dataset.loadModel({ scope })).ds.invoices.map((i) => i.supplier).sort();
    assert.deepEqual(await names("tuzla"), ["Muhasebe", "Tuzla faturası"]);
    assert.deepEqual(await names("marina"), ["Marina faturası", "Muhasebe"]);
    assert.deepEqual(await names("hepsi"), ["Marina faturası", "Muhasebe", "Seçilmemiş", "Tuzla faturası"]);
    assert.deepEqual(await box.unassignedInvoiceCount(db), { count: 1, total: 100 });
  });

  test("kutu: öneri kasadan ödemelerden ve tarihten; kanıt karışıksa öneri yok; öneri yazılmaz", async () => {
    await db.insert(s.users).values({ email: "kasa@laffogato.net", name: "Kasa", passwordHash: "x", role: "staff" }).onConflictDoNothing();
    await db.insert(s.cashOuts).values([
      { branchId: "marina", date: "2026-11-18", kind: "teslim", amount: 100, store: "Fırın", createdByName: "Kasa" },
      { branchId: "tuzla", date: "2026-11-18", kind: "teslim", amount: 100, store: "Manav", createdByName: "Kasa" },
      { branchId: "marina", date: "2026-11-19", kind: "teslim", amount: 100, store: "Manav", createdByName: "Kasa" },
    ]);
    await db.insert(s.invoices).values([
      inv("2026-11-20", "Fırın", 100),
      inv("2026-11-20", "Manav", 50),
      // Marina 13 Kasım'da açıldı: öncesi yalnız Tuzla
      inv("2026-11-01", "Manav", 70),
    ]);
    const b = await box.loadUnassignedBox({}, db);
    assert.equal(b.count, 3);
    const of = (supplier: string, date: string) => b.groups.find((g) => g.supplier === supplier && g.invoices.some((i) => i.date === date))!.suggestion;
    assert.equal(of("Fırın", "2026-11-20")?.value, "marina");
    assert.match(of("Fırın", "2026-11-20")!.reason, /1 kasadan ödemesi Marina/);
    assert.equal(of("Manav", "2026-11-20"), null, "iki kasadan ödenmiş: öneri yok");
    assert.equal(of("Manav", "2026-11-01")?.value, "tuzla");
    assert.equal(b.suggested, 2);
    // Öneri yazılmadı
    const [row] = await db.select({ branchId: s.invoices.branchId }).from(s.invoices).where(eq(s.invoices.supplier, "Fırın"));
    assert.equal(row.branchId, null);
  });

  test("kalem kalem (B1/B2/B6): bağlı kalem mal alışı, nedenli 'hammadde değil' kendi yerine, tedarikçi kuralı bekleyenden çıkarır", async () => {
    await db.execute(sql`TRUNCATE parasut_product_links, ingredients, integration_state RESTART IDENTITY CASCADE`);
    const [ing] = await db.insert(s.ingredients).values({ name: "Süt", unit: "ml", category: "Süt", packagePrice: 30, packageSize: 1000 }).returning();
    await db.insert(s.parasutProductLinks).values({ productKey: "p:sut", productName: "SÜT 1 L", ingredientId: ing.id, factor: 1000 });
    const [a] = await db.insert(s.invoices).values(inv("2026-11-20", "Avansas", 1000, { category: "Temizlik & Sarf", discount: 500, branchId: "tuzla" })).returning();
    const [m] = await db.insert(s.invoices).values(inv("2026-11-21", "Metro", 12_000, { branchId: "tuzla" })).returning();
    const line = (invoiceId: number, externalId: string, productKey: string, net: number) => ({ invoiceId, externalId, productKey, productName: productKey, netTotal: net, quantity: 1 });
    await db.insert(s.parasutBillLines).values([
      line(a.id, "l1", "p:sut", 300),
      line(a.id, "l2", "p:deterjan", 700),
      line(m.id, "l3", "p:peynir", 2_000),
      line(m.id, "l4", "p:isitici", 10_000),
    ]);
    const parasut = await import("../src/server/actions/parasut");
    assert.ok((await parasut.ignoreProduct({ productKey: "p:isitici", productName: "Tüplü ısıtıcı", reason: "demirbas" })).ok);
    const model = await dataset.loadModel({ scope: "hepsi" });
    // Avansas: net 500 → süt 150 mal, deterjan 350 faturanın kategorisi (Temizlik & Sarf); Metro: ısıtıcı 10.000 demirbaşa
    assert.equal(model.goodsPurchases("2026-11"), 150 + 2_000);
    const sarf = model.expenseAmounts("2026-11").find((x) => x.cat.invoiceCategory === "Temizlik & Sarf");
    assert.ok(sarf, "geçiş Temizlik & sarf malzemesi harcama satırını açtı");
    assert.equal(sarf!.invoices, 350);
    // Tedarikçi kuralı: Avansas'ın bağlanmamış kalemi (deterjan) bekleyenlerden çıkar, bağlı süt etkilenmez
    const sync = await import("../src/server/parasut/sync");
    assert.ok((await sync.unlinkedProducts(40)).items.some((u) => u.productKey === "p:deterjan"));
    assert.ok((await parasut.setSupplierIgnoreRule({ supplier: "Avansas", reason: "sarf" })).ok);
    const after = await sync.unlinkedProducts(40);
    assert.ok(!after.items.some((u) => u.productKey === "p:deterjan"), "kural bekleyenden çıkardı");
    assert.ok(after.items.some((u) => u.productKey === "p:peynir"), "başka tedarikçi etkilenmez");
    assert.equal(await sync.countUnlinkedProducts(), 1);
  });
});
