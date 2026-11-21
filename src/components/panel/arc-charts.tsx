"use client";

// Arc UI grafiklerinin panel sarmalayıcıları (src/components/arc/README.md). Sunucu bileşeni yalnız düz veri verir;
// biçimleyici (tl), seri renkleri ve Türkçe etiketler burada, çünkü işlev sunucudan istemciye geçmez. Her grafik `.arc`
// kabında: Arc belirteçleri (foundation.css) yalnız onun içinde geçerli.

import { BarChart } from "@/components/arc/bar-chart/bar-chart";
import { LineChart, type LineChartSeries } from "@/components/arc/line-chart/line-chart";
import { Sparkline } from "@/components/arc/sparkline/sparkline";
import { num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Eksen etiketi: 12 B, 1,2 Mn (charts.tsx ile aynı kısaltma) */
function compactTl(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${num(v / 1_000_000, 1)} Mn`;
  if (a >= 1_000) return `${num(v / 1_000, 0)} B`;
  return num(v, 0);
}

const money = (v: number) => tl(v);

export interface YearPoint {
  /** YYYY-MM */
  key: string;
  /** "Ekim 2026" (ipucu) */
  label: string;
  /** "Eki" (eksen) */
  axis: string;
  revenue: number;
  expenses: number;
  profit: number;
}

/**
 * Seriler: ciro, gider, kâr (kesik çizgi). Ciro alanı yalnız eksen sıfırdan başlarken dolu: Arc alanı grafiğin dibine
 * kadar boyar, zararlı ay ekseni eksiye indirince alan sıfırın altına taşmasın
 */
const yearSeries = (area: boolean): LineChartSeries[] => [
  { key: "revenue", label: "Ciro (KDV hariç)", color: "var(--series-1)", area },
  { key: "expenses", label: "Giderler", color: "var(--series-2)" },
  { key: "profit", label: "Kâr / zarar", color: "var(--series-3)", dashed: true },
];

/** Genel bakış › yıllık gelir-gider: aylık ciro, gider ve kâr (Gelir-gider tablosundan) */
export function YearLineChart({ data, label, className }: { data: YearPoint[]; label: string; className?: string }) {
  const area = data.every((d) => d.revenue >= 0 && d.expenses >= 0 && d.profit >= 0);
  return (
    <div className={cn("arc", className)}>
      <LineChart
        label={label}
        categoryLabel="Ay"
        series={yearSeries(area)}
        data={data.map((d) => ({ key: d.key, label: d.label, axisLabel: d.axis, values: { revenue: d.revenue, expenses: d.expenses, profit: d.profit } }))}
        formatValue={money}
        formatTick={compactTl}
        height={260}
        emptyLabel="Bu yıl için Gelir-gider verisi yok"
      />
    </div>
  );
}

export interface DayBar {
  /** YYYY-MM-DD */
  key: string;
  /** "14 Ekim Salı" (ipucu ve okuyucu) */
  label: string;
  /** "14" (eksen) */
  axis: string;
  value: number;
}

/** Genel bakış › ayın günlük cirosu: kasa raporlarından her günün cirosu ve ortalama çizgisi */
export function DailyRevenueBars({ days, label, period, className }: { days: DayBar[]; label: string; period: string; className?: string }) {
  return (
    <div className={cn("arc", className)}>
      <BarChart
        label={label}
        period={period}
        data={days.map((d) => ({ key: d.key, label: d.label, axisLabel: d.axis, value: d.value }))}
        averageLabel="Günlük ortalama"
        valueLabel="Günün cirosu"
        categoryLabel="Gün"
        // ₺ ayrı birim olarak (başlıkta küçük, eksende yok): eksen etiketleri dar sütuna sığar
        unit="₺"
        formatValue={(v) => num(v, 0)}
        height={180}
      />
    </div>
  );
}

/** Kısa bir dizinin çizgisi (Bugün › şubelerin son günleri); tek noktada çizilmez */
export function MoneySparkline({
  points,
  label,
  value,
  change,
  tone = "accent",
  className,
}: {
  points: { label: string; value: number }[];
  label: string;
  /** Başlıktaki rakam (ör. son günün cirosu) */
  value?: string;
  /** Sağdaki kısa not; ok tuşlarıyla gezerken yerini noktanın gününe bırakır */
  change?: string;
  tone?: "accent" | "success" | "warning" | "danger";
  className?: string;
}) {
  if (points.length < 2) return null;
  return (
    <div className={cn("arc", className)}>
      <Sparkline
        data={points.map((p) => p.value)}
        labels={points.map((p) => p.label)}
        label={label}
        value={value}
        change={change}
        tone={tone}
        formatValue={money}
        width={320}
        height={40}
      />
    </div>
  );
}
