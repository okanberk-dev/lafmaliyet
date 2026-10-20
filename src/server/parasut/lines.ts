import "server-only";

import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";

import { ParasutClient, ParasutDeadlineError, ParasutError } from "./client";
import { extractUblXml, parseUbl, ublLinesToDrafts, type UblInvoice } from "./ubl";

/**
 * E-fatura kalemleri. İçeri alınmamış (Paraşüt'te gider faturası olmayan) e-faturalardan açılan kayıtların ve
 * Excel'den gelip e-faturaya bağlanan kayıtların kalemleri UBL belgesinden okunur ve gider faturası kalemleriyle
 * aynı tabloya (parasut_bill_lines) yazılır; hammaddeye bağlı kalemlerden alınan miktar ve fiyat güncellenir
 * (applyProductLinks, eşitlemenin sonunda). Belgesi bir kez okunan fatura (ubl_read_at) yeniden okunmaz; e-fatura
 * değişirse eşitleme alanı boşaltır.
 * Canlı veride 82 gelen e-faturanın 82'sinde kalem toplamı faturayı kuruşu kuruşuna tuttu (20 Eki 2026).
 */

export interface LineReadStats {
  /** Belgesi okunan fatura */
  read: number;
  /** Yazılan kalem */
  lines: number;
  /** Belgesi alınamayan ya da çözülemeyen fatura (bir daha denenmez) */
  failed: number;
  /** KDV hariç tutarı belgeden düzeltilen fatura (tevkifatlı) */
  corrected: number;
  /** Sırada kalan */
  remaining: number;
  /** Kalemi değişen aylar (alınan miktarlar yeniden hesaplanır) */
  months: string[];
  /** Paraşüt yavaş/erişilemez olduğu için yarıda bırakıldıysa nedeni */
  stoppedBy: string | null;
}

/** Kalemi okunacak kayıtlar: e-faturaya bağlı, kendi kalemleri olan gider faturası olmayan, henüz okunmamış */
const pendingWhere = () => and(isNotNull(s.invoices.eInvoiceId), isNull(s.invoices.externalId), isNull(s.invoices.ublReadAt));

export async function pendingLineReads(): Promise<number> {
  const [{ n }] = await getDb().select({ n: count() }).from(s.invoices).where(pendingWhere());
  return n;
}

/** Bir sonraki denemede düzelebilecek hata (Paraşüt yavaş, oturum, hız sınırı): fatura işaretlenmez */
function transient(e: unknown): boolean {
  if (e instanceof ParasutError) return e.status === 0 || e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500;
  return false;
}

function appendNote(note: string | null, add: string): string {
  if (note?.includes(add)) return note;
  return note ? `${note} · ${add}` : add;
}

/**
 * Sıradaki faturaların (en yeni önce) UBL kalemlerini okur ve yazar. `until` (epoch ms) geçilince bırakır; kalanı
 * sonraki eşitleme sürdürür. Belgedeki vade boş vadeye yazılır.
 */
export async function readEInvoiceLines(client: ParasutClient, opts: { until: number; limit?: number }): Promise<LineReadStats> {
  const db = getDb();
  const stats: LineReadStats = { read: 0, lines: 0, failed: 0, corrected: 0, remaining: 0, months: [], stoppedBy: null };
  const months = new Set<string>();
  const rows = await db
    .select({
      id: s.invoices.id,
      eInvoiceId: s.invoices.eInvoiceId,
      supplier: s.invoices.supplier,
      date: s.invoices.date,
      dueDate: s.invoices.dueDate,
      amount: s.invoices.amount,
      discount: s.invoices.discount,
      vat: s.invoices.vat,
      note: s.invoices.note,
    })
    .from(s.invoices)
    .where(pendingWhere())
    .orderBy(desc(s.invoices.date), desc(s.invoices.id))
    .limit(opts.limit ?? 500);

  for (const row of rows) {
    if (Date.now() > opts.until) break;
    let inv: UblInvoice | null = null;
    try {
      // 404/204: Paraşüt belgeyi vermedi; fatura okunmuş sayılır
      const file = await client.getBytes(`e_invoices/${encodeURIComponent(row.eInvoiceId!)}/signed_ubl`);
      if (file) inv = parseUbl(extractUblXml(file.bytes));
    } catch (e) {
      if (e instanceof ParasutDeadlineError) break;
      if (transient(e)) {
        stats.stoppedBy = (e as Error).message;
        break;
      }
      console.error("E-fatura kalemleri", row.eInvoiceId, e);
    }

    if (!inv) {
      await db.update(s.invoices).set({ ublReadAt: new Date() }).where(eq(s.invoices.id, row.id));
      stats.failed++;
      continue;
    }

    const drafts = ublLinesToDrafts(inv, row.eInvoiceId!, row.supplier);
    const patch: Partial<typeof s.invoices.$inferInsert> = { ublReadAt: new Date() };
    if (!row.dueDate && inv.dueDate && inv.dueDate >= row.date) patch.dueDate = inv.dueDate;
    // Tutar e-fatura listesinden geldiyse ("ödenecek − KDV") belgedeki KDV hariç toplamla düzeltilir: tevkifatlı
    // faturada liste tedarikçiye ödenecek tutarı verir, maliyet eksik kalır. Elle değiştirilmiş tutara dokunulmaz.
    const sign = inv.typeCode === "IADE" ? -1 : 1;
    const fromList = Math.abs(row.amount - row.discount - sign * (inv.payable - inv.vat)) <= 1;
    if (fromList && inv.taxExclusive > 0) {
      const cost = sign * inv.taxExclusive;
      if (Math.abs(row.amount - row.discount - cost) > 1) {
        patch.amount = Math.round((cost + row.discount) * 100) / 100;
        if (inv.vat > 0 && Math.abs(row.vat - sign * inv.vat) > 1) patch.vat = sign * inv.vat;
        const was = (row.amount - row.discount).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
        patch.note = appendNote(
          (row.note ?? "").replace(" · tevkifatlı: tutarı kontrol edin", "").replace("tevkifatlı: tutarı kontrol edin", "") || null,
          inv.withholding ? `tevkifatlı: KDV hariç tutar e-fatura belgesinden (önce ${was} ₺)` : `KDV hariç tutar e-fatura belgesinden düzeltildi (önce ${was} ₺)`,
        );
        stats.corrected++;
      }
    }
    if (!inv.linesMatch) patch.note = appendNote((patch.note as string | undefined) ?? row.note, "kalemlerin toplamı faturayı tutmuyor; kalem fiyatlarını kontrol edin");

    await db.transaction(async (tx) => {
      await tx.delete(s.parasutBillLines).where(eq(s.parasutBillLines.invoiceId, row.id));
      if (drafts.length) {
        // Aynı e-fatura başka bir kayda bağlıyken yazılmış kalemler varsa kopya kalmasın
        await tx.delete(s.parasutBillLines).where(inArray(s.parasutBillLines.externalId, drafts.map((d) => d.externalId)));
        await tx.insert(s.parasutBillLines).values(drafts.map((d) => ({ ...d, invoiceId: row.id })));
      }
      await tx.update(s.invoices).set(patch).where(eq(s.invoices.id, row.id));
    });
    months.add(row.date.slice(0, 7));
    stats.read++;
    stats.lines += drafts.length;
  }
  stats.months = [...months];
  stats.remaining = await pendingLineReads();
  return stats;
}
