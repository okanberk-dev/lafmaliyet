// Onaylanmış kapalı günün Özel günler'de düzenlenmesi, gerçek Postgres'te (denetim 13 Kasım 2026, SB-04 ve SB-X1):
// satır kapalı olmaktan çıkınca (tür, gün ya da şube değişti) onu onaylayan bildirim silmedeki gibi "geri alındı" olur;
// günü kapsayan başka kapalı satır varsa bildirim ona geçer; yalnız adı değişen satırda bildirim onaylı kalır.
// Personelin kasa satırı geri alınan bildirimi söyler, "Kafe kapalıydı" düğmesi çıkmaz (basınca "Bu gün için
// bildiriminiz var" hatası alınıyordu).
//
// SUBE_TEST_DATABASE_URL (yoksa KAPALI_TEST_DATABASE_URL) verilmezse atlanır. Test kendi geçici veritabanını açar,
// migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/kapali-gun-duzenleme-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import { CLOSED_TEXT, closedEndedTitle } from "../src/lib/closed-days";
import { addDays } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const SERVER_URL = process.env.SUBE_TEST_DATABASE_URL ?? process.env.KAPALI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_kapali_duzenleme_${process.pid}`;

describe("Kapalı gün düzenlenince bildirim ve personelin kasa satırı", { skip: !SERVER_URL && "SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let closed: typeof import("../src/server/closed-days");
  let reqs: typeof import("../src/server/closed-day-requests");
  let special: typeof import("../src/server/actions/special-days");
  type Who = { id: number; name: string; email: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin" },
    ayse: { id: 0, name: "Ayşe", email: "ayse@laffogato.net", role: "staff" },
  };
  /** Oturumdaki kullanıcı (src/server/auth/dal taklidi) */
  let me: Who = users.ali;

  const requestOf = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  /** Tuzla'nın o günkü kapalı satırı ve onu onaylayan bildirim (doğrudan yazılır) */
  async function approvedMark(day: string, title: string, branchId: string | null = "tuzla") {
    const [mark] = await db
      .insert(s.specialDays)
      .values({ dateFrom: day, dateTo: day, kind: "kapali", title, effect: -1, createdBy: users.ali.id, createdByName: "Ali", branchId })
      .returning();
    const [request] = await db
      .insert(s.staffRequests)
      .values({ kind: "kapali-gun", subject: `gun:${day}`, day, title: "kapalı", payload: { date: day, reason: null }, status: "approved", resultId: mark.id, requestedBy: users.ayse.id, requestedByName: "Ayşe" })
      .returning();
    return { mark, request };
  }
  const edit = (mark: typeof s.specialDays.$inferSelect, o: Partial<Parameters<typeof special.saveSpecialDay>[0]>) =>
    special.saveSpecialDay({ id: mark.id, kind: "kapali", title: mark.title, dateFrom: mark.dateFrom, dateTo: mark.dateTo, effect: 0, note: null, ...o });

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "kapali-gun-duzenleme-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
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
    closed = await import("../src/server/closed-days");
    reqs = await import("../src/server/closed-day-requests");
    special = await import("../src/server/actions/special-days");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    me = users.ali;
    await db.execute(sql`TRUNCATE staff_requests, special_days, activity_log RESTART IDENTITY CASCADE`);
  });

  test("onaylı kapalı gün başka türe çevrilince bildirim geri alınır; personelde düğme yerine nedeni yazar (SB-04, SB-X1)", async () => {
    const Y = addDays(businessDate(), -1);
    // Ayşe dün için bildirir, Ali onaylar: Tuzla'nın kapalı satırı yazılır
    const asked = await withBranchScope("tuzla", () => reqs.proposeClosedDay(db, users.ayse, { date: Y, branchId: "tuzla", reason: "Tadilat", clientKey: null }));
    const decided = await reqs.reviewClosedDayCore(db, users.ali, { id: asked.row.id, seenVersion: asked.row.version, decision: "approve", note: "Tamam" });
    assert.equal(await closed.isClosedDay(Y, db, "tuzla"), true);
    const [mark] = await db.select().from(s.specialDays).where(eq(s.specialDays.id, decided.specialId!));
    // Yönetici satırı "Diğer" yapar: gün kapalı değil, bildirim "geri alındı" (önceden "onaylandı" kalıyordu)
    const saved = await edit(mark, { kind: "diger" });
    assert.ok(saved.ok);
    assert.equal(await closed.isClosedDay(Y, db, "tuzla"), false);
    const after = await requestOf(asked.row.id);
    assert.equal(after.status, "revoked");
    assert.equal(after.reviewNote, "Yönetici kapalı işaretini değiştirdi");
    // Personelin kasa satırı: düğme yok, neden yazılı; yeniden bildirim zaten reddedilir
    const state = await closed.staffClosedState(Y, users.ayse, "tuzla");
    assert.equal(state.pending, null);
    assert.equal(state.rejected, null);
    assert.deepEqual(state.ended, { status: "revoked", note: "Yönetici kapalı işaretini değiştirdi" });
    assert.equal(state.canAsk, false);
    assert.equal(closedEndedTitle(state.ended!.status, state.ended!.note), "Kapalı gün bildirimi geri alındı: Yönetici kapalı işaretini değiştirdi. Raporu girin.");
    await assert.rejects(
      withBranchScope("tuzla", () => reqs.proposeClosedDay(db, users.ayse, { date: Y, branchId: "tuzla", reason: null, clientKey: null })),
      (e: unknown) => e instanceof UserError && e.message === CLOSED_TEXT.already,
    );
    // Öteki şubenin düğmesi açık kalır (Tuzla'nın bildirimi Marina'nın gününü kapatmaz)
    const marina = await closed.staffClosedState(Y, users.ayse, "marina");
    assert.equal(marina.ended, null);
    assert.equal(marina.canAsk, true);
  });

  test("silinen kapalı günden sonra da düğme yerine 'geri alındı' satırı; onaylı kalıp günü kapsamayan eski istek de öyle (SB-X1)", async () => {
    const Y = addDays(businessDate(), -1);
    const { mark, request } = await approvedMark(Y, "Elektrik yok");
    assert.ok((await special.deleteSpecialDay(mark.id)).ok);
    const state = await closed.staffClosedState(Y, users.ayse, "tuzla");
    assert.deepEqual(state.ended, { status: "revoked", note: "Yönetici kapalı işaretini kaldırdı" });
    assert.equal(state.canAsk, false);
    // Düzeltmeden önce düzenlenmiş satırın isteği "onaylandı" kaldı: onayın notu kaldırılma nedeni gibi yazılmaz
    await db.update(s.staffRequests).set({ status: "approved", reviewNote: "Tamam" }).where(eq(s.staffRequests.id, request.id));
    const stale = await closed.staffClosedState(Y, users.ayse, "tuzla");
    assert.deepEqual(stale.ended, { status: "revoked", note: null });
    assert.equal(stale.canAsk, false);
    assert.equal(closedEndedTitle("revoked", null), "Kapalı gün bildirimi geri alındı. Raporu girin.");
    assert.equal(closedEndedTitle("superseded", "LafPOS gün sonu geldi (Z 12)"), "Kapalı gün bildirimi kapandı: LafPOS gün sonu geldi (Z 12). Raporu girin.");
    assert.equal(closedEndedTitle("expired", null), "Kapalı gün bildiriminin süresi doldu. Raporu girin.");
  });

  test("gün kayınca ya da şube değişince geri alınır, başka kapalı satır kapsıyorsa ona geçer, yalnız ad değişince onaylı kalır (SB-04)", async () => {
    const D = addDays(businessDate(), -5);
    // Yalnız adı değişti: bildirim aynı satıra bağlı, onaylı
    const renamed = await approvedMark(D, "Tadilat");
    assert.ok((await edit(renamed.mark, { title: "Tadilat (boya)" })).ok);
    assert.deepEqual(
      [(await requestOf(renamed.request.id)).status, (await requestOf(renamed.request.id)).resultId],
      ["approved", renamed.mark.id],
    );
    // Aralık genişledi ama günü hâlâ kapsıyor: onaylı
    assert.ok((await edit(renamed.mark, { title: "Tadilat (boya)", dateFrom: addDays(D, -1), dateTo: D })).ok);
    assert.equal((await requestOf(renamed.request.id)).status, "approved");
    // Gün kaydı: bildirimin günü artık kapalı değil
    assert.ok((await edit(renamed.mark, { title: "Tadilat (boya)", dateFrom: addDays(D, 1), dateTo: addDays(D, 1) })).ok);
    assert.equal((await requestOf(renamed.request.id)).status, "revoked");

    // Başka şubeye geçti: Tuzla'nın bildirimi geri alınır
    await db.execute(sql`TRUNCATE staff_requests, special_days RESTART IDENTITY CASCADE`);
    const moved = await approvedMark(D, "Su baskını");
    assert.ok((await edit(moved.mark, { branchId: "marina" })).ok);
    assert.equal((await requestOf(moved.request.id)).status, "revoked");

    // Günü işletme geneli başka bir kapalı satır da kapsıyor: bildirim ona geçer, onaylı kalır
    await db.execute(sql`TRUNCATE staff_requests, special_days RESTART IDENTITY CASCADE`);
    const covered = await approvedMark(D, "Elektrik yok");
    const [bayram] = await db
      .insert(s.specialDays)
      .values({ dateFrom: addDays(D, -1), dateTo: addDays(D, 1), kind: "kapali", title: "Bayram", effect: -1, createdByName: "Ali" })
      .returning();
    assert.ok((await edit(covered.mark, { kind: "diger" })).ok);
    const relinked = await requestOf(covered.request.id);
    assert.deepEqual([relinked.status, relinked.resultId], ["approved", bayram.id]);
    assert.equal(await closed.isClosedDay(D, db, "tuzla"), true);
  });
});
