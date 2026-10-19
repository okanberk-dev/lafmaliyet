"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/misc";
import type { PnlCell, PnlRowDef } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { MONTH_NAMES } from "@/lib/constants";
import { num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setMonthField, setPnlCell } from "@/server/actions/pnl";

export interface GridSection {
  key: string;
  label: string;
  rows: { def: PnlRowDef; cells: PnlCell[]; total: number | null }[];
}

export function YearPicker({ year, years }: { year: number; years: number[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      value={year}
      onChange={(e) => start(() => router.push(`/panel/gelir-gider?yil=${e.target.value}`))}
      className={cn("w-32", pending && "opacity-60")}
      aria-label="Yıl"
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </Select>
  );
}

function fmt(v: number | null, format?: string) {
  if (v === null || v === undefined) return "–";
  if (format === "percent") return pct(v);
  if (format === "days") return num(v);
  return tl(v);
}

function EditableCell({
  value,
  computed,
  overridden,
  kind,
  format,
  onSave,
}: {
  value: number | null;
  computed: number | null;
  overridden: boolean;
  kind: string;
  format?: string;
  onSave: (v: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          const t = text.trim();
          const v = t === "" ? null : parseNumberTR(t);
          if (t !== "" && v === null) {
            toast.error("Geçerli bir sayı girin");
            setEditing(false);
            return;
          }
          if (v === value || (v === null && !overridden && kind !== "manual")) {
            setEditing(false);
            return;
          }
          setBusy(true);
          await onSave(v);
          setBusy(false);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-full min-w-24 rounded border border-crema bg-white px-1.5 text-right text-xs tabular outline-none ring-2 ring-crema/25"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setText(value === null ? "" : format === "days" ? String(value) : num(value, 2));
        setEditing(true);
      }}
      title={overridden && computed !== null ? `Elle girildi. Hesaplanan: ${fmt(computed, format)}` : "Değer girmek için tıklayın"}
      className={cn(
        "group relative w-full rounded px-1.5 py-1 text-right tabular hover:bg-sky-50 hover:ring-1 hover:ring-sky-200",
        overridden || kind === "manual" ? "cell-input" : "",
        overridden && kind === "auto" && "bg-sky-50/60 font-medium",
        value !== null && value < 0 && "text-rose-700",
      )}
    >
      {fmt(value, format)}
      {overridden && kind === "auto" ? <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-sky-500" /> : null}
    </button>
  );
}

export function PnlGrid({
  months,
  activeMonths,
  sections,
  openDays,
}: {
  months: string[];
  activeMonths: string[];
  sections: GridSection[];
  openDays: (number | null)[];
}) {
  const [showAll, setShowAll] = useState(activeMonths.length === 0);
  const visibleIdx = months.map((m, i) => ({ m, i })).filter(({ m }) => showAll || activeMonths.includes(m));

  async function save(month: string, key: string, v: number | null) {
    const res =
      key === "revenue"
        ? await setMonthField(month, "posRevenue", v)
        : key === "openDays"
          ? await setMonthField(month, "openDays", v)
          : await setPnlCell(month, key, v);
    if (!res.ok) toast.error(res.error);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-coffee-100 px-4 py-3 text-sm">
        <div className="flex items-center gap-4 text-xs text-coffee-600">
          <span className="flex items-center gap-1.5">
            <span className="cell-input font-semibold">123</span> elle girilen / girilebilen
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sky-500" /> hesaplananın üzerine yazılmış (boş bırakıp Enter = otomatiğe dön)
          </span>
        </div>
        <label className="flex items-center gap-2 text-coffee-700">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-coffee-800" />
          12 ayın tamamını göster
        </label>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-coffee-950 text-coffee-50">
              <th className="sticky left-0 z-10 min-w-72 bg-coffee-950 px-3 py-2.5 text-left font-semibold">KALEM</th>
              {visibleIdx.map(({ m, i }) => (
                <th key={m} className="min-w-28 px-2 py-2.5 text-right font-semibold">
                  {MONTH_NAMES[i].toLocaleUpperCase("tr-TR")}
                </th>
              ))}
              <th className="min-w-32 bg-coffee-900 px-2 py-2.5 text-right font-semibold">{months[0].slice(0, 4)} YILI</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-coffee-100 bg-coffee-50">
              <td className="sticky left-0 z-[1] bg-coffee-50 px-3 py-1.5 font-semibold text-coffee-900">
                AÇIK GÜN SAYISI <InfoTip text="O ay işletmenin açık olduğu gün. Kira, personel, reklam gibi aylık giderler gün ÷ ayın gün sayısı oranıyla hesaplanır." />
              </td>
              {visibleIdx.map(({ m, i }) => (
                <td key={m} className="px-1 py-0.5">
                  <EditableCell value={openDays[i]} computed={null} overridden={openDays[i] !== null} kind="manual" format="days" onSave={(v) => save(m, "openDays", v)} />
                </td>
              ))}
              <td className="bg-coffee-100/50 px-2 text-right font-semibold tabular">{num(openDays.reduce<number>((a, v) => a + (v ?? 0), 0))}</td>
            </tr>
            {sections.map((sec) => (
              <SectionRows key={sec.key} sec={sec} months={months} visibleIdx={visibleIdx} onSave={save} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 border-t border-coffee-100 px-4 py-2.5 text-xs text-coffee-500">
        <RotateCcw size={12} /> Bir hücreyi hesaplanan değere döndürmek için içini silip Enter&apos;a basın. Faturadan gelen mal alışlarını değiştirmek için Faturalar sayfasını kullanın.
      </div>
    </Card>
  );
}

function SectionRows({
  sec,
  months,
  visibleIdx,
  onSave,
}: {
  sec: GridSection;
  months: string[];
  visibleIdx: { m: string; i: number }[];
  onSave: (month: string, key: string, v: number | null) => Promise<void>;
}) {
  return (
    <>
      <tr className="border-y border-coffee-200 bg-coffee-100/70">
        <td className="sticky left-0 z-[1] bg-coffee-100 px-3 py-1.5 text-[11px] font-bold tracking-wider text-coffee-800" colSpan={1}>
          {sec.label}
        </td>
        <td colSpan={visibleIdx.length + 1} className="bg-coffee-100/70" />
      </tr>
      {sec.rows.map(({ def, cells, total }) => (
        <tr key={`${sec.key}-${def.key}`} className={cn("border-b border-coffee-50 hover:bg-coffee-50/40", def.strong && "bg-coffee-50/60 font-semibold")}>
          <td className={cn("sticky left-0 z-[1] px-3 py-1 text-coffee-900", def.strong ? "bg-coffee-50 font-semibold" : "bg-white")}>
            <span className="flex items-center gap-1.5">
              {def.label}
              {def.hint ? <InfoTip text={def.hint} /> : null}
            </span>
          </td>
          {visibleIdx.map(({ m, i }) => {
            const c = cells[i];
            return (
              <td key={m} className="px-1 py-0.5 text-right">
                {def.editable ? (
                  <EditableCell value={c.value} computed={c.computed} overridden={c.overridden} kind={def.kind} format={def.format} onSave={(v) => onSave(m, def.key, v)} />
                ) : (
                  <span className={cn("block px-1.5 py-1 tabular", c.value !== null && c.value < 0 && "text-rose-700", c.value === null && "text-coffee-300")}>
                    {fmt(c.value, def.format)}
                  </span>
                )}
              </td>
            );
          })}
          <td className={cn("bg-coffee-50/70 px-2 text-right tabular", total !== null && total < 0 && "text-rose-700", def.strong && "font-semibold")}>
            {fmt(total, def.format)}
          </td>
        </tr>
      ))}
      <tr className="h-2">
        <td colSpan={months.length + 2} />
      </tr>
    </>
  );
}
