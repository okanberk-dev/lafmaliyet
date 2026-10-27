import "server-only";

import { and, asc, count, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";

import { businessDate, staffCanReport } from "@/lib/cash-report";
import {
  cashOutChanged,
  cashOutFlags,
  CashOutRequestPayload,
  lineChanges,
  oldRequestDays,
  photoKindRefusal,
  PhotoRemovalPayload,
  staffCashOutView,
  type CashOutBeforeT,
  type CashOutLineT,
  type CashOutOp,
  type RemovablePhotoKind,
  type StaffCashOutView,
} from "@/lib/cash-out-requests";
import { cashOutLabel, cashOutsTotal, staffExpenseLocked, staffToExpenses } from "@/lib/cash-outs";
import { money } from "@/lib/format";
import { okcHasFigures } from "@/lib/okc-z";
import { photoDiffs, photoDiffText, savedFields, suspiciousDiffs } from "@/lib/photo-read/kasa";
import { expenseDateFor } from "@/lib/photo-read/receipt";
import { addDays, dayMonthTR, monthGenitiveTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import { closedDaysBetween } from "@/server/closed-days";
import { cashOutsOn } from "@/server/data/cash-outs";
import { photoReadingOf, type CashPhotoDTO } from "@/server/data/cash-photos";
import { kasaEvidence } from "@/server/data/lafpos-day";
import { getDb, schema as s } from "@/server/db";
import { staffDayOpen } from "@/server/photo-read/rules";

/*
 * Kasadan çıkan istekleri ve fotoğraf kaldırmanın okuyucuları (docs/KASA-RAPORU.md › Kasadan çıkan: kapanmış gün,
 * yöneticinin satırı; plan docs/planlar/personel-yetki.md §2.7). Personelin okuyucuları sabit sütunla ve beyaz listeyle:
 * kişinin kendi isteğinden yalnız satırın kendisi (staffCashOutView: kategori, önceki hâl ve gider kaydı yok),
 * başkasınınkinden yalnız satırın kimliği ve ad (tests/personel-sizinti-kasa.test.ts). Yöneticinin kartları (önceki hâl,
 * bağlı gider, günün satırları, kasa farkı, tekrar eşleşmeleri) yalnız Onaylar'da.
 */

const r = s.staffRequests;

/** Personelin kendi bekleyen kasadan çıkan isteği (kasa sayfasının kartı): yalnız satırın kendisi */
export interface OwnCashOutRequest {
  id: number;
  version: number;
  createdAt: string;
  message: string | null;
  cashOutId: number | null;
  view: StaffCashOutView;
}

/**
 * Bu günün bekleyen kasadan çıkan istekleri (personelin kasa sayfası): kişinin kendi istekleri (satırın kendisi) ve
 * başkalarının satırlara açtığı istekler (yalnız satırın kimliği ve ad)
 */
export async function staffCashOutRequests(day: string, me: { id: number }): Promise<{ own: OwnCashOutRequest[]; others: { cashOutId: number; requestedByName: string }[] }> {
  const rows = await getDb()
    .select({
      id: r.id,
      version: r.version,
      createdAt: r.createdAt,
      message: r.message,
      payload: r.payload,
      requestedBy: r.requestedBy,
      requestedByName: r.requestedByName,
    })
    .from(r)
    .where(and(eq(r.kind, "kasa-cikan"), eq(r.status, "pending"), eq(r.day, day)))
    .orderBy(asc(r.createdAt));
  const own: OwnCashOutRequest[] = [];
  const others: { cashOutId: number; requestedByName: string }[] = [];
  for (const x of rows) {
    const p = CashOutRequestPayload.safeParse(x.payload);
    if (!p.success) continue;
    if (x.requestedBy === me.id) {
      own.push({ id: x.id, version: x.version, createdAt: x.createdAt.toISOString(), message: x.message, cashOutId: p.data.cashOutId, view: staffCashOutView(p.data) });
    } else if (p.data.cashOutId !== null) {
      others.push({ cashOutId: p.data.cashOutId, requestedByName: x.requestedByName });
    }
  }
  return { own, others };
}

/**
 * Raporun fotoğraflarında kaldırma isteği açılabilir mi (personelin kasa sayfası): "pending" bekleyen istek var (kimin
 * olursa), "blocked" raporun tek Z fotoğrafı ya da fotoğraftan farklı yazılan alan var, "ok" açılabilir. Yalnız
 * personelin açabildiği gün (bugün, dün); değilse boş.
 */
export async function photoRemovalStates(report: { id: number; date: string } & Parameters<typeof savedFields>[0], photos: readonly CashPhotoDTO[]): Promise<Record<number, "ok" | "pending" | "blocked">> {
  if (!photos.length || !staffCanReport(report.date)) return {};
  const db = getDb();
  const pending = await db
    .select({ subject: r.subject })
    .from(r)
    .where(and(eq(r.kind, "foto-kaldir"), eq(r.status, "pending"), inArray(r.subject, photos.map((p) => `foto:${p.id}`))));
  const waiting = new Set(pending.map((p) => Number(p.subject.slice(5))));
  const counts = {
    zCount: photos.filter((p) => p.kind === "kasa-z").length,
    okcCount: photos.filter((p) => p.kind === "kasa-okc").length,
    okcFigures: okcHasFigures(report),
    evidence: await kasaEvidence(db, report.date),
  };
  const saved = savedFields(report);
  const out: Record<number, "ok" | "pending" | "blocked"> = {};
  for (const p of photos) {
    if (waiting.has(p.id)) out[p.id] = "pending";
    else if (photoKindRefusal(p.kind, counts)) out[p.id] = "blocked";
    else {
      const reading = await photoReadingOf(db, p.id, p.kind, report.date);
      out[p.id] = reading && suspiciousDiffs([reading], saved).length ? "blocked" : "ok";
    }
  }
  return out;
}

/** "Eski bir güne ekle"nin günleri: D−2 … D−7, kapalı işaretli günler hariç, en yeni önce */
export async function staffOldCashOutDays(now = new Date()): Promise<string[]> {
  const days = oldRequestDays(now);
  if (!days.length) return [];
  const closed = new Set(await closedDaysBetween(days[days.length - 1], days[0]));
  return days.filter((d) => !closed.has(d));
}

// ---------------------------------------------------------------- Yöneticinin kartları (Onaylar › Kasa)

interface CardBase {
  id: number;
  version: number;
  date: string;
  requestedByName: string;
  createdAt: string;
  waited: string;
  message: string | null;
}

/** Günün bir satırı (bağlam): ad, tutar, kim, fişli mi */
export interface DayLine {
  id: number;
  label: string;
  amount: number;
  by: string;
  photo: boolean;
  /** İstenen satır (düzeltme ve silmede) */
  subject: boolean;
}

export interface CashOutCard extends CardBase {
  kind: "kasa-cikan";
  op: CashOutOp;
  /** İstenen satır (ekleme ve düzeltme); silmede null */
  line: CashOutLineT | null;
  /** Satırın istendiği andaki hâli (düzeltme ve silme) */
  before: CashOutBeforeT | null;
  /** Düzeltmede değişecekler ("Tutar: 400 ₺ → 412,50 ₺") */
  changes: string[];
  /** Satır istekten sonra değişti (satır, fotoğraf ya da bağlı gider): "Yine de uygula" */
  changedSince: boolean;
  /** Satır artık yok (düzeltme ve silme) */
  rowGone: boolean;
  /** Bağlı harcama kaydının kategorisi ve yöneticinin kategorisi mi (düzeltme ve silme) */
  expense: { categoryName: string | null; admin: boolean } | null;
  /** Fiş fotoğrafı (eklemede istekte tutulan, düzeltme ve silmede satırınki) */
  photoId: number | null;
  /** Onayın varsayılanları: Aylık harcamalar'a yazılsın mı ve kategori */
  defaults: { toExpenses: boolean; categoryId: number | null };
  context: {
    /** Günün kasa raporu (kasa farkı ve "Gün içinde çıkan") */
    report: { cashDiff: number; cashOut: number } | null;
    lines: DayLine[];
    /** Satırların toplamı şimdi ve onaydan sonra */
    totals: { now: number; after: number };
    /** Olası tekrar: aynı tutar (±0,01), ±1 gün ("Migros · 412,50 ₺ · 21 Ekim · kasadan çıkan") */
    duplicates: string[];
    /** Kırmızı işaretler */
    flags: string[];
    /** Gider ayı bu ay değil */
    monthWarning: string | null;
    /** Gün personele kapanmış (kilitli ya da eski) */
    dayClosed: boolean;
  };
}

export interface PhotoRemovalCard extends CardBase {
  kind: "foto-kaldir";
  photo: CashPhotoDTO | null;
  photoKind: RemovablePhotoKind;
  /** Okuma farkları (rapordaki değerlerle) */
  diffs: string[];
  /** Onay bu hâliyle reddedilir: tek Z, okuma farkı ya da fotoğraf artık bağlı değil */
  refusal: string | null;
}

/** Bekleyen kasadan çıkan ve fotoğraf kaldırma kartları (yalnız yönetici; loadCashRequestQueue toplar) */
export async function cashOutCards(now = new Date()): Promise<(CashOutCard | PhotoRemovalCard)[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: r.id,
      kind: r.kind,
      version: r.version,
      day: r.day,
      payload: r.payload,
      message: r.message,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt,
    })
    .from(r)
    .where(and(eq(r.status, "pending"), inArray(r.kind, ["kasa-cikan", "foto-kaldir"])))
    .orderBy(asc(r.day), asc(r.createdAt));
  if (!rows.length) return [];
  const thisMonth = businessDate(now).slice(0, 7);
  const out: (CashOutCard | PhotoRemovalCard)[] = [];
  for (const x of rows) {
    if (!x.day) continue;
    const base: CardBase = { id: x.id, version: x.version, date: x.day, requestedByName: x.requestedByName, createdAt: x.createdAt.toISOString(), waited: waitedText(x.createdAt, now), message: x.message };
    if (x.kind === "foto-kaldir") {
      const p = PhotoRemovalPayload.safeParse(x.payload);
      if (!p.success) continue;
      out.push(await photoCard(base, p.data));
      continue;
    }
    const p = CashOutRequestPayload.safeParse(x.payload);
    if (!p.success) continue;
    out.push(await cashOutCard(base, p.data, thisMonth, now));
  }
  return out;
}

async function photoCard(base: CardBase, p: { photoId: number; photoKind: RemovablePhotoKind; reportId: number; day: string }): Promise<PhotoRemovalCard> {
  const db = getDb();
  const [[photo], [report], [{ n: sameKind }]] = await Promise.all([
    db
      .select({ id: s.photos.id, kind: s.photos.kind, createdAt: s.photos.createdAt, byName: s.photos.createdByName })
      .from(s.cashReportPhotos)
      .innerJoin(s.photos, eq(s.photos.id, s.cashReportPhotos.photoId))
      .where(and(eq(s.cashReportPhotos.photoId, p.photoId), eq(s.cashReportPhotos.reportId, p.reportId)))
      .limit(1),
    db.select().from(s.cashReports).where(eq(s.cashReports.id, p.reportId)).limit(1),
    db
      .select({ n: count() })
      .from(s.cashReportPhotos)
      .where(and(eq(s.cashReportPhotos.reportId, p.reportId), eq(s.cashReportPhotos.kind, p.photoKind))),
  ]);
  const reading = report ? await photoReadingOf(db, p.photoId, p.photoKind, report.date) : null;
  const saved = report ? savedFields(report) : null;
  const diffs = reading && saved ? photoDiffs([reading], saved) : [];
  const suspicious = reading && saved ? suspiciousDiffs([reading], saved) : [];
  // Tek ModPOS Z ve (yazarkasa bölümü yazılmışken) tek Banka POS Z fotoğrafı kanıttır (removalCheck ile aynı kural)
  const kindRefusal = report ? photoKindRefusal(p.photoKind, { zCount: sameKind, okcCount: sameKind, okcFigures: okcHasFigures(report), evidence: await kasaEvidence(db, report.date) }) : null;
  const refusal = !photo || !report ? "Fotoğraf artık rapora bağlı değil; isteği reddedin" : kindRefusal ? kindRefusal : suspicious.length ? "Fotoğraftan farklı yazılan alan var; fotoğraf kanıttır" : null;
  return {
    ...base,
    kind: "foto-kaldir",
    photoKind: p.photoKind,
    photo: photo && (photo.kind === "kasa-z" || photo.kind === "kasa-pos" || photo.kind === "kasa-okc") ? { id: photo.id, kind: photo.kind, createdAt: photo.createdAt.toISOString(), byName: photo.byName } : null,
    diffs: diffs.map((d) => photoDiffText(d)),
    refusal,
  };
}

async function cashOutCard(base: CardBase, p: ReturnType<typeof CashOutRequestPayload.parse>, thisMonth: string, now: Date): Promise<CashOutCard> {
  const db = getDb();
  const day = p.day;
  const [lines, [report], dayOpen] = await Promise.all([
    cashOutsOn(day),
    db.select({ cashDiff: s.cashReports.cashDiff, cashOut: s.cashReports.cashOut }).from(s.cashReports).where(eq(s.cashReports.date, day)).limit(1),
    staffDayOpen(day, db, now),
  ]);
  const current = p.cashOutId !== null ? (lines.find((l) => l.id === p.cashOutId) ?? null) : null;
  const rowGone = p.op !== "ekle" && !current;
  let expense: CashOutCard["expense"] = null;
  if (current && current.categoryId !== null) {
    const [cat] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, current.categoryId)).limit(1);
    expense = { categoryName: current.categoryName, admin: staffExpenseLocked(cat) };
  }
  const changedSince =
    p.before !== null &&
    cashOutChanged(
      p.before,
      current
        ? {
            row: { ...current, updatedAt: current.updatedAt },
            expense: current.expenseEntryId !== null && current.categoryId !== null ? { id: current.expenseEntryId, categoryId: current.categoryId, updatedAt: (await expenseUpdatedAt(current.expenseEntryId)) ?? "" } : null,
          }
        : null,
    );
  const nowTotal = cashOutsTotal(lines);
  const after =
    p.op === "ekle" ? nowTotal + p.line!.amount : p.op === "sil" ? nowTotal - (current?.amount ?? 0) : nowTotal - (current?.amount ?? 0) + (p.line?.amount ?? 0);
  const subjectLine = p.line ?? p.before;
  // Olası tekrar: aynı tutar, ±1 gün (kasadan çıkan) ve ±7 gün (harcama kaydı); istenen satırın kendisi hariç
  let duplicates: string[] = [];
  if (p.op === "ekle" && p.line) {
    const ref = p.line.receiptDate ?? day;
    const [outs, entries] = await Promise.all([
      db
        .select({ id: s.cashOuts.id, date: s.cashOuts.date, receiptDate: s.cashOuts.receiptDate, amount: s.cashOuts.amount, store: s.cashOuts.store, description: s.cashOuts.description, kind: s.cashOuts.kind })
        .from(s.cashOuts)
        .where(and(gte(s.cashOuts.date, addDays(day, -1)), lte(s.cashOuts.date, addDays(day, 1)))),
      db
        .select({ date: s.expenseEntries.date, amount: s.expenseEntries.amount, description: s.expenseEntries.description, cashOutId: s.expenseEntries.cashOutId })
        .from(s.expenseEntries)
        .where(and(gte(s.expenseEntries.date, addDays(ref, -7)), lte(s.expenseEntries.date, addDays(ref, 7)))),
    ]);
    const near = (a: number) => Math.abs(a - p.line!.amount) <= 0.01;
    duplicates = [
      ...outs.filter((o) => near(o.amount) && Math.abs(dayDiff(o.receiptDate ?? o.date, ref)) <= 1).map((o) => `${cashOutLabel(o)} · ${money(o.amount)} · ${dayMonthTR(o.date)} · kasadan çıkan`),
      ...entries.filter((e) => e.cashOutId === null && near(e.amount)).map((e) => `${e.description ?? "Harcama"} · ${money(e.amount)} · ${dayMonthTR(e.date)} · harcama kaydı`),
    ].slice(0, 4);
  }
  const expenseDay = p.line && p.line.kind === "harcama" ? expenseDateFor(day, p.line.receiptDate) : null;
  return {
    ...base,
    kind: "kasa-cikan",
    op: p.op,
    line: p.line,
    before: p.before,
    changes: p.op === "duzelt" && p.before && p.line ? lineChanges(p.before, p.line) : [],
    changedSince: p.op !== "ekle" && !rowGone && changedSince,
    rowGone,
    expense,
    photoId: p.op === "ekle" ? (p.line?.photoId ?? null) : (current?.photoId ?? p.before?.photoId ?? null),
    defaults: {
      toExpenses: p.op === "ekle" ? (p.line ? staffToExpenses(p.line.kind, p.line.docType) : false) : current?.expenseEntryId != null,
      categoryId: p.op === "ekle" ? (p.line?.categoryId ?? null) : (current?.categoryId ?? null),
    },
    context: {
      report: report ? { cashDiff: report.cashDiff, cashOut: report.cashOut } : null,
      lines: lines.map((l) => ({ id: l.id, label: cashOutLabel(l), amount: l.amount, by: l.createdByName, photo: l.photoId !== null, subject: l.id === p.cashOutId })),
      totals: { now: nowTotal, after: Math.round(after * 100) / 100 },
      duplicates,
      flags: cashOutFlags({ op: p.op, line: subjectLine, dayClosed: !dayOpen, reportDiff: report?.cashDiff ?? null }),
      monthWarning: expenseDay && expenseDay.slice(0, 7) < thisMonth ? `Gider ${monthGenitiveTR(expenseDay.slice(0, 7))} kaydına yazılır; o ayın kârı değişir` : null,
      dayClosed: !dayOpen,
    },
  };
}

/** İki gün arasındaki gün farkı (b − a) */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

async function expenseUpdatedAt(id: number): Promise<string | null> {
  const [e] = await getDb().select({ updatedAt: s.expenseEntries.updatedAt }).from(s.expenseEntries).where(eq(s.expenseEntries.id, id)).limit(1);
  return e?.updatedAt.toISOString() ?? null;
}

// ---------------------------------------------------------------- Zil (yönetici)

/** Yöneticinin zilinde bekleyen kasadan çıkan ve fotoğraf kaldırma istekleri: tek satır ("3 kasa isteği onay bekliyor") */
export async function cashOutBellRow(now = new Date()): Promise<{ id: string; count: number; firstId: number; oldestAt: Date; text: string } | null> {
  const rows = await getDb()
    .select({ id: r.id, kind: r.kind, title: r.title, bumpedAt: r.bumpedAt, createdAt: r.createdAt, requestedByName: r.requestedByName })
    .from(r)
    .where(and(eq(r.status, "pending"), inArray(r.kind, ["kasa-cikan", "foto-kaldir"]), or(isNull(r.expiresAt), gt(r.expiresAt, now))))
    .orderBy(asc(r.createdAt));
  const live = rows;
  if (!live.length) return null;
  const newest = Math.max(...live.map((x) => x.bumpedAt.getTime()));
  return {
    id: `kasa-istek-${live.length}-${newest}`,
    count: live.length,
    firstId: live[0].id,
    oldestAt: live[0].createdAt,
    text: live
      .slice(0, 3)
      .map((x) => `${x.title} (${x.requestedByName})`)
      .join(" · "),
  };
}
