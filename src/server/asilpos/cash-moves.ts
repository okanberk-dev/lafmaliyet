import "server-only";

import { and, eq, inArray, isNotNull, ne, or } from "drizzle-orm";

import { staffCategory } from "@/lib/cash-outs";
import { isCashOutMove, ASILPOS_CASH_OUT_BY, asilposRecipient, planAsilposCashOuts, planAsilposDetach, planAsilposRecipientFill, type AsilposCashOutRow } from "@/lib/asilpos/cash-moves";
import type { PosCashMove } from "@/lib/asilpos/day";
import { longDateTR } from "@/lib/reminders";
import { removeCashOut, writeCashOut, type CashOutActor, type CashOutRow, type CashOutTx } from "@/server/cash-outs/write";
import { schema as s } from "@/server/db";


/**
 * AsilPOS'un kasa hareketleri → "Kasadan çıkanlar" (Faz 3, 23 Kasım 2026; sahibin kararı "Soru 5": AsilPOS satırların
 * kaynağı; docs/ASILPOS.md › Kasadan çıkanlar AsilPOS'tan). Gün sonunun işleminde, (şube, gün) danışma kilidinin altında
 * çağrılır (ingest.ts storePosDay): yalnız kasanın şubesinin sayılan gününde (geçiş gününden önce değil) ve gövde
 * `cashMoves` taşıyorsa (eski AsilPOS ya da okunamayan listede satırlara dokunulmaz). Plan saf: src/lib/asilpos/cash-moves.ts.
 *
 * - Yeni harcama ve teslim satır olur: şube kasanınki (imzanın anahtarının şubesi), gönderen "AsilPOS" (kişi adı yazılmaz), saat hareketin anı, belge
 *   "yok", açıklama AsilPOS'un. Teslimde "Kime" (`store`) AsilPOS'un alıcısıdır (`recipient`, 25 Kasım 2026); boş Kime'li
 *   eski ya da sahiplenilen satır da alıcıyla dolar, panelde yazılmış Kime'ye dokunulmaz (planAsilposRecipientFill). Harcamanın kategorisi personelin seçebildiği bir kategoriyse (etkin, staffCategory)
 *   Aylık harcamalar'a da yazılır (personelin fişsiz alışverişinin kuralı); kategorisizse ya da kategori yöneticininse
 *   yalnız satır (kategoriyi panelde personel ya da yönetici seçer).
 * - Elle girilmiş eşi sahiplenilir (yalnız kimlik yazılır; fotoğraf, yer, belge, kategori ve tedarikçi bağı kalır).
 *   Satırı bir tedarikçi ödemesi açtıysa artık AsilPOS'undur: ödeme silinince satır kalır (cash_out_created = false).
 * - Bilinen satırda AsilPOS alanı (tutar, tür, gün) değiştiyse yeniden yazılır, panelin yazdıkları (yer, belge,
 *   fotoğraf, kategori, açıklama) kalır.
 * - Gövdede olmayan AsilPOS satırı silinir; bir tedarikçi ödemesine bağlıysa silinmez, AsilPOS bağı çözülür (satır elle
 *   girilmiş gibi kalır, ödeme bozulmaz).
 * - Gün sayılmaz olunca ve günün AsilPOS kaydı silinince satırlar AsilPOS'tan ayrılır (detachAsilposCashOuts).
 */

const SYSTEM: CashOutActor = { id: 0, name: ASILPOS_CASH_OUT_BY, role: "admin" };

export interface AsilposCashOutSync {
  inserted: number;
  adopted: number;
  updated: number;
  removed: number;
  /** Tedarikçi ödemesine bağlı olduğu için silinmeyip AsilPOS bağı çözülen satırlar */
  released: number;
  /** "Kime"si AsilPOS'un alıcısıyla doldurulan satırlar (sahiplenilen ya da önceden yazılmış teslim) */
  recipients: number;
}

/**
 * `branchId`: kasanın şubesi (gün sonunu yazan işlem verir; imzanın anahtarının şubesi). Anahtar yalnız kendi şubesinin
 * satırlarını yazar (çok şube, inceleme 27 Kasım): kimliği başka şubenin satırında olan hareket o şubenin kasasınındır
 * (ör. öbür şubenin yedeğinden kurulmuş kasa eski günleri yeniden yolladı); o satıra dokunulmaz, şubeye taşınmaz ve yeni
 * satır da açılmaz (benzersiz kimlik gönderimi kalıcı 500'e düşürürdü); işlem geçmişine yazılır
 */
export async function syncAsilposCashOuts(tx: CashOutTx, date: string, allMoves: readonly PosCashMove[], branchId: string): Promise<AsilposCashOutSync> {
  const allIds = allMoves.filter(isCashOutMove).map((m) => m.id);
  // Başka şubenin satırındaki kimlikler (kilitlenmez: o satıra yazılmaz)
  const foreign = new Set(
    allIds.length
      ? (
          await tx
            .select({ asilposId: s.cashOuts.asilposId })
            .from(s.cashOuts)
            .where(and(inArray(s.cashOuts.asilposId, allIds), ne(s.cashOuts.branchId, branchId)))
        ).map((r) => r.asilposId)
      : [],
  );
  const moves = allMoves.filter((m) => !(isCashOutMove(m) && foreign.has(m.id)));
  const ids = moves.filter(isCashOutMove).map((m) => m.id);
  // Şubenin günün satırları ve (olmaması gereken) şubenin başka güne düşmüş aynı kimlikli satırı: benzersiz indeks ikinci
  // satırı açtırmaz
  const rows: CashOutRow[] = await tx
    .select()
    .from(s.cashOuts)
    .where(and(eq(s.cashOuts.branchId, branchId), or(eq(s.cashOuts.date, date), ids.length ? inArray(s.cashOuts.asilposId, ids) : undefined)))
    .for("update");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const plan = planAsilposCashOuts(
    moves,
    rows.map((r): AsilposCashOutRow => ({ id: r.id, kind: r.kind, amount: r.amount, asilposId: r.asilposId, createdAt: r.createdAt })),
  );
  // Şubenin başka güne düşmüş AsilPOS satırı bu güne döner (kilit eşitlemeye uygulanmaz)
  const movedRows = rows.filter((r) => r.asilposId !== null && ids.includes(r.asilposId) && r.date !== date);
  const update = [...plan.update];
  for (const r of movedRows) if (!update.some((u) => u.rowId === r.id)) update.push({ rowId: r.id, move: moves.find((m) => m.id === r.asilposId)! });

  const categories = await tx.select().from(s.expenseCategories);
  const usable = (id: number | null) => id !== null && categories.some((c) => c.id === id && staffCategory(c));
  const out: AsilposCashOutSync = { inserted: 0, adopted: 0, updated: 0, removed: 0, released: 0, recipients: 0 };

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
        store: asilposRecipient(m),
        description: m.description || null,
        receiptDate: null,
        receiptNo: null,
        vat: null,
        docType: "yok",
        categoryId: toExpenses ? m.categoryId : null,
        toExpenses,
        photoId: null,
      },
      { branchId, author: { id: null, name: ASILPOS_CASH_OUT_BY }, asilpos: { id: m.id, at: new Date(m.at) } },
    );
    out.inserted += 1;
  }

  for (const a of plan.adopt) {
    await tx.update(s.cashOuts).set({ asilposId: a.move.id, updatedAt: new Date() }).where(eq(s.cashOuts.id, a.rowId));
    // Ödemenin açtığı satır artık AsilPOS'un: ödeme silinince ya da başka yönteme geçince satır kalır
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
        store: prev.store || asilposRecipient(u.move),
        description: prev.description,
        receiptDate: prev.receiptDate,
        receiptNo: prev.receiptNo,
        vat: prev.vat,
        docType: prev.docType,
        categoryId: expense?.categoryId ?? null,
        toExpenses: u.move.kind === "harcama" && Boolean(expense),
        photoId: prev.photoId,
      },
      { prev, asilpos: { id: u.move.id, at: new Date(u.move.at) } },
    );
    out.updated += 1;
  }

  // Teslimin "Kime"si boş olan sahiplenilen ve önceden yazılmış satırlar (yeniden yazılanlar yukarıda doldu)
  const fills = planAsilposRecipientFill(
    moves,
    rows.map((r) => ({ id: r.id, asilposId: r.asilposId, store: r.store })),
    plan.adopt,
    new Set(update.map((u) => u.rowId)),
  );
  for (const f of fills) await tx.update(s.cashOuts).set({ store: f.store, updatedAt: new Date() }).where(eq(s.cashOuts.id, f.rowId));
  out.recipients = fills.length;

  for (const id of plan.remove) {
    const row = byId.get(id)!;
    const [payment] = await tx.select({ id: s.supplierEntries.id }).from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, id)).limit(1);
    if (payment) {
      await tx.update(s.cashOuts).set({ asilposId: null, updatedAt: new Date() }).where(eq(s.cashOuts.id, id));
      out.released += 1;
    } else {
      await removeCashOut(tx, row, { asilpos: true });
      out.removed += 1;
    }
  }

  await logCashOuts(tx, date, branchId, [
    out.inserted && `${out.inserted} yeni`,
    out.adopted && `${out.adopted} elle girilmiş satır eşleşti`,
    out.updated && `${out.updated} güncellendi`,
    out.removed && `${out.removed} kaldırıldı`,
    out.released && `${out.released} tedarikçi ödemesine bağlı olduğu için kaldı`,
    out.recipients && `${out.recipients} teslime Kime yazıldı`,
    foreign.size > 0 && `${foreign.size} hareket başka şubenin satırı olduğu için yazılmadı`,
  ]);
  if (foreign.size) console.error(`[asilpos] ${branchId} ${date}: ${foreign.size} kasa hareketinin kimliği başka şubenin satırında; yazılmadı`);
  return out;
}

/**
 * İşlem geçmişine "Kasadan çıkanlar (AsilPOS)" satırı (yalnız değişiklik varsa): "24 Kasım Salı: <neden>; 1 yeni, …". Yazan
 * verilmezse AsilPOS (sistem)
 */
async function logCashOuts(
  tx: CashOutTx,
  date: string,
  branchId: string,
  parts: (string | false | 0)[],
  by: { id: number | null; name: string } = { id: null, name: ASILPOS_CASH_OUT_BY },
  why?: string,
) {
  const text = parts.filter(Boolean);
  if (!text.length) return;
  await tx.insert(s.activityLog).values({ userName: by.name, userId: by.id, action: "Kasadan çıkanlar (AsilPOS)", detail: `${longDateTR(date)}: ${why ? `${why}; ` : ""}${text.join(", ")}`, branchId });
}

/**
 * Günün AsilPOS satırlarını AsilPOS'tan ayırır (inceleme LM-3; plan: src/lib/asilpos/cash-moves.ts planAsilposDetach). Satır
 * kilitli kalıp silinemez olmasın, sayılmayan gün Kasadan çıkanlar'ı beslemesin:
 * - `drop`: gün artık sayılmıyor (geçiş günü sonraya alındı; ingest.ts her gönderimde, ve deneme gününün kaydı silinince).
 *   AsilPOS'un açtığı satır harcama kaydıyla kalkar; sahiplenilen elle satır ve tedarikçi ödemesine bağlı satır kalır,
 *   bağı çözülür.
 * - `release`: sayılan günün AsilPOS kaydı silindi (admin.ts removeAsilposDay, 409'un çözümü): satırlar kalır, bağları
 *   çözülür; yeni Z gelince elle girilmiş eş olarak yeniden sahiplenilir.
 * Gün sonunun (şube, gün) danışma kilidinin altında çağrılır. `by`: işlem geçmişinde yazan (verilmezse AsilPOS);
 * `branchId`: kasanın şubesi
 */
export async function detachAsilposCashOuts(
  tx: CashOutTx,
  date: string,
  mode: "drop" | "release",
  opts: { by?: { id: number | null; name: string }; branchId: string },
): Promise<{ removed: number; released: number }> {
  const { by, branchId } = opts;
  const rows: CashOutRow[] = await tx
    .select()
    .from(s.cashOuts)
    .where(and(eq(s.cashOuts.date, date), eq(s.cashOuts.branchId, branchId), isNotNull(s.cashOuts.asilposId)))
    .for("update");
  if (!rows.length) return { removed: 0, released: 0 };
  const paid = new Set(
    (await tx.select({ id: s.supplierEntries.cashOutId }).from(s.supplierEntries).where(inArray(s.supplierEntries.cashOutId, rows.map((r) => r.id)))).map((p) => p.id),
  );
  const plan = planAsilposDetach(
    rows.map((r) => ({ id: r.id, asilposId: r.asilposId, createdBy: r.createdBy, createdByName: r.createdByName, paid: paid.has(r.id) })),
    mode,
  );
  for (const id of plan.remove) await removeCashOut(tx, rows.find((r) => r.id === id)!, { asilpos: true });
  if (plan.release.length) await tx.update(s.cashOuts).set({ asilposId: null, updatedAt: new Date() }).where(inArray(s.cashOuts.id, plan.release));
  const why = mode === "drop" ? "gün sayılmıyor (geçiş gününden önce)" : "günün AsilPOS kaydı silindi";
  await logCashOuts(
    tx,
    date,
    branchId,
    [plan.remove.length && `${plan.remove.length} AsilPOS satırı kaldırıldı`, plan.release.length && `${plan.release.length} satır elle girilmiş gibi kaldı (AsilPOS bağı çözüldü)`],
    by,
    why,
  );
  return { removed: plan.remove.length, released: plan.release.length };
}
