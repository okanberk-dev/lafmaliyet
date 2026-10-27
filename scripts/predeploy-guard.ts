// Derleme öncesi veritabanı hazırlığının (scripts/predeploy.ts) bekçileri (saf; testler de kullanır).

/** Canlının dalı: Production derlemesi yalnız bundan yapılır */
export const PRODUCTION_BRANCH = "main";

/**
 * Production derlemesi main dışındaki bir daldansa ret metni, değilse null. Vercel'de bir dal önizlemesi "Redeploy →
 * Production" ya da "Promote to Production" ile yeniden derlenince `VERCEL_ENV=production` olur: bekçi yalnız ortama
 * baksaydı dalın incelenmemiş migration'ı canlı veritabanına uygulanır, dalın kodu bütün canlı sırlarıyla (AUTH_SECRET,
 * PARASUT_*, RESEND_API_KEY, CRON_SECRET) ladmin.laffogato.net'te çalışırdı. 21 ve 26 Eki 2026'da iki kez oldu; ikincisinde
 * PR'ın migration'ı sonra yeniden üretildi, sonraki main derlemesi `relation already exists` ile düştü (denetim E-10).
 * - Dal bilinmiyorsa (`VERCEL_GIT_COMMIT_REF` yok: yerel derleme, Git'siz CLI dağıtımı) karışılmaz.
 * - Bilerek yapılan acil durum dağıtımı `ALLOW_BRANCH_PRODUCTION=1` ile açılır (docs/DEPLOY.md § 7).
 */
export function productionBranchRefusal(env: Record<string, string | undefined>): string | null {
  if (env.VERCEL_ENV !== "production") return null;
  const ref = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!ref || ref === PRODUCTION_BRANCH) return null;
  if (env.ALLOW_BRANCH_PRODUCTION === "1") return null;
  return (
    `Production derlemesi yalnız ${PRODUCTION_BRANCH} dalından yapılır; bu derlemenin dalı: ${ref}. ` +
    `Dalı PR ile ${PRODUCTION_BRANCH}'e birleştirin; bilerek yapılıyorsa ALLOW_BRANCH_PRODUCTION=1 (docs/DEPLOY.md § 7). ` +
    "Derleme durdu: canlı sürüm ve veritabanı değişmedi"
  );
}

/** Bilerek açılmış dal derlemesi (ALLOW_BRANCH_PRODUCTION=1): derleme sürer, günlüğe bir uyarı yazılır */
export function productionBranchOverride(env: Record<string, string | undefined>): string | null {
  if (env.VERCEL_ENV !== "production" || env.ALLOW_BRANCH_PRODUCTION !== "1") return null;
  const ref = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!ref || ref === PRODUCTION_BRANCH) return null;
  return `Production derlemesi ${ref} dalından (ALLOW_BRANCH_PRODUCTION=1 ile bilerek): migration'ı canlıya uygulanır`;
}

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
