import { connection, type NextRequest } from "next/server";

import type { LiveResponse } from "@/lib/live";
import { todayTR } from "@/lib/reminders";
import { getCurrentUser } from "@/server/auth/dal";
import { loadDueReminders, remindersMarker } from "@/server/data/user-reminders";
import { karaokeVersion, liveWindow, loadSessions } from "@/server/karaoke/board";
import { karaokeSecret } from "@/server/karaoke/sync";
import { vapidPublicKey } from "@/server/push/send";

/**
 * Açık panel sekmesinin canlı verisi: bugünün ve yarının karaoke oturumları, kişinin yarına kadarki hatırlatıcıları,
 * sunucu saati (sayaç cihaz saatine değil buna göre sayar) ve bildirim anahtarı. Sekme bunu sürekli sormaz: açılışta,
 * bildirim gelince, sekmeye dönünce ve seyrek bir yedek kontrolde ister. ETag iki ucuz işaretten (karaoke sayacı,
 * hatırlatıcıların değişim işareti) ve günden oluşur; değişiklik yoksa veri okunmadan 304 döner.
 */
export async function GET(request: NextRequest) {
  await connection();
  const headers = { "Cache-Control": "private, no-cache" };
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Giriş gerekli" }, { status: 401, headers });
  const today = todayTR();
  const [version, marker] = await Promise.all([karaokeVersion(), remindersMarker(me.id)]);
  const etag = `W/"${version}.${marker}.${today}.${me.role}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
  const { from, to } = liveWindow();
  const [sessions, reminders, publicKey] = await Promise.all([loadSessions(from, to, { admin: me.role === "admin" }), loadDueReminders(me.id, today), vapidPublicKey()]);
  const body: LiveResponse = {
    serverNow: new Date().toISOString(),
    me: { id: me.id, role: me.role },
    karaoke: { configured: Boolean(karaokeSecret()), sessions },
    reminders,
    push: { publicKey },
  };
  return Response.json(body, { headers: { ...headers, ETag: etag } });
}
