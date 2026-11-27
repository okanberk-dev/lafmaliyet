// Şube ayrımı parça 5, gerçek Postgres'te (docs/SUBE.md › Şube ayrımı › Alanlar: Tutarlılık, Mutabakat, Stok değeri): üç
// alan kişinin şube görünümüyle okur; ekstre ve bankaya gelen POS parası her kipte firmanın. Vergi şubeye bölünmez
// (sahibin kararı 27 Kasım 2026): Vergi her kipte firmanın, Marina seçiliyken de Tümü'yle aynı. Tuzla'nın kayıtları
// "IZ-TUZLA" işaretini ya da 77.777,77 tutarını taşır: Marina seçili ve "Yalnız şube" kipindeyken alınan miktarda, FIFO
// havuzunda, mutabakatın şube ayrımında, POS'un şube kipinde, fiyat önerilerinde, tedarikçi fiyatlarında ve tahmini
// stoğun faturalarında görünmemeli; firma kipinde ve "Tümü"de görünmeli; müdürde firma tercihi yazılı olsa da
// görünmemeli. Oturum gerçek src/server/auth/dal.ts'le, çerezler taklit edilerek.
//
// SUBE_ALANLAR5_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Bir Postgres
// sunucusunun adresi: test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_ALANLAR5_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/sube-ayrimi-alanlar-5-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type { BranchViewPrefs } from "../src/lib/branch-view";
import { ALL_BRANCHES, BRANCH_COOKIE, DEFAULT_BRANCHES } from "../src/lib/branches";
import { addDays, todayTR } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_ALANLAR5_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_alanlar5_${process.pid}`;
const SECRET = "sube-alanlar-5-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const MARK = "IZ-TUZLA";
const AMOUNT = 77777.77;

class Jar {
  values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, opts: { maxAge?: number } = {}) {
    if (opts.maxAge === 0 || value === "") this.values.delete(name);
    else this.values.set(name, value);
  }
}

/** Çıktıda Tuzla'nın işareti (adı ya da tutarı, her biçimde) var mı */
const leaks = (v: unknown) => {
  const text = JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x));
  return text.includes(MARK) || text.includes("77777") || text.includes("77.777");
};

describe("şube ayrımı parça 5: alanlar veritabanında", { skip: !SERVER_URL && "SUBE_ALANLAR5_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let scope: typeof import("../src/server/branch-scope");
  let jar = new Jar();
  const ids = { ali: 0, mert: 0, ing: 0, marinaInv: 0, tuzlaInv: 0, sharedInv: 0 };
  const today = todayTR();
  const day = addDays(today, -10);

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => new Headers() });
    stub("next/navigation", {
      redirect: (to: string) => {
        throw Object.assign(new Error("NEXT_REDIRECT"), { to });
      },
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
      unstable_rethrow: (e: unknown) => {
        if ((e as Error)?.message === "NEXT_REDIRECT" || (e as Error)?.message === "NEXT_NOT_FOUND") throw e;
      },
    });
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const user = async (name: string, email: string, role: "admin" | "manager", branchId: string | null) =>
      (await db.insert(s.users).values({ name, email, role, branchId, passwordHash: "x" }).returning({ id: s.users.id }))[0].id;
    ids.ali = await user("Ali", "ali@ornek.com", "admin", null);
    ids.mert = await user("Mert", "mert@ornek.com", "manager", "marina");

    // Hammadde, Paraşüt ürün bağlantısı ve üç fatura (Marina'nın, Tuzla'nın işaretli, işletme geneli), her biri bir kalemle
    const [ing] = await db.insert(s.ingredients).values({ name: "Süt (şube testi)", category: "Süt", unit: "ml", packagePrice: 40, packageSize: 1000 }).returning({ id: s.ingredients.id });
    ids.ing = ing.id;
    await db.insert(s.parasutProductLinks).values({ productKey: "sube5:sut", productName: "Süt 1L", ingredientId: ing.id, factor: 1000 });
    const invoice = async (supplier: string, net: number, qty: number, branchId: string | null, companyWide = false) => {
      const [row] = await db
        .insert(s.invoices)
        .values({ date: day, supplier, category: "Hammadde & İçecek", amount: net, payable: net * 1.1, vat: net * 0.1, source: "parasut", origin: "parasut", branchId, companyWide })
        .returning({ id: s.invoices.id });
      await db.insert(s.parasutBillLines).values({ invoiceId: row.id, externalId: `sube5-${row.id}`, productKey: "sube5:sut", productName: "Süt 1L", quantity: qty, unitPrice: net / qty, netTotal: net });
      return row.id;
    };
    ids.marinaInv = await invoice("Sütaş", 1_000, 10, "marina");
    ids.tuzlaInv = await invoice(`${MARK} Gıda`, AMOUNT, 7, "tuzla");
    ids.sharedInv = await invoice("Ortak Tedarik", 300, 3, null, true);
    // Elle yazılan alım (firmanın): şube kipinde dahil değil, sayısı söylenir
    await db.insert(s.purchaseQuantities).values({ month: day.slice(0, 7), ingredientId: ing.id, qty: 99, note: "elle" });

    // Fiyat önerileri: Tuzla'nın faturasından (işaretli) ve Marina'nın faturasından (hammadde başına tek bekleyen öneri)
    const [ing2] = await db.insert(s.ingredients).values({ name: "Krema (şube testi)", category: "Süt", unit: "ml", packagePrice: 60, packageSize: 1000 }).returning({ id: s.ingredients.id });
    const hold = (ingredientId: number, invoiceId: number, productName: string) =>
      db.insert(s.ingredientPriceHolds).values({
        ingredientId,
        invoiceId,
        // Bağlı olmayan ürün anahtarı: öneri faturanın kalemlerini şüpheli yapmasın (alınan ve havuz sayılsın)
        productKey: `sube5:oneri-${invoiceId}`,
        productName,
        factor: 1000,
        quantity: 1,
        netTotal: 1,
        invoiceDate: day,
        supplier: productName,
        packagePrice: 90,
        packageSize: 1000,
        prevPackagePrice: 40,
        prevPackageSize: 1000,
        status: "pending",
      });
    await hold(ing.id, ids.tuzlaInv, `${MARK} Süt`);
    await hold(ing2.id, ids.marinaInv, "Marina Krema");

    // Personel ve demirbaş: Tuzla'nınki işaretli
    await db.insert(s.staff).values([
      { name: "Arda", netSalary: 30_000, branchId: "marina", startMonth: `${today.slice(0, 4)}-01` },
      { name: `${MARK} Barista`, netSalary: AMOUNT, branchId: "tuzla", startMonth: `${today.slice(0, 4)}-01` },
    ]);
    await db.insert(s.taxAssets).values([
      { name: `${MARK} Makine`, invoiceId: ids.tuzlaInv, acquiredOn: day, cost: AMOUNT, lifeYears: 5 },
      { name: "Marina dolap", invoiceId: ids.marinaInv, acquiredOn: day, cost: 1_000, lifeYears: 5 },
    ]);

    // Kasa raporları: kart satışı (POS hakediş) ve ciro; Tuzla'nınki işaretli
    await db.insert(s.cashReports).values([
      { date: day, branchId: "marina", zTotal: 2_000, cash: 1_000, card: 1_000, submittedByName: "Arda" },
      { date: day, branchId: "tuzla", zTotal: AMOUNT, cash: 0, card: AMOUNT, submittedByName: "Can" },
    ]);

    // Harcamalar (kartla) ve aynı günün banka ekstresi: Marina'nın harcaması, Tuzla'nın işaretli harcaması
    const [cat] = await db.insert(s.expenseCategories).values({ name: "Şube testi tamir" }).returning({ id: s.expenseCategories.id });
    await db.insert(s.expenseEntries).values([
      { date: day, categoryId: cat.id, description: "Marina tamir", amount: 120, paymentMethod: "kart", branchId: "marina" },
      { date: day, categoryId: cat.id, description: `${MARK} tamir`, amount: 333, paymentMethod: "kart", branchId: "tuzla" },
      { date: addDays(day, 1), categoryId: cat.id, description: "Marina eksik", amount: 45, paymentMethod: "kart", branchId: "marina" },
      { date: addDays(day, 1), categoryId: cat.id, description: `${MARK} eksik`, amount: 46, paymentMethod: "kart", branchId: "tuzla" },
    ]);
    const [st] = await db
      .insert(s.reconStatements)
      .values({ kind: "banka", account: "Garanti TL", periodFrom: addDays(today, -20), periodTo: today, lineCount: 2, uploadedOn: today, expiresOn: addDays(today, 90), createdByName: "Ali" })
      .returning({ id: s.reconStatements.id });
    await db.insert(s.reconLines).values([
      { statementId: st.id, scope: "banka:Garanti TL", fingerprint: "a", rowNo: 1, date: day, description: "KART HARCAMA 1", amount: -120 },
      { statementId: st.id, scope: "banka:Garanti TL", fingerprint: "b", rowNo: 2, date: day, description: "KART HARCAMA 2", amount: -333 },
    ]);

    dal = await import("../src/server/auth/dal");
    scope = await import("../src/server/branch-scope");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Oturum (`kim`), seçicide `secim`, hesabın şube görünümü tercihi `prefs` (veritabanına yazılır) */
  const signIn = async (kim: number, secim: string, prefs: BranchViewPrefs = {}) => {
    jar = new Jar();
    await db.update(s.users).set({ branchView: prefs }).where(eq(s.users.id, kim));
    const [u] = await db.select().from(s.users).where(eq(s.users.id, kim));
    await dal.startSession(u);
    jar.set(BRANCH_COOKIE, secim);
  };
  const FIRMA: BranchViewPrefs = { tutarlilik: "firma", mutabakat: "firma", stok_degeri: "firma" };

  test("alanın kapsamı: Marina'da yöneticinin varsayılanı şube, firma tercihinde Tümü, müdürde hep şube", async () => {
    await signIn(ids.ali, "marina");
    for (const a of ["tutarlilik", "mutabakat", "stok_degeri"] as const) assert.equal(await scope.areaScope(a), "marina", a);
    await signIn(ids.ali, "marina", FIRMA);
    for (const a of ["tutarlilik", "mutabakat", "stok_degeri"] as const) assert.equal(await scope.areaScope(a), ALL_BRANCHES, a);
    await signIn(ids.mert, "marina", FIRMA);
    for (const a of ["tutarlilik", "mutabakat", "stok_degeri"] as const) assert.equal(await scope.areaScope(a), "marina", `müdür ${a}`);
  });

  test("Tutarlılık: şube kipinde alınan yalnız şubeye seçilmiş faturalardan; şubesiz fatura ve elle alım sayı olarak", async () => {
    const { queryBranchPurchases } = await import("../src/server/data/purchase-lots-query");
    const own = await queryBranchPurchases(db, "marina");
    assert.equal(leaks(own), false);
    assert.deepEqual(
      own.quantities.map((q) => [q.ingredientId, q.qty]),
      [[ids.ing, 10_000]],
      "Marina'nın 10 L'si (Tuzla'nın 7 L'si ve işletme geneli 3 L yok)",
    );
    assert.deepEqual(own.outside[day.slice(0, 7)], { invoices: 1, manual: 1 });
    assert.deepEqual((await queryBranchPurchases(db, "tuzla")).quantities.map((q) => q.qty), [7_000]);
  });

  test("Stok değeri: FIFO havuzu şube kipinde şubenin ve işletme genelinin faturaları; veri kümesi kişinin kipiyle", async () => {
    const { queryPurchaseLots } = await import("../src/server/data/purchase-lots-query");
    const { loadModel } = await import("../src/server/data/dataset");
    const lotIds = (lots: { invoiceId: number }[]) => [...new Set(lots.map((l) => l.invoiceId))].sort((a, b) => a - b);
    assert.deepEqual(lotIds(await queryPurchaseLots(db, "marina")), [ids.marinaInv, ids.sharedInv]);
    assert.deepEqual(lotIds(await queryPurchaseLots(db)), [ids.marinaInv, ids.tuzlaInv, ids.sharedInv]);
    await signIn(ids.ali, "marina");
    assert.equal(lotIds((await loadModel()).ds.purchaseLots ?? []).includes(ids.tuzlaInv), false, "şube kipi");
    await signIn(ids.ali, "marina", FIRMA);
    assert.equal(lotIds((await loadModel()).ds.purchaseLots ?? []).includes(ids.tuzlaInv), true, "firma kipi");
    await signIn(ids.mert, "marina", FIRMA);
    assert.equal(lotIds((await loadModel()).ds.purchaseLots ?? []).includes(ids.tuzlaInv), false, "müdür hep şube");
  });

  test("Mutabakat: şube kipinde Marina'nın kaydıyla eşleşen üstte, Tuzla'nınki adsız İşletme geneli'nde; eksikler Marina'nın", async () => {
    const { loadRecon } = await import("../src/server/mutabakat/load");
    const firm = await loadRecon();
    assert.equal(leaks(firm.statements), true, "firma kipinde Tuzla'nın harcaması adıyla");
    const [st] = (await loadRecon("marina")).statements;
    assert.ok(st.branch, "şube ayrımı");
    assert.equal(leaks(st), false);
    assert.deepEqual(st.branch.own.map((r) => r.line.amount), [-120]);
    assert.deepEqual(st.branch.shared.map((r) => [r.line.amount, r.candidate?.label]), [[-333, "Öbür şubenin kaydı"]]);
    assert.deepEqual(st.missing.map((c) => c.amount), [-45], "yalnız Marina'nın eksik kaydı");
    assert.equal(st.branch.otherMissing, 1);
    assert.equal(st.summary.eslesti, firm.statements[0].summary.eslesti, "eşleşme aynı (firmanın)");
    assert.equal((await loadRecon("marina")).pools.size, 0, "şube kipinde havuz dönmez");
  });

  test("POS hakediş: şube kipinde şubenin kart satışı ve beklenen neti; firmanın satırları dönmez", async () => {
    const { loadPosView } = await import("../src/server/mutabakat/load");
    const firm = await loadPosView(today);
    assert.equal(leaks(firm.result.rows), true, "firma kipinde Tuzla'nın satışı");
    const v = await loadPosView(today, "marina");
    assert.ok(v.branch, "şubenin hakedişi");
    assert.equal(leaks(v.branch), false);
    assert.equal(v.branch.totals.gross, 1_000);
    assert.deepEqual(v.result.rows, []);
    assert.deepEqual(v.branches.map((b) => b.id), ["marina"]);
  });

  test("fiyat önerisi, tedarikçi fiyatları, tahmini stoğun faturaları: Marina seçiliyken Tuzla'nınki sayı olarak", async () => {
    const { loadPriceHolds, pendingHoldSummary } = await import("../src/server/data/price-holds");
    const holds = await loadPriceHolds("marina");
    assert.equal(leaks(holds), false);
    assert.deepEqual([holds.pending.length, holds.elsewhere], [1, 1]);
    assert.equal(leaks(await loadPriceHolds()), true);
    const summary = await pendingHoldSummary("marina");
    assert.deepEqual([summary.count, summary.elsewhere], [1, 1]);
    assert.equal((await pendingHoldSummary()).count, 2);

    const { loadSupplierPrices } = await import("../src/server/data/supplier-prices");
    const prices = await loadSupplierPrices(ids.ing, today, "marina");
    assert.ok(prices, "hammadde var");
    assert.equal(leaks(prices), false);
    assert.equal(prices.elsewhere, 1);
    assert.equal(leaks(await loadSupplierPrices(ids.ing, today)), true);

    const { loadReceiptInvoices } = await import("../src/server/data/stock-estimate");
    const receipts = await loadReceiptInvoices(addDays(today, -30), today, db, 100, "marina");
    assert.equal(leaks(receipts), false);
    assert.deepEqual(receipts.invoices.map((i) => i.id), [ids.marinaInv]);
    assert.deepEqual(receipts.elsewhere, { branches: 1, shared: 1 });
    assert.equal((await loadReceiptInvoices(addDays(today, -30), today, db)).total, 3);
  });
});
