// Sabit gider penceresinin kira alanları (Faz 5): ev sahibi türü, KDV ve resmi kira, kayda giden değerler. Saf; testi
// tests/kira-ev-sahibi.test.ts.

import type { FixedSection, LandlordType } from "@/lib/calc/types";
import { fixedVatRate } from "@/lib/constants";

export interface RentForm {
  section: FixedSection;
  /** Ev sahibi türü ("" = seçilmedi) */
  landlord: LandlordType | "";
  /** Kalemin KDV seçimi (null = bölümün varsayılanı) */
  vatRate: number | null;
  /** Resmi kira (boş ya da geçersizse null) */
  official: number | null;
  basis: "brut" | "net";
}

/**
 * saveFixedExpense'e giden kira alanları (inceleme bulgusu 7). Ev sahibi türü kayıtlı veriyi ezmez: motor türe uymayan
 * alanı zaten saymaz (şirkette resmi kira stopaja girmez: officialRentGross; tür seçiliyken KDV türden: fixedVatRate).
 * - KDV: kalemin kendi seçimi (yoksa bölümün varsayılanı), türün oranı değil; tür kaldırılınca o oran yine geçerli.
 * - Resmi kira: kira bölümünde türden bağımsız saklanır (şirket seçilip şahsa dönülünce stopajın kaynağı yerinde);
 *   kira dışı bölümde silinir (bugünkü kural).
 */
export function rentSaveFields(f: RentForm): { vatRate: number; officialAmount: number | null; officialBasis: "brut" | "net" | null; landlordType: LandlordType | null } {
  const kira = f.section === "kira";
  const official = kira && f.official !== null && f.official > 0 ? f.official : null;
  return {
    vatRate: fixedVatRate({ section: f.section, vatRate: f.vatRate }),
    officialAmount: official,
    officialBasis: official !== null ? f.basis : null,
    landlordType: kira && f.landlord ? f.landlord : null,
  };
}
