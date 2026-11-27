// Şube ayrımı parça 4 (27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Alanlar): Ödemeler ve faturalar, Nakit planı,
// Tedarikçi bakiyeleri ve Komisyon kişinin şube görünümüyle okur. Saf kurallar (şube kipinde ne listede, ne İşletme
// geneli satırında, ne hiç) ve kaynağın biçimi; veritabanındaki sınama tests/sube-ayrimi-alanlar-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-ayrimi-alanlar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { paymentRequestText, requestPayer } from "../src/app/panel/tedarikciler/logic";
import { sharedCariLine, sharedTotals } from "../src/app/panel/tedarikciler/shared-cari";
import { areaKapsam, modeOfScope, VIEW_AREAS } from "../src/lib/branch-view";
import { ALL_BRANCHES } from "../src/lib/branches";
import { branchAccountOf, branchCariNote, branchPayments, sharedCariOf, sharedCariParts } from "../src/lib/cari/branch-account";
import { branchCashFlow, branchFlowNote, isSharedPlanLine, ownPlanInvoice, sharedPlanIdsOf } from "../src/lib/cash-plan-branch";
import type { PlanLine } from "../src/lib/cash-plan";
import { hasBranchSales, scopeCommissionReport, type ChannelMonth, type CommissionReport } from "../src/lib/commission/report";
import { sharedPaymentsAnswer } from "../src/lib/mcp/answers/payments";
import { sharedCariAnswer } from "../src/lib/mcp/answers/suppliers";
import { odemelerInput, tedarikciOzetiInput } from "../src/lib/mcp/schemas";
import { scopeRecentPaid, type RecentPaid } from "../src/lib/recent-paid";
import type { UpcomingItem } from "../src/lib/reminders";
import { digestItemBranch, scopeUpcoming, unassignedText, upcomingPlace, type InvoiceBranchRef } from "../src/lib/upcoming-scope";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const item = (source: UpcomingItem["source"], sourceId: number, amount = 100): UpcomingItem => ({
  ref: `${source}:${sourceId}`,
  source,
  sourceId,
  kind: "fatura" as UpcomingItem["kind"],
  title: `${source} ${sourceId}`,
  detail: null,
  amount,
  dueDate: "2026-12-01",
  daysLeft: 4,
  status: "soon" as UpcomingItem["status"],
  remindDaysBefore: 3,
  repeat: "none" as UpcomingItem["repeat"],
});

// Faturalar: 1 Marina'nın, 2 Tuzla'nın, 3 işletme geneli, 4 şubesi seçilmemiş
const INVOICES = new Map<number, InvoiceBranchRef>([
  [1, { branchId: "marina", companyWide: false }],
  [2, { branchId: "tuzla", companyWide: false }],
  [3, { branchId: null, companyWide: true }],
  [4, { branchId: null, companyWide: false }],
]);
const invoiceOf = (id: number) => INVOICES.get(id);

// ---------------------------------------------------------------- Ödemeler ve faturalar

test("Ödemeler şube kipi: şubenin ve işletme genelinin faturası listede, şubesizi sayıda, öbür şubeninki hiç, cari İşletme geneli'nde", () => {
  assert.equal(upcomingPlace(item("invoice", 1), "marina", invoiceOf), "liste");
  assert.equal(upcomingPlace(item("invoice", 3), "marina", invoiceOf), "liste");
  assert.equal(upcomingPlace(item("invoice", 2), "marina", invoiceOf), "yok");
  assert.equal(upcomingPlace(item("invoice", 4), "marina", invoiceOf), "secilmemis");
  assert.equal(upcomingPlace(item("invoice", 99), "marina", invoiceOf), "secilmemis", "okunamayan fatura sessizce kaybolmaz");
  assert.equal(upcomingPlace(item("cari", 7), "marina", invoiceOf), "isletme");
  assert.equal(upcomingPlace(item("reminder", 5), "marina", invoiceOf), "liste", "hatırlatıcı veritabanında süzülür");
  for (const s of ["invoice", "cari", "reminder"] as const) assert.equal(upcomingPlace(item(s, 2), ALL_BRANCHES, invoiceOf), "liste", s);

  const up = {
    items: [item("invoice", 1), item("invoice", 2, 77777.77), item("invoice", 3), item("invoice", 4, 50), item("cari", 7, 30), item("reminder", 5)],
    later: [item("invoice", 4, 25)],
    covered: [item("invoice", 2), item("invoice", 1)],
  };
  const m = scopeUpcoming(up, "marina", invoiceOf);
  assert.deepEqual(
    m.items.map((i) => i.ref),
    ["invoice:1", "invoice:3", "reminder:5"],
  );
  assert.deepEqual(m.later, []);
  assert.deepEqual(
    m.covered.map((i) => i.ref),
    ["invoice:1"],
  );
  assert.deepEqual(
    m.shared.map((i) => i.ref),
    ["cari:7"],
  );
  assert.deepEqual(m.unassigned, { count: 2, total: 75 });
  assert.equal(JSON.stringify(m).includes("77777"), false, "öbür şubenin faturası hiçbir yerde");
  const all = scopeUpcoming(up, ALL_BRANCHES, invoiceOf);
  assert.equal(all.items.length, 6);
  assert.deepEqual(all.shared, []);
  assert.deepEqual(all.unassigned, { count: 0, total: 0 });
  assert.equal(unassignedText(3), "3 faturanın şubesi seçilmemiş");
});

test("sabah e-postası: şubeye seçilmiş fatura yalnız o şubenin grubuna; işletme geneli, şubesiz fatura ve cari her gruba", () => {
  const reminderBranch = (id: number) => (id === 5 ? "tuzla" : null);
  assert.equal(digestItemBranch(item("invoice", 1), reminderBranch, invoiceOf), "marina");
  assert.equal(digestItemBranch(item("invoice", 3), reminderBranch, invoiceOf), null);
  assert.equal(digestItemBranch(item("invoice", 4), reminderBranch, invoiceOf), null);
  assert.equal(digestItemBranch(item("cari", 7), reminderBranch, invoiceOf), null);
  assert.equal(digestItemBranch(item("reminder", 5), reminderBranch, invoiceOf), "tuzla");
});

test("Son ödenenler şube kipinde: kapsamdaki fatura ve hatırlatıcı; faturasız borcun ödemesi firmanın", () => {
  const e = (kind: RecentPaid["kind"], id: number): RecentPaid => ({ kind, id, title: `${kind}-${id}`, amount: 10, dueDate: null, at: "2026-11-27T08:00:00.000Z" });
  const list = [e("invoice", 1), e("invoice", 2), e("reminder", 5), e("cari", 9)];
  assert.deepEqual(
    scopeRecentPaid(list, new Set([1])).map((x) => `${x.kind}:${x.id}`),
    ["invoice:1", "reminder:5"],
  );
});

// ---------------------------------------------------------------- Nakit planı

const line = (key: string, kind: PlanLine["kind"], amount: number, direction: PlanLine["direction"] = "out"): PlanLine =>
  ({ key, kind, amount, direction, title: key, date: "2026-12-01", estimated: false }) as unknown as PlanLine;

test("nakit planı şube kipi: İşletme geneli satırı vergi, SGK, şubesiz hatırlatıcı, işletme geneli fatura ve cariden; şubenin kalemi değil", () => {
  const ids = sharedPlanIdsOf({
    reminders: [
      { id: 10, branchId: null },
      { id: 11, branchId: "marina" },
    ],
    invoiceBranches: INVOICES,
  });
  assert.deepEqual([...ids.reminders], [10]);
  assert.deepEqual([...ids.invoices], [3], "şubesi seçilmemiş fatura işletme geneli değil");
  assert.equal(isSharedPlanLine(line("kdv@2026-11-28", "kdv", 1), ids), true);
  assert.equal(isSharedPlanLine(line("sgk@2026-11-30", "sgk", 1), ids), true);
  assert.equal(isSharedPlanLine(line("reminder:10@2026-12-01", "reminder", 1), ids), true);
  assert.equal(isSharedPlanLine(line("reminder:11@2026-12-01", "reminder", 1), ids), false);
  assert.equal(isSharedPlanLine(line("invoice:3", "invoice", 1), ids), true);
  assert.equal(isSharedPlanLine(line("invoice:1", "invoice", 1), ids), false);
  assert.equal(isSharedPlanLine(line("cari:7", "invoice", 1), ids), true);
  assert.equal(isSharedPlanLine(line("sales", "sales", 1, "in"), ids), false, "gelen para işletme geneli değil");
  assert.equal(ownPlanInvoice(INVOICES.get(1), "marina"), true);
  assert.equal(ownPlanInvoice(INVOICES.get(3), "marina"), false, "işletme geneli fatura şubenin akışında değil");
  assert.equal(ownPlanInvoice(INVOICES.get(4), "marina"), false);
  assert.equal(ownPlanInvoice(undefined, "marina"), false);

  const week = (index: number, lines: PlanLine[]) => ({ index, lines }) as unknown as import("../src/lib/cash-plan").PlanWeek;
  const flow = branchCashFlow(
    {
      weeks: [
        week(0, [line("kdv@2026-11-28", "kdv", 42000), line("invoice:1", "invoice", 500), line("reminder:10@2026-12-01", "reminder", 1000), line("cari:7", "invoice", 300), line("sgk@2026-11-30", "sgk", 9000)]),
        week(1, []),
      ],
      opening: { amount: 250000, date: "2026-11-26" } as import("../src/lib/cash-plan").CashPlan["opening"],
    },
    ids,
    "Marina",
  );
  assert.equal(flow.shared[0].amount, 52300);
  assert.equal(flow.shared[0].count, 4);
  assert.deepEqual(
    flow.shared[0].top.map((t) => t.amount),
    [42000, 9000, 1000],
  );
  assert.equal(flow.shared[1].amount, 0);
  assert.equal(flow.sharedTotal, 52300);
  assert.deepEqual(flow.firmOpening, { amount: 250000, date: "2026-11-26" });
  assert.match(branchFlowNote("Marina").title, /Şubenin nakit akışı · Marina/);
});

// ---------------------------------------------------------------- Tedarikçi bakiyeleri

const inv = (id: number, branchId: string | null, companyWide: boolean, payable: number, unpaid = true, extra: Record<string, unknown> = {}) => ({
  id,
  date: "2026-11-10",
  payable,
  amount: payable,
  discount: 0,
  unpaid,
  outstanding: null,
  allocated: 0,
  ledgerBase: null,
  branchId,
  companyWide,
  ...extra,
});

test("tedarikçi şube kipi: bakiye şubenin ve işletme genelinin faturalarıyla; faturasız borç ve hesaptaki para İşletme geneli", () => {
  const invoices = [inv(1, "marina", false, 1000), inv(2, "tuzla", false, 77777.77), inv(3, null, true, 200), inv(4, null, false, 50), inv(5, "marina", false, 400, false, { paidAt: "2026-11-20" })];
  const { invoices: mine, account } = branchAccountOf(
    {
      invoices,
      payments: [
        { id: 20, date: "2026-11-21", amount: 500, method: "havale", cashOutBranchId: null },
        { id: 21, date: "2026-11-22", amount: 70, method: "kasa", cashOutBranchId: "marina" },
        { id: 22, date: "2026-11-23", amount: 900, method: "kasa", cashOutBranchId: "tuzla" },
      ],
      allocations: [
        { paymentId: 20, invoiceId: 1, amount: 300 },
        { paymentId: 20, invoiceId: 2, amount: 200 },
        { paymentId: 22, invoiceId: 2, amount: 900 },
      ],
    },
    "marina",
    { today: "2026-11-27", termDays: 30 },
  );
  assert.deepEqual(
    mine.map((i) => i.id),
    [1, 3, 5],
    "öbür şubenin ve şubesi seçilmemiş fatura yok",
  );
  assert.equal(account.open, 1200);
  assert.equal(account.credit, 0);
  assert.equal(account.debtOpen, 0);
  assert.equal(JSON.stringify(account).includes("77777"), false);
  // Ödemeler: şubenin faturasına sayılan 300 (500'ün), şubenin kasasından 70; Tuzla'nın kasasından ödeme yok
  assert.deepEqual(
    account.events.map((e) => [e.kind, e.amount]),
    [
      ["payment", 70],
      ["payment", 300],
      ["invoice", 400],
    ],
  );
  assert.equal(account.lastPaid, "2026-11-22");
  assert.deepEqual(
    branchPayments([{ id: 30, date: "2026-11-01", amount: 100, method: "havale" }], [{ paymentId: 30, invoiceId: 2, amount: 100 }], new Set([1]), "marina"),
    [],
    "yalnız öbür şubeye sayılan ödeme şubenin değil",
  );

  const shared = sharedCariOf({ debtOpen: 1200, debtOpenCount: 2, credit: 300 });
  assert.deepEqual(shared, { debtOpen: 1200, debtOpenCount: 2, credit: 300, balance: 900 });
  assert.equal(sharedCariParts({ debtOpen: 0, debtOpenCount: 0, credit: 0 }), null);
  const totals = sharedTotals([shared, null, sharedCariOf({ debtOpen: 0, debtOpenCount: 0, credit: 50 }), sharedCariOf({ debtOpen: 0, debtOpenCount: 0, credit: 0 })]);
  assert.deepEqual(totals, { debt: 1200, debtCount: 2, credit: 350, suppliers: 2 });
  assert.equal(sharedCariLine(totals).replace(/\s/g, " "), "Faturasız borç 1.200,00 ₺ (2 alım) · hesaptaki para 350,00 ₺");
  assert.equal(sharedCariLine({ debt: 0, debtCount: 0, credit: 0 }), "Faturasız borç ve hesaptaki para yok");
  assert.match(branchCariNote("Marina").text, /Şube bakiyeleri \+ işletme geneli = tedarikçinin carisi/);
});

test("ödeme talebi şube kipinde şubenin adıyla", () => {
  assert.equal(requestPayer("L'Affogato", "Marina"), "L'Affogato · Marina");
  assert.equal(requestPayer("L'Affogato", null), "L'Affogato");
  const text = paymentRequestText({ payer: requestPayer("L'Affogato", "Marina"), name: "Sütaş", card: null, lines: [{ date: "2026-11-10", invoiceNo: "A1", amount: 1000, dueDate: null }] });
  assert.equal(text.split("\n")[0], "Ödeme talebi · L'Affogato · Marina");
});

// ---------------------------------------------------------------- Komisyon ve hakediş

test("komisyon şube kipi: hakediş ve uyarı satırları yalnız şubenin o ay satışı olan kanallarda", () => {
  const row = (channel: string, kind: "meal" | "platform", month: string, autoSales: number | null = null) =>
    ({ channel, kind, month, label: channel, autoSales: autoSales === null ? null : { amount: autoSales, source: "asilpos" } }) as unknown as ChannelMonth;
  const group = (kind: "meal" | "platform", month: string, zTotal: number | null) => ({ kind, month, zTotal }) as unknown as CommissionReport["groups"][number];
  const branch = { rows: [row("pluxee", "meal", "2026-10", 5000)], groups: [group("meal", "2026-10", 5000), group("platform", "2026-10", 0), group("meal", "2026-09", 0)] };
  assert.equal(hasBranchSales(branch, "meal", "2026-10", "pluxee" as never), true);
  assert.equal(hasBranchSales(branch, "platform", "2026-10", "yemeksepeti" as never), false);
  assert.equal(hasBranchSales(branch, "meal", "2026-09"), false);
  const all = {
    rows: [row("pluxee", "meal", "2026-10"), row("yemeksepeti", "platform", "2026-10"), row("pluxee", "meal", "2026-09")],
    pending: [row("yemeksepeti", "platform", "2026-10"), row("pluxee", "meal", "2026-10")],
    groups: [group("meal", "2026-10", 9000), group("platform", "2026-10", 4000)],
    today: "2026-11-27",
  };
  const scoped = scopeCommissionReport(all, branch);
  assert.deepEqual(
    scoped.rows.map((r) => `${r.channel}:${r.month}`),
    ["pluxee:2026-10"],
  );
  assert.deepEqual(
    scoped.pending.map((r) => r.channel),
    ["pluxee"],
  );
  assert.deepEqual(
    scoped.groups.map((g) => g.kind),
    ["meal"],
  );
  assert.equal(scoped.today, "2026-11-27", "öteki alanlar olduğu gibi");
});

// ---------------------------------------------------------------- Bağlantı ve panel asistanı

test("bağlantı: gorunum girdisi, kapsam satırı alanın kipini yazar, İşletme geneli bilgisi", () => {
  assert.equal(odemelerInput.parse({ gorunum: "firma" }).gorunum, "firma");
  assert.equal(tedarikciOzetiInput.parse({ sube: "Marina", gorunum: "sube" }).sube, "Marina");
  assert.equal(odemelerInput.parse({}).gorunum, undefined);
  assert.throws(() => odemelerInput.parse({ gorunum: "tumu" }));
  assert.equal(areaKapsam("Tümü", ALL_BRANCHES, [{ area: "odemeler", mode: "sube" }]), "Tümü");
  assert.equal(
    areaKapsam("Marina", "marina", [
      { area: "odemeler", mode: "sube" },
      { area: "nakit", mode: "firma" },
    ]),
    "Marina · ödemeler ve faturalar: Yalnız şube · nakit planı: Firma geneli",
  );
  assert.equal(areaKapsam("Marina", "marina", [{ area: "tedarikciler", mode: "firma" }]), `Marina · ${VIEW_AREAS.tedarikciler.label.toLocaleLowerCase("tr")}: Firma geneli`);
  assert.equal(modeOfScope(ALL_BRANCHES), "firma");
  assert.equal(modeOfScope("marina"), "sube");

  const pay = sharedPaymentsAnswer([item("cari", 7, 30), item("cari", 8, 20.555)], { count: 2, total: 75 }, { sharedTotal: 52300 });
  assert.deepEqual(pay.faturasizBorc, { adet: 2, toplam: 50.56 });
  assert.deepEqual(pay.subesiSecilmemisFatura, { adet: 2, toplam: 75 });
  assert.equal(pay.nakitPlaniIsletmeGeneli, 52300);
  assert.equal(JSON.stringify(pay).includes("cari 7"), false, "başlık gönderilmez");
  const groups = [
    { name: "Sütaş", names: ["Sütaş"], keys: ["SUTAS"], shared: { debtOpen: 100, debtOpenCount: 1, credit: 40 } },
    { name: "Kaldi", names: ["Kaldi"], keys: ["KALDI"], shared: { debtOpen: 0, debtOpenCount: 0, credit: 10 } },
  ];
  assert.deepEqual(sharedCariAnswer(groups).faturasizBorc, { adet: 1, tutar: 100 });
  assert.equal(sharedCariAnswer(groups).hesaptakiOdeme, 50);
  assert.equal(sharedCariAnswer(groups, "Kaldi").hesaptakiOdeme, 10);
});

// ---------------------------------------------------------------- Kaynağın biçimi

test("kaynak: dört alan areaScope ile okur, ekranlar çipini çizer, not kalktı", () => {
  const payments = read("src/app/panel/hatirlaticilar/page.tsx");
  assert.match(payments, /areaScope\("odemeler"\)/);
  assert.match(payments, /loadUpcoming\(undefined, \{ branch: area \}\)/);
  assert.match(payments, /loadRecipientsInScope\(db, area\)/);
  assert.match(payments, /loadRecentPaid\(area\)/);
  assert.match(payments, /<BranchViewChip area="odemeler"/);
  assert.match(read("src/app/panel/hatirlaticilar/nakit/page.tsx"), /<BranchViewChip area="nakit"/);
  for (const f of ["src/app/panel/tedarikciler/page.tsx", "src/app/panel/tedarikciler/[cari]/page.tsx"]) {
    const src = read(f);
    assert.match(src, /areaScope\("tedarikciler"\)/, f);
    assert.match(src, /<BranchViewChip area="tedarikciler"/, f);
    assert.doesNotMatch(src, /<CompanyWideNotice/, f);
  }
  assert.match(read("src/app/panel/komisyonlar/page.tsx"), /<BranchViewChip area="komisyon"/);
  const commission = read("src/server/data/commission.ts");
  assert.match(commission, /loadLightReport\(await areaScope\("komisyon"\)\)/);
  assert.match(commission, /loadLightReport\(ALL_BRANCHES, today\)/, "sabah e-postasının kutusu firmanın");
  // Kilit okumada kalır: müdürde areaScope şubesini döner (currentBranchView kilitli hesapta "sube")
  assert.match(read("src/server/branch-scope.ts"), /export async function areaScope\(area: ViewArea\): Promise<BranchScope> \{\s*const scope = await currentBranchScope\(\);/);
});

test("kaynak: bağlantı anahtarının sahibinin tercihi; tedarikçi sayfası cariyi firmanın faturalarıyla düzenler", () => {
  const server = read("src/server/mcp/server.ts");
  assert.match(server, /const prefs = await userBranchViewOf\(p\.userId\);/);
  assert.match(server, /withBranchView\(prefs, \(\) => t\.run\(args, \{ base, now: new Date\(\) \}\)\)/);
  const tools = read("src/server/mcp/tools.ts");
  assert.match(tools, /withAreaView\("odemeler", gorunum,/);
  assert.match(tools, /withAreaView\("nakit", gorunum,/);
  assert.match(tools, /withAreaView\("tedarikciler", gorunum,/);
  const page = read("src/app/panel/tedarikciler/[cari]/page.tsx");
  assert.match(page, /loadSupplierLedger\(area, \{ keepAll: true \}\)/);
  assert.match(page, /loadSupplierCari\(\{ card: g\.card, invoices: g\.allInvoices \}/);
  const client = read("src/app/panel/tedarikciler/[cari]/supplier-client.tsx");
  assert.match(client, /<StatementPanel name=\{supplier\.name\} today=\{today\} invoices=\{allInvoices \?\? list\}/);
  assert.match(client, /payer=\{requestPayer\(PRODUCT_NAME, branchMode \? branchInfo!\.scopeName : null\)\}/);
  assert.match(client, /accountCredit=\{branchMode \? 0 : cari\.credit\}/);
});
