import { blockReason } from "./desk";
import { dayLabel, isBlock, isHold, timeRange, trClock, type KaraokeSessionDTO } from "./session";

/**
 * Rezervasyonsuz oturumun (hızlı sayaç) ya da bir oturumun uzatmasının sitedeki bir rezervasyonla çakışması (saf;
 * sunucu eylemi, ekran ve testler paylaşır; tests/karaoke-cakisma.test.ts). Oda tektir: barda bir grup rezervasyonsuz
 * başlatılırken ya da süre uzatılırken o saatte sitede hâlâ geçerli bir rezervasyon varsa personele sorulur. Kesin
 * engel değildir (bar, gelenin rezervasyonu yapan grup olduğunu bilebilir); onaylanınca yine de kaydedilir.
 *
 * Geçerli rezervasyon: sitenin (source "site"), iptal edilmemiş, ödeme sayfası açık bekleyen tutma değil, süresi dolup
 * düşmemiş ya da iade edilmemiş, panelde "bitti" denmemiş. Onay bekleyen (kasada ödenecek) talep, ödenmiş rezervasyon ve
 * köşkte elle alınan rezervasyon geçerlidir. Köşkün kapattığı saatler (elle "Saati kapat") de odayı tutar ama
 * rezervasyon değildir: kendi sözüyle söylenir ("Bu saatler kapatıldı: 14:00–17:00"). Uç uca gelen saatler (20:00'de
 * biten, 20:00'de başlayan) çakışmaz.
 */

export type OverlapSession = Pick<
  KaraokeSessionDTO,
  "id" | "source" | "customerName" | "startsAt" | "endsAt" | "extraMinutes" | "status" | "paymentStatus" | "endedAt"
> &
  Partial<Pick<KaraokeSessionDTO, "desk" | "note">>;

/** Bu oturum odayı tutuyor mu (sitede hâlâ geçerli bir rezervasyon) */
export function holdsRoom(s: OverlapSession): boolean {
  if (s.source !== "site") return false;
  if (s.status === "cancelled" || isHold(s)) return false;
  if (s.paymentStatus === "expired" || s.paymentStatus === "refunded") return false;
  return !s.endedAt;
}

const startOf = (s: Pick<OverlapSession, "startsAt">) => Date.parse(s.startsAt);
/** Uzatmalar dahil bitiş */
const endOf = (s: Pick<OverlapSession, "endsAt" | "extraMinutes">) => Date.parse(s.endsAt) + s.extraMinutes * 60_000;

/** [start, end) aralığıyla çakışan geçerli rezervasyonlar, başlangıç sırasıyla; `excludeId` (uzatılan oturum) sayılmaz */
export function siteOverlaps<T extends OverlapSession>(window: { start: number; end: number }, sessions: readonly T[], excludeId?: number): T[] {
  if (!(window.end > window.start)) return [];
  return sessions
    .filter((s) => s.id !== excludeId && holdsRoom(s) && startOf(s) < window.end && endOf(s) > window.start)
    .sort((a, b) => startOf(a) - startOf(b) || a.id - b.id);
}

/** "Deniz adına 20:00–22:00" (bugün değilse "Yarın 00:30–02:00"); adsız rezervasyonda yalnız saat */
function describe(s: OverlapSession, nowMs: number): string {
  const start = startOf(s);
  const date = trClock(start).date;
  const range = `${date === trClock(nowMs).date ? "" : `${dayLabel(date, nowMs)} `}${timeRange(start, endOf(s))}`;
  const name = s.customerName?.trim();
  return name ? `${name} adına ${range}` : range;
}

export type OverlapAction = "start" | "extend";

/** Kapatılan saat: "14:00–17:00 (özel etkinlik)"; bugün değilse günüyle */
function describeBlock(s: OverlapSession, nowMs: number): string {
  const start = startOf(s);
  const date = trClock(start).date;
  const range = `${date === trClock(nowMs).date ? "" : `${dayLabel(date, nowMs)} `}${timeRange(start, endOf(s))}`;
  const reason = blockReason(s.note);
  return reason ? `${range} (${reason})` : range;
}

/**
 * "Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var."; birden çok rezervasyonda hepsi sayılır. Kapatılan saatler
 * ayrı cümle: "Bu saatler kapatıldı: 14:00–17:00 (özel etkinlik)." Yoksa null
 */
export function overlapText(list: readonly OverlapSession[], nowMs: number): string | null {
  if (!list.length) return null;
  const bookings = list.filter((s) => !isBlock(s));
  const blocks = list.filter(isBlock);
  const parts: string[] = [];
  if (bookings.length === 1) parts.push(`Bu saatte sitede ${describe(bookings[0], nowMs)} rezervasyon var.`);
  else if (bookings.length) parts.push(`Bu saatte sitede ${bookings.length} rezervasyon var: ${bookings.map((s) => describe(s, nowMs)).join("; ")}.`);
  if (blocks.length) parts.push(`Bu saatler kapatıldı: ${blocks.map((s) => describeBlock(s, nowMs)).join("; ")}.`);
  return parts.join(" ");
}

/** Sorunun başlığı: yalnız kapatılan saatse "Bu saatler kapalı", değilse "Sitede rezervasyon var" */
export function overlapTitle(list: readonly OverlapSession[]): string {
  return list.length && list.every(isBlock) ? "Bu saatler kapalı" : "Sitede rezervasyon var";
}

/** Personele sorulan metin: "Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var. Yine de başlatılsın mı?" */
export function overlapMessage(list: readonly OverlapSession[], action: OverlapAction, nowMs: number): string | null {
  const text = overlapText(list, nowMs);
  return text ? `${text} ${action === "start" ? "Yine de başlatılsın mı?" : "Yine de uzatılsın mı?"}` : null;
}

/** Sunucunun sorduğu çakışma: eylem kaydetmeden döner, ekran onay alıp `force` ile yeniden gönderir */
export interface OverlapConflict {
  /** Sorunun başlığı (overlapTitle) */
  title: string;
  message: string;
  bookings: { id: number; name: string | null; startsAt: string; endsAt: string }[];
}

export function overlapConflict(list: readonly OverlapSession[], action: OverlapAction, nowMs: number): OverlapConflict | null {
  const message = overlapMessage(list, action, nowMs);
  if (!message) return null;
  return {
    title: overlapTitle(list),
    message,
    bookings: list.map((s) => ({ id: s.id, name: s.customerName, startsAt: s.startsAt, endsAt: new Date(endOf(s)).toISOString() })),
  };
}

/** Uzatmanın yeni aldığı aralık: şimdiki bitişten (uzatmalar dahil) yeni bitişe */
export function extensionWindow(s: Pick<OverlapSession, "endsAt" | "extraMinutes">, addMinutes: number): { start: number; end: number } {
  const end = endOf(s);
  return { start: end, end: end + addMinutes * 60_000 };
}
