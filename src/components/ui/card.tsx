import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Panel kartı (AkmanOS chart-card): sıcak gri zemin, rounded-3xl, kenarlıksız.
 * İçindeki kontroller, tablolar ve grafik kuyuları beyazdır.
 * `variant="surface"`: beyaz kart (panel içinde ikinci kat ya da form kartı).
 */
export function Card({ className, variant = "panel", ...props }: ComponentProps<"section"> & { variant?: "panel" | "surface" }) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-3xl",
        // Koyu temada kartlar kenarlıksız, tonla ayrılır (docs/KOYU-TEMA.md)
        variant === "panel" ? "bg-panel" : "bg-surface ring-1 ring-line-strong dark:ring-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Kart başlığı: solda beyaz ikon karosu + başlık + açıklama (+ meta satırı), sağda eylemler.
 * AkmanOS "User list · Manage accounts · Active · 42" düzeni.
 */
export function CardHeader({
  title,
  description,
  meta,
  actions,
  className,
  icon,
  actionsClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Başlığın altındaki küçük sayaç satırı, ör. "Aktif · 42" */
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  icon?: ReactNode;
  /** Eylem kabına ek sınıf, ör. telefonda tam genişlik: "max-sm:w-full" */
  actionsClassName?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 pb-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold tracking-tight text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] leading-5 text-ink-mute">{description}</p> : null}
          {meta ? <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-mute">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className={cn("flex flex-wrap items-center gap-2", actionsClassName)}>{actions}</div> : null}
    </div>
  );
}

/** Kart gövdesi. Başlıksız kullanılırsa üst boşluğu kendisi verir. */
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5 first:pt-5", className)} {...props} />;
}

/** Kart içinde beyaz kuyu: grafik, liste ya da form grubunu panelden ayırır */
export function Well({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl bg-surface p-4", className)} {...props} />;
}

/** Kartın altındaki ince şerit: toplam satırı, sayfalama, not */
export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-[13px] text-ink-mute", className)}
      {...props}
    />
  );
}
