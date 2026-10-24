import { Target } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MIN_ACCURACY_DAYS, type Accuracy, type AccuracyStatus } from "@/lib/forecast/accuracy";
import { shortDateTR } from "@/lib/forecast/calendar";
import { plainPct, signedPct } from "@/lib/forecast/text";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<Exclude<AccuracyStatus, "ok">, string> = { "rapor-yok": "Rapor yok", kapali: "Kapalı", "kayit-yok": "Tahmin kaydı yok" };

/** Sapmanın rengi: %10'a kadar iyi, %25'e kadar uyarı, ötesi kötü */
function devTone(v: number): string {
  const a = Math.abs(v);
  return a <= 0.1 ? "text-good" : a <= 0.25 ? "text-warn" : "text-bad";
}

/** Kart "Tutturma": aynı sabahın tahmini ile gerçekleşen Z, son 4 hafta ve son 14 gün */
export function ForecastAccuracy({ acc }: { acc: Accuracy }) {
  const enough = acc.days >= MIN_ACCURACY_DAYS && acc.miss !== null;
  return (
    <Card>
      <CardHeader icon={<Target />} title="Tutturma" description="Her sabah kaydedilen tahmin ile gerçekleşen Z toplamı" />
      <CardContent className="space-y-3">
        {enough ? (
          <>
            <div>
              <p className="text-base font-semibold text-ink">Son 4 haftada ortalama sapma {plainPct(acc.miss!)}</p>
              <p className="mt-0.5 text-[13px] text-ink-mute">
                {acc.days} gün · gerçekleşen {acc.inRange} günde aralıkta kaldı
                {acc.bias !== null && Math.abs(acc.bias) >= 0.03 ? ` · tahmin genelde ${plainPct(acc.bias)} ${acc.bias > 0 ? "düşük" : "yüksek"} kalıyor` : ""}
              </p>
            </div>
            <ul className="divide-y divide-line rounded-2xl bg-surface px-3 text-[13px] ring-1 ring-line">
              {acc.list.map((r) => (
                <li key={r.date} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                  <span className="text-ink-soft">{shortDateTR(r.date)}</span>
                  {r.status === "ok" ? (
                    <span className="text-right text-ink-mute tabular">
                      tahmin {num(r.forecast)} · gerçekleşen {num(r.actual)} · <span className={cn("font-medium", devTone(r.deviation ?? 0))}>{signedPct(r.deviation ?? 0)}</span>
                    </span>
                  ) : (
                    <span className="text-ink-mute">{STATUS_TEXT[r.status]}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-ink-mute">
            Her sabah o günün tahmini kaydedilir; gerçekleşen Z toplamıyla karşılaştırma {MIN_ACCURACY_DAYS} gün sonra görünür (şimdi {acc.days} gün).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
