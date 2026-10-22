import { sql } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";

import { getDb } from "@/server/db";
import { loadJobsOverview } from "@/server/jobs/alerts";

/**
 * Vercel / izleme için basit sağlık kontrolü. `?isler=1`: günlük işlerin durumu da (yalnız durum adları, mesaj yok);
 * ciddi bir sorun varsa (iş çalışmadı, hata verdi, CRON_SECRET yok) 503. İki iş birden durursa e-posta uyarısı da
 * gidemez; dışarıdan bir izleme servisi bu adresi yoklayarak haber verir (docs/BILDIRIMLER.md).
 */
export async function GET(request: NextRequest) {
  await connection();
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
  const ms = Date.now() - started;
  if (request.nextUrl.searchParams.get("isler") !== "1") return Response.json({ ok: true, db: "up", ms });
  try {
    const o = await loadJobsOverview();
    const danger = o.alerts.some((a) => a.level === "danger");
    return Response.json(
      { ok: !danger, db: "up", ms, isler: { cronSecret: o.cronSecret, gunluk: o.health.gunluk.state, parasut: o.health.parasut.state } },
      { status: danger ? 503 : 200 },
    );
  } catch {
    return Response.json({ ok: false, db: "up", ms, isler: null }, { status: 503 });
  }
}
