"use client";

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

import { SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { cn } from "@/lib/utils";

/**
 * Bölümlü seçim (filtre, görünüm, bölüm sekmesi). AkmanOS'un menü vurgusundaki gibi seçili parçanın
 * beyaz zemini yaylı hareketle (layoutId) bir seçenekten ötekine kayar.
 */
// Dar ekranda yatay kayar; kaydırma çubuğu gizli, taşan kenar solarak belli olur
const track =
  "inline-flex max-w-full items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-xl bg-panel p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const item =
  "relative inline-flex h-8 pointer-coarse:h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink/20";

const FADE = "1.5rem";

/**
 * Kayan şeritte seçili parçayı görünür tutar ve taşan kenarları soldurur (telefonda "daha fazla seçenek var" ipucu).
 * Ölçüm ResizeObserver ve kaydırma olayıyla yapılır; sunucu çiziminde maske yoktur.
 */
function useScrollTrack(ref: RefObject<HTMLElement | null>, value: string): CSSProperties | undefined {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { start: max > 1 && el.scrollLeft > 1, end: max > 1 && el.scrollLeft < max - 1 };
      setEdges((e) => (e.start === next.start && e.end === next.end ? e : next));
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const on = el.querySelector<HTMLElement>('[aria-checked="true"], [aria-current="page"]');
    if (!on) return;
    const left = on.offsetLeft;
    const right = left + on.offsetWidth;
    if (left < el.scrollLeft + 8) el.scrollLeft = Math.max(0, left - 24);
    else if (right > el.scrollLeft + el.clientWidth - 8) el.scrollLeft = right - el.clientWidth + 24;
  }, [ref, value]);
  if (!edges.start && !edges.end) return undefined;
  const mask = `linear-gradient(to right, ${edges.start ? "transparent" : "#000"}, #000 ${FADE}, #000 calc(100% - ${FADE}), ${edges.end ? "transparent" : "#000"})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

function Highlight({ id }: { id: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      layoutId={id}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
      className="absolute inset-0 rounded-[10px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.04)]"
    />
  );
}

function Count({ n }: { n: number }) {
  return <span className="relative z-10 text-ink-quiet tabular">{n}</span>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
  stretch,
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  /** Ekran okuyucu için grup adı */
  label?: string;
  /** Satırı kaplasın, seçenekler eşit genişlikte */
  stretch?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const fade = useScrollTrack(ref, value);
  // Ok tuşlarıyla seçenekler arasında gezinme (radiogroup davranışı)
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((o) => o.value === value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    const next = options[(i + step + options.length) % options.length];
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-value="${CSS.escape(next.value)}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <LayoutGroup id={id}>
      <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} style={fade} className={cn(track, stretch && "flex w-full", className)}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-value={o.value}
              onClick={() => onChange(o.value)}
              className={cn(item, stretch && "flex-1 justify-center", on ? "text-ink" : "text-ink-mute hover:text-ink")}
            >
              {on ? <Highlight id={`${id}-hl`} /> : null}
              <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
              {o.count !== undefined ? <Count n={o.count} /> : null}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

export function SegmentedLinks({
  options,
  value,
  className,
  label,
}: {
  options: { value: string; label: ReactNode; href: string; count?: number }[];
  value: string;
  className?: string;
  label?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const fade = useScrollTrack(ref, value);
  return (
    <LayoutGroup id={id}>
      <nav ref={ref} aria-label={label} style={fade} className={cn(track, className)}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Link key={o.value} href={o.href} aria-current={on ? "page" : undefined} className={cn(item, on ? "text-ink" : "text-ink-mute hover:text-ink")}>
              {on ? <Highlight id={`${id}-hl`} /> : null}
              <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
              {o.count !== undefined ? <Count n={o.count} /> : null}
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
