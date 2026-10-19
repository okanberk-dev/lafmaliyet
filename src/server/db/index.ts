import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

// Geliştirmede hot-reload sırasında bağlantı havuzunun çoğalmasını önlemek için global'de tutulur.
const globalForDb = globalThis as unknown as { __lafDb?: DB };

export function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL tanımlı değil. Yerelde .env.local dosyasına, Vercel'de proje ortam değişkenlerine ekleyin.",
    );
  }
  return url;
}

export function createDb(url = connectionString(), max = Number(process.env.DB_POOL_MAX ?? 5)): DB {
  const local = /localhost|127\.0\.0\.1|\/tmp|host=\//.test(url);
  const client = postgres(url, {
    // Neon/PgBouncer havuzlu bağlantılarda hazırlanmış sorgular desteklenmez
    prepare: false,
    max,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local || url.includes("sslmode=disable") ? false : "require",
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

/** Sunucu tarafında paylaşılan veritabanı bağlantısı (ilk kullanımda açılır). */
export function getDb(): DB {
  if (!globalForDb.__lafDb) globalForDb.__lafDb = createDb();
  return globalForDb.__lafDb;
}

export { schema };
