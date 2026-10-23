// "server-only" yok: veritabanıyla gidip gelen test (tests/baglanti-db.test.ts) bu dosyayı doğrudan çalıştırır; eylem
// (src/server/actions/karaoke.ts › extendKaraokeSession) getDb() ile çağırır. "use client" dosyası buraya uzanmaz.

import { and, eq, ne, sql } from "drizzle-orm";

import type { DB } from "@/server/db";
import * as s from "@/server/db/schema";

/** Bir oturum en çok bu kadar uzatılabilir (dakika) */
export const MAX_EXTRA_MINUTES = 12 * 60;

/**
 * Süreyi tek yazımda uzatır: dakika satırın o anki değerine SQL'de eklenir, 12 saat sınırı da aynı yazımda denetlenir.
 * Bar ekranı ve bir telefon aynı anda +15'e basarsa iki uzatma da yazılır (okuyup sonra yazınca biri kayboluyor, alarm
 * müşterinin ödediğinden önce çalıyordu). Süresi dolup susturulmuş oturum yeniden açılır; iptal edilmiş oturum
 * uzatılmaz. Yazıldıysa yeni toplam, yazılmadıysa (yok, iptal ya da sınır) null.
 */
export async function addExtraMinutes(db: Pick<DB, "update">, id: number, add: number, now = new Date()): Promise<{ extraMinutes: number } | null> {
  const k = s.karaokeSessions;
  const [row] = await db
    .update(k)
    .set({ extraMinutes: sql`${k.extraMinutes} + ${add}`, endedAt: null, endedBy: null, updatedAt: now })
    .where(and(eq(k.id, id), ne(k.status, "cancelled"), sql`${k.extraMinutes} + ${add} <= ${MAX_EXTRA_MINUTES}`))
    .returning({ extraMinutes: k.extraMinutes });
  return row ?? null;
}
