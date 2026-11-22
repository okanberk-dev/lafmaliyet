"use client";

import { Check, SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Liste sayfalarının telefondaki süzgeç düzeni (Faturalar, Satışlar ve Gelir-gider kullanır): arama kutusunun
 * yanında tek "Süzgeç" düğmesi, altında etkin süzgeç çipleri; seçimler paylaşılan `Dialog`da (telefonda alttan
 * açılan sayfa).
 * - `FilterButton`, `ActiveFilters`, `ChoiceList`: "Süzgeç" düğmesi, kaldırılabilir çipler, alt sayfada seçim listesi.
 * - `SHEET_BTN`, `BIG_FIELDS`: alt sayfadaki düğme ve alanların telefondaki 48px boyu.
 * Sayfa düzeyindeki yüzen "ekle" düğmesi için `Fab` (ui/fab) kullanılır.
 */

/**
 * Alt sayfanın altbilgisindeki düğmeler telefonda 48px (Dialog onları satıra eşit yayar). Yükseklik `min-h` ile:
 * Button'ın dokunmatik boyu (pointer-coarse:h-11) CSS'te sonra geldiği için max-sm:h-12'yi ezerdi; min-height
 * height'tan büyükse o geçerlidir.
 */
export const SHEET_BTN = "max-sm:min-h-12 max-sm:text-[15px]";

/** Telefonda büyük alanlar: 48px yükseklik (yazı form kontrollerinde zaten 16px; iOS yakınlaştırmaz) */
export const BIG_FIELDS = "max-sm:[&_input:not([type=checkbox])]:h-12 max-sm:[&_select]:h-12";

/** Telefondaki "Süzgeç" düğmesi: etkin süzgeç sayısı rozetle */
export function FilterButton({ count, onClick, label = "Süzgeç" }: { count: number; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={count ? `${label}, ${count} etkin` : label}
      className={cn(
        "inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3.5 text-sm font-medium ring-1 ring-inset transition-colors",
        count ? "bg-ink text-on-solid ring-ink" : "bg-surface text-ink-soft ring-line-strong hover:text-ink",
      )}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
      {label}
      {count ? (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-lime text-[11px] font-semibold text-good-ink tabular" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  );
}

export interface ActiveFilter {
  key: string;
  label: ReactNode;
  onRemove: () => void;
}

/**
 * Etkin süzgeçlerin kaldırılabilir çipleri (telefonda sayfada kalan özet). Görünen çip 36px; dokunma alanı
 * kenarlarda 4px daha geniş (44px), çipler arasındaki 8px boşluk dokunma alanlarını üst üste bindirmez.
 */
export function ActiveFilters({ items, className }: { items: ActiveFilter[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Etkin süzgeçler">
      {items.map((f) => (
        <li key={f.key}>
          <button
            type="button"
            onClick={f.onRemove}
            className="relative inline-flex h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-full bg-surface pr-2.5 pl-3 text-[13px] font-medium text-ink ring-1 ring-ink/25 ring-inset before:absolute before:-inset-1 before:content-['']"
          >
            <span className="min-w-0 truncate">{f.label}</span>
            <X size={14} className="shrink-0 text-ink-mute" aria-hidden="true" />
            <span className="sr-only"> süzgecini kaldır</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Alt sayfada tek seçim listesi (radyo düğmesi gibi): her satır 48px, seçili olan işaretli */
export function ChoiceList<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">{label}</legend>
      <div role="radiogroup" aria-label={label} className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line-strong">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cn("flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 text-left text-[15px] transition-colors", on ? "bg-panel font-medium text-ink" : "text-ink-soft hover:bg-panel/60")}
            >
              <span className="min-w-0 flex-1">{o.label}</span>
              {o.count !== undefined ? <span className="text-sm text-ink-mute tabular">{o.count}</span> : null}
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", on ? "bg-ink text-on-solid" : "ring-1 ring-line-strong ring-inset")} aria-hidden="true">
                {on ? <Check size={14} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
