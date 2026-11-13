// P03 incelemesinin düzeltmeleri, gerçek Postgres'te (denetim 13 Kasım 2026): yalnız Marina rapor girince "Tümü"de
// Bugün ve zil Tuzla'nın raporunu bekler (Marina'nın raporu Tuzla'nın satırını "gönderildi" yapmaz), yöneticinin eksik
// rapor zili şube şube; bir şubenin raporu işletme geneli tek günlük kapalı işareti öteki şubelerden silmez; Özel
// günler'de silinen şubeli kapalı gün "Geri al"la aynı şubeye döner; kasadan çıkan formun şubesine yazılır.
//
// SUBE_TEST_DATABASE_URL (yoksa KASA_ISTEK_TEST_DATABASE_URL) verilmezse atlanır. Test kendi geçici veritabanını açar,
// migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sube-kasa-inceleme-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate, type CashReportFields } from "../src/lib/cash-report";
import { CASH_REQUEST_TEXT } from "../src/lib/cash-requests";
import { addDays } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const SERVER_URL = process.env.SUBE_TEST_DATABASE_URL ?? process.env.KASA_ISTEK_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_kasa_inceleme_${process.pid}`;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

describe("P03 incelemesi: iki şubeli Bugün, zil, kapalı gün, özel gün ve kasadan çıkan", { skip: !SERVER_URL && "SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let store: typeof import("../src/server/cash/report-store");
  let closed: typeof import("../src/server/closed-days");
  let bell: typeof import("../src/server/bell/kasa");
  let today: typeof import("../src/server/data/today");
  let logic: typeof import("../src/app/panel/bugun/logic");
  let special: typeof import("../src/server/actions/special-days");
  let outs: typeof import("../src/server/actions/cash-outs");
  let outRequests: typeof import("../src/server/cash-outs/requests");
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
    zNo: branch === "tuzla" ? "1200" : "50",
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
  const refused = async (p: Promise<unknown>, text: string) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && e.message === text);
  };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sube-kasa-inceleme-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b })))
      .onConflictDoNothing();
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
    bell = await import("../src/server/bell/kasa");
    today = await import("../src/server/data/today");
    logic = await import("../src/app/panel/bugun/logic");
    special = await import("../src/server/actions/special-days");
    outs = await import("../src/server/actions/cash-outs");
    outRequests = await import("../src/server/cash-outs/requests");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    me = users.ali;
    await db.execute(sql`TRUNCATE cash_reports, cash_outs, staff_requests, special_days, activity_log, photos RESTART IDENTITY CASCADE`);
    await db.update(s.branches).set({ active: true });
  });

  test("yalnız Marina girdi: Tümü'de Bugün Tuzla'nın raporunu bekler, yöneticinin zili Tuzla'nın eksiğini şubesiyle söyler", async () => {
    const T = businessDate();
    const Y = addDays(T, -1);
    // Tuzla kasayı Y-1'den beri kullanıyor; dün ve bugün yalnız Marina girdi
    await report(addDays(Y, -1), "tuzla", new Date());
    await report(addDays(Y, -1), "marina", new Date());
    await report(Y, "marina", new Date());
    await report(T, "marina", new Date());
    // Personel Tümü'de: Kasa formu Tuzla'nın; Bugün'ün satırları Marina'nın raporunu "gönderildi" saymaz
    const staffDay = await withBranchScope("hepsi", () => today.loadToday(users.ayse));
    assert.equal(staffDay.facts.cash?.today, null);
    assert.equal(staffDay.facts.cash?.yesterday, null);
    assert.equal(staffDay.facts.cash?.branch, "Tuzla");
    assert.equal(staffDay.facts.cash?.others, undefined, "personele öteki şube gitmez");
    // Yönetici Tümü'de: Tuzla'nın satırı "Girilmedi", Marina'nınki kendi raporuyla
    const adminDay = await withBranchScope("hepsi", () => today.loadToday(users.ali));
    assert.equal(adminDay.facts.cash?.yesterday, null);
    const marina = adminDay.facts.cash?.others?.[0];
    assert.equal(marina?.id, "marina");
    assert.equal(marina?.yesterday?.date, Y);
    assert.equal(marina?.today?.date, T);
    const rows = Object.fromEntries(logic.dayTasks(adminDay.facts).map((t) => [t.key, t]));
    assert.equal(rows["kasa-dun"].badge, "Girilmedi");
    assert.equal(rows["kasa-dun"].title, "Dünkü kasa raporu · Tuzla");
    assert.equal(rows["kasa-dun-marina"].title, "Dünkü kasa raporu · Marina");
    // Zil: Tümü'de (varsayılan) Tuzla'nın eksiği, gövdede şube; Marina'nın raporu var
    const missing = async (scope: string) => (await withBranchScope(scope, () => bell.kasaBell(users.ali))).filter((n) => n.id.startsWith("kasa-yok"));
    const all = await missing("hepsi");
    assert.deepEqual(
      all.map((n) => n.id),
      [`kasa-yok-${Y}`],
    );
    assert.match(all[0].body ?? "", /^Tuzla · /);
    assert.deepEqual(
      (await missing("tuzla")).map((n) => n.id),
      [`kasa-yok-${Y}`],
    );
    assert.deepEqual(await missing("marina"), []);
    // Tuzla dün kapalıydı (onaylı): Tuzla'nın satırı ve zili düşer, Marina'nınki kalır
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, Y, "Tadilat", "tuzla"));
    assert.deepEqual(await missing("hepsi"), []);
    const closedDay = await withBranchScope("hepsi", () => today.loadToday(users.ali));
    const keys = logic.dayTasks(closedDay.facts).map((t) => t.key);
    assert.ok(!keys.includes("kasa-dun"));
    assert.ok(keys.includes("kasa-dun-marina"));
    // Ters durum: Tuzla girdi, Marina girmedi: Marina'nın satırı şubeli kimlikle
    await db.delete(s.specialDays);
    await db.delete(s.cashReports).where(and(eq(s.cashReports.date, Y), eq(s.cashReports.branchId, "marina")));
    await report(Y, "tuzla", new Date());
    const other = await missing("hepsi");
    assert.deepEqual(
      other.map((n) => n.id),
      [`kasa-yok-${Y}-marina`],
    );
    assert.match(other[0].body ?? "", /^Marina · /);
  });

  test("işletme geneli tek günlük kapalı işaret: Marina'nın raporu yalnız Marina için kaldırır; Tuzla kapalı kalır, onaylı bildirimi yeni satıra geçer", async () => {
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
    const marks = await db.select().from(s.specialDays).where(eq(s.specialDays.kind, "kapali"));
    assert.deepEqual(
      marks.map((m) => [m.branchId, m.title, m.createdByName]),
      [["tuzla", "Bayram", "Ali"]],
    );
    assert.equal(await closed.isClosedDay(C, db, "tuzla"), true);
    assert.equal(await closed.isClosedDay(C, db, "marina"), false);
    const reqs = Object.fromEntries((await db.select().from(s.staffRequests)).map((r) => [r.id, r]));
    assert.equal(reqs[tuzlaReq.id].status, "approved");
    assert.equal(reqs[tuzlaReq.id].resultId, marks[0].id, "Tuzla'nın onayı Tuzla'nın satırına geçti");
    assert.equal(reqs[marinaReq.id].status, "revoked");
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

  test("Özel günler: şubeli kapalı gün silinip geri alınınca aynı şubeye döner; kapalı gün şube seçilerek yazılır, ikiz şube içinde", async () => {
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

  test("kasadan çıkan: yeni satır formun şubesine yazılır, seçim başka sekmede değiştiyse yazılmaz; düzeltilen satır şubesinde kalır", async () => {
    const D = businessDate();
    const line = { id: null, date: D, kind: "harcama" as const, amount: 120, store: "Market", description: null, receiptDate: null, receiptNo: null, vat: null, docType: "yok" as const, categoryId: null, toExpenses: false, photoId: null };
    // Form Marina için açıldı, seçim sonra Tümü oldu (yazım Tuzla'ya inerdi)
    const moved = await withBranchScope("hepsi", () => outs.saveCashOut({ ...line, branchId: "marina" }));
    assert.ok(!moved.ok && moved.error === CASH_REQUEST_TEXT.branchChanged);
    assert.equal((await db.select().from(s.cashOuts)).length, 0);
    const ok = await withBranchScope("marina", () => outs.saveCashOut({ ...line, branchId: "marina" }));
    assert.ok(ok.ok);
    const [row] = await db.select().from(s.cashOuts);
    assert.equal(row.branchId, "marina");
    // Tümü'de düzeltme: satır Marina'da kalır (şube gönderilmez)
    const edit = await withBranchScope("hepsi", () => outs.saveCashOut({ ...line, id: row.id, amount: 150 }));
    assert.ok(edit.ok);
    assert.deepEqual(
      (await db.select().from(s.cashOuts)).map((r) => [r.branchId, r.amount]),
      [["marina", 150]],
    );
    // Personelin eski güne ekleme isteği de formun şubesiyle
    await refused(
      withBranchScope("hepsi", () =>
        outRequests.proposeCashOutChange(db, users.deniz, { op: "ekle", date: addDays(D, -3), cashOutId: null, line: { ...line, categoryId: null }, message: null, clientKey: "k-1", branchId: "marina" }),
      ),
      CASH_REQUEST_TEXT.branchChanged,
    );
  });
});
