// Gün sonu tam gerçek Postgres'te (sahibin isteği, 24 Kasım 2026; docs/LAFPOS.md › Gün sonu otomasyonu): 22 Kasım kabul
// gününde (tests/fixtures/kabul-gunu-2026-11-22.json) kasa raporunun Banka POS'u Pavo'nun gün sonlarından, yazarkasa
// alanları LafPOS'un cihaz belgelerinden kendiliğinden yazılır; personel yalnız fotoğraf ekler (kayıt, sürüm, sayan, onay
// yok); fotoğrafın okunuşu LafPOS'la karşılaştırılır; Pavo sonradan gelince boş alan dolar, alınamayan gün sonu kayıtlıyı
// silmez, elle yazılan alan kalır; sayım yokken fotoğraf bekler, rapor yazılınca bağlanır.
//
// Kendi geçici veritabanını açar (LAFPOS_TEST_DATABASE_URL'in sunucusunda), sonunda siler. Değişken yoksa atlanır.
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-gun-sonu-tam-db.test.ts

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { computeCash, withCardExtra } from "../src/lib/cash-report";
import { parsePosDay } from "../src/lib/lafpos/day";
import { okcReconcile } from "../src/lib/okc-z";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_gun_sonu_tam_${process.pid}`;
/** Gün sonunun geldiği an: 23 Kasım 2026 01:00 (iş günü hâlâ 22 Kasım) */
const NOW = new Date("2026-11-23T01:00:00+03:00");
const DAY = "2026-11-22";

/** Kabul gününün gövdesi; Pavo'nun gün sonu (batch 0001 = 4.160; 5.030 − 870 yazarkasadan geçmeyen) ve cihaz belgeleri */
const kabul = () => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/kabul-gunu-2026-11-22.json"), "utf8")) as Record<string, unknown> & { z: Record<string, unknown>; bankPos: Record<string, unknown> };
const BATCH = { batchNo: "0001", at: "2026-11-22T21:26:00.000Z", total: 4_160, trigger: "otomatik", dayClosed: true };
const OKC = { provider: "pavo", zReport: false, docs: 19, cash: 1_055, card: 4_160, mealCard: 0, other: 0, total: 5_215, voided: { count: 0, cash: 0, card: 0 }, vat: [{ rate: 10, total: 5_215, vat: 474.09 }] };
const okBank = (total = 4_160) => ({ ...kabul().bankPos, status: "ok", pavoCard: total, lafposCard: 4_160, diff: total - 4_160, batches: [{ ...BATCH, total }], dayCard: 4_160 });
const FAILED = { status: "failed", batchNo: null, at: "2026-11-22T21:26:00.000Z", pavoCard: null, lafposCard: 4_160, diff: null, acquirers: [], message: "Günsonu alınamadı (kod 5085)", errorCode: "5085", batches: [], dayCard: 4_160 };

const amt = (v: number | null) => ({ text: v === null ? null : String(v), value: v, confidence: "high" });
/** Pavo gün sonu fişinin okunuşu (ai_calls.result, KasaOkcRaw) */
const slip = (batches: { no: string; net: number }[], date = DAY) => ({
  documentType: "batch_slip",
  fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: false },
  readable: true,
  title: null,
  date,
  time: "23:59",
  dateConfidence: "high",
  zNo: { text: null, value: null, confidence: "high" },
  receiptCount: { text: null, value: null, confidence: "high" },
  dailyTotal: amt(null),
  dailyTotalLabel: null,
  kdvGroups: [],
  totalVat: amt(null),
  payments: [],
  outside: [],
  voids: amt(null),
  discounts: amt(null),
  cumulativeTotal: amt(null),
  cumulativeVat: amt(null),
  batches: batches.map((b) => ({ bank: "Garanti BBVA", batchNo: b.no, date, salesTotal: amt(b.net), refundTotal: amt(null), netTotal: amt(b.net), transactionCount: null })),
  issues: [],
});

/** Pavo'nun istenince bastığı detaylı Z'nin okunuşu: banka gün sonu (batch 0001) ve Z rakamları aynı fişte */
const detailed = (o: { card?: number } = {}) => ({
  ...slip([{ no: "0001", net: 4_160 }]),
  documentType: "z_report",
  title: "Z RAPORU",
  zNo: { text: "0007", value: 7, confidence: "high" },
  dailyTotal: amt(5_215),
  payments: [
    { label: "NAKİT", count: null, amount: amt(1_055), kind: "cash" },
    { label: "KREDİ KARTI", count: null, amount: amt(o.card ?? 4_160), kind: "card" },
  ],
  kdvGroups: [{ rate: 10, total: amt(5_215), vat: amt(474.09), base: null }],
});

describe("Gün sonu tam: veritabanında", { skip: !SERVER_URL && "LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let ingest: typeof import("../src/server/lafpos/ingest");
  let gun: typeof import("../src/server/lafpos/gun-sonu");
  let foto: typeof import("../src/server/lafpos/foto");
  let store: typeof import("../src/server/cash/report-store");
  let scope: typeof import("../src/server/branch-scope");
  let kasa: typeof import("../src/server/data/lafpos-day");
  const ali = { id: 0, name: "Ali", role: "admin" as const, email: "tam-ali@ornek.com" };
  const ayse = { id: 0, name: "Ayşe", role: "staff" as const, email: "tam-ayse@ornek.com" };

  const push = (o: Record<string, unknown> = {}, z: Record<string, unknown> = {}) => {
    const body: Record<string, unknown> & { z: Record<string, unknown> } = { ...kabul(), bankPos: okBank(), okc: OKC, ...o };
    body.z = { ...body.z, ...z };
    if (body.bankPos === undefined) delete body.bankPos;
    const parsed = parsePosDay(JSON.stringify(body), NOW);
    assert.ok(parsed.ok, "gövde geçerli");
    return ingest.storePosDay(db, parsed.data, NOW);
  };
  const report = async () => {
    const [row] = await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, DAY), eq(s.cashReports.branchId, LAFPOS_SUBE)));
    return row ?? null;
  };
  const state = async () => {
    const [row] = await db.select().from(s.lafposDayEnds).where(and(eq(s.lafposDayEnds.date, DAY), eq(s.lafposDayEnds.branchId, LAFPOS_SUBE)));
    return row ?? null;
  };
  /** Personelin yüklediği gün sonu fotoğrafı ve okunuşu (okuma kapalıysa `read` null) */
  const photo = async (read: unknown | null, by: { id: number; name: string } = ayse) => {
    const [p] = await db
      .insert(s.photos)
      .values({ kind: "kasa-okc", storageKey: `kasa/2026/11/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: by.id, createdByName: by.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
      .returning({ id: s.photos.id });
    if (read) await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "test", status: "ok", photoId: p.id, userId: by.id, result: read });
    return p.id;
  };
  const refused = async (p: Promise<unknown>, text: RegExp) => {
    await assert.rejects(p, (e: Error) => text.test(e.message), "reddedilmeli");
  };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "gun-sonu-tam-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    for (const u of [ali, ayse]) {
      const [row] = await db.insert(s.users).values({ email: u.email, name: u.name, passwordHash: "x", role: u.role }).returning({ id: s.users.id });
      u.id = row.id;
    }
    ingest = await import("../src/server/lafpos/ingest");
    gun = await import("../src/server/lafpos/gun-sonu");
    foto = await import("../src/server/lafpos/foto");
    store = await import("../src/server/cash/report-store");
    scope = await import("../src/server/branch-scope");
    kasa = await import("../src/server/data/lafpos-day");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE lafpos_day_ends, pos_daily_sales, pos_day_reports, pos_day_revisions, activity_log, staff_requests, cash_report_photos, cash_reports, cash_outs, ai_calls, photos RESTART IDENTITY CASCADE`);
    await db.delete(s.settings).where(eq(s.settings.key, "lafposGecisGunu"));
    await db.insert(s.settings).values({ key: "lafposGecisGunu", value: DAY });
  });

  test("22.11 kabul günü: Banka POS Pavo'dan, yazarkasa alanları LafPOS'un cihaz belgelerinden; not eksik söylemez, personelden yalnız fotoğraf", async () => {
    assert.ok((await push()).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "written");
    const rep = (await report())!;
    assert.ok(rep, "rapor yazıldı");
    assert.deepEqual(
      [rep.bankPos, rep.okcReceipts, rep.okcTotal, rep.okcCash, rep.okcCard, rep.okcMealCard, rep.okcOther, rep.okcVatTotal, rep.okcZNo],
      [4_160, 19, 5_215, 1_055, 4_160, 0, 0, 474.09, "11"],
    );
    assert.deepEqual(rep.okcVat, [{ rate: 10, total: 5_215, vat: 474.09 }]);
    assert.equal(rep.note, "LafPOS gün sonundan otomatik yazıldı.");
    assert.equal(rep.countedBy, null);
    assert.equal(rep.submittedByName, "LafPOS (otomatik)");
    assert.deepEqual((await state())?.missing, ["photo"], "personelin tek işi fotoğraf");
    // Kart karşılaştırması: Banka POS = LafPOS kartı − yazarkasadan geçmeyen; yazarkasa ↔ LafPOS satırları tutuyor
    const laf = (await kasa.loadLafposDay(DAY, db, LAFPOS_SUBE))!;
    const f = withCardExtra(rep, laf.cardExtra, laf.offDevice, "LafPOS");
    assert.equal(computeCash(f).cardDiff, 0);
    assert.deepEqual(
      okcReconcile(f, "admin", "LafPOS").filter((l) => l.tone === "warn"),
      [],
    );
    // Personelin sayfası: istenen tek fotoğraf
    const st = (await foto.lafposPhotoState(db, DAY, LAFPOS_SUBE, "staff"))!;
    assert.deepEqual([st.auto, st.need.count, st.attached, st.done, st.line, st.check], [true, 1, 0, false, "Pavo'dan gün sonu fişini (detaylı Z) alın ve fotoğrafını ekleyin", null]);
  });

  test("Personel yalnız fotoğraf ekler: kayıt, sürüm, sayan ve onay yok; okunuş LafPOS'la karşılaştırılır (fark yöneticinin)", async () => {
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const before = (await report())!;
    const id = await photo(slip([{ no: "0001", net: 4_160 }]));
    // Ertesi gün (rapor günü kapanmış, sonraki günün raporu girilmiş olsa da) personel ekler
    const later = new Date("2026-11-24T14:00:00+03:00");
    const res = await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: id }, later);
    assert.deepEqual([res.status, res.attached, res.line], ["linked", 1, "Fotoğraf alındı"]);
    const rep = (await report())!;
    assert.deepEqual(
      [rep.revision, rep.submittedByName, rep.countedBy, rep.countedByName, rep.bankPos, rep.note],
      [before.revision, "LafPOS (otomatik)", null, null, 4_160, before.note],
      "rapor değişmedi",
    );
    assert.equal((await db.select().from(s.cashReportRevisions)).length, 0, "sürüm yok");
    const links = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, rep.id));
    assert.deepEqual(links.map((l) => [l.photoId, l.kind]), [[id, "kasa-okc"]]);
    const st = (await state())!;
    assert.deepEqual(st.missing, [], "tamam");
    assert.equal(st.photoCheck?.state, "uyumlu", JSON.stringify(st.photoCheck));
    const log = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Gün sonu fotoğrafı (LafPOS günü)"));
    assert.equal(log.length, 1);
    assert.equal(log[0].userName, "Ayşe");
    // Aynı fotoğraf ikinci kez: değişmez
    await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: id }, later);
    assert.equal((await db.select().from(s.cashReportPhotos)).length, 1);
    // Farklı tutarlı ikinci fiş: yöneticiye fark, personele yine "alındı"
    const other = await photo(slip([{ no: "0001", net: 4_100 }]));
    const res2 = await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: other }, later);
    assert.equal(res2.line, "Fotoğraf alındı");
    const st2 = (await state())!;
    assert.equal(st2.photoCheck?.state, "fark");
    assert.ok(st2.photoCheck?.issues.some((i) => i.startsWith("Banka POS toplamı")), JSON.stringify(st2.photoCheck?.issues));
    assert.equal((await foto.lafposPhotoState(db, DAY, LAFPOS_SUBE, "staff"))?.check, null, "personel karşılaştırmayı görmez");
    assert.equal((await foto.lafposPhotoState(db, DAY, LAFPOS_SUBE, "admin"))?.check?.state, "fark");
    // Başkasının fotoğrafı, 14 günden eski gün, elle girilen rapor: kapalı
    const alis = await photo(null, ali);
    await refused(foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: alis }, later), /Fotoğraf bulunamadı/);
    await refused(foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo(null) }, new Date("2026-12-10T12:00:00+03:00")), /14 günden eski/);
    await refused(foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: "tuzla", photoId: await photo(null) }, later), /eklenemez/);
  });

  test("Okuma kapalıyken fotoğraf yine alınır (personel 'alındı' görür, yöneticiye 'okunmadı'); yanlış belge yeniden çekilir", async () => {
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const off = await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo(null) }, NOW);
    assert.equal(off.line, "Fotoğraf alındı");
    assert.equal((await state())?.photoCheck?.state, "okunmadi");
    assert.deepEqual((await state())?.missing, []);
    await db.execute(sql`TRUNCATE cash_report_photos, lafpos_day_ends, cash_reports RESTART IDENTITY CASCADE`);
    await gun.writeAutoReport(db, DAY, NOW);
    const wrong = await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo({ ...slip([]), documentType: "other" }) }, NOW);
    assert.equal(wrong.line, "Fotoğraf okunamadı / yanlış belge, yeniden çekin");
    assert.deepEqual((await state())?.missing, ["photo"], "gün tamamlanmadı");
  });

  test("Pavo sonradan: boş Banka POS dolar; alınamayan gün sonu kayıtlıyı silmez ve tam nedeni yazar; elle yazılan alan kalır", async () => {
    // Kapanışta Pavo sonucu henüz yok
    assert.ok((await push({ bankPos: undefined })).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "written");
    assert.equal((await report())?.bankPos, null, "uydurulmaz");
    assert.equal((await report())?.note, "LafPOS gün sonundan otomatik yazıldı. Eksik: Banka POS: LafPOS'tan Pavo gün sonu gelmedi.");
    // Pavo'nun sonucu gelmedi, fotoğraf da yok: gün tamam sayılmaz (fotoğraf bekleniyor)
    assert.deepEqual((await state())?.missing, ["bankPos", "photo"]);
    // Otomatik gün sonu alınamadı (5085)
    assert.ok((await push({ bankPos: FAILED })).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "updated");
    assert.equal((await report())?.bankPos, null);
    assert.match((await report())?.note ?? "", /Banka POS: Pavo gün sonu alınamadı \(hata 5085: Günsonu alınamadı \(kod 5085\)\); LafPOS'ta Yönetim › Yazarkasa POS › Cihazda gün sonu al\.$/);
    assert.deepEqual((await state())?.missing, ["bankPos", "photo"]);
    // Elle yeniden alındı: Banka POS dolar, not temizlenir
    assert.ok((await push({ bankPos: okBank() })).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "updated");
    assert.equal((await report())?.bankPos, 4_160);
    assert.equal((await report())?.note, "LafPOS gün sonundan otomatik yazıldı.");
    // Sonra yine alınamayan bir sonuç gelse de kayıtlı Banka POS silinmez
    assert.ok((await push({ bankPos: FAILED })).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    assert.equal((await report())?.bankPos, 4_160, "boş değer kayıtlıyı silmez");
    // Yönetici Banka POS'u elle 4.200 yaptı: sonraki otomatik değer ezmez
    const rep = (await report())!;
    const saved = await scope.withBranchScope(LAFPOS_SUBE, () =>
      store.saveCashReport(
        db,
        ali,
        {
          date: DAY,
          zNo: rep.zNo,
          receipts: rep.receipts,
          zTotal: rep.zTotal,
          cash: rep.cash,
          card: rep.card,
          mealCard: rep.mealCard,
          online: rep.online,
          other: rep.other,
          openingCash: rep.openingCash,
          cashIn: rep.cashIn,
          cashOut: rep.cashOut,
          cashOutNote: rep.cashOutNote,
          countedCash: rep.countedCash,
          handedOver: rep.handedOver,
          bankPos: 4_200,
          offRevenue: rep.offRevenue,
          discounts: rep.discounts,
          note: rep.note,
          countedBy: null,
          revision: rep.revision,
          photos: [],
        },
        NOW,
      ),
    );
    assert.equal(saved.kind, "saved");
    assert.ok((await push({ bankPos: okBank(4_150) })).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    assert.equal((await report())?.bankPos, 4_200, "elle yazılan kalır");
  });

  test("Pavo detaylı Z: tek fotoğraf; batch ve Z rakamları LafPOS'la karşılaştırılır, LafPOS Z no göndermediyse fotoğraftaki yazılır (LafPOS'unki gelince o geçer); kart farkı yalnız yöneticiye", async () => {
    assert.ok((await push({}, { okcZNo: null })).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    assert.equal((await report())?.okcZNo, null);
    const staffState = (await foto.lafposPhotoState(db, DAY, LAFPOS_SUBE, "staff"))!;
    assert.deepEqual(staffState.need, { slip: true, z: false, count: 1 }, "Pavo gününde tek fotoğraf (zReport false olsa da)");
    assert.equal(staffState.line, "Pavo'dan gün sonu fişini (detaylı Z) alın ve fotoğrafını ekleyin");
    const before = (await report())!;
    const id = await photo(detailed());
    const res = await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: id }, NOW);
    assert.equal(res.line, "Fotoğraf alındı");
    const st = (await state())!;
    assert.equal(st.photoCheck?.state, "uyumlu", JSON.stringify(st.photoCheck));
    assert.equal(st.photoCheck?.zNoFromPhoto, "0007");
    assert.deepEqual(st.missing, [], "tek fotoğrafla tamam");
    const rep = (await report())!;
    assert.deepEqual([rep.okcZNo, rep.revision, rep.submittedByName, rep.bankPos], ["0007", before.revision, "LafPOS (otomatik)", 4_160], "boş Z no fotoğraftan; sürüm yok");
    assert.equal((st.autoValues as Record<string, unknown>).okcZNo, "0007");
    assert.equal((await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Yazarkasa Z no fotoğraftan yazıldı (LafPOS günü)"))).length, 1);
    // Kartı farklı okunan ikinci fotoğraf: yöneticiye fark, personele yine "alındı" ve karşılaştırma yok
    const res2 = await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo(detailed({ card: 4_100 })) }, NOW);
    assert.equal(res2.line, "Fotoğraf alındı");
    const admin2 = (await foto.lafposPhotoState(db, DAY, LAFPOS_SUBE, "admin"))!.check!;
    assert.equal(admin2.state, "fark");
    assert.ok(admin2.issues.some((i) => i.startsWith("Yazarkasa kartı")), JSON.stringify(admin2.issues));
    assert.equal((await foto.lafposPhotoState(db, DAY, LAFPOS_SUBE, "staff"))?.check, null, "personel görmez");
    // LafPOS sonradan Z no gönderdi: onunki geçer (fotoğraftaki elle düzeltilmiş sayılmaz), fark yöneticiye
    assert.ok((await push({}, { okcZNo: "12" })).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    assert.equal((await report())?.okcZNo, "12");
    const st3 = (await state())!;
    assert.equal(st3.photoCheck?.zNoFromPhoto ?? null, null);
    assert.ok(st3.photoCheck?.issues.some((i) => i.startsWith("Yazarkasa Z no")), JSON.stringify(st3.photoCheck?.issues));
  });

  test("Fotoğraftan Z no: başka günün Z'si yazılmaz; yöneticinin sildiği Z no geri yazılmaz (yeniden gönderim, yeni fotoğraf); otomatik rapor kendi kaydından tanınır", async () => {
    assert.ok((await push({}, { okcZNo: null })).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    // Dünün detaylı Z'si (21.11): fark, Z no boş kalır
    const yesterday = { ...detailed(), date: "2026-11-21", time: "23:30", zNo: { text: "0006", value: 6, confidence: "high" } };
    await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo(yesterday) }, NOW);
    assert.equal((await state())!.photoCheck?.state, "fark");
    assert.equal((await report())?.okcZNo, null, "başka günün Z no'su yazılmaz");
    await db.delete(s.cashReportPhotos);
    // Doğru günün fişi: Z no yazılır; yönetici siler, sonra ne LafPOS'un yeniden gönderimi ne yeni fotoğraf geri yazar
    await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo(detailed()) }, NOW);
    const rep = (await report())!;
    assert.equal(rep.okcZNo, "0007");
    assert.equal(await foto.lafposAutoReport(db, rep.id), true);
    await db.update(s.cashReports).set({ okcZNo: null }).where(eq(s.cashReports.id, rep.id));
    assert.ok((await push({}, { okcZNo: null })).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    assert.equal((await report())?.okcZNo, null, "yeniden gönderim geri yazmaz");
    await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo(detailed()) }, NOW);
    assert.equal((await report())?.okcZNo, null, "yeni fotoğraf geri yazmaz");
  });

  test("Pavo alınamadıysa yönetici fotoğrafta okunan toplamı 'Banka POS'a yaz'la yazar; sonraki otomatik değer ezmez", async () => {
    assert.ok((await push({ bankPos: FAILED })).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo(slip([{ no: "0001", net: 4_160 }])) }, NOW);
    const check = (await state())!.photoCheck!;
    assert.equal(check.readBankPos, 4_160);
    await refused(foto.setLafposBankPosCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, amount: 4_160 }, NOW), /yalnız yönetici/);
    await foto.setLafposBankPosCore(db, ali, { date: DAY, branchId: LAFPOS_SUBE, amount: check.readBankPos! }, NOW);
    const rep = (await report())!;
    assert.deepEqual([rep.bankPos, rep.revision, rep.submittedByName, rep.countedBy], [4_160, 2, "Ali", null]);
    assert.ok((await push({ bankPos: okBank(4_100) })).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    assert.equal((await report())?.bankPos, 4_160, "yöneticinin yazdığı kalır");
  });

  test("Sayım yokken fotoğraf bekler, LafPOS sayınca yazılan rapora bağlanır", async () => {
    assert.ok((await push({}, { countedCash: null, cashDiff: null })).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "no-count");
    const id = await photo(slip([{ no: "0001", net: 4_160 }]));
    const res = await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: id }, NOW);
    assert.equal(res.status, "pending");
    assert.deepEqual((await state())?.pendingPhotos, [id]);
    assert.equal(await report(), null);
    // LafPOS föyde saydı ve yeniden gönderdi
    assert.ok((await push()).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "written");
    const rep = (await report())!;
    const links = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, rep.id));
    assert.deepEqual(links.map((l) => l.photoId), [id]);
    const st = (await state())!;
    assert.deepEqual([st.pendingPhotos, st.missing, st.photoCheck?.state], [[], [], "uyumlu"]);
  });

  test("Sayım yokken bekleyen fotoğraf, rapor elle girilince o rapora bağlanır (sahipsiz kalmaz)", async () => {
    assert.ok((await push({}, { countedCash: null, cashDiff: null })).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "no-count");
    const id = await photo(slip([{ no: "0001", net: 4_160 }]));
    assert.equal((await foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: id }, NOW)).status, "pending");
    const r0 = await scope.withBranchScope(LAFPOS_SUBE, () =>
      store.saveCashReport(
        db,
        ali,
        { date: DAY, zNo: "11", receipts: 26, zTotal: 6_285, cash: 1_255, card: 5_030, mealCard: 0, online: 0, other: 0, openingCash: 1_120, cashIn: 0, cashOut: 800, cashOutNote: null, countedCash: 1_279.5, handedOver: 0, bankPos: null, offRevenue: 1_065, discounts: 90, note: null, countedBy: null, revision: 0, photos: [] },
        NOW,
      ),
    );
    assert.equal(r0.kind, "saved");
    const rep = (await report())!;
    const links = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, rep.id));
    assert.deepEqual(links.map((l) => l.photoId), [id]);
    assert.deepEqual((await state())?.pendingPhotos, []);
    // Eski kayıt (düzeltmeden önce bekleyip kalmış): LafPOS'un sonraki gönderimi elle girilen rapora bağlar
    const id2 = await photo(slip([{ no: "0001", net: 4_160 }]));
    await db.update(s.lafposDayEnds).set({ pendingPhotos: [id2] }).where(and(eq(s.lafposDayEnds.date, DAY), eq(s.lafposDayEnds.branchId, LAFPOS_SUBE)));
    assert.ok((await push()).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "human");
    const after2 = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, rep.id));
    assert.deepEqual(after2.map((l) => l.photoId).sort(), [id, id2].sort());
    assert.deepEqual((await state())?.pendingPhotos, []);
  });

  test("Elle girilen raporda bu yol kapalı (eski yol: formun Düzenle'si)", async () => {
    const r0 = await scope.withBranchScope(LAFPOS_SUBE, () =>
      store.saveCashReport(
        db,
        ali,
        { date: DAY, zNo: "11", receipts: 26, zTotal: 6_285, cash: 1_255, card: 5_030, mealCard: 0, online: 0, other: 0, openingCash: 1_120, cashIn: 0, cashOut: 800, cashOutNote: null, countedCash: 1_279.5, handedOver: 0, bankPos: null, offRevenue: 1_065, discounts: 90, note: null, countedBy: null, revision: 0, photos: [] },
        NOW,
      ),
    );
    assert.equal(r0.kind, "saved");
    assert.ok((await push()).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "human");
    assert.equal(await foto.lafposPhotoState(db, DAY, LAFPOS_SUBE, "staff"), null);
    await refused(foto.attachLafposDayPhotoCore(db, ayse, { date: DAY, branchId: LAFPOS_SUBE, photoId: await photo(null) }, NOW), /elle girildi/);
  });
});
