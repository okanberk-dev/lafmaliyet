// Veritabanı kotası uyarısı (docs/YEDEK.md › Veritabanı kotası; src/lib/db-quota.ts): kota (DB_QUOTA_MB, varsayılan
// 512), yüzde, %70 ve %90 eşiğinin ilk geçişi (eşik başına bir kez; altına inip yeniden geçerse yine), metinler, zil ve
// Genel bakış şeridi, sabah işinin adımı, e-postanın konusu. Saf; ölçüm, durum ve e-posta veritabanıyla
// tests/yedek-kota-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/db-kota.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  asDbQuotaState,
  DB_QUOTA_DEFAULT_MB,
  DB_QUOTA_HREF,
  EMPTY_DB_QUOTA_STATE,
  QUOTA_REARM_POINTS,
  quotaAlert,
  quotaMb,
  quotaMessage,
  quotaPct,
  quotaPctText,
  quotaReached,
  quotaTone,
  quotaTransition,
  quotaUsageText,
  type DbQuotaState,
  type QuotaLevel,
} from "../src/lib/db-quota";
import { dailyOutcome, quotaStep, STEP_LABELS, stepTexts, systemAlerts, type JobHealth, type JobKey } from "../src/lib/job-health";

const MB = 1024 * 1024;
const plain = (v: string) => v.replace(/[  ]/g, " ");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("kota: DB_QUOTA_MB, yoksa ya da geçersizse 512 MB (Neon ücretsiz)", () => {
  assert.equal(DB_QUOTA_DEFAULT_MB, 512);
  assert.equal(quotaMb(undefined), 512);
  assert.equal(quotaMb(""), 512);
  assert.equal(quotaMb("  "), 512);
  assert.equal(quotaMb("abc"), 512);
  assert.equal(quotaMb("0"), 512);
  assert.equal(quotaMb("-5"), 512);
  assert.equal(quotaMb(" 10240 "), 10240);
  assert.equal(quotaMb("1.5"), 1.5);
});

test("yüzde ve metinler", () => {
  assert.equal(quotaPct(256 * MB, 512), 50);
  assert.equal(quotaPct(-1, 512), 0);
  assert.equal(quotaPct(600 * MB, 512) > 100, true, "kota aşılınca 100'ü geçer");
  assert.equal(quotaPctText(69.99), "%69", "aşağı yuvarlanır: %70 yazıyorsa eşik geçilmiştir");
  assert.equal(quotaPctText(70), "%70");
  assert.equal(plain(quotaUsageText(361.4 * MB, 512)), "361 MB / 512 MB");
  assert.equal(plain(quotaUsageText(7.25 * MB, 512)), "7,3 MB / 512 MB");
  assert.equal(plain(quotaUsageText(900 * MB, 1024)), "900 MB / 1 GB");
  assert.equal(plain(quotaUsageText(900 * MB, 1536)), "900 MB / 1,5 GB");
  assert.equal(quotaTone(69.9), "ok");
  assert.equal(quotaTone(70), "warn");
  assert.equal(quotaTone(90), "bad");
  assert.equal(quotaReached(69.9), 0);
  assert.equal(quotaReached(70), 70);
  assert.equal(quotaReached(95), 90);
});

test("eşik geçişi: her eşik ilk geçişte bir kez; sıçramada yalnız en yükseği; altına inip yeniden geçerse yine", () => {
  // Günlük ölçümler ve beklenen bildirimler
  const days: [number, QuotaLevel, 70 | 90 | null][] = [
    [50, 0, null],
    [70.2, 70, 70],
    [75, 70, null],
    [69, 70, null], // eşiğin hemen altı (2 puan payı): seviye düşmez, yarın yeniden e-posta yok
    [72, 70, null],
    [91, 90, 90],
    [89, 90, null],
    [87.5, 70, null], // %90'ın 2 puandan fazla altı: seviye %70'e iner, bildirim yok
    [90.5, 90, 90], // yeniden geçti: yine bildirilir
    [60, 0, null],
    [71, 70, 70], // %70 de yeniden
    [0, 0, null],
    [95, 90, 90], // %65 → %95 gibi sıçrama: tek "%90"
  ];
  assert.equal(QUOTA_REARM_POINTS, 2);
  let level: QuotaLevel = 0;
  for (const [pct, want, notify] of days) {
    const t = quotaTransition(level, pct);
    assert.deepEqual(t, { level: want, notify }, `%${pct} (önceki seviye ${level})`);
    level = t.level;
  }
});

test("durum kaydı bozuk değeri yutar", () => {
  assert.deepEqual(asDbQuotaState(undefined), EMPTY_DB_QUOTA_STATE);
  assert.deepEqual(asDbQuotaState({ level: 80, since: "x", mailed: "evet", bytes: -3, quotaMb: 0, checkedAt: 5 }), {
    level: 0,
    since: null,
    mailed: true,
    bytes: 0,
    quotaMb: 512,
    checkedAt: null,
  });
  const s: DbQuotaState = { level: 90, since: "2026-11-26T05:00:00.000Z", mailed: false, bytes: 470 * MB, quotaMb: 512, checkedAt: "2026-11-26T05:00:00.000Z" };
  assert.deepEqual(asDbQuotaState(JSON.parse(JSON.stringify(s))), s);
});

test("zil: seviye varken uyarı; %90 Genel bakış şeridinde de; kimlik geçişin gününden", () => {
  assert.equal(quotaAlert(EMPTY_DB_QUOTA_STATE), null);
  const s70: DbQuotaState = { level: 70, since: "2026-11-26T05:00:00.000Z", mailed: true, bytes: 365 * MB, quotaMb: 512, checkedAt: "2026-11-26T05:00:00.000Z" };
  const a70 = quotaAlert(s70);
  assert.ok(a70, "%70 uyarısı");
  assert.equal(a70.id, "db-kota-70-2026-11-26");
  assert.equal(a70.title, "Veritabanı kotasının %70'i doldu");
  assert.equal(plain(a70.body), "365 MB / 512 MB (%71). Henüz bir şey bozulmadı; %90'da yeniden uyarılır. Neon'da ücretli plana geçin ya da geliştiriciden eski kayıtların temizlenmesini isteyin.");
  assert.equal(a70.banner, undefined, "%70 yalnız zilde");
  const a90 = quotaAlert({ ...s70, level: 90, bytes: 470 * MB });
  assert.ok(a90, "%90 uyarısı");
  assert.equal(a90.banner, true);
  assert.equal(a90.actionLabel, "Veritabanı");
  assert.match(a90.body, /Kota dolarsa panel kayıt yazamaz/);
  assert.deepEqual(quotaMessage(90, 470 * MB, 512).title, "Veritabanı kotasının %90'ı doldu");

  // systemAlerts: canlıda, işlerden bağımsız (CRON_SECRET yokken de), "warning"; 503'ü tetiklemez (yalnız danger)
  const now = new Date("2026-11-26T10:00:00+03:00");
  const idle: Record<JobKey, JobHealth> = {
    parasut: { state: "skipped", day: "2026-11-26", run: null },
    gunluk: { state: "ok", day: "2026-11-26", run: null },
  } as unknown as Record<JobKey, JobHealth>;
  const alerts = systemAlerts({ production: true, cronSecret: true, now, health: idle, parasutSyncErrorAt: null, dbQuota: { ...s70, level: 90 } });
  const q = alerts.find((x) => x.id.startsWith("db-kota-"));
  assert.ok(q, "kota uyarısı listede");
  assert.equal(q.level, "warning");
  assert.equal(q.href, DB_QUOTA_HREF);
  assert.equal(q.banner, true);
  assert.equal(DB_QUOTA_HREF, "/panel/ayarlar#veritabani");
  const noSecret = systemAlerts({ production: true, cronSecret: false, now, health: idle, parasutSyncErrorAt: null, dbQuota: s70 });
  assert.ok(noSecret.some((x) => x.id === "db-kota-70-2026-11-26"), "CRON_SECRET yokken de");
  assert.deepEqual(systemAlerts({ production: false, cronSecret: true, now, health: idle, parasutSyncErrorAt: null, dbQuota: s70 }), [], "canlı değil: yok");
  assert.equal(
    systemAlerts({ production: true, cronSecret: true, now, health: idle, parasutSyncErrorAt: null, dbQuota: EMPTY_DB_QUOTA_STATE }).some((x) => x.id.startsWith("db-kota-")),
    false,
  );
});

test("sabah işinin adımı: yalnız eşik geçildiği gün ya da ölçüm hata verdiğinde; geçiş hata değil", () => {
  assert.equal(quotaStep({ status: "ok", notified: null }), undefined);
  assert.deepEqual(quotaStep({ status: "ok", notified: 70 }), { code: "warn70" });
  assert.deepEqual(quotaStep({ status: "ok", notified: 90 }), { code: "warn90" });
  assert.deepEqual(quotaStep({ status: "error", error: "bağlantı yok" }), { code: "error", error: "bağlantı yok" });
  const core = { digest: { code: "sent" }, sync: { code: "ok" }, reminders: { code: "ok" }, karaoke: { code: "ok" }, menu: { code: "ok" }, sales: { code: "ok" } };
  assert.equal(dailyOutcome({ ...core, quota: { code: "warn90" } }).status, "ok");
  assert.equal(dailyOutcome({ ...core, quota: { code: "error", error: "x" } }).status, "partial");
  assert.deepEqual(STEP_LABELS.quota, { warn70: "Veritabanı kotası %70'i geçti", warn90: "Veritabanı kotası %90'ı geçti", error: "Veritabanı kotası ölçülemedi" });
  assert.deepEqual(stepTexts({ quota: "warn70" }), ["Veritabanı kotası %70'i geçti"]);
});

test("kaynakta: ölçüm pg_database_size; e-posta sistem uyarısı kabuğuyla, kendi konusu ve bağlantısıyla", () => {
  const state = read("src/server/db-quota/state.ts");
  assert.match(state, /pg_database_size\(current_database\(\)\)/);
  assert.match(state, /quotaMb\(process\.env\.DB_QUOTA_MB\)/);
  const check = read("src/server/db-quota/check.ts");
  assert.match(check, /sendSystemEmail\(items, at, DB_QUOTA_ABOUT\)/);
  assert.match(check, /key: `db-kota:\$\{mailLevel\}:\$\{day\}`/);
  const tpl = read("src/server/notify/digest-template.ts");
  assert.match(tpl, /export const DB_QUOTA_ABOUT: SystemAlertAbout = \{\s*label: "Veritabanı",/);
  assert.match(tpl, /link: \{ href: `\$\{APP_URL\}\/panel\/ayarlar#veritabani`, label: "Veritabanı kullanımını aç" \}/);
  // Bekçinin e-postası değişmedi: varsayılan konu Günlük işler
  assert.match(tpl, /export function renderSystemAlert\(items: DigestSystem\["items"\], today: string, about: SystemAlertAbout = JOBS_ABOUT\)/);
  // Ayarlar kartı yalnız okur; sayfa yönetici (requireAdmin)
  const card = read("src/app/panel/ayarlar/database-card.tsx");
  assert.match(card, /id="veritabani"/);
  assert.match(card, /role="meter"/);
  assert.match(read("src/app/panel/ayarlar/page.tsx"), /async function SettingsContent\(\) \{\s*(const me = )?await requireAdmin\(\);/);
  // Bildirim zil ve şeride sistem uyarısı olarak (yalnız yönetici) gider
  assert.match(read("src/server/jobs/alerts.ts"), /systemAlerts\(\{ production, cronSecret, now, health, parasutSyncErrorAt, lastBackupAt, dbQuota, runs \}\)/);
});
