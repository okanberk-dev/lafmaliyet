import type { Tone } from "@/components/ui/badge";

/**
 * Reçete ↔ fatura oranının önem derecesi. Sunucu sayfası (metrik satırı) ile istemci tablosu (rozet, filtre)
 * aynı eşikleri kullansın diye ayrı, "use client" olmayan bir dosyada.
 *
 * Yeşil < 1,15× tutarlı · turuncu 1,15–1,5× stok ya da fire olabilir · kırmızı > 1,5× kontrol edilmeli.
 * Ayda hiç kullanılmadığı hâlde alım girilmişse (oran hesaplanamaz) de kırmızı sayılır.
 */
export const RATIO_WARN = 1.15;
export const RATIO_BAD = 1.5;

export type Severity = "big" | "diff" | "ok" | "none";

export function severityOf(r: { usage: number; purchased: number | null; ratio: number | null }): Severity {
  if (r.purchased === null) return "none";
  if (r.ratio === null) return r.purchased > 0 && !r.usage ? "big" : "ok";
  if (r.ratio > RATIO_BAD) return "big";
  if (r.ratio >= RATIO_WARN) return "diff";
  return "ok";
}

/**
 * Her derecenin rozet tonu, şerit rengi (anlamsal belirteç) ve metni. Renk tek başına anlam taşımaz:
 * rozet ve lejant her zaman `range` ya da `label` metniyle birlikte çizilir.
 */
export const SEVERITY: Record<Exclude<Severity, "none">, { label: string; range: string; hint: string; tone: Tone; bar: string }> = {
  ok: { label: "Tutarlı", range: "< 1,15×", hint: "tutarlı", tone: "green", bar: "bg-good" },
  diff: { label: "Fark var", range: "1,15–1,5×", hint: "stok veya fire olabilir", tone: "amber", bar: "bg-warn" },
  big: { label: "Büyük fark", range: "> 1,5×", hint: "reçete, fire ya da ikram kontrol edilmeli", tone: "red", bar: "bg-bad" },
};
