import type { ReactNode } from "react";

import { LafTile } from "@/components/brand";

/** Giriş kartıyla aynı görünüm: zinc-100 kart, L'Af karosu, başlık */
export function InviteCard({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full rounded-3xl bg-chart-card-bg p-5 sm:p-6">
      <header className="mb-5 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-chart-metric-bg" aria-hidden>
          <LafTile className="size-8 rounded-[10px]" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-pretty text-foreground">{title}</h1>
          <p className="text-sm text-chart-muted">{subtitle}</p>
        </div>
      </header>
      {children}
    </div>
  );
}
