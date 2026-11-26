"use client";

import { ChevronDown, ScrollText } from "lucide-react";
import { useState } from "react";

import { RecipeDiff } from "@/components/panel/recipe-diff";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { historyWhen } from "@/lib/prices/history";
import type { RecipeSnapshot } from "@/lib/recipe-change";
import { todayTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";

/** Ürün kartının reçete geçmişi satırı (src/server/data/recipe-versions.ts loadRecipeVersions) */
export interface RecipeHistoryRow {
  id: number;
  source: "edit" | "approval" | "create";
  before: RecipeSnapshot;
  after: RecipeSnapshot;
  summary: string;
  changedByName: string;
  requestedByName: string | null;
  at: string;
}

const SOURCE: Record<RecipeHistoryRow["source"], { label: string; tone: Tone }> = {
  edit: { label: "Ürün kartı", tone: "gray" },
  approval: { label: "Öneri onayı", tone: "coffee" },
  create: { label: "Yeni ürün", tone: "blue" },
};

/**
 * Ürün kartındaki "Reçete geçmişi" (docs/DONEM-KAPANISI.md › Reçete geçmişi): reçeteyi değiştiren her kayıt, yeniden
 * eskiye; kim, ne zaman, nereden ve tek satır özet. Satıra dokununca önce / sonra farkı açılır. Geçmiş bu özellik
 * geldikten sonraki değişikliklerle başlar.
 */
export function RecipeHistoryCard({ rows }: { rows: RecipeHistoryRow[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const today = todayTR();
  return (
    <Card>
      <CardHeader icon={<ScrollText />} title="Reçete geçmişi" />
      <CardContent>
        {rows.length ? (
          <ul className="divide-y divide-line-strong/70 rounded-2xl bg-surface px-4">
            {rows.map((r) => {
              const expanded = open === r.id;
              const src = SOURCE[r.source];
              return (
                <li key={r.id} className="py-2.5 text-sm">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : r.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-start justify-between gap-3 text-left pointer-coarse:min-h-11"
                  >
                    <span className="min-w-0">
                      <span className="block text-ink">{r.summary}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-mute">
                        <span className="tabular">{historyWhen(r.at, today)}</span>
                        <Badge tone={src.tone}>{src.label}</Badge>
                        <span>{r.changedByName}</span>
                        {r.requestedByName ? <span>· öneren {r.requestedByName}</span> : null}
                      </span>
                    </span>
                    <ChevronDown size={16} aria-hidden="true" className={cn("mt-0.5 shrink-0 text-ink-mute transition-transform", expanded && "rotate-180")} />
                  </button>
                  {expanded ? <RecipeDiff before={r.before} after={r.after} className="mt-2" /> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-mute">Reçete değişikliği kaydı yok. Bundan sonraki değişiklikler burada görünür.</p>
        )}
      </CardContent>
    </Card>
  );
}
