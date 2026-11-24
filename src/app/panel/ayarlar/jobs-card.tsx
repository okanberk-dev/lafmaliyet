import { Timer } from "lucide-react";
import Link from "next/link";

import { Badge, type Tone } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { JOB_KEYS, JOBS, jobsSummary, stepTexts, trClock, type JobHealth, type JobRunLite, type JobState } from "@/lib/job-health";
import { addDays } from "@/lib/reminders";
import { loadJobsOverview } from "@/server/jobs/alerts";

import { SectionCard } from "./section-card";

const TZ = "Europe/Istanbul";

const STATE_BADGE: Record<JobState, { tone: Tone; text: string }> = {
  ok: { tone: "green", text: "Çalıştı" },
  skipped: { tone: "gray", text: "Atlandı" },
  running: { tone: "amber", text: "Sürüyor" },
  waiting: { tone: "gray", text: "Bekleniyor" },
  late: { tone: "red", text: "Çalışmadı" },
  failed: { tone: "red", text: "Hata" },
  stuck: { tone: "red", text: "Yarıda kesildi" },
  partial: { tone: "amber", text: "Kısmen" },
};

/** "bugün 07:31 (12 sn)" / "dün 08:04" / "20 Eki 08:12" */
function runWhen(run: JobRunLite, state: JobState, now: Date): string {
  const started = new Date(run.startedAt);
  const today = trClock(now).day;
  const day = trClock(started).day;
  const dayText = day === today ? "bugün" : day === addDays(today, -1) ? "dün" : started.toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: TZ });
  const time = started.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  let took = "";
  if (run.finishedAt) {
    const sec = Math.max(0, Math.round((Date.parse(run.finishedAt) - started.getTime()) / 1000));
    took = sec < 60 ? ` (${sec} sn)` : ` (${Math.floor(sec / 60)} dk ${sec % 60} sn)`;
  } else if (state === "running") {
    took = " (sürüyor)";
  }
  return `${dayText} ${time}${took}`;
}

function JobRow({ health: h, job, now }: { health: JobHealth; job: (typeof JOB_KEYS)[number]; now: Date }) {
  const meta = JOBS[job];
  const badge = STATE_BADGE[h.state];
  // Saat satırı: değerlendirilen günün çalışması, yoksa (çalışmadı) en son çalışma; adımlar yalnız o günün çalışmasından
  // ("Çalışmadı"nın altında dünkü adımlar görünmesin)
  const run = h.run ?? h.last;
  const steps = stepTexts(h.run?.steps ?? null);
  const showError = run?.message && (h.state === "failed" || h.state === "stuck" || h.state === "partial");
  return (
    <li className="px-4 py-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Link href={meta.href} className="font-medium text-ink underline decoration-transparent underline-offset-2 hover:decoration-ink">
          {meta.label}
        </Link>
        <Badge tone={badge.tone} dot>
          {badge.text}
        </Badge>
      </p>
      <p className="mt-0.5 text-[13px] text-ink-mute">
        Her sabah {meta.window} · {run ? `son çalışma ${runWhen(run, h.state, now)}` : "henüz çalışmadı"}
      </p>
      {steps.length ? <p className="mt-0.5 text-[13px] text-pretty text-ink-mute">{steps.join(" · ")}</p> : null}
      {showError ? <Notice tone="bad" size="sm" title={run.message} className="mt-1" /> : null}
      {run?.message && h.state === "skipped" ? <p className="mt-0.5 text-[13px] text-ink-mute">{run.message}</p> : null}
    </li>
  );
}

const KONTROL_BADGE: Record<JobRunLite["status"], { tone: Tone; text: string }> = {
  ok: { tone: "green", text: "Gitti" },
  skipped: { tone: "gray", text: "Gönderilecek yok" },
  running: { tone: "amber", text: "Sürüyor" },
  partial: { tone: "amber", text: "Kısmen" },
  error: { tone: "red", text: "Hata" },
};

/**
 * Personelin kontrol listesi ve karaoke e-postaları (job_runs `kontrol`): son çalışma, adımları, gidemediyse nedeni. Bu iş
 * "çalışmadı" uyarısı vermez (asıl tetik açık sekme, GitHub yedek); yalnız gidemeyen e-posta uyarır
 */
function KontrolRow({ runs, now }: { runs: JobRunLite[]; now: Date }) {
  const run = runs.find((r) => r.job === "kontrol") ?? null;
  const badge = run ? KONTROL_BADGE[run.status] : null;
  const steps = stepTexts(run?.steps ?? null);
  return (
    <li className="px-4 py-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">Personel e-postaları</span>
        {badge ? (
          <Badge tone={badge.tone} dot>
            {badge.text}
          </Badge>
        ) : null}
      </p>
      <p className="mt-0.5 text-[13px] text-pretty text-ink-mute">
        Kontrol listesi ve karaoke · 10:00, 14:00, 18:00, 22:00 · {run ? `son çalışma ${runWhen(run, run.status === "running" ? "running" : "ok", now)}` : "son 8 günde kayıt yok"}
      </p>
      {steps.length ? <p className="mt-0.5 text-[13px] text-pretty text-ink-mute">{steps.join(" · ")}</p> : null}
      {run?.message && (run.status === "error" || run.status === "partial") ? <Notice tone="bad" size="sm" title={run.message} className="mt-1" /> : null}
    </li>
  );
}

/**
 * Ayarlar › Günlük işler: iki zamanlanmış işin (Paraşüt eşitlemesi, sabah işi) son çalışması, adımları ve hatası.
 * Çalışmayan ya da hata veren iş zil, Genel bakış ve e-postayla da bildirilir (src/lib/job-health.ts); uyarılar
 * buraya getirir. Durum job_runs'tan okunur, sayfa hiçbir şey yazmaz.
 */
export async function JobsCard() {
  const o = await loadJobsOverview().catch((e) => {
    console.error("Günlük işler okunamadı", e);
    return null;
  });
  const now = new Date();
  return (
    <SectionCard
      id="isler"
      icon={<Timer />}
      title="Günlük işler"
      summary={jobsSummary(o, now)}
      description="Her sabah iki iş kendiliğinden çalışır: 07:00–08:00 Paraşüt eşitlemesi, 08:00–09:00 sabah işi (sabah e-postası, hatırlatıcı bildirimi, laffogato.net eşitlemeleri). Çalışmazsa ya da hata verirse zil, Genel bakış ve e-posta haber verir."
    >
      <CardContent className="space-y-3">
        {o?.production && !o.cronSecret ? (
          <Notice
            tone="bad"
            size="sm"
            risk="veri"
            title="Günlük işler çalışmıyor: zamanlayıcı anahtarı yok"
            tech={<>CRON_SECRET tanımlı değil; Vercel › Settings › Environment Variables&apos;a ekleyip yeniden yayınlayın (docs/DEPLOY.md § 4).</>}
          />
        ) : null}
        {o && !o.production ? (
          <Notice tone="neutral" size="sm" title="Günlük işler yalnız canlı sitede çalışır" tech="Vercel Cron; yerelde uyarı verilmez." />
        ) : null}
        {o ? (
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {JOB_KEYS.map((job) => (
              <JobRow key={job} job={job} health={o.health[job]} now={now} />
            ))}
            <KontrolRow runs={o.runs} now={now} />
          </ul>
        ) : (
          <Notice tone="bad" size="sm" title="İşlerin durumu okunamadı; sayfayı yenileyin" />
        )}
        <p className="text-[13px] leading-5 text-pretty text-ink-mute">
          Elle çalıştırmak için: Vercel › lafmaliyet › Settings › Cron Jobs › Run; uyarıyı bu kaldırır. Paraşüt&apos;ü{" "}
          <Link href="/panel/parasut" className="font-medium text-ink underline underline-offset-2">
            Paraşüt entegrasyonu
          </Link>{" "}
          › Şimdi eşitle, sabah e-postasını{" "}
          <Link href="/panel/hatirlaticilar" className="font-medium text-ink underline underline-offset-2">
            Ödemeler
          </Link>{" "}
          › Bugünküleri şimdi gönder ile de yapabilirsiniz; bunlar kayda geçmez, uyarıyı kaldırmaz (sabah işinin hatası ertesi
          sabah e-postayla da gelir).
        </p>
      </CardContent>
    </SectionCard>
  );
}
