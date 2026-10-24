import { TrendingUp, Users } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { WEEKDAY_SHORT } from "@/lib/forecast/calendar";
import { approx, levelLabel, reasonChips } from "@/lib/forecast/text";
import { money, num } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import type { ForecastCardData } from "@/server/forecast/load";

import { LEVEL_TONE } from "../tahmin/level-tone";

/** Etiketlerden en çok bu kadarı; kalanı "+2" */
const CHIPS_SHOWN = 3;

const BAR_TONE = { yuksek: "bg-brass-300", normal: "bg-ink/15", dusuk: "bg-info/25", kapali: "bg-transparent" } as const;

/**
 * Bugün · "Satış tahmini" (yalnız yönetici; docs/SATIS-TAHMINI.md): bugünün tahmini, aralık, yoğunluk, kişi ve tatlı,
 * 7 günün şeridi (çubuklar Satış tahmini'nde o güne götürür). Okunamazsa kart hiç çizilmez (src/server/data/today.ts).
 */
export function TodayForecast({ data }: { data: ForecastCardData }) {
  const day = data.days[0];
  const header = (
    <CardHeader
      icon={<TrendingUp />}
      title="Satış tahmini"
      description={`Bugün · ${longDateTR(data.today)}`}
      actions={
        <ButtonLink href="/panel/tahmin" variant="ghost" size="sm">
          Ayrıntı
        </ButtonLink>
      }
    />
  );
  if (data.quality === "yok" || !day) {
    return (
      <Card>
        {header}
        <CardContent>
          <p className="text-sm text-ink-mute">Tahmin için veri yok: kasa raporu girildikçe burada bugünün ve haftanın tahmini görünür.</p>
        </CardContent>
      </Card>
    );
  }
  const max = Math.max(1, ...data.days.map((d) => d.amount));
  const chips = reasonChips(day);
  return (
    <Card>
      {header}
      <CardContent className="space-y-3">
        {day.closed ? (
          <p className="text-sm text-ink">Bugün kafe kapalı olarak işaretli ({day.closed.title}).</p>
        ) : (
          <>
            <div>
              <p className="text-2xl leading-8 font-semibold tracking-tight text-ink tabular">{approx(day.amount)}</p>
              <p className="text-[13px] text-ink-mute tabular">
                {num(day.low)}–{money(day.high)} · Z toplamı
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-soft">
              <Badge tone={LEVEL_TONE[day.level]} dot>
                {levelLabel(day.level)}
              </Badge>
              {data.staff ? (
                <span className="inline-flex items-center gap-1">
                  <Users size={14} aria-hidden="true" />
                  {data.staff.count} kişi{data.staff.ifBusy ? ` · yoğunsa ${data.staff.ifBusy}` : ""}
                </span>
              ) : null}
              {data.desserts !== null ? <span>≈ {data.desserts} tatlı</span> : null}
            </div>
            {chips.length ? (
              <div className="flex flex-wrap gap-1">
                {chips.slice(0, CHIPS_SHOWN).map((c) => (
                  <Badge key={c} tone="gray" className="whitespace-normal">
                    {c}
                  </Badge>
                ))}
                {chips.length > CHIPS_SHOWN ? <Badge tone="gray">+{chips.length - CHIPS_SHOWN}</Badge> : null}
              </div>
            ) : null}
          </>
        )}
        {/* 7 günün şeridi: rakamsız (390 px'e sığmaz); her çubuk günün ayrıntısına */}
        <ol className="flex gap-1.5" aria-label="Önümüzdeki 7 gün">
          {data.days.map((d) => (
            <li key={d.date} className="min-w-0 flex-1">
              <Link
                href={`/panel/tahmin#gun-${d.date}`}
                aria-label={`${longDateTR(d.date)}: ${d.closed ? "kafe kapalı" : `yaklaşık ${money(d.amount)}, ${levelLabel(d.level).toLocaleLowerCase("tr-TR")}`}`}
                className="group flex flex-col items-center gap-1 rounded-lg pt-1 focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none"
              >
                <span className="flex h-16 w-full items-end">
                  <span
                    className={cn(
                      "block w-full rounded-md transition-opacity group-hover:opacity-80",
                      BAR_TONE[d.level],
                      d.offset === 0 && "ring-2 ring-ink",
                      d.closed && "border border-dashed border-ink-quiet",
                    )}
                    style={{ height: d.closed ? "100%" : `${Math.max(8, Math.round((d.amount / max) * 100))}%` }}
                  />
                </span>
                <span className={cn("text-[11px] leading-4", d.offset === 0 ? "font-semibold text-ink" : "text-ink-mute")}>{WEEKDAY_SHORT[d.weekday]}</span>
              </Link>
            </li>
          ))}
        </ol>
        {data.quality === "ay" || data.quality === "ortalama" ? <p className="text-xs text-ink-mute">Kaba tahmin: kasa raporu biriktikçe netleşir.</p> : null}
        {data.footer ? <p className="text-xs text-ink-mute">{data.footer}</p> : null}
      </CardContent>
    </Card>
  );
}
