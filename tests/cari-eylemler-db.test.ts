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

import { openBalance } from "../src/lib/cari/balance";
import { addDays, todayTR } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.CARI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_cari_eylem_${process.pid}`;

describe("cari eylemleri: veritabanında", { skip: !SERVER_URL && "CARI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let settle: typeof import("../src/server/cari/settle");
  let entries: typeof import("../src/server/cari/entries");
  let kasa: typeof import("../src/server/cari/kasa");
  let cari: typeof import("../src/server/actions/cari");
  let invoices: typeof import("../src/server/actions/invoices");
  let data: typeof import("../src/server/data/cari");
  let me: { id: number; name: string };

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
    me = { id: u.id, name: u.name };
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => ({ ...u, role: "admin" }), requireUser: async () => ({ ...u, role: "admin" }) });
    settle = await import("../src/server/cari/settle");
    entries = await import("../src/server/cari/entries");
    kasa = await import("../src/server/cari/kasa");
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
});

// Kullanılmayan içe aktarmalar sonraki testler için
void openBalance;
void addDays;
void todayTR;
