// Günlük işlerin sağlığı (src/lib/job-health.ts): hangi günün çalışmasına bakılır, durum, adım sonuçları, zil /
// Genel bakış uyarıları ve e-postadaki sistem uyarıları. Saatler İstanbul'a göre (UTC+3).
// Çalıştırma: npx tsx --test tests/gunluk-isler.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  CUT_OFF_MESSAGE,
  dailyOutcome,
  digestStep,
  emailProblems,
  expectedDay,
  jobHealth,
  jobsSummary,
  parasutOutcome,
  photosStep,
  reminderStep,
  stepTexts,
  systemAlerts,
  trClock,
  watchRestarts,
  type JobHealth,
  type JobKey,
  type JobRunLite,
  type RunStatus,
} from "../src/lib/job-health";
import { capped, JOB_SEND_DEADLINE_MS, JOB_TAIL_DEADLINE_MS, TAIL_STEP_MS, tailStepDeadline } from "../src/server/jobs/capped";

/** İstanbul saatiyle "2026-10-22 08:10" → Date */
const tr = (s: string) => new Date(`${s.replace(" ", "T")}:00+03:00`);

let nextId = 1;
const run = (job: JobKey, startedTR: string, status: RunStatus, over: Partial<JobRunLite> = {}): JobRunLite => ({
  id: nextId++,
  job,
  status,
  startedAt: tr(startedTR).toISOString(),
  finishedAt: status === "running" ? null : new Date(tr(startedTR).getTime() + 12_000).toISOString(),
  steps: null,
  message: null,
  ...over,
});

const OLD_WATCH = tr("2026-10-01 00:00").toISOString();

test("İstanbul saati ve gün: UTC gece yarısından önce/sonra", () => {
  assert.deepEqual(trClock(tr("2026-10-22 07:59")), { day: "2026-10-22", minutes: 479 });
  assert.deepEqual(trClock(new Date("2026-10-21T23:59:00Z")), { day: "2026-10-22", minutes: 179 });
  assert.deepEqual(trClock(new Date("2026-10-21T20:59:00Z")), { day: "2026-10-21", minutes: 1439 });
});

test("beklenen gün: pencere sonu + 30 dk geçince bugün", () => {
  assert.equal(expectedDay("parasut", tr("2026-10-22 07:59")), "2026-10-21");
  assert.equal(expectedDay("parasut", tr("2026-10-22 08:29")), "2026-10-21");
  assert.equal(expectedDay("parasut", tr("2026-10-22 08:30")), "2026-10-22");
  assert.equal(expectedDay("gunluk", tr("2026-10-22 09:29")), "2026-10-21");
  assert.equal(expectedDay("gunluk", tr("2026-10-22 09:30")), "2026-10-22");
  // Bekleme olmadan (sabah e-postasında Paraşüt işi)
  assert.equal(expectedDay("parasut", tr("2026-10-22 08:05"), 0), "2026-10-22");
});

test("durum: çalıştı, çalışmadı, hata, kısmen", () => {
  const now = tr("2026-10-22 10:00");
  const ok = jobHealth("gunluk", [run("gunluk", "2026-10-22 08:10", "ok")], now, { watchSince: OLD_WATCH });
  assert.equal(ok.state, "ok");
  assert.equal(ok.day, "2026-10-22");
  assert.equal(jobHealth("gunluk", [], now, { watchSince: OLD_WATCH }).state, "late");
  assert.equal(jobHealth("gunluk", [run("gunluk", "2026-10-22 08:10", "error")], now, { watchSince: OLD_WATCH }).state, "failed");
  assert.equal(jobHealth("gunluk", [run("gunluk", "2026-10-22 08:10", "partial")], now, { watchSince: OLD_WATCH }).state, "partial");
  assert.equal(jobHealth("parasut", [run("parasut", "2026-10-22 07:30", "skipped")], now, { watchSince: OLD_WATCH }).state, "skipped");
  // Başka işin satırı sayılmaz
  assert.equal(jobHealth("parasut", [run("gunluk", "2026-10-22 08:10", "ok")], now, { watchSince: OLD_WATCH }).state, "late");
});

test("izleme başlangıcı: ilk yayının sabahı yanlış alarm yok", () => {
  const now = tr("2026-10-22 10:00");
  // Yayın pencere açıldıktan sonra: iş eski kodla, kayıt yazmadan çalışmış olabilir
  assert.equal(jobHealth("gunluk", [], now, { watchSince: tr("2026-10-22 08:30").toISOString() }).state, "waiting");
  assert.equal(jobHealth("gunluk", [], now, { watchSince: null }).state, "waiting");
  // Yayın pencereden önce: çalışmalıydı
  assert.equal(jobHealth("gunluk", [], now, { watchSince: tr("2026-10-22 06:00").toISOString() }).state, "late");
});

test("sürüyor 2 dk, yarıda kesildi 6 dk", () => {
  const runs = [run("parasut", "2026-10-22 07:30", "running")];
  assert.equal(jobHealth("parasut", runs, tr("2026-10-22 07:32"), { watchSince: OLD_WATCH }).state, "running");
  assert.equal(jobHealth("parasut", runs, tr("2026-10-22 07:36"), { watchSince: OLD_WATCH }).state, "stuck");
});

test("aynı gün sonraki başarılı çalışma önceki hatanın yerine geçer; atlanan çalışma sonucu örtmez", () => {
  const now = tr("2026-10-22 10:00");
  const fixed = [run("gunluk", "2026-10-22 08:05", "error"), run("gunluk", "2026-10-22 08:40", "ok")];
  assert.equal(jobHealth("gunluk", fixed, now, { watchSince: OLD_WATCH }).state, "ok");
  const doubled = [run("parasut", "2026-10-22 07:30", "error"), run("parasut", "2026-10-22 07:31", "skipped", { message: "Başka bir eşitleme sürüyordu" })];
  assert.equal(jobHealth("parasut", doubled, now, { watchSince: OLD_WATCH }).state, "failed");
});

test("bugün zaten çalıştıysa bugünün sonucu; çalışmadıysa dün; gece 23:00'teki elle çalıştırma o güne sayılır", () => {
  const yesterdayFailed = run("gunluk", "2026-10-21 08:10", "error");
  // 08:20: pencere bitmedi ama bugünkü çalışma bitti → dünkü hata artık uyarı değil
  const h = jobHealth("gunluk", [yesterdayFailed, run("gunluk", "2026-10-22 08:05", "ok")], tr("2026-10-22 08:20"), { watchSince: OLD_WATCH });
  assert.equal(h.state, "ok");
  assert.equal(h.day, "2026-10-22");
  // 08:20 ve bugün henüz çalışmadı → dün
  const y = jobHealth("gunluk", [yesterdayFailed], tr("2026-10-22 08:20"), { watchSince: OLD_WATCH });
  assert.equal(y.state, "failed");
  assert.equal(y.day, "2026-10-21");
  // Dün sabah hata, akşam 23:00'te elle çalıştırıldı ve düzeldi
  const manual = jobHealth("gunluk", [yesterdayFailed, run("gunluk", "2026-10-21 23:00", "ok")], tr("2026-10-22 08:20"), { watchSince: OLD_WATCH });
  assert.equal(manual.state, "ok");
  assert.equal(manual.lastOk?.startedAt, tr("2026-10-21 23:00").toISOString());
});

test("sabah işinin sonucu: e-posta hatası 'error', başka adım hatası 'partial'", () => {
  const ok = { code: "ok" };
  const base = { sync: { code: "today" }, digest: { code: "sent" }, reminders: ok, karaoke: { code: "fresh" }, menu: ok, sales: ok };
  assert.deepEqual(dailyOutcome(base), {
    status: "ok",
    steps: { digest: "sent", sync: "today", reminders: "ok", karaoke: "fresh", menu: "ok", sales: "ok" },
    message: null,
  });
  const menu = dailyOutcome({ ...base, menu: { code: "error", error: "Site yanıt vermedi (HTTP 500)" } });
  assert.equal(menu.status, "partial");
  assert.equal(menu.message, "Menü eşitlemesi: Site yanıt vermedi (HTTP 500)");
  assert.equal(dailyOutcome({ ...base, sync: { code: "error", error: "401" } }).status, "partial");
  const mail = dailyOutcome({ ...base, digest: { code: "error", error: "Resend yanıt vermiyor" }, sales: { code: "error", error: "zaman aşımı" } });
  assert.equal(mail.status, "error");
  assert.equal(mail.message, "Sabah e-postası: Resend yanıt vermiyor · Online satışlar: zaman aşımı");
  // E-posta kapalı ya da gönderilecek bir şey yok: sorun değil
  assert.equal(dailyOutcome({ ...base, digest: { code: "off" } }).status, "ok");
  assert.equal(dailyOutcome({ ...base, digest: { code: "skipped" } }).status, "ok");
});

test("Paraşüt işinin sonucu", () => {
  assert.deepEqual(parasutOutcome({ configured: false }), { status: "skipped", steps: { sync: "off" }, message: "Paraşüt bağlı değil" });
  assert.deepEqual(parasutOutcome({ configured: true, result: { ok: false, busy: true, error: "x" } }), {
    status: "skipped",
    steps: { sync: "busy" },
    message: "Başka bir eşitleme sürüyordu",
  });
  assert.deepEqual(parasutOutcome({ configured: true, result: { ok: false, error: "Paraşüt oturumu açılamadı" } }), {
    status: "error",
    steps: { sync: "error" },
    message: "Paraşüt oturumu açılamadı",
  });
  assert.deepEqual(parasutOutcome({ configured: true, result: { ok: true }, watchdog: "sent" }), { status: "ok", steps: { sync: "ok", watchdog: "sent" }, message: null });
  assert.equal(parasutOutcome({ configured: true, error: "bağlantı koptu", watchdog: "none" }).status, "error");
  assert.deepEqual(parasutOutcome({ configured: true, error: "bağlantı koptu", watchdog: "none" }).steps, { sync: "error" });
});

test("adımların ekrandaki sözcükleri", () => {
  assert.deepEqual(stepTexts({ sync: "today", digest: "sent", karaoke: "ok", menu: "error", sales: "ok", reminders: "none" }), [
    "E-posta gönderildi",
    "Paraşüt bugün eşitlenmişti",
    "Bugün kişisel hatırlatıcı yok",
    "Karaoke tamam",
    "Menü hata",
    "Online satış tamam",
  ]);
  assert.deepEqual(stepTexts({ sync: "ok", watchdog: "sent" }), ["Paraşüt eşitlendi", "Sistem uyarısı e-postası gitti"]);
  assert.deepEqual(stepTexts(null), []);
});

const health = (now: Date, runs: JobRunLite[], watchSince: string | null = OLD_WATCH): Record<JobKey, JobHealth> => ({
  parasut: jobHealth("parasut", runs, now, { watchSince }),
  gunluk: jobHealth("gunluk", runs, now, { watchSince }),
});

test("uyarılar: canlı değilse yok; CRON_SECRET yoksa yalnız o", () => {
  const now = tr("2026-10-22 10:00");
  assert.deepEqual(systemAlerts({ production: false, cronSecret: true, now, health: health(now, []), parasutSyncErrorAt: null }), []);
  const noSecret = systemAlerts({ production: true, cronSecret: false, now, health: health(now, []), parasutSyncErrorAt: null });
  assert.deepEqual(
    noSecret.map((a) => [a.id, a.level, a.title, a.href]),
    [["is-cron-secret", "danger", "Günlük işler kapalı", "/panel/ayarlar#isler"]],
  );
  assert.equal(noSecret[0].day, null);
});

test("uyarılar: sabah işi çalışmadı, Paraşüt işi çalışmadı; önce ciddi olanlar", () => {
  const now = tr("2026-10-22 10:00");
  const a = systemAlerts({ production: true, cronSecret: true, now, health: health(now, []), parasutSyncErrorAt: null });
  assert.deepEqual(
    a.map((x) => [x.id, x.level, x.title]),
    [
      ["is-gunluk-late-2026-10-22", "danger", "Sabah işi çalışmadı"],
      ["is-parasut-late-2026-10-22", "warning", "Paraşüt işi bu sabah çalışmadı"],
    ],
  );
  assert.match(a[0].body, /^22 Ekim Perşembe 08:00–09:00 arasında çalışması gerekiyordu\. Sabah e-postası gitmedi/);
  // 07:10: iki iş de dün için değerlendirilir
  const early = tr("2026-10-22 07:10");
  const y = systemAlerts({ production: true, cronSecret: true, now: early, health: health(early, [run("gunluk", "2026-10-21 08:05", "ok")]), parasutSyncErrorAt: null });
  assert.deepEqual(y.map((x) => [x.id, x.title]), [["is-parasut-late-2026-10-21", "Paraşüt işi dün sabah çalışmadı"]]);
});

test("uyarılar: hata, yarıda kesildi, kısmen; sıralama", () => {
  const now = tr("2026-10-22 10:00");
  const partial = run("gunluk", "2026-10-22 08:05", "partial", { message: "Menü eşitlemesi: HTTP 500" });
  const pFail = run("parasut", "2026-10-22 07:30", "error", { message: "Paraşüt oturumu açılamadı" });
  const a = systemAlerts({ production: true, cronSecret: true, now, health: health(now, [partial, pFail]), parasutSyncErrorAt: null });
  assert.deepEqual(
    a.map((x) => [x.id, x.level, x.title, x.body]),
    [
      [`is-parasut-failed-${pFail.id}`, "danger", "Paraşüt işi hata verdi", "Paraşüt oturumu açılamadı"],
      [`is-gunluk-partial-${partial.id}`, "warning", "Sabah işinde bir adım hata verdi", "Menü eşitlemesi: HTTP 500"],
    ],
  );
  const stuck = run("gunluk", "2026-10-22 08:05", "running");
  const s = systemAlerts({ production: true, cronSecret: true, now, health: health(now, [stuck, run("parasut", "2026-10-22 07:30", "ok")]), parasutSyncErrorAt: null });
  assert.deepEqual(s.map((x) => [x.id, x.title]), [[`is-gunluk-stuck-${stuck.id}`, "Sabah işi yarıda kesildi"]]);
  const failed = run("gunluk", "2026-10-22 08:05", "error", { message: "x".repeat(400) });
  const f = systemAlerts({ production: true, cronSecret: true, now, health: health(now, [failed, run("parasut", "2026-10-22 07:30", "ok")]), parasutSyncErrorAt: null });
  assert.equal(f[0].title, "Sabah işi hata verdi");
  assert.equal(f[0].body.length, 200);
  // Sorunsuz gün: uyarı yok
  const fine = [run("gunluk", "2026-10-22 08:05", "ok"), run("parasut", "2026-10-22 07:30", "skipped")];
  assert.deepEqual(systemAlerts({ production: true, cronSecret: true, now, health: health(now, fine), parasutSyncErrorAt: null }), []);
});

test("uyarılar: Paraşüt işinin hatası eşitlemenin kendi hatası olarak zilde varsa yinelenmez", () => {
  const now = tr("2026-10-22 10:00");
  const pFail = run("parasut", "2026-10-22 07:30", "error", { message: "Paraşüt oturumu açılamadı" });
  const runs = [pFail, run("gunluk", "2026-10-22 08:05", "ok")];
  const surfaced = tr("2026-10-22 07:30").getTime() + 2000;
  assert.deepEqual(systemAlerts({ production: true, cronSecret: true, now, health: health(now, runs), parasutSyncErrorAt: new Date(surfaced).toISOString() }), []);
  // Eşitleme hatası daha eski (dünkü): bu çalışmanın hatası ayrıca söylenir
  const older = systemAlerts({ production: true, cronSecret: true, now, health: health(now, runs), parasutSyncErrorAt: tr("2026-10-21 07:30").toISOString() });
  assert.deepEqual(older.map((x) => x.id), [`is-parasut-failed-${pFail.id}`]);
});

test("e-posta: bekçi dünkü sabah işini söyler, Paraşüt işini söylemez", () => {
  const now = tr("2026-10-22 07:30");
  const late = emailProblems({ now, mode: "watchdog", runs: [], watchSince: OLD_WATCH, syncedToday: false });
  assert.deepEqual(late, [
    {
      key: "job:gunluk:2026-10-21:late",
      title: "Dünkü sabah işi çalışmadı (21 Ekim)",
      body: "08:00–09:00 arasında çalışması gerekiyordu: sabah e-postası gitmedi, hatırlatıcı bildirimi ve laffogato.net eşitlemeleri yapılmadı.",
    },
  ]);
  const failed = emailProblems({ now, mode: "watchdog", runs: [run("gunluk", "2026-10-21 08:05", "error", { message: "Sabah e-postası: Resend yanıt vermiyor" })], watchSince: OLD_WATCH, syncedToday: false });
  assert.deepEqual(failed.map((p) => [p.key, p.title, p.body]), [["job:gunluk:2026-10-21:failed", "Dünkü sabah işi hata verdi", "Sabah e-postası: Resend yanıt vermiyor"]]);
  // Yalnız bir adımı hata veren gün: e-posta gitmişti, bekçi ayrı e-posta atmaz; sabah e-postası söyler
  const partialRuns = [run("gunluk", "2026-10-21 08:05", "partial", { message: "Menü eşitlemesi: HTTP 500" })];
  assert.deepEqual(emailProblems({ now, mode: "watchdog", runs: partialRuns, watchSince: OLD_WATCH, syncedToday: false }), []);
  const partial = emailProblems({ now: tr("2026-10-22 08:05"), mode: "digest", runs: [...partialRuns, run("parasut", "2026-10-22 07:30", "ok")], watchSince: OLD_WATCH, syncedToday: true });
  assert.deepEqual(partial.map((p) => [p.key, p.title, p.body]), [["job:gunluk:2026-10-21:partial", "Dünkü sabah işinde bir adım hata verdi", "Menü eşitlemesi: HTTP 500"]]);
  const stuck = emailProblems({ now, mode: "watchdog", runs: [run("gunluk", "2026-10-21 08:05", "running")], watchSince: OLD_WATCH, syncedToday: false });
  assert.deepEqual(stuck.map((p) => p.key), ["job:gunluk:2026-10-21:stuck"]);
  // Dün sorunsuz: e-posta yok
  assert.deepEqual(emailProblems({ now, mode: "watchdog", runs: [run("gunluk", "2026-10-21 08:05", "ok")], watchSince: OLD_WATCH, syncedToday: false }), []);
});

test("e-posta: sabah e-postası bugün süren kendi çalışmasına rağmen dünü, bekleme olmadan bugünkü Paraşüt işini söyler", () => {
  const now = tr("2026-10-22 08:05");
  const runs = [run("gunluk", "2026-10-21 08:05", "error", { message: "Sabah e-postası: Resend yanıt vermiyor" }), run("gunluk", "2026-10-22 08:04", "running")];
  const items = emailProblems({ now, mode: "digest", runs, watchSince: OLD_WATCH, syncedToday: true });
  assert.deepEqual(
    items.map((p) => [p.key, p.title, p.body]),
    [
      ["job:gunluk:2026-10-21:failed", "Dünkü sabah işi hata verdi", "Sabah e-postası: Resend yanıt vermiyor"],
      ["job:parasut:2026-10-22:late", "Paraşüt işi bu sabah çalışmadı", "Eşitlemeyi sabah işi yaptı."],
    ],
  );
  const notSynced = emailProblems({ now, mode: "digest", runs: [run("gunluk", "2026-10-21 08:05", "ok"), run("parasut", "2026-10-22 07:30", "running")], watchSince: OLD_WATCH, syncedToday: false });
  assert.deepEqual(notSynced.map((p) => [p.key, p.body]), [["job:parasut:2026-10-22:stuck", "Bugün eşitleme de yapılamadı."]]);
  // Paraşüt işi çalıştı (hatası e-postada zaten "Paraşüt eşitlemesi başarısız"): yinelenmez
  assert.deepEqual(emailProblems({ now, mode: "digest", runs: [run("gunluk", "2026-10-21 08:05", "ok"), run("parasut", "2026-10-22 07:30", "error")], watchSince: OLD_WATCH, syncedToday: false }), []);
  // Sabah 06:00'da elle gönderim: Paraşüt'ün penceresi daha gelmedi
  assert.deepEqual(emailProblems({ now: tr("2026-10-22 06:00"), mode: "digest", runs: [run("gunluk", "2026-10-21 08:05", "ok")], watchSince: OLD_WATCH, syncedToday: false }), []);
});

test("e-posta: yarıda kesilen sabah işi bekçide ve satır kapandıktan sonra sabah e-postasında aynı anahtar", () => {
  const cut = run("gunluk", "2026-10-21 08:05", "running");
  const watchdog = emailProblems({ now: tr("2026-10-22 07:30"), mode: "watchdog", runs: [cut], watchSince: OLD_WATCH, syncedToday: false });
  assert.deepEqual(watchdog.map((p) => [p.key, p.title]), [["job:gunluk:2026-10-21:stuck", "Dünkü sabah işi yarıda kesildi"]]);
  // 08:05: bugünkü sabah işi başlarken dünkü satırı "hata" olarak kapatır (runs.ts › startJobRun)
  const closed: JobRunLite = { ...cut, status: "error", finishedAt: tr("2026-10-22 08:05").toISOString(), message: CUT_OFF_MESSAGE };
  const runs = [closed, run("gunluk", "2026-10-22 08:05", "running"), run("parasut", "2026-10-22 07:30", "ok")];
  const digest = emailProblems({ now: tr("2026-10-22 08:06"), mode: "digest", runs, watchSince: OLD_WATCH, syncedToday: true });
  assert.deepEqual(digest.map((p) => p.key), ["job:gunluk:2026-10-21:stuck"]);
  // Panelde de "yarıda kesildi"; gerçek hata yine "hata verdi"
  assert.equal(jobHealth("gunluk", [closed], tr("2026-10-22 08:20"), { watchSince: OLD_WATCH }).state, "stuck");
  const failed = { ...closed, message: "Sabah e-postası: Resend yanıt vermiyor" };
  assert.equal(jobHealth("gunluk", [failed], tr("2026-10-22 08:20"), { watchSince: OLD_WATCH }).state, "failed");
});

test("kart özeti: bekleyen iş, kısmen, sürüyor; 'ikisi de çalıştı' yalnız ikisi de bugün çalışıp bittiyse", () => {
  const now = tr("2026-10-22 14:00");
  const sum = (runs: JobRunLite[], watchSince: string | null = OLD_WATCH) => jobsSummary({ production: true, cronSecret: true, health: health(now, runs, watchSince) }, now);
  // Yayın bugün 10:00'da, henüz kayıt yok: iki iş de bekleniyor
  const deployed = tr("2026-10-22 10:00").toISOString();
  assert.equal(sum([], deployed), "İlk çalışma bekleniyor");
  assert.equal(sum([run("parasut", "2026-10-22 07:30", "ok")], deployed), "İlk çalışma bekleniyor");
  const pOk = run("parasut", "2026-10-22 07:30", "ok");
  assert.equal(sum([pOk, run("gunluk", "2026-10-22 08:10", "ok")]), "Bu sabah ikisi de çalıştı");
  assert.equal(sum([run("parasut", "2026-10-22 07:30", "skipped"), run("gunluk", "2026-10-22 08:10", "ok")]), "Bu sabah ikisi de çalıştı");
  assert.equal(sum([pOk, run("gunluk", "2026-10-22 08:10", "partial")]), "Sabah işinde bir adım hata verdi");
  assert.equal(jobsSummary({ production: true, cronSecret: true, health: health(tr("2026-10-22 08:11"), [pOk, run("gunluk", "2026-10-22 08:10", "running")]) }, tr("2026-10-22 08:11")), "Bir iş şu an sürüyor");
  // 07:10: ikisi de dün için değerlendirilir
  const early = tr("2026-10-22 07:10");
  const y = [run("parasut", "2026-10-21 07:30", "ok"), run("gunluk", "2026-10-21 08:10", "ok")];
  assert.equal(jobsSummary({ production: true, cronSecret: true, health: health(early, y) }, early), "Son çalışmalar sorunsuz");
  assert.equal(sum([], OLD_WATCH), "Sabah işi çalışmadı");
  assert.equal(jobsSummary(null, now), "Durum okunamadı");
  assert.equal(jobsSummary({ production: false, cronSecret: true, health: health(now, []) }, now), "Yalnız canlıda çalışır");
});

test("adımlar gerçekte olanı söyler: cihazı olmayan hatırlatıcı, alıcısız e-posta", () => {
  assert.deepEqual(reminderStep({ users: 2, sent: 3, failed: 1 }), { code: "ok" });
  assert.deepEqual(reminderStep({ users: 1, sent: 0, failed: 0 }), { code: "nodevice" });
  assert.deepEqual(reminderStep({ users: 0, sent: 0, failed: 0 }), { code: "none" });
  assert.deepEqual(reminderStep({ users: 1, sent: 0, failed: 2 }), { code: "error", error: "2 cihaza gönderilemedi" });
  assert.deepEqual(reminderStep({ error: "bağlantı koptu" }), { code: "error", error: "bağlantı koptu" });
  assert.deepEqual(digestStep({ status: "sent" }), { code: "sent" });
  assert.deepEqual(digestStep({ status: "skipped" }), { code: "skipped" });
  assert.deepEqual(digestStep({ status: "skipped", off: "disabled" }), { code: "off" });
  assert.deepEqual(digestStep({ status: "skipped", off: "nokey" }), { code: "nokey" });
  assert.equal(digestStep({ status: "skipped", off: "norecipient" }).code, "norecipient");
  assert.deepEqual(digestStep({ status: "error", error: "Resend yanıt vermiyor" }), { code: "error", error: "Resend yanıt vermiyor" });
  assert.deepEqual(stepTexts({ digest: "norecipient", reminders: "nodevice" }), ["E-posta gitmedi: bildirim adresi yok", "Hatırlatıcı var, bildirim açık cihaz yok"]);
  assert.deepEqual(stepTexts({ digest: "nokey" }), ["E-posta: Resend kurulmadı"]);
  // Gönderilecek bir şey varken alıcı yok: iş "kısmen", mesajda neden
  const ok = { code: "ok" };
  const base = { sync: { code: "today" }, reminders: ok, karaoke: ok, menu: ok, sales: ok };
  const lonely = dailyOutcome({ ...base, digest: digestStep({ status: "skipped", off: "norecipient" }) });
  assert.equal(lonely.status, "partial");
  assert.equal(lonely.message, "Sabah e-postası: gönderilecek bir şey vardı ama etkin bildirim adresi yok");
  assert.equal(dailyOutcome({ ...base, digest: digestStep({ status: "skipped", off: "nokey" }) }).status, "ok");
  assert.equal(dailyOutcome({ ...base, digest: { code: "sent" }, reminders: reminderStep({ users: 1, sent: 0, failed: 0 }) }).status, "ok");
});

test("izleme başlangıcı canlı derlemede yalnız işler bir günden uzun süredir kayıt yazmadıysa yeniden başlar", () => {
  const now = tr("2026-10-22 14:00");
  assert.equal(watchRestarts(null, now), true);
  assert.equal(watchRestarts(tr("2026-10-22 08:05").toISOString(), now), false);
  // Dünkü 08:05'ten bu yana: 30 saat (eski sürüme dönülmüş ya da önceki derleme bozulmuş)
  assert.equal(watchRestarts(tr("2026-10-21 08:05").toISOString(), now), true);
  // Sabah 07:05'teki yayın, dünkü 07:59 çalışmasından sonra: yeniden başlamaz
  assert.equal(watchRestarts(tr("2026-10-21 07:59").toISOString(), tr("2026-10-22 07:05")), false);
});

test("rotalar çalışmayı kaydeder; sabah işi e-postaya eşitleme bilgisini verir", () => {
  const parasut = readFileSync(join(process.cwd(), "src/app/api/cron/parasut/route.ts"), "utf8");
  assert.match(parasut, /const denied = await rejectUnlessCron\(request\);\s*if \(denied\) return denied;[\s\S]*startJobRun\("parasut"\)/);
  assert.match(parasut, /finally \{\s*await finishJobRun\(runId, outcome\);/);
  assert.match(parasut, /deadlineMs: Math\.max\(20_000, 45_000 - \(Date\.now\(\) - started\)\)/);
  const gunluk = readFileSync(join(process.cwd(), "src/app/api/cron/gunluk/route.ts"), "utf8");
  assert.match(gunluk, /const denied = await rejectUnlessCron\(request\);\s*if \(denied\) return denied;\s*const runId = await startJobRun\("gunluk"\)/);
  assert.match(gunluk, /runReminderDigest\("cron", \{ syncedToday: alreadySynced \|\| Boolean\(sync\?\.ok\), sendDeadlineAt: jobStart \+ JOB_SEND_DEADLINE_MS \}\)/);
  assert.match(gunluk, /finally \{\s*await finishJobRun\(runId, outcome\);/);
  assert.match(gunluk, /reminders: reminderStep\(reminders\)/);
  assert.match(gunluk, /digest: digestStep\(result\)/);
  const runsSrc = readFileSync(join(process.cwd(), "src/server/jobs/runs.ts"), "utf8");
  assert.match(runsSrc, /\.set\(\{ status: "error", finishedAt: new Date\(now\), message: CUT_OFF_MESSAGE \}\)/);
});

test("okuyan ekranlar yazmaz: izleme başlangıcını yalnız derleme ve iş başlangıcı yazar", () => {
  const runs = readFileSync(join(process.cwd(), "src/server/jobs/runs.ts"), "utf8");
  const read = runs.slice(runs.indexOf("export async function readWatchSince"), runs.indexOf("export async function parasutSyncedToday"));
  assert.doesNotMatch(read, /insert|update|markWatchSince/);
  const alerts = readFileSync(join(process.cwd(), "src/server/jobs/alerts.ts"), "utf8");
  assert.doesNotMatch(alerts, /markWatchSince|insert\(s\.integrationState\)/);
  const predeploy = readFileSync(join(process.cwd(), "scripts/predeploy.ts"), "utf8");
  assert.match(predeploy, /if \(process\.env\.VERCEL_ENV === "production"\) await markJobsWatched\(\);/);
  assert.match(predeploy, /await restartWatchOnDeploy\(db\)/);
});

test("isteğe bağlı adımlar: verilmeyen hiç yazılmaz; sıra e-posta, eşitleme, … , fotoğraf, sayım, haftalık; yalnız hata kısmen yapar", () => {
  const ok = { code: "ok" };
  const base = { sync: { code: "today" }, digest: { code: "sent" }, reminders: ok, karaoke: ok, menu: ok, sales: ok };
  // Verilmeyen isteğe bağlı adım: eskisiyle aynı sonuç
  assert.deepEqual(Object.keys(dailyOutcome(base).steps), ["digest", "sync", "reminders", "karaoke", "menu", "sales"]);
  const all = dailyOutcome({ ...base, weekly: { code: "off" }, photos: { code: "none" }, forecast: { code: "noweather" }, count: { code: "sent" } });
  assert.deepEqual(Object.keys(all.steps), ["digest", "sync", "reminders", "karaoke", "menu", "sales", "forecast", "photos", "count", "weekly"]);
  assert.equal(all.status, "ok");
  const photos = dailyOutcome({ ...base, photos: { code: "error", error: "3 fotoğraf depodan silinemedi" } });
  assert.equal(photos.status, "partial");
  assert.equal(photos.message, "Fotoğraf temizliği: 3 fotoğraf depodan silinemedi");
  assert.equal(dailyOutcome({ ...base, digest: { code: "error", error: "x" }, photos: { code: "off" } }).status, "error");
  assert.deepEqual(stepTexts({ photos: "ok" }), ["Eski fotoğraflar silindi"]);
  assert.deepEqual(stepTexts({ photos: "none", forecast: "nodata", count: "sent", weekly: "late" }), [
    "Tahmin: veri yok",
    "Silinecek fotoğraf yok",
    "Hızlı sayım bildirimi gitti",
    "Haftalık özet: süre yetmedi, yarın denenecek",
  ]);
  assert.deepEqual(stepTexts({ photos: "off" }), ["Fotoğraf deposu yok"]);
  assert.deepEqual(stepTexts({ photos: "error" }), ["Fotoğraf temizliği hata"]);
});

test("fotoğraf temizliğinin adımı: silindi, silinecek yok, depo yok, silinemeyen ve hata", () => {
  assert.deepEqual(photosStep({ deleted: 12, failed: 0, off: false }), { code: "ok" });
  assert.deepEqual(photosStep({ deleted: 0, failed: 0, off: false }), { code: "none" });
  assert.deepEqual(photosStep({ deleted: 0, failed: 0, off: true }), { code: "off" });
  assert.deepEqual(photosStep({ deleted: 0, failed: 4, off: false }), { code: "error", error: "4 fotoğraf depodan silinemedi" });
  assert.deepEqual(photosStep({ error: "süre doldu" }), { code: "error", error: "süre doldu" });
});

test("zaman bütçesi: capped süresi dolunca yedek değeri döner, zamanlayıcıyı temizler; kuyruk adımı en çok 8 sn ve 55. saniyeyi aşmaz", async () => {
  assert.equal(await capped(Promise.resolve("bitti"), 1000, "süre doldu"), "bitti");
  assert.equal(await capped(new Promise<string>(() => {}), 10, "süre doldu"), "süre doldu");
  assert.equal(await capped(new Promise<string>((r) => setTimeout(() => r("geç"), 50)), 5, "süre doldu"), "süre doldu");
  assert.equal(await capped(Promise.resolve(1), -5, 0), 1);
  // Kısa iş uzun sınırı beklemez (zamanlayıcı kalsaydı test 30 sn askıda kalırdı)
  const t0 = Date.now();
  await capped(Promise.resolve(true), 30_000, false);
  assert.ok(Date.now() - t0 < 1000);

  assert.equal(JOB_SEND_DEADLINE_MS, 48_000);
  assert.equal(JOB_TAIL_DEADLINE_MS, 55_000);
  const start = 1_000_000;
  assert.equal(tailStepDeadline(start, start + 10_000), start + 10_000 + TAIL_STEP_MS);
  assert.equal(tailStepDeadline(start, start + 50_000), start + 55_000);
  assert.equal(tailStepDeadline(start, start + 58_000), start + 55_000);
});

test("sabah işi: fotoğraf temizliği kuyrukta, en çok 100 fotoğraf, kendi sınırıyla; iş başı istekle", () => {
  const gunluk = readFileSync(join(process.cwd(), "src/app/api/cron/gunluk/route.ts"), "utf8");
  assert.match(gunluk, /export const maxDuration = 60;/);
  assert.match(gunluk, /const jobStart = Date\.now\(\);\s*const denied = await rejectUnlessCron\(request\);/);
  assert.match(gunluk, /cleanupPhotos\(\{ limit: 100, deadlineAt \}\)/);
  assert.match(gunluk, /photos: photosStep\(photos\)/);
});

test("isteğe bağlı adımların sözcükleri: satış tahmini, hızlı sayım, haftalık özet; hata mesajı adımın adıyla, yalnız hata kısmen yapar", () => {
  const ok = { code: "ok" };
  const base = { sync: { code: "today" }, digest: { code: "sent" }, reminders: ok, karaoke: ok, menu: ok, sales: ok };
  const words: Record<string, Record<string, string>> = {
    forecast: { ok: "Tahmin kaydedildi", noweather: "Tahmin kaydedildi, hava alınamadı", nodata: "Tahmin: veri yok", error: "Tahmin hata" },
    count: { sent: "Hızlı sayım bildirimi gitti", error: "Hızlı sayım bildirimi hata" },
    weekly: {
      sent: "Haftalık özet gönderildi",
      off: "Haftalık özet kapalı",
      nokey: "Haftalık özet: Resend kurulmadı",
      late: "Haftalık özet: süre yetmedi, yarın denenecek",
      error: "Haftalık özet gönderilemedi",
    },
  };
  for (const [step, codes] of Object.entries(words)) {
    for (const [code, text] of Object.entries(codes)) {
      assert.deepEqual(stepTexts({ [step]: code }), [text], `${step}.${code}`);
      const out = dailyOutcome({ ...base, [step]: { code, error: code === "error" ? "zaman aşımı" : null } });
      assert.deepEqual(out.steps, { ...dailyOutcome(base).steps, [step]: code });
      assert.equal(out.status, code === "error" ? "partial" : "ok", `${step}.${code}`);
    }
  }
  // Hata mesajı adımın adıyla, sırası e-posta, eşitleme, …, tahmin, fotoğraf, sayım, haftalık
  const bad = dailyOutcome({
    ...base,
    weekly: { code: "error", error: "Resend yanıt vermiyor" },
    count: { code: "error", error: "2 cihaza gönderilemedi" },
    forecast: { code: "error", error: "MET yanıt vermedi" },
    menu: { code: "error", error: "HTTP 500" },
  });
  assert.equal(bad.status, "partial");
  assert.equal(bad.message, "Menü eşitlemesi: HTTP 500 · Satış tahmini: MET yanıt vermedi · Hızlı sayım bildirimi: 2 cihaza gönderilemedi · Haftalık özet: Resend yanıt vermiyor");
  // Bilinmeyen kod adın yanında yazılır; sözcükler STEP_LABELS sırasıyla
  assert.deepEqual(stepTexts({ weekly: "skip" }), ["Haftalık özet: skip"]);
  assert.deepEqual(stepTexts({ weekly: "sent", count: "sent", forecast: "ok", photos: "none", digest: "sent" }), [
    "E-posta gönderildi",
    "Tahmin kaydedildi",
    "Silinecek fotoğraf yok",
    "Hızlı sayım bildirimi gitti",
    "Haftalık özet gönderildi",
  ]);
});

test("sabah işi: e-postanın gönderimi en geç jobStart + 48 sn'de kesilir; elle gönderim sınırsız (bugünkü gibi)", () => {
  const gunluk = readFileSync(join(process.cwd(), "src/app/api/cron/gunluk/route.ts"), "utf8");
  assert.match(gunluk, /import \{ capped, JOB_SEND_DEADLINE_MS, tailStepDeadline \} from "@\/server\/jobs\/capped";/);
  assert.match(gunluk, /sendDeadlineAt: jobStart \+ JOB_SEND_DEADLINE_MS/);
  const digest = readFileSync(join(process.cwd(), "src/server/notify/digest.ts"), "utf8");
  assert.match(digest, /ctx: \{ syncedToday\?: boolean; sendDeadlineAt\?: number \} = \{\}/);
  assert.match(digest, /ctx\.sendDeadlineAt === undefined \? undefined : \{ deadlineAt: ctx\.sendDeadlineAt \}/);
  // Elle gönderim ve önizleme sınır vermez
  const actions = readFileSync(join(process.cwd(), "src/server/actions/reminders.ts"), "utf8");
  assert.match(actions, /runReminderDigest\("manual"\)/);
});
