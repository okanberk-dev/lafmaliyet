import { num } from "@/lib/format";

/**
 * Tutarlılık'ın şube kipinde alınanın dayanağı: şubesi boş faturalar (işletme geneli ya da seçilmemiş) ve elle yazılan
 * alımlar dahil değil ("3 şubesiz fatura, 2 elle alım dahil değil"); ikisi de yoksa yalnız kural
 */
export function branchPurchaseNote(o: { invoices: number; manual: number }): string {
  const parts = [o.invoices ? `${num(o.invoices)} şubesiz fatura` : null, o.manual ? `${num(o.manual)} elle alım` : null].filter(Boolean);
  return parts.length
    ? `${parts.join(", ")} dahil değil: Faturalar'da şubesini seçin ya da firma geneli görünüme geçin.`
    : "İşletme geneli faturalar ve elle yazılan alım dahil değil.";
}
