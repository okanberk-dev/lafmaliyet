"use client";

import type { ReactNode } from "react";

import { InfoTip } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Açıklamalı aç/kapa satırı: solda başlık ve kısa not, sağda paylaşılan anahtar. Satırın tamamı dokunulabilir
 * (telefonda başlığa ya da açıklamaya dokunmak da anahtarı çevirir); içindeki ⓘ ve bağlantılar kendi işini yapar.
 */
export function ToggleRow({
  title,
  description,
  tip,
  checked,
  onChange,
  label,
  onText,
  offText,
  disabled,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  tip?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  onText?: string;
  offText?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      onClick={(e) => {
        if (disabled || (e.target as Element).closest("button, a, input, select, textarea, label, [role=button]")) return;
        onChange(!checked);
      }}
      className={cn(
        "flex min-h-14 items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line select-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <span className="min-w-0">{title}</span>
          {tip ? <InfoTip text={tip} /> : null}
        </p>
        {description ? <p className="mt-0.5 text-xs leading-5 text-ink-mute">{description}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} onText={onText} offText={offText} disabled={disabled} />
    </div>
  );
}
