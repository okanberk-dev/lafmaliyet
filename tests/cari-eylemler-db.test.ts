// Cari hesabın eylemleri gerçek Postgres'te, oturum ve next/cache taklit edilerek (src/server/actions/cari.ts,
// invoices.ts, suppliers.ts ve src/server/cari/*): inceleme bulgularının (1. tur) düzeltmeleri. Dağıtımın yeniden
// yazılması defterin kapattığı faturaları açar; aynı faturaya eşzamanlı iki ✓ defterin kapanışını ezmez; fatura
// penceresinde tutar ile Ödendi aynı kayıtta; yeni ödenmiş fatura hesaptaki parayı kullanır; 45 gün uyarısı ödeme
// durumuna bakmaz; "Gideri zaten girildi"nin geri alınması kaydın eski günü ve tutarını geri yazar; kafe dışı faturaya
// bağlanmaz; Kasa denetiminde "Ayrı alım" Teslim satırını işlenmiş saymaz; ve diğerleri.
//
// CARI_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: CARI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/cari-eylemler-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import { addDays, todayTR } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.CARI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_cari_eylem_${process.pid}`;

describe("cari eylemleri: veritabanında", { skip: !SERVER_URL && "CARI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let settle: typeof import("../src/server/cari/settle");
  let cari: typeof import("../src/server/actions/cari");
  let invoices: typeof import("../src/server/actions/invoices");
  let data: typeof import("../src/server/data/cari");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "cari-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    const [u] = await db.insert(s.users).values({ email: "test@laffogato.net", name: "Test", passwordHash: "x", role: "admin" }).returning();
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => ({ ...u, role: "admin" }), requireUser: async () => ({ ...u, role: "admin" }) });
    settle = await import("../src/server/cari/settle");
    cari = await import("../src/server/actions/cari");
    invoices = await import("../src/server/actions/invoices");
    data = await import("../src/server/data/cari");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE supplier_allocations, supplier_entries, expense_entries, expense_categories, invoices, suppliers, cash_outs, activity_log, integration_state RESTART IDENTITY CASCADE`,
    );
  });

  // ---------------------------------------------------------------- yardımcılar

  async function card(name = "Sütaş", extra: Partial<typeof s.suppliers.$inferInsert> = {}) {
    const [c] = await db.insert(s.suppliers).values({ name, key: name.toLocaleLowerCase("tr-TR"), ...extra }).returning();
    return c;
  }
  async function invoice(p: Partial<typeof s.invoices.$inferInsert> & { payable: number }) {
    const [r] = await db
      .insert(s.invoices)
      .values({ date: "2026-10-12", supplier: "Sütaş", category: "Hammadde & İçecek", amount: p.payable, unpaid: true, ...p })
      .returning();
    return r;
  }
  async function category(name = "Nakit malzeme alımı", section: "mal" | "genel" = "mal") {
    const [c] = await db.insert(s.expenseCategories).values({ name, section }).onConflictDoNothing().returning();
    return c ?? (await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.name, name)))[0];
  }
  const inv = async (id: number) => (await db.select().from(s.invoices).where(eq(s.invoices.id, id)))[0];
  const allocs = () => db.select().from(s.supplierAllocations).orderBy(asc(s.supplierAllocations.id));
  const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }): T => {
    if (!r.ok) assert.fail(r.error);
    return r.data;
  };
  /** Ödeme ekle (eylem), kartın sayfasından */
  async function pay(cardId: number, amount: number, opts: { date?: string; method?: "havale" | "elden" | "kasa"; mode?: "auto" | "manual" | "none"; lines?: { kind: "invoice" | "debt"; id: number; amount: number }[]; cashOut?: { mode: "existing"; id: number } | { mode: "new" } | null } = {}) {
    return ok(
      await cari.saveSupplierPayment({
        target: { cardId },
        id: null,
        date: opts.date ?? "2026-10-20",
        amount,
        method: opts.method ?? "havale",
        cashOut: opts.cashOut ?? null,
        allocation: { mode: opts.mode ?? "auto", lines: opts.lines ?? [] },
        note: null,
        photoId: null,
      }),
    );
  }
  /** Borç ekle (eylem) */
  async function addDebt(cardId: number, p: { amount: number; date?: string; description?: string; costMode?: "fatura" | "gider" | "mevcut" | "devir"; categoryId?: number | null; adoptExpenseId?: number | null; applyCredit?: boolean; confirmPast?: string[]; id?: number | null; note?: string | null }) {
    return cari.saveSupplierDebt({
      target: { cardId },
      id: p.id ?? null,
      date: p.date ?? "2026-10-20",
      amount: p.amount,
      description: p.description ?? "süt",
      costMode: p.costMode ?? "fatura",
      categoryId: p.categoryId ?? null,
      adoptExpenseId: p.adoptExpenseId ?? null,
      dueDate: null,
      note: p.note ?? null,
      photoId: null,
      applyCredit: p.applyCredit ?? false,
      paid: null,
      confirmPast: p.confirmPast ?? [],
    });
  }
  /** Fatura penceresinin gönderdiği alanlar */
  const invoiceForm = (x: typeof s.invoices.$inferSelect, change: { payable?: number; unpaid?: boolean; paidAt?: string | null; supplier?: string }) => ({
    id: x.id,
    date: x.date,
    supplier: change.supplier ?? x.supplier,
    description: x.description ?? "",
    invoiceNo: x.invoiceNo ?? "",
    category: x.category,
    amount: change.payable ?? x.amount,
    discount: 0,
    payable: change.payable ?? x.payable,
    unpaid: change.unpaid ?? x.unpaid,
    note: x.note ?? "",
    dueDate: x.dueDate,
    ...(change.paidAt !== undefined ? { paidAt: change.paidAt } : {}),
  });

  // ---------------------------------------------------------------- dağıtım ve ödendi işareti

  test("Neye sayıldı: ödemenin kapattığı faturalar yeniden yazımda seçenek olur; En eski borçtan ve Geri al önizlemeyle aynı", async () => {
    const c = await card();
    const a = await invoice({ payable: 300, date: "2026-10-01", invoiceNo: "A" });
    const b = await invoice({ payable: 400, date: "2026-10-02", invoiceNo: "B" });
    const cc = await invoice({ payable: 500, date: "2026-10-03", invoiceNo: "C" });
    const p = await pay(c.id, 900);
    assert.deepEqual([(await inv(a.id)).paidByLedger, (await inv(b.id)).paidByLedger, (await inv(cc.id)).allocated], [true, true, 200]);
    // (1) Aynı satırlarla Seçerek kaydetmek reddedilmez
    const same = [
      { kind: "invoice" as const, id: a.id, amount: 300 },
      { kind: "invoice" as const, id: b.id, amount: 400 },
      { kind: "invoice" as const, id: cc.id, amount: 200 },
    ];
    const r1 = ok(await cari.setPaymentAllocation({ paymentId: p.id, mode: "manual", lines: same }));
    assert.equal(r1.left, 0);
    // (2) En eski borçtan: önce A ve B
    const r2 = ok(await cari.setPaymentAllocation({ paymentId: p.id, mode: "auto", lines: [] }));
    assert.deepEqual(r2.lines.map((l) => [l.id, l.amount]), [[a.id, 300], [b.id, 400], [cc.id, 200]]);
    assert.deepEqual([(await inv(a.id)).unpaid, (await inv(b.id)).unpaid, (await inv(cc.id)).unpaid], [false, false, true]);
    // (3) Ödemeden çıkar, sonra Geri al (önceki satırlar Seçerek ile)
    const ccAlloc = (await allocs()).find((x) => x.invoiceId === cc.id)!;
    const removed = ok(await cari.removeAllocations({ allocationIds: [ccAlloc.id] }));
    ok(await cari.setPaymentAllocation({ paymentId: p.id, mode: "manual", lines: removed.previous[0].lines }));
    assert.equal((await inv(cc.id)).allocated, 200);
  });

  test("aynı faturaya eşzamanlı iki ✓: defterin kapanışı elle ödendi olarak ezilmez", async () => {
    const c = await card();
    await pay(c.id, 300, { mode: "none", date: "2026-10-20" });
    for (let round = 0; round < 3; round++) {
      const x = await invoice({ payable: 300, ledgerBase: 0, invoiceNo: `X${round}` });
      const [r1, r2] = await Promise.all([invoices.setInvoicePaid(x.id, true), invoices.setInvoicePaid(x.id, true)]);
      assert.ok(r1.ok && r2.ok);
      const now = await inv(x.id);
      if (now.allocated > 0) assert.deepEqual([now.unpaid, now.paidByLedger, now.paidAt, now.paidVia], [false, true, "2026-10-20", "havale"], `tur ${round}`);
      // Sonraki tur için hesaba yeniden para
      await pay(c.id, 300, { mode: "none", date: "2026-10-20" });
    }
  });

  test("ödeme penceresinde değişiklik yapmadan Kaydet defterin kapattığı faturayı elle ödendi yapmaz", async () => {
    const c = await card();
    const f = await invoice({ payable: 8450.5, invoiceNo: "SUT123" });
    await pay(c.id, 10000, { date: "2026-10-22" });
    assert.equal((await inv(f.id)).paidByLedger, true);
    const r = await invoices.setInvoicePayment([f.id], { status: "paid", date: "2026-10-22", via: "havale" });
    assert.ok(r.ok || /değişiklik/.test(r.error));
    assert.equal((await inv(f.id)).paidByLedger, true, "işaret değişmedi");
    // Ödemeden çıkarınca fatura yeniden açılır
    const a = (await allocs()).find((x) => x.invoiceId === f.id)!;
    const removed = ok(await cari.removeAllocations({ allocationIds: [a.id] }));
    assert.equal(removed.reopened, 1);
    assert.equal((await inv(f.id)).unpaid, true);
  });

  test("fatura penceresi: tutar ve Ödendi aynı kayıtta değişince hesaptaki para yeni tutara göre sayılır", async () => {
    const c = await card();
    await pay(c.id, 3100, { mode: "none" });
    // Elle fatura (takipli kart: taban 0)
    const down = ok(await invoices.saveInvoice({ id: null, date: "2026-10-12", supplier: "Sütaş", description: "", invoiceNo: "X", category: "Hammadde & İçecek", amount: 3100, discount: 0, payable: 3100, unpaid: true, note: "" }));
    const x = await inv(down.id);
    assert.equal(x.ledgerBase, 0);
    ok(await invoices.saveInvoice(invoiceForm(x, { payable: 3000, unpaid: false })));
    const after = await inv(x.id);
    assert.deepEqual([after.payable, after.allocated, after.unpaid, after.paidByLedger], [3000, 3000, false, true]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 100]], "100 ₺ hesapta kalır");
    // Ters yön: tutar artar, hesaptaki para yetmez; kalan elle ödendi
    await db.execute(sql`TRUNCATE supplier_allocations, supplier_entries, invoices RESTART IDENTITY CASCADE`);
    await pay(c.id, 3000, { mode: "none" });
    const up = ok(await invoices.saveInvoice({ id: null, date: "2026-10-12", supplier: "Sütaş", description: "", invoiceNo: "Y", category: "Hammadde & İçecek", amount: 3000, discount: 0, payable: 3000, unpaid: true, note: "" }));
    const y = await inv(up.id);
    ok(await invoices.saveInvoice(invoiceForm(y, { payable: 3200, unpaid: false, paidAt: "2026-10-24" })));
    const y2 = await inv(y.id);
    assert.deepEqual([y2.payable, y2.allocated, y2.unpaid, y2.paidByLedger, y2.paidAt], [3200, 3000, false, false, "2026-10-24"], "kalan 200 elle ödendi");
    assert.deepEqual([...(await settle.cardsWithCredit())], []);
    // Sonraki yeniden dengeleme faturayı açmaz
    await settle.resettleInvoices([y.id]);
    assert.equal((await inv(y.id)).unpaid, false);
  });

  test("yeni fatura Ödendi olarak eklenince önce hesaptaki para sayılır (çift sayım yok)", async () => {
    const c = await card();
    await pay(c.id, 500, { mode: "none" });
    const r = ok(await invoices.saveInvoice({ id: null, date: "2026-10-24", supplier: "Sütaş", description: "", invoiceNo: "N1", category: "Hammadde & İçecek", amount: 500, discount: 0, payable: 500, unpaid: false, note: "", paidAt: "2026-10-24" }));
    const f = await inv(r.id);
    assert.deepEqual([f.unpaid, f.paidByLedger, f.allocated], [false, true, 500]);
    assert.deepEqual([...(await settle.cardsWithCredit())], []);
    assert.equal(r.credit?.used, 500);
    // Kısmen karşılanırsa kalan elle ödendi (kullanıcının günü)
    await pay(c.id, 200, { mode: "none" });
    const r2 = ok(await invoices.saveInvoice({ id: null, date: "2026-10-24", supplier: "Sütaş", description: "", invoiceNo: "N2", category: "Hammadde & İçecek", amount: 500, discount: 0, payable: 500, unpaid: false, note: "", paidAt: "2026-10-23" }));
    const f2 = await inv(r2.id);
    assert.deepEqual([f2.unpaid, f2.paidByLedger, f2.allocated, f2.paidAt], [false, false, 200, "2026-10-23"]);
    // Hesapta para yoksa davranış bugünkü gibi
    const r3 = ok(await invoices.saveInvoice({ id: null, date: "2026-10-24", supplier: "Sütaş", description: "", invoiceNo: "N3", category: "Hammadde & İçecek", amount: 100, discount: 0, payable: 100, unpaid: false, note: "", paidAt: "2026-10-24" }));
    const f3 = await inv(r3.id);
    assert.deepEqual([f3.unpaid, f3.paidByLedger, f3.allocated, f3.paidAt], [false, false, 0, "2026-10-24"]);
  });

  test("eşitlemede tutarı takip öncesi kısma inen dağıtımsız takipli fatura kapanır (kalan 0 iken ödenmedi kalmaz)", async () => {
    await card();
    const f = await invoice({ payable: 1200, ledgerBase: 1200, outstanding: 1800, invoiceNo: "SUT140" });
    await settle.resettleAfterSync([{ id: f.id, from: 3000, to: 1200 }]);
    const now = await inv(f.id);
    assert.deepEqual([now.unpaid, now.paidByLedger], [false, true]);
    // Takipsiz faturaya dokunulmaz
    const g = await invoice({ payable: 500, invoiceNo: "SUT141" });
    await settle.resettleAfterSync([{ id: g.id, from: 600, to: 500 }]);
    assert.equal((await inv(g.id)).unpaid, true);
  });

  test("45 gün: faturası gelmeyen alım ödenmiş olsa da uyarı verir (tedarikçi sayfası ve Ödemeler'in özeti), tutar alımın tutarı", async () => {
    const c = await card();
    const d1 = await addDebt(c.id, { amount: 1250, date: "2026-10-20", description: "süt" });
    assert.ok(d1.ok && d1.data.needs === null);
    await addDebt(c.id, { amount: 400, date: "2026-10-19", description: "yoğurt" });
    // B1 tamamen ödendi
    await pay(c.id, 1250, { mode: "manual", lines: [{ kind: "debt", id: (d1.data as { id: number }).id, amount: 1250 }], date: "2026-10-24" });
    const today = "2026-12-05";
    const index = await data.loadCariIndex(today);
    assert.deepEqual(index.lateDebts.map((d) => d.description).sort(), ["süt", "yoğurt"]);
    const groupInvoices: never[] = [];
    const page = await data.loadSupplierCari({ card: { id: c.id, name: c.name, aliases: [] }, invoices: groupInvoices }, { today, termDays: 30 });
    assert.equal(page.late.length, 2);
  });

  // ---------------------------------------------------------------- "Gideri zaten girildi" ve bağlama

  test("Gideri zaten girildi: borcun Geri al'ı ve kip değişimi kaydın eski gününü ve tutarını geri yazar (geçmiş ay onayıyla)", async () => {
    const c = await card();
    const cat = await category();
    const today = todayTR();
    const lastMonthDay = addDays(`${today.slice(0, 7)}-01`, -1);
    const [e] = await db.insert(s.expenseEntries).values({ date: lastMonthDay, categoryId: cat.id, description: "Nakit malzeme alımı", amount: 900, paymentMethod: "nakit", createdBy: "Ayşe" }).returning();
    const past = [lastMonthDay.slice(0, 7)];
    const add = await addDebt(c.id, { amount: 905, date: today, description: "kaşar", costMode: "mevcut", adoptExpenseId: e.id });
    assert.ok(add.ok && add.data.needs === "past", "geçmiş ay onayı istenir");
    const r = await addDebt(c.id, { amount: 905, date: today, description: "kaşar", costMode: "mevcut", adoptExpenseId: e.id, confirmPast: past });
    assert.ok(r.ok && r.data.needs === null);
    const debtId = (r.data as { id: number }).id;
    let x = (await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, e.id)))[0];
    assert.deepEqual([x.date, x.amount, x.supplierEntryId], [today, 905, debtId]);
    // Bildirimdeki Geri al: borç silinir, kayıt eski hâline döner (onay olmadan istenir)
    const del0 = await cari.deleteSupplierEntry({ id: debtId });
    assert.ok(del0.ok && del0.data.needs === "past");
    const del = await cari.deleteSupplierEntry({ id: debtId, confirmPast: past });
    assert.ok(del.ok && del.data.needs === null);
    x = (await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, e.id)))[0];
    assert.deepEqual([x.date, x.amount, x.supplierEntryId], [lastMonthDay, 900, null]);
    // Silmenin Geri al'ı kaydı yeniden borca eşitler
    ok(await cari.restoreSupplierEntry((del.data as { undo: string }).undo));
    x = (await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, e.id)))[0];
    assert.deepEqual([x.date, x.amount, x.supplierEntryId], [today, 905, debtId]);
    // Kip değişimi (Faturası gelecek): kayıt yine eski hâline
    const edit = await addDebt(c.id, { id: debtId, amount: 905, date: today, description: "kaşar", costMode: "fatura", confirmPast: past });
    assert.ok(edit.ok && edit.data.needs === null);
    x = (await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, e.id)))[0];
    assert.deepEqual([x.date, x.amount, x.supplierEntryId], [lastMonthDay, 900, null]);
  });

  test("bağ kaldırılınca sahiplenilen kayıt eski kimliği, ödeme şekli ve yazanıyla geri gelir", async () => {
    const c = await card();
    const cat = await category();
    const today = todayTR();
    const [e] = await db.insert(s.expenseEntries).values({ date: today, categoryId: cat.id, description: "market", amount: 900, paymentMethod: "kart", createdBy: "Ayşe", note: "elle" }).returning();
    const r = await addDebt(c.id, { amount: 900, date: today, costMode: "mevcut", adoptExpenseId: e.id });
    assert.ok(r.ok && r.data.needs === null);
    const debtId = (r.data as { id: number }).id;
    const f = await invoice({ payable: 900, date: today, invoiceNo: "SUT149" });
    const l = await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [debtId], invoiceId: f.id });
    assert.ok(l.ok && l.data.needs === null);
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
    const u = await cari.unlinkDebts({ debtIds: [debtId] });
    assert.ok(u.ok && u.data.needs === null);
    const [back] = await db.select().from(s.expenseEntries);
    assert.deepEqual([back.id, back.paymentMethod, back.createdBy, back.note, back.supplierEntryId], [e.id, "kart", "Ayşe", "elle", debtId]);
  });

  test("kafe dışı ya da komisyon faturasına faturasız alım bağlanmaz (gider sessizce düşmesin)", async () => {
    const c = await card("Pruva");
    const cat = await category();
    const r = await addDebt(c.id, { amount: 600, date: todayTR(), costMode: "gider", categoryId: cat.id });
    assert.ok(r.ok && r.data.needs === null);
    const debtId = (r.data as { id: number }).id;
    for (const category of ["Alp Koç", "Karaoke box", "Komisyon"]) {
      const f = await invoice({ payable: 600, supplier: "Pruva", category, date: todayTR() });
      const l = await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [debtId], invoiceId: f.id });
      assert.ok(!l.ok, category);
    }
    assert.equal((await db.select().from(s.expenseEntries)).length, 1, "gider kaydı duruyor");
  });

  test("faturasız alımı bağlı faturanın kategorisi kafe dışına, komisyona alınamaz; Ödenecek iadeye dönemez (E-45)", async () => {
    const c = await card("Pruva");
    const cat = await category();
    const r = await addDebt(c.id, { amount: 600, date: todayTR(), description: "içecekler", costMode: "gider", categoryId: cat.id });
    assert.ok(r.ok && r.data.needs === null);
    const debtId = (r.data as { id: number }).id;
    const f = await invoice({ payable: 600, supplier: "Pruva", date: todayTR(), invoiceNo: "PRV101" });
    const other = await invoice({ payable: 900, supplier: "Pruva", date: todayTR(), invoiceNo: "PRV102" });
    ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [debtId], invoiceId: f.id }));
    // Satır içi ve toplu: hiçbiri yazılmaz, sebep ve bağlı alım söylenir
    for (const category of ["Alp Koç", "Karaoke box", "Komisyon"]) {
      const one = await invoices.setInvoiceCategory([{ id: f.id, category }]);
      assert.ok(!one.ok && one.error.includes("faturasız alım bağlı (içecekler)") && one.error.includes(category), category);
      assert.match(one.ok ? "" : one.error, /Kategori değişmedi/);
    }
    const bulk = await invoices.setInvoiceCategory([
      { id: other.id, category: "Alp Koç" },
      { id: f.id, category: "Alp Koç" },
    ]);
    // Seçim olmayan yoldan da ("N faturaya da uygula") okunur: hangi fatura, ne yapılacak (inceleme U2)
    assert.ok(
      !bulk.ok && bulk.error.startsWith("Pruva PRV101: faturasız alım bağlı (içecekler)") && bulk.error.endsWith("Faturaların hiçbirinin kategorisi değişmedi; bağlı faturayı ayırıp kalanları yeniden değiştirin."),
      bulk.ok ? "" : bulk.error,
    );
    assert.deepEqual([(await inv(f.id)).category, (await inv(other.id)).category], ["Hammadde & İçecek", "Hammadde & İçecek"]);
    // İki bağlı fatura: ikisi de adıyla
    const r2 = await addDebt(c.id, { amount: 900, date: todayTR(), description: "sular", costMode: "gider", categoryId: cat.id });
    assert.ok(r2.ok);
    ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [(r2.data as { id: number }).id], invoiceId: other.id }));
    const both = await invoices.setInvoiceCategory([
      { id: f.id, category: "Alp Koç" },
      { id: other.id, category: "Alp Koç" },
    ]);
    assert.ok(!both.ok && /^2 faturaya faturasız alım bağlı: Pruva PRV101 \(içecekler\); Pruva PRV102 \(sular\)\./.test(both.error) && both.error.includes("bağlı faturaları ayırıp"), both.ok ? "" : both.error);
    ok(await cari.unlinkDebts({ debtIds: [(r2.data as { id: number }).id] }));
    // Fatura penceresi: kategori ve elle faturanın Ödenecek'i (iade)
    const form = await invoices.saveInvoice({ ...invoiceForm(await inv(f.id), {}), category: "Alp Koç" });
    assert.ok(!form.ok && form.error.includes("Fatura kaydedilmedi"));
    const refund = await invoices.saveInvoice(invoiceForm(await inv(f.id), { payable: 0 }));
    assert.ok(!refund.ok && refund.error.includes("iade"));
    assert.deepEqual([(await inv(f.id)).category, (await inv(f.id)).payable], ["Hammadde & İçecek", 600]);
    // Bağlanabilir kategoriye geçmek ve başka alanları düzeltmek serbest; bağsız fatura kafe dışına gider
    ok(await invoices.setInvoiceCategory([{ id: f.id, category: "Tatlı & Hazır Ürün" }]));
    ok(await invoices.saveInvoice({ ...invoiceForm(await inv(f.id), {}), note: "kontrol edildi" }));
    ok(await invoices.setInvoiceCategory([{ id: other.id, category: "Alp Koç" }]));
    // Gider kaydı hâlâ faturada (bağ duruyor); bağ kaldırılınca kafe dışına alınabilir
    assert.equal((await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debtId)))[0].invoiceId, f.id);
    ok(await cari.unlinkDebts({ debtIds: [debtId] }));
    ok(await invoices.setInvoiceCategory([{ id: f.id, category: "Alp Koç" }]));
    assert.equal((await inv(f.id)).category, "Alp Koç");
  });

  test("eski bağ: kategorisi zaten kafe dışı olan bağlı faturanın notu düzeltilebilir (yalnız değişen alan sorulur)", async () => {
    const c = await card("Pruva");
    const r = await addDebt(c.id, { amount: 300, date: todayTR(), description: "su" });
    const debtId = (r.ok ? (r.data as { id: number }).id : 0);
    const f = await invoice({ payable: 300, supplier: "Pruva", date: todayTR() });
    ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [debtId], invoiceId: f.id }));
    // Kural gelmeden önce taşınmış (doğrudan yazım)
    await db.update(s.invoices).set({ category: "Alp Koç" }).where(eq(s.invoices.id, f.id));
    ok(await invoices.saveInvoice({ ...invoiceForm(await inv(f.id), {}), note: "eski" }));
    assert.equal((await inv(f.id)).note, "eski");
    // Kafe içine dönmek serbest
    ok(await invoices.setInvoiceCategory([{ id: f.id, category: "Hammadde & İçecek" }]));
  });

  test("bağlı 'gider' borcun kategorisi silinebilir; bağ kalkınca borç faturası gelecek olur", async () => {
    const c = await card();
    const cat = await category("Süt alımı");
    const r = await addDebt(c.id, { amount: 500, date: todayTR(), costMode: "gider", categoryId: cat.id });
    const debtId = (r.ok ? (r.data as { id: number }).id : 0);
    const f = await invoice({ payable: 500, date: todayTR() });
    ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [debtId], invoiceId: f.id }));
    await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, cat.id));
    ok(await cari.unlinkDebts({ debtIds: [debtId] }));
    const [d] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debtId));
    assert.deepEqual([d.costMode, d.categoryId, d.invoiceId], ["fatura", null, null]);
  });

  // ---------------------------------------------------------------- Kasa, borç düzeltme, Ödemeler

  async function cashOut(p: Partial<typeof s.cashOuts.$inferInsert> & { amount: number }) {
    const [r] = await db.insert(s.cashOuts).values({ date: todayTR(), kind: "teslim", store: "Sütaş", docType: "yok", createdByName: "Ayşe", ...p }).returning();
    return r;
  }

  test("Kasa denetimi 'Ayrı alım': Teslim satırı işlenmemiş kalır (Kasadan seçilebilir), alışveriş satırı ayrı tutulur", async () => {
    const c = await card();
    const today = todayTR();
    const teslim = await cashOut({ amount: 2200, date: addDays(today, -1) });
    const shop = await cashOut({ amount: 300, kind: "harcama", date: today });
    const first = await addDebt(c.id, { amount: 1250, date: today });
    assert.ok(first.ok && first.data.needs === "kasa");
    const r = await cari.saveSupplierDebt({
      target: { cardId: c.id },
      id: null,
      date: today,
      amount: 1250,
      description: "süt",
      costMode: "fatura",
      categoryId: null,
      adoptExpenseId: null,
      dueDate: null,
      note: null,
      photoId: null,
      applyCredit: false,
      paid: null,
      confirmPast: [],
      kasaChoice: { action: "ayri", seen: [teslim.id, shop.id] },
    });
    assert.ok(r.ok && r.data.needs === null);
    assert.deepEqual((r.data as { apart: number[] }).apart, [shop.id]);
    const handled = await data.loadKasaHandled();
    assert.equal(handled.has(teslim.id), false, "Teslim işlenmemiş");
    assert.equal(handled.has(shop.id), true);
    const index = await data.loadCariIndex(today);
    assert.deepEqual(index.kasaPending.map((l) => l.id), [teslim.id]);
  });

  test("Kasa denetimi 'Bu satırla kapat': önce satırın ödemesi borca sayılır, kalan hesaptaki paradan", async () => {
    const c = await card();
    // Kasanın günü (05:00'te döner): gece yarısından sonra takvim günü kasanın gününden ileridir, kasadan ödeme reddedilir
    const today = businessDate();
    await pay(c.id, 1500, { mode: "none", date: addDays(today, -5) });
    const line = await cashOut({ amount: 400, date: today });
    const r = await cari.saveSupplierDebt({
      target: { cardId: c.id },
      id: null,
      date: today,
      amount: 450,
      description: "süt",
      costMode: "fatura",
      categoryId: null,
      adoptExpenseId: null,
      dueDate: null,
      note: null,
      photoId: null,
      applyCredit: true,
      paid: null,
      confirmPast: [],
      kasaChoice: { action: "kapat", cashOutId: line.id, seen: [line.id] },
    });
    assert.ok(r.ok && r.data.needs === null);
    const kasaPay = (await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, line.id)))[0];
    const rows = await allocs();
    assert.deepEqual(rows.find((a) => a.paymentId === kasaPay.id && a.debtId !== null)?.amount, 400, "kasa satırının ödemesi borca");
    assert.equal((r.data as { credited: number }).credited, 50, "kalan 50 hesaptaki paradan");
  });

  test("Borcu düzenle: hesaptaki para kendiliğinden sayılmaz; sayıldıysa Geri al dağıtımı da kaldırır", async () => {
    const c = await card();
    const d = await addDebt(c.id, { amount: 200, date: todayTR(), description: "krema" });
    const debtId = (d.ok ? (d.data as { id: number }).id : 0);
    await pay(c.id, 1600, { mode: "none" });
    // Pencere düzenlemede anahtarı kapalı gönderir; açıkça açılırsa sayılır ve kimlikleri döner
    const e = await addDebt(c.id, { id: debtId, amount: 200, date: todayTR(), description: "krema", note: "not", applyCredit: true });
    assert.ok(e.ok && e.data.needs === null);
    const ids = (e.data as { creditAllocationIds: number[] }).creditAllocationIds;
    assert.equal(ids.length, 1);
    ok(await cari.removeAllocations({ allocationIds: ids }));
    assert.equal((await allocs()).length, 0);
  });

  test("Ödemeler'de faturasız alımın Ödendi'si: hesaptaki paradan yalnız satırın mahsubu, ödeme kaydı satırdaki tutar", async () => {
    const c = await card("Sütaş", { paymentMethod: "havale" });
    // A faturası daha erken vadeli: hesaptaki 100 ona düşer, borcun satırı 500 gösterir
    await invoice({ payable: 300, date: "2026-09-28", dueDate: "2026-10-28", invoiceNo: "A" });
    await pay(c.id, 100, { mode: "none" });
    const d = await addDebt(c.id, { amount: 500, date: "2026-10-06", description: "devir", costMode: "devir" });
    const debtId = (d.ok ? (d.data as { id: number }).id : 0);
    await db.update(s.supplierEntries).set({ dueDate: "2026-11-05" }).where(eq(s.supplierEntries.id, debtId));
    const r = ok(await cari.payDebt(debtId));
    assert.deepEqual([r.credited, r.amount], [0, 500]);
    const p = (await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, r.paymentId!)))[0];
    assert.equal(p.amount, 500, "bankadan giden 500");
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 100]], "hesaptaki 100 yerinde");
  });

  test("silinen ödemenin Geri al'ı bu arada elle ödendi yapılan faturaya para yazmaz (hesapta kalır)", async () => {
    const c = await card();
    const a = await invoice({ payable: 300, invoiceNo: "A" });
    const p = await pay(c.id, 300);
    assert.equal((await inv(a.id)).paidByLedger, true);
    const del = await cari.deleteSupplierEntry({ id: p.id });
    assert.ok(del.ok && del.data.needs === null);
    assert.equal((await inv(a.id)).unpaid, true);
    // Başka sekmede "Ayrıca ödendi" (nakit)
    ok(await invoices.setInvoicePayment([a.id], { status: "paid", date: todayTR(), via: "nakit" }, { separately: true }));
    const r = ok(await cari.restoreSupplierEntry((del.data as { undo: string }).undo));
    assert.equal(r.lost, 300);
    const now = await inv(a.id);
    assert.deepEqual([now.allocated, now.paidVia, now.paidByLedger], [0, "nakit", false]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 300]]);
  });

  test("silinen ödemenin Geri al'ı elle ✓'li faturaya (✓ hesaptaki bu parayı saymıştı) payını aynen geri yazar; Neye sayıldı ona yer verir", async () => {
    const c = await card();
    const f = await invoice({ payable: 1000, invoiceNo: "F1", date: "2026-10-05" });
    const p = await pay(c.id, 300, { mode: "none", date: "2026-10-04" });
    // ✓: önce hesaptaki 300 (K6), kalan 700 elle
    ok(await invoices.setInvoicePaid(f.id, true));
    const paid = await inv(f.id);
    assert.deepEqual([paid.unpaid, paid.paidByLedger, paid.allocated], [false, false, 300]);
    const del = ok(await cari.deleteSupplierEntry({ id: p.id }));
    assert.ok(del.needs === null && del.kept === 1, "elle ✓ kalır");
    assert.deepEqual([(await inv(f.id)).unpaid, (await inv(f.id)).allocated], [false, 0]);
    const r = ok(await cari.restoreSupplierEntry(del.undo));
    assert.equal(r.lost, 0, "pay geri yazıldı");
    const back = await inv(f.id);
    assert.deepEqual([back.unpaid, back.paidByLedger, back.allocated, back.paidAt], [false, false, 300, paid.paidAt]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [], "hesapta para kalmadı");
    // Bu ay ödenen: 300 (ödeme) + 700 (işaretli kısım), 1.300 değil
    const { paymentEvents } = await import("../src/lib/cari/account");
    const events = paymentEvents([await inv(f.id)], (await data.loadCardEntries([c.id])).payments);
    assert.equal(Math.round(events.reduce((a, e) => a + e.amount, 0) * 100) / 100, 1000);
    // Neye sayıldı · En eski borçtan: elle ✓'li faturadaki pay seçenektir (pencerenin önizlemesi gibi), hesaba geçmez
    const r2 = ok(await cari.setPaymentAllocation({ paymentId: p.id, mode: "auto", lines: [] }));
    assert.deepEqual(r2.lines.map((l) => [l.id, l.amount]), [[f.id, 300]]);
    assert.equal(r2.left, 0);
    assert.equal((await inv(f.id)).allocated, 300);
    // Seçerek de aynı satırla kaydedilir (Geri al'ın yolu)
    ok(await cari.setPaymentAllocation({ paymentId: p.id, mode: "manual", lines: [{ kind: "invoice", id: f.id, amount: 300 }] }));
    assert.equal((await inv(f.id)).allocated, 300);
  });

  test("✓'nin Geri al'ı reddedilince (fatura başka ödemeyle karşılanmış) hesaptaki paradan sayılanlar silinmez: bildirim ve Son ödenenler", async () => {
    const c = await card();
    const f = await invoice({ payable: 1000, invoiceNo: "F1" });
    await pay(c.id, 300, { mode: "none" });
    const marked = ok(await invoices.setInvoicePaid(f.id, true));
    const before = (await allocs()).filter((a) => a.invoiceId === f.id).map((a) => a.id);
    assert.equal(before.length, 1, "✓ hesaptaki 300'ü saydı");
    // Fatura bu arada başka bir ödemeyle tamamen karşılandı (ör. silinip geri alınan ödeme)
    const p2 = await pay(c.id, 1000, { mode: "none" });
    await db.transaction(async (tx) => {
      await settle.lockCard(tx, c.id);
      await settle.writeAllocations(tx, p2.id, [{ kind: "invoice", id: f.id, amount: 1000 }], "Test");
      await settle.recomputeAllocated(tx, [f.id]);
    });
    const all = (await allocs()).filter((a) => a.invoiceId === f.id).map((a) => a.id);
    const refused = await invoices.restoreInvoicePayment(marked.previous);
    assert.ok(!refused.ok && /sayılmış/.test(refused.error), "Ödenmedi engeli");
    assert.deepEqual((await allocs()).filter((a) => a.invoiceId === f.id).map((a) => a.id), all, "✓'nin dağıtımı yerinde");
    assert.equal((await inv(f.id)).allocated, 1300);
    const reminders = await import("../src/server/actions/reminders");
    const refused2 = await reminders.undoRecentPaid("invoice", f.id);
    assert.ok(!refused2.ok && /sayılmış/.test(refused2.error), "Son ödenenler'de de engel");
    assert.deepEqual((await allocs()).filter((a) => a.invoiceId === f.id).map((a) => a.id), all, "Son ödenenler'den de silinmez");
    assert.equal((await inv(f.id)).unpaid, false);
  });

  test("ödemenin günü ve şekli düzeltilince kapattığı faturanın ödeme günü ve şekli de değişir", async () => {
    const c = await card();
    const f = await invoice({ payable: 1000, invoiceNo: "SUT123" });
    const p = await pay(c.id, 1000, { date: "2026-10-22" });
    assert.deepEqual([(await inv(f.id)).paidAt, (await inv(f.id)).paidVia], ["2026-10-22", "havale"]);
    ok(await cari.saveSupplierPayment({ target: { cardId: c.id }, id: p.id, date: "2026-10-21", amount: 1000, method: "elden", cashOut: null, allocation: { mode: "none", lines: [] }, note: null, photoId: null }));
    assert.deepEqual([(await inv(f.id)).paidAt, (await inv(f.id)).paidVia, (await inv(f.id)).paidByLedger], ["2026-10-21", "nakit", true]);
  });

  test("Ertele'nin Geri al'ı alım gününden önceki vadeyi yazmaz", async () => {
    const c = await card();
    const d = await addDebt(c.id, { amount: 100, date: "2026-10-20" });
    const debtId = (d.ok ? (d.data as { id: number }).id : 0);
    const r = await cari.setSupplierDebtDueDate(debtId, "2026-01-05");
    assert.ok(!r.ok);
    const [row] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debtId));
    assert.equal(row.dueDate, null);
    ok(await cari.setSupplierDebtDueDate(debtId, "2026-11-01"));
  });

  test("Son ödenenler'den Ödemeye çevir'in geri alınması Kasa satırını alışverişe ve gider kaydını yerine döndürür", async () => {
    const c = await card();
    const cat = await category();
    // Kasanın günü (05:00'te döner), takvim günü değil: gece yarısından sonra da geçer
    const today = businessDate();
    const line = await cashOut({ amount: 300, kind: "harcama", store: "sütaş · şoföre", date: today });
    await db.insert(s.expenseEntries).values({ date: today, categoryId: cat.id, description: "şoföre", amount: 300, cashOutId: line.id, createdBy: "Ayşe" });
    const r = await cari.convertCashOutToPayment({ target: { cardId: c.id }, cashOutId: line.id, allocation: { mode: "none", lines: [] }, note: null, photoId: null, confirmPast: [] });
    assert.ok(r.ok && r.data.needs === null);
    const paymentId = (r.data as { id: number }).id;
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
    const reminders = await import("../src/server/actions/reminders");
    ok(await reminders.undoRecentPaid("cari", paymentId));
    const [l] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, line.id));
    assert.equal(l.kind, "harcama");
    const exps = await db.select().from(s.expenseEntries);
    assert.deepEqual(exps.map((e) => [e.cashOutId, e.amount]), [[line.id, 300]]);
    assert.equal((await db.select().from(s.supplierEntries)).length, 0);
  });

  test("K18: Ödemeye çevir'in geri alınması geçmiş ayın giderini onaysız yazmaz (Son ödenenler sorar, bildirimdeki Geri al çevirmenin onayıyla)", async () => {
    const c = await card();
    const cat = await category();
    const today = todayTR();
    const past = addDays(`${today.slice(0, 8)}01`, -3);
    const month = past.slice(0, 7);
    const convert = async (lineId: number, confirmPast: string[]) =>
      ok(await cari.convertCashOutToPayment({ target: { cardId: c.id }, cashOutId: lineId, allocation: { mode: "none", lines: [] }, note: null, photoId: null, confirmPast }));
    const shop = async () => {
      const line = await cashOut({ amount: 300, kind: "harcama", store: "sütaş · şoföre", date: past });
      await db.insert(s.expenseEntries).values({ date: past, categoryId: cat.id, description: "şoföre", amount: 300, cashOutId: line.id, createdBy: "Ayşe" });
      return line;
    };
    const reminders = await import("../src/server/actions/reminders");
    const lastLog = async () => (await db.select().from(s.activityLog).orderBy(asc(s.activityLog.id))).at(-1)!;

    // Son ödenenler: çevirmenin onayı haftalar sonra geçerli değil, ay yeniden sorulur
    const a = await shop();
    assert.equal((await convert(a.id, [])).needs, "past");
    const r = await convert(a.id, [month]);
    assert.equal(r.needs, null);
    const paymentId = (r as { id: number }).id;
    const asked = ok(await reminders.undoRecentPaid("cari", paymentId));
    assert.deepEqual(asked, { needs: "past", effects: [{ month, delta: 300 }] });
    assert.equal((await db.select().from(s.expenseEntries)).length, 0, "onaysız gider yazılmadı");
    assert.equal((await db.select().from(s.supplierEntries)).length, 1, "ödeme silinmedi");
    assert.equal((await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, a.id)))[0].kind, "teslim");
    const done = ok(await reminders.undoRecentPaid("cari", paymentId, [month]));
    assert.equal(done.needs, null);
    assert.deepEqual((await db.select().from(s.expenseEntries)).map((e) => [e.cashOutId, e.date, e.amount]), [[a.id, past, 300]]);
    assert.match((await lastLog()).detail ?? "", /gider kaydı yeniden yazıldı · son ödenenlerden geri alındı · geçmiş ay değişti: /);

    // Bildirimdeki Geri al (15 dakika): çevirmede onaylanan ay mühürde; işlem geçmişine yine düşer
    const b = await shop();
    const r2 = await convert(b.id, [month]);
    const undone = ok(await cari.undoCashOutConversion((r2 as { undo: string }).undo));
    assert.equal(undone.expenseRestored, true);
    assert.equal((await db.select().from(s.expenseEntries)).filter((e) => e.cashOutId === b.id).length, 1);
    assert.match((await lastLog()).detail ?? "", /geçmiş ay değişti: /);

    // Onaylanmamış ay (ör. çevirme ayın son gününde, geri alma ertesi ay): sunucu yazmaz
    const k = await import("../src/server/cari/kasa");
    const entries = await import("../src/server/cari/entries");
    const c3 = await shop();
    const r3 = await convert(c3.id, [month]);
    const [entry] = (await (await import("../src/server/data/recent-paid")).loadRecentPaid()).filter((e) => e.kind === "cari" && e.id === (r3 as { id: number }).id);
    await assert.rejects(
      db.transaction((tx) => k.undoConversion(tx, entry.conversion as import("../src/server/cari/kasa").ConvertSnapshot, [])),
      (e) => e instanceof entries.NeedsPastConfirm,
    );
    assert.equal((await db.select().from(s.expenseEntries)).filter((e) => e.cashOutId === c3.id).length, 0);
  });

  test("Kasa denetimi 'Ayrı alım': aynı Teslim satırı yeni borcu 'Kasadan ödenmiş olabilir' diye sessize almaz (yalnız o borçta)", async () => {
    const c = await card();
    const today = todayTR();
    const teslim = await cashOut({ amount: 2200, date: today });
    const r = ok(
      await cari.saveSupplierDebt({
        target: { cardId: c.id },
        id: null,
        date: today,
        amount: 1250,
        description: "süt",
        costMode: "fatura",
        categoryId: null,
        adoptExpenseId: null,
        dueDate: null,
        note: null,
        photoId: null,
        applyCredit: false,
        paid: null,
        confirmPast: [],
        kasaChoice: { action: "ayri", seen: [teslim.id] },
      }),
    );
    assert.equal(r.needs, null);
    const debtId = (r as { id: number }).id;
    // Kasa denetiminden geçmeden yazılmış başka bir borç (tutarı satırınki): ipucu ve sessizlik onda
    const [other] = await db
      .insert(s.supplierEntries)
      .values({ supplierId: c.id, kind: "borc", date: today, amount: 2200, description: "kaymak", costMode: "fatura", createdByName: "Test" })
      .returning();
    const digest = await import("../src/server/notify/digest");
    const up = await digest.loadUpcoming(today);
    const mine = up.items.find((i) => i.ref === `cari:${debtId}`);
    assert.ok(mine, "borç listede");
    assert.equal(mine.quiet, undefined, "ayrı alım denen satır bu borcu sessize almaz");
    assert.equal(mine.hint, undefined);
    const theirs = up.items.find((i) => i.ref === `cari:${other.id}`);
    assert.equal(theirs?.quiet, "kasa");
    assert.equal(theirs?.hint?.kind === "kasa" ? theirs.hint.cashOutId : null, teslim.id);
    const index = await data.loadCariIndex(today);
    assert.deepEqual(index.kasaPending.map((l) => l.id), [teslim.id], "satır Ödeme ekle › Kasadan için işlenmemiş kalır");
  });

  test("Kasa denetimi 'Ayrı alım': borç faturasına bağlanınca fatura da aynı Teslim satırıyla sessize alınmaz (sabah e-postası hatırlatır)", async () => {
    const c = await card();
    const today = todayTR();
    const teslim = await cashOut({ amount: 2200, date: today });
    const r = ok(
      await cari.saveSupplierDebt({
        target: { cardId: c.id },
        id: null,
        date: today,
        amount: 1250,
        description: "süt",
        costMode: "fatura",
        categoryId: null,
        adoptExpenseId: null,
        dueDate: null,
        note: null,
        photoId: null,
        applyCredit: false,
        paid: null,
        confirmPast: [],
        kasaChoice: { action: "ayri", seen: [teslim.id] },
      }),
    );
    const debtId = (r as { id: number }).id;
    const sts1 = await invoice({ payable: 1300, date: today, dueDate: today, invoiceNo: "STS1" });
    // Aynı günün bağsız faturası (tutarı satırınki): "Ayrı alım" onun için denmedi, ipucu onda kalır
    const sts2 = await invoice({ payable: 2200, date: today, dueDate: today, invoiceNo: "STS2" });
    assert.equal(ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [debtId], invoiceId: sts1.id })).needs, null);
    const digest = await import("../src/server/notify/digest");
    const { dueNotifications } = await import("../src/lib/reminders");
    const up = await digest.loadUpcoming(today);
    const linked = up.items.find((i) => i.ref === `invoice:${sts1.id}`);
    assert.ok(linked, "fatura listede");
    assert.equal(linked.quiet, undefined, "alımda ayrı denen satır faturasını sessize almaz");
    assert.equal(linked.hint, undefined);
    assert.ok(dueNotifications(up.items).some((n) => n.item.ref === `invoice:${sts1.id}`), "sabah e-postası hatırlatır");
    const other = up.items.find((i) => i.ref === `invoice:${sts2.id}`);
    assert.equal(other?.quiet, "kasa");
    assert.equal(other?.hint?.kind === "kasa" ? other.hint.cashOutId : null, teslim.id);
  });

  test("şube kapsamı (24 Kasım): cari işletme geneli, kasa satırı şubenin; Marina'nın zil sayısı Tuzla'nın Teslim satırını saymaz, fatura yine sessiz", async () => {
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoNothing();
    await card();
    const today = todayTR();
    const teslim = await cashOut({ amount: 2200, date: today, branchId: "tuzla" });
    const sts = await invoice({ payable: 2200, date: today, dueDate: today, invoiceNo: "STS9" });
    const digest = await import("../src/server/notify/digest");
    const count = async (branch: string) => (await digest.loadUpcoming(today, { branch })).cari.kasaPending.count;
    assert.equal(await count("marina"), 0, "Tuzla'nın kasasından çıkan satır Marina'nın zilinde sayılmaz");
    assert.equal(await count("tuzla"), 1);
    assert.equal(await count("hepsi"), 1);
    // Liste süzülmez: Tuzla'nın kasasından ödenmiş fatura Marina'da da "kasadan ödenmiş olabilir" diye sessiz
    const up = await digest.loadUpcoming(today, { branch: "marina" });
    const item = up.items.find((i) => i.ref === `invoice:${sts.id}`);
    assert.equal(item?.quiet, "kasa");
    assert.equal(item?.hint?.kind === "kasa" ? item.hint.cashOutId : null, teslim.id);
    const index = await data.loadCariIndex(today);
    assert.deepEqual(
      index.kasaPending.map((l) => [l.id, l.branchId]),
      [[teslim.id, "tuzla"]],
    );
  });

  test("K18: silinen borcun Geri al'ı geçmiş ayın giderini silmenin onayıyla yazar, onaylanmamış ayı yazmaz; işlem geçmişine düşer", async () => {
    const c = await card();
    const cat = await category();
    const today = todayTR();
    const past = addDays(`${today.slice(0, 8)}01`, -3);
    const month = past.slice(0, 7);
    const lastLog = async () => (await db.select().from(s.activityLog).orderBy(asc(s.activityLog.id))).at(-1)!;
    const gider = async () => {
      const r = ok(await addDebt(c.id, { amount: 300, date: past, description: "kaşar", costMode: "gider", categoryId: cat.id, confirmPast: [month] }));
      assert.equal(r.needs, null);
      return (r as { id: number }).id;
    };

    // Bildirimdeki Geri al: silmede onaylanan ay mühürde, gider kaydı aynı aya döner
    const a = await gider();
    assert.equal(ok(await cari.deleteSupplierEntry({ id: a })).needs, "past");
    const del = ok(await cari.deleteSupplierEntry({ id: a, confirmPast: [month] }));
    assert.equal(del.needs, null);
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
    ok(await cari.restoreSupplierEntry((del as { undo: string }).undo));
    assert.deepEqual((await db.select().from(s.expenseEntries)).map((e) => [e.supplierEntryId, e.date, e.amount]), [[a, past, 300]]);
    assert.match((await lastLog()).detail ?? "", /^Sütaş · borç · .* · geçmiş ay değişti: /);

    // Mühürde ay yoksa (ör. eski kopya ya da silme ayın son günü, geri alma ertesi ay) sunucu yazmaz
    const b = await gider();
    const entries = await import("../src/server/cari/entries");
    const removed = await db.transaction((tx) => entries.deleteEntry(tx, b, [month]));
    const snap = JSON.parse(JSON.stringify(removed.snapshot)) as import("../src/server/cari/entries").EntrySnapshot;
    await assert.rejects(
      db.transaction((tx) => entries.restoreEntry(tx, { id: 1, name: "Test" }, snap, [])),
      (e) => e instanceof entries.NeedsPastConfirm,
    );
    assert.equal((await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, b))).length, 0, "borç geri yazılmadı");
    assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.supplierEntryId, b))).length, 0, "gider yazılmadı");
    const { seal } = await import("../src/server/secret-box");
    const [me] = await db.select().from(s.users).limit(1);
    const old = seal(JSON.stringify({ v: 1, by: me.id, exp: Date.now() + 60_000, snap }), "cari-undo");
    const refused = await cari.restoreSupplierEntry(old);
    assert.ok(!refused.ok && /geçmiş ay/.test(refused.error), "eski kopya ayı onaylamadan geri yazmaz");
    assert.equal((await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, b))).length, 0);
  });

  test("K23: ödemesi sayılmış faturayı başka karta taşıyan diğer ad, vergi no, yeni kart ve faturanın tedarikçi adı reddedilir", async () => {
    const suppliers = await import("../src/server/actions/suppliers");
    const blank = { aliases: [] as string[], legalName: "", taxNumber: "", taxOffice: "", iban: "", bankName: "", accountHolder: "", contactName: "", phone: "", email: "", address: "", paymentTermDays: null, paymentMethod: null, paidOnDelivery: false, note: "" };
    const VKN = "1234567808";
    const sutas = await card("Sütaş", { taxNumber: VKN });
    const pinar = await card("Pınar");
    const f = await invoice({ payable: 3000, supplier: "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", supplierTaxNumber: VKN, invoiceNo: "SUT140" });
    await pay(sutas.id, 1549.5, { mode: "manual", lines: [{ kind: "invoice", id: f.id, amount: 1549.5 }] });
    const rejected = async (r: Promise<{ ok: boolean }>, what: string) => assert.equal((await r).ok, false, what);
    await rejected(suppliers.saveSupplier({ id: sutas.id, name: "Sütaş", ...blank, taxNumber: "" }), "kendi vergi nosunu silmek");
    await rejected(suppliers.saveSupplier({ id: pinar.id, name: "Pınar", ...blank, aliases: ["SÜTAŞ SÜT ÜRÜNLERİ A.Ş."] }), "başka karta diğer ad");
    await rejected(suppliers.saveSupplier({ id: pinar.id, name: "Pınar", ...blank, taxNumber: VKN }), "başka karta aynı vergi no");
    await rejected(suppliers.saveSupplier({ id: null, name: "Sütaş Ege", ...blank, aliases: ["SÜTAŞ SÜT ÜRÜNLERİ A.Ş."] }), "yeni kart");
    const x = await inv(f.id);
    await rejected(invoices.saveInvoice(invoiceForm(x, { supplier: "Pınar" })), "faturanın tedarikçi adı");
    // Faturaya dokunmayan değişiklikler geçer
    ok(await suppliers.saveSupplier({ id: pinar.id, name: "Pınar", ...blank, aliases: ["Pınar Süt"] }));
    ok(await suppliers.saveSupplier({ id: null, name: "Metro", ...blank }));
    ok(await invoices.saveInvoice(invoiceForm(x, { supplier: "Sütaş" })));
  });

  test("silinen Paraşüt faturası geri alınınca bağlı faturasız alım yeniden bağlanır (gider iki kez sayılmaz)", async () => {
    const c = await card();
    const cat = await category();
    const today = todayTR();
    const d = await addDebt(c.id, { amount: 1300, date: today, costMode: "gider", categoryId: cat.id, description: "süt" });
    const debtId = (d.ok ? (d.data as { id: number }).id : 0);
    const f = await invoice({ payable: 1250, date: today, invoiceNo: "SUT149", source: "parasut", origin: "parasut", externalId: "149" });
    ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [debtId], invoiceId: f.id }));
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
    ok(await invoices.deleteInvoice(f.id));
    assert.equal((await db.select().from(s.expenseEntries)).length, 1, "silme gider kaydını yeniden yazar");
    const r = ok(await invoices.unignoreParasutBill("149"));
    assert.equal(r.status, "restored");
    assert.match(r.message, /1 faturasız alım faturaya yeniden bağlandı/);
    assert.doesNotMatch(r.message, /Ödemeler bu faturaya yeniden sayılmadı/);
    const [debtRow] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debtId));
    assert.notEqual(debtRow.invoiceId, null);
    assert.equal((await db.select().from(s.expenseEntries)).length, 0, "gider yalnız faturada");
  });

  test("gider faturası ve e-faturası olan Paraşüt kaydı silinince iki anahtar da yok sayılır, geri alınınca ikisi çıkar (denetim 21 Kasım #3)", async () => {
    const { IGNORE_KEY } = await import("../src/server/parasut/sync");
    const { DELETED_BILLS_KEY, ignoredBills } = await import("../src/app/panel/faturalar/rules");
    const state = async (key: string) => (await db.select().from(s.integrationState).where(eq(s.integrationState.key, key)))[0]?.value;
    // Muhasebecinin elle girdiği gider faturası (150) ve aynı numaralı e-fatura (E150) aynı kayıtta (PARASUT.md §6)
    const f = await invoice({ payable: 1250, invoiceNo: "SUT2026000000150", source: "parasut", origin: "parasut", externalId: "150", eInvoiceId: "E150" });
    const d = ok(await invoices.deleteInvoice(f.id));
    assert.equal(d.externalId, "150", "listenin ve Geri al'ın anahtarı gider faturası");
    assert.deepEqual(await state(IGNORE_KEY), ["150", "ei:E150"], "e-fatura eşitlemesi (ei:E150) de yok sayar");
    const deleted = (await state(DELETED_BILLS_KEY)) as { externalId: string; alsoIgnored?: string[] }[];
    assert.deepEqual(deleted.map((e) => [e.externalId, e.alsoIgnored]), [["150", ["ei:E150"]]]);
    assert.deepEqual(ignoredBills(await state(IGNORE_KEY), deleted).map((b) => b.externalId), ["150"], "listede tek satır");

    // Geri al: iki anahtar birlikte çıkar, kayıt iki kimliğiyle döner
    assert.equal(ok(await invoices.unignoreParasutBill("150")).status, "restored");
    assert.deepEqual(await state(IGNORE_KEY), []);
    const [back] = await db.select().from(s.invoices).where(eq(s.invoices.externalId, "150"));
    assert.equal(back.eInvoiceId, "E150");

    // Düzeltmeden önce silinmiş kayıt: eşitleme e-faturadan yeni kayıt açmıştı (E150 onda). Geri alma benzersiz e-fatura
    // kimliğine çarpıp düşmez, "zaten listede" der
    ok(await invoices.deleteInvoice(back.id));
    await invoice({ payable: 1250, invoiceNo: "SUT2026000000150", source: "parasut", origin: "parasut", eInvoiceId: "E150" });
    const r = ok(await invoices.unignoreParasutBill("150"));
    assert.equal(r.status, "exists");
    assert.deepEqual(await state(IGNORE_KEY), []);
    assert.equal((await db.select().from(s.invoices)).length, 1);
  });

  test("FC-01: kısmen cari ödemesi sayılmış, kalanı ✓ ile ödenmiş Paraşüt faturası silinip geri alınınca ödeme yeniden sayılır (tedarikçi alacaklı görünmez)", async () => {
    const c = await card();
    const today = todayTR();
    const f = await invoice({ payable: 1000, date: today, invoiceNo: "SUT2026000000001", source: "parasut", origin: "parasut", externalId: "PB-1" });
    await pay(c.id, 400, { date: today });
    ok(await invoices.setInvoicePaid(f.id, true));
    const credit = async () => (await settle.cardsWithCredit()).get(c.id) ?? 0;
    assert.deepEqual([(await inv(f.id)).allocated, (await inv(f.id)).unpaid, await credit()], [400, false, 0]);
    ok(await invoices.deleteInvoice(f.id));
    assert.equal(await credit(), 400, "silinince ödeme hesaba geçer");
    const r = ok(await invoices.unignoreParasutBill("PB-1"));
    assert.equal(r.status, "restored");
    assert.doesNotMatch(r.message, /yeniden sayılmadı|yeniden sayılamadı/);
    const [back] = await db.select().from(s.invoices).where(eq(s.invoices.externalId, "PB-1"));
    assert.deepEqual([back.allocated, back.unpaid, back.paidByLedger], [400, false, false], "ödeme faturaya döndü, ✓ kaldı");
    assert.equal(await credit(), 0, "hesapta avans kalmadı");
  });

  test("FC-01: defterin kapattığı Paraşüt faturası geri alınınca yeniden defterle kapanır; ödeme bu arada harcandıysa açık döner ve söylenir", async () => {
    const c = await card();
    const today = todayTR();
    const f = await invoice({ payable: 800, date: today, invoiceNo: "SUT2026000000002", source: "parasut", origin: "parasut", externalId: "PB-2" });
    await pay(c.id, 800, { date: today });
    assert.deepEqual([(await inv(f.id)).unpaid, (await inv(f.id)).paidByLedger], [false, true]);
    ok(await invoices.deleteInvoice(f.id));
    ok(await invoices.unignoreParasutBill("PB-2"));
    let [back] = await db.select().from(s.invoices).where(eq(s.invoices.externalId, "PB-2"));
    assert.deepEqual([back.allocated, back.unpaid, back.paidByLedger], [800, false, true]);
    // Silinip bu arada para başka faturaya sayılınca: geri gelen fatura ödenmemiş açılır, mesaj söyler
    ok(await invoices.deleteInvoice(back.id));
    const other = await invoice({ payable: 800, date: today, invoiceNo: "SUT2026000000003" });
    ok(await cari.applySupplierCredit({ cardId: c.id }));
    assert.equal((await inv(other.id)).allocated, 800);
    const r = ok(await invoices.unignoreParasutBill("PB-2"));
    assert.match(r.message, /800,00\s₺ ödeme yeniden sayılamadı \(bu arada başka kaleme sayıldı/);
    [back] = await db.select().from(s.invoices).where(eq(s.invoices.externalId, "PB-2"));
    assert.deepEqual([back.allocated, back.unpaid, back.paidByLedger], [0, true, false]);
  });

  test("FC-01: dağıtım listesi olmayan eski kopya: ödeme sayılmış fatura ödenmemiş döner, Borçlara say onu kapatabilir", async () => {
    const c = await card();
    const today = todayTR();
    const f = await invoice({ payable: 1000, date: today, invoiceNo: "SUT2026000000004", source: "parasut", origin: "parasut", externalId: "PB-4" });
    await pay(c.id, 400, { date: today });
    ok(await invoices.setInvoicePaid(f.id, true));
    ok(await invoices.deleteInvoice(f.id));
    // Bu düzeltmeden önce silinmiş faturanın kopyası: cari'de dağıtımlar yok (yalnız toplam)
    const [state] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.deleted"));
    const entries = (state.value as { externalId: string; cari?: { allocations?: unknown } }[]).map((e) => (e.cari ? { ...e, cari: { ...e.cari, allocations: undefined } } : e));
    await db.update(s.integrationState).set({ value: JSON.parse(JSON.stringify(entries)) }).where(eq(s.integrationState.key, "parasut.deleted"));
    const r = ok(await invoices.unignoreParasutBill("PB-4"));
    assert.match(r.message, /Ödemeler bu faturaya yeniden sayılmadı, fatura ödenmemiş döndü: Tedarikçiler'den Borçlara say/);
    const [back] = await db.select().from(s.invoices).where(eq(s.invoices.externalId, "PB-4"));
    assert.deepEqual([back.unpaid, back.allocated], [true, 0]);
    // Mesajın önerdiği Borçlara say çalışır (✓'li kalsaydı "açık kalem yok" derdi)
    ok(await cari.applySupplierCredit({ cardId: c.id }));
    assert.equal((await inv(back.id)).allocated, 400);
  });

  test("silinen fatura geri alınınca başka kartın ya da kartsız tedarikçinin faturasına bağlı alım da yeniden bağlanır; bağlanamayan söylenir", async () => {
    const c = await card();
    await card("Pınar");
    const cat = await category();
    const today = todayTR();
    const debt = async (amount: number, description: string) => (ok(await addDebt(c.id, { amount, date: today, costMode: "gider", categoryId: cat.id, description })) as { id: number }).id;
    const expensesOf = async (debtId: number) => (await db.select().from(s.expenseEntries)).filter((e) => e.supplierEntryId === debtId).length;
    const linkedTo = async (debtId: number) => (await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debtId)))[0].invoiceId;
    // Kartsız tedarikçinin faturası (ad eklenmeden) ve başka kartın faturası
    const d1 = await debt(1000, "süt");
    const f1 = await invoice({ payable: 1000, date: today, supplier: "Bakkal Bey", invoiceNo: "BB1" });
    ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [d1], invoiceId: f1.id }));
    const d2 = await debt(500, "kaymak");
    const f2 = await invoice({ payable: 500, date: today, supplier: "Pınar", invoiceNo: "PN1" });
    ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [d2], invoiceId: f2.id }));
    let restored = 0;
    for (const [f, d] of [
      [f1, d1],
      [f2, d2],
    ] as const) {
      assert.equal(await expensesOf(d), 0);
      const del = ok(await invoices.deleteInvoice(f.id));
      assert.equal(await expensesOf(d), 1, "silme gider kaydını yeniden yazar");
      const r = ok(await invoices.restoreInvoice(del.snapshot!));
      assert.equal(await linkedTo(d), r.id, `${f.invoiceNo}: alım yeniden bağlandı`);
      assert.equal(await expensesOf(d), 0, `${f.invoiceNo}: gider yalnız faturada (iki kez sayılmaz)`);
      assert.equal("message" in r, false);
      if (f === f1) restored = r.id;
    }
    // Bu arada başka faturaya bağlanan alım yeniden bağlanamaz: geri alma bunu söyler
    const del = ok(await invoices.deleteInvoice(restored));
    const f3 = await invoice({ payable: 1000, date: today, invoiceNo: "SUT9" });
    ok(await cari.linkDebtsToInvoice({ cardId: c.id, debtIds: [d1], invoiceId: f3.id }));
    const r = ok(await invoices.restoreInvoice(del.snapshot!));
    assert.equal(await linkedTo(d1), f3.id);
    assert.match(r.message ?? "", /1 faturasız alım yeniden bağlanamadı/);
  });

  test("nakit planı K19: faturası gelecek borcun kartı vergi noyla bağlanan tüzel addaki faturaların tahminini de düşürür", async () => {
    const VKN = "1234567808";
    const c = await card("Sütaş", { taxNumber: VKN });
    await invoice({ payable: 1000, supplier: "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", supplierTaxNumber: VKN });
    await addDebt(c.id, { amount: 1250 });
    const [row] = await data.loadExpectedDebtsByCard();
    assert.equal(row.amount, 1250);
    assert.ok(row.keys.includes("sütaş süt ürünleri a.ş."), row.keys.join(", "));
  });
});
