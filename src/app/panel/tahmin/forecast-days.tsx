import { CalendarRange, ChevronDown, Cloud, CloudRain, CloudSun, Sun, ThermometerSun, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { WEEKDAY_SHORT } from "@/lib/forecast/calendar";
import type { ForecastDay } from "@/lib/forecast/model";
import { staffFor } from "@/lib/forecast/staffing";
import { approx, dayTitle, explainLines, levelLabel, reasonChips, stampTR } from "@/lib/forecast/text";
import { weatherIcon, weatherText } from "@/lib/forecast/weather";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { morningSnapshot, type ForecastPageData } from "@/server/forecast/load";

import { LEVEL_TONE } from "./level-tone";
import { AddSpecialDayButton } from "./special-days";

const ICONS = { rain: CloudRain, sun: Sun, cloudsun: CloudSun, cloud: Cloud, hot: ThermometerSun } as const;

function WeatherBit({ day }: { day: ForecastDay }) {
  const icon = weatherIcon(day.weather);
  const Icon = icon ? ICONS[icon] : null;
  return (
    <span className="inline-flex items-center gap-1">
      {Icon ? <Icon size={14} aria-hidden="true" className="shrink-0" /> : null}
      {weatherText(day.weather)}
    </span>
  );
}

/** Kartın alt notu: hava durumunun kaynağı (CC BY 4.0) ve durumu */
function WeatherFooter({ data }: { data: ForecastPageData }) {
  if (!data.settings.weather) return <>Hava durumu kullanılmıyor (Tahmin ayarları).</>;
  const st = data.weatherState;
  const used = data.forecast.days.some((d) => d.weather);
  const failed = st?.error && (!st.fetchedAt || (st.errorAt ?? "") > st.fetchedAt);
  const credit = (
    <>
      Hava durumu: MET Norway (Norveç Meteoroloji Enstitüsü) verisi, CC BY 4.0{st?.fetchedAt ? ` · son alınış ${stampTR(st.fetchedAt)}` : ""} ·{" "}
      <a href="https://api.met.no/" target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">
        api.met.no
      </a>
    </>
  );
  if (failed && !used) return <>Hava durumu alınamadı ({st!.error}); tahmin havasız hesaplandı.</>;
  if (failed) return <>Bu sabah hava durumu alınamadı ({st!.error}); son alınan kullanıldı. {credit}</>;
  if (!st?.fetchedAt || !used) return <>Hava durumu henüz alınmadı; her sabah 08:00–09:00 arasında alınır.</>;
  return credit;
}

/** Kart "Önümüzdeki 7 gün": gün gün tahmin; satıra dokununca "Nasıl hesaplandı" */
export function ForecastDays({ data }: { data: ForecastPageData }) {
  const f = data.forecast;
  return (
    <Card>
      <CardHeader icon={<CalendarRange />} title="Önümüzdeki 7 gün" description="Z toplamı, KDV dahil · laffogato.net online hariç" />
      <ol className="mx-3 mb-4 space-y-1.5 sm:mx-5">
        {f.days.map((d, i) => {
          const staff = staffFor(d, data.settings);
          const chips = reasonChips(d);
          const desserts = data.plan && !d.closed ? data.plan.perDay[i] : null;
          const lines = explainLines(d, { forecast: f, settings: data.settings, roster: data.roster, mix: data.mix, desserts, snapshot: morningSnapshot(data.snapshots, d.date) });
          return (
            <li key={d.date} id={`gun-${d.date}`} className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-4">
              <details className="group rounded-2xl bg-surface ring-1 ring-line">
                <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-2xl px-3 py-3 select-none hover:bg-ink/[0.02] focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none sm:px-4 [&::-webkit-details-marker]:hidden">
                  <span
                    className={cn(
                      "flex w-11 shrink-0 flex-col items-center overflow-hidden rounded-[10px] border text-center",
                      d.offset === 0 ? "border-ink" : "border-line-strong",
                    )}
                    aria-hidden="true"
                  >
                    <span className={cn("w-full text-[10px] leading-[14px] font-semibold", d.offset === 0 ? "bg-ink text-white" : "bg-panel text-ink-mute")}>{WEEKDAY_SHORT[d.weekday]}</span>
                    <span className="text-lg leading-[26px] font-semibold text-ink tabular">{Number(d.date.slice(8, 10))}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-5 font-semibold text-ink">{dayTitle(d.date, d.offset)}</span>
                    {chips.length ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {/* Aynı adla iki özel gün aynı yazıyı verir: anahtar sıra */}
                        {chips.map((c, i) => (
                          <Badge key={`${i}-${c}`} tone="gray" className="whitespace-normal">
                            {c}
                          </Badge>
                        ))}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-mute">
                      {data.settings.weather ? <WeatherBit day={d} /> : null}
                      {!d.closed ? (
                        <span className="inline-flex items-center gap-1">
                          <Users size={14} aria-hidden="true" className="shrink-0" />
                          {staff.count} kişi{staff.ifBusy ? ` · yoğunsa ${staff.ifBusy}` : ""}
                        </span>
                      ) : null}
                      {desserts !== null ? <span>≈ {desserts} tatlı</span> : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                    {d.closed ? (
                      <span className="text-[15px] font-semibold text-ink">Kapalı</span>
                    ) : (
                      <>
                        <span className="text-[15px] leading-5 font-semibold whitespace-nowrap text-ink tabular">{approx(d.amount)}</span>
                        <span className="text-xs whitespace-nowrap text-ink-mute tabular">
                          {num(d.low)}–{num(d.high)}
                        </span>
                      </>
                    )}
                    <Badge tone={LEVEL_TONE[d.level]} dot={d.level !== "kapali"}>
                      {d.closed ? d.closed.title : levelLabel(d.level)}
                    </Badge>
                    <ChevronDown size={16} aria-hidden="true" className="text-ink-quiet transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="border-t border-line px-3 pt-2.5 pb-2 sm:px-4">
                  <p className="text-[13px] font-medium text-ink-soft">Nasıl hesaplandı</p>
                  <ul className="mt-1 space-y-1 text-[13px] leading-5 text-ink-mute">
                    {lines.map((l, i) => (
                      <li key={`${i}-${l}`}>{l}</li>
                    ))}
                  </ul>
                  <div className="mt-1.5">
                    <AddSpecialDayButton date={d.date} />
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      <CardFooter className="text-xs">
        <span className="min-w-0">
          <WeatherFooter data={data} />
        </span>
      </CardFooter>
    </Card>
  );
}
