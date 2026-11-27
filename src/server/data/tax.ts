import "server-only";

import { asc, eq, gte } from "drizzle-orm";

import type { Model } from "@/lib/calc/engine";
import { shiftMonth } from "@/lib/calc/engine";
import { okcMonth } from "@/lib/okc-z";
import { addDays, todayTR } from "@/lib/reminders";
import type { TaxAsset } from "@/lib/tax/assets";
import type { TaxFiling } from "@/lib/tax/corporate";
import { type BranchContribution, branchContribution, branchTaxInput, branchTaxShare, type BranchTaxShare } from "@/lib/tax/branch-share";
import { type TaxInputs, taxViewInputFromModel, zMonthOf } from "@/lib/tax/inputs";
import { type TaxAdjustment, taxPnlInputFromModel, type ZMonth } from "@/lib/tax/pnl";
import { parseTaxSettings, TAX_SETTINGS_KEY, type TaxSettings } from "@/lib/tax/settings";
import { buildTaxView, type TaxPlanFeed, taxPlanFeed, type TaxView } from "@/lib/tax/view";
import { withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadCashPlan, type CashPlanView } from "@/server/data/cash-plan";
import { loadCashOutInvoiceState } from "@/server/data/cash-out-invoices";
import { okcRows } from "@/server/data/cash-reports";
import { loadModel } from "@/server/data/dataset";
import { loadRecentPaid } from "@/server/data/recent-paid";
import { loadVatPaid } from "@/server/data/vat-paid";
import { getDb, schema as s } from "@/server/db";
import { loadUpcoming } from "@/server/notify/digest";

/*
 * Vergi bölümünün yükleyicileri (plan docs/planlar/vergi.md §7.1, K30; docs/VERGI.md). Vergi girdilerini tek yükleyici
 * okur (loadTaxInputs: ayarlar, üç vergi tablosu, yazarkasanın ayları, B17'nin iki kez sayılan kasa satırları, Ödendi
 * kaydı; tek tur). Nakit planı (loadCashPlan) önceden okunmuş girdiyi kabul eder; Özet hepsini bir kez okur, Vergiye
 * göre nakit planını okumaz, Kurallar yalnız ayarları. Yalnız yönetici sayfaları ve eylemleri çağırır.
 */

type Upcoming = Awaited<ReturnType<typeof loadUpcoming>>;

/** `tax.settings` (integration_state); yoksa ya da bozuksa varsayılanlar (Kurallar sekmesi yalnız bunu okur) */
export async function loadTaxSettings(): Promise<TaxSettings> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, TAX_SETTINGS_KEY)).limit(1);
  return parseTaxSettings(row?.value);
}

/** Satırdan hesap tipine: muhasebeci kaydı */
function filingOf(r: typeof s.taxFilings.$inferSelect): TaxFiling {
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.values ?? {})) if (typeof v === "number" && Number.isFinite(v)) values[k] = v;
  return { id: r.id, kind: r.kind, period: r.period, payable: r.payable, stamp: r.stamp, values, note: r.note, enteredByName: r.enteredByName, updatedAt: r.updatedAt.toISOString() };
}

/**
 * Vergi girdileri, tek turda (`Promise.all`). Muhasebeci kayıtları ve düzeltmeler hesaplanan yılların (geçen ve bu yıl,
 * `year` daha eskiyse o yıl) ve bir önceki yılın (devreden zarar: önceki yılın kurumlar vergisi kaydı); demirbaşlar
 * hepsi; yazarkasa Z'leri geçen yılın başından (önceki ayın kümülatifi için bir ay önceden) bugüne
 */
export async function loadTaxInputs(opts: { year?: number | null; today?: string } = {}): Promise<TaxInputs> {
  const db = getDb();
  const today = opts.today ?? todayTR();
  const ty = Number(today.slice(0, 4));
  const minYear = Math.min(opts.year ?? ty, ty - 1);
  const okcFrom = addDays(`${minYear}-01-01`, -40);
  const [settingsRow, filingRows, adjustmentRows, assetRows, okc, cashOutState, vatPaid] = await Promise.all([
    db.select().from(s.integrationState).where(eq(s.integrationState.key, TAX_SETTINGS_KEY)).limit(1),
    db
      .select()
      .from(s.taxFilings)
      .where(gte(s.taxFilings.period, String(minYear - 1)))
      .orderBy(asc(s.taxFilings.period), asc(s.taxFilings.id)),
    db
      .select()
      .from(s.taxAdjustments)
      .where(gte(s.taxAdjustments.month, `${minYear}-01`))
      .orderBy(asc(s.taxAdjustments.month), asc(s.taxAdjustments.id)),
    db.select().from(s.taxAssets).orderBy(asc(s.taxAssets.acquiredOn), asc(s.taxAssets.id)),
    okcRows(okcFrom, today, db),
    // Aylık harcamalar'a yazılmış, sonra faturası gelmiş kasa satırları: vergide "Paraşüt'te faturası var" (denetim B17)
    loadCashOutInvoiceState(db),
    loadVatPaid(),
  ]);
  const settings = parseTaxSettings(settingsRow[0]?.value);
  const zMonths = new Map<string, ZMonth>();
  for (let m = `${minYear}-01`; m <= today.slice(0, 7); m = shiftMonth(m, 1)) {
    const z = okcMonth(okc, m);
    if (z.days > 0) zMonths.set(m, zMonthOf(z));
  }
  const adjustments: TaxAdjustment[] = adjustmentRows.map((a) => ({ id: a.id, month: a.month, span: a.span, kind: a.kind, amount: a.amount, label: a.label, note: a.note, createdByName: a.createdByName }));
  const assets: TaxAsset[] = assetRows.map((a) => ({
    id: a.id,
    name: a.name,
    invoiceId: a.invoiceId,
    invoiceLabel: a.invoiceLabel,
    acquiredOn: a.acquiredOn,
    cost: a.cost,
    kind: a.kind,
    method: a.method,
    lifeYears: a.lifeYears,
    note: a.note,
  }));
  return {
    settings,
    filings: filingRows.map(filingOf),
    adjustments,
    assets,
    zMonths,
    invoicedCashOuts: new Set(cashOutState.duplicates.map((d) => d.id)),
    vatPaid,
  };
}

/**
 * Nakit planının vergi beslemesi (§8.1): muhtasar, geçici vergi, yurt dışı hizmetin KDV-2'si ve beyanname damgaları.
 * loadCashPlan'ı çağırmaz (döngü olmasın); KDV'yi nakit planı kendisi hesaplar
 */
export function loadTaxPlanFeed(model: Model, today: string, taxInputs: TaxInputs): TaxPlanFeed {
  return taxPlanFeed(taxViewInputFromModel(model, taxInputs, { today }));
}

export interface TaxViewData {
  view: TaxView;
  inputs: TaxInputs;
  /** Özet'in nakit planı (KDV satırları onun tahmini); Vergiye göre okumaz */
  cashPlan: CashPlanView | null;
  /** Ödemeler'deki hatırlatıcılar (pencerelerin "Ödemeler'de" karşılığı) */
  reminders: Upcoming["reminders"];
}

/**
 * Vergi sayfasının görünümü. Girdiyi almadıysa loadTaxInputs; nakit planını almadıysa loadCashPlan(model, upcoming,
 * { taxInputs }) (vergi tablolarını ikinci kez okumaz). `cashPlan: null` nakit planını ve Ödemeler'i okumaz (Vergiye
 * göre): KDV satırları tutarsız, hatırlatıcılar yalnız `upcoming` verildiyse
 */
export async function loadTaxView(
  model: Model,
  opts: { year?: number | null; quarter?: string | null; today?: string; taxInputs?: TaxInputs; cashPlan?: CashPlanView | null; upcoming?: Upcoming } = {},
): Promise<TaxViewData> {
  // Vergiye göre (cashPlan: null) Ödemeler'i okumaz: takvimi yok
  const withPlan = opts.cashPlan === undefined;
  const [taxInputs, upcoming, recentPaid] = await Promise.all([
    opts.taxInputs ?? loadTaxInputs({ year: opts.year, today: opts.today }),
    opts.upcoming ?? (withPlan ? loadUpcoming(opts.today) : null),
    // Son "Ödendi"ler: ödenen muhtasar, SGK ve geçici vergi dönemi takvimde satır olmaz (nakit planının paidReminders'ı)
    withPlan ? loadRecentPaid() : [],
  ]);
  const today = opts.today ?? upcoming?.today ?? todayTR();
  const cashPlan = withPlan ? await loadCashPlan(model, upcoming ?? undefined, { taxInputs }) : (opts.cashPlan ?? null);
  const reminders = upcoming?.reminders ?? [];
  const paidReminders = recentPaid.filter((e) => e.kind === "reminder").map((e) => ({ id: e.id, dueDate: e.dueDate, next: e.next ?? null, amount: e.amount }));
  const view = buildTaxView(taxViewInputFromModel(model, taxInputs, { today, year: opts.year, quarter: opts.quarter, reminders, vat: cashPlan?.plan.vat ?? null, paidReminders }));
  return { view, inputs: taxInputs, cashPlan, reminders };
}

export interface BranchTaxView {
  /** Şubenin adı */
  name: string;
  share: BranchTaxShare;
  /** Vergi kârının çeyreği verildiyse o çeyreğin matraha katkısı (bilgi) */
  contribution: BranchContribution | null;
}

/**
 * Vergi alanının şube kipi (şube ayrımı parça 5; src/lib/tax/branch-share.ts): şubenin payı (bilgi). Şubenin görünümüyle
 * okunur (`withBranchScope(şube)`: satış, kasa, Z, personel şubenin; faturalardan yalnız şubeye seçilmiş olanlar). Beyan
 * firmanın: sayfa bunu firmanın hesabının yanına koyar, hesabı değiştirmez. Hesaplanamazsa null (kart çizilmez)
 */
export async function loadBranchTaxView(branch: string, opts: { year: number; today?: string; quarter?: string | null }): Promise<BranchTaxView | null> {
  try {
    return await withBranchScope(branch, async () => {
      const [model, inputs, branches] = await Promise.all([loadModel(), loadTaxInputs({ year: opts.year, today: opts.today }), listBranches()]);
      const today = opts.today ?? todayTR();
      const share = branchTaxShare(model, { branch, year: opts.year, today, settings: inputs.settings, assets: inputs.assets });
      let contribution: BranchContribution | null = null;
      if (opts.quarter) {
        const pnl = taxPnlInputFromModel(model, {
          settings: inputs.settings,
          today,
          adjustments: [],
          assets: inputs.assets,
          filings: [],
          zMonths: inputs.zMonths,
          invoicedCashOuts: inputs.invoicedCashOuts,
        });
        contribution = branchContribution(branchTaxInput(pnl, branch), opts.quarter);
      }
      return { name: branches.find((b) => b.id === branch)?.name ?? branch, share, contribution };
    });
  } catch (e) {
    console.error("[vergi] şubenin payı hesaplanamadı", e);
    return null;
  }
}
