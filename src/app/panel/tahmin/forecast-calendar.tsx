import { CalendarDays, ChevronDown } from "lucide-react";

import { Card } from "@/components/ui/card";
import { rangeTR } from "@/lib/forecast/calendar";
import { factorTable } from "@/lib/forecast/text";
import type { ForecastPageData } from "@/server/forecast/load";

/** Önümüzdeki 60 günden en çok bu kadar kayıt */
const UPCOMING_SHOWN = 6;

/** Kart "Takvim ve etkiler" (kapalı açılır): varsayılan etkiler, hafta günü payları ve önümüzdeki 60 günün takvimi */
export function ForecastCalendar({ data }: { data: ForecastPageData }) {
  const rows = factorTable(data.forecast);
  const upcoming = data.upcoming.slice(0, UPCOMING_SHOWN);
  return (
    <Card>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-3xl px-5 py-4 select-none focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]">
            <CalendarDays />
          </span>
          <span className="min-w-0 flex-1 text-base font-semibold tracking-tight text-ink">Takvim ve etkiler</span>
          <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-ink-quiet transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 px-5 pb-5">
          <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
            <table className="w-full text-left text-[13px]">
              <thead className="text-ink-mute">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Gün</th>
                  <th className="px-3 py-2 font-medium">Etkisi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.label} className="align-top">
                    <td className="px-3 py-2 text-ink-soft">
                      {r.label}
                      {/* Dayanağı: takvim ve hava etkileri varsayılan (dipnotta), hafta günü payları kendi verinizden olabilir */}
                      {r.basis !== "varsayılan" ? <span className="block text-xs text-ink-mute">{r.basis}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-ink tabular">{r.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-[13px] font-medium text-ink-soft">Önümüzdeki 60 gün</p>
            {upcoming.length ? (
              <ul className="mt-1 space-y-0.5 text-[13px] text-ink-mute">
                {upcoming.map((u) => (
                  <li key={`${u.from}-${u.name}`}>
                    {rangeTR(u.from, u.to)} · {u.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-ink-mute">Tatil, bayram ya da okul tatili yok.</p>
            )}
          </div>
          <p className="text-xs leading-5 text-ink-mute">
            Resmî tatiller ve bayramlar 2028 sonuna, okul tatilleri 2026–2027 öğretim yılına kadar tabloda (Diyanet dinî günler takvimi, MEB çalışma takvimi; 2027
            yaz tatilinin bitişi tahmini). Etkiler şimdilik varsayılan; kendi veriniz biriktikçe hafta günü payları ve son 2 haftanın eğilimi kendi raporlarınızdan
            gelir. Hafta içi resmî tatil, arife ve okul tatili hafta sonuna düşerse etkisi yoktur.
          </p>
        </div>
      </details>
    </Card>
  );
}
