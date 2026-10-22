import { CircleAlert } from "lucide-react";
import Link from "next/link";

import { JOBS_HREF } from "@/lib/job-health";
import { loadSystemAlerts } from "@/server/jobs/alerts";

/**
 * Genel bakış'ın en üstünde kırmızı şerit, yalnız ciddi sistem sorunlarında (sabah işi çalışmadı / hata verdi / yarıda
 * kesildi, Paraşüt işi hata verdi, CRON_SECRET yok; yalnız canlıda). Kendi Suspense'inde yüklenir: panoyu bekletmez,
 * okunamazsa hiçbir şey göstermez. Daha hafif uyarılar (Paraşüt işi çalışmadı, bir adım hata verdi) yalnız zilde.
 */
export async function SystemBanner() {
  const items = (await loadSystemAlerts().catch(() => [])).filter((a) => a.level === "danger");
  if (!items.length) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad ring-1 ring-bad/20">
      <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {items.slice(0, 2).map((i) => (
          <p key={i.id} className="text-pretty">
            <strong className="font-semibold">{i.title}</strong> · {i.body}
          </p>
        ))}
        {items.length > 2 ? <p>ve {items.length - 2} uyarı daha</p> : null}
      </div>
      <Link href={JOBS_HREF} className="font-medium underline underline-offset-2 max-sm:basis-full max-sm:pl-[1.875rem]">
        Ayrıntı
      </Link>
    </div>
  );
}
