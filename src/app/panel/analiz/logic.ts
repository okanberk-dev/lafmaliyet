// Analiz sayfasının saf parçaları (testleri tests/mobil-gider-stok-analiz.test.ts): ürün tablosunun sıralama
// anahtarları ve senaryodaki tutar alanının işaret düğmesi.

export type SortKey = "name" | "cls" | "qty" | "mix" | "cm" | "totalCm" | "margin" | "price";
export type SortDir = "asc" | "desc";

/** Adresteki Türkçe karşılıklar: ?sirala=toplam-kar-azalan */
export const SORT_SLUG: Record<SortKey, string> = {
  name: "ad",
  cls: "grup",
  qty: "satis",
  mix: "pay",
  cm: "birim-kar",
  totalCm: "toplam-kar",
  margin: "marj",
  price: "fiyat",
};
export const DEFAULT_SORT = "toplam-kar-azalan";

export function parseSort(v: string): { key: SortKey; dir: SortDir } {
  const m = /^(.+)-(artan|azalan)$/.exec(v);
  const key = m ? (Object.keys(SORT_SLUG) as SortKey[]).find((k) => SORT_SLUG[k] === m[1]) : undefined;
  return key && m ? { key, dir: m[2] === "artan" ? "asc" : "desc" } : { key: "totalCm", dir: "desc" };
}

export const sortSlug = (key: SortKey, dir: SortDir) => `${SORT_SLUG[key]}-${dir === "asc" ? "artan" : "azalan"}`;

/**
 * Kart görünümündeki sıralama seçimi: tablo başlıklarının her iki yönü (başlığa iki kez tıklamanın karşılığı).
 * Adresteki her geçerli sıralama burada bir seçenektir; seçim kutusu hiçbir sıralamada boş kalmaz.
 */
export const CARD_SORTS: { value: string; label: string }[] = [
  { value: sortSlug("totalCm", "desc"), label: "Toplam brüt kâr (yüksekten)" },
  { value: sortSlug("totalCm", "asc"), label: "Toplam brüt kâr (düşükten)" },
  { value: sortSlug("qty", "desc"), label: "Satış adedi (çoktan)" },
  { value: sortSlug("qty", "asc"), label: "Satış adedi (azdan)" },
  { value: sortSlug("mix", "desc"), label: "Satış payı (yüksekten)" },
  { value: sortSlug("mix", "asc"), label: "Satış payı (düşükten)" },
  { value: sortSlug("cm", "desc"), label: "Birim kâr (yüksekten)" },
  { value: sortSlug("cm", "asc"), label: "Birim kâr (düşükten)" },
  { value: sortSlug("margin", "desc"), label: "Marj (yüksekten)" },
  { value: sortSlug("margin", "asc"), label: "Marj (düşükten)" },
  { value: sortSlug("price", "desc"), label: "Fiyat (yüksekten)" },
  { value: sortSlug("price", "asc"), label: "Fiyat (düşükten)" },
  { value: sortSlug("cls", "asc"), label: "Gruba göre (Yıldız → Zayıf)" },
  { value: sortSlug("cls", "desc"), label: "Gruba göre (Zayıf → Yıldız)" },
  { value: sortSlug("name", "asc"), label: "Ada göre (A→Z)" },
  { value: sortSlug("name", "desc"), label: "Ada göre (Z→A)" },
];

/**
 * Tutar alanının işaretini çevirir (iPhone'un sayı klavyesinde eksi tuşu yok): "30.000" → "-30.000", "-30.000" →
 * "30.000". Boş ya da sıfır alan "-" olur: ardından yazılan sayı eksi kalır (senaryo okuması "-"yi 0 sayar).
 */
export function flipSign(text: string): string {
  const t = text.trim();
  if (t.startsWith("-") || t.startsWith("−")) return t.slice(1).trim();
  if (t === "" || /^0+(?:[.,]0*)?$/.test(t)) return "-";
  return `-${t}`;
}

/**
 * Yazılan metinde eksi nerede olursa olsun başa alınır: telefonda ± ile "-" yapılıp alana dokunulunca imleç sağa
 * yaslı metnin başına düşebilir, "5000-" yazılır; bu "-5000" okunur. Birden çok eksi tek eksidir.
 */
export function normalizeSign(text: string): string {
  if (!/[-−]/.test(text)) return text;
  return `-${text.replace(/[-−]/g, "").trimStart()}`;
}

/**
 * Alana odaklanınca seçilecek aralık: eksi işareti seçime girmez, yazılan sayı onun yerine geçmez.
 * "-30.000" → [1, 7]; "12" → [0, 2]; "-" → [1, 1] (imleç işaretin arkasında).
 */
export function selectionAfterSign(text: string): [number, number] {
  return [text.startsWith("-") || text.startsWith("−") ? 1 : 0, text.length];
}
