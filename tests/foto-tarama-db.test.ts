// Belge tarama gerçek Postgres'te (docs/FOTOGRAF.md › Belge tarama): POST /api/foto taranmış hâli ve asıl fotoğrafı
// ayrı dosya olarak saklar, tarama bilgisini satıra yazar; GET /api/foto/{id}?v=asil aynı görme kuralıyla verir (HEAD
// var mı diye bakar); iki dosya birlikte silinir (deletePhoto, sabah temizliği). Yapay zekânın köşe ipucu sahte
// istemciyle: ai_calls'a "tarama" olarak düşer, okuma sınırına sayılmaz, kendi günlük ve saatlik sınırı var. Canlı
// yapay zekâ ve gerçek depo yok (bellek sürücüsü).
//
// Kendi geçici veritabanını açar (FOTO_TARAMA_TEST_DATABASE_URL'in sunucusunda), sonunda siler. Değişken yoksa atlanır.
// Çalıştırma: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/lm_tarama npm run test:db -- tests/foto-tarama-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { NextRequest } from "next/server";
import postgres from "postgres";

import { businessDate } from "../src/lib/cash-report";
import { SCAN_HINT_DAILY_CAP, type ScanInfo } from "../src/lib/photo-scan";
import type { AiClient, AiMessage, CreateParams } from "../src/server/ai/run";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { memoryDriver, type PhotoDriver } from "../src/server/storage/drivers";

const SERVER_URL = process.env.FOTO_TARAMA_TEST_DATABASE_URL;
const DB_NAME = `laffogato_foto_tarama_${process.pid}`;
const ORIGIN = "http://panel.test";

/** Yalnız başlığı olan PNG: imza + IHDR (sunucu görseli çözmez, ölçüyü başlıktan okur) */
function png(width: number, height: number, fill = 0): Uint8Array {
  const b = new Uint8Array(64).fill(fill);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b.set([8, 2, 0, 0, 0], 24);
  return b;
}

/** Yalnız başlığı olan JPEG: SOI, APP0, SOF0 (ölçü), SOS */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff,
    width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9,
  ]);
}

const INFO: ScanInfo = {
  corners: [
    [210, 30],
    [790, 60],
    [770, 980],
    [190, 950],
  ],
  mode: "belge",
  method: "kagit",
  confidence: 0.91,
  rotate: 0,
  ai: false,
};

describe("Belge tarama: asıl fotoğraf, erişim, temizlik ve köşe ipucu (veritabanında)", { skip: !SERVER_URL && "FOTO_TARAMA_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let photos: typeof import("../src/server/storage/photos");
  let upload: typeof import("../src/app/api/foto/route");
  let one: typeof import("../src/app/api/foto/[id]/route");
  let kenar: typeof import("../src/app/api/foto/kenar/route");
  let hint: typeof import("../src/server/photo-read/scan-hint");
  let claude: typeof import("../src/server/ai/claude");
  let NextRequestCtor: typeof NextRequest;
  let driver: ReturnType<typeof memoryDriver>;
  let who: { id: number; name: string; email: string; role: "admin" | "staff" } | null = null;
  const users = { ali: 0, ayse: 0, mehmet: 0 };
  const DAY = businessDate();

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    // Anahtar yalnız "yapay zekâ kurulu" kapısı için; istekler sahte istemciye gider
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "foto-tarama-testi-icin-en-az-otuz-iki-karakterlik-anahtar", ANTHROPIC_API_KEY: "test-anahtari" });
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const nextServer = require("next/server") as typeof import("next/server");
    NextRequestCtor = nextServer.NextRequest;
    stub("next/server", { ...nextServer, connection: async () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const rows = await db
      .insert(s.users)
      .values([
        { email: "tarama-ali@ornek.com", name: "Ali", passwordHash: "x", role: "admin" },
        { email: "tarama-ayse@ornek.com", name: "Ayşe", passwordHash: "x", role: "staff" },
        { email: "tarama-mehmet@ornek.com", name: "Mehmet", passwordHash: "x", role: "staff" },
      ])
      .returning({ id: s.users.id });
    [users.ali, users.ayse, users.mehmet] = rows.map((r) => r.id);
    const me = async () => who;
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    photos = await import("../src/server/storage/photos");
    upload = await import("../src/app/api/foto/route");
    one = await import("../src/app/api/foto/[id]/route");
    kenar = await import("../src/app/api/foto/kenar/route");
    hint = await import("../src/server/photo-read/scan-hint");
    claude = await import("../src/server/ai/claude");
  });

  after(async () => {
    photos?.__setPhotoDriverForTests(undefined);
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE photos, ai_calls, integration_state RESTART IDENTITY CASCADE`);
    driver = memoryDriver();
    photos.__setPhotoDriverForTests(driver);
    who = null;
  });

  const as = (name: keyof typeof users) => {
    who = { id: users[name], name, email: `tarama-${name}@ornek.com`, role: name === "ali" ? "admin" : "staff" };
  };

  const req = (path: string, init: { method?: string; body?: FormData; headers?: Record<string, string> } = {}) =>
    new NextRequestCtor(`${ORIGIN}${path}`, { method: init.method ?? "GET", body: init.body, headers: { origin: ORIGIN, host: "panel.test", ...init.headers } });

  const form = (o: { dosya?: Uint8Array; asil?: Uint8Array; tarama?: string; tur?: string; gun?: string }) => {
    const f = new FormData();
    if (o.dosya) f.append("dosya", new Blob([new Uint8Array(o.dosya)]), "foto.jpg");
    if (o.asil) f.append("asil", new Blob([new Uint8Array(o.asil)]), "asil.jpg");
    if (o.tarama !== undefined) f.append("tarama", o.tarama);
    f.append("tur", o.tur ?? "fis");
    f.append("gun", o.gun ?? DAY);
    return f;
  };

  const post = async (o: Parameters<typeof form>[0]) => {
    const res = await upload.POST(req("/api/foto", { method: "POST", body: form(o) }));
    return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string; photo?: { id: number; original: boolean } } };
  };

  const get = (id: number, q = "", headers: Record<string, string> = {}) => one.GET(req(`/api/foto/${id}${q}`, { headers }), { params: Promise.resolve({ id: String(id) }) });
  const head = (id: number, q = "") => one.HEAD(req(`/api/foto/${id}${q}`, { method: "HEAD" }), { params: Promise.resolve({ id: String(id) }) });
  const row = async (id: number) => (await db.select().from(s.photos).where(eq(s.photos.id, id)))[0];

  test("taranmış hâl ve asıl fotoğraf ayrı dosya; tarama bilgisi satırda; iki hâl de aynı yetkili yoldan", async () => {
    as("ali");
    const scanned = jpeg(900, 2400);
    const original = png(1350, 1800, 7);
    const r = await post({ dosya: scanned, asil: original, tarama: JSON.stringify(INFO) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.photo?.original, true);
    const id = r.body.photo!.id;
    const p = await row(id);
    assert.ok(p.originalKey && p.originalKey !== p.storageKey, "ayrı anahtar");
    assert.match(p.originalKey!, /^fis\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    assert.equal(p.originalSize, original.length);
    assert.equal(p.sizeBytes, scanned.length);
    assert.deepEqual([p.width, p.height], [900, 2400], "ölçü taranmış hâlin");
    assert.deepEqual(p.scan, INFO);
    assert.deepEqual(driver.keys().sort(), [p.storageKey, p.originalKey!].sort());

    const shown = await get(id);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(new Uint8Array(await shown.arrayBuffer()), scanned);
    const asil = await get(id, "?v=asil");
    assert.equal(asil.status, 200);
    assert.equal(asil.headers.get("content-type"), "image/png");
    assert.equal(asil.headers.get("cache-control"), "private, no-cache");
    assert.equal(asil.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.match(asil.headers.get("content-disposition") ?? "", /foto-\d+-asil\.png/);
    assert.deepEqual(new Uint8Array(await asil.arrayBuffer()), original);
    const tagA = asil.headers.get("etag")!;
    assert.notEqual(tagA, shown.headers.get("etag"), "iki hâlin ETag'i ayrı");
    assert.equal((await get(id, "?v=asil", { "if-none-match": tagA })).status, 304);
    assert.equal((await get(id, "", { "if-none-match": tagA })).status, 200, "asıl hâlin ETag'i taranmışı 304 yapmaz");
    const h = await head(id, "?v=asil");
    assert.equal(h.status, 200);
    assert.equal(await h.text(), "");
  });

  test("taranmadan yüklenen fotoğraf: asıl hâli yok (404); tarama bilgisi tutmazsa yok sayılır, fotoğraf yine saklanır", async () => {
    as("ali");
    const plain = await post({ dosya: jpeg(1600, 2200) });
    assert.equal(plain.status, 200);
    assert.equal(plain.body.photo?.original, false);
    const id = plain.body.photo!.id;
    assert.equal((await row(id)).originalKey, null);
    assert.equal((await head(id, "?v=asil")).status, 404);
    const g = await get(id, "?v=asil");
    assert.equal(g.status, 404);
    assert.equal(((await g.json()) as { error: string }).error, "Bu fotoğrafın taranmamış hâli yok.");
    assert.equal((await head(id)).status, 200);

    const bad = await post({ dosya: jpeg(800, 2000), asil: jpeg(1350, 1800), tarama: '{"corners":"yok"}' });
    assert.equal(bad.status, 200);
    assert.equal((await row(bad.body.photo!.id)).scan, null);
    assert.ok((await row(bad.body.photo!.id)).originalKey, "asıl fotoğraf yine saklandı");
    // Tarama bilgisi asıl fotoğrafsız gelirse yazılmaz
    const lone = await post({ dosya: jpeg(800, 2000), tarama: JSON.stringify(INFO) });
    assert.equal((await row(lone.body.photo!.id)).scan, null);
  });

  test("asıl fotoğraf da denetlenir: içerikten tür, ölçü, boyut; yalnız taranan türde; hata olursa hiçbir dosya kalmaz", async () => {
    as("ali");
    const pdf = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj\n");
    assert.equal((await post({ dosya: jpeg(800, 2000), asil: pdf })).status, 415);
    const tiny = await post({ dosya: jpeg(800, 2000), asil: png(120, 120) });
    assert.equal(tiny.status, 400);
    assert.equal(tiny.body.error, "Fotoğraf çok küçük ya da çok büyük; yeniden çekin.");
    const huge = new Uint8Array(2 * 1024 * 1024 + 10);
    huge.set(jpeg(1000, 1000));
    assert.equal((await post({ dosya: jpeg(800, 2000), asil: huge })).status, 413);
    // Kontrol listesinin fotoğrafı bu yoldan hiç yüklenmez; taranan tür değilse asıl fotoğraf reddedilir
    assert.equal((await post({ dosya: jpeg(800, 2000), asil: jpeg(1000, 1000), tur: "kontrol" })).status, 400);
    await assert.rejects(
      photos.savePhoto({ kind: "kontrol", bytes: jpeg(800, 800), contentType: "image/jpeg", userId: users.ali, original: { bytes: jpeg(900, 900), contentType: "image/jpeg" } }),
      /Bu fotoğraf türü taranmaz/,
    );
    assert.deepEqual(driver.keys(), []);
    assert.equal((await db.select().from(s.photos)).length, 0);

    // Asıl fotoğraf depoya yazılamadı: taranmış hâl de geri silinir, satır yazılmaz
    const failing: PhotoDriver = { ...driver, name: "memory", put: async (key, bytes, type) => (key.endsWith(".png") ? Promise.reject(new Error("depo dolu")) : driver.put(key, bytes, type)) };
    photos.__setPhotoDriverForTests(failing);
    const r = await post({ dosya: jpeg(800, 2000), asil: png(1350, 1800) });
    assert.equal(r.status, 500);
    assert.deepEqual(driver.keys(), []);
    assert.equal((await db.select().from(s.photos)).length, 0);
  });

  test("erişim: asıl hâl aynı kuralla; yükleyen personel kendi bağlanmamış fotoğrafını görür, başka personel göremez", async () => {
    as("ayse");
    const r = await post({ dosya: jpeg(700, 2100), asil: jpeg(1350, 1800), tarama: JSON.stringify({ ...INFO, method: "elle" }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const id = r.body.photo!.id;
    assert.equal((await get(id, "?v=asil")).status, 200);
    assert.equal((await head(id, "?v=asil")).status, 200);
    as("mehmet");
    assert.equal((await get(id)).status, 403);
    assert.equal((await get(id, "?v=asil")).status, 403);
    assert.equal((await head(id, "?v=asil")).status, 403);
    who = null;
    assert.equal((await get(id, "?v=asil")).status, 401);
    as("ali");
    assert.equal((await get(id, "?v=asil")).status, 200);
    // Süresi dolan fotoğrafın iki hâli de açılmaz
    await db.update(s.photos).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.photos.id, id));
    assert.equal((await get(id, "?v=asil")).status, 404);
  });

  test("silme ve sabah temizliği iki dosyayı da siler; depo istatistiği asıl fotoğrafı da sayar", async () => {
    as("ali");
    const a = (await post({ dosya: jpeg(800, 2000), asil: jpeg(1350, 1800) })).body.photo!.id;
    const b = (await post({ dosya: jpeg(800, 2000), asil: png(1350, 1800) })).body.photo!.id;
    const c = (await post({ dosya: jpeg(800, 2000) })).body.photo!.id;
    assert.equal(driver.keys().length, 5);
    const stats = await photos.photoStorageStats();
    const all = await db.select().from(s.photos);
    assert.equal(stats.bytes, all.reduce((t, p) => t + p.sizeBytes + (p.originalSize ?? 0), 0));
    assert.ok(all.some((p) => p.originalSize), "asıl fotoğraf sayıldı");

    await photos.deletePhoto(a);
    assert.equal(driver.keys().length, 3);
    assert.equal(await row(a), undefined);

    await db.update(s.photos).set({ expiresAt: new Date(Date.now() - 60_000) });
    const out = await photos.cleanupPhotos();
    assert.deepEqual(out, { deleted: 2, failed: 0, off: false });
    assert.deepEqual(driver.keys(), []);
    assert.equal(await row(b), undefined);
    assert.equal(await row(c), undefined);
  });

  /** Sahte istemci: köşe ipucu döner, çağrılan modeller sırayla */
  const fakeClient = (answer: unknown, calls: CreateParams[]): AiClient => ({
    beta: {
      messages: {
        create: async (params: CreateParams): Promise<AiMessage> => {
          calls.push(params);
          return { model: params.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1_100, output_tokens: 80 }, _request_id: "req_tarama" };
        },
      },
    },
  });

  const corners = (a: number[][]) => a.map(([x, y]) => ({ x, y }));

  test("köşe ipucu: ucuz model, efor low; ai_calls'a 'tarama' düşer, fotoğraf okumasının sınırına sayılmaz", async () => {
    const calls: CreateParams[] = [];
    const answer = { document: true, top: "right", corners: corners([[120, 80], [880, 60], [900, 940], [100, 960]]) };
    const r = await hint.scanHintFor({ bytes: jpeg(768, 1024), userId: users.ayse, client: fakeClient(answer, calls) });
    assert.deepEqual(r, {
      ok: true,
      hint: {
        document: true,
        top: "right",
        corners: [
          [120, 80],
          [880, 60],
          [900, 940],
          [100, 960],
        ],
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "claude-haiku-5-5");
    assert.equal((calls[0].output_config as { effort?: string }).effort, "low");
    const [c] = await db.select().from(s.aiCalls);
    assert.deepEqual([c.feature, c.model, c.effort, c.status, c.userId, c.photoId], ["tarama", "claude-haiku-5-5", "low", "ok", users.ayse, null]);
    assert.ok(c.costUsd > 0, "maliyet yazıldı");
    assert.equal((await claude.aiStatus()).usedToday, 0, "fotoğraf okumasının günlük sınırına sayılmaz");

    // Ayarlar › Fotoğraftan okuma › ilk okuma modeli değişirse köşe ipucu da onu kullanır
    await claude.saveAiSettings({ photoModels: { cheap: "claude-opus-5-5", strong: "claude-opus-5-5" } });
    await hint.scanHintFor({ bytes: jpeg(768, 1024), userId: users.ayse, client: fakeClient(answer, calls) });
    assert.equal(calls[1].model, "claude-opus-5-5");
  });

  test("köşe ipucu: kendi günlük sınırı, kişi başına saatte 30, okuma kapalıyken istek gitmez; görüntü denetlenir", async () => {
    const calls: CreateParams[] = [];
    const client = fakeClient({ document: false, top: "up", corners: null }, calls);
    assert.deepEqual(await hint.scanHintFor({ bytes: png(768, 1024), userId: users.ali, client }), { ok: false, status: 400, error: "Yalnız JPEG." });
    assert.equal((await hint.scanHintFor({ bytes: jpeg(2000, 1500), userId: users.ali, client })).ok, false, "1024 px'ten büyük");
    // Okuma kapalı: istek gitmez
    await claude.saveAiSettings({ enabled: false });
    assert.deepEqual(await hint.scanHintFor({ bytes: jpeg(768, 1024), userId: users.ali, client }), { ok: false, status: 503, error: "off" });
    await claude.saveAiSettings({ enabled: true, dailyCap: 1 });
    // Fotoğraf okumasının sınırı (1) dolu olsa da köşe ipucu sorulur (kendi havuzu)
    await db.insert(s.aiCalls).values({ feature: "kasa-z", model: "claude-opus-5-5", status: "ok", userId: users.ali });
    assert.equal((await claude.aiStatus()).state, "cap");
    assert.equal((await hint.scanHintFor({ bytes: jpeg(768, 1024), userId: users.ali, client })).ok, true);
    // Kişi başına saatte 30
    await db.insert(s.aiCalls).values(Array.from({ length: 29 }, () => ({ feature: "tarama", model: "claude-haiku-5-5", status: "ok" as const, userId: users.mehmet })));
    assert.equal((await hint.scanHintFor({ bytes: jpeg(768, 1024), userId: users.mehmet, client })).ok, true);
    assert.deepEqual(await hint.scanHintFor({ bytes: jpeg(768, 1024), userId: users.mehmet, client }), { ok: false, status: 429, error: "Kısa sürede çok soruldu." });
    // Günlük sınır (herkes birlikte)
    const used = (await db.select().from(s.aiCalls).where(eq(s.aiCalls.feature, "tarama"))).length;
    await db.insert(s.aiCalls).values(Array.from({ length: SCAN_HINT_DAILY_CAP - used }, () => ({ feature: "tarama", model: "claude-haiku-5-5", status: "ok" as const, userId: null })));
    const before = calls.length;
    assert.deepEqual(await hint.scanHintFor({ bytes: jpeg(768, 1024), userId: users.ayse, client }), { ok: false, status: 503, error: "cap" });
    assert.equal(calls.length, before, "sınır dolunca istek gitmez");
  });

  test("POST /api/foto/kenar: giriş ve köken denetimi, yalnız küçük JPEG", async () => {
    const f = (bytes: Uint8Array) => {
      const fd = new FormData();
      fd.append("dosya", new Blob([new Uint8Array(bytes)]), "kenar.jpg");
      return fd;
    };
    assert.equal((await kenar.POST(req("/api/foto/kenar", { method: "POST", body: f(jpeg(768, 1024)) }))).status, 401);
    as("ayse");
    assert.equal((await kenar.POST(req("/api/foto/kenar", { method: "POST", body: f(jpeg(768, 1024)), headers: { origin: "https://baska.site" } }))).status, 403);
    const res = await kenar.POST(req("/api/foto/kenar", { method: "POST", body: f(png(768, 1024)) }));
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { ok: boolean }).ok, false);
    assert.equal((await db.select().from(s.aiCalls)).length, 0, "denetime takılan istek yapay zekâya gitmez");
  });
});
