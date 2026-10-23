import { Badge } from "@/components/ui/badge";
import { changeLine, historyOf, stampTR, type CashReportFields, type CashRevisionRow } from "@/lib/cash-report";
import { cn } from "@/lib/utils";

/**
 * Raporun düzeltme geçmişi ("Değişiklikler"), en yeni önce: her gönderimde kim, ne zaman, hangi alan neyden neye.
 * İş günü kapandıktan sonra (ertesi gün 05:00'ten sonra) kasa alanı değişen düzeltme "Ertesi gün" rozetiyle. Not gibi
 * metin alanlarının içeriği yazılmaz ("Not değişti"). Önceki sürüm yoksa (hiç düzeltilmemiş ya da bu özellikten önceki
 * rapor) görünmez. Saf bileşen: personelin kayıtlı raporunda ve yöneticinin gün ayrıntısında aynı.
 */
export function CashRevisions({
  report,
  revisions,
  className,
}: {
  report: CashReportFields & { revision: number; cashDiff: number; countedByName: string | null; submittedByName: string; createdAt: string; updatedAt: string };
  revisions: CashRevisionRow[];
  className?: string;
}) {
  if (report.revision <= 1 || !revisions.length) return null;
  const h = historyOf(report, revisions);
  if (!h.entries.length) return null;
  return (
    <section aria-label="Değişiklikler" className={className}>
      <h3 className="border-b border-line pb-1 text-[13px] font-semibold text-ink-soft">Değişiklikler</h3>
      <ol className="divide-y divide-line">
        {h.entries.map((e) => (
          <li key={e.revision} className="py-2">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium text-ink tabular">
                {stampTR(e.at)} · {e.by}
              </span>
              {e.late ? <Badge tone="amber">Ertesi gün</Badge> : null}
            </p>
            <ul className="mt-0.5 space-y-0.5 text-[13px] leading-5 text-ink-soft">
              {e.changes.length ? (
                e.changes.map((c) => (
                  <li key={c.key} className={cn("break-words", e.late && c.sensitive && "font-medium text-warn")}>
                    {changeLine(c)}
                  </li>
                ))
              ) : (
                <li className="text-ink-mute">Değişiklik yok (yeniden gönderildi)</li>
              )}
            </ul>
          </li>
        ))}
        <li className="py-2 text-[13px] text-ink-mute tabular">
          İlk gönderim: {stampTR(h.first.at)}
          {h.first.by ? ` · ${h.first.by}` : ""}
        </li>
      </ol>
    </section>
  );
}
