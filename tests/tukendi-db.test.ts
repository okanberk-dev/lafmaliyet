// Tükendi / Satışa aç (dalga 10 §2.1; src/server/site-menu/sold-out-core.ts), gerçek Postgres'te ve sitenin sahte
// ucuyla: laffogato.net'e hiç gidilmez, imzalı GET / POST /api/panel/menu bellekteki bir siteye yönlenir (imza
// sahte anahtarla doğrulanır). Sitenin "değişmedi" yanıtı ve eski kopyayla sahibin kapattığı kalem kayıt bırakmaz;
// personelin kaydı başka bir personelce açılır, canlı damga farklıysa açılmaz; panelin yalnız fiyat yazımı kaydı taşır;
// açık kalmış reçete kartı ürünü yeniden açmaz; hız sınırı ve ortak tavan; "Kapalı tut"tan sonra personel açamaz; aynı
// anda iki barista tek kayıt bırakır. Fiyat ve "Menüde aktif" hiç yazılmaz.
//
// Kendi kullanıcılarını, kategorisini ve ürünlerini açar; integration_state'teki menü satırlarını (kopya, durum,
// Tükenenler kaydı) başta saklar ve sonda geri yazar.
//
// TUKENDI_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: TUKENDI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/tukendi-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../src/lib/karaoke/signature";
import type { SiteMenuItem } from "../src/lib/site-menu/schema";
import { keepSeen, SOLD_OUT_KEY, SOLD_OUT_TEXT, STAFF_SOLD_OUT_MAX } from "../src/lib/site-menu/sold-out";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const URL_ = process.env.TUKENDI_TEST_DATABASE_URL;
const SECRET = "tukendi-test-anahtari-gercek-degil-0123456789";
const SITE = "http://site.test";
const MENU_KEYS = ["menu_site_items", "menu_sync", SOLD_OUT_KEY];

describe("Tükendi / Satışa aç: sitenin sahte ucuyla", { skip: !URL_ && "TUKENDI_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let core: typeof import("../src/server/site-menu/sold-out-core");
  let push: typeof import("../src/server/site-menu/push");
  let closeDb: () => Promise<void>;
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse" | "mehmet" | "selin", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
    selin: { id: 0, name: "Selin", role: "staff" },
  };
  let categoryId = 0;
  const productIds: number[] = [];
  const saved: { key: string; value: unknown }[] = [];
  const realFetch = globalThis.fetch;

  // ------------------------------------------------ Sahte site
  const site = new Map<string, SiteMenuItem>();
  let posts: { id: string; isActive?: boolean; priceMinor?: number; actor: string }[] = [];
  let stampMs = Date.now();
  /** Sitenin damgası: her değişiklikte ilerler (aynı milisaniyeye düşmesin) */
  const stamp = () => new Date((stampMs = Math.max(stampMs + 1, Date.now()))).toISOString();
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function fakeSite(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== SITE) return realFetch(input, init);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === "string" ? init.body : "";
    const ok = verifySignature(SECRET, { method: init?.method ?? "GET", url, body, timestamp: headers[TIMESTAMP_HEADER] ?? null, signature: headers[SIGNATURE_HEADER] ?? null });
    if (!ok) return json(401, { error: "unauthorized" });
    if (url.pathname !== "/api/panel/menu") return json(404, { error: "not_found" });
    if ((init?.method ?? "GET") === "GET") return json(200, { version: 1, now: new Date().toISOString(), items: [...site.values()] });
    const req = JSON.parse(body) as { id: string; isActive?: boolean; priceMinor?: number; priceMinorL?: number; actor: string };
    posts.push(req);
    const cur = site.get(req.id);
    if (!cur) return json(404, { error: "not_found" });
    const next = { ...cur, ...(req.isActive !== undefined ? { isActive: req.isActive } : {}), ...(req.priceMinor !== undefined ? { priceMinor: req.priceMinor } : {}), ...(req.priceMinorL !== undefined ? { priceMinorL: req.priceMinorL } : {}) };
    // "Değişmedi": eski damgayla döner
    const changed = next.isActive !== cur.isActive || next.priceMinor !== cur.priceMinor || next.priceMinorL !== cur.priceMinorL;
    const item = changed ? { ...next, updatedAt: stamp() } : cur;
    site.set(req.id, item);
    return json(200, { item });
  }
  /** Sahibin sitenin panelinden yaptığı değişiklik (panelin kopyası bilmez); `agoMs` önce */
  const ownerEdit = (id: string, patch: Partial<SiteMenuItem>, agoMs = 0) =>
    site.set(id, { ...site.get(id)!, ...patch, updatedAt: agoMs ? new Date(Date.now() - agoMs).toISOString() : stamp() });

  // ------------------------------------------------ Panel tarafı
  const ids = { tira: `tk-tira-${tag}`, latte: `tk-latte-${tag}`, cake: `tk-cake-${tag}`, brownie: `tk-brownie-${tag}` };
  const prod: Record<string, number> = {};
  const siteItem = (id: string, name: string, o: Partial<SiteMenuItem> = {}): SiteMenuItem => ({
    id,
    name,
    categoryKey: "tatli",
    categoryLabel: "Tatlılar",
    priceMinor: 18_000,
    priceMinorL: 0,
    isActive: true,
    sortOrder: 0,
    // Kalemler bir saat önce yazılmış
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    ...o,
  });
  /** Panelin kopyasını sitenin şimdiki hâline getirir (ping ve çekme gibi) */
  async function syncSnapshot(only?: string[]) {
    const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "menu_site_items"));
    const cur = (row?.value as { items?: SiteMenuItem[] } | undefined)?.items ?? [];
    const items = only ? cur.filter((i) => !only.includes(i.id)).concat(only.map((id) => site.get(id)!)) : [...site.values()];
    const value = { now: new Date().toISOString(), at: new Date().toISOString(), items };
    await db.insert(s.integrationState).values({ key: "menu_site_items", value }).onConflictDoUpdate({ target: s.integrationState.key, set: { value } });
  }
  const record = async () => {
    const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, SOLD_OUT_KEY));
    return (row?.value ?? { items: {}, toggles: {} }) as { items: Record<string, { by: string; byRole: string; siteUpdatedAt: string }>; toggles: Record<string, string> };
  };
  const productRow = async (id: number) => (await db.select().from(s.products).where(eq(s.products.id, id)))[0];
  const refused = (p: Promise<unknown>, text: string | RegExp) =>
    assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  const set = (who: Who, id: string, soldOut: boolean) => core.setSoldOutCore(who, { siteMenuId: id, soldOut });
  /** Aynı kalemde 3 saniye kuralı: kaydın son işlem anı geri alınır (testi beklemeden sürdürmek için) */
  async function forgetToggles() {
    const r = await record();
    await db
      .update(s.integrationState)
      .set({ value: { ...r, toggles: {} } })
      .where(eq(s.integrationState.key, SOLD_OUT_KEY));
  }

  before(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.KARAOKE_SYNC_SECRET = SECRET;
    process.env.LAFFOGATO_URL = SITE;
    globalThis.fetch = fakeSite as typeof fetch;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL_!, 4);
    closeDb = () => dbModule.getDb().$client.end();
    core = await import("../src/server/site-menu/sold-out-core");
    push = await import("../src/server/site-menu/push");
    for (const row of await db.select().from(s.integrationState).where(inArray(s.integrationState.key, MENU_KEYS))) saved.push({ key: row.key, value: row.value });
    await db.delete(s.integrationState).where(inArray(s.integrationState.key, MENU_KEYS));
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db.insert(s.users).values({ email: `tukendi-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    const [c] = await db.insert(s.categories).values({ name: `Tükendi ${tag}`, sortOrder: 99 }).returning({ id: s.categories.id });
    categoryId = c.id;
    const add = async (key: string, name: string, size: "M" | "L" | "Tek", siteMenuId: string, slot: "M" | "L", price: number) => {
      const [p] = await db.insert(s.products).values({ categoryId, name: `${name} ${tag}`, size, price, siteMenuId, siteMenuSlot: slot }).returning({ id: s.products.id });
      productIds.push(p.id);
      prod[key] = p.id;
    };
    await add("tira", "Tiramisu", "Tek", ids.tira, "M", 180);
    await add("latteM", "Ice Latte", "M", ids.latte, "M", 180);
    await add("latteL", "Ice Latte", "L", ids.latte, "L", 210);
    await add("cake", "Cheesecake", "Tek", ids.cake, "M", 180);
    await add("brownie", "Brownie", "Tek", ids.brownie, "M", 180);
  });

  beforeEach(async () => {
    // Her test temiz bir siteyle ve kopyayla başlar
    site.clear();
    site.set(ids.tira, siteItem(ids.tira, "Tiramisu"));
    site.set(ids.latte, siteItem(ids.latte, "Buzlu Caffè Latte", { priceMinorL: 21_000, categoryLabel: "Kahveler" }));
    site.set(ids.cake, siteItem(ids.cake, "Cheesecake"));
    site.set(ids.brownie, siteItem(ids.brownie, "Brownie"));
    posts = [];
    await db.delete(s.integrationState).where(inArray(s.integrationState.key, MENU_KEYS));
    await db.update(s.products).set({ showOnMenu: true, active: true }).where(inArray(s.products.id, productIds));
    await db.update(s.products).set({ price: 210 }).where(eq(s.products.id, prod.latteL));
    await db.update(s.products).set({ price: 180 }).where(inArray(s.products.id, [prod.tira, prod.latteM, prod.cake, prod.brownie]));
    await db.delete(s.activityLog).where(inArray(s.activityLog.userId, Object.values(users).map((u) => u.id)));
    await syncSnapshot();
  });

  after(async () => {
    globalThis.fetch = realFetch;
    if (!db) return;
    await db.delete(s.integrationState).where(inArray(s.integrationState.key, MENU_KEYS));
    for (const r of saved) await db.insert(s.integrationState).values({ key: r.key, value: r.value });
    const uids = Object.values(users).map((u) => u.id).filter(Boolean);
    if (uids.length) await db.delete(s.activityLog).where(inArray(s.activityLog.userId, uids));
    if (productIds.length) {
      await db.delete(s.productPrices).where(inArray(s.productPrices.productId, productIds));
      await db.delete(s.products).where(inArray(s.products.id, productIds));
    }
    if (categoryId) await db.delete(s.categories).where(eq(s.categories.id, categoryId));
    if (uids.length) await db.delete(s.users).where(inArray(s.users.id, uids));
    await db.$client.end();
    await closeDb();
  });

  test("Tükendi: site kapatır (imzalı, M ve L birlikte), kayıt sitenin yeni damgasıyla; fiyat ve active yazılmaz", async () => {
    const r = await set(users.ayse, ids.latte, true);
    assert.deepEqual(r, { changed: true, message: `Ice Latte ${tag} tükendi`, name: `Ice Latte ${tag}` });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].isActive, false);
    assert.equal(posts[0].priceMinor, undefined, "fiyat gönderilmez");
    assert.equal(posts[0].actor, "Ayşe");
    assert.equal(site.get(ids.latte)!.isActive, false);
    const m = (await record()).items[ids.latte];
    assert.equal(m.by, "Ayşe");
    assert.equal(m.byRole, "staff");
    assert.equal(m.siteUpdatedAt, site.get(ids.latte)!.updatedAt);
    for (const id of [prod.latteM, prod.latteL]) {
      const p = await productRow(id);
      assert.equal(p.showOnMenu, false);
      assert.equal(p.active, true);
    }
    assert.equal((await productRow(prod.latteM)).price, 180);
    assert.equal((await productRow(prod.latteL)).price, 210);
    const log = await db.select().from(s.activityLog).where(and(eq(s.activityLog.userId, users.ayse.id), eq(s.activityLog.action, "Tükendi")));
    assert.equal(log.length, 1);
    assert.match(log[0].detail ?? "", /\(M, L\) · laffogato\.net, uygulama ve QR menü/);
  });

  test("sitenin 'değişmedi' yanıtı ve eski kopyayla sahibin kapattığı kalem kayıt bırakmaz", async () => {
    // Sahip on dakika önce sitede kapattı; panelin kopyası hâlâ "Satışta" diyor
    ownerEdit(ids.tira, { isActive: false }, 10 * 60_000);
    const r = await set(users.ayse, ids.tira, true);
    assert.equal(r.changed, false);
    assert.equal(r.message, `Tiramisu ${tag} zaten tükendi (sitede kapatılmış; yönetici açar)`);
    assert.equal(posts.length, 1, "site soruldu");
    assert.equal((await record()).items[ids.tira], undefined, "kayıt yok");
    // Panel sitenin durumunu aldı
    assert.equal((await productRow(prod.tira)).showOnMenu, false);
    // Personel açamaz
    await forgetToggles();
    await refused(set(users.mehmet, ids.tira, false), SOLD_OUT_TEXT.adminClosed);
  });

  test("personelin kaydını başka bir personel açar; kayıt düşer, iki boy da açılır", async () => {
    await set(users.ayse, ids.latte, true);
    await forgetToggles();
    const r = await set(users.mehmet, ids.latte, false);
    assert.deepEqual(r, { changed: true, message: `Ice Latte ${tag} satışta`, name: `Ice Latte ${tag}` });
    assert.equal(site.get(ids.latte)!.isActive, true);
    assert.equal((await record()).items[ids.latte], undefined);
    for (const id of [prod.latteM, prod.latteL]) assert.equal((await productRow(id)).showOnMenu, true);
    const log = await db.select().from(s.activityLog).where(and(eq(s.activityLog.userId, users.mehmet.id), eq(s.activityLog.action, "Satışa açıldı")));
    assert.equal(log.length, 1);
  });

  test("canlı damga farklıysa personel açamaz (sahip sonra sitede değiştirdi); yönetici açar", async () => {
    await set(users.ayse, ids.cake, true);
    await forgetToggles();
    // Sahip sitede adı değiştirdi; panelin kopyası bilmiyor (canlı listeye bakılır)
    ownerEdit(ids.cake, { name: "Limonlu Cheesecake" });
    await refused(set(users.ayse, ids.cake, false), SOLD_OUT_TEXT.adminClosed);
    assert.equal(site.get(ids.cake)!.isActive, false);
    const r = await set(users.ali, ids.cake, false);
    assert.equal(r.changed, true);
    assert.equal(site.get(ids.cake)!.isActive, true);
  });

  test("panelin yalnız fiyat yazımı kaydı yeni damgaya taşır; personel yine açar", async () => {
    await set(users.ayse, ids.brownie, true);
    const before = (await record()).items[ids.brownie].siteUpdatedAt;
    // updateProductPrice'ın yolu: önce site, sonra tek işlemde applyPushed
    const row = await productRow(prod.brownie);
    const desired = { price: 195, active: row.active, showOnMenu: row.showOnMenu };
    const out = await push.pushSaleChange(users.ali, row, desired, "fiyat değişmedi");
    assert.equal(out.kind, "pushed");
    await db.transaction(async (tx) => {
      if (out.kind !== "pushed") return;
      const final = await push.applyPushed(tx, out, row, desired, new Date());
      await tx.update(s.products).set({ price: final.price }).where(eq(s.products.id, row.id));
    });
    const after = (await record()).items[ids.brownie].siteUpdatedAt;
    assert.notEqual(after, before);
    assert.equal(after, site.get(ids.brownie)!.updatedAt);
    await forgetToggles();
    const r = await set(users.mehmet, ids.brownie, false);
    assert.equal(r.changed, true);
  });

  test("açık kalmış reçete kartı (dokunulmamış anahtar) personelin kapattığı ürünü açmaz", async () => {
    await set(users.ayse, ids.tira, true);
    const row = await productRow(prod.tira);
    assert.equal(row.showOnMenu, false);
    // Kart açılırken QR menüde açıktı (seen = true), yönetici dokunmadı (gönderilen = true)
    const desired = { price: row.price, active: keepSeen(true, true, row.active), showOnMenu: keepSeen(true, true, row.showOnMenu) };
    posts = [];
    const out = await push.pushSaleChange(users.ali, row, desired, "değişiklikler kaydedilmedi");
    assert.equal(out.kind, "local");
    assert.equal(posts.length, 0, "siteye yazılmadı");
    assert.equal(site.get(ids.tira)!.isActive, false);
    assert.ok((await record()).items[ids.tira], "kayıt duruyor");
  });

  test("hız sınırı: aynı kalemde 3 saniye; kişi başına 10 dakikada 20 işlem", async () => {
    await set(users.ayse, ids.tira, true);
    await refused(set(users.ayse, ids.tira, false), SOLD_OUT_TEXT.tooSoon);
    // 20 işlem İşlem geçmişinde (son 10 dakika)
    await db.insert(s.activityLog).values(Array.from({ length: 20 }, () => ({ userId: users.selin.id, userName: "Selin", action: "Tükendi", detail: "deneme" })));
    await refused(set(users.selin, ids.cake, true), SOLD_OUT_TEXT.tooMany);
    // Yönetici sınırsız
    await set(users.ali, ids.cake, true);
    await set(users.ali, ids.cake, false);
  });

  test("ortak tavan: personelin 10 geçerli kaydı varken 11. ret; yöneticininki sayılmaz ve yönetici kapatır", async () => {
    // 10 geçerli personel kaydı (başka kalemler; sitede ve kopyada kapalı)
    const items: Record<string, unknown> = {};
    for (let i = 0; i < STAFF_SOLD_OUT_MAX; i++) {
      const id = `tk-dolu${i}-${tag}`;
      const it = siteItem(id, `Dolu ${i}`, { isActive: false });
      site.set(id, it);
      items[id] = { byId: users.selin.id, by: "Selin", byRole: "staff", at: new Date().toISOString(), siteUpdatedAt: it.updatedAt };
    }
    await syncSnapshot();
    await db.insert(s.integrationState).values({ key: SOLD_OUT_KEY, value: { items, toggles: {} } });
    await refused(set(users.ayse, ids.brownie, true), SOLD_OUT_TEXT.cap);
    assert.equal(site.get(ids.brownie)!.isActive, true, "siteye gidilmedi");
    const r = await set(users.ali, ids.brownie, true);
    assert.equal(r.changed, true);
    assert.equal((await record()).items[ids.brownie].byRole, "admin");
  });

  test("Kapalı tut: kayıt düşer, personel açamaz; satıştaki kalemi kayıtsız kapatır", async () => {
    await set(users.ayse, ids.cake, true);
    const r = await core.holdSoldOutCore(users.ali, { siteMenuId: ids.cake });
    assert.equal(r.changed, true);
    assert.equal((await record()).items[ids.cake], undefined);
    await forgetToggles();
    await refused(set(users.mehmet, ids.cake, false), SOLD_OUT_TEXT.adminClosed);
    // Satıştaki kalem: kapatılır, kayıt yazılmaz
    await core.holdSoldOutCore(users.ali, { siteMenuId: ids.brownie });
    assert.equal(site.get(ids.brownie)!.isActive, false);
    assert.equal((await record()).items[ids.brownie], undefined);
    assert.equal((await productRow(prod.brownie)).showOnMenu, false);
    const log = await db.select().from(s.activityLog).where(and(eq(s.activityLog.userId, users.ali.id), eq(s.activityLog.action, "Tükendi: kapalı tutuldu")));
    assert.equal(log.length, 2);
  });

  test("aynı anda iki barista: tek kayıt, ikincisi 'zaten tükendi'", async () => {
    const [a, b] = await Promise.all([set(users.ayse, ids.tira, true), set(users.mehmet, ids.tira, true)]);
    assert.equal([a, b].filter((x) => x.changed).length, 1);
    assert.ok([a, b].some((x) => !x.changed && x.message === `Tiramisu ${tag} zaten tükendi`));
    const m = (await record()).items[ids.tira];
    assert.ok(m && (m.by === "Ayşe" || m.by === "Mehmet"));
    const log = await db.select().from(s.activityLog).where(and(inArray(s.activityLog.userId, [users.ayse.id, users.mehmet.id]), eq(s.activityLog.action, "Tükendi")));
    assert.equal(log.length, 1);
  });

  test("site bağlantısı reddederse metnin sonunda 'Yöneticiye haber verin.'; kayıt ve panel değişmez", async () => {
    site.delete(ids.cake);
    await refused(set(users.ayse, ids.cake, true), /Yöneticiye haber verin\.$/);
    assert.equal((await productRow(prod.cake)).showOnMenu, true);
    assert.equal((await record()).items[ids.cake], undefined);
  });
});
