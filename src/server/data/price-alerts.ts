import "server-only";

import { asc, eq } from "drizzle-orm";

import type { Model } from "@/lib/calc/engine";
import {
  ingredientChanges,
  isAcknowledged,
  PRICE_ALERT_DAYS,
  productImpacts,
  type IngredientChange,
  type PriceAck,
  type ProductImpact,
} from "@/lib/calc/price-impact";
import { getDb, schema as s } from "@/server/db";

/** "Şimdilik böyle kalsın" denen ürünler (ürün kimliği → o anki maliyet) */
export const PRICE_ACK_KEY = "prices.ack";

export interface PriceAlerts {
  since: string;
  changes: IngredientChange[];
  /** Maliyeti artan bütün ürünler; `acknowledged`: böyle kalsın denmiş */
  impacts: (ProductImpact & { acknowledged: boolean })[];
  /** Fiyatı önerilenin altında kalan, böyle kalsın denmemiş ürünler (uyarı bunlar için) */
  actionable: ProductImpact[];
}

/** Zam penceresinin başlangıcı (ISO): bugünden `days` gün önce */
export function priceWindowStart(days = PRICE_ALERT_DAYS): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Son `days` gündeki hammadde zamları ve kârı düşen ürünler (genel bakış, zil, sabah e-postası, Ürünler) */
export async function loadPriceAlerts(model: Model, days = PRICE_ALERT_DAYS): Promise<PriceAlerts> {
  const db = getDb();
  const since = priceWindowStart(days);
  const [history, [ackRow]] = await Promise.all([
    db.select().from(s.ingredientPrices).orderBy(asc(s.ingredientPrices.changedAt), asc(s.ingredientPrices.id)),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, PRICE_ACK_KEY)).limit(1),
  ]);
  const changes = ingredientChanges(
    model.ds.ingredients,
    history.map((h) => ({ ...h, changedAt: h.changedAt.toISOString() })),
    since,
  );
  const ack = (ackRow?.value ?? null) as PriceAck | null;
  const impacts = productImpacts(model, changes).map((i) => ({ ...i, acknowledged: isAcknowledged(i, ack) }));
  return { since, changes, impacts, actionable: impacts.filter((i) => i.needsPrice && !i.acknowledged) };
}
