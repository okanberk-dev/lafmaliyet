// Veritabanı şemasını günceller (drizzle/ klasöründeki SQL migration'ları uygular).
// Kullanım: npm run db:migrate

import { loadEnvConfig } from "@next/env";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "../src/server/db";

export async function runMigrations() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const db = createDb(url, 1);
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    console.log("✓ Veritabanı şeması güncel");
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  loadEnvConfig(process.cwd());
  runMigrations().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
