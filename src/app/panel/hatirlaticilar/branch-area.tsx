import { Building2, ChevronDown } from "lucide-react";
import Link from "next/link";

import { BranchViewChip } from "@/components/panel/branch-view-chip";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { ALL_BRANCHES, BRANCH_PARAM } from "@/lib/branches";
import { dateTR, num, tl } from "@/lib/format";
import type { UpcomingItem } from "@/lib/reminders";
import { unassignedText } from "@/lib/upcoming-scope";

/**
 * Ödemeler'in şube kipi (şube ayrımı D parça 4; docs/SUBE.md › Şube ayrımı): ekranın çipi, şubesi seçilmemiş faturaların
 * sayısı ve firmanın faturasız borçlarının katlı "İşletme geneli" bölümü. "Tümü"de ve firma kipinde yalnız çip (çip de
 * "Tümü"de çizilmez). Sunucu bileşeni; Ödemeler'in istemci parçası başlığın altına koyar.
 */
export function PaymentsBranchArea({ shared, unassigned }: { shared: readonly UpcomingItem[]; unassigned: { count: number; total: number } }) {
  const sharedTotal = Math.round(shared.reduce((a, i) => a + (i.amount ?? 0), 0) * 100) / 100;
  return (
    <div className="mb-4 space-y-3">
      <BranchViewChip area="odemeler" />
      {unassigned.count > 0 ? (
        <Notice tone="warn" size="sm" title={`${unassignedText(unassigned.count)} · ${tl(unassigned.total, 2)}`}>
          Bu şubenin listesinde değiller.{" "}
          <NoticeLink href={`/panel/faturalar?durum=subesiz&${BRANCH_PARAM}=${ALL_BRANCHES}`}>Faturalar&apos;da şubesini seçin</NoticeLink>
        </Notice>
      ) : null}
      {shared.length ? (
        <details className="group/ig rounded-2xl bg-surface ring-1 ring-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
            <Building2 size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">
                İşletme geneli · {num(shared.length)} faturasız borç · {tl(sharedTotal, 2)}
              </span>
              <span className="block text-xs text-ink-mute">Tedarikçiye faturasız borç ve hesaptaki para firmanın; bu şubenin listesine ve toplamlarına girmez.</span>
            </span>
            <ChevronDown size={16} className="shrink-0 text-ink-quiet transition-transform group-open/ig:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="divide-y divide-ink/[0.06] px-4 pb-1.5">
            {shared.map((i) => (
              <li key={i.ref} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  {i.href ? (
                    <Link href={i.href} className="text-sm font-medium break-words text-ink underline-offset-2 hover:underline">
                      {i.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium break-words text-ink">{i.title}</p>
                  )}
                  <p className="mt-0.5 text-xs break-words text-ink-mute tabular">
                    {[i.detail, `vade ${dateTR(i.dueDate)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-ink tabular">{tl(i.amount, 2)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
