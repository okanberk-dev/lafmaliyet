import { addDays, daysBetween, shiftMonth } from "@/lib/reminders";

import { isCancelledBooking, isHold, type KaraokeStatus, type PaymentStatus } from "./session";

/**
 * Karaoke odasının doluluğu (saf; tests/karaoke-doluluk.test.ts): hangi gün ve saatte oda dolu, hangisinde boş; saat
 * başına gelir, uzatma, son dakika iptal ve rezervasyonların kaç gün önceden yapıldığı. Zamanlar Türkiye saatiyle
 * (UTC+3, yaz saati yok: Türkiye saatinin saat başları UTC'nin saat başlarıdır); iş günü kasa raporu gibi 05:00'te
 * döner, gece 00:30'daki oturum önceki günün satırına düşer. Bugün hiç sayılmaz (yarım kalan akşam her karşılaştırmayı
 * kötü gösterirdi). Ekran metinleri occupancy-text.ts'te. Ayrıntı: docs/KARAOKE.md › Doluluk haritası.
 */

/** Oda tektir (docs/KARAOKE.md › Çakışma uyarısı; site oda bilgisi göndermez). Hesap oda sayısını parametre alır */
export const KARAOKE_ROOMS = 1;
/** Başlangıçtan önceki bu kadar saat içinde (ya da başladıktan sonra) yapılan iptal "son dakika" sayılır */
export const LATE_CANCEL_HOURS = 24;
/** İş günü bu saatte döner (kasa raporuyla aynı) */
export const DAY_START_HOUR = 5;
/** Öne çıkanlar (en boş / en dolu saatler) en az bu kadar gün ve oturumla hesaplanır */
export const INSIGHT_MIN_DAYS = 14;
export const INSIGHT_MIN_SESSIONS = 8;

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const TR_OFFSET_MS = 3 * HOUR_MS;

// ---------------------------------------------------------------- Oda saatleri

/** Oda saatleri, iş günü ölçeğinde: 5 ≤ açılış ≤ 23, açılış < kapanış ≤ 29 (24 = gece yarısı, 26 = ertesi gün 02:00) */
export interface RoomHours {
  open: number;
  close: number;
}

/** Sahibin varsayılanı: her gün 10:00–22:00 (AVM saatleri; Ayarlar'da değil, Doluluk ekranında değişir) */
export const DEFAULT_ROOM_HOURS: RoomHours = { open: 10, close: 22 };

/** Kayıtlı oda saatleri; bozuk ya da sınır dışıysa null (çağıran varsayılana düşer) */
export function parseRoomHours(v: unknown): RoomHours | null {
  if (!v || typeof v !== "object") return null;
  const { open, close } = v as { open?: unknown; close?: unknown };
  if (typeof open !== "number" || typeof close !== "number" || !Number.isInteger(open) || !Number.isInteger(close)) return null;
  return open >= DAY_START_HOUR && open <= 23 && close > open && close <= 24 + DAY_START_HOUR ? { open, close } : null;
}

const isOpenHour = (h: number, hours: RoomHours) => h >= hours.open && h < hours.close;

// ---------------------------------------------------------------- Zaman

/** Anın iş günü ("YYYY-MM-DD"): Türkiye saatiyle 05:00'ten önce bir önceki gün */
export function businessDay(ms: number): string {
  return new Date(ms + TR_OFFSET_MS - DAY_START_HOUR * HOUR_MS).toISOString().slice(0, 10);
}

/** Türkiye saatiyle saat (0–23) */
export function clockHour(ms: number): number {
  return new Date(ms + TR_OFFSET_MS).getUTCHours();
}

/** Saatin iş günü ölçeğindeki karşılığı: gece 00–04 → 24–28 (önceki günün sütunları) */
export function businessHour(clock: number): number {
  return clock < DAY_START_HOUR ? clock + 24 : clock;
}

/** Haftanın günü, pazartesi 0 … pazar 6 */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** İş gününün başladığı an: o gün Türkiye saatiyle 05:00 */
export function dayStart(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) + DAY_START_HOUR * HOUR_MS - TR_OFFSET_MS;
}

/** Türkiye takvim günü (rezervasyonun yapıldığı gün; iş günü değil: gece 01:00'de yapılan rezervasyon o günün) */
const trDate = (ms: number) => new Date(ms + TR_OFFSET_MS).toISOString().slice(0, 10);

// ---------------------------------------------------------------- Oturum

/** Hesaba giren oturum: veritabanı satırının ad ve not içermeyen kısmı, zamanlar ms */
export interface OccSession {
  id: number;
  source: "site" | "panel";
  startsAt: number;
  /** Rezervasyonun bitişi; uzatma eklenmeden */
  endsAt: number;
  extraMinutes: number;
  /** "Erken bitir" ya da süre dolunca "Haber verdim" */
  endedAt: number | null;
  guests: number | null;
  status: KaraokeStatus;
  paymentStatus: PaymentStatus;
  /** Sitedeki ücret (kuruş, KDV dahil); sayaçta boş */
  totalMinor: number | null;
  /** Sitede rezervasyonun yapıldığı an */
  bookedAt: number | null;
  /** İptal anı; bilinmiyorsa null */
  cancelledAt: number | null;
}

/** Yükleyicinin seçtiği sütunlar (Date alanlar; src/server/karaoke/occupancy.ts) */
export interface OccRow {
  id: number;
  source: "site" | "panel";
  startsAt: Date;
  endsAt: Date;
  extraMinutes: number;
  endedAt: Date | null;
  guests: number | null;
  status: string;
  paymentStatus: string;
  totalMinor: number | null;
  bookedAt: Date | null;
  cancelledAt: Date | null;
  lastEvent: string | null;
  lastEventAt: Date | null;
}

/**
 * Satır → hesap. İptal anı yoksa ve eşitleme iptal için zil çaldıysa (sütunlardan önceki iptaller) zilin anı kullanılır:
 * ping saniyeler içinde geldiği için iptal anına yakındır.
 */
export function rowToOcc(r: OccRow): OccSession {
  const cancelledAt = r.cancelledAt ?? (r.lastEvent === "cancelled" ? r.lastEventAt : null);
  return {
    id: r.id,
    source: r.source,
    startsAt: r.startsAt.getTime(),
    endsAt: r.endsAt.getTime(),
    extraMinutes: r.extraMinutes,
    endedAt: r.endedAt?.getTime() ?? null,
    guests: r.guests,
    status: r.status as KaraokeStatus,
    paymentStatus: r.paymentStatus as PaymentStatus,
    totalMinor: r.totalMinor,
    bookedAt: r.bookedAt?.getTime() ?? null,
    cancelledAt: cancelledAt?.getTime() ?? null,
  };
}

/**
 * Odayı tutan oturum: paneldeki sayaç her zaman; sitedeki rezervasyon iptal, ödenmemiş tutma, süresi dolan ödeme ve
 * iade değilse (onay bekleyen kasada ödemeli talep dahil; sayacın isPlayable kuralı, iade sürerken de boş)
 */
export function isOccupying(s: Pick<OccSession, "source" | "status" | "paymentStatus">): boolean {
  if (s.source === "panel") return true;
  if (s.status === "cancelled" || isHold(s)) return false;
  return s.paymentStatus !== "expired" && s.paymentStatus !== "refunded" && s.paymentStatus !== "refunding";
}

/**
 * Odanın dolu olduğu aralık: başlangıçtan bitişe (uzatma dahil). Erken bitirilen oturum bittiği anda boşalır; süre
 * dolduktan sonraki "Haber verdim" doluluğu uzatmaz (o dakikalar satılmadı). Odayı tutmayan ya da başlar başlamaz
 * bitirilen (gelmeyen) oturumda null.
 */
export function occupiedInterval(s: OccSession): { start: number; end: number } | null {
  if (!isOccupying(s)) return null;
  const start = s.startsAt;
  let end = s.endsAt + s.extraMinutes * MIN_MS;
  if (s.endedAt !== null && s.endedAt < end) end = Math.max(start, s.endedAt);
  return end > start ? { start, end } : null;
}

// ---------------------------------------------------------------- Dönem

export type PeriodKind = "4h" | "12h" | "ay";

/** İş günleri [from, to): `to` hariç, en geç bugün (bugün sayılmaz) */
export interface Period {
  kind: PeriodKind;
  /** Yalnız "ay": YYYY-MM */
  month: string | null;
  from: string;
  to: string;
  days: number;
  /** İçinde bulunulan ay: dünkü güne kadar */
  partial: boolean;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Takvim ayı, bugünden (iş günü) önceki günleriyle; ayın ilk günü bugünse 0 gün */
export function monthPeriod(month: string, today: string): Period {
  const from = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  const to = today >= next ? next : today > from ? today : from;
  return { kind: "ay", month, from, to, days: daysBetween(from, to), partial: to < next };
}

/**
 * Adresteki dönem: `donem` = 4h (varsayılan, son 28 gün), 12h (son 84 gün) ya da ay (`ay` = YYYY-MM; geçersiz ya da
 * gelecekteki ay içinde bulunulan ay olur). Bugün = şimdinin iş günü (gece 05:00'ten önce dün).
 */
export function resolvePeriod(kind: string | undefined, month: string | undefined, now: number): Period {
  const today = businessDay(now);
  if (kind === "ay") {
    const current = today.slice(0, 7);
    return monthPeriod(month && MONTH_RE.test(month) && month <= current ? month : current, today);
  }
  const span = kind === "12h" ? 84 : 28;
  return { kind: kind === "12h" ? "12h" : "4h", month: null, from: addDays(today, -span), to: today, days: span, partial: false };
}

/** Karşılaştırılan önceki dönem: aynı uzunlukta hemen önceki günler; ayda önceki ayın tamamı */
export function previousPeriod(p: Period): Period {
  if (p.kind === "ay" && p.month) return monthPeriod(shiftMonth(p.month, -1), p.from);
  const span = daysBetween(p.from, p.to);
  return { ...p, from: addDays(p.from, -span), to: p.from, days: span };
}

/** Dönemin anları: [ilk günün 05:00'i, `to`nun 05:00'i) */
export function periodBounds(p: Pick<Period, "from" | "to">): { start: number; end: number } {
  return { start: dayStart(p.from), end: dayStart(p.to) };
}

/** Verinin başladığı günler: site rezervasyonları (geçmiş alındıysa alınan ilk ayın başı) ve rezervasyonsuz sayaçlar */
export interface Coverage {
  siteSince: string | null;
  timerSince: string | null;
}

/** Dönem, rezervasyonsuz sayaçların başladığı güne göre nerede: tamamen önce, tamamen sonra ya da ikisi birden */
function timerSide(p: Pick<Period, "from" | "to">, timerSince: string | null): "before" | "after" | "mixed" {
  if (!timerSince || p.from >= timerSince) return "after";
  return p.to <= timerSince ? "before" : "mixed";
}

/**
 * İki dönemin doluluğu karşılaştırılabilir mi (puan farkı rozeti): ikisi de verinin başladığı günden sonra başlıyor ve
 * sayaçların başladığı güne göre aynı tarafta. Verisiz günlerle ya da yalnız site rezervasyonlarının sayıldığı
 * günlerle kıyas farkı yanlış gösterirdi.
 */
export function comparable(a: Pick<Period, "from" | "to">, b: Pick<Period, "from" | "to">, c: Coverage): boolean {
  const since = c.siteSince ?? c.timerSince;
  if (!since || a.from < since || b.from < since) return false;
  const side = timerSide(a, c.timerSince);
  return side !== "mixed" && side === timerSide(b, c.timerSince);
}

/** Dönemde odayı kullanan oturum ya da sitede rezervasyon var mı (iptal edilenler dahil) */
export function hasActivity(s: Pick<OccupancySummary, "sessions" | "cancellations">): boolean {
  return s.sessions.site + s.sessions.panel + s.cancellations.bookings > 0;
}

/**
 * Doluluğun önceki döneme göre puan farkı (oran olarak), gösterilmeyecekse null: önceki dönemde hiç oturum ya da
 * rezervasyon yoksa (geçmiş alınan ilk ay sitenin ilk rezervasyonundan önce olabilir; boş ayla kıyas "+16 puan" gibi
 * yanlış bir sıçrama gösterirdi) ya da dönemler karşılaştırılamıyorsa. Doluluk kartı ve ay ay tablosu aynı kuralı kullanır.
 */
export function occupancyDelta(
  cur: { period: Pick<Period, "from" | "to">; summary: OccupancySummary },
  prev: { period: Pick<Period, "from" | "to">; summary: OccupancySummary },
  c: Coverage,
): number | null {
  const a = cur.summary;
  const b = prev.summary;
  if (a.ratio === null || b.ratio === null || b.capacityMin <= 0 || !hasActivity(b)) return null;
  return comparable(cur.period, prev.period, c) ? a.ratio - b.ratio : null;
}

/** Haftanın her günü dönemde kaç kez var (pazartesi 0) */
function weekdayCounts(p: Pick<Period, "from" | "to">): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let d = p.from; d < p.to; d = addDays(d, 1)) counts[weekdayIndex(d)]++;
  return counts;
}

// ---------------------------------------------------------------- Hesap

export interface GridCell {
  weekday: number;
  /** İş günü ölçeğinde saat, 5–28 (24 = gece 00:00, 28 = 04:00) */
  hour: number;
  /** Oda saatleri içinde */
  open: boolean;
  /** Haftanın bu günü dönemde kaç kez var */
  days: number;
  /** Açık süre (dakika × oda); kapalı saatte 0 */
  capacityMin: number;
  /** Dolu oda-dakika (aynı anda iki oturum oda sayısını aşmaz) */
  occupiedMin: number;
  /** Oda saatleri dışında dolu dakika (yalnız kapalı saatte) */
  outsideMin: number;
  /** O gün ve saatte odanın dolu olduğu tarih sayısı */
  busyDays: number;
  /** Hücreye uğrayan oturumlar */
  site: number;
  panel: number;
  guestsAvg: number | null;
  /** Dolu ÷ açık süre; kapalı saatte ya da dönemde o gün yoksa null */
  ratio: number | null;
}

/** Satırlar haftanın günleri (pazartesi 0), sütunlar `hours` (iş günü sırasıyla) */
export interface OccupancyGrid {
  hours: number[];
  rows: GridCell[][];
}

export interface OccupancySummary {
  days: number;
  capacityMin: number;
  /** Oda saatleri içinde dolu oda-dakika */
  occupiedMin: number;
  outsideMin: number;
  /** Oda sayısını aşan (aynı anda ikinci oturum) dakika: bir kez sayıldı */
  overlapMin: number;
  /** Oda saatleri dışında dolu kalan saatler (dipnot) */
  outsideHours: number[];
  ratio: number | null;
  /** Dönemde başlayan, odayı kullanan oturumlar */
  sessions: { site: number; panel: number };
  extension: { total: number; extended: number; rate: number | null; avgMinutes: number | null };
  /** Sitedeki rezervasyonlar (iptal edilenler dahil; süresi dolan ödeme ve tutma hariç) */
  cancellations: { bookings: number; cancelled: number; late: number; unknownTime: number; lateRate: number | null };
  lead: { n: number; missing: number; avgDays: number | null; medianDays: number | null; sameDayShare: number | null };
  guests: { n: number; avg: number | null };
  /**
   * Saat başına gelir (kuruş, KDV dahil): sitede ödenen ya da kasada ödenecek rezervasyon ücretleri ÷ o rezervasyonların
   * dolu saatleri (uzatma hariç: uzatmanın parası kasada alınır). Dönem sınırında kalan oturum ücretinin payıyla girer
   */
  revenue: { minor: number; hours: number; sessions: number; perHour: number | null; perOpenHour: number | null };
}

export interface OccupancyOptions {
  hours: RoomHours;
  /** Varsayılan KARAOKE_ROOMS */
  rooms?: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** [a, b) aralığını saat başlarından böler (Türkiye saat başı = UTC saat başı) */
function* hourPieces(a: number, b: number): Generator<[number, number]> {
  for (let t = a; t < b; ) {
    const next = Math.min(b, Math.floor(t / HOUR_MS + 1) * HOUR_MS);
    yield [t, next];
    t = next;
  }
}

/**
 * Dönemin ızgarası ve göstergeleri. Dakikalar döneme kırpılır, sayılar dönemde başlayan oturumlardan. Aynı anda birden
 * çok oturum (tek odada çoğunlukla rezervasyonlu grup için ayrıca açılan sayaç) oda sayısı kadar sayılır, fazlası
 * `overlapMin`. Oda saatleri dışındaki dolu dakikalar oranı bozmaz, ayrı yazılır.
 */
export function computeOccupancy(sessions: readonly OccSession[], period: Period, opts: OccupancyOptions): { grid: OccupancyGrid; summary: OccupancySummary } {
  const rooms = Math.max(1, Math.floor(opts.rooms ?? KARAOKE_ROOMS));
  const { start, end } = periodBounds(period);
  const counts = weekdayCounts(period);

  type Acc = { occ: number; dates: Set<string>; site: Set<number>; panel: Set<number>; guests: Map<number, number> };
  const acc = new Map<number, Acc>();
  // Hücre anahtarı: gün × 32 + saat (saat 5–28)
  const slot = (ms: number): [Acc, string] => {
    const date = businessDay(ms);
    const key = weekdayIndex(date) * 32 + businessHour(clockHour(ms));
    let cell = acc.get(key);
    if (!cell) acc.set(key, (cell = { occ: 0, dates: new Set(), site: new Set(), panel: new Set(), guests: new Map() }));
    return [cell, date];
  };

  // Döneme kırpılmış dolu aralıklar
  const clipped: { s: OccSession; a: number; b: number }[] = [];
  for (const s of sessions) {
    const iv = occupiedInterval(s);
    if (!iv) continue;
    const a = Math.max(iv.start, start);
    const b = Math.min(iv.end, end);
    if (b > a) clipped.push({ s, a, b });
  }

  // Süpürme: aynı andaki oturum sayısı; aynı anda biten ve başlayan çakışmaz (bitiş önce)
  const events = clipped.flatMap(({ a, b }) => [[a, 1] as const, [b, -1] as const]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let level = 0;
  let overlapMin = 0;
  for (let i = 0; i < events.length; i++) {
    level += events[i][1];
    const t = events[i][0];
    const next = i + 1 < events.length ? events[i + 1][0] : t;
    if (level <= 0 || next <= t) continue;
    for (const [a, b] of hourPieces(t, next)) {
      const min = (b - a) / MIN_MS;
      const [cell, date] = slot(a);
      cell.occ += Math.min(level, rooms) * min;
      cell.dates.add(date);
      overlapMin += Math.max(0, level - rooms) * min;
    }
  }

  // Hücreye uğrayan oturumlar ve kişi sayıları
  for (const { s, a, b } of clipped) {
    for (const [pa] of hourPieces(a, b)) {
      const [cell] = slot(pa);
      (s.source === "site" ? cell.site : cell.panel).add(s.id);
      if (s.guests) cell.guests.set(s.id, s.guests);
    }
  }

  const columns = new Set<number>();
  for (let h = opts.hours.open; h < opts.hours.close; h++) columns.add(h);
  for (const [key, a] of acc) if (a.occ > 0 && !isOpenHour(key % 32, opts.hours)) columns.add(key % 32);
  const hours = [...columns].sort((x, y) => x - y);

  const rows: GridCell[][] = counts.map((days, weekday) =>
    hours.map((hour) => {
      const a = acc.get(weekday * 32 + hour);
      const open = isOpenHour(hour, opts.hours);
      const capacityMin = open ? days * 60 * rooms : 0;
      const occupiedMin = a?.occ ?? 0;
      return {
        weekday,
        hour,
        open,
        days,
        capacityMin,
        occupiedMin,
        outsideMin: open ? 0 : occupiedMin,
        busyDays: a?.dates.size ?? 0,
        site: a?.site.size ?? 0,
        panel: a?.panel.size ?? 0,
        guestsAvg: a ? mean([...a.guests.values()]) : null,
        ratio: capacityMin > 0 ? occupiedMin / capacityMin : null,
      };
    }),
  );

  const cells = rows.flat();
  const capacityMin = cells.reduce((t, c) => t + c.capacityMin, 0);
  const occupiedMin = cells.reduce((t, c) => t + (c.open ? c.occupiedMin : 0), 0);
  const outsideMin = cells.reduce((t, c) => t + c.outsideMin, 0);
  const outsideHours = hours.filter((h) => rows.some((r) => r.find((c) => c.hour === h)!.outsideMin > 0));

  // Sayılar dönemde başlayan oturumlardan
  const inPeriod = sessions.filter((s) => s.startsAt >= start && s.startsAt < end);
  const occupied = inPeriod.filter((s) => occupiedInterval(s) !== null);
  const extended = occupied.filter((s) => s.extraMinutes > 0);

  const site = inPeriod.filter((s) => s.source === "site");
  const bookings = site.filter((s) => isOccupying(s) || isCancelledBooking(s));
  const cancelled = site.filter((s) => isCancelledBooking(s));
  const late = cancelled.filter((s) => s.cancelledAt !== null && s.cancelledAt >= s.startsAt - LATE_CANCEL_HOURS * HOUR_MS);

  const occupiedSite = occupied.filter((s) => s.source === "site");
  const leads = occupiedSite.filter((s) => s.bookedAt !== null).map((s) => Math.max(0, daysBetween(trDate(s.bookedAt!), businessDay(s.startsAt))));
  const guests = occupied.map((s) => s.guests).filter((g): g is number => g !== null && g > 0);

  // Ücret: kasada ödenecek (none) ya da ödenmiş, ücreti bilinen rezervasyonlar; rezervasyon süresinin döneme düşen payı
  let revenueMinor = 0;
  let revenueMs = 0;
  let revenueSessions = 0;
  for (const s of sessions) {
    if (s.source !== "site" || !isOccupying(s) || !s.totalMinor || s.totalMinor <= 0) continue;
    if (s.paymentStatus !== "paid" && s.paymentStatus !== "none") continue;
    const bookedEnd = s.endedAt !== null ? Math.min(s.endsAt, s.endedAt) : s.endsAt;
    const full = bookedEnd - s.startsAt;
    const part = Math.min(bookedEnd, end) - Math.max(s.startsAt, start);
    if (full <= 0 || part <= 0) continue;
    revenueMinor += (s.totalMinor * part) / full;
    revenueMs += part;
    revenueSessions++;
  }
  const revenueHours = revenueMs / HOUR_MS;

  return {
    grid: { hours, rows },
    summary: {
      days: period.days,
      capacityMin,
      occupiedMin,
      outsideMin,
      overlapMin,
      outsideHours,
      ratio: capacityMin > 0 ? occupiedMin / capacityMin : null,
      sessions: { site: occupiedSite.length, panel: occupied.length - occupiedSite.length },
      extension: {
        total: occupied.length,
        extended: extended.length,
        rate: occupied.length ? extended.length / occupied.length : null,
        avgMinutes: mean(extended.map((s) => s.extraMinutes)),
      },
      cancellations: {
        bookings: bookings.length,
        cancelled: cancelled.length,
        late: late.length,
        unknownTime: cancelled.filter((s) => s.cancelledAt === null).length,
        lateRate: bookings.length ? late.length / bookings.length : null,
      },
      lead: {
        n: leads.length,
        missing: occupiedSite.length - leads.length,
        avgDays: mean(leads),
        medianDays: median(leads),
        sameDayShare: leads.length ? leads.filter((d) => d === 0).length / leads.length : null,
      },
      guests: { n: guests.length, avg: mean(guests) },
      revenue: {
        minor: revenueMinor,
        hours: revenueHours,
        sessions: revenueSessions,
        perHour: revenueHours > 0 ? revenueMinor / revenueHours : null,
        perOpenHour: capacityMin > 0 ? revenueMinor / (capacityMin / 60) : null,
      },
    },
  };
}

// ---------------------------------------------------------------- Ay ay

/** Ay ay kartının ayları: en yeni başta, içinde bulunulan aydan geriye en çok `max` ay, ilk veri ayından eskiye gitmez */
export function recentMonths(today: string, firstMonth: string | null, max = 6): string[] {
  const current = today.slice(0, 7);
  const floor = firstMonth && firstMonth < current ? firstMonth : current;
  const out: string[] = [];
  for (let m = current; out.length < max && m >= floor; m = shiftMonth(m, -1)) out.push(m);
  return out;
}

export interface MonthRow {
  month: string;
  period: Period;
  summary: OccupancySummary;
  /** Ay ilk rezervasyonsuz sayaçtan önce başlıyor: o aylarda yalnız site rezervasyonları var */
  beforeTimers: boolean;
}

export function monthRows(sessions: readonly OccSession[], months: string[], today: string, opts: OccupancyOptions & { firstTimerDay: string | null }): MonthRow[] {
  return months.map((month) => {
    const period = monthPeriod(month, today);
    return { month, period, summary: computeOccupancy(sessions, period, opts).summary, beforeTimers: opts.firstTimerDay !== null && period.from < opts.firstTimerDay };
  });
}

// ---------------------------------------------------------------- Öne çıkanlar

/** Gün ve saat bloğu: d0–d1 günleri dahil, h0'dan h1'e (h1 hariç), oran açık süreye göre ağırlıklı */
export interface Block {
  d0: number;
  d1: number;
  h0: number;
  h1: number;
  ratio: number;
}

/**
 * Ardışık 1–`maxDays` gün (pazartesiden pazara, sarmaz) × ardışık `minHours`–`maxHours` açık saatlik blokların en iyisi.
 * Bütün hücreleri açık olmalı. Eşitlikte büyük blok, sonra erken gün, sonra erken saat.
 */
function bestBlock(grid: OccupancyGrid, maxDays: number, minHours: number, maxHours: number, lower: boolean): Block | null {
  const cols = grid.hours;
  let best: (Block & { area: number }) | null = null;
  for (let d0 = 0; d0 < 7; d0++) {
    for (let d1 = d0; d1 < Math.min(7, d0 + maxDays); d1++) {
      for (let i0 = 0; i0 < cols.length; i0++) {
        for (let len = minHours; len <= maxHours && i0 + len <= cols.length; len++) {
          if (cols[i0 + len - 1] - cols[i0] !== len - 1) break;
          let cap = 0;
          let occ = 0;
          let ok = true;
          for (let d = d0; d <= d1 && ok; d++) {
            for (let i = i0; i < i0 + len; i++) {
              const c = grid.rows[d][i];
              if (!c.open || c.capacityMin <= 0) {
                ok = false;
                break;
              }
              cap += c.capacityMin;
              occ += c.occupiedMin;
            }
          }
          if (!ok) continue;
          const cand = { d0, d1, h0: cols[i0], h1: cols[i0] + len, ratio: occ / cap, area: (d1 - d0 + 1) * len };
          if (!best) {
            best = cand;
            continue;
          }
          const diff = cand.ratio - best.ratio;
          const wins =
            Math.abs(diff) > 1e-9
              ? lower
                ? diff < 0
                : diff > 0
              : cand.area !== best.area
                ? cand.area > best.area
                : cand.d0 !== best.d0
                  ? cand.d0 < best.d0
                  : cand.h0 < best.h0;
          if (wins) best = cand;
        }
      }
    }
  }
  return best && { d0: best.d0, d1: best.d1, h0: best.h0, h1: best.h1, ratio: best.ratio };
}

/** En boş blok: 1–4 gün × 2–4 saat, en düşük doluluk */
export function emptiestBlock(grid: OccupancyGrid): Block | null {
  return bestBlock(grid, 4, 2, 4, true);
}

/** En dolu blok: 1–3 gün × 2–3 saat, en yüksek doluluk; %50'nin altındaysa yok */
export function busiestBlock(grid: OccupancyGrid): Block | null {
  const b = bestBlock(grid, 3, 2, 3, false);
  return b && b.ratio >= 0.5 ? b : null;
}
