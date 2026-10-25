// Paraşüt eşitlemesinin veritabanı tarafı (src/server/parasut/sync.ts: applyDraft, retire, applyEInvoice,
// catchLateBills, istemcinin oturum ve 429 yolları), sahte bir Paraşüt'le gerçek Postgres'te. Her senaryo eşitlemeyi
// art arda çalıştırır ve paneldeki kayda bakar:
// - e-faturaya bağlı gider faturası Paraşüt'te silinir ya da iptal edilir: kayıt silinmez, ödeme durumu, kategori ve not
//   kalır (eskiden silinip "ödenmedi" geri geliyordu);
// - e-fatura Paraşüt'te yeniden içeri alınır (eski gider faturası silinmiş): tek kayıt yeni faturaya geçer; eski fatura
//   hâlâ duruyorsa yenisi kontrol bekler;
// - sitenin satış iadesi (müşteri kartı, LAF- ürünü) ve gelen iade e-faturası gider sayılmaz, eskiden alınmışsa kalkar;
//   tedarikçiye iade (giden iade e-faturası) panele girmez, listelenir;
// - tarihi pencereden eski, sonradan girilmiş fatura kimlik sırasıyla yakalanır;
// - 429'da yeniden denenir; yenileme belirteci reddedilince parolayla girilir.
//
// PARASUT_TEST_DATABASE_URL verilmezse atlanır. Bir Postgres sunucusunun adresi (veritabanı oluşturabilen kullanıcı):
// test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler; verilen veritabanına dokunmaz.
// Çalıştırma: PARASUT_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/parasut-esitleme-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.PARASUT_TEST_DATABASE_URL;
const DB_NAME = `laffogato_parasut_test_${process.pid}`;
const BASE = "https://parasut.test";
const COMPANY = "424242";

// ---------------------------------------------------------------- Sahte Paraşüt

interface FakeContact {
  id: string;
  name: string;
  accountType: "supplier" | "customer";
  taxNumber: string | null;
}
interface FakeLine {
  id: string;
  productId: string;
  name: string;
  code: string;
  qty: number;
  price: number;
  vatRate: number;
}
interface FakeBill {
  id: string;
  itemType: string;
  date: string;
  invoiceNo: string | null;
  contact: FakeContact;
  amount: number;
  vat: number;
  unpaid: boolean;
  /** Paraşüt'te kısmen ödenmiş: kalan (verilmezse ödenmemişte tamamı, ödenmişte 0) */
  remaining?: number;
  eInvoiceId?: string;
  lines: FakeLine[];
}
interface FakeEInvoice {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  date: string;
  invoiceNo: string;
  contactName: string;
  fromVkn: string | null;
  toVkn: string | null;
  net: number;
  vat: number;
  importedBillId?: string;
}

class FakeParasut {
  bills = new Map<string, FakeBill>();
  eInvoices = new Map<string, FakeEInvoice>();
  grants: string[] = [];
  requests: string[] = [];
  /** Sonraki N fatura listesi isteği 429 döner */
  throttle = 0;
  /** Yol → bu yola gelecek sonraki N istek bağlantı hatasıyla düşer (ağ, zaman aşımı) */
  failures = new Map<string, number>();
  rejectRefresh = false;
  private tokens = 0;

  reset() {
    this.bills.clear();
    this.eInvoices.clear();
    this.grants = [];
    this.requests = [];
    this.throttle = 0;
    this.failures.clear();
    this.rejectRefresh = false;
  }

  private json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }

  private eDocResource(e: FakeEInvoice) {
    return {
      id: e.id,
      type: "e_invoices",
      attributes: {
        external_id: e.invoiceNo,
        uuid: `uuid-${e.id}`,
        direction: e.direction,
        contact_name: e.contactName,
        from_vkn: e.fromVkn,
        to_vkn: e.toVkn,
        issue_date: e.date,
        net_total: String(e.net),
        total_vat: String(e.vat),
        currency: "TRL",
        invoice_type_code: e.type,
        response_type: null,
        archived: false,
      },
      relationships: { invoice: { data: e.importedBillId ? { id: e.importedBillId, type: "purchase_bills" } : null } },
    };
  }

  private billResource(b: FakeBill) {
    const gross = b.amount;
    const net = b.amount + b.vat;
    const data = {
      id: b.id,
      type: "purchase_bills",
      attributes: {
        item_type: b.itemType,
        issue_date: b.date,
        due_date: null,
        invoice_no: b.invoiceNo,
        currency: "TRL",
        gross_total: String(gross),
        total_vat: String(b.vat),
        net_total: String(net),
        total_discount: "0",
        total_invoice_discount: "0",
        remaining: b.remaining !== undefined ? String(b.remaining) : b.unpaid ? String(net) : "0",
        payment_status: b.remaining !== undefined ? "partially_paid" : b.unpaid ? "unpaid" : "paid",
        archived: false,
      },
      relationships: {
        supplier: { data: { id: b.contact.id, type: "contacts" } },
        category: { data: null },
        details: { data: b.lines.map((l) => ({ id: l.id, type: "purchase_bill_details" })) },
        active_e_document: { data: b.eInvoiceId ? { id: b.eInvoiceId, type: "e_invoices" } : null },
      },
    };
    const included: unknown[] = [
      { id: b.contact.id, type: "contacts", attributes: { name: b.contact.name, account_type: b.contact.accountType, tax_number: b.contact.taxNumber } },
      ...b.lines.flatMap((l) => [
        {
          id: l.id,
          type: "purchase_bill_details",
          attributes: { quantity: String(l.qty), unit_price: String(l.price), vat_rate: String(l.vatRate), net_total: String(l.qty * l.price) },
          relationships: { product: { data: { id: l.productId, type: "products" } } },
        },
        { id: l.productId, type: "products", attributes: { name: l.name, code: l.code, unit: "Adet" } },
      ]),
    ];
    const e = b.eInvoiceId ? this.eInvoices.get(b.eInvoiceId) : undefined;
    if (e) included.push(this.eDocResource(e));
    return { data, included };
  }

  private page<T>(items: T[], url: URL) {
    const size = Number(url.searchParams.get("page[size]") ?? 25);
    const n = Number(url.searchParams.get("page[number]") ?? 1);
    return { items: items.slice((n - 1) * size, n * size), meta: { current_page: n, total_pages: Math.max(1, Math.ceil(items.length / size)), total_count: items.length } };
  }

  handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== BASE) throw new Error(`Beklenmeyen istek: ${url.href}`);
    if (url.pathname === "/oauth/token") {
      const grant = new URLSearchParams(String(init?.body ?? "")).get("grant_type") ?? "";
      this.grants.push(grant);
      if (grant === "refresh_token" && this.rejectRefresh) return this.json({ error: "invalid_grant" }, 400);
      this.tokens++;
      const created = Math.floor(Date.now() / 1000);
      return this.json({ access_token: `t${this.tokens}`, refresh_token: `r${this.tokens}`, expires_in: 7200, created_at: created });
    }
    const prefix = `/v4/${COMPANY}/`;
    assert.ok(url.pathname.startsWith(prefix), url.pathname);
    const path = url.pathname.slice(prefix.length);
    this.requests.push(`${path}?${url.searchParams.get("sort") ?? ""}`);
    const fails = this.failures.get(path) ?? 0;
    if (fails > 0) {
      this.failures.set(path, fails - 1);
      throw new TypeError("fetch failed");
    }
    if (path === "purchase_bills") {
      if (this.throttle > 0) {
        this.throttle--;
        return this.json({ errors: [{ detail: "Too many requests" }] }, 429, { "retry-after": "0" });
      }
      const sort = url.searchParams.get("sort") ?? "id";
      const supplierId = url.searchParams.get("filter[supplier_id]");
      let list = [...this.bills.values()].filter((b) => !supplierId || b.contact.id === supplierId);
      const key = sort.replace(/^-/, "");
      list.sort((a, b) => (key === "issue_date" ? a.date.localeCompare(b.date) || Number(a.id) - Number(b.id) : Number(a.id) - Number(b.id)));
      if (sort.startsWith("-")) list = list.reverse();
      const { items, meta } = this.page(list, url);
      const res = items.map((b) => this.billResource(b));
      return this.json({ data: res.map((r) => r.data), included: res.flatMap((r) => r.included), meta });
    }
    const show = /^purchase_bills\/(\w+)$/.exec(path);
    if (show) {
      const b = this.bills.get(show[1]);
      if (!b) return this.json({ errors: [{ title: "Not found" }] }, 404);
      return this.json(this.billResource(b));
    }
    if (path === "e_invoices") {
      const list = [...this.eInvoices.values()].sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
      const { items, meta } = this.page(list, url);
      return this.json({ data: items.map((e) => this.eDocResource(e)), meta });
    }
    if (/^e_invoices\/\w+\/signed_ubl$/.test(path)) return this.json({ errors: [{ title: "Not found" }] }, 404);
    const contact = /^contacts\/(\w+)$/.exec(path);
    if (contact) {
      const c = [...this.bills.values()].map((b) => b.contact).find((x) => x.id === contact[1]);
      return c ? this.json({ data: { id: c.id, type: "contacts", attributes: { name: c.name, account_type: c.accountType, tax_number: c.taxNumber } } }) : this.json({}, 404);
    }
    if (path === "contacts") return this.json({ data: [], meta: { total_pages: 1 } });
    throw new Error(`Sahte Paraşüt bu isteği bilmiyor: ${path}`);
  };
}

// ---------------------------------------------------------------- Yardımcılar

const fake = new FakeParasut();
const realFetch = globalThis.fetch;

/** Bugünden n gün önce (YYYY-MM-DD, Türkiye saati) */
function daysAgo(n: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const SUTAS: FakeContact = { id: "c1", name: "SÜTAŞ SÜT ÜRÜNLERİ A.Ş.", accountType: "supplier", taxNumber: "7810030532" };
const CUSTOMER: FakeContact = { id: "c9", name: "Ayşe Yılmaz", accountType: "customer", taxNumber: "11111111111" };
const milk = (id: string): FakeLine => ({ id: `l${id}`, productId: "p1", name: "Süt 1 L", code: "SUT1", qty: 10, price: 100, vatRate: 10 });

function bill(id: string, over: Partial<FakeBill> = {}): FakeBill {
  return { id, itemType: "purchase_bill", date: daysAgo(5), invoiceNo: `SUT2026${id.padStart(9, "0")}`, contact: SUTAS, amount: 1000, vat: 100, unpaid: true, lines: [milk(id)], ...over };
}

function eInvoice(id: string, over: Partial<FakeEInvoice> = {}): FakeEInvoice {
  return { id, direction: "inbound", type: "SATIS", date: daysAgo(5), invoiceNo: `SUT2026${id.padStart(9, "0")}`, contactName: SUTAS.name, fromVkn: SUTAS.taxNumber, toVkn: null, net: 1100, vat: 100, ...over };
}

describe("Paraşüt eşitlemesi: veritabanında akış (sahte Paraşüt)", { skip: !SERVER_URL && "PARASUT_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let sync: typeof import("../src/server/parasut/sync");
  let db: import("../src/server/db").DB;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      AUTH_SECRET: "parasut-esitleme-testi-icin-en-az-otuz-iki-karakter",
      PARASUT_CLIENT_ID: "test-istemci",
      PARASUT_CLIENT_SECRET: "test-sir",
      PARASUT_USERNAME: "api@kafe.test",
      PARASUT_PASSWORD: "parola",
      PARASUT_COMPANY_ID: COMPANY,
      PARASUT_BASE_URL: BASE,
    });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const client = await import("../src/server/parasut/client");
    client.PACING.minGapMs = 0;
    client.PACING.retryBaseMs = 0;
    sync = await import("../src/server/parasut/sync");
    globalThis.fetch = fake.handle as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    fake.reset();
    await db.execute(sql`TRUNCATE invoices, parasut_sync_runs, integration_state, activity_log RESTART IDENTITY CASCADE`);
  });

  async function run() {
    const r = await sync.syncParasut("manual");
    assert.ok(r.ok, JSON.stringify(r));
    return r;
  }
  const rows = () => db.select().from(s.invoices).orderBy(s.invoices.id);

  /** E1 gelen e-faturası: önce içeri alınmadan açılır, sonra B1 olarak içeri alınır; kayıt ödendi işaretlenir */
  async function linkedAndPaid() {
    fake.eInvoices.set("801", eInvoice("801"));
    await run();
    fake.bills.set("101", bill("101", { eInvoiceId: "801" }));
    fake.eInvoices.get("801")!.importedBillId = "101";
    await run();
    const [r] = await rows();
    assert.equal(r.externalId, "101");
    assert.equal(r.eInvoiceId, "801");
    await db.update(s.invoices).set({ unpaid: false, paidAt: daysAgo(1), paidVia: "havale", category: "Hammadde & İçecek", note: "Havaleyle ödendi" }).where(eq(s.invoices.id, r.id));
    return r.id;
  }

  test("e-faturaya bağlı gider faturası Paraşüt'te silinir: kayıt kalır, ödeme durumu, kategori ve not korunur", async () => {
    const id = await linkedAndPaid();
    fake.bills.delete("101");
    delete fake.eInvoices.get("801")!.importedBillId;
    await run();
    const list = await rows();
    assert.equal(list.length, 1, "e-fatura yeni kayıt olarak geri gelmez");
    const [r] = list;
    assert.equal(r.id, id);
    assert.equal(r.externalId, null);
    assert.equal(r.eInvoiceId, "801");
    assert.equal(r.unpaid, false);
    assert.equal(r.paidVia, "havale");
    assert.equal(r.category, "Hammadde & İçecek");
    assert.equal(r.note, "Havaleyle ödendi");
    // Gider faturasının kalemi gitti; e-faturanın kalemleri sıradaki okumada belgeden okunur
    assert.equal(r.ublReadAt === null || r.ublReadAt instanceof Date, true);
    // Bir sonraki eşitleme de değiştirmez
    await run();
    assert.equal((await rows()).length, 1);
  });

  test("e-fatura yeniden içeri alınır (eski gider faturası silinmiş): tek kayıt yeni faturaya geçer, ödemesi korunur", async () => {
    const id = await linkedAndPaid();
    fake.bills.delete("101");
    fake.bills.set("102", bill("102", { eInvoiceId: "801" }));
    fake.eInvoices.get("801")!.importedBillId = "102";
    const r = await run();
    const list = await rows();
    assert.equal(list.length, 1, "çift kayıt açılmaz");
    assert.equal(list[0].id, id);
    assert.equal(list[0].externalId, "102");
    assert.equal(list[0].unpaid, false);
    assert.equal(list[0].note, "Havaleyle ödendi");
    assert.match(r.summary, /0 yeni/);
  });

  test("aynı e-fatura iki duran gider faturasında: yenisi açılır ama kontrol bekler", async () => {
    await linkedAndPaid();
    fake.bills.set("102", bill("102", { eInvoiceId: "801", invoiceNo: "SUT2026000000999" }));
    await run();
    const list = await rows();
    assert.equal(list.length, 2);
    const twin = list.find((x) => x.externalId === "102")!;
    assert.equal(twin.needsReview, true);
    assert.match(twin.note ?? "", /aynı e-fatura başka bir gider faturasında da var/);
    assert.equal(twin.eInvoiceId, null);
  });

  test("eski gider faturası Paraşüt'ten okunamaz (ağ hatası): yeni fatura ödenmedi ikinci kayıt açmaz, sonraki eşitlemede kayda geçer", async () => {
    const id = await linkedAndPaid();
    fake.bills.delete("101");
    fake.bills.set("102", bill("102", { eInvoiceId: "801" }));
    fake.eInvoices.get("801")!.importedBillId = "102";
    // Eski faturanın her okuması bu çalışmada düşer: taşıma denetimi, yeniden denetim, geç girilenler taraması
    fake.failures.set("purchase_bills/101", 3);
    await run();
    let list = await rows();
    assert.equal(list.length, 1, "aynı e-fatura için ikinci (ödenmedi) kayıt açılmaz");
    assert.equal(list[0].externalId, "101", "bilinmeyen durumda kayıt yerinde kalır");
    assert.equal(list[0].unpaid, false);
    const [mark] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.lastBillId"));
    assert.equal((mark.value as { id: number }).id, 101, "ertelenen fatura geç girilenler taramasında geçilmez");
    // Sonraki eşitleme eski faturayı okur (silinmiş): kayıt yeni faturaya geçer, ödemesi ve notu korunur
    await run();
    list = await rows();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].externalId, "102");
    assert.equal(list[0].eInvoiceId, "801");
    assert.equal(list[0].unpaid, false);
    assert.equal(list[0].note, "Havaleyle ödendi");
    const [mark2] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.lastBillId"));
    assert.equal((mark2.value as { id: number }).id, 102);
  });

  test("eski fatura aynı çalışmada yeniden denetimde silinmiş görülür: kayıt aynı çalışmada yeni faturaya geçer", async () => {
    const id = await linkedAndPaid();
    fake.bills.delete("101");
    fake.bills.set("102", bill("102", { eInvoiceId: "801" }));
    fake.eInvoices.get("801")!.importedBillId = "102";
    fake.failures.set("purchase_bills/101", 1);
    const r = await run();
    const list = await rows();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].externalId, "102");
    assert.equal(list[0].unpaid, false);
    assert.match(r.summary, /0 yeni/);
  });

  test("iptal edilen gider faturası: e-faturası varsa kayıt kalır, yoksa kalkar", async () => {
    const id = await linkedAndPaid();
    fake.bills.set("103", bill("103", { invoiceNo: "SUT2026000000103", amount: 500, vat: 50 }));
    await run();
    assert.equal((await rows()).length, 2);
    fake.bills.get("101")!.itemType = "cancelled";
    fake.bills.get("103")!.itemType = "cancelled";
    await run();
    const list = await rows();
    assert.deepEqual(
      list.map((x) => x.id),
      [id],
      "e-faturasız iptal kalktı",
    );
    assert.equal(list[0].externalId, null);
    assert.equal(list[0].unpaid, false);
  });

  test("sitenin satış iadesi ve gelen iade e-faturası gider sayılmaz; tedarikçiye iade listelenir", async () => {
    // Eski davranışla gider olarak alınmış satış iadesi ve gelen iade e-faturası (kaldırılmalı)
    await db.insert(s.invoices).values([
      { date: daysAgo(3), supplier: "Ayşe Yılmaz", category: "Diğer", amount: -1000, vat: -200, payable: -1200, source: "parasut", origin: "parasut", externalId: "201" },
      { date: daysAgo(4), supplier: "ÖRNEK GIDA A.Ş.", category: "Diğer", amount: -500, vat: -100, payable: -600, source: "parasut", origin: "parasut", eInvoiceId: "802" },
    ]);
    fake.bills.set("201", bill("201", { itemType: "refund", contact: CUSTOMER, date: daysAgo(3), invoiceNo: null, lines: [{ ...milk("201"), name: "Mağaza ürünü (KDV %20)", code: "LAF-MAGAZA-20" }] }));
    fake.eInvoices.set("802", eInvoice("802", { type: "IADE", date: daysAgo(4), contactName: "ÖRNEK GIDA A.Ş.", fromVkn: "1234567891", net: 600 }));
    fake.eInvoices.set("803", eInvoice("803", { direction: "outbound", type: "IADE", date: daysAgo(2), contactName: "SÜTAŞ A.Ş.", fromVkn: null, toVkn: SUTAS.taxNumber, net: 2200, vat: 200 }));
    const r = await run();
    assert.deepEqual(await rows(), [], "iki eski kayıt kalktı, yenisi açılmadı");
    assert.match(r.summary, /2 satış iadesi gider sayılmadı/);
    assert.match(r.summary, /1 tedarikçiye iade panele girmedi/);
    const [state] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.returns"));
    const log = state.value as { sales: { id: string; supplier?: string }[]; supplier: { id: string; supplier?: string; taxNumber?: string; amount: number }[] };
    assert.deepEqual(log.sales.map((e) => e.id).sort(), ["201", "ei:802"]);
    assert.ok(log.sales.every((e) => !("supplier" in e)), "müşterinin adı saklanmaz");
    assert.deepEqual(log.supplier.map((e) => [e.id, e.supplier, e.taxNumber, e.amount]), [["ei:803", "SÜTAŞ A.Ş.", "7810030532", 2200]]);
    // Ertesi gün aynı iadeler yeniden yazılmaz
    const again = await run();
    assert.doesNotMatch(again.summary, /iade/);
  });

  test("tarihi pencereden eski, sonradan girilen fatura kimlik sırasıyla alınır", async () => {
    fake.bills.set("301", bill("301", { date: daysAgo(3) }));
    await run();
    const [mark] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.lastBillId"));
    assert.equal((mark.value as { id: number }).id, 301, "ilk çalışma yalnız en büyük kimliği kaydeder");
    fake.bills.set("302", bill("302", { date: daysAgo(200), invoiceNo: "KAGIT-0042", amount: 300, vat: 30 }));
    const r = await run();
    assert.match(r.summary, /1 geç girilmiş eski fatura alındı/);
    const late = (await rows()).find((x) => x.externalId === "302");
    assert.ok(late, "eski tarihli fatura panelde");
    assert.equal(late!.date, daysAgo(200));
    const [mark2] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.lastBillId"));
    assert.equal((mark2.value as { id: number }).id, 302);
    // Bir sonraki çalışma aynı faturayı yeniden yazmaz
    const again = await run();
    assert.doesNotMatch(again.summary, /geç girilmiş/);
  });

  test("iki eşitleme arasında 100'den fazla fatura girilir: tarama kaldığı yerden sürer, eski tarihli fatura kaybolmaz", async () => {
    fake.bills.set("301", bill("301", { date: daysAgo(3) }));
    await run();
    // 302 ve 320 kâğıt faturalar (tarihleri pencereden eski); üstlerine ay sonunda topluca 120 fatura girilir
    fake.bills.set("302", bill("302", { date: daysAgo(200), invoiceNo: "KAGIT-0042", amount: 300, vat: 30 }));
    for (let n = 303; n <= 422; n++) fake.bills.set(String(n), bill(String(n), { date: daysAgo(2) }));
    fake.bills.get("320")!.date = daysAgo(250);
    const late = () => rows().then((list) => list.filter((x) => x.externalId === "302" || x.externalId === "320").map((x) => x.externalId));
    const mark = async () => {
      const [m] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.lastBillId"));
      return m.value as { id: number; scan?: { top: number; page: number; edge: number } };
    };
    const first = await run();
    assert.deepEqual(await late(), [], "ilk çalışma 4 sayfa okur (422…323), eski tarihlilere inemez");
    assert.doesNotMatch(first.summary, /geç girilmiş/, "pencere içinde yazılan faturalar geç girilmiş sayılmaz");
    assert.equal((await mark()).id, 301, "sınır ancak tarama bitince ilerler");
    assert.deepEqual((await mark()).scan, { top: 422, page: 4, edge: 323 }, "kalınan yer saklanır");
    // Bu arada işlenmiş faturalardan 30'u silinir: sayfalar yukarı kayar, işlenmemiş 322…318 önceki sayfaya geçer
    for (let n = 330; n < 360; n++) fake.bills.delete(String(n));
    const second = await run();
    assert.deepEqual((await late()).sort(), ["302", "320"], "tarama sürdü, kayan sayfada kalan fatura da alındı");
    assert.match(second.summary, /2 geç girilmiş eski fatura alındı/);
    assert.deepEqual(await mark().then((m) => [m.id, m.scan]), [422, undefined], "tarama bitti, yeni sınır en büyük kimlik");
    const third = await run();
    assert.doesNotMatch(third.summary, /geç girilmiş/, "aynı faturalar her sabah yeniden sayılmaz");
  });

  test("cari: takipli kartın yeni faturası taban 0 alır; tutarı düşen faturanın fazlası hesaba geçer; iptalde bağlar çözülür", async () => {
    const settle = await import("../src/server/cari/settle");
    const [card] = await db.insert(s.suppliers).values({ name: "Sütaş", key: "sütaş", taxNumber: SUTAS.taxNumber }).returning();
    try {
      // Kartın ilk ödemesi: kart takipte (eşitleme yeni faturaya 0 yazar)
      const [pay] = await db.insert(s.supplierEntries).values({ supplierId: card.id, kind: "odeme", date: daysAgo(2), amount: 500, method: "havale", createdByName: "Test" }).returning();
      fake.bills.set("301", bill("301", { amount: 1000, vat: 100 }));
      await run();
      const [f] = await rows();
      assert.equal(f.ledgerBase, 0, "takipli kartın yeni faturası");
      assert.equal(f.allocated, 0);
      // Faturasız alım bu faturaya bağlanır (ödemesi faturaya geçer), ödemenin 100'ü de doğrudan faturaya sayılır
      const [debt] = await db.insert(s.supplierEntries).values({ supplierId: card.id, kind: "borc", date: daysAgo(6), amount: 300, costMode: "fatura", description: "süt", createdByName: "Test" }).returning();
      await db.transaction(async (tx) => {
        await settle.writeAllocations(tx, pay.id, [{ kind: "debt", id: debt.id, amount: 300 }], "Test");
        await settle.linkDebts(tx, [debt.id], f.id);
        await settle.writeAllocations(tx, pay.id, [{ kind: "invoice", id: f.id, amount: 100 }], "Test");
        await settle.recomputeAllocated(tx, [f.id]);
      });
      assert.equal((await rows())[0].allocated, 400);
      // Paraşüt'te tutar düşer (330 ödenecek): sayılan 400'ün 70'i hesaba geçer
      fake.bills.get("301")!.amount = 300;
      fake.bills.get("301")!.vat = 30;
      const r = await run();
      const [g] = await rows();
      assert.equal(g.payable, 330);
      assert.equal(g.allocated, 330);
      assert.equal(g.paidByLedger, true, "tamamen karşılandı: defterle kapandı");
      assert.match(r.summary, /Cari: 1 faturada ödeme hesaba geçti/);
      // Paraşüt'te iptal: fatura silinir, önce bağlar çözülür (borç bağsız, borçtan gelen 300 borca döner, 30 hesaba)
      fake.bills.get("301")!.itemType = "cancelled";
      await run();
      assert.equal((await rows()).length, 0);
      const [d] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debt.id));
      assert.deepEqual([d.invoiceId, d.costMode, d.linkPrev], [null, "fatura", null]);
      const allocs = await db.select().from(s.supplierAllocations);
      assert.deepEqual(allocs.map((a) => [a.debtId, a.invoiceId, a.amount]), [[debt.id, null, 300]]);
      assert.deepEqual([...(await settle.cardsWithCredit())], [[card.id, 200]]);
      const [log] = await db.select().from(s.activityLog).where(eq(s.activityLog.action, "Sistem · Paraşüt'te silinen fatura"));
      assert.match(log.detail ?? "", /1 faturasız alım yeniden açık/);
    } finally {
      await db.delete(s.supplierEntries).where(eq(s.supplierEntries.supplierId, card.id));
      await db.delete(s.suppliers).where(eq(s.suppliers.id, card.id));
    }
  });

  test("cari: iptalde bağlar çözülemezse fatura silinmez (bağlı alım gidersiz kalmaz); sonraki eşitleme siler", async () => {
    const settle = await import("../src/server/cari/settle");
    const [card] = await db.insert(s.suppliers).values({ name: "Sütaş", key: "sütaş", taxNumber: SUTAS.taxNumber }).returning();
    try {
      const [pay] = await db.insert(s.supplierEntries).values({ supplierId: card.id, kind: "odeme", date: daysAgo(2), amount: 600, method: "havale", createdByName: "Test" }).returning();
      fake.bills.set("302", bill("302", { amount: 545.45, vat: 54.55 }));
      await run();
      const [f] = await rows();
      const [debt] = await db.insert(s.supplierEntries).values({ supplierId: card.id, kind: "borc", date: daysAgo(6), amount: 600, costMode: "fatura", description: "peynir", createdByName: "Test" }).returning();
      await db.transaction(async (tx) => {
        await settle.writeAllocations(tx, pay.id, [{ kind: "debt", id: debt.id, amount: 600 }], "Test");
        await settle.linkDebts(tx, [debt.id], f.id);
      });
      await db.execute(sql`CREATE FUNCTION cari_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'deadlock' USING ERRCODE = '40P01'; END $$ LANGUAGE plpgsql`);
      await db.execute(sql`CREATE TRIGGER cari_fail BEFORE UPDATE ON supplier_allocations FOR EACH ROW EXECUTE FUNCTION cari_fail()`);
      fake.bills.get("302")!.itemType = "cancelled";
      try {
        await run();
      } finally {
        await db.execute(sql`DROP TRIGGER cari_fail ON supplier_allocations`);
        await db.execute(sql`DROP FUNCTION cari_fail()`);
      }
      assert.equal((await rows()).length, 1, "fatura silinmedi");
      const [d1] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debt.id));
      assert.equal(d1.invoiceId, f.id, "borç hâlâ bağlı");
      await run();
      assert.equal((await rows()).length, 0, "sonraki eşitleme siler");
      const [d2] = await db.select().from(s.supplierEntries).where(eq(s.supplierEntries.id, debt.id));
      assert.deepEqual([d2.invoiceId, d2.costMode], [null, "fatura"]);
      assert.deepEqual((await db.select().from(s.supplierAllocations)).map((a) => [a.debtId, a.amount]), [[debt.id, 600]]);
    } finally {
      await db.delete(s.supplierEntries).where(eq(s.supplierEntries.supplierId, card.id));
      await db.delete(s.suppliers).where(eq(s.suppliers.id, card.id));
    }
  });

  test("cari: takip başlamadan önceki tarihli fatura sonradan gelirse Paraşüt'te ödenen kısmı taban olur (Geçmiş faturaları al, geç girilmiş fatura); takip günü ve sonrasınınki 0", async () => {
    const bal = await import("../src/lib/cari/balance");
    const [card] = await db.insert(s.suppliers).values({ name: "Sütaş", key: "sütaş", taxNumber: SUTAS.taxNumber }).returning();
    try {
      fake.bills.set("301", bill("301", { date: daysAgo(3) }));
      await run();
      // Takip kartın ilk ödemesinin günüyle başlar (iki gün önce); sonraki ödemenin günü başlangıcı değiştirmez
      await db.insert(s.supplierEntries).values([
        { supplierId: card.id, kind: "odeme", date: daysAgo(1), amount: 200, method: "havale", createdByName: "Test" },
        { supplierId: card.id, kind: "odeme", date: daysAgo(2), amount: 500, method: "havale", createdByName: "Test" },
      ]);
      const view = (x: typeof s.invoices.$inferSelect) => ({ ledgerBase: x.ledgerBase, open: bal.openBalance(x), hint: bal.parasutDifference(x) });
      const byId = async (id: string) => {
        const r = (await rows()).find((x) => x.externalId === id);
        assert.ok(r, `${id} panelde`);
        return r;
      };

      // Geçmiş faturaları al: 2026-05'in faturası takip başlamadan Paraşüt'te kısmen ödenmiş (1.100'ün 600'ü kalmış)
      fake.bills.set("201", bill("201", { date: daysAgo(160), remaining: 600 }));
      const h = await sync.syncSupplierHistory({ label: "Sütaş", billIds: ["301"], taxNumber: SUTAS.taxNumber, names: ["Sütaş"], match: () => "same" });
      assert.ok(h.ok, JSON.stringify(h));
      const old = await byId("201");
      assert.equal(old.unpaid, true);
      assert.deepEqual(view(old), { ledgerBase: 500, open: 600, hint: null }, "Paraşüt'te takipten önce ödenen 500 sayılır, mor ipucu yok");
      assert.equal(bal.isPartiallyPaid(old), true);
      assert.equal((await byId("301")).ledgerBase, null, "var olan satırın tabanına eşitleme dokunmaz");

      // Kimlik sırasıyla yakalanan geç girilmiş eski fatura (330'un 130'u kalmış) da aynı kuralla
      fake.bills.set("302", bill("302", { date: daysAgo(200), invoiceNo: "KAGIT-0042", amount: 300, vat: 30, remaining: 130 }));
      // Takip günü ve sonrasının faturası: Paraşüt'ün kısmi ödemesi panelin ödemesi olabilir, yalnız panel sayar (taban 0)
      fake.bills.set("303", bill("303", { date: daysAgo(2), remaining: 600 }));
      fake.bills.set("304", bill("304", { date: daysAgo(1), remaining: 600 }));
      // E-faturada ödeme bilgisi yok: takipten önceki tarihli olsa da taban 0
      fake.eInvoices.set("805", eInvoice("805", { date: daysAgo(10) }));
      const r = await run();
      assert.match(r.summary, /1 geç girilmiş eski fatura alındı/);
      assert.deepEqual(view(await byId("302")), { ledgerBase: 200, open: 130, hint: null });
      for (const id of ["303", "304"]) assert.deepEqual(view(await byId(id)), { ledgerBase: 0, open: 1100, hint: { parasut: 600, panel: 1100, lower: true } }, id);
      const e = (await rows()).find((x) => x.eInvoiceId === "805" && x.externalId === null);
      assert.ok(e, "e-fatura panelde");
      assert.deepEqual([e.date, e.ledgerBase, e.unpaid], [daysAgo(10), 0, true]);
    } finally {
      await db.delete(s.supplierEntries).where(eq(s.supplierEntries.supplierId, card.id));
      await db.delete(s.suppliers).where(eq(s.suppliers.id, card.id));
    }
  });

  test("istemci: 429'da yeniden dener; yenileme belirteci reddedilince parolayla girer", async () => {
    fake.bills.set("401", bill("401"));
    fake.throttle = 2;
    await run();
    assert.equal((await rows()).length, 1);
    assert.ok(fake.requests.filter((x) => x.startsWith("purchase_bills?")).length >= 3, "429'lar yeniden denendi");
    assert.deepEqual(fake.grants, ["password"]);
    // Kayıtlı belirtecin süresi dolmuş: önce yenileme denenir
    const { seal } = await import("../src/server/secret-box");
    const expired = async () => {
      const value = { sealed: seal(JSON.stringify({ access: "eski", refresh: "eski-yenileme", expiresAt: Date.now() - 60_000, clientId: "test-istemci", username: "api@kafe.test" })) };
      await db.update(s.integrationState).set({ value }).where(eq(s.integrationState.key, "parasut.token"));
    };
    await expired();
    fake.grants = [];
    await run();
    assert.deepEqual(fake.grants, ["refresh_token"]);
    // Yenileme reddedilirse parolayla yeniden giriş yapılır, eşitleme sürer
    await expired();
    fake.rejectRefresh = true;
    fake.grants = [];
    await run();
    assert.deepEqual(fake.grants, ["refresh_token", "password"]);
  });
});
