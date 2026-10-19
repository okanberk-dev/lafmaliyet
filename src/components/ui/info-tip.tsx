"use client";

import { Info } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Excel'deki hücre notlarının karşılığı: üzerine gelince ya da klavyeyle odaklanınca açıklama; dokunmatikte
 * dokununca açılır, başka yere dokununca, kaydırınca ya da Esc ile kapanır. Balon gövdeye (portal) çizilir;
 * tabloların kaydırma kabı onu kesmez. Üstte yer yoksa alta açılır, ekran kenarından taşmaz.
 */
export function InfoTip({ text, className }: { text: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const pointer = useRef<string>("");
  const id = useId();
  const reduce = useReducedMotion();
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 120;
    // Balon en fazla 16rem; dar ekranda kenarlardan 12px içeride kalsın
    const half = Math.min(128, window.innerWidth * 0.4) + 12;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half), y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = () => setPos(null);

  // Açıkken kaydırma ve Esc balonu kapatır (sabit konumlu balon yerinde asılı kalmasın)
  const open = pos !== null;
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={cn("inline-flex align-middle", className)}>
      <span
        ref={ref}
        tabIndex={0}
        role="button"
        aria-label="Açıklama"
        aria-expanded={open}
        aria-describedby={pos ? id : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onFocus={(e) => {
          // Klavyeyle gelince açılır; dokunma ve tıklama odağı açıp kapamayı onClick'e bırakır
          if (e.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={hide}
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          // Farede balon zaten üzerine gelince açık; tıklama onu kapatmasın. Dokunmada aç/kapa.
          if (pointer.current === "mouse") show();
          else if (pos) hide();
          else show();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (pos) hide();
            else show();
          }
        }}
        // Görünen ikon 14px; dokunma alanı görünmez bir kenarla farede 30px'e, dokunmatikte 38px'e çıkar
        className="relative cursor-help rounded-full text-ink-quiet outline-none after:absolute after:-inset-2 after:content-[''] hover:text-ink-mute focus-visible:text-ink-mute focus-visible:ring-2 focus-visible:ring-ink/30 pointer-coarse:after:-inset-3"
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
