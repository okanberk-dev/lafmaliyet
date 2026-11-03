// ModPOS kasa föyü ay rakamına yedek, gerçek Postgres'te (docs/MODPOS-API.md › Ay rakamına yedek;
// src/server/data/cash-reports.ts modposTillRows, firstModposTillDay, tillRows): anahtar (settings › modposAyYedegi)
// kapalıyken föy tablosu hiç okunmaz ve ay rakamı bugünkü gibidir; açıkken yalnız kapanmış föy (ve kasası açılmadan
// satış yapılmış föysüz gün) LafPOS'a geçiş gününden önceki raporsuz güne yedek satır olur; açık kasalı föy ve satışsız
// boş gün girmez; rapor ve LafPOS gün sonu kazanır; Gelir-gider'in veri kümesi ile Kasa'nın ay satırı aynı rakamı verir.
//
// Föyler kitapçığın örneğinden (tests/fixtures/modpos/belge-ornegi.xml; kafenin verisi değil). Test kendi geçici
// veritabanını açar (MODPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler.
//
// MODPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: MODPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/modpos-ay-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { kasaMonthLine, resolveMonth, tillMonths } from "../src/lib/cash-month";
import { parsePosDay } from "../src/lib/lafpos/day";
import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import { MODPOS_FALLBACK_KEY } from "../src/lib/modpos/status";
import { addDays } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.MODPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_modpos_ay_${process.pid}`;

const parsed = parseKasaFoyu(readFileSync(join(__dirname, "fixtures/modpos/belge-ornegi.xml"), "utf8"));
assert.ok(parsed.ok, "kitapçığın örneği okunur");
const SAMPLE = parsed.foy;

/** Bütün kasaları kapanmış gün: örneğin tutarları (ciro 28.450,50, kart 16.120,50, ödenmez 145, 214 adisyon) */
const kapali = (day: string): KasaFoyu => ({ ...structuredClone(SAMPLE), kasaGunu: day });
/** Kasası hâlâ açık gün (tutarlar değişir) */
const acik = (day: string): KasaFoyu => {
  const f = kapali(day);
  f.kasalar = f.kasalar.map((k) => ({ ...k, durum: "ACIK" }));
  return f;
};
/** Kasası hiç açılmamış gün: satış varsa föysüz satıştan (`ciro`), yoksa boş */
const bos = (day: string, ciro = 0): KasaFoyu => ({
  ...structuredClone(SAMPLE),
  kasaGunu: day,
  kasalar: [],
  foysuzGunler: ciro ? [{ sube: "Kadıköy Şube", ciro, adisyonSayisi: 7, odemeler: [{ yontem: "Kredi Kartı", kod: "KREDI_KARTI", tutar: ciro }] }] : [],
});

describe("ModPOS föyü ay rakamına yedek: veritabanında", { skip: !SERVER_URL && "MODPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let reports: typeof import("../src/server/data/cash-reports");
  let store: typeof import("../src/server/modpos/store");
  let ingest: typeof import("../src/server/lafpos/ingest");
  let dataset: typeof import("../src/server/data/dataset");

  const setting = async (key: string, value: unknown) => {
    await db.delete(s.settings).where(eq(s.settings.key, key));
    if (value !== undefined) await db.insert(s.settings).values({ key, value });
  };
  const fallback = (v: unknown) => setting(MODPOS_FALLBACK_KEY, v);
  /** Föyü sabah işi gibi ertesi sabah 09:00'da çekilmiş saklar */
  const save = (foy: KasaFoyu) => store.storeFoy(db, foy, new Date(`${addDays(foy.kasaGunu, 1)}T09:00:00+03:00`));
  const report = (date: string, zTotal = 10_000) =>
    db.insert(s.cashReports).values({ date, zTotal, card: 6_000, mealCard: 1_000, cash: zTotal - 7_000, discounts: 0, offRevenue: 0, submittedByName: "Ayşe" });
  const days = (rows: { date: string; source?: string }[]) => rows.map((r) => [r.date, r.source ?? "rapor"]);

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "modpos-ay-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır
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
    reports = await import("../src/server/data/cash-reports");
    store = await import("../src/server/modpos/store");
    ingest = await import("../src/server/lafpos/ingest");
    dataset = await import("../src/server/data/dataset");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE modpos_cash_sheets, cash_reports, pos_daily_sales, pos_day_reports, special_days RESTART IDENTITY CASCADE`);
    await fallback(undefined);
    await setting("lafposGecisGunu", undefined);
  });

  test("anahtar kapalıyken (yok, false, bozuk) föy tablosu okunmaz: yedek satır yok, ay satırları bugünkü gibi", async () => {
    for (const f of [kapali("2026-10-01"), bos("2026-10-03", 1_200)]) await save(f);
    await report("2026-10-16");
    const before = await reports.tillRows(db);
    assert.deepEqual(days(before), [["2026-10-16", "rapor"]]);
    // Tablo gizlenince okuyan sorgu hata verirdi: kapalıyken hiçbiri okumaz
    await db.execute(sql`ALTER TABLE modpos_cash_sheets RENAME TO modpos_cash_sheets_gizli`);
    try {
      // (jsonb'deki "true" metni sürücüde boolean'a döner: bozuk değer örneği olarak kullanılmaz)
      for (const v of [undefined, false, "evet", 1, { acik: true }]) {
        await fallback(v);
        assert.deepEqual(await reports.modposTillRows(db), [], String(v));
        assert.deepEqual(await reports.modposTillRows(db, "2026-10-01", "2026-10-31"), [], String(v));
        assert.equal(await reports.firstModposTillDay(db), null, String(v));
        assert.deepEqual(await reports.tillRows(db), before, String(v));
      }
      // Sınamanın kendisi: açıkken tablo okunur (gizli tabloda hata verir)
      await fallback(true);
      await assert.rejects(reports.modposTillRows(db));
      await assert.rejects(reports.firstModposTillDay(db));
    } finally {
      await db.execute(sql`ALTER TABLE modpos_cash_sheets_gizli RENAME TO modpos_cash_sheets`);
    }
  });

  test("açıkken: kapanmış föy ve satışlı föysüz gün yedek satır; açık kasa ve satışsız boş gün girmez; aralık", async () => {
    for (const f of [bos("2026-09-28"), acik("2026-09-29"), bos("2026-09-30", 1_200), kapali("2026-10-01"), acik("2026-10-02"), bos("2026-10-03"), kapali("2026-10-05")]) await save(f);
    await fallback(true);
    const rows = await reports.modposTillRows(db);
    // Kesinleşmiş satışsız gün (28 Eylül, 3 Ekim) sıfır satırdır; açık kasa (29 Eylül, 2 Ekim) girmez
    assert.deepEqual(
      rows.map((r) => r.date),
      ["2026-09-28", "2026-09-30", "2026-10-01", "2026-10-03", "2026-10-05"],
    );
    assert.deepEqual(rows[0], { date: "2026-09-28", zTotal: 0, card: 0, mealCard: 0, discounts: null, offRevenue: 0, receipts: 0, source: "modpos" });
    assert.deepEqual(rows[2], { date: "2026-10-01", zTotal: 28_450.5, card: 16_120.5, mealCard: 0, discounts: null, offRevenue: 145, receipts: 214, source: "modpos" });
    assert.deepEqual(rows[1], { date: "2026-09-30", zTotal: 1_200, card: 1_200, mealCard: 0, discounts: null, offRevenue: 0, receipts: 7, source: "modpos" });
    assert.deepEqual(
      (await reports.modposTillRows(db, "2026-10-01", "2026-10-04")).map((r) => r.date),
      ["2026-10-01", "2026-10-03"],
    );
    assert.deepEqual(await reports.modposTillRows(db, "2026-10-06", "2026-10-31"), []);
    // Föylerin sayılmaya başladığı gün (hiç rapor yok): en yeni föyden geriye kesintisiz; 4 Ekim'in föyü yok
    assert.equal(await reports.firstModposTillDay(db), "2026-10-05");
    // Açık kasa sonra kapanınca (yeniden çekilir) ve eksik gün gelince kesinti kalkar: 29 Eylül hâlâ açık
    await save(kapali("2026-10-02"));
    await save(kapali("2026-10-04"));
    assert.equal(await reports.firstModposTillDay(db), "2026-09-30");
    assert.deepEqual(
      (await reports.modposTillRows(db, "2026-10-01", "2026-10-31")).map((r) => r.date),
      ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"],
    );
    await db.delete(s.modposCashSheets).where(eq(s.modposCashSheets.day, "2026-09-30"));
    assert.equal(await reports.firstModposTillDay(db), "2026-10-01");
  });

  test("LafPOS'a geçiş günü: föy yalnız ondan önceki günlerde; geçiş gününden itibaren LafPOS gün sonu", async () => {
    for (const day of ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-06"]) await save(kapali(day));
    await fallback(true);
    await setting("lafposGecisGunu", "2026-10-05");
    assert.deepEqual(
      (await reports.modposTillRows(db)).map((r) => r.date),
      ["2026-10-01", "2026-10-03"],
    );
    assert.deepEqual(await reports.modposTillRows(db, "2026-10-05", "2026-10-31"), [], "aralık geçiş gününden sonra");
    // LafPOS'un 5 Ekim gün sonu: aynı gün föy değil LafPOS sayılır (föy zaten sınırın dışında)
    const body = {
      version: 1,
      source: "lafpos",
      date: "2026-10-05",
      z: { zNo: 3, receipts: 50, zTotal: 15_000, cash: 5_000, card: 10_000, mealCard: 0, online: 0, other: 0, offRevenue: 0, discounts: 0, openingCash: 500, cashOut: 0, countedCash: 5_500, handedOver: 0, cashDiff: 0, cashIn: 0, expectedCash: 5_500 },
      lines: [],
      ikram: [],
      payments: [],
    };
    const now = new Date("2026-10-06T12:00:00+03:00");
    const day = parsePosDay(JSON.stringify(body), now);
    assert.ok(day.ok, "gövde geçerli");
    assert.equal((await ingest.storePosDay(db, day.data, now)).ok, true);
    await report("2026-10-03", 9_000);
    // 2 Ekim'in föyü yok: ilk rapordan (3 Ekim) önceki föy kesintisiz değil, 1 Ekim sayılmaz
    assert.deepEqual(days(await reports.tillRows(db)), [
      ["2026-10-03", "rapor"],
      ["2026-10-05", "lafpos"],
    ]);
    await save(kapali("2026-10-02"));
    assert.deepEqual(days(await reports.tillRows(db)), [
      ["2026-10-01", "modpos"],
      ["2026-10-02", "modpos"],
      ["2026-10-03", "rapor"],
      ["2026-10-05", "lafpos"],
    ]);
    // Geçiş günü ilk izinli gündeyse föy hiç sayılmaz
    await setting("lafposGecisGunu", "2026-10-01");
    assert.deepEqual(await reports.modposTillRows(db), []);
    assert.equal(await reports.firstModposTillDay(db), null);
  });

  test("yalnız föyden gelen ayda kasadan satır var sayılır (elle yazılan 0 silinmez); yedek kapalıyken yok", async () => {
    for (const d of ["2026-09-01", "2026-09-02"]) await save(kapali(d));
    assert.equal(await reports.hasTillRowsIn("2026-09", db), false, "yedek kapalı");
    await fallback(true);
    assert.equal(await reports.hasTillRowsIn("2026-09", db), true);
    assert.equal(await reports.hasTillRowsIn("2026-08", db), false);
    assert.equal(await reports.hasCashReportIn("2026-09", db), false, "kasa raporu yine yok");
  });

  test("Gelir-gider'in ay rakamı föyle tamamlanır, eksik gün ilk rapordan aranır; Kasa'nın ay satırı aynı; kapalıyken bugünkü gibi", async () => {
    for (let d = "2026-10-01"; d <= "2026-10-15"; d = addDays(d, 1)) await save(kapali(d));
    for (let d = "2026-10-16"; d <= "2026-10-31"; d = addDays(d, 1)) if (d !== "2026-10-20") await report(d);
    const october = async () => (await dataset.loadDataset()).months.find((m) => m.month === "2026-10")!;

    // Kapalı: raporlar 16 Ekim'de başladı, ayın toplamı uygulanmaz
    const off = await october();
    assert.equal(off.kasa?.till.partialFrom, "2026-10-16");
    assert.deepEqual([off.posRevenue, off.sources?.posRevenue], [null, "none"]);
    assert.equal("modpos" in off.kasa!.till, false);
    assert.equal(kasaMonthLine(off)?.replace(/ /g, " "), "Kasa raporları 16 Ekim'de başladı; bu ayın açık gün ve cirosu elle girilir");

    await fallback(true);
    const on = await october();
    const t = on.kasa!.till;
    assert.equal(t.partialFrom, null, "ay föyle 1 Ekim'den");
    assert.equal(t.reported, 15);
    assert.equal(t.modpos?.length, 15);
    assert.deepEqual(t.missing, ["2026-10-20"], "föy günleri eksik değil; ilk rapordan sonraki raporsuz gün eksik");
    assert.equal(t.openDays, 30);
    assert.equal(t.posRevenue, 15 * 10_000 + 15 * 28_450.5);
    assert.equal(t.discountDays, 15, "föyde indirim yok");
    assert.deepEqual([on.posRevenue, on.sources?.posRevenue, on.openDays], [t.posRevenue, "kasa", 30]);
    assert.equal(kasaMonthLine(on), "Bu ayın açık gün ve cirosu kasa raporlarından (15 gün ModPOS föyünden sayıldı)");

    // Kasa sayfasının hesabı (ayın raporları + LafPOS + föy, ilk satır ve ilk kasa raporu ayrı): aynı satır
    const monthRows = (await reports.tillRows(db)).filter((r) => r.date.slice(0, 7) === "2026-10" && !r.source);
    const monthModpos = await reports.modposTillRows(db, "2026-10-01", "2026-10-31");
    const firstEver = await reports.firstCashReportDate();
    const firstModpos = await reports.firstModposTillDay(db);
    const firstRow = firstModpos !== null && (firstEver === null || firstModpos < firstEver) ? firstModpos : firstEver;
    const [kasa] = tillMonths([...monthRows, ...monthModpos], "2026-11-02", firstRow, undefined, undefined, firstEver ?? undefined);
    assert.equal(kasaMonthLine(resolveMonth("2026-10", undefined, kasa)), kasaMonthLine(on));
    assert.deepEqual([kasa.posRevenue, kasa.openDays, kasa.partialFrom, kasa.missing], [t.posRevenue, t.openDays, t.partialFrom, t.missing]);

    // Rapor girilince rapor kazanır: föy günü raporlu olur
    await report("2026-10-02", 5_000);
    const withReport = (await october()).kasa!.till;
    assert.equal(withReport.reported, 16);
    assert.equal(withReport.modpos?.length, 14);
    assert.equal(withReport.posRevenue, 16 * 10_000 - 5_000 + 14 * 28_450.5);
  });
});
