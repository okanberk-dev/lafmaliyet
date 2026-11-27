/**
 * Tedarikçi bakiyelerinin şube kipi (şube ayrımı D parça 4, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı, docs/TEDARIKCILER.md).
 * Saf: tedarikçinin carisi firmanındır (borç, ödeme ve mahsup tek hesapta); şube kipinde ekran onu ikiye ayırır:
 *
 * - **şubenin bakiyesi**: şubenin ve işletme genelinin faturaları (`invoiceInScope`; Faturalar'ın ve Ödemeler'in kuralı).
 *   Faturanın kalanı dağıtımlardan sonradır (fatura kendi kalanını taşır), yani onlara yapılan ödemeler düşülmüş gelir.
 *   Ödemeler: şubenin kasasından yapılanların tamamı, öbür ödemelerin şubenin faturalarına sayılan kısmı;
 * - **İşletme geneli**: faturasız borç (elle girilen alım, eski borç) ve hesaptaki (hiçbir kaleme sayılmamış) para.
 *
 * Şubesi seçilmemiş fatura hiçbir şubenin bakiyesinde yok ("Tümü"de var); öbür şubenin faturası da. Bu yüzden
 * "Tümü"deki cari = şubelerin bakiyeleri + İşletme geneli + şubesi seçilmemiş faturalar (işletme geneli fatura her şubenin
 * bakiyesinde görünür, toplamda bir kez sayılır).
 */

import { invoiceInScope } from "../invoice-branch";

import { accountOf, lastPaymentOf, paymentEvents, type AccountInvoice, type CariAccount, type CariAllocation, type CariPayment } from "./account";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** İşletme geneli satırı: firmanın faturasız borcu ve hesaptaki parası (şubenin bakiyesine girmez) */
export interface SharedCari {
  /** Açık faturasız borçların kalanı ve sayısı */
  debtOpen: number;
  debtOpenCount: number;
  /** Hesapta duran, hiçbir kaleme sayılmamış ödeme */
  credit: number;
  /** Faturasız borç − hesaptaki para (eksiyse alacak) */
  balance: number;
}

/** Firmanın hesabından İşletme geneli satırı */
export function sharedCariOf(full: Pick<CariAccount, "debtOpen" | "debtOpenCount" | "credit">): SharedCari {
  return { debtOpen: full.debtOpen, debtOpenCount: full.debtOpenCount, credit: full.credit, balance: r2(full.debtOpen - full.credit) };
}

/** Kasadan ödemenin kasası (Kasa satırının şubesi) */
export type BranchPayment = Pick<CariPayment, "id" | "date" | "amount" | "method"> & { cashOutBranchId?: string | null };

/**
 * Şubenin ödemeleri (Bu ay ödenen, Son ödeme): şubenin kasasından yapılan ödemenin tamamı; öbür ödemenin yalnız şubenin
 * faturalarına sayılan kısmı (hesapta duran ve öbür şubenin faturasına sayılan kısım şubenin değil). Tutarı sıfır
 * kalan ödeme düşer
 */
export function branchPayments(payments: readonly BranchPayment[], allocations: readonly Pick<CariAllocation, "paymentId" | "invoiceId" | "amount">[], invoiceIds: ReadonlySet<number>, branch: string): BranchPayment[] {
  return payments.flatMap((p) => {
    if (p.cashOutBranchId === branch) return [p];
    const counted = r2(allocations.filter((a) => a.paymentId === p.id && a.invoiceId !== null && invoiceIds.has(a.invoiceId)).reduce((x, a) => x + a.amount, 0));
    return counted > 0.005 ? [{ ...p, amount: counted }] : [];
  });
}

/**
 * Tedarikçinin şube kipindeki hesabı: kapsamdaki faturalarla kurulan özet (faturasız borç ve hesaptaki para yok:
 * İşletme geneli satırında), ödeme olayları şubenin ödemeleriyle. `scope` "Tümü"yse çağrılmaz
 */
export function branchAccountOf<I extends AccountInvoice & { branchId?: string | null; companyWide?: boolean | null }>(
  input: { invoices: readonly I[]; payments?: readonly BranchPayment[]; allocations?: readonly Pick<CariAllocation, "paymentId" | "invoiceId" | "amount">[] },
  scope: string,
  opts: { today: string; termDays: number; quietInvoiceIds?: ReadonlySet<number> },
): { invoices: I[]; account: CariAccount } {
  const invoices = input.invoices.filter((i) => invoiceInScope(i, scope));
  const base = accountOf({ invoices }, opts);
  const pays = branchPayments(input.payments ?? [], input.allocations ?? [], new Set(invoices.map((i) => i.id)), scope);
  const events = paymentEvents(invoices, pays);
  const last = lastPaymentOf(events);
  return { invoices, account: { ...base, events, lastPaid: last?.date ?? null, lastPaidAmount: last?.amount ?? 0 } };
}

/** Şube kipinin ekrandaki notu (Tedarikçiler ve tedarikçinin sayfası) */
export function branchCariNote(name: string): { title: string; text: string } {
  return {
    title: `${name} görünümü: şubenin ve işletme genelinin faturaları`,
    text:
      "Kalan borç, vade ve ödemeler yalnız bu şubenin ve işletme genelinin faturalarından (onlara sayılan ödemeler düşülmüş). Faturasız borç ve hesaptaki para firmanındır: “İşletme geneli” satırında. " +
      "Şube bakiyeleri + işletme geneli = tedarikçinin carisi (Tümü'de; şubesi seçilmemiş faturalar yalnız orada).",
  };
}

/** "İşletme geneli · faturasız borç 1.200,00 ₺ · hesaptaki para 300,00 ₺" için parçalar; ikisi de yoksa null */
export function sharedCariParts(s: Pick<SharedCari, "debtOpen" | "debtOpenCount" | "credit">): { debt: number; debtCount: number; credit: number } | null {
  if (s.debtOpen <= 0.005 && s.credit <= 0.005) return null;
  return { debt: s.debtOpen, debtCount: s.debtOpenCount, credit: s.credit };
}
