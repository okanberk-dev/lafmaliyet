import "server-only";

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { ownerRowsAmountOnly, staffCategory, type CashOutDocType, type CashOutKind, type StaffCashOutField } from "@/lib/cash-outs";
import type { Role } from "@/lib/constants";
import { asilposAwaitingCategory, asilposInsertedRow } from "@/lib/asilpos/cash-moves";
import { ownerRowAmountOnly } from "@/lib/roles";
import { currentBranchWhere } from "@/server/branch-scope";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadPosTillIds } from "@/server/pos/tills";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Gün içinde kasadan çıkan bir satır (ekranda; bağlı harcama kaydı ve kategorisiyle) */
export interface CashOutDTO {
  id: number;
  /** Satırın kasasının şubesi */
  branchId?: string;
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
  /** AsilPOS'un kasa hareketinin kimliği (Faz 3): tutar, tür ve gün AsilPOS'tan, satır silinmez; elle girilen satırda null */
  asilposId: string | null;
  /**
   * Kategorisini bekleyen AsilPOS harcaması (asilposAwaitingCategoryIds): personel kategori seçince Aylık harcamalar'a
   * yazılır (pencere kategoriyi sorar)
   */
  asilposAwaitingCategory: boolean;
}

/**
 * Kasa kartının ve penceresinin satırı: yöneticide bütün satır, personelde yalnız beyaz listedeki alanlar
 * (staffCashOutRow). `locked`: satır yöneticinin bir tedarikçi ödemesine bağlı (personel ve müdür düzeltemez, silemez);
 * müdürde ayrıca yöneticinin kategorisindeki (maaş, kira) satır
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
  asilposId: s.cashOuts.asilposId,
  branchId: s.cashOuts.branchId,
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
  const awaiting = await asilposAwaitingCategoryIds(
    getDb(),
    rows.map((r) => ({ ...r, hasExpense: r.expenseEntryId !== null })),
  );
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), asilposAwaitingCategory: awaiting.has(r.id) }));
}

/**
 * Kategorisini bekleyen AsilPOS harcamaları (src/lib/asilpos/cash-moves.ts asilposAwaitingCategory; inceleme LM-3): AsilPOS'un
 * açtığı, kaydı olmayan harcama satırlarının hareketi günün saklı gövdesinde (pos_day_reports.cash_moves) aranır;
 * AsilPOS'un personelin kategorisiyle göndermediği harcama bekler. Aday yoksa sorgu yok. Kasa kartı (cashOutsBetween) ve
 * satırın yazımı (writeCashOut, personelin düzeltmesi) aynı kuralı okur
 */
export async function asilposAwaitingCategoryIds(
  db: DB | Tx,
  rows: readonly { id: number; branchId: string; date: string; kind: CashOutKind; asilposId: string | null; createdBy: number | null; createdByName: string; hasExpense: boolean }[],
): Promise<Set<number>> {
  const candidates = rows.filter((r) => asilposInsertedRow(r) && r.kind === "harcama" && !r.hasExpense);
  if (!candidates.length) return new Set();
  // Her satırın kendi şubesinin gün sonu (çok şube): yalnız AsilPOS kasalarının günleri
  const tills = (await loadPosTillIds(db)).ids;
  const days = await db
    .select({ branchId: s.posDayReports.branchId, cashMoves: s.posDayReports.cashMoves })
    .from(s.posDayReports)
    .where(
      and(
        inArray(s.posDayReports.branchId, [...new Set(candidates.map((r) => r.branchId))].filter((b) => tills.includes(b))),
        inArray(s.posDayReports.date, [...new Set(candidates.map((r) => r.date))]),
      ),
    );
  const categories = await db.select().from(s.expenseCategories);
  // Hareketin kategorisi (saklı gövde şemadan geçmişti; yine de gevşek okunur): kimlik → kategori ya da null
  const moveCategory = new Map<string, number | null>();
  for (const d of days) {
    for (const m of Array.isArray(d.cashMoves) ? (d.cashMoves as unknown[]) : []) {
      const move = m as { id?: unknown; categoryId?: unknown } | null;
      if (move && typeof move.id === "string") moveCategory.set(`${d.branchId}|${move.id}`, typeof move.categoryId === "number" ? move.categoryId : null);
    }
  }
  const usable = (id: number) => categories.some((c) => c.id === id && staffCategory(c));
  return new Set(candidates.filter((r) => asilposAwaitingCategory(r, moveCategory.get(`${r.branchId}|${r.asilposId!}`), usable)).map((r) => r.id));
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

/** Personelin seçebildiği kategorilerin kimlikleri (staffCategory): dışındaki kategori yöneticinin (maaş, kira, kapatılmış) */
export async function staffCategoryIds(): Promise<Set<number>> {
  return new Set((await cashOutCategories("staff")).map((c) => c.id));
}

/**
 * Okuyana giden satırlar (docs/ROLLER.md › Kararlar): müdürde (`ownerRowAmountOnly`) yöneticinin kategorisindeki satır
 * yalnız türü ve tutarıyla (yer, açıklama, fiş ve fotoğrafı, kategori adı null; src/lib/cash-outs.ts › amountOnlyRow);
 * öbür rollerde olduğu gibi. Kasa'nın gün ve ay görünümü (satırlar, formun özeti, rapor penceresi) ve WhatsApp metni
 * (sayfa ve eylemler) bundan geçer
 */
export async function cashOutsShownTo<T extends { categoryId: number | null }>(role: Role, rows: T[]): Promise<T[]> {
  if (!ownerRowAmountOnly(role) || rows.every((o) => o.categoryId === null)) return rows;
  return ownerRowsAmountOnly(rows, await staffCategoryIds());
}
