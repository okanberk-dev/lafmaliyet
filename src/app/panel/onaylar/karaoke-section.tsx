import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { featureHere } from "@/server/branches";
import { loadKaraokeRequestQueue } from "@/server/data/karaoke-requests";

import { KaraokeRequestCards } from "./karaoke-cards";

/**
 * Onaylar › Karaoke (denetim E-15; docs/KARAOKE.md › Sayacı silmek): personelin, açılışından 10 dakika sonra silinmesini
 * istediği panel sayaçları, `#istek-<id>`, en eski önce; sayacın bugünkü hâliyle. Bekleyen istek yoksa bölüm çizilmez.
 * Karaoke yalnız kendi şubesinde: başka şube seçiliyken ya da karaoke hiçbir şubede açık değilken bölüm yok (şube kapsamı
 * C P1-1, şube özelliği B6).
 */
export async function KaraokeRequests() {
  await requireAdmin();
  if (!(await featureHere("karaoke", await currentBranchScope()))) return null;
  const cards = await loadKaraokeRequestQueue();
  if (!cards.length) return null;
  return <KaraokeRequestCards cards={cards} />;
}
