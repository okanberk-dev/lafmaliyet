import { CalendarClock } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { MONTH_NAMES } from "@/lib/constants";
import { tl } from "@/lib/format";
import { WEEKDAY_SHORT, weekdayOf } from "@/lib/forecast/calendar";
import { dayMonthTR } from "@/lib/reminders";
import { badgeLabel, badgeNote, calendarTitle, KDV2_NOTE, plainLabel } from "@/lib/tax/glossary";
import { INFLATION_LINE, isMismatchNote, laterOnCard, NOTE_LATER, NOTE_MUNICIPAL, NOTE_UNKNOWN, NOTE_VAT_NONE, type TaxCalendarRow, type TaxView } from "@/lib/tax/view";
import { cn } from "@/lib/utils";

import { FilingButton, type FilingKindData } from "./filing-dialog";
import { PayrollButton, type PayrollSheetMonth } from "./payroll-sheet";
import type { RuleRef } from "./refs";
import { DetailList, NoteList, NoteNotice, RuleRefList } from "./ui";

/*
 * Özet › "Vergi ve SGK ödemeleri" (plan docs/planlar/vergi.md §3.12, §4.1; docs/planlar/ux-sade.md §7.5): önümüzdeki
 * 100 günün satırları; her satırda tarih karosu, sade ad (glossary.ts) ve alt satır, tek tutar (en çok bir rozet).
 * Satır kapalıyken cevabı yazar: KDV'de ödeme olup olmadığı, Ödemeler'deki gün yasal günden farklıysa ikisi, muhtasarda
 * seçilmemiş vergi kesintisi. Satır açılınca döküm, notlar, kullanılan kurallar ve eylemler. Açılır başlıkta
 * etkileşimli öğe yok; düğmeler ve bağlantılar gövdede. Veri (`row.title`, `row.badge`) resmî adla kalır.
 */

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
 * iner; satır kapalı kalır, yalnız halkayla belirir. Halka :target'la (adres çubuğundan, aynı sayfada ⌘K) ve
 * HashScroll'un `data-hash-hit` işaretiyle (uygulamanın içinden gelince; Next'in pushState'i :target'ı güncellemez)
 */
const ANCHOR_OF: Partial<Record<TaxCalendarRow["kind"], string>> = { kdv1: "kdv", sgk: "sgk", mphb: "muhtasar" };

/** Satırın alt satırı (kapalıyken okunan): kaydırma, tutarın sözü ve §7.5'in eklemeleri */
function subLine(row: TaxCalendarRow, al: { sub: string | null } | null): string {
  const parts: (string | null)[] = [row.shift, al ? al.sub : row.note];
  // KDV satırı kendi cevabını yazar (K13): ödeme yok, varsa sonraki aya geçen KDV; tutar sütunu damga
  if (row.source === "sabit tutar") parts.push(`Ödeme yok${row.carryOut && row.carryOut > 0 ? ` · ≈ ${tl(row.carryOut)} sonraki aya geçer` : ""}`);
  parts.push(badgeNote(row.badge, row.kind));
  if (row.reminderDue && row.reminderDue !== row.due) parts.push(`Ödemeler'de ${dayMonthTR(row.reminderDue)}`);
  if (row.kind === "mphb" && row.atLeast && row.unknownWithholding) parts.push(`${row.unknownWithholding} giderde vergi kesintisi (stopaj) seçilmedi`);
  return parts.filter(Boolean).join(" · ");
}

function Row({ row, extras, anchor }: { row: TaxCalendarRow; extras: CalendarExtras; anchor?: string }) {
  const al = row.amount === null ? amountless(row.note) : null;
  const sub = subLine(row, al);
  const badge = badgeLabel(row.badge);
  const due = new Date(`${row.due}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" });
  const kindFiling = row.kind === "mphb" ? extras.filings.mphb : row.kind === "gecici" ? extras.filings.gecici : row.kind === "kv" ? extras.filings.kv : null;
  // Pencere yalnız seçeneklerindeki dönemleri açar (muhtasarda son 12 ay): gelecek dönemin satırında düğme yok, başka
  // bir ayın kaydına yazılmasın
  const filing = kindFiling?.options.some((o) => o.period === row.period) ? kindFiling : null;
  const warnNotes = row.notes.filter(isMismatchNote);
  // "Ödeme beklenmez" kapalı satırda yazıyor (tekrar değil); KDV-2'nin ilk notu tevkifatın sade anlamı
  const notes = [...(row.kind === "kdv2" ? [KDV2_NOTE] : []), ...row.notes.filter((n) => !warnNotes.includes(n) && n !== NOTE_VAT_NONE)];
  const hasPayroll = row.kind === "mphb" && extras.payroll.some((p) => p.month === row.period);
  return (
    <li id={anchor} className={
        anchor
          ? "scroll-mt-20 target:ring-2 target:ring-ink/20 target:ring-inset data-[hash-hit]:ring-2 data-[hash-hit]:ring-ink/20 data-[hash-hit]:ring-inset"
          : undefined
      }>
      <details className="group/row">
        <summary className="grid min-h-14 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 outline-none select-none hover:bg-surface/60 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          <DateTile date={row.due} />
          <span className="min-w-0">
            <span className="block text-sm leading-5 font-medium break-words text-ink">
              <span className="sr-only">{due}: </span>
              {calendarTitle(row)}
            </span>
            {sub ? <span className={cn("block text-xs leading-4 break-words", row.ask ? "text-warn" : "text-ink-mute")}>{sub}</span> : null}
          </span>
          <span className="flex max-w-[8.5rem] shrink-0 flex-col items-end gap-1 text-right">
            <span className={cn("text-sm leading-5 font-semibold tabular", row.amount === null ? "font-medium text-ink-mute" : "text-ink")}>{al ? al.short : row.amountText}</span>
            {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
          </span>
        </summary>
        <div className="space-y-3 border-t border-line bg-surface/40 px-4 pt-3 pb-4">
          {row.detail.length ? <DetailList rows={row.detail.map((d) => ({ ...d, label: plainLabel(d.label) }))} /> : null}
          <NoteNotice notes={warnNotes} size="line" />
          <NoteList notes={notes} />
          <RuleRefList refs={extras.rules[row.kind] ?? []} />
          <div className="flex flex-wrap gap-2">
            {hasPayroll ? <PayrollButton months={extras.payroll} month={row.period} /> : null}
            {filing ? <FilingButton data={filing} period={row.period} /> : null}
            {row.kind === "mphb" && row.atLeast && row.unknownWithholding ? (
              <ButtonLink href="/panel/vergi/gelir-gider#siniflandir" size="sm">
                Kesintiyi seç
              </ButtonLink>
            ) : null}
            {/* KDV'nin dökümü ve devreden KDV girişi Nakit planı'nda, tek dokunuş (K13) */}
            {row.kind === "kdv1" ? (
              <ButtonLink href="/panel/hatirlaticilar/nakit#kdv" size="sm">
                Döküm ve devreden KDV
              </ButtonLink>
            ) : null}
            {row.kind === "kdv2" ? (
              <ButtonLink href="/panel/hatirlaticilar/nakit#kdv" size="sm">
                Nakit planında aç
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

/** "17 Şubat 2027" */
const dayMonthYear = (d: string) => `${dayMonthTR(d)} ${d.slice(0, 4)}`;

/**
 * Takvim kartı: satırlar, pencerenin dışındaki geçici ve kurumlar vergisi ("Sonra", tek satır) ve hesaplanmayanlar
 * satırı. Kurumlar vergisinin tutarı kartta tahmin olarak var: kartın yılıysa "Tutarı bilinmiyor" yerine kartın bağlantısı
 */
export function TaxCalendarCard({ view, extras }: { view: Pick<TaxView, "calendar" | "later" | "kvCard">; extras: CalendarExtras }) {
  const [inflation, rest] = INFLATION_LINE.split(" · ");
  const firstOfKind = new Map<string, string>();
  for (const r of view.calendar) if (!firstOfKind.has(r.kind)) firstOfKind.set(r.kind, r.key);
  return (
    <Card>
      <CardHeader icon={<CalendarClock />} title="Vergi ve SGK ödemeleri" description="Önümüzdeki 100 gün, yasal son günle. Satıra dokunun: döküm ve dayanak." />
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
        <p className="px-5 pt-3 text-[13px] leading-5 break-words text-ink-mute">
          <span className="font-medium text-ink-soft">Sonra:</span>{" "}
          {view.later.map((l, i) => (
            <span key={l.kind}>
              {i ? " · " : null}
              {calendarTitle(l)} · {dayMonthYear(l.due)} ·{" "}
              {laterOnCard(l, view.kvCard.year) ? (
                <a href="#kar-vergisi" className="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
                  tahmin kartta
                </a>
              ) : (
                <span className="text-ink-quiet">Tutarı bilinmiyor</span>
              )}
            </span>
          ))}
        </p>
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

