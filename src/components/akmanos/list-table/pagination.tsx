"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Icon } from "@/components/akmanos/icons/icon";

export function ListTablePagination({
  page,
  pageCount,
  onPageChange,
  disabled,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const pages = useMemo(() => {
    if (pageCount <= 5) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    if (page <= 3) {
      return [1, 2, 3, 4, pageCount];
    }

    if (page >= pageCount - 2) {
      return [1, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
    }

    return [1, page - 1, page, page + 1, pageCount];
  }, [page, pageCount]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-chart-muted tabular-nums">
        Page {page} of {pageCount}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
          className="flex h-9 min-h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-chart-metric-bg text-chart-muted transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label="Previous page"
        >
          <Icon icon={ChevronLeft} size="sm" />
        </button>
        {pages.map((item, index) => {
          const prev = pages[index - 1];
          const showEllipsis = prev !== undefined && item - prev > 1;

          return (
            <span key={item} className="contents">
              {showEllipsis ? (
                <span className="px-1 text-sm text-chart-muted">…</span>
              ) : null}
              <button
                type="button"
                onClick={() => onPageChange(item)}
                disabled={disabled}
                className={`flex h-9 min-h-9 min-w-9 shrink-0 items-center justify-center rounded-xl px-2.5 text-sm font-medium tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                  item === page
                    ? "bg-foreground text-background"
                    : "bg-chart-metric-bg text-chart-muted hover:text-foreground"
                }`}
                aria-label={`Go to page ${item}`}
                aria-current={item === page ? "page" : undefined}
              >
                {item}
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= pageCount}
          className="flex h-9 min-h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-chart-metric-bg text-chart-muted transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next page"
        >
          <Icon icon={ChevronRight} size="sm" />
        </button>
      </div>
    </div>
  );
}
