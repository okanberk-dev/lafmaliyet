import { NotebookPen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ladminCard,
  ladminCash,
  ladminFacts,
  ladminHeadline,
  ladminMeta,
  ladminOkc,
  ladminOuts,
  ladminPayments,
  type LadminCashOut,
  type LadminReport,
} from "@/lib/cash-ladmin";
import { diffKind, diffText, type CashRevisionRow } from "@/lib/cash-report";

import { FactGrid, H3, LineList, MutedLines } from "./day-parts";

/**
 * Yöneticinin gün görünümündeki "ladmin" bölümü (docs/MODPOS-API.md › Nerede görünür): panelde yazılan kasa raporunun
 * ayrıntısı, ModPOS bölümüyle aynı düzende: karolar (Z, fiş, ödenmez, indirim, kasa farkı, devreden), ödemeler ve
 * payları, nakit kasanın hesabı (devir zinciriyle), kart kanıtı (banka POS, yazarkasa), yazarkasanın Z'si, kasadan
 * çıkanlar, not ve künye (gönderen, sayan, sürüm, fotoğraf, e-posta). Sunucu bileşenidir ve föyü bilmez: yalnız raporu
 * okur (yönetici dalında çizilir).
 */
export function LadminReportCard({
  report,
  outs,
  photos,
  revisions,
  prev,
  next,
}: {
  report: LadminReport | null;
  outs: readonly LadminCashOut[];
  photos: number;
  revisions: CashRevisionRow[];
  /** Önceki raporun ertesi güne devri (açılışın denetimi) */
  prev: { date: string; amount: number } | null;
  /** Sonraki raporun açılışı (devrin denetimi) */
  next: { date: string; openingCash: number } | null;
}) {
  if (!report) {
    return (
      <Card aria-label="ladmin kasa raporu">
        <CardHeader icon={<NotebookPen />} title="ladmin" description="Panelde yazılan kasa raporu" actions={<Badge tone="gray">Rapor yok</Badge>} />
        <CardContent>
          <p className="text-sm text-ink-mute">Bu gün için ladmin&apos;de kasa raporu girilmedi.</p>
        </CardContent>
      </Card>
    );
  }
  const kind = diffKind(report.cashDiff);
  const okc = ladminOkc(report);
  const outLines = ladminOuts(outs);
  return (
    <Card aria-label="ladmin kasa raporu">
      <CardHeader
        icon={<NotebookPen />}
        title="ladmin"
        description={`Panelde yazılan kasa raporu · ${ladminHeadline(report)}`}
        actions={
          <Badge tone={kind === "even" ? "green" : "amber"} dot>
            {diffText(report.cashDiff)}
          </Badge>
        }
      />
      <CardContent className="space-y-4">
        <FactGrid facts={ladminFacts(report)} label="ladmin özeti" />
        <div className="grid gap-5 sm:grid-cols-2">
          <LineList title="Ödemeler (Z raporu)" lines={ladminPayments(report)} />
          <LineList title="Nakit kasa" lines={ladminCash(report, prev, next)} />
          <LineList title="Kart" lines={ladminCard(report)} />
          <LineList title="Yazarkasa Z" lines={okc} />
          <LineList title="Kasadan çıkanlar" lines={outLines} />
          {report.note ? (
            <section aria-label="Not">
              <h3 className={H3}>Not</h3>
              <p className="pt-1.5 text-sm break-words whitespace-pre-line text-ink">{report.note}</p>
            </section>
          ) : null}
        </div>
        <MutedLines lines={ladminMeta(report, { photos, revisions })} />
      </CardContent>
    </Card>
  );
}
