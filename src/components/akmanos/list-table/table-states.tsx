"use client";

import { Frown, TriangleAlert } from "lucide-react";
import { RefreshIcon } from "@/components/akmanos/charts/area-chart/icons";
import { Icon } from "@/components/akmanos/icons/icon";

export function ListTableEmptyState({
  title,
  description,
  onRefresh,
}: {
  title: string;
  description: string;
  onRefresh: () => void;
}) {
  return (
    <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-xl bg-chart-bg px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-chart-metric-bg">
        <Icon icon={Frown} size="lg" className="text-chart-muted" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-chart-muted">{description}</p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="flex h-9 min-h-9 items-center gap-1.5 rounded-xl bg-chart-metric-bg px-3 text-sm font-medium text-foreground transition-colors hover:opacity-90"
      >
        <RefreshIcon />
        <span>Refresh</span>
      </button>
    </div>
  );
}

export function ListTableErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-xl bg-chart-bg px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/60">
        <Icon
          icon={TriangleAlert}
          size="lg"
          className="text-red-600 dark:text-red-400"
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Could not load rows</p>
        <p className="max-w-sm text-sm text-chart-muted">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex h-9 min-h-9 items-center gap-1.5 rounded-xl bg-chart-metric-bg px-3 text-sm font-medium text-foreground transition-colors hover:opacity-90"
      >
        <RefreshIcon />
        <span>Try again</span>
      </button>
    </div>
  );
}

export function ListSkeletonBar({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3.5 animate-pulse rounded-md bg-border/80 dark:bg-border ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}
