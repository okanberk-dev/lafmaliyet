import "server-only";

import { posCostItems, type PosCostItem } from "@/lib/lafpos/costs";
import { LAFPOS_VERSION } from "@/lib/lafpos/day";
import { checkLafposRequest } from "@/lib/lafpos/request";
import { loadModel } from "@/server/data/dataset";

import type { EndpointResult } from "./ingest";

/**
 * `GET /api/panel/pos/urunler`'in çekirdeği (docs/LAFPOS.md › Ürün maliyetleri): yalnız LafPOS'un imzasıyla (makine
 * ucu; oturumla açılmaz, personel ekranlarında yok). Maliyet panelin modelinden (ürün kartındaki "Maliyet").
 */

/** Siteye bağlı ürünlerin maliyetleri (src/lib/lafpos/costs.ts beyaz listesi) */
export async function loadPosCostItems(): Promise<PosCostItem[]> {
  return posCostItems((await loadModel()).products);
}

/** İmza denetimi, sonra liste: 200 `{ version: 1, now, items }` (`now` liste kurulduktan sonra), 401, 503 */
export async function servePosProducts(
  input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: Date },
  load: () => Promise<PosCostItem[]> = loadPosCostItems,
): Promise<EndpointResult> {
  const check = checkLafposRequest({ ...input, method: "GET", body: "", maxBytes: 0, now: (input.now ?? new Date()).getTime() });
  if (!check.ok) return { status: check.status, body: { error: check.error } };
  const items = await load();
  return { status: 200, body: { version: LAFPOS_VERSION, now: (input.now ?? new Date()).toISOString(), items } };
}
