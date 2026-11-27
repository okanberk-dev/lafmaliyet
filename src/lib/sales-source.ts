import type { AsilposSalesMonth } from "@/lib/calc/types";
import { periodKasa, salesMonthKasa } from "@/lib/asilpos/kasa";

/*
 * Ayın ürün satışlarının kaynağı, tek yerden (docs/planlar/ux-sade.md §10, K20): ekranların hiçbiri "satış = ay sonunda
 * elle yüklenen ModPOS raporu" varsaymaz; "yükleyin" diyen her metin `missing`'i, Satışlar'ın yükleme kartı ve Genel
 * bakış'ın "Satış raporu" işi `manual`'ı okur. Bugün `salesMonthKasa` üstüne kurulur (ModPOS raporu, AsilPOS, geçiş ayı).
 *
 * ModPOS bağlantısı (API) geldiğinde (docs/planlar/KALAN-ISLER.md "ModPOS bağlantısı"): bağlantının yazdığı aylar
 * `connectedMonths` olarak verilir, o aylar "ModPOS bağlantısı" olur ve bütün ekranlar kendiliğinden ona döner. Aynı ay
 * için elle yüklenmiş rapor varsa hangisinin sayılacağı bağlantı PR'ının kararıdır; bu modül yalnız etiketi ayırır.
 * Bugün hiçbir çağıran `connectedMonths` vermez. Saf; yalnız yönetici ekranları içe aktarır (personel dosyaları değil).
 */

export type SalesSourceKind = "modpos-rapor" | "asilpos" | "gecis" | "modpos-baglanti";

export interface SalesSource {
  kind: SalesSourceKind;
  /** Kısa ad: "ModPOS raporu" · "AsilPOS" · "ModPOS raporu + AsilPOS" · "ModPOS bağlantısı" */
  label: string;
  /** Başlığın altındaki tek satır (PageHeader `meta`): "Satışlar: ModPOS raporu (ay sonunda elle yüklenir)" … */
  line: string;
  /** Satış verisi yokken ne yapılır (cümle, sonda nokta yok): "Satışlar'a ürün satış raporunu yükleyin" … */
  missing: string;
  /** Elle yükleme bu ayın kaynağı mı (Satışlar'ın yükleme kartı, Genel bakış'ın "Satış raporu" işi, düğme etiketleri) */
  manual: boolean;
}

/**
 * Ayın satış kaynağı. Öncelik: ModPOS bağlantısı > AsilPOS / geçiş > ModPOS raporu. `connectedMonths`: ileride ModPOS
 * bağlantısının getirdiği aylar (açılıştan bu yana bütün aylar ondan okunur)
 */
export function salesSourceOf(
  month: string,
  switchDay: string | null,
  asilposSales: { months: readonly AsilposSalesMonth[] } | undefined,
  connectedMonths?: ReadonlySet<string>,
): SalesSource {
  if (connectedMonths?.has(month)) {
    return {
      kind: "modpos-baglanti",
      label: "ModPOS bağlantısı",
      line: "Satışlar: ModPOS bağlantısı (kendiliğinden)",
      missing: "ModPOS bağlantısı bu ayı henüz getirmedi",
      manual: false,
    };
  }
  const kasa = salesMonthKasa(month, switchDay, asilposSales);
  if (kasa.source === "asilpos") {
    return { kind: "asilpos", label: "AsilPOS", line: "Satışlar: AsilPOS (her gece kendiliğinden)", missing: "AsilPOS gün sonları her gece gelir", manual: false };
  }
  if (kasa.source === "gecis") {
    // Geçiş ayı: geçiş gününden önceki günlerin ModPOS raporu elle yüklenir, sonrası AsilPOS'tan gelir
    return {
      kind: "gecis",
      label: "ModPOS raporu + AsilPOS",
      line: `Satışlar: ${kasa.long}`,
      missing: "Satışlar'a geçiş gününden önceki günlerin ModPOS raporunu yükleyin; AsilPOS gün sonları her gece gelir",
      manual: true,
    };
  }
  return {
    kind: "modpos-rapor",
    label: "ModPOS raporu",
    line: "Satışlar: ModPOS raporu (ay sonunda elle yüklenir)",
    missing: "Satışlar'a ürün satış raporunu yükleyin",
    manual: true,
  };
}

/**
 * Birden çok ayın satış kaynağı (Gelir-gider'in yıl tablosu): ayların hepsi aynı türdense sonuncusu, karışıksa (geçiş
 * ayı ya da iki kasalı yıl) sonuncusu "Satışlar: ModPOS / AsilPOS" satırıyla (`periodKasa`, tablonun etiketleriyle aynı)
 */
export function periodSalesSource(
  months: readonly string[],
  switchDay: string | null,
  asilposSales: { months: readonly AsilposSalesMonth[] } | undefined,
  connectedMonths?: ReadonlySet<string>,
): SalesSource {
  const sources = months.map((m) => salesSourceOf(m, switchDay, asilposSales, connectedMonths));
  const last = sources.at(-1);
  if (!last) throw new Error("periodSalesSource: ay yok");
  if (sources.every((s) => s.kind === last.kind)) return last;
  return { ...last, line: `Satışlar: ${periodKasa(months, switchDay).both}` };
}
