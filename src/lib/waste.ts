import { num } from "./format";

/**
 * Zayi ve ikram (saf; testli: tests/zayi-ikram.test.ts). Personel gün içinde atılan / bozulan (zayi) ve ödenmeden
 * verilen (ikram: müşteriye, personele, tadım) ürün ya da hammaddeyi girer. Tutarlılık ekranı bunları satıştan ayrı
 * tüketim olarak gösterir, kasa raporu günün özetini taşır. Ayrıntı: docs/ZAYI-IKRAM.md.
 */

export type WasteKind = "zayi" | "ikram";

export const WASTE_KIND_LABEL: Record<WasteKind, string> = { zayi: "Zayi", ikram: "İkram" };

/** Hızlı seçilen nedenler (serbest not ayrıca yazılır) */
export const WASTE_REASONS: Record<WasteKind, string[]> = {
  zayi: ["Bozuldu / tarihi geçti", "Döküldü / kırıldı", "Yanlış hazırlandı", "Müşteri geri gönderdi", "Diğer"],
  ikram: ["Müşteri", "Personel", "Tadım / deneme", "Diğer"],
};

/** Seçilebilen kalem: menü ürünü (adet) ya da hammadde (sayım biriminde; yoksa kendi biriminde) */
export interface WasteChoice {
  type: "product" | "ingredient";
  id: number;
  name: string;
  /** "adet" ya da KG, LT, ADET, DİLİM, gr, ml… */
  unit: string;
  /** Girilen miktar × factor = malzemenin kendi birimi (KG → gr: 1000) */
  factor: number;
  /** Arama için: kategori ya da grup */
  group: string;
}

/** Ürünün kayıttaki adı: "Latte M", "Cookie" (tek boy) */
export function productLabel(p: { name: string; size: string }): string {
  return p.size === "Tek" ? p.name : `${p.name} ${p.size}`;
}

/** "2 adet", "1,5 KG" */
export function qtyText(qty: number, unit: string): string {
  return `${num(qty, 3)} ${unit}`;
}

export interface WasteLine {
  kind: WasteKind;
  name: string;
  qty: number;
  unit: string;
}

/**
 * Günün özeti, kalem kalem: "2× Latte M, 1× Cookie" (adetli ürünler), hammaddede miktar ("Süt 1,5 LT"). Aynı
 * kalem birleştirilir; en çok `max` kalem, kalanı "+3".
 */
export function summarize(lines: WasteLine[], kind: WasteKind, max = 6): string | null {
  const merged = new Map<string, { name: string; qty: number; unit: string }>();
  for (const l of lines.filter((x) => x.kind === kind)) {
    const key = `${l.name}|${l.unit}`;
    const cur = merged.get(key) ?? { name: l.name, qty: 0, unit: l.unit };
    cur.qty += l.qty;
    merged.set(key, cur);
  }
  if (!merged.size) return null;
  const parts = [...merged.values()].map((m) => (m.unit === "adet" ? `${num(m.qty, 3)}× ${m.name}` : `${m.name} ${qtyText(m.qty, m.unit)}`));
  return parts.length > max ? `${parts.slice(0, max).join(", ")} +${parts.length - max}` : parts.join(", ");
}

/** Arama: Türkçe büyük/küçük harf ve aksan farkı gözetmeden, kelime kelime */
export function matchesChoice(choice: Pick<WasteChoice, "name" | "group">, query: string): boolean {
  const fold = (s: string) =>
    s
      .toLocaleLowerCase("tr")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i");
  const hay = fold(`${choice.name} ${choice.group}`);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
