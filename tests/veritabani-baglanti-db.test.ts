// Neon'un "Authentication timed out" hatası gerçek postgres.js ve drizzle'la (src/server/db/retry.ts, denetim E-50):
// araya giren sahte bir Neon (yerel TCP vekili) bağlantının açılışına 08P01 "Authentication timed out" ile cevap verir
// (uyuyan bilgisayar kimlik doğrulama süresinde uyanmadı), sonraki bağlantıları gerçek Postgres'e geçirir. Okuma ve yazım
// bir kez yeniden gönderilir ve yazım bir kez yazılır; BEGIN'i açılamayan işlem bir kez daha açılır (gövdesi bir kez
// çalışır); başka mesajlı 08P01 yeniden denenmez; günlük işin çalışma kaydı (startJobRun) Neon uyanırken de yazılır,
// ertesi sabah sahte "çalışmadı" uyarısı çıkmaz.
// Kendi geçici veritabanını açar (migration'larla), sonunda siler.
//
// BAGLANTI_TEST_DATABASE_URL verilmezse atlanır (veritabanı oluşturabilen bir kullanıcıyla herhangi bir veritabanı).
// Çalıştırma: BAGLANTI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/veritabani-baglanti-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import net from "node:net";
import { after, before, describe, test } from "node:test";

import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { createDb, type DB } from "../src/server/db";
import { AUTH_TIMEOUT, connectionErrorCode } from "../src/server/db/retry";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.BAGLANTI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_neon_test_${process.pid}`;

/** Postgres'in ErrorResponse iletisi ('E'): FATAL, kod ve mesaj (Neon'un vekili açılışta böyle cevap verir) */
function errorResponse(code: string, message: string): Buffer {
  const fields = Buffer.concat([
    ...[
      ["S", "FATAL"],
      ["V", "FATAL"],
      ["C", code],
      ["M", message],
    ].map(([k, v]) => Buffer.from(`${k}${v}\0`, "utf8")),
    Buffer.from([0]),
  ]);
  const head = Buffer.alloc(5);
  head.write("E", 0, "ascii");
  head.writeInt32BE(fields.length + 4, 1);
  return Buffer.concat([head, fields]);
}

/**
 * Sahte Neon: `fail(n, mesaj)` sonraki n bağlantının açılış iletisine (StartupMessage) 08P01 ile cevap verip soketi
 * kapatır; öteki bağlantılar gerçek sunucuya olduğu gibi geçer.
 */
async function neonProxy(target: URL) {
  const stats = { connections: 0, refused: 0 };
  let pending: string[] = [];
  const sockets = new Set<net.Socket>();
  const track = (sock: net.Socket) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
  };
  const server = net.createServer((client) => {
    track(client);
    stats.connections++;
    const message = pending.shift();
    if (message !== undefined) {
      let buf = Buffer.alloc(0);
      client.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        // Açılış iletisi: uzunluk (4 bayt, kendisi dahil) + sürüm + parametreler; tamamı gelince cevap
        if (buf.length >= 4 && buf.length >= buf.readInt32BE(0)) {
          stats.refused++;
          client.end(errorResponse("08P01", message));
        }
      });
      client.on("error", () => {});
      return;
    }
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    track(upstream);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  const url = new URL(target.href);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return {
    url: url.href,
    stats,
    fail(n: number, message = "Authentication timed out") {
      pending = Array.from({ length: n }, () => message);
      stats.connections = 0;
      stats.refused = 0;
    },
    async close() {
      for (const sock of sockets) sock.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("Neon'un kimlik doğrulama zaman aşımı: gerçek postgres.js, drizzle ve createDb", { skip: !SERVER_URL && "BAGLANTI_TEST_DATABASE_URL yok", timeout: 120_000 }, () => {
  let admin: postgres.Sql;
  let direct: DB;
  let proxy: Awaited<ReturnType<typeof neonProxy>>;
  /** Paylaşılan bağlantı (getDb), son testte açılır */
  let shared: DB | undefined;
  const warnings: string[] = [];
  const realWarn = console.warn;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    direct = createDb(url.href, 2);
    await migrate(direct, { migrationsFolder: "drizzle" });
    proxy = await neonProxy(url);
    // createDb'nin yeniden deneme satırı (onRetry → console.warn) yakalanır
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
  });

  after(async () => {
    console.warn = realWarn;
    // Düşen bir testin yarıda bıraktığı sorgu kapanışı bekletmesin
    await shared?.$client.end({ timeout: 5 });
    await direct?.$client.end({ timeout: 5 });
    await proxy?.close();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  /** Vekilden geçen yeni bir havuz (her test kendi bağlantısını açar: açılış ilk sorguda olur) */
  async function viaNeon<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    const db = createDb(proxy.url, 1);
    try {
      return await fn(db);
    } finally {
      await db.$client.end({ timeout: 5 });
    }
  }

  test("okuma: ilk bağlantı 08P01 'Authentication timed out' ile düşer, sorgu bir kez daha gönderilir ve sonucu döner", async () => {
    await direct.insert(s.jobRuns).values({ job: "gunluk", status: "ok" });
    const [{ n: expected }] = await direct.select({ n: count() }).from(s.jobRuns);
    warnings.length = 0;
    proxy.fail(1);
    const rows = await viaNeon((db) => db.select({ n: count() }).from(s.jobRuns));
    assert.deepEqual(rows, [{ n: expected }]);
    assert.deepEqual(proxy.stats, { connections: 2, refused: 1 }, "ikinci bağlantı gerçek sunucuya");
    assert.equal(warnings.length, 1, warnings.join("\n"));
    assert.match(warnings[0], /^\[db\] bağlantı yenilendi \(AUTH_TIMEOUT\), sorgu yeniden gönderildi: select count\(\*\) from "job_runs"/);
  });

  test("yazım: bağlantı kurulmadığı için gönderilmemiş sayılır; yeniden denenir ve bir kez yazılır", async () => {
    const [{ n: before }] = await direct.select({ n: count() }).from(s.jobRuns);
    warnings.length = 0;
    proxy.fail(1);
    const [row] = await viaNeon((db) => db.insert(s.jobRuns).values({ job: "parasut", message: "neon-yazim" }).returning({ id: s.jobRuns.id }));
    assert.equal(typeof row.id, "number");
    const [{ n: afterCount }] = await direct.select({ n: count() }).from(s.jobRuns);
    assert.equal(afterCount, before + 1, "bir satır");
    assert.equal((await direct.select().from(s.jobRuns).where(eq(s.jobRuns.message, "neon-yazim"))).length, 1);
    assert.deepEqual(proxy.stats, { connections: 2, refused: 1 });
    assert.match(warnings.join("\n"), /\(AUTH_TIMEOUT\), sorgu yeniden gönderildi: insert into "job_runs"/);
  });

  test("işlem (drizzle transaction): BEGIN'in bağlantısı açılamayınca işlem bir kez daha açılır, gövde bir kez çalışır", async () => {
    const [{ n: before }] = await direct.select({ n: count() }).from(s.jobRuns);
    warnings.length = 0;
    proxy.fail(1);
    let bodies = 0;
    const id = await viaNeon((db) =>
      db.transaction(async (tx) => {
        bodies++;
        const [row] = await tx.insert(s.jobRuns).values({ job: "gunluk", message: "neon-islem" }).returning({ id: s.jobRuns.id });
        await tx.update(s.jobRuns).set({ status: "ok" }).where(eq(s.jobRuns.id, row.id));
        return row.id;
      }),
    );
    assert.equal(bodies, 1);
    const [{ n: afterCount }] = await direct.select({ n: count() }).from(s.jobRuns);
    assert.equal(afterCount, before + 1);
    const [row] = await direct.select().from(s.jobRuns).where(eq(s.jobRuns.id, id));
    assert.deepEqual([row.message, row.status], ["neon-islem", "ok"], "işlem tamamlandı");
    assert.deepEqual(proxy.stats, { connections: 2, refused: 1 });
    assert.deepEqual(warnings, ["[db] bağlantı yenilendi (AUTH_TIMEOUT), sorgu yeniden gönderildi: begin"]);
  });

  test("başka mesajlı 08P01 yeniden denenmez: hata çağırana gider, havuz sonraki sorguda yeni bağlantı açar", async () => {
    warnings.length = 0;
    proxy.fail(1, "invalid frontend message type 0");
    await viaNeon(async (db) => {
      await assert.rejects(db.select({ n: count() }).from(s.jobRuns), (e: unknown) => {
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        assert.equal(cause?.code, "08P01");
        assert.equal(cause?.message, "invalid frontend message type 0");
        assert.equal(connectionErrorCode(e), null);
        return true;
      });
      assert.deepEqual(proxy.stats, { connections: 1, refused: 1 }, "ikinci deneme yok");
      const [{ n }] = await db.select({ n: count() }).from(s.jobRuns);
      assert.ok(n >= 1);
    });
    assert.deepEqual(warnings, []);
  });

  test("Neon'un gerçek hatası postgres.js'te kod 08P01 ve bu mesajla gelir; drizzle sarar, kod AUTH_TIMEOUT okunur", async () => {
    // Sarılmamış istemci (komut satırının $client'ı): hatanın biçimi
    proxy.fail(1);
    const raw = postgres(proxy.url, { max: 1, onnotice: () => {} });
    try {
      await assert.rejects(raw.unsafe("select 1"), (e: unknown) => {
        const err = e as { code?: string; message?: string; severity?: string };
        assert.deepEqual([err.code, err.message, err.severity], ["08P01", "Authentication timed out", "FATAL"]);
        assert.equal(connectionErrorCode(e), AUTH_TIMEOUT);
        return true;
      });
    } finally {
      await raw.end();
    }
  });

  test("günlük işin çalışma kaydı: Neon uyanırken bütün açılışlar düşse de startJobRun kaydı yazar (sahte 'çalışmadı' yok)", async () => {
    // startJobRun paylaşılan bağlantıyı (getDb, DATABASE_URL) kullanır: vekilin adresi verilir. "server-only" Next'in
    // sunucu derlemesi dışında hata fırlatır; test aynı modülü doğrudan çalıştırır.
    process.env.DATABASE_URL = proxy.url;
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const { getDb } = await import("../src/server/db");
    const { startJobRun } = await import("../src/server/jobs/runs");
    shared = getDb();
    warnings.length = 0;
    // İlk adımdaki üç paralel sorgunun üç açılışı da düşer (Neon o anda uyanıyor)
    proxy.fail(3);
    const errors: unknown[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    let id: number | null;
    try {
      id = await startJobRun("parasut");
    } finally {
      console.error = realError;
    }
    assert.deepEqual(errors, [], "kayıt açılamadı hatası yok");
    assert.equal(typeof id, "number", "çalışma kaydı açıldı");
    const [run] = await direct.select().from(s.jobRuns).where(eq(s.jobRuns.id, id!));
    assert.deepEqual([run.job, run.status], ["parasut", "running"]);
    assert.equal(proxy.stats.refused, 3);
    assert.equal(warnings.filter((w) => w.includes("(AUTH_TIMEOUT)")).length, 3, warnings.join("\n"));
  });
});
