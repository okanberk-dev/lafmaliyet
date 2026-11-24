// Gelir-gider'in komisyon satırı ve Stok sayımı kartının açılışı (denetim 26 Eki 2026, B16) gerçek Postgres'te, oturum ve
// next/cache taklit edilerek:
// - E-43: kasa raporlarından banka kartı payı (kart ÷ Z, yemek kartı hariç) POS komisyonuna gider; kanalı bulunamayan
//   komisyon faturası (banka) tahmin hücresinde uyarı çıkarır; hücreye 0 yazılınca uyarı kalkar, fatura bir kez sayılır;
// - E-30: Gelir-giderde bir ayın "Önceki aydan devir"i elle yazılınca Stok sayımı kartının açılışı kâr-zararınkiyle aynı
//   tutarı ve "elle girildi" ipucunu gösterir.
//
// GELIR_GIDER_TEST_DATABASE_URL (yoksa FIFO_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: GELIR_GIDER_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/gelir-gider-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { countOpening, countOpeningNote } from "../src/app/panel/sayim/logic";
import { currentMonthTR, daysInMonth, shiftMonth } from "../src/lib/calc/engine";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.GELIR_GIDER_TEST_DATABASE_URL ?? process.env.FIFO_TEST_DATABASE_URL;
const DB_NAME = `laffogato_gelir_gider_${process.pid}`;
/** Kasa raporları geçen ayın tamamında (ay ortasında başlamış sayılmasın diye ondan önceki ayın son günü de) */
const PREV = shiftMonth(currentMonthTR(), -1);
const BEFORE = shiftMonth(PREV, -1);

describe("gelir-gider komisyon ve açılış: veritabanında", { skip: !SERVER_URL && "GELIR_GIDER_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let pnl: typeof import("../src/server/actions/pnl");
  let loadModel: typeof import("../src/server/data/dataset").loadModel;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "gelir-gider-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum ve sayfa yenileme taklit edilir
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
    const [a] = await db.insert(s.users).values({ email: "yonetici@laffogato.net", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const me = async () => ({ ...a, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { requireUser: me, requireAdmin: me });
    pnl = await import("../src/server/actions/pnl");
    loadModel = (await import("../src/server/data/dataset")).loadModel;

    // Geçen ayın her günü: Z 10.000 = kart 6.000 + yemek kartı 1.000 + nakit 3.000 (ay: Z 10.000 × gün)
    const dim = daysInMonth(PREV);
    const reports = [{ date: `${BEFORE}-${String(daysInMonth(BEFORE)).padStart(2, "0")}`, zTotal: 0, card: 0, mealCard: 0, cash: 0, submittedByName: "Ayşe" }];
    for (let d = 1; d <= dim; d++) reports.push({ date: `${PREV}-${String(d).padStart(2, "0")}`, zTotal: 10_000, card: 6_000, mealCard: 1_000, cash: 3_000, submittedByName: "Ayşe" });
    await db.insert(s.cashReports).values(reports);
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const invoice = (supplier: string, amount: number) =>
    db.insert(s.invoices).values({ date: `${PREV}-20`, supplier, category: "Komisyon", amount, payable: amount * 1.2, vat: amount * 0.2 });

  test("E-43: kasa raporlarından banka kartı payı; Pluxee faturası tahmini değiştirmez; banka faturasında uyarı, 0 yazınca tek sayım", async () => {
    let model = await loadModel();
    const st = model.settings;
    const z = 10_000 * daysInMonth(PREV);
    assert.deepEqual(model.bankShareOf(PREV), { rate: 0.6, source: "kasa", split: true, meal: 0.1 });
    assert.equal(model.cardShareOf(PREV).rate, 0.7, "kartlı satış oranı yemek kartını içerir");
    let pm = model.pnlMonth(PREV);
    // Kasa kartı olan ay (23 Kasım 2026, hesap sözleşmesi §10): banka kartı × şubenin POS oranı (Tuzla, migration'ın
    // varsayılanı %2); Ayarlar'daki genel oran yalnız kasa kartı olmayan ayda
    const estimate = Math.round(z * 0.6 * 0.02 * 100) / 100;
    assert.notEqual(st.komisyon, 0.02, "genel oran şubenin oranından farklı: hangisinin kullanıldığı görünsün");
    assert.ok(Math.abs(pm.cells.get("commission:pos")!.value! - estimate) < 1e-6, "yalnız banka kartı, şubenin oranıyla");
    assert.equal(pm.cells.get("commission:pos")!.warn, undefined);

    // Yemek kartının kendi faturası: tahmin aynı, faturası bir kez
    await invoice("Pluxee", 420);
    model = await loadModel();
    pm = model.pnlMonth(PREV);
    assert.ok(Math.abs(pm.cells.get("commission:pos")!.value! - estimate) < 1e-6);
    assert.ok(Math.abs(pm.sections.komisyon - (estimate + 420)) < 1e-6);
    assert.equal(pm.cells.get("commission:pos")!.warn, undefined);

    // Bankanın POS komisyonu faturası (kanalı yok): tahmin onu ikinci kez sayabilir, hücre uyarır
    await invoice("Akbank T.A.Ş.", 1_500);
    model = await loadModel();
    pm = model.pnlMonth(PREV);
    assert.match(pm.cells.get("commission:pos")!.warn ?? "", /Akbank T\.A\.Ş\..*0 yazın/);
    assert.ok(Math.abs(pm.sections.komisyon - (estimate + 420 + 1_500)) < 1e-6, "uyarı tutarı değiştirmez");

    // Sahip hücreye 0 yazar: banka faturası gerçek tutardır
    const r = await pnl.setPnlCell(PREV, "commission:pos", 0);
    assert.equal(r.ok, true, JSON.stringify(r));
    model = await loadModel();
    pm = model.pnlMonth(PREV);
    assert.equal(pm.cells.get("commission:pos")!.value, 0);
    assert.equal(pm.cells.get("commission:pos")!.warn, undefined);
    assert.ok(Math.abs(pm.sections.komisyon - (420 + 1_500)) < 1e-6);
    await pnl.setPnlCell(PREV, "commission:pos", null);
  });

  test("B16: unvanı Pluxee kartının 'Diğer adlar'ında olan komisyon faturası Gelir-gider'de de kanallı (uyarı yok)", async () => {
    // Yalnız bu testin faturaları: bir önceki testin Akbank faturası kaldırılır
    await db.delete(s.invoices);
    const [inv] = await invoice("Avantaj Kart Hizmetleri A.Ş.", 300).returning();
    let pm = (await loadModel()).pnlMonth(PREV);
    assert.match(pm.cells.get("commission:pos")!.warn ?? "", /Avantaj Kart Hizmetleri A\.Ş\..*0 yazın/, "kartı yokken kanalı bulunamaz");

    // Komisyon & hakediş'in önerisi: unvanı Pluxee kartının diğer adlarına ekle
    await db.insert(s.suppliers).values({ name: "Pluxee", key: "pluxee", aliases: ["Avantaj Kart Hizmetleri A.Ş."] });
    pm = (await loadModel()).pnlMonth(PREV);
    assert.equal(pm.cells.get("commission:pos")!.warn, undefined, "kanal kartın adından bulundu");
    assert.ok(Math.abs(pm.cells.get("commission:Avantaj Kart Hizmetleri A.Ş.")!.value! - 300) < 1e-6, "fatura kendi satırında bir kez");
    await db.delete(s.suppliers);
    await db.delete(s.invoices).where(eq(s.invoices.id, inv.id));
  });

  test("E-30: 'Önceki aydan devir' elle yazılınca Sayım kartının açılışı K/Z ile aynı ve 'elle girildi'", async () => {
    let model = await loadModel();
    let o = countOpening(model.pnlMonth(PREV).cells.get("stock:opening")!, model.closingStock(BEFORE));
    assert.equal(o.source, "sayim");
    assert.equal(o.value, model.pnlMonth(PREV).opening);

    const r = await pnl.setPnlCell(PREV, "stock:opening", 12_345, "Devir, sayım kağıdından");
    assert.equal(r.ok, true, JSON.stringify(r));
    model = await loadModel();
    const pm = model.pnlMonth(PREV);
    // Sayfa gibi: önceki ay sayılmadıysa (stockSheet().hasData) sayımın değeri yok, ipucu "0 ₺" değil "sayımı yok"
    o = countOpening(pm.cells.get("stock:opening")!, model.closingStock(BEFORE), model.stockSheet(BEFORE).hasData);
    assert.equal(pm.opening, 12_345);
    assert.deepEqual(o, { value: 12_345, source: "acilis", counted: null });
    assert.match(countOpeningNote(o, PREV)!.replace(/ /g, " "), /"Önceki aydan devir" elle 12\.345 ₺ girildi; kâr-zarar bu tutarı kullanır\. .+ sayımı yok\.$/);
    // Eski kural (geçen ayın kapanışı) 0 gösterirdi
    assert.equal(model.closingStock(BEFORE).value, 0);
  });
});
