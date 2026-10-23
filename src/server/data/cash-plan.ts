import "server-only";

import { eq } from "drizzle-orm";

import type { Model } from "@/lib/calc/engine";
import { buildCashPlan, goodsRows, parseCashPlanState, planInputFromModel, SALES_LOOKBACK_DAYS, type CashPlan, type CashPlanState } from "@/lib/cash-plan";
import { addDays } from "@/lib/reminders";
import { cashReportsBetween, previousCarryOver } from "@/server/data/cash-reports";
import { loadRecentPaid } from "@/server/data/recent-paid";
import { loadPaidOnDelivery, loadTermDays } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import { loadUpcoming } from "@/server/notify/digest";

/**
 * Nakit planının ayarı (integration_state): girilen bakiye, tahminden çıkarılanlar ve muhasebecinin devreden KDV'si.
 * Tek satır, geçmişi tutulmaz (değişiklik işlem geçmişine yazılır). db:reset siler: tahmin ayarı sabit gider
 * kimliklerine bağlı (`fixed:<id>`), kimlikler baştan sayar.
 */
export const CASH_PLAN_KEY = "cashflow.plan";

/** Kayıtlı durum; bozuk ya da eksik değer varsayılana düşer */
export async function loadCashPlanState(): Promise<CashPlanState> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, CASH_PLAN_KEY)).limit(1);
  return parseCashPlanState(row?.value);
}

export interface CashPlanView {
  plan: CashPlan;
  state: CashPlanState;
  /** Son kasa raporunun ertesi güne devrettiği nakit (bakiye penceresindeki ipucu) */
  carry: { date: string; amount: number } | null;
  /** Vadesiz faturanın genel vade günü (Nasıl hesaplandı) */
  invoiceTermDays: number;
}

/**
 * Önümüzdeki 6 haftanın planı. Genel bakış zaten okuduğu `upcoming`'i (Ödemeler listesi) ve modeli paylaşır; mal
 * faturaları modelden gelir (ek sorgu yok). Yeni mal faturasının ödeme gecikmesi: peşin çalışılan tedarikçide 0, değilse
 * kartındaki vade, o da yoksa bildirim ayarındaki gün (tedarikçi adla bulunur; gelecek faturanın vergi nosu yok).
 */
export async function loadCashPlan(model: Model, upcoming?: Awaited<ReturnType<typeof loadUpcoming>>): Promise<CashPlanView> {
  const up = upcoming ?? (await loadUpcoming());
  const today = up.today;
  const [state, reports, termDays, paidOnDelivery, carry, recentPaid] = await Promise.all([
    loadCashPlanState(),
    cashReportsBetween(addDays(today, -SALES_LOOKBACK_DAYS), addDays(today, -1)),
    loadTermDays(),
    loadPaidOnDelivery(),
    previousCarryOver(addDays(today, 1)),
    loadRecentPaid(),
  ]);
  const termOf = (supplier: string) => (paidOnDelivery(supplier) ? 0 : (termDays(supplier) ?? up.settings.invoiceTermDays));
  const goods = goodsRows(model.ds.invoices, today, termOf);
  const plan = buildCashPlan({
    ...planInputFromModel(model, today),
    today,
    opening: state.balance !== null && state.balanceDate ? { amount: state.balance, date: state.balanceDate } : null,
    excluded: state.excluded,
    invoiceTermDays: up.settings.invoiceTermDays,
    cashReports: reports.map((r) => ({ date: r.date, zTotal: r.zTotal, card: r.card, mealCard: r.mealCard, online: r.online })),
    invoices: up.items.filter((i) => i.source === "invoice"),
    reminders: up.reminders,
    paidReminders: recentPaid.filter((e) => e.kind === "reminder").map((e) => ({ id: e.id, dueDate: e.dueDate, next: e.next ?? null, amount: e.amount })),
    goods: goods.rows,
    goodsSpanDays: goods.spanDays,
    vatAnchor: state.vatCarry ? { month: state.vatCarry.month, amount: state.vatCarry.amount } : null,
  });
  return { plan, state, carry, invoiceTermDays: up.settings.invoiceTermDays };
}
