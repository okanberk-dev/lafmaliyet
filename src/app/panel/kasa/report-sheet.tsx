"use client";

import { Camera, ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Notice } from "@/components/ui/notice";
import { cashOutLabel, type CashOutLine } from "@/lib/cash-outs";
import { reportChecks } from "@/lib/cash-report-checks";
import { computeCash, diffKind, diffText, paymentLines, withCardExtra, zSectionTitle, type CarryCheck, type CashOffDevice, type CashReportFields, type CashRevisionRow } from "@/lib/cash-report";
import { money } from "@/lib/format";
import type { LafposDiff } from "@/lib/lafpos/diffs";
import type { ModposDiff } from "@/lib/modpos/compare";
import type { PhotoDiff } from "@/lib/photo-read/kasa";
import { cn } from "@/lib/utils";
import type { CashPhotoDTO } from "@/server/data/cash-photos";

import { SavedPhotos } from "./cash-photos";
import { CashRevisions } from "./cash-revisions";
import { CardDetail, type OkcAdminView } from "./cash-summary";

/**
 * Yöneticinin kasa raporu penceresi, sade (sahibin kararı, 4 Kasım 2026: "profesyonel ama basitleştirilmiş, gereksiz
 * bilgi yok"). Sırayla: üç rakam (toplam satış, sayılan nakit, kasa), tek "Kontrol" listesi (bütün uyarılar bir arada;
 * yoksa tek satır "Kontroller tamam"; reportChecks), iki sütun döküm (satış ve nakit kasa; satır içi uyarı yok), not ve
 * kapalı "Ayrıntılar" (kart / yazarkasa, fotoğraflar, değişiklikler). Pencerenin başlığında rapor numarası (reportNo).
 */
export function ReportSheet({
  report,
  kasa = "ModPOS",
  cardExtra = null,
  offDevice = null,
  cashOuts = [],
  carry = null,
  next = null,
  modposDiffs = null,
  lafposDiffs = null,
  photos = [],
  photoDiffs = [],
  emailError = null,
  okcAdmin = null,
  revisions = [],
  proposedBy,
  unreceipted = null,
}: {
  report: CashReportFields & { revision: number; cashDiff: number; countedByName: string | null; submittedByName: string; createdAt: string; updatedAt: string };
  kasa?: "ModPOS" | "LafPOS";
  cardExtra?: number | null;
  /** LafPOS gününde yazarkasadan geçmeyen satış ödemeleri (Faz 2): kart karşılaştırması düşer */
  offDevice?: CashOffDevice | null;
  cashOuts?: (CashOutLine & { id: number; photoId: number | null })[];
  carry?: CarryCheck | null;
  next?: CarryCheck | null;
  modposDiffs?: readonly ModposDiff[] | null;
  lafposDiffs?: readonly LafposDiff[] | null;
  photos?: CashPhotoDTO[];
  photoDiffs?: PhotoDiff[];
  emailError?: string | null;
  okcAdmin?: OkcAdminView | null;
  revisions?: CashRevisionRow[];
  proposedBy?: Record<number, string>;
  /** Fişsiz çıkış (bulgu 2): Kontrol listesinde "Fişsiz çıkış: X ₺" */
  unreceipted?: number | null;
}) {
  const f = withCardExtra(report, cardExtra, offDevice, kasa);
  const c = computeCash(f);
  const kind = diffKind(report.cashDiff);
  const checks = reportChecks({ report, cardExtra, offDevice, kasa, carry, next, modposDiffs, lafposDiffs, photoDiffs, emailError, unreceipted });
  const zMeta = [report.zNo ? `Z no ${report.zNo}` : null, report.receipts ? `${report.receipts} fiş` : null].filter(Boolean).join(" · ");
  const card = <CardDetail report={f} audience="admin" okcAdmin={okcAdmin} kasa={kasa} cardExtra={cardExtra} offDevice={offDevice} />;
  const edits = Math.max(0, report.revision - 1);
  const more = [photos.length ? `${photos.length} fotoğraf` : null, edits && revisions.length ? `${edits} düzeltme` : null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line">
        <Figure label="Toplam satış" value={money(report.zTotal)} />
        <Figure label="Sayılan nakit" value={money(report.countedCash)} />
        <Figure label="Kasa" value={diffText(report.cashDiff)} tone={kind === "short" ? "bad" : kind === "over" ? "warn" : "good"} />
      </dl>

      {checks.length ? (
        <Notice
          tone={checks.some((x) => x.tone === "bad") ? "bad" : "warn"}
          size="sm"
          title={`Kontrol edilecek ${checks.length} konu`}
          text={
            <ul className="list-disc space-y-0.5 pl-4">
              {checks.map((x) => (
                <li key={x.key} className="break-words">
                  {x.text}
                </li>
              ))}
            </ul>
          }
        />
      ) : (
        <Notice tone="good" size="sm" title="Kontroller tamam: Z, kart, devir ve dış kaynaklar tutuyor" />
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <section aria-label="Satış">
          <h3 className={H3}>
            {zSectionTitle(kasa)}
            {zMeta ? <span className="font-normal text-ink-mute"> · {zMeta}</span> : null}
          </h3>
          <Row label="Toplam satış" value={money(report.zTotal)} strong />
          {paymentLines(report).map((p) => (
            <Row key={p.label} label={p.label} value={money(p.amount)} />
          ))}
          {report.discounts ? <Row label="İndirim" value={money(report.discounts)} /> : null}
          {report.offRevenue ? <Row label="Ödenmez / ikram (ciro dışı)" value={money(report.offRevenue)} /> : null}
          {/* Ödenmez Z toplamının içindeyse ayın cirosuna giren tutar (docs/KASA-RAPORU.md › Ciro ve ödenmez) */}
          {c.offInZTotal ? <Row label="Ciro (ödenmez / ikram hariç)" value={money(c.revenue)} strong /> : null}
        </section>
        <section aria-label="Nakit kasa">
          <h3 className={H3}>Nakit kasa</h3>
          <Row label="Açılış (devir)" value={money(report.openingCash)} />
          <Row label="+ Nakit satış" value={money(report.cash)} />
          {report.cashIn ? <Row label="+ Gün içinde giren" value={money(report.cashIn)} /> : null}
          {report.cashOut || cashOuts.length ? <Row label="− Gün içinde çıkan" value={money(report.cashOut)} /> : null}
          {cashOuts.length ? (
            <ul className="mb-1 space-y-0.5 border-l-2 border-line pl-2.5 text-xs text-ink-mute">
              {cashOuts.map((o) => (
                <li key={o.id} className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate">{cashOutLabel(o)}</span>
                    {o.photoId ? <Camera size={12} className="shrink-0" aria-label="Fişli" /> : null}
                  </span>
                  <span className="shrink-0 tabular">{money(o.amount)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Row label="= Olması gereken" value={money(c.expectedCash)} strong />
          <Row label="Sayılan" value={money(report.countedCash)} strong />
          {report.handedOver ? <Row label="Teslim edilen" value={money(report.handedOver)} /> : null}
          <Row label="Ertesi güne devir" value={money(c.carryOver)} />
        </section>
      </div>

      {report.note ? (
        <section aria-label="Not">
          <h3 className={H3}>Not</h3>
          <p className="pt-1.5 text-sm break-words whitespace-pre-line text-ink">{report.note}</p>
        </section>
      ) : null}

      <Details summary={more}>
        <div className="space-y-4">
          {card}
          <SavedPhotos photos={photos} diffs={[]} admin />
          <CashRevisions report={report} revisions={revisions} proposedBy={proposedBy} />
        </div>
      </Details>
    </div>
  );
}

const H3 = "border-b border-line pb-1 text-[13px] font-semibold text-ink-soft";

function Figure({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" | "good" }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-xs text-ink-mute">{label}</dt>
      <dd className={cn("mt-0.5 text-base font-semibold tracking-tight tabular sm:text-lg", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink")}>
        {value}
      </dd>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className={strong ? "font-medium text-ink" : "text-ink-mute"}>{label}</span>
      <span className={cn("text-right tabular", strong ? "font-semibold text-ink" : "text-ink")}>{value}</span>
    </div>
  );
}

/** Kapalı "Ayrıntılar": kart / yazarkasa, fotoğraflar, değişiklikler (pencerenin ilk görünümünde yer kaplamaz) */
function Details({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="rounded-2xl ring-1 ring-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left text-[13px] outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        <span className="font-semibold text-ink-soft">
          Ayrıntılar
          <span className="font-normal text-ink-mute"> · kart ve yazarkasa{summary ? ` · ${summary}` : ""}</span>
        </span>
        <ChevronDown size={15} aria-hidden="true" className={cn("shrink-0 text-ink-mute transition-transform", open && "rotate-180")} />
      </button>
      <div id={id} hidden={!open} className="px-3.5 pt-1 pb-3.5">
        {children}
      </div>
    </div>
  );
}
