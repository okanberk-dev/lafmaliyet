import { addDays, shiftMonth } from "@/lib/reminders";

import type { SiteReservation } from "./session";
import { cancelledAtFor, sessionChannel, siteTime } from "./site";

/**
 * Karaoke geçmişi (saf; tests/karaoke-doluluk.test.ts): laffogato.net'teki eski rezervasyonların bir kez alınması ve
 * KVKK saklama süresi. Panelin karaoke bağlantısı 21 Ekim 2026'da kuruldu; doluluk haritasının ay ay karşılaştırması
 * için öncesi siteden alınır (sitenin panel ucu geçmiş tarihleri de verir). Takvim ayı ay ay, en yeniden eskiye
 * okunur; süre yetmezse kaldığı aydan devam edilir. Geçmişten alınan satır ad ve not taşımaz. Sunucu tarafı
 * src/server/karaoke/history.ts; ayrıntı docs/KARAOKE.md › Doluluk haritası.
 */

/** İlk alınan ay (sitenin online satış kartıyla aynı başlangıç, docs/SITE-SATIS.md) */
export const HISTORY_START = "2026-01";

export interface HistoryMonth {
  /** O ayda sitede kaç rezervasyon vardı (iptaller dahil) */
  count: number;
  /** Ne zaman okundu */
  at: string;
}

export interface HistoryState {
  months: Record<string, HistoryMonth>;
  /** Alınan son gün: alma başlarken bugünden iki gün önce (sonrasını düzenli eşitleme getirir); ilk okunan ayla kaydedilir */
  through: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

export const EMPTY_HISTORY: HistoryState = { months: {}, through: null, lastRunAt: null, lastError: null };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const text = (v: unknown) => (typeof v === "string" ? v : null);

/** Kayıtlı durum (integration_state "karaoke_history"); bozuk alanlar yok sayılır */
export function parseHistoryState(v: unknown): HistoryState {
  if (!v || typeof v !== "object") return EMPTY_HISTORY;
  const raw = v as Record<string, unknown>;
  const months: Record<string, HistoryMonth> = {};
  if (raw.months && typeof raw.months === "object") {
    for (const [m, x] of Object.entries(raw.months as Record<string, unknown>)) {
      const item = x as { count?: unknown; at?: unknown } | null;
      if (MONTH_RE.test(m) && item && typeof item.count === "number" && typeof item.at === "string") months[m] = { count: item.count, at: item.at };
    }
  }
  const through = text(raw.through);
  return { months, through: through && DAY_RE.test(through) ? through : null, lastRunAt: text(raw.lastRunAt), lastError: text(raw.lastError) };
}

/** Geçmişin son günü: düzenli eşitleme dünden başlar, geçmiş ondan önceki güne kadar okunur (takvim günü, Türkiye) */
export function historyEnd(today: string): string {
  return addDays(today, -2);
}

/** Sitenin `from` / `to` penceresi (iki uç dahil, takvim günü); bir pencere bir takvim ayı, en çok 31 gün */
export interface HistoryWindow {
  month: string;
  from: string;
  to: string;
}

/** Ay ay pencereler, en yeni başta: `startMonth`tan `through`un ayına; son pencere `through`ta biter */
export function historyWindows(startMonth: string, through: string): HistoryWindow[] {
  const out: HistoryWindow[] = [];
  for (let m = through.slice(0, 7); m >= startMonth; m = shiftMonth(m, -1)) {
    const from = `${m}-01`;
    const last = addDays(`${shiftMonth(m, 1)}-01`, -1);
    const to = last < through ? last : through;
    if (from <= to) out.push({ month: m, from, to });
  }
  return out;
}

export interface HistoryProgress {
  /** Okunan ay / bütün aylar */
  done: number;
  total: number;
  complete: boolean;
  /** Okunan en eski ay */
  first: string | null;
  through: string;
}

/**
 * Kayıtlı son gün, ancak en az bir ay okunduysa: hiç ay okunmadan kalan son gün (ör. bozuk ay kaydı) almayı eski bir
 * güne bağlamasın; alma bugüne göre baştan başlar.
 */
function savedThrough(state: HistoryState): string | null {
  return Object.keys(state.months).length ? state.through : null;
}

/** Alma nereye kadar geldi: ilk kez alınırken bugünden iki gün öncesine kadarki aylar */
export function historyProgress(state: HistoryState, today: string): HistoryProgress {
  const through = savedThrough(state) ?? historyEnd(today);
  const windows = historyWindows(HISTORY_START, through);
  const done = windows.filter((w) => state.months[w.month]);
  return { done: done.length, total: windows.length, complete: done.length === windows.length, first: done.at(-1)?.month ?? null, through };
}

/**
 * Bu çalışmada okunacak pencereler. İlk alma ve "Yeniden al" (hepsi alınmışsa) bugünden iki gün öncesine kadar bütün
 * ayları en yeniden okur (geç gelen iade ve iptaller de gelir); yarım kalan alma ("Devam et") eksik aylardan sürer.
 */
export function historyPlan(state: HistoryState, today: string): { through: string; windows: HistoryWindow[]; reread: boolean } {
  const saved = savedThrough(state);
  const progress = historyProgress(state, today);
  if (!saved || progress.complete) {
    const through = historyEnd(today);
    return { through, windows: historyWindows(HISTORY_START, through), reread: Boolean(saved) && progress.done > 0 };
  }
  return { through: saved, windows: historyWindows(HISTORY_START, saved).filter((w) => !state.months[w.month]), reread: false };
}

/**
 * Okunan bir ayın kaydı; almanın son günü (`through`) yalnız onunla birlikte yazılır. Ay yazılmadan kaydedilen son gün
 * iki yanlış yapardı: ilk ayında düşen alma günler sonra yeniden basılınca eski son güne kadar okur (aradaki günler
 * düzenli eşitlemede de yoksa sessizce eksik kalır), ilk penceresinde düşen "Yeniden al" bitmiş almayı yarım gösterir.
 */
export function recordHistoryMonth(state: HistoryState, through: string, month: string, entry: HistoryMonth): HistoryState {
  return { ...state, through, months: { ...state.months, [month]: entry } };
}

/**
 * Geçmişten gelen rezervasyonun satıra yazılan sütunları: düzenli eşitlemedekilerle aynı, ad ve not hariç (KVKK: geçmiş
 * yalnız istatistik için tutulur). Kapatılan saatin notu ("Kapalı: …") da yazılmaz; türü kanalda kalır. Sayaç alanlarına (uzatma, bitti) ve zil alanlarına dokunulmaz.
 */
export function historyValues(r: SiteReservation) {
  return {
    externalId: r.id,
    source: "site" as const,
    date: r.date,
    startsAt: new Date(r.startsAt),
    endsAt: new Date(r.endsAt),
    guests: r.guests || null,
    status: r.status,
    paymentStatus: r.paymentStatus,
    totalMinor: r.totalMinor,
    refundMinor: r.refundMinor ?? null,
    // Köşkte alınan satır "desk", kapatılan saat "desk-block" (eşitlemeyle aynı kural; doluluk kapatılan saati saymaz)
    channel: sessionChannel(r),
    extUpdatedAt: r.updatedAt || null,
    bookedAt: siteTime(r.createdAt),
  };
}

/**
 * Geçmişten alınan iptalin anı. Panelin bildiği an korunur; yoksa ilk kez görülen satırın kuralı uygulanır (yalnız
 * ödeme akışı olmayanda sitenin son değişikliği): geçmiş, iptalden günler sonra okunabilir, "geçişi şimdi gördüm"
 * sayılmaz.
 */
export function historyCancelledAt(
  prev: Parameters<typeof cancelledAtFor>[0],
  r: Parameters<typeof cancelledAtFor>[1],
  now: Date,
): Date | null {
  return cancelledAtFor(prev?.cancelledAt ? prev : null, r, now);
}

interface Comparable {
  date: string;
  startsAt: Date;
  endsAt: Date;
  guests: number | null;
  status: string;
  paymentStatus: string;
  totalMinor: number | null;
  refundMinor: number | null;
  channel: string | null;
  bookedAt: Date | null;
  cancelledAt: Date | null;
}

const time = (d: Date | null) => d?.getTime() ?? null;

/** Satır değişmiş mi (değişmediyse yazılmaz); sitenin updatedAt'i tek başına yazım sebebi değil (eşitlemedeki gibi) */
export function historyChanged(prev: Comparable, next: Comparable): boolean {
  return (
    prev.date !== next.date ||
    time(prev.startsAt) !== time(next.startsAt) ||
    time(prev.endsAt) !== time(next.endsAt) ||
    prev.guests !== next.guests ||
    prev.status !== next.status ||
    prev.paymentStatus !== next.paymentStatus ||
    prev.totalMinor !== next.totalMinor ||
    prev.refundMinor !== next.refundMinor ||
    prev.channel !== next.channel ||
    time(prev.bookedAt) !== time(next.bookedAt) ||
    time(prev.cancelledAt) !== time(next.cancelledAt)
  );
}

/** 429'daki Retry-After: saniye ya da HTTP tarihi → ms (en çok 10 sn beklenir); yoksa ya da bozuksa null */
export function retryAfterMs(v: string | null, now = Date.now()): number | null {
  if (!v) return null;
  const sec = Number(v.trim());
  const ms = Number.isFinite(sec) ? sec * 1000 : Date.parse(v) - now;
  return Number.isFinite(ms) && ms >= 0 && ms <= 10_000 ? ms : null;
}

/**
 * Bir ayın yazımı düşerse yöneticiye gösterilen metin. Drizzle hatanın iletisine sorguyu ve bütün parametreleri koyar
 * (geçmişin tamamı); asıl neden `cause`'taki veritabanı hatasıdır. İlk satırı, kısaltılmış.
 */
export function writeErrorText(e: unknown): string {
  const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  const raw = cause instanceof Error ? cause.message : e instanceof Error ? e.message : String(e);
  const line = raw.split("\n")[0].trim() || "bilinmeyen hata";
  return `Kayıt yazılamadı (${line.length > 120 ? `${line.slice(0, 119)}…` : line})`;
}

/** Bir çalışmanın sonucu (sunucu eylemi istemciye döner) */
export interface HistoryRun {
  status: "ok" | "partial" | "error";
  /** Hepsi alınmıştı, baştan okundu ("Yeniden al") */
  reread: boolean;
  /** Bu çalışmada okunan aylar */
  read: string[];
  /** Okunmayı bekleyen aylar */
  remaining: string[];
  /** Bütün alma: okunan ay / bütün aylar */
  done: number;
  total: number;
  reservations: number;
  created: number;
  updated: number;
  error: string | null;
}

export type HistoryResult = { status: "off" } | HistoryRun;


// ---------------------------------------------------------------- KVKK

/** Misafirin adı ve notu bu kadar gün sonra silinir: sitenin kuralıyla aynı (laffogato #196, 3 × 366 gün) */
export const PERSONAL_DATA_DAYS = 3 * 366;

/** Bu günden (Türkiye takvim günü) önceki oturumların adı ve notu silinir; satır istatistik için kalır */
export function personalDataCutoff(today: string): string {
  return addDays(today, -PERSONAL_DATA_DAYS);
}
