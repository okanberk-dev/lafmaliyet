import { connection } from "next/server";

import { cspLogLine, parseCspReports } from "@/lib/csp";

/*
 * Content-Security-Policy ihlal raporları (src/lib/csp.ts; docs/DEPLOY.md › Güvenlik başlıkları). Tarayıcı, sayfanın
 * politikasının engellediği (ya da Report-Only'de engelleyeceği) her kaynağı buraya bildirir; rapor Vercel'in çalışma
 * günlüğüne `[csp]` satırı olarak düşer. Oturum istemez (tarayıcı raporu çerezsiz gönderebilir), hiçbir şey yazmaz,
 * her zaman 204. Kötüye kullanıma karşı: gövde en çok 16 KB, sunucu örneği başına dakikada en çok 30 satır; adresler
 * köken + yola indirilir (sorgu dizgesi, kişisel veri günlüğe girmez).
 */

const MAX_BYTES = 16 * 1024;
const PER_MINUTE = 30;

let windowStart = 0;
let logged = 0;

const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await connection();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return done();
  let body: string;
  try {
    body = await request.text();
  } catch {
    return done();
  }
  if (body.length > MAX_BYTES) return done();
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    logged = 0;
  }
  for (const v of parseCspReports(body)) {
    if (logged >= PER_MINUTE) break;
    logged++;
    console.warn(cspLogLine(v));
  }
  return done();
}
