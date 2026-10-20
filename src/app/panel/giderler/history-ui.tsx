"use client";

// "Hangi aydan itibaren?" seçimi, durdur / devam ettir pencereleri, tutar geçmişi ve açılır "Geçmiş" bölümü.
// Sabit giderler ve Personel aynı parçaları kullanır: iki ekranda da aynı soru, aynı dil.

import { ChevronDown, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";

import { EASE_OUT, SPRING_PRESS } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/misc";
import { useCalmMotion } from "@/components/ui/motion";
import { shiftMonth, type RangeStatus } from "@/lib/calc/engine";
import type { MonthRange } from "@/lib/calc/types";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import { monthsBetween, resumePlan, resumeText, stopText, type EffectText, type MonthChoice } from "./history-text";

/** Telefonda en az 40px dokunma alanı */
const TOUCH_BTN = "pointer-coarse:h-10";

/** Ay seçim listesinin bir seçeneği: "Ekim 2026 (bu ay)", "Eylül 2026 (geçmiş)" */
function monthOption(m: string, currentMonth: string) {
  return `${monthLabel(m)}${m === currentMonth ? " (bu ay)" : m < currentMonth ? " (geçmiş)" : ""}`;
}

export function MonthSelect({
  value,
  onChange,
  months,
  currentMonth,
  label,
  className,
}: {
  value: string;
  onChange: (m: string) => void;
  months: string[];
  currentMonth: string;
  label: string;
  className?: string;
}) {
  // Seçili değer listede yoksa (ör. çok eski bir bitiş ayı) yine de seçenek olarak görünsün
  const list = months.includes(value) ? months : [...months, value].sort();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={cn("w-auto min-w-44", className)}>
      {list.map((m) => (
        <option key={m} value={m}>
          {monthOption(m, currentMonth)}
        </option>
      ))}
    </Select>
  );
}

/** Seçimin etkisi: düz metin + kapanmış ay değişecekse turuncu uyarı */
export function EffectNote({ effect, className }: { effect: EffectText | null; className?: string }) {
  if (!effect || (!effect.text && !effect.warn)) return null;
  return (
    <div className={cn("space-y-1.5 text-xs leading-5", className)} aria-live="polite">
      {effect.text ? <p className="text-ink-soft">{effect.text}</p> : null}
      {effect.warn ? (
        <p className="flex items-start gap-1.5 font-medium text-warn">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{effect.warn}</span>
        </p>
      ) : null}
    </div>
  );
}

function Radio({
  name,
  checked,
  onSelect,
  children,
  hint,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink pointer-coarse:min-h-10">
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-ink pointer-coarse:size-5" />
      <span className="min-w-0">
        <span className="block">{children}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-mute">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * "Hangi aydan itibaren?": varsayılan bu ay; başka bir ay listeden seçilir. "Bütün aylar" (geçmişi de değiştiren
 * düzeltme) nadir kullanıldığı için "Gelişmiş" altında.
 */
export function MonthChoiceField({
  legend,
  tip,
  value,
  onChange,
  currentMonth,
  months,
  allLabel,
  allHint,
  effect,
}: {
  legend: string;
  tip?: ReactNode;
  value: MonthChoice;
  onChange: (c: MonthChoice) => void;
  currentMonth: string;
  months: string[];
  /** "Bütün aylar (geçmiş de değişir)" seçeneğinin metni; verilmezse seçenek yok */
  allLabel?: string;
  allHint?: string;
  effect?: EffectText | null;
}) {
  const id = useId();
  const [advanced, setAdvanced] = useState(value.mode === "all");
  const showAll = allLabel && (advanced || value.mode === "all");
  return (
    <div className="space-y-2.5 rounded-2xl bg-panel p-3.5">
      <p id={id} className="flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
        {legend}
        {tip ? <InfoTip text={tip} /> : null}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="space-y-2">
        <Radio name={id} checked={value.mode === "current"} onSelect={() => onChange({ ...value, mode: "current" })}>
          Bu ay · {monthLabel(currentMonth)}
        </Radio>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Radio name={id} checked={value.mode === "month"} onSelect={() => onChange({ ...value, mode: "month" })}>
            Başka bir ay
          </Radio>
          <MonthSelect
            value={value.month}
            onChange={(m) => onChange({ mode: "month", month: m })}
            months={months}
            currentMonth={currentMonth}
            label={`${legend}: ay`}
            className={cn("h-8", value.mode !== "month" && "opacity-70")}
          />
        </div>
        {showAll ? (
          <Radio name={id} checked={value.mode === "all"} onSelect={() => onChange({ ...value, mode: "all" })} hint={allHint}>
            {allLabel}
          </Radio>
        ) : null}
      </div>
      {allLabel && !showAll ? (
        <button
          type="button"
          onClick={() => setAdvanced(true)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md text-xs font-medium text-ink-mute hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none pointer-coarse:min-h-9"
        >
          Gelişmiş <ChevronDown size={13} aria-hidden="true" />
        </button>
      ) : null}
      <EffectNote effect={effect ?? null} />
    </div>
  );
}

/** Açılır bölüm (Geçmiş, Gelişmiş): başlık + kısa özet, tıklayınca yaylı açılır; kapalıyken içerik odaklanamaz */
export function Disclosure({
  title,
  summary,
  children,
  defaultOpen = false,
  className,
  headClassName,
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  headClassName?: string;
}) {
  const reduce = useCalmMotion();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none",
          headClassName,
        )}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {summary ? <span className="block text-[13px] text-ink-mute">{summary}</span> : null}
        </span>
        <motion.span
          className="inline-flex shrink-0 text-ink-mute"
          initial={false}
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_PRESS}
          aria-hidden="true"
        >
          <ChevronDown size={16} />
        </motion.span>
      </button>
      <motion.div
        id={id}
        initial={false}
        animate={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.3, ease: EASE_OUT }}
        className="grid"
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </motion.div>
    </div>
  );
}

/** Kalemin bu aya göre durumu: metinli rozet (renk tek başına anlam taşımaz) */
export function RangeBadge({ status, range, currentMonth }: { status: RangeStatus; range: MonthRange; currentMonth: string }) {
  if (status === "upcoming") {
    return (
      <Badge tone="blue" dot>
        {monthLabel(range.startMonth!)} başlıyor
      </Badge>
    );
  }
  if (status === "ended") {
    return (
      <Badge tone="gray" dot>
        Bitti · son ay {monthLabel(range.endMonth!)}
      </Badge>
    );
  }
  if (range.endMonth) {
    return (
      <Badge tone="amber" dot title={`${monthLabel(shiftMonth(range.endMonth, 1))} ve sonrasında hesaba girmez`}>
        Son ay {monthLabel(range.endMonth)}
      </Badge>
    );
  }
  if (range.startMonth === currentMonth) {
    return (
      <Badge tone="green" dot>
        Bu ay başladı
      </Badge>
    );
  }
  return (
    <Badge tone="green" dot>
      Aktif
    </Badge>
  );
}

export interface HistoryRow {
  fromMonth: string | null;
  versionId: number | null;
  /** "160.000 ₺/ay" */
  label: string;
}

/** Tutar geçmişi: eskiden yeniye; şu an geçerli satır işaretli, değişiklikler geri alınabilir */
export function HistoryList({
  rows,
  startMonth,
  activeIndex,
  onUndo,
  disabled,
}: {
  rows: HistoryRow[];
  startMonth: string | null;
  /** Listede gösterilen ayın satırı */
  activeIndex: number;
  onUndo?: (row: HistoryRow) => void;
  disabled?: boolean;
}) {
  return (
    <ol className="divide-y divide-line rounded-xl bg-surface ring-1 ring-line">
      {rows.map((h, i) => (
        <li key={h.versionId ?? "base"} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
          <span className="min-w-0 text-ink-mute">
            {h.versionId === null ? (startMonth ? `${monthLabel(startMonth)} itibarıyla` : "Baştan beri") : `${monthLabel(h.fromMonth!)} itibarıyla`}
          </span>
          <span className="flex items-center gap-2">
            <span className="font-semibold text-ink tabular">{h.label}</span>
            {i === activeIndex ? <Badge tone="green">Şu an</Badge> : null}
            {h.versionId !== null && onUndo ? (
              <Button size="xs" variant="ghost" onClick={() => onUndo(h)} disabled={disabled} className="pointer-coarse:h-9">
                Geri al
              </Button>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

type StopKind = "current" | "previous" | "month";

/**
 * Durdur: kalemin hesaba girdiği son ay seçilir (varsayılan bu ay: bu ay sayılır, gelecek ay girmez).
 * Önceki aylar değişmez; kapanmış bir ay etkilenecekse uyarır.
 */
export function StopDialog({
  open,
  onClose,
  name,
  what,
  range,
  currentMonth,
  closed,
  months,
  deleteBlocker,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  what: "gider" | "personel";
  range: MonthRange;
  currentMonth: string;
  closed: string[];
  months: string[];
  /** Kalem silinemiyorsa nedeni: hata metni silmeyi önermez */
  deleteBlocker?: string | null;
  onConfirm: (lastMonth: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<StopKind>("current");
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const previous = shiftMonth(currentMonth, -1);
  const lastMonth = kind === "current" ? currentMonth : kind === "previous" ? previous : month;
  const plan = stopText({ lastMonth, currentMonth, closed, range, what, deleteBlocker });
  const question = what === "personel" ? "Son çalıştığı ay" : "Son geçerli ay";

  async function confirm() {
    if (plan.error) return;
    setBusy(true);
    const ok = await onConfirm(lastMonth);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={`${name}: durdur`}
      description={what === "personel" ? "Ayrılan personel silinmez; seçtiğiniz aydan sonra maaş hesabına girmez." : "Kalem silinmez; seçtiğiniz aydan sonra hesaba girmez, geçmiş aylarda kalır."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className={TOUCH_BTN}>
            Vazgeç
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || !!plan.error} className={TOUCH_BTN}>
            {busy ? "Kaydediliyor…" : "Durdur"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="space-y-2.5 rounded-2xl bg-panel p-3.5">
          <p id={id} className="text-[13px] font-medium text-ink-soft">
            {question}
          </p>
          <div role="radiogroup" aria-labelledby={id} className="space-y-2">
            <Radio name={id} checked={kind === "current"} onSelect={() => setKind("current")} hint={`${monthLabel(shiftMonth(currentMonth, 1))} ve sonrasında girmez`}>
              Bu ay · {monthLabel(currentMonth)}
            </Radio>
            <Radio name={id} checked={kind === "previous"} onSelect={() => setKind("previous")} hint={`Bu aydan itibaren girmez`}>
              Geçen ay · {monthLabel(previous)}
            </Radio>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Radio name={id} checked={kind === "month"} onSelect={() => setKind("month")}>
                Başka bir ay
              </Radio>
              <MonthSelect
                value={month}
                onChange={(m) => {
                  setMonth(m);
                  setKind("month");
                }}
                months={months}
                currentMonth={currentMonth}
                label={`${question}: ay`}
                className={cn("h-8", kind !== "month" && "opacity-70")}
              />
            </div>
          </div>
          {plan.error ? <p className="text-xs font-medium text-bad">{plan.error}</p> : <EffectNote effect={plan} />}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Devam ettir: hangi aydan itibaren yeniden sayılacağı seçilir (varsayılan bu ay ya da bitişin ertesi ay).
 * Arada kapanmış boş aylar kalıyorsa onları değiştirmemek için yeni bir kayıt açılır (onConfirm mode "copy").
 */
export function ResumeDialog({
  open,
  onClose,
  name,
  what,
  endMonth,
  currentMonth,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  what: "gider" | "personel";
  endMonth: string;
  currentMonth: string;
  onConfirm: (fromMonth: string, mode: "clear" | "copy") => Promise<boolean>;
}) {
  const first = shiftMonth(endMonth, 1);
  const fallback = first > currentMonth ? first : currentMonth;
  const [month, setMonth] = useState(fallback);
  const [busy, setBusy] = useState(false);
  const months = monthsBetween(first, shiftMonth(currentMonth, 12));
  const effect = resumeText({ fromMonth: month, endMonth, currentMonth, what });
  const plan = resumePlan({ fromMonth: month, endMonth, currentMonth });

  async function confirm() {
    setBusy(true);
    const ok = await onConfirm(month, plan.mode);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={`${name}: devam ettir`}
      description={`Son ay ${monthLabel(endMonth)} olarak kayıtlı.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className={TOUCH_BTN}>
            Vazgeç
          </Button>
          <Button onClick={() => void confirm()} disabled={busy} className={TOUCH_BTN}>
            {busy ? "Kaydediliyor…" : "Devam ettir"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="space-y-2.5 rounded-2xl bg-panel p-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Hangi aydan itibaren?</span>
            <MonthSelect value={month} onChange={setMonth} months={months} currentMonth={currentMonth} label="Devam ayı" className="w-full sm:w-56" />
          </label>
          <EffectNote effect={effect} />
        </div>
      </div>
    </Dialog>
  );
}
