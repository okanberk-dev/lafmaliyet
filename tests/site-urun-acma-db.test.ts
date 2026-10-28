// "Yalnız sitede" kalemden panel ürünü açma (denetim 26 Eki 2026 B14, E-48) gerçek Postgres'te ve sitenin sahte
// ucuyla: laffogato.net'e hiç gidilmez, imzalı GET /api/panel/menu bellekteki bir siteye yönlenir. Kalemin iki fiyatı
// iki boy olarak sitenin fiyatıyla açılır ve (siteMenuId, M/L)'ye bağlanır; tek boylu Tükendi kalem QR menüde gizli
// açılır; bu kalemle gelmiş ürünsüz LafPOS satırı ürüne bağlanır. Aynı ad + boy, dolu yuva, sitede olmayan kalem, tek
// boylu kalemin L'si ve siteye ulaşılamaması ürün açmaz. Aynı ad + boyda bekleyen yeni ürün önerisi de ürün açtırmaz
// (inceleme B14-D1): öneri onaylanır, ürün reçetesiyle açılır ve kaleme bağlanır.
//
// SITE_URUN_TEST_DATABASE_URL (yoksa FIFO_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SITE_URUN_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/site-urun-acma-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../src/lib/karaoke/signature";
import type { SiteMenuItem } from "../src/lib/site-menu/schema";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SITE_URUN_TEST_DATABASE_URL ?? process.env.FIFO_TEST_DATABASE_URL;
const DB_NAME = `laffogato_site_urun_${process.pid}`;
const SECRET = "site-urun-acma-test-anahtari-gercek-degil-0123456789";
const SITE = "http://site.test";

describe("Yalnız sitede kalemden ürün açma: sahte siteyle", { skip: !SERVER_URL && "SITE_URUN_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let actions: typeof import("../src/server/actions/site-menu");
  let requests: typeof import("../src/server/actions/recipe-requests");
  let productActions: typeof import("../src/server/actions/products");
  let category = 0;
  const realFetch = globalThis.fetch;
  const me = { id: 0, name: "Ali", role: "admin" as const };

  const item = (id: string, name: string, o: Partial<SiteMenuItem> = {}): SiteMenuItem => ({
    id,
    name,
    categoryKey: "soguk",
    categoryLabel: "Soğuk kahveler",
    priceMinor: 18_500,
    priceMinorL: 20_500,
    isActive: true,
    sortOrder: 1,
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    ...o,
  });
  const site = new Map<string, SiteMenuItem>(
    [
      item("mnu-0100", "Matcha Latte"),
      item("mnu-0200", "San Sebastian", { categoryKey: "tatli", categoryLabel: "Tatlılar", priceMinor: 22_050, priceMinorL: 0, isActive: false }),
      item("mnu-0300", "Buzlu Americano", { priceMinor: 15_000, priceMinorL: 0 }),
      item("mnu-0400", "Çilekli Soda", { priceMinor: 12_000, priceMinorL: 14_000 }),
      item("mnu-0500", "Fıstıklı Kurabiye", { categoryKey: "tatli", categoryLabel: "Tatlılar", priceMinor: 9_000, priceMinorL: 0 }),
    ].map((i) => [i.id, i]),
  );
  let down = false;
  let gets = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function fakeSite(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== SITE) return realFetch(input, init);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const ok = verifySignature(SECRET, { method: init?.method ?? "GET", url, body: "", timestamp: headers[TIMESTAMP_HEADER] ?? null, signature: headers[SIGNATURE_HEADER] ?? null });
    if (!ok) return json(401, { error: "unauthorized" });
    if (url.pathname !== "/api/panel/menu" || (init?.method ?? "GET") !== "GET") return json(404, { error: "not_found" });
    gets++;
    if (down) return json(503, { error: "unavailable" });
    return json(200, { version: 1, now: new Date().toISOString(), items: [...site.values()] });
  }

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      AUTH_SECRET: "site-urun-acma-testi-icin-en-az-otuz-iki-karakterlik-anahtar",
      KARAOKE_SYNC_SECRET: SECRET,
      LAFFOGATO_URL: SITE,
    });
    globalThis.fetch = fakeSite as typeof fetch;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum (yönetici Ali) ve sayfa yenileme taklit edilir
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
    const [a] = await db.insert(s.users).values({ email: "ali@laffogato.net", name: me.name, passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    me.id = a.id;
    stub(require.resolve("../src/server/auth/dal"), { requireUser: async () => me, requireAdmin: async () => me });
    actions = await import("../src/server/actions/site-menu");
    requests = await import("../src/server/actions/recipe-requests");
    productActions = await import("../src/server/actions/products");
    const [c] = await db.insert(s.categories).values({ name: "Soğuk kahveler", sortOrder: 1 }).returning({ id: s.categories.id });
    category = c.id;
    // Kategorinin ürünlerinde en sık zayi oranı %5: yeni ürün onu alır (Yeni ürün'ün kuralı)
    await db.insert(s.products).values([
      { categoryId: category, name: "Ice Latte", size: "M", price: 170, fireOverride: 0.05, sortOrder: 1 },
      { categoryId: category, name: "Ice Latte", size: "L", price: 190, fireOverride: 0.05, sortOrder: 2 },
    ]);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const rows = (name: string) =>
    db
      .select({
        id: s.products.id,
        size: s.products.size,
        price: s.products.price,
        active: s.products.active,
        showOnMenu: s.products.showOnMenu,
        siteMenuId: s.products.siteMenuId,
        slot: s.products.siteMenuSlot,
        categoryId: s.products.categoryId,
        fireOverride: s.products.fireOverride,
      })
      .from(s.products)
      .where(eq(s.products.name, name))
      .orderBy(s.products.size);
  const productCount = async () => (await db.select({ id: s.products.id }).from(s.products)).length;

  test("E-48: iki fiyatlı kalem iki boy olarak sitenin fiyatıyla açılır ve (kalem, M/L)'ye bağlanır; ürünsüz LafPOS satırı bağlanır", async () => {
    // LafPOS bu kalemi ürünü yokken sattı: satır ürünsüz saklandı
    await db.insert(s.posDailySales).values({ date: "2026-10-27", posName: "MATCHA LATTE M", siteMenuId: "mnu-0100", slot: "M", qty: 3, revenue: 555 });
    const res = await actions.createProductsFromSite({
      siteMenuId: "mnu-0100",
      name: " Matcha  Latte ",
      categoryId: category,
      rows: [
        { slot: "M", size: "M" },
        { slot: "L", size: "L" },
      ],
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    const created = res.ok ? res.data.created : [];
    assert.deepEqual(
      created.map((c) => [c.size, c.slot, c.price, c.showOnMenu]),
      [
        ["M", "M", 185, true],
        ["L", "L", 205, true],
      ],
    );
    const got = await rows("Matcha Latte");
    assert.deepEqual(
      got.map((p) => [p.size, p.price, p.siteMenuId, p.slot, p.active, p.showOnMenu, p.categoryId, p.fireOverride]),
      [
        ["L", 205, "mnu-0100", "L", true, true, category, 0.05],
        ["M", 185, "mnu-0100", "M", true, true, category, 0.05],
      ],
    );
    // Fiyat geçmişinin ilk satırı ("Yeni ürün"); kasanın listesine girmez
    const history = await db.select({ source: s.productPrices.source, price: s.productPrices.price }).from(s.productPrices).where(eq(s.productPrices.productId, got[1].id));
    assert.deepEqual(history, [{ source: "create", price: 185 }]);
    const [pos] = await db.select({ productId: s.posDailySales.productId }).from(s.posDailySales).where(eq(s.posDailySales.posName, "MATCHA LATTE M"));
    assert.equal(pos.productId, got[1].id, "ürünsüz LafPOS satırı M'ye bağlandı");
    const [log] = await db.select({ detail: s.activityLog.detail }).from(s.activityLog).where(eq(s.activityLog.action, "Yeni ürün (siteden)"));
    assert.equal(log?.detail, "Matcha Latte M, L → Matcha Latte (mnu-0100): M 185\u00a0₺, L 205\u00a0₺");
  });

  test("E-48: tek boylu Tükendi kalem Tek boy olarak açılır, QR menüde gizli (sitenin durumu); kuruşlu fiyat", async () => {
    const res = await actions.createProductsFromSite({ siteMenuId: "mnu-0200", name: "San Sebastian", categoryId: category, rows: [{ slot: "M", size: "Tek" }] });
    assert.equal(res.ok, true, JSON.stringify(res));
    const [p] = await rows("San Sebastian");
    assert.deepEqual([p.size, p.price, p.siteMenuId, p.slot, p.active, p.showOnMenu], ["Tek", 220.5, "mnu-0200", "M", true, false]);
    const logs = await db.select({ detail: s.activityLog.detail }).from(s.activityLog).where(eq(s.activityLog.action, "Yeni ürün (siteden)"));
    assert.ok(logs.some((l) => l.detail === "San Sebastian Tek → San Sebastian (mnu-0200): Tek 220,50\u00a0₺ · QR menüde gizli (sitede Tükendi)"), JSON.stringify(logs));
  });

  test("E-48: açılmayanlar: aynı ad + boy, dolu yuva, sitede olmayan kalem, tek boyun L'si, siteye ulaşılamaması", async () => {
    const before = await productCount();
    const refused = async (input: Parameters<typeof actions.createProductsFromSite>[0], text: string | RegExp) => {
      const res = await actions.createProductsFromSite(input);
      assert.equal(res.ok, false, JSON.stringify(res));
      if (!res.ok) (typeof text === "string" ? assert.equal : assert.match)(res.error as never, text as never);
    };
    // Panelde aynı ad + boy (büyük/küçük harf farkıyla): onu bağlamak gerekir
    await refused(
      { siteMenuId: "mnu-0400", name: "ICE LATTE", categoryId: category, rows: [{ slot: "M", size: "M" }] },
      "“Ice Latte · M” panelde zaten var: yenisini açmak yerine onu bağlayın (Öneriler ya da Panelde bağlı değil sekmesi)",
    );
    // Yuva bu arada başka ürüne bağlandı (başka sekme): ürün açılmaz, işlem geri alınır
    const [other] = await db.insert(s.products).values({ categoryId: category, name: "Americano Buzlu", size: "Tek", price: 150, siteMenuId: "mnu-0300", siteMenuSlot: "M" }).returning({ id: s.products.id });
    await refused(
      { siteMenuId: "mnu-0300", name: "Buzlu Americano", categoryId: category, rows: [{ slot: "M", size: "Tek" }] },
      "Buzlu Americano (tek fiyat) zaten Americano Buzlu Tek ürününe bağlı; ürün açılmadı. Sayfayı yenileyin",
    );
    assert.deepEqual(await rows("Buzlu Americano"), []);
    // Sitede silinmiş kalem
    await refused({ siteMenuId: "mnu-0999", name: "Yok", categoryId: category, rows: [{ slot: "M", size: "M" }] }, "mnu-0999 sitede yok (silinmiş olabilir); sayfayı yenileyin");
    // Tek boylu kalemin L fiyatı yok
    await refused(
      { siteMenuId: "mnu-0300", name: "Buzlu Americano", categoryId: category, rows: [{ slot: "L", size: "L" }] },
      "Buzlu Americano sitede tek boy; yalnız tek fiyatı açılır. Sayfayı yenileyin",
    );
    // Aynı boy iki fiyata, kategori yok
    await refused(
      {
        siteMenuId: "mnu-0400",
        name: "Çilekli Soda",
        categoryId: category,
        rows: [
          { slot: "M", size: "M" },
          { slot: "L", size: "M" },
        ],
      },
      "İki fiyata aynı boy seçildi",
    );
    await refused({ siteMenuId: "mnu-0400", name: "Çilekli Soda", categoryId: 99_999, rows: [{ slot: "M", size: "M" }] }, "Kategori bulunamadı; sayfayı yenileyin");
    // Siteye ulaşılamıyor: hiçbir şey açılmaz
    down = true;
    const calls = gets;
    await refused({ siteMenuId: "mnu-0400", name: "Çilekli Soda", categoryId: category, rows: [{ slot: "M", size: "M" }] }, /; ürün açılmadı\. Tekrar dene\.$/);
    assert.equal(gets, calls + 1);
    down = false;
    assert.equal(await productCount(), before + 1, "yalnız testin elle bağladığı ürün");
    await db.delete(s.products).where(eq(s.products.id, other.id));
    // Ulaşılınca açılır
    const ok = await actions.createProductsFromSite({ siteMenuId: "mnu-0400", name: "Çilekli Soda", categoryId: category, rows: [{ slot: "L", size: "L" }] });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const soda = await db.select({ size: s.products.size, slot: s.products.siteMenuSlot, price: s.products.price }).from(s.products).where(and(eq(s.products.name, "Çilekli Soda")));
    assert.deepEqual(soda, [{ size: "L", slot: "L", price: 140 }]);
  });

  test("B14-D1: aynı ad + boyda bekleyen yeni ürün önerisi varken ürün açılmaz; öneri onaylanır, ürün reçetesiyle açılıp bağlanır", async () => {
    // Ayşe "Fıstıklı Kurabiye"yi (tek boy) reçetesiyle önerdi; site aynı hafta kalemi açtı
    const [ayse] = await db.insert(s.users).values({ email: "ayse@laffogato.net", name: "Ayşe", passwordHash: "x", role: "staff" }).returning({ id: s.users.id });
    const [pistachio] = await db
      .insert(s.ingredients)
      .values({ name: "Antep fıstığı", category: "Kuruyemiş", unit: "gr", packagePrice: 900, packageSize: 1000, priceSource: "manual" })
      .returning({ id: s.ingredients.id });
    const [req] = await db
      .insert(s.recipeChangeRequests)
      .values({
        kind: "new",
        productId: null,
        proposed: { name: "fıstıklı kurabiye", size: "Tek", categoryId: category, price: 90 },
        requestedBy: ayse.id,
        requestedByName: "Ayşe",
        before: { note: null, items: [] },
        after: { note: null, items: [{ ingredientId: pistachio.id, name: "Antep fıstığı", unit: "gr", qty: 25, qtyExpr: null, note: null }] },
        message: null,
      })
      .returning({ id: s.recipeChangeRequests.id });
    const before = await productCount();
    const text = "“fıstıklı kurabiye · Tek boy” için Ayşe'nin bekleyen yeni ürün önerisi var: ";
    // Panelde aç ve bağla: büyük/küçük harf farkıyla aynı ad + boy
    const site = await actions.createProductsFromSite({ siteMenuId: "mnu-0500", name: "Fıstıklı Kurabiye", categoryId: category, rows: [{ slot: "M", size: "Tek" }] });
    assert.equal(site.ok, false, JSON.stringify(site));
    assert.equal(!site.ok && site.error, `${text}önce Onaylar'da onaylayın (ürün reçetesiyle açılır), sonra Öneriler sekmesinden bağlayın`);
    // Ürünler › Yeni ürün de aynı kuralla
    const plain = await productActions.createProduct({ name: "FISTIKLI KURABİYE", size: "Tek", categoryId: category, price: 90 });
    assert.equal(plain.ok, false, JSON.stringify(plain));
    assert.equal(!plain.ok && plain.error, `${text}önce Onaylar'da onaylayın ya da reddedin`);
    assert.equal(await productCount(), before, "hiçbir ürün açılmadı");
    // Başka boy engellenmez (öneri yalnız kendi boyunu tutar)
    const otherSize = await productActions.createProduct({ name: "Fıstıklı Kurabiye", size: "M", categoryId: category, price: 95 });
    assert.equal(otherSize.ok, true, JSON.stringify(otherSize));
    if (otherSize.ok) await db.delete(s.products).where(eq(s.products.id, otherSize.data.id));

    // Öneri hâlâ onaylanabilir: ürün reçetesiyle açılır
    const approved = await requests.approveNewProduct({ id: req.id, name: "Fıstıklı Kurabiye", categoryId: category, price: 90 });
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const productId = approved.ok ? approved.data.productId : 0;
    const recipe = await db.select({ ingredientId: s.recipeItems.ingredientId, qty: s.recipeItems.qty }).from(s.recipeItems).where(eq(s.recipeItems.productId, productId));
    assert.deepEqual(recipe, [{ ingredientId: pistachio.id, qty: 25 }]);
    // Sonra kaleme bağlanır (Öneriler sekmesi): sitenin fiyatını alır; yeniden açmak artık "zaten var" der
    const again = await actions.createProductsFromSite({ siteMenuId: "mnu-0500", name: "Fıstıklı Kurabiye", categoryId: category, rows: [{ slot: "M", size: "Tek" }] });
    assert.equal(!again.ok && again.error, "“Fıstıklı Kurabiye · Tek” panelde zaten var: yenisini açmak yerine onu bağlayın (Öneriler ya da Panelde bağlı değil sekmesi)");
    const linked = await actions.linkProductToSite({ productId, siteMenuId: "mnu-0500", slot: "M" });
    assert.equal(linked.ok, true, JSON.stringify(linked));
    const [p] = await rows("Fıstıklı Kurabiye");
    assert.deepEqual([p.id, p.size, p.price, p.siteMenuId, p.slot], [productId, "Tek", 90, "mnu-0500", "M"]);
  });
});
