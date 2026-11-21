// Cari hesabın veritabanı tarafı (src/server/cari/settle.ts), gerçek Postgres'te: CHECK'ler, kart kilidiyle iki
// eşzamanlı ödemenin aynı faturayı aşırı ödememesi, ödeme silinince CASCADE ve `allocated`, defterin ödendi işareti,
// "Faturası geldi" ve fatura silinmeden önce bağların çözülmesi (borç eski hâline, gider kaydı yeniden, para hesaba),
// eşitlemeden sonra yeniden dengeleme (tutar düşer / artar), peşin faturaya hesaptaki para, "Ödenmedi" engeli,
// ✓'nin hesaptaki parayı kullanması ve geri alınması, silinen faturanın bağlarının geri kurulması, kartsız tedarikçiye
// ilk kayıtta kart (ensureCard), db:reset engeli.
//
// CARI_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: CARI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/cari-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { cariResetBlock } from "../scripts/seed";
import { supplierMatchKey } from "../src/app/panel/faturalar/rules";
import { allocateFifo, openItems } from "../src/lib/cari/account";
import { businessDate } from "../src/lib/cash-report";
import { addDays } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.CARI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_cari_test_${process.pid}`;

test("db:reset: cari kaydı varsa durur, --cari-sil ile geçer; denetim TRUNCATE'ten önce, yedekten sonra", () => {
  assert.equal(cariResetBlock(0, false, "/tmp/y.json.gz"), null);
  assert.equal(cariResetBlock(3, true, "/tmp/y.json.gz"), null);
  assert.equal(
    cariResetBlock(3, false, "/tmp/y.json.gz"),
    "Cari hareketleri var (3 kayıt). db:reset onları siler, Kasa satırları kalır ve faturalar ödenmemiş geri gelir. Yedek alındı: /tmp/y.json.gz. Yine de silmek için: npm run db:reset -- --cari-sil",
  );
  const seed = readFileSync(join(__dirname, "..", "scripts", "seed.ts"), "utf8");
  const run = seed.slice(seed.indexOf("export async function runSeed"));
  assert.ok(run.indexOf("writeBackupFile(") < run.indexOf("cariResetBlock("), "önce yedek");
  assert.ok(run.indexOf("cariResetBlock(") < run.indexOf("TRUNCATE"), "sonra engel, sonra silme");
  assert.match(run, /wipeCari \? \["supplier_allocations", "supplier_entries"\] : \[\]/);
  assert.match(seed, /wipeCari: args\.includes\("--cari-sil"\)/);
});

describe("cari: veritabanında", { skip: !SERVER_URL && "CARI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let settle: typeof import("../src/server/cari/settle");
  let entries: typeof import("../src/server/cari/entries");
  let UserError: typeof import("../src/server/actions/util").UserError;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "cari-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    settle = await import("../src/server/cari/settle");
    entries = await import("../src/server/cari/entries");
    UserError = (await import("../src/server/actions/util")).UserError;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE supplier_allocations, supplier_entries, expense_entries, invoices, suppliers, cash_outs, activity_log RESTART IDENTITY CASCADE`);
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
  async function category(name = "Nakit malzeme alımı") {
    const [c] = await db.insert(s.expenseCategories).values({ name, section: "mal" }).onConflictDoNothing().returning();
    return c ?? (await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.name, name)))[0];
  }
  async function debt(cardId: number, p: Partial<typeof s.supplierEntries.$inferInsert> & { amount: number }) {
    const [r] = await db
      .insert(s.supplierEntries)
      .values({ supplierId: cardId, kind: "borc", date: "2026-10-20", costMode: "fatura", createdByName: "Test", ...p })
      .returning();
    return r;
  }
  const inv = async (id: number) => (await db.select().from(s.invoices).where(eq(s.invoices.id, id)))[0];
  const allocs = () => db.select().from(s.supplierAllocations).orderBy(asc(s.supplierAllocations.id));

  /**
   * Ödeme ekle, "En eski borçtan" (eylemin çekirdeği): kart kilidi, takip, açık kalemler kilit altında yeniden
   * okunur, dağıtım, toplam ve ödendi işareti. `pause` kilit alındıktan sonra bekletir (eşzamanlılık sınaması)
   */
  async function payFifo(cardId: number, amount: number, date: string, method: "havale" | "kasa" | "elden" = "havale", pause = 0) {
    return db.transaction(async (tx) => {
      await settle.lockCard(tx, cardId);
      if (pause) await new Promise((r) => setTimeout(r, pause));
      const group = await settle.cardInvoiceIds(tx, cardId);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.supplierEntries).where(sql`${s.supplierEntries.supplierId} = ${cardId} and ${s.supplierEntries.kind} = 'odeme'`);
      if (!n) await settle.startTracking(tx, group);
      const invoices = group.length ? await tx.select().from(s.invoices).where(sql`${s.invoices.id} in ${group}`) : [];
      const entries = await tx.select().from(s.supplierEntries).where(eq(s.supplierEntries.supplierId, cardId));
      const all = await tx.select().from(s.supplierAllocations);
      const debts = entries.filter((e) => e.kind === "borc").map((e) => ({ ...e, costMode: e.costMode ?? "fatura" }));
      const plan = allocateFifo(openItems({ invoices, debts, allocations: all }, 30), amount);
      const [p] = await tx
        .insert(s.supplierEntries)
        .values({ supplierId: cardId, kind: "odeme", date, amount, method, cashOutId: null, createdByName: "Test" })
        .returning();
      await settle.writeAllocations(tx, p.id, plan.lines, "Test");
      const touched = plan.lines.filter((l) => l.kind === "invoice").map((l) => l.id);
      await settle.recomputeAllocated(tx, touched);
      await settle.resettle(tx, touched);
      return { id: p.id, plan };
    });
  }

  // ---------------------------------------------------------------- testler

  test("CHECK'ler: tür alanları, kasa satırı, gider kategorisi, tutar ve dağıtım hedefi", async () => {
    const c = await card();
    const bad = async (q: Promise<unknown>, name: string) => {
      await assert.rejects(q, (e: { cause?: { constraint_name?: string }; constraint_name?: string }) => (e.cause?.constraint_name ?? e.constraint_name) === name);
    };
    await bad(db.insert(s.supplierEntries).values({ supplierId: c.id, kind: "borc", date: "2026-10-20", amount: 10, createdByName: "T" }), "supplier_entries_kind_ck");
    await bad(db.insert(s.supplierEntries).values({ supplierId: c.id, kind: "odeme", date: "2026-10-20", amount: 10, method: "havale", costMode: "fatura", createdByName: "T" }), "supplier_entries_kind_ck");
    await bad(db.insert(s.supplierEntries).values({ supplierId: c.id, kind: "odeme", date: "2026-10-20", amount: 10, method: "kasa", createdByName: "T" }), "supplier_entries_kasa_ck");
    await bad(db.insert(s.supplierEntries).values({ supplierId: c.id, kind: "borc", date: "2026-10-20", amount: 10, costMode: "gider", createdByName: "T" }), "supplier_entries_gider_ck");
    await bad(db.insert(s.supplierEntries).values({ supplierId: c.id, kind: "borc", date: "2026-10-20", amount: 0, costMode: "devir", createdByName: "T" }), "supplier_entries_amount_ck");
    const [p] = await db.insert(s.supplierEntries).values({ supplierId: c.id, kind: "odeme", date: "2026-10-20", amount: 10, method: "havale", createdByName: "T" }).returning();
    const d = await debt(c.id, { amount: 5 });
    const f = await invoice({ payable: 5 });
    await bad(db.insert(s.supplierAllocations).values({ paymentId: p.id, amount: 5, createdByName: "T" }), "supplier_allocations_target_ck");
    await bad(db.insert(s.supplierAllocations).values({ paymentId: p.id, invoiceId: f.id, debtId: d.id, amount: 5, createdByName: "T" }), "supplier_allocations_target_ck");
    await bad(db.insert(s.supplierAllocations).values({ paymentId: p.id, debtId: d.id, amount: -1, createdByName: "T" }), "supplier_allocations_amount_ck");
    // Kart kaydı varken silinmez (ON DELETE RESTRICT)
    await assert.rejects(db.delete(s.suppliers).where(eq(s.suppliers.id, c.id)));
  });

  test("iki eşzamanlı ödeme aynı faturayı aşırı ödemez: ikincisi kart kilidini bekler, parası hesapta kalır", async () => {
    const c = await card();
    const f = await invoice({ payable: 1000 });
    const [a, b] = await Promise.all([payFifo(c.id, 1000, "2026-10-22", "havale", 150), payFifo(c.id, 1000, "2026-10-22", "havale", 150)]);
    const rows = await allocs();
    assert.equal(rows.length, 1, "yalnız biri faturaya sayıldı");
    assert.equal(rows.reduce((x, r) => x + r.amount, 0), 1000);
    assert.equal([a, b].filter((r) => r.plan.left === 1000).length, 1, "öteki hesapta kaldı");
    const now = await inv(f.id);
    assert.deepEqual([now.unpaid, now.paidByLedger, now.allocated, now.paidAt, now.paidVia], [false, true, 1000, "2026-10-22", "havale"]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 1000]]);
  });

  test("takip başlarken taban: Paraşüt'te kısmen ödenmiş fatura 'Ödenecek − kalan', öteki 0; yeni fatura kuralı", async () => {
    const c = await card();
    const f1 = await invoice({ payable: 4000, unpaid: false, paidAt: "2026-10-10" });
    const f3 = await invoice({ payable: 3000, outstanding: 1800, date: "2026-10-18" });
    await payFifo(c.id, 1549.5, "2026-10-22");
    assert.equal((await inv(f1.id)).ledgerBase, 0);
    const now = await inv(f3.id);
    assert.deepEqual([now.ledgerBase, now.allocated, now.unpaid], [1200, 1549.5, true]);
    assert.equal(await settle.ledgerBaseForNew("SÜTAŞ", null), 0, "takipli kartın yeni faturası");
    assert.equal(await settle.ledgerBaseForNew("Pınar", null), null);
    const resolve = await settle.trackedCardResolver();
    assert.deepEqual(resolve("sütaş"), { id: c.id, since: "2026-10-22" }, "takip ilk ödemenin günüyle başlar");
    assert.equal(resolve("Pınar"), null);
    // Eşitlemenin yeni faturası: takip gününden önceki tarihli Paraşüt'te ödenen kısmı taban alır, sonrası 0
    const arriving = { payable: 1100, unpaid: true, outstanding: 600 };
    assert.equal(settle.arrivalLedgerBase(resolve("sütaş"), { ...arriving, date: "2026-05-18" }), 500);
    assert.equal(settle.arrivalLedgerBase(resolve("sütaş"), { ...arriving, date: "2026-10-22" }), 0);
    assert.equal(settle.arrivalLedgerBase(resolve("Pınar"), { ...arriving, date: "2026-05-18" }), null, "takipsiz kart");
  });

  test("ödeme silinince dağıtımlar CASCADE ile kalkar; defterin kapattığı açılır, elle ✓ kalır", async () => {
    const c = await card();
    const f1 = await invoice({ payable: 500, date: "2026-10-01" });
    const f2 = await invoice({ payable: 700, date: "2026-10-02" });
    const p = await payFifo(c.id, 900, "2026-10-22");
    // f2 kısmen sayıldı (400); kalanını kullanıcı elle ✓ yapar
    await db.update(s.invoices).set({ unpaid: false, paidAt: "2026-10-23", paidVia: "nakit", paidByLedger: false }).where(eq(s.invoices.id, f2.id));
    assert.deepEqual([(await inv(f1.id)).paidByLedger, (await inv(f2.id)).allocated], [true, 400]);
    await db.transaction(async (tx) => {
      await settle.lockCard(tx, c.id);
      await tx.delete(s.supplierEntries).where(eq(s.supplierEntries.id, p.id));
      await settle.recomputeAllocated(tx, [f1.id, f2.id]);
      const r = await settle.resettle(tx, [f1.id, f2.id]);
      assert.deepEqual(r, { closed: [], reopened: [f1.id] });
    });
    assert.equal((await allocs()).length, 0);
    const a = await inv(f1.id);
    const b = await inv(f2.id);
    assert.deepEqual([a.unpaid, a.paidAt, a.paidByLedger, a.allocated], [true, null, false, 0]);
    assert.deepEqual([b.unpaid, b.paidAt, b.allocated], [false, "2026-10-23", 0], "elle ✓'ye dokunulmaz");
  });

  test("Ödenmedi engeli: tamamen karşılanan fatura reddedilir, kısmen sayılan geçer", async () => {
    const c = await card();
    const f1 = await invoice({ payable: 8450.5, invoiceNo: "SUT123" });
    const f2 = await invoice({ payable: 3000, invoiceNo: "SUT140", date: "2026-10-18" });
    await payFifo(c.id, 10000, "2026-10-22");
    await assert.rejects(settle.assertNotCovered(db, [f1.id]), (e: Error) => {
      assert.ok(e instanceof UserError);
      assert.equal(e.message.replace(/ /g, " "), "Bu faturaya 22.10 ödemesinden 8.450,50 ₺ sayılmış; ödenmedi yapmak için Hesap hareketleri'nde 'Ödemeden çıkar'.");
      return true;
    });
    await settle.assertNotCovered(db, [f2.id]);
    await assert.rejects(settle.assertNotCovered(db, [f2.id, f1.id]), /^Error: SUT123: Bu faturaya/);
    // Dört yazıcı denetimi çağırır (kaynak taraması: tests/cari-guvenlik.test.ts)
  });

  test("✓ önce hesaptaki parayı kullanır; 'Geri al' dağıtımı siler ve fatura açılır", async () => {
    const c = await card();
    const old = await invoice({ payable: 100, date: "2026-10-01" });
    await payFifo(c.id, 400, "2026-10-05");
    assert.equal((await inv(old.id)).paidByLedger, true);
    // Hesapta 300; yeni fatura 250 (tamamı) ve 500 (kısmen 50)
    const a = await invoice({ payable: 250, date: "2026-10-10" });
    const b = await invoice({ payable: 500, date: "2026-10-11" });
    const r = await settle.creditFirstForInvoices([b.id, a.id], "Test");
    assert.deepEqual([...r.used].sort((x, y) => x[0] - y[0]), [
      [a.id, 250],
      [b.id, 50],
    ]);
    assert.deepEqual(r.closed, [a.id]);
    const na = await inv(a.id);
    assert.deepEqual([na.unpaid, na.paidByLedger, na.paidAt], [false, true, "2026-10-05"]);
    assert.deepEqual([(await inv(b.id)).unpaid, (await inv(b.id)).allocated], [true, 50], "kalanını çağıran işaretler");
    await settle.dropAllocations(r.allocationIds, [a.id, b.id]);
    const ra = await inv(a.id);
    assert.deepEqual([ra.unpaid, ra.paidByLedger, ra.allocated], [true, false, 0]);
    assert.equal((await inv(b.id)).allocated, 0);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 300]]);
    // Hesapta para yoksa hiçbir şey yazılmaz
    await db.delete(s.supplierEntries);
    const none = await settle.creditFirstForInvoices([a.id], "Test");
    assert.deepEqual(none, { allocationIds: [], used: new Map(), closed: [] });
  });

  test("Faturası geldi ve fatura silinmeden önce bağların çözülmesi: borç eski hâline, gider yeniden, para hesaba; geri alınınca yeniden kurulur", async () => {
    const c = await card();
    const cat = await category();
    const b1 = await debt(c.id, { amount: 1250, description: "süt", costMode: "fatura", date: "2026-10-20" });
    const b2 = await debt(c.id, { amount: 600, description: "beyaz peynir", costMode: "gider", categoryId: cat.id, date: "2026-10-21" });
    await db.insert(s.expenseEntries).values({ date: "2026-10-21", categoryId: cat.id, description: "Sütaş · beyaz peynir", amount: 600, supplierEntryId: b2.id });
    await payFifo(c.id, 2200, "2026-10-24", "elden");
    const sut149 = await invoice({ payable: 1850, invoiceNo: "SUT149", date: "2026-10-28", ledgerBase: 0 });
    // Bağla: iki borç tek faturaya; borçlara sayılan ödeme faturaya geçer, b2'nin gideri silinir
    const linked = await db.transaction(async (tx) => {
      await settle.lockCard(tx, c.id);
      return settle.linkDebts(tx, [b1.id, b2.id], sut149.id);
    });
    assert.deepEqual(linked.removedExpenses.map((e) => [e.debtId, e.amount]), [[b2.id, 600]]);
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
    const f = await inv(sut149.id);
    assert.deepEqual([f.allocated, f.unpaid, f.paidByLedger, f.paidVia], [1850, false, true, "nakit"]);
    assert.deepEqual((await allocs()).map((a) => [a.invoiceId, a.debtId, a.originDebtId, a.amount]), [
      [sut149.id, null, b1.id, 1250],
      [sut149.id, null, b2.id, 600],
    ]);
    const [lb2] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, b2.id));
    assert.deepEqual(lb2.linkPrev, {
      costMode: "gider",
      categoryId: cat.id,
      expense: { categoryId: cat.id, description: "Sütaş · beyaz peynir", note: null, amount: 600, date: "2026-10-21", id: 1, paymentMethod: null, createdBy: null },
    });
    // Fatura (kalan 350'ye elle ✓ değil) silinir: bağlar önce çözülür
    const links = await db.transaction(async (tx) => {
      const l = await settle.releaseInvoiceLinks(tx, sut149.id, "Test");
      await tx.delete(s.invoices).where(eq(s.invoices.id, sut149.id));
      return l;
    });
    assert.deepEqual(links.debtIds, [b1.id, b2.id]);
    assert.deepEqual(links.allocations, [], "borçtan gelmeyen dağıtım yoktu");
    const debts = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.kind, "borc")).orderBy(asc(s.supplierEntries.id));
    assert.deepEqual(
      debts.map((d) => [d.invoiceId, d.costMode, d.categoryId, d.linkPrev]),
      [
        [null, "fatura", null, null],
        [null, "gider", cat.id, null],
      ],
    );
    const exp = await db.select().from(s.expenseEntries);
    assert.deepEqual(exp.map((e) => [e.supplierEntryId, e.amount, e.date, e.description]), [[b2.id, 600, "2026-10-21", "Sütaş · beyaz peynir"]]);
    assert.deepEqual((await allocs()).map((a) => [a.invoiceId, a.debtId, a.originDebtId, a.amount]), [
      [null, b1.id, null, 1250],
      [null, b2.id, null, 600],
    ]);
    // Geri al: fatura yeniden yazılır, borçlar yeniden bağlanır
    const [back] = await db.insert(s.invoices).values({ date: "2026-10-28", supplier: "Sütaş", category: "Hammadde & İçecek", amount: 1850, payable: 1850, unpaid: false, paidByLedger: true, ledgerBase: 0, invoiceNo: "SUT149" }).returning();
    const res = await db.transaction((tx) => settle.reattachInvoiceLinks(tx, back.id, links, "Test", { supplier: "Sütaş", taxNumber: null }));
    assert.deepEqual(res, { relinked: 2, lost: 0 });
    const rb = await inv(back.id);
    assert.deepEqual([rb.allocated, rb.unpaid, rb.paidByLedger], [1850, false, true]);
  });

  test("bağ kaldırma: borçtan gelen dağıtım borca döner, sığmayan hesaba geçer; fatura yeniden açılır", async () => {
    const c = await card();
    const b1 = await debt(c.id, { amount: 1000, description: "süt" });
    await payFifo(c.id, 1000, "2026-10-24");
    const f = await invoice({ payable: 1000, ledgerBase: 0, date: "2026-10-28" });
    await db.transaction(async (tx) => {
      await settle.lockCard(tx, c.id);
      await settle.linkDebts(tx, [b1.id], f.id);
    });
    assert.equal((await inv(f.id)).paidByLedger, true);
    // Borcun tutarı (salt okunurken) 800'e düşmüş eski veri: geri dönerken 200 kırpılır
    await db.update(s.supplierEntries).set({ amount: 800 }).where(eq(s.supplierEntries.id, b1.id));
    const r = await db.transaction(async (tx) => {
      await settle.lockCard(tx, c.id);
      return settle.unlinkDebt(tx, b1.id, "Test");
    });
    assert.equal(r.reopened, true);
    assert.deepEqual((await allocs()).map((a) => [a.debtId, a.amount]), [[b1.id, 800]]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 200]]);
    const now = await inv(f.id);
    assert.deepEqual([now.unpaid, now.allocated, now.paidByLedger], [true, 0, false]);
  });

  test("eşitlemeden sonra yeniden dengeleme: tutar düşünce fazlası hesaba, artınca defterin kapattığı açılır", async () => {
    const c = await card();
    const f = await invoice({ payable: 1000, invoiceNo: "SUT140" });
    await payFifo(c.id, 1000, "2026-10-22");
    await db.update(s.invoices).set({ payable: 950 }).where(eq(s.invoices.id, f.id));
    const down = await settle.resettleAfterSync([{ id: f.id, from: 1000, to: 950 }]);
    assert.deepEqual(down, { moved: 50, movedInvoices: 1, reopened: 0, invoices: 1 });
    assert.deepEqual([(await inv(f.id)).allocated, (await inv(f.id)).unpaid], [950, false]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 50]]);
    await db.update(s.invoices).set({ payable: 1200 }).where(eq(s.invoices.id, f.id));
    const up = await settle.resettleAfterSync([{ id: f.id, from: 950, to: 1200 }]);
    assert.equal(up.reopened, 1);
    const now = await inv(f.id);
    assert.deepEqual([now.unpaid, now.paidByLedger, now.allocated], [true, false, 950]);
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Sistem · Fatura tutarı değişti")).orderBy(asc(s.activityLog.id)).limit(1);
    assert.match(log.detail!.replace(/ /g, " "), /^SUT140 1\.000,00 ₺ → 950,00 ₺ · 50,00 ₺ hesaba geçti$/);
    // Dağıtımı olmayan fatura için hiçbir şey yapılmaz
    const g = await invoice({ payable: 10 });
    assert.equal((await settle.resettleAfterSync([{ id: g.id, from: 5, to: 10 }])).invoices, 0);
  });

  test("peşin kartın yeni faturası: hesaptaki para bir kez sayılır, tamamen karşılanırsa defterle kapanır", async () => {
    const c = await card("Peşinci", { paidOnDelivery: true, paymentMethod: "nakit" });
    const old = await invoice({ supplier: "Peşinci", payable: 100, date: "2026-10-01" });
    await payFifo(c.id, 500, "2026-10-03", "elden");
    assert.equal((await inv(old.id)).paidByLedger, true);
    const a = await invoice({ supplier: "Peşinci", payable: 300, unpaid: false, paidAt: "2026-10-28", paidVia: "nakit", ledgerBase: 0, date: "2026-10-28" });
    const b = await invoice({ supplier: "Peşinci", payable: 250, unpaid: false, paidAt: "2026-10-29", paidVia: "nakit", ledgerBase: 0, date: "2026-10-29" });
    const r = await settle.applyCreditOnArrival([
      { id: a.id, cardId: c.id },
      { id: b.id, cardId: c.id },
    ]);
    assert.deepEqual(r, { invoices: 2, amount: 400 });
    const na = await inv(a.id);
    assert.deepEqual([na.allocated, na.paidByLedger, na.paidAt], [300, true, "2026-10-03"]);
    const nb = await inv(b.id);
    assert.deepEqual([nb.allocated, nb.paidByLedger, nb.paidAt, nb.unpaid], [100, false, "2026-10-29", false], "kısmen: peşin işaret kalır");
    assert.equal((await settle.cardsWithCredit()).size, 0);
    assert.deepEqual(await settle.applyCreditOnArrival([{ id: b.id, cardId: c.id }]), { invoices: 0, amount: 0 }, "para kalmadı");
  });

  test("peşin kartın takipten önceki tarihli faturası avans almaz, takipten sonrakini K21 yine karşılar (E-14)", async () => {
    // Sütaş peşin; takip 1 Ekim'de 5.000 ₺ avansla başladı (dağıtımı yok: hesapta)
    const c = await card("Sütaş", { paidOnDelivery: true, paymentMethod: "nakit" });
    await db.insert(s.supplierEntries).values({ supplierId: c.id, kind: "odeme", date: "2026-10-01", amount: 5000, method: "havale", createdByName: "Test" });
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 5000]]);
    // "Geçmiş faturaları al": 12 Ağu'nun kapıda ödenmiş 1.200 ₺'lik faturası
    const old = await invoice({ payable: 1200, unpaid: false, paidAt: "2026-08-12", paidVia: "nakit", ledgerBase: 0, date: "2026-08-12" });
    assert.deepEqual(await settle.applyCreditOnArrival([{ id: old.id, cardId: c.id }]), { invoices: 0, amount: 0 });
    const o = await inv(old.id);
    assert.deepEqual([o.allocated, o.paidByLedger, o.paidAt, o.unpaid], [0, false, "2026-08-12", false]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 5000]], "avans aynı");
    // Takip sonrası fatura: hesaptaki para sayılır
    const fresh = await invoice({ payable: 1200, unpaid: false, paidAt: "2026-10-12", paidVia: "nakit", ledgerBase: 0, date: "2026-10-12" });
    assert.deepEqual(await settle.applyCreditOnArrival([{ id: fresh.id, cardId: c.id }]), { invoices: 1, amount: 1200 });
    assert.deepEqual([(await inv(fresh.id)).allocated, (await inv(fresh.id)).paidByLedger], [1200, true]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 3800]]);
  });

  test("tutar sapması: recomputeAllocated toplamı dağıtımlardan yeniden yazar", async () => {
    const c = await card();
    const f = await invoice({ payable: 1000 });
    await payFifo(c.id, 600, "2026-10-22");
    await db.update(s.invoices).set({ allocated: 123 }).where(eq(s.invoices.id, f.id));
    await db.transaction((tx) => settle.recomputeAllocated(tx, [f.id]));
    assert.equal((await inv(f.id)).allocated, 600);
  });

  test("ilk kayıtta kart: kartsız tedarikçiye görünen adıyla açılır, sonraki kayıt aynı kartı bulur; iki kartta duran ad açılmaz", async () => {
    await invoice({ payable: 100, supplier: "Sütaş Süt" });
    const key = supplierMatchKey("Sütaş Süt");
    const first = await db.transaction((tx) => settle.ensureCard(tx, { key }));
    assert.equal(first.created, true);
    assert.deepEqual([first.card.name, first.card.key, first.card.aliases, first.card.hiddenOn], ["Sütaş Süt", key, [], null]);
    assert.equal((await db.transaction((tx) => settle.cardInvoiceIds(tx, first.card.id))).length, 1, "faturası karta geçti");
    // Sayfa eski anahtarla gönderse de (kart bu arada açıldı) aynı kart; kartın kimliğiyle de
    const again = await db.transaction((tx) => settle.ensureCard(tx, { key }));
    assert.deepEqual([again.created, again.card.id], [false, first.card.id]);
    assert.equal((await db.transaction((tx) => settle.ensureCard(tx, { cardId: first.card.id }))).card.id, first.card.id);
    await assert.rejects(db.transaction((tx) => settle.ensureCard(tx, { key: "bambaska" })), /Tedarikçi bulunamadı/);

    // "Su Ltd" adı vergi nolarıyla iki kartta duruyor: kart açılsa onların faturaları da buraya geçerdi
    const X = "7810030532";
    const Z = "1122334455";
    await card("Pruva", { taxNumber: X });
    await card("Erbak", { taxNumber: Z });
    await invoice({ payable: 10, supplier: "Su Ltd", supplierTaxNumber: X });
    await invoice({ payable: 20, supplier: "Su Ltd", supplierTaxNumber: Z });
    await invoice({ payable: 30, supplier: "Su Ltd" });
    await assert.rejects(
      db.transaction((tx) => settle.ensureCard(tx, { key: supplierMatchKey("Su Ltd") })),
      (e: Error) => e instanceof UserError && /^“Su Ltd” adıyla gelen 2 fatura daha .* bu tedarikçiye borç ya da ödeme girilse onlar da buraya geçerdi\./.test(e.message),
    );
    assert.equal((await db.select().from(s.suppliers).where(eq(s.suppliers.key, supplierMatchKey("Su Ltd")))).length, 0, "kart açılmadı");
  });

  // ---------------------------------------------------------------- eylemlerin çekirdeği (src/server/cari/entries.ts)

  async function actor() {
    await db.insert(s.users).values({ email: "cari-test@example.com", name: "Test", passwordHash: "x", role: "admin" }).onConflictDoNothing();
    const [u] = await db.select().from(s.users).where(eq(s.users.email, "cari-test@example.com"));
    return { id: u.id, name: u.name };
  }
  const OCT = ["2026-10"];
  const debtInput = (p: Partial<import("../src/server/cari/entries").DebtWrite>): import("../src/server/cari/entries").DebtWrite => ({
    id: null,
    date: "2026-10-20",
    amount: 100,
    description: "süt",
    costMode: "fatura",
    categoryId: null,
    adoptExpenseId: null,
    dueDate: null,
    note: null,
    photoId: null,
    applyCredit: false,
    paid: null,
    confirmPast: OCT,
    ...p,
  });
  const payInput = (p: Partial<import("../src/server/cari/entries").PaymentWrite>): import("../src/server/cari/entries").PaymentWrite => ({
    id: null,
    date: "2026-10-22",
    amount: 100,
    method: "havale",
    cashOut: null,
    allocation: { mode: "auto", lines: [] },
    note: null,
    photoId: null,
    ...p,
  });
  const withCard = <T>(cardId: number, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], c: typeof s.suppliers.$inferSelect) => Promise<T>) =>
    db.transaction(async (tx) => fn(tx, await settle.lockCard(tx, cardId)));

  test("Sütaş örneği (§4.9) eylemlerin çekirdeğiyle: borçlar, gider kaydı, en eski borçtan ödeme, kasadan ödeme, Borçlara say", async () => {
    const me = await actor();
    const c = await card("Sütaş", { paymentTermDays: 30, paymentMethod: "havale" });
    const cat = await category();
    const f1 = await invoice({ payable: 4000, date: "2026-10-01", unpaid: false, paidAt: "2026-10-10", paidVia: "havale", invoiceNo: "SUT098" });
    const f2 = await invoice({ payable: 8450.5, date: "2026-10-12", invoiceNo: "SUT123" });
    const f3 = await invoice({ payable: 3000, date: "2026-10-18", outstanding: 1800, invoiceNo: "SUT140", origin: "parasut", source: "parasut", externalId: "T-140" });
    const b1 = await withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, debtInput({ amount: 1250, description: "süt, irsaliye 4411", date: "2026-10-20" }), 30));
    const b2 = await withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, debtInput({ amount: 600, description: "beyaz peynir", date: "2026-10-21", costMode: "gider", categoryId: cat.id }), 30));
    assert.deepEqual([b1.created, b2.categoryName], [true, "Nakit malzeme alımı"]);
    const [exp] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.supplierEntryId, b2.id));
    assert.deepEqual([exp.amount, exp.date, exp.categoryId, exp.description, exp.note, exp.vat], [600, "2026-10-21", cat.id, "Sütaş · beyaz peynir", "Cari · faturasız", null]);

    const p1 = await withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 10000, date: "2026-10-22" }), 30));
    assert.deepEqual(
      p1.lines.map((l) => [l.label, l.amount, l.closed]),
      [
        ["SUT123", 8450.5, true],
        ["SUT140", 1549.5, false],
      ],
    );
    assert.equal(p1.left, 0);
    assert.deepEqual([(await inv(f1.id)).ledgerBase, (await inv(f3.id)).ledgerBase], [0, 1200]);
    const f2now = await inv(f2.id);
    assert.deepEqual([f2now.unpaid, f2now.paidByLedger, f2now.paidAt, f2now.paidVia], [false, true, "2026-10-22", "havale"]);

    // Kasadan, kasaya yeni Teslim satırı: F3'ün kalanı, B1 ve B2 kapanır, 99,50 hesapta
    const kasaDay = [businessDate(), "2026-10-24"].sort()[0];
    const p2 = await withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 2200, date: kasaDay, method: "kasa", cashOut: { mode: "new" } }), 30));
    assert.deepEqual(
      p2.lines.map((l) => [l.label, l.amount, l.closed]),
      [
        ["SUT140", 250.5, true],
        ["süt, irsaliye 4411", 1250, true],
        ["beyaz peynir", 600, true],
      ],
    );
    assert.equal(p2.left, 99.5);
    const [line] = await db.select().from(s.cashOuts);
    assert.deepEqual([line.kind, line.amount, line.store, line.date, p2.cashOut?.created], ["teslim", 2200, "Sütaş", kasaDay, true]);
    assert.equal((await db.select().from(s.expenseEntries)).length, 1, "kasadan ödeme gider yazmaz");
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 99.5]]);

    // Yeni fatura gelir; Borçlara say hesaptaki parayı ona sayar
    const f5 = await invoice({ payable: 3100, date: "2026-10-30", invoiceNo: "SUT151", ledgerBase: 0 });
    const applied = await withCard(c.id, (tx, k) => entries.applyCredit(tx, me, k, 30));
    assert.deepEqual([applied.total, applied.lines], [99.5, [{ label: "SUT151", amount: 99.5 }]]);
    assert.equal((await inv(f5.id)).allocated, 99.5);
    assert.deepEqual([...(await settle.cardsWithCredit())], []);

    // Ödeme silinir: dağıtımları kalkar, defterin kapattığı SUT123 ve SUT140 yeniden açılır; geri alma aynı dağıtımı kurar
    const del = await db.transaction((tx) => entries.deleteEntry(tx, p1.id, []));
    assert.deepEqual([del.reopened, del.kept], [2, 0]);
    assert.deepEqual([(await inv(f2.id)).unpaid, (await inv(f3.id)).unpaid], [true, true]);
    assert.equal((await inv(f3.id)).allocated, 250.5);
    const back = await db.transaction((tx) => entries.restoreEntry(tx, me, JSON.parse(JSON.stringify(del.snapshot)), []));
    assert.equal(back.lost, 0);
    assert.deepEqual([(await inv(f2.id)).unpaid, (await inv(f2.id)).paidByLedger, (await inv(f3.id)).allocated, (await inv(f3.id)).unpaid], [false, true, 1800, false]);
    const [again] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, p1.id));
    assert.equal(again.amount, 10000, "aynı kimlikle");
    await assert.rejects(
      db.transaction((tx) => entries.restoreEntry(tx, me, JSON.parse(JSON.stringify(del.snapshot)), [])),
      /zaten geri alındı/,
    );

    // Kasadan ödemenin silinmesi açtığı satırı da siler; geri alınca satır aynı kimlikle döner
    const delKasa = await db.transaction((tx) => entries.deleteEntry(tx, p2.id, []));
    assert.equal((await db.select().from(s.cashOuts)).length, 0);
    await db.transaction((tx) => entries.restoreEntry(tx, me, JSON.parse(JSON.stringify(delKasa.snapshot)), []));
    const [line2] = await db.select().from(s.cashOuts);
    assert.deepEqual([line2.id, line2.amount], [line.id, 2200]);
  });

  test("Kasadan yeni satır (denetim 21 Kasım #31): iki kasa açıkken 'Tümü'de şubesiz kayıt reddedilir, seçilen şubenin kasasına yazılır", async () => {
    const me = await actor();
    const c = await card("Sütaş", { paymentTermDays: 30 });
    const kasaDay = [businessDate(), "2026-10-24"].sort()[0];
    // İstek dışında kapsam "Tümü"dür (cookies() fırlar): Marina da açıkken satırın kasası belirsiz
    await db.insert(s.branches).values({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", sortOrder: 2 }).onConflictDoNothing();
    try {
      await assert.rejects(
        withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 500, date: kasaDay, method: "kasa", cashOut: { mode: "new" } }), 30)),
        (e: unknown) => e instanceof UserError && /hangi şubenin kasasından/.test(e.message),
      );
      await assert.rejects(
        withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 500, date: kasaDay, method: "kasa", cashOut: { mode: "new", branchId: "online" } }), 30)),
        (e: unknown) => e instanceof UserError && /Şube bulunamadı/.test(e.message),
      );
      assert.equal((await db.select().from(s.cashOuts)).length, 0, "reddedilen kayıt satır açmaz");
      assert.equal((await db.select().from(s.supplierEntries)).length, 0, "reddedilen kayıt ödeme açmaz");
      const p = await withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 500, date: kasaDay, method: "kasa", cashOut: { mode: "new", branchId: "marina" } }), 30));
      const [line] = await db.select().from(s.cashOuts);
      assert.deepEqual([line.id, line.branchId, line.kind, line.amount], [p.cashOut?.id, "marina", "teslim", 500]);
    } finally {
      await db.execute(sql`TRUNCATE supplier_allocations, supplier_entries, cash_outs RESTART IDENTITY CASCADE`);
      await db.delete(s.branches).where(eq(s.branches.id, "marina"));
    }
  });

  test("borç düzeltme ve silme: gider kaydı izler, sayılan ödemenin altına inilmez, gider → faturası gelecek kaydı siler", async () => {
    const me = await actor();
    const c = await card();
    const cat = await category();
    const b = await withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, debtInput({ amount: 600, costMode: "gider", categoryId: cat.id }), 30));
    await withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, debtInput({ id: b.id, amount: 650, date: "2026-10-21", costMode: "gider", categoryId: cat.id }), 30));
    const [e1] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.supplierEntryId, b.id));
    assert.deepEqual([e1.amount, e1.date], [650, "2026-10-21"]);
    await withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 400, allocation: { mode: "manual", lines: [{ kind: "debt", id: b.id, amount: 400 }] } }), 30));
    await assert.rejects(
      withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, debtInput({ id: b.id, amount: 300, costMode: "gider", categoryId: cat.id }), 30)),
      /400,00\s₺ ödeme sayılmış/,
    );
    await withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, debtInput({ id: b.id, amount: 650, costMode: "fatura" }), 30));
    assert.equal((await db.select().from(s.expenseEntries)).length, 0, "faturası gelecek: gider kaydı silindi");

    // "Gideri zaten girildi": var olan kayıt borca eşitlenip sahiplenilir; silinince bırakılır
    const [own] = await db.insert(s.expenseEntries).values({ date: "2026-10-19", categoryId: cat.id, amount: 640, createdBy: "Test" }).returning();
    await withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, debtInput({ id: b.id, amount: 650, date: "2026-10-21", costMode: "mevcut", adoptExpenseId: own.id }), 30));
    const [adopted] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, own.id));
    assert.deepEqual([adopted.amount, adopted.date, adopted.supplierEntryId], [650, "2026-10-21", b.id]);
    // Borç silinince ödemesi hesaba geçer, sahiplenilen kayıt durur
    const del = await db.transaction((tx) => entries.deleteEntry(tx, b.id, []));
    assert.equal(del.snapshot.allocations.length, 1);
    const [kept] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, own.id));
    assert.equal(kept.supplierEntryId, null);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 400]]);
    // Geri alma: borç, sahiplenme ve dağıtım geri gelir
    await db.transaction((tx) => entries.restoreEntry(tx, me, JSON.parse(JSON.stringify(del.snapshot)), []));
    assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, own.id)))[0].supplierEntryId, b.id);
    assert.deepEqual([...(await settle.cardsWithCredit())], []);
  });

  test("geçmiş ay onayı: geçmiş ayın giderini değiştiren borç onaysız yazılmaz", async () => {
    const me = await actor();
    const c = await card();
    const cat = await category();
    const input = debtInput({ date: "2025-09-15", amount: 1200, costMode: "gider", categoryId: cat.id, confirmPast: [] });
    await assert.rejects(
      withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, input, 30)),
      (e: Error) => e instanceof entries.NeedsPastConfirm && e.effects.length === 1 && e.effects[0].month === "2025-09" && e.effects[0].delta === 1200,
    );
    assert.equal((await db.select().from(s.supplierEntries)).length, 0, "hiçbir şey yazılmadı");
    const ok = await withCard(c.id, (tx, k) => entries.writeDebt(tx, me, k, { ...input, confirmPast: ["2025-09"] }, 30));
    assert.deepEqual(ok.effects, [{ month: "2025-09", delta: 1200 }]);
    // Silmek de onay ister
    await assert.rejects(db.transaction((tx) => entries.deleteEntry(tx, ok.id, [])), (e: Error) => e instanceof entries.NeedsPastConfirm);
    await db.transaction((tx) => entries.deleteEntry(tx, ok.id, ["2025-09"]));
    assert.equal((await db.select().from(s.expenseEntries)).length, 0);
  });

  test("dağıtımın yeniden yazılması ve elle dağıtımın denetimi; 'Ödendi' borcu hesaptaki parayla önce öder", async () => {
    const me = await actor();
    const c = await card();
    const f1 = await invoice({ payable: 500, date: "2026-10-01", invoiceNo: "A1" });
    const f2 = await invoice({ payable: 700, date: "2026-10-02", invoiceNo: "A2" });
    const p = await withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 600, allocation: { mode: "none", lines: [] } }), 30));
    assert.equal(p.left, 600);
    await assert.rejects(
      withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 100, allocation: { mode: "manual", lines: [{ kind: "invoice", id: f1.id, amount: 600 }] } }), 30)),
      /A1 kalanı 500,00\s₺/,
    );
    const r = await withCard(c.id, (tx, k) => entries.rewriteAllocation(tx, me, k, p.id, { mode: "manual", lines: [{ kind: "invoice", id: f2.id, amount: 600 }] }, 30));
    assert.deepEqual([r.previous, r.left], [[], 0]);
    assert.deepEqual([(await inv(f2.id)).allocated, (await inv(f2.id)).unpaid], [600, true]);
    const back = await withCard(c.id, (tx, k) => entries.rewriteAllocation(tx, me, k, p.id, { mode: "auto", lines: [] }, 30));
    assert.deepEqual(back.previous, [{ kind: "invoice", id: f2.id, amount: 600 }]);
    assert.deepEqual([(await inv(f1.id)).unpaid, (await inv(f2.id)).allocated], [false, 100]);
    // Faturasız alımın "Ödendi"si: önce hesaptaki para (yok), kalanı için ödeme
    const d = await debt(c.id, { amount: 300 });
    const paid = await withCard(c.id, (tx, k) => entries.payDebtTx(tx, me, k, d.id, "elden", 30));
    assert.deepEqual([paid.credited, paid.payment?.lines.map((l) => [l.kind, l.amount, l.closed])], [0, [["debt", 300, true]]]);
  });

  // ---------------------------------------------------------------- Kasa bağları (src/server/cari/kasa.ts)

  test("Kasa bağları: Borç ekle'nin Kasa denetimi (K15), Ödemeye çevir (K14) ve geri alınması, bağlı satırın Kasa'dan düzeltilmesi ve silinmesi", async () => {
    await db.execute(sql`DELETE FROM integration_state WHERE key = 'cari.kasa-ayri'`);
    const kasa = await import("../src/server/cari/kasa");
    const me = await actor();
    const c = await card("Sütaş", { aliases: ["SÜTAŞ SÜT"] });
    const cat = await category();
    const day = [businessDate(), "2026-10-24"].sort()[0];
    const month = [day.slice(0, 7)];
    const out = async (p: Partial<typeof s.cashOuts.$inferInsert> & { amount: number }) =>
      (await db.insert(s.cashOuts).values({ date: day, kind: "teslim", store: "Sütaş", docType: "yok", createdByName: "Ayşe", ...p }).returning())[0];
    const l1 = await out({ amount: 905 });
    const l2 = await out({ amount: 900, kind: "harcama", store: "sütaş süt", date: addDays(day, -2) });
    await db.insert(s.expenseEntries).values({ date: l2.date, categoryId: cat.id, amount: 900, cashOutId: l2.id, createdBy: "Ayşe" });
    await out({ amount: 50, kind: "harcama", store: "Migros" });
    await out({ amount: 700, date: addDays(day, -10) });

    // ±3 gün, adı ya da diğer adı eşleşen, işlenmemiş: tutara bakılmaz
    const found = await db.transaction((tx) => kasa.kasaCheck(tx, c, day));
    assert.deepEqual(
      found.map((l) => [l.id, l.kind, l.expense?.amount ?? null]),
      [
        [l2.id, "harcama", 900],
        [l1.id, "teslim", null],
      ],
    );
    await assert.rejects(db.transaction((tx) => kasa.resolveKasaChoice(tx, found, null)), (e: Error) => e instanceof kasa.NeedsKasa && e.lines.length === 2);
    await assert.rejects(
      db.transaction((tx) => kasa.resolveKasaChoice(tx, found, { action: "ayri", seen: [l1.id] })),
      (e: Error) => e instanceof kasa.NeedsKasa,
      "pencerenin görmediği satır yeniden sorulur",
    );
    await assert.rejects(db.transaction((tx) => kasa.resolveKasaChoice(tx, found, { action: "pesin", cashOutId: l1.id, seen: [l1.id, l2.id] })), /Teslim satırı peşin alım değildir/);

    // "Borcu aç ve bu satırla kapat": ödeme satırın tutarı (905), borca 900 sayılır, 5 hesapta kalır
    const choice = await db.transaction((tx) => kasa.resolveKasaChoice(tx, found, { action: "kapat", cashOutId: l1.id, seen: [l1.id, l2.id] }));
    assert.equal(choice.action, "kapat");
    const b = await withCard(c.id, (tx, k) =>
      entries.writeDebt(tx, me, k, debtInput({ amount: 900, date: day, confirmPast: month, paid: { method: "kasa", date: l1.date, cashOut: { mode: "existing", id: l1.id }, amount: 905 } }), 30),
    );
    assert.deepEqual([b.paid?.lines.map((l) => [l.kind, l.amount, l.closed]), b.paid?.left], [[["debt", 900, true]], 5]);
    assert.deepEqual([...(await settle.cardsWithCredit())], [[c.id, 5]]);
    const [pay] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, l1.id));
    assert.equal(pay.amount, 905);

    // Bağlanan satır artık işlenmiş; "Kasadan peşin ödendi" alışveriş satırını ayrı tutar, borç açılmaz
    const left = await db.transaction((tx) => kasa.kasaCheck(tx, c, day));
    assert.deepEqual(left.map((l) => l.id), [l2.id]);
    await db.transaction((tx) => kasa.resolveKasaChoice(tx, left, { action: "pesin", cashOutId: l2.id, seen: [l2.id] }));
    assert.deepEqual(await db.transaction((tx) => kasa.kasaCheck(tx, c, day)), []);

    // Ödemeye çevir: alışveriş satırının gideri silinir, satır Teslim olur, ödeme açılır ve borca sayılır
    const l5 = await out({ amount: 300, kind: "harcama", docType: "yok", description: "peynir" });
    const [e5] = await db.insert(s.expenseEntries).values({ date: day, categoryId: cat.id, amount: 300, cashOutId: l5.id, createdBy: "Ayşe", note: "Kasadan" }).returning();
    const d2 = await debt(c.id, { amount: 300, date: addDays(day, -1) });
    const conv = await withCard(c.id, (tx, k) => kasa.convertCashOut(tx, me, k, { cashOutId: l5.id, allocation: { mode: "auto", lines: [] }, note: null, photoId: null, confirmPast: month }, 30));
    assert.deepEqual([conv.expense?.amount, conv.payment.lines.map((l) => [l.kind, l.id, l.amount])], [300, [["debt", d2.id, 300]]]);
    assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.id, e5.id))).length, 0, "gider kaydı silindi");
    const [l5now] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, l5.id));
    assert.deepEqual([l5now.kind, l5now.docType, l5now.amount], ["teslim", "yok", 300]);
    await assert.rejects(
      withCard(c.id, (tx, k) => kasa.convertCashOut(tx, me, k, { cashOutId: l5.id, allocation: { mode: "none", lines: [] }, note: null, photoId: null, confirmPast: month }, 30)),
      /zaten Teslim/,
    );
    // Geri al: ödeme silinir, satır alışverişe ve gider kaydı eski kimliğiyle döner, borç yeniden açık
    const undone = await db.transaction((tx) => kasa.undoConversion(tx, JSON.parse(JSON.stringify(conv.snapshot)), month));
    assert.equal(undone.expenseRestored, true);
    const [l5back] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, l5.id));
    assert.deepEqual([l5back.kind, l5back.docType], ["harcama", "yok"]);
    const [e5back] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, l5.id));
    assert.deepEqual([e5back.id, e5back.amount, e5back.note], [e5.id, 300, "Kasadan"]);
    assert.equal((await db.select().from(s.supplierAllocations).where(eq(s.supplierAllocations.debtId, d2.id))).length, 0);
    await assert.rejects(db.transaction((tx) => kasa.undoConversion(tx, JSON.parse(JSON.stringify(conv.snapshot)), month)), /silindi ya da değişti/);
    // Geçmiş ayın gideri onaysız silinmez
    const old = await out({ amount: 80, kind: "harcama", date: "2025-09-10" });
    await db.insert(s.expenseEntries).values({ date: "2025-09-10", categoryId: cat.id, amount: 80, cashOutId: old.id, createdBy: "Ayşe" });
    await assert.rejects(
      withCard(c.id, (tx, k) => kasa.convertCashOut(tx, me, k, { cashOutId: old.id, allocation: { mode: "none", lines: [] }, note: null, photoId: null, confirmPast: [] }, 30)),
      (e: Error) => e instanceof entries.NeedsPastConfirm && e.effects[0].month === "2025-09",
    );

    // Bağlı satır: personel düzeltemez ve silemez (sabit mesaj); yönetici tutarı ve günü ödemeye geçirir, türünü değiştiremez
    await assert.rejects(db.transaction((tx) => kasa.lockCashOutLink(tx, l1.id, false)), (e: Error) => e instanceof UserError && e.message === kasa.CARI_LOCKED_STAFF);
    await assert.rejects(db.transaction((tx) => kasa.assertCashOutDeletable(tx, l1.id, false)), (e: Error) => e.message === kasa.CARI_LOCKED_STAFF);
    await assert.rejects(db.transaction((tx) => kasa.assertCashOutDeletable(tx, l1.id, true)), /tedarikçi ödemesine bağlı \(Sütaş/);
    const sync = (next: { kind: "harcama" | "teslim"; amount: number; date: string }) =>
      db.transaction(async (tx) => kasa.syncLinkedCashOut(tx, l1.id, await kasa.lockCashOutLink(tx, l1.id, true), { admin: true, ...next }));
    await assert.rejects(sync({ kind: "harcama", amount: 905, date: day }), /alışverişe çevrilemez/);
    await assert.rejects(sync({ kind: "teslim", amount: 800, date: day }), /900,00\s₺'si kalemlere sayılmış/);
    assert.equal(await sync({ kind: "teslim", amount: 950, date: day }), "Sütaş");
    assert.equal((await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, pay.id)))[0].amount, 950);
    assert.equal(await db.transaction((tx) => kasa.lockCashOutLink(tx, l2.id, false)), null, "bağsız satır personele açık");
    await assert.rejects(db.delete(s.cashOuts).where(eq(s.cashOuts.id, l1.id)), "FK de korur");
  });

  test("Faturası geldi başka addaki faturaya (R3d): kartsız ad diğer ad olur; başka kartın faturası ad eklemeden, iki kart kilitlenerek bağlanır", async () => {
    const c = await card("Sütaş");
    const other = await card("Pınar");
    const b1 = await debt(c.id, { amount: 500, description: "süt" });
    const b2 = await debt(c.id, { amount: 300, description: "ayran" });
    const b3 = await debt(c.id, { amount: 200, description: "yoğurt" });
    const link = (debtIds: number[], invoiceId: number, addAlias: boolean) => db.transaction((tx) => entries.linkToInvoice(tx, { cardId: c.id, debtIds, invoiceId, addAlias, confirmPast: [] }));
    const groupOf = async (cardId: number) => db.transaction((tx) => settle.cardInvoiceIds(tx, cardId));

    // Kartsız ad, addAlias: kartın diğer adı olur (parantezdeki not atılır), fatura bu kartın grubuna geçer
    const f1 = await invoice({ payable: 500, supplier: "Sütaş Bölge Dağıtım (Tuzla)", invoiceNo: "SB1", ledgerBase: 0 });
    assert.deepEqual(await groupOf(c.id), []);
    const r1 = await link([b1.id], f1.id, true);
    assert.deepEqual([r1.aliasAdded, r1.elsewhere], ["Sütaş Bölge Dağıtım", null]);
    assert.deepEqual((await db.select().from(s.suppliers).where(eq(s.suppliers.id, c.id)))[0].aliases, ["Sütaş Bölge Dağıtım"]);
    assert.deepEqual(await groupOf(c.id), [f1.id]);
    assert.equal((await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, b1.id)))[0].invoiceId, f1.id);

    // Başka bir kartın faturası: ad eklenmez (addAlias yok sayılır), fatura o tedarikçide kalır; o kart da kilitlenir
    const f2 = await invoice({ payable: 300, supplier: "Pınar", invoiceNo: "P1", ledgerBase: 0 });
    let released = 0;
    const hold = db.transaction(async (tx) => {
      await settle.lockCard(tx, other.id);
      await new Promise((r) => setTimeout(r, 300));
      released = Date.now();
    });
    await new Promise((r) => setTimeout(r, 50));
    const linked = db.transaction(async (tx) => {
      const r = await entries.linkToInvoice(tx, { cardId: c.id, debtIds: [b2.id], invoiceId: f2.id, addAlias: true, confirmPast: [] });
      return { r, at: Date.now() };
    });
    const [, { r: r2, at }] = await Promise.all([hold, linked]);
    assert.ok(released > 0 && at >= released, "Pınar'ın kartı serbest kalana kadar bekledi");
    assert.deepEqual([r2.aliasAdded, r2.elsewhere], [null, "Pınar"]);
    const cards = await db.select({ id: s.suppliers.id, aliases: s.suppliers.aliases }).from(s.suppliers).orderBy(asc(s.suppliers.id));
    assert.deepEqual(cards.map((x) => x.aliases), [["Sütaş Bölge Dağıtım"], []]);
    assert.deepEqual(await groupOf(other.id), [f2.id], "fatura Pınar'da kaldı");

    // Kartsız ad, addAlias yok: bağlanır, ad eklenmez
    const f3 = await invoice({ payable: 200, supplier: "Ege Gıda", invoiceNo: "E1", ledgerBase: 0 });
    const r3 = await link([b3.id], f3.id, false);
    assert.deepEqual([r3.aliasAdded, r3.elsewhere], [null, "Ege Gıda"]);
    assert.deepEqual((await db.select().from(s.suppliers).where(eq(s.suppliers.id, c.id)))[0].aliases, ["Sütaş Bölge Dağıtım"]);

    // Başka kartın borcu bu karttan bağlanamaz
    const foreign = await debt(other.id, { amount: 100 });
    const f4 = await invoice({ payable: 100, invoiceNo: "SUT200", ledgerBase: 0 });
    await assert.rejects(link([foreign.id], f4.id, false), (e: Error) => e instanceof UserError && /Alım bulunamadı/.test(e.message));
  });

  test("Son ödenenler'den geri al (cari): düzenlenmemiş ödeme silinir ve faturası açılır; sonradan düzenlenen silinmez", async () => {
    const me = await actor();
    const c = await card("Sütaş", { paymentTermDays: 30 });
    const f = await invoice({ payable: 1000, invoiceNo: "SUT300" });
    const recorded = async (id: number) => {
      const [row] = await db.select({ updatedAt: s.supplierEntries.updatedAt }).from(s.supplierEntries).where(eq(s.supplierEntries.id, id));
      return { at: new Date().toISOString(), stamp: row.updatedAt.toISOString() };
    };
    const p1 = await withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 1000 }), 30));
    assert.deepEqual([(await inv(f.id)).unpaid, (await inv(f.id)).paidByLedger], [false, true]);
    const rec1 = await recorded(p1.id);

    // Ödeme sonradan düzenlendi (not): "Geri al" silmez
    const p2 = await withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ amount: 50, allocation: { mode: "none", lines: [] } }), 30));
    const rec2 = await recorded(p2.id);
    await new Promise((r) => setTimeout(r, 5));
    await withCard(c.id, (tx, k) => entries.writePayment(tx, me, k, payInput({ id: p2.id, amount: 50, note: "dekont geldi" }), 30));
    await assert.rejects(
      db.transaction((tx) => entries.deleteRecentPayment(tx, p2.id, rec2)),
      (e: Error) => e instanceof UserError && e.message === "Ödeme sonradan düzenlendi; Tedarikçiler'den silin",
    );
    assert.equal((await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, p2.id))).length, 1);
    // Damgasız eski kayıt: kaydın anından sonra düzenlenen ödeme de silinmez
    await assert.rejects(db.transaction((tx) => entries.deleteRecentPayment(tx, p2.id, { at: rec2.stamp })), /sonradan düzenlendi/);

    // Düzenlenmemiş ödeme silinir: dağıtımı kalkar, defterin kapattığı fatura yeniden ödenmedi olur
    const r = await db.transaction((tx) => entries.deleteRecentPayment(tx, p1.id, rec1));
    assert.ok(r);
    assert.deepEqual([r.card.id, r.reopened, r.kept, r.snapshot.entry.amount], [c.id, 1, 0, 1000]);
    assert.equal((await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, p1.id))).length, 0);
    assert.equal((await db.select().from(s.supplierAllocations).where(eq(s.supplierAllocations.paymentId, p1.id))).length, 0);
    const now = await inv(f.id);
    assert.deepEqual([now.unpaid, now.allocated, now.paidByLedger, now.paidAt], [true, 0, false, null]);

    // Silinmiş ödeme ya da borç: null (eylem "bulunamadı" der)
    assert.equal(await db.transaction((tx) => entries.deleteRecentPayment(tx, p1.id, rec1)), null);
    const d = await debt(c.id, { amount: 10 });
    assert.equal(await db.transaction((tx) => entries.deleteRecentPayment(tx, d.id, rec1)), null);
  });
});
