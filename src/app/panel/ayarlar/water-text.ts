import type { WaterCost } from "@/lib/calc/engine";
import { monthLabel, num, tl } from "@/lib/format";

/**
 * Su + buz birim maliyetinin nereden geldiği (Ayarlar kartı, Hammaddeler karosu). water.reason'a göre:
 * fatura girilmiş ama o ayın satış listesi yoksa "girilmedi" denmez, neden hesaplanamadığı söylenir. Metin noktasız biter.
 */
export function waterSource(water: WaterCost, short = false): string {
  switch (water.reason) {
    case "override":
      return short ? "Ayarlar'dan elle" : "Ayarlar'da elle girildi; su faturası kullanılmıyor";
    case "ok": {
      const m = monthLabel(water.month!);
      const skipped =
        water.latestBillMonth && water.latestBillMonth !== water.month
          ? `; ${monthLabel(water.latestBillMonth)} faturası o ayın satış listesi olmadığı için kullanılmadı`
          : "";
      return short ? `${m} su faturasından` : `${m} su faturası ${tl(water.bill)} ÷ ${num(water.liters, 1)} L su + buz${skipped}`;
    }
    case "no-usage": {
      const m = monthLabel(water.latestBillMonth!);
      return short
        ? `${m} faturası var, satış listesi yok`
        : `${m} su faturası girildi ama ${m} ürün satış listesi yok; litre hesaplanamadı (satış listesini yükleyin ya da birim maliyeti Ayarlar'da elle yazın)`;
    }
    case "no-bill":
      return short ? "Su faturası girilmedi" : "Gelir-gider tablosunda hiçbir ay SU GİDERİ girilmedi; su ve buz şimdilik maliyetsiz sayılıyor";
  }
}
