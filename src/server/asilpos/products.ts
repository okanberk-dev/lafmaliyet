import "server-only";

import { posCostItems, type PosCostItem } from "@/lib/asilpos/costs";
import { ASILPOS_VERSION } from "@/lib/asilpos/day";
import { checkAsilposRequest, wrongBranchBody } from "@/lib/asilpos/request";
import { loadModel } from "@/server/data/dataset";

import type { EndpointResult } from "./ingest";

/**
 * `GET /api/panel/pos/urunler`'in çekirdeği (docs/ASILPOS.md › Ürün maliyetleri): yalnız AsilPOS'un imzasıyla (makine
 * ucu; oturumla açılmaz, personel ekranlarında yok). Maliyet panelin modelinden (ürün kartındaki "Maliyet").
 */

/** Siteye bağlı ürünlerin maliyetleri (src/lib/asilpos/costs.ts beyaz listesi) */
export async function loadPosCostItems(): Promise<PosCostItem[]> {
  return posCostItems((await loadModel()).products);
}

/**
 * İmza denetimi, sonra liste: 200 `{ version: 1, now, items }` (`now` liste kurulduktan sonra), 401, 503. Liste şubeye
 * göre değişmez; kasanın isteğe bağlı `?sube`'si anahtarın şubesi (`branchId`) değilse 409 `{ error: "wrong_branch", sube,
 * expected }` (yanlış şubeye ayarlı kasa)
 */
export async function servePosProducts(
  input: { secret: string | null; branchId: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date },
  load: () => Promise<PosCostItem[]> = loadPosCostItems,
): Promise<EndpointResult> {
  const check = checkAsilposRequest({ ...input, method: "GET", body: "", maxBytes: 0, now: (input.now ?? new Date()).getTime() });
  if (!check.ok) return { status: check.status, body: { error: check.error } };
  if (input.branchId === null) return { status: 401, body: { error: "unauthorized" } };
  const wrong = wrongBranchBody(input.url, input.branchId);
  if (wrong) return { status: 409, body: wrong };
  const items = await load();
  return { status: 200, body: { version: ASILPOS_VERSION, now: (input.now ?? new Date()).toISOString(), items } };
}
