"use client";

import { ChevronRight } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion, type Transition } from "motion/react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/akmanos/icons/icon";
import { SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { cn } from "@/lib/utils";

import { pathMatches, type NavNode } from "./nav";

/**
 * AkmanOS "Sidebar" bloğundaki SidebarNav (src/components/akmanos/sidebar/sidebar-nav.tsx), Next.js bağlantıları
 * ve adres çubuğuna göre etkin durumla. Beyaz liste kabı, ikon karolu üst öğeler, yaylı açılan alt listeler ve
 * fareyi izleyen tek vurgu (layoutId) aynen korunur.
 */
const SUBLIST_TRANSITION: Transition = { type: "spring", duration: 0.55, bounce: 0.12 };

function SubList({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // İlk yükseklik animasyonsuz uygulanır: sayfa açıldığında etkin grup kapalıdan açılırken görünmesin
  const [settled, setSettled] = useState(false);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const node = ref.current;
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
      transition={reduce || !settled ? { duration: 0 } : SUBLIST_TRANSITION}
      onAnimationComplete={() => {
        if (height > 0 && !settled) setSettled(true);
      }}
      className="overflow-hidden"
    >
      <div ref={ref} className="flex flex-col gap-0.5 py-0.5 pr-1 pl-8">
        {children}
      </div>
    </motion.div>
  );
}

export function SidebarNav({ items, pathname, label = "Sayfalar" }: { items: NavNode[]; pathname: string; label?: string }) {
  const reduce = useReducedMotion();
  const activeParent = items.find((i) => i.children?.some((c) => pathMatches(pathname, c.href, c.match)))?.id;
  // Kullanıcının açıp kapattıkları; etkin sayfanın grubu her zaman açık
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const isOpen = (id: string) => toggled[id] ?? id === activeParent;
  const lit = (key: string, active: boolean) => hovered === key || (!hovered && active);

  const highlight = (rounded: string) => (
    <motion.span layoutId="panel-nav-highlight" transition={reduce ? { duration: 0 } : SPRING_SWAP} className={cn("absolute inset-0 bg-chart-bg", rounded)} />
  );
  const hover = (key: string) => ({
    onPointerEnter: () => setHovered(key),
    onPointerLeave: () => setHovered(null),
    onFocus: () => setHovered(key),
    onBlur: () => setHovered(null),
  });
  const tile = (icon: NavNode["icon"]) => (
    <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg bg-chart-card-bg text-chart-muted">
      <Icon icon={icon} size="sm" />
    </span>
  );

  return (
    <nav aria-label={label} className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="shrink-0 px-2 text-[0.65rem] font-medium tracking-wide text-chart-muted uppercase">{label}</p>
      <div className="sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <LayoutGroup id="panel-nav">
          <ul className="flex flex-col gap-0.5 rounded-2xl bg-chart-metric-bg p-1.5">
            {items.map((item) => {
              const key = `p-${item.id}`;
              if (!item.children) {
                const active = pathMatches(pathname, item.href!);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href!}
                      aria-current={active ? "page" : undefined}
                      {...hover(key)}
                      className="relative flex h-11 min-h-11 w-full items-center gap-2 rounded-xl pr-2.5 pl-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                    >
                      {lit(key, active) ? highlight("rounded-xl") : null}
                      {tile(item.icon)}
                      <span className="relative z-10 min-w-0 flex-1 truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              }
              const open = isOpen(item.id);
              const parentActive = activeParent === item.id;
              return (
                <li key={item.id} className="flex flex-col">
                  <div className="relative flex h-11 min-h-11 w-full items-center rounded-xl pr-2.5 pl-2" {...hover(key)}>
                    {lit(key, parentActive && !open) ? highlight("rounded-xl") : null}
                    <button
                      type="button"
                      onClick={() => setToggled((t) => ({ ...t, [item.id]: !open }))}
                      aria-expanded={open}
                      className="relative z-10 flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                    >
                      {tile(item.icon)}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <motion.span
                        animate={{ rotate: open ? 90 : 0 }}
                        transition={reduce ? { duration: 0 } : SPRING_SWAP}
                        className="flex size-7 shrink-0 items-center justify-center text-chart-muted"
                      >
                        <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
                      </motion.span>
                    </button>
                  </div>
                  <SubList open={open}>
                    {item.children.map((child) => {
                      const active = pathMatches(pathname, child.href, child.match);
                      const ck = `c-${child.id}`;
                      return (
                        <Link
                          key={child.id}
                          href={child.href}
                          aria-current={active ? "page" : undefined}
                          tabIndex={open ? undefined : -1}
                          {...hover(ck)}
                          className={cn(
                            "relative flex h-9 min-h-9 items-center rounded-lg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
                            active ? "font-medium text-foreground" : "text-chart-muted",
                          )}
                        >
                          {lit(ck, active) ? highlight("rounded-lg") : null}
                          <span className="relative z-10 truncate">{child.label}</span>
                        </Link>
                      );
                    })}
                  </SubList>
                </li>
              );
            })}
          </ul>
        </LayoutGroup>
      </div>
    </nav>
  );
}
