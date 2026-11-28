import "server-only";

import { lt } from "drizzle-orm";

import { schema as s, type DB } from "@/server/db";

// Mutabakat bölümü 28 Kasım 2026'da kaldırıldı (sahibin isteği; docs/arsiv/MUTABAKAT.md): ekran, eylemler ve okuma
// yolu silindi, tablolar (`recon_statements`, `recon_lines`) ve ayar (`settings.mutabakatPosBlokeGunu`) yerinde. Kalan
// tek parça KVKK saklama süresi: yüklenmiş ekstreler yüklendikleri gün + 90'da günlük işte eskisi gibi silinir
// (src/app/api/cron/gunluk/route.ts). Bölüm geri gelirse yazma yolu git geçmişinden döner.

/**
 * Saklama süresi dolan ekstreleri siler (günlük iş; satırlar CASCADE ile). `today` saklamanın son gününden sonraysa.
 * Silinen ekstre sayısı döner.
 */
export async function purgeExpiredStatements(db: DB, today: string): Promise<number> {
  const rows = await db.delete(s.reconStatements).where(lt(s.reconStatements.expiresOn, today)).returning({ id: s.reconStatements.id });
  return rows.length;
}
