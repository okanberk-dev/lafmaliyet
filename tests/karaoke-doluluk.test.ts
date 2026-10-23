// Karaoke doluluk haritası (src/lib/karaoke/occupancy.ts, occupancy-text.ts, history.ts): saat bölme, gece yarısı ve
// 05:00 iş günü, çakışma, erken bitirme / uzatma, dönemler, kapasite, son dakika iptal, kaç gün önceden, uzatma, saat
// başına gelir, öne çıkanlar, metinler, ay ay, geçmişi siteden alma ve KVKK saklama süresi; sayfa, yükleyici ve
// eylemlerin yetki ve KVKK kuralları (kaynak denetimi).
// Çalıştırma: npx tsx --test tests/karaoke-doluluk.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  EMPTY_HISTORY,
  historyCancelledAt,
  historyChanged,
  historyEnd,
  historyPlan,
  historyProgress,
  historyValues,
  historyWindows,
  parseHistoryState,
  personalDataCutoff,
  retryAfterMs,
  writeErrorText,
  type HistoryState,
} from "../src/lib/karaoke/history";
import {
  businessDay,
  businessHour,
  busiestBlock,
  clockHour,
  comparable,
  computeOccupancy,
  DEFAULT_ROOM_HOURS,
  emptiestBlock,
  monthPeriod,
  monthRows,
  occupancyDelta,
  occupiedInterval,
  parseRoomHours,
  periodBounds,
  previousPeriod,
  recentMonths,
  resolvePeriod,
  rowToOcc,
  weekdayIndex,
  type GridCell,
  type OccSession,
  type OccupancyGrid,
  type OccupancySummary,
  type Period,
  type RoomHours,
} from "../src/lib/karaoke/occupancy";
import {
  bucket,
  cellDetail,
  cellLabel,
  cellNumber,
  closeOptionLabel,
  historyToast,
  hourLabel,
  hourRangeLabel,
  hourRangesText,
  hoursText,
  insightLines,
  kpiTexts,
  minutesText,
  monthsRange,
  periodLine,
  pointsText,
  weekdayRange,
} from "../src/lib/karaoke/occupancy-text";
import type { SiteReservation } from "../src/lib/karaoke/session";
import { daysBetween } from "../src/lib/reminders";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Türkiye saati → ms */
const T = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+03:00`);
const MIN = 60_000;

let nextId = 1;
/** Sitedeki ödenmiş rezervasyon (varsayılan); `over` ile her alan */
const sess = (start: number, end: number, over: Partial<OccSession> = {}): OccSession => ({
  id: nextId++,
  source: "site",
  startsAt: start,
  endsAt: end,
  extraMinutes: 0,
  endedAt: null,
  guests: 4,
  status: "confirmed",
  paymentStatus: "paid",
  totalMinor: null,
  bookedAt: null,
  cancelledAt: null,
  ...over,
});

/** Dönem: iş günleri [from, to) */
const per = (from: string, to: string): Period => ({ kind: "4h", month: null, from, to, days: daysBetween(from, to), partial: false });
// 2026-10-19 pazartesi … 2026-10-25 pazar: her gün bir kez (22 perşembe, 23 cuma, 24 cumartesi)
const WEEK = per("2026-10-19", "2026-10-26");
const H10_24: RoomHours = { open: 10, close: 24 };
const FRI = 4;
const SAT = 5;

const cellAt = (grid: OccupancyGrid, weekday: number, hour: number) => grid.rows[weekday][grid.hours.indexOf(hour)];
const occAt = (grid: OccupancyGrid, weekday: number, hour: number) => cellAt(grid, weekday, hour)?.occupiedMin ?? 0;

test("saat bölme: cuma 20:30–22:15 → 20'de 30, 21'de 60, 22'de 15 dakika", () => {
  const { grid, summary } = computeOccupancy([sess(T("2026-10-23", "20:30"), T("2026-10-23", "22:15"))], WEEK, { hours: H10_24 });
  assert.equal(occAt(grid, FRI, 20), 30);
  assert.equal(occAt(grid, FRI, 21), 60);
  assert.equal(occAt(grid, FRI, 22), 15);
  assert.equal(occAt(grid, FRI, 19), 0);
  assert.equal(summary.occupiedMin, 105);
  assert.equal(cellAt(grid, FRI, 21).site, 1);
  assert.equal(cellAt(grid, FRI, 21).busyDays, 1);
});

test("gece yarısını geçen oturum cumanın satırında; oda saatleri dışındaysa ayrı yazılır", () => {
  const late = [sess(T("2026-10-23", "23:00"), T("2026-10-24", "01:30"))];
  const open = computeOccupancy(late, WEEK, { hours: { open: 10, close: 26 } });
  assert.equal(occAt(open.grid, FRI, 23), 60);
  assert.equal(occAt(open.grid, FRI, 24), 60);
  assert.equal(occAt(open.grid, FRI, 25), 30);
  assert.ok(open.grid.rows[SAT].every((c) => c.occupiedMin === 0), "cumartesi satırı boş");
  assert.equal(open.summary.outsideMin, 0);

  const closed = computeOccupancy(late, WEEK, { hours: { open: 10, close: 22 } });
  assert.equal(closed.summary.outsideMin, 150);
  assert.deepEqual(closed.summary.outsideHours, [23, 24, 25]);
  assert.equal(closed.summary.occupiedMin, 0, "oran dışarıdaki dakikaları saymaz");
  assert.equal(closed.summary.ratio, 0);
  // Kapalı sütunlar ızgaraya eklenir, oranı yok
  assert.deepEqual(closed.grid.hours.slice(-3), [23, 24, 25]);
  const c = cellAt(closed.grid, FRI, 24);
  assert.equal(c.open, false);
  assert.equal(c.ratio, null);
  assert.equal(c.outsideMin, 60);
});

test("05:00'i geçen oturum: 04:00–05:00 cumaya (28), 05:00–06:00 cumartesiye", () => {
  const { grid } = computeOccupancy([sess(T("2026-10-24", "04:00"), T("2026-10-24", "06:00"))], WEEK, { hours: { open: 5, close: 29 } });
  assert.equal(occAt(grid, FRI, 28), 60);
  assert.equal(occAt(grid, SAT, 5), 60);
  assert.equal(businessDay(T("2026-10-24", "04:59")), "2026-10-23");
  assert.equal(businessDay(T("2026-10-24", "05:00")), "2026-10-24");
  assert.equal(businessHour(clockHour(T("2026-10-24", "00:30"))), 24);
});

test("çakışma: tek odada bir kez sayılır (fazlası ayrı); iki odada ikisi de, kapasite iki kat", () => {
  const two = [sess(T("2026-10-23", "20:00"), T("2026-10-23", "22:00")), sess(T("2026-10-23", "21:00"), T("2026-10-23", "23:00"), { source: "panel", totalMinor: null })];
  const one = computeOccupancy(two, WEEK, { hours: H10_24 });
  assert.equal(one.summary.occupiedMin, 180);
  assert.equal(one.summary.overlapMin, 60);
  assert.equal(occAt(one.grid, FRI, 21), 60);
  const rooms = computeOccupancy(two, WEEK, { hours: H10_24, rooms: 2 });
  assert.equal(rooms.summary.occupiedMin, 240);
  assert.equal(rooms.summary.overlapMin, 0);
  assert.equal(rooms.summary.capacityMin, one.summary.capacityMin * 2);
  assert.equal(rooms.summary.ratio, 240 / (2 * one.summary.capacityMin));
  // Uç uca gelen oturumlar çakışmaz
  const chain = computeOccupancy([sess(T("2026-10-23", "18:00"), T("2026-10-23", "20:00")), sess(T("2026-10-23", "20:00"), T("2026-10-23", "21:00"))], WEEK, { hours: H10_24 });
  assert.equal(chain.summary.overlapMin, 0);
  assert.equal(chain.summary.occupiedMin, 180);
});

test("bitiş kuralları: erken bitirme odayı boşaltır, süre dolduktan sonraki 'Haber verdim' uzatmaz, uzatma sayılır", () => {
  const s = T("2026-10-23", "20:00");
  const e = T("2026-10-23", "22:00");
  const minutes = (over: Partial<OccSession>) => computeOccupancy([sess(s, e, over)], WEEK, { hours: H10_24 }).summary.occupiedMin;
  assert.equal(minutes({ endedAt: T("2026-10-23", "21:00") }), 60);
  assert.equal(minutes({ endedAt: T("2026-10-23", "22:20") }), 120);
  assert.equal(minutes({ extraMinutes: 30 }), 150);
  assert.equal(minutes({ extraMinutes: 30, endedAt: T("2026-10-23", "22:10") }), 130);
  assert.equal(minutes({ endedAt: null }), 120, "geri açılan oturum sonuna kadar dolu");
  // Başlar başlamaz bitirilen (gelmeyen) oturum odayı tutmaz
  assert.equal(occupiedInterval(sess(s, e, { endedAt: s })), null);
});

test("odayı tutmayanlar: iptal, ödenmemiş tutma, süresi dolan, iade; tutanlar: kasada ödenecek talep ve sayaç", () => {
  const s = T("2026-10-23", "20:00");
  const e = T("2026-10-23", "21:00");
  for (const over of [
    { status: "cancelled", paymentStatus: "none" },
    { status: "requested", paymentStatus: "pending" },
    { status: "cancelled", paymentStatus: "expired" },
    { status: "confirmed", paymentStatus: "expired" },
    { status: "cancelled", paymentStatus: "refunded" },
    { status: "confirmed", paymentStatus: "refunding" },
  ] as const) {
    assert.equal(occupiedInterval(sess(s, e, over)), null, JSON.stringify(over));
  }
  assert.ok(occupiedInterval(sess(s, e, { status: "requested", paymentStatus: "none" })));
  assert.ok(occupiedInterval(sess(s, e, { source: "panel", status: "confirmed", paymentStatus: "none" })));
});

test("dönemler: iş günüyle, bugün sayılmaz; ay, önceki dönem, geçersiz ve gelecek değerler", () => {
  const fourWeeks = resolvePeriod(undefined, undefined, T("2026-10-22", "14:00"));
  assert.deepEqual([fourWeeks.kind, fourWeeks.from, fourWeeks.to, fourWeeks.days], ["4h", "2026-09-24", "2026-10-22", 28]);
  const { grid } = computeOccupancy([], fourWeeks, { hours: DEFAULT_ROOM_HOURS });
  assert.ok(grid.rows.every((r) => r.every((c) => c.days === 4)), "her gün 4 kez");
  // Gece 03:00: iş günü dün
  assert.equal(resolvePeriod("4h", undefined, T("2026-10-22", "03:00")).to, "2026-10-21");
  const twelve = resolvePeriod("12h", undefined, T("2026-10-22", "14:00"));
  assert.deepEqual([twelve.from, twelve.to, twelve.days], ["2026-07-30", "2026-10-22", 84]);

  const october = resolvePeriod("ay", "2026-10", T("2026-10-22", "10:00"));
  assert.deepEqual([october.from, october.to, october.days, october.partial], ["2026-10-01", "2026-10-22", 21, true]);
  const september = resolvePeriod("ay", "2026-09", T("2026-10-22", "10:00"));
  assert.deepEqual([september.from, september.to, september.days, september.partial], ["2026-09-01", "2026-10-01", 30, false]);
  // 1 Kasım 10:00: Kasım'ın tamamlanmış günü yok, Ekim bütün
  const nov = resolvePeriod("ay", "2026-11", T("2026-11-01", "10:00"));
  assert.deepEqual([nov.month, nov.days, nov.partial], ["2026-11", 0, true]);
  assert.deepEqual([monthPeriod("2026-10", "2026-11-01").days, monthPeriod("2026-10", "2026-11-01").partial], [31, false]);
  // 1 Kasım 04:00: iş günü hâlâ 31 Ekim; Kasım gelecek ay, içinde bulunulan ay Ekim (30 gün, sürüyor)
  const night = resolvePeriod("ay", "2026-11", T("2026-11-01", "04:00"));
  assert.deepEqual([night.month, night.days, night.partial], ["2026-10", 30, true]);

  assert.equal(resolvePeriod("bozuk", undefined, T("2026-10-22", "14:00")).kind, "4h");
  assert.equal(resolvePeriod("ay", "2027-01", T("2026-10-22", "14:00")).month, "2026-10", "gelecek ay");
  assert.equal(resolvePeriod("ay", "2026-13", T("2026-10-22", "14:00")).month, "2026-10", "geçersiz ay");

  assert.deepEqual([previousPeriod(fourWeeks).from, previousPeriod(fourWeeks).to], ["2026-08-27", "2026-09-24"]);
  assert.deepEqual([previousPeriod(twelve).from, previousPeriod(twelve).to, previousPeriod(twelve).days], ["2026-05-07", "2026-07-30", 84]);
  const prevMonth = previousPeriod(october);
  assert.deepEqual([prevMonth.month, prevMonth.from, prevMonth.to, prevMonth.partial], ["2026-09", "2026-09-01", "2026-10-01", false]);

  assert.deepEqual(periodBounds(per("2026-10-23", "2026-10-24")), { start: T("2026-10-23", "05:00"), end: T("2026-10-24", "05:00") });
});

test("kapasite: 10–22 ve son 4 hafta → açık hücre 4 gün × 60 dk, toplam 20.160 dk", () => {
  const p = resolvePeriod("4h", undefined, T("2026-10-22", "14:00"));
  const { grid, summary } = computeOccupancy([], p, { hours: DEFAULT_ROOM_HOURS });
  assert.deepEqual(grid.hours, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.ok(grid.rows.flat().every((c) => c.open && c.capacityMin === 240 && c.ratio === 0));
  assert.equal(summary.capacityMin, 20_160);
  assert.equal(summary.ratio, 0);
});

test("Europe/Istanbul: yazın ve kışın 20:00 aynı sütunda (sabit +3, yaz saati yok)", () => {
  for (const at of [T("2026-12-18", "20:00"), T("2026-07-17", "20:00")]) {
    assert.equal(clockHour(at), 20);
    assert.equal(weekdayIndex(businessDay(at)), FRI);
  }
  const p = per("2026-07-13", "2026-12-21");
  const { grid } = computeOccupancy([sess(T("2026-12-18", "20:00"), T("2026-12-18", "21:00")), sess(T("2026-07-17", "20:00"), T("2026-07-17", "21:00"))], p, { hours: H10_24 });
  assert.equal(occAt(grid, FRI, 20), 120);
  assert.equal(cellAt(grid, FRI, 20).busyDays, 2);
});

test("son dakika iptal: 24 saat içinde ya da sonra; zamanı bilinmeyen ayrı; süresi dolan tutma sayılmaz", () => {
  const start = T("2026-10-23", "20:00");
  const end = T("2026-10-23", "22:00");
  const cancelled = (cancelledAt: number | null) => sess(start, end, { status: "cancelled", paymentStatus: "none", cancelledAt });
  const list = [
    cancelled(start - 20 * 3_600_000),
    cancelled(start - 30 * 3_600_000),
    cancelled(start + 10 * MIN),
    cancelled(null),
    sess(start, end, { status: "cancelled", paymentStatus: "refunded", cancelledAt: start - 2 * 3_600_000 }),
    sess(start, end, { status: "cancelled", paymentStatus: "expired", cancelledAt: start - 3_600_000 }),
    sess(start, end, { status: "requested", paymentStatus: "pending" }),
    sess(start, end),
    sess(start, end, { source: "panel" }),
  ];
  const c = computeOccupancy(list, WEEK, { hours: H10_24 }).summary.cancellations;
  assert.equal(c.bookings, 6, "4 iptal + iade + 1 rezervasyon; tutma, süresi dolan ve sayaç değil");
  assert.equal(c.cancelled, 5);
  assert.equal(c.late, 3);
  assert.equal(c.unknownTime, 1);
  assert.equal(c.lateRate, 3 / 6);

  // İptal anı sütunu yoksa eşitlemenin iptal zili (lastEvent) yerine geçer
  const row = {
    id: 9,
    source: "site" as const,
    startsAt: new Date(start),
    endsAt: new Date(end),
    extraMinutes: 0,
    endedAt: null,
    guests: null,
    status: "cancelled",
    paymentStatus: "refunding",
    totalMinor: 100000,
    bookedAt: null,
    cancelledAt: null,
    lastEvent: "cancelled",
    lastEventAt: new Date(start - 3_600_000),
  };
  assert.equal(rowToOcc(row).cancelledAt, start - 3_600_000);
  assert.equal(rowToOcc({ ...row, cancelledAt: new Date(start - 7_200_000) }).cancelledAt, start - 7_200_000, "sütun öncelikli");
  assert.equal(rowToOcc({ ...row, lastEvent: "created" }).cancelledAt, null);
});

test("kaç gün önceden: ortalama, ortanca, aynı gün; gece yarısından sonraki oturum önceki güne", () => {
  const start = T("2026-10-23", "20:00");
  const end = T("2026-10-23", "22:00");
  const leads = computeOccupancy(
    [
      sess(start, end, { bookedAt: T("2026-10-23", "09:00") }),
      sess(start, end, { bookedAt: T("2026-10-21", "23:30") }),
      sess(start, end, { bookedAt: T("2026-10-13", "12:00") }),
      sess(start, end, { bookedAt: null }),
      sess(start, end, { source: "panel" }),
    ],
    WEEK,
    { hours: H10_24 },
  ).summary.lead;
  assert.equal(leads.n, 3);
  assert.equal(leads.missing, 1);
  assert.equal(leads.avgDays, 4);
  assert.equal(leads.medianDays, 2);
  assert.equal(leads.sameDayShare, 1 / 3);
  // Cumartesi 00:30 oturumu cuma 20:00'de yapılmış: aynı gün; başladıktan sonra yazılmış: 0
  const night = computeOccupancy(
    [
      sess(T("2026-10-24", "00:30"), T("2026-10-24", "02:00"), { bookedAt: T("2026-10-23", "20:00") }),
      sess(T("2026-10-23", "20:00"), T("2026-10-23", "21:00"), { bookedAt: T("2026-10-23", "20:30") }),
    ],
    WEEK,
    { hours: H10_24 },
  ).summary.lead;
  assert.equal(night.avgDays, 0);
  assert.equal(night.sameDayShare, 1);
});

test("uzatma: 4 oturumdan biri +30 → %25, ortalama 30 dk; sayaçlar dahil", () => {
  const s = T("2026-10-23", "14:00");
  const e = T("2026-10-23", "15:00");
  const x = computeOccupancy([sess(s, e, { extraMinutes: 30 }), sess(s + 2 * 3_600_000, e + 2 * 3_600_000), sess(s + 4 * 3_600_000, e + 4 * 3_600_000, { source: "panel" }), sess(s + 6 * 3_600_000, e + 6 * 3_600_000, { source: "panel" })], WEEK, { hours: H10_24 }).summary;
  assert.deepEqual(x.extension, { total: 4, extended: 1, rate: 0.25, avgMinutes: 30 });
  assert.deepEqual(x.sessions, { site: 2, panel: 2 });
});

test("saat başına gelir: rezervasyon ücreti ÷ o rezervasyonların dolu saati; sayaç ve uzatma girmez, kenarda pay", () => {
  const paid = sess(T("2026-10-23", "14:00"), T("2026-10-23", "16:00"), { totalMinor: 200_000 });
  const counter = sess(T("2026-10-23", "17:00"), T("2026-10-23", "18:00"), { status: "requested", paymentStatus: "none", totalMinor: 100_000 });
  const walkIn = sess(T("2026-10-23", "19:00"), T("2026-10-23", "21:00"), { source: "panel" });
  const r = computeOccupancy([paid, counter, walkIn], WEEK, { hours: H10_24 }).summary;
  assert.equal(r.revenue.minor, 300_000);
  assert.equal(r.revenue.hours, 3);
  assert.equal(r.revenue.perHour, 100_000);
  assert.equal(r.revenue.perOpenHour, 300_000 / (r.capacityMin / 60));
  // Uzatmanın parası kasada: saat uzamaz; erken bitirilen rezervasyon yalnız kullandığı saate bölünür
  const extended = computeOccupancy([sess(T("2026-10-23", "14:00"), T("2026-10-23", "16:00"), { totalMinor: 200_000, extraMinutes: 30 })], WEEK, { hours: H10_24 }).summary.revenue;
  assert.equal(extended.hours, 2);
  const early = computeOccupancy([sess(T("2026-10-23", "14:00"), T("2026-10-23", "16:00"), { totalMinor: 200_000, endedAt: T("2026-10-23", "15:00") })], WEEK, { hours: H10_24 }).summary.revenue;
  assert.deepEqual([early.minor, early.hours], [200_000, 1]);
  // Dönemin kenarındaki oturum ücretinin payıyla girer (pazartesi 04:00–06:00: 1 saat dönemde)
  const edge = computeOccupancy([sess(T("2026-10-19", "04:00"), T("2026-10-19", "06:00"), { totalMinor: 100_000 })], WEEK, { hours: H10_24 }).summary.revenue;
  assert.deepEqual([edge.minor, edge.hours], [50_000, 1]);
  // Ücreti bilinmeyen (0), iade edilen ve gelmeyen girmez
  const none = computeOccupancy(
    [
      sess(T("2026-10-23", "14:00"), T("2026-10-23", "16:00"), { totalMinor: 0 }),
      sess(T("2026-10-23", "17:00"), T("2026-10-23", "18:00"), { totalMinor: 100_000, paymentStatus: "refunded" }),
      sess(T("2026-10-23", "19:00"), T("2026-10-23", "20:00"), { totalMinor: 100_000, endedAt: T("2026-10-23", "19:00") }),
    ],
    WEEK,
    { hours: H10_24 },
  ).summary;
  assert.equal(none.revenue.perHour, null);
  const texts = kpiTexts(none);
  assert.equal(texts.revenue.value, "–");
  assert.equal(texts.revenue.sub, "Bu dönemde ücreti bilinen oturum yok");
  assert.doesNotMatch(Object.values(texts).map((t) => `${t.value} ${t.sub}`).join(" "), /₺/);
});

/** Yapay ızgara: 10–21 açık, her hücre 4 gün (240 dk); `ratio(w, h)` doluluk */
function gridOf(ratio: (w: number, h: number) => number): OccupancyGrid {
  const hours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const rows: GridCell[][] = Array.from({ length: 7 }, (_, w) =>
    hours.map((h) => {
      const r = ratio(w, h);
      return { weekday: w, hour: h, open: true, days: 4, capacityMin: 240, occupiedMin: r * 240, outsideMin: 0, busyDays: 0, site: 0, panel: 0, guestsAvg: null, ratio: r };
    }),
  );
  return { hours, rows };
}

const summaryWith = (over: Partial<OccupancySummary>): OccupancySummary => ({
  days: 28,
  capacityMin: 20_160,
  occupiedMin: 0,
  outsideMin: 0,
  overlapMin: 0,
  outsideHours: [],
  ratio: 0,
  sessions: { site: 10, panel: 2 },
  extension: { total: 12, extended: 0, rate: 0, avgMinutes: null },
  cancellations: { bookings: 12, cancelled: 0, late: 0, unknownTime: 0, lateRate: 0 },
  lead: { n: 0, missing: 0, avgDays: null, medianDays: null, sameDayShare: null },
  guests: { n: 0, avg: null },
  revenue: { minor: 0, hours: 0, sessions: 0, perHour: null, perOpenHour: null },
  ...over,
});

test("öne çıkanlar: en boş blok, en dolu blok, son dakika iptal; az veride neden; eşitlikte büyük blok", () => {
  const p = resolvePeriod("4h", undefined, T("2026-10-22", "14:00"));
  // Salı–Perşembe 14–17 boş, gerisi %50
  const quiet = gridOf((w, h) => (w >= 1 && w <= 3 && h >= 14 && h < 17 ? 0 : 0.5));
  assert.deepEqual(emptiestBlock(quiet), { d0: 1, d1: 3, h0: 14, h1: 17, ratio: 0 });
  assert.equal(insightLines(quiet, summaryWith({}), p).lines[0], "En boş saatler: Salı–Perşembe 14–17 · %0 dolu");
  // Cuma–cumartesi 20–23 %82, gerisi %30
  const busy = gridOf((w, h) => (w >= 4 && w <= 5 && h >= 20 ? 0.82 : 0.3));
  assert.deepEqual(busiestBlock(busy), { d0: 4, d1: 5, h0: 20, h1: 22, ratio: 0.82 });
  const lines = insightLines(busy, summaryWith({}), p).lines;
  assert.equal(lines[1], "En dolu saatler: Cuma–Cumartesi 20–22 · %82 dolu");
  // %50'nin altındaysa en dolu blok yok
  assert.equal(busiestBlock(gridOf(() => 0.4)), null);
  // Son dakika iptal yüksekse ikinci satır o
  const cancels = insightLines(busy, summaryWith({ cancellations: { bookings: 17, cancelled: 4, late: 3, unknownTime: 0, lateRate: 3 / 17 } }), p).lines;
  assert.equal(cancels[1], "Son 24 saatte iptal: 3 rezervasyon (%18)");
  // Az veri: satır yok, nedeni var
  const short = insightLines(quiet, summaryWith({}), { ...p, days: 10 });
  assert.deepEqual(short.lines, []);
  assert.equal(short.reason, "Öne çıkanlar için en az 2 haftalık ve 8 oturumluk veri gerekiyor (bu dönemde 10 gün, 12 oturum).");
  assert.equal(
    insightLines(quiet, summaryWith({ sessions: { site: 3, panel: 2 } }), p).reason,
    "Öne çıkanlar için en az 2 haftalık ve 8 oturumluk veri gerekiyor (bu dönemde 5 oturum).",
  );
  assert.equal(insightLines(quiet, summaryWith({ sessions: { site: 0, panel: 0 } }), p).reason, "Bu dönemde oturum yok.");
  assert.equal(insightLines(quiet, summaryWith({}), { ...p, days: 0 }).reason, "Bu ayın tamamlanmış günü yok; geçen ayı seçin.");
  // Eşitlik: her yer boşsa en büyük blok (4 gün × 4 saat), en erken gün ve saat
  assert.deepEqual(emptiestBlock(gridOf(() => 0)), { d0: 0, d1: 3, h0: 10, h1: 14, ratio: 0 });
  // Etiketler
  assert.equal(hourRangeLabel(14, 17), "14–17");
  assert.equal(hourRangeLabel(23, 25), "23–01");
  assert.equal(hourRangeLabel(21, 24), "21–24");
  assert.equal(weekdayRange(1, 1), "Salı");
  assert.equal(weekdayRange(1, 3), "Salı–Perşembe");
});

test("metinler: oda saatleri, kapanış seçenekleri, puan, basamak, hücre, dakika, ay aralığı, dönem satırı", () => {
  assert.equal(hoursText({ open: 12, close: 26 }), "12:00–02:00");
  assert.equal(hoursText(DEFAULT_ROOM_HOURS), "10:00–22:00");
  assert.equal(hourLabel(25), "01:00");
  assert.equal(closeOptionLabel(22), "22:00");
  assert.equal(closeOptionLabel(24), "00:00 (gece yarısı)");
  assert.equal(closeOptionLabel(26), "02:00 (ertesi gün)");
  assert.equal(pointsText(0.06), "+6 puan");
  assert.equal(pointsText(-0.04), "−4 puan");
  assert.equal(pointsText(0.004), "aynı");
  assert.deepEqual([0, 0.001, 0.249, 0.25, 0.5, 0.75, 1].map(bucket), [0, 1, 1, 2, 3, 4, 4]);
  assert.equal(bucket(null), null);
  assert.equal(minutesText(130), "2 sa 10 dk");
  assert.equal(minutesText(35), "35 dk");
  assert.equal(minutesText(120), "2 sa");
  assert.equal(hourRangesText([25, 24]), "00:00–02:00");
  assert.equal(hourRangesText([8, 24, 25]), "08:00–09:00, 00:00–02:00");
  assert.equal(monthsRange(["2026-09", "2026-01", "2026-05"]), "Ocak–Eylül 2026");
  assert.equal(monthsRange(["2026-01", "2025-12"]), "Aralık 2025–Ocak 2026");
  assert.equal(monthsRange(["2026-09"]), "Eylül 2026");

  const cell: GridCell = { weekday: FRI, hour: 21, open: true, days: 4, capacityMin: 240, occupiedMin: 180, outsideMin: 0, busyDays: 3, site: 6, panel: 2, guestsAvg: 4, ratio: 0.75 };
  assert.equal(cellLabel(cell), "Cuma 21:00, yüzde 75 dolu");
  assert.equal(cellDetail(cell), "Cuma 21:00–22:00 · %75 dolu · kullanılan gün 3 / 4 · 6 rezervasyon, 2 rezervasyonsuz oturum · ortalama 4 kişi");
  assert.equal(cellNumber(cell), "75");
  const closed: GridCell = { ...cell, weekday: 1, hour: 8, open: false, capacityMin: 0, occupiedMin: 0, busyDays: 0, site: 0, panel: 0, guestsAvg: null, ratio: null };
  assert.equal(cellLabel(closed), "Salı 08:00, kapalı");
  assert.equal(cellNumber(closed), "");
  const outside: GridCell = { ...cell, hour: 25, open: false, capacityMin: 0, occupiedMin: 130, outsideMin: 130, busyDays: 2, site: 0, panel: 0, guestsAvg: null, ratio: null };
  assert.equal(cellLabel(outside), "Cuma 01:00, oda saatleri dışında, 130 dakika dolu");
  assert.equal(cellDetail(outside), "Cuma 01:00–02:00 · oda saatleri dışında · 2 sa 10 dk dolu · kullanılan gün 2 / 4");
  assert.equal(cellNumber({ ...cell, ratio: 0.003 }), "<1");
  assert.equal(cellNumber({ ...cell, ratio: 0, occupiedMin: 0 }), "", "boş hücre yazısız (rengi ve ayrıntısı söyler)");
  assert.equal(cellNumber({ ...cell, days: 0, capacityMin: 0, ratio: null }), "–", "dönemde o gün yok");

  const now = T("2026-10-22", "14:00");
  assert.equal(periodLine(resolvePeriod("4h", undefined, now), DEFAULT_ROOM_HOURS), "24 Eylül – 21 Ekim · 28 gün · oda saatleri 10:00–22:00 · bugün sayılmaz");
  assert.equal(periodLine(resolvePeriod("ay", "2026-09", now), DEFAULT_ROOM_HOURS), "Eylül 2026 · 30 gün · oda saatleri 10:00–22:00");
  assert.equal(periodLine(resolvePeriod("ay", "2026-10", now), DEFAULT_ROOM_HOURS), "Ekim 2026 · 1–21 Ekim · oda saatleri 10:00–22:00 · bugün sayılmaz");
});

test("göstergelerin metinleri: eğik çizgili biçim, rakamdan sonra ek yok", () => {
  const t = kpiTexts(
    summaryWith({
      capacityMin: 7200,
      occupiedMin: 2760,
      ratio: 2760 / 7200,
      extension: { total: 12, extended: 3, rate: 0.25, avgMinutes: 25 },
      cancellations: { bookings: 13, cancelled: 2, late: 1, unknownTime: 1, lateRate: 1 / 13 },
      lead: { n: 10, missing: 2, avgDays: 3.4, medianDays: 2, sameDayShare: 0.3 },
      revenue: { minor: 4_692_000, hours: 46, sessions: 12, perHour: 102_000, perOpenHour: 39_100 },
    }),
  );
  assert.deepEqual(t.occupancy, { value: "%38", sub: "46 / 120 saat dolu" });
  assert.deepEqual(t.revenue, { value: "1.020 ₺", sub: "Rezervasyon ücretleri · açık saat başına 391 ₺" });
  assert.deepEqual(t.extension, { value: "%25", sub: "3 / 12 oturum uzatıldı · ortalama +25 dk" });
  assert.deepEqual(t.cancel, { value: "%8", sub: "1 / 13 rezervasyon son 24 saatte · toplam 2 iptal · 1 iptalin zamanı bilinmiyor" });
  assert.deepEqual(t.lead, { value: "3,4 gün", sub: "ortalama · yarısı en çok 2 gün önceden · %30 aynı gün · 2 rezervasyonun tarihi yok" });
  const sameDay = kpiTexts(summaryWith({ lead: { n: 4, missing: 0, avgDays: 0.5, medianDays: 0, sameDayShare: 0.75 } }));
  assert.equal(sameDay.lead.sub, "ortalama · yarısı aynı gün");
  const empty = kpiTexts(
    summaryWith({ sessions: { site: 0, panel: 0 }, extension: { total: 0, extended: 0, rate: null, avgMinutes: null }, cancellations: { bookings: 0, cancelled: 0, late: 0, unknownTime: 0, lateRate: null } }),
  );
  assert.deepEqual(empty.extension, { value: "–", sub: "Bu dönemde oturum yok" });
  assert.deepEqual(empty.cancel, { value: "–", sub: "Bu dönemde site rezervasyonu yok" });
  assert.deepEqual(empty.lead, { value: "–", sub: "Bu dönemde site rezervasyonu yok" });
  assert.equal(kpiTexts(summaryWith({ cancellations: { bookings: 13, cancelled: 0, late: 0, unknownTime: 0, lateRate: 0 } })).cancel.sub, "13 rezervasyon · iptal yok");
  // Rakamdan sonra kesme işaretli ek yok
  for (const v of Object.values(t)) assert.doesNotMatch(`${v.value} ${v.sub}`, /\d'/);
});

test("ay ay: en yeni başta en çok 6 ay, ilk veri ayından eskiye gitmez; sayaçtan önceki aylar işaretli", () => {
  assert.deepEqual(recentMonths("2026-10-22", "2026-01"), ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
  assert.deepEqual(recentMonths("2026-10-22", "2026-09"), ["2026-10", "2026-09"]);
  assert.deepEqual(recentMonths("2026-10-22", null), ["2026-10"]);
  assert.equal(recentMonths("2026-10-22", "2025-01", 24).length, 22);
  const rows = monthRows(
    [sess(T("2026-09-10", "20:00"), T("2026-09-10", "22:00")), sess(T("2026-10-21", "20:00"), T("2026-10-21", "21:00"), { source: "panel" })],
    ["2026-10", "2026-09"],
    "2026-10-22",
    { hours: DEFAULT_ROOM_HOURS, firstTimerDay: "2026-10-21" },
  );
  assert.deepEqual(
    rows.map((r) => [r.month, r.period.days, r.period.partial, r.beforeTimers, r.summary.sessions.site + r.summary.sessions.panel]),
    [
      ["2026-10", 21, true, true, 1],
      ["2026-09", 30, false, true, 1],
    ],
  );
  assert.equal(monthRows([], ["2026-11"], "2026-11-15", { hours: DEFAULT_ROOM_HOURS, firstTimerDay: "2026-10-21" })[0].beforeTimers, false);
  assert.equal(monthRows([], ["2026-09"], "2026-10-22", { hours: DEFAULT_ROOM_HOURS, firstTimerDay: null })[0].beforeTimers, false, "sayaç hiç yoksa işaret yok");
});

test("puan farkı yalnız karşılaştırılabilir dönemlerde: veriden önce ya da sayacın başladığı günü içeren dönem yok", () => {
  const p4 = (now: string) => resolvePeriod("4h", undefined, T(now, "14:00"));
  const prod = { siteSince: "2026-01-01", timerSince: "2026-10-21" };
  // 1 Kasım: bu dönem sayacın başladığı günü içeriyor
  assert.equal(comparable(p4("2026-11-01"), previousPeriod(p4("2026-11-01")), prod), false);
  // 20 Kasım: bu dönem sayaçtan sonra, önceki içeriyor
  assert.equal(comparable(p4("2026-11-20"), previousPeriod(p4("2026-11-20")), prod), false);
  // 20 Aralık: ikisi de sayaçtan sonra
  assert.equal(comparable(p4("2026-12-20"), previousPeriod(p4("2026-12-20")), prod), true);
  // Ay ay: Eylül ↔ Ağustos (ikisi de yalnız site), Ekim ↔ Eylül (Ekim karışık), Aralık ↔ Kasım
  assert.equal(comparable(monthPeriod("2026-09", "2026-10-22"), monthPeriod("2026-08", "2026-10-22"), prod), true);
  assert.equal(comparable(monthPeriod("2026-10", "2026-10-22"), monthPeriod("2026-09", "2026-10-22"), prod), false);
  assert.equal(comparable(monthPeriod("2026-12", "2027-01-05"), monthPeriod("2026-11", "2027-01-05"), prod), true);
  // Geçmiş alınmadan: verinin başladığı günden önceki dönemle kıyas yok
  assert.equal(comparable(p4("2026-11-20"), previousPeriod(p4("2026-11-20")), { siteSince: "2026-10-22", timerSince: null }), false);
  assert.equal(comparable(p4("2026-12-20"), previousPeriod(p4("2026-12-20")), { siteSince: "2026-10-22", timerSince: null }), true);
  assert.equal(comparable(p4("2026-12-20"), previousPeriod(p4("2026-12-20")), { siteSince: null, timerSince: null }), false, "veri yok");
});

test("puan farkı: önceki dönemde hiç oturum ya da rezervasyon yoksa gösterilmez (geçmişin ilk ayı ilk rezervasyondan önce)", () => {
  // Geçmiş Ocak'tan alındı ama site ilk rezervasyonu Ağustos'ta aldı: Ağustos ↔ Temmuz kıyası boş ayla olurdu
  const since = { siteSince: "2026-01-01", timerSince: "2026-10-21" };
  const aug = { period: monthPeriod("2026-08", "2026-10-22"), summary: summaryWith({ ratio: 0.16 }) };
  const julEmpty = {
    period: monthPeriod("2026-07", "2026-10-22"),
    summary: summaryWith({ ratio: 0, sessions: { site: 0, panel: 0 }, cancellations: { bookings: 0, cancelled: 0, late: 0, unknownTime: 0, lateRate: null } }),
  };
  assert.equal(occupancyDelta(aug, julEmpty, since), null);
  // Yalnız iptal edilmiş rezervasyon da veri sayılır
  const julCancelled = { ...julEmpty, summary: { ...julEmpty.summary, cancellations: { ...julEmpty.summary.cancellations, bookings: 1, cancelled: 1 } } };
  assert.ok(Math.abs((occupancyDelta(aug, julCancelled, since) ?? NaN) - 0.16) < 1e-9);
  const jul = { period: monthPeriod("2026-07", "2026-10-22"), summary: summaryWith({ ratio: 0.1 }) };
  assert.ok(Math.abs((occupancyDelta(aug, jul, since) ?? NaN) - 0.06) < 1e-9);
  // Karşılaştırılamayan dönem ve kapasitesiz önceki dönem
  assert.equal(occupancyDelta(aug, jul, { siteSince: "2026-08-01", timerSince: null }), null);
  assert.equal(occupancyDelta(aug, { ...jul, summary: summaryWith({ ratio: 0.1, capacityMin: 0 }) }, since), null);
});

test("oda saatleri: geçerli aralık; kapanış açılıştan sonra, en geç 05:00; bozuk değer null", () => {
  assert.deepEqual(parseRoomHours({ open: 10, close: 22, by: "Yönetici" }), { open: 10, close: 22 });
  assert.deepEqual(parseRoomHours({ open: 12, close: 29 }), { open: 12, close: 29 });
  assert.equal(parseRoomHours({ open: 10, close: 10 }), null);
  assert.equal(parseRoomHours({ open: 10, close: 30 }), null);
  assert.equal(parseRoomHours({ open: 4, close: 12 }), null);
  assert.equal(parseRoomHours({ open: "10", close: 22 }), null);
  assert.equal(parseRoomHours({ open: 10.5, close: 22 }), null);
  assert.equal(parseRoomHours("10-22"), null);
  assert.equal(parseRoomHours(null), null);
});

/** Sitenin gönderdiği satır (tests/karaoke.test.ts'tekiyle aynı) */
const site = (over: Partial<SiteReservation> = {}): SiteReservation => ({
  id: "krk-0001",
  date: "2026-09-12",
  startHour: 20,
  hours: 2,
  startsAt: "2026-09-12T17:00:00.000Z",
  endsAt: "2026-09-12T19:00:00.000Z",
  guests: 4,
  status: "confirmed",
  paymentStatus: "paid",
  firstName: "Ayşe",
  note: "Doğum günü",
  totalMinor: 200000,
  channel: "web",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:05:00.000Z",
  ...over,
});

test("geçmişi siteden alma: ay ay pencereler, ilerleme, devam ve yeniden alma", () => {
  const windows = historyWindows("2026-01", historyEnd("2026-10-22"));
  assert.equal(windows.length, 10);
  assert.deepEqual(windows[0], { month: "2026-10", from: "2026-10-01", to: "2026-10-20" });
  assert.deepEqual(windows[9], { month: "2026-01", from: "2026-01-01", to: "2026-01-31" });
  assert.ok(windows.every((w) => daysBetween(w.from, w.to) < 31), "pencere bir takvim ayı (sitenin sınırı 400 gün)");
  // 1 Kasım'da Ekim 30'unda biter (31'i düzenli eşitleme getirir), Kasım yok; 2 Kasım'da Ekim tam
  assert.deepEqual(historyWindows("2026-01", historyEnd("2026-11-01"))[0], { month: "2026-10", from: "2026-10-01", to: "2026-10-30" });
  assert.deepEqual(historyWindows("2026-01", historyEnd("2026-11-02"))[0], { month: "2026-10", from: "2026-10-01", to: "2026-10-31" });

  const done = (months: string[], through: string | null = "2026-10-20"): HistoryState => ({
    ...EMPTY_HISTORY,
    through,
    months: Object.fromEntries(months.map((m) => [m, { count: 3, at: "2026-10-22T10:00:00.000Z" }])),
  });
  const half = done(["2026-10", "2026-09", "2026-08", "2026-07"]);
  assert.deepEqual(historyProgress(half, "2026-10-22"), { done: 4, total: 10, complete: false, first: "2026-07", through: "2026-10-20" });
  // Yarım kalan: eksik aylar, kayıtlı son günle (aylar geçse de)
  const cont = historyPlan(half, "2026-11-15");
  assert.equal(cont.through, "2026-10-20");
  assert.deepEqual(cont.windows.map((w) => w.month), ["2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01"]);
  // İlk kez: bütün aylar
  const first = historyPlan(EMPTY_HISTORY, "2026-10-22");
  assert.deepEqual([first.through, first.windows.length], ["2026-10-20", 10]);
  // Hepsi alınmış: "Yeniden al" bugüne göre baştan
  const all = done(windows.map((w) => w.month));
  assert.equal(historyProgress(all, "2026-11-15").complete, true);
  const again = historyPlan(all, "2026-11-15");
  assert.deepEqual([again.through, again.windows.length, again.windows[0].month, again.reread], ["2026-11-13", 11, "2026-11", true]);
  assert.equal(first.reread, false);
  assert.equal(cont.reread, false);
  // Bozuk kayıt
  assert.deepEqual(parseHistoryState({ months: { "2026-09": { count: 2, at: "x" }, bozuk: { count: 1, at: "x" }, "2026-08": "x" }, through: "dün" }), {
    months: { "2026-09": { count: 2, at: "x" } },
    through: null,
    lastRunAt: null,
    lastError: null,
  });
  assert.deepEqual(parseHistoryState(null), EMPTY_HISTORY);
});

test("geçmişten gelen satır: ad ve not yok, rezervasyon anı createdAt'ten; iptal anı ilk kez görülen kuralıyla", () => {
  const v = historyValues(site());
  assert.equal(v.bookedAt?.toISOString(), "2026-09-01T09:00:00.000Z");
  assert.ok(!("customerName" in v) && !("note" in v), "ad ve not taşımaz");
  assert.equal(historyValues(site({ createdAt: "bozuk" })).bookedAt, null);
  assert.equal(historyValues(site({ guests: 0 })).guests, null);

  const now = new Date("2026-10-22T10:00:00Z");
  // İlk kez iptal görülen: ödeme yoksa sitenin son değişikliği, ödenmiş / iadede bilinmez
  assert.equal(historyCancelledAt(null, site({ status: "cancelled", paymentStatus: "none" }), now)?.toISOString(), "2026-09-01T09:05:00.000Z");
  assert.equal(historyCancelledAt(null, site({ status: "cancelled", paymentStatus: "refunded" }), now), null);
  // Önceki alma canlı görmüştü: iptal günler sonra okunabilir, "şimdi gördüm" sayılmaz
  const prevLive = { cancelledAt: null, status: "confirmed" as const, paymentStatus: "paid" as const };
  assert.equal(historyCancelledAt(prevLive, site({ status: "cancelled", paymentStatus: "refunded" }), now), null);
  // Panelin bildiği an korunur
  const known = new Date("2026-09-10T08:00:00Z");
  assert.equal(historyCancelledAt({ cancelledAt: known, status: "cancelled", paymentStatus: "refunding" }, site({ status: "cancelled", paymentStatus: "refunded" }), now), known);

  const base = { ...historyValues(site()), cancelledAt: null };
  assert.equal(historyChanged(base, { ...base }), false);
  assert.equal(historyChanged(base, { ...base, status: "cancelled" }), true);
  assert.equal(historyChanged(base, { ...base, bookedAt: null }), true);
  assert.equal(historyChanged(base, { ...base, startsAt: new Date(base.startsAt.getTime()) }), false, "aynı an farklı nesne");
});

test("429: Retry-After saniye ya da tarih, en çok 10 sn; yoksa beklenmez", () => {
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs("0"), 0);
  assert.equal(retryAfterMs("60"), null);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs("bozuk"), null);
  const now = Date.parse("2026-10-22T10:00:00Z");
  assert.equal(retryAfterMs("Thu, 22 Oct 2026 10:00:05 GMT", now), 5000);
});

test("bildirim metni: tamam, yarım, hata; yeniden almada bu çalışmanın ayları", () => {
  const run = { reread: false, read: ["2026-10", "2026-09"], remaining: [], done: 10, total: 10, reservations: 214, created: 200, updated: 14, error: null };
  assert.deepEqual(historyToast({ ...run, status: "ok" }), { tone: "success", text: "Geçmiş alındı: 2 ay, 214 rezervasyon" });
  assert.deepEqual(historyToast({ ...run, status: "partial", done: 4, remaining: ["2026-06"] }), { tone: "info", text: "4 / 10 ay alındı; kalanı için Devam et'e basın" });
  assert.deepEqual(historyToast({ ...run, status: "error", done: 4, error: "Site 8 saniyede yanıt vermedi" }), { tone: "error", text: "4 / 10 ay alındı. Site 8 saniyede yanıt vermedi" });
  const again = { ...run, reread: true, read: ["2026-10", "2026-09", "2026-08", "2026-07"], remaining: ["2026-06", "2026-05"] };
  assert.deepEqual(historyToast({ ...again, status: "ok", remaining: [] }), { tone: "success", text: "Geçmiş yeniden alındı: 4 ay, 214 rezervasyon" });
  assert.deepEqual(historyToast({ ...again, status: "error", error: "Site yanıt vermedi (HTTP 500)" }), { tone: "error", text: "4 / 6 ay yeniden okundu. Site yanıt vermedi (HTTP 500)" });
  assert.deepEqual(historyToast({ ...again, status: "partial" }), { tone: "info", text: "4 / 6 ay yeniden okundu; süre yetmedi, birazdan yeniden deneyin" });
});

test("KVKK: 3 × 366 günden eski oturumların adı ve notu silinir (sitenin kuralı)", () => {
  assert.equal(personalDataCutoff("2026-10-23"), "2023-10-21");
  assert.equal(daysBetween(personalDataCutoff("2026-10-23"), "2026-10-23"), 1098);
  const src = read("src/server/karaoke/history.ts");
  assert.match(src, /\.set\(\{ customerName: null, note: null, updatedAt: now \}\)/);
  assert.match(src, /lt\(k\.date, personalDataCutoff\(todayTR\(now\)\)\), or\(isNotNull\(k\.customerName\), isNotNull\(k\.note\)\)/);
  // Sabah işinin mevcut karaoke adımında (yeni job_runs adımı yok)
  const cron = read("src/app/api/cron/gunluk/route.ts");
  assert.match(cron, /dailyKaraoke\(\)\.catch/);
  assert.match(cron, /karaoke: siteStep\(karaoke\)/);
});

test("yetki ve KVKK: sayfa ve eylemler yalnız yönetici; yükleyici ad ve not okumaz; geçmiş adsız yazılır, silmez", () => {
  const page = read("src/app/panel/karaoke/doluluk/page.tsx");
  assert.match(page, /await requireAdmin\(\)/);
  assert.match(page, /export const maxDuration = 60/);
  assert.ok(page.indexOf("await requireAdmin()") < page.indexOf("new Date()"), "saat çerez okunduktan sonra (istek anı)");

  const loader = read("src/server/karaoke/occupancy.ts");
  assert.match(loader, /^import "server-only";/);
  const select = loader.slice(loader.indexOf("export async function loadOccupancySessions"), loader.indexOf("export async function readKaraokeHours"));
  assert.doesNotMatch(select, /customerName|note/);

  const history = read("src/server/karaoke/history.ts");
  assert.match(history, /^import "server-only";/);
  assert.match(history, /inserts\.push\(\{ \.\.\.values, customerName: null, note: null \}\)/);
  assert.doesNotMatch(history, /\.delete\(/);
  assert.match(history, /pg_advisory_xact_lock\(hashtext\('karaoke-sync'\)\)/, "düzenli eşitlemeyle aynı kilit");

  const actions = read("src/server/actions/karaoke-doluluk.ts");
  const exported = actions.match(/^export async function/gm) ?? [];
  assert.equal(exported.length, 2);
  assert.equal((actions.match(/await requireAdmin\(\)/g) ?? []).length, exported.length, "her eylem yöneticiyi denetler");

  // Diğer oturumun dosyalarına yalnız eklemeli değişiklik: eşitleme iki sütunu satır içinde yazar
  const sync = read("src/server/karaoke/sync.ts");
  assert.match(sync, /bookedAt: siteTime\(r\.createdAt\),/);
  assert.match(sync, /cancelledAt: cancelledAtFor\(prev \?\? null, r, now\),/);
  assert.match(read("src/lib/karaoke/site.ts"), /cancelledAt: z\.string\(\)\.max\(40\)\.optional\(\)\.catch\(undefined\)/);
});

test("geçmiş alma: yazım hatasının metni veritabanının nedeni; sorgu ve parametreler gösterilmez", () => {
  const pg = new Error("deneme: yazım hatası");
  const drizzle = new Error('Failed query: insert into "integration_state" ("key", "value") values ($1, $2)\nparams: karaoke_history,{"months":{}}', { cause: pg });
  assert.equal(writeErrorText(drizzle), "Kayıt yazılamadı (deneme: yazım hatası)");
  assert.equal(writeErrorText(new Error("Connection terminated unexpectedly")), "Kayıt yazılamadı (Connection terminated unexpectedly)");
  const long = writeErrorText(new Error("x".repeat(300)));
  assert.ok(long.length < 140 && long.endsWith("…)"));
  assert.equal(writeErrorText("boom"), "Kayıt yazılamadı (boom)");
});
