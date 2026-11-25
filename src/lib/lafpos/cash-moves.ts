import type { CashOutKind } from "@/lib/cash-outs";

import type { PosCashMove } from "./day";
import { LAFPOS_BRANCH_ID } from "./switch";

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
 * - Gün sayılmaz olunca (geçiş günü sonraya alındı) ya da günün LafPOS kaydı silinince satırlar LafPOS'tan ayrılır
 *   (planLafposDetach): kilitli satır kalıp silinemez olmasın.
 */

/** Satırların ve harcama kayıtlarının "gönderen"i: sistem, kişi değil */
export const LAFPOS_CASH_OUT_BY = "LafPOS";

/**
 * LafPOS'un kendi açtığı satır (sahiplenilen elle girilmiş satır değil): LafPOS'a bağlı, gönderen "LafPOS", açan kişi yok
 * (eşitleme satırı kişisiz yazar; düzeltme açanı değiştirmez)
 */
export function lafposInsertedRow(r: { lafposId: string | null; createdBy: number | null; createdByName: string }): boolean {
  return r.lafposId !== null && r.createdBy === null && r.createdByName === LAFPOS_CASH_OUT_BY;
}

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

/** Teslimin "Kime"si (`cash_outs.store`) en çok bu kadar: panelin Kime alanının sınırı (cashOutSchema `store`) */
export const LAFPOS_RECIPIENT_MAX = 60;

/**
 * LafPOS teslimin alıcısı → satırın "Kime"si (LafPOS 25 Kasım 2026, `cashMoves[].recipient`; sahibin isteği "teslim
 * edilirken kime olduğu yazılsın"): yalnız teslimde; boşluklar teke iner, en çok 60 karakter. Alıcı yoksa ya da harcamada null
 */
export function lafposRecipient(m: PosCashMove): string | null {
  if (m.kind !== "teslim" || typeof m.recipient !== "string") return null;
  return m.recipient.replace(/\s+/g, " ").trim().slice(0, LAFPOS_RECIPIENT_MAX) || null;
}

/**
 * "Kime"si boş satırların doldurulması: sahiplenilen elle girilmiş teslim ve önceden yazılmış LafPOS teslimi (alıcıyı
 * okumayan sürümün yazdığı ya da LafPOS'un alıcısız gönderdiği gün sonradan alıcıyla geldi). Panelde yazılmış Kime'ye
 * dokunulmaz; tutarı ya da türü değişen satır (`skip`, plan.update) yeniden yazılırken doldurulur
 */
export function planLafposRecipientFill(
  moves: readonly PosCashMove[],
  rows: readonly { id: number; lafposId: string | null; store: string | null }[],
  adopt: readonly { rowId: number; move: PosCashMove }[],
  skip: ReadonlySet<number> = new Set(),
): { rowId: number; store: string }[] {
  const byMove = new Map(moves.map((m) => [m.id, m]));
  const out = new Map<number, string>();
  const take = (row: { id: number; store: string | null } | undefined, m: PosCashMove | undefined) => {
    const to = m ? lafposRecipient(m) : null;
    if (row && to && !row.store?.trim() && !skip.has(row.id)) out.set(row.id, to);
  };
  const rowById = new Map(rows.map((r) => [r.id, r]));
  for (const a of adopt) take(rowById.get(a.rowId), a.move);
  for (const r of rows) if (r.lafposId !== null) take(r, byMove.get(r.lafposId));
  return [...out].map(([rowId, store]) => ({ rowId, store }));
}

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

/** Günün LafPOS satırı (ayırmanın gördüğü alanlar); `paid`: bir tedarikçi ödemesine bağlı */
export interface LafposDetachRow {
  id: number;
  lafposId: string | null;
  createdBy: number | null;
  createdByName: string;
  paid: boolean;
}

/**
 * Günün LafPOS satırlarını LafPOS'tan ayırmanın planı (inceleme LM-3; yazımı src/server/lafpos/cash-moves.ts):
 * - `drop`: gün artık sayılmıyor (geçiş günü sonraya alındı; deneme günü hiçbir şeyi beslemez). LafPOS'un açtığı satır
 *   (harcama kaydıyla) kalkar; sahiplenilen elle girilmiş satır ve tedarikçi ödemesine bağlı satır kalır, bağı çözülür
 *   (elle girilmiş gibi: yönetici düzeltir ya da siler).
 * - `release`: sayılan günün LafPOS kaydı silindi (409'un çözümü, yeni Z gelecek). Satırların hepsi kalır, bağları
 *   çözülür: yeni Z gelince elle girilmiş eş olarak yeniden sahiplenilir (panelin yazdığı fotoğraf, yer, kategori kalır).
 * Elle girilmiş satır (lafposId yok) planda yer almaz.
 */
export function planLafposDetach(rows: readonly LafposDetachRow[], mode: "drop" | "release"): { remove: number[]; release: number[] } {
  const plan = { remove: [] as number[], release: [] as number[] };
  for (const r of rows) {
    if (r.lafposId === null) continue;
    if (mode === "drop" && !r.paid && lafposInsertedRow(r)) plan.remove.push(r.id);
    else plan.release.push(r.id);
  }
  return plan;
}

/**
 * Kategorisini bekleyen LafPOS harcaması (inceleme LM-3): LafPOS'un açtığı, Aylık harcamalar kaydı olmayan ve LafPOS'un
 * personelin seçebildiği bir kategoriyle göndermediği (kategorisiz ya da başka kategoriyle) harcama. LafPOS böyle satırı
 * kayıtsız yazar (src/server/lafpos/cash-moves.ts); personel düzeltirken yeni satırın kuralı geçer, kategori seçince
 * kayıt açılır (cashOutWritesExpense `lafposAwaitingCategory`). Personelin kategorisiyle gelen harcamanın kaydı
 * eşitlemede açılmıştı: şimdi yoksa yönetici kaldırmıştır, geri gelmez. Sahiplenilen elle girilmiş satır kendi
 * kuralındadır (faturalı satırın faturası beklenmiyorsa kayıt açılmaz). `moveCategoryId`: saklı gövdedeki hareketin
 * kategorisi (hareket bulunamazsa undefined: beklemiyor sayılır)
 */
export function lafposAwaitingCategory(
  row: { lafposId: string | null; createdBy: number | null; createdByName: string; kind: CashOutKind; hasExpense: boolean },
  moveCategoryId: number | null | undefined,
  staffUsable: (id: number) => boolean,
): boolean {
  if (!lafposInsertedRow(row) || row.kind !== "harcama" || row.hasExpense || moveCategoryId === undefined) return false;
  return moveCategoryId === null || !staffUsable(moveCategoryId);
}

/** LafPOS satırının metinleri (eylemlerin reddi, pencere ve kart) */
export const LAFPOS_CASH_OUT_TEXT = {
  /** Tutar, tür ya da gün değiştirilmek istendi */
  locked: "Bu satır LafPOS'un kasa hareketinden geldi: tutarı, türü ve günü LafPOS'tan gelir, burada değişmez. Fiş fotoğrafı, yer, belge ve kategori eklenebilir.",
  /** Silinmek istendi */
  delete:
    "LafPOS'tan gelen satır silinmez: gün yeniden gönderilince geri gelir. Hareket yanlışsa LafPOS'ta düzeltilip gün yeniden gönderilir; deneme günüyse Ayarlar › LafPOS'ta günün kaydı silinince satır da kalkar.",
  /** Penceredeki kısa not ("LafPOS'tan geldi" başlığının altında) */
  hint: "Tutar, tür ve gün LafPOS'tan gelir, burada değişmez; fiş, yer, belge ve kategori buradan eklenir.",
  /** Personel LafPOS gününe satır eklemek istedi (staffLafposEntryClosed; kapı: src/server/cash-outs/guard.ts) */
  staffAdd:
    "LafPOS günü: kasadan çıkan para LafPOS'ta kasa hareketi olarak girilir, gün sonuyla buraya kendiliğinden gelir. Gelen satıra fiş fotoğrafını ve kategoriyi buradan eklersiniz.",
} as const;

/** LafPOS gününde personelin Kasa sayfasında ekleme düğmelerinin yerindeki kısa satır (kasadan çıkanlar ve zayi / ikram kartı) */
export const LAFPOS_STAFF_ENTRY_LINE = "LafPOS günü: harcama ve ikram/zayi LafPOS'tan girilir";

/**
 * Personel Kasa sayfasından kasadan çıkan ve ikram / zayi ekleyemez mi (sahibin kararı, 24 Kasım 2026: "sadece gün sonu
 * ladmin'e personel foto atsın"): LafPOS'un şubesinde LafPOS günü (geçiş gününden itibaren; staffBeforeLafposDayEnd'in
 * şube ve gün kuralı). Kasadan çıkanlar LafPOS'un kasa hareketlerinden (cashMoves → cash_outs), ürün ikramı, zayisi ve
 * hazırlanmış iptal gün sonunun gövdesinden gelir. Yönetici her zaman ekler; personel LafPOS'un satırına fiş fotoğrafı ve
 * kategori ekler. Sunucu: personelin ekleme yolu (doğrudan, istek, başka güne taşıma) staffCashOutGate'te reddedilir.
 * ModPOS'ta kalan şube ve geçiş gününden önceki gün eskisi gibi; Zayi & ikram sayfasının hammadde yolu değişmez.
 * `lafposBranch`: LafPOS'un şubesi (sunucu lafposBranchId ile verir; yoksa LAFPOS_BRANCH_ID)
 */
export function staffLafposEntryClosed(o: { admin: boolean; branchId: string | null | undefined; lafposDay: boolean; lafposBranch?: string }): boolean {
  return !o.admin && o.branchId === (o.lafposBranch ?? LAFPOS_BRANCH_ID) && o.lafposDay;
}

/**
 * LafPOS satırında yasak değişiklik: tutar (kuruşta), tür ya da gün değişiyorsa reddin metni, değilse null. Elle girilmiş
 * satırda (lafposId yok) hep null. Bütün yazım yolları (personelin ve yöneticinin eylemleri, onaylanan istek, tedarikçi
 * ödemesi) bundan geçer; LafPOS'un kendi eşitlemesi geçmez
 */
export function lafposCashOutChange(prev: { lafposId: string | null; kind: CashOutKind; amount: number; date: string }, next: { kind: CashOutKind; amount: number; date: string }): string | null {
  if (!prev.lafposId) return null;
  return prev.kind !== next.kind || !sameAmount(prev.amount, next.amount) || prev.date !== next.date ? LAFPOS_CASH_OUT_TEXT.locked : null;
}
