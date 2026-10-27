import { money } from "@/lib/format";
import { dayAblativeTR } from "@/lib/reminders";

import { isLafposDay } from "./switch";

/**
 * LafPOS'un ikramları (denetim E-38; docs/LAFPOS.md › İkram, docs/ZAYI-IKRAM.md). Saf: veri kümesi, Zayi & ikram,
 * zayi eylemleri ve kasa e-postası aynı kuralı okur (tests/lafpos-ikram.test.ts).
 *
 * Kural (her gün tek kaynak): geçiş gününden itibaren ürün ikramı kasada, LafPOS'ta işaretlenir. LafPOS'un gün sonu
 * gelen günde o günün ikram satırları (ikram[]) Tutarlılık'ın kayıtlı tüketimine ve Zayi'nin özetine girer; panelde
 * o güne girilmiş ürün ikramı sayılmaz (listede "sayılmıyor" der, silinmez). Hammadde ikramı (ör. personele süt) ve
 * zayi panelde kalır. Geçiş günü boşken hiçbiri çalışmaz: LafPOS'un ikramı hiçbir hesaba ve ekrana girmez.
 */

/** LafPOS'un bir ikram satırı (pos_day_reports.ikram), panel ürünüyle çözülmüş */
export interface LafposIkramLine {
  date: string;
  /** LafPOS'taki ad (POS adı) */
  posName: string;
  /** Panel ürünü (sitenin kalemi ve boyu, sonra POS adı eşleştirmesi); bulunamazsa null: tüketime girmez */
  productId: number | null;
  qty: number;
  /** Menü fiyatıyla değeri, KDV dahil (LafPOS'un hesabı) */
  menuValue: number;
  /** LafPOS'ta yazılan neden (serbest metin; yalnız yöneticiye) */
  reason: string | null;
}

/**
 * Veri kümesinin LafPOS ikramı (Dataset.lafposIkram): geçiş günü, gün sonu gelen günler (geçiş gününden itibaren; o
 * günlerde paneldeki ürün ikramı sayılmaz) ve ikram satırları. Geçiş günü yoksa veri kümesinde hiç yoktur.
 */
export interface LafposIkramData {
  switchDay: string;
  days: string[];
  lines: LafposIkramLine[];
}

/**
 * Paneldeki kayıt hesaba girer mi: LafPOS'un gün sonu gelen günde (geçiş gününden itibaren) ürün ikramı girmez,
 * LafPOS'taki sayılır. Zayi ve hammadde ikramı her zaman girer.
 */
export function panelWasteCounts(w: { date: string; kind: "zayi" | "ikram"; productId: number | null }, lafposDays: ReadonlySet<string>): boolean {
  return !(w.kind === "ikram" && w.productId !== null && lafposDays.has(w.date));
}

/** Zayi & ikram'ın metinleri (ekran, eylemlerin reddi, kasa e-postası) */
export const LAFPOS_IKRAM_TEXT = {
  /** Paneldeki ürün ikramının rozeti, LafPOS'un gün sonu geldiyse */
  notCounted: "Sayılmıyor: LafPOS'taki ikram sayılıyor",
  /** LafPOS'un ikram listesinin başlığı */
  listTitle: "LafPOS'ta işaretlenen ikram",
  /** Bu gün LafPOS'ta ikram yok */
  none: "LafPOS'ta bu gün ikram işaretlenmedi.",
  /** LafPOS günü, gün sonu henüz gelmedi */
  waiting: "LafPOS'un bu günün sonu gelmedi; ikramlar gün sonuyla gelir.",
  /** Ürünü bulunamayan satır */
  unmatched: "ürüne bağlı değil: tüketime girmez",
} as const;

/** "Ürün ikramı 10 Kasım'dan beri LafPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir." */
export function productIkramNote(switchDay: string): string {
  return `Ürün ikramı ${dayAblativeTR(switchDay)} beri LafPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir.`;
}

/**
 * Yeni kaydın reddi (zayi eylemleri, geç kayıt isteği ve onayı): LafPOS gününde (geçiş günü seçili ve gün ondan önce
 * değil) ürün ikramı panele girilmez, LafPOS'ta işaretlenir; değilse null
 */
export function productIkramRefusal(w: { date: string; kind: "zayi" | "ikram"; productId: number | null }, switchDay: string | null): string | null {
  if (w.kind !== "ikram" || w.productId === null || !isLafposDay(w.date, switchDay)) return null;
  return `Ürün ikramı ${dayAblativeTR(switchDay!)} beri LafPOS'ta işaretlenir, panele girilmez. Burada hammadde ikramı ve zayi girilir.`;
}

/**
 * Kasa e-postasının ikram denetimi LafPOS gününde (yalnız yönetici): LafPOS'un Z'sindeki ödenmez tutarı ile aynı
 * günün ikram listesinin menü değeri. LafPOS ikisini aynı adisyonlardan hesaplar (eski LafPOS iptal edilen adisyonun
 * ikramını da listeye yazıyordu); fark varsa bilgi satırı, yoksa null.
 */
export function lafposIkramCheck(offRevenue: number, ikramValue: number): string | null {
  const diff = Math.round((offRevenue - ikramValue) * 100) / 100;
  if (Math.abs(diff) < 1) return null;
  return `LafPOS'un ödenmez tutarı (Z) ikram listesinden ${money(Math.abs(diff))} ${diff > 0 ? "fazla" : "az"}: LafPOS'ta ödenmez işaretlenen ama ikram listesine girmeyen (ya da iptal edilen adisyonda kalan) satır olabilir.`;
}
