// Muhasebeci (salt okunur hesap; docs/ROLLER.md) ekranlarında yazma düğmesi ve açamayacağı ekrana bağlantı görmez
// (denetim, 28 Kasım 2026). Sunucu eylemleri muhasebeciyi zaten reddediyordu; kusur ekrandaydı: Faturalar, Gelir-gider ve
// Aylık harcamalar yöneticinin ekranını aynen çiziyordu (Fatura ekle, Sil, girilebilir hücre, Harcama ekle…), Kasa
// raporunda zayi "Ekle", fotoğraf seçici ve "Kümülatifi temizle" kalıyordu; tutarların kaynak bağlantıları Satışlar,
// Stok sayımı, Maaşlar, Sabit giderler, Paraşüt ve Hammaddeler'e gidiyordu (tıklayan ana ekranına dönerdi).
//
// Kural tek yerde: src/lib/roles.ts › isReadOnly (yazma) ve openableHref (bağlantı). Bu dosya ekranların İSTEMCİ
// bileşenlerini iki rolle çizer (HTML): muhasebecide yazma düğmesi ve kapalı ekrana bağlantı yok, yöneticide aynı
// düğmeler duruyor (karşılaştırma boşa geçmesin). Sunucu sayfaları: tests/muhasebeci-ekran-db.test.ts.
// Çalıştırma: npx tsx --test tests/muhasebeci-salt-okunur.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, test } from "node:test";

import { createElement, type ComponentProps, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Role } from "../src/lib/constants";
import { ACCOUNTANT_PATHS, can, canOpen, isReadOnly, openableHref } from "../src/lib/roles";

// İstemci bileşenleri Next'in yönlendirici kancalarını okur: test ortamında sabit değerler
const require = createRequire(import.meta.url);
const stub = (id: string, exports: unknown) => {
  const p = require.resolve(id);
  require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
};
let query = "";
stub("server-only", {});
stub("next/navigation", {
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {} }),
  usePathname: () => "/panel",
  useSearchParams: () => new URLSearchParams(query),
});

let InvoicesClient: typeof import("../src/app/panel/faturalar/invoices-client").InvoicesClient;
let CashOutInvoicesCard: typeof import("../src/app/panel/faturalar/cash-out-invoices").CashOutInvoicesCard;
let ReviewNotice: typeof import("../src/app/panel/faturalar/review-notice").ReviewNotice;
let lineLinks: typeof import("../src/app/panel/faturalar/invoice-lines").lineLinks;
let PnlGrid: typeof import("../src/app/panel/gelir-gider/pnl-grid").PnlGrid;
let SiteSalesCard: typeof import("../src/app/panel/gelir-gider/site-sales-card").SiteSalesCard;
let rowLink: typeof import("../src/app/panel/gelir-gider/row-links").rowLink;
let rowLinkFor: typeof import("../src/app/panel/gelir-gider/row-links").rowLinkFor;
let revenueBreakdown: typeof import("../src/app/panel/gelir-gider/breakdowns").revenueBreakdown;
let MonthlyExpenses: typeof import("../src/app/panel/harcamalar/monthly-expenses").MonthlyExpenses;
let CashHistory: typeof import("../src/app/panel/kasa/cash-history").CashHistory;
let AsilposPhotoCard: typeof import("../src/app/panel/kasa/asilpos-photo").AsilposPhotoCard;
let CashBreakdown: typeof import("../src/app/panel/kasa/cash-summary").CashBreakdown;

before(async () => {
  ({ InvoicesClient } = await import("../src/app/panel/faturalar/invoices-client"));
  ({ CashOutInvoicesCard } = await import("../src/app/panel/faturalar/cash-out-invoices"));
  ({ ReviewNotice } = await import("../src/app/panel/faturalar/review-notice"));
  ({ lineLinks } = await import("../src/app/panel/faturalar/invoice-lines"));
  ({ PnlGrid } = await import("../src/app/panel/gelir-gider/pnl-grid"));
  ({ SiteSalesCard } = await import("../src/app/panel/gelir-gider/site-sales-card"));
  ({ rowLink, rowLinkFor } = await import("../src/app/panel/gelir-gider/row-links"));
  ({ revenueBreakdown } = await import("../src/app/panel/gelir-gider/breakdowns"));
  ({ MonthlyExpenses } = await import("../src/app/panel/harcamalar/monthly-expenses"));
  ({ CashHistory } = await import("../src/app/panel/kasa/cash-history"));
  ({ AsilposPhotoCard } = await import("../src/app/panel/kasa/asilpos-photo"));
  ({ CashBreakdown } = await import("../src/app/panel/kasa/cash-summary"));
});

/** Bileşenin HTML'i (kesilmez boşluk düz boşluk, kaçışlı tırnak ve & düz) */
function html<P extends object>(component: FunctionComponent<P>, props: P): string {
  return renderToStaticMarkup(createElement(component, props))
    .replace(/ /g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/** HTML'deki panel bağlantıları */
const panelLinks = (markup: string): string[] => [...markup.matchAll(/href="(\/panel[^"]*)"/g)].map((m) => m[1]);
const pathOf = (href: string) => href.split(/[?#]/, 1)[0];

/** Muhasebecinin HTML'inde açamayacağı ekrana bağlantı yok */
function assertOpenable(markup: string, where: string) {
  for (const href of panelLinks(markup)) assert.ok(openableHref("accountant", href) !== null, `${where}: muhasebeci ${href} adresini açamaz, bağlantısı çizildi`);
}

/** `texts` yöneticide VAR (ekranın düğmesi), muhasebecide YOK */
function assertOnlyAdmin(admin: string, accountant: string, texts: string[], where: string) {
  for (const t of texts) {
    assert.ok(admin.includes(t), `${where}: yöneticinin ekranında “${t}” olmalı (karşılaştırmanın dayanağı)`);
    assert.ok(!accountant.includes(t), `${where}: muhasebecinin ekranında “${t}” var`);
  }
}

/** `texts` muhasebecide de okunur (salt okunur = aynı bilgi, düğmesiz) */
function assertReadable(accountant: string, texts: string[], where: string) {
  for (const t of texts) assert.ok(accountant.includes(t), `${where}: muhasebecide “${t}” okunmalı`);
}

// ---------------------------------------------------------------- Kural

test("isReadOnly: yalnız muhasebeci salt okunur; tanınmayan rol de yazamaz (varsayılan kapalı)", () => {
  assert.equal(isReadOnly("accountant"), true);
  for (const role of ["admin", "manager", "staff"] as const) assert.equal(isReadOnly(role), false, role);
  assert.equal(isReadOnly(null), true);
  assert.equal(isReadOnly(undefined), true);
  // Tek soru: yazma yeteneğinin tersi (rol adıyla karşılaştırma değil)
  for (const role of ["admin", "manager", "staff", "accountant"] as const) assert.equal(isReadOnly(role), !can(role, "kayit.yaz"), role);
});

// ---------------------------------------------------------------- Gelir-gider

test("Gelir-gider: tutarların kaynak bağlantısı muhasebeciye yalnız açabildiği ekranlara", () => {
  const month = "2026-10";
  const keys = ["purchase:Sütaş", "commission:Getir", "commission:pos", "expense:3", "stock:closing", "stock:opening", "revenue", "personnel:net", "fixed:7"];
  const forRole = (role: Role) => Object.fromEntries(keys.map((k) => [k, rowLinkFor(role, rowLink(k, month, { value: 100, current: "2026-11" }))?.href ?? null]));
  const admin = forRole("admin");
  const accountant = forRole("accountant");
  // Yönetici her satırın kaynağına gider (eskisi gibi)
  for (const k of keys) assert.ok(admin[k], `yönetici: ${k}`);
  assert.deepEqual(Object.fromEntries(keys.map((k) => [k, rowLink(k, month, { value: 100, current: "2026-11" })?.href ?? null])), admin);
  assert.equal(rowLinkFor("accountant", null), null);
  // Muhasebeci: Faturalar ve Aylık harcamalar kalır; Satışlar, Stok sayımı, Maaşlar ve Sabit giderler ona kapalı
  assert.equal(accountant["purchase:Sütaş"], admin["purchase:Sütaş"]);
  assert.equal(accountant["commission:Getir"], admin["commission:Getir"]);
  assert.equal(accountant["expense:3"], "/panel/harcamalar?ay=2026-10");
  for (const k of ["commission:pos", "stock:closing", "stock:opening", "revenue", "personnel:net", "fixed:7"]) assert.equal(accountant[k], null, k);
  for (const href of Object.values(accountant)) if (href) assert.ok(canOpen("accountant", pathOf(href)), href);
});

test("Gelir-gider: ciro dökümünde aylar muhasebeciye bağlantısız, 'Satışlar'da girilir' denmez", () => {
  const calcs = [
    { month: "2026-09", revenueNet: 100_000, revenue: 110_000, site: null, info: { openDays: 30 } },
    { month: "2026-10", revenueNet: null, revenue: null, site: null, info: { openDays: 12 } },
  ] as unknown as Parameters<typeof revenueBreakdown>[0];
  const rows = (role?: Role) => revenueBreakdown(calcs, ["2026-09", "2026-10"], role).flatMap((g) => g.rows);
  assert.deepEqual(
    rows().map((r) => r.href),
    ["/panel/satislar?ay=2026-09", "/panel/satislar?ay=2026-10#m-pos"],
  );
  assert.deepEqual(
    rows("admin").map((r) => r.href),
    rows().map((r) => r.href),
  );
  assert.deepEqual(
    rows("accountant").map((r) => r.href),
    [undefined, undefined],
  );
  // Tutarlar aynı: yalnız bağlantı düşer
  assert.deepEqual(
    rows("accountant").map((r) => r.amount),
    rows("admin").map((r) => r.amount),
  );
  const note = (role: Role) => revenueBreakdown(calcs, ["2026-09", "2026-10"], role).find((g) => g.key === "girilmedi")?.note ?? "";
  assert.match(note("admin"), /Satışlar'da ciro girilir/);
  assert.doesNotMatch(note("accountant"), /girilir/);
});

const cell = (value: number | null, extra: object = {}) => ({ value, computed: null, overridden: false, ...extra });
const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const twelve = <T>(f: (i: number) => T): T[] => MONTHS.map((_, i) => f(i));
/** Ekim'de değeri olan satır (öbür aylar boş) */
const octRow = (def: object, c: object) => ({ def: { kind: "auto", editable: false, format: "money", ...def }, cells: twelve((i) => (i === 9 ? c : cell(null))), total: 1 }) as never;

function gridProps(role: Role): ComponentProps<typeof PnlGrid> {
  return {
    role,
    year: 2026,
    months: MONTHS,
    activeMonths: ["2026-10"],
    latestMonth: "2026-10",
    currentMonth: "2026-11",
    strip: MONTHS.map((m, i) => ({ key: m, short: String(i + 1), tone: i === 9 ? "good" : "empty", label: m })),
    openDays: twelve((i) => (i === 9 ? 31 : null)),
    dims: twelve(() => 31),
    monthNotes: twelve((i) => (i === 9 ? "Ekim notu: bayram" : null)),
    writeBranch: "tuzla",
    // Sayfa bağlantıyı role göre kurar (openableHref): Tedarikçiler muhasebeciye kapalı
    expectedDebts: { "2026-10": { total: 500, href: openableHref(role, "/panel/tedarikciler/sutas"), name: "Sütaş" } },
    sections: [
      {
        key: "mal",
        label: "Mal alışları",
        rows: [
          octRow({ key: "purchase:Sütaş", label: "Sütaş", section: "mal" }, cell(12_000)),
          octRow({ key: "stock:closing", label: "SONRAKİ AYA DEVREDEN MAL", section: "mal", editable: true }, cell(4_000, { tag: "sayım" })),
        ],
      },
      {
        key: "personel",
        label: "Personel giderleri",
        rows: [
          octRow(
            { key: "personnel:parttime", label: "PART-TIME", section: "personel", editable: true },
            cell(9_000, { info: "1 part-time kişi: günlük ücret × gün", warn: "1 kişinin Vardiya kişisi bağlı değil", note: "elle düzeltildi" }),
          ),
        ],
      },
      {
        key: "genel",
        label: "İşletme genel giderleri",
        rows: [
          octRow({ key: "manual:su", label: "SU GİDERİ", section: "genel", kind: "manual", editable: true }, cell(750)),
          octRow({ key: "fixed:7", label: "Muhasebe", section: "genel", editable: true }, cell(3_000)),
          octRow({ key: "expense:3", label: "Reklam", section: "genel" }, cell(2_500)),
        ],
      },
      {
        key: "sonuc",
        label: "Maliyet",
        rows: [octRow({ key: "revenue", label: "AYLIK CİRO", section: "sonuc", kind: "manual", editable: true }, cell(400_000))],
      },
    ],
  };
}

test("Gelir-gider tablosu: muhasebecide girilebilir hücre, ay notu düğmesi ve kapalı ekrana bağlantı yok; rakamlar ve ipuçları duruyor", () => {
  query = "aylar=12&ay=2026-10";
  const admin = html(PnlGrid, gridProps("admin"));
  const accountant = html(PnlGrid, gridProps("accountant"));
  query = "";
  // Girilebilir hücre: masaüstünde `data-pnl-col` taşıyan düğme
  assert.ok((admin.match(/data-pnl-col=/g) ?? []).length >= 5, "yöneticide girilebilir hücreler");
  assert.equal((accountant.match(/data-pnl-col=/g) ?? []).length, 0, "muhasebecide girilebilir hücre yok");
  assertOnlyAdmin(admin, accountant, ["Değiştirmek için tıklayın", "için not ekle", "notunu düzenle", "Ay notunu düzenle", "Girilebilir", "Hücreye tıklayın", "içini silip Enter", "tutar girmek için kaleme dokunun"], "Gelir-gider");
  assertReadable(accountant, ["12.000", "9.000", "400.000", "750", "1 part-time kişi: günlük ücret × gün", "1 kişinin Vardiya kişisi bağlı değil", "elle düzeltildi", "Ekim notu: bayram", "sayım"], "Gelir-gider");
  // Bağlantılar: yönetici Satışlar, Stok sayımı, Maaşlar, Sabit giderler ve Tedarikçiler'e de gider; muhasebeci yalnız
  // Faturalar ve Aylık harcamalar'a
  const adminLinks = panelLinks(admin).map(pathOf);
  for (const p of ["/panel/satislar", "/panel/sayim", "/panel/personel", "/panel/giderler", "/panel/tedarikciler/sutas", "/panel/faturalar", "/panel/harcamalar"]) {
    assert.ok(adminLinks.includes(p), `yöneticide ${p} bağlantısı`);
  }
  assertOpenable(accountant, "Gelir-gider tablosu");
  assert.deepEqual([...new Set(panelLinks(accountant).map(pathOf))].sort(), ["/panel/faturalar", "/panel/harcamalar"]);
});

test("Gelir-gider › laffogato.net kartı: muhasebecide çekme düğmeleri ve sitenin yönetim paneli bağlantısı yok", () => {
  const data: ComponentProps<typeof SiteSalesCard>["data"] = {
    configured: true,
    lastPullAt: "2026-11-27T06:00:00Z",
    lastOkAt: "2026-11-27T06:00:00Z",
    lastError: null,
    months: [
      {
        month: "2026-10",
        pulledAt: "2026-11-27T06:00:00Z",
        closed: true,
        cafe: 1000,
        shop: 500,
        karaoke: 250,
        total: 1750,
        cafeOrders: 10,
        shopOrders: 2,
        bookings: 1,
        gross: 2000,
        refunded: 0,
        net: 2000,
        vat: 250,
        discount: 0,
        delivery: 0,
        manualOrders: 0,
        manualNet: 0,
        counterOrders: 0,
        counterNet: 0,
        refundPending: 0,
        unmapped: 0,
      },
    ],
    choices: ["2026-11", "2026-10"],
    refreshMonths: ["2026-11"],
    sitePanelUrl: "https://ornek.test/admin",
    kdvRate: 0.1,
    serviceKdvRate: 0.2,
    switchDay: null,
    current: "2026-11",
  };
  const admin = html(SiteSalesCard, { data });
  const accountant = html(SiteSalesCard, { data, readOnly: true });
  assertOnlyAdmin(admin, accountant, ["Siteden yenile", "Siteden çek", "online satışlarını siteden yenile", "laffogato.net paneli", "https://ornek.test/admin"], "laffogato.net kartı");
  assertReadable(accountant, ["1.750"], "laffogato.net kartı");
});

// ---------------------------------------------------------------- Faturalar

const INVOICES = [
  { id: 1, date: "2026-11-03", supplier: "Sütaş", description: "süt", invoiceNo: "A1", category: "Hammadde & İçecek", amount: 1000, discount: 0, payable: 1010, unpaid: true, note: null, source: "manual" as const, needsReview: true },
  { id: 2, date: "2026-11-05", supplier: "Metro", description: null, invoiceNo: "B7", category: "Diğer", amount: 500, discount: 0, payable: 600, unpaid: false, note: "elden", source: "parasut" as const, externalId: "77", branchName: "Şubesi seçilmemiş" },
];

function invoiceProps(role: Role): ComponentProps<typeof InvoicesClient> {
  return {
    role,
    invoices: INVOICES,
    months: ["2026-11"],
    suppliers: ["Metro", "Sütaş"],
    supplierSlugs: {},
    branchOptions: [
      { value: "tuzla", label: "Tuzla" },
      { value: "marina", label: "Marina" },
    ],
  };
}

test("Faturalar listesi: muhasebecide ekleme, düzenleme, silme, ödendi işareti, kategori seçimi, onay ve toplu seçim yok", () => {
  const admin = html(InvoicesClient, invoiceProps("admin"));
  const accountant = html(InvoicesClient, invoiceProps("accountant"));
  assertOnlyAdmin(
    admin,
    accountant,
    ["Fatura ekle", "Ödendi olarak işaretle", 'aria-label="Düzenle"', 'aria-label="Sil"', "doğru, onayla", "faturasını seç", "Bu sayfadaki faturaları seç", ">Seç<", ": kategori", "Satıra tıklayınca düzenlenir", "toplu değiştir"],
    "Faturalar",
  );
  assert.equal((accountant.match(/type="checkbox"/g) ?? []).length, 0, "muhasebecide seçim kutusu yok");
  assert.equal((accountant.match(/role="switch"/g) ?? []).length, 0, "muhasebecide ödendi anahtarı yok");
  assertReadable(accountant, ["Sütaş", "Metro", "1.010,00", "600,00", "Ödenmedi", "Ödendi", "Hammadde & İçecek", "Kontrol", "Şubesi seçilmemiş", "Satıra tıklayınca fatura açılır"], "Faturalar");
  assertOpenable(accountant, "Faturalar listesi");
});

test("Faturalar › Kontrol bekleyen: muhasebecide 'Hepsini onayla' çubuğu ve kasadan faturalı alımların eylemleri yok", () => {
  query = "durum=kontrol";
  const cashOuts = [
    { id: 9, date: "2026-11-10", receiptDate: null, store: "Migros", description: "süt", amount: 240, vat: 20, docType: "e-arsiv", receiptNo: "F1", photoId: null, createdByName: "Ayşe", suggestedCategoryId: 3, branchId: "tuzla", tillName: null },
  ] as never;
  const props = (role: Role) => ({ ...invoiceProps(role), cashOuts, cashOutCategories: [{ id: 3, name: "Nakit malzeme" }] });
  const admin = html(InvoicesClient, props("admin"));
  const accountant = html(InvoicesClient, props("accountant"));
  query = "";
  // Düğmeler (kapanış etiketiyle: muhasebecinin notu "yönetici Faturalar'a ekler" der, düğme değildir)
  assertOnlyAdmin(admin, accountant, ["Hepsini onayla", "Faturalar'a ekle</button>", "Aylık harcamalar'a yaz</span>", "Listeden çıkar", "Kategori seçin"], "Kontrol bekleyen");
  // Kart bilgi olarak kalır: hangi alımın faturası bekleniyor
  assertReadable(accountant, ["Kasadan faturalı alımlar", "Migros", "240"], "Kontrol bekleyen");
  assertOpenable(accountant, "Kontrol bekleyen");

  // Kartın kendisi (iki kez sayılan satırla): "Gider kaydını sil" ve "Ayrı alım" da yok
  const duplicates = [
    {
      id: 11,
      date: "2026-11-02",
      receiptDate: null,
      store: "Bim",
      description: null,
      amount: 90,
      vat: null,
      docType: "fatura",
      receiptNo: null,
      photoId: null,
      createdByName: "Ali",
      branchId: "tuzla",
      tillName: null,
      expenseId: 4,
      expenseCategory: "Nakit malzeme",
      adopted: false,
      invoice: { id: 2, date: "2026-11-05", supplier: "Bim", invoiceNo: "X", payable: 90 },
    },
  ] as never;
  const card = (readOnly: boolean) => html(CashOutInvoicesCard, { rows: cashOuts, duplicates, categories: [{ id: 3, name: "Nakit malzeme" }], onAddInvoice: () => {}, readOnly });
  assertOnlyAdmin(card(false), card(true), ["Gider kaydını sil", "Ayrı alım", "Faturalar'a ekle</button>", "Listeden çıkar"], "Kasadan faturalı alımlar");
  assert.equal((card(true).match(/<button/g) ?? []).length, 0, "muhasebecinin kartında düğme yok");
  assert.equal((card(true).match(/<select/g) ?? []).length, 0, "muhasebecinin kartında kategori seçimi yok");
  assertReadable(card(true), ["İki kez sayılıyor"], "Kasadan faturalı alımlar");
});

test("Faturalar › uyarı: muhasebeciye ne yapacağı söylenmez (onay, kategori ve gider kaydı yöneticinin)", () => {
  const props = { count: 3, stockOnly: 1, cashOuts: 2, cashOutDuplicates: 1 };
  const admin = html(ReviewNotice, props);
  const accountant = html(ReviewNotice, { ...props, readOnly: true });
  assertOnlyAdmin(admin, accountant, ["kontrol edin", "Doğruysa onaylayın", "Faturalar'a ekleyin", "Gider kaydını silin", "yapın."], "Faturalar uyarısı");
  assertReadable(accountant, ["2 faturanın kategorisi tahmin", "1 fatura mal alışı sayılmıyor", "2 kasadan faturalı alım bekliyor", "1 kasa alımı iki kez sayılıyor"], "Faturalar uyarısı");
});

test("Fatura kalemleri: Hammaddeler ve Paraşüt bağlantıları muhasebeciye çizilmez", () => {
  const line = { productName: "Tam yağlı süt 1 L", ingredient: { name: "Süt" } };
  const admin = lineLinks("admin", line);
  assert.equal(pathOf(admin.ingredient ?? ""), "/panel/hammaddeler");
  assert.equal(pathOf(admin.link ?? ""), "/panel/parasut");
  assert.deepEqual(lineLinks("accountant", line), { ingredient: null, link: null });
  assert.deepEqual(lineLinks("accountant", { productName: "Bardak" }), { ingredient: null, link: null });
});

// ---------------------------------------------------------------- Aylık harcamalar

function expenseProps(role: Role): ComponentProps<typeof MonthlyExpenses> {
  return {
    role,
    month: "2026-11",
    isCurrent: true,
    categories: [
      { id: 1, name: "Influencer", section: "genel", panelGroup: "reklam", invoiceCategory: null, monthly: true, active: true, expected: true, entryCount: 1, monthEntries: 40_000, monthInvoices: 0, monthTotal: 40_000, prevTotal: 0, sharedTotal: 0 },
      { id: 2, name: "Reklam (faturalı)", section: "genel", panelGroup: "reklam", invoiceCategory: "Reklam & Tabela", monthly: false, active: true, expected: false, entryCount: 0, monthEntries: 0, monthInvoices: 3_000, monthTotal: 3_000, prevTotal: 0, sharedTotal: 0 },
    ],
    entries: [{ id: 5, date: "2026-11-04", categoryId: 1, description: "@kahvesever", amount: 40_000, paymentMethod: "havale", note: null }],
    invoices: [{ id: 8, date: "2026-11-06", supplier: "Tabelacı", net: 3_000, categoryId: 2, invoiceCategory: "Reklam & Tabela" }],
    fixed: [{ id: 3, name: "Instagram reklamı", section: "genel", group: "reklam", amount: 5_000 }],
    invoiceCategories: ["Reklam & Tabela"],
    branches: { options: [{ id: "tuzla", name: "Tuzla" }], defaultId: "isletme", ask: false },
  };
}

test("Aylık harcamalar: muhasebecide ekleme formu, kategori düğmeleri ve 'Aylık girişe çevir' yok", () => {
  const admin = html(MonthlyExpenses, expenseProps("admin"));
  const accountant = html(MonthlyExpenses, expenseProps("accountant"));
  assertOnlyAdmin(admin, accountant, ["Harcama ekle", "Kategori ekle", "kategorisini düzenle", "Aylık girişe çevir", "Yeni kategori", 'type="submit"', "Her ay aynı tutarla sayılan giderler"], "Aylık harcamalar");
  assert.equal((accountant.match(/<form/g) ?? []).length, 0, "muhasebecide form yok");
  assertReadable(accountant, ["Influencer", "@kahvesever", "40.000", "Tabelacı", "3.000", "Kategoriler"], "Aylık harcamalar");
  assertOpenable(accountant, "Aylık harcamalar");
});

// ---------------------------------------------------------------- Kasa raporu

test("Kasa raporu › günden güne: raporu girilmemiş günde 'Gir', onay bekleyen günde 'İncele' muhasebeciye çizilmez", () => {
  const props = (readOnly: boolean): ComponentProps<typeof CashHistory> => ({
    readOnly,
    monthLabel: "Kasım 2026",
    prevHref: "/panel/kasa?ay=2026-10",
    nextHref: null,
    days: [
      { date: "2026-11-12", report: null },
      { date: "2026-11-11", report: null },
    ],
    totals: { zTotal: 0, cash: 0, card: 0, short: 0, over: 0, reported: 0, days: 2 },
    whatsappPhone: null,
    latePending: { "2026-11-11": [{ id: 42, requestedByName: "Ayşe" }] },
  });
  const admin = html(CashHistory, props(false));
  const accountant = html(CashHistory, props(true));
  assertOnlyAdmin(admin, accountant, ["İncele", "/panel/onaylar#istek-42", "/panel/kasa?gun=2026-11-12"], "Kasa günden güne");
  assertReadable(accountant, ["Rapor girilmedi", "Onay bekliyor · Ayşe girdi"], "Kasa günden güne");
  assertOpenable(accountant, "Kasa günden güne");
});

test("Kasa raporu › gün sonu fotoğrafı: muhasebecide fotoğraf seçici ve 'Banka POS'a yaz' yok, karşılaştırma okunur", () => {
  const props = (readOnly: boolean): ComponentProps<typeof AsilposPhotoCard> => ({
    readOnly,
    date: "2026-11-20",
    branchId: "marina",
    state: { need: { z: false } as never, attached: 1, pending: 0, line: "Fotoğraf alındı", done: true, auto: true },
    storage: true,
    reading: "on",
    admin: { check: { state: "uyumlu", rows: [{ label: "Kart", photo: "1.200,00 ₺", asilpos: "1.200,00 ₺", ok: true }], zNoFromPhoto: null, readBankPos: 1200 } as never, bankPos: null },
  });
  const admin = html(AsilposPhotoCard, props(false));
  const accountant = html(AsilposPhotoCard, props(true));
  assertOnlyAdmin(admin, accountant, ["Banka POS'a yaz", 'type="file"'], "Gün sonu fotoğrafı");
  assertReadable(accountant, ["Fiş AsilPOS'la aynı", "Fotoğrafta"], "Gün sonu fotoğrafı");
});

test("Kasa raporu › yazarkasa kümülatifi: 'Kümülatifi temizle' muhasebeciye çizilmez, rakam okunur", () => {
  const report = { zTotal: 1000, cash: 400, card: 600, okcTotal: 1000, okcZNo: "12", okcCard: 600, okcCash: 400 } as never;
  const view = (clearable: boolean) => html(CashBreakdown, { report, audience: "admin" as const, okcAdmin: { reportId: 1, cumTotal: 250_000, cumVat: 20_000, outside: null, note: null, clearable } });
  assertOnlyAdmin(view(true), view(false), ["Kümülatifi temizle"], "Yazarkasa kümülatifi");
  assertReadable(view(false), ["250.000"], "Yazarkasa kümülatifi");
});

// ---------------------------------------------------------------- Ekran listesi

test("Muhasebecinin ekranları değişmedi: bu dosyanın saydığı beş ekran ve Hesabım", () => {
  assert.deepEqual([...ACCOUNTANT_PATHS], ["/panel/muhasebe", "/panel/faturalar", "/panel/gelir-gider", "/panel/harcamalar", "/panel/kasa", "/panel/hesap"]);
});
