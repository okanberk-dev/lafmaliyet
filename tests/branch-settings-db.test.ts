// Şube başına ayarlar (plan B1–B3; docs/SUBE.md › Şube başına ayarlar), gerçek Postgres'te:
// - geçiş: satır yokken eski genel kayıt (cash.settings) Tuzla'nın alıcıları ve Marina'nın çalışan listesi; Marina
//   "Tuzla ile aynı" başlar; kayıt yoksa ortamın alıcıları;
// - Tuzla'nın alıcıları kaydedilince "aynı" Marina da onları kullanır; bağlı şubeye alıcı yazılmaz; "aynı" kapatılınca
//   değerler kopyalanır, sonra ayrı düzenlenir; gün sonu e-postası şubenin alıcılarına ve o şubeye açık adreslere;
// - kasa raporu e-postası ve deneme e-postası raporun / kartın şubesinin alıcılarına;
// - gizli alan şifreli durur, "aynı" kapatılınca kopyalanmaz; bağlı şube varken hedef kapatılamaz, silinemez;
// - yalnız yönetici; her yazım işlem geçmişine aynı işlemde.
//
// BRANCH_SETTINGS_TEST_DATABASE_URL verilmezse atlanır (ör. postgres://postgres:postgres@localhost:5432/postgres). Test o
// sunucuda kendi geçici veritabanını (lm_sube_b1_<pid>) açar, sonunda siler.
// Çalıştırma: BRANCH_SETTINGS_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/branch-settings-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import type { BranchSettingGroup } from "../src/lib/branch-settings/groups";
import { DEFAULT_BRANCHES } from "../src/lib/branches";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.BRANCH_SETTINGS_TEST_DATABASE_URL;
const DB_NAME = `lm_sube_b1_${process.pid}`;

type Who = { id: number; name: string; role: "admin" | "staff"; branchId: string | null };

/** Gizli alanlı deneme grubu (bugünkü gruplarda gizli alan yok; altyapı yine sınanır) */
const SECRET_GROUP: BranchSettingGroup<{ clientId: string; secret: string }> = {
  id: "deneme.sir",
  label: "Deneme hesabı",
  description: "",
  linkable: true,
  legacy: "default",
  legacyKey: "deneme.sir",
  secretFields: ["secret"],
  read: (raw) => ({ clientId: typeof raw.clientId === "string" ? raw.clientId : "", secret: typeof raw.secret === "string" ? raw.secret : "" }),
  summary: () => "",
};

describe("şube başına ayarlar: veritabanında", { skip: !SERVER_URL && "BRANCH_SETTINGS_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: DB;
  const users: Record<"ali" | "ayse", Who> = {
    ali: { id: 0, name: "Ali", role: "admin", branchId: null },
    ayse: { id: 0, name: "Ayşe", role: "staff", branchId: "marina" },
  };
  let me: Who = users.ali;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sube-ayarlari-testi-icin-en-az-otuz-iki-karakterlik-anahtar", CASH_REPORT_RECIPIENTS: "ortam@ornek.com" });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    stub(require.resolve("../src/server/auth/dal"), {
      requireAdmin: async () => {
        if (me.role !== "admin") throw new Error("NEXT_REDIRECT yönetici değil");
        return { ...me, email: `${me.name}@test.local`, active: true };
      },
      // Şube kapatma, silme ve kasa anahtarı asıl yöneticinin (requireAnaAdmin); testin yöneticisi asıl yönetici sayılır
      requireAnaAdmin: async () => {
        if (me.role !== "admin") throw new Error("NEXT_REDIRECT yönetici değil");
        return { ...me, email: `${me.name}@test.local`, active: true };
      },
      requireUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
      getCurrentUser: async () => ({ ...me, email: `${me.name}@test.local`, active: true }),
      // Yönetim konsolunun oturumu yok (updateBranch önce ona bakar; konsol tests/konsol-sube-db.test.ts'te)
      getYonetimUser: async () => null,
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(s.branches).values(DEFAULT_BRANCHES.map((b) => ({ ...b }))).onConflictDoNothing();
    await db.insert(s.branches).values({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", active: true, sortOrder: 4 });
    await db.update(s.branches).set({ posSource: "asilpos" }).where(eq(s.branches.id, "marina"));
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `${k}@test.local`, name: users[k].name, passwordHash: "x", role: users[k].role, branchId: users[k].branchId })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  test("geçiş: kayıt yokken ortam; eski genel kayıt Tuzla'nın alıcıları ve Marina'nın çalışan listesi; Marina 'aynı' başlar", async () => {
    const { loadCashSettings, loadCashSettingsView } = await import("../src/server/data/cash-reports");
    assert.deepEqual(await loadCashSettings("tuzla"), { recipients: ["ortam@ornek.com"], emailEnabled: true, whatsapp: null, staffRecipients: [], staffAmounts: false });
    await db.insert(s.integrationState).values({
      key: "cash.settings",
      value: { recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: "905321234567", staffRecipients: ["kasa@ornek.com"], staffAmounts: true },
    });
    const tuzla = await loadCashSettings("tuzla");
    assert.deepEqual(tuzla, { recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: "905321234567", staffRecipients: [], staffAmounts: false }, "çalışan listesi Marina'nın");
    const marina = await loadCashSettingsView("marina");
    assert.deepEqual(marina.mode, { kind: "linked", to: "tuzla", implicit: true });
    assert.deepEqual(marina.settings, { recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: "905321234567", staffRecipients: ["kasa@ornek.com"], staffAmounts: true });
    assert.deepEqual((await loadCashSettings("bodrum")).staffRecipients, [], "Bodrum'un çalışan listesi yok");
    assert.equal((await db.select().from(s.branchSettings)).length, 0, "okuma satır yazmaz");
  });

  test("Tuzla'nın alıcıları kaydedilince Marina da kullanır; bağlı Marina'ya alıcı yazılmaz, çalışan listesi yazılır", async () => {
    const actions = await import("../src/server/actions/cash-report");
    const { loadCashSettings } = await import("../src/server/data/cash-reports");
    const r = await actions.updateCashSettings({ branchId: "tuzla", recipients: "yeni@ornek.com", emailEnabled: true, whatsapp: "", staffRecipients: "" });
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.deepEqual((await loadCashSettings("marina")).recipients, ["yeni@ornek.com"]);
    assert.equal((await loadCashSettings("marina")).whatsapp, null);
    // Eski kayıt bırakılır (geri dönüş güvenli)
    const [legacy] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "cash.settings"));
    assert.deepEqual((legacy.value as { recipients: string[] }).recipients, ["sahip@ornek.com"]);
    const refused = await actions.updateCashSettings({ branchId: "marina", recipients: "marina@ornek.com", emailEnabled: true, whatsapp: "", staffRecipients: "" });
    assert.ok(!refused.ok && /Tuzla ile aynı/.test(refused.error), refused.ok ? "" : refused.error);
    const staff = await actions.updateCashSettings({ branchId: "marina", staffRecipients: "garson@ornek.com", staffAmounts: false });
    assert.ok(staff.ok, staff.ok ? "" : staff.error);
    const m = await loadCashSettings("marina");
    assert.deepEqual([m.recipients, m.staffRecipients, m.staffAmounts], [["yeni@ornek.com"], ["garson@ornek.com"], false]);
    assert.deepEqual((await loadCashSettings("tuzla")).staffRecipients, [], "çalışan listesi kopyalanmaz, Tuzla'ya gitmez");
    const log = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Kasa raporu alıcıları"));
    assert.equal(log.length, 2, "iki kayıt, iki satır");
    assert.match(log.map((l) => l.detail).join(" | "), /Tuzla · yeni@ornek\.com/);
  });

  test("'aynı' kapatılınca değerler kopyalanır, sonra ayrı; gün sonu şubenin alıcılarına (boşsa o şubeye açık adreslere)", async () => {
    const link = await import("../src/server/actions/branch-settings");
    const actions = await import("../src/server/actions/cash-report");
    const { loadCashSettingsView } = await import("../src/server/data/cash-reports");
    const { dayEndRecipients } = await import("../src/server/asilpos/gun-sonu");
    await db.insert(s.notificationRecipients).values([
      { email: "herkes@ornek.com", active: true },
      { email: "tuzlaci@ornek.com", active: true, branchIds: ["tuzla"] },
      { email: "marinaci@ornek.com", active: true, branchIds: ["marina"] },
    ]);
    assert.deepEqual(await dayEndRecipients(db, "marina"), ["yeni@ornek.com"], "aynı iken Tuzla'nın alıcıları; liste kuruluyken bildirim adresleri girmez");

    const r = await link.setBranchSettingLink({ branchId: "marina", group: "kasa.rapor", sameAs: null });
    assert.ok(r.ok, r.ok ? "" : r.error);
    const [row] = await db.select().from(s.branchSettings).where(and(eq(s.branchSettings.branchId, "marina"), eq(s.branchSettings.grp, "kasa.rapor")));
    assert.deepEqual([row.sameAs, row.value], [null, { recipients: ["yeni@ornek.com"], emailEnabled: true, whatsapp: null }], "o anki değer kopyalandı");
    assert.deepEqual((await loadCashSettingsView("marina")).mode, { kind: "own" });
    const own = await actions.updateCashSettings({ branchId: "marina", recipients: "marina@ornek.com", emailEnabled: true, whatsapp: "0532 111 22 33", staffRecipients: "garson@ornek.com" });
    assert.ok(own.ok, own.ok ? "" : own.error);
    assert.deepEqual(await dayEndRecipients(db, "marina"), ["marina@ornek.com"]);
    assert.deepEqual(await dayEndRecipients(db, "tuzla"), ["yeni@ornek.com"], "Tuzla'nınki değişmedi");
    // Marina'nın listesi kapatılınca yedek: o şubeye açık bildirim adresleri ("Yalnız Tuzla" almaz)
    const empty = await actions.updateCashSettings({ branchId: "marina", recipients: "", emailEnabled: false, whatsapp: "", staffRecipients: "garson@ornek.com" });
    assert.ok(empty.ok, empty.ok ? "" : empty.error);
    assert.deepEqual((await dayEndRecipients(db, "marina")).sort(), ["herkes@ornek.com", "marinaci@ornek.com"]);
    const refill = await actions.updateCashSettings({ branchId: "marina", recipients: "marina@ornek.com", emailEnabled: true, whatsapp: "0532 111 22 33", staffRecipients: "garson@ornek.com" });
    assert.ok(refill.ok, refill.ok ? "" : refill.error);
    // Zil ve "bu adres hangi listede": bütün şubelerin listeleri
    const { listsWithEmail } = await import("../src/server/notify/recipients");
    assert.deepEqual(await listsWithEmail("Marina@Ornek.com"), ["cash"]);

    // Yeniden "aynı": Marina'nın kendi değeri silinir
    const back = await link.setBranchSettingLink({ branchId: "marina", group: "kasa.rapor", sameAs: "tuzla" });
    assert.ok(back.ok, back.ok ? "" : back.error);
    const [linked] = await db.select().from(s.branchSettings).where(and(eq(s.branchSettings.branchId, "marina"), eq(s.branchSettings.grp, "kasa.rapor")));
    assert.deepEqual([linked.sameAs, linked.value, linked.secrets], ["tuzla", {}, null]);
    assert.deepEqual((await loadCashSettingsView("marina")).settings.recipients, ["yeni@ornek.com"]);
    assert.deepEqual(await listsWithEmail("marina@ornek.com"), [], "listeden düştü");
    const log = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Şube ayarı"));
    assert.deepEqual(
      log.map((l) => l.detail),
      ["Marina · Kasa raporu alıcıları: kendi ayarı (değerler kopyalandı)", "Marina · Kasa raporu alıcıları: Tuzla ile aynı"],
    );
  });

  test("ret: Tuzla bağlanamaz, liste grubu bağlanmaz, kapalı şubeye bağlanmaz, personel değiştiremez", async () => {
    const link = await import("../src/server/actions/branch-settings");
    const no = async (input: Parameters<typeof link.setBranchSettingLink>[0], re: RegExp) => {
      const r = await link.setBranchSettingLink(input);
      assert.ok(!r.ok && re.test(r.error), r.ok ? "geçti" : r.error);
    };
    await no({ branchId: "tuzla", group: "kasa.rapor", sameAs: "marina" }, /ana ayardır/);
    await no({ branchId: "marina", group: "kasa.calisan", sameAs: "tuzla" }, /şube başına tutulur/);
    await no({ branchId: "online", group: "kasa.rapor", sameAs: "tuzla" }, /fiziksel şubede/);
    await no({ branchId: "marina", group: "yok", sameAs: "tuzla" }, /grubu bulunamadı/);
    me = users.ayse;
    try {
      const r = await link.setBranchSettingLink({ branchId: "marina", group: "kasa.rapor", sameAs: null });
      assert.equal(r.ok, false, "personel şube ayarını değiştiremez");
      const c = await (await import("../src/server/actions/cash-report")).updateCashSettings({ branchId: "marina", staffRecipients: "x@ornek.com" });
      assert.equal(c.ok, false, "personel kasa alıcılarını değiştiremez");
    } finally {
      me = users.ali;
    }
  });

  test("bağlı şube varken hedef kapatılamaz ve silinemez; ayrılınca kapatılır", async () => {
    const link = await import("../src/server/actions/branch-settings");
    const branchActions = await import("../src/server/actions/branches");
    // Bodrum kendi ayarına ayrılır, Marina Bodrum'a bağlanır
    assert.ok((await link.setBranchSettingLink({ branchId: "bodrum", group: "kasa.rapor", sameAs: null })).ok);
    const l = await link.setBranchSettingLink({ branchId: "marina", group: "kasa.rapor", sameAs: "bodrum" });
    assert.ok(l.ok, l.ok ? "" : l.error);
    // Zincir yok: Bodrum artık Tuzla'ya bağlanamaz (Marina ona bağlı)
    const chain = await link.setBranchSettingLink({ branchId: "bodrum", group: "kasa.rapor", sameAs: "tuzla" });
    assert.ok(!chain.ok && /Marina bu şubenin ayarını kullanıyor/.test(chain.error), chain.ok ? "" : chain.error);
    const close = await branchActions.updateBranch({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", openedOn: null, active: false });
    assert.ok(!close.ok && /Marina, kasa raporu alıcıları için Bodrum şubesinin ayarını kullanıyor/.test(close.error), close.ok ? "" : close.error);
    const del = await branchActions.deleteBranch({ id: "bodrum" });
    assert.ok(!del.ok && /Bodrum/.test(del.error), del.ok ? "" : del.error);
    assert.ok((await link.setBranchSettingLink({ branchId: "marina", group: "kasa.rapor", sameAs: "tuzla" })).ok);
    const closed = await branchActions.updateBranch({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", openedOn: null, active: false });
    assert.ok(closed.ok, closed.ok ? "" : closed.error);
    const reopened = await branchActions.updateBranch({ id: "bodrum", name: "Bodrum", kind: "fiziksel", posSource: "modpos", openedOn: null, active: true });
    assert.ok(reopened.ok, reopened.ok ? "" : reopened.error);
  });

  test("kasa raporu e-postası raporun şubesinin alıcılarına: 'aynı' iken Tuzla'nınkine, ayrılınca Marina'nınkine", async () => {
    const realFetch = globalThis.fetch;
    const sent: string[][] = [];
    // Resend: alıcılar kaydedilir, ağa çıkılmaz; site bağlantısı yok (online satırı sorulmaz)
    delete process.env.KARAOKE_SYNC_SECRET;
    process.env.RESEND_API_KEY = "re_test_sube_ayarlari";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("https://api.resend.com/")) throw new TypeError("testte ağ yok");
      sent.push((JSON.parse(String(init?.body)) as { to: string[] }).to);
      return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      const { emailReport } = await import("../src/server/cash/report-email");
      const link = await import("../src/server/actions/branch-settings");
      const actions = await import("../src/server/actions/cash-report");
      const rows = await db
        .insert(s.cashReports)
        .values([
          { date: "2026-11-20", branchId: "tuzla", zTotal: 1000, cash: 500, card: 500, submittedByName: "Ali" },
          { date: "2026-11-20", branchId: "marina", zTotal: 2000, cash: 900, card: 1100, submittedByName: "Ayşe" },
        ])
        .returning({ id: s.cashReports.id, branchId: s.cashReports.branchId });
      const id = (b: string) => rows.find((r) => r.branchId === b)!.id;
      assert.equal((await emailReport(id("marina"), { idempotencyKey: "a" })).status, "sent");
      assert.deepEqual(sent.at(-1), ["yeni@ornek.com"], "aynı iken Tuzla'nın alıcıları");
      assert.ok((await link.setBranchSettingLink({ branchId: "marina", group: "kasa.rapor", sameAs: null })).ok);
      const own = await actions.updateCashSettings({ branchId: "marina", recipients: "marina@ornek.com", emailEnabled: true, whatsapp: "" });
      assert.ok(own.ok, own.ok ? "" : own.error);
      await emailReport(id("marina"), { idempotencyKey: "b" });
      assert.deepEqual(sent.at(-1), ["marina@ornek.com"], "Marina'nın kendi alıcıları");
      await emailReport(id("tuzla"), { idempotencyKey: "c" });
      assert.deepEqual(sent.at(-1), ["yeni@ornek.com"], "Tuzla'nınki değişmedi");
      // Deneme e-postası kartın şubesinin alıcılarına
      const test = await actions.sendCashTestEmail("marina");
      assert.ok(test.ok, test.ok ? "" : test.error);
      assert.deepEqual(sent.at(-1), ["marina@ornek.com"]);
      // Çalışan listesi gönderilmeyen kayıtta dokunulmaz (ModPOS'lu şubenin kartında alan yok)
      const before = (await (await import("../src/server/data/cash-reports")).loadCashSettings("marina")).staffRecipients;
      assert.ok((await actions.updateCashSettings({ branchId: "marina", recipients: "marina@ornek.com", emailEnabled: true, whatsapp: "" })).ok);
      assert.deepEqual((await (await import("../src/server/data/cash-reports")).loadCashSettings("marina")).staffRecipients, before);
      const empty = await actions.updateCashSettings({ branchId: "marina" });
      assert.ok(!empty.ok && /Kaydedilecek bir şey yok/.test(empty.error), empty.ok ? "" : empty.error);
      assert.ok((await link.setBranchSettingLink({ branchId: "marina", group: "kasa.rapor", sameAs: "tuzla" })).ok);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.RESEND_API_KEY;
    }
  });

  test("gizli alan: şifreli durur, okununca açılır; 'aynı' kapatılınca kopyalanmaz, yeniden girilir", async () => {
    const core = await import("../src/server/branch-settings");
    await db.transaction((tx) => core.putBranchSetting(tx, SECRET_GROUP, "tuzla", { clientId: "musteri-1", secret: "cok-gizli" }, "Ali"));
    const [row] = await db.select().from(s.branchSettings).where(eq(s.branchSettings.grp, SECRET_GROUP.id));
    assert.deepEqual(row.value, { clientId: "musteri-1" }, "gizli alan değerde yok");
    assert.ok(typeof (row.secrets as Record<string, string>).secret === "string" && !JSON.stringify(row.secrets).includes("cok-gizli"), "şifreli");
    const tuzla = await core.resolveBranchSetting(SECRET_GROUP, "tuzla");
    assert.deepEqual([tuzla.value, tuzla.secrets], [{ clientId: "musteri-1", secret: "cok-gizli" }, { secret: "saved" }]);
    const marina = await core.resolveBranchSetting(SECRET_GROUP, "marina");
    assert.deepEqual([marina.value.secret, marina.from], ["cok-gizli", "tuzla"], "aynı iken Tuzla'nın hesabı");
    // Bilinmeyen ya da prototipe dokunan anahtar yazılmaz (istemciden gelen gövde)
    const bad = JSON.parse('{"clientId":"musteri-1","__proto__":{"kirli":true},"fazla":"x","constructor":"y"}') as Record<string, unknown>;
    await db.transaction((tx) => core.putBranchSetting(tx, SECRET_GROUP, "tuzla", bad as never, "Ali"));
    const [clean] = await db.select().from(s.branchSettings).where(eq(s.branchSettings.grp, SECRET_GROUP.id));
    assert.deepEqual(clean.value, { clientId: "musteri-1" }, "yalnız grubun alanları");
    assert.equal(({} as Record<string, unknown>).kirli, undefined, "prototip kirlenmedi");
    // Verilmeyen gizli alan kalır
    await db.transaction((tx) => core.putBranchSetting(tx, SECRET_GROUP, "tuzla", { clientId: "musteri-2" }, "Ali"));
    assert.equal((await core.resolveBranchSetting(SECRET_GROUP, "tuzla")).value.secret, "cok-gizli");
    const left = await db.transaction((tx) => core.unlinkBranchSetting(tx, SECRET_GROUP, "marina", "Ali"));
    assert.deepEqual(left.secretsLeft, ["secret"]);
    const own = await core.resolveBranchSetting(SECRET_GROUP, "marina");
    assert.deepEqual([own.value, own.secrets], [{ clientId: "musteri-2", secret: "" }, { secret: "none" }], "sır kopyalanmadı");
    // Başka AUTH_SECRET'la açılmaz: "kayıtlı ama okunamıyor"
    const saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "baska-bir-anahtar-en-az-otuz-iki-karakterlik-olsun";
    try {
      assert.deepEqual((await core.resolveBranchSetting(SECRET_GROUP, "tuzla")).secrets, { secret: "unreadable" });
    } finally {
      process.env.AUTH_SECRET = saved;
    }
  });
});
