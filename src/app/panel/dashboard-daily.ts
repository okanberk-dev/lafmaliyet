// Genel bakış › "günlük ciro" kartının verisi (saf; tests/genel-bakis-gunluk.test.ts). Satırlar ay bilgisinin okuduğu
// kasa satırları (src/server/data/cash-reports.ts tillRows: şube başına günde bir satır, rapor > LafPOS gün sonu > ModPOS
// föyü), ciro kuralı ay bilgisininki (src/lib/cash-month.ts tillMonths, src/lib/cash-revenue.ts dayRevenue): günlerin
// toplamı ayın POS cirosu, gün sayısı açık gün. "Tümü"de günün çubuğu şubelerin toplamıdır (denetim HM-06).

import type { TillRow } from "@/lib/cash-month";
import { dayRevenue } from "@/lib/cash-revenue";

/**
 * Ayın açık günleri (Z toplamı sıfırdan büyük) ve her birinin cirosu (KDV dahil, ödenmez / ikram hariç), günün sırasıyla.
 * Aynı günün şubeleri tek gündür: ciroları toplanır
 */
export function monthDays(rows: readonly TillRow[], month: string): { date: string; revenue: number }[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.date.slice(0, 7) !== month || r.zTotal <= 0) continue;
    const revenue = dayRevenue({ zTotal: r.zTotal, offRevenue: r.offRevenue ?? null, payments: r.payments ?? null }).revenue;
    byDay.set(r.date, Math.round(((byDay.get(r.date) ?? 0) + revenue) * 100) / 100);
  }
  return [...byDay].map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date));
}
