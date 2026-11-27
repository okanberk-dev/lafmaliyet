// Dalga 2 bildirimlerinin veritabanı tarafı, gerçek Postgres'te: vardiya kaydının kişilere bildirilecek değişiklikleri
// (kayıttan önceki hâlle; src/server/vardiya/store.ts saveShiftWeek), gelecek haftanın planı yazılmadıysa zil ve günlük
// işin bildirimi (şube ve gün başına bir kez; src/server/vardiya/notify.ts, src/server/bell/vardiya.ts), vardiyası
// değişen kişiye gönderim (bildirim açık cihaz ve e-posta yoksa atlanır) ve onay isteğinin bildirimi (yalnız bekleyen
// istek; src/server/staff-requests/push.ts). Push aboneliği ve Resend yok: hiçbir bildirim dışarı gitmez.
// Saf kurallar: tests/vardiya-bildirim.test.ts, tests/onay-bildirimi.test.ts.
//
// BILDIRIM_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Test kendi geçici
// veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: BILDIRIM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/bildirim-gonderim-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES, DEFAULT_BRANCHES } from "../src/lib/branches";
import { vardiyaStep } from "../src/lib/job-health";
import { addDays, todayTR } from "../src/lib/reminders";
import { weekStart } from "../src/lib/vardiya";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.BILDIRIM_TEST_DATABASE_URL;
const DB_NAME = `laffogato_bildirim_${process.pid}`;
const E = ["", "", "", "", "", "", ""];
/** Cuma 08:30 (Türkiye): hatırlatma zamanı; gelecek hafta 30 Kasım */
const FRIDAY = new Date("2026-11-27T05:30:00Z");
const NEXT_MONDAY = "2026-11-30";

describe("Dalga 2 bildirimleri: veritabanında", { skip: !SERVER_URL && "BILDIRIM_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let store: typeof import("../src/server/vardiya/store");
  let notify: typeof import("../src/server/vardiya/notify");
  let bell: typeof import("../src/server/bell/vardiya");
  let requestPush: typeof import("../src/server/staff-requests/push");
  const ids = { admin: 0, ayse: 0, mehmet: 0 };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "bildirim-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    delete process.env.RESEND_API_KEY;
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
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const add = async (email: string, name: string, role: "admin" | "staff") =>
      (await db.insert(s.users).values({ email, name, passwordHash: "x", role, branchId: role === "staff" ? "tuzla" : null }).returning({ id: s.users.id }))[0].id;
    ids.admin = await add("yonetici@laffogato.net", "Yönetici", "admin");
    ids.ayse = await add("ayse@laffogato.net", "Ayşe Kaya", "staff");
    ids.mehmet = await add("mehmet@laffogato.net", "Mehmet Can", "staff");
    store = await import("../src/server/vardiya/store");
    notify = await import("../src/server/vardiya/notify");
    bell = await import("../src/server/bell/vardiya");
    requestPush = await import("../src/server/staff-requests/push");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE shifts, notification_log, staff_requests RESTART IDENTITY CASCADE`);
    await db.update(s.users).set({ active: true });
  });

  /** Bir kişinin satırı: ekranda gördüğü (`seen`) ve yazdığı */
  const row = (id: number, name: string, cells: string[], seen: string[] = E) => ({ ref: `u:${id}`, name, cells, seen });
  const save = (week: string, rows: ReturnType<typeof row>[], branchId = "tuzla") => store.saveShiftWeek(db, { name: "Yönetici" }, { branchId, week, rows } as never);

  test("vardiya kaydı: haftanın ilk yazımı bildirim değil; değişen, eklenen ve silinen gün kişiye; hesapsız çalışan yok", async () => {
    // Bugünden sonraki bir hafta (geçmiş günler bildirilmez)
    const monday = addDays(weekStart(todayTR()), 7);
    const first = await save(monday, [row(ids.ayse, "Ayşe Kaya", ["10-18", "10-18", "", "", "", "", ""]), { ref: "n:ali usta", name: "Ali Usta", cells: ["08-16", "", "", "", "", "", ""], seen: E }]);
    assert.deepEqual(first.changes, [], "plan parça parça yazılırken herkese ileti gitmez");

    const shown = ["10:00–18:00", "10:00–18:00", "", "", "", "", ""];
    const second = await save(monday, [
      row(ids.ayse, "Ayşe Kaya", ["10:00–18:00", "12-20", "10-18", "", "", "", ""], shown),
      row(ids.mehmet, "Mehmet Can", ["", "", "", "09-17", "", "", ""]),
      { ref: "n:ali usta", name: "Ali Usta", cells: ["09-17", "", "", "", "", "", ""], seen: ["08:00–16:00", "", "", "", "", "", ""] },
    ]);
    // Ayşe: Salı değişti, Çarşamba eklendi (haftası zaten yazılıydı); Mehmet'in ilk yazımı ve hesapsız Ali sayılmaz
    assert.deepEqual(
      second.changes.map((c) => [c.userId, c.date, c.before?.kind ?? null, c.after?.kind ?? null]),
      [
        [ids.ayse, addDays(monday, 1), "work", "work"],
        [ids.ayse, addDays(monday, 2), null, "work"],
      ],
    );

    const third = await save(monday, [row(ids.ayse, "Ayşe Kaya", ["", "12:00–20:00", "10:00–18:00", "", "", "", ""], ["10:00–18:00", "12:00–20:00", "10:00–18:00", "", "", "", ""])]);
    assert.deepEqual(
      third.changes.map((c) => [c.userId, c.date, c.after]),
      [[ids.ayse, monday, null]],
      "silinen gün kaldırıldı diye bildirilir",
    );

    // Gönderim: bildirim açık cihazı yok, e-posta kurulu değil: atlanır; pasif hesaba hiç gitmez
    assert.deepEqual(await notify.sendShiftChangeNotices(db, second.changes, second.branch), { pushed: 0, emailed: 0, skipped: 1, failed: 0 });
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, ids.ayse));
    assert.deepEqual(await notify.sendShiftChangeNotices(db, second.changes, second.branch), { pushed: 0, emailed: 0, skipped: 0, failed: 0 });
    // İstek dışında (betik, test) yanıttan sonraki gönderim kurulmaz, hata da fırlamaz
    assert.doesNotThrow(() => notify.notifyShiftChanges(second.changes, second.branch));
  });

  test("gelecek haftanın planı: Perşembe 18:00'den önce yok; yazılmamış her fiziksel şube zilde, seçili şubeye göre", async () => {
    assert.deepEqual((await notify.missingNextWeekPlans(db, new Date("2026-11-26T14:00:00Z"))).branches, [], "Perşembe 17:00: henüz değil");
    const due = await notify.missingNextWeekPlans(db, new Date("2026-11-26T15:30:00Z"));
    assert.equal(due.monday, NEXT_MONDAY, "Perşembe 18:30");
    assert.deepEqual(due.branches.map((b) => b.id).sort(), ["marina", "tuzla"], "online kanalın vardiyası yok");

    // Tuzla'nın planı yazılınca yalnız Marina kalır
    assert.ok((await save(NEXT_MONDAY, [row(ids.ayse, "Ayşe Kaya", ["10-18", "", "", "", "", "", ""])])).written);
    const rows = await bell.vardiyaBell(ALL_BRANCHES, FRIDAY);
    assert.deepEqual(
      rows.map((r) => [r.id, r.title, r.href, r.group]),
      [[`vardiya-plan-marina-${NEXT_MONDAY}`, "Marina: gelecek haftanın vardiyası yazılmadı", `/panel/vardiya?hafta=${NEXT_MONDAY}&sube=marina`, "uyari"]],
    );
    assert.deepEqual(await bell.vardiyaBell("tuzla", FRIDAY), [], "Tuzla seçiliyken Tuzla'nın planı yazılı");
    assert.equal((await bell.vardiyaBell("marina", FRIDAY)).length, 1);
    // Şube ayrımı (parça 2): online kanalın vardiyası yok, kanal seçiliyken öbür şubelerin hatırlatması da görünmez
    assert.equal((await bell.vardiyaBell("online", FRIDAY)).length, 0, "online kanal seçiliyken (vardiyası yok) hiçbiri");
  });

  test("günlük işin hatırlatması: şube ve gün başına bir kez; cihaz yoksa sorun değil; plan yazılınca susar", async () => {
    const first = await notify.pushPlanReminders(db, FRIDAY);
    assert.deepEqual(first, { status: "sent", tried: 2, sent: 0, failed: 0 });
    assert.deepEqual(vardiyaStep(first), { code: "nodevice" }, "bildirim açık yönetici cihazı yok: bilgi, hata değil");
    const keys = (await db.select({ key: s.notificationLog.key }).from(s.notificationLog)).map((r) => r.key).sort();
    assert.deepEqual(keys, [`vardiya-plan:marina:${NEXT_MONDAY}:2026-11-27`, `vardiya-plan:tuzla:${NEXT_MONDAY}:2026-11-27`]);

    // İş aynı gün yeniden çalışırsa yeniden göndermez; adım yazılmaz
    const again = await notify.pushPlanReminders(db, new Date(FRIDAY.getTime() + 3_600_000));
    assert.equal(again.tried, 0);
    assert.equal(vardiyaStep(again), undefined);

    // Ertesi gün yazılmamış şube yeniden hatırlatılır
    assert.ok((await save(NEXT_MONDAY, [row(ids.ayse, "Ayşe Kaya", ["10-18", "", "", "", "", "", ""])])).written);
    const saturday = await notify.pushPlanReminders(db, new Date(FRIDAY.getTime() + 86_400_000));
    assert.equal(saturday.tried, 1, "yalnız Marina");

    // Yönetici yoksa (hepsi pasif) atlanır
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, ids.admin));
    assert.deepEqual(await notify.pushPlanReminders(db, new Date(FRIDAY.getTime() + 2 * 86_400_000)), { status: "skip", tried: 0, sent: 0, failed: 0 });
    // Hatırlatma günü değilse (Salı) hiç bakılmaz
    await db.update(s.users).set({ active: true }).where(eq(s.users.id, ids.admin));
    assert.equal((await notify.pushPlanReminders(db, new Date("2026-12-01T05:30:00Z"))).status, "skip");
  });

  test("onay isteğinin bildirimi: yalnız hâlâ bekleyen istek, etkin yönetici varken; kaldırılan tür hiç", async () => {
    const insert = async (kind: string, status = "pending") =>
      (
        await db
          .insert(s.staffRequests)
          .values({ kind: kind as never, subject: "gun:2026-11-25:tuzla", day: "2026-11-25", title: "25 Kasım kasa raporunun silinmesi", payload: {}, status: status as never, requestedBy: ids.ayse, requestedByName: "Ayşe Kaya" })
          .returning({ id: s.staffRequests.id })
      )[0].id;
    const pending = await insert("kasa-silme");
    assert.deepEqual(await requestPush.sendRequestPush(db, pending), { sent: 0, removed: 0, failed: 0 }, "bekleyen istek yöneticilere gönderilir (cihaz yok)");
    assert.equal(await requestPush.sendRequestPush(db, await insert("kasa-silme", "withdrawn")), null, "arada geri çekilen gitmez");
    assert.equal(await requestPush.sendRequestPush(db, await insert("kasa-silme", "approved")), null, "karara bağlanan gitmez");
    assert.equal(await requestPush.sendRequestPush(db, await insert("mal-taslak")), null, "kaldırılan tür");
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, ids.admin));
    assert.equal(await requestPush.sendRequestPush(db, pending), null, "etkin yönetici yoksa gönderilecek yok");
    // İstek dışında yanıttan sonraki gönderim kurulmaz, hata fırlamaz; güncelleme (created: false) hiç denemez
    assert.doesNotThrow(() => requestPush.pushNewRequest({ row: { id: pending }, created: true }));
    assert.doesNotThrow(() => requestPush.pushNewRequest({ row: { id: pending }, created: false }));
  });
});
