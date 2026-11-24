import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";

import { staffCategory } from "@/lib/cash-outs";
import { isCashOutMove, planLafposCashOuts, type LafposCashOutRow } from "@/lib/lafpos/cash-moves";
import type { PosCashMove } from "@/lib/lafpos/day";
import { LAFPOS_BRANCH_ID } from "@/lib/lafpos/switch";
import { longDateTR } from "@/lib/reminders";
import { removeCashOut, writeCashOut, type CashOutActor, type CashOutRow, type CashOutTx } from "@/server/cash-outs/write";
import { schema as s } from "@/server/db";

/**
 * LafPOS'un kasa hareketleri → "Kasadan çıkanlar" (Faz 3, 23 Kasım 2026; sahibin kararı "Soru 5": LafPOS satırların
 * kaynağı; docs/LAFPOS.md › Kasadan çıkanlar LafPOS'tan). Gün sonunun işleminde, (şube, gün) danışma kilidinin altında
 * çağrılır (ingest.ts storePosDay): yalnız LafPOS'un şubesinin sayılan gününde (geçiş gününden önce değil) ve gövde
 * `cashMoves` taşıyorsa (eski LafPOS ya da okunamayan listede satırlara dokunulmaz). Plan saf: src/lib/lafpos/cash-moves.ts.
 *
 * - Yeni harcama ve teslim satır olur: şube Marina, gönderen "LafPOS" (kişi adı yazılmaz), saat hareketin anı, belge
 *   "yok", açıklama LafPOS'un. Harcamanın kategorisi personelin seçebildiği bir kategoriyse (etkin, staffCategory)
 *   Aylık harcamalar'a da yazılır (personelin fişsiz alışverişinin kuralı); kategorisizse ya da kategori yöneticininse
 *   yalnız satır (kategoriyi panelde personel ya da yönetici seçer).
 * - Elle girilmiş eşi sahiplenilir (yalnız kimlik yazılır; fotoğraf, yer, belge, kategori ve tedarikçi bağı kalır).
 *   Satırı bir tedarikçi ödemesi açtıysa artık LafPOS'undur: ödeme silinince satır kalır (cash_out_created = false).
 * - Bilinen satırda LafPOS alanı (tutar, tür, gün) değiştiyse yeniden yazılır, panelin yazdıkları (yer, belge,
 *   fotoğraf, kategori, açıklama) kalır.
 * - Gövdede olmayan LafPOS satırı silinir; bir tedarikçi ödemesine bağlıysa silinmez, LafPOS bağı çözülür (satır elle
 *   girilmiş gibi kalır, ödeme bozulmaz).
 */

/** Satırların ve harcama kayıtlarının "gönderen"i: sistem, kişi değil */
export const LAFPOS_CASH_OUT_BY = "LafPOS";
const SYSTEM: CashOutActor = { id: 0, name: LAFPOS_CASH_OUT_BY, role: "admin" };

export interface LafposCashOutSync {
  inserted: number;
  adopted: number;
  updated: number;
  removed: number;
  /** Tedarikçi ödemesine bağlı olduğu için silinmeyip LafPOS bağı çözülen satırlar */
  released: number;
}

export async function syncLafposCashOuts(tx: CashOutTx, date: string, moves: readonly PosCashMove[]): Promise<LafposCashOutSync> {
  const branchId = LAFPOS_BRANCH_ID;
  const ids = moves.filter(isCashOutMove).map((m) => m.id);
  // Günün satırları ve (olmaması gereken) başka güne düşmüş aynı kimlikli satır: benzersiz indeks ikinci satırı açtırmaz
  const rows: CashOutRow[] = await tx
    .select()
    .from(s.cashOuts)
    .where(or(and(eq(s.cashOuts.date, date), eq(s.cashOuts.branchId, branchId)), ids.length ? inArray(s.cashOuts.lafposId, ids) : undefined))
    .for("update");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const plan = planLafposCashOuts(
    moves,
    rows.map((r): LafposCashOutRow => ({ id: r.id, kind: r.kind, amount: r.amount, lafposId: r.lafposId, createdAt: r.createdAt })),
  );
  // Başka güne ya da şubeye düşmüş LafPOS satırı bu güne döner (kilit eşitlemeye uygulanmaz)
  const movedRows = rows.filter((r) => r.lafposId !== null && ids.includes(r.lafposId) && (r.date !== date || r.branchId !== branchId));
  const update = [...plan.update];
  for (const r of movedRows) if (!update.some((u) => u.rowId === r.id)) update.push({ rowId: r.id, move: moves.find((m) => m.id === r.lafposId)! });

  const categories = await tx.select().from(s.expenseCategories);
  const usable = (id: number | null) => id !== null && categories.some((c) => c.id === id && staffCategory(c));
  const out: LafposCashOutSync = { inserted: 0, adopted: 0, updated: 0, removed: 0, released: 0 };

  for (const m of plan.insert) {
    if (!isCashOutMove(m)) continue;
    const toExpenses = m.kind === "harcama" && usable(m.categoryId);
    await writeCashOut(
      tx,
      SYSTEM,
      {
        id: null,
        date,
        kind: m.kind,
        amount: m.amount,
        store: null,
        description: m.description || null,
        receiptDate: null,
        receiptNo: null,
        vat: null,
        docType: "yok",
        categoryId: toExpenses ? m.categoryId : null,
        toExpenses,
        photoId: null,
      },
      { branchId, author: { id: null, name: LAFPOS_CASH_OUT_BY }, lafpos: { id: m.id, at: new Date(m.at) } },
    );
    out.inserted += 1;
  }

  for (const a of plan.adopt) {
    await tx.update(s.cashOuts).set({ lafposId: a.move.id, updatedAt: new Date() }).where(eq(s.cashOuts.id, a.rowId));
    // Ödemenin açtığı satır artık LafPOS'un: ödeme silinince ya da başka yönteme geçince satır kalır
    await tx.update(s.supplierEntries).set({ cashOutCreated: false }).where(eq(s.supplierEntries.cashOutId, a.rowId));
    out.adopted += 1;
  }

  for (const u of update) {
    const prev = byId.get(u.rowId)!;
    if (!isCashOutMove(u.move)) continue;
    const [expense] = await tx.select({ categoryId: s.expenseEntries.categoryId }).from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, prev.id)).limit(1);
    await writeCashOut(
      tx,
      SYSTEM,
      {
        id: prev.id,
        date,
        kind: u.move.kind,
        amount: u.move.amount,
        store: prev.store,
        description: prev.description,
        receiptDate: prev.receiptDate,
        receiptNo: prev.receiptNo,
        vat: prev.vat,
        docType: prev.docType,
        categoryId: expense?.categoryId ?? null,
        toExpenses: u.move.kind === "harcama" && Boolean(expense),
        photoId: prev.photoId,
      },
      { prev, lafpos: { id: u.move.id, at: new Date(u.move.at) } },
    );
    if (prev.branchId !== branchId) await tx.update(s.cashOuts).set({ branchId }).where(eq(s.cashOuts.id, prev.id));
    out.updated += 1;
  }

  for (const id of plan.remove) {
    const row = byId.get(id)!;
    const [payment] = await tx.select({ id: s.supplierEntries.id }).from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, id)).limit(1);
    if (payment) {
      await tx.update(s.cashOuts).set({ lafposId: null, updatedAt: new Date() }).where(eq(s.cashOuts.id, id));
      out.released += 1;
    } else {
      await removeCashOut(tx, row, { lafpos: true });
      out.removed += 1;
    }
  }

  const parts = [
    out.inserted && `${out.inserted} yeni`,
    out.adopted && `${out.adopted} elle girilmiş satır eşleşti`,
    out.updated && `${out.updated} güncellendi`,
    out.removed && `${out.removed} kaldırıldı`,
    out.released && `${out.released} tedarikçi ödemesine bağlı olduğu için kaldı`,
  ].filter(Boolean);
  if (parts.length) {
    await tx.insert(s.activityLog).values({ userName: LAFPOS_CASH_OUT_BY, userId: null, action: "Kasadan çıkanlar (LafPOS)", detail: `${longDateTR(date)}: ${parts.join(", ")}` });
  }
  return out;
}
