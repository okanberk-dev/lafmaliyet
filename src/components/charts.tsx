"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
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

import { num, pct, tl } from "@/lib/format";

// Doğrulanmış kategorik palet (dataviz/validate_palette.js, açık zemin #ffffff, tüm çiftler):
// 1 karamel #b8682a · 2 mavi #2a78d6 · 3 su yeşili #1baf7a (3:1 altı → görünür etiket / tablo ile)
export const SERIES = ["#b8682a", "#2a78d6", "#1baf7a"] as const;
const GRID = "#ece6df";
const AXIS = "#d9cfc4";
const MUTED = "#8a7a70";
const INK = "#2a1f1a";

const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${num(v / 1_000_000, 1)} Mn`;
  if (a >= 1_000) return `${num(v / 1_000, 0)} B`;
  return num(v, 0);
};

function TipBox({ title, rows }: { title?: ReactNode; rows: { color?: string; label: ReactNode; value: ReactNode }[] }) {
  return (
    <div className="min-w-40 rounded-lg border border-coffee-100 bg-white px-3 py-2 text-xs shadow-lg">
      {title ? <p className="mb-1 text-coffee-600">{title}</p> : null}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-coffee-600">
            {r.color ? <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} /> : null}
            {r.label}
          </span>
          <span className="font-semibold text-coffee-950 tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
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
            tick={{ fill: INK, fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(184,104,42,0.06)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TipBox
                  title={(payload[0].payload as { label: string }).label}
                  rows={[{ color: SERIES[0], label: valueLabel, value: fmt(payload[0].value as number) }]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" fill={SERIES[0]} barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="value" position="right" formatter={(v) => fmt(Number(v))} style={{ fill: INK, fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Aylık ciro / gider (sütun) ve kâr-zarar (çizgi) — tek eksen, aynı birim (₺) */
export function TrendChart({ data }: { data: { label: string; revenue: number; expenses: number; profit: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fill: MUTED, fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 12 }} tickFormatter={compact} width={56} />
          <ReferenceLine y={0} stroke={AXIS} />
          <Tooltip
            cursor={{ fill: "rgba(42,31,26,0.04)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox
                  title={label}
                  rows={[
                    { color: SERIES[0], label: "Ciro (KDV hariç)", value: tl(payload.find((p) => p.dataKey === "revenue")?.value as number) },
                    { color: SERIES[1], label: "Giderler", value: tl(payload.find((p) => p.dataKey === "expenses")?.value as number) },
                    { color: SERIES[2], label: "Kâr / zarar", value: tl(payload.find((p) => p.dataKey === "profit")?.value as number) },
                  ]}
                />
              ) : null
            }
          />
          <Legend
            verticalAlign="top"
            align="left"
            height={30}
            iconSize={10}
            wrapperStyle={{ fontSize: 12, color: INK }}
            formatter={(v) => <span style={{ color: INK }}>{v}</span>}
          />
          <Bar name="Ciro (KDV hariç)" dataKey="revenue" fill={SERIES[0]} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar name="Giderler" dataKey="expenses" fill={SERIES[1]} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line
            name="Kâr / zarar"
            type="monotone"
            dataKey="profit"
            stroke={SERIES[2]}
            strokeWidth={2}
            dot={{ r: 4, fill: SERIES[2], stroke: "#fff", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
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
          <ReferenceArea x1={popThreshold} x2={maxMix} y1={avgCm} y2={maxCm} fill="#1baf7a" fillOpacity={0.05} label={{ value: "Yıldız", position: "insideTopRight", fill: MUTED, fontSize: 12 }} />
          <ReferenceArea x1={popThreshold} x2={maxMix} y1={minCm} y2={avgCm} fill="#b8682a" fillOpacity={0.05} label={{ value: "Beygir", position: "insideBottomRight", fill: MUTED, fontSize: 12 }} />
          <ReferenceArea x1={0} x2={popThreshold} y1={avgCm} y2={maxCm} fill="#2a78d6" fillOpacity={0.04} label={{ value: "Bilmece", position: "insideTopLeft", fill: MUTED, fontSize: 12 }} />
          <ReferenceArea x1={0} x2={popThreshold} y1={minCm} y2={avgCm} fill="#8a7a70" fillOpacity={0.05} label={{ value: "Zayıf", position: "insideBottomLeft", fill: MUTED, fontSize: 12 }} />
          <XAxis
            type="number"
            dataKey="mix"
            domain={[0, maxMix]}
            tickFormatter={(v) => pct(v, 0)}
            tick={{ fill: MUTED, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: AXIS }}
            label={{ value: "Satış payı (adet)", position: "insideBottom", offset: -16, fill: MUTED, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="cm"
            domain={[minCm, maxCm]}
            tickFormatter={(v) => `${num(v, 0)} ₺`}
            tick={{ fill: MUTED, fontSize: 12 }}
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
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fill: MUTED, fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 12 }} width={64} tickFormatter={(v) => num(v, 2)} domain={["auto", "auto"]} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox title={label} rows={[{ color: SERIES[0], label: valueLabel, value: tl(payload[0].value as number, 2) }]} />
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
