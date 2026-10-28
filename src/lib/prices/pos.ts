/**
 * Kasanın (ModPOS) fiyatı: panelde ya da sitede değişen fiyat ModPOS'a kendiliğinden geçmez, kasada elle değiştirilir.
 * Panel bunu ürün satırında tutar (products.pos_stale_price / pos_stale_since): kasada hâlâ duran eski fiyat ve
 * kasanın ne zamandan beri geride olduğu. "Fiyatlar › Kasaya işle" listesi bunlardan; işaretlenince boşalır, fiyat
 * kasadaki fiyata geri dönerse kendiliğinden boşalır. Saf modül; tests/fiyatlar.test.ts sınar (docs/FIYATLAR.md).
 *
 * LafPOS'a geçiş gününden itibaren (src/lib/lafpos/kasa.ts tillScope; denetim E-39) siteye bağlı ürünün fiyatını LafPOS
 * siteden kendisi alır: listede yalnız siteye bağlı olmayan ürünler görünür ve metinler `kasa` ile "LafPOS" der. Bağlı
 * olmayan ürün LafPOS'ta yerel olabilir (fiyatı orada elle değişir) ya da LafPOS onu siteden alıyor olabilir (LafPOS
 * siteden gelen ürünün fiyatını değiştirtmez: ürün panelde siteye bağlanmalı ya da fiyat sitede değişmeli); metinler
 * ikisini de söyler. LafPOS'ta ürün fiyatını yalnız menüyü yöneten (patron, müdür) değiştirir: bu iş personele düşmez
 * (posBell). `kasa` verilmezse (ya da "ModPOS") her metin bugünkü gibidir.
 */

import type { KasaName } from "../lafpos/kasa";
import { MONTH_NAMES } from "../constants";
import { money, num } from "../format";
import { daysBetween, todayTR } from "../reminders";
import { PRICE_PUSH_REMINDER } from "../site-menu/push";
import { toMinor } from "../site-menu/slot";

export interface PosState {
  /** Kasada duran eski fiyat; null = kasa panelle aynı */
  stalePrice: number | null;
  since: Date | null;
}

/**
 * Fiyat `before`'dan `after`'a değişince kasanın durumu. Kasa güncelse kasadaki fiyat `before`'dur; yeni fiyat
 * kasadakiyle aynıysa (kuruşuyla; ör. fiyat geri alındı) liste kendiliğinden boşalır, değilse kasadaki fiyat ve ilk
 * geri kalış anı korunur.
 */
export function posAfterPriceChange(state: PosState, before: number, after: number, now: Date): PosState {
  const posPrice = state.stalePrice ?? before;
  if (toMinor(after) === toMinor(posPrice)) return { stalePrice: null, since: null };
  return { stalePrice: posPrice, since: state.since ?? now };
}

/** Türkiye günüyle kaç gün önce (0 bugün, 1 dün) */
export function daysAgo(at: Date | string, now: Date = new Date()): number {
  return Math.max(0, daysBetween(todayTR(new Date(at)), todayTR(now)));
}

/** "Bugün", "Dün", "3 gün önce" */
export function agoLabel(at: Date | string, now: Date = new Date()): string {
  const d = daysAgo(at, now);
  return d === 0 ? "Bugün" : d === 1 ? "Dün" : `${num(d)} gün önce`;
}

/** Kasanın ne zamandan beri geride olduğu: "bugünden beri", "dünden beri", "3 gündür" */
export function staleForText(since: Date | string, now: Date = new Date()): string {
  const d = daysAgo(since, now);
  return d === 0 ? "bugünden beri" : d === 1 ? "dünden beri" : `${num(d)} gündür`;
}

/** Bağlı olmayan ürünün fiyatı değişince bildirimin açıklaması */
export const POS_PRICE_REMINDER = "Kasadaki (ModPOS) fiyatı da değiştir; Fiyatlar › Kasaya işle listesine eklendi.";

/**
 * LafPOS gününde bağlı olmayan ürün: LafPOS ürünü siteden alıyorsa fiyatı LafPOS'ta değişmez (ürünü bağlamak ya da
 * fiyatı sitede değiştirmek gerekir); LafPOS'ta yerel ürünse fiyatı orada elle değişir
 */
export const POS_PRICE_REMINDER_LAFPOS =
  "Ürün siteye bağlı değil: LafPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde bağlayın ya da fiyatı sitede değiştirin; LafPOS'ta yerel ürünse orada elle değiştirin. Fiyatlar › Kasaya işle listesine eklendi.";

/** Sitede de değişen fiyat kasadakine döndüyse yalnız fiyat listesinin tarihi kalır */
const SITE_DATE_REMINDER = "Fiyat sitede de değişti. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma.";

/** LafPOS gününde sitede değişen fiyat: LafPOS onu siteden alır, kasada yapılacak bir şey yok */
const SITE_DATE_REMINDER_LAFPOS = "Fiyat sitede de değişti; LafPOS yeni fiyatı siteden alır. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma.";

/**
 * Tek fiyat değişikliğinden sonra bildirimin açıklaması: fiyat sitede de değiştiyse fiyat listesinin tarihi (sitede elle)
 * ve kasa (PRICE_PUSH_REMINDER); yalnız panelde değiştiyse kasa. Kasada bekleyen bir şey kalmadıysa (fiyat kasadakine
 * döndü ya da hiç değişmedi) kasa yazılmaz. `kasa` bugünün kasası (eylemin yanıtında; verilmezse ModPOS): LafPOS
 * gününde siteye bağlı ürün kasa listesine girmez, LafPOS yeni fiyatı siteden alır.
 */
export function priceReminder(r: { site: boolean; posPending: boolean; kasa?: KasaName }): string | null {
  const lafpos = r.kasa === "LafPOS";
  if (r.site) return r.posPending ? PRICE_PUSH_REMINDER : lafpos ? SITE_DATE_REMINDER_LAFPOS : SITE_DATE_REMINDER;
  return r.posPending ? (lafpos ? POS_PRICE_REMINDER_LAFPOS : POS_PRICE_REMINDER) : null;
}

/**
 * Toplu değişiklikten ya da geri almasından sonra bildirimin kasa cümlesi; `applied` değişen (geri almada eski haline
 * dönen) ürünler. Biri kasada (ModPOS) değiştirilecek fiyat bıraktıysa ne yazılacağını liste söyler (geri almada
 * kasadaki fiyat bir önceki değişiklikten de kalmış olabilir). Kasa henüz değişmemişken geri alınan fiyat kasadakine
 * döner ve listeden düşer: o zaman bu fiyatlar için kasada bir şey yapılmayacağı söylenir (sahibi kasayı boşuna geri
 * çevirmesin). Cümle yalnız bu değişikliğin ürünlerini anlatır: listede başka ürünler bekliyor olabilir.
 */
export function batchPosNote(kind: "bulk" | "undo", applied: readonly { posPending: boolean; site?: boolean }[], kasa: KasaName = "ModPOS"): string | undefined {
  if (applied.some((a) => a.posPending)) {
    return kasa === "LafPOS"
      ? "Siteye bağlı olmayanlar Kasaya işle listesinde: LafPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde bağlayın ya da fiyatı sitede değiştirin; LafPOS'ta yerel ürünse orada elle değiştirin."
      : "Kasadaki (ModPOS) fiyatlar Kasaya işle listesinde.";
  }
  // LafPOS gününde siteye bağlı ürünün fiyatını LafPOS siteden alır: kasada yapılacak bir şey yok
  if (kasa === "LafPOS" && applied.some((a) => a.site)) return "LafPOS yeni fiyatları siteden alır; kasada bir şey yapmanız gerekmez.";
  if (kind !== "undo" || !applied.length) return undefined;
  return `${applied.length === 1 ? "Bu fiyat" : "Bu fiyatlar"} kasada (${kasa}) henüz değişmemişti; kasada bir şey yapmanız gerekmez.`;
}

/**
 * "Kasada değiştirdim" (markPosDone): kasada eski fiyatı duran satırlardan yalnız fiyatı hâlâ listede görülen fiyat
 * olanlar (kuruşuyla) işaretlenir. Liste açıldıktan sonra fiyatı yeniden değişen `changed`'e ayrılır: kasaya artık
 * eskimiş fiyat yazılmıştır, işaretlense panel kasayı güncel sanırdı. `seen`: ürün → görülen fiyat.
 */
export function splitPosDone<T extends { id: number; price: number }>(rows: readonly T[], seen: ReadonlyMap<number, number>): { done: T[]; changed: T[] } {
  const done: T[] = [];
  const changed: T[] = [];
  for (const r of rows) {
    const price = seen.get(r.id);
    if (price === undefined) continue;
    (toMinor(r.price) === toMinor(price) ? done : changed).push(r);
  }
  return { done, changed };
}

/**
 * Kasada işaretlenmek istenen ama fiyatı bu arada yeniden değiştiği için işaretlenmeyen ürünler (markPosDone'un
 * `changed`'i) için bildirim: ürün listede (ürün kartında uyarıda) bugünkü fiyatıyla kalır, kasaya o yazılmalı.
 */
export function posChangedText(changed: readonly { label: string; price: number }[]): { title: string; description: string } | null {
  if (!changed.length) return null;
  if (changed.length === 1) {
    return { title: `${changed[0].label} işaretlenmedi: fiyatı bu sırada ${money(changed[0].price)} oldu`, description: "Kasaya bu fiyatı yazıp yeniden işaretleyin." };
  }
  return {
    title: `${num(changed.length)} fiyat işaretlenmedi: bu sırada yeniden değişti`,
    description: "Listede yeni fiyatlarıyla duruyor; kasaya onları yazıp yeniden işaretleyin.",
  };
}

/** Kasaya işle listesinin bir satırı */
export interface PosItem {
  productId: number;
  name: string;
  size: string;
  category: string;
  /** Kategorinin ve ürünün menü sırası */
  categoryOrder: number;
  sortOrder: number;
  /** Satış raporunda eşleşmiş ModPOS adları (pos_mappings); bilinmiyorsa boş */
  posNames: string[];
  /** Kasada duran fiyat */
  stalePrice: number;
  /** Panelin (ve sitenin) fiyatı */
  price: number;
}

/** Kategoriye göre gruplar: kategoriler menü sırasıyla, içleri ürün sırasıyla */
export function groupByCategory<T extends Pick<PosItem, "category" | "categoryOrder" | "sortOrder" | "productId">>(items: readonly T[]): { category: string; items: T[] }[] {
  const sorted = [...items].sort(
    (a, b) => a.categoryOrder - b.categoryOrder || a.category.localeCompare(b.category, "tr") || a.sortOrder - b.sortOrder || a.productId - b.productId,
  );
  const groups: { category: string; items: T[] }[] = [];
  for (const it of sorted) {
    const last = groups.at(-1);
    if (last && last.category === it.category) last.items.push(it);
    else groups.push({ category: it.category, items: [it] });
  }
  return groups;
}

/** Fiyat kuruşluysa iki ondalıkla: "195", "259,90" */
const price = (v: number) => num(v, toMinor(v) % 100 ? 2 : 0, toMinor(v) % 100 ? 2 : 0);

/** Kasadaki ad (ModPOS'ta aranacak ad) ya da bilinmiyorsa panelin adı ve boyu: "LATTE MEDİUM", "Marlenka (Tek)" */
export const posLabel = (it: Pick<PosItem, "name" | "size" | "posNames">) => (it.posNames.length ? it.posNames.join(" / ") : `${it.name} (${it.size})`);

/**
 * Panoya kopyalanan düz metin (WhatsApp'a yapıştırılır):
 *
 *   Kasada (ModPOS) değişecek fiyatlar · 22 Ekim 2026
 *   Espresso Bazlı
 *   - LATTE MEDİUM: 195 → 205 ₺
 *
 * `date` Türkiye günü (YYYY-MM-DD); `kasa` bugünün kasası (LafPOS gününde başlık "Kasada (LafPOS)").
 */
export function posChecklistText(items: readonly PosItem[], date: string, kasa: KasaName = "ModPOS"): string {
  const [y, m, d] = date.split("-").map(Number);
  const lines = [`Kasada (${kasa}) değişecek fiyatlar · ${d} ${MONTH_NAMES[m - 1]} ${y}`];
  for (const g of groupByCategory(items)) {
    lines.push(g.category);
    for (const it of g.items) lines.push(`- ${posLabel(it)}: ${price(it.stalePrice)} → ${price(it.price)} ₺`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- İşaret kaydı ve geri alma (dalga 10 §2.2)

/** Personel kendi işaretini bu kadar süre geri alabilir; sonrası yöneticinin (Fiyatlar › Kasaya işle › Son işaretlenenler) */
export const POS_UNDO_WINDOW_MS = 30 * 60_000;

/** Bir seferde işaretlenebilen ürün: personel tek tek işaretler (390 px'te kazara toplu işaret olmasın), yönetici "Hepsini işaretle" */
export function posMarkMax(role: "admin" | "staff"): number {
  return role === "admin" ? 500 : 1;
}

/** Geri almanın ret metinleri (tutar yok) */
export const POS_UNDO_TEXT = {
  undone: "Bu işaret zaten geri alındı",
  notMine: "Bu işareti başkası yaptı; geri almak için yöneticiye yazın",
  late: "30 dakika geçti; geri almak için yöneticiye yazın",
  gone: "Ürün silinmiş",
  relisted: "Ürün kasaya işle listesine yeniden girdi; yeni fiyatı işaretleyin",
  reverted: "Fiyat kasadaki eski fiyata döndü; geri almaya gerek yok",
  notLatest: "Bu ürün sonra yeniden işaretlendi; son işareti geri alın",
} as const;

/** Kasaya işle işareti (pos_marks satırı; anlar Date ya da ISO) */
export interface PosMarkLite {
  id: number;
  markedBy: number | null;
  markedAt: Date | string;
  undoneAt: Date | string | null;
  /** Kasada işlenen fiyat */
  price: number;
  /** İşaretten önce kasada duran fiyat (geri almada ürüne yazılır) */
  stalePrice: number;
}

/**
 * İşaret geri alınabilir mi; alınamıyorsa nedeni. Sırayla: zaten geri alındı; personel yalnız kendi işaretini, 30
 * dakika içinde; ürün silinmiş; ürün listeye yeniden girdi (yeni fiyat); fiyat kasadaki eski fiyata döndü; işaret ürünün
 * son işareti değil ya da güncel fiyat işaretin fiyatı değil (M1 → fiyat değişti → M2: M1 geri alınırsa kasaya M2'nin
 * fiyatı yazılmış olduğu kaybolur). `latestMarkId`: ürünün en son işareti (geri alınmışlar dahil).
 */
export function posUndoRefusal(
  me: { role: "admin" | "staff"; meId: number; now: Date },
  mark: PosMarkLite,
  product: { price: number; posStalePrice: number | null } | null,
  latestMarkId: number | null,
): string | null {
  if (mark.undoneAt) return POS_UNDO_TEXT.undone;
  if (me.role !== "admin") {
    if (mark.markedBy !== me.meId) return POS_UNDO_TEXT.notMine;
    if (me.now.getTime() - new Date(mark.markedAt).getTime() >= POS_UNDO_WINDOW_MS) return POS_UNDO_TEXT.late;
  }
  if (!product) return POS_UNDO_TEXT.gone;
  if (product.posStalePrice !== null) return POS_UNDO_TEXT.relisted;
  if (toMinor(product.price) === toMinor(mark.stalePrice)) return POS_UNDO_TEXT.reverted;
  if (latestMarkId !== mark.id || toMinor(product.price) !== toMinor(mark.price)) return POS_UNDO_TEXT.notLatest;
  return null;
}

/** Personelin Kasadaki fiyatlar listesinin satırı: kaynak, değiştiren kişi ve not yok (StaffPosItem ≠ PosChecklistItem) */
export interface StaffPosItem extends PosItem {
  /** Kasanın geri kaldığı an (ISO) */
  since: string;
}

/** Personelin son 30 dakikada işaretledikleri ("Son işaretledikleriniz"; geri alınabilir) */
export interface MyPosMark {
  markId: number;
  productId: number;
  name: string;
  size: string;
  /** Kasada işlenen satış fiyatı */
  price: number;
  /** ISO */
  markedAt: string;
}

/** Kasada bekleyen fiyatların özeti (zil ve Bugün): sayı, en eski ve en yeni geri kalış */
export interface PosSummaryLite {
  count: number;
  oldest: Date | null;
  newest: Date | null;
}

/** Zilin kasaya işle satırı (src/server/bell/ops.ts PanelNotification'a olduğu gibi gider) */
export interface PosBellItem {
  id: string;
  kind: "info";
  title: string;
  body: string;
  timeLabel: string;
  unread: true;
  href: string;
  group: "kasa" | "uyari";
}

/**
 * Zil: kasada değişecek fiyatlar. Kimlik iki rolde en yeni geri kalıştan: bir fiyatın işaretlenmesi zili yeniden okunmamış
 * yapmaz, listeye yeni bir fiyat girmesi yapar. Personel Kasadaki fiyatlar'a (Kasa grubu), yönetici Fiyatlar › Kasaya
 * işle'ye (Uyarılar). Bekleyen yoksa satır yok. LafPOS gününde yalnız yöneticide: LafPOS'ta ürün fiyatını kasiyer
 * değiştiremez (menüyü yöneten değiştirir), personele görev düşmez.
 */
export function posBell(role: "admin" | "staff", p: PosSummaryLite, now: Date, kasa: KasaName = "ModPOS"): PosBellItem | null {
  if (!p.count) return null;
  if (role !== "admin" && kasa === "LafPOS") return null;
  const base = { id: `kasa-fiyat-${p.newest?.getTime() ?? 0}`, kind: "info" as const, title: `Kasada değişecek ${num(p.count)} fiyat`, timeLabel: p.oldest ? agoLabel(p.oldest, now) : "", unread: true as const };
  if (role !== "admin") return { ...base, body: "ModPOS'ta değiştirip Kasadaki fiyatlar'da işaretleyin", href: "/panel/kasa/fiyatlar", group: "kasa" };
  // LafPOS gününde listede yalnız siteye bağlı olmayan ürünler var: yerelse LafPOS'ta elle, siteden geliyorsa bağlanır
  const body =
    kasa === "LafPOS"
      ? "Siteye bağlı olmayan ürün: LafPOS'ta yerelse orada elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin; LafPOS ürünü siteden alıyorsa Ürünler › Site menüsü'nde bağlayın"
      : "ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin";
  return { ...base, body, href: "/panel/urunler/fiyatlar?sekme=kasa", group: "uyari" };
}

/**
 * Yöneticinin Bugün satırına personelin son 48 saatteki işaretleri: "Ayşe dün 3 fiyatı kasada işaretledi.", birden çok
 * kişide "Mehmet bugün 1 fiyatı, Ayşe dün 34 fiyatı kasada işaretledi." (verilen sırayla). Yoksa null.
 */
export function posMarksText(marks: readonly { by: string; count: number; at: string }[], now: Date): string | null {
  if (!marks.length) return null;
  return `${marks.map((m) => `${m.by} ${agoLabel(m.at, now).toLocaleLowerCase("tr-TR")} ${num(m.count)} fiyatı`).join(", ")} kasada işaretledi.`;
}

/** Personelin son işaretleri penceresi (Bugün'deki "son 48 saat") */
export const POS_MARKS_RECENT_MS = 48 * 60 * 60_000;

/** Yöneticinin "Son işaretlenenler" kartının satırı (Fiyatlar › Kasaya işle; loadRecentPosMarks) */
export interface RecentPosMark {
  markId: number;
  productId: number;
  name: string;
  size: string;
  /** Kasada işlenen satış fiyatı ve işaretten önce kasada duran */
  price: number;
  stalePrice: number;
  /** İşaretleyenin hesabı (gruplama) ve İşlem geçmişindeki gibi adı (logPerson: o anki ad, gerekirse e-postasıyla) */
  byId: number | null;
  by: string;
  /** ISO */
  markedAt: string;
  undoneAt: string | null;
  undoneBy: string | null;
  /** Yönetici geri alamıyorsa nedeni (posUndoRefusal); geri alınmışta null ("Geri alındı · Ali" yazılır) */
  refusal: string | null;
}

export interface PosMarkGroup {
  key: string;
  by: string;
  /** Türkiye günü (YYYY-MM-DD) ve "bugün", "dün", "3 gün önce" */
  day: string;
  dayLabel: string;
  marks: RecentPosMark[];
}

/** Son işaretlenenler kişi ve gün başına (Türkiye günü), en yeni önce: "Ayşe · dün · 34 fiyat" */
export function groupPosMarks(marks: readonly RecentPosMark[], now: Date): PosMarkGroup[] {
  const groups = new Map<string, PosMarkGroup>();
  const sorted = [...marks].sort((a, b) => b.markedAt.localeCompare(a.markedAt) || b.markId - a.markId);
  for (const m of sorted) {
    const day = todayTR(new Date(m.markedAt));
    const key = `${m.byId ?? m.by}|${day}`;
    const g = groups.get(key);
    if (g) g.marks.push(m);
    else groups.set(key, { key, by: m.by, day, dayLabel: agoLabel(m.markedAt, now).toLocaleLowerCase("tr-TR"), marks: [m] });
  }
  return [...groups.values()];
}
