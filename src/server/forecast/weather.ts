import "server-only";

import { sql } from "drizzle-orm";

import { DEFAULT_EXPIRES_MS, metUrl, parseMetCompact, refetchGate, userAgent, type WeatherState } from "@/lib/forecast/weather";
import { todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";
import { APP_URL } from "@/server/notify/digest-template";

import { loadForecastSettings, loadWeatherState, WEATHER_STATE_KEY } from "./load";

/** MET isteğinin süresi (sunucu eylemleri sırayla gider: "Güncelle" ekranı uzun bekletmesin; sabah işinin bütçesi) */
export const WEATHER_TIMEOUT_MS = 6_000;

export type WeatherRefresh =
  | { status: "off" }
  | { status: "fresh"; fetchedAt: string | null }
  | { status: "not-modified"; fetchedAt: string }
  | { status: "fetched"; fetchedAt: string; days: number }
  | { status: "error"; error: string };

async function saveState(v: WeatherState) {
  await getDb()
    .insert(s.integrationState)
    .values({ key: WEATHER_STATE_KEY, value: v })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value: v, updatedAt: new Date() } });
}

/** Yanıttaki Expires; yoksa ya da okunamazsa 30 dakika sonrası */
function expiresOf(res: Response, now: Date): string {
  const t = Date.parse(res.headers.get("expires") ?? "");
  return new Date(Number.isFinite(t) ? t : now.getTime() + DEFAULT_EXPIRES_MS).toISOString();
}

/**
 * Hava durumunu MET Norway'den alır (docs/SATIS-TAHMINI.md › Hava durumu): ayar kapalıysa "off"; Expires geçmediyse
 * istek atılmaz ("fresh"); son Last-Modified If-Modified-Since olarak gider (304: "not-modified"). 200 / 203'te bugün
 * ve sonrası weather_days'e yazılır (geçmiş günler donar; bugünün satırı yalnız en az onun kadar adımla güncellenir:
 * öğleden sonraki istek sabahın tam gününü yarım günle ezmesin). Başka her durum "error" (yeniden denenmez; 15
 * dakika içinde tekrar istenmez). En çok 6 sn; hiç hata fırlatmaz.
 */
export async function refreshWeather(now: Date = new Date()): Promise<WeatherRefresh> {
  try {
    const settings = await loadForecastSettings();
    if (!settings.weather) return { status: "off" };
    const state = await loadWeatherState();
    const gate = refetchGate(state, now);
    if (gate === "fresh") return { status: "fresh", fetchedAt: state?.fetchedAt ?? null };
    if (gate === "error-wait") return { status: "error", error: state?.error ?? "Hava durumu alınamadı" };

    const headers: Record<string, string> = { "User-Agent": userAgent(APP_URL, process.env.WEATHER_CONTACT), Accept: "application/json" };
    if (state?.lastModified) headers["If-Modified-Since"] = state.lastModified;
    const fail = async (error: string): Promise<WeatherRefresh> => {
      await saveState({ fetchedAt: state?.fetchedAt ?? null, expires: state?.expires ?? null, lastModified: state?.lastModified ?? null, error, errorAt: now.toISOString() });
      return { status: "error", error };
    };
    let res: Response;
    try {
      // Rota ve eylemlerde fetch önbelleğe alınmaz; önbellek veritabanında (Expires)
      res = await fetch(metUrl(), { headers, cache: "no-store", signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
    } catch (e) {
      return fail((e as Error)?.name === "TimeoutError" ? "Süre doldu" : "Bağlantı kurulamadı");
    }
    const fetchedAt = now.toISOString();
    if (res.status === 304) {
      await saveState({ fetchedAt, expires: expiresOf(res, now), lastModified: state?.lastModified ?? null, error: null, errorAt: null });
      return { status: "not-modified", fetchedAt };
    }
    if (res.status !== 200 && res.status !== 203) return fail(`HTTP ${res.status}`);
    // 203: ürün eskimiş (MET yakında kaldıracak); veri kullanılır, günlükte uyarı
    if (res.status === 203) console.warn("[tahmin] MET Norway 203: locationforecast/2.0/compact eskimiş, belgelerine bakın");
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      return fail((e as Error)?.name === "TimeoutError" ? "Süre doldu" : "Yanıt okunamadı");
    }
    const today = todayTR(now);
    const days = parseMetCompact(json).filter((d) => d.date >= today);
    if (!days.length) return fail("Yanıt okunamadı");
    const at = new Date(fetchedAt);
    await getDb()
      .insert(s.weatherDays)
      .values(days.map((d) => ({ ...d, fetchedAt: at })))
      .onConflictDoUpdate({
        target: s.weatherDays.date,
        set: {
          tMax: sql`excluded.t_max`,
          tMin: sql`excluded.t_min`,
          precipMm: sql`excluded.precip_mm`,
          symbol: sql`excluded.symbol`,
          hours: sql`excluded.hours`,
          fetchedAt: sql`excluded.fetched_at`,
        },
        setWhere: sql`${s.weatherDays.date} > ${today} or excluded.hours >= ${s.weatherDays.hours}`,
      });
    await saveState({ fetchedAt, expires: expiresOf(res, now), lastModified: res.headers.get("last-modified"), error: null, errorAt: null });
    return { status: "fetched", fetchedAt, days: days.length };
  } catch (e) {
    console.error("[tahmin] hava durumu", e);
    return { status: "error", error: "Kaydedilemedi" };
  }
}
