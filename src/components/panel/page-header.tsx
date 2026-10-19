import type { ReactNode } from "react";

/**
 * Sayfa başlığı: üstte küçük bağlam satırı (bölüm · Excel karşılığı), Gabarito başlık, kısa açıklama,
 * sağda eylemler. `tabs` verilirse başlığın altına bölüm sekmeleri gelir.
 */
export function PageHeader({
  title,
  description,
  actions,
  excel,
  eyebrow,
  tabs,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Excel'deki karşılık gelen sayfa */
  excel?: string;
  /** Bağlam satırı, ör. "Menü" */
  eyebrow?: string;
  tabs?: ReactNode;
}) {
  const context = [eyebrow, excel ? `Excel: ${excel}` : null].filter(Boolean);
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {context.length ? (
            <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-mute">
              {context.map((c, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 ? <span className="text-ink-quiet">·</span> : null}
                  {c}
                </span>
              ))}
            </p>
          ) : null}
          <h1 className="text-2xl leading-8 font-semibold tracking-tight text-ink sm:text-[28px] sm:leading-9">{title}</h1>
          {description ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-mute">{description}</p> : null}
        </div>
        {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="no-print mt-5">{tabs}</div> : null}
    </header>
  );
}
