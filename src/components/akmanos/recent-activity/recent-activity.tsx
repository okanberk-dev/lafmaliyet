"use client";

import { useMemo } from "react";
import {
  CreditCard,
  MessageSquare,
  Rocket,
  Sparkles,
  Upload,
  UserPlus,
} from "lucide-react";
import { LazyMotion, m, useReducedMotion } from "motion/react";
import { cn } from "@/components/akmanos/lib/cn";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import {
  DEFAULT_RECENT_ACTIVITY,
  RECENT_ACTIVITY_TITLE,
  RECENT_ACTIVITY_VIEW_ALL_LABEL,
} from "./constants";
import type {
  RecentActivityItem,
  RecentActivityKind,
  RecentActivityProps,
} from "./types";

function loadMotionFeatures() {
  return import("motion/react").then((mod) => mod.domAnimation);
}

/** iOS-style app-icon wells — saturated fills, white glyphs. */
const KIND_META: Record<
  RecentActivityKind,
  { icon: typeof Upload; well: string }
> = {
  upload: {
    icon: Upload,
    well: "bg-[#64d2ff]",
  },
  deploy: {
    icon: Rocket,
    well: "bg-[#30d158]",
  },
  member: {
    icon: UserPlus,
    well: "bg-[#bf5af2]",
  },
  billing: {
    icon: CreditCard,
    well: "bg-[#ffd60a] text-[#1c1c1e]",
  },
  comment: {
    icon: MessageSquare,
    well: "bg-[#ff375f]",
  },
  system: {
    icon: Sparkles,
    well: "bg-[#8e8e93]",
  },
};

export type { RecentActivityProps, RecentActivityItem, RecentActivityKind };

export function RecentActivity({
  title = RECENT_ACTIVITY_TITLE,
  items: itemsProp,
  viewAllLabel = RECENT_ACTIVITY_VIEW_ALL_LABEL,
  onViewAll,
  onItemSelect,
  className,
}: RecentActivityProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const items = itemsProp ?? DEFAULT_RECENT_ACTIVITY;

  const unreadCount = useMemo(
    () => items.filter((item) => item.unread).length,
    [items],
  );

  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <div
        data-component="recent-activity"
        className={cn(
          "flex w-full max-w-[22.5rem] flex-col overflow-hidden rounded-[22px]",
          "bg-[color-mix(in_oklab,var(--chart-card-bg)_92%,transparent)]",
          "shadow-[0_8px_40px_-12px_rgba(0,0,0,0.18)]",
          "dark:shadow-[0_12px_48px_-16px_rgba(0,0,0,0.55)]",
          "backdrop-blur-xl backdrop-saturate-150",
          className,
        )}
      >
        <header className="flex items-end justify-between gap-3 px-5 pt-5 pb-2">
          <div className="min-w-0">
            <h2 className="font-sans text-[19px] font-semibold tracking-[-0.02em] text-foreground">
              {title}
            </h2>
            <p className="mt-0.5 font-sans text-[13px] leading-snug text-chart-muted">
              {unreadCount > 0
                ? `${unreadCount} new`
                : "You're all caught up"}
            </p>
          </div>
          <button
            type="button"
            onClick={onViewAll}
            className="shrink-0 pb-0.5 font-sans text-[15px] font-normal tracking-[-0.01em] text-[var(--activity-link)] transition-opacity hover:opacity-70"
          >
            {viewAllLabel}
          </button>
        </header>

        <ul className="flex flex-col px-2 pb-2">
          {items.map((item, index) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            const isLast = index === items.length - 1;

            return (
              <li key={item.id} className="relative">
                <m.button
                  type="button"
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : {
                          duration: 0.4,
                          ease: EASE_OUT,
                          delay: 0.03 * index,
                        }
                  }
                  onClick={() => onItemSelect?.(item)}
                  className={cn(
                    "group relative flex w-full items-start gap-3 rounded-[14px] px-3 py-3 text-left",
                    "outline-none transition-colors",
                    "hover:bg-foreground/[0.04] active:bg-foreground/[0.07]",
                    "focus-visible:bg-foreground/[0.06]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]",
                      meta.well,
                    )}
                  >
                    <Icon className="size-[15px]" strokeWidth={2.25} aria-hidden />
                  </span>

                  <span className="min-w-0 flex-1 pt-px">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-sans text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                        {item.title}
                      </span>
                      <span className="shrink-0 font-sans text-[13px] tabular-nums text-chart-muted">
                        {item.timeLabel}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block font-sans text-[13px] leading-[1.35] text-chart-muted">
                      {item.description}
                    </span>
                  </span>

                  {item.unread ? (
                    <span
                      aria-label="Unread"
                      className="mt-2 size-[8px] shrink-0 rounded-full bg-[var(--activity-link)]"
                    />
                  ) : null}
                </m.button>

                {!isLast ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute right-3 bottom-0 left-[58px] h-px bg-foreground/[0.08]"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </LazyMotion>
  );
}
