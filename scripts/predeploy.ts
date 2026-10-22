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

import { loadEnvConfig } from "@next/env";

import { createDb } from "../src/server/db";
import { restartWatchOnDeploy } from "../src/server/jobs/watch";

import { runMigrations } from "./migrate";
import { predeploySkipReason } from "./predeploy-guard";
import { runSeed } from "./seed";

/**
 * Günlük işlerin izlenmesi canlıya ilk çıkışta başlar (src/server/jobs/watch.ts): işler bu andan sonra hiç çalışmazsa
 * (CRON_SECRET doğru ama Vercel Cron tetiklemiyor) panel ertesi sabah "çalışmadı" der. İşler bir günden uzun süredir
 * kayıt yazmıyorsa (önceki derleme bozuldu ya da eski sürüme dönüldü, kayıt yazmayan kod çalıştı) izleme bu yayından
 * yeniden başlar. Yazılamazsa derleme durmaz.
 */
async function markJobsWatched() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
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

async function main() {
  loadEnvConfig(process.cwd());
  const skip = predeploySkipReason(process.env);
  if (skip) {
    console.log(`! ${skip}: migration ve seed atlandı`);
    return;
  }
  await runMigrations();
  await runSeed();
  if (process.env.VERCEL_ENV === "production") await markJobsWatched();
}

main().catch((e) => {
  console.error("Veritabanı hazırlığı başarısız:", e);
  process.exit(1);
});
