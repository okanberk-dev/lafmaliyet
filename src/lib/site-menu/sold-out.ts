import { MONTH_NAMES } from "@/lib/constants";
import { addDays, todayTR } from "@/lib/reminders";

import type { PushFailure } from "./push";
import type { LinkStatus, SiteMenuSlot } from "./slot";

/**
 * Tükendi / Satışa aç (dalga 10 §2.1; docs/SITE-MENU.md › Personel: Tükendi / Satışa aç). Bar ekranının "Tükenenler"
 * kartı biten ürünü sitede "Tükendi" yapar (M ve L birlikte: sitede boy boy durum yok), sonra "Satışa aç" ile geri
 * açar. Personel yalnız sitedeki "Satışta / Tükendi" durumunu değiştirir; fiyata, "Menüde aktif"e, stoğa ve kasaya
 * dokunmaz, yöneticinin kapattığını açamaz.
 *
 * Kartın kaydı (integration_state `menu_sold_out`): kalem başına kim, ne zaman ve kapattığı andaki sitenin `updatedAt`
 * damgası. Kayıt yalnız sitede başka bir şey değişmediyse geçerlidir (`markerValid`): sahibin sitenin panelinden
 * yaptığı her değişiklik damgayı değiştirir ve kalemi yöneticiye bırakır. Panelin kendi fiyat yazımları kaydı taşır
 * (src/server/site-menu/sold-out-store.ts › carrySoldOutMarker).
 *
 * Saf modül: sunucu (src/server/site-menu/sold-out-core.ts, src/server/data/menu-status.ts), Bugün, zil ve sabah
 * e-postası paylaşır. Fiyat yok: kalemin kopyası fiyatsızdır.
 */

export const SOLD_OUT_KEY = "menu_sold_out";
/** Personelin kartla kapattığı ve hâlâ geçerli kalemler en çok bu kadar (bütün personel birlikte; yöneticininki sayılmaz) */
export const STAFF_SOLD_OUT_MAX = 10;
/** Personelin hız sınırı: kişi başına pencerede en çok `calls` işlem; aynı kalemde iki işlem arasında en az `perItemMs` */
export const STAFF_TOGGLE_LIMIT = { calls: 20, windowMs: 10 * 60_000, perItemMs: 3_000 } as const;
const HOUR_MS = 3_600_000;
/** Personelin kaydı bundan eskiyse Bugün satırı uyarı rengine geçer */
export const SOLD_OUT_WARN_MS = 16 * HOUR_MS;
/** Personelin kaydı bundan eskiyse zil uyarı olur */
export const SOLD_OUT_ALERT_MS = 24 * HOUR_MS;
/** Son bir saatte personel bu kadar ya da daha çok ürün kapattıysa zil uyarı olur */
const SOLD_OUT_BURST = 3;

/** İşlem geçmişindeki eylem adları (hız sınırı da bunları sayar) */
export const SOLD_OUT_ACTIONS = { close: "Tükendi", open: "Satışa açıldı", hold: "Tükendi: kapalı tutuldu" } as const;

export const SOLD_OUT_TEXT = {
  off: "Site bağlantısı kurulmamış; Tükendi işaretlenemiyor. Yöneticiye haber verin.",
  missing: "Bu ürün sitede bulunamadı; yöneticiye haber verin.",
  noRow: "Bu ürünün satışta olan bir boyu yok; yöneticiye haber verin.",
  adminClosed: "Bu ürünü yönetici kapattı; satışa yönetici açar.",
  cap: `Tükenenler listesi dolu (${STAFF_SOLD_OUT_MAX} ürün). Gelenleri satışa açın ya da yöneticiye haber verin.`,
  tooMany: "Kısa sürede çok işlem yapıldı (10 dakikada en çok 20). Biraz sonra yeniden deneyin.",
  tooSoon: "Az önce değişti; birkaç saniye sonra yeniden deneyin.",
  /** Site yazdı ama panelin işlemi düştü */
  closedNotSaved: "Sitede tükendi oldu ama panele yazılamadı; yöneticiye haber verin.",
  openedNotSaved: "Sitede satışa açıldı ama panele yazılamadı; yöneticiye haber verin.",
  /** Kartın açıklaması ve toast'un alt satırı */
  everywhere: "laffogato.net, uygulama ve QR menüde satışta değil",
  sizesTogether: "Sitede boy boy durum yok: M ve L birlikte kapanır.",
} as const;

/** Bir kalemin kartla kapatılma kaydı */
export interface SoldOutMarker {
  /** Kapatanın hesabı (silinmişse null) */
  byId: number | null;
  /** Kapatanın o anki adı */
  by: string;
  byRole: "staff" | "admin";
  /** Kapatma anı (ISO) */
  at: string;
  /** Sitenin kapattıktan sonraki `updatedAt` damgası */
  siteUpdatedAt: string;
}

export interface SoldOutRecord {
  /** Sitedeki kalem kimliği → kayıt */
  items: Record<string, SoldOutMarker>;
  /** Kalem kimliği → son işlemin anı (aynı kalemde art arda iki dokunuşa karşı) */
  toggles: Record<string, string>;
}

/** Sitedeki kalemin fiyatsız kopyası (son listenin kopyasından ya da canlı listeden indirilir) */
export interface SoldOutItem {
  id: string;
  name: string;
  categoryLabel: string;
  /** "Satışta"; false = "Tükendi" */
  isActive: boolean;
  updatedAt: string;
}

/** Panelin kaleme bağlı satırı (fiyatsız); `link` bağlantının durumu (src/lib/site-menu/slot.ts › linkStatus) */
export interface SoldOutRow {
  id: number;
  name: string;
  size: string;
  siteMenuId: string;
  siteMenuSlot: SiteMenuSlot;
  link: LinkStatus;
  active: boolean;
}

/**
 * Tahtadaki durum. on: satışta (Tükendi yapılabilir); card: kartla kapatıldı, kayıt geçerli (Satışa aç); closed:
 * kayıtsız kapalı (yönetici açar); drifted: kartla kapatıldı ama sonra sitede değişti (yönetici açar).
 */
export type SoldOutState = "on" | "card" | "closed" | "drifted";

export interface SoldOutEntry {
  /** Sitedeki kalem kimliği */
  id: string;
  /** Paneldeki ad (M satırı önce) */
  name: string;
  /** Sitedeki ad */
  siteName: string;
  category: string;
  /** Bağlı etkin boylar ("M", "L"); tek boyda boş */
  sizes: string[];
  state: SoldOutState;
  /** Kaydı varsa kim ve ne zaman (`staff` personelin kapattığı) */
  marker: { by: string; at: string; staff: boolean } | null;
  /** Bağlı bütün boylar etkin: satışa açılabilir (bir boyu pasifse açmak onu da açardı) */
  reopenable: boolean;
}

const str = (v: unknown): v is string => typeof v === "string";

/** Saklanan kayıt; bozuk kayıt boş, bozuk satır atılır */
export function parseSoldOut(value: unknown): SoldOutRecord {
  const out: SoldOutRecord = { items: {}, toggles: {} };
  if (!value || typeof value !== "object") return out;
  const v = value as { items?: unknown; toggles?: unknown };
  if (v.items && typeof v.items === "object") {
    for (const [id, m] of Object.entries(v.items as Record<string, unknown>)) {
      const x = m as Partial<SoldOutMarker> | null;
      if (!x || !str(x.by) || !str(x.at) || !str(x.siteUpdatedAt) || (x.byRole !== "staff" && x.byRole !== "admin")) continue;
      out.items[id] = { byId: typeof x.byId === "number" ? x.byId : null, by: x.by, byRole: x.byRole, at: x.at, siteUpdatedAt: x.siteUpdatedAt };
    }
  }
  if (v.toggles && typeof v.toggles === "object") {
    for (const [id, at] of Object.entries(v.toggles as Record<string, unknown>)) if (str(at)) out.toggles[id] = at;
  }
  return out;
}

/** Kayıt geçerli: kalem sitede kapalı ve damgası kapattıktan sonraki damgayla aynı (sitede başka bir şey değişmedi) */
export function markerValid(marker: Pick<SoldOutMarker, "siteUpdatedAt"> | null | undefined, item: Pick<SoldOutItem, "isActive" | "updatedAt"> | null | undefined): boolean {
  return Boolean(marker && item && !item.isActive && marker.siteUpdatedAt && item.updatedAt === marker.siteUpdatedAt);
}

const slotOrder = (r: Pick<SoldOutRow, "siteMenuSlot">) => (r.siteMenuSlot === "M" ? 0 : 1);

/** Kalemin yazımda kullanılacak satırı: bağlı, bağlantısı sağlam ve etkin ilk satır; M önce */
export function pickRow<T extends SoldOutRow>(rows: readonly T[], item: Pick<SoldOutItem, "id">): T | null {
  return [...rows].filter((r) => r.siteMenuId === item.id && r.link === "ok" && r.active).sort((a, b) => slotOrder(a) - slotOrder(b))[0] ?? null;
}

/** Kalemin bağlantısı sağlam satırları (M önce) */
function okRows<T extends SoldOutRow>(rows: readonly T[], id: string): T[] {
  return rows.filter((r) => r.siteMenuId === id && r.link === "ok").sort((a, b) => slotOrder(a) - slotOrder(b));
}

/**
 * Bar ekranının tahtası: site kalemi başına bir satır (M ve L birleşir), sitenin sırasıyla. Bağlantısı kopuk ya da
 * sitede olmayan satırlar, bağlı satırı olmayan ve bütün boyları emekli (`active = false`) kalemler atılır.
 */
export function soldOutBoard(rows: readonly SoldOutRow[], items: readonly SoldOutItem[], markers: Readonly<Record<string, SoldOutMarker>>): SoldOutEntry[] {
  const out: SoldOutEntry[] = [];
  for (const item of items) {
    const linked = okRows(rows, item.id);
    const live = linked.filter((r) => r.active);
    if (!live.length) continue;
    const m = markers[item.id] ?? null;
    const state: SoldOutState = item.isActive ? "on" : markerValid(m, item) ? "card" : m ? "drifted" : "closed";
    out.push({
      id: item.id,
      name: live[0].name,
      siteName: item.name,
      category: item.categoryLabel,
      sizes: live.map((r) => r.size).filter((s) => s !== "Tek"),
      state,
      marker: m && state !== "on" ? { by: m.by, at: m.at, staff: m.byRole === "staff" } : null,
      reopenable: linked.every((r) => r.active),
    });
  }
  return out;
}

/** Personelin geçerli kayıtları (ortak tavan bunları sayar) */
export function staffSoldOutCount(markers: Readonly<Record<string, SoldOutMarker>>, items: readonly Pick<SoldOutItem, "id" | "isActive" | "updatedAt">[]): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  return Object.entries(markers).filter(([id, m]) => m.byRole === "staff" && markerValid(m, byId.get(id))).length;
}

/** Ortak tavan: personelin geçerli kaydı `count` iken bir tane daha yazılabilir mi */
export function capRefusal(role: "admin" | "staff", count: number): string | null {
  return role !== "admin" && count >= STAFF_SOLD_OUT_MAX ? SOLD_OUT_TEXT.cap : null;
}

/** Personelin hız sınırı: `calls` pencerede yapılan işlem sayısı, `lastAt` bu kalemin son işlemi */
export function toggleRefusal(input: { calls: number; lastAt: string | null | undefined; now: number }): string | null {
  if (input.calls >= STAFF_TOGGLE_LIMIT.calls) return SOLD_OUT_TEXT.tooMany;
  const last = input.lastAt ? Date.parse(input.lastAt) : NaN;
  if (Number.isFinite(last) && input.now - last < STAFF_TOGGLE_LIMIT.perItemMs) return SOLD_OUT_TEXT.tooSoon;
  return null;
}

/**
 * Satışa açma reddi (canlı listedeki kalemle; kalem satıştaysa çağıran "zaten satışta" der). Bağlı bütün boylar etkin
 * olmalı (yönetici için de: açmak emekli boyu da açardı). Personel yalnız geçerli kaydı olan kalemi açar.
 */
export function reopenRefusal(input: {
  role: "admin" | "staff";
  rows: readonly Pick<SoldOutRow, "name" | "size" | "active" | "link">[];
  marker: Pick<SoldOutMarker, "siteUpdatedAt"> | null;
  live: Pick<SoldOutItem, "isActive" | "updatedAt"> | null;
}): string | null {
  if (!input.live) return SOLD_OUT_TEXT.missing;
  const off = input.rows.find((r) => r.link === "ok" && !r.active);
  if (off) {
    const label = `${off.name} ${off.size}`;
    return input.role === "admin" ? `${label} menüde pasif; satışa açmak onu da açardı. Önce ürün kartından açın.` : `${label} menüde pasif; satışa yönetici açar.`;
  }
  if (input.role === "admin") return null;
  if (!input.marker || input.live.updatedAt !== input.marker.siteUpdatedAt) return SOLD_OUT_TEXT.adminClosed;
  return null;
}

/**
 * Sitenin hata metni: bağlantıyla ilgili nedenlerde (kapalı bağlantı, 400 / 401 / 404 / 409) sonuna "Yöneticiye haber
 * verin." eklenir; ağ ve zaman aşımı yeniden denenebilir, metin olduğu gibi kalır.
 */
export function siteFailureText(message: string, cause: PushFailure | null | undefined): string {
  const link = cause?.kind === "off" || (cause?.kind === "http" && [400, 401, 404, 409].includes(cause.status));
  return link ? `${message.trim()} Yöneticiye haber verin.` : message;
}

/**
 * Reçete kartının kaydında menü anahtarları (`saveRecipe`): kart açılırken görülen değer (`seen`) değişmediyse
 * veritabanındaki güncel değer yazılır. Önceden açık kalmış bir kart, personelin bu arada kapattığı ürünü sessizce
 * yeniden açmaz. `seen` yoksa (eski istemci) gönderilen.
 */
export function keepSeen(sent: boolean, seen: boolean | null | undefined, current: boolean): boolean {
  return seen !== undefined && seen !== null && sent === seen ? current : sent;
}

// ---------------------------------------------------------------- Metinler (Bugün, zil, sabah e-postası, kart)

const TR_OFFSET_MS = 3 * HOUR_MS;
const hhmm = (ms: number) => new Date(ms + TR_OFFSET_MS).toISOString().slice(11, 16);

/** Kaydın anı: bugünse "21:40", dünse "dün 21:40", daha eskisi "20 Eki 09:05" (Türkiye saati) */
export function soldOutWhen(at: string, now: Date): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const day = todayTR(new Date(ms));
  const today = todayTR(now);
  if (day === today) return hhmm(ms);
  if (day === addDays(today, -1)) return `dün ${hhmm(ms)}`;
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${hhmm(ms)}`;
}

/** Ne zamandır tükendi: "50 dakikadır", "17 saattir", "2 gündür" */
export function soldOutAge(at: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(at));
  if (ms < HOUR_MS) return `${Math.max(1, Math.floor(ms / 60_000))} dakikadır`;
  if (ms < 24 * HOUR_MS) return `${Math.floor(ms / HOUR_MS)} saattir`;
  return `${Math.floor(ms / (24 * HOUR_MS))} gündür`;
}

/** Bugün, zil ve sabah e-postasının okuduğu kayıt (Bugün olgusu; src/app/panel/bugun/rows-ops.ts › OpsDayFacts) */
export interface SoldOutFact {
  id: string;
  name: string;
  by: string;
  at: string;
  staff: boolean;
}

const oldestFirst = <T extends { at: string }>(items: readonly T[]) => [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
const firstNames = (items: readonly { name: string }[], max = 3) => `${items.slice(0, max).map((i) => i.name).join(", ")}${items.length > max ? "…" : ""}`;

/**
 * "Bugün kafede"nin Tükendi satırı (iki rol): "Tükendi: Tiramisu, Cheesecake" (en eskisi önce, en çok 3 ad).
 * Personelin bir kaydı 16 saatten eskiyse uyarı: "Tiramisu 2 gündür tükendi: geldiyse satışa açın".
 */
export function soldOutLineText(items: readonly SoldOutFact[], now: Date): { text: string; tone: "info" | "warn" } | null {
  if (!items.length) return null;
  const sorted = oldestFirst(items);
  const stale = sorted.find((i) => i.staff && now.getTime() - Date.parse(i.at) >= SOLD_OUT_WARN_MS);
  if (stale) return { text: `${stale.name} ${soldOutAge(stale.at, now)} tükendi: geldiyse satışa açın`, tone: "warn" };
  return { text: `Tükendi: ${firstNames(sorted)}`, tone: "info" };
}

/**
 * Yöneticinin zil satırı (grup "uyari"): personelin kapattığı ürünler. Uyarı: bir kayıt 24 saatten eskiyse ya da son
 * bir saatte personel 3 ya da daha çok ürün kapattıysa; yoksa bilgi. Kimlik kalemlerden ve en yeni kayıttan: yeni bir
 * kapatma zili yeniden okunmamış yapar, ürün satışa açılınca satır kalkar.
 */
export function soldOutBell(items: readonly SoldOutFact[], now: Date): { id: string; kind: "info" | "warning"; title: string; body: string; href: string } | null {
  const staff = oldestFirst(items.filter((i) => i.staff));
  if (!staff.length) return null;
  const t = now.getTime();
  const newest = staff[staff.length - 1].at;
  const old = staff.some((i) => t - Date.parse(i.at) >= SOLD_OUT_ALERT_MS);
  const burst = staff.filter((i) => t - Date.parse(i.at) < HOUR_MS).length >= SOLD_OUT_BURST;
  return {
    id: `tukendi-${staff
      .map((i) => i.id)
      .sort()
      .join(",")}-${newest}`,
    kind: old || burst ? "warning" : "info",
    title: `Tükendi: ${firstNames(staff)}`,
    body: `Personel kapattı: ${staff.map((i) => `${i.by} ${soldOutWhen(i.at, now)}`).join(" · ")}. Sitede, uygulamada ve QR menüde satışta değil.`,
    href: "/panel/karaoke#tukenenler",
  };
}

/** Sabah e-postasının satırı: "Personelin tükendi yaptığı ürünler: Tiramisu (Selin, 2 gündür)". Yalnız ad ve süre */
export function soldOutDigestLine(items: readonly SoldOutFact[], now: Date): string | null {
  const staff = oldestFirst(items.filter((i) => i.staff));
  if (!staff.length) return null;
  return `Personelin tükendi yaptığı ürünler: ${staff.map((i) => `${i.name} (${i.by}, ${soldOutAge(i.at, now)})`).join(", ")}`;
}

/** Kartın satır altı: "M · L · Selin, 21:40" */
export function soldOutMeta(entry: Pick<SoldOutEntry, "sizes" | "marker">, now: Date): string {
  const who = entry.marker ? `${entry.marker.by}, ${soldOutWhen(entry.marker.at, now)}` : null;
  return [...entry.sizes, who].filter(Boolean).join(" · ");
}
