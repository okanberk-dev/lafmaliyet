import { NextResponse, type NextRequest } from "next/server";

import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { runChecklistAlerts } from "@/server/notify/checklist-alerts";

// Bildirim saatlerinde (Türkiye 10:07, 14:07, 18:07, 22:07; ilk saatte iki deneme): personele kontrol listesi
// hatırlatmaları (Tuvalet çizelgesi, açılış ve kapanış listeleri; zamanı geldi / gecikti). Günde 4 kez, 10:00'dan önce
// ve 01:00'dan sonra hiç (alertSendInstant); başka saatte çağrılırsa bir şey göndermez. Yedek tetikleyici: asıl tetikleme açık panel sekmesinin canlı
// yoklamasından (/api/canli, en çok 5 dakikada bir). Vercel Hobby'de cron günde bir kez çalıştığı için bu ucu GitHub
// Actions çağırır (.github/workflows/kontrol-hatirlatma.yml); isteği CRON_SECRET'la imzalar. Kurallar
// src/lib/checklist-alerts.ts, ayrıntı docs/KONTROL-LISTELERI.md § 6. Gönderim en geç 45 sn'de kesilir.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const start = Date.now();
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  try {
    const result = await runChecklistAlerts(new Date(), start + 45_000);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("Kontrol listesi hatırlatmaları", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
