"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  AtSign,
  Bell,
  CheckCheck,
  CreditCard,
  MessageSquare,
  Rocket,
  UserPlus,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Info,
} from "lucide-react";
import { cn } from "@/components/akmanos/lib/cn";
import { SPRING_LAYOUT, SPRING_PANEL, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import {
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_DROPDOWN_TITLE,
  NOTIFICATION_EMPTY_LABEL,
  NOTIFICATION_MARK_ALL_LABEL,
  NOTIFICATION_VIEW_ALL_LABEL,
  type NotificationItem,
  type NotificationKind,
} from "./constants";

export type NotificationFilter = "all" | "unread";

export type NotificationDropdownProps = {
  notifications?: NotificationItem[];
  title?: string;
  /** Gallery: start open, ignore outside click / toggle */
  preview?: boolean;
  menuPlacement?: "bottom" | "top";
  menuAlign?: "left" | "right";
  onItemSelect?: (item: NotificationItem) => void;
  onMarkAllRead?: () => void;
  onViewAll?: () => void;
  className?: string;
};

const KIND_ICON: Record<
  NotificationKind,
  { icon: typeof Bell; className: string }
> = {
  mention: {
    icon: AtSign,
    className: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  },
  comment: {
    icon: MessageSquare,
    className: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  },
  deploy: {
    icon: Rocket,
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  },
  billing: {
    icon: CreditCard,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  invite: {
    icon: UserPlus,
    className: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
  },
  system: {
    icon: Sparkles,
    className: "bg-chart-bg text-chart-muted",
  },
  danger: {
    icon: AlertTriangle,
    className: "bg-red-500/15 text-red-600 dark:text-red-300",
  },
  warning: {
    icon: AlertCircle,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  info: {
    icon: Info,
    className: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  },
};

export function NotificationDropdown({
  notifications: notificationsProp,
  title = NOTIFICATION_DROPDOWN_TITLE,
  preview = false,
  menuPlacement = "bottom",
  menuAlign = "right",
  onItemSelect,
  onMarkAllRead,
  onViewAll,
  className,
}: NotificationDropdownProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(preview);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<NotificationItem[]>(
    () => notificationsProp ?? DEFAULT_NOTIFICATIONS,
  );
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [ringPulse, setRingPulse] = useState(false);

  useEffect(() => {
    if (notificationsProp) setItems(notificationsProp);
  }, [notificationsProp]);

  const unreadCount = useMemo(
    () => items.filter((item) => item.unread).length,
    [items],
  );

  const visibleItems = useMemo(() => {
    if (filter === "unread") return items.filter((item) => item.unread);
    return items;
  }, [filter, items]);

  useEffect(() => {
    if (!open) setHoveredKey(null);
  }, [open]);

  useEffect(() => {
    if (preview || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (target && !root.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, preview]);

  useEffect(() => {
    if (preview || unreadCount === 0 || reduceMotion) return;
    const id = window.setInterval(() => {
      setRingPulse(true);
      window.setTimeout(() => setRingPulse(false), 700);
    }, 5200);
    return () => window.clearInterval(id);
  }, [preview, unreadCount, reduceMotion]);

  function markAllRead() {
    setItems((prev) => prev.map((item) => ({ ...item, unread: false })));
    onMarkAllRead?.();
  }

  function selectItem(item: NotificationItem) {
    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id ? { ...row, unread: false } : row,
      ),
    );
    onItemSelect?.(item);
    if (!preview) setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      data-component="notification-dropdown"
      className={cn("relative inline-flex font-sans", className)}
    >
      <motion.button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={
          unreadCount > 0
            ? `Bildirimler, ${unreadCount} okunmamış`
            : "Bildirimler"
        }
        whileTap={reduceMotion || preview ? undefined : { scale: 0.96 }}
        animate={
          reduceMotion || !ringPulse
            ? { rotate: 0 }
            : { rotate: [0, -12, 10, -6, 4, 0] }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : ringPulse
              ? { duration: 0.65, ease: "easeInOut" }
              : SPRING_PRESS
        }
        onClick={() => {
          if (preview) return;
          setOpen((value) => !value);
        }}
        className={cn(
          "relative inline-flex size-11 items-center justify-center rounded-2xl outline-none",
          "bg-chart-metric-bg text-foreground transition-colors",
          "hover:bg-chart-bg",
          "focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <Bell className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <AnimatePresence>
          {unreadCount > 0 ? (
            <motion.span
              key="badge"
              initial={reduceMotion ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduceMotion ? undefined : { scale: 0, opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
              className="absolute top-2 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 font-sans text-[10px] font-semibold text-background tabular-nums"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={menuId}
            role="menu"
            aria-label={title}
            initial={
              reduceMotion
                ? false
                : {
                    opacity: 0,
                    scale: 0.96,
                    y: menuPlacement === "top" ? 8 : -8,
                  }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              reduceMotion
                ? undefined
                : {
                    opacity: 0,
                    scale: 0.96,
                    y: menuPlacement === "top" ? 8 : -8,
                  }
            }
            transition={reduceMotion ? { duration: 0 } : SPRING_PANEL}
            className={cn(
              "absolute z-[100] w-[min(22rem,calc(100vw-2rem))] overflow-hidden",
              "rounded-2xl bg-chart-metric-bg shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop-blur-xl",
              "dark:shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
              menuPlacement === "top"
                ? "bottom-[calc(100%+0.5rem)]"
                : "top-[calc(100%+0.5rem)]",
              menuAlign === "left" ? "left-0" : "right-0",
            )}
          >
            <LayoutGroup id="notification-dropdown">
              <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
                <div className="min-w-0">
                  <p className="font-sans text-[0.95rem] font-semibold tracking-tight text-foreground">
                    {title}
                  </p>
                  <p className="mt-0.5 font-sans text-[12px] text-chart-muted">
                    {unreadCount > 0
                      ? `${unreadCount} unread`
                      : "No unread notifications"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={unreadCount === 0}
                  onClick={markAllRead}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 font-sans text-[12px] font-medium outline-none transition-colors",
                    unreadCount === 0
                      ? "cursor-default text-chart-muted/50"
                      : "text-chart-muted hover:bg-chart-bg hover:text-foreground",
                    "focus-visible:ring-2 focus-visible:ring-foreground/20",
                  )}
                >
                  <CheckCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {NOTIFICATION_MARK_ALL_LABEL}
                </button>
              </div>

              <div className="px-3 pb-2">
                <div
                  role="tablist"
                  aria-label="Bildirim filtresi"
                  className="relative flex gap-1 rounded-xl bg-chart-bg p-1"
                >
                  {(
                    [
                      { id: "all", label: "Tümü" },
                      { id: "unread", label: "Okunmamış" },
                    ] as const
                  ).map((tab) => {
                    const active = filter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setFilter(tab.id)}
                        className={cn(
                          "relative z-10 flex h-8 flex-1 items-center justify-center rounded-lg font-sans text-[12px] font-medium outline-none",
                          "focus-visible:ring-2 focus-visible:ring-foreground/20",
                          active ? "text-foreground" : "text-chart-muted",
                        )}
                      >
                        {active ? (
                          <motion.span
                            layoutId="notification-filter-pill"
                            transition={
                              reduceMotion ? { duration: 0 } : SPRING_LAYOUT
                            }
                            className="absolute inset-0 rounded-lg bg-chart-metric-bg shadow-sm"
                          />
                        ) : null}
                        <span className="relative z-10">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="notification-dropdown-scroll max-h-[22rem] overflow-y-auto px-1.5 pb-1.5">
                <AnimatePresence mode="popLayout" initial={false}>
                  {visibleItems.length === 0 ? (
                    <motion.p
                      key="empty"
                      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0 }}
                      transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
                      className="px-3 py-10 text-center font-sans text-[13px] text-chart-muted"
                    >
                      {NOTIFICATION_EMPTY_LABEL}
                    </motion.p>
                  ) : (
                    visibleItems.map((item, index) => (
                      <NotificationRow
                        key={item.id}
                        item={item}
                        index={index}
                        hoveredKey={hoveredKey}
                        reduceMotion={reduceMotion}
                        onHover={setHoveredKey}
                        onSelect={() => selectItem(item)}
                      />
                    ))
                  )}
                </AnimatePresence>
              </div>

              <div className="p-2 pt-1">
                <motion.button
                  type="button"
                  role="menuitem"
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { ...SPRING_SWAP, delay: 0.08 }
                  }
                  onClick={() => {
                    onViewAll?.();
                    if (!preview) setOpen(false);
                  }}
                  className={cn(
                    "flex h-10 w-full items-center justify-center rounded-xl font-sans text-[13px] font-semibold outline-none",
                    "bg-chart-bg text-foreground transition-colors hover:bg-foreground hover:text-background",
                    "focus-visible:ring-2 focus-visible:ring-foreground/20",
                  )}
                >
                  {NOTIFICATION_VIEW_ALL_LABEL}
                </motion.button>
              </div>
            </LayoutGroup>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NotificationRow({
  item,
  index,
  hoveredKey,
  reduceMotion,
  onHover,
  onSelect,
}: {
  item: NotificationItem;
  index: number;
  hoveredKey: string | null;
  reduceMotion: boolean;
  onHover: (key: string | null) => void;
  onSelect: () => void;
}) {
  const meta = KIND_ICON[item.kind];
  const Icon = meta.icon;
  const highlighted = hoveredKey === item.id;

  return (
    <motion.button
      type="button"
      role="menuitem"
      layout={!reduceMotion}
      initial={
        reduceMotion ? false : { opacity: 0, y: 10, filter: "blur(4px)" }
      }
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={
        reduceMotion
          ? undefined
          : { opacity: 0, y: -6, filter: "blur(3px)" }
      }
      transition={
        reduceMotion
          ? { duration: 0 }
          : { ...SPRING_SWAP, delay: 0.03 + index * 0.04 }
      }
      onPointerEnter={() => onHover(item.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(item.id)}
      onBlur={() => onHover(null)}
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-foreground/20",
      )}
    >
      {highlighted ? (
        <motion.span
          layoutId="notification-row-highlight"
          transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
          className="absolute inset-0 rounded-xl bg-chart-bg"
        />
      ) : null}

      <span
        className={cn(
          "relative z-10 mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
          meta.className,
        )}
        aria-hidden
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>

      <span className="relative z-10 min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="truncate font-sans text-[13px] font-semibold tracking-tight text-foreground">
            {item.title}
          </span>
          <span className="shrink-0 font-sans text-[11px] tabular-nums text-chart-muted">
            {item.timeLabel}
          </span>
        </span>
        <span className="mt-0.5 line-clamp-2 font-sans text-[12px] leading-snug text-chart-muted">
          {item.body}
        </span>
      </span>

      {item.unread ? (
        <span
          className="relative z-10 mt-2 size-1.5 shrink-0 rounded-full bg-foreground"
          aria-label="Okunmamış"
        />
      ) : (
        <span className="relative z-10 mt-2 size-1.5 shrink-0" aria-hidden />
      )}
    </motion.button>
  );
}

export function NotificationDropdownShowcase() {
  return (
    <div className="flex min-h-[32rem] w-full items-start justify-center px-4 py-10 sm:px-6">
      <NotificationDropdown preview />
    </div>
  );
}
