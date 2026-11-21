import "server-only";

import { and, asc, count, desc, eq, gt, gte, inArray, lte, max, min, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Model } from "@/lib/calc/engine";
import { businessDate, stampTR } from "@/lib/cash-report";
import { productIkramRefusal } from "@/lib/lafpos/ikram";
import { branchSwitchDay } from "@/lib/lafpos/switch";
import { longDateTR, monthTitleTR, shiftMonth, addDays } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import { LateWastePayload, WasteDeletePayload, wasteEntryMatches, wasteItemText, type LateWastePayloadT, type WasteDeletePayloadT } from "@/lib/waste-requests";
import { lafposSwitchDayOf } from "@/server/data/lafpos-ikram";
import { getDb, schema as s } from "@/server/db";

/*
 * Geç zayi / ikram ve silme isteklerinin okumaları (docs/ZAYI-IKRAM.md › Geç kayıt ve silme isteği; plan
 * docs/planlar/personel-yetki.md §2.8). Personelin okuyucuları önce: türler `zayi-gec` ve `zayi-sil` ile süzülür, yük
 * beyaz listeyle döner (ad, birim, miktar, gün, tür, neden); fiyat, maliyet ve ham yük gitmez (tests/zayi-istek.test.ts
 * sabitler). Yöneticinin okuyucuları ("Yönetici" bölümü) kartın bağlamını ve maliyetini kurar.
 */

const DAY_MS = 86_400_000;
const WASTE_KINDS = ["zayi-gec", "zayi-sil"] as const;

/** Personele giden kalem (yükün beyaz listesi) */
const Lite = z.object({ name: z.string(), unit: z.string(), qty: z.number(), date: z.string(), kind: z.enum(["zayi", "ikram"]), reason: z.string().nullable() });
export type WasteRequestLite = z.output<typeof Lite>;

export interface MyWasteRequest {
  id: number;
  kind: "zayi-gec" | "zayi-sil";
  status: string;
  version: number;
  day: string | null;
  /** Silme isteğinde kaydın kimliği (konudan) */
  entryId: number | null;
  item: WasteRequestLite | null;
  message: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  /** ISO */
  updatedAt: string;
}

/**
 * Kişinin zayi istekleri: bekleyenler ve son 7 günde sonuçlananlar (zil, zayi sayfasının "Onay bekliyor" satırları),
 * en yeni önce. Yükten yalnız beyaz liste.
 */
export async function myWasteRequests(userId: number, now: Date = new Date()): Promise<MyWasteRequest[]> {
  const rows = await getDb()
    .select({
      id: s.staffRequests.id,
      kind: s.staffRequests.kind,
      subject: s.staffRequests.subject,
      status: s.staffRequests.status,
      version: s.staffRequests.version,
      day: s.staffRequests.day,
      body: s.staffRequests.payload,
      message: s.staffRequests.message,
      reviewNote: s.staffRequests.reviewNote,
      reviewedByName: s.staffRequests.reviewedByName,
      updatedAt: s.staffRequests.updatedAt,
    })
    .from(s.staffRequests)
    .where(
      and(
        eq(s.staffRequests.requestedBy, userId),
        inArray(s.staffRequests.kind, ["zayi-gec", "zayi-sil"]),
        or(eq(s.staffRequests.status, "pending"), gt(s.staffRequests.updatedAt, new Date(now.getTime() - 7 * DAY_MS))),
      ),
    )
    .orderBy(desc(s.staffRequests.updatedAt), desc(s.staffRequests.id))
    .limit(60);
  const lite = (p: Record<string, unknown>) => ({ name: p.name, unit: p.unit, qty: p.qty, date: p.date, kind: p.kind, reason: p.reason });
  return rows.map((r) => {
    const source = (r.kind === "zayi-sil" ? (r.body as { entry?: Record<string, unknown> }).entry : r.body) ?? {};
    const item = Lite.safeParse(lite(source as Record<string, unknown>));
    const entryId = r.kind === "zayi-sil" ? Number(r.subject.split(":")[1]) || null : null;
    return {
      id: r.id,
      kind: r.kind as MyWasteRequest["kind"],
      status: r.status,
      version: r.version,
      day: r.day,
      entryId,
      item: item.success ? item.data : null,
      message: r.message,
      reviewNote: r.reviewNote,
      reviewedByName: r.reviewedByName,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/**
 * Kaydın sahibine: son 7 günde başkasının isteğiyle silinen kayıtları ("Kaydınız silindi: … · Ayşe istedi"). Yalnız
 * kalem ve isteyenin adı.
 */
export async function deletedForOwner(userId: number, now: Date = new Date()): Promise<{ id: number; item: WasteRequestLite; by: string; at: string }[]> {
  const rows = await getDb()
    .select({ id: s.staffRequests.id, body: s.staffRequests.payload, by: s.staffRequests.requestedByName, at: s.staffRequests.reviewedAt })
    .from(s.staffRequests)
    .where(
      and(
        eq(s.staffRequests.kind, "zayi-sil"),
        eq(s.staffRequests.status, "approved"),
        gt(s.staffRequests.updatedAt, new Date(now.getTime() - 7 * DAY_MS)),
        sql`(${s.staffRequests.payload} -> 'entry' ->> 'createdBy')::int = ${userId}`,
        or(sql`${s.staffRequests.requestedBy} is null`, ne(s.staffRequests.requestedBy, userId)),
      ),
    )
    .orderBy(desc(s.staffRequests.updatedAt))
    .limit(5);
  return rows.flatMap((r) => {
    const entry = (r.body as { entry?: Record<string, unknown> }).entry ?? {};
    const item = Lite.safeParse({ name: entry.name, unit: entry.unit, qty: entry.qty, date: entry.date, kind: entry.kind, reason: entry.reason });
    return item.success ? [{ id: r.id, item: item.data, by: r.by, at: (r.at ?? now).toISOString() }] : [];
  });
}

/**
 * Bir günün işaretleri (zayi sayfası, iki rol): silinmesi istenen kayıtlar (isteyenin yalnız adı; herkese görünür) ve
 * onayla giren geç kayıtlar ("Geç kayıt · Mehmet onayladı 24 Eki"). Yük okunmaz.
 */
export async function wasteDayMarks(date: string): Promise<{
  deleteAsks: { entryId: number; requestId: number; by: string; byId: number | null }[];
  lateApprovals: { entryId: number; by: string; at: string }[];
}> {
  const rows = await getDb()
    .select({
      id: s.staffRequests.id,
      kind: s.staffRequests.kind,
      subject: s.staffRequests.subject,
      status: s.staffRequests.status,
      requestedBy: s.staffRequests.requestedBy,
      requestedByName: s.staffRequests.requestedByName,
      reviewedByName: s.staffRequests.reviewedByName,
      reviewedAt: s.staffRequests.reviewedAt,
      resultId: s.staffRequests.resultId,
    })
    .from(s.staffRequests)
    .where(
      and(
        eq(s.staffRequests.day, date),
        or(and(eq(s.staffRequests.kind, "zayi-sil"), eq(s.staffRequests.status, "pending")), and(eq(s.staffRequests.kind, "zayi-gec"), eq(s.staffRequests.status, "approved"))),
      ),
    )
    .orderBy(asc(s.staffRequests.id));
  return {
    deleteAsks: rows
      .filter((r) => r.kind === "zayi-sil")
      .map((r) => ({ entryId: Number(r.subject.split(":")[1]), requestId: r.id, by: r.requestedByName, byId: r.requestedBy }))
      .filter((r) => r.entryId > 0),
    lateApprovals: rows
      .filter((r) => r.kind === "zayi-gec" && r.resultId !== null)
      .map((r) => ({ entryId: r.resultId!, by: r.reviewedByName ?? "Yönetici", at: (r.reviewedAt ?? new Date()).toISOString() })),
  };
}

// ---------------------------------------------------------------- Yönetici

/** Bekleyen zayi istekleri: sayı, en eski, ilk kart ve zil kimliği (en yeni bump); gün ya da ay süzgeciyle */
export async function pendingWasteSummary(f: { day?: string; month?: string } = {}): Promise<{ count: number; oldestAt: Date | null; firstId: number | null; bumped: Date | null }> {
  const r = s.staffRequests;
  const where = and(
    inArray(r.kind, [...WASTE_KINDS]),
    eq(r.status, "pending"),
    f.day ? eq(r.day, f.day) : undefined,
    f.month ? and(gte(r.day, `${f.month}-01`), lte(r.day, addDays(`${shiftMonth(f.month, 1)}-01`, -1))) : undefined,
  );
  const [[agg], [first]] = await Promise.all([
    getDb()
      .select({ n: count(), oldest: min(r.createdAt), bumped: max(r.bumpedAt) })
      .from(r)
      .where(where),
    getDb()
      .select({ id: r.id })
      .from(r)
      .where(where)
      .orderBy(asc(r.createdAt), asc(r.id))
      .limit(1),
  ]);
  return { count: agg?.n ?? 0, oldestAt: agg?.oldest ?? null, firstId: first?.id ?? null, bumped: agg?.bumped ?? null };
}

interface CardBase {
  id: number;
  version: number;
  title: string;
  requestedBy: number | null;
  requestedByName: string;
  /** ISO */
  createdAt: string;
  waited: string;
  message: string | null;
  /** "15 Ekim Çarşamba" */
  dayLong: string;
  date: string;
  item: string;
}

export interface LateWasteCard extends CardBase {
  kind: "zayi-gec";
  p: LateWastePayloadT;
  /** Malzeme maliyeti (KDV hariç, bugünkü fiyatlarla; engine wasteCost) ve ikramda menü değeri */
  cost: number;
  menuValue: number | null;
  /** O gün aynı kalemden kayıtlar: "2× Latte M (Mehmet 21:40)" */
  sameDay: string[];
  /** Aynı gün ve kalem için başka bekleyen istekler (isteyenin adı) */
  otherPending: string[];
  report: { exists: boolean; emailed: boolean; offRevenue: number | null };
  /**
   * İkramda: o günün sayılan ikramının menü değeri (Z ödenmez ile karşılaştırma; motorun saydığı kayıtlar). LafPOS'un
   * gün sonu gelen günde LafPOS'un listesinin tamamı (ikram ve zayi satırları: LafPOS'un ödenmez tutarı ikisini kapsar)
   */
  ikramRecorded: number | null;
  /** O günün ikramı LafPOS'un gün sonundan (karşılaştırma LafPOS'un kendi iki rakamı) */
  ikramFromLafpos: boolean;
  /** "Ekim sayımı girilmiş: onaylanırsa tutarlılık değişir" */
  countDone: string | null;
  /**
   * Ürün ikramı o güne panelden kapalı (LafPOS gününde gün sonu geldi ya da gün bugün; geçiş günü ya da gün sonu
   * istekten sonra geldi): onaylanmaz, reddedilir (src/lib/lafpos/ikram.ts productIkramClosed); metni, değilse null
   */
  lafposRefusal: string | null;
}

export interface WasteDeleteCard extends CardBase {
  kind: "zayi-sil";
  entry: WasteDeletePayloadT["entry"];
  entryId: number;
  /** Kayıt yok ya da istekten sonra değişti (onay "Kapat" olur) */
  gone: boolean;
  /** "Mehmet girdi · 15 Eki 21:40" */
  enteredText: string;
  /** Kayıt o günün kasa raporu e-postasına girdi */
  inReportMail: boolean;
}

export type WasteRequestCard = LateWasteCard | WasteDeleteCard;

/** Onaylar › Zayi ve ikram: bekleyen istekler, en eski gün önce; maliyet modeli bölümden (loadModelOnce) */
export async function loadWasteRequestQueue(model: Model, now: Date = new Date()): Promise<WasteRequestCard[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(s.staffRequests)
    .where(and(inArray(s.staffRequests.kind, [...WASTE_KINDS]), eq(s.staffRequests.status, "pending")))
    .orderBy(asc(s.staffRequests.day), asc(s.staffRequests.createdAt), asc(s.staffRequests.id));
  if (!rows.length) return [];
  const days = [...new Set(rows.map((r) => r.day).filter((d): d is string => !!d))];
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const [entries, reports, counted] = await Promise.all([
    db.select().from(s.wasteEntries).where(inArray(s.wasteEntries.date, days)),
    db
      .select({ date: s.cashReports.date, emailedAt: s.cashReports.emailedAt, offRevenue: s.cashReports.offRevenue })
      .from(s.cashReports)
      .where(inArray(s.cashReports.date, days)),
    db
      .select({ month: s.stockCounts.month, n: count() })
      .from(s.stockCounts)
      .where(inArray(s.stockCounts.month, months))
      .groupBy(s.stockCounts.month),
  ]);
  const reportOf = new Map(reports.map((r) => [r.date, r]));
  const countedMonths = new Set(counted.filter((c) => c.n > 0).map((c) => c.month));
  const time = (d: Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(d);
  const productPrice = (id: number | null) => (id !== null ? (model.productById.get(id)?.price ?? null) : null);
  // LafPOS'un gün sonu gelen günleri (geçiş günü seçiliyse, ondan itibaren; yoksa boş) ve iş günü. Geçiş günü ayarın
  // kendisi (veri kümesindeki görünümün kasasınınki değil); isteğin şubesine göre uygulanır (branchSwitchDay)
  const switchDay = await lafposSwitchDayOf(db);
  const lafposDays = new Set(model.ds.lafposIkram?.days ?? []);
  const today = businessDate(now);
  /** Günün sayılan ikramının menü değeri: LafPOS satırı kendi değeriyle (zayi dahil), panelin ürün ikramı menü fiyatıyla */
  const ikramValueOf = (date: string) =>
    model.countedWaste
      .filter((w) => w.date === date)
      .reduce((a, w) => a + (w.source === "lafpos" ? (w.menuValue ?? 0) : w.kind === "ikram" && w.productId !== null ? (productPrice(w.productId) ?? 0) * w.qty : 0), 0);

  return rows.flatMap((r): WasteRequestCard[] => {
    const base = {
      id: r.id,
      version: r.version,
      title: r.title,
      requestedBy: r.requestedBy,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt.toISOString(),
      waited: waitedText(r.createdAt, now),
      message: r.message,
    };
    const report = r.day ? reportOf.get(r.day) : undefined;
    if (r.kind === "zayi-gec") {
      const parsed = LateWastePayload.safeParse(r.payload);
      if (!parsed.success) return [];
      const p = parsed.data;
      const same = (e: { kind: string; productId: number | null; ingredientId: number | null }) => e.kind === p.kind && e.productId === p.productId && e.ingredientId === p.ingredientId;
      const dayEntries = entries.filter((e) => e.date === p.date);
      const others = rows.filter((o) => o.id !== r.id && o.kind === "zayi-gec" && o.day === p.date).flatMap((o) => {
        const op = LateWastePayload.safeParse(o.payload);
        return op.success && same(op.data) ? [o.requestedByName] : [];
      });
      const menu = p.kind === "ikram" ? productPrice(p.productId) : null;
      const ikramRecorded = p.kind === "ikram" ? ikramValueOf(p.date) : null;
      return [
        {
          ...base,
          kind: "zayi-gec",
          date: p.date,
          dayLong: longDateTR(p.date),
          item: wasteItemText(p),
          p,
          cost: Math.round(model.wasteCost(p) * 100) / 100,
          menuValue: menu !== null ? Math.round(menu * p.qty * 100) / 100 : null,
          sameDay: dayEntries.filter(same).map((e) => `${wasteItemText(e)} (${e.createdByName} ${time(e.createdAt)})`),
          otherPending: [...new Set(others)],
          report: { exists: !!report, emailed: !!report?.emailedAt, offRevenue: report?.offRevenue ?? null },
          ikramRecorded: ikramRecorded !== null ? Math.round(ikramRecorded * 100) / 100 : null,
          ikramFromLafpos: lafposDays.has(p.date),
          countDone: countedMonths.has(p.date.slice(0, 7)) ? `${monthTitleTR(p.date.slice(0, 7)).split(" ")[0]} sayımı girilmiş: onaylanırsa tutarlılık değişir` : null,
          lafposRefusal: productIkramRefusal(p, branchSwitchDay(switchDay, p.branchId), { received: lafposDays.has(p.date), today }, "onay"),
        },
      ];
    }
    const parsed = WasteDeletePayload.safeParse(r.payload);
    if (!parsed.success) return [];
    const p = parsed.data;
    const current = entries.find((e) => e.id === p.entryId);
    const gone = !current || !wasteEntryMatches(p.entry, current);
    const createdAt = new Date(p.entry.createdAt);
    return [
      {
        ...base,
        kind: "zayi-sil",
        date: p.entry.date,
        dayLong: longDateTR(p.entry.date),
        item: wasteItemText(p.entry),
        entry: p.entry,
        entryId: p.entryId,
        gone,
        enteredText: `${p.entry.createdByName} girdi · ${stampTR(p.entry.createdAt)}`,
        inReportMail: !gone && !!report?.emailedAt && report.emailedAt.getTime() > createdAt.getTime(),
      },
    ];
  });
}
