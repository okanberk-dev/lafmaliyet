import { dayLabel, trClock } from "@/lib/karaoke/session";

import type { OrderStage, SiteOrder, SiteOrderLine } from "./schema";

/**
 * Bar ekranının sipariş kuralları (saf; sunucu, ekran ve testler paylaşır): sitenin listesinde ilk kez görülen yeni
 * sipariş, listenin değişip değişmediği, kartın metinleri, sıralama ve "Sitede aç" adresi. Ayrıntı: docs/SITE-SIPARIS.md.
 */

export const STAGE_LABEL: Record<OrderStage, string> = { new: "Yeni", preparing: "Hazırlanıyor", ready: "Teslime hazır" };

/**
 * Sitenin listesinde ilk kez görülen yeni (`new`) siparişler: önceki listede kimliği olmayanlar. Önceki liste hiç
 * yoksa (ilk çekme) hiçbiri yeni sayılmaz: panel ilk kez bağlanınca o an açık olan siparişler için bildirim gitmez.
 */
export function newOrderIds(prev: readonly Pick<SiteOrder, "id">[] | null, next: readonly Pick<SiteOrder, "id" | "stage">[]): string[] {
  if (!prev) return [];
  const known = new Set(prev.map((o) => o.id));
  return next.filter((o) => o.stage === "new" && !known.has(o.id)).map((o) => o.id);
}

/** Ekranda görünen her şeyin özeti: aynıysa liste değişmemiştir (sürüm artmaz, açık sekmeler veri indirmez) */
export function ordersFingerprint(orders: readonly SiteOrder[]): string {
  return JSON.stringify(
    orders.map((o) => [o.id, o.orderNo, o.stage, o.fulfillment, o.label, o.firstName, o.scheduledFor, o.paidAt, o.path, o.lines.map((l) => [l.menuItemId, l.name, l.size, l.detail, l.qty])]),
  );
}

/** "Latte · M · yulaf · +1 shot": ad ve seçenekler (sitenin yazdığı gibi) */
export function lineLabel(line: Pick<SiteOrderLine, "name" | "detail">): string {
  return `${line.name}${line.detail ? ` · ${line.detail}` : ""}`;
}

/** "2× Latte · M · yulaf · +1 shot" */
export function lineText(line: Pick<SiteOrderLine, "qty" | "name" | "detail">): string {
  return `${line.qty}× ${lineLabel(line)}`;
}

/** Bugünse "14:30 için", değilse "Yarın 09:00 için" (Türkiye saati); planlı değilse null */
export function scheduleLabel(scheduledFor: string, nowMs: number): string | null {
  const at = Date.parse(scheduledFor);
  if (!scheduledFor || !Number.isFinite(at)) return null;
  const c = trClock(at);
  const day = c.date === trClock(nowMs).date ? "" : `${dayLabel(c.date, nowMs)} `;
  return `${day}${c.time} için`;
}

/** Ödemeden bu yana geçen dakika (saat farkıyla eksiye düşmez) */
export function minutesSince(iso: string, nowMs: number): number {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 60_000)) : 0;
}

/** "az önce", "7 dk", "1 sa 5 dk" */
export function waitLabel(minutes: number): string {
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

/** Vakti: planlı saat, yoksa ödeme anı (sitenin sıralamasıyla aynı) */
export function dueAt(o: Pick<SiteOrder, "scheduledFor" | "paidAt">): number {
  const s = Date.parse(o.scheduledFor);
  if (o.scheduledFor && Number.isFinite(s)) return s;
  const p = Date.parse(o.paidAt);
  return Number.isFinite(p) ? p : 0;
}

/**
 * Ekranın sırası: önce hazırlanacaklar (yeni ve hazırlanan), masa siparişi en önde, sonra vakti en yakın olan, sonra
 * sipariş numarası; en sonda tezgâhta bekleyen gel-al'lar (teslime hazır).
 */
export function sortForScreen<T extends Pick<SiteOrder, "stage" | "fulfillment" | "scheduledFor" | "paidAt" | "orderNo">>(orders: readonly T[]): T[] {
  const group = (o: T) => (o.stage === "ready" ? 1 : 0);
  const table = (o: T) => (o.fulfillment === "table" ? 0 : 1);
  return [...orders].sort((a, b) => group(a) - group(b) || table(a) - table(b) || dueAt(a) - dueAt(b) || a.orderNo - b.orderNo);
}

/**
 * Siparişin sitenin panelindeki adresi: sitenin kökü + yol. Yol güvenli değilse ya da adres sitenin kökünden çıkıyorsa
 * null (bağlantı gösterilmez).
 */
export function siteOrderUrl(siteBase: string, path: string): string | null {
  if (!path || !path.startsWith("/admin/")) return null;
  try {
    const base = new URL(siteBase);
    const url = new URL(path, base);
    return url.origin === base.origin ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Bu ekranın çalacağı siparişler: `new` aşamasında ve bu cihazın daha önce görmediği. Masa siparişi önce. İlk yüklemede
 * (`first`) son `freshMs` içinde ödenmemiş eski yeniler sessizce görülmüş sayılır: uzun süre kapalı kalıp açılan sayfa
 * bekleyen her sipariş için çalmasın (kartları zaten vurgulu). Cihazın gördüğü sipariş (`seen`) hiç yeniden çalmaz.
 */
export function ordersToRing<T extends Pick<SiteOrder, "id" | "stage" | "fulfillment" | "paidAt" | "scheduledFor" | "orderNo">>(
  orders: readonly T[],
  seen: ReadonlySet<string>,
  opts: { first: boolean; nowMs: number; freshMs?: number },
): { ring: T[]; markSeen: string[] } {
  const fresh = opts.freshMs ?? 120_000;
  const unseen = orders.filter((o) => o.stage === "new" && !seen.has(o.id));
  const ring = unseen.filter((o) => !opts.first || opts.nowMs - Date.parse(o.paidAt) <= fresh);
  return { ring: sortForScreen(ring), markSeen: unseen.map((o) => o.id) };
}

/** Zil ve bildirim metni: "Yeni sipariş · Masa 4" ve satırlar ("2× Latte, 1× Su"); adı geçmez (kilit ekranı) */
export function ringMessage(orders: readonly Pick<SiteOrder, "label" | "lines">[]): { title: string; body: string } {
  if (!orders.length) return { title: "", body: "" };
  if (orders.length === 1) {
    const o = orders[0];
    const items = o.lines.map((l) => `${l.qty}× ${l.name}`);
    return { title: `Yeni sipariş · ${o.label}`, body: items.length > 3 ? `${items.slice(0, 3).join(", ")} +${items.length - 3}` : items.join(", ") };
  }
  return { title: `${orders.length} yeni sipariş`, body: orders.map((o) => o.label).join(" · ") };
}
