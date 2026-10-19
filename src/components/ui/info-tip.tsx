"use client";

import { Info } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Excel'deki hücre notlarının karşılığı: üzerine gelince ya da odaklanınca açıklama.
 * Balon gövdeye (portal) çizilir; tabloların kaydırma kabı onu kesmez. Üstte yer yoksa alta açılır.
 */
export function InfoTip({ text, className }: { text: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const reduce = useReducedMotion();
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 120;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140), y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = () => setPos(null);

  return (
    <span className={cn("inline-flex align-middle", className)}>
      <span
        ref={ref}
        tabIndex={0}
        role="button"
        aria-label="Açıklama"
        aria-describedby={pos ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) hide();
          else show();
        }}
        className="cursor-help text-ink-quiet outline-none hover:text-ink-mute focus-visible:text-ink-mute"
      >
        <Info size={14} />
      </span>
      {pos
        ? createPortal(
            <AnimatePresence>
              {pos ? (
                <motion.span
                  id={id}
                  role="tooltip"
                  initial={reduce ? false : { opacity: 0, y: pos.below ? -4 : 4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  style={{ left: pos.x, top: pos.y }}
                  className={cn(
                    "pointer-events-none fixed z-[200] w-64 max-w-[80vw] -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-left text-xs leading-relaxed font-normal tracking-normal whitespace-normal text-white normal-case shadow-[0_12px_40px_rgba(0,0,0,0.18)]",
                    pos.below ? "" : "-translate-y-full",
                  )}
                >
                  {text}
                </motion.span>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </span>
  );
}
