/**
 * Fatura kalemlerinin ekrandaki hâli (fatura penceresi "Kalemler"): /api/faturalar/{id}/kalemler yanıtı ve
 * hesaplar. Saf modül; tests/invoice-lines.test.ts.
 */

export interface InvoiceLineView {
  id: number;
  productKey: string;
  productName: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  discount: number;
  /** Yüzde (ör. 10) */
  vatRate: number;
  /** KDV hariç, iskontolar düşülmüş */
  netTotal: number;
  ingredient: { id: number; name: string; unit: string; factor: number } | null;
}

export interface InvoiceLinesResponse {
  lines: InvoiceLineView[];
  /** Kalemler nereden: e-fatura belgesi ya da Paraşüt gider faturası */
  source: "ubl" | "parasut" | null;
  /** E-faturaya bağlı ama belgesi henüz okunmadı */
  pending: boolean;
}

/** Faturadaki birimin net fiyatı (iskonto sonrası, KDV hariç); bedava kalemde 0 */
export function netUnitPrice(l: Pick<InvoiceLineView, "quantity" | "netTotal">): number {
  return l.quantity > 0 && l.netTotal > 0 ? l.netTotal / l.quantity : 0;
}

/**
 * Bağlı hammaddenin bu faturadaki fiyatı, okunur birimle: gr → ₺/kg, ml → ₺/L, adet/dilim → ₺/adet.
 * Hammaddeye bağlı değilse ya da kalem bedavaysa null.
 */
export function ingredientPriceOf(l: InvoiceLineView): { value: number; per: string } | null {
  const ing = l.ingredient;
  const unit = netUnitPrice(l);
  if (!ing || !unit || !(ing.factor > 0)) return null;
  const perBase = unit / ing.factor;
  if (ing.unit === "gr") return { value: perBase * 1000, per: "kg" };
  if (ing.unit === "ml") return { value: perBase * 1000, per: "L" };
  return { value: perBase, per: ing.unit };
}

/** Kalemlerin toplamı ve faturanın KDV hariç tutarını tutup tutmadığı (1 ₺ ya da binde 5 tolerans) */
export function linesTotal(lines: Pick<InvoiceLineView, "netTotal">[], invoiceNet: number): { total: number; matches: boolean } {
  const total = Math.round(lines.reduce((t, l) => t + l.netTotal, 0) * 100) / 100;
  return { total, matches: Math.abs(total - invoiceNet) <= Math.max(1, Math.abs(invoiceNet) * 0.005) };
}
