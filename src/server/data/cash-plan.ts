import "server-only";

import { eq } from "drizzle-orm";

import type { Model } from "@/lib/calc/engine";
import { buildCashPlan, goodsRows, parseCashPlanState, planCashReports, planInputFromModel, SALES_LOOKBACK_DAYS, type CashPlan, type CashPlanInput, type CashPlanState } from "@/lib/cash-plan";
import { BRANCH_PLAN_EXCLUDED, branchCashFlow, branchPlanWithoutTax, isTaxPlanReminder, ownPlanInvoice, sharedPlanIdsOf, type BranchCashFlow } from "@/lib/cash-plan-branch";
import type { PayrollSettings } from "@/lib/bordro/settings";
import { addDays, type UpcomingItem } from "@/lib/reminders";
import { unreachable } from "@/lib/unreachable";
import { loadExpectedDebtsByCard } from "@/server/data/cari";
import { ALL_BRANCHES, tillBranches, type BranchRow, type BranchScope } from "@/lib/branches";
import { withBranchScope } from "@/server/branch-scope";
import { loadPayrollSettings } from "@/server/data/bordro";
import { loadModel } from "@/server/data/dataset";
import { listBranches } from "@/server/branches";
import { cashReportsBetween, previousCarryOverByBranch } from "@/server/data/cash-reports";
import { loadPaidOnDelivery, loadTermDays } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import { loadUpcoming } from "@/server/notify/digest";

/**
 * Nakit planının ayarı (integration_state): girilen bakiye, tahminden çıkarılanlar (ve eski devreden KDV kaydı, okunur
 * ve korunur).
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
  /**
   * Kasalardaki nakit (bakiye penceresindeki ipucu): açık her şubenin son kasa raporunun ertesi güne devri toplamı, gün
   * en yeni raporun; `tills` toplanan kasa sayısı (birden çoksa ipucu söyler)
   */
  carry: { date: string; amount: number; tills: number } | null;
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
 * Şubenin akışına giren kesin ödeme (Nakit planı alanının şube kipi): yalnız şubeye seçilmiş fatura. Faturasız borç
 * (cari) ve işletme geneli fatura firmanın planında (İşletme geneli satırı); hatırlatıcı planın kendi kuralıyla
 */
function ownBranchPayable(i: UpcomingItem, invoiceBranches: ReadonlyMap<number, { branchId: string | null; companyWide: boolean }>, branch: string): boolean {
  switch (i.source) {
    case "invoice":
      return ownPlanInvoice(invoiceBranches.get(i.sourceId), branch);
    case "cari":
    case "reminder":
      return false;
    default:
      return unreachable(i.source);
  }
}

/** Bordronun saklı ayarları (yalnız maaş ve SGK); okunamazsa null: varsayılanlar, hata yalnız günlüğe */
async function payrollSettingsForPlan(): Promise<PayrollSettings | null> {
  try {
    return await loadPayrollSettings();
  } catch (e) {
    console.error("[nakit] bordro ayarları okunamadı", e);
    return null;
  }
}

/**
 * İşletmenin kasalarındaki nakit: açık her fiziksel şubenin (tillBranches) son raporunun ertesi güne devri toplanır.
 * Devir zinciri şube başınadır (previousCarryOver tek kasayı okur, "Tümü"de Tuzla'yı): yalnız birini yazmak Marina'nın
 * kasasındaki parayı düşürürdü. Hiç raporu olmayan şube sayılmaz; hiçbiri yoksa null
 */
async function tillsCarry(before: string, branches: readonly BranchRow[]): Promise<CashPlanView["carry"]> {
  const ids = tillBranches(branches).map((b) => b.id);
  const of = await previousCarryOverByBranch(before, ids);
  const carries = ids.map(of).filter((c): c is { date: string; amount: number } => c !== null);
  if (!carries.length) return null;
  return {
    date: carries.reduce((a, c) => (c.date > a ? c.date : a), carries[0].date),
    amount: Math.round(carries.reduce((a, c) => a + c.amount, 0) * 100) / 100,
    tills: carries.length,
  };
}

/**
 * Önümüzdeki 6 haftanın planı. `upcoming` (Ödemeler listesi) çağıranın kapsamıyla okunmuştur (Genel bakış, haftalık
 * özet, loadAreaCashPlan); modeli paylaşır; mal
 * faturaları modelden gelir (ek sorgu yok). Yeni mal faturasının ödeme gecikmesi: peşin çalışılan tedarikçide 0, değilse
 * kartındaki vade, o da yoksa bildirim ayarındaki gün (tedarikçi adla bulunur; gelecek faturanın vergi nosu yok).
 *
 * Bordro yasal oranlardan, bordronun saklı ayarlarıyla (src/lib/bordro/settings.ts: hesap dönemi, asgari ücret desteği,
 * elle işveren oranı). Vergi tahmini yok (Vergi bölümü 27 Kasım 2026'da kaldırıldı): vergi ödemeleri yalnız Ödemeler'e
 * tutarıyla yazıldıysa, düz hatırlatıcı olarak girer.
 */
export async function loadCashPlan(model: Model, upcoming: Awaited<ReturnType<typeof loadUpcoming>>, opts: { branch?: string } = {}): Promise<CashPlanView> {
  // Şubenin akışı (`opts.branch`; şube ayrımı parça 4): model, kasa raporları ve `upcoming` o şubenin kapsamıyla okunmuş
  // olmalı (loadAreaCashPlan). Plan yalnız şubeye ait kalemlerle kurulur: işletme geneli hatırlatıcı, işletme geneli
  // fatura ve faturasız borç firmanın planındadır (src/lib/cash-plan-branch.ts); açılış bakiyesi yok. Vergi ve SGK
  // şubeye bölünmez (sahibin kararı 27 Kasım 2026): şubenin vergi ve SGK hatırlatıcısı ve SGK tahmini yok
  // (branchPlanWithoutTax); stopajlı sabit gider firmanın planındaki gibi net
  const branch = opts.branch ?? null;
  const up = upcoming;
  const today = up.today;
  const branchesP = listBranches();
  const [state, reports, termDays, paidOnDelivery, carry, expectedDebts, branches, payrollSettings] = await Promise.all([
    loadCashPlanState(),
    cashReportsBetween(addDays(today, -SALES_LOOKBACK_DAYS), addDays(today, -1)),
    loadTermDays(),
    loadPaidOnDelivery(),
    branchesP.then((bs) => tillsCarry(addDays(today, 1), branch ? bs.filter((b) => b.id === branch) : bs)),
    // Faturası beklenen cari borçlar: o tedarikçinin mal tahmini bu kadar düşer (K19); kayıt yokken boş. Cari firmanın:
    // şubenin akışında yok
    branch ? [] : loadExpectedDebtsByCard(),
    branchesP,
    payrollSettingsForPlan(),
  ]);
  const termOf = (supplier: string) => (paidOnDelivery(supplier) ? 0 : (termDays(supplier) ?? up.settings.invoiceTermDays));
  const goods = goodsRows(model.ds.invoices, today, termOf);
  const fromModel = planInputFromModel(model, today, payrollSettings ?? undefined);
  const built = buildCashPlan({
    ...fromModel,
    ...(branch ? { months: ownFixedMonths(model, fromModel.months, branch) } : {}),
    today,
    opening: !branch && state.balance !== null && state.balanceDate ? { amount: state.balance, date: state.balanceDate } : null,
    excluded: branch ? [...state.excluded, ...BRANCH_PLAN_EXCLUDED] : state.excluded,
    invoiceTermDays: up.settings.invoiceTermDays,
    // Şube şube (günlük satış şubelerin ortalamalarının toplamı); pasif şube sayılmaz
    cashReports: planCashReports(reports, branches),
    // Şubenin akışında yalnız şubeye seçilmiş faturalar (işletme geneli fatura ve faturasız borç firmanın planında)
    invoices: up.items.filter(isPayable).filter((i) => !branch || ownBranchPayable(i, up.invoiceBranches, branch)),
    // Şubenin akışında şubenin hatırlatıcıları; vergi ve SGK hatırlatıcısı değil (Tümü'de)
    reminders: branch ? up.reminders.filter((r) => r.branchId === branch && !isTaxPlanReminder(r)) : up.reminders,
    goods: goods.rows,
    goodsSpanDays: goods.spanDays,
    expectedDebts,
  });
  const plan = branch ? branchPlanWithoutTax(built) : built;
  return { plan, state, carry, invoiceTermDays: up.settings.invoiceTermDays };
}

/** Şubenin akışında sabit giderler yalnız şubenin (işletme geneli sabit gider şubenin kârına da akışına da girmez) */
function ownFixedMonths(model: Model, months: CashPlanInput["months"], branch: string): CashPlanInput["months"] {
  return Object.fromEntries(
    Object.entries(months).map(([m, v]) => {
      const own = new Set(model.fixedInMonth(m).filter((f) => f.branchId === branch).map((f) => f.id));
      return [m, { ...v, fixed: v.fixed.filter((f) => own.has(f.id)) }];
    }),
  );
}

export interface AreaCashPlan {
  /** Ekranın planı: firma kipinde ve "Tümü"de firmanın, şube kipinde şubenin akışı */
  view: CashPlanView;
  /** Planın modeli (notlar: komisyon, açık gün) */
  model: Model;
  /** Şube kipinde İşletme geneli satırları ve firmanın bakiyesi (bilgi); firma kipinde null */
  flow: BranchCashFlow | null;
}

/**
 * Nakit planı alanının okuması (şube ayrımı parça 4; Nakit planı ekranı, Genel bakış'ın kartı, bağlantının `odemeler`
 * aracı): `area` "Tümü"yse (firma kipi ya da "Tümü" seçili) bugünkü firmanın planı; tek şubeyse şubenin akışı ve
 * firmanın planından İşletme geneli satırları (src/lib/cash-plan-branch.ts). `company` önceden okunmuş firmanın modeli ve
 * ödemeleri (Genel bakış ikinci kez okumaz)
 */
export async function loadAreaCashPlan(area: BranchScope, company: { model?: Model; upcoming?: Awaited<ReturnType<typeof loadUpcoming>> } = {}): Promise<AreaCashPlan> {
  // Firmanın planı: firma kipinde ekranın kendisi; şube kipinde yalnız açılış bakiyesi ve İşletme geneli satırları
  // şube-ayrımı: nakit.bakiye
  const firm = await withBranchScope(ALL_BRANCHES, async () => {
    const [model, upcoming] = await Promise.all([company.model ?? loadModel(), company.upcoming ?? loadUpcoming()]);
    return { model, upcoming, view: await loadCashPlan(model, upcoming) };
  });
  if (area === ALL_BRANCHES) return { model: firm.model, view: firm.view, flow: null };
  const [own, branches] = await Promise.all([
    withBranchScope(area, async () => {
      const [model, upcoming] = await Promise.all([loadModel(), loadUpcoming(undefined, { branch: area })]);
      return { model, view: await loadCashPlan(model, upcoming, { branch: area }) };
    }),
    listBranches(),
  ]);
  const name = branches.find((b) => b.id === area)?.name ?? area;
  return { ...own, flow: branchCashFlow(firm.view.plan, sharedPlanIdsOf(firm.upcoming), name) };
}
