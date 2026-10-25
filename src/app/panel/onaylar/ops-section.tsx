import { requireAdmin } from "@/server/auth/dal";
import { loadModelOnce } from "@/server/data/model-once";
import { loadDraftQueue } from "@/server/data/order-drafts";
import { loadWasteRequestQueue } from "@/server/data/waste-requests";

import { DraftQueueCards } from "./draft-cards";
import { WasteRequestCards } from "./ops-cards";

/**
 * Onaylar › Mal siparişi, Zayi ve ikram (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §2.4, §2.8): mal
 * siparişi taslakları ve geç zayi / ikram, zayi silme kartları, `#istek-<id>`. Maliyet modeli isteğin bir kez yüklediği
 * modelden (loadModelOnce). Bekleyen istek yoksa bölüm çizilmez; bir kaynak düşerse öteki çizilir.
 */
export async function OpsRequests() {
  await requireAdmin();
  const now = new Date();
  const model = await loadModelOnce();
  const [drafts, waste] = await Promise.all([
    loadDraftQueue(model, now).catch((e: unknown) => {
      console.error("[onaylar] mal siparişi taslakları", e);
      return [];
    }),
    loadWasteRequestQueue(model, now),
  ]);
  if (!drafts.length && !waste.length) return null;
  return (
    <>
      {drafts.length ? <DraftQueueCards cards={drafts} /> : null}
      {waste.length ? <WasteRequestCards cards={waste} /> : null}
    </>
  );
}
