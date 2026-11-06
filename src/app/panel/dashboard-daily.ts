// Genel bakış › "günlük ciro" kartının verisi (saf; tests/genel-bakis-gunluk.test.ts). Satırlar ay bilgisinin okuduğu
// kasa satırları (src/server/data/cash-reports.ts tillRows: rapor > LafPOS gün sonu > ModPOS föyü, günde bir satır),
// ciro kuralı ay bilgisininki (src/lib/cash-month.ts tillMonths, src/lib/cash-revenue.ts dayRevenue): günlerin toplamı
// ayın POS cirosu, gün sayısı açık gün.

import type { TillRow } from "@/lib/cash-month";
import { dayRevenue } from "@/lib/cash-revenue";

/** Ayın açık günleri (Z toplamı sıfırdan büyük) ve her birinin cirosu (KDV dahil, ödenmez / ikram hariç), günün sırasıyla */
export function monthDays(rows: readonly TillRow[], month: string): { date: string; revenue: number }[] {
  return rows
    .filter((r) => r.date.slice(0, 7) === month && r.zTotal > 0)
    .map((r) => ({ date: r.date, revenue: dayRevenue({ zTotal: r.zTotal, offRevenue: r.offRevenue ?? null, payments: r.payments ?? null }).revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
