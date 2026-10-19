"use client";

import type { ReactNode } from "react";

import { InfoTip } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";

/** Açıklamalı aç/kapa satırı: solda başlık ve kısa not, sağda paylaşılan anahtar */
export function ToggleRow({
  title,
  description,
  tip,
  checked,
  onChange,
  label,
  onText,
  offText,
}: {
  title: ReactNode;
  description?: ReactNode;
  tip?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  onText?: string;
  offText?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <span className="min-w-0">{title}</span>
          {tip ? <InfoTip text={tip} /> : null}
        </p>
        {description ? <p className="mt-0.5 text-xs leading-5 text-ink-mute">{description}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} onText={onText} offText={offText} />
    </div>
  );
}
