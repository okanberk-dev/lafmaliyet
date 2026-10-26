import "server-only";

import type { PurchaseLot } from "@/lib/calc/fifo";
import { getDb } from "@/server/db";

import { queryPurchaseLots } from "./purchase-lots-query";

/** Stok değerlemenin (FIFO) partileri; süzgeç ve kurallar purchase-lots-query.ts (testi veritabanında koşar) */
export function loadPurchaseLots(): Promise<PurchaseLot[]> {
  return queryPurchaseLots(getDb());
}
