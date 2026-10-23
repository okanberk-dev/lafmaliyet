"use client";

import { Camera } from "lucide-react";

import { cashOutLabel, type CashOutLine } from "@/lib/cash-outs";
import { CASH_TOLERANCE, computeCash, diffKind, diffText, paymentLines, type CashReportFields } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Kasa farkının rengi: eksik kırmızı, fazla turuncu, tutuyor yeşil */
export const DIFF_TONE = { short: "red", over: "amber", even: "green" } as const;

export function DiffHeadline({ diff, className }: { diff: number; className?: string }) {
  const kind = diffKind(diff);
  return (
    <p className={cn("text-3xl font-semibold tracking-tight tabular", kind === "short" ? "text-bad" : kind === "over" ? "text-warn" : "text-good", className)}>{diffText(diff)}</p>
  );
}

function Line({ label, value, strong, tone, sub }: { label: string; value: string; strong?: boolean; tone?: "bad" | "warn" | "good"; sub?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className={cn(strong ? "font-medium text-ink" : "text-ink-mute")}>
        {label}
        {sub ? <span className="block text-xs text-ink-mute">{sub}</span> : null}
      </span>
      <span className={cn("text-right tabular", strong ? "font-semibold" : "text-ink", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink")}>{value}</span>
    </div>
  );
}

/**
 * Raporun dökümü: Z raporu, kasa, kart, not (personelin sonucu ve yöneticinin gün ayrıntısı aynı görünür). Günün
 * kasadan çıkan satırları "Gün içinde çıkan"ın altında (fişli olanlar kamera işaretiyle).
 */
export function CashBreakdown({ report, cashOuts = [] }: { report: CashReportFields; cashOuts?: (CashOutLine & { id: number; photoId: number | null })[] }) {
  const c = computeCash(report);
  const paymentsOff = Math.abs(c.paymentsDiff) >= CASH_TOLERANCE;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <section aria-label="Z raporu">
        <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">
          Z raporu (ModPOS){report.zNo ? ` · Z no ${report.zNo}` : ""}
          {report.receipts ? ` · ${report.receipts} fiş` : ""}
        </h3>
        <Line label="Toplam satış" value={money(report.zTotal)} strong />
        {paymentLines(report).map((p) => (
          <Line key={p.label} label={p.label} value={money(p.amount)} />
        ))}
        {paymentsOff ? (
          <p className="mt-1 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
            Ödeme türleri toplamı ({money(c.paymentsTotal)}) Z toplamından {money(Math.abs(c.paymentsDiff))} {c.paymentsDiff > 0 ? "fazla" : "az"}.
          </p>
        ) : null}
      </section>
      <section aria-label="Kasa">
        <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">Kasa (nakit)</h3>
        <Line label="Açılış (devir)" value={money(report.openingCash)} />
        <Line label="+ Nakit satış" value={money(report.cash)} />
        {report.cashOut || cashOuts.length ? <Line label="− Gün içinde çıkan" value={money(report.cashOut)} sub={report.cashOutNote} /> : null}
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
        <Line label="= Olması gereken" value={money(c.expectedCash)} strong />
        <Line label="Sayılan" value={money(report.countedCash)} strong />
        <Line label="Fark" value={diffText(c.cashDiff)} strong tone={c.kind === "short" ? "bad" : c.kind === "over" ? "warn" : "good"} />
        {report.handedOver ? <Line label="Teslim edilen" value={money(report.handedOver)} /> : null}
        <Line label="Ertesi güne devir" value={money(c.carryOver)} />
      </section>
      {c.cardDiff !== null ? (
        <section aria-label="Kart">
          <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">Kart</h3>
          <Line label="ModPOS kart" value={money(report.card)} />
          <Line label="Banka POS gün sonu" value={money(report.bankPos)} />
          <Line
            label="Fark"
            value={Math.abs(c.cardDiff) < CASH_TOLERANCE ? "Yok" : `${money(Math.abs(c.cardDiff))} ${c.cardDiff > 0 ? "fazla" : "az"}`}
            strong
            tone={Math.abs(c.cardDiff) < CASH_TOLERANCE ? "good" : "warn"}
          />
        </section>
      ) : null}
      {report.note ? (
        <section aria-label="Not" className={c.cardDiff === null ? "sm:col-span-2" : undefined}>
          <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">Not</h3>
          <p className="pt-1.5 text-sm break-words whitespace-pre-line text-ink">{report.note}</p>
        </section>
      ) : null}
    </div>
  );
}
