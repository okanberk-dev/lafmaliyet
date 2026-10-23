import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { withConnectionRetry } from "./retry";
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

/** Bu bilgisayardaki veritabanı (TLS yok) */
const isLocal = (url: string) => /localhost|127\.0\.0\.1|\/tmp|host=\//.test(url);

/**
 * Bağlantının TLS ayarı. Yerelde ve `sslmode=disable` adreslerde yok. Öteki her adreste (Neon) sunucunun sertifikası
 * ve adı doğrulanır ("verify-full"): Neon'un sertifikası Let's Encrypt'ten (ISRG Root X1), Node'un kök sertifikaları
 * bunu tanır. Önceden "require" idi: şifreli ama sertifikası denetlenmeyen bağlantı, araya giren biri kendi
 * sertifikasıyla bütün veriyi okuyabilirdi. Canlı derleme migration'ı (doğrudan adres) ve havuzlu adresi bu ayarla
 * açar (scripts/predeploy.ts): doğrulama tutmazsa derleme durur, yayındaki sürüm değişmez. Acil geri dönüş:
 * `DATABASE_SSL=require` (doğrulamasız; docs/DEPLOY.md § 4).
 */
export function sslOption(url: string, env: Record<string, string | undefined> = process.env): false | "require" | "verify-full" {
  if (isLocal(url) || url.includes("sslmode=disable")) return false;
  return env.DATABASE_SSL?.trim() === "require" ? "require" : "verify-full";
}

export function createDb(url = connectionString(), max = Number(process.env.DB_POOL_MAX ?? 5)): DB {
  const client = postgres(url, {
    // Neon/PgBouncer havuzlu bağlantılarda hazırlanmış sorgular desteklenmez
    prepare: false,
    max,
    // Boşta kalan bağlantı 5 sn'de kapanır, hiçbir bağlantı 5 dakikadan uzun yaşamaz: işlev askıdayken Neon'un havuzu
    // soketi kapatmış olabilir. Askıdaki işlevde zamanlayıcı da çalışmadığı için asıl koruma yeniden denemedir
    // (retry.ts); bağlantı en çok 10 sn bekler, ikinci deneme de işlevin süresine sığsın
    idle_timeout: 5,
    max_lifetime: 5 * 60,
    connect_timeout: 10,
    ssl: sslOption(url),
    onnotice: () => {},
  });
  // Drizzle'ın sorguları uyuyan bağlantıda bir kez yeniden denenir; komut satırının doğrudan kullandığı istemci
  // ($client: yedek, geri yükleme, kapatma) sarılmaz
  const db = drizzle(
    withConnectionRetry(client, {
      onRetry: (code, query) => console.warn(`[db] bağlantı yenilendi (${code}), sorgu yeniden gönderildi: ${query.slice(0, 80)}`),
    }),
    { schema },
  ) as unknown as DB;
  return Object.assign(db, { $client: client });
}

/** Sunucu tarafında paylaşılan veritabanı bağlantısı (ilk kullanımda açılır). */
export function getDb(): DB {
  if (!globalForDb.__lafDb) globalForDb.__lafDb = createDb();
  return globalForDb.__lafDb;
}

export { schema };
