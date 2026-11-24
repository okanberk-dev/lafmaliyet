"use server";

import { and, eq, gt, lt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import {
  DESK_TEXT,
  deskInputSchema,
  deskInstants,
  deskIssue,
  deskLogLine,
  deskMessageFor,
  deskNow,
  deskRemoveRefusal,
  deskWhen,
  deskWhenProblem,
  type DeskData,
  type DeskField,
  type DeskInput,
  type DeskKind,
} from "@/lib/karaoke/desk";
import { extensionWindow, overlapConflict, siteOverlaps, type OverlapAction, type OverlapConflict } from "@/lib/karaoke/overlap";
import { reminderPlanned } from "@/lib/karaoke/reminder";
import { DESK_BLOCK_CHANNEL, durationLabel, trClock } from "@/lib/karaoke/session";
import { KARAOKE_ELSEWHERE, KARAOKE_BRANCH_ID } from "@/lib/branches";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { staffBranchRefusal } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";
import { bumpKaraokeVersion, getSession, toSessionDTO } from "@/server/karaoke/board";
import { cancelDeskBooking, createDeskBooking } from "@/server/karaoke/desk";
import { sessionWhen } from "@/lib/karaoke/timer-requests";
import { addExtraMinutes, MAX_EXTRA_MINUTES } from "@/server/karaoke/extend";
import { cancelKaraokeReminder, findDeskExternalId, scheduleKaraokeReminder } from "@/server/karaoke/reminders";
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
/** Köşkün kapattığı saatler oturum değildir: uzatılmaz, bitirilmez (açmak için "Kaldır") */
const BLOCK_NOT_SESSION = "Kapatılan saatler uzatılmaz; açmak için satırdaki “Kaldır”ı kullanın";
/** Bağlantı kurulu değil: kurulum ayrıntısı yalnız yöneticiye */
const linkOff = (role: "admin" | "staff") =>
  role === "admin" ? "laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)" : "laffogato.net bağlantısı kurulmamış; yöneticiye haber verin.";

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
 * Karaoke yalnız karaokenin şubesinde (KARAOKE_BRANCH_ID; docs/SUBE.md › Karaoke): başka şubeye kilitli personel sayaç
 * başlatamaz, uzatamaz, bitiremez, silemez, köşk rezervasyonu ekleyemez ve eşitleyemez. Sayfa ona "Bu şubede
 * kullanılmıyor" der; eylem kimliği istemci paketinde olduğu için uç da reddeder. Yönetici ve şubesiz personel serbest
 */
async function assertKaraokeBranch(me: { role: string }) {
  if (await staffBranchRefusal(me, KARAOKE_BRANCH_ID)) throw new UserError(KARAOKE_ELSEWHERE);
}

/**
 * Rezervasyonsuz gelen grup için sayaç: şimdi başlar, verilen süre sonra alarm çalar. O saatte sitede geçerli bir
 * rezervasyon varsa (ve `force` yoksa) kaydedilmez, `{ conflict }` döner.
 */
export async function startKaraokeTimer(input: z.input<typeof timerSchema>): Promise<ActionResult<{ id: number; conflict?: undefined } | { id?: undefined; conflict: OverlapConflict }>> {
  return attempt(async () => {
    const me = await requireUser();
    await assertKaraokeBranch(me);
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
    await assertKaraokeBranch(me);
    const sid = zId.parse(id);
    const add = z.number().int().min(5).max(240).parse(minutes);
    const force = z.boolean().optional().parse(opts?.force);
    const db = getDb();
    const [row] = await db.select().from(s.karaokeSessions).where(eq(s.karaokeSessions.id, sid)).limit(1);
    if (!row) throw new UserError(SESSION_GONE);
    if (row.status === "cancelled") throw new UserError(CANCELLED);
    if (row.channel === DESK_BLOCK_CHANNEL) throw new UserError(BLOCK_NOT_SESSION);
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
    const reopened = row.endedAt ? ` · ${row.endedBy ?? "Biri"} bitirmişti (${trClock(row.endedAt.getTime()).time}), yeniden açıldı` : "";
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
    await assertKaraokeBranch(me);
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
    await assertKaraokeBranch(me);
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
    await assertKaraokeBranch(me);
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
    await assertKaraokeBranch(me);
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

/**
 * Elle eklemenin sonucu: eklendi ya da sitenin (ya da panelin) itirazı, formun alanıyla. `reminder`: misafire bir gün kala
 * hatırlatma e-postası kuruldu (e-posta yazıldı ve rezervasyona bir günden fazla var)
 */
export type DeskAddResult =
  | { added: { kind: DeskKind; when: string; email: boolean; reminder: boolean; synced: boolean; externalId: string | null }; problem?: undefined }
  | { added?: undefined; problem: { field: DeskField | null; message: string; uncertain: boolean } };

/** Sitenin ve panelin saatleri arasındaki farka pay: az önce yazılan satır bu kadar geriden de aranır */
const DESK_LOOKUP_SLACK_MS = 2 * 60_000;

/**
 * Misafirin "bir gün kaldı" hatırlatma e-postasını kurar (src/server/karaoke/reminders.ts): rezervasyonda e-posta
 * yazıldıysa ve rezervasyona bir günden fazla varsa. Adres yalnız burada, şifreli ve e-posta gidene kadar saklanır.
 * Sitenin yanıtı kimliği taşımıyorsa (okunamadı, zaman aşımı) eşitlemenin getirdiği satırdan bulunur. Kurulamazsa
 * rezervasyon yine eklenmiştir: hata eklemeyi bozmaz, yalnız hatırlatma gitmez.
 */
async function planDeskReminder(data: DeskData, knownId: string | null, by: string, sinceMs: number): Promise<boolean> {
  if (data.kind !== "booking" || !data.email) return false;
  const { start, end } = deskInstants(data.date, data.startHour, data.hours);
  if (!reminderPlanned(start, Date.now())) return false;
  try {
    const externalId = knownId ?? (await findDeskExternalId(new Date(start), new Date(end), sinceMs - DESK_LOOKUP_SLACK_MS));
    if (!externalId) return false;
    await scheduleKaraokeReminder({ externalId, email: data.email, createdBy: by });
    return true;
  } catch (e) {
    console.error("[karaoke] hatırlatma kurulamadı", e instanceof Error ? e.name : e);
    return false;
  }
}

/**
 * Elle ekle (Karaoke ekranı; yönetici ve personel: telefonla gelen rezervasyon bara gelir): telefonla ya da kasada alınan
 * rezervasyonu ya da köşkün kapattığı saatleri laffogato.net'in takvimine yazar (sitenin imzalı POST ucu; src/server/karaoke/
 * desk.ts). Saatler sitede, uygulamada ve kasada hemen dolu görünür; ardından kopya eşitlenir (ekran, sürüm, öteki
 * cihazlar). Sitenin itirazı (alan + Türkçe mesaj) `problem` olarak döner, pencere alanın yanında gösterir. Telefon
 * yalnız siteye gider; e-posta da öyle, tek ayrıcalıkla: rezervasyona bir günden fazla varsa misafirin "bir gün kaldı"
 * hatırlatması için panelde şifreli ve yalnız e-posta gidene kadar tutulur (planDeskReminder). İşlem geçmişine ikisi de
 * yazılmaz. Sitenin olay kaydına kişinin adı gider.
 */
export async function addDeskKaraoke(input: DeskInput): Promise<ActionResult<DeskAddResult>> {
  return attempt(async () => {
    const me = await requireUser();
    await assertKaraokeBranch(me);
    const parsed = deskInputSchema.safeParse(input);
    if (!parsed.success) return { problem: { ...deskIssue(parsed.error), uncertain: false } };
    const data = parsed.data;
    const problem = deskWhenProblem(data, deskNow(Date.now()));
    if (problem) return { problem: { ...problem, uncertain: false } };
    const startedAt = Date.now();
    const out = await createDeskBooking(data, me.name);
    if (out.status === "off") throw new UserError(linkOff(me.role));
    if (out.status === "refused") {
      // Zaman aşımında satır yazılmış olabilir: eşitleme getirdiyse ekran görür, kişi listeye bakar (hatırlatması da kurulur)
      if (out.reply.uncertain) {
        await planDeskReminder(data, null, me.name, startedAt);
        refresh();
      }
      return { problem: { field: out.reply.field, message: deskMessageFor(me.role, out.reply, "create"), uncertain: out.reply.uncertain } };
    }
    const when = deskWhen(data.date, data.startHour, data.hours);
    const email = data.kind === "booking" && Boolean(data.email);
    const reminder = await planDeskReminder(data, out.reply.reservation?.id ?? null, me.name, startedAt);
    const line = deskLogLine("create", data.kind, { when, name: data.name, guests: data.guests ?? null, note: data.kind === "block" ? `Kapalı${data.note ? `: ${data.note}` : ""}` : null, email, reminder });
    await logActivity(me, line.action, line.detail);
    refresh();
    return { added: { kind: data.kind, when, email, reminder, synced: out.sync.status === "ok" || out.sync.status === "fresh", externalId: out.reply.reservation?.id ?? null } };
  });
}

/**
 * Elle satırı kaldırır (saatler sitede yeniden açılır; e-postası yazılmış rezervasyonda site misafire iptal e-postası
 * gönderir). Yönetici her zaman; personel satır sitede yazıldıktan sonraki ilk 10 dakikada (yanlış girilen satır; sayaç
 * silmenin kuralı), sonrasında ret metni. Sitede alınan (online ödenmiş) rezervasyon buradan kaldırılmaz.
 */
export async function removeDeskKaraoke(id: number): Promise<ActionResult<{ kind: DeskKind; when: string; already: boolean }>> {
  return attempt(async () => {
    const me = await requireUser();
    await assertKaraokeBranch(me);
    const sid = zId.parse(id);
    const row = await getSession(sid);
    if (!row) throw new UserError(DESK_TEXT.gone);
    const dto = toSessionDTO(row, { admin: false });
    const refusal = deskRemoveRefusal(dto, me.role, Date.now());
    if (refusal) throw new UserError(refusal);
    if (!row.externalId || !dto.desk) throw new UserError(DESK_TEXT.notDesk);
    const out = await cancelDeskBooking(row.externalId, me.name);
    if (out.status === "off") throw new UserError(linkOff(me.role));
    const already = out.status === "refused" && out.reply.code === "already_cancelled";
    if (out.status === "refused" && !already) {
      if (out.reply.uncertain) refresh();
      throw new UserError(deskMessageFor(me.role, out.reply, "cancel"));
    }
    // Bekleyen hatırlatma ve misafirin adresi hemen silinir (kaldırılan rezervasyona hatırlatma gitmez)
    await cancelKaraokeReminder(row.externalId).catch((e: unknown) => console.error("[karaoke] hatırlatma silinemedi", e instanceof Error ? e.name : e));
    const when = sessionWhen({ startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), extraMinutes: 0 });
    if (!already) {
      const line = deskLogLine("cancel", dto.desk, { when, name: row.customerName, guests: row.guests, note: row.note });
      await logActivity(me, line.action, line.detail);
    }
    refresh();
    return { kind: dto.desk, when, already };
  });
}

/** "Şimdi eşitle": siteden hemen çeker */
export async function syncKaraokeNow() {
  return attempt(async () => {
    const me = await requireUser();
    await assertKaraokeBranch(me);
    const r = await syncKaraoke("manual");
    // Kurulum ayrıntısı (anahtar adı, imza, sitenin sürümü) yalnız yöneticiye; personel Eşitle'de kısa söz görür
    if (r.status === "off") throw new UserError(me.role === "admin" ? "laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)" : "laffogato.net bağlantısı kurulmamış; yönetici Ayarlar'dan bakabilir");
    if (r.status === "error") throw new UserError(me.role === "admin" ? r.error : "laffogato.net'e ulaşılamadı; sorun sürerse yöneticiye haber verin.");
    refresh();
    return r;
  });
}
