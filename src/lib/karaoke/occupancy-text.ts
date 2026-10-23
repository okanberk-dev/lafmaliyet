import { MONTH_NAMES } from "@/lib/constants";
import { monthLabel, num, tl } from "@/lib/format";
import { addDays, dayMonthTR } from "@/lib/reminders";

import type { HistoryRun } from "./history";
import {
  busiestBlock,
  emptiestBlock,
  INSIGHT_MIN_DAYS,
  INSIGHT_MIN_SESSIONS,
  LATE_CANCEL_HOURS,
  type GridCell,
  type OccupancyGrid,
  type OccupancySummary,
  type Period,
  type RoomHours,
} from "./occupancy";

/**
 * Doluluk ekranının Türkçe metinleri (saf; tests/karaoke-doluluk.test.ts). Rakamdan ve tarihten sonra ek gelmez
 * ("12 oturumun 3'ü" yerine "3 / 12 oturum"): ek rakamın okunuşuna göre değişir, yanlış yazılmasın.
 */

export const WEEKDAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
export const WEEKDAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const two = (n: number) => String(n).padStart(2, "0");

/** İş günü saati → "10:00"; 24 → "00:00", 25 → "01:00" */
export function hourLabel(h: number): string {
  return `${two(h % 24)}:00`;
}

/** Saat aralığı: (14, 17) "14–17", gece yarısını geçen (23, 25) "23–01", tam gece yarısında biten (21, 24) "21–24" */
export function hourRangeLabel(h0: number, h1: number): string {
  return `${two(h0 % 24)}–${h1 === 24 ? "24" : two(h1 % 24)}`;
}

/** "10:00–22:00", "12:00–02:00" */
export function hoursText(h: RoomHours): string {
  return `${hourLabel(h.open)}–${hourLabel(h.close)}`;
}

/** Kapanış seçeneği: 22 "22:00", 24 "00:00 (gece yarısı)", 26 "02:00 (ertesi gün)" */
export function closeOptionLabel(h: number): string {
  if (h < 24) return hourLabel(h);
  return `${hourLabel(h)} (${h === 24 ? "gece yarısı" : "ertesi gün"})`;
}

/** "Salı", "Salı–Perşembe" */
export function weekdayRange(d0: number, d1: number): string {
  return d0 === d1 ? WEEKDAY_NAMES[d0] : `${WEEKDAY_NAMES[d0]}–${WEEKDAY_NAMES[d1]}`;
}

/** Ardışık saatler aralık olarak: [24, 25] → "00:00–02:00"; [8, 24, 25] → "08:00–09:00, 00:00–02:00" */
export function hourRangesText(hours: number[]): string {
  const sorted = [...hours].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(`${hourLabel(sorted[i])}–${hourLabel(sorted[j] + 1)}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** "2 sa 10 dk", "35 dk", "2 sa" */
export function minutesText(min: number): string {
  const t = Math.round(min);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return [h ? `${h} sa` : "", m || !h ? `${m} dk` : ""].filter(Boolean).join(" ");
}

/** "21 Ekim 2026" */
export function longDayText(date: string): string {
  return `${dayMonthTR(date)} ${date.slice(0, 4)}`;
}

/** "Ocak–Eylül 2026", "Aralık 2025–Ocak 2026", "Eylül 2026" */
export function monthsRange(months: string[]): string {
  if (!months.length) return "";
  const sorted = [...months].sort();
  const [a, b] = [sorted[0], sorted[sorted.length - 1]];
  if (a === b) return monthLabel(a);
  const name = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
  return a.slice(0, 4) === b.slice(0, 4) ? `${name(a)}–${name(b)} ${b.slice(0, 4)}` : `${monthLabel(a)}–${monthLabel(b)}`;
}

/** Oranın yüzdesi (işaretsiz): 0,75 → "75"; sıfır değil ama yuvarlanınca sıfır olacaksa bir ondalık ("0,4") */
function percentNumber(r: number): string {
  const p = r * 100;
  return p > 0 && p < 0.5 ? num(p, 1) : num(p, 0);
}

/** "%75", "%0,4" */
export const percentText = (r: number) => `%${percentNumber(r)}`;

/** Puan farkı: +0,06 → "+6 puan", −0,04 → "−4 puan", yarım puandan az fark "aynı" */
export function pointsText(delta: number): string {
  const p = Math.round(delta * 100);
  if (p === 0) return "aynı";
  return p > 0 ? `+${p} puan` : `−${-p} puan`;
}

/** Ekranın üstündeki dönem satırı (bugün hiç sayılmaz; ay bitmediyse dünkü güne kadar) */
export function periodLine(p: Period, hours: RoomHours): string {
  const room = `oda saatleri ${hoursText(hours)}`;
  const last = addDays(p.to, -1);
  if (p.kind === "ay" && p.month) {
    const title = monthLabel(p.month);
    if (!p.partial) return `${title} · ${p.days} gün · ${room}`;
    const span = p.days === 0 ? "henüz tamamlanmış gün yok" : p.days === 1 ? dayMonthTR(p.from) : `${Number(p.from.slice(8))}–${dayMonthTR(last)}`;
    return `${title} · ${span} · ${room} · bugün sayılmaz`;
  }
  return `${dayMonthTR(p.from)} – ${dayMonthTR(last)} · ${p.days} gün · ${room} · bugün sayılmaz`;
}

/** Isı haritasının beş basamağı: 0 | %1–24 | %25–49 | %50–74 | %75+; kapalı saatte (ya da o gün dönemde yoksa) null */
export function bucket(ratio: number | null): 0 | 1 | 2 | 3 | 4 | null {
  if (ratio === null) return null;
  if (ratio <= 0) return 0;
  return ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
}

/** Hücredeki rakam (yüzde işaretsiz): kapalı saatte boş, o gün dönemde yoksa "–", sıfır değil ama yuvarlanınca 0 ise "<1" */
export function cellNumber(c: GridCell): string {
  if (c.ratio === null) return c.open ? "–" : "";
  if (c.ratio > 0 && c.ratio < 0.005) return "<1";
  return num(c.ratio * 100, 0);
}

function sessionsPart(c: GridCell): string | null {
  const parts = [c.site ? `${c.site} rezervasyon` : null, c.panel ? `${c.panel} rezervasyonsuz oturum` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Hücrenin ekran okuyucu adı: "Cuma 21:00, yüzde 75 dolu", "Salı 08:00, kapalı" */
export function cellLabel(c: GridCell): string {
  const at = `${WEEKDAY_NAMES[c.weekday]} ${hourLabel(c.hour)}`;
  if (!c.open) return c.outsideMin > 0 ? `${at}, oda saatleri dışında, ${num(Math.round(c.outsideMin))} dakika dolu` : `${at}, kapalı`;
  if (c.ratio === null) return `${at}, bu dönemde bu gün yok`;
  return `${at}, yüzde ${percentNumber(c.ratio)} dolu`;
}

/** Seçilen hücrenin ayrıntı satırı */
export function cellDetail(c: GridCell): string {
  const at = `${WEEKDAY_NAMES[c.weekday]} ${hourLabel(c.hour)}–${hourLabel(c.hour + 1)}`;
  const used = `kullanılan gün ${c.busyDays} / ${c.days}`;
  if (!c.open) {
    if (c.outsideMin <= 0) return `${at} · kapalı (oda saatleri dışında)`;
    return [at, "oda saatleri dışında", `${minutesText(c.outsideMin)} dolu`, used, sessionsPart(c)].filter(Boolean).join(" · ");
  }
  if (c.ratio === null) return `${at} · bu dönemde bu gün yok`;
  const guests = c.guestsAvg !== null ? `ortalama ${num(c.guestsAvg, 1)} kişi` : null;
  return [at, `${percentText(c.ratio)} dolu`, used, sessionsPart(c), guests].filter(Boolean).join(" · ");
}

/** Öne çıkanlar: en çok iki satır; hesaplanmıyorsa nedeni (ekranda soluk tek satır) */
export function insightLines(grid: OccupancyGrid, s: OccupancySummary, p: Period): { lines: string[]; reason: string | null } {
  const n = s.sessions.site + s.sessions.panel;
  if (p.days === 0) return { lines: [], reason: "Bu ayın tamamlanmış günü yok; geçen ayı seçin." };
  if (n === 0) return { lines: [], reason: "Bu dönemde oturum yok." };
  if (p.days < INSIGHT_MIN_DAYS || n < INSIGHT_MIN_SESSIONS) {
    const now = p.days < INSIGHT_MIN_DAYS ? `${p.days} gün, ${n} oturum` : `${n} oturum`;
    return { lines: [], reason: `Öne çıkanlar için en az 2 haftalık ve ${INSIGHT_MIN_SESSIONS} oturumluk veri gerekiyor (bu dönemde ${now}).` };
  }
  const lines: string[] = [];
  const empty = emptiestBlock(grid);
  if (empty) lines.push(`En boş saatler: ${weekdayRange(empty.d0, empty.d1)} ${hourRangeLabel(empty.h0, empty.h1)} · ${percentText(empty.ratio)} dolu`);
  const c = s.cancellations;
  if (c.lateRate !== null && c.lateRate >= 0.15 && c.late >= 3) {
    lines.push(`Son ${LATE_CANCEL_HOURS} saatte iptal: ${c.late} rezervasyon (${percentText(c.lateRate)})`);
  } else {
    const busy = busiestBlock(grid);
    if (busy) lines.push(`En dolu saatler: ${weekdayRange(busy.d0, busy.d1)} ${hourRangeLabel(busy.h0, busy.h1)} · ${percentText(busy.ratio)} dolu`);
  }
  return { lines, reason: lines.length ? null : "Belirgin bir boş ya da dolu saat yok." };
}

export type KpiKey = "occupancy" | "revenue" | "extension" | "cancel" | "lead";

/** Saat sayısı: 10'dan azsa bir ondalık ("4,5"), değilse tam */
function hoursNumber(min: number): string {
  const h = min / 60;
  return num(h, h > 0 && h < 10 ? 1 : 0);
}

/** Beş göstergenin rakamı ve alt satırı (eğik çizgili biçim: "3 / 12 oturum", rakamdan sonra ek yok) */
export function kpiTexts(s: OccupancySummary): Record<KpiKey, { value: string; sub: string }> {
  const occupancy =
    s.ratio === null
      ? { value: "–", sub: s.days ? "Bu dönemde açık saat yok" : "Tamamlanmış gün yok" }
      : { value: percentText(s.ratio), sub: `${hoursNumber(s.occupiedMin)} / ${hoursNumber(s.capacityMin)} saat dolu` };

  const r = s.revenue;
  const revenue =
    r.perHour === null
      ? { value: "–", sub: "Bu dönemde ücreti bilinen oturum yok" }
      : { value: tl(r.perHour / 100), sub: r.perOpenHour !== null ? `Rezervasyon ücretleri · açık saat başına ${tl(r.perOpenHour / 100)}` : "Rezervasyon ücretleri" };

  const e = s.extension;
  const extension =
    !e.total || e.rate === null
      ? { value: "–", sub: "Bu dönemde oturum yok" }
      : { value: percentText(e.rate), sub: e.extended ? `${e.extended} / ${e.total} oturum uzatıldı · ortalama +${num(e.avgMinutes, 0)} dk` : "Uzatılan oturum yok" };

  const c = s.cancellations;
  const cancel =
    !c.bookings || c.lateRate === null
      ? { value: "–", sub: "Bu dönemde site rezervasyonu yok" }
      : {
          value: percentText(c.lateRate),
          sub: c.cancelled
            ? [`${c.late} / ${c.bookings} rezervasyon son ${LATE_CANCEL_HOURS} saatte`, `toplam ${c.cancelled} iptal`, c.unknownTime ? `${c.unknownTime} iptalin zamanı bilinmiyor` : null]
                .filter(Boolean)
                .join(" · ")
            : `${c.bookings} rezervasyon · iptal yok`,
        };

  const l = s.lead;
  let lead: { value: string; sub: string };
  if (!l.n || l.avgDays === null) {
    lead = { value: "–", sub: l.missing ? `${l.missing} rezervasyonun tarihi yok` : "Bu dönemde site rezervasyonu yok" };
  } else {
    const parts = ["ortalama", l.medianDays === 0 ? "yarısı aynı gün" : `yarısı en çok ${num(l.medianDays, 1)} gün önceden`];
    if (l.medianDays !== 0 && l.sameDayShare) parts.push(`${percentText(l.sameDayShare)} aynı gün`);
    if (l.missing) parts.push(`${l.missing} rezervasyonun tarihi yok`);
    lead = { value: `${num(l.avgDays, 1)} gün`, sub: parts.join(" · ") };
  }

  return { occupancy, revenue, extension, cancel, lead };
}

/** Geçmişi siteden alma bitince çıkan bildirim (sunucu eyleminin sonucu) */
export function historyToast(r: HistoryRun): { tone: "success" | "info" | "error"; text: string } {
  if (r.status === "ok") return { tone: "success", text: `Geçmiş alındı: ${r.read.length} ay, ${r.reservations} rezervasyon` };
  const head = `${r.done} / ${r.total} ay alındı`;
  if (r.status === "partial") return { tone: "info", text: `${head}; kalanı için Devam et'e basın` };
  return { tone: "error", text: `${head}. ${r.error ?? "Bilinmeyen hata"}` };
}
