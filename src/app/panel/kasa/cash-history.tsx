"use client";

import { Camera, CalendarDays, ChevronLeft, ChevronRight, MessageCircle, Pencil, RotateCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Stat } from "@/components/ui/misc";
import { CASH_TOLERANCE, computeCash, diffKind, diffText, whatsappLink, whatsappText, type CashReportExtras } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { deleteCashReport, resendCashReportEmail } from "@/server/actions/cash-report";
import type { PhotoDiff } from "@/lib/photo-read/kasa";
import type { CashOutDTO } from "@/server/data/cash-outs";
import type { CashPhotoDTO } from "@/server/data/cash-photos";
import type { CashReportDTO } from "@/server/data/cash-reports";

import { SavedPhotos } from "./cash-photos";
import { CashBreakdown, DIFF_TONE, DiffHeadline } from "./cash-summary";

/** Raporların fotoğrafları (rapor kimliğine göre): fotoğraftan farklı yazılanlar, alarm sayılanlar, WhatsApp ekleri */
export type CashHistoryPhotos = Record<number, { photos: CashPhotoDTO[]; diffs: PhotoDiff[]; suspicious: PhotoDiff[]; extras: CashReportExtras }>;

export interface CashMonthTotals {
  zTotal: number;
  cash: number;
  card: number;
  /** Eksiklerin toplamı (pozitif) ve fazlaların toplamı */
  short: number;
  over: number;
  reported: number;
  days: number;
}

const shortDay = (date: string) => longDateTR(date).replace(/ (\S+) (\S+)$/, (_, m: string, d: string) => ` ${m.slice(0, 3)} ${d}`);

/**
 * Yöneticinin günden güne kasa görünümü: ayın her günü bir satır (rapor girilmeyen gün de görünür), kasa farkı renkli
 * rozet, kart farkı ve e-posta durumu küçük işaret. Satıra dokununca günün ayrıntısı: döküm, WhatsApp, düzenle, sil.
 */
export function CashHistory({
  monthLabel,
  prevHref,
  nextHref,
  days,
  totals,
  whatsappPhone,
  photos = {},
  cashOuts = {},
}: {
  monthLabel: string;
  prevHref: string | null;
  nextHref: string | null;
  days: { date: string; report: CashReportDTO | null }[];
  totals: CashMonthTotals;
  whatsappPhone: string | null;
  photos?: CashHistoryPhotos;
  /** Günlerin kasadan çıkanları (tarihe göre) */
  cashOuts?: Record<string, CashOutDTO[]>;
}) {
  const [open, setOpen] = useState<CashReportDTO | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const net = Math.round((totals.over - totals.short) * 100) / 100;

  function remove() {
    if (!open) return;
    start(async () => {
      const res = await deleteCashReport(open.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${longDateTR(open.date)} raporu silindi`);
      setConfirmDelete(false);
      setOpen(null);
    });
  }

  function resend() {
    if (!open) return;
    start(async () => {
      const res = await resendCashReportEmail(open.id);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.status === "sent") toast.success(`E-posta ${res.data.to} adrese gitti`);
      else toast.error(res.data.error ?? "E-posta gitmedi");
    });
  }

  const wa = open ? whatsappLink(whatsappText(open, { by: open.submittedByName, revision: open.revision, ...photos[open.id]?.extras }), whatsappPhone) : null;
  const openPhotos = open ? photos[open.id] : undefined;

  return (
    <Card>
      <CardHeader
        icon={<CalendarDays />}
        title="Günden güne"
        description="Her akşam personelin girdiği kasa raporu; dokununca ayrıntısı"
        actions={
          <div className="flex items-center gap-1">
            {prevHref ? (
              <ButtonLink href={prevHref} variant="ghost" size="icon-sm" aria-label="Önceki ay" scroll={false}>
                <ChevronLeft size={16} />
              </ButtonLink>
            ) : null}
            <span className="min-w-[7.5rem] text-center text-sm font-medium text-ink">{monthLabel}</span>
            {nextHref ? (
              <ButtonLink href={nextHref} variant="ghost" size="icon-sm" aria-label="Sonraki ay" scroll={false}>
                <ChevronRight size={16} />
              </ButtonLink>
            ) : null}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 px-5 pb-4 lg:grid-cols-4">
        <Stat label="Z toplamı" value={money(totals.zTotal)} sub={`Nakit ${money(totals.cash)} · kart ${money(totals.card)}`} compact />
        <Stat label="Kasa farkı (net)" value={Math.abs(net) < CASH_TOLERANCE ? "Tutuyor" : `${money(Math.abs(net))} ${net < 0 ? "eksik" : "fazla"}`} tone={net <= -CASH_TOLERANCE ? "bad" : net >= CASH_TOLERANCE ? "warn" : "good"} compact />
        <Stat label="Eksik / fazla" value={`${money(totals.short)} / ${money(totals.over)}`} sub="günlerin toplamı" compact />
        <Stat label="Rapor girilen gün" value={`${totals.reported} / ${totals.days}`} tone={totals.reported < totals.days ? "warn" : "default"} compact />
      </div>
      {days.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {days.map(({ date, report }) => {
            if (!report) {
              return (
                <li key={date} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="w-[7.5rem] shrink-0 font-medium text-ink-mute tabular">{shortDay(date)}</span>
                  <span className="min-w-0 flex-1 text-ink-mute">Rapor girilmedi</span>
                  <ButtonLink href={`/panel/kasa?gun=${date}`} variant="ghost" size="xs">
                    <Pencil size={13} /> Gir
                  </ButtonLink>
                </li>
              );
            }
            const c = computeCash(report);
            const cardOff = c.cardDiff !== null && Math.abs(c.cardDiff) >= CASH_TOLERANCE;
            const paymentsOff = Math.abs(c.paymentsDiff) >= CASH_TOLERANCE;
            return (
              <li key={date}>
                <button type="button" onClick={() => setOpen(report)} className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-panel/60">
                  <span className="w-[7.5rem] shrink-0 text-sm font-semibold text-ink tabular">{shortDay(date)}</span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium text-ink tabular">{money(report.zTotal)}</span>
                    <span className="text-ink-mute">
                      {" "}
                      · nakit {money(report.cash)} · kart {money(report.card)}
                    </span>
                    <span className="block text-xs text-ink-mute">
                      {report.submittedByName}
                      {report.revision > 1 ? " · güncellendi" : ""}
                      {report.emailStatus === "failed" ? " · e-posta gitmedi" : ""}
                      {report.note ? ` · ${report.note.slice(0, 60)}${report.note.length > 60 ? "…" : ""}` : ""}
                    </span>
                  </span>
                  <span className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {photos[report.id]?.photos.length ? <Camera size={14} className="text-ink-mute" aria-label="Fotoğraflı" role="img" /> : null}
                    {photos[report.id]?.suspicious.length ? <Badge tone="amber">Fotoğraftan farklı</Badge> : null}
                    {paymentsOff ? <Badge tone="amber">Z tutmuyor</Badge> : null}
                    {cardOff ? <Badge tone="amber">Kart {c.cardDiff! > 0 ? "+" : "−"}{money(Math.abs(c.cardDiff!))}</Badge> : null}
                    <Badge tone={DIFF_TONE[diffKind(report.cashDiff)]} dot>
                      {diffText(report.cashDiff)}
                    </Badge>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-line px-5 py-6 text-sm text-ink-mute">Bu ayda gün yok.</p>
      )}

      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? `${longDateTR(open.date)} kasa raporu` : ""}
        description={open ? `${open.submittedByName}${open.revision > 1 ? " · güncellendi" : ""}` : undefined}
        size="lg"
        footerStart={
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={pending} className="text-bad">
            <Trash2 size={15} /> Sil
          </Button>
        }
        footer={
          <>
            {open?.emailStatus === "failed" ? (
              <Button variant="secondary" onClick={resend} disabled={pending}>
                <RotateCw size={15} /> E-postayı yeniden gönder
              </Button>
            ) : null}
            {open ? (
              <ButtonLink href={`/panel/kasa?gun=${open.date}`} variant="secondary">
                <Pencil size={15} /> Düzenle
              </ButtonLink>
            ) : null}
            {wa ? (
              <a href={wa} target="_blank" rel="noopener noreferrer" className={buttonClass("accent")}>
                <MessageCircle size={16} /> WhatsApp
              </a>
            ) : null}
          </>
        }
      >
        {open ? (
          <div className="space-y-4">
            <DiffHeadline diff={open.cashDiff} />
            {open.emailStatus === "failed" ? <p className={cn("rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad")}>E-posta gitmedi: {open.emailError}</p> : null}
            {openPhotos ? <SavedPhotos photos={openPhotos.photos} diffs={openPhotos.diffs} admin /> : null}
            <CashBreakdown report={open} cashOuts={cashOuts[open.date] ?? []} />
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        pending={pending}
        title={open ? `${longDateTR(open.date)} raporu silinsin mi?` : "Rapor silinsin mi?"}
        description="Rapor ve günün kasa farkı listeden kalkar; personel o günü yeniden girebilir. Gönderilmiş e-posta geri alınmaz."
        confirmLabel="Sil"
      />
    </Card>
  );
}
