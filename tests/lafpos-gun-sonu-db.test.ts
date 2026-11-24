// Marina gün sonu otomasyonu gerçek Postgres'te (docs/LAFPOS.md › Gün sonu otomasyonu): LafPOS'un şubesinin (Marina)
// gün sonu geçiş gününden itibaren Kasa raporuna kendiliğinden yazılır ve e-postası gider; aynı içerik ikinci kez gitmez,
// düzeltme "düzeltildi" notuyla bir kez daha gider ve elle düzeltilen alanı ezmez; geçiş gününden önce hiçbir şey olmaz;
// gönderim düşerse kaydı kalır ve günlük iş yeniden dener; geçiş günü sonradan girilince günlük iş eksik günü yakalar;
// personelin girdiği rapora dokunulmaz. Kasa raporunun laffogato.net satırı kasanın şubesiyle sorulur (Tuzla'nınki
// eskisi gibi, `&branch=tuzla`).
//
// Kendi geçici veritabanını açar (LAFPOS_TEST_DATABASE_URL'in sunucusunda), sonunda siler. Değişken yoksa atlanır.
// Çalıştırma: LAFPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/lafpos-gun-sonu-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { parsePosDay } from "../src/lib/lafpos/day";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

import { LAFPOS_SUBE, MODPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_lafpos_gun_sonu_${process.pid}`;
/** Testin "şimdi"si: 23 Kasım 2026 00:30 (iş günü hâlâ 22 Kasım) */
const NOW = new Date("2026-11-23T00:30:00+03:00");
const DAY = "2026-11-22";
const SWITCH = "2026-11-22";

describe("Marina gün sonu otomasyonu: veritabanında", { skip: !SERVER_URL && "LAFPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let ingest: typeof import("../src/server/lafpos/ingest");
  let gun: typeof import("../src/server/lafpos/gun-sonu");
  let store: typeof import("../src/server/cash/report-store");
  let reports: typeof import("../src/server/data/cash-reports");
  let site: typeof import("../src/server/site-sales/sync");
  let scope: typeof import("../src/server/branch-scope");
  const ali = { id: 0, name: "Ali", role: "admin" as const, email: "gun-sonu-ali@ornek.com" };
  const sent: { key: string | null; to: string[]; subject: string; text: string }[] = [];
  const siteCalls: string[] = [];
  let resendStatus = 200;
  /** Sitenin şubeye göre yanıtı: `branch` yazılmazsa eski (şubesiz) site */
  let siteEcho = true;
  const realFetch = globalThis.fetch;

  const setSwitch = async (day: string | null) => {
    await db.delete(s.settings).where(eq(s.settings.key, "lafposGecisGunu"));
    if (day) await db.insert(s.settings).values({ key: "lafposGecisGunu", value: day });
  };
  const push = (date: string, zNo: number, z: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const body = {
      version: 1,
      source: "lafpos",
      sube: "marina",
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
      lines: [{ posName: "LATTE", siteMenuId: null, slot: null, qty: 2, revenue: 400, isService: false }],
      ikram: [],
      payments: [{ name: "Nakit", zField: "cash", channel: null, count: 40, amount: 12_000 }],
      ...extra,
    };
    const parsed = parsePosDay(JSON.stringify(body), NOW);
    assert.ok(parsed.ok, "gövde geçerli");
    return ingest.storePosDay(db, parsed.data, NOW);
  };
  const marinaReport = async (date = DAY) => {
    const [row] = await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, LAFPOS_SUBE)));
    return row ?? null;
  };
  const state = async (date = DAY) => {
    const [row] = await db.select().from(s.lafposDayEnds).where(and(eq(s.lafposDayEnds.date, date), eq(s.lafposDayEnds.branchId, LAFPOS_SUBE)));
    return row ?? null;
  };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      AUTH_SECRET: "gun-sonu-testi-icin-en-az-otuz-iki-karakterlik-anahtar",
      RESEND_API_KEY: "re_test_gun_sonu",
      KARAOKE_SYNC_SECRET: "gun-sonu-site-anahtari-en-az-otuz-iki-karakter",
      LAFFOGATO_URL: "https://site.test",
    });
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
    const [u] = await db.insert(s.users).values({ email: ali.email, name: ali.name, passwordHash: "x", role: ali.role }).returning({ id: s.users.id });
    ali.id = u.id;
    ingest = await import("../src/server/lafpos/ingest");
    gun = await import("../src/server/lafpos/gun-sonu");
    store = await import("../src/server/cash/report-store");
    reports = await import("../src/server/data/cash-reports");
    site = await import("../src/server/site-sales/sync");
    scope = await import("../src/server/branch-scope");
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const href = String(input instanceof Request ? input.url : input);
      if (href.startsWith("https://api.resend.com/")) {
        if (resendStatus !== 200) return new Response(JSON.stringify({ message: "olmadı" }), { status: resendStatus, headers: { "Content-Type": "application/json" } });
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string };
        sent.push({ key: headers.get("Idempotency-Key"), to: body.to, subject: body.subject, text: body.text });
        return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (href.startsWith("https://site.test/api/panel/sales")) {
        siteCalls.push(href);
        const u = new URL(href);
        const branch = u.searchParams.get("branch");
        const day = u.searchParams.get("from")!;
        // Tuzla'nın kafesi 1.000 ₺ + mağaza 200 ₺, Marina'nınki 300 ₺; şubesiz toplam ikisi
        const cafe = branch === "marina" ? 30_000 : branch === "tuzla" ? 100_000 : 130_000;
        const totals = (net: number) => ({ orders: 1, grossMinor: net, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: net, kdvMinor: 0, unknownKdvNetMinor: 0 });
        const body = {
          now: NOW.toISOString(),
          version: 1,
          from: day,
          to: day,
          closed: false,
          ...(siteEcho ? { branch: branch ?? null } : {}),
          cafe: { ...totals(cafe), lines: [] },
          shop: totals(branch === "marina" ? 0 : 20_000),
          karaoke: { bookings: 0, collectedMinor: 0, refundedMinor: 0, netMinor: 0, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 },
          manual: { orders: 0, grossMinor: 0, netMinor: 0 },
        };
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE lafpos_day_ends, pos_daily_sales, pos_day_reports, activity_log, staff_requests, cash_reports, cash_outs, notification_log, integration_state RESTART IDENTITY CASCADE`);
    await setSwitch(SWITCH);
    await reports.saveCashSettings({ recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: null });
    sent.length = 0;
    siteCalls.length = 0;
    resendStatus = 200;
    siteEcho = true;
  });

  test("geçiş gününden önce: rapor yazılmaz, e-posta gitmez", async () => {
    await setSwitch("2026-11-23");
    assert.ok((await push(DAY, 14)).ok);
    const r = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([r.report, r.email], ["skipped", "skipped"]);
    assert.equal(await marinaReport(), null);
    assert.equal(sent.length, 0);
  });

  test("gün sonu gelince: Kasa raporu kendiliğinden yazılır, e-posta bir kez gider (yeniden tetik göndermez)", async () => {
    assert.ok((await push(DAY, 14)).ok);
    const r = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([r.report, r.email], ["written", "sent"]);
    const rep = await marinaReport();
    assert.ok(rep, "rapor yazıldı");
    assert.equal(rep.submittedByName, "LafPOS (otomatik)");
    assert.equal(rep.zNo, "14");
    assert.equal(rep.zTotal, 20_000);
    assert.equal(rep.cashOut, 5_450);
    assert.equal(rep.countedCash, 9_350);
    assert.equal(rep.cashDiff, 0);
    assert.equal(rep.bankPos, null, "Banka POS uydurulmaz");
    // Gün sonu tam: not cihazın boşluğunu tam söyler, "panelden ekleyin" yok
    assert.match(rep.note ?? "", /Eksik: Banka POS: LafPOS'tan Pavo gün sonu gelmedi/);
    assert.doesNotMatch(rep.note ?? "", /panelden/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · kasa tutuyor");
    assert.deepEqual(sent[0].to, ["sahip@ornek.com"]);
    assert.match(sent[0].text, /laffogato\.net/);
    // Aynı içerik: ne rapor değişir ne e-posta gider (günlük iş de)
    const again = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([again.report, again.email], ["unchanged", "same"]);
    const daily = await gun.catchUpLafposDayEnds(db, NOW);
    assert.deepEqual(daily.days.map((d) => d.email), ["same"]);
    assert.equal(sent.length, 1);
    assert.equal((await state())?.emailCount, 1);
    // Marina'nın online satırı Marina'nın şubesiyle soruldu
    assert.ok(siteCalls.every((c) => new URL(c).searchParams.get("branch") === "marina"), siteCalls.join(" "));
  });

  test("düzeltme: elle düzeltilen alan ezilmez, e-posta 'düzeltildi' notuyla bir kez daha gider", async () => {
    assert.ok((await push(DAY, 14)).ok);
    await gun.runLafposDayEnd(db, DAY, NOW);
    // Yönetici sayılan nakdi düzeltti ve Banka POS'u ekledi
    const rep = (await marinaReport())!;
    const saved = await scope.withBranchScope(LAFPOS_SUBE, () =>
      store.saveCashReport(
        db,
        ali,
        { date: DAY, zNo: rep.zNo, receipts: rep.receipts, zTotal: rep.zTotal, cash: rep.cash, card: rep.card, mealCard: 0, online: 0, other: 0, openingCash: 1_500, cashIn: 1_300, cashOut: 5_450, cashOutNote: null, countedCash: 9_300, handedOver: 0, bankPos: 8_000, offRevenue: 0, discounts: 0, note: rep.note, countedBy: null, revision: rep.revision, photos: [] },
        NOW,
      ),
    );
    assert.equal(saved.kind, "saved");
    // LafPOS aynı Z ile düzeltip yeniden gönderdi: satış 21.000, nakit 13.000
    assert.ok((await push(DAY, 14, { zTotal: 21_000, cash: 13_000, countedCash: 10_350, expectedCash: 10_350 })).ok);
    const r = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([r.report, r.email], ["updated", "sent"]);
    const now = (await marinaReport())!;
    assert.equal(now.zTotal, 21_000);
    assert.equal(now.cash, 13_000);
    assert.equal(now.countedCash, 9_300, "elle düzeltilen sayım kaldı");
    assert.equal(now.bankPos, 8_000, "Banka POS'a dokunulmadı");
    assert.equal(now.revision, 3);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].subject.replace(/[\u00a0\u202f]/g, " "), "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · 1.050 ₺ eksik · düzeltildi");
    assert.match(sent[1].text, /Düzeltildi: LafPOS bu günü yeniden gönderdi/);
    assert.notEqual(sent[0].key, sent[1].key);
    // Aynı düzeltme yeniden: e-posta yok
    assert.equal((await gun.runLafposDayEnd(db, DAY, NOW)).email, "same");
    assert.equal(sent.length, 2);
  });

  test("kıyas: geçiş gününden önceki günün LafPOS kaydı (deneme) sayılmaz, kasa raporu okunur", async () => {
    // 21 Kasım deneme günü Marina'nın kasasından gelmiş (Z 999 ₺); o günün gerçek kaynağı ModPOS'tan girilen kasa raporu
    assert.ok((await push("2026-11-21", 13, { zTotal: 999, cash: 999, card: 0, countedCash: null, cashDiff: null })).ok);
    assert.ok((await push("2026-11-15", 12, { zTotal: 888, cash: 888, card: 0, countedCash: null, cashDiff: null })).ok);
    assert.ok((await push(DAY, 14)).ok);
    const r = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.equal(r.email, "sent");
    // Kasa raporu yokken: deneme rakamı değil "bilinmiyor"
    assert.match(sent[0].text, /Dün \(21 Kasım Cumartesi\): bilinmiyor/);
    assert.match(sent[0].text, /Geçen hafta \(15 Kasım Pazar\): bilinmiyor/);
    assert.doesNotMatch(sent[0].text, /999|888/);

    await db.insert(s.cashReports).values({ date: "2026-11-21", branchId: LAFPOS_SUBE, zTotal: 500, submittedByName: "Ayşe" });
    assert.ok((await push(DAY, 14, { receipts: 64 })).ok);
    await gun.runLafposDayEnd(db, DAY, NOW);
    assert.equal(sent.length, 2);
    assert.match(sent[1].text, /Dün \(21 Kasım Cumartesi\): 500\s₺ \(%3900 fazla\)/);
    assert.doesNotMatch(sent[1].text, /999/);
  });

  test("personelin girdiği rapora dokunulmaz; e-posta yine gider", async () => {
    const r0 = await scope.withBranchScope(LAFPOS_SUBE, () =>
      store.saveCashReport(
        db,
        ali,
        { date: DAY, zNo: "14", receipts: 63, zTotal: 19_000, cash: 11_000, card: 8_000, mealCard: 0, online: 0, other: 0, openingCash: 1_500, cashIn: 0, cashOut: 0, cashOutNote: null, countedCash: 12_500, handedOver: 0, bankPos: null, offRevenue: 0, discounts: 0, note: null, countedBy: null, revision: 0, photos: [] },
        NOW,
      ),
    );
    assert.equal(r0.kind, "saved");
    assert.ok((await push(DAY, 14)).ok);
    const r = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([r.report, r.email], ["human", "sent"]);
    const rep = (await marinaReport())!;
    assert.equal(rep.zTotal, 19_000);
    assert.equal(rep.submittedByName, "Ali");
    assert.match(sent[0].text, /Kasa raporunu personel girdi/);
  });

  test("sayım yoksa rapor yazılmaz (uydurulmaz); e-posta sayım olmadığını söyler", async () => {
    assert.ok((await push(DAY, 14, { countedCash: null, cashDiff: null })).ok);
    const r = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([r.report, r.email], ["no-count", "sent"]);
    assert.equal(await marinaReport(), null);
    assert.deepEqual((await state())?.missing, ["bankPos", "okc", "countedCash"]);
    assert.match(sent[0].text, /Kasa raporu yazılmadı/);
    assert.equal(sent[0].subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · sayım yok");
  });

  test("çalışanlar: sayımsız günde teşekkür değil uyarı; sayım gelince 'alındı' bir kez, düzeltme yeniden göndermez", async () => {
    await reports.saveCashSettings({ recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: null, staffRecipients: ["kasa@ornek.com"], staffAmounts: false });
    const toStaff = () => sent.filter((m) => m.to.includes("kasa@ornek.com"));
    assert.ok((await push(DAY, 14, { countedCash: null, cashDiff: null })).ok);
    const r = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([r.report, r.email, r.staff], ["no-count", "sent", "sent"]);
    assert.equal(toStaff().length, 1);
    assert.equal(toStaff()[0].subject, "Marina · kasa sayılmadı · 22 Kasım Pazar");
    assert.doesNotMatch(toStaff()[0].text, /teşekkür|alındı/i);
    // Çekmece LafPOS'ta sayıldı, gün yeniden geldi: rapor yazılır; yöneticiye "kasa sayıldı" (düzeltildi değil), çalışana "alındı"
    assert.ok((await push(DAY, 14)).ok);
    const counted = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([counted.report, counted.email, counted.staff], ["written", "sent", "sent"]);
    const admin = sent.filter((m) => m.to.includes("sahip@ornek.com"));
    assert.equal(admin.length, 2);
    assert.equal(admin[1].subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · kasa tutuyor · kasa sayıldı");
    assert.doesNotMatch(admin[1].text, /Düzeltildi/);
    assert.equal(toStaff().length, 2);
    assert.equal(toStaff()[1].subject, "Marina · gün sonu alındı · 22 Kasım Pazar");
    // LafPOS bir kez daha düzeltti: yöneticiye "düzeltildi", çalışana ikinci "alındı" gitmez
    assert.ok((await push(DAY, 14, { receipts: 64 })).ok);
    const again = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([again.email, again.staff], ["sent", "same"]);
    assert.match(sent.at(-1)!.subject, /· düzeltildi$/);
    assert.equal(toStaff().length, 2);
    // Personelin adresi yöneticinin e-postasına girmez
    assert.ok(admin.every((m) => !m.to.includes("kasa@ornek.com")));
  });

  test("sayımsız gün Bugün ve zil için bulunur (lafposNoCountDays); sayım gelince ya da rapor girilince kalkar", async () => {
    const { lafposNoCountDays } = await import("../src/server/data/lafpos-day");
    assert.ok((await push(DAY, 14, { countedCash: null, cashDiff: null })).ok);
    await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([...(await lafposNoCountDays(["2026-11-21", DAY], LAFPOS_SUBE, db))], [DAY]);
    assert.deepEqual([...(await lafposNoCountDays([DAY], MODPOS_SUBE, db))], [], "Tuzla'nın günü LafPOS günü değil");
    assert.ok((await push(DAY, 14)).ok);
    await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([...(await lafposNoCountDays([DAY], LAFPOS_SUBE, db))], [], "rapor yazıldı");
  });

  test("sayımsız günden sonraki ilk sayımlı e-posta düşüp yeniden denenince de 'kasa sayıldı' der (düzeltildi değil)", async () => {
    assert.ok((await push(DAY, 14, { countedCash: null, cashDiff: null })).ok);
    assert.equal((await gun.runLafposDayEnd(db, DAY, NOW)).email, "sent");
    assert.ok((await push(DAY, 14)).ok);
    resendStatus = 422;
    assert.equal((await gun.runLafposDayEnd(db, DAY, NOW, { attempts: 1 })).email, "failed");
    const [log] = await db.select().from(s.notificationLog).where(eq(s.notificationLog.key, `lafpos-gun:${LAFPOS_SUBE}:${DAY}`));
    assert.match(log?.subject ?? "", /sayım yok$/, "düşen gönderim konuyu değiştirmez");
    resendStatus = 200;
    assert.equal((await gun.runLafposDayEnd(db, DAY, NOW)).email, "sent");
    assert.equal(sent.at(-1)!.subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · kasa tutuyor · kasa sayıldı");
  });

  test("çalışanların e-postası düşerse kaydı kalır ve sabah işi yeniden dener", async () => {
    await reports.saveCashSettings({ recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: null, staffRecipients: ["kasa@ornek.com"], staffAmounts: false });
    assert.ok((await push(DAY, 14)).ok);
    // Yöneticinin e-postası gider, çalışanınki düşer
    let failStaff = true;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { to?: string[] }) : null;
      if (failStaff && String(input).startsWith("https://api.resend.com/") && body?.to?.includes("kasa@ornek.com"))
        return new Response(JSON.stringify({ message: "olmadı" }), { status: 422, headers: { "Content-Type": "application/json" } });
      return origFetch(input, init);
    }) as typeof fetch;
    try {
      const r = await gun.runLafposDayEnd(db, DAY, NOW, { attempts: 1 });
      assert.deepEqual([r.email, r.staff], ["sent", "failed"]);
      const [log] = await db.select().from(s.notificationLog).where(eq(s.notificationLog.key, `lafpos-gun-calisan:${LAFPOS_SUBE}:${DAY}:alindi`));
      assert.equal(log?.ok, false, "düşen gönderim kayıtlı");
      assert.ok(log?.error, "hatası yazıldı");
      // Yeniden tetik yöneticiye göndermez; çalışanın düşen kaydı yeniden denenir
      failStaff = false;
      const daily = await gun.catchUpLafposDayEnds(db, new Date("2026-11-23T08:00:00+03:00"));
      assert.deepEqual(daily.days.map((d) => [d.email, d.staff]), [["same", "sent"]]);
      assert.equal(sent.filter((m) => m.to.includes("kasa@ornek.com")).length, 1);
      assert.equal(sent.filter((m) => m.to.includes("sahip@ornek.com")).length, 1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("alıcılar: yalnız Kasa › Rapor alıcıları (sabah e-postasının adresleri girmez; Tuzla'nınkiyle aynı)", async () => {
    await db.insert(s.notificationRecipients).values({ email: "muhasebe@ornek.com", active: true }).onConflictDoNothing();
    try {
      assert.ok((await push(DAY, 14)).ok);
      await gun.runLafposDayEnd(db, DAY, NOW);
      assert.deepEqual(sent.map((m) => m.to), [["sahip@ornek.com"]]);
    } finally {
      await db.delete(s.notificationRecipients).where(eq(s.notificationRecipients.email, "muhasebe@ornek.com"));
    }
  });

  test("Pavo bekleniyorsa (cihaz Pavo, önceki gün geldi) gün sonu e-postası bekler; sonuç gelince tek e-posta gider", async () => {
    const OKC = { provider: "pavo", zReport: false, docs: 19, cash: 12_000, card: 8_000, mealCard: 0, other: 0, total: 20_000, voided: { count: 0, cash: 0, card: 0 }, vat: null };
    // Önceki gün Pavo'nun sonucu geldi (otomatik banka gün sonu açık)
    assert.ok((await push("2026-11-21", 13, {}, { okc: OKC, bankPos: bankPos(8_000) })).ok);
    assert.ok((await push(DAY, 14, { countedCash: null, cashDiff: null }, { okc: OKC })).ok);
    const first = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([first.report, first.email, first.pavo], ["no-count", "waiting", "skipped"]);
    assert.equal(sent.length, 0, "Pavo beklenirken e-posta yok");
    // Bir dakika sonra Pavo'nun sonucuyla yeniden geldi: tek e-posta, karşılaştırma içinde
    assert.ok((await push(DAY, 14, { countedCash: null, cashDiff: null }, { okc: OKC, bankPos: bankPos(8_000) })).ok);
    const second = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([second.email, second.pavo], ["sent", "same"]);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /sayım yok$/);
    assert.match(sent[0].text, /Pavo – LafPOS kart karşılaştırması/);
  });

  test("Pavo hiç gelmezse bekleme PAVO_WAIT_MS'de biter: sonraki tetik (sabah işi) gönderir", async () => {
    const OKC = { provider: "pavo", zReport: false, docs: 19, cash: 12_000, card: 8_000, mealCard: 0, other: 0, total: 20_000, voided: { count: 0, cash: 0, card: 0 }, vat: null };
    assert.ok((await push("2026-11-21", 13, {}, { okc: OKC, bankPos: bankPos(8_000) })).ok);
    assert.ok((await push(DAY, 14, {}, { okc: OKC })).ok);
    assert.equal((await gun.runLafposDayEnd(db, DAY, NOW)).email, "waiting");
    const later = await gun.runLafposDayEnd(db, DAY, new Date(NOW.getTime() + gun.PAVO_WAIT_MS));
    assert.equal(later.email, "sent");
    assert.equal(sent.length, 1);
  });

  test("gönderim düşerse kaydı kalır, günlük iş yeniden dener ve bir kez gönderir", async () => {
    assert.ok((await push(DAY, 14)).ok);
    resendStatus = 422;
    const r = await gun.runLafposDayEnd(db, DAY, NOW, { attempts: 1 });
    assert.deepEqual([r.report, r.email], ["written", "failed"]);
    const st = (await state())!;
    assert.equal(st.emailedHash, null);
    assert.ok(st.emailError, "hata kaydedildi");
    assert.equal(st.sendingAt, null);
    resendStatus = 200;
    const daily = await gun.catchUpLafposDayEnds(db, new Date("2026-11-23T08:00:00+03:00"));
    assert.deepEqual(daily.days.map((d) => [d.date, d.report, d.email]), [[DAY, "unchanged", "sent"]]);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].subject, /düzeltildi/);
    assert.equal((await state())?.emailError, null);
  });

  test("geçiş günü sonradan girilince günlük iş eksik günleri yakalar (en çok 7 gün geriye)", async () => {
    await setSwitch(null);
    assert.ok((await push("2026-11-21", 13)).ok);
    assert.ok((await push(DAY, 14)).ok);
    assert.deepEqual(await gun.catchUpLafposDayEnds(db, NOW), { status: "off", days: [] });
    assert.equal(sent.length, 0);
    await setSwitch("2026-11-21");
    const daily = await gun.catchUpLafposDayEnds(db, NOW);
    assert.deepEqual(daily.days.map((d) => [d.date, d.report, d.email]), [
      ["2026-11-21", "written", "sent"],
      [DAY, "written", "sent"],
    ]);
    assert.equal(sent.length, 2);
    // İkinci günün e-postası dünle kıyaslar
    assert.match(sent[1].text.replace(/[  ]/g, " "), /Dün \(21 Kasım Cumartesi\): 20\.000 ₺ \(aynı\)/);
  });

  test("Tuzla'ya dokunulmaz: Tuzla'nın raporu ve online satırı eskisi gibi (&branch=tuzla)", async () => {
    const tuzla = await scope.withBranchScope(MODPOS_SUBE, () =>
      store.saveCashReport(
        db,
        ali,
        { date: DAY, zNo: "900", receipts: 10, zTotal: 5_000, cash: 5_000, card: 0, mealCard: 0, online: 0, other: 0, openingCash: 0, cashIn: 0, cashOut: 0, cashOutNote: null, countedCash: 5_000, handedOver: 0, bankPos: null, offRevenue: 0, discounts: 0, note: null, countedBy: null, revision: 0, photos: [] },
        NOW,
      ),
    );
    assert.equal(tuzla.kind, "saved");
    assert.ok((await push(DAY, 14)).ok);
    await gun.runLafposDayEnd(db, DAY, NOW);
    const [t] = await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, DAY), eq(s.cashReports.branchId, MODPOS_SUBE)));
    assert.equal(t.zTotal, 5_000);
    assert.equal(t.revision, 1);
    // Online satır: Tuzla (verilmeyen şube de Tuzla) 1.000 + 200; Marina 300
    siteCalls.length = 0;
    const plain = await site.fetchTillOnlineRow(DAY);
    const tz = await site.fetchTillOnlineRow(DAY, MODPOS_SUBE);
    const mr = await site.fetchTillOnlineRow(DAY, LAFPOS_SUBE);
    assert.equal(plain?.online, 1_200);
    assert.equal(tz?.online, 1_200);
    assert.equal(mr?.online, 300);
    assert.deepEqual(
      siteCalls.map((c) => new URL(c).searchParams.get("branch")),
      ["tuzla", "tuzla", "marina"],
    );
    // Şubesiz eski site: Tuzla'nın satırı eskisi gibi, Marina'ya Tuzla'nın rakamı yazılmaz
    siteEcho = false;
    assert.equal((await site.fetchTillOnlineRow(DAY, MODPOS_SUBE))?.online, 1_200);
    assert.equal(await site.fetchTillOnlineRow(DAY, LAFPOS_SUBE), null);
    // Online kanal seçiliyse satır yok
    assert.equal(await site.fetchTillOnlineRow(DAY, "online"), null);
  });
  const bankPos = (pavoCard: number, lafposCard = 8_000) => ({
    status: "ok",
    batchNo: "0042",
    at: "2026-11-22T23:58:00+03:00",
    pavoCard,
    lafposCard,
    diff: Math.round((pavoCard - lafposCard) * 100) / 100,
    acquirers: [{ name: "Garanti", count: 30, total: pavoCard }],
    message: null,
  });

  test("Pavo: gün sonu e-postası gittikten sonra gelen karşılaştırma yalnız kısa e-postayla gider (fark varsa konuda FARK VAR)", async () => {
    assert.ok((await push(DAY, 14)).ok);
    const first = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([first.email, first.pavo], ["sent", "skipped"]);
    assert.equal(sent.length, 1);
    // Aynı gün Pavo sonucuyla ikinci kez gelir
    assert.ok((await push(DAY, 14, {}, { bankPos: bankPos(8_120) })).ok);
    const second = await gun.runLafposDayEnd(db, DAY, NOW);
    // Gün sonu tam: Pavo sonucu raporun boş Banka POS'unu doldurur (rapor güncellenir), gün sonu e-postası yinelenmez
    assert.deepEqual([second.report, second.email, second.pavo], ["updated", "same", "sent"]);
    assert.equal((await marinaReport())?.bankPos, 8_120, "Banka POS Pavo'nun sonucundan");
    assert.equal(sent.length, 2, "gün sonu yeniden gitmez, yalnız Pavo e-postası");
    assert.equal(sent[1].subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · Pavo karşılaştırması · FARK VAR");
    assert.match(sent[1].text.replace(/[\u00a0\u202f]/g, " "), /Pavo kart toplamı: 8\.120 ₺/);
    assert.match(sent[1].text, /FARK VAR/);
    // Aynı karşılaştırma ikinci kez gitmez; bankPos'suz düzeltme kayıtlı karşılaştırmayı silmez
    assert.ok((await push(DAY, 14)).ok);
    const [row] = await db.select({ bankPos: s.posDayReports.bankPos }).from(s.posDayReports).where(eq(s.posDayReports.date, DAY));
    assert.equal(row.bankPos?.pavoCard, 8_120);
    const third = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([third.email, third.pavo], ["same", "same"]);
    assert.equal(sent.length, 2);
  });

  test("Pavo: karşılaştırma gün sonu e-postasından önce geldiyse onun içinde gider, kısa e-posta gitmez", async () => {
    assert.ok((await push(DAY, 14, {}, { bankPos: bankPos(8_000) })).ok);
    const r = await gun.runLafposDayEnd(db, DAY, NOW);
    assert.deepEqual([r.email, r.pavo], ["sent", "same"]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · kasa tutuyor");
    assert.match(sent[0].text, /Pavo – LafPOS kart karşılaştırması/);
    assert.match(sent[0].text, /Uyumlu/);
  });

  test("Pavo: bozuk karşılaştırma günü reddetmez, yalnız yok sayılır", async () => {
    assert.ok((await push(DAY, 14, {}, { bankPos: { status: "belki" } })).ok);
    const [row] = await db.select({ bankPos: s.posDayReports.bankPos }).from(s.posDayReports).where(eq(s.posDayReports.date, DAY));
    assert.equal(row.bankPos, null);
  });
});
