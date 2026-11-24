import "server-only";

import { and, count, eq } from "drizzle-orm";

import { staffCanReport } from "@/lib/cash-report";
import { okcHasFigures } from "@/lib/okc-z";
import {
  CASH_OUT_REQUEST_DAYS,
  CASH_OUT_REQUEST_TEXT,
  cashOutChanged,
  CashOutRequestPayload,
  cashOutRequestTitle,
  lineChanges,
  photoKindRefusal,
  PhotoRemovalPayload,
  photoRemovalTitle,
  type CashOutBeforeT,
  type CashOutLineT,
  type CashOutOp,
  type CashOutRequestPayloadT,
  type PhotoRemovalPayloadT,
  type RemovablePhotoKind,
} from "@/lib/cash-out-requests";
import { staffCategory, staffToExpenses, type CashOutSnapshot } from "@/lib/cash-outs";
import { LAFPOS_CASH_OUT_TEXT, lafposCashOutChange } from "@/lib/lafpos/cash-moves";
import { photoDiffs, photoDiffText, savedFields, suspiciousDiffs } from "@/lib/photo-read/kasa";
import { DELETED_REPORT_DAYS } from "@/lib/photo-rules";
import { REQUEST_TEXT } from "@/lib/staff-requests";
import { cashOutPayment } from "@/server/cari/kasa";
import { okcServerColumns } from "@/server/cash/report-store";
import { photoReadingOf } from "@/server/data/cash-photos";
import { kasaEvidence } from "@/server/data/lafpos-day";
import { currentTillBranch, staffBranchRefusal } from "@/server/branch-scope";
import { schema as s, type DB } from "@/server/db";
import { createOrUpdateRequest, decide, lockForReview, peekForReview, supersede, type StaffRequestRow } from "@/server/staff-requests/core";
import { getPhoto, holdPhoto, linkable, releasePhoto } from "@/server/storage/photos";
import { UserError } from "@/server/user-error";

import { staffCashOutGate } from "./guard";
import { attachReceiptPhoto, lockCashOut, removeCashOut, writeCashOut, type CashOutActor, type CashOutRow, type CashOutTx } from "./write";

/** Onayda: satır istekten sonra yöneticinin bir tedarikçi ödemesine bağlandı */
const CASH_OUT_LINKED_REVIEW = "Bu satır istekten sonra bir tedarikçi ödemesine bağlandı; isteği reddedin, değişikliği Tedarikçiler'den yapın.";

/*
 * Kasadan çıkan istekleri ve fotoğraf kaldırma (docs/KASA-RAPORU.md › Kasadan çıkan: kapanmış gün, yöneticinin satırı;
 * plan docs/planlar/personel-yetki.md §2.7). Personel kapanmış ya da eski güne (D−7'ye kadar) kasadan çıkan eklenmesini,
 * kilitli dünün ya da yöneticinin kategorisindeki satırın düzeltilmesini ve silinmesini, rapora bağlı yanlış Z / POS
 * fotoğrafının kaldırılmasını ister; fotoğrafsız satıra fiş ekler (onaysız). İstek onaya kadar hiçbir yere yazmaz; onay
 * yöneticinin kendi yazım yolundan (write.ts, aynı denetimler) geçer, satırı açan isteyendir. Sunucu eylemi değil:
 * src/server/actions/cash-out-requests.ts oturumu ve rolü denetleyip çağırır (tests/kasa-istek-db.test.ts).
 */

const DAY_MS = 86_400_000;

export interface CashOutChangeInput {
  op: CashOutOp;
  /** Eklemede gün (düzeltme ve silmede satırın günü) */
  date: string | null;
  cashOutId: number | null;
  /** Eklemede yeni satır, düzeltmede satırın önerilen hâli */
  line: CashOutLineT | null;
  /** Yöneticiye not (en çok 200) */
  message: string | null;
  clientKey: string | null;
}

/** Satırın istendiği andaki hâli (bağlı harcama kaydıyla) */
async function beforeOf(tx: CashOutTx, row: CashOutRow): Promise<CashOutBeforeT> {
  const [expense] = await tx
    .select({ id: s.expenseEntries.id, categoryId: s.expenseEntries.categoryId, updatedAt: s.expenseEntries.updatedAt })
    .from(s.expenseEntries)
    .where(eq(s.expenseEntries.cashOutId, row.id))
    .limit(1);
  return {
    kind: row.kind,
    amount: row.amount,
    store: row.store,
    description: row.description,
    receiptDate: row.receiptDate,
    receiptNo: row.receiptNo,
    vat: row.vat,
    docType: row.docType,
    categoryId: expense?.categoryId ?? null,
    photoId: row.photoId,
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdByName,
    expense: expense ? { id: expense.id, categoryId: expense.categoryId, updatedAt: expense.updatedAt.toISOString() } : null,
  };
}

/** Satırın biçimi: teslimde belge, fiş alanları ve fotoğraf yok */
function cleanLine(l: CashOutLineT): CashOutLineT {
  if (l.kind === "harcama") return l;
  return { ...l, receiptDate: null, receiptNo: null, vat: null, docType: "yok", photoId: null, categoryId: null };
}

/**
 * Personelin kasadan çıkan isteği: kapanmış ya da eski güne ekleme, kilitli dünün ya da yöneticinin kategorisindeki
 * satırın düzeltilmesi ve silinmesi. Kapı (guard.ts) "request" demeli: doğrudan yazılabilen değişiklik istek olmaz.
 * Eklemede kategori personelin kategorisi (yönetici onayda seçer), fiş kişinin kendi bağlanmamış fotoğrafı (istek
 * beklerken tutulur); düzeltmede kategori ve fotoğraf değişmez, öneri bir şey değiştirmeli. Satır kilitlenir: aynı anda
 * verilen onayla sıraya girer. Kişinin aynı satır için bekleyen isteği güncellenir (sürüm artar).
 */
export async function proposeCashOutChange(db: DB, me: CashOutActor, input: CashOutChangeInput, now = new Date()): Promise<{ row: StaffRequestRow; created: boolean; payload: CashOutRequestPayloadT }> {
  if (me.role === "admin") throw new UserError(CASH_OUT_REQUEST_TEXT.adminDirect);
  const message = input.message?.trim() || null;
  if (message && message.length > 200) throw new UserError("Not en çok 200 karakter");
  return db.transaction(async (tx) => {
    let payload: CashOutRequestPayloadT;
    let subject: string;
    let photoIds: number[] = [];
    if (input.op === "ekle") {
      if (!input.date || !input.line) throw new UserError("Satırı yazın");
      if (!input.clientKey) throw new UserError("Sayfayı yenileyip yeniden deneyin");
      if ((await staffCashOutGate(tx, me, { op: "ekle", date: input.date }, now)) === "direct") throw new UserError(CASH_OUT_REQUEST_TEXT.direct);
      const line = cleanLine(input.line);
      if (line.categoryId) {
        const [cat] = await tx.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, line.categoryId)).limit(1);
        if (!cat || !staffCategory(cat)) throw new UserError(CASH_OUT_REQUEST_TEXT.category);
      }
      if (line.photoId) {
        const p = await getPhoto(line.photoId, tx);
        if (!p || p.kind !== "fis" || !linkable(p, now) || p.createdBy !== me.id) throw new UserError(CASH_OUT_REQUEST_TEXT.photo);
        photoIds = [line.photoId];
      }
      if (line.docType === "fis" && !line.photoId) line.docType = "yok";
      subject = `cikan-yeni:${input.clientKey}`;
      // Şube isteği AÇAN personelin formunun kasası (eylem formTillBranch ile kapsamı ona çevirir): onay anında yönetici
      // başka şubeye bakıyor olabilir (docs/SUBE.md)
      payload = CashOutRequestPayload.parse({ op: "ekle", day: input.date, cashOutId: null, line, before: null, branchId: await currentTillBranch() });
    } else {
      if (!input.cashOutId) throw new UserError(CASH_OUT_REQUEST_TEXT.rowGone);
      const row = await lockCashOut(tx, input.cashOutId);
      if (!row) throw new UserError(CASH_OUT_REQUEST_TEXT.rowGone);
      // LafPOS satırı (Faz 3): silme ve tutarı, türü değiştiren düzeltme istenmez (yönetici de yapamaz; LafPOS'tan gelir)
      if (row.lafposId && input.op === "sil") throw new UserError(LAFPOS_CASH_OUT_TEXT.delete);
      const lafposLock = input.op === "duzelt" && input.line ? lafposCashOutChange(row, { kind: input.line.kind, amount: input.line.amount, date: row.date }) : null;
      if (lafposLock) throw new UserError(lafposLock);
      if ((await staffCashOutGate(tx, me, { op: input.op, row }, now)) === "direct") throw new UserError(CASH_OUT_REQUEST_TEXT.direct);
      const before = await beforeOf(tx, row);
      let line: CashOutLineT | null = null;
      if (input.op === "duzelt") {
        if (!input.line) throw new UserError("Satırı yazın");
        // Kategori değiştirme isteği açılmaz; fotoğraf bu yoldan değişmez (fotoğrafsız satıra fiş: onaysız yol)
        if (input.line.categoryId !== null && input.line.categoryId !== before.categoryId) throw new UserError(CASH_OUT_REQUEST_TEXT.categoryChange);
        line = cleanLine({ ...input.line, categoryId: before.categoryId, photoId: row.photoId });
        if (line.kind === "teslim" && row.photoId) line = { ...line, kind: "harcama" };
        if (!lineChanges(before, line).length) throw new UserError(CASH_OUT_REQUEST_TEXT.noChange);
      }
      subject = `cikan:${row.id}`;
      payload = CashOutRequestPayload.parse({ op: input.op, day: row.date, cashOutId: row.id, line, before });
    }
    const out = await createOrUpdateRequest(
      tx,
      me,
      {
        kind: "kasa-cikan",
        subject,
        day: payload.day,
        title: cashOutRequestTitle(payload.op, payload.day),
        payload,
        message,
        clientKey: input.clientKey,
        photoIds,
        expiresAt: new Date(now.getTime() + CASH_OUT_REQUEST_DAYS * DAY_MS),
      },
      now,
    );
    // Yalnız bekleyen isteğin gerçekten tuttuğu fotoğraf tutulur (aynı anahtarla tekrar var olan satırı döner)
    for (const id of out.row.photoIds) await holdPhoto(tx, id);
    return { ...out, payload };
  });
}

/**
 * Fotoğrafsız alışveriş satırına fiş fotoğrafı (onaysız; personelin gördüğü günde, kilitli dün dahil): yalnız kanıt
 * eklenir, tutar, tür ve kategori değişmez. Satır kilitlenir.
 */
export async function attachCashOutReceiptCore(db: DB, me: CashOutActor, input: { cashOutId: number; photoId: number }, now = new Date()): Promise<CashOutRow> {
  return db.transaction(async (tx) => {
    const row = await lockCashOut(tx, input.cashOutId);
    if (!row) throw new UserError(CASH_OUT_REQUEST_TEXT.rowGone);
    if (row.kind !== "harcama" || row.photoId !== null) throw new UserError(CASH_OUT_REQUEST_TEXT.receiptOnly);
    await staffCashOutGate(tx, me, { op: "fis", row }, now);
    await attachReceiptPhoto(tx, me, row, input.photoId);
    return row;
  });
}

/** Rapora bağlı fotoğraf: bağın raporu, günü, şubesi ve türü (bağlı değilse null) */
async function linkOf(tx: CashOutTx, photoId: number) {
  const [link] = await tx
    .select({ reportId: s.cashReportPhotos.reportId, kind: s.cashReportPhotos.kind, date: s.cashReports.date, branchId: s.cashReports.branchId })
    .from(s.cashReportPhotos)
    .innerJoin(s.cashReports, eq(s.cashReports.id, s.cashReportPhotos.reportId))
    .where(eq(s.cashReportPhotos.photoId, photoId))
    .limit(1);
  return link ?? null;
}

/** Raporun satırı (FOR UPDATE): fotoğraf kaldırma isteği ve onayı bununla sıraya girer; yoksa null */
async function lockReport(tx: CashOutTx, reportId: number) {
  const [report] = await tx.select().from(s.cashReports).where(eq(s.cashReports.id, reportId)).for("update").limit(1);
  return report ?? null;
}

/**
 * Fotoğrafı rapordan çıkarmak olur mu (null: evet): raporun tek Z fotoğrafı, yazarkasa bölümü yazılmışken tek Banka POS
 * Z (yazarkasa) fotoğrafı (photoKindRefusal) ve fotoğraftan farklı yazılan (net okunmuş) alanı olan fotoğraf
 * kaldırılmaz. İstek ve onay aynı denetimi yapar. Okuma farkları da döner (işlem geçmişine).
 */
async function removalCheck(tx: CashOutTx, photoId: number, kind: RemovablePhotoKind, reportId: number) {
  const report = await lockReport(tx, reportId);
  if (!report) return { refusal: CASH_OUT_REQUEST_TEXT.photoNotLinked, diffs: [] as string[], report: null };
  // Bağ kilit altında yeniden: önceki okuma kilitsizdi, arada onaylanan kaldırma bağı silmiş olabilir (istek açan yol)
  const [linked] = await tx
    .select({ photoId: s.cashReportPhotos.photoId })
    .from(s.cashReportPhotos)
    .where(and(eq(s.cashReportPhotos.reportId, reportId), eq(s.cashReportPhotos.photoId, photoId), eq(s.cashReportPhotos.kind, kind)))
    .limit(1);
  if (!linked) return { refusal: CASH_OUT_REQUEST_TEXT.photoNotLinked, diffs: [] as string[], report };
  if (kind === "kasa-z" || kind === "kasa-okc") {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(s.cashReportPhotos)
      .where(and(eq(s.cashReportPhotos.reportId, reportId), eq(s.cashReportPhotos.kind, kind)));
    const refusal = photoKindRefusal(kind, { zCount: n, okcCount: n, okcFigures: okcHasFigures(report), evidence: await kasaEvidence(tx, report.date, report.branchId) });
    if (refusal) return { refusal, diffs: [], report };
  }
  const reading = await photoReadingOf(tx, photoId, kind, report.date);
  const saved = savedFields(report);
  const diffs = reading ? photoDiffs([reading], saved).map((d) => photoDiffText(d)) : [];
  if (reading && suspiciousDiffs([reading], saved).length) return { refusal: CASH_OUT_REQUEST_TEXT.photoDiffs, diffs, report };
  return { refusal: null, diffs, report };
}

/**
 * Personel rapora bağlı yanlış Z / POS fotoğrafının kaldırılmasını ister (bugün ve dün). Raporun tek Z fotoğrafında ya
 * da okuma farkı olan fotoğrafta istek açılmaz: fotoğraf kanıttır.
 */
export async function proposePhotoRemoval(
  db: DB,
  me: CashOutActor,
  input: { photoId: number; message: string | null; clientKey: string | null },
  now = new Date(),
): Promise<{ row: StaffRequestRow; created: boolean; payload: PhotoRemovalPayloadT }> {
  if (me.role === "admin") throw new UserError(CASH_OUT_REQUEST_TEXT.adminDirect);
  return db.transaction(async (tx) => {
    const link = await linkOf(tx, input.photoId);
    if (!link || (link.kind !== "kasa-z" && link.kind !== "kasa-pos" && link.kind !== "kasa-okc")) throw new UserError(CASH_OUT_REQUEST_TEXT.photoNotLinked);
    // Fotoğraf kimliğiyle gelir: şubesine kilitli personel başka şubenin raporundaki fotoğrafı istemez (denetim #14)
    const otherBranch = await staffBranchRefusal(me, link.branchId);
    if (otherBranch) throw new UserError(otherBranch);
    if (!staffCanReport(link.date, now)) throw new UserError(CASH_OUT_REQUEST_TEXT.photoDay);
    const check = await removalCheck(tx, input.photoId, link.kind, link.reportId);
    if (check.refusal) throw new UserError(check.refusal);
    const payload = PhotoRemovalPayload.parse({ photoId: input.photoId, photoKind: link.kind, reportId: link.reportId, day: link.date });
    const out = await createOrUpdateRequest(
      tx,
      me,
      {
        kind: "foto-kaldir",
        subject: `foto:${input.photoId}`,
        day: link.date,
        title: photoRemovalTitle(link.kind, link.date),
        payload,
        message: input.message?.trim() || null,
        clientKey: input.clientKey,
      },
      now,
    );
    return { ...out, payload };
  });
}

export interface CashOutReviewInput {
  id: number;
  seenVersion: number;
  decision: "approve" | "reject";
  note: string | null;
  /** Ekleme ve düzeltmede yöneticinin "Aylık harcamalar'a da yaz" anahtarı (verilmezse kural) */
  toExpenses?: boolean | null;
  /** Ekleme ve düzeltmede yöneticinin seçtiği kategori (verilmezse önerilen ya da satırın kategorisi) */
  categoryId?: number | null;
  /** Satır istekten sonra değiştiyse yine de uygula */
  force?: boolean;
}

export type CashOutReviewOutcome =
  | { status: "rejected"; request: StaffRequestRow; payload: CashOutRequestPayloadT }
  | { status: "approved"; op: "ekle" | "duzelt"; request: StaffRequestRow; payload: CashOutRequestPayloadT; cashOutId: number; expenseId: number | null; line: CashOutLineT; date: string }
  | { status: "approved"; op: "sil"; request: StaffRequestRow; payload: CashOutRequestPayloadT; snapshot: CashOutSnapshot };

/**
 * Yöneticinin kararı (tek işlemde): istek kilitlenir ve denetlenir (bekliyor, başkasının, süresi dolmamış, ekranda
 * görülen sürüm). Ekleme onayı satırı isteyenin adıyla yazar (yöneticinin yazım yolu: kategori, harcama kaydı, fiş);
 * düzeltme ve silme onayında satır kilitlenir, istekten sonra değiştiyse yalnız "Yine de uygula" ile (`force`). Fişli
 * işaretlenmiş satırın fotoğrafı olmalı. Aynı satırın öteki bekleyen istekleri kapanır. Ret fişi 7 gün tutar. Onay
 * kasa raporunu asla değiştirmez.
 */
export async function reviewCashOutRequestCore(db: DB, me: CashOutActor, input: CashOutReviewInput, now = new Date()): Promise<CashOutReviewOutcome> {
  if (me.role !== "admin") throw new UserError(REQUEST_TEXT.adminOnly);
  return db.transaction(async (tx) => {
    // Kilit sırası isteği açan yolla aynı (proposeCashOutChange: satır, sonra istek): düzeltme ve silme onayında önce satır
    const peeked = await peekForReview(tx, me, input.id);
    if (peeked.kind !== "kasa-cikan") throw new UserError("Bu istek kasadan çıkan isteği değil");
    const target = CashOutRequestPayload.parse(peeked.payload).cashOutId;
    if (input.decision === "approve" && target !== null) await lockCashOut(tx, target);
    const row = await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion, peeked }, now);
    const payload = CashOutRequestPayload.parse(row.payload);
    if (input.decision === "reject") return { status: "rejected" as const, payload, request: await decide(tx, row, me, "rejected", { note: input.note }, now) };
    const author = { id: row.requestedBy, name: row.requestedByName };
    if (payload.op === "ekle") {
      const line = payload.line!;
      if (line.docType === "fis" && !line.photoId) throw new UserError(CASH_OUT_REQUEST_TEXT.receiptMissing);
      const toExpenses = line.kind === "harcama" && (input.toExpenses ?? staffToExpenses(line.kind, line.docType));
      const out = await writeCashOut(
        tx,
        me,
        { id: null, date: payload.day, ...line, categoryId: toExpenses ? (input.categoryId ?? line.categoryId) : null, toExpenses },
        // Satır isteği açan personelin şubesine iner, yöneticinin o anki seçimine değil
        { author, heldBy: row.id, prev: null, branchId: payload.branchId ?? undefined },
      );
      const request = await decide(tx, row, me, "approved", { note: input.note, resultId: out.id }, now);
      return { status: "approved" as const, op: "ekle" as const, request, payload, cashOutId: out.id, expenseId: out.expenseId, line, date: payload.day };
    }
    const cur = await lockCashOut(tx, payload.cashOutId!);
    if (!cur) throw new UserError("Satır silinmiş; isteği reddedin");
    // İstekten sonra bir tedarikçi ödemesine bağlanan satır buradan değişmez (docs/TEDARIKCILER.md "Hesap hareketleri")
    if (await cashOutPayment(tx, cur.id)) throw new UserError(CASH_OUT_LINKED_REVIEW);
    if (!input.force) {
      const now2 = await beforeOf(tx, cur);
      if (cashOutChanged(payload.before!, { row: now2, expense: now2.expense })) throw new UserError(CASH_OUT_REQUEST_TEXT.changed);
    }
    if (payload.op === "sil") {
      const snapshot = await removeCashOut(tx, cur, { exceptRequestId: row.id });
      const request = await decide(tx, row, me, "approved", { note: input.note, resultId: cur.id }, now);
      return { status: "approved" as const, op: "sil" as const, request, payload, snapshot };
    }
    const line = payload.line!;
    if (line.docType === "fis" && !cur.photoId) throw new UserError(CASH_OUT_REQUEST_TEXT.receiptMissing);
    const [expense] = await tx.select({ categoryId: s.expenseEntries.categoryId }).from(s.expenseEntries).where(eq(s.expenseEntries.cashOutId, cur.id)).limit(1);
    const toExpenses = line.kind === "harcama" && (input.toExpenses ?? Boolean(expense));
    const out = await writeCashOut(
      tx,
      me,
      { id: cur.id, date: cur.date, ...line, photoId: cur.photoId, categoryId: toExpenses ? (input.categoryId ?? expense?.categoryId ?? line.categoryId) : null, toExpenses },
      { prev: cur, heldBy: row.id },
    );
    await supersede(tx, { kinds: ["kasa-cikan"], subject: row.subject, exceptId: row.id }, "Satır başka bir istekle düzeltildi", now);
    const request = await decide(tx, row, me, "approved", { note: input.note, resultId: cur.id }, now);
    return { status: "approved" as const, op: "duzelt" as const, request, payload, cashOutId: out.id, expenseId: out.expenseId, line: { ...line, photoId: cur.photoId }, date: cur.date };
  });
}

/**
 * Yöneticinin fotoğraf kaldırma kararı: onayda fotoğraf hâlâ rapora bağlı olmalı, raporun tek Z fotoğrafı ya da okuma
 * farkı olan fotoğraf değilse rapordan çıkar (bağ silinir) ve 30 gün saklanır; okumanın kendisi (ai_calls) kalır.
 * Okuma farkları dönüşte (işlem geçmişine, bağ silinmeden önceki hâliyle).
 */
export async function reviewPhotoRemovalCore(
  db: DB,
  me: CashOutActor,
  input: { id: number; seenVersion: number; decision: "approve" | "reject"; note: string | null },
  now = new Date(),
): Promise<{ status: "approved" | "rejected"; request: StaffRequestRow; payload: PhotoRemovalPayloadT; diffs: string[] }> {
  if (me.role !== "admin") throw new UserError(REQUEST_TEXT.adminOnly);
  return db.transaction(async (tx) => {
    // Kilit sırası isteği açan yolla aynı (proposePhotoRemoval: rapor, sonra istek): onayda önce rapor
    const peeked = await peekForReview(tx, me, input.id);
    if (peeked.kind !== "foto-kaldir") throw new UserError("Bu istek fotoğraf kaldırma isteği değil");
    if (input.decision === "approve") await lockReport(tx, PhotoRemovalPayload.parse(peeked.payload).reportId);
    const row = await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion, peeked }, now);
    const payload = PhotoRemovalPayload.parse(row.payload);
    if (input.decision === "reject") return { status: "rejected" as const, payload, diffs: [], request: await decide(tx, row, me, "rejected", { note: input.note, releaseDays: null }, now) };
    const link = await linkOf(tx, payload.photoId);
    if (!link || link.reportId !== payload.reportId) throw new UserError(CASH_OUT_REQUEST_TEXT.photoNotLinked);
    const check = await removalCheck(tx, payload.photoId, payload.photoKind, payload.reportId);
    if (check.refusal) throw new UserError(check.refusal);
    await tx.delete(s.cashReportPhotos).where(and(eq(s.cashReportPhotos.reportId, payload.reportId), eq(s.cashReportPhotos.photoId, payload.photoId)));
    await releasePhoto(payload.photoId, DELETED_REPORT_DAYS, tx);
    // Yazarkasa Z fotoğrafı çıkınca sunucu sütunları kalan fotoğrafların okumasından yeniden (docs/planlar/okc-z.md §6.1)
    if (payload.photoKind === "kasa-okc" && check.report) {
      const server = await okcServerColumns(tx, check.report);
      await tx.update(s.cashReports).set(server).where(eq(s.cashReports.id, payload.reportId));
    }
    const request = await decide(tx, row, me, "approved", { note: input.note, resultId: payload.reportId, releaseDays: null }, now);
    return { status: "approved" as const, request, payload, diffs: check.diffs };
  });
}
