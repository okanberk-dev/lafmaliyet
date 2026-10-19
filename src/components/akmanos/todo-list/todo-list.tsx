"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { ChevronDown, ListTodo, RotateCcw } from "lucide-react";
import { Icon } from "@/components/akmanos/icons/icon";
import {
  EASE_OUT,
  itemsAtStep,
  SPRING_LAYOUT,
  SPRING_SWAP,
  TICK_MS,
  TODO_LIST_MAX_HEIGHT,
  TODO_LIST_TITLE,
  TODO_TASKS,
  TICKS_PER_TASK,
  type TodoItem,
  type TodoItemStatus,
} from "./constants";

function loadTodoMotionFeatures() {
  return import("motion/react").then((mod) => mod.domMax);
}

function statusLabel(status: TodoItemStatus) {
  if (status === "in-progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

function CountRoll({ value }: { value: number }) {
  const reduce = useReducedMotion() ?? false;
  const text = String(value);

  return (
    <span className="relative inline-flex h-[1.1em] overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={text}
          initial={reduce ? false : { y: "70%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={reduce ? undefined : { y: "-70%", opacity: 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 0.28, ease: EASE_OUT }
          }
          className="inline-block tabular-nums"
        >
          {text}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

function TodoHeaderIcon({ complete }: { complete: boolean }) {
  const reduce = useReducedMotion() ?? false;

  return (
    <span
      aria-hidden="true"
      className="relative grid size-6 shrink-0 place-items-center"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {complete ? (
          <m.svg
            key="complete"
            viewBox="0 0 24 24"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="absolute size-5.5 overflow-visible text-[#16a34a] dark:text-[#4ade80]"
          >
            <circle cx="12" cy="12" r="9" fill="currentColor" />
            <m.path
              d="M7.5 12.25 10.5 15.25 16.75 8.75"
              fill="none"
              stroke="white"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={
                reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }
              }
            />
          </m.svg>
        ) : (
          <m.span
            key="todo"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="absolute grid place-items-center text-chart-muted"
          >
            <Icon icon={ListTodo} size={16} />
          </m.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function TodoStatusIcon({
  status,
  progress,
}: {
  status: TodoItemStatus;
  progress?: number;
}) {
  const reduce = useReducedMotion() ?? false;
  const normalizedProgress =
    progress === undefined ? 0.68 : Math.min(100, Math.max(0, progress)) / 100;

  const tone =
    status === "in-progress"
      ? "text-foreground"
      : status === "cancelled"
        ? "text-[#e11d48] dark:text-[#fb7185]"
        : "text-chart-muted";

  return (
    <m.svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      initial={false}
      className={`mx-0.5 size-5 shrink-0 overflow-visible ${tone}`}
    >
      <m.circle
        cx="12"
        cy="12"
        r="9"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={status === "pending" ? "2 3" : undefined}
        strokeLinecap="round"
        initial={false}
        animate={{ fillOpacity: status === "completed" ? 0.06 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
        className={status === "in-progress" ? "opacity-20" : undefined}
      />
      <m.circle
        cx="12"
        cy="12"
        r="9"
        pathLength="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        initial={false}
        animate={{
          pathLength: status === "in-progress" ? normalizedProgress : 0,
          opacity: status === "in-progress" ? 1 : 0,
          rotate:
            status === "in-progress" && progress === undefined && !reduce
              ? 360
              : -90,
        }}
        transition={
          status === "in-progress" && progress === undefined && !reduce
            ? { rotate: { duration: 1.1, repeat: Infinity, ease: "linear" } }
            : reduce
              ? { duration: 0 }
              : SPRING_LAYOUT
        }
        style={{ transformOrigin: "12px 12px" }}
      />
      <m.path
        d="M7.5 12.25 10.5 15.25 16.75 8.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{
          pathLength: status === "completed" ? 1 : 0,
          opacity: status === "completed" ? 1 : 0,
        }}
        transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
      />
      <m.path
        d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        initial={false}
        animate={{
          pathLength: status === "cancelled" ? 1 : 0,
          opacity: status === "cancelled" ? 1 : 0,
        }}
        transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
      />
    </m.svg>
  );
}

function Disclosure({
  open,
  id,
  labelledBy,
  children,
}: {
  open: boolean;
  id: string;
  labelledBy: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion() ?? false;

  return (
    <m.div
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={
        reduce
          ? { opacity: open ? 1 : 0 }
          : {
              opacity: open ? 1 : 0,
              clipPath: open ? "inset(0 0 0% 0)" : "inset(0 0 100% 0)",
              y: open ? 0 : -4,
            }
      }
      transition={{
        duration: reduce ? 0 : open ? 0.22 : 0.14,
        ease: EASE_OUT,
      }}
      className="overflow-hidden"
      style={{
        height: open ? "auto" : 0,
        pointerEvents: open ? undefined : "none",
        transformOrigin: "top",
      }}
    >
      {children}
    </m.div>
  );
}

export type TodoListPanelProps = {
  items: TodoItem[];
  title?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  maxHeight?: number;
  className?: string;
};

export function TodoListPanel({
  items,
  title = "To-dos",
  open,
  defaultOpen = true,
  onOpenChange,
  collapseOnComplete = true,
  maxHeight = TODO_LIST_MAX_HEIGHT,
  className,
}: TodoListPanelProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousComplete = useRef(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const completed = items.filter((item) => item.status === "completed").length;
  const allComplete = items.length > 0 && completed === items.length;
  const itemCount = items.length;

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  useEffect(() => {
    if (previousComplete.current && !allComplete) {
      setOpen(true);
    }
    if (!previousComplete.current && allComplete && collapseOnComplete) {
      setOpen(false);
    }
    previousComplete.current = allComplete;
  }, [allComplete, collapseOnComplete, setOpen]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || itemCount === 0) return;

    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [itemCount, reduce]);

  return (
    <section
      aria-label="Task list"
      className={`w-full overflow-hidden rounded-2xl border border-border bg-chart-metric-bg ${className ?? ""}`.trim()}
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group flex h-11 w-full items-center gap-2.5 rounded-2xl px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
      >
        <TodoHeaderIcon complete={allComplete} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {title}
        </h3>
        <span
          className={`shrink-0 text-xs font-medium tabular-nums ${
            allComplete
              ? "text-[#16a34a] dark:text-[#4ade80]"
              : "text-chart-muted"
          }`}
        >
          <span className="sr-only">
            {completed} of {items.length} tasks completed
          </span>
          <span aria-hidden="true" className="inline-flex items-center gap-px">
            <CountRoll value={completed} />
            <span>/</span>
            <span>{items.length}</span>
          </span>
        </span>
        <m.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="text-chart-muted transition-colors group-hover:text-foreground"
        >
          <Icon icon={ChevronDown} size={14} />
        </m.span>
      </button>

      <Disclosure open={currentOpen} id={contentId} labelledBy={triggerId}>
        <div
          ref={viewportRef}
          className="todo-list-scroll overflow-y-auto px-2 pb-2"
          style={{ maxHeight }}
        >
          {items.length ? (
            <ol aria-live="polite" className="space-y-0">
              <AnimatePresence initial={false} mode="popLayout">
                {items.map((item) => {
                  const status = item.status ?? "pending";
                  return (
                    <m.li
                      layout="position"
                      key={item.id}
                      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
                      transition={
                        reduce
                          ? { duration: 0 }
                          : {
                              opacity: { duration: 0.18, ease: EASE_OUT },
                              y: SPRING_LAYOUT,
                              layout: SPRING_LAYOUT,
                            }
                      }
                      className="flex min-h-9 items-center gap-2.5 rounded-xl px-1.5 py-1"
                    >
                      <TodoStatusIcon status={status} progress={item.progress} />
                      <span className="sr-only">{statusLabel(status)}: </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-sm leading-5 ${
                          status === "pending"
                            ? "text-chart-muted/70"
                            : status === "in-progress"
                              ? "text-foreground"
                              : "text-chart-muted/65"
                        }`}
                      >
                        <span className="relative inline-block max-w-full">
                          {item.title}
                          <m.span
                            aria-hidden="true"
                            initial={false}
                            animate={{
                              scaleX: status === "completed" ? 1 : 0,
                              opacity: status === "completed" ? 1 : 0,
                            }}
                            transition={
                              reduce
                                ? { duration: 0 }
                                : {
                                    duration: 0.28,
                                    ease: EASE_OUT,
                                    delay: 0.06,
                                  }
                            }
                            className="absolute inset-x-0 top-1/2 h-px origin-left bg-current"
                          />
                        </span>
                      </span>
                      {item.detail ? (
                        <span className="shrink-0 font-mono text-sm tabular-nums text-chart-muted">
                          {item.detail}
                        </span>
                      ) : null}
                    </m.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          ) : (
            <p className="px-1.5 py-2 text-sm text-chart-muted">No tasks yet</p>
          )}
        </div>
      </Disclosure>
    </section>
  );
}

function TodoRun({ runKey }: { runKey: number }) {
  const [step, setStep] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setStep(0);
  }, [runKey]);

  useEffect(() => {
    if (step >= TODO_TASKS.length * TICKS_PER_TASK) return;
    timer.current = window.setTimeout(() => setStep((value) => value + 1), TICK_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [step]);

  return (
    <TodoListPanel items={itemsAtStep(step)} title={TODO_LIST_TITLE} />
  );
}

export function TodoList() {
  const [run, setRun] = useState(0);

  return (
    <LazyMotion features={loadTodoMotionFeatures} strict>
      <div
        className="relative mx-auto min-h-[300px] w-full max-w-lg pb-10"
        data-component="todo-list"
      >
        <TodoRun key={run} runKey={run} />
        <button
          type="button"
          onClick={() => setRun((value) => value + 1)}
          className="absolute bottom-0 left-0 inline-flex h-9 min-h-9 items-center gap-1.5 rounded-xl bg-chart-metric-bg px-3 text-xs font-medium text-chart-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
        >
          <Icon icon={RotateCcw} size={12} />
          Replay
        </button>
      </div>
    </LazyMotion>
  );
}
