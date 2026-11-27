// Kasa zinciri (Faz 3, 23 Kasım 2026; docs/ASILPOS.md › Kasa zinciri, Kasadan çıkanlar AsilPOS'tan), gerçek Postgres'te:
// - `POST /api/pos/gun`'un 200'ü ertesi günün beklenen açılışını taşır (nextOpening): rapor yokken AsilPOS'un sayımı,
//   rapor varsa sayılan − teslim; AsilPOS'un elle değişmemiş otomatik raporunda gelen gövdenin sayımı (rapor yanıttan
//   sonra yazılır, yeniden sayımın yanıtı önceki sayımı yankılamaz); kişinin raporu geçer; sayılmayan gün null
// - imzalı `GET /api/panel/pos/devir?date=` aynı nesneyi, `GET /api/panel/pos/gider-kategorileri` personelin
//   kategorilerini (tutarsız) verir
// - kasa hareketleri "Kasadan çıkanlar"a kimlikle: yeniden gönderim eklemez, elle girilmiş eşi bire bir sahiplenir,
//   gelmeyen AsilPOS satırı kalkar (tedarikçi ödemesine bağlıysa kalır), giriş satır olmaz, sayılmayan günde ve eski /
//   bozuk gövdede satırlara dokunulmaz; AsilPOS satırının tutarı, türü ve günü kilitli, silinmez; fiş ve kategori serbest
//
// Test kendi geçici veritabanını açar (KASA_ZINCIRI_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda
// siler. KASA_ZINCIRI_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: KASA_ZINCIRI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/kasa-zinciri-db.test.ts

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, asc, desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { signedHeaders } from "../src/lib/karaoke/signature";
import { ASILPOS_CASH_OUT_TEXT } from "../src/lib/asilpos/cash-moves";
import { TEL_KAYNAK } from "../src/lib/asilpos/eski-adlar";
import type { CashOutData } from "../src/server/cash-outs/write";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { ASILPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.KASA_ZINCIRI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_kasa_zinciri_${process.pid}`;
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const GUN = new URL("https://ladmin.laffogato.net/api/pos/gun");
/** Marina'nın geçiş günü; 19 Kasım deneme günüdür (sayılmaz) */
const SWITCH = "2026-11-20";
/** Gönderimlerin anı: 23 Kasım gecesi (iş günü 22 Kasım) */
const NOW = new Date("2026-11-23T01:00:00+03:00");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);

/** Hareketin kimliği (26 karakter Crockford base32) */
const ulid = (tag: string) => `01M8${tag}`.padEnd(26, "0");

describe("kasa zinciri: veritabanında", { skip: !SERVER_URL && "KASA_ZINCIRI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let status: typeof import("../src/server/asilpos/status");
  let gunSonu: typeof import("../src/server/asilpos/gun-sonu");
  let devir: typeof import("../src/server/asilpos/devir");
  let categories: typeof import("../src/server/asilpos/categories");
  let write: typeof import("../src/server/cash-outs/write");
  let reqs: typeof import("../src/server/cash-outs/requests");
  let asilposAdmin: typeof import("../src/server/asilpos/admin");
  let invoices: typeof import("../src/server/data/cash-out-invoices");
  let outsData: typeof import("../src/server/data/cash-outs");
  const users = { admin: { id: 0, name: "Yönetici", role: "admin" as const }, staff: { id: 0, name: "Ayşe", role: "staff" as const } };
  const cats = { diger: 3, maas: 0 };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "kasa-zinciri-testi-icin-en-az-otuz-iki-karakter", ASILPOS_SYNC_SECRET: SECRET });
    delete process.env.KARAOKE_SYNC_SECRET;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedBranches(db);
    for (const k of ["admin", "staff"] as const) {
      const [u] = await db.insert(s.users).values({ email: `kasa-zinciri-${k}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    // Migration'ın kategorileri: 1 Nakit malzeme alımı, 2 Bakım & onarım, 3 Diğer fatura dışı (personelin); yöneticinin
    // kategorisi (maaş) listeye girmez
    const [diger] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.name, "Diğer fatura dışı"));
    assert.ok(diger, "Diğer fatura dışı kategorisi");
    cats.diger = diger.id;
    const [maas] = await db.insert(s.expenseCategories).values({ name: "Maaş (test)", section: "personel", panelGroup: "personel" }).returning({ id: s.expenseCategories.id });
    cats.maas = maas.id;
    await db.insert(s.settings).values({ key: "asilposGecisGunu", value: SWITCH });
    status = await import("../src/server/asilpos/status");
    gunSonu = await import("../src/server/asilpos/gun-sonu");
    devir = await import("../src/server/asilpos/devir");
    categories = await import("../src/server/asilpos/categories");
    write = await import("../src/server/cash-outs/write");
    reqs = await import("../src/server/cash-outs/requests");
    asilposAdmin = await import("../src/server/asilpos/admin");
    invoices = await import("../src/server/data/cash-out-invoices");
    outsData = await import("../src/server/data/cash-outs");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  type Move = { id: string; kind: "harcama" | "teslim" | "giris"; amount: number; description: string; at: string; categoryId: number | null };
  const move = (tag: string, kind: Move["kind"], amount: number, categoryId: number | null = null): Move => ({ id: ulid(tag), kind, amount, description: kind === "harcama" ? "Fişsiz" : kind, at: "2026-11-22T13:45:00.000Z", categoryId });
  const day = (date: string, o: { zNo?: number; counted?: number | null; moves?: Move[] | null; correction?: unknown; revision?: number } = {}) => {
    const moves = o.moves === undefined ? [] : o.moves;
    const out = moves?.filter((m) => m.kind === "harcama").reduce((a, m) => a + m.amount, 0) ?? 0;
    const handed = moves?.filter((m) => m.kind === "teslim").reduce((a, m) => a + m.amount, 0) ?? 0;
    const cashIn = moves?.filter((m) => m.kind === "giris").reduce((a, m) => a + m.amount, 0) ?? 0;
    const counted = o.counted === undefined ? 1_279.5 : o.counted;
    return {
      version: 1,
      source: "asilpos",
      sube: "marina",
      date,
      ...(o.revision ? { revision: o.revision } : {}),
      ...(o.correction ? { correction: o.correction } : {}),
      z: {
        zNo: o.zNo ?? 11,
        receipts: 26,
        zTotal: 6_285,
        cash: 1_255,
        card: 5_030,
        mealCard: 0,
        online: 0,
        other: 0,
        offRevenue: 1_065,
        discounts: 90,
        openingCash: 1_120,
        cashOut: out,
        countedCash: counted,
        handedOver: handed,
        cashDiff: counted === null ? null : -295.5,
        cashIn,
        expectedCash: 1_575,
        expectedOpening: null,
        openingDiff: null,
        openingReason: null,
      },
      lines: [{ posName: `LATTE ${date}`, siteMenuId: null, slot: null, qty: 2, revenue: 400, isService: false }],
      ikram: [],
      payments: [],
      ...(moves === null ? {} : { cashMoves: moves }),
    };
  };
  const send = (body: unknown, now = NOW) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const h = signedHeaders(SECRET, "POST", GUN, raw, now.getTime());
    return status.handlePosDay(db, { branchId: "marina", secret: SECRET, url: GUN, body: raw, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"] }, now, { unverifiedWindowMs: 0 });
  };
  const signedGet = (url: URL, o: { now?: Date; sign?: boolean; secret?: string | null } = {}) => {
    const now = o.now ?? NOW;
    const h = o.sign === false ? { "x-laf-timestamp": null, "x-laf-signature": null } : signedHeaders(SECRET, "GET", url, "", now.getTime());
    return { branchId: "marina", secret: o.secret === undefined ? SECRET : o.secret, url, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now };
  };
  const outsOf = (date: string) =>
    db
      .select()
      .from(s.cashOuts)
      .where(and(eq(s.cashOuts.date, date), eq(s.cashOuts.branchId, ASILPOS_SUBE)))
      .orderBy(asc(s.cashOuts.id));
  const expenseOf = async (cashOutId: number) => (await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, cashOutId)))[0];
  const refused = (p: Promise<unknown>, text: string) => assert.rejects(p, (e: unknown) => e instanceof UserError && e.message === text);

  // ---------------------------------------------------------------- nextOpening

  test("200: rapor yokken AsilPOS'un sayımı (asilpos), sayımsız gün ve sayılmayan (deneme) gün null", async () => {
    const r = await send(day("2026-11-21"));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Kaynak telde eski adla (kurulu kasa yenisini tanımaz)
    assert.deepEqual(r.body.nextOpening, { amount: 1_279.5, source: TEL_KAYNAK });
    const none = await send(day("2026-11-20", { counted: null }));
    assert.equal(none.body.nextOpening, null, "sayılmadan kapanan gün");
    const trial = await send(day("2026-11-19"));
    assert.deepEqual([trial.body.counted, trial.body.nextOpening], [false, null], "geçişten önceki gün");
  });

  test("yeniden sayım: otomatik rapor yazıldıktan sonra gelen gövdenin sayımı (önceki sayımın yankısı değil); rapor da onu yazar", async () => {
    assert.equal(await gunSonu.writeAutoReport(db, "2026-11-21", "marina", later(1)), "written");
    const recount = await send(day("2026-11-21", { counted: 1_300, revision: 2, correction: { kind: "recount", reason: "Yeniden sayıldı" } }), later(2));
    assert.equal(recount.status, 200, JSON.stringify(recount.body));
    assert.deepEqual(recount.body.nextOpening, { amount: 1_300, source: "kasa_raporu" }, "yanıt yeni sayımı söyler");
    assert.equal(await gunSonu.writeAutoReport(db, "2026-11-21", "marina", later(3)), "updated");
    const [rep] = await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, "2026-11-21"), eq(s.cashReports.branchId, ASILPOS_SUBE)));
    assert.equal(rep.countedCash - rep.handedOver, 1_300, "rapor yanıtın söylediğini yazdı");
    // Sayımsız yeniden kapanış: rapor sayımını korur, yanıt da
    const reclosed = await send(day("2026-11-21", { counted: null, revision: 3, correction: { kind: "reopen", reason: "Masa" } }), later(4));
    assert.deepEqual(reclosed.body.nextOpening, { amount: 1_300, source: "kasa_raporu" });
  });

  test("kişinin raporu geçer: otomatik raporun sayımı elle düzeltildiyse ya da raporu kişi yazdıysa sayılan − teslim", async () => {
    await db
      .update(s.cashReports)
      .set({ countedCash: 1_250, handedOver: 100 })
      .where(and(eq(s.cashReports.date, "2026-11-21"), eq(s.cashReports.branchId, ASILPOS_SUBE)));
    const r = await send(day("2026-11-21", { counted: 1_310, revision: 4, correction: { kind: "recount", reason: "Bir daha" } }), later(5));
    assert.deepEqual(r.body.nextOpening, { amount: 1_150, source: "kasa_raporu" });
    // Gün sonundan önce kişinin girdiği rapor (otomatik değil)
    await db.insert(s.cashReports).values({ date: "2026-11-22", branchId: ASILPOS_SUBE, zTotal: 6_285, cash: 1_255, card: 5_030, openingCash: 1_120, countedCash: 2_000, handedOver: 500, submittedByName: "Ayşe" });
    const human = await send(day("2026-11-22"), later(6));
    assert.deepEqual(human.body.nextOpening, { amount: 1_500, source: "kasa_raporu" });
  });

  test("GET devir: imzalı, aynı nesne; imzasız 401, anahtarsız 503, bozuk gün 400, bilinmeyen gün null; önbelleğe alınmaz", async () => {
    const at = (date: string) => new URL(`https://ladmin.laffogato.net/api/panel/pos/devir?date=${date}`);
    const ok = await devir.servePosDevir(db, signedGet(at("2026-11-22")));
    assert.deepEqual(ok, { status: 200, body: { version: 1, date: "2026-11-22", nextOpening: { amount: 1_500, source: "kasa_raporu" } } });
    assert.deepEqual((await devir.servePosDevir(db, signedGet(at("2026-11-21")))).body.nextOpening, { amount: 1_150, source: "kasa_raporu" });
    assert.deepEqual((await devir.servePosDevir(db, signedGet(at("2026-11-19")))).body.nextOpening, null, "deneme günü");
    assert.deepEqual((await devir.servePosDevir(db, signedGet(at("2026-11-23")))).body.nextOpening, null, "gelmemiş gün");
    assert.deepEqual(await devir.servePosDevir(db, signedGet(at("2026-11-22"), { sign: false })), { status: 401, body: { error: "unauthorized" } });
    assert.deepEqual(await devir.servePosDevir(db, signedGet(at("2026-11-22"), { secret: null })), { status: 503, body: { error: "not_configured" } });
    assert.deepEqual(await devir.servePosDevir(db, signedGet(at("2026-02-30"))), { status: 400, body: { error: "invalid", field: "date" } });
    assert.deepEqual(await devir.servePosDevir(db, signedGet(new URL("https://ladmin.laffogato.net/api/panel/pos/devir"))), { status: 400, body: { error: "invalid", field: "date" } });
  });

  test("GET gider kategorileri: yalnız personelin seçebildikleri (etkin, alım ya da genel, diğer grubu), tutarsız; imzasız 401", async () => {
    const url = new URL("https://ladmin.laffogato.net/api/panel/pos/gider-kategorileri");
    const r = await categories.servePosExpenseCategories(db, signedGet(url));
    assert.equal(r.status, 200);
    const body = r.body as { version: number; now: string; items: { id: number; name: string; section: string }[] };
    assert.equal(body.version, 1);
    assert.equal(body.now, NOW.toISOString());
    assert.deepEqual(
      body.items.map((i) => i.name),
      // "Temizlik & sarf malzemesi": göç 0090'ın açtığı satır (genel, diğer grubu); kasadan alınan deterjan da seçilir
      ["Nakit malzeme alımı", "Bakım & onarım", "Diğer fatura dışı", "Temizlik & sarf malzemesi"],
    );
    assert.ok(!body.items.some((i) => i.id === cats.maas), "yöneticinin kategorisi yok");
    assert.deepEqual(Object.keys(body.items[0]).sort(), ["id", "name", "section"], "tutar ve ayar yok");
    assert.deepEqual(await categories.servePosExpenseCategories(db, signedGet(url, { sign: false })), { status: 401, body: { error: "unauthorized" } });
  });

  // ---------------------------------------------------------------- Kasadan çıkanlar

  const D = "2026-11-24";
  /** Hareket testlerinin anı: 28 Kasım öğlen (24–27 Kasım gönderilebilir, otomatik rapor 7 gün geriye yazılır) */
  const NOV28 = new Date("2026-11-28T12:00:00+03:00");

  test("hareketler: harcama ve teslim kimlikle satır olur (AsilPOS, Marina), kategorili harcama Aylık harcamalar'a; giriş satır olmaz; yeniden gönderim eklemez", async () => {
    const moves = [move("A1", "harcama", 800, cats.diger), move("A2", "teslim", 200), move("A3", "giris", 50)];
    const r = await send(day(D, { moves }), NOV28);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rows = await outsOf(D);
    assert.deepEqual(
      rows.map((o) => [o.kind, o.amount, o.asilposId, o.createdByName, o.createdBy, o.docType, o.description]),
      [
        ["harcama", 800, ulid("A1"), "AsilPOS", null, "yok", "Fişsiz"],
        ["teslim", 200, ulid("A2"), "AsilPOS", null, "yok", "teslim"],
      ],
    );
    assert.equal(rows[0].createdAt.toISOString(), "2026-11-22T13:45:00.000Z", "satırın saati hareketin anı");
    const e = await expenseOf(rows[0].id);
    assert.deepEqual([e?.categoryId, e?.amount, e?.branchId, e?.paymentMethod], [cats.diger, 800, ASILPOS_SUBE, "nakit"]);
    assert.equal(await expenseOf(rows[1].id), undefined, "teslim gider değil");
    const again = await send(day(D, { moves, revision: 2 }), new Date(NOV28.getTime() + 60_000));
    assert.equal(again.status, 200);
    assert.deepEqual((await outsOf(D)).map((o) => o.id), rows.map((o) => o.id), "aynı satırlar");
    assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, rows[0].id))).length, 1);
    // Kasa raporu: gün içinde çıkan satırların toplamı (harcama + teslim), teslim edilen 0
    assert.equal(await gunSonu.writeAutoReport(db, D, "marina", NOV28), "written");
    const [rep] = await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, D), eq(s.cashReports.branchId, ASILPOS_SUBE)));
    assert.deepEqual([rep.cashOut, rep.handedOver, rep.cashIn], [1_000, 0, 50]);
  });

  test("hareketler: kategorisiz ya da yöneticinin kategorisindeki harcama satır olur, Aylık harcamalar'a yazılmaz", async () => {
    const date = "2026-11-25";
    await send(day(date, { moves: [move("B1", "harcama", 45), move("B2", "harcama", 60, cats.maas), move("B3", "harcama", 70, 99_999)] }), NOV28);
    const rows = await outsOf(date);
    assert.equal(rows.length, 3);
    for (const o of rows) assert.equal(await expenseOf(o.id), undefined, `${o.amount}: kaydı yok`);
  });

  test("hareketler: panelde elle girilmiş eş bire bir sahiplenilir (fotoğrafı, yeri, kategorisi kalır; iki kez sayılmaz); tutmayan elle satır kalır", async () => {
    const date = "2026-11-26";
    const manual = async (amount: number, store: string) =>
      db.transaction((tx) =>
        write.writeCashOut(
          tx,
          users.staff,
          { id: null, date, kind: "harcama", amount, store, description: "süt", receiptDate: null, receiptNo: null, vat: null, docType: "yok", categoryId: 1, toExpenses: true, photoId: null },
          { branchId: ASILPOS_SUBE },
        ),
      );
    const a = await manual(800, "Migros");
    const b = await manual(800, "Bim");
    const c = await manual(33, "Şok");
    await send(day(date, { moves: [move("C1", "harcama", 800, cats.diger)] }), NOV28);
    const rows = await outsOf(date);
    assert.equal(rows.length, 3, "yeni satır açılmadı");
    const byId = new Map(rows.map((o) => [o.id, o]));
    assert.deepEqual([byId.get(a.id)?.asilposId, byId.get(a.id)?.store, byId.get(a.id)?.createdByName], [ulid("C1"), "Migros", "Ayşe"], "en eski eş sahiplenildi, elle yazılanlar kaldı");
    assert.equal((await expenseOf(a.id))?.categoryId, 1, "elle seçilen kategori kaldı");
    assert.deepEqual([byId.get(b.id)?.asilposId, byId.get(c.id)?.asilposId], [null, null]);
    // Yeniden gönderim: sahiplenilen satır kalır, eklenmez
    await send(day(date, { moves: [move("C1", "harcama", 800, cats.diger)], revision: 2 }), NOV28);
    assert.equal((await outsOf(date)).length, 3);
  });

  test("Kime: AsilPOS teslimin alıcısı satırın Kime'si olur; alıcısız yazılmış satır yeniden gönderimde dolar; panelde yazılan Kime kalır", async () => {
    const date = "2026-11-28";
    const NOV29 = new Date("2026-11-29T12:00:00+03:00");
    const to = (m: Move, recipient: string) => ({ ...m, recipient });
    // Alıcıyı taşımayan gövde (eski AsilPOS ya da alıcıyı okumayan sürüm): satırlar Kime'siz
    const first = await send(day(date, { moves: [move("K1", "teslim", 500), move("K2", "teslim", 300), move("K3", "harcama", 90, cats.diger)] }), NOV29);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    let rows = await outsOf(date);
    assert.deepEqual(rows.map((o) => [o.kind, o.store]), [["teslim", null], ["teslim", null], ["harcama", null]]);
    // Panelde K2'nin Kime'si elle yazıldı: AsilPOS'un alıcısı onu ezmez
    await db.update(s.cashOuts).set({ store: "Elle yazılan" }).where(eq(s.cashOuts.id, rows[1].id));
    const again = await send(
      day(date, { moves: [to(move("K1", "teslim", 500), "Patron"), to(move("K2", "teslim", 300), "Banka"), to(move("K3", "harcama", 90, cats.diger), "Patron")], revision: 2 }),
      NOV29,
    );
    assert.equal(again.status, 200, JSON.stringify(again.body));
    rows = await outsOf(date);
    assert.deepEqual(rows.map((o) => [o.kind, o.store]), [["teslim", "Patron"], ["teslim", "Elle yazılan"], ["harcama", null]], "boş Kime dolar, elle yazılan kalır, harcamada yer yazılmaz");
    // Yeni teslim alıcısıyla gelir: Kime ilk yazımda; uzun ad 60 karaktere kısalır
    const third = await send(
      day(date, {
        moves: [to(move("K1", "teslim", 500), "Patron"), to(move("K2", "teslim", 300), "Banka"), to(move("K3", "harcama", 90, cats.diger), "Patron"), to(move("K4", "teslim", 100), "  Okan   Bey  "), to(move("K5", "teslim", 50), "Ç".repeat(100))],
        revision: 3,
      }),
      NOV29,
    );
    assert.equal(third.status, 200, JSON.stringify(third.body));
    rows = await outsOf(date);
    assert.deepEqual(rows.slice(3).map((o) => [o.asilposId, o.store]), [
      [ulid("K4"), "Okan Bey"],
      [ulid("K5"), "Ç".repeat(60)],
    ]);
  });

  test("hareketler: gövdede olmayan AsilPOS satırı kalkar; tedarikçi ödemesine bağlıysa kalır, AsilPOS bağı çözülür; elle satıra dokunulmaz", async () => {
    const date = "2026-11-27";
    await send(day(date, { moves: [move("D1", "harcama", 100, cats.diger), move("D2", "teslim", 300), move("D3", "teslim", 400)] }), NOV28);
    const rows = await outsOf(date);
    const [sup] = await db.insert(s.suppliers).values({ name: "Sütaş (test)", key: `sutas-${randomUUID()}` }).returning({ id: s.suppliers.id });
    await db.insert(s.supplierEntries).values({ supplierId: sup.id, kind: "odeme", date, amount: 400, method: "kasa", cashOutId: rows[2].id, createdByName: "Yönetici" });
    // Yeni AsilPOS sürümünün gövdesi D1'i taşımaz (ör. eğitim temizliği), D2 ve D3 de yok
    await send(day(date, { moves: [], revision: 2 }), NOV28);
    const left = await outsOf(date);
    assert.deepEqual(
      left.map((o) => [o.id, o.asilposId]),
      [[rows[2].id, null]],
      "ödemeye bağlı satır kaldı, AsilPOS bağı çözüldü",
    );
    assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, rows[0].id))).length, 0, "kalkan satırın gider kaydı da kalktı");
  });

  test("hareketler: sayılmayan günde, eski AsilPOS'un (alan yok) ve bozuk listenin gövdesinde satırlara dokunulmaz", async () => {
    await send(day("2026-11-19", { moves: [move("E1", "harcama", 80)] }), NOV28);
    assert.deepEqual(await outsOf("2026-11-19"), [], "deneme günü");
    const before = await outsOf(D);
    await send(day(D, { moves: null, revision: 3 }), NOV28);
    assert.deepEqual((await outsOf(D)).map((o) => o.id), before.map((o) => o.id), "alan yok: dokunulmaz");
    const broken = day(D, { moves: [move("A1", "harcama", 800, cats.diger), { ...move("A2", "teslim", 200), id: "bozuk" }], revision: 4 });
    const real = console.warn;
    console.warn = () => {};
    try {
      assert.equal((await send(broken, NOV28)).status, 200, "gün reddedilmez");
    } finally {
      console.warn = real;
    }
    assert.deepEqual((await outsOf(D)).map((o) => o.id), before.map((o) => o.id), "bozuk liste: dokunulmaz");
    const [rep] = await db.select({ cashMoves: s.posDayReports.cashMoves }).from(s.posDayReports).where(and(eq(s.posDayReports.date, D), eq(s.posDayReports.branchId, ASILPOS_SUBE)));
    assert.equal(rep.cashMoves, null, "okunamayan liste saklanmaz");
  });

  test("kilit: AsilPOS satırının tutarı, türü ve günü değişmez, silinmez (yönetici de); yer, belge ve kategori değişir; istek de açılmaz", async () => {
    const [row] = await outsOf(D);
    const base: CashOutData = {
      id: row.id,
      date: row.date,
      kind: row.kind,
      amount: row.amount,
      store: null,
      description: row.description,
      receiptDate: null,
      receiptNo: null,
      vat: null,
      docType: row.docType,
      categoryId: cats.diger,
      toExpenses: true,
      photoId: null,
    };
    const save = (who: typeof users.admin | typeof users.staff, d: Partial<CashOutData>) => db.transaction((tx) => write.writeCashOut(tx, who, { ...base, ...d }));
    await refused(save(users.admin, { amount: 750 }), ASILPOS_CASH_OUT_TEXT.locked);
    await refused(save(users.admin, { kind: "teslim", toExpenses: false, categoryId: null }), ASILPOS_CASH_OUT_TEXT.locked);
    await refused(save(users.admin, { date: "2026-11-23" }), ASILPOS_CASH_OUT_TEXT.locked);
    await refused(
      db.transaction(async (tx) => write.removeCashOut(tx, (await write.lockCashOut(tx, row.id))!)),
      ASILPOS_CASH_OUT_TEXT.delete,
    );
    await save(users.admin, { store: "Migros", docType: "fis", categoryId: 1 });
    const [after] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, row.id));
    assert.deepEqual([after.store, after.docType, after.amount, after.asilposId], ["Migros", "fis", 800, ulid("A1")]);
    assert.equal((await expenseOf(row.id))?.categoryId, 1, "kategori değişti");
    // Yeniden gönderim panelin yazdıklarını ezmez
    await send(day(D, { moves: [move("A1", "harcama", 800, cats.diger), move("A2", "teslim", 200), move("A3", "giris", 50)], revision: 5 }), NOV28);
    const [kept] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, row.id));
    assert.deepEqual([kept.store, kept.docType, kept.description], ["Migros", "fis", "Fişsiz"]);
    assert.equal((await expenseOf(row.id))?.categoryId, 1);
    // Personelin isteği de: tutar değiştiren düzeltme ve silme açılmaz
    const line = { kind: "harcama" as const, amount: 700, store: "Migros", description: "Fişsiz", receiptDate: null, receiptNo: null, vat: null, docType: "fis" as const, categoryId: 1, photoId: null };
    await refused(reqs.proposeCashOutChange(db, users.staff, { op: "duzelt", date: null, cashOutId: row.id, line, message: null, clientKey: "k1" }, NOV28), ASILPOS_CASH_OUT_TEXT.locked);
    await refused(reqs.proposeCashOutChange(db, users.staff, { op: "sil", date: null, cashOutId: row.id, line: null, message: null, clientKey: "k2" }, NOV28), ASILPOS_CASH_OUT_TEXT.delete);
  });

  test("tedarikçi ödemesi: AsilPOS teslimine bağlanır; ödemenin tutarı ya da günü satırı değiştiremez; AsilPOS alışverişi Teslim'e çevrilemez", async () => {
    const date = "2026-11-23";
    await send(day(date, { moves: [move("F1", "teslim", 500), move("F2", "harcama", 90)] }), NOV28);
    const rows = await outsOf(date);
    const teslim = rows.find((o) => o.kind === "teslim")!;
    const harcama = rows.find((o) => o.kind === "harcama")!;
    const entries = await import("../src/server/cari/entries");
    const settle = await import("../src/server/cari/settle");
    const cariKasa = await import("../src/server/cari/kasa");
    const [sup] = await db.insert(s.suppliers).values({ name: "Pınar (test)", key: `pinar-${randomUUID()}` }).returning({ id: s.suppliers.id });
    const none = { mode: "none" as const, lines: [] };
    const pay = (o: { id: number | null; amount: number; date?: string; note?: string | null }) =>
      db.transaction(async (tx) =>
        entries.writePayment(
          tx,
          users.admin,
          await settle.lockCard(tx, sup.id),
          { id: o.id, date: o.date ?? date, amount: o.amount, method: "kasa", cashOut: o.id ? null : { mode: "existing", id: teslim.id }, allocation: none, note: o.note ?? null, photoId: null },
          30,
        ),
      );
    const p = await pay({ id: null, amount: 500 });
    await refused(pay({ id: p.id, amount: 450 }), ASILPOS_CASH_OUT_TEXT.locked);
    await refused(pay({ id: p.id, amount: 500, date: "2026-11-22" }), ASILPOS_CASH_OUT_TEXT.locked);
    await pay({ id: p.id, amount: 500, note: "Pınar'ın şoförüne" });
    const [kept] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, teslim.id));
    assert.deepEqual([kept.amount, kept.date, kept.asilposId], [500, date, ulid("F1")]);
    await refused(
      db.transaction(async (tx) =>
        cariKasa.convertCashOut(tx, users.admin, await settle.lockCard(tx, sup.id), { cashOutId: harcama.id, allocation: none, note: null, photoId: null, confirmPast: [] }, 30),
      ),
      ASILPOS_CASH_OUT_TEXT.locked,
    );
    // Yeniden gönderim bağlı satırı korur
    await send(day(date, { moves: [move("F1", "teslim", 500), move("F2", "harcama", 90)], revision: 2 }), NOV28);
    const [linked] = await db.select({ cashOutId: s.supplierEntries.cashOutId }).from(s.supplierEntries).where(eq(s.supplierEntries.id, p.id));
    assert.equal(linked.cashOutId, teslim.id);
  });

  test("kategorisiz AsilPOS harcamasına personel kategori seçer: Aylık harcamalar'a yazılır (yeni satırın kuralı)", async () => {
    const [row] = await outsOf("2026-11-25");
    assert.equal(await expenseOf(row.id), undefined);
    const out = await db.transaction((tx) =>
      write.writeCashOut(tx, users.staff, {
        id: row.id,
        date: row.date,
        kind: "harcama",
        amount: row.amount,
        store: "Bakkal",
        description: row.description,
        receiptDate: null,
        receiptNo: null,
        vat: null,
        docType: "yok",
        categoryId: cats.diger,
        toExpenses: true,
        photoId: null,
      }),
    );
    assert.ok(out.expenseId, "kayıt açıldı");
    assert.equal((await expenseOf(row.id))?.categoryId, cats.diger);
  });

  // ---------------------------------------------------------------- İnceleme düzeltmeleri (LM-3)

  /** Geçiş gününü değiştirir (test sonunda SWITCH'e döner) */
  const setSwitch = (value: string) => db.update(s.settings).set({ value }).where(eq(s.settings.key, "asilposGecisGunu"));
  const supplierPayment = async (cashOutId: number, date: string, amount: number) => {
    const [sup] = await db.insert(s.suppliers).values({ name: "Tedarikçi (test)", key: `tedarikci-${randomUUID()}` }).returning({ id: s.suppliers.id });
    await db.insert(s.supplierEntries).values({ supplierId: sup.id, kind: "odeme", date, amount, method: "kasa", cashOutId, createdByName: "Yönetici" });
  };
  const staffLine = (date: string, amount: number, o: Partial<CashOutData> = {}) =>
    db.transaction((tx) =>
      write.writeCashOut(
        tx,
        users.staff,
        { id: null, date, kind: "harcama", amount, store: "Migros", description: "süt", receiptDate: null, receiptNo: null, vat: null, docType: "yok", categoryId: 1, toExpenses: true, photoId: null, ...o },
        { branchId: ASILPOS_SUBE },
      ),
    );
  /** Satırın kayıtlı hâli + değişiklik (düzeltme kaydı) */
  const edit = (who: typeof users.admin | typeof users.staff, row: typeof s.cashOuts.$inferSelect, o: Partial<CashOutData>) =>
    db.transaction((tx) =>
      write.writeCashOut(tx, who, {
        id: row.id,
        date: row.date,
        kind: row.kind,
        amount: row.amount,
        store: row.store,
        description: row.description,
        receiptDate: row.receiptDate,
        receiptNo: row.receiptNo,
        vat: row.vat,
        docType: row.docType,
        categoryId: null,
        toExpenses: false,
        photoId: row.photoId,
        ...o,
      }),
    );
  const quietWarn = async <T>(fn: () => Promise<T>): Promise<T> => {
    const real = console.warn;
    console.warn = () => {};
    try {
      return await fn();
    } finally {
      console.warn = real;
    }
  };

  test("hareketin anı takvimde yoksa (25:99) liste düşer, gün yine yazılır: 500 değil", async () => {
    const date = "2026-11-21";
    const bad = { ...move("H1", "harcama", 25, cats.diger), at: "2026-11-21T25:99:00.000Z" };
    const r = await quietWarn(() => send(day(date, { moves: [bad], revision: 5 }), NOV28));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual((await outsOf(date)).filter((o) => o.asilposId === ulid("H1")), [], "satır açılmadı");
  });

  test("geçiş günü sonraya alınınca (gün deneme olur) yeniden gönderim AsilPOS'un açtığı satırları kaldırır; sahiplenilen elle satır ve tedarikçi ödemesine bağlı satır elle girilmiş gibi kalır", async () => {
    const date = "2026-11-05";
    await setSwitch("2026-11-01");
    try {
      const manual = await staffLine(date, 300);
      const moves = [move("J1", "harcama", 300, cats.diger), move("J2", "harcama", 150, cats.diger), move("J3", "teslim", 400), move("J4", "teslim", 250)];
      assert.equal((await send(day(date, { moves }), NOV28)).status, 200);
      const rows = await outsOf(date);
      const of = (tag: string) => rows.find((o) => o.asilposId === ulid(tag))!;
      assert.equal(rows.length, 4);
      assert.equal(of("J1").id, manual.id, "elle satır sahiplenildi");
      assert.ok(await expenseOf(of("J2").id), "AsilPOS'un harcaması Aylık harcamalar'da");
      await supplierPayment(of("J4").id, date, 250);
      await setSwitch("2026-11-06");
      const r = await send(day(date, { moves, revision: 2 }), NOV28);
      assert.deepEqual([r.status, r.body.counted], [200, false]);
      assert.deepEqual(
        (await outsOf(date)).map((o) => [o.id, o.asilposId]),
        [
          [manual.id, null],
          [of("J4").id, null],
        ],
        "sayılmayan gün Kasadan çıkanlar'a bir şey yazmaz",
      );
      assert.equal((await expenseOf(manual.id))?.categoryId, 1, "elle satırın kaydı kalır");
      assert.equal(await expenseOf(of("J2").id), undefined, "AsilPOS'un açtığı satırın kaydı da kalktı");
      // Artık elle satır: yönetici silebilir
      await db.transaction(async (tx) => write.removeCashOut(tx, (await write.lockCashOut(tx, manual.id))!));
    } finally {
      await setSwitch(SWITCH);
    }
  });

  test("AsilPOS günü silinince: sayılmayan günde AsilPOS'un açtığı satırlar kalkar; sayılan günde (409'un çözümü) satırlar elle girilmiş gibi kalır, yeni Z gelince yeniden eşleşir", async () => {
    const trial = "2026-11-07";
    const real = "2026-11-08";
    await setSwitch("2026-11-01");
    try {
      await send(day(trial, { moves: [move("K1", "harcama", 800, cats.diger), move("K2", "teslim", 100)] }), NOV28);
      await send(day(real, { moves: [move("N1", "harcama", 60, cats.diger), move("N2", "teslim", 500)] }), NOV28);
      assert.equal((await outsOf(trial)).length, 2);
      // Deneme günü: geçiş 8 Kasım'a alındı, 7 Kasım'ın kaydı silinir (yeniden gönderim yok)
      await setSwitch(real);
      await asilposAdmin.removeAsilposDay(db, users.admin, "marina", trial, 11, NOV28);
      assert.deepEqual(await outsOf(trial), [], "deneme gününün AsilPOS satırları kalktı");
      // Sayılan gün: AsilPOS'taki Z doğru, paneldeki kayıt silinir
      const before = await outsOf(real);
      await db.update(s.cashOuts).set({ store: "Bakkal" }).where(eq(s.cashOuts.id, before[0].id));
      await asilposAdmin.removeAsilposDay(db, users.admin, "marina", real, 11, NOV28);
      assert.deepEqual(
        (await outsOf(real)).map((o) => [o.id, o.asilposId]),
        before.map((o) => [o.id, null]),
        "satırlar kalır, bağ çözülür (yönetici silebilir)",
      );
      const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Kasadan çıkanlar (AsilPOS)")).orderBy(desc(s.activityLog.id)).limit(1);
      assert.deepEqual([log.userName, log.detail], ["Yönetici", "8 Kasım Pazar: günün AsilPOS kaydı silindi; 2 satır elle girilmiş gibi kaldı (AsilPOS bağı çözüldü)"]);
      // Yeni Z (yeni kurulum: yeni kimlikler) gelince satırlar yeniden eşleşir; panelin yazdığı kalır, kayıt bir kez
      await send(day(real, { zNo: 12, moves: [move("P1", "harcama", 60, cats.diger), move("P2", "teslim", 500)] }), NOV28);
      const again = await outsOf(real);
      assert.deepEqual(
        again.map((o) => [o.id, o.asilposId]),
        [
          [before[0].id, ulid("P1")],
          [before[1].id, ulid("P2")],
        ],
      );
      assert.equal(again[0].store, "Bakkal");
      assert.equal((await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, before[0].id))).length, 1);
    } finally {
      await setSwitch(SWITCH);
    }
  });

  test("Aylık harcamalar kaydı: yöneticinin kaldırdığı kayıt personelin düzeltmesiyle geri gelmez; sahiplenilen faturalı satır faturası beklenmiyorsa fişe düzeltilince kayıt açılmaz; kategori yalnız AsilPOS'un kategorisiz yazdığı harcamada sorulur", async () => {
    const date = "2026-11-09";
    await setSwitch("2026-11-01");
    try {
      const fatura = await staffLine(date, 120, { store: "Metro", docType: "fatura", receiptNo: "A-1", categoryId: null, toExpenses: false });
      await send(day(date, { moves: [move("Q1", "harcama", 800, cats.diger), move("Q2", "harcama", 45), move("Q3", "harcama", 120)] }), NOV28);
      const rows = await outsOf(date);
      const of = (tag: string) => rows.find((o) => o.asilposId === ulid(tag))!;
      assert.equal(of("Q3").id, fatura.id, "faturalı elle satır sahiplenildi");
      // Pencerenin bildiği: kategori yalnız AsilPOS'un kategorisiz yazdığı harcamada (sahiplenilen ve kaydı kaldırılan değil)
      const flags = Object.fromEntries((await outsData.cashOutsOn(date, ASILPOS_SUBE)).map((o) => [o.asilposId, o.asilposAwaitingCategory]));
      assert.deepEqual(flags, { [ulid("Q1")]: false, [ulid("Q2")]: true, [ulid("Q3")]: false });
      // a) Yönetici Q1'in kaydını kapattı (ör. tedarikçinin faturasından sayılıyor); personel yalnız yeri yazar
      await edit(users.admin, of("Q1"), { toExpenses: false });
      assert.equal(await expenseOf(of("Q1").id), undefined);
      await edit(users.staff, of("Q1"), { store: "Bim" });
      await edit(users.staff, of("Q1"), { store: "Bim", categoryId: cats.diger, toExpenses: true });
      assert.equal(await expenseOf(of("Q1").id), undefined, "kaldırılan kayıt geri gelmedi");
      assert.equal((await outsData.cashOutsOn(date, ASILPOS_SUBE)).find((o) => o.id === of("Q1").id)?.asilposAwaitingCategory, false);
      // b) Faturalı satırın faturası "Listeden çıkar"la kapandı: fişe düzeltilince kayıt açılmaz (iki kez sayılırdı)
      await db.transaction((tx) => invoices.updateHandledCashOuts(tx, { add: [{ id: fatura.id, by: "Yönetici" }] }));
      await edit(users.staff, of("Q3"), { docType: "fis", categoryId: 1, toExpenses: true });
      assert.equal(await expenseOf(fatura.id), undefined, "faturası beklenmeyen satırın kaydı açılmadı");
      // c) Kategorisiz AsilPOS harcaması: personel kategori seçmeden kaydedemez, seçince kayıt açılır
      await refused(edit(users.staff, of("Q2"), { store: "Bakkal" }), "Kategori seçin");
      await edit(users.staff, of("Q2"), { store: "Bakkal", categoryId: cats.diger, toExpenses: true });
      assert.equal((await expenseOf(of("Q2").id))?.categoryId, cats.diger);
    } finally {
      await setSwitch(SWITCH);
    }
  });
});
