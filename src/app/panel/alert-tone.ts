import type { NoticeTone } from "@/components/ui/notice";

/**
 * Ayın uyarısının (src/lib/calc/insights.ts, zilin "Uyarılar" grubu) görünen önemi: danger → bad, warning → warn,
 * info → neutral. Aynı gerçek her yüzeyde (zil, Genel bakış'ın "Dikkat edilmesi gerekenler" kartı) aynı önemde
 * görünsün diye üç düzeltme; düzey hesabın kendisinde değişmez (görünüm katmanı, docs/planlar/ux-sade.md §4.7):
 * - "N ürünün kârı düşük" süresi olmayan bir öneri: kırmızı değil, turuncu;
 * - "Su ve buz maliyeti …" ve "Geçen ayın stok sayımı yok" ay sonu rakamını bozan eksik veri: bilgi değil, turuncu.
 */
export function alertTone(a: { level: "danger" | "warning" | "info"; title: string; href?: string }): NoticeTone {
  if (/ürünün kârı düşük$/.test(a.title)) return "warn";
  if (a.title.startsWith("Su ve buz maliyeti")) return "warn";
  if (a.title === "Geçen ayın stok sayımı yok") return "warn";
  return a.level === "danger" ? "bad" : a.level === "warning" ? "warn" : "neutral";
}
