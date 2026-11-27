import "server-only";

import { and, asc, count, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope, DEFAULT_BRANCH_ID, requestInScope } from "@/lib/branches";
import { businessDate, staffCanReport } from "@/lib/cash-report";
import {
  cashOutChanged,
  cashOutFlags,
  CashOutRequestPayload,
  lineChanges,
  oldRequestDays,
  photoKindRefusal,
  PhotoRemovalPayload,
  readingBlocksRemoval,
  staffCashOutView,
  type CashOutBeforeT,
  type CashOutLineT,
  type CashOutOp,
  type RemovablePhotoKind,
  type StaffCashOutView,
} from "@/lib/cash-out-requests";
import { amountOnlyRow, cashOutLabel, cashOutsTotal, ownerCategoryRow, ownerRowsAmountOnly, staffCategory, staffExpenseLocked, staffToExpenses } from "@/lib/cash-outs";
import { money } from "@/lib/format";
import { staffLafposEntryClosed } from "@/lib/lafpos/cash-moves";
import { branchSwitchDay, isLafposDay } from "@/lib/lafpos/switch";
import { okcHasFigures } from "@/lib/okc-z";
import { photoDiffs, photoDiffText, savedFields, suspiciousDiffs } from "@/lib/photo-read/kasa";
import { expenseDateFor } from "@/lib/photo-read/receipt";
import { addDays, dayMonthTR, monthGenitiveTR } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import { currentTillBranch } from "@/server/branch-scope";
import { closedDaysBetween } from "@/server/closed-days";
import { requestBranches } from "@/server/staff-requests/branch";
import { cashOutsOn, staffCategoryIds } from "@/server/data/cash-outs";
import { photoReadingOf, type CashPhotoDTO } from "@/server/data/cash-photos";
import { kasaEvidence, lafposAutoReportOf } from "@/server/data/lafpos-day";
import { lafposSwitchDayOf } from "@/server/data/lafpos-ikram";
import { getDb, schema as s } from "@/server/db";
import { lafposBranchId } from "@/server/lafpos/branch";
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
 * olursa), "blocked" raporun tek Z fotoğrafı ya da fotoğraftan farklı yazılan alan var (otomatik LafPOS gününde
 * değil: readingBlocksRemoval), "ok" açılabilir. Yalnız
 * personelin açabildiği gün (bugün, dün); değilse boş.
 */
export async function photoRemovalStates(report: { id: number; date: string; branchId: string } & Parameters<typeof savedFields>[0], photos: readonly CashPhotoDTO[]): Promise<Record<number, "ok" | "pending" | "blocked">> {
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
    evidence: await kasaEvidence(db, report.date, report.branchId),
  };
  const saved = savedFields(report);
  // Otomatik LafPOS gününde okuma farkı (fotoğraf ↔ LafPOS) personelin düğmesini gizlemez: farkı ele verirdi
  const lafposAuto = await lafposAutoReportOf(db, report.id);
  const out: Record<number, "ok" | "pending" | "blocked"> = {};
  for (const p of photos) {
    if (waiting.has(p.id)) out[p.id] = "pending";
    else if (photoKindRefusal(p.kind, counts)) out[p.id] = "blocked";
    else {
      const reading = await photoReadingOf(db, p.id, p.kind, report.date);
      out[p.id] = reading && readingBlocksRemoval({ suspicious: suspiciousDiffs([reading], saved).length, staff: true, lafposAuto }) ? "blocked" : "ok";
    }
  }
  return out;
}

/** "Eski bir güne ekle"nin günleri: D−2 … D−7, kapalı işaretli günler hariç, en yeni önce */
export async function staffOldCashOutDays(now = new Date()): Promise<string[]> {
  const days = oldRequestDays(now);
  if (!days.length) return [];
  // Kasanın şubesinin kapalı günleri (ve işletme geneli): öteki şubenin kapalı günü bu şubenin listesinden düşmez
  const till = await currentTillBranch();
  const [closedDays, setting, lafposBranch] = await Promise.all([closedDaysBetween(days[days.length - 1], days[0], getDb(), till), lafposSwitchDayOf(getDb()), lafposBranchId()]);
  const closed = new Set(closedDays);
  // LafPOS gününe personel satır eklemez (staffLafposEntryClosed; kapı staffCashOutGate da reddeder): kasadan çıkanlar LafPOS'tan
  const switchDay = branchSwitchDay(setting, till, lafposBranch);
  return days.filter((d) => !closed.has(d) && !staffLafposEntryClosed({ admin: false, branchId: till, lafposDay: isLafposDay(d, switchDay), lafposBranch }));
}

// ---------------------------------------------------------------- Yöneticinin kartları (Onaylar › Kasa)

interface CardBase {
  id: number;
  version: number;
  date: string;
  /**
   * İsteğin kasası (kasadan çıkanda isteğin şubesi, fotoğrafta raporun şubesi; rapor artık yoksa null). Onay buna yazar,
   * yöneticinin seçimine değil; loadCashRequestQueue birden çok kasa açıkken bundan `branch`ı (kartta ad, "Günü aç"ta
   * `?sube=`) kurar (denetim 21 Kasım #29)
   */
  branchId: string | null;
  /** Birden çok kasa açıkken isteğin kasası (loadCashRequestQueue doldurur); tek kasada null */
  branch?: { id: string; name: string } | null;
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
  /**
   * İstenen satır (ekleme ve düzeltme); silmede null. Müdüre yöneticinin kategorisindeki satırın isteğinde (ve `before`,
   * `changes`, `photoId`, `message`) yalnız türü ve tutarı (src/lib/cash-outs.ts › amountOnlyRow; docs/ROLLER.md)
   */
  line: CashOutLineT | null;
  /** Satırın istendiği andaki hâli (düzeltme ve silme) */
  before: CashOutBeforeT | null;
  /** Düzeltmede değişecekler ("Tutar: 400 ₺ → 412,50 ₺") */
  changes: string[];
  /** Satır istekten sonra değişti (satır, fotoğraf ya da bağlı gider): "Yine de uygula" */
  changedSince: boolean;
  /** Satır artık yok (düzeltme ve silme) */
  rowGone: boolean;
  /**
   * Bağlı harcama kaydının kategorisi ve yöneticinin kategorisi mi (düzeltme ve silme). Müdüre yöneticinin kategorisinin
   * (maaş, kira gibi) adı gitmez: `categoryName` null (docs/ROLLER.md › Kararlar; Kasa sayfasındaki kuralla aynı)
   */
  expense: { categoryName: string | null; admin: boolean } | null;
  /**
   * Kararı yalnız yönetici verir: satır yöneticinin kategorisinde ve kartı okuyan bütün kategorileri yazamıyor (müdür).
   * Kart onay ve ret düğmesi çizmez; sunucu da reddeder (src/server/cash-outs/write.ts › assertOwnerRowOpen)
   */
  ownerDecides: boolean;
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
    /**
     * Olası tekrar: aynı tutar (±0,01), ±1 gün ("Migros · 412,50 ₺ · 21 Ekim · kasadan çıkan"). Müdüre yalnız isteğin
     * şubesinin satırları ve personelin kategorisindeki harcama kayıtları (öteki şubeninki, maaş ve kira kaydı gitmez)
     */
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

/**
 * Bekleyen kasadan çıkan ve fotoğraf kaldırma kartları (yönetici ve müdür; loadCashRequestQueue toplar).
 * `allCategories` false (müdür, `kategori.tum` yok; docs/ROLLER.md): kart yöneticinin kategorisinin adını ve öteki
 * şubenin, yöneticinin kategorisinin kayıtlarını taşımaz (kart tarayıcıya bütünüyle gider). Yöneticinin kategorisindeki
 * (maaş, kira, avans) satır kartta yalnız türü ve tutarıyla: isteğin konusuysa satırın ve önerinin yeri, açıklaması, fişi,
 * fotoğrafı ve personelin notu gitmez; günün satırları arasındaysa adı "Harcama", fişi yok; olası tekrarda hiç yok
 */
export async function cashOutCards(now = new Date(), allCategories = true): Promise<(CashOutCard | PhotoRemovalCard)[]> {
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
  // Müdür: personelin kategorileri (dışındaki satır yöneticinin; src/lib/cash-outs.ts › ownerCategoryRow); yöneticide null
  const staffIds = allCategories ? null : await staffCategoryIds();
  const out: (CashOutCard | PhotoRemovalCard)[] = [];
  for (const x of rows) {
    if (!x.day) continue;
    const base: Omit<CardBase, "branchId"> = { id: x.id, version: x.version, date: x.day, requestedByName: x.requestedByName, createdAt: x.createdAt.toISOString(), waited: waitedText(x.createdAt, now), message: x.message };
    if (x.kind === "foto-kaldir") {
      const p = PhotoRemovalPayload.safeParse(x.payload);
      if (!p.success) continue;
      out.push(await photoCard(base, p.data));
      continue;
    }
    const p = CashOutRequestPayload.safeParse(x.payload);
    if (!p.success) continue;
    out.push(await cashOutCard(base, p.data, thisMonth, now, staffIds));
  }
  return out;
}

async function photoCard(base: Omit<CardBase, "branchId">, p: { photoId: number; photoKind: RemovablePhotoKind; reportId: number; day: string }): Promise<PhotoRemovalCard> {
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
  const kindRefusal = report ? photoKindRefusal(p.photoKind, { zCount: sameKind, okcCount: sameKind, okcFigures: okcHasFigures(report), evidence: await kasaEvidence(db, report.date, report.branchId) }) : null;
  const refusal = !photo || !report ? "Fotoğraf artık rapora bağlı değil; isteği reddedin" : kindRefusal ? kindRefusal : suspicious.length ? "Fotoğraftan farklı yazılan alan var; fotoğraf kanıttır" : null;
  return {
    ...base,
    // Raporun kasası: "Raporu aç" o şubenin gününü açar
    branchId: report?.branchId ?? null,
    kind: "foto-kaldir",
    photoKind: p.photoKind,
    photo: photo && (photo.kind === "kasa-z" || photo.kind === "kasa-pos" || photo.kind === "kasa-okc") ? { id: photo.id, kind: photo.kind, createdAt: photo.createdAt.toISOString(), byName: photo.byName } : null,
    diffs: diffs.map((d) => photoDiffText(d)),
    refusal,
  };
}

/** `staffIds`: müdürde personelin kategorileri (yöneticinin kategorisindeki satır yalnız tutarıyla), yöneticide null */
async function cashOutCard(
  base: Omit<CardBase, "branchId">,
  p: ReturnType<typeof CashOutRequestPayload.parse>,
  thisMonth: string,
  now: Date,
  staffIds: ReadonlySet<number> | null,
): Promise<CashOutCard> {
  const db = getDb();
  const allCategories = staffIds === null;
  const day = p.day;
  // İsteğin kasası (yöneticinin seçimi değil): isteği açanın şubesi; eski isteklerde satırın şubesi, o da yoksa Tuzla
  const sube = p.branchId ?? (p.cashOutId !== null ? (await db.select({ b: s.cashOuts.branchId }).from(s.cashOuts).where(eq(s.cashOuts.id, p.cashOutId)).limit(1))[0]?.b : undefined) ?? DEFAULT_BRANCH_ID;
  const [lines, [report], dayOpen] = await Promise.all([
    cashOutsOn(day, sube),
    db
      .select({ cashDiff: s.cashReports.cashDiff, cashOut: s.cashReports.cashOut })
      .from(s.cashReports)
      .where(and(eq(s.cashReports.date, day), eq(s.cashReports.branchId, sube)))
      .limit(1),
    staffDayOpen(day, db, now, sube),
  ]);
  const current = p.cashOutId !== null ? (lines.find((l) => l.id === p.cashOutId) ?? null) : null;
  const rowGone = p.op !== "ekle" && !current;
  let expense: CashOutCard["expense"] = null;
  if (current && current.categoryId !== null) {
    const [cat] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.id, current.categoryId)).limit(1);
    const locked = staffExpenseLocked(cat);
    // Müdür yöneticinin kategorisinin adını görmez (kart "yöneticinin kategorisi" der); personelinkiler adıyla
    expense = { categoryName: locked && !allCategories ? null : current.categoryName, admin: locked };
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
  // Müdüre isteğin konusu yöneticinin kategorisindeki satırsa (şimdi ya da istendiği anda): satır, öneri ve değişiklikler
  // yalnız türü ve tutarıyla, fotoğrafı ve personelin notu yok (docs/ROLLER.md › Kararlar; Kasa sayfasındaki kuralla aynı)
  const ownerSubject = staffIds !== null && (expense?.admin === true || (p.before?.expense != null && !staffIds.has(p.before.expense.categoryId)));
  const shownLine = p.line && ownerSubject ? amountOnlyRow(p.line) : p.line;
  const shownBefore = p.before && ownerSubject ? amountOnlyRow(p.before) : p.before;
  // Olası tekrar: aynı tutar, ±1 gün (kasadan çıkan) ve ±7 gün (harcama kaydı); istenen satırın kendisi hariç. Müdüre
  // yalnız isteğin şubesinden ve personelin kategorisinden (öteki şubenin satırı, maaş ve kira kaydı gitmez)
  let duplicates: string[] = [];
  if (p.op === "ekle" && p.line) {
    const ref = p.line.receiptDate ?? day;
    const [outs, entries] = await Promise.all([
      db
        .select({
          id: s.cashOuts.id,
          date: s.cashOuts.date,
          receiptDate: s.cashOuts.receiptDate,
          amount: s.cashOuts.amount,
          store: s.cashOuts.store,
          description: s.cashOuts.description,
          kind: s.cashOuts.kind,
          categoryId: s.expenseEntries.categoryId,
        })
        .from(s.cashOuts)
        .leftJoin(s.expenseEntries, eq(s.expenseEntries.cashOutId, s.cashOuts.id))
        .where(and(gte(s.cashOuts.date, addDays(day, -1)), lte(s.cashOuts.date, addDays(day, 1)), allCategories ? undefined : eq(s.cashOuts.branchId, sube))),
      db
        .select({
          date: s.expenseEntries.date,
          amount: s.expenseEntries.amount,
          description: s.expenseEntries.description,
          cashOutId: s.expenseEntries.cashOutId,
          section: s.expenseCategories.section,
          panelGroup: s.expenseCategories.panelGroup,
          active: s.expenseCategories.active,
        })
        .from(s.expenseEntries)
        .innerJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
        .where(and(gte(s.expenseEntries.date, addDays(ref, -7)), lte(s.expenseEntries.date, addDays(ref, 7)), allCategories ? undefined : eq(s.expenseEntries.branchId, sube))),
    ]);
    const near = (a: number) => Math.abs(a - p.line!.amount) <= 0.01;
    duplicates = [
      // Müdüre yöneticinin kategorisindeki kasadan çıkan satırı gitmez (adı kişinin adı ve ücreti olabilir)
      ...outs
        .filter((o) => near(o.amount) && Math.abs(dayDiff(o.receiptDate ?? o.date, ref)) <= 1 && (staffIds === null || !ownerCategoryRow(o, staffIds)))
        .map((o) => `${cashOutLabel(o)} · ${money(o.amount)} · ${dayMonthTR(o.date)} · kasadan çıkan`),
      ...entries
        .filter((e) => e.cashOutId === null && near(e.amount) && (allCategories || staffCategory(e)))
        .map((e) => `${e.description ?? "Harcama"} · ${money(e.amount)} · ${dayMonthTR(e.date)} · harcama kaydı`),
    ].slice(0, 4);
  }
  const expenseDay = p.line && p.line.kind === "harcama" ? expenseDateFor(day, p.line.receiptDate) : null;
  return {
    ...base,
    // Personelin "Yöneticiye not"u: müdüre yöneticinin kategorisindeki satırın isteğinde gitmez (kararı yöneticinin)
    message: ownerSubject ? null : base.message,
    // Kartın okuduğu ve onayın yazdığı kasa
    branchId: sube,
    kind: "kasa-cikan",
    op: p.op,
    line: shownLine,
    before: shownBefore,
    changes: p.op === "duzelt" && shownBefore && shownLine ? lineChanges(shownBefore, shownLine) : [],
    changedSince: p.op !== "ekle" && !rowGone && changedSince,
    rowGone,
    expense,
    ownerDecides: !allCategories && expense?.admin === true,
    photoId: ownerSubject ? null : p.op === "ekle" ? (p.line?.photoId ?? null) : (current?.photoId ?? p.before?.photoId ?? null),
    defaults: {
      toExpenses: p.op === "ekle" ? (p.line ? staffToExpenses(p.line.kind, p.line.docType) : false) : current?.expenseEntryId != null,
      categoryId: p.op === "ekle" ? (p.line?.categoryId ?? null) : (current?.categoryId ?? null),
    },
    context: {
      report: report ? { cashDiff: report.cashDiff, cashOut: report.cashOut } : null,
      // Müdüre yöneticinin kategorisindeki satır adsız ve fişsiz (ownerRowsAmountOnly): "Harcama · Ali · 5.000 ₺"
      lines: (staffIds ? ownerRowsAmountOnly(lines, staffIds) : lines).map((l) => ({
        id: l.id,
        label: cashOutLabel(l),
        amount: l.amount,
        by: l.createdByName,
        photo: l.photoId !== null,
        subject: l.id === p.cashOutId,
      })),
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

/**
 * Yöneticinin zilinde bekleyen kasadan çıkan ve fotoğraf kaldırma istekleri: tek satır ("3 kasa isteği onay bekliyor").
 * `scope`: tek şube seçiliyken yalnız o şubenin istekleri (şube kapsamı C P1-1; `requestBranches`)
 */
export async function cashOutBellRow(now = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<{ id: string; count: number; firstId: number; oldestAt: Date; text: string } | null> {
  const db = getDb();
  const rows = await db
    .select({ id: r.id, kind: r.kind, subject: r.subject, payload: r.payload, title: r.title, bumpedAt: r.bumpedAt, createdAt: r.createdAt, requestedByName: r.requestedByName })
    .from(r)
    .where(and(eq(r.status, "pending"), inArray(r.kind, ["kasa-cikan", "foto-kaldir"]), or(isNull(r.expiresAt), gt(r.expiresAt, now))))
    .orderBy(asc(r.createdAt));
  const branchOf = scope === ALL_BRANCHES || !rows.length ? null : await requestBranches(db, rows);
  const live = branchOf ? rows.filter((x) => requestInScope(branchOf.get(x.id) ?? null, scope)) : rows;
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
