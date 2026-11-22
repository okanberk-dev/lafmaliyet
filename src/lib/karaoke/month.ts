import { isBlock, isLive, sessionEnd, sessionStart, type KaraokeSessionDTO } from "./session";

/** Karaoke ekranındaki "Bu ay" kartının rakamları (yalnız yönetici; src/app/panel/karaoke/karaoke-admin.tsx) */
export interface MonthStats {
  reservations: number;
  hours: number;
  revenueMinor: number;
  cancelled: number;
  walkIns: number;
  walkInHours: number;
}

/**
 * Bu ayın özeti (saf; tests/karaoke-elle.test.ts): sitenin rezervasyonları (saat, ciro, iptal; köşkte elle alınanlar
 * dahil, ödemesi köşkte: "kasada ödenecek" olarak ciroya girer) ve panelden açılan sayaçlar. Köşkün kapattığı saatler
 * rezervasyon değildir: hiçbir sayıya girmez (kaldırılan kapatma da iptal sayılmaz).
 */
export function monthStats(rows: KaraokeSessionDTO[]): MonthStats {
  const site = rows.filter((r) => r.source === "site" && !isBlock(r));
  const live = site.filter(isLive);
  const hours = (r: KaraokeSessionDTO) => (sessionEnd(r) - sessionStart(r)) / 3_600_000;
  const timers = rows.filter((r) => r.source === "panel");
  return {
    reservations: live.length,
    hours: live.reduce((a, r) => a + hours(r), 0),
    revenueMinor: live.filter((r) => r.paymentStatus === "paid" || r.paymentStatus === "none").reduce((a, r) => a + (r.totalMinor ?? 0), 0),
    cancelled: site.filter((r) => r.status === "cancelled" && r.paymentStatus !== "expired").length,
    walkIns: timers.length,
    walkInHours: timers.reduce((a, r) => a + hours(r), 0),
  };
}
