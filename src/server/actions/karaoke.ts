"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { durationLabel, trClock } from "@/lib/karaoke/session";
import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { bumpKaraokeVersion } from "@/server/karaoke/board";
import { syncKaraoke } from "@/server/karaoke/sync";

import { logActivity } from "./log";
import { attempt, UserError, zOptText } from "./util";

// Karaoke sayacı: personel ve yönetici kullanır. Sitenin rezervasyon alanlarına (saat, durum, kişi) dokunulmaz;
// panel yalnızca kendi sayaç alanlarını (uzatma, bitti) yazar ve rezervasyonsuz sayaç açar. Her değişiklik karaoke
// sayacını artırır: açık sekmeler bir sonraki kontrolde yeni hâli alır.

const zId = z.number().int().positive();

const timerSchema = z.object({
  minutes: z.number().int().min(5, "En az 5 dakika").max(12 * 60, "En fazla 12 saat"),
  label: zOptText(60),
  guests: z.number().int().min(1).max(100).nullish(),
});

/** Rezervasyonsuz gelen grup için sayaç: şimdi başlar, verilen süre sonra alarm çalar */
export async function startKaraokeTimer(input: z.input<typeof timerSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    const data = timerSchema.parse(input);
    const now = new Date();
    const db = getDb();
    const [row] = await db
      .insert(s.karaokeSessions)
      .values({
        source: "panel",
        date: trClock(now.getTime()).date,
        startsAt: now,
        endsAt: new Date(now.getTime() + data.minutes * 60_000),
        guests: data.guests ?? null,
        customerName: data.label,
        status: "confirmed",
        paymentStatus: "none",
        createdBy: me.name,
      })
      .returning({ id: s.karaokeSessions.id });
    await bumpKaraokeVersion();
    await logActivity(me, "Karaoke sayacı başlatıldı", `${data.label ?? "Rezervasyonsuz"} · ${durationLabel(data.minutes)}`);
    refresh();
    return { id: row.id };
  });
}

/** Süre uzatma (+15 dk gibi); süresi dolmuş ve susturulmuş oturum yeniden açılır */
export async function extendKaraokeSession(id: number, minutes: number) {
  return attempt(async () => {
    const me = await requireUser();
    const sid = zId.parse(id);
    const add = z.number().int().min(5).max(240).parse(minutes);
    const db = getDb();
    const [row] = await db.select().from(s.karaokeSessions).where(eq(s.karaokeSessions.id, sid)).limit(1);
    if (!row) throw new UserError("Oturum bulunamadı; sayfayı yenileyin");
    if (row.status === "cancelled") throw new UserError("İptal edilmiş rezervasyon uzatılamaz");
    if (row.extraMinutes + add > 12 * 60) throw new UserError("En fazla 12 saat uzatılabilir");
    await db
      .update(s.karaokeSessions)
      .set({ extraMinutes: row.extraMinutes + add, endedAt: null, endedBy: null, updatedAt: new Date() })
      .where(eq(s.karaokeSessions.id, sid));
    await bumpKaraokeVersion();
    await logActivity(me, "Karaoke süresi uzatıldı", `${row.customerName ?? "Oturum"} · +${add} dk`);
    refresh();
    return { extraMinutes: row.extraMinutes + add };
  });
}

/**
 * Bitir: süre dolunca "haber verdim" (alarm susar) ya da erken bitirme. Alarm başka cihazda susturulduysa da bir
 * sonraki kontrolde orada da susar. Zaten bitmişse bir şey yapmaz.
 */
export async function endKaraokeSession(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const sid = zId.parse(id);
    const [row] = await getDb()
      .update(s.karaokeSessions)
      .set({ endedAt: new Date(), endedBy: me.name, updatedAt: new Date() })
      .where(and(eq(s.karaokeSessions.id, sid), isNull(s.karaokeSessions.endedAt)))
      .returning({ customerName: s.karaokeSessions.customerName });
    if (row) {
      await bumpKaraokeVersion();
      refresh();
    }
    return null;
  });
}

/** "Bitti"yi geri al (yanlışlıkla bitirildi) */
export async function reopenKaraokeSession(id: number) {
  return attempt(async () => {
    await requireUser();
    const sid = zId.parse(id);
    const [row] = await getDb()
      .update(s.karaokeSessions)
      .set({ endedAt: null, endedBy: null, updatedAt: new Date() })
      .where(eq(s.karaokeSessions.id, sid))
      .returning({ id: s.karaokeSessions.id });
    if (!row) throw new UserError("Oturum bulunamadı");
    await bumpKaraokeVersion();
    refresh();
    return null;
  });
}

/** Panelden açılan sayacı siler (sitenin rezervasyonları silinmez) */
export async function deleteKaraokeTimer(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const sid = zId.parse(id);
    const [row] = await getDb()
      .delete(s.karaokeSessions)
      .where(and(eq(s.karaokeSessions.id, sid), eq(s.karaokeSessions.source, "panel")))
      .returning({ customerName: s.karaokeSessions.customerName });
    if (!row) throw new UserError("Yalnızca panelden açılan sayaç silinebilir");
    await bumpKaraokeVersion();
    await logActivity(me, "Karaoke sayacı silindi", row.customerName ?? "Rezervasyonsuz");
    refresh();
    return null;
  });
}

/** "Şimdi eşitle": siteden hemen çeker */
export async function syncKaraokeNow() {
  return attempt(async () => {
    await requireUser();
    const r = await syncKaraoke("manual");
    if (r.status === "off") throw new UserError("laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)");
    if (r.status === "error") throw new UserError(r.error);
    refresh();
    return r;
  });
}
