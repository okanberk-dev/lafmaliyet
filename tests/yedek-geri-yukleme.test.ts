// Geri yüklemenin otomatik provası (docs/YEDEK.md › Otomatik prova), gerçek Postgres'te: yedek al → boş veritabanına
// geri yükle → her tablo aynı (dışarıda bırakılanlar hariç); dolu veritabanına --sil önce onun yedeğini alır, parolaları
// korur; yarım ya da bozuk dosya reddedilir; sayılar tutmazsa hedef olduğu gibi kalır; eski sürümde alınmış yedek
// yüklenip son sürüme taşınır.
//
// YEDEK_TEST_DATABASE_URL verilmezse atlanır. Verilen sunucuda geçici veritabanları (laf_yedek_*_<pid>) açılıp sonunda
// silinir; adres yalnız bağlanmak için (ör. postgres://postgres:postgres@localhost/postgres).
// Çalıştırma: YEDEK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/postgres npx tsx --test tests/yedek-geri-yukleme.test.ts

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { migrationReport, readJournal } from "../scripts/migration-check";
import { runRestore } from "../scripts/restore";
import { runSeed } from "../scripts/seed";
import { EXCLUDED_STATE_KEYS, TABLE_RULES } from "../src/lib/backup/format";
import { hashPassword, verifyPassword } from "../src/server/auth/password";
import { columnsOf, ident, publicTables, writeBackupFile } from "../src/server/backup/core";
import { applyMigrations, loadMigrations, readBackupFile, restoreBackup, RestoreError } from "../src/server/backup/restore";
import { createDb, type DB } from "../src/server/db";

const ADMIN_URL = process.env.YEDEK_TEST_DATABASE_URL;
const NAMES = { a: `laf_yedek_a_${process.pid}`, b: `laf_yedek_b_${process.pid}`, c: `laf_yedek_c_${process.pid}`, d: `laf_yedek_d_${process.pid}` };
const INVITE = "!davet-bekliyor";

const urlFor = (name: string) => {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  return u.toString();
};

type Sql = postgres.Sql;

/** Tablonun seçilen sütunlarıyla satırlarının parmak izi (sıradan bağımsız) */
async function fingerprint(sql: Sql, table: string, cols: string[], where = "TRUE"): Promise<{ n: number; md5: string }> {
  const [r] = await sql.unsafe<{ n: number; md5: string }[]>(
    `SELECT count(*)::int AS n, md5(coalesce(string_agg(j, '|' ORDER BY j), '')) AS md5
       FROM (SELECT row_to_json(r)::text AS j FROM (SELECT ${cols.map(ident).join(", ")} FROM public.${ident(table)} WHERE ${where}) r) s`,
  );
  return r;
}

/** Bütün veritabanının parmak izi: değişmediğini sınamak için */
async function wholeFingerprint(sql: Sql): Promise<string> {
  const parts: string[] = [];
  for (const t of await publicTables(sql)) {
    const cols = (await columnsOf(sql, t)).map((c) => c.name);
    const f = await fingerprint(sql, t, cols);
    parts.push(`${t}:${f.n}:${f.md5}`);
  }
  const [m] = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
  return `${parts.join(",")};migrations:${m.n}`;
}

async function counts(sql: Sql): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await publicTables(sql)) {
    const [{ n }] = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM public.${ident(t)}`);
    out[t] = n;
  }
  return out;
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

describe("geri yükleme provası (gerçek veritabanı)", { skip: ADMIN_URL ? false : "YEDEK_TEST_DATABASE_URL yok" }, () => {
  let admin: Sql;
  const dbs: Partial<Record<keyof typeof NAMES, DB>> = {};
  let dir: string;
  let fileA: string;
  let sqlA: Sql;
  let sqlB: Sql;

  before(async () => {
    admin = postgres(ADMIN_URL!, { max: 1, onnotice: () => {} });
    for (const name of Object.values(NAMES)) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${ident(name)}`);
    }
    for (const k of Object.keys(NAMES) as (keyof typeof NAMES)[]) dbs[k] = createDb(urlFor(NAMES[k]), 1);
    sqlA = dbs.a!.$client;
    sqlB = dbs.b!.$client;
    dir = mkdtempSync(join(tmpdir(), "laf-yedek-"));

    // A: bugünkü şema ve Excel verisi, üstüne uç durumlar
    await migrate(dbs.a!, { migrationsFolder: "drizzle" });
    const env = { url: process.env.DATABASE_URL_UNPOOLED, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
    process.env.DATABASE_URL_UNPOOLED = urlFor(NAMES.a);
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    try {
      await quiet(() => runSeed());
    } finally {
      if (env.url === undefined) delete process.env.DATABASE_URL_UNPOOLED;
      else process.env.DATABASE_URL_UNPOOLED = env.url;
      if (env.email !== undefined) process.env.ADMIN_EMAIL = env.email;
      if (env.password !== undefined) process.env.ADMIN_PASSWORD = env.password;
    }
    await sqlA.unsafe(`
      INSERT INTO users (email, name, password_hash, role, active, totp_secret, totp_enabled, totp_last_step, recovery_codes, failed_logins, session_version)
      VALUES ('Okan@Ornek.com', 'Okan', 'scrypt$x', 'admin', true, 'mühürlü', true, 5, '["k1","k2"]', 2, 3),
             ('ayse@ornek.com', 'Ayşe', 'scrypt$y', 'staff', true, NULL, false, NULL, NULL, 0, 1),
             ('eski@ornek.com', 'Eski', 'scrypt$z', 'staff', false, NULL, false, NULL, NULL, 0, 2);
      INSERT INTO user_tokens (user_id, kind, token_hash, expires_at) SELECT id, 'invite', 'ozet', now() + interval '1 day' FROM users WHERE email = 'ayse@ornek.com';
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, session_version) SELECT id, 'https://push.example/1', 'p', 'a', 1 FROM users WHERE email = 'ayse@ornek.com';
      INSERT INTO integration_state (key, value) VALUES
        ('parasut.token', '{"sealed":"x"}'), ('webpush_vapid', '{"publicKey":"p","privateKey":"q"}'),
        ('site_orders', '{"orders":[{"customerName":"Ali"}]}'), ('notify.settings', '{"emailEnabled":true,"from":null}'),
        ('menu_sync', '{"lastOkAt":null}');
      INSERT INTO settings (key, value) VALUES ('yedek_json_null', 'null'::jsonb);
      INSERT INTO invoice_documents (invoice_id, source, file_name, mime, size, data, uploaded_by) VALUES
        ((SELECT min(id) FROM invoices), 'upload', 'fis.jpg', 'image/jpeg', 6, '\\x00ff10ffd8ff'::bytea, 'Okan'),
        ((SELECT min(id) FROM invoices), 'parasut', 'e-fatura.pdf', 'application/pdf', 5, '\\x255044462d'::bytea, NULL);
      INSERT INTO activity_log (at, user_name, action, detail)
        VALUES ('2026-10-22 09:15:03.123456+03', 'Okan', 'Deneme', E'satır 1\\nsatır 2 "tırnak" \\\\ ters bölü · ğüşıöç İ 😀 \\u2028 bitti');
      INSERT INTO stock_extras (month, name, unit, qty, unit_price) VALUES ('2026-10', 'NaN deneme', 'ADET', 'NaN', 'Infinity');
      INSERT INTO karaoke_sessions (external_id, source, date, starts_at, ends_at, guests, customer_name, total_minor)
        VALUES ('krk-1', 'site', '2026-10-22', '2026-10-22 18:00+03', '2026-10-22 19:00+03', 4, 'Zeynep', 150000);
      INSERT INTO job_runs (job, status, steps) VALUES ('gunluk', 'ok', '{"digest":"sent"}');
      INSERT INTO recipe_change_requests (product_id, requested_by, requested_by_name, before, after)
        SELECT (SELECT min(id) FROM products), id, 'Ayşe', '{"note":null,"items":[]}', '{"note":"x","items":[]}' FROM users WHERE email = 'ayse@ornek.com';
      INSERT INTO cash_reports (date, z_total, cash, submitted_by, submitted_by_name)
        SELECT '2026-10-21', 1000.5, 400.25, id, 'Ayşe' FROM users WHERE email = 'ayse@ornek.com';
    `);
    fileA = join(dir, "laffogato-yedek-a.json.gz");
    await writeBackupFile(sqlA, fileA, { documents: true, createdBy: "Okan", app: "test", now: new Date("2026-10-22T06:15:00Z") });
  });

  after(async () => {
    for (const db of Object.values(dbs)) await db?.$client.end().catch(() => {});
    if (admin) {
      for (const name of Object.values(NAMES)) await admin.unsafe(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("boş veritabanına: her tablo aynı, dışarıda bırakılanlar yok, sayaçlar ileride, şema güncel", async () => {
    const backup = await readBackupFile(fileA);
    const r = await restoreBackup(sqlB, backup, { wipe: false });
    assert.equal(r.replaced, false);
    assert.equal(r.safetyCopy, null);
    assert.equal(r.admin, null);
    // ADMIN_* verilmedi ve hedef boş: kimse yönetici olarak giremez (komut satırı bunu söyler)
    assert.equal(r.adminLogin, false);
    assert.deepEqual(r.warnings, []);

    let compared = 0;
    for (const t of await publicTables(sqlA)) {
      const rule = TABLE_RULES[t];
      if (rule?.skip) {
        const [{ n }] = await sqlB.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM public.${ident(t)}`);
        assert.equal(n, 0, `${t} yedeğe girmemeli`);
        continue;
      }
      const cols = (await columnsOf(sqlA, t)).map((c) => c.name).filter((c) => !rule?.dropColumns?.includes(c));
      const a = await fingerprint(sqlA, t, cols, rule?.where);
      // B'de dosyanın dışında satır yok; işlem geçmişine yalnız geri yükleme satırı eklenir
      const b = await fingerprint(sqlB, t, cols, t === "activity_log" ? "action <> 'Yedekten geri yüklendi'" : "TRUE");
      assert.deepEqual(b, a, `${t} farklı`);
      assert.equal(a.n, backup.end.tables[t], `${t}: dosyadaki sayı`);
      compared++;
    }
    assert.ok(compared >= 38);
    assert.ok(backup.end.tables.invoices > 50 && backup.end.tables.sales_lines > 100 && backup.end.tables.products > 100, "Excel verisi yedekte");

    // Örnek değerler: satır sonu, tırnak, ters bölü, Türkçe, emoji, U+2028; mikro saniye; bayt; JSON null; NaN, sonsuz
    const [log] = await sqlB.unsafe<{ detail: string; at: string }[]>(`SELECT detail, at::text AS at FROM activity_log WHERE action = 'Deneme'`);
    assert.equal(log.detail, 'satır 1\nsatır 2 "tırnak" \\ ters bölü · ğüşıöç İ 😀   bitti');
    assert.match(log.at, /09:15:03\.123456|06:15:03\.123456/);
    const [doc] = await sqlB.unsafe<{ hex: string }[]>(`SELECT encode(data, 'hex') AS hex FROM invoice_documents`);
    assert.equal(doc.hex, "00ff10ffd8ff");
    assert.equal((await sqlB.unsafe(`SELECT 1 FROM invoice_documents WHERE source = 'parasut'`)).length, 0, "Paraşüt PDF'i önbellek, yedeğe girmez");
    const [js] = await sqlB.unsafe<{ isnull: boolean; kind: string }[]>(`SELECT value IS NULL AS isnull, jsonb_typeof(value) AS kind FROM settings WHERE key = 'yedek_json_null'`);
    assert.deepEqual({ ...js }, { isnull: false, kind: "null" });
    const [nan] = await sqlB.unsafe<{ qty: string; price: string }[]>(`SELECT qty::text AS qty, unit_price::text AS price FROM stock_extras WHERE name = 'NaN deneme'`);
    assert.deepEqual({ ...nan }, { qty: "NaN", price: "Infinity" });
    // KVKK: karaoke müşterisinin yalnız adı kalır; uygulama siparişlerinin adları, belirteç ve bildirim anahtarı yok
    assert.equal((await sqlB.unsafe(`SELECT 1 FROM karaoke_sessions WHERE customer_name = 'Zeynep'`)).length, 1);
    const keys = (await sqlB.unsafe<{ key: string }[]>(`SELECT key FROM integration_state`)).map((k) => k.key);
    for (const k of Object.keys(EXCLUDED_STATE_KEYS)) assert.ok(!keys.includes(k), `${k} yedeğe girmemeli`);
    assert.ok(keys.includes("notify.settings") && keys.includes("menu_sync"));

    // Boş hedefte kimsenin parolası yok: davet bekler, iki adımlı kapalı, eski oturumlar geçmez
    const users = await sqlB.unsafe<{ password_hash: string; totp_enabled: boolean; totp_secret: string | null; recovery_codes: unknown; session_version: number; failed_logins: number }[]>(
      `SELECT password_hash, totp_enabled, totp_secret, recovery_codes, session_version, failed_logins FROM users`,
    );
    assert.equal(users.length, 3);
    for (const u of users) {
      assert.deepEqual({ ...u }, { password_hash: INVITE, totp_enabled: false, totp_secret: null, recovery_codes: null, session_version: 1, failed_logins: 0 });
    }
    assert.deepEqual([...r.invited].sort(), ["Ayşe", "Okan"]);

    // Sayaçlar: yeni kayıt en büyük kimliğin ardından
    const [{ max }] = await sqlA.unsafe<{ max: number }[]>(`SELECT max(id) AS max FROM invoices`);
    const [{ id }] = await sqlB.unsafe<{ id: number }[]>(`INSERT INTO invoices (date, supplier, category) VALUES ('2026-10-22', 'Deneme', 'Diğer') RETURNING id`);
    assert.ok(id > max, `${id} > ${max}`);
    // Şema güncel: günlükteki her migration'ın kaydı var
    const applied = await sqlB.unsafe<{ created_at: string }[]>(`SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations`);
    const report = migrationReport(readJournal(), applied.map((m) => Number(m.created_at)));
    assert.equal(report.error, null);
    assert.equal(report.warning, null);
    assert.equal(applied.length, readJournal().length);
    const [last] = await sqlB.unsafe<{ action: string; detail: string }[]>(`SELECT action, detail FROM activity_log ORDER BY id DESC LIMIT 1`);
    assert.equal(last.action, "Yedekten geri yüklendi");
    assert.match(last.detail, /^22\.10\.2026 09:15 yedeği · Okan · [\d.]+ satır$/);
  });

  test("yarım, bozuk ya da yedek olmayan dosya reddedilir; hedefe dokunulmaz", async () => {
    const bytes = readFileSync(fileA);
    const half = join(dir, "yarim.json.gz");
    writeFileSync(half, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await assert.rejects(readBackupFile(half), /Dosya eksik ya da bozuk \(indirme yarıda kesilmiş olabilir\): sıkıştırılmış veri yarıda bitiyor/);
    const text = gunzipSync(bytes).toString("utf8");
    const noEnd = join(dir, "sonsuz.json.gz");
    writeFileSync(noEnd, gzipSync(text.slice(0, text.lastIndexOf('{"end":'))));
    await assert.rejects(readBackupFile(noEnd), /son satır yok/);
    const changed = join(dir, "degismis.json.gz");
    writeFileSync(changed, gzipSync(text.replace("Zeynep", "Zeynap")));
    await assert.rejects(readBackupFile(changed), /özet tutmuyor/);
    const plain = join(dir, "duz.json.gz");
    writeFileSync(plain, text);
    await assert.rejects(readBackupFile(plain), /Dosya eksik ya da bozuk/);
    await assert.rejects(readBackupFile(join(dir, "yok.json.gz")), /Dosya bulunamadı/);
    // Komut satırı da hedefe bağlanmadan durur
    const before = await wholeFingerprint(sqlB);
    await assert.rejects(runRestore([half, "--sil"], { log: () => {}, ask: null }, { env: {}, url: urlFor(NAMES.b) }), /Dosya eksik ya da bozuk/);
    assert.equal(await wholeFingerprint(sqlB), before);
  });

  test("dolu veritabanına --sil olmadan yazılmaz", async () => {
    const before = await wholeFingerprint(sqlB);
    const out: string[] = [];
    await assert.rejects(
      runRestore([fileA], { log: (l) => out.push(l), ask: null }, { env: {}, url: urlFor(NAMES.b) }),
      /Hedefte tablolar var \(.*\)\. Boş bir veritabanı verin ya da üzerine yazmak için --sil ekleyin; önce hedefin yedeği alınır\./,
    );
    await assert.rejects(restoreBackup(sqlB, await readBackupFile(fileA), { wipe: false }), RestoreError);
    // --sil verilse de dolu hedefin yedeği alınmadan yazılmaz
    await assert.rejects(restoreBackup(sqlB, await readBackupFile(fileA), { wipe: true }), /yedeği alınmalı/);
    assert.equal(await wholeFingerprint(sqlB), before);
  });

  test("sayılar tutmazsa işlem geri alınır, hedef olduğu gibi kalır", async () => {
    const before = await wholeFingerprint(sqlB);
    const tampered = await readBackupFile(fileA);
    tampered.end.tables.categories += 1;
    await assert.rejects(
      restoreBackup(sqlB, tampered, { wipe: true, safetyCopyPath: join(dir, "atomik-once.json.gz") }),
      /categories tablosuna \d+ satır yüklendi, dosyada \d+ var; geri yükleme geri alındı, hedef değişmedi\./,
    );
    assert.equal(await wholeFingerprint(sqlB), before);
  });

  test("--sil: önce hedefin yedeği, parolalar korunur, ADMIN_* yerelde yöneticiyi ayarlar, herkesin oturumu kapanır", async () => {
    const ayseHash = await hashPassword("Ayse-Parola-1");
    await sqlB.unsafe(`UPDATE users SET password_hash = $1, session_version = 7 WHERE lower(email) = 'ayse@ornek.com'`, [ayseHash]);
    const beforeCounts = await counts(sqlB);
    const out: string[] = [];
    const now = new Date("2026-10-23T07:00:00Z");
    await runRestore([fileA, "--sil"], { log: (l) => out.push(l), ask: null }, {
      env: { ADMIN_EMAIL: "okan@ornek.com", ADMIN_PASSWORD: "Yonetici-Parola-1" },
      url: urlFor(NAMES.b),
      now,
    });
    const safety = join(dir, "laffogato-yedek-once-localhost-2026-10-23-1000.json.gz");
    assert.ok(out.includes(`Önce hedefin yedeği alınıyor: ${safety}`), out.join("\n"));
    assert.ok(out.some((l) => l.startsWith("✓ Geri yükleme tamam.")));
    assert.ok(out.includes(`✓ Geri yükleme öncesi kopya: ${safety}`));
    assert.ok(out.includes("✓ Yönetici parolası ADMIN_PASSWORD ile ayarlandı (okan@ornek.com)."));
    assert.ok(out.includes("✓ Parolası korunanlar: Ayşe"));
    assert.ok(!out.some((l) => l.startsWith("! Hiçbir yönetici")));
    assert.ok(out.includes("! Bu veritabanındaki bütün oturumlar kapandı; herkes yeniden giriş yapacak."));

    // Öncesi kopyası hedefin eski hâli (belgeler dahil), geri yüklenebilir bir dosya
    const copy = await readBackupFile(safety);
    assert.equal(copy.header.createdBy, "geri yükleme öncesi");
    assert.equal(copy.header.documents, true);
    assert.equal(copy.end.tables.invoices, beforeCounts.invoices);
    assert.equal(copy.end.tables.invoices, (await readBackupFile(fileA)).end.tables.invoices + 1, "ilk testte eklenen fatura kopyada");

    // Hedef yeniden yedeğin hâlinde: ilk testte eklenen fatura gitti
    const [{ n }] = await sqlB.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM invoices WHERE supplier = 'Deneme'`);
    assert.equal(n, 0);
    const users = await sqlB.unsafe<{ email: string; role: string; password_hash: string; session_version: number }[]>(
      `SELECT email, role, password_hash, session_version FROM users ORDER BY email`,
    );
    const by = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    assert.ok(await verifyPassword("Ayse-Parola-1", by.get("ayse@ornek.com")!.password_hash), "Ayşe'nin parolası korunur");
    assert.ok(await verifyPassword("Yonetici-Parola-1", by.get("okan@ornek.com")!.password_hash), "Okan'ın parolası ADMIN_PASSWORD");
    assert.equal(by.get("okan@ornek.com")!.role, "admin");
    assert.equal(by.get("eski@ornek.com")!.password_hash, INVITE);
    for (const u of users) assert.equal(u.session_version, 8, `${u.email}: hedefteki en büyük sürüm (7) + 1`);
  });

  test("belgesiz yedek: dosyada belge yok, --sil hedefteki yüklenen belgeyi siler ve bunu söyler", async () => {
    const file = join(dir, "belgesiz.json.gz");
    await writeBackupFile(sqlA, file, { documents: false, createdBy: "Okan", app: "test" });
    const b = await readBackupFile(file);
    assert.equal(b.tables.has("invoice_documents"), false);
    assert.ok(b.header.excluded.tables.includes("invoice_documents"));
    assert.equal(b.header.excluded.documents, "hepsi");
    const out: string[] = [];
    await runRestore([file, "--sil"], { log: (l) => out.push(l), ask: null }, { env: {}, url: urlFor(NAMES.b), now: new Date("2026-10-23T08:00:00Z") });
    assert.ok(out.some((l) => l.includes("Bu yedekte belge yok: hedefteki 1 yüklenen belge silinecek.")), out.join("\n"));
    // ADMIN_* yok; Okan'ın parolası bir önceki testte ADMIN_PASSWORD olmuştu ve korunur: yönetici girebilir
    assert.ok(!out.some((l) => l.startsWith("! Hiçbir yönetici")), out.join("\n"));
    assert.equal((await sqlB.unsafe(`SELECT 1 FROM invoice_documents`)).length, 0);
  });

  test("eski sürümde alınmış yedek: veri o sürümde yüklenir, sonraki migration'lar ardından uygulanır", async () => {
    const sqlC = dbs.c!.$client;
    const sqlD = dbs.d!.$client;
    const journal = readJournal();
    const at = journal.findIndex((e) => e.tag.startsWith("0018_"));
    assert.ok(at > 0 && at < journal.length - 1, "0018'den sonra migration olmalı");
    await applyMigrations(
      sqlC,
      loadMigrations()
        .map((m) => m.meta)
        .filter((m) => m.folderMillis <= journal[at].when),
    );
    await sqlC.unsafe(`
      INSERT INTO categories (name, sort_order) VALUES ('Kahve', 1);
      INSERT INTO products (category_id, name, size, price, site_menu_id, site_menu_slot) VALUES (1, 'Latte', 'M', 95, 'mnu-0001', 'M');
      INSERT INTO users (email, name, password_hash, role) VALUES ('okan@ornek.com', 'Okan', 'scrypt$x', 'admin');
      INSERT INTO push_subscriptions (user_id, endpoint, session_version) VALUES (1, 'https://push.example/2', 1);
    `);
    // O sürümde job_runs yok, push_subscriptions.orders yok
    assert.equal((await publicTables(sqlC)).includes("job_runs"), false);
    const file = join(dir, "eski.json.gz");
    await writeBackupFile(sqlC, file, { documents: true, createdBy: "Okan", app: "eski" });
    const r = await restoreBackup(sqlD, await readBackupFile(file), { wipe: false });
    assert.equal(r.fromTag, journal[at].tag);
    assert.equal(r.toTag, journal[journal.length - 1].tag);
    assert.equal(r.later, journal.length - 1 - at);
    const applied = await sqlD.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    assert.equal(applied[0].n, journal.length);
    const [p] = await sqlD.unsafe<{ name: string; price: number; site_menu_id: string }[]>(`SELECT name, price, site_menu_id FROM products`);
    assert.deepEqual({ ...p }, { name: "Latte", price: 95, site_menu_id: "mnu-0001" });
    assert.ok((await publicTables(sqlD)).includes("job_runs"));
    assert.ok((await columnsOf(sqlD, "push_subscriptions")).some((c) => c.name === "orders"));
    // Sayaç: yeni ürün kimliği eskisinin ardından
    const [{ id }] = await sqlD.unsafe<{ id: number }[]>(`INSERT INTO categories (name) VALUES ('Çay') RETURNING id`);
    assert.equal(id, 2);
  });

});
