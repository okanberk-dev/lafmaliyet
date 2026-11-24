import type { CashOutKind } from "@/lib/cash-outs";

import type { PosCashMove } from "./day";

/**
 * LafPOS'un kasa hareketleri → panelin "Kasadan çıkanlar"ı (Faz 3, 23 Kasım 2026; sahibin kararı: docs/LAFPOS.md "Soru
 * 5" yanıtlandı, docs/LAFPOS.md › Kasadan çıkanlar LafPOS'tan). Saf kısım: gövdenin hareketleriyle günün satırlarının
 * planı ve LafPOS satırının kilidi. Yazımı src/server/lafpos/cash-moves.ts yapar; testleri tests/kasa-zinciri.test.ts.
 *
 * - Harcama ve teslim satır olur (`cash_outs.lafpos_id` = hareketin kimliği, benzersiz); giriş satır olmaz (tablo kasadan
 *   çıkanı tutar; giren Kasa raporunda `cashIn`'dir).
 * - Aynı gün yeniden gönderilince aynı kimlikli satır güncellenir (yeni satır açılmaz).
 * - Panelde elle girilmiş eş satır (aynı gün ve şube, aynı tür, aynı tutar, LafPOS'a bağlanmamış) bire bir sahiplenilir:
 *   en eskisi önce; fotoğrafı, yeri, belgesi, kategorisi ve tedarikçi bağı kalır. Böylece aynı para iki kez sayılmaz.
 * - Günün gövdede olmayan LafPOS satırı kaldırılır; elle girilmiş satıra dokunulmaz.
 */

/** Günün satırı (planın gördüğü alanlar) */
export interface LafposCashOutRow {
  id: number;
  kind: CashOutKind;
  amount: number;
  lafposId: string | null;
  createdAt: Date;
}

export interface LafposCashOutPlan {
  /** Yeni satır olacak hareketler (gövdedeki sırayla) */
  insert: PosCashMove[];
  /** Elle girilmiş satırın sahiplenilmesi (satıra hareketin kimliği yazılır) */
  adopt: { rowId: number; move: PosCashMove }[];
  /** Kimliği bilinen satırın LafPOS alanı (tutar ya da tür) değişti */
  update: { rowId: number; move: PosCashMove }[];
  /** Gövdede olmayan LafPOS satırları */
  remove: number[];
}

/** Tutarlar kuruşta aynı mı */
const sameAmount = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/** Satır olan hareket: harcama ve teslim (giriş kasaya girendir, "Kasadan çıkanlar"a girmez) */
export const isCashOutMove = (m: PosCashMove): m is PosCashMove & { kind: CashOutKind } => m.kind === "harcama" || m.kind === "teslim";

export function planLafposCashOuts(moves: readonly PosCashMove[], rows: readonly LafposCashOutRow[]): LafposCashOutPlan {
  const outs = moves.filter(isCashOutMove);
  const byId = new Map(rows.filter((r) => r.lafposId !== null).map((r) => [r.lafposId!, r]));
  const wanted = new Set(outs.map((m) => m.id));
  // Elle girilmiş satırlar, en eskisi önce (sahiplenme bire bir)
  const manual = rows.filter((r) => r.lafposId === null).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const taken = new Set<number>();
  const plan: LafposCashOutPlan = { insert: [], adopt: [], update: [], remove: [] };
  for (const m of outs) {
    const own = byId.get(m.id);
    if (own) {
      if (own.kind !== m.kind || !sameAmount(own.amount, m.amount)) plan.update.push({ rowId: own.id, move: m });
      continue;
    }
    const twin = manual.find((r) => !taken.has(r.id) && r.kind === m.kind && sameAmount(r.amount, m.amount));
    if (twin) {
      taken.add(twin.id);
      plan.adopt.push({ rowId: twin.id, move: m });
    } else plan.insert.push(m);
  }
  for (const r of rows) if (r.lafposId !== null && !wanted.has(r.lafposId)) plan.remove.push(r.id);
  return plan;
}

/** LafPOS satırının metinleri (eylemlerin reddi, pencere ve kart) */
export const LAFPOS_CASH_OUT_TEXT = {
  /** Tutar, tür ya da gün değiştirilmek istendi */
  locked: "Bu satır LafPOS'un kasa hareketinden geldi: tutarı, türü ve günü LafPOS'tan gelir, burada değişmez. Fiş fotoğrafı, yer, belge ve kategori eklenebilir.",
  /** Silinmek istendi */
  delete: "LafPOS'tan gelen satır silinmez: gün yeniden gönderilince geri gelir. Hareket yanlışsa LafPOS'ta düzeltilip gün yeniden gönderilir.",
  /** Penceredeki kısa not ("LafPOS'tan geldi" başlığının altında) */
  hint: "Tutar, tür ve gün LafPOS'tan gelir, burada değişmez; fiş, yer, belge ve kategori buradan eklenir.",
} as const;

/**
 * LafPOS satırında yasak değişiklik: tutar (kuruşta), tür ya da gün değişiyorsa reddin metni, değilse null. Elle girilmiş
 * satırda (lafposId yok) hep null. Bütün yazım yolları (personelin ve yöneticinin eylemleri, onaylanan istek, tedarikçi
 * ödemesi) bundan geçer; LafPOS'un kendi eşitlemesi geçmez
 */
export function lafposCashOutChange(prev: { lafposId: string | null; kind: CashOutKind; amount: number; date: string }, next: { kind: CashOutKind; amount: number; date: string }): string | null {
  if (!prev.lafposId) return null;
  return prev.kind !== next.kind || !sameAmount(prev.amount, next.amount) || prev.date !== next.date ? LAFPOS_CASH_OUT_TEXT.locked : null;
}
