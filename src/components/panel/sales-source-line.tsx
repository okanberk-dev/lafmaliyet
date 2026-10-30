import type { SalesSource } from "@/lib/sales-source";

/**
 * Başlığın altındaki satış kaynağı satırı (docs/planlar/ux-sade.md §10): PageHeader `meta`'sına tek satır. Genel bakış,
 * Satışlar, Gelir-gider, Ürünler & kârlılık, Tutarlılık ve Analiz & senaryo kullanır; yalnız yönetici ekranları.
 * Sunucu bileşeni
 */
export function SalesSourceLine({ source }: { source: Pick<SalesSource, "line" | "kind"> }) {
  return <span data-sales-source={source.kind}>{source.line}</span>;
}
