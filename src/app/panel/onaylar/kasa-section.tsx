import { requireAdmin } from "@/server/auth/dal";

/**
 * Onaylar › Kasa (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §2.3, §2.6, §2.7, §2.9): kasa düzeltmesi ve
 * silmesi, geç kasa raporu, kasadan çıkan, fotoğraf kaldırma ve kapalı gün kartları, `#istek-<id>`. Kasa grubunun
 * maddeleriyle dolar; şimdilik bölüm boş (bekleyen kasa isteği yok).
 */
export async function KasaRequests() {
  await requireAdmin();
  return null;
}
