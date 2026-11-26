// Derleme öncesi veritabanı hazırlığı (scripts/predeploy.ts): önizleme dağıtımları canlının veritabanını kullandığı
// için migration ve seed yalnız canlı dağıtımda çalışır; önizlemelerin kendi veritabanı varsa MIGRATE_ON_PREVIEW=1.
// Production derlemesi yalnız main dalından: Production'a terfi ya da redeploy edilen dal önizlemesi derlemeyi durdurur
// (denetim E-10); bilerek yapılan dağıtım ALLOW_BRANCH_PRODUCTION=1 ister. vercel.json'ın `claude/**` önizleme kuralı da
// burada tutulur (DEPLOY.md § 3). Canlıda boş veritabanına başlangıç verisi kendiliğinden yüklenmez (26 Kas 2026;
// emptySeedSkipReason, DEPLOY.md § 5); betiğin kendisiyle gerçek Postgres'te: tests/predeploy-db.test.ts.
// Çalıştırma: npx tsx --test tests/predeploy.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  emptySeedOverride,
  emptySeedSkipReason,
  emptySeedWarning,
  PRODUCTION_BRANCH,
  predeploySkipReason,
  productionBranchOverride,
  productionBranchRefusal,
} from "../scripts/predeploy-guard";

const DB = "postgres://u:p@host/db";
const LOCAL = { host: "localhost", local: true };
const NEON = { host: "ep-ornek-123.eu-central-1.aws.neon.tech", local: false };

test("boş veritabanına başlangıç verisi: canlıda, önizlemede ve uzak veritabanında yüklenmez; yerelde yüklenir", () => {
  // Canlı: Vercel'in canlı derlemesi ya da NODE_ENV=production; yerel veritabanını gösterse bile
  for (const target of [LOCAL, NEON]) {
    assert.equal(emptySeedSkipReason({ VERCEL_ENV: "production" }, target), "canlı derleme (VERCEL_ENV=production)");
    assert.equal(emptySeedSkipReason({ NODE_ENV: "production" }, target), "canlı ortam (NODE_ENV=production)");
    assert.equal(emptySeedSkipReason({ VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "1" }, target), "önizleme derlemesi (VERCEL_ENV=preview)");
  }
  // Uzak veritabanı (.env.local canlının ya da yeni açılmış bir Neon'un adresini gösterebilir)
  assert.equal(emptySeedSkipReason({}, NEON), "veritabanı bu bilgisayarda değil (ep-ornek-123.eu-central-1.aws.neon.tech)");
  assert.equal(emptySeedSkipReason({ VERCEL_ENV: "development" }, NEON), "veritabanı bu bilgisayarda değil (ep-ornek-123.eu-central-1.aws.neon.tech)");
  // Yerel geliştirme: bugünkü gibi yüklenir
  assert.equal(emptySeedSkipReason({}, LOCAL), null);
  assert.equal(emptySeedSkipReason({ NODE_ENV: "development", VERCEL_ENV: "development" }, LOCAL), null);
  // Açık bayrak her şeyin önünde: 1 yükler (canlıda da), 0 hiçbir yerde yüklemez; başka değer bayrak değildir
  assert.equal(emptySeedSkipReason({ VERCEL_ENV: "production", SEED_ON_EMPTY: "1" }, NEON), null);
  assert.equal(emptySeedSkipReason({ NODE_ENV: "production", SEED_ON_EMPTY: " 1 " }, LOCAL), null);
  assert.equal(emptySeedSkipReason({ SEED_ON_EMPTY: "0" }, LOCAL), "SEED_ON_EMPTY=0");
  for (const v of ["true", "evet", "", "yes"]) {
    assert.equal(emptySeedSkipReason({ VERCEL_ENV: "production", SEED_ON_EMPTY: v }, LOCAL), "canlı derleme (VERCEL_ENV=production)", v);
  }
});

test("SEED_ON_EMPTY=1 canlıda ve uzak veritabanında günlüğe uyarı yazar; yerelde ve bayraksız yazmaz", () => {
  const warned = emptySeedOverride({ VERCEL_ENV: "production", SEED_ON_EMPTY: "1" }, NEON) ?? "";
  assert.match(warned, /^SEED_ON_EMPTY=1: veritabanı boşsa başlangıç verisi \(maaşlar, kira, faturalar, satışlar\) yüklenir\. Değişkeni bu derlemeden sonra kaldırın$/);
  assert.ok(emptySeedOverride({ SEED_ON_EMPTY: "1" }, NEON));
  assert.equal(emptySeedOverride({ SEED_ON_EMPTY: "1" }, LOCAL), null, "yerelde zaten yüklenir");
  assert.equal(emptySeedOverride({ VERCEL_ENV: "production" }, NEON), null);
  assert.equal(emptySeedOverride({ VERCEL_ENV: "production", SEED_ON_EMPTY: "0" }, NEON), null);
  // Uyarı metni: neden, yedekten geri yükleme ve bilerek yükleme yolu
  const w = emptySeedWarning("canlı derleme (VERCEL_ENV=production)");
  assert.match(w, /^Veritabanı boş; başlangıç verisi yüklenmedi: canlı derleme \(VERCEL_ENV=production\)\. /);
  assert.ok(w.includes("npm run db:restore") && w.includes("SEED_ON_EMPTY=1") && w.includes("npm run db:seed"));
});

test("tohum betiği kararı runSeed'e verir: boş veritabanında emptySkip varsa veri yüklenmez, temel kayıtlar yazılır", () => {
  const seed = readFileSync(join(process.cwd(), "scripts/seed.ts"), "utf8");
  const run = seed.slice(seed.indexOf("export async function runSeed"));
  // Boşluk denetimi (hammadde sayısı) → dolu ise temel kayıtlar → emptySkip ise uyarı + temel kayıtlar → veri
  const full = run.indexOf("if (n > 0 && !reset) {");
  const skip = run.indexOf("if (emptySkip && !reset) {");
  const load = run.indexOf("const raw = readSeedData();");
  assert.ok(full > 0 && full < skip && skip < load, "sıra");
  assert.match(run.slice(skip, load), /console\.warn\(`! \$\{emptySeedWarning\(emptySkip\)\}`\);\s*await ensureBasics\(db\);\s*return;/);
  // db:seed ve test:db (emptySkip vermez) bugünkü gibi yükler; varsayılan null
  assert.match(run, /emptySkip = null,/);
});

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
  assert.match(
    src,
    /const skip = predeploySkipReason\(process\.env\);\s*if \(skip\) \{[\s\S]*?return;\s*\}\s*const url = databaseUrl\(shell, process\.env\);\s*await checkRuntimeConnection\(url\);\s*await runMigrations\(url\);[^\n]*\n(\s*\/\/[^\n]*\n)*\s*const target = databaseTarget\(url \?\? ""\);\s*const seedOverride = emptySeedOverride\(process\.env, target\);\s*if \(seedOverride\) console\.warn\(`! \$\{seedOverride\}`\);\s*await runSeed\(\{ url, emptySkip: emptySeedSkipReason\(process\.env, target\) \}\);/,
  );
  // Hedef db:migrate gibi: kabuktaki adres .env.local'dakinden önce (kopya loadEnvConfig'ten önce alınır; denetim AL-02)
  assert.ok(src.indexOf("const shell = { ...process.env };") < src.indexOf("loadEnvConfig(process.cwd());"));
  assert.doesNotMatch(src, /DATABASE_URL_UNPOOLED \?\?/, "boş havuzsuz adres verilmemiş sayılır (AL-03)");
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
  assert.match(
    doc.slice(doc.indexOf("## 2."), doc.indexOf("## 3.")),
    /bekçiyi içeren commit'lerde `main` dışındaki bir dalın Production derlemesi hiç başlamadan durur[^.]*eski dallar durmaz/,
  );
  const s5 = doc.slice(doc.indexOf("## 5."), doc.indexOf("## 6."));
  assert.ok(s5.includes(`\`✗ ${quoted}…\``));
  assert.match(s5, /Bekçiyi içeren bir commit'te `main` dışındaki bir dal[^)]*eski dalların dağıtımları durmaz/);
});

test("DEPLOY.md ve README: bekçi yalnız onu içeren commit'te çalışır; eski dal dağıtımları yeniden derlenmez", () => {
  // 26 Ekim'in dağıtımı (593c536) ve bekçiden önce açılmış dallar bekçiyi içermez: Redeploy → Production onları
  // durdurmaz. Belge bunu mutlak "durur" yazmasın, eski dalın önce main'le birleştirilmesini söylesin.
  const doc = readFileSync(join(process.cwd(), "docs/DEPLOY.md"), "utf8").replace(/\s*\n\s*/g, " ");
  const s7 = doc.slice(doc.indexOf("## 7. Güncelleme ve yedek"), doc.indexOf("## 8."));
  assert.match(s7, /\*\*Bekçi yalnız onu içeren commit'te çalışır\.\*\*/);
  assert.ok(s7.includes("`tsx scripts/predeploy.ts && next build`"));
  assert.match(s7, /`593c536`[^*]*\*\*durmaz\*\*/);
  assert.match(s7, /`verifyMigrations`/);
  assert.match(s7, /eski dal dağıtımları \*\*hiçbir zaman\*\* yeniden derlenmez/);
  assert.match(s7, /dal main'le birleştirilir; böylece hem bekçiyi hem `vercel\.json` › `git\.deploymentEnabled`'ı/);
  // Derleme komutu belgedekiyle aynı (bekçi commit'in kendi betiğinden çalışır)
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.build, "tsx scripts/predeploy.ts && next build");
  // Hiçbir yerde koşulsuz "durur" kalmasın: README satırı da nitelikli
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
  assert.match(readme, /bekçiyi içeren commit'lerde `main` dışındaki bir dalın Production derlemesi veritabanına dokunmadan durur; ondan önce açılmış eski dallar durmaz/);
  const kalan = readFileSync(join(process.cwd(), "docs/planlar/KALAN-ISLER.md"), "utf8").replace(/\s*\n\s*/g, " ");
  assert.match(kalan, /\*\*Ayrıca \(E-10\):\*\* dal bekçisi yalnız onu içeren commit'lerde çalışır/);
});

test("vercel.json: claude/** dallarında önizleme kapalı; DEPLOY.md satırı çıkarmayı önermez (inceleme #45)", () => {
  // Vercel Hobby günde en çok 100 dağıtım açar; 26 Ekim'de sınır doldu ve canlı dağıtımlar da reddedildi. Kuralı
  // kaybeden bir birleştirme (dalda "geçici olarak" çıkarılmış satır) bu testte düşer.
  const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { git?: { deploymentEnabled?: Record<string, boolean> } };
  assert.equal(vercel.git?.deploymentEnabled?.["claude/**"], false);
  const doc = readFileSync(join(process.cwd(), "docs/DEPLOY.md"), "utf8").replace(/\s*\n\s*/g, " ");
  const s3 = doc.slice(doc.indexOf("## 3."), doc.indexOf("## 4."));
  assert.match(s3, /\*\*`claude\/\*\*` dallarında önizleme yok \(26 Eki 2026\)\.\*\*/);
  assert.doesNotMatch(s3, /geçici olarak çıkarılır/);
  assert.match(s3, /önizleme gerekirse dal `claude\/` dışında bir adla açılır/);
  assert.match(s3, /`vercel\.json`'daki satır \*\*çıkarılmaz\*\*/);
});
