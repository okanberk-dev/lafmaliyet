"use client";

import { motion } from "motion/react";

import { useCalmMotion } from "@/components/ui/motion";
import { SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Well } from "@/components/ui/card";
import { pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface FlowRow {
  label: string;
  /** Satış pozitif, kesintiler negatif */
  value: number;
  sub: string;
  sign: number;
}

/**
 * Gider parçalarının tonları: AkmanOS göstergesindeki gibi siyahtan griye. Renk anlam taşımaz;
 * anlamı satırdaki ad, tutar ve pay verir. Kâr limon, zarar kırmızıdır.
 */
const SHADES = ["bg-ink", "bg-ink/80", "bg-ink/65", "bg-ink/50", "bg-ink/38", "bg-ink/28", "bg-ink/20", "bg-ink/14"] as const;

const grow = (reduce: boolean | null, index: number) => (reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.12 + index * 0.05 });

/**
 * "Para nereye gitti?": AkmanOS agent-limits-card / capacity-allocation-card düzeni. Tek yuvarlak çubuk
 * net satışı giderlere ve kalan kâra böler; altında her parçanın rengi, tutarı ve satışa oranı.
 * Zararda çubuk giderlerin toplamı kadardır, satışın bittiği yer işaretlenir ve aşan kısım kırmızı çizilir.
 */
export function MoneyFlow({ rows, netSales, netProfit }: { rows: FlowRow[]; netSales: number; netProfit: number }) {
  const reduce = useCalmMotion();
  const base = rows.find((r) => r.sign > 0);
  const costs = rows.filter((r) => r.sign < 0).map((r, i) => ({ ...r, shade: SHADES[i % SHADES.length] }));
  const costTotal = costs.reduce((s, r) => s + Math.max(0, -r.value), 0);
  const scale = Math.max(netSales, costTotal) || 1;
  const loss = netProfit < 0;
  const salesAt = Math.min(100, (netSales / scale) * 100);
  const share = (v: number) => (netSales ? Math.abs(v) / netSales : 0);

  const segments = [
    ...costs.map((r) => ({ key: r.label, label: r.label, value: Math.max(0, -r.value), shade: r.shade as string })),
    ...(netProfit > 0 ? [{ key: "net-kar", label: "Net kâr", value: netProfit, shade: "bg-lime" }] : []),
  ].filter((s) => s.value > 0);

  return (
    <Well className="space-y-4">
      {base ? <FlowLine label={base.label} amount={base.value} share={share(base.value)} sub={base.sub} swatch="bg-surface ring-1 ring-inset ring-line-strong" /> : null}

      <div>
        <div className="relative">
          <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-panel">
            {segments.map((s, i) => (
              <motion.div
                key={s.key}
                title={`${s.label}: ${tl(s.value)} · ${pct(share(s.value), 0)}`}
                className={cn("h-full min-w-0 rounded-full", s.shade)}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${(s.value / scale) * 100}%` }}
                transition={grow(reduce, i)}
              />
            ))}
          </div>
          {loss ? (
            <span
              aria-hidden="true"
              className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface"
              style={{ left: `${salesAt}%` }}
            />
          ) : null}
        </div>
        {loss ? (
          <>
            <div aria-hidden="true" className="relative mt-1.5 h-1">
              <motion.span
                className="absolute inset-y-0 right-0 rounded-full bg-bad"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduce ? { duration: 0 } : { duration: 0.3, delay: 0.12 + segments.length * 0.05 }}
                style={{ left: `${salesAt}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-bad">
              Giderler net satışı <span className="font-semibold tabular">{tl(-netProfit)}</span> aşıyor.
            </p>
          </>
        ) : null}
      </div>

      <ul className="space-y-3">
        {costs.map((r) => (
          <FlowLine key={r.label} as="li" label={`– ${r.label}`} amount={Math.abs(r.value)} share={share(r.value)} sub={r.sub} swatch={r.shade} />
        ))}
      </ul>
    </Well>
  );
}

function FlowLine({
  label,
  amount,
  share,
  sub,
  swatch,
  as: Tag = "div",
}: {
  label: string;
  amount: number;
  share: number;
  sub: string;
  swatch: string;
  as?: "div" | "li";
}) {
  return (
    <Tag className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 text-sm">
      <span aria-hidden="true" className={cn("mt-[5px] size-2.5 shrink-0 rounded-[3px]", swatch)} />
      <span className="min-w-0">
        <span className="block font-medium text-ink">{label}</span>
        {sub ? (
          <span className="mt-0.5 block text-xs text-ink-mute sm:truncate" title={sub}>
            {sub}
          </span>
        ) : null}
      </span>
      <span className="text-right whitespace-nowrap">
        <span className="font-semibold text-ink tabular">{tl(amount)}</span>
        <span className="ml-1.5 inline-block min-w-9 text-xs text-ink-mute tabular">{pct(share, 0)}</span>
      </span>
    </Tag>
  );
}

/** Tek dolgulu ince çubuk (gider kalemleri): açılışta yaylı dolar */
export function Meter({ value, index = 0 }: { value: number; index?: number }) {
  const reduce = useCalmMotion();
  const width = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-panel">
      <motion.div className="h-full rounded-full bg-ink" initial={reduce ? false : { width: 0 }} animate={{ width: `${width}%` }} transition={grow(reduce, index)} />
    </div>
  );
}
