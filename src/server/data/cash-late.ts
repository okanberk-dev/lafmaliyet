import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { branchDayKey, businessDate, carryCheck, LATE_REPORT_DAYS, lateMissingDays, type CarryCheck, type CashReportFields } from "@/lib/cash-report";
import { partialStart, tillOpenedOn, type TillOpening } from "@/lib/cash-month";
import { cashDaySubject, cashSubjectBranch, handedToText, lateBell, lateBranchOf, lateByText, LatePayload, lateFields, type LatePayloadT } from "@/lib/cash-requests";
import { money } from "@/lib/format";
import { asilposDiffs, type AsilposDiff } from "@/lib/asilpos/diffs";
import { unreceiptedCashOut, type AsilposDay } from "@/lib/asilpos/prefill";
import { branchSwitchDay, isAsilposDay } from "@/lib/asilpos/switch";
import { okcLateChain, zNoNumber, type OkcLateChain } from "@/lib/okc-z";
import { photoDiffs, savedFields, type CashReading, type PhotoDiff } from "@/lib/photo-read/kasa";
import { okcReadFigures } from "@/lib/photo-read/okc";
import { addDays, dayLocativeTR, monthGenitiveTR, todayTR } from "@/lib/reminders";
import { waitedText, type StaffRequestStatus } from "@/lib/staff-requests";
import { currentTillBranch } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { chainNeighbours, type ChainLink } from "@/server/cash/late-chain";
import { closedDaysBetween } from "@/server/closed-days";
import { cashOutsOn } from "@/server/data/cash-outs";
import { heldPhotoInfo, type CashPhotoDTO } from "@/server/data/cash-photos";
import { loadMonthEntry, nextOkc, previousOkc } from "@/server/data/cash-reports";
import { loadKasaAsilpos } from "@/server/data/asilpos-day";
import { loadAsilposSwitchDay } from "@/server/asilpos/status";
import { asilposBranchId, loadBranchSwitchDay } from "@/server/asilpos/branch";
import { getDb, schema as s } from "@/server/db";

/*
 * Geç kasa raporunun okuyucuları (docs/KASA-RAPORU.md › Geç rapor; plan docs/planlar/personel-yetki.md §2.6). Personelin
 * okuyucuları (staffLateDays, lateRequestFor) sabit sütunla: kişinin kendi isteğinde kendi yazdığı sayılar ve kendi
 * fotoğrafları, başkasınınkinde yalnız ad ve an (tests/personel-sizinti-kasa.test.ts). Yöneticinin kartı
 * (lateCards: fotoğraflar ve okumaları, Z no sırası, zincir, ay, kasadan çıkanlar) yalnız Onaylar'da.
 */

const r = s.staffRequests;
const pendingLate = and(eq(r.kind, "kasa-gec"), eq(r.status, "pending"));

/**
 * Personelin "Girilmemiş günler"i: geç rapor penceresinin raporsuz, kapalı olmayan günleri ve istek durumu. `asilpos`:
 * AsilPOS günü ve gün sonu geldi (kanıt o, fotoğraf gerekmez; G8, kasaEvidence ile aynı kural). Geçiş günü boşken hiç yok.
 * Kasanın şubesinin günleri (seçili fiziksel şube, "Tümü"de Tuzla): başka şubenin raporu bu kasanın gününü kapatmaz.
 */
export async function staffLateDays(me: { id: number }, now = new Date()): Promise<{ date: string; state: "missing" | "pending" | "rejected"; asilpos?: true }[]> {
  const day = businessDate(now);
  const from = addDays(day, -LATE_REPORT_DAYS);
  const to = addDays(day, -2);
  const db = getDb();
  const branchId = await currentTillBranch();
  const sube = eq(s.cashReports.branchId, branchId);
  const [reports, [first], closed, requests, asilposDays] = await Promise.all([
    db
      .select({ date: s.cashReports.date })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to), sube)),
    db.select({ date: s.cashReports.date }).from(s.cashReports).where(sube).orderBy(asc(s.cashReports.date)).limit(1),
    closedDaysBetween(from, to, db, branchId),
    db
      .select({ day: r.day, subject: r.subject, status: r.status, requestedBy: r.requestedBy })
      .from(r)
      .where(and(eq(r.kind, "kasa-gec"), gte(r.day, from), lte(r.day, to)))
      .orderBy(asc(r.createdAt)),
    asilposEvidenceDays(from, to, branchId),
  ]);
  const state = new Map<string, "pending" | "rejected">();
  for (const q of requests) {
    if (!q.day || cashSubjectBranch(q.subject) !== branchId) continue;
    if (q.status === "pending") state.set(q.day, "pending");
    // Kişinin son isteği reddedildiyse (bekleyen yoksa)
    else if (q.requestedBy === me.id && state.get(q.day) !== "pending") {
      if (q.status === "rejected") state.set(q.day, "rejected");
      else state.delete(q.day);
    }
  }
  return lateMissingDays(
    reports.map((x) => x.date),
    first?.date ?? null,
    closed,
    state,
    now,
  ).map((d) => (asilposDays.has(d.date) ? { ...d, asilpos: true as const } : d));
}

/** [from, to] içinde AsilPOS gün sonu gelmiş AsilPOS günleri (yalnız geçiş gününden itibaren; boşken boş küme) */
async function asilposEvidenceDays(from: string, to: string, branchId: string): Promise<Set<string>> {
  const db = getDb();
  // Geçiş günü kasanın şubesininki (branchSwitchDay): ModPOS'ta kalan şubede AsilPOS kanıtı yok
  const switchDay = await loadBranchSwitchDay(branchId, db);
  if (switchDay === null || to < switchDay) return new Set();
  const rows = await db
    .select({ date: s.posDayReports.date })
    .from(s.posDayReports)
    .where(and(gte(s.posDayReports.date, from > switchDay ? from : switchDay), lte(s.posDayReports.date, to), eq(s.posDayReports.branchId, branchId)));
  return new Set(rows.map((x) => x.date).filter((d) => isAsilposDay(d, switchDay)));
}

/** Personelin kendi geç rapor isteği (kendi yazdığı sayılar ve kendi fotoğrafları) */
export interface OwnLate {
  id: number;
  status: StaffRequestStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  message: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  fields: CashReportFields;
  cashDiff: number;
  handedTo: LatePayloadT["handedTo"];
  photos: CashPhotoDTO[];
}

/**
 * Personelin geç rapor sayfası (`/panel/kasa?gun=D`): kişinin bu gün için bekleyen isteği, yoksa son reddedilen ya da
 * geri çekilen isteği (form onun değerleriyle açılır), kapanmış istek sayısı (iki ret ya da geri çekmeden sonra form
 * yerine "yöneticiye yazın") ve başkalarının bekleyen istekleri (yalnız ad ve an).
 */
export async function lateRequestFor(date: string, me: { id: number }): Promise<{ own: OwnLate | null; closedCount: number; others: { requestedByName: string; createdAt: string }[] }> {
  const rows = await getDb()
    .select({
      id: r.id,
      status: r.status,
      version: r.version,
      payload: r.payload,
      photoIds: r.photoIds,
      message: r.message,
      reviewNote: r.reviewNote,
      reviewedByName: r.reviewedByName,
      requestedBy: r.requestedBy,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })
    .from(r)
    .where(and(eq(r.kind, "kasa-gec"), eq(r.subject, cashDaySubject(date, await currentTillBranch()))))
    .orderBy(desc(r.updatedAt), desc(r.id));
  const mine = rows.filter((x) => x.requestedBy === me.id);
  const pick = mine.find((x) => x.status === "pending") ?? mine.find((x) => x.status === "rejected" || x.status === "withdrawn") ?? null;
  let own: OwnLate | null = null;
  if (pick) {
    const p = LatePayload.safeParse(pick.payload);
    if (p.success) {
      const photos = await heldPhotoInfo(
        p.data.photos.map((x) => x.id),
        date,
      );
      own = {
        id: pick.id,
        status: pick.status,
        version: pick.version,
        createdAt: pick.createdAt.toISOString(),
        updatedAt: pick.updatedAt.toISOString(),
        message: pick.message,
        reviewNote: pick.reviewNote,
        reviewedByName: pick.reviewedByName,
        fields: lateFields(p.data),
        cashDiff: p.data.cashDiff,
        handedTo: p.data.handedTo,
        photos: photos.photos,
      };
    }
  }
  return {
    own,
    closedCount: mine.filter((x) => x.status === "rejected" || x.status === "withdrawn").length,
    others: rows.filter((x) => x.requestedBy !== me.id && x.status === "pending").map((x) => ({ requestedByName: x.requestedByName, createdAt: x.createdAt.toISOString() })),
  };
}

/** Onaylanan geç raporlar, rapora göre: "Ayşe 21 Ekim'de girdi · Mehmet 22 Ekim'de onayladı" (Günden güne; result_id ile) */
export async function lateRequestsByReport(reportIds: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!reportIds.length) return out;
  const rows = await getDb()
    .select({ resultId: r.resultId, requestedByName: r.requestedByName, createdAt: r.createdAt, reviewedByName: r.reviewedByName, reviewedAt: r.reviewedAt })
    .from(r)
    .where(and(eq(r.kind, "kasa-gec"), eq(r.status, "approved"), inArray(r.resultId, [...reportIds])));
  for (const x of rows) {
    if (x.resultId === null) continue;
    const at = (d: Date) => dayLocativeTR(todayTR(d));
    out.set(x.resultId, `${x.requestedByName} ${at(x.createdAt)} girdi${x.reviewedByName && x.reviewedAt ? ` · ${x.reviewedByName} ${at(x.reviewedAt)} onayladı` : ""}`);
  }
  return out;
}

/**
 * Bekleyen geç raporlar, güne göre (Günden güne: "Onay bekliyor · Ayşe girdi · İncele"): kasanın şubesinin (seçili
 * fiziksel şube; "Tümü"nün şube bölümlerinde o bölümün şubesi)
 */
export async function pendingLateByDay(from: string, to: string): Promise<Record<string, { id: number; requestedByName: string }[]>> {
  const branchId = await currentTillBranch();
  const rows = await getDb()
    .select({ id: r.id, day: r.day, subject: r.subject, requestedByName: r.requestedByName })
    .from(r)
    .where(and(pendingLate, gte(r.day, from), lte(r.day, to)))
    .orderBy(asc(r.createdAt));
  const out: Record<string, { id: number; requestedByName: string }[]> = {};
  for (const x of rows) if (x.day && cashSubjectBranch(x.subject) === branchId) (out[x.day] ??= []).push({ id: x.id, requestedByName: x.requestedByName });
  return out;
}

/** Onay bekleyen geç raporların günleri (ay bilgisi: eksik gün "onay bekliyor" diye yazılır) */
export async function pendingLateDays(): Promise<string[]> {
  const rows = await getDb().selectDistinct({ day: r.day }).from(r).where(pendingLate);
  return rows.flatMap((x) => (x.day ? [x.day] : [])).sort();
}

// ---------------------------------------------------------------- Yöneticinin kartları (Onaylar › Kasa)

export interface LateCard {
  kind: "kasa-gec";
  id: number;
  version: number;
  date: string;
  /** İsteğin kasası (birden çok şube açıkken; src/server/data/cash-requests.ts adını ekler) */
  branch?: { id: string; name: string } | null;
  requestedByName: string;
  createdAt: string;
  waited: string;
  message: string | null;
  /** "7 gün sonra" (rapor günü ile isteğin günü arası) */
  lateBy: string;
  fields: CashReportFields;
  cashDiff: number;
  /** "Teslim edilen 3.000 ₺ · Ayşe'ye göre: Mehmet'e" için teslim alan ("Mehmet", "bankaya") */
  handedTo: string | null;
  photos: CashPhotoDTO[];
  /** Fotoğraftan farklı yazılanlar (okumaya göre) */
  diffs: PhotoDiff[];
  /** Hiçbir fotoğraf okunmadı */
  unread: boolean;
  readings: CashReading[];
  chain: { prev: ChainLink | null; next: ChainLink | null; prevCheck: CarryCheck | null; nextCheck: CarryCheck | null };
  /**
   * Yazarkasa Z'sinin iki yanlı zinciri (docs/planlar/okc-z.md §3.8): Z no önceki ve sonraki kayıtlı yazarkasa Z'siyle,
   * kümülatif iki yanda. Yazarkasa Z no'su yazılmamışsa null
   */
  okcChain: OkcLateChain | null;
  /** Önceki yazarkasa Z'si (yalnız gün ve numara): "Düzeltip onayla" formunun Z no denetimi */
  okcPrevZ: { date: string; zNo: string } | null;
  /** Ay satırı ("Ekim'in açık gün ve POS cirosuna girer" …) */
  monthLine: string;
  /**
   * O güne kayıtlı kasadan çıkanlar ve rapordaki tutarla farkı; `asilposHanded` farkın AsilPOS'taki teslim kadarı (fişsiz
   * değil; E-35), `unreceipted` kalan fişsiz tutar (0: yok; uyarı ancak o zaman kırmızı)
   */
  outs: { count: number; total: number; warning: string | null; asilposHanded: number | null; unreceipted: number };
  /** Gün artık raporlu: onay kapalı, isteği reddedin */
  reported: boolean;
  /** Aynı aralıkta daha eski bekleyen gün (onay kapalı) */
  olderPending: string | null;
  /**
   * Günün kasası AsilPOS mu (geçiş gününden sonra) ve AsilPOS'un o günün sonu (G8, E-09): kart AsilPOS'un Z'sini ve
   * personelin ondan farklı yazdıklarını gösterir, "Düzeltip onayla" formu ondan dolar. ModPOS gününde `asilpos` false
   */
  asilpos: { asilpos: boolean; day: AsilposDay | null; diffs: AsilposDiff[]; sameTill: { prev: boolean; next: boolean } };
}

/**
 * Ay satırı: geç rapor ayın açık gün ve POS cirosuna girer mi. `first` şubenin ilk raporu, `opened` şubenin açılışı
 * (src/lib/cash-month.ts tillOpenedOn): sonradan açılan şubenin açılış ayı "ay ortasında başladı" sayılmaz, Kasa'nın ve
 * Gelir-gider'in ay satırıyla aynı kural (partialStart)
 */
function monthLineOf(
  date: string,
  today: string,
  first: string | null,
  entry: { openDays: number | null; posRevenue: number | null } | null,
  opened: TillOpening = null,
): string {
  const month = date.slice(0, 7);
  const gen = monthGenitiveTR(month);
  if (entry && entry.openDays !== null && entry.posRevenue !== null) return `${gen} açık gün ve POS cirosu elle yazılmış; bu rapor değiştirmez`;
  if (partialStart(month, first, opened)) return "Kasa raporları ay ortasında başladı; bu ayın ciro ve açık günü elle girilir, bu rapor değiştirmez";
  if (month < today.slice(0, 7)) return `Kapanmış ay: ${gen} açık gün ve POS cirosu bu raporla değişir (Satışlar ve kâr)`;
  return `${gen} açık gün ve POS cirosuna girer`;
}

/** Bekleyen geç raporların kartları, en eski gün önce (yalnız yönetici; src/server/data/cash-requests.ts toplar) */
export async function lateCards(now = new Date()): Promise<(LateCard & { branchId: string })[]> {
  const db = getDb();
  const rows = await db
    .select({ id: r.id, version: r.version, day: r.day, subject: r.subject, payload: r.payload, message: r.message, requestedByName: r.requestedByName, createdAt: r.createdAt })
    .from(r)
    .where(pendingLate)
    .orderBy(asc(r.day), asc(r.createdAt));
  if (!rows.length) return [];
  const today = businessDate(now);
  const days = [...new Set(rows.flatMap((x) => (x.day ? [x.day] : [])))];
  // Her isteğin kendi kasası (isteyenin şubesi): günün raporu, ilk rapor, zincir, kasadan çıkanlar ve ay o şubenin.
  // Yöneticinin şube seçimi karta girmez
  const [reported, firsts, branches] = await Promise.all([
    db.select({ date: s.cashReports.date, branchId: s.cashReports.branchId }).from(s.cashReports).where(inArray(s.cashReports.date, days)),
    db
      .select({ branchId: s.cashReports.branchId, date: sql<string>`min(${s.cashReports.date})` })
      .from(s.cashReports)
      .groupBy(s.cashReports.branchId),
    listBranches(db),
  ]);
  const reportedDays = new Set(reported.map((x) => branchDayKey(x.branchId, x.date)));
  const firstOf = new Map(firsts.map((f) => [f.branchId, f.date]));
  const openedOf = (branchId: string) => tillOpenedOn(branches.find((b) => b.id === branchId));
  const [switchDay, asilposBranch] = await Promise.all([loadAsilposSwitchDay(db), asilposBranchId(db)]);
  const cards: (LateCard & { branchId: string })[] = [];
  for (const x of rows) {
    const parsed = LatePayload.safeParse(x.payload);
    if (!x.day || !parsed.success) continue;
    const p = parsed.data;
    const date = x.day;
    const branchId = lateBranchOf(p);
    const fields = lateFields(p);
    const [photos, chain, outs, entry, okcPrev, okcNext, asilpos] = await Promise.all([
      heldPhotoInfo(
        p.photos.map((ph) => ph.id),
        date,
        "admin",
      ),
      chainNeighbours(db, date, { exceptRequestId: x.id, branchId }),
      cashOutsOn(date, branchId),
      loadMonthEntry(date.slice(0, 7), branchId),
      previousOkc(date, db, branchId),
      nextOkc(date, db, branchId),
      loadKasaAsilpos(date, db, branchId),
    ]);
    // Yazarkasa Z'sinin kümülatifi, fotoğrafın okumasından: okunan Z no ve günlük toplam yazılanla aynıysa (sunucu
    // sütunlarının kuralı, plan §6.1); değilse zincir önceki ve sonraki saklanan kümülatifle denetlenir
    const read = okcReadFigures(photos.readings);
    const sameRead = read !== null && zNoNumber(read.zNo) !== null && zNoNumber(read.zNo) === zNoNumber(fields.okcZNo) && read.total !== null && fields.okcTotal != null && Math.abs(read.total - fields.okcTotal) <= 0.01;
    const okcChain = okcLateChain({ zNo: fields.okcZNo, total: fields.okcTotal, cumTotal: sameRead ? read.cumTotal : null }, okcPrev, okcNext);
    const carry = Math.round((fields.countedCash - fields.handedOver) * 100) / 100;
    const prevCheck = chain.prev ? carryCheck(date, fields.openingCash, { date: chain.prev.date, amount: chain.prev.carry }) : null;
    const nextCheck = chain.next ? carryCheck(chain.next.date, chain.next.openingCash, { date, amount: carry }) : null;
    // Aynı aralıkta (önceki kayıtlı rapordan bu yana; önceki halka bekleyen geç rapor olsa da) daha eski bekleyen gün:
    // onay kapalı. Sınır onaydakiyle (reviewLate) aynı: aralığın dışındaki eski bir bekleyen gün adı geçmez
    const { prevReportDate } = chain;
    const older = rows.find(
      (o) =>
        o.id !== x.id &&
        o.day &&
        cashSubjectBranch(o.subject) === branchId &&
        o.day < date &&
        (!prevReportDate || o.day > prevReportDate) &&
        !reportedDays.has(branchDayKey(branchId, o.day)),
    );
    // Fişsiz çıkışın tek hesabı (unreceiptedCashOut): AsilPOS gününde farkın AsilPOS'taki teslim kadarı fişsiz değil, teslim
    // Kasadan çıkanlar'a girilmemiş (E-35)
    const u = unreceiptedCashOut(fields.cashOut, outs, asilpos.day?.till ?? null);
    const outsTotal = u.total;
    const outsGap = u.gap;
    const split = u.asilposHanded !== null ? { handed: u.asilposHanded, rest: u.unreceipted } : null;
    cards.push({
      kind: "kasa-gec",
      branchId,
      id: x.id,
      version: x.version,
      date,
      requestedByName: x.requestedByName,
      createdAt: x.createdAt.toISOString(),
      waited: waitedText(x.createdAt, now),
      message: x.message,
      lateBy: lateByText(date, x.createdAt),
      fields,
      cashDiff: p.cashDiff,
      handedTo: handedToText(p.handedTo),
      photos: photos.photos,
      diffs: photoDiffs(photos.readings, savedFields(fields)),
      // AsilPOS'un gün sonu varken kanıt odur: okunmamış fotoğraf uyarısı yok
      unread: !photos.readings.length && !asilpos.day,
      readings: photos.readings,
      chain: { prev: chain.prev, next: chain.next, prevCheck, nextCheck },
      okcChain,
      okcPrevZ: okcPrev.z,
      monthLine: monthLineOf(date, today, firstOf.get(branchId) ?? null, entry, openedOf(branchId)),
      outs: {
        count: outs.length,
        total: outsTotal,
        warning:
          Math.abs(outsGap) < 1
            ? null
            : split !== null
              ? `Gün içinde çıkan ${money(fields.cashOut)}; o güne kayıtlı kasadan çıkan ${money(outsTotal)}. ${
                  split.rest
                    ? `${money(split.handed)} AsilPOS'ta olup girilmemiş teslim, ${money(split.rest)} fişsiz`
                    : `Fark AsilPOS'ta olup girilmemiş teslim (${money(split.handed)}), fişsiz değil`
                }: teslimi Kasadan çıkanlar'a "Teslim" olarak ekleyin.`
              : `Gün içinde çıkan ${money(fields.cashOut)}; o güne kayıtlı kasadan çıkan ${money(outsTotal)}${outsGap > 0 ? ` (${money(outsGap)} fişsiz)` : ""}`,
        asilposHanded: u.asilposHanded,
        unreceipted: u.unreceipted,
      },
      reported: reportedDays.has(branchDayKey(branchId, date)),
      olderPending: older?.day ?? null,
      // Z no sırası yalnız aynı kasanın günleriyle karşılaştırılır: AsilPOS'a geçişte Z numarası 1'den başlar
      asilpos: {
        ...asilpos,
        diffs: asilpos.day ? asilposDiffs(fields, asilpos.day) : [],
        sameTill: {
          prev: !chain.prev || isAsilposDay(chain.prev.date, branchSwitchDay(switchDay, branchId, asilposBranch)) === asilpos.asilpos,
          next: !chain.next || isAsilposDay(chain.next.date, branchSwitchDay(switchDay, branchId, asilposBranch)) === asilpos.asilpos,
        },
      },
    });
  }
  return cards;
}

/** Yöneticinin zilinde bekleyen geç raporlar: istek başına satır ("Geç kasa raporu onay bekliyor") */
export async function lateBellRows(): Promise<{ id: number; bumpedAt: Date; createdAt: Date; title: string; body: string; branchId: string }[]> {
  const rows = await getDb()
    .select({ id: r.id, day: r.day, payload: r.payload, requestedByName: r.requestedByName, bumpedAt: r.bumpedAt, createdAt: r.createdAt })
    .from(r)
    .where(pendingLate)
    .orderBy(asc(r.createdAt));
  return rows.flatMap((x) => {
    const p = LatePayload.safeParse(x.payload);
    if (!x.day || !p.success) return [];
    return [{ id: x.id, bumpedAt: x.bumpedAt, createdAt: x.createdAt, branchId: lateBranchOf(p.data), ...lateBell({ date: x.day, by: x.requestedByName, zTotal: p.data.zTotal, cashDiff: p.data.cashDiff }) }];
  });
}
