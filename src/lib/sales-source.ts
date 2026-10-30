import type { LafposSalesMonth } from "@/lib/calc/types";
import { salesMonthKasa } from "@/lib/lafpos/kasa";

/*
 * Ayın ürün satışlarının kaynağı, tek yerden (docs/planlar/ux-sade.md §10, K20): ekranların hiçbiri "satış = ay sonunda
 * elle yüklenen ModPOS raporu" varsaymaz; "yükleyin" diyen her metin `missing`'i, Satışlar'ın yükleme kartı ve Genel
 * bakış'ın "Satış raporu" işi `manual`'ı okur. Bugün `salesMonthKasa` üstüne kurulur (ModPOS raporu, LafPOS, geçiş ayı).
 *
 * ModPOS bağlantısı (API) geldiğinde (docs/planlar/KALAN-ISLER.md "ModPOS bağlantısı"): bağlantının yazdığı aylar
 * `connectedMonths` olarak verilir, o aylar "ModPOS bağlantısı" olur ve bütün ekranlar kendiliğinden ona döner. Aynı ay
 * için elle yüklenmiş rapor varsa hangisinin sayılacağı bağlantı PR'ının kararıdır; bu modül yalnız etiketi ayırır.
 * Bugün hiçbir çağıran `connectedMonths` vermez. Saf; yalnız yönetici ekranları içe aktarır (personel dosyaları değil).
 */

export type SalesSourceKind = "modpos-rapor" | "lafpos" | "gecis" | "modpos-baglanti";

export interface SalesSource {
  kind: SalesSourceKind;
  /** Kısa ad: "ModPOS raporu" · "LafPOS" · "ModPOS raporu + LafPOS" · "ModPOS bağlantısı" */
  label: string;
  /** Başlığın altındaki tek satır (PageHeader `meta`): "Satışlar: ModPOS raporu (ay sonunda elle yüklenir)" … */
  line: string;
  /** Satış verisi yokken ne yapılır (cümle, sonda nokta yok): "Satışlar'a ürün satış raporunu yükleyin" … */
  missing: string;
  /** Elle yükleme bu ayın kaynağı mı (Satışlar'ın yükleme kartı, Genel bakış'ın "Satış raporu" işi, düğme etiketleri) */
  manual: boolean;
}

/**
 * Ayın satış kaynağı. Öncelik: ModPOS bağlantısı > LafPOS / geçiş > ModPOS raporu. `connectedMonths`: ileride ModPOS
 * bağlantısının getirdiği aylar (açılıştan bu yana bütün aylar ondan okunur)
 */
export function salesSourceOf(
  month: string,
  switchDay: string | null,
  lafposSales: { months: readonly LafposSalesMonth[] } | undefined,
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
  const kasa = salesMonthKasa(month, switchDay, lafposSales);
  if (kasa.source === "lafpos") {
    return { kind: "lafpos", label: "LafPOS", line: "Satışlar: LafPOS (her gece kendiliğinden)", missing: "LafPOS gün sonları her gece gelir", manual: false };
  }
  if (kasa.source === "gecis") {
    // Geçiş ayı: geçiş gününden önceki günlerin ModPOS raporu elle yüklenir, sonrası LafPOS'tan gelir
    return {
      kind: "gecis",
      label: "ModPOS raporu + LafPOS",
      line: `Satışlar: ${kasa.long}`,
      missing: "Satışlar'a geçiş gününden önceki günlerin ModPOS raporunu yükleyin; LafPOS gün sonları her gece gelir",
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
