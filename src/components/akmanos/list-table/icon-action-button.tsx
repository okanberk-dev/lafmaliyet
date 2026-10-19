"use client";

import type { LucideIcon } from "lucide-react";
import { Icon } from "@/components/akmanos/icons/icon";

export function IconActionButton({
  icon,
  label,
  onClick,
  tone = "default",
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-chart-metric-bg transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        tone === "danger"
          ? "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          : "text-chart-muted hover:text-foreground"
      }`}
    >
      <Icon icon={icon} size={15} />
    </button>
  );
}
