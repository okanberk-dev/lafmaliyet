/*
 * ara: ürün, hammadde ve tedarikçi adlarında arama (⌘K'nın listesi: loadSearchIndex). Tedarikçinin ipucundaki vergi
 * numarası gönderilmez ve aranmaz (ipucu "Tedarikçi" + unvan + öteki adlar olarak yeniden kurulur). Saf;
 * tests/claude-araclar.test.ts.
 */

import { cleanName, foldName, nameMatches, panelUrl } from "./common";

export interface SearchEntryLike {
  kind: "product" | "ingredient" | "supplier";
  label: string;
  hint: string;
  href: string;
}

export interface SearchAnswer {
  aranan: string;
  sonuclar: { tur: "ürün" | "hammadde" | "tedarikçi"; ad: string; ipucu: string; panelAdresi: string }[];
  toplam: number;
  kaynak: string[];
}

const KIND = { product: "ürün", ingredient: "hammadde", supplier: "tedarikçi" } as const;
export const MAX_RESULTS = 20;

/** Vergi no ya da TC kimlik no gibi görünen parça (10–11 rakam) */
const TAX_LIKE = /^\s*\d[\d\s]{8,}\d\s*$/;

/** İpucundan vergi numarası parçalarını atar ("Tedarikçi · SÜTAŞ A.Ş. · 1234567890 · Sütaş" → "Tedarikçi · SÜTAŞ A.Ş. · Sütaş") */
export function safeHint(hint: string): string {
  return hint
    .split(" · ")
    .filter((p) => !TAX_LIKE.test(p))
    .map((p) => cleanName(p, 80))
    .join(" · ");
}

export function searchResults(entries: readonly SearchEntryLike[], metin: string, ctx: { base: string }): SearchAnswer {
  const hits = entries
    .map((e) => ({ e, hint: safeHint(e.hint) }))
    .filter(({ e, hint }) => nameMatches(`${e.label} ${hint}`, metin))
    // Adı aranan metinle başlayanlar önce, sonra adında geçenler, sonra yalnız ipucunda geçenler
    .map((x) => {
      const label = foldName(x.e.label);
      return { ...x, rank: label.startsWith(foldName(metin)) ? 0 : nameMatches(x.e.label, metin) ? 1 : 2 };
    })
    .sort((a, b) => a.rank - b.rank);
  return {
    aranan: cleanName(metin, 60),
    sonuclar: hits.slice(0, MAX_RESULTS).map(({ e, hint }) => ({
      tur: KIND[e.kind],
      ad: cleanName(e.label),
      ipucu: hint,
      panelAdresi: panelUrl(ctx.base, e.href),
    })),
    toplam: hits.length,
    kaynak: ["Panelin arama listesi (⌘K): ürün, hammadde ve tedarikçi adları; tutar yok. Ayrıntı için ilgili aracı ya da ekranı kullanın."],
  };
}
