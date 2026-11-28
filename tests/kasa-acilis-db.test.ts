// Kasa açılışı, gerçek Postgres'te (docs/ASILPOS.md › Kasa açılışı; src/server/asilpos/acilis.ts): uçlar gerçek yol
// işleyicileriyle (src/server/asilpos/acilis-route.ts, kurulum kodu src/server/asilpos/kurulum-route.ts), eylemler
// gerçek oturumla (çerezler ve istek başlıkları taklit edilerek).
// - Giriş: yanlış parola 401 ve kayıtsız e-postayla aynı söz; beşinci hatada kilit (429, işlem geçmişinde); asıl olmayan
//   yönetici 403; iki adımlı (kodsuz ikiAdim, yanlış kod 401, doğru kod geçer, aynı kod ikinci kez geçmez).
// - Bağla: süresi geçmiş, başka amaçlı ya da başka kasanın belirteci 401; kapalı ve hazırlanmamış ModPOS şubesi 409;
//   kurulu şube her zaman 409 `zaten_kurulu` ve anahtar aynı (önce / sonra eşit, eski imza hâlâ geçer), `devral` yok
//   sayılır; aynı kasa (kimlik ya da şubenin anahtarıyla imza) yineleyebilir; eski deneme günlü Tuzla "boş"; yanıtın
//   biçimi kurulum koduyla aynı.
// - İlk personel: kayıtta düz PIN yok; açık anahtarsız istekte gönderilmez; açık anahtarla şifreli gider, kasa çözer;
//   teslim onayından sonra mühür silinir; yedek dışı; kurulum kodu yolunda da (eski kasanın yanıtı birebir aynı).
// - Kasayı serbest bırak: asıl yönetici, ad ve parola; eski anahtar 401, kayıt "boş", bekleyen kod iptal, yeni bağlama
//   çalışır.
// - Parola, belirteç ve PIN hiçbir işlem geçmişi satırında ve integration_state kaydında yok. Marina (kayıtsız, ortamdaki
//   anahtar, yakın tarihli gün) kurulu çıkar; anahtarı bütün senaryolardan sonra baştakiyle aynı.
//
// KASA_ACILIS_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, göçleri uygular, sonunda siler.
// Çalıştırma: TEST_DATABASE_URL=postgres://localhost/<boş db> npm run test:db -- tests/kasa-acilis-db.test.ts

import assert from "node:assert/strict";
import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, like, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { NextRequest } from "next/server";
import postgres from "postgres";

import { ASILPOS_GROUP } from "../src/lib/branch-settings/groups";
import { yalnizAsilYonetici } from "../src/lib/asil-yonetici";
import { ENV_ONEKI } from "../src/lib/asilpos/env";
import { ESKI_ENV_ONEKI } from "../src/lib/asilpos/eski-adlar";
import { KURULU_NEDEN, OTURUM_DOLDU, YALNIZ_ASIL_ACAR } from "../src/lib/asilpos/kasa-acilis";
import { TABLE_RULES } from "../src/lib/backup/format";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { signedHeaders } from "../src/lib/karaoke/signature";
import { STEP_UP_REQUIRED } from "../src/lib/step-up";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.KASA_ACILIS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_kasa_acilis_${process.pid}`;
const SECRET = "kasa-acilis-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const ASIL = "asil@ornek.com";
/** Marina'nın kasasının anahtarı: canlıdaki gibi ortamda (eski tek kasalı kurulum) */
const MARINA_KEY = "marina-ortam-anahtari-0123456789-abcdefghijkl";
const TUZLA_KEY = "tuzla-eski-deneme-anahtari-0123456789-abcdefgh";
const PASSWORD = "Kasa-Acilis-Testi-4821";
const BASE = "https://ladmin.laffogato.net";
const PINS = { patron: "482915", mudur: "731864", kasiyer: "5927" };

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

/** Kasanın RSA-OAEP anahtar çifti (AsilPOS server/sync/kontrol.ts gibi: 2048 bit, açık anahtar SPKI DER base64) */
function kasaAnahtari() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const pub = publicKey.toString("base64");
  const coz = (b64: string) => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(b64, "base64")).toString("utf8");
  return { pub, coz };
}

type Key = "ana" | "ali" | "kilit";
const USERS: Record<Key, { name: string; email: string; role: "admin" }> = {
  ana: { name: "Asıl", email: ASIL, role: "admin" },
  ali: { name: "Ali", email: "ali@ornek.com", role: "admin" },
  kilit: { name: "Kilit", email: "kilit@ornek.com", role: "admin" },
};

describe("Kasa açılışı: veritabanında", { skip: !SERVER_URL && "KASA_ACILIS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let session: typeof import("../src/server/auth/session");
  let routes: typeof import("../src/server/asilpos/acilis-route");
  let kurulumRoute: typeof import("../src/server/asilpos/kurulum-route");
  let branches: typeof import("../src/server/actions/branches");
  let kasa: typeof import("../src/server/asilpos/kasa-durumu");
  let keys: typeof import("../src/server/asilpos/branch");
  let ilk: typeof import("../src/server/asilpos/ilk-personel");
  let totp: typeof import("../src/server/auth/totp");
  let jar = new Jar();
  let reqHeaders = new Headers();
  const ids = {} as Record<Key, number>;
  let marinaKeyAtStart: string | null = null;
  /** Testlerde üretilen belirteçler: hiçbir kayıtta geçmemeli */
  const belirtecler: string[] = [];
  let ipSeq = 0;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1", LADMIN_ANA_ADMIN: ASIL, ASILPOS_SYNC_SECRET: MARINA_KEY, APP_URL: BASE });
    delete process.env.RESEND_API_KEY;
    delete process.env.KARAOKE_SYNC_SECRET;
    // Uzaktan ve site bağlantıları ortamda olmasın: kasaya giden bağlantılar yalnız panelinkiler
    for (const k of Object.keys(process.env)) if ([ENV_ONEKI, ESKI_ENV_ONEKI].some((p) => k.startsWith(`${p}CLOUD_`) || k.startsWith(`${p}SITE_`))) delete process.env[k];
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => reqHeaders });
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
    const nextServer = require("next/server") as typeof import("next/server");
    stub("next/server", { ...nextServer, connection: async () => {}, after: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    // Bodrum: ModPOS, hazırlanmamış (kasada listelenmez); Kaş: AsilPOS ama kapalı; Fethiye: AsilPOS, boş, anahtarı yok
    await db.insert(s.branches).values([
      { id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", active: true, sortOrder: 4 },
      { id: "kas", name: "Kaş", kind: "fiziksel", posSource: "asilpos", active: false, sortOrder: 5 },
      { id: "fethiye", name: "Fethiye", kind: "fiziksel", posSource: "asilpos", active: true, sortOrder: 6 },
    ]);
    const { hashPassword } = await import("../src/server/auth/password");
    const hash = await hashPassword(PASSWORD);
    for (const k of Object.keys(USERS) as Key[]) {
      const [row] = await db.insert(s.users).values({ ...USERS[k], passwordHash: hash }).returning({ id: s.users.id });
      ids[k] = row.id;
    }
    dal = await import("../src/server/auth/dal");
    session = await import("../src/server/auth/session");
    routes = await import("../src/server/asilpos/acilis-route");
    kurulumRoute = await import("../src/server/asilpos/kurulum-route");
    branches = await import("../src/server/actions/branches");
    kasa = await import("../src/server/asilpos/kasa-durumu");
    keys = await import("../src/server/asilpos/branch");
    ilk = await import("../src/server/asilpos/ilk-personel");
    totp = await import("../src/server/auth/totp");
    // Marina canlıda: dün gün sonu geldi (kayıt yok, kurulum kodu yok; anahtar ortamda)
    const z = { zNo: 1, receipts: 1, zTotal: 100, cash: 100, card: 0, mealCard: 0, online: 0, other: 0, offRevenue: 0, discounts: 0, openingCash: 0, cashOut: 0, countedCash: null, handedOver: 0, cashDiff: null };
    await db.insert(s.posDayReports).values({ date: "2026-11-27", branchId: "marina", z, payments: [], ikram: [], source: "asilpos", receivedAt: new Date(Date.now() - 86_400_000) });
    // Tuzla: eski deneme kasasının anahtarı ve 60 gün önceki tek deneme günü (kurulu sayılmamalı)
    await db.transaction((tx) => import("../src/server/branch-settings").then((m) => m.putBranchSetting(tx, ASILPOS_GROUP, "tuzla", { secret: TUZLA_KEY }, "test")));
    await db.insert(s.posDayReports).values({ date: "2026-09-29", branchId: "tuzla", z, payments: [], ikram: [], source: "asilpos", receivedAt: new Date(Date.now() - 60 * 86_400_000) });
    keys.forgetPosKeys();
    marinaKeyAtStart = await keys.posKeyOf("marina", db);
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    reqHeaders = new Headers();
  });

  /** Bu tarayıcıda (yeni çerez kutusu) oturum; sunucu eylemi isteği */
  const signIn = async (k: Key) => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids[k]));
    await dal.startSession(u);
    reqHeaders = new Headers({ "next-action": "test" });
  };

  /** Uca istek: gövde JSON; `key` verilirse şubenin anahtarıyla imzalı; her çağrı ayrı IP (IP sınırı testleri bozmasın) */
  async function call(yol: "giris" | "bagla" | "teslim", body: unknown, o: { key?: string; ip?: string } = {}) {
    const url = new URL(`${BASE}/api/asilpos/acilis/${yol}`);
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? `10.0.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}` };
    if (o.key) Object.assign(headers, signedHeaders(o.key, "POST", url, raw));
    const req = new Request(url, { method: "POST", headers, body: raw }) as unknown as NextRequest;
    const handler = yol === "giris" ? routes.girisPOST : yol === "bagla" ? routes.baglaPOST : routes.teslimPOST;
    const res = await handler(req);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const redeem = async (body: unknown) => {
    const req = new Request(`${BASE}/api/asilpos/kurulum`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${ipSeq++ % 200}` }, body: JSON.stringify(body) }) as unknown as NextRequest;
    const res = await kurulumRoute.POST(req);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const giris = async (k: { kimlik: string; acikAnahtar?: string }, o: { eposta?: string; parola?: string; kod?: string; key?: string } = {}) => {
    const r = await call("giris", { eposta: o.eposta ?? ASIL, parola: o.parola ?? PASSWORD, ...(o.kod ? { kod: o.kod } : {}), kasa: { kimlik: k.kimlik, surum: "1.2.3", ...(k.acikAnahtar ? { acikAnahtar: k.acikAnahtar } : {}) } }, { key: o.key });
    if (typeof r.body.belirtec === "string") belirtecler.push(r.body.belirtec);
    return r;
  };
  const subeOf = (r: { body: Record<string, unknown> }, id: string) => (r.body.subeler as { id: string; secilebilir: boolean; buKasa: boolean; neden?: string; kasa: { durum: string } }[]).find((x) => x.id === id);
  const stateOf = async (key: string) => (await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, key)))[0]?.value as Record<string, unknown> | undefined;
  const KASA_A = { kimlik: "kasa-a-00000001" };
  const KASA_B = { kimlik: "kasa-b-00000002" };

  test("giriş: yanlış parola ve kayıtsız e-posta aynı söz (401); asıl olmayan yönetici 403; bozuk gövde 400", async () => {
    const wrong = await giris(KASA_A, { parola: "yanlis-parola" });
    assert.deepEqual([wrong.status, wrong.body.error, wrong.body.mesaj], [401, "hatali", "E-posta ya da parola hatalı"]);
    assert.equal(wrong.body.ikiAdim, undefined, "parola yanlışken iki adımlı söylenmez");
    const ghost = await giris(KASA_A, { eposta: "yok@ornek.com" });
    assert.deepEqual([ghost.status, ghost.body.mesaj], [401, wrong.body.mesaj]);
    const ali = await giris(KASA_A, { eposta: USERS.ali.email });
    assert.deepEqual([ali.status, ali.body.error, ali.body.mesaj], [403, "asil_yonetici_degil", YALNIZ_ASIL_ACAR]);
    assert.equal(ali.body.belirtec, undefined);
    assert.equal((await call("giris", { eposta: ASIL, parola: PASSWORD })).status, 400, "kasa kimliği yok");
    assert.equal((await call("giris", { eposta: ASIL, parola: PASSWORD, kasa: { kimlik: "kısa" } })).status, 400);
    // Asıl olmayanın doğru parolası sayılmaz (deneme geri verilir)
    assert.equal((await db.select().from(s.users).where(eq(s.users.id, ids.ali)))[0].failedLogins, 0);
  });

  test("giriş: beşinci hatada hesap kilitlenir (429, işlem geçmişine yazılır); kilitliyken doğru parola da geçmez", async () => {
    const ip = "10.200.0.1";
    for (let i = 1; i <= 4; i++) assert.equal((await call("giris", { eposta: USERS.kilit.email, parola: `yanlis-${i}`, kasa: KASA_A }, { ip })).status, 401, `deneme ${i}`);
    const fifth = await call("giris", { eposta: USERS.kilit.email, parola: "yanlis-5", kasa: KASA_A }, { ip });
    assert.equal(fifth.status, 429);
    assert.match(String(fifth.body.mesaj), /^Çok fazla hatalı deneme\. \d+ dakika sonra yeniden deneyin\.$/);
    const right = await call("giris", { eposta: USERS.kilit.email, parola: PASSWORD, kasa: KASA_A }, { ip: "10.200.0.2" });
    assert.equal(right.status, 429, "kilitliyken değerlendirilmez");
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids.kilit));
    assert.ok(u.lockedUntil && u.lockedUntil > new Date(), "kilit veritabanında");
    const logs = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Hesap kilitlendi"));
    assert.ok(logs.some((l) => l.detail?.startsWith(`${USERS.kilit.email}: kasa açılışının parolası, 5 hatalı deneme`)), JSON.stringify(logs.map((l) => l.detail)));
  });

  test("giriş: asıl yönetici geçer; belirteç 15 dakika, şubeler kurallara göre (Marina kayıtsız kurulu, eski deneme günlü Tuzla listede değil)", async () => {
    const r = await giris(KASA_A);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body).sort(), ["belirtec", "kisi", "ok", "subeler"]);
    assert.deepEqual(r.body.kisi, { ad: "Asıl" });
    const ids0 = (r.body.subeler as { id: string }[]).map((x) => x.id);
    // Açık + fiziksel + (hazırlanmış ya da AsilPOS): Marina ve Fethiye; Tuzla (ModPOS, hazırlanmamış), Bodrum, kapalı
    // Kaş ve online kanal yok
    assert.deepEqual(ids0, ["marina", "fethiye"]);
    assert.deepEqual(subeOf(r, "marina"), { id: "marina", ad: "Marina", kasa: { durum: "kurulu", sonGun: "2026-11-27" }, buKasa: false, secilebilir: false, neden: KURULU_NEDEN });
    assert.deepEqual(subeOf(r, "fethiye"), { id: "fethiye", ad: "Fethiye", kasa: { durum: "bos", sonGun: null }, buKasa: false, secilebilir: true });
    assert.equal(await stateOf("asilpos.kasa:marina"), undefined, "Marina'nın kaydı yok: eski ölçütle kurulu");
    const t = await session.verifyKasaAcilis(String(r.body.belirtec));
    assert.ok(t && t.kasa === KASA_A.kimlik && t.sub === String(ids.ana), "belirteç bu kasaya ve kişiye");
    assert.equal(await session.verifyKasaAcilis(String(r.body.belirtec), new Date(Date.now() + 16 * 60_000)), null, "15 dakika");
    assert.equal(await session.verifySession(String(r.body.belirtec)), null, "oturum yerine geçmez");
  });

  test("Bilgisayara kur Tuzla'yı hazırlar: kasa programı ModPOS kalsa da listede, eski tek deneme günü 'boş'", async () => {
    await signIn("ana");
    const r = await branches.sendBranchInstall({ id: "tuzla", email: "tuzla@ornek.com" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal((await db.select().from(s.branches).where(eq(s.branches.id, "tuzla")))[0].posSource, "modpos", "kasa programı değişmedi");
    assert.ok(await stateOf("asilpos.hazirlik:tuzla"), "hazırlık kaydı");
    const g = await giris(KASA_A);
    assert.deepEqual(subeOf(g, "tuzla"), { id: "tuzla", ad: "Tuzla", kasa: { durum: "bos", sonGun: null }, buKasa: false, secilebilir: true });
    // Kodu kullanılmadan bekleyen bağlantı: durum "bekliyor", kasada boş
    assert.equal((await kasa.loadKasaDurumu("tuzla", db)).durum, "bekliyor");
  });

  test("bağla: süresi geçmiş, başka amaçlı ya da başka kasanın belirteci 401; kapalı ve hazırlanmamış ModPOS şubesi 409", async () => {
    const sv = (await db.select().from(s.users).where(eq(s.users.id, ids.ana)))[0].sessionVersion;
    const old = await session.signKasaAcilis({ sub: String(ids.ana), sv, kasa: KASA_A.kimlik }, new Date(Date.now() - 16 * 60_000));
    const pending = await session.signPending({ sub: String(ids.ana), sv, next: "" });
    const sess = await session.signSession({ sub: String(ids.ana), name: "Asıl", role: "admin", sv });
    for (const belirtec of [old, pending, sess, "bozuk"]) {
      const r = await call("bagla", { belirtec, sube: "fethiye", kasa: KASA_A });
      assert.deepEqual([r.status, r.body.error, r.body.mesaj], [401, "oturum_doldu", OTURUM_DOLDU]);
    }
    const g = await giris(KASA_A);
    const other = await call("bagla", { belirtec: g.body.belirtec, sube: "fethiye", kasa: KASA_B });
    assert.equal(other.status, 401, "belirteç başka kasanın");
    const kapali = await call("bagla", { belirtec: g.body.belirtec, sube: "kas", kasa: KASA_A });
    assert.deepEqual([kapali.status, kapali.body.error], [409, "sube_kapali"]);
    const modpos = await call("bagla", { belirtec: g.body.belirtec, sube: "bodrum", kasa: KASA_A });
    assert.deepEqual([modpos.status, modpos.body.error], [409, "sube_hazir_degil"]);
    assert.match(String(modpos.body.mesaj), /Bilgisayara kur/);
    assert.equal((await call("bagla", { belirtec: g.body.belirtec, sube: "yok-boyle", kasa: KASA_A })).status, 404);
    assert.equal(await stateOf("asilpos.kasa:fethiye"), undefined, "hiçbir şey yazılmadı");
    // Oturum sürümü değişince (parola değişti, oturumlar kapatıldı) belirteç geçmez
    await db.update(s.users).set({ sessionVersion: sv + 1 }).where(eq(s.users.id, ids.ana));
    assert.equal((await call("bagla", { belirtec: g.body.belirtec, sube: "fethiye", kasa: KASA_A })).status, 401);
  });

  test("bağla: kurulu şube her zaman 409 zaten_kurulu, devral yok sayılır, anahtar aynı ve eski imza geçer (Marina)", async () => {
    const g = await giris(KASA_B);
    const before = await keys.posKeyOf("marina", db);
    const r = await call("bagla", { belirtec: g.body.belirtec, sube: "marina", devral: true, kasa: KASA_B });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { ok: false, error: "zaten_kurulu", mesaj: "Marina şubesinde kurulu bir kasa var. Bilgisayar değişecekse ladmin › Şube ekleme › Kasayı serbest bırak.", sube: { id: "marina", ad: "Marina" }, kasa: { sonGun: "2026-11-27" } });
    assert.ok(!JSON.stringify(r.body).includes(MARINA_KEY), "anahtar yok");
    keys.forgetPosKeys();
    assert.equal(await keys.posKeyOf("marina", db), before);
    assert.equal(before, MARINA_KEY);
    // Marina'nın kasası eski anahtarla imzalamaya devam eder: şubesi çözülür
    const url = new URL(`${BASE}/api/panel/pos/devir`);
    const h = signedHeaders(MARINA_KEY, "GET", url, "");
    const caller = await keys.resolvePosCaller({ method: "GET", url, body: "", timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, db);
    assert.equal(caller.branchId, "marina");
    assert.equal(await stateOf("asilpos.kasa:marina"), undefined, "Marina'ya kayıt yazılmadı");
  });

  test("bağla: boş şube bağlanır (yanıt kurulum koduyla aynı biçimde), aynı kasa yineleyebilir, başka kasa 409, şubenin anahtarıyla imzalı istek 'bu kasa'", async () => {
    const tuzlaKey = await keys.posKeyOf("tuzla", db);
    assert.equal(tuzlaKey, TUZLA_KEY);
    const g = await giris(KASA_A);
    const r = await call("bagla", { belirtec: g.body.belirtec, sube: "tuzla", kasa: { ...KASA_A, surum: "1.2.3" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body).sort(), ["baglanti", "ok", "sube"], "personel ayarlı değil: alan yok");
    assert.deepEqual(r.body.sube, { id: "tuzla", ad: "Tuzla" });
    assert.deepEqual(r.body.baglanti, { LAFMALIYET_URL: BASE, LAFMALIYET_SYNC_SECRET: TUZLA_KEY }, "şubenin anahtarı aynen");
    const kayit = await stateOf("asilpos.kasa:tuzla");
    assert.equal(kayit?.durum, "kurulu");
    assert.deepEqual([kayit?.kimlik, kayit?.surum, kayit?.yol, kayit?.by], [KASA_A.kimlik, "1.2.3", "acilis", "Asıl"]);
    assert.equal((await kasa.loadKasaDurumu("tuzla", db)).durum, "kurulu");
    const logs = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Kasa şubeye bağlandı"));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].branchId, "tuzla");
    // Aynı kasa yineleyebilir: aynı anahtar, yeni işlem geçmişi satırı yok
    const again = await call("bagla", { belirtec: g.body.belirtec, sube: "tuzla", kasa: KASA_A });
    assert.deepEqual([again.status, again.body], [200, r.body]);
    assert.equal((await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Kasa şubeye bağlandı"))).length, 1);
    // Girişte Tuzla bu kasa için seçilebilir ("bu kasa"), başka kasa için değil
    assert.deepEqual([subeOf(await giris(KASA_A), "tuzla")?.buKasa, subeOf(await giris(KASA_A), "tuzla")?.secilebilir], [true, true]);
    const gb = await giris(KASA_B);
    assert.deepEqual([subeOf(gb, "tuzla")?.secilebilir, subeOf(gb, "tuzla")?.neden], [false, KURULU_NEDEN]);
    const b = await call("bagla", { belirtec: gb.body.belirtec, sube: "tuzla", devral: true, kasa: KASA_B });
    assert.deepEqual([b.status, b.body.error], [409, "zaten_kurulu"]);
    // Şubenin anahtarıyla imzalı istek o şubenin kasası sayılır (kimlik değişmiş olsa da)
    const gs = await giris(KASA_B, { key: TUZLA_KEY });
    assert.equal(subeOf(gs, "tuzla")?.buKasa, true);
    const signed = await call("bagla", { belirtec: gs.body.belirtec, sube: "tuzla", kasa: KASA_B }, { key: TUZLA_KEY });
    assert.deepEqual([signed.status, (signed.body.baglanti as Record<string, string>).LAFMALIYET_SYNC_SECRET], [200, TUZLA_KEY]);
    keys.forgetPosKeys();
    assert.equal(await keys.posKeyOf("tuzla", db), TUZLA_KEY, "anahtar değişmedi");
  });

  test("ilk personel: kurallar; kayıtta düz PIN yok; açık anahtarsız istekte gitmez; şifreli gider, kasa çözer; teslimle silinir; yedek dışı", async () => {
    const staff = [
      { rol: "patron" as const, ad: "Ayşe Patron", pin: PINS.patron },
      { rol: "mudur" as const, ad: "Mehmet Müdür", pin: PINS.mudur },
      { rol: "kasiyer" as const, ad: "Zeynep Barista", pin: PINS.kasiyer },
    ];
    await signIn("ali");
    assert.deepEqual(await branches.saveBranchStaff({ id: "fethiye", personel: staff }), { ok: false, error: yalnizAsilYonetici("ilkPersonel") });
    await signIn("ana");
    const sample = await branches.saveBranchStaff({ id: "fethiye", personel: [{ rol: "patron", ad: "A", pin: "1111" }] });
    assert.ok(!sample.ok && /örnek PIN/.test(sample.error) && !sample.error.includes("1111"), JSON.stringify(sample));
    const same = await branches.saveBranchStaff({ id: "fethiye", personel: [staff[0], { ...staff[1], pin: PINS.patron }] });
    assert.ok(!same.ok && same.error === "Üç PIN birbirinden farklı olmalı");
    assert.deepEqual(await branches.saveBranchStaff({ id: "fethiye", personel: staff }), { ok: true, data: { saved: true } });
    const rec = await stateOf("asilpos.ilk-personel:fethiye");
    const text = JSON.stringify(rec);
    for (const p of [...Object.values(PINS), "Ayşe Patron"]) assert.ok(!text.includes(p), `kayıtta düz değer yok: ${p}`);
    assert.deepEqual(rec?.roller, ["patron", "mudur", "kasiyer"]);
    assert.equal((await ilk.ilkPersonelDurumlari(["fethiye"], db)).fethiye, "ayarli");
    // Yedek: integration_state sorgusu kaydı dışarıda bırakır
    const backed = await db.execute<{ key: string }>(sql.raw(`SELECT key FROM integration_state WHERE ${TABLE_RULES.integration_state.where}`));
    assert.ok(!backed.some((r) => r.key.startsWith("asilpos.ilk-personel:")), "yedek dışı");
    assert.ok(backed.some((r) => r.key === "asilpos.hazirlik:tuzla"), "sorgu çalışıyor");

    // Açık anahtarsız kasa: personel gitmez, kayıt yerinde
    const k = kasaAnahtari();
    const KASA_C = { kimlik: "kasa-c-00000003" };
    const g = await giris(KASA_C);
    const r = await call("bagla", { belirtec: g.body.belirtec, sube: "fethiye", kasa: KASA_C });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body).sort(), ["baglanti", "ok", "sube"]);
    assert.equal((await ilk.ilkPersonelDurumlari(["fethiye"], db)).fethiye, "ayarli");
    const fethiyeKey = (r.body.baglanti as Record<string, string>).LAFMALIYET_SYNC_SECRET;
    assert.ok(fethiyeKey && fethiyeKey.length >= 32 && fethiyeKey !== MARINA_KEY && fethiyeKey !== TUZLA_KEY, "anahtarı yoktu: üretildi, başkasınınki değil");
    // Aynı kasa açık anahtarıyla yineler: PIN'ler kasanın anahtarıyla şifreli, kasa çözer
    const r2 = await call("bagla", { belirtec: g.body.belirtec, sube: "fethiye", kasa: { ...KASA_C, acikAnahtar: k.pub } });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal((r2.body.baglanti as Record<string, string>).LAFMALIYET_SYNC_SECRET, fethiyeKey);
    const personel = r2.body.personel as { rol: string; ad: string; pin: string }[];
    assert.deepEqual(
      personel.map((p) => [p.rol, p.ad]),
      [
        ["patron", "Ayşe Patron"],
        ["mudur", "Mehmet Müdür"],
        ["kasiyer", "Zeynep Barista"],
      ],
    );
    for (const p of personel) {
      assert.ok(!Object.values(PINS).includes(p.pin) && p.pin.length === 344, "şifreli");
      assert.equal(k.coz(p.pin), PINS[p.rol as keyof typeof PINS]);
    }
    assert.equal((await ilk.ilkPersonelDurumlari(["fethiye"], db)).fethiye, "gonderildi");
    // Teslim: imzasız ve başka şubenin anahtarı mührü silmez; şubenin anahtarı siler, iz kalır
    assert.equal((await call("teslim", { tamam: true })).status, 401);
    assert.deepEqual((await call("teslim", { tamam: true }, { key: TUZLA_KEY })).body, { ok: true, silindi: false });
    assert.equal((await ilk.ilkPersonelDurumlari(["fethiye"], db)).fethiye, "gonderildi");
    assert.deepEqual(await call("teslim", {}, { key: fethiyeKey }), { status: 200, body: { ok: true, silindi: true } });
    const iz = await stateOf("asilpos.ilk-personel:fethiye");
    assert.ok(iz && !("muhur" in iz) && typeof iz.teslim === "string", JSON.stringify(iz));
    assert.equal((await ilk.ilkPersonelDurumlari(["fethiye"], db)).fethiye, "teslim");
    assert.deepEqual((await call("teslim", {}, { key: fethiyeKey })).body, { ok: true, silindi: false }, "yinelenebilir");
    const r3 = await call("bagla", { belirtec: g.body.belirtec, sube: "fethiye", kasa: { ...KASA_C, acikAnahtar: k.pub } });
    assert.equal(r3.body.personel, undefined, "teslimden sonra personel gitmez");
  });

  test("ilk personel: hiç gönderilmeyen kayıt 30 gün, gönderilip onaylanmayan mühür 24 saat sonra silinir (okuma anında)", async () => {
    const staff = [{ rol: "patron" as const, ad: "P", pin: "908172" }];
    await ilk.saveIlkPersonel(db, "bodrum", staff, "test", new Date(Date.now() - 31 * 86_400_000));
    assert.deepEqual(await ilk.ilkPersonelDurumlari(["bodrum"], db), { bodrum: "yok" });
    assert.equal(await stateOf("asilpos.ilk-personel:bodrum"), undefined, "silindi");
    await ilk.saveIlkPersonel(db, "bodrum", staff, "test");
    const k = kasaAnahtari();
    assert.equal((await ilk.personelForKasa(db, "bodrum", k.pub, new Date(Date.now() - 25 * 3_600_000)))?.length, 1);
    assert.deepEqual(await ilk.ilkPersonelDurumlari(["bodrum"], db), { bodrum: "gonderildi" });
    const rec = await stateOf("asilpos.ilk-personel:bodrum");
    assert.ok(rec && !("muhur" in rec), "mühür silindi, iz kaldı");
    assert.equal(await ilk.personelForKasa(db, "bodrum", k.pub), null, "PIN'ler artık gitmez");
    // Bozuk açık anahtar: personel gitmez
    await ilk.saveIlkPersonel(db, "bodrum", staff, "test");
    assert.equal(await ilk.personelForKasa(db, "bodrum", "A".repeat(300)), null);
  });

  test("kurulum kodu: kasa kaydı yazılır; eski kasanın yanıtı bugünküyle aynı, yeni kasa açık anahtarla personeli alır; biçim bağla ile aynı", async () => {
    await signIn("ana");
    const k = kasaAnahtari();
    // Yeni şube ilk personeliyle ve e-postayla (kurulum bağlantısı ve hazırlık)
    const created = await branches.createBranch({
      id: "kalkan",
      name: "Kalkan",
      kind: "fiziksel",
      posSource: "modpos",
      openedOn: null,
      email: "kalkan@ornek.com",
      personel: [{ rol: "patron", ad: "Kalkan Patron", pin: "640273" }],
    });
    assert.ok(created.ok && created.data.kurulum, JSON.stringify(created));
    assert.ok(await stateOf("asilpos.hazirlik:kalkan"), "e-postalı yeni şube hazırlandı");
    const logText = JSON.stringify(await db.select().from(s.activityLog).where(like(s.activityLog.detail, "%Kalkan%")));
    assert.ok(!logText.includes("640273") && logText.includes("İlk personel ayarlandı"), "işlem geçmişinde PIN yok");
    const kod = created.data.kurulum.link.slice(created.data.kurulum.link.lastIndexOf("/") + 1);
    const r = await redeem({ kod, surum: "1.0.0", kimlik: "kasa-k-00000004", acikAnahtar: k.pub });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body).sort(), ["baglanti", "ok", "personel", "sube"]);
    const p = (r.body.personel as { rol: string; pin: string }[])[0];
    assert.equal(k.coz(p.pin), "640273");
    const kayit = await stateOf("asilpos.kasa:kalkan");
    assert.deepEqual([kayit?.durum, kayit?.yol, kayit?.kimlik, kayit?.surum], ["kurulu", "kod", "kasa-k-00000004", "1.0.0"]);
    // Bağla ile aynı biçim: üst düzey alanlar ve bağlantı anahtarları
    const g = await giris({ kimlik: "kasa-k-00000004" });
    const b = await call("bagla", { belirtec: g.body.belirtec, sube: "kalkan", kasa: { kimlik: "kasa-k-00000004" } });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(Object.keys(b.body).sort(), ["baglanti", "ok", "sube"]);
    assert.deepEqual(Object.keys(b.body.baglanti as object).sort(), Object.keys(r.body.baglanti as object).sort());
    assert.deepEqual(b.body.baglanti, r.body.baglanti, "aynı anahtar");
    assert.deepEqual(b.body.sube, r.body.sube);

    // Eski kasa (yalnız kod ve sürüm): yanıt bugünkü üç alan, kayıt kimliksiz yazılır
    const fresh = await branches.sendBranchInstall({ id: "bodrum", email: "bodrum@ornek.com" });
    assert.ok(fresh.ok, JSON.stringify(fresh));
    const old = await redeem({ kod: fresh.data.link.slice(fresh.data.link.lastIndexOf("/") + 1), surum: null });
    assert.equal(old.status, 200);
    assert.deepEqual(Object.keys(old.body).sort(), ["baglanti", "ok", "sube"], "personel ayarlı olsa da açık anahtarsız kasaya gitmez");
    const oldKayit = await stateOf("asilpos.kasa:bodrum");
    assert.deepEqual([oldKayit?.durum, oldKayit?.yol, oldKayit?.kimlik], ["kurulu", "kod", null]);
  });

  test("Kasayı serbest bırak: yalnız asıl yönetici, kurulu kasada, ad ve parola; eski anahtar 401, kayıt boş, bekleyen kod iptal, yeni bağlama çalışır", async () => {
    await signIn("ali");
    assert.deepEqual(await branches.releaseBranchTill({ id: "tuzla", ad: "Tuzla" }, { password: PASSWORD }), { ok: false, error: yalnizAsilYonetici("kasaSerbest") });
    await signIn("ana");
    assert.deepEqual(await branches.releaseBranchTill({ id: "marina", ad: "Tuzla" }, { password: PASSWORD }), { ok: false, error: "Onay için şubenin adını tam yazın" });
    assert.deepEqual(await branches.releaseBranchTill({ id: "tuzla", ad: " tuzla " }), { ok: false, error: STEP_UP_REQUIRED });
    // Kurulu kasa varken yeni kurulum bağlantısı (onayla): serbest bırakma onu iptal eder
    const pending = await branches.sendBranchInstall({ id: "tuzla", email: "tuzla@ornek.com", confirmReplace: true });
    assert.ok(pending.ok, JSON.stringify(pending));
    const done = await branches.releaseBranchTill({ id: "tuzla", ad: " tuzla " }, { password: PASSWORD });
    assert.deepEqual(done, { ok: true, data: { id: "tuzla" } });
    const kayit = await stateOf("asilpos.kasa:tuzla");
    assert.deepEqual([kayit?.durum, kayit?.yol, kayit?.kimlik, kayit?.by], ["bos", "serbest", null, "Asıl"]);
    assert.deepEqual(await kasa.loadKasaDurumu("tuzla", db), { durum: "yok" });
    const installs = await db.select().from(s.asilposInstalls).where(eq(s.asilposInstalls.branchId, "tuzla"));
    assert.ok(installs.every((x) => x.usedAt !== null || x.revokedAt !== null), "bekleyen kod iptal");
    const yeni = await keys.posKeyOf("tuzla", db);
    assert.ok(yeni && yeni !== TUZLA_KEY && yeni !== MARINA_KEY, "anahtar yenilendi");
    // Eski anahtarla imzalı istek artık 401 (eski kasa ladmin bağlantısını kaybetti)
    assert.equal((await call("teslim", {}, { key: TUZLA_KEY })).status, 401);
    assert.equal((await call("teslim", {}, { key: yeni })).status, 200);
    const logs = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Kasa serbest bırakıldı"));
    assert.equal(logs.length, 1);
    // Boş şube yeniden bağlanır: yeni kasa yeni anahtarı alır
    const g = await giris(KASA_B);
    assert.deepEqual([subeOf(g, "tuzla")?.kasa.durum, subeOf(g, "tuzla")?.secilebilir], ["bos", true]);
    const b = await call("bagla", { belirtec: g.body.belirtec, sube: "tuzla", kasa: KASA_B });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal((b.body.baglanti as Record<string, string>).LAFMALIYET_SYNC_SECRET, yeni);
    assert.equal((await stateOf("asilpos.kasa:tuzla"))?.kimlik, KASA_B.kimlik);
    // Kurulu olmayan şube serbest bırakılmaz
    const none = await branches.releaseBranchTill({ id: "kas", ad: "Kaş" }, { password: PASSWORD });
    assert.ok(!none.ok && /kurulu kasa yok/.test(none.error));
  });

  test("iki adımlı: kodsuz ikiAdim (parola doğru), yanlış kod 401, doğru kod geçer, aynı kod ikinci kez geçmez", async () => {
    const { seal } = await import("../src/server/secret-box");
    const secret = totp.generateTotpSecret();
    await db.update(s.users).set({ totpEnabled: true, totpSecret: seal(secret, "totp"), totpLastStep: null, failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, ids.ana));
    try {
      const ask = await giris(KASA_A);
      assert.deepEqual([ask.status, ask.body.ikiAdim, ask.body.belirtec], [200, true, undefined]);
      assert.equal((await giris(KASA_A, { parola: "yanlis" })).body.ikiAdim, undefined, "parola yanlışsa söylenmez");
      const step = totp.totpStep();
      const valid = new Set([step - 1, step, step + 1].map((x) => totp.totpCode(secret, x)));
      let wrong = "000000";
      while (valid.has(wrong)) wrong = String(Number(wrong) + 1).padStart(6, "0");
      const bad = await giris(KASA_A, { kod: wrong });
      assert.deepEqual([bad.status, bad.body.error, bad.body.ikiAdim], [401, "kod_hatali", true]);
      const code = totp.totpCode(secret, step);
      const ok = await giris(KASA_A, { kod: code });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(typeof ok.body.belirtec, "string");
      const replay = await giris(KASA_A, { kod: code });
      assert.equal(replay.status, 401, "tekrar koruması");
    } finally {
      await db.update(s.users).set({ totpEnabled: false, totpSecret: null, totpLastStep: null, failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, ids.ana));
    }
  });

  test("parola, belirteç ve PIN hiçbir işlem geçmişi satırında ve integration_state kaydında yok", async () => {
    const logs = JSON.stringify(await db.select().from(s.activityLog));
    const state = JSON.stringify(await db.select().from(s.integrationState));
    assert.ok(belirtecler.length >= 5, "belirteç üretildi");
    for (const secret of [PASSWORD, ...belirtecler, ...Object.values(PINS), "640273", "908172"]) {
      assert.ok(!logs.includes(secret), "işlem geçmişinde sır var");
      assert.ok(!state.includes(secret), "integration_state'te sır var");
    }
    assert.ok(logs.includes("Kasa açılışı için giriş"), "giriş yazıldı");
  });

  test("Marina: kayıtsız kurulu; anahtarı bütün senaryolardan sonra baştakiyle aynı", async () => {
    assert.equal(marinaKeyAtStart, MARINA_KEY);
    keys.forgetPosKeys();
    assert.equal(await keys.posKeyOf("marina", db), marinaKeyAtStart);
    assert.equal((await kasa.loadKasaDurumu("marina", db)).durum, "kurulu");
    assert.equal(await stateOf("asilpos.kasa:marina"), undefined);
  });
});
