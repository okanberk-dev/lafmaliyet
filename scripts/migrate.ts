// Veritabanı şemasını günceller (drizzle/ klasöründeki SQL migration'ları uygular) ve hepsinin gerçekten
// uygulandığını doğrular (scripts/migration-check.ts): atlanan varsa hata verir, canlı derleme durur.
// Kullanım: npm run db:migrate

import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb, type DB } from "../src/server/db";

import { migrationReport, readJournal } from "./migration-check";

export async function runMigrations() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const db = createDb(url, 1);
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    await verifyMigrations(db);
  } finally {
    await db.$client.end();
  }
}

/** Günlükteki her migration'ın veritabanında kaydı var mı: eksik varsa hata, günlükte olmayan kayıt uyarı */
export async function verifyMigrations(db: DB) {
  const rows = await db.execute<{ created_at: string | number }>(sql`select created_at from drizzle.__drizzle_migrations`);
  const report = migrationReport(readJournal(), rows.map((r) => Number(r.created_at)));
  if (report.warning) console.warn(report.warning);
  if (report.error) throw new Error(report.error);
  console.log(report.ok);
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  loadEnvConfig(process.cwd());
  runMigrations().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
