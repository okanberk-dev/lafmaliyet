import "server-only";

import type { PurchaseLot } from "@/lib/calc/fifo";
import type { HeldPurchase } from "@/lib/calc/types";
import { getDb } from "@/server/db";

import { queryHeldPurchases, queryPurchaseLots } from "./purchase-lots-query";

/** Stok değerlemenin (FIFO) partileri; süzgeç ve kurallar purchase-lots-query.ts (testi veritabanında koşar) */
export function loadPurchaseLots(): Promise<PurchaseLot[]> {
  return queryPurchaseLots(getDb());
}

/** Çarpanı onay bekleyen alışlar, ay ve hammadde başına (Tutarlılık; aynı yüklem purchase-lots-query.ts) */
export function loadHeldPurchases(): Promise<HeldPurchase[]> {
  return queryHeldPurchases(getDb());
}
