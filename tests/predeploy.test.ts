// Derleme öncesi veritabanı hazırlığı (scripts/predeploy.ts): önizleme dağıtımları canlının veritabanını kullandığı
// için migration ve seed yalnız canlı dağıtımda çalışır; önizlemelerin kendi veritabanı varsa MIGRATE_ON_PREVIEW=1.
// Production derlemesi yalnız main dalından: Production'a terfi ya da redeploy edilen dal önizlemesi derlemeyi durdurur
// (denetim E-10); bilerek yapılan dağıtım ALLOW_BRANCH_PRODUCTION=1 ister.
// Çalıştırma: npx tsx --test tests/predeploy.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PRODUCTION_BRANCH, predeploySkipReason, productionBranchOverride, productionBranchRefusal } from "../scripts/predeploy-guard";

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

test("Production derlemesi main dışındaki daldan reddedilir (Redeploy / Promote to Production edilen önizleme)", () => {
  assert.equal(PRODUCTION_BRANCH, "main");
  const refused = productionBranchRefusal({ DATABASE_URL: DB, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "claude/lafpos-baglantisi" }) ?? "";
  assert.match(refused, /^Production derlemesi yalnız main dalından yapılır; bu derlemenin dalı: claude\/lafpos-baglantisi\./);
  assert.match(refused, /ALLOW_BRANCH_PRODUCTION=1/);
  assert.match(refused, /canlı sürüm ve veritabanı değişmedi/);
  // Veritabanı tanımlı olmasa da: dalın kodu canlı sırlarıyla yayına çıkmasın
  assert.match(productionBranchRefusal({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "claude/x" }) ?? "", /dalı: claude\/x\./);
  // Başka bir ad, "main" ile başlayan dal da main değildir
  for (const ref of ["claude/x", "mainline", "main-yedek", "feature/main", "Main"]) {
    assert.ok(productionBranchRefusal({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: ref }), ref);
  }
  // Açma anahtarı yalnız "1"
  for (const v of ["0", "true", "evet", ""]) {
    assert.ok(productionBranchRefusal({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "claude/x", ALLOW_BRANCH_PRODUCTION: v }), v);
  }
});

test("main, dalı bilinmeyen derleme, bilerek açılmış dal ve önizleme reddedilmez", () => {
  assert.equal(productionBranchRefusal({ DATABASE_URL: DB, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }), null);
  assert.equal(productionBranchRefusal({ DATABASE_URL: DB, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: " main " }), null);
  // Yerel derleme ve Git'siz CLI dağıtımı: dal bilinmiyor
  assert.equal(productionBranchRefusal({ DATABASE_URL: DB, VERCEL_ENV: "production" }), null);
  assert.equal(productionBranchRefusal({ DATABASE_URL: DB, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "" }), null);
  assert.equal(productionBranchRefusal({ DATABASE_URL: DB }), null);
  assert.equal(productionBranchRefusal({}), null);
  assert.equal(productionBranchRefusal({ DATABASE_URL: DB, VERCEL_GIT_COMMIT_REF: "claude/x" }), null, "yerelde VERCEL_ENV yok");
  // Bilerek: derleme sürer, günlüğe uyarı yazılır
  const allowed = { DATABASE_URL: DB, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "claude/x", ALLOW_BRANCH_PRODUCTION: "1" };
  assert.equal(productionBranchRefusal(allowed), null);
  assert.match(productionBranchOverride(allowed) ?? "", /claude\/x dalından \(ALLOW_BRANCH_PRODUCTION=1 ile bilerek\)/);
  assert.equal(productionBranchOverride({ ...allowed, VERCEL_GIT_COMMIT_REF: "main" }), null, "main'de uyarı yok");
  assert.equal(productionBranchOverride({ ...allowed, ALLOW_BRANCH_PRODUCTION: undefined }), null);
  assert.equal(productionBranchOverride({ ...allowed, VERCEL_ENV: "preview" }), null);
  // Önizleme bugünkü gibi: dal kararı yok, hazırlık atlanır
  const preview = { DATABASE_URL: DB, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "claude/x" };
  assert.equal(productionBranchRefusal(preview), null);
  assert.match(predeploySkipReason(preview) ?? "", /Önizleme/);
  assert.equal(productionBranchRefusal({ ...preview, VERCEL_ENV: "development" }), null);
});

test("betik kararı bu fonksiyonlara bırakır: önce dal, sonra atlama, sonra veritabanı", () => {
  const src = readFileSync(join(process.cwd(), "scripts/predeploy.ts"), "utf8");
  // Dal reddi her şeyden önce ve çıkış koduyla (derleme başarısız: Vercel dağıtımı yayına almaz)
  assert.match(src, /const refusal = productionBranchRefusal\(process\.env\);\s*if \(refusal\) \{\s*console\.error\(`✗ \$\{refusal\}`\);\s*process\.exit\(1\);\s*\}/);
  assert.ok(src.indexOf("productionBranchRefusal(process.env)") < src.indexOf("predeploySkipReason(process.env)"));
  // Havuzlu bağlantının denetimi de kararın arkasında ve migration'dan önce (açılmazsa şemaya dokunulmadan durulur)
  assert.match(src, /const skip = predeploySkipReason\(process\.env\);\s*if \(skip\) \{[\s\S]*?return;\s*\}\s*await checkRuntimeConnection\(\);\s*await runMigrations\(\);\s*await runSeed\(\);/);
});

test("betiğin kendisi: daldan Production derlemesi veritabanına bağlanmadan 1 koduyla durur", () => {
  // Veritabanı adresleri kapalı bir bağlantı noktasını gösterir: bekçi tutmasaydı betik bağlanmaya çalışır ve
  // "Veritabanı hazırlığı başarısız" derdi. loadEnvConfig var olan değişkeni ezmez (.env.local devreye girmez).
  const dead = "postgres://u:p@127.0.0.1:9/yok";
  const run = (extra: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/predeploy.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: dead, DATABASE_URL_UNPOOLED: dead, POSTGRES_URL: dead, VERCEL_ENV: "production", ...extra },
      timeout: 60_000,
    });
  const r = run({ VERCEL_GIT_COMMIT_REF: "claude/lafpos-baglantisi" });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /✗ Production derlemesi yalnız main dalından yapılır; bu derlemenin dalı: claude\/lafpos-baglantisi\./);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /Veritabanı hazırlığı başarısız|Havuzlu|migration/i);
});

test("DEPLOY.md: dal önizlemesi Production'a alınmaz; ret ve uyarı satırları koddakiyle aynı; anahtar tek derlemelik", () => {
  // Satır sonları boşluk sayılır (belgede ters tırnaklı satır da bölünür)
  const doc = readFileSync(join(process.cwd(), "docs/DEPLOY.md"), "utf8").replace(/\s*\n\s*/g, " ");
  const s7 = doc.slice(doc.indexOf("## 7. Güncelleme ve yedek"), doc.indexOf("## 8."));
  assert.match(s7, /\*\*Production yalnız main'den\.\*\* Bir dalın önizlemesi \*\*asla\*\* Production'a terfi ettirilmez/);
  assert.match(s7, /`scripts\/predeploy-guard\.ts` › `productionBranchRefusal`/);
  assert.ok(s7.includes("`vercel deploy --prod --build-env ALLOW_BRANCH_PRODUCTION=1`"));
  // Belgedeki satırlar betiğin yazdığıyla başlar
  const refused = productionBranchRefusal({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "dal" }) ?? "";
  const quoted = refused.slice(0, refused.indexOf("dal."));
  assert.ok(s7.includes(`\`✗ ${quoted}…\``), quoted);
  const warned = productionBranchOverride({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "<dal>", ALLOW_BRANCH_PRODUCTION: "1" }) ?? "";
  assert.ok(s7.includes(`\`! ${warned.slice(0, warned.indexOf(":"))}\``), warned);
  // Ortam değişkenleri tablosunda, proje ayarına eklenmemesi yazılı; § 2 ve § 5 de anıyor
  const env = doc.slice(doc.indexOf("## 4. Ortam değişkenleri"), doc.indexOf("## 5."));
  assert.match(env, /\| `ALLOW_BRANCH_PRODUCTION` \| \(yalnız acil durumda, tek derleme için\)[^\n]*Proje ayarlarına \*\*eklemeyin\*\*/);
  assert.match(doc.slice(doc.indexOf("## 2."), doc.indexOf("## 3.")), /`main` dışındaki bir dalın Production derlemesi hiç başlamadan durur/);
  assert.ok(doc.slice(doc.indexOf("## 5."), doc.indexOf("## 6.")).includes(`\`✗ ${quoted}…\``));
});
