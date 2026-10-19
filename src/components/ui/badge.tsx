import type { ReactNode } from "react";

import type { ProductStatus } from "@/lib/calc/engine";
import { cn } from "@/lib/utils";

export type Tone = "green" | "amber" | "red" | "blue" | "gray" | "coffee" | "violet" | "orange" | "solid";

/** AkmanOS hap rozeti: halkasız, açık zemin; olumlu ton AkmanOS limonu (#c0f21e %25 / #1f3a08) */
const toneClass: Record<Tone, string> = {
  green: "bg-lime/25 text-good-ink",
  amber: "bg-warn-soft text-warn",
  red: "bg-bad-soft text-bad",
  blue: "bg-info-soft text-info",
  gray: "bg-panel text-ink-mute ring-1 ring-inset ring-line",
  coffee: "bg-brass-100 text-brass-800",
  violet: "bg-bordo-50 text-bordo-800",
  orange: "bg-brass-100 text-brass-800",
  solid: "bg-ink text-white",
};

const dotClass: Record<Tone, string> = {
  green: "bg-good",
  amber: "bg-brass-500",
  red: "bg-bad",
  blue: "bg-info",
  gray: "bg-ink-quiet",
  coffee: "bg-brass-700",
  violet: "bg-bordo-600",
  orange: "bg-brass-500",
  solid: "bg-white",
};

export function Badge({
  tone = "gray",
  dot,
  className,
  children,
  title,
}: {
  tone?: Tone;
  /** Başına durum noktası koyar (renk tek başına anlam taşımasın diye metinle birlikte) */
  dot?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", dotClass[tone])} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<ProductStatus, Tone> = {
  İyi: "green",
  Dikkat: "amber",
  "Düşük kâr": "red",
  "Reçete yok": "gray",
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {status}
    </Badge>
  );
}
