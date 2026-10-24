import { requireAdmin } from "@/server/auth/dal";

/**
 * Onaylar › Mal siparişi, Zayi ve ikram (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §2.4, §2.8): mal
 * siparişi taslağı ve geç zayi / ikram, zayi silme kartları, `#istek-<id>`. Operasyon grubunun maddeleriyle dolar;
 * şimdilik bölüm boş.
 */
export async function OpsRequests() {
  await requireAdmin();
  return null;
}
