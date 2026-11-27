import "server-only";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import type { PurchaseLot } from "@/lib/calc/fifo";
import type { HeldPurchase } from "@/lib/calc/types";
import { getDb } from "@/server/db";

import { type BranchPurchases, queryBranchPurchases, queryHeldPurchases, queryPurchaseLots } from "./purchase-lots-query";

/**
 * Stok değerlemenin (FIFO) partileri; süzgeç ve kurallar purchase-lots-query.ts (testi veritabanında koşar). `scope` bir
 * şubeyse (Stok değeri alanının şube kipi) şubenin ve işletme genelinin faturaları
 */
export function loadPurchaseLots(scope: BranchScope = ALL_BRANCHES): Promise<PurchaseLot[]> {
  return queryPurchaseLots(getDb(), scope);
}

/** Tutarlılık'ın şube kipinde alınan: yalnız şubeye seçilmiş faturalardan (purchase-lots-query.ts queryBranchPurchases) */
export function loadBranchPurchases(branch: string): Promise<BranchPurchases> {
  return queryBranchPurchases(getDb(), branch);
}

/** Çarpanı onay bekleyen alışlar, ay ve hammadde başına (Tutarlılık; aynı yüklem purchase-lots-query.ts) */
export function loadHeldPurchases(): Promise<HeldPurchase[]> {
  return queryHeldPurchases(getDb());
}
