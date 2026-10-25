import "server-only";

import { and, count, eq, lte, sql } from "drizzle-orm";

import { businessDate } from "@/lib/cash-report";
import {
  draftClean,
  draftDeadline,
  draftEdited,
  DRAFT_KIND,
  DRAFT_PUSH_MS,
  DRAFT_TEXT,
  DRAFT_UNDO_MS,
  draftSubject,
  draftSubmittedAt,
  draftTitle,
  expectedOnHand,
  isDraftExpired,
  parseDraftPayload,
  parseDraftResult,
  sameOrderUnit,
  type DraftLineT,
  type DraftPayloadT,
  type DraftResultT,
} from "@/lib/reorder/draft";
import { isMobile, mobileE164, orderLink, orderMessage } from "@/lib/reorder/message";
import type { ReorderLine } from "@/lib/reorder/types";
import { addDays, clockSuffixTR, daysBetween, todayTR } from "@/lib/reminders";
import { REQUEST_TEXT } from "@/lib/staff-requests";
import { schema as s, type DB } from "@/server/db";
import { createOrUpdateRequest, decide, lockForReview, type Actor, type StaffRequestRow, type Tx } from "@/server/staff-requests/core";
import { UserError } from "@/server/user-error";

/*
 * Personelin mal siparişi taslağının çekirdeği (docs/MAL-SIPARISI.md › Personelin sipariş taslağı; plan
 * docs/planlar/personel-yetki.md §2.4; kurallar src/lib/reorder/draft.ts). Eylemler src/server/actions/order-drafts.ts;
 * bu dosya "use server" değildir, veritabanı testi (tests/mal-siparisi-taslak-db.test.ts) doğrudan çalıştırır.
 *
 * Tedarikçinin planı (öneri, eldeki, sipariş birimi, kart, numara) `deps` ile gelir: canlıda maliyet modelinden
 * (src/server/data/order-drafts.ts › draftDeps), testte sabit bir plandan. Satırlar, tedarikçi, sipariş birimi, mesaj ve
 * numara hep sunucuda kurulur; personelden yalnız kalem kimliği, miktar ve tedarikçiye not gelir.
 *
 * Beş yazım (gönder, karar, toplu onay, gönderim, geri alma) ve yöneticinin doğrudan gönderimi (recordOrderSent) aynı
 * danışma kilidini alır: `mal-taslak:<tedarikçi anahtarı>`.
 */

/** Tedarikçinin planındaki bir kalem (fiyat yok; fiyat yöneticinin kuyruğunda ayrıca okunur) */
export interface DraftPlanLine {
  ingredientId: number;
  name: string;
  orderName: string;
  unit: string;
  /** 1 sipariş biriminin içeriği, kendi biriminde */
  unitSize: number;
  countUnit: string | null;
  countFactor: number;
  /** Önerilen birim; sayılmadıysa ya da hedef yoksa null */
  suggested: number | null;
  /** Son sayım (kendi biriminde), anı ve iş günü */
  onHand: { base: number; at: string; day: string } | null;
  /** Son sayımın gününden önceki son sayım */
  prevCount: { base: number; day: string } | null;
  /** Günlük kullanım (kendi biriminde); bilinmiyorsa null */
  perDay: number | null;
}

export interface SupplierPlan {
  supplier: { key: string; name: string; cardId: number | null; phone: string | null };
  /** Mesajdaki imza (Mal siparişi ayarları) */
  signature: string;
  /** Tedarikçinin etkin kalemleri (sipariş listesindeki gibi) */
  lines: DraftPlanLine[];
  /** Bu tedarikçiye gönderilen (iptal olmayan) en yeni siparişin anı (ISO) */
  lastSentAt: string | null;
}

export type DraftSnapshot = { supplier: { name: string }; lines: ReorderLine[]; maxLead: number } | { error: string };

export interface DraftDeps {
  plan(supplierKey: string): Promise<SupplierPlan | null>;
  /** Gönderilecek siparişin kopyası (orderSnapshot): satırlar sunucunun güncel verisinden */
  snapshot(supplierKey: string, wanted: { ingredientId: number; qty: number }[]): Promise<DraftSnapshot>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const inCount = (base: number, f: number) => Math.round((base / (f > 0 ? f : 1)) * 1000) / 1000;
const hhmm = (d: Date | string) => new Date(d).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/** Tedarikçinin danışma kilidi (işlemin sonuna kadar) */
export async function lockSupplier(tx: Tx, supplierKey: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mal-taslak:${supplierKey}`}))`);
}

/**
 * Tedarikçinin süresi dolmuş canlı taslağını kapatır (tedarikçinin kilidi altında): günlük iş (expireStaffRequests,
 * 08:00'den sonra) beklenmeden yeni taslak açılabilsin. Aynı koşul o işinkiyle, tek tedarikçide.
 */
async function expireLiveDraft(tx: Tx, supplierKey: string, now: Date): Promise<void> {
  const r = s.staffRequests;
  await tx
    .update(r)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(r.kind, DRAFT_KIND), eq(r.subject, draftSubject(supplierKey)), sql`${r.status} in ('pending', 'approved')`, lte(r.expiresAt, now)));
}

/** Tedarikçinin canlı (bekleyen ya da onaylı) taslağı */
async function liveDraft(tx: Tx, supplierKey: string): Promise<StaffRequestRow | null> {
  const r = s.staffRequests;
  const [row] = await tx
    .select()
    .from(r)
    .where(and(eq(r.kind, DRAFT_KIND), eq(r.subject, draftSubject(supplierKey)), sql`${r.status} in ('pending', 'approved')`))
    .limit(1);
  return row ?? null;
}

/** En az bir etkin yöneticinin bir cihazında onay bildirimi açık mı (taslak gidince haber alacak biri var mı) */
export async function adminsReachable(db: Tx): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(s.pushSubscriptions)
    .innerJoin(s.users, eq(s.users.id, s.pushSubscriptions.userId))
    .where(and(eq(s.users.role, "admin"), eq(s.users.active, true), eq(s.pushSubscriptions.approvals, true), eq(s.users.sessionVersion, s.pushSubscriptions.sessionVersion)));
  return (row?.n ?? 0) > 0;
}

// ---------------------------------------------------------------- Personel: taslağı onaya gönder

export interface SubmitInput {
  clientKey: string | null;
  supplierKey: string;
  lines: { ingredientId: number; qty: number }[];
  supplierNote: string | null;
}

/** Plan satırından taslak satırı (fiyatsız; eldeki, önceki ve beklenen sayım biriminde) */
function draftLine(p: DraftPlanLine, qty: number): DraftLineT {
  const f = p.countFactor;
  const prevDays = p.prevCount && p.onHand ? daysBetween(p.prevCount.day, p.onHand.day) : null;
  return {
    ingredientId: p.ingredientId,
    name: p.name,
    orderName: p.orderName,
    qty,
    unit: p.unit,
    unitSize: p.unitSize,
    countUnit: p.countUnit,
    suggested: p.suggested,
    onHand: p.onHand ? inCount(p.onHand.base, f) : null,
    prevCount: p.prevCount ? inCount(p.prevCount.base, f) : null,
    prevCountDay: p.prevCount?.day ?? null,
    expectedOnHand: expectedOnHand(p.prevCount ? inCount(p.prevCount.base, f) : null, p.perDay === null ? null : p.perDay / (f > 0 ? f : 1), prevDays),
    countedAt: p.onHand?.at ?? null,
  };
}

/**
 * Personelin taslağı: tedarikçinin planından sunucuda kurulur (miktar ve not dışında hiçbir şey personelden gelmez).
 * Kartta cep numarası olmalı; miktarı 0'dan büyük her satırın son sayımı dünden eski olmamalı; son sayımdan sonra o
 * tedarikçiye sipariş gitmemiş olmalı. Tedarikçi başına tek canlı taslak: başkasınınki ya da kendi onaylı taslağı varsa
 * ret, kendi bekleyeni güncellenir (sürüm artar). `pushDue`: yöneticilere push gitsin (yeni taslak ya da son push 15
 * dakikadan eski).
 */
export async function submitDraftCore(
  db: DB,
  me: Actor,
  input: SubmitInput,
  deps: DraftDeps,
  now = new Date(),
): Promise<{ row: StaffRequestRow; created: boolean; pushDue: boolean; notified: boolean; payload: DraftPayloadT }> {
  if (me.role === "admin") throw new UserError(DRAFT_TEXT.admin);
  if (new Set(input.lines.map((l) => l.ingredientId)).size !== input.lines.length) throw new UserError("Aynı kalem iki kez gönderildi; sayfayı yenileyin");
  const plan = await deps.plan(input.supplierKey);
  if (!plan) throw new UserError(DRAFT_TEXT.noSupplier);
  if (!isMobile(plan.supplier.phone)) throw new UserError(DRAFT_TEXT.noPhone);
  const byId = new Map(plan.lines.map((l) => [l.ingredientId, l]));
  const wanted = new Map(input.lines.map((l) => [l.ingredientId, round2(l.qty)]));
  for (const id of wanted.keys()) if (!byId.has(id)) throw new UserError("Bir kalem bu tedarikçinin listesinde değil; sayfayı yenileyin");
  // Miktarı olan satırlar ve önerisi olup 0'a indirilenler (yönetici görür)
  const lines = plan.lines
    .filter((p) => (wanted.get(p.ingredientId) ?? 0) > 0 || (wanted.has(p.ingredientId) && (p.suggested ?? 0) > 0))
    .map((p) => draftLine(p, wanted.get(p.ingredientId) ?? 0));
  const chosen = lines.filter((l) => l.qty > 0);
  if (!chosen.length) throw new UserError(DRAFT_TEXT.noLines);
  const yesterday = addDays(businessDate(now), -1);
  for (const l of chosen) {
    const p = byId.get(l.ingredientId)!;
    if (!p.onHand || p.onHand.day < yesterday) throw new UserError(`${DRAFT_TEXT.stale}: ${p.name} ${p.onHand ? "dünden önce sayıldı" : "hiç sayılmadı"}`);
  }
  const lastCount = plan.lines.map((l) => l.onHand?.at ?? "").sort().at(-1) || null;
  if (plan.lastSentAt && lastCount && Date.parse(plan.lastSentAt) > Date.parse(lastCount)) {
    throw new UserError(`Bu tedarikçiye ${todayTR(new Date(plan.lastSentAt)) === todayTR(now) ? "bugün" : "son sayımdan sonra"} ${clockSuffixTR(hhmm(plan.lastSentAt))} sipariş gönderildi`);
  }
  const notified = await adminsReachable(db);
  return db.transaction(async (tx) => {
    await lockSupplier(tx, input.supplierKey);
    await expireLiveDraft(tx, input.supplierKey, now);
    const live = await liveDraft(tx, input.supplierKey);
    if (live && live.requestedBy !== me.id) {
      throw new UserError(`Bu tedarikçinin taslağı ${live.status === "pending" ? "onay bekliyor" : "onaylandı"} (${live.requestedByName}); yeni taslak açılamaz`);
    }
    if (live && live.status === "approved") throw new UserError(DRAFT_TEXT.ownApproved);
    const prev = live ? parseDraftPayload(live.payload) : null;
    const pushDue = !prev?.pushedAt || now.getTime() - Date.parse(prev.pushedAt) >= DRAFT_PUSH_MS;
    const payload: DraftPayloadT = {
      supplierKey: input.supplierKey,
      supplierCardId: plan.supplier.cardId,
      supplier: plan.supplier.name,
      lines,
      supplierNote: input.supplierNote?.trim() || null,
      notified,
      pushedAt: pushDue ? now.toISOString() : (prev?.pushedAt ?? null),
      submittedAt: now.toISOString(),
    };
    const { row, created } = await createOrUpdateRequest(
      tx,
      me,
      {
        kind: DRAFT_KIND,
        subject: draftSubject(input.supplierKey),
        day: businessDate(now),
        title: draftTitle(plan.supplier.name, chosen),
        payload,
        clientKey: input.clientKey,
        expiresAt: draftDeadline(now),
      },
      now,
    );
    // Aynı istemci anahtarı var olanı olduğu gibi döner: yük yazılmadı, push da yok
    const stored = parseDraftPayload(row.payload) ?? payload;
    const fresh = created || row.updatedAt.getTime() === now.getTime();
    return { row, created, pushDue: fresh && pushDue, notified, payload: stored };
  });
}

// ---------------------------------------------------------------- Yönetici: karar

export interface ReviewInput {
  id: number;
  seenVersion: number;
  decision: "approve" | "reject";
  /** Onayda zorunlu: taslağın kalemlerinden, miktar sipariş biriminde */
  lines: { ingredientId: number; qty: number }[] | null;
  supplierNote: string | null;
  /** Personele not (tutar yazılmaz); retle zorunlu */
  note: string | null;
}

async function peek(db: Tx, id: number): Promise<{ row: StaffRequestRow; payload: DraftPayloadT }> {
  const [row] = await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)).limit(1);
  const payload = row?.kind === DRAFT_KIND ? parseDraftPayload(row.payload) : null;
  if (!row || !payload) throw new UserError(REQUEST_TEXT.notFound);
  return { row, payload };
}

/**
 * Yöneticinin kararı (Onaylar › Mal siparişi). Yalnız ekranda görülen sürüm; kimse kendi taslağını onaylamaz. Onayda
 * satırlar taslağın kalemlerinden olmalı ve en az biri 0'dan büyük; kalemler hâlâ o tedarikçinin listesinde olmalı.
 * Tedarikçiye gidecek mesaj burada kurulur ("Onay no: #id"); personelin notu tedarikçiye yalnız yöneticinin onayladığı
 * "Tedarikçiye not" olarak gider, yöneticinin personele notu mesaja asla girmez. Süre onaydan yeniden başlar.
 */
export async function reviewDraftCore(
  db: DB,
  me: Actor,
  input: ReviewInput,
  deps: DraftDeps,
  now = new Date(),
): Promise<{ status: "approved" | "rejected"; row: StaffRequestRow; payload: DraftPayloadT; result: DraftResultT | null }> {
  const { row: peeked, payload } = await peek(db, input.id);
  const note = input.note?.trim() || null;
  if (input.decision === "reject" && !note) throw new UserError(DRAFT_TEXT.rejectNote);
  let result: DraftResultT | null = null;
  if (input.decision === "approve") {
    const lines = input.lines ?? [];
    if (!lines.length || !lines.some((l) => l.qty > 0)) throw new UserError(DRAFT_TEXT.noLines);
    if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length) throw new UserError("Aynı kalem iki kez yazılmış; sayfayı yenileyin");
    const own = new Map(payload.lines.map((l) => [l.ingredientId, l]));
    for (const l of lines) if (!own.has(l.ingredientId)) throw new UserError("Taslakta olmayan bir kalem onaylanamaz; sayfayı yenileyin");
    const plan = await deps.plan(payload.supplierKey);
    if (!plan) throw new UserError(DRAFT_TEXT.supplierChanged);
    const inPlan = new Map(plan.lines.map((l) => [l.ingredientId, l]));
    const approved = lines.map((l) => ({ ingredientId: l.ingredientId, qty: round2(l.qty) }));
    for (const a of approved) {
      if (a.qty <= 0) continue;
      const cur = inPlan.get(a.ingredientId);
      if (!cur) throw new UserError(`${own.get(a.ingredientId)!.name} artık bu tedarikçinin listesinde değil`);
      // Mesaj taslağın birimiyle kurulur: kalemin birimi ya da adı sonradan değiştiyse onay başka miktar söylerdi
      if (!sameOrderUnit(own.get(a.ingredientId)!, cur)) throw new UserError(`${own.get(a.ingredientId)!.name}: ${DRAFT_TEXT.unitChanged}`);
    }
    const supplierNote = input.supplierNote?.trim() || null;
    const message = orderMessage({
      signature: plan.signature,
      lines: approved.map((a) => ({ orderName: own.get(a.ingredientId)!.orderName, qty: a.qty, unit: own.get(a.ingredientId)!.unit })),
      note: supplierNote,
      ref: input.id,
    });
    result = { approvedLines: approved, supplierNote, message, edited: draftEdited(payload.lines, approved) };
  }
  return db.transaction(async (tx) => {
    // Kilit sırası taslağı açan yolla aynı (submitDraftCore: tedarikçinin kilidi, sonra istek)
    await lockSupplier(tx, payload.supplierKey);
    const locked = await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion, peeked }, now);
    if (locked.kind !== DRAFT_KIND) throw new UserError(REQUEST_TEXT.notFound);
    if (input.decision === "reject") {
      const row = await decide(tx, locked, me, "rejected", { note }, now);
      return { status: "rejected" as const, row, payload, result: null };
    }
    const decided = await decide(tx, locked, me, "approved", { note, result: result! }, now);
    const [row] = await tx.update(s.staffRequests).set({ expiresAt: draftDeadline(now) }).where(eq(s.staffRequests.id, decided.id)).returning();
    return { status: "approved" as const, row, payload, result };
  });
}

/**
 * "İşaretsizleri onayla": yalnız hiç işareti olmayan ve önerinin aynısı olan taslaklar, her biri ayrı işlemde ve aynı
 * kurallarla (ekranda görülen sürüm). Biri düşerse ötekiler sürer.
 */
export async function approveCleanCore(
  db: DB,
  me: Actor,
  items: { id: number; seenVersion: number }[],
  deps: DraftDeps,
  now = new Date(),
): Promise<{ approved: { id: number; title: string; requestedBy: number | null; requestedByName: string; supplier: string }[]; skipped: { id: number; reason: string }[] }> {
  const approved: { id: number; title: string; requestedBy: number | null; requestedByName: string; supplier: string }[] = [];
  const skipped: { id: number; reason: string }[] = [];
  for (const it of items) {
    try {
      const { row, payload } = await peek(db, it.id);
      if (!draftClean(payload, draftSubmittedAt(row, payload))) {
        skipped.push({ id: it.id, reason: "İşaretli ya da öneriden farklı" });
        continue;
      }
      const out = await reviewDraftCore(
        db,
        me,
        { id: it.id, seenVersion: it.seenVersion, decision: "approve", lines: payload.lines.map((l) => ({ ingredientId: l.ingredientId, qty: l.qty })), supplierNote: payload.supplierNote, note: null },
        deps,
        now,
      );
      approved.push({ id: it.id, title: out.row.title, requestedBy: out.row.requestedBy, requestedByName: out.row.requestedByName, supplier: payload.supplier });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      skipped.push({ id: it.id, reason: e.message });
    }
  }
  return { approved, skipped };
}

// ---------------------------------------------------------------- Personel: onaylı taslağı gönder

/** Gönderilemeyen onaylı taslağı kapatır (süresi doldu ya da başka bir yol gönderdi) ve nedenini yazar */
async function closeDraft(db: DB, id: number, status: "expired" | "superseded", note: string, now: Date): Promise<void> {
  await db
    .update(s.staffRequests)
    .set({ status, reviewNote: note, updatedAt: now })
    .where(and(eq(s.staffRequests.id, id), eq(s.staffRequests.status, "approved")));
}

export interface SendResult {
  orderId: number;
  /** WhatsApp bağlantısı (yalnız cep numarasına; tarayıcı bunu açar) */
  href: string;
  supplier: string;
  lineCount: number;
  approvedByName: string | null;
  /** Aynı sipariş yeniden açıldı (yeni kayıt yok) */
  again: boolean;
}

/**
 * Onaylı taslağı gönderir: önce kayıt (supplier_orders, istek kimliği `taslak:<id>`; ikinci kez sipariş açmaz), sonra
 * bağlantı. Satırlar onaylanan miktarlarla sunucunun güncel verisinden (orderSnapshot), mesaj onaydaki. Tedarikçinin
 * kartı değiştiyse ya da numarası artık cep değilse taslak düşer ("Tedarikçi değişti"); taslaktan sonra o tedarikçiye
 * sipariş gittiyse kapanır. Gönderen kişi 10 dakika içinde aynı siparişi yeniden açabilir (yeni kayıt açılmaz).
 */
export async function sendDraftCore(db: DB, me: Actor, input: { id: number }, deps: DraftDeps, now = new Date()): Promise<SendResult> {
  const { row, payload } = await peek(db, input.id);
  const lineCount = (r: DraftResultT) => r.approvedLines.filter((l) => l.qty > 0).length;
  if (row.status === "done" && row.resultId !== null) {
    const [order] = await db.select().from(s.supplierOrders).where(eq(s.supplierOrders.id, row.resultId)).limit(1);
    const res = parseDraftResult(row.result);
    if (order && res && order.sentBy === me.id && order.status === "open" && now.getTime() - order.sentAt.getTime() < DRAFT_UNDO_MS) {
      const link = orderLink(order.phone, order.message);
      if (link.target === "numara") return { orderId: order.id, href: link.href, supplier: payload.supplier, lineCount: lineCount(res), approvedByName: row.reviewedByName, again: true };
    }
    throw new UserError("Bu taslak zaten gönderildi");
  }
  if (row.status === "superseded") throw new UserError(DRAFT_TEXT.superseded);
  if (row.status !== "approved") throw new UserError(row.status === "expired" ? DRAFT_TEXT.expired : DRAFT_TEXT.notApproved);
  if (isDraftExpired(row, now)) {
    // Günlük işi beklemeden kapanır: tedarikçiye yeni taslak açılabilsin
    await closeDraft(db, row.id, "expired", DRAFT_TEXT.expired, now);
    throw new UserError(DRAFT_TEXT.expired);
  }
  const result = parseDraftResult(row.result);
  if (!result) throw new UserError(DRAFT_TEXT.notApproved);
  const plan = await deps.plan(payload.supplierKey);
  if (!plan || plan.supplier.cardId !== payload.supplierCardId || !isMobile(plan.supplier.phone)) {
    await closeDraft(db, row.id, "expired", DRAFT_TEXT.supplierChanged, now);
    throw new UserError(DRAFT_TEXT.supplierChanged);
  }
  if (plan.lastSentAt && Date.parse(plan.lastSentAt) > row.createdAt.getTime()) {
    await closeDraft(db, row.id, "superseded", DRAFT_TEXT.sentMeanwhile, now);
    throw new UserError(DRAFT_TEXT.sentMeanwhile);
  }
  const wanted = result.approvedLines.filter((l) => l.qty > 0);
  const snap = await deps.snapshot(payload.supplierKey, wanted);
  // Satırlar sunucunun güncel verisinden, mesaj onaydaki: kalemin sipariş birimi, içeriği ya da adı taslaktan sonra
  // değiştiyse ikisi başka miktar söylerdi (mesajda "2 koli", kayıtta 2 LT)
  const own = new Map(payload.lines.map((l) => [l.ingredientId, l]));
  if ("error" in snap || snap.lines.some((l) => !own.has(l.ingredientId) || !sameOrderUnit(own.get(l.ingredientId)!, l))) {
    await closeDraft(db, row.id, "expired", DRAFT_TEXT.linesChanged, now);
    throw new UserError(DRAFT_TEXT.linesChanged);
  }
  const phone = mobileE164(plan.supplier.phone);
  const link = orderLink(phone, result.message);
  if (link.target !== "numara") throw new UserError(DRAFT_TEXT.noPhone);
  const o = s.supplierOrders;
  const requestId = `taslak:${row.id}`;
  const orderId = await db.transaction(async (tx) => {
    await lockSupplier(tx, payload.supplierKey);
    const [cur] = await tx.select().from(s.staffRequests).where(eq(s.staffRequests.id, row.id)).for("update");
    if (!cur || cur.status !== "approved" || cur.version !== row.version) throw new UserError(REQUEST_TEXT.decided);
    const [inserted] = await tx
      .insert(o)
      .values({
        requestId,
        supplier: snap.supplier.name,
        phone,
        channel: "whatsapp",
        message: result.message,
        note: result.supplierNote,
        lines: snap.lines,
        sentAt: now,
        sentBy: me.id,
        sentByName: me.name,
        expectedOn: addDays(todayTR(now), snap.maxLead),
      })
      .onConflictDoNothing({ target: o.requestId })
      .returning({ id: o.id });
    const id = inserted?.id ?? (await tx.select({ id: o.id }).from(o).where(eq(o.requestId, requestId)).limit(1))[0]?.id;
    if (!id) throw new UserError("Sipariş kaydedilemedi; yeniden deneyin");
    await tx.update(s.staffRequests).set({ status: "done", resultId: id, updatedAt: now }).where(and(eq(s.staffRequests.id, row.id), eq(s.staffRequests.status, "approved")));
    return id;
  });
  return { orderId, href: link.href, supplier: payload.supplier, lineCount: lineCount(result), approvedByName: row.reviewedByName, again: false };
}

/**
 * Gönderimi geri alır: yalnız siparişi gönderen kişi, 10 dakika içinde, sipariş açıkken, mal gelmeden ve faturası
 * bağlanmadan. Sipariş iptal, taslak "Geri alındı" olur (son durum: yeniden sipariş için yeni taslak ve yeni onay).
 */
export async function undoDraftSendCore(db: DB, me: Actor, input: { id: number }, now = new Date()): Promise<{ supplier: string; title: string; orderId: number }> {
  const { row, payload } = await peek(db, input.id);
  if (row.status !== "done" || row.resultId === null) throw new UserError(DRAFT_TEXT.undoGone);
  const orderId = row.resultId;
  return db.transaction(async (tx) => {
    await lockSupplier(tx, payload.supplierKey);
    const [order] = await tx.select().from(s.supplierOrders).where(eq(s.supplierOrders.id, orderId)).for("update");
    if (!order) throw new UserError(DRAFT_TEXT.undoGone);
    if (order.sentBy !== me.id) throw new UserError(DRAFT_TEXT.undoNotYours);
    if (order.status !== "open" || order.receivedAt !== null || order.invoiceId !== null || now.getTime() - order.sentAt.getTime() >= DRAFT_UNDO_MS) throw new UserError(DRAFT_TEXT.undoGone);
    await tx
      .update(s.supplierOrders)
      .set({ status: "cancelled", closedAt: now, closedByName: me.name, closeNote: "Personel gönderimi geri aldı", updatedAt: now })
      .where(eq(s.supplierOrders.id, orderId));
    const [done] = await tx
      .update(s.staffRequests)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(eq(s.staffRequests.id, row.id), eq(s.staffRequests.status, "done")))
      .returning({ id: s.staffRequests.id });
    if (!done) throw new UserError(DRAFT_TEXT.undoGone);
    return { supplier: payload.supplier, title: row.title, orderId };
  });
}

/**
 * Yönetici siparişi kendisi gönderdi (recordOrderSent, aynı işlem ve kilit): tedarikçinin canlı taslağı (bekleyen ya da
 * onaylı) "Yönetici kendisi gönderdi" ile kapanır. Kapanan kimlikler döner.
 */
export async function supersedeLiveDraft(tx: Tx, supplierKey: string, me: Actor, now = new Date()): Promise<number[]> {
  const rows = await tx
    .update(s.staffRequests)
    .set({ status: "superseded", reviewNote: DRAFT_TEXT.superseded, reviewedBy: me.id, reviewedByName: me.name, reviewedAt: now, updatedAt: now })
    .where(and(eq(s.staffRequests.kind, DRAFT_KIND), eq(s.staffRequests.subject, draftSubject(supplierKey)), sql`${s.staffRequests.status} in ('pending', 'approved')`))
    .returning({ id: s.staffRequests.id });
  return rows.map((r) => r.id);
}
