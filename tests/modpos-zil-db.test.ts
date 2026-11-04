// ModPOS kasa föyünün zil, Bugün ve sabah e-postası satırları gerçek Postgres'te (docs/MODPOS-API.md › Nerede görünür):
// dünün kasa raporu saklanan föyden farklıysa yöneticinin zilinde Kasa başlığında "Kasa raporu ModPOS API'den farklı",
// Bugün'ün dünkü kasa satırında "ModPOS API'den farklı" işareti ve sabah e-postasının kutusunda satır; anahtar
// çalışmıyorsa Sistem başlığında "ModPOS API'den veri çekilemiyor". Personelin zili ve Bugün'ü hiçbirini almaz. LafPOS
// gününde, aynı yazılan raporda, sonradan başarılı çekimde ve anahtar yokken satır yok. Hiçbir istek gitmez (fetch
// çağrılırsa test düşer).
//
// Kendi geçici veritabanını açar (migration'larla), sonunda siler; oturum taklit edilir (src/server/auth/dal).
// MODPOS_TEST_DATABASE_URL (yoksa ZIL_TEST_DATABASE_URL, LAFPOS_TEST_DATABASE_URL) verilmezse atlanır.
// Çalıştırma: MODPOS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/modpos-zil-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { CASH_FLAGS, dayTasks } from "../src/app/panel/bugun/logic";
import { businessDate } from "../src/lib/cash-report";
import { parseKasaFoyu } from "../src/lib/modpos/foy";
import { MODPOS_STATE_KEY } from "../src/lib/modpos/status";
import { addDays, dayMonthTR, longDateTR } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.MODPOS_TEST_DATABASE_URL ?? process.env.ZIL_TEST_DATABASE_URL ?? process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_modpos_zil_${process.pid}`;
const plain = (v: string) => v.replace(/ /g, " ");

type Who = { id: number; name: string; email: string; role: "admin" | "staff" };

describe("ModPOS API: zil, Bugün ve sabah e-postası veritabanında", { skip: !SERVER_URL && "MODPOS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let bell: typeof import("../src/server/actions/notifications");
  let today: typeof import("../src/server/data/today");
  let digest: typeof import("../src/server/staff-requests/digest");
  let store: typeof import("../src/server/modpos/store");
  const users: Record<"ali" | "ayse", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin" },
    ayse: { id: 0, name: "Ayşe", email: "ayse@laffogato.net", role: "staff" },
  };
  let me: Who = users.ali;
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const envBefore = { key: process.env.MODPOS_API_KEY, vercel: process.env.VERCEL_ENV };
  /** İş günü ve dün: zil ve Bugün gerçek saate bakar */
  const day = businessDate(new Date());
  const Y = addDays(day, -1);
  let reportId = 0;

  /** Kitapçığın örnek föyü dünün günüyle (kapalı, nakit 8.210, kart 16.120,50, sayılan 7.820) */
  const foy = () => {
    const r = parseKasaFoyu(readFileSync("tests/fixtures/modpos/belge-ornegi.xml", "utf8"));
    assert.ok(r.ok);
    return { ...r.foy, kasaGunu: Y };
  };
  const keyError = (at: Date) => ({
    at: at.toISOString(),
    day: Y,
    kod: "ANAHTAR_GECERSIZ",
    text: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin",
    keyError: true,
  });
  const setState = (value: object) =>
    db.insert(s.integrationState).values({ key: MODPOS_STATE_KEY, value }).onConflictDoUpdate({ target: s.integrationState.key, set: { value } });
  const setSwitch = async (v: string | null) => {
    await db.delete(s.settings).where(eq(s.settings.key, "lafposGecisGunu"));
    if (v) await db.insert(s.settings).values({ key: "lafposGecisGunu", value: v });
  };
  const ids = async (who: Who) => {
    me = who;
    return (await bell.loadPanelNotifications()).map((i) => i.id);
  };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "modpos-zil-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    delete process.env.KARAOKE_SYNC_SECRET;
    delete process.env.VERCEL_ENV;
    // Biçimi doğru bir anahtar: istek hiç gitmemeli (zil, Bugün ve e-posta yalnız saklananı okur)
    process.env.MODPOS_API_KEY = "sk_test_0123456789abcdef0123456789abcdef";
    globalThis.fetch = (async () => {
      throw new Error("ModPOS'a istek gitmemeli");
    }) as typeof fetch;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const session = async () => ({ id: me.id, name: me.name, email: me.email, role: me.role });
    stub(require.resolve("../src/server/auth/dal"), {
      getCurrentUser: session,
      requireUser: session,
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("yönetici değil");
        return session();
      },
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const u of Object.values(users)) {
      const [row] = await db.insert(s.users).values({ email: u.email, name: u.name, passwordHash: "x", role: u.role }).returning({ id: s.users.id });
      u.id = row.id;
    }
    // Dünün raporu föyden yalnız nakitte farklı (8.190 yazılmış, föyde 8.210); kasa tutuyor
    const [r] = await db
      .insert(s.cashReports)
      .values({
        date: Y,
        zNo: "312",
        receipts: 214,
        zTotal: 28450.5,
        cash: 8190,
        card: 16120.5,
        offRevenue: 145,
        openingCash: 500,
        cashOut: 870,
        countedCash: 7820,
        handedOver: 7320,
        cashDiff: 0,
        submittedBy: users.ayse.id,
        submittedByName: "Ayşe",
      })
      .returning({ id: s.cashReports.id });
    reportId = r.id;
    store = await import("../src/server/modpos/store");
    await store.storeFoy(db, foy(), new Date());
    await setState({ lastError: keyError(new Date()) });
    bell = await import("../src/server/actions/notifications");
    today = await import("../src/server/data/today");
    digest = await import("../src/server/staff-requests/digest");
  });

  after(async () => {
    globalThis.fetch = realFetch;
    console.error = realError;
    if (envBefore.key === undefined) delete process.env.MODPOS_API_KEY;
    else process.env.MODPOS_API_KEY = envBefore.key;
    if (envBefore.vercel !== undefined) process.env.VERCEL_ENV = envBefore.vercel;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("yöneticinin zili: Kasa'da föyünden farklı (gün · alan), Sistem'de anahtar çalışmıyor; ikisi de doğru yere götürür", async () => {
    me = users.ali;
    const items = await bell.loadPanelNotifications();
    const diff = items.find((i) => i.id === `kasa-modpos-${Y}-r1-s1`);
    assert.ok(diff, JSON.stringify(items.map((i) => i.id)));
    assert.deepEqual([diff.kind, diff.title, diff.group, diff.href, diff.timeLabel, diff.unread], ["warning", "Kasa raporu ModPOS API'den farklı", "kasa", `/panel/kasa?gun=${Y}`, "Dün", true]);
    assert.equal(plain(diff.body), `${longDateTR(Y)} · Nakit 8.190 ₺ (ModPOS API'de 8.210 ₺)`);
    const key = items.find((i) => i.id === "modpos-anahtar-ANAHTAR_GECERSIZ-0");
    assert.ok(key, JSON.stringify(items.map((i) => i.id)));
    assert.deepEqual([key.kind, key.title, key.group, key.href, key.timeLabel], ["danger", "ModPOS API'den veri çekilemiyor", "sistem", "/panel/ayarlar#modpos", "Bugün"]);
    assert.equal(key.body, "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin");
  });

  test("personelin zili föyü ve anahtarı hiç anmaz", async () => {
    me = users.ayse;
    const items = await bell.loadPanelNotifications();
    assert.equal(items.filter((i) => /modpos/i.test(i.id)).length, 0, JSON.stringify(items.map((i) => i.id)));
    assert.doesNotMatch(JSON.stringify(items), /föyünde|ModPOS kasa föyü|MODPOS_API_KEY/);
    me = users.ali;
  });

  test("Bugün: yöneticinin dünkü kasa satırı 'ModPOS API'den farklı' ile sorun var; personelin olgusunda işaret yok", async () => {
    const logged: unknown[] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      const adminDay = await today.loadToday(users.ali);
      assert.deepEqual(adminDay.facts.cash?.yesterday?.flags, [CASH_FLAGS.modpos]);
      const row = dayTasks(adminDay.facts).find((t) => t.key === "kasa-dun");
      assert.ok(row);
      assert.equal(row.status, "warn");
      assert.equal(row.badge, "ModPOS API'den farklı");
      const staffDay = await today.loadToday(users.ayse);
      assert.equal(staffDay.facts.cash?.yesterday?.flags, undefined);
      assert.doesNotMatch(JSON.stringify(staffDay.facts), /ModPOS API'den farklı/);
    } finally {
      console.error = realError;
    }
  });

  test("sabah e-postası: kutuda anahtar (kırmızı) ve dünün farkı (turuncu); yalnız bunlar varken 'ModPOS kasa föyü' başlığıyla güne götürür", async () => {
    const box = await digest.loadApprovalsDigest(new Date());
    assert.ok(box);
    assert.deepEqual(
      box.box.lines.map((l) => [plain(l.text), l.tone]),
      [
        ["ModPOS API'den veri çekilemiyor. ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin", "bad"],
        [`Kasa raporu ModPOS API'den farklı. ${plain(dayMonthTR(Y))} · Nakit 8.190 ₺ (ModPOS API'de 8.210 ₺)`, "warn"],
      ],
    );
    assert.deepEqual([box.box.title, box.box.href, box.box.link, box.box.subjectPart, box.box.headline], ["ModPOS API", `/panel/kasa?gun=${Y}`, "Kasa raporunu aç", null, null]);
    assert.deepEqual(box.logKeys, []);
  });

  test("sonradan başarılı çekim anahtarın satırını kaldırır; anahtar yoksa satır yok, e-posta yalnız farkı söyler", async () => {
    await setState({ lastError: keyError(new Date(Date.now() - 60_000)), lastOk: { at: new Date().toISOString(), day: Y } });
    assert.ok(!(await ids(users.ali)).some((id) => id.startsWith("modpos-anahtar-")));
    await setState({ lastError: keyError(new Date()) });
    assert.ok((await ids(users.ali)).includes("modpos-anahtar-ANAHTAR_GECERSIZ-0"));
    delete process.env.MODPOS_API_KEY;
    try {
      assert.ok(!(await ids(users.ali)).some((id) => id.startsWith("modpos-anahtar-")));
      const box = await digest.loadApprovalsDigest(new Date());
      assert.deepEqual(box?.box.lines.map((l) => l.tone), ["warn"]);
      // Biçimi bozuk anahtar (boşluklu) canlıda da uyarıdır, durum okunmadan
      process.env.MODPOS_API_KEY = "sk_test bozuk anahtar degeri 1234";
      assert.ok((await ids(users.ali)).includes("modpos-anahtar-bicim"));
    } finally {
      process.env.MODPOS_API_KEY = "sk_test_0123456789abcdef0123456789abcdef";
    }
  });

  test("LafPOS gününde ve aynı yazılan raporda föy satırı yok; rapor yeniden gönderilince kimlik değişir", async () => {
    await setSwitch(Y);
    try {
      assert.ok(!(await ids(users.ali)).some((id) => id.startsWith("kasa-modpos-")), "geçiş günü LafPOS");
      const box = await digest.loadApprovalsDigest(new Date());
      assert.ok(!box?.box.lines.some((l) => l.text.startsWith("Kasa raporu ModPOS")));
    } finally {
      await setSwitch(null);
    }
    await db.update(s.cashReports).set({ cash: 8000, revision: 2 }).where(eq(s.cashReports.id, reportId));
    assert.ok((await ids(users.ali)).includes(`kasa-modpos-${Y}-r2-s1`));
    await db.update(s.cashReports).set({ cash: 8210, revision: 3 }).where(eq(s.cashReports.id, reportId));
    assert.ok(!(await ids(users.ali)).some((id) => id.startsWith("kasa-modpos-")), "föyle aynı");
    const adminDay = await today.loadToday(users.ali);
    assert.ok(!(adminDay.facts.cash?.yesterday?.flags ?? []).includes(CASH_FLAGS.modpos));
  });
});
