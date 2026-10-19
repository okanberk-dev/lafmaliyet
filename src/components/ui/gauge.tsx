"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * AkmanOS "Gauge" (src/components/akmanos/gauge): yarım dairede yuvarlak uçlu çubuklar, siyahtan griye
 * geçen dolgu, açılışta yumuşak dolma. Paneldeki sürüm metni kendisi yazmak yerine `display` alır
 * ve hedefi ince bir işaretle gösterir. value ve target 0–1 arası oranlardır.
 */
const GRADIENTS = {
  brand: ["#171717", "#a1a1aa"],
  warn: ["#c2410c", "#fdba74"],
  bad: ["#dc2626", "#fca5a5"],
} as const;

/** Sunucu ve tarayıcı aynı sayıyı yazsın diye (hidrasyon) koordinatlar iki basamağa yuvarlanır */
const r2 = (n: number) => Math.round(n * 100) / 100;

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const c = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${c(16)} ${c(8)} ${c(0)})`;
}

export function Gauge({
  value,
  target,
  label,
  display,
  tone = "brand",
  className,
  ticks = 30,
}: {
  value: number;
  target?: number;
  label: ReactNode;
  display: ReactNode;
  tone?: "brand" | "warn" | "bad";
  className?: string;
  ticks?: number;
}) {
  const v = Math.max(0, Math.min(1, value));
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setProgress(v));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / 1400, 1);
      setProgress((1 - Math.pow(1 - t, 3)) * v);
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [v]);

  const size = 240;
  const cx = size / 2;
  const cy = size * 0.52;
  const inner = size * 0.3;
  const outer = size * 0.42;
  const gap = 5;
  const bars = useMemo(() => {
    const barAngle = (180 - gap * (ticks - 1)) / ticks;
    return Array.from({ length: ticks }, (_, i) => {
      const a = ((180 + i * (barAngle + gap)) * Math.PI) / 180;
      return { i, x1: r2(cx + inner * Math.cos(a)), y1: r2(cy + inner * Math.sin(a)), x2: r2(cx + outer * Math.cos(a)), y2: r2(cy + outer * Math.sin(a)) };
    });
  }, [ticks, cx, cy, inner, outer]);

  const filled = progress * ticks;
  const active = Math.max(0, Math.ceil(filled));
  const [from, to] = GRADIENTS[tone];
  const ta = target !== undefined ? Math.PI * (1 + Math.max(0, Math.min(1, target))) : null;
  const h = r2(size * 0.56);

  return (
    <div data-component="gauge" className={cn("relative mx-auto w-full max-w-[260px]", className)}>
      <svg viewBox={`0 0 ${size} ${h}`} className="block w-full" aria-hidden="true">
        {bars.map((b) => {
          const f = Math.max(0, Math.min(1, filled - b.i));
          const len = r2(Math.hypot(b.x2 - b.x1, b.y2 - b.y1));
          return (
            <g key={b.i}>
              <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} strokeWidth={7} strokeLinecap="round" stroke="#e4e4e7" />
              {f > 0 ? (
                <line
                  x1={b.x1}
                  y1={b.y1}
                  x2={b.x2}
                  y2={b.y2}
                  strokeWidth={7}
                  strokeLinecap="round"
                  stroke={mix(from, to, active <= 1 ? 0 : b.i / (active - 1))}
                  strokeDasharray={len}
                  strokeDashoffset={r2(len * (1 - f))}
                />
              ) : null}
            </g>
          );
        })}
        {ta !== null ? (
          <line
            x1={r2(cx + (inner - 10) * Math.cos(ta))}
            y1={r2(cy + (inner - 10) * Math.sin(ta))}
            x2={r2(cx + (outer + 8) * Math.cos(ta))}
            y2={r2(cy + (outer + 8) * Math.sin(ta))}
            stroke="#e8590c"
            strokeWidth={3}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-[58%] flex justify-center">
        <span className="text-3xl leading-none font-semibold tracking-tight text-ink tabular">{display}</span>
      </div>
      <p className="mt-1 text-center text-[13px] font-medium text-ink-mute">{label}</p>
    </div>
  );
}
