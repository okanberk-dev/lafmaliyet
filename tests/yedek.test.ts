// Tam yedek (docs/YEDEK.md): dosya biçimi ve doğrulaması, neyin dosyaya girmediği (gizli görünen her sütun ve durum
// anahtarı ya dışarıda ya da gizli olmadığı burada yazılı), yükleme sırası, şema sürümü, kullanıcıların giriş
// bilgileri, dosya adı, 30 günlük hatırlatma ve komut satırının hedef seçimi. Saf; veritabanıyla gidip gelen prova
// tests/yedek-geri-yukleme.test.ts'te.
// Çalıştırma: npx tsx --test tests/yedek.test.ts

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import { parseRestoreArgs } from "../scripts/restore";
import {
  BACKUP_FORMAT,
  BACKUP_HREF,
  BACKUP_VERSION,
  backupAgeDays,
  backupCardSummary,
  backupDue,
  backupFileName,
  backupReminder,
  backupSchemaPlan,
  backupSummaryText,
  BEFORE_MIGRATION_SQL,
  databaseTarget,
  databaseUrl,
  documentsDownloadBytes,
  documentsTooBigText,
  encodeLine,
  EXCLUDED_STATE_KEYS,
  excludedFor,
  lastBackupText,
  mergeUserRows,
  nextDataBytes,
  orderTables,
  PANEL_DOCUMENTS_MAX_BYTES,
  rowLine,
  TABLE_RULES,
  type BackupHeader,
  type LastBackup,
  type SavedCredentials,
} from "../src/lib/backup/format";
import { DEFAULT_BRANCH_ID } from "../src/lib/branches";
import { jobHealth, systemAlerts, type JobKey } from "../src/lib/job-health";
import { backupStream, type BackupSummary } from "../src/server/backup/core";
import { beforeMigrationSql, loadMigrations, parseBackupLines } from "../src/server/backup/restore";
import * as schema from "../src/server/db/schema";

const tr = (s: string) => new Date(`${s.replace(" ", "T")}:00+03:00`);

// ---------------------------------------------------------------- Dosya satırları ve doğrulama

function header(over: Partial<BackupHeader> = {}): BackupHeader {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: "2026-10-22T06:15:03.120Z",
    createdBy: "Okan",
    app: "yerel",
    documents: false,
    migrations: [{ hash: "h", createdAt: 1 }],
    excluded: excludedFor(["users"], false),
    ...over,
  };
}

/** Yazıcının ürettiği gibi: satırlar + sha256'lı son satır */
function file(lines: string[]): string {
  const hash = createHash("sha256");
  for (const l of lines) hash.update(l, "utf8");
  const tables: Record<string, number> = {};
  let current = "";
  let rows = 0;
  for (const l of lines) {
    const v = JSON.parse(l) as { table?: string; r?: unknown };
    if (v.table) tables[(current = v.table)] = 0;
    else if (v.r) {
      tables[current]++;
      rows++;
    }
  }
  return lines.join("") + encodeLine({ end: { tables, rows, sha256: hash.digest("hex") } });
}

const SAMPLE = [
  encodeLine(header()),
  encodeLine({ table: "categories", columns: ["id", "name"] }),
  rowLine('{"id":1,"name":"Kahve"}'),
  rowLine('{"id":2,"name":"Çay \\"demli\\"\\nsatır"}'),
  encodeLine({ table: "settings", columns: ["key", "value"] }),
  rowLine('{"key":"bos","value":null}'),
];

const parse = (text: string) => parseBackupLines(text.split("\n"));

test("satırlar: başlık, tablo ve satırlar okunur; satırın JSON metni olduğu gibi kalır", async () => {
  const b = await parse(file(SAMPLE));
  assert.equal(b.header.createdBy, "Okan");
  assert.deepEqual([...b.tables.keys()], ["categories", "settings"]);
  assert.deepEqual(b.tables.get("categories")!.columns, ["id", "name"]);
  assert.deepEqual(b.tables.get("categories")!.rows, ['{"id":1,"name":"Kahve"}', '{"id":2,"name":"Çay \\"demli\\"\\nsatır"}']);
  assert.deepEqual(JSON.parse(b.tables.get("settings")!.rows[0]), { key: "bos", value: null });
  assert.deepEqual(b.end.tables, { categories: 2, settings: 1 });
  assert.equal(b.end.rows, 3);
});

test("satırlar: son satır eksik, bir satır düşmüş ya da bir bayt değişmişse dosya reddedilir", async () => {
  const good = file(SAMPLE);
  const lines = good.split("\n");
  // Son satır yok (indirme yarıda kesildi)
  await assert.rejects(parse(lines.slice(0, -2).join("\n") + "\n"), /Dosya eksik ya da bozuk.*son satır yok/);
  // Son veri satırı düşmüş, son satır yerinde: özet tutmaz
  await assert.rejects(parse([...lines.slice(0, 5), ...lines.slice(6)].join("\n")), /özet tutmuyor/);
  // Bir bayt değişmiş
  await assert.rejects(parse(good.replace("Kahve", "Kahva")), /özet tutmuyor/);
  // Son satırdan sonra veri, ortada boş satır
  await assert.rejects(parse(`${good}${rowLine('{"id":3}')}`), /son satırdan sonra veri var/);
  await assert.rejects(parse(good.replace(rowLine('{"id":1,"name":"Kahve"}'), `${rowLine('{"id":1,"name":"Kahve"}')}\n`)), /satır boş/);
  // Boş dosya
  await assert.rejects(parse(""), /dosya boş/);
});

test("satırlar: başka bir dosya ya da yeni biçim okunmaz", async () => {
  await assert.rejects(parse(file([encodeLine({ ...header(), format: "baska" })])), /Bu dosya bir L'Affogato yedeği değil/);
  await assert.rejects(parse(file([encodeLine({ ...header(), version: 2 })])), /Bu yedek biçimi \(sürüm 2\) bu kodla okunamıyor; kodu güncelleyin\./);
});

test("satırlar: tablo sayısı son satırla tutmalı", async () => {
  const lines = [...SAMPLE];
  const text = file(lines);
  // Son satırdaki sayıyı değiştir (özet satırların özeti, son satırı kapsamaz)
  const tampered = text.replace('"categories":2', '"categories":3');
  await assert.rejects(parse(tampered), /categories tablosunun satır sayısı tutmuyor/);
  const missing = text.replace('"settings":1', '"settings":1,"users":0');
  await assert.rejects(parse(missing), /bir tablo eksik/);
});

// ---------------------------------------------------------------- Neler dosyaya girmez (R6: şemadan sınanır)

/** Adı gizli bir değer taşıyormuş gibi görünen tablo, sütun ve durum anahtarı. IBAN gizli değil: dosyada kalır */
const SECRET_NAME = /password|secret|token|hash|totp|recovery|vapid|key|p256dh|^auth$/i;

/** Adı benziyor ama gizli değil: neden. Yeni bir şey buraya ancak gizli olmadığı gerçekten bilinince eklenir */
const NOT_SECRET: Record<string, string> = {
  "settings.key": "ayarın adı",
  "integration_state.key": "durum anahtarının adı (gizli değerli anahtarlar EXCLUDED_STATE_KEYS'te)",
  "suppliers.key": "tedarikçi adının eşleşme anahtarı",
  "notification_log.key": "aynı bildirimin iki kez gitmemesi için anahtar",
  "lafpos_day_ends.day_hash": "LafPOS gün sonunun içerik özeti (aynı içerik e-postası yinelenmesin; gizli değer değil)",
  "lafpos_day_ends.emailed_hash": "e-postası giden gün sonunun içerik özeti (gizli değer değil)",
  "parasut_bill_lines.product_key": "Paraşüt ürününün adından anahtar",
  "parasut_product_links.product_key": "Paraşüt ürününün adından anahtar",
  "ingredient_price_holds.product_key": "Paraşüt ürününün adından anahtar (onay bekleyen fiyatın ürünü)",
  "invoice_readings.product_key": "Paraşüt ürününün adından anahtar (okunan fatura kalemi)",
  "pnl_entries.row_key": "gelir-gider tablosundaki satırın adı",
  "photos.storage_key": "özel Blob deposundaki dosyanın yolu; okumak için BLOB_READ_WRITE_TOKEN gerekir",
  "staff_requests.client_key": "personel isteğinin çift dokunuşa karşı istemcide üretilen kimliği",
  "ai_calls.input_tokens": "token sayısı",
  "ai_calls.output_tokens": "token sayısı",
  "ai_calls.cache_read_tokens": "token sayısı",
  "ai_calls.cache_write_tokens": "token sayısı",
};

/** Durum anahtarları (integration_state.key) için aynısı */
const NOT_SECRET_STATE_KEYS: Record<string, string> = {};

const tables = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .map((t) => getTableConfig(t));

test("yedek dışı: adı gizli görünen her tablo ve sütun ya dışarıda ya da gizli olmadığı yazılı", () => {
  assert.ok(tables.length >= 40, "şemadaki tablolar okunamadı");
  const problems: string[] = [];
  for (const t of tables) {
    const rule = TABLE_RULES[t.name];
    if (rule?.skip) continue;
    if (SECRET_NAME.test(t.name) && !NOT_SECRET[t.name]) problems.push(`${t.name} (tablo)`);
    for (const c of t.columns) {
      const id = `${t.name}.${c.name}`;
      if (!SECRET_NAME.test(c.name) || rule?.dropColumns?.includes(c.name) || NOT_SECRET[id]) continue;
      problems.push(id);
    }
  }
  assert.deepEqual(problems, [], "src/lib/backup/format.ts › TABLE_RULES'a ekleyin ya da gizli değilse bu testteki NOT_SECRET'a nedeniyle yazın");
});

test("yedek dışı: kurallar şemada var olan tablo ve sütunları gösterir; izin listesi bayatlamamış", () => {
  const byName = new Map(tables.map((t) => [t.name, new Set(t.columns.map((c) => c.name))]));
  for (const [name, rule] of Object.entries(TABLE_RULES)) {
    assert.ok(byName.has(name), `TABLE_RULES › ${name}: şemada yok`);
    for (const c of rule.dropColumns ?? []) assert.ok(byName.get(name)!.has(c), `${name}.${c}: şemada yok`);
  }
  for (const id of Object.keys(NOT_SECRET)) {
    const [t, c] = id.split(".");
    assert.ok(byName.get(t)?.has(c), `NOT_SECRET › ${id}: şemada yok`);
  }
  // Parola özeti, iki adımlı anahtar, kurtarma kodları, tek kullanımlık bağlantılar ve cihaz anahtarları
  assert.deepEqual([...TABLE_RULES.users.dropColumns!].sort(), [
    "failed_logins",
    "locked_until",
    "password_hash",
    "recovery_codes",
    "session_version",
    "totp_enabled",
    "totp_last_step",
    "totp_secret",
  ]);
  assert.ok(TABLE_RULES.user_tokens.skip && TABLE_RULES.push_subscriptions.skip);
  // IBAN ve vergi numarası dosyada (sahibin kendi kaydı); karaoke müşterisinin yalnız adı da
  assert.ok(byName.get("suppliers")!.has("iban") && !TABLE_RULES.suppliers);
  assert.ok(byName.get("karaoke_sessions")!.has("customer_name") && !TABLE_RULES.karaoke_sessions);
});

/** Kodun integration_state'e yazdığı anahtarlar: o tabloya dokunan dosyalardaki ...KEY / ...PREFIX sabitleri ve düz metinler */
function stateKeysInCode(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  for (const path of [...walk(join(process.cwd(), "src")), ...walk(join(process.cwd(), "scripts"))]) {
    const text = readFileSync(path, "utf8");
    if (!/integrationState|integration_state/.test(text)) continue;
    for (const m of text.matchAll(/\b[A-Z0-9_]*(?:KEY|PREFIX)\s*=\s*["'`]([a-zA-Z][\w.:-]*)["'`]/g)) found.set(m[1], path);
    for (const m of text.matchAll(/integrationState\.key,\s*["']([^"']+)["']/g)) found.set(m[1], path);
  }
  return found;
}

test("yedek dışı: adı gizli görünen her durum anahtarı (integration_state) ya dışarıda ya da gizli olmadığı yazılı", () => {
  const keys = stateKeysInCode();
  // Tarama işe yarıyor mu: bilinen anahtarlar bulunmalı
  for (const k of ["parasut.token", "webpush_vapid", "site_orders", "parasut.cursor", "notify.settings", "backup.last", "jobs.watchSince"]) {
    assert.ok(keys.has(k), `${k}: kodda bulunamadı (tarama bozuk)`);
  }
  for (const k of Object.keys(EXCLUDED_STATE_KEYS)) assert.ok(keys.has(k), `EXCLUDED_STATE_KEYS › ${k}: kodda artık yok`);
  const problems = [...keys.keys()].filter((k) => SECRET_NAME.test(k) && !EXCLUDED_STATE_KEYS[k] && !NOT_SECRET_STATE_KEYS[k]);
  assert.deepEqual(problems, [], "src/lib/backup/format.ts › EXCLUDED_STATE_KEYS'e ekleyin ya da gizli değilse bu testteki NOT_SECRET_STATE_KEYS'e yazın");
});

test("yedek dışı: Paraşüt belirteci, bildirim anahtarı ve uygulama siparişlerinin müşteri adları dosyaya yazılmaz", () => {
  assert.deepEqual(Object.keys(EXCLUDED_STATE_KEYS).sort(), ["parasut.legacyToken", "parasut.token", "site_orders", "webpush_vapid"]);
  assert.equal(TABLE_RULES.integration_state.where, "key NOT IN ('parasut.token', 'parasut.legacyToken', 'webpush_vapid', 'site_orders')");
  // Paraşüt'ün PDF'i önbellek: yalnız yüklenenler, onlar da yalnız istenince
  assert.equal(TABLE_RULES.invoice_documents.where, "source = 'upload'");
  assert.equal(TABLE_RULES.invoice_documents.documents, true);
  const withDocs = excludedFor(["invoice_documents", "push_subscriptions", "user_tokens", "users"], true);
  assert.deepEqual(withDocs.tables, ["push_subscriptions", "user_tokens"]);
  assert.equal(withDocs.documents, "parasut-onbellek");
  const noDocs = excludedFor(["invoice_documents", "push_subscriptions", "user_tokens", "users"], false);
  assert.deepEqual(noDocs.tables, ["invoice_documents", "push_subscriptions", "user_tokens"]);
  assert.equal(noDocs.documents, "hepsi");
  assert.deepEqual(Object.keys(noDocs.columns), ["users"]);
  assert.deepEqual(noDocs.stateKeys, ["parasut.token", "parasut.legacyToken", "webpush_vapid", "site_orders"]);
});

test("panelden belgeli yedek en çok 4 MB (Vercel'in yanıt sınırı canlıda doğrulanana kadar)", () => {
  assert.equal(PANEL_DOCUMENTS_MAX_BYTES, 4 * 1024 * 1024);
});

test("panelden belgeli yedek: sınır dosyanın tahmini boyutuna bakar (belgeler ~%10 büyür, üstüne veri)", () => {
  const MB = 1024 * 1024;
  const known = { dataBytes: 300 * 1024 };
  assert.equal(documentsDownloadBytes(2 * MB, known), Math.ceil(2.2 * MB) + 300 * 1024);
  assert.ok(documentsDownloadBytes(2 * MB, known) <= PANEL_DOCUMENTS_MAX_BYTES);
  // Belgelerin ham toplamı sınırın altında ama dosya aşar: 3,6 MB belge ~3,96 MB olur, üstüne 300 KB veri
  assert.ok(3.6 * MB < PANEL_DOCUMENTS_MAX_BYTES && documentsDownloadBytes(3.6 * MB, known) > PANEL_DOCUMENTS_MAX_BYTES);
  assert.ok(documentsDownloadBytes(4 * MB, { dataBytes: 0 }) > PANEL_DOCUMENTS_MAX_BYTES);
  // Verinin payı bilinmiyorsa (panelden henüz belgesiz yedek alınmadı) 1 MB sayılır
  assert.equal(documentsDownloadBytes(MB, null), Math.ceil(1.1 * MB) + MB);
  assert.equal(documentsDownloadBytes(MB, {}), Math.ceil(1.1 * MB) + MB);
  // Kayıttaki pay: belgesiz yedekte dosyanın boyutu; belgeli yedekte ayrılamaz, öncekinden taşınır
  assert.equal(nextDataBytes(false, 31_000, { dataBytes: 20_000 }), 31_000);
  assert.equal(nextDataBytes(true, 2_900_000, { dataBytes: 31_000 }), 31_000);
  assert.equal(nextDataBytes(true, 2_900_000, null), undefined);
  // Sıkışmayan bir belge (fotoğraf gibi rastgele baytlar) dosyada gerçekten tahminden az yer tutar
  const raw = randomBytes(512 * 1024);
  const line = rowLine(JSON.stringify({ id: 1, invoice_id: 1, data: `\\x${raw.toString("hex")}` }));
  assert.ok(gzipSync(line).length <= documentsDownloadBytes(raw.length, { dataBytes: 0 }));
  assert.equal(documentsTooBigText(4.6 * MB), "Belgelerle yedek yaklaşık 4,6\u00a0MB olur, panelden en çok 4\u00a0MB iner");
});

// ---------------------------------------------------------------- Yükleme sırası

test("yükleme sırası: şemadaki her tablo, başvurduğu tablolardan sonra", () => {
  const edges = tables.flatMap((t) => t.foreignKeys.map((fk) => ({ child: t.name, parent: getTableConfig(fk.reference().foreignTable).name })));
  assert.ok(edges.length >= 20);
  const order = orderTables(tables.map((t) => t.name), edges);
  assert.deepEqual([...order].sort(), tables.map((t) => t.name).sort());
  const at = new Map(order.map((n, i) => [n, i]));
  for (const e of edges) if (e.child !== e.parent) assert.ok(at.get(e.parent)! < at.get(e.child)!, `${e.parent} → ${e.child}`);
  // Aynı girdi aynı sıra (alfabe sırası bağı çözer)
  assert.deepEqual(orderTables([...tables.map((t) => t.name)].reverse(), [...edges].reverse()), order);
});

test("yükleme sırası: kendine başvuru yok sayılır, döngüde kalanlar alfabe sırasıyla sona", () => {
  assert.deepEqual(orderTables(["b", "a"], [{ child: "a", parent: "a" }]), ["a", "b"]);
  assert.deepEqual(orderTables(["a", "b", "c"], [{ child: "a", parent: "c" }]), ["b", "c", "a"]);
  assert.deepEqual(
    orderTables(["x", "y", "z"], [
      { child: "x", parent: "y" },
      { child: "y", parent: "x" },
    ]),
    ["z", "x", "y"],
  );
  // Listede olmayan tabloya giden kenar sırayı etkilemez
  assert.deepEqual(orderTables(["a"], [{ child: "a", parent: "yok" }]), ["a"]);
});

// ---------------------------------------------------------------- Şema sürümü

const JOURNAL = [
  { when: 100, tag: "0000_ilk" },
  { when: 200, tag: "0001_iki" },
  { when: 300, tag: "0002_uc" },
];
const applied = (...whens: number[]) => whens.map((w) => ({ hash: `h${w}`, createdAt: w }));

test("şema sürümü: aynı sürüm, eski sürüm (kalanlar veriden sonra), daha yeni sürüm reddedilir", () => {
  assert.deepEqual(backupSchemaPlan(applied(100, 200, 300), JOURNAL), {
    error: null,
    upTo: 300,
    fromTag: "0002_uc",
    toTag: "0002_uc",
    later: 0,
    unknown: [],
    missing: [],
  });
  const older = backupSchemaPlan(applied(100, 200), JOURNAL);
  assert.equal(older.error, null);
  if (older.error === null) {
    assert.equal(older.upTo, 200);
    assert.equal(older.later, 1);
    assert.equal(older.fromTag, "0001_iki");
    assert.equal(older.toTag, "0002_uc");
  }
  assert.deepEqual(backupSchemaPlan(applied(100, 200, 300, 400), JOURNAL), {
    error: "Yedek bu koddan daha yeni bir sürümle alınmış: önce kodu güncelleyin (git pull).",
  });
});

test("şema sürümü: günlükte olmayan kayıt uyarı, kaynakta atlanmış migration veriden önce", () => {
  // 150: bir önizlemenin uyguladığı kayıt (21 Eki 2026'daki gibi)
  const orphan = backupSchemaPlan(applied(100, 150, 200, 300), JOURNAL);
  assert.ok(orphan.error === null && orphan.upTo === 300);
  if (orphan.error === null) assert.deepEqual(orphan.unknown, [150]);
  const skipped = backupSchemaPlan(applied(100, 300), JOURNAL);
  if (skipped.error !== null) assert.fail(skipped.error);
  assert.deepEqual(skipped.missing, ["0001_iki"]);
  assert.equal(skipped.later, 0);
  assert.match(backupSchemaPlan([], JOURNAL).error ?? "", /şema sürümü \(migration kaydı\) yok/);
  assert.match(backupSchemaPlan(applied(150), JOURNAL).error ?? "", /günlüğünde yok/);
  assert.match(backupSchemaPlan(applied(100), []).error ?? "", /günlüğü yok/);
});

test("şema sürümü: dolu tabloda takılan migration'dan önce ek adım; 0056'dan önce varsayılan şube (0057'deki satırın aynısı)", () => {
  const migrations = loadMigrations();
  // Ad yanlış yazılırsa adım sessizce çalışmazdı
  for (const tag of Object.keys(BEFORE_MIGRATION_SQL)) assert.ok(migrations.some((m) => m.tag === tag), `${tag} günlükte yok`);
  const m56 = migrations.find((m) => m.tag === "0056_sube_kirilimi")!;
  const before = beforeMigrationSql(migrations);
  assert.deepEqual([...before.keys()], [m56.meta.folderMillis]);
  // 0056 var olan satırları 'tuzla'ya yazıp kütüğe yabancı anahtar kurar: 0053'ten önceki bir yedekte ay, satış,
  // personel satırı varken kütükte 'tuzla' yoksa geri yükleme yabancı anahtar hatasıyla geri alınırdı
  const sql56 = m56.meta.sql.join("\n");
  assert.match(sql56, /ALTER TABLE "months" ADD COLUMN "branch_id" text DEFAULT 'tuzla' NOT NULL/);
  assert.match(sql56, /"months_branch_id_branches_id_fk" FOREIGN KEY \("branch_id"\) REFERENCES "public"\."branches"\("id"\)/);
  const [stmt, ...others] = before.get(m56.meta.folderMillis)!;
  assert.equal(others.length, 0);
  assert.match(stmt, new RegExp(`^INSERT INTO "branches" .* VALUES \\('${DEFAULT_BRANCH_ID}', `));
  assert.match(stmt, /ON CONFLICT \("id"\) DO NOTHING;$/, "var olan kayda dokunmaz; 0057 aynı satırı yeniden dener");
  const sql57 = readFileSync(join(process.cwd(), "drizzle", "0057_sabit_gider_subesi.sql"), "utf8");
  assert.ok(sql57.includes(stmt), "0057'deki satırın aynısı: sonuç 0057'ninkiyle aynı");
});

// ---------------------------------------------------------------- Kullanıcıların giriş bilgileri

const INVITE = "!davet-bekliyor";
const cred = (email: string, sv: number, over: Partial<SavedCredentials> = {}): SavedCredentials => ({
  email,
  password_hash: `scrypt$${email}`,
  totp_secret: "gizli",
  totp_enabled: true,
  totp_last_step: 7,
  recovery_codes: ["a"],
  session_version: sv,
  ...over,
});
const user = (id: number, email: string, over: Record<string, unknown> = {}) => ({ id, email, name: email.split("@")[0], role: "staff", active: true, ...over });

test("kullanıcılar: aynı e-posta (büyük/küçük harf farksız) parolasını ve iki adımlısını korur; herkesin oturumu kapanır", () => {
  const m = mergeUserRows([user(1, "Okan@Ornek.com", { role: "admin" }), user(2, "ayse@ornek.com")], [cred("okan@ornek.com", 4), cred("baska@ornek.com", 9)], {
    inviteHash: INVITE,
    maxSv: 9,
  });
  assert.equal(m.rows[0].password_hash, "scrypt$okan@ornek.com");
  assert.equal(m.rows[0].totp_secret, "gizli");
  assert.equal(m.rows[0].totp_enabled, true);
  assert.equal(m.rows[0].totp_last_step, 7);
  assert.deepEqual(m.rows[0].recovery_codes, ["a"]);
  // Hedefteki en büyük sürümün bir fazlası: hiçbir eski çerez (başka kişinin satırında da) geçmez
  assert.deepEqual(
    m.rows.map((r) => r.session_version),
    [10, 10],
  );
  assert.equal(m.rows[0].failed_logins, 0);
  assert.equal(m.rows[0].locked_until, null);
  // Eşleşmeyen: davet bekliyor, iki adımlı kapalı
  assert.equal(m.rows[1].password_hash, INVITE);
  assert.equal(m.rows[1].totp_enabled, false);
  assert.equal(m.rows[1].totp_secret, null);
  assert.equal(m.rows[1].recovery_codes, null);
  assert.deepEqual(m.kept, ["Okan"]);
  assert.deepEqual(m.invited, ["ayse"]);
  assert.equal(m.newAdmin, null);
  assert.equal(m.admin, null);
  // Rol, ad, aktiflik yedektekidir
  assert.equal(m.rows[0].role, "admin");
  assert.equal(m.rows[1].name, "ayse");
});

test("kullanıcılar: hedefte de davet bekleyen kişinin korunan parolası yok", () => {
  const m = mergeUserRows([user(1, "a@x.com"), user(2, "b@x.com", { active: false })], [cred("a@x.com", 1, { password_hash: INVITE }), cred("b@x.com", 1, { password_hash: INVITE })], {
    inviteHash: INVITE,
    maxSv: 1,
  });
  assert.deepEqual(m.kept, []);
  assert.deepEqual(m.invited, ["a"]);
  // Yönetici davet bekliyorsa kimse yönetici olarak giremez: canlıda da ADMIN_* kullanılır
  const admin = { email: "admin@laffogato.net", hash: "scrypt$a", name: "Yönetici" };
  const locked = mergeUserRows([user(1, "a@x.com", { role: "admin" })], [cred("a@x.com", 1, { password_hash: INVITE })], { inviteHash: INVITE, maxSv: 1, admin, mode: "lockout" });
  assert.equal(locked.admin, "admin@laffogato.net");
});

test("kullanıcılar: boş hedefte herkes davet bekler; pasif kişi bağlantı listesine girmez", () => {
  const m = mergeUserRows([user(1, "a@x.com"), user(2, "b@x.com", { active: false })], [], { inviteHash: INVITE, maxSv: 0 });
  assert.deepEqual(
    m.rows.map((r) => [r.password_hash, r.session_version]),
    [
      [INVITE, 1],
      [INVITE, 1],
    ],
  );
  assert.deepEqual(m.invited, ["a"]);
});

test("kullanıcılar: ADMIN_EMAIL boş ya da yerel hedefte o kişinin parolasıdır, yedekte yoksa yönetici eklenir", () => {
  const admin = { email: " Okan@Ornek.com ", hash: "scrypt$yeni", name: "Okan" };
  const m = mergeUserRows([user(1, "okan@ornek.com", { role: "staff", active: false }), user(2, "ayse@ornek.com")], [cred("okan@ornek.com", 2)], {
    inviteHash: INVITE,
    maxSv: 2,
    admin,
    mode: "always",
  });
  assert.equal(m.rows[0].password_hash, "scrypt$yeni");
  // Yönetici olarak girebilsin
  assert.equal(m.rows[0].role, "admin");
  assert.equal(m.rows[0].active, true);
  assert.equal(m.admin, "okan@ornek.com");
  assert.equal(m.newAdmin, null);
  assert.deepEqual(m.kept, []);
  assert.deepEqual(m.invited, ["ayse"]);

  const created = mergeUserRows([user(1, "ayse@ornek.com")], [], { inviteHash: INVITE, maxSv: 0, admin: { email: "admin@laffogato.net", hash: "scrypt$a", name: "Yönetici" } });
  assert.deepEqual(created.newAdmin, {
    email: "admin@laffogato.net",
    name: "Yönetici",
    password_hash: "scrypt$a",
    role: "admin",
    active: true,
    totp_enabled: false,
    session_version: 1,
  });
  assert.equal(created.admin, "admin@laffogato.net");
});

test("kullanıcılar: dolu canlı hedefte ADMIN_* yalnız hiçbir yönetici giremeyecekse kullanılır", () => {
  const admin = { email: "admin@laffogato.net", hash: "scrypt$yerel", name: "Yönetici" };
  const rows = [user(1, "okan@ornek.com", { role: "admin" }), user(2, "ayse@ornek.com")];
  // Sahibin parolası korunuyor: geliştiricinin yerel yönetici hesabı canlıya eklenmez
  const kept = mergeUserRows(rows, [cred("okan@ornek.com", 3)], { inviteHash: INVITE, maxSv: 3, admin, mode: "lockout" });
  assert.equal(kept.newAdmin, null);
  assert.equal(kept.admin, null);
  assert.equal(kept.rows[0].password_hash, "scrypt$okan@ornek.com");
  // ADMIN_EMAIL korunan yöneticinin kendisiyse bugünkü parolası da değişmez
  const same = mergeUserRows(rows, [cred("okan@ornek.com", 3)], { inviteHash: INVITE, maxSv: 3, admin: { ...admin, email: "okan@ornek.com" }, mode: "lockout" });
  assert.equal(same.rows[0].password_hash, "scrypt$okan@ornek.com");
  assert.equal(same.admin, null);
  // Yöneticinin parolası korunamadı (e-posta hedefte yok, ya da yönetici pasif): kimse giremezdi, ADMIN_* kullanılır
  const locked = mergeUserRows(rows, [cred("ayse@ornek.com", 3)], { inviteHash: INVITE, maxSv: 3, admin, mode: "lockout" });
  assert.equal(locked.admin, "admin@laffogato.net");
  assert.equal(locked.newAdmin?.password_hash, "scrypt$yerel");
  const inactive = mergeUserRows([user(1, "okan@ornek.com", { role: "admin", active: false })], [cred("okan@ornek.com", 3)], {
    inviteHash: INVITE,
    maxSv: 3,
    admin,
    mode: "lockout",
  });
  assert.ok(inactive.newAdmin);
});

// ---------------------------------------------------------------- Dosya adı, hatırlatma, metinler

test("dosya adı İstanbul saatiyle; geri yükleme öncesi kopya sunucu adını taşır", () => {
  assert.equal(backupFileName(new Date("2026-10-22T06:15:00Z")), "laffogato-yedek-2026-10-22-0915.json.gz");
  // UTC'de hâlâ 22'si, İstanbul'da 23'ü
  assert.equal(backupFileName(new Date("2026-10-22T22:30:00Z")), "laffogato-yedek-2026-10-23-0130.json.gz");
  assert.equal(
    backupFileName(new Date("2026-10-22T06:15:00Z"), { host: "ep-cool-1.eu-central-1.aws.neon.tech" }),
    "laffogato-yedek-once-ep-cool-1.eu-central-1.aws.neon.tech-2026-10-22-0915.json.gz",
  );
  assert.equal(backupFileName(new Date("2026-10-22T06:15:00Z"), { host: "/var/run/postgresql" }), "laffogato-yedek-once-_var_run_postgresql-2026-10-22-0915.json.gz");
});

test("hatırlatma: 29 gün sessiz, 30 gün ve hiç yedek yoksa zilde; kimlik son yedeğin gününden", () => {
  const now = tr("2026-10-22 10:00");
  assert.equal(backupReminder(tr("2026-09-23 23:30").toISOString(), now), null);
  assert.equal(backupDue(tr("2026-09-23 09:00").toISOString(), now), false);
  assert.deepEqual(backupReminder(tr("2026-09-22 08:00").toISOString(), now), {
    id: "yedek-2026-09-22",
    title: "Yedek almayalı 30 gün oldu",
    body: "Ayarlar › Yedek › Yedeği indir; dosyayı bilgisayarınızda ya da Drive'da saklayın.",
  });
  assert.deepEqual(backupReminder(null, now), {
    id: "yedek-yok",
    title: "Henüz yedek indirilmedi",
    body: "Ayarlar › Yedek › Yedeği indir; dosyayı bilgisayarınızda ya da Drive'da saklayın.",
  });
  // Gün İstanbul'a göre: 21 Eki 23:30 TR (UTC'de 20:30) dünden sayılır
  assert.equal(backupAgeDays(tr("2026-10-21 23:30").toISOString(), now), 1);
  assert.equal(backupAgeDays(tr("2026-10-22 00:10").toISOString(), now), 0);
});

const health = (now: Date): Record<JobKey, ReturnType<typeof jobHealth>> => ({
  parasut: jobHealth("parasut", [], now, { watchSince: null }),
  gunluk: jobHealth("gunluk", [], now, { watchSince: null }),
});

test("hatırlatma: sistem uyarılarına 'info' olarak, yalnız canlıda ve en sonda; verilmezse yok", () => {
  const now = tr("2026-10-22 10:00");
  const base = { cronSecret: true, now, health: health(now), parasutSyncErrorAt: null };
  assert.deepEqual(systemAlerts({ ...base, production: false, lastBackupAt: null }), []);
  assert.deepEqual(systemAlerts({ ...base, production: true }), []);
  assert.deepEqual(systemAlerts({ ...base, production: true, lastBackupAt: tr("2026-10-20 09:00").toISOString() }), []);
  const never = systemAlerts({ ...base, production: true, lastBackupAt: null });
  assert.deepEqual(never, [
    {
      id: "yedek-yok",
      level: "info",
      title: "Henüz yedek indirilmedi",
      body: "Ayarlar › Yedek › Yedeği indir; dosyayı bilgisayarınızda ya da Drive'da saklayın.",
      href: BACKUP_HREF,
      day: null,
    },
  ]);
  // CRON_SECRET yokken de (işlerden bağımsız), tehlike önce
  const noSecret = systemAlerts({ ...base, cronSecret: false, production: true, lastBackupAt: null });
  assert.deepEqual(
    noSecret.map((a) => [a.id, a.level]),
    [
      ["is-cron-secret", "danger"],
      ["yedek-yok", "info"],
    ],
  );
  assert.equal(BACKUP_HREF, "/panel/ayarlar#yedek");
});

const LAST: LastBackup = { at: tr("2026-10-12 09:15").toISOString(), by: "Okan", bytes: 1_250_000, rows: 4312, tables: 41, documents: false, docCount: 0 };

test("kart: telefondaki özet ve son yedek satırı", () => {
  assert.equal(backupCardSummary(null, tr("2026-10-22 10:00")), "Henüz yedek indirilmedi");
  // Boyutta sayı ve birim arası bölünmez boşluk (telefonda "1,2" ve "MB" ayrı satıra düşmesin)
  assert.equal(backupCardSummary(LAST, tr("2026-10-22 10:00")), "Son yedek 12 Eki · 1,2\u00a0MB");
  assert.equal(backupCardSummary(LAST, tr("2026-11-15 10:00")), "Son yedek 34 gün önce");
  assert.equal(lastBackupText(LAST), "12 Ekim 2026 09:15 · Okan · 1,2\u00a0MB · belgeler hariç");
  assert.equal(lastBackupText({ ...LAST, documents: true, docCount: 18 }), "12 Ekim 2026 09:15 · Okan · 1,2\u00a0MB · 18 belge dahil");
  assert.equal(backupSummaryText({ tables: 41, rows: 4312, bytes: 1_250_000, documents: false, docCount: 0 }), "41 tablo · 4.312 satır · 1,2 MB · belgeler hariç");
});

// ---------------------------------------------------------------- Komut satırı

test("komut satırı: elle verilen adres .env.local'dakinden önce; hedef adı parolasız", () => {
  const shell = { DATABASE_URL: "postgres://postgres:postgres@localhost/laffogato_prova" };
  const file = { DATABASE_URL_UNPOOLED: "postgres://u:p@ep-x.neon.tech/neondb", DATABASE_URL: "postgres://u:p@ep-x-pooler.neon.tech/neondb" };
  assert.equal(databaseUrl(shell, file), shell.DATABASE_URL);
  assert.equal(databaseUrl({}, file), file.DATABASE_URL_UNPOOLED);
  assert.equal(databaseUrl({ DATABASE_URL: "" }, {}), undefined);
  assert.deepEqual(databaseTarget("postgres://u:gizli@ep-cool-1.eu-central-1.aws.neon.tech/neondb?sslmode=require"), {
    host: "ep-cool-1.eu-central-1.aws.neon.tech",
    database: "neondb",
    local: false,
    label: "ep-cool-1.eu-central-1.aws.neon.tech/neondb",
  });
  assert.equal(databaseTarget("postgres://postgres:postgres@localhost:5432/laffogato_prova").local, true);
  assert.equal(databaseTarget("postgres://postgres@127.0.0.1/x").local, true);
  assert.ok(!databaseTarget("postgres://u:gizli@ep-x.neon.tech/db").label.includes("gizli"));
});

test("komut satırı: seçenekler", () => {
  assert.deepEqual(parseRestoreArgs(["yedek.json.gz"]), { file: "yedek.json.gz", wipe: false, confirm: null });
  assert.deepEqual(parseRestoreArgs(["yedek.json.gz", "--sil", "--onay=ep-x.neon.tech"]), { file: "yedek.json.gz", wipe: true, confirm: "ep-x.neon.tech" });
  assert.deepEqual(parseRestoreArgs(["--sil", "--onay", "h", "y.json.gz"]), { file: "y.json.gz", wipe: true, confirm: "h" });
  assert.throws(() => parseRestoreArgs([]), /Yedek dosyasını verin/);
  assert.throws(() => parseRestoreArgs(["a", "b"]), /Tek dosya verin/);
  assert.throws(() => parseRestoreArgs(["a", "--force"]), /Bilinmeyen seçenek: --force/);
});

// ---------------------------------------------------------------- İndirme akışı

const SUMMARY: BackupSummary = { tables: { categories: 2 }, rows: 2, sha256: "x", documents: false, docCount: 0 };

/** Veritabanının yerine: iki satır, ikincisinden önce `wait` beklenir; kapanınca `closed` */
async function* fakeLines(state: { closed: boolean; wait?: Promise<void> }): AsyncGenerator<string, BackupSummary, undefined> {
  try {
    yield "a\n";
    if (state.wait) await state.wait;
    yield "b\n";
    return SUMMARY;
  } finally {
    state.closed = true;
  }
}

test("indirme akışı: satırlar sırayla, sonunda özet; iptalde işlem kapanır ve hata yazılmaz; gerçek hata yazılır", async () => {
  const errors: unknown[][] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    // Baştan sona
    const whole = { closed: false };
    const lines = fakeLines(whole);
    let ended: BackupSummary | null = null;
    const reader = backupStream(lines, await lines.next(), (s) => {
      ended = s;
    }).getReader();
    const got: string[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) got.push(r.value);
    assert.deepEqual(got, ["a\n", "b\n"]);
    assert.deepEqual(ended, SUMMARY);
    assert.equal(whole.closed, true);

    // İndiren vazgeçti; o sırada ikinci satır okunuyordu (pull sürüyor): kapanmış akışa yazılmaz, hata sayılmaz
    let release!: () => void;
    const cut = { closed: false, wait: new Promise<void>((r) => (release = r)) };
    const cutLines = fakeLines(cut);
    const cutReader = backupStream(cutLines, await cutLines.next(), () => assert.fail("iptal edilen indirme bitmiş sayılmaz")).getReader();
    assert.deepEqual(await cutReader.read(), { done: false, value: "a\n" });
    await new Promise((r) => setImmediate(r));
    const cancelling = cutReader.cancel();
    release();
    await cancelling;
    await new Promise((r) => setImmediate(r));
    assert.equal(cut.closed, true, "işlem kapandı, bağlantı bırakıldı");
    assert.deepEqual(errors, []);

    // Okuma gerçekten yarıda kalırsa yazılır ve akış hata verir (dosya eksik iner)
    async function* failing(): AsyncGenerator<string, BackupSummary, undefined> {
      yield "a\n";
      throw new Error("bağlantı koptu");
    }
    const failingLines = failing();
    const failingReader = backupStream(failingLines, await failingLines.next(), () => {}).getReader();
    assert.deepEqual(await failingReader.read(), { done: false, value: "a\n" });
    await assert.rejects(failingReader.read(), /bağlantı koptu/);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], "[yedek] yarıda kaldı");
  } finally {
    console.error = consoleError;
  }
});

// ---------------------------------------------------------------- Kaynakta sabitlenenler

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("indirme: parolayla onay, yalnız yönetici; rota geri yükleme kodunu taşımaz", () => {
  const action = read("src/server/actions/backup.ts");
  assert.match(action, /const me = await requireAdmin\(\);/);
  assert.match(action, /await requirePassword\(me, data\.password, "Yedek"\);/);
  const route = read("src/app/api/yedek/route.ts");
  assert.match(route, /!user \|\| user\.role !== "admin"/);
  assert.match(route, /openBackupHandle\(/);
  assert.doesNotMatch(route, /backup\/restore/);
  assert.match(read(".gitignore"), /^laffogato-yedek-\*\.json\.gz$/m);
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["db:backup"], "tsx scripts/backup.ts");
  assert.equal(pkg.scripts["db:restore"], "tsx scripts/restore.ts");
});
