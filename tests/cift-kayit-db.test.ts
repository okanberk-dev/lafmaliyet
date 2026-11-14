// Çift kayıt engeli gerçek Postgres'te, oturum ve next/cache taklit edilerek (denetim 13 Kasım 2026, UI-01, UI-02,
// UI-03; src/server/waste/core.ts addWaste, src/server/actions/invoices.ts saveInvoice, src/server/actions/consistency.ts
// saveFinding). Zayi formu, Fatura ekle ve Bulgu ekle her yeni kayda istemci anahtarı gönderir: aynı anahtarla gelen
// ikinci istek (Enter'a / Ctrl+Enter'a ikinci basış, yanıtı yolda kalan isteğin tekrarı, aynı anda iki istek) yeni satır
// açmaz, var olanı döner; işlem geçmişine de bir kez yazılır. Elle eklenen fatura aynı tedarikçinin aynı numaralı
// faturasıyla karşılaşınca eklenmez, pencere sorar; "Yine de ekle" (sameNoOk) bilerek ekler.
//
// CIFT_KAYIT_TEST_DATABASE_URL (yoksa CARI_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: CARI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/cift-kayit-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.CIFT_KAYIT_TEST_DATABASE_URL ?? process.env.CARI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_cift_kayit_${process.pid}`;

describe("çift kayıt engeli: istemci anahtarı ve aynı numaralı fatura", { skip: !SERVER_URL && "CIFT_KAYIT_TEST_DATABASE_URL ya da CARI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let waste: typeof import("../src/server/actions/waste");
  let invoices: typeof import("../src/server/actions/invoices");
  let consistency: typeof import("../src/server/actions/consistency");
  type Who = { id: number; name: string; email: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin" },
    ayse: { id: 0, name: "Ayşe", email: "ayse@laffogato.net", role: "staff" },
  };
  /** Oturumdaki kullanıcı (src/server/auth/dal taklidi) */
  let me: Who = users.ali;
  const ids = { milk: 0 };
  /** İş günü (gece 05:00'te döner): zayi ileri bir güne yazılmaz */
  const today = businessDate();

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "cift-kayit-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum ve sayfa yenileme taklit edilir
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const session = async () => ({ id: me.id, name: me.name, email: me.email, role: me.role });
    stub(require.resolve("../src/server/auth/dal"), {
      getCurrentUser: session,
      requireUser: session,
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("yönetici değil");
        return session();
      },
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b })))
      .onConflictDoNothing();
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: users[k].email, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    const [milk] = await db
      .insert(s.ingredients)
      .values({ name: "Süt %2,5", category: "Süt", unit: "ml", countUnit: "LT", countGroup: "SÜT", packagePrice: 100, packageSize: 1000, vatRate: 0.01 })
      .returning({ id: s.ingredients.id });
    ids.milk = milk.id;
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
    waste = await import("../src/server/actions/waste");
    invoices = await import("../src/server/actions/invoices");
    consistency = await import("../src/server/actions/consistency");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    me = users.ali;
    await db.execute(sql`TRUNCATE waste_entries, invoices, findings, suppliers, activity_log RESTART IDENTITY CASCADE`);
  });

  const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }): T => {
    if (!r.ok) assert.fail(r.error);
    return r.data;
  };
  const logged = async (action: string) => (await db.select().from(s.activityLog).where(eq(s.activityLog.action, action))).length;
  const zayi = (clientKey: string | null, qty = 0.25) =>
    withBranchScope("tuzla", () => waste.addWasteEntry({ date: today, kind: "zayi", productId: null, ingredientId: ids.milk, qty, reason: null, note: "DENETIM-UI zayi enter2", clientKey }));

  test("zayi (UI-01): aynı anahtarla ikinci gönderim yeni kayıt açmaz, var olanı döner; işlem geçmişine bir kez yazılır", async () => {
    me = users.ayse;
    const first = ok(await zayi("anahtar-zayi-1"));
    assert.equal(first.repeated, false);
    // Enter'a ikinci basış ya da yanıtı yolda kalan isteğin tekrarı: aynı anahtar, yazılan miktar değişse de ilk kayıt döner
    const again = ok(await zayi("anahtar-zayi-1", 0.5));
    assert.deepEqual({ ...again }, { id: first.id, name: "Süt %2,5", unit: "LT", qty: 0.25, repeated: true });
    assert.equal((await db.select().from(s.wasteEntries)).length, 1);
    assert.equal(await logged("Zayi kaydı"), 1);
    // Başarılı kayıttan sonra form anahtarı yeniler: aynı kalem yeniden girilebilir
    ok(await zayi("anahtar-zayi-2"));
    assert.equal((await db.select().from(s.wasteEntries)).length, 2);
    // Anahtarsız istek (eski sayfa) eskisi gibi yazar
    ok(await zayi(null));
    assert.equal((await db.select().from(s.wasteEntries)).length, 3);
  });

  test("zayi (UI-01): aynı anda gelen iki istek tek kayıt yazar; anahtar başkasının kaydınınsa reddedilir", async () => {
    me = users.ayse;
    const [a, b] = await Promise.all([zayi("anahtar-ayni-an"), zayi("anahtar-ayni-an")]);
    const both = [ok(a), ok(b)];
    assert.equal(both[0].id, both[1].id);
    assert.deepEqual(both.map((x) => x.repeated).sort(), [false, true]);
    assert.equal((await db.select().from(s.wasteEntries)).length, 1);
    me = users.ali;
    const taken = await zayi("anahtar-ayni-an");
    assert.equal(taken.ok, false);
    if (!taken.ok) assert.match(taken.error, /başka bir hesaptan/);
    assert.equal((await db.select().from(s.wasteEntries)).length, 1);
  });

  const bill = (p: { supplier?: string; invoiceNo?: string | null; clientKey?: string | null; sameNoOk?: boolean; amount?: number } = {}) =>
    invoices.saveInvoice({
      id: null,
      date: "2026-10-12",
      supplier: p.supplier ?? "Kaldi",
      description: null,
      invoiceNo: p.invoiceNo === undefined ? "KLA2026000000625" : p.invoiceNo,
      category: "Hammadde & İçecek",
      amount: p.amount ?? 38_220,
      discount: 0,
      payable: (p.amount ?? 38_220) * 1.01,
      unpaid: true,
      note: "DENETIM-UI",
      clientKey: p.clientKey ?? null,
      sameNoOk: p.sameNoOk,
    });

  test("fatura (UI-03): aynı anahtarla ikinci kayıt fatura açmaz, var olanı döner; aynı anda iki istek de tek fatura", async () => {
    const first = ok(await bill({ invoiceNo: null, clientKey: "anahtar-fatura-1" }));
    assert.equal(first.repeated, false);
    assert.equal(first.duplicate, null);
    const again = ok(await bill({ invoiceNo: null, clientKey: "anahtar-fatura-1" }));
    assert.equal(again.id, first.id);
    assert.equal(again.repeated, true);
    assert.equal((await db.select().from(s.invoices)).length, 1);
    assert.equal(await logged("Fatura eklendi"), 1);
    // Ctrl+Enter'a iki kez basılınca iki istek aynı anda yola çıkar
    const pair = (await Promise.all([bill({ invoiceNo: null, clientKey: "anahtar-fatura-2" }), bill({ invoiceNo: null, clientKey: "anahtar-fatura-2" })])).map(ok);
    assert.equal(pair[0].id, pair[1].id);
    assert.deepEqual(pair.map((x) => x.repeated).sort(), [false, true]);
    assert.equal((await db.select().from(s.invoices)).length, 2);
    // Numarasız ve anahtarsız fatura eskisi gibi her seferinde eklenir
    ok(await bill({ invoiceNo: null }));
    ok(await bill({ invoiceNo: null }));
    assert.equal((await db.select().from(s.invoices)).length, 4);
  });

  test("fatura (UI-02): aynı tedarikçinin aynı numaralı faturası varsa eklenmez, pencere sorar; Yine de ekle ekler", async () => {
    // Ekim'de Paraşüt'ten gelmiş Kaldi faturası
    const [synced] = await db
      .insert(s.invoices)
      .values({ date: "2026-10-12", supplier: "KALDI KAHVE", invoiceNo: "KLA2026000000625", category: "Hammadde & İçecek", amount: 38_220, payable: 38_602.2, source: "parasut", origin: "parasut", externalId: "p-625" })
      .returning();
    const twin = ok(await bill({ clientKey: "anahtar-kopya" }));
    assert.equal(twin.id, 0);
    assert.deepEqual(twin.duplicate, { id: synced.id, supplier: "KALDI KAHVE", date: "2026-10-12", invoiceNo: "KLA2026000000625", payable: 38_602.2, source: "parasut" });
    assert.equal((await db.select().from(s.invoices)).length, 1, "kopya yazılmadı");
    assert.equal(await logged("Fatura eklendi"), 0);
    // Numara ayraçlı ya da küçük harfle yazılsa da aynı
    assert.ok(ok(await bill({ invoiceNo: "kla-2026/000000625" })).duplicate);
    // Başka tedarikçinin aynı numarası kopya değil
    const other = ok(await bill({ supplier: "Sütaş", clientKey: "anahtar-sutas" }));
    assert.equal(other.duplicate, null);
    assert.ok(other.id > 0);
    // "Yine de ekle": aynı anahtarla bilerek eklenir; tekrarı (anahtar) yine tek fatura
    const forced = ok(await bill({ clientKey: "anahtar-kopya", sameNoOk: true }));
    assert.equal(forced.duplicate, null);
    assert.ok(forced.id > 0);
    const forcedAgain = ok(await bill({ clientKey: "anahtar-kopya" }));
    assert.equal(forcedAgain.id, forced.id, "anahtarın tekrarı kendi faturasını 'aynı numaralı' bulmaz");
    assert.equal(forcedAgain.repeated, true);
    // Paraşüt'ün faturası, Sütaş'ınki ve bilerek eklenen kopya
    assert.deepEqual((await db.select().from(s.invoices).orderBy(s.invoices.id)).map((r) => r.supplier), ["KALDI KAHVE", "Sütaş", "Kaldi"]);
  });

  test("fatura (UI-02): adı farklı yazılmış aynı usta Tedarikçiler kartıyla tanınır; kayıtlı faturanın düzenlenmesi sorulmaz", async () => {
    await db.insert(s.suppliers).values({ name: "Ahmet Usta", key: "ahmet usta", aliases: ["AHMET YILMAZ"] });
    const first = ok(await bill({ supplier: "AHMET YILMAZ", invoiceNo: "GIB2026000000012", amount: 1_000 }));
    const twin = ok(await bill({ supplier: "Ahmet Usta", invoiceNo: "GIB2026000000012", amount: 1_000 }));
    assert.equal(twin.duplicate?.id, first.id);
    // Var olan faturayı kaydetmek numara sormaz
    const [row] = await db.select().from(s.invoices).where(eq(s.invoices.id, first.id));
    const edited = ok(
      await invoices.saveInvoice({
        id: row.id,
        date: row.date,
        supplier: row.supplier,
        description: "düzeltildi",
        invoiceNo: row.invoiceNo,
        category: row.category,
        amount: row.amount,
        discount: row.discount,
        payable: row.payable,
        unpaid: row.unpaid,
        note: row.note,
      }),
    );
    assert.equal(edited.duplicate, null);
    assert.equal(edited.id, first.id);
  });

  test("bulgu (UI-03): aynı anahtarla ikinci Ekle bulgu açmaz; düzenleme anahtarsız", async () => {
    const add = (clientKey: string | null) => consistency.saveFinding({ id: null, section: "Genel", title: "DENETIM-UI bulgu 73765", detail: null, clientKey });
    ok(await add("anahtar-bulgu-1"));
    ok(await add("anahtar-bulgu-1"));
    await Promise.all([add("anahtar-bulgu-2"), add("anahtar-bulgu-2")]);
    const rows = await db.select().from(s.findings);
    assert.equal(rows.length, 2);
    assert.equal(await logged("Bulgu eklendi"), 2);
    ok(await consistency.saveFinding({ id: rows[0].id, section: "Genel", title: "Başlık değişti", detail: null }));
    assert.equal((await db.select().from(s.findings)).length, 2);
  });
});
