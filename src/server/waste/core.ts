import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, gte } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { REQUEST_TEXT } from "@/lib/staff-requests";
import {
  LateWastePayload,
  lateWasteTitle,
  staffDeleteMode,
  staffWasteMode,
  WASTE_REQUEST_TEXT,
  WasteDeletePayload,
  wasteDeleteTitle,
  wasteEntryMatches,
  type LateWastePayloadT,
  type WasteDeletePayloadT,
  type WasteLock,
} from "@/lib/waste-requests";
import { closedDayRefusal } from "@/server/closed-days";
import { resolveWasteTarget } from "@/server/data/waste";
import { schema as s, type DB } from "@/server/db";
import { createOrUpdateRequest, decide, lockForReview, supersede, type StaffRequestRow } from "@/server/staff-requests/core";
import { UserError } from "@/server/user-error";

/*
 * Zayi / ikram yazımının çekirdeği (docs/ZAYI-IKRAM.md; plan docs/planlar/personel-yetki.md §2.8): doğrudan kayıt ve
 * silme (iki rol), personelin geç kayıt ve silme isteği, yöneticinin kararı. Personelin doğrudan yolu bugün ve dün (dün
 * kilitlenene kadar; staffWasteMode / staffDeleteMode); kapalı işaretli güne personel yazamaz (closedDayRefusal). Her
 * silme (doğrudan ya da onaylı) aynı kaydın öteki bekleyen silme isteklerini kapatır. Sunucu eylemi değil:
 * src/server/actions/waste.ts ve waste-requests.ts oturumu ve rolü denetleyip çağırır (tests/zayi-istek-db.test.ts).
 */

type Tx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface WasteActor {
  id: number;
  name: string;
  role: "admin" | "staff";
}

export interface WasteInput {
  date: string;
  kind: "zayi" | "ikram";
  productId: number | null;
  ingredientId: number | null;
  qty: number;
  reason: string | null;
  note: string | null;
}

export type WasteRow = typeof s.wasteEntries.$inferSelect;

/** Günün kasa kilidi: o günün raporu ve ondan sonraki bir rapor (en çok iki satır) */
export async function wasteLock(db: Tx, date: string): Promise<WasteLock> {
  const rows = await db.select({ date: s.cashReports.date }).from(s.cashReports).where(gte(s.cashReports.date, date)).orderBy(asc(s.cashReports.date)).limit(2);
  return { hasReport: rows[0]?.date === date, laterReport: rows.some((r) => r.date > date) };
}

/** Doğrudan kayıt: yönetici her geçmiş güne; personel yalnız doğrudan yolun günlerine ve kapalı işaretli olmayan güne */
export async function addWaste(db: DB, me: WasteActor, data: WasteInput, now = new Date()): Promise<{ id: number; name: string; unit: string }> {
  if (data.date > businessDate(now)) throw new UserError("İleri bir güne kayıt girilemez");
  return db.transaction(async (tx) => {
    if (me.role !== "admin") {
      const mode = staffWasteMode(data.date, now, await wasteLock(tx, data.date));
      if (mode !== "direct") throw new UserError(WASTE_REQUEST_TEXT.directOnly);
      const closed = await closedDayRefusal(data.date, me.role, tx);
      if (closed) throw new UserError(closed);
    }
    const target = await resolveWasteTarget(tx, data);
    const [row] = await tx
      .insert(s.wasteEntries)
      .values({ ...data, ...target, createdBy: me.id, createdByName: me.name })
      .returning({ id: s.wasteEntries.id });
    return { id: row.id, ...target };
  });
}

/** Aynı kaydın bekleyen silme istekleri kapanır ("Kayıt silindi"); `exceptId` onaylanan istek */
async function closeDeleteRequests(tx: Tx, entryId: number, now: Date, exceptId?: number): Promise<number[]> {
  return supersede(tx, { kinds: ["zayi-sil"], subject: `zayi:${entryId}`, exceptId }, WASTE_REQUEST_TEXT.deleted, now);
}

/** Doğrudan silme: yönetici her kaydı; personel kendi kaydını doğrudan yolun günlerinde */
export async function removeWaste(db: DB, me: WasteActor, id: number, now = new Date()): Promise<WasteRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, id)).for("update");
    if (!row) throw new UserError("Kayıt bulunamadı");
    if (me.role !== "admin" && staffDeleteMode(row, me, now, await wasteLock(tx, row.date)) !== "direct") throw new UserError(WASTE_REQUEST_TEXT.deleteOnly);
    await tx.delete(s.wasteEntries).where(eq(s.wasteEntries.id, row.id));
    await closeDeleteRequests(tx, row.id, now);
    return row;
  });
}

export interface LateWasteInput extends WasteInput {
  /** Yöneticiye açıklama (3–300) */
  message: string;
  clientKey: string | null;
}

/**
 * Personel: geç kayıt isteği (kilitli dün ve dünden önceki 14 gün). Hiçbir şey yazılmaz; yönetici onaylayınca kayıt
 * isteyenin adıyla girer. Kalem istek anında etkin olmalı; aynı gün, tür, kalem ve miktarda bekleyen istek varsa ret.
 */
export async function proposeLateWaste(db: DB, me: WasteActor, input: LateWasteInput, now = new Date()): Promise<{ row: StaffRequestRow; created: boolean; payload: LateWastePayloadT }> {
  if (me.role === "admin") throw new UserError(REQUEST_TEXT.adminDirect);
  const message = input.message.trim();
  if (message.length < 3) throw new UserError(WASTE_REQUEST_TEXT.messageShort);
  return db.transaction(async (tx) => {
    const mode = staffWasteMode(input.date, now, await wasteLock(tx, input.date));
    if (mode === "direct") throw new UserError(WASTE_REQUEST_TEXT.useDirect);
    if (mode === "closed") throw new UserError(WASTE_REQUEST_TEXT.windowOld);
    const closed = await closedDayRefusal(input.date, me.role, tx);
    if (closed) throw new UserError(closed);
    const target = await resolveWasteTarget(tx, input);
    const payload: LateWastePayloadT = LateWastePayload.parse({
      date: input.date,
      kind: input.kind,
      productId: input.productId,
      ingredientId: input.ingredientId,
      ...target,
      qty: input.qty,
      reason: input.reason,
      note: input.note,
    });
    const clientKey = input.clientKey ?? randomUUID();
    // Aynı istek (gün, tür, kalem, miktar) bekliyorsa ikincisi açılmaz; aynı istemci anahtarı ise var olanı döner
    const mine = await tx
      .select({ id: s.staffRequests.id, clientKey: s.staffRequests.clientKey, payload: s.staffRequests.payload })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "zayi-gec"), eq(s.staffRequests.requestedBy, me.id), eq(s.staffRequests.status, "pending"), eq(s.staffRequests.day, input.date)));
    const same = mine.find((r) => {
      const p = LateWastePayload.safeParse(r.payload);
      return p.success && p.data.kind === payload.kind && p.data.productId === payload.productId && p.data.ingredientId === payload.ingredientId && Math.abs(p.data.qty - payload.qty) < 1e-9;
    });
    if (same && same.clientKey !== clientKey) throw new UserError(WASTE_REQUEST_TEXT.sameRequest);
    const out = await createOrUpdateRequest(
      tx,
      me,
      { kind: "zayi-gec", subject: `zayi-yeni:${clientKey}`, day: input.date, title: lateWasteTitle(payload), payload, message, clientKey },
      now,
    );
    return { ...out, payload };
  });
}

/**
 * Personel: kaydın silinmesini ister (başkasının kaydı ya da kilitli günün kaydı; 14 güne kadar). Kayıt istendiği
 * hâliyle yüke yazılır; onayda satır bununla karşılaştırılır.
 */
export async function proposeWasteDelete(
  db: DB,
  me: WasteActor,
  input: { id: number; message: string; clientKey: string | null },
  now = new Date(),
): Promise<{ row: StaffRequestRow; created: boolean; payload: WasteDeletePayloadT }> {
  if (me.role === "admin") throw new UserError(REQUEST_TEXT.adminDirect);
  const message = input.message.trim();
  if (message.length < 3) throw new UserError(WASTE_REQUEST_TEXT.messageShort);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, input.id)).limit(1);
    if (!row) throw new UserError("Kayıt bulunamadı");
    const mode = staffDeleteMode(row, me, now, await wasteLock(tx, row.date));
    if (mode === "direct") throw new UserError(WASTE_REQUEST_TEXT.deleteDirect);
    if (mode === "none") throw new UserError(WASTE_REQUEST_TEXT.deleteOld);
    const payload: WasteDeletePayloadT = {
      entryId: row.id,
      entry: {
        date: row.date,
        kind: row.kind,
        name: row.name,
        qty: row.qty,
        unit: row.unit,
        reason: row.reason,
        note: row.note,
        createdBy: row.createdBy,
        createdByName: row.createdByName,
        createdAt: row.createdAt.toISOString(),
      },
    };
    const out = await createOrUpdateRequest(
      tx,
      me,
      { kind: "zayi-sil", subject: `zayi:${row.id}`, day: row.date, title: wasteDeleteTitle({ ...payload.entry }), payload, message, clientKey: input.clientKey },
      now,
    );
    return { ...out, payload };
  });
}

export type WasteReviewResult =
  | { status: "rejected"; request: StaffRequestRow; kind: "zayi-gec" | "zayi-sil" }
  | { status: "approved"; request: StaffRequestRow; kind: "zayi-gec"; entry: LateWastePayloadT & { id: number } }
  | { status: "approved"; request: StaffRequestRow; kind: "zayi-sil"; entry: WasteDeletePayloadT["entry"] & { id: number } }
  | { status: "gone"; request: StaffRequestRow; kind: "zayi-sil" };

/**
 * Yönetici: zayi isteğini karara bağlar (yalnız ekranda görülen sürüm, başkasının isteği). Geç kayıt onayı kaydı
 * isteyenin adıyla yazar (kalem hâlâ var ve adı aynı olmalı; etkinlik aranmaz). Silme onayı satırı kilitleyip istekteki
 * hâliyle karşılaştırır: tutmazsa ya da satır yoksa istek "Kayıt zaten silinmişti" diye kapanır, hiçbir şey silinmez.
 */
export async function reviewWasteRequestCore(
  db: DB,
  me: WasteActor,
  input: { id: number; seenVersion: number; decision: "approve" | "reject"; note: string | null },
  now = new Date(),
): Promise<WasteReviewResult> {
  return db.transaction(async (tx) => {
    const row = await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion }, now);
    if (row.kind !== "zayi-gec" && row.kind !== "zayi-sil") throw new UserError(REQUEST_TEXT.notFound);
    const kind = row.kind;
    if (input.decision === "reject") {
      return { status: "rejected", request: await decide(tx, row, me, "rejected", { note: input.note }, now), kind };
    }
    if (kind === "zayi-gec") {
      const p = LateWastePayload.parse(row.payload);
      const target = await resolveWasteTarget(tx, p, { requireActive: false }).catch(() => null);
      if (!target || target.name !== p.name || target.unit !== p.unit) throw new UserError("Kalem silinmiş ya da adı değişmiş; isteği reddedin");
      const [entry] = await tx
        .insert(s.wasteEntries)
        .values({
          date: p.date,
          kind: p.kind,
          productId: p.productId,
          ingredientId: p.ingredientId,
          name: p.name,
          unit: p.unit,
          factor: p.factor,
          qty: p.qty,
          reason: p.reason,
          note: p.note,
          createdBy: row.requestedBy,
          createdByName: row.requestedByName,
        })
        .returning({ id: s.wasteEntries.id });
      const request = await decide(tx, row, me, "approved", { note: input.note, resultId: entry.id }, now);
      return { status: "approved", request, kind, entry: { ...p, id: entry.id } };
    }
    const p = WasteDeletePayload.parse(row.payload);
    const [current] = await tx.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, p.entryId)).for("update");
    if (!current || !wasteEntryMatches(p.entry, current)) {
      return { status: "gone", request: await decide(tx, row, me, "superseded", { note: WASTE_REQUEST_TEXT.gone }, now), kind };
    }
    await tx.delete(s.wasteEntries).where(eq(s.wasteEntries.id, current.id));
    const request = await decide(tx, row, me, "approved", { note: input.note, resultId: current.id }, now);
    await closeDeleteRequests(tx, current.id, now, row.id);
    return { status: "approved", request, kind, entry: { ...p.entry, id: current.id } };
  });
}
