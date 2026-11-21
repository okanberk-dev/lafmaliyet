import "server-only";

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, like, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { modposRunStart, tillKey, type MonthEntry, type TillRow } from "@/lib/cash-month";
import {
  defaultCashRecipients,
  integrityOf,
  type CashReportFields,
  type CashReportIntegrity,
  type CashRevisionData,
  type CashRevisionRow,
} from "@/lib/cash-report";
import { readLafposSwitchDay } from "@/lib/constants";
import { posZSchema } from "@/lib/lafpos/day";
import { LAFPOS_SWITCH_KEY } from "@/lib/lafpos/switch";
import { MODPOS_FALLBACK_KEY, readModposFallback } from "@/lib/modpos/status";
import { foyZ } from "@/lib/modpos/z";
import type { OkcPrev, OkcRow, OkcVatLine } from "@/lib/okc-z";
import { addDays } from "@/lib/reminders";
import { emailErrorFor } from "@/lib/staff-errors";
import { andWhere, currentBranchWhere, currentTillBranch } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";
import { loadModposSheets, type ModposSheet } from "@/server/modpos/store";

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
  /** Raporun şubesi (docs/SUBE.md): ModPOS föyüyle (şube, gün) eşlenir, günle değil */
  branchId: string;
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
    branchId: r.branchId,
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
    // E-postanın neden gitmediği (Resend anahtarı, alıcı listesi) yalnız yöneticiye; personele sabit metin (E-64)
    emailError: emailErrorFor(audience, r.emailError),
    emailedAt: r.emailedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
  if (audience === "admin") return { ...dto, okcCumTotal: r.okcCumTotal, okcCumVat: r.okcCumVat, okcOutside: r.okcOutside };
  return r.okcOutside !== null && r.okcOutside > 1 ? { ...dto, okcExtraTakings: true } : dto;
}

/** Günün raporu: tek kasanın (verilen şube; yoksa seçili şube, "Tümü"nde raporun yazılacağı şube) */
export async function getCashReport(date: string, audience: CashAudience = "staff", branchId?: string): Promise<CashReportDTO | null> {
  const [row] = await getDb().select().from(s.cashReports).where(and(eq(s.cashReports.date, date), await kasaSubesi(branchId))).limit(1);
  return row ? toCashDTO(row, audience) : null;
}

/** [from, to] (ikisi de dahil) günlerinin raporları, en yeni önce */
export async function cashReportsBetween(from: string, to: string, audience: CashAudience = "staff"): Promise<CashReportDTO[]> {
  const rows = await getDb()
    .select()
    .from(s.cashReports)
    .where(andWhere(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to)), await subeKosulu()))
    .orderBy(desc(s.cashReports.date))
    .limit(400);
  return rows.map((r) => toCashDTO(r, audience));
}

/**
 * Bu günden önceki son raporun ertesi güne devri: formun açılış kasası kendiliğinden dolar. Devir zinciri kasanındır:
 * verilen şubenin (yoksa seçili şubenin, "Tümü"nde raporun yazılacağı şubenin) önceki raporu
 */
export async function previousCarryOver(date: string, branchId?: string): Promise<{ date: string; amount: number } | null> {
  const [row] = await getDb()
    .select({ date: s.cashReports.date, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver })
    .from(s.cashReports)
    .where(and(lt(s.cashReports.date, date), await kasaSubesi(branchId)))
    .orderBy(desc(s.cashReports.date))
    .limit(1);
  return row ? { date: row.date, amount: Math.round((row.counted - row.handed) * 100) / 100 } : null;
}

/**
 * Birden çok şubenin raporları birlikte okunurken ("Tümü") her şubenin kendi önceki devri: `beforeOf(şube)` o şubenin
 * `date`ten önceki son raporunun devri (carryChecksByBranch'in girdisi). Şube başına bir küçük sorgu
 */
export async function previousCarryOverByBranch(date: string, branchIds: Iterable<string>): Promise<(branchId: string) => { date: string; amount: number } | null> {
  const ids = [...new Set(branchIds)];
  const rows = await Promise.all(ids.map((b) => previousCarryOver(date, b)));
  const out = new Map(ids.map((b, i) => [b, rows[i]]));
  return (branchId) => out.get(branchId) ?? null;
}

// ---------------------------------------------------------------- Yazarkasa Z'si (dalga 13; docs/planlar/okc-z.md §5.3, §9)

const okcZSet = and(isNotNull(s.cashReports.okcZNo), ne(s.cashReports.okcZNo, ""));

/**
 * Bu günden önceki son yazarkasa Z'si (plan §5.3): `z` yazarkasa Z no'su dolu son rapor (Z no sırası; personelin
 * formuna yalnız bu gider, D17), `cum` kümülatifi saklanmış (inandırıcı bulunmuş, §6.1) son rapor (zincir, K6; yalnız
 * sunucuda). Zincir hep son saklanan kümülatife bağlanır. İşlem içinden de okunur (writeCashReport).
 */
export async function previousOkc(day: string, db: Db | Tx = getDb(), branchId?: string): Promise<OkcPrev> {
  const sube = await kasaSubesi(branchId);
  const [[z], [cum]] = await Promise.all([
    db.select({ date: s.cashReports.date, zNo: s.cashReports.okcZNo }).from(s.cashReports).where(andWhere(and(lt(s.cashReports.date, day), okcZSet), sube)).orderBy(desc(s.cashReports.date)).limit(1),
    db
      .select({ date: s.cashReports.date, zNo: s.cashReports.okcZNo, cumTotal: s.cashReports.okcCumTotal, cumVat: s.cashReports.okcCumVat })
      .from(s.cashReports)
      .where(andWhere(and(lt(s.cashReports.date, day), okcZSet, isNotNull(s.cashReports.okcCumTotal)), sube))
      .orderBy(desc(s.cashReports.date))
      .limit(1),
  ]);
  return {
    z: z?.zNo ? { date: z.date, zNo: z.zNo } : null,
    cum: cum?.zNo && cum.cumTotal !== null ? { date: cum.date, zNo: cum.zNo, cumTotal: cum.cumTotal, cumVat: cum.cumVat } : null,
  };
}

/** Bu günden sonraki ilk yazarkasa Z'si (geç raporun sonraki halkası, plan §3.8): Z no, günlük toplam, saklanan kümülatif */
export async function nextOkc(
  day: string,
  db: Db | Tx = getDb(),
  branchId?: string,
): Promise<{ date: string; zNo: string; total: number | null; cumTotal: number | null; cumVat: number | null } | null> {
  const [row] = await db
    .select({ date: s.cashReports.date, zNo: s.cashReports.okcZNo, total: s.cashReports.okcTotal, cumTotal: s.cashReports.okcCumTotal, cumVat: s.cashReports.okcCumVat })
    .from(s.cashReports)
    .where(and(gt(s.cashReports.date, day), okcZSet, await kasaSubesi(branchId)))
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
      // Her şubenin kendi yazarkasası: ay zinciri şube başına kurulur (src/lib/okc-z.ts okcMonth)
      branchId: s.cashReports.branchId,
      zTotal: s.cashReports.zTotal,
      okcZNo: s.cashReports.okcZNo,
      okcTotal: s.cashReports.okcTotal,
      okcVatTotal: s.cashReports.okcVatTotal,
      okcVat: s.cashReports.okcVat,
      okcCumTotal: s.cashReports.okcCumTotal,
      okcCumVat: s.cashReports.okcCumVat,
    })
    .from(s.cashReports)
    .where(andWhere(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to)), await subeKosulu()))
    .orderBy(asc(s.cashReports.date));
}

/** İlk yazarkasa Z'li rapor (yöneticinin "Yazarkasa Z yok" rozeti bu günden sonra; plan §3.7, D15) */
export async function firstOkcReportDate(): Promise<string | null> {
  const [row] = await getDb()
    .select({ date: s.cashReports.date })
    .from(s.cashReports)
    .where(andWhere(or(isNotNull(s.cashReports.okcTotal), isNotNull(s.cashReports.okcCard)), await subeKosulu()))
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
    .where(andWhere(inArray(s.cashReports.date, [...new Set(days)]), await subeKosulu()));
  return new Set(rows.map((r) => r.date));
}

/** Raporu en çok bu kadar geride olan ilk gün (ay seçicisi için) */
export async function firstCashReportDate(): Promise<string | null> {
  const [row] = await getDb().select({ date: s.cashReports.date }).from(s.cashReports).where(await subeKosulu()).orderBy(asc(s.cashReports.date)).limit(1);
  return row?.date ?? null;
}

/**
 * Seçili şubenin koşulu (docs/SUBE.md). Kasa raporunun anahtarı artık (gün, şube): aynı güne iki şube rapor
 * girebildiği için süzmeden okuyan sorgu yanlış şubenin satırını döndürür. "Tümü" seçiliyken koşul yoktur.
 */
const subeKosulu = () => currentBranchWhere(s.cashReports.branchId);

/**
 * Tek kasanın koşulu: günün raporu, devir zinciri, yazarkasa Z sırası ve ay satırı şubenin kendi kasasınındır. Şube
 * verilmezse seçili şube; "Tümü" seçiliyken KOŞULSUZ OKUNMAZ, raporun yazılacağı şubeye (Tuzla) bakılır: aksi halde
 * aynı güne iki şube rapor girdiğinde hangisinin döneceği rastlantıya kalır (Tümü'nde Marina'nın raporu görünüyor,
 * kayıt Tuzla'ya iniyordu) ve Tuzla'nın açılışı Marina'nın deviriyle karşılaştırılırdı.
 */
async function kasaSubesi(branchId?: string, col: PgColumn = s.cashReports.branchId): Promise<SQL> {
  return eq(col, branchId ?? (await currentTillBranch()));
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Bütün raporların ay bilgisine giden altı sütunu (src/lib/cash-month.ts tillMonths): günde bir rapor, yılda ~365 satır.
 * Geçiş gününden sonra kasa raporu girilmemiş LafPOS günü LafPOS'un Z'sinden yedek satırla gelir (`source: "lafpos"`,
 * G6; docs/LAFPOS.md › Kasa raporu): rakamı aya girer, gün yine "rapor yok" sayılır; raporu olan günde rapor kazanır.
 * Ayarlar › ModPOS › Ay rakamına yedek açıkken geçiş gününden önceki raporsuz gün kapanmış ModPOS föyünden gelir
 * (`source: "modpos"`, modposTillRows; docs/MODPOS-API.md › Ay rakamına yedek). Öncelik rapor > LafPOS > ModPOS.
 * Geçiş günü boş ve yedek kapalıyken yalnız kasa raporları (bugünkü gibi). Ay bilgisini okuyan her yer (veri kümesi,
 * sabit gider sürümü, Kasa'nın ay satırı) bu yükleyiciden geçer: rakam her ekranda aynı. İşlem içinden de okunur.
 */
export async function tillRows(db: Db | Tx = getDb()): Promise<TillRow[]> {
  const [reports, lafpos, modpos] = await Promise.all([
    db
      .select({
        date: s.cashReports.date,
        branchId: s.cashReports.branchId,
        zTotal: s.cashReports.zTotal,
        card: s.cashReports.card,
        mealCard: s.cashReports.mealCard,
        discounts: s.cashReports.discounts,
        offRevenue: s.cashReports.offRevenue,
        // Ciroya dahil ödeme türleri: Z toplamının ödenmezi içerip içermediğini bunlar söyler (cash-revenue.ts)
        cash: s.cashReports.cash,
        online: s.cashReports.online,
        other: s.cashReports.other,
      })
      .from(s.cashReports)
      .where(await subeKosulu())
      .orderBy(asc(s.cashReports.date))
      .then((rows) =>
        rows.map(({ cash, online, other, ...r }): TillRow => ({ ...r, payments: Math.round((cash + r.card + r.mealCard + online + other) * 100) / 100 })),
      ),
    lafposTillRows(db),
    modposTillRows(db),
  ]);
  if (!lafpos.length && !modpos.length) return reports;
  // Öncelik ve kesintisiz kısım şube içinde (tillKey; docs/MODPOS-API.md › Şubeler): "Tümü"de Tuzla'nın raporu Marina'nın
  // aynı günkü föyünü düşürmez, Marina'nın föyleri Marina'nın ilk raporuna göre sayılır
  const have = new Set(reports.map(tillKey));
  // ModPOS föyü yalnız raporu da LafPOS gün sonu da olmayan günde (geçiş gününden önce zaten LafPOS satırı yok)
  const taken = new Set([...reports, ...lafpos].map(tillKey));
  // Raporlar başlamadan önceki föyler yalnız ilk rapora kesintisiz uzanan kısımla (cash-month.ts modposRunStart): her
  // okuyucu (veri kümesi, satış dönemi, sabit gider sürümü) aynı satırları görür
  const runFrom = modposRunStarts(modpos, [...reports, ...lafpos]);
  return [
    ...reports,
    ...lafpos.filter((r) => !have.has(tillKey(r))),
    ...modpos.filter((r) => !taken.has(tillKey(r)) && r.date >= (runFrom.get(r.branchId ?? "") ?? "")),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/** Şube şube föylerin kesintisiz kısmının başı (modposRunStart: şubenin föy günleri ve şubenin ilk raporu) */
function modposRunStarts(modpos: readonly TillRow[], reports: readonly TillRow[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const b of new Set(modpos.map((r) => r.branchId ?? ""))) {
    const first = reports.filter((r) => (r.branchId ?? "") === b).reduce<string | null>((a, r) => (a === null || r.date < a ? r.date : a), null);
    out.set(b, modposRunStart(modpos.filter((r) => (r.branchId ?? "") === b).map((r) => r.date), first));
  }
  return out;
}

/**
 * LafPOS'un yedek ay satırları (G6): geçiş gününden itibaren gelen gün sonlarının Z'si, [from, to] içinde. Geçiş günü
 * boşken boş (deneme günleri hiçbir hesaba girmez). Raporu olan günü süzmez: tillRows ve tillMonths raporu öne alır
 */
export async function lafposTillRows(db: Db | Tx = getDb(), from?: string, to?: string): Promise<TillRow[]> {
  const [setting] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, LAFPOS_SWITCH_KEY)).limit(1);
  const switchDay = readLafposSwitchDay(setting?.value);
  if (switchDay === null || (to !== undefined && to < switchDay)) return [];
  const start = from !== undefined && from > switchDay ? from : switchDay;
  const rows = await db
    .select({ date: s.posDayReports.date, branchId: s.posDayReports.branchId, z: s.posDayReports.z })
    .from(s.posDayReports)
    .where(and(gte(s.posDayReports.date, start), to !== undefined ? lte(s.posDayReports.date, to) : undefined, await currentBranchWhere(s.posDayReports.branchId)))
    .orderBy(asc(s.posDayReports.date));
  return rows.flatMap((r) => {
    const z = posZSchema.safeParse(r.z);
    if (!z.success) return [];
    const d = z.data;
    return [
      {
        date: r.date,
        branchId: r.branchId,
        zTotal: d.zTotal,
        card: d.card,
        mealCard: d.mealCard,
        discounts: d.discounts,
        offRevenue: d.offRevenue,
        receipts: d.receipts,
        payments: Math.round((d.cash + d.card + d.mealCard + d.online + d.other) * 100) / 100,
        source: "lafpos" as const,
      },
    ];
  });
}

/** Föy aralığının uçları (açık uçlu okuma; günler "YYYY-MM-DD" metin olarak karşılaştırılır) */
const MODPOS_FIRST_DAY = "2000-01-01";
const MODPOS_LAST_DAY = "9999-12-31";

/**
 * Ay rakamına yedeğin kapsamı (docs/MODPOS-API.md › Ay rakamına yedek): anahtar kapalıysa null (föy tablosu hiç
 * okunmaz); açıksa föyün sayılabileceği son gün, yani LafPOS'a geçiş gününden önceki gün (geçiş günü boşsa sınırsız).
 * Geçiş gününden itibaren kasa LafPOS'tur, föy aya girmez (docs/MODPOS-API.md › Nerede görünür)
 */
async function modposFallbackEnd(db: Db | Tx): Promise<string | null> {
  const rows = await db
    .select({ key: s.settings.key, value: s.settings.value })
    .from(s.settings)
    .where(inArray(s.settings.key, [MODPOS_FALLBACK_KEY, LAFPOS_SWITCH_KEY]));
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  if (!readModposFallback(value(MODPOS_FALLBACK_KEY))) return null;
  const switchDay = readLafposSwitchDay(value(LAFPOS_SWITCH_KEY));
  return switchDay === null ? MODPOS_LAST_DAY : addDays(switchDay, -1);
}

/**
 * Föyün yedek ay satırı: yalnız bütün kasaları kapanmış gün (KAPALI) ya da kasası hiç açılmadan satış yapılmış gün (BOS,
 * föysüz Z; src/lib/modpos/z.ts foyZ). Açık kasalı föyün tutarları daha değişir. Kesinleşmiş satışsız gün (kasa açılmamış,
 * satış yok) sıfır satırdır: açık gün ve ciroya bir şey katmaz, ama raporlar başlamadan önceki föylerin kesintisiz
 * sayılmasında (cash-month.ts modposRunStart) kapalı gün boşluk sayılmaz. Föyde indirim yok: `discounts` null (o
 * günlerin indirimi bilinmez; ayın discountDays'i bunu gösterir)
 */
function modposTillRow(sheet: Pick<ModposSheet, "day" | "branchId" | "state" | "foy" | "final">): TillRow | null {
  if (sheet.state === "ACIK") return null;
  const z = foyZ(sheet.foy);
  if (sheet.state === "BOS" && !(z && z.foysuz && z.zTotal > 0)) {
    return sheet.final ? { date: sheet.day, branchId: sheet.branchId, zTotal: 0, card: 0, mealCard: 0, discounts: null, offRevenue: 0, receipts: 0, payments: 0, source: "modpos" } : null;
  }
  if (!z) return null;
  return {
    date: sheet.day,
    branchId: sheet.branchId,
    zTotal: z.zTotal,
    card: z.card,
    mealCard: z.mealCard,
    discounts: null,
    offRevenue: z.offRevenue,
    receipts: z.receipts,
    // Föyün ciroya dahil ödemeleri: Z toplamı (satis.ciro) ödenmezi içeriyorsa aya girmesin (cash-revenue.ts)
    payments: Math.round((z.cash + z.card + z.mealCard + z.online + z.other) * 100) / 100,
    source: "modpos",
  };
}

/**
 * ModPOS kasa föyünün yedek ay satırları, [from, to] içinde (docs/MODPOS-API.md › Ay rakamına yedek; Ayarlar › ModPOS
 * kartının anahtarı, settings › modposAyYedegi, varsayılan kapalı). Kapalıyken föy tablosu okunmadan boş döner: ay
 * rakamı bugünkü gibi. Açıkken yalnız LafPOS'a geçiş gününden önceki günler (geçiş günü boşsa bütün günler) ve yalnız
 * kapanmış föyler (modposTillRow). Raporu olan günü süzmez: tillRows ve tillMonths raporu öne alır (rapor > LafPOS >
 * ModPOS). Yalnız yöneticinin ekranları ve hesaplar okur; personelin ekranına föy rakamı gitmez
 */
export async function modposTillRows(db: Db | Tx = getDb(), from?: string, to?: string): Promise<TillRow[]> {
  const end = await modposFallbackEnd(db);
  if (end === null) return [];
  const upto = to !== undefined && to < end ? to : end;
  const start = from ?? MODPOS_FIRST_DAY;
  if (upto < start) return [];
  const sheets = await loadModposSheets(start, upto, db);
  return sheets.flatMap((sh) => modposTillRow(sh) ?? []);
}

/**
 * Föylerin sayılmaya başladığı gün (anahtar kapalıyken ya da föy yokken null, föy tablosu okunmaz). Kasa'nın ay satırı yalnız
 * ayın satırlarını okur: ay ortasında başlayan ilk ay (partialFrom) ve raporlar başlamadan önceki föylerin kesintisiz
 * kısmı (cash-month.ts modposRunStart) Gelir-gider'deki gibi bulunsun diye bütün föylerden ve ilk kasa raporundan
 * hesaplanır; tillMonths'a `modposFrom` olarak da verilir
 */
export async function firstModposTillDay(db: Db | Tx = getDb()): Promise<string | null> {
  const end = await modposFallbackEnd(db);
  if (end === null) return null;
  const [rows, firsts] = await Promise.all([
    modposTillRows(db),
    db
      .select({ branchId: s.cashReports.branchId, date: sql<string>`min(${s.cashReports.date})` })
      .from(s.cashReports)
      .where(await subeKosulu())
      .groupBy(s.cashReports.branchId),
  ]);
  // Kesintisiz kısmın başı, şube şube (her şubenin föyleri kendi ilk raporuna göre); öncesindeki föyler sayılmaz (başı
  // ilk raporsa raporlardan önce sayılan föy yok). Birden çok şubede en erkeni
  const starts = modposRunStarts(rows, firsts.map((f) => ({ date: f.date, branchId: f.branchId }) as TillRow));
  return [...starts.values()].reduce<string | null>((a, d) => (d !== null && (a === null || d < a) ? d : a), null);
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

/**
 * Bu günden sonraki ilk rapor (açılışı bu raporun devriyle karşılaştırılır; varsa personel bu raporu düzeltemez): aynı
 * kasanın, yani verilen şubenin (yoksa seçili şubenin, "Tümü"nde raporun yazılacağı şubenin)
 */
export async function nextReportAfter(date: string, branchId?: string): Promise<{ date: string; openingCash: number } | null> {
  const [row] = await getDb()
    .select({ date: s.cashReports.date, openingCash: s.cashReports.openingCash })
    .from(s.cashReports)
    .where(and(gt(s.cashReports.date, date), await kasaSubesi(branchId)))
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
    previousCarryOver(r.date, r.branchId),
    nextReportAfter(r.date, r.branchId),
    r.revision > 1 ? cashRevisionsFor([r.id]) : Promise.resolve([]),
  ]);
  return integrityOf(r, prev, next, revisions);
}

/** Bu ayın kasa raporu var mı (ay bilgisinin boş alanları oradan dolar) */
/**
 * Ayın kasadan gelen bir satırı var mı: kasa raporu ya da (yalnız açık olan yedeklerde) LafPOS gün sonu veya sayılan
 * ModPOS föyü (tillRows). Ay bilgisinin elle yazılmış 0'ı bu ayda değerdir, silinmez (cash-month.ts monthRowEmpty);
 * yalnız föyden ya da LafPOS'tan gelen ayda da öyle (docs/MODPOS-API.md › Ay rakamına yedek)
 */
export async function hasTillRowsIn(month: string, db: Db | Tx = getDb()): Promise<boolean> {
  if (await hasCashReportIn(month, db)) return true;
  return (await tillRows(db)).some((r) => r.date.startsWith(`${month}-`));
}

export async function hasCashReportIn(month: string, db: Db | Tx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: s.cashReports.id })
    .from(s.cashReports)
    .where(andWhere(like(s.cashReports.date, `${month}-%`), await subeKosulu()))
    .limit(1);
  return Boolean(row);
}

/**
 * Ayın months satırı (elle yazılanlar; yoksa null): Kasa sayfasındaki ay satırı için. Ay satırının anahtarı (ay, şube):
 * verilen şubenin (yoksa seçili şubenin, "Tümü"nde raporun yazılacağı şubenin) satırı
 */
export async function loadMonthEntry(month: string, branchId?: string): Promise<MonthEntry | null> {
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
    .where(and(eq(s.months.month, month), await kasaSubesi(branchId, s.months.branchId)))
    .limit(1);
  return row ?? null;
}
