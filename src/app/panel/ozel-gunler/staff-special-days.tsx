"use client";

import { CalendarHeart, CalendarPlus, DoorClosed } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { stampTR } from "@/lib/cash-report";
import { staffSpecialLine } from "@/lib/closed-days";
import { shortDateTR, shortRangeTR } from "@/lib/takvim";
import { specialTail } from "@/lib/ozel-gun";
import { STATUS_LABEL, type StaffRequestStatus } from "@/lib/staff-requests";
import { cn } from "@/lib/utils";
import type { StaffSpecialRow } from "@/server/staff-special";

import { SpecialDayProvider, useSpecialDay, type SpecialDayActions } from "./special-days";

/*
 * Personelin özel günleri (/panel/ozel-gunler; docs/SATIS-TAHMINI.md › Personelin özel günleri): "Yaklaşan" listesi
 * (bugün ile 60 gün), kişinin kendi girdiği, başlamamış ve yöneticinin dokunmadığı satır dokunulabilir; pencere Satış
 * tahmini'ninki (`mode="staff"`, eylemler sayfadan). Altta "Kapalı gün bildirimlerim" (son 30 gün).
 */

const TONE: Partial<Record<StaffRequestStatus, "amber" | "green" | "red" | "gray">> = { pending: "amber", approved: "green", rejected: "red", revoked: "gray", superseded: "gray", withdrawn: "gray" };

export function StaffSpecialDays({
  rows,
  closed,
  today,
  minDate,
  maxDate,
  saveAction,
  deleteAction,
}: {
  rows: StaffSpecialRow[];
  closed: { id: number; day: string; status: StaffRequestStatus; reviewNote: string | null; createdAt: string }[];
  today: string;
  minDate: string;
  maxDate: string;
} & SpecialDayActions) {
  return (
    <SpecialDayProvider today={today} minDate={minDate} maxDate={maxDate} mode="staff" saveAction={saveAction} deleteAction={deleteAction}>
      <div className="space-y-4">
        <Upcoming rows={rows} />
        <Card id="bildirimlerim" className="scroll-mt-24">
          <CardHeader icon={<DoorClosed />} title="Kapalı gün bildirimlerim" description="Son 30 gün. Dün kafe kapalıysa kasa raporunun dün sayfasından bildirin." />
          {closed.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {closed.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 basis-40 font-medium text-ink">{shortDateTR(c.day)}</span>
                  <Badge tone={TONE[c.status] ?? "gray"} dot>
                    {STATUS_LABEL[c.status]}
                  </Badge>
                  <span className="text-[13px] text-ink-mute tabular">{stampTR(c.createdAt)}</span>
                  {c.reviewNote ? <p className="w-full text-[13px] break-words text-ink-soft">{c.reviewNote}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-line px-5 py-4 text-sm text-ink-mute">Son 30 günde kapalı gün bildirmediniz.</p>
          )}
        </Card>
      </div>
    </SpecialDayProvider>
  );
}

function Upcoming({ rows }: { rows: StaffSpecialRow[] }) {
  const { openNew, openEdit } = useSpecialDay();
  return (
    <Card>
      <CardHeader icon={<CalendarHeart />} title="Yaklaşan" description="Bugünden 60 gün ileriye. Yarından itibaren en çok 3 günlük maç, AVM etkinliği ya da kampanya ekleyebilirsiniz." />
      <CardContent className="space-y-3">
        {rows.length ? (
          <ul className="-mx-1 rounded-2xl bg-surface p-1 ring-1 ring-line">
            {rows.map((r) => {
              const line = staffSpecialLine(shortRangeTR(r.dateFrom, r.dateTo), specialTail(r), r.addedBy);
              const inner = (
                <>
                  <span className="text-sm font-medium break-words text-ink">{r.title}</span>
                  <span className="min-w-0 text-[13px] break-words text-ink-mute">{line}</span>
                </>
              );
              return (
                <li key={r.id}>
                  {r.editable ? (
                    <button
                      type="button"
                      onClick={() => openEdit({ id: r.id, kind: r.kind, title: r.title, dateFrom: r.dateFrom, dateTo: r.dateTo, effect: r.effect, note: r.note })}
                      className={cn("flex min-h-11 w-full cursor-pointer flex-col items-start rounded-xl px-3 py-2 text-left transition-colors hover:bg-ink/[0.04] focus-visible:bg-ink/[0.06] focus-visible:outline-none")}
                      aria-label={`${r.title}, ${shortRangeTR(r.dateFrom, r.dateTo)}: düzenle`}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className="flex min-h-11 w-full flex-col items-start px-3 py-2">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-mute">Yaklaşan özel gün yok. Maç, AVM etkinliği ya da kampanya olacaksa ekleyin.</p>
        )}
        <Button variant="secondary" size="sm" onClick={() => openNew()}>
          <CalendarPlus size={15} aria-hidden="true" />
          Özel gün ekle
        </Button>
      </CardContent>
    </Card>
  );
}
