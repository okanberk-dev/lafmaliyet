"use client";

import Image from "next/image";
import { Check } from "lucide-react";
import {
  LazyMotion,
  m,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { cn } from "@/components/akmanos/lib/cn";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import {
  BEST_STREAK,
  CURRENT_STREAK,
  STREAK_DAYS,
  STREAK_ICON_SRC,
  STREAK_TITLE,
  WEEK_COMPLETED,
  getStreakMessage,
  type StreakDay,
} from "./constants";

function loadStreakMotionFeatures() {
  return import("motion/react").then((mod) => mod.domAnimation);
}

function StreakIcon({
  className,
  live = false,
  pixelSize = 40,
}: {
  className?: string;
  live?: boolean;
  pixelSize?: number;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        live && "streak-flame-live",
        className,
      )}
    >
      <Image
        src={STREAK_ICON_SRC}
        alt=""
        width={pixelSize}
        height={pixelSize}
        className="size-full object-contain"
        aria-hidden
      />
    </span>
  );
}

const dayCellVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.72 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      ...SPRING_PRESS,
      delay: 0.08 + index * 0.06,
    },
  }),
};

function StreakDayCell({ day, index }: { day: StreakDay; index: number }) {
  const reduce = useReducedMotion() ?? false;

  return (
    <m.div
      custom={index}
      variants={dayCellVariants}
      initial={reduce ? false : "hidden"}
      animate="visible"
      whileHover={reduce ? undefined : { y: -3, scale: 1.06 }}
      whileTap={reduce ? undefined : { scale: 0.94 }}
      className="flex flex-col items-center gap-2"
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-chart-muted">
        {day.label}
      </span>
      <m.span
        className={cn(
          "streak-day-dot flex size-8 items-center justify-center rounded-full transition-colors",
          day.status === "completed" && "bg-foreground",
          day.status === "today" &&
            "bg-streak-flame/12 ring-2 ring-streak-flame ring-offset-2 ring-offset-chart-card-bg",
          day.status === "upcoming" &&
            "bg-chart-metric-bg ring-1 ring-border/60",
          day.status === "missed" &&
            "bg-chart-metric-bg ring-1 ring-border",
        )}
        animate={
          reduce || day.status !== "today"
            ? undefined
            : { scale: [1, 1.08, 1], rotate: [0, -2, 2, 0] }
        }
        transition={
          reduce || day.status !== "today"
            ? undefined
            : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
        }
        aria-hidden
      >
        {day.status === "completed" ? (
          <m.span
            initial={reduce ? false : { scale: 0, rotate: -120 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
          >
            <Check className="size-4 text-background" strokeWidth={2.5} />
          </m.span>
        ) : null}
        {day.status === "today" ? (
          <StreakIcon className="size-4" pixelSize={28} live />
        ) : null}
      </m.span>
      <span className="sr-only">
        {day.label}: {day.status}
      </span>
    </m.div>
  );
}

function WeekProgressBar() {
  const reduce = useReducedMotion() ?? false;
  const progress = (WEEK_COMPLETED / STREAK_DAYS.length) * 100;

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-chart-muted">
        <span>This week</span>
        <span className="font-medium tabular-nums text-foreground">
          {WEEK_COMPLETED}/{STREAK_DAYS.length}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-chart-metric-bg ring-1 ring-border/60">
        <m.div
          className="h-full rounded-full bg-linear-to-r from-streak-flame to-streak-flame-inner"
          initial={reduce ? false : { width: 0, opacity: 0.6 }}
          animate={{ width: `${progress}%`, opacity: 1 }}
          transition={
            reduce
              ? { duration: 0 }
              : { ...SPRING_SWAP, delay: 0.35 }
          }
        />
      </div>
    </div>
  );
}

export function Streak() {
  const reduce = useReducedMotion() ?? false;
  const streakMessage = getStreakMessage(CURRENT_STREAK);

  return (
    <LazyMotion features={loadStreakMotionFeatures} strict>
      <div
        data-component="streak"
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-chart-card-bg p-4 sm:p-5"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-8 size-28 rounded-full bg-streak-flame/10 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-4 bottom-0 size-20 rounded-full bg-streak-flame-inner/10 blur-2xl"
        />

        <m.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT }}
          className="relative flex items-start gap-3"
        >
          <m.div
            className="flex size-11 shrink-0 items-center justify-center"
            animate={
              reduce
                ? undefined
                : { scale: [1, 1.05, 1], rotate: [0, -2, 2, 0] }
            }
            transition={
              reduce
                ? undefined
                : { duration: 2.8, repeat: Infinity, ease: "easeInOut" }
            }
            aria-hidden
          >
            <StreakIcon className="size-11" pixelSize={44} live />
          </m.div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-chart-muted">{STREAK_TITLE}</p>
              <m.div
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduce ? { duration: 0 } : { delay: 0.15, duration: 0.3 }}
                className="shrink-0 text-right text-xs leading-snug text-chart-muted"
              >
                <span className="block">Personal best</span>
                <span className="font-medium tabular-nums text-foreground">
                  {BEST_STREAK} days
                </span>
              </m.div>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                <AnimatedNumber value={CURRENT_STREAK} />
              </span>
              <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
                <span className="font-medium text-foreground">day streak</span>
                <span className="text-chart-muted" aria-hidden>
                  ·
                </span>
                <m.span
                  initial={reduce ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { delay: 0.2, duration: 0.35, ease: EASE_OUT }
                  }
                  className="font-semibold text-streak-flame"
                >
                  {streakMessage}
                </m.span>
              </span>
            </div>
          </div>
        </m.div>

        <div className="relative mt-5 grid grid-cols-7 gap-1">
          {STREAK_DAYS.map((day, index) => (
            <StreakDayCell key={day.id} day={day} index={index} />
          ))}
        </div>

        <WeekProgressBar />
      </div>
    </LazyMotion>
  );
}
