/**
 * Günlük işlerin (Vercel Cron) sağlığı (saf; tests/gunluk-isler.test.ts sınar). Her sabah iki iş çalışır: 07:00–08:00
 * Paraşüt eşitlemesi (/api/cron/parasut), 08:00–09:00 sabah işi (/api/cron/gunluk). Her çalışma job_runs'a bir satır
 * yazar (src/server/jobs/runs.ts); burada şu ana kadar çalışmış olması gereken günün çalışması bulunur, durumu ve
 * zil / Genel bakış / e-posta uyarıları çıkar. Hobby planında saat bir saatlik pencerede esnek olduğu için pencere
 * sonundan sonra GRACE_MIN beklenir. Saatler İstanbul'a göre (UTC+3, yaz saati yok; mevcut kodla aynı varsayım).
 */

import { BACKUP_HREF, backupReminder } from "@/lib/backup/format";
import { addDays, longDateTR } from "@/lib/reminders";

export type JobKey = "parasut" | "gunluk";
export const JOB_KEYS: JobKey[] = ["parasut", "gunluk"];
/**
 * job_runs'a yazan bütün işler: iki günlük iş ve kontrol listesi / karaoke personel e-postaları (`kontrol`:
 * /api/cron/kontrol, GitHub Actions'ın yedek tetiği, ve canlı yoklamanın bir şey gönderen çalışması). `kontrol` günlük
 * işlerin sağlığına ("çalışmadı" uyarısı) girmez: asıl tetik açık sekme olduğu için dilimi kaçırması sorun değildir;
 * yalnız e-postası gidemediyse uyarır (systemAlerts)
 */
export type RunJobKey = JobKey | "kontrol";

export const JOBS: Record<JobKey, { label: string; window: string; startMin: number; endMin: number; href: string }> = {
  parasut: { label: "Paraşüt eşitlemesi", window: "07:00–08:00", startMin: 7 * 60, endMin: 8 * 60, href: "/panel/parasut" },
  gunluk: { label: "Sabah işi", window: "08:00–09:00", startMin: 8 * 60, endMin: 9 * 60, href: "/panel/hatirlaticilar" },
};

/** Hobby'de iş pencerenin sonuna doğru da başlayabilir; "çalışmadı" demeden önce beklenen süre */
export const GRACE_MIN = 30;
/** İşlevin süresi 60 sn; "running" 5 dakikayı geçtiyse işlev kesilmiş, sonuç yazılamamıştır */
export const STUCK_MS = 5 * 60_000;
/** Yarıda kalan çalışmayı aynı işin sonraki çalışması bu iletiyle "hata" olarak kapatır (src/server/jobs/runs.ts) */
export const CUT_OFF_MESSAGE = "Yarıda kesildi (işlev süresi doldu)";
/** Canlı derlemede son bu kadar süredir hiçbir iş kaydı yoksa izleme o yayından yeniden başlar (`watchRestarts`) */
export const WATCH_IDLE_MS = 26 * 3600_000;
/** job_runs bu kadar gün tutulur */
export const RUNS_KEEP_DAYS = 90;
/** Uyarıların götürdüğü yer: Ayarlar › Günlük işler */
export const JOBS_HREF = "/panel/ayarlar#isler";

export type RunStatus = "running" | "ok" | "partial" | "error" | "skipped";
export interface JobRunLite {
  id: number;
  job: RunJobKey;
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
  } else if (run.status === "error") {
    // Sonraki çalışmanın kapattığı yarıda kalmış çalışma yine "yarıda kesildi": bekçinin 07:xx'te gönderdiği uyarı
    // (…:stuck) sabah işi satırı kapattıktan sonra sabah e-postasında "hata verdi" olarak yinelenmesin
    state = run.message === CUT_OFF_MESSAGE ? "stuck" : "failed";
  } else {
    state = run.status;
  }
  return { state, day, run, last: mine[0] ?? null, lastOk: mine.find((r) => r.status === "ok") ?? null };
}

/**
 * Canlı derlemede izleme başlangıcı yeniden mi yazılır: son `WATCH_IDLE_MS` içinde hiçbir iş kaydı yoksa. Derleme
 * betiği kod yayına çıkmadan çalışır; derleme bozulursa ya da sonra eski sürüme dönülürse (Instant Rollback) işler
 * kayıt yazmayan eski kodla çalışır, eski başlangıç kalsaydı bu kod yayına çıkınca "çalışmadı" yanlış alarmı verirdi.
 * İşler kayıt yazıyorsa başlangıç değişmez. Bedeli: iki iş birden bir günden uzun süredir çalışmıyorsa, yayın
 * "çalışmadı" uyarısını bir sonraki pencereye erteler.
 */
export function watchRestarts(lastRunAt: string | null, now: Date): boolean {
  return lastRunAt === null || now.getTime() - Date.parse(lastRunAt) > WATCH_IDLE_MS;
}

/**
 * Ayarlar › Günlük işler kartının kapalı satırdaki (telefonda) özeti: en önemli durum. "İkisi de çalıştı" yalnız iki iş
 * de bugün çalışıp bittiyse; bekleyen iş (ilk yayın günü) önce söylenir.
 */
export function jobsSummary(o: { production: boolean; cronSecret: boolean; health: Record<JobKey, JobHealth> } | null, now: Date): string {
  if (!o) return "Durum okunamadı";
  if (!o.production) return "Yalnız canlıda çalışır";
  if (!o.cronSecret) return "CRON_SECRET eksik";
  const { gunluk: g, parasut: p } = o.health;
  if (g.state === "late") return "Sabah işi çalışmadı";
  if (g.state === "failed" || g.state === "stuck") return "Sabah işi hata verdi";
  if (p.state === "failed" || p.state === "stuck") return "Paraşüt işi hata verdi";
  if (p.state === "late") return "Paraşüt işi çalışmadı";
  if (g.state === "partial") return "Sabah işinde bir adım hata verdi";
  if (g.state === "running" || p.state === "running") return "Bir iş şu an sürüyor";
  if (g.state === "waiting" || p.state === "waiting") return "İlk çalışma bekleniyor";
  const today = trClock(now).day;
  return g.day === today && p.day === today ? "Bu sabah ikisi de çalıştı" : "Son çalışmalar sorunsuz";
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
  forecast: "Satış tahmini",
  modpos: "ModPOS API",
  photos: "Fotoğraf temizliği",
  count: "Sayım bildirimi",
  weekly: "Haftalık özet",
  requests: "Personel istekleri",
  gunSonu: "LafPOS gün sonu",
  watchdog: "Sistem uyarısı e-postası",
  checklist: "Kontrol listesi e-postası",
  karaokeMail: "Karaoke e-postası",
};

/** Adım kodlarının ekrandaki karşılığı (Ayarlar › Günlük işler); sıra da buradan */
export const STEP_LABELS: Record<string, Record<string, string>> = {
  digest: {
    sent: "E-posta gönderildi",
    skipped: "E-posta: yeni bir şey yok",
    off: "E-posta kapalı",
    nokey: "E-posta: Resend kurulmadı",
    norecipient: "E-posta gitmedi: gönderilecek adres yok",
    error: "E-posta gönderilemedi",
  },
  sync: { ok: "Paraşüt eşitlendi", today: "Paraşüt bugün eşitlenmişti", busy: "Paraşüt eşitlemesi sürüyordu", off: "Paraşüt bağlı değil", error: "Paraşüt hata" },
  reminders: { ok: "Hatırlatıcı bildirimi gitti", nodevice: "Hatırlatıcı var, bildirim açık cihaz yok", none: "Bugün kişisel hatırlatıcı yok", error: "Hatırlatıcı bildirimi hata" },
  karaoke: { ok: "Karaoke tamam", fresh: "Karaoke tamam", off: "Karaoke kurulmadı", error: "Karaoke hata" },
  menu: { ok: "Menü tamam", fresh: "Menü tamam", off: "Menü kurulmadı", error: "Menü hata" },
  sales: { ok: "Online satış tamam", off: "Online satış kurulmadı", error: "Online satış hata" },
  forecast: { ok: "Tahmin kaydedildi", noweather: "Tahmin kaydedildi, hava alınamadı", nodata: "Tahmin: veri yok", error: "Tahmin hata" },
  modpos: {
    ok: "ModPOS API verisi alındı",
    nothing: "ModPOS: çekilecek gün yok",
    kota: "ModPOS: günlük hak doldu",
    partial: "ModPOS: bir kısmı alınamadı",
    busy: "ModPOS: başka çekim sürüyordu",
    error: "ModPOS API hata",
  },
  photos: { ok: "Eski fotoğraflar silindi", none: "Silinecek fotoğraf yok", off: "Fotoğraf deposu yok", error: "Fotoğraf temizliği hata" },
  count: { sent: "Sayım bildirimi gitti", error: "Sayım bildirimi hata" },
  weekly: {
    sent: "Haftalık özet gönderildi",
    off: "Haftalık özet kapalı",
    nokey: "Haftalık özet: Resend kurulmadı",
    late: "Haftalık özet: süre yetmedi, yarın denenecek",
    error: "Haftalık özet gönderilemedi",
  },
  requests: { ok: "Süresi dolan personel istekleri kapandı", error: "Personel istekleri hata" },
  gunSonu: { ok: "LafPOS gün sonu: eksik rapor ya da e-posta tamamlandı", error: "LafPOS gün sonu hata" },
  watchdog: { sent: "Sistem uyarısı e-postası gitti", error: "Sistem uyarısı e-postası gönderilemedi" },
  checklist: { sent: "Kontrol listesi e-postaları gitti", none: "Kontrol listesi: gönderilecek yok", failed: "Kontrol listesi e-postası bir kısmına gidemedi", error: "Kontrol listesi hata" },
  karaokeMail: { sent: "Karaoke e-postaları gitti", none: "Karaoke e-postası: gönderilecek yok", failed: "Karaoke e-postası bir kısmına gidemedi", error: "Karaoke e-postası hata" },
};

/** Adımların ekrandaki sözcükleri, STEP_LABELS sırasıyla */
export function stepTexts(steps: Record<string, string> | null): string[] {
  if (!steps) return [];
  return Object.keys(STEP_LABELS)
    .filter((k) => steps[k])
    .map((k) => STEP_LABELS[k][steps[k]] ?? `${STEP_NAMES[k]}: ${steps[k]}`);
}

const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

/** Sabah işinin her gün yazılan adımları */
export type CoreStep = "sync" | "digest" | "reminders" | "karaoke" | "menu" | "sales";
/**
 * Yalnız çalıştığı gün yazılan adımlar (yoksa hiçbir şey yazılmaz): satış tahmini, ModPOS kasa föyü (yalnız anahtar
 * varken), fotoğraf temizliği, ay sonu sayım bildirimi, haftalık özet, süresi dolan personel istekleri
 */
export type OptionalStep = "forecast" | "modpos" | "photos" | "count" | "weekly" | "requests" | "gunSonu";
export type DailyStep = CoreStep | OptionalStep;
export type StepResult = { code: string; error?: string | null };

/**
 * Sabah e-postasının adımı. `off` gitmeme nedeni (src/server/notify/digest.ts): kapalı ve Resend kurulmamış sorun
 * sayılmaz (ayar); gönderilecek bir şey varken etkin bildirim adresi yoksa e-posta gitmemiştir, adım sorunlu sayılır.
 * `blocked`: etkin adresler vardı ama hepsi personel ya da pasif hesabın (E-53); neden adresleriyle yazılır, ekranda
 * etkin bir adres görünürken "adres yok" denmesin.
 */
export function digestStep(r: { status: "sent" | "skipped" | "error"; off?: "disabled" | "nokey" | "norecipient"; error?: string; blocked?: string; partialError?: string }): StepResult {
  // Birden çok alıcı grubundan biri gidemedi (şubeye bağlı adresler; docs/BILDIRIMLER.md): gidenler gitti, iş hata söyler
  if (r.status === "sent" && r.partialError) return { code: "error", error: `bir alıcı grubuna gidemedi: ${r.partialError}` };
  if (r.status === "sent") return { code: "sent" };
  if (r.status === "error") return { code: "error", error: r.error };
  if (r.off === "norecipient") {
    return {
      code: "norecipient",
      error: r.blocked
        ? `gönderilecek bir şey vardı ama etkin bildirim adreslerinin hepsi personel ya da pasif hesaba ait: ${r.blocked}`
        : "gönderilecek bir şey vardı ama etkin bildirim adresi yok",
    };
  }
  return { code: r.off === "disabled" ? "off" : (r.off ?? "skipped") };
}

/** Hatırlatıcı bildiriminin adımı: hiçbir cihaza gidemediyse hata; bildirimi açık cihazı olmayan kişi sorun değil */
export function reminderStep(r: { users: number; sent: number; failed: number } | { error: string }): StepResult {
  if ("error" in r) return { code: "error", error: r.error };
  if (r.sent) return { code: "ok" };
  if (r.failed) return { code: "error", error: `${r.failed} cihaza gönderilemedi` };
  return { code: r.users ? "nodevice" : "none" };
}

/** Hata sayılan adım sonuçları: "error" ve gönderilecek e-postanın alıcısız kalması */
const stepFailed = (k: DailyStep, s: StepResult) => s.code === "error" || (k === "digest" && s.code === "norecipient");

/**
 * Sabah işinin sonucu: e-posta gönderilemediyse (ya da iş istisnayla bittiyse) "error", başka bir adım (Paraşüt dahil)
 * hata verdiyse ya da e-posta alıcısız kaldıysa "partial", aksi "ok". Mesaj hatalı adımların adı ve hatası, e-posta önce.
 * İsteğe bağlı adım verilmediyse hiç yazılmaz (o gün çalışmadı).
 */
export function dailyOutcome(steps: Record<CoreStep, StepResult> & Partial<Record<OptionalStep, StepResult>>): JobOutcome {
  const order: DailyStep[] = ["digest", "sync", "reminders", "karaoke", "menu", "sales", "forecast", "modpos", "photos", "count", "weekly", "requests", "gunSonu"];
  const present = order.filter((k) => steps[k] !== undefined);
  const failed = present.filter((k) => stepFailed(k, steps[k]!));
  const status = steps.digest.code === "error" ? "error" : failed.length ? "partial" : "ok";
  const message = failed.length ? cut(failed.map((k) => `${STEP_NAMES[k]}: ${steps[k]!.error || "bilinmeyen hata"}`).join(" · "), 500) : null;
  return { status, steps: Object.fromEntries(present.map((k) => [k, steps[k]!.code])), message };
}

/**
 * Ay sonu sayım bildiriminin adımı (src/server/notify/count-push.ts): yalnız ayın son günü bildirim gönderilince yazılır
 * (ayın son günü değil, hepsi sayılmış ya da bildirimi açık cihaz yoksa adım yok); hiçbir cihaza gidemediyse hata.
 * Adın anahtarı (`count`) eski kayıtlar için aynı kaldı: 26 Eki 2026'ya kadar haftalık hızlı sayım bildirimi de buydu.
 */
export function countStep(r: { status: "sent" | "skip"; sent: number; failed: number } | { error: string }): StepResult | undefined {
  if ("error" in r) return { code: "error", error: r.error };
  if (r.status === "skip") return undefined;
  if (r.sent) return { code: "sent" };
  return r.failed ? { code: "error", error: `${r.failed} cihaza gönderilemedi` } : undefined;
}

/**
 * Satış tahmininin adımı (src/server/forecast/job.ts runForecastJob): kaydedilemediyse hata (iş "kısmen" olur, e-posta
 * yine gider); tahmin için veri yoksa "nodata", hava alınamadıysa "noweather" (ikisi de sorun sayılmaz).
 */
export function forecastStep(r: { status: "ok" | "skipped" | "error"; weather: string; error?: string }): StepResult {
  if (r.status === "error") return { code: "error", error: r.error ?? null };
  if (r.status === "skipped") return { code: "nodata" };
  return { code: r.weather === "error" ? "noweather" : "ok" };
}

/**
 * ModPOS kasa föyünün adımı (src/server/modpos/sync.ts syncModpos; sabah işinde bir kez, docs/MODPOS-API.md › Nerede
 * görünür ve › Kota ve çekme sırası). Yalnız anahtar varken yazılır: kurulmamışsa (`off`) ve önizlemede (`preview`,
 * canlının hakkını harcamaz) adım yok. Hak dolması (`kota`) ve bir kısmının alınamaması (`partial`) sorun sayılmaz:
 * hak gece yarısı yenilenir, alınamayan gün ertesi sabah yeniden denenir. Yalnız hiçbir gün alınamadıysa (anahtar
 * çalışmıyor, servis yanıt vermiyor, süre doldu) hata: iş "kısmen" olur, hata metniyle ("Sabah işinde bir adım hata
 * verdi"). Girdi ModposSyncResult'ın yapısıdır (saf modül sunucuya uzanmaz; tests/modpos-sabah.test.ts).
 */
export function modposStep(r: { status: "off" | "preview" | "busy" | "nothing" | "ok" | "partial" | "kota" | "error"; error?: string }): StepResult | undefined {
  if (r.status === "off" || r.status === "preview") return undefined;
  if (r.status === "error") return { code: "error", error: r.error || null };
  return { code: r.status };
}

/**
 * Süresi dolan personel isteklerinin adımı (src/server/staff-requests/core.ts expireStaffRequests; docs/ONAYLAR.md):
 * yalnız bir istek kapandıysa ya da hata verdiyse yazılır (kapanacak istek yoksa adım yok)
 */
export function requestsStep(r: { expired: number } | { error: string }): StepResult | undefined {
  if ("error" in r) return { code: "error", error: r.error };
  return r.expired ? { code: "ok" } : undefined;
}

/**
 * LafPOS gün sonu otomasyonunun adımı (src/server/lafpos/gun-sonu.ts catchUpLafposDayEnds): yalnız bir şey yapıldıysa
 * (rapor yazıldı ya da e-posta gitti) ya da hata varsa yazılır. Süre yetmediği için başlanamayan, işi bekleyen gün
 * (`left`) de hatadır: e-postası ya da raporu bu sabah tamamlanmadı
 */
export function gunSonuStep(
  r: { status: string; days: { date?: string; report: string; email: string; staff?: string; error?: string }[]; left?: string[] } | { error: string },
): StepResult | undefined {
  if ("error" in r) return { code: "error", error: r.error };
  const failed = r.days.filter((d) => d.report === "error" || d.email === "error" || d.email === "failed" || d.staff === "error" || d.staff === "failed");
  const why = (d: (typeof failed)[number]) => d.error ?? (d.report !== "error" && d.email !== "error" && d.email !== "failed" ? "çalışanların e-postası gitmedi" : d.email);
  const problems = [...failed.map((d) => `${d.date ?? ""} ${why(d)}`.trim()), ...(r.left ?? []).map((d) => `${d} süre yetmedi`)];
  if (problems.length) return { code: "error", error: problems.join(" · ") };
  return r.days.some((d) => d.report === "written" || d.report === "updated" || d.email === "sent") ? { code: "ok" } : undefined;
}

/** Fotoğraf temizliğinin adımı (src/server/storage/photos.ts cleanupPhotos) */
export function photosStep(r: { deleted: number; failed: number; off: boolean } | { error: string }): StepResult {
  if ("error" in r) return { code: "error", error: r.error };
  if (r.off) return { code: "off" };
  if (r.failed) return { code: "error", error: `${r.failed} fotoğraf depodan silinemedi` };
  return { code: r.deleted ? "ok" : "none" };
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

/** Bir e-posta işinin sonucu (kontrol listesi, karaoke): gönderilen ve gidemeyen sayısı ya da hata */
type MailRun = { skipped?: string; sent: number; failed: number } | { error: string };

/**
 * Kontrol listesi ve karaoke e-postalarının çalışması (/api/cron/kontrol ve canlı yoklama; job_runs `kontrol`). Bir
 * e-posta gidemediyse "partial", hepsi düştüyse ya da iş hata verdiyse "error", hiçbir şey gönderilecek değilse
 * "skipped". Mesaj gidemeyenlerin sayısı: "Kontrol listesi e-postası: 2 kişiye gidemedi"
 */
export function kontrolOutcome(r: { checklist: MailRun; karaoke: MailRun[] }): JobOutcome {
  const code = (m: MailRun) => ("error" in m ? "error" : m.failed ? "failed" : m.sent ? "sent" : "none");
  const karaokeRun: MailRun = r.karaoke.find((m) => "error" in m) ?? {
    sent: r.karaoke.reduce((a, m) => a + ("sent" in m ? m.sent : 0), 0),
    failed: r.karaoke.reduce((a, m) => a + ("failed" in m ? m.failed : 0), 0),
  };
  const steps = { checklist: code(r.checklist), karaokeMail: code(karaokeRun) };
  const why = (name: string, m: MailRun) => ("error" in m ? `${name}: ${m.error || "bilinmeyen hata"}` : m.failed ? `${name}: ${m.failed} kişiye gidemedi` : null);
  const problems = [why(STEP_NAMES.checklist, r.checklist), why(STEP_NAMES.karaokeMail, karaokeRun)].filter((x): x is string => x !== null);
  const sent = ("sent" in r.checklist ? r.checklist.sent : 0) + ("sent" in karaokeRun ? karaokeRun.sent : 0);
  const status = !problems.length ? (sent ? "ok" : "skipped") : sent ? "partial" : "error";
  return { status, steps, message: problems.length ? cut(problems.join(" · "), 500) : null };
}

/**
 * Bugünün son anlamlı `kontrol` çalışması: bir şey gönderen ya da gidemeyen (süren ve "gönderilecek yok" çalışmalar
 * atlanır). Zil ve Ayarlar › Günlük işler aynı satırı gösterir: sonradan gelen boş bir çalışma (canlı yoklama, GitHub'ın
 * ikinci denemesi) gidemeyen e-postayı saklamaz. `runs` yeni önce
 */
export function todaysKontrolRun<T extends Pick<JobRunLite, "job" | "status" | "startedAt">>(runs: readonly T[], now: Date): T | null {
  const today = trClock(now).day;
  return runs.find((r) => r.job === "kontrol" && r.status !== "running" && r.status !== "skipped" && trDay(r.startedAt) === today) ?? null;
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
  /**
   * Genel bakış şeridinde "danger" olmasa da gösterilsin: günü gelmiş ama henüz bir şeyi bozmamış işler için. Şeritte
   * görünür, /api/health'in 503'ünü tetiklemez (o yalnız "danger"a bakar).
   */
  banner?: boolean;
  /** Şeritteki bağlantının adı; verilmezse "Günlük işler" */
  actionLabel?: string;
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
 * CRON_SECRET yoksa iki iş de hiç çalışmaz: tek iş uyarısı o, işlerin "çalışmadı" uyarıları ayrıca verilmez. Paraşüt
 * işinin hatası, zildeki "Paraşüt eşitlemesi başarısız" (parasut_sync_runs) zaten söylüyorsa yinelenmez. Yedek
 * hatırlatması (son yedek 30 günden eski ya da hiç yok, src/lib/backup/format.ts) işlerden bağımsızdır ve "info":
 * Genel bakış şeridine ve /api/health'in 503'üne girmez. Önce "danger".
 */
export function systemAlerts(i: {
  production: boolean;
  cronSecret: boolean;
  now: Date;
  health: Record<JobKey, JobHealth>;
  /** Günlük eşitlemenin (tedarikçi geçmişi hariç) son hatalı çalışmasının başlangıcı */
  parasutSyncErrorAt: string | null;
  /** Son yedeğin anı (integration_state › backup.last); hiç yoksa null, verilmezse yedek hatırlatılmaz */
  lastBackupAt?: string | null;
  /** job_runs'un bütün satırları (yeni önce); verilirse bugünün son `kontrol` çalışması e-postası gidemediyse uyarır */
  runs?: JobRunLite[];
}): SystemAlert[] {
  if (!i.production) return [];
  const today = trClock(i.now).day;
  const reminder = i.lastBackupAt === undefined ? null : backupReminder(i.lastBackupAt, i.now);
  const backup: SystemAlert[] = reminder ? [{ ...reminder, level: "info", href: BACKUP_HREF, day: null }] : [];
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
      ...backup,
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
  // Kontrol listesi / karaoke personel e-postası gidemedi (bugünün son çalışması; sonraki başarılı çalışma uyarıyı kaldırır)
  const k = i.runs ? todaysKontrolRun(i.runs, i.now) : null;
  if (k && (k.status === "error" || k.status === "partial")) {
    out.push({ id: `is-kontrol-${k.id}`, level: "warning", title: "Personel e-postası gidemedi", body: cut(k.message || "Bilinmeyen hata", 200), href: JOBS_HREF, day: today });
  }
  return [...out, ...backup].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
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
