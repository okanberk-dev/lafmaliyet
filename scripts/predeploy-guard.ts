// Derleme öncesi veritabanı hazırlığının (scripts/predeploy.ts) atlanıp atlanmayacağı (saf; testler de kullanır).

/**
 * Hazırlık atlanacaksa nedeni, çalışacaksa null:
 * - veritabanı tanımlı değil (yerel derleme, CI);
 * - Vercel önizlemesi: önizlemeler canlının veritabanını kullanır; birleşmemiş dalın migration'ı canlıya uygulanmasın.
 *   Önizlemelerin kendi veritabanı (Neon dalı) varsa `MIGRATE_ON_PREVIEW=1` ile açılır.
 */
export function predeploySkipReason(env: Record<string, string | undefined>): string | null {
  if (!env.DATABASE_URL && !env.POSTGRES_URL) return "DATABASE_URL yok";
  if (env.VERCEL_ENV === "preview" && env.MIGRATE_ON_PREVIEW !== "1") {
    return "Önizleme dağıtımı (veritabanı canlıyla ortak; açmak için MIGRATE_ON_PREVIEW=1)";
  }
  return null;
}
