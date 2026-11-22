import { Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { InfoTip } from "./info-tip";

/** Beyaz, rounded-xl kontrol; gri panelde de beyaz sayfada da ince halkayla ayrılır */
const control =
  "w-full rounded-xl border-0 bg-surface px-3 text-base text-ink ring-1 ring-inset ring-line-strong sm:text-sm pointer-coarse:text-base " +
  "placeholder:text-ink-quiet focus:ring-2 focus:ring-ink/25 focus:outline-none " +
  "aria-invalid:bg-bad-soft aria-invalid:ring-bad/50 data-[warn=true]:bg-warn-soft data-[warn=true]:ring-warn/40 " +
  "disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-quiet";

/** Alanların görünümü: alan gibi görünmesi gereken düğmeler için (ör. reçete önerisindeki malzeme seçimi) */
export const fieldControl = control;

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-9 pointer-coarse:h-11", className)} {...props} />;
}

/** Türkçe ondalık girişi (1.234,56) için metin tabanlı sayı alanı */
export function NumberInput({ className, ...props }: ComponentProps<"input">) {
  return <input inputMode="decimal" autoComplete="off" className={cn(control, "h-9 text-right tabular pointer-coarse:h-11", className)} {...props} />;
}

/** Büyüteç ikonlu arama kutusu (araç çubukları için) */
export function SearchInput({ className, wrapperClassName, ...props }: ComponentProps<"input"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-quiet" aria-hidden="true" />
      <input type="search" className={cn(control, "h-9 pl-9 pointer-coarse:h-11", className)} {...props} />
    </div>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(control, "h-9 cursor-pointer appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8 pointer-coarse:h-11", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-[13px] font-medium text-ink-soft", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  tip,
  aside,
}: {
  label: ReactNode;
  /** Etiketin yanında ⓘ açıklaması */
  tip?: ReactNode;
  /** Etiket satırının sağ ucunda küçük bir işaret (ör. "Kasadan" rozeti); etiket uzunsa o sarılır, bu yerinde kalır */
  aside?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="flex items-center gap-1.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {tip ? <InfoTip text={tip} /> : null}
        {aside ? <span className="ml-auto shrink-0">{aside}</span> : null}
      </span>
      {children}
      {/* İpucu div: bir uyarı (Notice) da taşıyabilir */}
      {/* Hatanın kimliği `${htmlFor}-hata`: alan `aria-describedby` ile ona bağlanabilir (ekran okuyucu hatayı alanla okur) */}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-hata` : undefined} className="text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <div className="text-xs text-ink-mute">{hint}</div>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-ink select-none pointer-coarse:min-h-11", className)}>
      <input type="checkbox" className="size-4 cursor-pointer rounded accent-ink pointer-coarse:size-5" {...props} />
      {label}
    </label>
  );
}
