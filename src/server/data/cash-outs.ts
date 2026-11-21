import "server-only";

import { and, asc, eq, gte, lte } from "drizzle-orm";

import { staffCategory, type CashOutDocType, type CashOutKind, type StaffCashOutField } from "@/lib/cash-outs";
import { currentBranchWhere } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";

/** Gün içinde kasadan çıkan bir satır (ekranda; bağlı harcama kaydı ve kategorisiyle) */
export interface CashOutDTO {
  id: number;
  date: string;
  kind: CashOutKind;
  amount: number;
  store: string | null;
  description: string | null;
  receiptDate: string | null;
  receiptNo: string | null;
  vat: number | null;
  docType: CashOutDocType;
  photoId: number | null;
  createdBy: number | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  /** Aylık harcamalar'daki kaydı (yazılmadıysa null) */
  expenseEntryId: number | null;
  categoryId: number | null;
  categoryName: string | null;
}

/**
 * Kasa kartının ve penceresinin satırı: yöneticide bütün satır, personelde yalnız beyaz listedeki alanlar
 * (staffCashOutRow). `locked`: satır yöneticinin bir tedarikçi ödemesine bağlı (personel düzeltemez, silemez)
 */
export type CashOutView = Pick<CashOutDTO, StaffCashOutField> & { locked?: boolean };

const columns = {
  id: s.cashOuts.id,
  date: s.cashOuts.date,
  kind: s.cashOuts.kind,
  amount: s.cashOuts.amount,
  store: s.cashOuts.store,
  description: s.cashOuts.description,
  receiptDate: s.cashOuts.receiptDate,
  receiptNo: s.cashOuts.receiptNo,
  vat: s.cashOuts.vat,
  docType: s.cashOuts.docType,
  photoId: s.cashOuts.photoId,
  createdBy: s.cashOuts.createdBy,
  createdByName: s.cashOuts.createdByName,
  createdAt: s.cashOuts.createdAt,
  updatedAt: s.cashOuts.updatedAt,
  expenseEntryId: s.expenseEntries.id,
  categoryId: s.expenseEntries.categoryId,
  categoryName: s.expenseCategories.name,
};

/**
 * [from, to] günlerinin satırları (eskiden yeniye). Kasadan çıkan şubenin kasasınındır: verilen şubenin, yoksa seçili
 * şubenin ("Tümü"de hepsi). Önceden süzülmüyordu: Marina'nın kasa formu Tuzla'nın kasadan çıkanlarını da gösteriyor,
 * e-posta ve "fişsiz" denetimi iki kasayı karıştırıyordu.
 */
export async function cashOutsBetween(from: string, to: string, branchId?: string): Promise<CashOutDTO[]> {
  const sube = branchId !== undefined ? eq(s.cashOuts.branchId, branchId) : await currentBranchWhere(s.cashOuts.branchId);
  const rows = await getDb()
    .select(columns)
    .from(s.cashOuts)
    .leftJoin(s.expenseEntries, eq(s.expenseEntries.cashOutId, s.cashOuts.id))
    .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
    .where(and(gte(s.cashOuts.date, from), lte(s.cashOuts.date, to), sube))
    .orderBy(asc(s.cashOuts.date), asc(s.cashOuts.createdAt), asc(s.cashOuts.id))
    .limit(2000);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

/** Günün kasadan çıkanları: verilen şubenin kasası, yoksa seçili şube ("Tümü"de hepsi) */
export function cashOutsOn(date: string, branchId?: string): Promise<CashOutDTO[]> {
  return cashOutsBetween(date, date, branchId);
}

export interface CashOutCategory {
  id: number;
  name: string;
  section: string;
}

/** Kasadan çıkan fişin kategorileri: personel yalnız alım ve genel giderlerin "diğer" grubunu, yönetici etkin hepsini */
export async function cashOutCategories(role: "admin" | "staff"): Promise<CashOutCategory[]> {
  const rows = await getDb().select().from(s.expenseCategories).orderBy(asc(s.expenseCategories.sortOrder), asc(s.expenseCategories.id));
  return rows.filter((c) => (role === "admin" ? c.active : staffCategory(c))).map((c) => ({ id: c.id, name: c.name, section: c.section }));
}
