import { Timer } from "lucide-react";
import Link from "next/link";

import { Badge, type Tone } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { JOB_KEYS, JOBS, stepTexts, trClock, type JobHealth, type JobRunLite, type JobState } from "@/lib/job-health";
import { addDays } from "@/lib/reminders";
import { loadJobsOverview, type JobsOverview } from "@/server/jobs/alerts";

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

/** Telefonda kapalı satırın özeti: en önemli durum */
function summaryOf(o: JobsOverview | null, now: Date): string {
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
  const today = trClock(now).day;
  if (g.day === today && p.day === today) return "Bu sabah ikisi de çalıştı";
  return g.state === "waiting" || p.state === "waiting" ? "İlk çalışma bekleniyor" : "Son çalışmalar sorunsuz";
}

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
      {showError ? <p className="mt-1 rounded-lg bg-bad-soft px-2.5 py-1.5 text-[13px] break-words text-bad">{run.message}</p> : null}
      {run?.message && h.state === "skipped" ? <p className="mt-0.5 text-[13px] text-ink-mute">{run.message}</p> : null}
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
      summary={summaryOf(o, now)}
      description="Her sabah iki iş kendiliğinden çalışır: 07:00–08:00 Paraşüt eşitlemesi, 08:00–09:00 sabah işi (sabah e-postası, hatırlatıcı bildirimi, laffogato.net eşitlemeleri). Çalışmazsa ya da hata verirse zil, Genel bakış ve e-posta haber verir."
    >
      <CardContent className="space-y-3">
        {o?.production && !o.cronSecret ? (
          <p className="rounded-2xl bg-bad-soft px-4 py-3 text-[13px] text-bad">
            CRON_SECRET tanımlı değil: Vercel bu işleri çalıştıramıyor. Vercel › Settings › Environment Variables&apos;a ekleyip yeniden yayınlayın
            (docs/DEPLOY.md § 4).
          </p>
        ) : null}
        {o && !o.production ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-mute ring-1 ring-line">
            Günlük işler yalnız canlı sitede (Vercel Cron) çalışır; burada uyarı verilmez.
          </p>
        ) : null}
        {o ? (
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {JOB_KEYS.map((job) => (
              <JobRow key={job} job={job} health={o.health[job]} now={now} />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-bad-soft px-4 py-3 text-[13px] text-bad">İşlerin durumu okunamadı; sayfayı yenileyin.</p>
        )}
        <p className="text-[13px] leading-5 text-pretty text-ink-mute">
          Elle çalıştırmak için: Vercel › lafmaliyet › Settings › Cron Jobs › Run. Paraşüt&apos;ü{" "}
          <Link href="/panel/parasut" className="font-medium text-ink underline underline-offset-2">
            Paraşüt entegrasyonu
          </Link>{" "}
          › Şimdi eşitle, sabah e-postasını{" "}
          <Link href="/panel/hatirlaticilar" className="font-medium text-ink underline underline-offset-2">
            Ödemeler
          </Link>{" "}
          › Bugünküleri şimdi gönder ile de yapabilirsiniz.
        </p>
      </CardContent>
    </SectionCard>
  );
}
