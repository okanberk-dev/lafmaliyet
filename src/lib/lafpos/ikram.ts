import { posMatchKey } from "@/lib/calc/pos-paste";
import { money } from "@/lib/format";
import { dayAblativeTR } from "@/lib/reminders";

import { isLafposBranch, isLafposDay } from "./switch";

/**
 * LafPOS'un ikramları (denetim E-38; docs/LAFPOS.md › İkram, docs/ZAYI-IKRAM.md). Saf: veri kümesi, Zayi & ikram,
 * zayi eylemleri ve kasa e-postası aynı kuralı okur (tests/lafpos-ikram.test.ts).
 *
 * Kural (her gün tek kaynak): geçiş gününden itibaren ürün ikramı kasada, LafPOS'ta işaretlenir. LafPOS'un gün sonu
 * gelen günde o günün ikram satırları (ikram[]) Tutarlılık'ın kayıtlı tüketimine ve Zayi'nin özetine girer; panelde
 * o güne girilmiş ürün ikramı sayılmaz (listede "sayılmıyor" der, silinmez). Hammadde ikramı (ör. personele süt) ve
 * zayi panelde kalır. Geçiş günü boşken hiçbiri çalışmaz: LafPOS'un ikramı hiçbir hesaba ve ekrana girmez.
 *
 * LafPOS'un listesinde zayi de var: kasada "Zayi yaz" denen kalem aynı listede, nedeni "Zayi: " ile başlar (LafPOS
 * shared/comp.ts compReasonText, docs/03-ENTEGRASYON.md §4). O satır zayi sayılır, ikram değil; "Ödenmez: " (personel
 * yemeği, patron hesabı) ikramdır. Paneldeki zayi her zaman sayılır: aynı gün aynı ürün LafPOS'ta da zayi yazıldıysa
 * gün listesinde "LafPOS'ta da zayi" uyarısı çıkar (sahibin sorusu: ürün zayisi de yalnız LafPOS'tan mı gelsin).
 */

/** LafPOS'un bir ikram satırı (pos_day_reports.ikram), panel ürünüyle çözülmüş */
export interface LafposIkramLine {
  date: string;
  /** Nedeni "Zayi: " ile başlayan satır zayidir (lafposLineKind); öteki her satır (ödenmez dahil) ikram */
  kind: "zayi" | "ikram";
  /** LafPOS'taki ad (POS adı) */
  posName: string;
  /** Panel ürünü (sitenin kalemi ve boyu, sonra POS adı eşleştirmesi); bulunamazsa null: tüketime girmez */
  productId: number | null;
  /** POS adı HİZMET'e bağlı (karaoke odası gibi): ürünü yoktur, tüketime girmez ve "bağlanamayan" sayılmaz */
  isService?: boolean;
  qty: number;
  /** Menü fiyatıyla değeri, KDV dahil (LafPOS'un hesabı) */
  menuValue: number;
  /** LafPOS'ta yazılan neden (serbest metin; yalnız yöneticiye); zayide "Zayi: " ön eki atılmış */
  reason: string | null;
}

/**
 * LafPOS satırının türü nedeninin ön ekinden: "Zayi: Döküldü" → zayi, neden "Döküldü"; "Ödenmez: Personel yemeği" ve
 * öteki her neden ikram (neden olduğu gibi). Sözleşmede tür alanı yok, ön ek LafPOS'un compReasonText'i.
 */
export function lafposLineKind(reason: string | null): { kind: "zayi" | "ikram"; reason: string | null } {
  const m = reason?.match(/^zayi\s*:\s*/i);
  if (!m || !reason) return { kind: "ikram", reason };
  return { kind: "zayi", reason: reason.slice(m[0].length).trim() || null };
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
 * LafPOS'taki sayılır. Zayi ve hammadde ikramı her zaman girer. `lafposDays` LafPOS'un şubesinin gün sonu gelen
 * günleridir: kayıt yalnız o şubenin kasasınınsa düşer, ModPOS'ta kalan şubenin aynı günkü ürün ikramı sayılır
 * (denetim 21 Kasım #5). Şubesi verilmeyen kayıt Tuzla'nındır.
 */
export function panelWasteCounts(w: { date: string; kind: "zayi" | "ikram"; productId: number | null; branchId?: string | null }, lafposDays: ReadonlySet<string>): boolean {
  return !(w.kind === "ikram" && w.productId !== null && isLafposBranch(w.branchId) && lafposDays.has(w.date));
}

/** Zayi & ikram'ın metinleri (ekran, eylemlerin reddi, kasa e-postası) */
export const LAFPOS_IKRAM_TEXT = {
  /** Paneldeki ürün ikramının rozeti, LafPOS'un gün sonu geldiyse */
  notCounted: "Sayılmıyor: LafPOS'taki ikram sayılıyor",
  /** LafPOS'un ikram listesinin başlığı (listede zayi satırları da var) */
  listTitle: "LafPOS'ta işaretlenen ikram ve zayi",
  /** Bu gün LafPOS'ta ikram ya da zayi yok */
  none: "LafPOS'ta bu gün ikram ya da zayi işaretlenmedi.",
  /** LafPOS günü (bugün), gün sonu henüz gelmedi */
  waiting: "LafPOS'un bu günün sonu gelmedi; ikram ve zayi gün sonuyla gelir.",
  /** Ürünü bulunamayan satır (yönetici; Ayarlar › LafPOS'ta bağlanır) */
  unmatched: "ürüne bağlı değil: tüketime girmez",
  /** HİZMET'e bağlı satır (karaoke odası gibi): tüketime girmez, bağlanacak bir şey yok */
  service: "hizmet: tüketime girmez",
  /** Paneldeki ürün zayisinin rozeti: aynı gün aynı ürün LafPOS'ta da zayi yazıldı (ikisi de sayılır) */
  maybeTwice: "LafPOS'ta da zayi yazıldı: aynı zayiyse bu kayıt silinmeli",
  /** LafPOS gününde Zayi formunun notu (ürün zayisi iki yerden girilmesin) */
  zayiNote: "Kasada LafPOS'ta “Zayi yaz” ile işaretlenen ürün gün sonuyla buraya gelir; panele ayrıca girmeyin.",
  /** Gün sonu gelmeyen geçmiş LafPOS günü: ürün ikramı panelden girilebilir */
  waitingPast: "LafPOS'un bu günün sonu gelmedi. Ürün ikramı bu güne panelden girilebilir; gün sonu sonradan gelirse LafPOS'taki sayılır.",
} as const;

/** "Ürün ikramı 10 Kasım'dan beri LafPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir." */
export function productIkramNote(switchDay: string): string {
  return `Ürün ikramı ${dayAblativeTR(switchDay)} beri LafPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir.`;
}

/**
 * Ürün ikramı bu güne panelden kapalı mı (yazma kuralı, okuma kuralıyla aynı: panelWasteCounts). LafPOS gününde gün
 * sonu geldiyse ya da gün bugünse (gün sonu bekleniyor) kapalı: LafPOS'ta işaretlenir. Gün sonu gelmeyen geçmiş LafPOS
 * gününde (kasa bilgisayarı bozuldu, gün hiç gönderilmedi) açık: o gün panelin ürün ikramı sayılır, gün sonu sonradan
 * gelirse LafPOS'unki. Geçiş günü boşken ya da gün ondan önceyse açık (bugünkü gibi).
 */
export function productIkramClosed(date: string, switchDay: string | null, day: { received: boolean; today: string }): boolean {
  return isLafposDay(date, switchDay) && (day.received || date >= day.today);
}

/**
 * Yeni kaydın reddi (zayi eylemleri, geç kayıt isteği ve onayı): ürün ikramı o güne panelden kapalıysa
 * (productIkramClosed) metin, değilse null. `where`: Zayi & ikram'da "Burada …", onayda kaydın nereye girildiği.
 */
export function productIkramRefusal(
  w: { date: string; kind: "zayi" | "ikram"; productId: number | null },
  switchDay: string | null,
  day: { received: boolean; today: string },
  where: "zayi" | "onay" = "zayi",
): string | null {
  if (w.kind !== "ikram" || w.productId === null || !productIkramClosed(w.date, switchDay, day)) return null;
  const rest = where === "zayi" ? "Burada hammadde ikramı ve zayi girilir." : "Hammadde ikramı ve zayi Zayi & ikram'da girilir.";
  return `Ürün ikramı ${dayAblativeTR(switchDay!)} beri LafPOS'ta işaretlenir, panele girilmez. ${rest}`;
}

/**
 * Kasa e-postasının ikram denetimi LafPOS gününde (yalnız yönetici): LafPOS'un Z'sindeki ödenmez tutarı ile aynı
 * günün ikram listesinin (ikram, ödenmez ve zayi satırları; LafPOS'ta ödenmez tutarı üçünü de kapsar) menü değeri.
 * LafPOS ikisini aynı adisyonlardan hesaplar; fark varsa bilgi satırı, yoksa null. Z büyükse listeye girmeyen ödenmez
 * satır, küçükse listede kalmış iptal edilen adisyonun ikramı (eski LafPOS onu da yazıyordu) açıklar.
 */
export function lafposIkramCheck(offRevenue: number, listValue: number): string | null {
  const diff = Math.round((offRevenue - listValue) * 100) / 100;
  if (Math.abs(diff) < 1) return null;
  const head = `LafPOS'un ödenmez tutarı (Z) ikram ve zayi listesinden ${money(Math.abs(diff))}`;
  return diff > 0
    ? `${head} fazla: LafPOS'ta ödenmez işaretlenen ama listeye girmeyen satır olabilir.`
    : `${head} az: iptal edilen adisyonun ikramı listede kalmış olabilir.`;
}

/**
 * İkramın ürüne bağlanamayan adları, satış listesinde gösterilenler ve HİZMET'e bağlı adlar hariç (en çok adet önce,
 * sonra ad)
 */
export function unmatchedIkramNames(
  lines: readonly { date: string; posName: string; productId: number | null; isService?: boolean; qty: number }[],
  shown: readonly string[],
  limit = 10,
): { items: { posName: string; qty: number; days: number }[]; count: number } {
  const skip = new Set(shown.map(posMatchKey));
  const byKey = new Map<string, { posName: string; qty: number; days: Set<string> }>();
  for (const l of lines) {
    const key = posMatchKey(l.posName);
    if (l.productId !== null || l.isService || skip.has(key)) continue;
    const cur = byKey.get(key) ?? { posName: l.posName.replace(/\s+/g, " ").trim(), qty: 0, days: new Set<string>() };
    cur.qty += l.qty;
    cur.days.add(l.date);
    byKey.set(key, cur);
  }
  const all = [...byKey.values()].map((x) => ({ posName: x.posName, qty: x.qty, days: x.days.size })).sort((a, b) => b.qty - a.qty || a.posName.localeCompare(b.posName, "tr"));
  return { items: all.slice(0, limit), count: all.length };
}
