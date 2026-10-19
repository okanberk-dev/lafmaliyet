"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { Info } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import {
  AnimatedGrowth,
  AnimatedNumber,
} from "@/components/akmanos/charts/animated-number";
import { cn } from "@/components/akmanos/lib/cn";
import { SPRING_LAYOUT } from "@/components/akmanos/lib/motion-ease";
import {
  CAPACITY_ACCENT,
  CAPACITY_BY_PERIOD,
  CAPACITY_MEMBERS,
  CAPACITY_PERIODS,
  CAPACITY_SEGMENT_COUNT,
  type CapacityPeriod,
} from "./constants";

function CapacitySegmentBar({ percent }: { percent: number }) {
  const filled = Math.round(
    (Math.min(100, Math.max(0, percent)) / 100) * CAPACITY_SEGMENT_COUNT,
  );

  return (
    <div
      className="flex h-8 w-full items-stretch gap-[3px]"
      role="img"
      aria-label={`${percent}% capacity allocated`}
    >
      {Array.from({ length: CAPACITY_SEGMENT_COUNT }, (_, index) => {
        const active = index < filled;
        return (
          <span
            key={index}
            className="min-w-0 flex-1 rounded-[3px]"
            style={{
              background: active
                ? `var(--capacity-accent, ${CAPACITY_ACCENT})`
                : "var(--capacity-empty, var(--chart-card-bg))",
            }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

export function CapacityAllocationCard() {
  const [period, setPeriod] = useState<CapacityPeriod>("week");
  const reduce = useReducedMotion() ?? false;
  const pillId = useId();
  const stats = CAPACITY_BY_PERIOD[period];
  const visibleMembers = CAPACITY_MEMBERS.slice(0, 3);

  return (
    <div
      data-component="capacity-allocation-card"
      className="w-full max-w-xl overflow-hidden rounded-3xl bg-chart-metric-bg p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="truncate text-[15px] font-medium tracking-tight text-foreground sm:text-base">
            Capacity Allocation
          </h2>
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-chart-muted transition-colors hover:text-foreground"
            aria-label="About capacity allocation"
            title="Share of planned labor capacity currently allocated"
          >
            <Info className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <LayoutGroup id={pillId}>
          <div
            className="inline-flex w-full shrink-0 rounded-full bg-chart-card-bg p-0.5 sm:w-auto"
            role="tablist"
            aria-label="Time range"
          >
            {CAPACITY_PERIODS.map((option) => {
              const active = period === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPeriod(option.id)}
                  className={cn(
                    "relative z-10 flex h-8 min-h-8 flex-1 items-center justify-center rounded-full px-3 text-[12px] font-medium transition-colors sm:flex-none sm:px-3.5",
                    active
                      ? "text-foreground"
                      : "text-chart-muted hover:text-foreground",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="capacity-period-pill"
                      className="absolute inset-0 -z-10 rounded-full bg-chart-metric-bg shadow-[0_1px_3px_rgba(0,0,0,0.10),0_0_0_0.5px_rgba(0,0,0,0.04)] dark:bg-chart-bg"
                      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                    />
                  ) : null}
                  <span className="relative">{option.label}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-x-2.5 gap-y-1">
        <span className="text-4xl font-semibold tracking-tight text-foreground tabular-nums sm:text-[2.75rem] sm:leading-none">
          <AnimatedNumber
            value={stats.percent}
            format={(value) => `${Math.round(value)}%`}
          />
        </span>
        <div className="mb-1 flex flex-wrap items-baseline gap-1.5">
          <span
            style={{ color: `var(--capacity-accent, ${CAPACITY_ACCENT})` }}
          >
            <AnimatedGrowth
              value={stats.delta}
              className="text-sm font-medium"
            />
          </span>
          <span className="text-sm text-chart-muted">vs labor plan</span>
        </div>
      </div>

      <div className="mt-5">
        <CapacitySegmentBar percent={stats.percent} />
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-none">
          <span className="text-chart-muted">Queued Orders: </span>
          <span className="font-medium text-foreground tabular-nums">
            <AnimatedNumber value={stats.queuedOrders} /> orders
          </span>
        </p>

        <div className="flex items-center gap-2">
          <div className="flex items-center -space-x-2" aria-hidden>
            {visibleMembers.map((member) => (
              <span
                key={member.id}
                className={cn(
                  "relative inline-flex size-7 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold ring-2 ring-chart-metric-bg",
                  !member.src && member.toneClass,
                )}
                title={member.name}
              >
                {member.src ? (
                  <Image
                    src={member.src}
                    alt=""
                    width={28}
                    height={28}
                    className="size-full object-cover"
                  />
                ) : (
                  member.initials
                )}
              </span>
            ))}
          </div>
          <span className="text-sm text-chart-muted tabular-nums">
            {stats.memberCount} Members
          </span>
        </div>
      </div>
    </div>
  );
}
