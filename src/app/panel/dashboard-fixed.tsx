import type { ReactNode } from "react";

import { Well } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import type { FixedMonthBreakdown } from "@/lib/calc/insights";
import { tl } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Kuruş altı farklar yok sayılır (1 ₺'den küçük fark gösterilmez) */
export const differs = (a: number, b: number) => Math.abs(a - b) >= 1;

/** "+1.234 ₺" / "−1.234 ₺": açıklamalarda farkın yönü görünsün */
export const signedTl = (v: number) => `${v < 0 ? "−" : "+"}${tl(Math.abs(v))}`;

/** Net kâr ipucu: Excel temeli (standart) ile bu ayın sabit gideri arasındaki fark nereden geliyor */
export function fixedBreakdownText(f: FixedMonthBreakdown): string {
  const parts = [`Standart aylık sabit gider ${tl(f.standard)}`];
  if (differs(f.proration, 0)) parts.push(`açık gün etkisi (${f.openDays} / ${f.dim} gün) ${signedTl(f.proration)}`);
  // Kutudaki satırlarla aynı adlar: düzeltilen hücreler ve yalnızca bu aya yazılan satırlar ayrı
  if (differs(f.overrides, 0)) parts.push(`Gelir-gider'de düzeltilen tutarlar ${signedTl(f.overrides)}`);
  if (differs(f.manual, 0)) parts.push(`bu aya özel giderler (Gelir-gider) ${signedTl(f.manual)}`);
  return `${parts.join(" · ")} = bu ay düşülen ${tl(f.total)}. Excel Panel'i her ay standart tutarı düşer; "Excel temeli" o hesaptır.`;
}

/**
 * Bu ay düşülen sabit giderin kaynağı, ayrı satırlarda: standart aylık tutar (Excel SabitGiderToplam),
 * açık gün etkisi, Gelir-gider'de düzeltilen hücreler ve bu aya özel satırlar. Standarttan fark yoksa
 * tek satırlık not; SU GİDERİ reçetelere dağıtıldıysa ikinci kez düşülmediği yazılır.
 */
export function FixedReconcile({ f }: { f: FixedMonthBreakdown }) {
  const proration = differs(f.proration, 0);
  const overrides = differs(f.overrides, 0);
  const manual = differs(f.manual, 0);
  const water = f.waterExcluded > 0;
  const names = (xs: { label: string }[]) =>
    xs
      .slice(0, 3)
      .map((x) => x.label)
      .join(", ") + (xs.length > 3 ? "…" : "");
  if (!proration && !overrides && !manual) {
    return (
      <p className="text-xs leading-5 text-ink-mute">
        Sabit giderler bu ay standart aylık tutarlarla düşüldü ({tl(f.standard)}, Excel Panel ile aynı temel).
        {water ? ` SU GİDERİ (${tl(f.waterExcluded)}) reçetelerde su + buz maliyeti olarak sayıldığı için burada ikinci kez düşülmedi.` : ""}
        {f.basis === "standard" ? " Açık gün sayısı girilmedi; girilince sabit giderler açık gün oranıyla hesaplanır." : ""}
      </p>
    );
  }
  const row = (label: ReactNode, value: number, sub?: string, strong?: boolean) => (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5 text-[13px]", strong && "font-semibold")}>
      <span className="min-w-0">
        <span className={strong ? "text-ink" : "text-ink-mute"}>{label}</span>
        {sub ? <span className="block text-xs text-pretty text-ink-quiet sm:truncate" title={sub}>{sub}</span> : null}
      </span>
      <span className="text-right whitespace-nowrap text-ink tabular">{strong ? tl(value) : signedTl(value)}</span>
    </div>
  );
  return (
    <Well className="px-4 py-2">
      <h3 className="flex items-center gap-1.5 pt-1 text-[13px] font-semibold text-ink">
        Bu ay düşülen sabit gider
        <InfoTip text="Excel Panel'i her ay standart aylık sabit gideri (Sabit Giderler + Personel) düşer. Panel o ayın Gelir-gider tutarlarını kullanır: kalemler açık gün oranıyla bölünür, Gelir-gider'de elle düzeltilen hücreler ve yalnızca bu aya yazılan satırlar (doğalgaz, ciro kirası, harici…) eklenir. Fark aşağıda ayrı satırlarda." />
      </h3>
      <div className="divide-y divide-line">
        <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
          <span className="text-ink-mute">Standart aylık sabit gider (Excel)</span>
          <span className="text-ink tabular">{tl(f.standard)}</span>
        </div>
        {proration ? row(`Açık gün etkisi (${f.openDays} / ${f.dim} gün)`, f.proration) : null}
        {overrides ? row("Gelir-gider'de düzeltilen tutarlar", f.overrides, names(f.overrideRows)) : null}
        {manual ? row("Bu aya özel giderler (Gelir-gider)", f.manual, names(f.manualRows)) : null}
        {row("Bu ay düşülen", f.total, undefined, true)}
      </div>
      {water ? (
        <p className="pb-1 text-xs leading-5 text-ink-mute">
          SU GİDERİ ({tl(f.waterExcluded)}) reçetelerde su + buz maliyeti olarak sayıldığı için burada ikinci kez düşülmedi.
        </p>
      ) : null}
    </Well>
  );
}
