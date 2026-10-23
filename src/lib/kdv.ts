/**
 * Nakit planının KDV tahmini (docs/NAKIT-PLANI.md › KDV tahmini; plan docs/planlar/kdv.md): önceki ayın satışlarındaki
 * KDV − alış faturalarındaki KDV − önceki aylardan devreden KDV, ayın 28'inde ödenir. Eksi çıkarsa ödeme beklenmez,
 * fark sonraki aya devreder. Saf modül (Model yalnız tip); tests/kdv-tahmini.test.ts.
 *
 * - Kasa (ModPOS) satış KDV'si gelir-giderdeki kuralla: ciro − KDV hariç ciro (ürünler satış oranıyla, HİZMET satırları
 *   yani karaoke hizmet oranıyla; engine.ts pnlMonth). Süren ayın cirosu Genel bakış'taki ay sonu tahminiyle aya
 *   tamamlanır.
 * - laffogato.net: sitenin saklı KDV'si ve oranı bilinmeyenin panel oranıyla KDV'si (site-sales/calc.ts siteVat).
 * - Alış KDV'si (indirilecek KDV): faturanın KDV toplamı (`vat`, Paraşüt); yoksa (Excel'den gelenlerde 0) ödenecek −
 *   (tutar − iskonto). Tevkifatlı faturada KDV'nin tamamı indirilir: tedarikçiye ödenen kısmı "yurtiçi alımlar", tevkif
 *   edilen kısmı "sorumlu sıfatıyla ödenen KDV" olarak (Eylül 2026 beyannamesi: 11.875,70 + 1.800). Tevkif edilen kısım
 *   2 No.lu beyannameyle izleyen ayın 25'inde ayrıca ödenir, 1 No.lu ödenecek sıfır ya da devreden olsa da
 *   (`purchaseWithheld`, `vat2DueDate`). İadede eksi. Kafe dışı (Karaoke box, Alp Koç) sayılmaz.
 * - Her bileşen 100 ₺'ye yuvarlanır; ödenecek ve devreden yuvarlı bileşenlerden çıkar (ekrandaki çıkarma birebir tutar).
 */

import type { Model } from "./calc/engine";
import { daysInMonth, shiftMonth } from "./calc/engine";
import type { Invoice } from "./calc/types";
import { MONTH_NAMES, SEPARATE_CATEGORIES } from "./constants";
import { money, num, tl } from "./format";
import { monthGenitiveTR, todayTR } from "./reminders";
import { siteVat } from "./site-sales/calc";

export const VAT_DUE_DAY = 28;
/** 2 No.lu KDV (tevkifat) beyanı ve ödemesi izleyen ayın 25'inde (Eylül 2026 tahakkuk fişi: vade 25.10.2026) */
export const VAT2_DUE_DAY = 25;
/** Otomatik devreden zinciri en çok bu kadar ay geriden başlar */
export const VAT_CHAIN_MAX_MONTHS = 24;
export const VAT_DISCLAIMER = "Tahmin; kesin tutar muhasebecinizin beyannamesindedir.";

/** En yakın 100 ₺ (yarım yukarı, işaret korunur; −0 → 0) */
export function round100(x: number): number {
  const r = Math.sign(x) * Math.floor(Math.abs(x) / 100 + 0.5) * 100;
  return r === 0 ? 0 : r;
}

/** Dönemin ödeme günü: "2026-10" → "2026-11-28" (hafta sonu kaydırması yok; plan parayı en çok iki gün erken çıkarır) */
export function vatDueDate(period: string): string {
  return `${shiftMonth(period, 1)}-${VAT_DUE_DAY}`;
}

/** Dönemin 2 No.lu KDV (tevkifat) ödeme günü: "2026-09" → "2026-10-25" */
export function vat2DueDate(period: string): string {
  return `${shiftMonth(period, 1)}-${VAT2_DUE_DAY}`;
}

/**
 * Hatırlatıcı gününden dönem: önceki ay ("2026-11-28" → "2026-10"). Ayın 1–7'si iki ay öncedir: 28 Ekim 1 hafta
 * ertelenince 4 Kasım'da açılan tek seferlik kopya hâlâ Eylül'ün KDV'sidir.
 */
export function vatPeriodOf(due: string): string {
  return shiftMonth(due.slice(0, 7), Number(due.slice(8, 10)) <= 7 ? -2 : -1);
}

/** "Ekim KDV'si" */
export function vatPeriodTitle(period: string): string {
  return `${MONTH_NAMES[Number(period.slice(5, 7)) - 1]} KDV'si`;
}

/** Kasa cirosunun (KDV dahil) KDV'si: hizmet payı (karaoke, ciroyla sınırlı) hizmet oranıyla, kalanı satış oranıyla */
export function posVat(revenue: number, serviceRevenue: number, kdv: number, kdvHizmet: number): number {
  const s = Math.min(Math.max(revenue, 0), serviceRevenue);
  return ((revenue - s) * kdv) / (1 + kdv) + (s * kdvHizmet) / (1 + kdvHizmet);
}

type PurchaseVatInput = Pick<Invoice, "amount" | "discount" | "payable"> & { vat?: number | null };

/** En yüksek KDV oranı (%1, %10, %20) */
const MAX_VAT_RATE = 0.2;

/**
 * Kayıttaki KDV toplamı, tutarlar onu taşıyabiliyorsa (net tutarın en çok %20'si). Paraşüt bağı kopan (iptal) ve
 * tutarları sonra elle değiştirilen kayıtta eski `vat` kalır; ona güvenilse olmayan KDV indirilir ve fark tevkifat
 * sanılırdı.
 */
function storedVat(inv: PurchaseVatInput): number | null {
  const vat = inv.vat ?? 0;
  if (vat <= 0) return null;
  return vat <= (inv.amount - inv.discount) * MAX_VAT_RATE + 1 ? vat : null;
}

/**
 * Alış faturasının indirilecek KDV'si: KDV toplamı (`vat`, tevkifat düşülmemiş); yoksa ödenecek − (tutar − iskonto).
 * İadede (eksi) fark kullanılır: tevkifatın iadesi 2 No.lu beyannamede düzeltilir, burada sayılmaz.
 */
export function purchaseVat(inv: PurchaseVatInput): number {
  return storedVat(inv) ?? inv.payable - (inv.amount - inv.discount);
}

/** Faturadaki KDV tevkifatı: KDV toplamı − tedarikçiye ödenen KDV (ödenecek − net); tevkifatsız ve iadede 0 */
export function purchaseWithheld(inv: PurchaseVatInput): number {
  const vat = storedVat(inv);
  if (vat === null) return 0;
  const withheld = vat - (inv.payable - (inv.amount - inv.discount));
  return withheld > 0.01 ? withheld : 0;
}

export interface VatMonthInput {
  month: string;
  /** Kasa cirosu (KDV dahil) ve KDV'si; ciro girilmemiş ayda null */
  pos: { revenue: number; vat: number; openDays: number | null; serviceRevenue: number } | null;
  /** laffogato.net kaydı (çekilmemiş ayda null): KDV (TL), ay köşkte bitti mi, çekildiği gün (Türkiye) */
  online: { vat: number; closed: boolean; pulledOn: string } | null;
  /**
   * Kafe faturalarının indirilecek KDV'si (tevkifat dahil) ve sayısı; `withheld` içindeki tevkifat (2 No.lu
   * beyanname); kafe dışı faturalar yalnız sayılır
   */
  purchases: { vat: number; withheld: number; count: number; separateCount: number };
}

/**
 * Modelden aylık girdiler: [max(ilk satış ayı, bu ay − 24) … bu ay]. İlk satış ayı cirosu girilmiş ilk ay, yoksa
 * laffogato.net'in ilk kaydı; ondan önceki faturalar (açılış öncesi, eski Paraşüt kayıtları) sayılmaz.
 */
export function vatMonthInputs(model: Model, today: string): { months: VatMonthInput[]; firstSalesMonth: string | null; hasSite: boolean } {
  const st = model.settings;
  const cur = today.slice(0, 7);
  const hasSite = model.siteMonths.length > 0;
  const posMonths = [...model.monthInfo.values()].filter((m) => (m.posRevenue ?? 0) > 0).map((m) => m.month);
  const firstSalesMonth = posMonths.sort()[0] ?? model.siteMonths[0] ?? null;
  const months: VatMonthInput[] = [];
  if (!firstSalesMonth) return { months, firstSalesMonth, hasSite };
  const floor = shiftMonth(cur, -VAT_CHAIN_MAX_MONTHS);
  for (let m = firstSalesMonth > floor ? firstSalesMonth : floor; m <= cur; m = shiftMonth(m, 1)) {
    const info = model.monthInfo.get(m);
    const revenue = info?.posRevenue ?? 0;
    let pos: VatMonthInput["pos"] = null;
    if (revenue > 0) {
      const service = Math.min(revenue, model.monthSales(m).serviceRevenue);
      pos = { revenue, vat: posVat(revenue, service, st.kdv, st.kdvHizmet), openDays: info?.openDays ?? null, serviceRevenue: service };
    }
    const rec = model.siteSales(m);
    const pulled = rec ? Date.parse(rec.pulledAt) : NaN;
    const online = rec ? { vat: siteVat(rec, st.kdv, st.kdvHizmet), closed: rec.closed, pulledOn: Number.isFinite(pulled) ? todayTR(new Date(pulled)) : today } : null;
    const purchases = { vat: 0, withheld: 0, count: 0, separateCount: 0 };
    for (const inv of model.invoicesByMonth.get(m) ?? []) {
      if (SEPARATE_CATEGORIES.includes(inv.category)) {
        purchases.separateCount++;
        continue;
      }
      purchases.vat += purchaseVat(inv);
      purchases.withheld += purchaseWithheld(inv);
      purchases.count++;
    }
    months.push({ month: m, pos, online, purchases });
  }
  return { months, firstSalesMonth, hasSite };
}

export interface VatEstimate {
  period: string;
  /** noData: ne ciro ne yedek ay ne site kaydı; ödenecek hesaplanamaz, devreden olduğu gibi geçer */
  status: "ok" | "noData";
  /** Kasa ve online KDV'si, satışların ve alışların KDV'si: 100'e yuvarlı */
  pos: number;
  online: number;
  sales: number;
  purchases: number;
  /** Alışların içindeki tevkifat: 2 No.lu beyannameyle izleyen ayın 25'inde ödenir (100'e yuvarlı) */
  withheld: number;
  /** Önceki aylardan devreden, net (satış − alış − devreden), ödenecek ve sonraki aya devreden: 100'ün katı */
  carryIn: number;
  net: number;
  payable: number;
  carryOut: number;
  /** Ödemeler'deki KDV hatırlatıcısına yazılmış kesin tutar (0 dahil); yoksa null */
  known: number | null;
  /** Muhasebecinin beyannamesinde devreden var: o ayın ödemesi 0 */
  anchored: boolean;
  /** Kasa cirosu aya tamamlandı (süren ay ya da önceki ayın günlük ortalaması) */
  projected: boolean;
  basis: {
    /** Hesaba giren kasa cirosu (KDV dahil, tamamlanmış) */
    posRevenue: number | null;
    openDays: number | null;
    serviceRevenue: number;
    /** Ciro girilmemiş ayda günlük ortalaması kullanılan ay */
    posFrom: string | null;
    /** ok: site kaydı var; missing: site bağlı ama bu ay çekilmedi; none: site bağlı değil */
    online: "ok" | "missing" | "none";
    invoices: number;
    separate: number;
    inProgress: boolean;
  };
}

export interface VatInput {
  today: string;
  months: readonly VatMonthInput[];
  firstSalesMonth: string | null;
  /** Muhasebecinin son beyannamesindeki "sonraki döneme devreden KDV" (ay A, tutar C): zincir A+1'den başlar */
  anchor: { month: string; amount: number } | null;
  /** Ödemeler'deki KDV hatırlatıcısının o döneme yazılmış tutarı */
  known: ReadonlyMap<string, number>;
  /** Tahmini istenen dönemler */
  periods: readonly string[];
  /** Site bağlı (en az bir ay çekilmiş): çekilmemiş ay "missing" yazılır */
  hasSite?: boolean;
}

/**
 * Dönemlerin tahmini. Devreden zinciri ilk satış ayından (ya da muhasebeci kaydının ertesi ayından) dönemlere kadar ay
 * ay yürür: verisiz ay zinciri bozmaz, Ödemeler'deki tutarı > 0 olan ay zinciri sıfırlar.
 */
export function vatEstimates(input: VatInput): Map<string, VatEstimate> {
  const out = new Map<string, VatEstimate>();
  const periods = [...new Set(input.periods)].sort();
  if (!periods.length) return out;
  const { anchor, firstSalesMonth, known, today } = input;
  const byMonth = new Map(input.months.map((m) => [m.month, m]));
  const sorted = [...input.months].sort((a, b) => a.month.localeCompare(b.month));
  const cur = today.slice(0, 7);
  const day = Number(today.slice(8, 10));

  const month = (m: string, carryIn: number): VatEstimate => {
    const inp = byMonth.get(m);
    const dim = daysInMonth(m);
    let posRaw: number | null = null;
    let posRevenue: number | null = null;
    let posFrom: string | null = null;
    let projected = false;
    if (inp?.pos) {
      const od = inp.pos.openDays ?? 0;
      // Süren ay ay sonuna: açık gün varsa ÷ açık gün, yoksa ÷ geçen gün (Genel bakış'taki ay sonu tahmini gibi)
      const f = m === cur ? (od > 0 && od < dim ? dim / od : od > 0 ? 1 : dim / Math.max(1, day - 1)) : 1;
      posRaw = inp.pos.vat * f;
      posRevenue = inp.pos.revenue * f;
      projected = f !== 1;
    } else if (firstSalesMonth !== null && m >= firstSalesMonth) {
      // Ciro girilmemiş ay: önceki, cirosu ve açık günü olan son ayın günlük ortalamasıyla
      const fb = sorted.filter((x) => x.month < m && x.pos && (x.pos.openDays ?? 0) > 0).at(-1);
      if (fb?.pos) {
        posRaw = (fb.pos.vat / fb.pos.openDays!) * dim;
        posRevenue = (fb.pos.revenue / fb.pos.openDays!) * dim;
        posFrom = fb.month;
        projected = true;
      }
    }
    let onlineRaw: number | null = null;
    if (inp?.online) {
      const o = inp.online;
      // Süren ayın açık kaydı çekildiği günün dününe kadardır
      const f = m === cur && !o.closed && o.pulledOn.slice(0, 7) === m ? dim / Math.max(1, Number(o.pulledOn.slice(8, 10)) - 1) : 1;
      onlineRaw = o.vat * f;
    }
    const k = known.get(m);
    const basis: VatEstimate["basis"] = {
      posRevenue,
      openDays: inp?.pos ? inp.pos.openDays : null,
      serviceRevenue: inp?.pos?.serviceRevenue ?? 0,
      posFrom,
      online: inp?.online ? "ok" : input.hasSite ? "missing" : "none",
      invoices: inp?.purchases.count ?? 0,
      separate: inp?.purchases.separateCount ?? 0,
      inProgress: m === cur,
    };
    const purchases = round100(inp?.purchases.vat ?? 0);
    const withheld = round100(inp?.purchases.withheld ?? 0);
    // Açılıştan önceki ayda satış 0'dır (alışları devredene girer); sonrasında veri yoksa hesaplanamaz
    if (posRaw === null && onlineRaw === null && !(firstSalesMonth !== null && m < firstSalesMonth)) {
      return {
        period: m,
        status: "noData",
        pos: 0,
        online: 0,
        sales: 0,
        purchases,
        withheld,
        carryIn,
        net: 0,
        payable: k ?? 0,
        carryOut: k !== undefined && k > 0 ? 0 : carryIn,
        known: k ?? null,
        anchored: false,
        projected: false,
        basis,
      };
    }
    const pos = round100(posRaw ?? 0);
    const online = round100(onlineRaw ?? 0);
    const sales = pos + online;
    const net = sales - purchases - carryIn;
    const anchored = anchor?.month === m && anchor.amount > 0 && k === undefined;
    return {
      period: m,
      status: "ok",
      pos,
      online,
      sales,
      purchases,
      withheld,
      carryIn,
      net,
      payable: k ?? (anchored ? 0 : Math.max(0, net)),
      carryOut: k !== undefined && k > 0 ? 0 : Math.max(0, -net),
      known: k ?? null,
      anchored,
      projected,
      basis,
    };
  };

  const start = anchor ? shiftMonth(anchor.month, 1) : firstSalesMonth;
  if (!start) {
    for (const p of periods) out.set(p, month(p, 0));
    return out;
  }
  // Zincirden önceki dönem (yalnız muhasebeci kaydıyla olur): devredensiz
  for (const p of periods) if (p < start) out.set(p, month(p, 0));
  let carry = anchor ? round100(anchor.amount) : 0;
  const last = periods.at(-1)!;
  for (let m = start; m <= last; m = shiftMonth(m, 1)) {
    const e = month(m, carry);
    carry = e.status === "ok" ? e.carryOut : e.known !== null && e.known > 0 ? 0 : carry;
    if (periods.includes(m)) out.set(m, e);
  }
  return out;
}

const monthName = (period: string) => MONTH_NAMES[Number(period.slice(5, 7)) - 1];

/** Satır tutarının hesabı: "Satışlar ≈ 51.800 ₺ − alışlar ≈ 9.700 ₺ (− devreden ≈ 5.000 ₺)" */
function arithmetic(e: VatEstimate): string {
  return `Satışlar ≈ ${tl(e.sales)} − alışlar ≈ ${tl(e.purchases)}${e.carryIn > 0 ? ` − devreden ≈ ${tl(e.carryIn)}` : ""}`;
}

/** KDV kartındaki satırın alt yazısı */
export function vatSubText(e: VatEstimate, anchorAmount: number | null): string {
  if (e.known !== null) return e.status === "ok" ? `Ödemeler'deki tutar · tahmin ≈ ${tl(Math.max(0, e.net))}` : "Ödemeler'deki tutar";
  if (e.anchored && anchorAmount) return `Beyannamede devreden ${money(anchorAmount)}`;
  if (e.status === "noData") return "Bu ayın satış verisi yok";
  if (e.payable > 0) return arithmetic(e);
  const diff = e.sales - e.purchases;
  const next = e.carryOut > 0 ? ` · ≈ ${tl(e.carryOut)} sonraki aya geçer` : "";
  if (diff > 0) return `Devreden KDV karşılıyor${next}`;
  if (diff < 0) return `Alışların KDV'si fazla${next}`;
  return `Satış ve alış KDV'si denk${next}`;
}

/** Süren ayın ikinci alt yazısı: "Ekim bitmedi: 16 günün satışıyla tahmin"; biten ayda null */
export function vatProgressText(e: VatEstimate): string | null {
  if (!e.basis.inProgress || e.status !== "ok") return null;
  const m = monthName(e.period);
  if (e.basis.posFrom) return `${m} bitmedi: ${monthGenitiveTR(e.basis.posFrom)} günlük ortalamasıyla tahmin`;
  if (!e.projected) return null;
  return e.basis.openDays ? `${m} bitmedi: ${num(e.basis.openDays)} günün satışıyla tahmin` : `${m} bitmedi: ay sonuna tamamlandı`;
}

/** Haftalar listesindeki "KDV-2 (Eylül)" satırının açıklaması (ⓘ) */
export function vat2LineDetail(period: string): string {
  return `${monthName(period)} faturalarındaki KDV tevkifatı: 2 No.lu beyannameyle ayın ${VAT2_DUE_DAY}'inde ödenir, 1 No.lu beyannamede indirilir. ${VAT_DISCLAIMER}`;
}

/** Haftalar listesindeki "KDV (Ekim)" satırının açıklaması (ⓘ) */
export function vatLineDetail(e: VatEstimate): string {
  const m = monthName(e.period);
  const from = e.basis.posFrom ? ` ${m} cirosu yok: ${monthGenitiveTR(e.basis.posFrom)} günlük ortalamasıyla.` : e.basis.inProgress && e.projected ? ` ${m} bitmedi, ay sonuna tamamlandı.` : "";
  return `${arithmetic(e)}.${from} ${VAT_DISCLAIMER}`;
}

/** "Nasıl hesaplandı" kartındaki KDV satırı; oranlar Ayarlar'dan */
export function vatNote(mode: "default" | "reminder" | "excluded", ok: boolean, rates: { kdv: number; kdvHizmet: number }, hasSite: boolean): string {
  if (mode === "excluded") return "KDV tahmini plana katılmıyor (Tahmine katılanlar'dan açın).";
  if (!ok) return "Satış verisi olmadığı için KDV tahmin edilemedi.";
  const parts = [`kafe %${num(rates.kdv * 100, 1)}`, rates.kdvHizmet !== rates.kdv ? `karaoke %${num(rates.kdvHizmet * 100, 1)}` : null, hasSite ? "laffogato.net" : null].filter(Boolean).join(", ");
  return mode === "reminder"
    ? `Önceki ayın satış KDV'si (${parts}) eksi alış faturalarının KDV'si, KDV hatırlatıcısının gününde; hatırlatıcıya tutar yazarsanız o geçerli. ${VAT_DISCLAIMER}`
    : `Önceki ayın satış KDV'si (${parts}) eksi alış faturalarının KDV'si, ayın 28'inde; eksi çıkarsa ödeme beklenmez, fark sonraki aya devreder. ${VAT_DISCLAIMER}`;
}
