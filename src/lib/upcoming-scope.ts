/**
 * Ödemeler ve faturalar alanının şube kipi (şube ayrımı D parça 4, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı). Saf:
 * `loadUpcoming` (src/server/notify/digest.ts) listeyi bütün faturalar ve cari hesapla kurar (tedarikçinin hesabındaki
 * para firmanındır, mahsup firmanın hesabıyla yapılır), tek şube kipinde sonuç buradan süzülür:
 *
 * - hatırlatıcı: veritabanında süzülür (şubenin ve işletme genelinin), burada dokunulmaz;
 * - fatura: şubenin ve işletme genelinin faturası listede (`invoiceInScope`); şubesi seçilmemiş fatura listede değil,
 *   "N faturanın şubesi seçilmemiş" sayısında (`unassigned`); öbür şubenin faturası hiç;
 * - faturasız borç (cari): firmanın, "İşletme geneli" bölümünde (`shared`), şubenin listesinde değil.
 *
 * "Tümü"de liste olduğu gibi (`shared` boş, `unassigned` sıfır).
 */

import { ALL_BRANCHES, type BranchScope } from "./branches";
import { invoiceInScope, isUnassigned } from "./invoice-branch";
import type { UpcomingItem } from "./reminders";

/** Faturanın şube sütunları (invoices.branch_id, company_wide) */
export interface InvoiceBranchRef {
  branchId: string | null;
  companyWide: boolean;
}

export interface UpcomingLists {
  items: UpcomingItem[];
  later: UpcomingItem[];
  covered: UpcomingItem[];
}

export interface ScopedUpcoming extends UpcomingLists {
  /** Firmanın faturasız borçları (cari), şube kipinde "İşletme geneli" bölümünde; "Tümü"de boş */
  shared: UpcomingItem[];
  /** Şubesi seçilmemiş ödenmemiş faturalar (listede ve takvimde olmayanlar); "Tümü"de sıfır */
  unassigned: { count: number; total: number };
}

const NONE: ScopedUpcoming["unassigned"] = { count: 0, total: 0 };

/** Kalem şube kipinde nereye düşer: listede, işletme geneli bölümünde, şubesi seçilmemiş sayısında ya da hiç */
export function upcomingPlace(item: Pick<UpcomingItem, "source" | "sourceId">, scope: BranchScope, invoiceOf: (id: number) => InvoiceBranchRef | undefined): "liste" | "isletme" | "secilmemis" | "yok" {
  if (scope === ALL_BRANCHES) return "liste";
  switch (item.source) {
    case "reminder":
      return "liste";
    case "cari":
      return "isletme";
    case "invoice": {
      const ref = invoiceOf(item.sourceId);
      // Okunamayan fatura (liste kurulduktan sonra silindi) şubesi seçilmemiş gibi: sessizce kaybolmaz
      if (!ref || isUnassigned(ref)) return "secilmemis";
      return invoiceInScope(ref, scope) ? "liste" : "yok";
    }
  }
}

/** Listeyi alanın kapsamına süzer (yukarıdaki kural); "Tümü"de olduğu gibi */
export function scopeUpcoming(up: UpcomingLists, scope: BranchScope, invoiceOf: (id: number) => InvoiceBranchRef | undefined): ScopedUpcoming {
  if (scope === ALL_BRANCHES) return { ...up, shared: [], unassigned: NONE };
  const place = (i: UpcomingItem) => upcomingPlace(i, scope, invoiceOf);
  const unassignedItems = [...up.items, ...up.later].filter((i) => place(i) === "secilmemis");
  return {
    items: up.items.filter((i) => place(i) === "liste"),
    later: up.later.filter((i) => place(i) === "liste"),
    // Hesaptaki parayla tamamen karşılananlar: yalnız şubenin listesine giren faturalar (cari firmanın)
    covered: up.covered.filter((i) => place(i) === "liste"),
    shared: [...up.items, ...up.later].filter((i) => place(i) === "isletme"),
    unassigned: { count: unassignedItems.length, total: Math.round(unassignedItems.reduce((a, i) => a + (i.amount ?? 0), 0) * 100) / 100 },
  };
}

/**
 * Sabah e-postasında kalemin şubesi (şubeye bağlı alıcı grubu yalnız kendi şubesinin ve şubesizlerin kalemini alır;
 * `digestItemInGroup`): hatırlatıcının şubesi; faturanın şubesi (işletme geneli ve şubesi seçilmemiş fatura null: her
 * gruba gider, ödeme kaçmasın); faturasız borç null (firmanın)
 */
export function digestItemBranch(item: Pick<UpcomingItem, "source" | "sourceId">, reminderBranch: (id: number) => string | null, invoiceOf: (id: number) => InvoiceBranchRef | undefined): string | null {
  switch (item.source) {
    case "reminder":
      return reminderBranch(item.sourceId);
    case "invoice": {
      const ref = invoiceOf(item.sourceId);
      return ref && ref.branchId && !ref.companyWide ? ref.branchId : null;
    }
    case "cari":
      return null;
  }
}

/** "3 faturanın şubesi seçilmemiş" (Ödemeler'in şube kipi; Faturalar'da şubesi seçilince listeye girer) */
export function unassignedText(n: number): string {
  return `${n} faturanın şubesi seçilmemiş`;
}
