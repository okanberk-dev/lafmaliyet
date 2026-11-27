// Muhasebeciye aylık paket (docs/MUHASEBE-PAKETI.md): ayın faturaları, harcamaları, kasa raporlarının özeti, yazarkasa
// Z'lerinin KDV dökümü ve sabit giderleri tek .xlsx'te; ayarlar, gönderim günü ve e-postanın özeti. Saf: veritabanına
// dokunmaz, tests/muhasebe-paketi.test.ts sınar. Veriyi src/server/muhasebe/paket.ts toplar.

import ExcelJS from "exceljs";

import { cellWidth, excelDate, HEADER_ARGB, TOTAL_ARGB } from "../../app/api/export/workbook";
import { monthTitle, prevMonth } from "../closed-period";
import { dateTimeTR, dateTR, tl } from "../format";

import type { PackageSettings } from "./paket-ayar";

// Ayarlar hafif dosyada (bildirim alıcılarının kapıları da okur); buradan da dışa verilir
export {
  DEFAULT_PACKAGE_SETTINGS,
  PACKAGE_HREF,
  PACKAGE_MAX_RECIPIENTS,
  PACKAGE_SETTINGS_KEY,
  parsePackageSettings,
  readRecipients,
  type PackageSent,
  type PackageSettings,
} from "./paket-ayar";

/** Ay kapanış e-postasının kendiliğinden gittiği günler: ayın 1'i, gidemezse 2'si ve 3'ü (sabah işi kaçarsa) */
export const PACKAGE_SEND_DAYS = [1, 2, 3] as const;

/**
 * Bugün (iş günü, YYYY-MM-DD) ay kapanış e-postası kendiliğinden gidecek mi; gidecekse hangi ayın paketi. Ayın 1'inde
 * (sabah işi kaçtıysa 2'si ya da 3'ünde) geçen ay için, ayar açık, alıcı varsa ve o ay kendiliğinden gönderilmediyse.
 * Gitmeyecekse nedeni (adım yazılmaz; yalnız gönderim ya da hata yazılır)
 */
export function autoSendMonth(today: string, s: PackageSettings): { month: string } | { skip: "day" | "off" | "norecipient" | "sent" } {
  const day = Number(today.slice(8, 10));
  if (!(PACKAGE_SEND_DAYS as readonly number[]).includes(day)) return { skip: "day" };
  if (!s.auto) return { skip: "off" };
  if (!s.recipients.length) return { skip: "norecipient" };
  const month = prevMonth(today.slice(0, 7));
  if (s.autoMonth === month) return { skip: "sent" };
  return { month };
}

// ---------------------------------------------------------------------------- Paketin verisi

export interface PackageInvoice {
  /** Belgenin tarihi */
  date: string;
  /** Hesaplarda sayıldığı gün (dönem kapanışı kararıyla belgenin tarihinden farklı olabilir) */
  accountDate: string;
  /** Kapalı döneme düştü, karar bekliyor: listelenir, toplama girmez */
  held?: boolean;
  supplier: string;
  taxNumber: string | null;
  invoiceNo: string | null;
  category: string;
  /** KDV hariç */
  amount: number;
  discount: number;
  vat: number;
  payable: number;
  unpaid: boolean;
  branch: string;
  source: string;
  /** Dönem kapanışı notu ("Kapalı döneme düştü, karar bekliyor", "Kasım'da sayılır") ya da boş */
  status: string | null;
}

export interface PackageExpense {
  date: string;
  accountDate: string;
  held?: boolean;
  category: string;
  description: string | null;
  amount: number;
  vat: number | null;
  payment: string | null;
  document: string | null;
  branch: string;
  status: string | null;
}

export interface PackageCashDay {
  date: string;
  branch: string;
  zNo: string | null;
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  cashOut: number;
  cashDiff: number;
  /** Yazarkasa (banka POS) Z'si: no, toplam, KDV toplamı (girilmediyse null) */
  okcZNo: string | null;
  okcTotal: number | null;
  okcVat: number | null;
}

export interface PackageVatLine {
  date: string;
  branch: string;
  zNo: string | null;
  /** KDV oranı (yüzde: 10, 20) */
  rate: number;
  /** KDV dahil satış */
  total: number;
  vat: number;
}

export interface PackageFixed {
  name: string;
  section: string;
  /** Kalemin tutarı ve dönemi (yıllık, aylık…) */
  amount: number;
  period: string;
  /** Ayın karşılığı */
  monthly: number;
  branch: string;
  note: string | null;
}

export interface PackageData {
  month: string;
  /** Dosyanın kapsamı: muhasebe şirketindir, bütün şubeler; elle indirmede şube seçiliyken şubenin adı */
  scope: string;
  /**
   * Şubenin paketi (şube ayrımı parça 6): vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026), dosyada KDV sütunu, KDV
   * özeti ve Z KDV dökümü yok; beyan için bütün şubelerin paketi. Verilmezse bütün şubelerin paketi
   */
  branchFile?: boolean;
  createdAt: Date;
  /** Dönem kapanışı: ay kapalıysa kim ve ne zaman */
  closed: { at: string; by: string } | null;
  invoices: PackageInvoice[];
  expenses: PackageExpense[];
  cash: PackageCashDay[];
  vat: PackageVatLine[];
  fixed: PackageFixed[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: readonly number[]) => r2(xs.reduce((a, b) => a + b, 0));

export interface PackageSummary {
  invoices: number;
  invoicePayable: number;
  invoiceVat: number;
  /** Kapalı döneme düşüp karar bekleyen (toplama girmez) */
  heldInvoices: number;
  expenses: number;
  expenseTotal: number;
  cashDays: number;
  zTotal: number;
  okcTotal: number;
  /** Oran oran yazarkasa KDV'si (oran artan) */
  vatByRate: { rate: number; total: number; vat: number }[];
  fixedMonthly: number;
}

/** Paketin rakam özeti: Özet sekmesi ve e-posta. Karar bekleyen kayıt toplama girmez */
export function packageSummary(d: PackageData): PackageSummary {
  const counted = d.invoices.filter((i) => !i.held && i.accountDate.slice(0, 7) === d.month);
  const expenses = d.expenses.filter((e) => !e.held && e.accountDate.slice(0, 7) === d.month);
  const rates = new Map<number, { total: number; vat: number }>();
  for (const v of d.vat) {
    const cur = rates.get(v.rate) ?? { total: 0, vat: 0 };
    rates.set(v.rate, { total: cur.total + v.total, vat: cur.vat + v.vat });
  }
  return {
    invoices: counted.length,
    invoicePayable: sum(counted.map((i) => i.payable)),
    invoiceVat: sum(counted.map((i) => i.vat)),
    heldInvoices: d.invoices.filter((i) => i.held).length,
    expenses: expenses.length,
    expenseTotal: sum(expenses.map((e) => e.amount)),
    cashDays: d.cash.length,
    zTotal: sum(d.cash.map((c) => c.zTotal)),
    okcTotal: sum(d.cash.map((c) => c.okcTotal ?? 0)),
    vatByRate: [...rates.entries()].sort((a, b) => a[0] - b[0]).map(([rate, x]) => ({ rate, total: r2(x.total), vat: r2(x.vat) })),
    fixedMonthly: sum(d.fixed.map((f) => f.monthly)),
  };
}

/** Dosyanın adı: laffogato-muhasebe-2026-10.xlsx */
/** Dosyanın adı; şubenin paketinde şube kimliğiyle biter ("laffogato-muhasebe-2026-10-marina.xlsx"; şube ayrımı parça 6) */
export const packageFileName = (month: string, branch: string | null = null) => `laffogato-muhasebe-${month}${branch ? `-${branch.replace(/[^a-z0-9-]/gi, "")}` : ""}.xlsx`;

// ---------------------------------------------------------------------------- Çalışma kitabı

const MONEY = '#,##0.00 "₺";[Red]-#,##0.00 "₺"';
const DATE = "dd.mm.yyyy";
const PCT_INT = '0"%"';
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_ARGB } };
const MUTED: Partial<ExcelJS.Font> = { color: { argb: "FF71717A" } };

type Col = { key: string; header: string; width?: number; fmt?: string };

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], title: string) {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width ?? 14, style: c.fmt ? { numFmt: c.fmt } : {} }));
  const t = ws.addRow([title]);
  t.font = { bold: true, size: 13, color: { argb: HEADER_ARGB } };
  ws.addRow([]);
  const h = ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.header])));
  h.height = 28;
  for (let c = 1; c <= cols.length; c++) {
    const cell = h.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true, horizontal: cols[c - 1].fmt ? "right" : "left" };
  }
  ws.pageSetup.printTitlesRow = "3:3";
  return ws;
}

/** Toplam satırı ve süzgeç; boş tabloda "Kayıt yok" satırı */
function finish(ws: ExcelJS.Worksheet, cols: Col[], rows: number, total: Record<string, number> | null, empty: string) {
  if (!rows) {
    const r = ws.addRow({ [cols[0].key]: empty });
    r.font = MUTED;
  } else {
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows, column: cols.length } };
    if (total) {
      const r = ws.addRow({ [cols[0].key]: "TOPLAM", ...total });
      for (let c = 1; c <= cols.length; c++) {
        const cell = r.getCell(c);
        cell.font = { bold: true };
        cell.fill = TOTAL_FILL;
      }
    }
  }
  for (let c = 1; c <= cols.length; c++) {
    const col = ws.getColumn(c);
    let need = 0;
    col.eachCell({ includeEmpty: false }, (cell, row) => {
      if (row > 1) need = Math.max(need, cellWidth(cell));
    });
    if (need + 2 > (col.width ?? 10)) col.width = Math.min(need + 2, 48);
  }
}

/**
 * Muhasebeci paketi: Özet, Faturalar, Harcamalar, Kasa raporları, Z KDV dökümü, Sabit giderler. Tarihler Excel tarihi,
 * tutarlar ₺ biçimli sayı; her tablonun başlığı donuk ve süzgeçli, sonunda TOPLAM. Şubenin paketinde (`branchFile`) KDV
 * yok: KDV sütunları, Özet'in KDV satırları ve Z KDV dökümü yalnız bütün şubelerin paketinde (vergi şubeye bölünmez)
 */
export function buildPackageWorkbook(d: PackageData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "L'Affogato Panel";
  wb.created = d.createdAt;
  const title = monthTitle(d.month);
  const s = packageSummary(d);
  // Şubenin paketi: KDV sütunları ve toplamları yok (vergi şubeye bölünmez; sahibin kararı 27 Kasım 2026)
  const noVat = d.branchFile === true;
  const vatFree = (cols: Col[], keys: readonly string[]) => (noVat ? cols.filter((c) => !keys.includes(c.key)) : cols);
  const withoutVat = (total: Record<string, number>, keys: readonly string[]) => (noVat ? Object.fromEntries(Object.entries(total).filter(([k]) => !keys.includes(k))) : total);

  // ---------------------------------------------------------------- Özet
  const ov = wb.addWorksheet("Özet", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ov.columns = [
    { key: "a", width: 34 },
    { key: "b", width: 22 },
    { key: "c", width: 60 },
  ];
  const h1 = ov.addRow([`L'Affogato · Muhasebe paketi · ${title}`]);
  h1.font = { bold: true, size: 16, color: { argb: HEADER_ARGB } };
  ov.addRow([`Oluşturulma: ${dateTimeTR(d.createdAt)} · Kapsam: ${d.scope}`]).font = MUTED;
  ov.addRow([d.closed ? `Dönem panelde kapalı (${d.closed.by}, ${dateTimeTR(d.closed.at)}): sonradan gelen kayıtlar bu rakamları değiştirmez.` : "Dönem panelde henüz kapatılmadı: sonradan girilen kayıtlar rakamları değiştirebilir."]).font = MUTED;
  ov.addRow([]);
  const line = (label: string, value: number | string, note = "", fmt?: string) => {
    const r = ov.addRow([label, value, note]);
    if (fmt) r.getCell(2).numFmt = fmt;
    r.getCell(3).font = MUTED;
    return r;
  };
  line("Faturalar (adet)", s.invoices, s.heldInvoices ? `${s.heldInvoices} fatura kapalı döneme düştü, karar bekliyor (toplama girmedi)` : "Faturalar sekmesi");
  line("Faturalar ödenecek toplamı", s.invoicePayable, "KDV dahil", MONEY);
  if (!noVat) line("Faturaların KDV'si", s.invoiceVat, "Paraşüt'ün KDV toplamı (elle girilende tutarlardan)", MONEY);
  line("Harcamalar (adet)", s.expenses, "Harcamalar sekmesi");
  line("Harcamalar toplamı", s.expenseTotal, "", MONEY);
  line("Kasa raporu olan gün", s.cashDays, "Kasa raporları sekmesi (şube şube)");
  line("ModPOS Z toplamı", s.zTotal, "", MONEY);
  line("Yazarkasa (banka POS) Z toplamı", s.okcTotal, "Girilen yazarkasa Z'lerinin toplamı", MONEY);
  if (!noVat) for (const v of s.vatByRate) line(`Yazarkasa KDV %${v.rate}`, v.vat, `Satış (KDV dahil) ${tl(v.total, 2)}`, MONEY);
  line("Sabit giderlerin aylık karşılığı", s.fixedMonthly, "Sabit giderler sekmesi", MONEY);
  ov.addRow([]);
  ov.addRow([
    noVat
      ? "Şubenin paketi: KDV sütunları, KDV toplamları ve Z KDV dökümü yok; vergi şubeye bölünmez. Beyan için bütün şubelerin paketini kullanın. Panelin kayıtlarıdır; resmi defter ve beyan muhasebecinindir."
      : "Panelin kayıtlarıdır; resmi defter ve beyan muhasebecinindir. Yazarkasa KDV dökümü kasa raporlarına girilen (ya da fotoğraftan okunan) Z'lerdendir.",
  ]).font = MUTED;

  // ---------------------------------------------------------------- Faturalar
  const invCols: Col[] = vatFree([
    { key: "date", header: "Belge tarihi", width: 12, fmt: DATE },
    { key: "supplier", header: "Tedarikçi", width: 30 },
    { key: "tax", header: "Vergi no", width: 13 },
    { key: "no", header: "Fatura no", width: 18 },
    { key: "category", header: "Kategori", width: 22 },
    { key: "amount", header: "KDV hariç", fmt: MONEY },
    { key: "discount", header: "İskonto", fmt: MONEY },
    { key: "vat", header: "KDV", fmt: MONEY },
    { key: "payable", header: "Ödenecek", fmt: MONEY },
    { key: "paid", header: "Ödeme", width: 10 },
    { key: "branch", header: "Şube", width: 16 },
    { key: "source", header: "Kaynak", width: 12 },
    { key: "status", header: "Dönem notu", width: 34 },
  ], ["vat"]);
  const inv = sheet(wb, "Faturalar", invCols, `${title} faturaları`);
  for (const i of d.invoices)
    inv.addRow({
      date: excelDate(i.date),
      supplier: i.supplier,
      tax: i.taxNumber ?? "",
      no: i.invoiceNo ?? "",
      category: i.category,
      amount: i.amount,
      discount: i.discount,
      vat: i.vat,
      payable: i.payable,
      paid: i.unpaid ? "Ödenmedi" : "Ödendi",
      branch: i.branch,
      source: i.source,
      status: i.status ?? "",
    });
  const countedInv = d.invoices.filter((i) => !i.held && i.accountDate.slice(0, 7) === d.month);
  finish(inv, invCols, d.invoices.length, withoutVat({ amount: sum(countedInv.map((i) => i.amount)), discount: sum(countedInv.map((i) => i.discount)), vat: s.invoiceVat, payable: s.invoicePayable }, ["vat"]), "Bu ay fatura yok");

  // ---------------------------------------------------------------- Harcamalar
  const expCols: Col[] = vatFree([
    { key: "date", header: "Tarih", width: 12, fmt: DATE },
    { key: "category", header: "Kategori", width: 24 },
    { key: "description", header: "Açıklama", width: 36 },
    { key: "amount", header: "Tutar", fmt: MONEY },
    { key: "vat", header: "KDV", fmt: MONEY },
    { key: "payment", header: "Ödeme", width: 10 },
    { key: "document", header: "Belge", width: 10 },
    { key: "branch", header: "Şube", width: 16 },
    { key: "status", header: "Dönem notu", width: 34 },
  ], ["vat"]);
  const exp = sheet(wb, "Harcamalar", expCols, `${title} harcamaları (fatura dışı giderler)`);
  for (const e of d.expenses)
    exp.addRow({
      date: excelDate(e.date),
      category: e.category,
      description: e.description ?? "",
      amount: e.amount,
      vat: e.vat ?? null,
      payment: e.payment ?? "",
      document: e.document ?? "",
      branch: e.branch,
      status: e.status ?? "",
    });
  finish(exp, expCols, d.expenses.length, { amount: s.expenseTotal }, "Bu ay harcama yok");

  // ---------------------------------------------------------------- Kasa raporları
  const cashCols: Col[] = vatFree([
    { key: "date", header: "Gün", width: 12, fmt: DATE },
    { key: "branch", header: "Şube", width: 14 },
    { key: "zNo", header: "ModPOS Z no", width: 10 },
    { key: "zTotal", header: "ModPOS Z toplamı", fmt: MONEY },
    { key: "cash", header: "Nakit", fmt: MONEY },
    { key: "card", header: "Kart", fmt: MONEY },
    { key: "mealCard", header: "Yemek kartı", fmt: MONEY },
    { key: "online", header: "Online", fmt: MONEY },
    { key: "other", header: "Diğer", fmt: MONEY },
    { key: "cashOut", header: "Kasadan çıkan", fmt: MONEY },
    { key: "cashDiff", header: "Kasa farkı", fmt: MONEY },
    { key: "okcZNo", header: "Yazarkasa Z no", width: 10 },
    { key: "okcTotal", header: "Yazarkasa Z toplamı", fmt: MONEY },
    { key: "okcVat", header: "Yazarkasa KDV", fmt: MONEY },
  ], ["okcVat"]);
  const cash = sheet(wb, "Kasa raporları", cashCols, `${title} kasa raporları (gün ve şube başına)`);
  for (const c of d.cash)
    cash.addRow({
      ...c,
      date: excelDate(c.date),
      zNo: c.zNo ?? "",
      okcZNo: c.okcZNo ?? "",
      okcTotal: c.okcTotal ?? null,
      okcVat: c.okcVat ?? null,
    });
  const cashSum = (k: keyof PackageCashDay) => sum(d.cash.map((c) => (typeof c[k] === "number" ? (c[k] as number) : 0)));
  finish(
    cash,
    cashCols,
    d.cash.length,
    withoutVat(Object.fromEntries((["zTotal", "cash", "card", "mealCard", "online", "other", "cashOut", "cashDiff", "okcTotal", "okcVat"] as const).map((k) => [k, cashSum(k)])), ["okcVat"]),
    "Bu ay kasa raporu yok",
  );

  // ---------------------------------------------------------------- Z KDV dökümü (yalnız bütün şubelerin paketinde)
  if (!noVat) {
    const vatCols: Col[] = [
      { key: "date", header: "Gün", width: 12, fmt: DATE },
      { key: "branch", header: "Şube", width: 14 },
      { key: "zNo", header: "Yazarkasa Z no", width: 12 },
      { key: "rate", header: "KDV oranı", width: 10, fmt: PCT_INT },
      { key: "total", header: "Satış (KDV dahil)", fmt: MONEY },
      { key: "vat", header: "KDV", fmt: MONEY },
    ];
    const vat = sheet(wb, "Z KDV dökümü", vatCols, `${title} yazarkasa (banka POS) Z raporlarının KDV dökümü`);
    for (const v of d.vat) vat.addRow({ ...v, date: excelDate(v.date), zNo: v.zNo ?? "" });
    finish(vat, vatCols, d.vat.length, { total: sum(d.vat.map((v) => v.total)), vat: sum(d.vat.map((v) => v.vat)) }, "Bu ay KDV dökümü girilmiş yazarkasa Z'si yok");
    if (d.vat.length) {
      vat.addRow([]);
      const head = vat.addRow({ date: "Oran oran toplam" });
      head.font = { bold: true };
      for (const r of s.vatByRate) vat.addRow({ date: `%${r.rate}`, total: r.total, vat: r.vat });
    }
  }

  // ---------------------------------------------------------------- Sabit giderler
  const fixCols: Col[] = [
    { key: "name", header: "Gider kalemi", width: 32 },
    { key: "section", header: "Bölüm", width: 22 },
    { key: "amount", header: "Tutar", fmt: MONEY },
    { key: "period", header: "Dönem", width: 12 },
    { key: "monthly", header: "Ayın karşılığı", fmt: MONEY },
    { key: "branch", header: "Şube", width: 16 },
    { key: "note", header: "Not", width: 40 },
  ];
  const fix = sheet(wb, "Sabit giderler", fixCols, `${title} sabit giderleri (panelin kayıtlı kalemleri)`);
  for (const f of d.fixed) fix.addRow({ ...f, note: f.note ?? "" });
  finish(fix, fixCols, d.fixed.length, { monthly: s.fixedMonthly }, "Bu ay sabit gider kalemi yok");

  for (const ws of wb.worksheets) {
    ws.headerFooter.oddHeader = `&L&BL'Affogato&B&C${ws.name}&R${title}`;
    ws.headerFooter.oddFooter = `&LOluşturulma: ${dateTimeTR(d.createdAt)}&RSayfa &P / &N`;
  }
  return wb;
}

/** E-postanın konusu: "Muhasebe paketi · Ekim 2026" */
export const packageSubject = (month: string) => `Muhasebe paketi · ${monthTitle(month)}`;

/** E-postanın özet satırları (HTML ve düz metin aynı satırları yazar) */
export function packageMailLines(d: Pick<PackageData, "month" | "closed">, s: PackageSummary): string[] {
  return [
    `${s.invoices} fatura · ödenecek ${tl(s.invoicePayable, 2)} (KDV ${tl(s.invoiceVat, 2)})`,
    ...(s.heldInvoices ? [`${s.heldInvoices} fatura kapalı döneme düştü, karar bekliyor; toplama girmedi`] : []),
    `${s.expenses} harcama · ${tl(s.expenseTotal, 2)}`,
    `${s.cashDays} günlük kasa raporu · ModPOS Z ${tl(s.zTotal, 2)} · yazarkasa Z ${tl(s.okcTotal, 2)}`,
    ...s.vatByRate.map((v) => `Yazarkasa KDV %${v.rate}: ${tl(v.vat, 2)} (satış ${tl(v.total, 2)})`),
    `Sabit giderlerin aylık karşılığı ${tl(s.fixedMonthly, 2)}`,
    d.closed ? `Dönem panelde ${dateTR(d.closed.at.slice(0, 10))} tarihinde kapatıldı.` : "Dönem panelde henüz kapatılmadı.",
  ];
}
