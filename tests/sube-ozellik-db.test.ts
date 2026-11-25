// Şube özellikleri, gerçek Postgres'te (şube kapsamı B6 ve C P1-8, 25 Kasım 2026; docs/SUBE.md › Şube özellikleri):
// - göç: sütun ve veri adımı Tuzla'ya karaoke ekler; online kanalın özelliği yok;
// - Şube ayarları › Özellikler: yalnız yönetici; karaoke iki şubede açılamaz; işlem geçmişine yazılır; şube kapanınca
//   karaokesi düşer;
// - karaokenin şubesi özellikten: karaoke Marina'ya taşınınca eylem, istek ve kitle Marina'nın; hiçbir şubede yokken
//   personel karaoke eylemi çağıramaz;
// - uygulama siparişi ve garson çağırın bildirim kitlesi özelliği açık şubenin personeli (yönetici ve şubesiz personel
//   her zaman, özellik bir şubede açıksa);
// - zil: yemek kartı seçili şubede kullanılmıyorsa komisyon satırı, karaoke yoksa karaoke isteği satırı yok.
//
// SUBE_OZELLIK_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/postgres). Test o
// sunucuda kendi geçici veritabanını açar, sonunda siler.
// Çalıştırma: SUBE_OZELLIK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sube-ozellik-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { parseFeatures } from "../src/lib/branch-features";
import { BRANCH_COOKIE, DEFAULT_BRANCHES, KARAOKE_ELSEWHERE } from "../src/lib/branches";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_OZELLIK_TEST_DATABASE_URL;
const DB_NAME = `lm_sube_ozellik_${process.pid}`;

describe("Şube özellikleri", { skip: !SERVER_URL && "SUBE_OZELLIK_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let settings: typeof import("../src/server/actions/branch-settings");
  let branchActions: typeof import("../src/server/actions/branches");
  let karaoke: typeof import("../src/server/actions/karaoke");
  let server: typeof import("../src/server/branches");
  let requests: typeof import("../src/server/staff-requests/branch");
  type Who = { id: number; name: string; email: string; role: "admin" | "staff"; branchId: string | null };
  const users: Record<"ali" | "serbest" | "tuzla" | "marina", Who> = {
    ali: { id: 0, name: "Ali", email: "ali@laffogato.net", role: "admin", branchId: null },
    serbest: { id: 0, name: "Selin", email: "selin@laffogato.net", role: "staff", branchId: null },
    tuzla: { id: 0, name: "Tuna", email: "tuna@laffogato.net", role: "staff", branchId: "tuzla" },
    marina: { id: 0, name: "Mert", email: "mert@laffogato.net", role: "staff", branchId: "marina" },
  };
  /** Oturumdaki kullanıcı ve seçicinin çerezi (src/server/auth/dal ve next/headers taklidi) */
  let me: Who = users.ali;
  let picked: string | null = null;

  const features = async (id: string) => {
    const [row] = await db.select({ f: s.branches.features }).from(s.branches).where(eq(s.branches.id, id));
    return parseFeatures(row?.f);
  };
  const setFeature = (branchId: string, feature: "karaoke" | "siparis" | "garson" | "yemek_karti", on: boolean) =>
    settings.setBranchFeature({ branchId, feature, on });

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sube-ozellik-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    delete process.env.KARAOKE_SYNC_SECRET;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    stub("next/headers", {
      cookies: async () => ({ get: (k: string) => (k === BRANCH_COOKIE && picked ? { name: k, value: picked } : undefined), set: () => {} }),
      headers: async () => new Headers(),
    });
    const session = async () => ({ ...me });
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
    // Göç: 0057'nin Tuzla'sı veri adımında karaokeyi aldı (tohumdan önce)
    assert.deepEqual(await features("tuzla"), ["karaoke", "siparis", "garson", "yemek_karti"], "göç Tuzla'ya karaoke ekledi");
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }))).onConflictDoNothing();
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const u = users[k];
      const [row] = await db.insert(s.users).values({ email: u.email, name: u.name, passwordHash: "x", role: u.role, branchId: u.branchId }).returning({ id: s.users.id });
      u.id = row.id;
    }
    settings = await import("../src/server/actions/branch-settings");
    branchActions = await import("../src/server/actions/branches");
    karaoke = await import("../src/server/actions/karaoke");
    server = await import("../src/server/branches");
    requests = await import("../src/server/staff-requests/branch");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("varsayılanlar: karaoke Tuzla'da; Marina sipariş, garson ve yemek kartıyla; online kanal boş", async () => {
    assert.deepEqual(await features("marina"), ["siparis", "garson", "yemek_karti"]);
    assert.deepEqual(await features("online"), []);
    assert.equal(await server.karaokeBranchId(), "tuzla");
    // Yeni şube sütunun varsayılanıyla: karaokesiz
    await db.insert(s.branches).values({ id: "kadikoy", name: "Kadıköy", kind: "fiziksel", posSource: "modpos", sortOrder: 4 });
    assert.deepEqual(await features("kadikoy"), ["siparis", "garson", "yemek_karti"]);
    await db.delete(s.branches).where(eq(s.branches.id, "kadikoy"));
  });

  test("Özellikler: yalnız yönetici; karaoke iki şubede açılamaz; online kanala özellik yok; işlem geçmişine yazılır", async () => {
    me = users.marina;
    const staff = await setFeature("marina", "garson", false);
    assert.equal(staff.ok, false, "personel değiştiremez");
    me = users.ali;
    const both = await setFeature("marina", "karaoke", true);
    assert.equal(both.ok ? "geçti" : both.error, "Karaoke Tuzla şubesinde açık; önce oradan kapatın (yalnız bir şubede olabilir)");
    const online = await setFeature("online", "siparis", true);
    assert.equal(online.ok ? "geçti" : online.error, "Online kanalın şube özelliği yok");
    // Karaoke Tuzla'dan Marina'ya taşınır
    assert.ok((await setFeature("tuzla", "karaoke", false)).ok);
    assert.equal(await server.karaokeBranchId(), null, "arada hiçbir şubede yok");
    const moved = await setFeature("marina", "karaoke", true);
    assert.ok(moved.ok, moved.ok ? "" : moved.error);
    assert.deepEqual(moved.ok ? moved.data.features : [], ["karaoke", "siparis", "garson", "yemek_karti"]);
    assert.equal(await server.karaokeBranchId(), "marina");
    // Değişmeyen istek yazmaz
    const same = await setFeature("marina", "karaoke", true);
    assert.equal(same.ok && same.data.changed, false);
    const log = await db.select({ detail: s.activityLog.detail }).from(s.activityLog).where(eq(s.activityLog.action, "Şube özelliği"));
    assert.deepEqual(
      log.map((l) => l.detail),
      ["Tuzla · Karaoke: kapatıldı", "Marina · Karaoke: açıldı"],
    );
  });

  test("karaokenin şubesi özellikten: eylemler, sayaç silme isteğinin şubesi ve bildirim kitlesi Marina'nın", async () => {
    // Karaoke şimdi Marina'da (önceki test). Tuzla'ya kilitli personel sayaç açamaz, Marina'nınki açar
    me = users.tuzla;
    const tuzla = await karaoke.startKaraokeTimer({ minutes: 60, label: null, guests: 2, force: true });
    assert.equal(tuzla.ok ? "geçti" : tuzla.error, KARAOKE_ELSEWHERE);
    me = users.marina;
    const marina = await karaoke.startKaraokeTimer({ minutes: 60, label: null, guests: 2, force: true });
    assert.ok(marina.ok, marina.ok ? "" : marina.error);
    // Sayaç silme isteğinin şubesi karaokenin şubesi
    const branchOf = await requests.requestBranches(db, [{ id: 1, kind: "karaoke-sil", subject: "x", payload: {} }]);
    assert.equal(branchOf.get(1), "marina");
    // Kitle: yönetici, şubesiz personel ve Marina'nın personeli
    const ids = await server.featureAudienceIds("karaoke");
    assert.deepEqual(ids.sort(), [users.ali.id, users.serbest.id, users.marina.id].sort());
    // Hiçbir şubede yokken personel (şubesiz de) karaoke eylemi çağıramaz; yönetici çağırır
    me = users.ali;
    assert.ok((await setFeature("marina", "karaoke", false)).ok);
    me = users.serbest;
    const none = await karaoke.startKaraokeTimer({ minutes: 60, label: null, guests: 2, force: true });
    assert.equal(none.ok ? "geçti" : none.error, KARAOKE_ELSEWHERE);
    assert.deepEqual(await server.featureAudienceIds("karaoke"), [], "bildirim kimseye gitmez");
    me = users.ali;
    const byAdmin = await karaoke.startKaraokeTimer({ minutes: 30, label: null, guests: 2, force: true });
    assert.ok(byAdmin.ok, byAdmin.ok ? "" : byAdmin.error);
    // Sahibin varsayılanına dönülür
    assert.ok((await setFeature("tuzla", "karaoke", true)).ok);
    assert.equal(await server.karaokeBranchId(), "tuzla");
  });

  test("sipariş ve garson çağır kitlesi: Marina'da kapalıysa Marina'nın personeli bildirim almaz", async () => {
    me = users.ali;
    const all = [users.ali.id, users.serbest.id, users.tuzla.id, users.marina.id].sort();
    assert.deepEqual((await server.featureAudienceIds("siparis")).sort(), all);
    assert.ok((await setFeature("marina", "siparis", false)).ok);
    assert.deepEqual((await server.featureAudienceIds("siparis")).sort(), [users.ali.id, users.serbest.id, users.tuzla.id].sort());
    assert.deepEqual((await server.featureAudienceIds("garson")).sort(), all, "garson çağır Marina'da açık kalır");
    // Kapsam: Marina seçiliyken sipariş yok, Tümü'de var
    assert.equal(await server.featureHere("siparis", "marina"), false);
    assert.equal(await server.featureHere("siparis", "hepsi"), true);
    assert.ok((await setFeature("marina", "siparis", true)).ok);
  });

  test("zil: yemek kartı Marina'da kapalıyken Marina seçiliyse komisyon satırı yok; karaoke isteği satırı karaokenin şubesinde", async () => {
    me = users.ali;
    const { loadPanelNotifications } = await import("../src/server/actions/notifications");
    // Geciken hakediş üretmek ağır: yalnız komisyon satırının hiç sorulmadığını kaynaktan değil davranıştan, kapalıyken
    // satırın gelmediğiyle sınarız. Önce sayaç silme isteği bekleyen bir satır yazılır (karaoke isteği satırı)
    const [session] = await db.select({ id: s.karaokeSessions.id }).from(s.karaokeSessions).limit(1);
    await db.insert(s.staffRequests).values({
      kind: "karaoke-sil",
      subject: `karaoke:${session.id}`,
      title: "Karaoke sayacı silme",
      payload: { sessionId: session.id },
      requestedBy: users.serbest.id,
      requestedByName: users.serbest.name,
    });
    const karaokeRows = async () => (await loadPanelNotifications()).filter((n) => n.id.startsWith("karaoke-istek-"));
    picked = "tuzla";
    assert.equal((await karaokeRows()).length, 1, "Tuzla seçiliyken karaoke isteği zilde");
    picked = "marina";
    assert.equal((await karaokeRows()).length, 0, "Marina seçiliyken yok");
    assert.ok((await setFeature("marina", "yemek_karti", false)).ok);
    const marinaRows = await loadPanelNotifications();
    assert.equal(marinaRows.filter((n) => n.id.startsWith("komisyon-")).length, 0);
    picked = null;
    assert.ok((await setFeature("marina", "yemek_karti", true)).ok);
    await db.delete(s.staffRequests).where(like(s.staffRequests.kind, "karaoke%"));
  });

  test("şube kapanınca karaokesi düşer; yeniden açılınca iki şubede birden açık kalmaz", async () => {
    me = users.ali;
    assert.ok((await setFeature("tuzla", "karaoke", false)).ok);
    assert.ok((await setFeature("marina", "karaoke", true)).ok);
    const closed = await branchActions.updateBranch({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", openedOn: null, active: false });
    assert.ok(closed.ok, closed.ok ? "" : closed.error);
    assert.deepEqual(await features("marina"), ["siparis", "garson", "yemek_karti"], "karaoke düştü, öbürleri kaldı");
    assert.equal(await server.karaokeBranchId(), null);
    assert.ok((await setFeature("tuzla", "karaoke", true)).ok);
    const reopened = await branchActions.updateBranch({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "modpos", openedOn: null, active: true });
    assert.ok(reopened.ok, reopened.ok ? "" : reopened.error);
    assert.equal(await server.karaokeBranchId(), "tuzla");
    assert.deepEqual(await features("marina"), ["siparis", "garson", "yemek_karti"]);
  });
});
