"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/akmanos/lib/cn";
import {
  GAUGE_DEFAULT_LABEL,
  GAUGE_DEFAULT_VALUE,
  GAUGE_MAX,
  GAUGE_MIN,
  GAUGE_VALUE_DURATION_MS,
} from "./constants";

type GaugeBar = {
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
};

type GaugeGradient = {
  start: string;
  end: string;
};

const FALLBACK_GRADIENT: GaugeGradient = {
  start: "#171717",
  end: "#71717a",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3);
}

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(media.matches);

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduce;
}

function readGaugeGradient(root: HTMLElement | null): GaugeGradient {
  if (!root) {
    return FALLBACK_GRADIENT;
  }

  const styles = getComputedStyle(root);

  return {
    start:
      styles.getPropertyValue("--gauge-gradient-start").trim() ||
      FALLBACK_GRADIENT.start,
    end:
      styles.getPropertyValue("--gauge-gradient-end").trim() ||
      FALLBACK_GRADIENT.end,
  };
}

function parseHexColor(hex: string) {
  const normalized = hex.replace("#", "").trim();

  if (normalized.length !== 6) {
    return null;
  }

  const value = Number.parseInt(normalized, 16);

  if (Number.isNaN(value)) {
    return null;
  }

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function mixHexColors(start: string, end: string, amount: number) {
  const from = parseHexColor(start);
  const to = parseHexColor(end);

  if (!from || !to) {
    return start;
  }

  const t = clamp(amount, 0, 1);
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);

  return `rgb(${r} ${g} ${b})`;
}

function roundSvg(value: number) {
  return Math.round(value * 100) / 100;
}

function buildBars(
  size: number,
  barCount: number,
  gapDegrees: number,
): GaugeBar[] {
  const cx = size / 2;
  const cy = size * 0.52;
  const innerR = size * 0.3;
  const outerR = size * 0.42;
  const startAngle = 180;
  const totalArc = 180;
  const totalGap = gapDegrees * (barCount - 1);
  const barAngle = (totalArc - totalGap) / barCount;

  return Array.from({ length: barCount }, (_, index) => {
    const angleDeg = startAngle + index * (barAngle + gapDegrees);
    const rad = (angleDeg * Math.PI) / 180;

    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    return {
      index,
      x1: roundSvg(cx + innerR * cos),
      y1: roundSvg(cy + innerR * sin),
      x2: roundSvg(cx + outerR * cos),
      y2: roundSvg(cy + outerR * sin),
      length: roundSvg(Math.hypot(outerR * cos - innerR * cos, outerR * sin - innerR * sin)),
    };
  });
}

export type GaugeProps = {
  value?: number;
  min?: number;
  max?: number;
  size?: number;
  barCount?: number;
  gapDegrees?: number;
  thickness?: number;
  showValue?: boolean;
  label?: string;
  className?: string;
};

export function Gauge({
  value = GAUGE_DEFAULT_VALUE,
  min = GAUGE_MIN,
  max = GAUGE_MAX,
  size = 280,
  barCount = 34,
  gapDegrees = 5,
  thickness = 8,
  showValue = true,
  label = GAUGE_DEFAULT_LABEL,
  className,
}: GaugeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const [gradient, setGradient] = useState<GaugeGradient>(FALLBACK_GRADIENT);

  const range = max - min;
  const clamped =
    range <= 0 ? min : Math.min(max, Math.max(min, value));
  const normalized = range <= 0 ? 0 : (clamped - min) / range;
  const targetBarSpan = normalized * barCount;

  const [fillProgress, setFillProgress] = useState(
    reduceMotion ? normalized : 0,
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const syncGradient = () => setGradient(readGaugeGradient(root));

    syncGradient();

    const observer = new MutationObserver(syncGradient);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setFillProgress(normalized);
      return;
    }

    setFillProgress(0);
    const duration = GAUGE_VALUE_DURATION_MS;
    const startTime = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      setFillProgress(easeOutCubic(t) * normalized);

      if (t < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [normalized, reduceMotion]);

  const bars = useMemo(
    () => buildBars(size, barCount, gapDegrees),
    [size, barCount, gapDegrees],
  );

  const filledBarSpan = fillProgress * barCount;
  const activeBarCount = Math.max(0, Math.ceil(filledBarSpan));
  const displayPercent = Math.round(fillProgress * 100);
  const viewHeight = roundSvg(size * 0.56);

  const activeStrokeForIndex = (index: number) => {
    if (activeBarCount <= 1) {
      return gradient.start;
    }

    const amount = index / (activeBarCount - 1);
    return mixHexColors(gradient.start, gradient.end, amount);
  };

  return (
    <div
      ref={rootRef}
      data-component="gauge"
      className={cn(
        "w-full max-w-sm rounded-3xl bg-chart-card-bg px-4 py-6 sm:px-6 sm:py-8",
        className,
      )}
    >
      <div
        className="relative mx-auto"
        style={{ width: size, maxWidth: "100%" }}
      >
        <svg
          width={size}
          height={viewHeight}
          viewBox={`0 0 ${size} ${viewHeight}`}
          className="mx-auto block max-w-full"
          role={showValue ? undefined : "img"}
          aria-hidden={showValue ? true : undefined}
          aria-label={
            showValue ? undefined : `${displayPercent}% ${label}`.trim()
          }
        >
          {bars.map((bar) => {
            const barFill = clamp(filledBarSpan - bar.index, 0, 1);

            return (
              <g key={bar.index}>
                <line
                  x1={bar.x1}
                  y1={bar.y1}
                  x2={bar.x2}
                  y2={bar.y2}
                  strokeWidth={thickness}
                  strokeLinecap="round"
                  className="gauge-bar gauge-bar-track"
                />
                {barFill > 0 ? (
                  <line
                    x1={bar.x1}
                    y1={bar.y1}
                    x2={bar.x2}
                    y2={bar.y2}
                    strokeWidth={thickness}
                    strokeLinecap="round"
                    className="gauge-bar gauge-bar-fill"
                    style={{
                      stroke: activeStrokeForIndex(bar.index),
                      strokeDasharray: bar.length,
                      strokeDashoffset: roundSvg(bar.length * (1 - barFill)),
                    }}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {(showValue || label) && (
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 pb-1 text-center"
          >
            {showValue ? (
              <span className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">
                {displayPercent}%
              </span>
            ) : null}
            {label ? (
              <span className="text-sm font-medium text-chart-muted">
                {label}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
