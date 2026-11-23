import { Store } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import type { BranchShareRow } from "@/lib/commission/report";
import { money, monthLabel, pct } from "@/lib/format";

/**
 * Şube seçiliyken şubenin payı (23 Kasım 2026; docs/KOMISYON.md › Şube): her kanalda şubenin satışı, işletmenin oranı
 * (bütün faturalar ÷ bütün şubelerin satışı) ve şubenin komisyon payı = satış × oran. Faturalar şubeye bölünmez.
 * `note`: şubenin markası belirsiz satışı (branchUnbrandedNote; paya girmez)
 */
export function BranchShareCard({ name, month, rows, note }: { name: string; month: string; rows: BranchShareRow[]; note?: string | null }) {
  return (
    <Card>
      <CardHeader icon={<Store />} title={`${name} payı`} description={`${monthLabel(month)} · şubenin satışı × işletmenin oranı`} />
      {rows.length ? (
        <ul className="mx-5 mb-5 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
          {rows.map((r) => (
            <li key={r.channel} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="min-w-0 font-medium text-ink">{r.label}</span>
              <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-ink-soft tabular">
                <span>Satış {r.sales !== null ? money(r.sales) : "bilinmiyor"}</span>
                <span>Oran {r.rate !== null ? pct(r.rate) : "–"}</span>
                <span className="font-medium text-ink">Pay {r.commission !== null ? money(r.commission) : "–"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-sm text-ink-mute">{monthLabel(month)} ayında bu şubede yemek kartı ya da platform satışı yok.</p>
      )}
      {note ? <p className="-mt-2 px-5 pb-5 text-[13px] leading-5 text-ink-mute">{note}</p> : null}
    </Card>
  );
}
