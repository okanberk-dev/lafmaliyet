// Kasadan faturalı alımlar gerçek Postgres'te (denetim E-42; src/server/data/cash-out-invoices.ts,
// src/server/actions/cash-out-invoices.ts, saveInvoice `cashOutId`): personelin e-Arşiv satırı Aylık harcamalar'a
// yazılmaz ve bekleyen listeye düşer; aynı mağazadan (ad, adın baştan kelimeleri, tedarikçi kartının diğer adı) ±7 gün,
// ±1 ₺ içinde fatura gelince kalkar; "Aylık harcamalar'a yaz" (Geri al'lı), "Listeden çıkar" (Geri al'lı) ve
// "Faturalar'a ekle" (fiş belge olur, ödendi · nakit, fatura silinince satır geri gelir). Yalnız yönetici.
//
// KASA_FATURALI_TEST_DATABASE_URL (yoksa CARI_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: CARI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/kasa-faturali-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { businessDate } from "../src/lib/cash-report";
import { addDays } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.KASA_FATURALI_TEST_DATABASE_URL ?? process.env.CARI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_kasa_faturali_${process.pid}`;

/** Küçük ama geçerli bir JPEG başı (sniffMime ilk üç bayta bakar) */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

describe("kasadan faturalı alımlar: veritabanında", { skip: !SERVER_URL && "KASA_FATURALI_TEST_DATABASE_URL ya da CARI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let pendingOf: typeof import("../src/server/data/cash-out-invoices").loadPendingCashOutInvoices;
  let actions: typeof import("../src/server/actions/cash-out-invoices");
  let invoices: typeof import("../src/server/actions/invoices");
  let cashOuts: typeof import("../src/server/actions/cash-outs");
  let photos: typeof import("../src/server/storage/photos");
  let driver: ReturnType<typeof import("../src/server/storage/drivers").memoryDriver>;
  let adminUser: typeof s.users.$inferSelect;
  let staffUser: typeof s.users.$inferSelect;
  let current: { id: number; name: string; email: string; role: "admin" | "staff" };
  const today = businessDate();

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "kasa-faturali-testi-icin-en-az-otuz-iki-karakter" });
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
    [adminUser] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Mehmet", passwordHash: "x", role: "admin" }).returning();
    [staffUser] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe", passwordHash: "x", role: "staff" }).returning();
    current = { ...adminUser, role: "admin" };
    // Yönetici eylemi personelle çağrılırsa requireAdmin yönlendirir: burada hata
    stub(require.resolve("../src/server/auth/dal"), {
      requireUser: async () => current,
      requireAdmin: async () => {
        if (current.role !== "admin") throw new Error("NEXT_REDIRECT yönetici değil");
        return current;
      },
    });
    photos = await import("../src/server/storage/photos");
    const drivers = await import("../src/server/storage/drivers");
    driver = drivers.memoryDriver();
    photos.__setPhotoDriverForTests(driver);
    pendingOf = (await import("../src/server/data/cash-out-invoices")).loadPendingCashOutInvoices;
    actions = await import("../src/server/actions/cash-out-invoices");
    invoices = await import("../src/server/actions/invoices");
    cashOuts = await import("../src/server/actions/cash-outs");
  });

  after(async () => {
    photos?.__setPhotoDriverForTests(undefined);
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    current = { ...adminUser, role: "admin" };
    await db.execute(
      sql`TRUNCATE invoice_documents, supplier_allocations, supplier_entries, expense_entries, cash_outs, invoices, suppliers, photos, activity_log, integration_state RESTART IDENTITY CASCADE`,
    );
  });

  // ---------------------------------------------------------------- yardımcılar

  const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }): T => {
    if (!r.ok) assert.fail(r.error);
    return r.data;
  };
  async function category(name = "Nakit malzeme alımı") {
    const [c] = await db.insert(s.expenseCategories).values({ name, section: "mal", panelGroup: "diger" }).onConflictDoNothing().returning();
    return c ?? (await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.name, name)))[0];
  }
  /** Kasa satırı (doğrudan; personelin e-Arşiv alışverişi) */
  async function out(p: Partial<typeof s.cashOuts.$inferInsert> = {}) {
    const [r] = await db
      .insert(s.cashOuts)
      .values({ date: today, kind: "harcama", amount: 2400, store: "Migros", description: "süt", docType: "e_arsiv", createdByName: "Ayşe", createdBy: staffUser.id, ...p })
      .returning();
    return r;
  }
  async function invoice(p: Partial<typeof s.invoices.$inferInsert> & { payable: number }) {
    const [r] = await db.insert(s.invoices).values({ date: today, supplier: "Migros", category: "Hammadde & İçecek", amount: p.payable, unpaid: false, ...p }).returning();
    return r;
  }
  const pendingIds = async () => (await pendingOf()).map((r) => r.id).sort((a, b) => a - b);

  // ---------------------------------------------------------------- liste

  test("personelin e-Arşiv alışverişi Aylık harcamalar'a yazılmaz ve listeye düşer; fiş, teslim ve gideri yazılan düşmez", async () => {
    const cat = await category();
    current = { ...staffUser, role: "staff" };
    const base = { id: null, date: today, receiptDate: today, receiptNo: null, vat: 23.76, photoId: null, categoryId: cat.id, toExpenses: true };
    const arsiv = ok(await cashOuts.saveCashOut({ ...base, kind: "harcama", amount: 2400, store: "Migros", description: "süt", docType: "e_arsiv" }));
    const fis = ok(await cashOuts.saveCashOut({ ...base, kind: "harcama", amount: 120, store: "Bim", description: "buz", docType: "fis" }));
    const teslim = ok(await cashOuts.saveCashOut({ ...base, kind: "teslim", amount: 5000, store: "patrona", description: null, docType: "yok", vat: null, receiptDate: null }));
    assert.equal(arsiv.expenseId, null, "fatura ve e-Arşiv personelde gidere yazılmaz");
    assert.notEqual(fis.expenseId, null);
    assert.equal(teslim.expenseId, null);
    // Yöneticinin "Aylık harcamalar'a da yaz"ıyla girdiği faturalı satır listeye girmez
    const yazildi = await out({ store: "Metro", amount: 900 });
    await db.insert(s.expenseEntries).values({ date: today, categoryId: cat.id, amount: 900, cashOutId: yazildi.id, createdBy: "Mehmet" });
    const rows = await pendingOf();
    assert.deepEqual(
      rows.map((r) => [r.id, r.store, r.amount, r.docType, r.createdByName]),
      [[arsiv.id, "Migros", 2400, "e_arsiv", "Ayşe"]],
    );
    assert.equal(rows[0].suggestedCategoryId, null, "aynı yerin önceki kasa harcaması yok");
  });

  test("eşleşen fatura gelince kalkar: aynı ad, baştan kelimeler, kartın diğer adı; pencere ve tutar dışı kalır", async () => {
    const o = await out({ receiptDate: addDays(today, -1) });
    assert.deepEqual(await pendingIds(), [o.id]);
    // Başka mağaza, pencere dışı (8 gün), tutar farkı 1,50 ₺: satır bekler
    await invoice({ payable: 2400, supplier: "Metro" });
    await invoice({ payable: 2400, date: addDays(today, 7) });
    await invoice({ payable: 2401.5 });
    assert.deepEqual(await pendingIds(), [o.id]);
    // Paraşüt'ten gelen unvanla (adın baştan kelimeleri), 0,50 ₺ farkla
    const f = await invoice({ payable: 2400.5, supplier: "MİGROS TİCARET A.Ş.", date: addDays(today, 3) });
    assert.deepEqual(await pendingIds(), []);
    await db.delete(s.invoices).where(eq(s.invoices.id, f.id));
    assert.deepEqual(await pendingIds(), [o.id], "fatura silinince geri gelir");
    // Tedarikçi kartının diğer adı: "Kasap" yazılan yer ile "Öz Et Ltd." faturası
    const kasap = await out({ store: "Kasap", amount: 1500 });
    await db.insert(s.suppliers).values({ name: "Öz Et Ltd.", key: "öz et ltd.", aliases: ["Kasap"] });
    await invoice({ payable: 1500, supplier: "Öz Et Ltd." });
    assert.deepEqual(await pendingIds(), [o.id], "kasap kalktı");
    assert.ok(kasap.id > o.id);
  });

  test("bir fatura tek satırı kapatır; tedarikçi ödemesine bağlı satır listede değil", async () => {
    const a = await out({ date: addDays(today, -3) });
    const b = await out({ date: today });
    await invoice({ payable: 2400, date: today });
    assert.deepEqual(await pendingIds(), [a.id], "günü yakın olan kapandı");
    // Teslim · ödeme'ye çevrilmiş (kasa yöntemli ödeme) satır cari hesabında izlenir
    const [card] = await db.insert(s.suppliers).values({ name: "Sütaş", key: "sütaş" }).returning();
    const c = await out({ store: "Sütaş", amount: 700 });
    await db.insert(s.supplierEntries).values({ supplierId: card.id, kind: "odeme", date: today, amount: 700, method: "kasa", cashOutId: c.id, createdByName: "Mehmet" });
    assert.deepEqual(await pendingIds(), [a.id]);
    assert.ok(b.id);
  });

  // ---------------------------------------------------------------- eylemler

  test("Aylık harcamalar'a yaz: nakit kayıt, fişin günü, kasanın notu; Geri al; beklemeyen satıra yazılmaz", async () => {
    const cat = await category();
    const o = await out({ receiptDate: addDays(today, -1), vat: 23.76 });
    const r = ok(await actions.writeCashOutInvoiceExpense({ id: o.id, categoryId: cat.id }));
    const [e] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, r.expenseId));
    assert.deepEqual([e.cashOutId, e.amount, e.categoryId, e.paymentMethod, e.date, e.vat, e.description], [o.id, 2400, cat.id, "nakit", addDays(today, -1), 23.76, "Migros · süt"]);
    assert.match(e.note ?? "", /^Kasadan · /);
    assert.deepEqual(await pendingIds(), []);
    // İkinci dokunuş iki kez yazmaz
    const again = await actions.writeCashOutInvoiceExpense({ id: o.id, categoryId: cat.id });
    assert.ok(!again.ok && /artık beklemiyor/.test(again.error));
    assert.equal((await db.select().from(s.expenseEntries)).length, 1);
    // Geri al: kayıt silinir, satır yeniden bekler
    ok(await actions.undoCashOutInvoiceExpense({ id: o.id, expenseId: r.expenseId }));
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
    assert.deepEqual(await pendingIds(), [o.id]);
    // Sonra öneri: aynı yerin son kasa harcamasının kategorisi
    const other = await category("Market");
    const fis = await out({ docType: "fis", amount: 50 });
    await db.insert(s.expenseEntries).values({ date: today, categoryId: other.id, amount: 50, cashOutId: fis.id, createdBy: "Ayşe" });
    assert.equal((await pendingOf())[0].suggestedCategoryId, other.id);
    // Faturası gelmiş satır yazılmaz (iki kez sayılmasın)
    await invoice({ payable: 2400 });
    const late = await actions.writeCashOutInvoiceExpense({ id: o.id, categoryId: cat.id });
    assert.ok(!late.ok);
    assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, o.id))).length, 0);
  });

  test("Listeden çıkar ve Geri al; personel yönetici eylemlerini çağıramaz", async () => {
    const o = await out();
    const d = ok(await actions.dismissCashOutInvoices({ ids: [o.id] }));
    assert.deepEqual(d.ids, [o.id]);
    assert.deepEqual(await pendingIds(), []);
    const twice = await actions.dismissCashOutInvoices({ ids: [o.id] });
    assert.ok(!twice.ok, "artık beklemiyor");
    ok(await actions.dismissCashOutInvoices({ ids: [o.id], undo: true }));
    assert.deepEqual(await pendingIds(), [o.id]);
    const log = await db.select({ action: s.activityLog.action }).from(s.activityLog);
    assert.ok(log.some((l) => l.action === "Kasadan faturalı alım listeden çıkarıldı"));
    current = { ...staffUser, role: "staff" };
    const cat = await category();
    // Gerçek requireAdmin yönlendirir; taklit hata fırlatır: ikisinde de hiçbir şey yazılmaz
    assert.equal((await actions.writeCashOutInvoiceExpense({ id: o.id, categoryId: cat.id })).ok, false);
    assert.equal((await actions.dismissCashOutInvoices({ ids: [o.id] })).ok, false);
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
    assert.deepEqual(await pendingIds(), [o.id]);
  });

  test("Faturalar'a ekle: fatura kasadan, ödendi · nakit; fiş belge olur; ad ve tutar değişse de satır kalkar; fatura silinince döner", async () => {
    // Kasa fişinin fotoğrafı (depoda ve satırda)
    await driver.put("fis/2026/10/test.jpg", JPEG, "image/jpeg");
    const [photo] = await db.insert(s.photos).values({ kind: "fis", storageKey: "fis/2026/10/test.jpg", contentType: "image/jpeg", sizeBytes: JPEG.length, createdBy: staffUser.id }).returning();
    const o = await out({ photoId: photo.id, receiptNo: "GIB2026000000123" });
    const form = {
      id: null,
      date: today,
      supplier: "Migros Ticaret",
      description: "süt",
      invoiceNo: "GIB2026000000123",
      category: "Hammadde & İçecek",
      amount: 2000,
      discount: 0,
      payable: 2390,
      unpaid: false,
      note: "",
      paidAt: today,
      cashOutId: o.id,
    };
    const r = ok(await invoices.saveInvoice(form));
    assert.deepEqual(r.cashOut, { document: true });
    const [f] = await db.select().from(s.invoices).where(eq(s.invoices.id, r.id));
    assert.deepEqual([f.unpaid, f.paidVia, f.paidAt, f.payable], [false, "nakit", today, 2390]);
    const docs = await db.select({ mime: s.invoiceDocuments.mime, source: s.invoiceDocuments.source, size: s.invoiceDocuments.size }).from(s.invoiceDocuments).where(eq(s.invoiceDocuments.invoiceId, r.id));
    assert.deepEqual(docs, [{ mime: "image/jpeg", source: "upload", size: JPEG.length }]);
    assert.deepEqual(await pendingIds(), [], "tutar 10 ₺ farklı olsa da bu satırın faturası");
    // Aynı satırdan ikinci fatura açılmaz
    const again = await invoices.saveInvoice(form);
    assert.ok(!again.ok && /artık beklemiyor/.test(again.error));
    assert.equal((await db.select().from(s.invoices)).length, 1);
    // Bu satırdan açılan fatura başka bir satırı kapatmaz
    const twin = await out({ amount: 2390, store: "Migros Ticaret" });
    assert.deepEqual(await pendingIds(), [twin.id]);
    // Fatura silinince satır yeniden bekler
    ok(await invoices.deleteInvoice(r.id));
    assert.deepEqual(await pendingIds(), [o.id, twin.id]);
  });

  test("Faturalar'a ekle: fotoğraf okunamazsa fatura yine kaydedilir, belge yok denir; Aylık harcamalar'a yazılmış satırdan fatura açılmaz", async () => {
    const [p] = await db.insert(s.photos).values({ kind: "fis", storageKey: "yok/olmayan.jpg", contentType: "image/jpeg", sizeBytes: 10, createdBy: staffUser.id }).returning();
    const o = await out({ photoId: p.id });
    const base = { id: null, date: today, supplier: "Migros", description: "", invoiceNo: "", category: "Hammadde & İçecek", amount: 2376.24, discount: 0, payable: 2400, unpaid: false, note: "", paidAt: today };
    const r = ok(await invoices.saveInvoice({ ...base, cashOutId: o.id }));
    assert.deepEqual(r.cashOut, { document: false });
    assert.equal((await db.select().from(s.invoiceDocuments)).length, 0);
    // Yazılmış satır
    const cat = await category();
    const w = await out({ store: "Bim", amount: 300 });
    ok(await actions.writeCashOutInvoiceExpense({ id: w.id, categoryId: cat.id }));
    const refused = await invoices.saveInvoice({ ...base, supplier: "Bim", payable: 300, amount: 297, cashOutId: w.id });
    assert.ok(!refused.ok && /artık beklemiyor/.test(refused.error));
  });
});
