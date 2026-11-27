"use client";

import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChartNoAxesColumn, ChevronDown, Layers, PiggyBank, SlidersHorizontal, Wallet } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useState } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { useQueryState } from "@/components/ui/filters";
import { EmptyState, InfoTip, Stat } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { lineLabel, rangeText, shortDate, STALE_BALANCE_DAYS, weekTitle, type CashPlan, type CashPlanState, type PlanLine, type PlanWeek } from "@/lib/cash-plan";
import type { BranchCashFlow, SharedWeek } from "@/lib/cash-plan-branch";
import { monthLabel, money, tl } from "@/lib/format";
import { dayLocativeTR, dayMonthTR, daysBetween, longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";

import { DateTile } from "../payment-ui";
import { BalanceDialog } from "./balance-dialog";
import { EstimatesSheet } from "./estimates-sheet";

/** Haftanın kesin ödemelerinden ilk bu kadarı listelenir (kalanı "ve N ödeme daha") */
const MAX_KNOWN = 8;

/** "+42.000 ₺" / "−12.400 ₺" (tipografik eksi) */
const signed = (v: number) => `${v < 0 ? "−" : "+"}${tl(Math.abs(v))}`;
/** Yayılan satırın ne olduğu (günü belli değil) */
const SPREAD_NOTE: Partial<Record<PlanLine["kind"], string>> = {
  fixed: "ay içine yayıldı",
  expense: "ay içine yayıldı",
  goods: "tedarikçinin vadesinde",
  sales: "günlük ortalamayla",
  online: "günlük ortalamayla",
};

/**
 * Nakit planı ekranı: karolar, uyarı şeridi, 6 haftanın listesi (aç / kapa), "Nasıl hesaplandı" ve tutarı girilmemiş
 * ödemeler. Bakiye penceresi Genel bakış'tan ?bakiye=1 ile açılır (parametre silinir).
 */
export function CashPlanClient({
  title,
  description,
  plan,
  state,
  carry,
  notes,
  scopeNote = null,
  flow = null,
  scopeChip = null,
}: {
  /** Şube kipinde şubenin akışının İşletme geneli satırları ve firmanın bakiyesi (src/lib/cash-plan-branch.ts); yoksa null */
  flow?: BranchCashFlow | null;
  /** Ekranın şube görünümü çipi (sunucu bileşeni) */
  scopeChip?: ReactNode;
  title: string;
  description: string;
  plan: CashPlan;
  state: CashPlanState;
  carry: { date: string; amount: number; tills?: number } | null;
  notes: { key: string; title: string; text: string }[];
  /** Şube kipinde şubenin akışının notu (branchFlowNote); yoksa null */
  scopeNote?: { title: string; text: string } | null;
}) {
  const [ask, setAsk] = useQueryState("bakiye", "");
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [estimatesOpen, setEstimatesOpen] = useState(false);
  // Genel bakış'taki "Bakiyenizi girin" bağlantısı (?bakiye=1): pencere açılır, parametre adresten silinir
  const [seenAsk, setSeenAsk] = useState("");
  if (ask !== seenAsk) {
    setSeenAsk(ask);
    if (ask === "1") setBalanceOpen(true);
  }
  useEffect(() => {
    if (ask === "1") setAsk("");
  }, [ask, setAsk]);

  const { opening, totals, firstNegative, lowest } = plan;
  const out = totals.outKnown + totals.outEstimated;
  const stale = opening !== null && opening.staleDays > STALE_BALANCE_DAYS;
  const balanceButton = (
    <Button onClick={() => setBalanceOpen(true)}>
      <Wallet size={16} aria-hidden="true" /> {opening ? "Bakiyeyi güncelle" : "Bakiyeyi gir"}
    </Button>
  );

  return (
    <>
      <PageHeader
        path="/panel/hatirlaticilar/nakit"
        title={title}
        description={description}
        actions={balanceButton}
        tabs={<SectionTabs section="odeme" current="/panel/hatirlaticilar/nakit" role="admin" />}
      />
      {scopeChip}

      {!plan.hasData ? (
        <Card>
          <EmptyState
            icon={<ChartNoAxesColumn />}
            title="Plan için veri yok"
            description="Kasa raporu, hatırlatıcı, fatura ya da personel girildikçe önümüzdeki 6 hafta burada görünür."
            action={
              <ButtonLink href="/panel/hatirlaticilar" variant="primary">
                Ödemelere git
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <>
          {/* Karolar: telefonda 2×2, md'de 4 sütun (Ödemeler'in karolarıyla aynı ızgara) */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
            {flow ? (
              <Stat
                compact
                icon={<Wallet />}
                label="Elinizdeki para · Firma geneli"
                value={flow.firmOpening ? tl(flow.firmOpening.amount) : "Girilmedi"}
                sub={carry ? `${flow.name} kasasında ${tl(carry.amount)} (${shortDate(carry.date)}) · bakiye firmanın` : "Bakiye firmanın; şubenin akışına girmez"}
              />
            ) : (
              <Stat
                compact
                icon={<Wallet />}
                label="Elinizdeki para"
                value={opening ? tl(opening.amount) : "Girilmedi"}
                tone={opening && opening.amount < 0 ? "bad" : "default"}
                sub={
                  opening ? (
                    stale ? (
                      <span className="font-medium text-warn">
                        {opening.staleDays} gün önce girildi ·{" "}
                        <button type="button" onClick={() => setBalanceOpen(true)} className="cursor-pointer underline underline-offset-2 pointer-coarse:py-2">
                          güncelleyin
                        </button>
                      </span>
                    ) : (
                      `${dayLocativeTR(opening.date)} girildi`
                    )
                  ) : (
                    <Button size="xs" variant="secondary" onClick={() => setBalanceOpen(true)} className="mt-0.5">
                      Gir
                    </Button>
                  )
                }
              />
            )}
            <Stat compact icon={<ArrowDownLeft />} label="Gelecek para" value={tl(totals.in)} sub={plan.basis.online ? "Satışlar ve laffogato.net, tahmini" : "Satışlar, tahmini"} />
            <Stat compact icon={<ArrowUpRight />} label="Ödenecek" value={tl(out)} sub={`Kesin ${tl(totals.outKnown)} · tahmini ${tl(totals.outEstimated)}`} />
            {flow ? (
              <Stat
                compact
                icon={<PiggyBank />}
                label="Net akış"
                value={signed(totals.net)}
                tone={totals.net < 0 ? "bad" : "good"}
                sub={`İşletme geneli ${tl(flow.sharedTotal)} ayrıca`}
              />
            ) : opening ? (
              <Stat
                compact
                icon={<PiggyBank />}
                label="6 hafta sonra"
                value={tl(totals.endBalance)}
                tone={totals.endBalance !== null && totals.endBalance < 0 ? "bad" : "default"}
                sub={lowest ? `En sıkışık: ${shortDate(lowest.date)} · ${tl(lowest.value)}` : undefined}
              />
            ) : plan.requiredCash > 0 ? (
              <Stat
                compact
                icon={<PiggyBank />}
                label="Gereken en az para"
                value={tl(plan.requiredCash)}
                sub={lowest ? `${dayLocativeTR(lowest.date)}ki ödemeler için` : undefined}
              />
            ) : (
              <Stat compact icon={<PiggyBank />} label="Net" value={signed(totals.net)} tone="good" sub="Gelen gidenden fazla" />
            )}
          </div>

          {scopeNote ? <Notice tone="neutral" size="sm" className="mb-4" title={scopeNote.title} text={scopeNote.text} /> : null}
          {/* Tek uyarı şeridi (docs/planlar/ux-sade.md U2): para yetmiyorsa kırmızı (katlanmaz), bakiye girilmediyse nötr
              (giriş başlıktaki "Bakiyeyi gir"), yetiyorsa yeşil */}
          {flow ? null : firstNegative ? (
            <Notice
              tone="bad"
              risk="para"
              live="polite"
              className="mb-4"
              title={`${longDateTR(firstNegative.date)} para yetmeyebilir: tahmini ${signed(firstNegative.balance)}`}
            >
              {firstNegative.top.length ? `O gün: ${firstNegative.top.map((l) => `${lineLabel(l)} ${tl(l.amount)}`).join(", ")}.` : null}
            </Notice>
          ) : !opening && plan.requiredCash > 0 && lowest ? (
            <Notice
              tone="neutral"
              live="polite"
              className="mb-4"
              title={`Bakiye girilmedi: bugün en az ${tl(plan.requiredCash)} gerekir`}
              text={`En sıkışık gün ${dayMonthTR(lowest.date)}.`}
            />
          ) : opening && lowest ? (
            <Notice tone="good" live="polite" className="mb-4" title="6 hafta boyunca para yetiyor" text={`En sıkışık gün ${dayMonthTR(lowest.date)}: ${tl(lowest.value)}.`} />
          ) : null}

          <div className="grid gap-4 xl:grid-cols-12 xl:items-start">
            <Weeks plan={plan} shared={flow?.shared ?? null} className="xl:col-span-8" />
            <div className="space-y-4 xl:col-span-4">
              <Card>
                <CardHeader icon={<Layers />} title="Nasıl hesaplandı" description="Her varsayım rakamlarıyla. Tahminler gerçek ödemeyle kesinleşir." />
                <CardContent>
                  <dl className="space-y-3 text-[13px] leading-5">
                    {notes.map((n) => (
                      <div key={n.key}>
                        <dt className="font-semibold text-ink">{n.title}</dt>
                        <dd className="text-ink-mute">{n.text}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
                <CardFooter>
                  <Button variant="secondary" size="sm" onClick={() => setEstimatesOpen(true)} className="pointer-coarse:h-11">
                    <SlidersHorizontal size={14} aria-hidden="true" /> Tahmine katılanlar
                  </Button>
                </CardFooter>
              </Card>
              {plan.reminderDrift.length ? (
                <Card>
                  <CardHeader
                    icon={<CalendarClock />}
                    title="Hatırlatıcı tutarı sabit giderden farklı"
                    description="Plan hatırlatıcıdaki tutarı öder. Giderler'de zam girildiyse hatırlatıcının tutarını güncelleyin ya da boşaltın (boşken plan Giderler'deki tutarı izler); gider bittiyse hatırlatıcıyı kapatın."
                  />
                  <CardContent className="space-y-3">
                    <ul className="divide-y divide-line rounded-2xl bg-surface px-3 text-sm">
                      {plan.reminderDrift.map((d) => (
                        <li key={d.reminderId} className="py-2.5">
                          <span className="block min-w-0 break-words text-ink">{d.title}</span>
                          <span className="block text-xs text-ink-mute tabular">
                            {d.ended
                              ? `Sabit gider ${monthLabel(d.ended)} ayında bitti · ${monthLabel(d.month)}: hatırlatıcıda ${tl(d.reminderAmount)}`
                              : `${monthLabel(d.month)}: sabit giderde ${tl(d.fixedAmount)} · hatırlatıcıda ${tl(d.reminderAmount)}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <ButtonLink href="/panel/hatirlaticilar" variant="secondary" size="sm" className="pointer-coarse:h-11">
                      Ödemeler&apos;de düzeltin
                    </ButtonLink>
                  </CardContent>
                </Card>
              ) : null}
              {plan.unknownAmounts.length ? (
                <Card>
                  <CardHeader icon={<CalendarClock />} title="Tutarı girilmemiş ödemeler" description="Tutarı bilinmediği için plana girmedi." />
                  <CardContent className="space-y-3">
                    <ul className="divide-y divide-line rounded-2xl bg-surface px-3 text-sm">
                      {plan.unknownAmounts.map((u) => (
                        <li key={u.key} className="flex items-baseline justify-between gap-3 py-2.5">
                          <span className="min-w-0 break-words text-ink">{u.title}</span>
                          <span className="shrink-0 text-ink-mute tabular">{shortDate(u.date)}</span>
                        </li>
                      ))}
                    </ul>
                    <ButtonLink href="/panel/hatirlaticilar" variant="secondary" size="sm" className="pointer-coarse:h-11">
                      Ödemeler&apos;de tutar girin
                    </ButtonLink>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </>
      )}

      {balanceOpen ? <BalanceDialog balance={state.balance} carry={carry} onClose={() => setBalanceOpen(false)} /> : null}
      {estimatesOpen ? <EstimatesSheet rows={plan.estimates} excluded={state.excluded} onClose={() => setEstimatesOpen(false)} /> : null}
    </>
  );
}

/** Haftalar: her biri açılır satır; ilk eksi günün haftası (yoksa bu hafta) açık gelir */
function Weeks({ plan, shared = null, className }: { plan: CashPlan; shared?: SharedWeek[] | null; className?: string }) {
  const firstOpen = plan.firstNegative ? Math.max(0, plan.weeks.findIndex((w) => w.from <= plan.firstNegative!.date && plan.firstNegative!.date <= w.to)) : 0;
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([firstOpen]));
  // Çubuklar en büyük haftalık tutara göre ölçeklenir
  const max = Math.max(1, ...plan.weeks.map((w) => Math.max(w.in, w.outKnown + w.outEstimated)));
  const toggle = (i: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <Card className={className}>
      <CardHeader
        icon={<ChartNoAxesColumn />}
        title="Haftalar"
        description={`${rangeText(plan.today, plan.end)} · kesin ödemeler ve tahminler`}
      />
      <CardContent className="px-3 sm:px-5">
        <ul className="space-y-2">
          {plan.weeks.map((w) => (
            <WeekRow
              key={w.index}
              week={w}
              today={plan.today}
              open={open.has(w.index)}
              onToggle={() => toggle(w.index)}
              max={max}
              withBalance={plan.opening !== null}
              shared={shared ? (shared.find((x) => x.index === w.index) ?? null) : undefined}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Haftanın satırı. `shared` şube kipinde verilir (undefined: firmanın planı): satır "Net akış" yazar, açılınca İşletme
 * geneli satırı (şubenin akışına girmez) en altta
 */
function WeekRow({
  week: w,
  today,
  open,
  onToggle,
  max,
  withBalance,
  shared,
}: {
  week: PlanWeek;
  today: string;
  open: boolean;
  onToggle: () => void;
  max: number;
  withBalance: boolean;
  shared?: SharedWeek | null;
}) {
  const panelId = useId();
  const out = w.outKnown + w.outEstimated;
  const end = withBalance ? w.endBalance! : w.net;
  const endText = (
    <span className="text-[13px] whitespace-nowrap text-ink-mute tabular">
      {withBalance ? "Hafta sonu" : shared !== undefined ? "Net akış" : "Net"} <span className={cn("text-[15px] font-semibold", end < 0 ? "text-bad" : "text-ink")}>{withBalance ? tl(end) : signed(end)}</span>
    </span>
  );
  const known = w.lines.filter((l) => l.direction === "out" && !l.estimated);
  const estimated = w.lines.filter((l) => l.direction === "out" && l.estimated);
  const incoming = w.lines.filter((l) => l.direction === "in");
  return (
    <li className="rounded-2xl bg-surface ring-1 ring-line">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className="flex min-h-11 w-full cursor-pointer flex-col gap-2 rounded-2xl p-3 text-left focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none sm:p-4">
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[15px] leading-5 font-semibold text-ink">
            {weekTitle(w.index)} <span className="font-normal text-ink-mute">· {rangeText(w.from, w.to)}</span>
          </span>
          <span className="max-sm:hidden">{endText}</span>
          <ChevronDown size={18} className={cn("shrink-0 text-ink-mute transition-transform", open && "rotate-180")} aria-hidden="true" />
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-mute tabular">
          <span>
            Gelen <span className="font-semibold text-good">+{tl(w.in)}</span>
          </span>
          <span>
            Giden <span className="font-semibold text-bad">−{tl(out)}</span>
          </span>
        </span>
        <span className="block space-y-1" aria-hidden="true">
          <span className="block h-1.5 overflow-hidden rounded-full bg-panel">
            <span className="block h-full rounded-full bg-good" style={{ width: `${Math.min(100, (w.in / max) * 100)}%` }} />
          </span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-panel">
            <span className="block h-full rounded-full bg-bad" style={{ width: `${Math.min(100, (out / max) * 100)}%` }} />
          </span>
        </span>
        <span className="self-end sm:hidden">{endText}</span>
      </button>
      {open ? (
        <div id={panelId} className="space-y-4 border-t border-line px-3 pt-3 pb-4 sm:px-4">
          {known.length ? (
            <LineGroup title="Ödenecekler (kesin)" lines={known.slice(0, MAX_KNOWN)} today={today} more={known.length - MAX_KNOWN} />
          ) : null}
          {estimated.length ? <LineGroup title="Tahmini" lines={estimated} today={today} /> : null}
          {incoming.length ? <LineGroup title="Gelecek" lines={incoming} today={today} /> : null}
          {!w.lines.length ? <p className="text-sm text-ink-mute">Bu hafta ödeme ya da gelir yok.</p> : null}
          {shared && shared.amount >= 0.5 ? (
            <div className="rounded-xl bg-panel/60 px-3 py-2.5">
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-ink">İşletme geneli</span>
                <span className="font-semibold text-ink-soft tabular">−{tl(shared.amount)}</span>
              </p>
              <p className="mt-0.5 text-xs text-ink-mute">
                {shared.top.map((l) => `${l.title} ${tl(l.amount)}`).join(" · ")}
                {shared.count > shared.top.length ? ` · ${shared.count - shared.top.length} kalem daha` : ""}. Şubenin akışına girmez.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function LineGroup({ title, lines, today, more = 0 }: { title: string; lines: PlanLine[]; today: string; more?: number }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-[13px] font-semibold text-ink">{title}</h3>
      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <PlanLineRow key={l.key} line={l} today={today} />
        ))}
      </ul>
      {more > 0 ? (
        <Link href="/panel/hatirlaticilar" className="mt-1 inline-flex min-h-8 items-center text-[13px] text-ink-mute underline-offset-2 hover:underline pointer-coarse:min-h-11">
          ve {more} ödeme daha
        </Link>
      ) : null}
    </section>
  );
}

function PlanLineRow({ line: l, today }: { line: PlanLine; today: string }) {
  const tileDate = l.due ?? l.date;
  const shownDetail = l.detail && !l.estimated ? l.detail : null;
  const tipDetail = l.detail && l.estimated ? l.detail : null;
  const title = l.href ? (
    <Link href={l.href} className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ink/30">
      {l.title}
    </Link>
  ) : (
    l.title
  );
  return (
    <li className="flex items-start gap-3 py-2.5">
      {tileDate ? (
        <DateTile date={tileDate} daysLeft={daysBetween(today, tileDate)} size="sm" muted={l.estimated && !l.overdue} />
      ) : (
        <span className="flex h-12 w-10 shrink-0 items-center justify-center rounded-[10px] bg-panel text-ink-mute" aria-hidden="true">
          {l.direction === "in" ? <ArrowDownLeft size={16} /> : <Layers size={16} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-5 font-medium break-words text-ink">
            {title}
            {tipDetail ? <InfoTip text={tipDetail} /> : null}
          </p>
          <span className={cn("shrink-0 text-sm leading-5 font-semibold whitespace-nowrap tabular", l.direction === "in" ? "text-good" : "text-ink")}>
            {l.direction === "in" ? "+" : ""}
            {l.estimated ? tl(l.amount) : money(l.amount)}
          </span>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs leading-[18px] text-ink-mute">
          {l.overdue ? (
            <Badge tone="red" dot>
              Gecikmiş
            </Badge>
          ) : null}
          {l.estimated ? <Badge tone="gray">tahmini</Badge> : null}
          {shownDetail ? <span className="wrap-anywhere">{shownDetail}</span> : null}
          {!l.date && SPREAD_NOTE[l.kind] ? <span>{SPREAD_NOTE[l.kind]}</span> : null}
        </p>
      </div>
    </li>
  );
}
