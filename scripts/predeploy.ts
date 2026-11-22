// `npm run build` öncesinde çalışır (Vercel dahil):
// veritabanı tanımlıysa şemayı günceller ve veritabanı boşsa Excel verisini yükler.
// DATABASE_URL yoksa sessizce geçer; böylece veritabanı olmadan da derleme yapılabilir.
//
// Önizleme (preview) dağıtımlarında atlanır: önizlemeler canlıyla aynı veritabanını kullanıyor, birleşmemiş bir dalın
// migration'ı canlıya uygulanırdı (21 Eki 2026'da bir önizleme menü bağlantısının migration'ını PR birleşmeden önce
// canlıya uyguladı). Migration artık yalnız canlı dağıtımda, kod yayına çıkarken çalışır. Önizlemelere kendi Neon dalı
// verilirse (Vercel › Storage › Neon › önizleme dalları) önizleme ortamına `MIGRATE_ON_PREVIEW=1` eklenir.
//
// Migration'dan sonra her migration'ın gerçekten uygulandığı doğrulanır (scripts/migrate.ts › verifyMigrations):
// sıra bozulup atlanan varsa derleme durur, canlıda eski sürüm yayında kalır.
//
// Production derlemesi yalnız main dalından (predeploy-guard.ts › productionBranchRefusal): bir dal önizlemesi
// Production'a terfi ya da redeploy edilirse derleme her şeyden önce durur; dalın migration'ı canlıya gitmez, dalın kodu
// canlı sırlarıyla yayına çıkmaz (26 Eki 2026, denetim E-10). Bilerek yapılan dağıtım ALLOW_BRANCH_PRODUCTION=1 ister.

import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";

import { databaseUrl } from "../src/lib/backup/format";
import { createDb } from "../src/server/db";
import { restartWatchOnDeploy } from "../src/server/jobs/watch";

import { runMigrations } from "./migrate";
import { predeploySkipReason, productionBranchOverride, productionBranchRefusal } from "./predeploy-guard";
import { runSeed } from "./seed";

/**
 * Günlük işlerin izlenmesi canlıya ilk çıkışta başlar (src/server/jobs/watch.ts): işler bu andan sonra hiç çalışmazsa
 * (CRON_SECRET doğru ama Vercel Cron tetiklemiyor) panel ertesi sabah "çalışmadı" der. İşler bir günden uzun süredir
 * kayıt yazmıyorsa (önceki derleme bozuldu ya da eski sürüme dönüldü, kayıt yazmayan kod çalıştı) izleme bu yayından
 * yeniden başlar. Yazılamazsa derleme durmaz.
 */
async function markJobsWatched(url: string | undefined) {
  if (!url) return;
  const db = createDb(url, 1);
  try {
    if (await restartWatchOnDeploy(db)) console.log("✓ Günlük işlerin izlenmesi bu yayından başlıyor");
  } catch (e) {
    console.warn("! Günlük işlerin izleme başlangıcı yazılamadı:", (e as Error).message);
  } finally {
    await db.$client.end();
  }
}

/**
 * Çalışma zamanının bağlantısı da açılıyor mu: migration doğrudan adresle (DATABASE_URL_UNPOOLED) yapılır, sayfalar
 * havuzlu adresi (DATABASE_URL) kullanır. İkisi de sunucu sertifikasını doğrular (src/server/db/index.ts › sslOption).
 * Migration'dan önce bakılır: havuzlu adres açılmazsa derleme şemaya dokunmadan durur, yayındaki sürüm de veritabanı
 * da değişmez (yeni sürüm hiç bağlanamadan yayına çıkmasın; geriye uyumsuz bir migration da eski sürümü bozmasın).
 * Boş veritabanında da çalışır ("select 1").
 */
async function checkRuntimeConnection(migrated: string | undefined) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url || url === migrated) return;
  const db = createDb(url, 1);
  try {
    await db.execute(sql`select 1`);
    console.log("✓ Havuzlu veritabanı bağlantısı açılıyor");
  } finally {
    await db.$client.end();
  }
}

async function main() {
  // Hedef db:migrate'teki gibi: kabukta verilen adres .env.local'dakinden önce, boş değer verilmemiş sayılır (denetim
  // AL-02, AL-03; src/lib/backup/format.ts › databaseUrl). Vercel'de .env.local yok, sonuç değişmez
  const shell = { ...process.env };
  loadEnvConfig(process.cwd());
  // Önce dal: reddedilen derleme veritabanına hiç bağlanmaz (ne migration ne seed ne izleme kaydı)
  const refusal = productionBranchRefusal(process.env);
  if (refusal) {
    console.error(`✗ ${refusal}`);
    process.exit(1);
  }
  const override = productionBranchOverride(process.env);
  if (override) console.warn(`! ${override}`);
  const skip = predeploySkipReason(process.env);
  if (skip) {
    console.log(`! ${skip}: migration ve seed atlandı`);
    return;
  }
  const url = databaseUrl(shell, process.env);
  await checkRuntimeConnection(url);
  await runMigrations(url);
  await runSeed({ url });
  if (process.env.VERCEL_ENV === "production") await markJobsWatched(url);
}

main().catch((e) => {
  console.error("Veritabanı hazırlığı başarısız:", e);
  process.exit(1);
});
