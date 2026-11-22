// Veritabanı şemasını günceller (drizzle/ klasöründeki SQL migration'ları uygular) ve hepsinin gerçekten
// uygulandığını doğrular (scripts/migration-check.ts): atlanan varsa hata verir, canlı derleme durur.
// Kullanım: npm run db:migrate  (başka bir veritabanına: DATABASE_URL=postgres://… npm run db:migrate)
//
// Hedef db:backup ve db:restore'daki gibi bulunur (src/lib/backup/format.ts › databaseUrl): kabukta verilen adres
// .env.local'dakinden önce gelir (yoksa .env.local'daki canlının havuzsuz adresi öne geçer, dalın migration'ı canlıya
// giderdi; denetim AL-02), boş değer verilmemiş sayılır (AL-03). Hedef "sunucu/veritabanı" olarak yazılır.

import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { databaseTarget, databaseUrl } from "../src/lib/backup/format";
import { createDb, type DB } from "../src/server/db";

import { migrationReport, readJournal } from "./migration-check";

/** `url`: hedef; verilmezse ortamdan (komut satırı ve derleme kabuktakini öne alarak verir) */
export async function runMigrations(url = databaseUrl(process.env)) {
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const target = databaseTarget(url);
  console.log(`Hedef: ${target.label}${target.local ? " (bu bilgisayar)" : ""}`);
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
  // Komut satırında verilen hedef .env.local'dakinden önce gelir
  const shell = { ...process.env };
  loadEnvConfig(process.cwd());
  runMigrations(databaseUrl(shell, process.env)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
