import { CreditCard } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PAVO_TITLE, pavoView } from "@/lib/asilpos/bank-pos";
import type { BankPos } from "@/lib/asilpos/day";

/**
 * Yöneticinin Kasa gün görünümünde AsilPOS gününün Pavo – AsilPOS kart karşılaştırması (src/lib/asilpos/bank-pos.ts):
 * gün sonu tam gövdesinde Pavo'nun günü (Σ batch) ↔ AsilPOS'un bütün gün kartı, sonra her batch ve son batch'in ayrıntısı;
 * fark 0 ise "Uyumlu", değilse belirgin "FARK VAR". Pavo sonucu gelmediyse kart görünmez. Gün sonu fotoğrafının
 * karşılaştırması altındaki kartta (asilpos-photo.tsx). Sunucu bileşeni.
 */
export function PavoCard({ bankPos }: { bankPos: BankPos }) {
  const v = pavoView(bankPos);
  return (
    <Card>
      <CardHeader icon={<CreditCard />} title={PAVO_TITLE} description="Banka POS'unun (Pavo) gün sonu kart toplamı ile AsilPOS'un kart toplamı" />
      <div className="space-y-3 px-5 pb-5 text-sm">
        {v.state === "fark" ? (
          <Notice tone="bad" risk="para" title="FARK VAR" text={v.headline.replace(/^FARK VAR: /, "")} />
        ) : v.state === "uyumlu" ? (
          <Notice tone="good" size="line" title="Uyumlu" />
        ) : (
          <Notice tone="warn" title="Karşılaştırılamadı" text={v.headline} />
        )}
        <section aria-label={PAVO_TITLE}>
          <ul className="divide-y divide-line">
            {[...v.rows, ...v.batches, ...v.acquirers].map(([label, value], i) => (
              <li key={`${label}:${i}`} className="flex items-baseline justify-between gap-4 py-1.5">
                <span className={i < v.rows.length ? "min-w-0 font-medium break-words text-ink" : "min-w-0 break-words text-ink-soft"}>{label}</span>
                <span className={i === 2 && v.state === "fark" ? "shrink-0 text-right font-semibold text-bad-ink tabular" : "shrink-0 text-right text-ink tabular"}>{value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Card>
  );
}
