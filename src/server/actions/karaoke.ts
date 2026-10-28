"use server";

import { and, eq, gt, lt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { extensionWindow, overlapConflict, siteOverlaps, type OverlapAction, type OverlapConflict } from "@/lib/karaoke/overlap";
import { durationLabel, trClock } from "@/lib/karaoke/session";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { bumpKaraokeVersion, toSessionDTO } from "@/server/karaoke/board";
import { addExtraMinutes, MAX_EXTRA_MINUTES } from "@/server/karaoke/extend";
import { ensureKaraokeFresh, syncKaraoke } from "@/server/karaoke/sync";
import { endKaraokeCore, proposeKaraokeDelete, removeKaraokeTimerCore, reopenKaraokeCore, reviewKaraokeDeleteCore } from "@/server/karaoke/timer";

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
//
// Bitirme, geri açma ve sayacın silinmesi çekirdekte (src/server/karaoke/timer.ts; denetim E-15, E-65): her biri işlem
// geçmişine yazılır. Personel panelden açılan sayacı açılışından sonraki ilk 10 dakikada siler, sonra silinmesini
// ister (Onaylar › Karaoke); yönetici doğrudan siler ve isteği karara bağlar.

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
    // Bitmiş oturumu uzatmak onu yeniden açar (bitti işareti silinir): kimin ne zaman bitirdiği izde kalsın (E-65)
    const reopened = row.endedAt ? ` · ${row.endedBy ?? "Biri"} ${trClock(row.endedAt.getTime()).time}'de bitirmişti, yeniden açıldı` : "";
    await logActivity(me, "Karaoke süresi uzatıldı", `${row.customerName ?? "Oturum"} · +${add} dk${reopened}`);
    refresh();
    return { extraMinutes: done.extraMinutes };
  });
}

/**
 * Bitir: süre dolunca "haber verdim" (alarm susar) ya da erken bitirme. Alarm başka cihazda susturulduysa da bir
 * sonraki kontrolde orada da susar. Zaten bitmişse bir şey yapmaz. İşlem geçmişine planlanan bitişle yazılır (E-65).
 */
export async function endKaraokeSession(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const sid = zId.parse(id);
    const row = await endKaraokeCore(getDb(), me, sid);
    if (row) refresh();
    return null;
  });
}

/**
 * "Bitti"yi geri al (yanlışlıkla bitirildi): iptal edilmiş ya da süresi dolmuş oturum açılmaz; kimin bitirdiği işlem
 * geçmişine yazılır (E-65)
 */
export async function reopenKaraokeSession(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const sid = zId.parse(id);
    await reopenKaraokeCore(getDb(), me, sid);
    refresh();
    return null;
  });
}

/**
 * Panelden açılan sayacı siler (sitenin rezervasyonları silinmez): yönetici her zaman, personel açılışından sonraki ilk
 * 10 dakikada. Personelde süre geçtiyse silinmez, `{ deleted: false }` döner: ekran nedenini sorup silinmesini ister
 * (requestKaraokeTimerDelete).
 */
export async function deleteKaraokeTimer(id: number) {
  return attempt(async () => {
    const me = await requireUser();
    const sid = zId.parse(id);
    const out = await removeKaraokeTimerCore(getDb(), me, sid);
    if (out.status === "deleted") refresh();
    return { deleted: out.status === "deleted" };
  });
}

const deleteRequestSchema = z.object({
  id: zId,
  message: z.string().trim().min(3, "Açıklama en az 3 karakter olmalı").max(300, "Açıklama en çok 300 karakter"),
  clientKey: z
    .string()
    .min(8)
    .max(80)
    .nullish()
    .transform((v) => v ?? null),
});

/**
 * Personel: açılışından 10 dakika sonra sayacın silinmesini ister (zorunlu neden). Sayaç onaya kadar durur; yönetici
 * Onaylar › Karaoke'de karar verir. Yanıtta yalnız isteğin kimliği ve sürümü.
 */
export async function requestKaraokeTimerDelete(input: z.input<typeof deleteRequestSchema>) {
  return attempt(async () => {
    const me = await requireUser();
    if (me.role === "admin") throw new UserError("Yönetici doğrudan siler; istek gerekmez");
    const data = deleteRequestSchema.parse(input);
    const out = await proposeKaraokeDelete(getDb(), me, data);
    if (out.wrote) refresh();
    return { id: out.row.id, version: out.row.version };
  });
}

const reviewSchema = z.object({
  id: zId,
  seenVersion: z.number().int().min(1),
  decision: z.enum(["approve", "reject"]),
  note: zOptText(300),
});

/**
 * Yönetici: sayaç silme isteğini karara bağlar (Onaylar › Karaoke; yalnız ekranda görülen sürüm, başkasının isteği).
 * Onay sayacı siler (sayaç arada silindiyse istek kapanır). Not personele görünür (tutar yazılmaz).
 */
export async function reviewKaraokeDeleteRequest(input: z.input<typeof reviewSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = reviewSchema.parse(input);
    const out = await reviewKaraokeDeleteCore(getDb(), me, data);
    refresh();
    return { status: out.status };
  });
}

/** "Şimdi eşitle": siteden hemen çeker */
export async function syncKaraokeNow() {
  return attempt(async () => {
    const me = await requireUser();
    const r = await syncKaraoke("manual");
    // Kurulum ayrıntısı (anahtar adı, imza, sitenin sürümü) yalnız yöneticiye; personel Eşitle'de kısa söz görür
    if (r.status === "off") throw new UserError(me.role === "admin" ? "laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)" : "laffogato.net bağlantısı kurulmamış; yönetici Ayarlar'dan bakabilir");
    if (r.status === "error") throw new UserError(me.role === "admin" ? r.error : "laffogato.net'e ulaşılamadı; sorun sürerse yöneticiye haber verin.");
    refresh();
    return r;
  });
}
