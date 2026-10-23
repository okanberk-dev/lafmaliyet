// Derleme öncesi veritabanı hazırlığı (scripts/predeploy.ts): önizleme dağıtımları canlının veritabanını kullandığı
// için migration ve seed yalnız canlı dağıtımda çalışır; önizlemelerin kendi veritabanı varsa MIGRATE_ON_PREVIEW=1.
// Çalıştırma: npx tsx --test tests/predeploy.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { predeploySkipReason } from "../scripts/predeploy-guard";

const DB = "postgres://u:p@host/db";

test("veritabanı yoksa atlanır", () => {
  assert.match(predeploySkipReason({}) ?? "", /DATABASE_URL yok/);
  assert.match(predeploySkipReason({ VERCEL_ENV: "production" }) ?? "", /DATABASE_URL yok/);
});

test("canlı dağıtımda ve yerelde çalışır", () => {
  assert.equal(predeploySkipReason({ DATABASE_URL: DB, VERCEL_ENV: "production" }), null);
  assert.equal(predeploySkipReason({ DATABASE_URL: DB }), null);
  assert.equal(predeploySkipReason({ POSTGRES_URL: DB, VERCEL_ENV: "development" }), null);
});

test("önizlemede canlının veritabanına dokunmaz; ayrı veritabanı varsa açılır", () => {
  assert.match(predeploySkipReason({ DATABASE_URL: DB, VERCEL_ENV: "preview" }) ?? "", /Önizleme/);
  assert.match(predeploySkipReason({ DATABASE_URL: DB, VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "0" }) ?? "", /Önizleme/);
  assert.equal(predeploySkipReason({ DATABASE_URL: DB, VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "1" }), null);
});

test("betik kararı bu fonksiyona bırakır", () => {
  const src = readFileSync(join(process.cwd(), "scripts/predeploy.ts"), "utf8");
  // Havuzlu bağlantının denetimi de kararın arkasında ve migration'dan önce (açılmazsa şemaya dokunulmadan durulur)
  assert.match(src, /const skip = predeploySkipReason\(process\.env\);\s*if \(skip\) \{[\s\S]*?return;\s*\}\s*await checkRuntimeConnection\(\);\s*await runMigrations\(\);\s*await runSeed\(\);/);
});
