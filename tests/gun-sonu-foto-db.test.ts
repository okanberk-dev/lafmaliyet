// Gün sonu fotoğrafının ekonomik okunuşu ve yöneticinin fotoğraf e-postası gerçek Postgres'te (sahibin isteği, 24 Kasım
// 2026; docs/FOTOGRAF.md › AsilPOS gününün fotoğrafı). Canlı yapay zekâ yok: sahte istemci modele göre yanıt verir, her
// çağrı ai_calls'a modeli ve tutarıyla düşer. Anahtarsız gün gerçek OCR'la (sentetik fiş görseli) kodla okunur. Fark
// yöneticiye satır satır e-postayla gider (içerik başına bir kez), çalışanların e-postasında fotoğraf yoktur.
//
// Kendi geçici veritabanını açar (ASILPOS_TEST_DATABASE_URL'in sunucusunda), sonunda siler. Değişken yoksa atlanır.
// Çalıştırma: TEST_DATABASE_URL=postgres://ci:ci@localhost:5433/test_lm6b npm run test:db -- tests/gun-sonu-foto-db.test.ts

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { parsePosDay } from "../src/lib/asilpos/day";
import { BILDIRIM_ONEKI, TEL_KART_ALANI } from "../src/lib/asilpos/eski-adlar";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import type { AiClient, AiMessage, CreateParams } from "../src/server/ai/run";

import { slipPng } from "./helpers/fis-gorsel";
import { ASILPOS_SUBE, seedBranches } from "./helpers/subeler";

const SERVER_URL = process.env.ASILPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_gun_sonu_foto_${process.pid}`;
const NOW = new Date("2026-11-23T01:00:00+03:00");
const DAY = "2026-11-22";

const kabul = () => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/kabul-gunu-2026-11-22.json"), "utf8")) as Record<string, unknown> & { z: Record<string, unknown>; bankPos: Record<string, unknown> };
const BATCH = { batchNo: "0001", at: "2026-11-22T21:26:00.000Z", total: 4_160, trigger: "otomatik", dayClosed: true };
const OKC = { provider: "pavo", zReport: false, docs: 19, cash: 1_055, card: 4_160, mealCard: 0, other: 0, total: 5_215, voided: { count: 0, cash: 0, card: 0 }, vat: [{ rate: 10, total: 5_215, vat: 474.09 }] };
const BANK = { ...kabul().bankPos, status: "ok", pavoCard: 4_160, [TEL_KART_ALANI]: 4_160, diff: 0, batches: [BATCH], dayCard: 4_160 };

const amt = (v: number | null) => ({ text: v === null ? null : String(v), value: v, confidence: "high" });
/** Pavo'nun detaylı Z'sinin okunuşu (KasaOkcRaw): batch 0001 ve Z rakamları */
const detailed = (o: { card?: number; cash?: number } = {}) => ({
  documentType: "z_report",
  fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: false },
  readable: true,
  title: "Z RAPORU",
  date: DAY,
  time: "23:58",
  dateConfidence: "high",
  zNo: { text: "0011", value: 11, confidence: "high" },
  receiptCount: { text: null, value: null, confidence: "high" },
  dailyTotal: amt(5_215),
  dailyTotalLabel: "TOPLAM",
  kdvGroups: [{ rate: 10, total: amt(5_215), vat: amt(474.09), base: null }],
  totalVat: amt(474.09),
  payments: [
    { label: "NAKİT", count: null, amount: amt(o.cash ?? 1_055), kind: "cash" },
    { label: "KREDİ KARTI", count: null, amount: amt(o.card ?? 4_160), kind: "card" },
  ],
  outside: [],
  voids: amt(null),
  discounts: amt(null),
  cumulativeTotal: amt(null),
  cumulativeVat: amt(null),
  batches: [{ bank: "Garanti BBVA", batchNo: "0001", date: DAY, salesTotal: amt(4_160), refundTotal: amt(null), netTotal: amt(4_160), transactionCount: null }],
  issues: [],
});

const SLIP = [
  "PAVO",
  "L'AFFOGATO MARİNA",
  "TARİH: 22.11.2026|SAAT: 23:58",
  "Z RAPORU",
  "Z NO: 0011",
  "NAKİT|*1.055,00",
  "KREDİ KARTI|*4.160,00",
  "TOPLAM|*5.215,00",
  "%10 TOPLAM|*5.215,00",
  "%10 KDV|*474,09",
  "TOPKDV|*474,09",
  "GARANTİ BBVA",
  "BATCH NO: 0001",
  "SATIŞ TOPLAMI|4.160,00",
  "NET TOPLAM|4.160,00",
];

describe("Gün sonu fotoğrafı: ekonomik okuma ve fotoğraf e-postası (veritabanında)", { skip: !SERVER_URL && "ASILPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let ingest: typeof import("../src/server/asilpos/ingest");
  let gun: typeof import("../src/server/asilpos/gun-sonu");
  let foto: typeof import("../src/server/asilpos/foto");
  let okuma: typeof import("../src/server/photo-read/asilpos");
  let reports: typeof import("../src/server/data/cash-reports");
  const realFetch = globalThis.fetch;
  const sent: { key: string | null; to: string[]; subject: string; text: string; attachments?: { filename: string; content: string; content_type?: string }[] }[] = [];
  const ali = { id: 0, name: "Ali", role: "admin" as const, email: "foto-ali@ornek.com" };
  const ayse = { id: 0, name: "Ayşe", role: "staff" as const, email: "foto-ayse@ornek.com" };

  /** Modele göre yanıt veren sahte istemci; çağrılan modeller sırayla */
  const fakeClient = (byModel: Record<string, unknown>, calls: string[]): AiClient => ({
    beta: {
      messages: {
        create: async (params: CreateParams): Promise<AiMessage> => {
          calls.push(params.model);
          return {
            model: params.model,
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify(byModel[params.model]) }],
            usage: { input_tokens: 5_000, output_tokens: 600 },
            _request_id: `req_${calls.length}`,
          };
        },
      },
    },
  });

  const push = () => {
    const body: Record<string, unknown> = { ...kabul(), bankPos: BANK, okc: OKC };
    const parsed = parsePosDay(JSON.stringify(body), NOW);
    assert.ok(parsed.ok, "gövde geçerli");
    return ingest.storePosDay(db, parsed.data, NOW);
  };
  const newPhoto = async (by = ayse) => {
    const [p] = await db
      .insert(s.photos)
      .values({ kind: "kasa-okc", storageKey: `kasa/2026/11/${randomUUID()}.png`, contentType: "image/png", sizeBytes: 100, createdBy: by.id, createdByName: by.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
      .returning({ id: s.photos.id });
    return p.id;
  };
  const calls = async (photoId: number) =>
    db
      .select({ model: s.aiCalls.model, status: s.aiCalls.status, costUsd: s.aiCalls.costUsd, effort: s.aiCalls.effort })
      .from(s.aiCalls)
      .where(eq(s.aiCalls.photoId, photoId))
      .orderBy(asc(s.aiCalls.id));
  const state = async () => {
    const [row] = await db.select().from(s.asilposDayEnds).where(and(eq(s.asilposDayEnds.date, DAY), eq(s.asilposDayEnds.branchId, ASILPOS_SUBE)));
    return row ?? null;
  };
  const plain = (v: string) => v.replace(/[\u00a0\u202f]/g, " ");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "gun-sonu-foto-testi-icin-en-az-otuz-iki-karakterlik-anahtar", RESEND_API_KEY: "re_test_gun_sonu_foto" });
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
    ingest = await import("../src/server/asilpos/ingest");
    gun = await import("../src/server/asilpos/gun-sonu");
    foto = await import("../src/server/asilpos/foto");
    okuma = await import("../src/server/photo-read/asilpos");
    reports = await import("../src/server/data/cash-reports");
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const href = String(input instanceof Request ? input.url : input);
      if (href.startsWith("https://api.resend.com/")) {
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string; attachments?: { filename: string; content: string; content_type?: string }[] };
        sent.push({ key: headers.get("Idempotency-Key"), to: body.to, subject: body.subject, text: body.text, attachments: body.attachments });
        return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (href.includes("/api/panel/sales")) return new Response("{}", { status: 503 });
      throw new Error(`Beklenmeyen ağ isteği: ${href}`);
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE asilpos_day_ends, pos_daily_sales, pos_day_reports, pos_day_revisions, activity_log, staff_requests, cash_report_photos, cash_reports, cash_outs, ai_calls, photos, notification_log, integration_state RESTART IDENTITY CASCADE`);
    await db.delete(s.settings).where(eq(s.settings.key, "asilposGecisGunu"));
    await db.insert(s.settings).values({ key: "asilposGecisGunu", value: DAY });
    await reports.saveCashSettings({ recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: null, staffRecipients: ["kasa@ornek.com"], staffAmounts: true });
    sent.length = 0;
    delete process.env.ANTHROPIC_API_KEY;
  });

  test("Önce ucuz model (Haiku); tutarsız okunuş bir kez güçlü modele (Opus); iki çağrı modeli ve tutarıyla kayıtlı; aynı fotoğraf yeniden okunmaz", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    assert.ok((await push()).ok);
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "written");
    const id = await newPhoto();
    const models: string[] = [];
    const client = fakeClient({ "claude-haiku-5-5": detailed({ card: 4_000 }), "claude-opus-5-5": detailed() }, models);
    const input = { photoId: id, bytes: slipPng(["X"]), contentType: "image/png" as const, day: DAY, userId: ayse.id, branchId: ASILPOS_SUBE };
    const r = await okuma.readAsilposDayPhoto(db, input, { client });
    assert.ok(r, "AsilPOS günü");
    assert.deepEqual(models, ["claude-haiku-5-5", "claude-opus-5-5"]);
    assert.deepEqual([r.source, r.model], ["ai", "claude-opus-5-5"]);
    const rows = await calls(id);
    assert.deepEqual(
      rows.map((c) => [c.model, c.status]),
      [
        ["claude-haiku-5-5", "ok"],
        ["claude-opus-5-5", "ok"],
      ],
    );
    // Tutar modele göre: Haiku 5.000 × 0,10 + 600 × 0,50 $/M; Opus 5.000 × 4 + 600 × 20 $/M
    assert.deepEqual(
      rows.map((c) => c.costUsd),
      [0.0008, 0.032],
    );
    // Aynı fotoğrafın yeniden okuma isteği (Yeniden dene, öteki bölüm) yeni çağrı yapmaz
    const again = await okuma.readAsilposDayPhoto(db, input, { client });
    assert.equal(models.length, 2, "yeniden çağrı yok");
    assert.equal(again?.model, "claude-opus-5-5");
    // Rapora bağlanınca karşılaştırma güçlü modelin okunuşuyla: uyumlu, kaynağı yapay zekâ
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    const check = (await state())?.photoCheck;
    assert.deepEqual([check?.state, check?.source, check?.model], ["uyumlu", "ai", "claude-opus-5-5"]);
  });

  test("Ucuz okunuş kendi içinde tutarlı ama AsilPOS'tan farklıysa yöneticiye 'fark' gitmeden bir kez güçlü model okur", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const id = await newPhoto();
    const models: string[] = [];
    // Haiku: nakit + kart = toplam (tutarlı), kart AsilPOS'tan farklı; Opus AsilPOS'u tutan okunuş
    const cheap = detailed({ card: 4_000, cash: 1_215 });
    const client = fakeClient({ "claude-haiku-5-5": cheap, "claude-opus-5-5": detailed() }, models);
    const r = await okuma.readAsilposDayPhoto(db, { photoId: id, bytes: slipPng(["X"]), contentType: "image/png", day: DAY, userId: ayse.id, branchId: ASILPOS_SUBE }, { client });
    assert.deepEqual(models, ["claude-haiku-5-5", "claude-opus-5-5"], "farklı okunan ucuz okunuş güçlü modelle yeniden okunur");
    assert.equal(r?.model, "claude-opus-5-5");
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    assert.equal((await state())?.photoCheck?.state, "uyumlu", "yanlış 'fark' yöneticiye gitmedi");
  });

  test("Pavo'nun sonucu fotoğraftan sonra gelince ucuz okunuşun yeni 'fark'ı yöneticiye gitmeden bir kez güçlü modelle okunur", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    // Pavo'nun sonucu henüz gelmedi (Banka POS yok)
    const body: Record<string, unknown> = { ...kabul(), okc: OKC };
    delete body.bankPos;
    const parsed = parsePosDay(JSON.stringify(body), NOW);
    assert.ok(parsed.ok && (await ingest.storePosDay(db, parsed.data, NOW)).ok, "Pavo'suz gün yazıldı");
    assert.equal(await gun.writeAutoReport(db, DAY, NOW), "written");
    const id = await newPhoto();
    const models: string[] = [];
    // Haiku batch'in netini 4.000 okudu (o an karşılaştırılacak Banka POS yok: ikinci okuma yok); Opus 4.160
    const cheap = detailed();
    cheap.batches = [{ ...cheap.batches[0], salesTotal: amt(4_000), netTotal: amt(4_000) }];
    const client = fakeClient({ "claude-haiku-5-5": cheap, "claude-opus-5-5": detailed() }, models);
    await okuma.readAsilposDayPhoto(db, { photoId: id, bytes: slipPng(["X"]), contentType: "image/png", day: DAY, userId: ayse.id, branchId: ASILPOS_SUBE }, { client });
    assert.deepEqual(models, ["claude-haiku-5-5"]);
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    assert.notEqual((await state())?.photoCheck?.state, "fark", "yüklenirken fark yok");
    // AsilPOS günü Pavo'nun sonucuyla yeniden gönderir: kayıtlı ucuz okunuş artık farklı, e-postadan önce güçlü model bakar
    assert.ok((await push()).ok);
    const read = async () => ({ bytes: slipPng(["X"]), contentType: "image/png" });
    const r = await gun.runAsilposDayEnd(db, DAY, NOW, undefined, { client, read });
    assert.deepEqual(models, ["claude-haiku-5-5", "claude-opus-5-5"], "bir kez güçlü model");
    assert.equal((await state())?.photoCheck?.state, "uyumlu", "yanlış 'fark' zile ve e-postaya gitmedi");
    assert.equal(r.email, "sent");
    const mail = sent.find((m) => m.to.includes("sahip@ornek.com"));
    assert.ok(mail, "yöneticinin gün sonu e-postası");
    assert.doesNotMatch(mail.subject, /FARKLI/);
    // Fotoğraf gün sonu e-postasında da var; Z raporu tutsa da ayrıca "Z raporu tutuyor" gider (sahibin isteği)
    assert.match(plain(mail.text), /Fotoğrafta okunan/);
    assert.equal(r.photo, "sent");
    assert.ok(sent.some((m) => /Z raporu tutuyor$/.test(plain(m.subject))), "Z raporu tutuyor e-postası");
    // Güçlü model bir kez: günlük iş yeniden okumaz
    await gun.runAsilposDayEnd(db, DAY, NOW, undefined, { client, read });
    assert.equal(models.length, 2);
  });

  test("Güçlü okuma bu fotoğrafta denendiyse ya da yapay zekâ kapalıysa sonradan gelen fark yeniden okunmaz (kayıtlı karşılaştırma gider)", async () => {
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const id = await newPhoto();
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-haiku-5-5", status: "ok", photoId: id, userId: ayse.id, result: detailed({ card: 4_000, cash: 1_215 }) });
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    const models: string[] = [];
    const client = fakeClient({ "claude-opus-5-5": detailed() }, models);
    const read = async () => ({ bytes: slipPng(["X"]), contentType: "image/png" });
    // Anahtar yok: hiçbir şey okunmaz
    assert.equal(await okuma.strongRecheckDayPhotos(db, DAY, { client, read }), 0);
    // Güçlü model daha önce denendi (düştü): yeniden denenmez
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-opus-5-5", status: "error", photoId: id, userId: ayse.id, error: "zaman aşımı" });
    assert.equal(await okuma.strongRecheckDayPhotos(db, DAY, { client, read }), 0);
    assert.deepEqual(models, []);
    assert.equal((await state())?.photoCheck?.state, "fark");
  });

  test("'Uyumlu' ama sessiz: ucuz okuma detaylı Z'yi yalnız banka fişi okuduysa (Z izi) günün işi bir kez güçlü modelle okur; AsilPOS'un kör kâğıdı okunmaz", async () => {
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    // Eski (bu düzeltmeden önceki) ucuz okunuşlar: biri detaylı Z'yi banka fişi sanmış (Z no okunmuş), biri AsilPOS'un kör kâğıdı
    const quiet = await newPhoto();
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-haiku-5-5", status: "ok", photoId: quiet, userId: ayse.id, result: { ...detailed(), documentType: "batch_slip" } });
    const kor = await newPhoto();
    await db.insert(s.aiCalls).values({
      feature: "kasa-okc",
      model: "claude-haiku-5-5",
      status: "ok",
      photoId: kor,
      userId: ayse.id,
      result: { ...detailed(), documentType: "batch_slip", title: "BANKA GÜN SONU · PAVO", zNo: { text: null, value: null, confidence: "high" }, dailyTotal: amt(null), dailyTotalLabel: null, kdvGroups: [], totalVat: amt(null), payments: [] },
    });
    for (const id of [quiet, kor]) await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    const before = (await state())!.photoCheck!;
    assert.equal(before.state, "uyumlu", JSON.stringify(before.rows));
    assert.ok(!before.rows.some((r) => r.label === "Yazarkasa toplamı"), "Z'nin rakamları karşılaştırılmadı");
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    const models: string[] = [];
    const client = fakeClient({ "claude-opus-5-5": detailed() }, models);
    const read = async () => ({ bytes: slipPng(["X"]), contentType: "image/png" });
    await gun.runAsilposDayEnd(db, DAY, NOW, undefined, { client, read });
    assert.deepEqual(models, ["claude-opus-5-5"], "yalnız Z izi olan fotoğraf, bir kez");
    assert.deepEqual((await calls(kor)).map((c) => c.model), ["claude-haiku-5-5"], "kör kâğıt için Opus yok");
    const after = (await state())!.photoCheck!;
    assert.equal(after.state, "uyumlu", JSON.stringify(after.rows));
    assert.ok(after.rows.some((r) => r.label === "Yazarkasa toplamı" && r.ok), JSON.stringify(after.rows));
    await gun.runAsilposDayEnd(db, DAY, NOW, undefined, { client, read });
    assert.equal(models.length, 1, "yeniden okunmaz");
  });

  test("Ucuz okuma tam ve AsilPOS'u tutuyorsa tek çağrı (Haiku)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const id = await newPhoto();
    const models: string[] = [];
    await okuma.readAsilposDayPhoto(db, { photoId: id, bytes: slipPng(["X"]), contentType: "image/png", day: DAY, userId: ayse.id, branchId: ASILPOS_SUBE }, { client: fakeClient({ "claude-haiku-5-5": detailed() }, models) });
    assert.deepEqual(models, ["claude-haiku-5-5"]);
    assert.deepEqual(
      (await calls(id)).map((c) => [c.model, c.costUsd]),
      [["claude-haiku-5-5", 0.0008]],
    );
  });

  test("Anahtar yokken kodla okunur (OCR, ağsız): ai_calls'ta 'kod-ocr' satırı, ücretsiz; karşılaştırmanın kaynağı 'Kodla okundu'", { timeout: 90_000 }, async () => {
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const id = await newPhoto();
    const r = await okuma.readAsilposDayPhoto(db, { photoId: id, bytes: slipPng(SLIP, { size: 36, width: 980 }), contentType: "image/png", day: DAY, userId: ayse.id, branchId: ASILPOS_SUBE });
    assert.deepEqual([r?.source, r?.model], ["kod", "kod-ocr"]);
    assert.deepEqual(
      (await calls(id)).map((c) => [c.model, c.status, c.costUsd]),
      [["kod-ocr", "ok", 0]],
    );
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    const check = (await state())?.photoCheck;
    assert.equal(check?.source, "kod");
    // Her satır güvenle okunduysa uyumlu; OCR'ın şüphelendiği satır (ör. "%10") varsa "yönetici baksın", asla uydurma fark yok
    assert.ok(check?.state === "uyumlu" || check?.state === "belirsiz", JSON.stringify(check?.rows));
    assert.ok(check?.rows.some((r) => r.label === "Yazarkasa toplamı" && r.ok), "toplam kodla okundu ve tutuyor");
    // Kod okunuşu günlük sınıra ve fotoğraf başına 3 okumaya sayılmaz
    const ai = await import("../src/server/ai/claude");
    assert.equal((await ai.aiUsageSummary(NOW)).today, 0);
  });

  test("Fark yöneticiye satır satır e-postayla (gün sonu e-postasından sonra eklenen fotoğraf), içerik başına bir kez; çalışanların e-postasında fotoğraf yok", async () => {
    assert.ok((await push()).ok);
    const first = await gun.runAsilposDayEnd(db, DAY, NOW);
    assert.equal(first.email, "sent");
    assert.equal(first.photo, "skipped", "fotoğraf yok");
    const staffMails = sent.filter((m) => m.to.includes("kasa@ornek.com"));
    assert.equal(staffMails.length, 1, "çalışanların kısa e-postası");
    sent.length = 0;
    // Personel fotoğrafı ekler; okunuşu AsilPOS'tan farklı (kart 4.000, nakit 1.215)
    const id = await newPhoto();
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-opus-5-5", status: "ok", photoId: id, userId: ayse.id, result: detailed({ card: 4_000, cash: 1_215 }) });
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    assert.equal((await state())?.photoCheck?.state, "fark");
    assert.equal(await gun.sendPhotoEmail(db, DAY, NOW), "sent");
    assert.equal(sent.length, 1);
    const mail = sent[0];
    assert.deepEqual(mail.to, ["sahip@ornek.com"], "yalnız yöneticinin alıcıları");
    assert.match(plain(mail.subject), /Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar · Z raporu AsilPOS'tan FARKLI/);
    const t = plain(mail.text);
    assert.match(t, /Yazarkasa kartı: fotoğrafta 4\.000 ₺ · AsilPOS'ta 4\.160 ₺ · FARK/);
    assert.match(t, /Yazarkasa nakdi: fotoğrafta 1\.215 ₺ · AsilPOS'ta 1\.055 ₺ · FARK/);
    assert.match(t, /Okuyan: Yapay zekâ \(Claude Opus 5\.5\)/);
    // Aynı karşılaştırma ikinci kez gitmez; günlük iş de göndermez
    assert.equal(await gun.sendPhotoEmail(db, DAY, NOW), "same");
    const again = await gun.runAsilposDayEnd(db, DAY, NOW);
    assert.equal(again.photo, "same");
    assert.equal(sent.length, 1);
    // Çalışanlara giden hiçbir e-postada fotoğraf ya da fark yok
    for (const m of sent.filter((x) => x.to.includes("kasa@ornek.com"))) assert.doesNotMatch(m.text, /fotoğraf|AsilPOS'ta/i);
  });

  test("Gün sonu e-postası fotoğraftan sonra giderse fark onun içinde satır satır; Z raporu e-postası da ayrıca gider (bir kez)", async () => {
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const id = await newPhoto();
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-haiku-5-5", status: "ok", photoId: id, userId: ayse.id, result: detailed({ card: 4_000, cash: 1_215 }) });
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    const r = await gun.runAsilposDayEnd(db, DAY, NOW);
    assert.deepEqual([r.email, r.photo], ["sent", "sent"]);
    const admin = sent.filter((m) => m.to.includes("sahip@ornek.com"));
    assert.equal(admin.length, 2, "gün sonu e-postası ve Z raporu");
    assert.match(admin[0].subject, /Fotoğraf FARKLI/);
    assert.match(plain(admin[0].text), /Yazarkasa kartı: fotoğrafta 4\.000 ₺ · AsilPOS'ta 4\.160 ₺ · FARK/);
    assert.match(plain(admin[1].subject), /Z raporu AsilPOS'tan FARKLI$/);
    // Günlük iş aynı Z raporunu yeniden göndermez
    assert.equal((await gun.runAsilposDayEnd(db, DAY, NOW)).photo, "same");
    for (const m of sent.filter((x) => x.to.includes("kasa@ornek.com"))) assert.doesNotMatch(m.text, /fotoğraf|AsilPOS'ta/i);
  });
  test("Uyumlu fotoğraf da yöneticiye e-postayla gider (sahibin isteği, 25 Kasım 2026): okunan rakamlar, ekleyen ve fotoğrafın kendisi ek olarak; bir kez", async () => {
    const photos = await import("../src/server/storage/photos");
    const store = new Map<string, Uint8Array>();
    photos.__setPhotoDriverForTests({ name: "memory", put: async (k, b) => void store.set(k, b), get: async (k) => store.get(k) ?? null, del: async (ks) => ks.forEach((k) => store.delete(k)) });
    try {
      assert.ok((await push()).ok);
      const first = await gun.runAsilposDayEnd(db, DAY, NOW);
      assert.equal(first.email, "sent");
      sent.length = 0;
      const id = await newPhoto();
      const [row] = await db.select({ key: s.photos.storageKey }).from(s.photos).where(eq(s.photos.id, id));
      store.set(row.key, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
      await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-haiku-5-5", status: "ok", photoId: id, userId: ayse.id, result: detailed() });
      await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
      assert.equal((await state())?.photoCheck?.state, "uyumlu");
      assert.equal(await gun.sendPhotoEmail(db, DAY, NOW), "sent");
      assert.equal(sent.length, 1);
      const mail = sent[0];
      assert.deepEqual(mail.to, ["sahip@ornek.com"], "yalnız yöneticinin alıcıları");
      assert.match(plain(mail.subject), /Z raporu tutuyor$/);
      const t = plain(mail.text);
      assert.match(t, /Ekleyen: Ayşe/);
      assert.match(t, /Fotoğrafta okunan\nBelge: /);
      assert.match(t, /Okuyan: Yapay zekâ \(Claude Haiku 5\.5\)/);
      assert.deepEqual(
        mail.attachments?.map((a) => [a.filename, a.content_type, a.content]),
        [[`gun-sonu-${DAY}.png`, "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64")]],
      );
      // Aynı karşılaştırma ikinci kez gitmez
      assert.equal(await gun.sendPhotoEmail(db, DAY, NOW), "same");
      assert.equal(sent.length, 1);
      for (const m of sent.filter((x) => x.to.includes("kasa@ornek.com"))) assert.equal(m.attachments, undefined, "çalışanlara fotoğraf gitmez");
    } finally {
      photos.__setPhotoDriverForTests(undefined);
    }
  });

  test("Yüklenirken okunamayan fotoğraf sonradan bir kez okunur (readUnreadDayPhotos): karşılaştırma ve e-posta rakamı görür", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    assert.ok((await push()).ok);
    assert.equal((await gun.runAsilposDayEnd(db, DAY, NOW)).email, "sent");
    sent.length = 0;
    const id = await newPhoto();
    // Yüklemedeki okuma zaman aşımına düştü: başarılı okunuş yok
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-haiku-5-5", status: "error", errorCode: "timeout", error: "zaman aşımı", photoId: id, userId: ayse.id });
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    assert.notEqual((await state())?.photoCheck?.state, "uyumlu");
    const models: string[] = [];
    const client = fakeClient({ "claude-haiku-5-5": detailed() }, models);
    const read = async () => ({ bytes: slipPng(["X"]), contentType: "image/png" });
    assert.equal(await okuma.readUnreadDayPhotos(db, DAY, { client, read }), 1);
    assert.deepEqual(models, ["claude-haiku-5-5"], "ucuz model okudu");
    await foto.refreshDayPhotoCheck(db, DAY, ASILPOS_SUBE, NOW);
    assert.equal((await state())?.photoCheck?.state, "uyumlu");
    // Okunmuş fotoğraf yeniden okunmaz
    assert.equal(await okuma.readUnreadDayPhotos(db, DAY, { client, read }), 0);
    assert.equal(models.length, 1);
    assert.equal(await gun.sendPhotoEmail(db, DAY, NOW), "sent");
    assert.match(plain(sent[0].text), /Fotoğrafta okunan/);
  });
  test("Fatura okumaları fotoğrafların günlük sınırını yemez (kendi havuzu): 40 fatura okunsa da Z fotoğrafı yapay zekâyla okunur", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    const ai = await import("../src/server/ai/claude");
    const cap = (await ai.loadAiSettings()).dailyCap;
    await db.insert(s.aiCalls).values(Array.from({ length: cap }, () => ({ feature: "fatura" as const, model: "claude-haiku-5-5", status: "ok" as const, userId: ali.id, photoId: null })));
    assert.equal((await ai.invoiceAiStatus()).state, "cap", "faturanın havuzu doldu");
    assert.deepEqual([(await ai.aiStatus()).state, (await ai.aiStatus()).usedToday], ["on", 0], "fotoğrafların sınırı boş");
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const id = await newPhoto();
    const models: string[] = [];
    const r = await okuma.readAsilposDayPhoto(db, { photoId: id, bytes: slipPng(["X"]), contentType: "image/png", day: DAY, userId: ayse.id, branchId: ASILPOS_SUBE }, { client: fakeClient({ "claude-haiku-5-5": detailed() }, models) });
    assert.equal(r?.source, "ai", "koda düşmedi");
    assert.deepEqual(models, ["claude-haiku-5-5"]);
  });
  test("İnceleme: fotoğraftan Z no yazılınca (AsilPOS Z no göndermedi) aynı fotoğraf için ikinci Z raporu gitmez", async () => {
    const body: Record<string, unknown> & { z: Record<string, unknown> } = { ...kabul(), bankPos: BANK, okc: OKC };
    body.z = { ...body.z, okcZNo: null };
    const parsed = parsePosDay(JSON.stringify(body), NOW);
    assert.ok(parsed.ok && (await ingest.storePosDay(db, parsed.data, NOW)).ok, "Z no'suz gün yazıldı");
    assert.equal((await gun.runAsilposDayEnd(db, DAY, NOW)).email, "sent");
    sent.length = 0;
    const id = await newPhoto();
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-haiku-5-5", status: "ok", photoId: id, userId: ayse.id, result: detailed() });
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    assert.equal(await gun.sendPhotoEmail(db, DAY, NOW), "sent");
    // Günlük iş karşılaştırmayı yeniden kurar (satır artık "gönderilmedi; raporda …"): aynı özet, ikinci e-posta yok
    assert.equal((await gun.runAsilposDayEnd(db, DAY, NOW)).photo, "same");
    assert.equal(sent.filter((m) => /Z raporu/.test(m.subject)).length, 1);
  });

  test("İnceleme: yükseltmeden önce eski özetle gitmiş Z raporu yeniden gitmez; yalnız kodla okunan fotoğraf yapay zekâ açıkken yeniden okunur", async () => {
    const lib = await import("../src/lib/asilpos/gun-sonu");
    assert.ok((await push()).ok);
    assert.equal((await gun.runAsilposDayEnd(db, DAY, NOW)).email, "sent");
    const id = await newPhoto();
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "claude-haiku-5-5", status: "ok", photoId: id, userId: ayse.id, result: detailed({ card: 4_000, cash: 1_215 }) });
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: id }, NOW);
    const check = (await state())!.photoCheck!;
    assert.equal(check.state, "fark");
    await db.insert(s.notificationLog).values({ key: `${BILDIRIM_ONEKI.foto}${ASILPOS_SUBE}:${DAY}:${lib.photoCheckHashLegacy(check)}`, channel: "email", ok: true });
    assert.equal(await gun.sendPhotoEmail(db, DAY, NOW), "same", "eski özetle gitmişti");

    // Yüklemede yapay zekâ düştü, kod okudu: yapay zekâ açıkken bir kez daha (yapay zekâyla) okunur
    await db.execute(sql`TRUNCATE asilpos_day_ends, pos_daily_sales, pos_day_reports, pos_day_revisions, cash_report_photos, cash_reports, ai_calls, photos, notification_log RESTART IDENTITY CASCADE`);
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-sahte";
    assert.ok((await push()).ok);
    await gun.writeAutoReport(db, DAY, NOW);
    const p2 = await newPhoto();
    await db.insert(s.aiCalls).values([
      { feature: "kasa-okc", model: "claude-haiku-5-5", status: "error", errorCode: "timeout", error: "zaman aşımı", photoId: p2, userId: ayse.id },
      { feature: "kasa-okc", model: "kod-ocr", servedModel: "kod-ocr", status: "ok", photoId: p2, userId: ayse.id, costUsd: 0, result: detailed({ card: 4_000 }) },
    ]);
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: p2 }, NOW);
    const models: string[] = [];
    const read = async () => ({ bytes: slipPng(["X"]), contentType: "image/png" });
    assert.equal(await okuma.readUnreadDayPhotos(db, DAY, { client: fakeClient({ "claude-haiku-5-5": detailed() }, models), read }), 1);
    assert.deepEqual(models, ["claude-haiku-5-5"]);
    // Son an yetmiyorsa yapay zekâ adımı atlanır (kayıtlı kod okunuşu kalır)
    const p3 = await newPhoto();
    await db.insert(s.aiCalls).values({ feature: "kasa-okc", model: "kod-ocr", servedModel: "kod-ocr", status: "ok", photoId: p3, userId: ayse.id, costUsd: 0, result: detailed() });
    await foto.attachAsilposDayPhotoCore(db, ayse, { date: DAY, branchId: ASILPOS_SUBE, photoId: p3 }, NOW);
    assert.equal(await okuma.readUnreadDayPhotos(db, DAY, { client: fakeClient({ "claude-haiku-5-5": detailed() }, models), read, deadlineAt: Date.now() + 1_000 }), 0);
    assert.equal(models.length, 1, "süre yetmedi: yeni çağrı yok");
  });
});
