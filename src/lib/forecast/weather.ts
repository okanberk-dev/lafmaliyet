/**
 * Hava durumu: MET Norway Locationforecast 2.0 "compact" (saf; tests/satis-tahmini.test.ts). İsteği atan ve kaydeden
 * kısım src/server/forecast/weather.ts. MET'in kuralları (https://api.met.no/doc/TermsOfService, …/HowTO, …/License):
 * ücretsiz, anahtarsız; uygulamanın adı ve iletişimi User-Agent'ta (yoksa 403 / 429); Expires'tan önce yeniden
 * istenmez, If-Modified-Since son Last-Modified'la gönderilir (304: değişmedi); enlem ve boylam en çok 4 ondalık (fazlası
 * 403 / 400); veri NLOD 2.0 ve CC BY 4.0, "Data from MET Norway" kaynağı ekranda ve e-postada yazılır.
 */

import { trHour } from "@/lib/cash-report";
import { num } from "@/lib/format";
import { todayTR } from "@/lib/reminders";

/** Kafenin konumu: İstanbul Tuzla, Opera AVM; Tuzla merkezi (MET'in ızgarasında AVM'nin kendi noktasıyla aynı). Ayar değil */
export const TUZLA = { lat: 40.816, lon: 29.301 } as const;
export const MET_ENDPOINT = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
/** Yağmurlu gün: gün içi (09–23) en az bu kadar mm */
export const RAIN_MM = 5;
/** Çok sıcak gün: gün içi en yüksek en az bu kadar °C */
export const HOT_C = 35;
/** Gün içi (Türkiye saati): 09:00'dan 23:00'e kadar başlayan saatler */
const DAY_FROM = 9;
const DAY_TO = 22;
/** Saatlik yağış bu kadar adımdan azsa (gün bölünmüş) 6 saatlik toplamlara düşülür */
const MIN_HOURLY = 10;
/** Alınamayan istekten sonra yeniden denemeden önce beklenen süre (MET'i sıkıştırmamak için) */
export const ERROR_RETRY_MS = 15 * 60_000;
/** Yanıtta Expires yoksa bu kadar sonra yeniden istenir */
export const DEFAULT_EXPIRES_MS = 30 * 60_000;

/** Bir Türkiye takvim gününün hava özeti (weather_days satırı) */
export interface WeatherDay {
  date: string;
  /** Gün içi en yüksek sıcaklık (°C) */
  tMax: number | null;
  /** Günün en düşük sıcaklığı (°C) */
  tMin: number | null;
  /** Gün içi (09–23) yağış (mm) */
  precipMm: number | null;
  /** MET simgesi, _day / _night eki atılmış ("rain", "partlycloudy") */
  symbol: string | null;
  /**
   * Gün içi (09:00–22:00 arası başlayan) tahmin adımı sayısı. Bugünün satırını yalnız en az bu kadar adımlı istek
   * günceller: dünkü istek bugünü 14 saatlik adımla tam görür, bu sabahki de (08:00'den) öyle; öğleden sonrakinin
   * yarım günü sabahın tam gününü ezmez. Bütün adımlar sayılsaydı dünkü istek (24) sabahkini (16) hep yenerdi.
   */
  hours: number;
}

export type WeatherKind = "yagmur" | "sicak" | "normal";

/** HTTP durumu (integration_state "forecast.weather") */
export interface WeatherState {
  fetchedAt: string | null;
  expires: string | null;
  lastModified: string | null;
  /** Son deneme alınamadıysa: "HTTP 403", "Bağlantı kurulamadı"; alınınca null */
  error: string | null;
  errorAt: string | null;
}

/** İstek adresi: koordinatlar tam 4 ondalık (MET fazlasını reddeder, önbelleği de buna göre) */
export function metUrl(p: { lat: number; lon: number } = TUZLA): string {
  return `${MET_ENDPOINT}?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`;
}

/** Kimlik: uygulama adı, panelin adresi ve (verilirse) iletişim; WEATHER_CONTACT isteğe bağlı, koda yazılmaz */
export function userAgent(appUrl: string, contact?: string | null): string {
  // Başlığa satır sonu ya da denetim karakteri girmesin
  const clean = (v: string) =>
    [...v]
      .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
      .join("")
      .trim();
  const c = contact ? clean(contact) : "";
  return `LAffogatoPanel/1.0 (+${clean(appUrl)}${c ? `; ${c}` : ""})`;
}

/**
 * Yeniden istenebilir mi: Expires geçmediyse "fresh" (MET'in kuralı), son deneme 15 dakikadan yeniyse ve alınamadıysa
 * "error-wait"; aksi "ok".
 */
export function refetchGate(state: WeatherState | null, now: Date): "ok" | "fresh" | "error-wait" {
  if (!state) return "ok";
  const t = now.getTime();
  if (state.error && state.errorAt && t - Date.parse(state.errorAt) < ERROR_RETRY_MS) return "error-wait";
  if (state.expires && t < Date.parse(state.expires)) return "fresh";
  return "ok";
}

/** integration_state'ten okunan değer: bozuk ya da eksikse null alanlar */
export function parseWeatherState(raw: unknown): WeatherState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { fetchedAt: str(r.fetchedAt), expires: str(r.expires), lastModified: str(r.lastModified), error: str(r.error), errorAt: str(r.errorAt) };
}

const numberOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const stripSymbol = (v: unknown): string | null => (typeof v === "string" && v ? v.replace(/_(day|night|polartwilight)$/, "") : null);

interface Acc {
  temps: number[];
  dayTemps: number[];
  hourly: number[];
  six: number[];
  sym6: Map<number, string>;
  sym1: Map<number, string>;
  daySteps: number;
}

/**
 * MET yanıtını Türkiye takvim günlerine böler (savunmalı: bozuk yanıt [] verir). Gün içi 09:00–22:00 arasında başlayan
 * adımlar: en yüksek sıcaklık bunlardan, en düşük bütün günden. Yağış: gün içinde en az 10 saatlik adım varsa onların
 * toplamı, yoksa 09:00 ve 15:00'te (06Z, 12Z) başlayan 6 saatlik toplamlar. Simge 15:00'in, yoksa 09:00'un 6 saatlik
 * simgesi, o da yoksa 15:00'in saatlik simgesi. hours gün içi adım sayısıdır. compact'ta garanti olmayan
 * air_temperature_max okunmaz.
 */
export function parseMetCompact(json: unknown): WeatherDay[] {
  const series = (json as { properties?: { timeseries?: unknown } } | null)?.properties?.timeseries;
  if (!Array.isArray(series)) return [];
  const days = new Map<string, Acc>();
  for (const step of series) {
    if (!step || typeof step !== "object") continue;
    const s = step as { time?: unknown; data?: Record<string, { summary?: { symbol_code?: unknown }; details?: Record<string, unknown> } | undefined> };
    const t = typeof s.time === "string" ? Date.parse(s.time) : NaN;
    if (!Number.isFinite(t)) continue;
    const at = new Date(t);
    const date = todayTR(at);
    const hour = trHour(at);
    let a = days.get(date);
    if (!a) {
      a = { temps: [], dayTemps: [], hourly: [], six: [], sym6: new Map(), sym1: new Map(), daySteps: 0 };
      days.set(date, a);
    }
    const daytime = hour >= DAY_FROM && hour <= DAY_TO;
    if (daytime) a.daySteps++;
    const temp = numberOr(s.data?.instant?.details?.air_temperature);
    if (temp !== null) {
      a.temps.push(temp);
      if (daytime) a.dayTemps.push(temp);
    }
    const n1 = s.data?.next_1_hours;
    const p1 = numberOr(n1?.details?.precipitation_amount);
    if (daytime && p1 !== null) a.hourly.push(p1);
    const sym1 = stripSymbol(n1?.summary?.symbol_code);
    if (sym1) a.sym1.set(hour, sym1);
    const n6 = s.data?.next_6_hours;
    if (hour === 9 || hour === 15) {
      const p6 = numberOr(n6?.details?.precipitation_amount);
      if (p6 !== null) a.six.push(p6);
      const sym6 = stripSymbol(n6?.summary?.symbol_code);
      if (sym6) a.sym6.set(hour, sym6);
    }
  }
  const sum = (xs: number[]) => Math.round(xs.reduce((x, y) => x + y, 0) * 10) / 10;
  return [...days.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([date, a]) => ({
      date,
      tMax: a.dayTemps.length ? Math.max(...a.dayTemps) : null,
      tMin: a.temps.length ? Math.min(...a.temps) : null,
      precipMm: a.hourly.length >= MIN_HOURLY ? sum(a.hourly) : a.six.length ? sum(a.six) : null,
      symbol: a.sym6.get(15) ?? a.sym6.get(9) ?? a.sym1.get(15) ?? null,
      hours: a.daySteps,
    }));
}

/** Günün türü: 5 mm ve üstü yağmur yağmurlu, yoksa 35 °C ve üstü sıcak; veri yoksa null */
export function weatherKind(w: Pick<WeatherDay, "precipMm" | "tMax"> | null | undefined): WeatherKind | null {
  if (!w || (w.precipMm === null && w.tMax === null)) return null;
  if (w.precipMm !== null && w.precipMm >= RAIN_MM) return "yagmur";
  if (w.tMax !== null && w.tMax >= HOT_C) return "sicak";
  return "normal";
}

/** MET simgesinin Türkçesi; bilinmeyen simgede null */
export function symbolWord(symbol: string | null): string | null {
  if (!symbol) return null;
  if (symbol === "clearsky") return "Güneşli";
  if (symbol === "fair") return "Az bulutlu";
  if (symbol === "partlycloudy") return "Parçalı bulutlu";
  if (symbol === "cloudy") return "Bulutlu";
  if (symbol === "fog") return "Sisli";
  if (symbol.includes("thunder")) return "Gök gürültülü";
  if (symbol.includes("sleet")) return "Karla karışık yağmurlu";
  if (symbol.includes("snow")) return "Karlı";
  if (symbol.includes("rain")) return "Yağmurlu";
  return null;
}

/** "Yağmurlu · 6 mm · 19°/12°", "Güneşli · 24°/15°"; hiçbir şey yoksa "Hava bilgisi yok" */
export function weatherText(w: WeatherDay | null | undefined): string {
  if (!w) return "Hava bilgisi yok";
  const kind = weatherKind(w);
  const word = symbolWord(w.symbol) ?? (kind === "yagmur" ? "Yağmurlu" : null);
  const mm = w.precipMm !== null && w.precipMm >= 0.5 ? `${num(w.precipMm)} mm` : null;
  const temp = w.tMax !== null || w.tMin !== null ? `${w.tMax !== null ? num(w.tMax) : "–"}°/${w.tMin !== null ? num(w.tMin) : "–"}°` : null;
  const parts = [word, mm, temp].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Hava bilgisi yok";
}

/** Ekrandaki simge: yağmur (kar dahil), güneş, parçalı, bulut, sıcak */
export function weatherIcon(w: WeatherDay | null | undefined): "rain" | "sun" | "cloudsun" | "cloud" | "hot" | null {
  if (!w) return null;
  const kind = weatherKind(w);
  if (kind === "sicak") return "hot";
  const s = w.symbol ?? "";
  if (kind === "yagmur" || /rain|snow|sleet|thunder/.test(s)) return "rain";
  if (s === "clearsky" || s === "fair") return "sun";
  if (s === "partlycloudy") return "cloudsun";
  if (s) return "cloud";
  return null;
}
