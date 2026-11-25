import { NextResponse, type NextRequest } from "next/server";

import { kontrolOutcome } from "@/lib/job-health";
import { getDb } from "@/server/db";
import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { finishJobRun, startJobRun } from "@/server/jobs/runs";
import { runKaraokeMails } from "@/server/karaoke/staff-mail";
import { finishWaitingDayEnds } from "@/server/lafpos/gun-sonu";
import { runChecklistAlerts, type ChecklistAlertRun } from "@/server/notify/checklist-alerts";

// Bildirim saatlerinde (Türkiye 10:07, 14:07, 18:07, 22:07; ilk saatte iki deneme): personele kontrol listesi
// hatırlatmaları (Tuvalet çizelgesi, açılış ve kapanış listeleri; zamanı geldi / gecikti). Günde 4 kez, 10:00'dan önce
// ve 01:00'dan sonra hiç (alertSendInstant); başka saatte çağrılırsa bir şey göndermez. Yedek tetikleyici: asıl tetikleme açık panel sekmesinin canlı
// yoklamasından (/api/canli, en çok 5 dakikada bir). Vercel Hobby'de cron günde bir kez çalıştığı için bu ucu GitHub
// Actions çağırır (.github/workflows/kontrol-hatirlatma.yml); isteği CRON_SECRET'la imzalar. Kurallar
// src/lib/checklist-alerts.ts, ayrıntı docs/KONTROL-LISTELERI.md § 6. Gönderim en geç 45 sn'de kesilir.
//
// Aynı çağrı karaoke e-postalarını da gönderir (yedek tetikleyici; asıl tetikleyici yine canlı yoklama): misafirin "bir
// gün kaldı" hatırlatması, personelin sabah ve 3 saat kala e-postaları (src/server/karaoke/staff-mail.ts; docs/KARAOKE.md).
// Kontrol listesi hatırlatmaları bozulsa da çalışır; en geç 55 sn'de kesilir. Sonra, süre kaldıysa, Pavo'yu bekleyen
// LafPOS gün sonu e-postası (src/server/lafpos/gun-sonu.ts finishWaitingDayEnds; asıl tetik yine canlı yoklama).
//
// Her çağrı job_runs'a `kontrol` satırı yazar (src/lib/job-health.ts kontrolOutcome): bir e-posta gidemediyse zilde ve
// Ayarlar › Günlük işler'de "Personel e-postası gidemedi" uyarısı çıkar. Gidemeyen ya da hata veren çalışma 500 döner:
// GitHub işi kırmızı biter (yalnız başarılı ya da gönderilecek bir şey olmayan çalışma yeşil).
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const start = Date.now();
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  const runId = await startJobRun("kontrol");
  let checklist: ChecklistAlertRun | { error: string };
  try {
    checklist = await runChecklistAlerts(new Date(), start + 45_000);
  } catch (e) {
    console.error("Kontrol listesi hatırlatmaları", e);
    checklist = { error: (e as Error).message };
  }
  // Kontrol listesi hatırlatmaları düşse de karaoke e-postaları denenir (kendi hatasını yakalar)
  const karaoke = await runKaraokeMails(new Date(), start + 55_000);
  // Pavo'yu bekleyen LafPOS gün sonu (kapanış 22:00 civarı; LafPOS günü yeniden göndermediyse 22:37 çalışması bitirir).
  // Kendi hatasını yazar, bu işin sonucuna girmez (gün sonu adımı sabah işinde izlenir)
  if (Date.now() < start + 50_000) {
    try {
      const days = await finishWaitingDayEnds(getDb(), new Date(), { deadlineAt: start + 58_000 });
      if (days.length) console.info("[lafpos] Pavo beklemesi bitti", days);
    } catch (e) {
      console.error("[lafpos] Pavo beklemesi", e);
    }
  }
  const outcome = kontrolOutcome({ checklist, karaoke: [karaoke.guest, karaoke.staff] });
  await finishJobRun(runId, outcome);
  console.info("[cron] kontrol", { status: outcome.status, ...outcome.steps, ms: Date.now() - start });
  const ok = outcome.status === "ok" || outcome.status === "skipped";
  return NextResponse.json({ ok, ...("error" in checklist ? { error: checklist.error } : checklist), karaoke, ...(ok ? {} : { message: outcome.message }) }, { status: ok ? 200 : 500 });
}
