import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { loadBranchModelOnce } from "@/server/data/model-once";
import { loadWasteRequestQueue } from "@/server/data/waste-requests";

import { WasteRequestCards } from "./ops-cards";

/**
 * Onaylar › Zayi ve ikram (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §2.8): geç zayi / ikram ve zayi silme
 * kartları, `#istek-<id>`. Kartın bağlamı isteğin şubesinden: maliyet modeli şube başına istekte bir kez
 * (loadBranchModelOnce; yöneticinin seçimi değil, denetim 21 Kasım #28). Bekleyen istek yoksa bölüm çizilmez. Mal
 * siparişi taslakları (§2.4) 26 Eki 2026'da mal siparişiyle birlikte kaldırıldı. Tek şube seçiliyken yalnız o şubenin
 * istekleri (şube kapsamı C P1-1).
 */
export async function OpsRequests() {
  await requireAdmin();
  const now = new Date();
  const waste = await loadWasteRequestQueue(loadBranchModelOnce, now, await currentBranchScope());
  if (!waste.length) return null;
  return <WasteRequestCards cards={waste} />;
}
