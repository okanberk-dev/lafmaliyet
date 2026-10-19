"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * İstemci tarafı sayfalama. Liste (filtre, arama) değişince ilk sayfaya döner:
 * `resetKey` olarak filtrelerin birleşimini verin.
 */
export function usePaged<T>(items: T[], pageSize = 25, resetKey = "") {
  const [state, setState] = useState({ page: 1, key: resetKey });
  const page = state.key === resetKey ? state.page : 1;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const slice = items.slice((current - 1) * pageSize, current * pageSize);
  return {
    page: current,
    pageCount,
    slice,
    total: items.length,
    setPage: (p: number) => setState({ page: Math.max(1, Math.min(pageCount, p)), key: resetKey }),
  };
}

function pagesToShow(page: number, count: number): (number | "…")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => set.add(p));
  if (page >= count - 2) [count - 1, count - 2, count - 3].forEach((p) => set.add(p));
  const list = [...set].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

/** AkmanOS sayfalaması: solda "Sayfa 1 / 6", sağda koyu etkin sayfa */
export function Pagination({
  page,
  pageCount,
  onChange,
  total,
  unit = "kayıt",
  className,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
  total?: number;
  unit?: string;
  className?: string;
}) {
  if (pageCount <= 1 && total === undefined) return null;
  const btn =
    "flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-xl px-2.5 text-sm font-medium tabular transition-colors disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav className={cn("flex flex-wrap items-center justify-between gap-3 px-5 py-4", className)} aria-label="Sayfalama">
      <p className="text-sm text-ink-mute">
        Sayfa {page} / {pageCount}
        {total !== undefined ? <span className="text-ink-quiet"> · {total.toLocaleString("tr-TR")} {unit}</span> : null}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1.5">
          <button type="button" className={cn(btn, "bg-surface text-ink-mute ring-1 ring-line hover:text-ink")} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Önceki sayfa">
            <ChevronLeft size={16} />
          </button>
          {pagesToShow(page, pageCount).map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="px-1 text-ink-quiet">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p)}
                aria-current={p === page ? "page" : undefined}
                className={cn(btn, p === page ? "bg-ink text-white" : "bg-surface text-ink-soft ring-1 ring-line hover:text-ink")}
              >
                {p}
              </button>
            ),
          )}
          <button type="button" className={cn(btn, "bg-surface text-ink-mute ring-1 ring-line hover:text-ink")} disabled={page >= pageCount} onClick={() => onChange(page + 1)} aria-label="Sonraki sayfa">
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </nav>
  );
}
