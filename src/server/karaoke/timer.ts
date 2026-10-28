import "server-only";

import { eq, isNull, and } from "drizzle-orm";

import {
  deletedLogDetail,
  deleteRequestRefusal,
  endedLogDetail,
  KARAOKE_REQUEST_TEXT,
  karaokeDeleteMode,
  karaokeDeleteTitle,
  KaraokeDeletePayload,
  reopenLogDetail,
  reopenRefusal,
  type KaraokeDeletePayloadT,
} from "@/lib/karaoke/timer-requests";
import { REQUEST_TEXT } from "@/lib/staff-requests";
import { schema as s, type DB } from "@/server/db";
import { createOrUpdateRequest, decide, lockForReview, peekForReview, supersede, type StaffRequestRow } from "@/server/staff-requests/core";
import { UserError } from "@/server/user-error";

import { bumpKaraokeVersion } from "./board";

/*
 * Karaoke oturumunun bitirilmesi, geri açılması ve sayacın silinmesi (denetim E-15, E-65; docs/KARAOKE.md › Sayacı
 * silmek, bitirmek, geri açmak). Sunucu eylemi değil: src/server/actions/karaoke.ts oturumu ve rolü denetleyip çağırır,
 * veritabanı testi (tests/karaoke-istek-db.test.ts) doğrudan çalıştırır. Her yazım tek işlemde ve işlem geçmişine aynı
 * işlemde yazılır (iz yazımla birlikte kalır ya da ikisi birden düşer); karaoke sayacı artar (açık sekmeler yeni hâli
 * alır).
 *
 * Kilit sırası onay kuyruğunun kuralıyla (docs/ONAYLAR.md › Geliştirici notu): önce oturum satırı (FOR UPDATE), sonra
 * istek. Personelin silme isteği, yöneticinin doğrudan silmesi ve onayı aynı sırayla kilitler.
 */

type Tx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface KaraokeActor {
  id: number;
  name: string;
  role: "admin" | "staff";
}

export type KaraokeSessionRow = typeof s.karaokeSessions.$inferSelect;

/** İşlem geçmişine, yazımla aynı işlemde (kişinin adı ve hesabı) */
async function logIn(tx: Tx, me: KaraokeActor, action: string, detail: string): Promise<void> {
  await tx.insert(s.activityLog).values({ userName: me.name, userId: me.id, action, detail: detail.slice(0, 500) });
}

/** Oturum satırı kilitli (FOR UPDATE); yoksa null */
async function lockSession(tx: Tx, id: number): Promise<KaraokeSessionRow | null> {
  const [row] = await tx.select().from(s.karaokeSessions).where(eq(s.karaokeSessions.id, id)).for("update");
  return row ?? null;
}

/**
 * "Bitti" / "Haber verdim" / "Erken bitir": oturum bitti işaretlenir (alarm susar), kim ve ne zaman yazılır, işlem
 * geçmişine planlanan bitişle birlikte düşer. Zaten bitmişse (başka cihaz bastı) ya da oturum yoksa bir şey yapmaz (null).
 */
export async function endKaraokeCore(db: DB, me: KaraokeActor, id: number, now = new Date()): Promise<KaraokeSessionRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(s.karaokeSessions)
      .set({ endedAt: now, endedBy: me.name, updatedAt: now })
      .where(and(eq(s.karaokeSessions.id, id), isNull(s.karaokeSessions.endedAt)))
      .returning();
    if (!row) return null;
    await logIn(tx, me, "Karaoke oturumu bitirildi", endedLogDetail(row, now));
    await bumpKaraokeVersion(tx);
    return row;
  });
}

/**
 * "Geri aç" (yanlışlıkla bitirildi): iptal edilmiş ya da süresi dolmuş oturum açılmaz. Kimin ne zaman bitirdiği
 * temizlenmeden önce okunur ve işlem geçmişine yazılır. Bitmemişse (başka cihaz açtı) bir şey yapmaz (null).
 */
export async function reopenKaraokeCore(db: DB, me: KaraokeActor, id: number, now = new Date()): Promise<KaraokeSessionRow | null> {
  return db.transaction(async (tx) => {
    const row = await lockSession(tx, id);
    if (!row) throw new UserError("Oturum bulunamadı");
    const refusal = reopenRefusal(row, now.getTime());
    if (refusal) throw new UserError(refusal);
    if (!row.endedAt) return null;
    await tx.update(s.karaokeSessions).set({ endedAt: null, endedBy: null, updatedAt: now }).where(eq(s.karaokeSessions.id, row.id));
    await logIn(tx, me, "Karaoke oturumu yeniden açıldı", reopenLogDetail(row));
    await bumpKaraokeVersion(tx);
    return row;
  });
}

/** Sayacın bekleyen silme isteklerini kapatır (doğrudan silme ya da onay; `exceptId` onaylanan istek) */
async function closeDeleteRequests(tx: Tx, sessionId: number, now: Date, exceptId?: number): Promise<number[]> {
  return supersede(tx, { kinds: ["karaoke-sil"], subject: `karaoke:${sessionId}`, exceptId }, KARAOKE_REQUEST_TEXT.deleted, now);
}

export type RemoveTimerResult = { status: "deleted"; row: KaraokeSessionRow } | { status: "ask" };

/**
 * Sayacı doğrudan siler: yönetici her panel sayacını, personel açılışından sonraki ilk 10 dakikada. Personelde süre
 * geçtiyse hiçbir şey silinmez, `{ status: "ask" }` döner (ekran neden sorup istek açar). Sitenin rezervasyonu
 * silinmez. Aynı sayacın bekleyen silme istekleri "Sayaç silindi" diye kapanır.
 */
export async function removeKaraokeTimerCore(db: DB, me: KaraokeActor, id: number, now = new Date()): Promise<RemoveTimerResult> {
  return db.transaction(async (tx) => {
    const row = await lockSession(tx, id);
    if (!row) throw new UserError(KARAOKE_REQUEST_TEXT.gone);
    const mode = karaokeDeleteMode(row, me.role, now.getTime());
    if (mode === "none") throw new UserError(KARAOKE_REQUEST_TEXT.siteOnly);
    if (mode === "request") return { status: "ask" as const };
    await tx.delete(s.karaokeSessions).where(eq(s.karaokeSessions.id, row.id));
    await closeDeleteRequests(tx, row.id, now);
    await logIn(tx, me, "Karaoke sayacı silindi", deletedLogDetail(row));
    await bumpKaraokeVersion(tx);
    return { status: "deleted" as const, row };
  });
}

/** Silme isteğinin yükü: sayacın istendiği andaki zamanları (etiket yok) */
export function deletePayloadOf(row: KaraokeSessionRow): KaraokeDeletePayloadT {
  return KaraokeDeletePayload.parse({
    sessionId: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    extraMinutes: row.extraMinutes,
    guests: row.guests,
    endedAt: row.endedAt?.toISOString() ?? null,
    endedBy: row.endedBy,
    createdBy: row.createdBy,
  });
}

/**
 * Personel: açılışından 10 dakika sonra sayacın silinmesini ister (zorunlu neden). Sayaç kilitlenir (sayaç, sonra
 * istek): aynı anda verilen onay ya da doğrudan silmeyle sıraya girer, silinmiş sayaca istek açılmaz. Sayaç onaya kadar
 * durur ve sayar. Aynı kişinin aynı sayaca yeniden isteği bekleyen isteği günceller.
 */
export async function proposeKaraokeDelete(
  db: DB,
  me: KaraokeActor,
  input: { id: number; message: string; clientKey: string | null },
  now = new Date(),
): Promise<{ row: StaffRequestRow; created: boolean; wrote: boolean; session: KaraokeSessionRow }> {
  if (me.role === "admin") throw new UserError(REQUEST_TEXT.adminDirect);
  const message = input.message.trim();
  if (message.length < 3) throw new UserError(KARAOKE_REQUEST_TEXT.messageShort);
  return db.transaction(async (tx) => {
    const session = await lockSession(tx, input.id);
    if (!session) throw new UserError(KARAOKE_REQUEST_TEXT.gone);
    const refusal = deleteRequestRefusal(karaokeDeleteMode(session, me.role, now.getTime()));
    if (refusal) throw new UserError(refusal);
    const payload = deletePayloadOf(session);
    const out = await createOrUpdateRequest(
      tx,
      me,
      { kind: "karaoke-sil", subject: `karaoke:${session.id}`, day: session.date, title: karaokeDeleteTitle(payload), payload, message, clientKey: input.clientKey },
      now,
    );
    // Yeni ya da güncellenen istek yazılır; aynı istemci anahtarının tekrarı (çift dokunuş) yazmaz
    const wrote = out.created || out.row.updatedAt.getTime() === now.getTime();
    if (wrote) {
      await logIn(tx, me, "Karaoke sayacının silinmesi istendi", `${deletedLogDetail(session)} · ${message.slice(0, 200)}`);
      await bumpKaraokeVersion(tx);
    }
    return { ...out, wrote, session };
  });
}

export type KaraokeReviewResult =
  | { status: "rejected"; request: StaffRequestRow }
  | { status: "approved"; request: StaffRequestRow; session: KaraokeSessionRow }
  | { status: "gone"; request: StaffRequestRow };

/**
 * Yönetici: sayaç silme isteğini karara bağlar (yalnız ekranda görülen sürüm, başkasının isteği). Onayda sayaç
 * kilitlenir ve silinir; sayaç yoksa (arada silindi) istek "Sayaç zaten silinmişti" diye kapanır. Aynı sayacın öteki
 * bekleyen istekleri kapanır. Not personele görünür.
 */
export async function reviewKaraokeDeleteCore(
  db: DB,
  me: KaraokeActor,
  input: { id: number; seenVersion: number; decision: "approve" | "reject"; note: string | null },
  now = new Date(),
): Promise<KaraokeReviewResult> {
  return db.transaction(async (tx) => {
    // Kilit sırası isteği açan ve sayacı doğrudan silen yollarla aynı (sayaç, sonra istek): onayda önce sayaç
    const peeked = await peekForReview(tx, me, input.id);
    if (peeked.kind !== "karaoke-sil") throw new UserError(REQUEST_TEXT.notFound);
    const p = KaraokeDeletePayload.parse(peeked.payload);
    const session = input.decision === "approve" ? await lockSession(tx, p.sessionId) : null;
    const row = await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion, peeked }, now);
    const tail = `(${row.requestedByName} istedi${input.note ? ` · not: ${input.note}` : ""})`;
    if (input.decision === "reject") {
      const request = await decide(tx, row, me, "rejected", { note: input.note }, now);
      await logIn(tx, me, "Karaoke sayacının silinmesi reddedildi", `${row.title} ${tail}`);
      await bumpKaraokeVersion(tx);
      return { status: "rejected", request };
    }
    if (!session || session.source !== "panel" || session.startsAt.getTime() !== Date.parse(p.startsAt)) {
      const request = await decide(tx, row, me, "superseded", { note: KARAOKE_REQUEST_TEXT.alreadyGone }, now);
      await logIn(tx, me, "Karaoke sayacı silme isteği kapandı", `${row.title} (${row.requestedByName} istedi) · sayaç zaten silinmişti`);
      await bumpKaraokeVersion(tx);
      return { status: "gone", request };
    }
    await tx.delete(s.karaokeSessions).where(eq(s.karaokeSessions.id, session.id));
    const request = await decide(tx, row, me, "approved", { note: input.note, resultId: session.id }, now);
    await closeDeleteRequests(tx, session.id, now, row.id);
    await logIn(tx, me, "Karaoke sayacının silinmesi onaylandı", `${deletedLogDetail(session)} ${tail}`);
    await bumpKaraokeVersion(tx);
    return { status: "approved", request, session };
  });
}
