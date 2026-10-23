/**
 * Teslim kontrolü (docs/MAL-SIPARISI.md › Teslim kontrolü): tedarikçinin Paraşüt faturası açık mal siparişiyle
 * eşleşir ve kalem kalem karşılaştırılır (ürün → hammadde bağlantısı ve çarpanıyla, malzemenin kendi biriminde).
 * Siparişin ekrandaki durumu, zil satırları ve Bugün'ün olguları da buradan. Saf modül; tests/teslim-kontrolu.test.ts.
 */

import type { Unit } from "../calc/types";
import { dateTR, num } from "../format";
import { addDays, daysBetween } from "../reminders";
import { dayName, qtyLabel } from "./message";
import type { CheckRow, CheckStatus, DeliveryCheck, OrderLite, ReorderLine } from "./types";

/** Fatura sipariş gününden en çok bu kadar gün sonra kesilmiş olabilir */
export const MATCH_DAYS = 10;
/** Kalemsiz fatura (kâğıt, elle girilen, e-faturası okunmamış) bu kadar gün sonra eşleşir */
export const LINELESS_WAIT_DAYS = 3;
/** Miktar ±%2 içinde "tamam" */
export const QTY_TOL = 0.02;
/** Fiyat ±%3 dışında "fiyat farkı" */
export const PRICE_TOL = 0.03;
/** Faturası bu kadar gün gelmeyen açık sipariş kendiliğinden kapanır */
export const AUTO_CLOSE_DAYS = 45;
/** Beklenen günden bu kadar gün sonra hâlâ gelmediyse zil sorar */
export const LATE_GRACE_DAYS = 1;
/** Eşitleme yalnız bu kadar günlük açık siparişlere bakar */
export const OPEN_ORDER_DAYS = 60;

// ---------------------------------------------------------------- Faturanın seçimi

export interface InvoiceCandidate {
  id: number;
  date: string;
  /** Tedarikçinin grubu (Tedarikçiler'deki gibi: ad, diğer adlar, vergi no) */
  supplierId: string;
  invoiceNo: string | null;
  payable: number;
  /** Kalemleri okundu */
  hasLines: boolean;
  /** Kalemlerinin bağlı olduğu hammaddeler */
  ingredientIds: ReadonlySet<number>;
}

const overlapOf = (a: ReadonlySet<number>, b: ReadonlySet<number>) => [...a].filter((x) => b.has(x)).length;

/**
 * Fatura bu siparişe aday mı: aynı tedarikçi; tarihi gönderim günü ile 10 gün sonrası arasında; kalemleri varsa en az bir
 * sipariş kalemi faturada (sıfır örtüşen fatura başka bir teslimattır), kalemsizse en az 3 günlük.
 */
export function isCandidate(order: { sentDay: string; supplierId: string; ingredientIds: ReadonlySet<number> }, c: InvoiceCandidate, today: string): boolean {
  if (c.supplierId !== order.supplierId) return false;
  if (c.date < order.sentDay || c.date > addDays(order.sentDay, MATCH_DAYS)) return false;
  return c.hasLines ? overlapOf(order.ingredientIds, c.ingredientIds) > 0 : daysBetween(c.date, today) >= LINELESS_WAIT_DAYS;
}

/**
 * Siparişin faturası: adaylar arasında sipariş kalemleriyle en çok örtüşen; eşitlikte tarihi beklenen güne en yakın,
 * sonra en küçük kimlik. Başka bir siparişe bağlı fatura (`taken`) seçilmez. Yoksa null.
 */
export function pickInvoice(
  order: { sentDay: string; expectedOn: string; supplierId: string; ingredientIds: ReadonlySet<number> },
  candidates: readonly InvoiceCandidate[],
  taken: ReadonlySet<number>,
  today: string,
): InvoiceCandidate | null {
  const ok = candidates.filter((c) => !taken.has(c.id) && isCandidate(order, c, today));
  ok.sort(
    (a, b) =>
      overlapOf(order.ingredientIds, b.ingredientIds) - overlapOf(order.ingredientIds, a.ingredientIds) ||
      Math.abs(daysBetween(order.expectedOn, a.date)) - Math.abs(daysBetween(order.expectedOn, b.date)) ||
      a.id - b.id,
  );
  return ok[0] ?? null;
}

// ---------------------------------------------------------------- Karşılaştırma

export interface InvoiceLineLite {
  productKey: string;
  productName: string;
  quantity: number;
  unit: string | null;
  /** KDV hariç, iskonto düşülmüş */
  netTotal: number;
}

export interface LinkLite {
  ingredientId: number;
  factor: number;
  /** Hammaddenin adı ve birimi */
  name: string;
  baseUnit: Unit;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Gelen miktar siparişin yaklaşık tam katı (2–1000) ya da tam bölümü (1/2–1/1000), ±%5: koli ↔ adet çarpanı yanlış
 * olabilir. Değilse null (döner: 12 ya da 1/12).
 */
export function ratioHint(ordered: number, delivered: number): number | null {
  if (!(ordered > 0) || !(delivered > 0)) return null;
  const r = delivered / ordered;
  const k = r >= 1 ? Math.round(r) : Math.round(1 / r);
  if (k < 2 || k > 1000) return null;
  const target = r >= 1 ? k : 1 / k;
  return Math.abs(r - target) / target <= 0.05 ? round(target) : null;
}

/** Toplu fatura gibi: en az iki sipariş satırı ve onların en az %60'ı siparişin en az 1,8 katı */
export function looksConsolidated(rows: readonly CheckRow[]): boolean {
  const ordered = rows.filter((r) => r.ordered !== null && r.ordered > 0);
  if (ordered.length < 2) return false;
  const big = ordered.filter((r) => (r.delivered ?? 0) >= r.ordered! * 1.8).length;
  return big / ordered.length >= 0.6;
}

/**
 * Siparişi faturayla karşılaştırır (D8). Fatura kalemleri bağlı hammaddeye toplanır (miktar × çarpan; iade eksi gelir,
 * düşer); fiyat yalnız miktarı ve tutarı artı kalemlerden (bedava gelen miktara sayılır, fiyata girmez). Sipariş satırı:
 * hiç gelmediyse "gelmedi", %98'in altı "eksik", %102'nin üstü "fazla", yoksa "tamam"; fiyat beklenenden ±%3 farklıysa
 * fiyat farkı (beklenen tahminse uyarı yok). Bağlı ama sipariş edilmemiş hammadde "siparişte yoktu"; hiçbir hammaddeye
 * bağlı olmayan ürün (nakliye gibi) "bağlı değil" (kapanmayı engellemez).
 */
export function deliveryCheck(
  order: { lines: readonly ReorderLine[] },
  invoice: { id: number; invoiceNo: string | null; date: string; payable: number; lines: readonly InvoiceLineLite[] },
  links: ReadonlyMap<string, LinkLite>,
  now: Date,
): DeliveryCheck {
  const acc = new Map<number, { base: number; net: number; pricedBase: number; names: Set<string>; link: LinkLite }>();
  const unlinked = new Map<string, number>();
  for (const l of invoice.lines) {
    const link = links.get(l.productKey);
    if (!link) {
      if (l.quantity > 0) unlinked.set(l.productName, (unlinked.get(l.productName) ?? 0) + l.quantity);
      continue;
    }
    const a = acc.get(link.ingredientId) ?? { base: 0, net: 0, pricedBase: 0, names: new Set<string>(), link };
    a.base += l.quantity * link.factor;
    if (l.quantity > 0 && l.netTotal > 0) {
      a.net += l.netTotal;
      a.pricedBase += l.quantity * link.factor;
    }
    a.names.add(l.productName);
    acc.set(link.ingredientId, a);
  }

  const rows: CheckRow[] = [];
  const ordered = new Set<number>();
  for (const line of order.lines) {
    ordered.add(line.ingredientId);
    const a = acc.get(line.ingredientId);
    const want = line.qty * line.unitSize;
    const got = Math.max(0, a?.base ?? 0);
    const ratio = want > 0 ? got / want : 0;
    const status: CheckStatus = got <= 0 ? "gelmedi" : ratio < 1 - QTY_TOL ? "eksik" : ratio > 1 + QTY_TOL ? "fazla" : "tamam";
    const unitPrice = a && a.pricedBase > 0 ? a.net / a.pricedBase : null;
    const expected = line.expectedUnitPrice !== null && line.expectedUnitPrice > 0 ? line.expectedUnitPrice : null;
    const priceDiff = unitPrice !== null && expected !== null ? unitPrice / expected - 1 : null;
    rows.push({
      ingredientId: line.ingredientId,
      name: line.name,
      productNames: a ? [...a.names] : [],
      ordered: want,
      delivered: got,
      unit: line.unit,
      unitSize: line.unitSize,
      baseUnit: line.baseUnit,
      countUnit: line.countUnit ?? null,
      status,
      unitPrice,
      expectedUnitPrice: expected,
      priceDiff,
      priceFlag: priceDiff !== null && !line.priceEstimated && Math.abs(priceDiff) > PRICE_TOL,
      ratioHint: status === "fazla" || status === "eksik" ? ratioHint(want, got) : null,
    });
  }
  for (const [id, a] of acc) {
    if (ordered.has(id) || !(a.base > 0)) continue;
    rows.push({
      ingredientId: id,
      name: a.link.name,
      productNames: [...a.names],
      ordered: null,
      delivered: a.base,
      unit: a.link.baseUnit,
      unitSize: 1,
      baseUnit: a.link.baseUnit,
      countUnit: null,
      status: "siparis-disi",
      unitPrice: a.pricedBase > 0 ? a.net / a.pricedBase : null,
      expectedUnitPrice: null,
      priceDiff: null,
      priceFlag: false,
      ratioHint: null,
    });
  }
  for (const [name, quantity] of unlinked) {
    rows.push({
      ingredientId: null,
      name,
      productNames: [name],
      ordered: null,
      delivered: quantity,
      unit: "",
      unitSize: 1,
      baseUnit: null,
      countUnit: null,
      status: "bagli-degil",
      unitPrice: null,
      expectedUnitPrice: null,
      priceDiff: null,
      priceFlag: false,
      ratioHint: null,
    });
  }
  const count = (s: CheckStatus) => rows.filter((r) => r.status === s).length;
  const counts = {
    eksik: count("eksik"),
    gelmedi: count("gelmedi"),
    fazla: count("fazla"),
    fiyat: rows.filter((r) => r.priceFlag).length,
    disi: count("siparis-disi"),
    bagliDegil: count("bagli-degil"),
  };
  const linesRead = invoice.lines.length > 0;
  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    invoiceDate: invoice.date,
    payable: invoice.payable,
    linesRead,
    rows,
    counts,
    ok: linesRead && counts.eksik + counts.gelmedi + counts.fazla + counts.fiyat + counts.disi === 0,
    consolidated: looksConsolidated(rows),
    at: now.toISOString(),
  };
}

/** Kalemler okundu ve her şey tuttu: sipariş kendiliğinden kapanır ("Faturayla tuttu") */
export function shouldAutoClose(check: DeliveryCheck): boolean {
  return check.linesRead && check.ok;
}

/** Anahtarları sıralı JSON: jsonb anahtar sırasını değiştirir, veritabanından okunan aynı değer aynı metni versin */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** İki karşılaştırma aynı mı (anı hariç): değişmeyen karşılaştırma yeniden yazılmaz, kapanmayı yeniden tetiklemez */
export function sameCheck(a: DeliveryCheck | null, b: DeliveryCheck | null): boolean {
  if (!a || !b) return a === b;
  return canonical({ ...a, at: null }) === canonical({ ...b, at: null });
}

/** "1 eksik, 1 fiyat farkı", "Faturayla tuttu", "kalemler okunmadı" */
export function checkSummary(check: DeliveryCheck): string {
  if (!check.linesRead) return "kalemler okunmadı";
  if (check.ok) return "Faturayla tuttu";
  const c = check.counts;
  const parts = [
    c.gelmedi ? `${num(c.gelmedi)} gelmedi` : null,
    c.eksik ? `${num(c.eksik)} eksik` : null,
    c.fazla ? `${num(c.fazla)} fazla` : null,
    c.fiyat ? `${num(c.fiyat)} fiyat farkı` : null,
    c.disi ? `${num(c.disi)} kalem siparişte yoktu` : null,
  ].filter(Boolean);
  return parts.join(", ") || "fark var";
}

/** Satırın durumu: "Tamam", "1 koli eksik", "Gelmedi", "2 koli fazla", "Siparişte yoktu", "Hammaddeye bağlı değil" */
export function rowText(row: CheckRow): string {
  switch (row.status) {
    case "tamam":
      return "Tamam";
    case "gelmedi":
      return "Gelmedi";
    case "eksik":
    case "fazla": {
      const diff = Math.abs((row.ordered ?? 0) - (row.delivered ?? 0)) / (row.unitSize > 0 ? row.unitSize : 1);
      return `${qtyLabel(diff, row.unit)} ${row.status}`;
    }
    case "siparis-disi":
      return "Siparişte yoktu";
    case "bagli-degil":
      return "Hammaddeye bağlı değil";
  }
}

/** Fiyat notu: "Fiyat +%6" (yalnız işaretli satırda); yön ekranda renkle */
export function priceNote(row: CheckRow): string | null {
  if (!row.priceFlag || row.priceDiff === null) return null;
  const pctText = `%${num(Math.abs(row.priceDiff) * 100, 0)}`;
  return `Fiyat ${row.priceDiff > 0 ? "+" : "−"}${pctText}`;
}

// ---------------------------------------------------------------- Siparişin durumu

export type OrderStateKey = "yolda" | "gecikti" | "geldi" | "kalem-bekleniyor" | "fark" | "kapandi" | "iptal";
export type OrderTone = "blue" | "amber" | "red" | "green" | "gray";

/** Kalemin eksik / gelmedi olduğu ya da fiyatın arttığı fark: kırmızı */
const badCheck = (c: DeliveryCheck) => c.counts.eksik + c.counts.gelmedi > 0 || c.rows.some((r) => r.priceFlag && (r.priceDiff ?? 0) > 0);

/** Siparişin ekrandaki durumu (bugün: Türkiye takvim günü) */
export function orderState(o: Pick<OrderLite, "status" | "check" | "receivedAt" | "invoiceId" | "expectedOn" | "closeNote">, today: string): { key: OrderStateKey; label: string; tone: OrderTone } {
  if (o.status === "cancelled") return { key: "iptal", label: "İptal", tone: "gray" };
  if (o.status === "closed") return { key: "kapandi", label: o.closeNote ? `Kapandı · ${o.closeNote}` : "Kapandı", tone: "green" };
  if (o.check) {
    if (!o.check.linesRead) return { key: "kalem-bekleniyor", label: "Fatura geldi · kalemler okunmadı", tone: "gray" };
    return { key: "fark", label: `Fatura geldi · ${checkSummary(o.check)}`, tone: o.check.ok ? "green" : badCheck(o.check) ? "red" : "amber" };
  }
  if (o.invoiceId !== null) return { key: "kalem-bekleniyor", label: "Fatura bağlandı · karşılaştırılmadı", tone: "gray" };
  if (o.receivedAt) return { key: "geldi", label: "Geldi · fatura bekleniyor", tone: "blue" };
  if (today > o.expectedOn) return { key: "gecikti", label: `Gecikti · ${dateTR(o.expectedOn)} bekleniyordu`, tone: "amber" };
  return { key: "yolda", label: `Yolda · ${today === o.expectedOn ? "bugün" : dayName(o.expectedOn)} bekleniyor`, tone: "blue" };
}

/** Faturası 45 günde gelmeyen açık sipariş kendiliğinden kapanır ("45 günde fatura gelmedi") */
export function needsAutoExpire(o: Pick<OrderLite, "status" | "invoiceId" | "sentDay">, today: string): boolean {
  return o.status === "open" && o.invoiceId === null && daysBetween(o.sentDay, today) > AUTO_CLOSE_DAYS;
}

/** Fark var: açık, faturası okundu ve tutmadı */
const hasIssues = (o: OrderLite) => o.status === "open" && o.check !== null && o.check.linesRead && !o.check.ok;
/** Gelmedi mi: açık, gelmedi işaretlenmedi, faturası yok, beklenen günden 1 günden fazla geçti */
export const isLate = (o: Pick<OrderLite, "status" | "receivedAt" | "invoiceId" | "expectedOn">, today: string) =>
  o.status === "open" && !o.receivedAt && o.invoiceId === null && daysBetween(o.expectedOn, today) > LATE_GRACE_DAYS;

/** Zildeki satırlar (yönetici, Faturalar grubu), en çok 5: önce teslim farkları (en yeni fatura önce), sonra gelmeyenler */
export function deliveryNotifications(
  orders: readonly OrderLite[],
  today: string,
): { id: string; kind: "warning" | "info"; title: string; body: string; timeLabel: string; unread: true; href: string; group: "fatura" }[] {
  const href = (id: number) => `/panel/mal-siparisi/gonderilen#siparis-${id}`;
  const issues = orders
    .filter(hasIssues)
    .sort((a, b) => b.check!.invoiceDate.localeCompare(a.check!.invoiceDate) || b.id - a.id)
    .map((o) => {
      const c = o.check!.counts;
      // Karşılaştırma değişince (yeni kalem okundu, bağlantı düzeldi) yeniden okunmamış olur
      const key = `e${c.eksik}-g${c.gelmedi}-f${c.fazla}-p${c.fiyat}-d${c.disi}`;
      return {
        id: `teslim-${o.id}-${key}`,
        kind: "warning" as const,
        title: `Teslim kontrolü: ${o.supplier}`,
        body: `${dateTR(o.sentDay)} siparişi · ${checkSummary(o.check!)} · fatura ${dateTR(o.check!.invoiceDate)}`,
        timeLabel: dateTR(o.check!.invoiceDate),
        unread: true as const,
        href: href(o.id),
        group: "fatura" as const,
      };
    });
  const late = orders
    .filter((o) => isLate(o, today))
    .sort((a, b) => a.expectedOn.localeCompare(b.expectedOn) || a.id - b.id)
    .map((o) => ({
      id: `mal-siparisi-gelmedi-${o.id}`,
      kind: "info" as const,
      title: `Mal siparişi gelmedi mi: ${o.supplier}`,
      body: `${dateTR(o.sentDay)} gönderildi, ${dateTR(o.expectedOn)} bekleniyordu. Geldiyse işaretleyin.`,
      timeLabel: dateTR(o.expectedOn),
      unread: true as const,
      href: href(o.id),
      group: "fatura" as const,
    }));
  return [...issues, ...late].slice(0, 5);
}

/** Bugün'ün olguları (yönetici): teslim farkı olan siparişler ve gelmeyenlerin sayısı */
export function deliveryDayFacts(orders: readonly OrderLite[], today: string): { issues: { supplier: string; summary: string }[]; late: number } {
  return {
    issues: orders
      .filter(hasIssues)
      .sort((a, b) => b.check!.invoiceDate.localeCompare(a.check!.invoiceDate) || b.id - a.id)
      .map((o) => ({ supplier: o.supplier, summary: checkSummary(o.check!) })),
    late: orders.filter((o) => isLate(o, today)).length,
  };
}
