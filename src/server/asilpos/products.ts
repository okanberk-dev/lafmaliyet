import "server-only";

import { posCostItems, type PosCostItem } from "@/lib/asilpos/costs";
import { ASILPOS_VERSION } from "@/lib/asilpos/day";
import { checkAsilposRequest } from "@/lib/asilpos/request";
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

/** İmza denetimi, sonra liste: 200 `{ version: 1, now, items }` (`now` liste kurulduktan sonra), 401, 503 */
export async function servePosProducts(
  input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date },
  load: () => Promise<PosCostItem[]> = loadPosCostItems,
): Promise<EndpointResult> {
  const check = checkAsilposRequest({ ...input, method: "GET", body: "", maxBytes: 0, now: (input.now ?? new Date()).getTime() });
  if (!check.ok) return { status: check.status, body: { error: check.error } };
  const items = await load();
  return { status: 200, body: { version: ASILPOS_VERSION, now: (input.now ?? new Date()).toISOString(), items } };
}
