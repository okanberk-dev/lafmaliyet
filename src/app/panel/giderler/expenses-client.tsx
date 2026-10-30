"use client";

import { ArrowUpRight, CalendarClock, CirclePause, CirclePlay, House, Pencil, PiggyBank, Plus, SearchX, Store, Target, Trash2, Undo2, Users, Wallet, Zap } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { SERIES } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton, IconLink } from "@/components/ui/button";
import { Card, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, matches, releaseScroll, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { shiftMonth, type FixedHistoryEntry, type RangeStatus } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { FixedPeriod, FixedSection } from "@/lib/calc/types";
import { FIXED_PERIODS, FIXED_SECTION_VAT, FIXED_SECTIONS, FIXED_VAT_RATES, fixedVatRate } from "@/lib/constants";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deleteFixedExpense,
  deleteFixedExpenseVersion,
  deleteInvestment,
  endFixedExpense,
  saveFixedExpense,
  saveInvestment,
} from "@/server/actions/costs";

import {
  amountChangeText,
  choiceValue,
  entryAt,
  periodAmount,
  rangeText,
  spanText,
  startText,
  type EffectText,
  type MonthChoice,
} from "./history-text";
import { Disclosure, HistoryList, MonthChoiceField, RangeBadge, ResumeDialog, StopDialog } from "./history-ui";

/** Sunucu eyleminin sonucu (server/actions/util ActionResult ile aynı biçim) */
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const PERIOD_LABEL = Object.fromEntries(FIXED_PERIODS.map((p) => [p.key, p.label])) as Record<FixedPeriod, string>;

const SECTION_ICON: Record<FixedSection, ReactNode> = {
  personel: <Users />,
  faturalar: <Zap />,
  kira: <House />,
  genel: <Store />,
};

/** Süzgeçteki kısa bölüm adları (tam adlar tabloda) */
const SECTION_SHORT: Record<FixedSection, string> = {
  personel: "Personel",
  faturalar: "Faturalar",
  kira: "Kira",
  genel: "Genel",
};

/** Dağılım çubuğunda ve tablodaki bölüm başlıklarında aynı renk: mürekkep, mavi, turuncu, gri */
const SECTION_COLOR: Record<FixedSection, string> = {
  personel: "var(--foreground)",
  faturalar: SERIES[0],
  kira: SERIES[1],
  genel: "var(--chart-muted)",
};

function periodRule(period: FixedPeriod, acikGun: number) {
  return period === "gunluk" ? `× ${acikGun} gün` : period === "haftalik" ? "× 52 ÷ 12" : period === "yillik" ? "÷ 12" : "";
}

function monthlyOf(amount: number, period: FixedPeriod, acikGun: number) {
  return period === "gunluk" ? amount * acikGun : period === "haftalik" ? (amount * 52) / 12 : period === "yillik" ? amount / 12 : amount;
}

/** Küçük tutarlarda kuruş da görünsün (50,00 ₺ yıllık → 4,17 ₺ aylık) */
const money = (v: number) => tl(v, Math.abs(v) < 100 ? 2 : 0);

/**
 * Sıralama adreste "ad", "-ad" (azalan) gibi tutulur. Başlığa tıklamak sırayla artan → azalan → kayıt sırası
 * arasında döner; tutar sütunlarında önce büyükten küçüğe.
 */
function nextSort(current: string, key: string, firstDesc = false): string {
  const order = firstDesc ? [`-${key}`, key, ""] : [key, `-${key}`, ""];
  const i = order.indexOf(current);
  return i === -1 ? order[0] : order[(i + 1) % order.length];
}

function sortDir(current: string, key: string): "asc" | "desc" | null {
  return current === key ? "asc" : current === `-${key}` ? "desc" : null;
}

function sortRows<T>(list: T[], sort: string, keys: Record<string, (x: T) => string | number>): T[] {
  const desc = sort.startsWith("-");
  const get = keys[desc ? sort.slice(1) : sort];
  if (!get) return list;
  return [...list].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "tr-TR") : Number(x) - Number(y);
    return desc ? -c : c;
  });
}

/** Az önce eklenen / düzenlenen satırın kısa süreli vurgusu (TR'nin renk geçişiyle söner) */
const FLASH = "bg-lime/20 hover:bg-lime/25";

/** Vurgulanan satırı görünür alana getirir; telefonda gizli tablo satırı (display: none) yerinde kalır */
function revealRow(el: HTMLElement | null) {
  if (!el || el.offsetParent === null) return;
  // Süzgeç adresteyken eylem sonrası kaydırma koruması bu bilinçli kaydırmayı geri almasın
  releaseScroll();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

/** Kaydedilen satırın kimliği: 3 sn vurgulanır, sonra kendiliğinden söner */
function useFlash(): [number | null, (id: number) => void] {
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);
  return [flash, setFlash];
}

// ============================================================================ Ortak parçalar (Personel de kullanır)

/** Açılışta sıfırdan sayan tutar (AkmanOS AnimatedNumber); ekran okuyucu son değeri okur */
export function CountUp({ value, digits = 0 }: { value: number; digits?: number }) {
  return (
    <>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={(v) => tl(v, digits)} />
      </span>
      <span className="sr-only">{tl(value, digits)}</span>
    </>
  );
}

/** Kart başlığındaki kenarlıklı beyaz ikon kutusu (CardHeader ile aynı), büyük rakamlı özet kartlarında */
export function HeadIcon({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

export type ShareSegment = { key: string; label: string; value: number; color: string; note?: ReactNode };

/**
 * AkmanOS agent-limits-card dili: tek yuvarlak çubukta renkli parçalar + tutar ve yüzdeli lejant.
 * Parçalar açılışta sırayla yayla dolar; lejantın üzerine gelince ilgili parça öne çıkar.
 */
export function ShareBreakdown({
  segments,
  total,
  className,
  legendClassName,
}: {
  segments: ShareSegment[];
  /** Yüzdelerin paydası; verilmezse parçaların toplamı */
  total?: number;
  className?: string;
  legendClassName?: string;
}) {
  const reduce = useCalmMotion();
  const [focus, setFocus] = useState<string | null>(null);
  const sum = total ?? segments.reduce((a, s) => a + s.value, 0);
  // Geçersiz oranlarda (ör. işçi kesintisi %100) tutarlar sonsuz/negatif olabilir; çubuk o zaman boş kalır
  const valid = Number.isFinite(sum) && sum > 0;
  const filled = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-1" aria-hidden="true">
        {filled.length > 0 && valid ? (
          filled.map((s, i) => (
            <motion.span
              key={s.key}
              title={`${s.label}: ${tl(s.value)} (${pct(s.value / sum, 0)})`}
              onMouseEnter={() => setFocus(s.key)}
              onMouseLeave={() => setFocus(null)}
              className={cn("h-full min-w-1.5 basis-0 rounded-full transition-opacity duration-200", focus && focus !== s.key && "opacity-25")}
              style={{ backgroundColor: s.color, originX: 0 }}
              initial={reduce ? false : { scaleX: 0, flexGrow: s.value }}
              animate={{ scaleX: 1, flexGrow: s.value }}
              transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.12 + i * 0.06 }}
            />
          ))
        ) : (
          <span className="h-full w-full rounded-full bg-panel-deep" />
        )}
      </div>

      <ul className={cn("mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4", legendClassName)}>
        {segments.map((s, i) => (
          <motion.li
            key={s.key}
            onMouseEnter={() => setFocus(s.key)}
            onMouseLeave={() => setFocus(null)}
            className={cn("min-w-0 transition-opacity duration-200", focus && focus !== s.key && "opacity-50")}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.3, ease: EASE_OUT, delay: 0.18 + i * 0.04 }}
          >
            <div className="flex items-start gap-2 text-[13px] leading-5 text-ink-mute">
              <span className="mt-[5px] size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <span className="min-w-0">{s.label}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 pl-[18px]">
              <span className="text-base font-semibold text-ink tabular">{tl(s.value)}</span>
              <span className="text-xs font-medium text-ink-mute tabular">{valid ? pct(s.value / sum, 0) : "–"}</span>
            </div>
            {s.note ? <div className="pl-[18px] text-xs leading-5 text-ink-mute">{s.note}</div> : null}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================ Özet ve dağılım

export type SectionTotal = { key: FixedSection; label: string; total: number };

export function FixedSummary({
  total,
  month,
  acikGun,
  sections,
  personnelCount,
  breakEvenDaily,
  breakEvenRef,
  breakEvenOnline = null,
  monthlyExpenses = [],
  next,
}: {
  total: number;
  /** Toplamın ayı, ör. "Ekim 2026" */
  month: string;
  acikGun: number;
  sections: SectionTotal[];
  personnelCount: number;
  breakEvenDaily: number | null;
  /** Başabaş hesabında kullanılan satış ayı, ör. "Eylül 2026" */
  breakEvenRef: string | null;
  /** Başabaşta sabit giderden düşülen laffogato.net online brüt kârı (Genel bakış'taki gibi); yoksa null */
  breakEvenOnline?: { month: string; amount: number } | null;
  /** Başabaşa sabit giderle birlikte giren, her ay girilen harcamalar (Aylık harcamalar; denetim E-13) */
  monthlyExpenses?: { name: string; amount: number; from: string }[];
  /** Gelecek ay toplam değişiyorsa (planlı zam, biten kalem): o ayın toplamı */
  next: { month: string; total: number } | null;
}) {
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <HeadIcon>
              <Wallet />
            </HeadIcon>
            <h2 className="text-base font-semibold tracking-tight text-ink">Aylık sabit gider · {month}</h2>
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-ink tabular sm:text-4xl">
            <CountUp value={total} />
          </p>
          <p className="mt-1 text-[13px] text-ink-mute">{acikGun} açık gün varsayımıyla · KDV hariç</p>
          {monthlyExpenses.length ? (
            <p className="mt-1.5 max-w-xl text-[13px] text-pretty text-ink-soft">
              Başabaşa ayrıca her ay girilen harcamalar girer:{" "}
              {monthlyExpenses.map((x, i) => (
                <span key={x.name}>
                  {i ? ", " : null}
                  {x.name} <span className="font-medium whitespace-nowrap text-ink tabular">{tl(x.amount)}</span>
                </span>
              ))}{" "}
              (
              <Link href={`/panel/harcamalar?ay=${monthlyExpenses[0].from}`} className="underline underline-offset-2 hover:text-ink">
                Aylık harcamalar
              </Link>
              ).
            </p>
          ) : null}
          {next ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-soft">
              <CalendarClock size={14} className="shrink-0 text-ink-mute" aria-hidden="true" />
              <span>
                {next.month} itibarıyla <span className="font-semibold text-ink tabular">{tl(next.total)}</span>{" "}
                <span className={cn("tabular", next.total > total ? "text-bad" : "text-good")}>
                  ({next.total > total ? "+" : "−"}
                  {tl(Math.abs(next.total - total))})
                </span>
              </span>
            </p>
          ) : null}
        </div>

        {breakEvenDaily ? (
          <Well className="flex w-full items-start gap-3 p-3.5 sm:w-auto sm:max-w-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info" aria-hidden="true">
              <Target size={16} />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] text-ink-mute">
                Başabaş için günlük ciro
                <InfoTip text="Bu giderleri karşılamak için günde ortalama gereken ciro (KDV dahil). Genel bakış ve Analiz'deki başabaşla aynı hesap: sabit giderler ve her ay girilen harcamalar, varsa laffogato.net online satışın brüt kârı düşülerek." />
              </p>
              <p className="text-lg font-semibold text-ink tabular">{tl(breakEvenDaily)}</p>
              <p className="text-xs leading-5 text-ink-mute">
                KDV dahil{breakEvenRef ? ` · ${breakEvenRef} brüt kâr oranıyla` : null}
                {monthlyExpenses.length ? " · aylık harcamalar dahil" : null}
                {breakEvenOnline ? ` · ${breakEvenOnline.month} online brüt kârı (${tl(breakEvenOnline.amount)}) düşüldü` : null}
              </p>
            </div>
          </Well>
        ) : null}
      </div>

      <ShareBreakdown
        className="mt-6"
        total={total}
        segments={sections.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.total,
          color: SECTION_COLOR[s.key],
          note: s.key === "personel" ? `${personnelCount} kişi, maaş + SGK` : undefined,
        }))}
      />
    </Card>
  );
}

// ============================================================================ Sabit giderler

/** Liste satırı: tutar ve dönem bu aya (bitmişse son ayına, başlamadıysa ilk ayına) göre; geçmiş ve silme izni ile */
export type FixedRow = {
  id: number;
  name: string;
  section: FixedSection;
  note: string | null;
  period: FixedPeriod;
  amount: number;
  /** Faturasındaki KDV oranı; boşsa bölümün varsayılanı (yalnız nakit planı kullanır) */
  vatRate: number | null;
  monthly: number;
  startMonth: string | null;
  endMonth: string | null;
  status: RangeStatus;
  inRangeNow: boolean;
  valueMonth: string;
  history: FixedHistoryEntry[];
  /** Silinemiyorsa nedeni (ör. "Temmuz–Eylül 2026 hesabına girdi"); null = silinebilir */
  deleteBlocker: string | null;
};
type Bolum = "tumu" | FixedSection;

/** "Temizle" ile sıfırlanan süzgeçler (sıralama korunur) */
const FIXED_FILTERS = ["ara", "bolum"];

const versionsOf = (r: FixedRow) =>
  r.history.filter((h) => h.versionId !== null).map((h) => ({ fromMonth: h.fromMonth!, label: periodAmount(h.period, h.amount) }));

/** Satırın altındaki açıklamalar: "Ekim 2026 itibarıyla · önce 160.000 ₺/ay", "Kasım 2026 itibarıyla 175.000 ₺/ay" */
function changeNotes(r: FixedRow): { since: string | null; next: string | null } {
  const { entry, prev } = entryAt(r.history, r.valueMonth);
  const since = entry?.versionId && prev ? `${monthLabel(entry.fromMonth!)} itibarıyla · önce ${periodAmount(prev.period, prev.amount)}` : null;
  // Bitiş ayından sonraki değişiklik hiç uygulanmaz: gösterilmez
  const up = r.history.find((h) => h.versionId !== null && h.fromMonth! > r.valueMonth && (!r.endMonth || h.fromMonth! <= r.endMonth));
  const next = up ? `${monthLabel(up.fromMonth!)} itibarıyla ${periodAmount(up.period, up.amount)}` : null;
  return { since, next };
}

function ChangeLines({ row, className }: { row: FixedRow; className?: string }) {
  const { since, next } = changeNotes(row);
  if (!since && !next) return null;
  return (
    <span className={cn("block space-y-0.5 text-xs leading-5 font-normal text-ink-mute", className)}>
      {next ? (
        <span className="flex items-center gap-1 text-ink-soft">
          <CalendarClock size={12} className="shrink-0" aria-hidden="true" />
          {next}
        </span>
      ) : null}
      {since ? <span className="block">{since}</span> : null}
    </span>
  );
}

type Undo = { row: FixedRow; versionId: number; fromMonth: string; label: string; back: string };

export function FixedExpensesClient({
  rows,
  personnel,
  acikGun,
  currentMonth,
  closed,
  months,
}: {
  rows: FixedRow[];
  personnel: { total: number; count: number };
  acikGun: number;
  /** "Bu ay" (YYYY-MM, Türkiye saati) */
  currentMonth: string;
  /** Hesabı olan kapanmış aylar: değişiklik bunlara dokunacaksa uyarılır */
  closed: string[];
  /** "Hangi aydan itibaren?" listesindeki aylar */
  months: string[];
}) {
  const [editing, setEditing] = useState<FixedRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<FixedRow | null>(null);
  const [stopping, setStopping] = useState<FixedRow | null>(null);
  const [resuming, setResuming] = useState<FixedRow | null>(null);
  const [undoing, setUndoing] = useState<Undo | null>(null);
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useFlash();

  const [q, setQ] = useQueryText("ara");
  const [bolum, setBolum] = useQueryState<Bolum>("bolum", "tumu");
  const [sira, setSira] = useQueryState<string>("sirala", "");
  const filtered = q.trim() !== "" || bolum !== "tumu";
  const clearFilters = () => {
    setQ("");
    clearQuery(FIXED_FILTERS);
  };

  // Ana liste: bu ay geçerli ve başlayacak kalemler. Biten kalemler "Geçmiş" bölümünde.
  const live = rows.filter((r) => r.status !== "ended");
  const ended = rows.filter((r) => r.status === "ended");
  const changes = rows
    .flatMap((r) =>
      r.history.map((h, i) => ({ r, h, prev: r.history[i - 1] })).filter((x): x is { r: FixedRow; h: FixedHistoryEntry; prev: FixedHistoryEntry } => x.h.versionId !== null),
    )
    .sort((a, b) => b.h.fromMonth!.localeCompare(a.h.fromMonth!) || a.r.name.localeCompare(b.r.name, "tr-TR"));

  // Personel satırı Maaşlar sayfasından gelir: düzenlenemez, yine de aranır ve süzülür
  const personnelLabel = `Personel (${personnel.count} kişi, maaş + SGK)`;
  const showPersonnel = (bolum === "tumu" || bolum === "personel") && matches(`${personnelLabel} SGK otomatik`, q);
  const visible = sortRows(
    live.filter((r) => (bolum === "tumu" || r.section === bolum) && matches(`${r.name} ${r.note ?? ""} ${PERIOD_LABEL[r.period]}`, q)),
    sira,
    { ad: (r) => r.name, tutar: (r) => r.amount, aylik: (r) => r.monthly },
  );
  const groups = FIXED_SECTIONS.filter((sec) => bolum === "tumu" || sec.key === bolum)
    .map((sec) => {
      const list = visible.filter((r) => r.section === sec.key);
      const withPersonnel = sec.key === "personel" && showPersonnel;
      // Bölüm toplamı bu ay geçerli kalemlerden (başlamamış kalem dahil değil)
      const subtotal = list.filter((r) => r.inRangeNow).reduce((a, r) => a + r.monthly, 0) + (withPersonnel ? personnel.total : 0);
      return { ...sec, rows: list, withPersonnel, subtotal };
    })
    .filter((g) => g.rows.length > 0 || g.withPersonnel);

  const shownTotal = groups.reduce((a, g) => a + g.subtotal, 0);
  const shownCount = visible.length + (showPersonnel ? 1 : 0);
  const shownUpcoming = visible.some((r) => !r.inRangeNow);
  const sectionCount = (key: FixedSection) => live.filter((r) => r.section === key).length + (key === "personel" ? 1 : 0);
  const totalLabel = filtered ? "Gösterilen kalemlerin toplamı" : `Toplam · ${monthLabel(currentMonth)}`;

  /** Kayıttan sonra satır vurgulanır; yeni kalem süzgece takılacaksa süzgeç kaldırılır (eklenen hemen görünsün) */
  function onSaved(id: number, isNew: boolean) {
    if (isNew && filtered) clearFilters();
    setFlash(id);
  }

  /**
   * Eylemi çalıştırır; sunucunun iletisini (hangi ayların etkilendiği) bildirim olarak gösterir. Eylem atarsa (ağ
   * kesildi, panel güncellendi; E-51) bildirim çıkar, düğmeler bırakılır, pencere açık kalır. `maybeSaved`: eylem yeni
   * kayıt açar; yanıt yolda kaybolursa "Kaydedilemedi" denmez (kayıt yapılmış olabilir, ikinci dokunuş ikinci kalemi yazar)
   */
  async function run<T extends { message?: string | null }>(p: Promise<ActionResult<T>>, fallback: string, maybeSaved = false): Promise<T | null> {
    setPending(true);
    const res = await tryAction(() => p, { maybeSaved });
    setPending(false);
    if (!res) return null;
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    toast.success(res.data.message ?? fallback);
    return res.data;
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const res = await tryAction(() => deleteFixedExpense(deleting.id));
    setPending(false);
    if (!res) return;
    // Sunucu son sözü söyler: geçmiş bir ayın hesabına girmişse silmez, nedenini yazar
    if (!res.ok) return toast.error(res.error);
    toast.success(`${deleting.name} silindi`);
    setDeleting(null);
    setEditing(null);
  }

  async function stop(r: FixedRow, lastMonth: string) {
    const done = await run(endFixedExpense(r.id, lastMonth), `${r.name} durduruldu`);
    if (done) setFlash(r.id);
    return !!done;
  }

  async function resume(r: FixedRow, fromMonth: string, mode: "clear" | "copy") {
    if (mode === "clear") {
      const done = await run(endFixedExpense(r.id, null), `${r.name} devam ediyor`);
      if (done) setFlash(r.id);
      return !!done;
    }
    // Arada kapanmış aylar var: o ayları değiştirmemek için aynı kalem seçilen aydan itibaren yeni kayıt olarak açılır
    const done = await run(
      saveFixedExpense({ id: null, name: r.name, section: r.section, period: r.period, amount: r.amount, note: r.note, vatRate: r.vatRate, effectiveFrom: fromMonth }),
      `${r.name} ${monthLabel(fromMonth)} itibarıyla devam ediyor`,
      true,
    );
    if (done) onSaved(done.id, true);
    return !!done;
  }

  async function unstop(r: FixedRow) {
    const done = await run(endFixedExpense(r.id, null), `${r.name}: bitiş ayı kaldırıldı`);
    if (done) setFlash(r.id);
  }

  async function confirmUndo() {
    if (!undoing) return;
    const done = await run(deleteFixedExpenseVersion(undoing.versionId), "Değişiklik geri alındı");
    if (!done) return;
    setFlash(undoing.row.id);
    setUndoing(null);
  }

  function askUndo(r: FixedRow, versionId: number) {
    const i = r.history.findIndex((h) => h.versionId === versionId);
    const h = r.history[i];
    const prev = r.history[i - 1];
    if (!h || !prev) return;
    setUndoing({ row: r, versionId, fromMonth: h.fromMonth!, label: periodAmount(h.period, h.amount), back: periodAmount(prev.period, prev.amount) });
  }

  const sortHead = (key: string, label: ReactNode, numeric?: boolean) => (
    <SortButton dir={sortDir(sira, key)} numeric={numeric} onClick={() => setSira(nextSort(sira, key, numeric))}>
      {label}
    </SortButton>
  );

  const addButton = (
    <Button size="sm" onClick={() => setEditing("new")}>
      <Plus size={16} /> Gider ekle
    </Button>
  );

  /** Satır eylemleri: düzenle, durdur / durdurmayı kaldır, (izin varsa) sil */
  const rowActions = (r: FixedRow) => (
    <div className="flex justify-end gap-1.5">
      <IconButton label={`${r.name}: düzenle`} onClick={() => setEditing(r)}>
        <Pencil size={15} />
      </IconButton>
      {r.status === "active" ? (
        r.endMonth ? (
          <IconButton label={`${r.name}: durdurmayı kaldır (devam ettir)`} onClick={() => void unstop(r)} disabled={pending}>
            <CirclePlay size={15} />
          </IconButton>
        ) : (
          <IconButton label={`${r.name}: durdur`} onClick={() => setStopping(r)}>
            <CirclePause size={15} />
          </IconButton>
        )
      ) : null}
      {!r.deleteBlocker ? (
        <IconButton label={`${r.name}: sil`} tone="danger" onClick={() => setDeleting(r)}>
          <Trash2 size={15} />
        </IconButton>
      ) : null}
    </div>
  );

  return (
    <Card>
      <CardHeader
        icon={<Wallet />}
        title="Aylık sabit giderler"
        description={`Satıra tıklayınca düzenlenir. Tutarlar ${monthLabel(currentMonth)} değerleri; değişiklikler seçtiğiniz aydan itibaren geçerli olur.`}
        meta={
          <>
            <span>Bu ay · {live.filter((r) => r.inRangeNow).length + 1} kalem</span>
            {ended.length ? <span className="text-ink-quiet">· Biten · {ended.length}</span> : null}
          </>
        }
        actions={addButton}
      />

      <div className="px-5 pb-3">
        <FilterBar active={filtered} onClear={clearFilters} shown={shownCount} total={live.length + 1} unit="kalem">
          <SearchField value={q} onChange={setQ} placeholder="Gider ara" label="Gider ara (ad ya da not)" className="w-full sm:w-56" />
          {/* Beş seçenek telefona sığmaz: orada aynı süzgeç açılır liste olarak */}
          <Segmented<Bolum>
            label="Bölüm"
            value={bolum}
            onChange={setBolum}
            className="max-sm:hidden"
            options={[{ value: "tumu", label: "Tümü" }, ...FIXED_SECTIONS.map((s) => ({ value: s.key, label: SECTION_SHORT[s.key], count: sectionCount(s.key) }))]}
          />
          <Select value={bolum} onChange={(e) => setBolum(e.target.value as Bolum)} aria-label="Bölüm" className="w-auto flex-1 sm:hidden">
            <option value="tumu">Tüm bölümler</option>
            {FIXED_SECTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({sectionCount(s.key)})
              </option>
            ))}
          </Select>
        </FilterBar>
      </div>

      {shownCount === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="Bu süzgece uyan gider yok"
          description="Aramayı kısaltın ya da bölüm seçimini kaldırın. Biten kalemler aşağıdaki Geçmiş bölümünde."
          action={
            <>
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Süzgeci temizle
              </Button>
              {addButton}
            </>
          }
        />
      ) : (
        <>
          {/*
            Geniş ekran: tablo. xl altında kartlar: tablo 870px, 768px tablette ve kenar çubuğu açılan 1024px'te sığmıyor;
            Durum ve düzenle / durdur düğmeleri yana kayıp gizleniyordu.
          */}
          <TableWrap className="max-xl:hidden">
            <Table>
              <THead>
                <tr>
                  <TH>{sortHead("ad", "Gider kalemi")}</TH>
                  <TH numeric>{sortHead("tutar", "Tutar", true)}</TH>
                  <TH>Dönem</TH>
                  <TH numeric>{sortHead("aylik", "Aylık karşılığı", true)}</TH>
                  <TH>Kaynak / not</TH>
                  <TH>
                    <span className="inline-flex items-center gap-1">
                      Durum{" "}
                      <InfoTip text="Durdurulan kalem silinmez: son ayına kadar gelir-gider tablosunda kalır, sonraki aylara girmez. Geçmiş ayların hesabına girmiş kalem silinemez." />
                    </span>
                  </TH>
                  <TH>
                    <span className="sr-only">Eylemler</span>
                  </TH>
                </tr>
              </THead>
              {groups.map((g, gi) => {
                const pad = gi === 0 ? "pt-3" : "pt-6";
                return (
                  <tbody key={g.key}>
                    <tr className="border-b border-line">
                      <th scope="rowgroup" colSpan={3} className={cn("px-3 pb-2 text-left font-normal", pad)}>
                        <SectionLabel section={g.key} label={g.label} count={g.rows.length + (g.withPersonnel ? 1 : 0)} />
                      </th>
                      <td className={cn("px-3 pb-2 text-right text-[13px] font-semibold whitespace-nowrap text-ink tabular", pad)}>
                        <span className="sr-only">Bölüm toplamı </span>
                        {tl(g.subtotal)}
                      </td>
                      <td colSpan={3} className={pad} />
                    </tr>

                    {g.withPersonnel ? (
                      <TR>
                        <TD className="font-medium">
                          <Link href="/panel/personel" className="rounded-md hover:underline">
                            {personnelLabel}
                          </Link>
                        </TD>
                        <TD numeric className="text-ink-quiet">
                          –
                        </TD>
                        <TD className="text-[13px] whitespace-nowrap text-ink-mute">Maaşlar sayfasından</TD>
                        <TD numeric className="font-semibold">
                          {tl(personnel.total)}
                        </TD>
                        <TD className="min-w-44 text-[13px] text-ink-mute">Toplam işveren maliyeti, otomatik</TD>
                        <TD>
                          <Badge tone="blue">Otomatik</Badge>
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-1.5">
                            <IconLink href="/panel/personel" label="Maaşlar sayfasına git">
                              <ArrowUpRight size={16} />
                            </IconLink>
                          </div>
                        </TD>
                      </TR>
                    ) : null}

                    {g.rows.map((r) => {
                      const dim = !r.inRangeNow && "opacity-60";
                      const rule = periodRule(r.period, acikGun);
                      return (
                        <TR
                          key={r.id}
                          ref={r.id === flash ? revealRow : undefined}
                          className={cn("cursor-pointer", r.id === flash && FLASH)}
                          onClick={() => setEditing(r)}
                        >
                          <TD className={cn("font-medium", dim)}>
                            {r.name}
                            <ChangeLines row={r} className="mt-0.5" />
                          </TD>
                          <TD numeric className={cn(dim)}>
                            {money(r.amount)}
                          </TD>
                          <TD className={cn("whitespace-nowrap", dim)}>
                            <span className="inline-flex items-center gap-1.5">
                              <Badge tone="gray">{PERIOD_LABEL[r.period]}</Badge>
                              {rule ? <span className="text-xs text-ink-mute tabular">{rule}</span> : null}
                            </span>
                          </TD>
                          <TD numeric className={cn("font-semibold", dim)}>
                            {money(r.monthly)}
                          </TD>
                          <TD className={cn("max-w-80 min-w-44 text-[13px] text-ink-mute", dim)}>
                            {r.note ? (
                              <span className="line-clamp-2" title={r.note}>
                                {r.note}
                              </span>
                            ) : null}
                          </TD>
                          <TD>
                            <RangeBadge status={r.status} range={r} currentMonth={currentMonth} />
                          </TD>
                          <TD onClick={(e) => e.stopPropagation()}>{rowActions(r)}</TD>
                        </TR>
                      );
                    })}
                  </tbody>
                );
              })}
              <tfoot>
                <TFootRow>
                  <TD colSpan={3}>{totalLabel}</TD>
                  <TD numeric>{tl(shownTotal)}</TD>
                  <TD colSpan={3} className="text-[13px] font-normal text-ink-mute">
                    {shownUpcoming ? "Henüz başlamayan kalemler dahil değil" : null}
                  </TD>
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>

          {/* Telefon ve tablet: aynı bilgiler kart listesi olarak; yatay kaydırma yok, aylık tutar her satırda görünür */}
          <div className="xl:hidden">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label} className="border-t border-line first:border-t-0">
                <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1.5">
                  <SectionLabel section={g.key} label={g.label} count={g.rows.length + (g.withPersonnel ? 1 : 0)} />
                  <span className="shrink-0 text-[13px] font-semibold text-ink tabular">
                    <span className="sr-only">Bölüm toplamı </span>
                    {tl(g.subtotal)}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {g.withPersonnel ? (
                    <li>
                      <Link href="/panel/personel" className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">{personnelLabel}</span>
                          <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-mute">
                            <Badge tone="blue">Otomatik</Badge> Maaşlar sayfasından
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-semibold text-ink tabular">{tl(personnel.total)}</span>
                          <ArrowUpRight size={16} className="text-ink-mute" aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  ) : null}
                  {g.rows.map((r) => (
                    <FixedCard
                      key={r.id}
                      row={r}
                      flash={r.id === flash}
                      acikGun={acikGun}
                      currentMonth={currentMonth}
                      onEdit={() => setEditing(r)}
                      actions={rowActions(r)}
                    />
                  ))}
                </ul>
              </section>
            ))}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line-strong px-5 py-3.5">
              <span className="font-semibold text-ink">{totalLabel}</span>
              <span className="font-semibold text-ink tabular">{tl(shownTotal)}</span>
              {shownUpcoming ? <span className="w-full text-xs text-ink-mute">Henüz başlamayan kalemler dahil değil</span> : null}
            </div>
          </div>
        </>
      )}

      {/* Geçmiş: biten kalemler ve tutar değişiklikleri (nadiren gerekir, kapalı gelir) */}
      <div className="border-t border-line px-5 py-3.5">
        <Disclosure
          title="Geçmiş"
          summary={
            ended.length || changes.length
              ? [ended.length ? `${ended.length} biten kalem` : "", changes.length ? `${changes.length} tutar değişikliği` : ""].filter(Boolean).join(" · ")
              : "Henüz yok: durdurulan kalemler ve tutar değişiklikleri burada görünür"
          }
          headClassName="pointer-coarse:min-h-11"
        >
          <div className="space-y-5 pt-3 pb-1">
            {ended.length ? (
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-soft">Biten kalemler</p>
                <ul className="divide-y divide-line rounded-xl bg-surface ring-1 ring-line">
                  {ended.map((r) => (
                    <li
                      key={r.id}
                      ref={r.id === flash ? revealRow : undefined}
                      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3.5 py-2.5", r.id === flash && FLASH)}
                    >
                      <button type="button" onClick={() => setEditing(r)} className="min-w-0 cursor-pointer text-left">
                        <span className="block text-sm font-medium text-ink">{r.name}</span>
                        <span className="block text-xs text-ink-mute">
                          {rangeText(r)} · son tutar {periodAmount(r.period, r.amount)} (aylık {money(r.monthly)})
                        </span>
                      </button>
                      <span className="flex items-center gap-1.5">
                        <Button size="xs" variant="secondary" onClick={() => setResuming(r)}>
                          <CirclePlay size={14} /> Devam ettir
                        </Button>
                        {!r.deleteBlocker ? (
                          <IconButton label={`${r.name}: sil`} tone="danger" onClick={() => setDeleting(r)}>
                            <Trash2 size={15} />
                          </IconButton>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {changes.length ? (
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-soft">Tutar değişiklikleri</p>
                <ul className="divide-y divide-line rounded-xl bg-surface ring-1 ring-line">
                  {changes.map(({ r, h, prev }) => (
                    <li key={h.versionId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-2.5 text-[13px]">
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{r.name}</span>
                        <span className="text-ink-mute">
                          {" "}
                          · {monthLabel(h.fromMonth!)} itibarıyla{" "}
                          <span className="font-semibold text-ink tabular">{periodAmount(h.period, h.amount)}</span> (önce {periodAmount(prev.period, prev.amount)})
                        </span>
                      </span>
                      <Button size="xs" variant="ghost" onClick={() => askUndo(r, h.versionId!)}>
                        <Undo2 size={14} /> Geri al
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!ended.length && !changes.length ? (
              <p className="text-[13px] text-ink-mute">
                Bir tutarı &quot;bu aydan itibaren&quot; değiştirdiğinizde ya da bir kalemi durdurduğunuzda önceki aylar eski hâliyle kalır; kayıtları burada görürsünüz.
              </p>
            ) : null}
          </div>
        </Disclosure>
      </div>

      {editing ? (
        <FixedDialog
          row={editing === "new" ? null : editing}
          defaultSection={bolum === "tumu" ? "genel" : bolum}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onDelete={(r) => setDeleting(r)}
          onStop={(r) => {
            setEditing(null);
            setStopping(r);
          }}
          onResume={(r) => {
            setEditing(null);
            setResuming(r);
          }}
          onUnstop={(r) => {
            setEditing(null);
            void unstop(r);
          }}
          onUndo={(r, versionId) => {
            setEditing(null);
            askUndo(r, versionId);
          }}
          acikGun={acikGun}
          currentMonth={currentMonth}
          closed={closed}
          months={months}
        />
      ) : null}
      {stopping ? (
        <StopDialog
          open
          onClose={() => setStopping(null)}
          name={stopping.name}
          what="gider"
          range={stopping}
          currentMonth={currentMonth}
          closed={closed}
          months={months}
          deleteBlocker={stopping.deleteBlocker}
          onConfirm={(last) => stop(stopping, last)}
        />
      ) : null}
      {resuming && resuming.endMonth ? (
        <ResumeDialog
          open
          onClose={() => setResuming(null)}
          name={resuming.name}
          what="gider"
          endMonth={resuming.endMonth}
          currentMonth={currentMonth}
          onConfirm={(from, mode) => resume(resuming, from, mode)}
        />
      ) : null}
      <ConfirmDialog
        open={undoing !== null}
        onClose={() => setUndoing(null)}
        onConfirm={() => void confirmUndo()}
        pending={pending}
        tone="primary"
        title="Değişikliği geri al"
        confirmLabel="Geri al"
        description={
          undoing ? (
            <>
              <strong className="font-semibold text-ink">{undoing.row.name}</strong>: {monthLabel(undoing.fromMonth)} itibarıyla {undoing.label} değişikliği
              silinir; o aydan itibaren {undoing.back} geçerli olur.
              {(() => {
                const hit = undoing.fromMonth < currentMonth ? closed.filter((m) => m >= undoing.fromMonth) : [];
                return hit.length ? <span className="mt-2 block font-medium text-warn">Kapanmış {spanText(hit)} kâr/zararı da değişir.</span> : null;
              })()}
            </>
          ) : null
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        pending={pending}
        title="Gideri sil"
        confirmLabel="Gideri sil"
        description={
          deleting ? (
            <>
              <strong className="font-semibold text-ink">{deleting.name}</strong> (aylık {money(deleting.monthly)}) kalıcı olarak silinecek ve değişiklik
              geçmişi de gider. Hiçbir kapanmış ayın hesabına girmediği için geçmiş aylar değişmez. Bu işlem geri alınamaz.
            </>
          ) : null
        }
      />
    </Card>
  );
}

/** Bölüm başlığı: renkli ikon karosu + ad + kalem sayısı (tabloda ve telefon listesinde aynı) */
function SectionLabel({ section, label, count }: { section: FixedSection; label: string; count: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface [&>svg]:size-3.5 [&>svg]:stroke-[2]"
        style={{ color: SECTION_COLOR[section] }}
        aria-hidden="true"
      >
        {SECTION_ICON[section]}
      </span>
      <span className="truncate text-[13px] font-semibold text-ink">{label}</span>
      <span className="text-[13px] whitespace-nowrap text-ink-mute tabular">{count} kalem</span>
    </span>
  );
}

/** Telefonda bir sabit gider: ad, dönem kuralı, not; sağda aylık karşılığı; altta durum ve eylemler */
function FixedCard({
  row: r,
  flash,
  acikGun,
  currentMonth,
  onEdit,
  actions,
}: {
  row: FixedRow;
  /** Az önce kaydedildi: kısa süre vurgulanır */
  flash?: boolean;
  acikGun: number;
  currentMonth: string;
  onEdit: () => void;
  actions: ReactNode;
}) {
  const rule = periodRule(r.period, acikGun);
  return (
    <li ref={flash ? revealRow : undefined} className={cn("px-5 py-3 transition-colors", flash && FLASH)}>
      <button type="button" onClick={onEdit} className={cn("flex w-full cursor-pointer items-start justify-between gap-3 text-left", !r.inRangeNow && "opacity-60")}>
        <span className="min-w-0">
          <span className="block font-medium break-words text-ink">{r.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute tabular">
            <Badge tone="gray">{PERIOD_LABEL[r.period]}</Badge>
            {money(r.amount)}
            {rule ? ` ${rule}` : ""}
          </span>
          <ChangeLines row={r} className="mt-1" />
          {r.note ? <span className="mt-1 line-clamp-2 text-xs text-ink-mute">{r.note}</span> : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold text-ink tabular">{money(r.monthly)}</span>
          <span className="block text-xs text-ink-mute">aylık</span>
        </span>
      </button>
      <div className="mt-1 flex items-center justify-between gap-2">
        <RangeBadge status={r.status} range={r} currentMonth={currentMonth} />
        {actions}
      </div>
    </li>
  );
}

function FixedDialog({
  row,
  defaultSection,
  onClose,
  onSaved,
  onDelete,
  onStop,
  onResume,
  onUnstop,
  onUndo,
  acikGun,
  currentMonth,
  closed,
  months,
}: {
  row: FixedRow | null;
  /** Yeni giderde seçili bölüm (süzgeçte bir bölüm seçiliyse o) */
  defaultSection: FixedSection;
  onClose: () => void;
  /** Kayıttan sonra: listede satırı vurgulamak için kimlik ve yeni mi */
  onSaved: (id: number, isNew: boolean) => void;
  /** Silme onayını açar; onaylanınca bu pencere de kapanır */
  onDelete: (row: FixedRow) => void;
  onStop: (row: FixedRow) => void;
  onResume: (row: FixedRow) => void;
  onUnstop: (row: FixedRow) => void;
  onUndo: (row: FixedRow, versionId: number) => void;
  acikGun: number;
  currentMonth: string;
  closed: string[];
  months: string[];
}) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  /** "Kaydet, yenisini ekle" ile bu pencerede eklenen kalem sayısı */
  const [added, setAdded] = useState(0);
  const [f, setF] = useState({
    name: row?.name ?? "",
    section: row?.section ?? defaultSection,
    period: row?.period ?? ("aylik" as FixedPeriod),
    amount: row ? num(row.amount, 2) : "",
    note: row?.note ?? "",
    // Faturadaki KDV: kalemde girilmemişse bölümün varsayılanı gösterilir ve bölümle birlikte değişir
    vatRate: row?.vatRate ?? null,
  });
  const vatRate = fixedVatRate({ section: f.section, vatRate: f.vatRate });
  // Biten kalemde tutar değişikliği kalemin kendi ayları için anlamlı: varsayılan olarak son ayı
  const [choice, setChoice] = useState<MonthChoice>(() =>
    row?.status === "ended" ? { mode: "month", month: row.valueMonth } : { mode: "current", month: row?.status === "upcoming" ? row.valueMonth : currentMonth },
  );
  const amount = f.amount.trim() === "" ? 0 : parseNumberTR(f.amount);
  const amountError = amount === null || amount < 0 ? "Geçerli bir tutar yazın, ör. 1.250,50" : null;
  const nameError = tried && !f.name.trim() ? "Gider adını yazın" : null;
  const monthly = monthlyOf(amount ?? 0, f.period, acikGun);
  const amountChanged = !!row && amount !== null && (f.period !== row.period || Math.abs(amount - row.amount) > 1e-9);
  const eff = choiceValue(choice, currentMonth);

  const effect: EffectText | null = !row
    ? startText({ choice: eff, currentMonth, closed, what: "gider" })
    : amountChanged && amount !== null
      ? (() => {
          const from = eff === "all" ? currentMonth : eff;
          const before = entryAt(row.history, shiftMonth(from, -1)).entry ?? row.history[0];
          return amountChangeText({
            choice: eff,
            currentMonth,
            closed,
            range: row,
            before: before ? periodAmount(before.period, before.amount) : periodAmount(row.period, row.amount),
            after: periodAmount(f.period, amount),
            versions: versionsOf(row),
          });
        })()
      : null;

  async function save(again: boolean) {
    setTried(true);
    if (!f.name.trim()) return nameRef.current?.focus();
    if (amountError || amount === null) return amountRef.current?.focus();
    setBusy(true);
    const res = await tryAction(() =>
      saveFixedExpense({
        id: row?.id ?? null,
        name: f.name,
        section: f.section,
        period: f.period,
        amount,
        note: f.note,
        vatRate,
        // Tutar değişmediyse gösterilen ayın değeri geri gider (hiçbir ay değişmez)
        effectiveFrom: !row || amountChanged ? eff : row.valueMonth,
      }),
      // Yeni kalemde yanıt yolda kaybolursa kalem yazılmış olabilir: ikinci "Kaydet" aynı gideri iki kez ekler
      { maybeSaved: !row },
    );
    setBusy(false);
    // Atılan eylem (E-51): bildirim çıktı, pencere ve yazılanlar yerinde
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    onSaved(res.data.id, !row);
    toast.success(row ? `${f.name.trim()} güncellendi` : `${f.name.trim()} eklendi`, {
      description: res.data.message ?? `Aylık karşılığı ${money(monthly)}`,
    });
    if (!again) return onClose();
    // Bölüm, dönem ve başlangıç ayı korunur: aynı türden kalemler arka arkaya girilir
    setF((x) => ({ ...x, name: "", amount: "", note: "", vatRate: null }));
    setTried(false);
    setAdded((n) => n + 1);
    nameRef.current?.focus();
  }

  const sectionChanged = !!row && f.section !== row.section;
  /** Durdur / devam ettir / sil (düzenlemede) ya da "N gider eklendi" sayacı (eklemede) */
  const secondary =
    row ? (
      <>
        {row.status === "ended" ? (
          <Button variant="ghost" onClick={() => onResume(row)} disabled={busy}>
            <CirclePlay size={16} /> Devam ettir
          </Button>
        ) : row.status === "active" && row.endMonth ? (
          <Button variant="ghost" onClick={() => onUnstop(row)} disabled={busy}>
            <CirclePlay size={16} /> Durdurmayı kaldır
          </Button>
        ) : row.status === "active" ? (
          <Button variant="ghost" onClick={() => onStop(row)} disabled={busy}>
            <CirclePause size={16} /> Durdur
          </Button>
        ) : null}
        {!row.deleteBlocker ? (
          <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => onDelete(row)} disabled={busy}>
            <Trash2 size={16} /> Sil
          </Button>
        ) : null}
      </>
    ) : added ? (
      <span className="text-[13px] text-ink-mute tabular" aria-live="polite">
        {added} gider eklendi
      </span>
    ) : null;
  const activeIdx = row ? row.history.indexOf(entryAt(row.history, row.valueMonth).entry ?? row.history[0]) : 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? "Gideri düzenle" : "Sabit gider ekle"}
      description={row ? undefined : "Günlük, haftalık ya da yıllık tutar yazabilirsiniz; aylık karşılığı otomatik hesaplanır."}
      footerStart={secondary}
      footerStartOnPhone="body"
      footer={
        <>
          {/* Telefonda yeni giderde üç düğme sığmaz: kapatmak için sağ üstteki × ya da aşağı çekmek yeter */}
          <Button variant="ghost" onClick={onClose} className={cn(!row && "max-sm:hidden")}>
            {added ? "Kapat" : "Vazgeç"}
          </Button>
          {/* type="button": Enter her zaman asıl "Kaydet"i çalıştırsın */}
          {!row ? (
            <Button variant="secondary" onClick={() => void save(true)} disabled={busy}>
              {/* Telefonda üç düğme tek satıra sığsın */}
              <span className="sm:hidden">Kaydet ve yeni</span>
              <span className="max-sm:hidden">Kaydet, yenisini ekle</span>
            </Button>
          ) : null}
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3 pb-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <Field label="Gider kalemi" htmlFor="fx-n" error={nameError}>
          <Input
            ref={nameRef}
            id="fx-n"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="ör. Elektrik, Muhasebeci"
            aria-invalid={nameError ? true : undefined}
            maxLength={120}
            data-autofocus={row ? undefined : true}
            enterKeyHint="next"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Bölüm"
            tip="Gelir-gider tablosunda bu kalemin görüneceği bölüm."
            htmlFor="fx-s"
            hint={sectionChanged ? "Bütün aylarda bu bölümde görünür (kâr değişmez)." : undefined}
          >
            <Select id="fx-s" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value as FixedSection })} >
              {FIXED_SECTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dönem" htmlFor="fx-p" hint={FIXED_PERIODS.find((p) => p.key === f.period)?.hint}>
            <Select id="fx-p" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as FixedPeriod })}>
              {FIXED_PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={`${PERIOD_LABEL[f.period]} tutar (₺, KDV hariç)`}
          htmlFor="fx-a"
          error={amountError}
          hint={
            <>
              Aylık karşılığı: <span className="font-semibold text-ink tabular">{tl(monthly, 2)}</span>
              {f.period === "gunluk" ? ` (${acikGun} açık gün)` : null}
              {row && !amountChanged ? <span className="block">{monthLabel(row.valueMonth)} tutarı. Değiştirirseniz hangi aydan itibaren geçerli olacağı sorulur.</span> : null}
            </>
          }
        >
          <NumberInput
            ref={amountRef}
            id="fx-a"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="0,00"
            aria-invalid={amountError ? true : undefined}
            className="cell-input pointer-coarse:h-12 pointer-coarse:text-lg"
          />
        </Field>

        <Field
          label="Faturadaki KDV"
          htmlFor="fx-v"
          tip="Gelir-gider KDV hariç tutarla hesaplanır. Nakit planı gideri faturadaki KDV'siyle öder: kira 10.000 ₺ + %20 KDV ise bankadan 12.000 ₺ çıkar."
          hint={vatRate ? `Nakit planı aylık ${money(monthly * (1 + vatRate))} öder (KDV dahil).` : "Nakit planı KDV eklemeden öder."}
        >
          <Select id="fx-v" value={String(vatRate)} onChange={(e) => setF({ ...f, vatRate: Number(e.target.value) })}>
            {FIXED_VAT_RATES.map((r) => (
              <option key={r.value} value={String(r.value)}>
                {r.label}
                {f.vatRate === null && r.value === FIXED_SECTION_VAT[f.section] ? " (bölümün varsayılanı)" : ""}
              </option>
            ))}
          </Select>
        </Field>

        {!row || amountChanged ? (
          <MonthChoiceField
            legend={row ? "Yeni tutar hangi aydan itibaren?" : "Hangi aydan itibaren?"}
            tip="Excel'deki gibi her ay kendi tutarını taşır: seçtiğiniz aydan önceki aylar değişmez."
            value={choice}
            onChange={setChoice}
            currentMonth={currentMonth}
            months={months}
            allLabel={row ? "Bütün aylar (geçmiş de değişir)" : "Baştan beri (geçmiş aylara da eklenir)"}
            allHint={row ? "Yanlış girilmiş bir tutarı düzeltmek için." : "Kalem hep vardı ama panele yeni giriliyorsa."}
            effect={effect}
          />
        ) : null}

        <Field label="Kaynak / not" htmlFor="fx-note" hint="İsteğe bağlı: fatura, sözleşme ya da hesap notu.">
          <Textarea id="fx-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} maxLength={1000} />
        </Field>

        {row ? (
          <Disclosure
            title="Geçmiş"
            summary={`${rangeText(row)} · ${row.history.length > 1 ? `${row.history.length - 1} tutar değişikliği` : "tutar değişikliği yok"}`}
            tile
          >
            <div className="space-y-2.5 pt-0.5">
              <HistoryList
                rows={row.history.map((h) => ({ fromMonth: h.fromMonth, versionId: h.versionId, label: periodAmount(h.period, h.amount) }))}
                startMonth={row.startMonth}
                activeIndex={activeIdx}
                onUndo={(h) => h.versionId && onUndo(row, h.versionId)}
                disabled={busy}
              />
              <p className="text-xs leading-5 text-ink-mute">
                {row.endMonth ? `Son ay: ${monthLabel(row.endMonth)}. ` : ""}
                {row.deleteBlocker
                  ? `Silinemez: ${row.deleteBlocker}. Artık kullanılmıyorsa durdurun; geçmiş aylarda kalır.`
                  : "Hiçbir kapanmış ayın hesabına girmediği için silinebilir."}
              </p>
            </div>
          </Disclosure>
        ) : null}
      </form>
    </Dialog>
  );
}

// ============================================================================ Yatırımlar

type Investment = { id: number; name: string; amount: number; date: string | null; note: string | null };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-07" ise "Temmuz 2026", değilse yazıldığı gibi */
function periodText(date: string | null) {
  if (!date) return "–";
  return MONTH_RE.test(date) ? monthLabel(date) : date;
}

export function InvestmentsClient({ rows, total }: { rows: Investment[]; total: number }) {
  const [editing, setEditing] = useState<Investment | "new" | null>(null);
  const [deleting, setDeleting] = useState<Investment | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [sira, setSira] = useQueryState<string>("ysirala", "");
  const sorted = sortRows(rows, sira, { ad: (r) => r.name, donem: (r) => r.date ?? "", tutar: (r) => r.amount });
  const [flash, setFlash] = useFlash();

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    const res = await tryAction(() => deleteInvestment(deleting.id));
    setDeletePending(false);
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    toast.success(`${deleting.name} silindi`);
    setDeleting(null);
    setEditing(null);
  }

  const sortHead = (key: string, label: ReactNode, numeric?: boolean) => (
    <SortButton dir={sortDir(sira, key)} numeric={numeric} onClick={() => setSira(nextSort(sira, key, numeric))}>
      {label}
    </SortButton>
  );

  const addButton = (
    <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
      <Plus size={16} /> Yatırım ekle
    </Button>
  );

  return (
    <Card>
      <CardHeader
        icon={<PiggyBank />}
        title="Tek seferlik yatırımlar"
        description="Bilgi amaçlı, aylık gidere dahil değil."
        meta={
          <>
            <span className="font-medium text-ink tabular">Toplam {tl(total)}</span>
            <span>(KDV hariç)</span>
            <span className="text-ink-quiet">· {rows.length} kayıt</span>
          </>
        }
        actions={addButton}
      />
      {rows.length ? (
        <>
          <TableWrap className="max-sm:hidden">
            <Table>
              <THead>
                <tr>
                  <TH>{sortHead("ad", "Yatırım")}</TH>
                  <TH>{sortHead("donem", "Dönem")}</TH>
                  <TH numeric>{sortHead("tutar", "Tutar", true)}</TH>
                  <TH>Not</TH>
                  <TH>
                    <span className="sr-only">Eylemler</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {sorted.map((r) => (
                  <TR
                    key={r.id}
                    ref={r.id === flash ? revealRow : undefined}
                    className={cn("cursor-pointer", r.id === flash && FLASH)}
                    onClick={() => setEditing(r)}
                  >
                    {/* Uzun not sütunu adı sıkıştırmasın (1024'te ad üç satıra iniyordu) */}
                    <TD className="min-w-52 font-medium">{r.name}</TD>
                    <TD className="whitespace-nowrap text-ink-soft" title={r.date ?? undefined}>
                      {periodText(r.date)}
                    </TD>
                    <TD numeric className="font-semibold">
                      {tl(r.amount)}
                    </TD>
                    <TD className="max-w-96 min-w-44 text-[13px] text-ink-mute">
                      {r.note ? (
                        <span className="line-clamp-2" title={r.note}>
                          {r.note}
                        </span>
                      ) : null}
                    </TD>
                    <TD onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <IconButton label={`${r.name}: düzenle`} onClick={() => setEditing(r)}>
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton label={`${r.name}: sil`} tone="danger" onClick={() => setDeleting(r)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
              <tfoot>
                <TFootRow>
                  <TD colSpan={2}>Toplam</TD>
                  <TD numeric>{tl(total)}</TD>
                  <TD colSpan={2} className="text-[13px] font-normal text-ink-mute">
                    KDV hariç
                  </TD>
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>

          <div className="sm:hidden">
            <ul className="divide-y divide-line border-t border-line">
              {/* Tutar ve eylemler sağda alt alta: her kayıt için ayrı bir eylem satırı açılmaz */}
              {sorted.map((r) => (
                <li
                  key={r.id}
                  ref={r.id === flash ? revealRow : undefined}
                  className={cn("flex items-start gap-3 px-5 py-3 transition-colors", r.id === flash && FLASH)}
                >
                  <button type="button" onClick={() => setEditing(r)} className="min-w-0 flex-1 cursor-pointer self-stretch text-left">
                    <span className="block font-medium break-words text-ink">{r.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-mute">{periodText(r.date)}</span>
                    {r.note ? <span className="mt-1 line-clamp-2 text-xs text-ink-mute">{r.note}</span> : null}
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-semibold text-ink tabular">{tl(r.amount)}</span>
                    <div className="flex gap-1.5">
                      <IconButton label={`${r.name}: düzenle`} onClick={() => setEditing(r)}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton label={`${r.name}: sil`} tone="danger" onClick={() => setDeleting(r)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-3 border-t border-line-strong px-5 py-3.5 font-semibold text-ink">
              <span>Toplam</span>
              <span className="tabular">{tl(total)}</span>
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          icon={<PiggyBank />}
          title="Yatırım kaydı yok"
          description="Açılış, ekipman, dekorasyon gibi tek seferlik harcamaları buraya ekleyin."
          action={addButton}
        />
      )}
      {editing ? (
        <InvestmentDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={setFlash} onDelete={setDeleting} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        pending={deletePending}
        title="Yatırımı sil"
        confirmLabel="Yatırımı sil"
        description={
          deleting ? (
            <>
              <strong className="font-semibold text-ink">{deleting.name}</strong> ({tl(deleting.amount)}) kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </>
          ) : null
        }
      />
    </Card>
  );
}

function InvestmentDialog({
  row,
  onClose,
  onSaved,
  onDelete,
}: {
  row: Investment | null;
  onClose: () => void;
  /** Kayıttan sonra listede vurgulanacak satır */
  onSaved: (id: number) => void;
  onDelete: (row: Investment) => void;
}) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [name, setName] = useState(row?.name ?? "");
  const [amount, setAmount] = useState(row ? num(row.amount, 2) : "");
  const [date, setDate] = useState(row?.date ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  // Ay seçici yalnızca dönem boşsa ya da YYYY-AA ise; elle yazılmış eski değerler metin olarak kalır
  const [monthPicker] = useState(() => !row?.date || MONTH_RE.test(row.date));
  const parsed = amount.trim() === "" ? 0 : parseNumberTR(amount);
  const amountError = parsed === null || parsed < 0 ? "Geçerli bir tutar yazın, ör. 12.500" : null;
  const nameError = tried && !name.trim() ? "Yatırımın adını yazın" : null;

  const deleteButton = row ? (
    <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => onDelete(row)} disabled={busy}>
      <Trash2 size={16} /> Sil
    </Button>
  ) : null;

  async function save() {
    setTried(true);
    if (!name.trim()) return nameRef.current?.focus();
    if (amountError || parsed === null) return amountRef.current?.focus();
    setBusy(true);
    const res = await tryAction(() => saveInvestment({ id: row?.id ?? null, name, amount: parsed, date, note }), { maybeSaved: !row });
    setBusy(false);
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    onSaved(res.data.id);
    toast.success(row ? `${name.trim()} güncellendi` : `${name.trim()} eklendi`, { description: `${tl(parsed)} · KDV hariç` });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? "Yatırımı düzenle" : "Yatırım ekle"}
      footerStart={row ? deleteButton : null}
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3 pb-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Yatırım" htmlFor="iv-n" error={nameError}>
          <Input
            ref={nameRef}
            id="iv-n"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ör. Kahve makinesi, tabela"
            aria-invalid={nameError ? true : undefined}
            maxLength={160}
            data-autofocus={row ? undefined : true}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tutar (₺, KDV hariç)" htmlFor="iv-a" error={amountError}>
            <NumberInput
              ref={amountRef}
              id="iv-a"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="0,00"
              aria-invalid={amountError ? true : undefined}
              className="cell-input"
            />
          </Field>
          <Field label="Dönem" htmlFor="iv-d" hint="Harcamanın yapıldığı ay; boş bırakılabilir.">
            <Input
              id="iv-d"
              type={monthPicker ? "month" : "text"}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="2026-07"
              maxLength={10}
            />
          </Field>
        </div>
        <Field label="Not" htmlFor="iv-note">
          <Textarea id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
      </form>
    </Dialog>
  );
}
