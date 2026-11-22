import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * AkmanOS'un avatar ve ürün karoları (%15 renkli zemin + koyu glif). Sıra anlamlıdır:
 * 0 yeşil · 1 turuncu · 2 mavi · 3 kırmızı · 4 mor · 5 gök. Renk varlığa (ada) bağlanır, sıraya değil.
 */
const PASTELS = [
  "bg-emerald-500/15 text-emerald-800 dark:bg-good/15 dark:text-good-ink",
  "bg-amber-500/15 text-amber-800 dark:bg-warn/15 dark:text-warn-ink",
  "bg-blue-500/15 text-blue-800 dark:bg-info/15 dark:text-info",
  "bg-rose-500/15 text-rose-800 dark:bg-bad/15 dark:text-bad-ink",
  // Koyu temada mor yok: mavi-gri (bordo belirteci koyuda mavi-gri aileye döner, globals.css)
  "bg-violet-500/15 text-violet-800 dark:bg-bordo-600/20 dark:text-bordo-800",
  "bg-sky-500/15 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200",
] as const;

export type PastelTone = 0 | 1 | 2 | 3 | 4 | 5;

/** Bir metni sabit bir pastel tona eşler (aynı ad her yerde aynı renkte) */
export function toneFor(key: string): PastelTone {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % PASTELS.length) as PastelTone;
}

export function IconTile({
  children,
  tone = 0,
  size = "md",
  className,
}: {
  children: ReactNode;
  tone?: PastelTone;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        size === "sm" ? "size-7 rounded-lg [&>svg]:size-3.5" : "size-9 rounded-xl [&>svg]:size-4",
        PASTELS[tone],
        className,
      )}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/** Baş harflerden yuvarlak avatar (AkmanOS kullanıcı listesi) */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md"; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("tr-TR"))
    .join("");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" ? "size-7 text-[11px]" : "size-9 text-xs",
        PASTELS[toneFor(name)],
        className,
      )}
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}
