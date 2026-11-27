// Şube ayrımı parça 4, gerçek Postgres'te (docs/SUBE.md › Şube ayrımı › Alanlar): Ödemeler ve faturalar, Nakit planı,
// Tedarikçi bakiyeleri ve Komisyon kişinin şube görünümüyle okur. Tuzla'nın kayıtları "IZ-TUZLA" işaretini ya da
// 77.777,77 tutarını taşır: Marina seçili ve "Yalnız şube" kipindeyken hiçbir çıktıda görünmemeli, "Firma geneli" kipinde
// görünmeli; müdürde firma tercihi yazılı olsa da görünmemeli. Oturum gerçek src/server/auth/dal.ts'le, çerezler taklit
// edilerek (tests/sube-ayrimi-sizinti-db.test.ts gibi).
//
// SUBE_ALANLAR_TEST_DATABASE_URL verilmezse atlanır (npm run test:db onu TEST_DATABASE_URL'e bağlar). Bir Postgres
// sunucusunun adresi: test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_ALANLAR_TEST_DATABASE_URL=postgres://localhost/postgres npx tsx --test tests/sube-ayrimi-alanlar-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { supplierMatchKey } from "../src/app/panel/faturalar/rules";
import type { BranchViewPrefs } from "../src/lib/branch-view";
import { ALL_BRANCHES, BRANCH_COOKIE, DEFAULT_BRANCHES } from "../src/lib/branches";
import { addDays, todayTR } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.SUBE_ALANLAR_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_alanlar_${process.pid}`;
const SECRET = "sube-alanlar-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const MARK = "IZ-TUZLA";
const AMOUNT = 77777.77;

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

/** Çıktıda Tuzla'nın işareti (adı ya da tutarı, her biçimde) var mı */
const leaks = (v: unknown) => {
  const text = JSON.stringify(v);
  return text.includes(MARK) || text.includes("77777") || text.includes("77.777");
};

describe("şube ayrımı parça 4: alanlar veritabanında", { skip: !SERVER_URL && "SUBE_ALANLAR_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let scope: typeof import("../src/server/branch-scope");
  let jar = new Jar();
  const ids = { ali: 0, mert: 0 };
  const today = todayTR();
  const soon = addDays(today, 3);
  // Komisyon: iki ay önceki ayın son günü kesilen Pluxee faturası, hakedişi gecikmiş; satış yalnız Tuzla'da
  const commissionMonth = (() => {
    const [y, m] = today.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 3, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

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
    const user = async (name: string, email: string, role: "admin" | "manager", branchId: string | null) =>
      (await db.insert(s.users).values({ name, email, role, branchId, passwordHash: "x" }).returning({ id: s.users.id }))[0].id;
    ids.ali = await user("Ali", "ali@ornek.com", "admin", null);
    ids.mert = await user("Mert", "mert@ornek.com", "manager", "marina");

    // Tedarikçi kartı (cari için) ve faturalar: Marina'nın, Tuzla'nın (işaretli tutar ve işaretli tedarikçi), işletme
    // geneli, şubesi seçilmemiş. Hepsi ödenmemiş, vadesi 3 gün sonra
    const [sutas] = await db.insert(s.suppliers).values({ name: "Sütaş", key: supplierMatchKey("Sütaş") }).returning({ id: s.suppliers.id });
    const invoice = (supplier: string, payable: number, branchId: string | null, companyWide = false) =>
      db.insert(s.invoices).values({ date: addDays(today, -20), dueDate: soon, supplier, category: "Hammadde & İçecek", amount: payable, payable, unpaid: true, branchId, companyWide });
    await invoice("Sütaş", 1000, "marina");
    await invoice("Sütaş", AMOUNT, "tuzla");
    await invoice(`${MARK} Gıda`, 500, "tuzla");
    await invoice("Ortak Tedarik", 200, null, true);
    await invoice("Şubesiz Tedarik", 50, null);
    // Faturasız borç (cari): firmanın, şube kipinde İşletme geneli
    await db.insert(s.supplierEntries).values({ supplierId: sutas.id, kind: "borc", date: addDays(today, -10), amount: 300, dueDate: soon, costMode: "fatura", createdByName: "Ali" });

    // Hatırlatıcılar: Tuzla'nın (işaretli), Marina'nın, işletme geneli
    const reminder = (title: string, amount: number, branchId: string | null) =>
      db.insert(s.reminders).values({ title, amount, dueDate: soon, anchorDate: soon, branchId, kind: "kira" });
    await reminder(`${MARK} Kira`, AMOUNT, "tuzla");
    await reminder("Marina Kira", 40000, "marina");
    await reminder("Muhasebe", 6000, null);

    // Bildirim adresleri: Tuzla'ya bağlı (işaretli), bütün şubeler, Marina'ya bağlı
    await db.insert(s.notificationRecipients).values([
      { email: "tuzla@ornek.com", name: `${MARK} Alıcı`, branchIds: ["tuzla"] },
      { email: "hepsi@ornek.com", name: "Ortak", branchIds: [] },
      { email: "marina@ornek.com", name: "Marina Alıcı", branchIds: ["marina"] },
    ]);

    // Komisyon: Pluxee faturası (kanal) ve yalnız Tuzla'nın Z'sinde yemek kartı; takip baştan beri
    await db.insert(s.integrationState).values({ key: "komisyon.since", value: "2025-01-01" });
    await db.insert(s.invoices).values({ date: `${commissionMonth}-28`, supplier: "Pluxee", category: "Komisyon", amount: 60, payable: 72, vat: 12 });
    for (const d of ["10", "11", "12"]) {
      await db.insert(s.cashReports).values({ date: `${commissionMonth}-${d}`, branchId: "tuzla", zTotal: 1000, cash: 800, mealCard: 200, submittedByName: "Can" });
    }

    dal = await import("../src/server/auth/dal");
    scope = await import("../src/server/branch-scope");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Oturum (`kim`), seçicide `secim`, hesabın şube görünümü tercihi `prefs` (veritabanına yazılır) */
  const signIn = async (kim: number, secim: string, prefs: BranchViewPrefs = {}) => {
    jar = new Jar();
    await db.update(s.users).set({ branchView: prefs }).where(eq(s.users.id, kim));
    const [u] = await db.select().from(s.users).where(eq(s.users.id, kim));
    await dal.startSession(u);
    jar.set(BRANCH_COOKIE, secim);
  };
  const FIRMA: BranchViewPrefs = { odemeler: "firma", nakit: "firma", tedarikciler: "firma", komisyon: "firma" };
  const tool = async (name: string) => {
    const { TOOLS } = await import("../src/server/mcp/tools");
    const t = TOOLS.find((x) => x.name === name)!;
    return (args: Record<string, unknown>) => (t.run as (a: unknown, c: unknown) => Promise<Record<string, unknown>>)(t.inputSchema.parse(args), { base: "https://panel.test", now: new Date() });
  };

  test("Ödemeler: Marina'nın şube kipinde liste şubenin ve işletme genelinin; cari İşletme geneli'nde, şubesiz fatura sayıda", async () => {
    const { loadUpcoming } = await import("../src/server/notify/digest");
    const marina = await loadUpcoming(undefined, { branch: "marina" });
    assert.equal(leaks(marina.items), false, "Tuzla'nın faturası ve hatırlatıcısı yok");
    assert.deepEqual(marina.items.map((i) => i.title).sort(), ["Marina Kira", "Muhasebe", "Ortak Tedarik", "Sütaş"].sort());
    assert.deepEqual(
      marina.shared.map((i) => [i.source, i.amount]),
      [["cari", 300]],
    );
    assert.deepEqual(marina.unassigned, { count: 1, total: 50 });
    const all = await loadUpcoming(undefined, { branch: ALL_BRANCHES });
    assert.equal(leaks(all.items), true, "Tümü'de Tuzla'nın kalemleri");
    assert.deepEqual(all.shared, []);
  });

  test("alanın kapsamı kişinin tercihiyle: Marina seçili, şube kipinde Tuzla yok; firma kipinde var; müdürde hep şube", async () => {
    await signIn(ids.ali, "marina");
    assert.equal(await scope.areaScope("odemeler"), "marina", "yöneticinin varsayılanı şube");
    await signIn(ids.ali, "marina", FIRMA);
    assert.equal(await scope.areaScope("odemeler"), ALL_BRANCHES);
    assert.equal(await scope.areaScope("mutabakat"), "marina", "yazılmayan alan varsayılanda");
    // Müdür: tercih yazılı olsa da her alan şubesi
    await signIn(ids.mert, "marina", FIRMA);
    for (const a of ["odemeler", "nakit", "tedarikciler", "komisyon"] as const) assert.equal(await scope.areaScope(a), "marina", a);
    assert.equal(await scope.withAreaView("odemeler", "firma", () => scope.areaScope("odemeler")), "marina", "gorunum da kilidi aşmaz");
  });

  test("zil ve Bugün: şube kipinde Tuzla'nın ödemesi ve faturası yok, firma kipinde var", async () => {
    const { loadPanelNotifications } = await import("../src/server/actions/notifications");
    const { loadToday } = await import("../src/server/data/today");
    await signIn(ids.ali, "marina");
    const bell = await loadPanelNotifications();
    assert.equal(leaks(bell.filter((n) => n.group === "odeme")), false);
    const day = await loadToday((await dal.getCurrentUser())!);
    assert.equal(leaks(day.facts.payments), false);
    assert.ok(day.facts.payments?.some((p) => p.title === "Marina Kira"), "Marina'nın ödemesi");
    await signIn(ids.ali, "marina", FIRMA);
    assert.equal(leaks(await loadToday((await dal.getCurrentUser())!).then((d) => d.facts.payments)), true, "firma kipinde bütün şubelerin");
  });

  test("Son ödenenler ve bildirim adresleri: şube kipinde öbür şubeninki yok", async () => {
    const { loadRecentPaid } = await import("../src/server/data/recent-paid");
    const { loadRecipientsInScope } = await import("../src/server/notify/recipients");
    const rows = await db.select({ id: s.invoices.id, supplier: s.invoices.supplier, branchId: s.invoices.branchId }).from(s.invoices);
    const tuzla = rows.find((r) => r.supplier === `${MARK} Gıda`)!;
    const marina = rows.find((r) => r.branchId === "marina")!;
    const at = new Date().toISOString();
    await db.insert(s.integrationState).values({
      key: "payments.recent",
      value: [
        { kind: "invoice", id: tuzla.id, title: `${MARK} Gıda`, amount: 500, dueDate: soon, at },
        { kind: "invoice", id: marina.id, title: "Sütaş", amount: 1000, dueDate: soon, at },
        { kind: "cari", id: 999, title: "Hesaba ödeme · Sütaş", amount: 300, dueDate: null, at },
      ],
    });
    assert.deepEqual(
      (await loadRecentPaid("marina")).map((e) => e.title),
      ["Sütaş"],
    );
    assert.equal((await loadRecentPaid()).length, 3);
    const recipients = await loadRecipientsInScope(db, "marina");
    assert.deepEqual(recipients.map((r) => r.email).sort(), ["hepsi@ornek.com", "marina@ornek.com"]);
    assert.equal((await loadRecipientsInScope(db, ALL_BRANCHES)).length, 3);
  });

  test("Nakit planı: şubenin akışında Tuzla yok, işletme geneli ayrı satırda, vergi ve SGK hiç yok (Tümü'de), bakiye firmanın", async () => {
    const { loadAreaCashPlan } = await import("../src/server/data/cash-plan");
    const { planNotes } = await import("../src/lib/cash-plan");
    // Vergi ve SGK hatırlatıcıları (biri şubesiz, biri Marina'nın): şubenin akışına da İşletme geneli satırına da girmez
    // (sahibin kararı 27 Kasım 2026: vergi şubeye bölünmez)
    const taxRems = await db
      .insert(s.reminders)
      .values([
        { title: "KDV beyannamesi ve ödemesi", amount: 5555.55, dueDate: soon, anchorDate: soon, branchId: null, kind: "vergi" },
        { title: "SGK prim ödemesi", amount: 4444.44, dueDate: soon, anchorDate: soon, branchId: "marina", kind: "vergi" },
      ])
      .returning({ id: s.reminders.id });
    await signIn(ids.ali, "marina");
    const branch = await loadAreaCashPlan("marina");
    assert.ok(branch.flow, "şube kipinde akış");
    assert.equal(branch.flow.name, "Marina");
    assert.equal(leaks(branch.view.plan), false, "şubenin planında Tuzla'nın kirası ve faturası yok");
    assert.equal(leaks(branch.flow), false);
    assert.equal(branch.view.plan.opening, null, "bakiye firmanın");
    const lines = branch.view.plan.weeks.flatMap((w) => w.lines);
    assert.ok(lines.some((l) => l.key.startsWith("invoice:")), "Marina'nın faturası akışta");
    assert.equal(lines.some((l) => l.key.startsWith("cari:")), false, "faturasız borç akışta değil");
    assert.equal(lines.some((l) => l.kind === "kdv" || l.kind === "vergi" || l.kind === "sgk"), false);
    const taxKeys = new Set(taxRems.map((r) => r.id));
    const isTaxLine = (l: { key: string }) => taxKeys.has(Number(/^reminder:(\d+)@/.exec(l.key)?.[1]));
    assert.equal(lines.some(isTaxLine), false, "Marina'nın SGK hatırlatıcısı şubenin akışında değil");
    assert.equal(JSON.stringify(branch.flow).includes("5.555") || JSON.stringify(branch.flow).includes("5555"), false, "şubesiz KDV hatırlatıcısı İşletme geneli satırında değil");
    assert.equal(branch.flow.shared.some((w) => w.top.some((t) => /KDV|SGK/.test(t.title))), false);
    assert.equal(branch.view.plan.vat, null, "şubenin KDV tahmini yok");
    assert.deepEqual(branch.view.plan.estimates.filter((e) => ["kdv", "vergi", "sgk"].includes(e.key)), [], "Tahmine katılanlar'da vergi ve SGK yok");
    assert.equal(branch.view.plan.taxFirmWide, true);
    const notes = planNotes(branch.view.plan, { komisyon: 0.02, acikGun: 30, invoiceTermDays: 30 });
    assert.deepEqual(notes.filter((n) => ["kdv", "sgk", "vergi"].includes(n.key)).map((n) => n.text), ["Vergi ve SGK ödemeleri firma geneli: Tümü'de görünür."]);
    assert.ok(branch.flow.sharedTotal > 0, "İşletme geneli satırı: muhasebe, ortak fatura, cari");
    const firm = await loadAreaCashPlan(ALL_BRANCHES);
    assert.equal(firm.flow, null);
    assert.equal(leaks(firm.view.plan), true, "firmanın planında Tuzla'nın kirası");
    // Tümü / firma kipi değişmedi: vergi ve SGK hatırlatıcıları firmanın planında
    const firmLines = firm.view.plan.weeks.flatMap((w) => w.lines);
    assert.equal(taxRems.every((r) => firmLines.some((l) => l.key.startsWith(`reminder:${r.id}@`))), true, "firmanın planında KDV ve SGK hatırlatıcısı");
    assert.equal(firm.view.plan.taxFirmWide, undefined);
    await db.delete(s.reminders).where(inArray(s.reminders.id, [...taxKeys]));
  });

  test("Tedarikçiler: şube kipinde Tuzla'nın faturası ve tedarikçisi yok; faturasız borç İşletme geneli; firma kipinde hepsi", async () => {
    const { loadSupplierLedger } = await import("../src/server/data/suppliers");
    const marina = await loadSupplierLedger("marina");
    assert.equal(leaks(marina.groups.map((g) => ({ name: g.name, invoices: g.invoices, account: g.account, cariPayments: g.cariPayments }))), false);
    const sutas = marina.groups.find((g) => g.name === "Sütaş")!;
    assert.equal(sutas.account.open, 1000, "yalnız Marina'nın faturası");
    assert.deepEqual(sutas.shared, { debtOpen: 300, debtOpenCount: 1, credit: 0, balance: 300 });
    assert.equal(sutas.allInvoices.length, 2, "cari düzenleme bütün faturalarla");
    assert.ok(!marina.groups.some((g) => g.name === `${MARK} Gıda`), "kapsamda hiçbir şeyi olmayan tedarikçi listede yok");
    const kept = await loadSupplierLedger("marina", { keepAll: true });
    assert.ok(kept.groups.some((g) => g.name === `${MARK} Gıda` && g.invoices.length === 0), "sayfası adresiyle bulunur");
    const all = await loadSupplierLedger();
    const sutasAll = all.groups.find((g) => g.name === "Sütaş")!;
    assert.equal(sutasAll.account.open, 1000 + AMOUNT + 300);
    assert.equal(sutasAll.shared, null);
  });

  test("bağlantı: odemeler ve tedarikci_ozeti şube kipinde Tuzla'yı vermez, gorunum firma verir; kapsam alanın kipini yazar", async () => {
    const odemeler = await tool("odemeler");
    const tedarikci = await tool("tedarikci_ozeti");
    await signIn(ids.ali, "marina");
    const pay = await odemeler({ aralik: "45gun", nakitPlani: true });
    assert.equal(pay.kapsam, "Marina · ödemeler ve faturalar: Yalnız şube · nakit planı: Yalnız şube");
    assert.equal(leaks(pay), false);
    assert.deepEqual((pay.isletmeGeneli as { faturasizBorc: unknown }).faturasizBorc, { adet: 1, toplam: 300 });
    const payFirm = await odemeler({ aralik: "45gun", gorunum: "firma" });
    assert.equal(payFirm.kapsam, "Marina · ödemeler ve faturalar: Firma geneli");
    assert.equal(leaks(payFirm), true);
    const sup = await tedarikci({ tedarikci: "Sütaş" });
    assert.equal(sup.kapsam, "Marina · tedarikçi bakiyeleri: Yalnız şube");
    assert.equal(leaks(sup), false);
    assert.equal((sup.isletmeGeneli as { faturasizBorc: { tutar: number } }).faturasizBorc.tutar, 300);
    assert.equal(leaks(await tedarikci({ tedarikci: "Sütaş", gorunum: "firma" })), true);
    // Anahtar sahibinin tercihi (bağlantıda oturum yok): withBranchView
    await signIn(ids.ali, "marina", FIRMA);
    assert.deepEqual(await scope.userBranchViewOf(ids.ali), FIRMA);
    assert.equal(leaks(await scope.withBranchView({}, () => odemeler({ aralik: "45gun" }))), false, "boş tercih: varsayılan şube");
    assert.equal(leaks(await odemeler({ aralik: "45gun" })), true, "oturumun tercihi firma");
    // Müdür: firma istese de şubesi
    await signIn(ids.mert, "marina", FIRMA);
    const manager = await odemeler({ aralik: "45gun", gorunum: "firma", nakitPlani: true });
    assert.equal(leaks(manager), false);
    assert.equal(leaks(await tedarikci({ gorunum: "firma" })), false);
  });

  test("Komisyon: gecikmiş hakediş yalnız satışı olan şubenin kipinde; Marina'da yok, Tuzla'da ve firma kipinde var", async () => {
    const commission = await import("../src/server/data/commission");
    await signIn(ids.ali, ALL_BRANCHES);
    const firm = await commission.loadOverduePayouts();
    assert.ok(firm.some((r) => r.label === "Pluxee"), JSON.stringify(firm));
    await signIn(ids.ali, "marina");
    assert.deepEqual(await commission.loadOverduePayouts(), [], "Marina'nın Z'sinde yemek kartı yok");
    assert.equal((await commission.loadCommissionAlerts()).some((a) => a.kind === "gecikti"), false);
    const reports = await commission.loadCommissionReports();
    assert.equal(reports.mode, "sube");
    await signIn(ids.ali, "tuzla");
    assert.ok((await commission.loadOverduePayouts()).some((r) => r.label === "Pluxee"), "Tuzla'nın satışı var");
    await signIn(ids.ali, "marina", FIRMA);
    assert.deepEqual(await commission.loadOverduePayouts(), firm, "firma kipinde işletmenin");
    assert.equal((await commission.loadCommissionReports()).mode, "firma");
  });
});
