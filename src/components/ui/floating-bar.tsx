"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { cn } from "@/lib/utils";

/**
 * İçerik alanının altında yüzen beyaz kapsül: kaydedilmemiş değişiklikler, sayım kaydı.
 * Masaüstünde kenar çubuğunun (17.5rem) sağında ortalanır, telefonda güvenli alanın üstünde durur.
 * Açıkken sayfanın altına boşluk eklenir (globals.css, [data-floating-bar]): son satırlar çubuğun altında kalmaz.
 */
export function FloatingBar({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
          transition={reduce ? { duration: 0 } : SPRING_PANEL}
          data-floating-bar
          className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:left-[17.5rem]"
        >
          <div
            role="region"
            aria-label="Kaydetme çubuğu"
            className={cn(
              "pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.14)] ring-1 ring-line-strong",
              className,
            )}
          >
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
