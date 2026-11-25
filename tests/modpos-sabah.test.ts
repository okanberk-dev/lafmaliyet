// Sabah işinin ModPOS kasa föyü adımı (docs/MODPOS-API.md › Nerede görünür, › Kota ve çekme sırası): adımın kodları ve
// sözcükleri (src/lib/job-health.ts modposStep, Ayarlar › Günlük işler), yalnız hatanın işi "kısmen" yapması (hak
// dolması ve bir günün alınamaması sorun değil), kurulmamış bağlantıda ve önizlemede adımın hiç yazılmaması; rotada
// (src/app/api/cron/gunluk/route.ts) çekmenin yalnız bir kez, Paraşüt'ün yeniden denemesinden önce ve extras()'ın
// dışında başlaması (günde 2 hak var), sabah e-postasından önce beklenmesi ve iki sonuçta da adımın yazılması.
//
// Veritabanı bölümü gerçek syncModpos'u sahte ModPOS yanıtlarıyla çalıştırır (istek ağa çıkmaz) ve sonucun adımını
// sınar; kendi geçici veritabanını açar (MODPOS_TEST_DATABASE_URL'in sunucusunda), migration'ları uygular, sonunda
// siler. MODPOS_TEST_DATABASE_URL verilmezse yalnız o bölüm atlanır.
// Çalıştırma: npx tsx --test tests/modpos-sabah.test.ts
// Veritabanıyla: MODPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/modpos-sabah.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { dailyOutcome, modposStep, STEP_LABELS, stepTexts } from "../src/lib/job-health";
import { addDays, todayTR } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import { JOB_SEND_DEADLINE_MS } from "../src/server/jobs/capped";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const ok = { code: "ok" };
const base = { sync: { code: "today" }, digest: { code: "sent" }, reminders: ok, karaoke: ok, menu: ok, sales: ok };
const KEY_TEXT = "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin";

test("ModPOS adımı: kurulmamış ve önizleme yazılmaz; alındı, çekilecek gün yok, hak doldu, bir kısmı alınamadı; hata metniyle", () => {
  assert.equal(modposStep({ status: "off" }), undefined);
  assert.equal(modposStep({ status: "preview" }), undefined);
  assert.deepEqual(modposStep({ status: "ok" }), { code: "ok" });
  assert.deepEqual(modposStep({ status: "nothing" }), { code: "nothing" });
  // Başka çekim sürüyordu (aynı anda tek çekim, kira): hata değil, istek gitmedi
  assert.deepEqual(modposStep({ status: "busy", error: "Başka bir ModPOS çekimi sürüyor: biraz sonra yeniden deneyin" }), { code: "busy" });
  // Hak dolması ve bir günün alınamaması sorun değil: metin adıma taşınmaz (iş "kısmen" olmaz, mesaj yazılmaz)
  assert.deepEqual(modposStep({ status: "kota", error: "ModPOS API'nin bugünkü çekim hakkı doldu" }), { code: "kota" });
  assert.deepEqual(modposStep({ status: "partial", error: "ModPOS API veriyi hazırlayamadı (hak geri verildi): sonra yeniden denenecek" }), { code: "partial" });
  assert.deepEqual(modposStep({ status: "error", error: KEY_TEXT }), { code: "error", error: KEY_TEXT });
  // Rotanın yedek sonucu (istisna ya da süre doldu) da aynı biçim
  assert.deepEqual(modposStep({ status: "error", error: "süre doldu" }), { code: "error", error: "süre doldu" });
  assert.deepEqual(modposStep({ status: "error" }), { code: "error", error: null });
  assert.deepEqual(modposStep({ status: "error", error: "" }), { code: "error", error: null });
});

test("ModPOS adımının sözcükleri (Ayarlar › Günlük işler); yalnız hata işi kısmen yapar, mesaj adımın adıyla", () => {
  const words: Record<string, string> = {
    ok: "ModPOS API verisi alındı",
    nothing: "ModPOS: çekilecek gün yok",
    kota: "ModPOS: günlük hak doldu",
    partial: "ModPOS: bir kısmı alınamadı",
    busy: "ModPOS: başka çekim sürüyordu",
    error: "ModPOS API hata",
  };
  assert.deepEqual(STEP_LABELS.modpos, words);
  for (const [code, text] of Object.entries(words)) {
    assert.deepEqual(stepTexts({ modpos: code }), [text], code);
    const out = dailyOutcome({ ...base, modpos: { code, error: code === "error" ? "zaman aşımı" : null } });
    assert.deepEqual(out.steps, { ...dailyOutcome(base).steps, modpos: code }, code);
    assert.equal(out.status, code === "error" ? "partial" : "ok", code);
    assert.equal(out.message, code === "error" ? "ModPOS API: zaman aşımı" : null, code);
  }
  // Verilmeyen adım hiç yazılmaz (anahtar yok, önizleme): eskisiyle aynı sonuç
  assert.deepEqual(Object.keys(dailyOutcome(base).steps), ["digest", "sync", "reminders", "karaoke", "menu", "sales"]);
  // Metinsiz hata "bilinmeyen hata"; e-posta gidemediyse iş yine "hata"
  assert.equal(dailyOutcome({ ...base, modpos: { code: "error" } }).message, "ModPOS API: bilinmeyen hata");
  assert.equal(dailyOutcome({ ...base, digest: { code: "error", error: "x" }, modpos: { code: "ok" } }).status, "error");
});

test("ModPOS adımının yeri: satış tahmininden sonra, fotoğraf temizliğinden önce (adımlar, mesaj ve sözcükler)", () => {
  const out = dailyOutcome({
    ...base,
    photos: { code: "error", error: "2 fotoğraf depodan silinemedi" },
    modpos: modposStep({ status: "error", error: KEY_TEXT }),
    forecast: { code: "error", error: "MET yanıt vermedi" },
  });
  assert.deepEqual(Object.keys(out.steps), ["digest", "sync", "reminders", "karaoke", "menu", "sales", "forecast", "modpos", "photos"]);
  assert.equal(out.status, "partial");
  assert.equal(out.message, `Satış tahmini: MET yanıt vermedi · ModPOS API: ${KEY_TEXT} · Fotoğraf temizliği: 2 fotoğraf depodan silinemedi`);
  assert.deepEqual(stepTexts({ photos: "none", modpos: "kota", forecast: "ok", digest: "sent" }), [
    "E-posta gönderildi",
    "Tahmin kaydedildi",
    "ModPOS: günlük hak doldu",
    "Silinecek fotoğraf yok",
  ]);
  // Bilinmeyen kod adın yanında
  assert.deepEqual(stepTexts({ modpos: "busy" }), ["ModPOS: başka çekim sürüyordu"]);
  // Saf modül sunucuya uzanmaz
  assert.doesNotMatch(read("src/lib/job-health.ts"), /from "@\/server/);
});

test("sabah işi: ModPOS yalnız bir kez başlar (Paraşüt'ten önce, extras() dışında), e-postadan önce beklenir, iki sonuçta da yazılır", () => {
  const route = read("src/app/api/cron/gunluk/route.ts");
  // Tek çağrı: extras() iki kez çalışabilir (try ve catch), günde 2 hak var
  assert.equal([...route.matchAll(/syncModposAll\(/g)].length, 1);
  assert.doesNotMatch(route, /syncModpos\(/, "şube şube koşucudan (syncModposAll; docs/MODPOS-API.md › Şubeler)");
  assert.equal([...route.matchAll(/const modposP = /g)].length, 1);
  const start = route.indexOf("const modposP = capped<ModposSyncResult>(");
  assert.ok(start > route.indexOf('startJobRun("gunluk")'), "iş kaydından sonra");
  assert.ok(start < route.indexOf("syncParasutAccounts("), "Paraşüt'ün yeniden denemesinden önce (onunla aynı anda sürer)");
  const extras = route.slice(route.indexOf("const extras = async () => {"), route.indexOf("const modpos = await modposP;"));
  assert.ok(extras.length > 0);
  assert.doesNotMatch(extras, /modpos/i, "extras() ModPOS'a dokunmaz");
  // Anahtar yoksa çekme hiç başlamaz; son an ve beklenme sınırı jobStart'tan
  assert.match(route, /\(isModposConfigured\(\) \? syncModposAll\("cron", \{ deadlineAt: jobStart \+ MODPOS_DEADLINE_MS \}\) : Promise\.resolve\(MODPOS_OFF\)\)\.catch\(/);
  assert.match(route, /jobStart \+ MODPOS_CAP_MS - Date\.now\(\),/);
  const ms = (name: string) => Number(route.match(new RegExp(`const ${name} = ([\\d_]+);`))?.[1].replace(/_/g, ""));
  assert.equal(ms("MODPOS_DEADLINE_MS"), 30_000);
  assert.equal(ms("MODPOS_CAP_MS"), 32_000);
  assert.ok(ms("MODPOS_CAP_MS") > ms("MODPOS_DEADLINE_MS") && ms("MODPOS_CAP_MS") < JOB_SEND_DEADLINE_MS, "yazma payı var, e-postanın sınırından önce");
  // Bir kez beklenir: sabah e-postasından (ve try'dan) önce
  assert.equal([...route.matchAll(/await modposP/g)].length, 1);
  const awaited = route.indexOf("const modpos = await modposP;");
  assert.ok(awaited < route.indexOf("runReminderDigest("), "e-postadan önce: e-posta, zil ve Bugün taze föyü görür");
  assert.ok(awaited < route.indexOf("  try {\n    // Sistem bölümü"), "iki sonuç da aynı sonucu kullanır");
  // Adım yalnız yazılacaksa; iki sonuçta da
  assert.match(route, /const mpStep = modposResult \? \{ modpos: modposResult \} : \{\};/);
  assert.equal([...route.matchAll(/\.\.\.ex\.steps, \.\.\.mpStep \}\)/g)].length, 2);
  assert.equal([...route.matchAll(/modpos: modpos\.status, /g)].length, 2);
  // Yeni zamanlanmış iş yok
  assert.equal(JSON.parse(read("vercel.json")).crons.length, 2);
});

// ---------------------------------------------------------------- Gerçek çekme, sahte ModPOS (veritabanıyla)

const SERVER_URL = process.env.MODPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_modpos_sabah_${process.pid}`;
const FIXTURE = read("tests/fixtures/modpos/belge-ornegi.xml");
const KOTA_XML = read("tests/fixtures/modpos/hata-kota.xml");
/** Testin anahtarı (biçimi geçerli, gerçek değil) */
const KEY = "test_modpos_sabah_0123456789abcdef";

type Reply = (day: string) => Response;
const foyReply =
  (kalan: number): Reply =>
  (day) =>
    new Response(FIXTURE.replace("<kasaGunu>2026-11-01</kasaGunu>", `<kasaGunu>${day}</kasaGunu>`), {
      status: 200,
      headers: { "content-type": "application/xml", "x-kota-hak": "2", "x-kota-kalan": String(kalan) },
    });
const errorReply =
  (status: number, xml: string): Reply =>
  () =>
    new Response(xml, { status, headers: { "content-type": "application/xml" } });
const hata = (kod: string, mesaj: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<hata>\n  <kod>${kod}</kod>\n  <mesaj>${mesaj}</mesaj>\n</hata>`;

describe("Sabah işinin ModPOS çekimi: gerçek syncModpos, sahte yanıtlar (veritabanında)", { skip: !SERVER_URL && "MODPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let sync: typeof import("../src/server/modpos/sync");

  /** Sabah işinin çağrısı (trigger "cron", 30 sn): yanıtlar sırayla verilir; istenen günler kaydedilir */
  const morning = async (replies: Reply[], env: Record<string, string | undefined> = {}) => {
    const asked: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const day = new URL(String(input instanceof Request ? input.url : input)).searchParams.get("tarih") ?? "";
      asked.push(day);
      const reply = replies.shift();
      assert.ok(reply, `beklenmeyen istek: ${day}`);
      return reply(day);
    }) as typeof fetch;
    const result = await sync.syncModpos("cron", {
      deadlineAt: Date.now() + 30_000,
      db,
      fetchImpl,
      env: { MODPOS_API_KEY: KEY, MODPOS_SYNC_FROM: addDays(todayTR(), -5), ...env },
    });
    return { result, step: modposStep(result), asked };
  };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    process.env.DATABASE_URL = url.href;
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    db = (await import("../src/server/db")).getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    sync = await import("../src/server/modpos/sync");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE modpos_cash_sheets, integration_state`);
  });

  test("iki gün alındı: 'ModPOS API verisi alındı', iş tamam; ertesi çalışma hak bitince istek göndermez", async () => {
    const first = await morning([foyReply(1), foyReply(0)]);
    assert.equal(first.result.status, "ok");
    assert.equal(first.asked.length, 2);
    assert.deepEqual(first.result.days.map((d) => d.result), ["yeni", "yeni"]);
    assert.deepEqual(first.step, { code: "ok" });
    assert.equal(dailyOutcome({ ...base, modpos: first.step }).status, "ok");
    // Aynı gün yeniden: kalan hak 0 (yanıt başlığından), istek gitmez, sorun değil
    const again = await morning([]);
    assert.equal(again.result.status, "kota");
    assert.deepEqual(again.asked, []);
    assert.deepEqual(again.step, { code: "kota" });
    assert.equal(dailyOutcome({ ...base, modpos: again.step }).status, "ok");
  });

  test("bir gün alındı, öteki hazırlanamadı (500): 'bir kısmı alınamadı', iş kısmen değil", async () => {
    const r = await morning([foyReply(1), errorReply(500, hata("RAPOR_URETILEMEDI", "Rapor üretilemedi"))]);
    assert.equal(r.result.status, "partial");
    assert.deepEqual(r.step, { code: "partial" });
    const out = dailyOutcome({ ...base, modpos: r.step });
    assert.equal(out.status, "ok");
    assert.deepEqual(stepTexts(out.steps), [...stepTexts(dailyOutcome(base).steps), "ModPOS: bir kısmı alınamadı"]);
  });

  test("hak doldu (429 KOTA_DOLDU): 'günlük hak doldu', ikinci gün istenmez, iş kısmen değil", async () => {
    const r = await morning([errorReply(429, KOTA_XML)]);
    assert.equal(r.asked.length, 1);
    assert.equal(r.result.status, "kota");
    assert.deepEqual(r.step, { code: "kota" });
    assert.equal(dailyOutcome({ ...base, modpos: r.step }).status, "ok");
  });

  test("anahtar geçersiz (401): hata metniyle, ikinci gün denenmez; iş kısmen ('Sabah işinde bir adım hata verdi')", async () => {
    const r = await morning([errorReply(401, hata("ANAHTAR_GECERSIZ", "API anahtarı geçersiz"))]);
    assert.equal(r.asked.length, 1);
    assert.equal(r.result.status, "error");
    assert.deepEqual(r.step, { code: "error", error: KEY_TEXT });
    const out = dailyOutcome({ ...base, modpos: r.step });
    assert.equal(out.status, "partial");
    assert.equal(out.message, `ModPOS API: ${KEY_TEXT}`);
  });

  test("anahtar yok, biçimi bozuk ya da önizleme: istek yok, adım yazılmaz; çekilecek gün yoksa 'çekilecek gün yok'", async () => {
    for (const env of [{ MODPOS_API_KEY: undefined }, { MODPOS_API_KEY: "kisa" }, { VERCEL_ENV: "preview" }]) {
      const r = await morning([], env);
      assert.deepEqual(r.asked, [], JSON.stringify(env));
      assert.ok(r.result.status === "off" || r.result.status === "preview", JSON.stringify(env));
      assert.equal(r.step, undefined, JSON.stringify(env));
      assert.deepEqual(Object.keys(dailyOutcome({ ...base, ...(r.step ? { modpos: r.step } : {}) }).steps), Object.keys(dailyOutcome(base).steps));
    }
    // Geçmişin ilk günü bugünse çekilecek gün yok (bugün kendiliğinden çekilmez)
    const none = await morning([], { MODPOS_SYNC_FROM: todayTR() });
    assert.equal(none.result.status, "nothing");
    assert.deepEqual(none.asked, []);
    assert.deepEqual(none.step, { code: "nothing" });
    assert.equal(dailyOutcome({ ...base, modpos: none.step }).status, "ok");
  });
});
