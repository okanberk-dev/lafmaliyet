"use client";

import { useEffect, useRef, useState } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

/**
 * QR menünün yapışkan kategori şeridi: ekranda okunan kategori koyu görünür ve şeritte ortaya kaydırılır.
 * Bağlantılar gerçek #k12 çapaları (JS olmadan da çalışır); dokununca bölüme kayılır.
 */
export function CategoryNav({ categories }: { categories: { id: number; name: string }[] }) {
  const reduce = useCalmMotion();
  const [active, setActive] = useState<number | null>(categories[0]?.id ?? null);
  const rowRef = useRef<HTMLDivElement>(null);
  const locked = useRef(false);

  // Üst şeridin hemen altından ekranın ortasına kadarki bantta kalan ilk kategori etkin
  useEffect(() => {
    const els = categories.map((c) => document.getElementById(`k${c.id}`)).filter((el): el is HTMLElement => el !== null);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const inBand = new Set<string>();
    const atBottom = () => window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const pick = () => {
      if (locked.current) return;
      if (atBottom()) return setActive(categories[categories.length - 1].id);
      const first = categories.find((c) => inBand.has(`k${c.id}`));
      if (first) setActive(first.id);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id);
          else inBand.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: "-72px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    const onScroll = () => {
      if (!locked.current && atBottom()) pick();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [categories]);

  // Etkin kategoriyi şeridin ortasına getir (sayfayı değil, yalnızca şeridi kaydırır)
  useEffect(() => {
    const row = rowRef.current;
    const link = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !link || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    row.scrollTo({ left: row.scrollLeft + l.left - r.left - (r.width - l.width) / 2, behavior: reduce ? "auto" : "smooth" });
  }, [active, reduce]);

  function go(id: number) {
    setActive(id);
    // Kayma sürerken aradaki kategoriler vurguyu oynatmasın
    locked.current = true;
    const release = () => {
      locked.current = false;
    };
    window.addEventListener("scrollend", release, { once: true });
    window.setTimeout(release, 1200);
  }

  return (
    <nav className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur-md" aria-label="Kategoriler">
      <div ref={rowRef} className="scroll-thin mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-2.5">
        {categories.map((c) => {
          const on = c.id === active;
          return (
            <a
              key={c.id}
              href={`#k${c.id}`}
              onClick={() => go(c.id)}
              aria-current={on ? "true" : undefined}
              className={cn(
                "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap ring-1 transition-colors",
                on ? "bg-brand-700 text-white ring-brand-700" : "bg-surface text-ink-soft ring-line hover:text-ink",
              )}
            >
              {c.name}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
