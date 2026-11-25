import "server-only";

import { asc, eq } from "drizzle-orm";

import type { Model } from "@/lib/calc/engine";
import { latestSalesMonth } from "@/lib/calc/insights";
import {
  ingredientChanges,
  isAcknowledged,
  PRICE_ALERT_DAYS,
  productImpacts,
  type IngredientChange,
  type PriceAck,
  type ProductImpact,
} from "@/lib/calc/price-impact";
import { priceLoss, type PriceLoss } from "@/lib/calc/price-loss";
import { importedPriceRow } from "@/lib/import-labels";
import { getDb, schema as s } from "@/server/db";

/** "Şimdilik böyle kalsın" denen ürünler (ürün kimliği → o anki maliyet) */
export const PRICE_ACK_KEY = "prices.ack";

/**
 * Maliyeti artan ürün. `monthly` / `monthlyQty`: zamların bu üründen ayda götürdüğü kâr ve ayda satılan adet (referans
 * satış ayından, standart aya ölçekli; price-loss.ts); satış verisi yoksa null.
 */
export type PriceImpactRow = ProductImpact & { acknowledged: boolean; ackPrice: number | null; monthly: number | null; monthlyQty: number | null };

export interface PriceAlerts {
  since: string;
  changes: IngredientChange[];
  /** Maliyeti artan bütün ürünler; `acknowledged`: böyle kalsın denmiş */
  impacts: PriceImpactRow[];
  /** Fiyatı önerilenin altında kalan, böyle kalsın denmemiş ürünler (uyarı bunlar için) */
  actionable: ProductImpact[];
  /** Zamların ayda TL etkisi (ürün ve hammadde başına, toplam); bütün ekranlar bu hesabı gösterir */
  loss: PriceLoss;
}

/** Zam penceresinin başlangıcı (ISO): bugünden `days` gün önce */
export function priceWindowStart(days = PRICE_ALERT_DAYS): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Son `days` gündeki hammadde zamları, kârı düşen ürünler ve zamların aylık TL etkisi (genel bakış, zil, sabah
 * e-postası, Ürünler, ürün kartı). `month`: "ayda" tutarlarının satış ayı; verilmezse satış listesi olan son ay.
 */
export async function loadPriceAlerts(model: Model, days = PRICE_ALERT_DAYS, month: string | null = latestSalesMonth(model)): Promise<PriceAlerts> {
  const db = getDb();
  const since = priceWindowStart(days);
  const [history, [ackRow]] = await Promise.all([
    db.select().from(s.ingredientPrices).orderBy(asc(s.ingredientPrices.changedAt), asc(s.ingredientPrices.id)),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, PRICE_ACK_KEY)).limit(1),
  ]);
  const changes = ingredientChanges(
    model.ds.ingredients,
    // İlk aktarım satırı "İçe aktarım" adıyla (zam etkisinin yazanı ve notu; veri değişmez)
    history.map((h) => importedPriceRow({ ...h, changedAt: h.changedAt.toISOString() })),
    since,
  );
  const ack = (ackRow?.value ?? null) as PriceAck | null;
  const loss = priceLoss(model, changes, month);
  const lossOf = new Map(loss.products.map((p) => [p.productId, p]));
  // ackPrice: öneri uygulanarak kapandıysa panel "önerilen fiyat uygulandı" yazar ("fiyat korunuyor" değil)
  const impacts = productImpacts(model, changes).map((i) => {
    const l = loss.basis ? lossOf.get(i.productId) : undefined;
    return {
      ...i,
      acknowledged: isAcknowledged(i, ack),
      ackPrice: ack?.[String(i.productId)]?.price ?? null,
      monthly: loss.basis ? (l?.monthly ?? 0) : null,
      monthlyQty: loss.basis ? (l?.monthlyQty ?? 0) : null,
    };
  });
  return { since, changes, impacts, actionable: impacts.filter((i) => i.needsPrice && !i.acknowledged), loss };
}
