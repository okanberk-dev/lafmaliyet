"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  Command,
  FileText,
  Link2,
  Search,
  Trash2,
} from "lucide-react";
import { Icon } from "@/components/akmanos/icons/icon";
import { cn } from "@/components/akmanos/lib/cn";
import { EASE_OUT, SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { CommandPaletteKbd } from "./command-palette-kbd";
import {
  COMMAND_PALETTE_CATEGORIES,
  COMMAND_PALETTE_DEFAULT_LABELS,
  COMMAND_PALETTE_DEMO_RESULTS,
} from "./constants";
import type {
  CommandPaletteCategory,
  CommandPaletteLabels,
  CommandPaletteResult,
  PersonStatus,
} from "./types";
import {
  commandPaletteFaviconUrl,
  commandPaletteModifierLabel,
  isMacPlatform,
} from "./utils";

export type CommandPaletteProps = {
  results?: CommandPaletteResult[];
  categories?: CommandPaletteCategory[];
  /** Localized chrome copy (defaults to English). */
  labels?: Partial<CommandPaletteLabels>;
  /** Gallery: palette starts open */
  preview?: boolean;
  /** Controlled open state (navbar / host triggers). */
  open?: boolean;
  /** Hide the built-in Search trigger button. */
  hideTrigger?: boolean;
  /** Row Copy / Remove buttons (demo chrome). Off for real component search. */
  showRowActions?: boolean;
  /** Stretch trigger to sidebar / shell width */
  fullWidth?: boolean;
  className?: string;
  onSelect?: (result: CommandPaletteResult) => void;
  onOpenChange?: (open: boolean) => void;
};

function initialsFromName(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function PersonStatusDot({ status }: { status: PersonStatus }) {
  const tone =
    status === "active"
      ? "bg-[#a3d018] dark:bg-[#c0f21e]"
      : status === "idle"
        ? "bg-[#f97316]"
        : "bg-chart-muted";

  return (
    <span
      className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-chart-metric-bg", tone)}
      aria-hidden="true"
    />
  );
}

function ResultLeading({
  result,
}: {
  result: CommandPaletteResult;
}) {
  const [faviconFailed, setFaviconFailed] = useState(false);

  if (result.kind === "document") {
    return (
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-chart-bg text-chart-muted"
      >
        <Icon icon={FileText} size={16} />
      </span>
    );
  }

  if (result.kind === "person") {
    return (
      <span className="relative shrink-0">
        <span
          className="flex size-9 items-center justify-center rounded-full text-xs font-semibold text-foreground"
          style={{
            backgroundColor: result.accent ? `${result.accent}22` : "var(--chart-bg)",
            color: result.accent ?? "var(--foreground)",
          }}
        >
          {initialsFromName(result.title)}
        </span>
        {result.personStatus ? (
          <PersonStatusDot status={result.personStatus} />
        ) : null}
      </span>
    );
  }

  const favicon =
    result.faviconDomain && !faviconFailed
      ? commandPaletteFaviconUrl(result.faviconDomain)
      : null;

  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-chart-bg ring-1 ring-border"
    >
      {favicon ? (
        /* eslint-disable-next-line @next/next/no-img-element -- external favicon */
        <img
          src={favicon}
          alt=""
          className="size-5 object-contain"
          onError={() => setFaviconFailed(true)}
        />
      ) : (
        <span className="text-xs font-semibold text-chart-muted">
          {initialsFromName(result.title)}
        </span>
      )}
    </span>
  );
}

function FooterHint({
  icon,
  label,
  keys,
}: {
  icon?: ReactNode;
  label: string;
  keys: string[];
}) {
  return (
    <div className="flex items-center gap-1.5 text-chart-muted">
      {icon}
      {keys.map((key) => (
        <CommandPaletteKbd key={key}>{key}</CommandPaletteKbd>
      ))}
      <span className="text-xs">{label}</span>
    </div>
  );
}

export function CommandPalette({
  results = COMMAND_PALETTE_DEMO_RESULTS,
  categories = COMMAND_PALETTE_CATEGORIES,
  labels: labelsProp,
  preview = false,
  open: openProp,
  hideTrigger = false,
  showRowActions = true,
  fullWidth = false,
  className,
  onSelect,
  onOpenChange,
}: CommandPaletteProps) {
  const reduceMotion = useReducedMotion();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(preview);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modifierLabel, setModifierLabel] = useState("⌘");
  const labels = useMemo(
    () => ({ ...COMMAND_PALETTE_DEFAULT_LABELS, ...labelsProp }),
    [labelsProp],
  );

  useEffect(() => {
    setModifierLabel(commandPaletteModifierLabel());
  }, []);

  const setPaletteOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
      if (!next) {
        setQuery("");
        setCategory(null);
        setSelectedIndex(0);
      }
    },
    [isControlled, onOpenChange],
  );

  const filteredResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return results.filter((result) => {
      const matchesCategory =
        !category || result.categoryId === category;
      const matchesQuery =
        normalized.length === 0 ||
        result.title.toLowerCase().includes(normalized) ||
        result.subtitle.toLowerCase().includes(normalized);
      return matchesCategory && matchesQuery;
    });
  }, [results, query, category]);

  const clampedIndex =
    filteredResults.length === 0
      ? 0
      : Math.min(selectedIndex, filteredResults.length - 1);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, category, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const selectedElement = document.querySelector(
      `[data-command-palette-index="${clampedIndex}"]`,
    );
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [clampedIndex, open]);

  const selectResult = useCallback(
    (result: CommandPaletteResult) => {
      onSelect?.(result);
      setPaletteOpen(false);
    },
    [onSelect, setPaletteOpen],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const metaCombo =
        (isMacPlatform() ? event.metaKey : event.ctrlKey) &&
        event.key.toLowerCase() === "k";

      if (metaCombo) {
        event.preventDefault();
        setPaletteOpen(!open);
        return;
      }

      if (!open) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setPaletteOpen(false);
        return;
      }

      if (filteredResults.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) =>
          current >= filteredResults.length - 1 ? 0 : current + 1,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) =>
          current <= 0 ? filteredResults.length - 1 : current - 1,
        );
        return;
      }

      const digit = Number(event.key);
      if (digit >= 1 && digit <= 9 && !event.metaKey && !event.ctrlKey) {
        const index = digit - 1;
        if (index < filteredResults.length) {
          event.preventDefault();
          selectResult(filteredResults[index]!);
        }
        return;
      }

      if (event.key === "Enter" && event.target !== inputRef.current) {
        event.preventDefault();
        const result = filteredResults[clampedIndex];
        if (result) selectResult(result);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    clampedIndex,
    filteredResults,
    open,
    selectResult,
    setPaletteOpen,
  ]);

  return (
    <div
      data-component="command-palette"
      className={cn(
        fullWidth ? "relative w-full" : "relative flex flex-col items-center gap-3",
        className,
      )}
    >
      {preview && !fullWidth ? (
        <p className="text-center text-sm text-chart-muted">
          {labels.openHint}
        </p>
      ) : null}

      {!hideTrigger ? (
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className={cn(
            "inline-flex h-11 min-h-11 items-center gap-2 rounded-xl bg-chart-metric-bg text-sm transition-colors hover:bg-chart-bg",
            fullWidth
              ? "w-full rounded-2xl px-3 font-normal hover:bg-chart-bg"
              : "px-4 font-medium text-foreground",
          )}
        >
          <Icon icon={Search} size={16} className="shrink-0 text-chart-muted" />
          {fullWidth ? (
            <span className="min-w-0 flex-1 truncate text-left text-sm text-chart-muted">
              {labels.searchPlaceholder}
            </span>
          ) : (
            <>
              <span>{labels.searchTrigger}</span>
              <span className="text-chart-muted">·</span>
            </>
          )}
          <CommandPaletteKbd className="shrink-0">
            {modifierLabel}K
          </CommandPaletteKbd>
        </button>
      ) : null}

      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              aria-label={labels.closeAria}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : SPRING_PANEL}
              className="fixed inset-0 z-50 bg-foreground/15"
              onClick={() => setPaletteOpen(false)}
            />
            <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 pointer-events-none">
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={labels.title}
                initial={
                  reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reduceMotion ? undefined : { opacity: 0, y: 6, scale: 0.98 }
                }
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.22, ease: EASE_OUT }
                }
                className="pointer-events-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-chart-card-bg shadow-[0_24px_80px_rgba(0,0,0,0.12)] ring-1 ring-border dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
              >
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Icon
                  icon={Command}
                  size={18}
                  className="shrink-0 text-chart-muted"
                />
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && filteredResults.length > 0) {
                      event.preventDefault();
                      const result = filteredResults[clampedIndex];
                      if (result) selectResult(result);
                    }
                  }}
                  placeholder={labels.searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-chart-muted focus:outline-none"
                  aria-controls={listId}
                  aria-activedescendant={
                    filteredResults[clampedIndex]
                      ? `command-palette-option-${filteredResults[clampedIndex]!.id}`
                      : undefined
                  }
                />
                <CommandPaletteKbd>{labels.returnKey}</CommandPaletteKbd>
              </div>

              {categories.length > 0 ? (
                <div className="flex items-center gap-1 overflow-x-auto px-4 py-2.5">
                  {categories.map((item) => {
                    const active = category === item.id;
                    const IconComponent = item.icon;
                    return (
                      <div
                        key={item.id}
                        className="flex shrink-0 items-center gap-1"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setCategory((current) =>
                              current === item.id ? null : item.id,
                            )
                          }
                          className={cn(
                            "inline-flex h-8 min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors",
                            active
                              ? "bg-chart-metric-bg text-foreground ring-1 ring-border"
                              : "text-chart-muted hover:bg-chart-metric-bg hover:text-foreground",
                          )}
                        >
                          <IconComponent
                            className="size-3.5 shrink-0"
                            strokeWidth={1.75}
                          />
                          {item.label}
                        </button>
                        {item.dividerAfter ? (
                          <span
                            className="mx-1 h-4 w-px shrink-0 bg-border"
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="inline-flex h-8 min-h-8 shrink-0 items-center rounded-lg px-2 text-xs font-medium text-chart-muted hover:bg-chart-metric-bg hover:text-foreground"
                    aria-label={labels.moreCategoriesAria}
                  >
                    …
                  </button>
                </div>
              ) : null}

              <div className="command-palette-scroll min-h-0 max-h-[min(360px,50vh)] overflow-y-auto px-2 pb-2">
                <p className="px-2 pb-2 text-xs text-chart-muted">
                  {labels.recentLabel}
                </p>
                <ul id={listId} role="listbox" className="flex flex-col gap-0.5">
                  {filteredResults.length === 0 ? (
                    <li className="px-3 py-8 text-center text-sm text-chart-muted">
                      {labels.noResults}
                    </li>
                  ) : (
                    filteredResults.map((result, index) => {
                      const selected = index === clampedIndex;
                      return (
                        <li
                          key={result.id}
                          id={`command-palette-option-${result.id}`}
                          role="option"
                          aria-selected={selected}
                          data-command-palette-index={index}
                          className={cn(
                            "group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors",
                            selected
                              ? "bg-chart-metric-bg"
                              : "hover:bg-chart-metric-bg/60",
                          )}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() => selectResult(result)}
                            onMouseEnter={() => setSelectedIndex(index)}
                          >
                            <ResultLeading result={result} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {result.title}
                              </p>
                              <p className="truncate text-xs text-chart-muted">
                                {result.subtitle}
                              </p>
                            </div>
                          </button>

                          {selected && showRowActions ? (
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                className="flex size-8 items-center justify-center rounded-lg text-chart-muted transition-colors hover:bg-chart-bg hover:text-foreground"
                                aria-label={labels.copyLinkAria}
                              >
                                <Link2 className="size-4" strokeWidth={1.75} />
                              </button>
                              <button
                                type="button"
                                className="flex size-8 items-center justify-center rounded-lg text-chart-muted transition-colors hover:bg-chart-bg hover:text-foreground"
                                aria-label={labels.removeAria}
                              >
                                <Trash2 className="size-4" strokeWidth={1.75} />
                              </button>
                              <button
                                type="button"
                                onClick={() => selectResult(result)}
                                className="flex h-8 min-h-8 items-center rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
                              >
                                {labels.selectLabel}
                              </button>
                            </div>
                          ) : selected ? (
                            <button
                              type="button"
                              onClick={() => selectResult(result)}
                              className="flex h-8 min-h-8 shrink-0 items-center rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
                            >
                              {labels.selectLabel}
                            </button>
                          ) : (
                            <span className="shrink-0 px-1 font-mono text-xs tabular-nums text-chart-muted">
                              {index + 1}
                            </span>
                          )}
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2.5">
                <FooterHint label={labels.navigate} keys={["↑", "↓"]} />
                <FooterHint
                  label={labels.open}
                  keys={[labels.returnKey]}
                />
                {showRowActions ? (
                  <>
                    <FooterHint label={labels.actions} keys={["Tab"]} />
                    <FooterHint label={labels.guide} keys={["/"]} />
                  </>
                ) : null}
                <FooterHint label={labels.close} keys={["Esc"]} />
              </div>
            </motion.div>
            </div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
