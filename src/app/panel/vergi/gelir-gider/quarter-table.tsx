import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Explain } from "../ui";
import type { GridData, GridRow } from "./grid";

/*
 * Vergiye göre tablosu, masaüstü (md ve üstü; plan docs/planlar/vergi.md §4.2): satırlar yukarıda, sütunlar çeyreğin
 * ayları, çeyrek toplamı ve kümülatif. Gelir-gider'in kalıbı: yapışkan ilk sütun, kabın içinde yatay kayan tablo.
 * Satırların dökümü (kategori kategori) tablonun altında açılır.
 */

const STICKY = "sticky left-0 z-10 w-64 min-w-64 bg-panel pr-3 pl-5 shadow-[inset_-1px_0_0_var(--color-line-strong)] lg:w-72 lg:min-w-72";
const CELL = "px-3 py-2 text-right whitespace-nowrap tabular";
/** Çeyrek ve kümülatif sütunları hafif koyu */
const TOTAL_COL = "bg-ink/[0.03]";

const value = (v: number | null) => (v === null ? <span className="text-ink-quiet">–</span> : <span className={cn(v < 0 && "text-bad")}>{money(v)}</span>);

export function QuarterTable({ grid }: { grid: GridData }) {
  const months = grid.columns.length - 2;
  const withItems = grid.groups.flatMap((g) => g.rows.filter((r) => r.items.some((l) => l.length > 0)));
  return (
    <div className="max-md:hidden">
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={cn(STICKY, "z-20 border-b border-line-strong py-3 text-left font-semibold text-ink")}>
                Kalem
              </th>
              {grid.columns.map((c, i) => (
                <th key={c.key} scope="col" className={cn("border-b border-line-strong px-3 py-3 text-right align-bottom font-semibold whitespace-nowrap text-ink", i >= months && TOTAL_COL)}>
                  <span className="block">{c.label}</span>
                  {c.sub ? <span className="block text-xs font-normal text-ink-mute">{c.sub}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.groups.map((g) => (
              <Group key={g.key} label={g.label} rows={g.rows} months={months} />
            ))}
          </tbody>
        </table>
      </div>
      {withItems.length ? (
        <Explain title="Satırların dökümü" className="mx-5 mt-4">
          {withItems.map((r) => (
            <section key={r.key} aria-label={r.label}>
              <h3 className="mb-1.5 text-xs font-semibold text-ink-soft">{r.label}</h3>
              <div className="scroll-thin overflow-x-auto rounded-xl ring-1 ring-line">
                <table className="w-full border-collapse text-[13px]">
                  <tbody>
                    {itemLabels(r).map((label) => (
                      <tr key={label} className="border-b border-line last:border-0">
                        <th scope="row" className="px-3 py-1.5 text-left font-normal break-words text-ink-mute">
                          {label}
                        </th>
                        {r.items.map((list, i) => {
                          const x = list.find((y) => y.label === label);
                          return (
                            <td key={grid.columns[i].key} className={cn(CELL, "w-36 py-1.5", i >= months && TOTAL_COL)}>
                              {x ? value(x.amount) : <span className="text-ink-quiet">–</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </Explain>
      ) : null}
    </div>
  );
}

/** Dökümün kalemleri, ilk görüldükleri sırayla */
function itemLabels(r: GridRow): string[] {
  const out: string[] = [];
  for (const l of r.items) for (const x of l) if (!out.includes(x.label)) out.push(x.label);
  return out;
}

function Group({ label, rows, months }: { label: string; rows: GridRow[]; months: number }) {
  return (
    <>
      <tr>
        <th scope="rowgroup" colSpan={1} className={cn(STICKY, "pt-5 pb-2 text-left text-[13px] font-semibold text-ink-soft")}>
          {label}
        </th>
        <td colSpan={months + 2} />
      </tr>
      {rows.map((r) => (
        <tr key={r.key} className={cn("group transition-colors hover:bg-surface/60 [&>td]:border-t [&>td]:border-line [&>th]:border-t [&>th]:border-line", r.strong && "font-semibold")}>
          <th scope="row" className={cn(STICKY, "py-2 text-left align-top font-normal group-hover:bg-[color-mix(in_oklab,var(--color-panel),white_60%)]", r.strong ? "font-semibold text-ink" : "text-ink-soft")}>
            <span className={cn("block break-words", r.tone === "bad" && "text-bad")}>{r.label}</span>
            {r.badge ? (
              <Badge tone={r.badge.startsWith("Yönetim verisi") ? "amber" : r.badge.startsWith("mali belge") ? "green" : "gray"} className="mt-1 whitespace-normal">
                {r.badge}
              </Badge>
            ) : null}
            {r.note ? <span className="mt-0.5 block text-xs font-normal break-words text-ink-mute">{r.note}</span> : null}
          </th>
          {r.values.map((v, i) => (
            <td key={i} className={cn(CELL, "align-top", i >= months && TOTAL_COL)}>
              {value(v)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
