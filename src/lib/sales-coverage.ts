/**
 * Satış listesinin (ModPOS ürün satış raporu) kapsadığı dönem. Ay bitince yüklenen liste ayın tamamıdır; süren ayda
 * yapıştırılan liste o güne kadardır, kasa raporları ise her akşam ilerler. Listeye dayanan hesaplar (günlük ortalama,
 * liste ↔ POS cirosu uyarısı, "ayda …" adetleri, reçeteye göre kârın sabit gideri) listenin günleriyle yapılır
 * (engine.ts listPeriod). Saf modül; tests/satis-donemi.test.ts.
 *
 * Saklama: integration_state › `sales.coverage` = { "YYYY-MM": "YYYY-MM-DD" } (yalnız süren ayda yüklenen listeler;
 * biten aya yüklenen liste kaydı siler: ayın tamamı). Bu kayıt ayın tek, şubesiz kaydıdır: aynı aya öteki şubenin
 * yüklediği liste onu ezer. Panelin ay kuralı (veri kümesi, satış tahmini) bunu okur.
 *
 * Şubenin kendi kaydı: integration_state › `sales.coverage.sube` = { "<şube>": { "YYYY-MM": "YYYY-MM-DD" | null } }
 * (null: ayın tamamı). Satışlar ortak kayıtla aynı anda yazar, şubenin listesi temizlenince şubenin ayı silinir. Şubeye
 * bakan okuyucu (LafPOS'un ModPOS dönemi ucu, docs/LAFPOS.md) branchCoverage ile okur: Tuzla'nın listesi Marina'nın
 * listesinin son gününü kaydırmaz.
 */

import { addDays } from "./reminders";

export const SALES_COVERAGE_KEY = "sales.coverage";
/** Şube şube kayıt (yukarıda) */
export const SALES_COVERAGE_BRANCH_KEY = "sales.coverage.sube";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Saklanan kayıt; bozuk alanlar atılır */
export function parseCoverage(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [m, d] of Object.entries(v as Record<string, unknown>)) {
    if (MONTH.test(m) && typeof d === "string" && DAY.test(d) && d.slice(0, 7) === m) out[m] = d;
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

/** Şubenin kendi kaydı (`sales.coverage.sube` içinde şubeninki); null değer ayın tamamıdır, bozuk alanlar atılır */
export function parseBranchCoverage(v: unknown, branchId: string): Record<string, string | null> {
  const own = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)[branchId] : undefined;
  if (!own || typeof own !== "object" || Array.isArray(own)) return {};
  const out: Record<string, string | null> = {};
  for (const [m, d] of Object.entries(own as Record<string, unknown>)) {
    if (!MONTH.test(m)) continue;
    if (d === null) out[m] = null;
    else if (typeof d === "string" && DAY.test(d) && d.slice(0, 7) === m) out[m] = d;
  }
  return out;
}

/**
 * Şubenin kapsamı: şubenin kendi kaydı olan ayda o (null: ayın tamamı, ortak kayıt yok sayılır), olmayan ayda (şube
 * kaydından önce yüklenen liste) ortak kayıt
 */
export function branchCoverage(shared: Readonly<Record<string, string>>, own: Readonly<Record<string, string | null>>): Record<string, string> {
  const out: Record<string, string> = { ...shared };
  for (const [m, d] of Object.entries(own)) {
    if (d === null) delete out[m];
    else out[m] = d;
  }
  return out;
}
