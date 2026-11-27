// Şubesi kapatılmış (pasife alınmış) müdür bildirim almaz (denetim, 28 Kasım 2026; docs/ROLLER.md › Müdür), gerçek
// Postgres'te. Müdür şubesine kilitlidir: şubesi pasife alınınca oturumu yok sayılır, girişi reddedilir
// (src/lib/roles.ts › managerWithoutBranch). Hesabı ise "etkin" kalır; bildirim alıcıları yalnız `users.active`'e
// bakıyordu ve kitle kuralları şubesi kapalı hesabı "şubesiz" sayıyordu (personelde kilit kalkar, doğru; müdürde yanlış):
// panele giremeyen müdürün telefonuna öbür şubelerin karaoke, sipariş ve sayım bildirimleri, e-postasına vardiya ve
// kontrol listesi hatırlatmaları gitmeye devam ediyordu.
//
// Kural tek yerde: src/server/notify/reachable.ts (`reachableUser`, `reachableUsers`); Web Push'un tek kapısı sendPush ve
// kişiye e-posta gönderen işler (vardiya, kontrol listesi, karaoke) ondan okur. Bu dosya gerçek gönderim işlevlerini
// çağırır; dışarı giden istekler (push servisi, Resend) yakalanır.
//
// KAPALI_SUBE_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: KAPALI_SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/kapali-sube-mudur-bildirim-db.test.ts

import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { addDays, todayTR } from "../src/lib/reminders";
import { managerWithoutBranch } from "../src/lib/roles";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.KAPALI_SUBE_TEST_DATABASE_URL;
const DB_NAME = `laffogato_kapali_sube_${process.pid}`;

describe("Kapalı şubenin müdürü bildirim almaz", { skip: !SERVER_URL && "KAPALI_SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let push: typeof import("../src/server/push/send");
  let branchesMod: typeof import("../src/server/branches");
  let reach: typeof import("../src/server/notify/reachable");
  let vardiya: typeof import("../src/server/vardiya/notify");
  let reminders: typeof import("../src/server/notify/reminder-push");
  const realFetch = globalThis.fetch;
  /** Dışarı giden istekler: push servisine (cihazın adı) ve Resend'e (alıcı adresleri) */
  let pushed: string[] = [];
  let mailed: string[] = [];
  const ids: Record<"ali" | "meral" | "tuna" | "selin" | "ayse", number> = { ali: 0, meral: 0, tuna: 0, selin: 0, ayse: 0 };
  const MSG = { title: "Deneme", body: "Deneme", url: "/panel", tag: "deneme" };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "kapali-sube-testi-icin-en-az-otuz-iki-karakterlik-anahtar", RESEND_API_KEY: "re_test_kapali_sube" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
      if (target.hostname === "fcm.googleapis.com") {
        pushed.push(target.pathname.split("/").pop() ?? "");
        return new Response(null, { status: 201 });
      }
      if (target.hostname === "api.resend.com") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { to?: string[] };
        mailed.push(...(body.to ?? []));
        return new Response(JSON.stringify({ id: "test" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`beklenmeyen istek: ${target.href}`);
    }) as typeof fetch;

    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const add = async (key: keyof typeof ids, name: string, role: "admin" | "manager" | "staff", branchId: string | null) => {
      const [u] = await db.insert(s.users).values({ email: `${key}@ornek.com`, name, passwordHash: "x", role, branchId }).returning({ id: s.users.id, sessionVersion: s.users.sessionVersion });
      ids[key] = u.id;
      // Her kişinin bildirimi açık bir cihazı (gerçek biçimde anahtarlarla: gövde şifrelenir)
      const ecdh = createECDH("prime256v1");
      ecdh.generateKeys();
      await db.insert(s.pushSubscriptions).values({
        userId: u.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/${key}`,
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
        sessionVersion: u.sessionVersion,
        orders: true,
      });
    };
    await add("ali", "Ali Yönetici", "admin", null);
    await add("meral", "Meral Müdür", "manager", "marina");
    await add("tuna", "Tuna Müdür", "manager", "tuzla");
    await add("selin", "Selin Personel", "staff", "marina");
    await add("ayse", "Ayşe Personel", "staff", "tuzla");

    push = await import("../src/server/push/send");
    branchesMod = await import("../src/server/branches");
    reach = await import("../src/server/notify/reachable");
    vardiya = await import("../src/server/vardiya/notify");
    reminders = await import("../src/server/notify/reminder-push");
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    pushed = [];
    mailed = [];
  });

  const setMarina = (active: boolean) => db.update(s.branches).set({ active }).where(eq(s.branches.id, "marina"));
  const names = async () => (await reach.reachableUsers(db)).map((u) => u.email.split("@")[0]).sort();
  /** Marina'nın müdürüne tek değişiklik: yarının vardiyası (Tuzla'nın planında) */
  const change = () => [{ userId: ids.meral, date: addDays(todayTR(), 1), before: null, after: { kind: "work" as const, startMin: 600, endMin: 1080 } }] as never;

  test("şube açıkken: müdür bildirim alır (karşılaştırmanın dayanağı)", async () => {
    await setMarina(true);
    assert.deepEqual(await names(), ["ali", "ayse", "meral", "selin", "tuna"]);
    // Uygulama siparişi (Marina'da açık özellik): kitle Marina'nın müdürünü de sayar
    await push.sendPush("orders", { kind: "orders", ...MSG }, { userIds: await branchesMod.featureAudienceIds("siparis") });
    assert.ok(pushed.includes("meral"), "şubesi açık müdür sipariş bildirimini alır");
    pushed = [];
    assert.deepEqual(await vardiya.sendShiftChangeNotices(db, change(), { id: "tuzla", name: "Tuzla" }), { pushed: 1, emailed: 0, skipped: 0, failed: 0 });
    assert.deepEqual(pushed, ["meral"]);
  });

  test("şube kapanınca: kural oturumla aynı; kapalı şubenin müdürü alıcı değil, personeli (kilidi kalkar) ve öbür müdür alıcı", async () => {
    await setMarina(false);
    assert.equal(managerWithoutBranch({ role: "manager", branchId: "marina", branchActive: false }), true, "oturumu yok sayılır");
    assert.equal(managerWithoutBranch({ role: "staff", branchId: "marina", branchActive: false }), false, "personelde kilit kalkar, hesap kullanılır");
    assert.deepEqual(await names(), ["ali", "ayse", "selin", "tuna"]);
  });

  test("şube kapanınca: Web Push hiçbir konuda kapalı şubenin müdürüne gitmez (kitleyle, herkese ve yalnız ona)", async () => {
    await setMarina(false);
    // Karaoke (Tuzla'da): kitle kuralı şubesi kapalı hesabı şubesiz sayar; müdür yine de almaz
    await push.sendPush("karaoke", { kind: "karaoke", ...MSG }, { userIds: await branchesMod.featureAudienceIds("karaoke") });
    assert.ok(!pushed.includes("meral"), `karaoke bildirimi kapalı şubenin müdürüne gitti: ${pushed.join(", ")}`);
    assert.ok(pushed.includes("selin") && pushed.includes("tuna") && pushed.includes("ali"), `öbür alıcılar alır: ${pushed.join(", ")}`);
    pushed = [];
    await push.sendPush("orders", { kind: "orders", ...MSG }, { userIds: await branchesMod.featureAudienceIds("siparis") });
    assert.ok(!pushed.includes("meral"), "sipariş bildirimi");
    pushed = [];
    // Alıcı listesiz gönderim (ay sonu sayımı, tek şubede): herkese, o hariç
    await push.sendPush("reminders", { kind: "reminders", ...MSG });
    assert.deepEqual([...pushed].sort(), ["ali", "ayse", "selin", "tuna"]);
    pushed = [];
    // Yalnız ona (kişiye özel konular: vardiya, deneme)
    for (const topic of ["shifts", "approvals", "test"] as const) {
      assert.deepEqual(await push.sendPush(topic, { kind: topic, ...MSG }, { userIds: [ids.meral] }), { sent: 0, removed: 0, failed: 0 }, topic);
    }
    assert.deepEqual(pushed, []);
  });

  test("şube kapanınca: kişisel hatırlatıcı özeti ve vardiya bildirimi (bildirim de e-posta da) gitmez", async () => {
    await setMarina(false);
    await db.insert(s.userReminders).values({ userId: ids.meral, title: "Sipariş ver", dueDate: todayTR(), anchorDate: todayTR() });
    assert.deepEqual(await reminders.pushReminderSummaries(todayTR()), { users: 0, sent: 0, failed: 0 });
    assert.deepEqual(await vardiya.sendShiftChangeNotices(db, change(), { id: "tuzla", name: "Tuzla" }), { pushed: 0, emailed: 0, skipped: 0, failed: 0 });
    // Cihazı olmasa e-postaya düşerdi: o da gitmez
    await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, ids.meral));
    assert.deepEqual(await vardiya.sendShiftChangeNotices(db, change(), { id: "tuzla", name: "Tuzla" }), { pushed: 0, emailed: 0, skipped: 0, failed: 0 });
    assert.deepEqual(pushed, []);
    assert.deepEqual(mailed, []);
  });

  test("şube yeniden açılınca müdür yeniden alıcıdır", async () => {
    await setMarina(true);
    assert.deepEqual(await names(), ["ali", "ayse", "meral", "selin", "tuna"]);
  });
});
