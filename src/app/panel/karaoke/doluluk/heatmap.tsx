"use client";

import { Grid3x3 } from "lucide-react";
import { Fragment, useState, type CSSProperties } from "react";

import { Card, CardHeader } from "@/components/ui/card";
import type { RoomHours } from "@/lib/karaoke/occupancy";
import { WEEKDAY_NAMES, WEEKDAY_SHORT } from "@/lib/karaoke/occupancy-text";
import { cn } from "@/lib/utils";

import { HoursButton } from "./hours-dialog";

/** Sunucunun hazırladığı hücre: rakamlar ve metinler hazır (src/lib/karaoke/occupancy-text.ts) */
export interface HeatCellView {
  bucket: 0 | 1 | 2 | 3 | 4 | null;
  /** Hücredeki rakam (yüzde işaretsiz) */
  number: string;
  /** Ekran okuyucu adı */
  label: string;
  /** Seçilince alttaki satır */
  detail: string;
  open: boolean;
  /** Oda saatleri dışında dolu */
  outside: boolean;
}

export interface HeatmapView {
  /** Sütunlar (iş günü sırasıyla): "10:00" ve kısa "10" */
  hours: { hour: number; label: string; short: string }[];
  /** [haftanın günü][sütun] */
  rows: HeatCellView[][];
  outsideNote: string | null;
  overlapNote: string | null;
}

// Tek renk (mürekkep), açıktan koyuya: renk yalnız anlam taşır (TASARIM §1); rakam hücrede ya da ayrıntı satırında
const TONE: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-ink/[.06] text-ink-soft",
  1: "bg-ink/20 text-ink",
  2: "bg-ink/40 text-ink",
  3: "bg-ink/65 text-white",
  4: "bg-ink/90 text-white",
};
const SWATCH: Record<0 | 1 | 2 | 3 | 4, string> = { 0: "bg-ink/[.06]", 1: "bg-ink/20", 2: "bg-ink/40", 3: "bg-ink/65", 4: "bg-ink/90" };
const LEGEND: [string, 0 | 1 | 2 | 3 | 4][] = [
  ["%0", 0],
  ["%1–24", 1],
  ["%25–49", 2],
  ["%50–74", 3],
  ["%75+", 4],
];

/** Kapalı saat: beyaz zeminde 45° tarama (renk değil, desen) */
const HATCH: CSSProperties = { backgroundImage: "repeating-linear-gradient(45deg, var(--color-line-strong) 0 1px, transparent 1px 6px)" };

/** Sütun çoksa (gece geç kapanan oda, dışarıda dolu saatler) masaüstünde rakam xl altında gizlenir; ayrıntı satırı kalır */
const DENSE_COLUMNS = 16;

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {LEGEND.map(([text, b]) => (
        <span key={b} className="inline-flex items-center gap-1">
          <span aria-hidden="true" className={cn("size-3 rounded-[3px]", SWATCH[b])} />
          {text}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="size-3 rounded-[3px] bg-surface ring-1 ring-line-strong ring-inset" style={HATCH} />
        Kapalı
      </span>
    </span>
  );
}

/**
 * "Gün ve saat" ısı haritası. Telefonda ve tablette (lg altı) satırlar saat, sütunlar yedi gün (yatay kaydırma yok);
 * masaüstünde satırlar gün, sütunlar saat. Her hücre bir düğme: üzerine gelince, odaklanınca ya da dokununca alttaki
 * satır o gün ve saatin ayrıntısını yazar (ekran okuyucuya da okunur).
 */
export function Heatmap({ view, hours }: { view: HeatmapView; hours: RoomHours }) {
  const [selected, setSelected] = useState<{ w: number; i: number } | null>(null);
  const dense = view.hours.length > DENSE_COLUMNS;
  const detail = selected ? view.rows[selected.w]?.[selected.i]?.detail : null;

  const cell = (w: number, i: number, size: string, hideNumber?: string) => {
    const c = view.rows[w][i];
    const on = selected?.w === w && selected?.i === i;
    const pick = () => setSelected({ w, i });
    return (
      <button
        key={`${w}-${i}`}
        type="button"
        aria-label={c.label}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") pick();
        }}
        onFocus={pick}
        onClick={pick}
        className={cn(
          "relative flex min-w-0 cursor-pointer items-center justify-center rounded-[4px] text-[12px] font-medium tabular outline-offset-1",
          size,
          c.bucket !== null ? TONE[c.bucket] : c.open ? "bg-surface text-ink-quiet ring-1 ring-line ring-inset" : "bg-surface ring-1 ring-line ring-inset",
          on ? "z-10 outline-2 outline-ink" : "hover:outline-2 hover:outline-ink/30",
        )}
        style={c.open ? undefined : HATCH}
      >
        {c.number ? <span className={hideNumber}>{c.number}</span> : null}
        {c.outside ? <span aria-hidden="true" className="absolute size-1.5 rounded-full bg-ink" /> : null}
      </button>
    );
  };

  return (
    <Card>
      <CardHeader
        icon={<Grid3x3 />}
        title="Gün ve saat"
        description="Her hücre: o gün ve saatte odanın dolu olduğu süre ÷ açık süre. Gece 05:00'e kadarki saatler önceki günün satırında (kasa günü gibi)."
        meta={<Legend />}
      />
      <div className="px-3 pb-5 sm:px-5">
        {/* Telefon ve tablet: satırlar saat, sütunlar gün */}
        <div className="grid gap-[2px] lg:hidden" style={{ gridTemplateColumns: "2.75rem repeat(7, minmax(0, 1fr))" }}>
          <span aria-hidden="true" />
          {WEEKDAY_SHORT.map((d) => (
            <span key={d} aria-hidden="true" className="pb-1 text-center text-[11px] font-medium text-ink-mute">
              {d}
            </span>
          ))}
          {view.hours.map((h, i) => (
            <Fragment key={h.hour}>
              <span aria-hidden="true" className="flex items-center text-[11px] text-ink-mute tabular">
                {h.label}
              </span>
              {view.rows.map((_, w) => cell(w, i, "h-11"))}
            </Fragment>
          ))}
        </div>
        {/* Masaüstü: satırlar gün, sütunlar saat */}
        <div className="hidden gap-[2px] lg:grid" style={{ gridTemplateColumns: `6rem repeat(${view.hours.length}, minmax(0, 1fr))` }}>
          <span aria-hidden="true" />
          {view.hours.map((h) => (
            <span key={h.hour} aria-hidden="true" className="pb-1 text-center text-[11px] font-medium text-ink-mute tabular">
              {dense ? h.short : h.label}
            </span>
          ))}
          {view.rows.map((row, w) => (
            <Fragment key={w}>
              <span aria-hidden="true" className="flex items-center pr-2 text-[13px] text-ink-soft">
                {WEEKDAY_NAMES[w]}
              </span>
              {row.map((_, i) => cell(w, i, "h-10", dense ? "hidden xl:inline" : undefined))}
            </Fragment>
          ))}
        </div>

        {/* Telefonda satır ekranın altında (alt menünün üstünde) asılı kalır: uzun ızgarada dokunulan hücrenin ayrıntısı görünsün */}
        <p
          aria-live="polite"
          className="z-20 mt-3 min-h-10 rounded-xl bg-surface px-3 py-2.5 text-[13px] leading-5 text-ink-soft max-lg:sticky max-lg:bottom-[calc(var(--mobile-nav-h)+0.75rem)] max-lg:shadow-[0_4px_16px_rgb(0_0_0/0.10)] max-lg:ring-1 max-lg:ring-line"
        >
          {detail ?? (
            <>
              <span className="pointer-coarse:hidden">Bir hücre seçin: o gün ve saatin ayrıntısı burada görünür.</span>
              <span className="hidden pointer-coarse:inline">Bir hücreye dokunun: o gün ve saatin ayrıntısı burada görünür.</span>
            </>
          )}
        </p>

        {view.outsideNote || view.overlapNote ? (
          <div className="mt-3 space-y-1.5 text-[13px] leading-5 text-ink-mute">
            {view.outsideNote ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{view.outsideNote}</span>
                <HoursButton hours={hours} label="Saatleri değiştir" variant="ghost" />
              </p>
            ) : null}
            {view.overlapNote ? <p>{view.overlapNote}</p> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
