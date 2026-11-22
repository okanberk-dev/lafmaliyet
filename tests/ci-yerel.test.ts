// Birleştirme öncesi yerel denetimin (scripts/ci-yerel.ts, `npm run ci:yerel -- <PR no>`) saf parçaları ve bağlantısı.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ciDbName, dbUrl, schemaUpToDate } from "../scripts/ci-yerel";

test("ci:yerel package.json'da betiğe bağlı", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["ci:yerel"], "tsx scripts/ci-yerel.ts");
});

test("veritabanı adı: PR numarasından lm_pr<no>, etiket güvenli ada çevrilir", () => {
  assert.equal(ciDbName("100"), "lm_pr100");
  assert.equal(ciDbName("#102"), "lm_pr102");
  assert.equal(ciDbName("claude/son-denetim"), "lm_claude_son_denetim");
  assert.throws(() => ciDbName("--"));
});

test("drizzle-kit çıktısı: yalnız 'No schema changes' geçer", () => {
  assert.equal(schemaUpToDate("waste_entries 16 columns\n\nNo schema changes, nothing to migrate 😴"), true);
  assert.equal(schemaUpToDate("[✓] Your SQL migration file ➜ drizzle/0066_x.sql 🚀"), false);
});

test("veritabanı adresi sunucunun adresinden", () => {
  assert.equal(dbUrl("postgres://localhost/postgres", "lm_pr100"), "postgres://localhost/lm_pr100");
  assert.equal(dbUrl("postgres://u:p@127.0.0.1:5432/postgres", "lm_pr7"), "postgres://u:p@127.0.0.1:5432/lm_pr7");
});
