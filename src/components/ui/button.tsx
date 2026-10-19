import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "accent";
type Size = "xs" | "sm" | "md" | "lg" | "icon";

const variantClass: Record<Variant, string> = {
  primary: "bg-coffee-800 text-white hover:bg-coffee-900 shadow-sm",
  secondary: "bg-coffee-100 text-coffee-900 hover:bg-coffee-200",
  outline: "border border-coffee-200 bg-white text-coffee-900 hover:bg-coffee-50",
  ghost: "text-coffee-800 hover:bg-coffee-100",
  danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
  accent: "bg-crema text-white hover:brightness-95 shadow-sm",
};

const sizeClass: Record<Size, string> = {
  xs: "h-7 px-2 text-xs gap-1 rounded-md",
  sm: "h-8 px-3 text-sm gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-5 text-base gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crema",
    "disabled:pointer-events-none disabled:opacity-50",
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
