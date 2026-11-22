// Karaoke e-postaları gerçek Postgres'te, Resend'in sahte ucuyla (hiçbir e-posta gitmez, yalnız yakalanır):
// - misafirin "bir gün kaldı" hatırlatması: adres şifreli durur, zamanı gelince bir kez gider ve silinir; iptalde, geç
//   kalınca gitmez; gönderilemeyince yeniden denenir; iki çalışma aynı iletiyi iki kez göndermez;
// - personelin sabah ve "3 saat kala" e-postaları: o gün vardiyada olanlara (plan yoksa şubenin personeline), bir kez;
//   sabah listesinde bildirilen rezervasyonun "3 saat kala"sı aynı anda ayrıca gitmez.
// Kurallar tests/karaoke-hatirlatma.test.ts'te (saf). Yalnız kendi açtığı satırları yazar ve siler (kimlik `kr-hat-<pid>-…`,
// adres `kr-hat-<pid>-…@test.local`); personel e-postaları başka testlerin verisine karışmasın diye 2031'deki bir günle
// sınanır. integration_state'teki bildirim ayarını başta saklar, sonda geri yazar.
//
// HATIRLATMA_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı; npm run test:db).

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, inArray, like, or } from "drizzle-orm";

import { REMINDER_LOG_RECIPIENT, REMINDER_SKIP, reminderLogKey } from "../src/lib/karaoke/reminder";
import { staffMorningKey } from "../src/lib/karaoke/staff-mail";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL_ = process.env.HATIRLATMA_TEST_DATABASE_URL;
const PREFIX = `kr-hat-${process.pid}-`;
const H = 3_600_000;
const tr = (date: string, hour: number, minute = 0) => Date.parse(`${date}T00:00:00Z`) - 3 * H + hour * H + minute * 60_000;
const GUEST = `${PREFIX}misafir@test.local`;
const NOTIFY_KEY = "notify.settings";

describe("Karaoke e-postaları: misafir hatırlatması ve personel e-postaları (Resend'in sahte ucuyla)", { skip: !URL_ && "HATIRLATMA_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let reminders: typeof import("../src/server/karaoke/reminders");
  let staffMail: typeof import("../src/server/karaoke/staff-mail");
  let board: typeof import("../src/server/karaoke/board");
  let closeDb: () => Promise<void>;
  const realFetch = globalThis.fetch;
  const savedEnv = { key: process.env.RESEND_API_KEY, secret: process.env.KARAOKE_SYNC_SECRET };
  let savedNotify: unknown = undefined;
  let userA = 0;
  let userB = 0;

  // ------------------------------------------------ Sahte Resend
  const sentMails: { from: string; to: string[]; subject: string; html: string; idem: string | null }[] = [];
  let mode: "ok" | "reject" | "down" = "ok";
  async function fakeResend(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.resend.com/")) throw new Error(`Beklenmeyen istek: ${url}`);
    if (mode === "down") throw new Error("bağlantı yok");
    if (mode === "reject") return new Response(JSON.stringify({ message: "Invalid `to` field." }), { status: 422 });
    const body = JSON.parse(String(init?.body)) as { from: string; to: string[]; subject: string; html: string };
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sentMails.push({ ...body, idem: headers["Idempotency-Key"] ?? null });
    return new Response(JSON.stringify({ id: `mail-${sentMails.length}` }), { status: 200 });
  }
  const mine = () => sentMails.filter((m) => m.to.some((t) => t.startsWith(PREFIX)));

  /** Sitenin elle rezervasyonunun paneldeki kopyası */
  async function addSession(n: number | string, startMs: number, o: Partial<typeof s.karaokeSessions.$inferInsert> = {}) {
    const date = new Date(startMs + 3 * H).toISOString().slice(0, 10);
    const [row] = await db
      .insert(s.karaokeSessions)
      .values({
        externalId: `${PREFIX}${n}`,
        source: "site",
        date,
        startsAt: new Date(startMs),
        endsAt: new Date(startMs + 2 * H),
        guests: 6,
        customerName: "Ayşe",
        status: "confirmed",
        paymentStatus: "none",
        channel: "desk",
        bookedAt: new Date(),
        ...o,
      })
      .returning();
    return row;
  }
  const reminderRow = async (n: number | string) => (await db.select().from(s.karaokeReminders).where(eq(s.karaokeReminders.externalId, `${PREFIX}${n}`)))[0];
  const soon = () => Date.now() + 20_000;

  async function wipe() {
    await db.delete(s.karaokeReminders).where(like(s.karaokeReminders.externalId, `${PREFIX}%`));
    await db.delete(s.karaokeSessions).where(like(s.karaokeSessions.externalId, `${PREFIX}%`));
    await db.delete(s.shifts).where(like(s.shifts.date, "2031-03-%"));
    await db.delete(s.notificationLog).where(or(like(s.notificationLog.key, `karaoke-hatirlatma:${PREFIX}%`), like(s.notificationLog.key, "karaoke-personel-sabah:2031-03-%"), like(s.notificationLog.key, "karaoke-personel-3saat:%:2031-03-%")));
  }

  before(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.AUTH_SECRET ||= "hatirlatma-testi-icin-yer-tutucu-anahtar-0123456789";
    process.env.RESEND_API_KEY = "re_test_gercek_degil";
    // Site bağlantısı yok: hatırlatma öncesi tazeleme siteye gitmez
    delete process.env.KARAOKE_SYNC_SECRET;
    globalThis.fetch = fakeResend as typeof fetch;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const p = require.resolve("server-only");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL_!, 4);
    closeDb = () => dbModule.getDb().$client.end();
    reminders = await import("../src/server/karaoke/reminders");
    staffMail = await import("../src/server/karaoke/staff-mail");
    board = await import("../src/server/karaoke/board");
    const [notify] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, NOTIFY_KEY));
    savedNotify = notify?.value;
    await db.delete(s.integrationState).where(eq(s.integrationState.key, NOTIFY_KEY));
    await db.delete(s.users).where(like(s.users.email, `${PREFIX}%`));
    const users = await db
      .insert(s.users)
      .values([
        { email: `${PREFIX}a@test.local`, name: "Test A", passwordHash: "x", role: "staff", branchId: "tuzla" },
        { email: `${PREFIX}b@test.local`, name: "Test B", passwordHash: "x", role: "staff", branchId: null },
      ])
      .returning({ id: s.users.id });
    [userA, userB] = users.map((u) => u.id);
  });

  beforeEach(async () => {
    await wipe();
    sentMails.length = 0;
    mode = "ok";
  });

  after(async () => {
    globalThis.fetch = realFetch;
    process.env.RESEND_API_KEY = savedEnv.key;
    if (savedEnv.secret !== undefined) process.env.KARAOKE_SYNC_SECRET = savedEnv.secret;
    if (!db) return;
    await wipe();
    await db.delete(s.users).where(inArray(s.users.id, [userA, userB]));
    await db.delete(s.integrationState).where(eq(s.integrationState.key, NOTIFY_KEY));
    if (savedNotify !== undefined) await db.insert(s.integrationState).values({ key: NOTIFY_KEY, value: savedNotify });
    await db.$client.end();
    await closeDb();
  });

  // ------------------------------------------------ Misafir

  test("adres şifreli durur; zamanı gelmeden gitmez; gelince bir kez gider, adres silinir, günlükte adres yok", async () => {
    const start = Date.now() + 30 * H;
    const k = await addSession(1, start);
    await reminders.scheduleKaraokeReminder({ externalId: k.externalId!, email: GUEST, createdBy: "Test" });
    const stored = await reminderRow(1);
    assert.equal(stored.status, "pending");
    assert.ok(stored.emailSealed && !stored.emailSealed.includes("test.local"), "adres açık yazılmış");
    // Ekrana yalnız durum ve gönderileceği an gider
    const listed = (await board.loadSessions(new Date(start - H), new Date(start + H), { admin: false })).find((x) => x.externalId === k.externalId);
    assert.deepEqual(listed?.reminder, { state: "pending", at: new Date(start - 24 * H).toISOString() });
    assert.doesNotMatch(JSON.stringify(listed), /test\.local/);

    // 30 saat var: bekler
    assert.deepEqual(await reminders.runGuestReminders(new Date(), soon()), { sent: 0, failed: 0, dropped: 0 });
    assert.equal(mine().length, 0);

    // 23 saat kaldı (zamanı bir saat önce geldi): gider
    const due = new Date(start - 23 * H);
    assert.deepEqual(await reminders.runGuestReminders(due, soon()), { sent: 1, failed: 0, dropped: 0 });
    const [mail] = mine();
    assert.deepEqual(mail.to, [GUEST]);
    assert.match(mail.from, /^L'Affogato </);
    assert.match(mail.subject, /^(Yarın|Bugün) karaoke: \d\d:\d\d–\d\d:\d\d · L'Affogato$/);
    assert.match(mail.html, /görüşüyoruz, Ayşe!/);
    assert.match(mail.idem ?? "", /^karaoke-hatirlatma-[0-9a-f]{64}$/);
    const done = await reminderRow(1);
    assert.equal(done.status, "sent");
    assert.equal(done.emailSealed, null);
    assert.ok(done.doneAt, "gönderim anı yazılmamış");
    const [log] = await db.select().from(s.notificationLog).where(eq(s.notificationLog.key, reminderLogKey(k.externalId!)));
    assert.equal(log.recipients, REMINDER_LOG_RECIPIENT);
    assert.equal(log.ok, true);
    assert.doesNotMatch(JSON.stringify(log), /test\.local/);
    // Rozet "gönderildi"
    const after1 = (await board.loadSessions(new Date(start - H), new Date(start + H), { admin: false })).find((x) => x.externalId === k.externalId);
    assert.equal(after1?.reminder?.state, "sent");

    // İkinci çalışma ikinci e-posta göndermez
    assert.deepEqual(await reminders.runGuestReminders(due, soon()), { sent: 0, failed: 0, dropped: 0 });
    assert.equal(mine().length, 1);
  });

  test("iptal edilen ve zamanında gönderilemeyen rezervasyona gitmez; adres silinir. Kaldırılanın satırı hemen silinir", async () => {
    const start = Date.now() + 23 * H;
    const cancelled = await addSession(2, start, { status: "cancelled" });
    const late = await addSession(3, Date.now() + H);
    const removed = await addSession(4, start + 4 * H);
    for (const k of [cancelled, late, removed]) await reminders.scheduleKaraokeReminder({ externalId: k.externalId!, email: GUEST, createdBy: "Test" });
    await reminders.cancelKaraokeReminder(removed.externalId!);
    assert.equal(await reminderRow(4), undefined);

    const run = await reminders.runGuestReminders(new Date(), soon());
    assert.deepEqual(run, { sent: 0, failed: 0, dropped: 2 });
    assert.equal(mine().length, 0);
    const a = await reminderRow(2);
    assert.deepEqual([a.status, a.detail, a.emailSealed], ["skipped", REMINDER_SKIP.cancelled, null]);
    const b = await reminderRow(3);
    assert.deepEqual([b.status, b.detail, b.emailSealed], ["skipped", REMINDER_SKIP.late, null]);
    // İptal edilen rezervasyonda rozet yok
    const listed = (await board.loadSessions(new Date(start - H), new Date(start + H), { admin: false })).find((x) => x.externalId === cancelled.externalId);
    assert.equal(listed?.reminder, null);
  });

  test("Resend reddederse yeniden denenir; yanıt gelmezse sahiplenme durur (hemen ikinci ileti çıkmaz)", async () => {
    const start = Date.now() + 23 * H;
    const k = await addSession(5, start);
    await reminders.scheduleKaraokeReminder({ externalId: k.externalId!, email: GUEST, createdBy: "Test" });

    // Kesin ret: satır bekler, sahiplenme bırakılır
    mode = "reject";
    assert.deepEqual(await reminders.runGuestReminders(new Date(), soon()), { sent: 0, failed: 1, dropped: 0 });
    let row = await reminderRow(5);
    assert.deepEqual([row.status, row.attempts, row.claimedAt], ["pending", 1, null]);
    assert.ok(row.emailSealed, "adres erken silinmiş");

    // Yanıt gelmedi (gitmiş olabilir): sahiplenme durur, hemen sonraki çalışma dokunmaz
    mode = "down";
    assert.equal((await reminders.runGuestReminders(new Date(), Date.now() + 8_000)).failed, 1);
    row = await reminderRow(5);
    assert.equal(row.status, "pending");
    assert.ok(row.claimedAt, "belirsiz gönderimde sahiplenme bırakılmış");
    mode = "ok";
    assert.deepEqual(await reminders.runGuestReminders(new Date(), soon()), { sent: 0, failed: 0, dropped: 0 });
    assert.equal(mine().length, 0);

    // Sahiplenme bayatlayınca (10 dk) aynı anahtarla yeniden gider
    await db.update(s.karaokeReminders).set({ claimedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(s.karaokeReminders.externalId, k.externalId!));
    assert.deepEqual(await reminders.runGuestReminders(new Date(), soon()), { sent: 1, failed: 0, dropped: 0 });
    assert.equal(mine().length, 1);
    assert.equal((await reminderRow(5)).status, "sent");
  });

  test("sitenin yanıtı kimliksizse: aynı saatlerdeki, az önce yazılmış elle rezervasyon bulunur", async () => {
    const start = Math.ceil((Date.now() + 40 * H) / H) * H;
    const k = await addSession(6, start);
    assert.equal(await reminders.findDeskExternalId(new Date(start), new Date(start + 2 * H), Date.now() - 60_000), k.externalId);
    // Eskiden yazılmış satır (başkasının rezervasyonu), başka saat, kaldırılmış satır: bulunmaz
    assert.equal(await reminders.findDeskExternalId(new Date(start), new Date(start + 2 * H), Date.now() + 60_000), null);
    assert.equal(await reminders.findDeskExternalId(new Date(start), new Date(start + 3 * H), Date.now() - 60_000), null);
    await db.update(s.karaokeSessions).set({ status: "cancelled" }).where(eq(s.karaokeSessions.id, k.id));
    assert.equal(await reminders.findDeskExternalId(new Date(start), new Date(start + 2 * H), Date.now() - 60_000), null);
  });

  // ------------------------------------------------ Personel

  test("personel: sabah listesi vardiyadakilere bir kez; 3 saat kala ayrıca; plan yoksa şubenin personeline", async () => {
    const day = "2031-03-10";
    await addSession("p1", tr(day, 14), { customerName: "Ayşe" });
    await addSession("p2", tr(day, 20), { paymentStatus: "paid", channel: "web", customerName: "Deniz" });
    await db.insert(s.shifts).values({ branchId: "tuzla", date: day, personRef: `u:${userA}`, userId: userA, personName: "Test A", kind: "work", startMin: 600, endMin: 1080 });

    // 07:30: sabah penceresi kapalı, 3 saat kala penceresi boş
    assert.deepEqual((await staffMail.runStaffKaraokeMails(new Date(tr(day, 7, 30)), soon())).mails, []);
    // 09:00: sabah listesi yalnız vardiyadaki A'ya
    const morning = await staffMail.runStaffKaraokeMails(new Date(tr(day, 9)), soon());
    assert.deepEqual(morning.mails, [staffMorningKey(day)]);
    assert.deepEqual(mine().map((m) => m.to[0]), [`${PREFIX}a@test.local`]);
    assert.equal(mine()[0].subject, "Bugün 2 karaoke rezervasyonu · 1 rezervasyonda ÖDEME ALINACAK");
    assert.match(mine()[0].html, /ÖDEME ALINACAK: 1 rezervasyon/);
    assert.match(mine()[0].from, /Panel|bildirim/);
    const [log] = await db.select().from(s.notificationLog).where(eq(s.notificationLog.key, staffMorningKey(day)));
    assert.match(log.recipients ?? "", new RegExp(`${PREFIX}a@test\\.local`));
    // Aynı sabah ikinci çalışma: yeniden gitmez
    assert.deepEqual((await staffMail.runStaffKaraokeMails(new Date(tr(day, 9, 10)), soon())).mails, []);
    assert.equal(mine().length, 1);

    // 11:30: 14:00'e 2,5 saat kaldı → "3 saat kala" (ödeme alınacak)
    const soonRun = await staffMail.runStaffKaraokeMails(new Date(tr(day, 11, 30)), soon());
    assert.equal(soonRun.mails.length, 1);
    assert.equal(mine().length, 2);
    assert.equal(mine()[1].subject, "Karaoke 14:00 (2 saat 30 dk sonra) · ÖDEME ALINACAK");
    assert.match(mine()[1].html, />ÖDEME ALINMADI</);

    // Plan silindi: 17:30'da 20:00'nin e-postası şubenin bütün personeline (A: Tuzla, B: şubesi boş)
    await db.delete(s.shifts).where(eq(s.shifts.date, day));
    await staffMail.runStaffKaraokeMails(new Date(tr(day, 17, 30)), soon());
    const last = mine().slice(2);
    assert.deepEqual(last.map((m) => m.to[0]).sort(), [`${PREFIX}a@test.local`, `${PREFIX}b@test.local`]);
    assert.ok(last.every((m) => m.subject === "Karaoke 20:00 (2 saat 30 dk sonra) · ödendi"));
    // Her kişiye ayrı ileti, ayrı anahtar (adresler birbirine görünmez)
    assert.equal(new Set(last.map((m) => m.idem)).size, 2);
  });

  test("personel: sabah listesinde bildirilen rezervasyonun '3 saat kala'sı aynı anda ayrıca gitmez; e-posta kapalıysa hiç", async () => {
    const day = "2031-03-11";
    await addSession("p3", tr(day, 10));
    // E-posta hatırlatmaları kapalı: hiçbir şey gitmez, hiçbir şey sahiplenilmez
    await db.insert(s.integrationState).values({ key: NOTIFY_KEY, value: { emailEnabled: false } });
    const off = await staffMail.runStaffKaraokeMails(new Date(tr(day, 8, 30)), soon());
    assert.equal(off.skipped, "e-posta hatırlatmaları kapalı");
    assert.equal(mine().length, 0);
    await db.delete(s.integrationState).where(eq(s.integrationState.key, NOTIFY_KEY));

    // 08:30: 10:00 hem sabah listesinde hem 3 saat penceresinde → kişi başına tek e-posta (sabah listesi)
    const run = await staffMail.runStaffKaraokeMails(new Date(tr(day, 8, 30)), soon());
    assert.deepEqual(run.mails, [staffMorningKey(day)]);
    assert.ok(mine().length >= 2 && mine().every((m) => m.subject === "Bugün karaoke: 10:00–12:00 · ÖDEME ALINACAK"));
    const count = mine().length;
    // 08:40: "3 saat kala" anahtarı sabah e-postasıyla kapandı
    assert.deepEqual((await staffMail.runStaffKaraokeMails(new Date(tr(day, 8, 40)), soon())).mails, []);
    assert.equal(mine().length, count);
  });
});
