// Müdür ve Muhasebeci rolleri, gerçek Postgres'te (docs/ROLLER.md): veritabanı kısıtları (bilinmeyen rol, şubesiz
// müdür), müdürün şube kilidi (seçici, işletme geneli okuma, öteki şubenin isteğine karar, öteki şubeye yazım; şubesi
// pasife alınınca oturumu yok), muhasebecinin salt okunurluğu (sunucu eylemlerinin HEPSİ "salt okunur" diye reddeder ve
// veritabanında hiçbir satır değişmez; eylem dışında ana ekranına yönlenir), canlı uç (/api/canli; muhasebeciye saha
// verisi gitmez, müdüre yalnız şubesininki), şube kurulumu (e-posta müdür ya da muhasebeci hesabına gitmez). Oturum gerçek
// src/server/auth/dal.ts'le, çerezler ve istek başlıkları taklit edilerek.
//
// ROLLER_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: ROLLER_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/roller-db.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { BRANCH_COOKIE, BRANCH_EMAIL_TAKEN, DEFAULT_BRANCHES } from "../src/lib/branches";
import type { CashReportFields } from "../src/lib/cash-report";
import type { LiveResponse } from "../src/lib/live";
import { addDays, todayTR } from "../src/lib/reminders";
import { cashAudience, READ_ONLY_TEXT } from "../src/lib/roles";
import { STAFF_EMAIL_ERROR } from "../src/lib/staff-errors";
import * as s from "../src/server/db/schema";
import { allActionGates } from "./helpers/action-gates";

const SERVER_URL = process.env.ROLLER_TEST_DATABASE_URL;
const DB_NAME = `laffogato_roller_${process.pid}`;
const SECRET = "roller-testi-icin-en-az-otuz-iki-karakterlik-anahtar-0001";
const DAY = "2099-03-10";

/** Tarayıcının çerez kutusu: dal.ts cookies() ile bunu okur ve yazar */
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

type Key = "ali" | "mehmet" | "zeynep" | "ayse";
const BASE: Record<Key, { name: string; email: string; role: "admin" | "manager" | "accountant" | "staff"; branchId: string | null }> = {
  ali: { name: "Ali", email: "ali@ornek.com", role: "admin", branchId: null },
  mehmet: { name: "Mehmet", email: "mehmet@ornek.com", role: "manager", branchId: "tuzla" },
  zeynep: { name: "Zeynep", email: "zeynep@ornek.com", role: "accountant", branchId: null },
  ayse: { name: "Ayşe", email: "ayse@ornek.com", role: "staff", branchId: "marina" },
};

/**
 * Muhasebecide de geçen eylemler (tests/roller.test.ts › OWN_OR_READ ve oturumsuz uçlar): kendi hesabı, salt okuma,
 * giriş / çıkış. Toplu taramada çağrılmaz (çıkış oturumu kapatır, giriş başka hesaba geçer)
 */
const SKIP = new Set([
  "loginAction",
  "verifyLoginCodeAction",
  "cancelLoginCodeAction",
  "logoutAction",
  "setPasswordWithToken",
  "requestPasswordReset",
  "approveConnection",
  "denyConnection",
  "loadPanelNotifications",
  "changePasswordAction",
  "updateProfile",
  "signOutOtherSessions",
  "beginTotpSetup",
  "confirmTotpSetup",
  "cancelTotpSetup",
  "disableTotp",
  "regenerateRecoveryCodes",
  "savePushSubscription",
  "deletePushSubscription",
  "setPushTopics",
  "sendTestPush",
  "chooseBranchScope",
  "cashReportWhatsapp",
]);

describe("Müdür ve Muhasebeci: veritabanında", { skip: !SERVER_URL && "ROLLER_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let scope: typeof import("../src/server/branch-scope");
  let closed: typeof import("../src/server/actions/closed-days");
  let waste: typeof import("../src/server/actions/waste");
  let settings: typeof import("../src/server/actions/settings");
  let reqBranch: typeof import("../src/server/staff-requests/branch");
  let NextRequestCtor: typeof import("next/server").NextRequest;
  let jar = new Jar();
  /** İsteğin başlıkları: sunucu eyleminde `Next-Action` var */
  let reqHeaders = new Headers();
  const ids = {} as Record<Key, number>;
  /** Marina'nın ve Tuzla'nın bekleyen "kafe kapalıydı" bildirimi */
  const req = { marina: 0, tuzla: 0 };

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET, ADMIN_2FA_OPTIONAL: "1" });
    delete process.env.RESEND_API_KEY;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => reqHeaders });
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
    // Canlı uç (route handler) istek dışında: connection() beklemez, after() işleri (karaoke tazeleme, e-postalar) koşmaz
    const nextServer = require("next/server") as typeof import("next/server");
    NextRequestCtor = nextServer.NextRequest;
    stub("next/server", { ...nextServer, connection: async () => {}, after: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    for (const b of DEFAULT_BRANCHES) await db.insert(s.branches).values({ ...b, active: true }).onConflictDoUpdate({ target: s.branches.id, set: { active: true } });
    for (const k of Object.keys(BASE) as Key[]) {
      const [row] = await db.insert(s.users).values({ ...BASE[k], passwordHash: "x" }).returning({ id: s.users.id });
      ids[k] = row.id;
    }
    for (const b of ["marina", "tuzla"] as const) {
      const [r] = await db
        .insert(s.staffRequests)
        .values({ kind: "kapali-gun", subject: `gun:${DAY}:${b}`, day: DAY, title: "Kafe kapalıydı", payload: { date: DAY, reason: null, branchId: b }, requestedBy: ids.ayse, requestedByName: "Ayşe" })
        .returning({ id: s.staffRequests.id });
      req[b] = r.id;
    }
    dal = await import("../src/server/auth/dal");
    scope = await import("../src/server/branch-scope");
    closed = await import("../src/server/actions/closed-days");
    waste = await import("../src/server/actions/waste");
    settings = await import("../src/server/actions/settings");
    reqBranch = await import("../src/server/staff-requests/branch");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    reqHeaders = new Headers();
    await db.update(s.branches).set({ active: true });
  });

  /** Bu tarayıcıda (yeni çerez kutusu) oturum */
  const signIn = async (k: Key) => {
    jar = new Jar();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, ids[k]));
    await dal.startSession(u);
  };
  /** Sunucu eylemi isteği (refuse muhasebeciyi yönlendirmez, "salt okunur" hatasıyla döndürür) */
  const asAction = () => {
    reqHeaders = new Headers({ "next-action": "test" });
  };
  /** Veritabanı kısıtının adı (drizzle hatayı sarar; asıl hata cause'ta) */
  const violates = (name: string) => (e: unknown) => (e as { cause?: { constraint_name?: string } })?.cause?.constraint_name === name;
  /** Eylem "salt okunur" diye döndü ya da fırlattı */
  const readOnly = async (p: Promise<unknown>) => {
    try {
      assert.deepEqual(await p, { ok: false, error: READ_ONLY_TEXT });
    } catch (e) {
      if (e instanceof assert.AssertionError) throw e;
      assert.equal((e as Error)?.message, READ_ONLY_TEXT);
    }
  };
  const status = async (id: number) => (await db.select({ st: s.staffRequests.status }).from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0].st;

  /** Veritabanının bütün tablolarının içeriğinin özeti (salt okunur hesap hiçbir satırı değiştirmemeli) */
  async function fingerprint(): Promise<Map<string, string>> {
    const tables = (await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)) as unknown as { tablename: string }[];
    const out = new Map<string, string>();
    for (const { tablename } of tables) {
      const [row] = (await db.execute(sql.raw(`SELECT count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${tablename}" t`))) as unknown as { h: string }[];
      out.set(tablename, row.h);
    }
    return out;
  }

  test("kısıtlar: bilinmeyen rol ve şubesiz müdür veritabanına yazılmaz", async () => {
    await assert.rejects(db.insert(s.users).values({ name: "X", email: "x1@ornek.com", passwordHash: "x", role: "patron" as never }), violates("users_role_ck"));
    await assert.rejects(db.insert(s.users).values({ name: "X", email: "x2@ornek.com", passwordHash: "x", role: "manager", branchId: null }), violates("users_manager_branch_ck"));
    await assert.rejects(db.update(s.users).set({ branchId: null }).where(eq(s.users.id, ids.mehmet)), violates("users_manager_branch_ck"));
    // Muhasebeciye şube yazılsa da oturumda şubesi yok (kilitlenmez, bütün şubeleri görür)
    await db.update(s.users).set({ branchId: "tuzla" }).where(eq(s.users.id, ids.zeynep));
    await signIn("zeynep");
    assert.equal((await dal.getCurrentUser())?.branchId, null);
    await db.update(s.users).set({ branchId: null }).where(eq(s.users.id, ids.zeynep));
  });

  describe("müdür öteki şubeyi göremez", () => {
    test("seçici ve işletme geneli okumalar şubesine daralır", async () => {
      await signIn("mehmet");
      const me = await dal.getCurrentUser();
      assert.deepEqual(me && { role: me.role, branchId: me.branchId }, { role: "manager", branchId: "tuzla" });
      const st = await scope.branchScope("marina");
      assert.deepEqual([st.scope, st.locked], ["tuzla", true], "adresteki ?sube=marina yok sayılır");
      assert.equal(await scope.withBranchScope("hepsi", () => scope.currentBranchScope()), "tuzla", "işletme geneli okuma şubesine daralır");
      assert.equal(await scope.withBranchScope("marina", () => scope.currentBranchScope()), "tuzla", "öteki şubenin okuması da");
      assert.ok(await scope.staffBranchRefusal(me!, "marina"), "öteki şubenin kaydı reddedilir");
      assert.equal(await scope.staffBranchRefusal(me!, "tuzla"), null);
      // Yönetici serbest (kıyas için)
      await signIn("ali");
      assert.equal(await scope.withBranchScope("hepsi", () => scope.currentBranchScope()), "hepsi");
    });

    test("öteki şubenin isteğine karar veremez, kendi şubesininkine verir", async () => {
      await signIn("mehmet");
      asAction();
      const me = (await dal.getCurrentUser())!;
      assert.equal(await reqBranch.reviewBranchRefusal(db, me, req.marina), reqBranch.OTHER_BRANCH_REVIEW);
      assert.equal(await reqBranch.reviewBranchRefusal(db, me, req.tuzla), null);
      const r = await closed.reviewClosedDay({ id: req.marina, seenVersion: 1, decision: "reject", note: null });
      assert.deepEqual(r, { ok: false, error: reqBranch.OTHER_BRANCH_REVIEW });
      assert.equal(await status(req.marina), "pending", "Marina'nın isteği değişmedi");
      const ok = await closed.reviewClosedDay({ id: req.tuzla, seenVersion: 1, decision: "reject", note: "Açıktık" });
      assert.equal(ok.ok, true, JSON.stringify(ok));
      assert.equal(await status(req.tuzla), "rejected");
    });

    test("öteki şubeye yazamaz; yönetimin eylemleri kapalı", async () => {
      await signIn("mehmet");
      asAction();
      const r = await closed.markClosedDay({ date: DAY, note: null, branchId: "marina" });
      assert.deepEqual(r, { ok: false, error: "Hesabınız Tuzla şubesinde; Marina kasasına yazamazsınız" }, "Marina'nın günü işaretlenmez");
      const w = await waste.addWasteEntry({ date: DAY, kind: "zayi", productId: null, ingredientId: 1, qty: 1, reason: null, note: null, clientKey: "roller-zayi-0001", branchId: "marina" });
      assert.deepEqual(w, { ok: false, error: "Hesabınız Tuzla şubesinde; Marina zayisine yazamazsınız" }, "Marina'ya zayi yazılmaz");
      // Kullanıcı yönetimi yalnız yöneticinin: müdür kendi ana ekranına yönlenir
      await assert.rejects(
        settings.saveUser({ id: ids.ayse, name: "Ayşe", email: "ayse@ornek.com", role: "admin", active: true, branchId: null, seen: { ...BASE.ayse, active: true } }),
        (e: { to?: string }) => e.to === "/panel/bugun",
      );
      assert.equal((await db.select({ role: s.users.role }).from(s.users).where(eq(s.users.id, ids.ayse)))[0].role, "staff");
    });

    test("tedarikçi ödemesine bağlı kasadan çıkanı düzeltemez ve silemez (cari yalnız yöneticinin; tedarikçi adı da gitmez)", async () => {
      const outs = await import("../src/server/actions/cash-outs");
      const { CARI_LOCKED_STAFF } = await import("../src/server/cari/kasa");
      const date = "2026-01-05";
      const [row] = await db.insert(s.cashOuts).values({ date, kind: "teslim", amount: 300, branchId: "tuzla", createdBy: ids.ali, createdByName: "Ali" }).returning({ id: s.cashOuts.id });
      const [sup] = await db.insert(s.suppliers).values({ name: "Gizli Tedarikçi", key: "gizli-tedarikci-roller" }).returning({ id: s.suppliers.id });
      const [pay] = await db
        .insert(s.supplierEntries)
        .values({ supplierId: sup.id, kind: "odeme", date, amount: 300, method: "kasa", cashOutId: row.id, createdByName: "Ali" })
        .returning({ id: s.supplierEntries.id });
      try {
        await signIn("mehmet");
        asAction();
        const line = { id: row.id, date: "2026-01-06", kind: "teslim" as const, amount: 350, store: null, description: null, receiptDate: null, receiptNo: null, vat: null, docType: "yok" as const, categoryId: null, toExpenses: false, photoId: null, branchId: "tuzla" };
        assert.deepEqual(await outs.saveCashOut(line), { ok: false, error: CARI_LOCKED_STAFF });
        assert.deepEqual(await outs.deleteCashOut(row.id), { ok: false, error: CARI_LOCKED_STAFF }, "silme yanıtı tedarikçinin adını ve gününü söylemez");
        const [p] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, pay.id));
        assert.deepEqual([p.amount, p.date], [300, date], "tedarikçi ödemesi değişmedi");
        const [o] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, row.id));
        assert.deepEqual([o.amount, o.date], [300, date], "satır değişmedi");
      } finally {
        await db.delete(s.supplierEntries).where(eq(s.supplierEntries.id, pay.id));
        await db.delete(s.suppliers).where(eq(s.suppliers.id, sup.id));
        await db.delete(s.cashOuts).where(eq(s.cashOuts.id, row.id));
      }
    });

    test("yöneticinin kategorisindeki (maaş) kasadan çıkanı düzeltemez, personelin kategorisine taşıyamaz, silemez; personelinkini düzeltir", async () => {
      const outs = await import("../src/server/actions/cash-outs");
      const { CASH_OUT_REQUEST_TEXT } = await import("../src/lib/cash-out-requests");
      const date = "2026-01-07";
      const cats = await db
        .insert(s.expenseCategories)
        .values([
          { name: "Maaş (müdür kilidi)", section: "personel", panelGroup: "personel" },
          { name: "Market (müdür kilidi)", section: "mal", panelGroup: "diger" },
        ])
        .returning({ id: s.expenseCategories.id });
      const [salaryCat, staffCat] = cats.map((c) => c.id);
      const rows = await db
        .insert(s.cashOuts)
        .values([
          { date, kind: "harcama", amount: 5_000, description: "Avans", branchId: "tuzla", createdBy: ids.ali, createdByName: "Ali" },
          { date, kind: "harcama", amount: 40, store: "Bim", branchId: "tuzla", createdBy: ids.ali, createdByName: "Ali" },
        ])
        .returning({ id: s.cashOuts.id });
      const [salary, plain] = rows.map((r) => r.id);
      await db.insert(s.expenseEntries).values([
        { branchId: "tuzla", date, categoryId: salaryCat, description: "Avans", amount: 5_000, cashOutId: salary },
        { branchId: "tuzla", date, categoryId: staffCat, description: "Bim", amount: 40, cashOutId: plain },
      ]);
      const line = (id: number, o: { amount: number; categoryId: number | null; kind?: "harcama" | "teslim" }) => ({
        id,
        date,
        kind: o.kind ?? ("harcama" as const),
        amount: o.amount,
        store: null,
        description: "Avans",
        receiptDate: null,
        receiptNo: null,
        vat: null,
        docType: "yok" as const,
        categoryId: o.categoryId,
        toExpenses: o.categoryId !== null,
        photoId: null,
        branchId: "tuzla",
      });
      const state = async (id: number) => {
        const [o] = await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, id));
        const [e] = await db.select().from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, id));
        return [o?.kind, o?.amount, e?.categoryId, e?.amount];
      };
      try {
        await signIn("mehmet");
        asAction();
        const refused = { ok: false, error: CASH_OUT_REQUEST_TEXT.ownerRow };
        assert.deepEqual(await outs.saveCashOut(line(salary, { amount: 5_500, categoryId: salaryCat })), refused, "tutarı düzeltemez");
        assert.deepEqual(await outs.saveCashOut(line(salary, { amount: 5_000, categoryId: staffCat })), refused, "personelin kategorisine taşıyamaz");
        assert.deepEqual(await outs.saveCashOut(line(salary, { amount: 5_000, categoryId: null, kind: "teslim" })), refused, "teslime çevirip kaydı kaldıramaz");
        assert.deepEqual(await outs.deleteCashOut(salary), refused, "silemez");
        assert.deepEqual(await state(salary), ["harcama", 5_000, salaryCat, 5_000], "satır ve maaş kaydı değişmedi");
        // Personelin kategorisindeki satırı doğrudan düzeltir ve siler (kıyas)
        assert.equal((await outs.saveCashOut(line(plain, { amount: 45, categoryId: staffCat }))).ok, true);
        assert.deepEqual(await state(plain), ["harcama", 45, staffCat, 45]);
        assert.equal((await outs.deleteCashOut(plain)).ok, true);
        assert.deepEqual(await state(plain), [undefined, undefined, undefined, undefined]);
        // Yönetici düzeltir
        await signIn("ali");
        asAction();
        assert.equal((await outs.saveCashOut(line(salary, { amount: 5_500, categoryId: salaryCat }))).ok, true);
        assert.deepEqual(await state(salary), ["harcama", 5_500, salaryCat, 5_500]);
      } finally {
        await db.delete(s.expenseEntries).where(inArray(s.expenseEntries.cashOutId, [salary, plain]));
        await db.delete(s.cashOuts).where(inArray(s.cashOuts.id, [salary, plain]));
        await db.delete(s.expenseCategories).where(inArray(s.expenseCategories.id, [salaryCat, staffCat]));
      }
    });

    test("Kasa ay görünümü: pencereye giden kasadan çıkanda maaş kategorisinin adı ve metni yok, tutarı var; öteki şubenin satırı yok (bulgu 8)", async () => {
      const { cashOutsBetween, cashOutsShownTo } = await import("../src/server/data/cash-outs");
      const { sheetCashOutsByDate } = await import("../src/lib/cash-outs");
      const [cat] = await db.insert(s.expenseCategories).values({ name: "Maaş (roller testi)", section: "personel", panelGroup: "personel" }).returning({ id: s.expenseCategories.id });
      const outs = await db
        .insert(s.cashOuts)
        .values([
          { date: DAY, kind: "harcama", amount: 15_000, description: "Kasım ödemesi", branchId: "tuzla", createdBy: ids.ali, createdByName: "Ali" },
          { date: DAY, kind: "harcama", amount: 77, store: "Marina dükkân", branchId: "marina", createdBy: ids.ali, createdByName: "Ali" },
        ])
        .returning({ id: s.cashOuts.id });
      const [entry] = await db
        .insert(s.expenseEntries)
        .values({ branchId: "tuzla", date: DAY, categoryId: cat.id, description: "Kasım ödemesi", amount: 15_000, cashOutId: outs[0].id })
        .returning({ id: s.expenseEntries.id });
      try {
        await signIn("mehmet");
        // Sayfanın okuduğu bütün satır kategoriyi taşır; tarayıcıya giden pencere satırı taşımaz
        const rows = await scope.withBranchScope("hepsi", () => cashOutsBetween(DAY, DAY));
        assert.deepEqual(
          rows.map((r) => [r.id, r.categoryName]),
          [[outs[0].id, "Maaş (roller testi)"]],
          "müdürün okuması şubesine daralır",
        );
        // Sayfa satırları okuyanın rolüyle süzer (cashOutsShownTo): müdüre maaş satırının yalnız tutarı
        const sent = sheetCashOutsByDate(await cashOutsShownTo("manager", rows));
        assert.deepEqual(sent, { [DAY]: [{ id: outs[0].id, kind: "harcama", amount: 15_000, store: null, description: null, photoId: null }] });
        assert.doesNotMatch(JSON.stringify(sent), /Maaş|Kasım ödemesi|categoryName|categoryId|expenseEntryId|createdBy|Marina/);
      } finally {
        await db.delete(s.expenseEntries).where(eq(s.expenseEntries.id, entry.id));
        for (const o of outs) await db.delete(s.cashOuts).where(eq(s.cashOuts.id, o.id));
        await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, cat.id));
      }
    });

    test("yöneticinin kategorisindeki satırın yeri, açıklaması ve fişi müdüre gitmez: Kasa'nın gün ve ay görünümü, WhatsApp metni, fiş fotoğrafı", async () => {
      const { cashOutsOn, cashOutsShownTo } = await import("../src/server/data/cash-outs");
      const { sheetCashOutsByDate } = await import("../src/lib/cash-outs");
      const { cashReportExtras, extrasFrom } = await import("../src/server/data/cash-photos");
      const { canViewPhoto } = await import("../src/server/storage/photo-access");
      const { getPhoto } = await import("../src/server/storage/photos");
      const store = await import("../src/server/cash/report-store");
      const reportActions = await import("../src/server/actions/cash-report");
      const date = "2026-01-09";
      // Serbest metin kişinin adını ve ücretini taşır: müdüre hiçbir yoldan gitmemeli
      const SECRETS = /Selin Yıldız|Kasım avansı|AV-0042/;
      const cats = await db
        .insert(s.expenseCategories)
        .values([
          { name: "Avans (metin testi)", section: "personel", panelGroup: "personel" },
          { name: "Market (metin testi)", section: "mal", panelGroup: "diger" },
        ])
        .returning({ id: s.expenseCategories.id });
      const [salaryCat, staffCat] = cats.map((c) => c.id);
      const photos = await db
        .insert(s.photos)
        .values(
          ["avans", "market"].map((k) => ({
            kind: "fis" as const,
            storageKey: `fis/2026/metin-${k}.jpg`,
            contentType: "image/jpeg",
            sizeBytes: 100,
            createdBy: ids.ali,
            createdByName: "Ali",
            linkedAt: new Date(),
          })),
        )
        .returning({ id: s.photos.id });
      const [salaryPhoto, staffPhoto] = photos.map((p) => p.id);
      const rows = await db
        .insert(s.cashOuts)
        .values([
          { date, kind: "harcama", amount: 5_000, store: "Selin Yıldız", description: "Kasım avansı", receiptNo: "AV-0042", docType: "fis", photoId: salaryPhoto, branchId: "tuzla", createdBy: ids.ali, createdByName: "Ali" },
          { date, kind: "harcama", amount: 40, store: "Bim", description: "buz", docType: "fis", photoId: staffPhoto, branchId: "tuzla", createdBy: ids.ali, createdByName: "Ali" },
        ])
        .returning({ id: s.cashOuts.id });
      const [salary, plain] = rows.map((r) => r.id);
      await db.insert(s.expenseEntries).values([
        { branchId: "tuzla", date, categoryId: salaryCat, description: "Kasım avansı", amount: 5_000, cashOutId: salary },
        { branchId: "tuzla", date, categoryId: staffCat, description: "Bim", amount: 40, cashOutId: plain },
      ]);
      const fields: CashReportFields & { discounts: number | null } = {
        date,
        zNo: null,
        receipts: null,
        zTotal: 10_000,
        cash: 3_000,
        card: 7_000,
        mealCard: 0,
        online: 0,
        other: 0,
        openingCash: 5_540,
        cashIn: 0,
        cashOut: 5_040,
        cashOutNote: null,
        countedCash: 3_500,
        handedOver: 2_400,
        bankPos: null,
        offRevenue: null,
        note: null,
        discounts: null,
      };
      let reportId = 0;
      try {
        await signIn("ali");
        const saved = await scope.withBranchScope("tuzla", () => store.saveCashReport(db, { id: ids.ali, name: "Ali", role: "admin" }, { ...fields, countedBy: null, revision: 0, photos: [] }));
        assert.equal(saved.kind, "saved");
        const report = saved.kind === "saved" ? saved.row : (null as never);
        reportId = report.id;

        // Gün ve ay görünümünün satırları (sayfa cashOutsShownTo ile kurar): maaş satırı yalnız türü ve tutarıyla
        await signIn("mehmet");
        const day = await cashOutsShownTo("manager", await cashOutsOn(date, "tuzla"));
        const shown = (id: number) => day.find((o) => o.id === id)!;
        assert.deepEqual(
          [shown(salary).kind, shown(salary).amount, shown(salary).store, shown(salary).description, shown(salary).receiptNo, shown(salary).photoId, shown(salary).categoryName],
          ["harcama", 5_000, null, null, null, null, null],
        );
        assert.deepEqual([shown(plain).store, shown(plain).description, shown(plain).photoId, shown(plain).categoryName], ["Bim", "buz", staffPhoto, "Market (metin testi)"], "personelin kategorisindeki satır olduğu gibi");
        const sheet = sheetCashOutsByDate(day);
        const extras = extrasFrom(undefined, day, report);
        assert.deepEqual(extras.cashOuts, [
          { kind: "harcama", amount: 5_000, store: null, description: null, photo: false },
          { kind: "harcama", amount: 40, store: "Bim", description: "buz", photo: true },
        ]);
        assert.doesNotMatch(JSON.stringify([day, sheet, extras]), SECRETS, "tarayıcıya giden satırlarda metin yok");
        // Yönetici ve muhasebeci bütün satırı görür; personel değişmedi (metnini düzeltme isteği açar)
        for (const role of ["admin", "accountant", "staff"] as const) {
          assert.match(JSON.stringify(await cashOutsShownTo(role, await cashOutsOn(date, "tuzla"))), /Selin Yıldız/, role);
        }

        // WhatsApp metni (eylem): müdüre "Harcama 5.000 ₺", yöneticiye satırın adıyla; e-postanın ekleri bütün satırla
        asAction();
        const mine = await reportActions.cashReportWhatsapp(date, "tuzla");
        assert.ok(mine.ok, mine.ok ? "" : mine.error);
        assert.doesNotMatch(mine.data.text, SECRETS);
        assert.match(mine.data.text, /Harcama 5\.000\s₺/);
        assert.match(mine.data.text, /Bim \(buz\) 40\s₺ 📷/);
        await signIn("ali");
        asAction();
        const owner = await reportActions.cashReportWhatsapp(date, "tuzla");
        assert.ok(owner.ok, owner.ok ? "" : owner.error);
        assert.match(owner.data.text, /Selin Yıldız \(Kasım avansı\) 5\.000\s₺ 📷/);
        assert.match(JSON.stringify((await cashReportExtras(report)).cashOuts), /Selin Yıldız/, "e-posta (yönetici ve muhasebe) bütün satırla");
        assert.doesNotMatch(JSON.stringify((await cashReportExtras(report, "manager")).cashOuts), SECRETS);

        // Fiş fotoğrafı (/api/foto'nun kuralı): müdür şubesinin personel satırının fişini görür, maaş satırınınkini görmez
        const userOf = async (k: Key) => {
          await signIn(k);
          return (await dal.getCurrentUser())!;
        };
        const [p1, p2] = [(await getPhoto(salaryPhoto))!, (await getPhoto(staffPhoto))!];
        const mehmet = await userOf("mehmet");
        assert.equal(await canViewPhoto(mehmet, p1), false, "müdür maaş satırının fişini görmez");
        assert.equal(await canViewPhoto(mehmet, p2), true, "müdür şubesinin personel satırının fişini görür");
        const ali = await userOf("ali");
        assert.equal(await canViewPhoto(ali, p1), true, "yönetici görür");
        const zeynep = await userOf("zeynep");
        assert.equal(await canViewPhoto(zeynep, p1), true, "muhasebeci görür (muhasebe kaydı)");
      } finally {
        await db.delete(s.expenseEntries).where(inArray(s.expenseEntries.cashOutId, [salary, plain]));
        await db.delete(s.cashOuts).where(inArray(s.cashOuts.id, [salary, plain]));
        if (reportId) await db.delete(s.cashReports).where(eq(s.cashReports.id, reportId));
        await db.delete(s.photos).where(inArray(s.photos.id, [salaryPhoto, staffPhoto]));
        await db.delete(s.expenseCategories).where(inArray(s.expenseCategories.id, [salaryCat, staffCat]));
      }
    });

    test("fiş okuması müdüre yöneticinin kategorisini önermez (yazımda reddedilirdi; bulgu 1)", async () => {
      const read = await import("../src/server/photo-read/read");
      // Kayıtlı yanıt (tests/fixtures/foto/fis-soluk.json) hep aynı kategoriyi seçer: o kategori bu testte yöneticinin
      // (reklam) olur, müdürün seçemediği
      const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "foto", "fis-soluk.json"), "utf8")) as { json: { categoryId: number } };
      const catId = fixture.json.categoryId;
      const [cat] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, catId));
      assert.ok(cat, "kayıtlı yanıtın kategorisi veritabanında var");
      const env = process.env as Record<string, string | undefined>;
      const saved = { NODE_ENV: env.NODE_ENV, AI_REPLAY: env.AI_REPLAY };
      const photoIds: number[] = [];
      /** Kişinin yüklediği fişi kayıtlı yanıtla okur (görsel tanınmasa da fişin yanıtı döner) */
      const readAs = async (k: Key) => {
        await signIn(k);
        const me = (await dal.getCurrentUser())!;
        const [p] = await db
          .insert(s.photos)
          .values({ kind: "fis", storageKey: `fis/2099/${k}-${photoIds.length}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: me.id, createdByName: me.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
          .returning({ id: s.photos.id });
        photoIds.push(p.id);
        const out = await read.readPhotoFor("fis", { photoId: p.id, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), contentType: "image/jpeg", day: DAY, me });
        assert.equal(out.readError, null, JSON.stringify(out));
        const reading = out.reading as import("../src/lib/photo-read/receipt").ReceiptReading;
        return { categoryId: reading.values.categoryId, confidence: reading.confidence.categoryId };
      };
      await db.update(s.expenseCategories).set({ section: "genel", panelGroup: "reklam" }).where(eq(s.expenseCategories.id, catId));
      Object.assign(env, { NODE_ENV: "development", AI_REPLAY: "1" });
      try {
        assert.deepEqual(await readAs("ali"), { categoryId: catId, confidence: "high" }, "yöneticiye modelin seçtiği kategori");
        const m = await readAs("mehmet");
        assert.notEqual(m.categoryId, catId, "müdüre yöneticinin kategorisi önerilmez");
        assert.equal(m.confidence, "low", "kategoriyi kendisi seçer");
        // Personel de (kıyas)
        assert.notEqual((await readAs("ayse")).categoryId, catId);
      } finally {
        Object.assign(env, saved);
        await db.update(s.expenseCategories).set({ section: cat.section, panelGroup: cat.panelGroup }).where(eq(s.expenseCategories.id, catId));
        await db.delete(s.aiCalls).where(inArray(s.aiCalls.photoId, photoIds));
        await db.delete(s.photos).where(inArray(s.photos.id, photoIds));
      }
    });

    test("fiş okumasının kopya denetimi müdüre öteki şubenin, işletme genelinin ve yöneticinin kategorisinin kayıtlarını okumaz", async () => {
      const read = await import("../src/server/photo-read/read");
      // Kayıtlı yanıt (tests/fixtures/foto/fis-soluk.json): MİGROS TİCARET A.Ş., 412,50 ₺, 21 Ekim 2026, fiş no 0045. Kasadan
      // çıkan fiş no ile, harcama kaydı mağaza adıyla eşleşir; uyarı eşleşen satırın adını, tutarını ve tarihini söyler
      const day = "2026-10-21";
      const env = process.env as Record<string, string | undefined>;
      const saved = { NODE_ENV: env.NODE_ENV, AI_REPLAY: env.AI_REPLAY };
      const photoIds: number[] = [];
      const outIds: number[] = [];
      const entryIds: number[] = [];
      /** Kişinin yüklediği fişin okumasındaki tekrar uyarısı (yoksa null) */
      const dupAs = async (k: Key): Promise<string | null> => {
        await signIn(k);
        const me = (await dal.getCurrentUser())!;
        const [p] = await db
          .insert(s.photos)
          .values({ kind: "fis", storageKey: `fis/2099/kopya-${k}-${photoIds.length}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: me.id, createdByName: me.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
          .returning({ id: s.photos.id });
        photoIds.push(p.id);
        const out = await read.readPhotoFor("fis", { photoId: p.id, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), contentType: "image/jpeg", day, me });
        const reading = out.reading as import("../src/lib/photo-read/receipt").ReceiptReading | null;
        assert.equal(reading?.ok, true, JSON.stringify(out));
        return reading!.checks.find((c) => c.text.startsWith("Bu fiş zaten eklenmiş olabilir"))?.text ?? null;
      };
      const addOut = async (branchId: string, store: string) => {
        const [o] = await db
          .insert(s.cashOuts)
          .values({ date: day, kind: "harcama", amount: 412.5, store, receiptNo: "0045", branchId, createdBy: ids.ali, createdByName: "Ali" })
          .returning({ id: s.cashOuts.id });
        outIds.push(o.id);
      };
      const addEntry = async (branchId: string | null, categoryId: number) => {
        const [e] = await db.insert(s.expenseEntries).values({ branchId, date: day, categoryId, description: "Migros", amount: 412.5 }).returning({ id: s.expenseEntries.id });
        entryIds.push(e.id);
      };
      const cats = await db
        .insert(s.expenseCategories)
        .values([
          { name: "Temizlik (kopya testi)", section: "genel", panelGroup: "diger" },
          { name: "Maaş (kopya testi)", section: "personel", panelGroup: "personel" },
        ])
        .returning({ id: s.expenseCategories.id });
      const [staffCat, salaryCat] = cats.map((c) => c.id);
      Object.assign(env, { NODE_ENV: "development", AI_REPLAY: "1" });
      try {
        assert.equal(await dupAs("mehmet"), null, "kayıt yokken uyarı yok");
        // Öteki şubenin kasadan çıkanı, işletme geneli harcama kaydı (personelin kategorisinde bile) ve müdürün şubesinde
        // yöneticinin kategorisindeki (maaş) kayıt
        await addOut("marina", "Marina dükkânı");
        await addEntry(null, staffCat);
        await addEntry("tuzla", salaryCat);
        assert.equal(await dupAs("mehmet"), null, "müdür öteki şubenin, işletme genelinin ve maaş kaydının tekrarını görmez");
        assert.match((await dupAs("ali")) ?? "", /^Bu fiş zaten eklenmiş olabilir: Marina dükkânı · 412,50/, "yönetici bütün şubeleri görür");
        // Kendi şubesinin personel kategorisindeki harcama kaydı ve kasadan çıkanı uyarır
        await addEntry("tuzla", staffCat);
        assert.match((await dupAs("mehmet")) ?? "", /^Bu fiş zaten eklenmiş olabilir: Migros · 412,50/, "şubesinin personel kategorisindeki kayıt");
        await addOut("tuzla", "Tuzla dükkânı");
        assert.match((await dupAs("mehmet")) ?? "", /^Bu fiş zaten eklenmiş olabilir: Tuzla dükkânı · 412,50/, "şubesinin kasadan çıkanı");
      } finally {
        Object.assign(env, saved);
        await db.delete(s.expenseEntries).where(inArray(s.expenseEntries.id, entryIds));
        await db.delete(s.cashOuts).where(inArray(s.cashOuts.id, outIds));
        await db.delete(s.expenseCategories).where(inArray(s.expenseCategories.id, [staffCat, salaryCat]));
        await db.delete(s.aiCalls).where(inArray(s.aiCalls.photoId, photoIds));
        await db.delete(s.photos).where(inArray(s.photos.id, photoIds));
      }
    });

    test("şubesi pasife alınan müdürün oturumu yok (öteki şubelere açılmaz)", async () => {
      await signIn("mehmet");
      assert.ok(await dal.getCurrentUser());
      await db.update(s.branches).set({ active: false }).where(eq(s.branches.id, "tuzla"));
      assert.equal(await dal.getCurrentUser(), null);
      // Personelde kilit kalkar (bugünkü kural), müdürde oturum düşer
      await db.update(s.branches).set({ active: true }).where(eq(s.branches.id, "tuzla"));
      assert.ok(await dal.getCurrentUser());
    });
  });

  describe("muhasebeci yazamaz", () => {
    test("seçili eylemler 'salt okunur' diye döner, kayıt değişmez", async () => {
      await signIn("zeynep");
      asAction();
      const before = await fingerprint();
      await readOnly(closed.reviewClosedDay({ id: req.marina, seenVersion: 1, decision: "approve", note: null }));
      await readOnly(closed.markClosedDay({ date: DAY, note: null, branchId: "tuzla" }));
      await readOnly(waste.addWasteEntry({ date: DAY, kind: "zayi", productId: null, ingredientId: 1, qty: 1, reason: null, note: null, clientKey: "roller-zayi-0002", branchId: "tuzla" }));
      // Kendini yönetici yapamaz
      await readOnly(settings.saveUser({ id: ids.zeynep, name: "Zeynep", email: "zeynep@ornek.com", role: "admin", active: true, branchId: null, seen: { ...BASE.zeynep, active: true } }));
      assert.deepEqual(await fingerprint(), before);
      assert.equal(await status(req.marina), "pending");
    });

    test("bütün sunucu eylemleri: her biri reddeder, veritabanında hiçbir satır değişmez", async () => {
      await signIn("zeynep");
      const before = await fingerprint();
      const gates = allActionGates(process.cwd()).filter((a) => !SKIP.has(a.name));
      assert.ok(gates.length > 250, `${gates.length} eylem`);
      const leaks: string[] = [];
      for (const a of gates) {
        asAction();
        const mod = (await import(`../${a.file}`)) as Record<string, unknown>;
        const fn = mod[a.name];
        if (typeof fn !== "function") {
          leaks.push(`${a.file} › ${a.name}: işlev değil`);
          continue;
        }
        try {
          // Girdi önemsiz: kapı girdiden önce
          const r = (await fn({}, {})) as { ok?: boolean; error?: string } | undefined;
          if (!(r && r.ok === false && r.error === READ_ONLY_TEXT)) leaks.push(`${a.file} › ${a.name}: ${JSON.stringify(r)?.slice(0, 120)}`);
        } catch (e) {
          if ((e as Error)?.message !== READ_ONLY_TEXT) leaks.push(`${a.file} › ${a.name}: ${(e as Error)?.message?.slice(0, 120)}`);
        }
      }
      assert.deepEqual(leaks, []);
      const after = await fingerprint();
      const changed = [...after].filter(([t, h]) => before.get(t) !== h).map(([t]) => t);
      assert.deepEqual(changed, [], "salt okunur hesap hiçbir tabloyu değiştirmedi");
    });

    test("eylem dışında (sayfa) yazma kapısı ana ekranına yönlendirir; okuma kapısı açık", async () => {
      await signIn("zeynep");
      await assert.rejects(dal.requireCan("kayit.yaz"), (e: { to?: string }) => e.to === "/panel/muhasebe");
      await assert.rejects(dal.requireAdmin(), (e: { to?: string }) => e.to === "/panel/muhasebe");
      assert.equal((await dal.requireCan("muhasebe.oku")).role, "accountant");
      assert.equal((await dal.requireCan("kasa.rakam")).role, "accountant");
      // Müdür muhasebeye giremez, yönlendirmesi Bugün
      await signIn("mehmet");
      await assert.rejects(dal.requireCan("muhasebe.oku"), (e: { to?: string }) => e.to === "/panel/bugun");
      await assert.rejects(dal.requireCan("maas"), (e: { to?: string }) => e.to === "/panel/bugun");
    });
  });

  describe("canlı uç (/api/canli): muhasebeci saha verisi almaz, müdür yalnız şubesininkini (bulgu 7)", () => {
    let route: typeof import("../src/app/api/canli/route");
    const rows = { session: 0, ask: 0 };
    const restoreFeatures = async () => {
      for (const b of DEFAULT_BRANCHES) await db.update(s.branches).set({ features: [...(b.features ?? [])] }).where(eq(s.branches.id, b.id));
    };

    before(async () => {
      // Site bağlı değilse (anahtar yok) liste ve çağrı herkese boş döner, test bir şey kanıtlamaz
      process.env.KARAOKE_SYNC_SECRET = "canli-uc-testi-icin-en-az-otuz-iki-karakterlik-anahtar-01";
      route = await import("../src/app/api/canli/route");
      const now = Date.now();
      const [k] = await db
        .insert(s.karaokeSessions)
        .values({
          source: "panel",
          date: todayTR(),
          startsAt: new Date(now + 3_600_000),
          endsAt: new Date(now + 3 * 3_600_000),
          customerName: "Deniz",
          guests: 4,
          status: "confirmed",
          paymentStatus: "none",
          createdBy: "Ayşe",
          totalMinor: 150_000,
        })
        .returning({ id: s.karaokeSessions.id });
      rows.session = k.id;
      const [a] = await db
        .insert(s.staffRequests)
        .values({ kind: "karaoke-sil", subject: `karaoke:${k.id}`, day: todayTR(), title: "Karaoke sayacı silme", payload: {}, requestedBy: ids.ayse, requestedByName: "Ayşe" })
        .returning({ id: s.staffRequests.id });
      rows.ask = a.id;
      const snapshot = { at: new Date(now).toISOString(), complete: true, skipped: 0, orders: [{ id: "o-1" }], calls: [{ id: "c-1", tableCode: "K7" }], callsSkipped: 0 };
      await db.insert(s.integrationState).values({ key: "site_orders", value: snapshot }).onConflictDoUpdate({ target: s.integrationState.key, set: { value: snapshot } });
    });

    after(async () => {
      if (!db) return;
      await db.delete(s.staffRequests).where(eq(s.staffRequests.id, rows.ask));
      await db.delete(s.karaokeSessions).where(eq(s.karaokeSessions.id, rows.session));
      await db.delete(s.integrationState).where(eq(s.integrationState.key, "site_orders"));
      delete process.env.KARAOKE_SYNC_SECRET;
      await restoreFeatures();
    });

    /** Oturumdan sonra şube seçimi çereziyle (undefined: çerez yok) canlı ucun yanıtı */
    const live = async (cookie?: string): Promise<LiveResponse> => {
      if (cookie === undefined) jar.values.delete(BRANCH_COOKIE);
      else jar.values.set(BRANCH_COOKIE, cookie);
      const res = await route.GET(new NextRequestCtor("http://panel.test/api/canli"));
      assert.equal(res.status, 200, `canlı uç ${res.status} döndü`);
      return (await res.json()) as LiveResponse;
    };
    /** Saha verisi yok: oturum, silme isteği, sipariş, çağrı; ekran "kullanılmıyor" der */
    const nothing = (b: LiveResponse, why: string) => {
      assert.deepEqual(b.karaoke.sessions, [], `${why}: karaoke oturumu`);
      assert.deepEqual(b.karaoke.deleteAsks, [], `${why}: silme isteği`);
      assert.equal(b.karaoke.error, null, `${why}: karaoke hatası`);
      assert.deepEqual(b.orders.list, [], `${why}: sipariş`);
      assert.deepEqual(b.orders.calls, [], `${why}: masa çağrısı`);
      assert.deepEqual(b.orders.off, { orders: true, calls: true }, `${why}: kapalı işareti`);
    };

    test("muhasebeci hiçbir şube seçiminde karaoke, sipariş ve çağrı almaz", async () => {
      // Önce tohumun gerçek olduğu: yönetici hepsini alır (tutarıyla)
      await signIn("ali");
      const a = await live();
      assert.deepEqual(
        a.karaoke.sessions.map((x) => [x.id, x.totalMinor]),
        [[rows.session, 150_000]],
        "yönetici oturumu tutarıyla alır",
      );
      assert.equal(a.karaoke.deleteAsks?.length, 1, "yönetici silme isteğini alır");
      assert.equal(a.orders.list.length, 1, "yönetici siparişi alır");
      assert.equal(a.orders.calls?.length, 1, "yönetici çağrıyı alır");

      await signIn("zeynep");
      for (const cookie of [undefined, "hepsi", "tuzla", "marina"]) {
        const b = await live(cookie);
        assert.equal(b.me.role, "accountant");
        nothing(b, `muhasebeci, çerez ${cookie ?? "yok"}`);
        assert.doesNotMatch(JSON.stringify(b), /Deniz|Ayşe|K7|"o-1"|"c-1"/, "misafir adı, isteyen, masa ve sipariş gitmez");
      }
    });

    test("müdür yalnız kendi şubesinin özelliklerini alır (seçici çerezi yok sayılır), karaoke tutarı gitmez", async () => {
      try {
        // Tuzla'da her özellik açık: Marina çerezi yok sayılır, Tuzla'nınkiler gelir
        await signIn("mehmet");
        const m = await live("marina");
        assert.deepEqual(
          m.karaoke.sessions.map((x) => [x.id, x.totalMinor, x.refundMinor]),
          [[rows.session, null, null]],
          "müdür oturumu tutarsız alır",
        );
        assert.equal(m.orders.list.length, 1, "müdür şubesinin siparişini alır");
        assert.equal(m.orders.calls?.length, 1, "müdür şubesinin çağrısını alır");

        // Özellikler Marina'ya geçince müdüre (Tuzla) hiçbir çerezle gelmez
        await db.update(s.branches).set({ features: ["yemek_karti"] }).where(eq(s.branches.id, "tuzla"));
        await db.update(s.branches).set({ features: ["karaoke", "siparis", "garson", "yemek_karti"] }).where(eq(s.branches.id, "marina"));
        await signIn("mehmet");
        for (const cookie of ["marina", "hepsi", undefined]) nothing(await live(cookie), `müdür, çerez ${cookie ?? "yok"}`);

        // Veri yalnız özelliğin açık olduğu yere akar: yönetici Marina'da, Marina personeli kendi şubesinde alır
        await signIn("ali");
        const a = await live("marina");
        assert.deepEqual([a.karaoke.sessions.length, a.orders.list.length, a.orders.calls?.length], [1, 1, 1], "yönetici Marina'da alır");
        await signIn("ayse");
        const p = await live("tuzla");
        assert.deepEqual(
          [p.karaoke.sessions.map((x) => x.totalMinor), p.orders.list.length, p.orders.calls?.length],
          [[null], 1, 1],
          "Marina personeli (çerez yok sayılır) alır, tutarsız",
        );
      } finally {
        await restoreFeatures();
      }
    });
  });

  describe("kasa e-postasının ham hatası yalnız yöneticide (bulgu 9)", () => {
    test("müdür ve muhasebeci rakamları görse de nedeni (Resend anahtarı) görmez: sayfanın DTO'su, ay penceresi, Onaylar ve yeniden dene", async () => {
      const { businessDate } = await import("../src/lib/cash-report");
      const reports = await import("../src/server/data/cash-reports");
      const store = await import("../src/server/cash/report-store");
      const email = await import("../src/server/cash/report-email");
      const cashRequests = await import("../src/server/cash/requests");
      const reviewActions = await import("../src/server/actions/cash-requests");
      const reportActions = await import("../src/server/actions/cash-report");
      // Dünün raporu: personelin kasa düzeltmesi onaya gider (iş günü kapandı, sayılan değişiyor)
      const date = addDays(businessDate(), -1);
      const fields: CashReportFields & { discounts: number | null } = {
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
      };
      const ACTIONS = ["Kasa düzeltmesi onaylandı"];
      // Tuzla'nın rapor alıcıları testten önceki hâline döner
      const settingWhere = and(eq(s.branchSettings.branchId, "tuzla"), eq(s.branchSettings.grp, "kasa.rapor"));
      const savedSetting = await db.select().from(s.branchSettings).where(settingWhere);
      let reportId = 0;
      let requestId = 0;
      try {
        await signIn("ali");
        const raw = await scope.withBranchScope("tuzla", async () => {
          await reports.saveCashSettings({ recipients: ["muhasebe@ornek.com"], emailEnabled: true, whatsapp: null }, "tuzla");
          const saved = await store.saveCashReport(db, { id: ids.ali, name: "Ali", role: "admin" }, { ...fields, countedBy: null, revision: 0, photos: [] });
          assert.equal(saved.kind, "saved");
          reportId = saved.kind === "saved" ? saved.row.id : 0;
          // RESEND_API_KEY yok (before): e-posta gitmedi, nedeni kayıtlı satırda
          const out = await email.emailReport(reportId);
          assert.equal(out.status, "failed");
          assert.match(out.error ?? "", /RESEND_API_KEY/);
          return out.error!;
        });

        // Yükleyiciler: rakamları gören rol "admin" DTO'sunu alır ama ham metni yalnız gerçek yönetici
        for (const k of ["mehmet", "zeynep"] as const) {
          await signIn(k);
          const role = BASE[k].role;
          assert.equal(cashAudience(role), "admin", `${role} rakamları görür`);
          await scope.withBranchScope("tuzla", async () => {
            const day = await reports.getCashReport(date, cashAudience(role), "tuzla", role);
            assert.equal(day?.emailError, STAFF_EMAIL_ERROR, `${role}: günün formu`);
            const month = await reports.cashReportsBetween(date, date, "admin", role);
            assert.deepEqual(month.map((r) => r.emailError), [STAFF_EMAIL_ERROR], `${role}: ayın penceresi`);
            assert.doesNotMatch(JSON.stringify([day, month]), /RESEND|Resend/, `${role}: tarayıcıya giden DTO'da ayrıntı yok`);
          });
        }
        await signIn("ali");
        await scope.withBranchScope("tuzla", async () => {
          assert.equal((await reports.getCashReport(date, "admin", "tuzla"))?.emailError, STAFF_EMAIL_ERROR, "rol verilmezse sabit metin");
          assert.equal((await reports.cashReportsBetween(date, date, "admin"))[0].emailError, STAFF_EMAIL_ERROR);
          assert.equal((await reports.getCashReport(date, "admin", "tuzla", "admin"))?.emailError, raw, "yönetici nedeni görür");
          assert.equal((await reports.cashReportsBetween(date, date, "admin", "admin"))[0].emailError, raw);
        });

        // Onaylar: müdür şubesinin kasa düzeltmesini onaylar, rapor yeniden e-postalanır; yanıtta neden yok
        const proposal = await scope.withBranchScope("tuzla", () =>
          cashRequests.proposeCashCorrection(
            db,
            { id: ids.ayse, name: "Ayşe", role: "staff" },
            { date, baseRevision: 1, fields: { ...fields, countedCash: 3_400 }, countedBy: null, message: "Sayımı yanlış yazmışım", clientKey: null },
          ),
        );
        requestId = proposal.row.id;
        await signIn("mehmet");
        asAction();
        const res = await reviewActions.reviewCashRequest({ id: requestId, seenVersion: proposal.row.version, seenRevision: 1, decision: "approve", note: null });
        assert.ok(res.ok, res.ok ? "" : res.error);
        assert.equal(res.data.status, "approved");
        assert.deepEqual(res.data.email, { status: "failed", error: STAFF_EMAIL_ERROR, to: 0 });
        assert.doesNotMatch(JSON.stringify(res), /RESEND|Resend/);
        // Yeniden dene: müdüre yine sabit metin, yöneticiye ayrıntı
        const again = await reportActions.resendCashReportEmail(reportId);
        assert.ok(again.ok, again.ok ? "" : again.error);
        assert.equal(again.data.error, STAFF_EMAIL_ERROR);
        await signIn("ali");
        asAction();
        const adminAgain = await reportActions.resendCashReportEmail(reportId);
        assert.ok(adminAgain.ok, adminAgain.ok ? "" : adminAgain.error);
        assert.match(adminAgain.data.error ?? "", /RESEND_API_KEY/);
      } finally {
        if (requestId) await db.delete(s.staffRequests).where(eq(s.staffRequests.id, requestId));
        if (reportId) await db.delete(s.cashReports).where(eq(s.cashReports.id, reportId));
        await db.delete(s.activityLog).where(inArray(s.activityLog.action, ACTIONS));
        await db.delete(s.branchSettings).where(settingWhere);
        if (savedSetting.length) await db.insert(s.branchSettings).values(savedSetting);
      }
    });
  });

  describe("zil: yeni cihaz uyarısı üç rolde (bulgu 11)", () => {
    test("zil: yeni cihaz uyarısı müdürde ve muhasebecide de, yalnız kendi hesabının; muhasebecinin zilinde başka satır yok", async () => {
      const newDevice = await import("../src/server/auth/new-device");
      const bell = await import("../src/server/actions/notifications");
      const ACTION = "Yeni cihazdan giriş";
      const UA: Record<Key, string> = {
        ali: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        mehmet: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
        zeynep: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0",
        ayse: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0 Edg/131.0.0.0",
      };
      const devices = <T extends { id: string }>(items: T[]) => items.filter((i) => i.id.startsWith("yeni-cihaz-"));
      try {
        // Her hesap kendi yeni cihazından girdi (RESEND_API_KEY yok: e-posta gitmez, yalnız işlem geçmişi ve zil)
        for (const k of Object.keys(BASE) as Key[]) {
          await newDevice.noteNewDevice({ id: ids[k], ...BASE[k] }, new Headers({ "user-agent": UA[k], "x-forwarded-for": "85.105.12.34" }));
        }
        // Yazım: iki adımlısı zorunlu üç rolde satır var, personelde yok
        const logged = await db.select({ userId: s.activityLog.userId, detail: s.activityLog.detail }).from(s.activityLog).where(eq(s.activityLog.action, ACTION));
        const byUser = new Map(logged.map((r) => [r.userId, r.detail]));
        assert.equal(byUser.get(ids.ali), "Chrome · Windows · IP 85.105.12.x");
        assert.equal(byUser.get(ids.mehmet), "Safari · iPhone · IP 85.105.12.x");
        assert.equal(byUser.get(ids.zeynep), "Firefox · Mac · IP 85.105.12.x");
        assert.equal(byUser.has(ids.ayse), false, "personele uyarı yazılmaz");
        assert.equal(logged.length, 3, JSON.stringify(logged));

        // Muhasebeci: zilinde yalnız kendi hesabının uyarısı, başka satır yok
        await signIn("zeynep");
        const mine = await bell.loadPanelNotifications();
        assert.equal(mine.length, 1, JSON.stringify(mine));
        assert.equal(mine[0].title, "Yeni cihazdan giriş: Firefox · Mac · IP 85.105.12.x");
        assert.deepEqual([mine[0].href, mine[0].group, mine[0].kind], ["/panel/hesap#oturumlar", "sistem", "warning"]);
        assert.ok(mine[0].id.startsWith("yeni-cihaz-"), mine[0].id);

        // Müdür: kendi hesabının uyarısı (yöneticininki ve muhasebecininki değil)
        await signIn("mehmet");
        const manager = devices(await bell.loadPanelNotifications());
        assert.deepEqual(
          manager.map((i) => i.title),
          ["Yeni cihazdan giriş: Safari · iPhone · IP 85.105.12.x"],
        );
        assert.deepEqual([manager[0].href, manager[0].group], ["/panel/hesap#oturumlar", "sistem"]);

        // Personel: uyarı yok
        await signIn("ayse");
        assert.deepEqual(devices(await bell.loadPanelNotifications()), [], "personelin zilinde yeni cihaz satırı yok");

        // Yönetici (kıyas): yalnız kendi hesabınınki
        await signIn("ali");
        assert.deepEqual(
          devices(await bell.loadPanelNotifications()).map((i) => i.title),
          ["Yeni cihazdan giriş: Chrome · Windows · IP 85.105.12.x"],
        );
      } finally {
        await db.delete(s.activityLog).where(eq(s.activityLog.action, ACTION));
      }
    });
  });

  // Sonda: sendBranchInstall şubenin e-postasını ve kurulum bağlantısını yazar
  describe("şube kurulumu e-postası rol hesabına gitmez (bulgu 10)", () => {
    test("müdür, muhasebeci, yönetici ve öteki şubenin personeli reddedilir; bu şubenin personeli kabul edilir", async () => {
      const prev = process.env.LADMIN_ANA_ADMIN;
      // Şube kurulumu yalnız ana yöneticinin (isAnaAdmin ortamı çağrı anında okur)
      process.env.LADMIN_ANA_ADMIN = BASE.ali.email;
      const branches = await import("../src/server/actions/branches");
      const refused = { ok: false, error: BRANCH_EMAIL_TAKEN };
      const branchEmail = async (id: string) => (await db.select({ email: s.branches.email }).from(s.branches).where(eq(s.branches.id, id)))[0]?.email ?? null;
      const installs = (id: string) => db.select({ email: s.lafposInstalls.email }).from(s.lafposInstalls).where(eq(s.lafposInstalls.branchId, id));
      const userCount = async () => (await db.select({ id: s.users.id }).from(s.users)).length;
      try {
        await signIn("ali");
        asAction();
        const users = await userCount();

        // Yeni şube: adres reddedilince şube kaydı da kurulum bağlantısı da yazılmaz
        for (const k of ["zeynep", "mehmet", "ali"] as const) {
          const r = await branches.createBranch({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", openedOn: null, email: BASE[k].email });
          assert.deepEqual(r, refused, `${BASE[k].role} adresiyle şube açılmaz`);
        }
        assert.deepEqual(await db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.id, "bodrum")), [], "şube kaydı yok");
        assert.deepEqual(await db.select({ id: s.lafposInstalls.id }).from(s.lafposInstalls), [], "kurulum bağlantısı yok");

        // Var olan şube: Tuzla müdürünün adresi Tuzla'ya da yazılmaz (eski denetim bunu geçiriyordu)
        assert.deepEqual(await branches.sendBranchInstall({ id: "tuzla", email: BASE.mehmet.email }), refused, "şubesinin müdürü");
        assert.deepEqual(await branches.sendBranchInstall({ id: "marina", email: BASE.zeynep.email }), refused, "muhasebeci");
        assert.deepEqual(await branches.sendBranchInstall({ id: "tuzla", email: BASE.ayse.email }), refused, "öteki şubenin personeli");
        assert.equal(await branchEmail("tuzla"), null, "Tuzla'nın e-postası değişmedi");
        assert.equal(await branchEmail("marina"), null, "Marina'nın e-postası değişmedi");
        assert.deepEqual(await installs("tuzla"), [], "Tuzla'ya kurulum bağlantısı yok");
        assert.deepEqual(await installs("marina"), [], "Marina'ya kurulum bağlantısı yok");

        // Bu şubenin personeli: hesabı yeniden açılmaz, bağlantı üretilir (e-posta kurulu değil, bağlantı ekranda)
        const ok = await branches.sendBranchInstall({ id: "marina", email: BASE.ayse.email });
        assert.equal(ok.ok, true, JSON.stringify(ok));
        assert.equal(ok.ok && ok.data.account, "vardi", "var olan hesap kullanıldı");
        assert.equal(await branchEmail("marina"), BASE.ayse.email);
        assert.deepEqual(await installs("marina"), [{ email: BASE.ayse.email }], "tek kurulum bağlantısı");
        assert.equal(await userCount(), users, "yeni hesap açılmadı");
      } finally {
        if (prev === undefined) delete process.env.LADMIN_ANA_ADMIN;
        else process.env.LADMIN_ANA_ADMIN = prev;
        await db.delete(s.lafposInstalls).where(inArray(s.lafposInstalls.branchId, ["tuzla", "marina"]));
        await db.update(s.branches).set({ email: null }).where(inArray(s.branches.id, ["tuzla", "marina"]));
      }
    });
  });
});
