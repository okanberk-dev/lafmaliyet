import type { ReactNode } from "react";

import type { ProductStatus } from "@/lib/calc/engine";
import { cn } from "@/lib/utils";

export type Tone = "green" | "amber" | "red" | "blue" | "gray" | "coffee" | "violet";

const toneClass: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-rose-50 text-rose-800 ring-rose-600/20",
  blue: "bg-sky-50 text-sky-800 ring-sky-600/20",
  gray: "bg-stone-100 text-stone-700 ring-stone-500/20",
  coffee: "bg-coffee-100 text-coffee-800 ring-coffee-600/20",
  violet: "bg-violet-50 text-violet-800 ring-violet-600/20",
};

export function Badge({ tone = "gray", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        toneClass[tone],
        className,
      )}
    >
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
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}
