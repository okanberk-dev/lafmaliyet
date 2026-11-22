import { NextResponse, type NextRequest } from "next/server";

import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { runKaraokeMails } from "@/server/karaoke/staff-mail";
import { runChecklistAlerts } from "@/server/notify/checklist-alerts";

// Saat başını 7 geçe (Türkiye 08:07 – 02:07): personele kontrol listesi hatırlatmaları (Tuvalet çizelgesinin her saati,
// açılış ve kapanış listeleri; zamanı geldi / gecikti). Yedek tetikleyici: asıl tetikleme açık panel sekmesinin canlı
// yoklamasından (/api/canli, en çok 5 dakikada bir). Vercel Hobby'de cron günde bir kez çalıştığı için bu ucu GitHub
// Actions çağırır (.github/workflows/kontrol-hatirlatma.yml); isteği CRON_SECRET'la imzalar. Kurallar
// src/lib/checklist-alerts.ts, ayrıntı docs/KONTROL-LISTELERI.md § 6. Gönderim en geç 45 sn'de kesilir.
//
// Aynı çağrı karaoke e-postalarını da gönderir (yedek tetikleyici; asıl tetikleyici yine canlı yoklama): misafirin "bir
// gün kaldı" hatırlatması, personelin sabah ve 3 saat kala e-postaları (src/server/karaoke/staff-mail.ts; docs/KARAOKE.md).
// Kontrol listesi hatırlatmaları bozulsa da çalışır; en geç 55 sn'de kesilir.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const start = Date.now();
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  try {
    const result = await runChecklistAlerts(new Date(), start + 45_000);
    const karaoke = await runKaraokeMails(new Date(), start + 55_000);
    return NextResponse.json({ ok: true, ...result, karaoke });
  } catch (e) {
    console.error("Kontrol listesi hatırlatmaları", e);
    // Kontrol listesi hatırlatmaları düştü: karaoke e-postaları yine denenir (kendi hatasını yakalar)
    const karaoke = await runKaraokeMails(new Date(), start + 55_000);
    return NextResponse.json({ ok: false, error: (e as Error).message, karaoke }, { status: 500 });
  }
}
