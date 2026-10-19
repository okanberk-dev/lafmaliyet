import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-coffee-100/70", className)} />;
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="space-y-2 rounded-2xl border border-coffee-100 bg-white p-5">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-coffee-300">{icon}</div> : null}
      <p className="font-medium text-coffee-900">{title}</p>
      {description ? <p className="max-w-md text-sm text-coffee-600">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Excel'deki hücre notlarının karşılığı: üzerine gelince açıklama */
export function InfoTip({ text, className }: { text: ReactNode; className?: string }) {
  return (
    <span className={cn("group relative inline-flex align-middle", className)}>
      <span tabIndex={0} aria-label="Açıklama" className="cursor-help text-coffee-300 outline-none hover:text-coffee-500 focus:text-coffee-500">
        <Info size={14} />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-64 max-w-[80vw] -translate-x-1/2 rounded-lg bg-coffee-950 px-3 py-2 text-left text-xs leading-relaxed font-normal tracking-normal whitespace-normal text-coffee-50 normal-case shadow-lg group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  icon,
  info,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
  icon?: ReactNode;
  info?: ReactNode;
  className?: string;
}) {
  const valueTone = {
    default: "text-coffee-950",
    good: "text-emerald-700",
    bad: "text-rose-700",
    warn: "text-amber-700",
  }[tone];
  return (
    <div className={cn("rounded-2xl border border-coffee-100 bg-white p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-coffee-600">
          {label}
          {info ? <InfoTip text={info} /> : null}
        </p>
        {icon ? <span className="text-coffee-300">{icon}</span> : null}
      </div>
      <p className={cn("mt-1.5 text-2xl font-semibold tracking-tight", valueTone)}>{value}</p>
      {sub ? <div className="mt-1 text-xs text-coffee-500">{sub}</div> : null}
    </div>
  );
}

export function Progress({ value, tone = "coffee", className }: { value: number; tone?: "coffee" | "green" | "amber" | "red"; className?: string }) {
  const color = { coffee: "bg-coffee-600", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-coffee-100", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

/** Negatif değerleri kırmızı gösteren tutar */
export function Signed({ value, children, className }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  return <span className={cn("tabular", value !== null && value !== undefined && value < 0 && "text-rose-700", className)}>{children}</span>;
}
