// Cari hesabın okuyucuları (docs/planlar: cari §5.5, §6.5–§6.10): Ödemeler listesi (upcomingWithCari: faturasız
// borçlar, okuma anında mahsup, sessiz kalemler), sabah e-postası, Son ödenenler'in cari türü, nakit planı (cari
// kalemleri, K19 mal tahmini), Genel bakış, Claude'un odemeler ve tedarikci_ozeti araçları, Excel ve geçmiş ay onayı.
// Örnek: §4.9 Sütaş (bugün 30.10.2026; SUT151 3.100,00 ₺, hesapta 99,50 ₺).
// Çalıştırma: npx tsx --test tests/cari-odemeler.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildWorkbook,
  type CariExportRow,
} from "../src/app/api/export/workbook";
import {
  debtFacts,
  monthTaskFacts,
  monthTasks,
  paymentFacts,
} from "../src/app/panel/dashboard-tasks";
import { supplierMatchKey } from "../src/app/panel/faturalar/rules";
import { createModel } from "../src/lib/calc/engine";
import { dashboard } from "../src/lib/calc/insights";
import { parasutDifference } from "../src/lib/cari/balance";
import { cariAlerts } from "../src/lib/cari/match";
import { pastMonthEffects, pastMonthText } from "../src/lib/cari/months";
import { upcomingWithCari } from "../src/lib/cari/upcoming";
import {
  buildCashPlan,
  planNotes,
  type CashPlanInput,
} from "../src/lib/cash-plan";
import {
  supplierSummary,
  type LedgerGroupLike,
} from "../src/lib/mcp/answers/suppliers";
import {
  isEstimatedDue,
  upcomingPayments,
} from "../src/lib/mcp/answers/payments";
import { odemelerInput } from "../src/lib/mcp/schemas";
import {
  liveRecentPaid,
  parseRecentPaid,
  paymentUnchanged,
  type RecentPaid,
} from "../src/lib/recent-paid";
import {
  cariItem,
  dueNotifications,
  type UpcomingHint,
  type UpcomingItem,
} from "../src/lib/reminders";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const seed = () =>
  excelToDataset(
    JSON.parse(
      readFileSync(
        join(__dirname, "..", "src/server/db/seed/excel-data.json"),
        "utf8",
      ),
    ) as ExcelData,
  );

const TODAY = "2026-10-30";
const SUTAS = 7;

/** Sütaş'ın 30.10'daki açık kalemleri: SUT151 (3.100,00; vade 29.11) */
const sut151 = {
  id: 151,
  supplier: "Sütaş",
  invoiceNo: "SUT151",
  date: "2026-10-30",
  dueDate: "2026-11-29",
  payable: 3100,
  outstanding: null,
  allocated: 0,
  ledgerBase: 0,
  termDays: 30,
  cardId: SUTAS,
};

test("Ödemeler: hesaptaki para okuma anında düşülür (SUT151 3.000,50 · hesaptaki 99,50); veritabanına bir şey yazılmaz", () => {
  const up = upcomingWithCari(
    { reminders: [], invoices: [sut151], credit: new Map([[SUTAS, 99.5]]) },
    TODAY,
  );
  assert.equal(up.items.length, 1);
  const [it] = up.items;
  assert.equal(it.amount, 3000.5);
  assert.equal(it.credited, 99.5);
  assert.equal(it.supplierId, SUTAS);
  assert.equal(up.covered.length, 0);
  // Para kalemi tamamen karşılarsa listeden çıkar, "karşılananlar"a gider (tutarı mahsuptan önceki kalan)
  const full = upcomingWithCari(
    {
      reminders: [],
      invoices: [{ ...sut151, payable: 80 }],
      credit: new Map([[SUTAS, 99.5]]),
    },
    TODAY,
  );
  assert.equal(full.items.length, 0);
  assert.equal(full.covered.length, 1);
  assert.equal(full.covered[0].credited, 80);
  // Başka kartın parası bu kalemden düşmez
  const other = upcomingWithCari(
    { reminders: [], invoices: [sut151], credit: new Map([[99, 500]]) },
    TODAY,
  );
  assert.equal(other.items[0].amount, 3100);
  assert.equal(other.items[0].credited, undefined);
});

test("Ödemeler: faturasız borç kalemi (cari), vade sırası, sessiz 'link' kalemi mahsupta atlanır, ufuk ve takvim", () => {
  const debts = [
    {
      id: 1,
      supplier: "Sütaş",
      date: "2026-10-20",
      dueDate: null,
      description: "süt, irsaliye 4411",
      costMode: "fatura" as const,
      remaining: 1250,
      termDays: 30,
      cardId: SUTAS,
    },
    {
      id: 2,
      supplier: "Sütaş",
      date: "2026-10-21",
      dueDate: "2026-11-20",
      description: "beyaz peynir",
      costMode: "gider" as const,
      remaining: 600,
      termDays: 30,
      cardId: SUTAS,
    },
    // Ufuktan sonra: takvimde
    {
      id: 3,
      supplier: "Sütaş",
      date: "2026-10-22",
      dueDate: "2027-01-30",
      description: null,
      costMode: "devir" as const,
      remaining: 400,
      termDays: 30,
      cardId: SUTAS,
    },
  ];
  const hint: UpcomingHint = {
    kind: "link",
    text: "Faturasız alımın faturası olabilir (20.10 · süt)",
    href: "/panel/tedarikciler/sutas?bagla=149",
    invoiceId: 149,
    debtIds: [1],
  };
  const sut149 = {
    ...sut151,
    id: 149,
    invoiceNo: "SUT149",
    date: "2026-10-28",
    dueDate: null,
    payable: 1250,
  };
  const up = upcomingWithCari(
    {
      reminders: [],
      invoices: [sut149],
      debts,
      credit: new Map([[SUTAS, 1300]]),
      hints: new Map([["invoice:149", { quiet: "link", hint }]]),
      hrefOf: () => "/panel/tedarikciler/sutas",
    },
    TODAY,
  );
  const refs = up.items.map((i) => i.ref);
  // B1 (vade 19.11, tahmini) 1.250 hesaptan karşılandı; B2 50 ₺ kısmen; SUT149 sessiz (mahsup atlar), tam tutarıyla
  assert.deepEqual(
    up.covered.map((i) => i.ref),
    ["cari:1"],
  );
  assert.deepEqual(refs, ["cari:2", "invoice:149"]);
  const b2 = up.items.find((i) => i.ref === "cari:2")!;
  assert.equal(b2.amount, 550);
  assert.equal(b2.credited, 50);
  assert.equal(b2.href, "/panel/tedarikciler/sutas");
  assert.equal(b2.detail, "Faturasız alım · beyaz peynir");
  const q = up.items.find((i) => i.ref === "invoice:149")!;
  assert.equal(q.quiet, "link");
  assert.equal(q.amount, 1250);
  assert.equal(q.hint?.kind, "link");
  assert.deepEqual(
    up.later.map((i) => i.ref),
    ["cari:3"],
  );
  // Eski borcun ayrıntısı ve tahmini vade metni (Claude'un isEstimatedDue'su da tanır)
  const est = cariItem(debts[0], TODAY, 3, 30);
  assert.equal(
    est.detail,
    "Fatura bekleniyor · süt, irsaliye 4411 · vade tahmini (30 gün)",
  );
  assert.equal(est.dueDate, "2026-11-19");
  assert.equal(isEstimatedDue(est), true);
  assert.equal(isEstimatedDue(b2), false);
  assert.equal(
    cariItem({ ...debts[2], description: "" }, TODAY, 3, 30).detail,
    "Eski borç",
  );
});

test("sabah e-postası: sessiz kalemler (link, kasa) hatırlatılmaz; faturasız borcun anahtarı cari:<kimlik>:<vade>:<aşama>", () => {
  const due = cariItem(
    {
      id: 5,
      supplier: "Sütaş",
      date: "2026-10-01",
      dueDate: TODAY,
      description: "süt",
      costMode: "gider",
      remaining: 600,
    },
    TODAY,
    3,
    30,
  );
  const quiet: UpcomingItem = {
    ...due,
    ref: "invoice:9",
    source: "invoice",
    sourceId: 9,
    quiet: "link",
  };
  const kasa: UpcomingItem = {
    ...due,
    ref: "invoice:10",
    source: "invoice",
    sourceId: 10,
    quiet: "kasa",
  };
  const out = dueNotifications([due, quiet, kasa]);
  assert.deepEqual(
    out.map((o) => o.key),
    [`cari:5:${TODAY}:due`],
  );
});

test("Son ödenenler: cari ödeme kaydı; ödeme silindiyse ya da sonradan düzenlendiyse geri alınamaz", () => {
  const at = "2026-10-22T10:00:05.000Z";
  const stamp = "2026-10-22T10:00:04.512Z";
  const list = parseRecentPaid([
    {
      kind: "cari",
      id: 41,
      title: "Sütaş",
      amount: 10000,
      dueDate: "2026-10-22",
      at,
      method: "havale",
      items: 2,
      stamp,
    },
    {
      kind: "cari",
      id: 42,
      title: "Sütaş",
      amount: 2200,
      dueDate: "2026-10-24",
      at,
      method: "kasa",
      items: 3,
      stamp,
    },
    {
      kind: "cari",
      id: 43,
      title: "Sütaş",
      amount: 50,
      dueDate: "2026-10-24",
      at,
      stamp,
    },
    { kind: "bilinmeyen", id: 1, title: "x", at },
  ]) as RecentPaid[];
  assert.equal(list.length, 3);
  // 41 aynı, 42 sonradan düzenlendi, 43 silindi
  const live = liveRecentPaid(
    list,
    [],
    [],
    new Map([
      [41, stamp],
      [42, "2026-10-23T08:00:00.000Z"],
    ]),
  );
  assert.deepEqual(
    live.map((e) => e.id),
    [41],
  );
  // Saat farkı olan veritabanı: damga varsa anlar karşılaştırılmaz, damga aynı mı diye bakılır
  assert.equal(
    paymentUnchanged(
      { at, stamp: "2026-10-22T10:00:06.000Z" },
      "2026-10-22T10:00:06.000Z",
    ),
    true,
  );
  // Eski kayıt (damgasız): kaydın anından yeni düzenleme
  assert.equal(paymentUnchanged({ at }, "2026-10-22T10:00:04.000Z"), true);
  assert.equal(paymentUnchanged({ at }, "2026-10-22T10:00:06.000Z"), false);
});

function planInput(over: Partial<CashPlanInput>): CashPlanInput {
  return {
    today: TODAY,
    opening: { amount: 50_000, date: TODAY },
    excluded: [],
    settings: {
      komisyon: 0.025,
      kartOrani: 0.8,
      acikGun: 30,
      kdv: 0.1,
      kdvHizmet: 0.2,
    },
    invoiceTermDays: 30,
    cashReports: [],
    posMonth: null,
    online: null,
    invoices: [],
    reminders: [],
    goods: [],
    goodsSpanDays: 0,
    months: {},
    fixedNames: [],
    vat: { months: [], firstSalesMonth: null, hasSite: false },
    vatAnchor: null,
    ...over,
  };
}

test("nakit planı: faturasız borç kesin kalem (cari:<kimlik>), mahsuptan sonraki tutarla; sessiz 'link' fatura girmez; notlar", () => {
  const debt = {
    ...cariItem(
      {
        id: 2,
        supplier: "Sütaş",
        date: "2026-10-21",
        dueDate: "2026-11-20",
        description: "beyaz peynir",
        costMode: "gider",
        remaining: 600,
      },
      TODAY,
      3,
      30,
    ),
    amount: 500.5,
    credited: 99.5,
  };
  const quiet: UpcomingItem = {
    ...cariItem(
      {
        id: 9,
        supplier: "Sütaş",
        date: "2026-10-28",
        dueDate: "2026-11-27",
        description: null,
        costMode: "fatura",
        remaining: 1250,
      },
      TODAY,
      3,
      30,
    ),
    ref: "invoice:149",
    source: "invoice",
    sourceId: 149,
    quiet: "link",
  };
  const p = buildCashPlan(planInput({ invoices: [debt, quiet] }));
  const all = p.weeks.flatMap((w) => w.lines);
  const line = all.find((l) => l.key === "cari:2");
  assert.ok(line, "faturasız borç planda");
  assert.equal(line!.amount, 500.5);
  assert.equal(line!.title, "Sütaş · faturasız alım");
  assert.equal(line!.href, "/panel/hatirlaticilar?kaynak=cari");
  assert.equal(
    all.some((l) => l.key === "invoice:149"),
    false,
    "faturası gelmiş olabilecek fatura bağlanana kadar planda yok",
  );
  assert.deepEqual(p.basis.cari, { count: 1, credited: true });
  const notes = planNotes(p, {
    komisyon: 0.025,
    acikGun: 30,
    invoiceTermDays: 30,
  });
  assert.match(
    notes.find((n) => n.key === "credit")!.text,
    /hesabındaki sayılmamış ödeme borcundan düşüldü/,
  );
  assert.match(
    notes.find((n) => n.key === "invoices")!.text,
    /faturasız borçlar \(1\)/,
  );
});

test("nakit planı K19: faturası beklenen borç kadar tedarikçinin mal tahmini düşer; borç yokken tahmin aynı", () => {
  const goods = [
    { supplier: "SÜTAŞ A.Ş.", date: "2026-10-10", payable: 5_600, lagDays: 0 },
    { supplier: "Pazar", date: "2026-10-12", payable: 5_600, lagDays: 0 },
  ];
  const base = buildCashPlan(planInput({ goods, goodsSpanDays: 56 }));
  const keys = ["Sütaş", "SÜTAŞ A.Ş."].map(supplierMatchKey);
  const reduced = buildCashPlan(
    planInput({
      goods,
      goodsSpanDays: 56,
      expectedDebts: [{ name: "Sütaş", keys, amount: 1_250 }],
    }),
  );
  const goodsOf = (p: typeof base) =>
    p.weeks.reduce(
      (a, w) => a + (w.lines.find((l) => l.key === "goods")?.amount ?? 0),
      0,
    );
  // Anahtarlar supplierMatchKey ile: kartın adı ve diğer adları
  assert.equal(
    reduced.basis.goodsReduced.length,
    1,
    JSON.stringify(reduced.basis.goodsReduced),
  );
  assert.equal(reduced.basis.goodsReduced[0].name, "Sütaş");
  assert.ok(
    Math.abs(goodsOf(base) - goodsOf(reduced) - 1_250) < 0.01,
    `${goodsOf(base)} − ${goodsOf(reduced)}`,
  );
  assert.match(
    planNotes(reduced, {
      komisyon: 0.025,
      acikGun: 30,
      invoiceTermDays: 30,
    }).find((n) => n.key === "goods")!.text,
    /Sütaş tahmini, faturası beklenen 1\.250\s₺ kadar düşürüldü/u,
  );
  // Tahmin borçtan küçükse sıfıra iner, eksiye düşmez
  const capped = buildCashPlan(
    planInput({
      goods,
      goodsSpanDays: 56,
      expectedDebts: [{ name: "Sütaş", keys, amount: 999_999 }],
    }),
  );
  const sutasLeft = capped.weeks
    .flatMap((w) => w.lines)
    .filter((l) => l.key === "goods")
    .reduce((a, l) => a + l.amount, 0);
  assert.ok(
    sutasLeft > 0 && Math.abs(sutasLeft - goodsOf(base) / 2) < 0.01,
    "yalnız Pazar'ın tahmini kalır",
  );
  assert.deepEqual(
    buildCashPlan(planInput({ goods, goodsSpanDays: 56, expectedDebts: [] })),
    base,
  );
});

test("Genel bakış: görev satırı faturasız borçları söyler; 45 gün ve faturası gelmiş olabilir uyarıları", () => {
  const p = paymentFacts([], { count: 0, total: 0 }, { count: 2, total: 1850 });
  assert.deepEqual(p.debts, { count: 2, total: 1850, overdue: 0, soon: 0 });
  assert.equal(
    paymentFacts([], { count: 0, total: 0 }).debts,
    undefined,
    "kayıt yokken alan yok (bugünkü özet)",
  );
  const model = createModel({ ...seed(), currentMonth: "2026-10" });
  const d = dashboard(model, "2026-09");
  const tasks = monthTasks(
    monthTaskFacts(model, "2026-09", d.monthState, d.refMonth, {
      payments: p,
      parasut: null,
    }),
  );
  const odeme = tasks.find((t) => t.key === "odeme")!;
  assert.equal(
    odeme.detail.replace(/\u00a0/g, " "),
    "Geciken ya da yaklaşan ödeme yok · 2 faturasız borç (1.850 ₺).",
  );
  assert.equal(odeme.href, "/panel/hatirlaticilar?kaynak=cari");

  const alerts = cariAlerts({
    late: [
      {
        name: "Sütaş",
        date: "2026-09-01",
        description: "süt",
        amount: 1250,
        href: "/panel/tedarikciler/sutas",
      },
    ],
    strong: [{ name: "Sütaş", href: "/panel/tedarikciler/sutas" }],
  });
  assert.deepEqual(
    alerts.map((a) => a.title),
    [
      "Faturası 45 gündür gelmeyen alım",
      "Faturasız alımın faturası gelmiş olabilir",
    ],
  );
  assert.equal(
    alerts[0].detail.replace(/\u00a0/g, " "),
    "Sütaş: 01.09 · süt · 1.250,00 ₺",
  );
  assert.equal(alerts[0].href, "/panel/tedarikciler/sutas?sekme=hareketler");
  assert.deepEqual(cariAlerts({ late: [], strong: [] }), []);
});

test("Claude odemeler: kaynak 'cari', tür 'cari borç', mahsup notu; tedarikci_ozeti faturasız borç, hesaptaki ödeme, net bakiye", () => {
  const debt = {
    ...cariItem(
      {
        id: 2,
        supplier: "Sütaş",
        date: "2026-10-21",
        dueDate: null,
        description: "beyaz peynir",
        costMode: "gider",
        remaining: 600,
      },
      TODAY,
      3,
      30,
    ),
    credited: 50,
    amount: 550,
  };
  const inv: UpcomingItem = {
    ...cariItem(
      {
        id: 0,
        supplier: "Pınar",
        date: "2026-10-01",
        dueDate: "2026-11-05",
        description: null,
        costMode: "fatura",
        remaining: 900,
      },
      TODAY,
      3,
      30,
    ),
    ref: "invoice:5",
    source: "invoice",
    sourceId: 5,
    detail: "Fatura P5",
  };
  const ctx = { base: "https://panel.example" };
  const cari = upcomingPayments(
    { today: TODAY, items: [debt, inv], invoiceTermDays: 30 },
    odemelerInput.parse({ kaynak: "cari" }),
    null,
    ctx,
  );
  assert.deepEqual(
    cari.kalemler.map((k) => [k.baslik, k.tur, k.tutar, k.tahminiVade]),
    [["Sütaş", "cari borç", 550, true]],
  );
  assert.ok(cari.hesap.some((h) => /hesabındaki sayılmamış ödeme/.test(h)));
  const fatura = upcomingPayments(
    { today: TODAY, items: [debt, inv], invoiceTermDays: 30 },
    odemelerInput.parse({ kaynak: "fatura" }),
    null,
    ctx,
  );
  assert.deepEqual(
    fatura.kalemler.map((k) => k.tur),
    ["fatura"],
  );

  const group: LedgerGroupLike = {
    key: "sutas",
    keys: ["sutas"],
    slug: "sutas",
    name: "Sütaş",
    names: ["Sütaş"],
    termDays: 30,
    card: { paidOnDelivery: false, paymentMethod: "havale" },
    invoices: [
      {
        supplier: "Sütaş",
        date: "2026-10-30",
        payable: 3100,
        unpaid: true,
        invoiceNo: "SUT151",
        category: "Hammadde & İçecek",
      },
    ],
    summary: { open: 3100 },
    account: {
      open: 3100,
      balance: 3000.5,
      credit: 99.5,
      debtOpen: 0,
      debtOpenCount: 0,
    },
    cariPayments: [
      { date: "2026-10-24", amount: 2200, method: "kasa", items: 4 },
      { date: "2026-10-22", amount: 10000, method: "havale", items: 2 },
    ],
  };
  const one = supplierSummary(
    { today: TODAY, groups: [group] },
    { tedarikci: "Sütaş", baslangic: "2026-01-01", bitis: TODAY, limit: 20 },
    ctx,
  );
  assert.ok("ozet" in one && "tedarikci" in one);
  if (!("tedarikci" in one)) return;
  assert.deepEqual(one.ozet.faturasizBorc, { adet: 0, tutar: 0 });
  assert.equal(one.ozet.hesaptakiOdeme, 99.5);
  assert.equal(one.ozet.netBakiye, 3000.5);
  // Son ödeme: dönemdeki cari ödeme kaydı da ödeme olayıdır (§4.7); dönem dışındaki sayılmaz
  assert.equal(one.ozet.sonOdeme, "2026-10-24");
  const before = supplierSummary(
    { today: TODAY, groups: [group] },
    { tedarikci: "Sütaş", baslangic: "2026-01-01", bitis: "2026-10-23", limit: 20 },
    ctx,
  );
  assert.ok("ozet" in before);
  if ("ozet" in before) assert.equal(before.ozet.sonOdeme, "2026-10-22");
  const paidInvoice = { ...group, invoices: [...group.invoices, { supplier: "Sütaş", date: "2026-10-26", payable: 500, unpaid: false, paidAt: "2026-10-27", invoiceNo: "SUT150", category: "Hammadde & İçecek" }] };
  const later = supplierSummary({ today: TODAY, groups: [paidInvoice] }, { tedarikci: "Sütaş", baslangic: "2026-01-01", bitis: "2026-10-31", limit: 20 }, ctx);
  assert.ok("ozet" in later);
  if ("ozet" in later) assert.equal(later.ozet.sonOdeme, "2026-10-27", "faturada işaretli daha yeni ödeme");
  assert.deepEqual(one.sonOdemeler[0], {
    tarih: "2026-10-24",
    tutar: 2200,
    sekil: "Kasadan",
    sayildigiKalem: 4,
  });
  assert.ok(
    one.kaynak.some((k) =>
      /Ödemeler panelde elle girilir; banka bağlı değil/.test(k),
    ),
  );
  const all = supplierSummary(
    { today: TODAY, groups: [group] },
    { baslangic: "2026-01-01", bitis: TODAY, limit: 20 },
    ctx,
  );
  assert.ok("tedarikciler" in all);
  if ("tedarikciler" in all) {
    assert.equal(all.tedarikciler[0].netBakiye, 3000.5);
    assert.equal(all.toplam.hesaptakiOdeme, 99.5);
  }
});

test("Excel: 'Cari hareketleri' sekmesi (yalnız kayıt varsa) ve Faturalar'da 'Panelde ödenen'", () => {
  const ds = seed();
  ds.currentMonth = "2026-10";
  ds.invoices[0] = {
    ...ds.invoices[0],
    unpaid: true,
    allocated: 1549.5,
    ledgerBase: 0,
  };
  const model = createModel(ds);
  const rows: CariExportRow[] = [
    {
      date: "2026-10-22",
      supplier: "Sütaş",
      movement: "Ödeme",
      description: null,
      debt: null,
      payment: 10000,
      method: "Havale / EFT",
      counted: "SUT123 8.450,50 · SUT140 1.549,50 · hesapta 0,00",
      invoice: null,
      note: null,
    },
    {
      date: "2026-10-20",
      supplier: "Sütaş",
      movement: "Faturasız alım (faturası gelecek)",
      description: "süt",
      debt: 1250,
      payment: null,
      method: null,
      counted: null,
      invoice: "SUT149",
      note: null,
    },
  ];
  const wb = buildWorkbook(model, "2026-09", {
    investments: [],
    findings: [],
    now: new Date("2026-10-30T10:00:00Z"),
    cari: rows,
  });
  const ws = wb.getWorksheet("Cari hareketleri");
  assert.ok(ws, "sekme var");
  assert.deepEqual((ws!.getRow(1).values as unknown[]).slice(1), [
    "Tarih",
    "Tedarikçi",
    "Hareket",
    "Açıklama",
    "Borç",
    "Ödeme",
    "Şekil",
    "Sayıldığı",
    "Fatura bağı",
    "Not",
  ]);
  // Gün sırasıyla
  assert.equal(
    ws!.getRow(2).getCell(3).value,
    "Faturasız alım (faturası gelecek)",
  );
  assert.equal(ws!.getRow(3).getCell(6).value, 10000);
  const names = wb.worksheets.map((w) => w.name);
  assert.equal(
    names.indexOf("Cari hareketleri"),
    names.indexOf("Aylık Alımlar") + 1,
  );
  const fa = wb.getWorksheet("Faturalar")!;
  assert.equal(fa.getRow(1).getCell(14).value, "Panelde ödenen");
  assert.equal(fa.getRow(2).getCell(14).value, 1549.5);
  assert.equal(
    fa.getRow(2).getCell(13).value,
    Math.round((ds.invoices[0].payable - 1549.5) * 100) / 100,
  );
  // Kayıt yokken sekme yok
  const plain = buildWorkbook(
    createModel({ ...seed(), currentMonth: "2026-10" }),
    "2026-09",
    { investments: [], findings: [], now: new Date("2026-10-30T10:00:00Z") },
  );
  assert.equal(plain.getWorksheet("Cari hareketleri"), undefined);
});

test("geçmiş ay onayı (K18): yalnız kategorisi değişen geçmiş ay gideri de onay ister; toplam değişmez", () => {
  const moved = pastMonthEffects(
    [
      { date: "2026-09-21", delta: -600 },
      { date: "2026-09-21", delta: 600 },
      { date: "2026-09-21", delta: 0, moved: 600 },
      { date: "2026-09-21", delta: 0, moved: 600 },
    ],
    TODAY,
  );
  assert.deepEqual(moved, [{ month: "2026-09", delta: 0, moved: 1200 }]);
  assert.equal(
    pastMonthText({ month: "2026-09", delta: 0, moved: 600 }).replace(
      /\u00a0/g,
      " ",
    ),
    "Eylül 2026 gideri: 600,00 ₺ başka kategoriye geçer (geçmiş ay; toplam değişmez)",
  );
  // Kategori aynı, tutar aynı: onay yok; tutar değişince bugünkü gibi
  assert.deepEqual(
    pastMonthEffects(
      [
        { date: "2026-09-21", delta: -600 },
        { date: "2026-09-21", delta: 600 },
      ],
      TODAY,
    ),
    [],
  );
  assert.deepEqual(
    pastMonthEffects(
      [
        { date: "2026-09-21", delta: -600 },
        { date: "2026-09-21", delta: 650 },
      ],
      TODAY,
    ),
    [{ month: "2026-09", delta: 50 }],
  );
});

test("Faturalar'ın Paraşüt ipucu: takipli faturada Paraşüt'ün kalanı panelinkinden farklıysa (iki yön), takipsizde yok", () => {
  const f = { payable: 3000, unpaid: true, ledgerBase: 1200, allocated: 1549.5 };
  assert.equal(parasutDifference({ ...f, outstanding: 250.5 }), null, "iki taraf eşit");
  assert.deepEqual(parasutDifference({ ...f, outstanding: 100 }), { parasut: 100, panel: 250.5, lower: true });
  assert.deepEqual(parasutDifference({ ...f, outstanding: 1800 }), { parasut: 1800, panel: 250.5, lower: false });
  assert.equal(parasutDifference({ payable: 3000, unpaid: true, outstanding: 1800 }), null, "takipsiz: kalan zaten Paraşüt'ün");
  assert.equal(parasutDifference({ ...f, unpaid: false, outstanding: 100 }), null);
});

test("Genel bakış: gecikmiş faturasız borç görev satırında iki kez sayılmaz; tutar mahsuptan sonraki (net)", () => {
  // Sütaş: 10.10 tarihli, vadesi 20.10, 5.000 ₺ faturası gelecek borç ve 300 ₺ alım; hesapta 1.600 ₺; Metro faturası gecikmiş
  const up = upcomingWithCari(
    {
      reminders: [],
      invoices: [{ id: 1, supplier: "Metro", date: "2026-09-01", dueDate: "2026-10-01", payable: 11516.77, invoiceNo: "M1", outstanding: null, termDays: null, cardId: null }],
      debts: [
        { id: 1, supplier: "Sütaş", date: "2026-10-10", dueDate: "2026-10-20", remaining: 5000, description: "süt", costMode: "fatura", cardId: 7, termDays: 30 },
        { id: 2, supplier: "Sütaş", date: "2026-10-24", dueDate: null, remaining: 300, description: "krema", costMode: "fatura", cardId: 7, termDays: 30 },
      ],
      credit: new Map([[7, 1600]]),
    },
    "2026-10-25",
  );
  const all = [...up.items, ...up.later];
  const p = paymentFacts(up.items, { count: 1, total: 11516.77 }, debtFacts(all));
  assert.deepEqual(p.debts, { count: 2, total: 3700, overdue: 1, soon: 0 }, "net: 3.400 + 300");
  const model = createModel({ ...seed(), currentMonth: "2026-10" });
  const d = dashboard(model, "2026-09");
  const odeme = monthTasks(monthTaskFacts(model, "2026-09", d.monthState, d.refMonth, { payments: p, parasut: null })).find((t) => t.key === "odeme")!;
  const text = odeme.detail.replace(/ /g, " ");
  assert.doesNotMatch(text, /Ayrıca/);
  assert.match(text, /^2 ödeme gecikti \(14\.916,77 ₺, 1 faturasız borç dahil\)\./);
  // Borçlar hesaptaki parayla tamamen karşılanınca görev satırı onları söylemez
  const covered = upcomingWithCari(
    { reminders: [], invoices: [], debts: [{ id: 1, supplier: "Sütaş", date: "2026-10-10", dueDate: "2026-10-20", remaining: 5000, description: "süt", costMode: "fatura", cardId: 7, termDays: 30 }], credit: new Map([[7, 6000]]) },
    "2026-10-25",
  );
  assert.equal(paymentFacts(covered.items, { count: 0, total: 0 }, debtFacts([...covered.items, ...covered.later])).debts, undefined);
});

test("Ödemeler: kalanı 0 olan takipli fatura (tutar takip öncesi kısma indi) listede 0 ₺ kalem olmaz", () => {
  const up = upcomingWithCari(
    {
      reminders: [],
      invoices: [
        { id: 7, supplier: "Sütaş", date: "2026-10-18", dueDate: "2026-10-27", payable: 1200, invoiceNo: "SUT140", outstanding: 1800, ledgerBase: 1200, allocated: 0, cardId: 1 },
        { id: 8, supplier: "Sütaş", date: "2026-10-18", dueDate: "2026-10-27", payable: 1250, invoiceNo: "SUT141", outstanding: null, ledgerBase: 0, allocated: 0, cardId: 1 },
      ],
    },
    "2026-10-25",
  );
  assert.deepEqual(up.items.map((i) => [i.sourceId, i.amount]), [[8, 1250]]);
});
