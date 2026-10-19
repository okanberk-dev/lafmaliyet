import { NextResponse, type NextRequest } from "next/server";

import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { runReminderDigest } from "@/server/notify/digest";

// Her sabah 08:00 (05:00 UTC; vercel.json → crons): hatırlatma e-postası. Paraşüt eşitlemesi yarım saat önce
// ayrı bir işte çalışır (/api/cron/parasut), böylece yeni ödenmemiş faturalar bu iletiye girer ve yavaş bir
// eşitleme e-postayı geciktiremez.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  try {
    const result = await runReminderDigest("cron");
    return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ status: "error", error: (e as Error).message }, { status: 500 });
  }
}
