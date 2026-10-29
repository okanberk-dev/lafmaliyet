import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { PastelTone } from "./icon-tile";

/**
 * AkmanOS "Recent Activity": iOS uygulama ikonu gibi doygun karolar (beyaz glif), 15px kalın başlık,
 * sağda zaman/değer, altında açıklama, karodan sonra başlayan ince ayırıcı, önemli öğede mavi nokta.
 * Ton sırası icon-tile ile aynı: 0 yeşil · 1 turuncu · 2 mavi · 3 kırmızı · 4 mor · 5 gök.
 */
const WELLS = ["bg-[#30d158]", "bg-[#ff9f0a]", "bg-[#0a84ff]", "bg-[#ff375f]", "bg-[#bf5af2]", "bg-[#64d2ff]"] as const;

export function ActivityList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul data-component="recent-activity" className={cn("-mx-2 flex flex-col [&>li:last-child_.activity-sep]:hidden", className)}>
      {children}
    </ul>
  );
}

export function ActivityItem({
  icon,
  tone = 0,
  title,
  description,
  aside,
  href,
  dot,
  wrap,
  well,
}: {
  icon: ReactNode;
  tone?: PastelTone;
  /** Kuyunun kendi renkleri (doygun karonun yerine; ör. uyarının tonu, TONE_TILE) */
  well?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Sağdaki kısa bilgi: zaman, tutar */
  aside?: ReactNode;
  href?: string;
  /** Dikkat isteyen öğe: true ya da "info" mavi, "danger" kırmızı nokta */
  dot?: boolean | "info" | "danger";
  /** Başlık ve açıklama kısaltılmasın (uzun uyarı metinleri) */
  wrap?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          "mt-0.5 flex size-[34px] shrink-0 items-center justify-center rounded-[9px] [&>svg]:size-[15px]",
          well ?? cn("text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] [&>svg]:stroke-[2.25]", WELLS[tone]),
          well && "[&>svg]:stroke-[1.75]",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 pt-px">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn("min-w-0 text-[15px] font-semibold tracking-[-0.01em] text-ink", wrap ? "text-pretty" : "truncate")}>{title}</span>
          {aside ? <span className="shrink-0 text-[13px] text-ink-mute tabular">{aside}</span> : null}
        </span>
        {description ? <span className={cn("mt-0.5 block text-[13px] leading-[1.35] text-ink-mute", !wrap && "line-clamp-2")}>{description}</span> : null}
      </span>
      {dot ? (
        <span role="img" aria-label={dot === "danger" ? "Acil" : "Önemli"} className={cn("mt-2 size-2 shrink-0 rounded-full", dot === "danger" ? "bg-bad" : "bg-[#007aff]")} />
      ) : null}
    </>
  );
  const cls = "group relative flex w-full items-start gap-3 rounded-[14px] px-3 py-3 text-left outline-none transition-colors";
  return (
    <li className="relative">
      {href ? (
        <Link href={href} className={cn(cls, "hover:bg-ink/[0.04] active:bg-ink/[0.07] focus-visible:bg-ink/[0.06]")}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
      <div aria-hidden="true" className="activity-sep pointer-events-none absolute right-3 bottom-0 left-[58px] h-px bg-ink/[0.08]" />
    </li>
  );
}
