"use client";

import { Camera, Eraser, Info, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cashOutLabel, type CashOutLine } from "@/lib/cash-outs";
import { CASH_TOLERANCE, carryDiffText, computeCash, diffKind, diffText, paymentLines, type CarryCheck, type CashReportFields } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { okcHasFigures, okcReconcile } from "@/lib/okc-z";
import { dayMonthTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { clearOkcCumulative } from "@/server/actions/cash-report";

/**
 * Yöneticinin kayıtlı rapordaki yazarkasa satırları (sunucu sütunları, docs/planlar/okc-z.md §3.7, §6.1, D17): cihazın
 * kümülatif sayacı ve yazarkasa dışı tahsilat. Personelin sayfasına hiç gitmez (tests/personel-sizinti-kasa.test.ts)
 */
export interface OkcAdminView {
  reportId: number;
  cumTotal: number | null;
  cumVat: number | null;
  outside: number | null;
  /** Kümülatif okundu ama saklanmadı ya da temizlendi (metin) */
  note: string | null;
}

/** Kasa farkının rengi: eksik kırmızı, fazla turuncu, tutuyor yeşil */
export const DIFF_TONE = { short: "red", over: "amber", even: "green" } as const;

export function DiffHeadline({ diff, className }: { diff: number; className?: string }) {
  const kind = diffKind(diff);
  return (
    <p className={cn("text-3xl font-semibold tracking-tight tabular", kind === "short" ? "text-bad" : kind === "over" ? "text-warn" : "text-good", className)}>{diffText(diff)}</p>
  );
}

function Line({
  label,
  value,
  strong,
  tone,
  sub,
  subWarn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "bad" | "warn" | "good";
  sub?: string | null;
  /** Alt satır uyarıdır (turuncu) */
  subWarn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className={cn(strong ? "font-medium text-ink" : "text-ink-mute")}>
        {label}
        {sub ? <span className={cn("block text-xs", subWarn ? "text-warn" : "text-ink-mute")}>{sub}</span> : null}
      </span>
      <span className={cn("text-right tabular", strong ? "font-semibold" : "text-ink", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink")}>{value}</span>
    </div>
  );
}

/**
 * Raporun dökümü: Z raporu, kasa, kart, not (personelin sonucu ve yöneticinin gün ayrıntısı aynı görünür). Günün
 * kasadan çıkan satırları "Gün içinde çıkan"ın altında (fişli olanlar kamera işaretiyle). Açılış önceki raporun
 * devriyle (`carry`), ertesi güne devir sonraki raporun açılışıyla (`next`) tutmuyorsa satırın altında turuncu.
 */
export function CashBreakdown({
  report,
  cashOuts = [],
  carry = null,
  next = null,
  audience = "staff",
  okcAdmin = null,
}: {
  report: CashReportFields;
  cashOuts?: (CashOutLine & { id: number; photoId: number | null })[];
  carry?: CarryCheck | null;
  next?: CarryCheck | null;
  /** Personel yazarkasa karşılaştırmalarından yalnız kart ve kendi içinde satırlarını görür (İlke 8, §8) */
  audience?: "staff" | "admin";
  /** Yalnız yönetici: kümülatif ve "Kümülatifi temizle" */
  okcAdmin?: OkcAdminView | null;
}) {
  const c = computeCash(report);
  const paymentsOff = Math.abs(c.paymentsDiff) >= CASH_TOLERANCE;
  const okc = okcHasFigures(report);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <section aria-label="ModPOS Z raporu">
        <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">
          ModPOS Z raporu{report.zNo ? ` · Z no ${report.zNo}` : ""}
          {report.receipts ? ` · ${report.receipts} fiş` : ""}
        </h3>
        <Line label="Toplam satış" value={money(report.zTotal)} strong />
        {paymentLines(report).map((p) => (
          <Line key={p.label} label={p.label} value={money(p.amount)} />
        ))}
        {report.discounts ? <Line label="İndirim" value={money(report.discounts)} /> : null}
        {paymentsOff ? (
          <p className="mt-1 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
            Ödeme türleri toplamı ({money(c.paymentsTotal)}) Z toplamından {money(Math.abs(c.paymentsDiff))} {c.paymentsDiff > 0 ? "fazla" : "az"}.
          </p>
        ) : null}
      </section>
      <section aria-label="Kasa">
        <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">Kasa (nakit)</h3>
        <Line
          label="Açılış (devir)"
          value={money(report.openingCash)}
          tone={carry ? "warn" : undefined}
          sub={carry ? `Önceki rapor (${dayMonthTR(carry.prevDate)}) devri ${money(carry.carry)} · ${carryDiffText(carry)}` : null}
          subWarn
        />
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
        <Line
          label="Ertesi güne devir"
          value={money(c.carryOver)}
          tone={next ? "warn" : undefined}
          sub={next ? `${dayMonthTR(next.date)} açılışı ${money(next.opening)} · ${money(Math.abs(next.diff))} farklı` : null}
          subWarn
        />
      </section>
      {okc ? (
        <OkcBreakdown report={report} audience={audience} okcAdmin={okcAdmin} />
      ) : c.cardDiff !== null ? (
        // Yazarkasa bölümünden önceki rapor: bugünkü "Kart" bölümü; o günlerde alan banka gün sonunu da yazarkasa
        // Z'sinin kart satırını da tutabilir, anlam iddia edilmez (§3.7)
        <section aria-label="Kart">
          <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">Kart</h3>
          <Line label="ModPOS kart" value={money(report.card)} />
          <Line label="Banka POS" value={money(report.bankPos)} />
          <Line
            label="Fark"
            value={Math.abs(c.cardDiff) < CASH_TOLERANCE ? "Yok" : `${money(Math.abs(c.cardDiff))} ${c.cardDiff > 0 ? "fazla" : "az"}`}
            strong
            tone={Math.abs(c.cardDiff) < CASH_TOLERANCE ? "good" : "warn"}
          />
        </section>
      ) : null}
      {report.note ? (
        <section aria-label="Not" className={c.cardDiff === null && !okc ? "sm:col-span-2" : undefined}>
          <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">Not</h3>
          <p className="pt-1.5 text-sm break-words whitespace-pre-line text-ink">{report.note}</p>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Kayıtlı raporun "Banka POS Z (yazarkasa)" bölümü (docs/planlar/okc-z.md §3.7): Z no ve fiş sayısı, günlük toplam,
 * KDV ve oran oran döküm, ödemeler, banka gün sonu (varsa); altında karşılaştırma satırları (personele yalnız kart ve
 * kendi içinde). Yöneticiye kümülatif ve "Kümülatifi temizle".
 */
function OkcBreakdown({ report: f, audience, okcAdmin }: { report: CashReportFields; audience: "staff" | "admin"; okcAdmin: OkcAdminView | null }) {
  const lines = okcReconcile({ ...f, bankPos: f.bankPos ?? null }, audience);
  const head = [f.okcZNo ? `Z no ${f.okcZNo}` : null, f.okcReceipts ? `${f.okcReceipts} fiş` : null].filter(Boolean).join(" · ");
  return (
    <section aria-label="Banka POS Z (yazarkasa)">
      <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">
        Banka POS Z (yazarkasa){head ? ` · ${head}` : ""}
      </h3>
      {f.okcTotal != null ? <Line label="Günlük toplam" value={money(f.okcTotal)} strong /> : null}
      {f.okcVatTotal != null ? <Line label="Toplam KDV" value={money(f.okcVatTotal)} /> : null}
      {(f.okcVat ?? []).map((l) => (
        <Line key={l.rate} label={`%${l.rate}`} sub={`KDV ${money(l.vat)}`} value={money(l.total)} />
      ))}
      {f.okcCash != null ? <Line label="Nakit" value={money(f.okcCash)} /> : null}
      {f.okcCard != null ? <Line label="Kredi kartı" value={money(f.okcCard)} /> : null}
      {f.okcMealCard ? <Line label="Yemek kartı" value={money(f.okcMealCard)} /> : null}
      {f.okcOther ? <Line label="Diğer" value={money(f.okcOther)} /> : null}
      {f.bankPos !== null ? <Line label="Banka gün sonu" value={money(f.bankPos)} /> : null}
      {lines.length ? (
        <ul className="mt-1.5 space-y-1.5">
          {lines.map((l) => (
            <li key={l.key} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-5", l.tone === "warn" ? "bg-warn-soft text-warn" : l.tone === "good" ? "bg-lime/25 text-good-ink" : "bg-info-soft text-info")}>
              {l.tone === "warn" ? <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
              <span className="min-w-0">{l.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {audience === "admin" && okcAdmin ? <OkcCumulative view={okcAdmin} /> : null}
    </section>
  );
}

/** Yönetici: cihazın kümülatif sayacı (yalnız inandırıcıysa saklıdır, §6.1) ve temizleme; yazarkasa dışı tahsilat */
function OkcCumulative({ view }: { view: OkcAdminView }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useActionTransition();
  function clear() {
    start(async () => {
      const res = await clearOkcCumulative(view.reportId);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Kümülatif temizlendi", { description: "Yeni bir Banka POS Z fotoğrafı okununca yeniden yazılır." });
      setConfirm(false);
    });
  }
  if (view.cumTotal === null && view.outside === null && !view.note) return null;
  return (
    <div className="mt-2 space-y-1.5 border-t border-line pt-2 text-[13px] leading-5">
      {view.cumTotal !== null ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="min-w-0 flex-1 basis-48 text-ink-soft">
            Kümülatif (cihaz açılışından beri): <span className="text-ink tabular">{money(view.cumTotal)}</span>
            {view.cumVat !== null ? (
              <>
                {" "}
                · KDV <span className="tabular">{money(view.cumVat)}</span>
              </>
            ) : null}
          </span>
          <Button size="xs" variant="ghost" onClick={() => setConfirm(true)} disabled={pending}>
            <Eraser size={13} aria-hidden="true" /> Kümülatifi temizle
          </Button>
        </div>
      ) : null}
      {view.note ? <p className="text-ink-mute">{view.note}</p> : null}
      {view.outside !== null ? <p className="text-ink-soft">Z&apos;de toplam dışında {money(view.outside)} tahsilat var (faturalı satış, bilgi fişi…); toplama eklenmedi.</p> : null}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={clear}
        pending={pending}
        title="Kümülatif temizlensin mi?"
        description="Yanlış okunmuş kümülatif sonraki günlerin denetimini bozar. Temizlenince ertesi günler önceki saklanan kümülatife bağlanır; rapor değişmez, olay kaydına düşer."
        confirmLabel="Temizle"
      />
    </div>
  );
}
