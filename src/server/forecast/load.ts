import "server-only";

import { and, asc, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { accuracy, isSameMorning, pastRatios, type Accuracy, type SnapshotLite } from "@/lib/forecast/accuracy";
import { upcomingCalendar, type SpecialKind } from "@/lib/forecast/calendar";
import { dessertPlan, effectiveDessertCategories, isDessertCategory, type DessertGap, type DessertPlan, type ProductMix } from "@/lib/forecast/desserts";
import { buildForecast, HISTORY_DAYS, HORIZON_DAYS, type DayTotal, type Forecast, type ForecastDay, type SpecialDay } from "@/lib/forecast/model";
import { parseForecastSettings, staffFor, type ForecastSettings } from "@/lib/forecast/staffing";
import { cardFooter, digestForecastBox, staffView, type StaffForecastView } from "@/lib/forecast/text";
import { parseWeatherState, type WeatherDay, type WeatherState } from "@/lib/forecast/weather";
import { addDays } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";
import { loadLafposSwitchDay } from "@/server/lafpos/status";
import type { DigestExtraLoad } from "@/server/notify/digest-template";

import { loadDessertMix, loadProductMix } from "./mix";

/**
 * Satış tahmininin okuyucuları (docs/SATIS-TAHMINI.md): sayfa, Bugün'ün yönetici kartı, personelin satırı ve sabah
 * e-postasının kutusu aynı çekirdekten (loadForecastCore) hesaplar. Haftalık özet de çekirdeği okur. Şimdiki zaman ilk
 * veritabanı okumasından sonra alınır: Cache Components önceden render ederken saat okunmaz.
 */

export const FORECAST_SETTINGS_KEY = "forecast.settings";
export const WEATHER_STATE_KEY = "forecast.weather";
/**
 * Özel günler: tahmin bugünden 60 gün ileriye kadarını okur. Geçmişte 60 gün (HISTORY_DAYS) geriye girilir ve listede
 * o kadar görünür (daha eskisi tabana girmez); ileriye 1 yıla kadar girilir ve listede hepsi görünür.
 */
export const SPECIAL_PAST_DAYS = HISTORY_DAYS;
export const SPECIAL_AHEAD_DAYS = 60;
export const SPECIAL_MAX_AHEAD_DAYS = 365;

export async function loadForecastSettings(): Promise<ForecastSettings> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, FORECAST_SETTINGS_KEY)).limit(1);
  return parseForecastSettings(row?.value);
}

export async function loadWeatherState(): Promise<WeatherState | null> {
  const [row] = await getDb().select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, WEATHER_STATE_KEY)).limit(1);
  return parseWeatherState(row?.value);
}

/**
 * Günlük Z toplamları (iki uç dahil): kasa raporları. LafPOS'a geçiş günü seçiliyse o günden itibaren kasa raporu
 * girilmemiş günde LafPOS'un gün sonundaki Z toplamı (rapor kazanır; docs/SATIS-TAHMINI.md, docs/LAFPOS.md). Geçiş günü
 * yoksa LafPOS okunmaz: deneme günleri tahmine girmez.
 */
export async function loadDailyTotals(from: string, to: string): Promise<DayTotal[]> {
  const db = getDb();
  const [rows, switchDay] = await Promise.all([
    db
      .select({ date: s.cashReports.date, total: s.cashReports.zTotal })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to))),
    loadLafposSwitchDay(db),
  ]);
  const out = rows.map((r) => ({ date: r.date, total: r.total }));
  const lafposFrom = switchDay && switchDay > from ? switchDay : from;
  if (switchDay !== null && lafposFrom <= to) {
    const r = s.posDayReports;
    const pos = await db
      .select({ date: r.date, total: sql<number>`(${r.z}->>'zTotal')::double precision`.mapWith(Number) })
      .from(r)
      .where(and(gte(r.date, lafposFrom), lte(r.date, to)));
    const reported = new Set(out.map((x) => x.date));
    for (const p of pos) if (!reported.has(p.date) && Number.isFinite(p.total)) out.push({ date: p.date, total: p.total });
  }
  return out;
}

export interface SpecialDayRow extends SpecialDay {
  note: string | null;
  createdByName: string;
  byStaff: boolean;
  /** Son düzenleyen (yönetici düzenlediyse personel artık değiştiremez) */
  updatedByName: string | null;
}

export interface ForecastCore {
  /** İş günü (D0) */
  today: string;
  now: Date;
  settings: ForecastSettings;
  forecast: Forecast;
  /** Gün → Z toplamı (son 60 gün ve bugün) */
  actuals: Map<string, number>;
  snapshots: SnapshotLite[];
  accuracy: Accuracy;
  weatherState: WeatherState | null;
  /** Hava ayarı açıkken okunan günler */
  weather: WeatherDay[] | null;
  /** Bugünden 60 gün geriye ve ileriye özel günler */
  special: SpecialDayRow[];
}

function toSpecialRow(r: typeof s.specialDays.$inferSelect): SpecialDayRow {
  return {
    id: r.id,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    kind: r.kind as SpecialKind,
    title: r.title,
    effect: r.effect,
    note: r.note,
    createdByName: r.createdByName,
    byStaff: r.byStaff,
    addedBy: r.byStaff ? r.createdByName : null,
    updatedByName: r.updatedByName,
  };
}

/** Tahminin çekirdeği: kasa raporları, ay bilgisi, özel günler, hava, kayıtlı tahminler ve ayarlar aynı anda okunur */
export async function loadForecastCore(now?: Date): Promise<ForecastCore> {
  const db = getDb();
  const [settings, weatherState] = await Promise.all([loadForecastSettings(), loadWeatherState()]);
  // Saat ilk okumadan sonra (Cache Components: önceden render ederken saat okunmaz)
  const at = now ?? new Date();
  const today = businessDate(at);
  const from = addDays(today, -HISTORY_DAYS);
  const [history, months, specialRows, weatherRows, snapRows] = await Promise.all([
    loadDailyTotals(from, today),
    db
      .select({ month: s.months.month, openDays: s.months.openDays, posRevenue: s.months.posRevenue })
      .from(s.months)
      .where(and(gt(s.months.openDays, 0), gt(s.months.posRevenue, 0)))
      .orderBy(desc(s.months.month))
      .limit(3),
    db
      .select()
      .from(s.specialDays)
      .where(and(lte(s.specialDays.dateFrom, addDays(today, SPECIAL_AHEAD_DAYS)), gte(s.specialDays.dateTo, from)))
      .orderBy(asc(s.specialDays.dateFrom), asc(s.specialDays.id)),
    settings.weather ? db.select().from(s.weatherDays).where(gte(s.weatherDays.date, from)) : Promise.resolve(null),
    db
      .select()
      .from(s.forecastSnapshots)
      .where(and(gte(s.forecastSnapshots.date, addDays(today, -HISTORY_DAYS)), lte(s.forecastSnapshots.date, addDays(today, HORIZON_DAYS - 1))))
      .orderBy(asc(s.forecastSnapshots.createdAt)),
  ]);
  const actuals = new Map(history.map((h) => [h.date, h.total]));
  const snapshots: SnapshotLite[] = snapRows.map((r) => ({
    date: r.date,
    madeOn: r.madeOn,
    amount: r.amount,
    low: r.low,
    high: r.high,
    closed: r.closed,
    createdAt: r.createdAt.toISOString(),
  }));
  const special = specialRows.map(toSpecialRow);
  const weather: WeatherDay[] | null = weatherRows
    ? weatherRows.map((w) => ({ date: w.date, tMax: w.tMax, tMin: w.tMin, precipMm: w.precipMm, symbol: w.symbol, hours: w.hours }))
    : null;
  const forecast = buildForecast({
    today,
    history,
    months: months.map((m) => ({ month: m.month, openDays: m.openDays ?? 0, posRevenue: m.posRevenue ?? 0 })),
    special,
    weather,
    pastRatios: pastRatios(snapshots, actuals, today),
  });
  return { today, now: at, settings, forecast, actuals, snapshots, accuracy: accuracy(snapshots, actuals, today), weatherState, weather, special };
}

/** Bu ay kadrodaki kişi (Giderler & personel; başlangıç ve bitiş ayına göre) */
async function rosterCount(month: string): Promise<number> {
  const rows = await getDb()
    .select({ id: s.staff.id })
    .from(s.staff)
    .where(and(or(isNull(s.staff.startMonth), lte(s.staff.startMonth, month)), or(isNull(s.staff.endMonth), gte(s.staff.endMonth, month))));
  return rows.length;
}

/** Günün bu sabah kaydedilen tahmini */
export function morningSnapshot(snaps: readonly SnapshotLite[], date: string): SnapshotLite | null {
  return snaps.find((x) => x.date === date && isSameMorning(x)) ?? null;
}

export interface ForecastPageData extends ForecastCore {
  /** Özel günler kartının listesi: son 60 günde biten ve bütün yaklaşanlar (tahminin 60 günlük penceresinden bağımsız) */
  specialAll: SpecialDayRow[];
  mix: ProductMix | null;
  /** Pay yoksa nedeni: satış yok ya da tatlı kategorilerinde satış yok (Tatlı hazırlığı kartının yazısı) */
  dessertGap: DessertGap | null;
  plan: DessertPlan | null;
  roster: number | null;
  /** Bütün kategorilerin adları ve tatlı sayılıp sayılmadığı (ayar formu) */
  categories: { name: string; dessert: boolean }[];
  upcoming: { from: string; to: string; name: string }[];
}

/** /panel/tahmin: çekirdek, özel günler listesi, tatlı hazırlığı, kadro, kategoriler, önümüzdeki 60 günün takvimi */
export async function loadForecastPage(now?: Date): Promise<ForecastPageData> {
  const core = await loadForecastCore(now);
  const [specialAll, dessert, roster, cats] = await Promise.all([
    // Kaydedilen her özel gün listede görünsün (1 yıl ileriye girilebilir; tahminin penceresi 60 gün)
    getDb()
      .select()
      .from(s.specialDays)
      .where(gte(s.specialDays.dateTo, addDays(core.today, -SPECIAL_PAST_DAYS)))
      .orderBy(asc(s.specialDays.dateFrom), asc(s.specialDays.id))
      .then((rows) => rows.map(toSpecialRow)),
    loadDessertMix(core.settings, core.today).catch((e) => {
      console.error("[tahmin] tatlı payı", e);
      return { mix: null, gap: "satis" as const };
    }),
    rosterCount(core.today.slice(0, 7)).catch(() => null),
    getDb().select({ name: s.categories.name }).from(s.categories).orderBy(asc(s.categories.sortOrder), asc(s.categories.name)),
  ]);
  const open = core.forecast.days;
  const names = cats.map((c) => c.name);
  const chosen = effectiveDessertCategories(core.settings.dessertCategories, names);
  const mix = dessert.mix;
  return {
    ...core,
    specialAll,
    mix,
    dessertGap: dessert.gap,
    plan: mix && open.length ? dessertPlan(open, mix) : null,
    roster,
    categories: names.map((name) => ({ name, dessert: isDessertCategory(name, chosen) })),
    upcoming: upcomingCalendar(core.today, SPECIAL_AHEAD_DAYS),
  };
}

/** Bugün ekranının yönetici kartı (yalnız yönetici; tests/bugun.test.ts kaynaktan denetler) */
export interface ForecastCardData {
  today: string;
  quality: Forecast["quality"];
  days: ForecastDay[];
  staff: { count: number; ifBusy: number | null } | null;
  desserts: number | null;
  footer: string | null;
}

export async function loadForecastCard(now?: Date): Promise<ForecastCardData> {
  const core = await loadForecastCore(now);
  const f = core.forecast;
  const day = f.days[0];
  const mix = day && !day.closed ? await loadProductMix(core.settings, core.today).catch(() => null) : null;
  return {
    today: core.today,
    quality: f.quality,
    days: f.days,
    staff: day ? staffFor(day, core.settings) : null,
    desserts: mix && day ? dessertPlan([day], mix).perDay[0] : null,
    footer: f.days.length ? cardFooter(f, core.snapshots, core.actuals, core.accuracy, addDays(core.today, -1)) : null,
  };
}

/**
 * Personelin Bugün satırı (yalnız personel): ayar kapalıysa ya da tahmin yoksa null. Tutar, aralık, kişi önerisi ve
 * ayarlar buradan çıkmaz: dönen değer staffView'ın dört alanıdır (tests/satis-tahmini.test.ts).
 */
export async function loadStaffForecast(now?: Date): Promise<StaffForecastView | null> {
  const settings = await loadForecastSettings();
  if (!settings.staffSeesLevel) return null;
  const core = await loadForecastCore(now);
  const day = core.forecast.days[0];
  const mix = day && !day.closed ? await loadProductMix(core.settings, core.today).catch(() => null) : null;
  return staffView(core.forecast, mix);
}

/**
 * Sabah e-postasının "Satış tahmini" kutusu (digest-extras.ts; haber değil, yalnız zaten giden e-postaya eklenir).
 * Ayar kapalıysa ya da tahmin yoksa null. Hiçbir şey yazmaz.
 */
export async function loadForecastDigest(): Promise<DigestExtraLoad | null> {
  const settings = await loadForecastSettings();
  if (!settings.emailLine) return null;
  const core = await loadForecastCore();
  if (core.forecast.quality === "yok") return null;
  const mix = await loadProductMix(core.settings, core.today).catch(() => null);
  const box = digestForecastBox({
    forecast: core.forecast,
    settings: core.settings,
    plan: mix ? dessertPlan(core.forecast.days, mix) : null,
    snapshots: core.snapshots,
    actuals: core.actuals,
    accuracy: core.accuracy,
    yesterday: addDays(core.today, -1),
    weatherUsed: Boolean(core.weather?.some((w) => w.date >= core.today)),
  });
  return box ? { box, logKeys: [] } : null;
}

/** Sayfanın özel günler listesi: bütün yaklaşanlar (başlangıca göre) ve son 60 günde bitenler (yeniden eskiye) */
export function specialList(data: Pick<ForecastPageData, "specialAll" | "today">): { upcoming: SpecialDayRow[]; past: SpecialDayRow[] } {
  const pastFrom = addDays(data.today, -SPECIAL_PAST_DAYS);
  return {
    upcoming: data.specialAll.filter((d) => d.dateTo >= data.today),
    past: data.specialAll.filter((d) => d.dateTo < data.today && d.dateTo >= pastFrom).reverse(),
  };
}
