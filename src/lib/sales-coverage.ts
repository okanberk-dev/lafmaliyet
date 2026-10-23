/**
 * Satış listesinin (ModPOS ürün satış raporu) kapsadığı dönem. Ay bitince yüklenen liste ayın tamamıdır; süren ayda
 * yapıştırılan liste o güne kadardır, kasa raporları ise her akşam ilerler. Listeye dayanan hesaplar (günlük ortalama,
 * liste ↔ POS cirosu uyarısı, "ayda …" adetleri, reçeteye göre kârın sabit gideri) listenin günleriyle yapılır
 * (engine.ts listPeriod). Saf modül; tests/satis-donemi.test.ts.
 *
 * Saklama: integration_state › `sales.coverage` = { "YYYY-MM": "YYYY-MM-DD" } (yalnız süren ayda yüklenen listeler;
 * biten aya yüklenen liste kaydı siler: ayın tamamı).
 */

import { addDays } from "./reminders";

export const SALES_COVERAGE_KEY = "sales.coverage";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Saklanan kayıt; bozuk alanlar atılır */
export function parseCoverage(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [m, d] of Object.entries(v as Record<string, unknown>)) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(m) && typeof d === "string" && DAY.test(d) && d.slice(0, 7) === m) out[m] = d;
  }
  return out;
}

/**
 * Yüklenen listenin son günü. Süren ayda: verilen gün (ayın içinde, bugünü geçmez); verilmezse dün (Patron'un raporu
 * genelde dünün sonuna kadardır), ayın 1'inde bugün. Biten ya da gelecek ayda null: liste ayın tamamıdır.
 */
export function coverageFor(month: string, today: string, given?: string | null): string | null {
  if (month !== today.slice(0, 7)) return null;
  const start = `${month}-01`;
  if (given && DAY.test(given) && given.slice(0, 7) === month && given <= today) return given;
  const yesterday = addDays(today, -1);
  return yesterday < start ? today : yesterday;
}
