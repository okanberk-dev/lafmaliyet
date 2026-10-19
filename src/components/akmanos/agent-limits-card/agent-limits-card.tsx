"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { Icon } from "@/components/akmanos/icons/icon";
import { cn } from "@/components/akmanos/lib/cn";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import {
  CONTEXT_WINDOW_LABEL,
  DEFAULT_AGENT_LIMITS_CONTEXT,
  DEFAULT_AGENT_LIMITS_PLAN,
  FREE_SPACE_LABEL,
} from "./constants";
import type {
  AgentLimitsContext,
  AgentLimitsPlan,
  ContextSegment,
  ExpandableGroup,
} from "./types";

export type AgentLimitsCardProps = {
  context?: AgentLimitsContext;
  plan?: AgentLimitsPlan;
  className?: string;
  defaultContextExpanded?: boolean;
  onPlanLimitsClick?: () => void;
};

const EXPAND_HEIGHT_TRANSITION: Transition = {
  duration: 0.34,
  ease: EASE_OUT,
};

const EXPAND_FADE_TRANSITION: Transition = {
  duration: 0.28,
  ease: EASE_OUT,
};

const CHEVRON_TRANSITION: Transition = {
  type: "spring",
  duration: 0.7,
  bounce: 0.16,
};

function CollapsibleSection({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={false}
      animate={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      transition={reduceMotion ? { duration: 0 } : EXPAND_HEIGHT_TRANSITION}
      className={cn("grid overflow-hidden", className)}
    >
      <motion.div
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={reduceMotion ? { duration: 0 } : EXPAND_FADE_TRANSITION}
        className="min-h-0 overflow-hidden"
      >
        <div>{children}</div>
      </motion.div>
    </motion.div>
  );
}

function formatK(value: number) {
  const rounded =
    value >= 100 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded}k`;
}

function formatPercent(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function SegmentedBar({ segments }: { segments: ContextSegment[] }) {
  const reduceMotion = useReducedMotion();
  const barSegments = segments.filter(
    (segment) => !segment.deferred && segment.id !== "free-space",
  );

  return (
    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-chart-bg">
      {barSegments.map((segment, index) => (
        <motion.div
          key={segment.id}
          className="h-full min-w-0 rounded-full"
          style={{ backgroundColor: segment.color }}
          initial={reduceMotion ? false : { width: 0, opacity: 0.6 }}
          animate={{ width: `${segment.percent}%`, opacity: 1 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { ...SPRING_SWAP, delay: 0.12 + index * 0.05 }
          }
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function SegmentRow({ segment }: { segment: ContextSegment }) {
  const deferred = segment.deferred;
  const isFreeSpace = segment.id === "free-space";

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0 text-sm",
        deferred && "text-chart-muted",
      )}
    >
      <span
        className={cn(
          "size-2.5 shrink-0 rounded-[3px]",
          isFreeSpace && "ring-1 ring-border bg-chart-metric-bg",
        )}
        style={
          isFreeSpace
            ? undefined
            : { backgroundColor: deferred ? "#e4e4e7" : segment.color }
        }
        aria-hidden="true"
      />
      <span className={cn("truncate", deferred ? "text-chart-muted" : "text-foreground")}>
        {segment.label}
      </span>
      <span className="font-mono text-xs tabular-nums text-chart-muted">
        {formatK(segment.valueK)}
      </span>
      <span
        className={cn(
          "min-w-[3rem] text-right font-mono text-xs tabular-nums",
          deferred || isFreeSpace ? "text-chart-muted" : "font-semibold text-foreground",
        )}
      >
        {segment.percent > 0 ? `${formatPercent(segment.percent)}%` : ""}
      </span>
    </div>
  );
}

function ExpandableGroupRow({
  group,
  expanded,
  onToggle,
}: {
  group: ExpandableGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-sm text-foreground transition-colors hover:bg-chart-bg"
      >
        <motion.span
          initial={false}
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={reduceMotion ? { duration: 0 } : CHEVRON_TRANSITION}
          className="inline-flex shrink-0 text-chart-muted"
        >
          <Icon icon={ChevronRight} size={14} />
        </motion.span>
        <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
        <span className="font-mono text-xs tabular-nums text-chart-muted">
          {formatK(group.totalK)}
        </span>
        <span className="min-w-[1.25rem] text-right font-mono text-xs tabular-nums text-chart-muted">
          {group.itemCount}
        </span>
      </button>

      <CollapsibleSection open={expanded && Boolean(group.items?.length)}>
        <div className="ml-5 flex flex-col gap-1 border-l border-border pl-3 pb-0.5">
          {group.items?.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm"
            >
              <span className="truncate text-chart-muted">{item.label}</span>
              <span className="font-mono text-xs tabular-nums text-chart-muted">
                {formatK(item.valueK)}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}

function PlanLimitRow({
  label,
  resetLabel,
  percent,
  index,
}: {
  label: string;
  resetLabel: string;
  percent: number;
  index: number;
}) {
  const reduceMotion = useReducedMotion();
  const clampedPercent = Math.min(100, Math.max(0, percent));

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 text-sm">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="truncate text-chart-muted">{resetLabel}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {percent}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-chart-bg">
        <motion.div
          className="h-full rounded-full bg-[#3b82f6]"
          initial={reduceMotion ? false : { width: 0, opacity: 0.6 }}
          animate={{ width: `${clampedPercent}%`, opacity: 1 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { ...SPRING_SWAP, delay: 0.28 + index * 0.1 }
          }
        />
      </div>
    </div>
  );
}

export function AgentLimitsCard({
  context = DEFAULT_AGENT_LIMITS_CONTEXT,
  plan = DEFAULT_AGENT_LIMITS_PLAN,
  className,
  defaultContextExpanded = false,
  onPlanLimitsClick,
}: AgentLimitsCardProps) {
  const reduceMotion = useReducedMotion();
  const [contextExpanded, setContextExpanded] = useState(defaultContextExpanded);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {};
      for (const group of context.expandableGroups ?? []) {
        initial[group.id] = group.defaultExpanded ?? false;
      }
      return initial;
    },
  );

  const primarySegments = useMemo(
    () =>
      context.segments.filter(
        (segment) => !segment.deferred && segment.id !== "free-space",
      ),
    [context.segments],
  );

  const deferredSegments = useMemo(
    () => context.segments.filter((segment) => segment.deferred),
    [context.segments],
  );

  const freeSpaceSegment = useMemo(
    () => context.segments.find((segment) => segment.id === "free-space"),
    [context.segments],
  );

  function toggleGroup(id: string) {
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div
      data-component="agent-limits-card"
      className={cn(
        "w-full max-w-md self-start rounded-2xl bg-chart-card-bg p-4 sm:p-5",
        className,
      )}
    >
      <section className="flex flex-col items-stretch gap-3">
        <button
          type="button"
          onClick={() => setContextExpanded((value) => !value)}
          className="flex w-full items-center gap-2 text-left"
          aria-expanded={contextExpanded}
        >
          <span className="min-w-0 flex-1 text-sm text-chart-muted">
            {CONTEXT_WINDOW_LABEL}
          </span>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {formatK(context.usedK)} / {formatK(context.totalK)}
            <span className="ml-1 font-semibold">({context.percent}%)</span>
          </span>
          <motion.span
            initial={false}
            animate={{ rotate: contextExpanded ? 180 : 0 }}
            transition={reduceMotion ? { duration: 0 } : CHEVRON_TRANSITION}
            className="inline-flex shrink-0 text-chart-muted"
          >
            <Icon icon={ChevronDown} size={16} />
          </motion.span>
        </button>

        <SegmentedBar segments={context.segments} />

        <CollapsibleSection open={contextExpanded}>
          <div className="flex flex-col gap-2.5 pt-1">
            {primarySegments.map((segment) => (
              <SegmentRow key={segment.id} segment={segment} />
            ))}

            {deferredSegments.map((segment) => (
              <SegmentRow key={segment.id} segment={segment} />
            ))}

            {freeSpaceSegment ? (
              <SegmentRow segment={freeSpaceSegment} />
            ) : null}

            {context.expandableGroups?.length ? (
              <div className="mt-1 flex flex-col gap-1 border-t border-border pt-3">
                {context.expandableGroups.map((group) => (
                  <ExpandableGroupRow
                    key={group.id}
                    group={group}
                    expanded={expandedGroups[group.id] ?? false}
                    onToggle={() => toggleGroup(group.id)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </CollapsibleSection>
      </section>

      <section className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
        <button
          type="button"
          onClick={onPlanLimitsClick}
          className="flex w-full items-center gap-2 text-left transition-opacity hover:opacity-80"
        >
          <span className="min-w-0 flex-1 text-sm text-chart-muted">
            {plan.title}
            {plan.subtitle ? (
              <>
                <span> · </span>
                <span>{plan.subtitle}</span>
              </>
            ) : null}
          </span>
          <Icon icon={ChevronRight} size={16} className="shrink-0 text-chart-muted" />
        </button>

        <div className="flex flex-col gap-4">
          {plan.limits.map((limit, index) => (
            <PlanLimitRow
              key={limit.id}
              index={index}
              label={limit.label}
              resetLabel={limit.resetLabel}
              percent={limit.percent}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
