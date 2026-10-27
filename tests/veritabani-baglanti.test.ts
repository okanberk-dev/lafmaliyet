// Veritabanı bağlantısı (src/server/db/index.ts, src/server/db/retry.ts): uyuyan bağlantının ilk sorgusu bir kez
// yeniden denenir (okuma her bağlantı hatasında, yazım yalnız bağlantı hiç kurulmadıysa: CONNECT_TIMEOUT ya da Neon'un
// "Authentication timed out"u; işlem içi sarılmaz), drizzle sorguları gerçekten bu yoldan gönderir, TLS sertifikası
// doğrulanır, canlı derleme havuzlu adresi de açar. Gerçek postgres.js ile Neon'un hatası: veritabani-baglanti-db.test.ts.
// Çalıştırma: npx tsx --test tests/veritabani-baglanti.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";

import { KNOWN_ORPHANS, migrationReport, type JournalEntry } from "../scripts/migration-check";
import { sslOption } from "../src/server/db";
import { AUTH_TIMEOUT, connectionErrorCode, isReadOnlyStatement, shouldRetry, withConnectionRetry, type RetryClient } from "../src/server/db/retry";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

/** postgres.js'in bağlantı hatası biçimi (src/errors.js › connection) */
const connErr = (code: string) => Object.assign(new Error(`write ${code} ep-ornek-pooler.c-7.eu-central-1.aws.neon.tech:5432`), { code, errno: code });

/**
 * Neon'un uyanırken verdiği hata (postgres.js PostgresError biçimi: sunucunun alanları nesneye kopyalanır). Canlıda 24
 * Ekim 2026: `[bugun] Failed query: select count(*) from "ingredients"` → cause "Authentication timed out", code 08P01.
 */
const authTimeout = (message = "Authentication timed out") =>
  Object.assign(new Error(message), { name: "PostgresError", severity_local: "FATAL", severity: "FATAL", code: "08P01" });

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

test("Neon'un kimlik doğrulama zaman aşımı (08P01 + mesaj) bağlantı hatasıdır; çıplak 08P01 değildir", () => {
  assert.equal(AUTH_TIMEOUT, "AUTH_TIMEOUT");
  assert.equal(connectionErrorCode(authTimeout()), AUTH_TIMEOUT);
  assert.equal(connectionErrorCode(authTimeout("authentication timed out")), AUTH_TIMEOUT, "büyük küçük harf");
  // Drizzle'ın sardığı hâli (canlıdaki biçim) ve düz nesne
  const wrapped = Object.assign(new Error('Failed query: select count(*) from "ingredients"'), { cause: authTimeout() });
  assert.equal(connectionErrorCode(wrapped), AUTH_TIMEOUT);
  assert.equal(connectionErrorCode({ cause: { code: "08P01", message: "Authentication timed out" } }), AUTH_TIMEOUT);
  // 08P01 genel protokol hatası kodudur: başka mesajla bağlantı hatası sayılmaz
  assert.equal(connectionErrorCode(authTimeout("invalid frontend message type 0")), null);
  assert.equal(connectionErrorCode({ cause: { code: "08P01", message: "expected password response, got message type 88" } }), null);
  assert.equal(connectionErrorCode({ code: "08P01" }), null, "mesajsız");
  // Aynı mesaj başka kodla da sayılmaz; 57P01 (yönetici kapattı) görülmedikçe dışarıda
  assert.equal(connectionErrorCode({ code: "28P01", message: "Authentication timed out" }), null);
  assert.equal(connectionErrorCode(Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" })), null);
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
  // Neon'un kimlik doğrulama zaman aşımı: sorgu gönderilmedi, okuma da yazım da yeniden
  const neon = { cause: { code: "08P01", message: "Authentication timed out" } };
  assert.equal(shouldRetry('insert into "job_runs" ("job") values ($1)', neon), true, "bağlantı kurulmadı: yazım da");
  assert.equal(shouldRetry('select count(*) from "ingredients"', neon), true);
  assert.equal(shouldRetry('update "settings" set "value" = $1', authTimeout()), true);
  const other = { cause: { code: "08P01", message: "invalid frontend message type 0" } };
  assert.equal(shouldRetry("select 1", other), false, "başka mesajlı 08P01");
  assert.equal(shouldRetry("insert into t values (1)", other), false);
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

test("sarılı istemci: Neon kimlik doğrulamada zaman aşımına düşünce okuma ve yazım bir kez daha gönderilir", async () => {
  const retried: string[] = [];
  const w = fakeClient((_q, n) => (n === 1 ? authTimeout() : [{ id: 1 }]));
  const db = withConnectionRetry(w.client, { delayMs: 0, onRetry: (code) => retried.push(code) });
  assert.deepEqual(await db.unsafe('insert into "job_runs" ("job") values ($1) returning "id"', ["parasut"]), [{ id: 1 }]);
  assert.equal(w.sent.length, 2, "yazım ikinci kez gönderildi");
  assert.deepEqual(w.sent[1].params, ["parasut"]);
  assert.deepEqual(retried, [AUTH_TIMEOUT], "günlükteki kod");

  const r = fakeClient((_q, n) => (n === 1 ? Object.assign(new Error("Failed query"), { cause: authTimeout() }) : [[3]]));
  assert.deepEqual(await withConnectionRetry(r.client, { delayMs: 0 }).unsafe('select count(*) from "ingredients"').values(), [[3]]);
  assert.equal(r.sent.length, 2);

  // İki kez düşerse hata çağırana gider; başka mesajlı 08P01 hiç yeniden denenmez
  const twice = fakeClient(() => authTimeout());
  await assert.rejects(async () => await withConnectionRetry(twice.client, { delayMs: 0 }).unsafe("select 1"), /Authentication timed out/);
  assert.equal(twice.sent.length, 2);
  const proto = fakeClient(() => authTimeout("invalid frontend message type 0"));
  await assert.rejects(async () => await withConnectionRetry(proto.client, { delayMs: 0 }).unsafe("select 1"), /invalid frontend message/);
  assert.equal(proto.sent.length, 1);
});

test("sarılı istemci: öteki her şey (seçenekler, kapatma) istemcinin kendisi; işlem istemcinin begin'ine gider", async () => {
  const { client } = fakeClient(() => []);
  const db = withConnectionRetry(client, { delayMs: 0 });
  assert.equal(db.options, client.options);
  assert.equal(await db.begin(() => "işlem"), "işlem");
  assert.equal(await db.end(), "kapandı");
});

/**
 * Sahte işlem: postgres.js'in begin([seçenekler], gövde) biçimi. `answer` her açılışta çağrılır; Error dönerse BEGIN o
 * hatayla düşer (gövde çağrılmaz), "gövdede" dönerse gövde çağrılır ve ardından o hatayla düşülür (COMMIT kopmuş gibi).
 */
function fakeBegin(answer: (n: number) => Error | "gövdede" | null) {
  const calls: unknown[][] = [];
  let bodies = 0;
  const client = {
    unsafe: fakeClient(() => []).client.unsafe,
    async begin(...args: unknown[]) {
      calls.push(args.slice(0, -1));
      const fn = args[args.length - 1] as (sql: string) => unknown;
      const a = answer(calls.length);
      if (a instanceof Error) throw a;
      bodies++;
      const result = await fn("işlem-sql");
      if (a === "gövdede") throw connErr("CONNECTION_CLOSED");
      return result;
    },
  } satisfies RetryClient & Record<string, unknown>;
  return { client, calls, bodies: () => bodies };
}

test("işlem: BEGIN bağlantı hatasıyla düşer ve gövde çalışmadıysa bir kez daha açılır; gövde bir kez çalışır", async () => {
  for (const err of [authTimeout(), connErr("CONNECT_TIMEOUT"), connErr("CONNECTION_CLOSED"), connErr("ECONNRESET")]) {
    const retried: string[] = [];
    const f = fakeBegin((n) => (n === 1 ? err : null));
    const db = withConnectionRetry(f.client, { delayMs: 0, onRetry: (code, q) => retried.push(`${code} ${q}`) });
    assert.equal(await db.begin("isolation level serializable", (sql: unknown) => `gövde ${String(sql)}`), "gövde işlem-sql");
    assert.equal(f.bodies(), 1, err.message);
    assert.deepEqual(f.calls, [["isolation level serializable"], ["isolation level serializable"]], "seçenekler ikinci açılışta da");
    assert.equal(retried.length, 1);
    assert.match(retried[0], /^(AUTH_TIMEOUT|CONNECT_TIMEOUT|CONNECTION_CLOSED|ECONNRESET) begin$/);
  }
  // Seçeneksiz biçim
  const plain = fakeBegin((n) => (n === 1 ? authTimeout() : null));
  assert.equal(await withConnectionRetry(plain.client, { delayMs: 0 }).begin(() => 7), 7);
  assert.deepEqual(plain.calls, [[], []]);
});

test("işlem: gövde çalıştıysa, hata bağlantı hatası değilse ya da ikinci açılış da düşerse yeniden denenmez", async () => {
  // Gövde çalıştı, sonra bağlantı koptu (COMMIT gitmiş olabilir): ikinci kez çalıştırılmaz
  const ran = fakeBegin(() => "gövdede");
  await assert.rejects(async () => await withConnectionRetry(ran.client, { delayMs: 0 }).begin(() => "x"), /CONNECTION_CLOSED/);
  assert.deepEqual([ran.calls.length, ran.bodies()], [1, 1]);
  // Gövdenin kendi hatası (bağlantı hatası da olsa) gövde çalıştığı için gider
  const inner = fakeBegin(() => null);
  await assert.rejects(
    async () =>
      await withConnectionRetry(inner.client, { delayMs: 0 }).begin(() => {
        throw authTimeout();
      }),
    /Authentication timed out/,
  );
  assert.equal(inner.calls.length, 1);
  // Veritabanının kendi hatası ve başka mesajlı 08P01
  for (const err of [Object.assign(new Error("deadlock detected"), { code: "40P01" }), authTimeout("invalid frontend message type 0")]) {
    const f = fakeBegin(() => err);
    await assert.rejects(async () => await withConnectionRetry(f.client, { delayMs: 0 }).begin(() => "x"), (e: unknown) => e === err);
    assert.deepEqual([f.calls.length, f.bodies()], [1, 0]);
  }
  // En çok bir yeniden açılış
  const twice = fakeBegin(() => authTimeout());
  await assert.rejects(async () => await withConnectionRetry(twice.client, { delayMs: 0 }).begin(() => "x"), /Authentication timed out/);
  assert.deepEqual([twice.calls.length, twice.bodies()], [2, 0]);
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

test("DEPLOY.md: Neon'un uyanışında yeniden deneme; günlükteki satır createDb'nin yazdığıyla aynı", () => {
  const doc = read("docs/DEPLOY.md").replace(/\s*\n\s*/g, " ");
  const s3 = doc.slice(doc.indexOf("## 3. Veritabanı (Neon)"), doc.indexOf("## 4."));
  assert.match(s3, /\*\*Uyuyan bağlantı ve Neon'un uyanışı\.\*\*/);
  assert.match(s3, /`08P01` "Authentication timed out"/);
  assert.match(s3, /`src\/server\/db\/retry\.ts`/);
  // createDb'nin onRetry satırı: belgede AUTH_TIMEOUT'la yazılan biçim
  assert.match(read("src/server/db/index.ts"), /console\.warn\(`\[db\] bağlantı yenilendi \(\$\{code\}\), sorgu yeniden gönderildi: \$\{query\.slice\(0, 80\)\}`\)/);
  assert.ok(s3.includes(`\`[db] bağlantı yenilendi (${AUTH_TIMEOUT}), sorgu yeniden gönderildi: …\``));
});

test("DEPLOY.md § 8: Vercel Hobby planı, bir saatlik günlük, 7 günlük hata kümesi, cron penceresi, kullanım şartı", async () => {
  const doc = read("docs/DEPLOY.md").replace(/\s*\n\s*/g, " ");
  const s8 = doc.slice(doc.indexOf("## 8. Plan ve günlükler (Vercel Hobby)"));
  assert.ok(s8.startsWith("## 8."), "bölüm yok");
  for (const s of [
    "ücretsiz **Hobby** planında",
    "kişisel ve ticari olmayan kullanım",
    "**Öneri: Pro plan.**",
    "yalnız son bir saati tutar",
    "son 7 gün",
    "**Log drain yok.**",
    "Ayarlar › Günlük işler",
    "`/api/cron/parasut` 07:00–08:00, `/api/cron/gunluk` 08:00–09:00",
    "Günde en çok 100 dağıtım",
  ]) {
    assert.ok(s8.includes(s), `§ 8'de yok: ${s}`);
  }
  // Andığı kurallar kodla aynı: cron saatleri vercel.json'da, "çalışmadı" beklemesi job-health'te
  const crons = (JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] }).crons;
  assert.deepEqual(
    crons.map((c) => [c.path, c.schedule]),
    [
      ["/api/cron/parasut", "30 4 * * *"],
      ["/api/cron/gunluk", "0 5 * * *"],
    ],
  );
  const { GRACE_MIN } = await import("../src/lib/job-health");
  assert.match(s8, new RegExp(`pencerenin sonundan ${GRACE_MIN} dakika sonra \\(\`src/lib/job-health\\.ts\` › \`GRACE_MIN\`\\)`));
  for (const f of ["src/lib/job-health.ts", "src/server/jobs/capped.ts", "docs/planlar/KALAN-ISLER.md"]) assert.ok(s8.includes(`\`${f}\``) && read(f).length > 0, f);
  // Hata kancası yazılınca belge de güncellenir (kanca istek gövdesi ve çerez taşımamalı; o zaman kendi testi)
  const hook = ["src/instrumentation.ts", "src/instrumentation-node.ts", "instrumentation.ts"].some((f) => existsSync(join(process.cwd(), f)));
  assert.equal(hook, false, "instrumentation kancası eklendi: DEPLOY.md § 8'deki 'Hata kancası yok' maddesini güncelleyin");
  assert.match(s8, /\*\*Hata kancası yok\.\*\* `src\/instrumentation\.ts`/);
  // Sahibe soru 10'un varsayılanı yazılı
  assert.match(read("docs/planlar/KALAN-ISLER.md"), /10\. \*\*Vercel planı\*\* \(E-67, B05\)[^\n]*\n\s+\*\*Varsayılan:\*\* plan Hobby kalır/);
});
