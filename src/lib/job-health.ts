/**
 * Günlük işlerin (Vercel Cron) sağlığı (saf; tests/gunluk-isler.test.ts sınar). Her sabah iki iş çalışır: 07:00–08:00
 * Paraşüt eşitlemesi (/api/cron/parasut), 08:00–09:00 sabah işi (/api/cron/gunluk). Her çalışma job_runs'a bir satır
 * yazar (src/server/jobs/runs.ts); burada şu ana kadar çalışmış olması gereken günün çalışması bulunur, durumu ve
 * zil / Genel bakış / e-posta uyarıları çıkar. Hobby planında saat bir saatlik pencerede esnek olduğu için pencere
 * sonundan sonra GRACE_MIN beklenir. Saatler İstanbul'a göre (UTC+3, yaz saati yok; mevcut kodla aynı varsayım).
 */

import { addDays, longDateTR } from "@/lib/reminders";

export type JobKey = "parasut" | "gunluk";
export const JOB_KEYS: JobKey[] = ["parasut", "gunluk"];

export const JOBS: Record<JobKey, { label: string; window: string; startMin: number; endMin: number; href: string }> = {
  parasut: { label: "Paraşüt eşitlemesi", window: "07:00–08:00", startMin: 7 * 60, endMin: 8 * 60, href: "/panel/parasut" },
  gunluk: { label: "Sabah işi", window: "08:00–09:00", startMin: 8 * 60, endMin: 9 * 60, href: "/panel/hatirlaticilar" },
};

/** Hobby'de iş pencerenin sonuna doğru da başlayabilir; "çalışmadı" demeden önce beklenen süre */
export const GRACE_MIN = 30;
/** İşlevin süresi 60 sn; "running" 5 dakikayı geçtiyse işlev kesilmiş, sonuç yazılamamıştır */
export const STUCK_MS = 5 * 60_000;
/** job_runs bu kadar gün tutulur */
export const RUNS_KEEP_DAYS = 90;
/** Uyarıların götürdüğü yer: Ayarlar › Günlük işler */
export const JOBS_HREF = "/panel/ayarlar#isler";

export type RunStatus = "running" | "ok" | "partial" | "error" | "skipped";
export interface JobRunLite {
  id: number;
  job: JobKey;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  steps: Record<string, string> | null;
  message: string | null;
}
export type JobState = "ok" | "skipped" | "running" | "waiting" | "late" | "stuck" | "failed" | "partial";

const TR_OFFSET_MS = 3 * 3600_000;

/** İstanbul saatiyle gün (YYYY-MM-DD) ve gece yarısından bu yana dakika */
export function trClock(now: Date): { day: string; minutes: number } {
  const t = new Date(now.getTime() + TR_OFFSET_MS);
  return { day: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

const trDay = (iso: string) => trClock(new Date(iso)).day;
/** Günün İstanbul saatiyle `min`. dakikası, zaman damgası olarak */
const trTime = (day: string, min: number) => Date.parse(`${day}T00:00:00Z`) - TR_OFFSET_MS + min * 60_000;

/** Şu ana kadar çalışmış olması gereken son gün: pencere sonu + bekleme geçtiyse bugün, değilse dün */
export function expectedDay(job: JobKey, now: Date, grace = GRACE_MIN): string {
  const { day, minutes } = trClock(now);
  return minutes >= JOBS[job].endMin + grace ? day : addDays(day, -1);
}

export interface JobHealth {
  state: JobState;
  /** Değerlendirilen gün */
  day: string;
  /** O günün çalışması (yoksa null) */
  run: JobRunLite | null;
  /** Herhangi bir günün en son çalışması */
  last: JobRunLite | null;
  lastOk: JobRunLite | null;
}

/**
 * Bir işin durumu. Bugün zaten çalıştıysa (pencereden önce elle de olsa) bugünün sonucu geçerli: dünkü hata düzelmişken
 * uyarı sürmesin; çalışmadıysa beklenen gün (`expectedDay`). `day` verilirse o gün (e-postadaki "dünkü sabah işi").
 * Günün en son çalışması geçerli (sonradan başarılı olan, önceki hatanın yerine geçer); "atlandı" (başka eşitleme
 * sürüyordu, çift tetik) yalnız o gün başka çalışma yoksa sayılır. Çalışma yoksa: izleme o günün penceresi
 * açıldıktan sonra başladıysa (ilk yayın, iş kayıt yazmadan çalışmış olabilir) "waiting", değilse "late".
 */
export function jobHealth(job: JobKey, runs: JobRunLite[], now: Date, opts: { watchSince: string | null; grace?: number; day?: string }): JobHealth {
  const mine = runs.filter((r) => r.job === job).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const today = trClock(now).day;
  const day = opts.day ?? (mine.some((r) => trDay(r.startedAt) === today) ? today : expectedDay(job, now, opts.grace ?? GRACE_MIN));
  const sameDay = mine.filter((r) => trDay(r.startedAt) === day);
  const run = sameDay.find((r) => r.status !== "skipped") ?? sameDay[0] ?? null;
  let state: JobState;
  if (!run) {
    const since = opts.watchSince ? Date.parse(opts.watchSince) : NaN;
    state = !Number.isFinite(since) || since > trTime(day, JOBS[job].startMin) ? "waiting" : "late";
  } else if (run.status === "running") {
    state = now.getTime() - Date.parse(run.startedAt) > STUCK_MS ? "stuck" : "running";
  } else {
    state = run.status === "error" ? "failed" : run.status;
  }
  return { state, day, run, last: mine[0] ?? null, lastOk: mine.find((r) => r.status === "ok") ?? null };
}

// ---------------------------------------------------------------- Adımlar ve sonuç

export interface JobOutcome {
  status: Exclude<RunStatus, "running">;
  steps: Record<string, string>;
  message: string | null;
}

/** Hata metninde adımın adı */
const STEP_NAMES: Record<string, string> = {
  sync: "Paraşüt eşitlemesi",
  digest: "Sabah e-postası",
  reminders: "Hatırlatıcı bildirimi",
  karaoke: "Karaoke eşitlemesi",
  menu: "Menü eşitlemesi",
  sales: "Online satışlar",
  watchdog: "Sistem uyarısı e-postası",
};

/** Adım kodlarının ekrandaki karşılığı (Ayarlar › Günlük işler); sıra da buradan */
export const STEP_LABELS: Record<string, Record<string, string>> = {
  digest: { sent: "E-posta gönderildi", skipped: "E-posta: yeni bir şey yok", off: "E-posta kapalı", error: "E-posta gönderilemedi" },
  sync: { ok: "Paraşüt eşitlendi", today: "Paraşüt bugün eşitlenmişti", busy: "Paraşüt eşitlemesi sürüyordu", off: "Paraşüt bağlı değil", error: "Paraşüt hata" },
  reminders: { ok: "Hatırlatıcı bildirimi gitti", none: "Bugün kişisel hatırlatıcı yok", error: "Hatırlatıcı bildirimi hata" },
  karaoke: { ok: "Karaoke tamam", fresh: "Karaoke tamam", off: "Karaoke kurulmadı", error: "Karaoke hata" },
  menu: { ok: "Menü tamam", fresh: "Menü tamam", off: "Menü kurulmadı", error: "Menü hata" },
  sales: { ok: "Online satış tamam", off: "Online satış kurulmadı", error: "Online satış hata" },
  watchdog: { sent: "Sistem uyarısı e-postası gitti", error: "Sistem uyarısı e-postası gönderilemedi" },
};

/** Adımların ekrandaki sözcükleri, STEP_LABELS sırasıyla */
export function stepTexts(steps: Record<string, string> | null): string[] {
  if (!steps) return [];
  return Object.keys(STEP_LABELS)
    .filter((k) => steps[k])
    .map((k) => STEP_LABELS[k][steps[k]] ?? `${STEP_NAMES[k]}: ${steps[k]}`);
}

const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

export type DailyStep = "sync" | "digest" | "reminders" | "karaoke" | "menu" | "sales";

/**
 * Sabah işinin sonucu: e-posta gönderilemediyse (ya da iş istisnayla bittiyse) "error", başka bir adım (Paraşüt dahil)
 * hata verdiyse "partial", aksi "ok". Mesaj hatalı adımların adı ve hatası, e-posta önce.
 */
export function dailyOutcome(steps: Record<DailyStep, { code: string; error?: string | null }>): JobOutcome {
  const order: DailyStep[] = ["digest", "sync", "reminders", "karaoke", "menu", "sales"];
  const failed = order.filter((k) => steps[k].code === "error");
  const status = steps.digest.code === "error" ? "error" : failed.length ? "partial" : "ok";
  const message = failed.length ? cut(failed.map((k) => `${STEP_NAMES[k]}: ${steps[k].error || "bilinmeyen hata"}`).join(" · "), 500) : null;
  return { status, steps: Object.fromEntries(order.map((k) => [k, steps[k].code])), message };
}

/**
 * Paraşüt işinin sonucu: bağlı değilse ya da başka bir eşitleme sürüyorsa "skipped" (uyarı vermez), eşitleme hata
 * verdiyse "error". Bekçi e-postası (dünkü sabah işinin sorunu) gittiyse ya da gidemediyse adımlarda görünür.
 */
export function parasutOutcome(r: {
  configured: boolean;
  result?: { ok: boolean; busy?: boolean; error?: string };
  /** Eşitleme dışında yakalanan istisna */
  error?: string;
  watchdog?: "sent" | "none" | "error";
}): JobOutcome {
  const watch: Record<string, string> = r.watchdog && r.watchdog !== "none" ? { watchdog: r.watchdog } : {};
  if (!r.configured) return { status: "skipped", steps: { sync: "off", ...watch }, message: "Paraşüt bağlı değil" };
  if (r.error !== undefined) return { status: "error", steps: { sync: "error", ...watch }, message: cut(r.error || "bilinmeyen hata", 500) };
  if (r.result?.busy) return { status: "skipped", steps: { sync: "busy", ...watch }, message: "Başka bir eşitleme sürüyordu" };
  if (!r.result?.ok) return { status: "error", steps: { sync: "error", ...watch }, message: cut(r.result?.error || "bilinmeyen hata", 500) };
  return { status: "ok", steps: { sync: "ok", ...watch }, message: null };
}

// ---------------------------------------------------------------- Uyarılar

export interface SystemAlert {
  id: string;
  level: "danger" | "warning" | "info";
  title: string;
  body: string;
  href: string;
  /** İşin değerlendirilen günü (zilde tarih); işe bağlı olmayan uyarıda null */
  day: string | null;
}

/** "bu sabah" / "dün sabah" / "20 Ekim Pazartesi sabahı" */
function morningOf(day: string, today: string): string {
  if (day === today) return "bu sabah";
  if (day === addDays(today, -1)) return "dün sabah";
  return `${longDateTR(day)} sabahı`;
}

const LEVEL_ORDER = { danger: 0, warning: 1, info: 2 } as const;

/**
 * Zil, Genel bakış (yalnız "danger") ve /api/health için uyarılar. Yalnız canlıda (işler yalnız orada çalışır).
 * CRON_SECRET yoksa iki iş de hiç çalışmaz: tek uyarı o, işlerin "çalışmadı" uyarıları ayrıca verilmez. Paraşüt işinin
 * hatası, zildeki "Paraşüt eşitlemesi başarısız" (parasut_sync_runs) zaten söylüyorsa yinelenmez. Önce "danger".
 */
export function systemAlerts(i: {
  production: boolean;
  cronSecret: boolean;
  now: Date;
  health: Record<JobKey, JobHealth>;
  /** Günlük eşitlemenin (tedarikçi geçmişi hariç) son hatalı çalışmasının başlangıcı */
  parasutSyncErrorAt: string | null;
}): SystemAlert[] {
  if (!i.production) return [];
  const today = trClock(i.now).day;
  if (!i.cronSecret) {
    return [
      {
        id: "is-cron-secret",
        level: "danger",
        title: "Günlük işler kapalı",
        body: "Vercel'de CRON_SECRET tanımlı değil: Paraşüt eşitlemesi ve sabah e-postası çalışmıyor.",
        href: JOBS_HREF,
        day: null,
      },
    ];
  }
  const out: SystemAlert[] = [];
  const add = (a: Omit<SystemAlert, "href">) => out.push({ ...a, href: JOBS_HREF });
  const msg = (h: JobHealth) => cut(h.run?.message || "Bilinmeyen hata", 200);

  const g = i.health.gunluk;
  if (g.state === "late") {
    add({
      id: `is-gunluk-late-${g.day}`,
      level: "danger",
      title: "Sabah işi çalışmadı",
      body: `${longDateTR(g.day)} ${JOBS.gunluk.window} arasında çalışması gerekiyordu. Sabah e-postası gitmedi; hatırlatıcı bildirimi ve laffogato.net eşitlemeleri yapılmadı.`,
      day: g.day,
    });
  } else if (g.run && g.state === "failed") {
    add({ id: `is-gunluk-failed-${g.run.id}`, level: "danger", title: "Sabah işi hata verdi", body: msg(g), day: g.day });
  } else if (g.run && g.state === "stuck") {
    add({ id: `is-gunluk-stuck-${g.run.id}`, level: "danger", title: "Sabah işi yarıda kesildi", body: "İşlev süresi doldu; sabah e-postası gitmemiş olabilir.", day: g.day });
  } else if (g.run && g.state === "partial") {
    add({ id: `is-gunluk-partial-${g.run.id}`, level: "warning", title: "Sabah işinde bir adım hata verdi", body: msg(g), day: g.day });
  }

  const p = i.health.parasut;
  if (p.state === "late") {
    add({
      id: `is-parasut-late-${p.day}`,
      level: "warning",
      title: `Paraşüt işi ${morningOf(p.day, today)} çalışmadı`,
      body: "Sabah işi eşitlemeyi yeniden dener; Vercel › Cron Jobs'u kontrol edin.",
      day: p.day,
    });
  } else if (p.run && (p.state === "failed" || p.state === "stuck")) {
    // Eşitlemenin kendi hatası (bu çalışmanın içinde) zilde "Paraşüt eşitlemesi başarısız" olarak zaten var
    const surfaced = i.parasutSyncErrorAt !== null && Date.parse(i.parasutSyncErrorAt) >= Date.parse(p.run.startedAt);
    if (!surfaced) {
      add(
        p.state === "failed"
          ? { id: `is-parasut-failed-${p.run.id}`, level: "danger", title: "Paraşüt işi hata verdi", body: msg(p), day: p.day }
          : { id: `is-parasut-stuck-${p.run.id}`, level: "danger", title: "Paraşüt işi yarıda kesildi", body: "İşlev süresi doldu; eşitleme sonraki çalışmada kaldığı yerden sürer.", day: p.day },
      );
    }
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

export interface EmailProblem {
  /** notification_log anahtarı: aynı sorun iki kez e-postayla gitmez */
  key: string;
  title: string;
  body: string;
}

/**
 * E-postadaki sistem uyarıları. Sabah işi her zaman *dün* için değerlendirilir: sabah e-postası (bugünün sabah işi)
 * ve bekçi (07:xx'te Paraşüt işi) dünün sabah işini söyler; iki iş birbirini izler, biri bozulunca kendini
 * saklayamaz. Bekçi ayrı e-postayı yalnız sabah e-postası gitmemiş olabilecekken atar (çalışmadı, hata, yarıda
 * kesildi); yalnız bir adımı hata veren gün sabah e-postasında söylenir. Paraşüt işi yalnız sabah e-postasında ve bugün
 * için (bekleme yok: sabah işinin penceresi Paraşüt'ünki bitince başlar); hatası e-postada zaten "Paraşüt eşitlemesi
 * başarısız" olarak yer aldığı için yalnız çalışmadı / yarıda kesildi. Anahtarlar `job:<iş>:<gün>:<durum>`.
 */
export function emailProblems(i: { now: Date; mode: "digest" | "watchdog"; runs: JobRunLite[]; watchSince: string | null; syncedToday: boolean }): EmailProblem[] {
  const { day: today } = trClock(i.now);
  const yesterday = addDays(today, -1);
  const out: EmailProblem[] = [];
  const g = jobHealth("gunluk", i.runs, i.now, { watchSince: i.watchSince, day: yesterday });
  const dayMonth = longDateTR(yesterday).split(" ").slice(0, 2).join(" ");
  const gMsg = cut(g.run?.message || "Bilinmeyen hata", 300);
  const gunluk: Partial<Record<JobState, { title: string; body: string }>> = {
    late: {
      title: `Dünkü sabah işi çalışmadı (${dayMonth})`,
      body: `${JOBS.gunluk.window} arasında çalışması gerekiyordu: sabah e-postası gitmedi, hatırlatıcı bildirimi ve laffogato.net eşitlemeleri yapılmadı.`,
    },
    failed: { title: "Dünkü sabah işi hata verdi", body: gMsg },
    stuck: { title: "Dünkü sabah işi yarıda kesildi", body: "İşlev süresi doldu; sabah e-postası gitmemiş olabilir." },
    partial: { title: "Dünkü sabah işinde bir adım hata verdi", body: gMsg },
  };
  const gItem = gunluk[g.state];
  if (gItem && !(i.mode === "watchdog" && g.state === "partial")) out.push({ key: `job:gunluk:${yesterday}:${g.state}`, ...gItem });

  if (i.mode === "digest" && expectedDay("parasut", i.now, 0) === today) {
    const p = jobHealth("parasut", i.runs, i.now, { watchSince: i.watchSince, day: today });
    const title = p.state === "late" ? "Paraşüt işi bu sabah çalışmadı" : p.state === "stuck" ? "Paraşüt işi bu sabah yarıda kesildi" : null;
    if (title) out.push({ key: `job:parasut:${today}:${p.state}`, title, body: i.syncedToday ? "Eşitlemeyi sabah işi yaptı." : "Bugün eşitleme de yapılamadı." });
  }
  return out;
}

/** Sistem uyarısı e-postasında ne yapılacağı */
export const SYSTEM_ALERT_HELP =
  "Ne yapmalı: Vercel › lafmaliyet › Settings › Cron Jobs ekranında işi \"Run\" ile çalıştırın; sorun sürerse Vercel › Logs'a bakın. Paneldeki durum: Ayarlar › Günlük işler.";
