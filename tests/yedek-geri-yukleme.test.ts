// Geri yüklemenin otomatik provası (docs/YEDEK.md › Otomatik prova), gerçek Postgres'te: yedek al → boş veritabanına
// geri yükle → her tablo aynı (dışarıda bırakılanlar hariç); dolu veritabanına --sil önce onun yedeğini alır, parolaları
// korur, sayaçları geri götürmez; yarım ya da bozuk dosya reddedilir; sayılar tutmazsa hedef olduğu gibi kalır; eski
// sürümde alınmış yedek (şubelerden önceki ay, satış, personel ve kasa satırlarıyla) yüklenip son sürüme taşınır;
// Postgres'in kendi hatası Türkçe iletiyle döner. Komut satırının hedefi: db:migrate ve db:seed kabuktaki adresi
// .env.local'dakinden önce alır (denetim AL-02, AL-03).
//
// YEDEK_TEST_DATABASE_URL verilmezse atlanır. Verilen sunucuda geçici veritabanları (laf_yedek_*_<pid>) açılıp sonunda
// silinir; adres yalnız bağlanmak için (ör. postgres://postgres:postgres@localhost/postgres).
// Çalıştırma: YEDEK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/postgres npx tsx --test tests/yedek-geri-yukleme.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const NAMES = {
  a: `laf_yedek_a_${process.pid}`,
  b: `laf_yedek_b_${process.pid}`,
  c: `laf_yedek_c_${process.pid}`,
  d: `laf_yedek_d_${process.pid}`,
  f: `laf_yedek_f_${process.pid}`,
  g: `laf_yedek_g_${process.pid}`,
};
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
      INSERT INTO branch_settings (branch_id, grp, value, secrets) VALUES ('tuzla', 'kasa.rapor', '{"recipients":["sahip@ornek.com"]}', '{"gizli":"mühürlü"}');
      INSERT INTO branch_settings (branch_id, grp, same_as) VALUES ('marina', 'kasa.rapor', 'tuzla');
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
      -- Cari: kart, faturasız alım (gideri borcun), ödeme ve iki dağıtım (borca ve faturaya); allocated sütun değeriyle gelir
      INSERT INTO expense_categories (name, section) VALUES ('Cari deneme', 'mal');
      INSERT INTO suppliers (name, key) VALUES ('Cari Deneme', 'cari deneme');
      INSERT INTO supplier_entries (supplier_id, kind, date, amount, description, cost_mode, category_id, created_by_name)
        SELECT s.id, 'borc', '2026-10-20', 600, 'beyaz peynir', 'gider', c.id, 'Okan' FROM suppliers s, expense_categories c WHERE s.key = 'cari deneme' AND c.name = 'Cari deneme';
      INSERT INTO supplier_entries (supplier_id, kind, date, amount, method, created_by_name)
        SELECT id, 'odeme', '2026-10-22', 2000, 'havale', 'Okan' FROM suppliers WHERE key = 'cari deneme';
      INSERT INTO expense_entries (date, category_id, description, amount, supplier_entry_id)
        SELECT '2026-10-20', category_id, 'Cari Deneme · beyaz peynir', 600, id FROM supplier_entries WHERE kind = 'borc';
      INSERT INTO supplier_allocations (payment_id, debt_id, amount, created_by_name)
        SELECT p.id, d.id, 600, 'Okan' FROM supplier_entries p, supplier_entries d WHERE p.kind = 'odeme' AND d.kind = 'borc';
      UPDATE invoices SET ledger_base = 0, allocated = 300 WHERE id = (SELECT min(id) FROM invoices);
      INSERT INTO supplier_allocations (payment_id, invoice_id, amount, created_by_name)
        SELECT id, (SELECT min(id) FROM invoices), 300, 'Okan' FROM supplier_entries WHERE kind = 'odeme';
      INSERT INTO integration_state (key, value) VALUES ('cari.kasa-ayri', '[]');
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
      // B'de dosyanın dışında satır yok; geri yükleme yalnız işlem geçmişine kendi satırını ve günlük işlerin izleme
      // başlangıcını (jobs.watchSince) ekler
      const added: Record<string, string> = { activity_log: "action <> 'Yedekten geri yüklendi'", integration_state: "key <> 'jobs.watchSince'" };
      const b = await fingerprint(sqlB, t, cols, added[t] ?? "TRUE");
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
    // Şube başına ayarlar: değer ve "aynı" bağı gelir, şifreli alanlar gelmez (docs/SUBE.md › Şube başına ayarlar)
    const bs = await sqlB.unsafe<{ branch_id: string; value: unknown; secrets: unknown; same_as: string | null }[]>(
      `SELECT branch_id, value, secrets, same_as FROM branch_settings ORDER BY branch_id`,
    );
    assert.deepEqual(
      bs.map((r) => ({ ...r })),
      [
        { branch_id: "marina", value: {}, secrets: null, same_as: "tuzla" },
        { branch_id: "tuzla", value: { recipients: ["sahip@ornek.com"] }, secrets: null, same_as: null },
      ],
    );
    // Günlük işlerin izlenmesi geri yükleme anından başlar (eski çalışma kayıtlarıyla yanlış "çalışmadı" alarmı olmasın)
    const [watch] = await sqlB.unsafe<{ v: string }[]>(`SELECT value #>> '{}' AS v FROM integration_state WHERE key = 'jobs.watchSince'`);
    assert.ok(Math.abs(Date.parse(watch.v) - Date.now()) < 120_000, watch.v);

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

  test("yarım, bozuk ya da yedek olmayan dosya reddedilir, hedefe dokunulmaz; tarayıcının açtığı düz .json okunur", async () => {
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
    // Tarayıcının açıp bıraktığı düz .json (Safari .gz'yi kendiliğinden açar): aynı doğrulamayla okunur
    const plain = join(dir, "laffogato-yedek-a.json");
    writeFileSync(plain, text);
    const fromPlain = await readBackupFile(plain);
    const fromGz = await readBackupFile(fileA);
    assert.deepEqual(fromPlain.header, fromGz.header);
    assert.deepEqual(fromPlain.end, fromGz.end);
    assert.deepEqual([...fromPlain.tables], [...fromGz.tables]);
    const plainHalf = join(dir, "yarim.json");
    writeFileSync(plainHalf, text.slice(0, Math.floor(text.length / 2)));
    await assert.rejects(readBackupFile(plainHalf), /Dosya eksik ya da bozuk/);
    const plainChanged = join(dir, "degismis.json");
    writeFileSync(plainChanged, text.replace("Zeynep", "Zeynap"));
    await assert.rejects(readBackupFile(plainChanged), /özet tutmuyor/);
    // Ne gzip ne yedek (ör. zip arşivi)
    const zip = join(dir, "yedek.zip");
    writeFileSync(zip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]));
    await assert.rejects(readBackupFile(zip), /Dosya eksik ya da bozuk/);
    await assert.rejects(readBackupFile(join(dir, "yok.json.gz")), /Dosya bulunamadı/);
    // Komut satırı da hedefe bağlanmadan durur
    const before = await wholeFingerprint(sqlB);
    await assert.rejects(runRestore([half, "--sil"], { log: () => {}, ask: null }, { env: {}, url: urlFor(NAMES.b) }), /Dosya eksik ya da bozuk/);
    await assert.rejects(runRestore([plainHalf, "--sil"], { log: () => {}, ask: null }, { env: {}, url: urlFor(NAMES.b) }), /Dosya eksik ya da bozuk/);
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

  test("--sil: sayaçlar hedefteki yerinin gerisine düşmez; eski bir oturumun kimliği yeni bir kişiye verilmez", async () => {
    // Yedekten sonra hedefte eklenen kişi (çerezi {sub: mehmet, sv: 1}), eklenip silinen kişi ve fatura
    const [{ id: mehmet }] = await sqlB.unsafe<{ id: number }[]>(
      `INSERT INTO users (email, name, password_hash, role, session_version) VALUES ('mehmet@ornek.com', 'Mehmet', 'scrypt$m', 'staff', 1) RETURNING id`,
    );
    const [{ id: gone }] = await sqlB.unsafe<{ id: number }[]>(`INSERT INTO users (email, name, password_hash, role) VALUES ('gecici@ornek.com', 'Geçici', 'scrypt$g', 'staff') RETURNING id`);
    await sqlB.unsafe(`DELETE FROM users WHERE id = $1`, [gone]);
    const [{ id: invoice }] = await sqlB.unsafe<{ id: number }[]>(`INSERT INTO invoices (date, supplier, category) VALUES ('2026-10-23', 'Sonradan', 'Diğer') RETURNING id`);
    const [{ max }] = await sqlA.unsafe<{ max: number }[]>(`SELECT max(id) AS max FROM users`);
    assert.ok(max < mehmet && mehmet < gone, "yedekteki en büyük kimlik hedefte sonradan verilenlerden küçük");

    await restoreBackup(sqlB, await readBackupFile(fileA), { wipe: true, safetyCopyPath: join(dir, "sayac-once.json.gz") });
    assert.equal((await sqlB.unsafe(`SELECT 1 FROM users WHERE id IN ($1, $2)`, [mehmet, gone])).length, 0);
    // Sonra eklenen kişi (varsayılan oturum sürümü 1) hedefte verilmiş hiçbir kimliği almaz: Mehmet'in eski çerezi
    // ona geçmez. Silinmiş kişinin kimliği de (en büyük kimlik değil, sayacın yeri)
    const [zeynep] = await sqlB.unsafe<{ id: number; session_version: number }[]>(
      `INSERT INTO users (email, name, password_hash, role) VALUES ('zeynep@ornek.com', 'Zeynep', 'scrypt$z', 'admin') RETURNING id, session_version`,
    );
    assert.equal(zeynep.session_version, 1);
    assert.ok(zeynep.id > gone, `${zeynep.id} > ${gone}`);
    const [{ id: next }] = await sqlB.unsafe<{ id: number }[]>(`INSERT INTO invoices (date, supplier, category) VALUES ('2026-10-23', 'Yeni', 'Diğer') RETURNING id`);
    assert.ok(next > invoice, `${next} > ${invoice}`);
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
      INSERT INTO months (month, open_days) VALUES ('2026-09', 30);
      INSERT INTO sales_lines (month, pos_name, qty, revenue) VALUES ('2026-09', 'LATTE', 3, 285);
      INSERT INTO staff (name, net_salary) VALUES ('Ayşe', 30000);
      INSERT INTO cash_reports (date, submitted_by_name) VALUES ('2026-09-30', 'Ayşe');
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
    // Şubelerden (0053, 4 Kasım 2026) önceki ay, satış, personel ve kasa satırları: 0056 şube sütununu ve kütüğe
    // yabancı anahtarı bu satırlarla kurar; varsayılan şube ondan önce yazılır (BEFORE_MIGRATION_SQL), satırlar Tuzla'nın
    const branchesOf = async (sql: Sql) => (await sql.unsafe<{ id: string; name: string }[]>(`SELECT id, name FROM branches ORDER BY id`)).map((b) => ({ ...b }));
    const branchIdsIn = async (sql: Sql, table: string) =>
      (await sql.unsafe<{ b: string }[]>(`SELECT DISTINCT branch_id AS b FROM public.${ident(table)}`)).map((r) => r.b);
    assert.deepEqual(await branchesOf(sqlD), [{ id: "tuzla", name: "Tuzla" }]);
    for (const t of ["months", "sales_lines", "staff", "cash_reports"]) assert.deepEqual(await branchIdsIn(sqlD, t), ["tuzla"], t);
    // Sayaç: yeni ürün kimliği eskisinin ardından
    const [{ id }] = await sqlD.unsafe<{ id: number }[]>(`INSERT INTO categories (name) VALUES ('Çay') RETURNING id`);
    assert.equal(id, 2);

    // Aynı eski yedek --sil ile bugünkü şemadaki bir hedefe: yedekte olmayan (sonraki migration'ın kurduğu) tablonun
    // sayacı da hedefteki yerinin gerisine düşmez
    const [{ id: run }] = await sqlD.unsafe<{ id: number }[]>(`INSERT INTO job_runs (job, status) VALUES ('gunluk', 'ok'), ('gunluk', 'ok') RETURNING id`).then((rows) => rows.slice(-1));
    await restoreBackup(sqlD, await readBackupFile(file), { wipe: true, safetyCopyPath: join(dir, "eski-once.json.gz") });
    const [{ id: nextRun }] = await sqlD.unsafe<{ id: number }[]>(`INSERT INTO job_runs (job, status) VALUES ('gunluk', 'ok') RETURNING id`);
    assert.ok(nextRun > run, `${nextRun} > ${run}`);
    // --sil ile de: hedefin bugünkü kütüğü silinir, şubesiz eski satırlar yine Tuzla'ya düşer
    assert.deepEqual(await branchesOf(sqlD), [{ id: "tuzla", name: "Tuzla" }]);
    for (const t of ["months", "sales_lines", "staff", "cash_reports"]) assert.deepEqual(await branchIdsIn(sqlD, t), ["tuzla"], t);
    const [{ id: cat }] = await sqlD.unsafe<{ id: number }[]>(`INSERT INTO categories (name) VALUES ('Soğuk') RETURNING id`);
    assert.equal(cat, 3, "Çay'ın (2) kimliği yeniden verilmez");
  });

  test("Postgres'in hatası Türkçe iletiyle döner, işlem geri alınır", async () => {
    const before = await wholeFingerprint(sqlB);
    const dup = await readBackupFile(fileA);
    const cats = dup.tables.get("categories")!;
    cats.rows.push(cats.rows[0]);
    dup.end.tables.categories += 1;
    await assert.rejects(
      restoreBackup(sqlB, dup, { wipe: true, safetyCopyPath: join(dir, "pg-hata-once.json.gz") }),
      (e: Error) => e instanceof RestoreError && /^Geri yükleme geri alındı, hedef değişmedi: duplicate key value/.test(e.message),
    );
    assert.equal(await wholeFingerprint(sqlB), before);
  });

  test("komut satırı: db:migrate ve db:seed kabuktaki adrese yazar, hedefi söyler; boş havuzsuz adres yok sayılır", async () => {
    // Ayrı bir klasörde çalışır: .env.local o klasörün (Neon entegrasyonu ve "vercel env pull" iki adresi de yazar)
    const ws = mkdtempSync(join(tmpdir(), "laf-komut-"));
    try {
      for (const f of ["drizzle", "node_modules", "package.json", "src", "tsconfig.json"]) symlinkSync(join(process.cwd(), f), join(ws, f));
      // Testin kendi ortamındaki adresler ve NODE_ENV (test'te .env.local okunmaz) alt sürece geçmez
      const drop = new Set(["DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL", "ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_NAME", "NODE_ENV"]);
      const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !drop.has(k)));
      const run = (script: string, envLocal: string, shell: Record<string, string>) => {
        writeFileSync(join(ws, ".env.local"), envLocal);
        const r = spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", script)], {
          cwd: ws,
          encoding: "utf8",
          env: { ...base, ...shell } as NodeJS.ProcessEnv,
          timeout: 180_000,
        });
        assert.equal(r.status, 0, `${script}: ${r.stdout}\n${r.stderr}`);
        return r.stdout;
      };
      const tables = async (k: "f" | "g") => (await publicTables(dbs[k]!.$client)).length;
      const local = `DATABASE_URL=${urlFor(NAMES.f)}\nDATABASE_URL_UNPOOLED=${urlFor(NAMES.f)}\n`;

      // .env.local'da F (havuzsuz dahil), kabukta yalnız DATABASE_URL=G: ikisi de G'ye gider, F'ye dokunulmaz
      assert.ok(run("migrate.ts", local, { DATABASE_URL: urlFor(NAMES.g) }).includes(`Hedef: localhost/${NAMES.g} (bu bilgisayar)`));
      assert.ok((await tables("g")) > 0);
      assert.equal(await tables("f"), 0);
      const seeded = run("seed.ts", local, { DATABASE_URL: urlFor(NAMES.g) });
      assert.ok(seeded.includes(`Hedef: localhost/${NAMES.g} (bu bilgisayar)`), seeded);
      assert.match(seeded, /✓ Excel verisi yüklendi/);
      const [{ n }] = await dbs.g!.$client.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ingredients`);
      assert.ok(n > 0);
      assert.equal(await tables("f"), 0);

      // Eski .env.example kopyası: havuzsuz satır boş, kabukta adres yok. "DATABASE_URL tanımlı değil" demez, F'yi kurar
      assert.ok(run("migrate.ts", `DATABASE_URL=${urlFor(NAMES.f)}\nDATABASE_URL_UNPOOLED=\n`, {}).includes(`Hedef: localhost/${NAMES.f}`));
      assert.ok((await tables("f")) > 0);
      // Örnek dosyada boş satır yok (yorumlu)
      assert.doesNotMatch(readFileSync(join(process.cwd(), ".env.example"), "utf8"), /^DATABASE_URL_UNPOOLED=/m);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
