import { ArrowRight, Wallet } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { shortDate, STALE_BALANCE_DAYS, type CashPlan } from "@/lib/cash-plan";
import type { BranchCashFlow } from "@/lib/cash-plan-branch";
import { tl } from "@/lib/format";
import { dayLocativeTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";

const PLAN_HREF = "/panel/hatirlaticilar/nakit";

/** "+42.000 ₺" / "−12.400 ₺" (eksi işareti tipografik) */
const signed = (v: number) => `${v < 0 ? "−" : "+"}${tl(Math.abs(v))}`;

/**
 * Genel bakış › Nakit planı (src/lib/cash-plan.ts): önümüzdeki 6 hafta, seçili aydan bağımsız (bugüne göre). Bakiye
 * girilmişse 6 hafta sonra kalacak para ve en sıkışık gün, girilmemişse ödemeler için bugün gereken en az para. Sunucu
 * bileşeni; plan verisizse ya da yüklenemezse sayfa kartı hiç çizmez.
 */
export function DashboardCashPlan({ plan, flow = null, className }: { plan: CashPlan; flow?: BranchCashFlow | null; className?: string }) {
  const { opening, totals, lowest, firstNegative } = plan;
  const out = totals.outKnown + totals.outEstimated;
  // Şube kipi (şube ayrımı parça 4): şubenin net akışı; bakiye ve işletme geneli kalemler firmanın (bilgi satırı). Vergi
  // ve SGK şubeye bölünmez (sahibin kararı 27 Kasım 2026): şubenin akışında da İşletme geneli satırında da yok
  if (flow) {
    return (
      <Card className={className}>
        <CardHeader
          icon={<Wallet />}
          title="Nakit planı"
          description={`Önümüzdeki 6 hafta · ${flow.name} · tahmini`}
          actions={
            <ButtonLink href={PLAN_HREF} variant="secondary" size="sm" className="pointer-coarse:h-11">
              Planı aç
            </ButtonLink>
          }
        />
        <CardContent className="space-y-2">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm text-ink-mute">6 haftada net akış</span>
            <span className={cn("text-2xl font-semibold tracking-tight tabular", totals.net < 0 ? "text-bad" : "text-good")}>{signed(totals.net)}</span>
          </p>
          <p className="text-xs text-ink-mute tabular">
            Gelecek {tl(totals.in)} · Ödenecek {tl(out)} · İşletme geneli {tl(flow.sharedTotal)} ayrıca · vergi ve SGK Tümü&apos;de
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className={className}>
      <CardHeader
        icon={<Wallet />}
        title="Nakit planı"
        description="Önümüzdeki 6 hafta · tahmini"
        actions={
          <ButtonLink href={PLAN_HREF} variant="secondary" size="sm" className="pointer-coarse:h-11">
            Planı aç
          </ButtonLink>
        }
      />
      <CardContent className="space-y-2">
        {opening ? (
          <>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm text-ink-mute">6 hafta sonra</span>
              <span className={cn("text-2xl font-semibold tracking-tight tabular", totals.endBalance !== null && totals.endBalance < 0 ? "text-bad" : "text-ink")}>≈ {tl(totals.endBalance)}</span>
            </p>
            {firstNegative ? (
              <p className="text-sm font-medium text-bad tabular">
                {dayLocativeTR(firstNegative.date)} para yetmeyebilir ({signed(firstNegative.balance)})
              </p>
            ) : lowest ? (
              <p className="text-sm text-ink-soft tabular">
                En sıkışık: {shortDate(lowest.date)} · {tl(lowest.value)}
              </p>
            ) : null}
          </>
        ) : (
          <>
            {plan.requiredCash > 0 ? (
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm text-ink-mute">Gereken en az para</span>
                <span className="text-2xl font-semibold tracking-tight text-ink tabular">≈ {tl(plan.requiredCash)}</span>
              </p>
            ) : (
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm text-ink-mute">6 haftada net</span>
                <span className="text-2xl font-semibold tracking-tight text-good tabular">{signed(totals.net)}</span>
              </p>
            )}
            <Link href={`${PLAN_HREF}?bakiye=1`} className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-ink underline-offset-2 hover:underline pointer-coarse:min-h-11">
              Bakiyenizi girin, kalanı görün <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </>
        )}
        <p className="text-xs text-ink-mute tabular">
          Gelecek {tl(totals.in)} · Ödenecek {tl(out)}
          {opening && opening.staleDays > STALE_BALANCE_DAYS ? <span className="text-warn"> · Bakiye {opening.staleDays} gün önce girildi</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}
