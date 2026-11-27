import { connection } from "next/server";

import { cspLogLine, parseCspReports } from "@/lib/csp";
import { cspEntry } from "@/lib/error-log";
import { reportError } from "@/server/errors/store";

/*
 * Content-Security-Policy ihlal raporları (src/lib/csp.ts; docs/DEPLOY.md › Güvenlik başlıkları). Tarayıcı, sayfanın
 * politikasının engellediği (ya da Report-Only'de engelleyeceği) her kaynağı buraya bildirir; rapor Vercel'in çalışma
 * günlüğüne `[csp]` satırı olarak düşer ve panelin hata kaydına yazılır (Ayarlar › Hata kaydı: aynı ihlal tek satır,
 * sayısıyla; `CSP_ENFORCE` kararı oradan; docs/HATA-KAYDI.md). Oturum istemez (tarayıcı raporu çerezsiz gönderebilir),
 * her zaman 204, kayıt beklenmez. Kötüye kullanıma karşı: gövde en çok 16 KB, sunucu örneği başına dakikada en çok 30
 * satır; adresler köken + yola indirilir (sorgu dizgesi, kişisel veri günlüğe girmez); kayıtta aynı ihlal örnek başına
 * 10 saniyede bir yazılır, günde en çok 30 yeni CSP satırı açılır (src/lib/error-log.ts DAILY_NEW_CAP).
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
    void reportError(cspEntry(v));
  }
  return done();
}
