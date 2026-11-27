// Şube ayrımı parça 2, gerçek Postgres'te (docs/SUBE.md › Şube ayrımı › Ayarsız sızıntılar): şube seçiliyken Bugün'ün ve
// zilin sayıları, onaylar, kişi seçicileri, Paraşüt ve raporlar yalnız o şubenin (ve işletme genelinin) kayıtlarını okur;
// online kanal seçiliyken kasa, stok ve vardiya yok. Her denemede Tuzla'nın kaydı "IZ-TUZLA" işaretini taşır: Marina
// seçiliyken hiçbir çıktıda görünmemeli, "Tümü"de görünmeli. Oturum gerçek src/server/auth/dal.ts'le, çerezler taklit
// edilerek (tests/sube-gorunumu-db.test.ts gibi).
//
// SUBE_SIZINTI_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Bir Postgres
// sunucusunun adresi: test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_SIZINTI_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/sube-ayrimi-sizinti-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ALL_BRANCHES, BRANCH_COOKIE, DEFAULT_BRANCHES } from "../src/lib/branches";
import { STOCK_ESTIMATE_OTHER_BRANCH } from "../src/lib/stock-estimate";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_SIZINTI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_sizinti_${process.pid}`;
const SECRET = "sube-sizinti-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const MARK = "IZ-TUZLA";

class Jar {
  values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, opts: { maxAge?: number } = {}) {
    if (opts.maxAge === 0 || value === "") this.values.delete(name);
    else this.values.set(name, value);
  }
}

describe("şube ayrımı parça 2: sızıntılar veritabanında", { skip: !SERVER_URL && "SUBE_SIZINTI_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let scope: typeof import("../src/server/branch-scope");
  let jar = new Jar();
  const ids = { ali: 0, ayse: 0, tuzlaci: 0 };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => new Headers() });
    stub("next/navigation", {
      redirect: (to: string) => {
        throw Object.assign(new Error("NEXT_REDIRECT"), { to });
      },
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
      unstable_rethrow: (e: unknown) => {
        if ((e as Error)?.message === "NEXT_REDIRECT" || (e as Error)?.message === "NEXT_NOT_FOUND") throw e;
      },
    });
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    const user = async (name: string, email: string, role: "admin" | "staff", branchId: string | null) =>
      (await db.insert(s.users).values({ name, email, role, branchId, passwordHash: "x" }).returning({ id: s.users.id }))[0].id;
    ids.ali = await user("Ali", "ali@ornek.com", "admin", null);
    ids.ayse = await user("Ayşe Marina", "ayse@ornek.com", "staff", "marina");
    ids.tuzlaci = await user(`${MARK} Kişi`, "tuzla@ornek.com", "staff", "tuzla");

    // Faturalar: Tuzla'nın, Marina'nın, işletme geneli ve şubesi seçilmemiş; hepsi kontrol bekliyor, hepsinde bağlanmamış kalem
    const invoice = async (supplier: string, branchId: string | null, companyWide = false) => {
      const [row] = await db
        .insert(s.invoices)
        .values({ date: "2026-11-20", supplier, category: "Hammadde & İçecek", needsReview: true, branchId, companyWide })
        .returning({ id: s.invoices.id });
      await db.insert(s.parasutBillLines).values({ invoiceId: row.id, externalId: `kalem-${row.id}`, productKey: `urun-${supplier}`, productName: `${supplier} ürünü`, quantity: 1, netTotal: 10 });
      return row.id;
    };
    await invoice(`${MARK} Tedarik`, "tuzla");
    await invoice("Marina Tedarik", "marina");
    await invoice("Ortak Tedarik", null, true);
    await invoice("Şubesiz Tedarik", null);

    // Personel istekleri: Tuzla'nın ve Marina'nın geç kasa raporu (şube yükte)
    const late = (by: number, name: string, branchId: string, day: string) =>
      db.insert(s.staffRequests).values({ kind: "kasa-gec", subject: `gec:${day}:${branchId}`, day, title: `${name} geç rapor`, payload: { branchId }, requestedBy: by, requestedByName: name });
    await late(ids.tuzlaci, MARK, "tuzla", "2026-11-18");
    await late(ids.ayse, "Ayşe", "marina", "2026-11-19");

    // Reçete önerileri: Tuzla personelinin, Marina personelinin, yöneticinin (şubesiz)
    const category = (await db.insert(s.categories).values({ name: "Kahve" }).returning({ id: s.categories.id }))[0].id;
    const proposal = (by: number, name: string) =>
      db.insert(s.recipeChangeRequests).values({
        kind: "new",
        proposed: { name: `${name} Latte`, size: "M", categoryId: category },
        requestedBy: by,
        requestedByName: name,
        before: { note: null, items: [] },
        after: { note: null, items: [] },
      });
    await proposal(ids.tuzlaci, MARK);
    await proposal(ids.ayse, "Ayşe");
    await proposal(ids.ali, "Ali");

    // Teslim: Tuzla'nın ilk teslimi Ekim'de, Marina'nınki Kasım'da
    await db.insert(s.cashOuts).values({ date: "2026-10-03", branchId: "tuzla", amount: 777, kind: "teslim", store: MARK, createdByName: MARK });
    await db.insert(s.cashOuts).values({ date: "2026-11-05", branchId: "marina", amount: 500, kind: "teslim", store: "Banka", createdByName: "Ayşe" });

    // Paraşüt eşitlemesi: Tuzla'nın hesabı hatalı; Marina'nın hesabının çalışması başarılı. Bu veritabanında Marina'nın kendi
    // Paraşüt ayarı yok: Tuzla'nın hesabını kullanır (ortak hesap, zilde "hesap geneli")
    await db.insert(s.parasutSyncRuns).values({ trigger: "cron", account: "tuzla", status: "error", message: "Hesap hatası", startedAt: new Date("2026-11-27T05:00:00Z") });
    await db.insert(s.parasutSyncRuns).values({ trigger: "cron", account: "marina", status: "ok", startedAt: new Date("2026-11-27T04:00:00Z") });

    dal = await import("../src/server/auth/dal");
    scope = await import("../src/server/branch-scope");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Yönetici oturumu; seçicide `secim` */
  const signIn = async (secim: string) => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids.ali));
    await dal.startSession(u);
    jar.set(BRANCH_COOKIE, secim);
  };
  const inScope = <T>(b: string, fn: () => Promise<T>) => scope.withBranchScope(b, fn);
  const leaks = (v: unknown) => JSON.stringify(v).includes(MARK);

  test("faturalar: kontrol bekleyen ve eşlenmemiş ürün sayısı şubenin ve işletme genelinin; Tümü'de hepsi", async () => {
    const { countUnlinkedProducts } = await import("../src/server/parasut/sync");
    const { countStockOnlyReview } = await import("../src/server/data/stock-only-invoices");
    assert.equal(await countUnlinkedProducts(ALL_BRANCHES), 4);
    assert.equal(await countUnlinkedProducts("marina"), 2, "Marina + işletme geneli; Tuzla'nın ve şubesizin kalemi yok");
    assert.equal(await countUnlinkedProducts("tuzla"), 2);
    // Kalemi hammaddeye bağlı komisyon faturası yok: sayı sıfır ama sorgu kapsamla çalışır
    assert.equal(await countStockOnlyReview(db, "marina"), 0);
    const { unlinkedProducts } = await import("../src/server/parasut/sync");
    const list = await unlinkedProducts(40, "marina");
    assert.equal(leaks(list), false, "Marina'nın Paraşüt listesinde Tuzla'nın ürünü yok");
  });

  test("zil: Marina seçiliyken faturaların sayısı ve eşitleme satırı Marina'nın; Tümü'de Tuzla'nın hatası görünür", async () => {
    const { loadPanelNotifications } = await import("../src/server/actions/notifications");
    await signIn("marina");
    const marina = await loadPanelNotifications();
    const review = marina.find((n) => n.id.startsWith("fatura-kontrol-"));
    assert.equal(review?.title, "2 fatura kontrol bekliyor", "Marina + işletme geneli");
    assert.equal(marina.find((n) => n.id.startsWith("fatura-urun-"))?.title, "2 ürün hammaddeye bağlanmayı bekliyor");
    // Marina'nın hesabı Tuzla'nınkiyle ortak: eşitleme hesabındır, başlık bunu söyler
    assert.ok(marina.some((n) => n.title === "Paraşüt eşitlemesi başarısız (hesap geneli)"));
    assert.equal(leaks(marina), false);
    await signIn(ALL_BRANCHES);
    const all = await loadPanelNotifications();
    assert.equal(all.find((n) => n.id.startsWith("fatura-kontrol-"))?.title, "4 fatura kontrol bekliyor");
    assert.ok(all.some((n) => n.title === "Paraşüt eşitlemesi başarısız"), "Tümü'de etiketsiz");
    assert.ok(all.some((n) => n.title.includes(`${MARK} Latte`)), "Tümü'de Tuzla personelinin önerisi");
    // Ayrı hesapta yalnız o hesabın çalışması okunur
    const { latestParasutRun } = await import("../src/server/jobs/runs");
    assert.equal((await latestParasutRun(db, ["marina"]))?.status, "ok");
    assert.equal((await latestParasutRun(db))?.status, "error");
    assert.equal(await latestParasutRun(db, []), null);
  });

  test("onaylar: personel istekleri ve reçete önerileri şubeye göre (şubesi bilinmeyen her yerde)", async () => {
    const { pendingByKindInScope } = await import("../src/server/staff-requests/branch");
    const { countPendingRequests, countPendingByKind, loadReviewQueue, pendingByProduct } = await import("../src/server/data/recipe-requests");
    assert.deepEqual((await pendingByKindInScope(db, ALL_BRANCHES)).map((r) => [r.kind, r.count]), [["kasa-gec", 2]]);
    assert.deepEqual((await pendingByKindInScope(db, "marina")).map((r) => [r.kind, r.count]), [["kasa-gec", 1]]);
    assert.deepEqual(await pendingByKindInScope(db, "online"), []);
    assert.equal(await countPendingRequests(ALL_BRANCHES), 3);
    assert.equal(await countPendingRequests("marina"), 2, "Ayşe'ninki ve şubesiz yöneticininki");
    assert.deepEqual(await countPendingByKind("tuzla"), { change: 0, new: 2 });
    const queue = await loadReviewQueue(30, "marina");
    assert.deepEqual(queue.pending.map((r) => r.requestedByName).sort(), ["Ali", "Ayşe"]);
    assert.equal(leaks(queue), false);
    assert.equal((await pendingByProduct("marina")).size, 0);
  });

  test("Bugün: Marina seçiliyken sayılar Marina'nın; online kanalda kasa ve stok yok", async () => {
    const { loadToday } = await import("../src/server/data/today");
    const { dayTasks } = await import("../src/app/panel/bugun/logic");
    await signIn("marina");
    const user = (await dal.getCurrentUser())!;
    const today = await loadToday(user);
    assert.equal(today.facts.invoices?.review, 2);
    assert.equal(today.facts.unlinked, 2);
    assert.equal(today.facts.approvals?.newProducts, 2);
    assert.deepEqual(today.facts.approvals?.requests, [{ kind: "kasa-gec", count: 1 }]);
    assert.equal(leaks(today.facts.approvals), false);
    assert.equal(today.facts.channel, null);
    await signIn("online");
    const channel = await loadToday(user);
    assert.equal(channel.facts.channel, "laffogato.net");
    assert.equal(channel.facts.cash, null);
    assert.equal(channel.facts.stock, null);
    const keys = dayTasks(channel.facts).map((t) => t.key);
    assert.ok(keys.includes("kanal"));
    assert.equal(keys.some((k) => k === "kasa" || k === "kasa-dun" || k.startsWith("kasa:") || k.startsWith("sayim-")), false, keys.join(","));
  });

  test("kasa listeleri ve vardiya hatırlatması: online kanalda yok", async () => {
    const { loadTillScopes } = await import("../src/server/data/till-scope");
    const { vardiyaBell } = await import("../src/server/bell/vardiya");
    assert.deepEqual(await inScope("online", () => loadTillScopes(db)), []);
    assert.deepEqual((await inScope("marina", () => loadTillScopes(db))).map((t) => t.branchId), ["marina"]);
    // Cuma akşamı: gelecek haftanın planı iki şubede de yok
    const friday = new Date("2026-11-27T17:00:00Z");
    assert.equal((await vardiyaBell(ALL_BRANCHES, friday)).length, 2);
    assert.equal((await vardiyaBell("marina", friday)).length, 1);
    assert.deepEqual(await vardiyaBell("online", friday), [], "kanalın vardiyası yok");
  });

  test("kişi seçicileri ve teslim defteri: seçili şubenin ve şubesizlerin", async () => {
    const { assignablePeople } = await import("../src/server/data/user-reminders");
    const { handoverFirstDate } = await import("../src/server/data/handover-ledger");
    assert.deepEqual((await assignablePeople(ids.ali, "marina")).map((p) => p.name), ["Ayşe Marina"]);
    assert.equal((await assignablePeople(ids.ali, ALL_BRANCHES)).length, 2);
    assert.equal(await inScope("marina", () => handoverFirstDate()), "2026-11-05");
    assert.equal(await inScope(ALL_BRANCHES, () => handoverFirstDate()), "2026-10-03");
  });

  test("raporlar: kaçak raporu yalnız Marina'da ya da Tümü'de; kayıp önleme seçili şubenin, kanalda yok", async () => {
    const { loadLeakReport } = await import("../src/server/data/kacak");
    const { loadLossSummary } = await import("../src/server/data/kayip-onleme");
    await signIn("tuzla");
    const leak = await loadLeakReport("2026-10", new Date("2026-11-27T12:00:00Z"));
    assert.equal(leak.state, "baska-sube");
    assert.equal(leak.selectedName, "Tuzla");
    assert.equal(STOCK_ESTIMATE_OTHER_BRANCH, "Bu şube için tahmini stok yok");
    await signIn("marina");
    assert.notEqual((await loadLeakReport("2026-10", new Date("2026-11-27T12:00:00Z"))).state, "baska-sube");
    const now = new Date("2026-11-27T12:00:00Z");
    assert.deepEqual((await loadLossSummary("2026-11", 1, now))?.branches.map((b) => b.id), ["marina"]);
    await signIn(ALL_BRANCHES);
    assert.deepEqual((await loadLossSummary("2026-11", 1, now))?.branches.map((b) => b.id), ["tuzla", "marina"]);
    await signIn("online");
    assert.equal(await loadLossSummary("2026-11", 1, now), null);
  });
});
