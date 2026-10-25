"use client";

import { AlertTriangle, Check, ExternalLink, Info, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { stampTR } from "@/lib/cash-report";
import { closedEvidenceText } from "@/lib/closed-days";
import { genitive } from "@/lib/recipe-change";
import { longDateTR } from "@/lib/reminders";
import { reviewClosedDay } from "@/server/actions/closed-days";
import type { ClosedDayCard } from "@/server/closed-days";

/*
 * Onaylar › Kasa: "Kafe kapalıydı" bildirimi (yalnız yönetici; docs/KASA-RAPORU.md › Kafe kapalıydı). Kanıt canlı
 * sayılır: panelde iz (kırmızı: onay kapalı), Z no ve açılış sürekliliği, sitenin sipariş sayıları (ayrı bir Suspense,
 * `site`). Üst üste günler birlikte söylenir. Not bütün personele görünür; tutar yazılmaz.
 */

export function ClosedDayItem({ card, site }: { card: ClosedDayCard; site?: ReactNode }) {
  const [note, setNote] = useState("");
  const [pending, start] = useActionTransition();
  const lines = closedEvidenceText(card.evidence);
  const red = lines.red.length > 0;
  const who = genitive(card.requestedByName);

  function decide(decision: "approve" | "reject") {
    start(async () => {
      const res = await reviewClosedDay({ id: card.id, seenVersion: card.version, decision, note: note.trim() || null });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      toast.success(decision === "approve" ? "Kapalı gün onaylandı" : `${who} bildirimi reddedildi`, {
        description: decision === "approve" ? `${longDateTR(card.date)} için eksik rapor ve liste uyarıları kalktı.` : "Personel raporu girecek.",
      });
    });
  }

  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <div className="space-y-1">
        <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="min-w-0 break-words">Kapalı gün · {longDateTR(card.date)}</span>
          <Badge tone="gray">Kapalı gün</Badge>
          {card.run ? <Badge tone="amber">{card.run.days} gün üst üste kapalı bildirimi</Badge> : null}
        </h3>
        <p className="text-[13px] text-ink-mute tabular">
          {card.requestedByName} · {stampTR(card.createdAt)}
        </p>
        {card.reason ? <p className="text-sm break-words text-ink-soft">Neden: {card.reason}</p> : null}
      </div>
      <section aria-label="Kanıt" className="space-y-1.5 rounded-xl bg-panel px-3 py-2.5 text-[13px] leading-5">
        <p className="font-medium text-ink">O gün panelde</p>
        {lines.red.length || lines.warn.length || lines.info.length ? (
          <ul className="space-y-1">
            {lines.red.map((x) => (
              <li key={x} className="flex items-start gap-1.5 font-medium text-bad">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{x}</span>
              </li>
            ))}
            {lines.warn.map((x) => (
              <li key={x} className="flex items-start gap-1.5 text-warn">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{x}</span>
              </li>
            ))}
            {lines.info.map((x) => (
              <li key={x} className="flex items-start gap-1.5 text-ink-soft">
                <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{x}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-soft">Kasa raporu, kasadan çıkan, zayi, kontrol listesi, karaoke ve personel kaydı yok.</p>
        )}
        {site}
        <Link href={`/panel/kasa?gun=${card.date}`} className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:py-2.5">
          <ExternalLink size={14} aria-hidden="true" /> Günü aç
        </Link>
      </section>
      <p className="text-[13px] leading-5 text-ink-mute">Onaylamadan önce o günün ModPOS / banka POS&apos;una bakın; satış varsa reddedin.</p>
      <Field label="Not (bütün personele görünür; tutar yazmayın)" htmlFor={`not-${card.id}`}>
        <Textarea id={`not-${card.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => decide("reject")} disabled={pending}>
          <X size={15} /> Reddet
        </Button>
        <Button onClick={() => decide("approve")} disabled={pending || red}>
          <Check size={15} /> Onayla
        </Button>
      </div>
      {red ? <p className="text-right text-[13px] text-bad">O gün kayıt var; kapalı onaylanamaz.</p> : null}
    </article>
  );
}
