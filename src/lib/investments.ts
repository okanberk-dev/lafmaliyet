/**
 * Tek seferlik yatırımların şubesi (şube ayrımı, 27 Kasım 2026; migration 0101; docs/SUBE.md › Şube ayrımı › Şube sütunu
 * gelen tablolar). Saf: Sabit giderler › Tek seferlik yatırımlar ve dışa aktarımın Sabit Giderler sekmesi kullanır.
 *
 * Yatırımın şubesi boşsa işletme genelidir (eski kayıtlar). Tek şube seçiliyken liste o şubenin ve işletme genelinin
 * yatırımlarıdır (sabit gider gibi); toplam yalnız şubeninkidir, işletme geneli toplamı bilgi olarak ayrıca yazılır
 * (sahibin kararı 4: işletme geneli şubenin rakamına girmez, "Tümü"de bir kez sayılır).
 */

import { ALL_BRANCHES, type BranchScope } from "./branches";

export interface InvestmentLite {
  amount: number;
  /** Boş: işletme geneli */
  branchId: string | null;
}

export interface InvestmentTotals {
  /** Toplam: "Tümü"de bütün yatırımlar, şube seçiliyken yalnız şubenin */
  total: number;
  /** Şube seçiliyken listedeki işletme geneli yatırımların toplamı (bilgi); "Tümü"de 0 */
  shared: number;
  sharedCount: number;
}

/** Listedeki yatırımların toplamları (liste kapsamla okunmuş: şubenin ve işletme genelinin) */
export function investmentTotals(rows: readonly InvestmentLite[], scope: BranchScope): InvestmentTotals {
  const sum = (xs: readonly InvestmentLite[]) => Math.round(xs.reduce((a, i) => a + i.amount, 0) * 100) / 100;
  if (scope === ALL_BRANCHES) return { total: sum(rows), shared: 0, sharedCount: 0 };
  const own = rows.filter((r) => r.branchId === scope);
  const shared = rows.filter((r) => r.branchId === null);
  return { total: sum(own), shared: sum(shared), sharedCount: shared.length };
}

/** Satırın şube etiketi: birden çok şube açıkken "Tümü"de şubenin adı ya da "İşletme geneli", şube seçiliyken yalnız işletme geneli */
export function investmentBranchLabel(branchId: string | null, scope: BranchScope, names: ReadonlyMap<string, string>, manyBranches: boolean): string | null {
  if (!manyBranches) return null;
  if (branchId === null) return "İşletme geneli";
  return scope === ALL_BRANCHES ? (names.get(branchId) ?? branchId) : null;
}
