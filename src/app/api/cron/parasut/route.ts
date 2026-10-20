import { NextResponse, type NextRequest } from "next/server";

import { rejectUnlessCron } from "@/server/jobs/cron-auth";
import { isParasutConfigured } from "@/server/parasut/config";
import { syncParasut } from "@/server/parasut/sync";

// Her sabah 07:00–08:00 (04:30 UTC; vercel.json → crons; Hobby planında saat bir saatlik pencerede esnek):
// Paraşüt'ten gider faturaları ve gelen e-faturalar (Paraşüt'te "içeri al" yapılmamışlar dahil). 45 sn'de kalan
// sayfalar bir sonraki çalışmada kaldığı yerden sürer; sabah e-postası işi bu çalışma başarısızsa bir kez daha dener.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await rejectUnlessCron(request);
  if (denied) return denied;
  if (!isParasutConfigured()) return NextResponse.json({ status: "skipped", reason: "Paraşüt bağlantısı tanımlı değil" });
  const result = await syncParasut("cron", { deadlineMs: 45_000 });
  // Başka bir eşitleme sürerken başlamayan çalışma hata değildir (Vercel cron günlüğünde başarısız görünmesin)
  return NextResponse.json(result, { status: result.ok || ("busy" in result && result.busy) ? 200 : 500 });
}
