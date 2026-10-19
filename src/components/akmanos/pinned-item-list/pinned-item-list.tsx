"use client";

import * as React from "react";
import { Pin, PinOff } from "lucide-react";
import { AnimatePresence, LazyMotion, LayoutGroup, m } from "motion/react";
import { Icon } from "@/components/akmanos/icons/icon";
import {
  ALL_EMPTY_LABEL,
  ALL_SECTION_TITLE,
  DEFAULT_PINNED_IDS,
  PINNED_EMPTY_LABEL,
  PINNED_ITEMS,
  PINNED_SECTION_TITLE,
  type PinnedListItem,
} from "./constants";

function toSet(ids: readonly string[] | ReadonlySet<string> | undefined): Set<string> {
  if (!ids) return new Set();
  return ids instanceof Set ? new Set(ids) : new Set(ids);
}

function mergeStackFromTarget(prev: string[], target: Set<string>): string[] {
  const kept = prev.filter((id) => target.has(id));
  const added = [...target].filter((id) => !prev.includes(id));
  return [...added, ...kept];
}

const layoutSpring = { type: "spring" as const, stiffness: 180, damping: 26, mass: 0.95 };

const iconEase = [0.22, 1, 0.36, 1] as const;
const iconTransition = { duration: 0.42, ease: iconEase };

function loadPinnedListMotionFeatures() {
  return import("motion/react").then((mod) => mod.domMax);
}

export type PinnedItemListProps = {
  items?: readonly PinnedListItem[];
  defaultPinnedIds?: readonly string[];
  pinnedIds?: ReadonlySet<string> | readonly string[];
  onPinnedChange?: (pinned: Set<string>) => void;
  className?: string;
  emptyLabel?: string;
  pinAriaLabel?: (pinned: boolean) => string;
  pinnedSectionTitle?: string;
  allSectionTitle?: string;
  pinnedEmptyLabel?: string;
  allEmptyLabel?: string;
};

export function PinnedItemList({
  items = PINNED_ITEMS,
  defaultPinnedIds = DEFAULT_PINNED_IDS,
  pinnedIds: controlledPinned,
  onPinnedChange,
  className,
  emptyLabel = "No items yet.",
  pinAriaLabel = (pinned) => (pinned ? "Unpin" : "Pin to top"),
  pinnedSectionTitle = PINNED_SECTION_TITLE,
  allSectionTitle = ALL_SECTION_TITLE,
  pinnedEmptyLabel = PINNED_EMPTY_LABEL,
  allEmptyLabel = ALL_EMPTY_LABEL,
}: PinnedItemListProps) {
  const isControlled = controlledPinned !== undefined;

  const [pinStack, setPinStack] = React.useState<string[]>(() => {
    if (isControlled) {
      return mergeStackFromTarget([], toSet([...controlledPinned!]));
    }
    return [...(defaultPinnedIds ?? [])].reverse();
  });

  React.useEffect(() => {
    if (!isControlled) return;
    const target = toSet([...controlledPinned!]);
    setPinStack((prev) => mergeStackFromTarget(prev, target));
  }, [controlledPinned, isControlled]);

  const pinned = React.useMemo(() => new Set(pinStack), [pinStack]);

  const itemById = React.useMemo(
    () => new Map(items.map((item) => [item.id, item] as const)),
    [items],
  );

  const pinnedItems = React.useMemo(
    () =>
      pinStack
        .map((id) => itemById.get(id))
        .filter((item): item is PinnedListItem => item != null),
    [pinStack, itemById],
  );

  const allItems = React.useMemo(
    () => items.filter((item) => !pinned.has(item.id)),
    [items, pinned],
  );

  const applyStack = React.useCallback(
    (next: string[]) => {
      setPinStack(next);
      onPinnedChange?.(new Set(next));
    },
    [onPinnedChange],
  );

  const toggle = React.useCallback(
    (id: string) => {
      if (pinned.has(id)) {
        applyStack(pinStack.filter((itemId) => itemId !== id));
      } else {
        applyStack([id, ...pinStack.filter((itemId) => itemId !== id)]);
      }
    },
    [pinned, pinStack, applyStack],
  );

  const renderRow = (item: PinnedListItem, isPinnedColumn: boolean) => {
    const isPinned = isPinnedColumn;

    return (
      <m.li
        key={item.id}
        role="listitem"
        layout
        layoutId={item.id}
        transition={layoutSpring}
        className="list-none"
        style={{ willChange: "transform" }}
      >
        <m.div
          layout
          transition={layoutSpring}
          className={
            isPinned
              ? "flex items-center gap-2 rounded-xl bg-foreground px-2 py-1.5 text-background transition-colors hover:bg-foreground/92"
              : "flex items-center gap-2 rounded-xl bg-chart-metric-bg px-2 py-1.5 transition-colors hover:bg-chart-bg"
          }
        >
          <button
            type="button"
            className={
              isPinned
                ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-background transition-colors hover:bg-background/10 hover:text-background"
                : "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-chart-muted transition-colors hover:bg-chart-card-bg hover:text-foreground"
            }
            aria-pressed={isPinned}
            aria-label={pinAriaLabel(isPinned)}
            onClick={() => toggle(item.id)}
          >
            <span className="relative flex size-3.5 items-center justify-center overflow-visible">
              <AnimatePresence mode="popLayout" initial={false}>
                <m.span
                  key={isPinned ? "pinned" : "unpinned"}
                  initial={{ opacity: 0, scale: 0.88, filter: "blur(2px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.88, filter: "blur(2px)" }}
                  transition={iconTransition}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {isPinned ? (
                    <Icon
                      icon={Pin}
                      size={14}
                      className="fill-current text-inherit"
                    />
                  ) : (
                    <Icon icon={PinOff} size={14} className="opacity-80" />
                  )}
                </m.span>
              </AnimatePresence>
            </span>
          </button>
          <div className="min-w-0 flex-1 leading-tight">
            <div
              className={
                isPinned
                  ? "truncate text-[13px] font-medium text-inherit"
                  : "truncate text-[13px] font-medium text-foreground"
              }
            >
              {item.title}
            </div>
            {item.description ? (
              <p
                className={
                  isPinned
                    ? "truncate text-[11px] text-inherit opacity-80"
                    : "truncate text-[11px] text-chart-muted"
                }
              >
                {item.description}
              </p>
            ) : null}
          </div>
        </m.div>
      </m.li>
    );
  };

  const listBody =
    items.length === 0 ? (
      <p className="text-xs text-chart-muted">{emptyLabel}</p>
    ) : (
      <LazyMotion features={loadPinnedListMotionFeatures} strict>
        <LayoutGroup id="pinned-item-list">
          <div className={`flex flex-col gap-7 ${className ?? ""}`.trim()}>
            <section aria-labelledby="pinned-item-list-pinned-heading">
              <h3
                id="pinned-item-list-pinned-heading"
                className="mb-2 text-[10px] font-semibold tracking-wider text-chart-muted uppercase"
              >
                {pinnedSectionTitle}
              </h3>
              <ul className="flex min-h-12 flex-col gap-1.5">
                {pinnedItems.length === 0 ? (
                  <li className="list-none">
                    <div
                      className="flex min-h-11 items-center justify-center rounded-xl bg-chart-metric-bg px-2 py-3 text-center text-[11px] text-chart-muted transition-colors hover:bg-chart-bg"
                    >
                      {pinnedEmptyLabel}
                    </div>
                  </li>
                ) : (
                  pinnedItems.map((item) => renderRow(item, true))
                )}
              </ul>
            </section>

            <section aria-labelledby="pinned-item-list-all-heading">
              <h3
                id="pinned-item-list-all-heading"
                className="mb-2 text-[10px] font-semibold tracking-wider text-chart-muted uppercase"
              >
                {allSectionTitle}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {allItems.length === 0 ? (
                  <li className="list-none">
                    <div
                      className="flex min-h-11 items-center justify-center rounded-xl bg-chart-metric-bg px-2 py-3 text-center text-[11px] text-chart-muted transition-colors hover:bg-chart-bg"
                    >
                      {allEmptyLabel}
                    </div>
                  </li>
                ) : (
                  allItems.map((item) => renderRow(item, false))
                )}
              </ul>
            </section>
          </div>
        </LayoutGroup>
      </LazyMotion>
    );

  return (
    <div className="w-full" data-component="pinned-item-list">
      {listBody}
    </div>
  );
}
