import "server-only";

import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";

import type { CashReportFields } from "@/lib/cash-report";
import { getDb, schema as s } from "@/server/db";

/** Kasa raporunun gideceği adresler ve WhatsApp (integration_state, anahtar "cash.settings"; yönetici değiştirir) */
export interface CashSettings {
  recipients: string[];
  emailEnabled: boolean;
  /** "WhatsApp ile gönder" bu numaranın sohbetini açar; boşsa sohbet seçici (grup da seçilir) */
  whatsapp: string | null;
}

export const DEFAULT_CASH_SETTINGS: CashSettings = {
  recipients: ["bizimfutbol9@gmail.com", "iletisim@alpkoc.com.tr"],
  emailEnabled: true,
  whatsapp: null,
};
const KEY = "cash.settings";

export async function loadCashSettings(): Promise<CashSettings> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, KEY)).limit(1);
  const v = (row?.value as Partial<CashSettings> | undefined) ?? {};
  return {
    recipients: Array.isArray(v.recipients) ? v.recipients.filter((x): x is string => typeof x === "string") : DEFAULT_CASH_SETTINGS.recipients,
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
  revision: number;
  cashDiff: number;
  submittedBy: number | null;
  submittedByName: string;
  emailStatus: "sent" | "failed" | "off" | null;
  emailError: string | null;
  emailedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = typeof s.cashReports.$inferSelect;

export function toCashDTO(r: Row): CashReportDTO {
  return {
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
    cashOut: r.cashOut,
    cashOutNote: r.cashOutNote,
    countedCash: r.countedCash,
    handedOver: r.handedOver,
    bankPos: r.bankPos,
    offRevenue: r.offRevenue,
    note: r.note,
    revision: r.revision,
    cashDiff: r.cashDiff,
    submittedBy: r.submittedBy,
    submittedByName: r.submittedByName,
    emailStatus: r.emailStatus,
    emailError: r.emailError,
    emailedAt: r.emailedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function getCashReport(date: string): Promise<CashReportDTO | null> {
  const [row] = await getDb().select().from(s.cashReports).where(eq(s.cashReports.date, date)).limit(1);
  return row ? toCashDTO(row) : null;
}

/** [from, to] (ikisi de dahil) günlerinin raporları, en yeni önce */
export async function cashReportsBetween(from: string, to: string): Promise<CashReportDTO[]> {
  const rows = await getDb()
    .select()
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to)))
    .orderBy(desc(s.cashReports.date))
    .limit(400);
  return rows.map(toCashDTO);
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

/** Raporu en çok bu kadar geride olan ilk gün (ay seçicisi için) */
export async function firstCashReportDate(): Promise<string | null> {
  const [row] = await getDb().select({ date: s.cashReports.date }).from(s.cashReports).orderBy(asc(s.cashReports.date)).limit(1);
  return row?.date ?? null;
}
