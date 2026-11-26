/**
 * Düz metin sürümünün yardımcıları (saf): HTML bileşenlerinin karşılığı satırlar. Mevcut e-postaların düz metni kendi
 * biçimini korur (değiştirilmez); bunlar yeni e-postalar ve aynı biçimi yazan şablonlar için. Satır dizileri
 * `[...].join("\n")` ile birleşir; bölümler arasında boş satır.
 */

/** "Etiket: değer" */
export const kvText = (label: string, value: string): string => `${label}: ${value}`;

/** Boş satır, başlık, "Etiket: değer" satırları */
export function sectionText(title: string, rows: readonly (readonly [string, string])[]): string[] {
  return ["", title, ...rows.map(([l, v]) => kvText(l, v))];
}

/** "- madde" ya da "1. madde" */
export function listText(items: readonly string[], o: { ordered?: boolean } = {}): string[] {
  return items.map((x, i) => (o.ordered ? `${i + 1}. ${x}` : `- ${x}`));
}

/** Büyük rakamlar: "Etiket: değer (alt satır)" */
export function kpiText(items: readonly { label: string; value: string; sub?: string | null }[]): string[] {
  return items.map((k) => `${k.label}: ${k.value}${k.sub ? ` (${k.sub})` : ""}`);
}

/** Durum bandı: başlık ve alt satır */
export function statusText(o: { title: string; sub?: string | null; eyebrow?: string | null }): string[] {
  return [o.eyebrow ? `${o.eyebrow}: ${o.title}` : o.title, ...(o.sub ? [o.sub] : [])];
}

/** Düğme: "Panelde aç: https://…" */
export const buttonText = (href: string, label: string): string => `${label}: ${href}`;
