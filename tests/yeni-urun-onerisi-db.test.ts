// Personelin yeni ürün önerisinin onayı gerçek Postgres'te, oturum ve next/cache taklit edilerek (denetim 26 Eki 2026
// B14, E-55): bir boy yeni adla onaylanınca öteki boy o adı alır (yazım farkı ona döner, başka ad reddedilir); öneriden
// sonra pasife alınan malzeme ve bugünkü ayarlarla eksiye düşen formül reddedilir, ürün açılmaz, öneri bekler.
//
// ONERI_TEST_DATABASE_URL (yoksa FIFO_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: ONERI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/yeni-urun-onerisi-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.ONERI_TEST_DATABASE_URL ?? process.env.FIFO_TEST_DATABASE_URL;
const DB_NAME = `laffogato_yeni_urun_${process.pid}`;

describe("yeni ürün önerisinin onayı: veritabanında", { skip: !SERVER_URL && "ONERI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let actions: typeof import("../src/server/actions/recipe-requests");
  let pairs: typeof import("../src/server/data/recipe-requests").approvedNewPairs;
  let category = 0;
  let milk = 0;
  let puree = 0;
  let vanilla = 0;
  const ayse = { id: 0, name: "Ayşe", role: "staff" as const };
  const ali = { id: 0, name: "Ali", role: "admin" as const };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "yeni-urun-onerisi-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum (öneren Ayşe, onaylayan Ali) ve sayfa
    // yenileme taklit edilir
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
    const [a] = await db.insert(s.users).values({ email: "ali@laffogato.net", name: ali.name, passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    const [b] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: ayse.name, passwordHash: "x", role: "staff" }).returning({ id: s.users.id });
    ali.id = a.id;
    ayse.id = b.id;
    stub(require.resolve("../src/server/auth/dal"), { requireUser: async () => ayse, requireAdmin: async () => ali });
    actions = await import("../src/server/actions/recipe-requests");
    pairs = (await import("../src/server/data/recipe-requests")).approvedNewPairs;

    const [c] = await db.insert(s.categories).values({ name: "Soğuk kahveler", sortOrder: 1 }).returning({ id: s.categories.id });
    category = c.id;
    const ing = async (name: string, unit: "ml" | "gr") =>
      (await db.insert(s.ingredients).values({ name, category: "Süt", unit, packagePrice: 40, packageSize: 1000, priceSource: "manual" }).returning({ id: s.ingredients.id }))[0]
        .id;
    milk = await ing("Süt", "ml");
    puree = await ing("Çilek püresi", "ml");
    vanilla = await ing("Vanilya şurubu", "ml");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const line = (ingredientId: number, qty: number, qtyExpr: string | null = null) => ({ ingredientId, qty, qtyExpr, note: null });
  /** Ayşe'nin önerisi; boy → öneri satırının kimliği */
  async function propose(name: string, sizes: { size: "M" | "L" | "Tek"; items: ReturnType<typeof line>[]; price?: number }[]) {
    const res = await actions.proposeNewProduct({ name, categoryId: category, message: null, sizes: sizes.map((x) => ({ ...x, price: x.price ?? null })) });
    assert.equal(res.ok, true, JSON.stringify(res));
    const rows = await db
      .select({ id: s.recipeChangeRequests.id, proposed: s.recipeChangeRequests.proposed })
      .from(s.recipeChangeRequests)
      .where(and(eq(s.recipeChangeRequests.kind, "new"), eq(s.recipeChangeRequests.status, "pending")));
    return new Map(rows.filter((r) => r.proposed?.name === name).map((r) => [r.proposed!.size, r.id]));
  }
  const products = async (size: "M" | "L" | "Tek") => (await db.select({ name: s.products.name }).from(s.products).where(eq(s.products.size, size))).map((p) => p.name);
  const status = async (id: number) => (await db.select({ status: s.recipeChangeRequests.status }).from(s.recipeChangeRequests).where(eq(s.recipeChangeRequests.id, id)))[0]?.status;

  test("E-55: M yeni adla onaylanınca L o adı alır; eski adla gelen onay reddedilir, yazım farkı onun adına döner", async () => {
    const ids = await propose("Cilekli latte", [
      { size: "M", items: [line(milk, 200), line(puree, 30)], price: 185 },
      { size: "L", items: [line(milk, 280), line(puree, 40)], price: 205 },
    ]);
    // Onaylar sayfası M'yi çizerken kardeşi yok (iki boy da bekliyor)
    const before = await pairs(db, [{ id: ids.get("L")!, requestedBy: ayse.id, requestedByName: ayse.name, name: "Cilekli latte", size: "L" }]);
    assert.equal(before.size, 0);

    const m = await actions.approveNewProduct({ id: ids.get("M")!, name: "Çilekli Latte", categoryId: category, price: 190 });
    assert.equal(m.ok, true, JSON.stringify(m));
    assert.equal(m.ok && m.data.name, "Çilekli Latte");

    // L kartı şimdi M'nin adını görür (Onaylar sayfasının okuması)
    const found = await pairs(db, [{ id: ids.get("L")!, requestedBy: ayse.id, requestedByName: ayse.name, name: "Cilekli latte", size: "L" }]);
    assert.equal(found.get(ids.get("L")!)?.name, "Çilekli Latte");
    assert.equal(found.get(ids.get("L")!)?.size, "M");
    assert.equal(found.get(ids.get("L")!)?.categoryId, category);

    // Eski sekmedeki kart önerinin adıyla onaylamaya çalışır: ayrı ürün açılmaz
    const stale = await actions.approveNewProduct({ id: ids.get("L")!, name: "Cilekli latte", categoryId: category, price: 210 });
    assert.equal(stale.ok, false);
    assert.equal(
      !stale.ok && stale.error,
      "Bu önerinin Medium boyu “Çilekli Latte” adıyla eklendi; Large boyunu da aynı adla onaylayın (iki boy tek ürün olarak eşleşsin)",
    );
    assert.deepEqual(await products("L"), []);
    assert.equal(await status(ids.get("L")!), "pending");

    // Büyük harfle yazılan aynı ad M'nin yazımına döner
    const l = await actions.approveNewProduct({ id: ids.get("L")!, name: "ÇİLEKLİ  LATTE", categoryId: category, price: 210 });
    assert.equal(l.ok, true, JSON.stringify(l));
    assert.equal(l.ok && l.data.name, "Çilekli Latte");
    assert.deepEqual(await products("M"), ["Çilekli Latte"]);
    assert.deepEqual(await products("L"), ["Çilekli Latte"]);
    const [log] = await db.select({ detail: s.activityLog.detail }).from(s.activityLog).where(eq(s.activityLog.action, "Yeni ürün (öneriden)")).orderBy(s.activityLog.id);
    assert.ok(log?.detail?.startsWith("Çilekli Latte M · "), log?.detail ?? "kayıt yok");
  });

  test("E-55: başka kişinin aynı adlı önerisi kardeş sayılmaz", async () => {
    // Ali (yönetici de önerebilir) aynı adı önerseydi Ayşe'ninkiyle aynı grup olmazdı: kardeş araması kişiye bağlı
    const found = await pairs(db, [{ id: -1, requestedBy: ali.id, requestedByName: ali.name, name: "Cilekli latte", size: "L" }]);
    assert.equal(found.size, 0);
    // Hesabı silinmiş kişinin önerisi adıyla eşleşir (requestedBy boş)
    const gone = await pairs(db, [{ id: -2, requestedBy: null, requestedByName: ayse.name, name: "Cilekli latte", size: "L" }]);
    assert.equal(gone.size, 0, "hesabı olan Ayşe'nin önerisi adıyla eşleşmez");
  });

  test("E-55: öneriden sonra pasife alınan malzeme reddedilir; ürün açılmaz, öneri bekler", async () => {
    const ids = await propose("Vanilyalı Soğuk Süt", [{ size: "Tek", items: [line(milk, 250), line(vanilla, 20)], price: 150 }]);
    await db.update(s.ingredients).set({ active: false }).where(eq(s.ingredients.id, vanilla));
    const res = await actions.approveNewProduct({ id: ids.get("Tek")!, name: "Vanilyalı Soğuk Süt", categoryId: category, price: 150 });
    assert.equal(res.ok, false);
    assert.equal(
      !res.ok && res.error,
      "Vanilya şurubu pasif; öneri onaylanamaz. Malzemeyi Hammaddeler › Pasif'ten yeniden açın ya da öneriyi reddedin",
    );
    assert.deepEqual(await products("Tek"), []);
    assert.equal(await status(ids.get("Tek")!), "pending");
    // Malzeme yeniden açılınca onaylanır
    await db.update(s.ingredients).set({ active: true }).where(eq(s.ingredients.id, vanilla));
    const ok = await actions.approveNewProduct({ id: ids.get("Tek")!, name: "Vanilyalı Soğuk Süt", categoryId: category, price: 150 });
    assert.equal(ok.ok, true, JSON.stringify(ok));
  });

  test("E-55: formül bugünkü ayarlarla eksiye düşerse reddedilir; ayar düzelince onaylanır", async () => {
    // Öneri anında 1 pompa püre 30 ml: 2 pompa - 40 = 20 ml
    await db.insert(s.settings).values({ key: "pompaPure", value: 30 }).onConflictDoUpdate({ target: s.settings.key, set: { value: 30 } });
    const ids = await propose("Çilekli Milkshake", [{ size: "M", items: [line(milk, 200), line(puree, 0, "PurePompa * 2 - 40")], price: 210 }]);
    const [stored] = await db.select({ after: s.recipeChangeRequests.after }).from(s.recipeChangeRequests).where(eq(s.recipeChangeRequests.id, ids.get("M")!));
    assert.equal(stored.after.items[1].qty, 20, "öneride sunucunun hesapladığı miktar");
    // Sonra pompa 15 ml'ye düşürüldü: formül -10 ml
    await db.update(s.settings).set({ value: 15 }).where(eq(s.settings.key, "pompaPure"));
    const res = await actions.approveNewProduct({ id: ids.get("M")!, name: "Çilekli Milkshake", categoryId: category, price: 210 });
    assert.equal(res.ok, false);
    assert.equal(
      !res.ok && res.error,
      "Çilek püresi: miktar bugünkü ayarlarla negatif çıkıyor (PurePompa * 2 - 40 = -10 ml); öneri onaylanamaz. Ayarlar'daki ölçüyü düzeltin ya da öneriyi reddedin",
    );
    assert.ok(!(await products("M")).includes("Çilekli Milkshake"));
    assert.equal(await status(ids.get("M")!), "pending");
    await db.update(s.settings).set({ value: 30 }).where(eq(s.settings.key, "pompaPure"));
    const ok = await actions.approveNewProduct({ id: ids.get("M")!, name: "Çilekli Milkshake", categoryId: category, price: 210 });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const [p] = await db.select({ id: s.products.id }).from(s.products).where(and(eq(s.products.name, "Çilekli Milkshake"), eq(s.products.size, "M")));
    const items = await db.select({ qty: s.recipeItems.qty, ingredientId: s.recipeItems.ingredientId }).from(s.recipeItems).where(eq(s.recipeItems.productId, p.id));
    assert.equal(items.find((i) => i.ingredientId === puree)?.qty, 20);
  });
});
