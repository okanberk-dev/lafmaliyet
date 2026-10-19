import type { ReactNode } from "react";
import { cn } from "@/components/akmanos/lib/cn";

export function CommandPaletteKbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex min-h-5 items-center rounded-md bg-chart-metric-bg px-1.5 text-[10px] font-medium uppercase tracking-wide text-chart-muted ring-1 ring-border",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
