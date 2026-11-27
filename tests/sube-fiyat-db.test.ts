// Şube fiyatı (LM-5) gerçek Postgres'te ve sitenin sahte ucuyla (laffogato.net'e gidilmez; saf kısım
// tests/sube-fiyat.test.ts):
// - AsilPOS gün sonunun `lines[].listPrices`'ı pos_daily_sales.list_prices'a yazılır (eski AsilPOS: null)
// - menü çekmesi sitenin `branchPrices`'ını integration_state'e, `writes.branchPrice` duyurusunu duruma yazar
// - şube fiyatı yazımı yalnız duyuru varken: tek kalem (M ve L tek gövdede), 409 stale (kopya sitenin satırlarıyla
//   yenilenir), aynı yazımın yeniden gönderimi, anı gelmemiş satırın iptali, toplu yazım (kalem başına tek istek);
//   ürünün panel fiyatı ve satış fiyatı geçmişi değişmez
// - Eski fiyattan satılanlar: değişikliğin durumu ve eski fiyattan satış gün sonunun liste fiyatlarından
//
// SUBE_FIYAT_TEST_DATABASE_URL verilmezse atlanır (npm run test:db bağlar). Test kendi geçici veritabanını açar,
// migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_FIYAT_TEST_DATABASE_URL=postgres://ci:ci@localhost:5433/test npx tsx --test tests/sube-fiyat-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../src/lib/karaoke/signature";
import { parsePosDay } from "../src/lib/asilpos/day";
import type { SiteBranchPrice, SiteMenuItem } from "../src/lib/site-menu/schema";
import * as s from "../src/server/db/schema";

import { ASILPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.SUBE_FIYAT_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_fiyat_${process.pid}`;
const SECRET = "sube-fiyat-test-anahtari-gercek-degil-0123456789";
const SITE = "http://site.test";
const GOLDEN = () => readFileSync(join(process.cwd(), "tests/fixtures/asilpos-gun.golden.json"), "utf8");

describe("Şube fiyatı: veritabanında, sahte siteyle", { skip: !SERVER_URL && "SUBE_FIYAT_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let sync: typeof import("../src/server/site-menu/sync");
  let actions: typeof import("../src/server/actions/prices");
  let data: typeof import("../src/server/data/branch-prices");
  const realFetch = globalThis.fetch;
  const me = { id: 0, name: "Ali", role: "admin" as const };
  const ids = { latteM: 0, latteL: 0 };

  const item = (id: string, name: string, o: Partial<SiteMenuItem> = {}): SiteMenuItem => ({
    id,
    name,
    categoryKey: "sicak",
    categoryLabel: "Sıcak kahveler",
    priceMinor: 19_500,
    priceMinorL: 21_000,
    isActive: true,
    sortOrder: 1,
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...o,
  });
  const items = [item("mnu-0007", "Latte"), item("mnu-0058", "San Sebastian", { priceMinor: 29_000, priceMinorL: 0 }), item("mnu-0081", "Extra Shot", { priceMinor: 5_000, priceMinorL: 0 })];
  // Sitenin şube satırları (bellekte); anahtar kalem + şube + an
  let rows: SiteBranchPrice[] = [];
  let announce = true;
  const posts: Record<string, unknown>[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const rowsOf = (id: string, branch: string) => rows.filter((r) => r.id === id && r.branch === branch);

  async function fakeSite(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== SITE) return realFetch(input, init);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (!verifySignature(SECRET, { method, url, body, timestamp: headers[TIMESTAMP_HEADER] ?? null, signature: headers[SIGNATURE_HEADER] ?? null })) return json(401, { error: "unauthorized" });
    if (url.pathname !== "/api/panel/menu") return json(404, { error: "not_found" });
    if (method === "GET") {
      return json(200, {
        version: 1,
        now: new Date().toISOString(),
        branch: "tuzla",
        items,
        writes: announce ? { expect: true, branch: true, branchPrice: true } : { expect: true, branch: true },
        ...(announce ? { branchPrices: rows } : {}),
      });
    }
    const req = JSON.parse(body) as { id: string; branch: string; branchPrice: { priceMinor?: number | null; priceMinorL?: number; effectiveFrom: string; cancel?: boolean } };
    posts.push(req);
    const it = items.find((i) => i.id === req.id)!;
    const bp = req.branchPrice;
    const from = new Date(bp.effectiveFrom).toISOString();
    const answer = (status: number, extra: object = {}) => json(status, { ...extra, item: { ...it, basePriceMinor: it.priceMinor, basePriceMinorL: it.priceMinorL, priceFrom: null }, branchPrices: rowsOf(req.id, req.branch) });
    const held = rows.find((r) => r.id === req.id && r.branch === req.branch && r.effectiveFrom === from);
    if (bp.cancel) {
      if (!held || Date.parse(from) <= Date.now()) return answer(409, { error: "stale" });
      rows = rows.filter((r) => r !== held);
      return answer(200);
    }
    if (held) return held.priceMinor === bp.priceMinor && held.priceMinorL === bp.priceMinorL ? answer(200) : answer(409, { error: "stale" });
    rows.push({ id: req.id, branch: req.branch, priceMinor: bp.priceMinor ?? null, priceMinorL: bp.priceMinorL ?? 0, effectiveFrom: from, createdAt: new Date().toISOString() });
    return answer(200);
  }

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      AUTH_SECRET: "sube-fiyati-testi-icin-en-az-otuz-iki-karakterlik-anahtar",
      KARAOKE_SYNC_SECRET: SECRET,
      LAFFOGATO_URL: SITE,
    });
    globalThis.fetch = fakeSite as typeof fetch;
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
    await seedBranches(db);
    const [a] = await db.insert(s.users).values({ email: "ali@laffogato.net", name: me.name, passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    me.id = a.id;
    stub(require.resolve("../src/server/auth/dal"), { requireUser: async () => me, requireAdmin: async () => me });
    sync = await import("../src/server/site-menu/sync");
    actions = await import("../src/server/actions/prices");
    data = await import("../src/server/data/branch-prices");
    const [c] = await db.insert(s.categories).values({ name: "Sıcak kahveler", sortOrder: 1 }).returning({ id: s.categories.id });
    const made = await db
      .insert(s.products)
      .values([
        { categoryId: c.id, name: "Latte", size: "M", price: 195, sortOrder: 1, siteMenuId: "mnu-0007", siteMenuSlot: "M" },
        { categoryId: c.id, name: "Latte", size: "L", price: 210, sortOrder: 2, siteMenuId: "mnu-0007", siteMenuSlot: "L" },
      ])
      .returning({ id: s.products.id });
    [ids.latteM, ids.latteL] = made.map((m) => m.id);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const inDays = (d: number, hour = 5) => {
    const t = new Date(Date.now() + d * 86_400_000);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
    return `${day}T${String(hour).padStart(2, "0")}:00:00+03:00`;
  };
  const stored = async () => (await sync.readBranchPrices()).rows;
  const panelPrices = async () => (await db.select({ id: s.products.id, price: s.products.price }).from(s.products)).map((p) => p.price).sort();

  test("gün sonu: listPrices pos_daily_sales.list_prices'a yazılır; hizmet satırında null", async () => {
    const { storePosDay } = await import("../src/server/asilpos/ingest");
    const parsed = parsePosDay(GOLDEN(), new Date("2026-10-28T12:00:00+03:00"));
    assert.ok(parsed.ok);
    const r = await storePosDay(db, parsed.data, new Date("2026-10-28T12:00:00+03:00"));
    assert.ok(r.ok);
    const lines = await db
      .select({ posName: s.posDailySales.posName, listPrices: s.posDailySales.listPrices })
      .from(s.posDailySales)
      .where(and(eq(s.posDailySales.date, "2026-10-26"), eq(s.posDailySales.branchId, ASILPOS_SUBE)));
    const by = new Map(lines.map((l) => [l.posName, l.listPrices]));
    assert.deepEqual(by.get("LATTE MEDIUM"), [{ price: 195, qty: 3 }]);
    assert.deepEqual(by.get("ALTERNATIF SÜT"), [{ price: 0, qty: 1 }, { price: 25, qty: 2 }]);
    assert.equal(by.get("KARAOKE ODASI"), null);
  });

  test("eski site: duyuru yokken şube fiyatı yazılmaz, siteye gidilmez", async () => {
    announce = false;
    const r = await sync.syncSiteMenu("manual");
    assert.equal(r.status, "ok");
    assert.equal((await sync.readMenuSyncState()).writesBranchPrice, false);
    assert.equal(await data.loadBranchBulk(), null, "Toplu değiştir'de Şube seçimi yok");
    const w = await actions.setBranchPrice({ branch: "marina", siteMenuId: "mnu-0007", effectiveFrom: inDays(1), M: 205 });
    assert.equal(w.ok, false);
    assert.match(w.ok ? "" : w.error, /henüz kabul etmiyor/);
    assert.equal(posts.length, 0);
  });

  test("çekme: branchPrices ve writes.branchPrice saklanır", async () => {
    announce = true;
    rows = [{ id: "mnu-0058", branch: "marina", priceMinor: 30_000, priceMinorL: 0, effectiveFrom: "2026-10-20T02:00:00.000Z", createdAt: "2026-10-19T10:00:00.000Z" }];
    const r = await sync.syncSiteMenu("manual");
    assert.ok(r.status === "ok" || r.status === "fresh", r.status);
    assert.equal((await sync.readMenuSyncState()).writesBranchPrice, true);
    assert.deepEqual(await stored(), rows);
    const bulk = await data.loadBranchBulk();
    assert.deepEqual(bulk?.branches, [{ id: "marina", name: "Marina" }]);
    assert.equal(bulk?.items["mnu-0007"]?.priceMinor, 19_500);
  });

  test("tek kalem: M ve L tek gövdede; kopya sitenin yanıtıyla yenilenir; panel fiyatı ve geçmiş değişmez", async () => {
    const at = inDays(2);
    const w = await actions.setBranchPrice({ branch: "marina", siteMenuId: "mnu-0007", effectiveFrom: at, M: 205, L: 225 });
    assert.ok(w.ok, w.ok ? "" : w.error);
    assert.deepEqual(posts.at(-1), { id: "mnu-0007", branch: "marina", actor: "Ali", branchPrice: { priceMinor: 20_500, priceMinorL: 22_500, effectiveFrom: at } });
    assert.deepEqual(
      (await stored()).filter((r) => r.id === "mnu-0007").map((r) => [r.priceMinor, r.priceMinorL, r.effectiveFrom]),
      [[20_500, 22_500, new Date(at).toISOString()]],
    );
    assert.deepEqual(await panelPrices(), [195, 210]);
    assert.equal((await db.select().from(s.productPrices)).length, 0, "taban fiyatın geçmişine girmez");
    // Aynı yazımın yeniden gönderimi: site satırı yazmış, ilk yanıt yolda kalmış (panelin kopyasında yok). Site aynı
    // gövdeyle 200 verir, ikinci satır yazmaz; kopya sitenin satırlarını alır
    const at3 = inDays(3);
    rows.push({ id: "mnu-0007", branch: "marina", priceMinor: 20_700, priceMinorL: 22_500, effectiveFrom: new Date(at3).toISOString(), createdAt: new Date().toISOString() });
    const again = await actions.setBranchPrice({ branch: "marina", siteMenuId: "mnu-0007", effectiveFrom: at3, M: 207 });
    assert.ok(again.ok, again.ok ? "" : again.error);
    assert.deepEqual((posts.at(-1) as { branchPrice: unknown }).branchPrice, { priceMinor: 20_700, priceMinorL: 22_500, effectiveFrom: at3 }, "değişmeyen L şubenin kendi L'siyle");
    assert.equal(rows.filter((r) => r.effectiveFrom === new Date(at3).toISOString()).length, 1);
    assert.equal((await stored()).filter((r) => r.id === "mnu-0007").length, 2);
    // Şubenin o andaki fiyatı zaten buysa siteye gidilmez
    const n = posts.length;
    const same = await actions.setBranchPrice({ branch: "marina", siteMenuId: "mnu-0007", effectiveFrom: at3, M: 207 });
    assert.match(same.ok ? "" : same.error, /zaten bu/);
    assert.equal(posts.length, n);
  });

  test("409 stale: aynı anda başka fiyat; kopya sitenin satırlarıyla yenilenir", async () => {
    const at = inDays(4);
    rows.push({ id: "mnu-0007", branch: "marina", priceMinor: 21_500, priceMinorL: 0, effectiveFrom: new Date(at).toISOString(), createdAt: new Date().toISOString() });
    const w = await actions.setBranchPrice({ branch: "marina", siteMenuId: "mnu-0007", effectiveFrom: at, M: 199 });
    assert.equal(w.ok, false);
    assert.match(w.ok ? "" : w.error, /aynı anda başka bir fiyatı var/);
    assert.ok((await stored()).some((r) => r.id === "mnu-0007" && r.priceMinor === 21_500), "sitenin satırı kopyada");
  });

  test("iptal: anı gelmemiş satır geri alınır; Tuzla ve seçenek reddedilir", async () => {
    const at = inDays(4);
    const c = await actions.cancelBranchPriceRow({ branch: "marina", siteMenuId: "mnu-0007", effectiveFrom: new Date(at).toISOString() });
    assert.ok(c.ok, c.ok ? "" : c.error);
    assert.deepEqual((posts.at(-1) as { branchPrice: unknown }).branchPrice, { effectiveFrom: new Date(at).toISOString(), cancel: true });
    assert.ok(!(await stored()).some((r) => r.priceMinor === 21_500));
    const home = await actions.setBranchPrice({ branch: "tuzla", siteMenuId: "mnu-0007", effectiveFrom: inDays(1), M: 205 });
    assert.equal(home.ok, false);
    const option = await actions.setBranchPrice({ branch: "marina", siteMenuId: "mnu-0081", effectiveFrom: inDays(1), M: 60 });
    assert.match(option.ok ? "" : option.error, /Seçenek/);
  });

  test("toplu: bir kalemin M ve L'si tek istek; bugünkü fiyat önizlemedekinden farklıysa yazılmaz", async () => {
    const before = posts.length;
    const at = inDays(10);
    const r = await actions.applyBranchPrices({
      branch: "marina",
      effectiveFrom: at,
      note: "+10 ₺",
      items: [
        { productId: ids.latteM, from: 207, to: 215 },
        { productId: ids.latteL, from: 225, to: 235 },
      ],
    });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(r.ok && r.data.applied.length, 2);
    assert.equal(posts.length, before + 1, "kalem başına tek istek");
    assert.deepEqual((posts.at(-1) as { branchPrice: unknown }).branchPrice, { priceMinor: 21_500, priceMinorL: 23_500, effectiveFrom: at });
    const stale = await actions.applyBranchPrices({ branch: "marina", effectiveFrom: inDays(11), note: "x", items: [{ productId: ids.latteM, from: 999, to: 1000 }] });
    assert.ok(stale.ok);
    assert.match(stale.ok ? stale.data.failed[0].reason : "", /değişti/);
    assert.deepEqual(await panelPrices(), [195, 210]);
  });

  test("Eski fiyattan satılanlar: durum ve eski fiyattan satış gün sonunun liste fiyatından", async () => {
    // 26 Eki 05:00'ten Marina latte M 205: o günün gün sonunda 3 latte 195'ten
    rows.push({ id: "mnu-0007", branch: "marina", priceMinor: 20_500, priceMinorL: 0, effectiveFrom: "2026-10-26T02:00:00.000Z", createdAt: "2026-10-25T10:00:00.000Z" });
    await sync.syncSiteMenu("manual");
    const report = await data.loadOldPriceReport("marina", new Date("2026-10-28T12:00:00+03:00"));
    const change = report.changes.find((c) => c.siteMenuId === "mnu-0007" && c.effectiveFrom === "2026-10-26T02:00:00.000Z" && c.slot === "M");
    assert.deepEqual(change?.status, { kind: "uygulanmadi", day: "2026-10-26" });
    assert.deepEqual(
      report.sales.filter((x) => x.siteMenuId === "mnu-0007"),
      [{ date: "2026-10-26", siteMenuId: "mnu-0007", slot: "M", price: 195, qty: 3, expected: 205, loss: 30 }],
    );
    // San Sebastian 20 Eki'den 300; 26 Eki'de 290'dan: eski fiyat
    assert.ok(report.sales.some((x) => x.siteMenuId === "mnu-0058" && x.price === 290 && x.expected === 300));
    assert.equal(report.hasListPrices, true);
  });
});
