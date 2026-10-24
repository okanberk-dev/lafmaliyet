/**
 * Mal siparişinin günlük kullanımı (docs/MAL-SIPARISI.md › Formüller). Bugünkü tek kaynak aylık veridir: referans satış
 * ayının ModPOS satışı ve laffogato.net online kafe siparişleri reçeteye göre (Tutarlılık'taki "beklenen tüketim"),
 * artı o ayın kayıtlı zayi ve ikramı. "Ayda" her yerde aynı anlamda (salesBasis, insight): ModPOS adetleri listenin
 * açık gününe, online ve kayıtlı zayi / ikram ayın açık gününe göre Ayarlar › ayda açık güne ölçeklenir, sonra
 * 30 güne bölünür. Genel fire payı eklenmez: emniyet payı kayda geçmeyen kaybı karşılar.
 *
 * ModPOS'un günlük ürün dökümü gelince (R18 ağzı, src/server/data/daily-sales.ts) sunucu günlük kullanımı oradan
 * hesaplar; bugün o ağız boş döner ve her okuyan buraya düşer. Saf modül; tests/mal-siparisi.test.ts.
 */

import type { Model } from "../calc/engine";
import { basisText, salesBasis } from "../calc/price-loss";
import { monthLabel } from "../format";

/** "Ayda" kullanım 30 takvim gününe bölünür (günlük kullanım takvim günü başına) */
export const DAYS_PER_MONTH = 30;

export interface UsageBasis {
  kind: "ay";
  /** Referans satış ayı (YYYY-MM) */
  month: string;
  /** "Eylül 2026 satışları" */
  label: string;
  openDays: number | null;
  /** Ayarlar › ayda açık gün */
  standardDays: number;
  /** ModPOS ve online adetlerinin ölçeği (salesBasis) */
  scale: number;
  onlineScale: number;
  /** Satış dayanağının cümlesi (basisText: açık gün, kasa raporlarından gelişi) */
  text: string;
}

/** Bir hammaddenin aylık kullanımı (ölçekli, malzemenin kendi biriminde) ve günlüğü */
export interface IngredientUsage {
  /** Günde (takvim günü) */
  perDay: number;
  /** Ayda: ModPOS satışı, online kafe siparişleri, kayıtlı zayi + ikram */
  sales: number;
  online: number;
  waste: number;
}

export interface UsageEstimate {
  basis: UsageBasis;
  byIngredient: Map<number, IngredientUsage>;
}

/**
 * Ayın kullanımı: ModPOS satışı (`ingredientUsage` × ModPOS ölçeği) + online (`onlineUsage` × online ölçeği) + kayıtlı
 * zayi ve ikram (× online ölçeği: kayıtlar ayın bugüne kadarını kapsar, online satış gibi). İkisinin toplamı salesBasis'in
 * ürün başına aylık adediyle reçeteden hesaplanan kullanımla aynıdır (test sabitler). Satışsız ayda (ya da ay yoksa) null.
 */
export function monthlyUsage(model: Model, month: string | null): UsageEstimate | null {
  if (!month) return null;
  const sb = salesBasis(model, month);
  if (!sb) return null;
  const { scale, onlineScale } = sb.basis;
  const sales = model.ingredientUsage(month);
  const online = model.onlineUsage(month);
  const recorded = model.recordedUsage(month);
  const byIngredient = new Map<number, IngredientUsage>();
  for (const id of new Set([...sales.keys(), ...online.keys(), ...recorded.keys()])) {
    const s = (sales.get(id) ?? 0) * scale;
    const o = (online.get(id) ?? 0) * onlineScale;
    const r = recorded.get(id);
    const w = r ? (r.zayi + r.ikram) * onlineScale : 0;
    byIngredient.set(id, { sales: s, online: o, waste: w, perDay: (s + o + w) / DAYS_PER_MONTH });
  }
  return {
    basis: {
      kind: "ay",
      month,
      label: `${monthLabel(month)} satışları`,
      openDays: sb.basis.openDays,
      standardDays: sb.basis.standardDays,
      scale,
      onlineScale,
      text: basisText(sb.basis),
    },
    byIngredient,
  };
}
