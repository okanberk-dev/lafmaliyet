"use client";

import { Check, ClipboardCheck, ClipboardCopy, Coins, ListFilter, ListTodo, PackagePlus, Plus, Printer, Save, SearchX, Trash2, Undo2 } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearQuery, FilterBar, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Input, NumberInput, Select } from "@/components/ui/form";
import { EmptyState, InfoTip, KeyValue, Stat } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { parseNumberTR } from "@/lib/calc/expr";
import { COUNT_UNITS } from "@/lib/constants";
import { num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveStockCounts, saveStockExtras } from "@/server/actions/stock";

interface Line {
  id: number;
  name: string;
  packageDesc: string | null;
  countUnit: string;
  qty: number | null;
  prevQty: number | null;
  unitPrice: number;
  vatRate: number;
}

type Filter = "all" | "empty";
type HistoryMonth = { month: string; short: string; label: string; counted: boolean };
type Extra = { name: string; unit: string; qty: string; unitPrice: string };

/** Adresteki süzgeç anahtarları (?ara=sut&durum=empty&grup=…); "Temizle" hepsini birden sıfırlar */
const QUERY_KEYS = ["ara", "durum", "grup"];
const BLANK_EXTRA: Extra = { name: "", unit: "ADET", qty: "", unitPrice: "" };
/** Hiçbir alanı doldurulmamış ek satır: kayıtta zaten düşer, "kaydedilmedi" çubuğunu da açmaz */
const isBlankExtra = (e: Extra) => !e.name.trim() && !e.qty.trim() && !e.unitPrice.trim();
const badNumber = (v: string) => v.trim() !== "" && (parseNumberTR(v) === null || (parseNumberTR(v) ?? 0) < 0);

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
 * AkmanOS "Streak" düzeni: son 6 ayın sayım durumu. Sayım girilen ay siyah onay, açık ay halkalı.
 * Kaydedilmemiş değişiklik varken diğer aylara geçiş kapalı (girilen miktarlar kaybolmasın).
 */
function CountHistory({ history, current, currentCounted, locked }: { history: HistoryMonth[]; current: string; currentCounted: boolean; locked: boolean }) {
  const reduce = useCalmMotion() ?? false;
  const done = history.filter((h) => (h.month === current ? currentCounted : h.counted)).length;
  return (
    <div className="no-print border-t border-line px-5 pt-4 pb-5">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-mute">
        <span className="flex items-center gap-1.5">
          Sayım düzeni
          <InfoTip text="Son altı ayın hangilerinde ay sonu sayımı girildi. Bir aya dokunarak o ayın sayımını açın." />
        </span>
        <span className="font-medium text-ink tabular">
          {num(done)} / {num(history.length)} ay
        </span>
      </div>
      <ol className="mt-3 grid grid-cols-6 gap-1">
        {history.map((h, i) => {
          const isCurrent = h.month === current;
          const counted = isCurrent ? currentCounted : h.counted;
          const text = `${h.label}: ${counted ? "sayım var" : "sayım yok"}${isCurrent ? " (açık)" : locked ? " · önce sayımı kaydedin" : ""}`;
          const cell = (
            <motion.span
              custom={i}
              variants={monthCell}
              initial={reduce ? false : "hidden"}
              animate="visible"
              whileHover={reduce || isCurrent || locked ? undefined : { y: -3, scale: 1.06 }}
              whileTap={reduce || isCurrent || locked ? undefined : { scale: 0.94 }}
              className="flex flex-col items-center gap-2"
              aria-hidden="true"
            >
              <span className={cn("text-[11px] font-medium", isCurrent ? "text-ink" : "text-ink-mute")}>{h.short}</span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors",
                  counted ? "bg-ink text-white" : "bg-surface ring-1 ring-line-strong",
                  isCurrent && "ring-2 ring-ink ring-offset-2 ring-offset-panel",
                )}
              >
                {counted ? (
                  <motion.span
                    initial={reduce ? false : { scale: 0, rotate: -120 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={reduce ? { duration: 0 } : SPRING_SWAP}
                    className="grid place-items-center"
                  >
                    <Check className="size-4" strokeWidth={2.5} />
                  </motion.span>
                ) : null}
              </span>
            </motion.span>
          );
          // Kilitliyken de aynı öğe (Link) kalır: öğe türü değişseydi hücreler yeniden kurulup giriş hareketi tekrar oynardı
          return (
            <li key={h.month} className="flex justify-center">
              {isCurrent ? (
                <span title={text} className="flex w-full justify-center py-1">
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

// ---------------------------------------------------------------- Sayım formu

export function StockCountForm({
  month,
  monthLabel,
  isAdmin,
  groups,
  extras: initialExtras,
  hasPrev,
  history,
  prevTotal,
}: {
  month: string;
  monthLabel: string;
  isAdmin: boolean;
  groups: { name: string; lines: Line[] }[];
  extras: { name: string; unit: string; qty: number; unitPrice: number }[];
  hasPrev: boolean;
  /** Seçili ay dahil son 6 ayın sayım durumu */
  history: HistoryMonth[];
  /** Geçen ayın stok toplamı (yalnızca yönetici, sayım varsa) */
  prevTotal: number | null;
}) {
  const reduce = useCalmMotion() ?? false;
  const all = groups.flatMap((g) => g.lines);
  const savedExtras: Extra[] = initialExtras.map((e) => ({ name: e.name, unit: e.unit, qty: num(e.qty, 3), unitPrice: num(e.unitPrice, 2) }));
  const savedValues = () => Object.fromEntries(all.map((l) => [l.id, l.qty === null ? "" : num(l.qty, 3)])) as Record<number, string>;
  const [values, setValues] = useState<Record<number, string>>(savedValues);
  const [extras, setExtras] = useState(savedExtras);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [filterParam, setFilterParam] = useQueryState<Filter>("durum", "all");
  const [groupParam, setGroup] = useQueryState<string>("grup", "");
  const [q, setQ] = useQueryText("ara");
  const filter: Filter = filterParam === "empty" ? "empty" : "all";
  const group = groups.some((g) => g.name === groupParam) ? groupParam : "";
  /** "Sayılmayanlar" seçildiği andaki boş kalemler: yazmaya başlayınca satır listeden kaybolmasın */
  const [emptyIds, setEmptyIds] = useState<Set<number>>(() => new Set(all.filter((l) => l.qty === null).map((l) => l.id)));
  /** Yeni eklenen ek satırın ad kutusuna odaklanmak için */
  const focusExtra = useRef<number | null>(null);

  const qtyOf = (id: number) => {
    const v = values[id];
    return v === undefined || v.trim() === "" ? null : parseNumberTR(v);
  };
  const isInvalid = (id: number) => {
    if (!values[id]?.trim()) return false;
    const v = qtyOf(id);
    return v === null || v < 0;
  };

  const changedLines = all.filter((l) => qtyOf(l.id) !== l.qty);
  const invalidLines = all.filter((l) => isInvalid(l.id));
  const filledExtras = extras.filter((e) => !isBlankExtra(e));
  const extrasDirty = JSON.stringify(filledExtras) !== JSON.stringify(savedExtras);
  /** Miktarı ya da fiyatı yazılmış ama adı boş ek satır: kayıtta sessizce düşmesin */
  const extraProblem = filledExtras.find((e) => !e.name.trim() || badNumber(e.qty) || badNumber(e.unitPrice));
  const dirty = changedLines.length > 0 || extrasDirty || invalidLines.length > 0;
  const counted = all.filter((l) => qtyOf(l.id) !== null).length;
  const remaining = all.length - counted;
  const share = all.length ? counted / all.length : 0;
  const complete = all.length > 0 && remaining === 0;
  const groupTotal = (g: { lines: Line[] }) => g.lines.reduce((a, l) => a + (qtyOf(l.id) ?? 0) * l.unitPrice, 0);
  const extraTotal = (e: Extra) => (parseNumberTR(e.qty) ?? 0) * (parseNumberTR(e.unitPrice) ?? 0);
  const extrasTotal = extras.reduce((a, e) => a + extraTotal(e), 0);
  const total = groups.reduce((a, g) => a + groupTotal(g), 0) + extrasTotal;
  const totalVat = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + (qtyOf(l.id) ?? 0) * l.unitPrice * (1 + l.vatRate), 0), 0) + extrasTotal * 1.01;

  // Kaydedilmemiş sayımla sayfa kapatılır ya da yenilenirse tarayıcı sorsun
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Yeni ek satır çizilince ad kutusuna odaklan
  useEffect(() => {
    if (focusExtra.current === null) return;
    document.querySelector<HTMLInputElement>(`input[data-extra-name="${focusExtra.current}"]`)?.focus();
    focusExtra.current = null;
  }, [extras.length]);

  const changeFilter = (f: Filter) => {
    if (f === "empty") setEmptyIds(new Set(all.filter((l) => qtyOf(l.id) === null).map((l) => l.id)));
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

  function fillFromPrev() {
    const fill = all.filter((l) => !values[l.id]?.trim() && l.prevQty !== null);
    if (!fill.length) return toast.message("Doldurulacak boş satır yok", { description: "Geçen ay sayılan kalemlerin hepsine bu ay miktar yazılmış." });
    setValues((v) => {
      const next = { ...v };
      for (const l of fill) next[l.id] = num(l.prevQty ?? 0, 3);
      return next;
    });
    toast.success(`${num(fill.length)} boş satır geçen ayın sayımıyla dolduruldu`, { description: "Kontrol edip değişenleri düzeltin, sonra kaydedin." });
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
    setValues(savedValues());
    setExtras(savedExtras);
    setDiscardOpen(false);
    toast.message("Değişiklikler geri alındı");
  }

  async function save() {
    if (busy) return;
    const bad = invalidLines[0];
    if (bad) {
      document.getElementById(`count-${bad.id}`)?.focus();
      return toast.error(`${bad.name}: geçersiz miktar`, { description: "Yalnızca sayı yazın; ondalık için virgül kullanın (0,5)." });
    }
    if (extraProblem) return toast.error(!extraProblem.name.trim() ? "Ek kalemin adını yazın" : `${extraProblem.name}: geçersiz miktar ya da fiyat`);
    setBusy(true);
    const res = await saveStockCounts(
      month,
      changedLines.map((l) => ({ ingredientId: l.id, qty: qtyOf(l.id) })),
    );
    if (res.ok && isAdmin) {
      const ex = await saveStockExtras(
        month,
        filledExtras.map((e) => ({ name: e.name, unit: e.unit || "ADET", qty: parseNumberTR(e.qty) ?? 0, unitPrice: parseNumberTR(e.unitPrice) ?? 0 })),
      );
      if (!ex.ok) toast.error(ex.error);
      // Sunucunun yazdığı biçime getir (boş satır düşer, "2,0" → "2"): kayıttan sonra çubuk açık kalmasın
      else
        setExtras(
          filledExtras.map((e) => ({ name: e.name.trim(), unit: e.unit.trim() || "ADET", qty: num(parseNumberTR(e.qty) ?? 0, 3), unitPrice: num(parseNumberTR(e.unitPrice) ?? 0, 2) })),
        );
    }
    setBusy(false);
    if (res.ok) toast.success(`${monthLabel} sayımı kaydedildi`, { description: `${num(counted)} / ${num(all.length)} kalem sayıldı` });
    else toast.error(res.error);
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
    changedLines.length ? `${num(changedLines.length)} kalem değişti` : null,
    extrasDirty ? (changedLines.length ? "ek kalemler" : "Ek kalemler değişti") : null,
    invalidLines.length ? `${num(invalidLines.length)} geçersiz miktar` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4 pb-32">
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
                  <span className="text-lg font-medium text-ink-mute tabular">/ {num(all.length)}</span>
                  <span className="text-sm font-medium text-ink-mute">sayıldı</span>
                </p>
                <p className="sr-only" aria-live="polite">
                  {num(counted)} / {num(all.length)} kalem sayıldı
                </p>
              </div>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              {hasPrev ? (
                <Button variant="secondary" onClick={fillFromPrev} className="pointer-coarse:h-10" title="Bu ay boş bırakılan satırlara geçen ayın miktarını yazar">
                  <ClipboardCopy size={16} /> Geçen aydan doldur
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => window.print()} className="pointer-coarse:h-10">
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
              aria-valuemax={all.length}
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
                {remaining ? `${num(remaining)} kalem kaldı` : all.length ? "Tüm kalemler sayıldı" : "Sayılacak kalem yok"}
              </span>
              {all.length ? <span className="font-medium text-ink tabular">%{num(share * 100)}</span> : null}
            </div>
          </div>
          <CountHistory history={history} current={month} currentCounted={counted > 0 || extras.some((e) => e.name.trim() !== "")} locked={dirty} />
        </Card>

        {isAdmin ? (
          <Stat
            icon={<Coins />}
            label="Toplam stok (KDV hariç)"
            value={<Money value={total} />}
            info={'Sayılan miktar × birim fiyat. Gelir-giderde "sonraki aya devreden mal" olur.'}
          >
            <div className="divide-y divide-line rounded-xl bg-surface px-3">
              <KeyValue label="KDV dahil" value={tl(totalVat)} />
              {extras.length ? <KeyValue label="Listede olmayanlar" value={tl(extrasTotal)} /> : null}
              {prevTotal !== null ? <KeyValue label="Geçen ay" value={tl(prevTotal)} /> : null}
            </div>
          </Stat>
        ) : null}
      </div>

      {/* Uzun listede arama ve süzgeç her genişlikte üstte kalır (telefonda başlığın altına yapışır) */}
      {all.length ? (
        <FilterBar
          active={filtered}
          onClear={clearFilters}
          shown={filtered ? shownCount : undefined}
          total={filtered ? all.length : undefined}
          unit="kalem"
          className="no-print sticky top-14 z-20 -mx-4 border-b border-line bg-background/90 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10"
        >
          <SearchField className="max-sm:basis-full sm:flex-1 sm:basis-56" value={q} onChange={setQ} placeholder="Kalem ara" label="Sayım kalemlerinde ara" />
          <Segmented<Filter>
            label="Gösterilen kalemler"
            className="shrink-0"
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
            <div className="relative max-sm:min-w-36 max-sm:flex-1 sm:shrink-0">
              <ListFilter size={15} className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-ink-quiet" aria-hidden="true" />
              <Select
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                aria-label="Grup"
                className={cn("pl-8 sm:w-48 pointer-coarse:h-10", group && "font-medium ring-ink/40")}
              >
                <option value="">Tüm gruplar</option>
                {groups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </FilterBar>
      ) : null}

      {visibleGroups.map((g) => {
        const groupCounted = g.lines.filter((l) => qtyOf(l.id) !== null).length;
        const groupDone = groupCounted === g.lines.length;
        return (
          <Card key={g.name} className="break-inside-avoid">
            <CardHeader
              title={g.name}
              meta={
                <>
                  <span className="tabular">
                    {num(groupCounted)} / {num(g.lines.length)} sayıldı
                  </span>
                  {groupDone ? (
                    <Badge tone="green" dot className="ml-1">
                      Tamam
                    </Badge>
                  ) : null}
                </>
              }
              actions={isAdmin ? <span className="text-sm font-semibold whitespace-nowrap text-ink tabular">{tl(groupTotal(g))}</span> : null}
              className="pb-2"
            />
            <ul className="divide-y divide-line px-2 pb-2">
              {g.visible.map((l) => {
                const v = qtyOf(l.id);
                const invalid = isInvalid(l.id);
                const changed = v !== l.qty;
                const inputId = `count-${l.id}`;
                return (
                  <li key={l.id} className="flex items-center gap-2.5 px-2 py-2.5 sm:gap-3 sm:px-3">
                    <LineStatus status={invalid ? "invalid" : v !== null ? "counted" : "empty"} />
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
                          Geçen ay {num(l.prevQty, 3)} {l.countUnit}
                        </p>
                      ) : null}
                      {invalid ? <p className="mt-0.5 text-xs font-medium text-bad">Geçersiz miktar: yalnızca sayı (ör. 2,5)</p> : null}
                      {isAdmin ? (
                        <p className="mt-0.5 text-xs text-ink-mute tabular sm:hidden">
                          {tl(l.unitPrice, 2)}/{l.countUnit} · <span className="font-semibold text-ink">{v ? tl(v * l.unitPrice) : "–"}</span>
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <NumberInput
                        id={inputId}
                        data-count-input=""
                        enterKeyHint="next"
                        value={values[l.id] ?? ""}
                        onChange={(e) => setValues((x) => ({ ...x, [l.id]: e.target.value }))}
                        onKeyDown={focusNextCount}
                        onFocus={(e) => e.currentTarget.select()}
                        placeholder="—"
                        aria-label={`${l.name} miktarı (${l.countUnit})`}
                        aria-invalid={invalid || undefined}
                        className="cell-input h-11 w-[5.5rem] sm:h-10 sm:w-24"
                      />
                      <span className="w-11 text-xs font-medium text-ink-mute">{l.countUnit}</span>
                    </div>
                    {isAdmin ? (
                      <div className="hidden w-48 shrink-0 justify-end gap-4 text-right text-xs text-ink-mute tabular sm:flex">
                        <span className="whitespace-nowrap">
                          {tl(l.unitPrice, 2)}/{l.countUnit}
                        </span>
                        <span className="w-20 font-semibold whitespace-nowrap text-ink">{v ? tl(v * l.unitPrice) : "–"}</span>
                      </div>
                    ) : null}
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
              description={q.trim() ? `"${q.trim()}" için sonuç bulunamadı. Yazımı kontrol edin ya da süzgeci temizleyin.` : "Seçili grupta ya da süzgeçte gösterilecek kalem yok."}
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Süzgeci temizle
                </Button>
              }
            />
          )}
        </Card>
      ) : null}

      {isAdmin ? (
        <Card className="break-inside-avoid">
          <CardHeader
            icon={<PackagePlus />}
            title="Listede olmayanlar"
            description="Hammaddelerde olmayan ama stokta duran kalemler (elle fiyatlı). Tutar = miktar × birim fiyat."
            meta={
              extras.length ? (
                <span className="tabular">
                  {num(filledExtras.length)} kalem · {tl(extrasTotal)}
                </span>
              ) : undefined
            }
            actions={
              <Button variant="secondary" className="no-print pointer-coarse:h-10" onClick={addExtra}>
                <Plus size={16} /> Kalem ekle
              </Button>
            }
          />
          <CardContent>
            {extras.length ? (
              <>
                {/* Sütun başlıkları (geniş ekranda); telefonda her kutunun kendi yer tutucusu var */}
                <div
                  aria-hidden="true"
                  className="mb-1.5 hidden grid-cols-[minmax(0,1fr)_6rem_7rem_8rem_6.5rem_2.25rem] gap-2 px-1 text-xs font-medium text-ink-mute sm:grid"
                >
                  <span>Kalem adı</span>
                  <span>Birim</span>
                  <span className="text-right">Miktar</span>
                  <span className="text-right">Birim fiyat (₺)</span>
                  <span className="text-right">Tutar</span>
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
                    const onEnter = (ev: KeyboardEvent<HTMLInputElement>) => focusNext(ev, "data-extra-input", i === extras.length - 1 ? addExtra : undefined);
                    return (
                      <li
                        key={i}
                        className="grid grid-cols-12 items-center gap-2 rounded-2xl max-sm:bg-surface/60 max-sm:p-2 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_8rem_6.5rem_2.25rem]"
                      >
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
                          className="col-span-10 sm:col-span-1 pointer-coarse:h-10"
                        />
                        <IconButton
                          label={`${e.name.trim() || "Bu satırı"} kaldır`}
                          tone="danger"
                          className="no-print order-1 col-span-2 justify-self-end sm:order-last sm:col-span-1"
                          onClick={() => removeExtra(i)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
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
                          className="order-2 col-span-4 max-sm:px-2.5 max-sm:[&::-webkit-calendar-picker-indicator]:hidden sm:order-none sm:col-span-1 pointer-coarse:h-10"
                        />
                        <NumberInput
                          value={e.qty}
                          data-extra-input=""
                          enterKeyHint="next"
                          onKeyDown={onEnter}
                          onChange={(ev) => updateExtra(i, { qty: ev.target.value })}
                          placeholder="Miktar"
                          aria-label={`Miktar (${e.unit || "ADET"})`}
                          aria-invalid={badNumber(e.qty) || undefined}
                          className="cell-input order-2 col-span-4 sm:order-none sm:col-span-1 pointer-coarse:h-10"
                        />
                        <NumberInput
                          value={e.unitPrice}
                          data-extra-input=""
                          enterKeyHint={i === extras.length - 1 ? "done" : "next"}
                          onKeyDown={onEnter}
                          onChange={(ev) => updateExtra(i, { unitPrice: ev.target.value })}
                          placeholder="Fiyat ₺"
                          aria-label="Birim fiyat (₺, KDV hariç)"
                          aria-invalid={badNumber(e.unitPrice) || undefined}
                          className="cell-input order-2 col-span-4 sm:order-none sm:col-span-1 pointer-coarse:h-10"
                        />
                        <p className="order-3 col-span-12 text-right text-xs text-ink-mute tabular sm:order-none sm:col-span-1 sm:text-sm sm:font-semibold sm:text-ink">
                          <span className="sm:hidden">Tutar </span>
                          <span className="font-semibold text-ink">{tl(extraTotal(e))}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <div className="no-print mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 text-xs text-ink-mute">Son kutuda Enter yeni satır açar. Boş bırakılan satırlar kaydedilmez.</p>
                  <Button variant="ghost" size="sm" onClick={addExtra} className="-mr-2">
                    <Plus size={15} aria-hidden="true" /> Satır ekle
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                icon={<PackagePlus />}
                title="Ek kalem yok"
                description="Hammaddelerde kaydı olmayan ama rafta duran bir şey varsa (ör. peçete, deterjan) buraya ekleyin; stok toplamına girer."
                action={
                  <Button variant="secondary" onClick={addExtra}>
                    <Plus size={16} /> Kalem ekle
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Kaydetme kapsülü: değişiklik varken alttan yaylı hareketle gelir */}
      <FloatingBar open={dirty}>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-sm font-semibold text-ink">{changeLabel}</p>
          {/* Telefonda kısa: ay adı zaten sayfa başlığında */}
          <p className="truncate text-xs text-ink-mute">
            <span className="max-sm:hidden">{monthLabel} sayımı kaydedilmedi</span>
            <span className="sm:hidden">Kaydedilmedi</span>
            {isAdmin ? <span className="tabular"> · toplam {tl(total)}</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" onClick={() => setDiscardOpen(true)} disabled={busy} aria-label="Değişikliklerden vazgeç" className="max-sm:size-10 max-sm:px-0">
            <Undo2 size={16} aria-hidden="true" />
            <span className="max-sm:sr-only">Vazgeç</span>
          </Button>
          <Button onClick={save} disabled={busy} size="lg" title="Kaydet (⌘S / Ctrl+S)" className="max-sm:px-4">
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

      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={discard}
        title="Kaydedilmemiş değişiklikler silinsin mi?"
        description={`${monthLabel} sayımında yazdığınız ama kaydetmediğiniz miktarlar son kayda döner. Kaydedilmiş sayım değişmez.`}
        confirmLabel="Değişiklikleri sil"
      />
    </div>
  );
}
