import { dayLabel, isHold, timeRange, trClock, type KaraokeSessionDTO } from "./session";

/**
 * Rezervasyonsuz oturumun (hızlı sayaç) ya da bir oturumun uzatmasının sitedeki bir rezervasyonla çakışması (saf;
 * sunucu eylemi, ekran ve testler paylaşır; tests/karaoke-cakisma.test.ts). Oda tektir: barda bir grup rezervasyonsuz
 * başlatılırken ya da süre uzatılırken o saatte sitede hâlâ geçerli bir rezervasyon varsa personele sorulur. Kesin
 * engel değildir (bar, gelenin rezervasyonu yapan grup olduğunu bilebilir); onaylanınca yine de kaydedilir.
 *
 * Geçerli rezervasyon: sitenin (source "site"), iptal edilmemiş, ödeme sayfası açık bekleyen tutma değil, süresi dolup
 * düşmemiş ya da iade edilmemiş, panelde "bitti" denmemiş. Onay bekleyen (kasada ödenecek) talep ve ödenmiş rezervasyon
 * geçerlidir. Uç uca gelen saatler (20:00'de biten, 20:00'de başlayan) çakışmaz.
 */

export type OverlapSession = Pick<
  KaraokeSessionDTO,
  "id" | "source" | "customerName" | "startsAt" | "endsAt" | "extraMinutes" | "status" | "paymentStatus" | "endedAt"
>;

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

/** "Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var."; birden çok rezervasyonda hepsi sayılır. Yoksa null */
export function overlapText(list: readonly OverlapSession[], nowMs: number): string | null {
  if (!list.length) return null;
  if (list.length === 1) return `Bu saatte sitede ${describe(list[0], nowMs)} rezervasyon var.`;
  return `Bu saatte sitede ${list.length} rezervasyon var: ${list.map((s) => describe(s, nowMs)).join("; ")}.`;
}

/** Personele sorulan metin: "Bu saatte sitede Deniz adına 20:00–22:00 rezervasyon var. Yine de başlatılsın mı?" */
export function overlapMessage(list: readonly OverlapSession[], action: OverlapAction, nowMs: number): string | null {
  const text = overlapText(list, nowMs);
  return text ? `${text} ${action === "start" ? "Yine de başlatılsın mı?" : "Yine de uzatılsın mı?"}` : null;
}

/** Sunucunun sorduğu çakışma: eylem kaydetmeden döner, ekran onay alıp `force` ile yeniden gönderir */
export interface OverlapConflict {
  message: string;
  bookings: { id: number; name: string | null; startsAt: string; endsAt: string }[];
}

export function overlapConflict(list: readonly OverlapSession[], action: OverlapAction, nowMs: number): OverlapConflict | null {
  const message = overlapMessage(list, action, nowMs);
  if (!message) return null;
  return {
    message,
    bookings: list.map((s) => ({ id: s.id, name: s.customerName, startsAt: s.startsAt, endsAt: new Date(endOf(s)).toISOString() })),
  };
}

/** Uzatmanın yeni aldığı aralık: şimdiki bitişten (uzatmalar dahil) yeni bitişe */
export function extensionWindow(s: Pick<OverlapSession, "endsAt" | "extraMinutes">, addMinutes: number): { start: number; end: number } {
  const end = endOf(s);
  return { start: end, end: end + addMinutes * 60_000 };
}
