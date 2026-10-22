/**
 * Kasanın (ModPOS) fiyatı: panelde ya da sitede değişen fiyat ModPOS'a kendiliğinden geçmez, kasada elle değiştirilir.
 * Panel bunu ürün satırında tutar (products.pos_stale_price / pos_stale_since): kasada hâlâ duran eski fiyat ve
 * kasanın ne zamandan beri geride olduğu. "Fiyatlar › Kasaya işle" listesi bunlardan; işaretlenince boşalır, fiyat
 * kasadaki fiyata geri dönerse kendiliğinden boşalır. Saf modül; tests/fiyatlar.test.ts sınar (docs/FIYATLAR.md).
 */

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

/** Sitede de değişen fiyat kasadakine döndüyse yalnız fiyat listesinin tarihi kalır */
const SITE_DATE_REMINDER = "Fiyat sitede de değişti. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma.";

/**
 * Tek fiyat değişikliğinden sonra bildirimin açıklaması: fiyat sitede de değiştiyse fiyat listesinin tarihi (sitede elle)
 * ve kasa (PRICE_PUSH_REMINDER); yalnız panelde değiştiyse kasa. Kasada bekleyen bir şey kalmadıysa (fiyat kasadakine
 * döndü ya da hiç değişmedi) kasa yazılmaz.
 */
export function priceReminder(r: { site: boolean; posPending: boolean }): string | null {
  if (r.site) return r.posPending ? PRICE_PUSH_REMINDER : SITE_DATE_REMINDER;
  return r.posPending ? POS_PRICE_REMINDER : null;
}

/**
 * Toplu değişiklikten ya da geri almasından sonra bildirimin kasa cümlesi; `applied` değişen (geri almada eski haline
 * dönen) ürünler. Biri kasada (ModPOS) değiştirilecek fiyat bıraktıysa ne yazılacağını liste söyler (geri almada
 * kasadaki fiyat bir önceki değişiklikten de kalmış olabilir). Kasa henüz değişmemişken geri alınan fiyat kasadakine
 * döner ve listeden düşer: o zaman bu fiyatlar için kasada bir şey yapılmayacağı söylenir (sahibi kasayı boşuna geri
 * çevirmesin). Cümle yalnız bu değişikliğin ürünlerini anlatır: listede başka ürünler bekliyor olabilir.
 */
export function batchPosNote(kind: "bulk" | "undo", applied: readonly { posPending: boolean }[]): string | undefined {
  if (applied.some((a) => a.posPending)) return "Kasadaki (ModPOS) fiyatlar Kasaya işle listesinde.";
  if (kind !== "undo" || !applied.length) return undefined;
  return `${applied.length === 1 ? "Bu fiyat" : "Bu fiyatlar"} kasada (ModPOS) henüz değişmemişti; kasada bir şey yapmanız gerekmez.`;
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
 * `date` Türkiye günü (YYYY-MM-DD).
 */
export function posChecklistText(items: readonly PosItem[], date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const lines = [`Kasada (ModPOS) değişecek fiyatlar · ${d} ${MONTH_NAMES[m - 1]} ${y}`];
  for (const g of groupByCategory(items)) {
    lines.push(g.category);
    for (const it of g.items) lines.push(`- ${posLabel(it)}: ${price(it.stalePrice)} → ${price(it.price)} ₺`);
  }
  return lines.join("\n");
}
