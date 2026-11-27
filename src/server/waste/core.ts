import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, gte, sql } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import { productIkramRefusal } from "@/lib/asilpos/ikram";
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
import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { currentPhysicalBranch, staffBranchRefusal } from "@/server/branch-scope";
import { closedDayRefusal } from "@/server/closed-days";
import { resolveWasteTarget } from "@/server/data/waste";
import { schema as s, type DB } from "@/server/db";
import { loadBranchSwitchDay } from "@/server/asilpos/branch";
import { createOrUpdateRequest, decide, lockForReview, peekForReview, supersede, type StaffRequestRow } from "@/server/staff-requests/core";
import { UserError } from "@/server/user-error";

/*
 * Zayi / ikram yazımının çekirdeği (docs/ZAYI-IKRAM.md; plan docs/planlar/personel-yetki.md §2.8): doğrudan kayıt ve
 * silme (iki rol), personelin geç kayıt ve silme isteği, yöneticinin kararı. Personelin doğrudan yolu bugün ve dün (dün
 * kilitlenene kadar; staffWasteMode / staffDeleteMode); kapalı işaretli güne personel yazamaz (closedDayRefusal). Her
 * silme (doğrudan ya da onaylı) aynı kaydın öteki bekleyen silme isteklerini kapatır. AsilPOS gününde (geçiş günü
 * seçili ve gün ondan önce değil) ürün ikramı panele girilmez, AsilPOS'ta işaretlenir (iki rol; geç kayıt isteği ve
 * onayı da; src/lib/asilpos/ikram.ts): hammadde ikramı ve zayi girilir. Gün sonu gelmeyen geçmiş AsilPOS gününde ürün
 * ikramı girilir (o gün panelinki sayılır). Sunucu eylemi değil:
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

/**
 * Günün kasa kilidi: o günün raporu ve ondan sonraki bir rapor (en çok iki satır), verilen şubenin kasasında. Kasa şube
 * başınadır (kasanın kuralı staffDayOpen ile aynı; docs/SUBE.md › Personelin yetkisi): başka şubenin raporu bu şubenin
 * gününü açmaz ya da kapatmaz. Önceden şubesizdi: iki şube dünü ve bugünü girince dün personele hiç kapanmıyordu, Tuzla'nın
 * raporları Marina'nın unutulan dününü kapatıyordu (denetim 21 Kasım #13). Şube: yeni kayıtta ve geç kayıt isteğinde
 * kaydın ineceği fiziksel şube, silmede kaydın kendi şubesi.
 */
export async function wasteLock(db: Tx, date: string, branchId: string): Promise<WasteLock> {
  const rows = await db
    .select({ date: s.cashReports.date })
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
    .orderBy(asc(s.cashReports.date))
    .limit(2);
  return { hasReport: rows[0]?.date === date, laterReport: rows.some((r) => r.date > date) };
}

/**
 * Ürün ikramının AsilPOS reddi (src/lib/asilpos/ikram.ts productIkramClosed): AsilPOS gününde o günün sonu geldiyse ya da
 * gün bugünse metin; gün sonu gelmeyen geçmiş günde, geçiş günü boşken ve ürün ikramı değilse null. Kaydın şubesine
 * bakılır: geçiş günü yalnız AsilPOS'un şubesinin kasasınındır, ModPOS'ta kalan şubenin ürün ikramı panele girilir; gün
 * sonu da kaydın şubesininki (branchSwitchDay; denetim 21 Kasım #5)
 */
async function asilposIkramRefusal(tx: Tx, data: Pick<WasteInput, "date" | "kind" | "productId">, branchId: string, now: Date, where: "zayi" | "onay"): Promise<string | null> {
  if (data.kind !== "ikram" || data.productId === null) return null;
  const switchDay = await loadBranchSwitchDay(branchId, tx);
  if (!switchDay || data.date < switchDay) return null;
  const [day] = await tx
    .select({ date: s.posDayReports.date })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, data.date), eq(s.posDayReports.branchId, branchId)))
    .limit(1);
  return productIkramRefusal(data, switchDay, { received: Boolean(day), today: businessDate(now) }, where);
}

/** Ürün ikramı AsilPOS gününde reddedilir (AsilPOS'ta işaretlenir) */
async function refuseAsilposIkram(tx: Tx, data: Pick<WasteInput, "date" | "kind" | "productId">, branchId: string, now: Date): Promise<void> {
  const refusal = await asilposIkramRefusal(tx, data, branchId, now, "zayi");
  if (refusal) throw new UserError(refusal);
}

/**
 * Doğrudan kayıt: yönetici her geçmiş güne; personel yalnız doğrudan yolun günlerine ve kapalı işaretli olmayan güne.
 * `clientKey` (formun anahtarı, denetim UI-01): aynı anahtarla yazılmış kayıt varsa yenisi açılmaz, o döner
 * (`repeated`); Enter'a ikinci basış ve yanıtı yolda kalan isteğin tekrarı tüketimi iki kez düşmez. Anahtar başına
 * danışma kilidi: aynı anda gelen iki istekten ikincisi birincinin kaydını görür.
 */
export async function addWaste(
  db: DB,
  me: WasteActor,
  data: WasteInput & { clientKey?: string | null },
  now = new Date(),
  branch?: string,
): Promise<{ id: number; name: string; unit: string; qty: number; repeated: boolean }> {
  const { clientKey = null, ...fields } = data;
  if (fields.date > businessDate(now)) throw new UserError("İleri bir güne kayıt girilemez");
  // Zayi şube başına (stok gibi): formun şubesine (`branch`; eylem formBranch(…, "waste") ile doğrular). Verilmezse
  // seçili fiziksel şube ("Tümü" ya da online kanal seçiliyken Tuzla; docs/SUBE.md). Kilit, kapalı gün ve AsilPOS reddi de
  // o şubenin
  const branchId = branch ?? (await currentPhysicalBranch()).id;
  return db.transaction(async (tx) => {
    if (clientKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`zayi-anahtar:${clientKey}`}))`);
      const [same] = await tx.select().from(s.wasteEntries).where(eq(s.wasteEntries.clientKey, clientKey)).limit(1);
      if (same) {
        if (same.createdBy !== me.id) throw new UserError("Bu kayıt başka bir hesaptan girilmiş; sayfayı yenileyin");
        return { id: same.id, name: same.name, unit: same.unit, qty: same.qty, repeated: true };
      }
    }
    await refuseAsilposIkram(tx, data, branchId, now);
    if (me.role !== "admin") {
      const mode = staffWasteMode(data.date, now, await wasteLock(tx, data.date, branchId));
      if (mode !== "direct") throw new UserError(WASTE_REQUEST_TEXT.directOnly);
      const closed = await closedDayRefusal(data.date, me.role, tx, branchId);
      if (closed) throw new UserError(closed);
    }
    const target = await resolveWasteTarget(tx, fields);
    const [row] = await tx
      .insert(s.wasteEntries)
      .values({ ...fields, ...target, branchId, clientKey, createdBy: me.id, createdByName: me.name })
      .returning({ id: s.wasteEntries.id });
    return { id: row.id, ...target, qty: fields.qty, repeated: false };
  });
}

/**
 * Kayıt kimliğiyle gelir (silme, silme isteği): şubesine kilitli personel başka şubenin kaydına dokunmaz; ekran zaten
 * yalnız kendi şubesini gösterir (docs/SUBE.md › Personel hesabının şubesi; 21 Kasım denetimi #14). Yönetici serbest.
 */
async function refuseOtherBranch(me: WasteActor, row: Pick<WasteRow, "branchId">): Promise<void> {
  const refusal = await staffBranchRefusal(me, row.branchId);
  if (refusal) throw new UserError(refusal);
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
    await refuseOtherBranch(me, row);
    // Kilit kaydın kendi şubesinin kasasından (seçili şubeden değil)
    if (me.role !== "admin" && staffDeleteMode(row, me, now, await wasteLock(tx, row.date, row.branchId)) !== "direct") throw new UserError(WASTE_REQUEST_TEXT.deleteOnly);
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
export async function proposeLateWaste(
  db: DB,
  me: WasteActor,
  input: LateWasteInput,
  now = new Date(),
  branch?: string,
): Promise<{ row: StaffRequestRow; created: boolean; payload: LateWastePayloadT }> {
  if (me.role === "admin") throw new UserError(REQUEST_TEXT.adminDirect);
  const message = input.message.trim();
  if (message.length < 3) throw new UserError(WASTE_REQUEST_TEXT.messageShort);
  return db.transaction(async (tx) => {
    // addWaste ile aynı kural: zayi formun şubesine (verilmezse seçili fiziksel şube) yazılır; istek anında kaydedilir
    // ki onay onu bozmasın. Günün kilidi de o şubenin kasasından
    const branchId = branch ?? (await currentPhysicalBranch()).id;
    const mode = staffWasteMode(input.date, now, await wasteLock(tx, input.date, branchId));
    if (mode === "direct") throw new UserError(WASTE_REQUEST_TEXT.useDirect);
    if (mode === "closed") throw new UserError(WASTE_REQUEST_TEXT.windowOld);
    const closed = await closedDayRefusal(input.date, me.role, tx, branchId);
    if (closed) throw new UserError(closed);
    await refuseAsilposIkram(tx, input, branchId, now);
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
      branchId,
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
    // Kayıt kilitlenir (kayıt, sonra istek): aynı anda verilen onay ya da doğrudan silmeyle sıraya girer, silinmiş kayda istek açılmaz
    const [row] = await tx.select().from(s.wasteEntries).where(eq(s.wasteEntries.id, input.id)).for("update");
    if (!row) throw new UserError("Kayıt bulunamadı");
    await refuseOtherBranch(me, row);
    const mode = staffDeleteMode(row, me, now, await wasteLock(tx, row.date, row.branchId));
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
    // Kilit sırası isteği açan ve kaydı doğrudan silen yollarla aynı (kayıt, sonra istek): silme onayında önce kayıt
    const peeked = await peekForReview(tx, me, input.id);
    if (peeked.kind === "zayi-sil" && input.decision === "approve") {
      await tx.select({ id: s.wasteEntries.id }).from(s.wasteEntries).where(eq(s.wasteEntries.id, WasteDeletePayload.parse(peeked.payload).entryId)).for("update");
    }
    const row = await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion, peeked }, now);
    if (row.kind !== "zayi-gec" && row.kind !== "zayi-sil") throw new UserError(REQUEST_TEXT.notFound);
    const kind = row.kind;
    if (input.decision === "reject") {
      return { status: "rejected", request: await decide(tx, row, me, "rejected", { note: input.note }, now), kind };
    }
    if (kind === "zayi-gec") {
      const p = LateWastePayload.parse(row.payload);
      // İstek geçiş günü seçilmeden ya da gün sonu gelmeden önce açılmış olabilir: ürün ikramı o güne panelden
      // kapalıysa onaylanmaz, reddedilir
      const refusal = await asilposIkramRefusal(tx, p, p.branchId ?? DEFAULT_BRANCH_ID, now, "onay");
      if (refusal) throw new UserError(`${refusal} İsteği reddedin.`);
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
          // Şube isteği AÇAN personelinki; bu alandan önceki isteklerde yok, varsayılana düşer
          branchId: p.branchId ?? DEFAULT_BRANCH_ID,
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
