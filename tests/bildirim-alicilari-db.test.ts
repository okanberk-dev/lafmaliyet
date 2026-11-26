// Bildirim alıcıları ve personele sabit hata metni, gerçek Postgres'te (denetim B19: E-52, E-53, E-64;
// docs/BILDIRIMLER.md › Alıcılar ve hesaplar). Kendi geçici veritabanını açar (migration'larla), sonunda siler; Resend'e
// gidilmez (sahte fetch gövdeyi kaydeder), oturum taklit edilir (src/server/auth/dal).
//
// - Hesaplar: personel ve pasif hesabın adresi düşer, hesabı olmayan adres kalır (büyük-küçük harf fark etmez).
// - Kasa e-postası: kayıttan sonra personele indirilen adres düşer, ötekilere gider; hepsi düşerse "gitmedi" (yönetici
//   nedenini görür, personel sabit metni); Resend kurulmamışken personelin kasa formu anahtar adını görmez.
// - Sabah e-postası, denemesi: aynı süzgeç; hepsi düşerse "norecipient"; işlem geçmişi atlananları sayar.
// - Kaydederken: kasa alıcısı ve bildirim adresi personel ya da pasif hesabın olamaz; duraklatılan adres de açılmaz.
// - Hesabım: personel giriş e-postasını bir listedeki adrese çeviremez; kendi adresi listedeyken hiç değiştiremez (eski
//   adres hesapsız kalıp yeniden e-posta alırdı); yönetici çevirebilir.
// - Kullanıcılar: personel ya da pasif hesabın eski adresi listede kalırsa (yeni adres, silme) uyarı.
// - Kullanıcılar: personele indirilen ya da pasif yapılan hesabın adresi listedeyse uyarı; zil satırı.
//
// BILDIRIM_TEST_DATABASE_URL (yoksa LAFPOS_TEST_DATABASE_URL) verilmezse atlanır: bir Postgres sunucusu (geçici
// veritabanı onun üstünde açılır).
// Çalıştırma: BILDIRIM_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/bildirim-alicilari-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type { CashReportFields } from "../src/lib/cash-report";
import { PROFILE_LIST_REFUSAL, PROFILE_OWN_LIST_REFUSAL } from "../src/lib/notify-recipients";
import { STAFF_EMAIL_ERROR } from "../src/lib/staff-errors";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.BILDIRIM_TEST_DATABASE_URL ?? process.env.LAFPOS_TEST_DATABASE_URL;
const DB_NAME = `laffogato_bildirim_${process.pid}`;
const PASSWORD = "Bildirim-Deneme-2026";

type Who = { id: number; name: string; email: string; role: "admin" | "staff" };

describe("Bildirim alıcıları ve hesaplar: veritabanında", { skip: !SERVER_URL && "BILDIRIM_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  let recipients: typeof import("../src/server/notify/recipients");
  let store: typeof import("../src/server/cash/report-store");
  let email: typeof import("../src/server/cash/report-email");
  let reports: typeof import("../src/server/data/cash-reports");
  let digest: typeof import("../src/server/notify/digest");
  let cashActions: typeof import("../src/server/actions/cash-report");
  let reminderActions: typeof import("../src/server/actions/reminders");
  let settingsActions: typeof import("../src/server/actions/settings");
  let authActions: typeof import("../src/server/actions/auth");
  let bell: typeof import("../src/server/actions/notifications");
  const realFetch = globalThis.fetch;
  /** Resend'e giden iletilerin alıcıları */
  const sent: { to: string[]; subject: string }[] = [];
  const users: Record<"ali" | "veli" | "eski" | "ayse" | "mehmet", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin" },
    veli: { id: 0, name: "Veli", email: "veli@laffogato.net", role: "admin" },
    eski: { id: 0, name: "Eski Yönetici", email: "eski@laffogato.net", role: "admin" },
    ayse: { id: 0, name: "Ayşe", email: "ayse@laffogato.net", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", email: "mehmet@laffogato.net", role: "staff" },
  };
  const ACCOUNTANT = "muhasebe@ornek.com";
  /** Oturumdaki kullanıcı (src/server/auth/dal taklidi) */
  let me: Who = users.ali;

  const fields = (date: string): CashReportFields & { discounts: number | null } => ({
    date,
    zNo: null,
    receipts: null,
    zTotal: 10_000,
    cash: 3_000,
    card: 7_000,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 500,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 3_500,
    handedOver: 2_400,
    bankPos: null,
    offRevenue: null,
    note: "deneme",
    discounts: null,
  });
  const setCash = (list: string[], emailEnabled = true) => reports.saveCashSettings({ recipients: list, emailEnabled, whatsapp: null });
  const addRow = async (address: string, active = true) => (await db.insert(s.notificationRecipients).values({ email: address, active }).returning({ id: s.notificationRecipients.id }))[0].id;
  /** Düzenleme penceresinin açıldığı andaki hâl (saveUser bununla bu arada değişmiş kaydı reddeder) */
  const seen = async (id: number) =>
    (await db.select({ name: s.users.name, email: s.users.email, role: s.users.role, active: s.users.active, branchId: s.users.branchId }).from(s.users).where(eq(s.users.id, id)))[0];

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "bildirim-alicilari-testi-icin-en-az-otuz-iki-karakter" });
    // Site bağlantısı yok (kasa e-postasının online satırı sorulmaz); Resend her testte ayrıca kurulur
    delete process.env.KARAOKE_SYNC_SECRET;
    delete process.env.RESEND_API_KEY;
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
      startSession: async () => {},
      endSession: async () => {},
      rememberDevice: async () => "cihaz",
      readDevice: async () => null,
      startPending: async () => {},
      clearPending: async () => {},
      readPending: async () => undefined,
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const { hashPassword } = await import("../src/server/auth/password");
    const hash = await hashPassword(PASSWORD);
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const u = users[k];
      const [row] = await db.insert(s.users).values({ email: u.email, name: u.name, passwordHash: hash, role: u.role, active: k !== "eski" }).returning({ id: s.users.id });
      u.id = row.id;
    }
    recipients = await import("../src/server/notify/recipients");
    store = await import("../src/server/cash/report-store");
    email = await import("../src/server/cash/report-email");
    reports = await import("../src/server/data/cash-reports");
    digest = await import("../src/server/notify/digest");
    cashActions = await import("../src/server/actions/cash-report");
    reminderActions = await import("../src/server/actions/reminders");
    settingsActions = await import("../src/server/actions/settings");
    authActions = await import("../src/server/actions/auth");
    bell = await import("../src/server/actions/notifications");
    // Resend: alıcılar kaydedilir, ağa çıkılmaz; başka her istek düşer (sabah e-postasının ek kutuları beklemesin)
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("https://api.resend.com/")) throw new TypeError("testte ağ yok");
      const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string };
      sent.push({ to: body.to, subject: body.subject });
      return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE notification_recipients, notification_log, cash_reports, reminders, activity_log, integration_state, branch_settings RESTART IDENTITY CASCADE`);
    await db.update(s.users).set({ role: "admin", active: true }).where(inArray(s.users.id, [users.ali.id, users.veli.id]));
    await db.update(s.users).set({ role: "admin", active: false }).where(eq(s.users.id, users.eski.id));
    await db.update(s.users).set({ role: "staff", active: true }).where(inArray(s.users.id, [users.ayse.id, users.mehmet.id]));
    for (const u of Object.values(users)) await db.update(s.users).set({ email: u.email, name: u.name }).where(eq(s.users.id, u.id));
    process.env.RESEND_API_KEY = "re_test_bildirim";
    sent.length = 0;
    me = users.ali;
  });

  test("hesaplar: personel ve pasif hesabın adresi düşer, hesabı olmayan ve etkin yöneticinin adresi kalır", async () => {
    const list = [ACCOUNTANT, "AYSE@laffogato.net", users.ali.email, users.eski.email];
    const blocked = await recipients.blockedAccounts(db, list);
    assert.deepEqual(Object.fromEntries(blocked), { "ayse@laffogato.net": "staff", "eski@laffogato.net": "inactive" });
    assert.deepEqual(await recipients.sendableRecipients(db, list), {
      to: [ACCOUNTANT, users.ali.email],
      dropped: [
        { email: "AYSE@laffogato.net", reason: "staff" },
        { email: users.eski.email, reason: "inactive" },
      ],
    });
    assert.deepEqual(await store.cashEmailRecipients(db, list), [ACCOUNTANT, users.ali.email]);
    // Hangi listede: kasa alıcıları (kapalıyken de) ve bildirim adresleri (duraklatılmış da)
    await setCash([ACCOUNTANT], false);
    await addRow("Sahip@Gmail.com", false);
    assert.deepEqual(await recipients.listsWithEmail("muhasebe@ornek.com"), ["cash"]);
    assert.deepEqual(await recipients.listsWithEmail("sahip@gmail.com"), ["digest"]);
    assert.deepEqual(await recipients.listsWithEmail("yok@ornek.com"), []);
    // Zil ve ayar: yalnız gönderimde gerçekten düşenler (kapalı kasa e-postası ve duraklatılan adres sayılmaz)
    await setCash([users.ayse.email], false);
    await addRow(users.mehmet.email, false);
    assert.deepEqual(await recipients.blockedRecipientsNow(), { cash: [], digest: [] });
    await setCash([users.ayse.email, ACCOUNTANT], true);
    await addRow(users.eski.email, true);
    assert.deepEqual(await recipients.blockedRecipientsNow(), { cash: [{ email: users.ayse.email, reason: "staff" }], digest: [{ email: users.eski.email, reason: "inactive" }] });
  });

  test("kasa e-postası: sonradan personele indirilen adres düşer; hepsi düşerse gitmedi, nedeni yalnız yöneticiye", async () => {
    const date = "2031-03-10";
    const saved = await store.saveCashReport(db, users.ali, { ...fields(date), countedBy: null, revision: 0, photos: [] }, new Date(`${date}T22:00:00+03:00`));
    assert.equal(saved.kind, "saved");
    const id = saved.kind === "saved" ? saved.row.id : 0;
    // Ayar Veli yöneticiyken kaydedildi; sonra Veli personele indirildi
    await setCash([users.veli.email, ACCOUNTANT, users.ali.email]);
    await db.update(s.users).set({ role: "staff" }).where(eq(s.users.id, users.veli.id));
    const out = await email.emailReport(id, { site: Promise.resolve(null) });
    assert.deepEqual(out, { status: "sent", error: null, to: 2 });
    assert.deepEqual(sent.map((m) => m.to), [[ACCOUNTANT, users.ali.email]]);
    const [log] = await db.select().from(s.notificationLog).where(eq(s.notificationLog.key, `cash:${date}:r1`));
    assert.equal(log.recipients, `${ACCOUNTANT}, ${users.ali.email}`);

    // Hepsi personel ya da pasif: e-posta gitmez, durum "gitmedi" (kapalı değil); yönetici nedenini, personel sabit metni görür
    sent.length = 0;
    await setCash([users.veli.email, users.eski.email]);
    const none = await email.emailReport(id, { site: Promise.resolve(null), idempotencyKey: "ikinci" });
    assert.equal(none.status, "failed");
    // Formdaki satır "E-posta gitmedi: " ile başlar (emailFailedLine): metin onu yinelemez, iç içe parantez yok
    assert.equal(none.error, "Alıcıların hepsi personel, müdür ya da pasif hesaba ait: veli@laffogato.net (personel hesabı), eski@laffogato.net (pasif hesap). Kasa › Rapor alıcıları'na yöneticinin ya da muhasebecinin adresini yazın.");
    assert.equal(sent.length, 0);
    assert.equal((await reports.getCashReport(date, "admin"))?.emailError, none.error);
    assert.equal((await reports.getCashReport(date, "staff"))?.emailError, STAFF_EMAIL_ERROR);
    assert.equal((await reports.cashReportsBetween(date, date))[0].emailError, STAFF_EMAIL_ERROR, "personelin son 7 günü de");
    // E-posta kapalı: "kapalı" kalır
    await setCash([users.veli.email], false);
    assert.equal((await email.emailReport(id, { site: Promise.resolve(null), idempotencyKey: "ucuncu" })).status, "off");
  });

  test("Resend kurulmamışken personelin kasa raporu: e-posta sonucu ve kayıtlı satır anahtar adını taşımaz; yönetici görür", async () => {
    delete process.env.RESEND_API_KEY;
    await setCash([ACCOUNTANT]);
    me = users.ayse;
    const { businessDate } = await import("../src/lib/cash-report");
    const day = businessDate();
    // Tuzla'da kör sayım (Dalga 2; docs/KASA-RAPORU.md › Kör sayım): personel önce sayımı kilitler; teslimin Kime'si zorunlu
    const lock = await cashActions.lockCashCount({ date: day, amount: fields(day).countedCash });
    assert.ok(lock.ok, lock.ok ? "" : lock.error);
    const res = await cashActions.submitCashReport({ ...fields(day), countedBy: null, revision: 0, photos: [], handedTo: { kind: "banka" } });
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.ok(!res.data.needsApproval);
    if (res.data.needsApproval) return;
    assert.deepEqual(res.data.email, { status: "failed", error: STAFF_EMAIL_ERROR, to: 0 });
    assert.doesNotMatch(JSON.stringify(res.data), /RESEND_API_KEY|Resend/);
    // Yeniden dene: personele yine sabit metin
    const again = await cashActions.resendCashReportEmail(res.data.id);
    assert.ok(again.ok);
    assert.equal(again.ok && again.data.error, STAFF_EMAIL_ERROR);
    assert.equal((await reports.getCashReport(day, "staff"))?.emailError, STAFF_EMAIL_ERROR);
    // Yönetici: ayrıntı (anahtar adı) ekranında
    me = users.ali;
    const adminAgain = await cashActions.resendCashReportEmail(res.data.id);
    assert.ok(adminAgain.ok);
    assert.match(adminAgain.ok ? (adminAgain.data.error ?? "") : "", /RESEND_API_KEY/);
    assert.match((await reports.getCashReport(day, "admin"))?.emailError ?? "", /RESEND_API_KEY/);
  });

  test("kasa alıcıları kaydedilirken personel ve pasif hesabın adresi reddedilir; deneme e-postası düşenleri söyler", async () => {
    const save = (list: string) => cashActions.updateCashSettings({ recipients: list, emailEnabled: true, whatsapp: "" });
    const staff = await save(`${ACCOUNTANT}\nAYSE@laffogato.net`);
    assert.deepEqual(staff, { ok: false, error: "ayse@laffogato.net bir personel hesabının adresi; kasa e-postasında karaoke ön ödemesi var. Yöneticinin ya da muhasebecinin adresini girin." });
    const inactive = await save(users.eski.email);
    assert.equal(inactive.ok, false);
    assert.match(inactive.ok ? "" : inactive.error, /^eski@laffogato\.net pasif bir hesabın adresi; pasif hesaba e-posta gitmez\./);
    assert.deepEqual(await reports.loadCashSettings("tuzla").then((c) => c.recipients), [], "hiçbiri yazılmadı");
    const ok = await save(`${ACCOUNTANT}\n${users.ali.email}`);
    assert.ok(ok.ok, ok.ok ? "" : ok.error);
    // Sonradan Ali pasif: deneme e-postası yalnız muhasebeciye, düşen söylenir
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, users.ali.id));
    const t = await cashActions.sendCashTestEmail();
    assert.deepEqual(t, { ok: true, data: { to: 1, skipped: "ali@laffogato.net (pasif hesap)" } });
    assert.deepEqual(sent.map((m) => m.to), [[ACCOUNTANT]]);
    await setCash([users.ali.email]);
    const all = await cashActions.sendCashTestEmail();
    assert.equal(all.ok, false);
    assert.equal(all.ok ? "" : all.error, "Alıcıların hepsi personel, müdür ya da pasif hesaba ait: ali@laffogato.net (pasif hesap). Yöneticinin ya da muhasebecinin adresini girin.");
  });

  test("bildirim adresi: personel ve pasif hesabın adresi eklenmez, duraklatılmışsa açılmaz; hesabı olmayan eklenir", async () => {
    const staff = await reminderActions.addRecipient("Ayse@Laffogato.net", null);
    assert.deepEqual(staff, { ok: false, error: "ayse@laffogato.net bir personel hesabının adresi; sabah e-postasında ödemeler, fatura tutarları ve maliyet rakamları var. Yöneticinin ya da muhasebecinin adresini girin." });
    const inactive = await reminderActions.addRecipient(users.eski.email, "Eski");
    assert.equal(inactive.ok, false);
    assert.equal((await reminderActions.addRecipient(ACCOUNTANT, "Muhasebe")).ok, true);
    assert.equal((await reminderActions.addRecipient(users.veli.email, "Veli")).ok, true);
    assert.deepEqual((await db.select({ email: s.notificationRecipients.email }).from(s.notificationRecipients)).map((r) => r.email).sort(), [users.veli.email, ACCOUNTANT].sort());
    // Veli'nin adresi duraklatıldı, Veli personele indirildi: yeniden açılamaz; kapatmak her zaman olur
    const [veli] = await db.select().from(s.notificationRecipients).where(eq(s.notificationRecipients.email, users.veli.email));
    assert.equal((await reminderActions.setRecipientActive(veli.id, false)).ok, true);
    await db.update(s.users).set({ role: "staff" }).where(eq(s.users.id, users.veli.id));
    const reopen = await reminderActions.setRecipientActive(veli.id, true);
    assert.equal(reopen.ok, false);
    assert.match(reopen.ok ? "" : reopen.error, /^veli@laffogato\.net bir personel hesabının adresi;/);
    assert.equal((await db.select().from(s.notificationRecipients).where(eq(s.notificationRecipients.id, veli.id)))[0].active, false);
  });

  test("sabah e-postası ve denemesi: personel ve pasif hesabın adresi düşer; hepsi düşerse norecipient; işlem geçmişi atlananı sayar", async () => {
    const { todayTR } = await import("../src/lib/reminders");
    await db.insert(s.reminders).values({ title: "Kira", kind: "kira", amount: 1000, dueDate: todayTR(), anchorDate: todayTR(), repeat: "none", remindDaysBefore: 0 });
    // Hepsi düşen: gönderilecek hatırlatma var ama adres yok (Ayşe personel, Eski pasif; duraklatılan sayılmaz)
    await addRow(users.ayse.email);
    await addRow(users.eski.email);
    await addRow(ACCOUNTANT, false);
    const none = await digest.runReminderDigest("manual");
    assert.equal(none.status, "skipped");
    assert.equal(none.status === "skipped" && none.off, "norecipient");
    assert.equal(none.status === "skipped" && none.reason, "Etkin bildirim adreslerinin hepsi personel, müdür ya da pasif hesaba ait: ayse@laffogato.net (personel hesabı), eski@laffogato.net (pasif hesap).");
    // Günlük işler ve sistem uyarısı "adres yok" demez, adresleri söyler
    const { digestStep } = await import("../src/lib/job-health");
    assert.deepEqual(digestStep(none), {
      code: "norecipient",
      error: "gönderilecek bir şey vardı ama etkin bildirim adreslerinin hepsi personel, müdür ya da pasif hesaba ait: ayse@laffogato.net (personel hesabı), eski@laffogato.net (pasif hesap)",
    });
    assert.equal(sent.length, 0);
    const test = await digest.sendTestEmail();
    assert.equal(test.ok, false);
    // Muhasebeci ve Ali eklenir: sıra eklenme sırası, Ayşe ve Eski düşer
    await db.update(s.notificationRecipients).set({ active: true }).where(eq(s.notificationRecipients.email, ACCOUNTANT));
    await addRow(users.ali.email);
    const ok = await digest.sendTestEmail();
    assert.deepEqual(ok, { ok: true, recipients: 2, skipped: "ayse@laffogato.net (personel hesabı), eski@laffogato.net (pasif hesap)" });
    const done = await digest.runReminderDigest("manual");
    assert.equal(done.status, "sent", JSON.stringify(done));
    assert.equal(done.status === "sent" && done.recipients, 2);
    assert.deepEqual(sent.map((m) => m.to), [
      [ACCOUNTANT, users.ali.email],
      [ACCOUNTANT, users.ali.email],
    ]);
    const [act] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Sabah e-postası"));
    assert.match(act.detail ?? "", / → 2 adres · 2 adres atlandı \(personel ya da pasif hesap\)$/);
    const logs = await db.select({ recipients: s.notificationLog.recipients }).from(s.notificationLog);
    assert.ok(logs.length > 0);
    for (const l of logs) assert.doesNotMatch(l.recipients ?? "", /ayse@|eski@/);
  });

  test("Hesabım: personel giriş e-postasını bir listedeki adrese çeviremez; başka adrese çevirebilir; yönetici çevirebilir", async () => {
    await setCash([ACCOUNTANT], false);
    await addRow("sahip@gmail.com", false);
    me = users.ayse;
    for (const target of ["MUHASEBE@ornek.com", "sahip@gmail.com"]) {
      const r = await authActions.updateProfile({ name: users.ayse.name, email: target, password: PASSWORD });
      assert.deepEqual(r, { ok: false, error: PROFILE_LIST_REFUSAL }, target);
    }
    // Parola yanlışsa liste hiç sorulmaz (önce parola)
    const wrong = await authActions.updateProfile({ name: users.ayse.name, email: ACCOUNTANT, password: "yanlis-parola" });
    assert.equal(wrong.ok, false);
    assert.notEqual(wrong.ok ? "" : wrong.error, PROFILE_LIST_REFUSAL);
    assert.equal((await db.select().from(s.users).where(eq(s.users.id, users.ayse.id)))[0].email, users.ayse.email);
    // Başka bir hesabın adresi: personele aynı metin (adres deneyerek liste öğrenilmez), yöneticiye nedeni
    assert.deepEqual(await authActions.updateProfile({ name: users.ayse.name, email: users.mehmet.email, password: PASSWORD }), { ok: false, error: PROFILE_LIST_REFUSAL });
    // Listede olmayan adres
    assert.equal((await authActions.updateProfile({ name: users.ayse.name, email: "ayse.yeni@laffogato.net", password: PASSWORD })).ok, true);
    // Yönetici kendi adresini listedeki bir adrese çevirebilir (alıcı olmaya devam eder); başka hesabın adresinde nedeni
    me = users.ali;
    assert.deepEqual(await authActions.updateProfile({ name: users.ali.name, email: users.veli.email, password: PASSWORD }), { ok: false, error: "Bu e-posta başka bir kullanıcıda kayıtlı" });
    assert.equal((await authActions.updateProfile({ name: users.ali.name, email: "sahip@gmail.com", password: PASSWORD })).ok, true);
  });

  test("Hesabım: listedeki adresin sahibi personele indirilince giriş e-postasını değiştiremez; eski adres düşmeye devam eder", async () => {
    await setCash([users.veli.email, ACCOUNTANT]);
    await addRow(users.veli.email);
    const demoted = await settingsActions.saveUser({ id: users.veli.id, name: users.veli.name, email: users.veli.email, role: "staff", active: true, seen: await seen(users.veli.id) }, { password: PASSWORD });
    assert.ok(demoted.ok && demoted.data.notice, demoted.ok ? "uyarı yok" : demoted.error);
    me = { ...users.veli, role: "staff" };
    // Liste dışındaki bir adrese de çeviremez: eski adres hesapsız kalır, kasa ve sabah e-postası ona yeniden giderdi
    const r = await authActions.updateProfile({ name: users.veli.name, email: "veli.baska@laffogato.net", password: PASSWORD });
    assert.deepEqual(r, { ok: false, error: PROFILE_OWN_LIST_REFUSAL });
    assert.equal((await db.select().from(s.users).where(eq(s.users.id, users.veli.id)))[0].email, users.veli.email);
    assert.deepEqual(await recipients.sendableRecipients(db, [users.veli.email, ACCOUNTANT]), { to: [ACCOUNTANT], dropped: [{ email: users.veli.email, reason: "staff" }] });
    assert.deepEqual(await recipients.blockedRecipientsNow(), { cash: [{ email: users.veli.email, reason: "staff" }], digest: [{ email: users.veli.email, reason: "staff" }] });
    // Yalnız adını değiştirebilir (e-posta aynı)
    assert.equal((await authActions.updateProfile({ name: "Veli K.", email: users.veli.email, password: PASSWORD })).ok, true);
    // Kasa listesi kapalıyken de: açılınca giderdi
    await setCash([users.veli.email], false);
    await db.delete(s.notificationRecipients);
    assert.deepEqual(await authActions.updateProfile({ name: "Veli K.", email: "veli.baska@laffogato.net", password: PASSWORD }), { ok: false, error: PROFILE_OWN_LIST_REFUSAL });
    // Listeden çıkınca değiştirebilir
    await setCash([ACCOUNTANT]);
    assert.equal((await authActions.updateProfile({ name: "Veli K.", email: "veli.baska@laffogato.net", password: PASSWORD })).ok, true);
  });

  test("Kullanıcılar: personel ya da pasif hesabın eski adresi listede kalırsa (yeni adres, silme) uyarı", async () => {
    await setCash([users.mehmet.email, ACCOUNTANT]);
    await addRow(users.mehmet.email);
    // Yönetici personelin giriş e-postasını değiştirir: eski adres artık hiçbir hesabın değil, e-posta ona gider
    const renamed = await settingsActions.saveUser({ id: users.mehmet.id, name: users.mehmet.name, email: "mehmet.yeni@laffogato.net", role: "staff", active: true, seen: await seen(users.mehmet.id) });
    assert.ok(renamed.ok, renamed.ok ? "" : renamed.error);
    assert.equal(
      renamed.ok && renamed.data.notice,
      "Mehmet hesabının eski adresi mehmet@laffogato.net kasa raporu alıcıları ve sabah e-postasının bildirim adresleri arasında; adres artık hiçbir hesaba ait değil, bu adrese e-posta gider. Gerekmiyorsa listeden kaldırın.",
    );
    assert.deepEqual(await recipients.blockedRecipientsNow(), { cash: [], digest: [] });
    // Etkin yöneticinin adresi değişince uyarı yok (eski adres zaten e-posta alıyordu, alan kişi hâlâ yönetici)
    await setCash([users.veli.email]);
    const admin = await settingsActions.saveUser({ id: users.veli.id, name: users.veli.name, email: "veli.yeni@laffogato.net", role: "admin", active: true, seen: await seen(users.veli.id) }, { password: PASSWORD });
    assert.ok(admin.ok, admin.ok ? "" : admin.error);
    assert.equal(admin.ok && admin.data.notice, null);
    // Yöneticiyi personele indirip adresini aynı anda değiştirmek: eski adres artık kimsenin değil, uyarı
    await setCash(["veli.yeni@laffogato.net"]);
    const both = await settingsActions.saveUser({ id: users.veli.id, name: users.veli.name, email: "veli.ucuncu@laffogato.net", role: "staff", active: true, seen: await seen(users.veli.id) }, { password: PASSWORD });
    assert.match(both.ok ? (both.data.notice ?? "") : "", /^Veli hesabının eski adresi veli\.yeni@laffogato\.net kasa raporu alıcıları arasında;/);
    // Personel hesabı silinir, adresi listede kalır: uyarı
    const created = await settingsActions.createUser({ mode: "password", name: "Geçici", email: "gecici@laffogato.net", role: "staff", active: true, password: "Kasa-Deneme-2026x" });
    assert.ok(created.ok, created.ok ? "" : created.error);
    await addRow("gecici@laffogato.net");
    const gone = await settingsActions.deleteUser(created.ok ? created.data.userId : 0);
    assert.deepEqual(gone, {
      ok: true,
      data: { notice: "Geçici (gecici@laffogato.net) sabah e-postasının bildirim adresleri arasında; hesap silindiği için adres hiçbir hesaba ait değil, bu adrese e-posta gider. Gerekmiyorsa listeden kaldırın." },
    });
    // Listede olmayan hesap: uyarı yok
    const other = await settingsActions.createUser({ mode: "password", name: "Geçici İki", email: "gecici2@laffogato.net", role: "staff", active: true, password: "Kasa-Deneme-2026x" });
    assert.deepEqual(await settingsActions.deleteUser(other.ok ? other.data.userId : 0), { ok: true, data: { notice: null } });
  });

  test("Kullanıcılar: personele indirilen ya da pasif yapılan hesabın adresi listedeyse uyarı; zil satırı", async () => {
    await setCash([users.mehmet.email, ACCOUNTANT]);
    await addRow(users.veli.email);
    // Veli'yi personele indirmek (yönetici değişikliği: parola ister)
    const veli = await settingsActions.saveUser({ id: users.veli.id, name: users.veli.name, email: users.veli.email, role: "staff", active: true, seen: await seen(users.veli.id) }, { password: PASSWORD });
    assert.ok(veli.ok, veli.ok ? "" : veli.error);
    assert.equal(
      veli.ok && veli.data.notice,
      "Veli (veli@laffogato.net) sabah e-postasının bildirim adresleri arasında; personel hesabına bu e-posta gitmez. Gerekmiyorsa listeden kaldırın.",
    );
    // Personel Mehmet pasif (listedeki anahtar): kasa alıcılarında (kayıttan önce personel hesabı açılmış: ayar elle yazıldı)
    const mehmet = await settingsActions.setUserActive(users.mehmet.id, false);
    assert.ok(mehmet.ok);
    assert.match(mehmet.ok ? (mehmet.data.notice ?? "") : "", /^Mehmet \(mehmet@laffogato\.net\) kasa raporu alıcıları arasında; personel hesabına bu e-posta gitmez\./);
    // Listede olmayan hesap: uyarı yok
    const ayse = await settingsActions.saveUser({ id: users.ayse.id, name: users.ayse.name, email: users.ayse.email, role: "staff", active: false, seen: await seen(users.ayse.id) });
    assert.equal(ayse.ok && ayse.data.notice, null);
    // Yeni personel hesabı muhasebecinin adresiyle: uyarı
    const created = await settingsActions.createUser({ mode: "password", name: "Muhasebe", email: ACCOUNTANT, role: "staff", active: true, password: "Kasa-Deneme-2026x" });
    assert.ok(created.ok, created.ok ? "" : created.error);
    assert.match(created.ok ? (created.data.notice ?? "") : "", /^Muhasebe \(muhasebe@ornek\.com\) kasa raporu alıcıları arasında; personel hesabına/);
    await db.delete(s.users).where(eq(s.users.email, ACCOUNTANT));

    // Zil: yöneticiye iki satır (kasa ve sabah e-postası), sistem başlığında; personele yok
    const items = await bell.loadPanelNotifications();
    const rows = items.filter((i) => i.id.startsWith("alici-"));
    assert.deepEqual(
      rows.map((r) => [r.title, r.href, r.group]),
      [
        ["Kasa raporu e-postası bir adrese gitmiyor", "/panel/kasa#rapor-alicilari", "sistem"],
        ["Sabah e-postası bir adrese gitmiyor", "/panel/hatirlaticilar#e-posta-bildirimleri", "sistem"],
      ],
    );
    me = users.ayse;
    await db.update(s.users).set({ active: true }).where(eq(s.users.id, users.ayse.id));
    assert.equal((await bell.loadPanelNotifications()).filter((i) => i.id.startsWith("alici-")).length, 0);
  });
});
