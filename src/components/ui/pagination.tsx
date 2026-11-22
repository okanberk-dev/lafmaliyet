"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useQueryState } from "./filters";

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

/**
 * usePaged gibi, ama sayfa numarası adreste durur (?sayfa=3): yenileyince, paylaşılan bağlantıda ve karttan geri
 * dönünce aynı sayfa açılır. Süzgeç değişince (resetKey) ilk sayfaya döner ve adresten silinir.
 */
export function useUrlPaged<T>(items: T[], pageSize = 25, resetKey = "", param = "sayfa") {
  const [raw, setRaw] = useQueryState<string>(param, "");
  const [state, setState] = useState(() => ({ page: Math.max(1, Number.parseInt(raw, 10) || 1), key: resetKey }));
  // Süzgeç değişince adresteki eski sayfa numarası silinir (ilk açılışta adresten okunan korunur)
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setRaw("");
  }, [resetKey, setRaw]);
  const page = state.key === resetKey ? state.page : 1;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  return {
    page: current,
    pageCount,
    slice: items.slice((current - 1) * pageSize, current * pageSize),
    total: items.length,
    setPage: (p: number) => {
      const next = Math.max(1, Math.min(pageCount, p));
      setState({ page: next, key: resetKey });
      setRaw(next === 1 ? "" : String(next));
    },
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

/**
 * Sayfa değişince listenin başı ekranın üstündeyse (telefonda uzun kart listesinin altından "Sonraki sayfa")
 * listenin başına kaydırılır: yeni sayfanın ilk kaydı görünür. Liste başı `[data-page-top]` ile işaretlenebilir;
 * yoksa sayfalamayı içeren kart (<section>) kullanılır. Üstte yapışkan çubuk (telefon ve tablette 56px) hesaba katılır.
 */
function scrollListTop(from: HTMLElement | null) {
  const target = from?.closest<HTMLElement>("[data-page-top]") ?? from?.closest<HTMLElement>("section");
  if (!target) return;
  requestAnimationFrame(() => {
    const top = target.getBoundingClientRect().top;
    const bar = window.matchMedia("(width < 64rem)").matches ? 64 : 16;
    if (top >= bar) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, window.scrollY + top - bar), behavior: reduce ? "instant" : "smooth" });
  });
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
  const nav = useRef<HTMLElement>(null);
  if (pageCount <= 1 && total === undefined) return null;
  const go = (p: number) => {
    onChange(p);
    scrollListTop(nav.current);
  };
  const btn =
    "flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-xl px-2.5 text-sm font-medium tabular transition-colors disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:min-w-11";
  return (
    <nav ref={nav} className={cn("flex flex-wrap items-center justify-between gap-3 px-5 py-4", className)} aria-label="Sayfalama">
      <p className="text-sm text-ink-mute">
        Sayfa {page} / {pageCount}
        {total !== undefined ? <span className="text-ink-quiet"> · {total.toLocaleString("tr-TR")} {unit}</span> : null}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1.5">
          <button type="button" className={cn(btn, "bg-surface text-ink-mute ring-1 ring-line hover:text-ink")} disabled={page <= 1} onClick={() => go(page - 1)} aria-label="Önceki sayfa">
            <ChevronLeft size={16} />
          </button>
          {pagesToShow(page, pageCount).map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="px-1 text-ink-quiet max-sm:hidden">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                aria-current={p === page ? "page" : undefined}
                // Telefonda yalnız ‹ › kalır (solda "Sayfa 3 / 12" yazar), sayfa düğmeleri satırı taşırmaz
                className={cn(btn, p === page ? "bg-ink text-on-solid" : "bg-surface text-ink-soft ring-1 ring-line hover:text-ink max-sm:hidden")}
              >
                {p}
              </button>
            ),
          )}
          <button type="button" className={cn(btn, "bg-surface text-ink-mute ring-1 ring-line hover:text-ink")} disabled={page >= pageCount} onClick={() => go(page + 1)} aria-label="Sonraki sayfa">
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </nav>
  );
}
