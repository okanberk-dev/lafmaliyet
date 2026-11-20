// Genel bakış › "günlük ciro" kartının verisi (saf; tests/genel-bakis-gunluk.test.ts). Satırlar ay bilgisinin okuduğu
// kasa satırları (src/server/data/cash-reports.ts tillRows: rapor > LafPOS gün sonu > ModPOS föyü, şube başına günde bir
// satır), ciro kuralı ay bilgisininki (src/lib/cash-month.ts tillMonths, src/lib/cash-revenue.ts dayRevenue): günlerin
// toplamı ayın POS cirosu, gün sayısı açık gün.

import type { TillRow } from "@/lib/cash-month";
import { dayRevenue } from "@/lib/cash-revenue";

/**
 * Ayın açık günleri (Z toplamı sıfırdan büyük) ve her birinin cirosu (KDV dahil, ödenmez / ikram hariç), günün sırasıyla.
 * "Tümü"de birden çok şubenin aynı günkü satırları tek güne toplanır (gün başına bir çubuk; açık gün ve ortalama
 * işletmenin günü), tek şubede bugünkü gibi
 */
export function monthDays(rows: readonly TillRow[], month: string): { date: string; revenue: number }[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (r.date.slice(0, 7) !== month || r.zTotal <= 0) continue;
    const revenue = dayRevenue({ zTotal: r.zTotal, offRevenue: r.offRevenue ?? null, payments: r.payments ?? null }).revenue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + revenue);
  }
  return [...byDate]
    .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
