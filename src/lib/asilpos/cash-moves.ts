import type { CashOutKind } from "@/lib/cash-outs";

import { KASA_YAZARI } from "./eski-adlar";

import type { PosCashMove } from "./day";

/**
 * AsilPOS'un kasa hareketleri → panelin "Kasadan çıkanlar"ı (Faz 3, 23 Kasım 2026; sahibin kararı: docs/ASILPOS.md "Soru
 * 5" yanıtlandı, docs/ASILPOS.md › Kasadan çıkanlar AsilPOS'tan). Saf kısım: gövdenin hareketleriyle günün satırlarının
 * planı ve AsilPOS satırının kilidi. Yazımı src/server/asilpos/cash-moves.ts yapar; testleri tests/kasa-zinciri.test.ts.
 *
 * - Harcama ve teslim satır olur (`cash_outs.asilpos_id` = hareketin kimliği, benzersiz); giriş satır olmaz (tablo kasadan
 *   çıkanı tutar; giren Kasa raporunda `cashIn`'dir).
 * - Aynı gün yeniden gönderilince aynı kimlikli satır güncellenir (yeni satır açılmaz).
 * - Panelde elle girilmiş eş satır (aynı gün ve şube, aynı tür, aynı tutar, AsilPOS'a bağlanmamış) bire bir sahiplenilir:
 *   en eskisi önce; fotoğrafı, yeri, belgesi, kategorisi ve tedarikçi bağı kalır. Böylece aynı para iki kez sayılmaz.
 * - Günün gövdede olmayan AsilPOS satırı kaldırılır; elle girilmiş satıra dokunulmaz.
 * - Gün sayılmaz olunca (geçiş günü sonraya alındı) ya da günün AsilPOS kaydı silinince satırlar AsilPOS'tan ayrılır
 *   (planAsilposDetach): kilitli satır kalıp silinemez olmasın.
 */

/**
 * Satırların ve harcama kayıtlarının "gönderen"i: sistem, kişi değil. Veritabanına eski adla yazılır (KASA_YAZARI; şema
 * src/server/db/schema.ts authorText çevirir), okunurken bu ad gelir
 */
export const ASILPOS_CASH_OUT_BY = "AsilPOS";

/** Gönderen AsilPOS mu: okunan yeni ad ya da ham eski ad (ad değişikliği; ikisi de) */
export const isAsilposCashOutBy = (name: string | null | undefined): boolean => name === ASILPOS_CASH_OUT_BY || name === KASA_YAZARI;

/**
 * AsilPOS'un kendi açtığı satır (sahiplenilen elle girilmiş satır değil): AsilPOS'a bağlı, gönderen "AsilPOS", açan kişi yok
 * (eşitleme satırı kişisiz yazar; düzeltme açanı değiştirmez)
 */
export function asilposInsertedRow(r: { asilposId: string | null; createdBy: number | null; createdByName: string }): boolean {
  return r.asilposId !== null && r.createdBy === null && isAsilposCashOutBy(r.createdByName);
}

/** Günün satırı (planın gördüğü alanlar) */
export interface AsilposCashOutRow {
  id: number;
  kind: CashOutKind;
  amount: number;
  asilposId: string | null;
  createdAt: Date;
}

export interface AsilposCashOutPlan {
  /** Yeni satır olacak hareketler (gövdedeki sırayla) */
  insert: PosCashMove[];
  /** Elle girilmiş satırın sahiplenilmesi (satıra hareketin kimliği yazılır) */
  adopt: { rowId: number; move: PosCashMove }[];
  /** Kimliği bilinen satırın AsilPOS alanı (tutar ya da tür) değişti */
  update: { rowId: number; move: PosCashMove }[];
  /** Gövdede olmayan AsilPOS satırları */
  remove: number[];
}

/** Tutarlar kuruşta aynı mı */
const sameAmount = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/** Teslimin "Kime"si (`cash_outs.store`) en çok bu kadar: panelin Kime alanının sınırı (cashOutSchema `store`) */
export const ASILPOS_RECIPIENT_MAX = 60;

/**
 * AsilPOS teslimin alıcısı → satırın "Kime"si (AsilPOS 25 Kasım 2026, `cashMoves[].recipient`; sahibin isteği "teslim
 * edilirken kime olduğu yazılsın"): yalnız teslimde; boşluklar teke iner, en çok 60 karakter. Alıcı yoksa ya da harcamada null
 */
export function asilposRecipient(m: PosCashMove): string | null {
  if (m.kind !== "teslim" || typeof m.recipient !== "string") return null;
  return m.recipient.replace(/\s+/g, " ").trim().slice(0, ASILPOS_RECIPIENT_MAX) || null;
}

/**
 * "Kime"si boş satırların doldurulması: sahiplenilen elle girilmiş teslim ve önceden yazılmış AsilPOS teslimi (alıcıyı
 * okumayan sürümün yazdığı ya da AsilPOS'un alıcısız gönderdiği gün sonradan alıcıyla geldi). Panelde yazılmış Kime'ye
 * dokunulmaz; tutarı ya da türü değişen satır (`skip`, plan.update) yeniden yazılırken doldurulur
 */
export function planAsilposRecipientFill(
  moves: readonly PosCashMove[],
  rows: readonly { id: number; asilposId: string | null; store: string | null }[],
  adopt: readonly { rowId: number; move: PosCashMove }[],
  skip: ReadonlySet<number> = new Set(),
): { rowId: number; store: string }[] {
  const byMove = new Map(moves.map((m) => [m.id, m]));
  const out = new Map<number, string>();
  const take = (row: { id: number; store: string | null } | undefined, m: PosCashMove | undefined) => {
    const to = m ? asilposRecipient(m) : null;
    if (row && to && !row.store?.trim() && !skip.has(row.id)) out.set(row.id, to);
  };
  const rowById = new Map(rows.map((r) => [r.id, r]));
  for (const a of adopt) take(rowById.get(a.rowId), a.move);
  for (const r of rows) if (r.asilposId !== null) take(r, byMove.get(r.asilposId));
  return [...out].map(([rowId, store]) => ({ rowId, store }));
}

/** Satır olan hareket: harcama ve teslim (giriş kasaya girendir, "Kasadan çıkanlar"a girmez) */
export const isCashOutMove = (m: PosCashMove): m is PosCashMove & { kind: CashOutKind } => m.kind === "harcama" || m.kind === "teslim";

export function planAsilposCashOuts(moves: readonly PosCashMove[], rows: readonly AsilposCashOutRow[]): AsilposCashOutPlan {
  const outs = moves.filter(isCashOutMove);
  const byId = new Map(rows.filter((r) => r.asilposId !== null).map((r) => [r.asilposId!, r]));
  const wanted = new Set(outs.map((m) => m.id));
  // Elle girilmiş satırlar, en eskisi önce (sahiplenme bire bir)
  const manual = rows.filter((r) => r.asilposId === null).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const taken = new Set<number>();
  const plan: AsilposCashOutPlan = { insert: [], adopt: [], update: [], remove: [] };
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
  for (const r of rows) if (r.asilposId !== null && !wanted.has(r.asilposId)) plan.remove.push(r.id);
  return plan;
}

/** Günün AsilPOS satırı (ayırmanın gördüğü alanlar); `paid`: bir tedarikçi ödemesine bağlı */
export interface AsilposDetachRow {
  id: number;
  asilposId: string | null;
  createdBy: number | null;
  createdByName: string;
  paid: boolean;
}

/**
 * Günün AsilPOS satırlarını AsilPOS'tan ayırmanın planı (inceleme LM-3; yazımı src/server/asilpos/cash-moves.ts):
 * - `drop`: gün artık sayılmıyor (geçiş günü sonraya alındı; deneme günü hiçbir şeyi beslemez). AsilPOS'un açtığı satır
 *   (harcama kaydıyla) kalkar; sahiplenilen elle girilmiş satır ve tedarikçi ödemesine bağlı satır kalır, bağı çözülür
 *   (elle girilmiş gibi: yönetici düzeltir ya da siler).
 * - `release`: sayılan günün AsilPOS kaydı silindi (409'un çözümü, yeni Z gelecek). Satırların hepsi kalır, bağları
 *   çözülür: yeni Z gelince elle girilmiş eş olarak yeniden sahiplenilir (panelin yazdığı fotoğraf, yer, kategori kalır).
 * Elle girilmiş satır (asilposId yok) planda yer almaz.
 */
export function planAsilposDetach(rows: readonly AsilposDetachRow[], mode: "drop" | "release"): { remove: number[]; release: number[] } {
  const plan = { remove: [] as number[], release: [] as number[] };
  for (const r of rows) {
    if (r.asilposId === null) continue;
    if (mode === "drop" && !r.paid && asilposInsertedRow(r)) plan.remove.push(r.id);
    else plan.release.push(r.id);
  }
  return plan;
}

/**
 * Kategorisini bekleyen AsilPOS harcaması (inceleme LM-3): AsilPOS'un açtığı, Aylık harcamalar kaydı olmayan ve AsilPOS'un
 * personelin seçebildiği bir kategoriyle göndermediği (kategorisiz ya da başka kategoriyle) harcama. AsilPOS böyle satırı
 * kayıtsız yazar (src/server/asilpos/cash-moves.ts); personel düzeltirken yeni satırın kuralı geçer, kategori seçince
 * kayıt açılır (cashOutWritesExpense `asilposAwaitingCategory`). Personelin kategorisiyle gelen harcamanın kaydı
 * eşitlemede açılmıştı: şimdi yoksa yönetici kaldırmıştır, geri gelmez. Sahiplenilen elle girilmiş satır kendi
 * kuralındadır (faturalı satırın faturası beklenmiyorsa kayıt açılmaz). `moveCategoryId`: saklı gövdedeki hareketin
 * kategorisi (hareket bulunamazsa undefined: beklemiyor sayılır)
 */
export function asilposAwaitingCategory(
  row: { asilposId: string | null; createdBy: number | null; createdByName: string; kind: CashOutKind; hasExpense: boolean },
  moveCategoryId: number | null | undefined,
  staffUsable: (id: number) => boolean,
): boolean {
  if (!asilposInsertedRow(row) || row.kind !== "harcama" || row.hasExpense || moveCategoryId === undefined) return false;
  return moveCategoryId === null || !staffUsable(moveCategoryId);
}

/** AsilPOS satırının metinleri (eylemlerin reddi, pencere ve kart) */
export const ASILPOS_CASH_OUT_TEXT = {
  /** Tutar, tür ya da gün değiştirilmek istendi */
  locked: "Bu satır AsilPOS'un kasa hareketinden geldi: tutarı, türü ve günü AsilPOS'tan gelir, burada değişmez. Fiş fotoğrafı, yer, belge ve kategori eklenebilir.",
  /** Silinmek istendi */
  delete:
    "AsilPOS'tan gelen satır silinmez: gün yeniden gönderilince geri gelir. Hareket yanlışsa AsilPOS'ta düzeltilip gün yeniden gönderilir; deneme günüyse Ayarlar › AsilPOS'ta günün kaydı silinince satır da kalkar.",
  /** Penceredeki kısa not ("AsilPOS'tan geldi" başlığının altında) */
  hint: "Tutar, tür ve gün AsilPOS'tan gelir, burada değişmez; fiş, yer, belge ve kategori buradan eklenir.",
  /** Personel AsilPOS gününe satır eklemek istedi (staffAsilposEntryClosed; kapı: src/server/cash-outs/guard.ts) */
  staffAdd:
    "AsilPOS günü: kasadan çıkan para AsilPOS'ta kasa hareketi olarak girilir, gün sonuyla buraya kendiliğinden gelir. Gelen satıra fiş fotoğrafını ve kategoriyi buradan eklersiniz.",
} as const;

/** AsilPOS gününde personelin Kasa sayfasında ekleme düğmelerinin yerindeki kısa satır (kasadan çıkanlar ve zayi / ikram kartı) */
export const ASILPOS_STAFF_ENTRY_LINE = "AsilPOS günü: harcama ve ikram/zayi AsilPOS'tan girilir";

/**
 * Personel Kasa sayfasından kasadan çıkan ve ikram / zayi ekleyemez mi (sahibin kararı, 24 Kasım 2026: "sadece gün sonu
 * ladmin'e personel foto atsın"): şubenin kendi AsilPOS günü (şubenin geçiş gününden itibaren; staffBeforeAsilposDayEnd'in
 * kuralı). Kasadan çıkanlar AsilPOS'un kasa hareketlerinden (cashMoves → cash_outs), ürün ikramı, zayisi ve
 * hazırlanmış iptal gün sonunun gövdesinden gelir. Yönetici her zaman ekler; personel AsilPOS'un satırına fiş fotoğrafı ve
 * kategori ekler. Sunucu: personelin ekleme yolu (doğrudan, istek, başka güne taşıma) staffCashOutGate'te reddedilir.
 * ModPOS'ta kalan şube ve geçiş gününden önceki gün eskisi gibi; Zayi & ikram sayfasının hammadde yolu değişmez.
 * `asilposDay`: günün, kasanın kendi şubesinin sayılan AsilPOS günü olup olmadığı (şubenin geçiş günüyle; src/lib/pos/tills.ts
 * isCountedPosDay). Kasası ModPOS olan şubede hiçbir gün değildir (çok şube, 27 Kasım 2026)
 */
export function staffAsilposEntryClosed(o: { admin: boolean; asilposDay: boolean }): boolean {
  return !o.admin && o.asilposDay;
}

/**
 * AsilPOS satırında yasak değişiklik: tutar (kuruşta), tür ya da gün değişiyorsa reddin metni, değilse null. Elle girilmiş
 * satırda (asilposId yok) hep null. Bütün yazım yolları (personelin ve yöneticinin eylemleri, onaylanan istek, tedarikçi
 * ödemesi) bundan geçer; AsilPOS'un kendi eşitlemesi geçmez
 */
export function asilposCashOutChange(prev: { asilposId: string | null; kind: CashOutKind; amount: number; date: string }, next: { kind: CashOutKind; amount: number; date: string }): string | null {
  if (!prev.asilposId) return null;
  return prev.kind !== next.kind || !sameAmount(prev.amount, next.amount) || prev.date !== next.date ? ASILPOS_CASH_OUT_TEXT.locked : null;
}
