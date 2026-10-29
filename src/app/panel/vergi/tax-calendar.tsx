import { CalendarClock } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { MONTH_NAMES } from "@/lib/constants";
import { WEEKDAY_SHORT, weekdayOf } from "@/lib/forecast/calendar";
import { INFLATION_LINE, isMismatchNote, NOTE_LATER, NOTE_MUNICIPAL, NOTE_UNKNOWN, type TaxCalendarRow, type TaxView } from "@/lib/tax/view";
import { cn } from "@/lib/utils";

import { FilingButton, type FilingKindData } from "./filing-dialog";
import { PayrollButton, type PayrollSheetMonth } from "./payroll-sheet";
import type { RuleRef } from "./refs";
import { DetailList, NoteList, RuleRefList } from "./ui";

/*
 * Özet › "Sıradaki vergi ödemeleri" (plan docs/planlar/vergi.md §3.12, §4.1): önümüzdeki 100 günün satırları; her
 * satırda tarih karosu, başlık ve alt satır, tek tutar (en çok bir rozet). Satır açılınca döküm, notlar, kullanılan
 * kurallar ve eylemler. Açılır başlıkta etkileşimli öğe yok; düğmeler ve bağlantılar gövdede.
 */

const BADGE_TONE: Record<string, "green" | "blue" | "amber" | "gray" | "violet"> = {
  Muhasebeci: "green",
  "Ödemeler'de": "blue",
  Taslak: "amber",
  "sabit tutar": "gray",
};

/** Tutarı olmayan satırın tutar sütunu ve alt satırı: tutar sütununda kısa söz, alt satırda gerisi (§4.1) */
function amountless(note: string | null): { short: string; sub: string | null } {
  if (note === NOTE_UNKNOWN) return { short: "Tutarı bilinmiyor", sub: "Şirketin beyannamesi; muhasebecinizden isteyin" };
  if (note === NOTE_MUNICIPAL) return { short: "Tutar belediyeden", sub: null };
  if (note === NOTE_LATER) return { short: "–", sub: NOTE_LATER };
  return { short: "–", sub: note };
}

function DateTile({ date }: { date: string }) {
  return (
    <span className="flex w-11 shrink-0 flex-col items-center rounded-xl bg-surface py-1 ring-1 ring-line" aria-hidden="true">
      <span className="text-[17px] leading-5 font-semibold text-ink tabular">{Number(date.slice(8))}</span>
      <span className="text-[11px] leading-4 text-ink-mute">{MONTH_NAMES[Number(date.slice(5, 7)) - 1].slice(0, 3)}</span>
      <span className="text-[10px] leading-3 text-ink-quiet">{WEEKDAY_SHORT[weekdayOf(date)]}</span>
    </span>
  );
}

export interface CalendarExtras {
  /** Türün kullanılan kuralları */
  rules: Record<string, RuleRef[]>;
  filings: { mphb: FilingKindData; gecici: FilingKindData; kv: FilingKindData };
  payroll: PayrollSheetMonth[];
}

/**
 * Türün ilk satırının çapası (docs/planlar/ux-sade.md §3.7): ⌘K'daki "KDV", "SGK primi" ve "Maaş vergileri" o satıra
 * iner; satır kapalı kalır, yalnız halkayla belirir (JS yok)
 */
const ANCHOR_OF: Partial<Record<TaxCalendarRow["kind"], string>> = { kdv1: "kdv", sgk: "sgk", mphb: "muhtasar" };

function Row({ row, extras, anchor }: { row: TaxCalendarRow; extras: CalendarExtras; anchor?: string }) {
  const al = row.amount === null ? amountless(row.note) : null;
  const sub = [row.shift, al ? al.sub : row.note].filter(Boolean).join(" · ");
  const due = new Date(`${row.due}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" });
  const kindFiling = row.kind === "mphb" ? extras.filings.mphb : row.kind === "gecici" ? extras.filings.gecici : row.kind === "kv" ? extras.filings.kv : null;
  // Pencere yalnız seçeneklerindeki dönemleri açar (muhtasarda son 12 ay): gelecek dönemin satırında düğme yok, başka
  // bir ayın kaydına yazılmasın
  const filing = kindFiling?.options.some((o) => o.period === row.period) ? kindFiling : null;
  const warnNotes = row.notes.filter(isMismatchNote);
  const hasPayroll = row.kind === "mphb" && extras.payroll.some((p) => p.month === row.period);
  const kdv = row.kind === "kdv1" || row.kind === "kdv2";
  return (
    <li id={anchor} className={anchor ? "scroll-mt-20 target:ring-2 target:ring-ink/20 target:ring-inset" : undefined}>
      <details className="group/row">
        <summary className="grid min-h-14 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 outline-none select-none hover:bg-surface/60 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          <DateTile date={row.due} />
          <span className="min-w-0">
            <span className="block text-sm leading-5 font-medium break-words text-ink">
              <span className="sr-only">{due}: </span>
              {row.title}
            </span>
            {sub ? <span className={cn("block text-xs leading-4 break-words", row.ask ? "text-warn" : "text-ink-mute")}>{sub}</span> : null}
          </span>
          <span className="flex max-w-[8.5rem] shrink-0 flex-col items-end gap-1 text-right">
            <span className={cn("text-sm leading-5 font-semibold tabular", row.amount === null ? "font-medium text-ink-mute" : "text-ink")}>{al ? al.short : row.amountText}</span>
            {row.badge ? <Badge tone={BADGE_TONE[row.badge] ?? "gray"}>{row.badge}</Badge> : null}
          </span>
        </summary>
        <div className="space-y-3 border-t border-line bg-surface/40 px-4 pt-3 pb-4">
          {row.detail.length ? <DetailList rows={row.detail} /> : null}
          <NoteList notes={warnNotes} tone="warn" />
          <NoteList notes={row.notes.filter((n) => !warnNotes.includes(n))} />
          <RuleRefList refs={extras.rules[row.kind] ?? []} />
          <div className="flex flex-wrap gap-2">
            {hasPayroll ? <PayrollButton months={extras.payroll} month={row.period} /> : null}
            {filing ? <FilingButton data={filing} period={row.period} /> : null}
            {kdv ? (
              <ButtonLink href="/panel/hatirlaticilar/nakit#kdv" size="sm">
                Nakit planında aç
              </ButtonLink>
            ) : null}
            {row.kind === "kdv1" ? (
              <ButtonLink href="/panel/hatirlaticilar/nakit#kdv" size="sm">
                Devreden KDV&apos;yi gir
              </ButtonLink>
            ) : null}
            {row.addHref ? (
              <ButtonLink href={row.addHref} size="sm">
                Ödemeler&apos;e ekle
              </ButtonLink>
            ) : row.kind !== "ctv" ? (
              <ButtonLink href="/panel/hatirlaticilar" size="sm">
                Ödemeler&apos;de aç
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </details>
    </li>
  );
}

/** Takvim kartı: satırlar, pencerenin dışındaki geçici ve kurumlar vergisi ("Sonra") ve hesaplanmayanlar satırı */
export function TaxCalendarCard({ view, extras }: { view: Pick<TaxView, "calendar" | "later">; extras: CalendarExtras }) {
  const [inflation, rest] = INFLATION_LINE.split(" · ");
  const firstOfKind = new Map<string, string>();
  for (const r of view.calendar) if (!firstOfKind.has(r.kind)) firstOfKind.set(r.kind, r.key);
  return (
    <Card>
      <CardHeader icon={<CalendarClock />} title="Sıradaki vergi ödemeleri" description="Önümüzdeki 100 gün; yasal son günle (hafta sonu ve tatilde ilk iş günü). Satıra dokunun: döküm ve dayanak." />
      {view.calendar.length ? (
        // overflow-clip (hidden değil): kaydırma kabı olmaz, ilk satırın çapası (#sgk) scroll-mt payını kaybetmez
        <ul className="mx-2 divide-y divide-line overflow-clip rounded-2xl bg-surface ring-1 ring-line sm:mx-5">
          {view.calendar.map((r) => (
            <Row key={r.key} row={r} extras={extras} anchor={firstOfKind.get(r.kind) === r.key ? ANCHOR_OF[r.kind] : undefined} />
          ))}
        </ul>
      ) : (
        <p className="mx-5 rounded-2xl bg-surface px-4 py-6 text-center text-sm text-ink-mute ring-1 ring-line">Önümüzdeki 100 günde vergi ödemesi yok.</p>
      )}
      {view.later.length ? (
        <div className="mx-2 mt-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line sm:mx-5">
          <p className="text-xs font-semibold text-ink-soft">Sonra</p>
          <ul className="mt-1 space-y-1 text-[13px] leading-5 text-ink-mute">
            {view.later.map((l) => (
              <li key={l.kind} className="break-words">
                {l.text} · <span className="text-ink-quiet">Tutarı bilinmiyor</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="px-5 pt-3 pb-5 text-[13px] leading-5 text-ink-mute">
        {inflation} ·{" "}
        <Link href="/panel/vergi/kurallar#bilgi" className="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
          {rest}
        </Link>
      </p>
    </Card>
  );
}

