import { Children, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { EmptyIllustration } from "./empty-illustration";
import { InfoTip } from "./info-tip";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-panel", className)} />;
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[108px] rounded-2xl" />
        ))}
      </div>
      <div className="space-y-2.5 rounded-3xl bg-panel p-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-xl bg-surface/70" />
        ))}
      </div>
    </div>
  );
}

/**
 * AkmanOS "Empty State": yüzen kayıt kartı yığını, başlık, açıklama, eylem.
 * (src/components/akmanos/empty-state; buradaki sürüm eylemi ReactNode olarak alır.)
 */
export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div data-component="empty-state" role="status" className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 py-10 text-center">
      {icon ? (
        <span className="flex size-14 items-center justify-center rounded-2xl bg-surface text-ink-mute shadow-[0_0_0_1px_rgb(0_0_0/0.08)] [&>svg]:size-6">
          {icon}
        </span>
      ) : (
        <EmptyIllustration />
      )}
      <div className="flex max-w-[22rem] flex-col gap-2">
        <p className="text-lg font-semibold tracking-tight text-balance text-ink">{title}</p>
        {description ? <p className="text-sm leading-relaxed text-pretty text-ink-mute">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export { InfoTip } from "./info-tip";

/**
 * Noktayla ayrılan satır içi bilgiler ("8 gün kaldı · Hatırlatıcı"). Satır sarılınca nokta satır sonunda asılı
 * kalmaz: her öğenin önündeki nokta satır başına düşerse kabın solunda kırpılır. Boş (null) öğeler atlanır.
 */
export function DotList({ children, className, itemClassName }: { children: ReactNode; className?: string; itemClassName?: string }) {
  const items = Children.toArray(children);
  return (
    <span className={cn("flex min-w-0 overflow-hidden", className)}>
      <span className="-ml-4 flex min-w-0 flex-wrap items-center gap-y-1">
        {items.map((item, i) => (
          <span key={i} className={cn("inline-flex min-w-0 items-center", itemClassName)}>
            <span aria-hidden="true" className="w-4 shrink-0 text-center text-ink-quiet">
              ·
            </span>
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}

const STAT_TONE = {
  default: "text-ink",
  good: "text-good",
  bad: "text-bad",
  warn: "text-warn",
} as const;

/** AkmanOS büyüme rozeti: olumlu limon, olumsuz kırmızı, nötr gri */
export function GrowthPill({ value, children }: { value: number; children?: ReactNode }) {
  const neutral = Math.abs(value) < 0.0005;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular",
        neutral ? "bg-surface text-ink-mute" : value > 0 ? "bg-lime text-good-ink" : "bg-bad-soft text-bad",
      )}
    >
      {children}
    </span>
  );
}

/**
 * AkmanOS "Statistic Cards" karosu: kenarlıklı beyaz ikon kutusu, etiket, büyük rakam, (isteğe bağlı) büyüme rozeti.
 * `children` verilirse rakamın altına (ör. ilerleme çubuğu) eklenir. `compact`: telefonda (sm altı) iki sütunlu
 * karo ızgaraları için daha sıkı iç boşluk.
 */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
  icon,
  info,
  infoTone,
  className,
  children,
  badge,
  suffix,
  compact,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: keyof typeof STAT_TONE;
  icon?: ReactNode;
  info?: ReactNode;
  /** Açıklama bir uyarı söylüyor: ⓘ yerine turuncu üçgen ("Dikkat") */
  infoTone?: "warn";
  className?: string;
  children?: ReactNode;
  /** Rakamın yanındaki küçük rozet (GrowthPill ya da Badge) */
  badge?: ReactNode;
  /** Rakamdan sonra küçük birim/ek, ör. "adet" */
  suffix?: ReactNode;
  /** Telefonda sıkı karo (iki sütunlu ızgaralar) */
  compact?: boolean;
}) {
  return (
    <div data-component="statistic-cards" className={cn("flex flex-col gap-3 rounded-2xl bg-panel p-3.5", compact && "max-sm:gap-2 max-sm:p-3", className)}>
      {icon ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]">
          {icon}
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        {/* data-stat-label: ızgara etiketlere ortak en az yükseklik verebilsin (Genel bakış KPI_LABELS) */}
        <p data-stat-label="" className="flex min-w-0 items-start gap-1.5 text-sm leading-5 text-pretty text-ink-mute">
          <span className="min-w-0">{label}</span>
          {info ? <InfoTip text={info} tone={infoTone} className="mt-0.5" /> : null}
        </p>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn("text-xl font-semibold tracking-tight tabular sm:text-2xl", STAT_TONE[tone])}>{value}</span>
          {suffix ? <span className="text-sm text-ink-mute">{suffix}</span> : null}
          {badge}
        </div>
        {sub ? <div className="text-xs leading-5 text-ink-mute">{sub}</div> : null}
      </div>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function Progress({
  value,
  tone = "ink",
  className,
}: {
  value: number;
  tone?: "coffee" | "green" | "amber" | "red" | "ink";
  className?: string;
}) {
  const color = { coffee: "bg-brass-500", green: "bg-good", amber: "bg-brass-500", red: "bg-bad", ink: "bg-ink" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-panel-deep", className)}>
      <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

/** Negatif değerleri kırmızı gösteren tutar */
export function Signed({ value, children, className }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  return <span className={cn("tabular", className, value !== null && value !== undefined && value < 0 && "text-bad")}>{children}</span>;
}

/** Bölüm başlığı (kart dışı, sayfa içi gruplama) */
export function SectionTitle({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <h2 className="text-lg font-semibold tracking-tight text-ink">{children}</h2>
      {actions}
    </div>
  );
}

/** Anahtar-değer satırı (özet listeleri için) */
export function KeyValue({ label, value, className, strong }: { label: ReactNode; value: ReactNode; className?: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2 text-sm", strong && "font-semibold", className)}>
      <span className={strong ? "text-ink" : "text-ink-mute"}>{label}</span>
      <span className="text-right text-ink tabular">{value}</span>
    </div>
  );
}

/**
 * AkmanOS "System Status Page" çubuk şeridi: her parça bir dönem (ör. yılın 12 ayı).
 * Renk tek başına anlam taşımaz: her parçanın `label`'ı ipucu ve ekran okuyucu metnidir.
 */
export function SegmentStrip({
  segments,
  className,
  activeKey,
  showLabels,
}: {
  /** `short` alt etiket (ör. "Eyl"), `label` ipucu ve ekran okuyucu metni */
  segments: { key: string; tone: "good" | "bad" | "warn" | "empty"; label: string; short?: string }[];
  className?: string;
  /** Vurgulanan dönem (seçili ay) */
  activeKey?: string;
  /** Çubukların altına kısa etiketleri yaz */
  showLabels?: boolean;
}) {
  const color = { good: "bg-[#22c55e]", bad: "bg-[#ef4444]", warn: "bg-[#eab308]", empty: "bg-panel-deep" };
  return (
    <div data-component="system-status-page" className={className}>
      <ul className="flex h-8 gap-[3px]">
        {segments.map((s) => (
          <li
            key={s.key}
            title={s.label}
            className={cn(
              "flex-1 rounded-[3px] transition-opacity hover:opacity-75",
              color[s.tone],
              activeKey === s.key && "ring-2 ring-ink ring-offset-2 ring-offset-panel",
            )}
          >
            <span className="sr-only">{s.label}</span>
          </li>
        ))}
      </ul>
      {showLabels ? (
        <div className="mt-1.5 flex gap-[3px]" aria-hidden="true">
          {segments.map((s) => (
            <span key={s.key} className={cn("flex-1 truncate text-center text-[10px] text-ink-mute", activeKey === s.key && "font-semibold text-ink")}>
              {s.short ?? ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
