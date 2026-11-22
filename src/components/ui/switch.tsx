"use client";

import { motion, useReducedMotion } from "motion/react";

import { SPRING_PRESS } from "@/components/akmanos/lib/motion-ease";
import { cn } from "@/lib/utils";

/**
 * Aç/kapa anahtarı (aktif–pasif, yayında–değil). 36px dokunma alanı; durum renkle birlikte topun konumu,
 * `aria-checked` ve isteğe bağlı görünür metinle verilir. Top AkmanOS'taki gibi yayla kayar.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  showText,
  onText = "Aktif",
  offText = "Pasif",
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Erişilebilir ad, ör. "Kira aktif" */
  label: string;
  disabled?: boolean;
  /** Yanında durum metni yazsın */
  showText?: boolean;
  onText?: string;
  offText?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={checked ? onText : offText}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "-mx-1 inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-1 text-[13px] font-medium outline-none pointer-coarse:h-11",
        "focus-visible:ring-2 focus-visible:ring-ink/30 disabled:cursor-wait disabled:opacity-50",
        checked ? "text-ink" : "text-ink-mute",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", checked ? "bg-ink dark:bg-primary" : "bg-panel-deep")}>
        <motion.span
          className="absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.25)] dark:bg-ink"
          animate={{ x: checked ? 16 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_PRESS}
        />
      </span>
      {showText ? <span>{checked ? onText : offText}</span> : null}
    </button>
  );
}
