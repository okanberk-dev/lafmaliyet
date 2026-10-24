"use client";

import { CalendarClock } from "lucide-react";

import { Checkbox } from "@/components/ui/form";
import { pastMonthConfirmText, pastMonthText, type MonthEffect } from "@/lib/cari/months";
import { cn } from "@/lib/utils";

/*
 * Cari pencerelerinin ortak parçaları (Borç ekle, Ödeme ekle, Faturası geldi, Neye sayıldı, silme onayı). Yazım
 * src/server/actions/cari.ts'te; kurallar src/lib/cari'de.
 */

/** "Geri al"lı bildirimlerin süresi (tedarikçi sayfasının öteki bildirimleriyle aynı) */
export const CARI_UNDO_MS = 10_000;

/** Tutarın alandaki yazılışı: 1250.5 → "1250,5" (panelin sayı girişi binlik ayırıcıyı da okur) */
export const amountText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

/**
 * Geçmiş ay onayı (K18): işlem kapanmış bir ayın giderini değiştiriyorsa ay ay ne olacağı yazılır ve onay kutusu
 * işaretlenmeden kayıt yapılmaz. Sunucu da onaysız isteği reddeder.
 */
export function PastConfirm({ effects, checked, onChange, className }: { effects: readonly MonthEffect[]; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  if (!effects.length) return null;
  return (
    <div className={cn("space-y-2 rounded-2xl bg-warn-soft px-3.5 py-3 text-[13px] leading-5 text-warn", className)} role="alert">
      <p className="flex items-start gap-2 font-medium">
        <CalendarClock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{effects.map(pastMonthText).join(" · ")}</span>
      </p>
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} label={<span className="text-ink">{pastMonthConfirmText(effects)}</span>} className="items-start" />
    </div>
  );
}
