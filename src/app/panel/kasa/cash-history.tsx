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
  reportNo,
  whatsappLink,
  whatsappText,
  withCardExtra,
  type CarryCheck,
  type CashReportExtras,
  type CashRevisionRow,
} from "@/lib/cash-report";
import type { ModposDayView } from "@/lib/cash-modpos";
import { money } from "@/lib/format";
import { okcHasFigures, okcReconcile } from "@/lib/okc-z";
import { longDateTR } from "@/lib/reminders";
import { deleteCashReport, resendCashReportEmail } from "@/server/actions/cash-report";
import type { PhotoDiff } from "@/lib/photo-read/kasa";
import type { CashOutDTO } from "@/server/data/cash-outs";
import type { CashPhotoDTO } from "@/server/data/cash-photos";
import type { CashReportDTO } from "@/server/data/cash-reports";

import { DIFF_TONE, type OkcAdminView } from "./cash-summary";
import { ReportSheet } from "./report-sheet";

/** Raporların fotoğrafları (rapor kimliğine göre): fotoğraftan farklı yazılanlar, alarm sayılanlar, WhatsApp ekleri */
export type CashHistoryPhotos = Record<
  number,
  {
    photos: CashPhotoDTO[];
    diffs: PhotoDiff[];
    suspicious: PhotoDiff[];
    extras: CashReportExtras;
    /**
     * LafPOS gününün otomatik raporunda gün sonu fotoğrafı (gün sonu tam): LafPOS'tan farklı, bekleniyor, okunamadı ya da
     * kodla okunup güvenle seçilmedi (yönetici baksın)
     */
    lafposPhoto?: "fark" | "bekliyor" | "okunamadi" | "bakin" | null;
  }
>;

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
  okcAdmin = {},
  modposDays = {},
  okcFirst = null,
  okcLine = null,
  branch = null,
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
  /** Raporların yazarkasa kümülatifi ve "Kümülatifi temizle" (rapor kimliğine göre; docs/planlar/okc-z.md §3.7) */
  okcAdmin?: Record<number, OkcAdminView>;
  /**
   * ModPOS kasa föyü olan günler (tarihe göre; docs/MODPOS-API.md › Nerede görünür): "ModPOS'tan farklı" rozeti,
   * raporu girilmemiş günün föy cirosu ve gün ayrıntısındaki farklı yazılanlar. Yalnız yöneticinin sayfası verir
   */
  modposDays?: Record<string, ModposDayView>;
  /** İlk yazarkasa Z'li rapor: "Yazarkasa Z yok" rozeti bu günden sonra (D15) */
  okcFirst?: string | null;
  /** Ayın yazarkasa (mali) toplamı ve KDV dökümü (yalnız bilgi, §8) */
  okcLine?: string[] | null;
  /**
   * Birden çok şube açıkken kasanın şubesi (docs/SUBE.md › Kasa raporu): başlıkta adı, "Gir" ve "Düzenle" bağlantıları
   * `?sube=` taşır ki form o şubenin kasasında açılsın ("Tümü"de her şube kendi bölümünde)
   */
  branch?: { id: string; name: string } | null;
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
          branchName: branch?.name ?? null,
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
  const dayHref = (date: string) => `/panel/kasa?gun=${date}${branch ? `&sube=${encodeURIComponent(branch.id)}` : ""}`;

  return (
    <Card>
      <CardHeader
        icon={<CalendarDays />}
        title={branch ? `Günden güne · ${branch.name}` : "Günden güne"}
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
      {okcLine?.length ? (
        <div className="-mt-2 px-5 pb-4 text-[13px] leading-5 text-ink-mute">
          {okcLine.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
      ) : null}
      {days.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {days.map(({ date, report }) => {
            if (!report) {
              const waiting = latePending[date]?.[0];
              const sheet = modposDays[date];
              const sheetLine = sheet ? (
                <span className="block text-xs text-ink-mute tabular">
                  ModPOS API: ciro {money(sheet.zTotal)}
                  {sheet.open ? " (gün açıkken alındı)" : ""}
                </span>
              ) : null;
              return (
                <li key={date} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                  <span className="w-[7.5rem] shrink-0 font-medium text-ink-mute tabular">{shortDay(date)}</span>
                  {waiting ? (
                    <>
                      <span className="min-w-0 flex-1 text-warn">
                        Onay bekliyor · {waiting.requestedByName} girdi
                        {sheetLine}
                      </span>
                      <ButtonLink href={`/panel/onaylar#istek-${waiting.id}`} variant="ghost" size="xs">
                        İncele
                      </ButtonLink>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-ink-mute">
                        Rapor girilmedi
                        {sheetLine}
                      </span>
                      <ButtonLink href={dayHref(date)} variant="ghost" size="xs">
                        <Pencil size={13} /> Gir
                      </ButtonLink>
                    </>
                  )}
                </li>
              );
            }
            // LafPOS gününde kart farkı kartla bahşiş ve cari tahsilatını (G11) ve yazarkasadan geçmeyen kartı (Faz 2) düşer
            const c = computeCash(withCardExtra(report, photos[report.id]?.extras.cardExtra, photos[report.id]?.extras.offDevice, photos[report.id]?.extras.kasa));
            const cardOff = c.cardDiff !== null && Math.abs(c.cardDiff) >= CASH_TOLERANCE;
            // Yazarkasa Z'si: kayıtlı değerlerde kendi içinde tutmuyor ya da (ilk girildiği günden sonra) hiç girilmemiş
            const okcOff = okcHasFigures(report) && okcReconcile(report, "admin").some((l) => l.key === "okc-self");
            const okcMissing = !okcHasFigures(report) && report.zTotal > 0 && okcFirst !== null && date > okcFirst;
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
                      <span className="tabular">{reportNo(report.date)}</span> · {whoOf(report)}
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
                    {photos[report.id]?.extras.lafposDiffs?.length ? <Badge tone="amber">LafPOS&apos;tan farklı</Badge> : null}
                    {photos[report.id]?.lafposPhoto === "fark" ? <Badge tone="amber">Fotoğraf ↔ LafPOS farklı</Badge> : null}
                    {photos[report.id]?.lafposPhoto === "okunamadi" ? <Badge tone="amber">Gün sonu fotoğrafı okunamadı</Badge> : null}
                    {photos[report.id]?.lafposPhoto === "bakin" ? <Badge tone="amber">Gün sonu fotoğrafına bakın</Badge> : null}
                    {photos[report.id]?.lafposPhoto === "bekliyor" ? <Badge tone="gray">Gün sonu fotoğrafı yok</Badge> : null}
                    {modposDays[date]?.diffs.length ? <Badge tone="amber">ModPOS API&apos;den farklı</Badge> : null}
                    {carry[report.date] ? <Badge tone="amber">Açılış ≠ devir</Badge> : null}
                    {lateEdited(report) ? <Badge tone="amber">Ertesi gün düzeltildi</Badge> : null}
                    {paymentsOff ? <Badge tone="amber">Z tutmuyor</Badge> : null}
                    {cardOff ? <Badge tone="amber">Kart {c.cardDiff! > 0 ? "+" : "−"}{money(Math.abs(c.cardDiff!))}</Badge> : null}
                    {okcOff ? <Badge tone="amber">Yazarkasa tutmuyor</Badge> : null}
                    {okcMissing ? <Badge tone="gray">Yazarkasa Z yok</Badge> : null}
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
        title={open ? `Kasa raporu · ${reportNo(open.date)}` : ""}
        description={open ? `${longDateTR(open.date)} · ${whoOf(open)}${open.revision > 1 ? ` · ${open.revision - 1} kez düzeltildi` : ""}` : undefined}
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
              <ButtonLink href={dayHref(open.date)} variant="secondary">
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
          // Sade rapor (sahibin kararı, 4 Kasım 2026): üç rakam, tek kontrol listesi, döküm, kapalı ayrıntılar
          <ReportSheet
            report={open}
            kasa={openPhotos?.extras.kasa}
            cardExtra={openPhotos?.extras.cardExtra}
            offDevice={openPhotos?.extras.offDevice}
            cashOuts={cashOuts[open.date] ?? []}
            carry={openCarry}
            next={openNext}
            modposDiffs={modposDays[open.date]?.diffs}
            lafposDiffs={openPhotos?.extras.lafposDiffs}
            photos={openPhotos?.photos ?? []}
            photoDiffs={openPhotos?.diffs ?? []}
            emailError={open.emailStatus === "failed" ? (open.emailError ?? "bilinmeyen hata") : null}
            okcAdmin={okcAdmin[open.id] ?? null}
            revisions={revisions[open.id] ?? []}
            proposedBy={proposedBy[open.id]}
          />
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
