// Veritabanı testlerini gerçek bir Postgres'te koşar: `npm run test:db` (CI: .github/workflows/ci.yml › veritabani).
//
// `npm test` bu testleri atlar: her biri kendi `*_TEST_DATABASE_URL` değişkenini ister (LAFPOS_, MODPOS_, CARI_, …). Bu
// betik o değişkenlerin hepsini tek adrese (`TEST_DATABASE_URL`) bağlar, o veritabanını hazırlar (migration'lar, boşsa
// başlangıç verisi ve şubeler) ve değişkeni okuyan her test dosyasını TEK TEK, SIRAYLA çalıştırır: bir kısmı aynı
// veritabanını paylaşır (yan yana koşarlarsa birbirinin satırını görür), bir kısmı aynı sunucuda kendi geçici
// veritabanını açıp siler.
//
// Dosya başına süre sınırı vardır. Sebebi bilinen bir tuzak (21 Kasım 2026, tests/lafpos-db.test.ts): tsx altında
// iletisiz `assert.ok(değer)` düşünce Node iletiyi kendisi üretmek için test dosyasının kaynağını okuyup ayrıştırmaya
// çalışır ve süreç dakikalarca %100 işlemcide kalır; aynı iddia iletiyle (`assert.ok(değer, "…")`) bir saniyede düşer.
// `npm test` süre sınırı vermediği için orada takılı kalırdı. Burada test başına `--test-timeout`, dosya başına da kesin
// sınır var: aşan dosyanın süreci öldürülür, öteki dosyalar koşmaya devam eder. Null dönebilen okumayı sınayan
// `assert.ok`'a ileti yazın.
//
// Kullanım:
//   TEST_DATABASE_URL=postgres://localhost/laffogato_test npm run test:db
//   TEST_DATABASE_URL=… npm run test:db -- tests/lafpos-db.test.ts tests/lafpos-kasa-db.test.ts
// Yalnız bu bilgisayardaki sunucu (localhost) kabul edilir: testler tablo boşaltır, geçici veritabanı açıp siler.

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** Testlerin okuduğu değişken adları: `LAFPOS_TEST_DATABASE_URL`, `KASA_GEC_TEST_DATABASE_URL`… */
const ENV_NAME = /\b[A-Z][A-Z0-9_]*_TEST_DATABASE_URL\b/g;

/** Dosyanın okuduğu `*_TEST_DATABASE_URL` adları (yoksa boş: veritabanı testi değil) */
export function dbEnvNames(source: string): string[] {
  return [...new Set(source.match(ENV_NAME) ?? [])].sort();
}

/** Veritabanı isteyen test dosyaları ve okudukları değişkenler (ada göre sıralı) */
export function dbTestFiles(dir = "tests"): { file: string; env: string[] }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts"))
    .sort()
    .map((f) => ({ file: join(dir, f), env: dbEnvNames(readFileSync(join(dir, f), "utf8")) }))
    .filter((x) => x.env.length > 0);
}

/** Adres bu bilgisayardaki bir sunucu mu (testler tablo boşaltır: uzak veritabanına karşı koşmaz) */
export function isLocalDbUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!/^postgres(ql)?:$/.test(url.protocol)) return false;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** TAP çıktısının özeti; `skippedForEnv`: değişkeni bağlanmadığı için atlanan veritabanı testi var */
export function tapSummary(out: string): { pass: number; fail: number; cancelled: number; skippedForEnv: boolean } {
  const n = (key: string) => Number(new RegExp(`^# ${key} (\\d+)`, "m").exec(out)?.[1] ?? 0);
  return { pass: n("pass"), fail: n("fail"), cancelled: n("cancelled"), skippedForEnv: /# SKIP [^\n]*TEST_DATABASE_URL/.test(out) };
}

interface FileResult {
  file: string;
  ok: boolean;
  seconds: number;
  note: string;
  output: string;
}

/** Bir test dosyasını kendi sürecinde koşar; süre dolarsa süreç grubunu öldürür */
function runFile(file: string, env: NodeJS.ProcessEnv, limitMs: number): Promise<FileResult> {
  const require = createRequire(import.meta.url);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [require.resolve("tsx/cli"), "--test", "--test-reporter=tap", `--test-timeout=${Math.max(30_000, limitMs - 30_000)}`, file], {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => (output += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        // Sürecin bütün torunları (test koşucusunun dosya süreci) birlikte
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, limitMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      const sum = tapSummary(output);
      if (timedOut) return resolve({ file, ok: false, seconds, note: `${Math.round(limitMs / 1000)} sn'de bitmedi, durduruldu (takılan test)`, output });
      if (sum.skippedForEnv) return resolve({ file, ok: false, seconds, note: "veritabanı testi atlandı: değişkeni bağlanmadı", output });
      const ok = code === 0 && sum.fail === 0 && sum.cancelled === 0;
      resolve({ file, ok, seconds, note: `${sum.pass} geçti${sum.fail ? `, ${sum.fail} düştü` : ""}${sum.cancelled ? `, ${sum.cancelled} yarıda kaldı` : ""}`, output });
    });
  });
}

async function main(): Promise<number> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) {
    console.error("TEST_DATABASE_URL tanımlı değil. Örnek: TEST_DATABASE_URL=postgres://localhost/laffogato_test npm run test:db");
    return 1;
  }
  if (!isLocalDbUrl(url)) {
    console.error("TEST_DATABASE_URL bu bilgisayardaki bir Postgres olmalı (localhost): testler tablo boşaltır, geçici veritabanı açıp siler.");
    return 1;
  }
  const all = dbTestFiles();
  const asked = process.argv.slice(2);
  const files = asked.length ? all.filter((x) => asked.some((a) => x.file === a || x.file.endsWith(`/${a}`) || x.file === join("tests", a))) : all;
  if (!files.length) {
    console.error("Koşacak veritabanı testi bulunamadı.");
    return 1;
  }
  // Canlının adresi ortamda kalmasın: betik ve testler yalnız test veritabanını görür
  delete process.env.DATABASE_URL_UNPOOLED;
  delete process.env.POSTGRES_URL;
  process.env.DATABASE_URL = url;
  // Paylaşılan veritabanı hazırlanır: migration'lar uygulanır, boşsa başlangıç verisi (tests/fixtures/baslangic) ve
  // şube kütüğü yüklenir (canlı derlemenin aksine her zaman: runSeed'e emptySkip verilmez). Bir kısım test "dolu"
  // veritabanı ister (sayım kalemleri migration'ı boş veritabanında hiçbir şey eklemez); kendi geçici veritabanını açan
  // testler onu kendileri kurar
  const { runMigrations } = await import("./migrate");
  await runMigrations();
  const { runSeed } = await import("./seed");
  await runSeed();

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of new Set(all.flatMap((x) => x.env))) env[name] = url;
  const limitMs = Number(process.env.TEST_DB_FILE_TIMEOUT_MS ?? 300_000);
  const results: FileResult[] = [];
  for (const { file } of files) {
    const r = await runFile(file, env, limitMs);
    results.push(r);
    console.log(`${r.ok ? "✓" : "✗"} ${file} · ${r.note} · ${r.seconds} sn`);
    if (!r.ok) console.log(r.output.trimEnd());
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} dosya: ${results.length - failed.length} geçti, ${failed.length} düştü.`);
  for (const r of failed) console.log(`  ✗ ${r.file} · ${r.note}`);
  return failed.length ? 1 : 0;
}

if (process.argv[1]?.endsWith("test-db.ts")) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
