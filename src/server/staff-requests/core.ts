// "server-only" yok ve sunucu eylemi değil: veritabanıyla gidip gelen test (tests/onay-kuyrugu-db.test.ts) bu dosyayı
// doğrudan çalıştırır (src/server/checklists/store.ts gibi). Her işlev veritabanını ya da işlemi parametre alır;
// oturum ve rol denetimi eylemlerde (requireUser / requireAdmin), burada yalnız kuyruğun kuralları.

/**
 * Ortak onay kuyruğunun çekirdeği (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §3.4). İstek ve karar
 * eylemleri her alanın kendi dosyasında (kasa, zayi, kapalı gün); hepsi buradan geçer:
 *
 * - createOrUpdateRequest: kişinin istekleri tek sırada (danışma kilidi); aynı istemci anahtarı var olanı döner, aynı
 *   konudaki bekleyen istek güncellenir (sürüm artar), yoksa sınırlar denetlenip yeni satır açılır.
 * - peekForReview → konu nesnesinin kilidi → lockForReview → decide: kilit sırası isteği açan yolla aynı (önce konu,
 *   sonra istek); yönetici satırı kilitler, yalnız ekranda gördüğü sürümü ve başkasının isteğini karara bağlar; karar
 *   koşullu yazılır.
 * - withdrawOwn: personel kendi bekleyen isteğini geri çeker (koşullu, onayla yarışta tek sonuç).
 * - supersede, assertNotHeld, expireStaffRequests; okuyucular (sayılar, son kararlar, kişinin istekleri) sabit sütunla,
 *   ham yük (payload) olmadan.
 */

import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, min, ne, notInArray, or, sql } from "drizzle-orm";

import { RELEASED_DAYS } from "../../lib/photo-rules";
import {
  KIND_GROUP,
  limitRefusal,
  nextBump,
  REQUEST_TEXT,
  RETIRED_REQUEST_KINDS,
  requestDayStart,
  reviewRefusal,
  STAFF_REQUEST_KINDS,
  type StaffRequestKind,
  type StaffRequestStatus,
} from "../../lib/staff-requests";
import type { DB } from "../db";
import * as s from "../db/schema";
import { UserError } from "../user-error";

/** Kaldırılan türlerin satırları kuyruklara girmez (src/lib/staff-requests.ts RETIRED_REQUEST_KINDS) */
const live = () => notInArray(s.staffRequests.kind, [...RETIRED_REQUEST_KINDS]);

/** Kapalı gün bildiriminin geri çekme sınırı (src/lib/closed-days.ts CLOSED_TEXT.withdrawOnce ile aynı) */
const CLOSED_WITHDRAW_ONCE = "Kapalı gün bildirimi günde bir kez geri çekilebilir";

/** Veritabanı ya da açık bir işlem */
export type Tx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

/** İşlemi yapan hesap (CurrentUser'ın gereken alanları) */
export interface Actor {
  id: number;
  name: string;
  role: "admin" | "staff";
}

export type StaffRequestRow = typeof s.staffRequests.$inferSelect;

/** Yeni ya da güncellenen istek. `subject`: türün konusu (gun:<D>, cikan:<id>, tedarikci:<anahtar> …) */
export interface RequestInput {
  kind: StaffRequestKind;
  subject: string;
  day?: string | null;
  /** Tutarsız, kişisel veri taşımayan tek satır ("22 Ekim kasa düzeltmesi") */
  title: string;
  payload: Record<string, unknown>;
  message?: string | null;
  clientKey?: string | null;
  /** İstek beklerken tutulan fotoğraflar (başka bir istek ve bağlama yolu alamaz) */
  photoIds?: number[];
  expiresAt?: Date | null;
}

const days = (n: number) => n * 86_400_000;

/**
 * Bekleyen bir isteğin tuttuğu fotoğraflar: süreleri başlar (`daysLeft` gün sonra silinir), bağlanmamış olanlar
 * yeniden bağlanabilir. Bağlanmış fotoğrafa dokunulmaz (onayda kayda geçmiştir).
 */
export async function releaseHeld(tx: Tx, photoIds: readonly number[], daysLeft = RELEASED_DAYS, now = new Date()): Promise<void> {
  const ids = [...new Set(photoIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return;
  await tx
    .update(s.photos)
    .set({ expiresAt: new Date(now.getTime() + days(daysLeft)) })
    .where(and(inArray(s.photos.id, ids), isNull(s.photos.linkedAt)));
}

/**
 * Fotoğraf bekleyen bir istekte tutuluyorsa (photo_ids) UserError: aynı fiş ikinci bir isteğe ya da bir kayda
 * bağlanamaz. Her bağlama yolu çağırır. `exceptRequestId`: aynı isteğin güncellemesi kendi fotoğrafını tutabilir.
 */
export async function assertNotHeld(tx: Tx, photoId: number, exceptRequestId?: number): Promise<void> {
  const [held] = await tx
    .select({ id: s.staffRequests.id })
    .from(s.staffRequests)
    .where(
      and(
        eq(s.staffRequests.status, "pending"),
        sql`${s.staffRequests.photoIds} @> array[${photoId}]::integer[]`,
        exceptRequestId === undefined ? undefined : ne(s.staffRequests.id, exceptRequestId),
      ),
    )
    .limit(1);
  if (held) throw new UserError(REQUEST_TEXT.held);
}

/**
 * Personelin isteğini açar ya da günceller (işlemin içinde çağrılır; kişinin istekleri danışma kilidiyle sıraya
 * girer). Yönetici reddedilir (doğrudan yapar). Aynı istemci anahtarı var olan bekleyen satırı olduğu gibi döner (çift
 * dokunuş, yeniden deneme); satır artık beklemede değilse (karara bağlandı, geri çekildi, kapandı) UserError: eski sayfadan
 * gelen tekrar "Onaya gönderildi" demesin, çağıran fotoğrafını yeniden tutmasın. Kişinin aynı tür ve konudaki bekleyen isteği varsa o güncellenir: sürüm artar, zil kimliği en çok
 * 10 dakikada bir yenilenir. Yoksa sınırlar (açık istek, iş günü, konu) denetlenip yeni satır açılır. Yeni tutulan
 * fotoğraf başka bir bekleyen istekte olamaz.
 */
export async function createOrUpdateRequest(tx: Tx, me: Actor, input: RequestInput, now = new Date()): Promise<{ row: StaffRequestRow; created: boolean }> {
  if (me.role === "admin") throw new UserError(REQUEST_TEXT.adminDirect);
  if ((RETIRED_REQUEST_KINDS as readonly StaffRequestKind[]).includes(input.kind)) throw new Error(`Kaldırılan istek türü: ${input.kind}`);
  const title = input.title.trim();
  if (!title) throw new Error("İsteğin başlığı boş");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`personel-istek:${me.id}`}))`);
  const r = s.staffRequests;
  if (input.clientKey) {
    const [same] = await tx.select().from(r).where(eq(r.clientKey, input.clientKey)).limit(1);
    if (same) {
      if (same.requestedBy !== me.id) throw new UserError(REQUEST_TEXT.keyTaken);
      if (same.status !== "pending") throw new UserError(REQUEST_TEXT.keyClosed);
      return { row: same, created: false };
    }
  }
  const photoIds = [...new Set(input.photoIds ?? [])];
  const [pending] = await tx
    .select()
    .from(r)
    .where(and(eq(r.kind, input.kind), eq(r.subject, input.subject), eq(r.requestedBy, me.id), eq(r.status, "pending")))
    .for("update");
  for (const id of photoIds) if (!pending?.photoIds.includes(id)) await assertNotHeld(tx, id, pending?.id);
  const fields = {
    day: input.day ?? null,
    title,
    payload: input.payload,
    message: input.message ?? null,
    photoIds,
    expiresAt: input.expiresAt ?? null,
    requestedByName: me.name,
    updatedAt: now,
  };
  if (pending) {
    const [row] = await tx
      .update(r)
      .set({ ...fields, version: sql`${r.version} + 1`, bumpedAt: nextBump(pending.bumpedAt, now), ...(input.clientKey ? { clientKey: input.clientKey } : {}) })
      .where(eq(r.id, pending.id))
      .returning();
    return { row, created: false };
  }
  const since = requestDayStart(now);
  const group = STAFF_REQUEST_KINDS.filter((k) => KIND_GROUP[k] === KIND_GROUP[input.kind]);
  const mine = eq(r.requestedBy, me.id);
  const [[open], [today], [subjectToday]] = await Promise.all([
    tx
      .select({ n: count() })
      .from(r)
      .where(and(mine, eq(r.status, "pending"), inArray(r.kind, group))),
    tx
      .select({ n: count() })
      .from(r)
      .where(and(mine, gte(r.createdAt, since))),
    tx
      .select({ n: count() })
      .from(r)
      .where(and(mine, eq(r.subject, input.subject), gte(r.createdAt, since))),
  ]);
  const refusal = limitRefusal(input.kind, { open: open?.n ?? 0, today: today?.n ?? 0, subjectToday: subjectToday?.n ?? 0 });
  if (refusal) throw new UserError(refusal);
  const [row] = await tx
    .insert(r)
    .values({
      ...fields,
      kind: input.kind,
      subject: input.subject,
      clientKey: input.clientKey ?? null,
      requestedBy: me.id,
      bumpedAt: now,
      createdAt: now,
    })
    .returning();
  return { row, created: true };
}

/**
 * Kararın ilk adımı, kilitsiz: isteğin türü ve yükü, yani hangi konu nesnesinin kilitleneceği. Kilit sırası her yolda
 * aynıdır: önce konu nesnesi (kasadan çıkan satırı, kasa raporu, günün danışma kilidi, zayi kaydı, tedarikçi), sonra
 * istek satırı. İsteği açan ve güncelleyen yollar konu nesnesini kilitleyip createOrUpdateRequest'e öyle geçer; doğrudan
 * yazımlar (satırı silmek, günü kapalı işaretlemek) konu nesnesini kilitleyip bekleyen istekleri öyle kapatır. Karar da
 * önce bunu okur, sonra konu nesnesini kilitler, sonra lockForReview (`peeked` ile). Ters sıra (önce istek, sonra konu)
 * personelin güncellemesiyle aynı anda verilen onayı kilitlenmeye (40P01, "İşlem tamamlanamadı") düşürürdü
 * (tests/helpers/lock-race.ts). Okunan hâl yalnız kilit seçmek içindir; denetimlerin hepsi lockForReview'da, kilit altında.
 */
export async function peekForReview(tx: Tx, me: Actor, id: number): Promise<StaffRequestRow> {
  if (me.role !== "admin") throw new UserError(REQUEST_TEXT.adminOnly);
  const [row] = await tx.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)).limit(1);
  if (!row) throw new UserError(REQUEST_TEXT.notFound);
  return row;
}

/**
 * Yöneticinin kararından önce: satır kilitlenir (FOR UPDATE), karar reddi denetlenir (bekliyor, başkasının, süresi
 * dolmamış, ekranda görülen sürüm). Karar aynı işlemde decide ile yazılır. `peeked` (peekForReview'un okuduğu hâl)
 * verildiyse kilitli satır onunla aynı sürümde ve aynı konuda olmalı: konu nesnesi o hâle göre kilitlendi.
 */
export async function lockForReview(tx: Tx, me: Actor, o: { id: number; seenVersion: number; peeked?: StaffRequestRow }, now = new Date()): Promise<StaffRequestRow> {
  if (me.role !== "admin") throw new UserError(REQUEST_TEXT.adminOnly);
  const [row] = await tx.select().from(s.staffRequests).where(eq(s.staffRequests.id, o.id)).for("update");
  if (!row) throw new UserError(REQUEST_TEXT.notFound);
  const refusal = reviewRefusal(row, me, o.seenVersion, now);
  if (refusal) throw new UserError(refusal);
  if (o.peeked && (row.version !== o.peeked.version || row.kind !== o.peeked.kind || row.subject !== o.peeked.subject)) throw new UserError(REQUEST_TEXT.changed);
  return row;
}

/** Karara bağlanırken tutulan fotoğraflar kalır mı: onayda kayda bağlanır; öteki sonuçlarda varsayılan 7 gün sonra silinir */
const KEEPS_PHOTOS: readonly StaffRequestStatus[] = ["approved", "done"];

/**
 * Kararı yazar (lockForReview'dan sonra, aynı işlemde): durum, not, karar veren, ürettiği satır ve sonucu. Koşullu:
 * satır arada başka bir yoldan karara bağlandıysa UserError. Onay dışı sonuçta tutulan fotoğraflar bırakılır
 * (`releaseDays`; null: dokunulmaz).
 */
export async function decide(
  tx: Tx,
  row: StaffRequestRow,
  me: Actor,
  status: Exclude<StaffRequestStatus, "pending" | "withdrawn">,
  o: { note?: string | null; resultId?: number | null; result?: Record<string, unknown> | null; releaseDays?: number | null } = {},
  now = new Date(),
): Promise<StaffRequestRow> {
  const [out] = await tx
    .update(s.staffRequests)
    .set({
      status,
      reviewNote: o.note ?? null,
      reviewedBy: me.id,
      reviewedByName: me.name,
      reviewedAt: now,
      updatedAt: now,
      ...(o.resultId !== undefined ? { resultId: o.resultId } : {}),
      ...(o.result !== undefined ? { result: o.result } : {}),
    })
    .where(and(eq(s.staffRequests.id, row.id), eq(s.staffRequests.status, row.status), eq(s.staffRequests.version, row.version)))
    .returning();
  if (!out) throw new UserError(REQUEST_TEXT.decided);
  const releaseDays = o.releaseDays === undefined ? (KEEPS_PHOTOS.includes(status) ? null : RELEASED_DAYS) : o.releaseDays;
  if (releaseDays !== null) await releaseHeld(tx, row.photoIds, releaseDays, now);
  return out;
}

/**
 * Personel kendi bekleyen isteğini geri çeker: koşullu UPDATE (bekliyor ve kendisinin), aynı anda verilen onayla
 * yarışta yalnız biri kazanır. Tutulan fotoğraflar bırakılır (7 gün).
 */
export async function withdrawOwn(db: Tx, me: Actor, id: number, now = new Date()): Promise<StaffRequestRow> {
  return db.transaction(async (tx) => {
    // Kapalı gün bildirimi kişi başına iş gününde bir kez geri çekilir (bildir, geri çek, yeniden bildir döngüsü olmasın)
    const [cur] = await tx.select({ kind: s.staffRequests.kind }).from(s.staffRequests).where(eq(s.staffRequests.id, id)).limit(1);
    if (cur?.kind === "kapali-gun") {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`personel-istek:${me.id}`}))`);
      const [done] = await tx
        .select({ n: count() })
        .from(s.staffRequests)
        .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.requestedBy, me.id), eq(s.staffRequests.status, "withdrawn"), gte(s.staffRequests.updatedAt, requestDayStart(now))));
      if ((done?.n ?? 0) >= 1) throw new UserError(CLOSED_WITHDRAW_ONCE);
    }
    const [row] = await tx
      .update(s.staffRequests)
      .set({ status: "withdrawn", updatedAt: now })
      .where(and(eq(s.staffRequests.id, id), eq(s.staffRequests.status, "pending"), eq(s.staffRequests.requestedBy, me.id)))
      .returning();
    if (!row) throw new UserError(REQUEST_TEXT.notPending);
    await releaseHeld(tx, row.photoIds, RELEASED_DAYS, now);
    return row;
  });
}

/**
 * Başka bir yol aynı işi yaptı (rapor başka bir istekle düzeltildi, yönetici günü kendisi girdi, kayıt silindi): eşleşen
 * istekler "superseded" olur, not personele görünür; tutulan fotoğrafları bırakılır (`releaseDays` gün sonra silinir;
 * geç kasa raporunun Z fotoğrafı kanıttır, 30 gün). Varsayılan yalnız bekleyenler (`statuses` ile başkaları da).
 * Kapanan kimlikler döner.
 */
export async function supersede(
  tx: Tx,
  f: { kinds: readonly StaffRequestKind[]; subject?: string; subjects?: readonly string[]; day?: string; exceptId?: number; statuses?: readonly StaffRequestStatus[] },
  note: string,
  now = new Date(),
  releaseDays = RELEASED_DAYS,
): Promise<number[]> {
  if (!f.kinds.length) return [];
  const rows = await tx
    .update(s.staffRequests)
    .set({ status: "superseded", reviewNote: note, reviewedAt: now, updatedAt: now })
    .where(
      and(
        inArray(s.staffRequests.kind, [...f.kinds]),
        inArray(s.staffRequests.status, [...(f.statuses ?? ["pending"])]),
        f.subject === undefined ? undefined : eq(s.staffRequests.subject, f.subject),
        f.subjects === undefined ? undefined : inArray(s.staffRequests.subject, [...f.subjects]),
        f.day === undefined ? undefined : eq(s.staffRequests.day, f.day),
        f.exceptId === undefined ? undefined : ne(s.staffRequests.id, f.exceptId),
      ),
    )
    .returning({ id: s.staffRequests.id, photoIds: s.staffRequests.photoIds });
  await releaseHeld(
    tx,
    rows.flatMap((r) => r.photoIds),
    releaseDays,
    now,
  );
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

/**
 * Sabah işinin adımı ("Personel istekleri"): süresi geçen bekleyen istekler "expired" olur, tutulan fotoğrafları
 * bırakılır. Onaylanmış istekler kayda geçmiştir (kasadan çıkan, geç rapor …): süreleri dolsa da onaylı kalır.
 * Kaldırılan türün (mal siparişi taslağı, 26 Eki 2026) bekleyen ya da onaylanmış, gönderilmemiş satırları süresine
 * bakılmadan "expired" olur: kimse onları göremez ve karara bağlayamaz.
 */
export async function expireStaffRequests(db: Tx, now = new Date()): Promise<{ expired: number }> {
  return db.transaction(async (tx) => {
    const r = s.staffRequests;
    const rows = await tx
      .update(r)
      .set({ status: "expired", updatedAt: now })
      .where(
        or(
          and(lte(r.expiresAt, now), eq(r.status, "pending")),
          and(inArray(r.kind, [...RETIRED_REQUEST_KINDS]), inArray(r.status, ["pending", "approved"])),
        ),
      )
      .returning({ id: r.id, photoIds: r.photoIds });
    await releaseHeld(
      tx,
      rows.flatMap((x) => x.photoIds),
      RELEASED_DAYS,
      now,
    );
    return { expired: rows.length };
  });
}

// ---------------------------------------------------------------- Okuyucular (sabit sütunlar; ham yük yok)

/** Türüne göre bekleyen istekler ve en eskisinin anı (Bugün, zil, sabah e-postası); kaldırılan türler sayılmaz */
export async function countPendingByKind(db: Tx, now = new Date()): Promise<{ kind: StaffRequestKind; count: number; oldestAt: Date }[]> {
  const rows = await db
    .select({ kind: s.staffRequests.kind, n: count(), oldest: min(s.staffRequests.createdAt) })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.status, "pending"), or(isNull(s.staffRequests.expiresAt), gt(s.staffRequests.expiresAt, now)), live()))
    .groupBy(s.staffRequests.kind);
  return rows.flatMap((r) => (r.oldest ? [{ kind: r.kind, count: r.n, oldestAt: r.oldest }] : []));
}

/** Bekleyen istekler, eskiden yeniye: başlık, tür, isteyen, an ve sürüm (yük yok; sabah e-postası ve zil; kaldırılan türler yok) */
export async function pendingRequests(db: Tx, o: { kinds?: readonly StaffRequestKind[]; now?: Date } = {}) {
  const now = o.now ?? new Date();
  return db
    .select({
      id: s.staffRequests.id,
      kind: s.staffRequests.kind,
      title: s.staffRequests.title,
      day: s.staffRequests.day,
      requestedByName: s.staffRequests.requestedByName,
      createdAt: s.staffRequests.createdAt,
      bumpedAt: s.staffRequests.bumpedAt,
      version: s.staffRequests.version,
    })
    .from(s.staffRequests)
    .where(
      and(
        eq(s.staffRequests.status, "pending"),
        or(isNull(s.staffRequests.expiresAt), gt(s.staffRequests.expiresAt, now)),
        o.kinds ? inArray(s.staffRequests.kind, [...o.kinds]) : undefined,
        live(),
      ),
    )
    .orderBy(asc(s.staffRequests.createdAt), asc(s.staffRequests.id));
}

/** Son `days` günde karara bağlananlar ve kapananlar, yeniden eskiye (yönetici, Onaylar › Son kararlar; kaldırılan türler yok) */
export async function recentDecisions(db: Tx, daysBack = 30, now = new Date()) {
  return db
    .select({
      id: s.staffRequests.id,
      kind: s.staffRequests.kind,
      title: s.staffRequests.title,
      status: s.staffRequests.status,
      requestedByName: s.staffRequests.requestedByName,
      reviewedByName: s.staffRequests.reviewedByName,
      reviewNote: s.staffRequests.reviewNote,
      message: s.staffRequests.message,
      createdAt: s.staffRequests.createdAt,
      updatedAt: s.staffRequests.updatedAt,
      reviewedAt: s.staffRequests.reviewedAt,
    })
    .from(s.staffRequests)
    .where(and(ne(s.staffRequests.status, "pending"), gt(s.staffRequests.updatedAt, new Date(now.getTime() - days(daysBack))), live()))
    .orderBy(desc(s.staffRequests.updatedAt), desc(s.staffRequests.id))
    .limit(40);
}

/**
 * Kişinin kendi istekleri (İsteklerim, zil): bekleyenler ve son `days` günde sonuçlananlar, yeniden eskiye. Ham yük
 * yok: türün alanı gerekiyorsa kendi yükleyicisi beyaz listeyle okur.
 */
export async function ownRequests(db: Tx, userId: number, kinds: readonly StaffRequestKind[], daysBack = 7, now = new Date()) {
  if (!kinds.length) return [];
  return db
    .select({
      id: s.staffRequests.id,
      kind: s.staffRequests.kind,
      subject: s.staffRequests.subject,
      day: s.staffRequests.day,
      title: s.staffRequests.title,
      status: s.staffRequests.status,
      version: s.staffRequests.version,
      message: s.staffRequests.message,
      reviewNote: s.staffRequests.reviewNote,
      reviewedByName: s.staffRequests.reviewedByName,
      reviewedAt: s.staffRequests.reviewedAt,
      resultId: s.staffRequests.resultId,
      expiresAt: s.staffRequests.expiresAt,
      createdAt: s.staffRequests.createdAt,
      updatedAt: s.staffRequests.updatedAt,
    })
    .from(s.staffRequests)
    .where(
      and(
        eq(s.staffRequests.requestedBy, userId),
        inArray(s.staffRequests.kind, [...kinds]),
        or(eq(s.staffRequests.status, "pending"), gt(s.staffRequests.updatedAt, new Date(now.getTime() - days(daysBack)))),
      ),
    )
    .orderBy(desc(s.staffRequests.updatedAt), desc(s.staffRequests.id))
    .limit(50);
}
