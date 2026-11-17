import { NextResponse, type NextRequest } from "next/server";

import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { runChecklistAlerts } from "@/server/notify/checklist-alerts";

// Saat başını 5 geçe (Türkiye 08:05 – 02:05): personele kontrol listesi hatırlatmaları (Tuvalet çizelgesinin her saati,
// açılış ve kapanış listeleri; zamanı geldi / gecikti). Vercel Hobby'de cron günde bir kez çalıştığı için tetikleyici
// GitHub Actions'tır (.github/workflows/kontrol-hatirlatma.yml); isteği CRON_SECRET'la imzalar. Kurallar
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
