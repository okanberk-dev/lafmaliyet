// Birleştirmeden önce yerel denetim: `npm run ci:yerel -- <PR no>`. CI veritabanı testlerini de koşar
// (.github/workflows/ci.yml); burada ek olarak şema ve göç tutarlılığı denenir (CI'da bu adım henüz yok). Predeploy
// göçleri canlı Neon'a uygular, yani göç yolu birleştirmeden önce burada denenir.
//
// 1. Bu bilgisayardaki Postgres'te boş `lm_pr<no>` veritabanını açar (varsa önce siler).
// 2. `TEST_DATABASE_URL` onu gösterecek şekilde `npm run test:db` koşar (göçlerin hepsi baştan, seed, veritabanı testleri).
// 3. `npx drizzle-kit generate` koşar: çıktı "No schema changes" olmalı (_journal ve snapshot şemayla tutarlı). Değilse
//    üretilen dosyaları siz görün diye bırakır ve düşer.
// 4. Veritabanını her durumda siler.
//
// Sunucu: CI_YEREL_SERVER_URL (varsayılan postgres://localhost/postgres); yalnız localhost kabul edilir. Birleştirmeden
// sonra Vercel production derleme günlüğünde "✓ Veritabanı şeması güncel (N migration)" satırına bakın.

import { spawnSync } from "node:child_process";

import postgres from "postgres";

import { isLocalDbUrl } from "./test-db";

/** Denetimin veritabanı adı: `lm_pr<no>`; PR numarası değilse dal adı gibi bir etiket (küçük harf, `_`) */
export function ciDbName(label: string): string {
  const clean = label.trim().replace(/^#/, "").toLowerCase();
  if (/^\d+$/.test(clean)) return `lm_pr${clean}`;
  const slug = clean.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!slug) throw new Error("PR numarası ya da etiket verin: npm run ci:yerel -- 100");
  return `lm_${slug}`;
}

/** drizzle-kit generate çıktısı şemanın göçlerle tutarlı olduğunu söylüyor mu */
export function schemaUpToDate(output: string): boolean {
  return /No schema changes/.test(output);
}

/** Sunucu adresinde veritabanı adını değiştirir */
export function dbUrl(serverUrl: string, name: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.href;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): { code: number; out: string } {
  const r = spawnSync(cmd, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(out);
  return { code: r.status ?? 1, out };
}

async function main(): Promise<number> {
  const label = process.argv[2];
  if (!label) {
    console.error("Kullanım: npm run ci:yerel -- <PR no>   (örnek: npm run ci:yerel -- 100)");
    return 2;
  }
  const server = process.env.CI_YEREL_SERVER_URL ?? "postgres://localhost/postgres";
  if (!isLocalDbUrl(server)) {
    console.error("CI_YEREL_SERVER_URL bu bilgisayardaki bir Postgres olmalı (localhost)");
    return 2;
  }
  const name = ciDbName(label);
  const admin = postgres(server, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
    console.log(`▶ ${name}: npm run test:db`);
    const env = { ...process.env, TEST_DATABASE_URL: dbUrl(server, name) };
    const tests = run("npm", ["run", "test:db"], env);
    if (tests.code !== 0) {
      console.error(`✗ test:db düştü (${name})`);
      return 1;
    }
    console.log("▶ npx drizzle-kit generate");
    const gen = run("npx", ["drizzle-kit", "generate"], env);
    if (gen.code !== 0 || !schemaUpToDate(gen.out)) {
      console.error("✗ drizzle-kit generate 'No schema changes' demedi: şema ile drizzle/ (_journal, snapshot) tutarsız");
      return 1;
    }
    console.log(`✓ ${name}: veritabanı testleri geçti, şema göçlerle tutarlı`);
    return 0;
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
}

if (process.argv[1]?.endsWith("ci-yerel.ts")) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
