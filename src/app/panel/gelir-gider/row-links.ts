// Gelir-gider satırlarının kaynak ekranları (saf; tablo, telefondaki ay görünümü ve Genel bakış'ın dökümü birlikte
// kullanır). Tutar nereden geliyorsa oraya: faturalar (komisyon faturaları dahil), aylık harcamalar, stok sayımı,
// personel, sabit giderler, satışlar (ciro, POS komisyonunun kartlı satış oranı; denetim E-30). Testleri: tests/gelir-gider-baglanti.test.ts

import { shiftMonth } from "@/lib/calc/engine";
import { COMMISSION_CATEGORY } from "@/lib/constants";
import { monthLabel } from "@/lib/format";

export interface RowLink {
  href: string;
  /** Bağlantının adı (düğme metni, ekran okuyucu ve ipucu), ör. "Stok sayımı · Eylül 2026" */
  label: string;
  /**
   * "month": hedef ayın kendisine bağlı (her ayın hücresinde ayrı bağlantı); "row": bütün aylar için aynı sayfa
   * (personel, sabit giderler; tabloda satırın adında tek bağlantı)
   */
  scope: "month" | "row";
}

/** Faturalar: ayın ve tedarikçinin faturaları, listeye kaydırılmış */
export function invoicesHref(filters: { kategori?: string; ay?: string; ara?: string }): string {
  return `/panel/faturalar?${new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])))}#fatura-listesi`;
}

/**
 * Satırın bu aydaki kaynağı; yoksa null (toplamlar, oranlar, elle girilen satırlar, online satış).
 * - `value`: hücrenin değeri. Faturadan gelen satır (tedarikçi, komisyon faturası) o ayda boşsa (başka ayda faturası
 *   olduğu için tabloda) bağlantı yok: boş bir aramaya giderdi.
 * - `current`: "bu ay". Stok sayımı bağlantısı bu aydan sonraki bir aya gitmez (gelecek ayın sayımı açılıp yanlış aya
 *   sayılmasın; denetim E-01).
 */
export function rowLink(key: string, month: string, o: { value?: number | null; current?: string } = {}): RowLink | null {
  const empty = o.value === null;
  const notFuture = (m: string) => !o.current || m <= o.current;
  if (key.startsWith("purchase:")) {
    if (empty) return null;
    return { href: invoicesHref({ ay: month, ara: key.slice("purchase:".length) }), label: `Faturalar · ${monthLabel(month)}`, scope: "month" };
  }
  // Tahminin kartlı satış oranı Satışlar'da (#m-card alanı)
  if (key === "commission:pos") return { href: `/panel/satislar?ay=${month}#m-card`, label: `Satışlar · ${monthLabel(month)}`, scope: "month" };
  // Komisyon faturası: o ayın tarihli faturaları (Gelir-gider faturayı kendi tarihinin ayında sayar). Komisyon & hakediş
  // değil: orada 1-5'inde kesilen yemek kartı faturası önceki aydadır, sayfa yalnız son 13 ayı açar
  if (key.startsWith("commission:")) {
    if (empty) return null;
    return { href: invoicesHref({ kategori: COMMISSION_CATEGORY, ay: month, ara: key.slice("commission:".length) }), label: `Faturalar · ${monthLabel(month)}`, scope: "month" };
  }
  if (key.startsWith("expense:")) return { href: `/panel/harcamalar?ay=${month}`, label: `Aylık harcamalar · ${monthLabel(month)}`, scope: "month" };
  if (key === "stock:closing") return notFuture(month) ? { href: `/panel/sayim?ay=${month}`, label: `Stok sayımı · ${monthLabel(month)}`, scope: "month" } : null;
  if (key === "stock:opening") {
    const prev = shiftMonth(month, -1);
    return notFuture(prev) ? { href: `/panel/sayim?ay=${prev}`, label: `Stok sayımı · ${monthLabel(prev)}`, scope: "month" } : null;
  }
  if (key === "revenue") return { href: `/panel/satislar?ay=${month}#m-pos`, label: `Satışlar · ${monthLabel(month)}`, scope: "month" };
  if (key.startsWith("personnel:")) return { href: "/panel/personel", label: "Personel", scope: "row" };
  if (key.startsWith("fixed:")) return { href: "/panel/giderler", label: "Sabit giderler", scope: "row" };
  return null;
}
