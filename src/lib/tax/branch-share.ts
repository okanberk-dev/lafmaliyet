/**
 * Vergi alanının şube kipi (şube ayrımı parça 5, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Alanlar: Vergi, Tutarlılık,
 * Mutabakat, Stok değeri). Beyan firmanındır: KDV, muhtasar, geçici ve kurumlar vergisi, devreden KDV ve takvim her
 * görünümde firmanın tek vergi numarasıyla hesaplanır ("Firma geneli · beyan"). Şube seçili ve Vergi alanı "Yalnız
 * şube" kipindeyken ekran bunlara ek olarak **şubenin payını (bilgi)** gösterir: beyana bir şey eklemez, çıkarmaz.
 *
 * - Özet: satış KDV'si (şubenin kasası ve, online kanalda, laffogato.net), şubeye seçilmiş faturaların KDV'si
 *   (indirilecek), şube personelinin SGK'sı ve gelir ve damga vergisi stopajı, şubenin faturalarına bağlı demirbaşların
 *   amortismanı (`branchTaxShare`).
 * - Vergi kârı: çeyreğin "matraha katkı (bilgi)" satırı: şubenin geliri − şubenin gideri − şubenin amortismanı; işletme
 *   geneli gider, düzeltmeler ve muhasebecinin beyanname rakamları dahil değil (`branchTaxInput`, `branchContribution`).
 * - Eksik belgeler ve Demirbaş: yalnız şubenin ve işletme genelinin faturaları (`invoiceInScope`), öbürü sayı olarak.
 *
 * Saf modül (Model yalnız tip); veritabanı src/server/data/tax.ts › loadBranchTaxShare, testleri
 * tests/sube-ayrimi-alanlar-5.test.ts.
 */

import type { Model } from "../calc/engine";
import type { Invoice } from "../calc/types";
import { SEPARATE_CATEGORIES } from "../constants";
import { invoiceInScope } from "../invoice-branch";
import { purchaseVat, vatMonthInputs } from "../kdv";

import { assetTotals, type TaxAsset } from "./assets";
import { taxPayrollFromModel } from "./payroll";
import { taxMonths, type TaxPnlInput, taxQuarters } from "./pnl";
import { r2 } from "./rules";
import type { TaxSettings } from "./settings";

/** Kartın başlığı ve beyanın rozeti */
export const BRANCH_SHARE_TITLE = "Şubenin payı (bilgi)";
export const FIRM_DECLARATION_BADGE = "Firma geneli · beyan";
/** Kartın altındaki tek satır: pay beyana girmez */
export const BRANCH_SHARE_NOTE = "Bilgi: beyan firmanın tek vergi numarasıyla; işletme geneli faturalar, giderler ve düzeltmeler şubenin payına girmez.";

/** Şubenin faturası mı (şubeye seçilmiş; işletme geneli ve şubesi seçilmemiş değil) */
export const ownInvoice = (inv: Pick<Invoice, "branchId">, branch: string): boolean => inv.branchId === branch;

export interface BranchTaxShare {
  branch: string;
  year: number;
  /** Hesaba giren aylar (yılın, bugüne kadar) */
  months: string[];
  /** Satış KDV'si: şubenin kasası (POS) ve online kanalın siparişleri */
  salesVat: number;
  /** Şubeye seçilmiş alış faturalarının KDV'si (kafe dışı fatura hariç) ve fatura sayısı */
  purchaseVat: number;
  invoices: number;
  /** Satış − alış KDV'si (bilgi; devreden ve beyan firmanın) */
  vatDiff: number;
  /** Şube personelinin SGK'sı (işçi + işveren, destek düşülmüş) ve gelir + damga vergisi stopajı */
  sgk: number;
  stopaj: number;
  /** Bordrosu hesaplanan kişi (yılın en kalabalık ayı) */
  people: number;
  /** Şubenin faturalarına bağlı demirbaşların yıllık amortismanı ve doğrudan gider yazılanlar */
  depreciation: number;
  /** Şubenin demirbaş sayısı */
  assets: number;
}

/**
 * Şubenin yılın bugüne kadarki vergi payı (bilgi). `model` şubenin görünümüyle kurulmuş olmalı (`loadModel` şubenin
 * kapsamında: satış, kasa, personel şubenin); faturalardan yalnız şubeye seçilmiş olanlar sayılır, işletme geneli fatura
 * şubenin payında değildir. `assets` firmanın bütün demirbaşları (şubenin faturasına bağlı olanlar seçilir)
 */
export function branchTaxShare(
  model: Model,
  input: { branch: string; year: number; today: string; settings: TaxSettings; assets: readonly TaxAsset[] },
): BranchTaxShare {
  const { branch, year, today } = input;
  const inYear = (m: string) => m.startsWith(`${year}-`) && m <= today.slice(0, 7);
  const vat = vatMonthInputs(model, today).months.filter((m) => inYear(m.month));
  const salesVat = r2(vat.reduce((a, m) => a + (m.pos?.vat ?? 0) + (m.online?.vat ?? 0), 0));
  const own = model.ds.invoices.filter((i) => ownInvoice(i, branch));
  const purchases = own.filter((i) => inYear(i.date.slice(0, 7)) && !SEPARATE_CATEGORIES.includes(i.category));
  const purchaseVatSum = r2(purchases.reduce((a, i) => a + purchaseVat(i), 0));
  let sgk = 0;
  let stopaj = 0;
  let people = 0;
  for (const [m, p] of taxPayrollFromModel(model, year, input.settings)) {
    if (!inYear(m)) continue;
    sgk += p.totals.sgkTotal;
    stopaj += p.totals.gv + p.totals.dv;
    people = Math.max(people, p.totals.people);
  }
  const assets = branchAssets(input.assets, own);
  const totals = assetTotals(assets, year, input.settings);
  const direct = [...totals.direct.values()].reduce((a, v) => a + v, 0);
  return {
    branch,
    year,
    months: vat.map((m) => m.month),
    salesVat,
    purchaseVat: purchaseVatSum,
    invoices: purchases.length,
    vatDiff: r2(salesVat - purchaseVatSum),
    sgk: r2(sgk),
    stopaj: r2(stopaj),
    people,
    depreciation: r2(totals.yearDepreciation + direct),
    assets: assets.length,
  };
}

/** Şubenin faturalarına bağlı demirbaşlar (faturasız ve işletme geneli faturanın demirbaşı firmanın) */
export function branchAssets<T extends Pick<TaxAsset, "invoiceId">>(assets: readonly T[], ownInvoices: readonly Pick<Invoice, "id">[]): T[] {
  const ids = new Set(ownInvoices.map((i) => i.id));
  return assets.filter((a) => a.invoiceId !== null && ids.has(a.invoiceId));
}

/**
 * Demirbaş ekranının şube kipi: şubenin ve işletme genelinin faturalarına bağlı demirbaşlar listede; faturasız,
 * öbür şubenin ve şubesi seçilmemiş faturanınki sayı olarak ("N demirbaş Tümü'de"). Fatura okunamıyorsa (silinmiş) liste
 * dışı sayılır; faturası silinen demirbaşın uyarısı ekranda ayrıca kalır (beyanı bozar)
 */
export function scopeAssets<T extends Pick<TaxAsset, "invoiceId">>(
  assets: readonly T[],
  invoices: readonly Pick<Invoice, "id" | "branchId" | "companyWide">[],
  branch: string,
): { shown: T[]; hidden: number } {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const shown = assets.filter((a) => {
    const inv = a.invoiceId === null ? undefined : byId.get(a.invoiceId);
    return inv !== undefined && invoiceInScope(inv, branch);
  });
  return { shown, hidden: assets.length - shown.length };
}

/**
 * Vergi kârının girdisi şubenin kalemleriyle (matraha katkı, bilgi): yalnız şubeye seçilmiş faturalar, şubenin sabit
 * giderleri ve harcamaları, şubenin faturalarına bağlı demirbaşlar; Gelir-gider'e elle yazılan işletme geneli hücreler,
 * muhasebecinin kayıtları (beyanname matrahı dahil: gelir şubenin Z'sinden ya da kasasından) ve düzeltmeler yok. `input`
 * şubenin modelinden kurulmuş olmalı (taxPnlInputFromModel; Z ayları şubenin kasasından)
 */
export function branchTaxInput(input: TaxPnlInput, branch: string): TaxPnlInput {
  const fixed = input.fixed.filter((f) => f.branchId === branch);
  const fixedIds = new Set(fixed.map((f) => f.id));
  const invoices = input.invoices.filter((i) => ownInvoice(i, branch));
  const months = new Map(
    [...input.months].map(([k, m]) => [
      k,
      {
        ...m,
        fixedCells: m.fixedCells.filter((c) => fixedIds.has(c.id)),
        stopajCells: (m.stopajCells ?? []).filter((c) => fixedIds.has(c.id)),
        officialRent: (m.officialRent ?? []).filter((c) => fixedIds.has(c.id)),
        manualCells: {},
      },
    ]),
  );
  return {
    ...input,
    months,
    invoices,
    fixed,
    expenseEntries: input.expenseEntries.filter((e) => e.branchId === branch),
    assets: branchAssets(input.assets, invoices),
    adjustments: [],
    filings: [],
  };
}

export interface BranchContribution {
  quarter: string;
  months: string[];
  income: number;
  expense: number;
  depreciation: number;
  /** Gelir − gider − amortisman (bilgi) */
  result: number;
}

/** Çeyreğin matraha katkısı (bilgi), şubenin girdisiyle (`branchTaxInput`); çeyrek hesap döneminde değilse null */
export function branchContribution(input: TaxPnlInput, quarter: string): BranchContribution | null {
  const year = Number(quarter.slice(0, 4));
  const months = taxMonths(input, year);
  const q = taxQuarters(input, months, year).find((x) => x.key === quarter);
  if (!q) return null;
  const depreciation = r2(q.depreciation + q.direct);
  return { quarter, months: q.months, income: q.income, expense: q.expense, depreciation, result: r2(q.result - depreciation) };
}
