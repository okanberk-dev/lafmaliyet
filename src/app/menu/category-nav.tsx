"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

/**
 * QR menünün yapışkan kategori şeridi: ekranda okunan kategori koyu görünür ve şeritte ortaya kaydırılır.
 * Bağlantılar gerçek #k12 çapaları (JS olmadan da çalışır); dokununca bölüme kayılır. Şerit parmakla kayar
 * (parçalara oturur, kenarlarda devamı olduğunu gösteren solma). Aşağı inilince sağ altta "başa dön" düğmesi.
 */
export function CategoryNav({ categories }: { categories: { id: number; name: string }[] }) {
  const reduce = useCalmMotion();
  const [active, setActive] = useState<number | null>(categories[0]?.id ?? null);
  const rowRef = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const [far, setFar] = useState(false);

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
      { rootMargin: "-120px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    const onScroll = () => {
      setFar(window.scrollY > window.innerHeight * 1.5);
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
    <>
      <nav className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur-md" aria-label="Kategoriler">
        <div
          ref={rowRef}
          className="mx-auto flex max-w-3xl snap-x scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 py-2.5 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1.5rem),transparent)] [&::-webkit-scrollbar]:hidden"
        >
          {categories.map((c) => {
            const on = c.id === active;
            return (
              <a
                key={c.id}
                href={`#k${c.id}`}
                onClick={() => go(c.id)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "inline-flex h-11 shrink-0 snap-start items-center rounded-full px-4 text-[15px] font-medium whitespace-nowrap ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-700 sm:text-sm",
                  on ? "bg-brand-700 text-white ring-brand-700" : "bg-surface text-ink-soft ring-line hover:text-ink",
                )}
              >
                {c.name}
              </a>
            );
          })}
        </div>
      </nav>
      {/* Uzun menüde başa dönüş: ortada (adlar solda, fiyatlar sağda kalır), ana ekran çubuğunun üstünde */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] z-20 flex justify-center">
        <a
          href="#ust"
          onClick={() => setActive(categories[0]?.id ?? null)}
          tabIndex={far ? undefined : -1}
          aria-hidden={far ? undefined : true}
          className={cn(
            "inline-flex h-11 items-center gap-1.5 rounded-full bg-brand-700 pr-4 pl-3.5 text-sm font-medium text-white shadow-[0_8px_24px_rgba(12,59,45,0.3)] transition-[opacity,transform] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
            far ? "pointer-events-auto opacity-100" : "translate-y-3 opacity-0",
          )}
        >
          <ArrowUp size={16} aria-hidden="true" />
          Başa dön
        </a>
      </div>
    </>
  );
}
