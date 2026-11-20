import "server-only";

import { and, count, eq } from "drizzle-orm";

import { carryCheck, computeCash, openingNeedsNote, revisionChanges, revisionDataOf, staffCanReport, staffCashGate, type CashReportFields, type FieldChange } from "@/lib/cash-report";
import {
  CASH_REQUEST_TEXT,
  cashDaySubject,
  CorrectionPayload,
  correctionTitle,
  DeletePayload,
  deleteTitle,
  LatePayload,
  lateBranchOf,
  mergeProposal,
  proposalChanges,
  type CorrectionPayloadT,
  type DeletePayloadT,
  type ProposedFields,
} from "@/lib/cash-requests";
import { REQUEST_TEXT } from "@/lib/staff-requests";
import { currentTillBranch } from "@/server/branch-scope";
import { schema as s, type DB } from "@/server/db";
import { createOrUpdateRequest, decide, lockForReview, peekForReview, supersede, type StaffRequestRow } from "@/server/staff-requests/core";
import { UserError } from "@/server/user-error";

import { reviewLate, type LateReviewOutcome } from "./late";
import {
  carryBefore,
  hasLaterReport,
  lockCashReport,
  lockLateDay,
  ownDeletePending,
  removeCashReport,
  resolveCounter,
  writeCashReport,
  type CashActor,
  type CashReportRow,
  type CashTx,
  withOkcOf,
} from "./report-store";

/*
 * Personelin kasa raporu istekleri ve yöneticinin kararı (docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği; plan
 * docs/planlar/personel-yetki.md §2.3): düzeltme önerisi (kasa-duzeltme), silme isteği (kasa-silme). Rapor onaya kadar
 * değişmez; onaylanan düzeltme yöneticinin kendi düzeltmesi gibi yeni bir sürüm olur (writeCashReport, aynı
 * denetimlerle). Sunucu eylemi değil: src/server/actions/cash-requests.ts oturumu ve rolü denetleyip çağırır; işlevler
 * veritabanını parametre alır (tests/kasa-istek-db.test.ts).
 */

export interface CorrectionInput {
  date: string;
  /** Önerinin dayandığı sürüm (ekranda görülen) */
  baseRevision: number;
  fields: Omit<CashReportFields, "date">;
  /** Önerilen sayan; boşsa raporun sayanı */
  countedBy: number | null;
  /** Neden düzeltiliyor (5–500) */
  message: string;
  clientKey: string | null;
}

/**
 * Düzeltme önerisi açar ya da kişinin aynı gün için bekleyen önerisini günceller (sürüm artar). Kapı "request" olmalı
 * (doğrudan kaydedilebilen değişiklik istek olmaz), öneri raporu değiştirmeli, normal kayıttaki denetimler geçmeli
 * (teslim ≤ sayılan, sayan, açılış devirle tutmuyorsa neden: not boşsa neden nota kopyalanır). Rapor satırı
 * kilitlenir: aynı anda verilen onayla sıraya girer.
 */
export async function proposeCashCorrection(db: DB, me: CashActor, input: CorrectionInput, now = new Date()): Promise<{ row: StaffRequestRow; created: boolean; changes: FieldChange[] }> {
  if (me.role === "admin") throw new UserError(CASH_REQUEST_TEXT.adminDirect);
  const date = input.date;
  const data: CashReportFields = { ...input.fields, date };
  if (data.handedOver > data.countedCash) throw new UserError("Teslim edilen, sayılan nakitten fazla olamaz");
  if (!staffCanReport(date, now)) throw new UserError(CASH_REQUEST_TEXT.closed);
  const branchId = await currentTillBranch();
  return db.transaction(async (tx) => {
    const report = await lockCashReport(tx, date, branchId);
    if (!report) throw new UserError(CASH_REQUEST_TEXT.noReport);
    if (report.revision !== input.baseRevision) throw new UserError(CASH_REQUEST_TEXT.stale);
    if (await ownDeletePending(tx, me.id, date, branchId)) throw new UserError(CASH_REQUEST_TEXT.deletePending);
    const laterReport = await hasLaterReport(tx, date, branchId);
    const kept = report.countedBy ?? report.submittedBy;
    const counter = await resolveCounter(tx, input.countedBy ?? kept ?? me.id, kept);
    const base = revisionDataOf(report);
    // Açılış devirle tutmuyor ve not boşsa önerinin nedeni nota da yazılır (iki kez yazılmaz)
    const check = carryCheck(date, data.openingCash, await carryBefore(tx, date, branchId));
    const note = check && openingNeedsNote({ check, openingCash: data.openingCash, prevOpening: report.openingCash, note: data.note }) ? input.message.trim() : data.note;
    // Gönderilmeyen yazarkasa alanı (yazarkasa bölümü olmayan sayfa) raporun kayıtlı değeridir: önerilmemiş sayılır
    const { date: _date, ...sent } = withOkcOf(data, report);
    void _date;
    const proposed: ProposedFields = { ...sent, note, discounts: input.fields.discounts ?? null, countedBy: counter.id, countedByName: counter.name };
    const changes = proposalChanges(base, proposed);
    if (!changes.length) throw new UserError(CASH_REQUEST_TEXT.noChange);
    const gate = staffCashGate({ date, now, hasReport: true, laterReport, changes });
    if (gate === "closed") throw new UserError(CASH_REQUEST_TEXT.closed);
    if (gate === "direct") throw new UserError(CASH_REQUEST_TEXT.direct);
    const payload: CorrectionPayloadT = CorrectionPayload.parse({
      date,
      reportId: report.id,
      baseRevision: report.revision,
      base,
      baseCountedBy: kept,
      proposed,
      gate: laterReport ? "kilitli" : "gec",
    });
    const out = await createOrUpdateRequest(
      tx,
      me,
      { kind: "kasa-duzeltme", subject: cashDaySubject(date, branchId), day: date, title: correctionTitle(date), payload, message: input.message.trim(), clientKey: input.clientKey },
      now,
    );
    return { ...out, changes };
  });
}

/** Silme isteği açar (ya da kişinin bekleyen silme isteğini günceller): personelin açabildiği rapor (bugün ve dün) */
export async function proposeCashDelete(
  db: DB,
  me: CashActor,
  input: { date: string; baseRevision: number; message: string; clientKey: string | null },
  now = new Date(),
): Promise<{ row: StaffRequestRow; created: boolean }> {
  if (me.role === "admin") throw new UserError(CASH_REQUEST_TEXT.adminDirect);
  if (!staffCanReport(input.date, now)) throw new UserError(CASH_REQUEST_TEXT.closed);
  const branchId = await currentTillBranch();
  return db.transaction(async (tx) => {
    const report = await lockCashReport(tx, input.date, branchId);
    if (!report) throw new UserError(CASH_REQUEST_TEXT.noReport);
    if (report.revision !== input.baseRevision) throw new UserError(CASH_REQUEST_TEXT.stale);
    const [{ n }] = await tx.select({ n: count() }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, report.id));
    const payload: DeletePayloadT = DeletePayload.parse({ date: input.date, reportId: report.id, baseRevision: report.revision, snapshot: revisionDataOf(report), photos: n });
    return createOrUpdateRequest(
      tx,
      me,
      { kind: "kasa-silme", subject: cashDaySubject(input.date, branchId), day: input.date, title: deleteTitle(input.date), payload, message: input.message.trim(), clientKey: input.clientKey },
      now,
    );
  });
}

export interface ReviewInput {
  id: number;
  /** Kartta görülen isteğin sürümü */
  seenVersion: number;
  /** Kartta görülen raporun sürümü (düzeltme ve silme) */
  seenRevision: number | null;
  decision: "approve" | "reject" | "close";
  note: string | null;
  /** Geç rapor, "Düzeltip onayla": yöneticinin değerleri (gün hariç) */
  fields?: Omit<CashReportFields, "date"> | null;
  /** Geç rapor: teslim varsa yönetici teslimi aldığını ya da bankada gördüğünü işaretler */
  handoverSeen?: boolean;
}

export type ReviewOutcome =
  | {
      kind: "kasa-duzeltme";
      status: "approved";
      request: StaffRequestRow;
      payload: CorrectionPayloadT;
      report: CashReportRow;
      changes: FieldChange[];
      prevCarry: number | null;
      superseded: number[];
    }
  | {
      kind: "kasa-silme";
      status: "approved";
      request: StaffRequestRow;
      payload: DeletePayloadT;
      removed: Awaited<ReturnType<typeof removeCashReport>>;
    }
  | { kind: "kasa-duzeltme" | "kasa-silme"; status: "rejected" | "superseded"; request: StaffRequestRow }
  | LateReviewOutcome;

/** Raporun şimdiki hâli ve önerinin onunla birleşimi (yöneticinin kartı da aynı hesabı gösterir) */
/** Birleştirmenin okuduğu rapor sütunları (personelin "Öneriyi düzenle" okuyucusu da yalnız bunları seçer) */
export type MergeBase = Pick<CashReportRow, keyof CashReportFields | "cashDiff" | "countedBy" | "countedByName" | "submittedBy" | "submittedByName" | "revision">;

export function mergedOf(report: MergeBase, p: CorrectionPayloadT) {
  const current = { data: revisionDataOf(report), countedBy: report.countedBy ?? report.submittedBy };
  const merged = mergeProposal(current, { data: p.base, countedBy: p.baseCountedBy }, p.proposed);
  const mergedData = { ...merged.fields, cashDiff: computeCash(merged.fields).cashDiff, countedByName: merged.countedByName };
  return { current, merged, changes: revisionChanges(current.data, mergedData) };
}

async function reviewCorrection(tx: CashTx, me: CashActor, row: StaffRequestRow, input: ReviewInput, now: Date): Promise<ReviewOutcome> {
  const payload = CorrectionPayload.parse(row.payload);
  if (input.decision === "reject") return { kind: "kasa-duzeltme", status: "rejected", request: await decide(tx, row, me, "rejected", { note: input.note }, now) };
  // Önerinin raporu: yükteki kimlik. Yöneticinin o anki şube seçimiyle (gün + seçili şube) aranmaz; aransaydı "Tümü"den
  // onaylanan Marina önerisi Tuzla'nın raporuna yazılırdı
  const report = await lockReportOf(tx, payload);
  if (!report) throw new UserError(CASH_REQUEST_TEXT.noReport);
  if (input.seenRevision !== report.revision) throw new UserError(CASH_REQUEST_TEXT.reviewStale);
  const { merged, changes } = mergedOf(report, payload);
  if (input.decision === "close") {
    if (changes.length) throw new UserError("Öneri raporu hâlâ değiştiriyor; onaylayın ya da reddedin");
    return { kind: "kasa-duzeltme", status: "superseded", request: await decide(tx, row, me, "superseded", { note: input.note ?? "Rapor zaten bu hâlde" }, now) };
  }
  if (!changes.length) throw new UserError(CASH_REQUEST_TEXT.nothingToApply);
  // Yöneticinin kendi düzeltmesi gibi yeni sürüm: devir, açılış notu, teslim ve sayan denetimleri yeniden
  const out = await writeCashReport(tx, me, merged.fields, { revision: report.revision, countedBy: merged.countedBy, prev: report, branchId: report.branchId });
  const superseded = await supersede(tx, { kinds: ["kasa-duzeltme"], subject: row.subject, exceptId: row.id }, "Rapor başka bir istekle düzeltildi", now);
  const request = await decide(tx, row, me, "approved", { note: input.note, resultId: out.row.id, result: { revision: out.row.revision } }, now);
  return { kind: "kasa-duzeltme", status: "approved", request, payload, report: out.row, changes: out.changes, prevCarry: out.prevCarry, superseded };
}

async function reviewDelete(tx: CashTx, me: CashActor, row: StaffRequestRow, input: ReviewInput, now: Date): Promise<ReviewOutcome> {
  const payload = DeletePayload.parse(row.payload);
  if (input.decision === "reject") return { kind: "kasa-silme", status: "rejected", request: await decide(tx, row, me, "rejected", { note: input.note }, now) };
  if (input.decision === "close") throw new UserError("Silme isteği kapatılmaz; onaylayın ya da reddedin");
  const [report] = await tx.select().from(s.cashReports).where(and(eq(s.cashReports.id, payload.reportId))).for("update").limit(1);
  if (!report) throw new UserError(CASH_REQUEST_TEXT.noReport);
  if (input.seenRevision !== report.revision) throw new UserError(CASH_REQUEST_TEXT.reviewStale);
  const removed = await removeCashReport(tx, report.id, { exceptRequestId: row.id });
  const request = await decide(tx, row, me, "approved", { note: input.note, resultId: report.id }, now);
  return { kind: "kasa-silme", status: "approved", request, payload, removed };
}

/** Düzeltme önerisinin raporu (satır kilitli): yükteki rapor kimliği, raporun günü önerinin günü olmalı */
async function lockReportOf(tx: CashTx, p: Pick<CorrectionPayloadT, "reportId" | "date">) {
  const [report] = await tx.select().from(s.cashReports).where(eq(s.cashReports.id, p.reportId)).for("update").limit(1);
  return report && report.date === p.date ? report : null;
}

/**
 * Kararın konu nesnesi, istek satırından önce: düzeltmede önerinin raporu, silmede istenen rapor, geç raporda isteğin
 * şubesinin günü. Hiçbiri yöneticinin şube seçimine bakmaz (isteğin kendi kasası)
 */
async function lockSubject(tx: CashTx, row: StaffRequestRow): Promise<void> {
  if (row.kind === "kasa-duzeltme") await lockReportOf(tx, CorrectionPayload.parse(row.payload));
  else if (row.kind === "kasa-silme") await tx.select({ id: s.cashReports.id }).from(s.cashReports).where(eq(s.cashReports.id, DeletePayload.parse(row.payload).reportId)).for("update");
  else if (row.kind === "kasa-gec") {
    const p = LatePayload.parse(row.payload);
    await lockLateDay(tx, p.date, lateBranchOf(p));
  }
}

/**
 * Yöneticinin kararı (tek işlemde): istek kilitlenir ve denetlenir (bekliyor, başkasının, ekranda görülen sürüm), rapor
 * kilitlenir ve ekranda görülen sürümü olmalı. Düzeltme onayı öneriyi raporun şimdiki hâline uygular (yeni sürüm),
 * aynı günün öteki bekleyen düzeltmeleri kapanır; silme onayı raporu siler, aynı günün öteki istekleri kapanır. Ret
 * yalnız durum ve not yazar. "Kapat": öneri raporu artık değiştirmiyorsa. Geç rapor (kasa-gec) src/server/cash/late.ts.
 */
export async function reviewCashRequestCore(db: DB, me: CashActor, input: ReviewInput, now = new Date()): Promise<ReviewOutcome> {
  if (me.role !== "admin") throw new UserError(REQUEST_TEXT.adminOnly);
  return db.transaction(async (tx) => {
    // Kilit sırası isteği açan yolla aynı: önce raporun satırı (düzeltme, silme) ya da günün kilidi (geç rapor), sonra istek
    const peeked = await peekForReview(tx, me, input.id);
    if (input.decision !== "reject") await lockSubject(tx, peeked);
    const row = await lockForReview(tx, me, { id: input.id, seenVersion: input.seenVersion, peeked }, now);
    if (row.kind === "kasa-duzeltme") return reviewCorrection(tx, me, row, input, now);
    if (row.kind === "kasa-silme") return reviewDelete(tx, me, row, input, now);
    if (row.kind === "kasa-gec") return reviewLate(tx, me, row, input, now);
    throw new UserError("Bu istek kasa raporu isteği değil");
  });
}
