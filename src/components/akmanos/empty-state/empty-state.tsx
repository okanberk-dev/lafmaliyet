"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/components/akmanos/lib/cn";
import {
  EMPTY_STATE_DESCRIPTION,
  EMPTY_STATE_PRIMARY,
  EMPTY_STATE_TITLE,
  type EmptyStateAction,
  type EmptyStateProps,
} from "./constants";

export type { EmptyStateAction, EmptyStateProps };

const EASE = [0.22, 1, 0.36, 1] as const;

function ActionButton({
  action,
  variant,
}: {
  action: EmptyStateAction;
  variant: "primary" | "secondary";
}) {
  const className = cn(
    "inline-flex h-11 min-h-11 w-full items-center justify-center rounded-2xl px-5 font-sans text-sm font-medium transition-opacity sm:w-auto sm:min-w-[8.5rem]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-90"
      : "bg-chart-metric-bg text-foreground hover:opacity-90",
  );

  if (action.href) {
    return (
      <a href={action.href} className={className} onClick={action.onClick}>
        {action.label}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={action.onClick}>
      {action.label}
    </button>
  );
}

/** Ghost stack of record cards — soft empty-state illustration. */
export function RecordsStackIllustration({ reduceMotion }: { reduceMotion: boolean }) {
  const layers = [
    { baseY: 0, x: 14, opacity: 0.28, scale: 0.94, front: false },
    { baseY: 8, x: 7, opacity: 0.48, scale: 0.97, front: false },
    { baseY: 16, x: 0, opacity: 1, scale: 1, front: true },
  ] as const;

  return (
    <div className="relative h-[5.25rem] w-[7.75rem]" aria-hidden>
      {layers.map((layer, index) => (
        <motion.div
          key={index}
          className={cn(
            "absolute top-0 left-0 h-14 w-[6.75rem] overflow-hidden rounded-[14px]",
            "bg-chart-metric-bg/35 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)]",
            layer.front &&
              "bg-chart-metric-bg/50 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]",
          )}
          style={{
            x: layer.x,
            scale: layer.scale,
            zIndex: index + 1,
          }}
          initial={
            reduceMotion
              ? false
              : { opacity: 0, y: layer.baseY + 12 }
          }
          animate={
            reduceMotion
              ? { opacity: layer.opacity, y: layer.baseY }
              : {
                  opacity: layer.opacity,
                  y: [layer.baseY, layer.baseY - 3.5, layer.baseY],
                }
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  opacity: {
                    duration: 0.5,
                    delay: 0.05 + index * 0.07,
                    ease: EASE,
                  },
                  y: {
                    duration: 5.2,
                    delay: 0.4 + index * 0.14,
                    repeat: Infinity,
                    ease: "easeInOut",
                  },
                }
          }
        >
          {layer.front ? (
            <div className="flex h-full items-center gap-2.5 px-3">
              <span className="size-[1.35rem] shrink-0 rounded-md bg-chart-muted/40" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="h-1.5 w-full rounded-full bg-chart-muted/35" />
                <span className="h-1.5 w-[62%] rounded-full bg-chart-muted/25" />
              </span>
            </div>
          ) : null}
        </motion.div>
      ))}
    </div>
  );
}

export function EmptyState({
  title = EMPTY_STATE_TITLE,
  description = EMPTY_STATE_DESCRIPTION,
  primaryAction = EMPTY_STATE_PRIMARY,
  secondaryAction,
  className,
  illustration,
}: EmptyStateProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const hasActions = Boolean(primaryAction || secondaryAction);

  return (
    <motion.div
      data-component="empty-state"
      role="status"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className={cn(
        "flex w-full max-w-md flex-col items-center gap-6 px-4 py-8 text-center sm:gap-7 sm:px-6 sm:py-10",
        className,
      )}
    >
      {illustration ?? <RecordsStackIllustration reduceMotion={reduceMotion} />}

      <div className="flex max-w-[22rem] flex-col gap-2.5">
        <h2 className="font-sans text-xl font-semibold tracking-tight text-balance text-foreground sm:text-[1.375rem]">
          {title}
        </h2>
        {description ? (
          <p className="font-sans text-[15px] leading-relaxed text-pretty text-chart-muted">
            {description}
          </p>
        ) : null}
      </div>

      {hasActions ? (
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-center sm:gap-3">
          {primaryAction ? (
            <ActionButton action={primaryAction} variant="primary" />
          ) : null}
          {secondaryAction ? (
            <ActionButton action={secondaryAction} variant="secondary" />
          ) : null}
        </div>
      ) : null}
    </motion.div>
  );
}
