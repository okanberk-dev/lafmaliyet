import "server-only";

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";

import { supplierResolver } from "@/app/panel/tedarikciler/logic";
import { businessDate } from "@/lib/cash-report";
import { isChannelKey } from "@/lib/commission/channels";
import {
  buildCommissionReport,
  commissionAlerts,
  commissionDigestBox,
  MAX_ALERTS,
  overduePayouts,
  parseCommissionSettings,
  type ChannelMonthIn,
  type CommissionAlert,
  type CommissionInput,
  type CommissionInvoiceIn,
  type CommissionReport,
} from "@/lib/commission/report";
import { COMMISSION_CATEGORY } from "@/lib/constants";
import { addDays, shiftMonth, todayTR } from "@/lib/reminders";
import { loadSupplierRefs } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import type { DigestExtraCtx, DigestExtraLoad } from "@/server/notify/digest-template";

/**
 * Komisyon ve hakediş verisi (src/lib/commission/report.ts; docs/KOMISYON.md). İki yol:
 * - ekran (`loadCommissionReport`): 13 ay; faturanın kanalı tedarikçi kartının adı ve diğer adlarıyla da aranır (vergi
 *   noyla eşleşme, Tedarikçiler'in kuralı; loadSupplierRefs bütün faturaları okur, yalnız burada);
 * - hafif yol (zil, Bugün, sabah e-postası): 4 ay, yalnız faturadaki adın öneki; dört küçük sorgu aynı anda.
 * Okuyan yollar hiçbir şey yazmaz; takibin başladığı gün (`komisyon.since`) yalnız yazma yollarında kaydedilir.
 */

/** Kanal ayarları (ödeme süresi): { channels: { pluxee: { payDays: 30 }, … } } */
export const COMMISSION_SETTINGS_KEY = "komisyon.ayar";
/** Hakediş takibinin başladığı gün (YYYY-MM-DD): öncesinde son günü geçen hakediş gecikme sayılmaz */
export const COMMISSION_SINCE_KEY = "komisyon.since";
/** Sabah e-postasının tekil anahtarı: her uyarı bir kez (notification_log) */
export const COMMISSION_LOG_PREFIX = "komisyon:";

const SCREEN_MONTHS = 13;
const LIGHT_MONTHS = 4;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Raporun girdisi. `months`: pencere (bu ay dahil); `resolveNames`: kanal tedarikçi kartının adlarıyla da aranır
 * (yalnız ekran). `today` verilmezse Türkiye'de bugün (çağıran oturumu ya da isteği okuduktan sonra).
 */
export async function loadCommissionInput(opts: { months: number; resolveNames: boolean; today?: string }): Promise<CommissionInput> {
  const db = getDb();
  const today = opts.today ?? todayTR();
  const fromMonth = shiftMonth(today.slice(0, 7), -(opts.months - 1));
  const fromDay = `${fromMonth}-01`;
  const [invoiceRows, marks, state, till, names] = await Promise.all([
    // Komisyon faturaları ve kalemleri tek sorguda (kalemsiz fatura bir satır)
    db
      .select({
        id: s.invoices.id,
        date: s.invoices.date,
        supplier: s.invoices.supplier,
        supplierTaxNumber: s.invoices.supplierTaxNumber,
        invoiceNo: s.invoices.invoiceNo,
        amount: s.invoices.amount,
        discount: s.invoices.discount,
        payable: s.invoices.payable,
        needsReview: s.invoices.needsReview,
        lineName: s.parasutBillLines.productName,
        lineDescription: s.parasutBillLines.description,
        lineNet: s.parasutBillLines.netTotal,
      })
      .from(s.invoices)
      .leftJoin(s.parasutBillLines, eq(s.parasutBillLines.invoiceId, s.invoices.id))
      .where(and(eq(s.invoices.category, COMMISSION_CATEGORY), gte(s.invoices.date, fromDay)))
      .orderBy(asc(s.invoices.date), asc(s.invoices.id), asc(s.parasutBillLines.id)),
    db
      .select({
        channel: s.commissionMonths.channel,
        month: s.commissionMonths.month,
        sales: s.commissionMonths.sales,
        receivedOn: s.commissionMonths.receivedOn,
        received: s.commissionMonths.received,
        note: s.commissionMonths.note,
      })
      .from(s.commissionMonths)
      .where(gte(s.commissionMonths.month, fromMonth)),
    db
      .select({ key: s.integrationState.key, value: s.integrationState.value })
      .from(s.integrationState)
      .where(inArray(s.integrationState.key, [COMMISSION_SETTINGS_KEY, COMMISSION_SINCE_KEY])),
    // Z'deki yemek kartı ve online; ilk raporun günü (ay ortasında başlayan ilk ay) aynı sorguda
    db
      .select({
        date: s.cashReports.date,
        mealCard: s.cashReports.mealCard,
        online: s.cashReports.online,
        first: sql<string | null>`(select min(${s.cashReports.date}) from ${s.cashReports})`,
      })
      .from(s.cashReports)
      .where(gte(s.cashReports.date, fromDay)),
    opts.resolveNames ? supplierNames() : Promise.resolve(null),
  ]);

  const byId = new Map<number, CommissionInvoiceIn>();
  for (const r of invoiceRows) {
    let inv = byId.get(r.id);
    if (!inv) {
      inv = {
        id: r.id,
        date: r.date,
        supplier: r.supplier,
        names: names ? names(r.supplier, r.supplierTaxNumber) : [r.supplier],
        invoiceNo: r.invoiceNo,
        amount: r.amount,
        discount: r.discount,
        payable: r.payable,
        needsReview: r.needsReview,
        lines: [],
      };
      byId.set(r.id, inv);
    }
    if (r.lineName !== null && r.lineNet !== null) inv.lines.push({ name: r.lineName, description: r.lineDescription, netTotal: r.lineNet });
  }
  const stored = new Map(state.map((x) => [x.key, x.value]));
  const since = stored.get(COMMISSION_SINCE_KEY);
  return {
    today,
    through: addDays(businessDate(), -1),
    // Takip başlamadıysa (kayıt yoksa) bugün: okuyan yol yazmaz, geçmiş son günler "takip öncesi" kalır
    since: typeof since === "string" && DAY.test(since) ? since : today,
    fromMonth,
    invoices: [...byId.values()],
    till: till.map(({ date, mealCard, online }) => ({ date, mealCard, online })),
    firstReport: till[0]?.first ?? null,
    marks: marks.filter((m): m is ChannelMonthIn => isChannelKey(m.channel)),
    settings: parseCommissionSettings(stored.get(COMMISSION_SETTINGS_KEY)),
  };
}

/**
 * Faturadaki ad (ve vergi no) → kanalın aranacağı adlar: faturadaki ad, sonra tedarikçi kartının adı ve diğer adları
 * (Tedarikçiler'in eşleşmesi: ad önce, sonra vergi no). "Diğer adlar"a eklenen ad faturayı kanala bağlar.
 */
async function supplierNames(): Promise<(supplier: string, taxNumber: string | null) => string[]> {
  const [cards, refs] = await Promise.all([
    getDb().select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, taxNumber: s.suppliers.taxNumber }).from(s.suppliers),
    loadSupplierRefs(),
  ]);
  const { resolve } = supplierResolver(
    cards.map((c) => ({ ...c, aliases: Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === "string") : [] })),
    refs,
  );
  return (supplier, taxNumber) => {
    const card = resolve(supplier, taxNumber).card;
    return card ? [supplier, card.name, ...card.aliases] : [supplier];
  };
}

/** Ekranın raporu: 13 ay, kanal tedarikçi kartının adlarıyla da aranır */
export async function loadCommissionReport(): Promise<CommissionReport> {
  return buildCommissionReport(await loadCommissionInput({ months: SCREEN_MONTHS, resolveNames: true }));
}

/** Hafif rapor (zil, Bugün, sabah e-postası): 4 ay, faturadaki adın öneki */
async function loadLightReport(today?: string): Promise<CommissionReport> {
  return buildCommissionReport(await loadCommissionInput({ months: LIGHT_MONTHS, resolveNames: false, today }));
}

/** Zilin uyarıları (Faturalar başlığı, yalnız yönetici): geciken hakediş, %6 aşımı, komisyon dışı ücret; en çok beş */
export async function loadCommissionAlerts(): Promise<CommissionAlert[]> {
  const report = await loadLightReport();
  return commissionAlerts(report, report.today);
}

/** Bugün'ün "Hakedişler" satırı: geciken hakedişler, en eski son gün önce */
export async function loadOverduePayouts(): Promise<{ label: string; month: string; due: string }[]> {
  return overduePayouts(await loadLightReport()).map((r) => ({ label: r.label, month: r.month, due: r.payout.due! }));
}

/** Takibin başladığı gün: yoksa bugün yazılır (yalnız yazma yollarında: sabah e-postası, hakediş ve kanal kaydı) */
export async function ensureCommissionSince(): Promise<string> {
  const db = getDb();
  await db.insert(s.integrationState).values({ key: COMMISSION_SINCE_KEY, value: todayTR() }).onConflictDoNothing();
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, COMMISSION_SINCE_KEY)).limit(1);
  return typeof row?.value === "string" ? row.value : todayTR();
}

/**
 * Sabah e-postasının "Komisyon ve hakediş" kutusu (src/server/notify/digest-extras.ts): daha önce e-postayla
 * bildirilmemiş uyarılar (anahtarı notification_log'da olmayan), en çok beş. Gönderimde takibin başladığı gün yazılır
 * (sabah işinin ilk çalışması); önizleme hiçbir şey yazmaz. Anahtarlar gönderimden sonra günlüğe yazılır.
 */
export async function loadCommissionDigest(today: string, ctx: DigestExtraCtx): Promise<DigestExtraLoad | null> {
  if (!ctx.preview) await ensureCommissionSince();
  const report = await loadLightReport(today);
  const alerts = commissionAlerts(report, today, Infinity);
  if (!alerts.length) return null;
  const keys = alerts.map((a) => `${COMMISSION_LOG_PREFIX}${a.key}`);
  const sent = new Set((await getDb().select({ key: s.notificationLog.key }).from(s.notificationLog).where(inArray(s.notificationLog.key, keys))).map((r) => r.key));
  const fresh = alerts.filter((a) => !sent.has(`${COMMISSION_LOG_PREFIX}${a.key}`)).slice(0, MAX_ALERTS);
  const box = commissionDigestBox(fresh);
  return box ? { box, logKeys: fresh.map((a) => `${COMMISSION_LOG_PREFIX}${a.key}`) } : null;
}
