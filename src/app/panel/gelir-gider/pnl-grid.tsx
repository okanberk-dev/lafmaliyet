"use client";

import { CalendarRange, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { InfoTip, SegmentStrip } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { TableWrap, TD, TH } from "@/components/ui/table";
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

/** Yıl şeridinin bir ayı (sayfa hesaplar, tablo gösterir) */
export interface StripMonth {
  key: string;
  tone: "good" | "bad" | "warn" | "empty";
  label: string;
  /** Çubuğun altındaki kısa ad, ör. "Eyl" */
  short: string;
}

/**
 * Sunucu sayfasının özet rakamları için AkmanOS sayacı (charts/animated-number).
 * Biçim işlevi sunucudan istemciye geçemediği için adıyla verilir.
 */
export function CountUp({ value, format = "tl" }: { value: number | null; format?: "tl" | "pct" }) {
  if (value === null) return <>{format === "pct" ? pct(null) : tl(null)}</>;
  return <AnimatedNumber value={value} format={format === "pct" ? (v) => pct(v) : (v) => tl(v)} className="tabular" />;
}

/** Çok yıl olduğunda sekmeler yerine açılır liste */
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

/**
 * Sabit ilk sütun: paylaşılan TH/TD `sticky` (opak panel zemini, satır üzerine gelince aynı ton) +
 * genişlik ve sağında ince çizgi. Telefonda dar, geniş ekranda tam ad sığar.
 */
const STICKY = "w-44 min-w-44 pl-5 pr-3 shadow-[inset_-1px_0_0_var(--color-line-strong)] sm:w-72 sm:min-w-72";
/** Yıl toplamı sütunu */
const YEAR_COL = "bg-ink/[0.03] pr-5 pl-3 text-right whitespace-nowrap tabular";
/**
 * Hücre çizgileri hücrede (border-separate): sabit sütun kayarken çizgisini korur.
 * Üzerine gelme tonu paylaşılan TR ile aynı (surface/60); sabit hücre TD sticky ile eşleşir.
 */
const ROW = "group transition-colors hover:bg-surface/60 [&>td]:border-t [&>td]:border-line";
/** Değer hücrelerinin ortak dolgusu (paylaşılan TD'nin 12px'i bu sık ızgarada fazla) */
const CELL = "px-1.5 py-1";

function EditableCell({
  value,
  computed,
  overridden,
  kind,
  format,
  label,
  onSave,
}: {
  value: number | null;
  computed: number | null;
  overridden: boolean;
  kind: string;
  format?: string;
  /** Ekran okuyucu için "Satır · Ay" */
  label: string;
  onSave: (v: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** Düzenlemeye başlarken gösterilen metin: değişmeden çıkılırsa kaydedilmez (2 ondalığa yuvarlanmış değer üzerine yazılmasın) */
  const startText = useRef("");
  /** Esc ile vazgeçildi: ardından gelebilecek blur kaydetmesin */
  const cancelled = useRef(false);
  /** Klavyeyle (Enter/Esc) bitince odak hücre düğmesine dönsün */
  const refocus = useRef(false);
  const negative = value !== null && value < 0;
  const invalid = text.trim() !== "" && parseNumberTR(text.trim()) === null;

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          if (cancelled.current) return;
          const t = text.trim();
          const v = t === "" ? null : parseNumberTR(t);
          if (t !== "" && v === null) {
            toast.error("Geçerli bir sayı girin");
            setEditing(false);
            return;
          }
          if (t === startText.current.trim() || v === value || (v === null && !overridden && kind !== "manual")) {
            setEditing(false);
            return;
          }
          setBusy(true);
          try {
            await onSave(v);
          } finally {
            setBusy(false);
            setEditing(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            refocus.current = true;
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            cancelled.current = true;
            refocus.current = true;
            setEditing(false);
          }
        }}
        className={cn(
          // Form kontrolleriyle aynı dil: beyaz, ince halka, odakta mürekkep halkası; telefonda 16px (iOS yakınlaştırmasın)
          "h-8 w-full min-w-24 rounded-lg border-0 bg-surface px-2 text-right text-base tabular ring-2 ring-ink/20 outline-none pointer-coarse:h-9 sm:text-sm",
          "aria-invalid:bg-bad-soft aria-invalid:text-bad aria-invalid:ring-bad/50 disabled:opacity-60",
          // .cell-input katmansız: geçersizken kırmızı metnin önüne geçmesin
          !invalid && "cell-input",
        )}
      />
    );
  }
  return (
    <button
      type="button"
      ref={(el) => {
        if (el && refocus.current) {
          refocus.current = false;
          el.focus();
        }
      }}
      onClick={() => {
        const initial = value === null ? "" : format === "days" ? String(value) : num(value, 2);
        startText.current = initial;
        cancelled.current = false;
        refocus.current = false;
        setText(initial);
        setEditing(true);
      }}
      title={overridden && computed !== null ? `Elle girildi. Hesaplanan: ${fmt(computed, format)}` : "Değer girmek için tıklayın"}
      aria-label={`${label}: ${fmt(value, format)}. Değiştirmek için tıklayın`}
      className={cn(
        "relative flex h-8 w-full min-w-24 cursor-text items-center justify-end rounded-lg bg-surface/80 px-2 tabular ring-1 ring-line ring-inset transition-[background-color,box-shadow] pointer-coarse:h-9",
        "hover:bg-surface hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-ink/25",
        // .cell-input katmansız bir kural olduğu için negatifte kırmızının önüne geçmesin
        (overridden || kind === "manual") && !negative && "cell-input",
        overridden && kind === "auto" && "bg-info-soft font-medium hover:bg-info-soft",
        negative && "text-bad",
        value === null && "text-ink-quiet",
      )}
    >
      {fmt(value, format)}
      {overridden && kind === "auto" ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-info" aria-hidden="true" /> : null}
    </button>
  );
}

export function PnlGrid({
  year,
  months,
  activeMonths,
  sections,
  openDays,
  strip,
  latestMonth,
}: {
  year: number;
  months: string[];
  activeMonths: string[];
  sections: GridSection[];
  openDays: (number | null)[];
  strip: StripMonth[];
  /** Verisi olan son ay: şeritte çerçevelenir */
  latestMonth?: string;
}) {
  const reduce = useCalmMotion();
  const [showAll, setShowAll] = useState(activeMonths.length === 0);
  const visibleIdx = months.map((m, i) => ({ m, i })).filter(({ m }) => showAll || activeMonths.includes(m));
  const profitable = strip.filter((s) => s.tone === "good").length;
  const losing = strip.filter((s) => s.tone === "bad").length;

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
      <CardHeader
        icon={<CalendarRange />}
        title={`${year} gelir-gider tablosu`}
        description="KDV hariç. Hücreye tıklayıp değer girin; Enter kaydeder, Esc vazgeçer."
        actions={
          <Segmented<"active" | "all">
            label="Gösterilen aylar"
            value={showAll ? "all" : "active"}
            onChange={(v) => setShowAll(v === "all")}
            options={[
              { value: "active", label: "Aktif aylar", count: activeMonths.length },
              { value: "all", label: "12 ay" },
            ]}
          />
        }
      />

      <CardContent className="pb-4">
        <Well className="p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <p className="text-[13px] font-medium text-ink">
              Aylara göre kâr / zarar
              <span className="ml-2 font-normal text-ink-mute tabular">
                <AnimatedNumber value={profitable} format={(v) => num(v)} /> kârlı · <AnimatedNumber value={losing} format={(v) => num(v)} /> zararlı ay
              </span>
            </p>
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute">
              <LegendItem tone="good">Kâr</LegendItem>
              <LegendItem tone="bad">Zarar</LegendItem>
              <LegendItem tone="warn">Ciro girilmedi</LegendItem>
              <LegendItem tone="empty">Veri yok</LegendItem>
            </ul>
          </div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            {/* Şerit beyaz kuyuda: son ayın çerçeve boşluğu da beyaz olsun (bileşen panel zeminine göre çizer) */}
            <SegmentStrip segments={strip} activeKey={latestMonth} showLabels className="[&_li]:ring-offset-surface" />
          </motion.div>
        </Well>
      </CardContent>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-5 pb-3 text-[13px] text-ink-mute">
        <span className="flex items-center gap-1.5">
          <span className="cell-input inline-flex h-6 items-center rounded-md bg-surface px-1.5 font-semibold tabular ring-1 ring-line ring-inset">123</span>
          elle girilen / girilebilen
        </span>
        <span className="flex items-center gap-1.5">
          <span className="relative inline-flex h-6 w-9 items-center rounded-md bg-info-soft ring-1 ring-line ring-inset">
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-info" />
          </span>
          hesaplananın üzerine yazılmış
          <InfoTip text="İçini silip Enter'a basınca hücre hesaplanan değere döner." />
        </span>
      </div>

      <TableWrap className="px-0 pb-0">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <TH sticky className={STICKY}>
                Kalem
              </TH>
              {visibleIdx.map(({ m, i }) => (
                <TH key={m} numeric className="min-w-28 px-1.5">
                  <span className="px-2">{MONTH_NAMES[i]}</span>
                </TH>
              ))}
              <TH numeric className={cn(YEAR_COL, "min-w-32 text-ink")}>
                {year} yılı
              </TH>
            </tr>
          </thead>
          <tbody>
            <tr className={cn(ROW, "[&>td]:border-t-0")}>
              <TD sticky className={cn(STICKY, "py-1.5 font-medium")}>
                <span className="flex items-center gap-1.5">
                  Açık gün sayısı
                  <InfoTip text="O ay işletmenin açık olduğu gün. Kira, personel, reklam gibi aylık giderler gün ÷ ayın gün sayısı oranıyla hesaplanır." />
                </span>
              </TD>
              {visibleIdx.map(({ m, i }) => (
                <td key={m} className={CELL}>
                  <EditableCell
                    value={openDays[i]}
                    computed={null}
                    overridden={openDays[i] !== null}
                    kind="manual"
                    format="days"
                    label={`Açık gün sayısı · ${MONTH_NAMES[i]}`}
                    onSave={(v) => save(m, "openDays", v)}
                  />
                </td>
              ))}
              <td className={cn(YEAR_COL, "font-semibold text-ink")}>{num(openDays.reduce<number>((a, v) => a + (v ?? 0), 0))}</td>
            </tr>
            {sections.map((sec) => (
              <SectionRows key={sec.key} sec={sec} visibleIdx={visibleIdx} onSave={save} />
            ))}
          </tbody>
        </table>
      </TableWrap>

      <CardFooter className="justify-start gap-2">
        <RotateCcw size={14} className="shrink-0 text-ink-quiet" aria-hidden="true" />
        <span>
          Bir hücreyi hesaplanan değere döndürmek için içini silip Enter&apos;a basın. Faturadan gelen mal alışlarını değiştirmek için{" "}
          <Link href="/panel/faturalar" className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
            Faturalar
          </Link>{" "}
          sayfasını kullanın.
        </span>
      </CardFooter>
    </Card>
  );
}

/**
 * Şerit açıklaması. Örnek kare, şeridin kendisiyle (SegmentStrip) çizilir:
 * renkler paylaşılan bileşende tanımlı, burada tekrar yazılmaz.
 */
function LegendItem({ tone, children }: { tone: StripMonth["tone"]; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <div aria-hidden="true" className="flex">
        <SegmentStrip segments={[{ key: tone, tone, label: children }]} className="w-2.5 [&_ul]:h-2.5" />
      </div>
      {children}
    </li>
  );
}

function SectionRows({
  sec,
  visibleIdx,
  onSave,
}: {
  sec: GridSection;
  visibleIdx: { m: string; i: number }[];
  onSave: (month: string, key: string, v: number | null) => Promise<void>;
}) {
  return (
    <>
      <tr>
        <TD sticky className={cn(STICKY, "pt-6 pb-2 text-[13px] font-semibold text-ink-soft")}>
          {sec.label}
        </TD>
        <td colSpan={visibleIdx.length + 1} className="pt-6 pb-2" />
      </tr>
      {sec.rows.map(({ def, cells, total }) => {
        const isProfit = def.key === "profit" || def.key === "ratio:profit";
        const tone = (v: number | null) => (v !== null && v < 0 ? "text-bad" : isProfit && v !== null && v > 0 ? "text-good" : null);
        return (
          <tr key={`${sec.key}-${def.key}`} className={cn(ROW, def.strong && "font-semibold [&>td]:border-line-strong")}>
            <TD sticky className={cn(STICKY, "py-1.5", def.strong ? "text-ink" : "text-ink-soft")}>
              <span className="flex items-center gap-1.5">
                {def.label}
                {def.hint ? <InfoTip text={def.hint} /> : null}
              </span>
            </TD>
            {visibleIdx.map(({ m, i }) => {
              const c = cells[i];
              return (
                <td key={m} className={cn(CELL, "text-right")}>
                  {def.editable ? (
                    <EditableCell
                      value={c.value}
                      computed={c.computed}
                      overridden={c.overridden}
                      kind={def.kind}
                      format={def.format}
                      label={`${def.label} · ${MONTH_NAMES[i]}`}
                      onSave={(v) => onSave(m, def.key, v)}
                    />
                  ) : (
                    <span
                      className={cn(
                        "block px-2 py-1 whitespace-nowrap tabular",
                        def.strong ? "text-ink" : "text-ink-mute",
                        tone(c.value),
                        c.value === null && "text-ink-quiet",
                      )}
                    >
                      {fmt(c.value, def.format)}
                    </span>
                  )}
                </td>
              );
            })}
            <td className={cn(YEAR_COL, def.strong ? "font-semibold text-ink" : "text-ink-soft", tone(total))}>{fmt(total, def.format)}</td>
          </tr>
        );
      })}
    </>
  );
}
