import { requireAdmin } from "@/server/auth/dal";
import { loadModelOnce } from "@/server/data/model-once";
import { loadWasteRequestQueue } from "@/server/data/waste-requests";

import { WasteRequestCards } from "./ops-cards";

/**
 * Onaylar › Mal siparişi, Zayi ve ikram (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §2.4, §2.8): mal
 * siparişi taslağı (§2.4 ile gelir) ve geç zayi / ikram, zayi silme kartları, `#istek-<id>`. Maliyet modeli isteğin
 * bir kez yüklediği modelden (loadModelOnce). Bekleyen istek yoksa bölüm çizilmez.
 */
export async function OpsRequests() {
  await requireAdmin();
  const now = new Date();
  const waste = await loadWasteRequestQueue(await loadModelOnce(), now);
  if (!waste.length) return null;
  return <WasteRequestCards cards={waste} />;
}
