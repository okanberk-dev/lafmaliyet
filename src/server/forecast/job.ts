import "server-only";

import { snapshotDetail } from "@/lib/forecast/model";
import { staffFor } from "@/lib/forecast/staffing";
import { getDb, schema as s } from "@/server/db";

import { loadForecastCore } from "./load";
import { refreshWeather, type WeatherRefresh } from "./weather";

/**
 * Önizlemeler canlının veritabanını paylaşır: başka bir modelin tahmini canlının tutturmasını bozmasın diye önizleme
 * hiçbir şey yazmaz (ne tahmin kaydı ne hava durumu).
 */
export function canWriteSnapshots(): boolean {
  return process.env.VERCEL_ENV !== "preview";
}

/**
 * Bugün ve sonraki 6 günün tahminini kaydeder (hedef gün × bugün; ilk yazan kalır: sabah işi ve "Güncelle" aynı günü
 * iki kez yazmaz). Kaç satır yazıldı; tahmin için veri yoksa null.
 */
export async function snapshotForecast(now: Date = new Date()): Promise<number | null> {
  if (!canWriteSnapshots()) return 0;
  const core = await loadForecastCore(now);
  const f = core.forecast;
  if (f.quality === "yok" || !f.days.length) return null;
  const rows = f.days.map((d) => ({
    date: d.date,
    madeOn: core.today,
    amount: d.amount,
    low: d.low,
    high: d.high,
    closed: Boolean(d.closed),
    staff: staffFor(d, core.settings).count,
    detail: snapshotDetail(f, d),
  }));
  const saved = await getDb()
    .insert(s.forecastSnapshots)
    .values(rows)
    .onConflictDoNothing({ target: [s.forecastSnapshots.date, s.forecastSnapshots.madeOn] })
    .returning({ id: s.forecastSnapshots.id });
  return saved.length;
}

export interface ForecastJobResult {
  /** ok: tahmin kaydedildi ya da zaten kayıtlıydı; skipped: veri yok ya da önizleme; error: kaydedilemedi */
  status: "ok" | "skipped" | "error";
  weather: WeatherRefresh["status"] | "skipped";
  saved: number;
  preview?: boolean;
  /** Hava durumunun alındığı an (fresh / fetched / not-modified) */
  fetchedAt?: string | null;
  weatherError?: string;
  error?: string;
}

/**
 * Sabah işinin satış tahmini adımı (ve "Güncelle"): önce hava durumu (en çok 6 sn), sonra günün tahmin kaydı. Hava
 * alınamazsa tahmin havasız kaydedilir. Önizlemede hiçbir şey yazmaz.
 */
export async function runForecastJob(now: Date = new Date()): Promise<ForecastJobResult> {
  if (!canWriteSnapshots()) return { status: "skipped", weather: "skipped", saved: 0, preview: true };
  const weather = await refreshWeather(now);
  const w = {
    weather: weather.status,
    fetchedAt: "fetchedAt" in weather ? weather.fetchedAt : null,
    ...(weather.status === "error" ? { weatherError: weather.error } : {}),
  };
  try {
    const saved = await snapshotForecast(now);
    return saved === null ? { status: "skipped", saved: 0, ...w } : { status: "ok", saved, ...w };
  } catch (e) {
    console.error("[tahmin] kayıt", e);
    return { status: "error", saved: 0, error: (e as Error).message || "kaydedilemedi", ...w };
  }
}
