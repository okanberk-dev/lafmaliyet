// Kapalı gün şube şube, gerçek Postgres'te (denetim 13 Kasım 2026, P03 KP-05; docs/SUBE.md › Kapalı gün): Marina'nın
// raporu Tuzla'nın kapalı gün işaretini kaldırmaz; Marina'nın bildirimi Tuzla'nın raporuyla engellenmez ve onay
// bildirimin şubesine yazılır; işletme geneli tek günlük işaret bir şubenin raporuyla yalnız o şube için kalkar (öteki
// şubede şubeli kalır, onaylı bildirimi yeni satıra geçer); yöneticinin eksik rapor zili şube şube susar; Özel günler'de
// silinen şubeli kapalı gün "Geri al"la aynı şubeye döner, ikiz denetimi şube içinde.
//
// SUBE_TEST_DATABASE_URL (yoksa KAPALI_TEST_DATABASE_URL) verilmezse atlanır. Test kendi geçici veritabanını açar,
// migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_TEST_DATABASE_URL=postgres://localhost:5432/postgres npx tsx --test tests/sube-kapali-gun-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate, type CashReportFields } from "../src/lib/cash-report";
import { CLOSED_TEXT, closedEvidenceText, hasPanelEvidence } from "../src/lib/closed-days";
import { addDays } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const SERVER_URL = process.env.SUBE_TEST_DATABASE_URL ?? process.env.KAPALI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_kapali_gun_${process.pid}`;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

describe("Kapalı gün şube şube (KP-05)", { skip: !SERVER_URL && "SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let store: typeof import("../src/server/cash/report-store");
  let closed: typeof import("../src/server/closed-days");
  let reqs: typeof import("../src/server/closed-day-requests");
  let bell: typeof import("../src/server/bell/kasa");
  let special: typeof import("../src/server/actions/special-days");
  let checklists: typeof import("../src/server/data/checklists");
  let panelBell: typeof import("../src/server/actions/notifications");
  type Who = { id: number; name: string; email: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse" | "deniz", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin" },
    ayse: { id: 0, name: "Ayşe", email: "ayse@laffogato.net", role: "staff" },
    deniz: { id: 0, name: "Deniz", email: "deniz@laffogato.net", role: "staff" },
  };
  /** Oturumdaki kullanıcı (src/server/auth/dal taklidi) */
  let me: Who = users.ali;

  const fields = (date: string, branch: "tuzla" | "marina"): CashReportFields & { discounts: number | null } => ({
    date,
    zNo: null,
    receipts: 10,
    zTotal: branch === "tuzla" ? 20_000 : 6_000,
    cash: branch === "tuzla" ? 8_000 : 2_400,
    card: branch === "tuzla" ? 12_000 : 3_600,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: branch === "tuzla" ? 1_000 : 500,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: branch === "tuzla" ? 9_000 : 2_900,
    handedOver: branch === "tuzla" ? 8_000 : 2_400,
    bankPos: null,
    offRevenue: 0,
    note: "deneme",
    discounts: 0,
  });
  /** Şubenin raporu, yöneticinin elinden (seçili şube o şube) */
  async function report(date: string, branch: "tuzla" | "marina", now = tr(`${date}T22:00`)) {
    const out = await withBranchScope(branch, () => store.saveCashReport(db, users.ali, { ...fields(date, branch), countedBy: null, revision: 0, photos: [] }, now));
    assert.equal(out.kind, "saved");
  }
  const marks = async () =>
    (await db.select().from(s.specialDays).where(eq(s.specialDays.kind, "kapali")).orderBy(s.specialDays.id)).map((m) => [m.dateFrom, m.branchId, m.title]);

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sube-kapali-gun-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    delete process.env.KARAOKE_SYNC_SECRET;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum ve sayfa yenileme taklit edilir
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
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
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true })))
      .onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: users[k].email, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
    store = await import("../src/server/cash/report-store");
    closed = await import("../src/server/closed-days");
    reqs = await import("../src/server/closed-day-requests");
    bell = await import("../src/server/bell/kasa");
    special = await import("../src/server/actions/special-days");
    checklists = await import("../src/server/data/checklists");
    panelBell = await import("../src/server/actions/notifications");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    me = users.ali;
    await db.execute(
      sql`TRUNCATE cash_reports, cash_outs, staff_requests, special_days, activity_log, photos, pos_day_reports, checklist_templates, notification_log, karaoke_sessions RESTART IDENTITY CASCADE`,
    );
    await db.delete(s.settings).where(eq(s.settings.key, "lafposGecisGunu"));
    await db.update(s.branches).set({ active: true });
  });

  test("şubenin işareti ve bildirimi: Marina'nın raporu Tuzla'nın işaretini kaldırmaz, Tuzla'nın raporu Marina'nın bildirimini engellemez", async () => {
    const C = "2026-11-03";
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, C, "Tadilat", "tuzla"));
    assert.equal(await closed.isClosedDay(C, db, "tuzla"), true);
    assert.equal(await closed.isClosedDay(C, db, "marina"), false, "Tuzla'nın kapalı günü Marina'nın günü değil");
    await report(C, "marina");
    assert.deepEqual(
      (await marks()).map((m) => m.slice(0, 2)),
      [[C, "tuzla"]],
    );
    assert.equal(await closed.isClosedDay(C, db, "tuzla"), true, "Marina'nın raporu Tuzla'nın işaretini kaldırmadı");
    // Tuzla'nın raporu kendi işaretini kaldırır
    await report(C, "tuzla");
    assert.deepEqual(await marks(), []);

    // Dün Tuzla açıktı (rapor), Marina kapalıydı: Marina'nın personeli bildirir, onay Marina'ya yazılır
    const D = addDays(businessDate(), -1);
    const morning = new Date(Date.parse(`${D}T12:00:00+03:00`) + 86_400_000);
    await report(D, "tuzla");
    const asked = await withBranchScope("marina", () => reqs.proposeClosedDay(db, users.deniz, { date: D, reason: "Su baskını", clientKey: null }, morning));
    assert.equal(asked.row.subject, `gun:${D}:marina`);
    // Aynı gün Tuzla'nın personeli bildiremez: Tuzla'nın raporu var (kanıt)
    await assert.rejects(
      withBranchScope("tuzla", () => reqs.proposeClosedDay(db, users.ayse, { date: D, reason: null, clientKey: null }, morning)),
      (e: unknown) => e instanceof UserError && e.message === CLOSED_TEXT.evidence,
    );
    // Yönetici Tuzla seçiliyken onaylar: işaret bildirimin şubesine (Marina)
    const out = await withBranchScope("tuzla", () => reqs.reviewClosedDayCore(db, users.ali, { id: asked.row.id, seenVersion: asked.row.version, decision: "approve", note: null }, morning));
    assert.equal(out.status, "approved");
    const [row] = await db.select().from(s.specialDays).where(eq(s.specialDays.id, out.specialId!));
    assert.equal(row.branchId, "marina");
    assert.equal(await closed.isClosedDay(D, db, "marina"), true);
    assert.equal(await closed.isClosedDay(D, db, "tuzla"), false);
  });

  test("işletme geneli tek günlük işaret: Marina'nın raporu yalnız Marina için kaldırır; Tuzla kapalı kalır, onaylı bildirimi yeni satıra geçer", async () => {
    const C = "2026-11-08";
    const [mark] = await db
      .insert(s.specialDays)
      .values({ dateFrom: C, dateTo: C, kind: "kapali", title: "Bayram", effect: -1, createdBy: users.ali.id, createdByName: "Ali" })
      .returning();
    const request = async (subject: string, by: Who) =>
      (
        await db
          .insert(s.staffRequests)
          .values({ kind: "kapali-gun", subject, day: C, title: "kapalı", payload: { date: C, reason: null }, status: "approved", resultId: mark.id, requestedBy: by.id, requestedByName: by.name })
          .returning()
      )[0];
    const tuzlaReq = await request(`gun:${C}`, users.ayse);
    const marinaReq = await request(`gun:${C}:marina`, users.deniz);
    await report(C, "marina");
    const rows = await db.select().from(s.specialDays).where(eq(s.specialDays.kind, "kapali"));
    assert.deepEqual(
      rows.map((m) => [m.branchId, m.title, m.createdByName]),
      [["tuzla", "Bayram", "Ali"]],
    );
    assert.equal(await closed.isClosedDay(C, db, "tuzla"), true);
    assert.equal(await closed.isClosedDay(C, db, "marina"), false);
    const byId = Object.fromEntries((await db.select().from(s.staffRequests)).map((r) => [r.id, r]));
    assert.equal(byId[tuzlaReq.id].status, "approved");
    assert.equal(byId[tuzlaReq.id].resultId, rows[0].id, "Tuzla'nın onayı Tuzla'nın satırına geçti");
    assert.equal(byId[marinaReq.id].status, "revoked");
    const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Kapalı gün işareti kaldırıldı (kanıt geldi)"));
    assert.match(log.detail ?? "", /Marina: kasa raporu girildi · Tuzla kapalı kalıyor$/);
    // Tuzla'nın raporu kendi satırını kaldırır
    await report(C, "tuzla");
    assert.equal(await closed.isClosedDay(C, db, "tuzla"), false);
    assert.equal((await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, tuzlaReq.id)))[0].status, "revoked");
    // Tek fiziksel şube açıkken eskisi gibi: işletme geneli satır raporla silinir
    await db.update(s.branches).set({ active: false }).where(eq(s.branches.id, "marina"));
    const D = "2026-11-10";
    await db.insert(s.specialDays).values({ dateFrom: D, dateTo: D, kind: "kapali", title: "Bayram", effect: -1, createdByName: "Ali" });
    await report(D, "tuzla");
    assert.equal(await closed.isClosedDay(D, db), false);
  });

  test("zil: Tuzla dün kapalıyken Marina'nın eksik raporu söylenir", async () => {
    const T = businessDate();
    const Y = addDays(T, -1);
    await report(addDays(Y, -1), "tuzla", new Date());
    await report(addDays(Y, -1), "marina", new Date());
    const missing = async () => (await withBranchScope("hepsi", () => bell.kasaBell(users.ali))).filter((n) => n.id.startsWith("kasa-yok")).map((n) => n.id);
    assert.deepEqual((await missing()).sort(), [`kasa-yok-${Y}`, `kasa-yok-${Y}-marina`]);
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, Y, "Tadilat", "tuzla"));
    assert.deepEqual(await missing(), [`kasa-yok-${Y}-marina`]);
  });

  test("Özel günler: şubeli kapalı gün silinip geri alınınca aynı şubeye döner; şube seçilerek yazılır, ikiz şube içinde", async () => {
    const D = addDays(businessDate(), -3);
    const { id } = await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, D, "Elektrik yok", "tuzla"));
    const gone = await special.deleteSpecialDay(id);
    assert.ok(gone.ok);
    assert.equal(gone.ok && gone.data.branchId, "tuzla");
    const back = await special.saveSpecialDay(gone.ok ? gone.data : (undefined as never));
    assert.ok(back.ok);
    const [row] = await db.select().from(s.specialDays).where(eq(s.specialDays.id, back.ok ? back.data.id : 0));
    assert.equal(row.branchId, "tuzla", "işletme geneline dönmedi");
    assert.equal(await closed.isClosedDay(D, db, "marina"), false);
    // Yeni kapalı gün yalnız Marina'nın: aynı ad öteki şubede ikiz değil, aynı şubede ikiz
    const E = addDays(businessDate(), 20);
    const input = { kind: "kapali" as const, title: "Tadilat", dateFrom: E, dateTo: null, effect: 0 as const, note: null };
    const m = await special.saveSpecialDay({ ...input, branchId: "marina" });
    assert.ok(m.ok);
    assert.ok((await special.saveSpecialDay({ ...input, branchId: "tuzla" })).ok);
    const twin = await special.saveSpecialDay({ ...input, branchId: "marina" });
    assert.ok(!twin.ok && /aynı adla/.test(twin.error));
    assert.equal(await closed.isClosedDay(E, db, "marina"), true);
    // Düzenlemede şube verilmezse kayıtlıdaki kalır; kapalı olmayan özel günde şube yok
    assert.ok((await special.saveSpecialDay({ ...input, id: m.ok ? m.data.id : 0, title: "Tadilat (Marina)" })).ok);
    assert.equal((await db.select().from(s.specialDays).where(eq(s.specialDays.id, m.ok ? m.data.id : 0)))[0].branchId, "marina");
    const derbi = await special.saveSpecialDay({ ...input, kind: "derbi", title: "Derbi", effect: 0.15, branchId: "marina" });
    assert.equal((await db.select().from(s.specialDays).where(eq(s.specialDays.id, derbi.ok ? derbi.data.id : 0)))[0].branchId, null);
    const unknown = await special.saveSpecialDay({ ...input, title: "Başka", branchId: "yok" });
    assert.ok(!unknown.ok);
  });

  test("LafPOS'un gün sonu kanıtı şube şube: şube verilmezse LafPOS'un şubesininki; ModPOS'taki şubenin eski satırı kanıt değil", async () => {
    const D = "2026-11-11";
    await db.insert(s.settings).values({ key: "lafposGecisGunu", value: "2026-11-01" });
    const z = (zNo: number) => ({ zNo, receipts: 40, zTotal: 9_000, cash: 4_000, card: 5_000, mealCard: 0, online: 0, other: 0, offRevenue: 0, discounts: 0, openingCash: 500, cashOut: 0, countedCash: 4_500, handedOver: 0, cashDiff: 0 });
    const pos = (branchId: string, zNo: number) => db.insert(s.posDayReports).values({ date: D, branchId, z: z(zNo), payments: [], ikram: [], source: "lafpos" });
    // Tuzla'nın kasası ModPOS'ta: şubesi Tuzla olan eski bir deneme satırı LafPOS'un kanıtı sayılmaz
    await pos("tuzla", 7);
    assert.equal((await closed.closedDayEvidence(db, D)).lafpos, null, "şubesiz okuma Tuzla'nın satırını kanıt saymaz");
    assert.equal((await closed.closedDayEvidence(db, D, "tuzla")).lafpos, null);
    await pos("marina", 14);
    const marina = { zNo: 14, receipts: 40, zTotal: 9_000 };
    assert.deepEqual((await closed.closedDayEvidence(db, D)).lafpos, marina);
    assert.deepEqual((await closed.closedDayEvidence(db, D, "marina")).lafpos, marina);
    assert.equal((await closed.closedDayEvidence(db, D, "tuzla")).lafpos, null, "Marina'nın gün sonu Tuzla'nın kanıtı değil");
  });

  test("kanıt şube şube (24 Kasım şube kapsamı): Tuzla'nın listesi, kilitli personeli ve karaokesi Marina'nın bildirimini kapatmaz; Tuzla'da kırmızı kalır", async () => {
    const D = addDays(businessDate(), -1);
    const morning = new Date(Date.parse(`${D}T12:00:00+03:00`) + 86_400_000);
    const at = tr(`${D}T15:00`);
    // Tuzla'ya kilitli personel
    const [tuna] = await db
      .insert(s.users)
      .values({ email: `tuna-${Date.now()}@laffogato.net`, name: "Tuna", passwordHash: "x", role: "staff", branchId: "tuzla" })
      .returning({ id: s.users.id });
    const run = async (name: string, branchId: string | null) => {
      const [t] = await db.insert(s.checklistTemplates).values({ name, opensAt: "08:00", dueAt: "11:00", activeFrom: tr("2026-10-01T00:00"), branchId }).returning({ id: s.checklistTemplates.id });
      await db.insert(s.checklistRuns).values({ templateId: t.id, date: D, name, items: [] });
    };
    await run("Tuzla açılış", "tuzla");
    // Tuzla'nın personelinin işlem geçmişi: kendi tablosunda sayılan "Kasa raporu" ve öbür yazım
    await db.insert(s.activityLog).values([
      { at, userId: tuna.id, userName: "Tuna", action: "Kasa raporu", detail: "Tuzla" },
      { at, userId: tuna.id, userName: "Tuna", action: "Sayım kaydı", detail: "Tuzla" },
      // Şubesiz personelin kasa raporu kaydı da işlem geçmişinden sayılmaz (raporun kendisi şubesinde sayılır)
      { at, userId: users.ayse.id, userName: "Ayşe", action: "Kasa raporu", detail: "Tuzla" },
    ]);
    await db.insert(s.karaokeSessions).values({ source: "panel", date: D, startsAt: tr(`${D}T20:00`), endsAt: tr(`${D}T21:00`), customerName: "Sayaç" });

    const marina = await closed.closedDayEvidence(db, D, "marina");
    assert.deepEqual([marina.checklists, marina.staffWrites, marina.karaoke, marina.sharedTraces], [0, 0, 0, 0]);
    const tuzla = await closed.closedDayEvidence(db, D, "tuzla");
    assert.deepEqual([tuzla.checklists, tuzla.staffWrites, tuzla.karaoke, tuzla.sharedTraces], [1, 1, 1, 0]);
    assert.ok(closedEvidenceText(tuzla).red.length >= 3, "Tuzla'nın izleri Tuzla'da kırmızı");
    // Şube verilmeyen (işletme geneli) okuma bugünkü gibi: her iz
    const all = await closed.closedDayEvidence(db, D);
    assert.deepEqual([all.checklists, all.staffWrites, all.karaoke], [1, 3, 1]);

    // Bütün şubelerin listesi ve şubesiz personelin yazımı Marina'da yalnız uyarı: bildirim açılır
    await run("Kapanış", null);
    await db.insert(s.activityLog).values({ at, userId: users.ayse.id, userName: "Ayşe", action: "Sayım kaydı", detail: "?" });
    const shared = await closed.closedDayEvidence(db, D, "marina");
    assert.deepEqual([shared.checklists, shared.staffWrites, shared.sharedTraces], [0, 0, 2]);
    assert.equal(hasPanelEvidence(shared), false);
    assert.deepEqual(closedEvidenceText(shared).red, []);
    assert.match(closedEvidenceText(shared).warn.join(" "), /Şubesi belli olmayan 2 iz/);

    const asked = await withBranchScope("marina", () => reqs.proposeClosedDay(db, users.deniz, { date: D, reason: "Su baskını", clientKey: null }, morning));
    assert.equal(asked.row.subject, `gun:${D}:marina`);
    const out = await withBranchScope("hepsi", () => reqs.reviewClosedDayCore(db, users.ali, { id: asked.row.id, seenVersion: asked.row.version, decision: "approve", note: null }, morning));
    assert.equal(out.status, "approved");
    assert.equal(await closed.isClosedDay(D, db, "marina"), true);
    // Aynı izler Tuzla'nın bildirimini kapatır
    await assert.rejects(
      withBranchScope("tuzla", () => reqs.proposeClosedDay(db, users.ayse, { date: D, reason: null, clientKey: null }, morning)),
      (e: unknown) => e instanceof UserError && e.message === CLOSED_TEXT.evidence,
    );
  });

  test("site sayıları kapalı bildirilen şubenin: &branch=marina gider, Tuzla'nın (ya da şubesiz eski sitenin) yanıtı reddedilir", async () => {
    const sync = await import("../src/server/site-sales/sync");
    const saved = { fetch: globalThis.fetch, secret: process.env.KARAOKE_SYNC_SECRET };
    process.env.KARAOKE_SYNC_SECRET = "site-sayilari-testi-icin-en-az-otuz-iki-karakterlik-sir";
    const asked: string[] = [];
    let answer: unknown = {};
    globalThis.fetch = (async (url: URL | string) => {
      asked.push(String(url));
      return Response.json(answer);
    }) as typeof fetch;
    const D = "2026-11-20";
    const totals = (orders: number) => ({ orders, grossMinor: 0, discountMinor: 0, deliveryMinor: 0, refundedMinor: 0, netMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 });
    const sales = (branch: string | undefined) => ({
      ...(branch ? { branch } : {}),
      version: 1,
      now: new Date().toISOString(),
      from: D,
      to: D,
      closed: true,
      cafe: { ...totals(3), lines: [] },
      shop: totals(0),
      karaoke: { bookings: 0, collectedMinor: 0, refundedMinor: 0, netMinor: 0, refundPendingMinor: 0, kdvMinor: 0, unknownKdvNetMinor: 0 },
      manual: { orders: 1, grossMinor: 0, netMinor: 0 },
    });
    try {
      answer = sales("tuzla");
      assert.equal(await sync.fetchSiteDayCounts(D, "marina"), null, "Tuzla'nın rakamı Marina'nın kanıtı değil");
      assert.equal(new URL(asked[0]).searchParams.get("branch"), "marina");
      answer = sales(undefined);
      assert.equal(await sync.fetchSiteDayCounts(D, "marina"), null, "şubesiz eski site Marina için okunamadı sayılır");
      answer = sales("marina");
      assert.deepEqual(await sync.fetchSiteDayCounts(D, "marina"), { cafe: 3, manual: 1, counter: 0, shop: 0 });
      // Online kanalın sitede karşılığı yok: istek gitmez
      const before = asked.length;
      assert.equal(await sync.fetchSiteDayCounts(D, "online"), null);
      assert.equal(asked.length, before);
    } finally {
      globalThis.fetch = saved.fetch;
      if (saved.secret === undefined) delete process.env.KARAOKE_SYNC_SECRET;
      else process.env.KARAOKE_SYNC_SECRET = saved.secret;
    }
  });

  test("zil: kasadan faturalı alım seçili şubenin kasasından (24 Kasım şube kapsamı)", async () => {
    await db.insert(s.cashOuts).values({ date: businessDate(), kind: "harcama", amount: 2400, store: "Migros", docType: "e_arsiv", createdByName: "Ayşe", branchId: "tuzla" });
    const bellIds = async (scope: string) => (await withBranchScope(scope, () => panelBell.loadPanelNotifications())).filter((n) => n.id.startsWith("fatura-kasa-")).map((n) => n.id);
    assert.deepEqual(await bellIds("marina"), [], "Tuzla'nın e-Arşiv satırı Marina'nın ziline düşmez");
    assert.equal((await bellIds("tuzla")).length, 1);
    assert.equal((await bellIds("hepsi")).length, 1);
  });

  test("kontrol listeleri şube şube: zil ve sabah e-postası yalnız kapalı şubenin açılmamış listesini düşürür", async () => {
    const tpl = async (name: string, branchId: string | null) => {
      const [t] = await db.insert(s.checklistTemplates).values({ name, opensAt: "08:00", dueAt: "11:00", activeFrom: tr("2026-10-01T00:00"), branchId }).returning({ id: s.checklistTemplates.id });
      await db.insert(s.checklistItems).values({ templateId: t.id, label: "Tezgâh temiz" });
      return t.id;
    };
    const ids = new Map([
      [await tpl("Tuzla açılış", "tuzla"), "tuzla"],
      [await tpl("Marina açılış", "marina"), "marina"],
      [await tpl("Kapanış", null), "ortak"],
    ]);
    const reset = () => db.execute(sql`TRUNCATE cash_reports, special_days, staff_requests, activity_log RESTART IDENTITY CASCADE`);

    // Sabah e-postası: 12 Kasım sabahı dünün (11 Kasım) kutusu; kasa raporu kullanılıyor (10 Kasım'da raporlar var)
    const D = "2026-11-11";
    const morning = tr("2026-11-12T08:30");
    const digest = async () => (await checklists.loadKontrolDigest(morning))?.box.lines.flatMap((l) => (l.strong ? [l.strong] : [])).sort() ?? null;
    const fresh = async () => {
      await reset();
      await report("2026-11-10", "tuzla");
      await report("2026-11-10", "marina");
    };
    // Marina dün kapalıydı (onaylı), Tuzla açıktı ve raporunu girdi: önceden Tuzla'nın raporu Marina'nın listesini de
    // eksik yazdırıyordu
    await fresh();
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, D, "Tadilat", "marina"));
    await report(D, "tuzla");
    const m = await closed.closedMarksOn(D, db);
    assert.deepEqual([m.all, [...m.branches], [...m.open].sort()], [false, ["marina"], ["marina", "tuzla"]]);
    assert.deepEqual(await digest(), ["Kapanış listesi", "Tuzla açılış listesi"]);
    // Tuzla kapalı, Marina raporlu: Tuzla'nın kapalı gününün listesi eksik yazılmaz
    await fresh();
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, D, "Tadilat", "tuzla"));
    await report(D, "marina");
    assert.deepEqual(await digest(), ["Kapanış listesi", "Marina açılış listesi"]);
    // Marina kapalı, sabah hiçbir şubenin raporu yok: önceden kutu hiç çıkmıyor, Tuzla'nın eksik listesi düşüyordu
    await fresh();
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, D, "Tadilat", "marina"));
    assert.deepEqual(await digest(), ["Kapanış listesi", "Tuzla açılış listesi"]);
    // İki şube de kendi işaretiyle kapalı: işletme kapalı, kutu yok (tek şubeli günlerdeki gibi)
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, D, "Tadilat", "tuzla"));
    assert.equal(await digest(), null);

    // Zil (yönetici, Tümü): dün Marina kapalıydı; Tuzla'nın ve bütün şubelerin açılmamış listesi eksik yazılır
    await reset();
    const Y = addDays(businessDate(), -1);
    const missing = async () =>
      (await withBranchScope("hepsi", () => panelBell.loadPanelNotifications()))
        .flatMap((n) => {
          const id = /^kontrol-eksik-(\d+)-/.exec(n.id)?.[1];
          return id ? [ids.get(Number(id))] : [];
        })
        .sort();
    assert.deepEqual(await missing(), ["marina", "ortak", "tuzla"]);
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, Y, "Tadilat", "marina"));
    assert.deepEqual(await missing(), ["ortak", "tuzla"], "Marina'nın kapalı günü Tuzla'nın eksik listesini susturmaz");
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, Y, "Tadilat", "tuzla"));
    assert.deepEqual(await missing(), [], "iki şube de kapalı: bütün şubelerin listesi de beklenmez");
  });
});
