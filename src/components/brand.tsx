import { cn } from "@/lib/utils";

import { LAF_BEAN, LAF_LETTERS, LAF_VIEWBOX } from "./laf-paths";

type Tone = "duo" | "ink" | "green" | "cream";

const TONES: Record<Tone, { letters: string; bean: string }> = {
  duo: { letters: "#211c18", bean: "#c9a24a" },
  ink: { letters: "currentColor", bean: "currentColor" },
  green: { letters: "#1d6d56", bean: "#c9a24a" },
  cream: { letters: "#fbf8f4", bean: "#e8c877" },
};

/** L'Af işareti: L + kahve çekirdeği kesme işareti + A + f (laffogato.net logosu) */
export function LafMark({ tone = "duo", className, title }: { tone?: Tone; className?: string; title?: string }) {
  const c = TONES[tone];
  return (
    <svg
      viewBox={LAF_VIEWBOX}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("h-8 w-auto", className)}
    >
      <path fillRule="evenodd" d={LAF_LETTERS} fill={c.letters} />
      <path fillRule="evenodd" d={LAF_BEAN} fill={c.bean} />
    </svg>
  );
}

/** Uygulama ikonu gibi: yeşil karo, krem harfler, pirinç çekirdek */
export function LafTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-[radial-gradient(circle_at_30%_20%,#23876a,#1d6d56_55%,#0c3b2d)] shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]",
        className,
      )}
    >
      <LafMark tone="cream" className="h-[58%] w-auto" />
    </span>
  );
}

export function Wordmark({ className, sub }: { className?: string; sub?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LafTile />
      <span className="leading-tight">
        <span className="block font-display text-[17px] font-bold tracking-tight text-ink">L&apos;Affogato</span>
        {sub ? <span className="block text-[11px] font-medium text-ink-mute">{sub}</span> : null}
      </span>
    </span>
  );
}
