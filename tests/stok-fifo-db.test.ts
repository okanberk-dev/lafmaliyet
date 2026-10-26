// Stok değerlemenin (FIFO) parti yükleyicisi (src/server/data/purchase-lots-query.ts), gerçek Postgres'te: çarpan
// şüphesi bağlantıyı ve bugünkü çarpanı izler. Bugünkü çarpanla onay bekleyen fiyat o ürünün bütün faturalarını dışlar
// (yenisi gelince eskinin önerisi geçersiz kalsa da), reddedilen yalnız kendi faturasını; çarpan düzeltilince eski
// çarpanla açılmış öneri bir şey dışlamaz. "Fiyatı güncelle" kapalı bağlantının faturası girer, kafe dışı fatura girmez.
// Kendi hammaddesini, faturalarını ve bağlantısını açar, sonunda siler.
//
// FIFO_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: FIFO_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_fifo npx tsx --test tests/stok-fifo-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { queryPurchaseLots } from "../src/server/data/purchase-lots-query";

const URL = process.env.FIFO_TEST_DATABASE_URL;

describe("FIFO partileri: veritabanında süzgeç", { skip: !URL && "FIFO_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  const productKey = `fifo-test:${tag}`;
  let ingId = 0;
  const invoiceIds: number[] = [];

  async function invoice(date: string, liters: number, net: number, category = "Hammadde & İçecek"): Promise<number> {
    const [row] = await db
      .insert(s.invoices)
      .values({ date, supplier: `FIFO test ${tag}`, category, amount: net, payable: net, source: "parasut", origin: "parasut" })
      .returning({ id: s.invoices.id });
    invoiceIds.push(row.id);
    await db.insert(s.parasutBillLines).values({
      invoiceId: row.id,
      externalId: `${tag}-${row.id}`,
      productKey,
      productName: "Süt koli 12x1L",
      quantity: liters / 12,
      unitPrice: net / (liters / 12),
      netTotal: net,
    });
    return row.id;
  }
  async function hold(invoiceId: number, factor: number, status: "pending" | "rejected" | "superseded") {
    await db.insert(s.ingredientPriceHolds).values({
      ingredientId: ingId,
      invoiceId,
      productKey,
      productName: "Süt koli 12x1L",
      factor,
      quantity: 1,
      netTotal: 1,
      invoiceDate: "2026-10-01",
      supplier: "FIFO test",
      packagePrice: 1,
      packageSize: factor,
      prevPackagePrice: 1,
      prevPackageSize: 1,
      status,
    });
  }
  const setLink = (o: { factor?: number; updatePrice?: boolean }) => db.update(s.parasutProductLinks).set(o).where(eq(s.parasutProductLinks.productKey, productKey));
  const lotIds = async () =>
    (await queryPurchaseLots(db))
      .filter((l) => l.ingredientId === ingId)
      .map((l) => l.invoiceId)
      .sort((a, b) => a - b);
  const clearHolds = () => db.delete(s.ingredientPriceHolds).where(eq(s.ingredientPriceHolds.ingredientId, ingId));

  before(async () => {
    db = createDb(URL!, 2);
    const [ing] = await db.insert(s.ingredients).values({ name: `FIFO test süt ${tag}`, category: "Süt", unit: "ml" }).returning({ id: s.ingredients.id });
    ingId = ing.id;
    await db.insert(s.parasutProductLinks).values({ productKey, productName: "Süt koli 12x1L", ingredientId: ingId, factor: 12000 });
  });

  after(async () => {
    if (!db) return;
    if (invoiceIds.length) await db.delete(s.invoices).where(inArray(s.invoices.id, invoiceIds));
    if (ingId) await db.delete(s.ingredients).where(eq(s.ingredients.id, ingId));
    await db.$client.end();
  });

  test("çarpan, miktar ve tutar: koli × 12000 ml, KDV hariç net", async () => {
    const a = await invoice("2026-10-05", 120, 3600);
    const lots = (await queryPurchaseLots(db)).filter((l) => l.ingredientId === ingId);
    assert.equal(lots.length, 1);
    assert.equal(lots[0].invoiceId, a);
    assert.equal(lots[0].qty, 120_000);
    assert.equal(lots[0].cost, 3600);
  });

  test("bugünkü çarpanla onay bekleyen fiyat ürünün bütün faturalarını dışlar (eskisinin önerisi geçersiz kalsa da)", async () => {
    const [a] = invoiceIds;
    const b = await invoice("2026-10-20", 120, 3600);
    // A'nın önerisi B gelince geçersiz kaldı, B onay bekliyor: ikisi de dışarıda
    await hold(a, 12000, "superseded");
    await hold(b, 12000, "pending");
    assert.deepEqual(await lotIds(), []);
    // Çarpan düzeltildi: eski çarpanla açılmış bekleyen öneri bir şey dışlamaz
    await setLink({ factor: 1000 });
    assert.deepEqual(await lotIds(), [a, b]);
    await setLink({ factor: 12000 });
    await clearHolds();
  });

  test("reddedilen fiyat yalnız kendi faturasını dışlar; çarpan düzeltilince fatura geri girer", async () => {
    const [a, b] = invoiceIds;
    await hold(b, 12000, "rejected");
    assert.deepEqual(await lotIds(), [a]);
    await setLink({ factor: 1000 });
    assert.deepEqual(await lotIds(), [a, b]);
    await setLink({ factor: 12000 });
    await clearHolds();
  });

  test("\"Fiyatı güncelle\" kapalı bağlantının faturası girer; kafe dışı fatura girmez", async () => {
    const [a, b] = invoiceIds;
    await setLink({ updatePrice: false });
    const karaoke = await invoice("2026-10-22", 12, 360, "Karaoke box");
    assert.deepEqual(await lotIds(), [a, b]);
    assert.ok(!(await lotIds()).includes(karaoke));
    await setLink({ updatePrice: true });
  });
});
