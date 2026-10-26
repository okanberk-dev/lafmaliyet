import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";

import { businessDate, carryCheck, CHANGE_LABELS, computeCash, diffText, revisionChanges, type CashRevisionData, type FieldChange } from "@/lib/cash-report";
import { cashOutsTotal } from "@/lib/cash-outs";
import {
  correctionBell,
  CorrectionPayload,
  deleteBell,
  DeletePayload,
  fieldValue,
  proposalChanges,
  proposalSummary,
  resultLines,
  type CashRequestKind,
  type CorrectionPayloadT,
  type ProposedFields,
} from "@/lib/cash-requests";
import { money } from "@/lib/format";
import { dayMonthTR, monthTitleTR } from "@/lib/reminders";
import { waitedText, type StaffRequestKind, type StaffRequestStatus } from "@/lib/staff-requests";
import { mergedOf, type MergeBase } from "@/server/cash/requests";
import { closedDayCards, type ClosedDayCard } from "@/server/closed-days";
import { lateBellRows, lateCards, type LateCard } from "@/server/data/cash-late";
import { cashOutCards, type CashOutCard, type PhotoRemovalCard } from "@/server/data/cash-out-requests";
import { cashOutsOn } from "@/server/data/cash-outs";
import { nextReportAfter } from "@/server/data/cash-reports";
import { getDb, schema as s } from "@/server/db";
import { ownRequests } from "@/server/staff-requests/core";

/*
 * Kasa isteklerinin okuyucuları (docs/KASA-RAPORU.md › Sonradan düzeltme ve silme isteği; docs/ONAYLAR.md). Personelin
 * okuyucuları sabit sütunla ve beyaz listeyle: kişinin kendi isteğinde kendi yazdığı rapor alanları, başkasınınkinde
 * yalnız tür, ad ve an (tests/personel-sizinti-kasa.test.ts). Yöneticinin kartları (loadCashRequestQueue) raporun
 * şimdiki hâliyle karşılaştırma, sonraki raporun açılışı, fişler ve ay bilgisini taşır; yalnız Onaylar'da.
 */

/** Personelin kasa sayfasındaki istek türleri (bu gün için bekleyenler) */
const DAY_KINDS = ["kasa-duzeltme", "kasa-silme"] as const;
/** İsteklerim kartındaki türler */
export const MY_CASH_KINDS: readonly CashRequestKind[] = ["kasa-duzeltme", "kasa-silme", "kasa-gec", "kasa-cikan", "foto-kaldir", "kapali-gun"];

/** Personelin kendi bekleyen düzeltme önerisi: kendi yazdığı alanlar ve özeti */
export interface OwnCorrection {
  id: number;
  kind: "kasa-duzeltme";
  version: number;
  createdAt: string;
  message: string | null;
  gate: "kilitli" | "gec";
  baseRevision: number;
  proposed: ProposedFields;
  lines: string[];
  result: string | null;
  carry: string | null;
}

export interface OwnDelete {
  id: number;
  kind: "kasa-silme";
  version: number;
  createdAt: string;
  message: string | null;
}

/** Başkasının bekleyen isteği: yalnız türü, adı ve anı (sayıları gitmez) */
export interface OtherPending {
  kind: StaffRequestKind;
  requestedByName: string;
  createdAt: string;
}

/**
 * Bu günün raporu için bekleyen düzeltme ve silme istekleri (personelin kasa sayfası): kişinin kendi istekleri tam
 * (kendi yazdığı alanlar), başkalarınınki yalnız tür, ad ve an.
 */
export async function pendingCashForDay(day: string, me: { id: number }): Promise<{ own: (OwnCorrection | OwnDelete)[]; others: OtherPending[] }> {
  const rows = await getDb()
    .select({
      id: s.staffRequests.id,
      kind: s.staffRequests.kind,
      version: s.staffRequests.version,
      createdAt: s.staffRequests.createdAt,
      message: s.staffRequests.message,
      payload: s.staffRequests.payload,
      requestedBy: s.staffRequests.requestedBy,
      requestedByName: s.staffRequests.requestedByName,
    })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.status, "pending"), eq(s.staffRequests.subject, `gun:${day}`), inArray(s.staffRequests.kind, [...DAY_KINDS])))
    .orderBy(asc(s.staffRequests.createdAt));
  const mine = (r: (typeof rows)[number]) => r.requestedBy === me.id;
  const notMine = (r: (typeof rows)[number]) => r.requestedBy !== me.id;
  // Rapor öneriden sonra değiştiyse "Öneriyi düzenle" önerinin değiştirdiği alanları raporun şimdiki hâline uygular:
  // arada yöneticinin yaptığı düzeltme formda geri alınmış görünmez (onaydaki birleştirmenin aynısı)
  const report = rows.some((r) => mine(r) && r.kind === "kasa-duzeltme") ? (await getDb().select(MERGE_COLUMNS).from(s.cashReports).where(eq(s.cashReports.date, day)).limit(1))[0] : undefined;
  const own = rows.filter(mine).flatMap((r): (OwnCorrection | OwnDelete)[] => {
    const common = { id: r.id, version: r.version, createdAt: r.createdAt.toISOString(), message: r.message };
    if (r.kind === "kasa-silme") return [{ ...common, kind: "kasa-silme" }];
    const p = CorrectionPayload.safeParse(r.payload);
    if (!p.success) return [];
    const summary = proposalSummary(p.data.base, p.data.proposed);
    return [{ ...common, kind: "kasa-duzeltme", gate: p.data.gate, baseRevision: p.data.baseRevision, proposed: proposedNow(report, p.data), lines: summary.lines, result: summary.result, carry: summary.carry }];
  });
  return {
    own,
    others: rows.filter(notMine).map((r) => ({ kind: r.kind, requestedByName: r.requestedByName, createdAt: r.createdAt.toISOString() })),
  };
}

/** Raporun birleştirmeye giden sütunları (sabit liste; personelin kendi gününün raporu) */
const MERGE_COLUMNS = {
  date: s.cashReports.date,
  zNo: s.cashReports.zNo,
  receipts: s.cashReports.receipts,
  zTotal: s.cashReports.zTotal,
  cash: s.cashReports.cash,
  card: s.cashReports.card,
  mealCard: s.cashReports.mealCard,
  online: s.cashReports.online,
  other: s.cashReports.other,
  openingCash: s.cashReports.openingCash,
  cashIn: s.cashReports.cashIn,
  cashOut: s.cashReports.cashOut,
  cashOutNote: s.cashReports.cashOutNote,
  countedCash: s.cashReports.countedCash,
  handedOver: s.cashReports.handedOver,
  bankPos: s.cashReports.bankPos,
  offRevenue: s.cashReports.offRevenue,
  discounts: s.cashReports.discounts,
  note: s.cashReports.note,
  cashDiff: s.cashReports.cashDiff,
  countedBy: s.cashReports.countedBy,
  countedByName: s.cashReports.countedByName,
  submittedBy: s.cashReports.submittedBy,
  submittedByName: s.cashReports.submittedByName,
  revision: s.cashReports.revision,
} as const;

/** Önerinin formdaki hâli: rapor öneriden sonra değiştiyse önerinin değiştirdiği alanlar raporun şimdiki hâlinde */
function proposedNow(report: MergeBase | undefined, p: CorrectionPayloadT): ProposedFields {
  if (!report || report.revision === p.baseRevision) return p.proposed;
  const { merged } = mergedOf(report, p);
  const { date: _date, ...fields } = merged.fields;
  void _date;
  return { ...fields, discounts: fields.discounts ?? null, countedBy: merged.countedBy ?? p.proposed.countedBy, countedByName: merged.countedByName ?? p.proposed.countedByName };
}

/** Yöneticinin formundaki bant: bu gün için bekleyen kasa istekleri (kimlik Onaylar'daki karta götürür) */
export async function pendingCashForDayAdmin(day: string): Promise<{ id: number; kind: "kasa-duzeltme" | "kasa-silme" | "kasa-gec"; requestedByName: string; createdAt: string }[]> {
  const rows = await getDb()
    .select({ id: s.staffRequests.id, kind: s.staffRequests.kind, requestedByName: s.staffRequests.requestedByName, createdAt: s.staffRequests.createdAt })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.status, "pending"), eq(s.staffRequests.subject, `gun:${day}`), inArray(s.staffRequests.kind, ["kasa-duzeltme", "kasa-silme", "kasa-gec"])))
    .orderBy(asc(s.staffRequests.createdAt));
  return rows.map((r) => ({ id: r.id, kind: r.kind as "kasa-duzeltme" | "kasa-silme" | "kasa-gec", requestedByName: r.requestedByName, createdAt: r.createdAt.toISOString() }));
}

/** İsteklerim (personelin kasa sayfası, son 7 gün): başlık, durum, yöneticinin notu; yük yok */
export interface MyCashRequest {
  id: number;
  kind: CashRequestKind;
  title: string;
  day: string | null;
  status: StaffRequestStatus;
  reviewNote: string | null;
  reviewedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function myCashRequests(userId: number): Promise<MyCashRequest[]> {
  const rows = await ownRequests(getDb(), userId, MY_CASH_KINDS, 7);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as CashRequestKind,
    title: r.title,
    day: r.day,
    status: r.status,
    reviewNote: r.reviewNote,
    reviewedByName: r.reviewedByName,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Onaylanan düzeltme önerilerinin önerenleri, rapora ve sürüme göre ("Değişiklikler" geçmişi, ertesi gün zili): onayın
 * ürettiği sürüm isteğin sonucunda (result.revision)
 */
export async function proposedByForReports(reportIds: readonly number[]): Promise<Map<number, Map<number, string>>> {
  const out = new Map<number, Map<number, string>>();
  if (!reportIds.length) return out;
  const rows = await getDb()
    .select({ resultId: s.staffRequests.resultId, result: s.staffRequests.result, requestedByName: s.staffRequests.requestedByName })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kasa-duzeltme"), eq(s.staffRequests.status, "approved"), inArray(s.staffRequests.resultId, [...reportIds])));
  for (const r of rows) {
    const revision = Number((r.result as { revision?: unknown } | null)?.revision);
    if (r.resultId === null || !Number.isInteger(revision)) continue;
    const m = out.get(r.resultId) ?? new Map<number, string>();
    m.set(revision, r.requestedByName);
    out.set(r.resultId, m);
  }
  return out;
}

// ---------------------------------------------------------------- Yöneticinin kartları (Onaylar › Kasa)

interface CardBase {
  id: number;
  version: number;
  date: string;
  requestedByName: string;
  createdAt: string;
  /** "2 gündür" */
  waited: string;
  message: string | null;
}

/** Üç sütun (istekten sonra rapor değiştiyse): öneri anı / şimdi / onaydan sonra */
export interface ThreeColRow {
  label: string;
  atProposal: string;
  now: string;
  after: string;
}

export interface CorrectionCard extends CardBase {
  kind: "kasa-duzeltme";
  /** Raporun şimdiki sürümü (onay bununla gider) */
  reportRevision: number;
  gate: "kilitli" | "gec";
  /** Raporun şimdiki hâlinden onaydan sonraki hâline */
  changes: FieldChange[];
  threeCols: ThreeColRow[] | null;
  result: string | null;
  carry: string | null;
  /** Sonraki raporun açılışı bu devirle tutacak mı */
  next: { date: string; opening: number; holds: boolean } | null;
  /** "Gün içinde çıkan" değişiyorsa: fişlerin sayısı ve toplamı, fişsiz kalan */
  receipts: { count: number; total: number; unreceipted: number | null } | null;
  /** Raporun ayı geçti */
  monthPassed: string | null;
}

export interface DeleteCard extends CardBase {
  kind: "kasa-silme";
  reportRevision: number;
  summary: string;
  next: string | null;
}

export type CashRequestCard = CorrectionCard | DeleteCard | LateCard | CashOutCard | PhotoRemovalCard | ClosedDayCard;

/**
 * Bekleyen kasa isteklerinin kartları (düzeltme, silme, geç rapor, kasadan çıkan, fotoğraf kaldırma), en eski gün önce
 * (yalnız yönetici)
 */
export async function loadCashRequestQueue(now = new Date()): Promise<CashRequestCard[]> {
  const [day, late, outs, closed] = await Promise.all([dayRequestCards(now), lateCards(now), cashOutCards(now), closedDayCards()]);
  return [...day, ...late, ...outs, ...closed].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/** Kayıtlı raporun düzeltme ve silme isteklerinin kartları */
async function dayRequestCards(now: Date): Promise<(CorrectionCard | DeleteCard)[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: s.staffRequests.id,
      kind: s.staffRequests.kind,
      version: s.staffRequests.version,
      day: s.staffRequests.day,
      payload: s.staffRequests.payload,
      message: s.staffRequests.message,
      requestedByName: s.staffRequests.requestedByName,
      createdAt: s.staffRequests.createdAt,
    })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.status, "pending"), inArray(s.staffRequests.kind, [...DAY_KINDS])))
    .orderBy(asc(s.staffRequests.day), asc(s.staffRequests.createdAt));
  if (!rows.length) return [];
  const days = [...new Set(rows.flatMap((r) => (r.day ? [r.day] : [])))];
  const reports = days.length ? await db.select().from(s.cashReports).where(inArray(s.cashReports.date, days)) : [];
  const byDate = new Map(reports.map((r) => [r.date, r]));
  const thisMonth = businessDate(now).slice(0, 7);
  const cards: (CorrectionCard | DeleteCard)[] = [];
  for (const r of rows) {
    const report = r.day ? byDate.get(r.day) : undefined;
    if (!report || !r.day) continue;
    const base: CardBase = {
      id: r.id,
      version: r.version,
      date: r.day,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt.toISOString(),
      waited: waitedText(r.createdAt, now),
      message: r.message,
    };
    const nextReport = await nextReportAfter(r.day);
    if (r.kind === "kasa-silme") {
      if (!DeletePayload.safeParse(r.payload).success) continue;
      const [{ n }] = await db.select({ n: count() }).from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, report.id));
      const summary = [
        `Z ${money(report.zTotal)}`,
        `sayılan ${money(report.countedCash)}`,
        diffText(report.cashDiff),
        `sayan ${report.countedByName ?? report.submittedByName}`,
        n ? `${n} fotoğraf` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      cards.push({
        ...base,
        kind: "kasa-silme",
        reportRevision: report.revision,
        summary,
        next: nextReport ? `${dayMonthTR(nextReport.date)} açılışı bu raporun devrine dayanıyor` : null,
      });
      continue;
    }
    const parsed = CorrectionPayload.safeParse(r.payload);
    if (!parsed.success) continue;
    const p = parsed.data;
    const { current, merged, changes } = mergedOf(report, p);
    const after: CashRevisionData = { ...merged.fields, discounts: merged.fields.discounts ?? null, cashDiff: computeCash(merged.fields).cashDiff, countedByName: merged.countedByName };
    const lines = resultLines(current.data, after);
    const threeCols =
      report.revision !== p.baseRevision
        ? threeColumns(p.base, current.data, after, [
            ...proposalChanges(p.base, p.proposed).map((c) => c.key),
            // Öneriden sonra değişen alanlar da (yöneticinin arada yaptığı düzeltme: onayda korunur)
            ...revisionChanges(p.base, current.data).map((c) => c.key),
            ...changes.map((c) => c.key),
          ])
        : null;
    let receipts: CorrectionCard["receipts"] = null;
    if (changes.some((c) => c.key === "cashOut")) {
      const outs = await cashOutsOn(r.day);
      const total = cashOutsTotal(outs);
      const over = Math.round((after.cashOut - total) * 100) / 100;
      receipts = { count: outs.length, total, unreceipted: over > 1 ? over : null };
    }
    const carryAfter = Math.round((after.countedCash - after.handedOver) * 100) / 100;
    cards.push({
      ...base,
      kind: "kasa-duzeltme",
      reportRevision: report.revision,
      gate: p.gate,
      changes,
      threeCols,
      result: lines.result,
      carry: lines.carry,
      next: nextReport ? { date: nextReport.date, opening: nextReport.openingCash, holds: carryCheck(nextReport.date, nextReport.openingCash, { date: r.day, amount: carryAfter }) === null } : null,
      receipts,
      monthPassed: r.day.slice(0, 7) < thisMonth ? `${monthTitleTR(r.day.slice(0, 7)).split(" ")[0]} ayı geçti: Satışlar cirosu ve kart payı / POS komisyonu değişir` : null,
    });
  }
  return cards;
}

/** Üç sütunun satırları: öneri anı, şimdi ve onaydan sonra (yalnız herhangi birinde değişen alanlar, form sırasıyla) */
function threeColumns(atProposal: CashRevisionData, now: CashRevisionData, after: CashRevisionData, keys: readonly FieldChange["key"][]): ThreeColRow[] {
  const wanted = new Set(keys);
  return (Object.keys(CHANGE_LABELS) as FieldChange["key"][])
    .filter((k) => wanted.has(k))
    .map((k) => ({ label: CHANGE_LABELS[k], atProposal: fieldValue(k, atProposal), now: fieldValue(k, now), after: fieldValue(k, after) }));
}

// ---------------------------------------------------------------- Zil (yönetici)

/** Yöneticinin zilinde bekleyen kasa istekleri (düzeltme, silme, geç rapor): istek başına satır (başlık ve gövde yükten) */
export async function pendingCashBellRows(): Promise<{ id: number; bumpedAt: Date; createdAt: Date; title: string; body: string }[]> {
  const [day, late] = await Promise.all([dayBellRows(), lateBellRows()]);
  return [...day, ...late].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

async function dayBellRows(): Promise<{ id: number; bumpedAt: Date; createdAt: Date; title: string; body: string }[]> {
  const rows = await getDb()
    .select({
      id: s.staffRequests.id,
      kind: s.staffRequests.kind,
      day: s.staffRequests.day,
      payload: s.staffRequests.payload,
      message: s.staffRequests.message,
      requestedByName: s.staffRequests.requestedByName,
      bumpedAt: s.staffRequests.bumpedAt,
      createdAt: s.staffRequests.createdAt,
    })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.status, "pending"), inArray(s.staffRequests.kind, [...DAY_KINDS])))
    .orderBy(asc(s.staffRequests.createdAt));
  return rows.flatMap((r) => {
    if (!r.day) return [];
    if (r.kind === "kasa-silme") return [{ id: r.id, bumpedAt: r.bumpedAt, createdAt: r.createdAt, ...deleteBell({ date: r.day, by: r.requestedByName, reason: r.message }) }];
    const p = CorrectionPayload.safeParse(r.payload);
    if (!p.success) return [];
    const changes = proposalChanges(p.data.base, p.data.proposed);
    const after = computeCash({ ...p.data.proposed }).cashDiff;
    return [{ id: r.id, bumpedAt: r.bumpedAt, createdAt: r.createdAt, ...correctionBell({ date: r.day, by: r.requestedByName, changes, before: computeCash(p.data.base).cashDiff, after }) }];
  });
}
