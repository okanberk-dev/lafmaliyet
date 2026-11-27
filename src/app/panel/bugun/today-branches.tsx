import { Store } from "lucide-react";
import Link from "next/link";

import { MoneySparkline } from "@/components/panel/arc-charts";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { GrowthPill } from "@/components/ui/misc";
import { diffMatters, paymentShares, type BranchDayRow, type BranchDaySummary, type Payments } from "@/lib/branch-day";
import { pct, tl } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";

/** Ödeme türünün rengi; renk tek başına anlam taşımaz, her dilimin yanında adı ve tutarı yazar */
const PAYMENT_COLOR: Record<keyof Payments, string> = {
  card: "bg-info",
  cash: "bg-brass-500",
  mealCard: "bg-bordo-600",
  online: "bg-ink-soft",
  other: "bg-ink-quiet",
};

const signedPct = (g: number) => `${g >= 0.0005 ? "+" : ""}${pct(g, Math.abs(g) >= 1 ? 0 : 1)}`;

/** "Perşembe" → "geçen perşembe" */
const lastWeekLabel = (day: string) => `geçen ${longDateTR(day).split(" ")[2]?.toLocaleLowerCase("tr-TR") ?? "hafta"}`;

function Change({ value, day, before }: { value: number | null; day: string; before: number | null }) {
  if (value === null) return null;
  return (
    <span title={`${lastWeekLabel(day)}: ${tl(before)}`} className="inline-flex">
      <GrowthPill value={value}>
        {signedPct(value)}
        <span className="sr-only"> ({lastWeekLabel(day)} gününe göre)</span>
      </GrowthPill>
    </span>
  );
}

function BranchLine({ row, day }: { row: BranchDayRow; day: string }) {
  const href = `/panel/kasa?gun=${day}&sube=${encodeURIComponent(row.id)}`;
  if (row.revenue === null) {
    return (
      <li>
        <Link href={href} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 hover:bg-surface">
          <span className="min-w-0 truncate text-sm font-medium text-ink">{row.name}</span>
          <Badge tone="amber" dot>
            Gün sonu yok
          </Badge>
        </Link>
      </li>
    );
  }
  const facts = [
    row.receipts !== null ? `${row.receipts} fiş` : null,
    row.avgReceipt !== null ? `ort. ${tl(row.avgReceipt)}` : null,
    row.source === "asilpos" ? "AsilPOS gün sonu" : row.source === "modpos" ? "ModPOS API'den" : null,
  ].filter(Boolean);
  return (
    <li>
      <Link href={href} className="flex flex-col gap-1 rounded-xl px-2 py-2.5 hover:bg-surface">
        <span className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium text-ink">{row.name}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-semibold tabular text-ink">{tl(row.revenue)}</span>
            <Change value={row.change} day={day} before={row.lastWeek} />
          </span>
        </span>
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-mute">
          <span>{facts.join(" · ")}</span>
          {diffMatters(row.cashDiff) ? (
            <Badge tone={row.cashDiff < 0 ? "red" : "amber"}>
              Kasa {row.cashDiff < 0 ? "eksik" : "fazla"} {tl(Math.abs(row.cashDiff))}
            </Badge>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/**
 * Bugün · "Şubelerde dün / bugün" (yalnız yönetici; docs/BUGUN.md). Design Lab'in "Şube günlük ciro özeti"nden B (şube
 * satırları, gün sonu ve kasa durumu) ile C'nin (büyük toplam, ödeme dağılımı) birleşimi. Gün: bütün şubeler bugünü
 * kapattıysa bugün, yoksa dün (src/lib/branch-day.ts pickDay). Satır o şubenin o günkü kasasına götürür.
 */
export function TodayBranches({ data }: { data: BranchDaySummary }) {
  const shares = paymentShares(data.payments);
  const reported = data.rows.length - data.missing;
  // Son sekiz günün çizgisi (Arc sparkline): gün sonu gelmeyen gün çizilmez, eksik şubeli gün adında söylenir
  const trend = data.trend.flatMap((p) => (p.revenue === null ? [] : [{ label: `${longDateTR(p.day)}${p.missing ? ` · ${p.missing} şube eksik` : ""}`, value: p.revenue }]));
  const trendAvg = trend.length ? trend.reduce((a, p) => a + p.value, 0) / trend.length : null;
  return (
    <Card>
      <CardHeader
        icon={<Store />}
        title={data.isToday ? "Şubelerde bugün" : "Şubelerde dün"}
        description={longDateTR(data.day)}
        actions={
          <ButtonLink href={`/panel/kasa?gun=${data.day}`} variant="secondary" size="sm" className="pointer-coarse:h-11">
            Kasa
          </ButtonLink>
        }
      />
      <CardContent className="flex flex-col gap-4 px-3 pb-4 sm:px-5 sm:pb-5">
        <div className="px-2">
          <p className="text-[13px] text-ink-mute">
            {data.missing ? `${reported} / ${data.rows.length} şubenin cirosu` : data.rows.length > 1 ? `${data.rows.length} şubenin cirosu` : "Ciro"}
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-3xl font-semibold tracking-tight tabular text-ink">{tl(data.revenue)}</span>
            {data.change !== null ? (
              <GrowthPill value={data.change}>
                {signedPct(data.change)} {lastWeekLabel(data.day)}
              </GrowthPill>
            ) : null}
          </div>
          {data.receipts ? <p className="mt-1 text-xs text-ink-mute tabular">{data.receipts} fiş · ödenmez / ikram hariç</p> : null}
          {trend.length > 1 && trendAvg !== null ? <MoneySparkline className="mt-3" label={`Son ${trend.length} gün`} change={`ort. ${tl(trendAvg)}`} points={trend} /> : null}
        </div>

        {shares.length ? (
          <div className="px-2">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-panel-deep" role="img" aria-label={shares.map((p) => `${p.label} ${pct(p.share, 0)}`).join(", ")}>
              {shares.map((p) => (
                <div key={p.key} className={PAYMENT_COLOR[p.key]} style={{ width: `${p.share * 100}%` }} />
              ))}
            </div>
            <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {shares.map((p) => (
                <li key={p.key} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-ink-mute">
                    <span className={cn("size-2 shrink-0 rounded-full", PAYMENT_COLOR[p.key])} aria-hidden />
                    <span className="truncate">{p.label}</span>
                  </span>
                  <span className="tabular text-ink">
                    {tl(p.value)} <span className="text-ink-mute">{pct(p.share, 0)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ul className="flex flex-col divide-y divide-line">
          {data.rows.map((r) => (
            <BranchLine key={r.id} row={r} day={data.day} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
