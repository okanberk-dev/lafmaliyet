import "server-only";

import { and, count, eq, gte, ne } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { CLOSED_REQUESTS_PER_30, CLOSED_TEXT, ClosedDayPayload, closedEvidenceText, closedTitle, hasPanelEvidence, type ClosedEvidence, type ClosedDayPayloadT } from "@/lib/closed-days";
import { addDays } from "@/lib/reminders";
import { REQUEST_TEXT } from "@/lib/staff-requests";
import { closedDayEvidence, isClosedDay, lockClosedDay, writeClosedDay } from "@/server/closed-days";
import { schema as s, type DB } from "@/server/db";
import { createOrUpdateRequest, decide, lockForReview, peekForReview, type Actor, type StaffRequestRow } from "@/server/staff-requests/core";
import { UserError } from "@/server/user-error";

/*
 * "Kafe kapalıydı" bildirimi ve kararı (plan docs/planlar/personel-yetki.md §2.9; docs/KASA-RAPORU.md › Kafe
 * kapalıydı). Personel yalnız dün için, panelde o güne ait hiçbir iz yokken bildirir; yönetici kanıtı yeniden saydırarak
 * onaylar ya da reddeder, ya da (raporsuz bir gün için) kendisi doğrudan işaretler. Onay `kapali` satırını yöneticinin
 * adıyla yazar. Sunucu eylemi değil: src/server/actions/closed-days.ts oturumu ve rolü denetleyip çağırır
 * (tests/kapali-gun-db.test.ts).
 */

const DAY_MS = 86_400_000;

/** Bir günün bildirimleri aynı anda açılmasın (iki personel aynı dün için; LafPOS'un gün sonu da aynı kilidi alır) */
const lockDay = lockClosedDay;

/**
 * Personelin "Kafe kapalıydı" bildirimi: yalnız dün; gün kapalı işaretli değil, o gün için geri çekilmemiş bir bildirim
 * yok, kişinin son 30 günde 3'ten az bildirimi var ve panelde o güne ait iz yok (kasa raporu, kasadan çıkan, zayi,
 * kontrol listesi, karaoke, personelin işlem geçmişi, Z no boşluğu).
 */
export async function proposeClosedDay(db: DB, me: Actor, input: { date: string; reason: string | null; clientKey: string | null }, now = new Date()): Promise<{ row: StaffRequestRow; created: boolean; payload: ClosedDayPayloadT }> {
  if (me.role === "admin") throw new UserError(CLOSED_TEXT.adminOnly);
  if (input.date !== addDays(businessDate(now), -1)) throw new UserError(CLOSED_TEXT.onlyYesterday);
  const reason = input.reason?.trim() || null;
  const payload = ClosedDayPayload.parse({ date: input.date, reason });
  return db.transaction(async (tx) => {
    await lockDay(tx, input.date);
    if (await isClosedDay(input.date, tx)) throw new UserError(CLOSED_TEXT.approved);
    const prior = await tx
      .select({ status: s.staffRequests.status, clientKey: s.staffRequests.clientKey })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.day, input.date), ne(s.staffRequests.status, "withdrawn")));
    // Aynı istemci anahtarı (çift dokunuş): var olan istek döner
    if (!(input.clientKey && prior.some((p) => p.clientKey === input.clientKey))) {
      if (prior.some((p) => p.status === "rejected")) throw new UserError(CLOSED_TEXT.rejected);
      if (prior.length) throw new UserError(CLOSED_TEXT.already);
      const [{ n }] = await tx
        .select({ n: count() })
        .from(s.staffRequests)
        .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.requestedBy, me.id), ne(s.staffRequests.status, "withdrawn"), gte(s.staffRequests.createdAt, new Date(now.getTime() - 30 * DAY_MS))));
      if (n >= CLOSED_REQUESTS_PER_30) throw new UserError(CLOSED_TEXT.tooMany);
      if (hasPanelEvidence(await closedDayEvidence(tx, input.date))) throw new UserError(CLOSED_TEXT.evidence);
    }
    const out = await createOrUpdateRequest(
      tx,
      me,
      { kind: "kapali-gun", subject: `gun:${input.date}`, day: input.date, title: closedTitle(input.date), payload, message: reason, clientKey: input.clientKey },
      now,
    );
    return { ...out, payload };
  });
}

/**
 * Yöneticinin kararı (tek işlemde): onayda önce günün danışma kilidi, sonra istek kilitlenir ve denetlenir (bekliyor,
 * başkasının, ekranda görülen sürüm). Onayda kanıt yeniden sayılır (panel; site sayıları eylemden gelir): kırmızı varsa
 * ret. Kapalı satırı onaylayan yöneticinin adıyla yazılır. Not bütün personele görünür.
 */
export async function reviewClosedDayCore(
  db: DB,
  me: Actor,
  input: { id: number; seenVersion: number; decision: "approve" | "reject"; note: string | null; site?: ClosedEvidence["site"] },
  now = new Date(),
): Promise<{ status: "approved" | "rejected"; request: StaffRequestRow; payload: ClosedDayPayloadT; specialId: number | null }> {
  if (me.role !== "admin") throw new UserError(REQUEST_TEXT.adminOnly);
  return db.transaction(async (tx) => {
    // Kilit sırası bildirimle ve yöneticinin doğrudan işaretiyle aynı (günün kilidi, sonra istek): onayda önce gün
    const peeked = await peekForReview(tx, me, input.id);
    if (peeked.kind !== "kapali-gun") throw new UserError("Bu istek kapalı gün bildirimi değil");
    if (input.decision === "approve") await lockDay(tx, ClosedDayPayload.parse(peeked.payload).date);
    const row = await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion, peeked }, now);
    const payload = ClosedDayPayload.parse(row.payload);
    if (input.decision === "reject") return { status: "rejected" as const, payload, specialId: null, request: await decide(tx, row, me, "rejected", { note: input.note }, now) };
    const evidence = { ...(await closedDayEvidence(tx, payload.date)), site: input.site ?? null };
    if (closedEvidenceText(evidence).red.length) throw new UserError(CLOSED_TEXT.red);
    const special = await writeClosedDay(tx, me, payload.date, payload.reason);
    const request = await decide(tx, row, me, "approved", { note: input.note, resultId: special.id }, now);
    return { status: "approved" as const, payload, specialId: special.id, request };
  });
}

/**
 * Yönetici raporsuz bir günü doğrudan kapalı işaretler (onaysız; Kasa'daki "Kafe kapalıydı"): rapor olmamalı, gün
 * ileri olmamalı. Kanıt engellemez (pencerede uyarıdır). Aynı günün bekleyen bildirimleri onaylanmış olur.
 */
export async function markClosedDayCore(db: DB, me: Actor, input: { date: string; note: string | null }, now = new Date()): Promise<{ id: number; created: boolean; approved: number[] }> {
  if (me.role !== "admin") throw new UserError(REQUEST_TEXT.adminOnly);
  if (input.date > businessDate(now)) throw new UserError(CLOSED_TEXT.future);
  return db.transaction(async (tx) => {
    await lockDay(tx, input.date);
    const [report] = await tx.select({ id: s.cashReports.id }).from(s.cashReports).where(eq(s.cashReports.date, input.date)).limit(1);
    if (report) throw new UserError(CLOSED_TEXT.reportExists);
    const special = await writeClosedDay(tx, me, input.date, input.note?.trim() || null);
    const approved = await tx
      .update(s.staffRequests)
      .set({ status: "approved", reviewNote: input.note?.trim() || null, reviewedBy: me.id, reviewedByName: me.name, reviewedAt: now, updatedAt: now, resultId: special.id })
      .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "pending"), eq(s.staffRequests.day, input.date)))
      .returning({ id: s.staffRequests.id });
    return { ...special, approved: approved.map((r) => r.id) };
  });
}
