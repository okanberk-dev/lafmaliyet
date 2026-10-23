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

/**
 * Kartın bekleme satırı. Planlı sipariş (`scheduledFor`) ödemeden değil vaktinden sayılır: vakti gelmeden sakin
 * ("45 dk kaldı"), geçince "7 dk gecikti" (hâlâ yeniyse vurgulu). Akşam ödenen yarın sabahki gel-al, sabah bar açılınca
 * "9 sa önce ödendi" diye gecikmiş görünmüyordu artık. Planlı değilse ödemeden bu yana ("Ödendi · 12 dk önce"); yeni
 * sipariş 10 dakikayı geçince vurgulu.
 */
export function waitInfo(o: Pick<SiteOrder, "scheduledFor" | "paidAt" | "stage">, nowMs: number): { text: string; late: boolean } {
  const due = Date.parse(o.scheduledFor);
  if (o.scheduledFor && Number.isFinite(due)) {
    if (due > nowMs) return { text: `${waitLabel(Math.ceil((due - nowMs) / 60_000))} kaldı`, late: false };
    const late = Math.floor((nowMs - due) / 60_000);
    return { text: late < 1 ? "Vakti geldi" : `${waitLabel(late)} gecikti`, late: o.stage === "new" && late >= 1 };
  }
  const waited = minutesSince(o.paidAt, nowMs);
  return { text: `Ödendi · ${waitLabel(waited)}${waited >= 1 ? " önce" : ""}`, late: o.stage === "new" && waited >= 10 };
}

/** Planlı siparişin hazırlanma zili vaktinden bu kadar önce çalar */
export const DUE_SOON_MS = 15 * 60_000;
/** Ekran sonradan açılırsa vakti bundan çok geçmiş planlı siparişin zili çalmaz (kartı zaten "gecikti" der) */
const DUE_RING_LATE_MS = 15 * 60_000;
/** Bu kadar yeni ödenmiş siparişin hazırlanma zili çalmaz: geliş zili (ordersToRing) az önce çaldı */
const ARRIVAL_COVERS_MS = 120_000;

/**
 * Planlı siparişin hazırlanma zili: yeni (`new`) ve planlı bir sipariş vaktine 15 dakika kala bir kez çalar (cihaz
 * başına; `rung`: bu cihazda çalmış ya da sessizce geçilmiş planlı siparişler). Ekran sonradan açılırsa da (bar sabah
 * açılınca) vakti yaklaşmış ya da en çok 15 dakika geçmiş sipariş için çalar; daha geç olanınki çalmaz. Az önce
 * ödenmiş sipariş için çalmaz (geliş zili çaldı). `nextAt`: sıradaki planlı siparişin zil anı (ekran o ana zamanlayıcı
 * kurar); yoksa null.
 */
export function dueSoonToRing<T extends Pick<SiteOrder, "id" | "stage" | "fulfillment" | "paidAt" | "scheduledFor" | "orderNo">>(
  orders: readonly T[],
  rung: ReadonlySet<string>,
  nowMs: number,
): { ring: T[]; markRung: string[]; nextAt: number | null } {
  const ring: T[] = [];
  const markRung: string[] = [];
  let nextAt: number | null = null;
  for (const o of orders) {
    const due = Date.parse(o.scheduledFor);
    if (o.stage !== "new" || !o.scheduledFor || !Number.isFinite(due) || rung.has(o.id)) continue;
    const ringAt = due - DUE_SOON_MS;
    if (nowMs < ringAt) {
      nextAt = nextAt === null ? ringAt : Math.min(nextAt, ringAt);
      continue;
    }
    markRung.push(o.id);
    if (nowMs - due <= DUE_RING_LATE_MS && nowMs - Date.parse(o.paidAt) > ARRIVAL_COVERS_MS) ring.push(o);
  }
  return { ring: sortForScreen(ring), markRung, nextAt };
}

/** Hazırlanma zilinin metni: "Planlı sipariş · Gel-al" ve "09:00 için · 2× Latte, 1× Su"; adı geçmez (kilit ekranı) */
export function dueRingMessage(orders: readonly Pick<SiteOrder, "label" | "lines" | "scheduledFor">[], nowMs: number): { title: string; body: string } {
  if (!orders.length) return { title: "", body: "" };
  if (orders.length === 1) {
    const o = orders[0];
    const items = o.lines.map((l) => `${l.qty}× ${l.name}`);
    const list = items.length > 3 ? `${items.slice(0, 3).join(", ")} +${items.length - 3}` : items.join(", ");
    return { title: `Planlı sipariş · ${o.label}`, body: [scheduleLabel(o.scheduledFor, nowMs), list].filter(Boolean).join(" · ") };
  }
  return { title: `${orders.length} planlı siparişin vakti yaklaştı`, body: orders.map((o) => `${o.label} (${scheduleLabel(o.scheduledFor, nowMs) ?? ""})`).join(" · ") };
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
