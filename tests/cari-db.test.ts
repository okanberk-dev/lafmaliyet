// Cari hesabın veritabanı tarafı (src/server/cari/settle.ts), gerçek Postgres'te: CHECK'ler, kart kilidiyle iki
// eşzamanlı ödemenin aynı faturayı aşırı ödememesi, ödeme silinince CASCADE ve `allocated`, defterin ödendi işareti,
// "Faturası geldi" ve fatura silinmeden önce bağların çözülmesi (borç eski hâline, gider kaydı yeniden, para hesaba),
// eşitlemeden sonra yeniden dengeleme (tutar düşer / artar), peşin faturaya hesaptaki para, "Ödenmedi" engeli,
// ✓'nin hesaptaki parayı kullanması ve geri alınması, silinen faturanın bağlarının geri kurulması, db:reset engeli.
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
import { allocateFifo, openItems } from "../src/lib/cari/account";
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
    assert.equal(resolve("sütaş"), c.id);
    assert.equal(resolve("Pınar"), null);
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
    assert.deepEqual(lb2.linkPrev, { costMode: "gider", categoryId: cat.id, expense: { categoryId: cat.id, description: "Sütaş · beyaz peynir", note: null, amount: 600, date: "2026-10-21" } });
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

  test("tutar sapması: recomputeAllocated toplamı dağıtımlardan yeniden yazar", async () => {
    const c = await card();
    const f = await invoice({ payable: 1000 });
    await payFifo(c.id, 600, "2026-10-22");
    await db.update(s.invoices).set({ allocated: 123 }).where(eq(s.invoices.id, f.id));
    await db.transaction((tx) => settle.recomputeAllocated(tx, [f.id]));
    assert.equal((await inv(f.id)).allocated, 600);
  });
});
