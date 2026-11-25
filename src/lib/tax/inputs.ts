/**
 * Vergi hesabının veritabanından gelen girdileri ve modelden görünüm girdisinin kurulması (plan docs/planlar/vergi.md
 * §7.1, K30). Sunucu bunları tek turda okur (src/server/data/tax.ts loadTaxInputs); Özet, Vergiye göre, nakit planı ve
 * dışa aktarım aynı kurucudan geçer, böylece aynı hesabı okur. Saf modül (Model yalnız tip); tests/vergi-eylemler.test.ts.
 */

import type { Model } from "../calc/engine";
import { shiftMonth } from "../calc/engine";
import type { CashPlanVat } from "../cash-plan";
import { addDays, type ReminderRow } from "../reminders";
import type { VatPaidEntry } from "../vat-paid";

import type { TaxAsset } from "./assets";
import type { TaxFiling } from "./corporate";
import { type MuhtasarItem, muhtasarItemsFromModel } from "./muhtasar";
import { type TaxAdjustment, taxPnlInputFromModel, type ZMonth } from "./pnl";
import { r2 } from "./rules";
import type { TaxSettings } from "./settings";
import { CALENDAR_DAYS, type TaxViewInput } from "./view";

/** Vergi tabloları, `tax.settings`, yazarkasanın ayları ve Ödendi kaydı: bir kez okunur, yüzeyler paylaşır */
export interface TaxInputs {
  settings: TaxSettings;
  filings: TaxFiling[];
  adjustments: TaxAdjustment[];
  assets: TaxAsset[];
  /** Yazarkasanın mali Z'si, ay ay (okc-z.ts okcMonth): oran oran KDV hariç matrah, gün sayısı, ayın tamamı girildi mi */
  zMonths: Map<string, ZMonth>;
  /** Aylık harcamalar'a yazılmış, sonra faturası Faturalar'a gelmiş kasadan çıkanlar (denetim B17): iki kez sayılmaz */
  invoicedCashOuts: Set<number>;
  /** KDV, KDV-2 ve geçici vergi hatırlatıcılarının kalıcı "Ödendi" kaydı (payments.vat-paid) */
  vatPaid: VatPaidEntry[];
}

/**
 * "Ödendi" işaretli geçici vergi dönemleri: kaydın tutarı ilk dönemindir ("tarihe kadar ödendi" sonrakileri tutarsız
 * kapatır). Aynı dönem iki kayıtta varsa tutarlı olan
 */
export function paidQuartersOf(vatPaid: readonly VatPaidEntry[]): { period: string; amount: number | null }[] {
  const out = new Map<string, number | null>();
  for (const e of vatPaid) {
    if (e.kind !== "gecici") continue;
    e.periods.forEach((p, i) => {
      const amount = i === 0 ? e.amount : null;
      if (!out.has(p) || (out.get(p) === null && amount !== null)) out.set(p, amount);
    });
  }
  return [...out].map(([period, amount]) => ({ period, amount }));
}

/** Yazarkasa ayından vergi gelirinin tabanı: oran oran KDV hariç matrah (yalnız girilen döküm; tahmini hiç) */
export function zMonthOf(okc: { byRate: readonly { base: number }[]; days: number; complete: boolean }): ZMonth {
  return { base: r2(okc.byRate.reduce((a, x) => a + x.base, 0)), days: okc.days, complete: okc.complete };
}

/**
 * Muhtasar kalemleri, dönem dönem: buildTaxView'ın penceresi (bugünden 6 ay önce, üç aylık seçenekte ilk çeyreğin
 * önceki aylarıyla … takvim penceresinin sonu); hesap döneminden önceki aylar yok
 */
export function muhtasarItemsWindow(model: Pick<Model, "fixedInMonth" | "pnlMonth" | "settings" | "expenseAmounts">, today: string, settings: Pick<TaxSettings, "periodStart">): Map<string, MuhtasarItem[]> {
  const items = new Map<string, MuhtasarItem[]>();
  const last = addDays(today, CALENDAR_DAYS).slice(0, 7);
  for (let m = shiftMonth(today.slice(0, 7), -6); m <= last; m = shiftMonth(m, 1)) if (m >= settings.periodStart.slice(0, 7)) items.set(m, muhtasarItemsFromModel(model, m));
  return items;
}

/**
 * Vergi görünümünün girdisi modelden ve okunan vergi girdilerinden (Özet, Vergiye göre, nakit planı, dışa aktarım). `reminders`
 * ve `vat` yalnız takvim içindir: nakit planının beslemesi onları okumaz (taxPlanFeed)
 */
export function taxViewInputFromModel(
  model: Model,
  inputs: TaxInputs,
  opts: {
    today: string;
    year?: number | null;
    quarter?: string | null;
    reminders?: readonly ReminderRow[];
    vat?: CashPlanVat | null;
    paidReminders?: TaxViewInput["paidReminders"];
  },
): TaxViewInput {
  const { settings } = inputs;
  const pnl = taxPnlInputFromModel(model, {
    settings,
    today: opts.today,
    adjustments: inputs.adjustments,
    assets: inputs.assets,
    filings: inputs.filings,
    zMonths: inputs.zMonths,
    invoicedCashOuts: inputs.invoicedCashOuts,
  });
  return {
    today: opts.today,
    year: opts.year ?? null,
    quarter: opts.quarter ?? null,
    settings,
    pnl,
    muhtasarItems: muhtasarItemsWindow(model, opts.today, settings),
    filings: inputs.filings,
    reminders: opts.reminders ?? [],
    vat: opts.vat ?? null,
    paidQuarters: paidQuartersOf(inputs.vatPaid),
    paidReminders: opts.paidReminders ?? [],
    settingsEmployerRate: model.settings.isverenSgk,
  };
}
