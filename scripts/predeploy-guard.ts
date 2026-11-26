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

/**
 * Derleme boş bir veritabanına başlangıç verisini (tests/fixtures/baslangic/veri.json: maaşlar, kira, faturalar,
 * satışlar) kendiliğinden yükleyecek mi: yüklemeyecekse nedeni, yükleyecekse null. Migration'lar, ilk yönetici, şube
 * kütüğü ve hazır kontrol listeleri bundan bağımsız, her zaman (scripts/seed.ts › runSeed `emptySkip`).
 * - `SEED_ON_EMPTY=1`: yüklenir (canlıda da; bilerek, tek derleme için: `vercel deploy --prod --build-env SEED_ON_EMPTY=1`).
 * - `SEED_ON_EMPTY=0`: hiçbir yerde yüklenmez (yerelde boş panelin denemesi).
 * - Canlı (`VERCEL_ENV=production` ya da `NODE_ENV=production`) ve Vercel önizlemesi: yüklenmez. Yanlış ya da yeni
 *   açılmış boş bir veritabanının adresi verilirse kişisel veri oraya yazılmasın; canlının boş veritabanı yedekten
 *   (`npm run db:restore`) ya da panelden dolar.
 * - Bu bilgisayarda olmayan veritabanı (Neon, uzak sunucu; `.env.local` canlının adresini gösterebilir): yüklenmez.
 * - Geri kalan (yerel geliştirme, bu bilgisayardaki Postgres): yüklenir, bugünkü gibi.
 * `npm run db:seed` ve `npm run test:db` bu karara bağlı değildir: açıkça çağrılınca yükler.
 */
export function emptySeedSkipReason(env: Record<string, string | undefined>, target: { host: string; local: boolean }): string | null {
  const flag = env.SEED_ON_EMPTY?.trim();
  if (flag === "1") return null;
  if (flag === "0") return "SEED_ON_EMPTY=0";
  if (env.VERCEL_ENV === "production") return "canlı derleme (VERCEL_ENV=production)";
  if (env.NODE_ENV === "production") return "canlı ortam (NODE_ENV=production)";
  if (env.VERCEL_ENV === "preview") return "önizleme derlemesi (VERCEL_ENV=preview)";
  if (!target.local) return `veritabanı bu bilgisayarda değil (${target.host})`;
  return null;
}

/** Boş veritabanında başlangıç verisi yüklenmediğinde günlüğe yazılan uyarı (docs/DEPLOY.md § 5 aynı metni gösterir) */
export function emptySeedWarning(reason: string): string {
  return (
    `Veritabanı boş; başlangıç verisi yüklenmedi: ${reason}. Panel boş açılır: veri yedekten (npm run db:restore) gelir ` +
    "ya da panelden girilir. Bilerek yüklemek için bu derlemeye SEED_ON_EMPTY=1 verin ya da npm run db:seed çalıştırın"
  );
}

/** Bilerek açılmış yükleme (SEED_ON_EMPTY=1, canlıda ya da uzak veritabanında): derleme sürer, günlüğe uyarı yazılır */
export function emptySeedOverride(env: Record<string, string | undefined>, target: { host: string; local: boolean }): string | null {
  if (env.SEED_ON_EMPTY?.trim() !== "1") return null;
  if (emptySeedSkipReason({ ...env, SEED_ON_EMPTY: undefined }, target) === null) return null;
  return "SEED_ON_EMPTY=1: veritabanı boşsa başlangıç verisi (maaşlar, kira, faturalar, satışlar) yüklenir. Değişkeni bu derlemeden sonra kaldırın";
}
