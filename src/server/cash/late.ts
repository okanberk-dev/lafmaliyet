import "server-only";

import { and, asc, count, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";

import { carryCheck, carryDiffText, computeCash, openingNeedsNote, staffLateDay, type CashReportFields } from "@/lib/cash-report";
import { CASH_REQUEST_TEXT, LatePayload, lateFields, lateTitle, olderFirstText, type LatePayloadT } from "@/lib/cash-requests";
import { DELETED_REPORT_DAYS, MAX_OKC_PHOTOS, MAX_REPORT_PHOTOS, OKC_PHOTOS_TEXT, RELEASED_DAYS } from "@/lib/photo-rules";
import { REQUEST_TEXT } from "@/lib/staff-requests";
import { schema as s, type DB } from "@/server/db";
import { isClosedDay } from "@/server/closed-days";
import { createOrUpdateRequest, decide, supersede, type StaffRequestRow } from "@/server/staff-requests/core";
import { getPhoto, holdPhoto, linkable, releasePhoto } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";

import { chainNeighbours } from "./late-chain";
import { lockCashReport, lockLateDay, writeCashReport, type CashActor, type CashReportRow, type CashTx, type WriteResult } from "./report-store";

/*
 * Geç kasa raporu (docs/KASA-RAPORU.md › Geç rapor; plan docs/planlar/personel-yetki.md §2.6): personel dünden eski, son
 * 14 takvim gününe düşen, raporu hiç girilmemiş bir günü Z fotoğrafı ve Z numarasıyla girer. Rapor ayrı tabloda
 * (staff_requests, tür `kasa-gec`) onay bekler; onaya kadar hiçbir hesaba, e-postaya ya da devir zincirine girmez.
 * Fotoğraflar istek beklerken tutulur (holdPhoto: bağlanmaz, silinmez). Yönetici onaylayınca rapor isteyenin adıyla
 * yazılır (writeCashReport, aynı denetimler); "Düzeltip onayla"da isteyenin hâli 1. sürüm, yöneticinin değerleri 2.
 * sürüm olur. Sunucu eylemi değil: src/server/actions/cash-requests.ts oturumu ve rolü denetleyip çağırır.
 */

export interface LateInput {
  /** Raporun alanları (Z no zorunlu); sayan isteyendir */
  fields: CashReportFields;
  /** Neden geç giriliyor (3–300) */
  reason: string;
  /** Formun açıldığı andaki kendi bekleyen isteğinin sürümü (0: yeni istek) */
  requestVersion: number;
  /** İstekte tutulacak fotoğraflar: yeni yüklenenler ve önceki isteğin tuttukları */
  photoIds: number[];
  /** Teslim edileni alan: etkin bir kullanıcı ya da banka (teslim 0'dan büyükse zorunlu) */
  handedTo: { kind: "user"; id: number } | { kind: "banka" } | null;
  clientKey: string | null;
}

/**
 * Geç raporu onaya gönderir ya da kişinin aynı gün için bekleyen isteğini günceller (sürüm artar). Denetimler: personel,
 * pencere (staffLateDay), teslim ≤ sayılan ve teslim alan, günün kilidi altında: o gün rapor yok, ilk rapordan sonra,
 * kapalı işaretli değil, aynı gün için iki kapanmış istek yok, ekranda görülen sürüm, zincirin önceki halkasına göre
 * açılış notu; fotoğraflar kişinin kendisinin, Z ya da POS, bağlanmamış, başka bir istekte değil (önceki isteğinin
 * tuttukları serbest), en az bir Z, en çok 6. Tutulanlar beklerken silinmez; düşürülenler 7 gün sonra silinir.
 */
export async function proposeLateReport(db: DB, me: CashActor, input: LateInput, now = new Date()): Promise<{ row: StaffRequestRow; created: boolean; cashDiff: number }> {
  if (me.role === "admin") throw new UserError(CASH_REQUEST_TEXT.adminDirect);
  const { fields } = input;
  const date = fields.date;
  if (!staffLateDay(date, now)) throw new UserError(CASH_REQUEST_TEXT.lateWindow);
  if (!fields.zNo?.trim()) throw new UserError("Z no gerekli");
  if (fields.handedOver > fields.countedCash) throw new UserError("Teslim edilen, sayılan nakitten fazla olamaz");
  if (fields.handedOver > 0 && !input.handedTo) throw new UserError(CASH_REQUEST_TEXT.lateHandedTo);
  const ids = [...new Set(input.photoIds)];
  if (!ids.length) throw new UserError(CASH_REQUEST_TEXT.lateZPhoto);
  if (ids.length > MAX_REPORT_PHOTOS) throw new UserError(`Bir rapora en çok ${MAX_REPORT_PHOTOS} fotoğraf eklenir`);
  return db.transaction(async (tx) => {
    await lockLateDay(tx, date);
    const subject = `gun:${date}`;
    const r = s.staffRequests;
    // Çift dokunuş ya da yeniden deneme: aynı istemci anahtarı var olan bekleyen isteği döner (sürüm denetiminden önce);
    // istek bu arada karara bağlandıysa ya da kapandıysa eski sayfadan gelen tekrar reddedilir (createOrUpdateRequest gibi)
    if (input.clientKey) {
      const [same] = await tx.select().from(r).where(eq(r.clientKey, input.clientKey)).limit(1);
      if (same && same.requestedBy === me.id && same.kind === "kasa-gec" && same.subject === subject) {
        if (same.status !== "pending") throw new UserError(REQUEST_TEXT.keyClosed);
        return { row: same, created: false, cashDiff: computeCash(fields).cashDiff };
      }
    }
    const [[report], [first]] = await Promise.all([
      tx.select({ id: s.cashReports.id }).from(s.cashReports).where(eq(s.cashReports.date, date)).limit(1),
      tx.select({ date: s.cashReports.date }).from(s.cashReports).orderBy(asc(s.cashReports.date)).limit(1),
    ]);
    if (report) throw new UserError(CASH_REQUEST_TEXT.lateReported);
    if (!first || first.date >= date) throw new UserError(CASH_REQUEST_TEXT.lateBeforeFirst);
    if (await isClosedDay(date, tx)) throw new UserError(CASH_REQUEST_TEXT.lateClosed);
    const mine = and(eq(r.kind, "kasa-gec"), eq(r.subject, subject), eq(r.requestedBy, me.id));
    const [[pending], [{ n: closed }]] = await Promise.all([
      tx.select().from(r).where(and(mine, eq(r.status, "pending"))).limit(1),
      tx
        .select({ n: count() })
        .from(r)
        .where(and(mine, inArray(r.status, ["rejected", "withdrawn"]))),
    ]);
    // Ekranda görülen sürüm: başka bir sekmede güncellendiyse ya da bu arada karara bağlandıysa üzerine yazılmaz
    if ((pending?.version ?? 0) !== input.requestVersion) throw new UserError(CASH_REQUEST_TEXT.lateStale);
    // Aynı gün için iki ret ya da geri çekmeden sonra yeni istek açılmaz (bekleyeni güncellemek serbest)
    if (!pending && closed >= 2) throw new UserError(CASH_REQUEST_TEXT.lateTwice);
    // Açılış zincirin önceki halkasının (rapor ya da bekleyen geç rapor) devriyle tutmuyorsa nedeni nota
    const { prev } = await chainNeighbours(tx, date, { prefer: me.id });
    const check = carryCheck(date, fields.openingCash, prev ? { date: prev.date, amount: prev.carry } : null);
    if (check && openingNeedsNote({ check, openingCash: fields.openingCash, prevOpening: null, note: fields.note })) {
      throw new UserError(`Açılış önceki günün devrinden farklı (${carryDiffText(check)}): nedenini nota yazın`);
    }
    // Fotoğraflar: önceki isteğin tuttukları serbest; yenileri kişinin kendisinin, Z ya da POS, bağlanmamış
    const kept = new Set(pending?.photoIds ?? []);
    const photos: LatePayloadT["photos"] = [];
    for (const id of ids) {
      const p = await getPhoto(id, tx);
      const ok = p && (p.kind === "kasa-z" || p.kind === "kasa-pos" || p.kind === "kasa-okc") && p.createdBy === me.id && (kept.has(id) ? p.linkedAt === null : linkable(p, now));
      if (!ok) throw new UserError(CASH_REQUEST_TEXT.latePhoto);
      photos.push({ id, kind: p.kind as "kasa-z" | "kasa-pos" | "kasa-okc" });
    }
    if (!photos.some((p) => p.kind === "kasa-z")) throw new UserError(CASH_REQUEST_TEXT.lateZPhoto);
    if (photos.filter((p) => p.kind === "kasa-okc").length > MAX_OKC_PHOTOS) throw new UserError(OKC_PHOTOS_TEXT);
    // Teslim alan: etkin bir kullanıcı (adı sunucudan) ya da banka
    let handedTo: LatePayloadT["handedTo"] = null;
    if (fields.handedOver > 0 && input.handedTo?.kind === "user") {
      const [u] = await tx.select({ id: s.users.id, name: s.users.name, active: s.users.active }).from(s.users).where(eq(s.users.id, input.handedTo.id)).limit(1);
      if (!u?.active) throw new UserError("Teslim alan kişi bulunamadı; listeden seçin");
      handedTo = { kind: "user", id: u.id, name: u.name };
    } else if (fields.handedOver > 0) handedTo = { kind: "banka" };
    const cashDiff = computeCash(fields).cashDiff;
    const payload = LatePayload.parse({ ...fields, discounts: fields.discounts ?? null, zNo: (fields.zNo ?? "").trim(), handedTo, photos, cashDiff });
    const out = await createOrUpdateRequest(
      tx,
      me,
      { kind: "kasa-gec", subject, day: date, title: lateTitle(date), payload, message: input.reason.trim(), clientKey: input.clientKey, photoIds: ids },
      now,
    );
    // İstek beklerken fotoğraflar silinmez; önceki isteğin artık tutmadıkları 7 gün sonra silinir
    for (const id of out.row.photoIds) await holdPhoto(tx, id);
    for (const id of kept) if (!out.row.photoIds.includes(id)) await releasePhoto(id, RELEASED_DAYS, tx);
    return { ...out, cashDiff };
  });
}

/** Yöneticinin geç rapor kararının girdisi (src/server/cash/requests.ts ReviewInput'un bu türe düşen kısmı) */
export interface LateReviewInput {
  decision: "approve" | "reject" | "close";
  note: string | null;
  /** "Düzeltip onayla": yöneticinin değerleri (gün hariç); verilmezse isteyenin değerleri */
  fields?: Omit<CashReportFields, "date"> | null;
  /** Teslim varsa yönetici teslimi aldığını ya da bankada gördüğünü işaretler */
  handoverSeen?: boolean;
}

export type LateReviewOutcome =
  | { kind: "kasa-gec"; status: "approved"; request: StaffRequestRow; payload: LatePayloadT; report: CashReportRow; corrected: boolean; skippedPhotos: number; prevCarry: number | null; write: WriteResult }
  | { kind: "kasa-gec"; status: "rejected"; request: StaffRequestRow };

/**
 * Yöneticinin geç rapor kararı (lockForReview'dan sonra, aynı işlemde). Ret: istek reddedilir, fotoğraflar 30 gün
 * kalır. Onay: günün kilidi; o gün rapor varsa ret ("isteği reddedin"); aynı aralıkta (önceki rapordan bu yana) daha
 * eski bir bekleyen geç rapor varsa ret ("Önce … karara bağlayın"); teslim varsa işaret zorunlu. Rapor isteyenin adıyla
 * 1. sürüm olarak yazılır (sayan isteyen; devir ve açılış notu denetimleri işlem içinde yeniden), "Düzeltip onayla"da
 * yöneticinin değerleri 2. sürüm olur. Tutulan fotoğraflar bağlanır (artık bağlanamayanlar atlanır ve sayılır). Aynı
 * günün öteki bekleyen geç raporları kapanır.
 */
export async function reviewLate(tx: CashTx, me: CashActor, row: StaffRequestRow, input: LateReviewInput, now: Date): Promise<LateReviewOutcome> {
  const payload = LatePayload.parse(row.payload);
  if (input.decision === "reject") {
    return { kind: "kasa-gec", status: "rejected", request: await decide(tx, row, me, "rejected", { note: input.note, releaseDays: DELETED_REPORT_DAYS }, now) };
  }
  if (input.decision === "close") throw new UserError("Geç rapor kapatılmaz; onaylayın ya da reddedin");
  const date = payload.date;
  await lockLateDay(tx, date);
  if (await lockCashReport(tx, date)) throw new UserError(CASH_REQUEST_TEXT.lateExists);
  // Aynı aralıkta daha eski bir bekleyen geç rapor: önce o (zincirin önceki halkası hep kayıtlı rapor olsun)
  const [before] = await tx.select({ date: s.cashReports.date }).from(s.cashReports).where(lt(s.cashReports.date, date)).orderBy(desc(s.cashReports.date)).limit(1);
  const [older] = await tx
    .select({ day: s.staffRequests.day })
    .from(s.staffRequests)
    .where(
      and(
        eq(s.staffRequests.kind, "kasa-gec"),
        eq(s.staffRequests.status, "pending"),
        ne(s.staffRequests.id, row.id),
        lt(s.staffRequests.day, date),
        before ? gt(s.staffRequests.day, before.date) : undefined,
      ),
    )
    .orderBy(asc(s.staffRequests.day))
    .limit(1);
  if (older?.day) throw new UserError(olderFirstText(older.day));
  const requested = lateFields(payload);
  const finalFields: CashReportFields = input.fields ? { ...input.fields, discounts: input.fields.discounts ?? null, date } : requested;
  if (finalFields.handedOver > finalFields.countedCash) throw new UserError("Teslim edilen, sayılan nakitten fazla olamaz");
  if ((requested.handedOver > 0 || finalFields.handedOver > 0) && !input.handoverSeen) throw new UserError(CASH_REQUEST_TEXT.lateHandover);
  // Fotoğraflar: hâlâ bağlanabilenler bağlanır (bu istek tuttuğu için başka bir yere bağlanmamış olmalı)
  const link: number[] = [];
  for (const p of payload.photos) {
    const photo = await getPhoto(p.id, tx);
    if (photo && linkable(photo, now)) link.push(p.id);
  }
  const submittedBy = { id: row.requestedBy, name: row.requestedByName };
  const counter = row.requestedBy ?? me.id;
  // Düzeltip onaylarken isteyenin hâli olduğu gibi 1. sürüm olur (açılış notu denetimi yöneticinin 2. sürümünde)
  const first = await writeCashReport(tx, me, requested, { revision: 0, countedBy: counter, photos: link, submittedBy, prev: null, heldBy: row.id, keepCounter: true, skipOpeningNote: Boolean(input.fields) });
  const write = input.fields ? await writeCashReport(tx, me, finalFields, { revision: first.row.revision, countedBy: counter, prev: first.row, keepCounter: true }) : first;
  await supersede(tx, { kinds: ["kasa-gec"], subject: row.subject, exceptId: row.id }, "Bu günün raporu başka bir istekle girildi", now, DELETED_REPORT_DAYS);
  const skippedPhotos = payload.photos.length - link.length;
  const request = await decide(tx, row, me, "approved", { note: input.note, resultId: write.row.id, result: { revision: write.row.revision, corrected: Boolean(input.fields), skippedPhotos } }, now);
  return { kind: "kasa-gec", status: "approved", request, payload, report: write.row, corrected: Boolean(input.fields), skippedPhotos, prevCarry: write.prevCarry, write };
}
