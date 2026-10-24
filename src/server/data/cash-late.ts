import "server-only";

import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { businessDate, carryCheck, LATE_REPORT_DAYS, lateMissingDays, type CarryCheck, type CashReportFields } from "@/lib/cash-report";
import { cashOutsTotal } from "@/lib/cash-outs";
import { handedToText, lateBell, lateByText, LatePayload, lateFields, type LatePayloadT } from "@/lib/cash-requests";
import { money } from "@/lib/format";
import { photoDiffs, savedFields, type CashReading, type PhotoDiff } from "@/lib/photo-read/kasa";
import { addDays, dayLocativeTR, monthGenitiveTR, todayTR } from "@/lib/reminders";
import { waitedText, type StaffRequestStatus } from "@/lib/staff-requests";
import { chainNeighbours, type ChainLink } from "@/server/cash/late-chain";
import { closedDaysBetween } from "@/server/closed-days";
import { cashOutsOn } from "@/server/data/cash-outs";
import { heldPhotoInfo, type CashPhotoDTO } from "@/server/data/cash-photos";
import { loadMonthEntry } from "@/server/data/cash-reports";
import { getDb, schema as s } from "@/server/db";

/*
 * Geç kasa raporunun okuyucuları (docs/KASA-RAPORU.md › Geç rapor; plan docs/planlar/personel-yetki.md §2.6). Personelin
 * okuyucuları (staffLateDays, lateRequestFor) sabit sütunla: kişinin kendi isteğinde kendi yazdığı sayılar ve kendi
 * fotoğrafları, başkasınınkinde yalnız ad ve an (tests/personel-sizinti-kasa.test.ts). Yöneticinin kartı
 * (lateCards: fotoğraflar ve okumaları, Z no sırası, zincir, ay, kasadan çıkanlar) yalnız Onaylar'da.
 */

const r = s.staffRequests;
const pendingLate = and(eq(r.kind, "kasa-gec"), eq(r.status, "pending"));

/** Personelin "Girilmemiş günler"i: geç rapor penceresinin raporsuz, kapalı olmayan günleri ve istek durumu */
export async function staffLateDays(me: { id: number }, now = new Date()): Promise<{ date: string; state: "missing" | "pending" | "rejected" }[]> {
  const day = businessDate(now);
  const from = addDays(day, -LATE_REPORT_DAYS);
  const to = addDays(day, -2);
  const db = getDb();
  const [reports, [first], closed, requests] = await Promise.all([
    db
      .select({ date: s.cashReports.date })
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to))),
    db.select({ date: s.cashReports.date }).from(s.cashReports).orderBy(asc(s.cashReports.date)).limit(1),
    closedDaysBetween(from, to),
    db
      .select({ day: r.day, status: r.status, requestedBy: r.requestedBy })
      .from(r)
      .where(and(eq(r.kind, "kasa-gec"), gte(r.day, from), lte(r.day, to)))
      .orderBy(asc(r.createdAt)),
  ]);
  const state = new Map<string, "pending" | "rejected">();
  for (const q of requests) {
    if (!q.day) continue;
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
  );
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
    .where(and(eq(r.kind, "kasa-gec"), eq(r.subject, `gun:${date}`)))
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

/** Bekleyen geç raporlar, güne göre (Günden güne: "Onay bekliyor · Ayşe girdi · İncele") */
export async function pendingLateByDay(from: string, to: string): Promise<Record<string, { id: number; requestedByName: string }[]>> {
  const rows = await getDb()
    .select({ id: r.id, day: r.day, requestedByName: r.requestedByName })
    .from(r)
    .where(and(pendingLate, gte(r.day, from), lte(r.day, to)))
    .orderBy(asc(r.createdAt));
  const out: Record<string, { id: number; requestedByName: string }[]> = {};
  for (const x of rows) if (x.day) (out[x.day] ??= []).push({ id: x.id, requestedByName: x.requestedByName });
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
  /** Ay satırı ("Ekim'in açık gün ve POS cirosuna girer" …) */
  monthLine: string;
  /** O güne kayıtlı kasadan çıkanlar ve rapordaki tutarla farkı */
  outs: { count: number; total: number; warning: string | null };
  /** Gün artık raporlu: onay kapalı, isteği reddedin */
  reported: boolean;
  /** Aynı aralıkta daha eski bekleyen gün (onay kapalı) */
  olderPending: string | null;
}

/** Ay satırı: geç rapor ayın açık gün ve POS cirosuna girer mi */
function monthLineOf(date: string, today: string, first: string | null, entry: { openDays: number | null; posRevenue: number | null } | null): string {
  const month = date.slice(0, 7);
  const gen = monthGenitiveTR(month);
  if (entry && entry.openDays !== null && entry.posRevenue !== null) return `${gen} açık gün ve POS cirosu elle yazılmış; bu rapor değiştirmez`;
  if (first && first.slice(0, 7) === month && first > `${month}-01`) return "Kasa raporları ay ortasında başladı; bu ayın ciro ve açık günü elle girilir, bu rapor değiştirmez";
  if (month < today.slice(0, 7)) return `Kapanmış ay: ${gen} açık gün ve POS cirosu bu raporla değişir (Satışlar ve kâr)`;
  return `${gen} açık gün ve POS cirosuna girer`;
}

/** Bekleyen geç raporların kartları, en eski gün önce (yalnız yönetici; src/server/data/cash-requests.ts toplar) */
export async function lateCards(now = new Date()): Promise<LateCard[]> {
  const db = getDb();
  const rows = await db
    .select({ id: r.id, version: r.version, day: r.day, payload: r.payload, message: r.message, requestedByName: r.requestedByName, createdAt: r.createdAt })
    .from(r)
    .where(pendingLate)
    .orderBy(asc(r.day), asc(r.createdAt));
  if (!rows.length) return [];
  const today = businessDate(now);
  const days = [...new Set(rows.flatMap((x) => (x.day ? [x.day] : [])))];
  const [reported, [first]] = await Promise.all([
    db.select({ date: s.cashReports.date }).from(s.cashReports).where(inArray(s.cashReports.date, days)),
    db.select({ date: s.cashReports.date }).from(s.cashReports).orderBy(asc(s.cashReports.date)).limit(1),
  ]);
  const reportedDays = new Set(reported.map((x) => x.date));
  const cards: LateCard[] = [];
  for (const x of rows) {
    const parsed = LatePayload.safeParse(x.payload);
    if (!x.day || !parsed.success) continue;
    const p = parsed.data;
    const date = x.day;
    const fields = lateFields(p);
    const [photos, chain, outs, entry] = await Promise.all([heldPhotoInfo(p.photos.map((ph) => ph.id), date), chainNeighbours(db, date, { exceptRequestId: x.id }), cashOutsOn(date), loadMonthEntry(date.slice(0, 7))]);
    const carry = Math.round((fields.countedCash - fields.handedOver) * 100) / 100;
    const prevCheck = chain.prev ? carryCheck(date, fields.openingCash, { date: chain.prev.date, amount: chain.prev.carry }) : null;
    const nextCheck = chain.next ? carryCheck(chain.next.date, chain.next.openingCash, { date, amount: carry }) : null;
    // Aynı aralıkta (önceki rapordan bu yana) daha eski bekleyen gün: onay kapalı
    const prevReportDate = chain.prev?.kind === "rapor" ? chain.prev.date : null;
    const older = rows.find((o) => o.id !== x.id && o.day && o.day < date && (!prevReportDate || o.day > prevReportDate) && !reportedDays.has(o.day));
    const outsTotal = cashOutsTotal(outs);
    const outsGap = Math.round((fields.cashOut - outsTotal) * 100) / 100;
    cards.push({
      kind: "kasa-gec",
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
      unread: !photos.readings.length,
      readings: photos.readings,
      chain: { ...chain, prevCheck, nextCheck },
      monthLine: monthLineOf(date, today, first?.date ?? null, entry),
      outs: {
        count: outs.length,
        total: outsTotal,
        warning: Math.abs(outsGap) >= 1 ? `Gün içinde çıkan ${money(fields.cashOut)}; o güne kayıtlı kasadan çıkan ${money(outsTotal)}${outsGap > 0 ? ` (${money(outsGap)} fişsiz)` : ""}` : null,
      },
      reported: reportedDays.has(date),
      olderPending: older?.day ?? null,
    });
  }
  return cards;
}

/** Yöneticinin zilinde bekleyen geç raporlar: istek başına satır ("Geç kasa raporu onay bekliyor") */
export async function lateBellRows(): Promise<{ id: number; bumpedAt: Date; createdAt: Date; title: string; body: string }[]> {
  const rows = await getDb()
    .select({ id: r.id, day: r.day, payload: r.payload, requestedByName: r.requestedByName, bumpedAt: r.bumpedAt, createdAt: r.createdAt })
    .from(r)
    .where(pendingLate)
    .orderBy(asc(r.createdAt));
  return rows.flatMap((x) => {
    const p = LatePayload.safeParse(x.payload);
    if (!x.day || !p.success) return [];
    return [{ id: x.id, bumpedAt: x.bumpedAt, createdAt: x.createdAt, ...lateBell({ date: x.day, by: x.requestedByName, zTotal: p.data.zTotal, cashDiff: p.data.cashDiff }) }];
  });
}
