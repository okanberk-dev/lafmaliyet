// LafPOS personel bağlantısı (LM-4b; docs/LAFPOS.md › Personel bağlantısı), gerçek Postgres'te:
// - imzalı `GET /api/panel/pos/personel?sube=marina`: şubenin bu ay ya da geçen ay maaş hesabındaki satırları, hesap başına
//   tek öğe (biten satır ile "Devam ettir"in yeni satırı aynı hesaba bağlı), bağlı girişin görünen adı; maaş ve e-posta yok
// - `POST /api/pos/gun` gövdesinin `workedStaffRefs`'i pos_day_reports.worked_staff'a yazılır (alanı taşımayan gönderim
//   silmez), 200 yanıtı `staff: { counted, unknown, otherBranch }` taşır; alan yoksa ya da bozuksa `staff` yok, gün yine yazılır
// - yemek kartının günü: ayın her sayılan LafPOS günü liste taşıyınca LafPOS'ta çalıştığı gün (veri kümesinden)
//
// Test kendi geçici veritabanını açar (PERSONEL_LAFPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda
// siler. PERSONEL_LAFPOS_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar).
// Çalıştırma: PERSONEL_LAFPOS_TEST_DATABASE_URL=postgres://ci:ci@localhost:5432/test npx tsx --test tests/personel-lafpos-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { signedHeaders } from "../src/lib/karaoke/signature";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.PERSONEL_LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_personel_lafpos_${process.pid}`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const GUN = new URL("https://ladmin.laffogato.net/api/pos/gun");
const LISTE = new URL("https://ladmin.laffogato.net/api/panel/pos/personel?sube=marina");
/** Marina'nın geçiş günü: Ekim 2026'nın tamamı LafPOS dönemi */
const SWITCH = "2026-10-01";
/** Gönderimlerin ve listenin anı: 23 Kasım 2026 gecesi ("bu ay" Kasım, geçen ay Ekim) */
const NOW = new Date("2026-11-23T01:00:00+03:00");

describe("personel bağlantısı: veritabanında", { skip: !SERVER_URL && "PERSONEL_LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let status: typeof import("../src/server/lafpos/status");
  let personel: typeof import("../src/server/lafpos/personel");
  let dataset: typeof import("../src/server/data/dataset");
  const ids = { alper: 0, cem: 0, ayseOld: 0, ayseNew: 0, damla: 0, tuzla: 0 };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "personel-lafpos-testi-icin-en-az-otuz-iki-karakter", LAFPOS_SYNC_SECRET: SECRET });
    delete process.env.KARAOKE_SYNC_SECRET;
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
    const [yonetici] = await db.insert(s.users).values({ email: "yonetici@ornek.com", name: "Yönetici", passwordHash: "x", role: "admin" }).returning();
    const [alperU] = await db.insert(s.users).values({ email: "alper@ornek.com", name: "Alper Kaya", passwordHash: "x", role: "staff", branchId: "marina" }).returning();
    const [ayseU] = await db.insert(s.users).values({ email: "ayse@ornek.com", name: "Ayşe Yılmaz", passwordHash: "x", role: "staff" }).returning();
    const me = async () => ({ ...yonetici, role: "admin" as const });
    stub(require.resolve("../src/server/auth/dal"), { getCurrentUser: me, requireUser: me, requireAdmin: me });
    const staff = async (v: Partial<typeof s.staff.$inferInsert> & { name: string }) => (await db.insert(s.staff).values({ branchId: "marina", netSalary: 30_000, ...v }).returning({ id: s.staff.id }))[0].id;
    ids.alper = await staff({ name: "Alper", netSalary: 35_000, mealCard: true, userId: alperU.id });
    ids.cem = await staff({ name: "Cem", netSalary: 32_000, mealCard: true });
    // "Devam ettir": Ekim'de biten satır ve Kasım'dan yeni satır, ikisi de Ayşe'nin hesabına bağlı (aralıklar ayrık)
    ids.ayseOld = await staff({ name: "Ayşe", userId: ayseU.id, endMonth: "2026-10" });
    ids.ayseNew = await staff({ name: "Ayşe", userId: ayseU.id, startMonth: "2026-11" });
    ids.damla = await staff({ name: "Damla", endMonth: "2026-09" });
    ids.tuzla = await staff({ name: "Tuzla Personeli", branchId: "tuzla", mealCard: true });
    await db.insert(s.settings).values({ key: "lafposGecisGunu", value: SWITCH });
    status = await import("../src/server/lafpos/status");
    personel = await import("../src/server/lafpos/personel");
    dataset = await import("../src/server/data/dataset");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  const ref = (id: number) => `s:${id}`;
  const day = (date: string, extra: Record<string, unknown> = {}) => ({
    version: 1,
    source: "lafpos",
    sube: "marina",
    date,
    z: {
      zNo: Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10)),
      receipts: 10,
      zTotal: 2_000,
      cash: 500,
      card: 1_500,
      mealCard: 0,
      online: 0,
      other: 0,
      offRevenue: 0,
      discounts: 0,
      openingCash: 1_000,
      cashOut: 0,
      countedCash: 1_500,
      handedOver: 0,
      cashDiff: 0,
      cashIn: 0,
      expectedCash: 1_500,
    },
    lines: [{ posName: "LATTE", siteMenuId: null, slot: null, qty: 4, revenue: 2_000, isService: false }],
    ikram: [],
    payments: [],
    ...extra,
  });
  const send = (body: unknown) => {
    const raw = JSON.stringify(body);
    const h = signedHeaders(SECRET, "POST", GUN, raw, NOW.getTime());
    return status.handlePosDay(db, { secret: SECRET, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, NOW, { unverifiedWindowMs: 0 });
  };
  const signedGet = (url: URL) => {
    const h = signedHeaders(SECRET, "GET", url, "", NOW.getTime());
    return { secret: SECRET, url, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now: NOW };
  };
  const storedRefs = async (date: string) =>
    (await db.select({ w: s.posDayReports.workedStaff }).from(s.posDayReports).where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, LAFPOS_SUBE))))[0]?.w;

  test("GET personel: şubenin bu ay / geçen ay satırları, hesap başına tek öğe, hesabın görünen adı; maaş ve e-posta yok", async () => {
    const r = await personel.servePosStaff(signedGet(LISTE));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 1);
    assert.equal(r.body.sube, "marina");
    assert.equal(r.body.now, NOW.toISOString());
    assert.deepEqual(r.body.items, [
      { ref: ref(ids.alper), name: "Alper", active: true, account: "Alper Kaya" },
      { ref: ref(ids.ayseNew), name: "Ayşe", active: true, account: "Ayşe Yılmaz" },
      { ref: ref(ids.cem), name: "Cem", active: true, account: null },
    ]);
    const text = JSON.stringify(r.body);
    for (const leak of ["35000", "30000", "ornek.com", "2026-10", "Damla", "Tuzla"]) assert.ok(!text.includes(leak), `sızmaz: ${leak}`);
    // Başka şube 409, imzasız 401 (okuma yapılmaz)
    const tuzla = await personel.servePosStaff(signedGet(new URL("https://ladmin.laffogato.net/api/panel/pos/personel?sube=tuzla")));
    assert.deepEqual([tuzla.status, tuzla.body], [409, { error: "wrong_branch", sube: "tuzla", expected: "marina" }]);
    const unsigned = await personel.servePosStaff({ ...signedGet(LISTE), signature: null });
    assert.equal(unsigned.status, 401);
  });

  test("gün sonu: workedStaffRefs saklanır, 200 yanıtı sınıflar (sayılan / bilinmeyen / başka şube); receivePosDay'in gövdesi değişmez", async () => {
    const refs = [ref(ids.tuzla), ref(ids.alper), "s:999999", ref(ids.ayseOld), ref(ids.alper)];
    const r = await send(day("2026-10-05", { workedStaffRefs: refs }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Ayşe'nin eski satırı Ekim'de aralıkta: sayılır; yeni satırı Ekim'de yok
    assert.deepEqual(r.body.staff, { counted: [ref(ids.alper), ref(ids.ayseOld)], unknown: ["s:999999"], otherBranch: [ref(ids.tuzla)] });
    assert.deepEqual(await storedRefs("2026-10-05"), [ref(ids.alper), ref(ids.ayseOld), ref(ids.tuzla), "s:999999"].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))));
    // Kasım'da Ayşe'nin eski satırı biter: aynı kimlik bilinmeyen (yeniden bağlanmalı), yeni satırı sayılır
    const nov = await send(day("2026-11-21", { workedStaffRefs: [ref(ids.ayseOld), ref(ids.ayseNew)] }));
    assert.deepEqual(nov.body.staff, { counted: [ref(ids.ayseNew)], unknown: [ref(ids.ayseOld)], otherBranch: [] });
    // Alanı taşımayan yeniden gönderim: yanıtta staff yok, kayıtlı liste silinmez
    const again = await send(day("2026-10-05"));
    assert.equal(again.status, 200);
    assert.equal("staff" in again.body, false);
    assert.equal((await storedRefs("2026-10-05"))?.length, 4, "liste yerinde");
    // Hiç gelmemiş gün: null; bozuk alan günü reddetmez, yazılmaz, yanıtta yok
    const plain = await send(day("2026-10-06"));
    assert.equal("staff" in plain.body, false);
    assert.equal(await storedRefs("2026-10-06"), null);
    const bad = await send(day("2026-10-07", { workedStaffRefs: ["Ayşe"] }));
    assert.equal(bad.status, 200, JSON.stringify(bad.body));
    assert.equal("staff" in bad.body, false);
    assert.equal(await storedRefs("2026-10-07"), null);
    // receivePosDay (uçtan önceki çekirdek) yanıta staff koymaz: ek alanlar handlePosDay'in
    const ingest = await import("../src/server/lafpos/ingest");
    const raw = JSON.stringify(day("2026-10-09", { workedStaffRefs: [ref(ids.alper)] }));
    const h = signedHeaders(SECRET, "POST", GUN, raw, NOW.getTime());
    const core = await ingest.receivePosDay(db, { secret: SECRET, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, NOW);
    assert.deepEqual(Object.keys(core.body).sort(), ["date", "lines", "matched", "ok", "unmatched"]);
    // Boş liste: "bağlı var, kimse çalışmadı"
    const empty = await send(day("2026-10-08", { workedStaffRefs: [] }));
    assert.deepEqual(empty.body.staff, { counted: [], unknown: [], otherBranch: [] });
    assert.deepEqual(await storedRefs("2026-10-08"), []);
  });

  test("yemek kartı: Ekim'in her LafPOS günü liste taşıyınca LafPOS'ta çalıştığı gün (Alper 20, Cem 18); bir gün eksikken 26", async () => {
    const send31 = async (skip: string | null) => {
      for (let d = 1; d <= 31; d++) {
        const date = `2026-10-${String(d).padStart(2, "0")}`;
        const refs = [...(d <= 20 ? [ref(ids.alper)] : []), ...(d <= 18 ? [ref(ids.cem)] : [])];
        const r = await send(day(date, date === skip ? {} : { workedStaffRefs: refs }));
        assert.equal(r.status, 200, `${date}: ${JSON.stringify(r.body)}`);
      }
    };
    // Önceki testin listesiz günleri (6, 7) yeniden gönderilince de listesiz kalmasın: hepsi listeyle
    await send31(null);
    const model = await dataset.loadModel({ scope: "marina" });
    const rows = new Map(model.personnelFor("2026-10").rows.map((r) => [r.staff.name, r]));
    assert.equal(rows.get("Alper")?.lafposDays, 20);
    assert.ok(Math.abs((rows.get("Alper")?.mealCard ?? 0) - 330 * 20) < 0.01, "Alper 330 × 20");
    assert.ok(Math.abs((rows.get("Cem")?.mealCard ?? 0) - 330 * 18) < 0.01, "Cem 330 × 18");
    // Kasım (yalnız 21'i geldi, liste taşıyor): ayın tek sayılan günü 21, Alper o gün yok → 0 gün
    const novAlper = model.personnelFor("2026-11").rows.find((r) => r.staff.name === "Alper");
    assert.equal(novAlper?.lafposDays, 0, "Kasım: 21'i geldi, Alper listede yok");
    // Ekim'in bir günü listesiz kalınca (eski LafPOS ya da bağlı kimse yokken gönderilmiş; sonra yeniden gönderilmedi)
    await db.update(s.posDayReports).set({ workedStaff: null }).where(and(eq(s.posDayReports.date, "2026-10-12"), eq(s.posDayReports.branchId, LAFPOS_SUBE)));
    const gap = await dataset.loadModel({ scope: "marina" });
    const alper = gap.personnelFor("2026-10").rows.find((r) => r.staff.name === "Alper");
    assert.equal(alper?.lafposDays, null);
    assert.ok(Math.abs((alper?.mealCard ?? 0) - 330 * 26) < 0.01, "varsayılan 330 × 26");
    // Tuzla'nın kişisi ("Tümü"): hep varsayılan
    const all = await dataset.loadModel({ scope: "hepsi" });
    const tuzla = all.personnelFor("2026-10").rows.find((r) => r.staff.name === "Tuzla Personeli");
    assert.equal(tuzla?.lafposDays, null);
  });
});
