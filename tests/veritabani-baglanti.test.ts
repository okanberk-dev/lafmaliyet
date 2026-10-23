// Veritabanı bağlantısı (src/server/db/index.ts, src/server/db/retry.ts): uyuyan bağlantının ilk sorgusu bir kez
// yeniden denenir (okuma her bağlantı hatasında, yazım yalnız bağlantı hiç kurulmadıysa; işlem içi sarılmaz), drizzle
// sorguları gerçekten bu yoldan gönderir, TLS sertifikası doğrulanır, canlı derleme havuzlu adresi de açar.
// Çalıştırma: npx tsx --test tests/veritabani-baglanti.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";

import { KNOWN_ORPHANS, migrationReport, type JournalEntry } from "../scripts/migration-check";
import { sslOption } from "../src/server/db";
import { connectionErrorCode, isReadOnlyStatement, shouldRetry, withConnectionRetry, type RetryClient } from "../src/server/db/retry";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

/** postgres.js'in bağlantı hatası biçimi (src/errors.js › connection) */
const connErr = (code: string) => Object.assign(new Error(`write ${code} ep-ornek-pooler.c-7.eu-central-1.aws.neon.tech:5432`), { code, errno: code });

/**
 * Sahte istemci: unsafe() postgres.js gibi tembel bir yanıt döner (beklenince gönderilir, values() satır biçimini
 * seçer). `answer` her gönderimde çağrılır; Error dönerse sorgu o hatayla düşer.
 */
function fakeClient(answer: (query: string, n: number) => unknown) {
  const sent: { query: string; values: boolean; params: unknown }[] = [];
  const client = {
    options: { parsers: {} as Record<string, unknown>, serializers: {} as Record<string, unknown> },
    begin: (fn: () => string) => fn(),
    end: async () => "kapandı",
    unsafe(query: string, params?: unknown[]) {
      const send = (values: boolean) => {
        sent.push({ query, values, params });
        const r = answer(query, sent.length);
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      };
      const lazy = (values: boolean): PromiseLike<unknown> => ({ then: (a, b) => send(values).then(a, b) });
      return { ...lazy(false), values: () => lazy(true) };
    },
  } satisfies RetryClient & Record<string, unknown>;
  return { client, sent };
}

test("bağlantı hatası: postgres.js'in kodları ve soket hataları; drizzle'ın sardığı hatada cause'a bakılır", () => {
  for (const code of ["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT", "ECONNRESET", "ETIMEDOUT", "EPIPE"]) {
    assert.equal(connectionErrorCode(connErr(code)), code);
  }
  // DrizzleQueryError: "Failed query: …", asıl hata cause'ta (canlıdaki 22 Ekim hatası)
  const wrapped = Object.assign(new Error('Failed query: select "value" from "integration_state"'), { cause: connErr("CONNECT_TIMEOUT") });
  assert.equal(connectionErrorCode(wrapped), "CONNECT_TIMEOUT");
  // Veritabanının kendi hatası (tekil kayıt, tablo yok) bağlantı hatası değildir
  assert.equal(connectionErrorCode(Object.assign(new Error("duplicate key"), { code: "23505" })), null);
  assert.equal(connectionErrorCode(new Error("fetch failed")), null);
  assert.equal(connectionErrorCode(null), null);
  assert.equal(connectionErrorCode("CONNECTION_CLOSED"), null);
});

test("yalnız okuyan sorgu: SELECT / WITH; yazan, kilitleyen ya da sayaç ilerleten her şey yazım sayılır", () => {
  for (const q of [
    'select "id", "name" from "users" where "users"."id" = $1 limit $2',
    "SELECT 1",
    "  select 1",
    "/* sağlık */ select 1",
    "-- not\nselect 1",
    'with "x" as (select 1) select * from "x"',
    "(select 1) union (select 2)",
    'select "value" from "integration_state" where "integration_state"."key" = $1 limit $2',
    'select "updated_at", "updated_by" from "products"',
  ]) {
    assert.equal(isReadOnlyStatement(q), true, q);
  }
  for (const q of [
    'insert into "activity_log" ("user_name") values ($1)',
    'update "users" set "failed_logins" = 0',
    'delete from "photos" where "id" = $1',
    "with d as (delete from t returning *) select * from d",
    "with u as (update t set a = 1 returning *) select * from u",
    "select * from t for update",
    "select * from t for no key update",
    "select * from t for share",
    "select nextval('x')",
    "select setval(pg_get_serial_sequence('t', 'id'), 1)",
    "select pg_advisory_xact_lock(hashtext('karaoke-sync'))",
    "select set_config('a', 'b', false)",
    "select * into yeni from eski",
    "truncate t",
    "begin",
    "",
  ]) {
    assert.equal(isReadOnlyStatement(q), false, q);
  }
});

test("yeniden deneme kuralı: okuma her bağlantı hatasında; yazım yalnız bağlantı hiç kurulmadıysa (gönderilmedi)", () => {
  assert.equal(shouldRetry("select 1", connErr("CONNECTION_CLOSED")), true);
  assert.equal(shouldRetry("select 1", connErr("ETIMEDOUT")), true);
  assert.equal(shouldRetry("insert into t values (1)", connErr("CONNECTION_CLOSED")), false, "yazım sunucuya ulaşmış olabilir");
  assert.equal(shouldRetry("insert into t values (1)", connErr("ECONNRESET")), false);
  assert.equal(shouldRetry("insert into t values (1)", connErr("CONNECT_TIMEOUT")), true, "bağlantı kurulmadı: gönderilmedi");
  assert.equal(shouldRetry("select 1", Object.assign(new Error("relation does not exist"), { code: "42P01" })), false);
});

test("sarılı istemci: uyuyan bağlantının okuması bir kez daha gönderilir, values() korunur, başarısı döner", async () => {
  const { client, sent } = fakeClient((_q, n) => (n === 1 ? connErr("CONNECTION_CLOSED") : [{ ok: 1 }]));
  const retried: string[] = [];
  const db = withConnectionRetry(client, { delayMs: 0, onRetry: (code) => retried.push(code) });
  assert.deepEqual(await db.unsafe("select 1"), [{ ok: 1 }]);
  assert.equal(sent.length, 2);
  assert.deepEqual(retried, ["CONNECTION_CLOSED"]);

  const v = fakeClient((_q, n) => (n === 1 ? connErr("ECONNRESET") : [[1]]));
  assert.deepEqual(await withConnectionRetry(v.client, { delayMs: 0 }).unsafe("select 1").values(), [[1]]);
  assert.deepEqual(
    v.sent.map((x) => x.values),
    [true, true],
    "ikinci gönderim de satır dizisi ister",
  );
});

test("sarılı istemci: yazım yolda kopan bağlantıda yeniden gönderilmez; iki kez düşen okuma hatayı verir; tembel", async () => {
  const w = fakeClient(() => connErr("CONNECTION_CLOSED"));
  await assert.rejects(async () => await withConnectionRetry(w.client, { delayMs: 0 }).unsafe('insert into "t" values ($1)', [1]), /CONNECTION_CLOSED/);
  assert.equal(w.sent.length, 1, "yazım bir kez");

  const t = fakeClient((_q, n) => (n === 1 ? connErr("CONNECT_TIMEOUT") : []));
  assert.deepEqual(await withConnectionRetry(t.client, { delayMs: 0 }).unsafe('insert into "t" values ($1)', [1]), []);
  assert.equal(t.sent.length, 2, "bağlantı hiç kurulmadıysa yazım da yeniden");

  const r = fakeClient(() => connErr("CONNECTION_CLOSED"));
  await assert.rejects(async () => await withConnectionRetry(r.client, { delayMs: 0 }).unsafe("select 1"), /CONNECTION_CLOSED/);
  assert.equal(r.sent.length, 2, "en çok bir yeniden deneme");

  const pg = fakeClient(() => Object.assign(new Error("duplicate key"), { code: "23505" }));
  await assert.rejects(async () => await withConnectionRetry(pg.client, { delayMs: 0 }).unsafe("select 1"), /duplicate key/);
  assert.equal(pg.sent.length, 1, "veritabanının kendi hatası yeniden denenmez");

  // Yanıt beklenmeden gönderilmez; iki kez beklenen yanıt tek gönderimdir
  const lazy = fakeClient(() => [1]);
  const pending = withConnectionRetry(lazy.client, { delayMs: 0 }).unsafe("select 1");
  assert.equal(lazy.sent.length, 0);
  await pending;
  await pending;
  assert.equal(lazy.sent.length, 1);
});

test("sarılı istemci: öteki her şey (işlem, seçenekler, kapatma) istemcinin kendisi", async () => {
  const { client } = fakeClient(() => []);
  const db = withConnectionRetry(client, { delayMs: 0 });
  assert.equal(db.options, client.options);
  assert.equal(db.begin(() => "işlem"), "işlem");
  assert.equal(await db.end(), "kapandı");
});

test("drizzle bütün sorguları sarılı unsafe()'ten gönderir: execute ve select bir kez yeniden denenir", async () => {
  const t = pgTable("t", { id: integer("id").primaryKey(), name: text("name") });
  const { client, sent } = fakeClient((q, n) => (n % 2 === 1 ? connErr("CONNECTION_CLOSED") : q.startsWith("select 1") ? [{ "?column?": 1 }] : [[7, "Latte"]]));
  const db = drizzle(withConnectionRetry(client as never, { delayMs: 0 }));
  assert.deepEqual(await db.execute(sql`select 1`), [{ "?column?": 1 }]);
  assert.deepEqual(await db.select().from(t), [{ id: 7, name: "Latte" }]);
  assert.equal(sent.length, 4);
  assert.deepEqual(
    sent.map((x) => x.values),
    [false, false, true, true],
  );
  // Yazım yeniden gönderilmez (drizzle hatayı sarar, asıl hata cause'ta)
  const w = fakeClient(() => connErr("CONNECTION_CLOSED"));
  const wdb = drizzle(withConnectionRetry(w.client as never, { delayMs: 0 }));
  await assert.rejects(wdb.insert(t).values({ id: 1, name: "x" }), (e: unknown) => connectionErrorCode(e) === "CONNECTION_CLOSED");
  assert.equal(w.sent.length, 1);
});

test("TLS: Neon'da sertifika doğrulanır; yerelde ve sslmode=disable'da yok; acil geri dönüş DATABASE_SSL=require", () => {
  const neon = "postgres://u:p@ep-ornek-pooler.c-7.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
  assert.equal(sslOption(neon, {}), "verify-full", "adresteki sslmode=require doğrulamayı kapatmaz");
  assert.equal(sslOption(neon, { DATABASE_SSL: "require" }), "require");
  assert.equal(sslOption(neon, { DATABASE_SSL: "verify-full" }), "verify-full");
  assert.equal(sslOption("postgres://postgres:postgres@localhost:5432/laffogato", {}), false);
  assert.equal(sslOption("postgres://u@127.0.0.1/x", {}), false);
  assert.equal(sslOption("postgres://u@db.example.com/x?sslmode=disable", {}), false);
});

test("havuzun ayarları ve canlı derlemenin bağlantı denetimi", () => {
  const src = read("src/server/db/index.ts");
  assert.match(src, /idle_timeout: 5,/);
  assert.match(src, /max_lifetime: 5 \* 60,/);
  assert.match(src, /connect_timeout: 10,/);
  assert.match(src, /ssl: sslOption\(url\),/);
  assert.match(src, /drizzle\(\s*withConnectionRetry\(client,/);
  // Komut satırının doğrudan kullandığı istemci sarılmaz (yedek reserve() ve işlemler)
  assert.match(src, /Object\.assign\(db, \{ \$client: client \}\)/);
  const pre = read("scripts/predeploy.ts");
  // Havuzlu bağlantı migration'dan önce: açılmazsa derleme şemayı değiştirmeden durur (eski sürüm yeni şemayla kalmasın)
  assert.match(pre, /await checkRuntimeConnection\(\);\s*await runMigrations\(\);\s*await runSeed\(\);/);
  assert.ok(pre.indexOf("await checkRuntimeConnection();") < pre.indexOf("await runMigrations();"));
  assert.match(pre, /if \(!url \|\| url === migrated\) return;/);
});

test("derleme günlüğü: bilinen eski önizleme kaydı uyarı yazmaz, yeni bir kayıt yazar", () => {
  const J: JournalEntry[] = [{ idx: 0, when: 1000, tag: "0000_ilk" }];
  assert.deepEqual([...KNOWN_ORPHANS], [1792621679613]);
  assert.equal(migrationReport(J, [1000, 1792621679613]).warning, null);
  const fresh = migrationReport(J, [1000, 1792621679613, 1792700000000]).warning ?? "";
  assert.match(fresh, /depoda olmayan 1 migration kaydı var \(created_at 1792700000000 = /);
  assert.equal(migrationReport(J, [1000]).ok, "✓ Veritabanı şeması güncel (1 migration)", "canlı derleme günlüğünün satırı aynı");
});

test("DEPLOY.md: gizli değerler yalnız Production (önizleme canlının veritabanını kullanır), TLS acil geri dönüşü yazılı", () => {
  const doc = read("docs/DEPLOY.md");
  assert.doesNotMatch(doc, /Environment Variables\*\* \(Production ve Preview\)/);
  const env = doc.slice(doc.indexOf("## 4. Ortam değişkenleri"), doc.indexOf("## 5."));
  assert.match(env, /gizli değerler\s+\*\*yalnız Production\*\*'a eklenir/);
  for (const name of ["AUTH_SECRET", "ADMIN_PASSWORD", "CRON_SECRET", "KARAOKE_SYNC_SECRET", "PARASUT_*"]) assert.ok(env.includes(`\`${name}\``), name);
  assert.match(env, /`MIGRATE_ON_PREVIEW=1` ile birlikte/);
  assert.match(env, /\| `DATABASE_SSL` \|/);
  assert.match(doc, /npm run db:reset -- --onay=<sunucu adı>/);
});
