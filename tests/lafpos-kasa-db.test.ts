// Kasa raporu ve gün kayıtları LafPOS'la uzlaşır, gerçek Postgres'te (denetim B09: E-09, E-35, E-36, E-40; LafPOS planı
// G6, G8): geçiş günü boşken LafPOS günü hiçbir kayda ve hesaba girmez (kapalı işaret kalır, kanıt yok, e-posta ve ay
// rakamı bugünkü gibi); geçiş gününden sonra satışlı LafPOS günü kapalı gün kanıtıdır (personelin isteği reddedilir,
// bekleyen bildirim kapanır, kapalı işaret kalkar), kasa e-postası LafPOS'tan farklı yazılanı söyler, silinip yeniden
// girilen raporun e-postası yeni anahtarla gider, geç rapor LafPOS'un gün sonuyla fotoğrafsız (gelmediyse yazarkasa Z
// fotoğrafıyla) girilir ve yöneticinin kartı LafPOS'un teslimini fişsiz saymaz, raporsuz LafPOS günü ay satırına girer.
//
// Kasa LafPOS'un şubesinin (Marina, LAFPOS_BRANCH_ID) kasasıdır: testler o şubenin seçiminde çalışır (withBranchScope;
// panelde seçiciden Marina seçilmiş gibi). Geçiş günü yalnız o kasanındır; Tuzla'nın kasası ModPOS'ta kalır.
//
// Ayarlar (geçiş günü, kasa e-postası) veritabanında tektir: test kendi geçici veritabanını açar
// (LAFPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda siler; öteki testlerin verisine dokunmaz.
//
// LAFPOS_TEST_DATABASE_URL verilmezse atlanır.
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-kasa-db.test.ts

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES } from "../src/lib/branches";
import type { CashReportFields } from "../src/lib/cash-report";
import { CASH_REQUEST_TEXT } from "../src/lib/cash-requests";
import { CLOSED_TEXT, closedEvidenceText, hasPanelEvidence } from "../src/lib/closed-days";
import { parsePosDay } from "../src/lib/lafpos/day";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { LAFPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_lafpos_kasa_${process.pid}`;
/** Testin "şimdi"si: 12 Kasım 2026 öğlen (iş günü 12 Kasım, dün 11 Kasım) */
const NOW = new Date("2026-11-12T12:00:00+03:00");
const S = "2026-11-01";
const plain = (v: string) => v.replace(/ /g, " ");

describe("Kasa raporu LafPOS'la uzlaşır: veritabanında", { skip: !SERVER_URL && "LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let ingest: typeof import("../src/server/lafpos/ingest");
  let closed: typeof import("../src/server/closed-days");
  let closedReq: typeof import("../src/server/closed-day-requests");
  let store: typeof import("../src/server/cash/report-store");
  let late: typeof import("../src/server/cash/late");
  let email: typeof import("../src/server/cash/report-email");
  let photos: typeof import("../src/server/data/cash-photos");
  let reports: typeof import("../src/server/data/cash-reports");
  let lafposDay: typeof import("../src/server/data/lafpos-day");
  let lateData: typeof import("../src/server/data/cash-late");
  let scope: typeof import("../src/server/branch-scope");
  /** Kasa testi: LafPOS'un şubesinin (Marina) kasasında; okuma ve yazmalar o şubeye bakar */
  const kasaTest = (name: string, fn: () => Promise<void>) => test(name, () => scope.withBranchScope(LAFPOS_SUBE, fn));
  /** Aynı okuma ModPOS'ta kalan şubenin (Tuzla) kasasında */
  const inTuzla = <T>(fn: () => Promise<T>) => scope.withBranchScope(MODPOS_SUBE, fn);
  const users = {
    ali: { id: 0, name: "Ali", role: "admin" as const, email: "lafpos-kasa-ali@ornek.com" },
    ayse: { id: 0, name: "Ayşe", role: "staff" as const, email: "lafpos-kasa-ayse@ornek.com" },
  };
  const sent: { key: string | null; html: string; text: string }[] = [];
  const realFetch = globalThis.fetch;

  const setSwitch = async (day: string | null) => {
    await db.delete(s.settings).where(eq(s.settings.key, "lafposGecisGunu"));
    if (day) await db.insert(s.settings).values({ key: "lafposGecisGunu", value: day });
  };
  /** LafPOS'un gün sonu (gövde ucun ayrıştırıcısından geçer): belgenin örneği, 63 fiş */
  const push = (date: string, zNo: number, z: Record<string, unknown> = {}) => {
    const body = {
      version: 1,
      source: "lafpos",
      date,
      z: {
        zNo,
        receipts: 63,
        zTotal: 20_000,
        cash: 12_000,
        card: 8_000,
        mealCard: 0,
        online: 0,
        other: 0,
        offRevenue: 0,
        discounts: 0,
        openingCash: 1_500,
        cashOut: 450,
        countedCash: 9_350,
        handedOver: 5_000,
        cashDiff: 0,
        cashIn: 1_300,
        expectedCash: 9_350,
        ...z,
      },
      lines: [{ posName: `LATTE ${date}`, siteMenuId: null, slot: null, qty: 2, revenue: 400, isService: false }],
      ikram: [],
      payments: [],
    };
    const parsed = parsePosDay(JSON.stringify(body), NOW);
    assert.ok(parsed.ok, "gövde geçerli");
    return ingest.storePosDay(db, parsed.data, NOW);
  };
  const fields = (date: string, o: Partial<CashReportFields> = {}): CashReportFields & { discounts: number | null } => ({
    date,
    zNo: "14",
    receipts: 63,
    zTotal: 20_000,
    cash: 12_000,
    card: 8_000,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 1_500,
    cashIn: 1_300,
    cashOut: 5_450,
    // Fişlerden fazlası (LafPOS'taki teslim) personelde açıklamasız gönderilmez (bulgu 2)
    cashOutNote: "süt, patrona teslim",
    countedCash: 9_350,
    handedOver: 0,
    bankPos: null,
    offRevenue: 0,
    note: "deneme",
    ...o,
    discounts: o.discounts ?? 0,
  });
  async function report(date: string, o: Partial<CashReportFields> = {}) {
    const r = await store.saveCashReport(db, users.ali, { ...fields(date, o), countedBy: null, revision: 0, photos: [] }, new Date(`${date}T22:00:00+03:00`));
    assert.equal(r.kind, "saved");
    return r.kind === "saved" ? r.row : assert.fail("kaydedilmedi");
  }
  async function closedMark(date: string, createdAt?: Date) {
    const [row] = await db
      .insert(s.specialDays)
      .values({ dateFrom: date, dateTo: date, kind: "kapali", title: "Kafe kapalı", effect: -1, note: null, createdBy: users.ali.id, createdByName: users.ali.name, ...(createdAt ? { createdAt } : {}) })
      .returning({ id: s.specialDays.id });
    return row.id;
  }
  /** LafPOS'un şubesinde (Marina) kapalı işaretli mi: kapalı gün şubenindir (denetim 13 Kasım KP-05) */
  const marked = async (date: string) => (await closed.closedDaysBetween(date, date, db, LAFPOS_SUBE)).length > 0;
  const refused = (p: Promise<unknown>, text: string) => assert.rejects(p, (e: unknown) => e instanceof UserError && e.message === text);

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    // E-posta kurulu (sahte anahtar; istek aşağıdaki sahte fetch'e gider)
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "lafpos-kasa-testi-icin-en-az-otuz-iki-karakterlik-anahtar", RESEND_API_KEY: "re_test_lafpos_kasa" });
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
    for (const k of ["ali", "ayse"] as const) {
      const [u] = await db.insert(s.users).values({ email: users[k].email, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
    ingest = await import("../src/server/lafpos/ingest");
    closed = await import("../src/server/closed-days");
    closedReq = await import("../src/server/closed-day-requests");
    store = await import("../src/server/cash/report-store");
    late = await import("../src/server/cash/late");
    email = await import("../src/server/cash/report-email");
    photos = await import("../src/server/data/cash-photos");
    reports = await import("../src/server/data/cash-reports");
    lafposDay = await import("../src/server/data/lafpos-day");
    lateData = await import("../src/server/data/cash-late");
    scope = await import("../src/server/branch-scope");
    // Resend: yalnız anahtar ve gövde kaydedilir, ağa çıkılmaz
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("https://api.resend.com/")) return realFetch(input, init);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as { html: string; text: string };
      sent.push({ key: headers.get("Idempotency-Key"), html: body.html, text: body.text });
      return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE pos_daily_sales, pos_day_reports, special_days, activity_log, staff_requests, cash_reports, cash_outs, photos, notification_log, integration_state RESTART IDENTITY CASCADE`,
    );
    await setSwitch(null);
    await reports.saveCashSettings({ recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: null });
    sent.length = 0;
  });
  afterEach(() => {
    sent.length = 0;
  });

  kasaTest("geçiş günü boşken LafPOS günü hiçbir kayda girmez: kapalı işaret kalır, kanıt yok, e-posta ve ay rakamı bugünkü gibi", async () => {
    const D = "2026-11-10";
    await closedMark(D);
    assert.equal((await push(D, 12)).ok, true);
    assert.equal(await marked(D), true, "deneme günü kapalı işareti kaldırmaz");
    const evidence = await closed.closedDayEvidence(db, D);
    assert.equal(evidence.lafpos, null);
    assert.equal(hasPanelEvidence(evidence), false);
    assert.deepEqual(await lafposDay.loadKasaLafpos(D), { lafpos: false, day: null });
    assert.equal(await lafposDay.kasaEvidence(db, D), "modpos-z");
    assert.deepEqual(await reports.lafposTillRows(db), []);
    // Kasa raporu (başka bir gün) ve e-postası: LafPOS'tan hiçbir satır yok
    const E = "2026-11-11";
    await push(E, 13, { countedCash: 9_000 });
    const row = await report(E);
    assert.deepEqual(
      (await reports.tillRows(db)).map((r) => [r.date, r.source ?? "rapor"]),
      [[E, "rapor"]],
    );
    const extras = await photos.cashReportExtras(reports.toCashDTO(row));
    assert.equal(extras.kasa, undefined);
    assert.equal(extras.lafposDiffs, undefined);
    const out = await email.emailReport(row.id, { site: Promise.resolve(null) });
    assert.equal(out.status, "sent");
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].html, /LafPOS/);
    assert.match(sent[0].html, /ModPOS Z raporu/);
  });

  kasaTest("E-36: geçiş gününden sonra satışlı LafPOS günü kanıt; personelin 'Kafe kapalıydı'sı reddedilir, kırmızı satır tutarsız", async () => {
    await setSwitch(S);
    const D = "2026-11-11";
    await push(D, 14);
    const evidence = await closed.closedDayEvidence(db, D);
    assert.deepEqual(evidence.lafpos, { zNo: 14, receipts: 63, zTotal: 20_000 });
    assert.equal(hasPanelEvidence(evidence), true);
    assert.ok(closedEvidenceText(evidence).red.includes("LafPOS'ta Z 14 · 63 fiş"));
    await refused(closedReq.proposeClosedDay(db, users.ayse, { date: D, reason: null, clientKey: null }, NOW), CLOSED_TEXT.evidence);
    // Geçiş gününden önceki gün (deneme) kanıt değil
    await setSwitch("2026-11-12");
    assert.equal((await closed.closedDayEvidence(db, D)).lafpos, null);
  });

  kasaTest("E-36: satışlı LafPOS günü bekleyen bildirimi kapatır ve kapalı işareti kaldırır; satışsız ya da geçiş gününden önceki gün dokunmaz", async () => {
    await setSwitch(S);
    const D = "2026-11-11";
    const req = await closedReq.proposeClosedDay(db, users.ayse, { date: D, reason: "elektrik yoktu", clientKey: null }, NOW);
    assert.equal(req.row.status, "pending");
    await push(D, 14);
    const [after] = await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, req.row.id));
    assert.equal(after.status, "superseded");
    assert.equal(after.reviewNote, "LafPOS gün sonu geldi (Z 14 · 63 fiş)");
    // Onaylanmış tek günlük kapalı işaret kalkar, işlem geçmişine (yöneticinin zili) yazılır
    const D2 = "2026-11-09";
    await closedMark(D2);
    await push(D2, 12);
    assert.equal(await marked(D2), false);
    // İşletme geneli işaret yalnız LafPOS'un şubesi için kalktı: ModPOS'ta kalan şube (Tuzla) kapalı kalır
    assert.equal(await closed.isClosedDay(D2, db, MODPOS_SUBE), true);
    const logs = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Kapalı gün işareti kaldırıldı (kanıt geldi)"));
    assert.equal(logs.length, 1);
    assert.match(logs[0].detail ?? "", /LafPOS gün sonu geldi \(Z 12 · 63 fiş\)/);
    // Satışsız gün sonu (fiş ve Z toplamı 0) işareti kaldırmaz
    const D3 = "2026-11-08";
    await closedMark(D3);
    await push(D3, 11, { receipts: 0, zTotal: 0, cash: 0, card: 0, countedCash: 1_500, cashOut: 0, handedOver: 0, cashIn: 0, expectedCash: 1_500 });
    assert.equal(await marked(D3), true);
    // Geçiş gününden önceki gün: işaret kalır
    await setSwitch("2026-11-07");
    const D4 = "2026-11-05";
    await closedMark(D4);
    await push(D4, 9);
    assert.equal(await marked(D4), true);
  });

  kasaTest("E-36 (inceleme): satışlı gün sonundan sonra yöneticinin bilerek koyduğu kapalı işareti yeniden gönderim kaldırmaz", async () => {
    await setSwitch(S);
    const D = "2026-11-10";
    // İlk gönderim NOW'da (satışlı); yönetici kanıtı görüp bir saat sonra "Kafe kapalıydı" der
    await push(D, 13);
    await closedMark(D, new Date(NOW.getTime() + 3_600_000));
    // LafPOS aynı günü aynı Z no ile düzeltip yeniden gönderir: işaret kalır, zile yazılmaz
    await push(D, 13, { countedCash: 9_300, cashDiff: -50 });
    assert.equal(await marked(D), true);
    assert.equal((await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Kapalı gün işareti kaldırıldı (kanıt geldi)"))).length, 0);
    // İlk gönderim satışsızdı (kanıt değildi): sonra satışlı gelince işaret kalkar
    const D2 = "2026-11-09";
    const idle = { receipts: 0, zTotal: 0, cash: 0, card: 0, countedCash: 1_500, cashOut: 0, handedOver: 0, cashIn: 0, expectedCash: 1_500 };
    await push(D2, 12, idle);
    await closedMark(D2, new Date(NOW.getTime() + 3_600_000));
    await push(D2, 12);
    assert.equal(await marked(D2), false);
    // İşaret ilk satışlı gönderimden önce konmuş ve o gönderim onu kaldırmamışsa (geçiş günü o an boştu) yeniden gönderim kaldırır
    const D3 = "2026-11-08";
    await setSwitch(null);
    await closedMark(D3, new Date(NOW.getTime() - 3_600_000));
    await push(D3, 11);
    assert.equal(await marked(D3), true, "geçiş günü boşken dokunulmaz");
    await setSwitch(S);
    await push(D3, 11);
    assert.equal(await marked(D3), false);
  });

  kasaTest("E-09 + E-40: e-posta LafPOS'tan farklı yazılanı söyler; silinip yeniden girilen raporun e-postası yeni anahtarla gider", async () => {
    await setSwitch(S);
    const D = "2026-11-11";
    // LafPOS 9.000 saydı; personel 9.350 yazdı
    await push(D, 14, { countedCash: 9_000, cashDiff: -350 });
    const first = await report(D);
    const extras = await photos.cashReportExtras(reports.toCashDTO(first));
    assert.equal(extras.kasa, "LafPOS");
    assert.deepEqual(
      extras.lafposDiffs?.map((d) => [d.field, d.saved, d.lafpos]),
      [["countedCash", 9_350, 9_000]],
    );
    assert.equal((await email.emailReport(first.id, { site: Promise.resolve(null) })).status, "sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].key, `cash-${first.id}-r1`);
    assert.match(plain(sent[0].html), /LafPOS&#39;tan farklı yazılan: Sayılan nakit 9\.350 ₺ \(LafPOS&#39;ta 9\.000 ₺\)/);
    assert.match(plain(sent[0].html), /LafPOS gün sonu \(Z\)/);
    assert.match(plain(sent[0].text), /LafPOS'tan farklı yazılan: Sayılan nakit 9\.350 ₺/);
    // Yönetici raporu siler (kasa-silme onayı gibi), aynı gün yeniden girilir: yeni satır, yine 1. sürüm, yeni anahtar
    await db.transaction((tx) => store.removeCashReport(tx, first.id));
    const again = await report(D, { countedCash: 9_000 });
    assert.notEqual(again.id, first.id);
    assert.equal(again.revision, 1);
    assert.equal((await email.emailReport(again.id, { site: Promise.resolve(null) })).status, "sent");
    assert.equal(sent.length, 2);
    assert.equal(sent[1].key, `cash-${again.id}-r1`);
    assert.notEqual(sent[1].key, sent[0].key);
    assert.doesNotMatch(sent[1].html, /farklı yazılan/, "LafPOS'la aynı yazıldı");
    // İşlem geçmişinin anahtarı şubenin gününe göre kalır (son gönderim; Tuzla dışındaki şubede sonunda şube)
    const logOf = (key: string) => db.select().from(s.notificationLog).where(eq(s.notificationLog.key, key));
    assert.equal((await logOf(`cash:${D}:r1:${LAFPOS_SUBE}`)).length, 1);
    assert.equal((await logOf(`cash:${D}:r1`)).length, 0, "Tuzla'nın anahtarı ayrı");
    // Raporlar LafPOS'un şubesinin kasasında; Tuzla'nın kasası ModPOS'ta kalır: aynı günün Tuzla raporu LafPOS'un gün
    // sonuyla karşılaştırılmaz, e-postası ModPOS der
    assert.deepEqual([first.branchId, again.branchId], [LAFPOS_SUBE, LAFPOS_SUBE]);
    const tuzla = await inTuzla(() => report(D));
    assert.equal(tuzla.branchId, MODPOS_SUBE);
    const other = await photos.cashReportExtras(reports.toCashDTO(tuzla));
    assert.equal(other.kasa, undefined);
    assert.equal(other.lafposDiffs, undefined);
    assert.equal((await email.emailReport(tuzla.id, { site: Promise.resolve(null) })).status, "sent");
    assert.doesNotMatch(sent[2].html, /LafPOS/);
    assert.match(sent[2].html, /ModPOS Z raporu/);
    assert.equal((await logOf(`cash:${D}:r1`)).length, 1);
    assert.equal((await logOf(`cash:${D}:r1:${LAFPOS_SUBE}`)).length, 1, "Marina'nın kaydı ezilmedi");
  });

  kasaTest("G8: geç rapor kanıtı günün kasasına göre: ModPOS Z; LafPOS gün sonu (fotoğrafsız); gelmediyse yazarkasa Z", async () => {
    // Zincirin ilk raporu (geç rapor ilk rapordan sonraki günler için)
    await report("2026-10-30", { openingCash: 0 });
    const photo = async (kind: "kasa-z" | "kasa-okc") => {
      const [p] = await db
        .insert(s.photos)
        .values({ kind, storageKey: `kasa/2026/11/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: users.ayse.id, createdByName: users.ayse.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
        .returning({ id: s.photos.id });
      return p.id;
    };
    const propose = (date: string, photoIds: number[]) =>
      late.proposeLateReport(db, users.ayse, { fields: fields(date), reason: "Akşam internet yoktu", requestVersion: 0, photoIds, handedTo: null, clientKey: null }, NOW);
    // Geçiş günü boş: ModPOS Z fotoğrafı
    await refused(propose("2026-11-06", []), CASH_REQUEST_TEXT.lateZPhoto);
    await setSwitch(S);
    // LafPOS günü gelmedi: yazarkasa Z fotoğrafı
    assert.equal(await lafposDay.kasaEvidence(db, "2026-11-07"), "okc-z");
    assert.equal(await lafposDay.kasaEvidence(db, "2026-11-07", MODPOS_SUBE), "modpos-z", "Tuzla'nın kasası ModPOS'ta kalır");
    await refused(propose("2026-11-07", [await photo("kasa-z")]), CASH_REQUEST_TEXT.lateOkcPhoto);
    const okc = await propose("2026-11-07", [await photo("kasa-okc")]);
    assert.equal(okc.row.status, "pending");
    // LafPOS günü geldi (gün sonu tam, 24 Kasım 2026): geç rapor yok, rapor LafPOS'tan yazılır, personel yalnız gün
    // sonu fotoğrafı ekler
    await push("2026-11-08", 13);
    assert.equal(await lafposDay.kasaEvidence(db, "2026-11-08"), "lafpos");
    assert.equal(await lafposDay.kasaEvidence(db, "2026-11-08", MODPOS_SUBE), "modpos-z", "Marina'nın gün sonu Tuzla'nın kanıtı değil");
    await refused(propose("2026-11-08", []), CASH_REQUEST_TEXT.lateLafpos);
  });

  kasaTest("E-35 + E-09: yöneticinin geç rapor kartı LafPOS'un Z'sini ve farkları gösterir, LafPOS'taki teslimi fişsiz saymaz", async () => {
    await report("2026-10-30", { openingCash: 0 });
    await setSwitch(S);
    const D = "2026-11-08";
    // Panelde yalnız 450 ₺'lik fiş; personel LafPOS'un birleşik çıkanını (5.450) yazdı. Geç rapor LafPOS'un gün sonundan
    // önce açıldı (yazarkasa Z'siyle; gün sonu geldikten sonra geç rapor açılmaz, gün sonu tam), sonra gün sonu geldi
    await db.insert(s.cashOuts).values({ date: D, branchId: LAFPOS_SUBE, kind: "harcama", amount: 450, store: "Migros", description: "süt", createdBy: users.ayse.id, createdByName: users.ayse.name });
    const [dPhoto] = await db
      .insert(s.photos)
      .values({ kind: "kasa-okc", storageKey: `kasa/2026/11/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: users.ayse.id, createdByName: users.ayse.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
      .returning({ id: s.photos.id });
    await late.proposeLateReport(db, users.ayse, { fields: fields(D, { zNo: "13" }), reason: "Akşam internet yoktu", requestVersion: 0, photoIds: [dPhoto.id], handedTo: null, clientKey: null }, NOW);
    await push(D, 13, { countedCash: 9_000 });
    // LafPOS'u gelmeyen gün (yazarkasa Z fotoğrafıyla)
    const [okcPhoto] = await db
      .insert(s.photos)
      .values({ kind: "kasa-okc", storageKey: `kasa/2026/11/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: users.ayse.id, createdByName: users.ayse.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
      .returning({ id: s.photos.id });
    await late.proposeLateReport(db, users.ayse, { fields: fields("2026-11-07", { cashOut: 450 }), reason: "Akşam internet yoktu", requestVersion: 0, photoIds: [okcPhoto.id], handedTo: null, clientKey: null }, NOW);
    const cards = await lateData.lateCards(NOW);
    const card = cards.find((c) => c.date === D)!;
    assert.equal(card.branchId, LAFPOS_SUBE);
    assert.equal(card.lafpos.lafpos, true);
    assert.ok(card.lafpos.day);
    assert.equal(card.unread, false, "LafPOS'un gün sonu kanıt: okunmamış fotoğraf uyarısı yok");
    assert.deepEqual(
      card.lafpos.diffs.map((d) => [d.field, d.saved, d.lafpos]),
      [["countedCash", 9_350, 9_000]],
    );
    assert.equal(card.outs.lafposHanded, 5_000);
    assert.equal(card.outs.unreceipted, 0);
    assert.match(plain(card.outs.warning ?? ""), /Fark LafPOS'ta olup girilmemiş teslim \(5\.000 ₺\), fişsiz değil/);
    assert.doesNotMatch(card.outs.warning ?? "", /fişsiz\)/);
    // Z no sırası yalnız aynı kasanın komşusuyla: 8 Kasım'ın öncesi 7 Kasım'ın bekleyen geç raporu (LafPOS), 7 Kasım'ın
    // öncesi 30 Ekim raporu (ModPOS: LafPOS'ta Z 1'den başlar, karşılaştırılmaz)
    assert.deepEqual(card.lafpos.sameTill, { prev: true, next: true });
    const none = cards.find((c) => c.date === "2026-11-07")!;
    assert.deepEqual([none.lafpos.lafpos, none.lafpos.day, none.lafpos.diffs], [true, null, []]);
    assert.deepEqual(none.lafpos.sameTill, { prev: false, next: true });
    // Geçiş günü boşken aynı kart ModPOS'a göre: LafPOS yok, fark fişsiz
    await setSwitch(null);
    const modpos = (await lateData.lateCards(NOW)).find((c) => c.date === D)!;
    assert.deepEqual([modpos.lafpos.lafpos, modpos.lafpos.day], [false, null]);
    assert.equal(modpos.outs.lafposHanded, null);
    assert.equal(modpos.outs.unreceipted, 5_000);
    assert.match(plain(modpos.outs.warning ?? ""), /5\.000 ₺ fişsiz/);
    assert.deepEqual(modpos.lafpos.sameTill, { prev: true, next: true });
    // Teslimin bir kısmı panelde "Teslim" (inceleme D3): 3.000 girildi, kalan 2.000 girilmemiş teslim, fişsiz yok
    await setSwitch(S);
    await db.insert(s.cashOuts).values({ date: D, branchId: LAFPOS_SUBE, kind: "teslim", amount: 3_000, store: null, description: null, createdBy: users.ayse.id, createdByName: users.ayse.name });
    const partial = (await lateData.lateCards(NOW)).find((c) => c.date === D)!;
    assert.equal(partial.outs.lafposHanded, 2_000);
    assert.equal(partial.outs.unreceipted, 0);
    assert.match(plain(partial.outs.warning ?? ""), /o güne kayıtlı kasadan çıkan 3\.450 ₺\. Fark LafPOS'ta olup girilmemiş teslim \(2\.000 ₺\), fişsiz değil/);
  });

  kasaTest("inceleme U6: Girilmemiş günler LafPOS gün sonu gelen günü işaretler (fotoğraf gerekmez); geçiş günü boşken hiç", async () => {
    await report("2026-10-30", { openingCash: 0 });
    await push("2026-11-08", 13);
    const before = await lateData.staffLateDays(users.ayse, NOW);
    assert.ok(before.some((d) => d.date === "2026-11-08"));
    assert.equal(before.some((d) => "lafpos" in d), false, "geçiş günü boşken bugünkü gibi");
    await setSwitch(S);
    const days = await lateData.staffLateDays(users.ayse, NOW);
    assert.deepEqual(days.filter((d) => d.lafpos).map((d) => d.date), ["2026-11-08"]);
    assert.ok(days.some((d) => d.date === "2026-11-07" && !d.lafpos), "gün sonu gelmeyen LafPOS günü fotoğrafla");
    // Tuzla'nın kasasında (ModPOS) Marina'nın gün sonu hiçbir günü işaretlemez
    await inTuzla(() => report("2026-10-30", { openingCash: 0 }));
    const tuzla = await inTuzla(() => lateData.staffLateDays(users.ayse, NOW));
    assert.ok(tuzla.some((d) => d.date === "2026-11-08"), "Tuzla'da da girilmemiş gün");
    assert.deepEqual(tuzla.filter((d) => d.lafpos), []);
  });

  kasaTest("G6: raporsuz LafPOS günü ay satırına yedek satırla girer; raporu olan gün rapordan; geçiş günü boşken yok", async () => {
    await setSwitch(S);
    await push("2026-11-09", 12);
    await push("2026-11-10", 13, { zTotal: 6_000, cash: 3_000, card: 3_000, discounts: 120 });
    await report("2026-11-09", { zTotal: 19_500 });
    const rows = await reports.tillRows(db);
    assert.deepEqual(
      rows.map((r) => [r.date, r.zTotal, r.source ?? "rapor"]),
      [
        ["2026-11-09", 19_500, "rapor"],
        ["2026-11-10", 6_000, "lafpos"],
      ],
    );
    assert.equal(rows[1].discounts, 120);
    assert.deepEqual(rows.map((r) => r.branchId), [LAFPOS_SUBE, LAFPOS_SUBE]);
    // Tuzla'nın ay satırına Marina'nın LafPOS günü girmez; "Tümü"de Marina'nın satırları
    assert.deepEqual(await inTuzla(() => reports.tillRows(db)), []);
    assert.deepEqual(await inTuzla(() => reports.lafposTillRows(db)), []);
    assert.deepEqual(await scope.withBranchScope(ALL_BRANCHES, () => reports.tillRows(db)), rows);
    assert.deepEqual(
      (await reports.lafposTillRows(db, "2026-11-10", "2026-11-30")).map((r) => r.date),
      ["2026-11-10"],
    );
    await setSwitch("2026-11-10");
    assert.deepEqual(
      (await reports.tillRows(db)).map((r) => [r.date, r.source ?? "rapor"]),
      [
        ["2026-11-09", "rapor"],
        ["2026-11-10", "lafpos"],
      ],
    );
    await setSwitch(null);
    assert.deepEqual(
      (await reports.tillRows(db)).map((r) => r.date),
      ["2026-11-09"],
    );
    // Kapalı işaretli değil: raporu olmayan LafPOS günü ay bilgisinde "rapor yok" kalır (tillMonths, saf testte)
    assert.equal((await db.select().from(s.specialDays).where(and(eq(s.specialDays.kind, "kapali")))).length, 0);
  });

  kasaTest("Kör kasa (inceleme): önceki kör günün devri geç raporda personele sorulmaz; Tuzla'da ve geçişten önce sorulur", async () => {
    const okcPhoto = async () => {
      const [p] = await db
        .insert(s.photos)
        .values({ kind: "kasa-okc", storageKey: `kasa/2026/11/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: users.ayse.id, createdByName: users.ayse.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
        .returning({ id: s.photos.id });
      return p.id;
    };
    const propose = (date: string, photoIds: number[]) =>
      late.proposeLateReport(db, users.ayse, { fields: fields(date, { openingCash: 1_200, note: null }), reason: "Akşam internet yoktu", requestVersion: 0, photoIds, handedTo: null, clientKey: null }, NOW);
    // Geçiş gününden önce: önceki rapor (devri 9.350) kör değil, açılış 1.200 farkı nota sorulur (metin farkı söyler)
    await report("2026-10-30");
    await assert.rejects(propose("2026-11-06", [await okcPhoto()]), (e: unknown) => e instanceof UserError && /Açılış önceki günün devrinden farklı/.test(e.message));
    // Geçiş günü seçili: önceki rapor Marina'nın LafPOS günü (kör); fark sorulmaz, hata metni devri ele vermez
    await setSwitch("2026-10-30");
    const ok = await propose("2026-11-06", [await okcPhoto()]);
    assert.equal(ok.row.status, "pending");
    // Tuzla'nın kasası ModPOS'ta: önceki raporunun devri yine sorulur
    await inTuzla(() => report("2026-11-04"));
    await assert.rejects(
      inTuzla(async () => propose("2026-11-06", [await okcPhoto()])),
      (e: unknown) => e instanceof UserError && /Açılış önceki günün devrinden farklı/.test(e.message),
    );
  });
});
