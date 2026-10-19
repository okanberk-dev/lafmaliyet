// `npm run build` öncesinde çalışır (Vercel dahil):
// veritabanı tanımlıysa şemayı günceller ve veritabanı boşsa Excel verisini yükler.
// DATABASE_URL yoksa sessizce geçer; böylece veritabanı olmadan da derleme yapılabilir.

import { loadEnvConfig } from "@next/env";

import { runMigrations } from "./migrate";
import { runSeed } from "./seed";

async function main() {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.log("! DATABASE_URL yok: migration ve seed atlandı");
    return;
  }
  await runMigrations();
  await runSeed();
}

main().catch((e) => {
  console.error("Veritabanı hazırlığı başarısız:", e);
  process.exit(1);
});
