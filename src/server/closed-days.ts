import "server-only";

import { and, asc, count, desc, eq, gt, gte, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import type { DayFacts } from "@/app/panel/bugun/logic";
import { businessDate, DAY_TURN_HOUR } from "@/lib/cash-report";
import { cashDaySubject } from "@/lib/cash-requests";
import { ALL_BRANCHES, type BranchScope, KARAOKE_BRANCH_ID, requestInScope } from "@/lib/branches";
import {
  branchChecklistRuns,
  branchStaffWrites,
  CLOSED_TEXT,
  ClosedDayPayload,
  closedDaysIn,
  closedMarksOf,
  closedRequestBranch,
  closedSpecialTitle,
  EMPTY_EVIDENCE,
  isEvidenceAction,
  mergeBranchContinuity,
  openingText,
  zGapOf,
  type ClosedEvidence,
  type ClosedMarks,
} from "@/lib/closed-days";
import { readLafposSwitchDay } from "@/lib/constants";
import { DESK_BLOCK_CHANNEL } from "@/lib/karaoke/session";
import { posZSchema, type PosDayZ } from "@/lib/lafpos/day";
import type { KasaName } from "@/lib/lafpos/kasa";
import { branchSwitchDay, isLafposDay, kasaName, LAFPOS_BRANCH_ID, LAFPOS_SWITCH_KEY } from "@/lib/lafpos/switch";
import { addDays, longDateTR } from "@/lib/reminders";
import type { StaffRequestStatus } from "@/lib/staff-requests";
import type { CurrentUser } from "@/server/auth/dal";
import { currentTillBranch } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";
import { currentVia } from "@/server/activity-via";

/*
 * Kapalı gün (plan docs/planlar/personel-yetki.md §2.9; docs/KASA-RAPORU.md › Kafe kapalıydı): Dalga 9'un özel
 * günlerindeki `kapali` satırı ve personelin "Dün kafe kapalıydı" bildirimi (staff_requests, tür `kapali-gun`). Kapalı
 * günlerin okuyucuları (geç rapor, eksik günler, ay bilgisi, komisyon), personelin kapalı güne yazamaması
 * (closedDayRefusal; kasadan çıkan ve zayi), günün kanıtı (closedDayEvidence), raporun gelişiyle işaretin kalkması
 * (onReportSaved, onNextReport) ve Bugün'ün olgusu (closedYesterday). Bir `kapali` satırı yalnız yöneticinin yazımıdır
 * (Satış tahmini, Kasa'daki "Kafe kapalıydı", bildirimin onayı): satırın varlığı onaydır.
 *
 * Şube (denetim 13 Kasım KP-05; docs/SUBE.md › Kapalı gün): kasa raporu şube başına, kapalı gün de. Kasa'daki "Kafe
 * kapalıydı" ve bildirimin onayı kasanın şubesini yazar (`special_days.branch_id`); şubesi boş satır işletme genelidir
 * (Özel günler'de "Bütün şubeler", eski satırlar) ve her şubede kapalı sayılır. Şube verilen okuyucular o şubenin ve
 * işletme genelinin satırlarına, kanıt o şubenin kayıtlarına bakar: Marina'nın raporu Tuzla'nın işaretini kaldırmaz,
 * Tuzla'nın bildirimini engellemez. Şube verilmezse (işletme geneli okuma) bütün satırlar. Bir şubenin kanıtı işletme
 * geneli tek günlük satırı yalnız o şube için kaldırır: satır öteki açık fiziksel şubelere şubeli kalır (clearClosedMark).
 * Birden çok kasa açıkken kontrol listesi ve işlem geçmişi şubeyi kayıttan değil şablondan ve kişiden alır: şubenin listesi
 * ve şubenin personeli kanıttır, bütün şubelerin listesi ve şubesiz personel yalnız uyarıdır (`sharedTraces`), öbür
 * şubeninki sayılmaz; karaoke yalnız karaokenin şubesinde (KARAOKE_BRANCH_ID) sayılır. Tek kasada hepsi o kasanındır.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Şubenin kapalı satırları: kendi satırları ve işletme geneli (şubesi boş); şube verilmezse hepsi */
const closedBranchWhere = (branchId?: string | null) => (branchId ? or(eq(s.specialDays.branchId, branchId), isNull(s.specialDays.branchId)) : undefined);

/**
 * Kapalı işaretli günler (özel günlerin `kapali` satırları), [from, to] içinde, artan sırayla, tekrarsız. `branchId`
 * verilirse o şubenin ve işletme genelinin satırları (öteki şubenin kapalı günü bu şubenin günü değil)
 */
export async function closedDaysBetween(from: string, to: string, db: Db | Tx = getDb(), branchId?: string | null): Promise<string[]> {
  if (from > to) return [];
  const rows = await db
    .select({ kind: s.specialDays.kind, dateFrom: s.specialDays.dateFrom, dateTo: s.specialDays.dateTo })
    .from(s.specialDays)
    .where(and(eq(s.specialDays.kind, "kapali"), lte(s.specialDays.dateFrom, to), gte(s.specialDays.dateTo, from), closedBranchWhere(branchId)));
  return closedDaysIn(rows, from, to);
}

/** Bu gün kapalı işaretli mi (tek gün; `branchId` verilirse o şube için) */
export async function isClosedDay(day: string, db: Db | Tx = getDb(), branchId?: string | null): Promise<boolean> {
  return (await closedDaysBetween(day, day, db, branchId)).length > 0;
}

/**
 * Günün kapalı işaretleri: işletme geneli satır (`all`), kendi satırı olan şubeler (`branches`) ve o gün açık fiziksel
 * şubeler (`open`; closedMarksOf). Şubeli kayıtların (kontrol listesi) hatırlatmaları, zili ve sabah e-postası bununla
 * süzülür (src/lib/closed-days.ts › closedForBranch): listenin şubesi o gün kapalıysa ya da işletme kapalıysa beklenmez
 */
export async function closedMarksOn(day: string, db: Db | Tx = getDb()): Promise<ClosedMarks> {
  const [rows, branches] = await Promise.all([
    coveringRows(db, day),
    db.select({ id: s.branches.id, kind: s.branches.kind, active: s.branches.active, openedOn: s.branches.openedOn }).from(s.branches),
  ]);
  return closedMarksOf(rows, branches, day);
}

/**
 * Personelin yazımı (kasadan çıkan, zayi / ikram) kapalı işaretli güne düşüyorsa nedeni; yönetici ve açık gün null.
 * Kapalı satırı yalnız yöneticinin yazımıdır (onaylı). `branchId`: yazımın şubesi (öteki şubenin kapalı günü engellemez)
 */
export async function closedDayRefusal(date: string, role: "admin" | "staff", db: Db | Tx = getDb(), branchId?: string | null): Promise<string | null> {
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
 * Z no, fiş sayısı ve Z toplamı. Geçiş günü boşken ya da önceki günde null (deneme günü kanıt değil). İşlem içinden de.
 * Şube şube: verilen şubenin kasası LafPOS'taysa (branchSwitchDay) ve yalnız o şubenin gün sonu. Şube verilmezse
 * (işletme geneli okuma) LafPOS'un şubesinin (Marina, LAFPOS_BRANCH_ID) gün sonu: LafPOS günü yalnız onun kasasınındır;
 * önceden şube verilmeyince günün herhangi bir satırı okunuyordu, ModPOS'taki şubenin (Tuzla) eski deneme satırı da
 * "LafPOS'ta Z …" kanıtı sayılabiliyordu.
 */
async function lafposEvidence(db: Db | Tx, date: string, branchId?: string | null): Promise<ClosedEvidence["lafpos"]> {
  const branch = branchId ?? LAFPOS_BRANCH_ID;
  const [setting] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1);
  if (!isLafposDay(date, branchSwitchDay(readLafposSwitchDay(setting?.value), branch))) return null;
  const [row] = await db
    .select({ z: s.posDayReports.z })
    .from(s.posDayReports)
    .where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branch)))
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
async function coveringRows(db: Db | Tx, date: string, branchId?: string | null) {
  return db
    .select()
    .from(s.specialDays)
    .where(and(eq(s.specialDays.kind, "kapali"), lte(s.specialDays.dateFrom, date), gte(s.specialDays.dateTo, date), closedBranchWhere(branchId)))
    .orderBy(asc(s.specialDays.id));
}

/**
 * Şubenin bir günkü kapalı gün bildirimleri: konu şubenin günüdür (cashDaySubject: Tuzla `gun:G`, öteki `gun:G:şube`;
 * şubelerden önceki bildirimler Tuzla'nın). Bir şubenin raporu, kararı ya da işareti yalnız bunlara dokunur
 */
const closedRequestsOf = (date: string, branchId: string) =>
  and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.day, date), eq(s.staffRequests.subject, cashDaySubject(date, branchId)));

/**
 * Z no ve açılış sürekliliği, tek şubenin önceki ve sonraki raporu arasında: arada (bu günden başka) raporsuz ve kapalı
 * işaretsiz kaç gün var, Z boşluğu ve açılış
 */
async function branchContinuity(
  db: Db | Tx,
  date: string,
  prev: { branchId: string; date: string; zNo: string | null; counted: number; handed: number },
  next: { date: string; zNo: string | null; opening: number },
): Promise<Pick<ClosedEvidence, "zGap" | "opening">> {
  // Aradaki kapalı günler şubenin kendi günleri (ve işletme geneli): öteki şubenin kapalı günü bu şubede açık gündür
  const shut = new Set(await closedDaysBetween(addDays(prev.date, 1), addDays(next.date, -1), db, prev.branchId));
  let others = 0;
  for (let d = addDays(prev.date, 1); d < next.date; d = addDays(d, 1)) if (d !== date && !shut.has(d)) others++;
  return {
    zGap: zGapOf(date, prev, next, others),
    opening: openingText({ date: prev.date, carry: Math.round((prev.counted - prev.handed) * 100) / 100 }, { date: next.date, opening: next.opening }),
  };
}

/**
 * Bir günün paneldeki izleri (tutar yok): kasa raporu, LafPOS'un gün sonu (yalnız LafPOS günlerinde; E-36), kasadan
 * çıkan, zayi / ikram, açılan kontrol listesi, karaoke (iş günü penceresinde başlayan, iptal edilmemiş; köşkün kapattığı
 * saatler değil), personelin
 * işlem geçmişi yazımları (aynı pencerede; hesap ve hatırlatıcı hariç, silme kayıtları dahil), Z no sürekliliği ve
 * açılış sürekliliği. Site ayrı (fetchSiteDayCounts, şubenin siparişleri). `branchId` verilirse (kapalı gün şubenindir;
 * denetim 13 Kasım KP-05; 24 Kasım şube kapsamı) rapor, LafPOS, kasadan çıkan, zayi, Z no ve açılış o şubenin
 * kayıtlarından: Marina'nın raporu Tuzla'nın kapalı günü için kanıt değil. Birden çok kasa açıkken kontrol listesi şablonun
 * şubesinden, işlem geçmişi personelin şubesinden: şubenin kendisi kırmızı, şubesiz olan uyarı (`sharedTraces`), öbür
 * şubeninki yok; kendi tablosunda sayılan işlemler (kasa raporu, kasadan çıkan, zayi) işlem geçmişinden ikinci kez
 * sayılmaz; karaoke yalnız karaokenin şubesinde. Tek kasada liste, işlem geçmişi ve karaoke bugünkü gibi o kasanın
 * kanıtıdır. Şube verilmezse günün
 * herhangi bir şubedeki izi kanıttır (LafPOS'un gün sonu yine yalnız LafPOS'un şubesininki, lafposEvidence). Z no ve
 * açılış sürekliliği her durumda şube başınadır (her şubenin kendi kasası, kendi Z sayacı; docs/SUBE.md): önceki ve
 * sonraki rapor aynı şubenin, şubelerin sonucu mergeBranchContinuity ile birleşir.
 */
export async function closedDayEvidence(db: Db | Tx, date: string, branchId?: string | null): Promise<ClosedEvidence> {
  const w = dayWindow(date);
  const own = (col: typeof s.cashReports.branchId | typeof s.cashOuts.branchId | typeof s.wasteEntries.branchId) => (branchId ? eq(col, branchId) : undefined);
  // Şube şube ayrım yalnız birden çok kasa açıkken: tek kasada bütün şubelerin listesi ve şubesiz personel o kasanındır
  // (önceki gibi kırmızı). Karaoke yalnız karaokenin şubesinde: öbür şubenin kapalı gününe karaoke oturumu kanıt değil
  const split = branchId ? await manyTills(db) : false;
  const karaokeHere = !split || branchId === KARAOKE_BRANCH_ID;
  const [[report], [outs], [waste], lists, [karaoke], logs, prevs, nexts, lafpos] = await Promise.all([
    db.select({ id: s.cashReports.id }).from(s.cashReports).where(and(eq(s.cashReports.date, date), own(s.cashReports.branchId))).limit(1),
    db.select({ n: count() }).from(s.cashOuts).where(and(eq(s.cashOuts.date, date), own(s.cashOuts.branchId))),
    db.select({ n: count() }).from(s.wasteEntries).where(and(eq(s.wasteEntries.date, date), own(s.wasteEntries.branchId))),
    // Koşunun şubesi şablonundan (bütün şubelerin listesinde boş)
    db
      .select({ templateBranchId: s.checklistTemplates.branchId })
      .from(s.checklistRuns)
      .innerJoin(s.checklistTemplates, eq(s.checklistTemplates.id, s.checklistRuns.templateId))
      .where(eq(s.checklistRuns.date, date)),
    karaokeHere
      ? db
          .select({ n: count() })
          .from(s.karaokeSessions)
          // Köşkün kapattığı saatler açık olunduğunun kanıtı değil (kapalı günde bütün gün kapatılmış olabilir)
          .where(
            and(
              gte(s.karaokeSessions.startsAt, w.from),
              lt(s.karaokeSessions.startsAt, w.to),
              ne(s.karaokeSessions.status, "cancelled"),
              sql`${s.karaokeSessions.channel} is distinct from ${DESK_BLOCK_CHANNEL}`,
            ),
          )
      : Promise.resolve([{ n: 0 }]),
    db
      .select({ action: s.activityLog.action, userBranchId: s.users.branchId })
      .from(s.activityLog)
      .innerJoin(s.users, eq(s.users.id, s.activityLog.userId))
      .where(and(gte(s.activityLog.at, w.from), lt(s.activityLog.at, w.to), eq(s.users.role, "staff"))),
    // Her şubenin bu günden önceki son ve sonraki ilk raporu (şube başına bir satır)
    db
      .selectDistinctOn([s.cashReports.branchId], {
        branchId: s.cashReports.branchId,
        date: s.cashReports.date,
        zNo: s.cashReports.zNo,
        counted: s.cashReports.countedCash,
        handed: s.cashReports.handedOver,
      })
      .from(s.cashReports)
      .where(and(lt(s.cashReports.date, date), own(s.cashReports.branchId)))
      .orderBy(asc(s.cashReports.branchId), desc(s.cashReports.date)),
    db
      .selectDistinctOn([s.cashReports.branchId], { branchId: s.cashReports.branchId, date: s.cashReports.date, zNo: s.cashReports.zNo, opening: s.cashReports.openingCash })
      .from(s.cashReports)
      .where(and(gt(s.cashReports.date, date), own(s.cashReports.branchId)))
      .orderBy(asc(s.cashReports.branchId), asc(s.cashReports.date)),
    lafposEvidence(db, date, branchId),
  ]);
  const nextOf = new Map(nexts.map((n) => [n.branchId, n]));
  const continuity = mergeBranchContinuity(
    await Promise.all(prevs.flatMap((prev) => (nextOf.has(prev.branchId) ? [branchContinuity(db, date, prev, nextOf.get(prev.branchId)!)] : []))),
  );
  // Şube verilince liste ve işlem geçmişi şube şube: şubenin kendisi kırmızı, şubesi belli olmayan uyarı
  const runs = split && branchId ? branchChecklistRuns(lists, branchId) : { own: lists.length, shared: 0 };
  const writes = split && branchId ? branchStaffWrites(logs, branchId) : { own: logs.filter((l) => isEvidenceAction(l.action)).length, shared: 0 };
  return {
    report: Boolean(report),
    cashOuts: outs?.n ?? 0,
    waste: waste?.n ?? 0,
    checklists: runs.own,
    karaoke: karaoke?.n ?? 0,
    staffWrites: writes.own,
    sharedTraces: runs.shared + writes.shared,
    zGap: continuity.zGap,
    opening: continuity.opening,
    lafpos,
  };
}

/** Birden çok kasa açık mı (etkin fiziksel şube; işlem içinden de okunur) */
async function manyTills(db: Db | Tx): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(s.branches).where(and(eq(s.branches.kind, "fiziksel"), eq(s.branches.active, true)));
  return (row?.n ?? 0) > 1;
}

/** İşlem geçmişine (işlemin içinde; sistemin ya da yazanın adıyla) */
async function logIn(tx: Tx, who: { id: number | null; name: string } | null, action: string, detail: string) {
  await tx.insert(s.activityLog).values({ userName: who?.name ?? "Sistem", userId: who?.id ?? null, action, detail: detail.slice(0, 500), via: currentVia() });
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

/**
 * Kapalı satırı Özel günler'de düzenlendi (denetim 13 Kasım SB-04): onu onaylayan bildirimin günü satırın yeni hâlinde
 * artık bildirimin şubesi için kapalı değilse (tür değişti, gün kaydı, başka şubeye geçti) istek silmedeki gibi `revoked`
 * olur, eksik rapor uyarıları geri gelir; o günü bildirimin şubesi için kapsayan başka bir kapalı satır varsa istek ona
 * geçer. Satırın düzenlenmesiyle aynı işlemde çağrılır.
 */
export async function recheckClosedRequests(tx: Tx, specialId: number, note: string, now = new Date()): Promise<void> {
  const approved = await tx
    .select({ id: s.staffRequests.id, day: s.staffRequests.day, subject: s.staffRequests.subject, payload: s.staffRequests.payload })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "approved"), eq(s.staffRequests.resultId, specialId)));
  for (const r of approved) {
    const rows = r.day ? await coveringRows(tx, r.day, closedRequestBranch(r)) : [];
    if (rows.some((x) => x.id === specialId)) continue;
    await tx
      .update(s.staffRequests)
      .set(rows.length ? { resultId: rows[0].id, updatedAt: now } : { status: "revoked", reviewNote: note, updatedAt: now })
      .where(eq(s.staffRequests.id, r.id));
  }
}

/** Özel günlerin danışma kilidi: yönetici ve personel yazımları sıraya girer (çakışma ve sınırlar yarışmaz) */
export async function lockSpecialDays(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ozel-gun'))`);
}

/**
 * Günü şube için kapalı işaretler (yönetici; işlemin içinde, danışma kilidi altında): günü kapsayan, bu şubenin ya da
 * işletme genelinin `kapali` satırı yoksa şubenin tek günlük satırı yazılır, `createdBy` yazan yönetici. Varsa onun
 * kimliği döner (`created` false). Öteki şubenin satırı bu şubeyi kapatmaz: yanına bu şubeninki yazılır.
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

/**
 * Tek günlük kapalı işaret bir şube için kanıtla kalktı (rapor, LafPOS gün sonu, Z boşluğu). Şubenin kendi satırı silinir
 * (dropClosedMark). İşletme geneli (şubesi boş) satır yalnız o şube için kalkar (planlı Tuzla kapanışı Marina'nın
 * raporuyla silinmesin): o gün raporu ya da kendi işareti olmayan öteki etkin fiziksel şubelere aynı satır şubeli yazılır,
 * onların onaylı bildirimleri kendi satırlarına geçer, kanıt gelen şubeninki `revoked` olur. Başka fiziksel şube yoksa
 * satır silinir.
 */
async function clearClosedMark(tx: Tx, row: typeof s.specialDays.$inferSelect, branchId: string, why: string, now: Date) {
  if (row.branchId !== null) return dropClosedMark(tx, row, why, now);
  const day = row.dateFrom;
  const [branches, reported, marks] = await Promise.all([
    tx.select({ id: s.branches.id, name: s.branches.name, active: s.branches.active, kind: s.branches.kind, sortOrder: s.branches.sortOrder }).from(s.branches),
    tx.select({ branchId: s.cashReports.branchId }).from(s.cashReports).where(eq(s.cashReports.date, day)),
    coveringRows(tx, day),
  ]);
  const others = branches.filter((b) => b.active && b.kind === "fiziksel" && b.id !== branchId).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!others.length) return dropClosedMark(tx, row, why, now);
  // Şubenin kendi işareti varsa yenisi yazılmaz (onaylı bildirimi oraya geçer); o gün raporu olan şube açıktı
  const target = new Map<string, number>();
  for (const m of marks) if (m.branchId && !target.has(m.branchId)) target.set(m.branchId, m.id);
  const open = new Set(reported.map((r) => r.branchId));
  const { id: _id, branchId: _b, ...copy } = row;
  void _id;
  void _b;
  const kept: string[] = [];
  for (const b of others) {
    if (target.has(b.id) || open.has(b.id)) continue;
    const [n] = await tx
      .insert(s.specialDays)
      .values({ ...copy, branchId: b.id })
      .returning({ id: s.specialDays.id });
    target.set(b.id, n.id);
    kept.push(b.name);
  }
  await tx.delete(s.specialDays).where(eq(s.specialDays.id, row.id));
  const approved = await tx
    .select({ id: s.staffRequests.id, subject: s.staffRequests.subject, payload: s.staffRequests.payload })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "approved"), eq(s.staffRequests.resultId, row.id)));
  for (const r of approved) {
    const own = closedRequestBranch(r);
    const to = own !== branchId ? target.get(own) : undefined;
    if (to) await tx.update(s.staffRequests).set({ resultId: to, updatedAt: now }).where(eq(s.staffRequests.id, r.id));
  }
  await revokeFor(tx, row.id, why, now);
  const name = branches.find((b) => b.id === branchId)?.name ?? branchId;
  await logIn(tx, null, "Kapalı gün işareti kaldırıldı (kanıt geldi)", [longDateTR(day), `${name}: ${why}`, kept.length ? `${kept.join(", ")} kapalı kalıyor` : null].filter(Boolean).join(" · "));
}

/** Şubenin bu günkü bekleyen kapalı gün bildirimleri kapanır (öteki şubeninkiler bekler) */
async function supersedeClosedRequests(tx: Tx, date: string, branchId: string, note: string, now: Date): Promise<void> {
  await tx
    .update(s.staffRequests)
    .set({ status: "superseded", reviewNote: note, reviewedAt: now, updatedAt: now })
    .where(and(closedRequestsOf(date, branchId), eq(s.staffRequests.status, "pending")));
}

/**
 * Bir şubenin bir günkü raporu ilk kez girildi (writeCashReport, işlemin içinde): o şubenin aynı günkü bekleyen kapalı
 * gün bildirimi kapanır ("Kasa raporu girildi"). Günü kapsayan, şubenin ya da işletme genelinin tek günlük kapalı
 * satırı silinir (istek `revoked`, yöneticinin zilinde); çok günlük aralıkta yalnız zil: "Kapalı aralığın içindeki 3
 * Kas'a rapor girildi; …". Öteki şubenin işaretine ve bildirimine dokunulmaz (denetim 13 Kasım KP-05).
 */
export async function onReportSaved(
  tx: Tx,
  date: string,
  now = new Date(),
  /** Raporun şubesi; verilmezse LafPOS'un şubesi (gün sonundan otomatik rapor, src/server/lafpos/gun-sonu.ts) */
  branchId: string = LAFPOS_BRANCH_ID,
): Promise<void> {
  await supersedeClosedRequests(tx, date, branchId, "Kasa raporu girildi", now);
  for (const row of await coveringRows(tx, date, branchId)) {
    if (row.dateFrom === row.dateTo) await clearClosedMark(tx, row, branchId, "kasa raporu girildi", now);
    else await logIn(tx, null, "Kapalı aralığa rapor girildi", `Kapalı aralığın içindeki ${longDateTR(date)} gününe rapor girildi; Kafe › Özel günler'den aralığı düzeltin`);
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
  /** Gün sonunun şubesi: LafPOS'un şubesi (yalnız onun bildirimi kapanır, onun ve işletme genelinin işareti kalkar) */
  branchId: string = LAFPOS_BRANCH_ID,
): Promise<void> {
  if (z.receipts <= 0 && z.zTotal <= 0) return;
  const [setting] = await tx.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1);
  // Geçiş günü gün sonunun şubesinin kasasından (LafPOS'un şubesinde ayar, öteki şubede hiç LafPOS günü yok)
  if (!isLafposDay(date, branchSwitchDay(readLafposSwitchDay(setting?.value), branchId))) return;
  await lockClosedDay(tx, date);
  const why = `LafPOS gün sonu geldi (Z ${z.zNo}${z.receipts > 0 ? ` · ${z.receipts} fiş` : ""})`;
  await supersedeClosedRequests(tx, date, branchId, why, now);
  for (const row of await coveringRows(tx, date, branchId)) {
    if (soldSince && row.createdAt >= soldSince) continue;
    if (row.dateFrom === row.dateTo) await clearClosedMark(tx, row, branchId, why, now);
    else await logIn(tx, null, "Kapalı aralığa rapor girildi", `Kapalı aralığın içindeki ${longDateTR(date)} günü için ${why}; Kafe › Özel günler'den aralığı düzeltin`);
  }
}

/**
 * Sonraki günün raporu girildi (writeCashReport, işlemin içinde): önceki gün kapalı işaretliyse Z no sürekliliği
 * denetlenir. O güne bir Z düşmüşse (boşluk, arada başka raporsuz gün yok) tek günlük işaret kalkar; açılış devirle
 * tutmuyorsa yalnız zil (işlem geçmişi). Karşılaştırma raporun kendi şubesinin önceki raporuyladır (her şubenin kendi
 * kasası ve Z sayacı; docs/SUBE.md): öteki şubenin Z'si ya da devri onaylı işareti kaldırmaz, zile yazmaz.
 */
export async function onNextReport(tx: Tx, report: { date: string; branchId: string; zNo: string | null; openingCash: number }, now = new Date()): Promise<void> {
  const day = addDays(report.date, -1);
  // Yalnız raporun şubesinin ve işletme genelinin işareti: öteki şubenin kapalı günü bu şubenin Z'siyle denetlenmez
  const rows = await coveringRows(tx, day, report.branchId);
  if (!rows.length) return;
  const [prev] = await tx
    .select({ date: s.cashReports.date, zNo: s.cashReports.zNo, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
    .from(s.cashReports)
    .where(and(lt(s.cashReports.date, day), eq(s.cashReports.branchId, report.branchId)))
    .orderBy(desc(s.cashReports.date))
    .limit(1);
  if (!prev) return;
  // Şubenin önceki raporu ile bu gün arasındaki öteki raporsuz (bu şubede), kapalı işaretsiz günler
  const shut = new Set(await closedDaysBetween(addDays(prev.date, 1), addDays(day, -1), tx, report.branchId));
  let others = 0;
  for (let d = addDays(prev.date, 1); d < day; d = addDays(d, 1)) if (!shut.has(d)) others++;
  const gap = zGapOf(day, prev, { date: report.date, zNo: report.zNo }, others);
  if (gap?.level === "red") {
    for (const row of rows) {
      if (row.dateFrom === row.dateTo) await clearClosedMark(tx, row, report.branchId, `Z no boşluğu: ${gap.text}`, now);
      else await logIn(tx, null, "Kapalı aralığa rapor girildi", `${longDateTR(day)} kapalı işaretli ama ${gap.text}; Kafe › Özel günler'den aralığı düzeltin`);
    }
    return;
  }
  const opening = openingText({ date: prev.date, carry: Math.round((prev.counted - prev.handed) * 100) / 100 }, { date: report.date, opening: report.openingCash });
  if (opening && !opening.ok) await logIn(tx, null, "Kapalı gün: açılış devirle tutmuyor", `${longDateTR(day)} kapalı işaretli; ${opening.text}`);
}

// ---------------------------------------------------------------- Okuyucular

/** Kapalı gün bildirimlerinin sabit sütunları (yük yalnız tarih ve neden; tutar yok) */
const requestCols = {
  id: s.staffRequests.id,
  day: s.staffRequests.day,
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
 * Bugün'ün ve zilin olgusu: dün kasanın şubesi kapalı mıydı (onaylı satır, bekleyen ya da reddedilen bildirim); yoksa
 * `yesterday` null. `branchId`: kasanın şubesi (verilmezse seçili kasa, "Tümü"de Tuzla); "Tümü"de her şubenin satırı
 * kendi şubesiyle sorar: Tuzla'nın kapalı günü Marina'nın eksik raporunu susturmaz
 */
export async function closedYesterday(user: CurrentUser, now: Date, branchId?: string): Promise<DayFacts["closed"]> {
  void user;
  const y = addDays(businessDate(now), -1);
  const db = getDb();
  const till = branchId ?? (await currentTillBranch());
  const [rows, reqs] = await Promise.all([
    coveringRows(db, y, till),
    db
      .select(requestCols)
      .from(s.staffRequests)
      .where(and(closedRequestsOf(y, till), ne(s.staffRequests.status, "withdrawn")))
      .orderBy(desc(s.staffRequests.createdAt)),
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
  /**
   * Bildirim kapandı ama gün kapalı işaretli değil (denetim 13 Kasım SB-X1): yönetici işareti kaldırdı ya da değiştirdi
   * (`revoked`; onaylı kalıp satırı artık günü kapsamayan eski istek de), LafPOS'un gün sonu geldi (`superseded`) ya da
   * süresi doldu. Aynı gün yeniden bildirilemez (proposeClosedDay "Bu gün için bildiriminiz var" der); satır nedenini
   * söyler (closedEndedTitle)
   */
  ended: { status: StaffRequestStatus; note: string | null } | null;
  /** Düğme görünür: o günün geri çekilmemiş bildirimi yok, kişinin son 30 günde 3'ten az bildirimi var */
  canAsk: boolean;
}

/** Düğme bildirimin kuralıyla aynı: geri çekilmemiş her bildirim günü kapatır; gün kapalı işaretliyse sayfa bu durumu göstermez */
export async function staffClosedState(date: string, me: { id: number }, now = new Date()): Promise<StaffClosedState> {
  const db = getDb();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  // Kasanın şubesinin bildirimleri (sayfa kasanın kapsamında okur): öteki şubenin bekleyeni bu şubenin düğmesini kapatmaz
  const till = await currentTillBranch();
  const [reqs, [mine]] = await Promise.all([
    db
      .select({ id: s.staffRequests.id, status: s.staffRequests.status, requestedBy: s.staffRequests.requestedBy, requestedByName: s.staffRequests.requestedByName, reviewNote: s.staffRequests.reviewNote })
      .from(s.staffRequests)
      .where(and(closedRequestsOf(date, till), ne(s.staffRequests.status, "withdrawn")))
      .orderBy(desc(s.staffRequests.createdAt)),
    db
      .select({ n: count() })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.requestedBy, me.id), ne(s.staffRequests.status, "withdrawn"), gte(s.staffRequests.createdAt, since))),
  ]);
  const p = reqs.find((r) => r.status === "pending");
  const r = reqs.find((x) => x.status === "rejected");
  const e = p || r ? undefined : reqs[0];
  return {
    pending: p ? { id: p.id, by: p.requestedByName, mine: p.requestedBy === me.id } : null,
    rejected: r ? { note: r.reviewNote } : null,
    // Onaylı kalan isteğin notu onayın notudur, kaldırılmanın değil: yazılmaz
    ended: e ? (e.status === "approved" ? { status: "revoked", note: null } : { status: e.status, note: e.reviewNote }) : null,
    canAsk: !reqs.length && (mine?.n ?? 0) < 3,
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
  evidence: ClosedEvidence;
  /** Aynı kişinin ya da başkasının üst üste kapalı bildirdiği / işaretli günlerle birlikte kaç gün */
  run: { from: string; to: string; days: number } | null;
  /** Günün kasası (denetim E-39): "Onaylamadan önce o günün ModPOS / banka POS'una bakın" */
  kasa: KasaName;
  /** Bildirimin şubesi (kanıt da o şubenin) */
  branchId: string;
  /** Birden çok şube açıkken şubenin adı (kart başlığı, "Günü aç" bağlantısı); loadCashRequestQueue doldurur */
  branch?: { id: string; name: string } | null;
}

/** Bekleyen kapalı gün bildirimlerinin kartları (yalnız yönetici; loadCashRequestQueue toplar) */
export async function closedDayCards(): Promise<ClosedDayCard[]> {
  const db = getDb();
  const rows = await db
    .select({ ...requestCols, message: s.staffRequests.message, subject: s.staffRequests.subject })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "pending"), isNotNull(s.staffRequests.day)))
    .orderBy(asc(s.staffRequests.day), asc(s.staffRequests.createdAt));
  if (!rows.length) return [];
  const days = rows.map((r) => r.day!);
  const from = addDays(days[0], -7);
  const to = addDays(days[days.length - 1], 7);
  // Bildirimin şubesi (yükte ya da konuda): kanıt, kasa ve üst üste günler o şubenin
  const branchOf = new Map(rows.map((r) => [r.id, closedRequestBranch(r)]));
  const branches = [...new Set(branchOf.values())];
  // Üst üste günler: şubenin bekleyen bildirimleri ve zaten kapalı işaretli günleri (kendi ve işletme geneli) birlikte
  const [marked, [setting]] = await Promise.all([
    Promise.all(branches.map((b) => closedDaysBetween(from, to, db, b))),
    db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1),
  ]);
  const switchDay = readLafposSwitchDay(setting?.value);
  const allOf = new Map(branches.map((b, i) => [b, new Set([...rows.filter((r) => branchOf.get(r.id) === b).map((r) => r.day!), ...marked[i]])]));
  const runOf = (d: string, all: Set<string>) => {
    let a = d;
    let b = d;
    while (all.has(addDays(a, -1))) a = addDays(a, -1);
    while (all.has(addDays(b, 1))) b = addDays(b, 1);
    return a === b ? null : { from: a, to: b, days: [...all].filter((x) => x >= a && x <= b).length };
  };
  const out: ClosedDayCard[] = [];
  for (const r of rows) {
    const p = ClosedDayPayload.safeParse(r.payload);
    const branchId = branchOf.get(r.id)!;
    out.push({
      kind: "kapali-gun",
      id: r.id,
      version: r.version,
      date: r.day!,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt.toISOString(),
      message: r.message,
      reason: p.success ? p.data.reason : null,
      evidence: await closedDayEvidence(db, r.day!, branchId).catch(() => EMPTY_EVIDENCE),
      run: runOf(r.day!, allOf.get(branchId)!),
      kasa: kasaName(r.day!, branchSwitchDay(switchDay, branchId)),
      branchId,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Zil (yönetici)

/**
 * Bekleyen kapalı gün bildirimleri (yöneticinin zili; tutar yok). `scope`: tek şube seçiliyken yalnız o şubenin
 * bildirimleri (şube kapsamı C P1-1; `closedRequestBranch`)
 */
export async function pendingClosedRows(scope: BranchScope = ALL_BRANCHES): Promise<{ id: number; day: string; requestedByName: string; bumpedAt: Date; createdAt: Date; branchId: string }[]> {
  const rows = await getDb()
    .select({
      id: s.staffRequests.id,
      day: s.staffRequests.day,
      subject: s.staffRequests.subject,
      payload: s.staffRequests.payload,
      requestedByName: s.staffRequests.requestedByName,
      bumpedAt: s.staffRequests.bumpedAt,
      createdAt: s.staffRequests.createdAt,
    })
    .from(s.staffRequests)
    .where(and(eq(s.staffRequests.kind, "kapali-gun"), eq(s.staffRequests.status, "pending"), isNotNull(s.staffRequests.day)))
    .orderBy(asc(s.staffRequests.createdAt));
  return rows
    .map(({ subject, payload, ...r }) => ({ ...r, day: r.day!, branchId: closedRequestBranch({ subject, payload }) }))
    .filter((r) => requestInScope(r.branchId, scope));
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
