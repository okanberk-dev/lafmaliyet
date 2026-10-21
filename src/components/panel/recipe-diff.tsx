"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { diffRecipe, qtyLabel, type DiffRow, type RecipeSnapshot } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";

const ROW_TONE: Record<DiffRow["kind"], string> = {
  added: "bg-lime/15",
  removed: "bg-bad-soft/60",
  changed: "bg-warn-soft/60",
  same: "",
};

/**
 * Reçete farkı, satır satır: "Önce" öneri anındaki (ya da bugünkü) reçete, "Sonra" önerilen. Eklenen yeşil, çıkarılan
 * kırmızı ve üstü çizili, değişen sarı; değişmeyen satırlar istenince görünür. Renk tek başına anlam taşımaz, her
 * satırda rozet yazar. Hazırlama notu değiştiyse altta önce / sonra.
 */
export function RecipeDiff({ before, after, className }: { before: RecipeSnapshot; after: RecipeSnapshot; className?: string }) {
  const diff = diffRecipe(before, after);
  const [showSame, setShowSame] = useState(false);
  const same = diff.rows.filter((r) => r.kind === "same").length;
  const rows = showSame ? diff.rows : diff.rows.filter((r) => r.kind !== "same");
  return (
    <div className={cn("space-y-2", className)}>
      <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong text-left text-[13px] text-ink-soft">
              <th scope="col" className="px-3 py-2 font-semibold">
                Malzeme
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Önce
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Sonra
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr key={`${r.kind}-${r.key}`} className={cn("border-b border-line align-top last:border-0", ROW_TONE[r.kind])}>
                  <td className="px-3 py-2">
                    <span className={cn("font-medium break-words", r.kind === "removed" ? "text-bad line-through" : r.kind === "same" ? "text-ink-mute" : "text-ink")}>{r.name}</span>
                    {r.kind === "added" ? (
                      <Badge tone="green" className="ml-1.5">
                        Yeni
                      </Badge>
                    ) : r.kind === "removed" ? (
                      <Badge tone="red" className="ml-1.5">
                        Çıkarıldı
                      </Badge>
                    ) : r.kind === "changed" ? (
                      <Badge tone="amber" className="ml-1.5">
                        {r.qty ? "Miktar" : "Not"}
                      </Badge>
                    ) : null}
                    {r.kind === "changed" && r.note ? (
                      <span className="mt-1 block text-xs text-ink-mute">
                        Not: <span className="line-through">{r.before.note || "—"}</span> → <span className="text-ink-soft">{r.after.note || "—"}</span>
                      </span>
                    ) : (r.kind === "added" || r.kind === "same") && r.after.note ? (
                      <span className="mt-1 block text-xs text-ink-mute">Not: {r.after.note}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular text-ink-mute">
                    {r.kind === "added" ? "—" : <span className={cn(r.kind === "changed" && r.qty && "line-through")}>{qtyLabel(r.before)}</span>}
                  </td>
                  <td className={cn("px-3 py-2 text-right whitespace-nowrap tabular", r.kind === "same" ? "text-ink-mute" : "font-semibold text-ink")}>
                    {r.kind === "removed" ? "—" : qtyLabel(r.after)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-[13px] text-ink-mute">
                  {diff.empty ? "Malzemelerde değişiklik yok." : "Malzemeler aynı; yalnızca sıraları ya da not değişti."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {same ? (
        <button
          type="button"
          onClick={() => setShowSame((v) => !v)}
          aria-expanded={showSame}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-1 text-[13px] font-medium text-ink-mute hover:text-ink pointer-coarse:min-h-11"
        >
          <ChevronDown size={14} className={cn("transition-transform", showSame && "rotate-180")} aria-hidden="true" />
          {showSame ? "Değişmeyen satırları gizle" : `Değişmeyen ${same} satırı da göster`}
        </button>
      ) : null}
      {diff.note.changed ? (
        <div className="grid gap-2 rounded-2xl bg-surface p-3 text-[13px] ring-1 ring-line sm:grid-cols-2">
          <div>
            <p className="font-medium text-ink-soft">Hazırlama notu · önce</p>
            <p className="mt-0.5 break-words whitespace-pre-line text-ink-mute">{diff.note.before || "—"}</p>
          </div>
          <div>
            <p className="font-medium text-ink-soft">Hazırlama notu · sonra</p>
            <p className="mt-0.5 break-words whitespace-pre-line text-ink">{diff.note.after || "—"}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
