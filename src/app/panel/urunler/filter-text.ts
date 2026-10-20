// Telefondaki "Süzgeç" penceresinin saf metinleri: düğmedeki etkin süzgeç sayısı ve özeti, pencerenin altındaki
// "84 ürünü göster" düğmesi. Ürünler ve Hammaddeler sayfası kullanır; tests/filter-text.test.ts ile sınanır.

import { num } from "@/lib/format";

const VOWELS = "aeıioöuü";

/** Son ünlüye göre dar ünlü (büyük ünlü uyumu): a/ı → ı, e/i → i, o/u → u, ö/ü → ü */
function narrowVowel(word: string): string {
  for (let i = word.length - 1; i >= 0; i--) {
    const c = word[i];
    if (c === "a" || c === "ı") return "ı";
    if (c === "e" || c === "i") return "i";
    if (c === "o" || c === "u") return "u";
    if (c === "ö" || c === "ü") return "ü";
  }
  return "i";
}

/**
 * Türkçe belirtme hâli: "ürün" → "ürünü", "malzeme" → "malzemeyi", "pasif malzeme" → "pasif malzemeyi".
 * Ünlüyle biten sözcükte "y" kaynaştırması eklenir. Ünsüz yumuşaması (kitap → kitabı) yapılmaz: listelerin
 * birimleri (ürün, malzeme, reçete) buna girmez.
 */
export function accusative(phrase: string): string {
  const text = phrase.trim();
  if (!text) return text;
  const lower = text.toLocaleLowerCase("tr-TR");
  const last = lower[lower.length - 1];
  const v = narrowVowel(lower);
  return VOWELS.includes(last) ? `${text}y${v}` : `${text}${v}`;
}

/** Süzgeç penceresinin altındaki düğme: "84 ürünü göster"; sonuç yoksa "Sonuç yok" */
export function showLabel(shown: number, unit: string): string {
  return shown > 0 ? `${num(shown)} ${accusative(unit)} göster` : "Sonuç yok";
}

/**
 * Etkin süzgeçlerin sayısı ve kısa özeti (boş, false ya da null parçalar atlanır, aynı ad bir kez yazılır).
 * Telefonda "Süzgeç" düğmesinin rozeti `count`, düğmenin altındaki satır `text` olur: "Dikkat · Espresso Bazlı · L".
 */
export function filterSummary(parts: (string | null | undefined | false)[]): { count: number; text: string } {
  const list = [...new Set(parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()))];
  return { count: list.length, text: list.join(" · ") };
}
