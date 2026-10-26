import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, like, lt, lte, ne, or } from "drizzle-orm";

import type { MonthEntry, TillRow } from "@/lib/cash-month";
import {
  defaultCashRecipients,
  integrityOf,
  type CashReportFields,
  type CashReportIntegrity,
  type CashRevisionData,
  type CashRevisionRow,
} from "@/lib/cash-report";
import type { OkcPrev, OkcRow, OkcVatLine } from "@/lib/okc-z";
import { getDb, schema as s } from "@/server/db";

/** Kasa raporunun gideceği adresler ve WhatsApp (integration_state, anahtar "cash.settings"; yönetici değiştirir) */
export interface CashSettings {
  recipients: string[];
  emailEnabled: boolean;
  /** "WhatsApp ile gönder" bu numaranın sohbetini açar; boşsa sohbet seçici (grup da seçilir) */
  whatsapp: string | null;
}

/** Kayıtlı ayar yokken: alıcılar ortamdan (`CASH_REPORT_RECIPIENTS`, src/lib/cash-report.ts), e-posta açık */
export const DEFAULT_CASH_SETTINGS: Omit<CashSettings, "recipients"> = {
  emailEnabled: true,
  whatsapp: null,
};
const KEY = "cash.settings";

export async function loadCashSettings(): Promise<CashSettings> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, KEY)).limit(1);
  const v = (row?.value as Partial<CashSettings> | undefined) ?? {};
  return {
    recipients: Array.isArray(v.recipients) ? v.recipients.filter((x): x is string => typeof x === "string") : defaultCashRecipients(process.env),
    emailEnabled: typeof v.emailEnabled === "boolean" ? v.emailEnabled : DEFAULT_CASH_SETTINGS.emailEnabled,
    whatsapp: typeof v.whatsapp === "string" && v.whatsapp ? v.whatsapp : null,
  };
}

export async function saveCashSettings(value: CashSettings): Promise<void> {
  await getDb()
    .insert(s.integrationState)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

export interface CashReportDTO extends CashReportFields {
  id: number;
  discounts: number | null;
  /** Yazarkasanın (banka POS) mali Z'si (dalga 13): formun alanları, herkese; eski raporlarda boş */
  okcZNo: string | null;
  okcReceipts: number | null;
  okcTotal: number | null;
  okcVatTotal: number | null;
  okcVat: OkcVatLine[] | null;
  okcCash: number | null;
  okcCard: number | null;
  okcMealCard: number | null;
  okcOther: number | null;
  /**
   * Sunucu sütunları (kümülatif ve yazarkasa dışı tahsilat; docs/planlar/okc-z.md §6.1, D17): yalnız yöneticinin
   * DTO'sunda. Personelin DTO'sunda anahtarları hiç yok (RSC yüküne girmez; tests/personel-sizinti-kasa.test.ts)
   */
  okcCumTotal?: number | null;
  okcCumVat?: number | null;
  okcOutside?: number | null;
  /** Personelin DTO'su: toplam dışı tahsilat var (tutarı yok; okc-z.ts K4 fazlayı tutmadı saymaz). Yoksa anahtar yok */
  okcExtraTakings?: true;
  revision: number;
  cashDiff: number;
  submittedBy: number | null;
  submittedByName: string;
  /** Kasayı sayan; eski raporlarda boş (gönderen saymış sayılır) */
  countedBy: number | null;
  countedByName: string | null;
  emailStatus: "sent" | "failed" | "off" | null;
  emailError: string | null;
  emailedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = typeof s.cashReports.$inferSelect;

/** Kim okuyor: yönetici sunucu sütunlarını da alır (kümülatif, yazarkasa dışı tahsilat), personel almaz */
export type CashAudience = "admin" | "staff";

/** Raporun DTO'su; sunucu sütunları yalnız `"admin"` ile (varsayılan personelinki: anahtar yok) */
export function toCashDTO(r: Row, audience: CashAudience = "staff"): CashReportDTO {
  const dto: CashReportDTO = {
    id: r.id,
    date: r.date,
    zNo: r.zNo,
    receipts: r.receipts,
    zTotal: r.zTotal,
    cash: r.cash,
    card: r.card,
    mealCard: r.mealCard,
    online: r.online,
    other: r.other,
    openingCash: r.openingCash,
    cashIn: r.cashIn,
    cashOut: r.cashOut,
    cashOutNote: r.cashOutNote,
    countedCash: r.countedCash,
    handedOver: r.handedOver,
    bankPos: r.bankPos,
    offRevenue: r.offRevenue,
    discounts: r.discounts,
    note: r.note,
    okcZNo: r.okcZNo,
    okcReceipts: r.okcReceipts,
    okcTotal: r.okcTotal,
    okcVatTotal: r.okcVatTotal,
    okcVat: r.okcVat,
    okcCash: r.okcCash,
    okcCard: r.okcCard,
    okcMealCard: r.okcMealCard,
    okcOther: r.okcOther,
    revision: r.revision,
    cashDiff: r.cashDiff,
    submittedBy: r.submittedBy,
    submittedByName: r.submittedByName,
    countedBy: r.countedBy,
    countedByName: r.countedByName,
    emailStatus: r.emailStatus,
    emailError: r.emailError,
    emailedAt: r.emailedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
  if (audience === "admin") return { ...dto, okcCumTotal: r.okcCumTotal, okcCumVat: r.okcCumVat, okcOutside: r.okcOutside };
  return r.okcOutside !== null && r.okcOutside > 1 ? { ...dto, okcExtraTakings: true } : dto;
}

export async function getCashReport(date: string, audience: CashAudience = "staff"): Promise<CashReportDTO | null> {
  const [row] = await getDb().select().from(s.cashReports).where(eq(s.cashReports.date, date)).limit(1);
  return row ? toCashDTO(row, audience) : null;
}

/** [from, to] (ikisi de dahil) günlerinin raporları, en yeni önce */
export async function cashReportsBetween(from: string, to: string, audience: CashAudience = "staff"): Promise<CashReportDTO[]> {
  const rows = await getDb()
    .select()
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to)))
    .orderBy(desc(s.cashReports.date))
    .limit(400);
  return rows.map((r) => toCashDTO(r, audience));
}

/** Bu günden önceki son raporun ertesi güne devri: formun açılış kasası kendiliğinden dolar */
export async function previousCarryOver(date: string): Promise<{ date: string; amount: number } | null> {
  const [row] = await getDb()
    .select({ date: s.cashReports.date, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
    .from(s.cashReports)
    .where(lt(s.cashReports.date, date))
    .orderBy(desc(s.cashReports.date))
    .limit(1);
  return row ? { date: row.date, amount: Math.round((row.counted - row.handed) * 100) / 100 } : null;
}

// ---------------------------------------------------------------- Yazarkasa Z'si (dalga 13; docs/planlar/okc-z.md §5.3, §9)

const okcZSet = and(isNotNull(s.cashReports.okcZNo), ne(s.cashReports.okcZNo, ""));

/**
 * Bu günden önceki son yazarkasa Z'si (plan §5.3): `z` yazarkasa Z no'su dolu son rapor (Z no sırası; personelin
 * formuna yalnız bu gider, D17), `cum` kümülatifi saklanmış (inandırıcı bulunmuş, §6.1) son rapor (zincir, K6; yalnız
 * sunucuda). Zincir hep son saklanan kümülatife bağlanır. İşlem içinden de okunur (writeCashReport).
 */
export async function previousOkc(day: string, db: Db | Tx = getDb()): Promise<OkcPrev> {
  const [[z], [cum]] = await Promise.all([
    db.select({ date: s.cashReports.date, zNo: s.cashReports.okcZNo }).from(s.cashReports).where(and(lt(s.cashReports.date, day), okcZSet)).orderBy(desc(s.cashReports.date)).limit(1),
    db
      .select({ date: s.cashReports.date, zNo: s.cashReports.okcZNo, cumTotal: s.cashReports.okcCumTotal, cumVat: s.cashReports.okcCumVat })
      .from(s.cashReports)
      .where(and(lt(s.cashReports.date, day), okcZSet, isNotNull(s.cashReports.okcCumTotal)))
      .orderBy(desc(s.cashReports.date))
      .limit(1),
  ]);
  return {
    z: z?.zNo ? { date: z.date, zNo: z.zNo } : null,
    cum: cum?.zNo && cum.cumTotal !== null ? { date: cum.date, zNo: cum.zNo, cumTotal: cum.cumTotal, cumVat: cum.cumVat } : null,
  };
}

/** Bu günden sonraki ilk yazarkasa Z'si (geç raporun sonraki halkası, plan §3.8): Z no, günlük toplam, saklanan kümülatif */
export async function nextOkc(day: string, db: Db | Tx = getDb()): Promise<{ date: string; zNo: string; total: number | null; cumTotal: number | null; cumVat: number | null } | null> {
  const [row] = await db
    .select({ date: s.cashReports.date, zNo: s.cashReports.okcZNo, total: s.cashReports.okcTotal, cumTotal: s.cashReports.okcCumTotal, cumVat: s.cashReports.okcCumVat })
    .from(s.cashReports)
    .where(and(gt(s.cashReports.date, day), okcZSet))
    .orderBy(asc(s.cashReports.date))
    .limit(1);
  return row?.zNo ? { date: row.date, zNo: row.zNo, total: row.total, cumTotal: row.cumTotal, cumVat: row.cumVat } : null;
}

/**
 * Ay okuyucusunun satırları ([from, to], ikisi de dahil; src/lib/okc-z.ts okcMonth): ayın zinciri için önceki ayın
 * son saklanan kümülatifi de gerektiğinden çağıran `from`u ayın başından önce verir. Kümülatif sütunları içerir:
 * yalnız yöneticinin ekranları ve sunucu hesapları için
 */
export async function okcRows(from: string, to: string, db: Db | Tx = getDb()): Promise<OkcRow[]> {
  return db
    .select({
      date: s.cashReports.date,
      zTotal: s.cashReports.zTotal,
      okcZNo: s.cashReports.okcZNo,
      okcTotal: s.cashReports.okcTotal,
      okcVatTotal: s.cashReports.okcVatTotal,
      okcVat: s.cashReports.okcVat,
      okcCumTotal: s.cashReports.okcCumTotal,
      okcCumVat: s.cashReports.okcCumVat,
    })
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to)))
    .orderBy(asc(s.cashReports.date));
}

/** İlk yazarkasa Z'li rapor (yöneticinin "Yazarkasa Z yok" rozeti bu günden sonra; plan §3.7, D15) */
export async function firstOkcReportDate(): Promise<string | null> {
  const [row] = await getDb()
    .select({ date: s.cashReports.date })
    .from(s.cashReports)
    .where(or(isNotNull(s.cashReports.okcTotal), isNotNull(s.cashReports.okcCard)))
    .orderBy(asc(s.cashReports.date))
    .limit(1);
  return row?.date ?? null;
}

/** Raporu girilmiş günler (yalnız tarih; personelin zili kapalı gün bildiriminin sonucunda bakar) */
export async function reportedDays(days: readonly string[]): Promise<Set<string>> {
  if (!days.length) return new Set();
  const rows = await getDb()
    .select({ date: s.cashReports.date })
    .from(s.cashReports)
    .where(inArray(s.cashReports.date, [...new Set(days)]));
  return new Set(rows.map((r) => r.date));
}

/** Raporu en çok bu kadar geride olan ilk gün (ay seçicisi için) */
export async function firstCashReportDate(): Promise<string | null> {
  const [row] = await getDb().select({ date: s.cashReports.date }).from(s.cashReports).orderBy(asc(s.cashReports.date)).limit(1);
  return row?.date ?? null;
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Bütün raporların ay bilgisine giden altı sütunu (src/lib/cash-month.ts tillMonths): günde bir rapor, yılda ~365 satır.
 * İşlem içinden de okunur (sabit gider sürümünün dokunmayacağı aylar).
 */
export async function tillRows(db: Db | Tx = getDb()): Promise<TillRow[]> {
  return db
    .select({
      date: s.cashReports.date,
      zTotal: s.cashReports.zTotal,
      card: s.cashReports.card,
      mealCard: s.cashReports.mealCard,
      discounts: s.cashReports.discounts,
      offRevenue: s.cashReports.offRevenue,
    })
    .from(s.cashReports)
    .orderBy(asc(s.cashReports.date));
}

/** Raporun kayıtlı önceki sürümü (ekranda ve zilde düzeltme geçmişi) */
export interface CashRevisionDTO extends CashRevisionRow {
  reportId: number;
  /** Yerine yenisinin geldiği an */
  createdAt: string;
}

/** Raporların önceki sürümleri (rapora ve sürüme göre sıralı); boş liste sorgusuz */
export async function cashRevisionsFor(ids: number[]): Promise<CashRevisionDTO[]> {
  if (!ids.length) return [];
  const rows = await getDb()
    .select()
    .from(s.cashReportRevisions)
    .where(inArray(s.cashReportRevisions.reportId, ids))
    .orderBy(asc(s.cashReportRevisions.reportId), asc(s.cashReportRevisions.revision));
  return rows.map((r) => ({
    reportId: r.reportId,
    revision: r.revision,
    data: r.data as CashRevisionData,
    submittedBy: r.submittedBy,
    submittedByName: r.submittedByName,
    submittedAt: r.submittedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Bu günden sonraki ilk rapor (açılışı bu raporun devriyle karşılaştırılır; varsa personel bu raporu düzeltemez) */
export async function nextReportAfter(date: string): Promise<{ date: string; openingCash: number } | null> {
  const [row] = await getDb()
    .select({ date: s.cashReports.date, openingCash: s.cashReports.openingCash })
    .from(s.cashReports)
    .where(gt(s.cashReports.date, date))
    .orderBy(asc(s.cashReports.date))
    .limit(1);
  return row ?? null;
}

/** "Kasayı sayan" seçeneği: etkin kullanıcılar, ada göre */
export async function cashCounters(): Promise<{ id: number; name: string }[]> {
  return getDb().select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.active, true)).orderBy(asc(s.users.name));
}

/** Kayıtlı raporun bütünlük bilgisi (WhatsApp metni ve e-posta; src/lib/cash-report.ts integrityOf). Üç küçük sorgu */
export async function cashReportIntegrity(r: CashReportDTO): Promise<CashReportIntegrity> {
  const [prev, next, revisions] = await Promise.all([
    previousCarryOver(r.date),
    nextReportAfter(r.date),
    r.revision > 1 ? cashRevisionsFor([r.id]) : Promise.resolve([]),
  ]);
  return integrityOf(r, prev, next, revisions);
}

/** Bu ayın kasa raporu var mı (ay bilgisinin boş alanları oradan dolar) */
export async function hasCashReportIn(month: string, db: Db | Tx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: s.cashReports.id })
    .from(s.cashReports)
    .where(like(s.cashReports.date, `${month}-%`))
    .limit(1);
  return Boolean(row);
}

/** Ayın months satırı (elle yazılanlar; yoksa null): Kasa sayfasındaki ay satırı için */
export async function loadMonthEntry(month: string): Promise<MonthEntry | null> {
  const [row] = await getDb()
    .select({
      month: s.months.month,
      openDays: s.months.openDays,
      posRevenue: s.months.posRevenue,
      discounts: s.months.discounts,
      offRevenue: s.months.offRevenue,
      cardShare: s.months.cardShare,
      note: s.months.note,
    })
    .from(s.months)
    .where(eq(s.months.month, month))
    .limit(1);
  return row ?? null;
}
