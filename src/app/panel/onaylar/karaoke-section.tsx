import { requireAdmin } from "@/server/auth/dal";
import { loadKaraokeRequestQueue } from "@/server/data/karaoke-requests";

import { KaraokeRequestCards } from "./karaoke-cards";

/**
 * Onaylar › Karaoke (denetim E-15; docs/KARAOKE.md › Sayacı silmek): personelin, açılışından 10 dakika sonra silinmesini
 * istediği panel sayaçları, `#istek-<id>`, en eski önce; sayacın bugünkü hâliyle. Bekleyen istek yoksa bölüm çizilmez.
 */
export async function KaraokeRequests() {
  await requireAdmin();
  const cards = await loadKaraokeRequestQueue();
  if (!cards.length) return null;
  return <KaraokeRequestCards cards={cards} />;
}
