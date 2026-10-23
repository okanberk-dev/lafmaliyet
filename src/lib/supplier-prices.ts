/**
 * Hammaddenin tedarikçilere göre fiyatı (Hammaddeler › hammadde penceresi › "Tedarikçilere göre fiyat"): bağlı Paraşüt
 * ürünlerinin fatura kalemlerinden, tedarikçi tedarikçi birim fiyat (₺/kg, ₺/L, ₺/adet; KDV hariç, iskonto düşülmüş).
 * Tedarikçiler Tedarikçiler ekranındaki gibi gruplanır: yükleyici her faturanın grubunu loadSupplierLedger'dan verir,
 * burada ad eşleştirmesi yapılmaz. Saf modül; tests/tedarikci-fiyatlari.test.ts.
 */

import { num, tl2, tlUnit } from "./format";
import { addDays } from "./reminders";

/** "En ucuz" yalnız son bu kadar günde alınan tedarikçiler arasında (eski fiyat bugünün fiyatı sayılmaz) */
export const FRESH_DAYS = 90;
/** Özet satırının (en düşük–en yüksek, ortalama) penceresi */
export const WINDOW_DAYS = 365;

/** Okunur birim: gr → kg (×1000), ml → L (×1000), adet/dilim → kendisi */
export function bulkUnit(unit: string): { per: string; scale: number } {
  if (unit === "gr") return { per: "kg", scale: 1000 };
  if (unit === "ml") return { per: "L", scale: 1000 };
  return { per: unit, scale: 1 };
}

/** Birim fiyat okunur birimle: 0,04864 ₺/ml → "48,64 ₺/L"; 1 ₺'nin altındaki adet fiyatı kuruşun altına iner */
export function bulkPrice(unitPrice: number, unit: string): string {
  const b = bulkUnit(unit);
  const v = unitPrice * b.scale;
  return `${Math.abs(v) >= 1 ? tl2(v) : tlUnit(v)}/${b.per}`;
}

/** Hammaddeye bağlı ürünün bir fatura kalemi (kafe dışı faturalar yükleyicide çıkar) */
export interface PriceLine {
  invoiceId: number;
  date: string;
  invoiceNo: string | null;
  /** Tedarikçiler ekranındaki grup: anahtar, ad, adres parçası (/panel/tedarikciler/<slug>) */
  supplierKey: string;
  supplierName: string;
  supplierSlug: string;
  productName: string;
  quantity: number;
  unit: string | null;
  /** Bağlantının çarpanı: faturadaki 1 birim kaç hammadde birimi */
  factor: number;
  /** KDV hariç, iskontolar düşülmüş */
  netTotal: number;
}

export interface SupplierPoint {
  invoiceId: number;
  date: string;
  invoiceNo: string | null;
  /** ₺ / hammadde birimi (gr, ml, adet) */
  unitPrice: number;
  /** "12 Koli" (tek kalem) ya da "2 kalem" */
  qtyText: string;
}

export interface SupplierPriceRow {
  key: string;
  name: string;
  slug: string;
  /** Faturalar, en yeni önce (aynı faturanın kalemleri tek nokta) */
  points: SupplierPoint[];
  last: SupplierPoint;
  /** Son fiyatın bir önceki faturaya göre değişimi (0,04 = %4 artış); önceki fatura yoksa null */
  change: number | null;
  /** Pencere (12 ay) içindeki faturaların en düşük, en yüksek ve miktarla ağırlıklı ortalama birim fiyatı */
  min: number | null;
  max: number | null;
  avg: number | null;
  windowCount: number;
  /** Son alım son 90 günde */
  fresh: boolean;
  /** Yakın zamanda alınan en az iki tedarikçi arasında son fiyatı en düşük */
  cheapest: boolean;
  /** Son fiyatın en ucuzun son fiyatına göre farkı (0,12 = %12 pahalı); yalnız yakın zamanda alınanlarda */
  vsCheapest: number | null;
}

export interface SupplierPricesResult {
  rows: SupplierPriceRow[];
  /** Fiyatı sayılan farklı fatura sayısı */
  invoiceCount: number;
  /** Bedava gelen (%100 iskontolu) ve iade kalemleri: fiyata girmez, yalnız sayılır */
  freeLines: number;
  returnLines: number;
}

/** GET /api/hammaddeler/{id}/fiyatlar yanıtı */
export interface SupplierPricesResponse extends SupplierPricesResult {
  ingredient: {
    id: number;
    name: string;
    unit: string;
    per: string;
    scale: number;
    /** Reçetenin kullandığı birim fiyat (₺ / hammadde birimi); su ve buzda (su faturasından) null */
    current: number | null;
  };
  /** Hammaddeye bağlı Paraşüt ürünü sayısı ("Fiyatı güncelle" kapalı olanlar dahil) */
  links: number;
}

interface PointAcc {
  invoiceId: number;
  date: string;
  invoiceNo: string | null;
  net: number;
  base: number;
  lines: number;
  quantity: number;
  unit: string | null;
}

/**
 * Kalemlerden tedarikçi satırları. Bedava kalem (net 0) ve iade (eksi miktar ya da tutar) fiyata girmez, sayılır.
 * Aynı faturanın kalemleri tek nokta olur: birim fiyat Σnet ÷ Σ(miktar × çarpan), her kalem kendi çarpanıyla. Sıra:
 * son 90 günde alınanlar son fiyata göre ucuzdan pahalıya, sonra eskiler en yeni alım önce.
 */
export function supplierPriceRows(lines: PriceLine[], opts: { today: string; freshDays?: number; windowDays?: number }): SupplierPricesResult {
  const freshFrom = addDays(opts.today, -(opts.freshDays ?? FRESH_DAYS));
  const windowFrom = addDays(opts.today, -(opts.windowDays ?? WINDOW_DAYS));
  let freeLines = 0;
  let returnLines = 0;
  const groups = new Map<string, { key: string; name: string; slug: string; points: Map<number, PointAcc> }>();
  for (const l of lines) {
    if (l.quantity < 0 || l.netTotal < 0) {
      returnLines++;
      continue;
    }
    if (l.quantity > 0 && l.netTotal === 0) {
      freeLines++;
      continue;
    }
    if (!(l.quantity > 0) || !(l.netTotal > 0) || !(l.factor > 0)) continue;
    let g = groups.get(l.supplierKey);
    if (!g) {
      g = { key: l.supplierKey, name: l.supplierName, slug: l.supplierSlug, points: new Map() };
      groups.set(l.supplierKey, g);
    }
    const p = g.points.get(l.invoiceId) ?? { invoiceId: l.invoiceId, date: l.date, invoiceNo: l.invoiceNo, net: 0, base: 0, lines: 0, quantity: 0, unit: l.unit };
    p.net += l.netTotal;
    p.base += l.quantity * l.factor;
    p.lines++;
    p.quantity += l.quantity;
    g.points.set(l.invoiceId, p);
  }

  const invoices = new Set<number>();
  const rows: SupplierPriceRow[] = [];
  for (const g of groups.values()) {
    const accs = [...g.points.values()].sort((a, b) => b.date.localeCompare(a.date) || b.invoiceId - a.invoiceId);
    const points: SupplierPoint[] = accs.map((a) => {
      invoices.add(a.invoiceId);
      return {
        invoiceId: a.invoiceId,
        date: a.date,
        invoiceNo: a.invoiceNo,
        unitPrice: a.net / a.base,
        qtyText: a.lines === 1 ? `${num(a.quantity, 3)} ${a.unit ?? "birim"}` : `${a.lines} kalem`,
      };
    });
    const inWindow = accs.filter((a) => a.date >= windowFrom);
    const prices = inWindow.map((a) => a.net / a.base);
    const net = inWindow.reduce((t, a) => t + a.net, 0);
    const base = inWindow.reduce((t, a) => t + a.base, 0);
    rows.push({
      key: g.key,
      name: g.name,
      slug: g.slug,
      points,
      last: points[0],
      change: points.length > 1 ? points[0].unitPrice / points[1].unitPrice - 1 : null,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      avg: base > 0 ? net / base : null,
      windowCount: inWindow.length,
      fresh: points[0].date >= freshFrom,
      cheapest: false,
      vsCheapest: null,
    });
  }

  // "En ucuz" ancak yakın zamanda en az iki tedarikçiden alınmışsa anlamlı
  const fresh = rows.filter((r) => r.fresh);
  if (fresh.length >= 2) {
    const min = Math.min(...fresh.map((r) => r.last.unitPrice));
    for (const r of fresh) {
      r.cheapest = r.last.unitPrice === min;
      r.vsCheapest = r.last.unitPrice / min - 1;
    }
  }
  rows.sort((a, b) => {
    if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
    if (a.fresh) return a.last.unitPrice - b.last.unitPrice || a.name.localeCompare(b.name, "tr");
    return b.last.date.localeCompare(a.last.date) || a.name.localeCompare(b.name, "tr");
  });
  return { rows, invoiceCount: invoices.size, freeLines, returnLines };
}
