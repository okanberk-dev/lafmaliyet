// Otomatik haftalık yedek (docs/YEDEK.md › Otomatik haftalık yedek): dosya adı, hafta (pazartesi başlar, İstanbul
// günü), saklama (son 8), Ayarlar › Yedek'teki durum satırı, depo sürücüleri (dosya sistemi, bellek, özel Blob'un
// sahtesi), sabah işinin adımı ve kaynakta sabitlenenler (yalnız yönetici, parola, rota). Saf; yedeğin kendisi
// veritabanıyla tests/yedek-kota-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/yedek-oto.test.ts

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SETTINGS_SECTIONS } from "../src/app/panel/ayarlar/sections";
import {
  AUTO_BACKUP_KEEP,
  AUTO_BACKUP_PREFIX,
  AUTO_BACKUP_STALE_DAYS,
  asAutoBackupState,
  autoBackupDue,
  autoBackupName,
  autoBackupStatus,
  autoBackupsToDelete,
  EMPTY_AUTO_BACKUP_STATE,
  isAutoBackupName,
  parseAutoBackupName,
  storedBackupLabel,
  storedBackups,
  weekStart,
  type AutoBackupState,
} from "../src/lib/backup/auto";
import { backupStep, dailyOutcome, STEP_LABELS, stepTexts } from "../src/lib/job-health";
import { blobBackupStore, fsBackupStore, memoryBackupStore, type BackupBlobApi } from "../src/server/backup/store";

/** İstanbul saatiyle "2026-11-23 08:12" → Date */
const tr = (s: string) => new Date(`${s.replace(" ", "T")}:00+03:00`);
const name = (trTime: string, suffix = "0a1b2c3d") => autoBackupName(tr(trTime), suffix);
const plain = (v: string) => v.replace(/[  ]/g, " ");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("dosya adı İstanbul saatiyle; yalnız bu biçim kabul edilir", () => {
  assert.equal(name("2026-11-23 08:12"), "laffogato-yedek-oto-2026-11-23-0812-0a1b2c3d.json.gz");
  // UTC'de hâlâ pazar: ad İstanbul gününü taşır
  assert.equal(autoBackupName(new Date("2026-11-22T21:30:00Z"), "ffffffff"), "laffogato-yedek-oto-2026-11-23-0030-ffffffff.json.gz");
  assert.deepEqual(parseAutoBackupName(name("2026-11-23 08:12")), { day: "2026-11-23", at: "2026-11-23T05:12:00.000Z" });
  assert.ok(isAutoBackupName(name("2026-11-23 08:12")), "ürettiğimiz ad geçerli");
  for (const bad of [
    "laffogato-yedek-2026-11-23-0812.json.gz",
    "laffogato-yedek-oto-2026-11-23-0812-0A1B2C3D.json.gz",
    "laffogato-yedek-oto-2026-11-23-0812-0a1b2c3d.json",
    "../laffogato-yedek-oto-2026-11-23-0812-0a1b2c3d.json.gz",
    "yedek/haftalik/laffogato-yedek-oto-2026-11-23-0812-0a1b2c3d.json.gz",
    "laffogato-yedek-oto-2026-11-23-0812-0a1b2c3d.json.gz/../x",
    "",
  ]) {
    assert.equal(isAutoBackupName(bad), false, bad);
    assert.equal(parseAutoBackupName(bad), null, bad);
  }
});

test("hafta pazartesi başlar; bu haftanın dosyası yoksa yedek alınır (pazartesi alınamadıysa salı da)", () => {
  assert.equal(weekStart("2026-11-23"), "2026-11-23");
  assert.equal(weekStart("2026-11-29"), "2026-11-23");
  assert.equal(weekStart("2026-11-30"), "2026-11-30");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
  assert.equal(autoBackupDue([], tr("2026-11-25 08:00")), true, "hiç yedek yok: bugün alınır");
  const monday = [{ day: "2026-11-23" }];
  assert.equal(autoBackupDue(monday, tr("2026-11-23 08:30")), false, "pazartesinin yedeği alındı");
  assert.equal(autoBackupDue(monday, tr("2026-11-24 08:00")), false, "salı: bu hafta alındı");
  assert.equal(autoBackupDue(monday, tr("2026-11-29 23:30")), false, "pazar gecesi İstanbul'da hâlâ aynı hafta");
  assert.equal(autoBackupDue(monday, tr("2026-11-30 00:30")), true, "İstanbul'da pazartesi oldu (UTC'de pazar)");
  assert.equal(autoBackupDue([{ day: "2026-11-16" }], tr("2026-11-24 08:00")), true, "pazartesi alınamadı: salı yeniden denenir");
});

test("saklama: en yeni 8 dosya kalır; yabancı adlar listeye girmez, silinmez", () => {
  const days = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"];
  const files = [...days.map((d) => ({ name: name(`${d} 08:10`), bytes: 1000 })), { name: "laffogato-yedek-2026-11-01-0900.json.gz", bytes: 5 }, { name: "notlar.txt", bytes: 1 }];
  const items = storedBackups(files);
  assert.equal(items.length, 10, "yabancı adlar süzülür");
  assert.equal(items[0].day, "2026-12-07", "yeni önce");
  assert.equal(items.at(-1)?.day, "2026-10-05");
  assert.equal(AUTO_BACKUP_KEEP, 8);
  assert.deepEqual(autoBackupsToDelete(items), [name("2026-10-12 08:10"), name("2026-10-05 08:10")]);
  assert.deepEqual(autoBackupsToDelete(items.slice(0, 8)), []);
  // Aynı hafta iki dosya (iş iki kez koştu): yine en yeni sekiz kalır
  assert.deepEqual(autoBackupsToDelete([...items.slice(0, 8), { name: name("2026-12-07 08:11") }]), [name("2026-10-19 08:10")]);
});

test("durum kaydı bozuk değeri yutar", () => {
  assert.deepEqual(asAutoBackupState(null), EMPTY_AUTO_BACKUP_STATE);
  assert.deepEqual(asAutoBackupState("x"), EMPTY_AUTO_BACKUP_STATE);
  assert.deepEqual(asAutoBackupState({ lastAttemptAt: "dün", lastError: "", lastOk: { at: "yok", name: "a" } }), EMPTY_AUTO_BACKUP_STATE);
  const ok = { at: "2026-11-23T05:12:00.000Z", name: name("2026-11-23 08:12"), bytes: 1234, rows: 50, tables: 40 };
  assert.deepEqual(asAutoBackupState({ lastAttemptAt: ok.at, lastError: null, lastOk: { ...ok, bytes: "çok" } }), { lastAttemptAt: ok.at, lastError: null, lastOk: { ...ok, bytes: 0 } });
});

test("Ayarlar › Yedek'teki durum: depo yok, bekliyor, çalışıyor, alınamadı, gecikti", () => {
  const items = storedBackups([{ name: name("2026-11-23 08:12"), bytes: 1_250_000 }]);
  const none: AutoBackupState = EMPTY_AUTO_BACKUP_STATE;
  const now = tr("2026-11-26 10:00");
  const off = autoBackupStatus({ available: false, state: none, items: [], now });
  assert.equal(off.tone, "off");
  assert.equal(off.badge, "Depo yok");
  assert.equal(autoBackupStatus({ available: true, state: none, items: [], now }).badge, "Bekliyor");
  const ok = autoBackupStatus({ available: true, state: none, items, now });
  assert.equal(ok.tone, "ok");
  assert.equal(plain(ok.text), "Son otomatik yedek 23 Kasım · 1,2 MB. Her pazartesi alınır, son 8 hafta saklanır.");
  // Son deneme en yeni dosyadan sonra hata verdi: kırmızı, hata metniyle
  const failed: AutoBackupState = { lastAttemptAt: tr("2026-11-30 08:05").toISOString(), lastError: "Blob: 503", lastOk: null };
  const bad = autoBackupStatus({ available: true, state: failed, items, now: tr("2026-11-30 10:00") });
  assert.equal(bad.tone, "bad");
  assert.equal(bad.badge, "Alınamadı");
  assert.match(bad.text, /30 Kasım.*Blob: 503.*yarın yeniden dener/);
  // Hata eski: sonra alınan dosya var
  const older: AutoBackupState = { ...failed, lastAttemptAt: tr("2026-11-23 08:00").toISOString() };
  assert.equal(autoBackupStatus({ available: true, state: older, items, now }).tone, "ok");
  // Hiç dosya yokken hata: kırmızı
  assert.equal(autoBackupStatus({ available: true, state: failed, items: [], now }).tone, "bad");
  // En yeni dosya 10 günden eski: turuncu
  const late = autoBackupStatus({ available: true, state: none, items, now: tr("2026-12-03 09:00") });
  assert.equal(AUTO_BACKUP_STALE_DAYS, 10);
  assert.equal(late.badge, "Gecikti");
  assert.match(late.text, /10 gün önce/);
  assert.equal(autoBackupStatus({ available: true, state: none, items, now: tr("2026-12-02 09:00") }).badge, "Çalışıyor", "9 gün: daha gecikmedi");
});

test("listedeki satır: tarih, gün ve saat (İstanbul)", () => {
  assert.equal(plain(storedBackupLabel({ at: "2026-11-23T05:12:00.000Z" })), "23 Kasım 2026 Pazartesi 08:12");
});

test("sabah işinin adımı: yalnız alındığı, alınamadığı ya da depo olmadığı gün; hata işi kısmen yapar", () => {
  assert.equal(backupStep({ status: "skip" }), undefined);
  assert.deepEqual(backupStep({ status: "ok" }), { code: "ok" });
  assert.deepEqual(backupStep({ status: "off" }), { code: "off" });
  assert.deepEqual(backupStep({ status: "error", error: "süre yetmedi" }), { code: "error", error: "süre yetmedi" });
  const core = { digest: { code: "sent" }, sync: { code: "ok" }, reminders: { code: "ok" }, karaoke: { code: "ok" }, menu: { code: "ok" }, sales: { code: "ok" } };
  const out = dailyOutcome({ ...core, backup: { code: "error", error: "Blob: 503" } });
  assert.equal(out.status, "partial");
  assert.equal(out.message, "Otomatik yedek: Blob: 503");
  assert.equal(dailyOutcome({ ...core, backup: { code: "off" } }).status, "ok", "depo yok: hata değil");
  assert.deepEqual(STEP_LABELS.backup, { ok: "Haftalık yedek alındı", off: "Otomatik yedek: depo yok", error: "Otomatik yedek alınamadı" });
  assert.deepEqual(stepTexts({ backup: "ok" }), ["Haftalık yedek alındı"]);
});

test("bellek deposu: yaz, oku, listele, sil; aynı ad ve yabancı ad reddedilir", async () => {
  const store = memoryBackupStore();
  const n = name("2026-11-23 08:12");
  await store.put(n, new Uint8Array([1, 2, 3]));
  await assert.rejects(store.put(n, new Uint8Array([9])), /Ad zaten var/);
  await assert.rejects(store.put("../x.json.gz", new Uint8Array([9])), /Geçersiz yedek adı/);
  assert.deepEqual([...((await store.get(n)) ?? [])], [1, 2, 3]);
  assert.equal(await store.get(name("2026-11-30 08:12")), null);
  assert.deepEqual(await store.list(), [{ name: n, bytes: 3 }]);
  await store.del([n, name("2026-11-30 08:12")]);
  assert.deepEqual(await store.list(), []);
});

test("dosya sistemi deposu (yerel geliştirme): klasör yoksa boş liste, üzerine yazmaz, yalnız bizim adlar", async () => {
  const root = await mkdtemp(join(tmpdir(), "yedek-oto-"));
  try {
    const dir = join(root, "backups");
    const store = fsBackupStore(dir);
    assert.deepEqual(await store.list(), [], "klasör yok");
    const n = name("2026-11-23 08:12");
    await store.put(n, new Uint8Array([1, 2, 3, 4]));
    await assert.rejects(store.put(n, new Uint8Array([5])), /EEXIST/);
    await assert.rejects(store.put("../kacak.json.gz", new Uint8Array([5])), /Geçersiz yedek adı/);
    await assert.rejects(store.get("../../etc/passwd"), /Geçersiz yedek adı/);
    assert.deepEqual([...((await store.get(n)) ?? [])], [1, 2, 3, 4]);
    assert.equal(await store.get(name("2026-11-30 08:12")), null);
    await writeFile(join(dir, "notlar.txt"), "x");
    assert.deepEqual((await store.list()).sort((a, b) => a.name.localeCompare(b.name)), [
      { name: n, bytes: 4 },
      { name: "notlar.txt", bytes: 1 },
    ]);
    assert.equal(storedBackups(await store.list()).length, 1, "yabancı dosya listeye girmez");
    await store.del([n, name("2026-11-30 08:12")]);
    assert.deepEqual(await readdir(dir), ["notlar.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("özel Blob deposu: klasör öneki, özel erişim, üzerine yazmaz, sayfalı liste, anahtar her çağrıda", async () => {
  const calls: { op: string; args: unknown[] }[] = [];
  const files = new Map<string, Buffer>();
  const api: BackupBlobApi = {
    async put(pathname, body, options) {
      calls.push({ op: "put", args: [pathname, options] });
      files.set(pathname, body);
      return {};
    },
    async get(pathname, options) {
      calls.push({ op: "get", args: [pathname, options] });
      const b = files.get(pathname);
      if (!b) return null;
      return { statusCode: 200, stream: new Blob([new Uint8Array(b)]).stream() };
    },
    async list(options) {
      calls.push({ op: "list", args: [options] });
      // İki sayfa: önce bir dosya, sonra kalanı (öneki tutmayan bir ad da gelir; atlanır)
      const all = [...files].map(([pathname, b]) => ({ pathname, size: b.byteLength }));
      if (!options.cursor) return { blobs: all.slice(0, 1), cursor: "c2", hasMore: true };
      return { blobs: [...all.slice(1), { pathname: "kasa/2026/11/x.png", size: 9 }], hasMore: false };
    },
    async del(pathnames, options) {
      calls.push({ op: "del", args: [pathnames, options] });
      for (const p of pathnames) files.delete(p);
    },
  };
  const store = blobBackupStore(api, "vercel_blob_rw_test");
  const a = name("2026-11-23 08:12");
  const b = name("2026-11-30 08:12");
  await store.put(a, new Uint8Array([1, 2]));
  await store.put(b, new Uint8Array([3, 4, 5]));
  assert.deepEqual(calls[0], {
    op: "put",
    args: [`${AUTO_BACKUP_PREFIX}${a}`, { access: "private", contentType: "application/gzip", addRandomSuffix: false, allowOverwrite: false, token: "vercel_blob_rw_test" }],
  });
  assert.deepEqual(
    (await store.list()).sort((x, y) => x.name.localeCompare(y.name)),
    [
      { name: a, bytes: 2 },
      { name: b, bytes: 3 },
    ],
  );
  assert.equal(calls.filter((c) => c.op === "list").length, 2, "ikinci sayfa da okunur");
  assert.deepEqual(calls.find((c) => c.op === "list")?.args[0], { prefix: "yedek/haftalik/", limit: 100, token: "vercel_blob_rw_test" });
  assert.deepEqual([...((await store.get(b)) ?? [])], [3, 4, 5]);
  assert.deepEqual(calls.find((c) => c.op === "get")?.args[1], { access: "private", token: "vercel_blob_rw_test" });
  assert.equal(await store.get(name("2026-12-07 08:12")), null);
  await assert.rejects(store.del(["../kasa/2026/11/x.png"]), /Geçersiz yedek adı/);
  assert.equal(calls.filter((c) => c.op === "del").length, 0, "geçersiz ad depoya gitmez");
  await store.del([a]);
  assert.deepEqual(calls.at(-1), { op: "del", args: [[`${AUTO_BACKUP_PREFIX}${a}`], { token: "vercel_blob_rw_test" }] });
  await store.del([]);
  assert.equal(calls.filter((c) => c.op === "del").length, 1, "boş silme depoya gitmez");
});

test("kaynakta: indirme yalnız yöneticiye ve parolayla; dosya adı bağlantıda mühürlü; depo adresi çıkmaz", () => {
  const action = read("src/server/actions/backup.ts");
  assert.match(action, /export async function prepareStoredBackupDownload[\s\S]*const me = await requireAdmin\(\);[\s\S]*await requirePassword\(me, data\.password, "Yedek", data\.name\);/);
  assert.match(action, /refine\(isAutoBackupName, "Yedek bulunamadı"\)/);
  const route = read("src/app/api/yedek/kayitli/route.ts");
  assert.match(route, /!user \|\| user\.role !== "admin"/);
  assert.match(route, /openStoredBackupHandle\(request\.nextUrl\.searchParams\.get\("t"\) \?\? "", user\.id\)/);
  assert.doesNotMatch(route, /searchParams\.get\("(n|name|ad)"\)/, "dosya adı istekten okunmaz");
  assert.doesNotMatch(route, /\.url\b|downloadUrl/, "Blob adresi yanıta girmez");
  assert.match(route, /"Cache-Control": "no-store"/);
  // Sabah işi yedeği bir kez başlatır, öteki adımları bekletmez; adım ve kota job_runs'a yazılır
  const cron = read("src/app/api/cron/gunluk/route.ts");
  assert.match(cron, /const backupP = capped<AutoBackupResult>\(\s*runAutoBackup\(new Date\(jobStart\), \{ deadlineAt: jobStart \+ BACKUP_DEADLINE_MS \}\)/);
  assert.match(cron, /\.\.\.\(backupResult \? \{ backup: backupResult \} : \{\}\)/);
  // Ayarlar: bölüm ve kart
  const ids = SETTINGS_SECTIONS.map((s) => s.id) as string[];
  assert.equal(ids.indexOf("veritabani") + 1, ids.indexOf("yedek"), "Veritabanı Yedek'ten hemen önce");
  const page = read("src/app/panel/ayarlar/page.tsx");
  assert.match(page, /<DatabaseCard \/>\s*<BackupCard \/>/);
  assert.match(page, /loadAutoBackupInfo\(\)/);
  assert.match(read("src/app/panel/ayarlar/backup-client.tsx"), /prepareStoredBackupDownload\(\{ password, name: asking\.name \}\)/);
  // Yerel depo git'e girmez
  assert.match(read(".gitignore"), /^\/\.data\/$/m);
});
