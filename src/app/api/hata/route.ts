import { connection } from "next/server";
import { z } from "zod";

import { CLIENT_BODY_MAX, clientErrorEntry, CLIENT_KINDS, type ClientKind } from "@/lib/error-log";
import { getCurrentUser } from "@/server/auth/dal";
import { createLimiter } from "@/server/auth/rate-limit";
import { reportError } from "@/server/errors/store";
import { sameOrigin } from "@/server/same-origin";

/*
 * Tarayıcı hataları (docs/HATA-KAYDI.md; gönderen src/lib/client-error-report.ts): panelin kendi sayfasından (Origin =
 * Host) ve oturumu açık kullanıcıdan; gövde en çok 8 KB, kişi başına 10 dakikada en çok 20. Kayıt beklenmez; yanıt
 * her durumda gövdesiz. Kayda yalnız ad, ileti, yığının ilk satırları, sayfanın yolu ve tarayıcı ailesi gider
 * (temizlenmiş; src/lib/error-log.ts); kim olduğu yazılmaz.
 */

const limiter = createLimiter({ limit: 20, windowMs: 10 * 60_000 });

const schema = z.object({
  kind: z.enum(Object.keys(CLIENT_KINDS) as [ClientKind, ...ClientKind[]]),
  name: z.string().max(200).nullish(),
  message: z.string().min(1).max(2000),
  stack: z.string().max(5000).nullish(),
  path: z.string().max(500),
  digest: z.string().max(100).nullish(),
});

const reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await connection();
  if (!sameOrigin(request)) return reply(403);
  if (Number(request.headers.get("content-length") ?? 0) > CLIENT_BODY_MAX) return reply(413);
  const me = await getCurrentUser();
  if (!me) return reply(401);
  if (!limiter.hit(String(me.id))) return reply(429);
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return reply(400);
  }
  if (raw.length > CLIENT_BODY_MAX) return reply(413);
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(JSON.parse(raw));
  } catch {
    return reply(400);
  }
  void reportError(clientErrorEntry(body, request.headers.get("user-agent")));
  return reply(204);
}
