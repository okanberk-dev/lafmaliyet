"use client";

import { Camera, CalendarDays, ChevronLeft, ChevronRight, MessageCircle, Pencil, RotateCw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Stat } from "@/components/ui/misc";
import {
  CASH_TOLERANCE,
  computeCash,
  diffKind,
  diffText,
  historyOf,
  lastRevision,
  nextCheckOf,
  whatsappLink,
  whatsappText,
  type CarryCheck,
  type CashReportExtras,
  type CashRevisionRow,
} from "@/lib/cash-report";
import { money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { deleteCashReport, resendCashReportEmail } from "@/server/actions/cash-report";
import type { PhotoDiff } from "@/lib/photo-read/kasa";
import type { CashOutDTO } from "@/server/data/cash-outs";
import type { CashPhotoDTO } from "@/server/data/cash-photos";
import type { CashReportDTO } from "@/server/data/cash-reports";

import { SavedPhotos } from "./cash-photos";
import { CashRevisions } from "./cash-revisions";
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

/** "Sayan Ayşe · gönderen Mehmet"; aynı kişiyse ya da eski raporsa yalnız gönderen */
const whoOf = (r: CashReportDTO) => (r.countedByName && r.countedByName !== r.submittedByName ? `Sayan ${r.countedByName} · gönderen ${r.submittedByName}` : r.submittedByName);

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
  carry = {},
  revisions = {},
  proposedBy = {},
  lateApproved = {},
  latePending = {},
  monthLine = null,
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
  /** Açılışı önceki devirle tutmayan raporlar (denetlenen raporun gününe göre; sonraki ayın ilk raporu dahil) */
  carry?: Record<string, CarryCheck>;
  /** Raporların önceki sürümleri (rapor kimliğine göre) */
  revisions?: Record<number, CashRevisionRow[]>;
  /** Onaylanan düzeltme önerilerinin önerenleri (rapor ve sürüm kimliğine göre) */
  proposedBy?: Record<number, Record<number, string>>;
  /** Onaylanan geç raporlar (rapor kimliğine göre): "Ayşe 21 Ekim'de girdi · Mehmet 22 Ekim'de onayladı" */
  lateApproved?: Record<number, string>;
  /** Onay bekleyen geç raporlar (güne göre) */
  latePending?: Record<string, { id: number; requestedByName: string }[]>;
  /** Ayın açık gün ve cirosunun nereden geldiği (Satışlar'a bağlantı) */
  monthLine?: ReactNode;
}) {
  const [open, setOpen] = useState<CashReportDTO | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useActionTransition();
  const net = Math.round((totals.over - totals.short) * 100) / 100;
  const checks = Object.values(carry);
  /** İş günü kapandıktan sonra kasa alanı değiştirilerek düzeltilen rapor */
  const lateEdited = (r: CashReportDTO) => r.revision > 1 && historyOf(r, revisions[r.id] ?? []).entries.some((e) => e.late);
  const reported = days.flatMap((d) => (d.report ? [d.report] : []));
  const flags = { carry: reported.filter((r) => carry[r.date]).length, late: reported.filter(lateEdited).length };
  const flagText = [flags.carry ? `${flags.carry} gün açılış ≠ devir` : null, flags.late ? `${flags.late} sonradan düzeltme` : null].filter(Boolean).join(" · ");

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

  const openCarry = open ? (carry[open.date] ?? null) : null;
  const openNext = open ? nextCheckOf(checks, open.date) : null;
  const wa = open
    ? whatsappLink(
        whatsappText(open, {
          by: open.submittedByName,
          revision: open.revision,
          ...photos[open.id]?.extras,
          countedBy: open.countedByName,
          carry: openCarry,
          next: openNext,
          changes: lastRevision(open, revisions[open.id] ?? [])?.changes ?? null,
        }),
        whatsappPhone,
      )
    : null;
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
      {/* Kart geniş ekranda sayfanın üçte ikisi: dört kutu orada sığmaz, rakamlar satır kırar (2xl'de dört sütun) */}
      <div className="grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
        <Stat label="Z toplamı" value={money(totals.zTotal)} sub={`Nakit ${money(totals.cash)} · kart ${money(totals.card)}`} compact />
        {/* Rapor girilmeyen ayda yeşil "Tutuyor" yanlış güven verir */}
        <Stat
          label="Kasa farkı (net)"
          value={!totals.reported ? "Rapor yok" : Math.abs(net) < CASH_TOLERANCE ? "Tutuyor" : money(Math.abs(net))}
          sub={totals.reported && Math.abs(net) >= CASH_TOLERANCE ? (net < 0 ? "eksik" : "fazla") : undefined}
          tone={!totals.reported ? "default" : net <= -CASH_TOLERANCE ? "bad" : net >= CASH_TOLERANCE ? "warn" : "good"}
          compact
        />
        <Stat label="Eksik / fazla" value={`${money(totals.short)} / ${money(totals.over)}`} sub="günlerin toplamı" compact />
        <Stat
          label="Rapor girilen gün"
          value={`${totals.reported} / ${totals.days}`}
          tone={totals.reported < totals.days ? "warn" : "default"}
          sub={flagText ? <span className="text-warn">{flagText}</span> : null}
          compact
        />
      </div>
      {monthLine ? <p className="-mt-1 px-5 pb-4 text-[13px] leading-5 text-ink-mute">{monthLine}</p> : null}
      {days.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {days.map(({ date, report }) => {
            if (!report) {
              const waiting = latePending[date]?.[0];
              return (
                <li key={date} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                  <span className="w-[7.5rem] shrink-0 font-medium text-ink-mute tabular">{shortDay(date)}</span>
                  {waiting ? (
                    <>
                      <span className="min-w-0 flex-1 text-warn">Onay bekliyor · {waiting.requestedByName} girdi</span>
                      <ButtonLink href={`/panel/onaylar#istek-${waiting.id}`} variant="ghost" size="xs">
                        İncele
                      </ButtonLink>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-ink-mute">Rapor girilmedi</span>
                      <ButtonLink href={`/panel/kasa?gun=${date}`} variant="ghost" size="xs">
                        <Pencil size={13} /> Gir
                      </ButtonLink>
                    </>
                  )}
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
                  {/* En az 10rem: telefonda rozetler çoğalınca (açılış, düzeltme, fotoğraf) metin ezilmez, rozetler alt satıra iner */}
                  <span className="min-w-[10rem] flex-1 text-sm">
                    <span className="font-medium text-ink tabular">{money(report.zTotal)}</span>
                    <span className="text-ink-mute">
                      {" "}
                      · nakit {money(report.cash)} · kart {money(report.card)}
                    </span>
                    <span className="block text-xs text-ink-mute">
                      {whoOf(report)}
                      {report.revision > 1 ? ` · ${report.revision - 1} kez düzeltildi` : ""}
                      {lateApproved[report.id] ? ` · ${lateApproved[report.id]}` : ""}
                      {report.emailStatus === "failed" ? " · e-posta gitmedi" : ""}
                      {report.note ? ` · ${report.note.slice(0, 60)}${report.note.length > 60 ? "…" : ""}` : ""}
                    </span>
                  </span>
                  <span className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {photos[report.id]?.photos.length ? <Camera size={14} className="text-ink-mute" aria-label="Fotoğraflı" role="img" /> : null}
                    {lateApproved[report.id] ? <Badge tone="gray">Geç girildi</Badge> : null}
                    {photos[report.id]?.suspicious.length ? <Badge tone="amber">Fotoğraftan farklı</Badge> : null}
                    {carry[report.date] ? <Badge tone="amber">Açılış ≠ devir</Badge> : null}
                    {lateEdited(report) ? <Badge tone="amber">Ertesi gün düzeltildi</Badge> : null}
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
        description={open ? `${whoOf(open)}${open.revision > 1 ? ` · ${open.revision - 1} kez düzeltildi` : ""}` : undefined}
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
            <CashBreakdown report={open} cashOuts={cashOuts[open.date] ?? []} carry={openCarry} next={openNext} />
            <CashRevisions report={open} revisions={revisions[open.id] ?? []} proposedBy={proposedBy[open.id]} />
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
