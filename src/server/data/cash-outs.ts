import "server-only";

import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";

import { staffCategory, type CashOutDocType, type CashOutKind, type StaffCashOutField } from "@/lib/cash-outs";
import { andWhere, currentBranchWhere, currentWriteBranch } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";

/** Gün içinde kasadan çıkan bir satır (ekranda; bağlı harcama kaydı ve kategorisiyle) */
export interface CashOutDTO {
  id: number;
  /** Satırın şubesi (kasa raporunun şubesiyle aynı; docs/SUBE.md) */
  branchId: string;
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
  branchId: s.cashOuts.branchId,
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

/** Satırlar (eskiden yeniye), verilen şube koşuluyla */
async function rowsBetween(from: string, to: string, branch: SQL | undefined): Promise<CashOutDTO[]> {
  const rows = await getDb()
    .select(columns)
    .from(s.cashOuts)
    .leftJoin(s.expenseEntries, eq(s.expenseEntries.cashOutId, s.cashOuts.id))
    .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
    .where(andWhere(and(gte(s.cashOuts.date, from), lte(s.cashOuts.date, to)), branch))
    .orderBy(asc(s.cashOuts.date), asc(s.cashOuts.createdAt), asc(s.cashOuts.id))
    .limit(2000);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

/** [from, to] günlerinin satırları (eskiden yeniye), seçili şubenin; "Tümü"de bütün şubelerin (Kasa'nın ay listesi) */
export async function cashOutsBetween(from: string, to: string): Promise<CashOutDTO[]> {
  return rowsBetween(from, to, await currentBranchWhere(s.cashOuts.branchId));
}

/**
 * Günün satırları, tek şubenin (seçili şube; "Tümü"de yazılan şube, Tuzla; denetim KP-04): raporun "Gün içinde
 * çıkan"ı, e-posta ve WhatsApp öteki şubenin fişini saymaz. Raporu bilinen yerde (e-posta, onay kartı) raporun şubesiyle
 * okunur (withBranchScope)
 */
export async function cashOutsOn(date: string): Promise<CashOutDTO[]> {
  return rowsBetween(date, date, eq(s.cashOuts.branchId, await currentWriteBranch()));
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
