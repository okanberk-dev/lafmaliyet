"use server";

import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { extensionWindow, overlapConflict, siteOverlaps, type OverlapAction, type OverlapConflict } from "@/lib/karaoke/overlap";
import { durationLabel, trClock } from "@/lib/karaoke/session";
import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { bumpKaraokeVersion, toSessionDTO } from "@/server/karaoke/board";
import { addExtraMinutes, MAX_EXTRA_MINUTES } from "@/server/karaoke/extend";
import { ensureKaraokeFresh, syncKaraoke } from "@/server/karaoke/sync";

import { logActivity } from "./log";
import { attempt, UserError, zOptText, type ActionResult } from "./util";

// Karaoke sayacı: personel ve yönetici kullanır. Sitenin rezervasyon alanlarına (saat, durum, kişi) dokunulmaz;
// panel yalnızca kendi sayaç alanlarını (uzatma, bitti) yazar ve rezervasyonsuz sayaç açar. Her değişiklik karaoke
// sayacını artırır: açık sekmeler bir sonraki kontrolde yeni hâli alır.
//
// Oda tektir: rezervasyonsuz sayaç ya da uzatma, sitede o saatte hâlâ geçerli bir rezervasyonla çakışıyorsa kaydedilmez;
// eylem çakışmayı döner, ekran personele sorar ve onaylanınca `force` ile yeniden gönderir (kesin engel değil: bar,
// gelenin rezervasyonu yapan grup olduğunu bilebilir). Kural src/lib/karaoke/overlap.ts'te (docs/KARAOKE.md). Çakışma
// panelin kopyasına bakar: kopya birkaç dakikadan eskiyse ya da bir pingin çekmesi kaybolduysa önce site sorulur
// (freshBeforeConflict).

const zId = z.number().int().positive();

const SESSION_GONE = "Oturum bulunamadı; sayfayı yenileyin";
const CANCELLED = "İptal edilmiş rezervasyon uzatılamaz";
const TOO_LONG = "En fazla 12 saat uzatılabilir";

const timerSchema = z.object({
  minutes: z.number().int().min(5, "En az 5 dakika").max(12 * 60, "En fazla 12 saat"),
  label: zOptText(60),
  guests: z.number().int().min(1).max(100).nullish(),
  /** Çakışma soruldu, personel "yine de" dedi */
  force: z.boolean().optional(),
});

/** Çakışma denetiminden önce kopya en çok bu kadar eski olabilir; daha eskiyse site sorulur */
const CONFLICT_FRESH_MS = 3 * 60_000;

/**
 * Kopya bayatsa önce siteden tazelenir (son birkaç dakikada yapılan rezervasyon da görülsün). Site düşük ya da yavaşsa
 * kopyayla devam edilir: tazeleme hatası sayacı ya da uzatmayı durdurmaz (son deneme hatalı ve yeniyse hiç sorulmaz).
 */
async function freshBeforeConflict(): Promise<void> {
  try {
    await ensureKaraokeFresh({ maxAgeMs: CONFLICT_FRESH_MS });
  } catch (e) {
    console.error("[karaoke] çakışma öncesi tazeleme", e instanceof Error ? e.message : e);
  }
}

/** [start, end) aralığıyla çakışan, sitede hâlâ geçerli rezervasyonlar (`excludeId`: uzatılan oturumun kendisi) */
async function siteConflict(window: { start: number; end: number }, action: OverlapAction, excludeId?: number): Promise<OverlapConflict | null> {
  const rows = await getDb()
    .select()
    .from(s.karaokeSessions)
    .where(
      and(
        eq(s.karaokeSessions.source, "site"),
        lt(s.karaokeSessions.startsAt, new Date(window.end)),
        // Sol taraf sütun değil, ifade: sürücü Date'i kendisi çevirmez, ISO metni verilir (board.ts loadSessions gibi)
        gt(sql`${s.karaokeSessions.endsAt} + make_interval(mins => ${s.karaokeSessions.extraMinutes})`, new Date(window.start).toISOString()),
      ),
    )
    .limit(50);
  return overlapConflict(siteOverlaps(window, rows.map((r) => toSessionDTO(r, { admin: false })), excludeId), action, Date.now());
}

/**
 * Rezervasyonsuz gelen grup için sayaç: şimdi başlar, verilen süre sonra alarm çalar. O saatte sitede geçerli bir
 * rezervasyon varsa (ve `force` yoksa) kaydedilmez, `{ conflict }` döner.
 */
export async function startKaraokeTimer(input: z.input<typeof timerSchema>): Promise<ActionResult<{ id: number; conflict?: undefined } | { id?: undefined; conflict: OverlapConflict }>> {
  return attempt(async () => {
    const me = await requireUser();
    const data = timerSchema.parse(input);
    const now = new Date();
    if (!data.force) {
      await freshBeforeConflict();
      const conflict = await siteConflict({ start: now.getTime(), end: now.getTime() + data.minutes * 60_000 }, "start");
      if (conflict) return { conflict };
    }
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
    await logActivity(
      me,
      "Karaoke sayacı başlatıldı",
      `${data.label ?? "Rezervasyonsuz"} · ${durationLabel(data.minutes)}${data.force ? " · sitedeki rezervasyonla çakışmasına rağmen" : ""}`,
    );
    refresh();
    return { id: row.id };
  });
}

/**
 * Süre uzatma (+15 dk gibi); süresi dolmuş ve susturulmuş oturum yeniden açılır. Eklenen süre sitedeki geçerli bir
 * rezervasyonla çakışıyorsa (ve `force` yoksa) uzatılmaz, `{ conflict }` döner. Yazım tek adımda ve SQL'de toplar
 * (src/server/karaoke/extend.ts): iki cihazdan aynı anda basılan iki uzatma da sayılır.
 */
export async function extendKaraokeSession(
  id: number,
  minutes: number,
  opts: { force?: boolean } = {},
): Promise<ActionResult<{ extraMinutes: number; conflict?: undefined } | { extraMinutes?: undefined; conflict: OverlapConflict }>> {
  return attempt(async () => {
    const me = await requireUser();
    const sid = zId.parse(id);
    const add = z.number().int().min(5).max(240).parse(minutes);
    const force = z.boolean().optional().parse(opts?.force);
    const db = getDb();
    const [row] = await db.select().from(s.karaokeSessions).where(eq(s.karaokeSessions.id, sid)).limit(1);
    if (!row) throw new UserError(SESSION_GONE);
    if (row.status === "cancelled") throw new UserError(CANCELLED);
    if (row.extraMinutes + add > MAX_EXTRA_MINUTES) throw new UserError(TOO_LONG);
    if (!force) {
      await freshBeforeConflict();
      const conflict = await siteConflict(extensionWindow(toSessionDTO(row, { admin: false }), add), "extend", row.id);
      if (conflict) return { conflict };
    }
    const done = await addExtraMinutes(db, sid, add);
    if (!done) {
      // Arada silindi, iptal edildi ya da başka bir cihazın uzatmasıyla 12 saati geçti
      const [cur] = await db.select({ status: s.karaokeSessions.status }).from(s.karaokeSessions).where(eq(s.karaokeSessions.id, sid)).limit(1);
      throw new UserError(!cur ? SESSION_GONE : cur.status === "cancelled" ? CANCELLED : TOO_LONG);
    }
    await bumpKaraokeVersion();
    await logActivity(me, "Karaoke süresi uzatıldı", `${row.customerName ?? "Oturum"} · +${add} dk`);
    refresh();
    return { extraMinutes: done.extraMinutes };
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
