"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { num, pct, tl, tlUnit } from "@/lib/format";

// AkmanOS renklerinden doğrulanmış kategorik sıra (dataviz/validate_palette.js, beyaz ve #f4f4f5 zemin, tüm çiftler):
// 1 mavi #2563eb (ciro) · 2 turuncu #e8590c (gider) · 3 yeşil #16a34a (kâr). Yeşil–turuncu renk körlüğünde 6.8 ΔE:
// bu yüzden seriler ayrıca işaret türüyle (sütun / çizgi), lejant ve ipucuyla ayrılır.
export const SERIES = ["#2563eb", "#e8590c", "#16a34a"] as const;
const GRID = "#e4e4e7";
const AXIS = "#d4d4d8";
const MUTED = "#a1a1aa";
const INK = "#171717";
const FONT = { fontSize: 12, fontFamily: "var(--font-geist-sans), sans-serif" };

function TipBox({ title, rows }: { title?: ReactNode; rows: { color?: string; label: ReactNode; value: ReactNode }[] }) {
  return (
    <div className="min-w-44 rounded-xl bg-surface px-3 py-2.5 text-xs shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
      {title ? <p className="mb-1.5 font-medium text-ink-mute">{title}</p> : null}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-ink-mute">
            {r.color ? <span className="inline-block size-2 rounded-full" style={{ background: r.color }} /> : null}
            {r.label}
          </span>
          <span className="font-semibold text-ink tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Eksen etiketlerinde komşu değerleri ayırt edecek kadar ondalık (₺/gr gibi küçük birimlerde 4'e kadar) */
function tickDigits(values: number[]): number {
  if (!values.length) return 2;
  const max = Math.max(...values.map(Math.abs));
  const span = Math.max(...values) - Math.min(...values) || max;
  if (!(span > 0)) return 2;
  return Math.min(4, Math.max(max >= 100 ? 0 : 2, Math.ceil(-Math.log10(span / 4))));
}

/** Tek serili yatay çubuk grafik (kategori marjı, gider dağılımı) */
export function HBarChart({
  data,
  format = "money",
  height,
  valueLabel = "Değer",
}: {
  data: { label: string; value: number; sub?: string }[];
  format?: "money" | "percent";
  height?: number;
  valueLabel?: string;
}) {
  const fmt = (v: number) => (format === "percent" ? pct(v) : tl(v));
  const h = height ?? Math.max(160, data.length * 34 + 30);
  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 4 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tickLine={false}
            axisLine={{ stroke: AXIS }}
            tick={{ fill: INK, ...FONT }}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TipBox
                  title={(payload[0].payload as { label: string }).label}
                  rows={[{ color: SERIES[0], label: valueLabel, value: fmt(payload[0].value as number) }]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" fill={SERIES[0]} barSize={18} radius={[0, 6, 6, 0]} isAnimationActive={false}>
            <LabelList dataKey="value" position="right" formatter={(v) => fmt(Number(v))} style={{ fill: INK, ...FONT, fontWeight: 500 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Menü mühendisliği: x = satış payı, y = birim kâr; dörtte bir bölgeler sınıfı gösterir */
export function MenuMatrix({
  points,
  popThreshold,
  avgCm,
}: {
  points: { name: string; mix: number; cm: number; qty: number; cls: string }[];
  popThreshold: number;
  avgCm: number;
}) {
  const maxMix = Math.max(popThreshold * 2, ...points.map((p) => p.mix)) * 1.08;
  const cms = points.map((p) => p.cm);
  const minCm = Math.min(0, ...cms);
  const maxCm = Math.max(avgCm * 1.5, ...cms) * 1.08;
  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 20, bottom: 28, left: 8 }}>
          <CartesianGrid stroke={GRID} />
          <ReferenceArea x1={popThreshold} x2={maxMix} y1={avgCm} y2={maxCm} fill={SERIES[0]} fillOpacity={0.06} label={{ value: "Yıldız", position: "insideTopRight", fill: MUTED, fontSize: 12 }} />
          <ReferenceArea x1={popThreshold} x2={maxMix} y1={minCm} y2={avgCm} fill={SERIES[1]} fillOpacity={0.06} label={{ value: "Beygir", position: "insideBottomRight", fill: MUTED, fontSize: 12 }} />
          <ReferenceArea x1={0} x2={popThreshold} y1={avgCm} y2={maxCm} fill={SERIES[2]} fillOpacity={0.05} label={{ value: "Bilmece", position: "insideTopLeft", fill: MUTED, fontSize: 12 }} />
          <ReferenceArea x1={0} x2={popThreshold} y1={minCm} y2={avgCm} fill="#71717a" fillOpacity={0.06} label={{ value: "Zayıf", position: "insideBottomLeft", fill: MUTED, fontSize: 12 }} />
          <XAxis
            type="number"
            dataKey="mix"
            domain={[0, maxMix]}
            tickFormatter={(v) => pct(v, 0)}
            tick={{ fill: MUTED, ...FONT }}
            tickLine={false}
            axisLine={{ stroke: AXIS }}
            label={{ value: "Satış payı (adet)", position: "insideBottom", offset: -16, fill: MUTED, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="cm"
            domain={[minCm, maxCm]}
            tickFormatter={(v) => `${num(v, 0)} ₺`}
            tick={{ fill: MUTED, ...FONT }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <ZAxis range={[70, 70]} />
          <ReferenceLine x={popThreshold} stroke={AXIS} />
          <ReferenceLine y={avgCm} stroke={AXIS} />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { name: string; mix: number; cm: number; qty: number; cls: string };
              return (
                <TipBox
                  title={p.name}
                  rows={[
                    { label: "Birim kâr", value: tl(p.cm, 1) },
                    { label: "Satış", value: `${num(p.qty)} adet (${pct(p.mix)})` },
                    { label: "Sınıf", value: p.cls },
                  ]}
                />
              );
            }}
          />
          <Scatter data={points} fill={SERIES[0]} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tek serili çizgi (fiyat geçmişi) */
export function PriceLine({ data, valueLabel = "Birim maliyet" }: { data: { label: string; value: number }[]; valueLabel?: string }) {
  const digits = tickDigits(data.map((d) => d.value));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fill: MUTED, ...FONT }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: MUTED, ...FONT }} width={64} tickFormatter={(v) => num(v, digits)} domain={["auto", "auto"]} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox title={label} rows={[{ color: SERIES[0], label: valueLabel, value: tlUnit(payload[0].value as number) }]} />
              ) : null
            }
          />
          <Line
            type="stepAfter"
            dataKey="value"
            stroke={SERIES[0]}
            strokeWidth={2}
            dot={{ r: 4, fill: SERIES[0], stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
