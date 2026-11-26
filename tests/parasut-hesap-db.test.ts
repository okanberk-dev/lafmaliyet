// Şube başına Paraşüt hesabı, veritabanında (docs/PARASUT.md › Şube başına Paraşüt hesabı). İki firmalı sahte bir
// Paraşüt'le gerçek Postgres'te:
// - geçiş: Marina "Tuzla ile aynı" (satırı yok) → tek hesap, tek eşitleme, faturalar işletme geneli (bugünkü kural);
// - Marina ayrılır: aynı firma numarası reddedilir; kendi firmasıyla kendi eşitlemesi, kendi oturumu; aynı Paraşüt
//   kimliği iki hesapta iki ayrı satır; Marina'nın faturaları Marina'nın, Tuzla'nın yenileri Tuzla'nın;
// - iki hesap art arda eşitlenince öbür hesabın hiçbir faturası silinmez, cari bağı çözülmez; bir hesapta silinen fatura
//   yalnız o hesaptan kalkar; panelde silinen fatura yalnız kendi hesabında yok sayılır;
// - "Paraşüt hesabını bağla" başlatıldığı hesaba yazar; faturası gelmiş hesap "aynı" yapılamaz.
//
// PARASUT_TEST_DATABASE_URL verilmezse atlanır (test kendi geçici veritabanını açar ve siler).
// Çalıştırma: PARASUT_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/parasut-hesap-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.PARASUT_TEST_DATABASE_URL;
const DB_NAME = `laffogato_parasut_hesap_${process.pid}`;
const BASE = "https://parasut.test";
const TUZLA_CO = "424242";
const MARINA_CO = "535353";

interface FakeBill {
  id: string;
  date: string;
  invoiceNo: string;
  supplier: string;
  amount: number;
}

/** Bugünden n gün önce (YYYY-MM-DD, Türkiye saati) */
function daysAgo(n: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Firma başına gider faturaları; e-fatura yok. Paraşüt kimlikleri iki firmada aynı olabilir (çakışma senaryosu) */
class FakeParasut {
  companies = new Map<string, Map<string, FakeBill>>([
    [TUZLA_CO, new Map()],
    [MARINA_CO, new Map()],
  ]);
  /** Hangi firmaya hangi belirteçle gidildi */
  calls: { company: string; bearer: string }[] = [];
  grants: { grant: string; clientId: string }[] = [];

  reset() {
    for (const m of this.companies.values()) m.clear();
    this.calls = [];
    this.grants = [];
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  private resource(b: FakeBill) {
    const net = b.amount * 1.1;
    return {
      data: {
        id: b.id,
        type: "purchase_bills",
        attributes: {
          item_type: "purchase_bill",
          issue_date: b.date,
          invoice_no: b.invoiceNo,
          currency: "TRL",
          gross_total: String(b.amount),
          total_vat: String(b.amount * 0.1),
          net_total: String(net),
          total_discount: "0",
          total_invoice_discount: "0",
          remaining: String(net),
          payment_status: "unpaid",
          archived: false,
        },
        relationships: {
          supplier: { data: { id: `c-${b.supplier}`, type: "contacts" } },
          category: { data: null },
          details: { data: [{ id: `d${b.id}`, type: "purchase_bill_details" }] },
          active_e_document: { data: null },
        },
      },
      included: [
        { id: `c-${b.supplier}`, type: "contacts", attributes: { name: b.supplier, account_type: "supplier", tax_number: null } },
        { id: `d${b.id}`, type: "purchase_bill_details", attributes: { quantity: "1", unit_price: String(b.amount), vat_rate: "10", net_total: String(b.amount) }, relationships: { product: { data: { id: "p1", type: "products" } } } },
        { id: "p1", type: "products", attributes: { name: "Süt 1 L", code: "SUT1", unit: "Adet" } },
      ],
    };
  }

  handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== BASE) throw new Error(`Beklenmeyen istek: ${url.href}`);
    if (url.pathname === "/oauth/token") {
      const body = new URLSearchParams(String(init?.body ?? ""));
      this.grants.push({ grant: body.get("grant_type") ?? "", clientId: body.get("client_id") ?? "" });
      return this.json({ access_token: `t-${body.get("client_id")}`, refresh_token: `r-${body.get("client_id")}`, expires_in: 7200, created_at: Math.floor(Date.now() / 1000) });
    }
    const m = /^\/v4\/(\d+)\/(.+)$/.exec(url.pathname);
    assert.ok(m, url.pathname);
    const [, company, path] = m;
    const bills = this.companies.get(company);
    assert.ok(bills, `bilinmeyen firma ${company}`);
    this.calls.push({ company, bearer: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "").replace(/^Bearer /, "") });
    if (path === "purchase_bills") {
      const sort = url.searchParams.get("sort") ?? "id";
      let list = [...bills.values()].sort((a, b) => (sort.includes("issue_date") ? a.date.localeCompare(b.date) : 0) || Number(a.id) - Number(b.id));
      if (sort.startsWith("-")) list = list.reverse();
      const size = Number(url.searchParams.get("page[size]") ?? 25);
      const n = Number(url.searchParams.get("page[number]") ?? 1);
      const items = list.slice((n - 1) * size, n * size).map((b) => this.resource(b));
      return this.json({ data: items.map((r) => r.data), included: items.flatMap((r) => r.included), meta: { total_pages: Math.max(1, Math.ceil(list.length / size)), total_count: list.length } });
    }
    const show = /^purchase_bills\/(\w+)$/.exec(path);
    if (show) {
      const b = bills.get(show[1]);
      return b ? this.json(this.resource(b)) : this.json({ errors: [{ title: "Not found" }] }, 404);
    }
    if (path === "e_invoices") return this.json({ data: [], meta: { total_pages: 1, total_count: 0 } });
    if (path === "contacts") return this.json({ data: [], meta: { total_pages: 1 } });
    throw new Error(`Sahte Paraşüt bu isteği bilmiyor: ${path}`);
  };
}

const fake = new FakeParasut();
const realFetch = globalThis.fetch;
const bill = (id: string, over: Partial<FakeBill> = {}): FakeBill => ({ id, date: daysAgo(5), invoiceNo: `FT${id}`, supplier: "Sütaş", amount: 1000, ...over });

describe("Şube başına Paraşüt hesabı: veritabanında (iki firmalı sahte Paraşüt)", { skip: !SERVER_URL && "PARASUT_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let sync: typeof import("../src/server/parasut/sync");
  let accounts: typeof import("../src/server/parasut/accounts");
  let actions: typeof import("../src/server/actions/parasut");
  let links: typeof import("../src/server/actions/branch-settings");

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      AUTH_SECRET: "parasut-hesap-testi-icin-en-az-otuz-iki-karakter",
      // Varsayılan hesap (Tuzla) ortamdan: bugünkü kurulum
      PARASUT_CLIENT_ID: "tuzla-istemci",
      PARASUT_CLIENT_SECRET: "tuzla-sir",
      PARASUT_COMPANY_ID: TUZLA_CO,
      PARASUT_BASE_URL: BASE,
      PARASUT_ISSUER: BASE,
      PARASUT_AUTHORIZE_URL: `${BASE}/oauth/authorize`,
      PARASUT_TOKEN_URL: `${BASE}/oauth/token`,
    });
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(s.branches).values({ id: "marina", name: "Marina", kind: "fiziksel", posSource: "lafpos", sortOrder: 2 }).onConflictDoNothing();
    const [u] = await db.insert(s.users).values({ email: "hesap@laffogato.net", name: "Test", passwordHash: "x", role: "admin" }).returning();
    stub(require.resolve("../src/server/auth/dal"), { requireAdmin: async () => ({ ...u, role: "admin" }), requireUser: async () => ({ ...u, role: "admin" }) });
    const client = await import("../src/server/parasut/client");
    client.PACING.minGapMs = 0;
    client.PACING.retryBaseMs = 0;
    sync = await import("../src/server/parasut/sync");
    accounts = await import("../src/server/parasut/accounts");
    actions = await import("../src/server/actions/parasut");
    links = await import("../src/server/actions/branch-settings");
    globalThis.fetch = fake.handle as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Kayıtlı Paraşüt oturumu (Authorization Code + PKCE'nin sonucu), hesabın adıyla */
  async function seedToken(account: "tuzla" | "marina") {
    const { seal } = await import("../src/server/secret-box");
    const clientId = `${account}-istemci`;
    const value = { sealed: seal(JSON.stringify({ access: `a-${account}`, refresh: `r-${account}`, expiresAt: Date.now() + 3_600_000, clientId, issuer: BASE, refreshedAt: Date.now() })) };
    const key = account === "tuzla" ? "parasut.token" : `parasut.token:${account}`;
    await db.insert(s.integrationState).values({ key, value }).onConflictDoUpdate({ target: s.integrationState.key, set: { value } });
  }

  /** Marina'yı ayrı Paraşüt hesabına geçirir ve kendi firmasının bilgilerini girer */
  async function separateMarina() {
    const off = await links.setBranchSettingLink({ branchId: "marina", group: "parasut", sameAs: null });
    assert.ok(off.ok, JSON.stringify(off));
    const saved = await actions.saveParasutSettings({ clientId: "marina-istemci", clientSecret: "marina-GIZLI", companyId: MARINA_CO, syncFrom: "" }, "marina");
    assert.ok(saved.ok, JSON.stringify(saved));
    await seedToken("marina");
  }

  async function syncAll() {
    const list = await accounts.configuredParasutAccounts();
    const r = await sync.syncParasutAccounts("cron", { accounts: list, deadlineMs: 40_000 });
    assert.ok(r.ok, JSON.stringify(r));
    return r;
  }

  /** Faturalar hesap (Tuzla önce) ve Paraşüt kimliğiyle sıralı */
  const rows = () =>
    db
      .select({ id: s.invoices.id, externalId: s.invoices.externalId, parasutAccount: s.invoices.parasutAccount, branchId: s.invoices.branchId, supplier: s.invoices.supplier })
      .from(s.invoices)
      .orderBy(sql`${s.invoices.parasutAccount} = 'tuzla' desc`, asc(s.invoices.externalId));

  beforeEach(async () => {
    fake.reset();
    await db.execute(sql`TRUNCATE invoices, parasut_sync_runs, parasut_bill_lines, integration_state, activity_log, branch_settings, supplier_allocations, supplier_entries, suppliers RESTART IDENTITY CASCADE`);
    await seedToken("tuzla");
  });

  test("geçiş: Marina 'Tuzla ile aynı' (satırı yok) → tek hesap, tek eşitleme; faturanın şubesi tedarikçinin varsayılanı, yoksa seçilmemiş", async () => {
    fake.companies.get(TUZLA_CO)!.set("700", bill("700"));
    fake.companies.get(TUZLA_CO)!.set("701", bill("701", { supplier: "Pınar" }));
    // Pınar'ın kartı Marina'yı varsayılan seçmiş (Tedarikçiler); Sütaş'ın kartı yok: tahminle şube yazılmaz
    await db.insert(s.suppliers).values({ name: "Pınar", key: "pinar", defaultBranchId: "marina" });
    const list = await accounts.configuredParasutAccounts();
    assert.deepEqual(
      list.map((a) => [a.id, a.users]),
      [["tuzla", ["tuzla", "marina"]]],
    );
    assert.equal(await accounts.parasutAccountOf("marina"), "tuzla");
    await syncAll();
    const runs = await db.select({ account: s.parasutSyncRuns.account }).from(s.parasutSyncRuns);
    assert.deepEqual(runs, [{ account: "tuzla" }], "aynı firma bir kez eşitlendi");
    assert.ok(fake.calls.every((c) => c.company === TUZLA_CO));
    assert.deepEqual(
      (await rows()).map((r) => [r.externalId, r.parasutAccount, r.branchId]),
      [
        ["700", "tuzla", null],
        ["701", "tuzla", "marina"],
      ],
    );
    // Hesap anahtarları eski adlarla (veri göçü yok)
    const keys = (await db.select({ key: s.integrationState.key }).from(s.integrationState)).map((k) => k.key);
    assert.ok(keys.includes("parasut.cursor") && keys.includes("parasut.token"), keys.join(","));
    assert.ok(!keys.some((k) => k.includes(":tuzla")), "varsayılan hesap öneksiz");
  });

  test("ayrı hesap: aynı firma reddedilir; iki firma ayrı eşitlenir, aynı kimlik iki satır, faturanın şubesi hesabın", async () => {
    const off = await links.setBranchSettingLink({ branchId: "marina", group: "parasut", sameAs: null });
    assert.ok(off.ok, JSON.stringify(off));
    // Aynı firma iki hesapta olamaz (faturalar çiftlenirdi)
    const clash = await actions.saveParasutSettings({ clientId: "marina-istemci", clientSecret: "marina-GIZLI", companyId: TUZLA_CO, syncFrom: "" }, "marina");
    assert.equal(clash.ok, false);
    assert.match(!clash.ok ? clash.error : "", /Tuzla şubesinin Paraşüt hesabında zaten bağlı/);
    // Ortam değişkenleri Marina'ya geçmez: ayarları boş
    const before = await (await import("../src/server/parasut/config")).loadParasutSettings("marina");
    assert.equal(before.resolved.clientId.value, null, "Vercel'deki istemciyi devralmaz");
    const saved = await actions.saveParasutSettings({ clientId: "marina-istemci", clientSecret: "marina-GIZLI", companyId: MARINA_CO, syncFrom: "" }, "marina");
    assert.ok(saved.ok, JSON.stringify(saved));
    const stored = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.settings:marina"));
    assert.equal(stored.length, 1);
    assert.equal(JSON.stringify(stored[0].value).includes("marina-GIZLI"), false, "secret şifreli");
    await seedToken("marina");

    // Aynı Paraşüt kimliği (700) iki firmada
    fake.companies.get(TUZLA_CO)!.set("700", bill("700", { supplier: "Sütaş" }));
    fake.companies.get(MARINA_CO)!.set("700", bill("700", { supplier: "Pınar" }));
    fake.companies.get(MARINA_CO)!.set("701", bill("701", { supplier: "Pınar" }));
    const r = await syncAll();
    assert.deepEqual(
      r.accounts.map((a) => [a.account, a.ok]),
      [
        ["tuzla", true],
        ["marina", true],
      ],
    );
    const runs = await db.select({ account: s.parasutSyncRuns.account }).from(s.parasutSyncRuns).orderBy(asc(s.parasutSyncRuns.id));
    assert.deepEqual(
      runs.map((x) => x.account),
      ["tuzla", "marina"],
    );
    // Her firmaya kendi oturumuyla gidildi
    assert.ok(fake.calls.filter((c) => c.company === TUZLA_CO).every((c) => c.bearer === "a-tuzla"));
    assert.ok(fake.calls.filter((c) => c.company === MARINA_CO).every((c) => c.bearer === "a-marina"));
    assert.deepEqual(
      (await rows()).map((x) => [x.externalId, x.parasutAccount, x.branchId, x.supplier]),
      [
        ["700", "tuzla", "tuzla", "Sütaş"],
        ["700", "marina", "marina", "Pınar"],
        ["701", "marina", "marina", "Pınar"],
      ],
    );
    // Kalem kimliği ve ürün anahtarı: Tuzla eski biçim, Marina hesap önekli (benzersiz indeks çakışmaz)
    const lines = await db.select({ externalId: s.parasutBillLines.externalId, productKey: s.parasutBillLines.productKey }).from(s.parasutBillLines).orderBy(asc(s.parasutBillLines.externalId));
    assert.deepEqual(
      lines.map((l) => [l.externalId, l.productKey]),
      [
        ["d700", "p:p1"],
        ["marina:d700", "p:marina:p1"],
        ["marina:d701", "p:marina:p1"],
      ],
    );
    // Durum anahtarları hesap adıyla
    const keys = (await db.select({ key: s.integrationState.key }).from(s.integrationState)).map((k) => k.key);
    assert.ok(keys.includes("parasut.cursor") && keys.includes("parasut.cursor:marina"), keys.join(","));

    // Ayrı hesabın faturaları hesabın şubesine yazılmayabilir ("shared"): yalnız yeni faturalar, tedarikçinin varsayılanı
    // yoksa şubesi seçilmemiş
    const scope = await actions.setParasutInvoiceScope("shared", "marina");
    assert.ok(scope.ok);
    fake.companies.get(MARINA_CO)!.set("702", bill("702", { supplier: "Pınar" }));
    await syncAll();
    const after702 = (await rows()).filter((x) => x.parasutAccount === "marina");
    assert.deepEqual(
      after702.map((x) => [x.externalId, x.branchId]),
      [
        ["700", "marina"],
        ["701", "marina"],
        ["702", null],
      ],
      "var olanların şubesi değişmedi",
    );
    // Seçim kayıtlı secret'a dokunmaz
    assert.equal((await (await import("../src/server/parasut/config")).loadParasutSettings("marina")).resolved.clientSecret.value, "marina-GIZLI");

    // Faturanın şubesi okumada (sahibin kararı 2): Tuzla seçiliyken Marina'nın ayrı hesabının faturası modele (Maliyet,
    // Gelir-gider, Faturalar) girmez. Şubesi seçilmemiş fatura ("shared" seçimli 702; tedarikçinin varsayılanı yok) tek şubede görünmez, "Tümü"de hepsi (docs/SUBE.md › Faturanın şubesi)
    const { loadModel } = await import("../src/server/data/dataset");
    const ids = async (scope: string) =>
      (await loadModel({ scope })).ds.invoices
        .filter((i) => i.source === "parasut")
        .map((i) => `${i.externalId}:${i.supplier}`)
        .sort();
    // Marina ayrılınca Tuzla'nın hesabını yalnız Tuzla kullanır: 700 Tuzla'nın
    assert.deepEqual(await ids("tuzla"), ["700:Sütaş"]);
    assert.deepEqual(await ids("marina"), ["700:Pınar", "701:Pınar"]);
    assert.deepEqual(await ids("hepsi"), ["700:Pınar", "700:Sütaş", "701:Pınar", "702:Pınar"]);

    // Süre ikinci hesaba yetmezse hata değil "kısmen": hesap sonraki eşitlemeye kalır (tek hesapta süre dolması gibi)
    const list = await accounts.configuredParasutAccounts();
    const short = await sync.syncParasutAccounts("cron", { accounts: list, deadlineMs: 15_000 });
    assert.ok(short.ok, JSON.stringify(short));
    assert.ok(short.ok && short.partial, "kısmen");
    assert.deepEqual(
      short.accounts.map((a) => [a.account, a.ok, a.deferred ?? false]),
      [
        ["tuzla", true, false],
        ["marina", false, true],
      ],
    );
  });

  test("iki hesap art arda eşitlenince öbürünün faturası silinmez, cari bağı çözülmez; silinen yalnız kendi hesabından kalkar", async () => {
    await separateMarina();
    fake.companies.get(TUZLA_CO)!.set("800", bill("800", { supplier: "Sütaş" }));
    fake.companies.get(MARINA_CO)!.set("800", bill("800", { supplier: "Pınar" }));
    fake.companies.get(MARINA_CO)!.set("801", bill("801", { supplier: "Pınar" }));
    await syncAll();
    // Tuzla'nın 800'üne cari ödemesi sayılmış (tedarikçi kartı ve dağıtım)
    const tuzla800 = (await rows()).find((x) => x.parasutAccount === "tuzla" && x.externalId === "800")!;
    const [card] = await db.insert(s.suppliers).values({ name: "Sütaş", key: "sutas" }).returning();
    const [pay] = await db.insert(s.supplierEntries).values({ supplierId: card.id, kind: "odeme", date: daysAgo(1), amount: 500, method: "havale", createdByName: "Test" }).returning();
    await db.insert(s.supplierAllocations).values({ paymentId: pay.id, invoiceId: tuzla800.id, amount: 500, createdByName: "Test" });

    // Marina'nın firmasında 800 silindi; iki hesap yine art arda eşitlenir
    fake.companies.get(MARINA_CO)!.delete("800");
    await syncAll();
    await syncAll();
    assert.deepEqual(
      (await rows()).map((x) => [x.externalId, x.parasutAccount]),
      [
        ["800", "tuzla"],
        ["801", "marina"],
      ],
      "yalnız Marina'nın 800'ü kalktı",
    );
    const alloc = await db.select().from(s.supplierAllocations);
    assert.deepEqual(
      alloc.map((a) => [a.invoiceId, a.amount]),
      [[tuzla800.id, 500]],
      "Tuzla faturasının cari bağı duruyor",
    );

    // Panelde silinen fatura yalnız kendi hesabında yok sayılır: Marina'nın 801'i silinir, Tuzla'da aynı kimlik gelir
    const invoices = await import("../src/server/actions/invoices");
    const m801 = (await rows()).find((x) => x.parasutAccount === "marina" && x.externalId === "801")!;
    const del = await invoices.deleteInvoice(m801.id);
    assert.ok(del.ok, JSON.stringify(del));
    assert.equal(del.ok && del.data.externalId, "marina/801");
    const [ignore] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.ignore"));
    assert.deepEqual(ignore.value, ["marina/801"]);
    fake.companies.get(TUZLA_CO)!.set("801", bill("801", { supplier: "Sütaş" }));
    await syncAll();
    assert.deepEqual(
      (await rows()).map((x) => [x.externalId, x.parasutAccount]),
      [
        ["800", "tuzla"],
        ["801", "tuzla"],
      ],
      "Marina'nın 801'i geri gelmedi, Tuzla'nın 801'i geldi",
    );
    // Geri alınca kendi hesabına döner
    const back = await invoices.unignoreParasutBill("marina/801");
    assert.ok(back.ok && back.data.status === "restored", JSON.stringify(back));
    const restored = (await rows()).find((x) => x.parasutAccount === "marina" && x.externalId === "801");
    assert.ok(restored, "Marina'nın 801'i kendi hesabıyla geri yazıldı");
  });

  test("'Paraşüt hesabını bağla' başlatıldığı hesaba yazar; faturası gelmiş hesap 'aynı' yapılamaz", async () => {
    const off = await links.setBranchSettingLink({ branchId: "marina", group: "parasut", sameAs: null });
    assert.ok(off.ok);
    assert.ok((await actions.saveParasutSettings({ clientId: "marina-istemci", clientSecret: "marina-GIZLI", companyId: MARINA_CO, syncFrom: "" }, "marina")).ok);
    const connect = await import("../src/server/parasut/connect");
    const client = await import("../src/server/parasut/client");
    const to = new URL(await connect.startParasutConnect("marina", "Patron"));
    assert.equal(to.searchParams.get("client_id"), "marina-istemci", "Marina'nın istemcisiyle");
    // Tuzla'nın oturumunu sıfırlamak Marina'nın süren bağlanmasını bozmaz
    await connect.forgetParasutConnect("tuzla");
    const done = await connect.finishParasutConnect({ code: "kod-m", state: to.searchParams.get("state") }, (a) => accounts.isParasutAccount(a));
    assert.deepEqual(done, { by: "Patron", account: "marina" });
    assert.deepEqual(fake.grants, [{ grant: "authorization_code", clientId: "marina-istemci" }]);
    assert.equal((await client.parasutConnection(undefined, undefined, "marina")).connected, true);
    const [tuzlaToken] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.token"));
    assert.ok(tuzlaToken, "Tuzla'nın oturumu yerinde");
    assert.equal((await client.parasutConnection()).connected, true, "Tuzla bağlı kaldı");

    // Marina'nın hesabından fatura geldi: Tuzla'ya bağlanamaz
    fake.companies.get(MARINA_CO)!.set("900", bill("900"));
    await syncAll();
    const link = await links.setBranchSettingLink({ branchId: "marina", group: "parasut", sameAs: "tuzla" });
    assert.equal(link.ok, false);
    assert.match(!link.ok ? link.error : "", /kendi Paraşüt hesabından fatura geldi/);
  });

  test("faturası yokken 'aynı' açılınca şubenin hesabı temizlenir; kapatılınca kopyalanmaz", async () => {
    await separateMarina();
    await db.insert(s.integrationState).values({ key: "parasut.cursor:marina", value: { lastIssueDate: daysAgo(3) } });
    const on = await links.setBranchSettingLink({ branchId: "marina", group: "parasut", sameAs: "tuzla" });
    assert.ok(on.ok, JSON.stringify(on));
    const keys = (await db.select({ key: s.integrationState.key }).from(s.integrationState)).map((k) => k.key);
    assert.deepEqual(
      keys.filter((k) => k.endsWith(":marina")),
      [],
      "Marina'nın ayarları, oturumu ve imleci silindi",
    );
    assert.equal(await accounts.parasutAccountOf("marina"), "tuzla");
    assert.deepEqual(
      (await accounts.configuredParasutAccounts()).map((a) => a.id),
      ["tuzla"],
    );
    // Yeniden ayrılınca boş hesapla başlar (Tuzla'nın bilgileri kopyalanmaz)
    assert.ok((await links.setBranchSettingLink({ branchId: "marina", group: "parasut", sameAs: null })).ok);
    const cfg = await (await import("../src/server/parasut/config")).loadParasutSettings("marina");
    assert.deepEqual([cfg.resolved.clientId.value, cfg.resolved.companyId.value], [null, null]);
    assert.deepEqual(
      (await accounts.configuredParasutAccounts()).map((a) => a.id),
      ["tuzla"],
      "ayarı eksik hesap eşitlenmez",
    );
  });
});
