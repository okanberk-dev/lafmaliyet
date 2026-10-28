// Tükendi / Satışa aç (dalga 10 §2.1; src/server/site-menu/sold-out-core.ts), gerçek Postgres'te ve sitenin sahte
// ucuyla: laffogato.net'e hiç gidilmez, imzalı GET / POST /api/panel/menu bellekteki bir siteye yönlenir (imza
// sahte anahtarla doğrulanır). Sitenin "değişmedi" yanıtı ve eski kopyayla sahibin kapattığı kalem kayıt bırakmaz;
// personelin kaydı başka bir personelce açılır, canlı damga farklıysa açılmaz; panelin yalnız fiyat yazımı kaydı taşır;
// açık kalmış reçete kartı ürünü yeniden açmaz; hız sınırı ve ortak tavan; "Kapalı tut"tan sonra personel açamaz; aynı
// anda iki barista tek kayıt bırakır; "Kapalı tut" ile personelin "Satışa aç"ı aynı anda koşunca (kalemin kilidi)
// yöneticinin kararı kalır. Fiyat ve "Menüde aktif" hiç yazılmaz.
//
// Reçete kartı ve fiyat hücresi (denetim E-11, docs/planlar/senkron.md › P1): dokunulmayan fiyat sitede ya da
// eşitlemede bu arada yazılanı ezmez, siteye gidilmez; dokunulan fiyat veritabanı da değiştiyse yazılmaz; site
// `writes.expect` duyurunca yazım `expect` taşır, 409 `stale`'de panel siteyi yeniden okur, geri alınmış sitenin katı
// şemasının 400 `field:"body"`sinde bir kez `expect`'siz dener; zaman aşımında site yazmışsa panel okur; JSON olmayan 404 "uç yok" demektir.
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

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import postgres from "postgres";
import { z } from "zod";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../src/lib/karaoke/signature";
import { LINK_CHANGED_TEXT, priceChangedText, priceMovedText, priceRefusedText } from "../src/lib/prices/seen";
import { SITE_MENU_ID, type SiteMenuItem } from "../src/lib/site-menu/schema";
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
  let sync: typeof import("../src/server/site-menu/sync");
  let actions: typeof import("../src/server/actions/products");
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
  type Expect = { priceMinor?: number; priceMinorL?: number; isActive?: boolean };
  let posts: { id: string; isActive?: boolean; priceMinor?: number; priceMinorL?: number; actor: string; expect?: Expect }[] = [];
  /** Sitenin aldığı isteklerin sırası (zaman aşımından sonra çekme oldu mu) */
  let calls: ("GET" | "POST")[] = [];
  /**
   * Sitenin sürümü: `expect` duyurur ve uygular (S1), duyurmadan uygular (önizleme), ya da bilmez ve 400 verir (eski
   * site, katı şema). `post`: sıradaki POST'un sonu: yazıp yanıtı kaybeder (zaman aşımı) ya da uç yokmuş gibi HTML 404.
   */
  const mode = { announce: false, honor: false, rejectExpect: false, post: "ok" as "ok" | "timeout" | "html404" };
  /** Sitenin bugünkü yazma şeması (`panelMenuChangeSchema`, `.strict()`): `expect`'i tanımaz */
  const OLD_SITE_CHANGE = z
    .object({ id: z.string(), priceMinor: z.number().int().optional(), priceMinorL: z.number().int().optional(), isActive: z.boolean().optional(), actor: z.string().min(1) })
    .strict();
  /** Sıradaki GET'i yanıtlamadan bekletir (yarış testleri): `arrived` istek gelince, `release` ile yanıt döner */
  let getGate: { arrived: () => void; wait: Promise<void> } | null = null;
  function pauseNextGet() {
    let arrived!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((r) => (arrived = r));
    getGate = { arrived, wait: new Promise<void>((r) => (release = r)) };
    return { reached, release };
  }
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
    calls.push((init?.method ?? "GET") === "GET" ? "GET" : "POST");
    if ((init?.method ?? "GET") === "GET" && getGate) {
      const g = getGate;
      getGate = null;
      g.arrived();
      await g.wait;
    }
    if ((init?.method ?? "GET") === "GET") {
      return json(200, { version: 1, now: new Date().toISOString(), items: [...site.values(), ...(await othersOnSite())], ...(mode.announce ? { writes: { expect: true } } : {}) });
    }
    const req = JSON.parse(body) as (typeof posts)[number];
    posts.push(req);
    if (mode.post === "html404") {
      mode.post = "ok";
      return new Response("<!doctype html><title>404</title>", { status: 404, headers: { "content-type": "text/html" } });
    }
    // Eski site (laffogato main, menu-link-core.ts): şema katı; bilinmeyen alanın hatası yolsuzdur, alan "body" olur
    if (mode.rejectExpect) {
      const parsed = OLD_SITE_CHANGE.safeParse(req);
      if (!parsed.success) {
        const path = parsed.error.issues[0]?.path[0];
        return json(400, { error: "invalid", field: typeof path === "string" ? path : "body" });
      }
    }
    const cur = site.get(req.id);
    if (!cur) return json(404, { error: "not_found" });
    const next = { ...cur, ...(req.isActive !== undefined ? { isActive: req.isActive } : {}), ...(req.priceMinor !== undefined ? { priceMinor: req.priceMinor } : {}), ...(req.priceMinorL !== undefined ? { priceMinorL: req.priceMinorL } : {}) };
    const fields = (["priceMinor", "priceMinorL", "isActive"] as const).filter((f) => next[f] !== cur[f]);
    // "Değişmedi": eski damgayla döner (expect'e bakılmaz)
    if (!fields.length) return json(200, { item: cur });
    // expect yalnız yazılacak alanlar için: tutmazsa yazmaz, güncel kalemle 409 stale
    if (mode.honor && req.expect && fields.some((f) => req.expect![f] !== undefined && req.expect![f] !== cur[f])) return json(409, { error: "stale", item: cur });
    const item = { ...next, updatedAt: stamp() };
    site.set(req.id, item);
    if (mode.post === "timeout") {
      // Site yazdı, yanıt yolda kaldı
      mode.post = "ok";
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    return json(200, { item });
  }
  /**
   * Veritabanı başka testlerle paylaşılır (ör. lafpos-db kendi ürünlerini bağlar): bu testin tam çekmeleri (409 stale,
   * zaman aşımı, eşitleme) onların bağlantısını "sitede silinmiş" sayıp kaldırmasın diye sahte site, bu testin
   * kalemleri dışında bağlı her ürünün kalemini panelin değerleriyle aynen listeler (çekme onlara dokunmaz)
   */
  async function othersOnSite(): Promise<SiteMenuItem[]> {
    const rows = await db
      .select({ id: s.products.siteMenuId, slot: s.products.siteMenuSlot, price: s.products.price, active: s.products.active, showOnMenu: s.products.showOnMenu })
      .from(s.products)
      .where(isNotNull(s.products.siteMenuId));
    const items = new Map<string, SiteMenuItem>();
    const hasM = new Set<string>();
    for (const r of rows) {
      if (!r.id || site.has(r.id) || !SITE_MENU_ID.test(r.id)) continue;
      const it = items.get(r.id) ?? siteItem(r.id, r.id, { priceMinor: 0, isActive: r.active && r.showOnMenu, updatedAt: "2026-01-01T00:00:00.000Z" });
      if (r.slot === "L") it.priceMinorL = Math.round(r.price * 100);
      else {
        it.priceMinor = Math.round(r.price * 100);
        hasM.add(r.id);
      }
      items.set(r.id, it);
    }
    // Yalnız L'si bağlı kalemin M fiyatı boş kalmasın
    return [...items.values()].map((i) => (hasM.has(i.id) ? i : { ...i, priceMinor: i.priceMinorL || 100 }));
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
  /** Kalemin kilidini (sold-out-core › withItemLock) bekleyen bir bağlantı olana dek */
  async function waitForItemLock(id: string) {
    const until = Date.now() + 5_000;
    for (;;) {
      const rows = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and objsubid = 1 and objid::bigint = (hashtext(${`tukendi:${id}`})::bigint & 4294967295)`,
      );
      if (rows[0]?.n) return;
      if (Date.now() > until) throw new Error("kalemin kilidini bekleyen yok");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
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
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    // Eylemlerin sayfa yenilemesi ve oturumu (yönetici Ali) taklit edilir
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => users.ali, requireUser: async () => users.ali });
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL_!, 4);
    closeDb = () => dbModule.getDb().$client.end();
    core = await import("../src/server/site-menu/sold-out-core");
    push = await import("../src/server/site-menu/push");
    sync = await import("../src/server/site-menu/sync");
    actions = await import("../src/server/actions/products");
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
    // Siteye bağlı olmayan ürün: fiyatı yalnız panelde
    const [lemonade] = await db.insert(s.products).values({ categoryId, name: `Limonata ${tag}`, size: "Tek", price: 120 }).returning({ id: s.products.id });
    productIds.push(lemonade.id);
    prod.lemonade = lemonade.id;
  });

  beforeEach(async () => {
    // Her test temiz bir siteyle ve kopyayla başlar
    site.clear();
    site.set(ids.tira, siteItem(ids.tira, "Tiramisu"));
    site.set(ids.latte, siteItem(ids.latte, "Buzlu Caffè Latte", { priceMinorL: 21_000, categoryLabel: "Kahveler" }));
    site.set(ids.cake, siteItem(ids.cake, "Cheesecake"));
    site.set(ids.brownie, siteItem(ids.brownie, "Brownie"));
    posts = [];
    calls = [];
    Object.assign(mode, { announce: false, honor: false, rejectExpect: false, post: "ok" });
    await db.delete(s.integrationState).where(inArray(s.integrationState.key, MENU_KEYS));
    await db.update(s.products).set({ price: 120 }).where(eq(s.products.id, prod.lemonade));
    await db.delete(s.productPrices).where(inArray(s.productPrices.productId, productIds));
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

  test("sahip sitede az önce (5 sn içinde) kapattı, kopya eski: canlı damga aynı kalır, kayıt yazılmaz; personel açamaz", async () => {
    // Sahip iki saniye önce sitede kapattı (ping henüz gelmedi): sitenin "değişmedi" yanıtı onun yeni damgasıyla döner
    ownerEdit(ids.tira, { isActive: false }, 2_000);
    const r = await set(users.ayse, ids.tira, true);
    assert.equal(r.changed, false);
    assert.equal(r.message, `Tiramisu ${tag} zaten tükendi (sitede kapatılmış; yönetici açar)`);
    assert.equal((await record()).items[ids.tira], undefined, "kayıt yok");
    assert.equal((await productRow(prod.tira)).showOnMenu, false);
    await forgetToggles();
    await refused(set(users.mehmet, ids.tira, false), SOLD_OUT_TEXT.adminClosed);
    const log = await db.select().from(s.activityLog).where(and(eq(s.activityLog.userId, users.ayse.id), eq(s.activityLog.action, "Tükendi")));
    assert.equal(log.length, 0);
  });

  test("Kapalı tut, personelin Satışa aç'ı canlı listeyi beklerken: sırayla koşar, kalem yeniden kapanır", async () => {
    await set(users.ayse, ids.cake, true);
    await forgetToggles();
    posts = [];
    const gate = pauseNextGet();
    const open = set(users.mehmet, ids.cake, false);
    await gate.reached;
    const hold = core.holdSoldOutCore(users.ali, { siteMenuId: ids.cake });
    // Yönetici kalemin kilidinde bekler (eskiden kaydı düşürüp "kapalı tutuluyor" derdi, açma ardından yine açardı)
    await waitForItemLock(ids.cake);
    gate.release();
    const [o, h] = await Promise.all([open, hold]);
    assert.equal(o.changed, true);
    assert.equal(h.message, `Cheesecake ${tag} kapalı tutuluyor; satışa yalnız yönetici açar`);
    assert.deepEqual(
      posts.map((p) => p.isActive),
      [true, false],
      "önce açıldı, Kapalı tut yeniden kapattı",
    );
    assert.equal(site.get(ids.cake)!.isActive, false);
    assert.equal((await record()).items[ids.cake], undefined);
    assert.equal((await productRow(prod.cake)).showOnMenu, false);
    await forgetToggles();
    await refused(set(users.mehmet, ids.cake, false), SOLD_OUT_TEXT.adminClosed);
  });

  test("Kapalı tut önce başladıysa personelin Satışa aç'ı onu bekler ve açamaz (kayıt kilit altında okunur)", async () => {
    await set(users.ayse, ids.brownie, true);
    await forgetToggles();
    posts = [];
    // Üçüncü bir bağlantı Tükenenler kaydını kilitler: Kapalı tut kalemin kilidini alır, kayıtta bekler
    const other = postgres(URL_!, { max: 1, prepare: false, onnotice: () => {} });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let holding!: (pid: number) => void;
    const held = new Promise<number>((r) => (holding = r));
    const blocker = other.begin(async (tx) => {
      const [me] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      await tx`select key from integration_state where key = ${SOLD_OUT_KEY} for update`;
      holding(me.pid);
      await gate;
    });
    try {
      const pid = await held;
      const hold = core.holdSoldOutCore(users.ali, { siteMenuId: ids.brownie });
      for (const until = Date.now() + 5_000; ; ) {
        const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`);
        if (rows[0]?.n) break;
        if (Date.now() > until) throw new Error("Kapalı tut kayıtta beklemiyor");
        await new Promise((r) => setTimeout(r, 20));
      }
      // Personel şimdi açmayı dener: eskiden kaydı kilitsiz okuyup (henüz duruyordu) siteye "açık" yazardı
      const open = set(users.mehmet, ids.brownie, false);
      await waitForItemLock(ids.brownie);
      release();
      await blocker;
      const [h, o] = await Promise.allSettled([hold, open]);
      assert.equal(h.status, "fulfilled");
      assert.equal(o.status, "rejected");
      assert.ok(o.status === "rejected" && o.reason instanceof UserError && o.reason.message === SOLD_OUT_TEXT.adminClosed, String(o.status === "rejected" && o.reason));
      assert.equal(posts.length, 0, "siteye açma gitmedi");
      assert.equal(site.get(ids.brownie)!.isActive, false);
      assert.equal((await record()).items[ids.brownie], undefined);
    } finally {
      release();
      await blocker.catch(() => {});
      await other.end();
    }
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

  // ------------------------------------------------ Reçete kartı ve fiyat hücresi (denetim E-11)

  const card = (key: "tira" | "lemonade", o: Partial<Parameters<typeof actions.saveRecipe>[0]> = {}): Parameters<typeof actions.saveRecipe>[0] => ({
    productId: prod[key],
    name: key === "tira" ? `Tiramisu ${tag}` : `Limonata ${tag}`,
    size: "Tek",
    categoryId,
    price: key === "tira" ? 180 : 120,
    fireOverride: null,
    note: null,
    active: true,
    showOnMenu: true,
    items: [],
    ...o,
  });
  /** Kartın açılırken gördükleri */
  const seen = (price: number) => ({ seenPrice: price, seenActive: true, seenShowOnMenu: true });
  const priceRows = async (id: number) =>
    (await db.select().from(s.productPrices).where(eq(s.productPrices.productId, id)).orderBy(s.productPrices.id)).map((p) => [p.source, p.priceBefore, p.price]);
  /** Sahip sitede fiyatı değiştirdi ve ping panele çekti (panel satırı ve kopya güncel) */
  async function ownerPriceSynced(id: string, minor: number) {
    ownerEdit(id, { priceMinor: minor });
    assert.equal((await sync.syncSiteMenu("manual")).status, "ok");
  }
  /** Site `writes.expect` duyurur ve uygular; panel bir çekmeyle öğrenir */
  async function siteWithExpect() {
    Object.assign(mode, { announce: true, honor: true });
    assert.equal((await sync.syncSiteMenu("manual")).status, "ok");
    assert.equal((await sync.readMenuSyncState()).writesExpect, true);
    posts = [];
  }

  test("reçete kartı: dokunulmayan fiyat sitede bu arada yazılanı geri almaz; siteye gidilmez, geçmişe elle kayıt düşmez", async () => {
    // 10:00 kart 180 ₺'de açıldı; 10:05 sahip sitede 190 yaptı, ping panele çekti
    await ownerPriceSynced(ids.tira, 19_000);
    assert.equal((await productRow(prod.tira)).price, 190);
    posts = [];
    // 10:10 yönetici fiyata dokunmadan reçeteyi (notu) kaydeder
    const r = await actions.saveRecipe(card("tira", { note: "Tarçın eklendi", ...seen(180) }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.data.price, 190);
    assert.deepEqual(r.data.priceKept, { seen: 180, now: 190 });
    assert.equal(r.data.site, null);
    assert.equal(posts.length, 0, "siteye eski fiyat gitmedi");
    assert.equal(site.get(ids.tira)!.priceMinor, 19_000);
    const row = await productRow(prod.tira);
    assert.equal(row.price, 190);
    assert.equal(row.note, "Tarçın eklendi", "reçete kaydedildi");
    assert.deepEqual(await priceRows(prod.tira), [["site", 180, 190]], "yalnız sitenin değişikliği; Kasaya işle'ye sahte kayıt yok");
  });

  test("reçete kartı: ping kaçmışken (panel 180, site 190) dokunulmayan fiyat siteye gitmez", async () => {
    ownerEdit(ids.tira, { priceMinor: 19_000 });
    const r = await actions.saveRecipe(card("tira", { note: "x", ...seen(180) }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(posts.length, 0);
    assert.equal(site.get(ids.tira)!.priceMinor, 19_000, "sitenin fiyatı kalır; sonraki çekme paneli düzeltir");
    assert.equal(r.data.priceKept, null);
  });

  test("reçete kartı: dokunulan fiyat, veritabanı aynıysa siteye gider ve geçmişe elle yazılır", async () => {
    const r = await actions.saveRecipe(card("tira", { price: 200, ...seen(180) }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.data.price, 200);
    assert.deepEqual(r.data.site, { price: true, visibility: false });
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0], { id: ids.tira, priceMinor: 20_000, actor: "Ali" }, "site expect duyurmadı: gövde bugünkü gibi");
    assert.equal(site.get(ids.tira)!.priceMinor, 20_000);
    assert.equal((await productRow(prod.tira)).price, 200);
    assert.deepEqual(await priceRows(prod.tira), [["manual", 180, 200]]);
  });

  test("reçete kartı: dokunulan fiyat ve veritabanı da değişti: hiçbir şey yazılmaz, siteye gidilmez, güncel fiyat söylenir", async () => {
    await ownerPriceSynced(ids.tira, 19_000);
    posts = [];
    const r = await actions.saveRecipe(card("tira", { price: 200, note: "yazılmamalı", ...seen(180) }));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, priceMovedText(190, 180));
    assert.equal(posts.length, 0);
    const row = await productRow(prod.tira);
    assert.equal(row.price, 190);
    assert.equal(row.note, null, "kart kaydedilmedi");
    // Aynı yeni fiyatı yazmak çakışma değil
    const same = await actions.saveRecipe(card("tira", { price: 190, ...seen(180) }));
    assert.ok(same.ok, JSON.stringify(same));
    assert.equal(posts.length, 0);
  });

  test("bağsız ürün: dokunulmayan fiyat toplu değişikliği geri almaz; dokunulan çakışırsa reddedilir; eski istemci bugünkü gibi", async () => {
    // Başka sekmede toplu Fiyatlar 120 → 130 yaptı
    await db.update(s.products).set({ price: 130 }).where(eq(s.products.id, prod.lemonade));
    const keep = await actions.saveRecipe(card("lemonade", { note: "buzlu", ...seen(120) }));
    assert.ok(keep.ok, JSON.stringify(keep));
    assert.equal((await productRow(prod.lemonade)).price, 130);
    assert.deepEqual(await priceRows(prod.lemonade), [], "yerelde fiyat yazılmadı");
    const clash = await actions.saveRecipe(card("lemonade", { price: 125, ...seen(120) }));
    assert.equal(!clash.ok && clash.error, priceMovedText(130, 120));
    assert.equal((await productRow(prod.lemonade)).price, 130);
    // Güncel fiyatı görerek dokunulan fiyat yazılır
    const write = await actions.saveRecipe(card("lemonade", { price: 135, ...seen(130) }));
    assert.ok(write.ok, JSON.stringify(write));
    assert.equal((await productRow(prod.lemonade)).price, 135);
    assert.deepEqual(await priceRows(prod.lemonade), [["manual", 130, 135]]);
    // Görüleni göndermeyen eski sekme: gönderdiği yazılır
    const old = await actions.saveRecipe(card("lemonade", { price: 140 }));
    assert.ok(old.ok, JSON.stringify(old));
    assert.equal((await productRow(prod.lemonade)).price, 140);
    assert.equal(posts.length, 0);
  });

  test("yerel fiyat yazımı koşullu: okumadan sonra fiyat değiştiyse ya da ürün siteye bağlandıysa yazılmaz", async () => {
    const write = await import("../src/server/prices/write");
    const stale = await productRow(prod.lemonade);
    await db.update(s.products).set({ price: 130 }).where(eq(s.products.id, prod.lemonade));
    await refused(write.writeSalePrice(users.ali, stale, 150, { source: "manual", consequence: "fiyat değişmedi" }), priceChangedText(130));
    assert.equal((await productRow(prod.lemonade)).price, 130);
    // Ürün bu arada siteye bağlandı: yerel yazım siteyi atlamaz
    const unlinked = await productRow(prod.lemonade);
    await db.update(s.products).set({ siteMenuId: `tk-baska-${tag}`, siteMenuSlot: "M" }).where(eq(s.products.id, prod.lemonade));
    try {
      await assert.rejects(write.writeSalePrice(users.ali, unlinked, 150, { source: "manual", consequence: "fiyat değişmedi" }), write.PriceChangedError);
      assert.equal((await productRow(prod.lemonade)).price, 130);
    } finally {
      await db.update(s.products).set({ siteMenuId: null, siteMenuSlot: null }).where(eq(s.products.id, prod.lemonade));
    }
    assert.deepEqual(await priceRows(prod.lemonade), []);
  });

  test("reçete kartı: ürün kart kaydedilirken siteye bağlandıysa satış alanı yalnız panele yazılmaz (site ile ayrışmaz)", { timeout: 15_000 }, async () => {
    const linkId = `tk-limon-${tag}`;
    await db.update(s.products).set({ note: null }).where(eq(s.products.id, prod.lemonade));
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let linked!: () => void;
    const linkedNow = new Promise<void>((r) => (linked = r));
    // Site menüsünden bağlama (ayrı işlem): satırı kilitler, kart yazımı onu bekler; bağlama bitince kartın koşulu yeni satırda denetlenir
    const linking = db.transaction(async (tx) => {
      await tx.update(s.products).set({ siteMenuId: linkId, siteMenuSlot: "M" }).where(eq(s.products.id, prod.lemonade));
      linked();
      await hold;
    });
    try {
      await linkedNow;
      const save = actions.saveRecipe(card("lemonade", { price: 125, note: "yazılmamalı", ...seen(120) }));
      // Kartın yerel yazımı bağlamanın kilidini bekleyene dek (önce okuması bağsız ürünü görür, siteye gidilmez)
      const until = Date.now() + 5_000;
      for (;;) {
        const rows = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike ${'update "products"%'} and query ilike ${"%site_menu_id%is null%"}`,
        );
        if (rows[0]?.n) break;
        if (Date.now() > until) throw new Error("kartın yazımı bağlamayı beklemiyor");
        await new Promise((r) => setTimeout(r, 20));
      }
      release();
      await linking;
      const r = await save;
      assert.equal(!r.ok && r.error, LINK_CHANGED_TEXT);
      assert.equal(posts.length, 0);
      const row = await productRow(prod.lemonade);
      assert.equal(row.price, 120, "fiyat yalnız panele yazılmadı");
      assert.equal(row.note, null, "kart kaydedilmedi");
      assert.deepEqual(await priceRows(prod.lemonade), []);
      // Fiyata ve anahtarlara dokunmayan kayıt (yalnız reçete) bağlantıdan etkilenmez
      const recipeOnly = await actions.saveRecipe(card("lemonade", { note: "buzlu", ...seen(120) }));
      assert.ok(recipeOnly.ok, JSON.stringify(recipeOnly));
      assert.equal((await productRow(prod.lemonade)).note, "buzlu");
      assert.equal(posts.length, 0);
    } finally {
      release();
      await linking.catch(() => {});
      await db.update(s.products).set({ siteMenuId: null, siteMenuSlot: null, note: null }).where(eq(s.products.id, prod.lemonade));
    }
  });

  test("fiyat hücresi: gördüğü fiyat bu arada değiştiyse yazılmaz (güncel fiyat söylenir); güncel fiyatla yazılır", async () => {
    await ownerPriceSynced(ids.tira, 19_000);
    posts = [];
    const stale = await actions.updateProductPrice(prod.tira, 200, false, "manual", 180);
    assert.equal(!stale.ok && stale.error, priceRefusedText(190));
    assert.equal(posts.length, 0);
    const ok = await actions.updateProductPrice(prod.tira, 200, false, "manual", 190);
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.deepEqual(ok.data, { price: 200, site: true, posPending: true, kasa: "ModPOS" });
    assert.equal(site.get(ids.tira)!.priceMinor, 20_000);
    assert.deepEqual(await priceRows(prod.tira), [["site", 180, 190], ["manual", 190, 200]]);
    // Eski sekme görüleni göndermez: bugünkü gibi yazılır
    const old = await actions.updateProductPrice(prod.lemonade, 125);
    assert.ok(old.ok, JSON.stringify(old));
    assert.equal((await productRow(prod.lemonade)).price, 125);
  });

  test("expect: site duyurunca yazım kopyadaki değeri bekler; site bu arada değiştiyse 409 stale, panel siteyi okur, hiçbir şey yazılmaz", async () => {
    await siteWithExpect();
    // Sahip sitede 190 yaptı, ping kaçtı: panel ve kopya hâlâ 180
    ownerEdit(ids.tira, { priceMinor: 19_000 });
    const r = await actions.saveRecipe(card("tira", { price: 200, note: "yazılmamalı", ...seen(180) }));
    assert.equal(r.ok, false);
    assert.equal(
      !r.ok && r.error,
      "Bu ürün sitede bu arada değişti (sitede şimdi 190\u00a0₺); değişiklikler kaydedilmedi. Sitenin güncel değeri panele yüklendi: bakıp yeniden dene.",
    );
    assert.deepEqual(posts, [{ id: ids.tira, priceMinor: 20_000, actor: "Ali", expect: { priceMinor: 18_000 } }]);
    assert.equal(site.get(ids.tira)!.priceMinor, 19_000, "sahibin fiyatı ezilmedi");
    const row = await productRow(prod.tira);
    assert.equal(row.price, 190, "panel sitenin güncel fiyatını aldı");
    assert.equal(row.note, null);
    assert.deepEqual(await priceRows(prod.tira), [["site", 180, 190]]);
    // Kart güncel fiyatı görüp yeniden kaydeder: beklenen 190, yazılır
    posts = [];
    const again = await actions.saveRecipe(card("tira", { price: 200, ...seen(190) }));
    assert.ok(again.ok, JSON.stringify(again));
    assert.deepEqual(posts, [{ id: ids.tira, priceMinor: 20_000, actor: "Ali", expect: { priceMinor: 19_000 } }]);
    assert.equal(site.get(ids.tira)!.priceMinor, 20_000);
  });

  test("expect: Tükendi canlı kalemden bekler; 'zaten tükendi' yolu (değişmedi yanıtı) bozulmaz", async () => {
    await siteWithExpect();
    const r = await set(users.ayse, ids.latte, true);
    assert.equal(r.changed, true);
    assert.deepEqual(posts[0].expect, { isActive: true });
    assert.equal(site.get(ids.latte)!.isActive, false);
    // Sahip on dakika önce sitede kapattı, kopya "Satışta": değişmedi yanıtı, expect'e bakılmaz
    posts = [];
    ownerEdit(ids.tira, { isActive: false }, 10 * 60_000);
    const already = await set(users.mehmet, ids.tira, true);
    assert.equal(already.changed, false);
    assert.equal(already.message, `Tiramisu ${tag} zaten tükendi (sitede kapatılmış; yönetici açar)`);
    assert.deepEqual(posts[0].expect, { isActive: false }, "canlı listedeki değer");
  });

  test("expect: bayrağı duyuran site geri alındıysa (katı şema, 400 field body) bir kez expect'siz denenir, bayrak kapanır", async () => {
    await siteWithExpect();
    Object.assign(mode, { honor: false, rejectExpect: true });
    const r = await actions.updateProductPrice(prod.tira, 200, false, "manual", 180);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].expect, { priceMinor: 18_000 });
    assert.equal(posts[1].expect, undefined);
    assert.equal(site.get(ids.tira)!.priceMinor, 20_000);
    assert.equal((await productRow(prod.tira)).price, 200);
    assert.equal((await sync.readMenuSyncState()).writesExpect, false);
    // Sonraki yazım expect'siz tek istek (bir sonraki çekme bayrağı yeniden okuyana kadar)
    posts = [];
    const again = await actions.updateProductPrice(prod.tira, 210, false, "manual", 200);
    assert.ok(again.ok, JSON.stringify(again));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].expect, undefined);
    assert.equal(site.get(ids.tira)!.priceMinor, 21_000);
  });

  test("zaman aşımı: site yazmış olabilir; hata bunu söyler, panel siteyi hemen okur", async () => {
    mode.post = "timeout";
    const r = await actions.updateProductPrice(prod.tira, 200, false, "manual", 180);
    assert.equal(r.ok, false);
    assert.equal(
      !r.ok && r.error,
      "Siteye ulaşılamadı; değişiklik sitede yapılmış olabilir, panelde fiyat değişmedi. Site menüsünde kontrol et; panel siteyi hemen yeniden okuyor.",
    );
    assert.equal(site.get(ids.tira)!.priceMinor, 20_000, "site yazmıştı");
    // İstek dışında (test) çekme hemen ve beklenerek: panel sitenin yazdığını aldı
    assert.equal((await productRow(prod.tira)).price, 200);
    assert.deepEqual(await priceRows(prod.tira), [["site", 180, 200]]);
  });

  test("zaman aşımı işlemin içinde (Tükendi): kalemin kilidi tutulurken havuzdan ikinci bağlantıyla çekilmez", { timeout: 15_000 }, async () => {
    mode.post = "timeout";
    await refused(set(users.ayse, ids.tira, true), SOLD_OUT_TEXT.siteSlow);
    assert.equal(site.get(ids.tira)!.isActive, false, "site yazmıştı");
    const post = calls.indexOf("POST");
    assert.ok(post >= 0);
    assert.deepEqual(calls.slice(post + 1), [], "POST'tan sonra işlemin içinde GET yok (istek dışında after çalışmaz; sonraki çekme düzeltir)");
    assert.equal((await record()).items[ids.tira], undefined, "personelin kaydı yazılmadı");
    // İşlemin dışında sonraki çekme sitenin yazdığını alır
    assert.equal((await sync.syncSiteMenu("manual")).status, "ok");
    assert.equal((await productRow(prod.tira)).showOnMenu, false);
  });

  test("JSON olmayan 404 uç yok demek (site güncel değil); JSON not_found kalem yok demek", async () => {
    mode.post = "html404";
    const r = await actions.updateProductPrice(prod.tira, 200, false, "manual", 180);
    assert.equal(!r.ok && r.error, "Sitede panel menü ucu yok (laffogato.net güncel değil); fiyat değişmedi.");
    site.delete(ids.tira);
    const gone = await actions.updateProductPrice(prod.tira, 200, false, "manual", 180);
    assert.equal(!gone.ok && gone.error, "Bu ürünün bağlı olduğu kalem sitede yok; bağlantıyı kaldır ya da yeniden bağla.");
    assert.equal((await productRow(prod.tira)).price, 180);
  });

  test("site bağlantısı reddederse metnin sonunda 'Yöneticiye haber verin.'; kayıt ve panel değişmez", async () => {
    site.delete(ids.cake);
    await refused(set(users.ayse, ids.cake, true), /Yöneticiye haber verin\.$/);
    assert.equal((await productRow(prod.cake)).showOnMenu, true);
    assert.equal((await record()).items[ids.cake], undefined);
  });
});
