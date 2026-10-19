import "server-only";

import { timingSafeEqual } from "node:crypto";

import { connection, NextResponse, type NextRequest } from "next/server";

/**
 * Vercel Cron isteğini doğrular: CRON_SECRET tanımlıysa Vercel "Authorization: Bearer <CRON_SECRET>" gönderir.
 * Karşılaştırma sabit sürelidir. connection() ile yanıt her zaman istek anında üretilir (önceden derlenmez).
 * Yetkiliyse null, değilse döndürülecek yanıt.
 */
export async function rejectUnlessCron(request: NextRequest): Promise<NextResponse | null> {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET tanımlı değil" }, { status: 503 });
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  return null;
}
