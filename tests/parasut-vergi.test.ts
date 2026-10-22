// Eski faturaların tedarikçi vergi nosunun Paraşüt'ten tamamlanması (src/server/parasut/tax-backfill-pass.ts):
// sayfalama, durma kuralları (en eski boş kayıt, boş ya da son sayfa, süre, reddedilen istek) ve hangi numaranın
// hangi kayda yazıldığı. Paraşüt istemcisi sahtedir.
// Çalıştırma: npx tsx --test tests/parasut-vergi.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListResponse, Resource } from "../src/server/parasut/jsonapi";
import { missingTaxRows, parseTaxBackfillState, runTaxBackfillPass, type PassDeps, type TaxBackfillState } from "../src/server/parasut/tax-backfill-pass";

const X = "7810030532";
const Y = "4567890128";

/** Gider faturası: kişi kartı numaralı, isteğe bağlı gelen e-belgeli */
function bill(id: string, date: string, opts: { contactTax?: string | null; eDocTax?: string; direction?: string } = {}) {
  const res: Resource = {
    id,
    type: "purchase_bills",
    attributes: { item_type: "purchase_bill", issue_date: date, currency: "TRL", gross_total: "100", total_vat: "10", net_total: "110" },
    relationships: {
      supplier: { data: { id: `c${id}`, type: "contacts" } },
      ...(opts.eDocTax ? { active_e_document: { data: { id: `e${id}`, type: "e_invoices" } } } : {}),
    },
  };
  const included: Resource[] = [{ id: `c${id}`, type: "contacts", attributes: { name: `Tedarikçi ${id}`, tax_number: opts.contactTax ?? null } }];
  if (opts.eDocTax) included.push({ id: `e${id}`, type: "e_invoices", attributes: { direction: opts.direction ?? "inbound", from_vkn: opts.eDocTax } });
  return { res, included };
}

/** Gelen (ya da giden) e-fatura; içeri alınmışsa gider faturasının kimliği */
function eInvoice(id: string, date: string, tax: string | null, opts: { direction?: string; billId?: string } = {}): Resource {
  return {
    id,
    type: "e_invoices",
    attributes: { direction: opts.direction ?? "inbound", issue_date: date, from_vkn: tax, net_total: "110", total_vat: "10", contact_name: "X" },
    relationships: { invoice: { data: opts.billId ? { id: opts.billId, type: "purchase_bills" } : null } },
  };
}

type Page = { data: Resource[]; included?: Resource[] };

/** Sahte Paraşüt: listeler sayfa sayfa; istenen sayfalar kaydedilir, `fail` bir sayfada hata atar */
function fakeSource(lists: Record<string, Page[]>, opts: { fail?: { path: string; page: number; error: unknown } } = {}) {
  const asked: string[] = [];
  const pages: PassDeps["pages"] = (path, query, maxPages, startPage) => {
    const list = lists[path] ?? [];
    return (async function* () {
      for (let page = startPage; page < startPage + maxPages; page++) {
        asked.push(`${path}#${page}${query.include ? `?${query.include}` : ""}`);
        if (opts.fail && opts.fail.path === path && opts.fail.page === page) throw opts.fail.error;
        const p = list[page - 1] ?? { data: [] };
        const res: ListResponse & { page: number } = { data: p.data, included: p.included, meta: { total_pages: list.length }, page };
        yield res;
        if (!p.data.length || page >= list.length) return;
      }
    })();
  };
  return { pages, asked };
}

/** Bellekteki faturalar: kimlik → numara; yalnız boşsa yazılır */
function fakeDb(ids: number[]) {
  const tax = new Map<number, string | null>(ids.map((id) => [id, null]));
  const fill: PassDeps["fill"] = async (id, t) => {
    if (tax.get(id)) return false;
    tax.set(id, t);
    return true;
  };
  return { tax, fill };
}

class Rejected extends Error {}
class Deadline extends Error {}
const errorKind: PassDeps["errorKind"] = (e) => (e instanceof Deadline ? "deadline" : e instanceof Rejected ? "rejected" : "other");

const page = (items: { res: Resource; included: Resource[] }[]): Page => ({ data: items.map((i) => i.res), included: items.flatMap((i) => i.included) });

test("tamamlama durumu: saklanan değer bozuksa baştan; kayıtlar gider faturası ve e-faturaya göre", () => {
  assert.deepEqual(parseTaxBackfillState(null), { bills: { page: 1, done: false }, eInvoices: { page: 1, done: false }, filled: 0 });
  assert.deepEqual(parseTaxBackfillState({ bills: { page: 4, done: true }, eInvoices: { page: -2 }, filled: 7, finishedAt: "2026-10-22T05:00:00Z" }), {
    bills: { page: 4, done: true },
    eInvoices: { page: 1, done: false },
    filled: 7,
    finishedAt: "2026-10-22T05:00:00Z",
  });
  const m = missingTaxRows([
    { id: 1, externalId: "b1", eInvoiceId: null, date: "2026-05-01" },
    { id: 2, externalId: null, eInvoiceId: "e2", date: "2026-03-01" },
    { id: 3, externalId: "b3", eInvoiceId: "e3", date: "2026-04-01" },
  ]);
  assert.deepEqual([...m.byExternalId], [["b1", 1], ["b3", 3]]);
  assert.deepEqual([...m.byEInvoiceId], [["e2", 2], ["e3", 3]]);
  assert.equal(m.billsOldest, "2026-04-01", "yalnız gider faturalı kayıtlar");
  assert.equal(m.oldest, "2026-03-01");
});

test("gider faturaları: e-belgedeki numara önce, yoksa kişi kartı; en eski boş kayıttan eskiye inince biter", async () => {
  const src = fakeSource({
    purchase_bills: [
      page([bill("b9", "2026-10-01", { contactTax: Y }), bill("b8", "2026-09-20", { contactTax: Y, eDocTax: X })]),
      page([bill("b7", "2026-08-01", { contactTax: null }), bill("b6", "2026-07-01", { contactTax: Y })]),
      page([bill("b5", "2026-06-01", { contactTax: Y }), bill("b4", "2026-05-01", { contactTax: Y })]),
      page([bill("b3", "2026-04-01", { contactTax: Y })]),
    ],
    e_invoices: [{ data: [] }],
  });
  const db = fakeDb([8, 7, 6]);
  const state = parseTaxBackfillState(null);
  const missing = missingTaxRows([
    { id: 8, externalId: "b8", eInvoiceId: null, date: "2026-09-20" },
    { id: 7, externalId: "b7", eInvoiceId: null, date: "2026-08-01" },
    { id: 6, externalId: "b6", eInvoiceId: null, date: "2026-07-01" },
  ]);
  await runTaxBackfillPass(state, missing, { pages: src.pages, fill: db.fill, errorKind }, Date.now() + 60_000);
  assert.equal(db.tax.get(8), X, "imzalı belgedeki numara kişi kartınkinden önce");
  assert.equal(db.tax.get(7), null, "numarası olmayan kayıt boş kalır");
  assert.equal(db.tax.get(6), Y);
  assert.equal(state.filled, 2);
  // 3. sayfadaki faturalar en eski boş kayıttan (07-01) eski: tarama orada biter, 4. sayfa okunmaz
  assert.deepEqual(src.asked.filter((a) => a.startsWith("purchase_bills")), [
    "purchase_bills#1?supplier,active_e_document",
    "purchase_bills#2?supplier,active_e_document",
    "purchase_bills#3?supplier,active_e_document",
  ]);
  assert.deepEqual(state.bills, { page: 4, done: true });
  // Ardından e-faturalar (boş liste: biter)
  assert.deepEqual(state.eInvoices, { page: 2, done: true });
});

test("süre dolunca kaldığı sayfa saklanır; sonraki tur oradan sürer, yazılan yeniden yazılmaz", async () => {
  const lists = {
    purchase_bills: [page([bill("b9", "2026-10-01", { contactTax: Y })]), page([bill("b8", "2026-09-01", { contactTax: X })]), page([bill("b7", "2026-08-01", { contactTax: Y })])],
    e_invoices: [{ data: [] }],
  };
  const db = fakeDb([9, 7]);
  const rows = [
    { id: 9, externalId: "b9", eInvoiceId: null, date: "2026-10-01" },
    { id: 7, externalId: "b7", eInvoiceId: null, date: "2026-08-01" },
  ];
  const state = parseTaxBackfillState(null);
  let clock = 0;
  const first = fakeSource(lists);
  // Her sayfadan sonra saat ilerler: ilk sayfadan sonra süre doldu
  await runTaxBackfillPass(state, missingTaxRows(rows), { pages: first.pages, fill: db.fill, errorKind, now: () => (clock += 10) }, 15);
  assert.deepEqual(state.bills, { page: 2, done: false });
  assert.equal(state.filled, 1);
  assert.equal(first.asked.length, 1, "e-faturalara geçilmez");
  // Sonraki eşitleme: boş kalanlar yeniden okunur, 2. sayfadan sürer
  const second = fakeSource(lists);
  const left = rows.filter((r) => !db.tax.get(r.id));
  await runTaxBackfillPass(state, missingTaxRows(left), { pages: second.pages, fill: db.fill, errorKind }, Date.now() + 60_000);
  assert.equal(second.asked[0], "purchase_bills#2?supplier,active_e_document");
  assert.equal(db.tax.get(7), Y);
  assert.equal(state.filled, 2);
  assert.equal(state.bills.done, true);
});

test("e-faturalar: yalnız gelenler; e-fatura kaydı ve içeri alınmış gider faturasının kaydı dolar", async () => {
  const src = fakeSource({
    purchase_bills: [{ data: [] }],
    e_invoices: [
      { data: [eInvoice("e5", "2026-10-02", X), eInvoice("e4", "2026-10-01", "9999999999", { direction: "outbound" }), eInvoice("e3", "2026-09-15", Y, { billId: "b3" })] },
      { data: [eInvoice("e2", "2026-08-01", X)] },
    ],
  });
  const db = fakeDb([5, 4, 3, 2]);
  const state: TaxBackfillState = { bills: { page: 1, done: false }, eInvoices: { page: 1, done: false }, filled: 0 };
  const missing = missingTaxRows([
    { id: 5, externalId: null, eInvoiceId: "e5", date: "2026-10-02" },
    { id: 4, externalId: null, eInvoiceId: "e4", date: "2026-10-01" },
    // İçeri alınmış e-fatura: kaydı gider faturasına bağlı, kişi kartında numara yoktu
    { id: 3, externalId: "b3", eInvoiceId: null, date: "2026-09-15" },
  ]);
  await runTaxBackfillPass(state, missing, { pages: src.pages, fill: db.fill, errorKind }, Date.now() + 60_000);
  assert.equal(db.tax.get(5), X);
  assert.equal(db.tax.get(4), null, "giden e-fatura (sitenin satış faturası gibi) okunmaz");
  assert.equal(db.tax.get(3), Y, "gider faturası kaydı e-faturanın numarasıyla");
  assert.equal(db.tax.get(2), null, "listede olmayan kayda dokunulmaz");
  assert.equal(state.eInvoices.done, true, "2. sayfadaki fatura en eski boş kayıttan eski: biter");
  assert.equal(src.asked.filter((a) => a.startsWith("e_invoices")).length, 2);
  assert.ok(src.asked.every((a) => !a.startsWith("e_invoices") || a.endsWith("?invoice")), "içeri alınan gider faturası ilişkisi istenir");
});

test("reddedilen istek o taramayı bitirir (öteki çalışır); süre hatası bırakır; başka hata yukarı çıkar", async () => {
  const lists = { purchase_bills: [page([bill("b1", "2026-10-01", { contactTax: X })])], e_invoices: [{ data: [eInvoice("e1", "2026-10-01", Y, { billId: "b1" })] }] };
  const rows = [{ id: 1, externalId: "b1", eInvoiceId: null, date: "2026-10-01" }];
  // include reddedildi: gider faturaları biter, e-faturalar yine okunur
  const logged: string[] = [];
  const rejected = fakeSource(lists, { fail: { path: "purchase_bills", page: 1, error: new Rejected() } });
  const db = fakeDb([1]);
  const state = parseTaxBackfillState(null);
  await runTaxBackfillPass(state, missingTaxRows(rows), { pages: rejected.pages, fill: db.fill, errorKind, log: (m) => logged.push(m) }, Date.now() + 60_000);
  assert.deepEqual(state.bills, { page: 1, done: true });
  assert.equal(db.tax.get(1), Y, "e-faturadan doldu");
  assert.equal(logged.length, 1);
  // Süre doldu: hiçbir şey bitmiş sayılmaz
  const late = fakeSource(lists, { fail: { path: "purchase_bills", page: 1, error: new Deadline() } });
  const s2 = parseTaxBackfillState(null);
  await runTaxBackfillPass(s2, missingTaxRows(rows), { pages: late.pages, fill: fakeDb([1]).fill, errorKind }, Date.now() + 60_000);
  assert.deepEqual([s2.bills, s2.eInvoices], [{ page: 1, done: false }, { page: 1, done: false }]);
  // Başka hata (ör. oturum) yukarı çıkar: eşitleme kaydeder
  const broken = fakeSource(lists, { fail: { path: "purchase_bills", page: 1, error: new Error("oturum") } });
  await assert.rejects(runTaxBackfillPass(parseTaxBackfillState(null), missingTaxRows(rows), { pages: broken.pages, fill: fakeDb([1]).fill, errorKind }, Date.now() + 60_000), /oturum/);
});

test("boş kayıt yoksa tarama yapılmaz; bu arada başka yolla dolan kayıt sayılmaz", async () => {
  const src = fakeSource({ purchase_bills: [page([bill("b1", "2026-10-01", { contactTax: X })])], e_invoices: [{ data: [] }] });
  const state = parseTaxBackfillState(null);
  await runTaxBackfillPass(state, missingTaxRows([]), { pages: src.pages, fill: fakeDb([]).fill, errorKind }, Date.now() + 60_000);
  assert.deepEqual(src.asked, []);
  assert.equal(state.bills.done && state.eInvoices.done, true);
  // Eşitleme bu arada numarayı yazmış: üzerine yazılmaz, sayılmaz
  const db = fakeDb([1]);
  db.tax.set(1, Y);
  const s2 = parseTaxBackfillState(null);
  await runTaxBackfillPass(s2, missingTaxRows([{ id: 1, externalId: "b1", eInvoiceId: null, date: "2026-10-01" }]), { pages: fakeSource({ purchase_bills: [page([bill("b1", "2026-10-01", { contactTax: X })])], e_invoices: [{ data: [] }] }).pages, fill: db.fill, errorKind }, Date.now() + 60_000);
  assert.equal(db.tax.get(1), Y);
  assert.equal(s2.filled, 0);
});
