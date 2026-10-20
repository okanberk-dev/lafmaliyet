"use client";

import { CalendarRange, MessageSquareText, RotateCcw, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Field, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip, SegmentStrip } from "@/components/ui/misc";
import { ActiveFilters, FilterButton, SHEET_BTN, type ActiveFilter } from "@/components/ui/mobile-filters";
import { Segmented } from "@/components/ui/segmented";
import { ToggleRow } from "@/components/ui/toggle-row";
import { TableWrap, TD, TH } from "@/components/ui/table";
import type { PnlCell, PnlRowDef } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { MONTH_NAMES } from "@/lib/constants";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setMonthField, setMonthNote, setPnlCell } from "@/server/actions/pnl";

import {
  CELL_NOTE_MAX,
  cleanNote,
  defaultMonth,
  enterProblem,
  MONTH_NOTE_MAX,
  noteSaveEffect,
  noteSaveMessage,
  openDaysError,
  type CellEditPlan,
  type CellField,
} from "./cell-rules";
import { MonthView } from "./month-view";

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
 * genişlik ve sağında ince çizgi. Telefonda dar: "Son ay" görünümünde kalem + ay + yıl toplamı 375px ekrana
 * yatay kaydırmasız sığar. Geniş ekranda tam ad sığar.
 */
const STICKY = "w-32 min-w-32 pl-4 pr-2 shadow-[inset_-1px_0_0_var(--color-line-strong)] sm:w-72 sm:min-w-72 sm:pl-5 sm:pr-3";
/** Yıl toplamı sütunu */
const YEAR_COL = "bg-ink/[0.03] pr-3 pl-2 text-right whitespace-nowrap tabular sm:pr-5 sm:pl-3";
/** Girilebilir hücrenin en dar hali (telefonda biraz daha dar) */
const CELL_MIN = "min-w-20 sm:min-w-24";
/**
 * Başlık satırı tablo kabının içinde yukarıda sabit kalır (uzun tabloda ay adları kaybolmasın).
 * Zemin opak olmalı: altından geçen satırlar görünmesin. Yıl sütununun başlığı aynı tonun opak karşılığı.
 */
const HEAD = "sticky top-0 z-20 bg-panel";
const HEAD_YEAR = "sticky top-0 z-20 bg-[color-mix(in_oklab,var(--color-panel),black_3%)]";
/**
 * Hücre çizgileri hücrede (border-separate): sabit sütun kayarken çizgisini korur.
 * Üzerine gelme tonu paylaşılan TR ile aynı (surface/60); sabit hücre TD sticky ile eşleşir.
 */
const ROW = "group transition-colors hover:bg-surface/60 [&>td]:border-t [&>td]:border-line";
/** Değer hücrelerinin ortak dolgusu (paylaşılan TD'nin 12px'i bu sık ızgarada fazla) */
const CELL = "px-1.5 py-1";

/** Not penceresine giden hücre bilgisi */
export interface NoteTarget {
  month: string;
  rowKey: string;
  /** "Kira · Eylül 2026" */
  title: string;
  kind: "auto" | "manual";
  /** Düzenlemede yazılmış (ya da hücredeki) tutar metni */
  amountText: string;
  /** Hücrede kayıtlı (gösterilen) tutar: kaydedince neyin değiştiği söylenir */
  value: number | null;
  computed: number | null;
  overridden: boolean;
  note: string | null;
}

function EditableCell({
  value,
  computed,
  overridden,
  kind,
  format,
  label,
  col,
  note,
  outOfRange,
  suffix,
  validate,
  onSave,
  onNote,
}: {
  value: number | null;
  computed: number | null;
  overridden: boolean;
  kind: string;
  format?: string;
  /** Ekran okuyucu için "Satır · Ay" */
  label: string;
  /** Sütun (ay): Enter'dan sonra odak aynı sütunda alttaki hücreye geçer */
  col: string;
  /** Hücre notu (Excel'deki hücre açıklaması) */
  note?: string | null;
  /** Sabit gider bu ay geçerlilik aralığının dışında: soluk ve kesik çizgili (yazılırsa yine de sayılır) */
  outOfRange?: boolean;
  /** Değerin yanında soluk ek, ör. açık günde "/31" */
  suffix?: string;
  /** Kaydetmeden önce denetim; hata metni dönerse kaydedilmez */
  validate?: (v: number | null) => string | null;
  onSave: (v: number | null) => Promise<void>;
  /** Not penceresini açar (verilmezse hücreye not eklenemez: ciro ve açık gün ay bilgisidir) */
  onNote?: (amountText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** Düzenlemeye başlarken gösterilen metin: değişmeden çıkılırsa kaydedilmez (2 ondalığa yuvarlanmış değer üzerine yazılmasın) */
  const startText = useRef("");
  /** Esc ile vazgeçildi ya da not penceresi açıldı: ardından gelen blur kaydetmesin */
  const cancelled = useRef(false);
  /** Klavyeyle bitince odak nereye: Esc hücrenin kendisine, Enter (Excel'deki gibi) alttaki hücreye */
  const refocus = useRef<"self" | "next" | null>(null);
  const negative = value !== null && value < 0;
  const invalid = text.trim() !== "" && parseNumberTR(text.trim()) === null;
  const valueText = () => (value === null ? "" : format === "days" ? String(value) : num(value, 2));
  const muted = outOfRange && !overridden;

  /** Düzenlemeyi başlatır; `typed` verilirse (hücre seçiliyken rakama basıldı) kutu o karakterle açılır */
  function begin(typed?: string) {
    const initial = valueText();
    startText.current = initial;
    cancelled.current = false;
    refocus.current = null;
    setText(typed ?? initial);
    setEditing(true);
  }

  /** Not penceresi: düzenlenen tutar metniyle açılır (Excel'de Shift+F2) */
  function openNote(amountText: string) {
    if (!onNote) return;
    cancelled.current = true;
    setEditing(false);
    onNote(amountText);
  }

  const noteKeys = (e: React.KeyboardEvent, amountText: string) => {
    if (onNote && ((e.key === "F2" && e.shiftKey) || (e.altKey && e.code === "KeyN"))) {
      e.preventDefault();
      openNote(amountText);
      return true;
    }
    return false;
  };

  if (editing) {
    return (
      <div className="relative">
        {onNote ? (
          <button
            type="button"
            tabIndex={-1}
            // Odak kutuda kalsın: tıklama blur ile kaydetmeyi tetiklemesin
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => openNote(text)}
            aria-label={note ? "Notu düzenle (Shift+F2)" : "Not ekle (Shift+F2)"}
            title={note ? `Not: ${note}` : "Not ekle (Shift+F2)"}
            className={cn(
              "absolute top-1/2 left-1 z-10 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md hover:bg-panel pointer-coarse:size-8",
              note ? "text-warn" : "text-ink-quiet hover:text-ink",
            )}
          >
            <MessageSquareText size={14} aria-hidden="true" />
          </button>
        ) : null}
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
              toast.error("Geçerli bir sayı girin; değişiklik kaydedilmedi");
              setEditing(false);
              return;
            }
            if (t === startText.current.trim() || v === value || (v === null && !overridden && kind !== "manual")) {
              setEditing(false);
              return;
            }
            const problem = validate?.(v) ?? null;
            if (problem) {
              toast.error(`${problem}; değişiklik kaydedilmedi`);
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
          onFocus={(e) => {
            // Değerle açıldıysa tümü seçili (yazınca yerine geçer); rakamla açıldıysa imleç sona
            const el = e.currentTarget;
            if (text === startText.current) el.select();
            else el.setSelectionRange(el.value.length, el.value.length);
          }}
          onKeyDown={(e) => {
            if (noteKeys(e, text)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              const input = e.target as HTMLInputElement;
              // Excel gibi: kabul edilmeyen değerde hücrede kalınır, yazılan kaybolmaz (düzeltin ya da Esc)
              const problem = text.trim() === startText.current.trim() ? null : enterProblem(text, validate);
              if (problem) {
                toast.error(problem, { id: "pnl-cell-error" });
                input.select();
                return;
              }
              refocus.current = "next";
              input.blur();
            }
            if (e.key === "Escape") {
              // Açık bir pencere yokken Esc yalnızca bu hücreden vazgeçer
              e.preventDefault();
              cancelled.current = true;
              refocus.current = "self";
              setEditing(false);
            }
          }}
          className={cn(
            // Form kontrolleriyle aynı dil: beyaz, ince halka, odakta mürekkep halkası; telefonda 16px (iOS yakınlaştırmasın)
            "h-8 w-full rounded-lg border-0 bg-surface px-2 text-right text-base tabular ring-2 ring-ink/20 outline-none pointer-coarse:h-11 sm:text-sm sm:pointer-coarse:text-base",
            CELL_MIN,
            onNote && "pl-8 pointer-coarse:pl-9",
            "aria-invalid:bg-bad-soft aria-invalid:text-bad aria-invalid:ring-bad/50 disabled:opacity-60",
            // .cell-input katmansız: geçersizken kırmızı metnin önüne geçmesin
            !invalid && "cell-input",
          )}
        />
      </div>
    );
  }
  const help = muted
    ? "Bu kalem bu ay hesaba girmiyor (başlamadı ya da bitti). Tutar yazarsanız yine de sayılır."
    : overridden && computed !== null
      ? `Elle girildi. Hesaplanan: ${fmt(computed, format)}`
      : "Değer girmek için tıklayın ya da rakam yazın";
  return (
    <button
      type="button"
      data-pnl-col={col}
      ref={(el) => {
        if (!el || !refocus.current) return;
        const where = refocus.current;
        refocus.current = null;
        if (where === "next") {
          // Aynı aydaki bir sonraki girilebilir hücre (sayfadaki sırayla); yoksa bu hücrede kalır
          const list = [...document.querySelectorAll<HTMLButtonElement>(`button[data-pnl-col="${col}"]`)];
          const next = list[list.indexOf(el) + 1];
          (next ?? el).focus();
          next?.scrollIntoView({ block: "nearest", inline: "nearest" });
        } else el.focus();
      }}
      onClick={() => begin()}
      onKeyDown={(e) => {
        if (noteKeys(e, valueText())) return;
        // Excel gibi: hücre seçiliyken rakam yazmak düzenlemeyi o rakamla başlatır
        if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[\d,.-]$/.test(e.key)) {
          e.preventDefault();
          begin(e.key);
        }
      }}
      title={note ? `Not: ${note}\n\n${help}` : `${help}${onNote ? " · Not için Shift+F2" : ""}`}
      aria-label={`${label}: ${fmt(value, format)}${suffix ?? ""}${note ? `. Not: ${note}` : ""}. Değiştirmek için tıklayın`}
      className={cn(
        "relative flex h-8 w-full cursor-text items-center justify-end rounded-lg bg-surface/80 px-2 tabular ring-1 ring-line ring-inset transition-[background-color,box-shadow] pointer-coarse:h-11",
        CELL_MIN,
        "hover:bg-surface hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-ink/25",
        // .cell-input katmansız bir kural olduğu için negatifte kırmızının önüne geçmesin
        (overridden || kind === "manual") && !negative && "cell-input",
        overridden && kind === "auto" && "bg-info-soft font-medium hover:bg-info-soft",
        negative && "text-bad",
        value === null && "text-ink-quiet",
        muted && "bg-transparent ring-0 outline-1 -outline-offset-1 outline-line-strong outline-dashed hover:bg-surface/60",
      )}
    >
      {fmt(value, format)}
      {suffix ? <span className="ml-0.5 text-xs font-normal text-ink-quiet">{suffix}</span> : null}
      {note ? (
        // Excel'deki not üçgeni: sol üst köşede
        <span className="absolute top-0 left-0 size-0 rounded-tl-lg border-t-[7px] border-r-[7px] border-t-warn border-r-transparent" aria-hidden="true" />
      ) : null}
      {overridden && kind === "auto" ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-info" aria-hidden="true" /> : null}
    </button>
  );
}

/**
 * Hücre notu penceresi: tutar ve not birlikte kaydedilir (not, elle girilen tutarın açıklamasıdır).
 * Kaydetmenin etkisi açıkça yazılır: tutar boşsa hücre hesaplanana döner ve not silinir; hesaplanan bir
 * hücreye yalnızca not eklenirse o tutar elle girilmiş sayılır.
 */
function CellNoteDialog({ target, onClose }: { target: NoteTarget; onClose: () => void }) {
  const formId = useId();
  const [amountText, setAmountText] = useState(target.amountText);
  const [note, setNote] = useState(target.note ?? "");
  const [busy, setBusy] = useState(false);
  const t = amountText.trim();
  const amount = t === "" ? null : parseNumberTR(t);
  const amountError = t !== "" && amount === null ? "Geçerli bir sayı yazın, ör. 1.250,50" : null;
  const effect = noteSaveEffect({ kind: target.kind, overridden: target.overridden, amount, computed: target.computed });

  async function run(nextAmount: number | null, nextNote: string | null | undefined, done: string) {
    setBusy(true);
    const res = await setPnlCell(target.month, target.rowKey, nextAmount, nextNote);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(done);
    onClose();
  }

  function save() {
    if (amountError) return;
    const n = cleanNote(note);
    if (amount === null) {
      // Kayıt silinir: not tutarsız saklanamaz
      if (!target.overridden && target.kind === "auto") return onClose();
      return void run(null, undefined, target.kind === "auto" ? "Hücre hesaplanan değere döndü; not silindi" : "Hücre boşaltıldı; not silindi");
    }
    void run(amount, n, noteSaveMessage({ prevValue: target.value, amount, prevNote: target.note, note: n, freeze: effect === "freeze" }));
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={target.title}
      description="Elle girilen tutarın açıklaması: ör. makine servisi, kırılan ekipman, bordro farkı."
      footerStart={
        target.note ? (
          <Button
            variant="ghost"
            className="text-bad hover:bg-bad-soft hover:text-bad pointer-coarse:h-11"
            disabled={busy}
            onClick={() => {
              const keep = parseNumberTR(target.amountText.trim());
              if (keep === null) return void run(null, undefined, "Not silindi");
              void run(keep, null, "Not silindi");
            }}
          >
            Notu sil
          </Button>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="pointer-coarse:h-11">
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy || !!amountError} className="pointer-coarse:h-11">
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label="Tutar (₺, KDV hariç)"
          htmlFor={`${formId}-a`}
          error={amountError}
          hint={
            target.kind === "auto" && target.computed !== null
              ? `Hesaplanan: ${tl(target.computed, 2)}. Boş bırakırsanız hesaplanan değere döner.`
              : "Boş bırakırsanız hücre boşalır."
          }
        >
          <NumberInput
            id={`${formId}-a`}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={amountError ? true : undefined}
            className="cell-input"
          />
        </Field>
        <Field label="Not" htmlFor={`${formId}-n`} hint={`${note.trim().length} / ${CELL_NOTE_MAX}`}>
          <Textarea
            id={`${formId}-n`}
            data-autofocus="always"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={CELL_NOTE_MAX}
            placeholder="Ör. Ekim kombi servisi 4.500 ₺"
          />
        </Field>
        {effect === "clear" && (target.overridden || target.kind === "manual") ? (
          <Warn>Tutar boş: kayıt silinir{target.note || note.trim() ? ", not da gider" : ""}.</Warn>
        ) : effect === "clear" && cleanNote(note) ? (
          <Warn>Not, bir tutarla birlikte saklanır. Tutar yazın.</Warn>
        ) : effect === "freeze" && cleanNote(note) ? (
          <Warn>Not kaydedilince bu tutar elle girilmiş sayılır: hesaplanan değer sonradan değişse de {tl(amount, 2)} kalır.</Warn>
        ) : null}
      </form>
    </Dialog>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-5 font-medium text-warn" aria-live="polite">
      <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Ay notu penceresi (Satışlar sayfasındaki ay notuyla aynı alan) */
function MonthNoteDialog({ month, note, onClose }: { month: string; note: string | null; onClose: () => void }) {
  const formId = useId();
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);

  async function run(next: string | null) {
    setBusy(true);
    const res = await setMonthNote(month, next);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(next ? "Ay notu kaydedildi" : "Ay notu silindi");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`${monthLabel(month)} notu`}
      description="Ayın durumu, ör. “1-16 Ekim, ay bitince güncelleyin”. Satışlar sayfasında da görünür."
      footerStart={
        note ? (
          <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad pointer-coarse:h-11" disabled={busy} onClick={() => void run(null)}>
            Notu sil
          </Button>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="pointer-coarse:h-11">
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy} className="pointer-coarse:h-11">
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(cleanNote(text));
        }}
      >
        <Field label="Not" htmlFor={`${formId}-n`} hint={`${text.trim().length} / ${MONTH_NOTE_MAX}`}>
          <Textarea id={`${formId}-n`} data-autofocus="always" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={MONTH_NOTE_MAX} />
        </Field>
      </form>
    </Dialog>
  );
}

/** Gösterilen aylar: verisi olan aylar, yılın tamamı ya da yalnızca son ay (telefonda tek ay + yıl toplamı) */
type MonthView = "aktif" | "12" | "son";
type Flag = "" | "1";
type GridRow = GridSection["rows"][number];

const FILTER_KEYS = ["ara", "bolum", "girilebilir", "yazilan", "dolu"];
const OPEN_DAYS_LABEL = "Açık gün sayısı";

export function PnlGrid({
  year,
  months,
  activeMonths,
  sections,
  openDays,
  dims,
  monthNotes,
  currentMonth,
  strip,
  latestMonth,
}: {
  year: number;
  months: string[];
  activeMonths: string[];
  sections: GridSection[];
  openDays: (number | null)[];
  /** Her ayın gün sayısı: açık gün en fazla bu kadar */
  dims: number[];
  /** Ay notları (Satışlar'daki ay bilgisiyle aynı alan) */
  monthNotes: (string | null)[];
  /** "Bu ay" (YYYY-MM): başlıkta işaretlenir */
  currentMonth: string;
  strip: StripMonth[];
  /** Verisi olan son ay: şeritte çerçevelenir */
  latestMonth?: string;
}) {
  const reduce = useCalmMotion();
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const [monthNoteFor, setMonthNoteFor] = useState<number | null>(null);
  const [view, setView] = useQueryState<MonthView>("aylar", activeMonths.length ? "aktif" : "12");
  const [q, setQ] = useQueryText("ara");
  const [bolum, setBolum] = useQueryState<string>("bolum", "tumu");
  const [onlyEditable, setOnlyEditable] = useQueryState<Flag>("girilebilir", "");
  const [onlyOverridden, setOnlyOverridden] = useQueryState<Flag>("yazilan", "");
  const [hideEmpty, setHideEmpty] = useQueryState<Flag>("dolu", "");
  /** Telefon: tek ay görünümünün ayı (?ay=YYYY-AA) ve süzgeç sayfası */
  const [rawMonth, setPhoneMonth] = useQueryState<string>("ay", "");
  const phoneMonth = defaultMonth(months, rawMonth, currentMonth, latestMonth);
  const phoneIdx = [{ m: phoneMonth, i: months.indexOf(phoneMonth) }];
  const [sheetOpen, setSheetOpen] = useState(false);

  const visibleIdx = months
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => {
      if (view === "son" && latestMonth) return m === latestMonth;
      if (view === "aktif" && activeMonths.length) return activeMonths.includes(m);
      return true;
    });
  const profitable = strip.filter((s) => s.tone === "good").length;
  const losing = strip.filter((s) => s.tone === "bad").length;
  const latestIdx = latestMonth ? months.indexOf(latestMonth) : -1;

  // Satır süzgeçleri yalnızca görünen aylara bakar ("boş" = görünen aylarda değer yok). Izgara görünen aylarla,
  // telefondaki tek ay görünümü yalnızca seçili ayla süzülür.
  const filterFor = (idx: { m: string; i: number }[]) => {
    const isOverridden = (r: GridRow) => r.def.kind === "auto" && idx.some(({ i }) => r.cells[i].overridden);
    const isEmpty = (r: GridRow) => idx.every(({ i }) => !r.cells[i].value);
    const rowMatches = (sec: GridSection, r: GridRow) =>
      (bolum === "tumu" || sec.key === bolum) &&
      matches(`${r.def.label} ${sec.label}`, q) &&
      (!onlyEditable || r.def.editable) &&
      (!onlyOverridden || isOverridden(r)) &&
      (!hideEmpty || !isEmpty(r));
    const shownSections = sections.map((sec) => ({ ...sec, rows: sec.rows.filter((r) => rowMatches(sec, r)) })).filter((sec) => sec.rows.length > 0);
    // Açık gün satırı bölümsüz, her zaman girilebilir; "üzerine yazılan" süzgecinde yer almaz
    const showOpenDays =
      bolum === "tumu" &&
      matches(OPEN_DAYS_LABEL, q) &&
      !onlyOverridden &&
      (!hideEmpty || idx.some(({ i }) => openDays[i] !== null && openDays[i] !== 0));
    const shownRows = shownSections.reduce((a, s) => a + s.rows.length, 0) + (showOpenDays ? 1 : 0);
    return { shownSections, showOpenDays, shownRows, isOverridden };
  };
  const { shownSections, showOpenDays, shownRows, isOverridden } = filterFor(visibleIdx);
  const phone = filterFor(phoneIdx);

  const allRows = sections.flatMap((s) => s.rows);
  const totalRows = allRows.length + 1;
  const overriddenCount = allRows.filter(isOverridden).length;
  const editableCount = allRows.filter((r) => r.def.editable).length + 1;
  const filtered = q.trim() !== "" || bolum !== "tumu" || onlyEditable === "1" || onlyOverridden === "1" || hideEmpty === "1";
  const clearFilters = () => {
    setQ("");
    clearQuery(FILTER_KEYS);
  };
  const chips: ActiveFilter[] = [];
  if (bolum !== "tumu") chips.push({ key: "bolum", label: sections.find((s) => s.key === bolum)?.label ?? bolum, onRemove: () => setBolum("tumu") });
  if (onlyEditable) chips.push({ key: "girilebilir", label: "Girilebilir", onRemove: () => setOnlyEditable("") });
  if (onlyOverridden) chips.push({ key: "yazilan", label: "Üzerine yazılan", onRemove: () => setOnlyOverridden("") });
  if (hideEmpty) chips.push({ key: "dolu", label: "Boşlar gizli", onRemove: () => setHideEmpty("") });

  /** Telefondaki hücre sayfasının kaydı; hata metni döner */
  async function savePlan(month: string, field: CellField, rowKey: string, plan: Extract<CellEditPlan, { action: "save" | "clear" }>): Promise<string | null> {
    const amount = plan.action === "clear" ? null : plan.amount;
    const res =
      field === "revenue"
        ? await setMonthField(month, "posRevenue", amount)
        : field === "openDays"
          ? await setMonthField(month, "openDays", amount)
          : await setPnlCell(month, rowKey, amount, plan.action === "save" ? plan.note : undefined);
    return res.ok ? null : res.error;
  }

  async function save(month: string, key: string, v: number | null, hadNote?: boolean): Promise<void> {
    const res =
      key === "revenue"
        ? await setMonthField(month, "posRevenue", v)
        : key === "openDays"
          ? await setMonthField(month, "openDays", v)
          : await setPnlCell(month, key, v);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // Boşaltılan hücrenin notu da silinir: sessizce kaybolmasın
    if (v === null && hadNote) toast("Hücre boşaltıldı; notu da silindi");
  }

  /** Not penceresi: satır ve ay bilgisiyle */
  function openNote(month: string, i: number, def: PnlRowDef, c: PnlCell, amountText: string) {
    setNoteTarget({
      month,
      rowKey: def.key,
      title: `${def.label} · ${MONTH_NAMES[i]} ${year}`,
      kind: def.kind === "manual" ? "manual" : "auto",
      amountText,
      value: c.value,
      computed: c.computed,
      overridden: c.overridden,
      note: c.note ?? null,
    });
  }
  const notedCount = sections.reduce((a, sec) => a + sec.rows.reduce((b, r) => b + r.cells.filter((c) => c.note).length, 0), 0);

  return (
    <Card>
      <CardHeader
        icon={<CalendarRange />}
        title={`${year} gelir-gider tablosu`}
        description={
          <>
            <span className="md:hidden">KDV hariç. Ayı seçin; tutar girmek için kaleme dokunun.</span>
            <span className="max-md:hidden">KDV hariç. Hücreye tıklayın ya da seçip rakam yazın; Enter kaydedip alttaki hücreye geçer, Esc vazgeçer.</span>
          </>
        }
        // Telefonda tek ay görünümü var; ay seçimi aşağıda
        actionsClassName="max-md:hidden"
        actions={
          <Segmented<MonthView>
            label="Gösterilen aylar"
            value={view === "aktif" && !activeMonths.length ? "12" : view}
            onChange={setView}
            options={[
              ...(activeMonths.length ? [{ value: "aktif" as const, label: "Aktif aylar", count: activeMonths.length }] : []),
              { value: "12", label: "12 ay" },
              ...(latestIdx >= 0 ? [{ value: "son" as const, label: `Son ay · ${MONTH_NAMES[latestIdx]}` }] : []),
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
            {/* Şerit beyaz kuyuda: çerçevenin boşluğu da beyaz olsun (bileşen panel zeminine göre çizer). md'den itibaren
                verisi olan son ay çerçeveli; telefonda aşağıdaki tek ay görünümünün ayı çerçeveli ve aya dokununca o ay açılır. */}
            <SegmentStrip segments={strip} activeKey={latestMonth} showLabels className="[&_li]:ring-offset-surface max-md:hidden" />
            <div className="relative md:hidden">
              {/* Ekran okuyucu ayları üzerine konan düğmelerden okur */}
              <div aria-hidden="true">
                <SegmentStrip segments={strip} activeKey={phoneMonth} showLabels className="[&_li]:ring-offset-surface" />
              </div>
              <div role="group" aria-label="Ay seçin" className="absolute inset-0 flex">
                {strip.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setPhoneMonth(s.key)}
                    aria-pressed={s.key === phoneMonth}
                    aria-label={`${s.label}. Bu ayı göster`}
                    className="min-w-0 flex-1 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </Well>
      </CardContent>

      {/* Telefon: arama + "Süzgeç" düğmesi; seçimler alt sayfada */}
      <div role="search" className="space-y-2.5 px-4 pb-3 md:hidden">
        <div className="flex items-center gap-2">
          <SearchField value={q} onChange={setQ} placeholder="Kalem ara" label="Kalem ara (tedarikçi, gider adı)" shortcut={false} className="flex-1 [&_input]:h-11" />
          <FilterButton count={chips.length} onClick={() => setSheetOpen(true)} />
        </div>
        <ActiveFilters items={chips} />
        {filtered ? (
          <p className="text-[13px] text-ink-mute tabular" aria-live="polite">
            <span className="font-semibold text-ink">{phone.shownRows}</span> / {totalRows} kalem
          </p>
        ) : null}
      </div>
      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Süzgeç"
        description={`${monthLabel(phoneMonth)}: ${phone.shownRows} / ${totalRows} kalem`}
        footer={
          <>
            <Button variant="ghost" className={SHEET_BTN} disabled={!filtered} onClick={clearFilters}>
              Temizle
            </Button>
            <Button className={SHEET_BTN} onClick={() => setSheetOpen(false)}>
              {phone.shownRows ? `${phone.shownRows} kalemi göster` : "Kapat"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2 max-sm:[&_select]:h-12">
          <Field label="Bölüm" htmlFor="pnl-m-bolum">
            <Select id="pnl-m-bolum" value={bolum} onChange={(e) => setBolum(e.target.value)}>
              <option value="tumu">Tüm bölümler</option>
              {sections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} ({s.rows.length})
                </option>
              ))}
            </Select>
          </Field>
          <ToggleRow
            title="Yalnız girilebilenler"
            description={`${editableCount} kalem elle girilebilir ya da üzerine yazılabilir`}
            checked={onlyEditable === "1"}
            onChange={(on) => setOnlyEditable(on ? "1" : "")}
            label="Yalnız girilebilen kalemler"
            onText="Açık"
            offText="Kapalı"
          />
          <ToggleRow
            title="Yalnız üzerine yazılanlar"
            description="Hesaplanan değerin yerine elle tutar girilmiş kalemler"
            checked={onlyOverridden === "1"}
            onChange={(on) => setOnlyOverridden(on ? "1" : "")}
            label="Yalnız üzerine yazılan kalemler"
            onText="Açık"
            offText="Kapalı"
          />
          <ToggleRow
            title="Boşları gizle"
            description="Bu ayda değeri olmayan kalemler görünmez"
            checked={hideEmpty === "1"}
            onChange={(on) => setHideEmpty(on ? "1" : "")}
            label="Boş kalemleri gizle"
            onText="Açık"
            offText="Kapalı"
          />
        </div>
      </Dialog>

      <div className="space-y-3 px-5 pb-3 max-md:hidden">
        <FilterBar active={filtered} onClear={clearFilters} shown={shownRows} total={totalRows} unit="kalem">
          <SearchField value={q} onChange={setQ} placeholder="Kalem ara" label="Kalem ara (tedarikçi, gider adı)" className="w-full sm:w-64" />
          <Select value={bolum} onChange={(e) => setBolum(e.target.value)} aria-label="Bölüm" className="w-auto max-sm:flex-1 pointer-coarse:h-11">
            <option value="tumu">Tüm bölümler</option>
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.rows.length})
              </option>
            ))}
          </Select>
          <FilterChip active={onlyEditable === "1"} onToggle={() => setOnlyEditable(onlyEditable ? "" : "1")} count={editableCount}>
            Girilebilir
          </FilterChip>
          <FilterChip active={onlyOverridden === "1"} onToggle={() => setOnlyOverridden(onlyOverridden ? "" : "1")} count={overriddenCount}>
            Üzerine yazılan
          </FilterChip>
          <FilterChip active={hideEmpty === "1"} onToggle={() => setHideEmpty(hideEmpty ? "" : "1")}>
            Boşları gizle
          </FilterChip>
        </FilterBar>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-mute">
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
          <span className="flex items-center gap-1.5">
            <span className="relative inline-flex h-6 w-9 items-center rounded-md bg-surface ring-1 ring-line ring-inset">
              <span className="absolute top-0 left-0 size-0 rounded-tl-md border-t-[7px] border-r-[7px] border-t-warn border-r-transparent" />
            </span>
            notlu hücre{notedCount ? ` (${notedCount})` : ""}
            <InfoTip text="Hücreyi düzenlerken soldaki not simgesine basın (klavyede Shift+F2). Ay notu için ay adına tıklayın." />
          </span>
        </div>
      </div>

      <MonthView
        year={year}
        months={months}
        month={phoneMonth}
        onMonth={setPhoneMonth}
        activeMonths={activeMonths}
        sections={sections}
        shownSections={phone.shownSections}
        showOpenDays={phone.showOpenDays}
        openDays={openDays}
        dims={dims}
        monthNotes={monthNotes}
        currentMonth={currentMonth}
        onMonthNote={setMonthNoteFor}
        onSave={savePlan}
      />

      {shownRows === 0 ? (
        <div className="max-md:hidden">
          <EmptyState
            title="Bu süzgece uyan kalem yok"
            description="Aramayı kısaltın ya da seçili bölümü ve süzgeçleri kaldırın."
            action={
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Süzgeci temizle
              </Button>
            }
          />
        </div>
      ) : (
        // Tablo kendi içinde kayar: başlık satırı ve kalem sütunu kaydırırken yerinde kalır. `isolate`: sabit
        // hücrelerin z sırası tablonun içinde kalır, telefondaki üst çubuğun (z-30) üzerine çıkmaz.
        <TableWrap className="isolate max-h-[calc(100dvh-7rem)] overflow-y-auto px-0 pb-0 max-md:hidden">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <TH sticky className={cn(STICKY, "top-0 z-30")}>
                  Kalem
                </TH>
                {visibleIdx.map(({ m, i }) => (
                  <TH key={m} numeric className={cn(HEAD, "min-w-24 px-1.5 sm:min-w-28")}>
                    {/* Ay adı ay notunu açar; not varsa yanında ⓘ ile okunur */}
                    <span className="inline-flex items-center justify-end gap-1 px-1">
                      {monthNotes[i] ? <InfoTip text={monthNotes[i]} /> : null}
                      <button
                        type="button"
                        onClick={() => setMonthNoteFor(i)}
                        title={monthNotes[i] ? `${MONTH_NAMES[i]} notunu düzenle` : `${MONTH_NAMES[i]} için not ekle`}
                        aria-label={`${MONTH_NAMES[i]} ${year} ay notu${monthNotes[i] ? `: ${monthNotes[i]}` : " ekle"}`}
                        className="cursor-pointer rounded-md px-1 underline decoration-transparent decoration-dotted underline-offset-4 hover:decoration-ink-quiet focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none"
                      >
                        {MONTH_NAMES[i]}
                      </button>
                    </span>
                    {m === currentMonth ? <span className="block px-2 text-[11px] font-normal text-ink-mute">bu ay</span> : null}
                  </TH>
                ))}
                <TH numeric className={cn(YEAR_COL, HEAD_YEAR, "min-w-28 text-ink sm:min-w-32")}>
                  {year} yılı
                </TH>
              </tr>
            </thead>
            <tbody>
              {showOpenDays ? (
                <tr className={cn(ROW, "[&>td]:border-t-0")}>
                  <TD sticky className={cn(STICKY, "py-1.5 font-medium")}>
                    <span className="flex items-center gap-1.5">
                      {OPEN_DAYS_LABEL}
                      <InfoTip text="O ay işletmenin açık olduğu gün; en fazla ayın gün sayısı (Eylül 30, Ekim 31). Kira, personel, reklam gibi aylık giderler gün ÷ ayın gün sayısı oranıyla hesaplanır. Süren ayda bugüne kadarki açık gün yazılır." />
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
                        label={`${OPEN_DAYS_LABEL} · ${MONTH_NAMES[i]} (en fazla ${dims[i]})`}
                        col={m}
                        suffix={`/${dims[i]}`}
                        validate={(v) => openDaysError(m, v)}
                        onSave={(v) => save(m, "openDays", v)}
                      />
                    </td>
                  ))}
                  <td className={cn(YEAR_COL, "font-semibold text-ink")}>{num(openDays.reduce<number>((a, v) => a + (v ?? 0), 0))} gün</td>
                </tr>
              ) : null}
              {shownSections.map((sec) => (
                <SectionRows key={sec.key} sec={sec} visibleIdx={visibleIdx} onSave={save} onNote={openNote} />
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {noteTarget ? <CellNoteDialog key={`${noteTarget.month}-${noteTarget.rowKey}`} target={noteTarget} onClose={() => setNoteTarget(null)} /> : null}
      {monthNoteFor !== null ? <MonthNoteDialog month={months[monthNoteFor]} note={monthNotes[monthNoteFor]} onClose={() => setMonthNoteFor(null)} /> : null}

      <CardFooter className="justify-start gap-2 max-md:hidden">
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
  onNote,
}: {
  sec: GridSection;
  visibleIdx: { m: string; i: number }[];
  onSave: (month: string, key: string, v: number | null, hadNote?: boolean) => Promise<unknown>;
  onNote: (month: string, i: number, def: PnlRowDef, c: PnlCell, amountText: string) => void;
}) {
  return (
    <>
      <tr>
        <TD sticky className={cn(STICKY, "pt-6 pb-2 text-[13px] font-semibold text-ink-soft")}>
          {sec.label}
        </TD>
        <td colSpan={visibleIdx.length} className="pt-6 pb-2" />
        {/* Yıl sütununun gri şeridi bölüm başlığında da kesilmesin */}
        <td className={cn(YEAR_COL, "pt-6 pb-2")} />
      </tr>
      {sec.rows.map(({ def, cells, total }) => {
        const isProfit = def.key === "profit" || def.key === "ratio:profit";
        const tone = (v: number | null) => (v !== null && v < 0 ? "text-bad" : isProfit && v !== null && v > 0 ? "text-good" : null);
        return (
          <tr key={`${sec.key}-${def.key}`} className={cn(ROW, def.strong && "font-semibold [&>td]:border-line-strong")}>
            <TD sticky className={cn(STICKY, "py-1.5", def.strong ? "text-ink" : "text-ink-soft")}>
              <span className="flex items-center gap-1.5">
                <span className="min-w-0">
                  {def.label}
                  {def.sub ? <span className="block text-xs leading-4 font-normal text-ink-mute max-sm:line-clamp-2">{def.sub}</span> : null}
                </span>
                {def.hint ? <InfoTip text={def.hint} className="shrink-0" /> : null}
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
                      col={m}
                      note={c.note}
                      outOfRange={c.outOfRange}
                      onSave={async (v) => {
                        await onSave(m, def.key, v, !!c.note);
                      }}
                      // Ciro ay bilgisidir (Satışlar ile ortak): notu ay notunda
                      onNote={def.key === "revenue" ? undefined : (text) => onNote(m, i, def, c, text)}
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
