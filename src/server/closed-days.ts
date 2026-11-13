import "server-only";

import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import type { DayFacts } from "@/app/panel/bugun/logic";
import { cashBranchLabel, DEFAULT_BRANCH_ID } from "@/lib/branches";
import { businessDate, DAY_TURN_HOUR } from "@/lib/cash-report";
import { requestBranch, subjectBranch } from "@/lib/cash-requests";
import {
  CLOSED_TEXT,
  ClosedDayPayload,
  closedDaysIn,
  closedSpecialTitle,
  EMPTY_EVIDENCE,
  isEvidenceAction,
  openingText,
  zGapOf,
  type ClosedEvidence,
} from "@/lib/closed-days";
import { readLafposSwitchDay } from "@/lib/constants";
import { posZSchema, type PosDayZ } from "@/lib/lafpos/day";
import type { KasaName } from "@/lib/lafpos/kasa";
import { isLafposDay, kasaName, LAFPOS_SWITCH_KEY } from "@/lib/lafpos/switch";
import { addDays, longDateTR } from "@/lib/reminders";
import type { CurrentUser } from "@/server/auth/dal";
import { currentWriteBranch } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

/*
 * Kapalı gün (plan docs/planlar/personel-yetki.md §2.9; docs/KASA-RAPORU.md › Kafe kapalıydı): Dalga 9'un özel
 * günlerindeki `kapali` satırı ve personelin "Dün kafe kapalıydı" bildirimi (staff_requests, tür `kapali-gun`). Kapalı
 * günlerin okuyucuları (geç rapor, eksik günler, ay bilgisi, komisyon), personelin kapalı güne yazamaması
 * (closedDayRefusal; kasadan çıkan ve zayi), günün kanıtı (closedDayEvidence), raporun gelişiyle işaretin kalkması
 * (onReportSaved, onNextReport) ve Bugün'ün olgusu (closedYesterday). Bir `kapali` satırı yalnız yöneticinin yazımıdır
 * (Satış tahmini, Kasa'daki "Kafe kapalıydı", bildirimin onayı): satırın varlığı onaydır.
 *
 * Şube (denetim KP-05; docs/SUBE.md): kasa raporu şube başına, kapalı gün de. Kasa'nın "Kafe kapalıydı"sı ve bildirimin
 * onayı raporun şubesini yazar; şubesi boş satır işletme genelidir (Satış tahmini, bayram) ve her şubede kapalı sayılır.
 * Şube verilen okuyucular o şubenin ve işletme genelinin satırlarına, kanıt ve Z boşluğu o şubenin kayıtlarına bakar;
 * şube verilmezse ("Tümü", işletme geneli ekranlar) bütün satırlar. Kontrol listesi, karaoke ve personelin işlem geçmişi
 * şubesiz kayıtlardır: kanıtta işletme geneli kalır.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Şubenin kapalı satırları: kendi satırları ve işletme geneli (şubesi boş); şube verilmezse hepsi */
const closedBranchWhere = (branchId?: string) => (branchId ? or(eq(s.specialDays.branchId, branchId), isNull(s.specialDays.branchId)) : undefined);

/**
 * Kapalı işaretli günler (özel günlerin `kapali` satırları), [from, to] içinde, artan sırayla, tekrarsız. `branchId`
 * verilirse o şubenin ve işletme genelinin satırları (öteki şubenin kapalı günü bu şubenin günü değil)
 */
export async function closedDaysBetween(from: string, to: string, db: Db | Tx = getDb(), branchId?: string): Promise<string[]> {
  if (from > to) return [];
  const rows = await db
    .select({ kind: s.specialDays.kind, dateFrom: s.specialDays.dateFrom, dateTo: s.specialDays.dateTo })
    .from(s.specialDays)
    .where(and(eq(s.specialDays.kind, "kapali"), lte(s.specialDays.dateFrom, to), gte(s.specialDays.dateTo, from), closedBranchWhere(branchId)));
  return closedDaysIn(rows, from, to);
}

/** Bu gün kapalı işaretli mi (tek gün; `branchId` verilirse o şube için) */
export async function isClosedDay(day: string, db: Db | Tx = getDb(), branchId?: string): Promise<boolean> {
  return (await closedDaysBetween(day, day, db, branchId)).length > 0;
}

/**
 * Personelin yazımı (kasadan çıkan, zayi / ikram) kapalı işaretli güne düşüyorsa nedeni; yönetici ve açık gün null.
 * Kapalı satırı yalnız yöneticinin yazımıdır (onaylı). `branchId`: yazımın şubesi (öteki şubenin kapalı günü engellemez)
 */
export async function closedDayRefusal(date: string, role: "admin" | "staff", db: Db | Tx = getDb(), branchId?: string): Promise<string | null> {
  if (role === "admin") return null;
  return (await isClosedDay(date, db, branchId)) ? CLOSED_TEXT.refusal : null;
}

/**
 * Bir günün kapalı gün bildirimleri ve kararları aynı anda açılmasın (iki personel aynı dün için; onay ile LafPOS'un
 * gün sonu): `kapali-gun:<gün>` danışma kilidi, işlemin sonuna kadar
 */
export async function lockClosedDay(tx: Tx, date: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kapali-gun:${date}`}))`);
}

/**
 * Günün LafPOS gün sonu, yalnız LafPOS gününde (geçiş günü seçili ve gün ondan önce değil; src/lib/lafpos/switch.ts):
 * Z no, fiş sayısı ve Z toplamı. Geçiş günü boşken ya da önceki günde null (deneme günü kanıt değil). İşlem içinden de
 */
async function lafposEvidence(db: Db | Tx, date: string, branchId?: string): Promise<ClosedEvidence["lafpos"]> {
  const [setting] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1);
  if (!isLafposDay(date, readLafposSwitchDay(setting?.value))) return null;
  const [row] = await db
    .select({ z: s.posDayReports.z })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), branchId ? eq(s.posDayReports.branchId, branchId) : undefined))
    .limit(1);
  const z = row ? posZSchema.safeParse(row.z) : null;
  return z?.success ? { zNo: z.data.zNo, receipts: z.data.receipts, zTotal: z.data.zTotal } : null;
}

/** İş gününün penceresi: [D 05:00, D+1 05:00), Türkiye */
export function dayWindow(date: string): { from: Date; to: Date } {
  const hh = String(DAY_TURN_HOUR).padStart(2, "0");
  return { from: new Date(`${date}T${hh}:00:00+03:00`), to: new Date(`${addDays(date, 1)}T${hh}:00:00+03:00`) };
}

/** Günü kapsayan `kapali` satırları (`branchId` verilirse o şubenin ve işletme genelinin) */
async function coveringRows(db: Db | Tx, date: string, branchId?: string) {
  return db
    .select()
    .from(s.specialDays)
    .where(and(eq(s.specialDays.kind, "kapali"), lte(s.specialDays.dateFrom, date), gte(s.specialDays.dateTo, date), closedBranchWhere(branchId)))
    .orderBy(asc(s.specialDays.id));
}

/** Kapalı gün bildirimleri bu şubenin mi (yükte ya da konuda; şubeden önceki bildirim Tuzla'nın) */
const ofBranch = (branchId: string) => (r: { subject: string; payload: unknown }) => requestBranch(r) === branchId;

/**
 * Bir günün paneldeki izleri (tutar yok): kasa raporu, LafPOS'un gün sonu (yalnız LafPOS günlerinde; E-36), kasadan
 * çıkan, zayi / ikram, açılan kontrol listesi, karaoke (iş günü penceresinde başlayan, iptal edilmemiş), personelin
 * işlem geçmişi yazımları (aynı pencerede; hesap ve hatırlatıcı hariç, silme kayıtları dahil), Z no sürekliliği ve
 * açılış sürekliliği. Site ayrı (siteDayCounts). `branchId` verilirse rapor, LafPOS, kasadan çıkan, zayi, Z no ve
 * açılış sürekliliği o şubenin kayıtlarından (denetim KP-05: Marina'nın raporu Tuzla'nın kapalı günü için kanıt değil);
 * kontrol listesi, karaoke ve işlem geçmişi şubesiz kayıtlardır, işletme genelinden sayılır
 */
export async function closedDayEvidence(db: Db | Tx, date: string, branchId?: string): Promise<ClosedEvidence> {
  const w = dayWindow(date);
  const own = (col: typeof s.cashReports.branchId | typeof s.cashOuts.branchId | typeof s.wasteEntries.branchId) => (branchId ? eq(col, branchId) : undefined);
  const [[report], [outs], [waste], [lists], [karaoke], logs, [prev], [next], lafpos] = await Promise.all([
    db
      .select({ id: s.cashReports.id })
      .from(s.cashReports)
      .where(and(eq(s.cashReports.date, date), own(s.cashReports.branchId)))
      .limit(1),
    db
      .select({ n: count() })
      .from(s.cashOuts)
      .where(and(eq(s.cashOuts.date, date), own(s.cashOuts.branchId))),
    db
      .select({ n: count() })
      .from(s.wasteEntries)
      .where(and(eq(s.wasteEntries.date, date), own(s.wasteEntries.branchId))),
    db.select({ n: count() }).from(s.checklistRuns).where(eq(s.checklistRuns.date, date)),
    db
      .select({ n: count() })
      .from(s.karaokeSessions)
      .where(and(gte(s.karaokeSessions.startsAt, w.from), lt(s.karaokeSessions.startsAt, w.to), ne(s.karaokeSessions.status, "cancelled"))),
    db
      .select({ action: s.activityLog.action })
      .from(s.activityLog)
      .innerJoin(s.users, eq(s.users.id, s.activityLog.userId))
      .where(and(gte(s.activityLog.at, w.from), lt(s.activityLog.at, w.to), eq(s.users.role, "staff"))),
    db
      .select({ date: s.cashReports.date, zNo: s.cashReports.zNo, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
      .from(s.cashReports)
      .where(and(lt(s.cashReports.date, date), own(s.cashReports.branchId)))
      .orderBy(desc(s.cashReports.date))
      .limit(1),
    db
      .select({ date: s.cashReports.date, zNo: s.cashReports.zNo, opening: s.cashReports.openingCash })
      .from(s.cashReports)
      .where(and(gt(s.cashReports.date, date), own(s.cashReports.branchId)))
      .orderBy(asc(s.cashReports.date))
      .limit(1),
    lafposEvidence(db, date, branchId),
  ]);
  // Z boşluğu: arada (önceki ile sonraki rapor arasında) bu günden başka raporsuz ve kapalı işaretsiz kaç gün var
  let others = 0;
  if (prev && next) {
    const shut = new Set(await closedDaysBetween(addDays(prev.date, 1), addDays(next.date, -1), db, branchId));
    for (let d = addDays(prev.date, 1); d < next.date; d = addDays(d, 1)) if (d !== date && !shut.has(d)) others++;
  }
  return {
    report: Boolean(report),
    cashOuts: outs?.n ?? 0,
    waste: waste?.n ?? 0,
    checklists: lists?.n ?? 0,
    karaoke: karaoke?.n ?? 0,
    staffWrites: logs.filter((l) => isEvidenceAction(l.action)).length,
    zGap: zGapOf(date, prev ?? null, next ?? null, others),
    opening: openingText(prev ? { date: prev.date, carry: Math.round((prev.counted - prev.handed) * 100) / 100 } : null, next ? { date: next.date, opening: next.opening } : null),
    lafpos,
  };
}

/** İşlem geçmişine (işlemin içinde; sistemin ya da yazanın adıyla) */
async function logIn(tx: Tx, who: { id: number | null; name: string } | null, action: string, detail: string) {
  await tx.insert(s.activityLog).values({ userName: who?.name ?? "Sistem", userId: who?.id ?? null, action, detail: detail.slice(0, 500) });
}

/** Satırı onaylayan isteği kaldırıldı yapar (`revoked`, not personele görünür) */
async function revokeFor(tx: Tx, specialId: number, note: string, now: Date) {
  await tx
    .update(s.staffRequests)
    .set({ status: "revoked", reviewNote: note, updatedAt: now })
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "approved"), eq(s.staffRequests.resultId, specialId)));
}

/**
 * Kapalı satırı silinince (Satış tahmini'nde yönetici sildi ya da kanıt geldi): onu onaylayan istek `revoked` olur,
 * uyarılar geri gelir. Satış tahmini'nin silme eylemi çağırır.
 */
export async function revokeClosedRequests(tx: Tx, specialId: number, note: string, now = new Date()): Promise<void> {
  await revokeFor(tx, specialId, note, now);
}

/** Özel günlerin danışma kilidi: yönetici ve personel yazımları sıraya girer (çakışma ve sınırlar yarışmaz) */
export async function lockSpecialDays(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ozel-gun'))`);
}

/**
 * Günü şube için kapalı işaretler (yönetici; işlemin içinde, danışma kilidi altında): günü kapsayan, bu şubenin ya da
 * işletme genelinin `kapali` satırı yoksa şubenin tek günlük satırı yazılır, `createdBy` yazan yönetici. Varsa onun
 * kimliği döner (`created` false).
 */
export async function writeClosedDay(tx: Tx, admin: { id: number; name: string }, date: string, reason: string | null, branchId: string): Promise<{ id: number; created: boolean }> {
  await lockSpecialDays(tx);
  const [have] = await coveringRows(tx, date, branchId);
  if (have) return { id: have.id, created: false };
  const [row] = await tx
    .insert(s.specialDays)
    .values({ dateFrom: date, dateTo: date, kind: "kapali", title: closedSpecialTitle(reason), effect: -1, note: null, createdBy: admin.id, createdByName: admin.name, branchId })
    .returning({ id: s.specialDays.id });
  return { id: row.id, created: true };
}

/** Kapalı işaret kanıtla kalktı: tek günlük satır silinir, onu onaylayan istek `revoked` olur, işlem geçmişine yazılır */
async function dropClosedMark(tx: Tx, row: { id: number; dateFrom: string; dateTo: string }, why: string, now: Date) {
  await tx.delete(s.specialDays).where(eq(s.specialDays.id, row.id));
  await revokeFor(tx, row.id, why, now);
  await logIn(tx, null, "Kapalı gün işareti kaldırıldı (kanıt geldi)", `${longDateTR(row.dateFrom)} · ${why}`);
}

/** Şubenin bu günkü bekleyen kapalı gün bildirimleri kapanır (öteki şubeninkiler bekler) */
async function supersedeClosedRequests(tx: Tx, date: string, branchId: string, note: string, now: Date): Promise<void> {
  const pending = await tx
    .select({ id: s.staffRequests.id, subject: s.staffRequests.subject, payload: s.staffRequests.payload })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "pending"), eq(s.staffRequests.day, date)));
  const ids = pending.filter(ofBranch(branchId)).map((r) => r.id);
  if (!ids.length) return;
  await tx.update(s.staffRequests).set({ status: "superseded", reviewNote: note, reviewedAt: now, updatedAt: now }).where(inArray(s.staffRequests.id, ids));
}

/**
 * Bir şubenin bir günkü raporu ilk kez girildi (writeCashReport, işlemin içinde): o şubenin aynı günkü bekleyen kapalı
 * gün bildirimi kapanır ("Kasa raporu girildi"). Günü kapsayan, şubenin ya da işletme genelinin tek günlük kapalı satırı
 * silinir (istek `revoked`, yöneticinin zilinde); çok günlük aralıkta yalnız zil: "Kapalı aralığın içindeki 3 Kas'a
 * rapor girildi; …". Öteki şubenin işaretine ve bildirimine dokunulmaz (denetim KP-05).
 */
export async function onReportSaved(tx: Tx, date: string, branchId: string, now = new Date()): Promise<void> {
  await supersedeClosedRequests(tx, date, branchId, "Kasa raporu girildi", now);
  for (const row of await coveringRows(tx, date, branchId)) {
    if (row.dateFrom === row.dateTo) await dropClosedMark(tx, row, "kasa raporu girildi", now);
    else await logIn(tx, null, "Kapalı aralığa rapor girildi", `Kapalı aralığın içindeki ${longDateTR(date)} gününe rapor girildi; Satış tahmini › Özel günler'den aralığı düzeltin`);
  }
}

/**
 * LafPOS'un satışlı gün sonu geldi (storePosDay, aynı işlemde; denetim E-36): gün LafPOS günüyse (geçiş günü seçili ve
 * gün ondan önce değil) kasa raporunun gelişi gibi: aynı günün bekleyen kapalı gün bildirimi kapanır, günü kapsayan tek
 * günlük kapalı satırı silinir (onaylayan istek `revoked`, yöneticinin zilinde "kanıt geldi"); çok günlük aralıkta
 * yalnız zil. Geçiş günü boşken, gün ondan önceyse ya da gün sonunda satış yoksa (fiş ve Z toplamı 0) hiçbir şey
 * yapılmaz: deneme günü hiçbir kaydı değiştirmez (sahibin 26 Ekim kararı). Bildirimin onayıyla yarışmasın diye günün
 * kapalı gün kilidi alınır (onay kanıtı bu kilidin altında sayar). `soldSince`: aynı günün satışlı gün sonu daha önce
 * bu anda geldi (yeniden gönderim, düzeltme); o andan sonra konan kapalı satırı yöneticinin kanıtı görerek verdiği
 * karardır, dokunulmaz (yalnız ondan önce konan, yani kanıt gelince kalkması gereken satır kalkar).
 */
export async function onLafposDaySaved(
  tx: Tx,
  date: string,
  z: Pick<PosDayZ, "zNo" | "receipts" | "zTotal">,
  now = new Date(),
  soldSince: Date | null = null,
  branchId: string = DEFAULT_BRANCH_ID,
): Promise<void> {
  if (z.receipts <= 0 && z.zTotal <= 0) return;
  const [setting] = await tx.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1);
  if (!isLafposDay(date, readLafposSwitchDay(setting?.value))) return;
  await lockClosedDay(tx, date);
  const why = `LafPOS gün sonu geldi (Z ${z.zNo}${z.receipts > 0 ? ` · ${z.receipts} fiş` : ""})`;
  await supersedeClosedRequests(tx, date, branchId, why, now);
  for (const row of await coveringRows(tx, date, branchId)) {
    if (soldSince && row.createdAt >= soldSince) continue;
    if (row.dateFrom === row.dateTo) await dropClosedMark(tx, row, why, now);
    else await logIn(tx, null, "Kapalı aralığa rapor girildi", `Kapalı aralığın içindeki ${longDateTR(date)} günü için ${why}; Satış tahmini › Özel günler'den aralığı düzeltin`);
  }
}

/**
 * Sonraki günün raporu girildi (writeCashReport, işlemin içinde): önceki gün raporun şubesi için kapalı işaretliyse Z no
 * sürekliliği aynı şubenin raporlarıyla denetlenir (denetim KP-05: iki şubenin Z no'ları karışmaz). O güne bir Z
 * düşmüşse (boşluk, arada başka raporsuz gün yok) tek günlük işaret kalkar; açılış devirle tutmuyorsa yalnız zil
 * (işlem geçmişi).
 */
export async function onNextReport(tx: Tx, report: { date: string; zNo: string | null; openingCash: number; branchId: string }, now = new Date()): Promise<void> {
  const day = addDays(report.date, -1);
  const rows = await coveringRows(tx, day, report.branchId);
  if (!rows.length) return;
  const [prev] = await tx
    .select({ date: s.cashReports.date, zNo: s.cashReports.zNo, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
    .from(s.cashReports)
    .where(and(lt(s.cashReports.date, day), eq(s.cashReports.branchId, report.branchId)))
    .orderBy(desc(s.cashReports.date))
    .limit(1);
  if (!prev) return;
  // Önceki rapor ile bu gün arasındaki öteki raporsuz, kapalı işaretsiz günler
  const shut = new Set(await closedDaysBetween(addDays(prev.date, 1), addDays(day, -1), tx, report.branchId));
  let others = 0;
  for (let d = addDays(prev.date, 1); d < day; d = addDays(d, 1)) if (!shut.has(d)) others++;
  const gap = zGapOf(day, prev, { date: report.date, zNo: report.zNo }, others);
  if (gap?.level === "red") {
    for (const row of rows) {
      if (row.dateFrom === row.dateTo) await dropClosedMark(tx, row, `Z no boşluğu: ${gap.text}`, now);
      else await logIn(tx, null, "Kapalı aralığa rapor girildi", `${longDateTR(day)} kapalı işaretli ama ${gap.text}; Satış tahmini › Özel günler'den aralığı düzeltin`);
    }
    return;
  }
  const opening = openingText({ date: prev.date, carry: Math.round((prev.counted - prev.handed) * 100) / 100 }, { date: report.date, opening: report.openingCash });
  if (opening && !opening.ok) await logIn(tx, null, "Kapalı gün: açılış devirle tutmuyor", `${longDateTR(day)} kapalı işaretli; ${opening.text}`);
}

// ---------------------------------------------------------------- Okuyucular

/** Kapalı gün bildirimlerinin sabit sütunları (yük yalnız tarih, neden ve şube; tutar yok) */
const requestCols = {
  id: s.staffRequests.id,
  day: s.staffRequests.day,
  subject: s.staffRequests.subject,
  status: s.staffRequests.status,
  version: s.staffRequests.version,
  payload: s.staffRequests.payload,
  requestedBy: s.staffRequests.requestedBy,
  requestedByName: s.staffRequests.requestedByName,
  reviewNote: s.staffRequests.reviewNote,
  reviewedByName: s.staffRequests.reviewedByName,
  createdAt: s.staffRequests.createdAt,
  updatedAt: s.staffRequests.updatedAt,
};

/**
 * Bugün'ün olgusu: dün kafe kapalı mıydı (onaylı satır, bekleyen ya da reddedilen bildirim); yoksa `yesterday` null.
 * Kasa formunun şubesi için ("Tümü"de Tuzla; Bugün'ün dünkü kasa satırı da onun)
 */
export async function closedYesterday(user: CurrentUser, now: Date): Promise<DayFacts["closed"]> {
  void user;
  const y = addDays(businessDate(now), -1);
  const db = getDb();
  const branchId = await currentWriteBranch();
  const [rows, reqs] = await Promise.all([
    coveringRows(db, y, branchId),
    db
      .select(requestCols)
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.day, y), ne(s.staffRequests.status, "withdrawn")))
      .orderBy(desc(s.staffRequests.createdAt))
      .then((list) => list.filter(ofBranch(branchId))),
  ]);
  if (rows.length) {
    const approved = reqs.find((r) => r.status === "approved");
    return { yesterday: { state: "approved", by: approved?.requestedByName ?? rows[0].createdByName, requestId: approved?.id ?? null } };
  }
  const pending = reqs.find((r) => r.status === "pending");
  if (pending) return { yesterday: { state: "pending", by: pending.requestedByName, requestId: pending.id } };
  const last = reqs[0];
  if (last?.status === "rejected") return { yesterday: { state: "rejected", by: last.requestedByName, requestId: last.id, note: last.reviewNote } };
  return { yesterday: null };
}

/** Personelin kasa sayfası: dünün kapalı gün durumu ve "Kafe kapalıydı" düğmesi görünür mü */
export interface StaffClosedState {
  /** Bekleyen bildirim (kimin olursa): ad ve kişinin kendisininse kimlik ("Geri çek") */
  pending: { id: number; by: string; mine: boolean } | null;
  /** Reddedildi (yöneticinin notu; bütün personele görünür) */
  rejected: { note: string | null } | null;
  /** Düğme görünür: bekleyen ya da reddedilen yok, kişinin son 30 günde 3'ten az bildirimi var */
  canAsk: boolean;
}

/** `branchId`: formun şubesi; yalnız o şubenin bildirimleri (öteki şubenin bildirimi bu şubenin düğmesini kapatmaz) */
export async function staffClosedState(date: string, me: { id: number }, branchId: string, now = new Date()): Promise<StaffClosedState> {
  const db = getDb();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [reqs, [mine]] = await Promise.all([
    db
      .select({ id: s.staffRequests.id, subject: s.staffRequests.subject, status: s.staffRequests.status, requestedBy: s.staffRequests.requestedBy, requestedByName: s.staffRequests.requestedByName, reviewNote: s.staffRequests.reviewNote })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.day, date), inArray(s.staffRequests.status, ["pending", "rejected"])))
      .orderBy(desc(s.staffRequests.createdAt))
      .then((list) => list.filter((r) => subjectBranch(r.subject) === branchId)),
    db
      .select({ n: count() })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.requestedBy, me.id), ne(s.staffRequests.status, "withdrawn"), gte(s.staffRequests.createdAt, since))),
  ]);
  const p = reqs.find((r) => r.status === "pending");
  const r = reqs.find((x) => x.status === "rejected");
  return {
    pending: p ? { id: p.id, by: p.requestedByName, mine: p.requestedBy === me.id } : null,
    rejected: r ? { note: r.reviewNote } : null,
    canAsk: !p && !r && (mine?.n ?? 0) < 3,
  };
}

/** "Kapalı gün bildirimlerim" (/panel/ozel-gunler#bildirimlerim): kişinin son 30 günün bildirimleri; tarih, durum, not */
export async function ownClosedRequests(me: { id: number }, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await getDb()
    .select({ id: s.staffRequests.id, day: s.staffRequests.day, status: s.staffRequests.status, reviewNote: s.staffRequests.reviewNote, createdAt: s.staffRequests.createdAt })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.requestedBy, me.id), gte(s.staffRequests.createdAt, since)))
    .orderBy(desc(s.staffRequests.createdAt));
  return rows.flatMap((r) => (r.day ? [{ id: r.id, day: r.day, status: r.status, reviewNote: r.reviewNote, createdAt: r.createdAt.toISOString() }] : []));
}

/** Yöneticinin kartı: bekleyen bildirim, günün kanıtı (canlı), üst üste günlerin grubu */
export interface ClosedDayCard {
  kind: "kapali-gun";
  id: number;
  version: number;
  date: string;
  requestedByName: string;
  createdAt: string;
  message: string | null;
  reason: string | null;
  /** Bildirilen şube, birden çok şube açıkken adı (cashBranchLabel); kanıt o şubenin kayıtlarından */
  branch: string | null;
  evidence: ClosedEvidence;
  /** Aynı kişinin ya da başkasının üst üste kapalı bildirdiği / işaretli günlerle birlikte kaç gün */
  run: { from: string; to: string; days: number } | null;
  /** Günün kasası (denetim E-39): "Onaylamadan önce o günün ModPOS / banka POS'una bakın" */
  kasa: KasaName;
}

/** Bekleyen kapalı gün bildirimlerinin kartları (yalnız yönetici; loadCashRequestQueue toplar) */
export async function closedDayCards(): Promise<ClosedDayCard[]> {
  const db = getDb();
  const rows = await db
    .select({ ...requestCols, message: s.staffRequests.message })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "pending"), isNotNull(s.staffRequests.day)))
    .orderBy(asc(s.staffRequests.day), asc(s.staffRequests.createdAt));
  if (!rows.length) return [];
  const days = rows.map((r) => r.day!);
  const from = addDays(days[0], -7);
  const to = addDays(days[days.length - 1], 7);
  // Üst üste günler: bekleyen bildirimler ve zaten kapalı işaretli günler birlikte
  const [marked, [setting], branches] = await Promise.all([
    closedDaysBetween(from, to, db),
    db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1),
    listBranches(db),
  ]);
  const switchDay = readLafposSwitchDay(setting?.value);
  const all = new Set([...days, ...marked]);
  const runOf = (d: string) => {
    let a = d;
    let b = d;
    while (all.has(addDays(a, -1))) a = addDays(a, -1);
    while (all.has(addDays(b, 1))) b = addDays(b, 1);
    return a === b ? null : { from: a, to: b, days: [...all].filter((x) => x >= a && x <= b).length };
  };
  const out: ClosedDayCard[] = [];
  for (const r of rows) {
    const p = ClosedDayPayload.safeParse(r.payload);
    const branchId = requestBranch(r);
    out.push({
      kind: "kapali-gun",
      id: r.id,
      version: r.version,
      date: r.day!,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt.toISOString(),
      message: r.message,
      reason: p.success ? p.data.reason : null,
      branch: cashBranchLabel(branchId, branches),
      evidence: await closedDayEvidence(db, r.day!, branchId).catch(() => EMPTY_EVIDENCE),
      run: runOf(r.day!),
      kasa: kasaName(r.day!, switchDay),
    });
  }
  return out;
}

// ---------------------------------------------------------------- Zil (yönetici)

/** Bekleyen kapalı gün bildirimleri (yöneticinin zili; tutar yok) */
export async function pendingClosedRows(): Promise<{ id: number; day: string; requestedByName: string; bumpedAt: Date; createdAt: Date }[]> {
  const rows = await getDb()
    .select({ id: s.staffRequests.id, day: s.staffRequests.day, requestedByName: s.staffRequests.requestedByName, bumpedAt: s.staffRequests.bumpedAt, createdAt: s.staffRequests.createdAt })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "pending"), isNotNull(s.staffRequests.day)))
    .orderBy(asc(s.staffRequests.createdAt));
  return rows.map((r) => ({ ...r, day: r.day! }));
}

/** Kapalı işaretin kanıtla kalkması, kapalı aralığa gelen rapor ve açılış uyarısı (işlem geçmişinden; yöneticinin zili) */
export const CLOSED_BELL_ACTIONS = ["Kapalı gün işareti kaldırıldı (kanıt geldi)", "Kapalı aralığa rapor girildi", "Kapalı gün: açılış devirle tutmuyor"] as const;

/**
 * Yöneticinin bilgi zili: son günlerin kapalı gün olayları ve personelin özel gün eklemeleri, düzeltmeleri ve silmeleri
 * ("Ahmet özel gün ekledi: 25 Eki · Derbi · +%15")
 */
export async function closedInfoRows(since: Date): Promise<{ id: number; at: Date; userName: string | null; action: string; detail: string | null; staff: boolean }[]> {
  const rows = await getDb()
    .select({ id: s.activityLog.id, at: s.activityLog.at, userName: s.activityLog.userName, action: s.activityLog.action, detail: s.activityLog.detail, role: s.users.role })
    .from(s.activityLog)
    .leftJoin(s.users, eq(s.users.id, s.activityLog.userId))
    .where(and(gte(s.activityLog.at, since), sql`(${s.activityLog.action} in (${sql.join(CLOSED_BELL_ACTIONS.map((a) => sql`${a}`), sql`, `)}) or (${s.activityLog.action} like 'Özel gün%' and ${s.users.role} = 'staff'))`))
    .orderBy(desc(s.activityLog.at))
    .limit(10);
  return rows.map((r) => ({ id: r.id, at: r.at, userName: r.userName, action: r.action, detail: r.detail, staff: r.role === "staff" }));
}
