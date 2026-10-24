import { requireAdmin } from "@/server/auth/dal";
import { cashOutCategories } from "@/server/data/cash-outs";
import { cashCounters } from "@/server/data/cash-reports";
import { loadCashRequestQueue } from "@/server/data/cash-requests";

import { KasaRequestCards } from "./kasa-cards";

/**
 * Onaylar › Kasa (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §2.3, §2.6, §2.7, §2.9): kasa düzeltmesi ve
 * silmesi, geç kasa raporu, kasadan çıkan, fotoğraf kaldırma ve kapalı gün kartları, `#istek-<id>`, en eski gün önce.
 * Bekleyen kasa isteği yoksa bölüm çizilmez.
 */
export async function KasaRequests() {
  await requireAdmin();
  const [cards, counters, categories] = await Promise.all([loadCashRequestQueue(), cashCounters(), cashOutCategories("admin")]);
  if (!cards.length) return null;
  return <KasaRequestCards cards={cards} counters={counters} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />;
}
