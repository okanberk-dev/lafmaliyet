"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function FloatingPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}

export type BulkAction = {
  id: string;
  label: string;
  tone?: "default" | "danger";
  onClick: () => void;
};

function BulkActionButton({
  label,
  onClick,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-9 min-h-9 items-center rounded-xl px-3 text-sm font-medium transition-colors ${
        tone === "danger"
          ? "bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400"
          : "bg-chart-metric-bg text-foreground hover:opacity-90"
      }`}
    >
      {label}
    </button>
  );
}

export function BulkSelectionBar({
  selectedCount,
  actions,
  onClear,
}: {
  selectedCount: number;
  actions: BulkAction[];
  onClear: () => void;
}) {
  if (selectedCount <= 0) return null;

  return (
    <FloatingPortal>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:bottom-4 sm:p-4">
        <div
          data-component="list-table-bulk-bar"
          role="status"
          aria-live="polite"
          className="pointer-events-auto w-full max-w-4xl rounded-2xl border border-border bg-chart-card-bg px-3 py-3 shadow-lg shadow-black/10 sm:px-4 dark:shadow-black/35"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-3 sm:justify-start">
              <p className="text-sm font-medium text-foreground">
                <span className="tabular-nums text-[var(--carousel-accent,#a3d018)]">
                  {selectedCount}
                </span>{" "}
                <span className="text-chart-muted">selected</span>
              </p>
              <button
                type="button"
                onClick={onClear}
                className="flex h-9 min-h-9 items-center rounded-xl px-3 text-sm font-medium text-chart-muted transition-colors hover:text-foreground"
              >
                Clear
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {actions.map((action) => (
                <BulkActionButton
                  key={action.id}
                  label={action.label}
                  tone={action.tone}
                  onClick={action.onClick}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}
