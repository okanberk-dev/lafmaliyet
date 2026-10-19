"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/components/akmanos/lib/cn";
import { EASE_OUT, SPRING_PANEL, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import {
  ADD_SPACE_LABEL,
  CONNECTED_LABEL,
  DEFAULT_WORKSPACES,
  SWITCH_WORKSPACE_LABEL,
  type Workspace,
} from "./constants";
import { workspaceFaviconUrl } from "./utils";

export type SwitchWorkspaceProps = {
  workspaces?: Workspace[];
  activeId?: string;
  onWorkspaceChange?: (workspaceId: string) => void;
  onAddSpace?: () => void;
  /** Gallery: start open, ignore outside click */
  preview?: boolean;
  /** Stretch trigger to container width (e.g. sidebar shell). */
  fullWidth?: boolean;
  className?: string;
};

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function WorkspaceAvatar({
  workspace,
  size = "md",
}: {
  workspace: Workspace;
  size?: "sm" | "md";
}) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const initials = initialsFromName(workspace.name);
  const pixel = size === "sm" ? "size-8" : "size-9";
  const icon = size === "sm" ? "size-4" : "size-5";
  const text = size === "sm" ? "text-[0.65rem]" : "text-xs";
  const favicon =
    workspace.faviconDomain && !faviconFailed
      ? workspaceFaviconUrl(workspace.faviconDomain)
      : null;

  if (workspace.avatarSrc) {
    return (
      <span
        className={cn(
          pixel,
          "relative shrink-0 overflow-hidden rounded-lg ring-1 ring-border",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary workspace logo URLs */}
        <img
          src={workspace.avatarSrc}
          alt=""
          className="size-full object-cover"
        />
      </span>
    );
  }

  if (favicon) {
    return (
      <span
        className={cn(
          pixel,
          "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-chart-metric-bg ring-1 ring-border",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- external favicon */}
        <img
          src={favicon}
          alt=""
          className={cn(icon, "object-contain")}
          onError={() => setFaviconFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        pixel,
        "flex shrink-0 items-center justify-center rounded-lg font-semibold ring-1 ring-border/60",
        text,
      )}
      style={{
        backgroundColor: `${workspace.accent ?? "#71717a"}22`,
        color: workspace.accent ?? "var(--foreground)",
      }}
    >
      {initials}
    </span>
  );
}

function ConnectedSignal({
  reduceMotion,
  className,
}: {
  reduceMotion: boolean | null;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span className="relative flex size-2 shrink-0 items-center justify-center">
        {!reduceMotion ? (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-emerald-500/40"
            animate={{ scale: [1, 2.2, 1], opacity: [0.55, 0, 0.55] }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ) : null}
        <span
          aria-hidden
          className="size-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20 dark:bg-emerald-400 dark:ring-emerald-400/25"
        />
      </span>
      <span className="truncate text-[0.68rem] font-medium text-emerald-700 dark:text-emerald-400">
        {CONNECTED_LABEL}
      </span>
    </span>
  );
}

export function SwitchWorkspace({
  workspaces = DEFAULT_WORKSPACES,
  activeId,
  onWorkspaceChange,
  onAddSpace,
  preview = false,
  fullWidth = false,
  className,
}: SwitchWorkspaceProps) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(preview);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(
    activeId ?? workspaces[0]?.id ?? "",
  );

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === selectedId) ??
    workspaces[0];

  useEffect(() => {
    if (activeId) {
      setSelectedId(activeId);
    }
  }, [activeId]);

  useEffect(() => {
    if (!open) {
      setHoveredId(null);
    }
  }, [open]);

  const highlightId = hoveredId ?? selectedId;

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
      if (target && !root.contains(target)) {
        setOpen(false);
      }
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

  function selectWorkspace(workspaceId: string) {
    setSelectedId(workspaceId);
    onWorkspaceChange?.(workspaceId);
    if (!preview) setOpen(false);
  }

  if (!activeWorkspace) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      data-component="switch-workspace"
      className={cn(
        "relative font-sans",
        fullWidth ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      <motion.button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        whileTap={reduceMotion || preview ? undefined : { scale: 0.98 }}
        transition={SPRING_PRESS}
        onClick={() => {
          if (preview) return;
          setOpen((value) => !value);
        }}
        className={cn(
          fullWidth
            ? "flex w-full max-w-none min-w-0"
            : "inline-flex max-w-[16rem] min-w-[12rem]",
          "items-center gap-2.5 rounded-2xl py-1.5 pr-2.5 pl-2.5 outline-none",
          "bg-chart-metric-bg transition-colors",
          "hover:bg-chart-bg",
          "focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={activeWorkspace.id}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }
            }
            className="shrink-0"
          >
            <WorkspaceAvatar workspace={activeWorkspace} size="sm" />
          </motion.span>
        </AnimatePresence>

        <span className="min-w-0 flex-1 text-left">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={`${activeWorkspace.id}-name`}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.22, ease: EASE_OUT }
              }
              className="block truncate text-[0.8125rem] font-semibold tracking-tight text-foreground"
            >
              {activeWorkspace.name}
            </motion.span>
          </AnimatePresence>
          {activeWorkspace.subtitle ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={`${activeWorkspace.id}-subtitle`}
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.2, ease: EASE_OUT, delay: 0.02 }
                }
                className="block truncate text-[0.68rem] text-chart-muted"
              >
                {activeWorkspace.subtitle}
              </motion.span>
            </AnimatePresence>
          ) : null}
        </span>

        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
          className="flex size-7 shrink-0 items-center justify-center text-chart-muted"
        >
          <ChevronsUpDown className="size-4" strokeWidth={1.75} aria-hidden />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={menuId}
            role="menu"
            aria-label={SWITCH_WORKSPACE_LABEL}
            initial={
              reduceMotion ? false : { opacity: 0, scale: 0.96, y: -8 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              reduceMotion ? undefined : { opacity: 0, scale: 0.96, y: -8 }
            }
            transition={reduceMotion ? { duration: 0 } : SPRING_PANEL}
            className={cn(
              "absolute top-[calc(100%+0.5rem)] left-0 z-[300] w-[17.5rem] origin-top-left overflow-hidden",
              "rounded-2xl bg-chart-metric-bg shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop-blur-xl",
              "dark:shadow-[0_12px_40px_rgba(0,0,0,0.45)]",
              preview && "pointer-events-none",
            )}
            >
            <div className="px-3.5 pt-3 pb-2">
              <p className="text-[0.65rem] font-medium tracking-wide text-chart-muted uppercase">
                {SWITCH_WORKSPACE_LABEL}
              </p>
            </div>

            <LayoutGroup id="switch-workspace-list">
              <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
                {workspaces.map((workspace, index) => {
                  const isActive = workspace.id === selectedId;
                  const isHighlighted = workspace.id === highlightId;

                  return (
                    <motion.button
                      key={workspace.id}
                      type="button"
                      role="menuitem"
                      initial={
                        reduceMotion
                          ? false
                          : { opacity: 0, x: -10, filter: "blur(4px)" }
                      }
                      animate={{
                        opacity: 1,
                        x: 0,
                        filter: "blur(0px)",
                      }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : {
                              ...SPRING_SWAP,
                              delay: 0.04 + index * 0.045,
                            }
                      }
                      onPointerEnter={() => setHoveredId(workspace.id)}
                      onPointerLeave={() => setHoveredId(null)}
                      onFocus={() => setHoveredId(workspace.id)}
                      onBlur={() => setHoveredId(null)}
                      onClick={() => selectWorkspace(workspace.id)}
                      className={cn(
                        "relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none",
                        "focus-visible:ring-2 focus-visible:ring-foreground/20",
                      )}
                    >
                      {isHighlighted ? (
                        <motion.span
                          layoutId="switch-workspace-highlight"
                          transition={
                            reduceMotion ? { duration: 0 } : SPRING_SWAP
                          }
                          className="absolute inset-0 rounded-xl bg-chart-bg"
                        />
                      ) : null}

                      <span className="relative z-10 shrink-0">
                        <WorkspaceAvatar workspace={workspace} size="md" />
                      </span>

                      <span className="relative z-10 min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-semibold tracking-tight text-foreground">
                          {workspace.name}
                        </span>
                        {isActive ? (
                          <ConnectedSignal
                            reduceMotion={reduceMotion}
                            className="mt-0.5"
                          />
                        ) : workspace.subtitle ? (
                          <span className="block truncate text-[0.68rem] text-chart-muted">
                            {workspace.subtitle}
                          </span>
                        ) : null}
                      </span>

                      <span className="relative z-10 flex size-5 shrink-0 items-center justify-center">
                        <AnimatePresence initial={false}>
                          {isActive ? (
                            <motion.span
                              key="check"
                              initial={
                                reduceMotion
                                  ? false
                                  : { opacity: 0, scale: 0.5 }
                              }
                              animate={{ opacity: 1, scale: 1 }}
                              exit={
                                reduceMotion
                                  ? undefined
                                  : { opacity: 0, scale: 0.5 }
                              }
                              transition={
                                reduceMotion ? { duration: 0 } : SPRING_PRESS
                              }
                            >
                              <Check
                                className="size-4 text-foreground"
                                strokeWidth={2}
                                aria-hidden
                              />
                            </motion.span>
                          ) : null}
                        </AnimatePresence>
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              <div className="mx-3 h-px bg-border" />

              <div className="p-1.5 pb-2">
                <motion.button
                  type="button"
                  role="menuitem"
                  initial={
                    reduceMotion ? false : { opacity: 0, y: 6 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { ...SPRING_SWAP, delay: 0.12 }
                  }
                  onClick={() => {
                    onAddSpace?.();
                    if (!preview) setOpen(false);
                  }}
                  className={cn(
                    "relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[0.8125rem] font-medium",
                    "text-foreground outline-none",
                    "focus-visible:ring-2 focus-visible:ring-foreground/20",
                  )}
                  onPointerEnter={() => setHoveredId("add-space")}
                  onPointerLeave={() => setHoveredId(null)}
                >
                  {highlightId === "add-space" ? (
                    <motion.span
                      layoutId="switch-workspace-highlight"
                      transition={
                        reduceMotion ? { duration: 0 } : SPRING_SWAP
                      }
                      className="absolute inset-0 rounded-xl bg-chart-bg"
                    />
                  ) : null}
                  <span
                    className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-chart-bg text-chart-muted"
                  >
                    <Plus className="size-4" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="relative z-10">{ADD_SPACE_LABEL}</span>
                </motion.button>
              </div>
            </LayoutGroup>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
