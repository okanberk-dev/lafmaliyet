"use client";

import {
  AlertTriangle,
  ArrowDown,
  Check,
  ClipboardCheck,
  ClipboardCopy,
  Coins,
  History,
  ListFilter,
  ListTodo,
  Lock,
  PackagePlus,
  Plus,
  Printer,
  Save,
  SearchX,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import Link from "next/link";
import { unstable_isUnrecognizedActionError, unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { MonthPicker } from "@/components/panel/month-picker";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Input, NumberInput, Select } from "@/components/ui/form";
import { useLeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, InfoTip, KeyValue, Stat } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { parseNumberTR } from "@/lib/calc/expr";
import type { CountUnit } from "@/lib/calc/types";
import { COUNT_UNITS } from "@/lib/constants";
import { nameKey } from "@/lib/count-item";
import { num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STALE_TEXT } from "@/components/ui/action-error";
import { saveStockCounts, saveStockExtras } from "@/server/actions/stock";

import { saveStaffStockExtras } from "./actions";
import { AddCountItemDialog } from "./add-item";
import { stockBreakdown } from "./breakdowns";
import {
  activeGroupIndex,
  countDraftJson,
  countStatus,
  countText,
  coverageSplit,
  draftConflicts,
  extraKey,
  extrasBase,
  groupProgress,
  listTopScroll,
  invoiceLayer,
  isFifoLine,
  layerText,
  lineAmount,
  lineLayers,
  liveTotals,
  mergeCounts,
  mergeExtras,
  nextEmptyIndex,
  parseCount,
  parseCountDraft,
  restoreDraftExtras,
  restoredPrefilled,
  unusualCount,
  type CountLineValue,
  type GroupProgress,
} from "./logic";

export interface FormLine extends CountLineValue {
  name: string;
  packageDesc: string | null;
  /** Kayıtlı sayımın birimi (sayılmamış satırda bugünkü sayım birimi) */
  countUnit: string;
  /** Bugünkü sayım birimi; null = Hammaddeler'de "Sayılmaz" */
  unitNow: string | null;
  /** Arşiv satırının nedeni: malzeme pasif ya da "Sayılmaz" yapıldı */
  archivedReason: "pasif" | "sayilmaz" | null;
  /** Kayıtlı sayım bugünkü sayım biriminden farklı bir birimle girildi */
  unitChanged: boolean;
  prevQty: number | null;
  /** Geçen ayki sayımın birimi */
  prevUnit: string | null;
}

export interface FormGroup {
  name: string;
  /** Excel Sayım'daki grubun tek KDV oranı (ambalaj %20, diğerleri %1) */
  excelRate: number;
  /** Alış KDV'si grup oranından farklı malzemeler (yalnızca yönetici) */
  mismatches: { name: string; vatRate: number }[];
  lines: FormLine[];
}

type ExtraProp = { name: string; unit: string; qty: number; unitPrice: number; priced: boolean };
type Filter = "all" | "empty";
/**
 * Sayım düzenindeki ay: sayılan / sayılacak kalem (countStatus, arşiv hariç), ayda herhangi bir kayıt var mı (ek kalem
 * dahil) ve kişi o ayı açabilir mi (personel: bu ay, ilk 10 günde geçen ay)
 */
type HistoryMonth = { month: string; short: string; label: string; counted: number; total: number; hasData: boolean; open: boolean };
/** Formdaki ek kalem: metin kutularının değeri; `priced` = kayıtlı fiyatı var (personel fiyatı görmez) */
type Extra = { name: string; unit: string; qty: string; unitPrice: string; priced: boolean };

/** Adresteki süzgeç anahtarları (?ara=sut&durum=empty&grup=…); "Temizle" hepsini birden sıfırlar */
const QUERY_KEYS = ["ara", "durum", "grup"];
const BLANK_EXTRA: Extra = { name: "", unit: "ADET", qty: "", unitPrice: "", priced: false };
/** Hiçbir alanı doldurulmamış ek satır: kayıtta zaten düşer, "kaydedilmedi" çubuğunu da açmaz */
const isBlankExtra = (e: Extra) => !e.name.trim() && !e.qty.trim() && !e.unitPrice.trim();
const badNumber = (v: string) => v.trim() !== "" && (parseNumberTR(v) === null || (parseNumberTR(v) ?? 0) < 0);
/** Kayıtlı hâliyle karşılaştırma imzası (fiyat bilgisi `priced` hariç) */
const extraSig = (list: Extra[]) => JSON.stringify(list.map((e) => [e.name, e.unit, e.qty, e.unitPrice]));
/** Taslağa yazılan biçim (fiyat yalnız yöneticide) */
const draftRow = (e: Extra, isAdmin: boolean) => ({ name: e.name, unit: e.unit, qty: e.qty, unitPrice: isAdmin ? e.unitPrice : "" });
/** İki ek satır aynı mı (ad + birim, miktar ve fiyat sayı olarak) */
const sameExtra = (a: Extra, b: Extra) =>
  extraKey(a.name, a.unit) === extraKey(b.name, b.unit) &&
  parseNumberTR(a.qty) === parseNumberTR(b.qty) &&
  (parseNumberTR(a.unitPrice) ?? 0) === (parseNumberTR(b.unitPrice) ?? 0);
const toExtra = (e: ExtraProp, isAdmin: boolean): Extra => ({
  name: e.name,
  unit: e.unit,
  qty: num(e.qty, 3),
  unitPrice: isAdmin ? num(e.unitPrice, 2) : "",
  priced: e.priced,
});
/** Ayın son günü (Excel Sayım B6 = SERİAY(ay; 0)) */
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

/** Enter ile sıradaki kutuya geçilir (telefonda klavyenin "İleri" tuşu). `attr` hangi kutu dizisinde gezileceğini seçer. */
function focusNext(e: KeyboardEvent<HTMLInputElement>, attr: string, onEnd?: () => void) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll<HTMLInputElement>(`input[${attr}]`)];
  const next = inputs[inputs.indexOf(e.currentTarget) + 1];
  if (!next) {
    if (onEnd) return onEnd();
    return e.currentTarget.blur();
  }
  next.focus({ preventScroll: true });
  next.select();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  next.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}
const focusNextCount = (e: KeyboardEvent<HTMLInputElement>) => focusNext(e, "data-count-input");

// ---------------------------------------------------------------- AkmanOS hareketli parçalar

/** AkmanOS todo-list sayacı: rakam değişince eskisi yukarı, yenisi aşağıdan kayar */
function CountRoll({ value }: { value: number }) {
  const reduce = useCalmMotion() ?? false;
  const text = num(value);
  return (
    <span className="relative inline-flex h-[1.15em] overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={reduce ? false : { y: "70%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={reduce ? undefined : { y: "-70%", opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.28, ease: EASE_OUT }}
          className="inline-block tabular"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** AkmanOS todo-list başlık ikonu: liste ikonu, tüm kalemler sayılınca yeşil onaya döner */
function ProgressIcon({ complete }: { complete: boolean }) {
  const reduce = useCalmMotion() ?? false;
  return (
    <span aria-hidden="true" className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface">
      <AnimatePresence initial={false} mode="popLayout">
        {complete ? (
          <motion.svg
            key="complete"
            viewBox="0 0 24 24"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="absolute size-5 overflow-visible text-good"
          >
            <circle cx="12" cy="12" r="9" fill="currentColor" />
            <motion.path
              d="M7.5 12.25 10.5 15.25 16.75 8.75"
              fill="none"
              stroke="white"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
            />
          </motion.svg>
        ) : (
          <motion.span
            key="todo"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="absolute grid place-items-center text-ink"
          >
            <ListTodo size={18} strokeWidth={1.75} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * Satırın durumu (AkmanOS todo-list ikonu): boş = kesik halka, sayıldı = yeşil onay, geçersiz = kırmızı çarpı.
 * Yüzlerce satırda hafif kalsın diye çizgi CSS geçişiyle çizilir; hareket azaltılınca geçiş kapanır.
 */
const noopSubscribe = () => () => {};

function readDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function LineStatus({ status }: { status: "empty" | "counted" | "invalid" }) {
  const stroke = "transition-[stroke-dashoffset,opacity] duration-200 ease-out motion-reduce:transition-none";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn(
        "mt-0.5 size-[18px] shrink-0 overflow-visible transition-colors",
        status === "counted" ? "text-good" : status === "invalid" ? "text-bad" : "text-ink-quiet",
      )}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={status === "empty" ? "2 3" : undefined}
        strokeLinecap="round"
        className="transition-[fill-opacity] duration-200 motion-reduce:transition-none"
        style={{ fillOpacity: status === "empty" ? 0 : 0.14 }}
      />
      <path
        d="M7.5 12.25 10.5 15.25 16.75 8.75"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="1"
        className={stroke}
        style={{ strokeDashoffset: status === "counted" ? 0 : 1, opacity: status === "counted" ? 1 : 0 }}
      />
      <path
        d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeDasharray="1"
        className={stroke}
        style={{ strokeDashoffset: status === "invalid" ? 0 : 1, opacity: status === "invalid" ? 1 : 0 }}
      />
    </svg>
  );
}

const monthCell: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.72 },
  visible: (i: number) => ({ opacity: 1, y: 0, scale: 1, transition: { ...SPRING_PRESS, delay: 0.08 + i * 0.06 } }),
};

/**
 * AkmanOS "Streak" düzeni: son 6 ayın sayım durumu. Tamamlanan ay (countStatus: listedeki her kalem sayıldı) siyah
 * onay; yarım ay sayılan payı kadar dolu halka ("30 / 72"), onay değil; açık ay halkalı. Kişinin açamadığı ay
 * (personel: bu ay ve ilk 10 günde geçen ay dışında) bağlantı değildir. Kaydedilmemiş değişiklik varken diğer aylara
 * geçiş kapalı (girilen miktarlar kaybolmasın).
 */
function CountHistory({ history, current, currentStatus, locked }: { history: HistoryMonth[]; current: string; currentStatus: Pick<HistoryMonth, "counted" | "total" | "hasData">; locked: boolean }) {
  const reduce = useCalmMotion() ?? false;
  const rows = history.map((h) => (h.month === current ? { ...h, ...currentStatus } : h));
  const done = rows.filter((h) => h.total > 0 && h.counted >= h.total).length;
  return (
    <div className="no-print border-t border-line px-5 pt-4 pb-5">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-mute">
        <span className="flex items-center gap-1.5">
          Sayım düzeni
          <InfoTip text="Son altı ayın sayımı: onay = listedeki her kalem sayıldı; yarım dolu halka = sayım yarım kaldı (sayılmayan kalemler ay sonu stoğunda 0 sayılır). Bir aya dokunarak o ayın sayımını açın." />
        </span>
        <span className="font-medium text-ink tabular">
          {num(done)} / {num(rows.length)} ay
        </span>
      </div>
      <ol className="mt-3 grid grid-cols-6 gap-1">
        {rows.map((h, i) => {
          const isCurrent = h.month === current;
          const complete = h.total > 0 && h.counted >= h.total;
          const partial = !complete && h.hasData;
          const share = h.total ? Math.min(1, h.counted / h.total) : 0;
          const state = complete ? "sayım tamam" : partial ? `sayım yarım (${num(h.counted)} / ${num(h.total)})` : "sayım yok";
          const text = `${h.label}: ${state}${isCurrent ? " (açık)" : !h.open ? " · yalnız yönetici açabilir" : locked ? " · önce sayımı kaydedin" : ""}`;
          const still = reduce || isCurrent || locked || !h.open;
          const cell = (
            <motion.span
              custom={i}
              variants={monthCell}
              initial={reduce ? false : "hidden"}
              animate="visible"
              whileHover={still ? undefined : { y: -3, scale: 1.06 }}
              whileTap={still ? undefined : { scale: 0.94 }}
              className="flex flex-col items-center gap-2"
              aria-hidden="true"
            >
              <span className={cn("text-[11px] font-medium", isCurrent ? "text-ink" : "text-ink-mute")}>{h.short}</span>
              <span
                className={cn(
                  "relative flex size-8 items-center justify-center rounded-full transition-colors",
                  complete ? "bg-ink text-white" : "bg-surface ring-1 ring-line-strong",
                  isCurrent && "ring-2 ring-ink ring-offset-2 ring-offset-panel",
                )}
              >
                {complete ? (
                  <motion.span
                    initial={reduce ? false : { scale: 0, rotate: -120 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={reduce ? { duration: 0 } : SPRING_SWAP}
                    className="grid place-items-center"
                  >
                    <Check className="size-4" strokeWidth={2.5} />
                  </motion.span>
                ) : partial ? (
                  // Yarım sayım: sayılan payı kadar dolu halka (onay değil)
                  <svg viewBox="0 0 32 32" className="absolute inset-0 size-8 -rotate-90" aria-hidden="true">
                    <circle cx="16" cy="16" r="13" fill="none" strokeWidth="3" className="stroke-ink" pathLength={1} strokeDasharray={`${share} 1`} strokeLinecap="round" />
                  </svg>
                ) : null}
              </span>
              {partial ? (
                <span className="-mt-1 text-[10px] leading-none text-ink-mute tabular">
                  {num(h.counted)}/{num(h.total)}
                </span>
              ) : null}
            </motion.span>
          );
          // Kilitliyken de aynı öğe (Link) kalır: öğe türü değişseydi hücreler yeniden kurulup giriş hareketi tekrar oynardı
          return (
            <li key={h.month} className="flex justify-center">
              {isCurrent || !h.open ? (
                <span title={text} className={cn("flex w-full justify-center py-1", !isCurrent && "opacity-50")}>
                  {cell}
                  <span className="sr-only">{text}</span>
                </span>
              ) : (
                <Link
                  href={`/panel/sayim?ay=${h.month}`}
                  title={text}
                  aria-label={text}
                  aria-disabled={locked || undefined}
                  tabIndex={locked ? -1 : undefined}
                  onClick={locked ? (e) => e.preventDefault() : undefined}
                  className={cn(
                    "flex w-full justify-center rounded-xl py-1 transition-colors",
                    locked ? "cursor-not-allowed opacity-60" : "hover:bg-surface/70",
                  )}
                >
                  {cell}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Hareket azaltılmışsa kaydırma anında */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Yapışık araç çubuğunun, yapıştığında sayfanın üstünden alt kenarı (px): grup başlığı bunun altına kaydırılır */
function stuckBottom(bar: HTMLElement | null): number {
  if (!bar) return 0;
  const top = Number.parseFloat(getComputedStyle(bar).top) || 0;
  return top + bar.offsetHeight;
}

/**
 * Süzgeç değişince listenin başına döner: araç çubuğu yapışmadan önceki yerini (önündeki kartın altı + boşluk)
 * geçtiyse sayfa, çubuk üst çubuğun altında ve hemen altında ilk süzülen satır olacak şekilde kaydırılır.
 */
function scrollToListTop(toolbar: HTMLElement | null) {
  const prev = toolbar?.previousElementSibling;
  if (!toolbar || !prev) return;
  const style = getComputedStyle(toolbar);
  // Aradaki boşluk space-y'nin önceki kartın alt kenar payı; dikey paylar birleştiği için büyüğü
  const gap = Math.max(Number.parseFloat(getComputedStyle(prev).marginBottom) || 0, Number.parseFloat(style.marginTop) || 0);
  const natural = prev.getBoundingClientRect().bottom + window.scrollY + gap;
  const y = listTopScroll(natural, Number.parseFloat(style.top) || 0, window.scrollY);
  if (y !== null) window.scrollTo({ top: y, behavior: "instant" });
}

/** Grup kartının başlığını yapışık çubuğun hemen altına getirir */
function scrollToGroupCard(name: string, toolbar: HTMLElement | null) {
  const card = document.querySelector<HTMLElement>(`[data-count-group="${CSS.escape(name)}"]`);
  if (!card) return;
  const y = card.getBoundingClientRect().top + window.scrollY - stuckBottom(toolbar) - 8;
  window.scrollTo({ top: Math.max(0, y), behavior: scrollBehavior() });
}

/**
 * Grup çipleri (telefonda sayımın haritası): her grup bir çip, adı ve sayılan / toplam; bitince onay. Dokununca o
 * grubun başına kayar (grup süzgeci açıksa o gruba geçer). Kaydırdıkça ekrandaki grubun çipi koyulaşır ve şeritte
 * görünür tutulur. Şerit kendi içinde yana kayar, sayfa yatay kaymaz.
 */
function GroupChips({
  items,
  active,
  onPick,
  rowRef,
  lead,
  className,
}: {
  items: GroupProgress[];
  active: string | null;
  onPick: (name: string) => void;
  rowRef: RefObject<HTMLDivElement | null>;
  /** Şeridin başındaki çip (telefonda "Kalan" süzgeci) */
  lead?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !active) return;
    const chip = row.querySelector<HTMLElement>(`[data-chip="${CSS.escape(active)}"]`);
    if (!chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < row.scrollLeft + 16 || right > row.scrollLeft + row.clientWidth - 16) row.scrollTo({ left: Math.max(0, left - 16), behavior: scrollBehavior() });
  }, [active, rowRef]);
  return (
    <nav aria-label="Gruplara git" className={cn("-mx-4 mt-2 sm:-mx-6 lg:-mx-10", className)}>
      <div
        ref={rowRef}
        className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] sm:px-6 lg:px-10 [&::-webkit-scrollbar]:hidden"
      >
        {lead}
        {lead && items.length ? <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-line-strong sm:hidden" /> : null}
        {items.map((g) => {
          const on = g.name === active;
          return (
            <button
              key={g.name}
              type="button"
              data-chip={g.name}
              aria-current={on ? "true" : undefined}
              onClick={() => onPick(g.name)}
              className={cn(
                "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap ring-1 transition-colors ring-inset pointer-coarse:h-11",
                on ? "bg-ink text-white ring-ink" : "bg-surface text-ink-soft ring-line-strong hover:text-ink hover:ring-ink/30",
              )}
            >
              {g.done ? <Check size={14} strokeWidth={2.5} className={on ? "text-lime" : "text-good"} aria-hidden="true" /> : null}
              <span>{g.name}</span>
              <span className={cn("tabular", on ? "text-white/70" : "text-ink-quiet")}>
                {num(g.counted)}/{num(g.total)}
              </span>
              <span className="sr-only">{g.done ? " tamam" : " sayıldı"}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Money({ value }: { value: number }) {
  return (
    <>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={(v) => tl(v)} />
      </span>
      <span className="sr-only">{tl(value)}</span>
    </>
  );
}

// ---------------------------------------------------------------- Başlıktaki ay seçici

/** Ay seçicinin geçiş isteği (detail: gidilecek adres); kaydedilmemiş sayımı olan form iptal edip önce sorar */
const MONTH_LEAVE = "sayim:ay";
/** Ay değişince adresten düşen parametreler: ?izinsiz= yalnız yönlendirilen ilk aya ait (kişi başka ay seçti) */
const MONTH_OMIT = ["izinsiz"];

/**
 * Başlıktaki ay seçici: istemci içi geçiş yapar (beforeunload çalışmaz) ve form ay değişince baştan kurulur. Geçişten
 * önce MONTH_LEAVE olayı yayılır; kaydedilmemiş sayım varken form iptal eder, düğmenin / seçicinin kendi geçişi durur.
 */
export function CountMonthPicker({ months, value }: { months: string[]; value: string }) {
  const list = months.includes(value) ? months : [...months, value].sort();
  const idx = list.indexOf(value);
  /** Form geçişi durdurduysa true (adres MonthPicker'ınki gibi: diğer parametreler korunur, ?izinsiz= notu düşer) */
  const stopped = (to: string | undefined) => {
    if (!to || to === value) return false;
    const sp = new URLSearchParams(window.location.search);
    sp.set("ay", to);
    for (const k of MONTH_OMIT) sp.delete(k);
    return !window.dispatchEvent(new CustomEvent(MONTH_LEAVE, { cancelable: true, detail: `${window.location.pathname}?${sp.toString()}` }));
  };
  return (
    <div
      className="contents"
      // Yakalama aşaması MonthPicker'ın onClick / onChange'inden önce çalışır; ilk düğme önceki, son düğme sonraki ay
      onClickCapture={(e) => {
        const btn = e.target instanceof Element ? e.target.closest("button") : null;
        if (!btn || btn.disabled) return;
        const buttons = e.currentTarget.querySelectorAll("button");
        const to = btn === buttons[0] ? list[idx - 1] : btn === buttons[buttons.length - 1] ? list[idx + 1] : undefined;
        if (stopped(to)) e.stopPropagation();
      }}
      onChangeCapture={(e) => {
        if (!(e.target instanceof HTMLSelectElement) || !stopped(e.target.value)) return;
        e.stopPropagation();
        e.target.value = value; // seçici açık ayda kalsın
      }}
    >
      <MonthPicker months={months} value={value} omit={MONTH_OMIT} />
    </div>
  );
}

// ---------------------------------------------------------------- Sayım formu

export function StockCountForm({
  month,
  monthLabel,
  prevMonthLabel,
  isAdmin,
  groups,
  extras: initialExtras,
  prevExtras,
  hasPrev,
  history,
  prevTotal,
  closingOverride,
  counter,
  me = null,
  denied = null,
  addItem = null,
  valuation = null,
}: {
  month: string;
  monthLabel: string;
  prevMonthLabel: string;
  isAdmin: boolean;
  groups: FormGroup[];
  extras: ExtraProp[];
  /** Geçen ayın "listede olmayanlar"ı: yeni ay boşken tek dokunuşla getirilir */
  prevExtras: ExtraProp[];
  hasPrev: boolean;
  /** Seçili ay dahil son 6 ayın sayım durumu */
  history: HistoryMonth[];
  /** Bu ayın açılış stoğu = geçen ayın devreden malı (yalnızca yönetici); Gelir-giderde elle girildiyse o */
  prevTotal: { value: number; overridden: boolean } | null;
  /** Gelir-giderde bu ayın stoğu elle girildiyse o tutar (kâr-zarar sayımı değil bunu kullanır) */
  closingOverride: number | null;
  /** "Sayan: … · son kayıt …" */
  counter: string | null;
  /** Formu açan kişinin adı: taslağa yazılır, ortak cihazda sonraki kişi kimin sayımı olduğunu görür */
  me?: string | null;
  /** Personelin açamadığı, istenip yerine bu ayın açıldığı ay ("Temmuz 2026"); yoksa null */
  denied?: string | null;
  /** "Listeye ekle" açık mı (kişi bu ayı değiştirebiliyorsa) ve grupları; null: düğme yok */
  addItem?: { groups: { name: string; unit: CountUnit }[] } | null;
  /** Stok değerleme (yalnız yönetici): ay FIFO ile mi değerleniyor, Ayarlar'daki başlangıç ayının adı ("Ekim 2026") */
  valuation?: { fifo: boolean; covered: number; total: number; start: string | null } | null;
}) {
  const reduce = useCalmMotion() ?? false;
  const all = groups.flatMap((g) => g.lines);
  /** Bugünkü sayım listesindeki kalemler (ilerleme bunlarla); arşiv satırları salt okunur */
  const countable = all.filter((l) => !l.archived);
  const archivedCount = all.length - countable.length;
  const savedExtras: Extra[] = initialExtras.map((e) => toExtra(e, isAdmin));
  const savedKeys = new Set(savedExtras.map((e) => extraKey(e.name, e.unit)));
  // Binlik ayırıcısız ("1500", "1,5"): KG/LT kutusunda nokta ondalık okunur, kayıtlı değer yanlış okunmasın
  const savedValues = () => Object.fromEntries(all.map((l) => [l.id, countText(l.qty)])) as Record<number, string>;
  const [values, setValues] = useState<Record<number, string>>(savedValues);
  /** Bu kişi yazarken başkasının da kaydettiği satırlar (kaydederse onunkinin yerine geçer) */
  const [conflicts, setConflicts] = useState<Set<number>>(() => new Set());
  /** "Geçen aydan doldur"la gelen, henüz dokunulmamış satırlar: sayılmış sayılmaz, kontrol edilmeli */
  const [prefilled, setPrefilled] = useState<Set<number>>(() => new Set());
  /** Kaydetmeden önce sorulacaklar (kontrol edilmemiş doldurma, geçen aya göre çok farklı miktar) */
  const [saveCheck, setSaveCheck] = useState<{ prefilled: number; unusual: string[] } | null>(null);
  // Sunucudan yeni sayım gelince (kendi kaydımız, başkasının kaydı, yenileme) dokunulmayan satırlar yeni değeri alır
  const [syncedGroups, setSyncedGroups] = useState(groups);
  if (syncedGroups !== groups) {
    const lineMap = (gs: FormGroup[]) => new Map(gs.flatMap((g) => g.lines.map((l) => [l.id, l.qty] as const)));
    const units = new Map(all.map((l) => [l.id, l.unitNow ?? l.countUnit]));
    const merged = mergeCounts(values, lineMap(syncedGroups), lineMap(groups), (id, raw) => parseCount(raw, units.get(id) ?? "", parseNumberTR));
    setSyncedGroups(groups);
    setValues(merged.values);
    setConflicts(new Set(merged.conflicts));
  }
  const [extras, setExtras] = useState(savedExtras);
  // Ek kalemler de satırlar gibi tazelenir: başkasının kaydettiği liste gelince dokunulmayan kalemler yeni değeri alır,
  // iki tarafın değiştirdiği kalem "çakışma" diye söylenir (kaydederse onunkinin yerine geçer)
  const [syncedExtras, setSyncedExtras] = useState(initialExtras);
  /** Ek kalemlerde iki tarafın da değiştirdiği kalemlerin adı (kartta söylenir) */
  const [extraConflicts, setExtraConflicts] = useState<string[]>([]);
  if (syncedExtras !== initialExtras) {
    const before = syncedExtras.map((e) => toExtra(e, isAdmin));
    const merged = mergeExtras(extras, before, savedExtras, sameExtra);
    setSyncedExtras(initialExtras);
    if (extraSig(before) !== extraSig(savedExtras)) {
      setExtras(merged.extras.map((e) => ({ ...e, priced: savedExtras.find((x) => extraKey(x.name, x.unit) === extraKey(e.name, e.unit))?.priced ?? e.priced })));
      setExtraConflicts(merged.conflicts);
    }
  }
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [filterParam, setFilterParam] = useQueryState<Filter>("durum", "all");
  const [groupParam, setGroup] = useQueryState<string>("grup", "");
  const [q, setQ] = useQueryText("ara");
  const filter: Filter = filterParam === "empty" ? "empty" : "all";
  const group = groups.some((g) => g.name === groupParam) ? groupParam : "";
  /** "Sayılmayanlar" seçildiği andaki boş kalemler: yazmaya başlayınca satır listeden kaybolmasın */
  const [emptyIds, setEmptyIds] = useState<Set<number>>(() => new Set(countable.filter((l) => l.qty === null).map((l) => l.id)));
  /** Yeni eklenen ek satırın ad kutusuna odaklanmak için */
  const focusExtra = useRef<number | null>(null);

  const qtyOf = (l: FormLine) => {
    if (l.archived) return l.qty;
    const v = values[l.id];
    return v === undefined || v.trim() === "" ? null : parseCount(v, l.unitNow ?? l.countUnit, parseNumberTR);
  };
  /** Geçen ayın miktarı aynı birimdeyse (karşılaştırma için) */
  const prevComparable = (l: FormLine) => (l.prevQty !== null && (l.prevUnit ?? l.countUnit) === (l.unitNow ?? l.countUnit) ? l.prevQty : null);
  const unusualOf = (l: FormLine) => (l.archived || qtyOf(l) === l.qty ? null : unusualCount(qtyOf(l), prevComparable(l)));
  const setLine = (id: number, value: string) => {
    setValues((x) => ({ ...x, [id]: value }));
    if (prefilled.has(id)) setPrefilled((x) => new Set([...x].filter((y) => y !== id)));
    if (conflicts.has(id)) setConflicts((x) => new Set([...x].filter((y) => y !== id)));
  };
  const isInvalid = (l: FormLine) => {
    if (l.archived || !values[l.id]?.trim()) return false;
    const v = qtyOf(l);
    return v === null || v < 0;
  };
  /** Kayıtlı miktar değişmedikçe sayıldığı birim, yeni ya da değişen miktar bugünkü sayım birimi (sunucu kuralı) */
  const unitOf = (l: FormLine) => (l.archived || (l.qty !== null && qtyOf(l) === l.qty) ? l.countUnit : (l.unitNow ?? l.countUnit));

  const changedLines = countable.filter((l) => qtyOf(l) !== l.qty);
  const invalidLines = countable.filter((l) => isInvalid(l));
  const filledExtras = extras.filter((e) => !isBlankExtra(e));
  const extrasDirty = extraSig(filledExtras) !== extraSig(savedExtras);
  /** Miktarı ya da fiyatı yazılmış ama adı boş ek satır: kayıtta sessizce düşmesin */
  const extraProblem = filledExtras.find((e) => !e.name.trim() || badNumber(e.qty) || badNumber(e.unitPrice));
  /** Kayıt başarılı, sunucudan yenilenmiş veri bekleniyor: bu arada kaydetme çubuğu tekrar görünmesin */
  const [syncingFor, setSyncingFor] = useState<FormGroup[] | null>(null);
  const syncing = syncingFor === groups;
  const dirty = !syncing && (changedLines.length > 0 || extrasDirty || invalidLines.length > 0);
  /** Kayıtlı miktarı silinen satırlar: kaydedince o ayın sayımından çıkar (çubukta ayrıca söylenir) */
  const clearedLines = changedLines.filter((l) => qtyOf(l) === null);
  const counted = countable.filter((l) => qtyOf(l) !== null && !prefilled.has(l.id)).length;
  const remaining = countable.length - counted;
  const share = countable.length ? counted / countable.length : 0;
  const complete = countable.length > 0 && remaining === 0;
  const extraTotal = (e: Extra) => (parseNumberTR(e.qty) ?? 0) * (parseNumberTR(e.unitPrice) ?? 0);
  const byId = new Map(all.map((l) => [l.id, l]));
  const live = liveTotals(
    groups,
    (l) => qtyOf(byId.get(l.id)!),
    extras.map((e) => ({ qty: parseNumberTR(e.qty), unitPrice: parseNumberTR(e.unitPrice) })),
  );
  const groupLive = new Map(live.groups.map((g) => [g.name, g]));
  // Stok değerinin faturalardan (FIFO katmanları) gelen kısmı, formdaki miktarlarla; kalan ay sonu fiyatıyla (başlangıçtan
  // önceki sayımdan taşınan açılış da)
  const fifoCovered = valuation?.fifo
    ? all.reduce((a, l) => {
        const v = l.archived ? l.qty : qtyOf(l);
        return a + lineLayers(l, v).reduce((b, x) => b + (invoiceLayer(x) ? x.qty * x.unitCost : 0), 0);
      }, 0)
    : 0;
  const coveredShare = live.total > 0 ? Math.min(1, fifoCovered / live.total) : 0;
  // Toplam stok kartının dökümü: formdaki miktarlarla, kartla aynı kural (yalnızca yönetici fiyat görür)
  const stockGroups = isAdmin
    ? stockBreakdown(
        groups,
        (l) => qtyOf(byId.get(l.id)!),
        extras.map((e) => ({ name: e.name, unit: e.unit, qty: parseNumberTR(e.qty), unitPrice: parseNumberTR(e.unitPrice) })),
      )
    : [];
  const unpricedExtras = isAdmin ? filledExtras.filter((e) => (parseNumberTR(e.qty) ?? 0) > 0 && !((parseNumberTR(e.unitPrice) ?? 0) > 0)) : [];
  const showExcelVat = isAdmin && Math.abs(live.totalVatExcel - live.totalVat) >= 1;
  /** Personel kayıtlı fiyatlı satırı silemez, adını / birimini değiştiremez (fiyat o ada bağlı) */
  const lockedExtra = (e: Extra) => !isAdmin && e.priced && savedKeys.has(extraKey(e.name, e.unit));
  /** Sayım listesindeki kalemlerin adları: aynı adlı ek kalem iki kez sayılır (uyarılır, geçen aydan taşınmaz) */
  const listNames = new Set(countable.map((l) => nameKey(l.name)));
  const listDuplicates = [...new Set(filledExtras.filter((e) => listNames.has(nameKey(e.name))).map((e) => e.name.trim()))];
  const canCarryExtras = prevExtras.some((e) => !listNames.has(nameKey(e.name))) && filledExtras.length === 0;

  // Kaydedilmemiş sayım bu cihazda taslak olarak durur: sekme kapanır, ağ gider ya da telefon arka plandaki sekmeyi
  // atarsa yazılanlar kaybolmaz; sayfa yeniden açılınca geri yüklenmesi önerilir. Taslak "Geçen aydan doldur"un
  // işaretini (geri yüklenince kayıt öncesi denetim yine sorar), değişen ek kalemleri ve yazanın adını da tutar. Kayıt,
  // "Vazgeç" ya da formun temizlenmesi (yazılanı silmek) bu açılışta yazılan taslağı siler. Taslak neye dayandığını da
  // yazar (satırların ve ek kalem listesinin o anki kayıtlı hâli): geri yükleme arada başkasının kaydettiğini silmez,
  // ezeceği satırı işaretler.
  const draftKey = `laf:sayim-taslak:${month}`;
  const draftJson = dirty
    ? countDraftJson({
        values: Object.fromEntries(changedLines.map((l) => [String(l.id), values[l.id] ?? ""])),
        prefilled: changedLines.filter((l) => prefilled.has(l.id)).map((l) => l.id),
        extras: extrasDirty ? filledExtras.map((e) => draftRow(e, isAdmin)) : null,
        by: me,
        base: Object.fromEntries(changedLines.map((l) => [String(l.id), l.qty])),
        extrasBase: extrasDirty ? savedExtras.map((e) => draftRow(e, isAdmin)) : null,
      })
    : "";
  const wroteDraft = useRef(false);
  useEffect(() => {
    try {
      if (draftJson) {
        window.localStorage.setItem(draftKey, draftJson);
        wroteDraft.current = true;
      } else if (wroteDraft.current) {
        window.localStorage.removeItem(draftKey);
        wroteDraft.current = false;
      }
    } catch {
      // Gizli pencere ya da dolu depolama: taslaksız devam
    }
  }, [draftJson, draftKey]);
  const [draftGone, setDraftGone] = useState(false);
  // Bant yalnız açılışta var olan taslak için: bu açılışta yazılan taslak, form temizlenince bant olarak geri gelmesin
  const openingDraft = useRef<{ key: string; json: string | null } | null>(null);
  const storedDraft = useSyncExternalStore(
    noopSubscribe,
    () => {
      if (openingDraft.current?.key !== draftKey) openingDraft.current = { key: draftKey, json: readDraft(draftKey) };
      return openingDraft.current.json;
    },
    () => null,
  );
  const draft = parseCountDraft(storedDraft && !dirty && !draftGone ? storedDraft : null);
  const draftEntries = Object.entries(draft.values).filter(([id, raw]) => {
    const l = byId.get(Number(id));
    return l && !l.archived && (values[l.id] ?? "") !== raw;
  });
  // Taslağın ek kalemleri kayıtlı listeyle birleşir (bant yalnız form temizken çıkar: form = kayıtlı liste)
  const draftExtras = restoreDraftExtras(
    draft,
    savedExtras.map((e) => draftRow(e, isAdmin)),
    isAdmin,
  );
  const draftSize = draftEntries.length + (draftExtras?.changed ?? 0);
  const forgetDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // yok sayılır
    }
    wroteDraft.current = false;
    setDraftGone(true);
  };
  function restoreDraft() {
    setValues((v) => ({ ...v, ...Object.fromEntries(draftEntries.map(([id, raw]) => [Number(id), raw])) }));
    // "Geçen aydan doldur"la gelen satırlar yine işaretli: kayıt öncesi denetim sorar
    const restored = draftEntries.flatMap(([id, raw]) => {
      const l = byId.get(Number(id));
      if (!l) return [];
      const unit = l.unitNow ?? l.countUnit;
      return [{ id: l.id, qty: parseCount(raw, unit, parseNumberTR), prevQty: l.prevQty, sameUnit: (l.prevUnit ?? l.countUnit) === unit }];
    });
    const filled = restoredPrefilled(draft, restored);
    if (filled.length) setPrefilled((x) => new Set([...x, ...filled]));
    // Taslak yazıldıktan sonra başkasının kaydettiği satırlar: geri yüklenir ama işaretlenir (kaydederse onunkini ezer)
    const stale = draftConflicts(
      draft,
      draftEntries.map(([id]) => Number(id)),
      (id) => byId.get(id)?.qty ?? null,
    );
    if (stale.length) setConflicts((x) => new Set([...x, ...stale]));
    if (draftExtras) {
      setExtras(draftExtras.extras.map((e) => ({ ...e, priced: savedExtras.find((x) => extraKey(x.name, x.unit) === extraKey(e.name, e.unit))?.priced ?? false })));
      setExtraConflicts(draftExtras.conflicts);
    }
    const busyOthers = stale.length + (draftExtras?.conflicts.length ?? 0);
    toast.success("Taslak geri yüklendi", {
      description: [
        filled.length ? `${num(filled.length)} satır geçen aydan doldurulmuştu.` : null,
        busyOthers ? `${num(busyOthers)} kalemi taslaktan sonra başkası da kaydetti; işaretli yerlere bakın.` : null,
        "Kontrol edip kaydedin.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  // Kaydedilmemiş sayımla sayfa kapatılır ya da yenilenirse tarayıcı sorsun; beforeunload istemci içi geçişi kapsamaz:
  // başlıktaki ay seçici ve panel içi bağlantılar (menü) önce sorar (ortak kanca, src/components/ui/leave-guard.ts)
  const router = useRouter();
  const [leaveHref, setLeaveHref] = useLeaveGuard(dirty, MONTH_LEAVE);

  // Yeni ek satır çizilince ad kutusuna odaklan
  useEffect(() => {
    if (focusExtra.current === null) return;
    document.querySelector<HTMLInputElement>(`input[data-extra-name="${focusExtra.current}"]`)?.focus();
    focusExtra.current = null;
  }, [extras.length]);

  // ---------------------------------------------------------------- Listeye ekle (yeni sayım kalemi)
  /** Açık "Sayım listesine ekle" penceresi; `name`: aramada bulunamayan ad */
  const [adding, setAdding] = useState<{ name: string } | null>(null);
  const canAddItem = addItem !== null && addItem.groups.length > 0;
  /** Eklenen kalem sunucudan gelince (refresh) kutusuna odaklanılır: hemen sayılsın */
  const pendingFocus = useRef<number | null>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });
  useEffect(() => {
    const id = pendingFocus.current;
    const el = id === null ? null : document.getElementById(`count-${id}`);
    if (!el) return;
    pendingFocus.current = null;
    el.scrollIntoView({ block: "center", behavior: scrollBehavior() });
    el.focus({ preventScroll: true });
  }, [groups, group, q]);

  function onItemAdded(item: { id: number; name: string; group: string; existed: boolean; priced: boolean; extraTwin?: { name: string; qty: number; unit: string } | null }) {
    setAdding(null);
    // Aynı adlı ek kalem bu ay "Listede olmayanlar"da: ikisi de sayılırsa stok iki kez sayılır
    if (item.extraTwin)
      toast.warning(`${item.extraTwin.name} Listede olmayanlar'da da var (${countText(item.extraTwin.qty)} ${item.extraTwin.unit})`, {
        duration: 20_000,
        description: "Aynı kalemse miktarı listedeki yeni satıra yazın ve ek kalemi kaldırıp kaydedin; yoksa stok iki kez sayılır.",
      });
    pendingFocus.current = item.id;
    // Yeni kalem süzgeçte gizli kalmasın: grup süzgeci başka gruptaysa onun grubuna geçilir, arama uymuyorsa silinir
    if (group && group !== item.group) setGroup(item.group);
    if (q.trim() && !matches(`${item.name} ${item.group}`, q)) setQ("");
    if (filter === "empty") setEmptyIds((x) => new Set([...x, item.id]));
    // Kalem zaten vardı (daha sonraki bir aydan itibaren listedeydi): fiyatı varsa da yoksa da Hammaddeler'deki gibi kalır
    if (item.existed) return void toast.success(`Listeye eklendi: ${item.name}`, { description: "Kalem zaten vardı; artık bu aydan itibaren de listede." });
    const href = `/panel/hammaddeler?ara=${encodeURIComponent(item.name)}`;
    toast.success(`Listeye eklendi: ${item.name}`, {
      // Paket fiyatı yazıldıysa Tahmini kaydedildi (yönetici doğrular); yazılmadıysa 0 ₺
      description: isAdmin
        ? item.priced
          ? "Paket fiyatı Tahmini olarak kaydedildi; Hammaddeler'den doğrulayın."
          : "Paket fiyatı 0 ₺; fiyatını girince stok toplamına yansır."
        : item.priced
          ? "Miktarını yazıp sayımı kaydedin. Yazdığınız fiyatı yönetici kontrol edecek."
          : "Miktarını yazıp sayımı kaydedin. Fiyatını yönetici girecek.",
      // Kaydedilmemiş sayım varken sayfadan çıkmadan önce sorulur (bağlantı tıklamasıyla aynı kural)
      action: isAdmin ? { label: "Fiyatını gir", onClick: () => (dirtyRef.current ? setLeaveHref(href) : router.push(href)) } : undefined,
    });
  }

  const changeFilter = (f: Filter) => {
    if (f === "empty") setEmptyIds(new Set(countable.filter((l) => qtyOf(l) === null).map((l) => l.id)));
    setFilterParam(f);
  };
  const filtered = filter !== "all" || group !== "" || q.trim() !== "";
  const clearFilters = () => {
    setQ("");
    clearQuery(QUERY_KEYS);
  };
  const visibleGroups = groups
    .filter((g) => !group || g.name === group)
    .map((g) => ({
      ...g,
      visible: g.lines.filter((l) => (filter === "all" || emptyIds.has(l.id)) && matches(`${l.name} ${l.packageDesc ?? ""} ${g.name}`, q)),
    }))
    .filter((g) => g.visible.length);
  const shownCount = visibleGroups.reduce((a, g) => a + g.visible.length, 0);
  /** Klavyede "Bitti" tuşu çıksın diye listedeki son yazılabilir kutu */
  const lastInputId = visibleGroups.flatMap((g) => g.visible.filter((l) => !l.archived)).at(-1)?.id ?? null;

  // ---------------------------------------------------------------- Telefonda sayım: grup çipleri, sıradaki boş kalem
  const toolbarRef = useRef<HTMLDivElement>(null);
  const chipRowRef = useRef<HTMLDivElement>(null);
  const progress = groupProgress(groups, (l) => qtyOf(l) !== null && !prefilled.has(l.id));
  const progressByName = new Map(progress.map((p) => [p.name, p]));
  const visibleNames = new Set(visibleGroups.map((g) => g.name));
  // Grup süzgeci açıkken bütün gruplar (dokununca o gruba geçilir), değilse ekrandaki gruplar (dokununca kaydırılır)
  const chipItems = group ? progress : progress.filter((p) => visibleNames.has(p.name));
  const visibleKey = visibleGroups.map((g) => g.name).join("|");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  /** Süzgeç başka gruba geçirilince yeni liste çizildikten sonra başına kaydırılacak grup */
  const pendingJump = useRef<string | null>(null);

  // Kaydırdıkça hangi grubun ekranda olduğu (çip vurgusu); ölçüm kare başına bir kez
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-count-group]")];
      const line = stuckBottom(toolbarRef.current) + 24;
      const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const i = activeGroupIndex(
        cards.map((c) => c.getBoundingClientRect().top),
        line,
        atEnd,
      );
      setActiveGroup(i < 0 ? null : (cards[i].dataset.countGroup ?? null));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [visibleKey]);

  // Süzgeç (grup, "Kalan", arama, Temizle) değişince liste kısalır, tarayıcı sayfanın sonuna sıkışır: listenin başına
  // dön (boyamadan önce, sayfanın sonu bir an bile görünmesin). Çipten başka gruba geçişte aşağıdaki etki o grubun
  // başına kaydırır.
  const filterKey = `${filter}|${group}|${q}`;
  const lastFilterKey = useRef(filterKey);
  useLayoutEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    if (pendingJump.current && pendingJump.current === group) return;
    scrollToListTop(toolbarRef.current);
  }, [filterKey, group]);

  useEffect(() => {
    if (!pendingJump.current || pendingJump.current !== group) return;
    pendingJump.current = null;
    scrollToGroupCard(group, toolbarRef.current);
  }, [group]);

  const pickGroup = (name: string) => {
    if (group && group !== name) {
      pendingJump.current = name;
      return setGroup(name);
    }
    scrollToGroupCard(name, toolbarRef.current);
  };

  /**
   * Sıradaki sayılmamış kalem: odaktaki kutudan sonra, odak yoksa ekranda görünen ilk satırdan başlayarak ilk boş
   * kutu; sona gelince baştan. Kutuya odaklanır (telefonda klavye açılır) ve ekranın ortasına getirir.
   */
  function goNextEmpty() {
    const inputs = [...document.querySelectorAll<HTMLInputElement>("input[data-count-input]")];
    if (!inputs.length) return;
    const focused = inputs.indexOf(document.activeElement as HTMLInputElement);
    const line = stuckBottom(toolbarRef.current);
    const start = focused >= 0 ? focused + 1 : Math.max(0, inputs.findIndex((el) => el.getBoundingClientRect().top >= line));
    const i = nextEmptyIndex(
      inputs.map((el) => el.value.trim() === "" || el.dataset.prefilled === "1"),
      start,
    );
    if (i < 0) return toast.message("Boş kalem kalmadı", { description: "Gösterilen bütün kalemlere miktar yazıldı." });
    const el = inputs[i];
    el.focus({ preventScroll: true });
    el.select();
    el.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  }

  /** Geçen ayın ek kalemleri (ad, birim, fiyat; miktar kontrol için geçen ayınki) */
  // Geçen ayın ek kalemi o arada sayım listesine eklendiyse (Listeye ekle) taşınmaz: stok iki kez sayılmasın
  const carriedExtras = () => prevExtras.filter((e) => !listNames.has(nameKey(e.name))).map((e) => toExtra(e, isAdmin));

  function carryExtras() {
    if (!canCarryExtras) return;
    setExtras(carriedExtras());
    toast.success(`${num(carriedExtras().length)} ek kalem ${prevMonthLabel} sayımından getirildi`, {
      description: "Miktarlar geçen ayınki; rafta kalanı yazıp kaydedin.",
    });
  }

  function fillFromPrev() {
    const empty = countable.filter((l) => !values[l.id]?.trim() && l.prevQty !== null);
    // Sayım birimi değişen kalem eski miktarla doldurulmaz (2 KG → 2 ADET olmasın)
    const fill = empty.filter((l) => (l.prevUnit ?? l.countUnit) === (l.unitNow ?? l.countUnit));
    const skipped = empty.length - fill.length;
    const extrasToo = canCarryExtras;
    if (!fill.length && !extrasToo)
      return toast.message("Doldurulacak boş satır yok", {
        description: skipped
          ? `${num(skipped)} kalemin sayım birimi değiştiği için geçen ayın miktarı kullanılamadı; elle yazın.`
          : "Geçen ay sayılan kalemlerin hepsine bu ay miktar yazılmış.",
      });
    if (fill.length) {
      setValues((v) => {
        const next = { ...v };
        for (const l of fill) next[l.id] = countText(l.prevQty ?? 0);
        return next;
      });
      setPrefilled((x) => new Set([...x, ...fill.map((l) => l.id)]));
    }
    if (extrasToo) setExtras(carriedExtras());
    const parts = [fill.length ? `${num(fill.length)} boş satır` : null, extrasToo ? `${num(carriedExtras().length)} ek kalem` : null].filter(Boolean).join(" ve ");
    toast.success(`${parts} geçen ayın sayımıyla dolduruldu`, {
      description: `Doldurulan satırlar sayılmış sayılmaz: rafa bakıp düzeltin ya da “Doğru”ya basın. “Sıradaki” onlarda da durur.${skipped ? ` Sayım birimi değişen ${num(skipped)} kalem atlandı.` : ""}`,
    });
  }

  const updateExtra = (i: number, patch: Partial<Extra>) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)));
  const addExtra = () => {
    focusExtra.current = extras.length;
    setExtras((x) => [...x, { ...BLANK_EXTRA }]);
  };
  const removeExtra = (i: number) => {
    const removed = extras[i];
    setExtras((x) => x.filter((_, j) => j !== i));
    if (!isBlankExtra(removed))
      toast.message(`"${removed.name.trim() || "Adsız kalem"}" kaldırıldı`, {
        description: "Sayımı kaydedince silinir.",
        action: { label: "Geri al", onClick: () => setExtras((x) => [...x.slice(0, i), removed, ...x.slice(i)]) },
      });
  };

  function discard() {
    forgetDraft();
    setValues(savedValues());
    setPrefilled(new Set());
    setConflicts(new Set());
    setExtras(savedExtras);
    setExtraConflicts([]);
    setDiscardOpen(false);
    toast.message("Değişiklikler geri alındı");
  }

  async function save(confirmed = false) {
    if (busy) return;
    const bad = invalidLines[0];
    if (bad) {
      document.getElementById(`count-${bad.id}`)?.focus();
      return toast.error(`${bad.name}: geçersiz miktar`, { description: "Yalnızca sayı yazın; ondalık için virgül kullanın (0,5)." });
    }
    if (extraProblem) return toast.error(!extraProblem.name.trim() ? "Ek kalemin adını yazın" : `${extraProblem.name}: geçersiz miktar ya da fiyat`);
    // Kontrol edilmemiş doldurma ya da geçen aya göre çok farklı miktar (yazım hatası olabilir): önce sor
    const unchecked = changedLines.filter((l) => prefilled.has(l.id)).length;
    const unusual = changedLines.filter((l) => unusualOf(l)).map((l) => `${l.name} ${countText(qtyOf(l))} ${l.unitNow ?? l.countUnit}`);
    if (!confirmed && (unchecked || unusual.length)) return setSaveCheck({ prefilled: unchecked, unusual });
    setSaveCheck(null);
    setBusy(true);
    /** Hangi adım kaydoldu: sayımlar kaydedilip ek kalemler düşerse "Kaydedilemedi" denmez */
    const step = { counts: false };
    try {
      await persist(step);
    } catch (e) {
      unstable_rethrow(e);
      const partial = step.counts ? "Kalemlerin sayımı kaydedildi; ek kalemler kaydedilemedi. " : "";
      if (unstable_isUnrecognizedActionError(e)) {
        // Panel yeniden yayınlandı, sayfa eski: yeniden denemek hep düşer, yenilemek gerekir (taslak bu cihazda durur)
        toast.error(STALE_TEXT, {
          description: `${partial}Yazdıklarınız bu cihazda duruyor; yenileyince “Geri yükle”ye basın.`,
          duration: 30_000,
          action: { label: "Yenile", onClick: () => window.location.reload() },
        });
      } else {
        // Ağ kesildi ya da sunucu o an yanıt vermedi: yazılanlar ekranda (ve taslakta) duruyor
        toast.error(step.counts ? "Sayım kaydedildi; ek kalemler kaydedilemedi" : "Kaydedilemedi: bağlantı yok gibi", {
          description: "Yazdıklarınız bu cihazda duruyor. Bağlantı gelince yeniden deneyin.",
          duration: 15_000,
          action: { label: "Tekrar dene", onClick: () => void saveRef.current(true) },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function persist(step: { counts: boolean }) {
    const lineCount = changedLines.length;
    if (lineCount) {
      const res = await saveStockCounts(
        month,
        changedLines.map((l) => ({ ingredientId: l.id, qty: qtyOf(l), base: l.qty })),
      );
      if (!res.ok) return void toast.error(res.error, { duration: 12_000 });
      step.counts = true;
    }
    // Formun gördüğü ek kalem listesi: arada başkası kaydettiyse sunucu yazmaz (sayımlardaki base gibi)
    const base = extrasBase(initialExtras);
    if (extrasDirty) {
      const clean = filledExtras.map((e) => ({ name: e.name.trim(), unit: e.unit.trim().toLocaleUpperCase("tr-TR") || "ADET", qty: parseNumberTR(e.qty) ?? 0 }));
      const partial = lineCount ? "Kalemlerin sayımı kaydedildi; ek kalemler kaydedilemedi." : undefined;
      if (isAdmin) {
        const prices = filledExtras.map((e) => parseNumberTR(e.unitPrice) ?? 0);
        const ex = await saveStockExtras(
          month,
          clean.map((e, i) => ({ ...e, unitPrice: prices[i] })),
          base,
        );
        if (!ex.ok) return void toast.error(ex.error, { description: partial });
        // Sunucunun yazdığı biçime getir (boş satır düşer, "2,0" → "2"): kayıttan sonra çubuk açık kalmasın
        setExtras(clean.map((e, i) => ({ name: e.name, unit: e.unit, qty: num(e.qty, 3), unitPrice: num(prices[i], 2), priced: prices[i] > 0 })));
      } else {
        const ex = await saveStaffStockExtras(month, clean, base);
        if (!ex.ok) return void toast.error(ex.error, { description: partial });
        setExtras(ex.data.map((e) => toExtra({ ...e, unitPrice: 0 }, false)));
      }
    }
    setPrefilled(new Set());
    setConflicts(new Set());
    setExtraConflicts([]);
    forgetDraft();
    setSyncingFor(groups);
    toast.success(`${monthLabel} sayımı kaydedildi`, {
      description: [
        `${num(counted)} / ${num(countable.length)} kalem sayıldı`,
        clearedLines.length ? `${num(clearedLines.length)} sayım silindi` : null,
        extrasDirty ? `${num(filledExtras.length)} ek kalem` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  // ⌘S / Ctrl+S ile kaydet (değişiklik varken)
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty]);

  // Kaydetme çubuğunun başlığı: neyin değiştiği ve varsa kaç geçersiz miktar kaldığı
  const changeLabel = [
    changedLines.length > clearedLines.length ? `${num(changedLines.length - clearedLines.length)} kalem değişti` : null,
    clearedLines.length ? `${num(clearedLines.length)} sayım silinecek` : null,
    extrasDirty ? (changedLines.length ? "ek kalemler" : "Ek kalemler değişti") : null,
    invalidLines.length ? `${num(invalidLines.length)} geçersiz miktar` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Ek kalem tablosu: yönetici fiyat ve tutarı da görür
  const extraGrid = isAdmin ? "sm:grid-cols-[minmax(0,1fr)_6rem_7rem_8rem_6.5rem_2.25rem]" : "sm:grid-cols-[minmax(0,1fr)_6rem_7rem_2.25rem]";
  const extraCell = isAdmin ? "col-span-4" : "col-span-6";

  return (
    // Altta yüzen sayım / kaydetme çubuğu var: son satırlar onun altında kalmasın (alt menünün payını kabuk verir)
    <div className="space-y-4 pb-32">
      {denied ? (
        <p role="status" className="no-print rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {denied} sayımını yalnız yönetici açabilir; {monthLabel} sayımı açıldı. Eski bir ayda düzeltme gerekiyorsa yöneticiye haber verin.
        </p>
      ) : null}
      {draftSize ? (
        <div role="status" className="no-print flex flex-wrap items-center gap-3 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info">
          <span className="min-w-0 flex-1">
            {draft.by && draft.by !== me ? `${draft.by} bu cihazda` : "Bu cihazda"} kaydedilmemiş {num(draftSize)} kalemlik {monthLabel} sayımı var (sayfa
            kapanmış ya da bağlantı gitmiş olabilir).
          </span>
          <Button size="sm" onClick={restoreDraft}>
            Geri yükle
          </Button>
          <Button size="sm" variant="ghost" onClick={forgetDraft}>
            Sil
          </Button>
        </div>
      ) : null}
      <div className={cn("grid gap-3", isAdmin && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        {/* İlerleme: AkmanOS todo-list başlığı + ince çubuk + sayım düzeni */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5">
            <div className="flex min-w-0 items-start gap-3">
              <ProgressIcon complete={complete} />
              <div className="min-w-0">
                <p className="text-sm leading-5 text-ink-mute">Sayılan kalem</p>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-2xl leading-8 font-semibold tracking-tight text-ink" aria-hidden="true">
                  <span className={cn("inline-flex", complete && "text-good")}>
                    <CountRoll value={counted} />
                  </span>
                  <span className="text-lg font-medium text-ink-mute tabular">/ {num(countable.length)}</span>
                  <span className="text-sm font-medium text-ink-mute">sayıldı</span>
                </p>
                <p className="sr-only" aria-live="polite">
                  {num(counted)} / {num(countable.length)} kalem sayıldı
                </p>
                {archivedCount ? (
                  // "Tümü" süzgeci arşiv satırlarını da sayar; fark burada açıklanır
                  <p className="mt-0.5 text-xs text-ink-mute">
                    + {num(archivedCount)} arşiv kalemi (pasif ya da Sayılmaz; bu ay sayılmış, salt okunur)
                  </p>
                ) : null}
              </div>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              {hasPrev ? (
                <Button
                  variant="secondary"
                  onClick={fillFromPrev}
                  title={`Bu ay boş bırakılan satırlara ${prevMonthLabel} miktarını yazar${prevExtras.length ? "; ek kalemler boşsa onları da getirir" : ""}. Kaydetmeden hiçbir şey değişmez.`}
                >
                  <ClipboardCopy size={16} /> Geçen aydan doldur
                </Button>
              ) : null}
              {canAddItem ? (
                <Button variant="secondary" onClick={() => setAdding({ name: "" })} title="Listede olmayan, her ay sayılacak bir kalem ekleyin">
                  <Plus size={16} /> Listeye ekle
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} /> Yazdır
              </Button>
            </div>
          </div>
          <div className="px-5 pt-4 pb-5">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-panel-deep"
              role="progressbar"
              aria-label="Sayım ilerlemesi"
              aria-valuemin={0}
              aria-valuemax={countable.length}
              aria-valuenow={counted}
            >
              <motion.div
                className={cn("h-full rounded-full", complete ? "bg-good" : "bg-ink")}
                initial={reduce ? false : { width: 0, opacity: 0.6 }}
                animate={{ width: `${share * 100}%`, opacity: 1 }}
                transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.1 }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-mute">
              <span className={cn(complete && "font-medium text-good")}>
                {remaining ? `${num(remaining)} kalem kaldı` : countable.length ? "Tüm kalemler sayıldı" : "Sayılacak kalem yok"}
              </span>
              {countable.length ? <span className="font-medium text-ink tabular">%{num(share * 100)}</span> : null}
            </div>
            {/* Excel Sayım başlığı: SAYIM YAPANIN AD SOYAD + TARİH (ay sonu). Ekranda son kayıt, çıktıda doldurulacak satır. */}
            {counter ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-mute">
                <UserRound size={13} className="shrink-0 text-ink-quiet" aria-hidden="true" />
                <span className="min-w-0">{counter}</span>
              </p>
            ) : null}
            <p className="mt-2 hidden text-xs text-ink print:block">
              Sayım tarihi: {monthEnd(month)} (ay sonu){counter ? "" : " · Sayım yapan: ________________________"}
            </p>
          </div>
          {/* Kayıtlı duruma göre: yazılıp henüz kaydedilmemiş sayım bu ayı "sayıldı" göstermez */}
          <CountHistory
            history={history}
            current={month}
            currentStatus={{ ...countStatus({ groups }), hasData: all.some((l) => l.qty !== null) || savedExtras.length > 0 }}
            locked={dirty}
          />
        </Card>

        {isAdmin ? (
          <StatBreakdown
            title={`${monthLabel} stoğu`}
            description={`${
              valuation?.fifo
                ? "Ay sonu stoğu (KDV hariç), ilk giren ilk çıkar (FIFO): sayılan miktar en son faturalardan geriye doğru, her parça kendi faturasının birim fiyatıyla değerlenir. Faturayla karşılanmayan miktar ayın sonunda geçerli fiyatla."
                : "Ay sonu stoğu (KDV hariç): sayılan miktar × ay sonu fiyatı."
            } Grup grup; formda yazılıp henüz kaydedilmemiş miktarlar da dahil.${
              closingOverride !== null ? ` Gelir-giderde bu ayın stoğu elle ${tl(closingOverride)} girildi; kâr-zarar o tutarı kullanır.` : ""
            }`}
            groups={stockGroups}
            total={live.total}
            totalLabel="Toplam stok (KDV hariç)"
            empty="Bu ay sayılan kalem yok."
            // Yazdırılan sayım kağıdında "Döküm ›" ipucu çıkmasın
            className="print:[&>span]:hidden"
          >
            <Stat
              icon={<Coins />}
              label="Toplam stok (KDV hariç)"
              value={<Money value={live.total} />}
              info={`${
                valuation?.fifo
                  ? "İlk giren ilk çıkar (FIFO): sayılan miktar en son faturalardan geriye doğru, her parça kendi faturasının birim fiyatıyla (KDV hariç); faturası bulunamayan kısım ay sonu fiyatıyla."
                  : "Sayılan miktar × ay sonu fiyatı (KDV hariç)."
              } Gelir-giderde bu ayın "sonraki aya devreden mal"ı olur; orada elle tutar girildiyse o geçer.`}
            >
              <div className="divide-y divide-line rounded-xl bg-surface px-3">
                {valuation ? (
                  <KeyValue
                    label={
                      <span>
                        Değerleme
                        <InfoTip
                          className="ml-1.5"
                          text={
                            valuation.fifo
                              ? "Ayarlar › Stok değerleme: ilk giren ilk çıkar (FIFO). Rafta kalan mal en son alınandır; her parça kendi faturasının fiyatıyla."
                              : valuation.start
                                ? `Bu ay FIFO başlangıcından (${valuation.start}) önce: ay sonu fiyatıyla. Ayarlar › Stok değerleme.`
                                : "Ayarlar › Stok değerleme kapalı: her ay ay sonu fiyatıyla."
                          }
                        />
                      </span>
                    }
                    value={valuation.fifo ? <Badge tone="green">FIFO</Badge> : <Badge tone="gray">Ay sonu fiyatı</Badge>}
                  />
                ) : null}
                {valuation?.fifo && live.total > 0 ? (
                  <p className="py-2 text-xs leading-5 text-ink-mute">
                    Stok değerinin {coverageSplit(coveredShare).covered} faturalardan (FIFO), {coverageSplit(coveredShare).rest}{" "}
                    {live.extrasTotal > 0 ? "ay sonu fiyatıyla ya da ek kalemde elle girilen fiyatla" : "ay sonu fiyatıyla"}.
                  </p>
                ) : null}
                <KeyValue
                  label={
                    <span>
                      KDV dahil
                      <InfoTip className="ml-1.5" text="Her malzemenin Hammaddeler'deki Alış KDV'siyle; ek kalemler %1. Kâr-zarar KDV hariç tutarı kullanır." />
                    </span>
                  }
                  value={tl(live.totalVat)}
                />
                {showExcelVat ? (
                  <KeyValue
                    label={
                      <span>
                        KDV dahil (Excel usulü)
                        <InfoTip
                          className="ml-1.5"
                          text="Excel Sayım grup başına tek KDV oranı kullanır: ambalaj %20, diğer gruplar %1. Fark, Alış KDV'si grup oranından ayrılan malzemelerden gelir (grup başlığındaki ipucu)."
                        />
                      </span>
                    }
                    value={tl(live.totalVatExcel)}
                  />
                ) : null}
                {extras.length ? <KeyValue label="Listede olmayanlar" value={tl(live.extrasTotal)} /> : null}
                {prevTotal !== null ? (
                  <KeyValue
                    label={
                      <span>
                        Açılış ({prevMonthLabel} devri)
                        {prevTotal.overridden ? <InfoTip className="ml-1.5" text={`${prevMonthLabel} stoğu Gelir-giderde elle girildi; açılış o tutardır.`} /> : null}
                      </span>
                    }
                    value={tl(prevTotal.value)}
                  />
                ) : null}
              </div>
              {closingOverride !== null ? (
                <div className="mt-2 rounded-xl bg-warn-soft px-3 py-2.5 text-xs leading-5 text-warn">
                  <p className="flex items-start gap-1.5 font-medium">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      Gelir-giderde {monthLabel} stoğu elle {tl(closingOverride)} girildi; kâr-zarar bu sayımı ({tl(live.total)}) değil o tutarı kullanır.
                    </span>
                  </p>
                  <Link
                    href={`/panel/gelir-gider?yil=${month.slice(0, 4)}&ay=${month}`}
                    className="no-print -my-1 mt-1 ml-5 inline-block py-1 font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
                  >
                    Gelir-giderde aç
                  </Link>
                </div>
              ) : null}
            </Stat>
          </StatBreakdown>
        ) : null}
      </div>

      {/* Uzun listede arama, süzgeç ve grup çipleri her genişlikte üstte kalır (telefonda başlığın altına yapışır) */}
      {all.length ? (
        <div
          ref={toolbarRef}
          className="no-print sticky top-(--mobile-top-h) z-20 -mx-4 border-b border-line bg-background/90 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
        >
          {/* Telefonda süzgeç açıkken "12 / 72 kalem" kendi satırına iner: arama kutusu daralıp yazısı kesilmesin */}
          <FilterBar
            active={filtered}
            onClear={clearFilters}
            shown={filtered ? shownCount : undefined}
            total={filtered ? all.length : undefined}
            unit="kalem"
            className="max-sm:[&>p]:w-full"
          >
            <SearchField className="flex-1 basis-28 sm:basis-56" value={q} onChange={setQ} placeholder="Kalem ara" label="Sayım kalemlerinde ara" />
            {/* Telefonda bu seçim aşağıdaki şeridin başında "Kalan" çipi olur: arama kutusuna yer kalsın */}
            <Segmented<Filter>
              label="Gösterilen kalemler"
              className="shrink-0 max-sm:hidden"
              value={filter}
              onChange={changeFilter}
              options={[
                { value: "all", label: "Tümü", count: all.length },
                {
                  value: "empty",
                  label: (
                    <>
                      <span className="sm:hidden">Kalan</span>
                      <span className="hidden sm:inline">Sayılmayanlar</span>
                    </>
                  ),
                  count: remaining,
                },
              ]}
            />
            {groups.length > 1 ? (
              <>
                {/* Telefonda grup süzgeci tek ikon: yerel seçim listesi ikonun üstünde, görünmez; süzgeç açıkken koyu */}
                <div
                  className={cn(
                    "relative flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset sm:hidden",
                    group ? "bg-ink text-white ring-ink" : "bg-surface text-ink-mute ring-line-strong",
                  )}
                >
                  <ListFilter size={18} aria-hidden="true" />
                  <select
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    aria-label={group ? `Grup süzgeci: ${group}` : "Grup süzgeci"}
                    className="absolute inset-0 cursor-pointer appearance-none rounded-xl text-base opacity-0"
                  >
                    <option value="">Tüm gruplar</option>
                    {groups.map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="relative shrink-0 max-sm:hidden">
                  <ListFilter size={15} className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-ink-quiet" aria-hidden="true" />
                  <Select
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    aria-label="Grup"
                    className={cn("pl-8 sm:w-48", group && "font-medium ring-ink/40")}
                  >
                    <option value="">Tüm gruplar</option>
                    {groups.map((g) => (
                      <option key={g.name} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            ) : null}
          </FilterBar>
          <GroupChips
            items={chipItems.length > 1 ? chipItems : []}
            active={activeGroup}
            onPick={pickGroup}
            rowRef={chipRowRef}
            className={chipItems.length > 1 ? undefined : "sm:hidden"}
            lead={
              <FilterChip
                active={filter === "empty"}
                onToggle={() => changeFilter(filter === "empty" ? "all" : "empty")}
                count={remaining}
                className="sm:hidden"
              >
                Kalan
              </FilterChip>
            }
          />
        </div>
      ) : null}

      {visibleGroups.map((g) => {
        // Kart başlığı grup çipleriyle ve üst sayaçla aynı sayıyı gösterir (progress: "Geçen aydan doldur"la gelen,
        // dokunulmamış satır sayılmış sayılmaz)
        const gp = progressByName.get(g.name);
        const groupCounted = gp?.counted ?? 0;
        const groupTotal = gp?.total ?? 0;
        const groupDone = gp?.done ?? false;
        const gt = groupLive.get(g.name);
        return (
          <Card key={g.name} className="break-inside-avoid" data-count-group={g.name}>
            <CardHeader
              title={g.name}
              meta={
                <>
                  <span className="tabular">
                    {num(groupCounted)} / {num(groupTotal)} sayıldı
                  </span>
                  {groupDone ? (
                    <Badge tone="green" dot className="ml-1">
                      Tamam
                    </Badge>
                  ) : null}
                </>
              }
              actions={
                isAdmin && gt ? (
                  <div className="text-right">
                    <span className="block text-sm font-semibold whitespace-nowrap text-ink tabular">{tl(gt.total)}</span>
                    <span className="flex items-center justify-end gap-1 text-xs whitespace-nowrap text-ink-mute tabular">
                      KDV dahil {tl(gt.totalVat)}
                      {g.mismatches.length ? (
                        <InfoTip
                          text={`Excel Sayım bu grupta tek KDV oranı kullanır (${pct(g.excelRate, 0)}); panel her malzemenin Hammaddeler'deki Alış KDV'sini kullanır. Farklı olan: ${g.mismatches
                            .map((m) => `${m.name} ${pct(m.vatRate, 0)}`)
                            .join(", ")}. Faturasını kontrol edin, gerekirse Hammaddeler'de düzeltin. Excel usulü KDV dahil: ${tl(gt.totalVatExcel)}.`}
                        />
                      ) : null}
                    </span>
                  </div>
                ) : null
              }
              className="pb-2"
            />
            <ul className="divide-y divide-line px-2 pb-2">
              {g.visible.map((l) => {
                const v = qtyOf(l);
                const unit = unitOf(l);
                // Tutar sunucunun kuralıyla (FIFO satırında katmanlardan); birim fiyat tutar ÷ miktar
                const lineTotal = lineAmount(l, v);
                const price = v ? lineTotal / v : l.archived || (l.qty !== null && v === l.qty) ? l.unitPrice : l.unitPriceNow;
                const fifoTip = isAdmin && isFifoLine(l) && v ? layerText(lineLayers(l, v), (l.archived || (l.qty !== null && v === l.qty) ? l.factor : l.factorNow) ?? 1, unit) : null;
                // Yalnız yönetici: fiyatı girilmemiş kalem (sayımda "Listeye ekle" ile eklenen) 0 ₺ değil "fiyat yok" yazar
                const unitText =
                  price > 0 ? (
                    <>
                      {`${tl(price, 2)}/${unit}`}
                      {fifoTip ? <InfoTip className="ml-1" text={fifoTip} /> : null}
                    </>
                  ) : (
                    <span className="font-medium text-warn" title="Paket fiyatı girilmedi: Hammaddeler'den girin; o zamana kadar stok toplamına 0 ₺ girer">
                      fiyat yok
                    </span>
                  );
                const money = isAdmin ? (
                  <div className="hidden w-48 shrink-0 justify-end gap-4 text-right text-xs text-ink-mute tabular sm:flex">
                    <span className="whitespace-nowrap">{unitText}</span>
                    <span className="w-20 font-semibold whitespace-nowrap text-ink">{v ? tl(lineTotal) : "–"}</span>
                  </div>
                ) : null;
                const moneyMobile = isAdmin ? (
                  <p className="mt-0.5 text-xs text-ink-mute tabular sm:hidden">
                    {unitText} · <span className="font-semibold text-ink">{v ? tl(lineTotal) : "–"}</span>
                  </p>
                ) : null;
                if (l.archived) {
                  const why = l.archivedReason === "pasif" ? "pasif" : "“Sayılmaz”";
                  return (
                    <li key={l.id} className="flex items-center gap-2.5 px-2 py-2.5 sm:gap-3 sm:px-3">
                      <Lock size={16} className="mt-0.5 shrink-0 text-ink-quiet" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm leading-5 font-medium text-ink-soft">
                          <span className="min-w-0 break-words">{l.name}</span>
                          <Badge tone="gray">{l.archivedReason === "pasif" ? "Pasif" : "Sayılmaz"}</Badge>
                          <InfoTip
                            text={`Hammaddeler'de ${why} yapıldı. ${monthLabel} için kayıtlı ${num(l.qty, 3)} ${l.countUnit} sayımı korunur ve stok toplamına girer; burada değiştirilemez. Düzeltmek için malzemeyi Hammaddeler'de yeniden sayılır yapın.`}
                          />
                        </p>
                        {l.packageDesc ? (
                          <p className="mt-0.5 truncate text-xs text-ink-mute" title={l.packageDesc}>
                            {l.packageDesc}
                          </p>
                        ) : null}
                        {moneyMobile}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="w-[5.5rem] pr-3 text-right text-sm font-medium text-ink-soft tabular sm:w-24">
                          {num(l.qty, 3)}
                          <span className="sr-only"> {l.countUnit} (salt okunur)</span>
                        </span>
                        <span className="w-11 text-xs font-medium text-ink-mute" aria-hidden="true">
                          {l.countUnit}
                        </span>
                      </div>
                      {money}
                    </li>
                  );
                }
                const invalid = isInvalid(l);
                const changed = v !== l.qty;
                const inputId = `count-${l.id}`;
                const nowUnit = l.unitNow ?? l.countUnit;
                const raw = values[l.id] ?? "";
                const isPrefilled = prefilled.has(l.id);
                const unusual = invalid ? null : unusualOf(l);
                const prev = prevComparable(l);
                // "1.500" gibi noktalı yazımın nasıl okunduğu
                const echo = !invalid && v !== null && raw.includes(".") ? `= ${countText(v)} ${nowUnit}` : null;
                return (
                  <li
                    key={l.id}
                    // Telefonda satırın herhangi bir yerine dokunmak kutuya odaklanır (ad etiketinin yanı sıra)
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest("input, button, a, label")) document.getElementById(inputId)?.focus();
                    }}
                    className="flex items-center gap-2.5 px-2 py-2.5 max-sm:min-h-16 sm:gap-3 sm:px-3"
                  >
                    <LineStatus status={invalid ? "invalid" : v !== null && !isPrefilled ? "counted" : "empty"} />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm leading-5 font-medium text-ink">
                        <span className="min-w-0 break-words">{l.name}</span>
                        {changed && !invalid ? (
                          <span className="size-1.5 shrink-0 rounded-full bg-info" title="Kaydedilmedi">
                            <span className="sr-only">(kaydedilmedi)</span>
                          </span>
                        ) : null}
                      </label>
                      {l.packageDesc ? (
                        <p className="mt-0.5 truncate text-xs text-ink-mute" title={l.packageDesc}>
                          {l.packageDesc}
                        </p>
                      ) : null}
                      {l.prevQty !== null ? (
                        <p className="mt-0.5 text-xs text-ink-mute tabular">
                          Geçen ay {num(l.prevQty, 3)} {l.prevUnit ?? l.countUnit}
                        </p>
                      ) : null}
                      {l.unitChanged ? (
                        <p className="mt-0.5 text-xs font-medium text-warn">
                          {changed
                            ? `Yeni miktar ${nowUnit} ile kaydedilir.`
                            : `Bu ay ${l.countUnit} ile sayıldı; sayım birimi artık ${nowUnit}. Değiştirirseniz ${nowUnit} ile kaydedilir.`}
                        </p>
                      ) : null}
                      {invalid ? <p className="mt-0.5 text-xs font-medium text-bad">Geçersiz miktar: yalnızca sayı (ör. 2,5)</p> : null}
                      {echo ? <p className="mt-0.5 text-xs font-medium text-ink-soft tabular">{echo}</p> : null}
                      {unusual && prev !== null ? (
                        <p className="mt-0.5 text-xs font-medium text-warn">
                          Geçen ay {num(prev, 3)} {nowUnit}: {unusual === "high" ? "beş katından fazla" : "beşte birinden az"}, doğru mu?
                        </p>
                      ) : null}
                      {conflicts.has(l.id) ? (
                        <p className="mt-0.5 text-xs font-medium text-warn">
                          Başkası bu arada {l.qty === null ? "sayımı sildi" : `${countText(l.qty)} ${l.countUnit} kaydetti`}; sizinki kaydedilirse onun yerine geçer.
                        </p>
                      ) : null}
                      {isPrefilled ? (
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-medium text-warn">
                          Geçen aydan dolduruldu: rafa bakıp düzeltin
                          <button
                            type="button"
                            className="cursor-pointer rounded-md px-1.5 py-0.5 text-ink-soft underline underline-offset-2 hover:text-ink pointer-coarse:py-2"
                            onClick={() => setPrefilled((x) => new Set([...x].filter((y) => y !== l.id)))}
                          >
                            Doğru
                          </button>
                        </p>
                      ) : null}
                      {moneyMobile}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* Telefonda büyük kutu, birim kutunun içinde sağda (ad için yer kalsın); genişte birim yanında */}
                      <div className="relative">
                        <NumberInput
                          id={inputId}
                          data-count-input=""
                          enterKeyHint={l.id === lastInputId ? "done" : "next"}
                          data-prefilled={isPrefilled ? "1" : undefined}
                          value={raw}
                          onChange={(e) => setLine(l.id, e.target.value)}
                          onKeyDown={focusNextCount}
                          onFocus={(e) => e.currentTarget.select()}
                          placeholder="—"
                          aria-label={`${l.name} miktarı (${unit})`}
                          aria-invalid={invalid || undefined}
                          className="cell-input h-12 w-[7.75rem] pr-14 text-lg font-semibold pointer-coarse:h-12 sm:h-10 sm:w-24 sm:pr-3 sm:text-sm sm:font-normal sm:pointer-coarse:h-11"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-ink-mute sm:hidden" aria-hidden="true">
                          {unit}
                        </span>
                      </div>
                      <span className="w-11 text-xs font-medium text-ink-mute max-sm:hidden">{unit}</span>
                    </div>
                    {money}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}

      {!visibleGroups.length ? (
        <Card>
          {!all.length ? (
            <EmptyState
              icon={<ClipboardCheck />}
              title="Sayılacak kalem yok"
              description={
                isAdmin ? (
                  <>
                    Hammaddelerde sayım birimi girilmiş aktif kalem yok.{" "}
                    <Link href="/panel/hammaddeler" className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
                      Hammaddelere git
                    </Link>
                  </>
                ) : (
                  "Hammaddelerde sayım birimi girilmiş aktif kalem yok. Yöneticiye haber verin."
                )
              }
            />
          ) : filter === "empty" && !q.trim() && !group ? (
            <EmptyState
              icon={<ClipboardCheck />}
              title="Sayılmayan kalem kalmadı"
              description="Bütün kalemlere miktar yazıldı. Kontrol edip sayımı kaydedin."
              action={
                <Button variant="secondary" onClick={() => changeFilter("all")}>
                  Tümünü göster
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<SearchX />}
              title="Bu süzgece uyan kalem yok"
              description={
                q.trim()
                  ? `"${q.trim()}" için sonuç bulunamadı. Yazımı kontrol edin${canAddItem ? "; listede yoksa ekleyin" : " ya da süzgeci temizleyin"}.`
                  : "Seçili grupta ya da süzgeçte gösterilecek kalem yok."
              }
              action={
                <>
                  {/* Aranıp bulunamayan kalem tek dokunuşla eklenir (ad hazır gelir) */}
                  {canAddItem && q.trim() ? (
                    <Button onClick={() => setAdding({ name: q.trim() })}>
                      <Plus size={16} /> Listeye ekle
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={clearFilters}>
                    Süzgeci temizle
                  </Button>
                </>
              }
            />
          )}
        </Card>
      ) : null}

      <Card className="break-inside-avoid">
        <CardHeader
          icon={<PackagePlus />}
          title="Listede olmayanlar"
          description={
            isAdmin
              ? "Hammaddelerde olmayan ama stokta duran kalemler (elle fiyatlı). Tutar = miktar × birim fiyat."
              : "Hammaddelerde olmayan ama rafta duran kalemler. Adını ve miktarını yazın; fiyatını yönetici girer."
          }
          meta={
            filledExtras.length ? (
              <>
                <span className="tabular">
                  {num(filledExtras.length)} kalem{isAdmin ? ` · ${tl(live.extrasTotal)}` : ""}
                </span>
                {unpricedExtras.length ? (
                  <Badge tone="amber" dot className="ml-1">
                    {num(unpricedExtras.length)} kalemin fiyatı yok
                  </Badge>
                ) : null}
              </>
            ) : undefined
          }
          actions={
            extras.length ? (
              <>
                {canCarryExtras ? (
                  <Button variant="ghost" className="no-print" onClick={carryExtras}>
                    <History size={16} /> Geçen ayınkileri getir
                  </Button>
                ) : null}
                <Button variant="secondary" className="no-print" onClick={addExtra}>
                  <Plus size={16} /> Kalem ekle
                </Button>
              </>
            ) : undefined
          }
        />
        <CardContent>
          {extraConflicts.length ? (
            <p role="status" className="no-print mb-3 rounded-xl bg-warn-soft px-3 py-2.5 text-xs leading-5 text-warn">
              Bu liste siz yazarken başkası tarafından da kaydedildi: {extraConflicts.join(", ")} için sizin yazdığınız duruyor; kaydederseniz
              onunkinin yerine geçer.
            </p>
          ) : null}
          {listDuplicates.length ? (
            <p role="status" className="no-print mb-3 rounded-xl bg-warn-soft px-3 py-2.5 text-xs leading-5 text-warn">
              {listDuplicates.join(", ")} sayım listesinde de var: aynı kalemse miktarı listedeki satıra yazın ve buradan kaldırın, yoksa stok iki
              kez sayılır.
            </p>
          ) : null}
          {extras.length ? (
            <>
              {/* Sütun başlıkları (geniş ekranda); telefonda her kutunun kendi yer tutucusu var */}
              <div aria-hidden="true" className={cn("mb-1.5 hidden gap-2 px-1 text-xs font-medium text-ink-mute sm:grid", extraGrid)}>
                <span>Kalem adı</span>
                <span>Birim</span>
                <span className="text-right">Miktar</span>
                {isAdmin ? (
                  <>
                    <span className="text-right">Birim fiyat (₺)</span>
                    <span className="text-right">Tutar</span>
                  </>
                ) : null}
                <span />
              </div>
              <datalist id="extra-units">
                {[...COUNT_UNITS, "PAKET", "KUTU", "ŞİŞE"].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              <ul className="space-y-3 sm:space-y-2">
                {extras.map((e, i) => {
                  const nameMissing = !e.name.trim() && !isBlankExtra(e);
                  const locked = lockedExtra(e);
                  const last = i === extras.length - 1;
                  const onEnter = (ev: KeyboardEvent<HTMLInputElement>) => focusNext(ev, "data-extra-input", last ? addExtra : undefined);
                  const unpriced = isAdmin && (parseNumberTR(e.qty) ?? 0) > 0 && !((parseNumberTR(e.unitPrice) ?? 0) > 0);
                  return (
                    <li key={i} className={cn("grid grid-cols-12 items-center gap-2 rounded-2xl max-sm:bg-surface/60 max-sm:p-2", extraGrid)}>
                      {locked ? (
                        <p className="col-span-10 flex min-h-10 items-center gap-1.5 px-1 text-sm font-medium text-ink sm:col-span-1">
                          <span className="min-w-0 break-words">{e.name}</span>
                          <InfoTip text="Fiyatı yönetici tarafından girilmiş kalem: adını ve birimini yalnızca yönetici değiştirir. Rafta kalmadıysa miktarını 0 yazın." />
                        </p>
                      ) : (
                        <Input
                          value={e.name}
                          data-extra-input=""
                          data-extra-name={i}
                          enterKeyHint="next"
                          onKeyDown={onEnter}
                          onChange={(ev) => updateExtra(i, { name: ev.target.value })}
                          placeholder="Kalem adı (ör. Peçete)"
                          aria-label="Kalem adı"
                          aria-invalid={nameMissing || undefined}
                          maxLength={120}
                          className="col-span-10 sm:col-span-1"
                        />
                      )}
                      {locked ? (
                        <span className="order-1 col-span-2 sm:order-last sm:col-span-1" aria-hidden="true" />
                      ) : (
                        <IconButton
                          label={`${e.name.trim() || "Bu satırı"} kaldır`}
                          tone="danger"
                          className="no-print order-1 col-span-2 justify-self-end sm:order-last sm:col-span-1"
                          onClick={() => removeExtra(i)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                      {locked ? (
                        <span className={cn("order-2 flex min-h-10 items-center px-1 text-sm text-ink-mute sm:order-none sm:col-span-1", extraCell)}>{e.unit}</span>
                      ) : (
                        <Input
                          value={e.unit}
                          list="extra-units"
                          data-extra-input=""
                          enterKeyHint="next"
                          onKeyDown={onEnter}
                          onChange={(ev) => updateExtra(i, { unit: ev.target.value.toLocaleUpperCase("tr-TR") })}
                          placeholder="Birim"
                          aria-label="Birim"
                          maxLength={20}
                          // Telefonda listenin oku "ADET"i kesmesin; öneriler odaklanınca yine açılır
                          className={cn(
                            "order-2 max-sm:px-2.5 max-sm:[&::-webkit-calendar-picker-indicator]:hidden sm:order-none sm:col-span-1",
                            extraCell,
                          )}
                        />
                      )}
                      <NumberInput
                        value={e.qty}
                        data-extra-input=""
                        data-extra-name={locked ? i : undefined}
                        enterKeyHint={!isAdmin && last ? "done" : "next"}
                        onKeyDown={onEnter}
                        onFocus={(ev) => ev.currentTarget.select()}
                        onChange={(ev) => updateExtra(i, { qty: ev.target.value })}
                        placeholder="Miktar"
                        aria-label={`${e.name.trim() || "Ek kalem"} miktarı (${e.unit || "ADET"})`}
                        aria-invalid={badNumber(e.qty) || undefined}
                        className={cn("cell-input order-2 sm:order-none sm:col-span-1", extraCell)}
                      />
                      {isAdmin ? (
                        <>
                          <NumberInput
                            value={e.unitPrice}
                            data-extra-input=""
                            enterKeyHint={last ? "done" : "next"}
                            onKeyDown={onEnter}
                            onChange={(ev) => updateExtra(i, { unitPrice: ev.target.value })}
                            placeholder="Fiyat ₺"
                            aria-label={`${e.name.trim() || "Ek kalem"} birim fiyatı (₺, KDV hariç)`}
                            aria-invalid={badNumber(e.unitPrice) || undefined}
                            className="cell-input order-2 col-span-4 sm:order-none sm:col-span-1"
                          />
                          <p className="order-3 col-span-12 text-right text-xs text-ink-mute tabular sm:order-none sm:col-span-1 sm:text-sm sm:font-semibold sm:text-ink">
                            <span className="sm:hidden">Tutar </span>
                            {unpriced ? (
                              <span className="font-medium text-warn" title="Birim fiyatı girilmedi: stok toplamına 0 ₺ girer">
                                fiyat yok
                              </span>
                            ) : (
                              <span className="font-semibold text-ink">{tl(extraTotal(e))}</span>
                            )}
                          </p>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className="no-print mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 text-xs text-ink-mute">
                  Son kutuda Enter yeni satır açar. Boş bırakılan satırlar kaydedilmez.
                  {isAdmin ? "" : " Rafta kalmayan kalemin miktarını 0 yazın."}
                </p>
                <Button variant="ghost" size="sm" onClick={addExtra} className="-mr-2">
                  <Plus size={15} aria-hidden="true" /> Satır ekle
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<PackagePlus />}
              title="Ek kalem yok"
              description={
                prevExtras.length
                  ? `${prevMonthLabel} sayımında ${num(prevExtras.length)} ek kalem vardı (${prevExtras
                      .slice(0, 3)
                      .map((e) => e.name)
                      .join(", ")}${prevExtras.length > 3 ? "…" : ""}). Getirip bu ayın miktarını yazın.`
                  : "Hammaddelerde kaydı olmayan ama rafta duran bir şey varsa (ör. peçete, deterjan) buraya ekleyin; stok toplamına girer."
              }
              action={
                <>
                  {prevExtras.length ? (
                    <Button onClick={carryExtras}>
                      <History size={16} /> Geçen ayınkileri getir
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={addExtra}>
                    <Plus size={16} /> Kalem ekle
                  </Button>
                </>
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Kaydetme kapsülü: değişiklik varken alttan yaylı hareketle gelir */}
      {/* Masaüstü: kaydetme kapsülü değişiklik varken alttan gelir. Telefonda yerine aşağıdaki sayım çubuğu. */}
      <FloatingBar open={dirty} className="max-lg:hidden">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-sm font-semibold text-ink">{changeLabel}</p>
          {/* Telefonda kısa: ay adı zaten sayfa başlığında */}
          <p className="truncate text-xs text-ink-mute">
            <span className="max-sm:hidden">{monthLabel} sayımı kaydedilmedi</span>
            <span className="sm:hidden">Kaydedilmedi</span>
            {isAdmin ? <span className="tabular"> · toplam {tl(live.total)}</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" onClick={() => setDiscardOpen(true)} disabled={busy} aria-label="Değişikliklerden vazgeç" className="max-sm:size-10 max-sm:px-0">
            <Undo2 size={16} aria-hidden="true" />
            <span className="max-sm:sr-only">Vazgeç</span>
          </Button>
          <Button onClick={() => void save()} disabled={busy} size="lg" title="Kaydet (⌘S / Ctrl+S)" className="max-sm:px-4">
            <Save size={18} aria-hidden="true" />
            {busy ? (
              "Kaydediliyor…"
            ) : (
              <>
                <span className="sm:hidden">Kaydet</span>
                <span className="hidden sm:inline">Sayımı kaydet</span>
              </>
            )}
          </Button>
        </div>
      </FloatingBar>

      {/*
        Telefon ve tablet: alt menünün (--mobile-nav-h, güvenli alan dahil) üstünde hep duran ilerleme + kaydet
        çubuğu. Ekran klavyesi açıkken gizlenir: yazarken listeye yer kalsın; "Bitti" ile klavye kapanınca döner.
      */}
      {countable.length || dirty ? (
        <div className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-nav-h,0px)+0.5rem)] z-30 flex justify-center pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] in-data-[keyboard=open]:hidden lg:hidden">
          <div
            role="region"
            aria-label="Sayım ilerlemesi ve kaydetme"
            className="pointer-events-auto flex w-full max-w-2xl items-center gap-2 rounded-2xl bg-surface py-2 pr-2 pl-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.14)] ring-1 ring-line-strong"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-1 text-sm font-semibold text-ink tabular">
                <span className={cn(complete && "text-good")}>{num(counted)}</span>
                <span className="font-medium text-ink-mute">/ {num(countable.length)}</span>
                <span className="truncate text-xs font-medium text-ink-mute">{complete ? "tamam" : "sayıldı"}</span>
              </p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-deep" aria-hidden="true">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none", complete ? "bg-good" : "bg-ink")}
                  style={{ width: `${share * 100}%` }}
                />
              </div>
              <p className={cn("mt-1 truncate text-xs", invalidLines.length ? "font-medium text-bad" : dirty ? "font-medium text-info" : "text-ink-mute")}>
                {dirty ? changeLabel || "Kaydedilmedi" : counted ? "Kayıtlı" : "Miktarları yazıp kaydedin"}
              </p>
            </div>
            {remaining > 0 ? (
              // İkon tek başına "indir" gibi okunuyordu: altında kısa yazı (erişilebilir ad görünen yazıyla başlar)
              <button
                type="button"
                onClick={goNextEmpty}
                aria-label="Sıradaki sayılmamış kaleme git"
                title="Sıradaki sayılmamış kaleme git"
                className="flex h-11 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl bg-surface px-2 text-ink-soft ring-1 ring-line ring-inset transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
              >
                <ArrowDown size={16} aria-hidden="true" />
                <span className="text-[11px] leading-none font-medium">Sıradaki</span>
              </button>
            ) : null}
            {dirty ? (
              <IconButton label="Değişikliklerden vazgeç" onClick={() => setDiscardOpen(true)} disabled={busy} className="size-11">
                <Undo2 size={18} />
              </IconButton>
            ) : null}
            <Button onClick={() => void save()} disabled={busy || !dirty} className="h-11 px-4">
              <Save size={17} aria-hidden="true" />
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={saveCheck !== null}
        onClose={() => setSaveCheck(null)}
        onConfirm={() => void save(true)}
        tone="primary"
        title="Kaydetmeden önce kontrol edin"
        description={[
          saveCheck?.prefilled ? `${num(saveCheck.prefilled)} kalem geçen ayın miktarıyla dolu ve kontrol edilmedi.` : null,
          saveCheck?.unusual.length
            ? `Geçen aya göre çok farklı: ${saveCheck.unusual.slice(0, 3).join(", ")}${saveCheck.unusual.length > 3 ? ` ve ${num(saveCheck.unusual.length - 3)} kalem daha` : ""} (yazım hatası olabilir).`
            : null,
          "Yine de kaydedilsin mi?",
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel="Yine de kaydet"
      />
      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={discard}
        title="Kaydedilmemiş değişiklikler silinsin mi?"
        description={`${monthLabel} sayımında yazdığınız ama kaydetmediğiniz miktarlar son kayda döner. Kaydedilmiş sayım değişmez.`}
        confirmLabel="Değişiklikleri sil"
      />
      {adding && addItem ? (
        <AddCountItemDialog
          isAdmin={isAdmin}
          month={month}
          groups={addItem.groups}
          defaultGroup={group || activeGroup}
          initialName={adding.name}
          listNames={countable.map((l) => l.name)}
          onClose={() => setAdding(null)}
          onAdded={onItemAdded}
        />
      ) : null}
      <ConfirmDialog
        open={leaveHref !== null}
        onClose={() => setLeaveHref(null)}
        onConfirm={() => {
          const href = leaveHref;
          setLeaveHref(null);
          if (href) router.push(href);
        }}
        title="Kaydedilmemiş sayım var"
        confirmLabel="Kaydetmeden geç"
        description={`${monthLabel} sayımında yazdığınız miktarlar henüz kaydedilmedi; başka aya ya da sayfaya geçerseniz kaybolur. Kalmak için Vazgeç'e basıp Kaydet'i kullanın.`}
      />
    </div>
  );
}
