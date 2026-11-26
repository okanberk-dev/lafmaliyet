import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { businessDate, DAY_TURN_HOUR } from "@/lib/cash-report";
import { ablativeTR, money, timeAblative } from "@/lib/format";
import { addDays, dayMonthTR, isCalendarDate } from "@/lib/reminders";
import { pushActor, pushFailureMessage, type PushFailure } from "@/lib/site-menu/push";
import { SITE_MONEY_MAX_MINOR, type SiteBranchPrice, type SiteMenuItem } from "@/lib/site-menu/schema";
import { fromMinor, toMinor, type SiteMenuSlot } from "@/lib/site-menu/slot";
import type { SiteMarkerKind } from "@/lib/site-menu/view";

/**
 * Şube fiyatı (hesap sözleşmesi §8 "ladmin (LM-5)"; sitenin docs/PANEL-MENU.md "Şube fiyatı"; panel tarafı
 * docs/FIYATLAR.md › Şube fiyatı). Saf modül: Fiyatlar ekranı, sunucu yazımı ve testler paylaşır.
 *
 * Sitenin kalemindeki fiyat **tabandır** (Tuzla'nın ve kendi fiyatı olmayan her şubenin). Bir şubenin kendi fiyatı
 * sitede eklenen, silinmeyen bir satırdır: "25 Kasım 05:00'ten Marina'da latte 205 / 225 ₺". Satır kendi anından sonraki
 * satırın anına dek geçerlidir; `priceMinor: null` "o andan sonra yine taban", `priceMinorL: 0` "taban L". Anı
 * gelmemiş satır geri alınabilir (iptal). Panel satırları sitenin okumasından (`branchPrices`) alır, yazımı tek tek
 * gönderir (bir kalemin M ve L'si tek gövdede); site `writes.branchPrice` duyurmadıysa önermez.
 *
 * "Eski fiyattan satılanlar" ve değişikliğin durumu yalnız LafPOS gün sonunun `lines[].listPrices`'ından (satılan
 * parçaların dondurulan liste fiyatları) çıkar; `revenue / qty` liste fiyatı değildir (indirim, mutlu saat, ek), ondan
 * hiçbir şey çıkarılmaz. Liste fiyatı olmayan gün (eski LafPOS) "Bilinmiyor"dur.
 */

/** Sitenin ana şubesi: fiyatı kalemin kendisidir, şube fiyatı yazılmaz (sitenin HOME_BRANCH'ı) */
export const HOME_BRANCH_ID = DEFAULT_BRANCH_ID;
/** Seçenek kalemleri (şurup, ekstra shot, alternatif süt): her şubede sitenin tabanı, şubeye göre fiyatlanmaz */
export const OPTION_MENU_ITEM_IDS: readonly string[] = ["mnu-0080", "mnu-0081", "mnu-0082"];
/** Türkiye 2016'dan beri yaz saati uygulamaz: İstanbul hep UTC+3 */
export const TR_OFFSET = "+03:00";
/** Yeni satırın anı en çok bu kadar geçmişte olabilir (iki sunucunun saat farkı; sitenin kuralı) */
export const BRANCH_PRICE_PAST_SLACK_MS = 5 * 60_000;
/** En çok bu kadar ileride */
export const BRANCH_PRICE_MAX_AHEAD_MS = 90 * 86_400_000;

/** Şube fiyatı yazılabilen şubeler: açık, fiziksel, ana şube dışı (online kanalın menüsü sitenin tabanıdır) */
export function branchPriceTargets<T extends { id: string; kind: string; active: boolean }>(branches: readonly T[]): T[] {
  return branches.filter((b) => b.active && b.kind === "fiziksel" && b.id !== HOME_BRANCH_ID);
}

export interface BranchPriceRule {
  priceMinor: number | null;
  priceMinorL: number;
  effectiveFrom: string;
}

const at = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

/** `t` anında geçerli satır: anı gelmiş en son satır */
function ruleAt<T extends BranchPriceRule>(rows: readonly T[], t: number): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (at(r.effectiveFrom) > t) continue;
    if (!best || at(r.effectiveFrom) > at(best.effectiveFrom)) best = r;
  }
  return best;
}

/**
 * Kalemin şubedeki fiyatı (kuruş), sitenin `priceAtBranch`'ıyla aynı kural: satır yoksa ya da null ise taban; satırın
 * L'si 0 ise taban L; kalem sitede tek boysa L yok (0). `from`: geçerli satırın anı, taban geçerliyse null.
 */
export function branchPriceAt(
  base: { priceMinor: number; priceMinorL: number },
  rows: readonly BranchPriceRule[],
  t: number,
): { priceMinor: number; priceMinorL: number; from: string | null } {
  const baseL = base.priceMinorL > 0 ? base.priceMinorL : 0;
  const rule = ruleAt(rows, t);
  if (!rule || rule.priceMinor === null) return { priceMinor: base.priceMinor, priceMinorL: baseL, from: null };
  return { priceMinor: rule.priceMinor, priceMinorL: baseL > 0 ? (rule.priceMinorL > 0 ? rule.priceMinorL : baseL) : 0, from: rule.effectiveFrom };
}

/**
 * Bir boyun bir şubedeki durumu (asistanın fiyat kartı; docs/ASISTAN-ISLEMLER.md › 2.1): şu anki fiyatı (kuruş), şubenin
 * kendi satırı mı yoksa tabanı mı izliyor (`own`), kendi satırının anı ve anı gelmemiş (planlı) satırlarda bu boyun
 * fiyatı. L, satırın L'si 0 ise tabanı izler; "Taban fiyata dön" satırı (priceMinor null) tabanı izletir. Tabanı
 * değiştiren kart, `own` şubede fiyatı değiştirmez.
 */
export interface BranchSlotFacts {
  priceMinor: number;
  own: boolean;
  from: string | null;
  planned: { effectiveFrom: string; priceMinor: number | null }[];
}

export function branchSlotFacts(base: { priceMinor: number; priceMinorL: number }, rows: readonly BranchPriceRule[], t: number, slot: SiteMenuSlot): BranchSlotFacts {
  const rule = ruleAt(rows, t);
  const p = branchPriceAt(base, rows, t);
  const ownRule = (r: BranchPriceRule | null) => r !== null && r.priceMinor !== null && (slot === "M" || (base.priceMinorL > 0 && r.priceMinorL > 0));
  const own = ownRule(rule);
  const priceMinor = slot === "L" ? p.priceMinorL : p.priceMinor;
  // Planlı satırlardan yalnız bu boyu değiştirenler (L'si tabanı izlemeye devam eden satır L için değişiklik değildir)
  const planned: BranchSlotFacts["planned"] = [];
  let prev: number | null = own ? priceMinor : null;
  for (const r of rows.filter((x) => at(x.effectiveFrom) > t && at(x.effectiveFrom) !== Number.POSITIVE_INFINITY).sort((a, b) => at(a.effectiveFrom) - at(b.effectiveFrom))) {
    const value = ownRule(r) ? (slot === "L" ? r.priceMinorL : (r.priceMinor as number)) : null;
    if (value !== prev) planned.push({ effectiveFrom: r.effectiveFrom, priceMinor: value });
    prev = value;
  }
  return { priceMinor, own, from: own ? p.from : null, planned };
}

/** Bir kalemin bir şubedeki satırları, eskiden yeniye */
export function rowsOf<T extends { id: string; branch: string; effectiveFrom: string }>(rows: readonly T[], id: string, branch: string): T[] {
  return rows.filter((r) => r.id === id && r.branch === branch).sort((a, b) => at(a.effectiveFrom) - at(b.effectiveFrom));
}

// ---------------------------------------------------------------- Geçerlilik

/** İş günü D'nin başı (D 05:00 İstanbul, ms); iş günü [D 05:00, D+1 05:00) (Kasa raporunun 05:00 kuralı) */
export function dayStartMs(date: string): number {
  return Date.parse(`${date}T${String(DAY_TURN_HOUR).padStart(2, "0")}:00:00${TR_OFFSET}`);
}

/** "Geçerlilik"in varsayılanı: sonraki iş günü 05:00 İstanbul (gece 05:00'ten önce iş günü dündür: aynı sabah 05:00) */
export function defaultEffectiveFrom(now: Date = new Date()): string {
  return `${addDays(businessDate(now), 1)}T${String(DAY_TURN_HOUR).padStart(2, "0")}:00:00${TR_OFFSET}`;
}

/** Anın İstanbul'daki yerel değeri, saat alanı için ("2026-11-25T05:00") */
export function effectiveLocalValue(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 3 * 3_600_000).toISOString().slice(0, 16);
}

/** "25 Kas 05:00" (İstanbul) */
export function effectiveText(iso: string): string {
  const local = effectiveLocalValue(iso);
  return local ? `${dayMonthTR(local.slice(0, 10))} ${local.slice(11, 16)}` : iso;
}

/** "25 Kasım 05:00'ten", "25 Kasım 10:00'dan" (İstanbul; ek saatin okunuşuna göre) */
export function effectiveFromText(iso: string): string {
  const local = effectiveLocalValue(iso);
  return local ? `${dayMonthTR(local.slice(0, 10))} ${timeAblative(local.slice(11, 16))}` : ablativeTR(iso);
}

/**
 * Ekrandaki "Geçerlilik" (yerel saat, "2026-11-25T05:00") → siteye giden an (`+03:00` ile; site UTC saklar). Yeni satır
 * en çok 5 dakika geçmişte (saat farkı), en çok 90 gün ileride olabilir (sitenin kuralı).
 */
export function parseEffectiveLocal(text: string, now: Date = new Date()): { ok: true; iso: string } | { ok: false; error: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m || !isCalendarDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return { ok: false, error: "Geçerlilik tarihini ve saatini seçin" };
  const iso = `${m[1]}T${m[2]}:${m[3]}:00${TR_OFFSET}`;
  const t = Date.parse(iso);
  if (t < now.getTime() - BRANCH_PRICE_PAST_SLACK_MS) return { ok: false, error: "Geçerlilik geçmişte olamaz: satılmış ürünün fiyatı değişmez" };
  if (t > now.getTime() + BRANCH_PRICE_MAX_AHEAD_MS) return { ok: false, error: "Geçerlilik en çok 90 gün ileride olabilir" };
  return { ok: true, iso };
}

// ---------------------------------------------------------------- Yazım

export interface BranchPriceBody {
  id: string;
  branch: string;
  actor: string;
  branchPrice: { priceMinor: number | null; priceMinorL: number; effectiveFrom: string } | { effectiveFrom: string; cancel: true };
}

/** Şubenin yeni fiyatı: boy boy TL (verilmeyen boy değişmez) ya da "tabana dön" */
export type BranchPriceSet = { M?: number; L?: number } | { base: true };

/** Bir kalemin şubedeki iki boyu, TL (L yoksa 0) */
export interface SlotPrices {
  M: number;
  L: number;
}

export type BranchPricePlan =
  | { kind: "push"; body: BranchPriceBody; before: SlotPrices; after: SlotPrices }
  /** Şubenin o andaki fiyatı zaten bu */
  | { kind: "none" }
  | { kind: "refuse"; error: string };

const slotsOf = (p: { priceMinor: number; priceMinorL: number }): SlotPrices => ({ M: fromMinor(p.priceMinor), L: fromMinor(p.priceMinorL) });

/**
 * Şube fiyatı yazımının gövdesi (bir kalem, M ve L birlikte; sitenin sözleşmesindeki sırayla id, branch, actor,
 * branchPrice). Değişmeyen boy şubenin o anda geçerli kendi değerini taşır: kendi L'si yoksa 0 (taban L); kendi satırı
 * yokken yalnız L değişirse M o anki fiyatında sabitlenir (satırın M'si boş olamaz; boş "tabana dön" demektir).
 * Reddedilir: ana şube (Tuzla'nın fiyatı kalemin kendisi), seçenek kalemi, tek boylu kaleme L, 0 ya da tavan üstü fiyat.
 */
export function planBranchPrice(input: {
  item: Pick<SiteMenuItem, "id" | "priceMinor" | "priceMinorL">;
  rows: readonly BranchPriceRule[];
  branch: string;
  effectiveFrom: string;
  set: BranchPriceSet;
  actor: string;
}): BranchPricePlan {
  const { item, rows, branch, effectiveFrom, set } = input;
  if (branch === HOME_BRANCH_ID) return { kind: "refuse", error: "Tuzla ana şube: fiyatı sitenin kendi fiyatıdır, Toplu değiştir'in Tümü seçimiyle değişir" };
  if (OPTION_MENU_ITEM_IDS.includes(item.id)) return { kind: "refuse", error: "Seçenek fiyatı şubeye göre değişmez (her şubede sitenin tabanı)" };
  const t = at(effectiveFrom);
  const current = branchPriceAt(item, rows, t);
  const own = ruleAt(rows, t);
  const ownRow = own && own.priceMinor !== null ? own : null;
  const before = slotsOf(current);
  let priceMinor: number | null;
  let priceMinorL: number;
  if ("base" in set) {
    priceMinor = null;
    priceMinorL = 0;
  } else {
    if (set.M === undefined && set.L === undefined) return { kind: "none" };
    if (set.L !== undefined && !(item.priceMinorL > 0)) return { kind: "refuse", error: "Kalem sitede tek boy: L fiyatı yalnız sitede açılır" };
    for (const v of [set.M, set.L]) {
      if (v === undefined) continue;
      if (!(toMinor(v) >= 1)) return { kind: "refuse", error: "Şube fiyatı 0 olamaz" };
      if (toMinor(v) > SITE_MONEY_MAX_MINOR) return { kind: "refuse", error: `Fiyat sitenin üst sınırını (${money(fromMinor(SITE_MONEY_MAX_MINOR))}) aşıyor` };
    }
    priceMinor = set.M !== undefined ? toMinor(set.M) : (ownRow?.priceMinor ?? current.priceMinor);
    priceMinorL = set.L !== undefined ? toMinor(set.L) : ownRow ? ownRow.priceMinorL : 0;
  }
  const after = slotsOf(branchPriceAt(item, [{ priceMinor, priceMinorL, effectiveFrom }], t));
  if (toMinor(after.M) === toMinor(before.M) && toMinor(after.L) === toMinor(before.L)) return { kind: "none" };
  return {
    kind: "push",
    body: { id: item.id, branch, actor: pushActor(input.actor), branchPrice: { priceMinor, priceMinorL, effectiveFrom } },
    before,
    after,
  };
}

/**
 * "Değiştir" penceresinin alanları: şubenin Geçerlilik anındaki fiyatı (TL; bugünkü değil, arada planlı satır olabilir).
 * Geçerlilik okunamazsa bugünkü fiyat.
 */
export function branchDialogSeed(item: { base: SlotPrices; rows: readonly BranchPriceRule[] }, effectiveFrom: string): SlotPrices {
  const t = Date.parse(effectiveFrom);
  return slotsOf(branchPriceAt({ priceMinor: toMinor(item.base.M), priceMinorL: toMinor(item.base.L) }, item.rows, Number.isFinite(t) ? t : Date.now()));
}

/**
 * "Değiştir" penceresinin gönderdiği değişiklik: yalnız kullanıcının yazdığı boy (null: alana dokunulmadı). Dokunulmayan
 * boy gönderilmez; planBranchPrice onu şubenin o andaki kendi değeriyle (kendi L'si yoksa taban L) taşır. Önceden dolu
 * değer gönderilseydi taban L'yi izleyen boy sabitlenir, planlı satırın L'si ezilirdi.
 */
export function branchDialogSet(input: { toBase: boolean; hasL: boolean; M: number | null; L: number | null }): BranchPriceSet {
  if (input.toBase) return { base: true };
  return { ...(input.M !== null ? { M: input.M } : {}), ...(input.hasL && input.L !== null ? { L: input.L } : {}) };
}

/** Anı gelmemiş satırın geri alınması (iptal) */
export function cancelBranchBody(input: { id: string; branch: string; effectiveFrom: string; actor: string }): BranchPriceBody {
  return { id: input.id, branch: input.branch, actor: pushActor(input.actor), branchPrice: { effectiveFrom: input.effectiveFrom, cancel: true } };
}

const BRANCH_FIELD: Record<string, string> = {
  branch: "Tuzla ana şube; onun fiyatı sitenin kendi fiyatıdır",
  id: "Seçenek fiyatı şubeye göre değişmez",
  branchPrice: "şube fiyatı başka bir alanla birlikte gönderilemez",
  "branchPrice.priceMinor": "M fiyatı 0'dan büyük, kuruşu tam ve sitenin üst sınırının altında olmalı",
  "branchPrice.priceMinorL": "L fiyatı kuruşu tam ve sitenin üst sınırının altında olmalı",
  "branchPrice.effectiveFrom": "Geçerlilik 5 dakikadan eski ya da 90 günden ileri olamaz",
  "branchPrice.cancel": "iptal fiyatla birlikte gönderilemez",
};

/**
 * Şube fiyatı yazımı olmayınca gösterilen metin. Sitenin 409 `stale`'i: yazımda o anda şubenin başka fiyatlı satırı var,
 * iptalde satır artık yok ya da yürürlüğe girdi; ötekiler taban yazımının metinleri (pushFailureMessage).
 */
export function branchFailureMessage(failure: PushFailure, consequence: string, cancel = false): string {
  if (failure.kind === "http") {
    if (failure.status === 409 && failure.error === "stale") {
      return cancel
        ? `Satır yürürlüğe girmiş ya da sitede yok; ${consequence}. Panel sitenin satırlarını yeniledi.`
        : `Bu kalemin şubede aynı anda başka bir fiyatı var; ${consequence}. Önce o satırı iptal edin ya da başka bir an seçin.`;
    }
    if (failure.status === 403) return `Site şube fiyatı yazımını reddetti (panelin anahtarı değil mi?); ${consequence}.`;
    if (failure.status === 400 && failure.field && BRANCH_FIELD[failure.field]) return `${BRANCH_FIELD[failure.field]}; ${consequence}.`;
  }
  return pushFailureMessage(failure, consequence);
}

// ---------------------------------------------------------------- Toplu değişiklik

/**
 * Toplu değişikliğin şube görünümü: siteye bağlı satırın bugünkü fiyatı şubenin "Geçerlilik" anındaki fiyatı (yuvasının),
 * öteki satırlar olduğu gibi (önizlemede engellenir, src/lib/prices/bulk.ts blockReason `branch`).
 */
export function branchBulkRows<T extends { price: number; siteMenuId?: string | null; siteMenuSlot?: SiteMenuSlot | null }>(
  rows: readonly T[],
  ctx: { items: Readonly<Record<string, { priceMinor: number; priceMinorL: number }>>; rows: readonly SiteBranchPrice[]; branch: string; at: number },
): T[] {
  return rows.map((r) => {
    const base = r.siteMenuId ? ctx.items[r.siteMenuId] : undefined;
    if (!base || !r.siteMenuId || !r.siteMenuSlot) return r;
    const p = branchPriceAt(base, rowsOf(ctx.rows, r.siteMenuId, ctx.branch), ctx.at);
    const minor = r.siteMenuSlot === "M" ? p.priceMinor : p.priceMinorL;
    return minor > 0 ? { ...r, price: fromMinor(minor) } : r;
  });
}

/** Toplu değişiklikte şube fiyatının engeli (taban engellerinden önce): yalnız siteye bağlı, seçenek olmayan ürün */
export function branchBlockReason(row: { site: SiteMarkerKind | null; siteMenuId?: string | null }): string | null {
  if (row.site !== "linked" && row.site !== "pending" && row.site !== "broken" && row.site !== "missing") return "Şube fiyatı yalnız siteye bağlı üründe değişir";
  if (row.siteMenuId && OPTION_MENU_ITEM_IDS.includes(row.siteMenuId)) return "Seçenek fiyatı şubeye göre değişmez (her şubede sitenin tabanı)";
  return null;
}

// ---------------------------------------------------------------- Eski fiyattan satılanlar ve durum

/** Bir boyun taban fiyatının zamanla değişimi (TL): panelin fiyat geçmişi (product_prices) ve bugünkü site tabanı */
export interface BaseTimeline {
  current: number;
  changes: { at: number; before: number | null; after: number }[];
}

/** Bir kalemin fiyat kaynakları: iki boyun tabanı ve kalemin o şubedeki satırları */
export interface PriceSources {
  base: { M: BaseTimeline; L: BaseTimeline };
  rows: readonly BranchPriceRule[];
}

/** LafPOS gün sonunun bir satırı (pos_daily_sales): listPrices yoksa (eski LafPOS) null */
export interface BranchSaleRow {
  date: string;
  siteMenuId: string;
  slot: SiteMenuSlot;
  qty: number;
  listPrices: { price: number; qty: number }[] | null;
}

/** Tabanın `t` anındaki fiyatı: `t`'den önceki son değişiklik; yoksa ilk değişikliğin öncesi; o da yoksa bugünkü */
export function baseAt(tl: BaseTimeline, t: number): number {
  const sorted = [...tl.changes].sort((a, b) => a.at - b.at);
  let price: number | null = null;
  for (const c of sorted) if (c.at <= t) price = c.after;
  if (price !== null) return price;
  const first = sorted[0];
  return first && first.before !== null ? first.before : (sorted.length ? first.after : tl.current);
}

/** Boyun şubedeki fiyatı `t` anında (TL; L yoksa 0) */
export function slotPriceAt(src: PriceSources, slot: SiteMenuSlot, t: number): number {
  const p = branchPriceAt({ priceMinor: toMinor(baseAt(src.base.M, t)), priceMinorL: toMinor(baseAt(src.base.L, t)) }, src.rows, t);
  return fromMinor(slot === "M" ? p.priceMinor : p.priceMinorL);
}

/** (from, to) aralığında fiyatın değişebildiği anlar: şube satırları ve tabanın değişiklikleri */
function changesBetween(src: PriceSources, slot: SiteMenuSlot, from: number, to: number): number[] {
  const out = [...src.rows.map((r) => at(r.effectiveFrom)), ...src.base.M.changes.map((c) => c.at), ...(slot === "L" ? src.base.L.changes.map((c) => c.at) : [])];
  return out.filter((t) => t > from && t < to);
}

const sameTl = (a: number, b: number) => toMinor(a) === toMinor(b);

export type ChangeStatus = { kind: "bekliyor" } | { kind: "uygulandi"; day: string } | { kind: "uygulanmadi"; day: string } | { kind: "bilinmiyor" };

export interface BranchChangeReport {
  siteMenuId: string;
  slot: SiteMenuSlot;
  effectiveFrom: string;
  createdAt: string;
  /** Değişiklikten hemen önceki ve sonraki fiyat (TL) */
  before: number;
  after: number;
  /** Anı gelmedi (iptal edilebilir) */
  future: boolean;
  status: ChangeStatus;
}

/**
 * Şubenin fiyat değişikliklerinin durumu, boy boy (yalnız değişen boy), yeniden eskiye. Değişikliğin penceresi kendi
 * anından o boyun fiyatını değiştiren sonraki ana dek (şube satırı ya da izlenen tabanın değişikliği; yalnız öteki boyu
 * değiştiren satır kesmez); içine düşen gün sonu satırları (anı içeren geçiş günü dahil) sırayla:
 * - yeni fiyatla satılan ilk gün: **Uygulandı · gün**
 * - yoksa, anından sonra başlayan tam bir günde yalnız başka fiyat: **Uygulanmadı** (gün: ilk böyle gün). Geçiş
 *   gününün eski fiyatı sayılmaz (anından önce satılmış olabilir)
 * - yoksa liste fiyatı olmayan satır (eski LafPOS): **Bilinmiyor**
 * - yoksa (satış yok ya da an gelmedi): **Bekliyor**
 * Ciro ve adetten hiçbir şey çıkarılmaz.
 */
export function branchChangeReports(input: {
  rows: readonly SiteBranchPrice[];
  sources: ReadonlyMap<string, PriceSources>;
  sales: readonly BranchSaleRow[];
  now: number;
}): BranchChangeReport[] {
  const out: BranchChangeReport[] = [];
  for (const r of input.rows) {
    const src = input.sources.get(r.id);
    if (!src) continue;
    const t = at(r.effectiveFrom);
    for (const slot of ["M", "L"] as const) {
      const before = slotPriceAt(src, slot, t - 1);
      const after = slotPriceAt(src, slot, t);
      if (sameTl(before, after) || !(after > 0)) continue;
      // Pencere bu boyun fiyatını değiştiren sonraki anda biter (öteki boyu değiştiren satır kesmez)
      const end =
        changesBetween(src, slot, t, Number.POSITIVE_INFINITY)
          .sort((a, b) => a - b)
          .find((x) => !sameTl(slotPriceAt(src, slot, x - 1), slotPriceAt(src, slot, x))) ?? Number.POSITIVE_INFINITY;
      const days = input.sales
        .filter((s) => s.siteMenuId === r.id && s.slot === slot && dayStartMs(addDays(s.date, 1)) > t && dayStartMs(s.date) < end)
        .sort((a, b) => a.date.localeCompare(b.date));
      let status: ChangeStatus = { kind: "bekliyor" };
      if (t <= input.now) {
        let oldDay: string | null = null;
        let unknown = false;
        for (const d of days) {
          if (!d.listPrices) {
            unknown = true;
            continue;
          }
          const atNew = d.listPrices.some((p) => p.qty > 0 && sameTl(p.price, after));
          if (atNew) {
            status = { kind: "uygulandi", day: d.date };
            break;
          }
          if (dayStartMs(d.date) >= t && d.listPrices.some((p) => p.qty > 0)) oldDay ??= d.date;
        }
        if (status.kind === "bekliyor") status = oldDay ? { kind: "uygulanmadi", day: oldDay } : unknown ? { kind: "bilinmiyor" } : status;
      }
      out.push({ siteMenuId: r.id, slot, effectiveFrom: r.effectiveFrom, createdAt: r.createdAt, before, after, future: t > input.now, status });
    }
  }
  return out.sort((a, b) => at(b.effectiveFrom) - at(a.effectiveFrom) || a.siteMenuId.localeCompare(b.siteMenuId) || a.slot.localeCompare(b.slot));
}

export function statusText(s: ChangeStatus): string {
  if (s.kind === "uygulandi") return `Uygulandı · ${dayMonthTR(s.day)}`;
  return s.kind === "uygulanmadi" ? "Uygulanmadı" : s.kind === "bilinmiyor" ? "Bilinmiyor" : "Bekliyor";
}

export interface OldPriceSale {
  date: string;
  siteMenuId: string;
  slot: SiteMenuSlot;
  /** Satıldığı liste fiyatı ve adedi */
  price: number;
  qty: number;
  /** Olması gereken fiyat: günün başında geçerli olan (gün içinde değiştiyse günün sonundaki) */
  expected: number;
  /** (olması gereken − satılan) × adet; eksi: pahalıya satılmış */
  loss: number;
}

/**
 * Eski fiyattan satılanlar: gün sonu satırının liste fiyatlarından, o gün geçerli fiyatlardan hiçbiri olmayanlar. Gün
 * içinde fiyat değiştiyse (şube satırı ya da tabanın değişikliği) o gün geçiş günüdür, iki fiyat da doğrudur. Liste
 * fiyatı olmayan satır (eski LafPOS) sayılmaz. Yeniden eskiye.
 */
export function oldPriceSales(input: { sales: readonly BranchSaleRow[]; sources: ReadonlyMap<string, PriceSources> }): OldPriceSale[] {
  const out: OldPriceSale[] = [];
  for (const s of input.sales) {
    const src = input.sources.get(s.siteMenuId);
    if (!src || !s.listPrices) continue;
    const s0 = dayStartMs(s.date);
    const s1 = dayStartMs(addDays(s.date, 1));
    const accepted = [slotPriceAt(src, s.slot, s0), ...changesBetween(src, s.slot, s0, s1).map((t) => slotPriceAt(src, s.slot, t))];
    const expected = slotPriceAt(src, s.slot, s1 - 1);
    for (const p of s.listPrices) {
      if (!(p.qty > 0) || accepted.some((a) => sameTl(a, p.price))) continue;
      out.push({ date: s.date, siteMenuId: s.siteMenuId, slot: s.slot, price: p.price, qty: p.qty, expected, loss: fromMinor(Math.round((toMinor(expected) - toMinor(p.price)) * p.qty)) });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.siteMenuId.localeCompare(b.siteMenuId) || a.slot.localeCompare(b.slot) || a.price - b.price);
}
