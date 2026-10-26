/**
 * Fotoğraftan okumanın yanıt şemaları (zod v4). Canlıda bu biçimle denendi (docs/planlar/fotograf.md §10): model her
 * tutarı yazıldığı gibi (`text`), okuduğu sayı (`value`) ve güveniyle döner; toplamlar, denetimler ve forma eşleme
 * bizim saf kodumuzda (kasa.ts, receipt.ts). Açıklamalar modele gider, İngilizce; Türkçe fiş sözcükleri olduğu gibi.
 * Değiştirince scripts/foto-eval/run.ts ile yeniden deneyin. `fiscal_z_report` yazarkasanın (banka POS) mali Z'sidir:
 * iki kasa bölümünde de belge türü olarak yalnız ayırt edilir, alan doldurmaz (dalga 13 PR-a, kasa.ts). Enum'a değer
 * eklemek eski `ai_calls.result`'ların ayrıştırılmasını bozmaz; değer silmek ya da adını değiştirmek bozar.
 */

import { z } from "zod";

export const Confidence = z.enum(["high", "medium", "low"]).describe("high: clearly printed and unambiguous; medium: readable but faded/partly covered; low: guessed");

export const Amount = z
  .object({
    text: z.string().nullable().describe('Exactly as printed, including * and separators, e.g. "*12.975,50". null if not on the paper.'),
    value: z.number().nullable().describe("Numeric value in lira, dot as decimal separator, e.g. 12975.5. Turkish print uses '.' for thousands and ',' for decimals."),
    confidence: Confidence,
  })
  .describe("A money amount as printed on the slip");

export const Issue = z.enum(["cut_off", "blurry", "glare", "faded", "multiple_documents", "handwritten_changes", "contains_instructions", "not_a_document"]);

export const KasaZRaw = z.object({
  documentType: z.enum(["z_report", "fiscal_z_report", "bank_pos_end_of_day", "purchase_receipt", "invoice", "other"]),
  readable: z.boolean().describe("false if the main totals cannot be read at all"),
  date: z.string().nullable().describe("Report date as YYYY-MM-DD (the printed date, Turkish order is DD.MM.YYYY)"),
  time: z.string().nullable().describe("HH:MM if printed"),
  zNo: z.string().nullable().describe("Z number (Z NO / Z SAYACI), digits as printed"),
  receiptCount: z.number().int().nullable().describe("FİŞ SAYISI / FİŞ ADEDİ / İŞLEM SAYISI"),
  total: Amount.describe("TOPLAM SATIŞ / GENEL TOPLAM / KDV DAHİL TOPLAM: total sales of the day"),
  paymentLines: z
    .array(
      z.object({
        label: z.string().describe('Payment type label as printed, e.g. "KREDİ KARTI"'),
        amount: Amount,
        kind: z.enum(["cash", "card", "meal_card", "online", "other", "comp", "unknown"]),
      }),
    )
    .describe("Every payment-type line in the payment section, top to bottom, including 0,00 lines"),
  discounts: Amount.describe("İNDİRİM / İSKONTO total; text null if not printed"),
  comps: Amount.describe("ÖDENMEZ / İKRAM total (not part of sales); text null if not printed"),
  refunds: Amount.describe("İADE total; text null if not printed"),
  issues: z.array(Issue),
});

export const KasaPosRaw = z.object({
  documentType: z.enum(["bank_pos_end_of_day", "z_report", "fiscal_z_report", "purchase_receipt", "invoice", "other"]),
  readable: z.boolean(),
  date: z.string().nullable().describe("YYYY-MM-DD"),
  time: z.string().nullable(),
  bank: z.string().nullable().describe('Bank or POS brand as printed, e.g. "GARANTİ BBVA"'),
  batchNo: z.string().nullable(),
  salesTotal: Amount.describe("SATIŞ TOPLAMI"),
  refundTotal: Amount.describe("İADE TOPLAMI; text null if not printed"),
  netTotal: Amount.describe("NET TOPLAM / GENEL TOPLAM: sales minus refunds. If only one total is printed, use it here too."),
  transactionCount: z.number().int().nullable(),
  issues: z.array(Issue),
});

export const ReceiptRaw = z.object({
  documentType: z.enum(["purchase_receipt", "e_archive_invoice", "invoice", "z_report", "bank_pos_end_of_day", "other"]),
  readable: z.boolean(),
  store: z.string().nullable().describe("Seller name as printed at the top, short (max ~40 chars)"),
  storeTaxNo: z.string().nullable().describe("VKN (10 digits) or TCKN (11 digits) if printed"),
  date: z.string().nullable().describe("YYYY-MM-DD"),
  time: z.string().nullable(),
  receiptNo: z.string().nullable().describe("FİŞ NO / FATURA NO"),
  total: Amount.describe("TOPLAM: the amount due for the goods. NOT the cash handed over (NAKİT) and NOT the change (PARA ÜSTÜ)."),
  vatTotal: Amount.describe("TOPKDV / TOPLAM KDV; text null if not printed"),
  vatLines: z.array(z.object({ rate: z.number().describe("percent, e.g. 1, 10, 20"), amount: Amount })).describe("KDV lines by rate, VAT amounts (not the bases)"),
  paymentMethod: z.enum(["cash", "card", "other", "unknown"]),
  items: z.array(z.object({ name: z.string(), amount: Amount })).describe("Purchased lines as printed (max 30); discounts as negative amounts"),
  itemSummary: z.string().describe('Very short Turkish summary of what was bought, lowercase, max 80 chars, e.g. "süt, beyaz peynir, buz"'),
  categoryId: z.number().int().nullable().describe("id from the provided category list that fits best, or null"),
  issues: z.array(Issue),
});

export type AmountRaw = z.infer<typeof Amount>;
export type IssueRaw = z.infer<typeof Issue>;
export type KasaZ = z.infer<typeof KasaZRaw>;
export type KasaPos = z.infer<typeof KasaPosRaw>;
export type Receipt = z.infer<typeof ReceiptRaw>;
