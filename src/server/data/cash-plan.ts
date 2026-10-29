import "server-only";

import { eq } from "drizzle-orm";

import type { Model } from "@/lib/calc/engine";
import { buildCashPlan, goodsRows, parseCashPlanState, planInputFromModel, SALES_LOOKBACK_DAYS, type CashPlan, type CashPlanState } from "@/lib/cash-plan";
import { addDays, type UpcomingItem } from "@/lib/reminders";
import type { TaxInputs } from "@/lib/tax/inputs";
import type { TaxPlanFeed } from "@/lib/tax/view";
import { unreachable } from "@/lib/unreachable";
import { loadExpectedDebtsByCard } from "@/server/data/cari";
import { cashReportsBetween, previousCarryOver } from "@/server/data/cash-reports";
import { loadRecentPaid } from "@/server/data/recent-paid";
import { loadVatPaid } from "@/server/data/vat-paid";
import { loadPaidOnDelivery, loadTermDays } from "@/server/data/suppliers";
import { loadTaxInputs, loadTaxPlanFeed } from "@/server/data/tax";
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

/** Planın kesin kalemi olan ödeme: fatura ve faturasız borç (hatırlatıcılar planın kendi kuralıyla, `reminders`'tan) */
function isPayable(i: UpcomingItem): boolean {
  switch (i.source) {
    case "invoice":
    case "cari":
      return true;
    case "reminder":
      return false;
    default:
      return unreachable(i.source);
  }
}

/**
 * Vergi girdileri nakit planı için: okunamazsa (tablolar, ayar) plan bugünkü gibi vergi satırsız çalışır (K29, §13);
 * hata yalnız günlüğe
 */
async function taxInputsForPlan(): Promise<TaxInputs | null> {
  try {
    return await loadTaxInputs();
  } catch (e) {
    console.error("[vergi] nakit planı: vergi girdileri okunamadı", e);
    return null;
  }
}

/**
 * Önümüzdeki 6 haftanın planı. Genel bakış zaten okuduğu `upcoming`'i (Ödemeler listesi) ve modeli paylaşır; mal
 * faturaları modelden gelir (ek sorgu yok). Yeni mal faturasının ödeme gecikmesi: peşin çalışılan tedarikçide 0, değilse
 * kartındaki vade, o da yoksa bildirim ayarındaki gün (tedarikçi adla bulunur; gelecek faturanın vergi nosu yok).
 *
 * Vergi (docs/VERGI.md, K18, K25, K29): bordro vergi ayarlarıyla yasal oranlardan, muhtasar, geçici vergi, yurt dışı
 * hizmetin KDV-2'si ve beyanname damgaları Vergi sayfasının beslemesinden. `opts.taxInputs` önceden okunmuş girdidir
 * (Vergi › Özet: tablolar ikinci kez okunmaz); verilmezse burada okunur. Ödendi kaydı (payments.vat-paid) girdinin
 * içindedir. Besleme hesaplanamazsa plan vergi satırsız çalışır (`tax: null`).
 */
export async function loadCashPlan(model: Model, upcoming?: Awaited<ReturnType<typeof loadUpcoming>>, opts: { taxInputs?: TaxInputs } = {}): Promise<CashPlanView> {
  const up = upcoming ?? (await loadUpcoming());
  const today = up.today;
  const [state, reports, termDays, paidOnDelivery, carry, recentPaid, taxInputs, expectedDebts] = await Promise.all([
    loadCashPlanState(),
    cashReportsBetween(addDays(today, -SALES_LOOKBACK_DAYS), addDays(today, -1)),
    loadTermDays(),
    loadPaidOnDelivery(),
    previousCarryOver(addDays(today, 1)),
    loadRecentPaid(),
    opts.taxInputs ?? taxInputsForPlan(),
    // Faturası beklenen cari borçlar: o tedarikçinin mal tahmini bu kadar düşer (K19); kayıt yokken boş
    loadExpectedDebtsByCard(),
  ]);
  // Vergi girdileri okunamadıysa Ödendi kaydı ayrıca (KDV'nin ödenmiş dönemleri vergiden bağımsız)
  const vatPaid = taxInputs?.vatPaid ?? (await loadVatPaid());
  let tax: TaxPlanFeed | null = null;
  if (taxInputs) {
    try {
      tax = loadTaxPlanFeed(model, today, taxInputs);
    } catch (e) {
      console.error("[vergi] nakit planı: vergi beslemesi hesaplanamadı", e);
    }
  }
  const termOf = (supplier: string) => (paidOnDelivery(supplier) ? 0 : (termDays(supplier) ?? up.settings.invoiceTermDays));
  const goods = goodsRows(model.ds.invoices, today, termOf);
  const plan = buildCashPlan({
    // Besleme yoksa stopajlı sabit gider brüt ödenir: muhtasar ve KDV-2 satırı da yok, stopaj kaybolmasın (§13)
    ...planInputFromModel(model, today, taxInputs?.settings, { feed: tax !== null }),
    tax,
    today,
    opening: state.balance !== null && state.balanceDate ? { amount: state.balance, date: state.balanceDate } : null,
    excluded: state.excluded,
    invoiceTermDays: up.settings.invoiceTermDays,
    cashReports: reports.map((r) => ({ date: r.date, zTotal: r.zTotal, card: r.card, mealCard: r.mealCard, online: r.online })),
    invoices: up.items.filter(isPayable),
    reminders: up.reminders,
    paidReminders: recentPaid.filter((e) => e.kind === "reminder").map((e) => ({ id: e.id, dueDate: e.dueDate, next: e.next ?? null, amount: e.amount })),
    vatPaid,
    goods: goods.rows,
    goodsSpanDays: goods.spanDays,
    expectedDebts,
    vatAnchor: state.vatCarry ? { month: state.vatCarry.month, amount: state.vatCarry.amount } : null,
  });
  return { plan, state, carry, invoiceTermDays: up.settings.invoiceTermDays };
}
