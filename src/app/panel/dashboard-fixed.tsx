import type { ReactNode } from "react";

import { Well } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { SHARED_COSTS_NOTE } from "@/lib/branch-view";
import type { FixedMonthBreakdown } from "@/lib/calc/insights";
import { tl } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Kuruş altı farklar yok sayılır (1 ₺'den küçük fark gösterilmez) */
export const differs = (a: number, b: number) => Math.abs(a - b) >= 1;

/** "+1.234 ₺" / "−1.234 ₺": açıklamalarda farkın yönü görünsün */
export const signedTl = (v: number) => `${v < 0 ? "−" : "+"}${tl(Math.abs(v))}`;

/**
 * Gün etkisinin adı: elle girilen açık günde "Açık gün etkisi (23 / 31 gün)"; kasa raporlarından gelen ayda takvim
 * günü (yalnız süren ayda standarttan farklı): "Ayın geçen günü (16 / 31 gün)"
 */
export function prorationLabel(f: Pick<FixedMonthBreakdown, "prorationBasis" | "prorationDays" | "dim">): string {
  return `${f.prorationBasis === "takvim" ? "Ayın geçen günü" : "Açık gün etkisi"} (${f.prorationDays} / ${f.dim} gün)`;
}

/** "Satış listesinin günleri (15 / 22 gün)": süren ayda listenin kapsamadığı günlerin sabit gideri düşülmez */
export function listShareLabel(ls: NonNullable<FixedMonthBreakdown["listShare"]>): string {
  return `Satış listesinin günleri (${ls.days} / ${ls.of} gün)`;
}

/** Net kâr ipucu: standart aylık sabit gider ile bu ay düşülen sabit gider arasındaki fark nereden geliyor */
export function fixedBreakdownText(f: FixedMonthBreakdown): string {
  const parts = [`Standart aylık sabit gider ${tl(f.standard)}`];
  if (differs(f.proration, 0)) parts.push(`${prorationLabel(f).toLocaleLowerCase("tr-TR")} ${signedTl(f.proration)}`);
  // Kutudaki satırlarla aynı adlar: düzeltilen hücreler ve yalnızca bu aya yazılan satırlar ayrı
  if (differs(f.overrides, 0)) parts.push(`Gelir-gider'de düzeltilen tutarlar ${signedTl(f.overrides)}`);
  if (differs(f.manual, 0)) parts.push(`bu aya özel giderler (Gelir-gider) ${signedTl(f.manual)}`);
  // Aylık harcamalar standart sabit gidere girmez: ayrı satırda
  if (differs(f.expenses, 0)) parts.push(`aylık harcamalar ${signedTl(f.expenses)}`);
  if (f.listShare && differs(f.listShare.amount, 0)) parts.push(`${listShareLabel(f.listShare).toLocaleLowerCase("tr-TR")} ${signedTl(f.listShare.amount)}`);
  return `${parts.join(" · ")} = bu ay düşülen ${tl(f.total)}.`;
}

/**
 * Bu ay düşülen sabit giderin kaynağı, ayrı satırlarda: standart aylık tutar (Sabit giderler + Maaşlar),
 * açık gün etkisi, Gelir-gider'de düzeltilen hücreler, bu aya özel satırlar ve aylık harcamalar. Standarttan fark yoksa
 * tek satırlık not; SU GİDERİ reçetelere dağıtıldıysa ikinci kez düşülmediği yazılır.
 */
export function FixedReconcile({ f }: { f: FixedMonthBreakdown }) {
  const proration = differs(f.proration, 0);
  const overrides = differs(f.overrides, 0);
  const manual = differs(f.manual, 0);
  const expenses = differs(f.expenses, 0);
  const listShare = f.listShare && differs(f.listShare.amount, 0) ? f.listShare : null;
  const water = f.waterExcluded > 0;
  const names = (xs: { label: string }[]) =>
    xs
      .slice(0, 3)
      .map((x) => x.label)
      .join(", ") + (xs.length > 3 ? "…" : "");
  // Şube seçiliyken işletme geneli giderler (Faz 5): şubenin kârına girmez, bilgi olarak toplamı
  // "Yalnız not" kipinde (İşletme geneli giderler alanı, şube ayrımı parça 6) tutar yazılmaz
  const shared = f.sharedHidden ? ` ${SHARED_COSTS_NOTE}.` : f.shared > 0 ? ` İşletme geneli payı (bilgi): ${tl(f.shared)}; şubenin kârına girmez, Tümü'de bir kez sayılır.` : "";
  if (!proration && !overrides && !manual && !expenses && !listShare) {
    return (
      <p className="text-xs leading-5 text-ink-mute">
        Sabit giderler bu ay standart aylık tutarlarla düşüldü ({tl(f.standard)}).
        {water ? ` SU GİDERİ (${tl(f.waterExcluded)}) reçetelerde su + buz maliyeti olarak sayıldığı için burada ikinci kez düşülmedi.` : ""}
        {f.basis === "standard" ? " Açık gün sayısı girilmedi; girilince sabit giderler açık gün oranıyla hesaplanır." : ""}
        {shared}
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
        <InfoTip text="Standart aylık sabit gider: Sabit giderler ve Maaşlar'daki kalemlerin bir aylık tutarı. Net kâr o ayın Gelir-gider tutarlarını kullanır: kalemler açık gün oranıyla bölünür (açık günü kasa raporlarından gelen ayda ayın geçen günüyle: kapalı gün kira ve maaşı düşürmez), Gelir-gider'de elle düzeltilen hücreler, yalnızca bu aya yazılan satırlar (doğalgaz, ciro kirası, harici…) ve Harcamalar sayfasındaki aylık harcamalar eklenir. Fark aşağıda ayrı satırlarda." />
      </h3>
      <div className="divide-y divide-line">
        <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
          <span className="text-ink-mute">Standart aylık sabit gider</span>
          <span className="text-ink tabular">{tl(f.standard)}</span>
        </div>
        {proration ? row(prorationLabel(f), f.proration) : null}
        {overrides ? row("Gelir-gider'de düzeltilen tutarlar", f.overrides, names(f.overrideRows)) : null}
        {manual ? row("Bu aya özel giderler (Gelir-gider)", f.manual, names(f.manualRows)) : null}
        {expenses ? row("Aylık harcamalar", f.expenses, names(f.lines.filter((l) => l.key.startsWith("expense:") && differs(l.value, 0)))) : null}
        {listShare ? row(listShareLabel(listShare), listShare.amount, "Süren ayda yapıştırılan satış listesi ayın bugüne kadarki gününün bir kısmını kapsıyor") : null}
        {row("Bu ay düşülen", f.total, undefined, true)}
      </div>
      {water ? (
        <p className="pb-1 text-xs leading-5 text-ink-mute">
          SU GİDERİ ({tl(f.waterExcluded)}) reçetelerde su + buz maliyeti olarak sayıldığı için burada ikinci kez düşülmedi.
        </p>
      ) : null}
      {shared ? <p className="pb-1 text-xs leading-5 text-ink-mute">{shared.trim()}</p> : null}
    </Well>
  );
}
