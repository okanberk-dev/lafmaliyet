import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const control =
  "w-full rounded-lg border border-coffee-200 bg-white px-3 text-sm text-coffee-950 shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)] " +
  "placeholder:text-coffee-300 focus:border-crema focus:outline-none focus:ring-2 focus:ring-crema/25 " +
  "disabled:cursor-not-allowed disabled:bg-coffee-50 disabled:text-coffee-400";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

/** Türkçe ondalık girişi (1.234,56) için metin tabanlı sayı alanı */
export function NumberInput({ className, ...props }: ComponentProps<"input">) {
  return <input inputMode="decimal" autoComplete="off" className={cn(control, "h-10 text-right tabular", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239c6c45' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-coffee-900", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-rose-700">{error}</p> : hint ? <p className="text-xs text-coffee-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-coffee-900 select-none", className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-coffee-300 accent-coffee-800" {...props} />
      {label}
    </label>
  );
}
