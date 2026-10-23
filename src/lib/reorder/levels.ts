/**
 * Mal siparişinin saf hesapları (docs/MAL-SIPARISI.md › Formüller): sayım günleri ve aralığı, hedef ve en az stok,
 * sipariş birimine yuvarlama, eldeki ve siparişteki miktar, tedarikçi tedarikçi öneri listesi ve takibe önerilen
 * kalemler. Bütün miktarlar malzemenin kendi biriminde (gr, ml, adet, dilim); sayım birimi (KG, LT, ADET, DİLİM)
 * yalnız yuvarlama ve ekran içindir. Veritabanı ya da tarayıcı yok; tests/mal-siparisi.test.ts.
 */

import type { Unit } from "../calc/types";
import { addDays, daysBetween, isLastDayOfMonth } from "../reminders";
import type { OrderLite, ReorderSettings } from "./types";

/** Son sayım bundan eskiyse satır "Sayım eski" der (öneri yine hesaplanır) */
export const STALE_DAYS = 4;
/** Bu kadar günden eski sipariş "siparişte" sayılmaz (gelmiş ve sayıma girmiş varsayılır) */
export const IN_TRANSIT_DAYS = 14;
/** Son birimin en az bu kadarı gerekiyorsa o birim de sipariş edilir (5.000'lik koli ancak gerçekten gerekince) */
export const MIN_PACK_FRACTION = 0.25;
/** "Eklenebilecek kalemler"de en çok bu kadar öneri */
export const TRACK_SUGGEST_LIMIT = 15;

const DAY_MS = 86_400_000;
const EPS = 1e-9;

// ---------------------------------------------------------------- Sayım günleri

/** Haftanın günü, Türkiye usulü: 1 = Pazartesi … 7 = Pazar */
export function trWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Sayım günleri tekrarsız ve sıralı (1–7 dışı düşer) */
const weekdaysOf = (days: readonly number[]) => [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);

/**
 * Sayım aralığı: art arda iki sayım günü arasındaki en uzun ara (hafta döner). Haftada tek gün 7, Pazartesi + Perşembe
 * 4 (Perşembe → Pazartesi). Her sipariş bir sonraki sayıma kadar yetmeli.
 */
export function coverDays(weekdays: readonly number[]): number {
  const days = weekdaysOf(weekdays);
  if (days.length < 2) return 7;
  let max = days[0] + 7 - days[days.length - 1];
  for (let i = 1; i < days.length; i++) max = Math.max(max, days[i] - days[i - 1]);
  return max;
}

/** Bugün hızlı sayım günü mü: ayın son günü değil (o gün ay sonu Stok sayımı yerine geçer) */
export function isCountDay(day: string, s: Pick<ReorderSettings, "countWeekdays">): boolean {
  return weekdaysOf(s.countWeekdays).includes(trWeekday(day)) && !isLastDayOfMonth(day);
}

/** Sıradaki sayım günü (bugün dahil değil) */
export function nextCountDay(day: string, s: Pick<ReorderSettings, "countWeekdays">): string {
  for (let k = 1; k <= 14; k++) {
    const d = addDays(day, k);
    if (isCountDay(d, s)) return d;
  }
  return addDays(day, 7);
}

/** Sayım gecikti mi: son sayım sayım aralığı + 1 günden eskiyse kaç gün önceydi; değilse (ya da hiç sayılmadıysa) null */
export function countOverdue(lastDay: string | null, today: string, s: Pick<ReorderSettings, "countWeekdays">): number | null {
  if (!lastDay) return null;
  const k = daysBetween(lastDay, today);
  return k > coverDays(s.countWeekdays) + 1 ? k : null;
}

/** Sayım günü telefon bildirimi gitsin mi: sayım günü, takipte kalem var ve hepsi sayılmadı */
export function countPushDue(day: string, s: Pick<ReorderSettings, "countWeekdays">, total: number, countedToday: number): boolean {
  return isCountDay(day, s) && total > 0 && countedToday < total;
}

// ---------------------------------------------------------------- Hedef ve en az

/**
 * Sayım biriminde yukarı yuvarlar (KG ve LT 0,5'e, ADET ve DİLİM tama), kendi biriminde döner: 25,82 LT → 26 LT =
 * 26000 ml. Sıfır ya da eksi 0.
 */
export function roundCount(base: number, countFactor: number, countUnit: string): number {
  if (!(base > 0)) return 0;
  const f = countFactor > 0 ? countFactor : 1;
  const step = countUnit === "KG" || countUnit === "LT" ? 0.5 : 1;
  return Math.ceil(base / f / step - EPS) * step * f;
}

/**
 * Önerilen hedef ve en az (D3): en az = günlük × teslim süresi × (1 + pay); altına inince yeni sipariş gelmeden
 * bitebilir. Hedef = günlük × (teslim + sayım aralığı) × (1 + pay), sayım biriminde yukarı yuvarlı. Günlük kullanım
 * bilinmiyorsa ya da 0'sa null (hedef elle girilir).
 */
export function suggestedLevels(i: {
  perDay: number | null;
  leadDays: number;
  coverDays: number;
  marginPct: number;
  countUnit: string;
  countFactor: number;
}): { par: number; min: number } | null {
  if (i.perDay === null || !(i.perDay > 0)) return null;
  const m = 1 + Math.max(0, i.marginPct);
  return { par: roundCount(i.perDay * (i.leadDays + i.coverDays) * m, i.countFactor, i.countUnit), min: i.perDay * i.leadDays * m };
}

/**
 * Önerilen birim sayısı: gereken ÷ birim; küsur en az dörtte birse bir birim daha. Az kaldıysa (eldeki en azın
 * altında) ve gereken varken 0 çıktıysa 1. Gereken yoksa 0.
 */
export function packsFor(need: number, unitSize: number, critical: boolean): number {
  if (!(need > 0) || !(unitSize > 0)) return 0;
  const p = need / unitSize;
  const whole = Math.floor(p + EPS);
  const n = whole + (p - whole >= MIN_PACK_FRACTION - EPS ? 1 : 0);
  return critical && n === 0 ? 1 : n;
}

// ---------------------------------------------------------------- Eldeki ve siparişteki

export interface OnHand {
  /** Kendi biriminde */
  base: number;
  /** Sayımın anı (ISO) ve iş günü */
  at: string;
  day: string;
  source: "hizli" | "ay-sonu";
  by: string | null;
}

/**
 * Eldeki stok: en yeni hızlı sayım ya da ay sonu sayımı (hangisi yeniyse; ay sonu sayımı da listeyi tazeler). Miktar
 * sayıldığı andaki çarpanla kendi birimine çevrilir (sayım birimi sonradan değişse de).
 */
export function latestOnHand(
  quick: { qty: number; factor: number; countedAt: string; day: string; by: string } | null,
  monthEnd: { qty: number; factor: number; updatedAt: string; day: string; by: string | null } | null,
): OnHand | null {
  const q = quick ? { base: quick.qty * quick.factor, at: quick.countedAt, day: quick.day, source: "hizli" as const, by: quick.by } : null;
  const m = monthEnd ? { base: monthEnd.qty * monthEnd.factor, at: monthEnd.updatedAt, day: monthEnd.day, source: "ay-sonu" as const, by: monthEnd.by } : null;
  if (!q || !m) return q ?? m;
  return Date.parse(m.at) > Date.parse(q.at) ? m : q;
}

/**
 * "Siparişte" (D3): iptal olmayan, son 14 günde gönderilen ve sayıma girmemiş siparişlerin bu kalemi. Sayıma girmemiş:
 * hiç gelmedi ya da sayımdan sonra geldi ("Geldi" ya da eşleşen faturanın günü). Kapatılan ama "Geldi" denmemiş
 * sipariş kapandığı anda gelmiş sayılır (Kapat işi bitirir; gelmeyen sipariş iptal edilir). Kalem sipariş biriminde ×
 * birimin içeriği.
 */
export function onOrderFor(orders: readonly OrderLite[], ingredientId: number, onHandAt: string | null, today: string): { base: number; orderIds: number[] } {
  const since = addDays(today, -IN_TRANSIT_DAYS);
  const countAt = onHandAt ? Date.parse(onHandAt) : null;
  let base = 0;
  const orderIds: number[] = [];
  for (const o of orders) {
    if (o.status === "cancelled" || o.sentDay < since) continue;
    const arrived = o.receivedAt ?? (o.status === "closed" ? o.closedAt : null);
    if (arrived && countAt !== null && Date.parse(arrived) <= countAt) continue;
    const mine = o.lines.filter((l) => l.ingredientId === ingredientId);
    if (!mine.length) continue;
    base += mine.reduce((a, l) => a + l.qty * l.unitSize, 0);
    orderIds.push(o.id);
  }
  return { base, orderIds };
}

/**
 * "Geldi"nin yazılan anı (malın geldiği an; dokunuş anı onun üst sınırı). Siparişin kalemleri gönderildikten sonra
 * sayıldıysa ve sipariş o sayımın gününe kadar bekleniyorduysa, sayımdan sonra dokunulan Geldi (Hızlı sayım'da
 * Kaydet'ten sonra, sipariş listesinde Yoldaki siparişler'den, unutulup sonradan) büyük olasılıkla sayılmış bir mal
 * içindir: an sayımın hemen öncesi olur ve mal "siparişte" ikinci kez sayılmaz. Öteki durumlarda (sayımdan sonra
 * gönderilen ya da sayımdan sonra gelmesi beklenen sipariş) dokunuş anı: mal sayımdan sonra geldi, siparişte sayılır.
 * `lastCount`: siparişin kalemlerinin en yeni sayımı (hızlı sayım ya da ay sonu), anı ve iş günü.
 */
export function receivedAtFor(order: { sentAt: string; expectedOn: string }, lastCount: { at: string; day: string } | null, now: Date): Date {
  if (!lastCount) return now;
  const sent = Date.parse(order.sentAt);
  const at = Date.parse(lastCount.at);
  if (at > sent && at <= now.getTime() && order.expectedOn <= lastCount.day) return new Date(Math.max(sent, at - 1000));
  return now;
}

/**
 * Sayım miktarı 3 basamağa yuvarlı: kutu en çok 3 basamak gösterir (countText), kaydedilen de o olur (1,2345 yazılırsa
 * 1,234 ya da 1,235); yoksa kayıttan sonra kutudaki değer kayıtla tutmaz, satır "başkası kaydetti" sanılırdı.
 */
export function countQty(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1000) / 1000;
}

/** Hızlı sayımın formdaki miktarı: kayıt, bugünkü sayım birimine çevrilip 3 basamağa yuvarlanmış (kutudaki yazım gibi) */
export function shownCount(row: { qty: number; factor: number } | null, countFactor: number): number | null {
  if (!row) return null;
  return countQty((row.qty * row.factor) / (countFactor > 0 ? countFactor : 1));
}

/**
 * Hızlı sayımda "başkası kaydetti" denetimi (Stok sayımı'ndaki kural): kişinin formu açtığında gördüğü miktar (`base`,
 * formdaki biçimde) şimdiki kayda uymuyorsa ve kayıt zaten kaydedilmek istenen değer değilse çakışma. Kayıt formdaki
 * biçime çevrilerek karşılaştırılır: 1,2345 yazılan ya da aynı gün sayım birimi değişen kalem her kayıtta çakışma
 * sanılmaz. `base` gönderilmeyen satır denetlenmez. Çakışan kalemlerin kimlikleri döner.
 */
export function quickCountConflicts(
  entries: readonly { ingredientId: number; qty: number | null; base?: number | null }[],
  current: ReadonlyMap<number, { qty: number; factor: number }>,
  countFactorOf: (ingredientId: number) => number,
): number[] {
  return entries
    .filter((e) => {
      if (e.base === undefined) return false;
      const cur = current.get(e.ingredientId) ?? null;
      const f = countFactorOf(e.ingredientId);
      if (shownCount(cur, f) === countQty(e.base)) return false;
      // Kayıt zaten bu değer (yanıtı kaybolan isteğin yenilenmesi): kaydedildiği gibi (3 basamak), kendi biriminde
      if (cur === null || e.qty === null) return !(cur === null && e.qty === null);
      return Math.abs(cur.qty * cur.factor - countQty(e.qty)! * (f > 0 ? f : 1)) > 1e-6;
    })
    .map((e) => e.ingredientId);
}

// ---------------------------------------------------------------- Varsayılanlar (D5, D6)

/** Kalemde teslim süresi yoksa: aynı tedarikçinin takipteki kalemlerinde en çok yazılan (eşitlikte uzun olan), yoksa genel ayar */
export function inheritLeadDays(supplierKey: string | null, tracked: readonly { supplierKey: string | null; leadDays: number | null }[], fallback: number): number {
  if (supplierKey === null) return fallback;
  const counts = new Map<number, number>();
  for (const t of tracked) if (t.supplierKey === supplierKey && t.leadDays !== null) counts.set(t.leadDays, (counts.get(t.leadDays) ?? 0) + 1);
  if (!counts.size) return fallback;
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/** Birim adı, Türkçe küçük harf ("Koli" → "koli", "KG" → "kg"); boşsa null */
export function unitWord(unit: string | null | undefined): string | null {
  const u = (unit ?? "").trim().replace(/\s+/g, " ");
  return u ? u.toLocaleLowerCase("tr-TR") : null;
}

/**
 * Sipariş birimi ve 1 birimin içeriği: tedarikçinin son fatura kalemindeki birim ve bağlantının çarpanı (1 Koli =
 * 12000 ml); kalem yoksa "paket" ve hammaddenin paket boyu.
 */
export function defaultOrderUnit(link: { unit: string | null; factor: number } | null, ing: { packageSize: number }): { unit: string; size: number } {
  if (link && link.factor > 0) return { unit: unitWord(link.unit) ?? "paket", size: link.factor };
  return { unit: "paket", size: ing.packageSize > 0 ? ing.packageSize : 1 };
}

/**
 * Beklenen birim fiyat: tercih edilen tedarikçinin son faturası, yoksa hammaddenin fiyatı (reçetenin birim maliyeti).
 * 0 ya da eksi fiyat bilinmiyor demektir (sayımda personelin fiyatsız eklediği kalem): null, tutar tahmini ve fiyat
 * karşılaştırması yok. Hammaddenin fiyatı "Tahmini" ise (personelin yazdığı ya da ilk yükleme) yalnız "~" tahmin: fiyat
 * farkı uyarısı verilmez.
 */
export function referencePrice(i: { supplierLast: number | null; unitCost: number | null; isEstimate: boolean }): { unitPrice: number; estimated: boolean } | null {
  if (i.supplierLast !== null && i.supplierLast > 0 && Number.isFinite(i.supplierLast)) return { unitPrice: i.supplierLast, estimated: i.isEstimate };
  if (i.unitCost !== null && i.unitCost > 0 && Number.isFinite(i.unitCost)) return { unitPrice: i.unitCost, estimated: i.isEstimate };
  return null;
}

// ---------------------------------------------------------------- Öneri listesi

export interface PlanItem {
  ingredientId: number;
  name: string;
  baseUnit: Unit;
  countUnit: string;
  countFactor: number;
  /** Tedarikçinin grubu (Tedarikçiler'deki anahtar) ve adı; seçilmemişse null */
  supplierKey: string | null;
  supplierName: string | null;
  leadDays: number;
  orderName: string;
  orderUnit: string;
  orderUnitSize: number;
  /** Elle yazılan hedef (kendi biriminde); yoksa öneri */
  parBase: number | null;
  /** Günlük kullanım; satış verisi yoksa null */
  perDay: number | null;
  onHand: OnHand | null;
  onOrder: number;
  /** ₺ / kendi birimi, KDV hariç; bilinmiyorsa null */
  expectedUnitPrice: number | null;
  priceEstimated: boolean;
}

export type PlanStatus = "siparis" | "yeterli" | "sayilmadi" | "hedef-yok";

export interface PlanLine extends PlanItem {
  par: number | null;
  parSource: "elle" | "oneri" | null;
  min: number | null;
  /** Hedef − eldeki − siparişte (kendi biriminde); sayılmadıysa ya da hedef yoksa 0 */
  need: number;
  /** Önerilen birim sayısı */
  packs: number;
  status: PlanStatus;
  /** Eldeki en azın altında: "Az kaldı" */
  critical: boolean;
  /** Son sayım 4 günden eski */
  stale: boolean;
  /** Son fiyatlarla tahmini tutar (KDV hariç); fiyat bilinmiyorsa null */
  estimate: number | null;
}

/** Bir kalemin öneri satırı (D3) */
export function planLine(item: PlanItem, s: ReorderSettings, now: Date): PlanLine {
  const levels = suggestedLevels({
    perDay: item.perDay,
    leadDays: item.leadDays,
    coverDays: coverDays(s.countWeekdays),
    marginPct: s.marginPct,
    countUnit: item.countUnit,
    countFactor: item.countFactor,
  });
  const par = item.parBase ?? levels?.par ?? null;
  const parSource = item.parBase !== null ? "elle" : levels ? "oneri" : null;
  const min = levels?.min ?? null;
  const onHand = item.onHand;
  const stale = onHand ? now.getTime() - Date.parse(onHand.at) > STALE_DAYS * DAY_MS : false;
  const critical = onHand !== null && min !== null && onHand.base < min;
  const base = { ...item, par, parSource, min, critical, stale } as const;
  const priced = (packs: number) => (item.expectedUnitPrice !== null ? item.expectedUnitPrice * packs * item.orderUnitSize : null);
  if (!onHand) return { ...base, need: 0, packs: 0, status: "sayilmadi", estimate: priced(0) };
  if (par === null) return { ...base, need: 0, packs: 0, status: "hedef-yok", estimate: priced(0) };
  const need = par - onHand.base - item.onOrder;
  const packs = packsFor(need, item.orderUnitSize, critical);
  return { ...base, need, packs, status: packs > 0 ? "siparis" : "yeterli", estimate: priced(packs) };
}

export interface PlanGroup {
  supplierKey: string | null;
  supplierName: string | null;
  /** Az kaldı önce, sonra ada göre */
  lines: PlanLine[];
  /** Önerilen birimlerin toplamı */
  packs: number;
  /** Önerilen kalemlerin tahmini tutarı (fiyatı bilinenler); hiçbiri bilinmiyorsa null */
  estimate: number | null;
  /** Önerilen kalemlerden fiyatı bilinmeyen var */
  estimatePartial: boolean;
  /** Önerilen kalemlerin en uzun teslim süresi (yoksa bütün kalemlerin) */
  lead: number;
}

const byName = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "tr");

/** Tedarikçi tedarikçi gruplar: önerisi olanlar (ada göre), sonra ötekiler, en sonda tedarikçisi seçilmemiş kalemler */
export function planGroups(lines: readonly PlanLine[]): PlanGroup[] {
  const map = new Map<string | null, PlanLine[]>();
  for (const l of lines) map.set(l.supplierKey, [...(map.get(l.supplierKey) ?? []), l]);
  const groups: PlanGroup[] = [...map].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => Number(b.critical) - Number(a.critical) || a.name.localeCompare(b.name, "tr"));
    const suggested = sorted.filter((l) => l.packs > 0);
    const known = suggested.filter((l) => l.estimate !== null);
    return {
      supplierKey: key,
      supplierName: sorted[0]?.supplierName ?? null,
      lines: sorted,
      packs: suggested.reduce((a, l) => a + l.packs, 0),
      estimate: known.length ? known.reduce((a, l) => a + (l.estimate ?? 0), 0) : null,
      estimatePartial: known.length < suggested.length,
      lead: Math.max(0, ...(suggested.length ? suggested : sorted).map((l) => l.leadDays)),
    };
  });
  return groups.sort((a, b) => {
    if ((a.supplierKey === null) !== (b.supplierKey === null)) return a.supplierKey === null ? 1 : -1;
    if (a.packs > 0 !== b.packs > 0) return a.packs > 0 ? -1 : 1;
    return byName(a.supplierName, b.supplierName);
  });
}

/**
 * Sipariş hazır tedarikçiler (Bugün): önerisi olan ve son sayımdan sonra siparişi gönderilmemiş. Sayım yoksa hiçbiri.
 */
export function readySuppliers(groups: readonly PlanGroup[], orders: readonly OrderLite[], lastCountAt: string | null): PlanGroup[] {
  if (!lastCountAt) return [];
  const since = Date.parse(lastCountAt);
  return groups.filter(
    (g) => g.supplierKey !== null && g.packs > 0 && !orders.some((o) => o.status !== "cancelled" && o.supplierKey === g.supplierKey && Date.parse(o.sentAt) > since),
  );
}

/**
 * Takibe önerilen kalemler: sayım birimi olan (su ve buz değil), takipte olmayan, satışta kullanılan; aylık tutara
 * (günlük × 30 × birim maliyet) göre en çok tutan ilk 15 (eşitlikte kullanımı çok olan).
 */
export function suggestTracked(
  items: readonly { id: number; countable: boolean; tracked: boolean; perDay: number | null; unitCost: number }[],
  limit = TRACK_SUGGEST_LIMIT,
): number[] {
  return items
    .filter((i) => i.countable && !i.tracked && i.perDay !== null && i.perDay > 0)
    .map((i) => ({ id: i.id, monthly: (i.perDay ?? 0) * 30 * Math.max(0, i.unitCost), perDay: i.perDay ?? 0 }))
    .sort((a, b) => b.monthly - a.monthly || b.perDay - a.perDay || a.id - b.id)
    .slice(0, limit)
    .map((i) => i.id);
}
