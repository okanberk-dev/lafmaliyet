// Müdür ve Muhasebeci rolleri, gerçek Postgres'te (docs/ROLLER.md): veritabanı kısıtları (bilinmeyen rol, şubesiz
// müdür), müdürün şube kilidi (seçici, işletme geneli okuma, öteki şubenin isteğine karar, öteki şubeye yazım; şubesi
// pasife alınınca oturumu yok), muhasebecinin salt okunurluğu (sunucu eylemlerinin HEPSİ "salt okunur" diye reddeder ve
// veritabanında hiçbir satır değişmez; eylem dışında ana ekranına yönlenir). Oturum gerçek src/server/auth/dal.ts'le,
// çerezler ve istek başlıkları taklit edilerek.
//
// ROLLER_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: ROLLER_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/roller-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { READ_ONLY_TEXT } from "../src/lib/roles";
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
});
