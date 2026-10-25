import "server-only";

import { and, eq, gte, isNotNull, lte, or } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";

/** Aylık harcama kaydının fiş bilgisi: fotoğrafı, KDV'si (bilgi) ve kasadan çıkan satırı */
export interface ExpenseExtra {
  photoId: number | null;
  vat: number | null;
  cashOutId: number | null;
  /** Bağlı kasadan çıkanın kasa günü (Kasa raporuna git) */
  cashOutDate: string | null;
  /** Kaydın sahibi bir cari borçsa (faturasız alımın gideri) tedarikçinin kartı: tutar, gün ve kategori orada düzeltilir */
  cariCardId: number | null;
  cariName: string | null;
}

/**
 * Ayın kayıtlarının fiş bilgileri (yalnız fişli, kasaya ya da bir cari borca bağlı olanlar); veri kümesi dosyalarına
 * dokunmadan
 */
export async function expenseExtras(month: string): Promise<Map<number, ExpenseExtra>> {
  const rows = await getDb()
    .select({
      id: s.expenseEntries.id,
      photoId: s.expenseEntries.photoId,
      vat: s.expenseEntries.vat,
      cashOutId: s.expenseEntries.cashOutId,
      cashOutDate: s.cashOuts.date,
      cariCardId: s.supplierEntries.supplierId,
      cariName: s.suppliers.name,
    })
    .from(s.expenseEntries)
    .leftJoin(s.cashOuts, eq(s.cashOuts.id, s.expenseEntries.cashOutId))
    .leftJoin(s.supplierEntries, eq(s.supplierEntries.id, s.expenseEntries.supplierEntryId))
    .leftJoin(s.suppliers, eq(s.suppliers.id, s.supplierEntries.supplierId))
    .where(
      and(
        gte(s.expenseEntries.date, `${month}-01`),
        lte(s.expenseEntries.date, `${month}-31`),
        or(isNotNull(s.expenseEntries.photoId), isNotNull(s.expenseEntries.cashOutId), isNotNull(s.expenseEntries.vat), isNotNull(s.expenseEntries.supplierEntryId)),
      ),
    );
  return new Map(rows.map(({ id, ...extra }) => [id, extra]));
}
