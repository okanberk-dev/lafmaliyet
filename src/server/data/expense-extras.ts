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
}

/** Ayın kayıtlarının fiş bilgileri (yalnız fişli ya da kasaya bağlı olanlar); veri kümesi dosyalarına dokunmadan */
export async function expenseExtras(month: string): Promise<Map<number, ExpenseExtra>> {
  const rows = await getDb()
    .select({ id: s.expenseEntries.id, photoId: s.expenseEntries.photoId, vat: s.expenseEntries.vat, cashOutId: s.expenseEntries.cashOutId, cashOutDate: s.cashOuts.date })
    .from(s.expenseEntries)
    .leftJoin(s.cashOuts, eq(s.cashOuts.id, s.expenseEntries.cashOutId))
    .where(
      and(
        gte(s.expenseEntries.date, `${month}-01`),
        lte(s.expenseEntries.date, `${month}-31`),
        or(isNotNull(s.expenseEntries.photoId), isNotNull(s.expenseEntries.cashOutId), isNotNull(s.expenseEntries.vat)),
      ),
    );
  return new Map(rows.map(({ id, ...extra }) => [id, extra]));
}
