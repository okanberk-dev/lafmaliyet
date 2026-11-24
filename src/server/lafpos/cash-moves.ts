import "server-only";

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import { staffCategory } from "@/lib/cash-outs";
import { isCashOutMove, LAFPOS_CASH_OUT_BY, planLafposCashOuts, planLafposDetach, type LafposCashOutRow } from "@/lib/lafpos/cash-moves";
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
 * - Gün sayılmaz olunca ve günün LafPOS kaydı silinince satırlar LafPOS'tan ayrılır (detachLafposCashOuts).
 */

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

  await logCashOuts(tx, date, [
    out.inserted && `${out.inserted} yeni`,
    out.adopted && `${out.adopted} elle girilmiş satır eşleşti`,
    out.updated && `${out.updated} güncellendi`,
    out.removed && `${out.removed} kaldırıldı`,
    out.released && `${out.released} tedarikçi ödemesine bağlı olduğu için kaldı`,
  ]);
  return out;
}

/**
 * İşlem geçmişine "Kasadan çıkanlar (LafPOS)" satırı (yalnız değişiklik varsa): "24 Kasım Salı: <neden>; 1 yeni, …". Yazan
 * verilmezse LafPOS (sistem)
 */
async function logCashOuts(tx: CashOutTx, date: string, parts: (string | false | 0)[], by: { id: number | null; name: string } = { id: null, name: LAFPOS_CASH_OUT_BY }, why?: string) {
  const text = parts.filter(Boolean);
  if (!text.length) return;
  await tx.insert(s.activityLog).values({ userName: by.name, userId: by.id, action: "Kasadan çıkanlar (LafPOS)", detail: `${longDateTR(date)}: ${why ? `${why}; ` : ""}${text.join(", ")}` });
}

/**
 * Günün LafPOS satırlarını LafPOS'tan ayırır (inceleme LM-3; plan: src/lib/lafpos/cash-moves.ts planLafposDetach). Satır
 * kilitli kalıp silinemez olmasın, sayılmayan gün Kasadan çıkanlar'ı beslemesin:
 * - `drop`: gün artık sayılmıyor (geçiş günü sonraya alındı; ingest.ts her gönderimde, ve deneme gününün kaydı silinince).
 *   LafPOS'un açtığı satır harcama kaydıyla kalkar; sahiplenilen elle satır ve tedarikçi ödemesine bağlı satır kalır,
 *   bağı çözülür.
 * - `release`: sayılan günün LafPOS kaydı silindi (admin.ts removeLafposDay, 409'un çözümü): satırlar kalır, bağları
 *   çözülür; yeni Z gelince elle girilmiş eş olarak yeniden sahiplenilir.
 * Gün sonunun (şube, gün) danışma kilidinin altında çağrılır. `by`: işlem geçmişinde yazan (verilmezse LafPOS)
 */
export async function detachLafposCashOuts(tx: CashOutTx, date: string, mode: "drop" | "release", by?: { id: number | null; name: string }): Promise<{ removed: number; released: number }> {
  const rows: CashOutRow[] = await tx
    .select()
    .from(s.cashOuts)
    .where(and(eq(s.cashOuts.date, date), eq(s.cashOuts.branchId, LAFPOS_BRANCH_ID), isNotNull(s.cashOuts.lafposId)))
    .for("update");
  if (!rows.length) return { removed: 0, released: 0 };
  const paid = new Set(
    (await tx.select({ id: s.supplierEntries.cashOutId }).from(s.supplierEntries).where(inArray(s.supplierEntries.cashOutId, rows.map((r) => r.id)))).map((p) => p.id),
  );
  const plan = planLafposDetach(
    rows.map((r) => ({ id: r.id, lafposId: r.lafposId, createdBy: r.createdBy, createdByName: r.createdByName, paid: paid.has(r.id) })),
    mode,
  );
  for (const id of plan.remove) await removeCashOut(tx, rows.find((r) => r.id === id)!, { lafpos: true });
  if (plan.release.length) await tx.update(s.cashOuts).set({ lafposId: null, updatedAt: new Date() }).where(inArray(s.cashOuts.id, plan.release));
  const why = mode === "drop" ? "gün sayılmıyor (geçiş gününden önce)" : "günün LafPOS kaydı silindi";
  await logCashOuts(
    tx,
    date,
    [plan.remove.length && `${plan.remove.length} LafPOS satırı kaldırıldı`, plan.release.length && `${plan.release.length} satır elle girilmiş gibi kaldı (LafPOS bağı çözüldü)`],
    by,
    why,
  );
  return { removed: plan.remove.length, released: plan.release.length };
}
