import { sql } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";

import { createTtlCache } from "@/lib/ttl-cache";
import { getDb } from "@/server/db";
import { loadJobsOverview } from "@/server/jobs/alerts";

/** Veritabanı yanıt verdiyse bu kadar süre yeniden sorulmaz (işlev örneği başına) */
const DB_CHECK_TTL_MS = 5 * 60_000;
/** Günlük işlerin durumu günde iki kez değişir (07:30 ve 08:00 işleri): bu kadar süre aynı yanıt */
const JOBS_CHECK_TTL_MS = 10 * 60_000;

const dbCheck = createTtlCache<number>(DB_CHECK_TTL_MS);
const jobsCheck = createTtlCache<{ status: number; body: Record<string, unknown> }>(JOBS_CHECK_TTL_MS);

/**
 * Vercel / izleme için basit sağlık kontrolü. `?isler=1`: günlük işlerin durumu da (yalnız durum adları, mesaj yok);
 * ciddi bir sorun varsa (iş çalışmadı, hata verdi, CRON_SECRET yok) 503. İki iş birden durursa e-posta uyarısı da
 * gidemez; dışarıdan bir izleme servisi bu adresi yoklayarak haber verir (docs/BILDIRIMLER.md).
 *
 * Yanıt veren veritabanı 5 dakika, işlerin durumu 10 dakika yeniden sorulmaz (`cached: true`): adres giriş istemez,
 * sık yoklayan biri (ya da sık ayarlanmış bir izleme) Neon'u hiç uyutmayıp ücretsiz planın aylık kotasını yemesin.
 * Veritabanına ulaşılamazsa önbellek kullanılmaz, her yoklama yeniden dener.
 */
export async function GET(request: NextRequest) {
  await connection();
  const isler = request.nextUrl.searchParams.get("isler") === "1";
  const hit = isler ? jobsCheck.get() : null;
  if (hit) return Response.json({ ...hit.body, cached: true }, { status: hit.status });
  const ms = dbCheck.get();
  if (!isler && ms !== null) return Response.json({ ok: true, db: "up", ms, cached: true });

  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    dbCheck.clear();
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
  const took = Date.now() - started;
  dbCheck.set(took);
  if (!isler) return Response.json({ ok: true, db: "up", ms: took });
  try {
    const o = await loadJobsOverview();
    const danger = o.alerts.some((a) => a.level === "danger");
    const body = { ok: !danger, db: "up", ms: took, isler: { cronSecret: o.cronSecret, gunluk: o.health.gunluk.state, parasut: o.health.parasut.state } };
    const status = danger ? 503 : 200;
    jobsCheck.set({ status, body });
    return Response.json(body, { status });
  } catch {
    return Response.json({ ok: false, db: "up", ms: took, isler: null }, { status: 503 });
  }
}
