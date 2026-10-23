import { CalendarRange, ChevronDown } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { GrowthPill, KeyValue } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { monthLabel, num, tl } from "@/lib/format";
import { hasActivity, occupancyDelta, type Coverage, type MonthRow } from "@/lib/karaoke/occupancy";
import { longDayText, percentText, pointsText, pointsValue } from "@/lib/karaoke/occupancy-text";
import { addDays, dayMonthTR } from "@/lib/reminders";

/** Doluluğun puan farkı rozeti (Doluluk kartı ve ay ay): rengi metinle aynı yuvarlamadan, "aynı" yazan rozet gri */
export function PointsPill({ delta }: { delta: number }) {
  return <GrowthPill value={pointsValue(delta)}>{pointsText(delta)}</GrowthPill>;
}

/** Ayın satırındaki metinler (ay boşsa "–"); doluluk farkı bir eski satıra göre, yalnız karşılaştırılabilirse */
function cells(r: MonthRow, older: MonthRow | undefined, coverage: Coverage) {
  const s = r.summary;
  const sessions = s.sessions.site + s.sessions.panel;
  const has = hasActivity(s);
  const dash = "–";
  const delta = has && older ? occupancyDelta(r, older, coverage) : null;
  const hours = s.occupiedMin / 60;
  return {
    has,
    ratio: has ? s.ratio : null,
    occupancy: has && s.ratio !== null ? percentText(s.ratio) : dash,
    delta,
    hours: has ? num(hours, hours > 0 && hours < 10 ? 1 : 0) : dash,
    sessions: has ? `${sessions} (${s.sessions.site} rez.)` : dash,
    sessionsLong: has ? `${s.sessions.site} rezervasyon · ${s.sessions.panel} rezervasyonsuz` : dash,
    perHour: has && s.revenue.perHour !== null ? tl(s.revenue.perHour / 100) : dash,
    extension: has && s.extension.rate !== null ? percentText(s.extension.rate) : dash,
    late: has && s.cancellations.lateRate !== null ? percentText(s.cancellations.lateRate) : dash,
    lead: has && s.lead.avgDays !== null ? `${num(s.lead.avgDays, 1)} gün` : dash,
    guests: has && s.guests.avg !== null ? num(s.guests.avg, 1) : dash,
  };
}

/** İçinde bulunulan ayın günleri: "1–21" (masaüstü) ya da "1–21 Ekim" (telefon) */
function partialSpan(r: MonthRow, withMonth: boolean): string | null {
  if (!r.period.partial) return null;
  if (r.period.days === 0) return "tamamlanmış gün yok";
  const last = addDays(r.period.to, -1);
  const first = Number(r.period.from.slice(8));
  if (r.period.days === 1) return withMonth ? dayMonthTR(r.period.from) : String(first);
  return withMonth ? `${first}–${dayMonthTR(last)}` : `${first}–${Number(last.slice(8))}`;
}

/** Doluluğun altındaki ince çubuk: sütun bir çubuk grafiği gibi okunur */
function Bar({ ratio }: { ratio: number | null }) {
  if (ratio === null) return null;
  return (
    <span aria-hidden="true" className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-ink/[.08]">
      <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </span>
  );
}

/**
 * "Ay ay": son 6 ay, en yeni başta (içinde bulunulan ay dünkü güne kadar), ilk veri ayından eskiye gitmez. Geniş
 * ekranda tablo, daha darda ay başına açılır satır (en yenisi açık).
 */
export function MonthCompare({ rows, coverage }: { rows: MonthRow[]; coverage: Coverage }) {
  const marked = rows.some((r) => r.beforeTimers);
  const view = rows.map((r, i) => ({ r, c: cells(r, rows[i + 1], coverage) }));
  return (
    <Card>
      <CardHeader icon={<CalendarRange />} title="Ay ay" description="Son 6 ay; içinde bulunulan ay dünkü güne kadar." />

      {/* Geniş ekran (xl ve üstü; dokuz sütun daha darda sığmaz): uzun başlıklar iki satıra iner */}
      <TableWrap className="hidden xl:block">
        <Table>
          <THead>
            <tr>
              <TH>Ay</TH>
              <TH numeric>Doluluk</TH>
              <TH numeric className="whitespace-normal">Dolu saat</TH>
              <TH numeric>Oturum</TH>
              <TH numeric className="whitespace-normal">Saat başına</TH>
              <TH numeric>Uzatma</TH>
              <TH numeric className="whitespace-normal">Son dakika iptal</TH>
              <TH numeric className="whitespace-normal">Kaç gün önceden</TH>
              <TH numeric className="whitespace-normal">Ort. kişi</TH>
            </tr>
          </THead>
          <tbody>
            {view.map(({ r, c }) => (
              <TR key={r.month}>
                <TD className="whitespace-nowrap">
                  {monthLabel(r.month)}
                  {r.beforeTimers ? <sup className="ml-0.5 text-ink-mute">¹</sup> : null}
                  {partialSpan(r, false) ? <span className="ml-1.5 text-[13px] text-ink-mute">({partialSpan(r, false)})</span> : null}
                </TD>
                <TD numeric>
                  <span className="inline-flex flex-col items-end">
                    <span className="inline-flex items-center gap-1.5">
                      {c.delta !== null ? <PointsPill delta={c.delta} /> : null}
                      {c.occupancy}
                    </span>
                    <span className="w-16">
                      <Bar ratio={c.ratio} />
                    </span>
                  </span>
                </TD>
                <TD numeric>{c.hours}</TD>
                <TD numeric>{c.sessions}</TD>
                <TD numeric>{c.perHour}</TD>
                <TD numeric>{c.extension}</TD>
                <TD numeric>{c.late}</TD>
                <TD numeric>{c.lead}</TD>
                <TD numeric>{c.guests}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {/* Telefon, tablet ve dar masaüstü: ay başına açılır satır */}
      <div className="space-y-2 px-5 pb-5 xl:hidden">
        {view.map(({ r, c }, i) => (
          <details key={r.month} open={i === 0 || undefined} className="group rounded-2xl bg-surface ring-1 ring-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 select-none">
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium text-ink">
                  {monthLabel(r.month)}
                  {r.beforeTimers ? <sup className="ml-0.5 text-ink-mute">¹</sup> : null}
                </span>
                {partialSpan(r, true) ? <span className="ml-1.5 text-[13px] text-ink-mute">{partialSpan(r, true)}</span> : null}
              </span>
              {c.delta !== null ? <PointsPill delta={c.delta} /> : null}
              <span className="text-sm font-semibold text-ink tabular">{c.occupancy}</span>
              <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-ink-quiet transition-transform group-open:rotate-180" />
            </summary>
            <div className="divide-y divide-line border-t border-line px-4">
              <KeyValue label="Dolu saat" value={c.hours} />
              <KeyValue label="Oturum" value={c.sessionsLong} />
              <KeyValue label="Saat başına gelir" value={c.perHour} />
              <KeyValue label="Uzatma" value={c.extension} />
              <KeyValue label="Son dakika iptal" value={c.late} />
              <KeyValue label="Kaç gün önceden" value={c.lead} />
              <KeyValue label="Ortalama kişi" value={c.guests} />
            </div>
          </details>
        ))}
      </div>

      {marked && coverage.timerSince ? (
        <p className="px-5 pb-5 text-xs leading-5 text-ink-mute">
          ¹ Rezervasyonsuz oturumlar {longDayText(coverage.timerSince)} itibarıyla sayılıyor; önceki aylarda yalnız site rezervasyonları var. Doluluk
          farkı yalnız aynı verinin sayıldığı aylar arasında gösterilir.
        </p>
      ) : null}
    </Card>
  );
}
