import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  excel,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Excel'deki karşılık gelen sayfa */
  excel?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {excel ? (
          <p className="mb-1 text-xs font-medium tracking-wide text-coffee-400 uppercase">Excel: {excel}</p>
        ) : null}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-coffee-950 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm text-coffee-600">{description}</p> : null}
      </div>
      {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
