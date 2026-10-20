import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * primary   mürekkep siyahı (AkmanOS bg-foreground): sayfadaki birincil eylem (kaydet, ekle)
 * secondary beyaz kontrol: ikincil eylem (dışa aktar, filtre); panelde de beyaz sayfada da çalışır
 * outline   secondary ile aynı (eski ad)
 * ghost     zeminsiz: satır içi ve araç çubuğu eylemleri
 * danger    geri alınamaz eylem (sil)
 * accent    AkmanOS limonu: olumlu, öne çıkan tek çağrı
 */
type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "accent";
type Size = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const variantClass: Record<Variant, string> = {
  primary: "bg-ink text-white shadow-[0_1px_2px_rgb(0_0_0/0.18)] hover:bg-ink/85",
  secondary: "bg-surface text-ink-mute ring-1 ring-inset ring-line-strong hover:text-ink",
  outline: "bg-surface text-ink-mute ring-1 ring-inset ring-line-strong hover:text-ink",
  ghost: "text-ink-mute hover:bg-panel hover:text-ink",
  danger: "bg-bad text-white shadow-[0_1px_2px_rgb(0_0_0/0.18)] hover:brightness-95",
  accent: "bg-lime text-good-ink hover:brightness-95",
};

// Dokunmatik ekranda (pointer-coarse) her boyut en az 44px dokunma alanı
const sizeClass: Record<Size, string> = {
  xs: "h-7 pointer-coarse:h-11 px-2.5 text-xs gap-1 rounded-lg",
  sm: "h-8 pointer-coarse:h-11 px-3 text-[13px] gap-1.5 rounded-[10px]",
  md: "h-9 pointer-coarse:h-11 px-3.5 text-sm gap-2 rounded-xl",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-xl",
  icon: "size-9 pointer-coarse:size-11 rounded-xl",
  "icon-sm": "size-8 pointer-coarse:size-11 rounded-lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-[color,background-color,box-shadow,transform] active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-45",
    variantClass[variant],
    sizeClass[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "outline",
  size = "md",
  className,
  children,
  prefetch,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}

const ICON_BUTTON_TONES = {
  default: "text-ink-mute hover:text-ink",
  danger: "text-bad hover:bg-bad-soft",
} as const;

/** AkmanOS satır eylemi sınıfı (list-table/icon-action-button): 32px, dokunmatikte 44px */
export function iconButtonClass(tone: keyof typeof ICON_BUTTON_TONES = "default", className?: string) {
  return cn(
    "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-surface ring-1 ring-inset ring-line transition-colors pointer-coarse:size-11",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 disabled:pointer-events-none disabled:opacity-40",
    ICON_BUTTON_TONES[tone],
    className,
  );
}

/**
 * AkmanOS satır eylemi: beyaz, yuvarlatılmış kare ikon düğmesi (göz, kalem, çöp).
 * `label` hem erişilebilir ad hem ipucu olur. `tone="danger"` silme gibi eylemler için kırmızı ikon.
 */
export function IconButton({
  label,
  tone = "default",
  className,
  type = "button",
  children,
  ...props
}: ComponentProps<"button"> & { label: string; tone?: keyof typeof ICON_BUTTON_TONES }) {
  return (
    <button type={type} aria-label={label} title={label} className={iconButtonClass(tone, className)} {...props}>
      {children}
    </button>
  );
}

/** IconButton görünümünde sayfa bağlantısı (satırdan ayrıntıya git) */
export function IconLink({
  href,
  label,
  className,
  children,
  prefetch,
}: {
  href: string;
  label: string;
  className?: string;
  children: ReactNode;
  prefetch?: boolean;
}) {
  return (
    <Link href={href} prefetch={prefetch} aria-label={label} title={label} className={iconButtonClass("default", className)}>
      {children}
    </Link>
  );
}
