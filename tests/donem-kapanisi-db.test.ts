// Dönem kapanışı ve reçete geçmişi gerçek Postgres'te (docs/DONEM-KAPANISI.md), oturum ve next/cache taklit edilerek:
// - ay kapanır; kapanıştan sonra kapalı aya düşen fatura hesaplara girmez, kutuda bekler, "Bu aya al" ile bugünün ayında
//   sayılır; kapalı ayın kaydı düzeltilemez, silinemez; ay yeniden açılınca bekleyen kendi ayına girer;
// - reçete geçmişi: değişen reçete sürüm yazar, değişmeyen yazmaz.
//
// DONEM_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı): test
// kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: DONEM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/donem-kapanisi-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { currentMonthTR, shiftMonth } from "../src/lib/calc/engine";
import { businessDate } from "../src/lib/cash-report";
import { GOODS_CATEGORIES } from "../src/lib/constants";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.DONEM_TEST_DATABASE_URL;
const DB_NAME = `laffogato_donem_${process.pid}`;
// Kapanan ay: bugünün iş gününden önceki ay (yalnız bitmiş ay kapanır)
const CLOSED = shiftMonth(businessDate().slice(0, 7), -1);
const CUR = currentMonthTR();

describe("dönem kapanışı: veritabanında", { skip: !SERVER_URL && "DONEM_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let period: typeof import("../src/server/actions/closed-period");
  let invoices: typeof import("../src/server/actions/invoices");
  let expenses: typeof import("../src/server/actions/expenses");
  let server: typeof import("../src/server/closed-period");
  let versions: typeof import("../src/server/data/recipe-versions");
  let loadModel: typeof import("../src/server/data/dataset").loadModel;
  let me: { id: number; name: string };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "donem-kapanisi-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Okan", passwordHash: "x", role: "admin" }).returning();
    me = a;
    const user = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { requireUser: user, requireAdmin: user, getCurrentUser: user });
    period = await import("../src/server/actions/closed-period");
    invoices = await import("../src/server/actions/invoices");
    expenses = await import("../src/server/actions/expenses");
    server = await import("../src/server/closed-period");
    versions = await import("../src/server/data/recipe-versions");
    loadModel = (await import("../src/server/data/dataset")).loadModel;
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const invoice = async (date: string, supplier: string, payable: number, createdAt?: Date) =>
    (
      await db
        .insert(s.invoices)
        .values({ date, supplier, category: GOODS_CATEGORIES[0], amount: payable, payable, unpaid: true, ...(createdAt ? { createdAt } : {}) })
        .returning()
    )[0];

  test("kapalı aya sonradan düşen fatura bekler; karar, kilit ve yeniden açma", async () => {
    const early = await invoice(`${CLOSED}-10`, "Sütçü", 1_000, new Date(Date.now() - 86_400_000));
    const [cat] = await db.insert(s.expenseCategories).values({ name: "Temizlik", section: "genel", sortOrder: 1 }).returning();
    const [exp] = await db.insert(s.expenseEntries).values({ date: `${CLOSED}-12`, categoryId: cat.id, amount: 200, createdAt: new Date(Date.now() - 86_400_000) }).returning();

    const closed = await period.closePeriod(CLOSED);
    assert.equal(closed.ok, true, JSON.stringify(closed));
    assert.deepEqual(closed.ok && closed.data, { invoices: 1, invoiceTotal: 1_000, expenses: 1, expenseTotal: 200 }, "kapanış sağlaması ayın kayıtlarını saymalı");
    const again = await period.closePeriod(CLOSED);
    assert.equal(again.ok, false, "kapalı ay ikinci kez kapanmamalı");
    const current = await period.closePeriod(CUR);
    assert.equal(current.ok, false, "içinde bulunulan ay kapanmamalı");

    // Kapanıştan sonra kapalı aya tarihli fatura (Paraşüt'ten ya da elle): reddedilmez, bekler
    const late = await invoice(`${CLOSED}-20`, "Geç Tedarikçi", 500, new Date(Date.now() + 2_000));
    const held = await server.loadHeldRecords(db);
    assert.deepEqual(
      held.map((h) => [h.kind, h.id]),
      [["invoice", late.id]],
      "yalnız kapanıştan sonra gelen fatura beklemeli",
    );
    let model = await loadModel();
    assert.ok(!model.ds.invoices.some((i) => i.id === late.id), "bekleyen fatura hesaplara girmemeli");
    assert.ok(model.ds.invoices.some((i) => i.id === early.id), "kapanıştan önceki fatura hesapta kalmalı");

    // Kapalı ayın kaydı düzeltilemez ve silinemez; ödeme ve not serbest
    const edit = await invoices.saveInvoice({
      id: early.id,
      date: early.date,
      supplier: early.supplier,
      description: null,
      invoiceNo: null,
      category: early.category,
      amount: 1_100,
      discount: 0,
      payable: 1_100,
      unpaid: true,
      note: null,
    });
    assert.equal(edit.ok, false, "kapalı ayın faturasının tutarı değişmemeli");
    assert.match(!edit.ok ? edit.error : "", /dönemi kapalı/, "neden dönem kapanışı olmalı");
    const note = await invoices.saveInvoice({
      id: early.id,
      date: early.date,
      supplier: early.supplier,
      description: null,
      invoiceNo: null,
      category: early.category,
      amount: 1_000,
      discount: 0,
      payable: 1_000,
      unpaid: true,
      note: "muhasebeciye soruldu",
    });
    assert.equal(note.ok, true, `not kapalı ayda da yazılabilmeli: ${JSON.stringify(note)}`);
    const del = await invoices.deleteInvoice(early.id);
    assert.equal(del.ok, false, "kapalı ayın faturası silinmemeli");
    const delExp = await expenses.deleteExpenseEntry(exp.id);
    assert.equal(delExp.ok, false, "kapalı ayın harcaması silinmemeli");
    const moveExp = await expenses.saveExpenseEntry({ id: exp.id, date: `${CUR}-01`, categoryId: cat.id, description: null, amount: 200, paymentMethod: null, note: null });
    assert.equal(moveExp.ok, false, "kapalı ayın harcaması başka aya taşınmamalı");

    // "Bu aya al": bugünün (iş günü) ayında sayılır, belgenin tarihi değişmez
    const moved = await period.decideHeldRecord({ kind: "invoice", id: late.id, decision: "move" });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    const [row] = await db.select().from(s.invoices).where(eq(s.invoices.id, late.id));
    assert.equal(row.date, `${CLOSED}-20`, "belgenin tarihi değişmemeli");
    assert.equal(row.periodDate, businessDate(), "karar günü iş günü olmalı");
    model = await loadModel();
    assert.equal(model.ds.invoices.find((i) => i.id === late.id)?.date, businessDate(), "alınan fatura karar gününde sayılmalı");
    assert.deepEqual(await server.loadHeldRecords(db), [], "karar verilen kayıt kutudan çıkmalı");
    const twice = await period.decideHeldRecord({ kind: "invoice", id: late.id, decision: "accept" });
    assert.equal(twice.ok, false, "karar verilmiş kayda ikinci karar yazılmamalı");

    // "Kapalı aya işle": kapalı ayın rakamı bilerek değişir, sağlama yenilenir (uyarı vermez)
    const late2 = await invoice(`${CLOSED}-25`, "İkinci Geç", 300, new Date(Date.now() + 3_000));
    const accepted = await period.decideHeldRecord({ kind: "invoice", id: late2.id, decision: "accept" });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const p = await server.loadClosedPeriods(db);
    assert.deepEqual(p.months[CLOSED].check, await server.periodCheckOf(db, CLOSED, p), "bilerek işlenen kayıttan sonra sağlama tutmalı");
    assert.equal(p.months[CLOSED].check?.invoices, 2, "işlenen fatura kapalı ayın sağlamasına girmeli");

    // Yeniden açma gerekçe ister; açılınca bekleyen kayıt kendi ayına girer
    const late3 = await invoice(`${CLOSED}-26`, "Üçüncü Geç", 50, new Date(Date.now() + 4_000));
    const noReason = await period.reopenPeriod(CLOSED, "");
    assert.equal(noReason.ok, false, "gerekçesiz açılmamalı");
    const reopened = await period.reopenPeriod(CLOSED, "düzeltme beyannamesi");
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    model = await loadModel();
    assert.equal(model.ds.invoices.find((i) => i.id === late3.id)?.date, `${CLOSED}-26`, "dönem açılınca bekleyen kendi gününde sayılmalı");
    assert.equal(model.ds.invoices.find((i) => i.id === late.id)?.date, businessDate(), "verilen karar dönem açılınca da yerinde kalmalı");
    const del2 = await expenses.deleteExpenseEntry(exp.id);
    assert.equal(del2.ok, true, `açık ayın harcaması silinebilmeli: ${JSON.stringify(del2)}`);
  });

  test("reçete geçmişi: değişen reçete sürüm yazar, değişmeyen yazmaz", async () => {
    const [cat] = await db.insert(s.categories).values({ name: "Deneme kahveleri", sortOrder: 99 }).returning();
    const [ing] = await db.insert(s.ingredients).values({ name: "Deneme sütü", category: "Test", unit: "ml", packagePrice: 40, packageSize: 1000, sortOrder: 1 }).returning();
    const [p] = await db.insert(s.products).values({ name: "Deneme latte", size: "M", categoryId: cat.id, price: 120, sortOrder: 1 }).returning();
    const empty = { note: null, items: [] };
    const line = { ingredientId: ing.id, name: "Deneme sütü", unit: "ml", qty: 200, qtyExpr: null, note: null };
    await db.insert(s.recipeItems).values({ productId: p.id, ingredientId: ing.id, qty: 200, sortOrder: 1 });
    assert.equal(await versions.recordRecipeVersion(db, { productId: p.id, before: empty, source: "edit", by: me }), true, "boştan dolu reçeteye sürüm yazılmalı");
    assert.equal(await versions.recordRecipeVersion(db, { productId: p.id, before: { note: null, items: [line] }, source: "edit", by: me }), false, "değişmeyen reçete sürüm yazmamalı");
    await db.update(s.recipeItems).set({ qty: 220 }).where(eq(s.recipeItems.productId, p.id));
    assert.equal(
      await versions.recordRecipeVersion(db, { productId: p.id, before: { note: null, items: [line] }, source: "approval", by: me, requestedByName: "Selin" }),
      true,
      "miktarı değişen reçete sürüm yazmalı",
    );
    const rows = await versions.loadRecipeVersions(p.id);
    assert.equal(rows.length, 2, "iki sürüm olmalı");
    assert.equal(rows[0].source, "approval", "en yeni önce gelmeli");
    assert.match(rows[0].summary, /Deneme sütü 200 ml → 220 ml/, "özet farkı yazmalı");
    assert.equal(rows[0].requestedByName, "Selin", "öneren saklanmalı");
    assert.equal(rows[0].changedByName, "Okan", "değiştiren saklanmalı");
  });
});
