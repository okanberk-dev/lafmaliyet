"use client";

import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import {
  LayoutGroup,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { Icon } from "@/components/akmanos/icons/icon";
import { cn } from "@/components/akmanos/lib/cn";
import { SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import {
  SIDEBAR_PAGES_LABEL,
  type SidebarNavChild,
  type SidebarNavItem,
} from "./constants";

const SUBLIST_TRANSITION: Transition = {
  type: "spring",
  duration: 0.55,
  bounce: 0.12,
};

function SidebarSubList({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const update = () => setHeight(node.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children]);

  return (
    <motion.div
      initial={false}
      animate={{ height: open ? height : 0 }}
      transition={reduceMotion ? { duration: 0 } : SUBLIST_TRANSITION}
      className="overflow-hidden"
    >
      <div ref={contentRef} className="flex flex-col gap-0.5 py-0.5 pl-8 pr-1">
        {children}
      </div>
    </motion.div>
  );
}

type SidebarNavProps = {
  items: SidebarNavItem[];
  activePageId?: string;
  activeChildId?: string;
  onPageSelect?: (pageId: string, childId?: string) => void;
  className?: string;
};

export function SidebarNav({
  items,
  activePageId,
  activeChildId,
  onPageSelect,
  className,
}: SidebarNavProps) {
  const reduceMotion = useReducedMotion();
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  useEffect(() => {
    if (!activePageId) return;

    const activeItem = items.find((item) => item.id === activePageId);
    if (!activeItem?.children?.length) return;

    setExpandedIds((current) =>
      current.includes(activePageId) ? current : [...current, activePageId],
    );
  }, [activePageId, items]);

  function ensureExpanded(pageId: string) {
    setExpandedIds((current) =>
      current.includes(pageId) ? current : [...current, pageId],
    );
  }

  function toggleExpanded(pageId: string) {
    setExpandedIds((current) =>
      current.includes(pageId)
        ? current.filter((id) => id !== pageId)
        : [...current, pageId],
    );
  }

  function isChildActive(item: SidebarNavItem, child: SidebarNavChild) {
    if (activeChildId) {
      return activeChildId === child.id;
    }
    return activePageId === item.id && item.children?.[0]?.id === child.id;
  }

  function isHighlighted(rowKey: string, isActive: boolean) {
    return hoveredKey === rowKey || (!hoveredKey && isActive);
  }

  return (
    <nav
      aria-label={SIDEBAR_PAGES_LABEL}
      className={cn("flex min-h-0 flex-col gap-3", className)}
    >
      <p className="shrink-0 px-2 text-[0.65rem] font-medium tracking-wide text-chart-muted uppercase">
        {SIDEBAR_PAGES_LABEL}
      </p>

      <div className="sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <LayoutGroup id="sidebar-nav">
          <ul className="flex flex-col gap-0.5 rounded-2xl bg-chart-metric-bg p-1.5">
          {items.map((item) => {
            const hasChildren = Boolean(item.children?.length);
            const isExpanded = expandedIds.includes(item.id);
            const isParentActive =
              activePageId === item.id ||
              Boolean(item.children?.some((child) => child.id === activeChildId));
            const pageKey = `page-${item.id}`;

            return (
              <li key={item.id} className="flex flex-col">
                {hasChildren ? (
                  <div
                    className={cn(
                      "relative flex h-11 min-h-11 w-full items-center gap-0 rounded-xl pl-2 pr-2.5",
                    )}
                    onPointerEnter={() => setHoveredKey(pageKey)}
                    onPointerLeave={() => setHoveredKey(null)}
                  >
                    {isHighlighted(pageKey, isParentActive) ? (
                      <motion.span
                        layoutId="sidebar-nav-highlight"
                        transition={
                          reduceMotion ? { duration: 0 } : SPRING_SWAP
                        }
                        className="absolute inset-0 rounded-xl bg-chart-bg"
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        onPageSelect?.(item.id);
                        ensureExpanded(item.id);
                      }}
                      onFocus={() => setHoveredKey(pageKey)}
                      onBlur={() => setHoveredKey(null)}
                      className={cn(
                        "relative z-10 flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium outline-none",
                        "text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20",
                      )}
                    >
                      {item.icon ? (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chart-card-bg text-chart-muted">
                          <Icon icon={item.icon} size="sm" />
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </button>
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.label}`}
                      onClick={() => toggleExpanded(item.id)}
                      onFocus={() => setHoveredKey(pageKey)}
                      onBlur={() => setHoveredKey(null)}
                      className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md text-chart-muted outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                    >
                      <motion.span
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
                        className="flex items-center justify-center"
                      >
                        <ChevronRight
                          className="size-4"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </motion.span>
                    </button>
                  </div>
                ) : (
                  <a
                    href={item.href ?? "#"}
                    onClick={(event) => {
                      event.preventDefault();
                      onPageSelect?.(item.id);
                    }}
                    onPointerEnter={() => setHoveredKey(pageKey)}
                    onPointerLeave={() => setHoveredKey(null)}
                    onFocus={() => setHoveredKey(pageKey)}
                    onBlur={() => setHoveredKey(null)}
                    className={cn(
                      "relative flex h-11 min-h-11 w-full items-center gap-2 rounded-xl pl-2 pr-2.5 text-sm font-medium outline-none",
                      "text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20",
                    )}
                  >
                    {isHighlighted(pageKey, isParentActive) ? (
                      <motion.span
                        layoutId="sidebar-nav-highlight"
                        transition={
                          reduceMotion ? { duration: 0 } : SPRING_SWAP
                        }
                        className="absolute inset-0 rounded-xl bg-chart-bg"
                      />
                    ) : null}
                    {item.icon ? (
                      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg bg-chart-card-bg text-chart-muted">
                        <Icon icon={item.icon} size="sm" />
                      </span>
                    ) : null}
                    <span className="relative z-10 min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                  </a>
                )}

                {hasChildren ? (
                  <SidebarSubList open={isExpanded}>
                    {item.children!.map((child) => {
                      const childActive = isChildActive(item, child);
                      const childKey = `child-${child.id}`;

                      return (
                        <a
                          key={child.id}
                          href={child.href ?? "#"}
                          onClick={(event) => {
                            event.preventDefault();
                            onPageSelect?.(item.id, child.id);
                          }}
                          onPointerEnter={() => setHoveredKey(childKey)}
                          onPointerLeave={() => setHoveredKey(null)}
                          onFocus={() => setHoveredKey(childKey)}
                          onBlur={() => setHoveredKey(null)}
                          className={cn(
                            "relative flex h-9 min-h-9 items-center rounded-lg px-2 text-sm outline-none",
                            childActive
                              ? "font-medium text-foreground"
                              : "text-chart-muted",
                            "focus-visible:ring-2 focus-visible:ring-foreground/20",
                          )}
                        >
                          {isHighlighted(childKey, childActive) ? (
                            <motion.span
                              layoutId="sidebar-nav-highlight"
                              transition={
                                reduceMotion ? { duration: 0 } : SPRING_SWAP
                              }
                              className="absolute inset-0 rounded-lg bg-chart-bg"
                            />
                          ) : null}
                          <span className="relative z-10 truncate">
                            {child.label}
                          </span>
                        </a>
                      );
                    })}
                  </SidebarSubList>
                ) : null}
              </li>
            );
          })}
        </ul>
        </LayoutGroup>
      </div>
    </nav>
  );
}
