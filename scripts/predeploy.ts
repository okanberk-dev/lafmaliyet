// `npm run build` öncesinde çalışır (Vercel dahil):
// veritabanı tanımlıysa şemayı günceller ve veritabanı boşsa Excel verisini yükler.
// DATABASE_URL yoksa sessizce geçer; böylece veritabanı olmadan da derleme yapılabilir.
//
// Önizleme (preview) dağıtımlarında atlanır: önizlemeler canlıyla aynı veritabanını kullanıyor, birleşmemiş bir dalın
// migration'ı canlıya uygulanırdı (21 Eki 2026'da bir önizleme menü bağlantısının migration'ını PR birleşmeden önce
// canlıya uyguladı). Migration artık yalnız canlı dağıtımda, kod yayına çıkarken çalışır. Önizlemelere kendi Neon dalı
// verilirse (Vercel › Storage › Neon › önizleme dalları) önizleme ortamına `MIGRATE_ON_PREVIEW=1` eklenir.

import { loadEnvConfig } from "@next/env";

import { runMigrations } from "./migrate";
import { predeploySkipReason } from "./predeploy-guard";
import { runSeed } from "./seed";

async function main() {
  loadEnvConfig(process.cwd());
  const skip = predeploySkipReason(process.env);
  if (skip) {
    console.log(`! ${skip}: migration ve seed atlandı`);
    return;
  }
  await runMigrations();
  await runSeed();
}

main().catch((e) => {
  console.error("Veritabanı hazırlığı başarısız:", e);
  process.exit(1);
});
