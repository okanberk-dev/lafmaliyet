import "server-only";

import { and, asc, count, desc, eq, gt, gte, inArray, lte, max, min, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { ALL_BRANCHES, type BranchScope, DEFAULT_BRANCH_ID, namedTill, requestInScope } from "@/lib/branches";
import type { Model } from "@/lib/calc/engine";
import { businessDate, stampTR } from "@/lib/cash-report";
import type { Role } from "@/lib/constants";
import { productIkramRefusal, recordedOffRevenue } from "@/lib/asilpos/ikram";
import { switchDayFor, tillDayKey } from "@/lib/pos/tills";
import { longDateTR, monthTitleTR, shiftMonth, addDays } from "@/lib/reminders";
import { waitedText } from "@/lib/staff-requests";
import { LateWastePayload, WasteDeletePayload, wasteEntryMatches, wasteItemText, type LateWastePayloadT, type WasteDeletePayloadT } from "@/lib/waste-requests";
import { listBranches } from "@/server/branches";
import { asilposSwitchDaysOf } from "@/server/data/asilpos-ikram";
import { getDb, schema as s } from "@/server/db";
import { requestBranches } from "@/server/staff-requests/branch";

/*
 * Geç zayi / ikram ve silme isteklerinin okumaları (docs/ZAYI-IKRAM.md › Geç kayıt ve silme isteği; plan
 * docs/planlar/personel-yetki.md §2.8). Personelin okuyucuları önce: türler `zayi-gec` ve `zayi-sil` ile süzülür, yük
 * beyaz listeyle döner (ad, birim, miktar, gün, tür, neden); fiyat, maliyet ve ham yük gitmez (tests/zayi-istek.test.ts
 * sabitler). Yöneticinin okuyucuları ("Yönetici" bölümü) kartın bağlamını ve maliyetini kurar; müdüre kart maliyetsiz
 * gider (`wasteCardsFor`).
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

/**
 * Bekleyen zayi istekleri: sayı, en eski, ilk kart ve zil kimliği (en yeni bump); gün ya da ay süzgeciyle. `scope`: tek
 * şube seçiliyken yalnız o şubenin istekleri (şube kapsamı C P1-1; geç kaydın yükteki şubesi, silmenin kaydının şubesi)
 */
export async function pendingWasteSummary(
  f: { day?: string; month?: string; scope?: BranchScope } = {},
): Promise<{ count: number; oldestAt: Date | null; firstId: number | null; bumped: Date | null }> {
  const r = s.staffRequests;
  const where = and(
    inArray(r.kind, [...WASTE_KINDS]),
    eq(r.status, "pending"),
    f.day ? eq(r.day, f.day) : undefined,
    f.month ? and(gte(r.day, `${f.month}-01`), lte(r.day, addDays(`${shiftMonth(f.month, 1)}-01`, -1))) : undefined,
  );
  if (f.scope && f.scope !== ALL_BRANCHES) {
    // Şube yükte ya da kaydın kendisinde: satırlar okunup şubeyle süzülür (bekleyen istek az)
    const scope = f.scope;
    const db = getDb();
    const rows = await db
      .select({ id: r.id, kind: r.kind, subject: r.subject, payload: r.payload, createdAt: r.createdAt, bumpedAt: r.bumpedAt })
      .from(r)
      .where(where)
      .orderBy(asc(r.createdAt), asc(r.id));
    const branchOf = rows.length ? await requestBranches(db, rows) : new Map<number, string | null>();
    const kept = rows.filter((x) => requestInScope(branchOf.get(x.id) ?? null, scope));
    return {
      count: kept.length,
      oldestAt: kept[0]?.createdAt ?? null,
      firstId: kept[0]?.id ?? null,
      bumped: kept.length ? new Date(Math.max(...kept.map((x) => x.bumpedAt.getTime()))) : null,
    };
  }
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
  /**
   * İsteğin şubesi (birden çok kasa açıkken; tek kasada null): kartta adı, "Günü aç"ta `?sube=`. Bağlam (kasa raporu,
   * o günün kayıtları, kayıtlı ikram) bu şubeden okunur, onay da buraya yazar
   */
  branch: { id: string; name: string } | null;
  /** İsteğin şubesi (Onaylar tek şube seçiliyken bununla süzer); silinecek kayıt gitmişse null */
  branchId: string | null;
}

export interface LateWasteCard extends CardBase {
  kind: "zayi-gec";
  p: LateWastePayloadT;
  /**
   * Malzeme maliyeti (KDV hariç, bugünkü fiyatlarla; engine wasteCost): yalnız yöneticinin kartında; müdürün kartında
   * anahtar yok (docs/ROLLER.md › Müdür; `wasteCardsFor`)
   */
  cost?: number;
  /** İkramda menü değeri (menü fiyatıyla; müdür de görür) */
  menuValue: number | null;
  /** O gün aynı kalemden kayıtlar: "2× Latte M (Mehmet 21:40)" */
  sameDay: string[];
  /** Aynı gün ve kalem için başka bekleyen istekler (isteyenin adı) */
  otherPending: string[];
  report: { exists: boolean; emailed: boolean; offRevenue: number | null };
  /**
   * İkramda: o günün sayılan ikramının menü değeri (Z ödenmez ile karşılaştırma; motorun saydığı kayıtlar). AsilPOS'un
   * gün sonu gelen günde AsilPOS'un listesinin tamamı (ikram ve zayi satırları: AsilPOS'un ödenmez tutarı ikisini kapsar)
   */
  ikramRecorded: number | null;
  /** O günün ikramı AsilPOS'un gün sonundan (karşılaştırma AsilPOS'un kendi iki rakamı) */
  ikramFromAsilpos: boolean;
  /** "Ekim sayımı girilmiş: onaylanırsa tutarlılık değişir" */
  countDone: string | null;
  /**
   * Ürün ikramı o güne panelden kapalı (AsilPOS gününde gün sonu geldi ya da gün bugün; geçiş günü ya da gün sonu
   * istekten sonra geldi): onaylanmaz, reddedilir (src/lib/asilpos/ikram.ts productIkramClosed); metni, değilse null
   */
  asilposRefusal: string | null;
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

/**
 * Onaylar › Zayi ve ikram: bekleyen istekler, en eski gün önce. Kartın bağlamı isteğin şubesinden, yöneticinin şube
 * seçiminden değil (docs/SUBE.md › Kasa raporu "Tümü"de; denetim 21 Kasım #28): geç kayıtta isteği açanın şubesi (yük;
 * bu alandan önceki isteklerde Tuzla, onay da oraya yazar), silmede kaydın şubesi. Günün kasa raporu (Z ödenmez,
 * gönderildi mi), o günün aynı kalemden kayıtları, aynı kalemin bekleyen öteki istekleri, kayıtlı ikram ve AsilPOS
 * günleri o şubenin; maliyet modeli de şubenin kapsamıyla (`modelOf`; Onaylar'da istek başına şube başına bir kez,
 * loadBranchModelOnce). Önceden günle okunuyordu: Marina'nın isteği Tuzla'nın raporunu ve iki şubenin ikramını gösteriyordu.
 */
export async function loadWasteRequestQueue(modelOf: (branchId: string) => Promise<Model>, now: Date = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<WasteRequestCard[]> {
  const db = getDb();
  // Tek şube seçiliyken öbür şubenin geç kayıt istekleri baştan düşer (modeli de yüklenmez); silme isteği kaydın şubesiyle
  // sonda süzülür (şube kapsamı C P1-1)
  const rows = (
    await db
      .select()
      .from(s.staffRequests)
      .where(and(inArray(s.staffRequests.kind, [...WASTE_KINDS]), eq(s.staffRequests.status, "pending")))
      .orderBy(asc(s.staffRequests.day), asc(s.staffRequests.createdAt), asc(s.staffRequests.id))
  ).filter((r) => {
    if (r.kind !== "zayi-gec") return true;
    const p = LateWastePayload.safeParse(r.payload);
    return !p.success || requestInScope(p.data.branchId ?? DEFAULT_BRANCH_ID, scope);
  });
  if (!rows.length) return [];
  const days = [...new Set(rows.map((r) => r.day).filter((d): d is string => !!d))];
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const [entries, reports, counted, branches] = await Promise.all([
    db.select().from(s.wasteEntries).where(inArray(s.wasteEntries.date, days)),
    db
      .select({ date: s.cashReports.date, branchId: s.cashReports.branchId, emailedAt: s.cashReports.emailedAt, offRevenue: s.cashReports.offRevenue })
      .from(s.cashReports)
      .where(inArray(s.cashReports.date, days)),
    db
      .select({ month: s.stockCounts.month, n: count() })
      .from(s.stockCounts)
      .where(inArray(s.stockCounts.month, months))
      .groupBy(s.stockCounts.month),
    listBranches(db),
  ]);
  // Rapor şubenin günüyle: aynı güne iki şubenin raporu düşer (günle anahtarlanınca biri ötekini eziyordu)
  const reportOf = new Map(reports.map((r) => [`${r.date}|${r.branchId}`, r]));
  /** Geç kayıt isteğinin şubesi: yükteki (isteği açanın); bu alandan önceki isteklerde Tuzla (onay da oraya yazar) */
  const lateBranch = (p: LateWastePayloadT) => p.branchId ?? DEFAULT_BRANCH_ID;
  // Maliyet modeli yalnız geç kayıt kartlarının şubeleri için (silme kartı modeli okumaz), şube başına bir kez
  const lateBranches = new Set(
    rows.flatMap((r) => {
      const p = r.kind === "zayi-gec" ? LateWastePayload.safeParse(r.payload) : null;
      return p?.success ? [lateBranch(p.data)] : [];
    }),
  );
  const models = new Map(await Promise.all([...lateBranches].map(async (b) => [b, await modelOf(b)] as const)));
  const countedMonths = new Set(counted.filter((c) => c.n > 0).map((c) => c.month));
  const time = (d: Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(d);
  const productPrice = (model: Model, id: number | null) => (id !== null ? (model.productById.get(id)?.price ?? null) : null);
  // Geçiş günü isteğin şubesinin kasasınınki (çok şube; switchDayFor). AsilPOS'un gün sonu gelen günleri şubenin
  // modelinden (kasası AsilPOS olan şubede geçiş gününden itibaren; ModPOS'ta kalan şubede boş) ve iş günü
  const switchDays = await asilposSwitchDaysOf(db);
  const today = businessDate(now);
  /**
   * Günün sayılan ikramının menü değeri (şubenin modeli; Z'nin ödenmez tutarıyla karşılaştırılır): AsilPOS satırı kendi
   * değeriyle (zayi dahil, hazırlanmış iptal hariç: ödenmez tutarında yok), panelin ürün ikramı menü fiyatıyla
   */
  const ikramValueOf = (model: Model, date: string) =>
    recordedOffRevenue(
      model.countedWaste.filter((w) => w.date === date),
      (id) => productPrice(model, id),
    );

  const cards = rows.flatMap((r): WasteRequestCard[] => {
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
    if (r.kind === "zayi-gec") {
      const parsed = LateWastePayload.safeParse(r.payload);
      if (!parsed.success) return [];
      const p = parsed.data;
      const sube = lateBranch(p);
      const model = models.get(sube)!;
      const report = reportOf.get(`${p.date}|${sube}`);
      const same = (e: { kind: string; productId: number | null; ingredientId: number | null }) => e.kind === p.kind && e.productId === p.productId && e.ingredientId === p.ingredientId;
      const dayEntries = entries.filter((e) => e.date === p.date && e.branchId === sube);
      const others = rows.filter((o) => o.id !== r.id && o.kind === "zayi-gec" && o.day === p.date).flatMap((o) => {
        const op = LateWastePayload.safeParse(o.payload);
        return op.success && same(op.data) && lateBranch(op.data) === sube ? [o.requestedByName] : [];
      });
      const menu = p.kind === "ikram" ? productPrice(model, p.productId) : null;
      const ikramRecorded = p.kind === "ikram" ? ikramValueOf(model, p.date) : null;
      const asilposDays = new Set(model.ds.asilposIkram?.tillDays ?? []);
      return [
        {
          ...base,
          kind: "zayi-gec",
          date: p.date,
          dayLong: longDateTR(p.date),
          item: wasteItemText(p),
          branch: namedTill(branches, sube),
          branchId: sube,
          p,
          cost: Math.round(model.wasteCost(p) * 100) / 100,
          menuValue: menu !== null ? Math.round(menu * p.qty * 100) / 100 : null,
          sameDay: dayEntries.filter(same).map((e) => `${wasteItemText(e)} (${e.createdByName} ${time(e.createdAt)})`),
          otherPending: [...new Set(others)],
          report: { exists: !!report, emailed: !!report?.emailedAt, offRevenue: report?.offRevenue ?? null },
          ikramRecorded: ikramRecorded !== null ? Math.round(ikramRecorded * 100) / 100 : null,
          ikramFromAsilpos: asilposDays.has(p.date),
          countDone: countedMonths.has(p.date.slice(0, 7)) ? `${monthTitleTR(p.date.slice(0, 7)).split(" ")[0]} sayımı girilmiş: onaylanırsa tutarlılık değişir` : null,
          asilposRefusal: productIkramRefusal(p, switchDayFor(switchDays, p.branchId), { received: asilposDays.has(tillDayKey(p.branchId, p.date)), today }, "onay"),
        },
      ];
    }
    const parsed = WasteDeletePayload.safeParse(r.payload);
    if (!parsed.success) return [];
    const p = parsed.data;
    const current = entries.find((e) => e.id === p.entryId);
    const gone = !current || !wasteEntryMatches(p.entry, current);
    const createdAt = new Date(p.entry.createdAt);
    // Kaydın kendi şubesinin raporu (kayıt yoksa e-posta uyarısı da yok)
    const report = current ? reportOf.get(`${current.date}|${current.branchId}`) : undefined;
    return [
      {
        ...base,
        kind: "zayi-sil",
        date: p.entry.date,
        dayLong: longDateTR(p.entry.date),
        item: wasteItemText(p.entry),
        branch: current ? namedTill(branches, current.branchId) : null,
        branchId: current?.branchId ?? null,
        entry: p.entry,
        entryId: p.entryId,
        gone,
        enteredText: `${p.entry.createdByName} girdi · ${stampTR(p.entry.createdAt)}`,
        inReportMail: !gone && !!report?.emailedAt && report.emailedAt.getTime() > createdAt.getTime(),
      },
    ];
  });
  return cards.filter((c) => requestInScope(c.branchId, scope));
}

/**
 * Onaylar › Zayi ve ikram kartlarının bakana giden hali (docs/ROLLER.md › Müdür): yönetici hepsini maliyetiyle; müdür
 * yalnız şubesininkileri (şubesi bilinmeyen kart düşer), malzeme maliyeti olmadan. Süzme sunucuda: maliyet müdürün
 * tarayıcısına (RSC yükü) gitmez.
 */
export function wasteCardsFor(viewer: { role: Role; branchId?: string | null }, cards: WasteRequestCard[]): WasteRequestCard[] {
  if (viewer.role === "admin") return cards;
  return cards.flatMap((c): WasteRequestCard[] => {
    if (c.branchId === null || c.branchId !== viewer.branchId) return [];
    if (c.kind !== "zayi-gec") return [c];
    const copy: LateWasteCard = { ...c };
    delete copy.cost;
    return [copy];
  });
}
