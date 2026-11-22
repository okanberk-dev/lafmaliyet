// "Tükendi işaretle" penceresinin araması (dalga 10 §2.1): panelin ortak, Türkçe harf ve aksan duyarsız eşleşmesiyle
// ("ice" → "Ice Latte", "sut" → "Sütlü …"). tests/tukendi.test.ts ile sınanır.

import { fold, matches } from "@/components/ui/filters";
import type { SoldOutEntry } from "@/lib/site-menu/sold-out";

type Searchable = Pick<SoldOutEntry, "name" | "siteName">;

/** Sorgu paneldeki ya da sitedeki adda geçen kalemler; boş sorgu hepsini verir */
export function soldOutHits<T extends Searchable>(entries: readonly T[], query: string): T[] {
  if (!query.trim()) return [...entries];
  return entries.filter((e) => matches(e.name, query) || matches(e.siteName, query));
}

/** Sitedeki ad paneldekinden yalnız büyük/küçük harf ya da aksanla ayrılmıyorsa ikinci satırda gösterilir */
export function siteNameDiffers(e: Searchable): boolean {
  return fold(e.siteName) !== fold(e.name);
}
