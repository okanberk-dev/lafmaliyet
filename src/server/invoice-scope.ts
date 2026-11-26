import { eq, or, type SQL } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";

import { schema as s } from "./db";

/**
 * Faturanın şube koşulu (docs/SUBE.md › Faturanın şubesi; kural src/lib/invoice-branch.ts invoiceInScope): "Tümü"de
 * koşul yok; tek şubede o şubenin faturaları ve bilinçli işletme geneli olanlar. Şubesi seçilmemiş fatura (ikisi de
 * boş) tek şubede görünmez, ekran onu "Şubesi seçilmemiş" uyarısıyla sayar. Çerez okumaz: kapsamı çağıran verir
 * (eşitleme ve betikler de kullanır)
 */
export function invoiceScopeWhere(scope: BranchScope): SQL | undefined {
  return scope === ALL_BRANCHES ? undefined : or(eq(s.invoices.branchId, scope), eq(s.invoices.companyWide, true));
}
