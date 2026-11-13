"use client";

import { CalendarClock, Pencil, ReceiptText, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { diffKind, diffText, stampTR } from "@/lib/cash-report";
import { money } from "@/lib/format";
import type { LafposDay } from "@/lib/lafpos/prefill";
import type { ReadingState } from "@/lib/photo-rules";
import { shortDayTR } from "@/lib/cash-requests";
import { dayLocativeTR, longDateTR, todayTR } from "@/lib/reminders";
import { withdrawStaffRequest } from "@/server/actions/staff-requests";
import type { OwnLate } from "@/server/data/cash-late";

import { CashForm, type LateFormState } from "./cash-form";
import type { FormPhoto } from "./cash-photos";
import { DIFF_TONE } from "./cash-summary";

/*
 * Personelin geç kasa raporu (docs/KASA-RAPORU.md › Geç rapor): `/panel/kasa?gun=D` dünden eski, raporu girilmemiş bir
 * günse açılır. Gönderilmiş istek kart olarak (Düzenle, Geri çek), yoksa form geç rapor kipinde. Yalnız kişinin kendi
 * yazdığı sayılar gelir; başkasının isteğinden yalnız adı ve anı.
 */

/** Kişinin önceki isteğinin fotoğrafları formda (kendi küçük resimleri; çıkarılabilir) */
const keptPhotos = (own: OwnLate | null, me: string): FormPhoto[] =>
  (own?.photos ?? []).map((p) => ({ id: p.id, kind: p.kind, createdAt: p.createdAt, byName: p.byName ?? me, reading: null, error: null, switchTo: null, canRetry: false, summary: null }));

export function LateReport({
  date,
  branchId,
  branchLabel = null,
  own,
  closedCount,
  others,
  carry,
  counters,
  photoUi,
  prevOkcZ = null,
  lafpos = null,
  lafposMode = false,
}: {
  date: string;
  /** Geç raporun şubesi (seçili şube, "Tümü"de Tuzla) ve birden çok şube açıkken adı */
  branchId?: string;
  branchLabel?: string | null;
  own: OwnLate | null;
  closedCount: number;
  others: { requestedByName: string; createdAt: string }[];
  /** Zincirin önceki halkasının devri (açılış önerisi) */
  carry: { date: string; amount: number } | null;
  counters: { id: number; name: string }[];
  photoUi: { storage: boolean; reading: ReadingState; admin: boolean; me: string };
  /** Önceki yazarkasa Z'si (yalnız gün ve numara; formun Z no denetimi) */
  prevOkcZ?: { date: string; zNo: string } | null;
  /** LafPOS'un bu günün sonu (yalnız geçiş gününden sonra): form ondan dolar, fotoğraf gerekmez */
  lafpos?: LafposDay | null;
  /** Günün kasası LafPOS (gün sonu gelmediyse yazarkasa Z fotoğrafı istenir) */
  lafposMode?: boolean;
}) {
  const pendingOwn = own?.status === "pending" ? own : null;
  const [editing, setEditing] = useState(!pendingOwn);
  const [busy, start] = useActionTransition();
  const day = longDateTR(date);

  function withdraw() {
    if (!pendingOwn) return;
    start(async () => {
      const res = await withdrawStaffRequest(pendingOwn.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Geç rapor geri çekildi");
      setEditing(true);
    });
  }

  const othersNote = others.length ? (
    <Notice
      tone="neutral"
      size="sm"
      title={`${others.map((o) => `${o.requestedByName} bu günü ${dayLocativeTR(todayTR(new Date(o.createdAt)))} gönderdi`).join("; ")}; yöneticinin onayını bekliyor.`}
    />
  ) : null;

  // Fotoğraf deposu yoksa geç rapor kanıtsız kalır; LafPOS'un gün sonu geldiyse kanıt odur (G8)
  if (!photoUi.storage && !lafpos) {
    return (
      <Card>
        <CardHeader icon={<CalendarClock />} title={`${day} kasa raporu`} description="Geç rapor" />
        <p className="px-5 pb-5 text-sm text-ink-mute">Fotoğraf eklenemiyor; bu günü yöneticiye yazın.</p>
      </Card>
    );
  }
  if (!pendingOwn && closedCount >= 2) {
    return (
      <Card>
        <CardHeader icon={<CalendarClock />} title={`${day} kasa raporu`} description="Geç rapor" />
        <div className="space-y-2 px-5 pb-5 text-sm">
          <p className="text-ink">Bu gün için iki isteğiniz kapandı; bu günü yöneticiye yazın.</p>
          {own?.reviewNote ? <p className="text-ink-soft">Yönetici: {own.reviewNote}</p> : null}
        </div>
      </Card>
    );
  }

  if (pendingOwn && !editing) {
    const f = pendingOwn.fields;
    return (
      <div className="space-y-3">
        {othersNote}
        <Card>
          <CardHeader
            icon={<ReceiptText />}
            title={`${day} kasa raporu`}
            description={`Geç rapor · gönderildi ${stampTR(pendingOwn.updatedAt)}`}
            meta={<Badge tone="amber">Onay bekliyor</Badge>}
          />
          <div className="space-y-3 px-5 pb-5 text-sm">
            <ul className="divide-y divide-line">
              {[
                ["Toplam satış (Z)", `${money(f.zTotal)}${f.zNo ? ` · Z no ${f.zNo}` : ""}`],
                ["Nakit · kart", `${money(f.cash)} · ${money(f.card)}`],
                ["Açılış", money(f.openingCash)],
                ...(f.cashIn ? [["Gün içinde giren", money(f.cashIn)]] : []),
                ["Gün içinde çıkan", money(f.cashOut)],
                ["Akşam sayılan", money(f.countedCash)],
                ["Teslim edilen", money(f.handedOver)],
              ].map(([label, value]) => (
                <li key={label} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-ink-mute">{label}</span>
                  <span className="text-right text-ink tabular">{value}</span>
                </li>
              ))}
            </ul>
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-ink-mute">Kasa farkı</span>
              <Badge tone={DIFF_TONE[diffKind(pendingOwn.cashDiff)]} dot>
                {diffText(pendingOwn.cashDiff)}
              </Badge>
            </p>
            {pendingOwn.message ? <p className="break-words text-ink-soft">Neden: {pendingOwn.message}</p> : null}
            <p className="text-ink-mute">{pendingOwn.photos.length || !lafpos ? `${pendingOwn.photos.length} fotoğraf eklendi` : "LafPOS gün sonuyla gönderildi; fotoğraf gerekmez"}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
                <Pencil size={15} /> Düzenle
              </Button>
              <Button variant="ghost" onClick={withdraw} disabled={busy}>
                <Undo2 size={15} /> Geri çek
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const late: LateFormState = {
    version: pendingOwn?.version ?? 0,
    reason: own?.message ?? "",
    handedTo: own?.handedTo ? (own.handedTo.kind === "banka" ? { kind: "banka" } : { kind: "user", id: own.handedTo.id }) : null,
    kept: keptPhotos(own, photoUi.me),
    updating: Boolean(pendingOwn),
  };
  return (
    <div className="space-y-3">
      {othersNote}
      {own?.status === "rejected" ? (
        <Notice
          tone="warn"
          live="assertive"
          title={`Reddedildi${own.reviewedByName ? ` · ${own.reviewedByName}` : ""}${own.reviewNote ? `: ${own.reviewNote}` : ""}`}
          text="Önceki değerleriniz formda; düzeltip yeniden gönderebilirsiniz."
        />
      ) : null}
      <CashForm
        key={`gec:${date}:${pendingOwn?.version ?? 0}:${own?.id ?? 0}`}
        date={date}
        branchId={branchId}
        branchLabel={branchLabel}
        report={null}
        carry={carry}
        whatsapp={null}
        recipients={0}
        canEdit
        photoUi={photoUi}
        saved={null}
        cashOuts={[]}
        counters={counters}
        mode="late"
        initial={own?.fields ?? null}
        late={late}
        onCancel={pendingOwn ? () => setEditing(false) : undefined}
        onSent={() => setEditing(false)}
        prevOkcZ={prevOkcZ}
        lafpos={lafpos}
        lafposMode={lafposMode}
      />
    </div>
  );
}

/**
 * "Girilmemiş günler" (personelin kasa sayfası): dünden eski son 14 günün raporu girilmemiş günleri, çip başına gün.
 * Telefonda 4'ten fazla gün tek çipte toplanır, dokununca açılır. Kanıt günün kasasına göre (G8): LafPOS'un gün sonu
 * gelen günde (`lafpos`) fotoğraf gerekmez, çip fotoğraf deposu yokken de görünür; öteki günlerin çipi depo yoksa yok.
 */
export function LateDaysCard({ days, storage }: { days: { date: string; state: "missing" | "pending" | "rejected"; lafpos?: boolean }[]; storage: boolean }) {
  const [open, setOpen] = useState(false);
  if (!days.length) return null;
  // Girilebilen günler: depo varsa hepsi, yoksa yalnız LafPOS gün sonu gelenler
  const shown = storage ? days : days.filter((d) => d.lafpos);
  const hidden = days.length - shown.length;
  const collapse = shown.length > 4 && !open;
  const label = (d: (typeof days)[number]) => `${shortDayTR(d.date)}${d.state === "pending" ? " · onay bekliyor" : d.state === "rejected" ? " · reddedildi" : ""}`;
  const lafposCount = days.filter((d) => d.lafpos).length;
  const description = !lafposCount
    ? "Kafe açıktıysa Z raporunun fotoğrafıyla girin; yöneticinin onayıyla kayda geçer."
    : lafposCount === days.length
      ? "Kafe açıktıysa girin; LafPOS'un gün sonu geldiği için fotoğraf gerekmez. Yöneticinin onayıyla kayda geçer."
      : "Kafe açıktıysa girin; LafPOS'un gün sonu gelen günlerde fotoğraf gerekmez, ötekilerde Z raporunun fotoğrafıyla. Yöneticinin onayıyla kayda geçer.";
  return (
    <Card>
      <CardHeader icon={<CalendarClock />} title="Girilmemiş günler" description={description} />
      <div className="space-y-2 px-5 pb-5">
        {shown.length ? (
          <>
            {collapse ? (
              <Button size="sm" variant="secondary" className="sm:hidden" onClick={() => setOpen(true)}>
                {shown.length} gün
              </Button>
            ) : null}
            <div className={collapse ? "hidden flex-wrap gap-2 sm:flex" : "flex flex-wrap gap-2"}>
              {shown.map((d) => (
                <ButtonLink key={d.date} href={`/panel/kasa?gun=${d.date}`} size="sm" variant={d.state === "missing" ? "secondary" : "ghost"} className="pointer-coarse:min-h-11">
                  {label(d)}
                </ButtonLink>
              ))}
            </div>
          </>
        ) : null}
        {hidden ? <p className="text-sm text-ink-mute">Fotoğraf eklenemiyor; {shown.length ? "öteki günleri" : "bu günleri"} yöneticiye yazın.</p> : null}
      </div>
    </Card>
  );
}
